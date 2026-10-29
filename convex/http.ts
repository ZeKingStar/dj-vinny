// Routes HTTP de la partie payante : https://<déploiement>.convex.site/...
// Serveur local du client : en-tête « Authorization: Bearer <clé de licence> », corps JSON. Réponse JSON, ou { error: code } avec un statut.
// Invités (page des souhaits sur <client>.djvinny.ca) : /soiree et /souhaiter, avec le code du QR (jamais gardé en clair).
import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { sha256 } from "./lib";
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
// Modèle et voix fixés ici (variables ELEVENLABS_MODEL et ELEVENLABS_VOICE_ID) : le client ne peut pas choisir un modèle plus cher.
route("/voix", licencie(async (ctx, c, b) => {
  const cle = process.env.ELEVENLABS_API_KEY;
  if (!cle) return erreur("voix_non_configuree", 503);
  const t = texte(b.texte).trim(), lang = b.lang === "en" ? "en" : "fr";
  if (!t || t.length > 400) return erreur("texte_invalide", 400);
  const { passeId } = await ctx.runMutation(internal.soirees.reserverVoix, { clientId: c._id, evId: texte(b.evId), n: t.length });
  const voix = process.env.ELEVENLABS_VOICE_ID || "TX3LPaxmHKxFdv7VOQHJ"; // Liam
  const corps: Record<string, unknown> = { text: t, model_id: process.env.ELEVENLABS_MODEL || "eleven_v3", language_code: lang };
  if (b.prev) corps.previous_text = texte(b.prev).slice(0, 400);
  if (b.next) corps.next_text = texte(b.next).slice(0, 400);
  if (b.voiceSettings && typeof b.voiceSettings === "object") corps.voice_settings = b.voiceSettings;
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
  return page("confirme", a.lang, `${process.env.CONVEX_SITE_URL}/desabonner?t=${await signer("d", c)}`);
}) });
http.route({ path: "/desabonner", method: "GET", handler: httpAction(async (ctx, req) => {
  const c = await verifier("d", new URL(req.url).searchParams.get("t") || "");
  const a = c && await ctx.runMutation(internal.abonnes.desabonner, { courriel: c });
  if (!c || !a) return page("lien", "fr");
  if (!(await brevo.retirer(c))) return page("erreur", a.lang);
  return page("desabonne", a.lang);
}) });

export default http;
