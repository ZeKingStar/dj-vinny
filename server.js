const express = require('express');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');

// Démarrage seulement (.env) : mot de passe, port, secret de session, clés Apple. Le reste se règle dans l'app (⚙ Réglages) et passe avant le .env.
const {
  PORT = 3000, HOST_PASSWORD, SESSION_SECRET, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY_PATH,
} = process.env;
const SETTING_DEFS = { // clé : [étiquette, type, défaut, aide, validation]
  MUSIC_PROVIDER: ['Source musicale', 'select:spotify,apple', 'spotify', 'Spotify (Premium) ou Apple Music. Recharge la page après un changement.', v => ['spotify', 'apple'].includes(v)],
  SPOTIFY_CLIENT_ID: ['Spotify : Client ID', 'text', '', 'developer.spotify.com/dashboard. Le Redirect URI doit être l’adresse du dashboard (http://127.0.0.1:3000/host).', v => /^[A-Za-z0-9]{0,64}$/.test(v)],
  STOREFRONT: ['Pays du catalogue', 'text', 'fr', 'Code à 2 lettres : ca, fr, be…', v => /^[a-z]{2}$/i.test(v)],
  PUBLIC_URL: ['Adresse publique (QR des invités)', 'text', '', 'Vide = adresse du réseau local détectée. Sur le VPS : https://ton-domaine', v => v === '' || /^https?:\/\/[^\s]+$/.test(v)],
  MAX_PENDING_PER_GUEST: ['Demandes en attente par invité', 'number:1:20', '3', 'Nombre de demandes d’un même invité qui peuvent attendre dans la file.', v => /^\d+$/.test(v) && v >= 1 && v <= 20],
  REQ_PER_PERIOD: ['Demandes par invité et par période', 'number:1:50', '2', 'Limite par appareil d’invité (plus un plafond large par adresse IP, car les invités d’un même Wi-Fi partagent la leur), remise à zéro à chaque période.', v => /^\d+$/.test(v) && v >= 1 && v <= 50],
  OPENROUTER_API_KEY: ['Voix : clé OpenRouter', 'secret', '', 'openrouter.ai/settings/keys. Jamais réaffichée une fois enregistrée.', v => /^[\w.-]{10,200}$/.test(v)],
  TTS_MODEL: ['Voix : modèle', 'text', 'elevenlabs/eleven-v3', 'Ex. elevenlabs/eleven-v3 ou fish-audio/s2.1-pro-free (les annonces utilisent aussi announce.json).', v => /^[\w./:-]{1,80}$/.test(v)],
  VINNY_VOICE: ['Voix de Vinny', 'text', 'liam', 'Voix ElevenLabs de toutes les annonces et messages (ex. liam, george, sarah). Sans effet avec un serveur de voix local.', v => /^[\w -]{1,40}$/.test(v)],
  TTS_BASE_URL: ['Voix : serveur local (optionnel)', 'text', '', 'Ex. http://127.0.0.1:8020/v1 pour un serveur compatible OpenAI. Vide = OpenRouter.', v => v === '' || /^https?:\/\/[^\s]+$/.test(v)],
};
let overrides = {}, PUBLIC_URL, STOREFRONT, MAX_PENDING, PER_PERIOD, OPENROUTER_API_KEY, TTS_MODEL, TTS_VOICE, VINNY_VOICE, MUSIC_PROVIDER, SPOTIFY_CLIENT_ID, TTS_BASE_URL, TTS_LOCAL, TTS_BASE, TTS_ENABLED, SPOTIFY;
const settingSource = k => (overrides[k] ? 'app' : process.env[k] ? '.env' : 'défaut');
const settingValue = k => overrides[k] || process.env[k] || SETTING_DEFS[k][2];
function applySettings() {
  const g = settingValue;
  PUBLIC_URL = g('PUBLIC_URL').replace(/\/$/, ''); STOREFRONT = g('STOREFRONT').toLowerCase();
  MAX_PENDING = Number(g('MAX_PENDING_PER_GUEST')) || 3; PER_PERIOD = Math.max(1, Number(g('REQ_PER_PERIOD')) || 2);
  OPENROUTER_API_KEY = /^sk-[\w-]{16,}$/.test(g('OPENROUTER_API_KEY')) ? g('OPENROUTER_API_KEY') : ''; // le modèle « sk-or-... » de env.example n'est pas une clé : voix désactivée plutôt que des erreurs 401
  TTS_MODEL = g('TTS_MODEL'); TTS_VOICE = process.env.TTS_VOICE || 'george'; VINNY_VOICE = g('VINNY_VOICE'); // TTS_VOICE (.env) : seulement pour un serveur de voix local
  MUSIC_PROVIDER = g('MUSIC_PROVIDER'); SPOTIFY_CLIENT_ID = g('SPOTIFY_CLIENT_ID'); TTS_BASE_URL = g('TTS_BASE_URL');
  // Voix : OpenRouter par défaut ; TTS_BASE_URL pointe vers un serveur compatible OpenAI /v1/audio/speech
  TTS_LOCAL = !!TTS_BASE_URL;
  TTS_BASE = (TTS_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  TTS_ENABLED = TTS_LOCAL || !!OPENROUTER_API_KEY;
  SPOTIFY = MUSIC_PROVIDER === 'spotify';
}
// Adresses du PC sur le réseau local (sans les cartes VPN / WSL / virtuelles), pour le QR des invités
const lanUrls = () => Object.entries(os.networkInterfaces())
  .filter(([name]) => !/nord|vpn|wsl|vethernet|virtual|vmware|vbox|tailscale|tun|tap|loopback/i.test(name))
  .flatMap(([, list]) => list).filter(i => i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.)/.test(i.address))
  .map(i => `http://${i.address}:${PORT}`);
if (!HOST_PASSWORD) { console.error('HOST_PASSWORD manquant (.env)'); process.exit(1); }
const secret = SESSION_SECRET || HOST_PASSWORD;
if (!SESSION_SECRET) console.warn('Attention : SESSION_SECRET absent du .env (le mot de passe sert de secret). Définis une longue valeur aléatoire avant le déploiement.');

// ---------- État persistant ----------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data'); // DATA_DIR : dossier séparé pour les essais
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
try { overrides = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch {}
applySettings();
const defaults = () => ({
  queue: [], nowPlaying: null, history: [], pool: [], poolName: '',
  themes: [], activeThemeId: null, requestsOpen: true, lists: [], autoCount: 10,
  phases: [], activePhaseId: null, autoPhases: false, announce: true, ttsVoice: '', autoFx: true,
  linePool: [], lineEvery: 0, lastLineAt: 0, curated: {}, curatedOff: [], curatedOn: [], dinnerPool: [], trims: {}, gains: {}, endCut: 0, fade: 0, transSound: '', ratings: {}, wishes: [], calloutEvery: 10, songsSinceRequest: 0, lastCalloutAt: 0, learn: true, artistHeat: {}, eventToken: '', qrRev: 0, nowStartedAt: 0, periodReq: {},
});
let state = defaults();
try { state = { ...defaults(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}
// migration : les périodes n'ont plus de thème ; elles ont une couleur et une liste d'autopilote
for (const p of state.phases) {
  if (!p.color) { const th = p.themeId && state.themes.find(t => t.id === p.themeId); p.color = th && th.accent ? th.accent : (p.intensity === 'calm' ? '#FFD23F' : '#FF4F7B'); }
  if (!p.listId) p.listId = p.intensity === 'calm' ? 'builtin:souper' : 'builtin:dance';
  delete p.themeId;
}
state.activeThemeId = null;
state.nowPlaying = null; state.nowStartedAt = 0; // au démarrage du serveur rien ne joue : sinon « Démarrer la soirée » croit qu'un titre est déjà en cours
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  }, 300);
}

