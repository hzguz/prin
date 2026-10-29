/**
 * Single-window capture flow: select a region, annotate it in place, export.
 *
 * States:
 *   idle       → frozen desktop, waiting for a drag
 *   selecting  → drag in progress, region being sized
 *   annotating → region fixed, canvas and toolbar live over it
 *
 * Annotation happens on the overlay itself rather than in a separate editor
 * window, so a capture never leaves the screen it was taken from.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import Konva from 'konva';
import { OverlayCanvas } from '../components/canvas/OverlayCanvas';
import { FloatingToolbar } from '../components/panels/FloatingToolbar';
import { RegionHandles } from '../components/overlay/RegionHandles';
import { useI18n } from '../i18n';
import { copyToClipboard, cropCapture, loadImage, saveToFile } from '../lib/exportImage';
import { shouldSuppressShortcuts } from '../lib/keyboardGuard';
import { primaryModifierLabel } from '../lib/platform';
import { scheduleReveal } from '../lib/scheduleReveal';
import {
  TOOLBAR_GAP,
  TOOLBAR_HEIGHT,
  TOOLBAR_WIDTH,
  computeToolbarPosition,
} from '../lib/toolbarPlacement';
import { useEditorStore } from '../store/editorStore';
import { TOOL_SHORTCUTS } from '../types/tools';

type Phase = 'idle' | 'selecting' | 'annotating';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PreparedCapture {
  url: string;
  image: HTMLImageElement;
}

/** Below this size a drag is treated as a stray click, not a selection. */
const MIN_SELECTION_SIZE = 8;

