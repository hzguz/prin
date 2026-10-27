/**
 * Real pixel blur over a region of the screenshot.
 *
 * A translucent rectangle would only tint the pixels underneath, leaving
 * sensitive content readable. This clips the source image to the annotation
 * bounds and runs Konva's blur filter over those pixels, so redaction
 * actually destroys the information at export time.
 */

import { memo, useCallback, useEffect, useRef } from 'react';
import { Group, Image as KonvaImage, Rect } from 'react-konva';
import Konva from 'konva';
import { Annotation, RectAnnotation } from '../../types/annotations';

interface BlurRegionProps {
  annotation: RectAnnotation;
  image: HTMLImageElement | HTMLCanvasElement;
  isDraggable: boolean;
  /**
   * True while a drawing tool is active, meaning a press on this region is
   * aimed at the canvas above it rather than at the region itself.
   */
  isDrawingToolActive: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (id: string, patch: Partial<Annotation>) => void;
  onCommit: () => void;
  /** Called when a drag or transform starts, to open one undo step. */
  onBeginGesture: () => void;
}

export const BlurRegion = memo(function BlurRegion({
  annotation,
  image,
  isDraggable,
  isDrawingToolActive,
  onSelect,
  onChange,
  onCommit,
  onBeginGesture,
}: BlurRegionProps) {
  const groupRef = useRef<Konva.Group>(null);
  const imageRef = useRef<Konva.Image>(null);

  const { style } = annotation;
  // Draft rectangles keep signed dimensions until pointer-up. Render their
  // normalised geometry immediately so a blur drawn up/left has live preview.
  const x = annotation.width < 0 ? annotation.x + annotation.width : annotation.x;
  const y = annotation.height < 0 ? annotation.y + annotation.height : annotation.y;
  const width = Math.abs(annotation.width);
  const height = Math.abs(annotation.height);

  // Konva filters only run on cached nodes, and the cache must be rebuilt
  // whenever geometry or blur strength changes.
  useEffect(() => {
    const node = imageRef.current;
    if (!node || width <= 0 || height <= 0) return;

    // Cache only the covered region: an uncropped cache would allocate a full
    // copy of the screenshot per blur, which multiplies fast on a 4K capture.
    // The margin lets the blur kernel sample real neighbouring pixels instead
    // of transparent padding, which would darken the edges.
    const margin = Math.ceil(style.blurIntensity * 2);

    node.cache({
      x: x - margin,
      y: y - margin,
      width: width + margin * 2,
      height: height + margin * 2,
      // Blur is a low-frequency effect, so half-resolution sampling is
      // visually indistinguishable and quarters the buffer.
      pixelRatio: 0.5,
    });
    node.getLayer()?.batchDraw();
    // Rotation is included deliberately: a stale cache after rotating would
    // leave readable pixels showing through a region meant to be redacted.
  }, [
    width,
    height,
    style.blurIntensity,
    style.cornerRadius,
    x,
    y,
    annotation.rotation,
    image,
  ]);

  /**
   * Attaches the group and overrides how it measures itself.
   *
   * Konva takes a group's client rect as the union of its children, and the
   * blurred image child spans the entire screenshot; `clipFunc` changes what
   * is painted, not that measurement, so a transformer would size itself to
   * the whole capture. This runs as a ref callback rather than an effect
   * because the parent binds the transformer in its own effect, which fires
   * before a child's — an effect here would land too late for the first
   * selection and report the unclipped bounds.
   */
  const attachGroup = useCallback((group: Konva.Group | null) => {
    groupRef.current = group;
    if (!group) return;

    group.getClientRect = function getClippedRect(config) {
      // Read the live node dimensions rather than closing over React props.
      // During resize these attributes change before React renders, so the
      // transformer measures the new region on the same pointer frame.
      const local = { x: 0, y: 0, width: this.width(), height: this.height() };

      if (config?.skipTransform) return local;

      return this._transformedRect(local, config?.relativeTo);
    };
  }, []);

  const syncTransform = useCallback(
    (node: Konva.Group) => {
      const nextWidth = Math.max(4, node.width() * node.scaleX());
      const nextHeight = Math.max(4, node.height() * node.scaleY());

      // Leaving scale on the group stretches the already-filtered pixels.
      // Turn it into real geometry immediately so the next draw re-clips and
      // re-caches the source image at its current size.
      node.scaleX(1);
      node.scaleY(1);
      node.width(nextWidth);
      node.height(nextHeight);

      onChange(annotation.id, {
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        width: nextWidth,
        height: nextHeight,
      } as Partial<Annotation>);
    },
    [annotation.id, onChange],
  );

  if (width === 0 || height === 0) return null;

  return (
    <Group
      id={annotation.id}
      ref={attachGroup}
      x={x}
      y={y}
      width={width}
      height={height}
      rotation={annotation.rotation}
      // A drawing tool takes precedence over dragging: otherwise pressing on
      // this region to draw over it would move the region instead.
      draggable={isDraggable && !annotation.locked && !isDrawingToolActive}
      clipFunc={(context) => {
        // Rounded clip keeps the redaction visually consistent with other
        // shapes without leaking pixels outside the corner radius.
        const radius = Math.min(style.cornerRadius, width / 2, height / 2);
        context.beginPath();
        context.moveTo(radius, 0);
        context.arcTo(width, 0, width, height, radius);
        context.arcTo(width, height, 0, height, radius);
        context.arcTo(0, height, 0, 0, radius);
        context.arcTo(0, 0, width, 0, radius);
        context.closePath();
      }}
      onMouseDown={(event) => {
        if (annotation.locked) return;
        // With a drawing tool active the press belongs to the canvas, so let
        // it bubble to the stage and start a new shape on top of this one.
        if (isDrawingToolActive) return;
        event.cancelBubble = true;
        onSelect(annotation.id, event.evt.shiftKey);
      }}
      onDragStart={(event) => {
        event.cancelBubble = true;
        // Capture the pre-drag scene so the whole move is one undo step.
        onBeginGesture();
      }}
      onTransformStart={() => onBeginGesture()}
      onTransform={(event) => syncTransform(event.target as Konva.Group)}
      onDragMove={(event) => {
        // Konva moves the node itself during a drag; mirroring it into state
        // stops the next React render from snapping it back.
        onChange(annotation.id, { x: event.target.x(), y: event.target.y() });
      }}
      onDragEnd={(event) => {
        onChange(annotation.id, { x: event.target.x(), y: event.target.y() });
        onCommit();
      }}
      onTransformEnd={(event) => {
        syncTransform(event.target as Konva.Group);
        onCommit();
      }}
    >
      {/*
        Hit area for the region. The blurred image below is non-listening, so
        without this the group would only be clickable where the image happens
        to register — this makes the whole redacted rectangle grabbable.
      */}
      <Rect width={width} height={height} fill="transparent" />

      <KonvaImage
        ref={imageRef}
        image={image}
        // Offset the source so the region under the annotation lines up with
        // the same pixels in the underlying screenshot.
        x={-x}
        y={-y}
        width={image.width}
        height={image.height}
        filters={[Konva.Filters.Blur]}
        blurRadius={style.blurIntensity}
        listening={false}
      />
    </Group>
  );
});
