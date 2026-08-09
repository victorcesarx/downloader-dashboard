import { describe, it, expect } from 'vitest';
import { selectBestVariant } from '../../server/media/select-best-variant.js';

const item = (overrides = {}) => ({
  url: 'https://cdn.example.com/video.mp4',
  height: null,
  width: null,
  size: null,
  confidenceScore: null,
  ...overrides,
});

describe('selectBestVariant', () => {
  it('maior altura vence', () => {
    const low = item({ url: 'https://cdn.example.com/v-720.mp4', height: 720 });
    const high = item({ url: 'https://cdn.example.com/v-1080.mp4', height: 1080 });

    expect(selectBestVariant([low, high])).toBe(high);
  });

  it('largura desempata', () => {
    const a = item({ height: 720, width: 1280 });
    const b = item({ height: 720, width: 1920 });

    expect(selectBestVariant([a, b])).toBe(b);
  });

  it('tamanho desempata', () => {
    const a = item({ height: 720, width: 1280, size: 100 });
    const b = item({ height: 720, width: 1280, size: 500 });

    expect(selectBestVariant([a, b])).toBe(b);
  });

  it('confiança desempata', () => {
    const a = item({ height: 720, width: 1280, size: 100, confidenceScore: 60 });
    const b = item({ height: 720, width: 1280, size: 100, confidenceScore: 90 });

    expect(selectBestVariant([a, b])).toBe(b);
  });

  it('empate preserva o primeiro', () => {
    const first = item({ height: 1080, width: 1920, size: 500, confidenceScore: 90, url: 'https://a' });
    const second = item({ height: 1080, width: 1920, size: 500, confidenceScore: 90, url: 'https://b' });

    expect(selectBestVariant([first, second])).toBe(first);
  });

  it('valores nulos ficam abaixo dos conhecidos', () => {
    const known = item({ height: 720 });
    const unknown = item({ height: null });

    expect(selectBestVariant([unknown, known])).toBe(known);
    expect(selectBestVariant([known, unknown])).toBe(known);

    const low360 = item({ height: 360 });
    expect(selectBestVariant([low360, item({})])).toBe(low360);
  });

  it('array vazio retorna null', () => {
    expect(selectBestVariant([])).toBeNull();
    expect(selectBestVariant(null)).toBeNull();
    expect(selectBestVariant(undefined)).toBeNull();
  });

  it('input não é modificado', () => {
    const input = [
      item({ height: 720, size: 100 }),
      item({ height: 1080, size: 50 }),
      item({ height: 480 }),
    ];
    const snapshot = JSON.parse(JSON.stringify(input));

    const best = selectBestVariant(input);

    expect(best).toBe(input[1]);
    expect(input).toEqual(snapshot);
    expect(input.map(i => i.height)).toEqual([720, 1080, 480]);
  });
});
