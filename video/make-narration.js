// Génère la narration (ElevenLabs v4 Turbo, voix Liam, via OpenRouter), normalise le volume,
// et calcule l'enveloppe sonore par scène (pour animer la bouche de la mascotte).
//   node make-narration.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SCENES = [
  "[excited] Salut la gang ! Moi, c'est DJ Vinny, votre animateur de soirée. Je joue la musique, je prends les demandes et je mets le feu à la piste !",
  "Vous branchez l'ordinateur aux haut-parleurs, vous connectez Spotify Premium, puis vous appuyez sur Démarrer la soirée. Moi, je m'occupe du reste.",
  "Vos invités scannent le code QR, cherchent leur toune et la demandent. Pas d'application, pas de compte, et un code secret garde ça entre vous.",
  "Chaque demande se place dans la file, avec les prochaines tounes de l'autopilote que vous pouvez réorganiser. Et moi, j'annonce la chanson avec le nom de la personne qui l'a demandée.",
  "Programmez le souper tout en douceur, puis la soirée dansante, avec des jingles, la danse en ligne, des fondus et des beats entre les tounes.",
  "Quand personne ne demande rien, je prends le relais avec une liste pour tous les âges. Je retiens ce qui fait danser votre monde, et je rappelle le code QR au bon moment.",
  "Le second écran affiche la chanson, les prochaines demandes, un égaliseur et des confettis, pour que tout le monde participe.",
  "Après la soirée, je garde un journal pour qu'on s'améliore ensemble.",
  "[excited] DJ Vinny : branchez, scannez, dansez !",
];

const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error('OPENROUTER_API_KEY manquante'); process.exit(1); }
const out = path.join(__dirname, 'assets');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const meta = [];
  for (let i = 0; i < SCENES.length; i++) {
    const n = String(i + 1).padStart(2, '0'), raw = path.join(out, `narr_${n}_brut.mp3`), fin = path.join(out, `narr_${n}.mp3`);
    if (!fs.existsSync(raw)) {
      const r = await fetch('https://openrouter.ai/api/v1/audio/speech', {
        method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'elevenlabs/eleven-v4-turbo', voice: 'liam', input: SCENES[i], response_format: 'mp3',
          provider: { options: { elevenlabs: { language_code: 'fr' } } } }),
      });
      if (!r.ok) throw new Error(`TTS scène ${n} : ${r.status} ${await r.text()}`);
      fs.writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
    }
    // volume homogène, légère compression ; pas de reverb (c'est une narration, pas une annonce de piste)
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af',
      'highpass=f=90,acompressor=threshold=-22dB:ratio=3:attack=5:release=80:makeup=3,loudnorm=I=-16:TP=-1.5', '-ar', '44100', '-ac', '1', '-b:a', '160k', fin]);
    const dur = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fin], { encoding: 'utf8' });
    // enveloppe : RMS par tranche de 60 ms (0 à 1) pour la bouche de la mascotte
    const pcm = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', fin, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 1e8 });
    const step = Math.round(8000 * 0.06), env = [];
    for (let s = 0; s + step <= pcm.length / 2; s += step) {
      let sum = 0; for (let k = 0; k < step; k++) { const v = pcm.readInt16LE((s + k) * 2) / 32768; sum += v * v; }
      env.push(Math.sqrt(sum / step));
    }
    const peak = Math.max(...env, 0.001);
    meta.push({ n, text: SCENES[i].replace(/\[[^\]]*\]\s*/g, ''), duration: dur, env: env.map(v => Math.round(Math.min(1, v / peak * 1.4) * 100) / 100) });
    console.log(`scène ${n} : ${dur.toFixed(2)} s`);
  }
  fs.writeFileSync(path.join(__dirname, 'narration.json'), JSON.stringify(meta));
  console.log('total :', meta.reduce((a, m) => a + m.duration, 0).toFixed(1), 's');
})().catch(e => { console.error(e.message); process.exit(1); });
