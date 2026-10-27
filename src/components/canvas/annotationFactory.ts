/**
 * Creation and drag-extension logic for annotations.
 *
 * Isolated from the canvas component so the per-tool geometry rules are
 * testable and the canvas stays focused on interaction plumbing.
 */

import {
  Annotation,
  AnnotationStyle,
  CounterAnnotation,
  ToolId,
} from '../../types/annotations';

interface Point {
  x: number;
  y: number;
}

/** Minimum span, in image pixels, for drag-sized shapes to be retained on release. */
export const MIN_DRAWN_SHAPE_PX = 2;

export type DraftOutcome =
  | { action: 'discard' }
  | { action: 'keep'; patch: Partial<Annotation> | null };

/**
 * Builds a zero-size annotation at the pointer position. The subsequent drag
 * grows it via `extendAnnotation`; text and counters are created final-size
 * because they are click-to-place rather than drag-to-size.
 */
export function createAnnotation(
  tool: ToolId,
  position: Point,
  style: AnnotationStyle,
  existing: Annotation[],
): Annotation | null {
  const annotationStyle = tool === 'text' ? { ...style } : { ...style, shadow: false };
  const base = {
    id: crypto.randomUUID(),
    x: position.x,
    y: position.y,
    rotation: 0,
    style: annotationStyle,
    locked: false,
    visible: true,
  };

  switch (tool) {
    case 'rect':
    case 'blur':
    case 'highlight':
      return { ...base, type: tool, width: 0, height: 0 };

    case 'ellipse':
      return { ...base, type: 'ellipse', width: 0, height: 0 };

    case 'arrow':
    case 'line':
      return { ...base, type: tool, points: [0, 0, 0, 0] };

    case 'pen':
      return { ...base, type: 'pen', points: [0, 0] };

    case 'text':
      // Labels begin fitted to their glyphs. Dragging a side handle is the
      // explicit action that turns one into a fixed-width, wrapping box.
      return {
        ...base,
        type: 'text',
        text: '',
        width: Math.max(40, style.fontSize * 2),
        autoWidth: true,
      };

    case 'counter':
      return {
        ...base,
        type: 'counter',
        value: nextCounterValue(existing),
        radius: Math.max(16, style.fontSize),
      };

    default:
      return null;
  }
}

/** Counters auto-increment so a walkthrough numbers itself. */
function nextCounterValue(existing: Annotation[]): number {
  const counters = existing.filter(
    (item): item is CounterAnnotation => item.type === 'counter',
  );
  return counters.reduce((highest, item) => Math.max(highest, item.value), 0) + 1;
}

/**
 * Returns the patch that grows an in-progress annotation toward the pointer.
 * Null means the annotation type does not respond to dragging.
 */
export function extendAnnotation(
  annotation: Annotation,
  position: Point,
): Partial<Annotation> | null {
  switch (annotation.type) {
    case 'rect':
    case 'blur':
    case 'highlight':
    case 'ellipse':
      return {
        width: position.x - annotation.x,
        height: position.y - annotation.y,
      } as Partial<Annotation>;

    case 'arrow':
    case 'line':
      return {
        points: [0, 0, position.x - annotation.x, position.y - annotation.y],
      } as Partial<Annotation>;

    case 'pen':
      return {
        points: [...annotation.points, position.x - annotation.x, position.y - annotation.y],
      } as Partial<Annotation>;

    default:
      return null;
  }
}

/**
 * Normalises a shape dragged right-to-left or bottom-to-top into positive
 * width/height, which keeps transformer anchors and hit testing correct.
 */
export function normaliseBounds(annotation: Annotation): Partial<Annotation> | null {
  if (!('width' in annotation) || !('height' in annotation)) return null;
  if (annotation.width >= 0 && annotation.height >= 0) return null;

  return {
    x: annotation.width < 0 ? annotation.x + annotation.width : annotation.x,
    y: annotation.height < 0 ? annotation.y + annotation.height : annotation.y,
    width: Math.abs(annotation.width),
    height: Math.abs(annotation.height),
  } as Partial<Annotation>;
}

/**
 * Evaluates a completed draft on pointer release: discards accidental
 * zero-size clicks on drag-sized shapes, normalises inverted rectangles, and
 * turns a single pen tap into a visible dot.
 */
export function finaliseDraft(annotation: Annotation): DraftOutcome {
  if (
    annotation.type === 'rect' ||
    annotation.type === 'ellipse' ||
    annotation.type === 'blur' ||
    annotation.type === 'highlight'
  ) {
    if (
      Math.abs(annotation.width) < MIN_DRAWN_SHAPE_PX &&
      Math.abs(annotation.height) < MIN_DRAWN_SHAPE_PX
    ) {
      return { action: 'discard' };
    }
    return { action: 'keep', patch: normaliseBounds(annotation) };
  }

  if (annotation.type === 'arrow' || annotation.type === 'line') {
    const length = Math.hypot(
      annotation.points[2] - annotation.points[0],
      annotation.points[3] - annotation.points[1],
    );
    if (length < MIN_DRAWN_SHAPE_PX) {
      return { action: 'discard' };
    }
    return { action: 'keep', patch: null };
  }

  if (annotation.type === 'pen' && annotation.points.length <= 2) {
    return {
      action: 'keep',
      patch: { points: [0, 0, 0.5, 0.5] } as Partial<Annotation>,
    };
  }

  return { action: 'keep', patch: null };
}
