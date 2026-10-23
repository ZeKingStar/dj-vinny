// Textes de l'interface : locales/fr.json et locales/en.json, servis avec ce code par /i18n.js (window.I18N).
// t('cle', { var }) dans le code ; dans le HTML : data-i18n (texte, aussi sur <title>), data-i18n-ph (placeholder), data-i18n-title, data-i18n-aria.
let LANG = 'fr';
function tIn(lang, key, v) { // texte dans une langue donnée (ex. courriel aux invités dans la langue de l'événement)
  const s = (I18N[lang] && I18N[lang][key]) ?? I18N.fr[key] ?? key;
  return v ? s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '') : s;
}
const t = (key, v) => tIn(LANG, key, v);
function applyI18n(root = document) {
  for (const [attr, set] of [['i18n', (el, s) => { el.textContent = s; }], ['i18nPh', (el, s) => { el.placeholder = s; }],
    ['i18nTitle', (el, s) => { el.title = s; }], ['i18nAria', (el, s) => { el.setAttribute('aria-label', s); }]]) {
    const sel = '[data-' + attr.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + ']';
    root.querySelectorAll(sel).forEach(el => set(el, t(el.dataset[attr])));
  }
}
// change la langue de la page ; renvoie true si elle a changé (la page refait alors son rendu)
function setLang(lang) {
  lang = I18N[lang] ? lang : 'fr';
  const changed = lang !== LANG; LANG = lang;
  if (changed || !setLang.done) { document.documentElement.lang = lang; applyI18n(); setLang.done = true; }
  return changed;
}
// Hôte (dashboard, télécommande, connexion) : langue du navigateur ; ?lang=en ou ?lang=fr la fixe pour ce navigateur
function hostLang() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (I18N[q]) localStorage.djLang = q;
    if (I18N[localStorage.djLang]) return localStorage.djLang;
  } catch {}
  return /^en/i.test(navigator.language || '') ? 'en' : 'fr';
}
const locale = () => (LANG === 'en' ? 'en-CA' : 'fr-CA'); // dates et heures
