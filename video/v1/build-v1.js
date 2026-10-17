// Génère index.html (composition HyperFrames) à partir de narration.json.
//   node build.js && npx hyperframes check && npx hyperframes render --output dj-app.mp4
const fs = require('fs');
const N = JSON.parse(fs.readFileSync(__dirname + '/narration.json', 'utf8'));
const LEAD = 0.5, TAIL = 0.7;
let t = 0;
const S = N.map(n => { const d = n.duration + LEAD + TAIL; const o = { start: t, dur: d, narr: t + LEAD, n: n.n, text: n.text, env: n.env }; t += d; return o; });
const TOTAL = Math.round(t * 100) / 100;
const f2 = x => Math.round(x * 100) / 100;

// générateur pseudo-aléatoire (graine fixe : le rendu est identique à chaque fois)
let seed = 7; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let z = Math.imul(seed ^ seed >>> 15, 1 | seed); z = z + Math.imul(z ^ z >>> 7, 61 | z) ^ z; return ((z ^ z >>> 14) >>> 0) / 4294967296; };

const PINK = '#FF4F7B', YEL = '#FFD23F', MINT = '#38E1B0', VIO = '#7A5CFF', INK = '#15102E', CARD = '#221A47', LINE = '#3A2F6B', CREAM = '#FFF6E5', MUTED = '#B3A9D9';

// faux QR (motif fixe, 25 x 25 modules)
function qr(size, id) {
  const n = 25, m = size / n; let r = '';
  const finder = (x, y) => `<rect x="${x * m}" y="${y * m}" width="${7 * m}" height="${7 * m}" fill="${INK}"/><rect x="${(x + 1) * m}" y="${(y + 1) * m}" width="${5 * m}" height="${5 * m}" fill="#fff"/><rect x="${(x + 2) * m}" y="${(y + 2) * m}" width="${3 * m}" height="${3 * m}" fill="${INK}"/>`;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const inF = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
    if (!inF && rnd() > 0.52) r += `<rect x="${x * m}" y="${y * m}" width="${m}" height="${m}" fill="${INK}"/>`;
  }
  return `<svg id="${id}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="background:#fff;border-radius:${size * 0.06}px"><rect width="${size}" height="${size}" fill="#fff"/>${r}${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}</svg>`;
}

const cover = (c, s = 64) => `<div style="width:${s}px;height:${s}px;border-radius:${s * 0.2}px;flex:none;background:radial-gradient(circle,${INK} 0 9%,transparent 10%),repeating-radial-gradient(circle,rgba(21,16,46,.28) 0 2px,transparent 2px 7px),${c}"></div>`;
const row = (id, title, artist, c, tag) => `<div id="${id}" class="row"><div style="display:flex;gap:18px;align-items:center;min-width:0">${cover(c)}<div style="min-width:0"><b>${title}</b><span>${artist}</span></div></div>${tag ? `<em>${tag}</em>` : ''}</div>`;

