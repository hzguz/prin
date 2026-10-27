/**
 * Central editor state: scene, selection, tool and undo/redo history.
 *
 * History is owned here rather than by individual components so every mutation
 * path shares one definition of what an undoable step is. Only `annotations`
 * is versioned — selection and tool changes must not consume undo steps.
 */

import { create } from 'zustand';
import {
  Annotation,
  AnnotationStyle,
  DEFAULT_STYLE,
  TOOL_PROPERTIES,
  ToolId,
} from '../types/annotations';

/** Cap on retained history; bounds memory on long editing sessions. */
const MAX_HISTORY = 100;

interface CaptureSource {
  dataUrl: string;
  width: number;
  height: number;
}

interface EditorState {
  capture: CaptureSource | null;
  annotations: Annotation[];
  selectedIds: string[];
  activeTool: ToolId;
  /**
   * Id of the text annotation being edited, or null.
   *
   * Lives in the store rather than in the canvas because the window-level
   * keyboard handler must consult it to stand down, and passing it up through
   * props made the guard depend on a callback keeping a stable identity.
   */
  editingTextId: string | null;
  /** Style applied to the next created annotation. */
  draftStyle: AnnotationStyle;
  past: Annotation[][];
  future: Annotation[][];
  /** Scene as it was before the in-progress gesture began. */
  transientOrigin: Annotation[] | null;

  setCapture: (capture: CaptureSource) => void;
  setActiveTool: (tool: ToolId) => void;
  setEditingTextId: (id: string | null) => void;
  setSelection: (ids: string[]) => void;
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  /** Records the pre-gesture scene so the whole gesture undoes as one step. */
  beginTransient: () => void;
  /** Live transform updates that must not flood history until committed. */
  updateAnnotationTransient: (id: string, patch: Partial<Annotation>) => void;
  /** Moves the complete history into a new crop-local coordinate system. */
  translateScene: (dx: number, dy: number) => void;
  commitTransient: () => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  /** Applies a style change to the selection, or to the draft when empty. */
  applyStyle: (patch: Partial<AnnotationStyle>) => void;
  /** Live style preview; pair with begin/commitTransient for one undo step. */
  applyStyleTransient: (patch: Partial<AnnotationStyle>) => void;
  reorder: (id: string, direction: 'front' | 'back' | 'forward' | 'backward') => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}

/** Snapshots current annotations onto the undo stack and clears redo. */
function pushHistory(state: EditorState): Pick<EditorState, 'past' | 'future'> {
  const past = [...state.past, state.annotations].slice(-MAX_HISTORY);
  return { past, future: [] };
}

function applyStyleToSelection(
  annotations: Annotation[],
  selectedIds: string[],
  patch: Partial<AnnotationStyle>,
): Annotation[] {
  const selected = new Set(selectedIds);
  return annotations.map((item) => {
    if (!selected.has(item.id)) return item;
    const applicablePatch = Object.fromEntries(
      Object.entries(patch).filter(([property]) =>
        TOOL_PROPERTIES[item.type].includes(property as keyof AnnotationStyle),
      ),
    );
    return {
      ...item,
      style: { ...item.style, ...applicablePatch },
    } as Annotation;
  });
}

