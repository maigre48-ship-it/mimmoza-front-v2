// src/lib/api/apiCompte.ts
// =============================================================================
// Solde API du COMPTE de l'utilisateur connecté — RPC public.api_mon_compte().
//
// Le quota est porté par le compte (et non par la clé). La RPC renvoie :
//   plan, credits_mois, credits_utilises, credits_recharge, recharge_expire_le,
//   essai_expire_le, periode_debut, rate_limit_min, max_cles, cles_actives.
//
// Si la RPC n'est pas encore en base (déploiement en cours), on renvoie
// `indisponible: true` : l'écran affiche un repli sans planter.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { formuleApi, normaliserFormuleApi, type ApiFormuleId } from "./catalogueApi";

export interface ApiCompte {
  plan: ApiFormuleId;
  creditsMois: number;
  creditsUtilises: number;
  creditsRecharge: number;
  rechargeExpireLe: string | null;
  essaiExpireLe: string | null;
  periodeDebut: string | null;
  debitParMinute: number;
  clesMax: number;
  clesActives: number;
  /** Crédits du mois encore disponibles. */
  restantMois: number;
  /** Total utilisable maintenant : crédits du mois restants + recharge. */
  disponible: number;
  /** Essai dont la date de fin est passée. */
  essaiExpire: boolean;
}

function nombre(v: unknown, defaut: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : defaut;
}

function texte(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/** Transforme la réponse brute de la RPC en objet sûr (valeurs par défaut du catalogue). */
export function normaliserApiCompte(brut: unknown, maintenant: Date = new Date()): ApiCompte | null {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return null;
  const r = brut as Record<string, unknown>;
  const plan = normaliserFormuleApi(r.plan);
  const f = formuleApi(plan);
  const creditsMois = Math.max(0, nombre(r.credits_mois, f.credits));
  const creditsUtilises = Math.max(0, nombre(r.credits_utilises, 0));
  const creditsRecharge = Math.max(0, nombre(r.credits_recharge, 0));
  const essaiExpireLe = texte(r.essai_expire_le);
  const essaiExpire =
    plan === "essai" && essaiExpireLe != null && new Date(essaiExpireLe).getTime() < maintenant.getTime();
  const restantMois = essaiExpire ? 0 : Math.max(0, creditsMois - creditsUtilises);
  return {
    plan,
    creditsMois,
    creditsUtilises,
    creditsRecharge,
    rechargeExpireLe: texte(r.recharge_expire_le),
    essaiExpireLe,
    periodeDebut: texte(r.periode_debut),
    debitParMinute: nombre(r.rate_limit_min, f.debitParMinute),
    clesMax: nombre(r.max_cles, f.clesMax),
    clesActives: Math.max(0, nombre(r.cles_actives, 0)),
    restantMois,
    disponible: restantMois + creditsRecharge,
    essaiExpire,
  };
}

export interface ChargementApiCompte {
  compte: ApiCompte | null;
  /** Vrai si la RPC n'a pas pu être appelée (absente, réseau, session). */
  indisponible: boolean;
}

/** Appelle la RPC api_mon_compte(). Ne lève jamais d'exception. */
export async function chargerApiCompte(): Promise<ChargementApiCompte> {
  try {
    const { data, error } = await supabase.rpc("api_mon_compte");
    if (error) {
      console.warn("[api_mon_compte] indisponible :", error.message);
      return { compte: null, indisponible: true };
    }
    const compte = normaliserApiCompte(data);
    return { compte, indisponible: compte == null };
  } catch (e) {
    console.warn("[api_mon_compte] indisponible :", e);
    return { compte: null, indisponible: true };
  }
}

/** Hook : solde API du compte, rechargeable. */
export function useApiCompte() {
  const [etat, setEtat] = useState<ChargementApiCompte>({ compte: null, indisponible: false });
  const [chargement, setChargement] = useState(true);

  const recharger = useCallback(async () => {
    setChargement(true);
    setEtat(await chargerApiCompte());
    setChargement(false);
  }, []);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  return { ...etat, chargement, recharger };
}
