# Convex : partie payante de DJ Vinny

Comptes clients, passes, soirées publiées, souhaits d'avance et voix incluse. Plan complet : `docs/modele-affaires.md` (sections 4 et 9).

## Démarrer

```bash
npx convex dev
```

Sans compte Convex, `CONVEX_AGENT_MODE=anonymous npx convex dev` lance un déploiement local (port 3210, routes HTTP sur 3211). `.env.local` est créé par Convex et ignoré par git.

Variables d'environnement Convex (`npx convex env set NOM valeur`, jamais dans le dépôt) :

| Variable | Rôle |
|---|---|
| `ELEVENLABS_API_KEY` | Clé ElevenLabs de Pop & Show (forfait Creator). Sans elle, `/voix` répond `voix_non_configuree` |
| `ELEVENLABS_MODEL` | Facultatif, `eleven_v3` par défaut |
| `ELEVENLABS_VOICE_ID` | Facultatif, Liam (`TX3LPaxmHKxFdv7VOQHJ`) par défaut |
| `VPS_HOST`, `VPS_USER`, `VPS_HOST_KEY`, `DOMAINE` | Tunnel automatique vers le VPS (voir `deploy/vps/README.md`). Sans `VPS_HOST`, aucun tunnel |
| `VPS_TOKEN` | Jeton de la minuterie du VPS pour `/vps/clients` |
| `BREVO_API_KEY`, `BREVO_LIST_ID`, `BREVO_SENDER` | Courriel facultatif de la page de vente (`abonnes.ts`) : clé Brevo, numéro de la liste, adresse d'expéditeur validée dans Brevo. Sans clé, `/abonner` répond `non_configure` |
| `ABONNES_SECRET` | Longue valeur aléatoire qui signe les liens de confirmation et de désabonnement |

## Gestion (en attendant le portail)

```bash
npx convex run admin:creerClient '{"courriel":"client@exemple.ca","sousDomaine":"client"}'
```

```bash
npx convex run admin:ajouterPasse '{"sousDomaine":"client","origine":"achat"}'
```

`creerClient` affiche la clé de licence une seule fois : Convex n'en garde que l'empreinte. `admin:suspendre` coupe un client.

## Routes HTTP

Serveur local du client : `POST`, corps JSON, en-tête `Authorization: Bearer djv_…`.

| Route | Corps | Réponse |
|---|---|---|
| `/droits` | — | sous-domaine, passes libres, soirées publiées, tunnel (hôte, port, empreinte du VPS, adresse publique), clé SSH connue |
| `/cle-ssh` | `cle` (`ssh-ed25519 …`) | `ok` |
| `/publier-soiree` | `evId, code, nom, date, debut, fin, debutTs, finTs, lang, lieu, accueil, merci` | `soireeId` (seule l'empreinte du code est gardée) |
| `/attacher-passe` | `evId` | `passeId` |
| `/detacher-passe` | `evId` | `ok` (avant le début, sans souhait reçu) |
| `/souhaits` | — | souhaits pas encore remis, remis une seule fois |
| `/voix` | `evId, texte, lang, prev?, next?, voiceSettings?` | MP3 (20 000 caractères par passe) |

VPS : `GET /vps/clients` avec `Authorization: Bearer <VPS_TOKEN>` (sous-domaine, port, clé SSH, ouvert ou non).

Invités : `GET /soiree?e=<code>` (fiche publique) et `POST /souhaiter` `{ code, texte, prenom, invite }`.

Erreurs : `{ "error": "<code>" }` avec le statut HTTP. Codes : `licence_absente`, `licence_invalide`, `json_invalide`, `champs_invalides`, `soiree_invalide`, `soiree_inconnue`, `soiree_terminee`, `soiree_commencee`, `soiree_non_ouverte`, `soiree_non_active`, `dates_verrouillees`, `aucune_passe`, `limite_abonnement`, `aucune_passe_attachee`, `souhaits_recus`, `code_invalide`, `souhait_invalide`, `max_souhaits`, `souhaits_pleins`, `texte_invalide`, `plafond_voix`, `voix_non_configuree`, `voix_echec`, `cle_ssh_invalide`, `non_autorise`.

## Courriel facultatif (page de vente)

`POST /abonner` (`{courriel, majs, payant, consentement: true, lang}`), puis les liens signés `GET /confirmer?t=` et `GET /desabonner?t=` des courriels. Double confirmation : le contact n'entre dans la liste Brevo qu'au clic de confirmation; le désabonnement le met sur liste noire. À brancher : définir les 5 variables ci-dessus, créer la liste dans Brevo (attributs `LANG`, `MAJS`, `PAYANT`), puis mettre `https://<déploiement>.convex.site/abonner` dans `LIENS.courriel` de `deploy/vps/site/index.html` (vide = formulaire caché). Courriels de mise à jour : ajouter le lien `/desabonner` de chaque contact (obligatoire, LCAP).
