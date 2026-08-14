/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPreviewModal } from '../../scripts/renderer/modal.js';

const items = [
  { id: 'image-1', type: 'image', name: 'primeira.jpg', proxyUrl: '/proxy/first', thumbnail: '/thumb/first' },
  { id: 'audio-1', type: 'audio', name: 'faixa.mp3', proxyUrl: '/proxy/audio', thumbnail: '/thumb/audio' },
  { id: 'image-2', type: 'image', name: 'ultima.jpg', proxyUrl: '/proxy/last', thumbnail: '/thumb/last' },
];

describe('lightbox e preview de áudio', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="origin">Abrir</button>';
    HTMLMediaElement.prototype.pause = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      set strokeStyle(value) {}, set globalAlpha(value) {}, set lineWidth(value) {},
    }));
    globalThis.requestAnimationFrame = vi.fn(callback => setTimeout(callback, 0));
    globalThis.cancelAnimationFrame = vi.fn(clearTimeout);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.AudioContext;
    document.body.innerHTML = '';
  });

  it('navega na ordem fornecida por botões e teclado', () => {
    openPreviewModal(items[0], items);
    const modal = document.getElementById('preview-modal');
    expect(modal.querySelector('#modal-title').textContent).toBe('primeira.jpg');
    expect(modal.querySelector('.lightbox-counter').textContent).toBe('1 / 3');
    expect(modal.querySelector('.lightbox-prev .lightbox-nav-icon')).not.toBeNull();
    expect(modal.querySelector('.lightbox-next .lightbox-nav-icon')).not.toBeNull();

    modal.querySelector('.lightbox-next').click();
    expect(modal.classList.contains('lightbox-static')).toBe(true);
    expect(modal.querySelector('#modal-title').textContent).toBe('faixa.mp3');
    expect(modal.querySelector('audio').src).toContain('/proxy/audio');

    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(modal.querySelector('#modal-title').textContent).toBe('primeira.jpg');
  });

  it('remove o estado estático ao fechar para animar somente a próxima abertura', () => {
    openPreviewModal(items[0], items);
    const modal = document.getElementById('preview-modal');
    modal.querySelector('.lightbox-next').click();
    expect(modal.classList.contains('lightbox-static')).toBe(true);
    modal.querySelector('.close-modal-btn').click();
    expect(modal.classList.contains('lightbox-static')).toBe(false);
  });

  it('faz preload apenas das thumbnails vizinhas', () => {
    const assigned = [];
    globalThis.Image = class { set src(value) { assigned.push(value); } };
    openPreviewModal(items[0], items);
    expect(assigned.sort()).toEqual(['/thumb/audio', '/thumb/last']);
    expect(assigned).not.toContain('/proxy/audio');
  });

  it('mantém o player nativo quando waveform não está disponível', () => {
    openPreviewModal(items[1], items);
    const modal = document.getElementById('preview-modal');
    expect(modal.querySelector('audio[controls]')).not.toBeNull();
    expect(modal.querySelector('.audio-waveform')).not.toBeNull();
    expect(modal.querySelector('.audio-waveform-fallback').classList.contains('visible')).toBe(true);
  });

  it('cancela mídia e fecha pelo Escape', () => {
    openPreviewModal(items[1], items);
    const modal = document.getElementById('preview-modal');
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal.classList.contains('open')).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });
});
