const express = require('express');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

// Démarrage seulement (.env) : mot de passe, port, secret de session. Le reste se règle dans l'app (⚙ Réglages) et passe avant le .env.
const {
  PORT = 3000, HOST_PASSWORD, SESSION_SECRET,
} = process.env;
const SETTING_DEFS = { // clé : [type, défaut, validation] ; étiquette et aide : locales/<langue>.json (set.CLÉ, set.CLÉ.help)
  SPOTIFY_CLIENT_ID: ['text', '', v => /^[A-Za-z0-9]{0,64}$/.test(v)],
  SPOTIFY_GARDER: ['select:non,oui', 'non', v => v === 'non' || v === 'oui'],
  MAX_PENDING_PER_GUEST: ['number:1:20', '3', v => /^\d+$/.test(v) && v >= 1 && v <= 20],
  REQ_PER_PERIOD: ['number:1:50', '2', v => /^\d+$/.test(v) && v >= 1 && v <= 50],
  LOCK_MINUTES: ['number:0:240', '0', v => /^\d+$/.test(v) && v <= 240],
  LICENCE_KEY: ['secret', '', v => /^djv_[a-f0-9]{48}$/.test(v)],
  CONVEX_URL: ['text', '', v => v === '' || /^https?:\/\/[^\s]+$/.test(v)],
  REMOTE_PIN: ['text', '', v => /^\d{4,8}$/.test(v)], // code simple de la télécommande : ouvre seulement /remote
  HOST_PASSWORD: ['text', '', v => v.length >= 6 && v.length <= 64], // visible ici (page réservée à l'hôte) ; passe avant le .env
};
const MARKET = 'CA'; // catalogue Spotify : Canada
let overrides = {}, MAX_PENDING, PER_PERIOD, LOCK_MIN, SPOTIFY_CLIENT_ID, TTS_LIVE, LICENCE_KEY, CONVEX_URL;
const settingSource = k => (overrides[k] ? 'app' : process.env[k] ? 'env' : 'default');
const CONVEX_DEFAUT = 'https://shocking-marten-220.convex.site'; // service de Pop & Show : le client colle seulement sa clé de licence
const settingValue = k => overrides[k] || process.env[k] || SETTING_DEFS[k][1];
const hostPw = () => settingValue('HOST_PASSWORD');
const remotePin = () => settingValue('REMOTE_PIN');
function applySettings() {
  const g = settingValue;
  MAX_PENDING = Number(g('MAX_PENDING_PER_GUEST')) || 3; PER_PERIOD = Math.max(1, Number(g('REQ_PER_PERIOD')) || 2); LOCK_MIN = Math.min(240, Number(g('LOCK_MINUTES')) || 0);
  SPOTIFY_CLIENT_ID = g('SPOTIFY_CLIENT_ID');
  // Version gratuite : clips prégénérés (voix/). Voix en direct (Felix) : passe payante, via Convex.
  LICENCE_KEY = g('LICENCE_KEY'); CONVEX_URL = (g('CONVEX_URL') || CONVEX_DEFAUT).replace(/\/$/, '');
  TTS_LIVE = !!(LICENCE_KEY && CONVEX_URL);
}
// Adresses du PC sur le réseau local (sans les cartes VPN / WSL / virtuelles), pour le QR des invités
const lanUrls = () => Object.entries(os.networkInterfaces())
  .filter(([name]) => !/nord|vpn|wsl|vethernet|virtual|vmware|vbox|tailscale|tun|tap|loopback/i.test(name))
  .flatMap(([, list]) => list).filter(i => i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.)/.test(i.address))
  .map(i => `http://${i.address}:${PORT}`);
if (!HOST_PASSWORD) { console.error('HOST_PASSWORD manquant (.env)'); process.exit(1); }
const secret = SESSION_SECRET || HOST_PASSWORD;
if (!SESSION_SECRET) console.warn('Attention : SESSION_SECRET absent du .env (le mot de passe sert de secret). Définis une longue valeur aléatoire avant le déploiement.');

