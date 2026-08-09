import { describe, it, expect } from 'vitest';
import { resolveMediaUrl } from '../../server/media/resolve-media-url.js';

const PAGE_URL = 'https://site.com/dir/page.html';

describe('resolveMediaUrl', () => {
it('aceita URL absoluta', () => {
    expect(resolveMediaUrl('https://cdn.example.com/a.mp4', PAGE_URL))
      .toBe('https://cdn.example.com/a.mp4');
  });

  it('resolve URL relativa', () => {
    expect(resolveMediaUrl('./pic.jpg', PAGE_URL))
      .toBe('https://site.com/dir/pic.jpg');
    expect(resolveMediaUrl('../items/video.mp4', PAGE_URL))
      .toBe('https://site.com/items/video.mp4');
  });

  it('resolve URL iniciada com "/"', () => {
    expect(resolveMediaUrl('/assets/vid.mp4', PAGE_URL))
      .toBe('https://site.com/assets/vid.mp4');
  });

  it('aceita URL protocol-relative', () => {
    expect(resolveMediaUrl('//cdn.example.com/v.mkv', PAGE_URL))
      .toBe('https://cdn.example.com/v.mkv');
  });

  it('rejeita protocolo inválido', () => {
    expect(resolveMediaUrl('ftp://cdn.example.com/x.zip', PAGE_URL)).toBeNull();
    expect(resolveMediaUrl('javascript:alert(1)', PAGE_URL)).toBeNull();
    expect(resolveMediaUrl('file:///etc/passwd', PAGE_URL)).toBeNull();
  });

  it('rejeita valor vazio', () => {
    expect(resolveMediaUrl('', PAGE_URL)).toBeNull();
    expect(resolveMediaUrl('   ', PAGE_URL)).toBeNull();
    expect(resolveMediaUrl(null, PAGE_URL)).toBeNull();
    expect(resolveMediaUrl(undefined, PAGE_URL)).toBeNull();
  });

  it('rejeita URL malformada', () => {
    expect(resolveMediaUrl('http://exa mple.com/x.mp4', PAGE_URL)).toBeNull();
    expect(resolveMediaUrl('http://%', PAGE_URL)).toBeNull();
    expect(resolveMediaUrl('http://', PAGE_URL)).toBeNull();
  });
});