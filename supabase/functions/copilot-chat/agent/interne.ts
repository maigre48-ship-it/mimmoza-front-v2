// supabase/functions/copilot-chat/agent/interne.ts
// =============================================================
// Authentification de la route interne `{"interne":"mission_tick"}`.
//
// copilot-chat est déployée avec verify_jwt = false (config.toml) : la passerelle
// laisse passer toute requête, et c'est au code de vérifier. Le chat vérifie le
// JWT utilisateur (requireUserId) ; le tick, lui, exige la clé de SERVICE :
// nouvelle clé `sb_secret_…` (SUPABASE_SECRET_KEYS) ou clé legacy service_role
// (SUPABASE_SERVICE_ROLE_KEY). Comparaison de chaînes en temps constant, comme
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

/** Clés de service connues, lues dans l'environnement de la fonction. */
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
  for (const nom of ['SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY']) {
    const v = env(nom);
    if (v) cles.push(v);
  }
  return cles.filter((c) => c.length >= 20);
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
