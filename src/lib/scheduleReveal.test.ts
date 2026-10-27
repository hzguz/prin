import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleReveal } from './scheduleReveal';

describe('scheduleReveal', () => {
  let frames: Map<number, FrameRequestCallback>;
  beforeEach(() => {
    vi.useFakeTimers();
    frames = new Map();
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reveals even when a hidden webview never delivers animation frames', () => {
    const reveal = vi.fn();
    scheduleReveal(reveal);
    vi.advanceTimersByTime(100);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('reveals after two frames without revealing again on the timeout', () => {
    const reveal = vi.fn();
    scheduleReveal(reveal);
    frames.get(1)!(0);
    expect(reveal).not.toHaveBeenCalled();
    frames.get(2)!(16);
    vi.advanceTimersByTime(100);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('cancels both paths when the capture is reset before reveal', () => {
    const reveal = vi.fn();
    const cancel = scheduleReveal(reveal);
    frames.get(1)!(0);
    cancel();
    vi.runAllTimers();
    expect(frames.has(2)).toBe(false);
    expect(reveal).not.toHaveBeenCalled();
  });
});
