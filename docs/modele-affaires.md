# DJ Vinny : modèle d'affaires et feuille de route

Document de travail, 23 octobre 2026. Aucun code modifié. Rien à coder avant l'accord de Pat.

## En bref

1. **Le client fait toujours tourner DJ Vinny sur son propre PC**, avec son propre Client ID Spotify, comme le montage actuel avec l'i5. La musique ne passe jamais par les serveurs de Pat.
2. **Ce qu'on vend, c'est la partie invités hébergée** : adresse publique, souhaits d'avance (même PC éteint), courriel d'invitation, QR imprimable, voix de Vinny incluse. Cette partie ne fait jouer aucune musique, et Spotify en permet la vente (§ IV.3.2 de sa politique développeur).
3. **Les conditions d'utilisation** disent que la lecture Spotify se fait avec le compte et le Client ID du client, pour son usage personnel, à sa responsabilité ; même chose pour les licences SOCAN et Ré:Sonne.
4. **Convex + Clerk + Stripe** : comptes, achats (10 $ la soirée, 20 $/mois, au nom de Pop & Show), droits, souhaits d'avance et voix. Le paiement se fait sur un site à part, jamais dans l'app qui joue la musique (§ IV.2.2).
5. **La voix coûte des cents par soirée** (environ 0,20 $ à 0,60 $ US). Elle passe par Convex avec la clé ElevenLabs de Pat ; le client ne voit jamais la clé.
6. **Bilingue** : un fichier de textes par langue pour l'interface, un `announce.json` par langue, la langue choisie par événement.

---

## 1. Ce qui existe aujourd'hui

| Pièce | Rôle |
|---|---|
| `server.js` (Express, un seul client) | État dans `data/state.json`, réglages dans `data/settings.json`, file, événements datés avec un code par événement, SSE, recherche Spotify avec le jeton de l'hôte, voix (`synth()` + cache `data/tts/`), ffmpeg pour les annonces |
| `views/host.html` | Dashboard : connexion Spotify en PKCE (Client ID seulement, Redirect URI `http://127.0.0.1:3000/host`), Web Playback SDK, la musique joue dans ce navigateur |
| `views/remote.html`, `public/*` | Télécommande, écran de soirée, pages invités : `index.html` (demandes : `/api/search`, `/api/request`, `/api/events`), `souhaits.html` (souhaits en texte libre : `/api/wish`, sans recherche Spotify) |
| `announce.json` | Phrases de Vinny par ambiance (`party`, `calm`) et par moment (`named`, `anon`, `plain`, `line`, `callout`, `open`, `close`), en français québécois |
| `deploy/` | nginx sur le VPS : `djvinny.korvia.ca` → `127.0.0.1:3010` → tunnel SSH inverse depuis le PC (`tunnel.cmd`). Seules les routes invités passent ; le dashboard reste local |

Constats utiles pour la suite :
- Le tunnel actuel est déjà le bon modèle : le VPS sert les invités, le PC fait jouer la musique. Il reste à le multiplier par client et à l'automatiser.
- Les souhaits sont du texte libre : ils peuvent être recueillis sans le PC, puis récupérés par le serveur local.
- Le français est codé en dur à trois endroits : `language_code: 'fr'` dans `synth()`, `FLOOR_JINGLE`/`PH_DEFAULTS` dans `server.js`, et tous les textes des pages.
- Les réglages modifiables du dashboard (`SETTING_DEFS`) incluent déjà le Client ID Spotify et la clé OpenRouter : le libre-service par client existe déjà.

## 2. Constats sourcés

### 2a. Spotify

