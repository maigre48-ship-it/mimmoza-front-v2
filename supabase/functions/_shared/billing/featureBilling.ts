// =============================================================================
// Facturation d'une fonctionnalité payante, côté SERVEUR
// -----------------------------------------------------------------------------
// Pourquoi ce module existe
// -------------------------
// Le débit des jetons vivait entièrement dans le navigateur : aucune Edge
// Function coûteuse ne consultait le solde. Un porteur de JWT valide pouvait
// donc appeler directement la génération d'image, l'analyse de plan ou
// l'extraction PLU et consommer sans limite, gratuitement. Le paywall n'était
// qu'un affichage.
//
// Ce module met le contrôle là où il ne peut pas être contourné : dans la
// fonction qui dépense réellement l'argent.
//
// Le contrat, en trois temps
// --------------------------
//   1. `authentifier(req)`   — refuse tout appel sans JWT valide ;
//   2. `verifierSolde(...)`  — refuse d'engager la dépense si le compte ne peut
//                              pas la payer ;
//   3. `debiter(...)`        — prélève une fois le résultat réellement produit.
//
// Pourquoi vérifier puis débiter APRÈS, plutôt que débiter avant
// --------------------------------------------------------------
// Partout ailleurs dans l'application, le jeton est prélevé avant l'appel
// coûteux et n'est JAMAIS rendu si celui-ci échoue : l'utilisateur paie les
// pannes. Ces handlers ont par ailleurs de nombreux retours d'erreur précoces,
// où disséminer des remboursements serait la garantie d'en oublier un.
//
// La vérification préalable ferme la porte aux comptes vides ; le débit après
// succès garantit qu'on ne facture que ce qui a été livré. La seule fenêtre de
// perte est un solde qui changerait entre les deux, bornée à un appel.
//
// `rembourser` reste fourni pour les cas où le débit doit précéder le travail.
// =============================================================================

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** Erreur portant un statut HTTP, pour une réponse propre côté handler. */
export class BillingError extends Error {
  constructor(
    readonly code:
      | 'UNAUTHORIZED'
      | 'NO_TOKENS'
      | 'NO_ACCOUNT'
      | 'BILLING_UNAVAILABLE',
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

function urlSupabase(): string {
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) throw new BillingError('BILLING_UNAVAILABLE', 'SUPABASE_URL manquant', 500);
  return url;
}

/**
 * Certaines clés Supabase sont exposées sous forme de dictionnaire JSON
 * (`{"nom": "clé"}`) plutôt que de chaîne nue. On retient la première valeur.
 */
function premiereCleJson(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') {
      const premiere = Object.values(parsed).find((v) => typeof v === 'string');
      if (typeof premiere === 'string') return premiere;
    }
  } catch {
    return raw; // pas du JSON : c'est déjà la clé
  }
  return null;
}

/**
 * Clé service_role.
 *
 * ⚠️ Ce projet est sur JWT Signing Keys : la legacy `SUPABASE_SERVICE_ROLE_KEY`
 * est dépréciée et provoque un 401 « JWT invalide » sur les appels internes.
 * `SUPABASE_SECRET_KEYS` est donc lue EN PRIORITÉ — même chaîne de repli que
 * `getSupabaseServiceRoleKey()` dans copilot-chat, à ne pas désaligner : s'en
 * écarter ferait échouer TOUTE la facturation dès le premier appel.
 */
function cleServiceRole(): string {
  const key =
    premiereCleJson(Deno.env.get('SUPABASE_SECRET_KEYS')) ??
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
    Deno.env.get('SERVICE_ROLE_KEY');
  if (!key) {
    throw new BillingError('BILLING_UNAVAILABLE', 'Clé service_role Supabase manquante', 500);
  }
  return key;
}

/** Clé publique, même chaîne de repli que copilot-chat. */
function clePublique(): string {
  const key =
    premiereCleJson(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')) ??
    Deno.env.get('SUPABASE_ANON_KEY') ??
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ??
    Deno.env.get('VITE_SUPABASE_ANON_KEY');
  if (!key) {
    throw new BillingError('BILLING_UNAVAILABLE', 'Clé publique Supabase manquante', 500);
  }
  return key;
}

// Le client privilégié est mémorisé : il était reconstruit à chaque
// vérification de solde puis à chaque débit, soit deux instanciations par
// requête facturée.
let _admin: SupabaseClient | null = null;

/** Client privilégié : seul habilité à appeler feature_spend/refund_credits. */
function clientAdmin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(urlSupabase(), cleServiceRole(), {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
  });
  return _admin;
}

