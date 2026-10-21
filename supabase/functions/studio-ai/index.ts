// =============================================================================
// studio-ai — IA du Studio (PUB-AI-1)
// -----------------------------------------------------------------------------
// POST …/studio-ai/plan        { system, messages }                → { ok, raw, usage? }
// POST …/studio-ai/plan-image  { consigne, imageBase64, mediaType } → { ok, raw, usage? }
//
// Ordre des contrôles — chacun ferme la porte avant le suivant, le fournisseur
// payant vient en dernier :
//   1. CORS : origine exacte de STUDIO_ALLOWED_ORIGINS, sinon 403 (fail-closed) ;
//   2. OPTIONS, méthode, STUDIO_AI_ENABLED=1, action ;
//   3. JWT Mimmoza (`authentifier`) ;
//   4. corps borné puis validé (policy.ts) ;
//   5. solde suffisant (lecture seule) ;
//   6. quota journalier atomique, par utilisateur et global — administrateurs
//      compris ;
//   7. débit des jetons AVANT l'appel fournisseur ;
//   8. appel fournisseur ; s'il échoue, remboursement.
//
// Après un débit confirmé, TOUT échec — fournisseur, lecture de sa réponse,
// construction de la nôtre, traçage, exception imprévue — rend les jetons, une
// seule fois (`suivreDebit`, policy.ts). Un administrateur ou un débit non
// confirmé n'a rien à se faire rendre. Si le remboursement lui-même échoue, il
// n'est pas retenté : l'étape est tracée et l'appel répond REFUND_FAILED.
//
// Le solde est vérifié avant le quota pour qu'un compte vide ne consomme pas le
// plafond global. La réservation de quota, elle, n'est jamais rendue : une
// tentative ratée compte.
//
// Rien de ce que l'utilisateur envoie ni de ce que le fournisseur répond n'est
// écrit dans les logs : seulement l'action, l'étape et un statut.
// =============================================================================

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  BillingError, type DebitParams, authentifier, estAdministrateur, verifierSolde,
} from '../_shared/billing/featureBilling.ts';
import {
  FOURNISSEUR, type ActionStudio, construireRequeteFournisseur, corpsMaxPour, enTetesCors, estActive,
  extraireReponse, interpreterDebit, modeleFixe, parseOriginesAutorisees, resoudreAction, suivreDebit, tarifPour,
  validerPlan, validerPlanImage,
} from './policy.ts';

type EnTetes = Record<string, string>;

function reponse(corps: unknown, status: number, entetes: EnTetes): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { ...entetes, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const echec = (error: string, message: string, status: number, entetes: EnTetes) =>
  reponse({ ok: false, error, message }, status, entetes);

/** Aucun contenu utilisateur ni fournisseur ici : action, étape, statut. */
function tracer(action: ActionStudio | null, etape: string, detail: Record<string, string | number> = {}) {
  console.log(JSON.stringify({ fn: 'studio-ai', action, etape, ...detail }));
}

// ── Client privilégié, pour les RPC de quota et de débit ─────────────────────
// Même chaîne de repli que `cleServiceRole()` dans featureBilling.ts, qui ne
// l'exporte pas : SUPABASE_SECRET_KEYS d'abord (projet sur JWT Signing Keys).
function cleServiceRole(): string | null {
  const brut = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (brut) {
    try {
      const lu = JSON.parse(brut);
      if (typeof lu === 'string') return lu;
      const premiere = lu && typeof lu === 'object' ? Object.values(lu).find((v) => typeof v === 'string') : null;
      if (typeof premiere === 'string') return premiere;
    } catch {
      return brut; // pas du JSON : c'est déjà la clé
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? null;
}

let _admin: SupabaseClient | null = null;

function clientAdmin(): SupabaseClient | null {
  if (_admin) return _admin;
  const url = Deno.env.get('SUPABASE_URL');
  const cle = cleServiceRole();
  if (!url || !cle) return null;
  _admin = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}

type Reservation = 'OK' | 'USER_DAILY_LIMIT' | 'GLOBAL_DAILY_LIMIT' | 'INDISPONIBLE';

/** Fail-closed : toute réponse autre qu'un `allowed: true` explicite bloque l'appel. */
async function reserverQuota(userId: string, action: ActionStudio): Promise<Reservation> {
  const admin = clientAdmin();
  if (!admin) return 'INDISPONIBLE';
  const { data, error } = await admin.rpc('studio_reserve_ai_usage', { p_user_id: userId, p_action: action });
  if (error || !data || typeof data !== 'object') return 'INDISPONIBLE';
  const { allowed, reason } = data as { allowed?: unknown; reason?: unknown };
  if (allowed === true) return 'OK';
  if (reason === 'USER_DAILY_LIMIT' || reason === 'GLOBAL_DAILY_LIMIT') return reason;
  return 'INDISPONIBLE';
}

/**
 * Prélève les jetons et dit s'il y a quelque chose à rendre en cas d'échec.
 *
 * `true` uniquement si `feature_spend_credits` a répondu sans erreur. Un
 * administrateur n'est pas débité (`false`). Tout le reste lève une
 * BillingError : l'appelant n'atteint alors jamais le fournisseur.
 */
async function debiterStudio(debit: DebitParams): Promise<boolean> {
  if (await estAdministrateur(debit.userId)) return false;

  const admin = clientAdmin();
  if (!admin) throw new BillingError('BILLING_UNAVAILABLE', 'Facturation indisponible.', 500);

  let erreurRpc: { message?: string | null } | null;
  try {
    const { error } = await admin.rpc('feature_spend_credits', {
      p_user_id: debit.userId,
      p_amount: debit.montant,
      p_description: debit.description,
      p_type: debit.type,
    });
    erreurRpc = error;
  } catch {
    erreurRpc = {};
  }

  const issue = interpreterDebit(erreurRpc, debit.montant);
  if (issue.preleve === true) return true;
  if (issue.code === 'BILLING_UNAVAILABLE') tracer(null, 'debit', { statut: 'indisponible' });
  throw new BillingError(issue.code, issue.message, issue.statusCode);
}

/**
 * Rend les jetons. `true` uniquement si `feature_refund_credits` a répondu sans
 * erreur. Mêmes paramètres que `rembourser` (featureBilling.ts), qui n'est pas
 * utilisé ici : il avale l'échec — l'appelant ne peut donc pas le signaler — et
 * journalise l'identifiant du compte avec le message brut de la base. Ici rien
 * n'est journalisé, et une exception remonte à `rembourserUneFois`, qui la
 * compte comme un échec.
 */
async function rendreJetons(debit: DebitParams): Promise<boolean> {
  const admin = clientAdmin();
  if (!admin) return false;
  const { error } = await admin.rpc('feature_refund_credits', {
    p_user_id: debit.userId,
    p_amount: debit.montant,
    p_description: `Remboursement — ${debit.description}`,
    p_type: `${debit.type}_refund`,
  });
  return !error;
}

/** Lit le corps sans jamais dépasser `max` octets en mémoire. `null` si trop gros. */
async function lireCorpsBorne(req: Request, max: number): Promise<string | null> {
  const annonce = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(annonce) && annonce > max) return null;
  if (!req.body) return '';

  const lecteur = req.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await lecteur.cancel().catch(() => {});
      return null;
    }
    morceaux.push(value);
  }
  const octets = new Uint8Array(total);
  let position = 0;
  for (const m of morceaux) { octets.set(m, position); position += m.byteLength; }
  return new TextDecoder().decode(octets);
}