// ---------------------------------------------------------------- mascotte
const VINNY = `<div id="vinny"><svg viewBox="-150 -135 300 290" width="300" height="290">
  <ellipse cx="-36" cy="136" rx="28" ry="12" fill="${CREAM}"/><ellipse cx="36" cy="136" rx="28" ry="12" fill="${CREAM}"/>
  <g id="vBody">
    <path d="M -96 40 Q -128 62 -124 94" stroke="${CREAM}" stroke-width="13" stroke-linecap="round" fill="none"/><circle cx="-124" cy="98" r="14" fill="${CREAM}"/>
    <g id="vArm"><path d="M 96 40 Q 132 22 130 -20" stroke="${CREAM}" stroke-width="13" stroke-linecap="round" fill="none"/><circle cx="130" cy="-24" r="15" fill="${CREAM}"/></g>
    <g id="vSpin"><circle r="102" fill="#0e0a24"/><circle r="90" fill="none" stroke="#2c2354" stroke-width="2.5"/><circle r="80" fill="none" stroke="#2c2354" stroke-width="2.5"/><circle r="70" fill="none" stroke="#2c2354" stroke-width="2.5"/>
      <path d="M -74 -52 A 90 90 0 0 1 -24 -88" stroke="rgba(255,255,255,.28)" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M 70 62 A 90 90 0 0 1 28 86" stroke="rgba(255,255,255,.18)" stroke-width="5" fill="none" stroke-linecap="round"/></g>
    <circle r="62" fill="${YEL}"/><circle r="62" fill="none" stroke="${PINK}" stroke-width="5"/>
    <circle cx="-38" cy="16" r="8" fill="${PINK}" opacity=".5"/><circle cx="38" cy="16" r="8" fill="${PINK}" opacity=".5"/>
    <g id="vEyes"><circle cx="-22" cy="-10" r="12" fill="#fff"/><circle cx="22" cy="-10" r="12" fill="#fff"/><circle cx="-20" cy="-8" r="6" fill="${INK}"/><circle cx="24" cy="-8" r="6" fill="${INK}"/></g>
    <path id="vSmile" d="M -20 14 Q 0 34 20 14" stroke="${INK}" stroke-width="5.5" fill="none" stroke-linecap="round"/>
    <ellipse id="vMouth" cx="0" cy="24" rx="15" ry="13" fill="${INK}"/>
    <path d="M -102 -8 A 102 102 0 0 1 102 -8" fill="none" stroke="${PINK}" stroke-width="13" stroke-linecap="round"/>
    <rect x="-120" y="-32" width="32" height="64" rx="15" fill="${PINK}"/><rect x="88" y="-32" width="32" height="64" rx="15" fill="${PINK}"/>
    <rect x="-114" y="-22" width="14" height="44" rx="7" fill="#c93a5e"/><rect x="100" y="-22" width="14" height="44" rx="7" fill="#c93a5e"/>
  </g></svg></div>`;

// ---------------------------------------------------------------- scènes (HTML)
const sub = (i) => `<div class="sub">${S[i].text}</div>`;
const conf = (n, cls) => Array.from({ length: n }, (_, k) => { const c = [PINK, YEL, MINT, VIO, CREAM][k % 5], sh = rnd() > 0.5; return `<i class="cf ${cls}" style="left:${Math.round(rnd() * 1840 + 40)}px;top:${Math.round(rnd() * 700 + 40)}px;width:${sh ? 16 : 12}px;height:${sh ? 16 : 28}px;border-radius:${sh ? '50%' : '4px'};background:${c}"></i>`; }).join('');

