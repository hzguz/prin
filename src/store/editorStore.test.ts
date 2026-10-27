import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from './editorStore';
import { Annotation, DEFAULT_STYLE, RectAnnotation } from '../types/annotations';

function makeRect(id: string): RectAnnotation {
  return {
    id,
    type: 'rect',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    style: { ...DEFAULT_STYLE },
    locked: false,
    visible: true,
  };
}

const initialState = useEditorStore.getState();

beforeEach(() => {
  useEditorStore.setState({
    ...initialState,
    annotations: [],
    selectedIds: [],
    past: [],
    future: [],
    draftStyle: { ...DEFAULT_STYLE },
  });
});

describe('capture cleanup', () => {
  it('releases the capture, annotations and all editing history on reset', () => {
    const store = useEditorStore.getState();
    store.setCapture({ dataUrl: 'blob:last-capture', width: 3840, height: 2160 });
    store.addAnnotation(makeRect('a'));
    store.addAnnotation(makeRect('b'));
    store.undo();
    store.beginTransient();
    store.setEditingTextId('a');
    expect(useEditorStore.getState().past.length).toBeGreaterThan(0);
    expect(useEditorStore.getState().future.length).toBeGreaterThan(0);
    expect(useEditorStore.getState().transientOrigin).not.toBeNull();

    store.reset();

    expect(useEditorStore.getState()).toMatchObject({
      capture: null,
      annotations: [],
      selectedIds: [],
      past: [],
      future: [],
      transientOrigin: null,
      editingTextId: null,
    });
  });
});

describe('history', () => {
  it('restores the previous scene on undo', () => {
    const store = useEditorStore.getState();
    store.addAnnotation(makeRect('a'));
    store.addAnnotation(makeRect('b'));

    expect(useEditorStore.getState().annotations).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().annotations).toHaveLength(1);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().annotations).toHaveLength(0);
  });

  it('reapplies an undone change on redo', () => {
    useEditorStore.getState().addAnnotation(makeRect('a'));
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().annotations).toHaveLength(0);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().annotations).toHaveLength(1);
  });

  it('is a no-op when there is nothing to undo or redo', () => {
    expect(() => {
      useEditorStore.getState().undo();
      useEditorStore.getState().redo();
    }).not.toThrow();

    expect(useEditorStore.getState().annotations).toEqual([]);
  });

  it('drops the redo stack once a new change is made', () => {
    useEditorStore.getState().addAnnotation(makeRect('a'));
    useEditorStore.getState().undo();
    useEditorStore.getState().addAnnotation(makeRect('b'));

    expect(useEditorStore.getState().future).toHaveLength(0);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().annotations.map((item) => item.id)).toEqual(['b']);
  });

  it('does not record transient updates until they are committed', () => {
    useEditorStore.getState().addAnnotation(makeRect('a'));
    const historyDepth = useEditorStore.getState().past.length;

    useEditorStore.getState().beginTransient();
    useEditorStore.getState().updateAnnotationTransient('a', { x: 5 } as Partial<Annotation>);
    useEditorStore.getState().updateAnnotationTransient('a', { x: 25 } as Partial<Annotation>);

    expect(useEditorStore.getState().past).toHaveLength(historyDepth);

    useEditorStore.getState().commitTransient();
    expect(useEditorStore.getState().past).toHaveLength(historyDepth + 1);
  });

  it('undoes a committed gesture back to its pre-gesture state', () => {
    useEditorStore.getState().addAnnotation(makeRect('a'));

    useEditorStore.getState().beginTransient();
    useEditorStore.getState().updateAnnotationTransient('a', { x: 90 } as Partial<Annotation>);
    useEditorStore.getState().commitTransient();

    expect(useEditorStore.getState().annotations[0].x).toBe(90);

    // The snapshot must predate the gesture, or undo would restore the moved
    // position and appear to do nothing.
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().annotations[0].x).toBe(0);
  });

  it('ignores a commit that was never opened by beginTransient', () => {
    useEditorStore.getState().addAnnotation(makeRect('a'));
    const historyDepth = useEditorStore.getState().past.length;

    useEditorStore.getState().commitTransient();

    expect(useEditorStore.getState().past).toHaveLength(historyDepth);
  });

  it('keeps one gesture atomic when beginTransient is called repeatedly', () => {
    useEditorStore.getState().addAnnotation(makeRect('a'));

    // Drag and transform handlers can both fire on the same gesture; the
    // earliest snapshot must win so it still undoes as a single step.
    useEditorStore.getState().beginTransient();
    useEditorStore.getState().updateAnnotationTransient('a', { x: 30 } as Partial<Annotation>);
    useEditorStore.getState().beginTransient();
    useEditorStore.getState().updateAnnotationTransient('a', { x: 60 } as Partial<Annotation>);
    useEditorStore.getState().commitTransient();

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().annotations[0].x).toBe(0);
  });

  it('translates current annotations and history when the crop origin changes', () => {
    useEditorStore.getState().addAnnotation(makeRect('a'));
    useEditorStore.getState().updateAnnotation('a', { x: 20, y: 10 });

    useEditorStore.getState().translateScene(100, 50);
    expect(useEditorStore.getState().annotations[0]).toMatchObject({ x: 120, y: 60 });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().annotations[0]).toMatchObject({ x: 100, y: 50 });

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().annotations[0]).toMatchObject({ x: 120, y: 60 });
  });
});

