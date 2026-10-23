// Règles des soirées payantes (docs/modele-affaires.md, section 9). Fonctions internes : seules les routes HTTP (http.ts),
// qui vérifient la clé de licence ou l'empreinte du code, les appellent. Le contrôle du paiement se fait ici, jamais sur le PC du client.
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export const MARGE = 6 * 3600e3; // une soirée reste ouverte jusqu'à sa fin prévue + 6 h (comme eventStatus du serveur local)
export const PLAFOND_VOIX = 20000; // caractères de voix incluse par passe
export const SOUHAITS_PAR_INVITE = 3;
export const SOUHAITS_PAR_SOIREE = 400;
const OUVERTES_ABONNEMENT = 2; // abonnement : 1 soirée en cours + les souhaits de la suivante

// Erreur renvoyée telle quelle par http.ts : { error: code } avec ce statut HTTP
export const refus = (code: string, status = 400) => new ConvexError({ code, status });

const terminee = (s: Doc<"soirees">, now: number) => now > s.finTs + MARGE;
async function passeDe(ctx: QueryCtx, s: Doc<"soirees">) {
  return s.passeId ? await ctx.db.get(s.passeId) : null;
}
// soirée ouverte : passe attachée et pas terminée (souhaits d'avance, adresse publique, voix)
async function ouverte(ctx: QueryCtx, s: Doc<"soirees">, now: number) {
  const p = await passeDe(ctx, s);
  return !!p && p.etat === "attachee" && !terminee(s, now);
}
async function soireeDuClient(ctx: QueryCtx, clientId: Id<"clients">, evId: string) {
  return await ctx.db.query("soirees").withIndex("par_client_ev", q => q.eq("clientId", clientId).eq("evId", evId)).unique();
}

export const clientParLicence = internalQuery({
  args: { licence: v.string() },
  handler: async (ctx, { licence }) => {
    const c = await ctx.db.query("clients").withIndex("par_licence", q => q.eq("licence", licence)).unique();
    return c && c.etat === "actif" ? c : null;
  },
});

// Ce que le serveur local doit savoir : passes libres et soirées publiées (ouvertes ou non)
export const droits = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const now = Date.now(), c = (await ctx.db.get(clientId))!;
    const libres = (await ctx.db.query("passes").withIndex("par_client_etat", q => q.eq("clientId", clientId).eq("etat", "libre")).collect())
      .filter(p => p.expireLe > now);
    const soirees = await ctx.db.query("soirees").withIndex("par_client_ev", q => q.eq("clientId", clientId)).collect();
    return {
      sousDomaine: c.sousDomaine,
      passesLibres: { achat: libres.filter(p => p.origine === "achat").length, abonnement: libres.filter(p => p.origine === "abonnement").length },
      soirees: await Promise.all(soirees.filter(s => !terminee(s, now)).map(async s => {
        const p = await passeDe(ctx, s);
        return { evId: s.evId, nom: s.nom, date: s.date, debut: s.debut, fin: s.fin, lang: s.lang,
          passe: p ? p.etat : null, ouverte: await ouverte(ctx, s, now), voixRestante: p ? Math.max(0, PLAFOND_VOIX - p.voixCaracteres) : 0 };
      })),
    };
  },
});

const champsSoiree = {
  evId: v.string(), empreinteCode: v.string(), nom: v.string(), date: v.string(), debut: v.string(), fin: v.string(),
  debutTs: v.number(), finTs: v.number(), lang: v.union(v.literal("fr"), v.literal("en")), lieu: v.string(), accueil: v.string(), merci: v.string(),
};
// Crée ou met à jour la soirée. Passe attachée : dates verrouillées, sauf un report demandé avant le début (tempête, report).
export const publierSoiree = internalMutation({
  args: { clientId: v.id("clients"), ...champsSoiree },
  handler: async (ctx, a) => {
    if (!/^[\w-]{1,64}$/.test(a.evId) || !/^[a-f0-9]{64}$/.test(a.empreinteCode) || !/^\d{4}-\d{2}-\d{2}$/.test(a.date)
      || !/^\d{2}:\d{2}$/.test(a.debut) || !/^\d{2}:\d{2}$/.test(a.fin) || !(a.finTs > a.debutTs) || a.finTs - a.debutTs > 48 * 3600e3) throw refus("soiree_invalide");
    const now = Date.now();
    const texte = { nom: a.nom.trim().slice(0, 60), lieu: a.lieu.trim().slice(0, 80), accueil: a.accueil.trim().slice(0, 300), merci: a.merci.trim().slice(0, 300) };
    if (!texte.nom) throw refus("soiree_invalide");
    const { clientId, ...reste } = a, champs = { ...reste, ...texte };
    const s = await soireeDuClient(ctx, clientId, a.evId);
    if (!s) return { soireeId: await ctx.db.insert("soirees", { clientId, ...champs }) };
    const p = await passeDe(ctx, s), datesChangees = s.debutTs !== a.debutTs || s.finTs !== a.finTs;
    if (p && p.etat === "attachee" && datesChangees && (now >= s.debutTs || a.debutTs < s.debutTs)) throw refus("dates_verrouillees", 409);
    await ctx.db.patch(s._id, champs);
    return { soireeId: s._id };
  },
});

