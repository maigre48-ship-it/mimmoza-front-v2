// =============================================================================
// studio-ai — règles PURES : CORS, validation des entrées, tarification
// -----------------------------------------------------------------------------
// Aucun import, aucun accès réseau, aucun `Deno.*` : tout ce qui décide de ce
// qu'on accepte et de ce qu'on facture est testable hors ligne
// (policy.test.ts). index.ts ne fait que brancher ces règles sur
// l'authentification, le quota, la facturation et le fournisseur.
// =============================================================================

export type ActionStudio = 'plan' | 'plan-image';

export const ACTIONS_STUDIO: readonly ActionStudio[] = ['plan', 'plan-image'];

/** Bornes d'entrée. Le client ne peut en relever aucune. */
export const LIMITES = {
  messagesMax: 24,
  /** Caractères cumulés : system + tous les messages, ou consigne. */
  texteMax: 40_000,
  /**
   * Longueur de la chaîne base64, pas de l'image décodée. Le fournisseur refuse
   * une image de plus de 10 Mo ENCODÉS sur son API directe ; on retient 10 Mo
   * décimaux (et non 10 × 1024²) pour rester sous sa borne quelle que soit la
   * lecture de « Mo ». Soit ~7,5 Mo d'image décodée.
   */
  imageBase64Max: 10_000_000,
  /** Corps HTTP d'un `plan` : 40k caractères, au pire échappés en \uXXXX. */
  corpsPlanMax: 512 * 1024,
  /** Corps HTTP d'un `plan-image` : l'image + la consigne + l'enveloppe JSON. */
  corpsPlanImageMax: 10_000_000 + 512 * 1024,
} as const;

/** Paramètres fournisseur fixés par le serveur, jamais lus dans la requête. */
export const FOURNISSEUR = {
  modeleParDefaut: 'claude-sonnet-5-5',
  maxTokens: 4096,
  timeoutMs: 60_000,
} as const;

/**
 * Tarifs en jetons (1 jeton = 0,10 €). Le montant vient d'ici, jamais du corps
 * de requête : sinon le client fixerait son prix.
 */
export const TARIFS_STUDIO: Record<ActionStudio, number> = {
  plan: 1,
  'plan-image': 3,
};

export function tarifPour(action: ActionStudio): { montant: number; type: string; description: string } {
  return action === 'plan'
    ? { montant: TARIFS_STUDIO.plan, type: 'studio_ai_plan', description: 'Studio — génération de plan IA' }
    : { montant: TARIFS_STUDIO['plan-image'], type: 'studio_ai_plan_image', description: "Studio — lecture IA d'un plan image" };
}

export function corpsMaxPour(action: ActionStudio): number {
  return action === 'plan' ? LIMITES.corpsPlanMax : LIMITES.corpsPlanImageMax;
}

// ── Débit ────────────────────────────────────────────────────────────────────

export type IssueDebit =
  | { preleve: true }
  | { preleve: false; code: 'NO_TOKENS' | 'NO_ACCOUNT' | 'BILLING_UNAVAILABLE'; message: string; statusCode: number };

/**
 * Lit le résultat de la RPC `feature_spend_credits`. `preleve: true` est la
 * SEULE preuve qu'il y a des jetons à rendre : index.ts ne rembourse que sur
 * cette valeur, jamais sur une déduction (« ce compte n'est pas administrateur »).
 * Toute erreur, y compris sans message, vaut « rien prélevé » et bloque l'appel.
 */
export function interpreterDebit(erreurRpc: { message?: string | null } | null | undefined, montant: number): IssueDebit {
  if (!erreurRpc) return { preleve: true };
  const brut = (erreurRpc.message ?? '').toUpperCase();
  if (brut.includes('NO_TOKENS')) {
    return { preleve: false, code: 'NO_TOKENS', message: `Solde insuffisant : ${montant} jetons requis.`, statusCode: 402 };
  }
  if (brut.includes('NO_ACCOUNT')) {
    return { preleve: false, code: 'NO_ACCOUNT', message: 'Aucun compte de jetons pour cet utilisateur.', statusCode: 402 };
  }
  return { preleve: false, code: 'BILLING_UNAVAILABLE', message: 'Facturation indisponible.', statusCode: 500 };
}

