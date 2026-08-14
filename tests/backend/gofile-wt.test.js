import { describe, expect, it } from 'vitest';
import { extractGoFileWTSalts, isValidGoFileWTSalt } from '../../server/scrapers/gofile-wt.js';

const CURRENT_ENCODED_SALT = 'W5xcLmo5WRqlWQxcNqBdVmogpL7cRZO';

function syntheticAsset(extra = '') {
  return `
    function decoder(index, key) { index = index - 0x1e0; return key; }
    function strings() { var table = ['${CURRENT_ENCODED_SALT}']; return table; }
    decoder(0x1e0, 'Rwh0');
    ${extra}
  `.repeat(3);
}

describe('GoFile website-token salt extraction', () => {
  it('extracts the salt from obfuscated string-array data without executing it', () => {
    globalThis.__gofileRemoteCodeExecuted = false;
    const source = syntheticAsset('globalThis.__gofileRemoteCodeExecuted = true;');

    expect(extractGoFileWTSalts(source)).toEqual(['12af056dacea0b']);
    expect(globalThis.__gofileRemoteCodeExecuted).toBe(false);
    delete globalThis.__gofileRemoteCodeExecuted;
  });

  it('rejects malformed or ambiguous input instead of guessing', () => {
    expect(extractGoFileWTSalts('const salt = "12af056dacea0b";')).toEqual([]);
    expect(extractGoFileWTSalts('')).toEqual([]);
  });

  it('accepts only the expected hexadecimal salt format', () => {
    expect(isValidGoFileWTSalt('12af056dacea0b')).toBe(true);
    expect(isValidGoFileWTSalt('12af056dacea0')).toBe(false);
    expect(isValidGoFileWTSalt('ZZaf056dacea0b')).toBe(false);
  });
});
