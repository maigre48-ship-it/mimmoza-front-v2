// supabase/functions/_shared/emails/regles.ts
// =============================================================================
// E-MAILS DE CYCLE DE VIE — RÈGLES DE SÉLECTION (logique PURE, sans réseau)
// =============================================================================
//
// Qui reçoit quoi, et quand. Ce fichier ne lit aucune base et n'envoie rien :
// la fonction `emails-cycle-vie` lui passe un « profil d'envoi » déjà chargé et
// reçoit la liste des e-mails à envoyer. Il est testé par node --test
// (src/spaces/copilot/onboarding/emailsCycleVie.test.ts) et tourne tel quel
// sous Deno (aucun import).
//
// Règles (récapitulatif) :
//   bienvenue            transactionnel  compte confirmé depuis ≤ 7 jours, une fois
//   premiere_analyse     transactionnel  1re conversation créée depuis ≤ 2 jours, compte ≤ 30 jours, une fois
//   rappel_sans_analyse  conseils        aucune analyse, inscrit depuis 3 à 10 jours, compte confirmé, une fois
//   quota_80             alertes_usage   ≥ 80 % des analyses rapides incluses du mois (< 100 %), une fois par mois
//   quota_100            transactionnel  100 % des analyses rapides incluses du mois, une fois par mois
//   solde_bas            alertes_usage   solde < SEUIL_SOLDE_BAS et au moins une dépense de jetons sur 30 jours, une fois par mois
//
// Garde-fous :
//   · déjà envoyé (même type, même clé de période) → jamais renvoyé ;
//   · e-mail non transactionnel : catégorie désactivée → pas d'envoi ;
//   · AU PLUS UN e-mail non transactionnel par jour (heure de Paris) et par personne.
// =============================================================================

export type TypeEmail =
  | "bienvenue"
  | "premiere_analyse"
  | "rappel_sans_analyse"
  | "quota_80"
  | "quota_100"
  | "solde_bas";

export const TYPES_EMAIL: readonly TypeEmail[] = [
  "bienvenue",
  "premiere_analyse",
  "rappel_sans_analyse",
  "quota_80",
  "quota_100",
  "solde_bas",
];

/** Catégorie de préférence. « compte » = transactionnel, non désactivable. */
export type CategorieEmail = "compte" | "conseils" | "alertes_usage";

export const CATEGORIE_EMAIL: Record<TypeEmail, CategorieEmail> = {
  bienvenue: "compte",
  premiere_analyse: "compte",
  quota_100: "compte",
  rappel_sans_analyse: "conseils",
  quota_80: "alertes_usage",
  solde_bas: "alertes_usage",
};

export function estTransactionnel(type: TypeEmail): boolean {
  return CATEGORIE_EMAIL[type] === "compte";
}

/** Formules (codes techniques conservés, cf. src/lib/billing/grille.ts). */
export type CodeFormule = "basique" | "avance" | "pro" | "proplus";

/**
 * Analyses rapides incluses par mois — COPIE de ANALYSES_RAPIDES_INCLUSES_PAR_FORMULE
 * (src/lib/billing/grille.ts). Une Edge Function ne peut pas importer src/ :
 * le test emailsCycleVie.test.ts vérifie que les deux restent identiques.
 */
export const ANALYSES_INCLUSES: Record<CodeFormule, number> = {
  basique: 3,
  avance: 100,
  pro: 300,
  proplus: 1000,
};

/** Libellés commerciaux — copie de NOM_FORMULE (grille.ts), vérifiée par test. */
export const NOM_FORMULE_EMAIL: Record<CodeFormule, string> = {
  basique: "Découverte",
  avance: "Indépendant",
  pro: "Pro",
  proplus: "Équipe",
};

/** Coût d'une analyse rapide au-delà du quota — copie de ACTION_COSTS.analyse_rapide. */
export const JETONS_PAR_ANALYSE = 10;

/** En dessous de ce solde (jetons), on prévient — 3 analyses rapides. */
export const SEUIL_SOLDE_BAS = 30;

const JOUR_MS = 24 * 3600 * 1000;

/**
 * Formule active à partir de billing_profiles — même logique que la fonction
 * SQL public.formule_active (migration 20261021_plafonds_formules.sql).
 */
export function formuleActive(planCode: string | null | undefined, statut: string | null | undefined): CodeFormule {
  const actif = statut === "active" || statut === "trialing";
  if (!actif) return "basique";
  const code = (planCode ?? "").toLowerCase();
  if (code === "avance" || code === "advanced" || code === "starter") return "avance";
  if (code === "pro") return "pro";
  if (code === "proplus") return "proplus";
  return "basique";
}