// Code de la soirée : inclus dans le QR, exigé pour chercher / demander / souhaiter. Se change d'un clic (dashboard) et survit aux redémarrages.
if (!state.eventToken) { state.eventToken = crypto.randomBytes(9).toString('base64url'); save(); }

// ---------- Journal de soirée : data/soirees/AAAA-MM-JJ.jsonl (une ligne par événement), pour analyser et s'améliorer ----------
// Rien de personnel : ni adresse IP, ni nom d'invité, ni image. Une « soirée » = la journée, coupée à 6 h du matin.
const LOG_DIR = path.join(DATA_DIR, 'soirees');
const logDay = () => { const d = new Date(Date.now() - 6 * 3600e3), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
function logEvent(type, data = {}) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const ph = state.phases.find(p => p.id === state.activePhaseId);
    fs.appendFileSync(path.join(LOG_DIR, logDay() + '.jsonl'), JSON.stringify({ t: new Date().toISOString(), type, phase: ph ? ph.name : null, ...data }) + '\n');
  } catch (e) { console.error('journal :', e.message); }
}

// ---------- SSE ----------
const clients = new Set();
const publicState = () => ({
  queue: state.queue, nowPlaying: state.nowPlaying, requestsOpen: state.requestsOpen,
  theme: (() => { const p = state.phases.find(x => x.id === state.activePhaseId); return p && p.color ? { accent: p.color } : null; })(),
  lists: listsView(), activeList: activeListInfo(), autoCount: state.autoCount,
  phases: state.phases, autoPhases: state.autoPhases,
  announce: state.announce, tts: TTS_ENABLED, autoFx: state.autoFx,
  provider: SPOTIFY ? 'spotify' : 'apple',
  phase: state.phases.find(p => p.id === state.activePhaseId) || null,
  pool: { name: state.poolName, count: state.pool.length },
  line: { count: state.linePool.length, every: state.lineEvery }, dinner: { count: state.dinnerPool.length },
  qrRev: state.qrRev, trims: state.trims, gains: state.gains, endCut: state.endCut, fade: state.fade, transSound: state.transSound, calloutEvery: state.calloutEvery, learn: state.learn,
});
function fx(type) { // animation ponctuelle poussée sur tous les écrans (invités + dashboard)
  const msg = `event: fx\ndata: ${JSON.stringify({ type })}\n\n`;
  for (const res of clients) res.write(msg);
}
let autoSig = '';
const builtinName = { 'builtin:dance': '40+ · Dance', 'builtin:souper': '40+ · Souper' };
const plainTrack = t => ({ songId: t.songId, title: t.title, artist: t.artist, artwork: t.artwork || '' });
function poolFor(id) {
  if (id === 'builtin:dance') return state.pool;
  if (id === 'builtin:souper') return state.dinnerPool;
  const l = state.lists.find(x => x.id === id);
  return l ? l.tracks.filter(t => !t.off).map(plainTrack) : [];
}
function activeListId() {
  const ph = state.phases.find(p => p.id === state.activePhaseId);
  return ph && ph.listId ? ph.listId : 'builtin:dance';
}
function activePool() { // liste de la période ; si elle est vide, on se rabat sur la liste dance puis sur le souper
  const src = poolFor(activeListId());
  return src.length ? src : (state.pool.length ? state.pool : state.dinnerPool);
}
function listsView() {
  return [
    { id: 'builtin:dance', name: builtinName['builtin:dance'], builtin: true, count: state.pool.length },
    { id: 'builtin:souper', name: builtinName['builtin:souper'], builtin: true, count: state.dinnerPool.length },
    ...state.lists.map(l => ({ id: l.id, name: l.name, builtin: false, count: l.tracks.filter(t => !t.off).length })),
  ];
}
function activeListInfo() {
  const id = activeListId(), l = listsView().find(x => x.id === id);
  return l ? { id: l.id, name: l.name, count: l.count } : { id, name: '?', count: 0 };
}
// File autopilote : autoCount titres « auto » toujours visibles dans la file (réordonnables, supprimables ; remplacés au besoin).
// Les demandes d'invités / de l'hôte passent devant. Les titres auto sont refaits si la liste de la période change.
function fillAuto() {
  const src = activePool(), sig = [activeListId(), src.length, src[0] && src[0].songId].join('|');
  if (sig !== autoSig) { autoSig = sig; state.queue = state.queue.filter(s => s.source !== 'auto'); }
  const want = Math.min(30, Math.max(1, state.autoCount || 10));
  let extra = state.queue.filter(s => s.source === 'auto').length - want; // X réduit : on retire les derniers titres auto
  for (let i = state.queue.length - 1; i >= 0 && extra > 0; i--) if (state.queue[i].source === 'auto') { state.queue.splice(i, 1); extra--; }
  if (!src.length) return;
  let guard = 0;
  while (state.queue.filter(s => s.source === 'auto').length < want && guard++ < 80) {
    const taken = new Set([...state.history, ...state.queue.map(s => s.songId), state.nowPlaying && state.nowPlaying.songId]);
    const fresh = src.filter(t => !taken.has(t.songId)), list = fresh.length ? fresh : src.filter(t => !state.queue.some(s => s.songId === t.songId));
    if (!list.length) break;
    state.queue.push({ uid: crypto.randomUUID(), ...weightedPick(list), source: 'auto' });
  }
}
function enqueue(song) { // après les demandes, avant les titres auto
  const i = state.queue.findIndex(s => s.source === 'auto');
  i < 0 ? state.queue.push(song) : state.queue.splice(i, 0, song);
}
function commit() {
  fillAuto();
  save();
  const msg = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

// ---------- Apple Music ----------
let cachedToken = null;
function devToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 3600e3) return cachedToken.token;
  if (!APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY_PATH) throw new Error('Clés Apple non configurées (.env)');
  const key = fs.readFileSync(APPLE_PRIVATE_KEY_PATH, 'utf8');
  const token = jwt.sign({}, key, {
    algorithm: 'ES256', expiresIn: '12h', issuer: APPLE_TEAM_ID, header: { alg: 'ES256', kid: APPLE_KEY_ID },
  });
  cachedToken = { token, exp: Date.now() + 12 * 3600e3 };
  return token;
}
async function appleGet(p) {
  const r = await fetch('https://api.music.apple.com' + p, { headers: { Authorization: 'Bearer ' + devToken() } });
  if (!r.ok) throw new Error('Apple API ' + r.status);
  return r.json();
}
const art = a => (a && a.url ? a.url.replace('{w}', 300).replace('{h}', 300) : '');
const toSong = (d, extra = {}) => ({
  uid: crypto.randomUUID(), songId: d.id, title: d.attributes.name,
  artist: d.attributes.artistName, artwork: art(d.attributes.artwork), ...extra,
});
const ID_RE = /^[\w.-]{1,64}$/;
const SONG_ID_RE = /^[A-Za-z0-9]{5,40}$/; // identifiant de titre Spotify (base 62) ou Apple (chiffres)

