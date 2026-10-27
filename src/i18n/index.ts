/**
 * Internationalization store and hooks (English & Brazilian Portuguese).
 *
 * Syncs with both localStorage (for zero-latency initial paint in every
 * window) and the Tauri backend (so the system tray menu and persisted
 * settings.json stay in lockstep).
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { en, type Translations } from './locales/en';
import { ptBR } from './locales/pt-BR';

export type Locale = 'en' | 'pt-BR';

export const SUPPORTED_LOCALES: readonly { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'pt-BR', label: 'Português (Brasil)' },
] as const;

const STORAGE_KEY = 'prin.locale';

const DICTIONARIES: Record<Locale, Translations> = {
  en,
  'pt-BR': ptBR,
};

export function normalizeLocale(input: string | null | undefined): Locale {
  if (!input) return detectSystemLocale();
  return input.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

export function detectSystemLocale(): Locale {
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
  }
  return 'en';
}

function readInitialLocale(): Locale {
  try {
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached === 'en' || cached === 'pt-BR') return cached;
    }
  } catch {
    // Ignore storage access errors in restricted environments.
  }
  return detectSystemLocale();
}

function writeCachedLocale(locale: Locale): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, locale);
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  } catch {
    // Ignore storage access errors.
  }
}

interface I18nState {
  locale: Locale;
  t: Translations;
  applyLocale: (locale: Locale) => void;
  setLocale: (locale: Locale) => Promise<void>;
}

const initialLocale = readInitialLocale();
writeCachedLocale(initialLocale);

export const useI18n = create<I18nState>((set) => ({
  locale: initialLocale,
  t: DICTIONARIES[initialLocale],

  applyLocale: (locale) => {
    const normalized = normalizeLocale(locale);
    writeCachedLocale(normalized);
    set({ locale: normalized, t: DICTIONARIES[normalized] });
  },

  setLocale: async (locale) => {
    const normalized = normalizeLocale(locale);
    writeCachedLocale(normalized);
    set({ locale: normalized, t: DICTIONARIES[normalized] });
    await invoke('set_language', { language: normalized });
  },
}));

let initializedSync = false;

/**
 * Synchronizes the frontend locale with the Rust backend store and listens for
 * cross-window language changes (`language-changed`).
 */
export function initI18nSync(): void {
  if (initializedSync || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return;
  }
  initializedSync = true;

  void invoke<string | null>('active_language')
    .then((saved) => {
      if (saved) {
        useI18n.getState().applyLocale(normalizeLocale(saved));
      } else {
        // Persist detected OS language on first run so the tray matches the UI.
        const current = useI18n.getState().locale;
        void invoke('set_language', { language: current }).catch(() => {});
      }
    })
    .catch(() => {});

  void listen<string>('language-changed', (event) => {
    useI18n.getState().applyLocale(normalizeLocale(event.payload));
  });
}
