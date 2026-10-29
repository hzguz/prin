/**
 * Export pipeline.
 *
 * Rendering goes through Konva's own stage export so what ships is exactly
 * what was on screen, at full capture resolution rather than the fitted
 * preview scale.
 */

import Konva from 'konva';
import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { useI18n } from '../i18n';

export type ExportFormat = 'png' | 'jpeg';

interface ExportOptions {
  format: ExportFormat;
  /** JPEG quality 0..1; ignored for PNG. */
  quality: number;
  /** Multiplier over the capture's native resolution. */
  scale: number;
}

export const DEFAULT_EXPORT: ExportOptions = {
  format: 'png',
  quality: 0.92,
  scale: 1,
};

/** Name of the selection transformer node, hidden during export. */
const TRANSFORMER_NAME = 'selection-transformer';

/** Snapshots the stage into an independent canvas at export resolution. */
function renderStageCanvas(stage: Konva.Stage, options: ExportOptions): HTMLCanvasElement {
  // The stage is displayed scaled-to-fit; dividing by the current scale
  // restores native resolution before applying the user's multiplier.
  const pixelRatio = (1 / stage.scaleX()) * options.scale;

  // Selection chrome is UI, not content: leaving it visible bakes the blue
  // handles and bounding box into every exported image.
  const chrome = stage.find(`.${TRANSFORMER_NAME}`);
  const dirtyLayers = new Set<Konva.Layer>();
  const previouslyVisible = chrome.map((node) => {
    const visible = node.visible();
    if (visible) {
      node.visible(false);
      const layer = node.getLayer();
      if (layer) dirtyLayers.add(layer);
    }
    return visible;
  });

  try {
    if (options.scale === 1) {
      // The visible Konva layers are already rasterized at native capture
      // resolution, so their backing canvases can be composited directly
      // instead of repainting the complete scene (especially the screenshot)
      // through Stage.toCanvas().
      const layers = stage.getLayers();

      // Only redraw layers where a visible selection transformer was actually
      // hidden; the background screenshot layer never holds selection chrome.
      dirtyLayers.forEach((layer) => layer.draw());

      const firstCanvas = layers[0]?.getCanvas()._canvas;
      if (firstCanvas) {
        const rendered = document.createElement('canvas');
        rendered.width = firstCanvas.width;
        rendered.height = firstCanvas.height;
        const context = rendered.getContext('2d');
        if (context) {
          context.imageSmoothingEnabled = false;
          for (const layer of layers) {
            context.drawImage(layer.getCanvas()._canvas, 0, 0);
          }
          return rendered;
        }
      }
    }

    // Konva renders directly from the scene graph into an offscreen canvas;
    // the visible stage does not need a redraw when export chrome is hidden.
    return stage.toCanvas({ pixelRatio }) as HTMLCanvasElement;
  } finally {
    // Restore visibility and schedule a redraw only on layers that were dirtied.
    chrome.forEach((node, index) => {
      if (previouslyVisible[index]) {
        node.visible(true);
      }
    });
    dirtyLayers.forEach((layer) => layer.batchDraw());
  }
}

/** Renders and encodes the stage when the caller does not need an early hook. */
async function renderStage(stage: Konva.Stage, options: ExportOptions): Promise<Blob> {
  return canvasToBlob(renderStageCanvas(stage, options), options);
}

/** Encodes a canvas, preferring toBlob over a data-URL round trip. */
function canvasToBlob(canvas: HTMLCanvasElement, options: ExportOptions): Promise<Blob> {
  const mimeType = options.format === 'png' ? 'image/png' : 'image/jpeg';

  // JPEG has no alpha channel: transparent pixels would encode as black.
  // Flattening onto white matches what every other screenshot tool produces.
  const source = mimeType === 'image/jpeg' ? flattenOntoWhite(canvas) : canvas;

  return new Promise((resolve, reject) => {
    source.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('failed to encode export'))),
      mimeType,
      options.quality,
    );
  });
}

/** Paints a canvas over an opaque white base, for formats without alpha. */
function flattenOntoWhite(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const flattened = document.createElement('canvas');
  flattened.width = canvas.width;
  flattened.height = canvas.height;

  const context = flattened.getContext('2d');
  if (!context) return canvas;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, flattened.width, flattened.height);
  context.drawImage(canvas, 0, 0);
  return flattened;
}

/**
 * Extracts raw RGBA pixels with an 8-byte `[width_u32_le, height_u32_le]` header.
 *
 * Bypasses Chromium's slow zlib PNG encoder (`canvas.toBlob('image/png')`) and
 * Rust's PNG decoder (`Image::from_bytes`), cutting copy-to-clipboard latency
 * from ~100-200ms down to ~2-4ms so immediate `Ctrl+V` pastes never miss.
 */
