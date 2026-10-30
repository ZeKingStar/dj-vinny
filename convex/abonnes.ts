// Courriel facultatif de la page de vente : double confirmation (LCAP / Loi 25), désabonnement en un clic, liste dans Brevo.
// Les liens des courriels sont signés (HMAC avec ABONNES_SECRET) : rien d'autre à stocker, aucun jeton en base.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const PAUSE = 10 * 60_000;
type Lang = "fr" | "en";

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hmac = async (txt: string) => {
  const k = await crypto.subtle.importKey("raw", enc.encode(process.env.ABONNES_SECRET || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(txt))));
};
// but : "c" confirmation, "d" désabonnement
export const signer = async (but: "c" | "d", courriel: string) => `${b64(enc.encode(courriel))}.${await hmac(but + courriel)}`;
export const verifier = async (but: "c" | "d", t: string) => {
  const [a, sig] = t.split(".");
  if (!a || !sig || !process.env.ABONNES_SECRET) return null;
  let c = "";
  try { c = new TextDecoder().decode(Uint8Array.from(atob(a.replace(/-/g, "+").replace(/_/g, "/")), x => x.charCodeAt(0))); } catch { return null; }
  return sig === (await hmac(but + c)) ? c : null;
};

export const inscrire = internalMutation({
  args: { courriel: v.string(), lang: v.union(v.literal("fr"), v.literal("en")), majs: v.boolean(), payant: v.boolean() },
  handler: async (ctx, a) => {
    const maintenant = Date.now();
    const ex = await ctx.db.query("abonnes").withIndex("par_courriel", q => q.eq("courriel", a.courriel)).unique();
    if (!ex) { await ctx.db.insert("abonnes", { ...a, etat: "attente", consentiLe: maintenant, dernierEnvoi: maintenant }); return { envoyer: true }; }
    // déjà confirmé et rien de nouveau : rien à renvoyer ; sinon nouvelle confirmation (au plus un envoi par 10 min)
    if (ex.etat === "confirme" && (!a.majs || ex.majs) && (!a.payant || ex.payant)) return { envoyer: false };
    if (maintenant - ex.dernierEnvoi < PAUSE) return { envoyer: false };
    const garde = ex.etat === "confirme";
    await ctx.db.patch(ex._id, { lang: a.lang, majs: a.majs || (garde && ex.majs), payant: a.payant || (garde && ex.payant), etat: "attente", consentiLe: maintenant, dernierEnvoi: maintenant });
    return { envoyer: true };
  },
});

export const confirmer = internalMutation({
  args: { courriel: v.string() },
  handler: async (ctx, a) => {
    const ex = await ctx.db.query("abonnes").withIndex("par_courriel", q => q.eq("courriel", a.courriel)).unique();
    if (!ex) return null;
    await ctx.db.patch(ex._id, { etat: "confirme" });
    return { courriel: ex.courriel, lang: ex.lang, majs: ex.majs, payant: ex.payant };
  },
});

export const desabonner = internalMutation({
  args: { courriel: v.string() },
  handler: async (ctx, a) => {
    const ex = await ctx.db.query("abonnes").withIndex("par_courriel", q => q.eq("courriel", a.courriel)).unique();
    if (!ex) return null;
    await ctx.db.patch(ex._id, { etat: "desabonne", majs: false, payant: false });
    return { lang: ex.lang };
  },
});

// ---------- Brevo (clé BREVO_API_KEY, liste BREVO_LIST_ID, expéditeur BREVO_SENDER = adresse validée dans Brevo) ----------
const API = "https://api.brevo.com/v3";
const appel = async (chemin: string, methode: string, corps: unknown) => {
  try {
    const r = await fetch(API + chemin, { method: methode, headers: { "api-key": process.env.BREVO_API_KEY || "", "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(corps) });
    if (!r.ok) console.error("Brevo", chemin, r.status, (await r.text()).slice(0, 200));
    return r.ok;
  } catch { return false; }
};
export const brevo = {
  confirmation: (courriel: string, lang: Lang, lien: string) => {
    const t = lang === "en"
      ? { sujet: "Confirm your email – DJ Vinny", p: "Click to confirm that you want to hear from DJ Vinny. If this wasn't you, ignore this email: nothing will be sent to you.", b: "Confirm" }
      : { sujet: "Confirme ton courriel – DJ Vinny", p: "Clique pour confirmer que tu veux avoir des nouvelles de DJ Vinny. Si ce n'est pas toi, ignore ce courriel : rien ne te sera envoyé.", b: "Confirmer" };
    return appel("/smtp/email", "POST", {
      sender: { name: "DJ Vinny", email: process.env.BREVO_SENDER }, to: [{ email: courriel }], subject: t.sujet,
      htmlContent: `<p>${t.p}</p><p><a href="${lien}">${t.b}</a></p><p style="color:#777">Pop &amp; Show</p>`,
    });
  },
  ajouter: (a: { courriel: string; lang: Lang; majs: boolean; payant: boolean }) =>
    appel("/contacts", "POST", { email: a.courriel, listIds: [Number(process.env.BREVO_LIST_ID)], updateEnabled: true, emailBlacklisted: false, attributes: { LANG: a.lang, MAJS: a.majs, PAYANT: a.payant } }),
  retirer: (courriel: string) => appel(`/contacts/${encodeURIComponent(courriel)}`, "PUT", { emailBlacklisted: true }),
};

// ---------- Pages de réponse des liens ----------
const TEXTES = {
  fr: { confirme: "C'est confirmé. Merci!", desabonne: "Tu es désabonné. Aucun autre courriel ne te sera envoyé.", lien: "Ce lien n'est pas valide.", erreur: "Un problème est survenu. Réessaie dans un moment.", des: "Se désabonner" },
  en: { confirme: "Confirmed. Thanks!", desabonne: "You're unsubscribed. No more emails will be sent.", lien: "This link is not valid.", erreur: "Something went wrong. Please try again in a moment.", des: "Unsubscribe" },
};
export const page = (cas: "confirme" | "desabonne" | "lien" | "erreur", lang: Lang, desabo?: string) => {
  const t = TEXTES[lang];
  const lien = desabo ? `<p><a style="color:#B3A9D9" href="${desabo}">${t.des}</a></p>` : "";
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DJ Vinny</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#15102E;color:#FFF6E5;font:18px system-ui,sans-serif;text-align:center;padding:16px"><main><h1 style="font-size:28px">DJ Vinny</h1><p>${t[cas]}</p>${lien}<p><a style="color:#FFD23F" href="https://djvinny.ca/?lang=${lang}">djvinny.ca</a></p></main>`,
    { status: cas === "lien" ? 400 : cas === "erreur" ? 502 : 200, headers: { "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer" } });
};
