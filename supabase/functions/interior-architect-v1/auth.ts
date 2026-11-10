// interior-architect-v1/auth.ts
// Authentification — même patron que les autres fonctions du projet :
//   · passerelle : verify_jwt = true (valeur par défaut de la CLI ; la fonction
//     n'a pas besoin d'entrée dans supabase/config.toml pour l'obtenir) ;
//   · dans la fonction, défense en profondeur :
//       - appel INTERNE de copilot-chat : `Authorization: Bearer <clé secrète>`
//         (callInternalFunction). Projet sur JWT Signing Keys : la clé est lue
//         dans SUPABASE_SECRET_KEYS EN PRIORITÉ (dictionnaire JSON), la legacy
//         SUPABASE_SERVICE_ROLE_KEY n'est qu'un repli (même ordre que
//         copilot-chat/getSupabaseServiceRoleKey et etude-parcelle-v1/serviceKey) ;
//       - appel d'un UTILISATEUR (front) : jeton vérifié par GoTrue
//         (`/auth/v1/user`, patron de design-direction-v1), avec la clé
//         publishable (SUPABASE_PUBLISHABLE_KEYS en priorité, puis ANON).

export type Appelant = { type: 'service' } | { type: 'utilisateur'; userId: string };

export interface EnvAuth { get(nom: string): string | undefined }

function valeursCles(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    if (typeof p === 'string') return [p];
    if (p && typeof p === 'object') return Object.values(p).filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch { return [raw]; }
  return [];
}

function premiereCle(raw: string | undefined): string | undefined {
  return valeursCles(raw)[0];
}

/** Clés secrètes acceptées pour un appel interne (toutes les clés actives de SUPABASE_SECRET_KEYS, puis les replis). */
export function clesService(env: EnvAuth): string[] {
  return [
    ...valeursCles(env.get('SUPABASE_SECRET_KEYS')),
    env.get('SUPABASE_SERVICE_ROLE_KEY'),
    env.get('SERVICE_ROLE_KEY'),
  ].filter((k): k is string => typeof k === 'string' && k.length > 0);
}

export function clePublique(env: EnvAuth): string | undefined {
  return premiereCle(env.get('SUPABASE_PUBLISHABLE_KEYS'))
    ?? env.get('SUPABASE_ANON_KEY')
    ?? env.get('SUPABASE_PUBLISHABLE_KEY');
}

/** Comparaison à temps constant (longueurs différentes : faux sans court-circuit sur le contenu). */
function egal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function verifierAppelant(
  req: Request,
  env: EnvAuth,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; appelant: Appelant } | { ok: false; status: number; message: string }> {
  const jeton = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!jeton) return { ok: false, status: 401, message: 'Authentification requise.' };

  if (clesService(env).some((k) => egal(k, jeton))) return { ok: true, appelant: { type: 'service' } };

  const base = env.get('SUPABASE_URL');
  const apikey = clePublique(env);
  if (!base || !apikey) return { ok: false, status: 500, message: 'Configuration Supabase incomplète (SUPABASE_URL ou clé publique).' };
  try {
    const r = await fetchFn(`${base}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jeton}`, apikey },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { ok: false, status: 401, message: 'Session invalide ou expirée : reconnectez-vous.' };
    const u = await r.json().catch(() => null) as { id?: unknown } | null;
    if (!u || typeof u.id !== 'string' || !u.id) return { ok: false, status: 401, message: 'Session invalide.' };
    return { ok: true, appelant: { type: 'utilisateur', userId: u.id } };
  } catch {
    return { ok: false, status: 503, message: 'Vérification de la session indisponible : réessayez.' };
  }
}
