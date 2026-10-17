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
