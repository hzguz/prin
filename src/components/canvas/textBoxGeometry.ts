import { AnnotationStyle } from '../../types/annotations';

/** Box dimensions track typography gently without exploding on large scales. */
export function textBoxBorderWidth(fontSize: number): number {
  return Math.min(4, Math.max(1.5, 1 + Math.sqrt(fontSize / 24)));
}

export function textBoxCornerRadius(fontSize: number): number {
  return Math.min(18, Math.max(4, 4 + Math.sqrt(fontSize) * 0.8));
}

export function textPadding(fontSize: number): number {
  return Math.min(24, Math.max(2, fontSize / 4));
}

let measurementCanvas: HTMLCanvasElement | null = null;

/** Measures an unwrapped label and includes the same padding as Konva. */
export function measureAutoTextWidth(text: string, style: AnnotationStyle): number {
  if (typeof document === 'undefined') return Math.max(40, style.fontSize * 2);
  measurementCanvas ??= document.createElement('canvas');
  const context = measurementCanvas.getContext('2d');
  if (!context) return Math.max(40, style.fontSize * 2);

  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
  const widestLine = Math.max(
    0,
    ...text.split('\n').map((line) => context.measureText(line || ' ').width),
  );
  return Math.max(40, style.fontSize * 2, Math.ceil(widestLine) + textPadding(style.fontSize) * 2 + 3);
}