/**
 * Vérifie le JWT de la requête et retourne l'identifiant de l'utilisateur.
 *
 * Ne se contente PAS de constater la présence d'un en-tête : plusieurs fonctions
 * lisaient `Authorization` uniquement pour un `console.log`, ce qui ne prouve
 * rien. Ici le jeton est réellement validé auprès de GoTrue.
 */
export async function authentifier(req: Request): Promise<string> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new BillingError('UNAUTHORIZED', 'Authentification requise.', 401);
  }

  const client = createClient(urlSupabase(), clePublique(), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    throw new BillingError('UNAUTHORIZED', 'Session invalide ou expirée.', 401);
  }
  return data.user.id;
}

/**
 * Les administrateurs actifs ne sont pas facturés.
 *
 * Cette exemption existait déjà côté front (`isAdmin` / `bypassLimits` dans
 * useMarketVeille, accessPolicies…), mais elle y était calculée dans le
 * navigateur — donc ni fiable, ni connue du serveur. En déplaçant le débit dans
 * les Edge Functions sans porter l'exemption, on se serait mis à facturer les
 * comptes admin, ce qui n'a jamais été l'intention.
 *
 * La source de vérité est la table `admin_users` — la même que celle des
 * policies RLS — lue avec le client privilégié, jamais depuis un drapeau envoyé
 * par le client.
 *
 * Mémoïsé pour la durée de l'isolate : un même utilisateur enchaîne
 * `verifierSolde` puis `debiter` dans la même requête.
 */
const _adminCache = new Map<string, boolean>();

export async function estAdministrateur(userId: string): Promise<boolean> {
  const connu = _adminCache.get(userId);
  if (connu !== undefined) return connu;

  const { data, error } = await clientAdmin()
    .from('admin_users')
    .select('user_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    // En cas de doute on FACTURE : un admin mal détecté paie sa requête, ce qui
    // se corrige ; l'inverse offrirait le service à tout le monde si la table
    // devenait illisible.
    console.warn('[billing] lecture admin_users impossible, facturation appliquée', error.message);
    return false;
  }

  const estAdmin = Boolean(data);
  _adminCache.set(userId, estAdmin);
  return estAdmin;
}

/**
 * Refuse d'engager la dépense si le solde ne la couvre pas.
 *
 * À appeler AVANT le travail coûteux, `debiter` venant après. Lève NO_TOKENS
 * (402), que le handler traduit en réponse via `reponseErreurFacturation`.
 */
export async function verifierSolde(userId: string, montant: number): Promise<void> {
  if (await estAdministrateur(userId)) return;

  const { data, error } = await clientAdmin()
    .from('credit_accounts')
    .select('current_credits')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[billing] lecture du solde impossible', error.message);
    throw new BillingError('BILLING_UNAVAILABLE', 'Facturation indisponible.', 500);
  }

  const solde = typeof data?.current_credits === 'number' ? data.current_credits : null;
  if (solde === null) {
    throw new BillingError('NO_ACCOUNT', "Aucun compte de jetons pour cet utilisateur.", 402);
  }
  if (solde < montant) {
    throw new BillingError(
      'NO_TOKENS',
      `Solde insuffisant : ${montant} jetons requis, ${solde} disponible${solde > 1 ? 's' : ''}.`,
      402,
    );
  }
}

export interface DebitParams {
  userId: string;
  /** Montant en jetons. Doit venir d'un tarif nommé, jamais du corps de requête. */
  montant: number;
  /** Type de mouvement, tel qu'il apparaîtra dans credit_transactions. */
  type: string;
  description: string;
}

/**
 * Prélève les jetons. Lève NO_TOKENS (402) si le solde ne suffit pas.
 *
 * Le montant n'est JAMAIS lu depuis la requête : il est choisi par la fonction
 * appelante à partir d'un tarif constant. Sinon le client fixerait son prix.
 */
