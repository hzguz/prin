import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  IconMinus,
  IconSettings,
  IconSquare,
  IconX,
} from '@tabler/icons-react';
import appIcon from '../../assets/app-icon.svg';
import { useI18n } from '../../i18n';

interface TitleBarProps {
  activeTab: 'home' | 'settings';
  onTabChange: (tab: 'home' | 'settings') => void;
}

export function TitleBar({ activeTab, onTabChange }: TitleBarProps) {
  const appWindow = getCurrentWindow();
  const t = useI18n((state) => state.t);
  const isMacOS = document.body.dataset.platform === 'macos';

  return (
    <header
      data-tauri-drag-region
      className={`flex h-12 shrink-0 items-center border-b border-white/7 bg-surface-900/92 backdrop-blur-xl ${
        isMacOS ? 'pl-24 pr-4' : 'pl-4 pr-0'
      }`}
    >
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center gap-4"
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          void appWindow.toggleMaximize();
        }}
      >
        <div data-tauri-drag-region className="flex items-center gap-2.5">
          <img
            data-tauri-drag-region
            src={appIcon}
            alt=""
            className="h-6 w-6 drop-shadow-[0_0_12px_rgba(99,102,241,0.45)]"
          />
          <span data-tauri-drag-region className="text-[13px] font-semibold tracking-tight text-content-primary">
            prin
          </span>
        </div>

        <nav className="flex h-full items-center gap-1" aria-label={t.titleBar.navAriaLabel}>
          <TabButton active={activeTab === 'home'} onClick={() => onTabChange('home')}>
            {t.titleBar.captureTab}
          </TabButton>
          <TabButton active={activeTab === 'settings'} onClick={() => onTabChange('settings')}>
            <IconSettings size={14} stroke={1.8} />
            {t.titleBar.settingsTab}
          </TabButton>
        </nav>
      </div>

      {!isMacOS && (
        <div className="flex h-full shrink-0">
          <WindowButton label={t.titleBar.minimize} onClick={() => void appWindow.minimize()}>
            <IconMinus size={16} stroke={1.6} />
          </WindowButton>
          <WindowButton label={t.titleBar.maximize} onClick={() => void appWindow.toggleMaximize()}>
            <IconSquare size={13} stroke={1.6} />
          </WindowButton>
          <WindowButton label={t.titleBar.closeToTray} danger onClick={() => void appWindow.hide()}>
            <IconX size={17} stroke={1.6} />
          </WindowButton>
        </div>
      )}
    </header>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs transition ${
        active
          ? 'bg-white/8 text-content-primary'
          : 'text-content-muted hover:bg-white/5 hover:text-content-secondary'
      }`}
    >
      {children}
      {active && <span className="absolute inset-x-3 -bottom-2 h-px bg-accent" />}
    </button>
  );
}

interface WindowButtonProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}

function WindowButton({ label, onClick, children, danger = false }: WindowButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`grid w-12 place-items-center text-content-muted transition ${
        danger ? 'hover:bg-red-500 hover:text-white' : 'hover:bg-white/8 hover:text-content-primary'
      }`}
    >
      {children}
    </button>
  );
}
