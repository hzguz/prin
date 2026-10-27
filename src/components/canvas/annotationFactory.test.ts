import { describe, expect, it } from 'vitest';
import {
  createAnnotation,
  extendAnnotation,
  finaliseDraft,
  normaliseBounds,
} from './annotationFactory';
import {
  Annotation,
  CounterAnnotation,
  DEFAULT_STYLE,
  LineAnnotation,
  PenAnnotation,
  RectAnnotation,
  TextAnnotation,
} from '../../types/annotations';

const origin = { x: 100, y: 50 };

describe('createAnnotation', () => {
  it('creates drag-sized shapes with zero extent', () => {
    const rect = createAnnotation('rect', origin, DEFAULT_STYLE, []) as RectAnnotation;

    expect(rect.type).toBe('rect');
    expect(rect.x).toBe(100);
    expect(rect.y).toBe(50);
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
  });

  it('copies the draft style so later edits do not mutate existing shapes', () => {
    const rect = createAnnotation('rect', origin, DEFAULT_STYLE, []) as RectAnnotation;
    rect.style.strokeWidth = 99;

    expect(DEFAULT_STYLE.strokeWidth).not.toBe(99);
  });

  it('numbers counters sequentially from the existing highest value', () => {
    const existing = [
      { type: 'counter', value: 1 },
      { type: 'counter', value: 7 },
      { type: 'rect' },
    ] as Annotation[];

    const counter = createAnnotation(
      'counter',
      origin,
      DEFAULT_STYLE,
      existing,
    ) as CounterAnnotation;

    expect(counter.value).toBe(8);
  });

  it('starts counters at 1 when none exist', () => {
    const counter = createAnnotation(
      'counter',
      origin,
      DEFAULT_STYLE,
      [],
    ) as CounterAnnotation;

    expect(counter.value).toBe(1);
  });

  it('returns null for the select tool, which creates nothing', () => {
    expect(createAnnotation('select', origin, DEFAULT_STYLE, [])).toBeNull();
  });

  it('creates text fitted to its content until a side handle is dragged', () => {
    const text = createAnnotation('text', origin, DEFAULT_STYLE, []) as TextAnnotation;

    expect(text.width).toBe(Math.max(40, DEFAULT_STYLE.fontSize * 2));
    expect(text.autoWidth).toBe(true);
  });
});

describe('extendAnnotation', () => {
  it('sizes rectangles relative to their origin', () => {
    const rect = createAnnotation('rect', origin, DEFAULT_STYLE, []) as RectAnnotation;
    const patch = extendAnnotation(rect, { x: 180, y: 90 }) as Partial<RectAnnotation>;

    expect(patch.width).toBe(80);
    expect(patch.height).toBe(40);
  });

  it('produces negative extent when dragging up and to the left', () => {
    const rect = createAnnotation('rect', origin, DEFAULT_STYLE, []) as RectAnnotation;
    const patch = extendAnnotation(rect, { x: 60, y: 20 }) as Partial<RectAnnotation>;

    expect(patch.width).toBe(-40);
    expect(patch.height).toBe(-30);
  });

  it('appends points to a pen stroke in local coordinates', () => {
    const pen = createAnnotation('pen', origin, DEFAULT_STYLE, []) as PenAnnotation;
    const patch = extendAnnotation(pen, { x: 120, y: 70 }) as Partial<PenAnnotation>;

    expect(patch.points).toEqual([0, 0, 20, 20]);
  });

  it('ignores click-placed annotations', () => {
    const counter = createAnnotation('counter', origin, DEFAULT_STYLE, []) as Annotation;

    expect(extendAnnotation(counter, { x: 200, y: 200 })).toBeNull();
  });
});

describe('normaliseBounds', () => {
  it('flips a shape dragged up and to the left into positive extent', () => {
    const rect = {
      ...(createAnnotation('rect', origin, DEFAULT_STYLE, []) as RectAnnotation),
      width: -40,
      height: -30,
    };

    const patch = normaliseBounds(rect) as Partial<RectAnnotation>;

    expect(patch).toEqual({ x: 60, y: 20, width: 40, height: 30 });
  });

  it('leaves an already-positive shape untouched', () => {
    const rect = {
      ...(createAnnotation('rect', origin, DEFAULT_STYLE, []) as RectAnnotation),
      width: 40,
      height: 30,
    };

    expect(normaliseBounds(rect)).toBeNull();
  });

  it('normalises a single inverted axis', () => {
    const rect = {
      ...(createAnnotation('rect', origin, DEFAULT_STYLE, []) as RectAnnotation),
      width: -40,
      height: 30,
    };

    const patch = normaliseBounds(rect) as Partial<RectAnnotation>;

    expect(patch).toEqual({ x: 60, y: 50, width: 40, height: 30 });
  });

  it('ignores annotations without bounds', () => {
    const pen = createAnnotation('pen', origin, DEFAULT_STYLE, []) as Annotation;

    expect(normaliseBounds(pen)).toBeNull();
  });
});

describe('finaliseDraft', () => {
  it('discards accidental zero-size clicks on drag-sized shapes and lines', () => {
    const rect = createAnnotation('rect', origin, DEFAULT_STYLE, []) as RectAnnotation;
    const arrow = createAnnotation('arrow', origin, DEFAULT_STYLE, []) as LineAnnotation;

    expect(finaliseDraft(rect)).toEqual({ action: 'discard' });
    expect(finaliseDraft(arrow)).toEqual({ action: 'discard' });
  });

  it('normalises negative dimensions when keeping a dragged shape', () => {
    const rect = {
      ...(createAnnotation('rect', origin, DEFAULT_STYLE, []) as RectAnnotation),
      width: -30,
      height: -20,
    };

    expect(finaliseDraft(rect)).toEqual({
      action: 'keep',
      patch: { x: 70, y: 30, width: 30, height: 20 },
    });
  });

  it('turns a single-click pen tap into a visible dot and preserves multi-point strokes', () => {
    const tap = createAnnotation('pen', origin, DEFAULT_STYLE, []) as PenAnnotation;
    expect(finaliseDraft(tap)).toEqual({
      action: 'keep',
      patch: { points: [0, 0, 0.5, 0.5] },
    });

    const stroke: PenAnnotation = { ...tap, points: [0, 0, 12, 8, 24, 16] };
    expect(finaliseDraft(stroke)).toEqual({ action: 'keep', patch: null });
  });
});
