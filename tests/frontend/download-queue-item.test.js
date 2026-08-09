/**
 * @vitest-environment jsdom
 *
 * Item individual da Fila de Downloads (drawer).
 * Cobre: markup base por estado (downloading/paused/completed/error),
 * ações funcionais (pause alterna, cancel abort), chip de tipo e
 * reutilização do item base entre abas.
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
      'queue.download_again': 'Baixar novamente',
      'queue.remove': 'Remover',
      'actions.copy_link': 'Copiar Link',
      'queue.empty': 'Nenhum download em andamento',
      'queue.empty_completed': 'Nenhum download concluído',
      'queue.empty_failed': 'Nenhuma falha de download',
      'queue.tab_active': 'Ativos',
      'queue.tab_completed': 'Concluídos',
      'queue.tab_failed': 'Falhas',
      'dl.error': 'Erro no download',
      'dl.complete': 'Download concluído!',
      'dl.paused': 'Pausado',
      'dl.downloading': 'Baixando',
      'dl.pause': 'Pausar',
      'dl.resume': 'Continuar',
      'dl.cancel': 'Cancelar',
      'dl.attempt': 'Tentativa {attempt}/{max}',
      'dl.retry_wait': 'Aguardando nova tentativa',
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
    item: { id, name: `video-${id}.mp4`, type: 'video', ext: 'mp4' },
    state: 'downloading',
    paused: false,
    _done: false,
    receivedLength: 0,
    totalLength: 0,
    speed: 0,
    attempt: 1,
    controller: { abort: vi.fn() },
    ...over,
  };
}

function openDrawer() {
  toggleRightPanel('downloads');
  const panel = document.getElementById('download-queue-panel');
  expect(panel).toBeTruthy();
  return panel;
}

function item(panel, id) {
  return [...panel.querySelectorAll('.queue-item')].find(el =>
    el.querySelector('.queue-btn')?.dataset.id === id);
}

function buttons(panel, id) {
  return [...panel.querySelectorAll('.queue-btn')].filter(b => b.dataset.id === id);
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

describe('item da Fila de Downloads', () => {
  it('ativo renderiza nome, tipo, progresso, informações e ações', () => {
    const ad = makeItem('d1', { receivedLength: 2400000, totalLength: 10000000, speed: 3200000 });
    mock.downloads.set('d1', ad);

    const panel = openDrawer();
    const el = item(panel, 'd1');

    expect(el.dataset.state).toBe('downloading');
    expect(el.querySelector('.queue-item-type').textContent).toBe('VIDEO');
    expect(el.querySelector('.queue-item-name').textContent).toBe('video-d1.mp4');
    expect(el.querySelector('.queue-item-sub').textContent).toContain('Baixando');
    expect(el.querySelector('.queue-item-sub').textContent).toContain('2.29 MB / 9.54 MB');
    expect(el.querySelector('.queue-item-sub').textContent).toContain('3.05 MB/s');
    expect(el.querySelector('.queue-item-sub').textContent).toContain('24%');
    expect(el.querySelector('.queue-item-progress .progress-bar-fill').style.width).toBe('24%');

    const act = buttons(panel, 'd1');
    expect(act.map(b => b.dataset.action).sort()).toEqual(['cancel', 'pause']);
    expect(act.find(b => b.dataset.action === 'pause').textContent).toBe('Pausar');
    expect(el.querySelector('.queue-item-dismiss')).toBeNull();
  });

  it('paused alterna Pausar → Continuar e volta ao clicar', () => {
    const ad = makeItem('d1', { paused: true, state: 'paused', receivedLength: 500, totalLength: 1000, speed: 100 });
    mock.downloads.set('d1', ad);

    const panel = openDrawer();
    const pauseBtn = buttons(panel, 'd1').find(b => b.dataset.action === 'pause');

    expect(panel.querySelector('.queue-item').dataset.state).toBe('paused');
    expect(pauseBtn.textContent).toBe('Continuar');

    pauseBtn.click();
    expect(ad.paused).toBe(false);
    expect(buttons(panel, 'd1').find(b => b.dataset.action === 'pause').textContent).toBe('Pausar');
  });

  it('cancelar aborta o controller (ação funcional preservada)', () => {
    const ad = makeItem('d1');
    mock.downloads.set('d1', ad);

    const panel = openDrawer();
    const cancelBtn = buttons(panel, 'd1').find(b => b.dataset.action === 'cancel');
    cancelBtn.click();

    expect(ad.controller.abort).toHaveBeenCalled();
  });

  it('backoff mostra tentativa atual e mantém somente o cancelamento', () => {
    mock.downloads.set('d1', makeItem('d1', { waitingRetry: true, attempt: 2 }));
    const panel = openDrawer();
    const el = item(panel, 'd1');
    expect(el.querySelector('.queue-item-sub').textContent).toContain('Tentativa 2/3');
    expect(el.querySelector('.queue-item-sub').textContent).toContain('Aguardando nova tentativa');
    expect(buttons(panel, 'd1').map(button => button.dataset.action)).toEqual(['cancel']);
  });

  it('completed renderiza estado concluído com progresso 100% e dismiss', () => {
    const ad = makeItem('d1', { _done: true, state: 'completed', receivedLength: 100, totalLength: 100 });
    mock.downloads.set('d1', ad);

    const panel = openDrawer();
    panel.querySelector('.queue-tab[data-queue-tab="completed"]').click();
    const el = item(panel, 'd1');

    expect(el.dataset.state).toBe('completed');
    expect(el.querySelector('.queue-status-done').textContent).toBe('Download concluído!');
    expect(el.querySelector('.queue-item-progress .progress-bar-fill').style.width).toBe('100%');
    expect(buttons(panel, 'd1').map(b => b.dataset.action)).toEqual(['restart', 'copy', 'dismiss']);
  });

  it('failed usa estado de erro com barra vazia e dismiss', () => {
    const ad = makeItem('d1', { _done: true, state: 'error' });
    mock.downloads.set('d1', ad);

    const panel = openDrawer();
    panel.querySelector('.queue-tab[data-queue-tab="failed"]').click();
    const el = item(panel, 'd1');

    expect(el.dataset.state).toBe('error');
    expect(el.querySelector('.queue-status-error').textContent).toBe('Erro no download');
    expect(el.querySelector('.queue-item-progress .progress-bar-fill').style.width).toBe('0%');
    expect(buttons(panel, 'd1').map(b => b.dataset.action)).toEqual(['restart', 'copy', 'dismiss']);
  });

  it('ações do histórico repetem e removem o registro', () => {
    const ad = makeItem('d1', { _done: true, state: 'completed' });
    mock.downloads.set('d1', ad);
    const panel = openDrawer();
    panel.querySelector('.queue-tab[data-queue-tab="completed"]').click();

    buttons(panel, 'd1').find(b => b.dataset.action === 'restart').click();
    expect(mock.restartDownload).toHaveBeenCalledWith(ad);

    buttons(panel, 'd1').find(b => b.dataset.action === 'dismiss').click();
    expect(mock.downloads.has('d1')).toBe(false);
  });

  it('usa a miniatura quando disponível e cai para o chip de tipo em caso de erro', () => {
    const ad = makeItem('d1', {
      item: { id: 'd1', name: 'video-d1.mp4', type: 'video', ext: 'mp4', thumbnail: '/thumb.jpg' },
    });
    mock.downloads.set('d1', ad);

    const panel = openDrawer();
    const img = panel.querySelector('.queue-item-thumb');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/thumb.jpg');
    expect(img.dataset.fallback).toBe('VIDEO');

    img.dispatchEvent(new Event('error', { bubbles: true }));
    expect(panel.querySelector('.queue-item-thumb')).toBeNull();
    const chip = panel.querySelector('.queue-item-type');
    expect(chip).toBeTruthy();
    expect(chip.textContent).toBe('VIDEO');
  });

  it('aba Concluídos usa o mesmo item base do markup', () => {
    mock.downloads.set('c1', makeItem('c1', { _done: true, state: 'completed' }));
    mock.downloads.set('d1', makeItem('d1'));

    const panel = openDrawer();
    panel.querySelector('.queue-tab[data-queue-tab="completed"]').click();

    const el = item(panel, 'c1');
    expect(el).toBeTruthy();
    expect(el.querySelector('.queue-item-head')).toBeTruthy();
    expect(el.querySelector('.queue-item-sub')).toBeTruthy();
    expect(el.querySelector('.queue-item-progress')).toBeTruthy();
    expect(el.querySelector('.queue-item-history-actions')).toBeTruthy();
    expect(item(panel, 'd1')).toBeUndefined();

    const activeEl = panel.querySelector('.queue-item[data-state="downloading"]');
    expect(el.dataset.state).toBe('completed');
  });
});
