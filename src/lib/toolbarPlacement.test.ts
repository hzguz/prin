import { describe, expect, it } from 'vitest';
import {
  TOOLBAR_GAP,
  TOOLBAR_HEIGHT,
  TOOLBAR_WIDTH,
  computeToolbarPosition,
} from './toolbarPlacement';

const viewport = { width: 1920, height: 1080 };

describe('computeToolbarPosition', () => {
  it('places the toolbar below a selection with room to spare', () => {
    const placement = computeToolbarPosition(
      { x: 400, y: 200, width: 600, height: 400 },
      viewport,
    );

    expect(placement.y).toBe(200 + 400 + TOOLBAR_GAP);
    expect(placement.x).toBe(400);
    expect(placement.flipped).toBe(false);
    expect(placement.mode).toBe('below');
  });

  it('still prefers below when the measured toolbar height fits there', () => {
    const placement = computeToolbarPosition(
      { x: 400, y: 950, width: 600, height: 50 },
      viewport,
      { width: TOOLBAR_WIDTH, height: 50 },
    );

    expect(placement.y).toBe(950 + 50 + TOOLBAR_GAP);
    expect(placement.mode).toBe('below');
  });

  it('flips above when the selection reaches the bottom edge and below does not fit', () => {
    const placement = computeToolbarPosition(
      { x: 400, y: 1000, width: 600, height: 60 },
      viewport,
    );

    expect(placement.flipped).toBe(true);
    expect(placement.mode).toBe('above');
    expect(placement.y).toBe(1000 - TOOLBAR_HEIGHT - TOOLBAR_GAP);
  });

  it('docks to the viewport bottom when the selection leaves no vertical room', () => {
    const placement = computeToolbarPosition({ x: 0, y: 0, width: 1920, height: 1080 }, viewport);

    expect(placement.flipped).toBe(false);
    expect(placement.mode).toBe('viewport-bottom');
    expect(placement.x).toBe((viewport.width - TOOLBAR_WIDTH) / 2);
    expect(placement.y).toBe(viewport.height - TOOLBAR_HEIGHT - TOOLBAR_GAP);
  });

  it('clamps horizontally so the toolbar stays on screen at the right edge', () => {
    const placement = computeToolbarPosition(
      { x: 1800, y: 200, width: 100, height: 200 },
      viewport,
    );

    expect(placement.x).toBe(viewport.width - TOOLBAR_WIDTH - TOOLBAR_GAP);
    expect(placement.x + TOOLBAR_WIDTH).toBeLessThanOrEqual(viewport.width);
  });

  it('keeps a minimum margin at the left edge', () => {
    const placement = computeToolbarPosition({ x: 0, y: 200, width: 300, height: 200 }, viewport);

    expect(placement.x).toBe(TOOLBAR_GAP);
  });

  it('falls back to the gap when the viewport is narrower than the toolbar', () => {
    const placement = computeToolbarPosition(
      { x: 100, y: 100, width: 200, height: 100 },
      { width: 400, height: 800 },
    );

    expect(placement.x).toBe(TOOLBAR_GAP);
  });

  it('never returns a negative coordinate', () => {
    const placement = computeToolbarPosition({ x: 0, y: 0, width: 10, height: 10 }, viewport);

    expect(placement.x).toBeGreaterThanOrEqual(0);
    expect(placement.y).toBeGreaterThanOrEqual(0);
  });
});
