import { describe, it, expect } from 'vitest';
import { createVariantGroupKey } from '../../server/media/create-variant-group-key.js';

const item = (url) => ({ url });

describe('createVariantGroupKey', () => {
  it('remove query string', () => {
    expect(createVariantGroupKey(item('https://example.com/video.mp4?token=abc')))
      .toBe(createVariantGroupKey(item('https://example.com/video.mp4')));
    expect(createVariantGroupKey(item('https://example.com/video.mp4?token=abc'))).toBe('example.com/video.mp4');
  });

  it('remove hash', () => {
    expect(createVariantGroupKey(item('https://example.com/video.mp4#fragment')))
      .toBe(createVariantGroupKey(item('https://example.com/video.mp4')));
  });

  it('agrupa 1080p e 720p', () => {
    const a = createVariantGroupKey(item('https://cdn.example.com/video-1080p.mp4?token=abc'));
    const b = createVariantGroupKey(item('https://cdn.example.com/video-720p.mp4?token=xyz'));

    expect(a).toBe(b);
    expect(a).toBe('cdn.example.com/video.mp4');
  });

  it('agrupa HD e SD', () => {
    expect(createVariantGroupKey(item('https://cdn.example.com/clip-hd.mp4')))
      .toBe(createVariantGroupKey(item('https://cdn.example.com/clip-sd.mp4')));
  });

  it('agrupa LQ, HQ e HD (aznude _lo/_hi/_hd)', () => {
    const base = 'https://cdn2.aznude.com/emblaingelmansundberg/livealittle/LevaLite-2025-Sundberg-HD-02';
    const lo = createVariantGroupKey(item(`${base}_lo.mp4`));
    const hi = createVariantGroupKey(item(`${base}_hi.mp4`));
    const hd = createVariantGroupKey(item(`${base}_hd.mp4`));

    expect(lo).toBe(hi);
    expect(hi).toBe(hd);
    expect(hd).toBe('cdn2.aznude.com/emblaingelmansundberg/livealittle/LevaLite-2025-Sundberg-02.mp4');
  });

  it('não remove tokens embutidos em palavras comuns', () => {
    const a = createVariantGroupKey(item('https://cdn.example.com/low-video.mp4'));
    const b = createVariantGroupKey(item('https://cdn.example.com/thumb.png'));
    expect(a).toBe('cdn.example.com/low-video.mp4');
    expect(b).toBe('cdn.example.com/thumb.png');
  });

  it('URLs diferentes continuam diferentes', () => {
    const a = createVariantGroupKey(item('https://cdn.example.com/a.mp4'));
    const b = createVariantGroupKey(item('https://cdn.example.com/b.mp4'));

    expect(a).not.toBe(b);

    expect(createVariantGroupKey(item('https://cdn.example.com/a.mp4')))
      .not.toBe(createVariantGroupKey(item('https://other.example.com/a.mp4')));
  });

  it('URL inválida retorna null', () => {
    expect(createVariantGroupKey(item('not a url'))).toBeNull();
    expect(createVariantGroupKey(item(''))).toBeNull();
    expect(createVariantGroupKey({})).toBeNull();
    expect(createVariantGroupKey({ url: undefined })).toBeNull();
    expect(createVariantGroupKey(null)).toBeNull();
  });

  it('não altera o objeto de entrada', () => {
    const input = { url: 'https://cdn.example.com/video-1080p.mp4?token=abc', type: 'video' };
    const snapshot = JSON.parse(JSON.stringify(input));

    createVariantGroupKey(input);

    expect(input).toEqual(snapshot);
  });
});