function encodeRawRgbaPayload(canvas: HTMLCanvasElement): ArrayBuffer | null {
  if (typeof canvas.getContext !== 'function') return null;
  const width = canvas.width;
  const height = canvas.height;
  if (width <= 0 || height <= 0) return null;

  const context = canvas.getContext('2d');
  if (!context || typeof context.getImageData !== 'function') return null;

  const imageData = context.getImageData(0, 0, width, height);
  const buffer = new ArrayBuffer(8 + imageData.data.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  new Uint8Array(buffer, 8).set(imageData.data);
  return buffer;
}

/** Copies the composition to the clipboard as an image. */
export async function copyToClipboard(
  stage: Konva.Stage | null,
  options: ExportOptions,
  onExportStart?: () => void | Promise<void>,
  unannotatedCanvas?: HTMLCanvasElement | null,
) {
  const pngOptions = { ...options, format: 'png' as const };

  // Fast path when no annotations exist: read pixels directly from the cropped
  // capture canvas without allocating or compositing Konva layers.
  if (unannotatedCanvas && pngOptions.scale === 1) {
    const rawPayload = encodeRawRgbaPayload(unannotatedCanvas);
    if (rawPayload) {
      await onExportStart?.();
      await invoke('copy_capture', rawPayload);
      return;
    }
  }

  if (!stage) return;

  const rendered = renderStageCanvas(stage, pngOptions);
  try {
    const rawPayload = encodeRawRgbaPayload(rendered);
    if (rawPayload) {
      await onExportStart?.();
      await invoke('copy_capture', rawPayload);
      return;
    }

    await onExportStart?.();
    const blob = await canvasToBlob(rendered, pngOptions);
    // Binary IPC avoids serializing every PNG byte as a JSON number.
    await invoke('copy_capture', await blob.arrayBuffer());
  } finally {
    rendered.width = 0;
    rendered.height = 0;
  }
}

/** Prompts for a location and writes the composition to disk. */
export async function saveToFile(
  stage: Konva.Stage,
  options: ExportOptions,
  onExportStart?: () => void | Promise<void>,
) {
  const extension = options.format === 'png' ? 'png' : 'jpg';
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  const prefix = useI18n.getState().t.overlay.defaultFilenamePrefix;

  const path = await save({
    defaultPath: `${prefix}-${timestamp}.${extension}`,
    filters: [{ name: options.format.toUpperCase(), extensions: [extension] }],
  });

  // A null path means the user dismissed the dialog.
  if (!path) return false;

  const rendered = renderStageCanvas(stage, options);
  try {
    await onExportStart?.();
    const blob = await canvasToBlob(rendered, options);
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return true;
  } finally {
    rendered.width = 0;
    rendered.height = 0;
  }
}

/** Copies the composition as a base64 data URL, useful for pasting into code. */
export async function copyAsDataUrl(stage: Konva.Stage, options: ExportOptions) {
  const blob = await renderStage(stage, options);
  const reader = new FileReader();

  const dataUrl = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  await writeText(dataUrl);
}

/**
 * Crops the full virtual-desktop capture down to the selected region.
 *
 * Returns the cropped HTMLCanvasElement directly rather than encoding a PNG
 * and decoding it back into an HTMLImageElement: Konva accepts a canvas as an
 * image source natively, making entering annotation mode instantaneous (< 1ms).
 */
export function cropCapture(
  source: HTMLImageElement | HTMLCanvasElement,
  region: { x: number; y: number; width: number; height: number },
  devicePixelRatio: number,
): HTMLCanvasElement {
  // Selection arrives in CSS pixels; the capture is in physical pixels.
  const naturalWidth = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const naturalHeight = 'naturalHeight' in source ? source.naturalHeight : source.height;
  const scaleX =
    typeof window !== 'undefined' && window.innerWidth > 0 && naturalWidth > 0
      ? naturalWidth / window.innerWidth
      : devicePixelRatio;
  const scaleY =
    typeof window !== 'undefined' && window.innerHeight > 0 && naturalHeight > 0
      ? naturalHeight / window.innerHeight
      : devicePixelRatio;

  const width = Math.max(1, Math.round(region.width * scaleX));
  const height = Math.max(1, Math.round(region.height * scaleY));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas 2d context unavailable');

  context.imageSmoothingEnabled = false;

  context.drawImage(
    source,
    Math.round(region.x * scaleX),
    Math.round(region.y * scaleY),
    width,
    height,
    0,
    0,
    width,
    height,
  );

  return canvas;
}

/**
 * Loads and fully decodes an image.
 *
 * `decode()` is what makes this useful for pre-warming: assigning `src` only
 * schedules the decode, so a caller that wants the pixels ready before
 * painting must await it explicitly.
 */
export async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = src;

  // Older engines without decode() still resolve through the load event.
  if (typeof image.decode === 'function') {
    await image.decode();
    return image;
  }

  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('failed to decode capture image'));
  });
}
