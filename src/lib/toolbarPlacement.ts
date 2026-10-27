/**
 * Placement of the floating toolbar relative to the selection.
 *
 * Pure geometry, kept out of the component so the edge cases — selection at
 * the bottom of the screen, selection wider than the viewport, selection
 * hugging the right edge — are testable.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Placement {
  x: number;
  y: number;
  /** True when the toolbar had to flip above the selection. */
  flipped: boolean;
  /** Where the toolbar was placed relative to the selection. */
  mode: 'below' | 'above' | 'viewport-bottom';
}

/** Gap between the selection edge and the toolbar. */
export const TOOLBAR_GAP = 10;

/**
 * Fallback height used until the DOM can report the toolbar's real size.
 */
export const TOOLBAR_HEIGHT = 96;

/** Approximate width of the toolbar at its widest, matching its max-width. */
export const TOOLBAR_WIDTH = 720;

export interface ToolbarSize {
  width: number;
  height: number;
}

/**
 * Places the toolbar below the selection whenever the real toolbar height
 * allows it, flips above only when needed, and falls back to a straight
 * viewport-bottom bar when the selection leaves no vertical room either way.
 */
export function computeToolbarPosition(
  selection: Rect,
  viewport: Viewport,
  toolbar: ToolbarSize = { width: TOOLBAR_WIDTH, height: TOOLBAR_HEIGHT },
): Placement {
  const toolbarWidth = Math.min(toolbar.width, Math.max(0, viewport.width - TOOLBAR_GAP * 2));
  const toolbarHeight = Math.min(toolbar.height, Math.max(0, viewport.height - TOOLBAR_GAP * 2));

  const belowY = selection.y + selection.height + TOOLBAR_GAP;
  const fitsBelow = belowY + toolbarHeight <= viewport.height - TOOLBAR_GAP;

  const aboveY = selection.y - toolbarHeight - TOOLBAR_GAP;
  const fitsAbove = aboveY >= TOOLBAR_GAP;

  const maxX = Math.max(TOOLBAR_GAP, viewport.width - toolbarWidth - TOOLBAR_GAP);

  if (fitsBelow) {
    return { x: clamp(selection.x, TOOLBAR_GAP, maxX), y: belowY, flipped: false, mode: 'below' };
  }

  if (fitsAbove) {
    return { x: clamp(selection.x, TOOLBAR_GAP, maxX), y: aboveY, flipped: true, mode: 'above' };
  }

  return {
    x: clamp(selection.x + selection.width / 2 - toolbarWidth / 2, TOOLBAR_GAP, maxX),
    y: Math.max(TOOLBAR_GAP, viewport.height - toolbarHeight - TOOLBAR_GAP),
    flipped: false,
    mode: 'viewport-bottom',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
