// src/lib/billing/analyseRapideQuota.ts
// =============================================================================
// Analyse rapide — quota gratuit, puis jetons, avec remboursement si échec
// (audit du 21/10/2026, P0 n°3 ; migration 20261021_analyse_rapide_gratuite.sql)
// =============================================================================
//
// Ordre de consommation :
//   1. consume_free_quick_analysis() — analyses incluses par mois selon la formule (3 / 100 / 300 / 1 000) ;
//   2. debit_quick_analysis()        — 10 jetons, montant fixé par le serveur ;
//   3. REPLI si la migration n'est pas encore appliquée (RPC absentes) :
//      spend_credits(10) comme avant, sans ticket (donc sans remboursement).
//
// Chaque consommation renvoie un ticket : `rembourserAnalyseRapide` le rend si
// le moteur échoue, `confirmerAnalyseRapide` le clôt après un succès.
// =============================================================================

import { supabase } from "@/lib/supabase";
import { ACTION_COSTS } from "./actionCosts";
import { spendCredits } from "./projectUnlock";

export type ReservationAnalyse =
  | {
      ok: true;
      source: "gratuit" | "jetons" | "jetons_sans_ticket";
      ticket: string | null;
      /** Analyses gratuites restantes ce mois-ci (si connu). */
      gratuitesRestantes: number | null;
    }
  | {
      ok: false;
      reason: "NOT_AUTHENTICATED" | "NO_TOKENS" | "ERROR";
      message: string;
    };

/** Une RPC absente (migration non appliquée) : PostgREST PGRST202 ou Postgres 42883. */
function rpcAbsente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    msg.includes("could not find the function") ||
    (msg.includes("function") && msg.includes("does not exist"))
  );
}

function erreurConnue(message: string): ReservationAnalyse {
  const m = message.toUpperCase();
  if (m.includes("NOT_AUTHENTICATED")) {
    return { ok: false, reason: "NOT_AUTHENTICATED", message: "Connectez-vous pour lancer une analyse." };
  }
  if (m.includes("NO_TOKENS") || m.includes("NO_ACCOUNT")) {
    return {
      ok: false,
      reason: "NO_TOKENS",
      message:
        "Les analyses rapides incluses dans votre formule ce mois-ci sont utilisées et votre solde de jetons " +
        "est insuffisant. Rechargez des jetons ou choisissez une formule supérieure pour continuer.",
    };
  }
  return { ok: false, reason: "ERROR", message };
}

/** true si une session Supabase est ouverte (sans appel réseau si le jeton est en cache). */
export async function aUneSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data.session);
  } catch {
    return false;
  }
}

/** Réserve une analyse : quota gratuit d'abord, puis jetons. */
export async function reserverAnalyseRapide(libelle: string): Promise<ReservationAnalyse> {
  if (!(await aUneSession())) {
    return { ok: false, reason: "NOT_AUTHENTICATED", message: "Connectez-vous pour lancer une analyse." };
  }

  // 1. Quota gratuit
  const gratuit = await supabase.rpc("consume_free_quick_analysis");
  if (rpcAbsente(gratuit.error)) {
    // Migration non appliquée : comportement historique (10 jetons, pas de ticket).
    const spend = await spendCredits(ACTION_COSTS.analyse_rapide, libelle, "quick_analysis");
    if (!spend.ok) return erreurConnue(spend.reason === "ERROR" ? spend.message : spend.reason);
    return { ok: true, source: "jetons_sans_ticket", ticket: null, gratuitesRestantes: null };
  }
  if (gratuit.error) return erreurConnue(gratuit.error.message);

  const g = (gratuit.data ?? {}) as { accorde?: boolean; restantes?: number; ticket?: string | null };
  if (g.accorde) {
    return {
      ok: true,
      source: "gratuit",
      ticket: g.ticket ?? null,
      gratuitesRestantes: typeof g.restantes === "number" ? g.restantes : null,
    };
  }

  // 2. Jetons (montant fixé côté serveur)
  const debit = await supabase.rpc("debit_quick_analysis", { p_libelle: libelle });
  if (rpcAbsente(debit.error)) {
    const spend = await spendCredits(ACTION_COSTS.analyse_rapide, libelle, "quick_analysis");
    if (!spend.ok) return erreurConnue(spend.reason === "ERROR" ? spend.message : spend.reason);
    return { ok: true, source: "jetons_sans_ticket", ticket: null, gratuitesRestantes: 0 };
  }
  if (debit.error) return erreurConnue(debit.error.message);

  const d = (debit.data ?? {}) as { ticket?: string | null };
  return { ok: true, source: "jetons", ticket: d.ticket ?? null, gratuitesRestantes: 0 };
}

