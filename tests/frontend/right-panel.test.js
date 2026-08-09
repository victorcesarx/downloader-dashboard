/**
 * Coordenador de painéis laterais (scripts/right-panel.js).
 *
 * Cobre: estado inicial, abertura/fechamento/toggle do painel de
 * downloads, rejeição previsível de painéis inválidos (incluindo
 * entradas desconhecidas e exclusividade entre downloads e inspector
 * estrutural (nunca existe mais de um painel ativo).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  openRightPanel,
  closeRightPanel,
  toggleRightPanel,
  getActiveRightPanel,
  setOnRightPanelChange,
} from '../../scripts/right-panel.js';

beforeEach(() => {
  closeRightPanel();
});

describe('right panel coordinator (estado)', () => {
  it('estado inicial é null', () => {
    expect(getActiveRightPanel()).toBeNull();
  });

  it('openRightPanel("downloads") ativa o painel de downloads', () => {
    openRightPanel('downloads');
    expect(getActiveRightPanel()).toBe('downloads');
  });

  it('closeRightPanel() fecha o painel ativo', () => {
    openRightPanel('downloads');
    closeRightPanel();
    expect(getActiveRightPanel()).toBeNull();
  });

  it('toggleRightPanel("downloads") abre quando fechado', () => {
    toggleRightPanel('downloads');
    expect(getActiveRightPanel()).toBe('downloads');
  });

  it('toggleRightPanel("downloads") novamente fecha', () => {
    openRightPanel('downloads');
    toggleRightPanel('downloads');
    expect(getActiveRightPanel()).toBeNull();
  });

  it('painel inválido é rejeitado/ignorado de forma previsível', () => {
    openRightPanel('bogus');
    expect(getActiveRightPanel()).toBeNull();

    openRightPanel(123);
    openRightPanel(null);
    openRightPanel(undefined);
    expect(getActiveRightPanel()).toBeNull();

    toggleRightPanel('bogus');
    expect(getActiveRightPanel()).toBeNull();
  });

  it('trocar de painel mantém um único painel ativo (exclusividade estrutural)', () => {
    openRightPanel('downloads');
    expect(getActiveRightPanel()).toBe('downloads');
    openRightPanel('inspector');
    expect(getActiveRightPanel()).toBe('inspector');
    expect(typeof getActiveRightPanel()).toBe('string');
  });

  it('toggle do inspector abre e fecha o painel', () => {
    toggleRightPanel('inspector');
    expect(getActiveRightPanel()).toBe('inspector');
    toggleRightPanel('inspector');
    expect(getActiveRightPanel()).toBeNull();
  });

  it('abrir painel já ativo não notifica novamente', () => {
    const cb = vi.fn();
    setOnRightPanelChange(cb);
    openRightPanel('downloads');
    openRightPanel('downloads');
    closeRightPanel();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenNthCalledWith(1, 'downloads');
    expect(cb).toHaveBeenNthCalledWith(2, null);
  });
});
