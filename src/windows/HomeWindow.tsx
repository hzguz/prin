import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';
import {
  IconBolt,
  IconCapture,
  IconCheck,
  IconKeyboard,
  IconPhotoEdit,
} from '@tabler/icons-react';
import { TitleBar } from '../components/window/TitleBar';
import { useI18n } from '../i18n';
import { SettingsWindow } from './SettingsWindow';

type MainTab = 'home' | 'settings';

export function HomeWindow() {
  const [activeTab, setActiveTab] = useState<MainTab>('home');
  const [error, setError] = useState<string | null>(null);
  const [shortcut, setShortcut] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const t = useI18n((state) => state.t);

  useEffect(() => {
    const unlisten = listen('navigate-settings', () => setActiveTab('settings'));
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  // Refresh the displayed hotkey whenever returning to the home tab so changes
  // recorded in Settings are reflected immediately.
  useEffect(() => {
    if (activeTab !== 'home') return;
    invoke<string | null>('active_shortcut')
      .then(setShortcut)
      .catch(() => setShortcut(null));
  }, [activeTab]);

  const startCapture = async () => {
    setCapturing(true);
    setError(null);
    try {
      await invoke('open_overlay');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setCapturing(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = document.body.dataset.platform === 'macos';
      const isMod = isMac ? event.metaKey : event.ctrlKey;

      if (isMod && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        void getCurrentWindow().hide();
        return;
      }
      if (isMod && event.key === ',') {
        event.preventDefault();
        setActiveTab('settings');
        return;
      }
      if (isMod && event.key === '1') {
        event.preventDefault();
        setActiveTab('home');
        return;
      }
      if (isMod && event.key === '2') {
        event.preventDefault();
        setActiveTab('settings');
        return;
      }
      if (isMod && event.key === 'Enter' && activeTab === 'home') {
        event.preventDefault();
        void startCapture();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        void getCurrentWindow().hide();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab]);

  return (
    <div className="app-shell flex h-screen flex-col overflow-hidden bg-surface-900">
      <TitleBar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="pointer-events-none absolute -top-52 left-1/2 h-[460px] w-[680px] -translate-x-1/2 rounded-full bg-accent/10 blur-[110px]" />
        {activeTab === 'settings' ? (
          <div className="animate-fade-in relative h-full">
            <SettingsWindow />
          </div>
        ) : (
          <div className="animate-fade-in relative mx-auto flex h-full max-w-5xl items-center px-10 py-8">
            <div className="grid w-full items-center gap-12 md:grid-cols-[1.15fr_0.85fr]">
              <section>
                <h1 className="max-w-xl text-4xl font-extrabold leading-[1.08] tracking-[-0.035em] text-content-primary xl:text-5xl">
                  {t.home.heroTitlePrefix}
                  <span className="bg-gradient-to-r from-[#6366f1] to-[#989aff] bg-clip-text text-transparent">
                    {t.home.heroTitleHighlight}
                  </span>
                  {t.home.heroTitleLineBreak}
                  <br />
                  {t.home.heroTitleSuffix}
                </h1>
                <p className="mt-4 max-w-lg text-[15px] leading-7 text-content-secondary">
                  {t.home.heroSubtitleLine1}
                  <br />
                  {t.home.heroSubtitleLine2}
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void startCapture()}
                    disabled={capturing}
                    className="group flex h-12 min-w-40 items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#6366f1] to-[#989aff] px-5 text-sm font-semibold text-white shadow-[0_14px_35px_rgba(99,102,241,0.3)] transition hover:-translate-y-0.5 hover:brightness-110 disabled:pointer-events-none disabled:opacity-60"
                  >
                    <IconCapture size={19} stroke={1.8} className="transition group-hover:scale-105" />
                    {capturing ? t.home.openingCapture : t.home.newCapture}
                  </button>
                  {shortcut && (
                    <div className="flex h-12 min-w-40 items-center justify-center gap-2 rounded-xl border border-white/7 bg-white/[0.035] px-4 text-xs text-content-muted">
                      <IconKeyboard size={16} stroke={1.7} />
                      <kbd className="font-mono text-content-secondary">{shortcut}</kbd>
                    </div>
                  )}
                </div>

                {error && (
                  <p className="mt-4 max-w-lg rounded-xl border border-red-500/20 bg-red-500/8 px-3 py-2 font-mono text-xs text-red-400">
                    {error}
                  </p>
                )}
              </section>

              <aside className="relative rounded-[28px] border border-white/8 bg-surface-800/58 p-2 shadow-[0_28px_90px_rgba(0,0,0,0.36)] backdrop-blur-xl">
                <div className="rounded-[22px] border border-white/6 bg-surface-900/75 px-6 pt-6 pb-3">
                  <div className="mb-1">
                    <div>
                      <p className="text-xs font-extrabold text-content-primary">{t.home.workflowTitle}</p>
                      <p className="mt-1 text-[11px] text-content-muted">{t.home.workflowSubtitle}</p>
                    </div>
                  </div>
                  <Feature
                    icon={<IconBolt size={17} />}
                    title={t.home.featureInstantTitle}
                    description={t.home.featureInstantDesc}
                  />
                  <Feature
                    icon={<IconPhotoEdit size={17} />}
                    title={t.home.featureContextTitle}
                    description={t.home.featureContextDesc}
                  />
                  <Feature
                    icon={<IconCheck size={17} />}
                    title={t.home.featureCopyTitle}
                    description={t.home.featureCopyDesc}
                    last
                  />
                </div>
              </aside>
            </div>
          </div>
        )}
      </main>

      <footer className="flex h-9 shrink-0 items-center justify-between border-t border-white/6 px-4 text-[10px] text-content-muted">
        <span>{t.home.trayFooter}</span>
        <span className="font-mono">v0.1.1</span>
      </footer>
    </div>
  );
}

interface FeatureProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  last?: boolean;
}

function Feature({ icon, title, description, last = false }: FeatureProps) {
  return (
    <div className={`flex items-center gap-3 py-4 ${last ? '' : 'border-b border-white/6'}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">{icon}</span>
      <div>
        <p className="text-xs font-extrabold text-content-primary">{title}</p>
        <p className="mt-0.5 text-[11px] text-content-muted">{description}</p>
      </div>
    </div>
  );
}
