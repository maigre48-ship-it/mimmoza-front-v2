// supabase/functions/_shared/apiFacturation.ts
// ─────────────────────────────────────────────────────────────────────────────
// Facturation de l'API publique : réservation AVANT l'appel, remboursement si
// l'appel échoue. Interface des RPC : docs/api/CONTRAT_API.md (fait foi).
//
//   api_reserver_credits(p_key_id uuid, p_endpoint text, p_cout integer) → jsonb
//     {"ok":true,"source_mois":n,"source_recharge":m,"restant":r,"limite":l,"plan":"…"}
//     {"ok":false,"raison":"cle_invalide"|"essai_expire"|"debit_depasse"|"credits_epuises",
//      "restant":r,"limite":l,"reessayer_dans":s?}
//   api_rembourser_credits(p_key_id uuid, p_source_mois integer, p_source_recharge integer) → void
//   increment_api_usage(p_key_id, p_endpoint, p_is_error, p_latency, p_cost) — journal, p_cost = 0
//
// Principe : JAMAIS d'appel interne sans réservation confirmée. Si la RPC de
// réservation est injoignable, la requête est refusée (503), pas servie.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClientBase } from "./apiBase.ts";

export interface ReservationAcceptee {
  ok: true;
  source_mois: number;
  source_recharge: number;
  restant: number | null;
  limite: number | null;
  plan: string | null;
}

export type RaisonRefus = "cle_invalide" | "essai_expire" | "debit_depasse" | "credits_epuises" | "inconnue";

export interface ReservationRefusee {
  ok: false;
  raison: RaisonRefus;
  restant: number | null;
  limite: number | null;
  reessayer_dans: number | null;
}

function entierPositif(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
}
function nombreOuNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Interprète le jsonb renvoyé par api_reserver_credits. null = réponse illisible. */
export function interpreterReservation(brut: unknown): ReservationAcceptee | ReservationRefusee | null {
  // PostgREST renvoie le jsonb tel quel ; certaines versions l'enveloppent dans un tableau.
  const v = Array.isArray(brut) ? brut[0] : brut;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.ok === true) {
    return {
      ok: true,
      source_mois: entierPositif(o.source_mois),
      source_recharge: entierPositif(o.source_recharge),
      restant: nombreOuNull(o.restant),
      limite: nombreOuNull(o.limite),
      plan: typeof o.plan === "string" ? o.plan : null,
    };
  }
  if (o.ok === false) {
    const r = String(o.raison ?? "");
    const raison: RaisonRefus = (["cle_invalide", "essai_expire", "debit_depasse", "credits_epuises"] as const)
      .includes(r as never)
      ? r as RaisonRefus
      : "inconnue";
    return { ok: false, raison, restant: nombreOuNull(o.restant), limite: nombreOuNull(o.limite), reessayer_dans: nombreOuNull(o.reessayer_dans) };
  }
  return null;
}

export interface ReponseRefus {
  status: number;
  code: string;
  message: string;
  entetes: Record<string, string>;
}

/** Traduction d'un refus de réservation en réponse HTTP (codes du contrat). */
export function reponsePourRefus(r: ReservationRefusee): ReponseRefus {
  const entetes: Record<string, string> = {};
  if (r.restant !== null) entetes["X-Credits-Restants"] = String(Math.max(0, Math.trunc(r.restant)));
  switch (r.raison) {
    case "cle_invalide":
      return { status: 401, code: "cle_invalide", message: "Clé API invalide ou révoquée.", entetes };
    case "essai_expire":
      return { status: 403, code: "essai_expire", message: "La période d'essai de ce compte est terminée. Choisissez une formule pour continuer.", entetes };
    case "debit_depasse": {
      const s = Math.max(1, Math.ceil(r.reessayer_dans ?? 60));
      return { status: 429, code: "debit_depasse", message: `Trop de requêtes par minute pour votre formule. Réessayez dans ${s} s.`, entetes: { ...entetes, "Retry-After": String(s) } };
    }
    case "credits_epuises":
      return { status: 402, code: "credits_epuises", message: "Crédits épuisés pour ce compte. Rechargez des crédits ou changez de formule.", entetes };
    default:
      return { status: 403, code: "acces_refuse", message: "Accès refusé.", entetes };
  }
}

export async function reserverCredits(base: ClientBase, keyId: string, endpoint: string, cout: number) {
  const { data, error } = await base.rpc("api_reserver_credits", { p_key_id: keyId, p_endpoint: endpoint, p_cout: cout });
  if (error) return { etat: "indisponible" as const };
  const r = interpreterReservation(data);
  if (!r) return { etat: "indisponible" as const };
  return { etat: "repondu" as const, reservation: r };
}

/** Rend exactement ce qui a été débité. Une nouvelle tentative en cas d'échec réseau. */
export async function rembourserCredits(base: ClientBase, keyId: string, r: ReservationAcceptee): Promise<boolean> {
  if (r.source_mois === 0 && r.source_recharge === 0) return true;
  const args = { p_key_id: keyId, p_source_mois: r.source_mois, p_source_recharge: r.source_recharge };
  for (let essai = 0; essai < 2; essai++) {
    const { error } = await base.rpc("api_rembourser_credits", args);
    if (!error) return true;
  }
  return false;
}

export async function journaliserUsage(base: ClientBase, keyId: string, endpoint: string, enErreur: boolean, latenceMs: number): Promise<void> {
  await base.rpc("increment_api_usage", {
    p_key_id: keyId,
    p_endpoint: endpoint,
    p_is_error: enErreur,
    p_latency: Math.max(0, Math.round(latenceMs)),
    p_cost: 0,
  }, 4000);
}
