/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { store } from '../../scripts/state.js';

describe('Store', () => {
  beforeEach(() => {
    store.state.items = [];
    store.state.selectedItemIds = new Set();
    store.state.activeFilter = 'all';
    store.state.searchQuery = '';
    store.state.isAnalyzing = false;
    store.state.activeZipTask = null;
  });

  it('has initial state properties', () => {
    expect(store.state).toHaveProperty('currentUrl');
    expect(store.state).toHaveProperty('items');
    expect(store.state).toHaveProperty('selectedItemIds');
    expect(store.state).toHaveProperty('activeFilter');
    expect(store.state).toHaveProperty('sortOrder');
    expect(store.state).toHaveProperty('viewMode');
    expect(store.state).toHaveProperty('theme');
    expect(store.state).toHaveProperty('lang');
    expect(store.state).toHaveProperty('isAnalyzing');
  });

  it('notifies listeners on state change', () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.state.isAnalyzing = true;

    expect(listener).toHaveBeenCalledWith('isAnalyzing', true, expect.any(Object));
    unsubscribe();
  });

  it('unsubscribe removes listener', () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    store.state.isAnalyzing = true;
    expect(listener).not.toHaveBeenCalled();
  });

  it('getState returns current state', () => {
    const state = store.getState();
    expect(state).toBe(store.state);
  });

  it('notifies multiple listeners', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    store.subscribe(listener1);
    store.subscribe(listener2);

    store.state.activeFilter = 'video';

    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();
  });

  it('sets reactive properties via Proxy', () => {
    store.state.searchQuery = 'test query';
    expect(store.state.searchQuery).toBe('test query');
  });
});
