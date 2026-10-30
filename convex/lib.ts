// Petits outils partagés des routes HTTP
export async function sha256(texte: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, "0")).join("");
}

// Clé de licence : djv_ + 48 caractères hexadécimaux (le format que http.ts accepte)
export function genererLicence() {
  return "djv_" + Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, "0")).join("");
}

const RESERVES = ["www", "app", "compte", "api", "admin"];
export const sousDomaineValide = (s: string) => /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(s) && !RESERVES.includes(s);
