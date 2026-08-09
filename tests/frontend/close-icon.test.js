/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { closeIconSvg } from '../../scripts/icons.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectFile = relative => resolve(testDirectory, '..', '..', relative);

describe('ícone de fechar do design system', () => {
  it('usa SVG simétrico sem depender das métricas do caractere ×', () => {
    const host = document.createElement('button');
    host.innerHTML = closeIconSvg();
    const svg = host.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('path').getAttribute('d')).toContain('M6 6');
  });

  it('todos os controles de fechar usam o componente compartilhado', () => {
    const files = [
      'scripts/renderer/modal.js',
      'scripts/keyboard-shortcuts.js',
      'scripts/download-queue.js',
      'scripts/preferences-panel.js',
      'scripts/media-inspector.js',
      'scripts/url-history.js',
    ];

    for (const file of files) {
      const source = readFileSync(projectFile(file), 'utf8');
      expect(source, file).toContain('closeIconSvg');
      expect(source, file).not.toMatch(/(?:&times;|>×<)/);
    }
  });

  it('mantém caixa, SVG e estados centralizados pelo CSS compartilhado', () => {
    const css = readFileSync(projectFile('styles/main.css'), 'utf8');
    expect(css).toMatch(/\.icon-close-btn\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s);
    expect(css).toMatch(/\.icon-close-btn \.close-icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
    expect(css).toContain('.icon-close-btn--sm');
  });
});