export type EtatDebit = 'non_preleve' | 'preleve' | 'rembourse' | 'remboursement_echoue';

export interface SuiviDebit {
  readonly etat: EtatDebit;
  /** À appeler uniquement quand `interpreterDebit` a rendu `preleve: true`. */
  confirmer(): void;
  /**
   * Tente le remboursement AU PLUS UNE FOIS par requête, et seulement après
   * `confirmer()`. `rendre` dit `true` si les jetons sont revenus ; `false` ou
   * une exception valent échec. Ne lève jamais. Rend l'état atteint.
   */
  rembourserUneFois(rendre: () => Promise<boolean>): Promise<EtatDebit>;
}

/**
 * Suit le débit d'UNE requête pour que tout échec postérieur — prévu ou non —
 * passe par le même verrou. Sans confirmation (administrateur, débit refusé ou
 * incertain) il n'y a rien à rendre. L'état quitte `preleve` AVANT d'attendre
 * `rendre` : un remboursement en cours ou raté n'est donc jamais retenté, même
 * si une seconde exception survient pendant le traitement de la première.
 */
export function suivreDebit(): SuiviDebit {
  let etat: EtatDebit = 'non_preleve';
  return {
    get etat() { return etat; },
    confirmer() { if (etat === 'non_preleve') etat = 'preleve'; },
    async rembourserUneFois(rendre) {
      if (etat !== 'preleve') return etat;
      etat = 'remboursement_echoue';
      try {
        if (await rendre() === true) etat = 'rembourse';
      } catch {
        // reste `remboursement_echoue`
      }
      return etat;
    },
  };
}

// ── Activation ───────────────────────────────────────────────────────────────

/** Seule la valeur exacte « 1 » active la fonction : absent, vide ou « true » = éteint. */
export function estActive(valeur: string | undefined | null): boolean {
  return valeur === '1';
}

// ── CORS ─────────────────────────────────────────────────────────────────────

/**
 * Lit STUDIO_ALLOWED_ORIGINS (séparateur virgule ou espace).
 *
 * Fail-closed : une entrée qui n'est pas une origine exacte est IGNORÉE, jamais
 * élargie. Pas de joker, pas de chemin, pas de `http://` hors poste local. Une
 * variable absente ou entièrement invalide donne une liste vide, donc aucun
 * appel accepté.
 */
export function parseOriginesAutorisees(brut: string | undefined | null): string[] {
  if (!brut) return [];
  const retenues: string[] = [];
  for (const morceau of brut.split(/[\s,]+/)) {
    const entree = morceau.replace(/\/$/, '');
    if (!entree || entree.includes('*')) continue;
    let url: URL;
    try { url = new URL(entree); } catch { continue; }
    if (url.origin !== entree) continue;
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) continue;
    if (!retenues.includes(entree)) retenues.push(entree);
  }
  return retenues;
}

/**
 * En-têtes CORS pour une origine, ou `null` si elle n'est pas autorisée.
 *
 * Comparaison exacte, sensible à la casse. Une requête sans en-tête `Origin`
 * est refusée elle aussi : la fonction ne sert que le Studio dans un navigateur.
 * L'origine renvoyée est celle de la liste, jamais un écho de l'en-tête reçu.
 */
