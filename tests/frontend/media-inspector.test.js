/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../scripts/i18n.js', () => ({
  t: key => key === 'common.na' ? 'N/A' : key === 'common.unknown' ? 'Desconhecido' : key,
  onLocaleChange: () => () => {},
}));

import { initMediaInspector, isInspectorOutsideClick, openMediaInspector } from '../../scripts/media-inspector.js';
import { closeRightPanel, getActiveRightPanel, openRightPanel } from '../../scripts/right-panel.js';
import { store } from '../../scripts/state.js';

const item = {
  id: 'media-1',
  type: 'video',
  name: '<Sample> video.mp4',
  url: 'https://cdn.example/video.mp4?x=1&y=2',
  proxyUrl: '/proxy?url=video',
  thumbnail: 'https://cdn.example/thumb.jpg',
  mimeType: 'video/mp4',
  extension: 'mp4',
  size: 1048576,
  width: 1920,
  height: 1080,
  duration: 65,
  quality: '1080p',
  delivery: 'progressive',
  source: 'generic',
  confidenceScore: 92,
  confidenceReasons: ['video extension', '<trusted> source'],
};

beforeEach(() => {
  closeRightPanel();
  document.body.innerHTML = '';
  store.state.items = [];
  store.state.selectedItemIds = new Set();
  initMediaInspector();
});

describe('Media Inspector', () => {
  it('abre com os metadados da mídia e conteúdo escapado', () => {
    openMediaInspector(item);
    const panel = document.getElementById('media-inspector-panel');
    expect(getActiveRightPanel()).toBe('inspector');
    expect(panel.classList.contains('open')).toBe(true);
    expect(document.body.classList.contains('right-panel-open')).toBe(true);
    expect(document.body.dataset.rightPanel).toBe('inspector');
    expect(panel.textContent).toContain('<Sample> video.mp4');
    expect(panel.textContent).toContain('1 MB');
    expect(panel.textContent).toContain('1920 × 1080 px');
    expect(panel.textContent).toContain('01:05');
    expect(panel.textContent).toContain('92%');
    expect(panel.querySelector('script')).toBeNull();
    expect(panel.querySelector('.inspector-unavailable')).toBeNull();
  });

  it('distingue tamanho desconhecido de arquivo vazio', () => {
    openMediaInspector({ ...item, size: null });
    expect(document.getElementById('media-inspector-panel').textContent).toContain('Desconhecido');

    openMediaInspector({ ...item, id: 'media-empty', size: 0 });
    expect(document.getElementById('media-inspector-panel').textContent).toContain('0 B');
  });

  it('fecha visualmente ao abrir a fila de downloads', () => {
    openMediaInspector(item);
    const panel = document.getElementById('media-inspector-panel');
    openRightPanel('downloads');
    expect(getActiveRightPanel()).toBe('downloads');
    expect(panel.classList.contains('open')).toBe(false);
  });

  it('botão fechar encerra o painel pelo coordenador', () => {
    openMediaInspector(item);
    document.querySelector('.inspector-close').click();
    expect(getActiveRightPanel()).toBeNull();
  });

  it('clicar em detalhes do mesmo item novamente fecha o inspector', () => {
    openMediaInspector(item);
    expect(getActiveRightPanel()).toBe('inspector');

    openMediaInspector(item);
    expect(getActiveRightPanel()).toBeNull();
    expect(document.getElementById('media-inspector-panel').classList.contains('open')).toBe(false);
  });

  it('clicar em outro item troca o conteúdo e mantém o inspector aberto', () => {
    openMediaInspector(item);
    openMediaInspector({ ...item, id: 'media-2', name: 'second.mp4' });

    expect(getActiveRightPanel()).toBe('inspector');
    expect(document.getElementById('media-inspector-panel').textContent).toContain('second.mp4');
  });

  it('lista variantes, troca a mídia e mantém seleção exclusiva no grupo', () => {
    const first = { ...item, variantGroupKey: 'group', variantCount: 2 };
    const second = { ...item, id: 'media-2', name: '720p.mp4', quality: '720p', variantGroupKey: 'group', variantCount: 2 };
    store.state.items = [first, second];
    openMediaInspector(first);

    const select = document.querySelector('.inspector-variant-select');
    expect(select).not.toBeNull();
    select.value = 'media-2';
    select.dispatchEvent(new Event('change'));
    expect(document.querySelector('.inspector-title-block').textContent).toContain('720p.mp4');

    document.querySelector('.inspector-select-btn').click();
    expect([...store.state.selectedItemIds]).toEqual(['media-2']);
  });

  it('atualiza metadados sob demanda e copia o contrato como JSON', async () => {
    const image = { ...item, id: 'image-1', type: 'image', width: null, height: null, duration: null, size: null, container: null };
    store.state.items = [image];
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ size: 2048, mimeType: 'image/jpeg', container: 'jpeg', width: 640, height: 480, duration: null, probedAt: '2026-08-08T00:00:00.000Z' }),
    }));
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    openMediaInspector(image);

    document.querySelector('.inspector-refresh').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.state.items[0].size).toBe(2048);
    expect(document.getElementById('media-inspector-panel').textContent).toContain('2 KB');

    document.querySelector('.inspector-copy-json').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(JSON.parse(writeText.mock.calls.at(-1)[0])).toMatchObject({ id: 'image-1', size: 2048, mimeType: 'image/jpeg' });
  });

  it('não trata como externo um clique cujo botão foi removido durante o render', () => {
    openMediaInspector(item);
    const panel = document.getElementById('media-inspector-panel');
    const button = panel.querySelector('.inspector-refresh');
    const event = { target: button, composedPath: () => [button, panel, document.body, document] };
    button.remove();

    expect(panel.contains(button)).toBe(false);
    expect(isInspectorOutsideClick(event, panel)).toBe(false);
  });
});
