// Gestion par Pat : npx convex run admin:creerClient '{"courriel":"…","sousDomaine":"…"}'
// Les clients qui paient sur le portail sont créés par paiement.ts (même fonction insererClientDb).
// La clé de licence n'est affichée qu'une fois (Convex n'en garde que l'empreinte).
import { v } from "convex/values";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { genererLicence, sha256, sousDomaineValide } from "./lib";
import { refus } from "./soirees";

const PORT_MIN = 20000; // ports des tunnels sur le VPS
const AN = 365 * 24 * 3600e3;

export const creerClient = internalAction({
  args: { courriel: v.string(), sousDomaine: v.string() },
  handler: async (ctx, a): Promise<{ licence: string; sousDomaine: string; portTunnel: number }> => {
    const licence = genererLicence();
    const portTunnel: number = await ctx.runMutation(internal.admin.insererClient, { ...a, licence: await sha256(licence) });
    return { licence, sousDomaine: a.sousDomaine, portTunnel };
  },
});

export async function insererClientDb(ctx: MutationCtx, a: { courriel: string; sousDomaine: string; licence: string }) {
  const sousDomaine = a.sousDomaine.toLowerCase();
  if (!sousDomaineValide(sousDomaine)) throw refus("sous_domaine_invalide");
  if (await ctx.db.query("clients").withIndex("par_sousDomaine", q => q.eq("sousDomaine", sousDomaine)).unique()) throw refus("sous_domaine_pris", 409);
  const dernier = await ctx.db.query("clients").withIndex("par_port").order("desc").first();
  const portTunnel = dernier ? dernier.portTunnel + 1 : PORT_MIN;
  const id = await ctx.db.insert("clients", { courriel: a.courriel.trim().toLowerCase(), sousDomaine, portTunnel, licence: a.licence, etat: "actif" });
  return { id, portTunnel };
}

export const insererClient = internalMutation({
  args: { courriel: v.string(), sousDomaine: v.string(), licence: v.string() },
  handler: async (ctx, a) => (await insererClientDb(ctx, a)).portTunnel,
});

// Passe offerte (bêta, dépannage) : npx convex run admin:ajouterPasse '{"sousDomaine":"…"}'
export const ajouterPasse = internalMutation({
  // `quantite` et `expireLe` (ms) servent aux comptes à vie : '{"sousDomaine":"…","quantite":200,"expireLe":4102444800000}'
  args: { sousDomaine: v.string(), origine: v.optional(v.union(v.literal("achat"), v.literal("abonnement"))), quantite: v.optional(v.number()), expireLe: v.optional(v.number()) },
  handler: async (ctx, { sousDomaine, origine, quantite, expireLe }) => {
    const c = await ctx.db.query("clients").withIndex("par_sousDomaine", q => q.eq("sousDomaine", sousDomaine)).unique();
    if (!c) throw refus("client_inconnu", 404);
    let id;
    for (let i = 0; i < Math.min(quantite ?? 1, 500); i++) id = await ctx.db.insert("passes", { clientId: c._id, origine: origine ?? "achat", etat: "libre", expireLe: expireLe ?? Date.now() + AN, voixCaracteres: 0 });
    return id;
  },
});

export const suspendre = internalMutation({
  args: { sousDomaine: v.string(), actif: v.boolean() },
  handler: async (ctx, { sousDomaine, actif }) => {
    const c = await ctx.db.query("clients").withIndex("par_sousDomaine", q => q.eq("sousDomaine", sousDomaine)).unique();
    if (!c) throw refus("client_inconnu", 404);
    await ctx.db.patch(c._id, { etat: actif ? "actif" : "suspendu" });
  },
});
