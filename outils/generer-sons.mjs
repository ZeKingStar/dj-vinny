// Génère des variantes de sons DJ avec ElevenLabs (Sound Effects) dans sounds/candidats/.
// Usage (PowerShell, là où ELEVENLABS_API_KEY est définie) : node outils/generer-sons.mjs [nom ...]
import fs from 'node:fs';
import path from 'node:path';
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('ELEVENLABS_API_KEY absente de cet environnement'); process.exit(1); }
const VARIANTES = 3;
const SONS = { // nom du jingle : [secondes, description]
  klaxon: [2.5, 'Loud DJ air horn blast, short double hit, club sound system, dry'],
  scratch: [2, 'Turntable DJ scratch, fast wicka wicka vinyl record scratching, crisp'],
  rewind: [2.5, 'DJ rewind, vinyl record pulled back and spinning backwards with tape stop, club'],
  roulement: [3, 'Snare drum roll building suspense then ending with a cymbal crash'],
  ovation: [4, 'Crowd cheering and applauding wildly at a party, energetic, whistles'],
  fanfare: [3, 'Triumphant brass fanfare, short, celebratory, party announcement'],
  riser: [3, 'Cinematic EDM riser building tension then a big impact hit'],
  cornet: [2.5, 'Party horn blowers and confetti pop, festive'],
};
const noms = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SONS);
const dir = path.join(import.meta.dirname, '..', 'sounds', 'candidats');
fs.mkdirSync(dir, { recursive: true });
for (const nom of noms) {
  const def = SONS[nom]; if (!def) { console.error('Inconnu :', nom); continue; }
  for (let i = 1; i <= VARIANTES; i++) {
    const r = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
      method: 'POST', headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: def[1], duration_seconds: def[0], prompt_influence: 0.5 }),
    });
    if (!r.ok) { console.error(nom, i, 'échec', r.status, (await r.text()).slice(0, 200)); if (r.status === 401 || r.status === 403 || r.status === 402) process.exit(1); continue; }
    const f = path.join(dir, `${nom}_${i}.mp3`);
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    console.log('ok', f);
  }
}
