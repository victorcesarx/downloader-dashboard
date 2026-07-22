/**
 * Main Application Controller (app.js)
 */
import { store } from './state.js';
import { initI18n, loadLocale, translateDOM } from './i18n.js';
import { analyzeUrl } from './analyzer.js';
import { renderMediaContainer, updateBatchActionsUI } from './renderer.js';
import { startZipDownload } from './zip-download.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize Theme
  initTheme();

  // 2. Initialize i18n
  await initI18n();

  // 3. Attach Event Listeners
  setupEventListeners();

  // 4. Initial Render
  renderMediaContainer();
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
  // Theme Toggle
  const themeInput = document.getElementById('theme-toggle-input');
  if (themeInput) {
    themeInput.addEventListener('change', () => {
      const nextTheme = themeInput.checked ? 'light' : 'dark';
      store.state.theme = nextTheme;
      document.documentElement.setAttribute('data-theme', nextTheme);
      localStorage.setItem('downdash_theme', nextTheme);
    });
  }

  // Language Selector
  const langSelect = document.getElementById('lang-select');
  if (langSelect) {
    langSelect.value = store.state.lang;
    langSelect.addEventListener('change', async (e) => {
      await loadLocale(e.target.value);
      renderMediaContainer();
      updateBatchActionsUI();
    });
  }

  // URL Analyze Form
  const analyzeForm = document.getElementById('analyze-form');
  const urlInput = document.getElementById('url-input');
  if (analyzeForm && urlInput) {
    analyzeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = urlInput.value.trim();
      if (url) {
        await analyzeUrl(url);
        renderMediaContainer();
        updateBatchActionsUI();
      }
    });
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

  // View Mode Toggles (Grid / List)
  const gridBtn = document.getElementById('view-grid-btn');
  const listBtn = document.getElementById('view-list-btn');

  if (gridBtn && listBtn) {
    gridBtn.addEventListener('click', () => {
      gridBtn.classList.add('active');
      listBtn.classList.remove('active');
      store.state.viewMode = 'grid';
      renderMediaContainer();
    });

    listBtn.addEventListener('click', () => {
      listBtn.classList.add('active');
      gridBtn.classList.remove('active');
      store.state.viewMode = 'list';
      renderMediaContainer();
    });
  }

  // Select / Deselect All
  const selectAllBtn = document.getElementById('select-all-btn');
  const deselectAllBtn = document.getElementById('deselect-all-btn');

  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      store.state.items.forEach(item => store.state.selectedItemIds.add(item.id));
      renderMediaContainer();
      updateBatchActionsUI();
    });
  }

  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', () => {
      store.state.selectedItemIds.clear();
      renderMediaContainer();
      updateBatchActionsUI();
    });
  }

  // Download Selected (ZIP)
  const batchZipBtn = document.getElementById('download-selected-btn');
  if (batchZipBtn) {
    batchZipBtn.addEventListener('click', () => {
      startZipDownload();
    });
  }

  // Store Subscriptions for reactive updates
  store.subscribe((prop) => {
    if (prop === 'isAnalyzing') {
      const analyzeBtn = document.getElementById('analyze-btn');
      if (analyzeBtn) {
        analyzeBtn.disabled = store.state.isAnalyzing;
        analyzeBtn.textContent = store.state.isAnalyzing ? 'Analisando...' : 'Analisar Link';
      }
      renderMediaContainer();
    }
  });
}
