import { describe, expect, it } from 'vitest';
import { shouldSuppressShortcuts } from './keyboardGuard';

describe('shouldSuppressShortcuts', () => {
  it('allows shortcuts when nothing is focused and nothing is being edited', () => {
    expect(shouldSuppressShortcuts({ focusedTagName: 'BODY', isEditingText: false })).toBe(false);
  });

  it('suppresses shortcuts while a textarea has focus', () => {
    expect(shouldSuppressShortcuts({ focusedTagName: 'TEXTAREA', isEditingText: false })).toBe(
      true,
    );
  });

  it('suppresses shortcuts while an input has focus', () => {
    expect(shouldSuppressShortcuts({ focusedTagName: 'INPUT', isEditingText: false })).toBe(true);
  });

  it('suppresses shortcuts for a contenteditable element', () => {
    expect(
      shouldSuppressShortcuts({
        focusedTagName: 'DIV',
        focusedIsContentEditable: true,
        isEditingText: false,
      }),
    ).toBe(true);
  });

  it('suppresses shortcuts in the gap before a new text box takes focus', () => {
    // The regression this guard exists for: a text box has just been created,
    // focus is still on the body, and the first keystroke would otherwise be
    // read as a tool shortcut instead of a character.
    expect(shouldSuppressShortcuts({ focusedTagName: 'BODY', isEditingText: true })).toBe(true);
  });

  it('suppresses shortcuts when editing even with no focus information', () => {
    expect(shouldSuppressShortcuts({ isEditingText: true })).toBe(true);
  });

  it('allows shortcuts again once editing ends', () => {
    expect(shouldSuppressShortcuts({ focusedTagName: 'BODY', isEditingText: false })).toBe(false);
  });

  it('does not suppress for a focused canvas or button', () => {
    expect(shouldSuppressShortcuts({ focusedTagName: 'CANVAS', isEditingText: false })).toBe(false);
    expect(shouldSuppressShortcuts({ focusedTagName: 'BUTTON', isEditingText: false })).toBe(false);
  });
});
