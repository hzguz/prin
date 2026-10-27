import { afterEach, describe, expect, it, vi } from 'vitest';
import type Konva from 'konva';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { copyToClipboard, DEFAULT_EXPORT, saveToFile } from './exportImage';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }));

function fixture() {
  const bytes = new Uint8Array([137, 80, 78, 71]).buffer;
  const canvas = {
    width: 100,
    height: 50,
    toBlob: vi.fn((callback: BlobCallback) => callback({ arrayBuffer: async () => bytes } as Blob)),
  };
  const stage = {
    scaleX: () => 1,
    find: () => [],
    getLayers: () => [],
    toCanvas: vi.fn(() => canvas),
  };
  return { bytes, canvas, stage: stage as unknown as Konva.Stage };
}

afterEach(() => vi.resetAllMocks());

describe('capture export', () => {
  it('snapshots before the callback and transfers PNG as binary IPC', async () => {
    const { stage, canvas, bytes } = fixture();
    await copyToClipboard(stage, DEFAULT_EXPORT, () => {
      expect(stage.toCanvas).toHaveBeenCalledTimes(1);
    });
    expect(invoke).toHaveBeenCalledWith('copy_capture', bytes);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it('propagates clipboard failure and releases the export canvas', async () => {
    const { stage, canvas } = fixture();
    vi.mocked(invoke).mockRejectedValueOnce(new Error('clipboard busy'));
    await expect(copyToClipboard(stage, DEFAULT_EXPORT)).rejects.toThrow('clipboard busy');
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it('does not export when the save dialog is cancelled', async () => {
    const { stage } = fixture();
    vi.mocked(save).mockResolvedValueOnce(null);
    expect(await saveToFile(stage, DEFAULT_EXPORT)).toBe(false);
    expect(stage.toCanvas).not.toHaveBeenCalled();
  });

  it('transfers raw RGBA with an 8-byte dimension header when 2d ImageData is available', async () => {
    const rgba = new Uint8ClampedArray([255, 0, 128, 255, 10, 20, 30, 255]);
    const fastCanvas = {
      width: 2,
      height: 1,
      getContext: vi.fn(() => ({
        getImageData: vi.fn(() => ({ data: rgba })),
      })),
    } as unknown as HTMLCanvasElement;

    const { stage } = fixture();
    await copyToClipboard(stage, DEFAULT_EXPORT, undefined, fastCanvas);

    expect(stage.toCanvas).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
    const [cmd, payload] = vi.mocked(invoke).mock.calls[0];
    expect(cmd).toBe('copy_capture');
    const buffer = payload as ArrayBuffer;
    const view = new DataView(buffer);
    expect(view.getUint32(0, true)).toBe(2);
    expect(view.getUint32(4, true)).toBe(1);
    expect(Array.from(new Uint8Array(buffer, 8))).toEqual(Array.from(rgba));
  });
});
