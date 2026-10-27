/**
 * Resize handles for the capture region itself, active after the initial drag.
 *
 * These live in DOM rather than on the Konva stage because they adjust the
 * crop — the stage's own transformer edits annotations *inside* the crop, and
 * mixing the two would make it ambiguous what a handle grabs.
 */

import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import {
  HandleId,
  Rect,
  applyHandleDrag,
  clampToViewport,
  handlePosition,
} from '../../lib/regionResize';

interface HandleSpec {
  id: HandleId;
  /**
   * Position along each axis as a fraction of the region: 0 = start edge,
   * 0.5 = midpoint, 1 = end edge. Resolved into pixels against the region
   * itself — a CSS percentage here would resolve against the positioned
   * ancestor, which is the full-screen overlay, not the selection.
   */
  fractionX: number;
  fractionY: number;
  cursor: string;
}

const HANDLES: HandleSpec[] = [
  { id: 'nw', fractionX: 0, fractionY: 0, cursor: 'nwse-resize' },
  { id: 'n', fractionX: 0.5, fractionY: 0, cursor: 'ns-resize' },
  { id: 'ne', fractionX: 1, fractionY: 0, cursor: 'nesw-resize' },
  { id: 'e', fractionX: 1, fractionY: 0.5, cursor: 'ew-resize' },
  { id: 'se', fractionX: 1, fractionY: 1, cursor: 'nwse-resize' },
  { id: 's', fractionX: 0.5, fractionY: 1, cursor: 'ns-resize' },
  { id: 'sw', fractionX: 0, fractionY: 1, cursor: 'nesw-resize' },
  { id: 'w', fractionX: 0, fractionY: 0.5, cursor: 'ew-resize' },
];

interface RegionHandlesProps {
  region: Rect;
  /** Fires continuously while dragging, so the crop preview tracks. */
  onResize: (region: Rect) => void;
  /** Fires once the gesture ends, to recrop at the final size. */
  onResizeEnd: () => void;
}

export function RegionHandles({ region, onResize, onResizeEnd }: RegionHandlesProps) {
  // Held in a ref so the pointer listeners stay stable for the whole gesture.
  const gestureRef = useRef<{ handle: HandleId; origin: Rect } | null>(null);
  const t = useI18n((state) => state.t);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      event.preventDefault();

      const resized = applyHandleDrag(
        gesture.handle,
        gesture.origin,
        event.clientX,
        event.clientY,
      );
      // The capture only covers the screen, so a region dragged beyond it
      // would crop empty pixels.
      onResize(clampToViewport(resized, window.innerWidth, window.innerHeight));
    };

    const handlePointerUp = () => {
      if (!gestureRef.current) return;
      gestureRef.current = null;
      onResizeEnd();
    };

    // Bound to the window, not the handle: a fast drag outstrips the pointer
    // and would otherwise strand the gesture when it leaves the 12px target.
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [onResize, onResizeEnd]);

  return (
    <>
      {HANDLES.map((handle) => (
        <button
          key={handle.id}
          type="button"
          aria-label={t.overlay.adjustBorder(handle.id)}
          onPointerDown={(event) => {
            // Stop the overlay from reading this as the start of a new
            // selection, and the canvas from treating it as a draw.
            event.stopPropagation();
            event.preventDefault();
            gestureRef.current = { handle: handle.id, origin: region };
          }}
          style={{
            ...handlePosition(region, handle.fractionX, handle.fractionY),
            cursor: handle.cursor,
          }}
          className="absolute z-30 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow-md transition hover:scale-125"
        />
      ))}
    </>
  );
}
