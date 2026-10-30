// supabase/functions/copilot-chat/agent/interne.ts
// =============================================================
// Authentification de la route interne `{"interne":"mission_tick"}`.
//
// copilot-chat est déployée avec verify_jwt = false (config.toml) : la passerelle
// laisse passer toute requête, et c'est au code de vérifier. Le chat vérifie le
// JWT utilisateur (requireUserId) ; le tick, lui, exige la clé de SERVICE :
// clé `sb_secret_…` (SUPABASE_SECRET_KEYS) ; la clé legacy service_role n'est
// qu'un repli quand aucune clé secrète n'est configurée. Comparaison de chaînes en temps constant, comme
// agent-proactif-v1 et stream-estate-ingest-v1 (estAppelInterne).
// =============================================================

/** Égalité en temps constant (ne court-circuite pas au premier octet différent). */
export function egalTempsConstant(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/**
 * Clés de service acceptées (revue M7) : UNIQUEMENT les clés `SUPABASE_SECRET_KEYS`
 * (format `sb_secret_…`). La clé legacy service_role (JWT) n'est acceptée qu'en
 * repli, si et seulement si SUPABASE_SECRET_KEYS est absent ou vide — le cas d'un
 * projet pas encore migré vers les clés secrètes.
 */
export function clesServiceRole(env: (nom: string) => string | undefined = (n) => Deno.env.get(n)): string[] {
  const cles: string[] = [];
  const dico = env('SUPABASE_SECRET_KEYS');
  if (dico) {
    try {
      const p = JSON.parse(dico);
      if (typeof p === 'string') cles.push(p);
      else if (p && typeof p === 'object') {
        for (const v of Object.values(p)) if (typeof v === 'string') cles.push(v);
      }
    } catch {
      cles.push(dico);
    }
  }
  const secretes = cles.filter((c) => c.length >= 20);
  if (secretes.length) return secretes;
  const legacy: string[] = [];
  for (const nom of ['SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY']) {
    const v = env(nom);
    if (v && v.length >= 20) legacy.push(v);
  }
  return legacy;
}

/** Vrai si l'en-tête Authorization porte exactement une clé de service connue. */
export function estCleServiceRole(entete: string | null | undefined, cles: string[]): boolean {
  const brut = (entete ?? '').trim();
  const jeton = brut.toLowerCase().startsWith('bearer ') ? brut.slice(7).trim() : '';
  if (!jeton) return false;
  let ok = false;
  for (const c of cles) ok = egalTempsConstant(c, jeton) || ok;   // pas de sortie anticipée
  return ok;
}
