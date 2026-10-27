import { describe, expect, it } from 'vitest';
import {
  MIN_REGION_SIZE,
  applyHandleDrag,
  clampToViewport,
  handlePosition,
} from './regionResize';

const region = { x: 100, y: 100, width: 400, height: 300 };

describe('applyHandleDrag', () => {
  it('moves only the east edge when dragging the east handle', () => {
    const result = applyHandleDrag('e', region, 700, 999);

    expect(result).toEqual({ x: 100, y: 100, width: 600, height: 300 });
  });

  it('moves only the north edge when dragging the north handle', () => {
    const result = applyHandleDrag('n', region, 999, 50);

    expect(result).toEqual({ x: 100, y: 50, width: 400, height: 350 });
  });

  it('moves both edges for a corner handle', () => {
    const result = applyHandleDrag('nw', region, 50, 60);

    expect(result).toEqual({ x: 50, y: 60, width: 450, height: 340 });
  });

  it('keeps the opposite edge fixed when dragging west', () => {
    const result = applyHandleDrag('w', region, 200, 0);

    // Right edge stays at 500.
    expect(result.x + result.width).toBe(500);
  });

  it('clamps instead of inverting when an edge is dragged past its opposite', () => {
    const result = applyHandleDrag('e', region, 0, 0);

    expect(result.width).toBe(MIN_REGION_SIZE);
    expect(result.x).toBe(100);
  });

  it('clamps a north drag past the bottom edge', () => {
    const result = applyHandleDrag('n', region, 0, 9999);

    expect(result.height).toBe(MIN_REGION_SIZE);
    expect(result.y + result.height).toBe(400);
  });

  it('never produces a negative dimension from an extreme corner drag', () => {
    const result = applyHandleDrag('se', region, -9999, -9999);

    expect(result.width).toBeGreaterThanOrEqual(MIN_REGION_SIZE);
    expect(result.height).toBeGreaterThanOrEqual(MIN_REGION_SIZE);
  });
});

describe('handlePosition', () => {
  it('places the north-west handle on the region origin', () => {
    expect(handlePosition(region, 0, 0)).toEqual({ left: 100, top: 100 });
  });

  it('places the south-east handle on the far corner', () => {
    expect(handlePosition(region, 1, 1)).toEqual({ left: 500, top: 400 });
  });

  it('places edge handles at the midpoint of that edge', () => {
    // The midpoint must follow the region's own size, not the viewport's —
    // this is what a CSS percentage would get wrong.
    expect(handlePosition(region, 0.5, 0)).toEqual({ left: 300, top: 100 });
    expect(handlePosition(region, 1, 0.5)).toEqual({ left: 500, top: 250 });
  });

  it('tracks a region that is not at the origin', () => {
    const offset = { x: 640, y: 480, width: 200, height: 100 };

    expect(handlePosition(offset, 1, 1)).toEqual({ left: 840, top: 580 });
  });
});

describe('clampToViewport', () => {
  it('leaves a region already inside the viewport untouched', () => {
    expect(clampToViewport(region, 1920, 1080)).toEqual(region);
  });

  it('trims a region overflowing the right edge', () => {
    const result = clampToViewport({ x: 1800, y: 100, width: 400, height: 200 }, 1920, 1080);

    expect(result.x + result.width).toBeLessThanOrEqual(1920);
  });

  it('pulls a negative origin back to zero', () => {
    const result = clampToViewport({ x: -50, y: -30, width: 200, height: 200 }, 1920, 1080);

    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('keeps at least the minimum size when the viewport is tiny', () => {
    const result = clampToViewport(region, 10, 10);

    expect(result.width).toBeGreaterThanOrEqual(MIN_REGION_SIZE);
    expect(result.height).toBeGreaterThanOrEqual(MIN_REGION_SIZE);
  });
});
