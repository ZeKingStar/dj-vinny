// Gestion par Pat, en attendant le portail (étape 4) : npx convex run admin:creerClient '{"courriel":"…","sousDomaine":"…"}'
// La clé de licence n'est affichée qu'une fois (Convex n'en garde que l'empreinte).
import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { sha256 } from "./lib";
import { refus } from "./soirees";

const PORT_MIN = 20000; // ports des tunnels sur le VPS
const AN = 365 * 24 * 3600e3;

export const creerClient = internalAction({
  args: { courriel: v.string(), sousDomaine: v.string() },
  handler: async (ctx, a): Promise<{ licence: string; sousDomaine: string; portTunnel: number }> => {
    const octets = crypto.getRandomValues(new Uint8Array(24));
    const licence = "djv_" + Array.from(octets, b => b.toString(16).padStart(2, "0")).join("");
    const portTunnel: number = await ctx.runMutation(internal.admin.insererClient, { ...a, licence: await sha256(licence) });
    return { licence, sousDomaine: a.sousDomaine, portTunnel };
  },
});

export const insererClient = internalMutation({
  args: { courriel: v.string(), sousDomaine: v.string(), licence: v.string() },
  handler: async (ctx, a) => {
    const sousDomaine = a.sousDomaine.toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(sousDomaine) || ["www", "app", "compte", "api", "admin"].includes(sousDomaine)) throw refus("sous_domaine_invalide");
    if (await ctx.db.query("clients").withIndex("par_sousDomaine", q => q.eq("sousDomaine", sousDomaine)).unique()) throw refus("sous_domaine_pris", 409);
    const dernier = await ctx.db.query("clients").withIndex("par_port").order("desc").first();
    const portTunnel = dernier ? dernier.portTunnel + 1 : PORT_MIN;
    await ctx.db.insert("clients", { courriel: a.courriel.trim(), sousDomaine, portTunnel, licence: a.licence, etat: "actif" });
    return portTunnel;
  },
});

// Passe offerte (bêta, dépannage) : npx convex run admin:ajouterPasse '{"sousDomaine":"…"}'
export const ajouterPasse = internalMutation({
  args: { sousDomaine: v.string(), origine: v.optional(v.union(v.literal("achat"), v.literal("abonnement"))) },
  handler: async (ctx, { sousDomaine, origine }) => {
    const c = await ctx.db.query("clients").withIndex("par_sousDomaine", q => q.eq("sousDomaine", sousDomaine)).unique();
    if (!c) throw refus("client_inconnu", 404);
    return await ctx.db.insert("passes", { clientId: c._id, origine: origine ?? "achat", etat: "libre", expireLe: Date.now() + AN, voixCaracteres: 0 });
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
