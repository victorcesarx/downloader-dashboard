/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadLocale } from '../../scripts/i18n.js';
import { store } from '../../scripts/state.js';
import { cancelZipTask, exportZipReport, updateZipPanelUI, startPollingStatus, startZipDownload } from '../../scripts/zip-download.js';
import { addZipQueueTask, clearZipQueueForTests, getZipQueueTasks } from '../../scripts/zip-queue.js';
import { closeRightPanel, getActiveRightPanel, openRightPanel } from '../../scripts/right-panel.js';

const mockLocales = {
  zip: {
    title: 'Download em Lote (ZIP)',
    progress: 'Processando arquivo {current} de {total}',
    queued_waiting: 'Aguardando na fila',
    queued_position: 'Aguardando na fila — posição {position}',
    start_error: 'Falha ao iniciar empacotamento ZIP',
    cancel_error: 'Não foi possível cancelar e remover o ZIP.',
    error: {
      queue_full: 'A fila de downloads está cheia. Tente novamente mais tarde.',
      ip_limit: 'Você já possui muitas tarefas ZIP em andamento.',
      too_many_items: 'Você selecionou arquivos demais para um único ZIP.',
      temp_storage_full: 'Não há espaço temporário suficiente para concluir o ZIP.',
      size_limit_exceeded: 'O tamanho máximo permitido para este ZIP foi excedido.',
    },
  },
  actions: { cancel: 'Cancelar' },
  toast: {
    no_media_selected: 'Nenhuma mídia selecionada.',
    streaming_unsupported: 'Este formato de streaming ainda não é suportado para download.',
  },
};

describe('ZIP usa a fila de downloads compartilhada', () => {
  beforeEach(async () => {
    store.state.lang = 'pt-BR';
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/locales/')) {
        return { ok: true, json: async () => mockLocales };
      }
      return { ok: true, json: async () => ({}) };
    });
    await loadLocale('pt-BR');
    document.body.innerHTML = '';
    clearZipQueueForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    closeRightPanel();
    clearZipQueueForTests();
  });

  it('atualiza o registro compartilhado sem criar card flutuante', () => {
    addZipQueueTask({ taskId: 't1', name: 'pacote.zip', total: 3, totalBytes: 3000, unknownCount: 0 });
    updateZipPanelUI('t1', { status: 'queued', processed: 0, total: 3, currentBytes: 0, speed: 0, queuePosition: null });

    expect(getZipQueueTasks().get('t1')).toMatchObject({ state: 'queued', processed: 0, queuePosition: null });
    expect(document.querySelector('.zip-panel')).toBeNull();
  });

  it('mantém posição, progresso, bytes e velocidade na mesma tarefa', () => {
    addZipQueueTask({ taskId: 't2', name: 'pacote.zip', total: 3, totalBytes: 3000, unknownCount: 0 });
    updateZipPanelUI('t2', { status: 'queued', processed: 0, total: 3, currentBytes: 0, speed: 0, queuePosition: 2 });
    expect(getZipQueueTasks().get('t2')).toMatchObject({ state: 'queued', queuePosition: 2 });

    updateZipPanelUI('t2', { status: 'processing', processed: 1, total: 3, currentBytes: 1000, speed: 500, queuePosition: 0 });
    expect(getZipQueueTasks().get('t2')).toMatchObject({
      state: 'processing', processed: 1, currentBytes: 1000, speed: 500, queuePosition: 0,
    });
  });

  it('exporta o relatório final em texto', () => {
    addZipQueueTask({
      taskId: 'report-1', name: 'pacote.zip', total: 2,
      report: [
        { name: 'ok.jpg', outcome: 'completed', reason: null },
        { name: 'fail.jpg', outcome: 'failed', reason: 'HTTP 403' },
      ],
    });
    const downloads = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:report'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function capture() {
      downloads.push(this.download);
    });

    expect(exportZipReport('report-1', 'text')).toBe(true);
    expect(downloads).toEqual(['pacote-report.txt']);
  });

  it('só remove a instância local depois que o backend confirma o cancelamento', async () => {
    addZipQueueTask({ taskId: 'done-1', name: 'pacote.zip', total: 1, state: 'completed' });
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ cancelled: true, removed: true }) }));

    await expect(cancelZipTask('done-1')).resolves.toBe(true);

    expect(globalThis.fetch).toHaveBeenCalledWith('/download-zip/cancel/done-1', {});
    expect(getZipQueueTasks().has('done-1')).toBe(false);
  });

  it('keeps polling while the task stays queued and stops once completed', async () => {
    addZipQueueTask({ taskId: 'poll1', name: 'pacote.zip', total: 2, totalBytes: 0, unknownCount: 2 });
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/status/')) {
        calls.push(String(url));
        const count = calls.length;
        if (count <= 3) {
          return { ok: true, json: async () => ({ status: 'queued', processed: 0, total: 2, currentBytes: 0, speed: 0, queuePosition: count }) };
        }
        return { ok: true, json: async () => ({ status: 'completed', processed: 2, total: 2, currentBytes: 0, speed: 0, queuePosition: null }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    startPollingStatus('poll1');
    await vi.advanceTimersByTimeAsync(3200);

    // Continua no queue enquanto aguarda (3 polls, sem limpar o interval).
    expect(calls.length).toBe(3);
    expect(getZipQueueTasks().get('poll1')).toMatchObject({ state: 'queued', queuePosition: 3 });

    await vi.advanceTimersByTimeAsync(1000);

    // O 4º poll vê 'completed' e para o polling.
    expect(calls.length).toBe(4);
    expect(getZipQueueTasks().get('poll1')).toMatchObject({ state: 'completed', processed: 2 });
  });
});

