/**
 * Media Analyzer API Client
 */
import { store } from './state.js';
import { Toast, apiFetch } from './utils.js';
import { t } from './i18n.js';

const CACHE_KEY = 'analyze_cache';
const MAX_CACHE = 10;

function getCached(url) {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    return cache[url] || null;
  } catch { return null; }
}

function setCached(url, data) {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    cache[url] = data;
    const keys = Object.keys(cache);
    if (keys.length > MAX_CACHE) {
      for (let i = 0; i < keys.length - MAX_CACHE; i++) {
        delete cache[keys[i]];
      }
    }
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}
}

export function clearCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch (e) {}
}

function buildItems(data) {
  return (data.items || []).map((item, idx) => {
    const thumb = item.thumbnail;
    const baseProxy = (u) => {
      const encoded = encodeURIComponent(u);
      const token = localStorage.getItem('downdash_token');
      return `/proxy?url=${encoded}${token ? `&token=${token}` : ''}`;
    };
    const proxyThumb = thumb && (thumb.includes('erome.com') || thumb.includes('cyberdrop') || thumb.includes('bunkr') || thumb.includes('pixeldrain.com'))
      ? baseProxy(thumb)
      : thumb;
    return {
      id: `${Date.now()}_${idx}`,
      type: item.type || 'document',
      name: item.name || `Media_${idx + 1}`,
      url: item.url,
      proxyUrl: baseProxy(item.url),
      qualities: (item.qualities || []).map(q => ({
        ...q,
        url: q.url,
        proxyUrl: baseProxy(q.url)
      })),
      selectedQualityIndex: 0,
      ext: item.ext || 'bin',
      size: item.size || 0,
      label: item.label || item.type,
      thumbnail: proxyThumb
    };
  });
}

export async function analyzeUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    Toast.show(t('toast.invalid_url'), 'warning');
    return null;
  }

  const trimmed = url.trim();
  const cached = getCached(trimmed);
  if (cached) {
    store.state.items = buildItems(cached);
    store.state.selectedItemIds = new Set();
    store.state.currentUrl = trimmed;
    store.state.isAnalyzing = false;
    Toast.show(t('toast.analyzed_success'), 'success');
    return cached;
  }

  store.state.isAnalyzing = true;
  store.state.currentUrl = trimmed;

  try {
    const res = await apiFetch('/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: trimmed,
        lang: store.state.lang
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || t('status.error'));
    }

    const data = await res.json();
    setCached(trimmed, data);
    
    store.state.items = buildItems(data);
    store.state.selectedItemIds = new Set();
    Toast.show(t('toast.analyzed_success'), 'success');
    return data;
  } catch (err) {
    console.error('Analyzer error:', err);
    Toast.show(err.message || t('status.error'), 'error');
    store.state.items = [];
    return null;
  } finally {
    store.state.isAnalyzing = false;
  }
}
