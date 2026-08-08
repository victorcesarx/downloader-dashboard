const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function png(buffer) {
  if (buffer.length < 24 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  return { container: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), duration: null };
}

function gif(buffer) {
  if (buffer.length < 10 || !['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return null;
  return { container: 'gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), duration: null };
}

function jpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset++; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + length + 2 > buffer.length) break;
    if (SOF_MARKERS.has(marker)) {
      return { container: 'jpeg', width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), duration: null };
    }
    offset += length + 2;
  }
  return { container: 'jpeg', width: null, height: null, duration: null };
}

function webp(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = buffer.toString('ascii', 12, 16);
  if (kind === 'VP8X') {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { container: 'webp', width, height, duration: null };
  }
  if (kind === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return { container: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, duration: null };
  }
  if (kind === 'VP8 ' && buffer.length >= 30) {
    return { container: 'webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff, duration: null };
  }
  return { container: 'webp', width: null, height: null, duration: null };
}

function wav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let byteRate = null;
  let dataSize = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ' && offset + 20 <= buffer.length) byteRate = buffer.readUInt32LE(offset + 16);
    if (id === 'data') { dataSize = size; break; }
    offset += 8 + size + (size % 2);
  }
  return { container: 'wav', width: null, height: null, duration: byteRate && dataSize !== null ? dataSize / byteRate : null };
}

function mp4Boxes(buffer, start = 0, end = buffer.length) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let header = 8;
    if (size === 1 && offset + 16 <= end) {
      const large = buffer.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large); header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) break;
    boxes.push({ type, start: offset + header, end: offset + size });
    offset += size;
  }
  return boxes;
}

function parseMp4(buffer) {
  if (buffer.length < 12) return null;
  const top = mp4Boxes(buffer);
  let moov = top.find(box => box.type === 'moov');
  const hasFtyp = top.some(box => box.type === 'ftyp');
  if (!moov) {
    const marker = buffer.indexOf(Buffer.from('moov'));
    if (marker >= 4) {
      const size = buffer.readUInt32BE(marker - 4);
      if (size >= 8 && marker - 4 + size <= buffer.length) moov = { type: 'moov', start: marker + 4, end: marker - 4 + size };
    }
  }
  if (!hasFtyp && !moov) return null;
  let duration = null;
  let width = null;
  let height = null;
  if (moov) {
    const children = mp4Boxes(buffer, moov.start, moov.end);
    const mvhd = children.find(box => box.type === 'mvhd');
    if (mvhd) {
      const version = buffer[mvhd.start];
      const timeOffset = mvhd.start + (version === 1 ? 20 : 12);
      const durationOffset = mvhd.start + (version === 1 ? 24 : 16);
      if (durationOffset + (version === 1 ? 8 : 4) <= mvhd.end) {
        const scale = buffer.readUInt32BE(timeOffset);
        const raw = version === 1 ? Number(buffer.readBigUInt64BE(durationOffset)) : buffer.readUInt32BE(durationOffset);
        if (scale > 0 && Number.isFinite(raw)) duration = raw / scale;
      }
    }
    for (const trak of children.filter(box => box.type === 'trak')) {
      const tkhd = mp4Boxes(buffer, trak.start, trak.end).find(box => box.type === 'tkhd');
      if (!tkhd || tkhd.end - tkhd.start < 8) continue;
      const candidateWidth = buffer.readUInt32BE(tkhd.end - 8) / 65536;
      const candidateHeight = buffer.readUInt32BE(tkhd.end - 4) / 65536;
      if (candidateWidth * candidateHeight > (width || 0) * (height || 0)) {
        width = candidateWidth || null;
        height = candidateHeight || null;
      }
    }
  }
  return { container: 'mp4', width, height, duration };
}

export function parseMediaMetadata(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  for (const parser of [png, gif, jpeg, webp, wav, parseMp4]) {
    const result = parser(buffer);
    if (result) return result;
  }
  return { container: null, width: null, height: null, duration: null };
}
