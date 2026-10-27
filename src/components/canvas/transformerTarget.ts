import Konva from 'konva';

/** Node name shared by the selection transformer and interaction guards. */
export const TRANSFORMER_NAME = 'selection-transformer';

/**
 * True for the transformer itself and for its generated border/anchor nodes.
 *
 * Konva bubbles an anchor press to the Stage with the anchor as `target`, so
 * checking only the target's own name misses the resize handles.
 */
export function isTransformerTarget(target: Konva.Node): boolean {
  return Boolean(target.findAncestor(`.${TRANSFORMER_NAME}`, true));
}
