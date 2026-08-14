import { describe, expect, it, beforeEach, vi } from 'vitest';
import { formatPrettyLog, increment, log, renderMetrics, resetMetrics, withContext } from '../../server/observability.js';

beforeEach(() => resetMetrics());

describe('observabilidade', () => {
  it('emite JSON correlacionado e remove dados sensíveis', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    withContext({ requestId: 'request-123' }, () => {
      log('info', 'analysis.started', {
        url: 'https://example.com/private?q=secret',
        authorization: 'Bearer hidden',
        detail: 'failed at https://example.com/private',
      });
    });
    const entry = JSON.parse(write.mock.calls[0][0]);
    expect(entry.requestId).toBe('request-123');
    expect(entry.url).toBe('[redacted]');
    expect(entry.authorization).toBe('[redacted]');
    expect(entry.detail).not.toContain('example.com');
    write.mockRestore();
  });

  it('renderiza métricas sem labels de alta cardinalidade', () => {
    increment('webscope_analysis_total', { outcome: 'success', scraper: 'generic' });
    increment('webscope_analysis_total', { outcome: 'success', scraper: 'generic' });
    const output = renderMetrics();
    expect(output).toContain('webscope_analysis_total{outcome="success",scraper="generic"} 2');
    expect(output).toContain('webscope_process_uptime_seconds');
    expect(output).not.toContain('requestId');
  });

  it('formata uma linha compacta para desenvolvimento', () => {
    const output = formatPrettyLog({
      timestamp: '2026-08-08T22:15:27.035Z',
      level: 'info',
      event: 'analysis.completed',
      requestId: 'aef8d02a-3763-462d-9471-9116e4fdb92c',
      scraper: 'twitter',
      itemCount: 2,
    });
    expect(output).toBe('22:15:27 INFO  analysis.completed  request=aef8d02a scraper=twitter itemCount=2');
  });
});
