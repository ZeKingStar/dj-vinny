// Rapprochement d'une entrée de liste (titre + artiste) avec les résultats d'une recherche Spotify.
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const BAD = /\b(karaoke|tribute|cover|covers|made famous|instrumental|originally performed|remix|live|version|8d|slowed|sped up|nightcore)\b/;

// version indésirable : le mot-clé figure dans le titre, l'album OU le nom de l'artiste (« Garth Brooks Tribute »)
const BAD_REMIX = /\b(karaoke|tribute|cover|covers|made famous|instrumental|originally performed|8d|slowed|sped up|nightcore)\b/; // pour les remixes voulus
const BAD_COVER = /\b(karaoke|8d|slowed|sped up|nightcore|originally performed|made famous)\b/; // reprises voulues (souper)
// mode : 'remix' | 'cover' | rien
const isBad = (name, artists, album, mode) => { const re = mode === 'cover' ? BAD_COVER : mode === 'remix' ? BAD_REMIX : BAD; return re.test(norm(name)) || re.test(norm(artists)) || re.test(norm(album)); };

// ok : titre et artiste concordent sur une version qui n'est ni karaoké, ni reprise, ni remix
// uncertain : artiste concordant et titre contenu (à vérifier par l'hôte) ; missing : rien de crédible
// entry.alt : noms d'artiste alternatifs (ex. « Les 3 Accords »)
function pickMatch(entry, cands) {
  const t = norm(entry.title);
  const artists = [entry.artist, ...(entry.alt || [])].map(norm);
  let uncertain = null;
  for (const c of cands || []) {
    const ct = norm(c.name), names = (c.artists || []).map(x => x.name).join(' '), ca = norm(names);
    const artistOk = artists.some(a => {
      const words = a.split(' ').filter(w => w.length > 1 && w !== 'and');
      return words.length ? words.every(w => ca.includes(w)) : ca.includes(a);
    });
    if (!artistOk) continue;
    const bad = isBad(c.name, names, c.album && c.album.name, entry.cover ? 'cover' : entry.remix ? 'remix' : null);
    if ((ct === t || ct.startsWith(t + ' ')) && !bad) return { c, status: 'ok' };
    if (!uncertain && ct.includes(t)) uncertain = { c, status: 'uncertain' };
  }
  return uncertain || { c: null, status: 'missing' };
}
module.exports = { norm, pickMatch, isBad };