export function CaptureOverlay() {
  const [capture, setCapture] = useState<PreparedCapture | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [selection, setSelection] = useState<Rect | null>(null);
  const [croppedImage, setCroppedImage] = useState<HTMLCanvasElement | HTMLImageElement | null>(
    null,
  );
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  /** True while a region handle is being dragged, before the recrop lands. */
  const [isResizingRegion, setIsResizingRegion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const closingRef = useRef(false);
  const [toolbarOverride, setToolbarOverride] = useState<{ x: number; y: number } | null>(null);
  const [toolbarSize, setToolbarSize] = useState({ width: TOOLBAR_WIDTH, height: TOOLBAR_HEIGHT });

  const originRef = useRef<{ x: number; y: number } | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  /** Blob URL of the capture, revoked on unmount to release its bytes. */
  const objectUrlRef = useRef<string | null>(null);
  const croppedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const preparingRef = useRef(false);
  const cropGenerationRef = useRef(0);
  /** Region represented by croppedImage and the annotations' coordinates. */
  const croppedRegionRef = useRef<Rect | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const toolbarDragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(
    null,
  );
  const selectionRef = useRef<Rect | null>(null);

  const activeTool = useEditorStore((state) => state.activeTool);
  const setActiveTool = useEditorStore((state) => state.setActiveTool);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const removeSelected = useEditorStore((state) => state.removeSelected);
  const duplicateSelected = useEditorStore((state) => state.duplicateSelected);
  const setNodeSelection = useEditorStore((state) => state.setSelection);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const resetScene = useEditorStore((state) => state.reset);
  const translateScene = useEditorStore((state) => state.translateScene);
  const t = useI18n((state) => state.t);
  const mod = primaryModifierLabel();

  const pixelRatio = window.devicePixelRatio || 1;

  const releaseCroppedCanvas = useCallback(() => {
    if (croppedCanvasRef.current) {
      croppedCanvasRef.current.width = 0;
      croppedCanvasRef.current.height = 0;
      croppedCanvasRef.current = null;
    }
  }, []);

  const resetCapture = useCallback(() => {
    cropGenerationRef.current += 1;
    croppedRegionRef.current = null;
    releaseCroppedCanvas();
    resetScene();
    setCapture(null);
    setPhase('idle');
    setSelection(null);
    setCroppedImage(null);
    setPointer(null);
    setIsResizingRegion(false);
    setError(null);
    setToolbarOverride(null);
    originRef.current = null;
    selectionRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, [releaseCroppedCanvas, resetScene]);

  const prepareCapture = useCallback(
    async (skipRequestCheck = false) => {
      if (preparingRef.current) return;

      try {
        if (!skipRequestCheck) {
          // Keep the backend request latched until the overlay is revealed. This
          // prevents a second hotkey press during PNG transfer/decode from
          // starting a request whose event would be ignored by preparingRef.
          const requested = await invoke<boolean>('overlay_capture_requested');
          if (!requested || preparingRef.current) return;
        }
        preparingRef.current = true;
        resetCapture();

        // Raw IPC skips JSON and base64 for this large payload.
        const response = await invoke<ArrayBuffer | Uint8Array>('take_capture');
        const incoming = response instanceof ArrayBuffer ? new Uint8Array(response) : response;
        const png = new Uint8Array(incoming.byteLength);
        png.set(incoming);
        const objectUrl = URL.createObjectURL(new Blob([png.buffer], { type: 'image/png' }));
        objectUrlRef.current = objectUrl;

        // Decode before revealing so the persistent window never shows a blank
        // frame while the browser prepares the PNG texture.
        const image = await loadImage(objectUrl);
        setCapture({ url: objectUrl, image });
      } catch (reason) {
        setError(String(reason));
      } finally {
        preparingRef.current = false;
      }
    },
    [resetCapture],
  );

  useEffect(() => {
    let active = true;
    let dispose: (() => void) | null = null;

    void listen('start-capture', () => void prepareCapture(true)).then((unlisten) => {
      if (!active) {
        unlisten();
        return;
      }
      dispose = unlisten;
      // Claims requests made while this listener was still being installed.
      void prepareCapture(false);
    });

    return () => {
      active = false;
      dispose?.();
      resetCapture();
    };
  }, [prepareCapture, resetCapture]);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || phase !== 'annotating') return;

    const updateToolbarSize = () => {
      const bounds = toolbar.getBoundingClientRect();
      const width = Math.ceil(bounds.width);
      const height = Math.ceil(bounds.height);
      setToolbarSize((current) => {
        if (current.width === width && current.height === height) return current;
        return { width, height };
      });
    };

    updateToolbarSize();

    const observer = new ResizeObserver(updateToolbarSize);
    observer.observe(toolbar);

    return () => observer.disconnect();
  }, [phase, activeTool]);

  // Prefer two frames for painting, but allow reveal when the hidden webview
  // suspends animation callbacks. The screenshot is already decoded here.
  //
  // The error path must reveal too, otherwise a failed capture leaves an
  // invisible window with no way for the user to learn what went wrong.
  useEffect(() => {
    if (!capture && !error) return;

    return scheduleReveal(() => {
      invoke('reveal_overlay').catch((reason) => {
        console.error('Failed to reveal capture', reason);
        void invoke('close_overlay').catch((closeErr) =>
          console.error('Failed to close capture', closeErr),
        );
      });
    });
  }, [capture, error]);

  const close = useCallback(() => {
    if (exportingRef.current || closingRef.current) return;
    closingRef.current = true;
    // Clear the old scene before hiding releases the backend for a new capture.
    resetCapture();
    invoke('close_overlay')
      .catch((reason) => {
        setError(String(reason));
      })
      .finally(() => {
        closingRef.current = false;
      });
  }, [resetCapture]);

  /** Crops the selection synchronously and moves into annotation mode. */
  const enterAnnotation = useCallback(
    (region: Rect, previousRegion?: Rect | null): number | null => {
      if (!capture) return null;
      const generation = ++cropGenerationRef.current;
      selectionRef.current = region;
      if (region.width < MIN_SELECTION_SIZE || region.height < MIN_SELECTION_SIZE) {
        selectionRef.current = null;
        setSelection(null);
        setPhase('idle');
        return generation;
      }

      try {
        const cropped = cropCapture(capture.image, region, pixelRatio);
        if (generation !== cropGenerationRef.current) return generation;

        if (previousRegion) {
          translateScene(
            Math.round((previousRegion.x - region.x) * pixelRatio),
            Math.round((previousRegion.y - region.y) * pixelRatio),
          );
        }
        releaseCroppedCanvas();
        croppedCanvasRef.current = cropped;
        setCroppedImage(cropped);
        croppedRegionRef.current = region;
        setPhase('annotating');
      } catch (reason) {
        if (generation === cropGenerationRef.current) setError(String(reason));
      }
      return generation;
    },
    [capture, pixelRatio, releaseCroppedCanvas, translateScene],
  );

  /**
   * Recrops after the region handles change the capture area.
   */
  const handleRegionResize = useCallback((region: Rect) => {
    selectionRef.current = region;
    setIsResizingRegion(true);
    setSelection(region);
  }, []);

  const handleRegionResizeEnd = useCallback(() => {
    const region = selectionRef.current;
    if (!region) return;
    const previousRegion = croppedRegionRef.current;
    const generation = enterAnnotation(region, previousRegion);
    if (generation === cropGenerationRef.current) {
      setIsResizingRegion(false);
    }
  }, [enterAnnotation]);

  const handleCopy = useCallback(async () => {
    if (exportingRef.current || closingRef.current || isResizingRegion) return;

    // If the user pressed Enter or Ctrl+C while still holding the mouse button
    // at the end of a region drag, finalize the crop synchronously right now.
    if (originRef.current && selectionRef.current) {
      const region = selectionRef.current;
      originRef.current = null;
      if (region.width >= MIN_SELECTION_SIZE && region.height >= MIN_SELECTION_SIZE) {
        enterAnnotation(region);
      }
    }

    const stage = stageRef.current;
    const hasAnnotations = useEditorStore.getState().annotations.length > 0;
    const fastCanvas = !hasAnnotations ? croppedCanvasRef.current : null;

    if (!stage && !fastCanvas) return;

    exportingRef.current = true;
    try {
      await copyToClipboard(
        stage,
        { format: 'png', quality: 1, scale: 1 },
        () => {
          resetCapture();
        },
        fastCanvas,
      );
      await invoke('close_overlay');
    } catch (reason) {
      setError(String(reason));
    } finally {
      exportingRef.current = false;
    }
  }, [enterAnnotation, isResizingRegion, resetCapture]);

  const handleSave = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage || exportingRef.current || closingRef.current || isResizingRegion) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      const saved = await saveToFile(stage, { format: 'png', quality: 1, scale: 1 });
      if (saved) {
        resetCapture();
        await invoke('close_overlay');
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [resetCapture, isResizingRegion]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (exportingRef.current || closingRef.current) {
        event.preventDefault();
        return;
      }
      // Never hijack keys while the user is typing into a field.
      const focused = document.activeElement as HTMLElement | null;
      const suppressed = shouldSuppressShortcuts({
        focusedTagName: focused?.tagName,
        focusedIsContentEditable: focused?.isContentEditable,
        isEditingText: useEditorStore.getState().editingTextId !== null,
      });

      if (event.key === 'Escape') {
        event.preventDefault();
        // Escape steps back one level before abandoning the capture.
        if (phase === 'annotating' && useEditorStore.getState().selectedIds.length > 0) {
          setNodeSelection([]);
        } else {
          close();
        }
        return;
      }

      if (suppressed) return;

      const isModified = event.ctrlKey || event.metaKey;

      // Allow immediate copy (Enter / Ctrl+C) even if the user has not yet
      // released the mouse button at the end of a valid selection drag.
      const hasValidDragSelection =
        phase === 'selecting' &&
        selectionRef.current !== null &&
        selectionRef.current.width >= MIN_SELECTION_SIZE &&
        selectionRef.current.height >= MIN_SELECTION_SIZE;

      if (hasValidDragSelection) {
        if (event.key === 'Enter' || (isModified && event.key.toLowerCase() === 'c')) {
          event.preventDefault();
          void handleCopy();
        }
        return;
      }

      if (phase !== 'annotating') return;

      if (isModified && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }
      if (isModified && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (isModified && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        void handleCopy();
        return;
      }
      if (isModified && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
        return;
      }
      if (isModified && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (isModified && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setNodeSelection(useEditorStore.getState().annotations.map((item) => item.id));
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeSelected();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void handleCopy();
        return;
      }

      const tool = TOOL_SHORTCUTS[event.key.toLowerCase()];
      if (tool && !isModified) {
        event.preventDefault();
        setActiveTool(tool);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    close,
    duplicateSelected,
    handleCopy,
    handleSave,
    phase,
    redo,
    removeSelected,
    setActiveTool,
    setNodeSelection,
    selectedIds,
    undo,
  ]);

  const handlePointerDown = (event: React.PointerEvent) => {
    if (phase === 'annotating') return;

    originRef.current = { x: event.clientX, y: event.clientY };
    const region = { x: event.clientX, y: event.clientY, width: 0, height: 0 };
    selectionRef.current = region;
    setSelection(region);
    setPhase('selecting');
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    setPointer({ x: event.clientX, y: event.clientY });

    const origin = originRef.current;
    if (phase !== 'selecting' || !origin) return;

    const region = {
      x: Math.min(origin.x, event.clientX),
      y: Math.min(origin.y, event.clientY),
      width: Math.abs(event.clientX - origin.x),
      height: Math.abs(event.clientY - origin.y),
    };
    selectionRef.current = region;
    setSelection(region);
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    if (phase !== 'selecting') return;
    const origin = originRef.current;
    originRef.current = null;
    const finalRegion = origin
      ? {
          x: Math.min(origin.x, event.clientX),
          y: Math.min(origin.y, event.clientY),
          width: Math.abs(event.clientX - origin.x),
          height: Math.abs(event.clientY - origin.y),
        }
      : selectionRef.current ?? selection;
    if (!finalRegion) return;
    selectionRef.current = finalRegion;
    setSelection(finalRegion);
    enterAnnotation(finalRegion);
  };

  const handleToolbarDragStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    const initial =
      toolbarOverride ??
      (selection
        ? computeToolbarPosition(
            selection,
            { width: window.innerWidth, height: window.innerHeight },
            toolbarSize,
          )
        : { x: event.clientX, y: event.clientY });
    toolbarDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - initial.x,
      offsetY: event.clientY - initial.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handleToolbarDragMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = toolbarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const bounds = toolbarRef.current?.getBoundingClientRect();
    const width = bounds?.width ?? TOOLBAR_WIDTH;
    const height = bounds?.height ?? TOOLBAR_HEIGHT;
    const margin = TOOLBAR_GAP;
    setToolbarOverride({
      x: Math.min(
        Math.max(margin, event.clientX - drag.offsetX),
        Math.max(margin, window.innerWidth - width - margin),
      ),
      y: Math.min(
        Math.max(margin, event.clientY - drag.offsetY),
        Math.max(margin, window.innerHeight - height - margin),
      ),
    });
    event.preventDefault();
    event.stopPropagation();
  };

  const handleToolbarDragEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (toolbarDragRef.current?.pointerId !== event.pointerId) return;
    toolbarDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.stopPropagation();
  };

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-900/95">
        <div className="rounded-2xl border border-red-500/30 bg-surface-800 px-6 py-5 text-center">
          <p className="text-sm text-red-400">{t.overlay.captureError}</p>
          <p className="mt-1 max-w-md font-mono text-xs break-words text-content-muted">{error}</p>
          <button
            type="button"
            onClick={close}
            className="mt-4 rounded-lg bg-surface-700 px-4 py-1.5 text-xs text-content-secondary hover:text-content-primary"
          >
            {t.overlay.closeEsc}
          </button>
        </div>
      </div>
    );
  }

  // Fully transparent: the window stays hidden until the capture is painted,
  // so anything drawn here would only ever be a flash of the wrong colour.
  if (!capture) return <div className="h-screen w-screen bg-transparent" />;

  const computedToolbarPosition = selection
    ? computeToolbarPosition(
        selection,
        {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        toolbarSize,
      )
    : null;
  const toolbarPosition = toolbarOverride ?? computedToolbarPosition;
  const toolbarIsViewportBottom =
    !toolbarOverride && computedToolbarPosition?.mode === 'viewport-bottom';
  const toolbarDockWidth = toolbarIsViewportBottom
    ? Math.min(TOOLBAR_WIDTH, window.innerWidth - TOOLBAR_GAP * 2)
    : undefined;

  const hasSelection = selectedIds.length > 0;

  return (
    <div
      className={`relative h-screen w-screen overflow-hidden select-none ${
        phase === 'annotating' ? '' : 'cursor-crosshair'
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {exporting && (
        <div className="absolute inset-0 z-50 flex cursor-wait items-center justify-center bg-black/10">
          <span className="rounded-lg bg-surface-900 px-4 py-2 text-sm text-content-primary">
            {t.overlay.exporting}
          </span>
        </div>
      )}
      <img
        src={capture.url}
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ imageRendering: '-webkit-optimize-contrast' }}
      />

      <div className="pointer-events-none absolute inset-0 bg-black/45" />

      {/* Undimmed cut-out of the selected region. The Konva stage covers this
          during annotation, but it is what the user sees while dragging the
          initial selection and while the region handles are being moved. */}
      {selection && selection.width > 0 && (phase !== 'annotating' || isResizingRegion) && (
        <div
          className="pointer-events-none absolute overflow-hidden"
          style={{
            left: Math.round(selection.x),
            top: Math.round(selection.y),
            width: Math.round(selection.width),
            height: Math.round(selection.height),
          }}
        >
          <img
            src={capture.url}
            alt=""
            draggable={false}
            className="absolute h-screen w-screen max-w-none"
            style={{
              left: -Math.round(selection.x),
              top: -Math.round(selection.y),
              imageRendering: '-webkit-optimize-contrast',
            }}
          />
        </div>
      )}

      {/* Hidden mid-resize: the cropped image still has the old dimensions, so
          showing it stretched over the new bounds would look broken until the
          recrop lands. */}
      {phase === 'annotating' && croppedImage && selection && !isResizingRegion && (
        <OverlayCanvas
          image={croppedImage}
          bounds={selection}
          pixelRatio={pixelRatio}
          stageRef={stageRef}
        />
      )}

      {phase === 'annotating' && selection && (
        <RegionHandles
          region={selection}
          onResize={handleRegionResize}
          onResizeEnd={handleRegionResizeEnd}
        />
      )}

      {selection && selection.width > 0 && (
        <div
          className={`pointer-events-none absolute border ${
            phase === 'annotating' ? 'border-accent/70' : 'border-accent'
          }`}
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
          }}
        >
          {phase !== 'annotating' &&
            ['-top-1 -left-1', '-top-1 -right-1', '-bottom-1 -left-1', '-bottom-1 -right-1'].map(
              (position) => (
                <span
                  key={position}
                  className={`absolute ${position} h-2 w-2 rounded-full border border-white bg-accent`}
                />
              ),
            )}
        </div>
      )}

      {/* Kept visible through annotation, not just while dragging: the region
          stays adjustable, so its size stays relevant. Reported in capture
          pixels, which is what the exported file will actually contain. */}
      {selection && selection.width > 0 && (
        <div
          // Below the region handles (z-30) and offset from the top-centre
          // handle, which would otherwise sit on top of the readout.
          className="pointer-events-none absolute z-20 rounded-md border border-surface-600/60 bg-surface-900/92 px-2 py-1 font-mono text-[11px] text-content-primary tabular-nums backdrop-blur"
          style={{
            left: selection.x + 14,
            top: selection.y > 34 ? selection.y - 30 : selection.y + selection.height + 14,
          }}
        >
          {Math.round(selection.width * pixelRatio)} × {Math.round(selection.height * pixelRatio)}
        </div>
      )}

      {phase === 'annotating' && toolbarPosition && (
        <div
          ref={toolbarRef}
          // Above the region handles: its popovers open upward and would be
          // clipped behind them otherwise.
          className="absolute z-40"
          style={{ left: toolbarPosition.x, top: toolbarPosition.y, width: toolbarDockWidth }}
        >
          <FloatingToolbar
            onCopy={handleCopy}
            onSave={handleSave}
            onCancel={close}
            fullWidth={toolbarIsViewportBottom}
            onDragPointerDown={handleToolbarDragStart}
            onDragPointerMove={handleToolbarDragMove}
            onDragPointerUp={handleToolbarDragEnd}
          />
        </div>
      )}

      {phase === 'idle' && (
        <div
          className={`pointer-events-none rounded-lg bg-surface-900/85 px-3 py-2 text-xs text-content-secondary backdrop-blur ${
            pointer ? 'absolute' : 'fixed bottom-6 left-1/2 -translate-x-1/2'
          }`}
          style={pointer ? { left: pointer.x + 16, top: pointer.y + 16 } : undefined}
        >
          {t.overlay.dragToSelect} · <span className="font-mono">Esc</span> {t.overlay.cancels}
        </div>
      )}

      {phase === 'annotating' && (
        <div className="pointer-events-none fixed bottom-3 left-1/2 -translate-x-1/2 rounded-lg bg-surface-900/80 px-3 py-1.5 text-[11px] text-content-muted backdrop-blur">
          <span className="font-mono">Enter</span> {t.overlay.copies} ·{' '}
          <span className="font-mono">{mod}+S</span> {t.overlay.saves} ·{' '}
          <span className="font-mono">Esc</span>{' '}
          {hasSelection ? t.overlay.deselects : t.overlay.cancels}
        </div>
      )}
    </div>
  );
}
