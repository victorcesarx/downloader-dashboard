import { store } from './state.js';
import { Toast, apiFetch, playBeep, showSystemNotification } from './utils.js';
import { t } from './i18n.js';
import { summarizeMediaSizes } from './media-size.js';
import { addZipQueueTask, getZipQueueTasks, removeZipQueueTask, updateZipQueueTask } from './zip-queue.js';
import { openRightPanel } from './right-panel.js';

const activeTasks = new Map();
const pollingIntervals = new Map();

// Códigos de erro conhecidos do backend em POST /download-zip → chave i18n.
// Códigos desconhecidos caem no fallback genérico zip.start_error.
const ZIP_START_ERROR_KEYS = {
  ZIP_QUEUE_FULL: 'zip.error.queue_full',
  ZIP_IP_LIMIT_REACHED: 'zip.error.ip_limit',
  ZIP_TOO_MANY_ITEMS: 'zip.error.too_many_items',
};

// Códigos de erro que o backend usa em task.error quando a tarefa finaliza
// com status 'error'. Códigos desconhecidos caem no fallback genérico.
const ZIP_TASK_ERROR_KEYS = {
  ZIP_TEMP_STORAGE_FULL: 'zip.error.temp_storage_full',
  ZIP_SIZE_LIMIT_EXCEEDED: 'zip.error.size_limit_exceeded',
};

export async function startZipDownload() {
  const { items, selectedItemIds } = store.state;
  const selectedItems = items.filter(i => selectedItemIds.has(i.id));

  if (selectedItems.length === 0) {
    Toast.show(t('toast.no_media_selected'), 'warning');
    return;
  }

  // HLS/DASH ainda não são suportados no ZIP: ficam fora do payload, mas o
  // restante continua entrando normalmente.
  const downloadable = selectedItems.filter(i => i.delivery !== 'hls' && i.delivery !== 'dash');
  if (downloadable.length === 0) {
    Toast.show(t('toast.streaming_unsupported'), 'warning');
    return;
  }

  const zipName = await promptZipName();
  if (zipName === null) return;

  try {
    const res = await apiFetch('/download-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: downloadable.map(item => ({
          name: item.name,
          url: item.url,
          ext: item.ext
        })),
        ignoredItems: selectedItems
          .filter(item => item.delivery === 'hls' || item.delivery === 'dash')
          .map(item => ({ name: item.name, ext: item.ext, reason: `unsupported ${item.delivery}` }))
      })
    });

    if (!res.ok) {
      // Servidor responde { error: { code, message } }. O código é convertido
      // em uma chave i18n específica; códigos desconhecidos usam o fallback
      // genérico zip.start_error (nunca mostramos "Erro 503/429/400").
      const errData = await res.json().catch(() => ({}));
      const code = errData?.error?.code;
      const key = ZIP_START_ERROR_KEYS[code] || 'zip.start_error';
      throw new Error(t(key));
    }

    const data = await res.json();
    const taskId = data.taskId;

    const finalName = (zipName || 'webscope_media_pack');
    activeTasks.set(taskId, finalName.endsWith('.zip') ? finalName : finalName + '.zip');

    const { knownBytes: totalBytes, unknownCount } = summarizeMediaSizes(downloadable);
    store.state.activeZipTask = { taskId, total: downloadable.length, totalBytes, unknownCount, progress: 0 };
    addZipQueueTask({
      taskId,
      name: finalName.endsWith('.zip') ? finalName : `${finalName}.zip`,
      total: downloadable.length,
      totalBytes,
      unknownCount,
      totalLength: totalBytes,
      totalLengthKnown: unknownCount === 0,
    });
    openRightPanel('downloads');
    startPollingStatus(taskId);
  } catch (err) {
    console.error('ZIP start error:', err);
    Toast.show(err.message || t('toast.zip_error'), 'error');
  }
}

