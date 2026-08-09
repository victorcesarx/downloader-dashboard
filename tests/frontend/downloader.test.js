/**
 * @vitest-environment jsdom
 *
 * Action Area — máquina de estados do card (downloader.js).
 * Cobre: idle → error → retry → downloading, conclusão, cancelamento,
 * restauração correta do markup idle e não-recaptura do idleHtml.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildCardHtml } from '../../scripts/renderer/cards.js';
import { downloadFile, getActiveDownloads, dismissDownload } from '../../scripts/downloader.js';
import { store } from '../../scripts/state.js';
import { closeRightPanel, getActiveRightPanel, openRightPanel } from '../../scripts/right-panel.js';

const item = {
  id: 'it1',
  type: 'video',
  name: 'video.mp4',
  url: 'https://cdn.example/video.mp4',
  proxyUrl: '/api/media/proxy/video.mp4',
  ext: 'mp4',
  label: 'video',
  size: 12345,
  thumbnail: null,
  delivery: 'progressive',
};

const failResponse = { ok: false, status: 403, statusText: 'Forbidden' };
const transientResponse = { ok: false, status: 500, statusText: 'Internal Server Error' };

function streamResponse(chunks, contentType = 'video/mp4') {
  const enc = new TextEncoder();
  const datas = chunks.map(c => enc.encode(c));
  let i = 0;
  return {
    ok: true,
    headers: {
      get: h => (h.toLowerCase() === 'content-length'
        ? String(chunks.join('').length)
        : contentType),
    },
    body: {
      getReader: () => ({
        read: async () => (i < datas.length
          ? { done: false, value: datas[i++] }
          : { done: true, value: undefined }),
      }),
    },
  };
}

function mount(cardItem = item) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildCardHtml(cardItem, false);
  document.body.appendChild(wrapper);
  return wrapper.querySelector('.card-state');
}

async function waitForState(stateEl, expected, tries = 100) {
  for (let i = 0; i < tries; i++) {
    if (stateEl.dataset.state === expected) return;
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(stateEl.dataset.state).toBe(expected);
}

describe('Action Area — ciclo de estados do card', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    store.state.soundEnabled = false;
    store.state.downloadConcurrency = 3;
    if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    getActiveDownloads().forEach(ad => dismissDownload(ad));
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    closeRightPanel();
  });

  it('abre automaticamente a fila ao iniciar um download individual', () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    openRightPanel('preferences');
    const stateEl = mount();

    downloadFile(item, stateEl.closest('.media-card'));

    expect(getActiveRightPanel()).toBe('downloads');
  });

  it('idle → error → retry → downloading', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(failResponse)
      .mockReturnValueOnce(new Promise(() => {}));

    const stateEl = mount();
    downloadFile(item, stateEl.closest('.media-card'));

    await waitForState(stateEl, 'error');
    expect(stateEl.querySelector('[data-action="retry"]')).not.toBeNull();
    expect(stateEl.querySelector('[data-action="close"]')).not.toBeNull();

    stateEl.querySelector('[data-action="retry"]').click();

    expect(stateEl.dataset.state).toBe('downloading');
    expect(stateEl.querySelector('.card-state-bar')).not.toBeNull();
    expect(stateEl.querySelector('[data-action="pause"]')).not.toBeNull();
    expect(stateEl.querySelector('[data-action="cancel"]')).not.toBeNull();
  });

  it('retry → completed restaura o idle com markup original (sem erro)', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(failResponse)
      .mockResolvedValueOnce(streamResponse(['a', 'b', 'c']));

    const stateEl = mount();
    downloadFile(item, stateEl.closest('.media-card'));

    await waitForState(stateEl, 'error');
    stateEl.querySelector('[data-action="retry"]').click();

    await waitForState(stateEl, 'completed');
    expect(stateEl.querySelector('.card-state-fill--done')).not.toBeNull();
    expect(stateEl.innerHTML).not.toContain('card-state-result--error');

    await vi.advanceTimersByTimeAsync(3000);

    expect(stateEl.dataset.state).toBe('idle');
    expect(getActiveDownloads().get(item.id)?.state).toBe('completed');
    const history = JSON.parse(sessionStorage.getItem('webscope_download_history_v1'));
    expect(history[0]).toMatchObject({ state: 'completed', receivedLength: 3 });
    expect(stateEl.innerHTML).not.toContain('card-state-result--error');
    expect(stateEl.innerHTML).not.toContain('card-state-fill--error');
    expect(stateEl.querySelector('[data-action="retry"]')).toBeNull();
    expect(stateEl.querySelector('.download-btn')).not.toBeNull();
  });

  it('salva imagem com extensão baseada no Content-Type quando o nome termina em domínio', async () => {
    const imageItem = {
      ...item, id: 'image-domain', type: 'image', name: 'pbs.twimg.com',
      ext: 'bin', url: 'https://pbs.twimg.com/media/file', proxyUrl: '/proxy/image-domain',
    };
    let downloadedName = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureDownload() {
      downloadedName = this.download;
    });
    global.fetch = vi.fn().mockResolvedValueOnce(streamResponse(['image-bytes'], 'image/jpeg'));

    const stateEl = mount(imageItem);
    downloadFile(imageItem, stateEl.closest('.media-card'));
    await waitForState(stateEl, 'completed');

    expect(downloadedName).toBe('pbs.twimg.com.jpg');
  });

  it('retry → cancel restaura o idle com markup original (sem erro)', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(failResponse)
      .mockReturnValueOnce(new Promise(() => {}));

    const stateEl = mount();
    downloadFile(item, stateEl.closest('.media-card'));

    await waitForState(stateEl, 'error');
    stateEl.querySelector('[data-action="retry"]').click();

    expect(stateEl.dataset.state).toBe('downloading');
    stateEl.querySelector('[data-action="cancel"]').click();

    expect(stateEl.dataset.state).toBe('idle');
    expect(stateEl.innerHTML).not.toContain('card-state-result--error');
    expect(stateEl.querySelector('[data-action="retry"]')).toBeNull();
    expect(stateEl.querySelector('.download-btn')).not.toBeNull();
  });

  it('após completed a Action Area não contém markup de erro', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(failResponse)
      .mockResolvedValueOnce(streamResponse(['x', 'y', 'z']));

    const stateEl = mount();
    downloadFile(item, stateEl.closest('.media-card'));

    await waitForState(stateEl, 'error');
    stateEl.querySelector('[data-action="retry"]').click();
    await waitForState(stateEl, 'completed');
    await vi.advanceTimersByTimeAsync(3000);

    expect(stateEl.dataset.state).toBe('idle');
    expect(stateEl.innerHTML).not.toContain('card-state-result--error');
    expect(stateEl.innerHTML).not.toContain('data-action="retry"');
    expect(stateEl.innerHTML).toContain('download-btn');
  });

  it('barra de progresso inicia vazia antes dos headers chegarem', async () => {
    // fetch pendente: totalLength ainda desconhecido (0) quando o card
    // renderiza 'downloading' — a barra não pode nascer cheia (100%).
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    const stateEl = mount();
    downloadFile(item, stateEl.closest('.media-card'));

    expect(stateEl.dataset.state).toBe('downloading');
    const fill = stateEl.querySelector('.progress-bar-fill');
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe('0%');
  });

  it('idleHtml não é recapturado durante o retry', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(failResponse)
      .mockReturnValueOnce(new Promise(() => {}));

    const stateEl = mount();
    downloadFile(item, stateEl.closest('.media-card'));

    const first = stateEl.__wsActionIdleHtml;
    expect(first).toContain('download-btn');
    expect(first).not.toContain('card-state-result--error');

    await waitForState(stateEl, 'error');
    expect(stateEl.__wsActionIdleHtml).toBe(first);

    stateEl.querySelector('[data-action="retry"]').click();
    expect(stateEl.__wsActionIdleHtml).toBe(first);

    const ad = [...getActiveDownloads().values()][0];
    dismissDownload(ad);
    expect(stateEl.innerHTML).toBe(first);
  });

  it('falha permanece no histórico com horário, origem e mensagem', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(failResponse);
    const stateEl = mount();
    downloadFile({ ...item, source: 'twitter' }, stateEl.closest('.media-card'));

    await waitForState(stateEl, 'error');
    const record = getActiveDownloads().get(item.id);
    expect(record.finishedAt).toEqual(expect.any(Number));
    expect(record.errorMsg).toBe('HTTP 403');

    const history = JSON.parse(sessionStorage.getItem('webscope_download_history_v1'));
    expect(history[0]).toMatchObject({
      state: 'error',
      errorMsg: 'HTTP 403',
      item: { source: 'twitter' },
    });
  });

  it('repete falhas transitórias com backoff e conclui na terceira tentativa', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    global.fetch = vi.fn()
      .mockResolvedValueOnce(transientResponse)
      .mockResolvedValueOnce(transientResponse)
      .mockResolvedValueOnce(streamResponse(['ok']));
    const stateEl = mount();
    downloadFile(item, stateEl.closest('.media-card'));

    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await waitForState(stateEl, 'completed');

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(getActiveDownloads().get(item.id).attempt).toBe(3);
  });

  it('não repete erro HTTP permanente', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(failResponse);
    const stateEl = mount();
    downloadFile(item, stateEl.closest('.media-card'));
    await waitForState(stateEl, 'error');
    await vi.advanceTimersByTimeAsync(5000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('não repete formato de streaming incompatível', async () => {
    global.fetch = vi.fn();
    const stateEl = mount();
    downloadFile({ ...item, delivery: 'hls' }, stateEl.closest('.media-card'));
    await waitForState(stateEl, 'error');
    await vi.advanceTimersByTimeAsync(5000);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getActiveDownloads().get(item.id).attempt).toBe(1);
  });

  it('expõe erro manual após esgotar três tentativas', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    global.fetch = vi.fn().mockResolvedValue(transientResponse);
    const stateEl = mount();
    downloadFile(item, stateEl.closest('.media-card'));
    await vi.advanceTimersByTimeAsync(1500);
    await waitForState(stateEl, 'error');
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(stateEl.querySelector('[data-action="retry"]')).not.toBeNull();
  });

  it('cancelamento durante o backoff impede nova requisição', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    global.fetch = vi.fn().mockResolvedValueOnce(transientResponse);
    const stateEl = mount();
    downloadFile(item, stateEl.closest('.media-card'));
    await vi.advanceTimersByTimeAsync(10);
    expect(getActiveDownloads().get(item.id).waitingRetry).toBe(true);
    stateEl.querySelector('[data-action="cancel"]').click();
    await vi.advanceTimersByTimeAsync(5000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(getActiveDownloads().has(item.id)).toBe(false);
  });

  it('respeita o limite simultâneo e inicia o próximo ao liberar vaga', async () => {
    store.state.downloadConcurrency = 1;
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    const firstState = mount();
    const secondItem = { ...item, id: 'it2', name: 'second.mp4' };
    const secondWrapper = document.createElement('div');
    secondWrapper.innerHTML = buildCardHtml(secondItem, false);
    document.body.appendChild(secondWrapper);
    const secondState = secondWrapper.querySelector('.card-state');

    downloadFile(item, firstState.closest('.media-card'));
    downloadFile(secondItem, secondState.closest('.media-card'));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(secondState.dataset.state).toBe('queued');

    dismissDownload(getActiveDownloads().get(item.id));
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(secondState.dataset.state).toBe('downloading');
  });
});
