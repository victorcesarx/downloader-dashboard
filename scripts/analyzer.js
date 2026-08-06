/**
 * Media Analyzer API Client
 */
import { store } from './state.js';
import { Toast, apiFetch, getUrlExtension } from './utils.js';
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

// Associa cada `item.url` ao grupo de variantes ao qual pertence. Apenas
// grupos com 2+ itens são registrados; itens de grupos únicos e respostas sem
// `groups` não recebem grupo.
function variantGroupsByUrl(data) {
  const groups = new Map();
  if (!data || !Array.isArray(data.groups)) return groups;
  for (const group of data.groups) {
    if (!group || !Array.isArray(group.itemUrls) || group.itemUrls.length < 2) continue;
    const info = { key: group.key ?? null, urls: group.itemUrls, count: group.itemUrls.length };
    for (const url of group.itemUrls) groups.set(url, info);
  }
  return groups;
}

function buildItems(data) {
  const variantGroups = variantGroupsByUrl(data);
  return (data.items || []).map((item, idx) => {
    const variant = variantGroups.get(item.url) || null;
    const thumb = item.thumbnail;
    const baseProxy = (u) => {
      const encoded = encodeURIComponent(u);
      const token = localStorage.getItem('downdash_token');
      return `/proxy?url=${encoded}${token ? `&token=${token}` : ''}`;
    };
    const proxyThumb = thumb && (thumb.includes('erome.com') || thumb.includes('cyberdrop') || thumb.includes('bunkr') || thumb.includes('pixeldrain.com'))
      ? baseProxy(thumb)
      : thumb;
    // Extensão: usa a do scraper; se faltar, tenta extrair da URL; último
    // recurso é "bin". Sempre aplicada ao nome quando ele não termina em
    // extensão, para que o download não chegue "sem formato".
    const ext = (item.ext || getUrlExtension(item.url) || 'bin').replace(/^\./, '').toLowerCase();
    const rawName = (item.name || t('common.media_fallback', { n: idx + 1 })).trim();
    const name = /\.[a-z0-9]{2,8}$/i.test(rawName) ? rawName : `${rawName}.${ext}`;
    return {
      id: `${Date.now()}_${idx}`,
      type: item.type || 'document',
      name,
      url: item.url,
      proxyUrl: baseProxy(item.url),
      qualities: (item.qualities || []).map(q => ({
        ...q,
        url: q.url,
        proxyUrl: baseProxy(q.url)
      })),
      selectedQualityIndex: 0,
      variantCount: variant ? variant.count : 0,
      variantGroupKey: variant ? variant.key : null,
      variantUrls: variant ? variant.urls : [],
      ext,
      size: item.size || 0,
      label: item.label || item.type,
      thumbnail: proxyThumb
    };
  });
}

// Pré-seleciona a melhor variante de cada grupo quando `groups` existir na
// resposta. URLs desconhecidas são ignoradas; sem `groups`, nada é marcado
// (comportamento antigo: todas desmarcadas).
function preselectedIds(data, items) {
  const selected = new Set();
  if (!data || !Array.isArray(data.groups)) return selected;
  for (const group of data.groups) {
    const url = group && group.bestItemUrl;
    if (typeof url !== 'string') continue;
    const match = items.find(item => item.url === url);
    if (match) selected.add(match.id);
  }
  return selected;
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
    store.state.selectedItemIds = preselectedIds(cached, store.state.items);
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
    store.state.selectedItemIds = preselectedIds(data, store.state.items);
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
