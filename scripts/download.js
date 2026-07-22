import { Toast } from './utils.js';
import { t } from './i18n.js';
import { downloadFile } from './downloader.js';

export async function downloadSingleItem(item, cardEl) {
  if (!item || !item.url) return;
  Toast.show(`${t('toast.download_started')}: ${item.name}`, 'info');
  downloadFile(item, cardEl);
}
