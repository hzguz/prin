/**
 * Turns a keyboard event into the accelerator syntax the backend parses.
 *
 * The displayed label is also the stored value, so there is only one
 * representation of a shortcut to keep correct.
 */

import { isMacPlatform } from './platform';

/** The subset of KeyboardEvent this module needs, so tests need no DOM. */
export interface ShortcutEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS']);

/**
 * True when the event carries a real key plus at least one modifier.
 *
 * A global shortcut without modifiers would swallow that key system-wide, and
 * a modifier on its own is just the intermediate state of a chord.
 */
export function isValidShortcut(event: ShortcutEventLike): boolean {
  if (MODIFIER_KEYS.has(event.key)) return false;
  return event.ctrlKey || event.altKey || event.metaKey;
}

/**
 * Formats an event as `Ctrl+Shift+X` (or `Cmd+Shift+X` on macOS).
 *
 * Modifier order is fixed rather than following press order, so the same
 * chord always produces the same string.
 */
export function describeShortcut(
  event: ShortcutEventLike,
  isMac: boolean = isMacPlatform(),
): string {
  const parts: string[] = [];

  // Super/Command first, then Ctrl/Alt/Shift: this is the order OS menus use
  // and the one Tauri's accelerator syntax documents.
  if (event.metaKey) parts.push(isMac ? 'Cmd' : 'Win');
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  const key = mainKeyOf(event);
  if (key) parts.push(key);

  return parts.join('+');
}

/**
 * Extracts the non-modifier key.
 *
 * Reads `code` rather than `key` for letters and digits: with Shift held,
 * `key` reports the shifted character ("X" or "%"), while the backend
 * registers by physical key.
 */
function mainKeyOf(event: ShortcutEventLike): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;

  const letter = /^Key([A-Z])$/.exec(event.code);
  if (letter) return letter[1];

  const digit = /^Digit([0-9])$/.exec(event.code);
  if (digit) return digit[1];

  const functionKey = /^F([1-9]|1[0-2])$/.exec(event.code);
  if (functionKey) return event.code;

  if (event.code === 'Space') return 'Space';
  if (event.code === 'PrintScreen') return 'PrintScreen';
  if (event.code === 'Insert') return 'Insert';

  // Anything else is unsupported by the backend parser; surfacing the raw key
  // lets the user see why their choice was rejected.
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}
