// Paiement sans compte (étape 4) : Stripe Checkout depuis compte.djvinny.ca, puis webhook Stripe -> client, passes, courriel de licence (Brevo).
// Le client est identifié par son courriel et son client Stripe. Sa clé de licence n'existe en clair que dans le courriel envoyé.
// Variables d'environnement Convex : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_SOIREE, STRIPE_PRICE_ABONNEMENT, BREVO_API_KEY, PORTAIL_URL (facultatif).
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { genererLicence, sha256, sousDomaineValide } from "./lib";
import { insererClientDb } from "./admin";
import { refus } from "./soirees";

const JOUR = 24 * 3600e3;
const PASSES_ABONNEMENT = 4; // par mois de facturation
const portail = () => process.env.PORTAIL_URL || "https://compte.djvinny.ca";

// ---------- Checkout ----------
export const verifier = internalQuery({
  args: { courriel: v.string(), sousDomaine: v.string() },
  handler: async (ctx, a) => {
    const c = await ctx.db.query("clients").withIndex("par_courriel", q => q.eq("courriel", a.courriel)).first();
    const pris = await ctx.db.query("clients").withIndex("par_sousDomaine", q => q.eq("sousDomaine", a.sousDomaine)).unique();
    return { existant: !!c, suspendu: c?.etat === "suspendu", pris: !!pris };
  },
});

// Crée la session Stripe Checkout et renvoie son adresse. Le sous-domaine voulu voyage dans les métadonnées jusqu'au webhook.
export async function creerSession(p: { offre: "soiree" | "abonnement"; courriel: string; sousDomaine: string; lang: "fr" | "en" }) {
  const cle = process.env.STRIPE_SECRET_KEY, prix = p.offre === "soiree" ? process.env.STRIPE_PRICE_SOIREE : process.env.STRIPE_PRICE_ABONNEMENT;
  if (!cle || !prix) throw new Error("Stripe non configuré (STRIPE_SECRET_KEY, STRIPE_PRICE_SOIREE, STRIPE_PRICE_ABONNEMENT)");
  const meta = { sousDomaine: p.sousDomaine, lang: p.lang, offre: p.offre };
  const f = new URLSearchParams({
    mode: p.offre === "soiree" ? "payment" : "subscription", "line_items[0][price]": prix, "line_items[0][quantity]": "1",
    customer_email: p.courriel, locale: p.lang, success_url: `${portail()}/?merci=1&lang=${p.lang}`, cancel_url: `${portail()}/?offre=${p.offre}&lang=${p.lang}`,
  });
  if (p.offre === "soiree") f.set("customer_creation", "always"); // un client Stripe pour retrouver l'acheteur aux achats suivants
  for (const [k, x] of Object.entries(meta)) f.set(`metadata[${k}]`, x);
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/x-www-form-urlencoded" }, body: f });
  const s: any = await r.json().catch(() => ({}));
  if (!r.ok || !s.url) throw new Error("Stripe " + r.status + " " + JSON.stringify(s.error || s).slice(0, 300));
  return s.url as string;
}

// ---------- Webhook ----------
// Stripe-Signature : t=<secondes>,v1=<HMAC-SHA256 hex de « t.corps »> ; refus au-delà de 5 minutes
export async function signatureValide(corps: string, entete: string, secret: string, maintenant = Date.now()) {
  const t = /(?:^|,)t=(\d+)/.exec(entete)?.[1];
  const sigs = [...entete.matchAll(/v1=([a-f0-9]+)/g)].map(m => m[1]);
  if (!t || !sigs.length || Math.abs(maintenant / 1000 - Number(t)) > 300) return false;
  const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const data = new TextEncoder().encode(`${t}.${corps}`);
  for (const s of sigs) {
    const octets = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16)));
    if (await crypto.subtle.verify("HMAC", cle, octets, data)) return true; // comparaison en temps constant
  }
  return false;
}

const argsEvenement = {
  stripeId: v.string(), // session ou facture : un événement reçu deux fois ne crée rien de plus
  genre: v.union(v.literal("passe"), v.literal("abonnement"), v.literal("client")), // « client » : abonnement souscrit, les passes viennent de la facture
  courriel: v.optional(v.string()), customer: v.optional(v.string()),
  sousDomaine: v.string(), lang: v.union(v.literal("fr"), v.literal("en")),
  montant: v.number(), devise: v.string(), nbPasses: v.number(), expireLe: v.number(),
};