// ---------- Langues : locales/<langue>.json (interface et erreurs) et announce/<langue>.json (Vinny) ----------
// Les invités voient la langue de l'événement (ev.lang, fr par défaut) ; l'hôte, celle de son navigateur. Les pages envoient leur langue dans l'en-tête x-lang.
const LANGS = ['fr', 'en'];
const LOCALES = Object.fromEntries(LANGS.map(l => [l, JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', l + '.json'), 'utf8'))]));
const okLang = l => (LANGS.includes(l) ? l : 'fr');
const tr = (lang, key, v = {}) => String(LOCALES[okLang(lang)][key] ?? LOCALES.fr[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const announceCfg = lang => JSON.parse(fs.readFileSync(path.join(__dirname, 'announce', okLang(lang) + '.json'), 'utf8')); // relu à chaque fois : se modifie sans redémarrer
const reqLang = req => okLang(req.get('x-lang'));
const E = (key, code, vars) => Object.assign(new Error(key), { key, code, vars }); // erreur traduite à l'envoi (clés err.*)
const fail = (req, res, code, key, vars) => res.status(code).json({ error: tr(reqLang(req), key, vars) });

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
  linePool: [], lineEvery: 0, lastLineAt: 0, curated: {}, curatedOff: [], curatedOn: [], dinnerPool: [], trims: {}, gains: {}, endCut: 0, fade: 0, transSound: '', ratings: {}, wishes: [], calloutEvery: 10, songsSinceRequest: 0, lastCalloutAt: 0, learn: true, playedLog: [], artistHeat: {}, eventToken: '', qrRev: 0, nowStartedAt: 0, periodReq: {}, events: [], activeEventId: null,
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

// ---------- Événements (soirées datées) ----------
// Un événement = nom, date, heures, lieu, messages, code propre et programme (périodes). Un seul est « actif » : ses périodes sont les périodes
// en direct et son code est le code de la soirée. Sans événement, l'app fonctionne comme avant (code unique).
let presetJob = null, presetError = null; // liste toute faite en cours de préparation / dernière erreur
const prep = { running: false }; // préparation automatique des listes (recherche Spotify)
const OLD_FLOOR_JINGLE = '[excited] Mesdames et messieurs, la piste de danse est ouverte ! Allez, la gang, tout le monde sur la piste !';
const PH_BASE = {
  calm: { start: '19:00', color: '#FFD23F', requestsOpen: false, listId: 'builtin:souper' },
  party: { start: '22:00', color: '#FF4F7B', requestsOpen: true, listId: 'builtin:dance', openAt: 0, openFade: 10 },
};
const phDefaults = (kind, lang) => ({ ...PH_BASE[kind], ...announceCfg(lang).phases[kind] }); // nom et phrase de Vinny : announce/<langue>.json
const newPhase = (kind, lang = 'fr') => ({ id: crypto.randomUUID(), intensity: kind, ...phDefaults(kind, lang) });
// changement de langue d'un événement : les noms et phrases par défaut suivent ; ceux que l'hôte a écrits restent
function relang(phases, from, to) {
  if (okLang(from) === okLang(to)) return;
  for (const p of phases || []) {
    const a = phDefaults(p.intensity, from), b = phDefaults(p.intensity, to);
    if (p.name === a.name) p.name = b.name;
    if (p.jingle === a.jingle) p.jingle = b.jingle;
  }
}
if (!state.phases.length) { state.phases = [newPhase('calm'), newPhase('party')]; save(); } // toujours de quoi passer de Souper à Soirée, sans horaire à créer
// ancienne phrase par défaut de la Soirée : remplacée par l'annonce complète (piste ouverte, demandes, on change vite si ça vide la piste)
for (const p of [...state.phases, ...state.events.flatMap(e => e.phases || [])]) if (p.jingle === OLD_FLOOR_JINGLE) p.jingle = phDefaults('party', 'fr').jingle;
const clonePhases = a => (a || []).map(p => ({ ...p }));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function evTimes(ev) {
  const start = new Date(ev.date + 'T' + ev.start + ':00').getTime();
  let end = new Date(ev.date + 'T' + ev.end + ':00').getTime();
  if (!(end > start)) end += 24 * 3600e3; // finit après minuit
  return { start, end };
}
// upcoming | live | ended. « Démarrer maintenant » (startedAt) et « Terminer » (endedAt) passent avant l'horloge.
function eventStatus(ev, now = Date.now()) {
  if (ev.endedAt) return 'ended';
  const { start, end } = evTimes(ev);
  if (ev.startedAt) return now < end + 6 * 3600e3 ? 'live' : 'ended';
  if (now >= end) return 'ended';
  return now >= start - (ev.openBeforeMin || 0) * 60e3 ? 'live' : 'upcoming';
}
const activeEvent = () => state.events.find(e => e.id === state.activeEventId) || null;
const evLang = () => okLang((activeEvent() || {}).lang); // langue de la salle : celle de l'événement actif
const eventByToken = t => state.events.find(e => safeEq(String(t || ''), e.token)) || null;
const tokenFor = req => { const e = state.events.find(x => x.id === req.query.ev); return e ? e.token : state.eventToken; };
const publicEvent = e => ({ id: e.id, lang: okLang(e.lang), name: e.name, date: e.date, start: e.start, end: e.end, place: e.place || '', welcome: e.welcome || '', thanks: e.thanks || '', status: eventStatus(e) });
// Demandes et recherches des invités : seulement pendant que l'événement actif est en cours (sans événement actif : comme avant)
const needLive = () => {
  const e = activeEvent(); if (!e) return;
  const s = eventStatus(e);
  if (s !== 'live') throw E(s === 'ended' ? 'err.notLiveEnded' : 'err.notLiveYet', 403);
};


// ---------- Journal de soirée : data/soirees/AAAA-MM-JJ.jsonl (une ligne par événement), pour analyser et s'améliorer ----------
// Rien de personnel : ni adresse IP, ni nom d'invité, ni image. Une « soirée » = la journée, coupée à 6 h du matin.
const LOG_DIR = path.join(DATA_DIR, 'soirees');
const logDay = () => { const d = new Date(Date.now() - 6 * 3600e3), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
function logEvent(type, data = {}) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const ph = state.phases.find(p => p.id === state.activePhaseId);
    fs.appendFileSync(path.join(LOG_DIR, logDay() + '.jsonl'), JSON.stringify({ t: new Date().toISOString(), type, phase: ph ? ph.name : null, ...(activeEvent() ? { event: activeEvent().name } : {}), ...data }) + '\n');
  } catch (e) { console.error('journal :', e.message); }
}

// ---------- SSE ----------
const clients = new Set();
const publicState = () => ({
  queue: state.queue, nowPlaying: state.nowPlaying, requestsOpen: state.requestsOpen,
  theme: (() => { const p = state.phases.find(x => x.id === state.activePhaseId); return p && p.color ? { accent: p.color } : null; })(),
  lists: listsView(), activeList: activeListInfo(), autoCount: state.autoCount,
  phases: state.phases, autoPhases: state.autoPhases,
  lockMin: LOCK_MIN, announce: state.announce, tts: TTS_LIVE || hasClips(), ttsLive: TTS_LIVE, autoFx: state.autoFx,
  phase: state.phases.find(p => p.id === state.activePhaseId) || null,
  pool: { name: state.poolName, count: state.pool.length },
  line: { count: state.linePool.length, every: state.lineEvery }, dinner: { count: state.dinnerPool.length },
  event: (() => { const e = activeEvent(); return e ? publicEvent(e) : null; })(), prepare: presetJob ? { label: presetJob.name, done: presetJob.done, total: presetJob.total } : prep.running ? { label: '', done: 0, total: 0 } : false, prepareError: presetError,
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
// Demandes d'invités : ordre d'arrivée, mais jamais deux de la même personne de suite. Une demande bloquée cède sa place au premier titre suivant
// (autre demande ou titre auto) ; les titres de l'hôte et de la danse en ligne ne sont pas touchés. Idempotent : refait à chaque commit().
// Doublons : un titre déjà en cours / dans la file / joué ce soir (12 h). L'hôte (dashboard, télécommande) peut passer outre avec force.
function dupOf(songId) {
  if (state.nowPlaying && state.nowPlaying.songId === songId) return { kind: 'now' };
  if (state.queue.some(s => s.songId === songId && s.source !== 'auto')) return { kind: 'queue' };
  const p = (state.playedLog || []).findLast(x => x.id === songId && Date.now() - x.t < 12 * 3600e3);
  return p ? { kind: 'played', min: Math.max(1, Math.round((Date.now() - p.t) / 60000)) } : null;
}
function enqueueLater(song, n) { // titre déjà joué que l'invité veut quand même : dans n titres
  fillAuto(); song.again = true; state.queue.splice(Math.min(n, state.queue.length), 0, song);
}
function spaceRequests() {
  const rest = state.queue.slice(), out = [];
  let last = state.nowPlaying && state.nowPlaying.source === 'guest' ? state.nowPlaying.by : null, lastId = state.nowPlaying && state.nowPlaying.songId;
  while (rest.length) {
    let i = rest.findIndex(s => !(s.source === 'guest' && s.by === last) && (s.forced || s.songId !== lastId)); // jamais le même titre deux fois de suite (sauf ajout forcé par l'hôte)
    if (i < 0) i = 0; // il ne reste que des demandes de la même personne : on ne bloque pas la musique
    const [s] = rest.splice(i, 1); out.push(s);
    last = s.source === 'guest' ? s.by : null; lastId = s.songId;
  }
  state.queue = out;
}
function commit() {
  fillAuto(); spaceRequests();
  const ae = activeEvent(); if (ae) ae.phases = clonePhases(state.phases); // le programme de l'événement actif suit les périodes en direct
  save();
  const msg = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

const ID_RE = /^[\w.-]{1,64}$/;
const SONG_ID_RE = /^[A-Za-z0-9]{5,40}$/; // identifiant de titre Spotify (base 62)

// Spotify : le token vient du navigateur de l'hôte (PKCE), le serveur n'a pas de secret.
let spotifyToken = null;
async function spotifyGet(p) {
  if (!spotifyToken) throw E('err.spotifyOff', 503);
  const r = await fetch('https://api.spotify.com' + p, { headers: { Authorization: 'Bearer ' + spotifyToken } });
  if (r.status === 401) { spotifyToken = null; throw E('err.spotifyExpired', 503); }
  if (!r.ok) throw Object.assign(new Error('Spotify API ' + r.status), { code: r.status === 429 ? 429 : 502 });
  return r.json();
}
const fromSpotify = t => ({
  songId: t.id, title: t.name, artist: (t.artists || []).map(a => a.name).join(', '),
  artwork: ((t.album && t.album.images) || [])[1]?.url || ((t.album && t.album.images) || [])[0]?.url || '',
});
async function searchSongs(q) {
  const r = await spotifyGet(`/v1/search?type=track&limit=10&market=${MARKET}&q=${encodeURIComponent(q)}`);
  return ((r.tracks && r.tracks.items) || []).map(fromSpotify);
}
async function lookupSong(songId, extra) {
  if (!SONG_ID_RE.test(songId)) throw E('err.badId', 400);
  const t = await spotifyGet(`/v1/tracks/${songId}?market=${MARKET}`);
  return { uid: crypto.randomUUID(), ...fromSpotify(t), ...extra };
}

// ---------- Auth hôte ----------
const sign = () => crypto.createHmac('sha256', secret).update('host-session:' + (state.sessionRev || 0)).digest('hex'); // sessionRev change = tous les appareils déconnectés
const safeEq = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const isHost = req => {
  const m = /(?:^|; )host=([^;]+)/.exec(req.headers.cookie || '');
  return !!m && safeEq(m[1], sign());
};
// Télécommande : un code simple (REMOTE_PIN) donne un cookie limité aux routes de /remote ; le mot de passe hôte ouvre tout
const signRemote = () => crypto.createHmac('sha256', secret).update('remote-session:' + (state.sessionRev || 0) + ':' + remotePin()).digest('hex');
const isRemote = req => {
  const m = /(?:^|; )remote=([^;]+)/.exec(req.headers.cookie || '');
  return !!remotePin() && !!m && safeEq(m[1], signRemote());
};
const canRemote = req => isHost(req) || isRemote(req);
const REMOTE_ROUTES = [['GET', /^\/api\/remote\/status$/], ['POST', /^\/api\/(remote|rate|linedance|queue\/add|queue\/reorder|gain|fx|settings)$/], ['DELETE', /^\/api\/queue\/[\w-]+$/]];
const remoteAllowed = req => REMOTE_ROUTES.some(([m, re]) => m === req.method && re.test(req.path));
const requireHost = (req, res, next) => (isHost(req) || (remoteAllowed(req) && isRemote(req)) ? next() : fail(req, res, 401, 'err.unauthorized'));

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
  res.status(e.code || 500).json({ error: e.key ? tr(reqLang(req), e.key, e.vars) : e.message, ...(e.extra || {}) }));

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
// Textes de l'interface (les deux langues) + t() : chargé en <script> avant le code des pages, donc disponible tout de suite.
// ?p=guest : seulement les textes des pages invités (g.*, c.*) pour les téléphones. Les erreurs (err.*) restent au serveur.
app.get('/i18n.js', (req, res) => {
  const keep = req.query.p === 'guest' ? k => /^(g|c)\./.test(k) : k => !k.startsWith('err.');
  const pick = o => Object.fromEntries(Object.entries(o).filter(([k]) => keep(k)));
  res.set('Cache-Control', 'no-cache').type('js').send('window.I18N = ' + JSON.stringify(Object.fromEntries(LANGS.map(l => [l, pick(LOCALES[l])]))) + ';\n'
    + fs.readFileSync(path.join(__dirname, 'locales', 'i18n.js'), 'utf8'));
});
app.use(express.static(path.join(__dirname, 'public')));

app.post('/login', (req, res) => {
  if (limited('login:' + req.ip, 10, 15 * 60e3)) return fail(req, res, 429, 'err.tooManyTries');
  const pw = req.body.password || '', secure = req.secure ? '; Secure' : '';
  if (safeEq(pw, hostPw())) {
    res.setHeader('Set-Cookie', `host=${sign()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure}`);
    return res.json({ ok: true, role: 'host' });
  }
  if (remotePin() && !limited('login-remote', 30, 15 * 60e3) && safeEq(pw, remotePin())) {
    res.setHeader('Set-Cookie', `remote=${signRemote()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure}`);
    return res.json({ ok: true, role: 'remote' });
  }
  fail(req, res, 401, 'err.badPassword');
});
// Déverrouillage du dashboard : revérifie le mot de passe de l'hôte (ne change pas la session)
app.post('/api/verify', requireHost, (req, res) => {
  if (limited('verify:' + req.ip, 10, 15 * 60e3)) return fail(req, res, 429, 'err.tooManyTries');
  if (!safeEq(String(req.body.password || ''), hostPw())) return fail(req, res, 401, 'err.badPassword');
  res.json({ ok: true });
});
app.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', ['host=; HttpOnly; Path=/; Max-Age=0', 'remote=; HttpOnly; Path=/; Max-Age=0']);
  res.json({ ok: true });
});
// Déconnexion de tous les appareils : change la révision de session (les cookies déjà émis cessent de valoir), y compris celui-ci
app.post('/logout/all', requireHost, (req, res) => {
  state.sessionRev = (state.sessionRev || 0) + 1; save();
  console.log('Déconnexion de tous les appareils.');
  for (const r of dashClients) { try { r.end(); } catch {} } dashClients.clear();
  res.setHeader('Set-Cookie', ['host=; HttpOnly; Path=/; Max-Age=0', 'remote=; HttpOnly; Path=/; Max-Age=0']);
  res.json({ ok: true });
});
app.get('/host', (req, res) =>
  isHost(req) ? res.sendFile(path.join(__dirname, 'views', 'host.html')) : res.redirect('/login.html'));

// Public
// code « actif » : celui de la soirée en cours (ou le code unique sans événement). Le code d'un autre événement n'ouvre que sa fiche et ses souhaits.
const isActiveToken = t => { const e = eventByToken(t); return safeEq(String(t || ''), state.eventToken) && (!e || e.id === state.activeEventId); };
const eventOk = req => isActiveToken(req.get('x-event') || '');
const loopback = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
// État et flux temps réel : l'hôte, ce PC (écran animé), ou un invité avec le code de la soirée (en-tête ou ?e=)
const viewerOk = req => canRemote(req) || loopback(req) || eventOk(req) || isActiveToken(req.query.e);
const needEvent = req => { if (!eventOk(req)) throw E('err.badCode', 403); };
app.get('/api/state', (req, res) => {
  if (viewerOk(req)) return res.json(publicState());
  const ev = eventByToken(req.get('x-event') || req.query.e || '');
  if (ev) return res.json({ guestMode: eventStatus(ev), event: publicEvent(ev) });
  fail(req, res, 403, 'err.badCodeShort');
});
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
  const base = guestBase(req);
  const url = req.query.to === 'remote' ? base + '/remote' // la télécommande n'a pas de code de soirée : elle demande son code simple ou le mot de passe hôte
    : base + (req.query.to === 'souhaits' ? '/souhaits.html' : '/') + '?e=' + tokenFor(req);
  res.type('png').send(await QRCode.toBuffer(url, { width: 600, margin: 2 }));
}));
const searchCache = new Map();
app.get('/api/search', wrap(async (req, res) => {
  if (!canRemote(req)) { // les invités : code de la soirée + demandes ouvertes ; l'hôte (dashboard, télécommande) passe
    needEvent(req); needLive();
    if (!state.requestsOpen) throw E('err.closed', 403);
  }
  if (limited('s:all', 150, 60e3)) throw E('err.busy', 429); // protège le quota Spotify de l'hôte
  if (limited('s:' + req.ip, 40, 60e3)) throw E('err.tooManySearches', 429);
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q.length < 2) return res.json([]);
  const ck = norm(q), hit = searchCache.get(ck);
  if (hit && Date.now() - hit.t < 5 * 60e3) return res.json(hit.data);
  const data = await searchSongs(q);
  if (searchCache.size > 500) searchCache.clear();
  searchCache.set(ck, { t: Date.now(), data }); res.json(data);
}));
const spotifyKeep = () => settingValue('SPOTIFY_GARDER') === 'oui';
app.get('/api/config', (req, res) => res.json({ spotifyClientId: SPOTIFY_CLIENT_ID || '', spotifyKeep: spotifyKeep() }));
app.post('/api/request', wrap(async (req, res) => {
  needEvent(req); needLive();
  // tentatives (réussies ou non) : protège le quota Spotify de l'hôte
  if (limited('ra:all', 100, 60e3) || limited('ra:' + req.ip, 200, 10 * 60e3)) throw E('err.busy', 429);
  const { songId, guestId } = req.body || {};
  if (!state.requestsOpen) throw E('err.closed', 403);
  if (!ID_RE.test(String(guestId || ''))) throw E('err.badGuest', 400);
  if (limited('r:' + guestId, 20, 10 * 60e3)) throw E('err.slowDown', 429);
  if (state.queue.filter(s => s.by === guestId).length >= MAX_PENDING)
    throw E('err.maxPending', 429, { n: MAX_PENDING });
  const dup = dupOf(songId), again = !!(req.body && req.body.again);
  if (dup && dup.kind !== 'played') throw E('err.inQueue', 409);
  if (dup && !again) throw Object.assign(E('err.played', 409, { n: dup.min }), { extra: { played: true } }); // le client demande : « la jouer quand même, dans 5 titres ? »
  // limite par appareil (guestId) ; plafond large par IP pour freiner les faux identifiants
  const pk = (state.activePhaseId || '-') + '|' + guestId, pkIp = (state.activePhaseId || '-') + '|ip|' + req.ip, ipMax = Math.max(40, PER_PERIOD * 25);
  if ((state.periodReq[pk] || 0) >= PER_PERIOD)
    throw E('err.periodLimit', 429, { n: PER_PERIOD });
  if ((state.periodReq[pkIp] || 0) >= ipMax)
    throw E('err.networkLimit', 429);
  const byName = String(req.body.name || '').replace(/[^\p{L}\p{N} '-]/gu, '').trim().slice(0, 20);
  const song = await lookupSong(songId, { by: guestId, source: 'guest', byName });
  state.queue = state.queue.filter(s => s.songId !== song.songId); // un titre auto identique cède sa place à la demande
  dup ? enqueueLater(song, 5) : enqueue(song); state.songsSinceRequest = 0; state.periodReq[pk] = (state.periodReq[pk] || 0) + 1; state.periodReq[pkIp] = (state.periodReq[pkIp] || 0) + 1;
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
let advanceWhy = 'end'; // comment le titre précédent s'est terminé : end | skip (fourni par le dashboard)
function advance() {
  if (state.nowPlaying) { (state.playedLog = state.playedLog || []).push({ id: state.nowPlaying.songId, t: state.nowStartedAt || Date.now() }); state.playedLog = state.playedLog.slice(-600); }
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
// Cherche un titre sur Spotify et choisit la meilleure correspondance ; 429 / erreur serveur : jusqu'à 3 essais
async function spotifyMatch(e) {
  for (let n = 1; ; n++) {
    try {
      const r = await spotifyGet(`/v1/search?type=track&limit=10&market=${MARKET}&q=${encodeURIComponent(e.title + ' ' + e.artist)}`);
      return pickMatch(e, (r.tracks && r.tracks.items) || []);
    } catch (err) { if (n >= 3 || err.key || !err.code) throw err; await new Promise(ok => setTimeout(ok, 2000 * n)); }
  }
}
async function resolveCurated() {
  for (const e of curatedFile().entries) {
    const key = entryKey(e), prev = state.curated[key];
    if (prev && prev.status !== 'missing' && !(prev.status === 'ok' && isBad(prev.title, prev.artist, '', e.cover ? 'cover' : e.remix ? 'remix' : null))) continue;
    const m = await spotifyMatch(e);
    state.curated[key] = m.c ? { ...fromSpotify(m.c), status: m.status } : { status: 'missing' };
    await new Promise(ok => setTimeout(ok, 120));
  }
  rebuildPools();
}
// titre « proposé » trouvé sûrement (statut ok), ni activé ni retiré par l'hôte (un titre retiré avec ✕ est noté dans curatedOff et reste retiré)
const safeToValidate = (e, g) => e.propose && e.status === 'ok' && (!g || e.group === g) && !state.curatedOn.includes(e.key) && !state.curatedOff.includes(e.key);
function validateSafe(g) { // active les titres sûrs d'un groupe ou de tous
  let n = 0;
  for (const e of curatedView().entries) if (safeToValidate(e, g)) { state.curatedOn.push(e.key); n++; }
  rebuildPools(); return n;
}
// Rien à valider à la main : dès que Spotify est connecté, on cherche les titres pas encore cherchés, puis on active tous les titres sûrs.
// Les titres incertains (?) attendent l'hôte, et ceux qu'il a retirés ne reviennent pas.
async function autoPrepare() {
  if (prep.running) return;
  const v = curatedView(), pending = v.entries.some(e => e.status === 'pending');
  if (!pending && !v.entries.some(e => safeToValidate(e))) return;
  prep.running = true; commit();
  try {
    if (pending) await resolveCurated();
    const n = validateSafe();
    if (n) console.log('Titres sûrs activés automatiquement :', n);
  } catch (e) { console.error('préparation des listes :', e.message); }
  finally { prep.running = false; commit(); }
}
// Chanson d'ouverture par défaut de la Soirée : Levels (Avicii), version radio de préférence. Cherchée sur Spotify une seule fois par période
// dansante sans chanson choisie (openDefaulted : si l'hôte la retire ensuite, on ne la remet pas).
const DEFAULT_OPENER = [{ title: 'Levels Radio Edit', artist: 'Avicii', q: 'Levels Radio Edit Avicii' }, { title: 'Levels', artist: 'Avicii', q: 'Levels Avicii' }];
const needsOpener = () => [...state.phases, ...state.events.flatMap(e => e.phases || [])].filter(p => p.intensity === 'party' && !p.open && !p.openDefaulted);
async function ensureDefaultOpener() {
  if (!spotifyToken || !needsOpener().length) return;
  let found = null;
  for (const e of DEFAULT_OPENER) {
    const r = await spotifyGet(`/v1/search?type=track&limit=10&market=${MARKET}&q=${encodeURIComponent(e.q)}`);
    const m = pickMatch(e, (r.tracks && r.tracks.items) || []);
    if (m.status === 'ok') { found = fromSpotify(m.c); break; }
  }
  if (!found) return console.warn('Chanson d’ouverture par défaut introuvable sur Spotify (Levels, Avicii)');
  for (const p of needsOpener()) { p.open = found; p.openDefaulted = true; if (p.openAt == null) p.openAt = 0; if (!p.openFade) p.openFade = 10; }
  console.log('Chanson d’ouverture par défaut :', found.title, '—', found.artist);
  commit();
}
app.post('/api/curated/resolve', requireHost, wrap(async (req, res) => {
  await resolveCurated(); commit(); res.json(curatedView());
}));
app.post('/api/curated/toggle', requireHost, (req, res) => {
  const k = String(req.body.key || '');
  const e = curatedFile().entries.find(x => entryKey(x) === k), flip = (a) => (a.includes(k) ? a.filter(x => x !== k) : [...a, k]);
  if (e && e.propose) { // « proposé » : retiré -> noté dans curatedOff pour que la validation automatique ne le remette pas
    const on = !state.curatedOn.includes(k);
    state.curatedOn = on ? [...state.curatedOn, k] : state.curatedOn.filter(x => x !== k);
    state.curatedOff = on ? state.curatedOff.filter(x => x !== k) : [...new Set([...state.curatedOff, k])];
  } else state.curatedOff = flip(state.curatedOff);
  rebuildPools(); commit(); res.json(curatedView());
});
app.post('/api/curated/validate', requireHost, (req, res) => { // valide d'un coup les titres « proposé » dont la recherche Spotify est sûre (statut ok)
  const n = validateSafe(['dance', 'ligne', 'souper'].includes(req.body.group) ? req.body.group : null);
  commit(); res.json({ validated: n, ...curatedView() });
});
app.post('/api/curated/use', requireHost, (req, res) => { // conservé pour compatibilité : les réserves se recalculent déjà seules
  rebuildPools(); state.lastLineAt = Date.now(); commit();
  res.json({ dance: state.pool.length, line: state.linePool.length, dinner: state.dinnerPool.length });
});
// Listes de l'autopilote : les deux listes intégrées (40+) et les playlists Spotify importées (copiées dans l'app)
app.get('/api/lists', requireHost, (req, res) => res.json(listsView()));
// Listes toutes faites (curated/listes.json) : titres cherchés sur Spotify, gardés seulement quand la recherche est sûre, puis copiés comme liste de l'app.
// Une liste à la fois (file d'attente) ; les titres déjà trouvés sont gardés en mémoire si une erreur interrompt la recherche (on reprend où on s'était arrêté).
let presetCache; const presetFile = () => presetCache || (presetCache = JSON.parse(fs.readFileSync(path.join(__dirname, 'curated', 'listes.json'), 'utf8')));
const presetQueue = [], presetFound = new Map();
const presetTaken = slug => presetJob && presetJob.slug === slug || presetQueue.some(q => q.slug === slug) || state.lists.some(l => l.preset === slug);
app.get('/api/presets', requireHost, (req, res) => res.json(presetFile().filter(p => !presetTaken(p.slug)).map(p => ({ slug: p.slug, name: p.name, group: p.group, count: p.tracks.length }))));
async function runPresets() {
  if (presetJob) return;
  while (presetQueue.length) {
    const q = presetQueue.shift(), p = presetFile().find(x => x.slug === q.slug), found = presetFound.get(p.slug) || new Map();
    presetFound.set(p.slug, found); presetJob = { slug: p.slug, name: p.name, done: found.size, total: p.tracks.length }; presetError = null; commit();
    try {
      for (const e of p.tracks) {
        const k = norm(e.title) + '|' + norm(e.artist);
        if (!found.has(k)) { const m = await spotifyMatch(e); found.set(k, m.status === 'ok' ? plainTrack(fromSpotify(m.c)) : null); await new Promise(ok => setTimeout(ok, 120)); }
        if (++presetJob.done % 5 === 0) commit();
      }
      const seen = new Set(), tracks = [...found.values()].filter(t => t && !seen.has(t.songId) && seen.add(t.songId));
      if (!tracks.length) throw new Error('aucun titre trouvé');
      const l = { id: crypto.randomUUID(), name: p.name, preset: p.slug, tracks }; state.lists.push(l); presetFound.delete(p.slug);
      // période visée : celle choisie, sinon les périodes du même genre (souper = calme, sinon dansante)
      const kind = p.group === 'souper' ? 'calm' : 'party', target = state.phases.filter(x => x.id === q.phaseId);
      for (const ph of target.length ? target : state.phases.filter(x => x.intensity === kind)) ph.listId = l.id;
    } catch (e) { console.error('liste ' + p.slug + ' :', e.message); presetError = { name: p.name, msg: e.message }; }
  }
  presetJob = null; commit();
}
app.post('/api/presets/:slug/add', requireHost, wrap(async (req, res) => {
  const p = presetFile().find(x => x.slug === req.params.slug);
  if (!p) throw E('err.listNotFound', 404);
  if (!presetTaken(p.slug)) { presetQueue.push({ slug: p.slug, phaseId: req.body && req.body.phaseId }); runPresets(); }
  res.json({ ok: true });
}));
app.get('/api/lists/:id', requireHost, (req, res) => {
  const l = state.lists.find(x => x.id === req.params.id);
  l ? res.json({ id: l.id, name: l.name, tracks: l.tracks }) : fail(req, res, 404, 'err.listNotFound');
});
app.post('/api/lists/import', requireHost, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const tracks = (Array.isArray(req.body.tracks) ? req.body.tracks : []).filter(t => t && ID_RE.test(String(t.songId)))
    .map(t => ({ songId: String(t.songId), title: String(t.title || '').slice(0, 200), artist: String(t.artist || '').slice(0, 200), artwork: String(t.artwork || '').slice(0, 300) })).slice(0, 600);
  if (!name || !tracks.length) return fail(req, res, 400, 'err.importEmpty');
  state.lists.push({ id: crypto.randomUUID(), name, tracks });
  commit(); res.json({ ok: true, count: tracks.length });
});
app.post('/api/lists/:id/toggle', requireHost, (req, res) => {
  const l = state.lists.find(x => x.id === req.params.id), t = l && l.tracks.find(x => x.songId === req.body.songId);
  if (!t) return fail(req, res, 404, 'err.trackNotFound');
  t.off = !t.off; if (!t.off) delete t.off;
  commit(); res.json({ id: l.id, name: l.name, tracks: l.tracks });
});
app.post('/api/lists/:id/add', requireHost, wrap(async (req, res) => {
  const l = state.lists.find(x => x.id === req.params.id);
  if (!l) throw E('err.listNotFound', 404);
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
  if (!ID_RE.test(String(songId || ''))) return fail(req, res, 400, 'err.badTrack');
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
  if (!n || n.songId !== req.body.songId || ![1, -1].includes(vote)) return fail(req, res, 400, 'err.nothingToRate');
  const r = state.ratings[n.songId] || (state.ratings[n.songId] = { title: n.title, artist: n.artist, up: 0, down: 0 });
  vote > 0 ? r.up++ : r.down++; r.last = Date.now();
  logEvent('rate', { songId: n.songId, title: n.title, vote, elapsed: state.nowStartedAt ? Math.round((Date.now() - state.nowStartedAt) / 1000) : null });
  commit(); res.json({ ok: true, ...r });
});
app.get('/api/ratings', requireHost, (req, res) =>
  res.json(Object.entries(state.ratings).map(([songId, r]) => ({ songId, ...r })).sort((a, b) => (b.up - b.down) - (a.up - a.down))));

// ---------- Souhaits d'avant la soirée (page publique /souhaits.html, texte libre : fonctionne sans Spotify) ----------
app.post('/api/wish', wrap(async (req, res) => {
  const ev = eventByToken(req.get('x-event') || ''); // le code de n'importe quel événement non terminé suffit : on souhaite avant la soirée
  if (ev) { if (eventStatus(ev) === 'ended') throw E('err.eventEnded', 403); }
  else needEvent(req);
  const text = String(req.body.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const name = String(req.body.name || '').replace(/[^\p{L}\p{N} '-]/gu, '').trim().slice(0, 20);
  const by = String(req.body.guestId || '');
  if (text.length < 3 || !ID_RE.test(by)) throw E('err.badWish', 400);
  if (limited('w:' + req.ip, 30, 10 * 60e3)) throw E('err.slowDown', 429);
  const evId = ev ? ev.id : (state.activeEventId || null), mine = state.wishes.filter(w => (w.ev || null) === evId);
  if (mine.filter(w => w.by === by).length >= 3) throw E('err.maxWishes', 429);
  if (mine.length >= 400) throw E('err.wishesFull', 429);
  state.wishes.push({ id: crypto.randomUUID(), text, name, by, at: Date.now(), ev: evId });
  save(); res.json({ ok: true });
}));
// ?ev=ID (un événement) | all | none (sans événement) ; par défaut : l'événement actif
const wishScope = q => {
  const v = String((q && q.ev) || '');
  if (v === 'all') return () => true;
  const target = v === 'none' ? null : (v || state.activeEventId || null);
  return w => (w.ev || null) === target;
};
app.get('/api/wishes', requireHost, (req, res) => {
  const scope = wishScope(req.query), groups = new Map(); let total = 0;
  for (const w of state.wishes.filter(scope)) {
    total++;
    const k = norm(w.text), g = groups.get(k) || { text: w.text, count: 0, names: [], ids: [], first: w.at, last: w.at };
    g.count++; g.ids.push(w.id); g.first = Math.min(g.first, w.at); g.last = Math.max(g.last, w.at);
    if (w.name && !g.names.includes(w.name)) g.names.push(w.name);
    groups.set(k, g);
  }
  res.json({ total, groups: [...groups.values()].sort((a, b) => b.count - a.count || b.last - a.last) });
});
app.post('/api/wishes/done', requireHost, (req, res) => { // souhait traité : retire ses entrées
  const ids = new Set((Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(String));
  state.wishes = state.wishes.filter(w => !ids.has(w.id)); save(); res.json({ ok: true });
});
app.post('/api/wishes/clear', requireHost, (req, res) => { const scope = wishScope(req.body); state.wishes = state.wishes.filter(w => !scope(w)); save(); res.json({ ok: true }); });
app.post('/api/linedance', requireHost, (req, res) => {
  const t = pickLine();
  if (!t) return fail(req, res, 400, 'err.noLineDance');
  state.queue.unshift(t); commit(); res.json({ ok: true });
});

// Option « garder ma connexion Spotify sur le serveur » : le jeton de renouvellement vit dans data/spotify.json (lecture réservée au serveur),
// les navigateurs ne reçoivent que le jeton d'accès (1 h). Désactivée par défaut ; désactivée = fichier supprimé.
const SPOTIFY_FILE = path.join(DATA_DIR, 'spotify.json');
const forgetSpotify = () => { try { fs.unlinkSync(SPOTIFY_FILE); } catch {} };
const readKept = () => { try { return JSON.parse(fs.readFileSync(SPOTIFY_FILE, 'utf8')).refresh || ''; } catch { return ''; } };
app.post('/api/spotify/garder', requireHost, (req, res) => {
  if (!spotifyKeep()) { forgetSpotify(); return fail(req, res, 403, 'err.spotifyOff'); }
  const r = req.body.refresh;
  if (typeof r !== 'string' || r.length < 20 || r.length > 1000) return fail(req, res, 400, 'err.badToken');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SPOTIFY_FILE, JSON.stringify({ refresh: r }), { mode: 0o600 });
  console.log('Connexion Spotify gardée sur le serveur.');
  res.json({ ok: true });
});
let spotifySession = Promise.resolve();
app.post('/api/spotify/session', requireHost, (req, res) => {
  const run = async () => {
    if (!spotifyKeep()) { forgetSpotify(); throw E('err.spotifyOff', 404); }
    const refresh = readKept();
    if (!refresh || !SPOTIFY_CLIENT_ID) throw E('err.spotifyOff', 404);
    const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: SPOTIFY_CLIENT_ID }) });
    if (!r.ok) { if (r.status === 400 || r.status === 401) forgetSpotify(); throw E('err.spotifyExpired', 503); }
    const j = await r.json();
    if (j.refresh_token && j.refresh_token !== refresh) fs.writeFileSync(SPOTIFY_FILE, JSON.stringify({ refresh: j.refresh_token }), { mode: 0o600 });
    return { access: j.access_token, exp: Date.now() + j.expires_in * 1000 - 60000 };
  };
  const p = spotifySession.then(run, run); spotifySession = p.catch(() => {}); // une demande à la fois : Spotify peut renouveler le jeton à chaque appel
  p.then(j => res.json(j), e => res.status(e.code || 500).json({ error: e.key ? tr(reqLang(req), e.key, e.vars) : e.message }));
});
app.post('/api/spotify/token', requireHost, (req, res) => {
  if (typeof req.body.token !== 'string' || req.body.token.length > 600) return fail(req, res, 400, 'err.badToken');
  spotifyToken = req.body.token; res.json({ ok: true });
  ensureDefaultOpener().catch(e => console.error('chanson d’ouverture :', e.message));
  autoPrepare().catch(() => {});
});
app.post('/api/next', requireHost, (req, res) => {
  advanceWhy = ['skip', 'start', 'phase'].includes(req.body && req.body.why) ? req.body.why : 'end';
  const nowPlaying = advance(), callout = calloutPending; calloutPending = false;
  res.json({ nowPlaying, callout });
});
app.post('/api/queue/add', requireHost, wrap(async (req, res) => {
  const dup = !req.body.force && dupOf(String(req.body.songId || ''));
  if (dup) throw Object.assign(E(dup.kind === 'now' ? 'err.dupNow' : dup.kind === 'queue' ? 'err.dupQueue' : 'err.dupPlayed', 409, { n: dup.min }), { extra: { dup: true } });
  const song = await lookupSong(req.body.songId, { by: 'host', source: 'host', ...(req.body.force ? { forced: true } : {}) });
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
  if (!ID_RE.test(id)) return fail(req, res, 400, 'err.badTrack');
  if (req.body.reset) delete state.gains[id];
  else {
    const step = Number(req.body.step);
    if (![-1, 1].includes(step)) return fail(req, res, 400, 'err.badSetting');
    const g = Math.max(-12, Math.min(3, Math.round(((state.gains[id] || 0) + step * 1.5) * 10) / 10));
    g ? (state.gains[id] = g) : delete state.gains[id];
  }
  logEvent('gain', { songId: id, gain: state.gains[id] || 0, title: state.nowPlaying && state.nowPlaying.songId === id ? state.nowPlaying.title : undefined });
  commit(); res.json({ gain: state.gains[id] || 0 });
});
app.post('/api/clientlog', requireHost, (req, res) => { // incidents de lecture vus par le dashboard (titre qui ne démarre pas, fin non détectée…), pour comprendre après coup
  if (limited('clog', 60, 60e3)) return fail(req, res, 429, 'err.tooManyEvents');
  logEvent('client', { kind: String(req.body.kind || '').slice(0, 40), detail: String(req.body.detail || '').slice(0, 200), songId: state.nowPlaying ? state.nowPlaying.songId : null });
  res.json({ ok: true });
});
app.get('/api/soirees', requireHost, (req, res) => res.json(fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl')).sort().reverse().map(f => f.slice(0, -6)) : []));
app.get('/api/soirees/:day', requireHost, (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(req.params.day) ? req.params.day : logDay(), f = path.join(LOG_DIR, day + '.jsonl');
  fs.existsSync(f) ? res.download(f) : fail(req, res, 404, 'err.noLog');
});
function settingsView() {
  return Object.entries(SETTING_DEFS).map(([key, [type, def]]) => ({
    key, type, def, source: settingSource(key),
    ...(type === 'secret' ? { set: !!settingValue(key) } : { value: settingValue(key) }),
  }));
}
app.get('/api/app-settings', requireHost, (req, res) => res.json(settingsView()));
app.post('/api/app-settings', requireHost, (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  for (const [k, v] of Object.entries(body)) {
    const d = SETTING_DEFS[k];
    if (!d) return fail(req, res, 400, 'err.unknownSetting', { k });
    if (v === null || v === '') { delete overrides[k]; continue; } // retour à la valeur du .env ou par défaut
    const val = String(v).trim();
    if (!d[2](val)) return fail(req, res, 400, 'err.badValue', { name: tr(reqLang(req), 'set.' + k) });
    overrides[k] = val;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(overrides, null, 1));
  applySettings(); published.clear(); droits = null; commit(); licSync();
  if (!licenced()) syncTunnel(null).catch(() => {}); // licence retirée : plus de tunnel automatique
  res.json(settingsView());
});
app.get('/api/links', requireHost, (req, res) => { // liens à partager (contiennent le code de la soirée)
  const b = guestBase(req);
  const t = tokenFor(req);
  res.json({ guests: `${b}/?e=${t}`, wishes: `${b}/souhaits.html?e=${t}`, remote: `${b}/remote`, public: !/^https?:\/\/(10\.|192\.168\.|127\.|localhost)/.test(b) });
});
app.get('/remote', (req, res) =>
  canRemote(req) ? res.sendFile(path.join(__dirname, 'views', 'remote.html')) : res.redirect('/login.html?next=/remote'));
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
  if (limited('remote', 90, 60e3)) return fail(req, res, 429, 'err.slowDown');
  const b = req.body || {};
  let msg;
  if (b.cmd === 'next' || b.cmd === 'pause' || b.cmd === 'callout' || b.cmd === 'start') msg = { cmd: b.cmd };
  else if (b.cmd === 'say') {
    const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (text.length < 2) return fail(req, res, 400, 'err.emptyMessage');
    msg = { cmd: 'say', text };
  } else if (b.cmd === 'jingle' && REMOTE_JINGLES.includes(b.name)) msg = { cmd: 'jingle', name: b.name };
  else if (b.cmd === 'moment' && ['open', 'close'].includes(b.src)) msg = { cmd: 'moment', src: b.src }; // mot d'ouverture / dernière toune de Vinny
  else if (b.cmd === 'phase' && state.phases.some(p => p.id === b.id)) msg = { cmd: 'phase', id: b.id };
  else return fail(req, res, 400, 'err.unknownCommand');
  if (!dashClients.size) return fail(req, res, 409, 'err.noDashboard');
  for (const r of dashClients) r.write('event: cmd\ndata: ' + JSON.stringify(msg) + '\n\n');
  res.json({ ok: true });
});
app.post('/api/event/rotate', requireHost, (req, res) => { // nouveau code : les anciens QR cessent de fonctionner
  const target = state.events.find(e => e.id === (req.body && req.body.ev)), t = crypto.randomBytes(9).toString('base64url');
  if (target) { target.token = t; if (target.id === state.activeEventId) state.eventToken = t; }
  else { state.eventToken = t; const ae = activeEvent(); if (ae) ae.token = t; }
  state.qrRev++; commit(); licSync(); res.json({ ok: true });
});
app.post('/api/fx', requireHost, (req, res) => {
  if (!['confetti', 'party', 'callout'].includes(req.body.type)) return fail(req, res, 400, 'err.unknownType');
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
  // chanson d'ouverture (période dansante) : un vrai titre, lancé à openAt secondes et monté en fondu sur openFade secondes
  if (b.open === null) { delete p.open; p.openDefaulted = true; } // retirée par l'hôte : Levels ne revient pas toute seule
  else if (b.open && SONG_ID_RE.test(String(b.open.songId))) p.openDefaulted = true, p.open = { songId: String(b.open.songId), title: String(b.open.title || '').slice(0, 200), artist: String(b.open.artist || '').slice(0, 200), artwork: String(b.open.artwork || '').slice(0, 300) };
  if (typeof b.openAt === 'number' && b.openAt >= 0 && b.openAt <= 900) p.openAt = Math.round(b.openAt * 10) / 10;
  if (typeof b.openFade === 'number' && b.openFade >= 2 && b.openFade <= 30) p.openFade = b.openFade;
}
app.post('/api/phases', requireHost, (req, res) => {
  const b = req.body || {};
  if (b.preset) { // période par défaut (nom, heure, phrase de Vinny) dans la langue de la salle
    const p = newPhase(b.intensity === 'party' ? 'party' : 'calm', evLang());
    state.phases.push(p); state.phases.sort((a, c) => a.start.localeCompare(c.start));
    commit(); return res.json({ ok: true, id: p.id });
  }
  if (!b.name || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start || '')) return fail(req, res, 400, 'err.phaseFields');
  const calm = b.intensity !== 'party';
  const p = { id: crypto.randomUUID(), name: '', start: b.start, intensity: calm ? 'calm' : 'party', requestsOpen: true, jingle: '', color: calm ? '#FFD23F' : '#FF4F7B', listId: calm ? 'builtin:souper' : 'builtin:dance' };
  phaseFields(b, p);
  state.phases.push(p); state.phases.sort((a, c) => a.start.localeCompare(c.start));
  commit(); res.json({ ok: true, id: p.id });
});
app.post('/api/phases/ensure', requireHost, (req, res) => { // Souper / Soirée en un clic : crée la période par défaut si elle manque
  const kind = req.body && req.body.intensity === 'calm' ? 'calm' : 'party';
  let p = state.phases.find(x => x.intensity === kind);
  if (!p) { p = newPhase(kind, evLang()); state.phases.push(p); state.phases.sort((a, c) => a.start.localeCompare(c.start)); commit(); }
  res.json({ id: p.id });
});
app.put('/api/phases/:id', requireHost, (req, res) => {
  const p = state.phases.find(x => x.id === req.params.id);
  if (!p) return fail(req, res, 404, 'err.phaseNotFound');
  phaseFields(req.body || {}, p); state.phases.sort((a, c) => a.start.localeCompare(c.start));
  if (p.id === state.activePhaseId && typeof req.body.requestsOpen === 'boolean') state.requestsOpen = p.requestsOpen;
  commit(); res.json({ ok: true });
});
app.delete('/api/phases/:id', requireHost, (req, res) => {
  state.phases = state.phases.filter(p => p.id !== req.params.id);
  if (state.activePhaseId === req.params.id) state.activePhaseId = null;
  commit(); res.json({ ok: true });
});
app.post('/api/phases/:id/activate', requireHost, async (req, res) => {
  const p = state.phases.find(x => x.id === req.params.id);
  if (!p) return fail(req, res, 404, 'err.phaseNotFound');
  if (p.intensity === 'party' && !p.open) await ensureDefaultOpener().catch(() => {}); // Levels pas encore trouvée : dernier essai avant d'ouvrir la piste
  state.activePhaseId = p.id; state.requestsOpen = p.requestsOpen; state.periodReq = {}; logEvent('phase', { name: p.name, intensity: p.intensity }); // nouvelle période : les compteurs par IP repartent à zéro
  // ouverture de la piste (période dansante, musique déjà en cours) : le dashboard enchaîne aussitôt en fondu sur la chanson choisie,
  // ou, sans chanson choisie, sur le premier titre de la liste dance (on ne reste jamais sur la toune du souper)
  let opener = !!(req.body && req.body.opener && p.intensity === 'party');
  if (opener) {
    if (p.open) {
      state.queue = state.queue.filter(s => s.songId !== p.open.songId || s.source !== 'auto');
      state.queue.unshift({ uid: crypto.randomUUID(), ...p.open, by: 'host', source: 'host', opener: { at: p.openAt || 0, fade: p.openFade || 10 } });
    } else {
      fillAuto(); // la file auto passe tout de suite à la liste de la période
      if (state.queue[0]) state.queue[0].opener = { at: (state.trims[state.queue[0].songId] || {}).start || 0, fade: p.openFade || 10 };
      else opener = false;
    }
  }
  commit();
  if (state.autoFx && p.intensity === 'party') fx('party');
  res.json({ ok: true, jingle: p.jingle || '', intensity: p.intensity, color: p.color, listId: p.listId, opener });
});

// ---------- API des événements (hôte) ----------
const evFields = (b, ev) => {
  if (typeof b.name === 'string' && b.name.trim()) ev.name = b.name.trim().slice(0, 60);
  if (DATE_RE.test(b.date || '')) ev.date = b.date;
  if (TIME_RE.test(b.start || '')) ev.start = b.start;
  if (TIME_RE.test(b.end || '')) ev.end = b.end;
  if (typeof b.place === 'string') ev.place = b.place.trim().slice(0, 80);
  if (typeof b.welcome === 'string') ev.welcome = b.welcome.trim().slice(0, 300);
  if (typeof b.thanks === 'string') ev.thanks = b.thanks.trim().slice(0, 300);
  if (Number.isInteger(b.openBeforeMin) && b.openBeforeMin >= 0 && b.openBeforeMin <= 360) ev.openBeforeMin = b.openBeforeMin;
  if (typeof b.auto === 'boolean') ev.auto = b.auto;
  if (LANGS.includes(b.lang) && b.lang !== okLang(ev.lang)) { // langue de l'événement : pages invités, voix et annonces de Vinny
    relang(ev.id === state.activeEventId ? state.phases : ev.phases, ev.lang, b.lang);
    ev.lang = b.lang;
  }
};
const freshIds = a => clonePhases(a).map(p => ({ ...p, id: crypto.randomUUID() }));
function activateEvent(ev) {
  const prev = activeEvent();
  if (prev && prev.id !== ev.id) prev.phases = clonePhases(state.phases); // le programme de l'événement quitté est gardé tel quel
  state.activeEventId = ev.id; state.eventToken = ev.token; state.qrRev++;
  if (ev.phases && ev.phases.length) state.phases = clonePhases(ev.phases); else ev.phases = clonePhases(state.phases);
  if (!state.phases.some(p => p.id === state.activePhaseId)) state.activePhaseId = null;
  state.periodReq = {}; ev.closed = false;
  // demandes : fermées avant l'heure ; pendant l'événement, selon la période en cours (ouvertes s'il n'y en a pas encore)
  state.requestsOpen = eventStatus(ev) === 'live' ? (state.phases.find(p => p.id === state.activePhaseId) || { requestsOpen: true }).requestsOpen : false;
  logEvent('event', { action: 'activate' });
}
const evById = (req, res) => { const ev = state.events.find(e => e.id === req.params.id); if (!ev) fail(req, res, 404, 'err.eventNotFound'); return ev; };
app.get('/api/evts', requireHost, (req, res) => {
  const now = Date.now();
  res.json({ now, activeId: state.activeEventId, events: state.events.map(e => ({ ...e, phases: undefined, phaseCount: (e.phases || []).length, status: eventStatus(e, now), wishCount: state.wishes.filter(w => w.ev === e.id).length }))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)) });
});
app.post('/api/evts', requireHost, (req, res) => {
  const b = req.body || {};
  if (!b.name || !DATE_RE.test(b.date || '') || !TIME_RE.test(b.start || '') || !TIME_RE.test(b.end || '')) return fail(req, res, 400, 'err.eventFields');
  if (state.events.length >= 100) return fail(req, res, 400, 'err.eventLimit');
  const src = b.copyFrom && state.events.find(e => e.id === b.copyFrom), lang = okLang(b.lang);
  const phases = b.program === 'default' ? [newPhase('calm', lang), newPhase('party', lang)] : freshIds(src ? (src.id === state.activeEventId ? state.phases : src.phases) : state.phases);
  if (b.program !== 'default') relang(phases, src ? src.lang : evLang(), lang);
  const ev = { id: crypto.randomUUID(), lang, name: '', date: '', start: '', end: '', place: '', welcome: '', thanks: tr(lang, 'ev.thanksDefault'), openBeforeMin: 30, auto: true,
    token: !state.events.length && !state.activeEventId ? state.eventToken : crypto.randomBytes(9).toString('base64url'), phases, createdAt: Date.now() };
  evFields(b, ev);
  state.events.push(ev); commit(); licSync(); res.json({ ok: true, id: ev.id });
});
app.put('/api/evts/:id', requireHost, wrap(async (req, res) => {
  const ev = evById(req, res); if (!ev) return;
  const old = { date: ev.date, start: ev.start, end: ev.end };
  evFields(req.body || {}, ev);
  const locked = await publishEvent(ev, old).catch(() => false); // passe attachée : les dates ne bougent plus (ou seulement avant le début)
  commit(); licSync();
  if (locked) throw E('lic.dates_verrouillees', 409);
  res.json({ ok: true });
}));
app.delete('/api/evts/:id', requireHost, (req, res) => {
  const ev = evById(req, res); if (!ev) return;
  state.events = state.events.filter(e => e.id !== ev.id); state.wishes = state.wishes.filter(w => w.ev !== ev.id);
  if (state.activeEventId === ev.id) state.activeEventId = null; // le code reste valable comme code unique, comme avant les événements
  commit(); res.json({ ok: true });
});
app.post('/api/evts/:id/activate', requireHost, (req, res) => { const ev = evById(req, res); if (!ev) return; activateEvent(ev); commit(); res.json({ ok: true }); });
app.post('/api/evts/:id/start', requireHost, (req, res) => { const ev = evById(req, res); if (!ev) return; ev.startedAt = Date.now(); delete ev.endedAt; snoozeMs = 0; activateEvent(ev); commit(); res.json({ ok: true }); });
app.post('/api/evts/:id/end', requireHost, (req, res) => {
  const ev = evById(req, res); if (!ev) return;
  ev.endedAt = Date.now(); ev.closed = true; if (ev.id === state.activeEventId) state.requestsOpen = false;
  commit(); res.json({ ok: true });
});
app.post('/api/evts/:id/duplicate', requireHost, (req, res) => {
  const src = evById(req, res); if (!src) return;
  const b = req.body || {};
  if (!DATE_RE.test(b.date || '')) return fail(req, res, 400, 'err.dateRequired');
  const ev = { ...JSON.parse(JSON.stringify(src)), id: crypto.randomUUID(), token: crypto.randomBytes(9).toString('base64url'), date: b.date, createdAt: Date.now(),
    name: (typeof b.name === 'string' && b.name.trim() ? b.name.trim() : src.name).slice(0, 60), phases: freshIds(src.id === state.activeEventId ? state.phases : src.phases) };
  delete ev.startedAt; delete ev.endedAt; delete ev.closed; delete ev.liveAt;
  state.events.push(ev); commit(); licSync(); res.json({ ok: true, id: ev.id });
});
// Toutes les 30 s : ferme les demandes à la fin de l'événement actif ; ouvre (active) un événement dont l'heure est venue
function eventTick() {
  const now = Date.now(), ae = activeEvent(); let changed = false;
  if (ae && eventStatus(ae, now) === 'ended' && !ae.closed) { ae.closed = true; state.requestsOpen = false; changed = true; }
  // début réel de l'événement actif (heure d'ouverture atteinte ou « Démarrer maintenant ») : le programme repart à sa première période,
  // pour que les essais faits avant (ex. Soirée lancée en test) ne restent pas actifs, et les demandes suivent cette période
  if (ae && eventStatus(ae, now) === 'live' && !ae.liveAt) {
    ae.liveAt = now; const first = state.phases[0];
    if (first) state.activePhaseId = first.id;
    state.requestsOpen = (first || { requestsOpen: true }).requestsOpen; state.periodReq = {}; changed = true;
    logEvent('event', { action: 'live', phase: first ? first.name : null });
  }
  if (!ae || eventStatus(ae, now) === 'ended') {
    const next = state.events.find(e => e.auto !== false && e.id !== state.activeEventId && eventStatus(e, now) === 'live');
    if (next) { activateEvent(next); changed = true; }
  }
  if (changed) commit();
}
setInterval(eventTick, 30000).unref();
eventTick();

// ---------- Licence : synchro avec Convex (soirées publiées, souhaits d'avance, voix incluse) ----------
// Sans LICENCE_KEY et CONVEX_URL, rien ne change : tout reste local. Plan : docs/modele-affaires.md ; routes : convex/README.md.
const licenced = () => !!(LICENCE_KEY && CONVEX_URL);
let droits = null, licErr = '', syncing = false, lastSync = 0; // droits : dernière réponse de /droits
const published = new Map(); // evId -> signature de ce qui est déjà publié
async function convex(route, body = {}, bin = false) {
  let r;
  try { r = await fetch(CONVEX_URL + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LICENCE_KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) }); }
  catch { throw E('lic.injoignable', 502); }
  if (!r.ok) {
    const code = await r.json().then(j => String(j.error || ''), () => '');
    throw E('lic.' + (/^[a-z_]{3,40}$/.test(code) ? code : 'echec'), r.status === 401 ? 403 : r.status >= 500 ? 502 : r.status); // 401 -> 403 : le dashboard y verrait une session expirée
  }
  return bin ? Buffer.from(await r.arrayBuffer()) : r.json();
}
const evPayload = ev => {
  const { start, end } = evTimes(ev);
  return { evId: ev.id, code: ev.token, nom: ev.name, date: ev.date, debut: ev.start, fin: ev.end, debutTs: start, finTs: end, lang: okLang(ev.lang), lieu: ev.place || '', accueil: ev.welcome || '', merci: ev.thanks || '' };
};
// Publie un événement non terminé si quelque chose a changé. Retourne true si Convex a refusé le changement de dates (remises à old).
async function publishEvent(ev, old) {
  if (!licenced() || eventStatus(ev) === 'ended') return false;
  const body = evPayload(ev), sig = sha([JSON.stringify(body)]);
  if (published.get(ev.id) === sig) return false;
  try { await convex('/publier-soiree', body); published.set(ev.id, sig); return false; }
  catch (e) {
    if (e.key !== 'lic.dates_verrouillees' || !old) throw e;
    Object.assign(ev, old); const b2 = evPayload(ev); await convex('/publier-soiree', b2); published.set(ev.id, sha([JSON.stringify(b2)]));
    return true;
  }
}
async function licSync() {
  if (!licenced() || syncing) return;
  syncing = true;
  try {
    for (const ev of state.events) await publishEvent(ev).catch(e => { if (!['lic.dates_verrouillees', 'lic.soiree_invalide', 'lic.champs_invalides'].includes(e.key)) throw e; });
    droits = await convex('/droits');
    await syncTunnel(droits.tunnel, droits.cleSsh).catch(e => console.warn('Tunnel automatique :', e.key || e.message)); // un souci de tunnel n'empêche pas les souhaits
    const { souhaits = [] } = await convex('/souhaits');
    let added = false;
    for (const w of souhaits) {
      if (!state.events.some(e => e.id === w.evId)) continue;
      state.wishes.push({ id: crypto.randomUUID(), text: String(w.texte || '').slice(0, 80), name: String(w.prenom || '').slice(0, 20), by: String(w.invite || '').slice(0, 64), at: Number(w.recu) || Date.now(), ev: w.evId }); added = true;
    }
    if (added) commit();
    licErr = ''; lastSync = Date.now();
  } catch (e) { licErr = e.key || 'lic.echec'; console.warn('Synchro licence :', licErr); }
  finally { syncing = false; }
}
const passOf = evId => droits && (droits.soirees || []).find(s => s.evId === evId);
const voiceViaPass = () => { const ae = activeEvent(), p = ae && passOf(ae.id); return !!(licenced() && p && p.passe === 'attachee' && p.ouverte); };
setInterval(licSync, 60e3).unref();
setTimeout(licSync, 1500).unref();
app.get('/api/licence', requireHost, wrap(async (req, res) => {
  if (req.query.refresh === '1') await licSync();
  res.json({ on: licenced(), portal: process.env.PORTAIL_URL || 'https://compte.djvinny.ca', error: licErr ? tr(reqLang(req), licErr) : '', at: lastSync, free: droits ? droits.passesLibres : null, domain: droits ? droits.sousDomaine : '',
    events: Object.fromEntries((droits ? droits.soirees : []).map(s => [s.evId, { pass: s.passe, open: s.ouverte, voice: s.voixRestante }])) });
}));
const licEv = req => { const ev = state.events.find(e => e.id === (req.body && req.body.ev)); if (!ev) throw E('err.eventNotFound', 404); return ev; };
app.post('/api/licence/attacher', requireHost, wrap(async (req, res) => {
  if (!licenced()) throw E('lic.non_configuree', 400);
  const ev = licEv(req); await publishEvent(ev); await convex('/attacher-passe', { evId: ev.id }); await licSync(); res.json({ ok: true });
}));
app.post('/api/licence/detacher', requireHost, wrap(async (req, res) => {
  if (!licenced()) throw E('lic.non_configuree', 400);
  const ev = licEv(req); await convex('/detacher-passe', { evId: ev.id }); await licSync(); res.json({ ok: true });
}));

// ---------- Voix & jingles ----------
// Gratuit : clips prégénérés dans voix/<langue>/ (phrases sans titre ni prénom, voir voix/generer.js).
// Voix en direct (titre, artiste, prénom) : passe payante (Convex).
const TTS_DIR = path.join(DATA_DIR, 'tts');
const VOIX_DIR = path.join(__dirname, 'voix');
const sha = parts => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 24);
const clipsOf = lang => { try { return fs.readdirSync(path.join(VOIX_DIR, lang)).filter(f => f.endsWith('.mp3')); } catch { return []; } };
const hasClips = () => clipsOf('fr').length > 0 || clipsOf('en').length > 0;
// Premier clip trouvé parmi les catégories (ex. party-anon-2.mp3), tiré au hasard
const clipFor = (lang, intensity, cats) => {
  const files = clipsOf(lang);
  for (const cat of cats) { const m = files.filter(f => f.startsWith(`${intensity}-${cat}-`)); if (m.length) return `/voix/${lang}/${m[Math.floor(Math.random() * m.length)]}`; }
  return null;
};

// Synthèse d'un morceau de texte, avec cache disque : un même texte n'est facturé qu'une fois.
// o : voiceSettings, prev/next (contexte de prosodie ElevenLabs), lang
const voiceLive = voiceViaPass;
const VOIX_MAX = Number(process.env.VOIX_MAX_CARACTERES) || 10000; // caractères de voix en direct par événement (en plus du plafond de la passe)
const voixUsed = () => (activeEvent() || {}).voixCar || 0;
async function synth(text, o = {}) {
  if (voiceViaPass() && text.length <= 400) { // voix incluse avec la passe : Convex choisit le modèle et la voix
    const lang = okLang(o.lang || evLang()), hash = sha(['convex', text, lang, JSON.stringify(o.voiceSettings || null)]), file = path.join(TTS_DIR, hash + '.mp3');
    if (!fs.existsSync(file)) {
      const ev = activeEvent();
      if (voixUsed() + text.length > VOIX_MAX) throw E('err.voiceCap', 429);
      const mp3 = await convex('/voix', { evId: activeEvent().id, texte: text, lang, prev: o.prev, next: o.next, voiceSettings: o.voiceSettings || undefined }, true);
      fs.mkdirSync(TTS_DIR, { recursive: true }); fs.writeFileSync(file, mp3);
      ev.voixCar = voixUsed() + text.length; commit();
      licSync(); // met à jour les caractères restants
    }
    return { hash, file };
  }
  throw E('err.ttsNeedPass', 402);
}
app.post('/api/tts', requireHost, wrap(async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 300);
  if (!text) throw E('err.emptyText', 400);
  if (limited('tts', 30, 60e3)) throw E('err.tooManyTts', 429);
  res.json({ url: `/api/tts/${(await synth(text, { lang: evLang() })).hash}.mp3` });
}));

