/**
 * @vitest-environment jsdom
 *
 * Bloco de resumo do Drawer da Fila de Downloads.
 * Cobre: contagens (mesma classificação das tabs), total baixado,
 * atualização após mudança de estado e independência da lista rolável.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mock = vi.hoisted(() => {
  const downloads = new Map();
  let onChange = null;
  return {
    downloads,
    getActiveDownloads: () => downloads,
    setOnChange: (cb) => { onChange = cb; },
    dismissDownload: (ad) => downloads.delete(ad.item.id),
    restartDownload: vi.fn(),
    notifyChange: () => { if (onChange) onChange(downloads); },
  };
});

vi.mock('../../scripts/downloader.js', () => ({
  DOWNLOAD_MAX_ATTEMPTS: 3,
  cancelActiveDownload: vi.fn(ad => ad.controller?.abort()),
  getActiveDownloads: mock.getActiveDownloads,
  setOnChange: mock.setOnChange,
  dismissDownload: mock.dismissDownload,
  restartDownload: mock.restartDownload,
}));

vi.mock('../../scripts/i18n.js', () => ({
  t: (key, params = {}) => {
    const dict = {
      'nav.queue': 'Fila de Downloads',
      'actions.close': 'Fechar',
      'queue.clear_done': 'Limpar concluídos',
      'queue.clear_failed': 'Limpar falhas',
      'queue.empty': 'Nenhum download em andamento',
      'queue.tab_active': 'Ativos',
      'queue.tab_completed': 'Concluídos',
      'queue.tab_failed': 'Falhas',
      'queue.summary': 'Resumo',
      'queue.total_downloaded': 'Total baixado',
      'dl.error': 'Erro no download',
      'dl.complete': 'Download concluído!',
      'dl.paused': 'Pausado',
      'dl.downloading': 'Baixando',
      'dl.pause': 'Pausar',
      'dl.resume': 'Continuar',
      'dl.cancel': 'Cancelar',
    };
    let value = dict[key] ?? key;
    for (const [k, v] of Object.entries(params)) {
      value = value.replaceAll(`{${k}}`, v);
    }
    return value;
  },
}));

import { initQueue } from '../../scripts/download-queue.js';
import { toggleRightPanel, closeRightPanel } from '../../scripts/right-panel.js';

function makeItem(id, over = {}) {
  return {
    item: { id, name: `item-${id}` },
    state: 'downloading',
    paused: false,
    _done: false,
    receivedLength: 0,
    totalLength: 0,
    speed: 0,
    ...over,
  };
}

function openDrawer() {
  toggleRightPanel('downloads');
  const panel = document.getElementById('download-queue-panel');
  expect(panel).toBeTruthy();
  return panel;
}

function summaryValue(panel, key) {
  return panel.querySelector(`.queue-summary-value[data-summary="${key}"]`).textContent;
}

beforeEach(() => {
  const panelEl = document.getElementById('download-queue-panel');
  document.body.innerHTML = '<button id="queue-toggle-btn"></button>';
  if (panelEl) document.body.appendChild(panelEl);
  mock.downloads.clear();
  initQueue();
});

afterEach(() => {
  closeRightPanel();
  mock.downloads.clear();
});

describe('resumo da Fila de Downloads', () => {
  it('contabiliza ativos, concluídos e falhas usando a mesma classificação das tabs', () => {
    mock.downloads.set('a1', makeItem('a1', { receivedLength: 10, totalLength: 100 }));
    mock.downloads.set('a2', makeItem('a2', { paused: true, state: 'paused', receivedLength: 20, totalLength: 100 }));
    mock.downloads.set('c1', makeItem('c1', { _done: true, state: 'completed', receivedLength: 50, totalLength: 50 }));
    mock.downloads.set('c2', makeItem('c2', { _done: true, state: 'completed', receivedLength: 60, totalLength: 60 }));
    mock.downloads.set('f1', makeItem('f1', { _done: true, state: 'error', receivedLength: 10, totalLength: 200 }));

    const panel = openDrawer();

    expect(summaryValue(panel, 'active')).toBe('2');
    expect(summaryValue(panel, 'completed')).toBe('2');
    expect(summaryValue(panel, 'failed')).toBe('1');
  });

  it('soma o total de bytes recebidos de todos os itens da fila', () => {
    mock.downloads.set('a1', makeItem('a1', { receivedLength: 2400000, totalLength: 10000000 }));
    mock.downloads.set('a2', makeItem('a2', { receivedLength: 3000000, totalLength: 5000000 }));
    mock.downloads.set('c1', makeItem('c1', { _done: true, state: 'completed', receivedLength: 500000 }));
    mock.downloads.set('f1', makeItem('f1', { _done: true, state: 'error', receivedLength: 100000 }));

    const panel = openDrawer();
    const total = summaryValue(panel, 'total');
    expect(total).toBe('5.72 MB');
  });

  it('atualiza contagens e total após mudança de estado', () => {
    mock.downloads.set('d1', makeItem('d1', { receivedLength: 1000 }));
    const panel = openDrawer();
    expect(summaryValue(panel, 'active')).toBe('1');
    expect(summaryValue(panel, 'completed')).toBe('0');
    expect(summaryValue(panel, 'total')).toBe('1000 B');

    const d1 = mock.downloads.get('d1');
    d1._done = true;
    d1.state = 'completed';
    mock.notifyChange();

    expect(summaryValue(panel, 'active')).toBe('0');
    expect(summaryValue(panel, 'completed')).toBe('1');
    expect(summaryValue(panel, 'total')).toBe('1000 B');
  });

  it('permanece fora do container rolável da lista', () => {
    const panel = openDrawer();
    const body = panel.querySelector('.queue-panel-body');
    const summary = panel.querySelector('.queue-summary');

    expect(panel.contains(summary)).toBe(true);
    expect(body.contains(summary)).toBe(false);
    expect(body).not.toBe(null);
  });
});