// Spotify : le token vient du navigateur de l'hôte (PKCE), le serveur n'a pas de secret.
let spotifyToken = null;
async function spotifyGet(p) {
  if (!spotifyToken) throw Object.assign(new Error('Spotify non connecté : l’hôte doit ouvrir le dashboard'), { code: 503 });
  const r = await fetch('https://api.spotify.com' + p, { headers: { Authorization: 'Bearer ' + spotifyToken } });
  if (r.status === 401) { spotifyToken = null; throw Object.assign(new Error('Session Spotify expirée'), { code: 503 }); }
  if (!r.ok) throw Object.assign(new Error('Spotify API ' + r.status), { code: r.status === 429 ? 429 : 502 });
  return r.json();
}
const fromSpotify = t => ({
  songId: t.id, title: t.name, artist: (t.artists || []).map(a => a.name).join(', '),
  artwork: ((t.album && t.album.images) || [])[1]?.url || ((t.album && t.album.images) || [])[0]?.url || '',
});
async function searchSongs(q) {
  if (SPOTIFY) {
    const r = await spotifyGet(`/v1/search?type=track&limit=10&market=${STOREFRONT.toUpperCase()}&q=${encodeURIComponent(q)}`);
    return ((r.tracks && r.tracks.items) || []).map(fromSpotify);
  }
  const r = await appleGet(`/v1/catalog/${STOREFRONT}/search?types=songs&limit=15&term=${encodeURIComponent(q)}`);
  return ((r.results.songs && r.results.songs.data) || []).map(d => ({ songId: d.id, title: d.attributes.name, artist: d.attributes.artistName, artwork: art(d.attributes.artwork) }));
}
async function lookupSong(songId, extra) {
  if (!SONG_ID_RE.test(songId)) throw Object.assign(new Error('ID invalide'), { code: 400 });
  if (SPOTIFY) {
    const t = await spotifyGet(`/v1/tracks/${songId}?market=${STOREFRONT.toUpperCase()}`);
    return { uid: crypto.randomUUID(), ...fromSpotify(t), ...extra };
  }
  const r = await appleGet(`/v1/catalog/${STOREFRONT}/songs/${songId}`);
  if (!r.data || !r.data[0]) throw Object.assign(new Error('Titre introuvable'), { code: 404 });
  return toSong(r.data[0], extra);
}

// ---------- Auth hôte ----------
const sign = () => crypto.createHmac('sha256', secret).update('host-session').digest('hex');
const safeEq = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const isHost = req => {
  const m = /(?:^|; )host=([^;]+)/.exec(req.headers.cookie || '');
  return !!m && safeEq(m[1], sign());
};
const requireHost = (req, res, next) => (isHost(req) ? next() : res.status(401).json({ error: 'Non autorisé' }));

// Limiteur simple en mémoire
const hits = new Map();
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.length || now - a[a.length - 1] > 15 * 60e3) hits.delete(k); }, 5 * 60e3).unref(); // évite que la table grossisse
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e =>
  res.status(e.code || 500).json({ error: e.message }));

// ---------- App ----------
const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', 1); // derrière Caddy/nginx : vraie IP des clients pour les limites
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(['/api/request', '/api/wish'], express.json({ limit: '8kb' })); // routes ouvertes aux invités : petits corps seulement
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/login', (req, res) => {
  if (limited('login:' + req.ip, 10, 15 * 60e3)) return res.status(429).json({ error: 'Trop d’essais' });
  if (!safeEq(req.body.password || '', HOST_PASSWORD)) return res.status(401).json({ error: 'Mot de passe incorrect' });
  const secure = req.secure || (PUBLIC_URL || '').startsWith('https') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `host=${sign()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure}`);
  res.json({ ok: true });
});
app.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'host=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/host', (req, res) =>
  isHost(req) ? res.sendFile(path.join(__dirname, 'views', 'host.html')) : res.redirect('/login.html'));

