/**
 * Annotation canvas positioned directly over the selected region.
 *
 * Unlike a windowed editor, this draws at 1:1 with no fit-to-viewport scaling:
 * the canvas sits exactly where the user made the selection, so annotations
 * land on the pixels being pointed at.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Image as KonvaImage, Layer, Stage, Transformer } from 'react-konva';
import Konva from 'konva';
import { useEditorStore } from '../../store/editorStore';
import { Annotation } from '../../types/annotations';
import { AnnotationShape } from './AnnotationShape';
import { BlurRegion } from './BlurRegion';
import { TextEditorOverlay } from './TextEditorOverlay';
import { createAnnotation, extendAnnotation, finaliseDraft } from './annotationFactory';
import { isTransformerTarget, TRANSFORMER_NAME } from './transformerTarget';
import { SpotlightMask } from './SpotlightMask';

/**
 * Pointer travel, in stage pixels, before a press becomes a drag.
 *
 * Large enough to absorb the hand tremor of a deliberate click, small enough
 * that an intentional nudge still registers on the first movement.
 */
const DRAG_THRESHOLD_PX = 4;

interface OverlayCanvasProps {
  /** Cropped screenshot of the selected region, at physical resolution. */
  image: HTMLImageElement | HTMLCanvasElement;
  /** Selection bounds in CSS pixels, used to place the stage on screen. */
  bounds: { x: number; y: number; width: number; height: number };
  /** Physical pixels per CSS pixel, so the stage renders sharp. */
  pixelRatio: number;
  stageRef: React.RefObject<Konva.Stage | null>;
}

