import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/middleware/ssrf.js', () => ({ isPrivateHost: vi.fn(async host => host === 'private.example') }));

import { probeMedia } from '../../server/media/probe-media.js';

describe('probe seguro de metadados', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });

  it('obtém cabeçalhos sem baixar o arquivo inteiro', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response(null, {
      status: 200,
      headers: { 'content-length': '4096', 'content-type': 'image/png', 'accept-ranges': 'bytes' },
    })).mockResolvedValueOnce(new Response(Buffer.from('89504e470d0a1a0a0000000d4948445200000280000001e0', 'hex'), {
      status: 206,
      headers: { 'content-range': 'bytes 0-23/4096', 'content-type': 'image/png' },
    }));
    const result = await probeMedia('https://cdn.example/image.png');
    expect(result).toMatchObject({ size: 4096, mimeType: 'image/png', container: 'png', width: 640, height: 480, acceptRanges: 'bytes' });
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'HEAD', redirect: 'manual' }));
  });

  it('usa range quando HEAD não informa tamanho', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { 'content-type': 'audio/mpeg' } }))
      .mockResolvedValueOnce(new Response(Buffer.from([0]), { status: 206, headers: { 'content-range': 'bytes 0-0/9000', 'content-type': 'audio/mpeg' } }));
    const result = await probeMedia('https://cdn.example/audio.mp3');
    expect(result.size).toBe(9000);
    expect(globalThis.fetch.mock.calls[1][1]).toMatchObject({ method: 'GET', headers: expect.objectContaining({ Range: 'bytes=0-262143' }) });
  });

  it('bloqueia destinos privados antes da requisição', async () => {
    await expect(probeMedia('http://private.example/file.mp4')).rejects.toMatchObject({ status: 403 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
