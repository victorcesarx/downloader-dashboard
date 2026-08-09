/** @vitest-environment jsdom */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadLocale } from '../../scripts/i18n.js';
import { store } from '../../scripts/state.js';
import { initPreferencesPanel } from '../../scripts/preferences-panel.js';

const labels = {
  preferences: {
    title: 'Preferências', subtitle: 'Configurações do WebScope', appearance: 'Aparência', theme: 'Tema',
    theme_system: 'Sistema', theme_dark: 'Escuro', theme_light: 'Claro', language: 'Idioma', nsfw: 'NSFW',
    nsfw_hint: 'Miniaturas', downloads: 'Downloads', sound: 'Som', sound_hint: 'Aviso', notifications: 'Notificações',
    notifications_hint: 'Fora da aba', quality: 'Qualidade', quality_best: 'Melhor disponível', concurrency: 'Simultâneos',
    concurrency_hint: 'Conexão', history: 'Histórico', retention: 'Registros', retention_hint: 'Sessão', reset: 'Restaurar padrões',
    autosave: 'Salvo automaticamente',
  },
  actions: { close: 'Fechar' },
};

describe('painel de preferências', () => {
  beforeAll(async () => {
    localStorage.clear();
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => labels }));
    await loadLocale('pt-BR');
    document.body.innerHTML = '<button id="preferences-toggle-btn">Preferências</button>';
    initPreferencesPanel();
  });

  it('abre pelo coordenador, persiste mudanças e restaura padrões', async () => {
    document.getElementById('preferences-toggle-btn').click();
    const panel = document.getElementById('preferences-panel');
    expect(panel.classList.contains('open')).toBe(true);
    expect(panel.textContent).toContain('Configurações do WebScope');
    expect(panel.querySelectorAll('.toggle-switch')).toHaveLength(3);
    expect(panel.querySelectorAll('input[type="checkbox"].toggle-switch-input')).toHaveLength(3);
    expect(panel.querySelectorAll('.toggle-switch--theme')).toHaveLength(0);

    const soundToggle = panel.querySelector('[data-pref="soundEnabled"]');
    soundToggle.checked = true;
    soundToggle.dispatchEvent(new Event('change'));
    expect(panel.querySelector('[data-pref="soundEnabled"]')).toBe(soundToggle);
    expect(soundToggle.checked).toBe(true);

    const concurrency = panel.querySelector('[data-pref="downloadConcurrency"]');
    concurrency.value = '5';
    concurrency.dispatchEvent(new Event('change'));
    expect(store.state.downloadConcurrency).toBe(5);

    panel.querySelector('.preferences-reset').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.state.downloadConcurrency).toBe(3);
    expect(panel.querySelector('[data-pref="historyRetention"]').value).toBe('50');
  });
});