/** Rend l'analyse (quota ou jetons) après un échec du moteur. Silencieux en cas d'erreur. */
export async function rembourserAnalyseRapide(reservation: ReservationAnalyse): Promise<boolean> {
  if (!reservation.ok || !reservation.ticket) {
    if (reservation.ok && reservation.source === "jetons_sans_ticket") {
      console.warn("[analyse rapide] échec après débit : remboursement impossible tant que la migration 20261021_analyse_rapide_gratuite n'est pas appliquée.");
    }
    return false;
  }
  const { data, error } = await supabase.rpc("refund_quick_analysis", { p_ticket: reservation.ticket });
  if (error) {
    console.warn("[analyse rapide] remboursement impossible :", error.message);
    return false;
  }
  return Boolean((data as { rembourse?: boolean } | null)?.rembourse);
}

/** Clôt le ticket après un succès (plus de remboursement possible). */
export async function confirmerAnalyseRapide(reservation: ReservationAnalyse): Promise<void> {
  if (!reservation.ok || !reservation.ticket) return;
  const { error } = await supabase.rpc("confirm_quick_analysis", { p_ticket: reservation.ticket });
  if (error && !rpcAbsente(error)) console.warn("[analyse rapide] clôture du ticket :", error.message);
}

// ── Analyse en attente d'inscription ─────────────────────────────────────────
// Le visiteur non connecté remplit le formulaire, crée son compte, puis revient
// sur /analyse-rapide?reprise=1 : la saisie est restaurée et l'analyse relancée.
// sessionStorage couvre l'inscription dans le même onglet ; localStorage
// couvre le lien de confirmation d'e-mail, qui ouvre un nouvel onglet.
// Données conservées : adresse et caractéristiques du bien (aucune donnée
// personnelle), expirées au bout de 24 h.

const CLE_ATTENTE = "mimmoza.analyseRapide.enAttente";
const DUREE_ATTENTE_MS = 24 * 60 * 60 * 1000;

export const URL_REPRISE_ANALYSE = "/analyse-rapide?reprise=1";

export function memoriserAnalyseEnAttente<T extends object>(form: T): void {
  const valeur = JSON.stringify({ form, enregistreLe: Date.now() });
  try { sessionStorage.setItem(CLE_ATTENTE, valeur); } catch { /* stockage indisponible */ }
  try { localStorage.setItem(CLE_ATTENTE, valeur); } catch { /* stockage indisponible */ }
}

export function lireAnalyseEnAttente<T extends object>(): T | null {
  for (const stockage of [() => sessionStorage, () => localStorage]) {
    try {
      const brut = stockage().getItem(CLE_ATTENTE);
      if (!brut) continue;
      const v = JSON.parse(brut) as { form?: T; enregistreLe?: number };
      if (!v.form || !v.enregistreLe || Date.now() - v.enregistreLe > DUREE_ATTENTE_MS) continue;
      return v.form;
    } catch {
      /* illisible : on ignore */
    }
  }
  return null;
}

export function effacerAnalyseEnAttente(): void {
  try { sessionStorage.removeItem(CLE_ATTENTE); } catch { /* noop */ }
  try { localStorage.removeItem(CLE_ATTENTE); } catch { /* noop */ }
}

/** Lien d'inscription qui ramène à l'analyse après création du compte. */
export function lienInscriptionAvecReprise(): string {
  return `/inscription?suite=${encodeURIComponent(URL_REPRISE_ANALYSE)}`;
}

/** Valide une URL de retour (chemin interne uniquement, pas de redirection ouverte). */
export function suiteInterne(suite: string | null | undefined): string | null {
  if (!suite) return null;
  if (!suite.startsWith("/") || suite.startsWith("//") || suite.includes("://")) return null;
  return suite;
}
