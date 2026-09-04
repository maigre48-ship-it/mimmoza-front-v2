// src/spaces/admin/services/userHistory.service.ts
//
// Historique consolidé d'un utilisateur, pour la fiche admin.
//
// ─── Périmètre et pourquoi ────────────────────────────────────────────────────
// Trois sources seulement, et c'est délibéré : ce sont les trois tables que la
// RLS autorise un admin à lire pour un AUTRE utilisateur que lui-même.
//
//   credit_transactions  → politique `credit_transactions_select_admin`     ✅
//   quotes               → politique `quotes_admin_all` / `admin full quotes` ✅
//   invoices             → politique `invoices_admin_all` / `admin full…`   ✅
//
// Deux sources ont été volontairement écartées :
//
//   copilot_messages   → RLS propriétaire uniquement (`auth.uid() = user_id`).
//     Un admin ne peut pas les lire, et il ne DOIT pas : ce sont des
//     conversations privées. L'activité copilote reste néanmoins visible ici,
//     car chaque échange laisse une ligne `credit_transactions` de type
//     'copilot' — on a la trace et le coût, sans le contenu des messages.
//
//   billing_profiles   → RLS propriétaire uniquement. Le plan COURANT est déjà
//     exposé par la RPC `admin_users_list` (colonne plan_codes) ; la table ne
//     stocke de toute façon que created_at/updated_at, donc aucun historique
//     de changement de plan n'existe en base aujourd'hui.
//
// Conséquence à retenir : cet historique est complet pour la facturation et la
// consommation de jetons, et muet sur le contenu conversationnel.
//
// ─── Gestion des erreurs ──────────────────────────────────────────────────────
// Chaque source est lue indépendamment (Promise.allSettled). Une source qui
// échoue produit un avertissement remonté à l'appelant : l'écran affiche alors
// « la facturation n'a pas pu être lue » plutôt qu'une chronologie amputée en
// silence. C'est exactement le piège dans lequel la bannière d'alertes était
// tombée.

import { supabase } from "../../../lib/supabase";

// ── Types ────────────────────────────────────────────────────────────────────

export type UserHistoryKind = "jetons" | "devis" | "facture";

export interface UserHistoryEvent {
  /** Clé stable pour React. */
  id: string;
  /** ISO 8601. Sert au tri. */
  at: string;
  kind: UserHistoryKind;
  /** Intitulé court, déjà en français. */
  label: string;
  /** Précision optionnelle (description libre, numéro de pièce…). */
  detail: string | null;
  /** Mouvement de jetons, signé. `null` hors des lignes de crédit. */
  jetons: number | null;
  /** Montant TTC en centimes. `null` hors devis/facture. */
  montantCents: number | null;
  /** Lien interne vers la pièce concernée, quand il y en a une. */
  href: string | null;
}

export interface UserHistoryResult {
  events: UserHistoryEvent[];
  /** Sources qui n'ont pas pu être lues. Vide = chronologie complète. */
  warnings: string[];
  /** Compteurs par nature, calculés sur ce qui a réellement pu être lu. */
  totaux: {
    jetonsCredites: number;
    jetonsDebites: number;
    devis: number;
    factures: number;
  };
}

// ── Libellés ─────────────────────────────────────────────────────────────────

/**
 * Types réellement présents en base au 31/08/2026 (relevé sur
 * `select distinct type from credit_transactions`). Un type inconnu n'est pas
 * masqué : il s'affiche tel quel, ce qui rend visible toute nouvelle nature de
 * mouvement au lieu de la faire disparaître.
 */
const LIBELLES_TRANSACTION: Record<string, string> = {
  copilot:               "Conversation copilote",
  copilot_refund:        "Remboursement copilote",
  copilot_settle_refund: "Régularisation copilote",
  deal_unlock:           "Déblocage d'une opportunité",
  deal_unlock_refund:    "Remboursement de déblocage",
  project_unlock:        "Déblocage d'un projet",
  quick_analysis:        "Analyse rapide",
  opportunity_scan:      "Scan d'opportunités",
  rendu_ia:              "Rendu IA",
  admin_grant:           "Jetons attribués par un admin",
  signup_bonus:          "Bonus d'inscription",
};

function libelleTransaction(type: string): string {
  return LIBELLES_TRANSACTION[type] ?? type;
}

const LIBELLES_STATUT_DEVIS: Record<string, string> = {
  draft:                "brouillon",
  sent:                 "envoyé",
  viewed:               "consulté",
  accepted:             "accepté",
  rejected:             "refusé",
  expired:              "expiré",
  converted_to_invoice: "converti en facture",
};

const LIBELLES_STATUT_FACTURE: Record<string, string> = {
  draft:           "brouillon",
  issued:          "émise",
  sent:            "envoyée",
  paid:            "payée",
  partially_paid:  "partiellement payée",
  overdue:         "en retard",
  cancelled:       "annulée",
};

// ── Lecture ──────────────────────────────────────────────────────────────────

type LigneCredit = {
  id: string;
  created_at: string | null;
  type: string;
  amount: number;
  feature_key: string | null;
  description: string | null;
};

type LigneDevis = {
  id: string;
  created_at: string;
  quote_number: string;
  status: string;
  amount_ttc_cents: number;
  company_name: string;
};

type LigneFacture = {
  id: string;
  created_at: string;
  invoice_number: string;
  status: string;
  amount_ttc_cents: number;
  company_name: string;
  paid_at: string | null;
};

