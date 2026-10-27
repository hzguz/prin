/**
 * Settings window: capture hotkey, launch-on-login, and interface language.
 *
 * Settings are owned by the Rust side — the hotkey because only it can ask the
 * OS to register a global binding, autostart because it writes to the OS login
 * items, and language so the native system tray menu stays localized.
 */

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  IconAlertTriangle,
  IconCheck,
  IconKeyboard,
  IconLanguage,
  IconPower,
} from '@tabler/icons-react';
import { ShortcutRecorder } from '../components/settings/ShortcutRecorder';
import { type Locale, SUPPORTED_LOCALES, useI18n } from '../i18n';
import { isMacPlatform } from '../lib/platform';

type SaveState = { tone: 'idle' | 'saved' | 'error'; message?: string };

export function SettingsWindow() {
  const [shortcut, setShortcut] = useState<string | null>(null);
  const [autostart, setAutostart] = useState(false);
  const [loading, setLoading] = useState(true);
  const [save, setSave] = useState<SaveState>({ tone: 'idle' });

  const locale = useI18n((state) => state.locale);
  const t = useI18n((state) => state.t);
  const setLocale = useI18n((state) => state.setLocale);
  const isMac = isMacPlatform();

  useEffect(() => {
    Promise.all([
      invoke<string | null>('active_shortcut'),
      invoke<boolean>('autostart_enabled'),
    ])
      .then(([activeShortcut, autostartEnabled]) => {
        setShortcut(activeShortcut);
        setAutostart(autostartEnabled);
      })
      .catch((reason) => setSave({ tone: 'error', message: String(reason) }))
      .finally(() => setLoading(false));
  }, []);

  // Success is transient; a failure stays until the next attempt so it cannot
  // be missed.
  useEffect(() => {
    if (save.tone !== 'saved') return;
    const timer = window.setTimeout(() => setSave({ tone: 'idle' }), 2200);
    return () => window.clearTimeout(timer);
  }, [save]);

  const applyShortcut = useCallback(
    async (label: string) => {
      try {
        await invoke('set_capture_shortcut', { label });
        setShortcut(label);
        setSave({ tone: 'saved', message: useI18n.getState().t.settings.savedShortcut });
      } catch (reason) {
        // The old binding stays live on failure, so nothing is lost.
        setSave({ tone: 'error', message: String(reason) });
      }
    },
    [],
  );

  const setShortcutRecording = useCallback(async (recording: boolean) => {
    try {
      await invoke('set_shortcut_recording', { recording });
    } catch (reason) {
      setSave({ tone: 'error', message: String(reason) });
      throw reason;
    }
  }, []);

  const toggleAutostart = useCallback(async (enabled: boolean) => {
    try {
      await invoke('set_autostart', { enabled });
      setAutostart(enabled);
      const currentT = useI18n.getState().t;
      setSave({
        tone: 'saved',
        message: enabled ? currentT.settings.savedAutostartOn : currentT.settings.savedAutostartOff,
      });
    } catch (reason) {
      setSave({ tone: 'error', message: String(reason) });
    }
  }, []);

  const changeLanguage = useCallback(
    async (nextLocale: Locale) => {
      if (nextLocale === locale) return;
      try {
        await setLocale(nextLocale);
        setSave({
          tone: 'saved',
          message: useI18n.getState().t.settings.savedLanguage,
        });
      } catch (reason) {
        setSave({ tone: 'error', message: String(reason) });
      }
    },
    [locale, setLocale],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-content-muted">{t.common.loading}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold tracking-tight text-content-primary">
            {t.settings.title}
          </h1>
          <p className="mt-1 text-sm text-content-muted">{t.settings.subtitle}</p>
        </div>
        <div className="grid max-w-3xl gap-4 md:grid-cols-2">
          <Section
            icon={<IconKeyboard size={18} stroke={1.75} />}
            title={t.settings.shortcutTitle}
            description={isMac ? t.settings.shortcutDescMac : t.settings.shortcutDescWindows}
          >
            <ShortcutRecorder
              value={shortcut}
              onRecord={applyShortcut}
              onRecordingChange={setShortcutRecording}
            />
          </Section>

          <Section
            icon={<IconPower size={18} stroke={1.75} />}
            title={t.settings.autostartTitle}
            description={t.settings.autostartDesc}
          >
            <Toggle
              checked={autostart}
              onChange={toggleAutostart}
              label={autostart ? t.settings.enabled : t.settings.disabled}
            />
          </Section>

          <Section
            icon={<IconLanguage size={18} stroke={1.75} />}
            title={t.settings.languageTitle}
            description={t.settings.languageDesc}
          >
            <div className="flex gap-1.5 rounded-xl bg-surface-700/80 p-1">
              {SUPPORTED_LOCALES.map((item) => {
                const active = locale === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void changeLanguage(item.id)}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? 'bg-accent text-white shadow-sm'
                        : 'text-content-secondary hover:bg-surface-600 hover:text-content-primary'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </Section>
        </div>
      </div>

      {save.tone !== 'idle' && (
        <footer
          className={`flex items-center gap-2 border-t px-6 py-3 text-xs ${
            save.tone === 'error'
              ? 'border-red-500/30 bg-red-500/10 text-red-400'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          }`}
        >
          {save.tone === 'error' ? (
            <IconAlertTriangle size={15} stroke={1.75} className="shrink-0" />
          ) : (
            <IconCheck size={15} stroke={2} className="shrink-0" />
          )}
          <span className="min-w-0 break-words">{save.message}</span>
        </footer>
      )}
    </div>
  );
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}

function Section({ icon, title, description, children }: SectionProps) {
  return (
    <section className="rounded-2xl border border-white/7 bg-surface-800/62 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.16)]">
      <div className="mb-1 flex items-center gap-2 text-content-primary">
        <span className="text-accent">{icon}</span>
        <h2 className="text-sm font-extrabold">{title}</h2>
      </div>
      <p className="mb-3.5 text-xs leading-relaxed text-content-muted">{description}</p>
      {children}
    </section>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5"
    >
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${
          checked ? 'bg-accent' : 'bg-surface-600'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            checked ? 'left-[1.125rem]' : 'left-0.5'
          }`}
        />
      </span>
      <span className="text-xs text-content-secondary">{label}</span>
    </button>
  );
}
