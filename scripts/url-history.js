import { onLocaleChange, t } from './i18n.js';
import { Toast, sanitizeHtml } from './utils.js';
import { closeIconSvg } from './icons.js';

export const URL_HISTORY_KEY = 'webscope_url_history_v1';
export const URL_HISTORY_LIMIT_KEY = 'webscope_url_history_limit';
export const DEFAULT_URL_HISTORY_LIMIT = 20;

let input = null;
let dropdown = null;
let submitUrl = null;

function limit() {
  const value = Number.parseInt(localStorage.getItem(URL_HISTORY_LIMIT_KEY) || '', 10);
  return Number.isFinite(value) ? Math.min(100, Math.max(1, value)) : DEFAULT_URL_HISTORY_LIMIT;
}

export function getUrlHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(URL_HISTORY_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter(entry => entry && typeof entry.url === 'string').slice(0, limit())
      : [];
  } catch { return []; }
}

function save(entries) {
  try { localStorage.setItem(URL_HISTORY_KEY, JSON.stringify(entries.slice(0, limit()))); } catch { /* storage indisponível */ }
}

function validHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

export function recordAnalyzedUrl(value) {
  const url = String(value || '').trim();
  if (!validHttpUrl(url)) return false;
  const entries = getUrlHistory();
  const previous = entries.find(entry => entry.url === url);
  const next = entries.filter(entry => entry.url !== url);
  const newest = Math.max(0, ...entries.map(entry => entry.lastUsedAt || 0));
  next.push({ url, pinned: previous?.pinned === true, lastUsedAt: Math.max(Date.now(), newest + 1) });
  next.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastUsedAt - a.lastUsedAt);
  save(next);
  render();
  return true;
}

export function removeAnalyzedUrl(url) {
  save(getUrlHistory().filter(entry => entry.url !== url));
  render();
}

export function togglePinnedUrl(url) {
  const entries = getUrlHistory().map(entry => entry.url === url ? { ...entry, pinned: !entry.pinned } : entry);
  entries.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastUsedAt - a.lastUsedAt);
  save(entries);
  render();
}

export function clearUrlHistory() {
  save(getUrlHistory().filter(entry => entry.pinned));
  render();
}

function filteredEntries() {
  const query = input?.value.trim().toLowerCase() || '';
  return getUrlHistory().filter(entry => !query || entry.url.toLowerCase().includes(query));
}

function render() {
  if (!dropdown) return;
  const entries = filteredEntries();
  dropdown.innerHTML = `
    <div class="url-history-header">
      <strong>${t('history.title')}</strong>
      <button type="button" class="url-history-clear">${t('history.clear')}</button>
    </div>
    <div class="url-history-list">
      ${entries.length ? entries.map(entry => `
        <div class="url-history-item" data-url="${sanitizeHtml(entry.url)}" role="option">
          <button type="button" class="url-history-reuse" title="${sanitizeHtml(entry.url)}">
            <span>${sanitizeHtml(entry.url)}</span>
          </button>
          <div class="url-history-actions">
            <button type="button" data-history-action="pin" title="${t(entry.pinned ? 'history.unpin' : 'history.pin')}">${entry.pinned ? '★' : '☆'}</button>
            <button type="button" data-history-action="copy" title="${t('actions.copy_link')}">⧉</button>
            <button class="icon-close-btn icon-close-btn--sm" type="button" data-history-action="remove" aria-label="${t('history.remove')}" title="${t('history.remove')}">${closeIconSvg()}</button>
          </div>
        </div>`).join('') : `<div class="url-history-empty">${t('history.empty')}</div>`}
    </div>`;
}

function show() {
  if (!dropdown) return;
  render();
  dropdown.hidden = false;
  input?.setAttribute('aria-expanded', 'true');
}

function hide() {
  if (dropdown) dropdown.hidden = true;
  input?.setAttribute('aria-expanded', 'false');
}

export function initUrlHistory(urlInput, onReuse) {
  input = urlInput;
  submitUrl = onReuse;
  if (!input || dropdown?.isConnected) return;
  dropdown = document.createElement('div');
  dropdown.id = 'url-history-dropdown';
  dropdown.className = 'url-history-dropdown';
  dropdown.setAttribute('role', 'listbox');
  dropdown.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  (input.closest('.search-box') || input.closest('.search-box-wrapper'))?.appendChild(dropdown);

  input.addEventListener('focus', show);
  input.addEventListener('click', show);
  input.addEventListener('input', show);
  input.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  input.addEventListener('blur', hide);
  input.form?.addEventListener('submit', hide);
  dropdown.addEventListener('mousedown', event => event.preventDefault());
  dropdown.addEventListener('click', async event => {
    if (event.target.closest('.url-history-clear')) return clearUrlHistory();
    const row = event.target.closest('.url-history-item');
    if (!row) return;
    const url = row.dataset.url;
    const action = event.target.closest('[data-history-action]')?.dataset.historyAction;
    if (action === 'pin') return togglePinnedUrl(url);
    if (action === 'remove') return removeAnalyzedUrl(url);
    if (action === 'copy') {
      try {
        await navigator.clipboard.writeText(url);
        Toast.show(t('toast.copied'), 'success');
      } catch { Toast.show(t('toast.copy_failed'), 'error'); }
      return;
    }
    if (event.target.closest('.url-history-reuse')) {
      input.value = url;
      hide();
      submitUrl?.(url);
    }
  });
  document.addEventListener('click', event => {
    if (dropdown.hidden) return;
    const target = event.target;
    if (target !== input && !dropdown.contains(target)) hide();
  });
  window.addEventListener('blur', hide);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hide();
  });
  onLocaleChange(() => { if (!dropdown.hidden) render(); });
}