// Annonce d'une demande spéciale : UNE seule génération (phrase complète tirée au hasard dans announce/<langue>.json,
// avec {name} {title} {artist}), puis traitement ffmpeg (vitesse, compression, reverb léger).
// Les textes et les réglages se modifient dans announce/fr.json et announce/en.json, sans redémarrer. Langue : celle de l'événement actif.
const pick = a => a[Math.floor(Math.random() * a.length)];
const cleanTitle = s => String(s || '').replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '').replace(/\s-\s.*$/, '').replace(/\s+/g, ' ').trim().slice(0, 80);
const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const REVERB = [0.32, 0.28, 0.24, 0.2, 0.15, 0.1]; // décroissances de base, multipliées par "reverb"
app.post('/api/announce', requireHost, wrap(async (req, res) => {
  if (limited('ann', 30, 60e3)) throw E('err.tooManyAnn', 429);
  const lang = evLang(), cfg = announceCfg(lang);
  const phase = state.phases.find(p => p.id === state.activePhaseId);
  const c = cfg[phase && phase.intensity === 'calm' ? 'calm' : 'party'];
  const title = cleanTitle(req.body.title), artist = cleanTitle(req.body.artist);
  const isCallout = req.body.source === 'callout', moment = ['open', 'close'].includes(req.body.source) ? req.body.source : null;
  const phaseLine = req.body.source === 'phase' ? (phase && phase.jingle) || '' : null; // phrase de la période active (ex. ouverture de la piste)
  if (phaseLine === '') throw E('err.noPhaseLine', 400);
  if (!title && !isCallout && !moment && !phaseLine) throw E('err.noTitle', 400);
  const name = String(req.body.name || '').replace(/[^\p{L}\p{N} '-]/gu, '').trim().slice(0, 20);
  // prénom -> « demande spéciale de X » ; demande sans prénom -> « en demande spéciale » ; autre titre -> annonce simple
  const tpls = phaseLine ? [phaseLine] : moment && c[moment] ? c[moment] : isCallout ? c.callout : req.body.source === 'line' && c.line ? c.line : name ? c.named : req.body.source === 'guest' ? c.anon : c.plain;
  const freeClip = () => { // gratuit (ou plafond de voix atteint) : clip générique prégénéré (sans titre ni prénom)
    const intensity = phase && phase.intensity === 'calm' ? 'calm' : 'party', src = req.body.source;
    const cats = phaseLine ? ['phase'] : moment ? [moment] : isCallout ? ['callout'] : src === 'line' ? ['line', 'plain'] : src === 'guest' ? ['anon', 'plain'] : ['plain', 'anon'];
    const url = clipFor(lang, intensity, cats) || clipFor(lang, intensity === 'calm' ? 'party' : 'calm', cats);
    if (!url) throw E('err.ttsNeedPass', 402);
    return res.json({ url, text: '' });
  };
  if (!voiceLive() || voixUsed() >= VOIX_MAX) return freeClip();
  const text = fill(pick(tpls), { title, artist, name });
  console.log('Annonce :', text);
  let file;
  try { ({ file } = await synth(text, { voiceSettings: c.voiceSettings || null, lang })); }
  catch (e) { if (e.key === 'err.voiceCap') { console.warn('Plafond de voix atteint (' + voixUsed() + '/' + VOIX_MAX + ') : clips gratuits'); return freeClip(); } throw e; }

  const key = sha(['v2', file, c.tempo, c.reverb, c.ratio, c.presence, c.lufs]);
  const out = path.join(TTS_DIR, key + '.mp3');
  if (!fs.existsSync(out)) {
    // voix naturelle : pas de filtre « radio » ; vitesse, reverb et présence seulement si announce/<langue>.json les demande (1 / 0 / 0 = voix brute).
    // Restent un coupe-bas (grondement des haut-parleurs), une compression douce et le volume normalisé pour passer par-dessus la musique.
    const decays = REVERB.map(d => (d * c.reverb).toFixed(3)).join('|');
    const af = [c.tempo && c.tempo !== 1 && `atempo=${c.tempo}`, 'highpass=f=90', c.presence > 0 && `equalizer=f=3500:t=q:w=1.1:g=${c.presence}`,
      `acompressor=threshold=-20dB:ratio=${c.ratio || 2}:attack=8:release=120:makeup=2`, c.reverb > 0 && `aecho=0.85:0.9:19|37|53|79|109|151:${decays}`, `loudnorm=I=${c.lufs}:TP=-1.5`].filter(Boolean).join(',');
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
app.get('/voix/:lang/:name', requireHost, (req, res) => {
  if (!/^[a-z]{2}$/.test(req.params.lang) || !/^[\w-]+\.mp3$/.test(req.params.name)) return res.sendStatus(404);
  res.sendFile(path.join(VOIX_DIR, req.params.lang, req.params.name), err => err && !res.headersSent && res.sendStatus(404));
});
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

// ---------- Fermeture automatique : 24 h après le début de l'événement actif (évite un serveur oublié ouvert) ----------
// Le décompte part de « Démarrer maintenant », sinon de l'heure de début de l'événement quand il est en cours. Pas d'événement en cours : aucune fermeture.
// 60 s avant, le dashboard et la télécommande affichent un avis avec « Encore 1 h » (autant de fois que voulu).
// SHUTDOWN_TEST_SEC : pour les essais, fermeture N secondes après le démarrage du serveur.
const WARN_SEC = 60, FERME_APRES = 24 * 3600e3, bootAt = Date.now();
let snoozeMs = 0, warned = false, closing = false;
const closeAt = () => {
  if (process.env.SHUTDOWN_TEST_SEC) return bootAt + Number(process.env.SHUTDOWN_TEST_SEC) * 1000;
  const ev = activeEvent();
  if (!ev || eventStatus(ev) !== 'live') return null;
  return (ev.startedAt || evTimes(ev).start) + FERME_APRES + snoozeMs;
};
const sendShutdown = data => { const msg = `event: shutdown\ndata: ${JSON.stringify(data)}\n\n`; for (const res of clients) res.write(msg); };
const hhmm = t => new Date(t).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
// Fermeture (automatique, ou bouton « Fermer DJ Vinny » du dashboard) : avis aux pages, sauvegarde, tunnel arrêté, puis sortie
function closeServer(why) {
  if (closing) return;
  closing = true; console.log('Fermeture ' + why + ' (' + hhmm(Date.now()) + ').'); logEvent('shutdown', { why });
  const ev = activeEvent();
  if (why === 'automatique' && ev && !ev.endedAt) { ev.endedAt = Date.now(); ev.closed = true; state.requestsOpen = false; } // 24 h écoulées : événement terminé (le service redémarré ne reboucle pas)
  sendShutdown({ closed: true });
  clearTimeout(saveTimer); fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state)); // pas de sauvegarde perdue
  stopTunnel();
  setTimeout(() => process.exit(0), 1500);
}
setInterval(() => {
  if (closing) return;
  const at = closeAt();
  if (!at) { warned = false; return; }
  const left = at - Date.now();
  if (left <= 0) closeServer('automatique');
  else if (left <= WARN_SEC * 1000 && !warned) { warned = true; console.log('Fermeture dans 60 s, sauf « Encore 1 h ».'); sendShutdown({ left: Math.round(left / 1000) }); }
}, 1000);
app.post('/api/shutdown/snooze', requireHost, (req, res) => {
  snoozeMs += 3600e3; warned = false;
  const at = closeAt() || Date.now() + 3600e3;
  console.log('Fermeture repoussée à ' + hhmm(at)); sendShutdown({ until: at }); // la page formate l'heure dans sa langue
  res.json({ until: at });
});
app.post('/api/shutdown', requireHost, (req, res) => { res.json({ ok: true }); setTimeout(() => closeServer('demandée'), 200); });

// ---------- Tunnel vers le VPS (adresse publique des invités), lancé par le serveur, sans fenêtre ----------
// Automatique avec la licence : Convex donne l'hôte, le port et l'empreinte du VPS ; la clé SSH est générée ici et ne quitte jamais ce PC.
// Se relance 5 s après une coupure ; s'arrête avec le serveur. Sans tunnel ouvert, le QR reprend l'adresse du réseau local.
const KEY_FILE = path.join(DATA_DIR, 'tunnel_ed25519'), KNOWN_FILE = path.join(DATA_DIR, 'tunnel_known_hosts');
let tunnel = null, tunnelState = 'off', tunnelRetry = null, autoTarget = '';
const tunnelTarget = () => autoTarget;
function setTunnelState(st) {
  if (st === tunnelState) return;
  tunnelState = st;
  if (autoTarget) { state.qrRev++; commit(); } // adresse publique ouverte ou fermée : les QR affichés se mettent à jour
}
function startTunnel() {
  clearTimeout(tunnelRetry);
  const m = /^(.+):(\d+)$/.exec(tunnelTarget());
  if (!m || tunnel || closing) { if (!m) setTunnelState('off'); return; }
  setTunnelState('connecting');
  const keys = ['-i', KEY_FILE, '-o', 'IdentitiesOnly=yes', '-o', 'UserKnownHostsFile=' + KNOWN_FILE];
  const p = tunnel = require('child_process').spawn('ssh', ['-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', ...keys, '-R', `127.0.0.1:${m[2]}:127.0.0.1:${PORT}`, m[1]], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const up = setTimeout(() => { if (tunnel === p) { setTunnelState('up'); console.log('Tunnel ouvert vers', m[1]); } }, 5000); // ssh -N ne dit rien quand ça marche
  p.stderr.on('data', d => console.warn('Tunnel :', String(d).trim()));
  p.on('error', e => console.warn('Tunnel impossible :', e.message)); // ssh absent
  p.on('exit', () => {
    clearTimeout(up); if (tunnel !== p) return;
    tunnel = null; setTunnelState(tunnelTarget() ? 'down' : 'off');
    if (tunnelTarget() && !closing) { console.warn('Tunnel coupé, nouvel essai dans 5 s'); tunnelRetry = setTimeout(startTunnel, 5000); }
  });
}
function stopTunnel() { clearTimeout(tunnelRetry); const p = tunnel; tunnel = null; if (p) p.kill(); setTunnelState('off'); }
// Clé SSH de ce PC (ssh-keygen est inclus dans Windows 10 et 11), créée une seule fois dans data/
function ensureKey() {
  if (!fs.existsSync(KEY_FILE) || !fs.existsSync(KEY_FILE + '.pub')) {
    const cp = require('child_process');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    for (const f of [KEY_FILE, KEY_FILE + '.pub']) if (fs.existsSync(f)) fs.unlinkSync(f);
    cp.execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'djvinny', '-f', KEY_FILE], { windowsHide: true });
    // ssh refuse une clé privée lisible par d'autres comptes : on retire les droits hérités du dossier
    if (process.platform === 'win32') cp.execFileSync('icacls', [KEY_FILE, '/inheritance:r', '/grant:r', os.userInfo().username + ':F'], { windowsHide: true });
    console.log('Clé SSH du tunnel créée :', KEY_FILE);
  }
  return fs.readFileSync(KEY_FILE + '.pub', 'utf8').trim().split(' ').slice(0, 2).join(' ');
}
// Appelé après chaque /droits : publie la clé publique si besoin, puis branche le tunnel sur l'hôte et le port donnés par Convex
async function syncTunnel(tu, cleConnue) {
  if (process.env.NO_TUNNEL) return; // serveur hébergé sur le VPS : aucun tunnel vers lui-même
  let target = '';
  if (tu && tu.hote && /^ssh-[\w-]+ [A-Za-z0-9+/=]+$/.test(tu.cleHote || '')) {
    const pub = ensureKey();
    if (cleConnue !== pub) await convex('/cle-ssh', { cle: pub });
    const known = `${tu.hote} ${tu.cleHote}\n`;
    if (!fs.existsSync(KNOWN_FILE) || fs.readFileSync(KNOWN_FILE, 'utf8') !== known) fs.writeFileSync(KNOWN_FILE, known);
    target = `${tu.utilisateur}@${tu.hote}:${tu.port}`;
  }
  if (target === autoTarget) return;
  autoTarget = target;
  stopTunnel(); startTunnel();
}
// Adresse des invités (QR, liens) : l'adresse publique quand le tunnel automatique est ouvert, sinon le réseau local (repli)
const guestBase = req => (process.env.PUBLIC_URL || (autoTarget && tunnelState === 'up' && droits && droits.tunnel ? droits.tunnel.adresse
  : lanUrls()[0]) || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
app.get('/api/tunnel', requireHost, (req, res) => res.json({ on: !!tunnelTarget(), state: tunnelState, address: droits && droits.tunnel ? droits.tunnel.adresse : '' }));

const BIND = process.env.BIND || undefined; // BIND=127.0.0.1 : seulement ce PC et le tunnel (rien d'autre sur le réseau local)
app.listen(PORT, BIND, () => {
  startTunnel();
  console.log(`DJ Vinny : dashboard http://127.0.0.1:${PORT}/host`);
  console.log("Fermeture automatique : 24 h après le début de l'événement actif (avis 60 s avant, « Encore 1 h » pour prolonger).");
  if (BIND) console.log(`Écoute limitée à ${BIND} (BIND) : les appareils du réseau local ne peuvent pas joindre ce serveur directement.`);
  const lan = lanUrls(), pub = lan[0] || '(aucune adresse trouvée)';
  console.log('Adresse des invités (QR) :', pub);
});
