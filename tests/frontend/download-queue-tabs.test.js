/**
 * @vitest-environment jsdom
 *
 * Abas do Drawer da Fila de Downloads (download-queue.js).
 * Cobre: aba inicial, contagens por categoria, filtragem por clique,
 * empty states por aba e atualização de contagem após mudança de estado.
 *
 * Fonte de verdade simulada: Map de activeDownloads (mesma do downloader.js).
 * Regras de classificação (espelho do código):
 *  - Falhas:      ad.state === 'error'
 *  - Concluídos:  ad._done && não-falha
 *  - Ativos:      todo o resto (downloading, paused, idle)
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
      'queue.active_one': '{count} download ativo',
      'queue.active_other': '{count} downloads ativos',
      'dl.error': 'Erro no download',
      'dl.complete': 'Download concluído!',
      'dl.paused': 'Pausado',
      'dl.downloading': 'Baixando',
      'dl.pause': 'Pausar',
      'dl.resume': 'Retomar',
      'dl.cancel': 'Cancelar',
      'dl.queued': 'Na fila',
      'zip.download_ready': 'ZIP pronto para download',
      'zip.queued_position': 'Aguardando na fila — posição {position}',
      'zip.queued_waiting': 'Aguardando na fila',
      'zip.progress': 'Processando arquivo {current} de {total}',
      'zip.download_btn': 'Baixar ZIP Agora',
      'zip.report_summary': 'Relatório: {completed} concluído(s), {failed} falho(s), {ignored} ignorado(s)',
      'zip.report_completed': 'Concluído',
      'zip.report_failed': 'Falhou',
      'zip.report_ignored': 'Ignorado',
      'zip.report_pending': 'Pendente',
      'zip.retry_failed': 'Tentar falhas ({count})',
      'zip.export_json': 'Exportar JSON',
      'zip.export_text': 'Exportar texto',
      'actions.close_btn': 'Fechar',
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
import { addZipQueueTask, clearZipQueueForTests, updateZipQueueTask } from '../../scripts/zip-queue.js';

function makeItem(id, over = {}) {
  return {
    item: { id, name: `item-${id}.mp4` },
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
  return document.getElementById('download-queue-panel');
}

function activeDrawer() {
  const panel = openDrawer();
  expect(panel).toBeTruthy();
  return panel;
}

function tabs(panel) {
  return [...panel.querySelectorAll('.queue-tab')];
}

function tab(panel, id) {
  return panel.querySelector(`.queue-tab[data-queue-tab="${id}"]`);
}

function bodyText(panel) {
  return panel.querySelector('.queue-panel-body').textContent.trim();
}

beforeEach(() => {
  const panelEl = document.getElementById('download-queue-panel');
  document.body.innerHTML = '<button id="queue-toggle-btn"></button>';
  if (panelEl) document.body.appendChild(panelEl);
  mock.downloads.clear();
  clearZipQueueForTests();
  initQueue();
});

afterEach(() => {
  closeRightPanel();
  mock.downloads.clear();
  clearZipQueueForTests();
});

describe('abas da Fila de Downloads', () => {
  it('clique programático fora do drawer (a.click() do download) não fecha a fila', () => {
    const panel = activeDrawer();
    const anchor = document.createElement('a');
    anchor.href = 'blob:fake';
    document.body.appendChild(anchor);
    anchor.click();

    expect(panel.classList.contains('open')).toBe(true);
  });

  it('abre com a aba Ativos selecionada por padrão', () => {
    mock.downloads.set('a1', makeItem('a1'));
    const panel = activeDrawer();
    const active = tab(panel, 'active');
    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(tab(panel, 'completed').getAttribute('aria-selected')).toBe('false');
    expect(tab(panel, 'failed').getAttribute('aria-selected')).toBe('false');
  });

  it('contagens corretas por categoria (pausado conta como ativo)', () => {
    mock.downloads.set('d1', makeItem('d1'));
    mock.downloads.set('p1', makeItem('p1', { paused: true, state: 'paused' }));
    mock.downloads.set('c1', makeItem('c1', { _done: true, state: 'completed' }));
    mock.downloads.set('c2', makeItem('c2', { _done: true, state: 'completed' }));
    mock.downloads.set('e1', makeItem('e1', { _done: true, state: 'error' }));

    const panel = activeDrawer();
    expect(tab(panel, 'active').textContent).toBe('Ativos (2)');
    expect(tab(panel, 'completed').textContent).toBe('Concluídos (2)');
    expect(tab(panel, 'failed').textContent).toBe('Falhas (1)');
  });

  it('clicar em Concluídos filtra a lista e atualiza aria-selected', () => {
    mock.downloads.set('a1', makeItem('a1'));
    mock.downloads.set('c1', makeItem('c1', { _done: true, state: 'completed' }));
    mock.downloads.set('c2', makeItem('c2', { _done: true, state: 'completed' }));

    const panel = activeDrawer();
    expect(bodyText(panel)).toContain('item-a1.mp4');
    expect(bodyText(panel)).not.toContain('item-c1.mp4');

    tab(panel, 'completed').click();
    expect(tab(panel, 'completed').getAttribute('aria-selected')).toBe('true');
    expect(tab(panel, 'active').getAttribute('aria-selected')).toBe('false');
    expect(bodyText(panel)).toContain('item-c1.mp4');
    expect(bodyText(panel)).toContain('item-c2.mp4');
    expect(bodyText(panel)).not.toContain('item-a1.mp4');
  });

  it('clicar em Falhas filtra a lista', () => {
    mock.downloads.set('a1', makeItem('a1'));
    mock.downloads.set('e1', makeItem('e1', { _done: true, state: 'error' }));

    const panel = activeDrawer();
    expect(bodyText(panel)).not.toContain('item-e1.mp4');

    tab(panel, 'failed').click();
    expect(tab(panel, 'failed').getAttribute('aria-selected')).toBe('true');
    expect(bodyText(panel)).toContain('item-e1.mp4');
    expect(bodyText(panel)).not.toContain('item-a1.mp4');
  });

  it('empty state específico por aba', () => {
    const panel = activeDrawer();
    expect(bodyText(panel)).toBe('Nenhum download em andamento');

    tab(panel, 'completed').click();
    expect(bodyText(panel)).toBe('Nenhum download concluído');

    tab(panel, 'failed').click();
    expect(bodyText(panel)).toBe('Nenhuma falha de download');
  });

  it('contagens atualizam após mudança de estado', () => {
    mock.downloads.set('d1', makeItem('d1'));
    const panel = activeDrawer();
    expect(tab(panel, 'active').textContent).toBe('Ativos (1)');

    const d1 = mock.downloads.get('d1');
    d1._done = true;
    d1.state = 'completed';
    mock.notifyChange();

    expect(tab(panel, 'active').textContent).toBe('Ativos (0)');
    expect(tab(panel, 'completed').textContent).toBe('Concluídos (1)');

    tab(panel, 'completed').click();
    expect(bodyText(panel)).toContain('item-d1.mp4');
  });

  it('mostra um ZIP ativo dentro da mesma fila e nunca cria card flutuante', () => {
    addZipQueueTask({
      taskId: 'zip-1', name: 'colecao.zip', total: 3, totalBytes: 3000,
      unknownCount: 0, state: 'queued', queuePosition: 2,
    });

    const panel = activeDrawer();
    expect(tab(panel, 'active').textContent).toBe('Ativos (1)');
    expect(bodyText(panel)).toContain('colecao.zip');
    expect(bodyText(panel)).toContain('ZIP');
    expect(bodyText(panel)).toContain('Aguardando na fila — posição 2');
    expect(bodyText(panel)).toContain('Cancelar');
    expect(document.querySelector('.zip-panel')).toBeNull();
  });

  it('mantém o ZIP pronto em Ativos e só o move após iniciar o download', () => {
    addZipQueueTask({ taskId: 'zip-2', name: 'resultado.zip', total: 2, totalBytes: 2000, unknownCount: 0 });
    const panel = activeDrawer();

    updateZipQueueTask('zip-2', {
      state: 'completed', processed: 2, currentBytes: 2000,
      resultUrl: '/download-zip/result/zip-2',
    });

    expect(tab(panel, 'active').textContent).toBe('Ativos (1)');
    expect(tab(panel, 'completed').textContent).toBe('Concluídos (0)');
    expect(bodyText(panel)).toContain('resultado.zip');
    expect(bodyText(panel)).toContain('ZIP pronto para download');
    expect(bodyText(panel)).toContain('Baixar ZIP Agora');

    panel.querySelector('[data-action="download-zip"]').click();

    expect(tab(panel, 'active').textContent).toBe('Ativos (0)');
    expect(tab(panel, 'completed').textContent).toBe('Concluídos (1)');
    tab(panel, 'completed').click();
    expect(bodyText(panel)).toContain('resultado.zip');
    expect(bodyText(panel)).toContain('Remover');
    expect(bodyText(panel)).not.toContain('Baixar ZIP Agora');
  });

  it('move um ZIP com erro para a aba de falhas', () => {
    addZipQueueTask({ taskId: 'zip-3', name: 'falhou.zip', total: 2, totalBytes: 0, unknownCount: 2 });
    const panel = activeDrawer();
    updateZipQueueTask('zip-3', { state: 'error', errorMsg: 'Sem espaço temporário' });

    expect(tab(panel, 'failed').textContent).toBe('Falhas (1)');
    tab(panel, 'failed').click();
    expect(bodyText(panel)).toContain('falhou.zip');
    expect(bodyText(panel)).toContain('Sem espaço temporário');
  });

  it('exibe o relatório parcial e as ações de retry e exportação no ZIP pronto', () => {
    addZipQueueTask({ taskId: 'zip-report', name: 'parcial.zip', total: 3, totalBytes: 1200, unknownCount: 0 });
    const panel = activeDrawer();
    updateZipQueueTask('zip-report', {
      state: 'completed', processed: 3, currentBytes: 1200,
      resultUrl: '/download-zip/result/zip-report',
      report: [
        { name: 'ok.jpg', outcome: 'completed', reason: null },
        { name: 'fail.jpg', outcome: 'failed', reason: 'HTTP 403' },
        { name: 'stream.m3u8', outcome: 'ignored', reason: 'unsupported hls' },
      ],
    });

    expect(bodyText(panel)).toContain('Relatório: 1 concluído(s), 1 falho(s), 1 ignorado(s)');
    expect(bodyText(panel)).toContain('ok.jpg');
    expect(bodyText(panel)).toContain('fail.jpg');
    expect(bodyText(panel)).toContain('HTTP 403');
    expect(bodyText(panel)).toContain('Tentar falhas (1)');
    expect(bodyText(panel)).toContain('Exportar JSON');
    expect(bodyText(panel)).toContain('Exportar texto');
  });
});