const HTML = {
  1: `<div class="center" style="left:120px;top:250px;width:1050px">
        <div id="s1t" class="big">DJ App</div>
        <div id="s1s" class="tag1">Votre discothèque intelligente</div>
        <div style="display:flex;gap:20px;margin-top:46px">
          <span id="s1c1" class="chip" style="background:${PINK}">Musique</span><span id="s1c2" class="chip" style="background:${YEL}">Demandes</span><span id="s1c3" class="chip" style="background:${MINT}">Animation</span>
        </div></div>${conf(14, 'cf1')}`,
  2: `<div id="s2lap" class="laptop"><div class="lscreen">
          <div style="display:flex;align-items:center;gap:16px"><div class="logo"></div><b style="font:800 40px 'Bricolage Grotesque'">Dashboard</b><span style="flex:1"></span>
            <div id="s2btn" class="btn" style="background:${YEL}">Connecter Spotify</div><div id="s2ok" class="btn" style="background:${MINT};opacity:0;position:absolute;right:46px;top:44px">Spotify connecté</div></div>
          <div class="card" style="margin-top:34px;display:flex;gap:26px;align-items:center;padding:26px">${cover(PINK, 132)}<div><div class="lbl">EN LECTURE</div><b style="font:800 52px 'Bricolage Grotesque'">Dancing Queen</b><div style="font-size:30px;color:${MUTED}">ABBA</div></div></div>
          <div style="display:flex;gap:20px;margin-top:26px"><div class="card" style="flex:1;height:120px"></div><div class="card" style="flex:1;height:120px"></div></div>
        </div><div class="lbase"></div></div>
      <div id="s2st1" class="step"><span class="num" style="background:${YEL}">1</span>Branchez l'ordinateur aux haut-parleurs</div>
      <div id="s2st2" class="step" style="top:400px"><span class="num" style="background:${MINT}">2</span>Connectez votre compte Spotify Premium</div>
      <div id="s2st3" class="step" style="top:530px"><span class="num" style="background:${PINK}">3</span>Un seul onglet ouvert : c'est prêt</div>`,
  3: `<div id="s3ph" class="phone"><div class="pscreen">
          <div id="s3qr" style="position:absolute;left:0;right:0;top:120px;text-align:center">${qr(260, 's3qrsvg')}<div style="font:700 30px 'Figtree';margin-top:24px;color:${INK}">Scannez-moi</div></div>
          <div id="s3pg" style="position:absolute;inset:0;padding:70px 26px;background:${INK};opacity:0">
            <b style="font:800 52px/1 'Bricolage Grotesque';color:${CREAM}">Trouve<br>ta toune</b>
            <div class="inp" style="margin-top:34px">Dancing Queen</div>
            <div class="row" style="margin-top:22px;padding:14px"><div style="display:flex;gap:14px;align-items:center">${cover(VIO, 56)}<div><b style="font-size:26px">Dancing Queen</b><span style="font-size:20px">ABBA</span></div></div></div>
            <div id="s3ask" class="btn" style="margin-top:26px;background:${YEL};text-align:center;width:100%">Demander</div>
            <div id="s3done" class="btn" style="position:absolute;left:26px;right:26px;top:548px;background:${MINT};text-align:center;opacity:0">Ajouté</div>
          </div></div></div>
      <div id="s3arrow" class="arrow">→</div>
      <div id="s3scr" class="bigscreen">
          <div style="display:flex;gap:30px;align-items:center">${cover(PINK, 190)}<div><div class="lbl">EN LECTURE</div><b style="font:800 64px/1 'Bricolage Grotesque'">September</b><div style="font-size:30px;color:${MUTED}">Earth, Wind &amp; Fire</div></div></div>
          <div id="s3tick" class="ticker">Léa demande Dancing Queen</div></div>${conf(16, 'cf3')}`,
  4: `<div class="card" style="position:absolute;left:130px;top:130px;width:820px;padding:30px">
          <div class="lbl" style="margin-bottom:16px">FILE D'ATTENTE</div>
          <div style="position:relative;height:500px">
            <div id="s4r1" class="qrow" style="top:0">${row('s4a', 'September', 'Earth, Wind &amp; Fire', VIO, 'hôte')}</div>
            <div id="s4r2" class="qrow" style="top:128px">${row('s4b', 'Le Freak', 'Chic', MINT, 'hôte')}</div>
            <div id="s4r3" class="qrow" style="top:256px">${row('s4c', 'Dancing Queen', 'ABBA', PINK, 'invité · Léa')}</div>
            <div id="s4r4" class="qrow" style="top:384px">${row('s4d', 'Believe', 'Cher', YEL, 'hôte')}</div>
          </div></div>
      <div id="s4bub" class="bubble"><div id="s4bars" style="display:flex;gap:10px;align-items:center;height:130px;margin-bottom:26px">${Array.from({ length: 22 }, (_, k) => `<i id="s4b${k}" style="display:block;width:14px;height:130px;border-radius:7px;background:${k % 3 === 0 ? PINK : k % 3 === 1 ? YEL : MINT}"></i>`).join('')}</div>
          <div style="font:700 38px/1.3 'Figtree';color:${CREAM}">« Et maintenant, une demande spéciale de Léa ! Dancing Queen, d'ABBA ! »</div></div>`,
  5: `<div id="s5glowY" class="glow" style="background:${YEL}"></div><div id="s5glowP" class="glow" style="background:${PINK};opacity:0"></div>
      <div id="s5cardL" class="card pcard" style="left:150px;border-color:${YEL}"><div class="chip" style="background:${YEL}">Souper</div><div class="pl">Musique douce<br>Voix sobre<br>Demandes fermées</div></div>
      <div id="s5cardR" class="card pcard" style="left:1010px;border-color:${PINK}"><div class="chip" style="background:${PINK}">Soirée dansante</div><div class="pl">Jingles et applaudissements<br>Danse en ligne<br>Demandes ouvertes</div></div>
      <div id="s5bar" style="position:absolute;left:160px;top:640px;width:1600px;height:34px;border-radius:17px;background:${LINE};overflow:hidden">
        <div id="s5fillY" style="position:absolute;left:0;top:0;height:34px;width:800px;background:${YEL}"></div><div id="s5fillP" style="position:absolute;left:800px;top:0;height:34px;width:800px;background:${PINK}"></div></div>
      <div class="tm" style="left:160px">19 h</div><div class="tm" style="left:960px">22 h</div><div class="tm" style="left:1760px">1 h</div>`,
  6: `<div class="card" style="position:absolute;left:120px;top:120px;width:760px;padding:30px">
          <div class="lbl" style="margin-bottom:12px">SOIRÉE 40+ · LISTE COMMENTÉE</div>
          ${['September · Earth, Wind &amp; Fire', 'Dégénération · Mes Aïeux', 'Dancing Queen · ABBA', 'Boot Scootin\' Boogie · Brooks &amp; Dunn', 'Alors on danse · Stromae'].map((x, k) => `<div id="s6l${k}" class="line"><span>${x}</span><b class="ck">✓</b></div>`).join('')}
          <div style="display:flex;gap:14px;margin-top:22px;flex-wrap:wrap"><span id="s6t1" class="chip" style="background:${YEL}">27 % francophone</span><span id="s6t2" class="chip" style="background:${PINK}">17 % québécois</span><span id="s6t3" class="chip" style="background:${MINT}">Danse en ligne</span></div></div>
      <div id="s6dance" class="btn big2" style="left:1000px;top:150px;background:${PINK}">Ça danse</div>
      <div id="s6learn" class="lab2" style="left:1000px;top:262px">L'autopilote apprend de vos « Ça danse »</div>
      <div class="card" style="position:absolute;left:1000px;top:420px;width:780px;padding:34px;display:flex;gap:40px;align-items:center">
        <div style="text-align:center"><div id="s6cnt" style="position:relative;width:230px;height:150px;font:800 150px/1 'Bricolage Grotesque';color:${YEL}">${Array.from({ length: 11 }, (_, k) => `<span id="s6n${k}" style="position:absolute;left:0;right:0;top:0;opacity:${k ? 0 : 1}">${k}</span>`).join('')}</div><div class="lbl" style="margin-top:12px">chansons sans demande</div></div>
        <div style="flex:1"><div style="height:26px;border-radius:13px;background:${LINE};overflow:hidden"><div id="s6prog" style="width:100%;height:26px;background:${PINK};transform-origin:left"></div></div>
          <div id="s6call" style="margin-top:30px;opacity:0;display:flex;gap:24px;align-items:center">${qr(150, 's6qr')}<b style="font:800 40px/1.1 'Bricolage Grotesque'">Une demande spéciale ?</b></div></div></div>`,
  7: `<div id="s7scr" class="bigscreen" style="left:200px;top:90px;width:1520px;height:770px;padding:50px;display:grid;grid-template-columns:1.3fr 1fr;gap:50px;align-content:start">
          <div><div style="display:flex;gap:34px;align-items:center">${cover(PINK, 270)}<div><div class="lbl">EN LECTURE</div><b style="font:800 78px/1 'Bricolage Grotesque'">Dancing Queen</b><div style="font-size:38px;color:${MUTED}">ABBA</div><div class="by">demandé par Léa</div></div></div>
            <div id="s7rib" class="ribbon">DANSE EN LIGNE</div></div>
          <div><div class="card" style="display:flex;gap:24px;align-items:center;padding:24px">${qr(180, 's7qr')}<b style="font:800 40px/1.1 'Bricolage Grotesque'">Demande ta chanson !</b></div>
            <div class="card" style="margin-top:26px;padding:24px"><div class="lbl">À SUIVRE</div><div class="line"><span>September</span></div><div class="line"><span>Le Freak</span></div><div class="line"><span>Footloose</span></div></div></div>
        </div>
      <div id="s7ov" class="overlay"><b style="font:800 100px/1 'Bricolage Grotesque'">Une demande spéciale ?</b>${qr(360, 's7qr2')}</div>`,
  8: `<div class="center" style="left:0;width:1920px;top:170px;text-align:center">
          <div style="display:flex;gap:46px;justify-content:center"><span id="s8w1" class="w8" style="color:${YEL}">Branchez.</span><span id="s8w2" class="w8" style="color:${PINK}">Scannez.</span><span id="s8w3" class="w8" style="color:${MINT}">Dansez.</span></div>
          <div id="s8logo" class="big" style="font-size:150px;margin-top:70px">DJ App</div></div>${conf(30, 'cf8')}`,
};