// « Utiliser une passe » sur un événement publié : passe d'abonnement d'abord (elle expire plus tôt), puis passe achetée
export const attacherPasse = internalMutation({
  args: { clientId: v.id("clients"), evId: v.string() },
  handler: async (ctx, { clientId, evId }) => {
    const now = Date.now(), s = await soireeDuClient(ctx, clientId, evId);
    if (!s) throw refus("soiree_inconnue", 404);
    if (terminee(s, now)) throw refus("soiree_terminee", 409);
    const actuelle = await passeDe(ctx, s);
    if (actuelle && actuelle.etat === "attachee") return { passeId: actuelle._id, deja: true };
    const libres = (await ctx.db.query("passes").withIndex("par_client_etat", q => q.eq("clientId", clientId).eq("etat", "libre")).collect())
      .filter(p => p.expireLe > now).sort((x, y) => (x.origine === y.origine ? x.expireLe - y.expireLe : x.origine === "abonnement" ? -1 : 1));
    const attachees = await ctx.db.query("passes").withIndex("par_client_etat", q => q.eq("clientId", clientId).eq("etat", "attachee")).collect();
    let ouvertesAbo = 0;
    for (const p of attachees) if (p.origine === "abonnement" && p.soireeId) { const x = await ctx.db.get(p.soireeId); if (x && !terminee(x, now)) ouvertesAbo++; }
    const passe = libres.find(p => p.origine === "achat" || ouvertesAbo < OUVERTES_ABONNEMENT);
    if (!passe) throw refus(libres.length ? "limite_abonnement" : "aucune_passe", 402);
    await ctx.db.patch(passe._id, { etat: "attachee", soireeId: s._id });
    await ctx.db.patch(s._id, { passeId: passe._id });
    return { passeId: passe._id, deja: false };
  },
});

// Erreur de bonne foi : détacher gratuitement avant le début, si aucun souhait n'est arrivé
export const detacherPasse = internalMutation({
  args: { clientId: v.id("clients"), evId: v.string() },
  handler: async (ctx, { clientId, evId }) => {
    const s = await soireeDuClient(ctx, clientId, evId), p = s && await passeDe(ctx, s);
    if (!s || !p || p.etat !== "attachee") throw refus("aucune_passe_attachee", 404);
    if (Date.now() >= s.debutTs) throw refus("soiree_commencee", 409);
    if (await ctx.db.query("souhaits").withIndex("par_soiree", q => q.eq("soireeId", s._id)).first()) throw refus("souhaits_recus", 409);
    await ctx.db.patch(p._id, { etat: "libre", soireeId: undefined });
    await ctx.db.patch(s._id, { passeId: undefined });
    return { ok: true };
  },
});

// Souhaits recueillis pendant que le PC était éteint : remis une seule fois au serveur local
export const prendreSouhaits = internalMutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const out: { evId: string; texte: string; prenom: string; invite: string; recu: number }[] = [];
    for (const s of await ctx.db.query("soirees").withIndex("par_client_ev", q => q.eq("clientId", clientId)).collect()) {
      const neufs = await ctx.db.query("souhaits").withIndex("par_soiree_recupere", q => q.eq("soireeId", s._id).eq("recupere", false)).take(400);
      for (const w of neufs) { await ctx.db.patch(w._id, { recupere: true }); out.push({ evId: s.evId, texte: w.texte, prenom: w.prenom, invite: w.invite, recu: w.recu }); }
    }
    return out;
  },
});