export const useEditorStore = create<EditorState>((set, get) => ({
  capture: null,
  annotations: [],
  selectedIds: [],
  activeTool: 'select',
  editingTextId: null,
  draftStyle: DEFAULT_STYLE,
  past: [],
  future: [],
  transientOrigin: null,

  setCapture: (capture) =>
    set({ capture, annotations: [], selectedIds: [], past: [], future: [] }),

  setActiveTool: (activeTool) =>
    // Leaving select mode drops the selection so property edits target the
    // draft style rather than a shape the user stopped thinking about.
    set(activeTool === 'select' ? { activeTool } : { activeTool, selectedIds: [] }),

  setEditingTextId: (editingTextId) => set({ editingTextId }),

  setSelection: (selectedIds) => set({ selectedIds }),

  addAnnotation: (annotation) =>
    set((state) => ({
      ...pushHistory(state),
      annotations: [...state.annotations, annotation],
      selectedIds: [annotation.id],
    })),

  updateAnnotation: (id, patch) =>
    set((state) => ({
      ...pushHistory(state),
      annotations: state.annotations.map((item) =>
        item.id === id ? ({ ...item, ...patch } as Annotation) : item,
      ),
    })),

  beginTransient: () =>
    set((state) => ({
      // Snapshot before the gesture mutates anything. Capturing at commit
      // time instead would store the post-drag state, making undo a no-op.
      // Nested calls keep the earliest snapshot, so one gesture stays atomic.
      transientOrigin: state.transientOrigin ?? state.annotations,
    })),

  updateAnnotationTransient: (id, patch) =>
    set((state) => ({
      annotations: state.annotations.map((item) =>
        item.id === id ? ({ ...item, ...patch } as Annotation) : item,
      ),
    })),

  translateScene: (dx, dy) =>
    set((state) => {
      if (dx === 0 && dy === 0) return state;

      const translate = (items: Annotation[]) =>
        items.map((item) => ({ ...item, x: item.x + dx, y: item.y + dy }) as Annotation);

      return {
        annotations: translate(state.annotations),
        past: state.past.map(translate),
        future: state.future.map(translate),
        transientOrigin: state.transientOrigin ? translate(state.transientOrigin) : null,
      };
    }),

  commitTransient: () =>
    set((state) => {
      // Without a recorded origin the gesture changed nothing worth undoing.
      if (!state.transientOrigin) return state;
      // Transient updates preserve the annotations array when they only
      // change draft preferences (or when a gesture is cancelled). Do not
      // manufacture an empty undo step for those no-op gestures.
      if (state.transientOrigin === state.annotations) {
        return { transientOrigin: null };
      }

      return {
        past: [...state.past, state.transientOrigin].slice(-MAX_HISTORY),
        future: [],
        transientOrigin: null,
      };
    }),

  removeSelected: () =>
    set((state) => {
      if (state.selectedIds.length === 0) return state;
      const selected = new Set(state.selectedIds);
      return {
        ...pushHistory(state),
        annotations: state.annotations.filter((item) => !selected.has(item.id)),
        selectedIds: [],
      };
    }),

  duplicateSelected: () =>
    set((state) => {
      if (state.selectedIds.length === 0) return state;
      const selected = new Set(state.selectedIds);
      const clones = state.annotations
        .filter((item) => selected.has(item.id))
        .map((item) => ({
          ...item,
          id: crypto.randomUUID(),
          x: item.x + 16,
          y: item.y + 16,
        }));

      return {
        ...pushHistory(state),
        annotations: [...state.annotations, ...clones],
        selectedIds: clones.map((item) => item.id),
      };
    }),

  applyStyle: (patch) =>
    set((state) => {
      const draftStyle = { ...state.draftStyle, ...patch };

      // With nothing selected the change is a preference for the next shape.
      if (state.selectedIds.length === 0) {
        return { draftStyle } as Partial<EditorState> as EditorState;
      }

      return {
        ...pushHistory(state),
        draftStyle,
        annotations: applyStyleToSelection(state.annotations, state.selectedIds, patch),
      } as EditorState;
    }),

  applyStyleTransient: (patch) =>
    set((state) => {
      const draftStyle = { ...state.draftStyle, ...patch };
      if (state.selectedIds.length === 0) return { draftStyle };
      return {
        draftStyle,
        annotations: applyStyleToSelection(state.annotations, state.selectedIds, patch),
      };
    }),


  reorder: (id, direction) =>
    set((state) => {
      const index = state.annotations.findIndex((item) => item.id === id);
      if (index === -1) return state;

      const annotations = [...state.annotations];
      const [item] = annotations.splice(index, 1);

      const targetIndex = {
        front: annotations.length,
        back: 0,
        forward: Math.min(index + 1, annotations.length),
        backward: Math.max(index - 1, 0),
      }[direction];

      annotations.splice(targetIndex, 0, item);
      return { ...pushHistory(state), annotations };
    }),

  undo: () => {
    const { past, annotations, future } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    set({
      annotations: previous,
      past: past.slice(0, -1),
      future: [annotations, ...future].slice(0, MAX_HISTORY),
      selectedIds: [],
    });
  },

  redo: () => {
    const { past, annotations, future } = get();
    if (future.length === 0) return;
    const [next, ...rest] = future;
    set({
      annotations: next,
      past: [...past, annotations].slice(-MAX_HISTORY),
      future: rest,
      selectedIds: [],
    });
  },

  reset: () =>
    set({
      capture: null,
      annotations: [],
      selectedIds: [],
      past: [],
      future: [],
      transientOrigin: null,
      activeTool: 'select',
      editingTextId: null,
    }),
}));
