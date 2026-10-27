/**
 * Platform detection helpers for keyboard modifier labels and OS-specific UI copy.
 */

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPod|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}

/** Primary command modifier label ('Cmd' on macOS, 'Ctrl' elsewhere). */
export function primaryModifierLabel(): string {
  return isMacPlatform() ? 'Cmd' : 'Ctrl';
}
