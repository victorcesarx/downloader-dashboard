/**
 * Media Analyzer API Client
 */
import { store } from './state.js';
import { Toast, apiFetch, ensureFileExtension, getUrlExtension } from './utils.js';
import { t } from './i18n.js';

const CACHE_KEY = 'analyze_cache';
// v3 invalidates GoFile results cached before source/MIME download metadata
// was propagated to the ZIP backend.
export const ANALYZE_CACHE_SCHEMA_VERSION = 3;
export const ANALYZE_CACHE_TTL_MS = 30 * 60 * 1000;
export const ANALYZE_CACHE_MAX_ENTRIES = 10;
export const ANALYZE_CACHE_MAX_BYTES = 1024 * 1024;

function validAnalysis(data) {
  return Boolean(data && typeof data === 'object' && Array.isArray(data.items)
    && data.items.length > 0
    && data.items.every(item => item && typeof item.url === 'string' && item.url.length > 0));
}

function emptyCache() {
  return { schemaVersion: ANALYZE_CACHE_SCHEMA_VERSION, entries: {} };
}

function readCache() {
  const raw = sessionStorage.getItem(CACHE_KEY);
  if (!raw) return emptyCache();
  const parsed = JSON.parse(raw);
  if (parsed?.schemaVersion === ANALYZE_CACHE_SCHEMA_VERSION && parsed.entries && typeof parsed.entries === 'object') {
    return parsed;
  }

  // Migração do formato legado: { [url]: analysisData }.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const migrated = emptyCache();
    const now = Date.now();
    for (const [url, data] of Object.entries(parsed)) {
      if (validAnalysis(data)) migrated.entries[url] = { cachedAt: now, data };
    }
    writeCache(migrated);
    return migrated;
  }
  return emptyCache();
}

function writeCache(cache) {
  let entries = Object.entries(cache.entries)
    .filter(([, entry]) => validAnalysis(entry?.data) && Number.isFinite(entry.cachedAt))
    .sort((a, b) => b[1].cachedAt - a[1].cachedAt)
    .slice(0, ANALYZE_CACHE_MAX_ENTRIES);
  let envelope = { schemaVersion: ANALYZE_CACHE_SCHEMA_VERSION, entries: Object.fromEntries(entries) };
  while (entries.length > 0 && new Blob([JSON.stringify(envelope)]).size > ANALYZE_CACHE_MAX_BYTES) {
    entries.pop();
    envelope = { schemaVersion: ANALYZE_CACHE_SCHEMA_VERSION, entries: Object.fromEntries(entries) };
  }
  sessionStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
}

function getCached(url) {
  try {
    const cache = readCache();
    const entry = cache.entries[url];
    if (!entry || !validAnalysis(entry.data)) return null;
    if (Date.now() - entry.cachedAt > ANALYZE_CACHE_TTL_MS) {
      delete cache.entries[url];
      writeCache(cache);
      return null;
    }
    return entry.data;
  } catch { return null; }
}

function setCached(url, data) {
  try {
    if (!validAnalysis(data)) return;
    const cache = readCache();
    const newestTimestamp = Math.max(0, ...Object.values(cache.entries).map(entry => entry?.cachedAt || 0));
    cache.entries[url] = { cachedAt: Math.max(Date.now(), newestTimestamp + 1), data };
    writeCache(cache);
  } catch { /* armazenamento indisponível ou excedido */ }
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
    const proxiedMedia = (mediaUrl) => {
      if (!mediaUrl || typeof mediaUrl !== 'string') return null;
      if (mediaUrl.startsWith('/proxy?') || mediaUrl.startsWith('data:') || mediaUrl.startsWith('blob:')) return mediaUrl;
      return /^https?:\/\//i.test(mediaUrl) ? baseProxy(mediaUrl) : mediaUrl;
    };
    const proxyThumb = proxiedMedia(thumb);
    // Extensão: usa a do scraper; se faltar, tenta extrair da URL; último
    // recurso é "bin". Sempre aplicada ao nome quando ele não termina em
    // extensão, para que o download não chegue "sem formato".
    const ext = (item.ext || getUrlExtension(item.url) || 'bin').replace(/^\./, '').toLowerCase();
    const rawName = (item.name || t('common.media_fallback', { n: idx + 1 })).trim();
    const name = ext === 'bin' ? rawName : ensureFileExtension(rawName, ext);
    const qualities = item.qualities || [];
    const preferred = store.state.preferredQuality || 'best';
    const preferredIndex = preferred === 'best' ? 0 : qualities.findIndex(q =>
      String(q.label || '').toLowerCase().includes(preferred) || `${q.height || ''}p` === preferred
    );
    const selectedQualityIndex = preferredIndex >= 0 ? preferredIndex : 0;
    const selectedQuality = qualities[selectedQualityIndex] || null;
    const selectedUrl = selectedQuality?.url || item.url;
    return {
      id: `${Date.now()}_${idx}`,
      type: item.type || 'document',
      name,
      sourceUrl: item.url,
      url: selectedUrl,
      proxyUrl: baseProxy(selectedUrl),
      qualities: qualities.map(q => ({
        ...q,
        url: q.url,
        proxyUrl: baseProxy(q.url),
        thumbnail: proxiedMedia(q.thumbnail)
      })),
      selectedQualityIndex,
      variantCount: variant ? variant.count : 0,
      variantGroupKey: variant ? variant.key : null,
      variantUrls: variant ? variant.urls : [],
      ext,
      size: Number.isFinite(selectedQuality?.size) && selectedQuality.size >= 0
        ? selectedQuality.size
        : Number.isFinite(item.size) && item.size >= 0 ? item.size : null,
      label: item.label || item.type,
      thumbnail: proxyThumb,
      mimeType: item.mimeType ?? null,
      extension: item.extension || ext,
      width: item.width ?? selectedQuality?.width ?? null,
      height: item.height ?? selectedQuality?.height ?? null,
      duration: item.duration ?? null,
      container: item.container ?? null,
      quality: item.quality ?? selectedQuality?.label ?? null,
      delivery: item.delivery ?? (item.type === 'video' ? (ext === 'm3u8' ? 'hls' : ext === 'mpd' ? 'dash' : 'progressive') : null),
      source: item.source ?? null,
      confidenceScore: item.confidenceScore ?? null,
      confidenceReasons: Array.isArray(item.confidenceReasons) ? [...item.confidenceReasons] : []
    };
  });
}

// Pré-seleciona a melhor variante de cada grupo quando `groups` existir na
// resposta. URLs desconhecidas são ignoradas; sem `groups`, nada é marcado
// (comportamento antigo: todas desmarcadas).
function preselectedIds(data, items) {
  const selected = new Set();
  if (!data || !Array.isArray(data.groups)) return selected;
  const preferred = store.state.preferredQuality || 'best';
  for (const group of data.groups) {
    let url = group && group.bestItemUrl;
    if (preferred !== 'best' && Array.isArray(group?.itemUrls)) {
      const preferredItem = items.find(item => group.itemUrls.includes(item.sourceUrl || item.url)
        && (String(item.quality || '').toLowerCase().includes(preferred)
          || `${item.height || ''}p` === preferred));
      if (preferredItem) url = preferredItem.sourceUrl || preferredItem.url;
    }
    if (typeof url !== 'string') continue;
    const match = items.find(item => (item.sourceUrl || item.url) === url);
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