// Dispara startZipDownload() com a resposta de erro do backend e devolve a
// mensagem exibida no toast (ou null se nenhum toast foi criado).
async function runZipStartWithError(code, status) {
  store.state.items = [{ id: 'a1', name: 'test.txt', url: 'https://example.com/t', ext: 'txt', size: 100 }];
  store.state.selectedItemIds = new Set(['a1']);
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/download-zip')) {
      return { ok: false, status, json: async () => ({ error: { code, message: 'raw server message' } }) };
    }
    if (u.includes('/locales/')) {
      return { ok: true, json: async () => mockLocales };
    }
    return { ok: true, json: async () => ({}) };
  });

  const p = startZipDownload();
  document.querySelector('.rename-confirm')?.click();
  await p;

  const toast = document.querySelector('#toast-container .toast:last-child');
  return toast?.querySelector('span:last-child')?.textContent ?? null;
}

describe('ZIP start error codes', () => {
  beforeEach(async () => {
    store.state.lang = 'pt-BR';
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/locales/')) {
        return { ok: true, json: async () => mockLocales };
      }
      return { ok: true, json: async () => ({}) };
    });
    await loadLocale('pt-BR');
    document.body.innerHTML = '';
    // Não usa fake timers: o fluxo de erro depende só de microtasks.
  });

  it('shows the queue-full message when the backend returns ZIP_QUEUE_FULL', async () => {
    const message = await runZipStartWithError('ZIP_QUEUE_FULL', 503);
    expect(message).toBe('A fila de downloads está cheia. Tente novamente mais tarde.');
  });

  it('shows the IP-limit message when the backend returns ZIP_IP_LIMIT_REACHED', async () => {
    const message = await runZipStartWithError('ZIP_IP_LIMIT_REACHED', 429);
    expect(message).toBe('Você já possui muitas tarefas ZIP em andamento.');
  });

  it('shows the too-many-items message when the backend returns ZIP_TOO_MANY_ITEMS', async () => {
    const message = await runZipStartWithError('ZIP_TOO_MANY_ITEMS', 400);
    expect(message).toBe('Você selecionou arquivos demais para um único ZIP.');
  });

  it('falls back to the generic message for unknown codes', async () => {
    const message = await runZipStartWithError('SOME_UNKNOWN_CODE', 500);
    expect(message).toBe('Falha ao iniciar empacotamento ZIP');
  });

  it('falls back to the generic message when no error code is present', async () => {
    const message = await runZipStartWithError(null, 400);
    expect(message).toBe('Falha ao iniciar empacotamento ZIP');
  });
});