export function OverlayCanvas({ image, bounds, pixelRatio, stageRef }: OverlayCanvasProps) {
  const transformerRef = useRef<Konva.Transformer>(null);
  const draftIdRef = useRef<string | null>(null);
  /**
   * Mirrors `draftIdRef` into state so the Transformer stays hidden while a
   * pen stroke or shape is actively being drawn, and attaches with fresh
   * bounds only once the user releases the pointer.
   */
  const [draftId, setDraftId] = useState<string | null>(null);
  const editingTextId = useEditorStore((state) => state.editingTextId);
  const setEditingTextId = useEditorStore((state) => state.setEditingTextId);
  const [hoveringShape, setHoveringShape] = useState(false);
  /**
   * The stage's DOM container, held in state rather than read from the ref
   * during render. A ref assignment does not trigger a re-render, so reading
   * `stageRef.current` inline can hand `null` to children on the render that
   * matters and never correct it.
   */
  const [stageContainer, setStageContainer] = useState<HTMLDivElement | null>(null);
  const [editingTextDraft, setEditingTextDraft] = useState<string | null>(null);
  const [editingTextWidth, setEditingTextWidth] = useState<number | null>(null);
  const [editingTextHeight, setEditingTextHeight] = useState<number | null>(null);
  /** Anchor currently being dragged, recorded for text resize semantics. */
  const activeAnchorRef = useRef<string | null>(null);

  const annotations = useEditorStore((state) => state.annotations);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const activeTool = useEditorStore((state) => state.activeTool);
  const draftStyle = useEditorStore((state) => state.draftStyle);
  const setSelection = useEditorStore((state) => state.setSelection);
  const addAnnotation = useEditorStore((state) => state.addAnnotation);
  const updateTransient = useEditorStore((state) => state.updateAnnotationTransient);
  const commitTransient = useEditorStore((state) => state.commitTransient);
  const beginTransient = useEditorStore((state) => state.beginTransient);
  const undo = useEditorStore((state) => state.undo);

  // Editing cannot outlive this canvas: a stale id would suppress every
  // keyboard shortcut for the rest of the capture.
  useEffect(() => () => useEditorStore.getState().setEditingTextId(null), []);

  // Publish the stage container once it exists, so children that position
  // themselves against it render on the very next pass instead of waiting for
  // an unrelated state change to happen to re-render this component.
  useEffect(() => {
    setStageContainer(stageRef.current?.container() ?? null);
  }, [stageRef, bounds.width, bounds.height]);

  // Rebinding the transformer mid-gesture aborts the drag, so this must not
  // react to the transient updates a transform emits on every pointer move.
  // Only selection changes, draft completion, and node creation/removal can
  // invalidate the list.
  const annotationIds = annotations.map((item) => item.id).join(',');

  // Blur is the only annotation that renders no Konva node while its draft is
  // still 0x0. Its id already exists at that point, so annotationIds alone
  // cannot tell the binding effect that the node appeared on the first drag.
  // Track only the renderable transition, not dimensions, or every resize
  // frame would rebind the transformer and interrupt the gesture.
  const selectedRenderableBlurIds = annotations
    .filter(
      (item) =>
        item.type === 'blur' &&
        item.width !== 0 &&
        item.height !== 0 &&
        selectedIds.includes(item.id),
    )
    .map((item) => item.id)
    .join(',');

  // An auto-width text node measures itself from its glyphs, so its bounds
  // change whenever the content or typography does. The transformer caches
  // what it measured at bind time and would otherwise keep the old box.
  const selectedTextMetrics = annotations
    .filter((item) => item.type === 'text' && selectedIds.includes(item.id))
    .map((item) =>
      item.type === 'text'
        ? JSON.stringify([
            item.text,
            item.style.fontSize,
            item.style.fontFamily,
            item.style.fontWeight,
            item.style.fontStyle,
            item.autoWidth,
            item.width,
            item.id === editingTextId ? editingTextDraft : null,
            item.id === editingTextId ? editingTextWidth : null,
            item.id === editingTextId ? editingTextHeight : null,
          ])
        : '',
    )
    .join(',');

  // Text needs a different anchor set from the other shapes.
  const selectedIsText =
    selectedIds.length === 1 &&
    annotations.find((item) => item.id === selectedIds[0])?.type === 'text';

  useLayoutEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;

    // Never show resize/rotate handles on a shape or pen stroke while the
    // user is still drawing it; attach only once the pointer is released.
    const visibleSelectedIds = draftId
      ? selectedIds.filter((id) => id !== draftId)
      : selectedIds;

    const nodes = visibleSelectedIds
      .map((id) => stage.findOne<Konva.Node>(`#${id}`))
      .filter((node): node is Konva.Node => Boolean(node));

    transformer.nodes(nodes);
    transformer.forceUpdate();
    transformer.getLayer()?.batchDraw();
  }, [
    selectedIds,
    draftId,
    annotationIds,
    selectedRenderableBlurIds,
    selectedTextMetrics,
    stageRef,
  ]);

  const handleEditingDraftChange = useCallback((value: string, width: number, height: number) => {
    setEditingTextDraft(value);
    setEditingTextWidth(width);
    setEditingTextHeight(height);
  }, []);

  const closeTextEditor = useCallback(() => {
    setEditingTextDraft(null);
    setEditingTextWidth(null);
    setEditingTextHeight(null);
    setEditingTextId(null);
  }, [setEditingTextId]);

  /** Pointer position in image space (physical pixels of the capture). */
  const getPointerPosition = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;

    // getPointerPosition reports screen pixels relative to the container; the
    // inverse stage transform converts that into image space, which differs
    // whenever the display scale is not 1.
    return stage.getAbsoluteTransform().copy().invert().point(pointer);
  }, [stageRef]);

  /** Any tool other than select places new content on press. */
  const isDrawingToolActive = activeTool !== 'select';

  const finishDraft = useCallback(() => {
    const currentDraftId = draftIdRef.current;
    if (!currentDraftId) return;
    draftIdRef.current = null;
    setDraftId(null);

    const currentAnnotations = useEditorStore.getState().annotations;
    const draft = currentAnnotations.find((item) => item.id === currentDraftId);
    if (!draft) return;

    const outcome = finaliseDraft(draft);
    if (outcome.action === 'discard') {
      undo();
      return;
    }
    if (outcome.patch) {
      updateTransient(currentDraftId, outcome.patch);
    }
  }, [undo, updateTransient]);

  // Complete the active stroke even if the user drags past the selection edge
  // and releases the mouse button outside the Konva stage.
  useEffect(() => {
    if (!draftId) return;
    window.addEventListener('pointerup', finishDraft);
    window.addEventListener('pointercancel', finishDraft);
    return () => {
      window.removeEventListener('pointerup', finishDraft);
      window.removeEventListener('pointercancel', finishDraft);
    };
  }, [draftId, finishDraft]);

  const handlePointerDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const clickedEmpty =
      event.target === event.target.getStage() || event.target.name() === 'backdrop';

    // Transformer anchors live inside the same listening layer as annotations,
    // so their pointerdown bubbles to this Stage handler too. A drawing tool
    // must never interpret that UI gesture as the start of another shape.
    if (isTransformerTarget(event.target)) {
      event.cancelBubble = true;
      return;
    }

    // A click that ends text editing only dismisses the editor. The stage
    // handler runs before the editor's own document listener, so without this
    // the same press would also start a second text box wherever it landed,
    // which reads as the one being edited jumping to the pointer.
    if (editingTextId) return;

    if (activeTool === 'select') {
      if (clickedEmpty) setSelection([]);
      return;
    }

    // A drawing tool draws wherever it is pointed, including on top of an
    // existing annotation: layering a label over a highlighted box is the
    // common case, and refusing it leaves no way to annotate a busy capture.
    // Reaching for a shape underneath is what the select tool is for.
    const position = getPointerPosition();
    if (!position) return;

    const annotation = createAnnotation(activeTool, position, draftStyle, annotations);
    if (!annotation) return;

    addAnnotation(annotation);

    // Text is created at full size and goes straight to editing.
    if (annotation.type === 'text') {
      // Suppress the default pointer behaviour, which moves focus to the
      // stage container. Without this the textarea is focused on mount and
      // then immediately loses it, so the box needs a second click before it
      // accepts input.
      event.evt.preventDefault();
      setEditingTextId(annotation.id);
    } else if (annotation.type !== 'counter') {
      draftIdRef.current = annotation.id;
      setDraftId(annotation.id);
    }
  };

  const handlePointerMove = (event: Konva.KonvaEventObject<PointerEvent>) => {
    // Signal draggability on hover: a crosshair over a movable shape reads as
    // "this will draw", which is the opposite of what a click does there.
    // With a drawing tool active the press does draw, so the crosshair stays.
    const overShape =
      event.target !== event.target.getStage() && event.target.name() !== 'backdrop';
    setHoveringShape(overShape && !draftIdRef.current && !isDrawingToolActive);

    const activeDraftId = draftIdRef.current;
    if (!activeDraftId) return;

    const position = getPointerPosition();
    if (!position) return;

    const draft = annotations.find((item) => item.id === activeDraftId);
    if (!draft) return;

    const patch = extendAnnotation(draft, position);
    if (patch) updateTransient(activeDraftId, patch);
  };

  const handlePointerUp = () => {
    finishDraft();
  };

  /**
   * Selecting an existing annotation works with any tool active.
   *
   * The active tool governs what a click on empty canvas does, not what
   * happens on top of something already drawn — clicking a shape to grab it
   * is what every editor does, and requiring a trip to the select tool first
   * makes repositioning feel broken.
   */
  const handleSelect = useCallback(
    (id: string, additive: boolean) => {
      setSelection(additive ? [...new Set([...selectedIds, id])] : [id]);
    },
    [selectedIds, setSelection],
  );

  const editingAnnotation = annotations.find(
    (item): item is Extract<Annotation, { type: 'text' }> =>
      item.id === editingTextId && item.type === 'text',
  );

  return (
    <div
      className="absolute"
      style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
    >
      <Stage
        ref={stageRef}
        width={bounds.width}
        height={bounds.height}
        // Render at physical resolution so annotations stay crisp on a
        // scaled display and export at full capture quality.
        scaleX={1 / pixelRatio}
        scaleY={1 / pixelRatio}
        // Konva defaults to 0, which makes a plain click a complete drag: a
        // click landing inside the transformer's box would teleport the
        // selected shape to the pointer. Requiring real movement keeps a
        // click a click, so clicking away only clears the selection.
        dragDistance={DRAG_THRESHOLD_PX}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ cursor: hoveringShape ? 'move' : activeTool === 'select' ? 'default' : 'crosshair' }}
      >
        <Layer listening={false}>
          <KonvaImage image={image} width={image.width} height={image.height} />
        </Layer>

        <SpotlightMask annotations={annotations} width={image.width} height={image.height} />

        <Layer>
          {annotations.map((annotation) =>
            // Blur needs the source image to filter real pixels, so it takes
            // a dedicated component rather than the generic shape switch.
            annotation.type === 'blur' ? (
              <BlurRegion
                key={annotation.id}
                annotation={annotation}
                image={image}
                isDraggable
                isDrawingToolActive={isDrawingToolActive}
                onSelect={handleSelect}
                onChange={updateTransient}
                onCommit={commitTransient}
                onBeginGesture={beginTransient}
              />
            ) : (
              <AnnotationShape
                key={annotation.id}
                annotation={annotation}
                isDraggable
                isDrawingToolActive={isDrawingToolActive}
                onSelect={handleSelect}
                onChange={updateTransient}
                onCommit={commitTransient}
                onBeginGesture={beginTransient}
                onEditText={setEditingTextId}
                activeAnchorRef={activeAnchorRef}
                isEditingText={annotation.id === editingTextId}
                textDraft={annotation.id === editingTextId ? editingTextDraft : null}
                textDraftWidth={annotation.id === editingTextId ? editingTextWidth : null}
                textDraftHeight={annotation.id === editingTextId ? editingTextHeight : null}
              />
            ),
          )}

          <Transformer
            ref={transformerRef}
            name={TRANSFORMER_NAME}
            // Rotated text is nearly always accidental in a screenshot, and a
            // tilted label is harder to read than the thing it annotates.
            rotateEnabled={!selectedIsText}
            // Konva applies this only to corner drags; the explicitly enabled
            // middle handles still resize text width freely. Keeping corner
            // proportions here avoids stretched glyphs without rewriting font
            // geometry on every pointer frame (which made anchors jump).
            keepRatio={Boolean(selectedIsText)}
            // Recorded on start and deliberately not cleared on end: Konva
            // fires transformend on both the transformer and the node without
            // a guaranteed order, so clearing here could blank the value
            // before the shape's own handler reads it.
            onTransformStart={() => {
              activeAnchorRef.current = transformerRef.current?.getActiveAnchor() ?? null;
            }}
            // Text scales its glyphs from the corners and reflows from the
            // sides. Vertical anchors are left out for text specifically:
            // its height follows the line count, so dragging top or bottom
            // has nothing meaningful to change.
            enabledAnchors={
              selectedIsText
                ? [
                    'top-left',
                    'top-right',
                    'bottom-left',
                    'bottom-right',
                    'middle-left',
                    'middle-right',
                  ]
                : undefined
            }
            borderStroke="#6366f1"
            borderStrokeWidth={1.5}
            anchorStroke="#6366f1"
            anchorFill="#ffffff"
            anchorSize={9}
            anchorCornerRadius={4}
            // Prevent inverted or degenerate shapes from a fast drag.
            boundBoxFunc={(oldBox, newBox) =>
              newBox.width < 8 || newBox.height < 8 ? oldBox : newBox
            }
          />
        </Layer>
      </Stage>

      {editingAnnotation && (
        <TextEditorOverlay
          annotation={editingAnnotation}
          scale={1 / pixelRatio}
          stageElement={stageContainer}
          onDraftChange={handleEditingDraftChange}
          onClose={closeTextEditor}
        />
      )}
    </div>
  );
}