describe('applyStyle', () => {
  it('updates the draft style when nothing is selected', () => {
    useEditorStore.getState().applyStyle({ fontSize: 48 });

    expect(useEditorStore.getState().draftStyle.fontSize).toBe(48);
    expect(useEditorStore.getState().annotations).toEqual([]);
  });

  it('restyles only the selected annotations', () => {
    const store = useEditorStore.getState();
    store.addAnnotation(makeRect('a'));
    store.addAnnotation(makeRect('b'));
    useEditorStore.getState().setSelection(['a']);

    useEditorStore.getState().applyStyle({ strokeWidth: 12 });

    const byId = Object.fromEntries(
      useEditorStore.getState().annotations.map((item) => [item.id, item]),
    );
    expect(byId.a.style.strokeWidth).toBe(12);
    expect(byId.b.style.strokeWidth).toBe(DEFAULT_STYLE.strokeWidth);
  });

  it('records a restyle as an undoable step', () => {
    useEditorStore.getState().addAnnotation(makeRect('a'));
    useEditorStore.getState().setSelection(['a']);
    useEditorStore.getState().applyStyle({ strokeWidth: 12 });

    useEditorStore.getState().undo();

    expect(useEditorStore.getState().annotations[0].style.strokeWidth).toBe(
      DEFAULT_STYLE.strokeWidth,
    );
  });

  it('groups a live slider preview into one undo step', () => {
    useEditorStore.getState().addAnnotation(makeRect('a'));
    useEditorStore.getState().setSelection(['a']);
    const historyBeforeGesture = useEditorStore.getState().past.length;

    useEditorStore.getState().beginTransient();
    useEditorStore.getState().applyStyleTransient({ opacity: 0.8 });
    useEditorStore.getState().applyStyleTransient({ opacity: 0.5 });
    useEditorStore.getState().applyStyleTransient({ opacity: 0.2 });

    expect(useEditorStore.getState().past).toHaveLength(historyBeforeGesture);
    expect(useEditorStore.getState().annotations[0].style.opacity).toBe(0.2);

    useEditorStore.getState().commitTransient();
    expect(useEditorStore.getState().past).toHaveLength(historyBeforeGesture + 1);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().annotations[0].style.opacity).toBe(DEFAULT_STYLE.opacity);
  });

  it('previews the draft style without creating history when nothing is selected', () => {
    useEditorStore.getState().beginTransient();
    useEditorStore.getState().applyStyleTransient({ blurIntensity: 24 });
    useEditorStore.getState().commitTransient();

    expect(useEditorStore.getState().draftStyle.blurIntensity).toBe(24);
    expect(useEditorStore.getState().past).toEqual([]);
  });
});

describe('selection operations', () => {
  it('duplicates the selection with fresh ids and an offset', () => {
    useEditorStore.getState().addAnnotation(makeRect('a'));
    useEditorStore.getState().setSelection(['a']);
    useEditorStore.getState().duplicateSelected();

    const { annotations, selectedIds } = useEditorStore.getState();
    expect(annotations).toHaveLength(2);
    expect(annotations[1].id).not.toBe('a');
    expect(annotations[1].x).toBe(annotations[0].x + 16);
    expect(selectedIds).toEqual([annotations[1].id]);
  });

  it('removes every selected annotation and clears the selection', () => {
    const store = useEditorStore.getState();
    store.addAnnotation(makeRect('a'));
    store.addAnnotation(makeRect('b'));
    useEditorStore.getState().setSelection(['a', 'b']);

    useEditorStore.getState().removeSelected();

    expect(useEditorStore.getState().annotations).toEqual([]);
    expect(useEditorStore.getState().selectedIds).toEqual([]);
  });

  it('clears the selection when switching to a drawing tool', () => {
    useEditorStore.getState().addAnnotation(makeRect('a'));
    useEditorStore.getState().setSelection(['a']);

    useEditorStore.getState().setActiveTool('ellipse');

    expect(useEditorStore.getState().selectedIds).toEqual([]);
  });

  it('keeps the selection when re-entering select mode', () => {
    useEditorStore.getState().addAnnotation(makeRect('a'));
    useEditorStore.getState().setSelection(['a']);

    useEditorStore.getState().setActiveTool('select');

    expect(useEditorStore.getState().selectedIds).toEqual(['a']);
  });
});

describe('reorder', () => {
  it('moves an annotation to the front of the draw order', () => {
    const store = useEditorStore.getState();
    store.addAnnotation(makeRect('a'));
    store.addAnnotation(makeRect('b'));

    useEditorStore.getState().reorder('a', 'front');

    expect(useEditorStore.getState().annotations.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('does not move an annotation past the start of the list', () => {
    const store = useEditorStore.getState();
    store.addAnnotation(makeRect('a'));
    store.addAnnotation(makeRect('b'));

    useEditorStore.getState().reorder('a', 'backward');

    expect(useEditorStore.getState().annotations.map((item) => item.id)).toEqual(['a', 'b']);
  });
});