// Captura o payload enviado a /download-zip após confirmar o nome do ZIP.
async function runZipPayload(selectedItems, organize) {
  let capturedBody = null;
  store.state.items = selectedItems;
  store.state.selectedItemIds = new Set(selectedItems.map(i => i.id));
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/download-zip')) {
      return { ok: true, json: async () => ({ taskId: 'z1' }) };
    }
    if (u.includes('/status/')) {
      return { ok: true, json: async () => ({ status: 'completed', processed: 1, total: 1, currentBytes: 0, speed: 0, queuePosition: null }) };
    }
    if (u.includes('/locales/')) {
      return { ok: true, json: async () => mockLocales };
    }
    return { ok: true, json: async () => ({}) };
  });

  const originalFetch = globalThis.fetch;
  const p = startZipDownload();
  organize?.(document.querySelector('.zip-organizer-dialog'));
  document.querySelector('.rename-confirm')?.click();
  await p;
  const bodyCall = originalFetch.mock.calls.find(c => String(c[0]).includes('/download-zip'));
  if (bodyCall) {
    const init = bodyCall[1] || {};
    capturedBody = init.body ? JSON.parse(init.body) : null;
  }
  return capturedBody;
}

describe('ZIP exclui HLS/DASH do payload', () => {
  beforeEach(async () => {
    store.state.lang = 'pt-BR';
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/locales/')) {
        return { ok: true, json: async () => mockLocales };
      }
      return { ok: true, json: async () => ({}) };
    });
    await loadLocale('pt-BR');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    closeRightPanel();
  });

  const mp4 = { id: 'm1', name: 'clip.mp4', url: 'https://example.com/clip.mp4', ext: 'mp4', size: 100, delivery: 'progressive' };
  const hls = { id: 'h1', name: 'live.m3u8', url: 'https://example.com/live.m3u8', ext: 'm3u8', size: 100, delivery: 'hls' };
  const dash = { id: 'd1', name: 'stream.mpd', url: 'https://example.com/stream.mpd', ext: 'mpd', size: 100, delivery: 'dash' };

  it('envia os arquivos na ordem definida no modal junto com o nome do ZIP', async () => {
    const second = { ...mp4, id: 'm2', name: 'second.mp4', url: 'https://example.com/second.mp4' };
    const third = { ...mp4, id: 'm3', name: 'third.mp4', url: 'https://example.com/third.mp4' };
    const body = await runZipPayload([mp4, second, third], dialog => {
      dialog.querySelector('.rename-input').value = 'ordem-personalizada';
      dialog.querySelector('[data-index="2"] [data-move="up"]').click();
      dialog.querySelector('[data-index="1"] [data-move="up"]').click();
    });

    expect(body.items.map(item => item.name)).toEqual(['third.mp4', 'clip.mp4', 'second.mp4']);
    expect(document.querySelector('.zip-organizer-dialog')).toBeNull();
    expect(getZipQueueTasks().get('z1').name).toBe('ordem-personalizada.zip');
  });

  it('preserva a origem e o MIME necessários para autenticar downloads GoFile', async () => {
    const body = await runZipPayload([{
      ...mp4,
      source: 'gofile',
      mimeType: 'video/mp4',
      url: 'https://store1.gofile.io/download/clip',
    }]);

    expect(body.items[0]).toMatchObject({ source: 'gofile', mimeType: 'video/mp4' });
  });

  it('abre automaticamente a fila quando o servidor aceita a tarefa ZIP', async () => {
    openRightPanel('preferences');
    await runZipPayload([mp4]);

    expect(getActiveRightPanel()).toBe('downloads');
  });

  it('HLS não entra no payload ZIP', async () => {
    const body = await runZipPayload([mp4, hls]);

    expect(body.items.map(i => i.name)).toEqual(['clip.mp4']);
    expect(body.ignoredItems).toEqual([{ name: 'live.m3u8', ext: 'm3u8', reason: 'unsupported hls' }]);
  });

  it('DASH não entra no payload ZIP', async () => {
    const body = await runZipPayload([mp4, dash]);

    expect(body.items.map(i => i.name)).toEqual(['clip.mp4']);
  });

  it('somente HLS/DASH selecionados não chama o ZIP e mostra a mensagem', async () => {
    store.state.items = [hls, dash];
    store.state.selectedItemIds = new Set(['h1', 'd1']);

    const p = startZipDownload();
    await p;

    const zipCall = globalThis.fetch.mock.calls.find(c => String(c[0]).includes('/download-zip'));
    expect(zipCall).toBeUndefined();
    const toastText = document.querySelector('#toast-container .toast:last-child span:last-child').textContent;
    expect(toastText).toBe('Este formato de streaming ainda não é suportado para download.');
  });
});
