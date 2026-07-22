/**
 * Single File Downloader (download.js)
 */
import { Toast, formatSpeed, formatBytes } from './utils.js';
import { t } from './i18n.js';

export async function downloadSingleItem(item) {
  if (!item || !item.url) return;

  Toast.show(`${t('toast.download_started')}: ${item.name}`, 'info');

  try {
    const downloadUrl = item.proxyUrl;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = item.name || 'download';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    console.error('Download error:', err);
    Toast.show(`Erro no download: ${err.message}`, 'error');
  }
}
