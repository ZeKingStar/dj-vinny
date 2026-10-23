// Petits outils partagés des routes HTTP
export async function sha256(texte: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, "0")).join("");
}
