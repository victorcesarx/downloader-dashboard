/**
 * Media Analyzer API Client
 */
import { store } from './state.js';
import { Toast, apiFetch } from './utils.js';
import { t } from './i18n.js';

export async function analyzeUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    Toast.show('URL inválida', 'warning');
    return null;
  }

  store.state.isAnalyzing = true;
  store.state.currentUrl = url;

  try {
    const res = await apiFetch('/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: url.trim(),
        lang: store.state.lang
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || t('status.error'));
    }

    const data = await res.json();
    
    const items = (data.items || []).map((item, idx) => {
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

    store.state.items = items;
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
