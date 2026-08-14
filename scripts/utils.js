/**
 * Helper Utilities & Toast Component
 */
import { t } from './i18n.js';

export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  if (!bytes || isNaN(bytes)) return t('common.na') !== 'common.na' ? t('common.na') : 'N/A';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || isNaN(bytesPerSec)) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatDuration(seconds) {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function sanitizeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}

// Rough file size estimate based on video resolution height (bytes)
export function estimateFileSize(width, height) {
  if (!width || !height) return 0;
  if (height >= 720) return 8 * 1024 * 1024;
  if (height >= 480) return 4 * 1024 * 1024;
  if (height >= 360) return 2 * 1024 * 1024;
  return 1 * 1024 * 1024;
}

// Extensão derivada do Content-Type (conforme reconhecido pelos scrapers).
const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
};

// Extrai a extensão de uma URL (ex.: https://x/a/b.jpeg?t=1 -> "jpeg").
export function getUrlExtension(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

// Traduz um MIME type em extensão de arquivo (sem ponto).
export function extensionFromMime(mime) {
  if (!mime || typeof mime !== 'string') return null;
  const base = mime.split(';')[0].trim().toLowerCase();
  return MIME_EXTENSIONS[base] || null;
}

// Se o nome não terminar em extensão, acrescenta uma (sem modificar impossível).
const KNOWN_FILE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'ico', 'svg',
  'mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac',
  'pdf', 'zip', 'rar', '7z', 'tar', 'gz', 'txt', 'csv', 'json', 'xml', 'doc', 'docx', 'xls', 'xlsx',
  'ppt', 'pptx', 'html', 'htm', 'm3u8', 'mpd', 'bin',
]);

const EQUIVALENT_EXTENSIONS = {
  jpeg: 'jpg', jpg: 'jpg', tif: 'tiff', tiff: 'tiff', htm: 'html', html: 'html',
};

export function ensureFileExtension(name, ext) {
  const base = (name || 'download').trim();
  const cleanExt = String(ext || '').replace(/^\./, '').toLowerCase();
  const currentExt = base.match(/\.([a-z0-9]{2,8})$/i)?.[1]?.toLowerCase() || null;
  if (currentExt) {
    const normalizedCurrent = EQUIVALENT_EXTENSIONS[currentExt] || currentExt;
    const normalizedWanted = EQUIVALENT_EXTENSIONS[cleanExt] || cleanExt;
    if (normalizedCurrent === normalizedWanted || KNOWN_FILE_EXTENSIONS.has(currentExt)) return base;
  }
  return cleanExt ? `${base}.${cleanExt}` : base;
}

// Fetch wrapper that includes auth token if available
export function apiFetch(url, options = {}) {
  const token = localStorage.getItem('downdash_token');
  if (token) {
    options.headers = options.headers || {};
    options.headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(url, options);
}

export function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => ctx.close();
  } catch (_) {}
}

export function showSystemNotification(title, body = '') {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    new Notification(title, { body, icon: '/icon.svg' });
    return true;
  } catch { return false; }
}

export class Toast {
  static show(message, type = 'info', duration = 4000) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'false');
      document.body.appendChild(container);
    }

    const safeType = ['info', 'success', 'warning', 'error'].includes(type) ? type : 'info';
    const toast = document.createElement('div');
    toast.className = `toast toast-${safeType}`;
    toast.setAttribute('role', safeType === 'error' ? 'alert' : 'status');

    const iconMap = {
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
      success: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16.5 9"/>',
      warning: '<path d="M10.3 4.2 3.1 17a2 2 0 0 0 1.7 3h14.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 16.5h.01"/>',
      error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'
    };

    toast.style.setProperty('--toast-duration', `${Math.max(0, duration)}ms`);
    toast.innerHTML = `
      <span class="toast-accent" aria-hidden="true"></span>
      <span class="toast-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${iconMap[safeType]}</svg></span>
      <button class="toast-close" type="button" aria-label="Fechar" title="Fechar">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
      <div class="toast-timer" aria-hidden="true"></div>
      <span class="toast-message">${sanitizeHtml(message)}</span>`;
    container.appendChild(toast);

    while (container.children.length > 4) container.firstElementChild?.remove();

    let removed = false;
    const dismiss = () => {
      if (removed) return;
      removed = true;
      toast.classList.add('toast-exit');
      setTimeout(() => {
        toast.remove();
        if (container.childElementCount === 0) container.remove();
      }, 180);
    };
    toast.querySelector('.toast-close').addEventListener('click', dismiss);
    setTimeout(dismiss, Math.max(0, duration));
  }
}
