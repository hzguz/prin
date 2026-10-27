import { Ellipse, Layer, Rect } from 'react-konva';
import { Annotation, EllipseAnnotation, RectAnnotation } from '../../types/annotations';

type SpotlightAnnotation =
  | EllipseAnnotation
  | (RectAnnotation & { type: 'rect' | 'highlight' });

interface SpotlightMaskProps {
  annotations: Annotation[];
  width: number;
  height: number;
}

/** Closed annotation types that can cut a focus window through the mask. */
export function isSpotlightShape(
  annotation: Annotation,
): annotation is SpotlightAnnotation {
  return (
    (annotation.type === 'rect' ||
      annotation.type === 'ellipse' ||
      annotation.type === 'highlight') &&
    annotation.visible &&
    annotation.style.spotlight &&
    annotation.width !== 0 &&
    annotation.height !== 0
  );
}

/**
 * Darkens the screenshot while punching transparent windows through every
 * shape whose focus mode is active. Keeping all holes on one layer avoids
 * multiple masks darkening one another when several regions are highlighted.
 */
export function SpotlightMask({ annotations, width, height }: SpotlightMaskProps) {
  const shapes = annotations.filter(isSpotlightShape);
  if (shapes.length === 0) return null;

  return (
    <Layer listening={false}>
      <Rect width={width} height={height} fill="rgba(0, 0, 0, 0.62)" />

      {shapes.map((annotation) => {
        const x = annotation.width < 0 ? annotation.x + annotation.width : annotation.x;
        const y = annotation.height < 0 ? annotation.y + annotation.height : annotation.y;
        const shapeWidth = Math.abs(annotation.width);
        const shapeHeight = Math.abs(annotation.height);
        const eraseProps = {
          key: annotation.id,
          fill: '#000000',
          globalCompositeOperation: 'destination-out' as const,
          listening: false,
        };

        if (annotation.type === 'ellipse') {
          return (
            <Ellipse
              {...eraseProps}
              x={x}
              y={y}
              radiusX={shapeWidth / 2}
              radiusY={shapeHeight / 2}
              offsetX={-shapeWidth / 2}
              offsetY={-shapeHeight / 2}
              rotation={annotation.rotation}
            />
          );
        }

        return (
          <Rect
            {...eraseProps}
            x={x}
            y={y}
            width={shapeWidth}
            height={shapeHeight}
            rotation={annotation.rotation}
            cornerRadius={annotation.style.cornerRadius}
          />
        );
      })}
    </Layer>
  );
}
