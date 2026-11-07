# Lancement de DJ Vinny : où on en est

Branche `claude/commercial-3a1b01`, dossier `.claude/worktrees/commercial-3a1b01`. Convex de développement : `fantastic-dogfish-493`. Production : `shocking-marten-220`.

## Vérifié en mode test (Convex dev, Stripe test, Brevo)

- Page de vente : courriel → confirmation (double consentement) → code promo `VINNY-XXXXXXXX` (coupon `essai-vinny`, 100 %, passe soirée seulement) → Checkout à 0 $ → passe (plafond de voix 10 000) → courriel de licence.
- Voix : Felix Tabarnak (`RBhYSNMNu6b2CGZ9Fn1M`), français et anglais, modèle `eleven_v4_turbo`. 70 clips de la version gratuite régénérés (`voix/`).
- Sécurité : webhook Stripe filtré (`metadata.offre`, prix d'abonnement), 60 confirmations par heure, plafond de voix par passe.
- Page de paiement : « DJ Vinny » (au lieu de « GMAO ») pour ces sessions seulement, via `branding_settings` ; l'icône `https://djvinny.ca/vinny-512.png` s'affichera une fois le site déployé.

## À faire, dans l'ordre

1. **ElevenLabs** : vérifier le forfait (Paramètres → Abonnement). Gratuit = usage non commercial ; Starter suffit pour commencer, Creator avant le lancement (crédits à la demande). Écrire à ElevenLabs (texte plus bas).
2. **VPS** : copier `deploy/vps/` puis `sudo bash maj-site.sh` (page, `vinny-512.png`, relais `/confirmer` et `/desabonner` vers Convex de production).
3. **Production Convex** : `npx convex env set --prod ...` ou `.\convex\definir-variables.ps1 -Prod -Env .env.local` avec les clés **réelles** (Stripe `sk_live`/`rk_live`, secret du webhook de production, prix réels), plus `ABONNES_BASE_URL=https://djvinny.ca`, `BREVO_LIST_ID`, `BREVO_SENDER`, `ABONNES_SECRET` (nouvelle valeur aléatoire), `STRIPE_COUPON_ESSAI`.
4. **Stripe réel** : refaire le coupon (100 %, une fois, produit « Passe soirée »), donner à la clé restreinte « Promotion Codes : Écriture » et « Coupons : Lecture », créer le webhook `https://shocking-marten-220.convex.site/stripe` (événements `checkout.session.completed`, `invoice.paid`).
5. **Activer** : `LIENS.acheter`, `LIENS.courriel` et `LIENS.telecharger` dans `deploy/vps/site/index.html`, puis le ZIP sur GitHub (`DJ-Vinny-windows.zip`).
6. **Test du ZIP** sur un autre PC.
7. **Plus tard** : 50 % sur la deuxième soirée (code envoyé après le premier achat).

## Courriel à ElevenLabs (à envoyer, en anglais)

> Subject: Confirmation of API usage for an application (voice included)
>
> Hello,
>
> Pop & Show (Quebec, Canada) distributes DJ Vinny, software that hosts live parties. Our customers install it on their own PC. When a guest requests a song, our service calls the ElevenLabs API with our own API key and a voice from the Voice Library (Felix Tabarnak) to generate a short announcement (under 400 characters), and returns only the resulting MP3 file to the customer's software. The customer never has access to our API key or to the API itself, cannot choose the model or the voice, and each party has a character cap.
>
> Could you please confirm that this use is permitted under the ElevenAPI Terms (Customer Application) with our paid plan? Thank you.
