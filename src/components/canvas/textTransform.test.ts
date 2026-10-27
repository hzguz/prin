import { describe, expect, it } from 'vitest';
import { useEditorStore } from '../../store/editorStore';
import { DEFAULT_STYLE, TextAnnotation } from '../../types/annotations';

function makeText(id: string): TextAnnotation {
  return {
    id,
    type: 'text',
    x: 10,
    y: 10,
    width: 280,
    autoWidth: true,
    text: 'exemplo',
    rotation: 0,
    style: { ...DEFAULT_STYLE },
    locked: false,
    visible: true,
  };
}

describe('text annotation transforms', () => {
  it('creates text unrotated', () => {
    useEditorStore.setState({ annotations: [], selectedIds: [], past: [], future: [] });
    useEditorStore.getState().addAnnotation(makeText('t1'));

    // Rotation is disabled for text: the transformer hides the handle and the
    // transform handler pins the value, so it must never leave zero.
    expect(useEditorStore.getState().annotations[0].rotation).toBe(0);
  });

  it('defaults new text to Arial', () => {
    expect(DEFAULT_STYLE.fontFamily).toBe('Arial');
  });

  it('keeps the text highlight box disabled by default', () => {
    expect(DEFAULT_STYLE.textBox).toBe(false);
  });

  it('applies the text highlight box as an undoable style', () => {
    useEditorStore.setState({ annotations: [], selectedIds: [], past: [], future: [] });
    useEditorStore.getState().addAnnotation(makeText('t1'));
    useEditorStore.getState().applyStyle({ textBox: true, fillColor: '#ffffff' });

    expect(useEditorStore.getState().annotations[0].style.textBox).toBe(true);
    expect(useEditorStore.getState().annotations[0].style.fillColor).toBe('#ffffff');
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().annotations[0].style.textBox).toBe(false);
  });

  it('exposes editing state so the keyboard handler can stand down', () => {
    useEditorStore.setState({ editingTextId: null });
    expect(useEditorStore.getState().editingTextId).toBeNull();

    // Set the instant a box is created, before the textarea has focus — that
    // gap is where a keystroke would otherwise be read as a tool shortcut.
    useEditorStore.getState().setEditingTextId('t1');
    expect(useEditorStore.getState().editingTextId).toBe('t1');

    useEditorStore.getState().setEditingTextId(null);
    expect(useEditorStore.getState().editingTextId).toBeNull();
  });

  it('clears editing state on reset so shortcuts are not left suppressed', () => {
    useEditorStore.getState().setEditingTextId('t1');
    useEditorStore.getState().reset();

    expect(useEditorStore.getState().editingTextId).toBeNull();
  });

  it('persists a font size change onto the selected text', () => {
    useEditorStore.setState({ annotations: [], selectedIds: [], past: [], future: [] });
    useEditorStore.getState().addAnnotation(makeText('t1'));
    useEditorStore.getState().setSelection(['t1']);

    useEditorStore.getState().applyStyle({ fontSize: 64 });

    expect(useEditorStore.getState().annotations[0].style.fontSize).toBe(64);
  });

  it('keeps the selection after the active tool is already select', () => {
    useEditorStore.setState({ annotations: [], selectedIds: [], past: [], future: [] });
    useEditorStore.getState().addAnnotation(makeText('t1'));

    // addAnnotation auto-selects; switching to the select tool must not drop it.
    useEditorStore.getState().setActiveTool('select');

    expect(useEditorStore.getState().selectedIds).toEqual(['t1']);
  });

  it('records a drawing gesture as exactly one undo step', () => {
    useEditorStore.setState({ annotations: [], selectedIds: [], past: [], future: [] });

    // Mirrors the canvas flow: create on pointerdown, size on pointermove.
    // Sizing is transient and must not add a second history entry, or one
    // drawn shape would cost two undos.
    useEditorStore.getState().addAnnotation(makeText('t1'));
    useEditorStore.getState().updateAnnotationTransient('t1', { width: 400 } as Partial<TextAnnotation>);

    expect(useEditorStore.getState().past).toHaveLength(1);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().annotations).toHaveLength(0);
  });

  it('treats a drag as one undo step regardless of how many moves it emits', () => {
    useEditorStore.setState({ annotations: [], selectedIds: [], past: [], future: [] });
    useEditorStore.getState().addAnnotation(makeText('t1'));
    const historyAfterCreate = useEditorStore.getState().past.length;

    // Mirrors onDragStart, then onDragMove per pointer move, then onDragEnd.
    useEditorStore.getState().beginTransient();
    useEditorStore.getState().updateAnnotationTransient('t1', { x: 20 } as Partial<TextAnnotation>);
    useEditorStore.getState().updateAnnotationTransient('t1', { x: 40 } as Partial<TextAnnotation>);
    useEditorStore.getState().updateAnnotationTransient('t1', { x: 60 } as Partial<TextAnnotation>);
    useEditorStore.getState().commitTransient();

    expect(useEditorStore.getState().past).toHaveLength(historyAfterCreate + 1);
    expect(useEditorStore.getState().annotations[0].x).toBe(60);

    // One undo returns to where the element was before the drag started.
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().annotations[0].x).toBe(10);
  });

  it('drops the selection when a drawing tool is chosen, blocking restyle', () => {
    useEditorStore.setState({ annotations: [], selectedIds: [], past: [], future: [] });
    useEditorStore.getState().addAnnotation(makeText('t1'));

    useEditorStore.getState().setActiveTool('text');
    useEditorStore.getState().applyStyle({ fontSize: 72 });

    // With nothing selected the change lands on the draft, not the annotation.
    expect(useEditorStore.getState().annotations[0].style.fontSize).toBe(DEFAULT_STYLE.fontSize);
    expect(useEditorStore.getState().draftStyle.fontSize).toBe(72);
  });
});
