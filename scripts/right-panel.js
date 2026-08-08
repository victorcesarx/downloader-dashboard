/**
 * Right Panel Coordinator (right-panel.js)
 *
 * Fonte única de verdade para qual painel lateral (direita) está ativo.
 * Não há dois booleans independentes (downloadsOpen / inspectorOpen):
 * existe apenas `activeRightPanel`, o que garante exclusividade
 * estrutural — nunca dois painéis ativos simultaneamente.
 *
 * Registry de painéis (único lugar a alterar quando um painel for
 * implementado):
 *   - 'downloads' → Drawer da Fila de Downloads (existente)
 *   - 'inspector' → Media Inspector
 *
 * Painel não registrado é ignorado de forma previsível (no-op).
 */

const PANEL_REGISTRY = ['downloads', 'inspector', 'preferences'];

let activeRightPanel = null;
const changeListeners = new Set();
let layoutWasOpen = false;
let layoutAnimationTimer = null;

function isValidPanel(panel) {
  return typeof panel === 'string' && PANEL_REGISTRY.includes(panel);
}

export function openRightPanel(panel) {
  // Ao trocar de painel o valor anterior é substituído — um painel só.
  if (!isValidPanel(panel) || activeRightPanel === panel) return;
  activeRightPanel = panel;
  notifyChange();
}

export function closeRightPanel() {
  if (activeRightPanel === null) return;
  activeRightPanel = null;
  notifyChange();
}

export function toggleRightPanel(panel) {
  if (!isValidPanel(panel)) return;
  if (activeRightPanel === panel) {
    closeRightPanel();
  } else {
    openRightPanel(panel);
  }
}

export function getActiveRightPanel() {
  return activeRightPanel;
}

export function setOnRightPanelChange(cb) {
  if (typeof cb !== 'function') return () => {};
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

function notifyChange() {
  // Estado visual global: qualquer painel registrado reserva a coluna lateral.
  // Novos painéis ganham o mesmo comportamento sem CSS ou wiring específico.
  if (typeof document !== 'undefined' && document.body) {
    const isOpen = activeRightPanel !== null;
    const layoutChanged = layoutWasOpen !== isOpen;
    document.body.classList.toggle('right-panel-open', isOpen);
    if (activeRightPanel) document.body.dataset.rightPanel = activeRightPanel;
    else delete document.body.dataset.rightPanel;

    // A largura muda uma única vez; a animação é apenas visual. Isso evita
    // recalcular e comprimir as colunas do grid em todos os frames.
    if (layoutChanged) {
      const animationClass = isOpen ? 'right-panel-opening' : 'right-panel-closing';
      document.body.classList.remove('right-panel-opening', 'right-panel-closing');
      // Reinicia a animação mesmo em alternâncias rápidas abrir/fechar.
      void document.body.offsetWidth;
      document.body.classList.add(animationClass);
      if (layoutAnimationTimer) clearTimeout(layoutAnimationTimer);
      layoutAnimationTimer = setTimeout(() => {
        document.body?.classList.remove('right-panel-opening', 'right-panel-closing');
        layoutAnimationTimer = null;
      }, 260);
    }
    layoutWasOpen = isOpen;
  }
  changeListeners.forEach(listener => listener(activeRightPanel));
}
