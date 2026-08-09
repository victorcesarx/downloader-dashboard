import { describe, it, expect } from 'vitest';
import { createMediaItem, MEDIA_TYPES } from '../../server/media/media-item.js';

describe('createMediaItem', () => {
  it('cria um item válido a partir de um input completo', () => {
    const input = {
      id: 'a1',
      type: 'video',
      name: 'video.mp4',
      url: 'https://example.com/video.mp4',
      thumbnail: 'https://example.com/thumb.jpg',
      mimeType: 'video/mp4',
      extension: 'mp4',
      size: 1024,
      width: 1920,
      height: 1080,
      duration: 120,
      container: 'mp4',
      quality: '1080p',
      delivery: 'progressive',
      source: 'cyberdrop',
      confidenceScore: 85,
      confidenceReasons: ['source:cyberdrop'],
    };

    const item = createMediaItem(input);

    expect(item).toEqual(input);
    expect(MEDIA_TYPES).toContain('video');
  });

  it('preenche campos opcionais com null quando ausentes', () => {
    const item = createMediaItem({ id: 'b1', type: 'image', name: 'foto.jpg', url: 'https://example.com/foto.jpg' });

    expect(item).toEqual({
      id: 'b1',
      type: 'image',
      name: 'foto.jpg',
      url: 'https://example.com/foto.jpg',
      thumbnail: null,
      mimeType: null,
      extension: null,
      size: null,
      width: null,
      height: null,
      duration: null,
      container: null,
      quality: null,
      delivery: null,
      source: null,
      confidenceScore: null,
      confidenceReasons: [],
    });
  });

  it('preserva valores informados', () => {
    const item = createMediaItem({
      id: 'c1',
      type: 'audio',
      name: 'som.mp3',
      url: 'https://example.com/som.mp3',
      thumbnail: 'https://example.com/art.jpg',
      extension: 'mp3',
      size: 500,
      quality: '320kbps',
      source: 'twitter',
      duration: 0,
      width: null,
    });

    expect(item.thumbnail).toBe('https://example.com/art.jpg');
    expect(item.extension).toBe('mp3');
    expect(item.size).toBe(500);
    expect(item.quality).toBe('320kbps');
    expect(item.source).toBe('twitter');
    // Preserva valores falsy/zero e null explícitos.
    expect(item.duration).toBe(0);
    expect(item.width).toBeNull();
  });

  it('rejeita type inválido', () => {
    const base = { id: 'd1', name: 'x', url: 'https://example.com/x' };

    expect(() => createMediaItem({ ...base, type: 'carousel' })).toThrow();
    expect(() => createMediaItem({ ...base, type: 'VIDEO' })).toThrow();
    expect(() => createMediaItem({ ...base, type: '' })).toThrow();
    expect(() => createMediaItem({ ...base, type: null })).toThrow();
    expect(() => createMediaItem({ ...base, type: undefined })).toThrow();
  });

  it('rejeita campos obrigatórios ausentes', () => {
    const base = { id: 'e1', type: 'video', name: 'nome.mp4', url: 'https://example.com/nome.mp4' };

    expect(() => createMediaItem({ ...base, id: undefined })).toThrow(/id/);
    expect(() => createMediaItem({ ...base, type: undefined })).toThrow(/type/);
    expect(() => createMediaItem({ ...base, name: undefined })).toThrow(/name/);
    expect(() => createMediaItem({ ...base, url: undefined })).toThrow(/url/);
    expect(() => createMediaItem({ ...base, id: '' })).toThrow(/id/);
    expect(() => createMediaItem({ ...base, name: ' ' })).toThrow(/name/);
    expect(() => createMediaItem({})).toThrow();
    expect(() => createMediaItem(null)).toThrow();
  });

  it('não modifica o objeto original e retorna um objeto novo', () => {
    const input = {
      id: 'f1',
      type: 'document',
      name: 'doc.pdf',
      url: 'https://example.com/doc.pdf',
      size: 2048,
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    const item = createMediaItem(input);

    expect(item).not.toBe(input);
    expect(input).toEqual(snapshot);
    expect(item.size).toBe(2048);
  });

  it('vídeo MP4 -> delivery progressive', () => {
    const item = createMediaItem({
      id: 'g1', type: 'video', name: 'v.mp4', url: 'https://example.com/v.mp4', extension: 'mp4',
    });
    expect(item.delivery).toBe('progressive');
  });

  it('M3U8 -> delivery hls', () => {
    const item = createMediaItem({
      id: 'g2', type: 'video', name: 'v.m3u8', url: 'https://example.com/v.m3u8', extension: 'm3u8',
    });
    expect(item.delivery).toBe('hls');
  });

  it('MPD -> delivery dash', () => {
    const item = createMediaItem({
      id: 'g3', type: 'video', name: 'v.mpd', url: 'https://example.com/v.mpd', extension: 'mpd',
    });
    expect(item.delivery).toBe('dash');
  });

  it('imagem -> delivery null', () => {
    const item = createMediaItem({
      id: 'g4', type: 'image', name: 'foto.jpg', url: 'https://example.com/foto.jpg', extension: 'jpg',
    });
    expect(item.delivery).toBeNull();
  });

  it('preserva valor explícito válido de delivery', () => {
    const item = createMediaItem({
      id: 'g5', type: 'video', name: 'v.m3u8', url: 'https://example.com/v.m3u8',
      extension: 'm3u8', delivery: 'progressive',
    });
    expect(item.delivery).toBe('progressive');
  });

  it('rejeita valor inválido de delivery', () => {
    const base = { id: 'g6', type: 'video', name: 'v.mp4', url: 'https://example.com/v.mp4' };
    expect(() => createMediaItem({ ...base, delivery: 'streaming' })).toThrow(/delivery/);
    expect(() => createMediaItem({ ...base, delivery: '' })).toThrow(/delivery/);
    expect(() => createMediaItem({ ...base, delivery: 'HLS' })).toThrow(/delivery/);
  });

  it('aplica defaults de confiança', () => {
    const item = createMediaItem({ id: 'h1', type: 'video', name: 'v.mp4', url: 'https://example.com/v.mp4' });

    expect(item.confidenceScore).toBeNull();
    expect(item.confidenceReasons).toEqual([]);
  });

  it('aceita confidenceScore válido e preserva', () => {
    const item = createMediaItem({
      id: 'h2', type: 'video', name: 'v.mp4', url: 'https://example.com/v.mp4',
      confidenceScore: 90, confidenceReasons: ['source:meta'],
    });

    expect(item.confidenceScore).toBe(90);
    expect(item.confidenceReasons).toEqual(['source:meta']);

    expect(createMediaItem({ id: 'h3', type: 'image', name: 'f.jpg', url: 'https://example.com/f.jpg', confidenceScore: 0 }).confidenceScore).toBe(0);
    expect(createMediaItem({ id: 'h4', type: 'audio', name: 'a.mp3', url: 'https://example.com/a.mp3', confidenceScore: 100 }).confidenceScore).toBe(100);
  });

  it('rejeita confidenceScore fora do intervalo', () => {
    const base = { id: 'h5', type: 'video', name: 'v.mp4', url: 'https://example.com/v.mp4' };

    expect(() => createMediaItem({ ...base, confidenceScore: 101 })).toThrow(/confidenceScore/);
    expect(() => createMediaItem({ ...base, confidenceScore: -1 })).toThrow(/confidenceScore/);
    expect(() => createMediaItem({ ...base, confidenceScore: '90' })).toThrow(/confidenceScore/);
    expect(() => createMediaItem({ ...base, confidenceScore: NaN })).toThrow(/confidenceScore/);
    expect(() => createMediaItem({ ...base, confidenceScore: Infinity })).toThrow(/confidenceScore/);
  });

  it('copia confidenceReasons (sem reutilizar a referência de entrada)', () => {
    const reasons = ['source:meta', 'source:json-ld'];
    const item = createMediaItem({
      id: 'h6', type: 'video', name: 'v.mp4', url: 'https://example.com/v.mp4', confidenceReasons: reasons,
    });

    reasons.push('mutado depois');
    expect(item.confidenceReasons).toEqual(['source:meta', 'source:json-ld']);
    expect(item.confidenceReasons).not.toBe(reasons);

    expect(() => createMediaItem({
      id: 'h7', type: 'video', name: 'v.mp4', url: 'https://example.com/v.mp4', confidenceReasons: 'nao-array',
    })).toThrow(/confidenceReasons/);
    expect(() => createMediaItem({
      id: 'h8', type: 'video', name: 'v.mp4', url: 'https://example.com/v.mp4', confidenceReasons: [42],
    })).toThrow(/confidenceReasons/);
  });
});
