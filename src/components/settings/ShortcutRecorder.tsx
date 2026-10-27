/**
 * Records a keyboard shortcut by listening to the keys the user presses.
 *
 * Typing an accelerator by hand invites typos the backend can only reject
 * after the fact, so the combination is captured directly instead.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconKeyboard, IconX } from '@tabler/icons-react';
import { useI18n } from '../../i18n';
import { isMacPlatform } from '../../lib/platform';
import { describeShortcut, isValidShortcut } from '../../lib/shortcutFormat';

interface ShortcutRecorderProps {
  value: string | null;
  onRecord: (label: string) => Promise<void>;
  onRecordingChange: (recording: boolean) => Promise<void>;
}

export function ShortcutRecorder({ value, onRecord, onRecordingChange }: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [arming, setArming] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const suspendedRef = useRef(false);
  const completingRef = useRef(false);
  const t = useI18n((state) => state.t);

  const resumeShortcut = useCallback(() => {
    void onRecordingChange(false)
      .then(() => {
        suspendedRef.current = false;
      })
      .catch(() => {
        // SettingsWindow already surfaces the backend error. Keep the ref true
        // so unmount gets one last chance to restore the binding.
      });
  }, [onRecordingChange]);

  // Closing the settings window while armed must restore the old binding.
  useEffect(
    () => () => {
      if (suspendedRef.current && !completingRef.current) {
        void onRecordingChange(false);
      }
    },
    [onRecordingChange],
  );

  useEffect(() => {
    if (!recording) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setRecording(false);
        setPreview(null);
        setHint(null);
        resumeShortcut();
        return;
      }

      const label = describeShortcut(event);
      setPreview(label);

      // Modifier-only presses are the intermediate state of every chord, so
      // they update the preview but never complete the recording.
      if (!isValidShortcut(event)) {
        setHint(null);
        return;
      }

      // Windows owns Win+Shift+S outright; accepting it would register
      // successfully in some cases but never actually fire.
      if (!isMacPlatform() && label === 'Win+Shift+S') {
        setHint(useI18n.getState().t.recorder.winShiftSReserved);
        return;
      }

      setRecording(false);
      setPreview(null);
      setHint(null);
      completingRef.current = true;
      void onRecord(label).finally(() => {
        suspendedRef.current = false;
        completingRef.current = false;
      });
    };

    // Capture phase so the recorder sees keys before anything else can act
    // on them.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, onRecord, resumeShortcut]);

  // Clicking elsewhere abandons a recording rather than leaving it armed.
  useEffect(() => {
    if (!recording) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node)) {
        setRecording(false);
        setPreview(null);
        setHint(null);
        resumeShortcut();
      }
    };

    const frame = requestAnimationFrame(() =>
      document.addEventListener('pointerdown', handlePointerDown),
    );

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [recording, resumeShortcut]);

  const display = arming
    ? t.recorder.preparing
    : recording
      ? (preview ?? t.recorder.pressKeys)
      : (value ?? t.recorder.noShortcut);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          ref={buttonRef}
          type="button"
          disabled={arming}
          onClick={() => {
            setPreview(null);
            setHint(null);

            if (recording) {
              setRecording(false);
              resumeShortcut();
              return;
            }

            setArming(true);
            suspendedRef.current = true;
            void onRecordingChange(true)
              .then(() => setRecording(true))
              .catch((reason) => {
                suspendedRef.current = false;
                setHint(String(reason));
              })
              .finally(() => setArming(false));
          }}
          className={`flex h-9 flex-1 items-center gap-2 rounded-lg border px-3 text-left transition disabled:cursor-wait disabled:opacity-70 ${
            recording
              ? 'border-accent bg-accent-soft text-content-primary'
              : 'border-surface-600 bg-surface-700 text-content-secondary hover:border-content-muted'
          }`}
        >
          <IconKeyboard size={16} stroke={1.75} className="shrink-0" />
          <span
            className={`truncate font-mono text-xs ${
              recording && !preview ? 'text-content-muted italic' : ''
            }`}
          >
            {display}
          </span>
        </button>

        {recording && (
          <button
            type="button"
            onClick={() => {
              setRecording(false);
              setPreview(null);
              setHint(null);
              resumeShortcut();
            }}
            title={t.recorder.cancelEsc}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-700 text-content-secondary transition hover:text-content-primary"
          >
            <IconX size={16} stroke={1.75} />
          </button>
        )}
      </div>

      {hint && <p className="text-[11px] leading-snug text-amber-400">{hint}</p>}

      {!recording && !hint && (
        <p className="text-[11px] text-content-muted">{t.recorder.clickToRecord}</p>
      )}
    </div>
  );
}
