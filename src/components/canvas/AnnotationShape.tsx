/**
 * Renders one annotation as its Konva node.
 *
 * Split from the canvas so the shape-type switch stays in one place and the
 * canvas can focus on interaction. Every node reports transforms back through
 * `onChange` in absolute terms, since Konva applies scale rather than mutating
 * width/height during a resize.
 */

import { memo } from 'react';
import { Arrow, Circle, Ellipse, Group, Label, Line, Rect, Tag, Text } from 'react-konva';
import Konva from 'konva';
import {
  Annotation,
  LineStyle,
  TEXT_LINE_HEIGHT,
} from '../../types/annotations';
import {
  measureAutoTextWidth,
  textBoxBorderWidth,
  textBoxCornerRadius,
  textPadding,
} from './textBoxGeometry';

interface AnnotationShapeProps {
  annotation: Annotation;
  isDraggable: boolean;
  /**
   * True while a drawing tool is active, meaning a press on this shape is
   * aimed at the canvas above it rather than at the shape itself.
   */
  isDrawingToolActive: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (id: string, patch: Partial<Annotation>) => void;
  onCommit: () => void;
  /** Called when a drag or transform starts, to open one undo step. */
  onBeginGesture: () => void;
  onEditText: (id: string) => void;
  isEditingText?: boolean;
  textDraft?: string | null;
  textDraftWidth?: number | null;
  textDraftHeight?: number | null;
  /**
   * Anchor the transformer is currently dragging, read by text to tell a
   * reflow (side anchors) from a glyph scale (corner anchors).
   */
  activeAnchorRef?: React.RefObject<string | null>;
}

/** Konva expects a dash array; derive it from the semantic line style. */
function dashFor(style: LineStyle, strokeWidth: number): number[] | undefined {
  if (style === 'dashed') return [strokeWidth * 3, strokeWidth * 2];
  if (style === 'dotted') return [0.1, strokeWidth * 2];
  return undefined;
}