// Public
const eventOk = req => safeEq(req.get('x-event') || '', state.eventToken);
const loopback = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
// État et flux temps réel : l'hôte, ce PC (écran animé), ou un invité avec le code de la soirée (en-tête ou ?e=)
const viewerOk = req => isHost(req) || loopback(req) || eventOk(req) || safeEq(String(req.query.e || ''), state.eventToken);
const needEvent = req => { if (!eventOk(req)) throw Object.assign(new Error('Code de la soirée invalide : scanne à nouveau le QR'), { code: 403 }); };
app.get('/api/state', (req, res) => viewerOk(req) ? res.json(publicState()) : res.status(403).json({ error: 'Code de la soirée invalide' }));
const sseByIp = new Map();
const dashClients = new Set(); // dashboards hôte ouverts : seuls à recevoir les commandes de la télécommande
app.get('/api/events', (req, res) => {
  if (!viewerOk(req)) return res.status(403).end();
  if (clients.size >= 500 || (sseByIp.get(req.ip) || 0) >= 150) return res.status(429).end(); // 150 par IP : un même Wi-Fi de fête partage une adresse
  sseByIp.set(req.ip, (sseByIp.get(req.ip) || 0) + 1);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(`data: ${JSON.stringify(publicState())}\n\n`);
  clients.add(res);
  if (req.query.role === 'dash' && isHost(req)) dashClients.add(res);
  req.on('close', () => { clients.delete(res); dashClients.delete(res); const n = (sseByIp.get(req.ip) || 1) - 1; n ? sseByIp.set(req.ip, n) : sseByIp.delete(req.ip); });
});
app.get('/api/qr.png', requireHost, wrap(async (req, res) => { // le QR contient le code de la soirée : réservé à l'hôte
  res.set('Cache-Control', 'no-store');
  const base = (PUBLIC_URL || lanUrls()[0] || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const url = req.query.to === 'remote' ? base + '/remote' // la télécommande n'a pas de code : elle demande le mot de passe hôte
    : base + (req.query.to === 'souhaits' ? '/souhaits.html' : '/') + '?e=' + state.eventToken;
  res.type('png').send(await QRCode.toBuffer(url, { width: 600, margin: 2 }));
}));
const searchCache = new Map();
app.get('/api/search', wrap(async (req, res) => {
  if (!isHost(req)) { // les invités : code de la soirée + demandes ouvertes ; l'hôte (dashboard, télécommande) passe
    needEvent(req);
    if (!state.requestsOpen) throw Object.assign(new Error('Les demandes sont fermées'), { code: 403 });
  }
  if (limited('s:all', 150, 60e3)) throw Object.assign(new Error('Beaucoup de monde : réessaie dans un instant'), { code: 429 }); // protège le quota Spotify de l'hôte
  if (limited('s:' + req.ip, 40, 60e3)) throw Object.assign(new Error('Trop de recherches'), { code: 429 });
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q.length < 2) return res.json([]);
  const ck = norm(q), hit = searchCache.get(ck);
  if (hit && Date.now() - hit.t < 5 * 60e3) return res.json(hit.data);
  const data = await searchSongs(q);
  if (searchCache.size > 500) searchCache.clear();
  searchCache.set(ck, { t: Date.now(), data }); res.json(data);
}));
app.get('/api/config', (req, res) => res.json({ provider: SPOTIFY ? 'spotify' : 'apple', spotifyClientId: SPOTIFY_CLIENT_ID || '', storefront: STOREFRONT }));
app.post('/api/request', wrap(async (req, res) => {
  needEvent(req);
  // tentatives (réussies ou non) : protège le quota Spotify de l'hôte
  if (limited('ra:all', 100, 60e3) || limited('ra:' + req.ip, 200, 10 * 60e3)) throw Object.assign(new Error('Beaucoup de monde : réessaie dans un instant'), { code: 429 });
  const { songId, guestId } = req.body || {};
  if (!state.requestsOpen) throw Object.assign(new Error('Les demandes sont fermées'), { code: 403 });
  if (!ID_RE.test(String(guestId || ''))) throw Object.assign(new Error('Invité invalide'), { code: 400 });
  if (limited('r:' + guestId, 20, 10 * 60e3)) throw Object.assign(new Error('Doucement !'), { code: 429 });
  if (state.queue.filter(s => s.by === guestId).length >= MAX_PENDING)
    throw Object.assign(new Error(`Maximum ${MAX_PENDING} demandes en attente`), { code: 429 });
  if (state.queue.some(s => s.songId === songId && s.source !== 'auto') || (state.nowPlaying && state.nowPlaying.songId === songId))
    throw Object.assign(new Error('Déjà dans la file'), { code: 409 });
  // limite par appareil (guestId) ; plafond large par IP pour freiner les faux identifiants
  const pk = (state.activePhaseId || '-') + '|' + guestId, pkIp = (state.activePhaseId || '-') + '|ip|' + req.ip, ipMax = Math.max(40, PER_PERIOD * 25);
  if ((state.periodReq[pk] || 0) >= PER_PERIOD)
    throw Object.assign(new Error(`Limite atteinte : ${PER_PERIOD} demandes par période`), { code: 429 });
  if ((state.periodReq[pkIp] || 0) >= ipMax)
    throw Object.assign(new Error('Trop de demandes depuis ce réseau pour cette période'), { code: 429 });
  const byName = String(req.body.name || '').replace(/[^\p{L}\p{N} '-]/gu, '').trim().slice(0, 20);
  const song = await lookupSong(songId, { by: guestId, source: 'guest', byName });
  state.queue = state.queue.filter(s => s.songId !== song.songId); // un titre auto identique cède sa place à la demande
  enqueue(song); state.songsSinceRequest = 0; state.periodReq[pk] = (state.periodReq[pk] || 0) + 1; state.periodReq[pkIp] = (state.periodReq[pkIp] || 0) + 1;
  logEvent('request', { songId: song.songId, title: song.title, artist: song.artist, named: !!byName });
  const heat = norm(song.artist); state.artistHeat[heat] = (state.artistHeat[heat] || 0) + 1;
  commit(); res.json({ ok: true });
}));

// Hôte
// Apprentissage : l'autopilote tire plus souvent les titres qui ont fait danser et les artistes demandés par les invités
function weightOf(t) {
  const r = state.ratings[t.songId], net = r ? r.up - r.down : 0, heat = state.artistHeat[norm(t.artist)] || 0;
  return Math.min(4, Math.max(0.2, 1 + 0.6 * net + 0.4 * Math.min(heat, 5)));
}
function weightedPick(list) {
  if (!state.learn || list.length < 2) return list[Math.floor(Math.random() * list.length)];
  const w = list.map(weightOf);
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}
let calloutPending = false;
function pickLine() {
  if (!state.linePool.length) return null;
  const fresh = state.linePool.filter(t => !state.history.includes(t.songId));
  const list = fresh.length ? fresh : state.linePool;
  state.lastLineAt = Date.now();
  return { uid: crypto.randomUUID(), ...weightedPick(list), source: 'line' };
}
const TRANS_SOUNDS = ['', 'beats', 'beat_hiphop', 'beat_molly', 'beat_trill', 'beat_trap', 'beat_mustard', 'beat_astro']; // musique de transition (sounds/)
if (!TRANS_SOUNDS.includes(state.transSound)) state.transSound = ''; // ancien réglage (effets sonores) : retiré
let advanceWhy = 'end'; // comment le titre précédent s'est terminé : end | skip | camera (fourni par le dashboard)
function advance() {
  if (state.nowPlaying) { state.history.push(state.nowPlaying.songId); state.history = state.history.slice(-30); }
  // danse en ligne automatique : toutes les N minutes, avant la file (c'est un rendez-vous de la soirée)
  let next = null;
  if (state.lineEvery > 0 && state.lastLineAt && Date.now() - state.lastLineAt >= state.lineEvery * 60e3) next = pickLine();
  if (!state.lastLineAt) state.lastLineAt = Date.now();
  if (!next) next = state.queue.shift();
  // file vide : fillAuto() (réserve « souper » en période calme, sinon l'autopilote habituel) puis on reprend le premier
  if (!next) { fillAuto(); next = state.queue.shift(); }
  const prev = state.nowPlaying, why = advanceWhy; advanceWhy = 'end';
  state.nowPlaying = next || null;
  if (next) {
    const nowT = Date.now();
    logEvent('play', { songId: next.songId, title: next.title, artist: next.artist, source: next.source, prevElapsed: prev && state.nowStartedAt ? Math.round((nowT - state.nowStartedAt) / 1000) : null, prevEnd: prev ? why : null });
    state.nowStartedAt = nowT;
  } else if (prev) logEvent('stop', { elapsed: state.nowStartedAt ? Math.round((Date.now() - state.nowStartedAt) / 1000) : null });
  if (next) {
    state.songsSinceRequest = next.source === 'guest' ? 0 : state.songsSinceRequest + 1;
    // rappel : N titres sans demande, demandes ouvertes, pas plus d'une fois toutes les 20 minutes
    if (state.calloutEvery > 0 && state.requestsOpen && state.songsSinceRequest >= state.calloutEvery && Date.now() - state.lastCalloutAt >= 20 * 60e3) {
      state.songsSinceRequest = 0; state.lastCalloutAt = Date.now(); calloutPending = true;
    }
  }
  commit();
  if (state.autoFx && next && next.source === 'guest') fx('confetti');
  if (calloutPending) fx('callout'); // les écrans affichent le QR en grand
  return state.nowPlaying;
}
// ---------- Liste commentée (curated/soiree.json) : titres à chercher sur Spotify puis à valider ----------
const { norm, pickMatch, isBad } = require('./match');
const curatedFile = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'curated', 'soiree.json'), 'utf8'));
const entryKey = e => [e.group, norm(e.title), norm(e.artist)].join('|');
function curatedView() {
  const list = curatedFile();
  const entries = list.entries.map(e => {
    const key = entryKey(e), r = state.curated[key];
    // un titre « proposé » reste désactivé tant que l'hôte ne l'a pas validé (curatedOn)
    const off = e.propose ? !state.curatedOn.includes(key) : state.curatedOff.includes(key);
    return { key, ...e, status: r ? r.status : 'pending', found: r && r.songId ? r.title + ' — ' + r.artist : '', off };
  });
  const counts = { ok: 0, uncertain: 0, missing: 0, pending: 0 };
  entries.forEach(e => counts[e.status]++);
  return { name: list.name, entries, counts };
}
function rebuildPools() {
  const v = curatedView(), usable = e => e.status !== 'pending' && e.status !== 'missing' && !e.off;
  const track = e => { const r = state.curated[e.key]; return { songId: r.songId, title: r.title, artist: r.artist, artwork: r.artwork }; };
  const uniq = a => { const seen = new Set(); return a.filter(t => !seen.has(t.songId) && seen.add(t.songId)); };
  state.pool = uniq(v.entries.filter(e => e.group === 'dance' && usable(e)).map(track));
  state.linePool = uniq(v.entries.filter(e => e.group === 'ligne' && usable(e)).map(track));
  state.dinnerPool = uniq(v.entries.filter(e => e.group === 'souper' && usable(e)).map(track));
}
rebuildPools();
app.get('/api/curated', requireHost, (req, res) => res.json(curatedView()));
app.post('/api/curated/resolve', requireHost, wrap(async (req, res) => {
  for (const e of curatedFile().entries) {
    const key = entryKey(e), prev = state.curated[key];
    if (prev && prev.status !== 'missing' && !(prev.status === 'ok' && isBad(prev.title, prev.artist, '', e.cover ? 'cover' : e.remix ? 'remix' : null))) continue;
    const r = await spotifyGet(`/v1/search?type=track&limit=10&market=${STOREFRONT.toUpperCase()}&q=${encodeURIComponent(e.title + ' ' + e.artist)}`);
    const m = pickMatch(e, (r.tracks && r.tracks.items) || []);
    state.curated[key] = m.c ? { ...fromSpotify(m.c), status: m.status } : { status: 'missing' };
    await new Promise(ok => setTimeout(ok, 120));
  }
  rebuildPools(); commit(); res.json(curatedView());
}));
app.post('/api/curated/toggle', requireHost, (req, res) => {
  const k = String(req.body.key || '');
  const e = curatedFile().entries.find(x => entryKey(x) === k), flip = (a) => (a.includes(k) ? a.filter(x => x !== k) : [...a, k]);
  if (e && e.propose) state.curatedOn = flip(state.curatedOn); else state.curatedOff = flip(state.curatedOff);
  rebuildPools(); commit(); res.json(curatedView());
});
app.post('/api/curated/validate', requireHost, (req, res) => { // valide d'un coup les titres « proposé » dont la recherche Spotify est sûre (statut ok)
  const g = ['dance', 'ligne', 'souper'].includes(req.body.group) ? req.body.group : null;
  let n = 0;
  for (const e of curatedView().entries) if (e.propose && e.status === 'ok' && (!g || e.group === g) && !state.curatedOn.includes(e.key)) { state.curatedOn.push(e.key); n++; }
  rebuildPools(); commit(); res.json({ validated: n, ...curatedView() });
});
app.post('/api/curated/use', requireHost, (req, res) => { // conservé pour compatibilité : les réserves se recalculent déjà seules
  rebuildPools(); state.lastLineAt = Date.now(); commit();
  res.json({ dance: state.pool.length, line: state.linePool.length, dinner: state.dinnerPool.length });
});
// Listes de l'autopilote : les deux listes intégrées (40+) et les playlists Spotify importées (copiées dans l'app)
app.get('/api/lists', requireHost, (req, res) => res.json(listsView()));
app.get('/api/lists/:id', requireHost, (req, res) => {
  const l = state.lists.find(x => x.id === req.params.id);
  l ? res.json({ id: l.id, name: l.name, tracks: l.tracks }) : res.status(404).json({ error: 'Liste introuvable' });
});
app.post('/api/lists/import', requireHost, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const tracks = (Array.isArray(req.body.tracks) ? req.body.tracks : []).filter(t => t && ID_RE.test(String(t.songId)))
    .map(t => ({ songId: String(t.songId), title: String(t.title || '').slice(0, 200), artist: String(t.artist || '').slice(0, 200), artwork: String(t.artwork || '').slice(0, 300) })).slice(0, 600);
  if (!name || !tracks.length) return res.status(400).json({ error: 'Nom et titres requis (la playlist est peut-être vide ou illisible)' });
  state.lists.push({ id: crypto.randomUUID(), name, tracks });
  commit(); res.json({ ok: true, count: tracks.length });
});
app.post('/api/lists/:id/toggle', requireHost, (req, res) => {
  const l = state.lists.find(x => x.id === req.params.id), t = l && l.tracks.find(x => x.songId === req.body.songId);
  if (!t) return res.status(404).json({ error: 'Titre introuvable' });
  t.off = !t.off; if (!t.off) delete t.off;
  commit(); res.json({ id: l.id, name: l.name, tracks: l.tracks });
});
app.post('/api/lists/:id/add', requireHost, wrap(async (req, res) => {
  const l = state.lists.find(x => x.id === req.params.id);
  if (!l) throw Object.assign(new Error('Liste introuvable'), { code: 404 });
  const song = await lookupSong(req.body.songId, {});
  if (!l.tracks.some(t => t.songId === song.songId)) l.tracks.push(plainTrack(song));
  commit(); res.json({ id: l.id, name: l.name, tracks: l.tracks });
}));
app.delete('/api/lists/:id', requireHost, (req, res) => {
  state.lists = state.lists.filter(x => x.id !== req.params.id);
  for (const p of state.phases) if (p.listId === req.params.id) p.listId = p.intensity === 'calm' ? 'builtin:souper' : 'builtin:dance';
  commit(); res.json({ ok: true });
});
// Repères par titre (secondes) : début utile et fin anticipée, mémorisés pour les prochaines lectures
app.post('/api/trim', requireHost, (req, res) => {
  const { songId, start, end, clear } = req.body;
  if (!ID_RE.test(String(songId || ''))) return res.status(400).json({ error: 'Titre invalide' });
  if (clear) delete state.trims[songId];
  else {
    const t = state.trims[songId] || {}, ok = n => typeof n === 'number' && n >= 0 && n <= 900;
    if (ok(start)) t.start = Math.round(start * 10) / 10;
    if (ok(end)) t.end = Math.round(end * 10) / 10;
    state.trims[songId] = t;
  }
  commit(); res.json({ ok: true });
});
// ---------- Mémoire des soirées : « ça danse » / « ça vide la piste » ----------
app.post('/api/rate', requireHost, (req, res) => {
  const n = state.nowPlaying, vote = Number(req.body.vote);
  if (!n || n.songId !== req.body.songId || ![1, -1].includes(vote)) return res.status(400).json({ error: 'Rien à noter' });
  const r = state.ratings[n.songId] || (state.ratings[n.songId] = { title: n.title, artist: n.artist, up: 0, down: 0 });
  vote > 0 ? r.up++ : r.down++; r.last = Date.now();
  logEvent('rate', { songId: n.songId, title: n.title, vote, elapsed: state.nowStartedAt ? Math.round((Date.now() - state.nowStartedAt) / 1000) : null });
  commit(); res.json({ ok: true, ...r });
});
app.get('/api/ratings', requireHost, (req, res) =>
  res.json(Object.entries(state.ratings).map(([songId, r]) => ({ songId, ...r })).sort((a, b) => (b.up - b.down) - (a.up - a.down))));

