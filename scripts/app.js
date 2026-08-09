/**
 * Main Application Controller (app.js)
 */
import { store } from './state.js';
import { initI18n, onLocaleChange, t } from './i18n.js';
import { analyzeUrl, clearCache } from './analyzer.js';
import { renderMediaContainer, updateBatchActionsUI, updateAllCardSelections, toggleBlur, getDisplayItems } from './renderer.js';
import { Toast } from './utils.js';
import { startZipDownload } from './zip-download.js';
import { initQueue } from './download-queue.js';
import { toggleRightPanel } from './right-panel.js';
import { initMediaInspector } from './media-inspector.js';
import { initUrlHistory, recordAnalyzedUrl } from './url-history.js';
import { initPreferencesPanel } from './preferences-panel.js';
import { updatePreference } from './preferences.js';
import { invertVisibleSelection, selectVisibleItems } from './selection.js';
import { initGlobalShortcuts } from './keyboard-shortcuts.js';

function initRouter() {
  initMediaInspector();
  initPreferencesPanel();
  renderMediaContainer();
  updateBatchActionsUI();
}

document.addEventListener('DOMContentLoaded', async () => {
  // 0. Initialize Theme
  initTheme();

  // 1. Initialize i18n (must be before router, which uses t() for button text)
  await initI18n();
  document.documentElement.classList.add('i18n-ready');

  // 2. SPA Router
  initRouter();

  // 3. Initialize Download Queue
  initQueue();

  // 4. Attach Event Listeners
  setupEventListeners();

  // 4. Initial Render
  renderMediaContainer();
  updateBatchActionsUI();
});

function initTheme() {
  const savedTheme = store.state.theme;
  document.documentElement.setAttribute('data-theme', savedTheme);

  const themeInput = document.getElementById('theme-toggle-input');
  if (themeInput) {
    themeInput.checked = savedTheme === 'light';
  }
}

