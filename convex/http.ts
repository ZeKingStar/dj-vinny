// Routes HTTP de la partie payante : https://<déploiement>.convex.site/...
// Serveur local du client : en-tête « Authorization: Bearer <clé de licence> », corps JSON. Réponse JSON, ou { error: code } avec un statut.
// Invités (page des souhaits sur <client>.djvinny.ca) : /soiree et /souhaiter, avec le code du QR (jamais gardé en clair).
import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { sha256, sousDomaineValide } from "./lib";
import { creerSession, creerCodeEssai, normaliser, signatureValide } from "./paiement";
import { signer, verifier, page, brevo } from "./abonnes";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });
const erreur = (code: string, status: number) => json({ error: code }, status);

// Lit le corps, vérifie la clé de licence, puis exécute fn ; les refus des règles (soirees.ts) deviennent { error: code }
const licencie = (fn: (ctx: ActionCtx, client: Doc<"clients">, body: any) => Promise<Response>) => httpAction(async (ctx, req) => {
  const cle = /^Bearer (djv_[a-f0-9]{48})$/.exec(req.headers.get("Authorization") || "");
  if (!cle) return erreur("licence_absente", 401);
  const client = await ctx.runQuery(internal.soirees.clientParLicence, { licence: await sha256(cle[1]) });
  if (!client) return erreur("licence_invalide", 401);
  let body: any = {};
  try { body = req.method === "POST" ? await req.json() : {}; } catch { return erreur("json_invalide", 400); }
  return await attrape(() => fn(ctx, client, body || {}));
});
async function attrape(fn: () => Promise<Response>) {
  try { return await fn(); } catch (e) {
    if (e instanceof ConvexError) { const d = e.data as { code: string; status: number }; return erreur(d.code, d.status); }
    if (e instanceof Error && /ArgumentValidationError|Validator/.test(e.message)) return erreur("champs_invalides", 400);
    throw e;
  }
}
const texte = (x: unknown) => (typeof x === "string" ? x : "");

const http = httpRouter();
const route = (path: string, handler: ReturnType<typeof httpAction>) => {
  http.route({ path, method: "POST", handler });
  http.route({ path, method: "OPTIONS", handler: httpAction(async () => new Response(null, { status: 204, headers: CORS })) });
};

route("/droits", licencie(async (ctx, c) => json(await ctx.runQuery(internal.soirees.droits, { clientId: c._id }))));

route("/publier-soiree", licencie(async (ctx, c, b) => {
  const code = texte(b.code); // le serveur local envoie le code du QR ; seule son empreinte est gardée
  if (code.length < 8) return erreur("soiree_invalide", 400);
  return json(await ctx.runMutation(internal.soirees.publierSoiree, {
    clientId: c._id, evId: texte(b.evId), empreinteCode: await sha256(code), nom: texte(b.nom), date: texte(b.date), debut: texte(b.debut), fin: texte(b.fin),
    debutTs: Number(b.debutTs), finTs: Number(b.finTs), lang: b.lang === "en" ? "en" : "fr", lieu: texte(b.lieu), accueil: texte(b.accueil), merci: texte(b.merci),
  }));
}));

route("/attacher-passe", licencie(async (ctx, c, b) => json(await ctx.runMutation(internal.soirees.attacherPasse, { clientId: c._id, evId: texte(b.evId) }))));
route("/detacher-passe", licencie(async (ctx, c, b) => json(await ctx.runMutation(internal.soirees.detacherPasse, { clientId: c._id, evId: texte(b.evId) }))));
route("/cle-ssh", licencie(async (ctx, c, b) => json(await ctx.runMutation(internal.soirees.enregistrerCleSsh, { clientId: c._id, cle: texte(b.cle) }))));
route("/souhaits", licencie(async (ctx, c) => json({ souhaits: await ctx.runMutation(internal.soirees.prendreSouhaits, { clientId: c._id }) })));

