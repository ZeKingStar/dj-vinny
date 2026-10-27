// Construit le ZIP de la version gratuite : node installateur/construire.js
// Assemble le code suivi par git (sans sounds/*.mp3), node_modules de production, Node portable, ffmpeg (LGPL) et les avis de licence.
// Résultat : installateur/sortie/DJ-Vinny-<version>-windows.zip. Téléchargements gardés dans installateur/cache/.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const CACHE = path.join(__dirname, 'cache');
const SORTIE = path.join(__dirname, 'sortie');
const NODE_VERSION = 'v24.20.0';
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`;
const FFMPEG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip'; // build LGPL : redistribuable avec son avis
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar'; // bsdtar lit et écrit les .zip

const version = require(path.join(RACINE, 'package.json')).version;
const nom = 'DJ Vinny';
const rm = p => fs.rmSync(p, { recursive: true, force: true });

async function telecharger(url) {
  const fichier = path.join(CACHE, path.basename(url));
  if (fs.existsSync(fichier)) return fichier;
  fs.mkdirSync(CACHE, { recursive: true });
  console.log('Téléchargement', url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} : ${r.status}`);
  fs.writeFileSync(fichier + '.part', Buffer.from(await r.arrayBuffer()));
  fs.renameSync(fichier + '.part', fichier);
  return fichier;
}
function extraire(zip, dest) {
  rm(dest); fs.mkdirSync(dest, { recursive: true });
  execFileSync(TAR, ['-xf', zip, '-C', dest], { stdio: 'inherit' });
  const [sous] = fs.readdirSync(dest); // les deux archives ont un dossier racine unique
  return path.join(dest, sous);
}

const LISEZ_MOI = `DJ Vinny : démarrage en 3 étapes

1. Décompressez ce dossier (clic droit, « Extraire tout »), par exemple sur le Bureau.
2. Ouvrez le dossier, puis double-cliquez sur « Demarrer DJ Vinny ».
3. Au premier démarrage, une page de bienvenue vous guide : mot de passe de l'hôte et Client ID Spotify.

Rien à installer. Les avis de licence de Node.js et de ffmpeg sont dans le dossier « licences ».
Pour ajouter vos propres sons, voir sounds/LICENCES.md.
`;

const AVIS = `Logiciels tiers inclus dans ce dossier

DJ Vinny : licence PolyForm Noncommercial 1.0.0 (fichier LICENSE à la racine).

Node.js ${NODE_VERSION} (outils/node) : licence MIT et licences de ses composants, texte dans licences/node-LICENSE.
  Code source : https://github.com/nodejs/node

ffmpeg (outils/ffmpeg) : build « lgpl » de BtbN, sous GNU LGPL version 2.1 ou plus récente, texte dans licences/ffmpeg-LICENSE.txt.
  Programme séparé, lancé comme commande ; il n'est pas lié à DJ Vinny. Vous pouvez le remplacer par votre propre ffmpeg.
  Code source et scripts de construction : https://github.com/BtbN/FFmpeg-Builds et https://ffmpeg.org/download.html
  Voir https://ffmpeg.org/legal.html

Modules npm (node_modules) : express, jsonwebtoken, qrcode et leurs dépendances, chacun avec sa licence dans son dossier.
`;

(async () => {
  const [zipNode, zipFfmpeg] = [await telecharger(NODE_URL), await telecharger(FFMPEG_URL)];
  const tmp = path.join(CACHE, 'assemblage');
  const dossier = path.join(tmp, nom);
  rm(tmp); fs.mkdirSync(dossier, { recursive: true });

  // 1. Code : les fichiers suivis par git, tels qu'ils sont sur le disque (sans installateur/ ni sounds/*.mp3, qui n'est pas suivi)
  const fichiers = execFileSync('git', ['ls-files', '-z'], { cwd: RACINE, encoding: 'utf8', maxBuffer: 1e8 }).split('\0')
    .filter(f => f && !f.startsWith('installateur/') && f !== '.gitattributes');
  for (const f of fichiers) {
    const dest = path.join(dossier, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(RACINE, f), dest);
  }

  // 2. Modules de production
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: dossier, stdio: 'inherit', shell: process.platform === 'win32' });

  // 3. Node portable et ffmpeg
  const node = extraire(zipNode, path.join(tmp, 'node'));
  const ffmpeg = extraire(zipFfmpeg, path.join(tmp, 'ffmpeg'));
  fs.mkdirSync(path.join(dossier, 'outils', 'node'), { recursive: true });
  fs.mkdirSync(path.join(dossier, 'outils', 'ffmpeg'), { recursive: true });
  fs.copyFileSync(path.join(node, 'node.exe'), path.join(dossier, 'outils', 'node', 'node.exe'));
  fs.copyFileSync(path.join(ffmpeg, 'bin', 'ffmpeg.exe'), path.join(dossier, 'outils', 'ffmpeg', 'ffmpeg.exe'));

  // 4. Avis de licence et mode d'emploi
  fs.mkdirSync(path.join(dossier, 'licences'));
  fs.copyFileSync(path.join(node, 'LICENSE'), path.join(dossier, 'licences', 'node-LICENSE'));
  const licFfmpeg = ['LICENSE.txt', 'LICENSE'].map(n => path.join(ffmpeg, n)).find(fs.existsSync);
  if (!licFfmpeg) throw new Error('Licence de ffmpeg introuvable dans l\'archive');
  fs.copyFileSync(licFfmpeg, path.join(dossier, 'licences', 'ffmpeg-LICENSE.txt'));
  fs.writeFileSync(path.join(dossier, 'licences', 'LISEZ-MOI.txt'), AVIS);
  fs.writeFileSync(path.join(dossier, 'LISEZ-MOI.txt'), LISEZ_MOI);

  // 5. ZIP
  fs.mkdirSync(SORTIE, { recursive: true });
  const zip = path.join(SORTIE, `DJ-Vinny-${version}-windows.zip`);
  rm(zip);
  execFileSync(TAR, ['-a', '-c', '-f', zip, '-C', tmp, nom], { stdio: 'inherit' });
  rm(tmp);
  console.log(`ZIP prêt : ${zip} (${(fs.statSync(zip).size / 1048576).toFixed(0)} Mo)`);
})().catch(e => { console.error(e); process.exit(1); });
