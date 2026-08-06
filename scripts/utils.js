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
export function ensureFileExtension(name, ext) {
  const base = (name || 'download').trim();
  if (/\.[a-z0-9]{2,8}$/i.test(base)) return base;
  const cleanExt = String(ext || '').replace(/^\./, '');
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

export class Toast {
  static show(message, type = 'info', duration = 4000) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const iconMap = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌'
    };

    toast.innerHTML = `<span>${iconMap[type] || 'ℹ️'}</span> <span>${sanitizeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
}
