export async function scrapePixelDrain(url) {
  try {
    const fileMatch = url.match(/pixeldrain\.com\/u\/([a-zA-Z0-9]+)/);
    const listMatch = url.match(/pixeldrain\.com\/l\/([a-zA-Z0-9]+)/);

    if (fileMatch) {
      const fileId = fileMatch[1];
      const directUrl = `https://pixeldrain.com/api/file/${fileId}`;
      let name = `PixelDrain_${fileId}`;
      let size = 0;
      let mime = '';

      try {
        const infoRes = await fetch(`https://pixeldrain.com/api/file/${fileId}/info`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://pixeldrain.com/'
          }
        });
        if (infoRes.ok) {
          const info = await infoRes.json();
          name = info.name || name;
          size = info.size || 0;
          mime = info.mime_type || '';
        }
      } catch (e) {}

      const ext = (name.split('.').pop() || '').toLowerCase();
      let type = 'document';
      if (['mp4', 'webm', 'mkv'].includes(ext) || mime.startsWith('video/')) type = 'video';
      else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) || mime.startsWith('image/')) type = 'image';
      else if (['mp3', 'wav', 'ogg'].includes(ext) || mime.startsWith('audio/')) type = 'audio';

      const thumbnail = `https://pixeldrain.com/api/file/${fileId}/thumbnail?width=128&height=128`;

      return {
        title: name,
        url,
        items: [{ type, name, url: directUrl, ext, label: mime || type, size, thumbnail }]
      };
    }

    if (listMatch) {
      const listId = listMatch[1];
      const listRes = await fetch(`https://pixeldrain.com/api/list/${listId}`);
      if (!listRes.ok) return null;
      const listData = await listRes.json();
      const files = listData.files || [];

      const items = files.map(f => {
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        let type = 'document';
        if (['mp4', 'webm', 'mkv'].includes(ext)) type = 'video';
        else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) type = 'image';
        else if (['mp3', 'wav', 'ogg'].includes(ext)) type = 'audio';

        let thumbnail = null;
        if (type === 'video' || type === 'image') {
          thumbnail = `https://pixeldrain.com/api/file/${f.id}/thumbnail?width=128&height=128`;
        }

        return {
          type,
          name: f.name,
          url: `https://pixeldrain.com/api/file/${f.id}`,
          ext,
          label: type,
          size: f.size || 0,
          thumbnail
        };
      });

      return {
        title: listData.title || `PixelDrain List (${listId})`,
        url,
        items
      };
    }
  } catch (err) {
    console.error('PixelDrain Scrape Error:', err);
  }
  return null;
}
