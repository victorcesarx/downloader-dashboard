/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFaviconProgressForTests, updateFaviconProgress } from '../../scripts/favicon-progress.js';

let pendingImages;
let context;

beforeEach(() => {
  document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="/icon.svg">';
  pendingImages = [];
  context = {
    drawImage: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,badge');
  globalThis.Image = class {
    set src(value) { this.source = value; pendingImages.push(this); }
  };
  resetFaviconProgressForTests();
});

describe('badge de progresso no favicon', () => {
  it('renderiza a contagem e limita o texto visual a 99+', () => {
    updateFaviconProgress(120, true);
    pendingImages[0].onload();

    const link = document.querySelector('link[rel~="icon"]');
    expect(link.getAttribute('href')).toBe('data:image/png;base64,badge');
    expect(link.getAttribute('type')).toBe('image/png');
    expect(context.fillText).toHaveBeenCalledWith('99+', 46, 19);
  });

  it('restaura exatamente o favicon original quando a contagem zera', () => {
    updateFaviconProgress(3, true);
    pendingImages[0].onload();
    updateFaviconProgress(0, true);

    const link = document.querySelector('link[rel~="icon"]');
    expect(link.getAttribute('href')).toBe('/icon.svg');
    expect(link.getAttribute('type')).toBe('image/svg+xml');
  });

  it('restaura o original ao desativar e ignora renderização assíncrona antiga', () => {
    updateFaviconProgress(2, true);
    updateFaviconProgress(2, false);
    pendingImages[0].onload();

    expect(document.querySelector('link[rel~="icon"]').getAttribute('href')).toBe('/icon.svg');
  });
});