Deno.serve(async (req) => {
  // ── 1. CORS, avant tout le reste ───────────────────────────────────────────
  const cors = enTetesCors(req.headers.get('Origin'), parseOriginesAutorisees(Deno.env.get('STUDIO_ALLOWED_ORIGINS')));
  if (!cors) return echec('ORIGIN_FORBIDDEN', 'Origine non autorisée.', 403, { Vary: 'Origin' });

  // ── 2. Pré-vol, méthode, activation, action ────────────────────────────────
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return echec('METHOD_NOT_ALLOWED', 'Méthode non autorisée.', 405, { ...cors, Allow: 'POST, OPTIONS' });
  if (!estActive(Deno.env.get('STUDIO_AI_ENABLED'))) {
    return echec('STUDIO_AI_DISABLED', "L'IA du Studio n'est pas activée.", 503, cors);
  }
  const action = resoudreAction(req.url);
  if (!action) return echec('UNKNOWN_ACTION', 'Action inconnue.', 404, cors);

  // Déclarés hors du `try` : le `catch` final doit savoir s'il reste des jetons
  // à rendre. Tant que le débit n'est pas confirmé, `rendre` n'est jamais appelé.
  const suivi = suivreDebit();
  let rendre: () => Promise<boolean> = () => Promise.resolve(false);
  const remboursementEchoue = () => {
    try { tracer(action, 'remboursement', { statut: 'echec' }); } catch { /* la réponse d'erreur prime */ }
    return echec(
      'REFUND_FAILED',
      "L'appel a échoué et le remboursement des jetons n'a pas abouti. Contactez le support.",
      500,
      cors,
    );
  };

  try {
    // ── 3. Authentification ──────────────────────────────────────────────────
    const userId = await authentifier(req);

    // ── 4. Corps borné puis validé ───────────────────────────────────────────
    const texte = await lireCorpsBorne(req, corpsMaxPour(action));
    if (texte === null) return echec('PAYLOAD_TOO_LARGE', 'Requête trop volumineuse.', 413, cors);
    let corps: unknown;
    try { corps = JSON.parse(texte); } catch { return echec('CORPS_INVALIDE', 'Requête illisible.', 400, cors); }

    let requeteFournisseur: Record<string, unknown>;
    const modele = modeleFixe(Deno.env.get('STUDIO_AI_MODEL'));
    if (action === 'plan') {
      const v = validerPlan(corps);
      if (v.ok === false) return echec(v.erreur, 'Requête refusée.', 400, cors);
      requeteFournisseur = construireRequeteFournisseur({ action, valeur: v.valeur }, modele);
    } else {
      const v = validerPlanImage(corps);
      if (v.ok === false) return echec(v.erreur, 'Requête refusée.', v.erreur === 'IMAGE_TROP_LOURDE' ? 413 : 400, cors);
      requeteFournisseur = construireRequeteFournisseur({ action, valeur: v.valeur }, modele);
    }

    // Vérifié avant le quota et le débit : une clé absente ne doit rien coûter.
    const cleFournisseur = Deno.env.get('ANTHROPIC_API_KEY');
    if (!cleFournisseur) {
      tracer(action, 'configuration', { statut: 'cle_fournisseur_absente' });
      return echec('AI_UNAVAILABLE', 'Moteur IA indisponible.', 503, cors);
    }

    // ── 5. Solde ─────────────────────────────────────────────────────────────
    const tarif = tarifPour(action);
    const debit = { userId, ...tarif };
    await verifierSolde(userId, tarif.montant);

    // ── 6. Quota journalier (administrateurs compris) ────────────────────────
    const reservation = await reserverQuota(userId, action);
    if (reservation === 'INDISPONIBLE') {
      tracer(action, 'quota', { statut: 'indisponible' });
      return echec('QUOTA_UNAVAILABLE', 'Contrôle de quota indisponible.', 503, cors);
    }
    if (reservation !== 'OK') {
      tracer(action, 'quota', { statut: reservation });
      return echec(
        reservation,
        reservation === 'USER_DAILY_LIMIT'
          ? "Limite quotidienne d'utilisation de l'IA atteinte. Réessayez demain."
          : "L'IA du Studio a atteint sa capacité du jour. Réessayez demain.",
        429,
        cors,
      );
    }

    // ── 7. Débit AVANT le fournisseur ────────────────────────────────────────
    // Le débit est fait ici plutôt que par `debiter` : celui-ci relit
    // `admin_users`, et `estAdministrateur` ne mémorise pas une lecture ratée.
    // Deux lectures pouvaient donc diverger — « non admin » puis « admin » — et
    // faire rembourser des jetons jamais prélevés. Le suivi n'est confirmé
    // qu'au retour sans erreur de la RPC de débit.
    rendre = () => rendreJetons(debit);
    if (await debiterStudio(debit)) suivi.confirmer();

    // ── 8. Fournisseur ───────────────────────────────────────────────────────
    // À partir d'ici, toute sortie en échec passe par `rembourserUneFois` : soit
    // ici, soit dans le `catch` final pour ce qui n'a pas été prévu.
    const echecFournisseur = async (statut: string, http: number, message: string) => {
      const etat = await suivi.rembourserUneFois(rendre);
      tracer(action, 'fournisseur', { statut, rembourse: etat === 'rembourse' ? 1 : 0 });
      if (etat === 'remboursement_echoue') return remboursementEchoue();
      return echec('AI_PROVIDER_ERROR', message, http, cors);
    };

    let brut: Response;
    try {
      brut = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: AbortSignal.timeout(FOURNISSEUR.timeoutMs),
        headers: { 'content-type': 'application/json', 'x-api-key': cleFournisseur, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(requeteFournisseur),
      });
    } catch (e) {
      const expire = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
      return await echecFournisseur(
        expire ? 'timeout' : 'reseau',
        expire ? 504 : 502,
        expire ? 'Le moteur IA a mis trop de temps à répondre. Réessayez.' : 'Le moteur IA ne répond pas. Réessayez.',
      );
    }

    if (!brut.ok) {
      await brut.body?.cancel().catch(() => {});
      return await echecFournisseur(
        `http_${brut.status}`,
        502,
        brut.status === 429 || brut.status === 529
          ? 'Le moteur IA est temporairement saturé. Réessayez dans quelques instants.'
          : 'Le moteur IA ne répond pas. Réessayez.',
      );
    }

    let resultat: ReturnType<typeof extraireReponse>;
    try { resultat = extraireReponse(await brut.json()); } catch { resultat = null; }
    if (!resultat) return await echecFournisseur('reponse_inexploitable', 502, 'Réponse IA inexploitable. Relancez la demande.');

    // La réponse est construite AVANT la trace de succès : si l'une ou l'autre
    // lève, le `catch` rembourse et rien n'est livré.
    const succes = reponse({ ok: true, ...resultat }, 200, cors);
    tracer(action, 'succes', { tokens_sortie: resultat.usage?.output_tokens ?? -1 });
    return succes;
  } catch (e) {
    // Sans effet si rien n'a été prélevé ou si un remboursement a déjà été tenté.
    const etat = await suivi.rembourserUneFois(rendre);
    if (etat === 'remboursement_echoue') return remboursementEchoue();
    if (e instanceof BillingError) return echec(e.code, e.message, e.statusCode, cors);
    try {
      tracer(action, 'erreur_interne', {
        type: e instanceof Error ? e.name : 'inconnu',
        rembourse: etat === 'rembourse' ? 1 : 0,
      });
    } catch { /* la réponse d'erreur prime */ }
    return echec('INTERNAL_ERROR', 'Service momentanément indisponible.', 500, cors);
  }
});
