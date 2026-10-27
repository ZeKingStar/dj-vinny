// Point d'entrée du ZIP : ffmpeg inclus dans le PATH, .env lu (ou créé par la page /bienvenue), puis server.js.
const fs = require('fs');
const path = require('path');

const ENV = path.join(__dirname, '.env');
const ffmpegDir = path.join(__dirname, 'outils', 'ffmpeg');
if (fs.existsSync(ffmpegDir)) process.env.PATH = ffmpegDir + path.delimiter + process.env.PATH;

(async () => {
  if (!fs.existsSync(ENV)) await require('./bienvenue').configurer(ENV, process.env.PORT || 3000);
  process.loadEnvFile(ENV);
  require('./server.js');
})().catch(e => { console.error(e); process.exit(1); });
