// Partie payante hébergée de DJ Vinny (voir docs/modele-affaires.md, sections 4 et 9).
// Aucun secret en clair : la clé de licence et le code du QR sont gardés en empreinte SHA-256.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  clients: defineTable({
    courriel: v.string(),
    clerkId: v.optional(v.string()), // inutilisé : le portail identifie le client par son courriel et son client Stripe
    sousDomaine: v.string(), // <sousDomaine>.djvinny.ca
    portTunnel: v.number(), // port du tunnel SSH sur le VPS, unique
    cleSsh: v.optional(v.string()), // clé publique générée par l'app (étape 6)
    licence: v.string(), // empreinte SHA-256 de la clé de licence
    etat: v.union(v.literal("actif"), v.literal("suspendu")),
    stripeCustomerId: v.optional(v.string()),
  })
    .index("par_licence", ["licence"])
    .index("par_sousDomaine", ["sousDomaine"])
    .index("par_port", ["portTunnel"])
    .index("par_clerk", ["clerkId"])
    .index("par_courriel", ["courriel"])
    .index("par_stripe", ["stripeCustomerId"]),

  achats: defineTable({
    clientId: v.id("clients"),
    type: v.union(v.literal("passe"), v.literal("abonnement")),
    stripeId: v.string(), // session ou facture Stripe : un webhook reçu deux fois ne crée rien de plus
    montant: v.number(), // en cents
    devise: v.string(),
    date: v.number(),
  })
    .index("par_stripeId", ["stripeId"])
    .index("par_client", ["clientId"]),

  // Une passe = une soirée. Achetée (10 $, valide 12 mois) ou d'abonnement (4 par mois de facturation).
  passes: defineTable({
    clientId: v.id("clients"),
    origine: v.union(v.literal("achat"), v.literal("abonnement")),
    achatId: v.optional(v.id("achats")),
    etat: v.union(v.literal("libre"), v.literal("attachee"), v.literal("utilisee"), v.literal("expiree")),
    expireLe: v.number(), // une passe libre expire ; une passe attachée reste valide jusqu'à sa soirée
    soireeId: v.optional(v.id("soirees")),
    voixCaracteres: v.number(), // compteur de la voix incluse, plafonné
  })
    .index("par_client_etat", ["clientId", "etat"])
    .index("par_etat", ["etat"]),

  // Copie d'un événement du serveur local, publiée avec la clé de licence
  soirees: defineTable({
    clientId: v.id("clients"),
    evId: v.string(), // id de l'événement local
    empreinteCode: v.string(), // SHA-256 du code du QR
    nom: v.string(),
    date: v.string(), // AAAA-MM-JJ (heure locale du client)
    debut: v.string(), // HH:MM
    fin: v.string(),
    debutTs: v.number(), // instants calculés par le serveur local, dans son fuseau horaire
    finTs: v.number(),
    lang: v.union(v.literal("fr"), v.literal("en")),
    lieu: v.string(),
    accueil: v.string(),
    merci: v.string(),
    passeId: v.optional(v.id("passes")),
  })
    .index("par_client_ev", ["clientId", "evId"])
    .index("par_empreinte", ["empreinteCode"]),

  souhaits: defineTable({
    soireeId: v.id("soirees"),
    texte: v.string(),
    prenom: v.string(),
    invite: v.string(), // identifiant gardé dans le téléphone de l'invité
    recu: v.number(),
    recupere: v.boolean(), // déjà lu par le serveur local
  })
    .index("par_soiree", ["soireeId"])
    .index("par_soiree_invite", ["soireeId", "invite"])
    .index("par_soiree_recupere", ["soireeId", "recupere"]),

  invitations: defineTable({
    soireeId: v.id("soirees"),
    courriel: v.string(),
    envoyeLe: v.number(),
    etat: v.union(v.literal("envoye"), v.literal("erreur")),
  }).index("par_soiree", ["soireeId"]),
});