// Événement Stripe -> arguments de traiter, ou null si l'événement ne nous concerne pas
export function normaliser(e: any) {
  const o = e?.data?.object;
  if (!o) return null;
  const sans = <T extends object>(x: T) => Object.fromEntries(Object.entries(x).filter(([, y]) => y !== undefined)) as T;
  if (e.type === "checkout.session.completed") {
    const courriel = String(o.customer_details?.email || o.customer_email || "").trim().toLowerCase();
    if (!courriel || (o.payment_status !== "paid" && o.payment_status !== "no_payment_required")) return null;
    const base = { courriel, customer: o.customer || undefined, sousDomaine: String(o.metadata?.sousDomaine || ""), lang: o.metadata?.lang === "en" ? "en" as const : "fr" as const, devise: String(o.currency || "cad") };
    if (o.mode === "payment") return sans({ ...base, stripeId: o.id, genre: "passe" as const, montant: o.amount_total ?? 0, nbPasses: 1, expireLe: Date.now() + 365 * JOUR });
    if (o.mode === "subscription") return sans({ ...base, stripeId: o.id, genre: "client" as const, montant: 0, nbPasses: 0, expireLe: 0 });
    return null;
  }
  if (e.type === "invoice.paid") {
    if (!(o.subscription || o.parent?.subscription_details?.subscription) || !o.customer) return null;
    const fin = Number(o.lines?.data?.[0]?.period?.end) * 1000;
    // un abonnement crée un nouveau client Stripe : si l'identifiant est inconnu, le courriel de la facture retrouve le client
    return sans({
      customer: String(o.customer), courriel: String(o.customer_email || "").trim().toLowerCase() || undefined, stripeId: o.id, genre: "abonnement" as const, sousDomaine: "", lang: "fr" as const, montant: o.amount_paid ?? 0,
      devise: String(o.currency || "cad"), nbPasses: PASSES_ABONNEMENT, expireLe: fin > Date.now() ? fin : Date.now() + 31 * JOUR, // les passes d'un mois expirent avec la période payée
    });
  }
  return null;
}

async function sousDomaineAttribue(ctx: MutationCtx, souhaite: string) {
  const libre = async (s: string) => !(await ctx.db.query("clients").withIndex("par_sousDomaine", q => q.eq("sousDomaine", s)).unique());
  if (sousDomaineValide(souhaite) && await libre(souhaite)) return souhaite;
  for (;;) { // payé mais nom pris entre-temps : adresse provisoire, le courriel la communique
    const s = "c" + Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(16).padStart(2, "0")).join("");
    if (await libre(s)) return s;
  }
}

export const appliquer = internalMutation({
  args: { ...argsEvenement, licence: v.string() }, // licence : empreinte de la clé, utilisée seulement si le client est créé
  handler: async (ctx, a) => {
    if (a.genre !== "client" && await ctx.db.query("achats").withIndex("par_stripeId", q => q.eq("stripeId", a.stripeId)).unique()) return { cree: false, sousDomaine: "" };
    const customer = a.customer, courriel = a.courriel;
    let client = customer ? await ctx.db.query("clients").withIndex("par_stripe", q => q.eq("stripeCustomerId", customer)).first() : null;
    if (!client && courriel) client = await ctx.db.query("clients").withIndex("par_courriel", q => q.eq("courriel", courriel)).first();
    let cree = false;
    if (!client) {
      // facture reçue avant la session : Stripe réessaiera, la session aura créé le client entre-temps
      if (a.genre === "abonnement" || !courriel) throw refus("client_inconnu", 503);
      const { id } = await insererClientDb(ctx, { courriel, sousDomaine: await sousDomaineAttribue(ctx, a.sousDomaine), licence: a.licence });
      client = (await ctx.db.get(id))!;
      cree = true;
    }
    if (customer && !client.stripeCustomerId) await ctx.db.patch(client._id, { stripeCustomerId: customer });
    if (a.genre !== "client") {
      const achatId = await ctx.db.insert("achats", { clientId: client._id, type: a.genre, stripeId: a.stripeId, montant: a.montant, devise: a.devise, date: Date.now() });
      for (let i = 0; i < a.nbPasses; i++) {
        await ctx.db.insert("passes", { clientId: client._id, origine: a.genre === "passe" ? "achat" : "abonnement", achatId, etat: "libre", expireLe: a.expireLe, voixCaracteres: 0 });
      }
    }
    return { cree, sousDomaine: client.sousDomaine };
  },
});

