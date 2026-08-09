import { describe, it, expect } from 'vitest';
import { groupMediaVariants } from '../../server/media/group-media-variants.js';

const item = (url, extra = {}) => ({ url, ...extra });

describe('groupMediaVariants', () => {
  it('agrupa 1080p e 720p', () => {
    const a = item('https://cdn.example.com/video-1080p.mp4?token=abc', { id: 'a' });
    const b = item('https://cdn.example.com/video-720p.mp4?token=xyz', { id: 'b' });

    const groups = groupMediaVariants([a, b]);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('cdn.example.com/video.mp4');
    expect(groups[0].items).toEqual([a, b]);
  });

  it('mídias diferentes ficam separadas', () => {
    const groups = groupMediaVariants([
      item('https://cdn.example.com/movie.mp4'),
      item('https://cdn.example.com/song.mp3'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.key)).toEqual([
      'cdn.example.com/movie.mp4',
      'cdn.example.com/song.mp3',
    ]);
  });

  it('preserva a ordem dos grupos', () => {
    const groups = groupMediaVariants([
      item('https://cdn.example.com/c.mp4'),
      item('https://cdn.example.com/a.mp4'),
      item('https://cdn.example.com/b.mp4'),
    ]);

    expect(groups.map(g => g.key)).toEqual([
      'cdn.example.com/c.mp4',
      'cdn.example.com/a.mp4',
      'cdn.example.com/b.mp4',
    ]);
  });

  it('preserva a ordem interna dos itens', () => {
    const first = item('https://cdn.example.com/video-720p.mp4', { id: 'first' });
    const second = item('https://cdn.example.com/video-1080p.mp4', { id: 'second' });
    const third = item('https://cdn.example.com/video-480p.mp4', { id: 'third' });

    const groups = groupMediaVariants([first, second, third]);

    expect(groups[0].items).toEqual([first, second, third]);
  });

  it('URL inválida recebe grupo próprio', () => {
    const groups = groupMediaVariants([item('not a url'), item('https://cdn.example.com/ok.mp4')]);

    expect(groups).toHaveLength(2);
    expect(groups[0].key).toBeNull();
    expect(groups[0].items).toHaveLength(1);
  });

  it('dois itens inválidos não são agrupados juntos', () => {
    const groups = groupMediaVariants([item(''), item('nope'), item('https://cdn.example.com/ok.mp4')]);

    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual({ key: null, items: [item('')] });
    expect(groups[1]).toEqual({ key: null, items: [item('nope')] });
  });

  it('não altera o array nem os itens de entrada', () => {
    const input = [
      item('https://cdn.example.com/video-1080p.mp4?token=abc', { id: 'x' }),
      item('https://cdn.example.com/video-720p.mp4', { id: 'y' }),
    ];
    const snapshot = JSON.parse(JSON.stringify(input));

    const groups = groupMediaVariants(input);

    expect(input).toEqual(snapshot);
    expect(groups[0].items[0]).toBe(input[0]);
    expect(groups[0].items[1]).toBe(input[1]);
  });
});
