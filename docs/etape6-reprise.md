# Point de reprise : après l'étape 5 (licence côté serveur local)

Branche `claude/commercial-3a1b01` (worktree `.claude/worktrees/commercial-3a1b01`). Étape 5 faite et testée en local; reste l'étape 6b.

## Fait (étape 5)
- `server.js` : réglages `LICENCE_KEY` / `CONVEX_URL`, `convex()`, synchro (démarrage + chaque minute), publication des événements, import des souhaits, PUT d'événement avec dates verrouillées remises, `synth()` via `/voix` avec repli OpenRouter (`err.ttsNeedPass` sinon), routes `/api/licence`, `/attacher`, `/detacher`.
- Dashboard (Événements) : ligne d'état, badge « Passe », boutons « Utiliser / Retirer la passe ». Textes FR/EN (`h.lic.*`, `lic.*`, `set.*`).
- Essai réel (Convex anonyme + `DATA_DIR` d'essai) : publication, passe, dates verrouillées, souhait d'invité importé (1), détachement refusé après souhait, repli de la voix quand ElevenLabs n'est pas configuré côté Convex.

Vérifié ensuite (25 oct.) : dashboard à l'écran (ligne d'état, badge « Passe », boutons), détacher une passe sans souhait, ancien code refusé et nouveau accepté après « Nouveau code », avancer la date refusé (date remise), reporter permis.

## Pas vérifié
- La voix incluse réussie (il manque `ELEVENLABS_API_KEY` dans l'environnement Convex local) : seul le repli a été vu.
- Si Convex est injoignable, un changement de dates passe en local ; à la reconnexion, Convex le refuse en silence si une passe est attachée (les deux versions divergent).

## Reprise
Le Convex local peut prendre d'autres ports si une ancienne instance tourne encore : lire le port affiché par `npx convex dev` (routes HTTP sur le port suivant).

Étape 6b (`docs/modele-affaires.md`) : `Demarrer.vbs`, tunnel lancé par le serveur, journal `data/serveur.log`, bouton « Fermer DJ Vinny », avertissement `beforeunload` après le début de la soirée. Pas d'Inno Setup.

## Étape 6b faite (25 oct.)
`Demarrer.vbs` (aucune fenêtre, pas de doublon, journal `data/serveur.log` + `serveur.old.log`), `Demarrer DJ Vinny.cmd` le lance (faire pointer le raccourci vers `Demarrer.vbs` pour éviter l'éclair), réglage `TUNNEL` (ssh lancé et relancé par le serveur, arrêté à la fermeture), bouton « Fermer DJ Vinny » (⚙ Réglages), avertissement avant de quitter l'onglet une fois la soirée démarrée, état du tunnel dans l'en-tête. Pas essayé : un vrai tunnel vers le VPS (testé seulement avec un hôte injoignable).
