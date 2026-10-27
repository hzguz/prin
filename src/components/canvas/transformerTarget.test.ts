import { describe, expect, it } from 'vitest';
import Konva from 'konva';
import { isTransformerTarget, TRANSFORMER_NAME } from './transformerTarget';

describe('transformer interaction target', () => {
  it('recognises the transformer and its generated resize anchors', () => {
    const transformer = new Konva.Transformer({ name: TRANSFORMER_NAME });
    const anchor = transformer.findOne('.top-left');

    expect(anchor).toBeTruthy();
    expect(isTransformerTarget(transformer)).toBe(true);
    expect(isTransformerTarget(anchor!)).toBe(true);
  });

  it('does not classify an annotation as transformer chrome', () => {
    expect(isTransformerTarget(new Konva.Rect())).toBe(false);
  });
});
