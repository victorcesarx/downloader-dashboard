const sessions = new WeakMap();

function drawIdle(canvas) {
  const context = canvas.getContext?.('2d');
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = getComputedStyle(canvas).color || '#64748b';
  context.globalAlpha = 0.45;
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  context.globalAlpha = 1;
}

export function stopAudioWaveform(audio) {
  const session = sessions.get(audio);
  if (!session) return;
  session.cancelled = true;
  if (session.frame) cancelAnimationFrame(session.frame);
  session.context?.close?.().catch(() => {});
  sessions.delete(audio);
}

export function attachAudioWaveform(audio, canvas) {
  stopAudioWaveform(audio);
  drawIdle(canvas);

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass || !canvas.getContext) return false;

  try {
    const context = new AudioContextClass();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    const source = context.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(context.destination);
    const samples = new Uint8Array(analyser.frequencyBinCount);
    const session = { context, analyser, source, frame: 0, cancelled: false };
    sessions.set(audio, session);

    const draw = () => {
      if (session.cancelled || audio.paused || audio.ended) return;
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * pixelRatio));
      const height = Math.max(1, Math.round(rect.height * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const paint = canvas.getContext('2d');
      analyser.getByteTimeDomainData(samples);
      paint.clearRect(0, 0, width, height);
      paint.strokeStyle = getComputedStyle(canvas).color || '#ef4444';
      paint.lineWidth = Math.max(2, pixelRatio * 1.5);
      paint.beginPath();
      samples.forEach((value, index) => {
        const x = index / (samples.length - 1) * width;
        const y = value / 255 * height;
        if (index === 0) paint.moveTo(x, y);
        else paint.lineTo(x, y);
      });
      paint.stroke();
      session.frame = requestAnimationFrame(draw);
    };

    audio.addEventListener('play', () => {
      context.resume?.().catch(() => {});
      if (session.frame) cancelAnimationFrame(session.frame);
      session.frame = requestAnimationFrame(draw);
    });
    audio.addEventListener('pause', () => {
      if (session.frame) cancelAnimationFrame(session.frame);
      session.frame = 0;
    });
    audio.addEventListener('ended', () => {
      if (session.frame) cancelAnimationFrame(session.frame);
      session.frame = 0;
    });
    if (!audio.paused) session.frame = requestAnimationFrame(draw);
    return true;
  } catch {
    drawIdle(canvas);
    return false;
  }
}
