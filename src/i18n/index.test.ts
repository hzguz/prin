import { describe, expect, it } from 'vitest';
import { normalizeLocale, useI18n } from './index';

describe('i18n', () => {
  it('normalizes Portuguese locale codes to pt-BR and others to en', () => {
    expect(normalizeLocale('pt')).toBe('pt-BR');
    expect(normalizeLocale('pt-BR')).toBe('pt-BR');
    expect(normalizeLocale('pt-PT')).toBe('pt-BR');
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('es-ES')).toBe('en');
  });

  it('switches active dictionary when applyLocale is called', () => {
    useI18n.getState().applyLocale('pt-BR');
    expect(useI18n.getState().locale).toBe('pt-BR');
    expect(useI18n.getState().t.toolbar.saveButton).toBe('Salvar Captura');

    useI18n.getState().applyLocale('en');
    expect(useI18n.getState().locale).toBe('en');
    expect(useI18n.getState().t.toolbar.saveButton).toBe('Save Capture');
  });
});
