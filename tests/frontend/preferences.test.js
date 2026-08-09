/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('preferências persistentes', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('migra as chaves legadas e normaliza limites', async () => {
    localStorage.setItem('downdash_theme', 'dark');
    localStorage.setItem('downdash_lang', 'en');
    localStorage.setItem('downdash_blur', 'true');
    const { getPreferences, updatePreference } = await import('../../scripts/preferences.js');
    expect(getPreferences()).toMatchObject({ theme: 'dark', lang: 'en', thumbBlurred: true });
    expect(updatePreference('downloadConcurrency', 99).downloadConcurrency).toBe(5);
    expect(updatePreference('historyRetention', 2).historyRetention).toBe(10);
  });

  it('restaura padrões e notifica assinantes', async () => {
    const { DEFAULT_PREFERENCES, resetPreferences, subscribePreferences, updatePreference } = await import('../../scripts/preferences.js');
    const listener = vi.fn();
    subscribePreferences(listener);
    updatePreference('soundEnabled', true);
    const reset = resetPreferences();
    expect(reset).toEqual(DEFAULT_PREFERENCES);
    expect(listener).toHaveBeenLastCalledWith(reset, 'reset');
  });
});