// Voix de Vinny incluse : texte -> MP3 par ElevenLabs, avec la clé de Pop & Show (variable d'environnement Convex, jamais envoyée au client).
// Modèle et voix fixés ici (variables ELEVENLABS_MODEL, ELEVENLABS_VOICE_ID et ELEVENLABS_VOICE_ID_EN) : le client ne peut pas choisir un modèle plus cher.
route("/voix", licencie(async (ctx, c, b) => {
  const cle = process.env.ELEVENLABS_API_KEY;
  if (!cle) return erreur("voix_non_configuree", 503);
  const t = texte(b.texte).trim(), lang = b.lang === "en" ? "en" : "fr";
  if (!t || t.length > 400) return erreur("texte_invalide", 400);
  const { passeId } = await ctx.runMutation(internal.soirees.reserverVoix, { clientId: c._id, evId: texte(b.evId), n: t.length });
  // Felix Tabarnak (voix québécoise de la bibliothèque, à ajouter à « Mes voix ») dans les deux langues
  const voix = (lang === "en" ? process.env.ELEVENLABS_VOICE_ID_EN || "RBhYSNMNu6b2CGZ9Fn1M" : process.env.ELEVENLABS_VOICE_ID || "RBhYSNMNu6b2CGZ9Fn1M");
  const corps: Record<string, unknown> = { text: t, model_id: process.env.ELEVENLABS_MODEL || "eleven_v4_turbo", language_code: lang };
  if (b.prev) corps.previous_text = texte(b.prev).slice(0, 400);
  if (b.next) corps.next_text = texte(b.next).slice(0, 400);
  if (b.voiceSettings && typeof b.voiceSettings === "object") { // seuls les réglages connus passent à ElevenLabs
    const vs: Record<string, unknown> = {};
    for (const k of ["stability", "similarity_boost", "style", "speed"]) if (typeof b.voiceSettings[k] === "number" && isFinite(b.voiceSettings[k])) vs[k] = b.voiceSettings[k];
    if (typeof b.voiceSettings.use_speaker_boost === "boolean") vs.use_speaker_boost = b.voiceSettings.use_speaker_boost;
    corps.voice_settings = vs;
  }
  let r: Response | null = null;
  try {
    r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voix}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": cle, "Content-Type": "application/json", Accept: "audio/mpeg" }, body: JSON.stringify(corps),
    });
  } catch { r = null; }
  if (!r || !r.ok) {
    await ctx.runMutation(internal.soirees.rendreVoix, { passeId, n: t.length }); // échec : les caractères ne sont pas comptés
    console.error("ElevenLabs", r ? r.status + " " + (await r.text()).slice(0, 300) : "injoignable");
    return erreur("voix_echec", 502);
  }
  return new Response(await r.arrayBuffer(), { status: 200, headers: { "Content-Type": "audio/mpeg", ...CORS } });
}));

// ---------- Portail compte.djvinny.ca : paiement sans compte (paiement.ts) ----------
route("/checkout", httpAction(async (ctx, req) => {
  let b: any = {};
  try { b = await req.json(); } catch { return erreur("json_invalide", 400); }
  const courriel = texte(b?.courriel).trim().toLowerCase(), sousDomaine = texte(b?.sousDomaine).trim().toLowerCase();
  const offre = b?.offre === "abonnement" ? "abonnement" : "soiree", lang = b?.lang === "en" ? "en" : "fr";
  if (courriel.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(courriel)) return erreur("courriel_invalide", 400);
  const etat = await ctx.runQuery(internal.paiement.verifier, { courriel, sousDomaine });
  if (etat.suspendu) return erreur("client_suspendu", 403);
  if (!etat.existant) { // un nouveau client choisit son adresse ; un client existant achète pour son adresse actuelle
    if (!sousDomaineValide(sousDomaine)) return erreur("sous_domaine_invalide", 400);
    if (etat.pris) return erreur("sous_domaine_pris", 409);
  }
  try { return json({ url: await creerSession({ offre, courriel, sousDomaine, lang }) }); }
  catch (e) { console.error("checkout", e); return erreur("paiement_indisponible", 502); }
}));

// Webhook Stripe (événements : checkout.session.completed, invoice.paid). Signature vérifiée avant tout ; une erreur renvoie 500 et Stripe réessaie.
http.route({ path: "/stripe", method: "POST", handler: httpAction(async (ctx, req) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return erreur("webhook_non_configure", 503);
  const corps = await req.text();
  if (!(await signatureValide(corps, req.headers.get("Stripe-Signature") || "", secret))) return erreur("signature_invalide", 400);
  let evt: any;
  try { evt = JSON.parse(corps); } catch { return erreur("json_invalide", 400); }
  const a = normaliser(evt);
  if (a) {
    try { await ctx.runAction(internal.paiement.traiter, a); }
    catch (e) { console.error("stripe", evt.id, e); return erreur("traitement_echoue", 500); }
  }
  return json({ recu: true });
}) });

