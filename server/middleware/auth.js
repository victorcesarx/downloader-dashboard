import { AUTH_TOKEN } from '../config.js';

export function requireAuth(req, res) {
  if (!AUTH_TOKEN) return true;
  const header = req.headers['authorization'] || '';
  const queryToken = new URL(req.url, `http://${req.headers.host}`).searchParams.get('token');
  const provided = header.startsWith('Bearer ') ? header.slice(7) : queryToken;
  if (provided === AUTH_TOKEN) return true;
  if (req.method === 'OPTIONS') return true;
  return false;
}

export function sendUnauthorized(res) {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized — provide DOWNDASH_TOKEN via Authorization header or ?token=' }));
}

export function getLoginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WebScope — Login</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f0f13; color: #e0e0e0;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh;
  }
  .login-box {
    background: #1a1a24; border-radius: 12px;
    padding: 40px; width: 360px; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  h1 { font-size: 1.4rem; margin-bottom: 8px; color: #fff; }
  p { font-size: 0.85rem; color: #888; margin-bottom: 24px; }
  input {
    width: 100%; padding: 12px 14px; border-radius: 8px;
    border: 1px solid #333; background: #0f0f13; color: #e0e0e0;
    font-size: 0.95rem; outline: none; margin-bottom: 16px;
  }
  input:focus { border-color: #6366f1; }
  button {
    width: 100%; padding: 12px; border-radius: 8px; border: none;
    background: #6366f1; color: #fff; font-size: 0.95rem;
    cursor: pointer; font-weight: 600;
  }
  button:hover { background: #5558e6; }
  .error { color: #f87171; font-size: 0.85rem; margin-top: 12px; display: none; }
</style>
</head>
<body>
<div class="login-box">
  <h1>WebScope</h1>
  <p>Enter your access token to continue</p>
  <input type="password" id="token-input" placeholder="Access token" autofocus>
  <button id="login-btn">Login</button>
  <div class="error" id="error-msg">Invalid token</div>
</div>
<script>
  document.getElementById('login-btn').addEventListener('click', login);
  document.getElementById('token-input').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  async function login() {
    const token = document.getElementById('token-input').value;
    const btn = document.getElementById('login-btn');
    btn.disabled = true; btn.textContent = 'Checking...';
    try {
      const res = await fetch('/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      if (res.ok) {
        localStorage.setItem('downdash_token', token);
        window.location.href = '/';
      } else {
        document.getElementById('error-msg').style.display = 'block';
      }
    } catch (e) {
      document.getElementById('error-msg').style.display = 'block';
    }
    btn.disabled = false; btn.textContent = 'Login';
  }
  if (localStorage.getItem('downdash_token')) {
    (async () => {
      const tok = localStorage.getItem('downdash_token');
      const res = await fetch('/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tok })
      });
      if (res.ok) window.location.href = '/';
      else localStorage.removeItem('downdash_token');
    })();
  }
</script>
</body>
</html>`;
}
