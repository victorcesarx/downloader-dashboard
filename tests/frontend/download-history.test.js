/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'webscope_download_history_v1';

function record(index) {
  return {
    item: {
      id: `history-${index}`,
      name: `file-${index}.mp4`,
      type: 'video',
      url: `https://cdn.example/file-${index}.mp4`,
      proxyUrl: `/api/media/proxy/file-${index}.mp4`,
    },
    state: 'completed',
    _done: true,
    receivedLength: index,
    totalLength: index,
    finishedAt: 1_000 + index,
  };
}

describe('histórico de downloads da sessão', () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
  });

  afterEach(() => sessionStorage.clear());

  it('hidrata no máximo os 50 registros persistidos mais recentes', async () => {
    const records = Array.from({ length: 55 }, (_, index) => record(index)).reverse();
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(records));

    const { DOWNLOAD_HISTORY_LIMIT, getActiveDownloads } = await import('../../scripts/downloader.js');

    expect(DOWNLOAD_HISTORY_LIMIT).toBe(50);
    expect(getActiveDownloads()).toHaveLength(50);
    expect(getActiveDownloads().has('history-54')).toBe(true);
    expect(getActiveDownloads().has('history-0')).toBe(false);
  });

  it('ignora histórico corrompido sem impedir a inicialização', async () => {
    sessionStorage.setItem(STORAGE_KEY, '{invalid-json');
    const { getActiveDownloads } = await import('../../scripts/downloader.js');
    expect(getActiveDownloads()).toHaveLength(0);
  });
});