| Constat | Source |
|---|---|
| Une app en mode développement : **5 utilisateurs Spotify maximum**, ajoutés à la main à une liste ; **le propriétaire doit avoir Premium** | [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) |
| Mode étendu : **organisations seulement** depuis le 15 mai 2025, entreprise enregistrée, service lancé, **au moins 250 000 utilisateurs actifs par mois**, examen jusqu'à 6 semaines | [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) |
| Changements 2026 rapportés (non officiels) : resserrement du mode développement en février, jusqu'à 25 Client ID par compte depuis juillet 2026 mais **quota partagé**, recherche limitée à 10 résultats | [TechCrunch, 6 fév. 2026](https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/), [vorplabs](https://vorplabs.com/agent-tools/spotify-api-changes) |
| Web Playback SDK : Premium requis ; **ne pas utiliser dans un projet commercial sans accord écrit de Spotify** | [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk) |
| Politique développeur (15 mai 2025) § IV.2.1 : **interdit de vendre une app qui fait jouer de la musique, ou l'accès à celle-ci** ; § IV.2.2 : **pas de paiement initié dans une telle app** ; § IV.3.2 : **la vente d'une app qui ne fait pas jouer de musique, ou de son accès, est permise** | [Developer Policy](https://developer.spotify.com/policy) |
| § III.7 : interdit d'enchaîner, mixer ou **superposer** du contenu Spotify ; § III.6 : pas de synchronisation avec du visuel ; § III.10 : **Spotify est pour un usage personnel, pas pour être diffusé en public par un commerce** | [Developer Policy](https://developer.spotify.com/policy) |
| Conditions développeur v10 § III.1(a) : licence pour **usage personnel privé** ; § V.5 : ne pas vendre de contenu Spotify | [Developer Terms](https://developer.spotify.com/terms) |

**Ce que ça implique avec le modèle retenu**
- **Version gratuite (GitHub)** : Pat distribue du code sans rien vendre. Chaque client crée sa propre app chez Spotify et accepte lui-même les conditions (usage personnel, 5 utilisateurs, Premium, pas de superposition). Le plafond de 5 ne gêne pas : seul l'hôte se connecte à Spotify.
- **Partie payante** : elle sert les invités (adresse, souhaits, invitations, voix) et ne fait jouer aucune musique : c'est une app « non-streaming », dont la vente est permise (§ IV.3.2). La lecture reste dans l'app gratuite du client.
- **Paiement** : jamais dans le dashboard local (§ IV.2.2). Le client achète sur le portail web, puis colle sa clé de licence (ou se connecte) dans le dashboard.
- **Zone grise restante** : la recherche des invités pendant la soirée passe par le jeton Spotify de l'hôte, via le tunnel. Elle est servie par le serveur du client, pas par Pat. Pat ne vend que le relais. À faire valider par l'avocat.
- **Usage public** (§ III.10) : un party de bureau dans une salle louée sort de l'usage personnel. Ce risque est celui du client, écrit dans les conditions, comme pour quiconque branche son téléphone sur les haut-parleurs.

### 2b. ElevenLabs et OpenRouter

| Constat | Source |
|---|---|
| Prix API ElevenLabs : **v3 et Multilingual v2 : 0,08 $ US / 1 000 caractères ; Flash/Turbo : 0,04 $ US / 1 000** ; forfaits de 6 $ à 990 $ US/mois avec caractères inclus | [ElevenLabs API pricing](https://elevenlabs.io/pricing/api) |
| Conditions ElevenAPI (9 oct. 2026) § 2.3 : on peut bâtir une **« Customer Application »** pour ses propres utilisateurs, en restant responsable de leur authentification et de leur accès | [ElevenAPI Terms](https://elevenlabs.io/elevenapi-terms) |
| La revente de l'**accès à l'API** demande d'être revendeur autorisé (texte explicite pour la musique) ; la Politique d'usage interdit de revendre les services sans permission écrite, mais permet d'utiliser le résultat (l'audio) selon les conditions | [ElevenAPI Terms](https://elevenlabs.io/elevenapi-terms), [discussion citant la politique](https://github.com/frankbria/podcaststudiohub/issues/544) |
| Usage commercial de l'audio : selon le forfait (pas permis sur le gratuit) ; pas de vente de l'audio « seul » | [ElevenCreative Terms](https://elevenlabs.io/image-and-video-terms), [guide de licence](https://www.licenseorg.com/blog/elevenlabs-licensing-guide-ai-voices) |
| OpenRouter (31 août 2026) § 7(4) : **interdit d'accéder au service pour revendre l'accès aux modèles** ; § 5.1 : permis d'**intégrer** le service à ses propres produits pour ses clients ; § 3.2 : on est responsable de ses clés | [OpenRouter Terms](https://openrouter.ai/terms) |
| OpenRouter Entreprise : licence explicite pour offrir le service à ses clients finaux (contrat signé) | [Enterprise Terms](https://openrouter.ai/terms-of-service-enterprise) |

**Lecture pour DJ Vinny** : si le service de Pat génère l'annonce avec sa clé et ne remet que le MP3 (le client ne voit jamais la clé et ne peut demander que des annonces de Vinny, avec un plafond), c'est une application qui intègre la voix, pas une revente d'API. C'est conforme chez ElevenLabs (forfait payant requis) et défendable chez OpenRouter (§ 5.1), mais ElevenLabs en direct est plus clair et évite les frais d'OpenRouter. À confirmer par un courriel à ElevenLabs avant le lancement.

### 2c. Droits de diffusion au Québec (SOCAN, Ré:Sonne)

| Constat | Source |
|---|---|
| Deux sociétés distinctes : **SOCAN** (auteurs, compositeurs, éditeurs) et **Ré:Sonne** (artistes et maisons de disques, musique enregistrée seulement). Les licences des deux passent par le guichet **Entandem** | [uOttawa](https://www.uottawa.ca/bibliotheque/droit-auteur/ressources-supplementaires/utilisation-materiel-protege-droit-dauteur-evenement), [FCEI](https://www.cfib-fcei.ca/fr/ressources/license-jouer-musique-entreprise) |
| **SOCAN Tarif 8** (réceptions, congrès, assemblées) : montant par événement selon la capacité, doublé avec danse ; exemple 2025-2026 d'une salle : 22,06 $ sans danse, 44,13 $ avec danse (1 à 100 personnes) | [Projet de tarif 8](https://cb-cda.gc.ca/sites/default/files/inline-files/COMPPROTAR%20-%202021-10-15%20SOCAN%20Tariff%208%20(2023-2025)%20-%20EN_0.pdf), [exemple de salle](https://naccna-assets.s3.amazonaws.com/weddings-fr-2025-2026.pdf) |
| **Ré:Sonne Tarif 5.B** (réceptions, 2026-2030) : en attente à la Commission du droit d'auteur | [Commission, cas en attente](https://cb-cda.gc.ca/fr/cas-et-tarifs/cas-en-cours/en-attente) |
| **Qui paie** : l'établissement ou l'organisateur de l'événement déclare et paie ; en pratique, la salle facture souvent les frais SOCAN et Ré:Sonne au client | [Tarifs Ré:Sonne 5](https://capacoa.ca/wp-content/uploads/2024/03/ReSonne_Tarifs_5-ABDEFGIJ_2016-2025.pdf), [CAPACOA](https://capacoa.ca/documents/entandem/Entandem_directives_rapports_2024.pdf) |

**Lecture** : ces droits sont la responsabilité de l'organisateur ou de la salle, pas de Pat comme fournisseur de logiciel. À écrire dans les conditions d'utilisation avec un lien vers Entandem. Payer la SOCAN et Ré:Sonne ne règle pas les conditions de Spotify : ce sont deux couches séparées.

## 3. Risques

| # | Risque | Gravité | Réponse |
|---|---|---|---|
| R1 | Vendre l'accès à une app qui fait jouer Spotify (§ IV.2.1) | Écarté par le modèle | Le payant ne fait jouer aucune musique ; la lecture reste chez le client avec son Client ID. Pas de paiement dans le dashboard (§ IV.2.2). Avis d'avocat avant de facturer |
| R2 | Recherche des invités relayée par le VPS de Pat pendant la soirée | Faible à moyen | Servie par le serveur du client avec son jeton ; Pat ne fournit que le tuyau. À valider avec l'avocat. Repli possible : recherche seulement sur le Wi-Fi local, l'adresse publique ne servant qu'aux souhaits |
| R3 | Spotify peut encore resserrer le mode développement (déjà fait en 2025 et en 2026) | Élevé, hors de contrôle | Ne pas faire dépendre la partie payante de Spotify : souhaits, invitations et voix fonctionnent quelle que soit la source. Une source « fichiers du client » pourra s'ajouter plus tard |
| R4 | Revente de la voix | Moyen | ElevenLabs en direct, forfait payant, clé seulement côté Convex, plafond par soirée, confirmation écrite d'ElevenLabs |
| R5 | Taxes et facturation : TPS/TVQ sur des ventes de 5 $, remboursements, factures | Moyen | Stripe Tax ; inscription TPS/TVQ obligatoire seulement au-delà de 30 000 $ de ventes sur 4 trimestres (à vérifier avec le comptable) |
| R6 | Tunnel coupé ou VPS en panne pendant une soirée | Moyen | Le QR local (Wi-Fi de la salle) reste toujours disponible dans le dashboard : c'est le mode gratuit, en repli automatique |
| R7 | Clés SSH de clients sur le VPS | Moyen | Clé limitée au relais d'un seul port, sans shell (`restrict,port-forwarding,permitlisten=…` dans `authorized_keys`), révocable en un clic depuis Convex |

## 4. Architecture

### Principe

Un seul code, installé sur le PC du client. Sans licence, c'est la version gratuite. Avec une clé de licence (achetée sur le portail), le même serveur active les fonctions payantes, qui passent par le VPS et Convex.

```
PC du client (DJ Vinny, son Client ID, sa musique)
  ├─ dashboard, Web Playback SDK, file, écran, télécommande   (identique gratuit / payant)
  ├─ tunnel SSH ──────────> VPS nginx : <client>.djvinny.ca  → invités pendant la soirée
  └─ HTTPS ───────────────> Convex : licence, souhaits, invitations, voix

Invités ──> <client>.djvinny.ca/souhaits  (avant)  → Convex (fonctionne PC éteint)
Invités ──> <client>.djvinny.ca/          (pendant) → tunnel → PC du client
Client  ──> compte.djvinny.ca  (Clerk + Stripe Checkout)  → Convex
```

### Ce qui est identique, ce qui s'ajoute

| | Gratuit (GitHub) | Payant (licence) |
|---|---|---|
| Serveur sur le PC du client, son Client ID, sa musique | Oui | Oui |
| Dashboard, télécommande, écran, file, périodes, annonces | Oui | Oui |
| QR vers l'adresse locale (Wi-Fi de la salle) | Oui | Oui, en repli |
| Adresse publique `<client>.djvinny.ca` pendant la soirée | — | Oui (tunnel) |
| Souhaits d'avance, PC éteint | — | Oui (Convex) |
| Courriel d'invitation, QR imprimable | — | Oui |
| Voix de Vinny | Sa propre clé OpenRouter ou un serveur local | Incluse (via Convex), ou sa clé |

### Rôle de chaque pièce

- **Portail `compte.djvinny.ca`** (petite page statique, Clerk + Stripe) : création du compte, achat d'une passe soirée (10 $) ou de l'abonnement (20 $/mois), portail client Stripe pour l'annulation et les factures. Affiche la clé de licence à coller dans le dashboard. Clerk Billing ne fait que des abonnements, d'où Stripe Checkout en direct pour la passe à l'unité.
- **Convex** :
  - tables `clients` (lien Clerk, sous-domaine, port du tunnel, clé SSH publique, état), `achats` (webhook Stripe), `soirees` (code de l'événement, dates, langue, payée ou non), `souhaits`, `invitations` ;
  - actions HTTP appelées par le serveur local avec la clé de licence : `droits`, `publier-soiree` (dates, nom, langue, pour la page des souhaits), `souhaits` (récupérer les souhaits recueillis), `voix` (texte → MP3, avec plafond par soirée) ;
  - page des souhaits : servie par le VPS en fichier statique, elle écrit directement dans Convex.
  - Voir `integrations/convex` dans l'atelier.
- **Serveur local (`server.js`)** : un réglage « Clé de licence » dans `SETTING_DEFS`. Si la clé est valide :
  - il publie l'événement dans Convex et récupère les souhaits (au démarrage, puis chaque minute) ;
  - il lance lui-même le tunnel (`ssh` est inclus dans Windows 10 et 11) avec une clé générée à l'activation, ce qui remplace `tunnel.cmd` ;
  - `synth()` appelle l'action `voix` de Convex au lieu d'OpenRouter ; le cache disque reste le même.
- **VPS** : nginx et une minuterie systemd qui lit dans Convex les nouveaux clients, puis ajoute la clé SSH restreinte, le bloc nginx du sous-domaine (même liste de routes invités que `deploy/djvinny.nginx`) et le certificat (certbot). Le VPS va chercher le travail ; Convex n'a aucun accès SSH. Aucun code de client ne tourne sur le VPS.
- **Courriel d'invitation** : action Convex qui envoie par Brevo (déjà dans `integrations/`) le lien des souhaits et le QR, avec un plafond par soirée pour protéger le domaine d'envoi.

### Ce que l'installation demande au client

1. Installer DJ Vinny (Node + ffmpeg, ou un installateur plus tard).
2. Créer son app Spotify et coller le Client ID (étapes guidées dans le dashboard, Redirect URI affiché avec un bouton Copier).
3. Payant seulement : coller sa clé de licence. Le reste (tunnel, sous-domaine, certificat) se fait seul.

> Une fonction payante dans un dépôt public peut être réactivée par n'importe qui. Ce n'est pas grave : ce qu'on vend, c'est le relais, l'adresse publique, les souhaits hébergés et la voix incluse, qui vivent sur les serveurs de Pat.

## 5. Français / anglais

- **Langue par événement** (`ev.lang = 'fr' | 'en'`), avec la langue du navigateur pour l'interface de l'hôte.
- **Textes de l'interface** : `locales/fr.json` et `locales/en.json`, une petite fonction `t('cle')` et des attributs `data-i18n` dans les pages. Pas de bibliothèque. Les pages invités d'abord (index, souhaits, écran : peu de texte, c'est ce que voient les invités anglophones), puis le dashboard (~1 350 lignes, le plus gros morceau).
- **Vinny** : `announce.json` devient `announce/fr.json` et `announce/en.json`, même structure (`party`/`calm` × `named`, `anon`, `plain`, `line`, `callout`, `open`, `close`). `synth()` reçoit la langue (`language_code: lang`), ce qui change aussi la clé de cache. `FLOOR_JINGLE` et `PH_DEFAULTS` passent dans ces fichiers.
- **Exemples anglais de base** : « [excited] Special request from {name}! {title}, by {artist}! », « [excited] Want to hear your song? Scan the QR code! », « [excited] Good evening, everybody! DJ Vinny's in the house! », « [excited] That's the last song, folks! Thanks for dancing with DJ Vinny. Get home safe! ». Le ton reste festif ; le joual reste dans la version française.
- La voix `liam` (eleven-v4-turbo) parle les deux langues ; vérifier à l'oreille, sinon une voix par langue dans chaque fichier.

## 6. Coûts face au prix

Hypothèse d'une soirée : ~40 annonces de ~100 caractères + ~10 rappels/ouverture/fermeture ≈ 5 000 caractères, dont une partie réutilisée grâce au cache.

| Poste | Par soirée (passe à 10 $) | Par mois (abonné à 20 $, 4 soirées) |
|---|---|---|
| Voix ElevenLabs v3 (0,08 $ US / 1 000 car.) | ~0,55 $ CA | ~2,20 $ CA |
| Stripe (~2,9 % + 0,30 $) | ~0,59 $ | ~0,88 $ |
| VPS (le même qu'aujourd'hui : nginx et tunnels seulement, très léger) | ~0,10 $ réparti | ~0,25 $ réparti |
| Convex, Clerk, Brevo | Paliers gratuits au début | 0 $ |
| **Reste à Pop & Show** | **~8,75 $ sur 10 $** | **~16,50 $ sur 20 $** |

Le forfait ElevenLabs à 22 $ US/mois inclut 275 000 caractères (~50 soirées) : il couvre le lancement. Le vrai coût est le temps de soutien le soir des soirées.

### Pourquoi 10 $ plutôt que 5 $

- À 5 $, Stripe prend 9 % de la vente ; à 10 $, 6 %.
- Le client compare à un DJ (souvent quelques centaines de dollars la soirée) ou à la location de la salle : 10 $ reste négligeable, 5 $ fait « gadget ».
- À 10 $ la soirée, l'abonnement à 20 $ devient rentable dès la 2ᵉ soirée du mois : c'est un argument de vente simple pour les animateurs et les salles.
- Repères : BeatTribe affiche 6,90 $ US par utilisateur et par mois ([Capterra](https://www.capterra.com/p/10046786/BeatTribe/)), Enjoy the Club 79 $ US forfaitaire ([GetApp](https://www.getapp.ca/software/2085145/enjoy-the-club)). Aucun n'a la voix d'un animateur.
- Prix en dollars canadiens, taxes en sus. La passe couvre les souhaits d'avance dès l'achat, puis la soirée elle-même.

## 7. Étapes ordonnées (validées)

**Avant d'écrire du code** (aucune ne dépend du code) :

| # | Étape |
|---|---|
| A | Acheter `djvinny.ca` ; DNS : `djvinny.ca`, `compte.djvinny.ca` et `*.djvinny.ca` vers le VPS |
| B | Compte Stripe au nom de Pop & Show (produits : passe soirée 10 $, abonnement 20 $/mois, Stripe Tax) |
| C | Forfait ElevenLabs Creator (22 $ US/mois, usage commercial) au nom de Pop & Show, et courriel à ElevenLabs pour confirmer l'usage « voix incluse dans notre app » |
| D | Avis d'un avocat : modèle (partie invités payante, lecture chez le client), conditions d'utilisation, Loi 25 |

**Code**, dans cet ordre :

| # | Étape | Dépend de |
|---|---|---|
| 1 | Livrer le Party Noël STI du 12 décembre avec le montage actuel (branche `perso`), sans rien changer | — |
| 2 | Bilingue : `locales/`, `announce/fr.json` + `en.json`, langue par événement, `synth()` avec la langue ; `STOREFRONT` par défaut à `ca` | — |
| 3 | Convex : schéma, actions `droits`, `publier-soiree`, `souhaits`, `voix` (ElevenLabs en direct) | C |
| 4 | Portail `compte.djvinny.ca` : Clerk + Stripe Checkout, webhook vers Convex, clé de licence | A, B, 3 |
| 5 | Serveur local : réglage « Clé de licence », publication de l'événement, récupération des souhaits, voix via Convex | 3 |
| 6 | Tunnel automatique : clé SSH générée par l'app, script sur le VPS (clé restreinte, nginx, certbot, ouverture selon les droits), repli QR local | A, 3 |
| 7 | Page des souhaits sur `<client>.djvinny.ca` (écrit dans Convex), courriel d'invitation (Brevo), QR imprimable (PDF) | 3, 5 |
| 8 | Conditions d'utilisation et politique de confidentialité (FR/EN) | D |
| 9 | Dépôt GitHub public de la version gratuite (sans `.env` ni `data/`), README FR/EN avec les étapes Spotify | 2 |
| 10 | Bêta avec 2-3 clients, puis lancement | 4-8 |

Le travail commercial se fait sur une branche à part ; `perso` et l'étiquette `v1-perso` restent la version qui fonctionne.

## 8. Décisions de Pat (23 octobre 2026)

| Question | Décision |
|---|---|
| Domaine | `djvinny.ca` (à créer) |
| Prix | 10 $ la soirée, 20 $/mois (dollars canadiens, taxes en sus) |
| Voix | ElevenLabs en direct |
| Recherche des invités par l'adresse publique | Expliquée en section 9 ; recommandation : la garder |
| Ordre bilingue / payant | Sans importance : bilingue d'abord (étape 2), il ne dépend de rien |
| Entreprise | Pop & Show |
| Catalogue | `ca` |

## 9. Deux points expliqués

### Recherche des invités par l'adresse publique (zone grise R2)

Pendant la soirée, un invité sur son réseau cellulaire tape « Céline » sur `<client>.djvinny.ca`. La demande passe : téléphone → VPS de Pop & Show → tunnel → PC du client → Spotify (avec le jeton de l'hôte) → retour par le même chemin. Les résultats (titres, artistes, pochettes) sont du contenu Spotify, et ils transitent par un service payant. Les conditions de Spotify interdisent de vendre du contenu Spotify (§ V.5).

- **Pourquoi c'est défendable** : c'est l'app du client qui fait la recherche, avec son compte ; le VPS ne fait que transporter, comme un fournisseur Internet. Pop & Show vend le transport et l'adresse, pas les résultats.
- **Pourquoi c'est gris** : le transport est payant, et pendant la soirée il sert surtout à ça.
- **Si l'avocat dit non** : l'invité tape sa demande en texte libre (« Céline Dion, Pour que tu m'aimes encore »), comme pour les souhaits, et le PC du client trouve la chanson lui-même (`match.js` sait déjà le faire). Aucun contenu Spotify ne passe alors par le VPS. C'est moins agréable qu'une recherche avec résultats, mais ça fonctionne.
- **Recommandation** : garder la recherche, la faire valider par l'avocat (étape D), avec le texte libre en plan B.

### Contrôle du jeton d'une soirée

**Aujourd'hui (`server.js`)**
- Chaque événement reçoit un code aléatoire de 12 caractères (9 octets, environ 4,7 × 10²¹ possibilités) : impossible à deviner.
- Le QR contient ce code (`/?e=…` pour les demandes, `/souhaits.html?e=…` pour les souhaits). Seul l'hôte connecté peut générer le QR et les liens.
- Les pages des invités renvoient le code dans l'en-tête `x-event` à chaque appel. Le serveur le compare en temps constant (`safeEq`).
- **Souhaits** : acceptés avec le code de n'importe quel événement qui n'est pas terminé ; 3 par invité, 400 par événement.
- **Recherche, demandes, état en direct** : seulement avec le code de l'événement actif, seulement pendant qu'il est « en cours » (de l'heure de début, moins l'ouverture anticipée, jusqu'à l'heure de fin), et seulement si l'hôte a ouvert les demandes.
- Après la fin, le code ne donne plus que la fiche de l'événement et le message de remerciement.
- **Nouveau code** (bouton du dashboard) : les anciens QR cessent de fonctionner sur-le-champ, utile si une photo du QR circule.
- Limites : par invité (identifiant gardé dans le téléphone, qu'on peut effacer) et par adresse IP, avec des plafonds larges parce que tous les invités d'une salle partagent souvent la même adresse.

**Avec le payant**, le code prouve qu'on est invité, pas que la soirée est payée. Comme la version gratuite est publique et modifiable, le contrôle du paiement doit se faire sur les serveurs de Pop & Show, jamais sur le PC du client :
- **Convex** garde pour chaque soirée publiée : la licence du client, une empreinte du code (pas le code lui-même), les dates et l'état payé. La page des souhaits n'accepte un souhait que si l'empreinte correspond à une soirée payée et pas terminée.
- **VPS** : chaque minute, le script lit dans Convex quels clients ont droit à leur adresse publique (une passe attachée, achetée ou d'abonnement, de l'attachement à la fin de la soirée + 6 h) et ouvre ou ferme le bloc nginx de `<client>.djvinny.ca`. Sans droit, l'adresse affiche « Soirée non active » ; le tunnel peut rester branché, il ne mène nulle part.
- **Voix** : l'action Convex vérifie la licence et le plafond de la soirée avant d'appeler ElevenLabs.
- **Nouveau code** : le serveur local publie la nouvelle empreinte dans Convex, donc les anciens QR cessent aussi de fonctionner pour les souhaits.

### Consommation d'une passe soirée (10 $)

Une passe est un crédit dans Convex, jamais un fichier ou un réglage sur le PC du client.

1. **Achat** : Stripe confirme le paiement, Convex crée une passe « libre » liée au compte (valide 12 mois).
2. **Attacher la passe** : dans le dashboard, sur un événement, l'hôte appuie sur « Utiliser une passe ». Le serveur local envoie à Convex l'id de l'événement, ses dates et l'empreinte de son code. Convex marque la passe « attachée » à cet événement. Dès ce moment, les souhaits d'avance et l'adresse publique sont ouverts pour cet événement seulement.
3. **Fenêtre** : la passe ouvre l'événement de l'attachement jusqu'à la fin prévue + 6 heures (la même marge que `eventStatus`). Après, Convex la marque « utilisée » : souhaits refusés, sous-domaine fermé, voix incluse coupée.
4. **Ce qui empêche de la réutiliser** :
   - **Dates verrouillées** : une fois la passe attachée, Convex refuse tout changement de date, sauf un report avant le début de la soirée (une tempête, un report). Repousser la soirée de semaine en semaine est donc impossible.
   - **Lien à un seul événement** : dupliquer l'événement dans le dashboard crée un nouvel id, sans passe. Garder l'ancien code de soirée ne sert à rien une fois la fenêtre passée.
   - **Contrôle sur les serveurs de Pop & Show** : un client qui modifie son code local n'y gagne rien, parce que les souhaits, le sous-domaine et la voix sont ouverts ou fermés par Convex et le VPS.
   - **Voix plafonnée** : environ 20 000 caractères par passe, comptés dans Convex.
5. **Erreur de bonne foi** : on peut détacher la passe gratuitement tant que la soirée n'a pas commencé et qu'aucun souhait n'a été reçu. Elle redevient « libre ».

**Abonnement à 20 $/mois (décision de Pat)** : 1 compte, 1 soirée à la fois, 4 soirées par mois.
- Chaque mois de facturation, Convex crée 4 passes « d'abonnement » qui fonctionnent exactement comme une passe achetée (attacher, fenêtre, dates verrouillées, voix plafonnée à ~20 000 caractères).
- **1 soirée à la fois** : on ne peut pas attacher une 2ᵉ passe tant qu'une soirée attachée n'est pas terminée. Les souhaits d'avance d'une soirée future ouvrent déjà la soirée : il faut donc permettre « 1 soirée en cours + des souhaits pour la suivante », sinon un abonné ne pourrait pas préparer sa prochaine soirée.
- Les passes d'abonnement non utilisées ne s'accumulent pas : elles expirent à la fin du mois de facturation. Une passe déjà attachée à une soirée future reste valide jusqu'à cette soirée.
- **Au-delà de 4** : achat d'une passe à 10 $, comme tout le monde.
- **Annulation** : les passes déjà attachées restent valides jusqu'à leur soirée ; les autres disparaissent à la fin de la période payée.
- Ce n'est plus « illimité » : nommer l'offre « Abonnement 4 soirées ». À 20 $, ça revient à 5 $ la soirée, la moitié du prix de la passe, et c'est rentable dès la 2ᵉ soirée du mois.

## Sources

- Spotify : [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) · [Developer Policy](https://developer.spotify.com/policy) · [Developer Terms](https://developer.spotify.com/terms) · [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk) · [TechCrunch, fév. 2026](https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/) · [vorplabs, changements 2026](https://vorplabs.com/agent-tools/spotify-api-changes)
- ElevenLabs : [API pricing](https://elevenlabs.io/pricing/api) · [ElevenAPI Terms](https://elevenlabs.io/elevenapi-terms) · [ElevenCreative Terms](https://elevenlabs.io/image-and-video-terms) · [Guide de licence](https://www.licenseorg.com/blog/elevenlabs-licensing-guide-ai-voices)
- OpenRouter : [Terms](https://openrouter.ai/terms) · [Enterprise Terms](https://openrouter.ai/terms-of-service-enterprise)
- Droits au Québec : [uOttawa, matériel protégé en événement](https://www.uottawa.ca/bibliotheque/droit-auteur/ressources-supplementaires/utilisation-materiel-protege-droit-dauteur-evenement) · [FCEI, licence pour jouer de la musique](https://www.cfib-fcei.ca/fr/ressources/license-jouer-musique-entreprise) · [Projet SOCAN Tarif 8](https://cb-cda.gc.ca/sites/default/files/inline-files/COMPPROTAR%20-%202021-10-15%20SOCAN%20Tariff%208%20(2023-2025)%20-%20EN_0.pdf) · [Commission, cas en attente (Ré:Sonne 5)](https://cb-cda.gc.ca/fr/cas-et-tarifs/cas-en-cours/en-attente) · [Tarifs Ré:Sonne 5](https://capacoa.ca/wp-content/uploads/2024/03/ReSonne_Tarifs_5-ABDEFGIJ_2016-2025.pdf) · [CAPACOA, directives Entandem 2024](https://capacoa.ca/documents/entandem/Entandem_directives_rapports_2024.pdf) · [Exemple de frais en salle 2025-2026](https://naccna-assets.s3.amazonaws.com/weddings-fr-2025-2026.pdf)

*Ceci n'est pas un avis juridique.*