/** Nombre maximal de mouvements de jetons remontés (les plus récents). */
const LIMITE_JETONS = 300;

async function lireJetons(userId: string): Promise<LigneCredit[]> {
  const { data, error } = await supabase
    .from("credit_transactions")
    .select("id, created_at, type, amount, feature_key, description")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(LIMITE_JETONS);
  if (error) throw new Error(error.message);
  return (data ?? []) as LigneCredit[];
}

async function lireDevis(userId: string): Promise<LigneDevis[]> {
  const { data, error } = await supabase
    .from("quotes")
    .select("id, created_at, quote_number, status, amount_ttc_cents, company_name")
    .eq("recipient_user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LigneDevis[];
}

async function lireFactures(userId: string): Promise<LigneFacture[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, created_at, invoice_number, status, amount_ttc_cents, company_name, paid_at")
    .eq("recipient_user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LigneFacture[];
}

// ── Agrégation ───────────────────────────────────────────────────────────────

export async function loadUserHistory(userId: string): Promise<UserHistoryResult> {
  if (!userId) {
    return {
      events: [],
      warnings: ["Aucun identifiant utilisateur fourni."],
      totaux: { jetonsCredites: 0, jetonsDebites: 0, devis: 0, factures: 0 },
    };
  }

  const [resJetons, resDevis, resFactures] = await Promise.allSettled([
    lireJetons(userId),
    lireDevis(userId),
    lireFactures(userId),
  ]);

  const events: UserHistoryEvent[] = [];
  const warnings: string[] = [];
  const totaux = { jetonsCredites: 0, jetonsDebites: 0, devis: 0, factures: 0 };

  // — Jetons —
  let sansDate = 0;
  if (resJetons.status === "fulfilled") {
    for (const ligne of resJetons.value) {
      // Les compteurs d'abord : une ligne sans date reste un mouvement réel de
      // jetons. L'exclure du total ferait diverger le récapitulatif du solde,
      // sans que rien ne le signale.
      if (ligne.amount > 0) totaux.jetonsCredites += ligne.amount;
      else totaux.jetonsDebites += Math.abs(ligne.amount);

      // Sans date, en revanche, impossible de la placer sur la frise.
      if (!ligne.created_at) {
        sansDate += 1;
        continue;
      }

      const detail = ligne.description?.trim() || ligne.feature_key?.trim() || null;
      events.push({
        id: `jetons:${ligne.id}`,
        at: ligne.created_at,
        kind: "jetons",
        label: libelleTransaction(ligne.type),
        detail,
        jetons: ligne.amount,
        montantCents: null,
        href: null,
      });
    }
    if (resJetons.value.length === LIMITE_JETONS) {
      warnings.push(
        `Seuls les ${LIMITE_JETONS} mouvements de jetons les plus récents sont affichés.`,
      );
    }
    if (sansDate > 0) {
      warnings.push(
        sansDate === 1
          ? "1 mouvement de jetons n'a pas de date : il est compté dans le récapitulatif mais absent de la chronologie."
          : `${sansDate} mouvements de jetons n'ont pas de date : ils sont comptés dans le récapitulatif mais absents de la chronologie.`,
      );
    }
  } else {
    console.error("[userHistory] lecture des jetons impossible:", resJetons.reason);
    warnings.push("Les mouvements de jetons n'ont pas pu être lus.");
  }

  // — Devis —
  if (resDevis.status === "fulfilled") {
    totaux.devis = resDevis.value.length;
    for (const devis of resDevis.value) {
      const statut = LIBELLES_STATUT_DEVIS[devis.status] ?? devis.status;
      events.push({
        id: `devis:${devis.id}`,
        at: devis.created_at,
        kind: "devis",
        label: `Devis ${devis.quote_number}`,
        detail: `${devis.company_name} — ${statut}`,
        jetons: null,
        montantCents: devis.amount_ttc_cents,
        href: `/admin/devis?highlight=${devis.id}`,
      });
    }
  } else {
    console.error("[userHistory] lecture des devis impossible:", resDevis.reason);
    warnings.push("Les devis n'ont pas pu être lus.");
  }

  // — Factures —
  if (resFactures.status === "fulfilled") {
    totaux.factures = resFactures.value.length;
    for (const facture of resFactures.value) {
      const statut = LIBELLES_STATUT_FACTURE[facture.status] ?? facture.status;
      events.push({
        id: `facture:${facture.id}`,
        at: facture.created_at,
        kind: "facture",
        label: `Facture ${facture.invoice_number}`,
        detail: `${facture.company_name} — ${statut}`,
        jetons: null,
        montantCents: facture.amount_ttc_cents,
        href: `/admin/factures?highlight=${facture.id}`,
      });

      // Le règlement est un événement distinct de l'émission : il mérite sa
      // propre place sur la frise, à sa date à lui.
      if (facture.paid_at) {
        events.push({
          id: `facture-paiement:${facture.id}`,
          at: facture.paid_at,
          kind: "facture",
          label: `Règlement de la facture ${facture.invoice_number}`,
          detail: facture.company_name,
          jetons: null,
          montantCents: facture.amount_ttc_cents,
          href: `/admin/factures?highlight=${facture.id}`,
        });
      }
    }
  } else {
    console.error("[userHistory] lecture des factures impossible:", resFactures.reason);
    warnings.push("Les factures n'ont pas pu être lues.");
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return { events, warnings, totaux };
}
