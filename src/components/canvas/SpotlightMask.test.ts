import { describe, expect, it } from 'vitest';
import { Annotation, DEFAULT_STYLE, RectAnnotation } from '../../types/annotations';
import { isSpotlightShape } from './SpotlightMask';

function makeRect(overrides: Partial<RectAnnotation> = {}): RectAnnotation {
  return {
    id: 'shape',
    type: 'rect',
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    rotation: 0,
    style: { ...DEFAULT_STYLE, spotlight: true },
    locked: false,
    visible: true,
    ...overrides,
  };
}

describe('spotlight mask selection', () => {
  it('accepts visible closed shapes with focus enabled', () => {
    expect(isSpotlightShape(makeRect())).toBe(true);
    expect(isSpotlightShape(makeRect({ type: 'highlight' }))).toBe(true);
  });

  it('accepts signed draft dimensions so the mask previews in every direction', () => {
    expect(isSpotlightShape(makeRect({ width: -100, height: -80 }))).toBe(true);
  });

  it('ignores disabled, invisible and zero-sized shapes', () => {
    expect(
      isSpotlightShape(makeRect({ style: { ...DEFAULT_STYLE, spotlight: false } })),
    ).toBe(false);
    expect(isSpotlightShape(makeRect({ visible: false }))).toBe(false);
    expect(isSpotlightShape(makeRect({ width: 0 }))).toBe(false);
  });

  it('does not turn an open annotation into a mask window', () => {
    const line: Annotation = {
      id: 'line',
      type: 'line',
      x: 0,
      y: 0,
      points: [0, 0, 100, 100],
      rotation: 0,
      style: { ...DEFAULT_STYLE, spotlight: true },
      locked: false,
      visible: true,
    };

    expect(isSpotlightShape(line)).toBe(false);
  });
});
