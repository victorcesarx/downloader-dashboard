import { describe, it, expect } from 'vitest';
import { extractHtmlCandidates } from '../../server/media/extract-html-candidates.js';

const onlyValues = (result) => result.map(c => c.value);

describe('extractHtmlCandidates', () => {
  it('extrai video[src]', () => {
    const result = extractHtmlCandidates('<div><video src="https://x/v.mp4" controls></video></div>');
    expect(result).toEqual([{ value: 'https://x/v.mp4', tag: 'video', attribute: 'src' }]);
  });

  it('extrai source[src]', () => {
    const result = extractHtmlCandidates('<video><source src="https://x/stream.webm" type="video/webm"></video>');
    expect(result).toEqual([
      { value: 'https://x/stream.webm', tag: 'source', attribute: 'src' },
    ]);
  });

  it('extrai audio[src]', () => {
    const result = extractHtmlCandidates('<p><audio src="https://x/som.mp3" controls></audio></p>');
    expect(result).toEqual([{ value: 'https://x/som.mp3', tag: 'audio', attribute: 'src' }]);
  });

  it('extrai img[src]', () => {
    const result = extractHtmlCandidates('<img src="https://x/foto.jpg" alt="foto">');
    expect(result).toEqual([{ value: 'https://x/foto.jpg', tag: 'img', attribute: 'src' }]);
  });

  it('extrai a[href]', () => {
    const result = extractHtmlCandidates('<a href="https://x/arquivo.pdf">baixar</a>');
    expect(result).toEqual([{ value: 'https://x/arquivo.pdf', tag: 'a', attribute: 'href' }]);
  });

  it('extrai atributos data-*', () => {
    const result = extractHtmlCandidates(`
      <img data-src="https://x/lazy.jpg" data-url="https://x/real.webp">
    `);
    const values = result.map(c => [c.tag, c.attribute, c.value]);
    expect(values).toEqual([
      ['img', 'data-src', 'https://x/lazy.jpg'],
      ['img', 'data-url', 'https://x/real.webp'],
    ]);
  });

  it('remove duplicatas idênticas mantendo a primeira', () => {
    const html = `
      <img src="https://x/dupe.jpg">
      <video src="https://x/dupe.jpg"></video>
      <a href="https://x/dupe.jpg">x</a>
    `;
    expect(onlyValues(extractHtmlCandidates(html))).toEqual(['https://x/dupe.jpg']);
  });

  it('ignora valores vazios', () => {
    const html = `
      <img src="">
      <a href="   ">x</a>
      <video poster=""></video>
      <audio src="https://x/som.ogg"></audio>
    `;
    expect(onlyValues(extractHtmlCandidates(html))).toEqual(['https://x/som.ogg']);
  });

  it('preserva a ordem do HTML', () => {
    const html = `
      <video src="https://x/primeiro.mp4"></video>
      <img src="https://x/segundo.jpg">
      <a href="https://x/terceiro.pdf">x</a>
    `;
    expect(onlyValues(extractHtmlCandidates(html))).toEqual([
      'https://x/primeiro.mp4',
      'https://x/segundo.jpg',
      'https://x/terceiro.pdf',
    ]);
  });

  it('extrai img[srcset] com um candidato por entrada', () => {
    const html = '<img srcset="https://x/small.jpg 480w, https://x/large.jpg 1080w">';
    const result = extractHtmlCandidates(html);
    expect(onlyValues(result)).toEqual(['https://x/small.jpg', 'https://x/large.jpg']);
    expect(result.map(c => [c.tag, c.attribute])).toEqual([['img', 'srcset'], ['img', 'srcset']]);
  });

  it('extrai source[srcset]', () => {
    const html = '<video><source srcset="https://x/a.webp 1x, https://x/b.webp 2x"></video>';
    const result = extractHtmlCandidates(html);
    expect(JSON.stringify(onlyValues(result))).toBe(JSON.stringify(['https://x/a.webp', 'https://x/b.webp']));
    expect(result.every(c => c.tag === 'source' && c.attribute === 'srcset')).toBe(true);
  });

  it('extrai data-srcset', () => {
    const html = '<img data-srcset="https://x/1.webp 480w, https://x/2.webp 960w">';
    const result = extractHtmlCandidates(html);
    expect(JSON.stringify(onlyValues(result))).toBe(JSON.stringify(['https://x/1.webp', 'https://x/2.webp']));
  });

  it('ignora descritores w', () => {
    const html = '<img srcset="https://x/a.jpg 320w, https://x/b.jpg 640w, https://x/c.jpg 1280w">';
    const result = extractHtmlCandidates(html);
    expect(onlyValues(result)).toEqual(['https://x/a.jpg', 'https://x/b.jpg', 'https://x/c.jpg']);
  });

  it('ignora descritores x', () => {
    const html = '<img srcset="https://x/a.jpg 1x, https://x/b.jpg 1.5x, https://x/c.jpg 2x">';
    const result = extractHtmlCandidates(html);
    expect(onlyValues(result)).toEqual(['https://x/a.jpg', 'https://x/b.jpg', 'https://x/c.jpg']);
  });

  it('ignora entradas vazias do srcset', () => {
    const html = '<img srcset="https://x/a.jpg 480w, , https://x/b.jpg 2x">';
    expect(onlyValues(extractHtmlCandidates(html))).toEqual(['https://x/a.jpg', 'https://x/b.jpg']);

    const empty = extractHtmlCandidates('<img srcset="">');
    expect(empty).toEqual([]);
  });

  it('deduplica srcset com src', () => {
    const html = '<img src="https://x/foto.jpg" srcset="https://x/foto.jpg 480w, https://x/hi.jpg 1080w">';
    const result = extractHtmlCandidates(html);
    expect(onlyValues(result)).toEqual(['https://x/foto.jpg', 'https://x/hi.jpg']);
  });

  it('extrai meta[property="og:video"]', () => {
    const result = extractHtmlCandidates('<meta property="og:video" content="https://x/v.mp4">');
    expect(result).toEqual([{ value: 'https://x/v.mp4', tag: 'meta', attribute: 'content' }]);
  });

  it('extrai meta[property="og:image"]', () => {
    const result = extractHtmlCandidates('<meta property="og:image" content="https://x/capa.jpg">');
    expect(result).toEqual([{ value: 'https://x/capa.jpg', tag: 'meta', attribute: 'content' }]);
  });

  it('extrai meta[name="twitter:player:stream"]', () => {
    const result = extractHtmlCandidates('<meta name="twitter:player:stream" content="https://x/stream.mp4">');
    expect(result).toEqual([{ value: 'https://x/stream.mp4', tag: 'meta', attribute: 'content' }]);
  });

  it('extrai meta[name="twitter:image"]', () => {
    const result = extractHtmlCandidates('<meta name="twitter:image" content="https://x/tw.jpg">');
    expect(result).toEqual([{ value: 'https://x/tw.jpg', tag: 'meta', attribute: 'content' }]);
  });

  it('ignora conteúdo vazio em metatags', () => {
    const html = `
      <meta property="og:video" content="">
      <meta property="og:image" content="   ">
      <meta name="twitter:image" content="https://x/ok.jpg">
    `;
    expect(onlyValues(extractHtmlCandidates(html))).toEqual(['https://x/ok.jpg']);
  });

  it('deduplica URL de metatag com URL de outro atributo', () => {
    const html = `
      <meta property="og:video" content="https://x/dupe.mp4">
      <video src="https://x/dupe.mp4"></video>
    `;
    const result = extractHtmlCandidates(html);
    expect(result).toEqual([{ value: 'https://x/dupe.mp4', tag: 'meta', attribute: 'content' }]);

    // Ordem invertida: a primeira ocorrência (video[src]) prevalece.
    const inverted = extractHtmlCandidates('<video src="https://x/dupe.mp4"></video><meta property="og:video" content="https://x/dupe.mp4">');
    expect(onlyValues(inverted)).toEqual(['https://x/dupe.mp4']);
    expect(inverted[0].tag).toBe('video');
  });

  it('extrai contentUrl do JSON-LD', () => {
    const html = '<script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://x/v.mp4"}</script>';
    const result = extractHtmlCandidates(html);
    expect(result).toEqual([{ value: 'https://x/v.mp4', tag: 'script', attribute: 'json-ld' }]);
  });

  it('extrai thumbnailUrl do JSON-LD', () => {
    const html = '<script type="application/ld+json">{"thumbnailUrl":"https://x/tumb.jpg"}</script>';
    expect(onlyValues(extractHtmlCandidates(html))).toEqual(['https://x/tumb.jpg']);
  });

  it('aceita array de imagens no JSON-LD', () => {
    const html = '<script type="application/ld+json">{"image":["https://x/1.jpg","https://x/2.jpg"]}</script>';
    const result = extractHtmlCandidates(html);
    expect(onlyValues(result)).toEqual(['https://x/1.jpg', 'https://x/2.jpg']);
    expect(result.every(c => c.tag === 'script' && c.attribute === 'json-ld')).toBe(true);
  });

  it('percorre objetos aninhados no JSON-LD', () => {
    const html = '<script type="application/ld+json">{"video":{"@type":"VideoObject","embedUrl":"https://x/e.mp4","thumbnailUrl":"https://x/t.jpg"}}</script>';
    expect(onlyValues(extractHtmlCandidates(html))).toEqual(['https://x/e.mp4', 'https://x/t.jpg']);
  });

  it('ignora JSON inválido', () => {
    const html = '<script type="application/ld+json">{isso não é json</script><img src="https://x/foto.jpg">';
    expect(onlyValues(extractHtmlCandidates(html))).toEqual(['https://x/foto.jpg']);
  });

  it('deduplica URL do JSON-LD com candidato HTML existente', () => {
    const html = `
      <meta property="og:video" content="https://x/dupe.mp4">
      <script type="application/ld+json">{"contentUrl":"https://x/dupe.mp4"}</script>
    `;
    const result = extractHtmlCandidates(html);
    expect(onlyValues(result)).toEqual(['https://x/dupe.mp4']);
    expect(result[0].tag).toBe('meta');
  });

  it('extrai background-image com aspas duplas', () => {
    const html = `<div style="background-image: url('https://x/fundo.jpg')"></div>`;
    const result = extractHtmlCandidates(html);
    expect(result).toEqual([{ value: 'https://x/fundo.jpg', tag: 'div', attribute: 'style' }]);
  });

  it('extrai background-image com aspas simples', () => {
    const html = `<div style='background-image: url("https://x/fundo.jpg")'></div>`;
    const result = extractHtmlCandidates(html);
    expect(result).toEqual([{ value: 'https://x/fundo.jpg', tag: 'div', attribute: 'style' }]);
  });

  it('extrai background-image sem aspas', () => {
    const html = `<div style="background-image: url(https://x/fundo.jpg)"></div>`;
    const result = extractHtmlCandidates(html);
    expect(result).toEqual([{ value: 'https://x/fundo.jpg', tag: 'div', attribute: 'style' }]);
  });

  it('extrai da propriedade background', () => {
    const html = `<div style="background: url(https://x/fundo.jpg) no-repeat center"></div>`;
    const result = extractHtmlCandidates(html);
    expect(result).toEqual([{ value: 'https://x/fundo.jpg', tag: 'div', attribute: 'style' }]);
  });

  it('extrai múltiplas URLs no mesmo style', () => {
    const html = `<div style="background-image: url(https://x/a.jpg); background: url(https://x/b.jpg)"></div>`;
    expect(onlyValues(extractHtmlCandidates(html))).toEqual(['https://x/a.jpg', 'https://x/b.jpg']);
  });

  it('ignora data: no style', () => {
    const html = `
      <div style="background-image: url(data:image/png;base64,abc)"></div>
      <img src="https://x/ok.jpg">
    `;
    expect(onlyValues(extractHtmlCandidates(html))).toEqual(['https://x/ok.jpg']);
  });

  it('deduplica URL do style com src', () => {
    const html = `<img src="https://x/fundo.jpg" style="background-image: url(https://x/fundo.jpg)">`;
    const result = extractHtmlCandidates(html);
    expect(result).toEqual([{ value: 'https://x/fundo.jpg', tag: 'img', attribute: 'src' }]);
  });

  it('extrai URL de vídeo dentro de script', () => {
    const html = '<script>const src="https://cdn.example.com/sv.mp4";</script>';
    const result = extractHtmlCandidates(html);
    expect(result).toEqual([{ value: 'https://cdn.example.com/sv.mp4', tag: 'script', attribute: 'script-url' }]);
  });

  it('extrai URL de imagem dentro de script', () => {
    const html = '<script>var banner="https://cdn.example.com/banner.jpg";</script>';
    const result = extractHtmlCandidates(html);
    expect(result).toEqual([{ value: 'https://cdn.example.com/banner.jpg', tag: 'script', attribute: 'script-url' }]);
  });

  it('aceita URL escapada com \/', () => {
    const html = '<script>var u="https:\\/\\/cdn.example.com\\/escaped.mp4";</script>';
    const result = extractHtmlCandidates(html);
    expect(result).toEqual([{ value: 'https://cdn.example.com/escaped.mp4', tag: 'script', attribute: 'script-url' }]);
  });

  it('extrai múltiplas URLs no mesmo script', () => {
    const html = '<script>var a="https://cdn.example.com/1.mp4", b="https://cdn.example.com/2.mp3";</script>';
    expect(onlyValues(extractHtmlCandidates(html))).toEqual([
      'https://cdn.example.com/1.mp4',
      'https://cdn.example.com/2.mp3',
    ]);
  });

  it('deduplica URLs de scripts', () => {
    const html = `
      <script>var x="https://cdn.example.com/d.mp4";</script>
      <script>var y="https://cdn.example.com/d.mp4";</script>
    `;
    expect(onlyValues(extractHtmlCandidates(html))).toEqual(['https://cdn.example.com/d.mp4']);
  });

  it('JSON-LD não duplica URL de script comum', () => {
    const html = `
      <script type="application/ld+json">{"contentUrl":"https://cdn.example.com/j.mp4"}</script>
      <script>var u="https://cdn.example.com/j.mp4";</script>
    `;
    const result = extractHtmlCandidates(html);
    expect(onlyValues(result)).toEqual(['https://cdn.example.com/j.mp4']);
    expect(result[0].attribute).toBe('json-ld');
  });

  it('extrai URL .m3u8 em script', () => {
    const html = '<script>var hls="https://cdn.example.com/master.m3u8";</script>';
    const result = extractHtmlCandidates(html);
    expect(result).toEqual([{ value: 'https://cdn.example.com/master.m3u8', tag: 'script', attribute: 'script-url' }]);
  });

  it('extrai URL .mpd em script', () => {
    const html = '<script>var dash="https://cdn.example.com/manifest.mpd";</script>';
    const result = extractHtmlCandidates(html);
    expect(result).toEqual([{ value: 'https://cdn.example.com/manifest.mpd', tag: 'script', attribute: 'script-url' }]);
  });

  it('preserva query string e hash em manifest', () => {
    const html = '<script>var u="https://cdn.example.com/master.m3u8?token=abc&d=1#seg";</script>';
    const result = extractHtmlCandidates(html);
    expect(result).toEqual([
      { value: 'https://cdn.example.com/master.m3u8?token=abc&d=1#seg', tag: 'script', attribute: 'script-url' },
    ]);
  });

  it('aceita manifest escapado com \/', () => {
    const html = '<script>var u="https:\\/\\/cdn.example.com\\/live.m3u8";</script>';
    const result = extractHtmlCandidates(html);
    expect(result).toEqual([{ value: 'https://cdn.example.com/live.m3u8', tag: 'script', attribute: 'script-url' }]);
  });

  it('deduplica manifest de script com outra fonte HTML', () => {
    const html = `
      <script>var hls="https://cdn.example.com/master.m3u8";</script>
      <video src="https://cdn.example.com/master.m3u8"></video>
    `;
    const result = extractHtmlCandidates(html);
    expect(onlyValues(result)).toEqual(['https://cdn.example.com/master.m3u8']);
    expect(result[0].attribute).toBe('script-url');
  });
});