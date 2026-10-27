import { describe, expect, it } from 'vitest';
import { textBoxBorderWidth, textBoxCornerRadius, textPadding } from './textBoxGeometry';

describe('text box geometry', () => {
  it('scales border and radius with the font', () => {
    expect(textBoxBorderWidth(24)).toBe(2);
    expect(textBoxBorderWidth(96)).toBe(3);
    expect(textBoxCornerRadius(24)).toBeCloseTo(7.92, 2);
    expect(textBoxCornerRadius(96)).toBeCloseTo(11.84, 2);
    expect(textPadding(24)).toBe(6);
  });

  it('keeps dimensions within practical limits', () => {
    expect(textBoxBorderWidth(4)).toBe(1.5);
    expect(textBoxBorderWidth(1000)).toBe(4);
    expect(textBoxCornerRadius(1000)).toBe(18);
    expect(textPadding(4)).toBe(2);
    expect(textPadding(200)).toBe(24);
  });
});
