import { describe, expect, it } from 'vitest';
import { parseMediaMetadata } from '../../server/media/parse-media-metadata.js';

function box(type, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

describe('parser genérico e limitado de metadados', () => {
  it('lê dimensões de PNG, GIF e JPEG sem decodificar a imagem', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000280000001e0', 'hex');
    expect(parseMediaMetadata(png)).toMatchObject({ container: 'png', width: 640, height: 480 });

    const gif = Buffer.alloc(10);
    gif.write('GIF89a'); gif.writeUInt16LE(320, 6); gif.writeUInt16LE(200, 8);
    expect(parseMediaMetadata(gif)).toMatchObject({ container: 'gif', width: 320, height: 200 });

    const jpeg = Buffer.alloc(21);
    Buffer.from('ffd8ffc000110801e0028003', 'hex').copy(jpeg);
    expect(parseMediaMetadata(jpeg)).toMatchObject({ container: 'jpeg', width: 640, height: 480 });
  });

  it('calcula duração de WAV a partir dos cabeçalhos RIFF', () => {
    const wav = Buffer.alloc(44);
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + 176400, 4); wav.write('WAVE', 8);
    wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt32LE(176400, 28);
    wav.write('data', 36); wav.writeUInt32LE(176400, 40);
    expect(parseMediaMetadata(wav)).toMatchObject({ container: 'wav', duration: 1 });
  });

  it('lê duração e dimensões do moov de MP4', () => {
    const ftyp = box('ftyp', Buffer.from('isom0000'));
    const mvhdPayload = Buffer.alloc(24);
    mvhdPayload.writeUInt32BE(1000, 12);
    mvhdPayload.writeUInt32BE(5000, 16);
    const tkhdPayload = Buffer.alloc(84);
    tkhdPayload.writeUInt32BE(1920 * 65536, 76);
    tkhdPayload.writeUInt32BE(1080 * 65536, 80);
    const moov = box('moov', Buffer.concat([box('mvhd', mvhdPayload), box('trak', box('tkhd', tkhdPayload))]));
    expect(parseMediaMetadata(Buffer.concat([ftyp, moov]))).toMatchObject({ container: 'mp4', duration: 5, width: 1920, height: 1080 });
  });
});
