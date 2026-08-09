/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatBytes, formatSpeed, sanitizeHtml, estimateFileSize, Toast, getUrlExtension, extensionFromMime, ensureFileExtension } from '../../scripts/utils.js';

describe('formatBytes', () => {
  it('returns "0 B" for 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('returns "N/A" for null/undefined/NaN', () => {
    expect(formatBytes(null)).toBe('N/A');
    expect(formatBytes(undefined)).toBe('N/A');
    expect(formatBytes(NaN)).toBe('N/A');
  });

  it('formats bytes correctly', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('supports custom decimals', () => {
    expect(formatBytes(1536, 1)).toBe('1.5 KB');
    expect(formatBytes(1536, 0)).toBe('2 KB');
  });

  it('handles small values', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1)).toBe('1 B');
  });
});

describe('formatSpeed', () => {
  it('returns "0 B/s" for null/undefined/NaN', () => {
    expect(formatSpeed(null)).toBe('0 B/s');
    expect(formatSpeed(undefined)).toBe('0 B/s');
    expect(formatSpeed(NaN)).toBe('0 B/s');
  });

  it('formats speed correctly', () => {
    expect(formatSpeed(1024)).toBe('1 KB/s');
    expect(formatSpeed(1048576)).toBe('1 MB/s');
  });
});

describe('sanitizeHtml', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
  });

  it('escapes HTML special characters', () => {
    expect(sanitizeHtml('<script>alert("xss")</script>'))
      .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escapes ampersands', () => {
    expect(sanitizeHtml('M&M')).toBe('M&amp;M');
  });

  it('leaves safe strings unchanged', () => {
    expect(sanitizeHtml('Hello world')).toBe('Hello world');
  });
});

describe('estimateFileSize', () => {
  it('returns 0 for missing dimensions', () => {
    expect(estimateFileSize(null, null)).toBe(0);
    expect(estimateFileSize(1920, null)).toBe(0);
  });

  it('estimates based on height thresholds', () => {
    expect(estimateFileSize(1920, 1080)).toBe(8 * 1024 * 1024);
    expect(estimateFileSize(1920, 720)).toBe(8 * 1024 * 1024);
    expect(estimateFileSize(854, 480)).toBe(4 * 1024 * 1024);
    expect(estimateFileSize(640, 360)).toBe(2 * 1024 * 1024);
    expect(estimateFileSize(320, 240)).toBe(1 * 1024 * 1024);
  });
});

describe('Toast', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('creates a toast container if not present', () => {
    Toast.show('Test message', 'info');
    const container = document.getElementById('toast-container');
    expect(container).not.toBeNull();
    expect(container.className).toBe('toast-container');
  });

  it('reuses existing toast container', () => {
    const container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);

    Toast.show('Test message', 'info');
    const containers = document.querySelectorAll('#toast-container');
    expect(containers.length).toBe(1);
  });

  it('creates toast with correct type class', () => {
    Toast.show('Error!', 'error');
    const toastContainer = document.getElementById('toast-container');
    const toast = toastContainer.querySelector('.toast');
    expect(toast.className).toBe('toast toast-error');
  });

  it('sanitizes message before rendering', () => {
    Toast.show('<script>alert(1)</script>', 'info');
    const toastContainer = document.getElementById('toast-container');
    const toast = toastContainer.querySelector('.toast');
    expect(toast.innerHTML).not.toContain('<script>');
    expect(toast.innerHTML).toContain('&lt;script&gt;');
  });
});

describe('getUrlExtension', () => {
  it('extracts the extension from a URL path', () => {
    expect(getUrlExtension('https://example.com/a/photo.jpeg')).toBe('jpeg');
  });

  it('ignores query strings and fragments', () => {
    expect(getUrlExtension('https://example.com/a/b.mp4?token=abc#frag')).toBe('mp4');
  });

  it('returns null when the URL has no extension', () => {
    expect(getUrlExtension('https://example.com/a/photo')).toBeNull();
    expect(getUrlExtension('https://example.com')).toBeNull();
    expect(getUrlExtension(null)).toBeNull();
  });
});

describe('extensionFromMime', () => {
  it('maps common MIME types to extensions', () => {
    expect(extensionFromMime('image/jpeg')).toBe('jpg');
    expect(extensionFromMime('image/png')).toBe('png');
    expect(extensionFromMime('video/mp4')).toBe('mp4');
    expect(extensionFromMime('audio/mpeg')).toBe('mp3');
    expect(extensionFromMime('image/tiff')).toBe('tiff');
    expect(extensionFromMime('image/heic')).toBe('heic');
    expect(extensionFromMime('image/vnd.microsoft.icon')).toBe('ico');
  });

  it('is case-insensitive and handles charset', () => {
    expect(extensionFromMime('IMAGE/JPEG')).toBe('jpg');
    expect(extensionFromMime('text/html; charset=utf-8')).toBeNull();
    expect(extensionFromMime('video/webm; codecs=vp9')).toBe('webm');
  });

  it('returns null for unknown or missing mime', () => {
    expect(extensionFromMime('application/octet-stream')).toBeNull();
    expect(extensionFromMime(undefined)).toBeNull();
  });
});

describe('ensureFileExtension', () => {
  it('keeps names that already have an extension', () => {
    expect(ensureFileExtension('photo.jpeg', 'png')).toBe('photo.jpeg');
    expect(ensureFileExtension('clipe.mp4', 'mp4')).toBe('clipe.mp4');
  });

  it('appends the extension when the name has none', () => {
    expect(ensureFileExtension('IMG_123', 'jpg')).toBe('IMG_123.jpg');
    expect(ensureFileExtension('violao', 'mp3')).toBe('violao.mp3');
  });

  it('não confunde o domínio usado como nome com uma extensão de arquivo', () => {
    expect(ensureFileExtension('pbs.twimg.com', 'jpg')).toBe('pbs.twimg.com.jpg');
    expect(ensureFileExtension('cdn.example.org', 'webp')).toBe('cdn.example.org.webp');
  });

  it('reconhece extensões equivalentes sem duplicá-las', () => {
    expect(ensureFileExtension('photo.jpeg', 'jpg')).toBe('photo.jpeg');
    expect(ensureFileExtension('scan.tif', 'tiff')).toBe('scan.tif');
  });

  it('normalizes a dot-prefixed extension', () => {
    expect(ensureFileExtension('foto', '.webp')).toBe('foto.webp');
  });

  it('falls back to the raw name when no extension is provided', () => {
    expect(ensureFileExtension('arquivo', '')).toBe('arquivo');
  });
});