// ---------- VPS : liste lue chaque minute par deploy/vps/djvinny-sync.py (jeton VPS_TOKEN, variable d'environnement Convex) ----------
http.route({ path: "/vps/clients", method: "GET", handler: httpAction(async (ctx, req) => {
  const jeton = process.env.VPS_TOKEN, recu = /^Bearer (.+)$/.exec(req.headers.get("Authorization") || "");
  if (!jeton || !recu || (await sha256(recu[1])) !== (await sha256(jeton))) return erreur("non_autorise", 401); // comparaison d'empreintes : même durée quel que soit le jeton
  return json({ clients: await ctx.runQuery(internal.soirees.vpsClients, {}) });
}) });

// ---------- Invités ----------
http.route({ path: "/soiree", method: "GET", handler: httpAction(async (ctx, req) => {
  const code = new URL(req.url).searchParams.get("e") || "";
  const s = code.length >= 8 ? await ctx.runQuery(internal.soirees.soireePublique, { empreinte: await sha256(code) }) : null;
  return s ? json(s) : erreur("code_invalide", 403);
}) });
route("/souhaiter", httpAction(async (ctx, req) => {
  let b: any = {};
  try { b = await req.json(); } catch { return erreur("json_invalide", 400); }
  const code = texte(b?.code);
  if (code.length < 8) return erreur("code_invalide", 403);
  return await attrape(async () => json(await ctx.runMutation(internal.soirees.souhaiter, {
    empreinte: await sha256(code), texte: texte(b.texte), prenom: texte(b.prenom), invite: texte(b.invite),
  })));
}));

// ---------- Courriel facultatif de la page de vente : /abonner (POST), /confirmer et /desabonner (liens des courriels) ----------
// Tant que BREVO_API_KEY et ABONNES_SECRET ne sont pas définies, l'inscription est seulement gardée (état « attente », voir convex/README.md)
route("/abonner", httpAction(async (ctx, req) => {
  let b: any = {};
  try { b = await req.json(); } catch { return erreur("json_invalide", 400); }
  const courriel = texte(b?.courriel).trim().toLowerCase();
  if (b?.consentement !== true) return erreur("consentement_requis", 400);
  if (courriel.length > 254 || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(courriel)) return erreur("courriel_invalide", 400);
  const majs = b.majs === true, payant = b.payant === true;
  if (!majs && !payant) return erreur("choix_requis", 400);
  const lang = b.lang === "en" ? "en" : "fr";
  const r = await ctx.runMutation(internal.abonnes.inscrire, { courriel, lang, majs, payant });
  if (r.limite) return erreur("trop_de_demandes", 429);
  // Sans Brevo : l'adresse et le consentement sont gardés en « attente » ; la confirmation par courriel partira quand Brevo sera configuré
  if (!process.env.BREVO_API_KEY || !process.env.ABONNES_SECRET) return json({ ok: true, confirmation: false });
  if (r.envoyer && !(await brevo.confirmation(courriel, lang, `${process.env.CONVEX_SITE_URL}/confirmer?t=${await signer("c", courriel)}`))) return erreur("envoi_echec", 502);
  return json({ ok: true }); // même réponse que le courriel soit déjà inscrit ou non
}));
http.route({ path: "/confirmer", method: "GET", handler: httpAction(async (ctx, req) => {
  const c = await verifier("c", new URL(req.url).searchParams.get("t") || "");
  const a = c && await ctx.runMutation(internal.abonnes.confirmer, { courriel: c });
  if (!c || !a) return page("lien", "fr");
  if (!(await brevo.ajouter(a))) return page("erreur", a.lang);
  // Première soirée gratuite : un code Stripe par courriel confirmé, montré sur la page et envoyé par courriel (une seule fois)
  let code: string | null = a.codeEssai && (a.codeExpireLe ?? 0) > Date.now() ? a.codeEssai : null;
  if (!a.codeEssai) {
    const n = await creerCodeEssai(c);
    if (n && await ctx.runMutation(internal.abonnes.memoriserCode, { courriel: c, code: n.code, expireLe: n.expireLe })) {
      code = n.code;
      await brevo.code(c, a.lang, n.code);
    }
  }
  return page("confirme", a.lang, `${process.env.CONVEX_SITE_URL}/desabonner?t=${await signer("d", c)}`, code);
}) });
http.route({ path: "/desabonner", method: "GET", handler: httpAction(async (ctx, req) => {
  const c = await verifier("d", new URL(req.url).searchParams.get("t") || "");
  const a = c && await ctx.runMutation(internal.abonnes.desabonner, { courriel: c });
  if (!c || !a) return page("lien", "fr");
  if (!(await brevo.retirer(c))) return page("erreur", a.lang);
  return page("desabonne", a.lang);
}) });

export default http;