export function startPollingStatus(taskId) {
  const interval = setInterval(async () => {
    try {
      const res = await apiFetch(`/download-zip/status/${taskId}`);
      if (!res.ok) return;

      const data = await res.json();
      updateZipPanelUI(taskId, data);

      if (data.status === 'completed') {
        clearInterval(interval);
        pollingIntervals.delete(taskId);
        store.state.activeZipTask = null;
        onZipCompleted(taskId);
      } else if (data.status === 'error' || data.status === 'cancelled') {
        clearInterval(interval);
        pollingIntervals.delete(taskId);
        activeTasks.delete(taskId);
        store.state.activeZipTask = null;
        // task.error traz o código (ex.: ZIP_TEMP_STORAGE_FULL) ou uma mensagem
        // livre; códigos conhecidos são convertidos em chave i18n, o restante
        // usa a própria mensagem do servidor (ou o fallback zip.task_error).
        const code = data.status === 'error' ? data.error : null;
        const errorKey = ZIP_TASK_ERROR_KEYS[code];
        const msg = errorKey ? t(errorKey) : (data.error || t('zip.task_error'));
        Toast.show(msg, 'error');
        showZipPanelError(taskId, msg);
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, 1000);

  pollingIntervals.set(taskId, interval);
}

export function updateZipPanelUI(taskId, data) {
  const currentTask = getZipQueueTasks().get(taskId);
  if (currentTask) {
    updateZipQueueTask(taskId, {
      state: data.status,
      processed: data.processed || 0,
      total: data.total || currentTask.total || 1,
      currentBytes: data.currentBytes || 0,
      receivedLength: data.currentBytes || 0,
      totalLength: currentTask.totalBytes || 0,
      totalLengthKnown: currentTask.unknownCount === 0,
      speed: data.speed || 0,
      queuePosition: data.queuePosition ?? null,
      errorMsg: data.error || null,
      report: Array.isArray(data.report) ? data.report : currentTask.report || [],
      retryOf: data.retryOf || currentTask.retryOf || null,
    });
  }
}

function onZipCompleted(taskId) {
  let customName = activeTasks.get(taskId) || getZipQueueTasks().get(taskId)?.name || 'webscope_media_pack.zip';
  activeTasks.delete(taskId);

  if (store.state.soundEnabled) playBeep();
  if (store.state.notificationsEnabled) showSystemNotification(t('zip.download_ready'));
  if (!customName.endsWith('.zip')) customName += '.zip';
  const token = localStorage.getItem('downdash_token');
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  params.set('filename', customName);
  updateZipQueueTask(taskId, {
    state: 'completed',
    resultUrl: `/download-zip/result/${taskId}?${params}`,
    name: customName,
  });

}

function showZipPanelError(taskId, message) {
  updateZipQueueTask(taskId, { state: 'error', errorMsg: message });
}

export async function cancelZipTask(taskId) {
  activeTasks.delete(taskId);
  store.state.activeZipTask = null;
  const interval = pollingIntervals.get(taskId);
  if (interval) {
    clearInterval(interval);
    pollingIntervals.delete(taskId);
  }
  try {
    await apiFetch(`/download-zip/cancel/${taskId}`);
  } catch (e) {}
  removeZipQueueTask(taskId);
}

export function downloadZipResult(taskId) {
  const task = getZipQueueTasks().get(taskId);
  if (!task?.resultUrl || task.downloaded) return false;
  const anchor = document.createElement('a');
  anchor.href = task.resultUrl;
  anchor.download = task.name;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  updateZipQueueTask(taskId, { downloaded: true, finishedAt: Date.now() });
  return true;
}

export function dismissZipTask(taskId) {
  return removeZipQueueTask(taskId);
}

export async function retryZipFailures(taskId) {
  const source = getZipQueueTasks().get(taskId);
  const failedCount = source?.report?.filter(item => item.outcome === 'failed').length || 0;
  if (!source || failedCount === 0) return false;
  try {
    const res = await apiFetch(`/download-zip/retry/${taskId}`, { method: 'POST' });
    if (!res.ok) throw new Error(t('zip.retry_error'));
    const data = await res.json();
    const baseName = source.name.replace(/\.zip$/i, '');
    const retryName = `${baseName}-retry.zip`;
    activeTasks.set(data.taskId, retryName);
    addZipQueueTask({
      taskId: data.taskId,
      name: retryName,
      total: data.total || failedCount,
      totalBytes: 0,
      unknownCount: data.total || failedCount,
      totalLength: 0,
      totalLengthKnown: false,
      retryOf: taskId,
    });
    openRightPanel('downloads');
    startPollingStatus(data.taskId);
    Toast.show(t('zip.retry_started', { count: data.total || failedCount }), 'success');
    return true;
  } catch (err) {
    Toast.show(err.message || t('zip.retry_error'), 'error');
    return false;
  }
}

function reportPayload(task) {
  const items = Array.isArray(task?.report) ? task.report : [];
  const counts = { completed: 0, failed: 0, ignored: 0, pending: 0 };
  items.forEach(item => { counts[item.outcome] = (counts[item.outcome] || 0) + 1; });
  return { taskId: task.taskId, zipName: task.name, generatedAt: new Date().toISOString(), counts, items };
}

export function exportZipReport(taskId, format = 'json') {
  const task = getZipQueueTasks().get(taskId);
  if (!task?.report?.length) return false;
  const payload = reportPayload(task);
  const isText = format === 'text';
  const content = isText
    ? [
        `${t('zip.report_title')}: ${task.name}`,
        `${t('zip.report_completed')}: ${payload.counts.completed}`,
        `${t('zip.report_failed')}: ${payload.counts.failed}`,
        `${t('zip.report_ignored')}: ${payload.counts.ignored}`,
        '',
        ...payload.items.map(item => `[${item.outcome.toUpperCase()}] ${item.name}${item.reason ? ` — ${item.reason}` : ''}`),
      ].join('\n')
    : JSON.stringify(payload, null, 2);
  const blobUrl = URL.createObjectURL(new Blob([content], { type: isText ? 'text/plain;charset=utf-8' : 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = `${task.name.replace(/\.zip$/i, '')}-report.${isText ? 'txt' : 'json'}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
  return true;
}

function promptZipName() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'rename-overlay';
    overlay.innerHTML = `
      <div class="rename-dialog">
        <label class="rename-label" data-i18n="zip.rename_label">${t('zip.rename_label')}</label>
        <div class="rename-input-group">
          <input class="rename-input" type="text" value="webscope_media_pack" spellcheck="false" autofocus>
          <span class="rename-input-suffix">.zip</span>
        </div>
        <div class="rename-actions">
          <button class="btn btn-secondary btn-sm rename-cancel" data-i18n="actions.cancel">${t('actions.cancel')}</button>
          <button class="btn btn-primary btn-sm rename-confirm" data-i18n="zip.start">${t('zip.start')}</button>
        </div>
      </div>
    `;

    const input = overlay.querySelector('.rename-input');
    const confirmBtn = overlay.querySelector('.rename-confirm');
    const cancelBtn = overlay.querySelector('.rename-cancel');

    function close(result) {
      overlay.remove();
      document.body.style.overflow = '';
      resolve(result);
    }

    confirmBtn.addEventListener('click', () => close((input.value.trim() || 'webscope_media_pack') + '.zip'));
    cancelBtn.addEventListener('click', () => close(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cancelBtn.click();
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => input.select());
  });
}