export async function debiter(p: DebitParams): Promise<void> {
  // Symétrique de verifierSolde : l'exemption est portée aux DEUX endroits,
  // pour qu'un handler qui n'appellerait que l'un des deux reste cohérent.
  if (await estAdministrateur(p.userId)) {
    console.log(`[billing] admin exempté — ${p.type} (${p.montant} jetons non prélevés)`);
    return;
  }

  const { error } = await clientAdmin().rpc('feature_spend_credits', {
    p_user_id: p.userId,
    p_amount: p.montant,
    p_description: p.description,
    p_type: p.type,
  });

  if (!error) return;

  const brut = (error.message ?? '').toUpperCase();
  if (brut.includes('NO_TOKENS')) {
    throw new BillingError(
      'NO_TOKENS',
      `Solde insuffisant : ${p.montant} jetons requis.`,
      402,
    );
  }
  if (brut.includes('NO_ACCOUNT')) {
    throw new BillingError('NO_ACCOUNT', "Aucun compte de jetons pour cet utilisateur.", 402);
  }
  console.error('[billing] débit échoué', error.message);
  throw new BillingError('BILLING_UNAVAILABLE', 'Facturation indisponible.', 500);
}

/**
 * Rend les jetons après un échec du travail facturé.
 *
 * Ne lève jamais : un remboursement raté ne doit pas masquer l'erreur d'origine,
 * qui est ce que l'utilisateur a besoin de comprendre. Il est tracé pour être
 * rattrapable à la main.
 */
export async function rembourser(p: DebitParams): Promise<void> {
  try {
    const { error } = await clientAdmin().rpc('feature_refund_credits', {
      p_user_id: p.userId,
      p_amount: p.montant,
      p_description: `Remboursement — ${p.description}`,
      p_type: `${p.type}_refund`,
    });
    if (error) {
      console.error('[billing] REMBOURSEMENT ÉCHOUÉ', {
        userId: p.userId, montant: p.montant, type: p.type, erreur: error.message,
      });
    }
  } catch (e) {
    console.error('[billing] REMBOURSEMENT ÉCHOUÉ (exception)', e);
  }
}

/**
 * Enveloppe pour les handlers dont le travail tient dans une seule fonction :
 * authentifie, vérifie le solde, exécute, débite si le travail a réussi.
 *
 * Les handlers construits autour de multiples `return` d'erreur précoces
 * appelleront plutôt `authentifier` / `verifierSolde` / `debiter` à la main, aux
 * bons endroits.
 */
export async function facturer<T>(
  req: Request,
  tarif: { montant: number; type: string; description: string },
  travail: (userId: string) => Promise<T>,
): Promise<T> {
  const userId = await authentifier(req);
  await verifierSolde(userId, tarif.montant);

  const resultat = await travail(userId);

  // Débit après succès : une exception du travail nous a déjà fait sortir.
  await debiter({ userId, ...tarif });
  return resultat;
}

/** Traduit une BillingError en réponse HTTP ; retourne null pour toute autre erreur. */
export function reponseErreurFacturation(
  e: unknown,
  entetes: HeadersInit = {},
): Response | null {
  if (!(e instanceof BillingError)) return null;
  return new Response(
    JSON.stringify({ success: false, error: e.code, message: e.message }),
    { status: e.statusCode, headers: { ...entetes, 'Content-Type': 'application/json' } },
  );
}

/**
 * Tarifs, en jetons (1 jeton = 0,10 €).
 *
 * Calibrés sur le coût réel constaté, avec la marge ×3 déjà appliquée ailleurs
 * dans la plateforme. Ils DOIVENT rester cohérents avec `ACTION_COSTS` côté
 * front (src/lib/billing/actionCosts.ts), qui sert à l'affichage des prix.
 */
export const TARIFS = {
  /** gpt-image-1.5, 1536x1024 qualité high ≈ 0,25 € l'image. */
  facade_ia: 40,
  /** gpt-image-1, qualité medium, edits ≈ 0,08 € l'image. */
  rendu_ia: 15,
  /** gpt-4o vision, image detail high, 4 000 tokens de sortie ≈ 0,05 €. */
  rehab_analyse_plan: 3,
  /** gpt-4o vision, 16 000 tokens de sortie ≈ 0,16 €. */
  rehab_transcription: 5,
  /** Anthropic sonnet, jusqu'à 8 600 tokens de sortie ≈ 0,25 €. */
  export_rapport_ia: 10,
  /** Ingestion Stream Estate ≈ 0,50 € le run (tarif déjà appliqué côté front). */
  refresh_veille: 30,
} as const;
