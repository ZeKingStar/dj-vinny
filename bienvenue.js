// Premier démarrage : page /bienvenue (mot de passe de l'hôte + Client ID Spotify) qui écrit le .env, puis rend la main à demarrer.js.
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const PAGE = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.ico"><title>Bienvenue dans DJ Vinny</title>
<style>
:root{--bg:#15102E;--card:#221A47;--chip:#2D2358;--line:#3A2F6B;--muted:#B3A9D9;--text:#FFF6E5;--mint:#38E1B0;--gold:#FFD23F}
*{box-sizing:border-box}
body{margin:0;font:16px/1.45 system-ui,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.wrap{max-width:560px;margin:0 auto;padding:32px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px;margin-top:16px}
h1{margin:0;font-size:40px;letter-spacing:-.02em}
h2{margin:0 0 10px;font-size:18px}
ol{margin:0 0 6px;padding-left:22px;color:var(--muted)} li{margin:6px 0} b{color:var(--text)}
a{color:var(--mint)}
label{display:block;font-weight:600;margin:14px 0 6px}
input{width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--chip);color:var(--text);font:inherit}
.row{display:flex;gap:8px} .row input{flex:1;font-family:Consolas,monospace}
button{padding:12px 18px;border:0;border-radius:10px;background:var(--gold);color:var(--bg);font:inherit;font-weight:700;cursor:pointer}
button.alt{background:var(--chip);color:var(--text);border:1px solid var(--line)}
button:disabled{opacity:.6;cursor:default}
#err{color:#ff8b8b;min-height:1.4em;margin:12px 0 0}
</style></head><body><div class="wrap">
<h1>DJ Vinny</h1>
<form id="f" class="card">
  <h2>1. Mot de passe de l’hôte</h2>
  <p style="margin:0;color:var(--muted)">Il protège votre tableau de bord. Les invités n’en ont pas besoin.</p>
  <label for="pw">Mot de passe</label>
  <input id="pw" type="password" autocomplete="new-password" autofocus>

  <h2 style="margin-top:26px">2. Votre application Spotify</h2>
  <ol>
    <li>Ouvrez <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> et créez une app (un compte Spotify Premium est requis).</li>
    <li>Dans <b>Redirect URI</b>, collez l’adresse ci-dessous, puis <b>Add</b> et <b>Save</b>.</li>
    <li>Cochez <b>Web Playback SDK</b>.</li>
    <li>Copiez le <b>Client ID</b> de l’app dans la case plus bas.</li>
  </ol>
  <div class="row"><input id="uri" readonly value="" aria-label="Redirect URI"><button type="button" class="alt" id="copy">Copier</button></div>
  <label for="cid">Client ID Spotify</label>
  <input id="cid" autocomplete="off" spellcheck="false" placeholder="32 caractères">

  <p id="err" role="alert"></p>
  <button id="go" style="width:100%">Commencer</button>
</form></div>
<script>
const uri = location.protocol + '//127.0.0.1:' + location.port + '/host';
document.getElementById('uri').value = uri;
document.getElementById('copy').onclick = async e => {
  try { await navigator.clipboard.writeText(uri); } catch { document.getElementById('uri').select(); document.execCommand('copy'); }
  e.target.textContent = 'Copié'; setTimeout(() => { e.target.textContent = 'Copier'; }, 1500);
};
const err = document.getElementById('err'), go = document.getElementById('go');
document.getElementById('f').onsubmit = async e => {
  e.preventDefault(); err.textContent = ''; go.disabled = true; go.textContent = 'Démarrage…';
  const r = await fetch('/bienvenue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw.value, clientId: cid.value.trim() }) });
  if (!r.ok) { err.textContent = (await r.json()).error; go.disabled = false; go.textContent = 'Commencer'; return; }
  for (;;) { // le tableau de bord prend la relève sur la même adresse
    await new Promise(ok => setTimeout(ok, 500));
    try { if ((await fetch('/api/config')).ok) break; } catch {}
  }
  location.href = '/host';
};
</script></body></html>`;

const verifier = ({ password, clientId }) => {
  if (typeof password !== 'string' || password.length < 6 || password.length > 64) return 'Le mot de passe doit avoir de 6 à 64 caractères.';
  if (/["\\\x00-\x1f]/.test(password)) return 'Le mot de passe ne peut pas contenir de guillemet, de barre oblique inverse ni de saut de ligne.';
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9]{20,64}$/.test(clientId)) return 'Le Client ID Spotify doit contenir de 20 à 64 lettres et chiffres, sans espace.';
  return '';
};

exports.configurer = (fichierEnv, port) => new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/bienvenue') {
      let corps = '';
      req.on('data', d => { corps += d; if (corps.length > 4096) req.destroy(); });
      req.on('end', () => {
        let b = {}; try { b = JSON.parse(corps); } catch {}
        const erreur = verifier(b);
        res.setHeader('Content-Type', 'application/json');
        if (erreur) { res.statusCode = 400; return res.end(JSON.stringify({ error: erreur })); }
        fs.writeFileSync(fichierEnv, [
          `HOST_PASSWORD="${b.password}"`,
          `SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}`,
          `SPOTIFY_CLIENT_ID=${b.clientId}`, '',
        ].join('\n'), { flag: 'wx' });
        res.end('{"ok":true}');
        // la page continue d'interroger /api/config : on libère le port, puis server.js le reprend
        setTimeout(() => { server.close(() => resolve()); server.closeAllConnections(); }, 300);
      });
    } else if (req.url === '/favicon.ico') {
      res.setHeader('Content-Type', 'image/x-icon'); fs.createReadStream(require('path').join(__dirname, 'public', 'favicon.ico')).pipe(res);
    } else if (req.url === '/bienvenue' || req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(PAGE);
    } else { res.statusCode = 302; res.setHeader('Location', '/bienvenue'); res.end(); }
  });
  server.on('error', reject);
  server.listen(port, '127.0.0.1', () => console.log(`Premier démarrage : http://127.0.0.1:${port}/bienvenue`));
});