/** « AAAA-MM-JJ » à l'heure de Paris. */
export function jourParis(d: Date): string {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** « AAAA-MM » en UTC — même découpage que free_quick_analysis_usage.mois. */
export function moisUtc(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export interface EnvoiPasse {
  type: TypeEmail;
  cle: string;
  /** ISO. */
  envoyeLe: string;
}

export interface ProfilEnvoi {
  userId: string;
  email: string | null;
  prenom?: string | null;
  /** ISO — auth.users.created_at. */
  inscritLe: string;
  /** ISO — auth.users.email_confirmed_at (null = non confirmé). */
  confirmeLe: string | null;
  formule: CodeFormule;
  /** Analyses rapides incluses consommées ce mois-ci (free_quick_analysis_usage.nb). */
  analysesMois: number;
  /** Analyses rapides lancées depuis l'inscription (tickets + débits « quick_analysis »). */
  analysesTotal: number;
  /** Solde de jetons (credit_accounts.current_credits) ; null si pas de compte de jetons. */
  soldeJetons: number | null;
  /** Nombre de débits de jetons sur les 30 derniers jours. */
  depensesJetons30j: number;
  nbConversations: number;
  premiereConversation: { id: string; creeLe: string } | null;
  preferences: { conseils: boolean; alertes_usage: boolean };
  /** Envois déjà faits (statut envoyé ou en cours), tous types. */
  envois: EnvoiPasse[];
}

export interface Decision {
  type: TypeEmail;
  cle: string;
  transactionnel: boolean;
}

/** Ordre de priorité des e-mails non transactionnels (un seul par jour). */
const PRIORITE_NON_TRANSACTIONNEL: TypeEmail[] = ["quota_80", "solde_bas", "rappel_sans_analyse"];

function ageJours(iso: string | null | undefined, maintenant: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (maintenant.getTime() - t) / JOUR_MS;
}

/** Candidats bruts, avant dédoublonnage, préférences et plafond quotidien. */
export function candidats(p: ProfilEnvoi, maintenant: Date): Decision[] {
  const out: Decision[] = [];
  const add = (type: TypeEmail, cle: string) => out.push({ type, cle, transactionnel: estTransactionnel(type) });

  const ageConfirmation = ageJours(p.confirmeLe, maintenant);
  const ageInscription = ageJours(p.inscritLe, maintenant);

  // (a) Bienvenue — après confirmation, une seule fois, seulement pour un compte récent
  if (ageConfirmation !== null && ageConfirmation >= 0 && ageConfirmation <= 7) add("bienvenue", "unique");

  // (b) Première analyse prête
  const agePremiere = ageJours(p.premiereConversation?.creeLe, maintenant);
  if (
    p.premiereConversation &&
    agePremiere !== null && agePremiere >= 0 && agePremiere <= 2 &&
    ageInscription !== null && ageInscription <= 30
  ) {
    add("premiere_analyse", "unique");
  }

  // (b') Rappel : aucune analyse 3 jours après l'inscription (fenêtre jusqu'à 10 jours)
  if (
    p.confirmeLe &&
    ageInscription !== null && ageInscription >= 3 && ageInscription <= 10 &&
    p.nbConversations === 0 && p.analysesTotal === 0
  ) {
    add("rappel_sans_analyse", "unique");
  }

  // (c) Quota d'analyses rapides du mois
  const quota = ANALYSES_INCLUSES[p.formule];
  const mois = moisUtc(maintenant);
  if (quota > 0) {
    if (p.analysesMois >= quota) add("quota_100", mois);
    else if (p.analysesMois >= Math.ceil(quota * 0.8)) add("quota_80", mois);
  }

  // (d) Solde de jetons bas — seulement pour un compte qui dépense des jetons
  if (p.soldeJetons !== null && p.soldeJetons < SEUIL_SOLDE_BAS && p.depensesJetons30j > 0) {
    add("solde_bas", mois);
  }

  return out;
}

/** Décision finale : ce qu'il faut envoyer MAINTENANT à cette personne. */
export function selectionner(p: ProfilEnvoi, maintenant: Date): Decision[] {
  if (!p.email) return [];
  const deja = new Set(p.envois.map((e) => `${e.type}|${e.cle}`));
  const aujourdHui = jourParis(maintenant);
  const nonTransactionnelAujourdHui = p.envois.some(
    (e) => !estTransactionnel(e.type) && jourParis(new Date(e.envoyeLe)) === aujourdHui,
  );

  const restants = candidats(p, maintenant).filter((d) => {
    if (deja.has(`${d.type}|${d.cle}`)) return false;
    const cat = CATEGORIE_EMAIL[d.type];
    if (cat === "conseils" && !p.preferences.conseils) return false;
    if (cat === "alertes_usage" && !p.preferences.alertes_usage) return false;
    return true;
  });

  const transactionnels = restants.filter((d) => d.transactionnel);
  if (nonTransactionnelAujourdHui) return transactionnels;

  const nonTransactionnels = restants
    .filter((d) => !d.transactionnel)
    .sort((a, b) => PRIORITE_NON_TRANSACTIONNEL.indexOf(a.type) - PRIORITE_NON_TRANSACTIONNEL.indexOf(b.type));
  return nonTransactionnels.length ? [...transactionnels, nonTransactionnels[0]] : transactionnels;
}
