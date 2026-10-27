/**
 * Decides whether the overlay's keyboard shortcuts should stand down.
 *
 * Extracted so the rule is testable: getting this wrong silently turns the
 * user's first typed character into a tool switch, which reads as "the text
 * box does not accept input until I click it again".
 */

export interface TypingContext {
  /** Tag name of the currently focused element, if any. */
  focusedTagName?: string;
  /** Whether the focused element is contenteditable. */
  focusedIsContentEditable?: boolean;
  /**
   * Whether a text annotation is being edited. Tracked separately because a
   * freshly created text box has not taken focus yet, and during that gap
   * focus still reports the document body.
   */
  isEditingText: boolean;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when keystrokes belong to a field and must not trigger shortcuts. */
export function shouldSuppressShortcuts(context: TypingContext): boolean {
  if (context.isEditingText) return true;
  if (context.focusedIsContentEditable) return true;
  return TYPING_TAGS.has(context.focusedTagName ?? '');
}
