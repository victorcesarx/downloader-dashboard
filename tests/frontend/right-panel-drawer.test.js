/**
 * @vitest-environment jsdom
 *
 * Integração do Drawer da Fila de Downloads com o coordenador de
 * painéis laterais (right-panel.js):
 * - o botão existente "Downloads" continua abrindo/fechando o drawer;
 * - ESC fecha via coordenador;
 * - click outside fecha via coordenador;
 * - o drawer espelha fielmente `activeRightPanel` (nenhum layout novo).
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
  t: (key) => {
    const dict = {
      'nav.queue': 'Fila de Downloads',
      'actions.close': 'Fechar',
      'queue.clear_done': 'Limpar concluídos',
      'queue.clear_failed': 'Limpar falhas',
      'queue.empty': 'Nenhum download em andamento',
      'queue.tab_active': 'Ativos',
      'queue.tab_completed': 'Concluídos',
      'queue.tab_failed': 'Falhas',
      'queue.active_one': '{count} download ativo',
      'queue.active_other': '{count} downloads ativos',
    };
    return dict[key] ?? key;
  },
}));

// Envolve a implementação real do coordenador com um spy em
// closeRightPanel: o download-queue.js importa desta mesma instância,
// então o spy observa as chamadas reais vindas do listener de clique.
vi.mock('../../scripts/right-panel.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    closeRightPanel: vi.fn(original.closeRightPanel),
  };
});

import { initQueue } from '../../scripts/download-queue.js';
import { toggleRightPanel, openRightPanel, closeRightPanel, getActiveRightPanel } from '../../scripts/right-panel.js';
import * as rightPanelApi from '../../scripts/right-panel.js';

// Espelho do wiring do app.js (scripts/app.js): o botão #queue-toggle-btn
// aciona toggleRightPanel('downloads'). Isso é o que o teste 7 valida.
function wireQueueButton() {
  const btn = document.getElementById('queue-toggle-btn');
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    toggleRightPanel('downloads');
  });
  return btn;
}

function panelEl() {
  return document.getElementById('download-queue-panel');
}

beforeEach(() => {
  rightPanelApi.closeRightPanel.mockClear();
  const existingPanel = document.getElementById('download-queue-panel');
  document.body.innerHTML = '<button id="queue-toggle-btn"></button>';
  if (existingPanel) document.body.appendChild(existingPanel);
  mock.downloads.clear();
  initQueue();
});

afterEach(() => {
  closeRightPanel();
  mock.downloads.clear();
});

describe('drawer integrado ao right-panel', () => {
  it('Estado inicial: drawer fechado e nenhum painel ativo', () => {
    expect(getActiveRightPanel()).toBeNull();
    expect(panelEl()).toBeNull();
  });

  it('o botão existente abre o drawer (e o estado do coordenador)', () => {
    const btn = wireQueueButton();
    btn.click();
    const panel = panelEl();
    expect(getActiveRightPanel()).toBe('downloads');
    expect(panel).toBeTruthy();
    expect(panel.classList.contains('open')).toBe(true);
    expect(document.body.classList.contains('right-panel-open')).toBe(true);
    expect(document.body.dataset.rightPanel).toBe('downloads');
  });

  it('o mesmo botão fecha o drawer (toggle) sem mudar a animação', () => {
    const btn = wireQueueButton();
    btn.click();
    btn.click();
    const panel = panelEl();
    expect(getActiveRightPanel()).toBeNull();
    expect(panel.classList.contains('open')).toBe(false);
    expect(document.body.classList.contains('right-panel-open')).toBe(false);
    expect(document.body.dataset.rightPanel).toBeUndefined();
  });

  it('ESC fecha o drawer via coordenador', () => {
    openRightPanel('downloads');
    const panel = panelEl();
    expect(panel.classList.contains('open')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(getActiveRightPanel()).toBeNull();
    expect(panel.classList.contains('open')).toBe(false);
  });

  it('ESC com o drawer fechado não quebra', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(getActiveRightPanel()).toBeNull();
  });

  it('click fora: evento não confiável não fecha e não aciona o coordenador', () => {
    // jsdom não permite criar eventos `trusted` (isTrusted é um getter
    // próprio não-configurável na instância), então não é possível
    // simular o clique real de usuário fora do painel. A regra de
    // fechamento por click outside usa o mesmo caminho do ESC
    // (closeRightPanel → coordenador → syncDrawer) e a guarda de
    // eventos não confiáveis é validada neste teste e em
    // download-queue-tabs.test.js.
    openRightPanel('downloads');
    const panel = panelEl();
    expect(panel.classList.contains('open')).toBe(true);

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(rightPanelApi.closeRightPanel).not.toHaveBeenCalled();
    expect(getActiveRightPanel()).toBe('downloads');
    expect(panel.classList.contains('open')).toBe(true);
  });

  it('closeRightPanel() fecha o drawer visual (sincronia coordenador → drawer)', () => {
    openRightPanel('downloads');
    const panel = panelEl();
    expect(panel.classList.contains('open')).toBe(true);

    closeRightPanel();
    expect(panel.classList.contains('open')).toBe(false);
  });

  it('o botão de fechar (×) do drawer fecha via coordenador', () => {
    openRightPanel('downloads');
    const panel = panelEl();
    panel.querySelector('.queue-panel-close').click();
    expect(getActiveRightPanel()).toBeNull();
    expect(panel.classList.contains('open')).toBe(false);
  });
});
