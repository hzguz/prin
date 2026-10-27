/**
 * Geometry for adjusting the capture region after the initial drag.
 *
 * Pure functions, separated from the handle component so the edge cases —
 * dragging an edge past its opposite, clamping to a minimum — are testable.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Smallest region the user can shrink to, in CSS pixels. */
export const MIN_REGION_SIZE = 16;

/**
 * Applies a handle drag to a region.
 *
 * Works in edge coordinates rather than x/width, because each handle moves
 * one or two independent edges; deriving the box afterwards keeps every
 * handle on the same code path.
 */
export function applyHandleDrag(
  handle: HandleId,
  origin: Rect,
  pointerX: number,
  pointerY: number,
): Rect {
  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.width;
  let bottom = origin.y + origin.height;

  // Clamping against the opposing edge stops a drag past it from inverting
  // the region, which would otherwise produce a negative width.
  if (handle.includes('w')) left = Math.min(pointerX, right - MIN_REGION_SIZE);
  if (handle.includes('e')) right = Math.max(pointerX, left + MIN_REGION_SIZE);
  if (handle.includes('n')) top = Math.min(pointerY, bottom - MIN_REGION_SIZE);
  if (handle.includes('s')) bottom = Math.max(pointerY, top + MIN_REGION_SIZE);

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Screen position of a handle placed at the given fractions of the region.
 *
 * Resolved in pixels rather than CSS percentages: a percentage in `left`
 * resolves against the positioned ancestor — the full-screen overlay — not
 * against the selection, which puts every handle in the wrong place.
 */
export function handlePosition(
  region: Rect,
  fractionX: number,
  fractionY: number,
): { left: number; top: number } {
  return {
    left: region.x + region.width * fractionX,
    top: region.y + region.height * fractionY,
  };
}

/** Clamps a region to the viewport so it cannot be dragged off screen. */
export function clampToViewport(region: Rect, viewportWidth: number, viewportHeight: number): Rect {
  const left = Math.max(0, Math.min(region.x, viewportWidth - MIN_REGION_SIZE));
  const top = Math.max(0, Math.min(region.y, viewportHeight - MIN_REGION_SIZE));
  const right = Math.min(viewportWidth, left + region.width);
  const bottom = Math.min(viewportHeight, top + region.height);

  return {
    x: left,
    y: top,
    width: Math.max(MIN_REGION_SIZE, right - left),
    height: Math.max(MIN_REGION_SIZE, bottom - top),
  };
}