export function enTetesCors(origine: string | null | undefined, autorisees: readonly string[]): Record<string, string> | null {
  if (!origine) return null;
  const trouvee = autorisees.find((o) => o === origine);
  if (!trouvee) return null;
  return {
    'Access-Control-Allow-Origin': trouvee,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

// ── Routage ──────────────────────────────────────────────────────────────────

/**
 * L'action vient de l'URL — dernier segment (`…/studio-ai/plan-image`) ou, à
 * défaut, `?action=` — et non du corps : elle doit être connue AVANT de lire ce
 * dernier, pour lui appliquer la bonne borne de taille.
 */
export function resoudreAction(urlRequete: string): ActionStudio | null {
  let url: URL;
  try { url = new URL(urlRequete); } catch { return null; }
  const segment = url.pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  const candidat = (ACTIONS_STUDIO as readonly string[]).includes(segment) ? segment : url.searchParams.get('action');
  return (ACTIONS_STUDIO as readonly string[]).includes(candidat ?? '') ? (candidat as ActionStudio) : null;
}

// ── Validation ───────────────────────────────────────────────────────────────

export type CodeErreurEntree =
  | 'CORPS_INVALIDE'
  | 'CHAMP_INTERDIT'
  | 'SYSTEM_INVALIDE'
  | 'MESSAGES_INVALIDES'
  | 'TROP_DE_MESSAGES'
  | 'TEXTE_TROP_LONG'
  | 'CONSIGNE_INVALIDE'
  | 'TYPE_IMAGE_REFUSE'
  | 'IMAGE_INVALIDE'
  | 'IMAGE_TROP_LOURDE';

export type Validation<T> = { ok: true; valeur: T } | { ok: false; erreur: CodeErreurEntree };

export interface MessagePlan { role: 'user' | 'assistant'; content: string }
export interface EntreePlan { system: string; messages: MessagePlan[] }
export type TypeImage = 'image/jpeg' | 'image/png' | 'image/webp';
export interface EntreePlanImage { consigne: string; imageBase64: string; mediaType: TypeImage }

const refus = (erreur: CodeErreurEntree): { ok: false; erreur: CodeErreurEntree } => ({ ok: false, erreur });

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Tout champ hors contrat est REFUSÉ, pas ignoré : `model`, `max_tokens`,
 * `tools`, `imageUrl`… Un client qui croit piloter le fournisseur doit le
 * savoir tout de suite, plutôt que voir son réglage disparaître en silence.
 */
function champsHorsContrat(objet: Record<string, unknown>, permis: readonly string[]): boolean {
  return Object.keys(objet).some((cle) => !permis.includes(cle));
}

export function validerPlan(corps: unknown): Validation<EntreePlan> {
  if (!estObjet(corps)) return refus('CORPS_INVALIDE');
  if (champsHorsContrat(corps, ['system', 'messages'])) return refus('CHAMP_INTERDIT');

  const system = corps.system ?? '';
  if (typeof system !== 'string') return refus('SYSTEM_INVALIDE');

  const bruts = corps.messages;
  if (!Array.isArray(bruts) || bruts.length === 0) return refus('MESSAGES_INVALIDES');
  if (bruts.length > LIMITES.messagesMax) return refus('TROP_DE_MESSAGES');

  let total = system.length;
  const messages: MessagePlan[] = [];
  for (const brut of bruts) {
    if (!estObjet(brut) || champsHorsContrat(brut, ['role', 'content'])) return refus('MESSAGES_INVALIDES');
    const { role, content } = brut;
    if (role !== 'user' && role !== 'assistant') return refus('MESSAGES_INVALIDES');
    // Texte seul : pas de blocs de contenu, donc ni image ni URL arbitraire.
    if (typeof content !== 'string' || content.trim() === '') return refus('MESSAGES_INVALIDES');
    total += content.length;
    if (total > LIMITES.texteMax) return refus('TEXTE_TROP_LONG');
    messages.push({ role, content });
  }
  // La conversation s'ouvre et se ferme sur l'utilisateur (pas de préremplissage).
  if (messages[0].role !== 'user' || messages[messages.length - 1].role !== 'user') return refus('MESSAGES_INVALIDES');

  return { ok: true, valeur: { system, messages } };
}

const TYPES_IMAGE = new Map<string, TypeImage>([
  ['image/jpeg', 'image/jpeg'],
  ['image/jpg', 'image/jpeg'],
  ['image/png', 'image/png'],
  ['image/webp', 'image/webp'],
]);

/**
 * Base64 nu uniquement : ni préfixe `data:`, ni URL, ni espaces. Boucle plutôt
 * qu'expression régulière : le coût reste linéaire et prévisible sur 10 Mo.
 */
function estBase64Nu(s: string): boolean {
  if (s.length < 16 || s.length % 4 !== 0) return false;
  let fin = s.length;
  if (s.charCodeAt(fin - 1) === 61) fin--;
  if (s.charCodeAt(fin - 1) === 61) fin--;
  for (let i = 0; i < fin; i++) {
    const c = s.charCodeAt(i);
    const valide = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47;
    if (!valide) return false;
  }
  return true;
}

/** Type réel d'après les premiers octets, indépendamment du type annoncé. */
function typeReel(base64: string): TypeImage | null {
  let tete: string;
  try { tete = atob(base64.slice(0, 16)); } catch { return null; }
  const o = (i: number) => tete.charCodeAt(i);
  if (o(0) === 0xff && o(1) === 0xd8 && o(2) === 0xff) return 'image/jpeg';
  if (tete.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (tete.startsWith('RIFF') && tete.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function validerPlanImage(corps: unknown): Validation<EntreePlanImage> {
  if (!estObjet(corps)) return refus('CORPS_INVALIDE');
  if (champsHorsContrat(corps, ['consigne', 'imageBase64', 'mediaType'])) return refus('CHAMP_INTERDIT');

  const { consigne, imageBase64, mediaType } = corps;
  if (typeof consigne !== 'string' || consigne.trim() === '') return refus('CONSIGNE_INVALIDE');
  if (consigne.length > LIMITES.texteMax) return refus('TEXTE_TROP_LONG');

  const type = typeof mediaType === 'string' ? TYPES_IMAGE.get(mediaType.toLowerCase()) : undefined;
  if (!type) return refus('TYPE_IMAGE_REFUSE');

  if (typeof imageBase64 !== 'string') return refus('IMAGE_INVALIDE');
  if (imageBase64.length > LIMITES.imageBase64Max) return refus('IMAGE_TROP_LOURDE');
  if (!estBase64Nu(imageBase64) || typeReel(imageBase64) !== type) return refus('IMAGE_INVALIDE');

  return { ok: true, valeur: { consigne, imageBase64, mediaType: type } };
}

// ── Fournisseur ──────────────────────────────────────────────────────────────

/** Modèle fixé par l'environnement ; une valeur mal formée retombe sur le défaut. */
export function modeleFixe(valeurEnv: string | undefined | null): string {
  const v = (valeurEnv ?? '').trim();
  return /^claude-[a-z0-9.-]{1,60}$/.test(v) ? v : FOURNISSEUR.modeleParDefaut;
}

/** Corps de la requête Messages. `model` et `max_tokens` ne viennent que du serveur. */
export function construireRequeteFournisseur(
  entree: { action: 'plan'; valeur: EntreePlan } | { action: 'plan-image'; valeur: EntreePlanImage },
  modele: string,
): Record<string, unknown> {
  const base = { model: modele, max_tokens: FOURNISSEUR.maxTokens };
  if (entree.action === 'plan') {
    const { system, messages } = entree.valeur;
    return { ...base, ...(system.trim() ? { system } : {}), messages };
  }
  const { consigne, imageBase64, mediaType } = entree.valeur;
  return {
    ...base,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: consigne },
      ],
    }],
  };
}

export interface ReponseStudio {
  raw: string;
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * Ne retient de la réponse fournisseur que le texte et le décompte de tokens.
 * `null` si elle ne contient aucun texte exploitable (refus, réponse vide) :
 * l'appelant traite alors l'appel comme un échec, donc rembourse.
 */
export function extraireReponse(reponse: unknown): ReponseStudio | null {
  if (!estObjet(reponse) || !Array.isArray(reponse.content)) return null;
  if (reponse.stop_reason === 'refusal') return null;
  const raw = reponse.content
    .filter((bloc): bloc is { type: 'text'; text: string } => estObjet(bloc) && bloc.type === 'text' && typeof bloc.text === 'string')
    .map((bloc) => bloc.text)
    .join('\n')
    .trim();
  if (!raw) return null;

  const u = reponse.usage;
  const usage = estObjet(u) && typeof u.input_tokens === 'number' && typeof u.output_tokens === 'number'
    ? { input_tokens: u.input_tokens, output_tokens: u.output_tokens }
    : undefined;
  return usage ? { raw, usage } : { raw };
}
