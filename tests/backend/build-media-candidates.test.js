import { describe, it, expect } from 'vitest';
import { buildMediaCandidates } from '../../server/media/build-media-candidates.js';

const PAGE_URL = 'https://site.com/dir/page.html';

describe('buildMediaCandidates', () => {
  it('resolve URL relativa', () => {
    const result = buildMediaCandidates('<img src="pic.jpg">', PAGE_URL);
    expect(result).toEqual([
      {
        url: 'https://site.com/dir/pic.jpg',
        type: 'image',
        extension: 'jpg',
        sourceTag: 'img',
        sourceAttribute: 'src',
      },
    ]);
  });

  it('classifica vídeo', () => {
    const result = buildMediaCandidates('<video src="https://cdn.example.com/clip.mp4"></video>', PAGE_URL);
    expect(result).toEqual([
      {
        url: 'https://cdn.example.com/clip.mp4',
        type: 'video',
        extension: 'mp4',
        sourceTag: 'video',
        sourceAttribute: 'src',
      },
    ]);
  });

  it('classifica imagem', () => {
    const result = buildMediaCandidates('<a href="https://cdn.example.com/foto.webp">x</a>', PAGE_URL);
    expect(result[0].type).toBe('image');
    expect(result[0].extension).toBe('webp');
    expect(result[0].sourceTag).toBe('a');
  });

  it('descarta protocolo inválido', () => {
    const result = buildMediaCandidates('<a href="ftp://cdn.example.com/x.png">x</a>', PAGE_URL);
    expect(result).toEqual([]);
  });

  it('descarta extensão desconhecida', () => {
    const result = buildMediaCandidates('<a href="https://cdn.example.com/file.bin">x</a>', PAGE_URL);
    expect(result).toEqual([]);
  });

  it('deduplica após resolver URLs', () => {
    const html = `
      <img src="https://site.com/a/b.jpg">
      <img src="../a/b.jpg">
    `;
    const result = buildMediaCandidates(html, 'https://site.com/dir/page.html');
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://site.com/a/b.jpg');
  });

  it('deduplica mantendo a origem de maior confiança', () => {
    const html = `
      <img src="https://site.com/dir/clip.mp4">
      <video src="./clip.mp4"></video>
      <meta property="og:video" content="/dir/clip.mp4">
    `;
    const result = buildMediaCandidates(html, 'https://site.com/dir/page.html');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      url: 'https://site.com/dir/clip.mp4',
      type: 'video',
      extension: 'mp4',
      sourceTag: 'meta',
      sourceAttribute: 'content',
    });
  });

  it('meta substitui style mantendo a posição da primeira ocorrência', () => {
    const result = buildMediaCandidates(
      '<div style="background-image:url(clip.mp4)"></div><meta property="og:video" content="/dir/clip.mp4">',
      PAGE_URL
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceTag: 'meta', sourceAttribute: 'content' });
  });

  it('HTML substitui script', () => {
    const result = buildMediaCandidates(
      '<script>var src="https://site.com/dir/m.mp4";</script><img src="m.mp4">',
      PAGE_URL
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceTag: 'img', sourceAttribute: 'src' });
  });

  it('score menor não substitui o maior', () => {
    const result = buildMediaCandidates(
      '<meta property="og:video" content="/dir/clip.mp4"><div style="background-image:url(clip.mp4)"></div>',
      PAGE_URL
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceTag: 'meta', sourceAttribute: 'content' });
  });

  it('empate preserva o primeiro', () => {
    const result = buildMediaCandidates(
      '<img src="x.jpg"><a href="x.jpg">link</a>',
      PAGE_URL
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceTag: 'img', sourceAttribute: 'src' });
  });

  it('posição original permanece com o primeiro slot da URL', () => {
    const html = `
      <div style="background-image:url(video.mp4)"></div>
      <img src="foto.jpg">
      <meta property="og:video" content="/dir/video.mp4">
    `;
    const result = buildMediaCandidates(html, PAGE_URL);

    expect(result.map(c => c.url)).toEqual([
      'https://site.com/dir/video.mp4',
      'https://site.com/dir/foto.jpg',
    ]);
    // meta (90) venceu, mas ocupou o slot da primeira ocorrência (style, índice 0).
    expect(result[0]).toMatchObject({ url: 'https://site.com/dir/video.mp4', sourceTag: 'meta', sourceAttribute: 'content' });
  });

  it('URLs diferentes mantêm a ordem do HTML', () => {
    const html = `
      <style>/*vazio*/</style>
      <div style="background-image:url(sty.mp4)"></div>
      <meta property="og:video" content="https://cdn.example.com/m.mp4">
      <img src="foto.jpg">
      <script>var s="https://cdn.example.com/song.mp3";</script>
    `;
    const result = buildMediaCandidates(html, PAGE_URL);

    expect(result.map(c => c.url)).toEqual([
      'https://site.com/dir/sty.mp4',
      'https://cdn.example.com/m.mp4',
      'https://site.com/dir/foto.jpg',
      'https://cdn.example.com/song.mp3',
    ]);
  });
});