/**
 * Media Analyzer API Client
 */
import { store } from './state.js';
import { Toast } from './utils.js';
import { t } from './i18n.js';

export async function analyzeUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    Toast.show('URL inválida', 'warning');
    return null;
  }

  store.state.isAnalyzing = true;
  store.state.currentUrl = url;

  try {
    const res = await fetch('/analyze', {
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
    
    // Assign incremental ID to items for frontend state tracking
    const items = (data.items || []).map((item, idx) => ({
      id: `${Date.now()}_${idx}`,
      type: item.type || 'document',
      name: item.name || `Media_${idx + 1}`,
      url: item.url,
      proxyUrl: `/proxy?url=${encodeURIComponent(item.url)}`,
      ext: item.ext || 'bin',
      size: item.size || 0,
      label: item.label || item.type,
      thumbnail: item.thumbnail || null
    }));

    store.state.items = items;
    store.state.selectedItemIds.clear();
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
