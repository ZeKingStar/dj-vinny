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

## Avant tout déploiement ou changement sur le VPS
1. **Lire l'existant d'abord** : `docs/modele-affaires.md`, `deploy/`, config live (`ssh monvps`). Ne pas répondre sur l'architecture ou les prix de mémoire. Le VPS sert déjà un relais multi-client (`<client>.djvinny.ca` → tunnel SSH vers le PC du client, généré par `djvinny-sync`). `fete.djvinny.ca` est un serveur complet à part, pas multi-client.
2. **Demander avant de réutiliser** un domaine, un vhost, un service ou un cert existant (korvia.ca : jamais pour DJ Vinny).
3. **nginx est partagé avec d'autres sites** : tester `nginx -t` avant tout rechargement, résoudre les noms externes à l'exécution (`resolver` + variable), prévoir le retour arrière. Pat lance le sudo.
4. **Vérifier l'environnement cible** : fuseau (VPS en UTC, service en TZ=America/Toronto), Convex prod `shocking-marten-220` et non le test, passe attachée à l'événement actif, adresse publique (`PUBLIC_URL`).
5. **Commandes pour Pat** : complètes, sans valeur à remplacer (`TON_…`), avec le dossier de départ, JSON entre guillemets simples sous PowerShell. Ce que je ne peux pas remplir (clé, mot de passe) est dit clairement, en une étape.
6. **Après coup** : vérifier par le journal (`journalctl`), les lignes `Annonce :`, les comptes dans `data/state.json`, jamais en lisant `.env`.

## Style
Français québécois, étapes très simples avec exemples pour Pat. Solution complète, tester une fois, pas de sur-ingénierie.