export const AnnotationShape = memo(function AnnotationShape({
  annotation,
  isDraggable,
  isDrawingToolActive,
  onSelect,
  onChange,
  onCommit,
  onBeginGesture,
  onEditText,
  isEditingText = false,
  textDraft,
  textDraftWidth,
  textDraftHeight,
  activeAnchorRef,
}: AnnotationShapeProps) {
  if (!annotation.visible) return null;

  const { style } = annotation;
  const dash = dashFor(style.lineStyle, style.strokeWidth);

  const textShadowProps = style.shadow
    ? {
        shadowColor: '#000000',
        shadowBlur: 12,
        shadowOpacity: 0.65,
        shadowOffsetX: 0,
        shadowOffsetY: 3,
      }
    : {};

  const commonProps = {
    id: annotation.id,
    x: annotation.x,
    y: annotation.y,
    rotation: annotation.rotation,
    opacity: style.opacity,
    // A drawing tool takes precedence over dragging: otherwise pressing on an
    // existing shape to draw over it would move that shape instead.
    draggable: isDraggable && !annotation.locked && !isDrawingToolActive,
    onMouseDown: (event: Konva.KonvaEventObject<MouseEvent>) => {
      if (annotation.locked) return;
      // With a drawing tool active the press belongs to the canvas, so let it
      // bubble to the stage and start a new shape on top of this one.
      if (isDrawingToolActive) return;
      // Stop the stage handler from starting a new shape on top of this one.
      event.cancelBubble = true;
      onSelect(annotation.id, event.evt.shiftKey);
    },
    onDragStart: (event: Konva.KonvaEventObject<DragEvent>) => {
      event.cancelBubble = true;
      // Capture the pre-drag scene so the whole move is one undo step.
      onBeginGesture();
    },
    onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => {
      // Konva moves the node itself during a drag. Without mirroring that into
      // state, the next React render would snap it back to its old position.
      onChange(annotation.id, { x: event.target.x(), y: event.target.y() });
    },
    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => {
      onChange(annotation.id, { x: event.target.x(), y: event.target.y() });
      // Only the end of the gesture is an undo step; the moves are transient.
      onCommit();
    },
    // Resizing opens the same kind of undo step as dragging. Declared here so
    // every shape gets it, rather than repeating it per transform handler.
    onTransformStart: () => onBeginGesture(),
  };

  const syncPointScale = (node: Konva.Line) => {
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.points(
      node.points().map((coordinate, index) => coordinate * (index % 2 === 0 ? scaleX : scaleY)),
    );
    node.scaleX(1);
    node.scaleY(1);
  };

  const commitPointTransform = (node: Konva.Line) => {
    syncPointScale(node);
    onChange(annotation.id, {
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      points: node.points(),
    } as Partial<Annotation>);
    onCommit();
  };

  switch (annotation.type) {
    case 'rect':
    case 'highlight': {
      // Highlight mimics a marker pen: filled, no stroke, multiply blending.
      const isHighlight = annotation.type === 'highlight';
      const syncSize = (node: Konva.Rect) => {
        node.width(Math.max(4, node.width() * node.scaleX()));
        node.height(Math.max(4, node.height() * node.scaleY()));
        node.scaleX(1);
        node.scaleY(1);
      };

      return (
        <Rect
          {...commonProps}
          width={annotation.width}
          height={annotation.height}
          cornerRadius={style.cornerRadius}
          fill={
            isHighlight
              ? style.fillColor === 'transparent'
                ? style.strokeColor
                : style.fillColor
              : style.fillColor === 'transparent'
                ? undefined
                : style.fillColor
          }
          stroke={isHighlight ? undefined : style.strokeColor}
          strokeWidth={isHighlight ? 0 : style.strokeWidth}
          dash={dash}
          globalCompositeOperation={isHighlight ? 'multiply' : undefined}
          onTransform={(event) => syncSize(event.target as Konva.Rect)}
          onTransformEnd={(event) => {
            const node = event.target as Konva.Rect;
            syncSize(node);
            onChange(annotation.id, {
              x: node.x(),
              y: node.y(),
              rotation: node.rotation(),
              width: node.width(),
              height: node.height(),
            } as Partial<Annotation>);
            onCommit();
          }}
        />
      );
    }

    case 'ellipse': {
      const syncSize = (node: Konva.Ellipse) => {
        node.radiusX(Math.max(2, node.radiusX() * node.scaleX()));
        node.radiusY(Math.max(2, node.radiusY() * node.scaleY()));
        node.scaleX(1);
        node.scaleY(1);
        // This ellipse models x/y as its top-left corner, so its offset must
        // follow the radii while the geometry changes.
        node.offsetX(-node.radiusX());
        node.offsetY(-node.radiusY());
      };

      return (
        <Ellipse
          {...commonProps}
          radiusX={annotation.width / 2}
          radiusY={annotation.height / 2}
          offsetX={-annotation.width / 2}
          offsetY={-annotation.height / 2}
          fill={style.fillColor === 'transparent' ? undefined : style.fillColor}
          stroke={style.strokeColor}
          strokeWidth={style.strokeWidth}
          dash={dash}
          onTransform={(event) => syncSize(event.target as Konva.Ellipse)}
          onTransformEnd={(event) => {
            const node = event.target as Konva.Ellipse;
            syncSize(node);
            onChange(annotation.id, {
              x: node.x(),
              y: node.y(),
              rotation: node.rotation(),
              width: node.radiusX() * 2,
              height: node.radiusY() * 2,
            } as Partial<Annotation>);
            onCommit();
          }}
        />
      );
    }

    case 'arrow':
      return (
        <Arrow
          {...commonProps}
          points={annotation.points}
          stroke={style.strokeColor}
          fill={style.strokeColor}
          strokeWidth={style.strokeWidth}
          pointerLength={Math.max(12, style.strokeWidth * 4)}
          pointerWidth={Math.max(12, style.strokeWidth * 4)}
          pointerAtBeginning={style.arrowHead === 'both'}
          pointerAtEnding={style.arrowHead !== 'none'}
          dash={dash}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={Math.max(20, style.strokeWidth * 3)}
          onTransform={(event) => syncPointScale(event.target as Konva.Arrow)}
          onTransformEnd={(event) => commitPointTransform(event.target as Konva.Arrow)}
        />
      );

    case 'line':
      return (
        <Line
          {...commonProps}
          points={annotation.points}
          stroke={style.strokeColor}
          strokeWidth={style.strokeWidth}
          dash={dash}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={Math.max(20, style.strokeWidth * 3)}
          onTransform={(event) => syncPointScale(event.target as Konva.Line)}
          onTransformEnd={(event) => commitPointTransform(event.target as Konva.Line)}
        />
      );

    case 'pen':
      return (
        <Line
          {...commonProps}
          points={annotation.points}
          stroke={style.strokeColor}
          strokeWidth={style.strokeWidth}
          lineCap="round"
          lineJoin="round"
          tension={0.4}
          hitStrokeWidth={Math.max(20, style.strokeWidth * 3)}
          onTransform={(event) => syncPointScale(event.target as Konva.Line)}
          onTransformEnd={(event) => commitPointTransform(event.target as Konva.Line)}
        />
      );

    case 'text':
      const renderedText = isEditingText ? textDraft ?? annotation.text : annotation.text;
      const padding = textPadding(style.fontSize);
      const minTextHeight = style.fontSize * TEXT_LINE_HEIGHT + padding * 2;
      const renderedWidth = isEditingText
        ? (textDraftWidth ?? annotation.width)
        : annotation.autoWidth
          ? measureAutoTextWidth(renderedText, style)
          : annotation.width;
      const renderedHeight = isEditingText
        ? Math.max(minTextHeight, textDraftHeight ?? minTextHeight)
        : renderedText.length === 0
          ? minTextHeight
          : undefined;

      return (
        <Label
          {...commonProps}
          opacity={isEditingText ? 0 : style.opacity}
          onDblClick={() => onEditText(annotation.id)}
          // Side anchors change the layout width immediately, so wrapping is
          // visible during the gesture. Corner scaling stays on the node until
          // pointer-up; the transformer keeps those two axes proportional.
          onTransform={(event) => {
            const anchor = activeAnchorRef?.current;
            const node = event.target as unknown as Konva.Label;
            const isSideAnchor = anchor === 'middle-left' || anchor === 'middle-right';
            if (!isSideAnchor) {
              const uniformScale = Math.max(
                0.01,
                (Math.abs(node.scaleX()) + Math.abs(node.scaleY())) / 2,
              );
              const nextFontSize = style.fontSize * uniformScale;
              const tag = node.findOne<Konva.Tag>('Tag');
              if (tag) {
                tag.strokeWidth(textBoxBorderWidth(nextFontSize));
                tag.cornerRadius(textBoxCornerRadius(nextFontSize) / uniformScale);
              }
              return;
            }

            const text = node.findOne<Konva.Text>('Text');
            if (!text) return;
            text.width(Math.max(40, text.width() * node.scaleX()));
            node.scaleX(1);
            node.scaleY(1);
          }}
          onTransformEnd={(event) => {
            const node = event.target as unknown as Konva.Label;
            const text = node.findOne<Konva.Text>('Text');
            if (!text) {
              onCommit();
              return;
            }
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();

            // Which anchor was dragged decides the intent, rather than
            // comparing float scales: the transformer does not keep ratio on
            // every anchor, so scaleX === scaleY is not a reliable signal.
            // Side anchors reflow the box; corner anchors scale the glyphs.
            const anchor = activeAnchorRef?.current;
            const isSideAnchor = anchor === 'middle-left' || anchor === 'middle-right';

            // Side handles have already folded most deltas into width. Corner
            // handles remain as a stable uniform scale until this point.
            const nodeWidth = text.width();
            const uniformScale = Math.max(
              0.01,
              (Math.abs(scaleX) + Math.abs(scaleY)) / 2,
            );
            const nextFontSize = Math.max(8, style.fontSize * uniformScale);

            if (isSideAnchor) {
              text.width(Math.max(40, text.width() * scaleX));
            }
            node.scaleX(1);
            node.scaleY(1);

            let nextWidth = Math.max(40, isSideAnchor ? text.width() : nodeWidth * uniformScale);
            if (!isSideAnchor) {
              text.fontSize(nextFontSize);
              text.padding(textPadding(nextFontSize));
              if (annotation.autoWidth) {
                const widestLine = Math.max(
                  0,
                  ...annotation.text
                    .split('\n')
                    .map((line) => text.measureSize(line || ' ').width),
                );
                nextWidth = Math.max(40, nextFontSize * 2, Math.ceil(widestLine) + text.padding() * 2 + 3);
              }
              text.width(nextWidth);
              const tag = node.findOne<Konva.Tag>('Tag');
              tag?.strokeWidth(textBoxBorderWidth(nextFontSize));
              tag?.cornerRadius(textBoxCornerRadius(nextFontSize));
            }

            onChange(annotation.id, {
              x: node.x(),
              y: node.y(),
              // Text is never rotated: the transformer hides the rotate
              // handle, and pinning the value here keeps a stale rotation
              // from surviving a later resize.
              rotation: 0,
              width: nextWidth,
              // Dragging a side handle is an explicit width choice, so the box
              // stops tracking its content from then on.
              ...(isSideAnchor
                ? { autoWidth: false }
                : {
                    style: {
                      ...style,
                      fontSize: nextFontSize,
                    },
                  }),
            } as Partial<Annotation>);
            onCommit();
          }}
        >
          {style.textBox && (
            <Tag
              fill={style.fillColor}
              stroke={style.strokeColor}
              strokeWidth={textBoxBorderWidth(style.fontSize)}
              cornerRadius={textBoxCornerRadius(style.fontSize)}
              strokeScaleEnabled={false}
              shadowColor="#000000"
              shadowBlur={10}
              shadowOpacity={0.35}
              shadowOffsetY={3}
            />
          )}
          <Text
            {...textShadowProps}
            text={renderedText}
            // The editor and canvas share one explicit width. Depending on
            // independent auto measurements made the border drift from text.
            width={renderedWidth}
            height={renderedHeight}
            padding={padding}
            fontSize={style.fontSize}
            fontFamily={style.fontFamily}
            fontStyle={`${style.fontStyle === 'italic' ? 'italic ' : ''}${style.fontWeight}`.trim()}
            lineHeight={TEXT_LINE_HEIGHT}
            align={style.textAlign}
            fill={style.strokeColor}
            shadowEnabled={!isEditingText && style.shadow}
          />
        </Label>
      );

    case 'counter': {
      const syncSize = (node: Konva.Group) => {
        const circle = node.findOne<Konva.Circle>('Circle');
        const label = node.findOne<Konva.Text>('Text');
        if (!circle || !label) return;

        const uniformScale = Math.max(0.01, (node.scaleX() + node.scaleY()) / 2);
        const radius = Math.max(8, circle.radius() * uniformScale);
        circle.radius(radius);
        label.fontSize(Math.max(8, label.fontSize() * uniformScale));
        label.width(radius * 2);
        label.height(radius * 2);
        label.offsetX(radius);
        label.offsetY(radius);
        node.scaleX(1);
        node.scaleY(1);
      };

      return (
        <Group
          {...commonProps}
          onTransform={(event) => syncSize(event.target as Konva.Group)}
          onTransformEnd={(event) => {
            const node = event.target as Konva.Group;
            syncSize(node);
            const circle = node.findOne<Konva.Circle>('Circle');
            const label = node.findOne<Konva.Text>('Text');
            if (circle && label) {
              onChange(annotation.id, {
                x: node.x(),
                y: node.y(),
                rotation: node.rotation(),
                radius: circle.radius(),
                style: { ...style, fontSize: Math.round(label.fontSize()) },
              } as Partial<Annotation>);
            }
            onCommit();
          }}
        >
          <Circle
            radius={annotation.radius}
            fill={style.fillColor === 'transparent' ? style.strokeColor : style.fillColor}
            stroke={style.strokeColor}
            strokeWidth={2}
          />
          <Text
            text={String(annotation.value)}
            fontSize={style.fontSize}
            fontFamily={style.fontFamily}
            fontStyle="bold"
            fill="#ffffff"
            align="center"
            verticalAlign="middle"
            width={annotation.radius * 2}
            height={annotation.radius * 2}
            offsetX={annotation.radius}
            offsetY={annotation.radius}
            listening={false}
          />
        </Group>
      );
    }

    default:
      return null;
  }
});
