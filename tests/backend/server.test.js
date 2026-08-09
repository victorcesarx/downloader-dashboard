import { describe, it, expect, beforeEach } from 'vitest';

import {
  extractOGImage,
  escapeRegex,
  generateWT,
  getCookies,
  setCookies,
  MIME_TYPES,
  CACHE_DURATIONS,
  cookieJar,
} from '../../server.js';
import { cleanupOrphanedZips, zipRetryReports, zipTasks, ZIP_RETENTION_MS } from '../../server/zip.js';

describe('extractOGImage', () => {
  it('extracts og:image from property="og:image" content="..."', () => {
    const html = `<meta property="og:image" content="https://example.com/img.jpg" />`;
    expect(extractOGImage(html)).toBe('https://example.com/img.jpg');
  });

  it('extracts og:image from reversed attribute order', () => {
    const html = `<meta content="https://example.com/img.jpg" property="og:image" />`;
    expect(extractOGImage(html)).toBe('https://example.com/img.jpg');
  });

  it('extracts twitter:image', () => {
    const html = `<meta name="twitter:image" content="https://example.com/tw-img.jpg" />`;
    expect(extractOGImage(html)).toBe('https://example.com/tw-img.jpg');
  });

  it('returns null when no meta tag is present', () => {
    expect(extractOGImage('<html><head></head></html>')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractOGImage('')).toBeNull();
  });
});

describe('escapeRegex', () => {
  it('escapes special regex characters', () => {
    expect(escapeRegex('hello.world')).toBe('hello\\.world');
    expect(escapeRegex('foo+bar$')).toBe('foo\\+bar\\$');
    expect(escapeRegex('(test)')).toBe('\\(test\\)');
    expect(escapeRegex('[abc]')).toBe('\\[abc\\]');
    expect(escapeRegex('a|b')).toBe('a\\|b');
  });

  it('returns plain string unchanged if no special chars', () => {
    expect(escapeRegex('hello123')).toBe('hello123');
  });
});

describe('generateWT', () => {
  it('returns a 64-char hex string (SHA-256)', () => {
    const result = generateWT('test-token');
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces deterministic output for same input', () => {
    expect(generateWT('abc')).toBe(generateWT('abc'));
  });

  it('produces different output for different inputs', () => {
    expect(generateWT('abc')).not.toBe(generateWT('def'));
  });

  it('handles empty token', () => {
    const result = generateWT('');
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Cookie Jar', () => {
  beforeEach(() => {
    cookieJar.clear();
  });

  it('returns empty string for unknown domain', () => {
    expect(getCookies('example.com')).toBe('');
  });

  it('stores and retrieves cookies by domain', () => {
    setCookies('example.com', 'session=abc123');
    expect(getCookies('example.com')).toBe('session=abc123');
  });

  it('merges new cookies with existing ones', () => {
    setCookies('example.com', 'session=abc123');
    setCookies('example.com', 'token=xyz');
    const cookies = getCookies('example.com');
    expect(cookies).toContain('session=abc123');
    expect(cookies).toContain('token=xyz');
  });

  it('overwrites existing cookie values', () => {
    setCookies('example.com', 'session=abc123');
    setCookies('example.com', 'session=def456');
    expect(getCookies('example.com')).toBe('session=def456');
  });

  it('handles empty cookieString gracefully', () => {
    setCookies('example.com', '');
    expect(getCookies('example.com')).toBe('');
  });

  it('separates cookies by domain', () => {
    setCookies('a.com', 'key_a=val_a');
    setCookies('b.com', 'key_b=val_b');
    expect(getCookies('a.com')).toBe('key_a=val_a');
    expect(getCookies('b.com')).toBe('key_b=val_b');
  });
});

describe('MIME_TYPES', () => {
  it('provides content types for common extensions', () => {
    expect(MIME_TYPES['.html']).toBe('text/html; charset=utf-8');
    expect(MIME_TYPES['.css']).toBe('text/css; charset=utf-8');
    expect(MIME_TYPES['.js']).toBe('application/javascript; charset=utf-8');
    expect(MIME_TYPES['.png']).toBe('image/png');
    expect(MIME_TYPES['.mp4']).toBe('video/mp4');
  });

  it('returns undefined for unknown extensions', () => {
    expect(MIME_TYPES['.unknown']).toBeUndefined();
  });
});

describe('CACHE_DURATIONS', () => {
  it('provides cache durations for common extensions', () => {
    expect(CACHE_DURATIONS['.html']).toBe('no-cache');
    expect(CACHE_DURATIONS['.png']).toBe('max-age=86400');
    expect(CACHE_DURATIONS['.css']).toBe('no-cache');
  });

  it('returns undefined for unknown extensions', () => {
    expect(CACHE_DURATIONS['.unknown']).toBeUndefined();
  });
});

describe('ZIP task lifecycle cleanup', () => {
  beforeEach(() => {
    zipTasks.clear();
    zipRetryReports.clear();
  });

  it('evicts completed and cancelled tasks after the ZIP retention window while preserving active ones', () => {
    zipTasks.set('active-task', { status: 'processing', finishedAt: null });
    zipTasks.set('completed-task', { status: 'completed', finishedAt: Date.now() - ZIP_RETENTION_MS - 1 });
    zipTasks.set('cancelled-task', { status: 'cancelled', finishedAt: Date.now() - ZIP_RETENTION_MS - 1 });

    cleanupOrphanedZips();

    expect(zipTasks.has('active-task')).toBe(true);
    expect(zipTasks.has('completed-task')).toBe(false);
    expect(zipTasks.has('cancelled-task')).toBe(false);
  });

  it('remove metadados de retry depois da mesma janela de retenção', () => {
    zipRetryReports.set('fresh', { savedAt: Date.now(), itemResults: [] });
    zipRetryReports.set('expired', { savedAt: Date.now() - ZIP_RETENTION_MS - 1, itemResults: [] });

    cleanupOrphanedZips();

    expect(zipRetryReports.has('fresh')).toBe(true);
    expect(zipRetryReports.has('expired')).toBe(false);
  });
});
