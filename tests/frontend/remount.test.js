/**
 * @vitest-environment jsdom
 *
 * Remount do virtual scroll — o card recriado nasce idle e o
 * restoreDownloadState deve re-ancorar o ad ativo (activeDownloads é a
 * fonte de verdade) e restaurar o estado visual real do download, sem
 * reiniciá-lo, sem duplicar timers/listeners.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildCardHtml } from '../../scripts/renderer/cards.js';
import { downloadFile, getActiveDownloads, dismissDownload, restoreDownloadState } from '../../scripts/downloader.js';
import { store } from '../../scripts/state.js';

const item = {
  id: 'rm1',
  type: 'video',
  name: 'remount.mp4',
  url: 'https://cdn.example/remount.mp4',
  proxyUrl: '/api/media/proxy/remount.mp4',
  ext: 'mp4',
  label: 'video',
  size: 12345,
  thumbnail: null,
  delivery: 'progressive',
};

// Stream controlado: 1º chunk imediato; leituras que produzem chunk só
// avançam quando release() é chamado. Depois do último chunk, a leitura
// seguinte retorna done:true — encerrando o download.
// release() pendente é cumulativo: se ainda não há gate ativo (ex.: o loop
// está suspenso no pause), a liberação é aplicada quando o gate nascer.
function gatedStream(contents) {
  const enc = new TextEncoder();
  const chunks = contents.map(c => enc.encode(c));
  let i = 0;
  let gateResolve = null;
  let pending = 0;
  let gate = new Promise(r => { gateResolve = r; });

  const response = {
    ok: true,
    headers: {
      get: h => (h.toLowerCase() === 'content-length'
        ? String(contents.join('').length)
        : 'video/mp4'),
    },
    body: {
      getReader: () => ({
        read: async () => {
          if (i > 0 && i < chunks.length) await gate;
          if (i < chunks.length) {
            const value = chunks[i++];
            gate = new Promise(r => {
              gateResolve = r;
              if (pending > 0) { pending--; gateResolve(); }
            });
            return { done: false, value };
          }
          return { done: true, value: undefined };
        },
      }),
    },
  };

  return {
    response,
    release() {
      if (gateResolve) { const r = gateResolve; gateResolve = null; r(); }
      else pending++;
    },
  };
}

function mount() {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildCardHtml(item, false);
  document.body.appendChild(wrapper);
  return wrapper;
}

function cardOf(wrapper) {
  return wrapper.querySelector('.media-card');
}

function stateOf(wrapper) {
  return cardOf(wrapper).querySelector('.card-state');
}

async function waitForState(stateEl, expected, tries = 100) {
  for (let i = 0; i < tries; i++) {
    if (stateEl.dataset.state === expected) return;
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(stateEl.dataset.state).toBe(expected);
}

describe('Remount — estado de download preservado no card recriado', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    store.state.soundEnabled = false;
    if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    getActiveDownloads().forEach(ad => dismissDownload(ad));
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('download ativo continua downloading após o remount (sem reiniciar)', async () => {
    const stream = gatedStream(['abc', 'def']);
    global.fetch = vi.fn().mockResolvedValue(stream.response);

    const wrapper = mount();
    downloadFile(item, cardOf(wrapper));
    await waitForState(stateOf(wrapper), 'downloading');
    // deixa o 1º chunk ser lido (totalLength conhecido, 3/6 bytes → 50%)
    await vi.advanceTimersByTimeAsync(10);

    const firstChunk = /3 B/.test(stateOf(wrapper).querySelector('.card-state-bytes').textContent);
    expect(firstChunk).toBe(true);

    // Virtual scroll descarta o card fora da viewport
    wrapper.remove();

    // Card recriado (nasce idle) — o estado real é re-aplicado
    const newWrapper = mount();
    const restored = restoreDownloadState(item, cardOf(newWrapper));

    expect(restored).toBe(true);
    expect(stateOf(newWrapper).dataset.state).toBe('downloading');
    expect(newWrapper.querySelector('[data-action="pause"]')).not.toBeNull();
    expect(newWrapper.querySelector('[data-action="cancel"]')).not.toBeNull();
    expect(getActiveDownloads().size).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('progresso é preservado após o remount', async () => {
    const stream = gatedStream(['abc', 'def']); // 3 de 6 bytes → 50%
    global.fetch = vi.fn().mockResolvedValue(stream.response);

    const wrapper = mount();
    downloadFile(item, cardOf(wrapper));
    await waitForState(stateOf(wrapper), 'downloading');
    // deixa o 1º chunk ser lido (3/6 bytes → 50%)
    await vi.advanceTimersByTimeAsync(10);

    const barBefore = wrapper.querySelector('.progress-bar-fill');
    expect(barBefore.style.width).toBe('50%');

    wrapper.remove();

    const newWrapper = mount();
    restoreDownloadState(item, cardOf(newWrapper));

    const barAfter = newWrapper.querySelector('.progress-bar-fill');
    expect(barAfter.style.width).toBe('50%');
    expect(newWrapper.querySelector('.card-state-bytes').textContent).toContain('50%');
  });

  it('paused → remount mantém paused', async () => {
    const stream = gatedStream(['abc', 'def']);
    global.fetch = vi.fn().mockResolvedValue(stream.response);

    const wrapper = mount();
    downloadFile(item, cardOf(wrapper));
    await waitForState(stateOf(wrapper), 'downloading');

    // Pausa enquanto a 2ª leitura está bloqueada no gate
    stateOf(wrapper).querySelector('[data-action="pause"]').click();
    stream.release();
    await waitForState(stateOf(wrapper), 'paused');
    expect(stateOf(wrapper).querySelector('[data-action="pause"]')).not.toBeNull();
    expect(stateOf(wrapper).querySelector('[data-action="cancel"]')).not.toBeNull();

    wrapper.remove();

    const newWrapper = mount();
    const restored = restoreDownloadState(item, cardOf(newWrapper));

    expect(restored).toBe(true);
    expect(stateOf(newWrapper).dataset.state).toBe('paused');
    expect(newWrapper.querySelector('[data-action="pause"]')).not.toBeNull();
    expect(newWrapper.querySelector('[data-action="cancel"]')).not.toBeNull();
  });

  it('remount não dispara um segundo download', async () => {
    const stream = gatedStream(['abc']);
    global.fetch = vi.fn().mockResolvedValue(stream.response);

    const wrapper = mount();
    downloadFile(item, cardOf(wrapper));
    await waitForState(stateOf(wrapper), 'downloading');

    wrapper.remove();

    const newWrapper = mount();
    restoreDownloadState(item, cardOf(newWrapper));

    expect(getActiveDownloads().size).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('item sem download ativo permanece idle após o remount', async () => {
    global.fetch = vi.fn();

    const wrapper = mount();
    const restored = restoreDownloadState(item, cardOf(wrapper));

    expect(restored).toBe(false);
    expect(stateOf(wrapper).dataset.state).toBe('idle');
    expect(wrapper.querySelector('.download-btn')).not.toBeNull();
    expect(wrapper.querySelector('[data-action="pause"]')).toBeNull();
  });

  it('cancelar após o remount funciona e restaura o idle', async () => {
    const stream = gatedStream(['abc', 'def']);
    global.fetch = vi.fn().mockResolvedValue(stream.response);

    const wrapper = mount();
    downloadFile(item, cardOf(wrapper));
    await waitForState(stateOf(wrapper), 'downloading');

    wrapper.remove();

    const newWrapper = mount();
    restoreDownloadState(item, cardOf(newWrapper));
    expect(stateOf(newWrapper).dataset.state).toBe('downloading');

    newWrapper.querySelector('[data-action="cancel"]').click();
    await waitForState(stateOf(newWrapper), 'idle');

    expect(getActiveDownloads().size).toBe(0);
    expect(newWrapper.querySelector('.download-btn')).not.toBeNull();
    expect(newWrapper.querySelector('[data-action="pause"]')).toBeNull();
  });

  it('retomar após remount continua o download do mesmo ad', async () => {
    const stream = gatedStream(['abc', 'def', 'ghi']);
    global.fetch = vi.fn().mockResolvedValue(stream.response);

    const wrapper = mount();
    downloadFile(item, cardOf(wrapper));
    await waitForState(stateOf(wrapper), 'downloading');

    stateOf(wrapper).querySelector('[data-action="pause"]').click();
    stream.release();
    await waitForState(stateOf(wrapper), 'paused');

    wrapper.remove();

    const newWrapper = mount();
    restoreDownloadState(item, cardOf(newWrapper));

    // Continua o download: clica Retomar (botão pause em estado paused)
    newWrapper.querySelector('[data-action="pause"]').click();
    stream.release();
    await waitForState(stateOf(newWrapper), 'completed');

    expect(getActiveDownloads().size).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});