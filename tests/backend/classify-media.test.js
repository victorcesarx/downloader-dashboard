import { describe, it, expect } from 'vitest';
import { classifyMedia } from '../../server/media/classify-media.js';

describe('classifyMedia', () => {
  it('classifica por MIME type', () => {
    expect(classifyMedia({ url: 'https://x/f', mimeType: 'video/mp4' }))
      .toEqual({ type: 'video', extension: 'mp4' });
    expect(classifyMedia({ url: 'https://x/f', mimeType: 'image/jpeg' }))
      .toEqual({ type: 'image', extension: 'jpg' });
    expect(classifyMedia({ url: 'https://x/f', mimeType: 'application/pdf' }))
      .toEqual({ type: 'document', extension: 'pdf' });
  });

  it('classifica por extensão da URL', () => {
    expect(classifyMedia({ url: 'https://x/clip.webm' }))
      .toEqual({ type: 'video', extension: 'webm' });
    expect(classifyMedia({ url: 'https://x/foto.png' }))
      .toEqual({ type: 'image', extension: 'png' });
    expect(classifyMedia({ url: 'https://x/som.ogg' }))
      .toEqual({ type: 'audio', extension: 'ogg' });
    expect(classifyMedia({ url: 'https://x/backup.7z' }))
      .toEqual({ type: 'document', extension: '7z' });
  });

  it('MIME type tem prioridade sobre a URL', () => {
    expect(classifyMedia({ url: 'https://x/photo.jpg', mimeType: 'video/webm' }))
      .toEqual({ type: 'video', extension: 'webm' });
  });

  it('ignora query string', () => {
    expect(classifyMedia({ url: 'https://x/song.mp3?token=abc&d=1' }))
      .toEqual({ type: 'audio', extension: 'mp3' });
    expect(classifyMedia({ url: 'https://x/song.mp3?token=abc', mimeType: 'audio/mp4' }))
      .toEqual({ type: 'audio', extension: 'm4a' });
  });

  it('ignora hash', () => {
    expect(classifyMedia({ url: 'https://x/doc.pdf#page=2' }))
      .toEqual({ type: 'document', extension: 'pdf' });
    expect(classifyMedia({ url: 'https://x/clip.mp4?v=1#frag' }))
      .toEqual({ type: 'video', extension: 'mp4' });
  });

  it('normaliza extensão para minúsculas e sem ponto', () => {
    expect(classifyMedia({ url: 'https://x/Foto.JPG' }))
      .toEqual({ type: 'image', extension: 'jpg' });
    expect(classifyMedia({ url: 'https://x/mix.WEBM' }))
      .toEqual({ type: 'video', extension: 'webm' });
  });

  it('retorna null para extensão desconhecida', () => {
    expect(classifyMedia({ url: 'https://x/file.bin' })).toBeNull();
    expect(classifyMedia({ url: 'https://x/file.exe' })).toBeNull();
    expect(classifyMedia({ url: 'https://x/file', mimeType: 'application/octet-stream' })).toBeNull();
  });

  it('classifica .m3u8 por extensão', () => {
    expect(classifyMedia({ url: 'https://x/stream.m3u8' }))
      .toEqual({ type: 'video', extension: 'm3u8' });
  });

  it('classifica .mpd por extensão', () => {
    expect(classifyMedia({ url: 'https://x/manifest.mpd' }))
      .toEqual({ type: 'video', extension: 'mpd' });
  });

  it('classifica HLS por MIME', () => {
    expect(classifyMedia({ url: 'https://x/stream', mimeType: 'application/vnd.apple.mpegurl' }))
      .toEqual({ type: 'video', extension: 'm3u8' });
    expect(classifyMedia({ url: 'https://x/stream', mimeType: 'application/x-mpegurl' }))
      .toEqual({ type: 'video', extension: 'm3u8' });
  });

  it('classifica DASH por MIME', () => {
    expect(classifyMedia({ url: 'https://x/manifest', mimeType: 'application/dash+xml' }))
      .toEqual({ type: 'video', extension: 'mpd' });
  });

  it('classifica m3u8/mpd com query string', () => {
    expect(classifyMedia({ url: 'https://x/master.m3u8?token=abc&d=1' }))
      .toEqual({ type: 'video', extension: 'm3u8' });
    expect(classifyMedia({ url: 'https://x/manifest.mpd?v=2#frag' }))
      .toEqual({ type: 'video', extension: 'mpd' });
    expect(classifyMedia({ url: 'https://x/noext', mimeType: 'application/dash+xml; charset=utf-8' }))
      .toEqual({ type: 'video', extension: 'mpd' });
  });

  it('retorna null para URL sem extensão', () => {
    expect(classifyMedia({ url: 'https://x/photo' })).toBeNull();
    expect(classifyMedia({ url: '' })).toBeNull();
    expect(classifyMedia({})).toBeNull();
  });
});