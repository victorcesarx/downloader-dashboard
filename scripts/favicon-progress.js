let originalFavicon = null;
let renderRevision = 0;

function faviconLink() {
  return document.querySelector('link[rel~="icon"]');
}

function rememberOriginal(link) {
  if (originalFavicon) return;
  originalFavicon = {
    href: link.getAttribute('href') || '',
    type: link.getAttribute('type'),
  };
}

function restoreOriginal(link) {
  if (!originalFavicon) return;
  link.setAttribute('href', originalFavicon.href);
  if (originalFavicon.type) link.setAttribute('type', originalFavicon.type);
  else link.removeAttribute('type');
}

function badgeLabel(count) {
  return count > 99 ? '99+' : String(count);
}

export function updateFaviconProgress(activeCount, enabled = true) {
  const link = faviconLink();
  if (!link) return;
  rememberOriginal(link);

  const revision = ++renderRevision;
  const count = Math.max(0, Math.floor(Number(activeCount) || 0));
  if (!enabled || count === 0) {
    restoreOriginal(link);
    return;
  }

  const image = new Image();
  image.onload = () => {
    if (revision !== renderRevision) return;
    try {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) return;

      context.drawImage(image, 0, 0, size, size);
      context.beginPath();
      context.arc(46, 18, 17, 0, Math.PI * 2);
      context.fillStyle = '#ef4444';
      context.fill();
      context.lineWidth = 3;
      context.strokeStyle = '#ffffff';
      context.stroke();
      context.fillStyle = '#ffffff';
      context.font = `700 ${count > 99 ? 13 : count > 9 ? 16 : 20}px system-ui, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(badgeLabel(count), 46, 19);

      if (revision !== renderRevision) return;
      link.setAttribute('href', canvas.toDataURL('image/png'));
      link.setAttribute('type', 'image/png');
    } catch {
      restoreOriginal(link);
    }
  };
  image.onerror = () => {
    if (revision === renderRevision) restoreOriginal(link);
  };
  image.src = link.href;
}

export function resetFaviconProgressForTests() {
  renderRevision += 1;
  originalFavicon = null;
}
