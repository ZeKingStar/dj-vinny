# DJ Vinny (branche commerciale) : notes pour la suite

## Objectif en cours
Party Noël STI le 12 déc. 2026 : DJ Vinny tourne **seulement sur le VPS**, https://fete.djvinny.ca (jamais korvia.ca). Fonctionnel avant le look. Le commercial reprend aux vacances de Noël.

## VPS
- `ssh monvps` (user deploy) pour tout sauf sudo; Pat lance lui-même les commandes `sudo` via `ssh -t monvps '…'`.
- Service systemd `djvinny-serveur` (port 3011, TZ America/Toronto, NO_TUNNEL=1, TRUST_PROXY=1). Fichiers : `deploy/vps-serveur/` (`pousser.sh` pousse le code, puis Pat redémarre le service).
- Journal : `ssh monvps 'journalctl -u djvinny-serveur --no-pager -n 40 -q'`.
- Ne jamais lire ni afficher les `.env` ou les clés. Clé ElevenLabs : Convex seulement, jamais sur le VPS. Pas de clé dans le dépôt.
- Utiliser `git -c safe.directory=*`.

## Fonctionnement
- `server.js` (Express), `views/host.html` (dashboard), `public/` (invités), `locales/fr.json|en.json`. État dans `data/state.json`, réglages dans `data/settings.json` (priorité : Réglages > .env > défaut).
- Voix en direct = licence + passe attachée à l'événement actif + événement ouvert (`voiceViaPass`). Convex prod `shocking-marten-220`, client « pat », 200 passes.
- « Démarrer la soirée » appelle `ensureEvent()` (crée « Soirée du {date} », démarre, attache une passe).
- Fermeture auto 24 h après le début de l'événement; plafond voix par événement (`VOIX_MAX_CARACTERES`).

## À faire
Voir la mémoire `djvinny-vps-serveur-12-dec` : diagnostiquer le « ça ne fonctionne pas » de Pat (0 événement dans `state.json` du VPS au 15 nov.), tester la voix avec prénom, commiter, `npx convex deploy` (« fete » réservé), patch nginx resolver Convex.

## Style
Français québécois, étapes très simples avec exemples pour Pat. Solution complète, tester une fois, pas de sur-ingénierie.
