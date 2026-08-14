const SALT_PATTERN = /^[a-f0-9]{14}$/;

function decodeJsString(value) {
  let output = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') {
      output += value[i];
      continue;
    }
    const escape = value[++i];
    if (escape === 'x' && /^[0-9a-f]{2}$/i.test(value.slice(i + 1, i + 3))) {
      output += String.fromCharCode(Number.parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (escape === 'u' && /^[0-9a-f]{4}$/i.test(value.slice(i + 1, i + 5))) {
      output += String.fromCharCode(Number.parseInt(value.slice(i + 1, i + 5), 16));
      i += 4;
    } else {
      output += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' })[escape] ?? escape;
    }
  }
  return output;
}

function rc4Decode(encoded, key) {
  // The asset uses javascript-obfuscator's shuffled base64 alphabet (lowercase
  // letters precede uppercase), not RFC 4648's standard ordering.
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
  const bytes = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const char of encoded) {
    const value = alphabet.indexOf(char);
    if (value < 0 || value === 64) continue;
    accumulator = (accumulator << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((accumulator >> bitCount) & 0xff);
    }
  }
  const input = Buffer.from(bytes).toString('utf8');
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + key.charCodeAt(i % key.length)) % 256;
    [state[i], state[j]] = [state[j], state[i]];
  }
  let output = '';
  let i = 0;
  j = 0;
  for (let index = 0; index < input.length; index++) {
    i = (i + 1) % 256;
    j = (j + state[i]) % 256;
    [state[i], state[j]] = [state[j], state[i]];
    output += String.fromCharCode(input.charCodeAt(index) ^ state[(state[i] + state[j]) % 256]);
  }
  return output;
}

/**
 * Extracts salt candidates without evaluating GoFile's remote JavaScript.
 * The current asset uses javascript-obfuscator's string-array + RC4 layout;
 * rotations are tried as data transformations and only 14-char hex results
 * are accepted. A future incompatible layout safely returns no candidates.
 */
export function extractGoFileWTSalts(source) {
  if (typeof source !== 'string' || source.length < 100) return [];

  const arrays = [...source.matchAll(/(?:var|let|const)\s+[$\w]+\s*=\s*\[((?:\s*'(?:\\.|[^'\\])*'\s*,?)+)\]/gs)]
    .map(match => [...match[1].matchAll(/'((?:\\.|[^'\\])*)'/g)].map(item => decodeJsString(item[1])))
    .filter(items => items.length > 0)
    .sort((a, b) => b.length - a.length);
  const stringTable = arrays[0];
  if (!stringTable || stringTable.length > 1000 || stringTable.some(value => value.length > 4096)) return [];

  const baseMatch = source.match(/=\s*[$\w]+\s*-\s*(0x[0-9a-f]+|\d+)\s*;/i);
  if (!baseMatch) return [];
  const indexBase = Number(baseMatch[1]);

  const calls = [...source.matchAll(/[$\w]+\(\s*(0x[0-9a-f]+|\d+)\s*,\s*'((?:\\.|[^'\\])*)'\s*\)/gi)]
    .map(match => ({ index: Number(match[1]) - indexBase, key: decodeJsString(match[2]) }))
    .filter(call => Number.isInteger(call.index) && call.key.length > 0 && call.key.length <= 128);
  if (calls.length === 0 || calls.length > 2000 || calls.length * stringTable.length > 500_000) return [];

  const salts = new Set();
  for (let rotation = 0; rotation < stringTable.length; rotation++) {
    for (const call of calls) {
      const position = ((call.index + rotation) % stringTable.length + stringTable.length) % stringTable.length;
      try {
        const decoded = rc4Decode(stringTable[position], call.key);
        if (SALT_PATTERN.test(decoded)) salts.add(decoded);
      } catch {
        // Invalid base64/UTF-8 or a non-decoder call: it is not a candidate.
      }
    }
  }
  return [...salts];
}

export function isValidGoFileWTSalt(value) {
  return SALT_PATTERN.test(String(value || ''));
}