// ---------- Souhaits d'avant la soirée (page publique /souhaits.html, texte libre : fonctionne sans Spotify) ----------
app.post('/api/wish', wrap(async (req, res) => {
  needEvent(req);
  const text = String(req.body.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const name = String(req.body.name || '').replace(/[^\p{L}\p{N} '-]/gu, '').trim().slice(0, 20);
  const by = String(req.body.guestId || '');
  if (text.length < 3 || !ID_RE.test(by)) throw Object.assign(new Error('Souhait invalide'), { code: 400 });
  if (limited('w:' + req.ip, 30, 10 * 60e3)) throw Object.assign(new Error('Doucement !'), { code: 429 });
  if (state.wishes.filter(w => w.by === by).length >= 3) throw Object.assign(new Error('3 chansons maximum par personne'), { code: 429 });
  if (state.wishes.length >= 400) throw Object.assign(new Error('Liste de souhaits pleine'), { code: 429 });
  state.wishes.push({ id: crypto.randomUUID(), text, name, by, at: Date.now() });
  save(); res.json({ ok: true });
}));
app.get('/api/wishes', requireHost, (req, res) => {
  const groups = new Map();
  for (const w of state.wishes) {
    const k = norm(w.text), g = groups.get(k) || { text: w.text, count: 0, names: [] };
    g.count++; if (w.name && !g.names.includes(w.name)) g.names.push(w.name); groups.set(k, g);
  }
  res.json({ total: state.wishes.length, groups: [...groups.values()].sort((a, b) => b.count - a.count) });
});
app.post('/api/wishes/clear', requireHost, (req, res) => { state.wishes = []; save(); res.json({ ok: true }); });
app.post('/api/linedance', requireHost, (req, res) => {
  const t = pickLine();
  if (!t) return res.status(400).json({ error: 'Aucune danse en ligne : utilisez d’abord la liste commentée' });
  state.queue.unshift(t); commit(); res.json({ ok: true });
});

app.post('/api/spotify/token', requireHost, (req, res) => {
  if (typeof req.body.token !== 'string' || req.body.token.length > 600) return res.status(400).json({ error: 'Token invalide' });
  spotifyToken = req.body.token; res.json({ ok: true });
});
app.get('/api/dev-token', requireHost, wrap(async (req, res) => res.json({ token: devToken(), storefront: STOREFRONT })));
app.post('/api/next', requireHost, (req, res) => {
  advanceWhy = ['skip', 'camera', 'start'].includes(req.body && req.body.why) ? req.body.why : 'end';
  const nowPlaying = advance(), callout = calloutPending; calloutPending = false;
  res.json({ nowPlaying, callout });
});
app.post('/api/queue/add', requireHost, wrap(async (req, res) => {
  const song = await lookupSong(req.body.songId, { by: 'host', source: 'host' });
  state.queue = state.queue.filter(s => s.songId !== song.songId || s.source !== 'auto');
  req.body.top ? state.queue.unshift(song) : enqueue(song);
  commit(); res.json({ ok: true });
}));
app.post('/api/queue/reorder', requireHost, (req, res) => {
  const order = Array.isArray(req.body.uids) ? req.body.uids : [];
  const byUid = new Map(state.queue.map(s => [s.uid, s]));
  const sorted = order.map(u => byUid.get(u)).filter(Boolean);
  const rest = state.queue.filter(s => !order.includes(s.uid));
  state.queue = [...sorted, ...rest];
  commit(); res.json({ ok: true });
});
app.delete('/api/queue/:uid', requireHost, (req, res) => {
  state.queue = state.queue.filter(s => s.uid !== req.params.uid);
  commit(); res.json({ ok: true });
});
// Volume par titre : « Trop fort » / « Trop faible » ajuste de 1,5 dB (de -12 à +3 dB : le volume de base est à 70 %, donc +3 dB atteint le maximum), retenu pour les prochaines lectures
app.post('/api/gain', requireHost, (req, res) => {
  const id = String(req.body.songId || '');
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'Titre invalide' });
  if (req.body.reset) delete state.gains[id];
  else {
    const step = Number(req.body.step);
    if (![-1, 1].includes(step)) return res.status(400).json({ error: 'Réglage invalide' });
    const g = Math.max(-12, Math.min(3, Math.round(((state.gains[id] || 0) + step * 1.5) * 10) / 10));
    g ? (state.gains[id] = g) : delete state.gains[id];
  }
  logEvent('gain', { songId: id, gain: state.gains[id] || 0, title: state.nowPlaying && state.nowPlaying.songId === id ? state.nowPlaying.title : undefined });
  commit(); res.json({ gain: state.gains[id] || 0 });
});
app.post('/api/clientlog', requireHost, (req, res) => { // incidents de lecture vus par le dashboard (titre qui ne démarre pas, fin non détectée…), pour comprendre après coup
  if (limited('clog', 60, 60e3)) return res.status(429).json({ error: 'Trop d’événements' });
  logEvent('client', { kind: String(req.body.kind || '').slice(0, 40), detail: String(req.body.detail || '').slice(0, 200), songId: state.nowPlaying ? state.nowPlaying.songId : null });
  res.json({ ok: true });
});
app.post('/api/motion', requireHost, (req, res) => { // mesure de mouvement (nombre seulement) envoyée par le dashboard quand la caméra est active
  const lvl = Number(req.body.level), avg = Number(req.body.avg90);
  if (!Number.isFinite(lvl) || !Number.isFinite(avg)) return res.status(400).json({ error: 'Mesure invalide' });
  const n = state.nowPlaying;
  logEvent('motion', { level: Math.round(lvl * 10) / 10, avg90: Math.round(avg * 10) / 10, songId: n ? n.songId : null, elapsed: n && state.nowStartedAt ? Math.round((Date.now() - state.nowStartedAt) / 1000) : null });
  res.json({ ok: true });
});
app.get('/api/soirees', requireHost, (req, res) => res.json(fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl')).sort().reverse().map(f => f.slice(0, -6)) : []));
app.get('/api/soirees/:day', requireHost, (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(req.params.day) ? req.params.day : logDay(), f = path.join(LOG_DIR, day + '.jsonl');
  fs.existsSync(f) ? res.download(f) : res.status(404).json({ error: 'Pas de journal pour ce jour' });
});
function settingsView() {
  return Object.entries(SETTING_DEFS).map(([key, [label, type, def, help]]) => ({
    key, label, type, help, def, source: settingSource(key),
    ...(type === 'secret' ? { set: key === 'OPENROUTER_API_KEY' ? !!OPENROUTER_API_KEY : !!settingValue(key) } : { value: settingValue(key) }),
  }));
}
app.get('/api/app-settings', requireHost, (req, res) => res.json(settingsView()));
app.post('/api/app-settings', requireHost, (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  for (const [k, v] of Object.entries(body)) {
    const d = SETTING_DEFS[k];
    if (!d) return res.status(400).json({ error: 'Réglage inconnu : ' + k });
    if (v === null || v === '') { delete overrides[k]; continue; } // retour à la valeur du .env ou par défaut
    const val = String(v).trim();
    if (!d[4](val)) return res.status(400).json({ error: 'Valeur invalide : ' + d[0] });
    overrides[k] = val;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(overrides, null, 1));
  applySettings(); commit(); res.json(settingsView());
});
app.get('/api/links', requireHost, (req, res) => { // liens à partager (contiennent le code de la soirée)
  const b = (PUBLIC_URL || lanUrls()[0] || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res.json({ guests: `${b}/?e=${state.eventToken}`, wishes: `${b}/souhaits.html?e=${state.eventToken}`, remote: `${b}/remote`, public: !!PUBLIC_URL && !/^https?:\/\/(10\.|192\.168\.|127\.|localhost)/.test(PUBLIC_URL) });
});
app.get('/remote', (req, res) =>
  isHost(req) ? res.sendFile(path.join(__dirname, 'views', 'remote.html')) : res.redirect('/login.html?next=/remote'));
const REMOTE_JINGLES = ['fanfare', 'carillon', 'riser', 'ding', 'scratch', 'cornet', 'ovation', 'applause', 'roulement', 'klaxon', 'rewind'];
let dashStatus = { t: 0, started: false, ready: false, active: false }; // état rapporté par le dashboard ouvert sur l'ordinateur
app.post('/api/remote/ack', requireHost, (req, res) => {
  const b = req.body || {};
  dashStatus = { t: Date.now(), started: !!b.started, ready: !!b.ready, active: !!b.active };
  res.json({ ok: true });
});
app.get('/api/remote/status', requireHost, (req, res) => {
  const fresh = dashClients.size > 0 && Date.now() - dashStatus.t < 20000;
  res.json({ dashboard: dashClients.size > 0, started: fresh && dashStatus.started, ready: fresh && dashStatus.ready, active: fresh && dashStatus.active });
});
app.post('/api/remote', requireHost, (req, res) => {
  if (limited('remote', 90, 60e3)) return res.status(429).json({ error: 'Doucement !' });
  const b = req.body || {};
  let msg;
  if (b.cmd === 'next' || b.cmd === 'pause' || b.cmd === 'callout' || b.cmd === 'start') msg = { cmd: b.cmd };
  else if (b.cmd === 'say') {
    const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (text.length < 2) return res.status(400).json({ error: 'Message vide' });
    msg = { cmd: 'say', text };
  } else if (b.cmd === 'jingle' && REMOTE_JINGLES.includes(b.name)) msg = { cmd: 'jingle', name: b.name };
  else if (b.cmd === 'phase' && state.phases.some(p => p.id === b.id)) msg = { cmd: 'phase', id: b.id };
  else return res.status(400).json({ error: 'Commande inconnue' });
  if (!dashClients.size) return res.status(409).json({ error: 'Le dashboard n’est pas ouvert sur l’ordinateur' });
  for (const r of dashClients) r.write('event: cmd\ndata: ' + JSON.stringify(msg) + '\n\n');
  res.json({ ok: true });
});
app.post('/api/event/rotate', requireHost, (req, res) => { // nouveau code : les anciens QR cessent de fonctionner
  state.eventToken = crypto.randomBytes(9).toString('base64url'); state.qrRev++;
  commit(); res.json({ ok: true });
});
app.post('/api/fx', requireHost, (req, res) => {
  if (!['confetti', 'party', 'callout'].includes(req.body.type)) return res.status(400).json({ error: 'Type inconnu' });
  fx(req.body.type); res.json({ ok: true });
});
app.post('/api/queue/clear', requireHost, (req, res) => { state.queue = []; commit(); res.json({ ok: true }); });
app.post('/api/settings', requireHost, (req, res) => {
  if (typeof req.body.requestsOpen === 'boolean') state.requestsOpen = req.body.requestsOpen;
  if (typeof req.body.autoPhases === 'boolean') state.autoPhases = req.body.autoPhases;
  if (typeof req.body.announce === 'boolean') state.announce = req.body.announce;
  if (typeof req.body.autoFx === 'boolean') state.autoFx = req.body.autoFx;
  if (Number.isInteger(req.body.calloutEvery) && req.body.calloutEvery >= 0 && req.body.calloutEvery <= 40) state.calloutEvery = req.body.calloutEvery;
  if (typeof req.body.learn === 'boolean') state.learn = req.body.learn;
  if ([0, 1.5, 2, 3].includes(req.body.fade)) state.fade = req.body.fade;
  if (typeof req.body.transSound === 'string' && TRANS_SOUNDS.includes(req.body.transSound)) state.transSound = req.body.transSound;
  if (Number.isInteger(req.body.endCut) && req.body.endCut >= 0 && req.body.endCut <= 30) state.endCut = req.body.endCut;
  if (Number.isInteger(req.body.lineEvery) && req.body.lineEvery >= 0 && req.body.lineEvery <= 180) { state.lineEvery = req.body.lineEvery; state.lastLineAt = Date.now(); }
  if (Number.isInteger(req.body.autoCount) && req.body.autoCount >= 1 && req.body.autoCount <= 30) state.autoCount = req.body.autoCount;
  commit(); res.json({ ok: true });
});
// Périodes (ex. Souper 19:00 -> Soirée dansante 22:00) : type, couleur, liste de l'autopilote, phrase de Vinny au début.
// Le navigateur de l'hôte les déclenche à l'heure.
const validList = id => id === 'builtin:dance' || id === 'builtin:souper' || state.lists.some(l => l.id === id);
function phaseFields(b, p) {
  if (typeof b.name === 'string' && b.name.trim()) p.name = b.name.trim().slice(0, 40);
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start || '')) p.start = b.start;
  if (b.intensity === 'party' || b.intensity === 'calm') p.intensity = b.intensity;
  if (typeof b.requestsOpen === 'boolean') p.requestsOpen = b.requestsOpen;
  if (typeof b.jingle === 'string') p.jingle = b.jingle.slice(0, 300);
  if (/^#[0-9a-f]{6}$/i.test(b.color || '')) p.color = b.color;
  if (typeof b.listId === 'string' && validList(b.listId)) p.listId = b.listId;
}
app.post('/api/phases', requireHost, (req, res) => {
  const b = req.body || {};
  if (!b.name || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start || '')) return res.status(400).json({ error: 'Nom et heure (HH:MM) requis' });
  const calm = b.intensity !== 'party';
  const p = { id: crypto.randomUUID(), name: '', start: b.start, intensity: calm ? 'calm' : 'party', requestsOpen: true, jingle: '', color: calm ? '#FFD23F' : '#FF4F7B', listId: calm ? 'builtin:souper' : 'builtin:dance' };
  phaseFields(b, p);
  state.phases.push(p); state.phases.sort((a, c) => a.start.localeCompare(c.start));
  commit(); res.json({ ok: true, id: p.id });
});
app.put('/api/phases/:id', requireHost, (req, res) => {
  const p = state.phases.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Période introuvable' });
  phaseFields(req.body || {}, p); state.phases.sort((a, c) => a.start.localeCompare(c.start));
  if (p.id === state.activePhaseId && typeof req.body.requestsOpen === 'boolean') state.requestsOpen = p.requestsOpen;
  commit(); res.json({ ok: true });
});
app.delete('/api/phases/:id', requireHost, (req, res) => {
  state.phases = state.phases.filter(p => p.id !== req.params.id);
  if (state.activePhaseId === req.params.id) state.activePhaseId = null;
  commit(); res.json({ ok: true });
});
app.post('/api/phases/:id/activate', requireHost, (req, res) => {
  const p = state.phases.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Période introuvable' });
  state.activePhaseId = p.id; state.requestsOpen = p.requestsOpen; state.periodReq = {}; logEvent('phase', { name: p.name, intensity: p.intensity }); // nouvelle période : les compteurs par IP repartent à zéro
  commit();
  if (state.autoFx && p.intensity === 'party') fx('party');
  res.json({ ok: true, jingle: p.jingle || '', intensity: p.intensity, color: p.color, listId: p.listId });
});

// ---------- Voix & jingles (ElevenLabs via OpenRouter) ----------
const TTS_DIR = path.join(DATA_DIR, 'tts');
const sha = parts => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 24);

// Synthèse d'un morceau de texte, avec cache disque : un même texte n'est facturé qu'une fois.
// o : model, voice, prev/next (contexte de prosodie ElevenLabs), voiceSettings
async function synth(text, o = {}) {
  if (!TTS_ENABLED) throw Object.assign(new Error('Voix non configurée (OPENROUTER_API_KEY ou TTS_BASE_URL)'), { code: 400 });
  const model = TTS_LOCAL ? TTS_MODEL : (o.model || TTS_MODEL);
  const voice = TTS_LOCAL ? TTS_VOICE : VINNY_VOICE;
  const el = TTS_LOCAL ? {} : { language_code: 'fr' }; // force le français (sinon « François » peut être lu à l'anglaise)
  if (o.prev) el.previous_text = o.prev;
  if (o.next) el.next_text = o.next;
  if (o.voiceSettings) el.voice_settings = o.voiceSettings;
  const provider = !TTS_LOCAL && Object.keys(el).length ? { options: { elevenlabs: el } } : null;
  const hash = sha([TTS_BASE, model, voice, text, JSON.stringify(provider)]);
  const file = path.join(TTS_DIR, hash + '.mp3');
  if (!fs.existsSync(file)) {
    const headers = { 'Content-Type': 'application/json' };
    if (!TTS_LOCAL) headers.Authorization = 'Bearer ' + OPENROUTER_API_KEY;
    const body = { model, input: text, voice, response_format: 'mp3' };
    if (TTS_LOCAL) body.language = 'fr';
    if (provider) body.provider = provider;
    let r;
    try { r = await fetch(TTS_BASE + '/audio/speech', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }); }
    catch { throw new Error('Serveur de voix injoignable (' + TTS_BASE + ')'); }
    if (!r.ok) throw new Error('TTS ' + r.status);
    fs.mkdirSync(TTS_DIR, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  return { hash, file };
}
app.post('/api/tts', requireHost, wrap(async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 300);
  if (!text) throw Object.assign(new Error('Texte vide'), { code: 400 });
  if (limited('tts', 30, 60e3)) throw Object.assign(new Error('Trop de synthèses vocales'), { code: 429 });
  res.json({ url: `/api/tts/${(await synth(text)).hash}.mp3` });
}));

