export function collectBody(req, res, maxSize) {
  return new Promise((resolve, reject) => {
    let bodyStr = '';
    let aborted = false;
    req.on('data', chunk => {
      bodyStr += chunk;
      if (Buffer.byteLength(bodyStr) > maxSize) {
        aborted = true;
        req.destroy();
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      if (!aborted) resolve(bodyStr);
    });
    req.on('error', err => reject(err));
  });
}
