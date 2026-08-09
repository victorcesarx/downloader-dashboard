/**
 * @vitest-environment node
 *
 * Regressão visual da Action Area por view (CSS-only — jsdom não calcula
 * layout). Garante que a reserva de altura é única (base 64px) e que as
 * views só sobrescrevem layout/densidade, sem min-height próprio menor.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const cssPath = join(dirname(fileURLToPath(import.meta.url)), '../../styles/main.css');
const css = readFileSync(cssPath, 'utf8');

// Extrai o bloco de regras de um seletor — aceita seletores em grupo
// (ex.: ".list-view .card-state, .list-view .card-state[data-state=\"idle\"]")
// e exige que o seletor seja seguido de ',' ou '{' (não prefixo de outro).
function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\s*${escaped}\\s*(?=[,{])[^{}]*\\{([^}]*)\\}`, 'm');
  const m = css.match(re);
  return m ? m[1] : null;
}

function minHeightFor(selector) {
  const m = ruleFor(selector)?.match(/min-height:\s*([^;]+);/);
  return m ? m[1].trim() : null;
}

describe('Action Area — min-height por view', () => {
  it('reserva de base cobre os estados sem depender do preview', () => {
    expect(minHeightFor('.card-actions.card-state')).toBe('var(--ds-space-64)');
  });

  it('List View não reduz a reserva da base', () => {
    const list = ruleFor('.list-view .card-state');
    expect(list).toContain('justify-content: center');
    // Sem min-height próprio: herda os 64px da base
    expect(list).not.toMatch(/min-height/);
  });

  it('List View escopa os slots de 140px aos filhos de estado', () => {
    const slots = ruleFor('.list-view .card-state-bar');
    expect(slots).toContain('width: 140px');
    expect(slots).toContain('min-width: 140px');
    // Os botões do idle (`.card-actions .copy-link-btn`) não são afetados:
    // a regra de slots não usa seletores universais sobre .card-state.
    expect(css).not.toMatch(/\.list-view \.card-state > \*/);
  });

  it('Grid não tem override próprio de min-height', () => {
    expect(ruleFor('.grid-view .card-state')).toBeNull();
  });

  it('Compact não repete a reserva da base', () => {
    expect(ruleFor('.compact-view .card-state')).toBeNull();
  });
});