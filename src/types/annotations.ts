/**
 * Annotation domain model.
 *
 * Annotations are objects, never baked pixels. Everything downstream depends
 * on this: undo/redo, reselecting a shape to restyle it, reordering layers and
 * non-destructive export all require the scene to stay editable data.
 */

export type ToolId =
  | 'select'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'text'
  | 'counter'
  | 'blur'
  | 'highlight';

/** Property keys a tool exposes, driving which controls the panel renders. */
export type StyleProperty =
  | 'strokeColor'
  | 'fillColor'
  | 'strokeWidth'
  | 'opacity'
  | 'fontSize'
  | 'fontFamily'
  | 'fontWeight'
  | 'fontStyle'
  | 'textAlign'
  | 'cornerRadius'
  | 'arrowHead'
  | 'lineStyle'
  | 'blurIntensity'
  | 'spotlight'
  | 'textBox'
  | 'shadow';

export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type ArrowHead = 'none' | 'end' | 'both';
export type TextAlign = 'left' | 'center' | 'right';
export type FontWeight = 'normal' | 'bold';
export type FontStyle = 'normal' | 'italic';

/** Style bag shared by every annotation; tools read only what applies to them. */
export interface AnnotationStyle {
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  opacity: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: FontWeight;
  fontStyle: FontStyle;
  textAlign: TextAlign;
  cornerRadius: number;
  arrowHead: ArrowHead;
  lineStyle: LineStyle;
  blurIntensity: number;
  /** Dims everything outside this closed shape to focus attention inside it. */
  spotlight: boolean;
  /** Draws a rounded high-contrast box behind text labels. */
  textBox: boolean;
  shadow: boolean;
}

interface AnnotationBase {
  id: string;
  type: ToolId;
  x: number;
  y: number;
  rotation: number;
  style: AnnotationStyle;
  /** Locked annotations render but reject selection and transform. */
  locked: boolean;
  visible: boolean;
}

export interface RectAnnotation extends AnnotationBase {
  type: 'rect' | 'blur' | 'highlight';
  width: number;
  height: number;
}

export interface EllipseAnnotation extends AnnotationBase {
  type: 'ellipse';
  width: number;
  height: number;
}

/** Arrows and lines are two-point shapes with coordinates relative to x/y. */
export interface LineAnnotation extends AnnotationBase {
  type: 'arrow' | 'line';
  points: [number, number, number, number];
}

export interface PenAnnotation extends AnnotationBase {
  type: 'pen';
  /** Flat [x0, y0, x1, y1, ...] as required by Konva. */
  points: number[];
}

export interface TextAnnotation extends AnnotationBase {
  type: 'text';
  text: string;
  width: number;
  /**
   * True for labels that should hug their glyphs instead of wrapping.
   *
   * New labels start auto-sized; dragging a side handle turns them into a
   * fixed-width wrapping box.
   */
  autoWidth: boolean;
}

/**
 * Line height shared by the Konva node and the editing textarea.
 *
 * They must agree: Konva defaults to 1 and a textarea to roughly 1.2, so a
 * mismatch makes the text jump and the box change height when editing ends.
 */
export const TEXT_LINE_HEIGHT = 1.2;
/** Breathing room shared by text, its editor and the optional label box. */
export const TEXT_PADDING = 6;

/** Auto-incrementing badge used to walk a reader through a screenshot. */
export interface CounterAnnotation extends AnnotationBase {
  type: 'counter';
  value: number;
  radius: number;
}

export type Annotation =
  | RectAnnotation
  | EllipseAnnotation
  | LineAnnotation
  | PenAnnotation
  | TextAnnotation
  | CounterAnnotation;

/** Which controls each tool surfaces in the properties panel. */
export const TOOL_PROPERTIES: Record<ToolId, StyleProperty[]> = {
  select: [],
  rect: ['strokeColor', 'fillColor', 'strokeWidth', 'lineStyle', 'cornerRadius', 'opacity', 'spotlight'],
  ellipse: ['strokeColor', 'fillColor', 'strokeWidth', 'lineStyle', 'opacity', 'spotlight'],
  arrow: ['strokeColor', 'strokeWidth', 'arrowHead', 'lineStyle', 'opacity'],
  line: ['strokeColor', 'strokeWidth', 'lineStyle', 'opacity'],
  pen: ['strokeColor', 'strokeWidth', 'opacity'],
  text: [
    'strokeColor',
    'fillColor',
    'fontSize',
    'fontFamily',
    'fontWeight',
    'fontStyle',
    'textAlign',
    'opacity',
    'textBox',
    'shadow',
  ],
  counter: ['strokeColor', 'fillColor', 'fontSize', 'opacity'],
  blur: ['blurIntensity', 'cornerRadius'],
  highlight: ['fillColor', 'opacity', 'cornerRadius', 'spotlight'],
};

export const DEFAULT_STYLE: AnnotationStyle = {
  strokeColor: '#ef4444',
  fillColor: 'transparent',
  strokeWidth: 4,
  opacity: 1,
  fontSize: 24,
  fontFamily: 'Arial',
  fontWeight: 'bold',
  fontStyle: 'normal',
  textAlign: 'left',
  cornerRadius: 4,
  arrowHead: 'end',
  lineStyle: 'solid',
  blurIntensity: 12,
  spotlight: false,
  textBox: false,
  shadow: false,
};

export const FONT_FAMILIES = [
  'Arial',
  'Segoe UI',
  'Inter',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Consolas',
] as const;

/** Presets behind the font-size stepper; the value stays freely editable. */
export const FONT_SIZE_PRESETS = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80] as const;

export const STROKE_WIDTH_PRESETS = [1, 2, 3, 4, 6, 8, 12, 16, 24] as const;

export const COLOR_SWATCHES = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ffffff',
  '#94a3b8',
  '#1e293b',
  '#000000',
] as const;
