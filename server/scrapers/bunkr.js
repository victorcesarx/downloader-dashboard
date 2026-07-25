async function resolveBunkrFile(fileSlug, baseUrl) {
  const pageUrl = (baseUrl || 'https://bunkr.cr') + '/f/' + fileSlug;
  try {
    const res = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();

    const cdnMatch = html.match(/var\s+jsCDN\s*=\s*"([^"]+)"/);
    const dlLinkMatch = html.match(/href=["'](https?:\/\/dl\.bunkr\.[a-z]+\/file\/([0-9]+))["']/i);
    const coverMatch = html.match(/var\s+videoCoverUrl\s*=\s*"([^"]+)"/);

    if (!cdnMatch && !dlLinkMatch) return null;

    let finalUrl, ext, name, thumbnail;

    if (cdnMatch) {
      const rawCdn = cdnMatch[1].replace(/\\\//g, '/');
      thumbnail = coverMatch ? coverMatch[1].replace(/\\\//g, '/') : null;

      const cdnUrl = new URL(rawCdn);
      const path = decodeURIComponent(cdnUrl.pathname);
      finalUrl = rawCdn;

      try {
        const signRes = await fetch('https://glb-apisign.cdn.cr/sign?path=' + encodeURIComponent(path));
        if (signRes.ok) {
          const signData = await signRes.json();
          cdnUrl.searchParams.set('token', signData.token);
          cdnUrl.searchParams.set('ex', signData.ex);
          finalUrl = cdnUrl.toString();
        }
      } catch (signErr) {
        console.warn(`[Bunkr] Signing failed for ${fileSlug}: ${signErr.message}`);
      }

      ext = (rawCdn.match(/\.(\w{3,4})(?:\?|$)/) || [])[1]?.toLowerCase() || 'mp4';
      name = fileSlug + '.' + ext;
    } else {
      const fileId = dlLinkMatch[2];
      try {
        const apiRes = await fetch(new URL(dlLinkMatch[1]).origin + '/api/_001_v2', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          body: JSON.stringify({ id: fileId })
        });

        if (apiRes.ok) {
          const meta = await apiRes.json();
          const rawUrl = new URL(meta.mediafiles + meta.path);
          if (meta.original) rawUrl.searchParams.set('n', meta.original);

          const path = decodeURIComponent(rawUrl.pathname);
          finalUrl = rawUrl.toString();
          name = meta.original || fileSlug;

          try {
            const signRes = await fetch('https://glb-apisign.cdn.cr/sign?path=' + encodeURIComponent(path));
            if (signRes.ok) {
              const signData = await signRes.json();
              rawUrl.searchParams.set('token', signData.token);
              rawUrl.searchParams.set('ex', signData.ex);
              finalUrl = rawUrl.toString();
            }
          } catch (signErr) {
            console.warn(`[Bunkr] API signing failed for ${fileSlug}: ${signErr.message}`);
          }
        }
      } catch (apiErr) {
        console.warn(`[Bunkr] API failed for ${fileSlug}: ${apiErr.message}`);
      }

      if (!finalUrl) {
        finalUrl = dlLinkMatch[1];
      }

      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      if (!name) name = titleMatch ? titleMatch[1].replace(/\s*\|\s*Bunkr\s*$/i, '').trim() : fileSlug;
      ext = (name.split('.').pop() || '').toLowerCase();
      thumbnail = null;
    }

    let type = 'document';
    if (['mp4', 'mkv', 'webm', 'mov', 'wmv', 'ts', 'avi'].includes(ext)) type = 'video';
    else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) type = 'image';

    return { type, name, url: finalUrl, ext, label: type, size: 0, thumbnail };
  } catch (err) {
    console.error(`[Bunkr] Error resolving file ${fileSlug}:`, err.message);
    return null;
  }
}

export async function scrapeBunkr(url) {
  try {
    if (!url.includes('bunkr.')) return null;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!res.ok) return null;
    const html = await res.text();
    const items = [];
    const seenSlugs = new Set();

    const isSingleFile = url.match(/\/f\/([A-Za-z0-9]+)/i);
    if (isSingleFile) {
      const item = await resolveBunkrFile(isSingleFile[1], new URL(url).origin);
      if (item) items.push(item);
    }

    if (!isSingleFile) {
      const slugRegex = /href=["']\/f\/([A-Za-z0-9]+)["']/gi;
      let sm;
      const slugs = [];
      while ((sm = slugRegex.exec(html)) !== null) {
        const slug = sm[1];
        if (!seenSlugs.has(slug)) {
          seenSlugs.add(slug);
          slugs.push(slug);
        }
      }

      if (slugs.length > 0) {
        const concurrency = 3;
        for (let i = 0; i < slugs.length; i += concurrency) {
          const batch = slugs.slice(i, i + concurrency);
          const results = await Promise.all(batch.map(slug => resolveBunkrFile(slug, new URL(url).origin)));
          for (const item of results) {
            if (item) items.push(item);
          }
        }
      }
    }

    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    return {
      title: titleMatch ? titleMatch[1].replace('| Bunkr', '').trim() : 'Bunkr Media',
      url,
      items
    };
  } catch (err) {
    console.error('Bunkr Scrape Error:', err);
    return null;
  }
}
