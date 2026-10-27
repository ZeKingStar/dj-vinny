# DJ Vinny

Une discothèque autonome pour soirées. Les invités scannent un code QR et demandent leurs chansons depuis leur téléphone ; l'hôte garde la main sur un tableau de bord ; **Vinny**, un animateur à voix IA (en québécois), annonce les demandes. Quand personne ne demande rien, l'autopilote prend le relais.

> Projet personnel, gratuit, sous licence **non commerciale** (voir [Licence](#licence)).
> Ce projet n'est affilié ni à Spotify, ni à Apple, ni à OpenRouter, ni à ElevenLabs.

## Vidéo de présentation

Vinny se présente en 75 secondes (fichier MP4 aussi disponible dans la [version 1.0.0](https://github.com/ZeKingStar/dj-vinny/releases/tag/v1.0.0)) :

https://github.com/user-attachments/assets/8badffd4-d403-4612-b47b-27d85223719f

## Ce que ça fait

- **Demandes par QR** : « Trouve ta toune » sur le téléphone des invités, avec un code de soirée qui change à chaque événement, des limites par personne et par période.
- **Tableau de bord hôte** (`/host`) : file d'attente (glisser-déposer), périodes dîner / soirée, autopilote pondéré par les notes « Ça danse », danse en ligne, jingles, fondus, volume par titre, mode fête.
- **Écran animé** (`/ecran.html`) : second écran avec le titre en cours, les demandes et le QR.
- **Télécommande** (`/remote`) : pause, suivant, file et boutons DJ depuis un téléphone.
- **Voix de Vinny** : clips prégénérés (dossier `voix/`, français et anglais), sans clé ni compte. Les annonces avec le titre, l'artiste et le prénom de l'invité font partie de la version payante.
- **Journal de soirée** sans nom, sans IP ni image : `node report.js` produit un rapport.
- **Listes** choisies pour un public québécois (`curated/soiree.json`) : danse, danse en ligne, souper.

## Installation (Windows)

1. **Télécharger** le fichier `DJ-Vinny-…-windows.zip` depuis la [page des versions](https://github.com/ZeKingStar/dj-vinny/releases).
2. **Décompresser** : clic droit sur le fichier, puis « Extraire tout ».
3. **Double-cliquer** sur **Demarrer DJ Vinny** dans le dossier obtenu.

Rien d’autre à installer. Si Windows affiche un avertissement, cliquez sur « Informations complémentaires », puis « Exécuter quand même ».

Au premier démarrage, une page de bienvenue s’ouvre et vous guide :

1. Choisissez le **mot de passe** du tableau de bord.
2. Créez votre application Spotify (voir plus bas) et collez son **Client ID**.

Ensuite, le tableau de bord s’ouvre tout seul. Aux démarrages suivants, il s’ouvre directement.

Il vous faut un compte **Spotify Premium**. La lecture se fait dans le navigateur de l’ordinateur qui fait tourner l’app : **Chrome ou Edge sur un PC**, pas sur un téléphone.

### Créer votre application Spotify

1. Allez sur <https://developer.spotify.com/dashboard> et créez une app (gratuit, 5 minutes).
2. **Redirect URI** : `http://127.0.0.1:3000/host` (avec `127.0.0.1`, pas `localhost`). La page de bienvenue l’affiche avec un bouton **Copier**. Cliquez *Add* puis *Save*.
3. Cochez **Web Playback SDK**.
4. Copiez le **Client ID**. Il n’y a pas de secret à copier.
5. Le propriétaire de l’app est déjà autorisé ; dans *User Management*, n’ajoutez d’autres comptes que si nécessaire (maximum 5).

### Utiliser

Ouvrez le tableau de bord à **<http://127.0.0.1:3000/host>** (jamais `localhost` ni l’adresse du réseau : le navigateur refuse certaines fonctions hors de ce contexte), connectez Spotify, puis « Démarrer la soirée ». Les invités accèdent à l’app par le QR affiché sur l’écran animé (même réseau Wi-Fi). Pour arrêter, utilisez « Fermer DJ Vinny » dans les Réglages.

Le premier démarrage fonctionne sans sons : les jingles utilisent un son de secours. Les voix de Vinny sont incluses (`voix/`). Voir `sounds/LICENCES.md` pour ajouter les vôtres.

### Pour les développeurs

Il faut Node.js 22 ou plus récent ; `ffmpeg` est facultatif.

```bash
git clone https://github.com/ZeKingStar/dj-vinny.git dj-vinny
cd dj-vinny
npm install
npm start
```

Sans fichier `.env`, la page de bienvenue le crée. Vous pouvez aussi copier `env.example` en `.env` et le remplir. Pour fabriquer le ZIP : `node installateur/construire.js` (résultat dans `installateur/sortie/`).

## Limites à connaître

- **Spotify en mode développeur** : 5 utilisateurs autorisés au maximum, et l'hôte doit être Premium. Cette app est conçue pour **un hôte qui utilise son propre compte**.
- Spotify n'autorise pas le chevauchement de titres : Vinny fait un fondu sortant, puis un son de transition, puis un fondu entrant.
- Les conditions d'utilisation de Spotify limitent l'usage à un cadre **personnel et non commercial** et interdisent la diffusion publique dans les commerces. Utilisez DJ Vinny pour vos fêtes privées ; vous êtes responsable de respecter leurs conditions et les licences de diffusion locales.
- Plusieurs fonctions n'ont pas été vérifiées en conditions réelles avec Spotify (fin de titre automatique, fondus à l'oreille, caméra). Les problèmes sont les bienvenus.

## Données et vie privée

Les données (état, listes importées, journal) restent dans `data/` sur votre ordinateur. La caméra, si vous l'activez, ne sert qu'à mesurer le mouvement en temps réel : rien n'est enregistré. Le journal de soirée ne contient ni noms, ni adresses IP, ni images.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE) : vous pouvez utiliser, modifier et partager le code pour tout usage **non commercial** (fête, hobby, étude, organisme sans but lucratif). Tout usage commercial (vente, location, service payant) demande l'accord écrit de l'auteur.

Les sons et la musique ne sont pas inclus ; leurs sources et licences sont listées dans `sounds/LICENCES.md`.
