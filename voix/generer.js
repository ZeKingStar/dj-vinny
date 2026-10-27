// Génère les clips de voix de la version gratuite (voix/<langue>/<intensité>-<catégorie>-<n>.mp3) à partir de announce/<langue>.json.
// Seules les phrases sans {title} {artist} {name} sont produites. Clé OpenRouter lue dans l'environnement, jamais enregistrée.
//   node --env-file=.env voix/generer.js [fr|en] [--force]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error('OPENROUTER_API_KEY manquant'); process.exit(1); }
const force = process.argv.includes('--force'), only = process.argv.find(a => /^(fr|en)$/.test(a));
const REVERB = [0.32, 0.28, 0.24, 0.2, 0.15, 0.1];
const filter = c => [c.tempo && c.tempo !== 1 && `atempo=${c.tempo}`, 'highpass=f=90', c.presence > 0 && `equalizer=f=3500:t=q:w=1.1:g=${c.presence}`,
  `acompressor=threshold=-20dB:ratio=${c.ratio || 2}:attack=8:release=120:makeup=2`, c.reverb > 0 && `aecho=0.85:0.9:19|37|53|79|109|151:${REVERB.map(d => (d * c.reverb).toFixed(3)).join('|')}`, `loudnorm=I=${c.lufs}:TP=-1.5`].filter(Boolean).join(',');

(async () => {
  let made = 0;
  for (const lang of ['fr', 'en'].filter(l => !only || l === only)) {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'announce', lang + '.json'), 'utf8'));
    const dir = path.join(__dirname, lang); fs.mkdirSync(dir, { recursive: true });
    for (const intensity of ['party', 'calm']) {
      const c = cfg[intensity], g = (cfg.gratuit || {})[intensity] || {};
      const cats = { open: c.open, close: c.close, callout: c.callout, phase: [cfg.phases[intensity].jingle], anon: g.anon, plain: g.plain, line: g.line };
      for (const [cat, lines] of Object.entries(cats)) {
        const todo = (lines || []).filter(l => !/\{\w+\}/.test(l));
        for (const [i, text] of todo.entries()) {
          const out = path.join(dir, `${intensity}-${cat}-${i + 1}.mp3`);
          if (!force && fs.existsSync(out)) continue;
          const body = { model: cfg.model, input: text, voice: c.voice || cfg.voice, response_format: 'mp3', provider: { options: { elevenlabs: { language_code: lang, ...(c.voiceSettings && { voice_settings: c.voiceSettings }) } } } };
          const r = await fetch('https://openrouter.ai/api/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
          if (!r.ok) { console.error(`${lang}/${path.basename(out)} : ${r.status} ${await r.text()}`); process.exit(1); }
          const raw = out + '.raw'; fs.writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
          execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af', filter(c), '-ar', '44100', '-b:a', '160k', out]);
          fs.unlinkSync(raw); made++; console.log(path.relative(__dirname, out), '←', text.slice(0, 60));
        }
      }
    }
  }
  console.log(made + ' clip(s) générés.');
})();
