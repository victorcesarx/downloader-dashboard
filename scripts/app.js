/**
 * Main Application Controller (app.js)
 */
import { store } from './state.js';
import { initI18n, loadLocale, t } from './i18n.js';
import { analyzeUrl } from './analyzer.js';
import { renderMediaContainer, updateBatchActionsUI, updateAllCardSelections, toggleBlur } from './renderer.js';
import { startZipDownload } from './zip-download.js';

function navigate(view) {
  const landing = document.getElementById('view-landing');
  const dashboard = document.getElementById('view-dashboard');
  if (!landing || !dashboard) return;

  const isDashboard = view === 'dashboard';
  landing.style.display = isDashboard ? 'none' : '';
  dashboard.style.display = isDashboard ? '' : 'none';

  document.querySelectorAll('#nav-landing, #nav-dashboard').forEach(el => {
    el.style.display = el.id === `nav-${view}` ? 'none' : '';
  });

  if (isDashboard) {
    renderMediaContainer();
    updateBatchActionsUI();
  }

  store.state.currentView = view;
}

function initRouter() {
  const hash = location.hash.slice(1) || (location.pathname.includes('dashboard') ? 'dashboard' : 'home');
  navigate(hash);

  window.addEventListener('hashchange', () => {
    const v = location.hash.slice(1) || 'home';
    navigate(v);
  });

  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const v = a.getAttribute('href').slice(1);
      location.hash = v;
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // 0. SPA Router
  initRouter();

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
  const searchWrapper = document.querySelector('.search-box-wrapper');
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

  // NSFW Blur Toggle (square button)
  const nsfwBtn = document.getElementById('nsfw-btn');
  if (nsfwBtn) {
    nsfwBtn.classList.toggle('active', store.state.thumbBlurred);
    nsfwBtn.addEventListener('click', () => {
      store.state.thumbBlurred = !store.state.thumbBlurred;
      nsfwBtn.classList.toggle('active', store.state.thumbBlurred);
      localStorage.setItem('downdash_blur', store.state.thumbBlurred);
      toggleBlur();
    });
  }

  // Toggle Select / Deselect All
  const toggleSelectBtn = document.getElementById('toggle-select-btn');

  if (toggleSelectBtn) {
    toggleSelectBtn.addEventListener('click', () => {
      const { items, activeFilter, searchQuery } = store.state;
      const next = new Set(store.state.selectedItemIds);
      const filteredIds = items.filter(item => {
        const matchesFilter = activeFilter === 'all' || item.type === activeFilter;
        const matchesSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesFilter && matchesSearch;
      }).map(i => i.id);

      const allSelected = filteredIds.every(id => next.has(id));
      if (allSelected) {
        // Deselect all filtered
        filteredIds.forEach(id => next.delete(id));
      } else {
        // Select all filtered
        filteredIds.forEach(id => next.add(id));
      }
      store.state.selectedItemIds = next;
      updateAllCardSelections();
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
        analyzeBtn.classList.toggle('loading', store.state.isAnalyzing);
        analyzeBtn.innerHTML = `<span class="spinner"></span> ${store.state.isAnalyzing ? t('search.analyzing') : t('search.analyze_btn')}`;
      }
      renderMediaContainer();
    }
  });
}
