// supabase/functions/_shared/emails/desinscription.ts
// =============================================================================
// Lien de désinscription signé (HMAC-SHA256) — utilisable sans être connecté.
// WebCrypto uniquement : tourne sous Deno (Edge Function) et sous Node ≥ 20 (tests).
// =============================================================================

export type CategorieDesactivable = "conseils" | "alertes_usage";

export const CATEGORIES_DESACTIVABLES: readonly CategorieDesactivable[] = ["conseils", "alertes_usage"];

export const LIBELLE_CATEGORIE: Record<CategorieDesactivable, string> = {
  conseils: "conseils pour bien démarrer",
  alertes_usage: "alertes de consommation (quota d'analyses, solde de jetons)",
};

function base64url(octets: ArrayBuffer): string {
  let bin = "";
  for (const o of new Uint8Array(octets)) bin += String.fromCharCode(o);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function cle(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function signer(secret: string, userId: string, categorie: CategorieDesactivable): Promise<string> {
  if (!secret || secret.length < 16) throw new Error("Secret de désinscription absent ou trop court (16 caractères minimum).");
  const sig = await crypto.subtle.sign("HMAC", await cle(secret), new TextEncoder().encode(`desinscription.${userId}.${categorie}`));
  return base64url(sig);
}

/** Comparaison à temps constant. */
function egal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifier(
  secret: string,
  userId: string,
  categorie: string,
  jeton: string,
): Promise<boolean> {
  if (!CATEGORIES_DESACTIVABLES.includes(categorie as CategorieDesactivable)) return false;
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !jeton) return false;
  try {
    return egal(await signer(secret, userId, categorie as CategorieDesactivable), jeton);
  } catch {
    return false;
  }
}

/** URL de désinscription (page de confirmation + POST « un clic » RFC 8058). */
export async function lienDesinscription(
  fonctionUrl: string,
  secret: string,
  userId: string,
  categorie: CategorieDesactivable,
): Promise<string> {
  const t = await signer(secret, userId, categorie);
  const u = new URL(fonctionUrl);
  u.searchParams.set("action", "desinscription");
  u.searchParams.set("u", userId);
  u.searchParams.set("c", categorie);
  u.searchParams.set("t", t);
  return u.toString();
}
