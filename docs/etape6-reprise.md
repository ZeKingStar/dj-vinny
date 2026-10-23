# Point de reprise : après l'étape 5 (licence côté serveur local)

Branche `claude/commercial-3a1b01` (worktree `.claude/worktrees/commercial-3a1b01`). Étape 5 faite et testée en local; reste l'étape 6b.

## Fait (étape 5)
- `server.js` : réglages `LICENCE_KEY` / `CONVEX_URL`, `convex()`, synchro (démarrage + chaque minute), publication des événements, import des souhaits, PUT d'événement avec dates verrouillées remises, `synth()` via `/voix` avec repli OpenRouter (`err.ttsNeedPass` sinon), routes `/api/licence`, `/attacher`, `/detacher`.
- Dashboard (Événements) : ligne d'état, badge « Passe », boutons « Utiliser / Retirer la passe ». Textes FR/EN (`h.lic.*`, `lic.*`, `set.*`).
- Essai réel (Convex anonyme + `DATA_DIR` d'essai) : publication, passe, dates verrouillées, souhait d'invité importé (1), détachement refusé après souhait, repli de la voix quand ElevenLabs n'est pas configuré côté Convex.

## Pas vérifié
- La voix incluse réussie (il manque `ELEVENLABS_API_KEY` dans l'environnement Convex local) : seul le repli a été vu.
- L'affichage du dashboard dans le navigateur (badge, boutons, ligne d'état) : code écrit, pas regardé à l'écran.
- Détacher une passe sans souhait, et republication après « Nouveau code ».

## Reprise (dans l'ordre)
1. Relancer l'essai : `CONVEX_AGENT_MODE=anonymous npx convex dev` (routes sur 127.0.0.1:3211), créer un client avec `npx convex run admin:creerClient`, puis le serveur avec `DATA_DIR` d'essai et `settings.json` contenant `LICENCE_KEY` et `CONVEX_URL`.
2. Regarder le dashboard à l'écran (onglet Événements).
3. Étape 6b (`docs/modele-affaires.md`) : `Demarrer.vbs`, tunnel lancé par le serveur, journal `data/serveur.log`, bouton « Fermer DJ Vinny », avertissement `beforeunload` après le début de la soirée. Pas d'Inno Setup.