function setupEventListeners() {
  const syncSelectionUI = () => {
    updateAllCardSelections();
    updateBatchActionsUI();
  };

  // Theme Toggle
  const themeInput = document.getElementById('theme-toggle-input');
  if (themeInput) {
    themeInput.addEventListener('change', () => {
      const nextTheme = themeInput.checked ? 'light' : 'dark';
      store.state.theme = nextTheme;
      store.state.themePreference = nextTheme;
      document.documentElement.setAttribute('data-theme', nextTheme);
      localStorage.setItem('downdash_theme', nextTheme);
      updatePreference('theme', nextTheme);
    });
  }

  onLocaleChange(() => {
    renderMediaContainer();
    updateBatchActionsUI();
  });

  // URL Analyze Form
  const analyzeForm = document.getElementById('analyze-form');
  const urlInput = document.getElementById('url-input');
  const searchWrapper = document.querySelector('.search-box-wrapper');
  if (analyzeForm && urlInput) {
    const runAnalysis = async (url) => {
      const result = await analyzeUrl(url);
      if (result) recordAnalyzedUrl(url);
      renderMediaContainer();
      updateBatchActionsUI();
      return result;
    };
    initUrlHistory(urlInput, runAnalysis);
    analyzeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = urlInput.value.trim();
      if (url) {
        await runAnalysis(url);
      }
    });

    // Drag-and-drop URL onto search area
    if (searchWrapper) {
      searchWrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
        searchWrapper.classList.add('drag-over');
      });

      searchWrapper.addEventListener('dragleave', () => {
        searchWrapper.classList.remove('drag-over');
      });

      searchWrapper.addEventListener('drop', async (e) => {
        e.preventDefault();
        searchWrapper.classList.remove('drag-over');
        const text = e.dataTransfer.getData('text');
        if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
          urlInput.value = text;
          analyzeForm.dispatchEvent(new Event('submit'));
        }
      });
    }

    // Clear search cache
    const clearCacheBtn = document.getElementById('clear-cache-btn');
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener('click', () => {
        clearCache();
        Toast.show(t('toast.cache_cleared'), 'success');
      });
    }
  }

  // Filter Pills
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');
      store.state.activeFilter = e.target.getAttribute('data-filter') || 'all';
      renderMediaContainer();
    });
  });

  // Search Filter Input
  const searchFilterInput = document.getElementById('search-filter-input');
  if (searchFilterInput) {
    searchFilterInput.addEventListener('input', (e) => {
      store.state.searchQuery = e.target.value;
      renderMediaContainer();
    });
  }

  // Media sorting (kept for the current browser session)
  const sortOrderSelect = document.getElementById('sort-order-select');
  if (sortOrderSelect) {
    const validSortOrders = new Set([...sortOrderSelect.options].map(option => option.value));
    if (!validSortOrders.has(store.state.sortOrder)) store.state.sortOrder = 'original';
    sortOrderSelect.value = store.state.sortOrder;
    sortOrderSelect.addEventListener('change', () => {
      store.state.sortOrder = sortOrderSelect.value;
      sessionStorage.setItem('downdash_sort', store.state.sortOrder);
      renderMediaContainer();
    });
  }

  // View Mode Toggles (Grid / List / Compact)
  const viewModeMap = { grid: 'view-grid-btn', list: 'view-list-btn', compact: 'view-compact-btn' };

  function activateViewMode(mode) {
    document.querySelectorAll('.view-toggle .view-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(viewModeMap[mode]);
    if (btn) btn.classList.add('active');
  }

  // Initialize active button from persisted state
  activateViewMode(store.state.viewMode);

  document.querySelectorAll('.view-toggle .view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.id.replace('view-', '').replace('-btn', '');
      if (mode === store.state.viewMode) return;
      activateViewMode(mode);
      store.state.viewMode = mode;
      localStorage.setItem('downdash_view', mode);
      renderMediaContainer();
    });
  });

  // NSFW Blur Toggle (square button)
  const nsfwBtn = document.getElementById('nsfw-btn');
  if (nsfwBtn) {
    nsfwBtn.classList.toggle('active', store.state.thumbBlurred);
    nsfwBtn.addEventListener('click', () => {
      store.state.thumbBlurred = !store.state.thumbBlurred;
      nsfwBtn.classList.toggle('active', store.state.thumbBlurred);
      localStorage.setItem('downdash_blur', store.state.thumbBlurred);
      updatePreference('thumbBlurred', store.state.thumbBlurred);
      toggleBlur();
    });
  }

  // Toggle Select / Deselect All
  const toggleSelectBtn = document.getElementById('toggle-select-btn');

  if (toggleSelectBtn) {
    toggleSelectBtn.addEventListener('click', () => {
      const next = new Set(store.state.selectedItemIds);
      // Seleção opera sobre os cards exibidos: variantes colapsadas contam
      // como um único card (o da variante selecionada do grupo).
      const filteredIds = getDisplayItems().map(i => i.id);

      const allSelected = filteredIds.every(id => next.has(id));
      if (allSelected) {
        // Deselect all filtered
        filteredIds.forEach(id => next.delete(id));
      } else {
        // Select all filtered
        filteredIds.forEach(id => next.add(id));
      }
      store.state.selectedItemIds = next;
      syncSelectionUI();
    });
  }

  const invertSelectBtn = document.getElementById('invert-select-btn');
  if (invertSelectBtn) {
    invertSelectBtn.addEventListener('click', () => {
      store.state.selectedItemIds = invertVisibleSelection(
        store.state.items,
        getDisplayItems(),
        store.state.selectedItemIds,
      );
      syncSelectionUI();
    });
  }

  // Sound Notification Toggle
  const soundBtn = document.getElementById('sound-btn');
  if (soundBtn) {
    soundBtn.classList.toggle('active', store.state.soundEnabled);
    soundBtn.addEventListener('click', () => {
      const next = !store.state.soundEnabled;
      store.state.soundEnabled = next;
      localStorage.setItem('downdash_sound', next);
      updatePreference('soundEnabled', next);
      soundBtn.classList.toggle('active', next);
    });
  }

  // Download Queue Toggle
  const queueToggleBtn = document.getElementById('queue-toggle-btn');
  if (queueToggleBtn) {
    queueToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleRightPanel('downloads');
    });
  }

  // Download Selected (ZIP)
  const batchZipBtn = document.getElementById('download-selected-btn');
  if (batchZipBtn) {
    batchZipBtn.addEventListener('click', () => {
      startZipDownload();
    });
  }

  initGlobalShortcuts({
    analyze: () => {
      if (!store.state.isAnalyzing && urlInput?.value.trim()) analyzeForm?.requestSubmit();
    },
    selectVisible: () => {
      store.state.selectedItemIds = selectVisibleItems(
        store.state.items,
        getDisplayItems(),
        store.state.selectedItemIds,
      );
      syncSelectionUI();
    },
    clearSelection: () => {
      store.state.selectedItemIds = new Set();
      syncSelectionUI();
    },
    hasSelection: () => store.state.selectedItemIds.size > 0,
    hasVisibleItems: () => getDisplayItems().length > 0,
    startZip: startZipDownload,
  });

  // Store Subscriptions for reactive updates
  store.subscribe((prop) => {
    if (prop === 'isAnalyzing') {
      const analyzeBtn = document.getElementById('analyze-btn');
      if (analyzeBtn) {
        analyzeBtn.disabled = store.state.isAnalyzing;
        analyzeBtn.classList.toggle('loading', store.state.isAnalyzing);
        analyzeBtn.innerHTML = `<span class="spinner"></span> ${store.state.isAnalyzing ? t('search.analyzing') : t('search.analyze_btn')}`;
      }
      renderMediaContainer();
    }
    if (prop === 'thumbBlurred') {
      nsfwBtn?.classList.toggle('active', store.state.thumbBlurred);
      toggleBlur();
    }
    if (prop === 'soundEnabled') soundBtn?.classList.toggle('active', store.state.soundEnabled);
    if (prop === 'theme') {
      document.documentElement.setAttribute('data-theme', store.state.theme);
      if (themeInput) themeInput.checked = store.state.theme === 'light';
    }
  });

  window.__clearFilters = function () {
    const searchInput = document.getElementById('search-filter-input');
    if (searchInput) searchInput.value = '';
    store.state.activeFilter = 'all';
    store.state.searchQuery = '';
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    const allPill = document.querySelector('.filter-pill[data-filter="all"]');
    if (allPill) allPill.classList.add('active');
    renderMediaContainer();
  };

  // "Limpar filtros" do empty state: listener delegado em vez de
  // onclick inline (bloqueado pela CSP `script-src 'self'`).
  document.addEventListener('click', (e) => {
    if (e.target.closest('.filter-clear-btn')) window.__clearFilters();
  });
}
