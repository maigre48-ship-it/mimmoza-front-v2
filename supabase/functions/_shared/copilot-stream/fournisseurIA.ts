// supabase/functions/_shared/copilot-stream/fournisseurIA.ts
// =============================================================================
// VIS-21 (23/11/2026) — PANNE DU FOURNISSEUR D'IA (Anthropic), distinguée du solde de l'utilisateur.
//
// Cas réel du 23/11 (~09:26 UTC, conversation a7cca310…) : le compte API Anthropic de Mimmoza était à court de crédit
// (« Anthropic API 400 … Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to
// upgrade or purchase credits. »). Le front lisait « credits » dans ce texte et affichait « Vous n'avez plus assez de
// jetons » à un utilisateur qui en avait 1 049 ; la mission lancée ensuite s'est close en ÉCHEC après 3 essais.
//
// Code PUR, partagé par le front (node --test) et les Edge Functions (Deno).
// =============================================================================

export type PanneFournisseur = 'credit_epuise' | 'surcharge';

const RE_CREDIT = /credit balance is too low|plans\s*&\s*billing|purchase credits/i;
const RE_SURCHARGE = /overloaded|anthropic api (429|503|529)|rate_limit_error|\b529\b/i;

/** Erreur du fournisseur d'IA (crédit du compte Mimmoza épuisé, surcharge) ; null : autre erreur. */
export function panneFournisseurIA(brut: unknown): PanneFournisseur | null {
  const e = typeof brut === 'string' ? brut : brut instanceof Error ? brut.message : '';
  if (!e) return null;
  if (RE_CREDIT.test(e)) return 'credit_epuise';
  if (RE_SURCHARGE.test(e)) return 'surcharge';
  return null;
}

export const MESSAGE_FOURNISSEUR_CREDIT =
  "Le service d'IA de Mimmoza est momentanément indisponible (crédit du fournisseur épuisé côté Mimmoza). Vos jetons ne sont pas débités. Réessayez plus tard.";
export const MESSAGE_FOURNISSEUR_SURCHARGE =
  "Le service d'IA est momentanément saturé. Vos jetons ne sont pas débités. Réessayez dans quelques instants.";

/** Message honnête à afficher pour une panne du fournisseur ; null : pas une panne du fournisseur. */
export function messagePanneFournisseur(brut: unknown): string | null {
  const p = panneFournisseurIA(brut);
  return p === 'credit_epuise' ? MESSAGE_FOURNISSEUR_CREDIT : p === 'surcharge' ? MESSAGE_FOURNISSEUR_SURCHARGE : null;
}

/** Début de la « question » posée par une mission mise en pause pour panne du fournisseur (reconnue par le front). */
export const PREFIXE_PAUSE_FOURNISSEUR = 'Mission en pause : le service d’IA de Mimmoza est momentanément indisponible';

export function questionPauseFournisseur(p: PanneFournisseur): string {
  return `${PREFIXE_PAUSE_FOURNISSEUR} (${p === 'credit_epuise' ? 'crédit du fournisseur épuisé côté Mimmoza' : 'service saturé'}). `
    + 'Aucun jeton n’est débité pour l’étape interrompue ; votre réserve reste mise de côté. Cliquez « Reprendre » quand le service sera rétabli.';
}

export function estPauseFournisseur(question: unknown): boolean {
  return typeof question === 'string' && question.startsWith(PREFIXE_PAUSE_FOURNISSEUR);
}

/** Réponse envoyée par le bouton « Reprendre » d'une mission en pause (agent_mission_repondre). */
export const REPONSE_REPRENDRE = 'Reprendre la mission';

/** Code du journal (client_errors) — alerte de la page admin « Erreurs ». */
export const CODE_JOURNAL_FOURNISSEUR = 'fournisseur_ia_indisponible';
