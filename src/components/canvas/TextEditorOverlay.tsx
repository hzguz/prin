/**
 * In-place text editing.
 *
 * A DOM textarea is positioned over the Konva text node rather than
 * reimplementing caret handling on canvas. The textarea mirrors the node's
 * typography so the text does not visibly shift when editing ends.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { TEXT_LINE_HEIGHT, TextAnnotation } from '../../types/annotations';
import {
  measureAutoTextWidth,
  textBoxBorderWidth,
  textBoxCornerRadius,
  textPadding,
} from './textBoxGeometry';

interface TextEditorOverlayProps {
  annotation: TextAnnotation;
  scale: number;
  stageElement: HTMLDivElement | null;
  onDraftChange: (value: string, width: number, height: number) => void;
  onClose: () => void;
}

export function TextEditorOverlay({
  annotation,
  scale,
  stageElement,
  onDraftChange,
  onClose,
}: TextEditorOverlayProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(annotation.text);
  const [editorHeight, setEditorHeight] = useState(
    (annotation.style.fontSize * TEXT_LINE_HEIGHT + textPadding(annotation.style.fontSize) * 2) * scale,
  );
  const updateAnnotation = useEditorStore((state) => state.updateAnnotation);
  const removeSelected = useEditorStore((state) => state.removeSelected);
  const setSelection = useEditorStore((state) => state.setSelection);
  const { style } = annotation;

  const editorWidth = annotation.autoWidth ? measureAutoTextWidth(value, style) : annotation.width;

  // Runs on mount, which is now the first render because the component no
  // longer waits for the stage element. useLayoutEffect rather than useEffect
  // so focus lands before the browser paints, leaving no frame in which a
  // keystroke could go somewhere else.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.focus();
    textarea.select();

    // The pointer sequence that created this box is still dispatching, and
    // Konva focuses its own stage container while handling it. Reclaiming
    // focus once that settles is what makes the box typable without a second
    // click; refocusing only when it was actually lost avoids disturbing a
    // caret the user has already placed.
    const frame = requestAnimationFrame(() => {
      if (document.activeElement !== textarea) {
        textarea.focus();
        textarea.select();
      }
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const minHeight =
      (annotation.style.fontSize * TEXT_LINE_HEIGHT + textPadding(annotation.style.fontSize) * 2) * scale;
    textarea.style.height = 'auto';
    const nextHeight = Math.max(minHeight, textarea.scrollHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.scrollTop = 0;
    setEditorHeight(nextHeight);
    onDraftChange(value, editorWidth, nextHeight / scale);
  }, [
    value,
    annotation.width,
    annotation.autoWidth,
    annotation.style.fontFamily,
    annotation.style.fontSize,
    annotation.style.fontStyle,
    annotation.style.fontWeight,
    editorWidth,
    onDraftChange,
    scale,
  ]);

  const commit = () => {
    const trimmed = value.trim();

    // An empty text box is not a useful artifact; discard it instead of
    // leaving an invisible object on the canvas.
    if (trimmed.length === 0) {
      setSelection([annotation.id]);
      removeSelected();
    } else if (trimmed !== annotation.text || annotation.width !== editorWidth) {
      updateAnnotation(annotation.id, {
        text: trimmed,
        width: annotation.autoWidth ? measureAutoTextWidth(trimmed, style) : annotation.width,
      } as Partial<TextAnnotation>);
    }

    onClose();
  };

  // Latest commit closure, so the listener below can stay registered across
  // renders instead of being torn down and re-armed on every keystroke.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Commit on outside click so the interaction matches every other editor.
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!textareaRef.current?.contains(event.target as Node)) {
        commitRef.current();
      }
    };

    // Armed on the next frame rather than a 0 ms timer: the pointer sequence
    // that opened the editor must finish dispatching first, otherwise its own
    // pointerup closes the editor the instant it appears.
    const frame = requestAnimationFrame(() => {
      document.addEventListener('pointerdown', handlePointerDown);
    });

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, []);

  // Rendered even before the stage element is known, rather than bailing out
  // with null. Waiting for it delays the textarea by a render, and that gap is
  // exactly when the user's first keystroke lands and gets lost. The stage
  // shares its positioned container with this textarea, so the offsets are
  // zero until measured — a correction of at most one frame, invisible next
  // to a dropped keystroke.
  const stageRect = stageElement?.getBoundingClientRect();
  const containerRect = stageElement?.parentElement?.getBoundingClientRect();
  const offsetLeft = (stageRect?.left ?? 0) - (containerRect?.left ?? 0);
  const offsetTop = (stageRect?.top ?? 0) - (containerRect?.top ?? 0);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      rows={1}
      wrap={annotation.autoWidth ? 'off' : 'soft'}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        // Enter commits, Shift+Enter inserts a newline.
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          // Stop the overlay from also reading this Escape as "cancel the
          // whole capture" — the user is dismissing the text box only.
          event.stopPropagation();

          // Abandoning a never-typed box must not leave an invisible
          // zero-length annotation behind, in the scene or in the export.
          if (annotation.text.trim().length === 0) {
            setSelection([annotation.id]);
            removeSelected();
          }
          onClose();
        }
      }}
      spellCheck={false}
      className="absolute z-10 resize-none overflow-hidden outline-2 outline-accent"
      style={{
        left: offsetLeft + annotation.x * scale,
        top: offsetTop + annotation.y * scale,
        // Auto-width boxes grow with what is typed rather than starting at a
        // fixed width the text may never fill.
        width: editorWidth * scale,
        height: editorHeight,
        fontSize: style.fontSize * scale,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        textAlign: style.textAlign,
        color: style.strokeColor,
        boxSizing: 'border-box',
        padding: textPadding(style.fontSize) * scale,
        border: style.textBox
          ? `${Math.max(1, textBoxBorderWidth(style.fontSize) * scale)}px solid ${style.strokeColor}`
          : '0',
        borderRadius: style.textBox ? textBoxCornerRadius(style.fontSize) * scale : 0,
        background: style.textBox ? style.fillColor : 'transparent',
        whiteSpace: annotation.autoWidth ? 'pre' : 'pre-wrap',
        overflowWrap: 'normal',
        wordBreak: 'normal',
        // Must match the Konva node exactly, or the height differs between
        // editing and display.
        lineHeight: TEXT_LINE_HEIGHT,
        opacity: style.opacity,
        // During editing this textarea paints the glyphs while the Konva text
        // is transparent. Mirror the canvas shadow here so toggling it gives
        // immediate visual feedback and does not appear to be broken.
        textShadow: style.shadow
          ? `0 ${3 * scale}px ${12 * scale}px rgba(0, 0, 0, 0.65)`
          : 'none',
      }}
    />
  );
}
