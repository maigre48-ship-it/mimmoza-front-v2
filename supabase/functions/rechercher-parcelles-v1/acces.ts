// supabase/functions/rechercher-parcelles-v1/acces.ts
// =============================================================
// Garde « clé de service uniquement ».
// Copie de la logique de copilot-chat/agent/interne.ts (comparaison en temps
// constant), avec une règle plus stricte : les clés `sb_secret_…`
// (SUPABASE_SECRET_KEYS) sont les SEULES acceptées dès qu'il en existe ; la
// clé legacy SUPABASE_SERVICE_ROLE_KEY (ou SERVICE_ROLE_KEY) ne sert de repli
// que si aucune clé secrète n'est définie.
// copilot-chat → callInternalFunction envoie `Authorization: Bearer <clé>` avec
// getSupabaseServiceRoleKey(), qui lit la PREMIÈRE clé de SUPABASE_SECRET_KEYS
// en priorité, puis la legacy : les deux côtés suivent donc le même ordre.
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

/** Clés acceptées : clés secrètes si présentes, sinon la clé legacy service_role. */
export function clesService(env: (nom: string) => string | undefined = (n) => Deno.env.get(n)): string[] {
  const secretes: string[] = [];
  const dico = env('SUPABASE_SECRET_KEYS');
  if (dico) {
    try {
      const p = JSON.parse(dico);
      if (typeof p === 'string') secretes.push(p);
      else if (p && typeof p === 'object') {
        for (const v of Object.values(p)) if (typeof v === 'string') secretes.push(v);
      }
    } catch {
      secretes.push(dico);
    }
  }
  const valides = secretes.filter((c) => c.length >= 20);
  if (valides.length) return valides;
  const legacy: string[] = [];
  for (const nom of ['SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY']) {
    const v = env(nom);
    if (v) legacy.push(v);
  }
  return legacy.filter((c) => c.length >= 20);
}

/** Vrai si l'en-tête Authorization porte exactement une clé de service connue. */
export function estCleService(entete: string | null | undefined, cles: string[]): boolean {
  const brut = (entete ?? '').trim();
  const jeton = brut.toLowerCase().startsWith('bearer ') ? brut.slice(7).trim() : '';
  if (!jeton || cles.length === 0) return false;
  let ok = false;
  for (const c of cles) ok = egalTempsConstant(c, jeton) || ok;   // pas de sortie anticipée
  return ok;
}