const scenes = S.map((s, i) => `<section id="scene${i + 1}" class="clip scene" data-start="${f2(s.start)}" data-duration="${f2(s.dur)}" data-track-index="1">${HTML[i + 1]}${sub(i)}</section>`).join('\n');
const audios = S.map((s, i) => `<audio id="narr${i + 1}" src="assets/narr_${s.n}.mp3" data-start="${f2(s.narr)}" data-duration="${f2(N[i].duration)}" data-volume="1"></audio>`).join('\n');

// ---------------------------------------------------------------- animation (GSAP)
const A = `
const S = ${JSON.stringify(S.map(s => ({ start: f2(s.start), dur: f2(s.dur), narr: f2(s.narr), env: s.env })))};
const TOTAL = ${TOTAL};
const tl = gsap.timeline({ paused: true });
const at = (i, x) => S[i].start + x;
const pop = (sel, i, x, o) => tl.from(sel, Object.assign({ opacity: 0, scale: 0.6, duration: 0.5, ease: 'back.out(1.7)' }, o || {}), at(i, x));
const rise = (sel, i, x, o) => tl.from(sel, Object.assign({ opacity: 0, y: 50, duration: 0.55, ease: 'power3.out' }, o || {}), at(i, x));

// fond : halos lents
tl.fromTo('#glow1', { x: 0, y: 0 }, { x: 260, y: 120, duration: TOTAL, ease: 'none' }, 0);
tl.fromTo('#glow2', { x: 0, y: 0 }, { x: -240, y: -140, duration: TOTAL, ease: 'none' }, 0);

// scènes : fondus d'entrée et de sortie
S.forEach((s, i) => {
  tl.fromTo('#scene' + (i + 1), { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'power1.out' }, s.start);
  if (i < S.length - 1) tl.to('#scene' + (i + 1), { opacity: 0, duration: 0.3, ease: 'power1.in' }, s.start + s.dur - 0.3);
  tl.from('#scene' + (i + 1) + ' .sub', { opacity: 0, y: 20, duration: 0.4 }, s.start + 0.45);
});

// ---- mascotte : positions par scène, rebond, clin d'œil, bouche liée à la voix
const V = [ // x, y (centre), échelle, rotation
  [1430, 520, 1.55, -6], [1610, 760, 0.78, 6], [760, 790, 0.6, 8], [1640, 760, 0.78, 6],
  [160, 540, 0.6, 0], [1500, 750, 0.55, -6], [1830, 700, 0.5, 0], [960, 750, 0.8, 0],
];
gsap.set('#vinny', { x: V[0][0] - 150, y: V[0][1] - 145, scale: V[0][2], rotation: V[0][3], transformOrigin: '50% 50%' });
V.forEach((v, i) => { if (i) tl.to('#vinny', { x: v[0] - 150, y: v[1] - 145, scale: v[2], rotation: v[3], duration: 0.8, ease: 'power3.inOut' }, S[i].start - 0.1); });
tl.from('#vinny', { scale: 0.01, opacity: 0, duration: 0.7, ease: 'back.out(2)' }, 0.1);
tl.to('#vSpin', { rotation: 360 * 9, duration: TOTAL, ease: 'none', transformOrigin: '50% 50%' }, 0);
for (let b = 0; b * 0.35 < TOTAL; b++) tl.to('#vBody', { y: b % 2 ? 0 : -14, duration: 0.35, ease: 'sine.inOut' }, b * 0.35);
for (let k = 0; k * 3.1 + 1.5 < TOTAL; k++) { const x = k * 3.1 + 1.5; tl.to('#vEyes', { scaleY: 0.1, duration: 0.08, transformOrigin: '50% 50%' }, x).to('#vEyes', { scaleY: 1, duration: 0.1 }, x + 0.1); }
for (let k = 0; k * 2.4 < TOTAL; k++) tl.to('#vArm', { rotation: k % 2 ? 14 : -22, duration: 0.6, ease: 'sine.inOut', svgOrigin: '96 40' }, k * 2.4);
gsap.set('#vMouth', { scaleY: 0, transformOrigin: '50% 50%' });
S.forEach(s => {
  let prev = -1;
  s.env.forEach((v, k) => { const q = v < 0.14 ? 0 : v < 0.38 ? 0.35 : v < 0.68 ? 0.7 : 1; if (q !== prev) { tl.set('#vMouth', { scaleY: q }, s.narr + k * 0.06); tl.set('#vSmile', { opacity: q ? 0 : 1 }, s.narr + k * 0.06); prev = q; } });
});

// ---- scène 1
rise('#s1t', 0, 0.5, { duration: 0.8 }); rise('#s1s', 0, 1.1);
pop('#s1c1', 0, 2.2); pop('#s1c2', 0, 2.8); pop('#s1c3', 0, 3.4);
tl.from('.cf1', { opacity: 0, scale: 0, y: -60, duration: 0.6, stagger: 0.08, ease: 'back.out(2)' }, at(0, 1.0));

// ---- scène 2
tl.from('#s2lap', { opacity: 0, x: -120, duration: 0.7, ease: 'power3.out' }, at(1, 0.5));
tl.to('#s2btn', { opacity: 0, duration: 0.2 }, at(1, 4.2)); tl.to('#s2ok', { opacity: 1, scale: 1.08, duration: 0.3, ease: 'back.out(2)' }, at(1, 4.25));
rise('#s2st1', 1, 1.6, { x: 80, y: 0 }); rise('#s2st2', 1, 3.6, { x: 80, y: 0 }); rise('#s2st3', 1, 5.8, { x: 80, y: 0 });

// ---- scène 3
tl.from('#s3ph', { opacity: 0, y: 160, duration: 0.7, ease: 'power3.out' }, at(2, 0.4));
tl.to('#s3qr', { opacity: 0, duration: 0.2 }, at(2, 2.0)); tl.to('#s3pg', { opacity: 1, duration: 0.3 }, at(2, 2.0));
tl.to('#s3ask', { scale: 0.92, duration: 0.12, yoyo: true, repeat: 1 }, at(2, 4.1)); tl.to('#s3done', { opacity: 1, duration: 0.2 }, at(2, 4.35));
tl.from('#s3arrow', { opacity: 0, x: -40, duration: 0.5 }, at(2, 4.5));
tl.from('#s3scr', { opacity: 0, x: 120, duration: 0.7, ease: 'power3.out' }, at(2, 4.6));
tl.from('#s3tick', { opacity: 0, y: 80, duration: 0.5, ease: 'back.out(2)' }, at(2, 5.4));
tl.from('.cf3', { opacity: 0, scale: 0, duration: 0.5, stagger: 0.05 }, at(2, 5.5));

// ---- scène 4
['#s4r1', '#s4r2', '#s4r3', '#s4r4'].forEach((id, k) => rise(id, 3, 0.5 + k * 0.25, { x: -80, y: 0 }));
tl.to('#s4r3', { y: -256, duration: 0.7, ease: 'power3.inOut' }, at(3, 3.0));
tl.to('#s4r1', { y: 128, duration: 0.7, ease: 'power3.inOut' }, at(3, 3.0)); tl.to('#s4r2', { y: 128, duration: 0.7, ease: 'power3.inOut' }, at(3, 3.0));
tl.from('#s4bub', { opacity: 0, x: 100, duration: 0.7, ease: 'power3.out' }, at(3, 0.8));
S[3].env.forEach((v, k) => { if (k % 2) return; for (let b = 0; b < 22; b++) { const h = Math.max(0.12, Math.min(1, v * (0.55 + 0.45 * Math.abs(Math.sin(k * 0.9 + b * 1.7))))); tl.to('#s4b' + b, { scaleY: h, duration: 0.12, ease: 'none', transformOrigin: '50% 50%' }, S[3].narr + k * 0.06); } });

// ---- scène 5
rise('#s5cardL', 4, 0.5); rise('#s5cardR', 4, 2.0);
tl.from('#s5bar', { opacity: 0, scaleX: 0, transformOrigin: 'left', duration: 0.8, ease: 'power3.out' }, at(4, 0.3));
tl.from('.tm', { opacity: 0, duration: 0.4, stagger: 0.2 }, at(4, 0.9));
tl.fromTo('#vinny', { x: 160 - 150 }, { x: 1700 - 150, duration: S[4].dur - 2.2, ease: 'none', immediateRender: false }, at(4, 0.9));
tl.to('#s5glowY', { opacity: 0, duration: 0.8 }, at(4, 4.4)); tl.to('#s5glowP', { opacity: 0.55, duration: 0.8 }, at(4, 4.4));

// ---- scène 6
for (let k = 0; k < 5; k++) { rise('#s6l' + k, 5, 0.5 + k * 0.45, { x: -60, y: 0 }); tl.from('#s6l' + k + ' .ck', { scale: 0, duration: 0.3, ease: 'back.out(3)' }, at(5, 0.9 + k * 0.45)); }
pop('#s6t1', 5, 3.0); pop('#s6t2', 5, 3.3); pop('#s6t3', 5, 3.6);
rise('#s6dance', 5, 4.2, { x: 60, y: 0 }); tl.to('#s6dance', { scale: 1.1, duration: 0.2, yoyo: true, repeat: 1 }, at(5, 5.2)); rise('#s6learn', 5, 5.0, { x: 60, y: 0 });
gsap.set('#s6prog', { scaleX: 0, transformOrigin: 'left' });
for (let c = 1; c <= 10; c++) { tl.set('#s6n' + (c - 1), { opacity: 0 }, at(5, 5.6 + c * 0.38)); tl.set('#s6n' + c, { opacity: 1 }, at(5, 5.6 + c * 0.38)); tl.to('#s6prog', { scaleX: c / 10, duration: 0.3, transformOrigin: 'left' }, at(5, 5.6 + c * 0.38)); }
tl.to('#s6call', { opacity: 1, duration: 0.4 }, at(5, 9.5));

// ---- scène 7
tl.from('#s7scr', { opacity: 0, scale: 0.92, duration: 0.7, ease: 'power3.out' }, at(6, 0.4));
pop('#s7rib', 6, 2.0, { rotation: -6 });
tl.to('#s7ov', { opacity: 1, duration: 0.4 }, at(6, 3.6)); tl.to('#s7ov', { opacity: 0, duration: 0.4 }, at(6, 5.7));

// ---- scène 8
pop('#s8w1', 7, 0.5); pop('#s8w2', 7, 1.0); pop('#s8w3', 7, 1.5);
rise('#s8logo', 7, 2.2);
tl.from('.cf8', { opacity: 0, scale: 0, y: -80, duration: 0.7, stagger: 0.04, ease: 'back.out(2)' }, at(7, 1.5));

window.__timelines = window.__timelines || {};
window.__timelines['main'] = tl;
`;