// Voix incluse : réserve les caractères avant l'appel à ElevenLabs (rendus si l'appel échoue)
export const reserverVoix = internalMutation({
  args: { clientId: v.id("clients"), evId: v.string(), n: v.number() },
  handler: async (ctx, { clientId, evId, n }) => {
    const s = await soireeDuClient(ctx, clientId, evId), p = s && await passeDe(ctx, s);
    if (!s || !p || !(await ouverte(ctx, s, Date.now()))) throw refus("soiree_non_ouverte", 402);
    if (p.voixCaracteres + n > PLAFOND_VOIX) throw refus("plafond_voix", 429);
    await ctx.db.patch(p._id, { voixCaracteres: p.voixCaracteres + n });
    return { passeId: p._id };
  },
});
export const rendreVoix = internalMutation({
  args: { passeId: v.id("passes"), n: v.number() },
  handler: async (ctx, { passeId, n }) => {
    const p = await ctx.db.get(passeId);
    if (p) await ctx.db.patch(passeId, { voixCaracteres: Math.max(0, p.voixCaracteres - n) });
  },
});

// ---------- Invités (page des souhaits sur <client>.djvinny.ca), par l'empreinte du code du QR ----------
async function soireeParEmpreinte(ctx: QueryCtx, empreinte: string) {
  const s = await ctx.db.query("soirees").withIndex("par_empreinte", q => q.eq("empreinteCode", empreinte)).first();
  const c = s && await ctx.db.get(s.clientId);
  return s && c && c.etat === "actif" ? s : null;
}
// Fiche publique de la soirée (nom, date, langue, messages) ; statut : a_venir | en_cours | terminee | non_active (pas payée)
export const soireePublique = internalQuery({
  args: { empreinte: v.string() },
  handler: async (ctx, { empreinte }) => {
    const now = Date.now(), s = await soireeParEmpreinte(ctx, empreinte);
    if (!s) return null;
    const statut = terminee(s, now) ? "terminee" : !(await ouverte(ctx, s, now)) ? "non_active" : now >= s.debutTs ? "en_cours" : "a_venir";
    return { nom: s.nom, date: s.date, debut: s.debut, fin: s.fin, lang: s.lang, lieu: s.lieu, accueil: s.accueil, merci: s.merci, statut };
  },
});
export const souhaiter = internalMutation({
  args: { empreinte: v.string(), texte: v.string(), prenom: v.string(), invite: v.string() },
  handler: async (ctx: MutationCtx, a) => {
    const s = await soireeParEmpreinte(ctx, a.empreinte);
    if (!s) throw refus("code_invalide", 403);
    if (!(await ouverte(ctx, s, Date.now()))) throw refus(terminee(s, Date.now()) ? "soiree_terminee" : "soiree_non_active", 403);
    const texte = a.texte.replace(/\s+/g, " ").trim().slice(0, 80), prenom = a.prenom.replace(/[^\p{L}\p{N} '-]/gu, "").trim().slice(0, 20);
    if (texte.length < 3 || !/^[\w.-]{1,64}$/.test(a.invite)) throw refus("souhait_invalide");
    const miens = await ctx.db.query("souhaits").withIndex("par_soiree_invite", q => q.eq("soireeId", s._id).eq("invite", a.invite)).collect();
    if (miens.length >= SOUHAITS_PAR_INVITE) throw refus("max_souhaits", 429);
    if ((await ctx.db.query("souhaits").withIndex("par_soiree", q => q.eq("soireeId", s._id)).take(SOUHAITS_PAR_SOIREE)).length >= SOUHAITS_PAR_SOIREE) throw refus("souhaits_pleins", 429);
    await ctx.db.insert("souhaits", { soireeId: s._id, texte, prenom, invite: a.invite, recu: Date.now(), recupere: false });
    return { ok: true };
  },
});

// ---------- Chaque heure (crons.ts) : passes d'une soirée finie -> utilisée ; passes libres périmées -> expirée ----------
export const expirer = internalMutation({
  args: {},
  handler: async ctx => {
    const now = Date.now();
    for (const p of await ctx.db.query("passes").withIndex("par_etat", q => q.eq("etat", "attachee")).collect()) {
      const s = p.soireeId && await ctx.db.get(p.soireeId);
      if (!s || terminee(s, now)) await ctx.db.patch(p._id, { etat: "utilisee" });
    }
    for (const p of await ctx.db.query("passes").withIndex("par_etat", q => q.eq("etat", "libre")).collect())
      if (p.expireLe <= now) await ctx.db.patch(p._id, { etat: "expiree" });
  },
});
