import { describe, expect, it } from 'vitest';
import { ShortcutEventLike, describeShortcut, isValidShortcut } from './shortcutFormat';

function event(overrides: Partial<ShortcutEventLike>): ShortcutEventLike {
  return {
    key: 'x',
    code: 'KeyX',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe('isValidShortcut', () => {
  it('accepts a key with a modifier', () => {
    expect(isValidShortcut(event({ ctrlKey: true }))).toBe(true);
  });

  it('rejects a bare key, which would swallow that key system-wide', () => {
    expect(isValidShortcut(event({}))).toBe(false);
  });

  it('rejects Shift alone, which is not enough to be distinctive', () => {
    expect(isValidShortcut(event({ shiftKey: true }))).toBe(false);
  });

  it('rejects a modifier press on its own', () => {
    expect(isValidShortcut(event({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBe(
      false,
    );
    expect(isValidShortcut(event({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBe(false);
  });

  it('accepts Alt and Meta as qualifying modifiers', () => {
    expect(isValidShortcut(event({ altKey: true }))).toBe(true);
    expect(isValidShortcut(event({ metaKey: true }))).toBe(true);
  });
});

describe('describeShortcut', () => {
  it('formats a single modifier chord', () => {
    expect(describeShortcut(event({ ctrlKey: true }))).toBe('Ctrl+X');
  });

  it('orders modifiers consistently regardless of press order', () => {
    const label = describeShortcut(event({ ctrlKey: true, shiftKey: true, altKey: true }));

    expect(label).toBe('Ctrl+Alt+Shift+X');
  });

  it('reads the physical key, not the shifted character', () => {
    // With Shift held the browser reports key "X"; using code keeps the
    // label aligned with what the backend registers.
    const label = describeShortcut(event({ key: 'X', code: 'KeyX', ctrlKey: true, shiftKey: true }));

    expect(label).toBe('Ctrl+Shift+X');
  });

  it('reads digits from the physical key rather than the shifted symbol', () => {
    const label = describeShortcut(event({ key: '%', code: 'Digit5', ctrlKey: true, shiftKey: true }));

    expect(label).toBe('Ctrl+Shift+5');
  });

  it('names function keys', () => {
    expect(describeShortcut(event({ key: 'F5', code: 'F5', ctrlKey: true }))).toBe('Ctrl+F5');
  });

  it('names the Windows key as Win and macOS Command key as Cmd', () => {
    expect(describeShortcut(event({ metaKey: true, shiftKey: true, key: 'S', code: 'KeyS' }), false)).toBe(
      'Win+Shift+S',
    );
    expect(describeShortcut(event({ metaKey: true, shiftKey: true, key: 'S', code: 'KeyS' }), true)).toBe(
      'Cmd+Shift+S',
    );
  });

  it('names Space and PrintScreen', () => {
    expect(describeShortcut(event({ key: ' ', code: 'Space', ctrlKey: true }))).toBe('Ctrl+Space');
    expect(
      describeShortcut(event({ key: 'PrintScreen', code: 'PrintScreen', altKey: true })),
    ).toBe('Alt+PrintScreen');
  });

  it('lists modifiers alone while a chord is still being pressed', () => {
    const label = describeShortcut(event({ key: 'Control', code: 'ControlLeft', ctrlKey: true }));

    expect(label).toBe('Ctrl');
  });
});