// ---------------------------------------------------------------- page
const FONTS = fs.readFileSync(__dirname + '/assets/fonts/fonts.css', 'utf8').split('url(./').join('url(assets/fonts/').replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = `
${FONTS}
*{box-sizing:border-box;margin:0}
body{margin:0;background:${INK}}
#root{position:relative;width:1920px;height:1080px;overflow:hidden;background:${INK};color:${CREAM};font-family:'Figtree',sans-serif}
.glow{position:absolute;width:1200px;height:1200px;border-radius:50%;filter:blur(160px);opacity:.28}
#glow1{left:-400px;top:-500px;background:${VIO}} #glow2{right:-500px;bottom:-600px;background:${PINK}}
.scene{position:absolute;inset:0;overflow:hidden}
.card{background:${CARD};border:3px solid ${LINE};border-radius:30px}
.lbl{font:800 24px 'Figtree';letter-spacing:.18em;color:${MUTED}}
.chip{display:inline-block;padding:12px 30px;border-radius:999px;font:800 34px 'Figtree';color:${INK}}
.btn{display:inline-block;padding:16px 34px;border-radius:999px;font:800 32px 'Figtree';color:${INK};box-shadow:0 6px 0 rgba(0,0,0,.35)}
.big{font:800 250px/1 'Bricolage Grotesque';letter-spacing:-.03em}
.tag1{font:700 62px 'Figtree';color:${YEL};margin-top:10px}
.center{position:absolute}
.cf{position:absolute}
.sub{position:absolute;left:160px;right:160px;bottom:56px;text-align:center;font:600 40px/1.3 'Figtree';color:${CREAM};background:rgba(21,16,46,.78);border-radius:22px;padding:16px 30px}
.laptop{position:absolute;left:110px;top:120px;width:960px}
.lscreen{position:relative;width:960px;height:650px;background:${INK};border:14px solid #0b0820;border-radius:30px;padding:34px;outline:3px solid ${LINE}}
.lbase{width:1100px;height:26px;margin-left:-70px;background:#0b0820;border-radius:0 0 40px 40px}
.logo{width:64px;height:64px;border-radius:20px;background:${YEL};transform:rotate(-6deg)}
.step{position:absolute;left:1160px;top:270px;width:660px;font:700 38px/1.25 'Figtree';display:flex;gap:22px;align-items:center}
.num{display:inline-flex;width:70px;height:70px;border-radius:50%;align-items:center;justify-content:center;font:800 40px 'Bricolage Grotesque';color:${INK};flex:none}
.phone{position:absolute;left:210px;top:100px;width:430px;height:770px;background:#0b0820;border-radius:60px;padding:16px;outline:3px solid ${LINE}}
.pscreen{position:relative;width:398px;height:738px;background:#fff;border-radius:46px;overflow:hidden}
.inp{border:3px solid ${YEL};border-radius:18px;padding:18px 22px;font:700 28px 'Figtree';color:${CREAM}}
.row{display:flex;align-items:center;justify-content:space-between;gap:18px;background:${CARD};border:3px solid ${LINE};border-radius:22px;padding:16px 22px;height:112px}
.row b{display:block;font:800 32px 'Figtree';color:${CREAM};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row span{display:block;font:600 24px 'Figtree';color:${MUTED}}
.row em{font:800 22px 'Figtree';font-style:normal;color:${PINK};border:3px solid ${PINK};border-radius:999px;padding:4px 16px;white-space:nowrap}
.arrow{position:absolute;left:690px;top:430px;font:800 110px 'Figtree';color:${YEL}}
.bigscreen{position:absolute;left:790px;top:170px;width:1000px;height:560px;background:#0e0a24;border:14px solid #0b0820;border-radius:26px;outline:3px solid ${LINE};padding:50px;overflow:hidden}
.ticker{position:absolute;left:50%;bottom:34px;transform:translateX(-50%);background:${PINK};color:${INK};font:800 40px 'Bricolage Grotesque';padding:16px 44px;border-radius:999px;white-space:nowrap}
.qrow{position:absolute;left:0;right:0}
.bubble{position:absolute;left:1020px;top:150px;width:760px;background:${CARD};border:3px solid ${PINK};border-radius:40px;padding:44px}
.pcard{position:absolute;top:90px;width:760px;height:340px;padding:40px}.pl{font:700 38px/1.6 'Figtree';margin-top:22px}
.tm{position:absolute;top:700px;transform:translateX(-50%);font:800 40px 'Bricolage Grotesque';color:${CREAM}}
.line{display:flex;justify-content:space-between;align-items:center;padding:16px 4px;font:700 32px 'Figtree';border-top:3px solid ${LINE}}.ck{color:${MINT};font-size:36px}
.big2{position:absolute;font:800 52px 'Bricolage Grotesque';padding:22px 60px}
.lab2{position:absolute;font:700 36px 'Figtree';color:${MUTED};width:780px}
.by{display:inline-block;margin-top:14px;font:700 32px 'Figtree';padding:6px 26px;border-radius:999px;border:5px solid ${PINK};color:${PINK}}
.ribbon{display:inline-block;margin-top:34px;font:800 46px 'Bricolage Grotesque';letter-spacing:.12em;background:${PINK};color:${INK};padding:16px 46px;border-radius:999px}
.overlay{position:absolute;inset:0;background:rgba(21,16,46,.95);display:flex;flex-direction:column;gap:34px;align-items:center;justify-content:center;opacity:0}
.w8{font:800 130px 'Bricolage Grotesque';letter-spacing:-.02em}
.glow{z-index:0}.scene{z-index:5}#vinny{position:absolute;left:0;top:0;width:300px;height:290px;z-index:20}
`;

const html = `<!doctype html>
<html lang="fr"><head><meta charset="UTF-8"><title>DJ App : comment ça marche</title>
<script src="assets/gsap.min.js"></script>
<style>${CSS}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${TOTAL}" data-width="1920" data-height="1080">
<div id="glow1" class="glow"></div><div id="glow2" class="glow"></div>
${scenes}
<div id="vinnyWrap" class="clip" data-start="0" data-duration="${TOTAL}" data-track-index="2" style="position:absolute;inset:0;z-index:20;pointer-events:none">${VINNY}</div>
${audios}
<audio id="music" src="assets/music.mp3" data-start="0" data-duration="${TOTAL}" data-volume="0.55" data-fade-in="1.5" data-fade-out="3"></audio>
</div>
<script>${A}</script></body></html>`;
fs.writeFileSync(__dirname + '/index.html', html);
console.log('index.html écrit : ' + TOTAL + ' s, ' + S.length + ' scènes, ' + Math.round(html.length / 1024) + ' Ko');
