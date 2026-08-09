import { describe, it, expect } from 'vitest';
import { scoreMediaCandidate } from '../../server/media/score-media-candidate.js';

describe('scoreMediaCandidate', () => {
  it('meta pontua 90', () => {
    const result = scoreMediaCandidate({ source: 'generic:meta' });

    expect(result).toEqual({ score: 90, reasons: ['source:meta'] });
  });

  it('JSON-LD pontua 85', () => {
    const result = scoreMediaCandidate({ source: 'generic:json-ld' });

    expect(result).toEqual({ score: 85, reasons: ['source:json-ld'] });
  });

  it('HTML comum pontua 80', () => {
    const result = scoreMediaCandidate({ source: 'generic:html' });

    expect(result).toEqual({ score: 80, reasons: ['source:html'] });
  });

  it('srcset pontua 70', () => {
    const result = scoreMediaCandidate({ source: 'generic:srcset' });

    expect(result).toEqual({ score: 70, reasons: ['source:srcset'] });
  });

  it('script pontua 60', () => {
    const result = scoreMediaCandidate({ source: 'generic:script' });

    expect(result).toEqual({ score: 60, reasons: ['source:script'] });
  });

  it('style pontua 40', () => {
    const result = scoreMediaCandidate({ source: 'generic:style' });

    expect(result).toEqual({ score: 40, reasons: ['source:style'] });
  });

  it('origem desconhecida pontua 50', () => {
    const fromUnknownSource = scoreMediaCandidate({ source: 'twitter' });
    const withoutSource = scoreMediaCandidate({});
    const nullSource = scoreMediaCandidate({ source: null });

    expect(fromUnknownSource).toEqual({ score: 50, reasons: ['source:unknown'] });
    expect(withoutSource).toEqual({ score: 50, reasons: ['source:unknown'] });
    expect(nullSource).toEqual({ score: 50, reasons: ['source:unknown'] });
  });
});
