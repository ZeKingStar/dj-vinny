// Petites animations partagées (invités + dashboard)
function confetti(n = 40) {
  const cs = getComputedStyle(document.body);
  const colors = [cs.getPropertyValue('--accent').trim() || '#FFD23F', cs.getPropertyValue('--accent2').trim() || '#FF4F7B', '#38E1B0', '#7A5CFF', '#FFF6E5'];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = Math.random() * 0.4 + 's';
    c.style.animationDuration = 1.2 + Math.random() * 1.2 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3000);
  }
}
// Mode fête temporaire (30 s) : accélère toutes les animations, quelle que soit la période
let burstTimer;
function partyBurst(ms = 30000) {
  document.documentElement.classList.add('burst');
  clearTimeout(burstTimer);
  burstTimer = setTimeout(() => document.documentElement.classList.remove('burst'), ms);
}
function onFx(type) { if (type === 'confetti') confetti(70); if (type === 'party') { partyBurst(); confetti(40); } }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function applyTheme(theme) {
  // Un thème actif impose sa couleur ; sinon l'accent suit la période (jaune dîner / rose soirée)
  if (theme && theme.accent) document.documentElement.style.setProperty('--theme-accent', theme.accent);
  else document.documentElement.style.removeProperty('--theme-accent');
}

// Avis de fermeture automatique du serveur (dashboard et télécommande) : compte à rebours de 60 s et « Encore 1 h ».
// onClosed : appelé quand le serveur se ferme (ex. arrêter la musique du dashboard).
function shutdownBanner(es, onClosed) {
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9999;display:none;align-items:center;gap:12px;flex-wrap:wrap;justify-content:center;max-width:94vw;padding:12px 16px;border-radius:18px;background:#FF4F7B;color:#15102E;font:700 17px Figtree,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';
  bar.innerHTML = '<span></span><button style="min-height:48px;padding:0 18px;border-radius:14px;border:0;background:#15102E;color:#FFF6E5;font:800 17px Figtree,sans-serif;cursor:pointer"></button>';
  document.body.appendChild(bar);
  const txt = bar.querySelector('span'), btn = bar.querySelector('button');
  btn.textContent = t('h.shut.snooze');
  let tm = null;
  const hide = () => { clearInterval(tm); bar.style.display = 'none'; };
  btn.onclick = async () => {
    btn.disabled = true;
    try { const r = await fetch('/api/shutdown/snooze', { method: 'POST' }); if (r.ok) hide(); } finally { btn.disabled = false; }
  };
  es.addEventListener('shutdown', e => {
    const d = JSON.parse(e.data);
    if (d.until) { hide(); toast(t('h.shut.moved', { time: new Date(d.until).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })); return; }
    if (d.closed) { clearInterval(tm); txt.textContent = t('h.shut.closed'); btn.style.display = 'none'; bar.style.display = 'flex'; if (onClosed) onClosed(); return; }
    let left = d.left; btn.style.display = ''; bar.style.display = 'flex';
    const show = () => { txt.textContent = t('h.shut.left', { s: left }); };
    show(); clearInterval(tm); tm = setInterval(() => { left = Math.max(0, left - 1); show(); }, 1000);
  });
}
