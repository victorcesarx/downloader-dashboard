/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../scripts/i18n.js', () => ({
  onLocaleChange: vi.fn(),
  t: (key, params = {}) => {
    const values = {
      'common.unknown': 'Desconhecido',
      'common.known_plus_unknown': '{size} + {count} desconhecido(s)',
    };
    let value = values[key] || key;
    for (const [name, replacement] of Object.entries(params)) value = value.replaceAll(`{${name}}`, replacement);
    return value;
  },
}));

import { formatMediaSize, formatSizeSummary, isKnownSize, summarizeMediaSizes } from '../../scripts/media-size.js';
import { buildCardHtml } from '../../scripts/renderer/cards.js';
import { updateBatchActionsUI } from '../../scripts/renderer/batch.js';
import { store } from '../../scripts/state.js';

describe('estado de tamanho de mídia', () => {
  it('diferencia arquivo vazio de tamanho desconhecido', () => {
    expect(isKnownSize(0)).toBe(true);
    expect(formatMediaSize(0)).toBe('0 B');
    expect(isKnownSize(null)).toBe(false);
    expect(formatMediaSize(null)).toBe('Desconhecido');
  });

  it('soma somente valores conhecidos e sinaliza os desconhecidos', () => {
    expect(summarizeMediaSizes([{ size: 1024 }, { size: null }, { size: 0 }])).toEqual({
      knownBytes: 1024,
      unknownCount: 1,
      allKnown: false,
    });
    expect(formatSizeSummary([{ size: 1024 }, { size: null }])).toBe('1 KB + 1 desconhecido(s)');
    expect(formatSizeSummary([{ size: null }])).toBe('Desconhecido');
  });

  it('cards e total selecionado exibem o estado parcial sem somar desconhecidos como zero', () => {
    const unknown = { id: 'u', type: 'video', name: 'unknown.mp4', ext: 'mp4', size: null };
    const known = { id: 'k', type: 'video', name: 'known.mp4', ext: 'mp4', size: 1024 };
    const empty = { id: 'e', type: 'video', name: 'empty.mp4', ext: 'mp4', size: 0 };
    expect(buildCardHtml(unknown, false)).toContain('Desconhecido');
    expect(buildCardHtml(empty, false)).toContain('0 B');

    document.body.innerHTML = '<button id="download-selected-btn"><span id="total-size-display"></span></button>';
    store.state.items = [unknown, known];
    store.state.selectedItemIds = new Set(['u', 'k']);
    updateBatchActionsUI();
    expect(document.getElementById('total-size-display').textContent).toBe('(1 KB + 1 desconhecido(s))');
  });
});
