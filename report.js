// Rapport d'une soirée à partir du journal : node report.js [AAAA-MM-JJ]   (DATA_DIR pour un autre dossier de données)
const fs = require('fs');
const path = require('path');
const dir = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'soirees');
if (!fs.existsSync(dir)) { console.log('Aucun journal pour le moment.'); process.exit(0); }
const days = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -6)).sort();
const day = process.argv[2] || days[days.length - 1];
if (!days.includes(day)) { console.log('Journaux disponibles :', days.join(', ') || 'aucun'); process.exit(1); }
const ev = fs.readFileSync(path.join(dir, day + '.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

const tracks = [];
for (const e of ev) {
  const last = tracks[tracks.length - 1];
  if (e.type === 'play') {
    if (last && e.prevElapsed != null) { last.elapsed = e.prevElapsed; last.end = e.prevEnd; }
    tracks.push({ t: e.t, title: e.title, artist: e.artist, songId: e.songId, source: e.source, phase: e.phase, motion: [], up: 0, down: 0 });
  } else if (e.type === 'stop' && last) { last.elapsed = e.elapsed; last.end = 'stop'; }
  else if (e.type === 'motion' && last && e.songId === last.songId) last.motion.push(e.level);
  else if (e.type === 'rate' && last && e.songId === last.songId) e.vote > 0 ? last.up++ : last.down++;
}
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const hhmm = t => new Date(t).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
const mmss = s => (s == null ? '  ?  ' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
const pad = (s, n) => String(s).slice(0, n).padEnd(n);
tracks.forEach(k => { k.m = avg(k.motion); });

const count = (arr, f) => arr.reduce((o, x) => { const k = f(x) || '—'; o[k] = (o[k] || 0) + 1; return o; }, {});
const first = ev[0] && ev[0].t, lastT = ev[ev.length - 1] && ev[ev.length - 1].t;
console.log(`\nSoirée du ${day} : ${tracks.length} titres, de ${first ? hhmm(first) : '?'} à ${lastT ? hhmm(lastT) : '?'}`);
console.log('Sources   :', JSON.stringify(count(tracks, k => k.source)));
console.log('Périodes  :', JSON.stringify(count(tracks, k => k.phase)));
console.log('Fins      :', JSON.stringify(count(tracks.filter(k => k.end), k => k.end)), '(end = fin naturelle, skip = passé à la main, camera = suggestion caméra)');
console.log('Demandes invités :', ev.filter(e => e.type === 'request').length, '· notes :', ev.filter(e => e.type === 'rate').length, '· mesures caméra :', ev.filter(e => e.type === 'motion').length);

console.log('\nHeure Titre                            Artiste              Src   Durée Fin     Mvt  Notes');
for (const k of tracks) console.log(`${hhmm(k.t)} ${pad(k.title, 32)} ${pad(k.artist, 20)} ${pad(k.source, 5)} ${mmss(k.elapsed)} ${pad(k.end || '', 7)} ${k.m == null ? '  —  ' : k.m.toFixed(1).padStart(5)}  ${k.up ? '+' + k.up : ''}${k.down ? ' -' + k.down : ''}`);

const withM = tracks.filter(k => k.motion.length >= 2).sort((a, b) => b.m - a.m);
if (withM.length >= 4) {
  const fmt = k => `  ${k.m.toFixed(1).padStart(5)}  ${k.title} — ${k.artist} (${k.source})`;
  console.log('\nPiste la plus animée :'); withM.slice(0, 5).forEach(k => console.log(fmt(k)));
  console.log('Piste la plus calme :'); withM.slice(-5).reverse().forEach(k => console.log(fmt(k)));
  const bySrc = {}; withM.forEach(k => (bySrc[k.source] = bySrc[k.source] || []).push(k.m));
  console.log('Mouvement moyen par source :', Object.entries(bySrc).map(([s, a]) => `${s} ${avg(a).toFixed(1)} (${a.length})`).join(' · '));
}
const skipped = tracks.filter(k => k.end === 'skip' || k.end === 'camera');
if (skipped.length) { console.log('\nTitres coupés avant la fin :'); skipped.forEach(k => console.log(`  ${mmss(k.elapsed)}  ${k.title} — ${k.artist} (${k.end})`)); }
console.log('\nNote : le mouvement est une mesure relative (0 à 100) prise sur l\'image de la caméra, pas un nombre de personnes.');