export const traiter = internalAction({
  args: argsEvenement,
  handler: async (ctx, a) => {
    const licence = genererLicence();
    const r: { cree: boolean; sousDomaine: string } = await ctx.runMutation(internal.paiement.appliquer, { ...a, licence: await sha256(licence) });
    if (!r.cree || !a.courriel) return;
    try { await envoyerLicence({ courriel: a.courriel, licence, sousDomaine: r.sousDomaine, lang: a.lang }); }
    catch (e) { console.error("ALERTE licence non envoyée à", a.courriel, "(client", r.sousDomaine + ") : npx convex run paiement:nouvelleCle", e); } // l'achat est déjà enregistré : pas de nouvel essai Stripe
  },
});

// Clé perdue ou courriel non reçu : npx convex run paiement:nouvelleCle '{"courriel":"…"}' remplace la clé et l'envoie
export const nouvelleCle = internalAction({
  args: { courriel: v.string(), lang: v.optional(v.union(v.literal("fr"), v.literal("en"))) },
  handler: async (ctx, a) => {
    const licence = genererLicence();
    const sousDomaine: string = await ctx.runMutation(internal.paiement.remplacerLicence, { courriel: a.courriel.trim().toLowerCase(), licence: await sha256(licence) });
    await envoyerLicence({ courriel: a.courriel.trim().toLowerCase(), licence, sousDomaine, lang: a.lang ?? "fr" });
    return "Clé envoyée pour " + sousDomaine;
  },
});

export const remplacerLicence = internalMutation({
  args: { courriel: v.string(), licence: v.string() },
  handler: async (ctx, a) => {
    const c = await ctx.db.query("clients").withIndex("par_courriel", q => q.eq("courriel", a.courriel)).first();
    if (!c) throw refus("client_inconnu", 404);
    await ctx.db.patch(c._id, { licence: a.licence });
    return c.sousDomaine;
  },
});

// ---------- Courriel (Brevo) ----------
export async function envoyerLicence(p: { courriel: string; licence: string; sousDomaine: string; lang: "fr" | "en" }) {
  const cle = process.env.BREVO_API_KEY;
  if (!cle) throw new Error("BREVO_API_KEY absente");
  const adresse = `${p.sousDomaine}.djvinny.ca`;
  const t = p.lang === "en"
    ? { sujet: "Your DJ Vinny license key", salut: "Thanks for your purchase!", cle: "Your license key", adr: "Your address", etape: "In DJ Vinny, paste the key in Settings, License key. Keep this email: the key is shown only here." }
    : { sujet: "Ta clé de licence DJ Vinny", salut: "Merci pour ton achat!", cle: "Ta clé de licence", adr: "Ton adresse", etape: "Dans DJ Vinny, colle la clé dans Réglages, Clé de licence. Garde ce courriel : la clé n'est affichée qu'ici." };
  const html = `<div style="font:16px/1.5 system-ui,sans-serif;color:#15102E"><p>${t.salut}</p><p>${t.cle} :<br><code style="font-size:15px;word-break:break-all">${p.licence}</code></p><p>${t.adr} : <b>${adresse}</b></p><p>${t.etape}</p></div>`;
  const text = `${t.salut}\n\n${t.cle} : ${p.licence}\n${t.adr} : ${adresse}\n\n${t.etape}`;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": cle, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: { name: "DJ Vinny", email: "invitations@djvinny.ca" }, to: [{ email: p.courriel }], subject: t.sujet, htmlContent: html, textContent: text }),
  });
  if (!r.ok) throw new Error("Brevo " + r.status + " " + (await r.text()).slice(0, 300));
}