// Annonce d'une demande spéciale : UNE seule génération (phrase complète tirée au hasard dans announce.json,
// avec {name} {title} {artist}), puis traitement ffmpeg (vitesse, compression, reverb léger).
// Les textes et les réglages se modifient dans announce.json, sans redémarrer.
const pick = a => a[Math.floor(Math.random() * a.length)];
const cleanTitle = s => String(s || '').replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '').replace(/\s-\s.*$/, '').replace(/\s+/g, ' ').trim().slice(0, 80);
const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const REVERB = [0.32, 0.28, 0.24, 0.2, 0.15, 0.1]; // décroissances de base, multipliées par "reverb"
app.post('/api/announce', requireHost, wrap(async (req, res) => {
  if (limited('ann', 30, 60e3)) throw Object.assign(new Error('Trop d’annonces'), { code: 429 });
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'announce.json'), 'utf8'));
  const phase = state.phases.find(p => p.id === state.activePhaseId);
  const c = cfg[phase && phase.intensity === 'calm' ? 'calm' : 'party'];
  const title = cleanTitle(req.body.title), artist = cleanTitle(req.body.artist);
  const isCallout = req.body.source === 'callout', moment = ['open', 'close'].includes(req.body.source) ? req.body.source : null;
  if (!title && !isCallout && !moment) throw Object.assign(new Error('Titre manquant'), { code: 400 });
  const name = String(req.body.name || '').replace(/[^\p{L}\p{N} '-]/gu, '').trim().slice(0, 20);
  // prénom -> « demande spéciale de X » ; demande sans prénom -> « en demande spéciale » ; autre titre -> annonce simple
  const tpls = moment && c[moment] ? c[moment] : isCallout ? (c.callout || ['Une demande spéciale ? Scannez le code QR.']) : req.body.source === 'line' && c.line ? c.line : name ? c.named : req.body.source === 'guest' ? c.anon : c.plain;
  const text = fill(pick(tpls), { title, artist, name });
  console.log('Annonce :', text);
  const { file } = await synth(text, { model: cfg.model, voice: c.voice || cfg.voice, voiceSettings: c.voiceSettings || null });

  const key = sha([file, c.tempo, c.reverb, c.ratio, c.presence, c.lufs]);
  const out = path.join(TTS_DIR, key + '.mp3');
  if (!fs.existsSync(out)) {
    const decays = REVERB.map(d => (d * c.reverb).toFixed(3)).join('|');
    const af = [`atempo=${c.tempo}`, 'highpass=f=160', 'lowpass=f=8000', `equalizer=f=3500:t=q:w=1.1:g=${c.presence}`, 'equalizer=f=200:t=q:w=1:g=2',
      `acompressor=threshold=-24dB:ratio=${c.ratio}:attack=3:release=60:makeup=6`, `aecho=0.85:0.9:19|37|53|79|109|151:${decays}`, `loudnorm=I=${c.lufs}:TP=-1.5`].join(',');
    try {
      await new Promise((ok, ko) => require('child_process').execFile('ffmpeg',
        ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-af', af, '-ar', '44100', '-b:a', '160k', out], { maxBuffer: 1e7, timeout: 15000 }, e => (e ? ko(e) : ok())));
    } catch (e) { // ffmpeg absent : on joue la voix telle quelle, sans traitement
      console.warn('ffmpeg indisponible, annonce non traitée :', e.message);
      fs.copyFileSync(file, out);
    }
  }
  res.json({ url: `/api/tts/${key}.mp3`, text });
}));
// Sons enregistrés : réservés à l'hôte (ne pas servir les fichiers aux invités)
app.get('/sounds/:name', requireHost, (req, res) => {
  if (!/^[\w.-]+\.(mp3|json)$/.test(req.params.name)) return res.sendStatus(404);
  res.sendFile(path.join(__dirname, 'sounds', req.params.name), err => err && !res.headersSent && res.sendStatus(404));
});
app.get('/api/tts/:name', requireHost, (req, res) => {
  if (!/^[a-f0-9]{24}\.mp3$/.test(req.params.name)) return res.sendStatus(404);
  res.sendFile(path.join(TTS_DIR, req.params.name), err => err && !res.headersSent && res.sendStatus(404));
});
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.type === 'entity.parse.failed' ? 'JSON invalide' : 'Erreur serveur' }));

const BIND = process.env.BIND || undefined; // BIND=127.0.0.1 : seulement ce PC et le tunnel (rien d'autre sur le réseau local)
app.listen(PORT, BIND, () => {
  console.log(`DJ Vinny : dashboard http://127.0.0.1:${PORT}/host`);
  if (BIND) console.log(`Écoute limitée à ${BIND} (BIND) : les appareils du réseau local ne peuvent pas joindre ce serveur directement.`);
  const lan = lanUrls(), pub = PUBLIC_URL || lan[0] || '(aucune adresse trouvée)';
  console.log('Adresse des invités (QR) :', pub);
  // PUBLIC_URL qui est une adresse IP locale absente du PC : le QR ne marchera pas (erreur de saisie fréquente)
  const m = /^https?:\/\/(\d+\.\d+\.\d+\.\d+)/.exec(PUBLIC_URL || '');
  if (m && !Object.values(os.networkInterfaces()).flat().some(i => i.address === m[1]))
    console.warn(`⚠ PUBLIC_URL (${PUBLIC_URL}) ne correspond à aucune adresse de ce PC. Adresses possibles : ${lan.join(' ') || 'aucune'}`);
});
