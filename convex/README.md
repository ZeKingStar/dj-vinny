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
| `ELEVENLABS_MODEL` | Facultatif, `eleven_v4_turbo` par défaut (moitié prix, balises audio) |
| `ELEVENLABS_VOICE_ID`, `ELEVENLABS_VOICE_ID_EN` | Facultatifs, Felix Tabarnak (`RBhYSNMNu6b2CGZ9Fn1M`) par défaut, en français et en anglais. Il doit être dans « Mes voix » du compte |
| `VPS_HOST`, `VPS_USER`, `VPS_HOST_KEY`, `DOMAINE` | Tunnel automatique vers le VPS (voir `deploy/vps/README.md`). Sans `VPS_HOST`, aucun tunnel |
| `VPS_TOKEN` | Jeton de la minuterie du VPS pour `/vps/clients` |
| `BREVO_API_KEY`, `BREVO_LIST_ID`, `BREVO_SENDER` | Courriel facultatif de la page de vente (`abonnes.ts`) : clé Brevo, numéro de la liste, adresse d'expéditeur validée dans Brevo. Sans clé, `/abonner` répond `non_configure` |
| `ABONNES_SECRET` | Longue valeur aléatoire qui signe les liens de confirmation et de désabonnement |

## Paiement (portail compte.djvinny.ca, sans compte Clerk)

Le client entre son courriel et l'adresse voulue sur `compte.djvinny.ca` (`deploy/vps/compte/`), paie sur Stripe Checkout, et le webhook (`paiement.ts`) crée le client et ses passes, puis lui envoie sa clé de licence par courriel (Brevo). Une passe achetée = 1 passe (12 mois) ; un abonnement = 4 passes par facture payée, qui expirent à la fin de la période. Un client qui revient avec le même courriel reçoit ses nouvelles passes sur son adresse actuelle.

| Variable Convex | Valeur |
|---|---|
| `STRIPE_SECRET_KEY` | clé secrète Stripe (`sk_test_…` puis `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | secret de signature du webhook (`whsec_…`) |
| `STRIPE_PRICE_SOIREE`, `STRIPE_PRICE_ABONNEMENT` | les `price_…` de la passe 10 $ et de l'abonnement 20 $/mois |
| `BREVO_API_KEY` | clé API Brevo (expéditeur `invitations@djvinny.ca`) |
| `STRIPE_COUPON_ESSAI` | facultatif : id du coupon « première soirée gratuite » (voir plus bas) |
| `PORTAIL_URL` | facultatif, `https://compte.djvinny.ca` par défaut |

Seules les sessions Checkout portant `metadata.offre` (créées par `/checkout`) et les factures de `STRIPE_PRICE_ABONNEMENT` sont traitées : les autres paiements du compte Stripe de Pop & Show sont ignorés. Après le premier abonnement en mode test, vérifier dans les journaux Convex qu'aucune ligne « invoice.paid ignorée » n'apparaît pour cette facture.

**Première soirée gratuite.** Dans Stripe, créer un coupon : 100 %, « une fois », limité au produit de la passe soirée (jamais l'abonnement), puis mettre son id dans `STRIPE_COUPON_ESSAI`. Quand un visiteur confirme son courriel, `/confirmer` crée un code promo (`VINNY-XXXXXXXX`, un seul usage, 30 jours), l'affiche et l'envoie par courriel. Le Checkout de la passe accepte les codes ; la passe obtenue (montant 0) a un plafond de voix de 10 000 caractères au lieu de 20 000. Sans la variable, la confirmation fonctionne sans code.

Webhook Stripe : adresse `https://<déploiement>.convex.site/stripe`, événements `checkout.session.completed` et `invoice.paid`. Clé perdue ou courriel non reçu : `npx convex run paiement:nouvelleCle '{"courriel":"client@exemple.ca"}'` (remplace la clé). Remboursements et annulations : à faire dans Stripe, puis `admin:suspendre` si besoin ; les passes d'un abonnement annulé expirent seules.

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
| `/voix` | `evId, texte, lang, prev?, next?, voiceSettings?` | MP3 (20 000 caractères par passe, 10 000 pour une passe gratuite) |

VPS : `GET /vps/clients` avec `Authorization: Bearer <VPS_TOKEN>` (sous-domaine, port, clé SSH, ouvert ou non).

Invités : `GET /soiree?e=<code>` (fiche publique) et `POST /souhaiter` `{ code, texte, prenom, invite }`.

Erreurs : `{ "error": "<code>" }` avec le statut HTTP. Codes : `licence_absente`, `licence_invalide`, `json_invalide`, `champs_invalides`, `soiree_invalide`, `soiree_inconnue`, `soiree_terminee`, `soiree_commencee`, `soiree_non_ouverte`, `soiree_non_active`, `dates_verrouillees`, `aucune_passe`, `limite_abonnement`, `aucune_passe_attachee`, `souhaits_recus`, `code_invalide`, `souhait_invalide`, `max_souhaits`, `souhaits_pleins`, `texte_invalide`, `plafond_voix`, `voix_non_configuree`, `voix_echec`, `cle_ssh_invalide`, `non_autorise`.

## Courriel facultatif (page de vente)

`POST /abonner` (`{courriel, majs, payant, consentement: true, lang}`), puis les liens signés `GET /confirmer?t=` et `GET /desabonner?t=` des courriels. Au plus 60 confirmations par heure en tout (`trop_de_demandes`, 429). Double confirmation : le contact n'entre dans la liste Brevo qu'au clic de confirmation, et c'est là que le code de la première soirée gratuite est créé; le désabonnement le met sur liste noire. À brancher : définir les 5 variables ci-dessus, créer la liste dans Brevo (attributs `LANG`, `MAJS`, `PAYANT`), puis mettre `https://<déploiement>.convex.site/abonner` dans `LIENS.courriel` de `deploy/vps/site/index.html` (vide = formulaire caché). Courriels de mise à jour : ajouter le lien `/desabonner` de chaque contact (obligatoire, LCAP).
