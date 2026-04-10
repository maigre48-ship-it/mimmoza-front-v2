// src/spaces/investisseur/services/travauxCalculator.service.ts
// v2 — complexité corrigée : table réaliste + application unique sans double-comptage

import type {
  TravauxSimulationV1,
  ComputedTravaux,
  ComputedLot,
  ComputedLine,
  LotCode,
  PricingItemCode,
  QuantityUnit,
  Price3,
} from "../shared/travauxSimulation.types";
import { TRAVAUX_PRICING_V1 } from "./travauxPricing.config";

type PricingIndex = Map<PricingItemCode, { lot: { code: LotCode; label: string }; label: string; unit: QuantityUnit; prices: Price3 }>;

function buildPricingIndex(): PricingIndex {
  const idx: PricingIndex = new Map();
  for (const lot of TRAVAUX_PRICING_V1.lots) {
    for (const item of lot.items) {
      idx.set(item.code, {
        lot: { code: lot.code, label: lot.label },
        label: item.label,
        unit: item.unit,
        prices: item.prices,
      });
    }
  }
  return idx;
}

const PRICING_INDEX = buildPricingIndex();

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function safeNumber(n: unknown, fallback = 0): number {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : fallback;
}

/**
 * Coefficient de complexité chantier.
 *
 * Calibrage terrain (Île-de-France, immeubles anciens) :
 *   0 — Pavillon plain-pied, accès facile, pas de contrainte     → ×1.00
 *   1 — Appartement immeuble avec ascenseur, accès correct       → ×1.12
 *   2 — Appartement sans ascenseur ≤ 3e étage, copropriété std  → ×1.25
 *   3 — Immeuble haussmannien sans monte-charge, couloir étroit  → ×1.40
 *   4 — Combles, sous-sol, accès très restreint, contrainte maxi → ×1.55
 *
 * FIX v2 :
 *   - Ancienne table [1.0, 1.04, 1.08, 1.13, 1.18] était sous-évaluée
 *   - Le coef est maintenant appliqué UNE SEULE FOIS sur le total final
 *     (suppression du ×0.4 qui atténuait artificiellement)
 *   - Les lots internes (démolition, gravats) ne l'appliquent plus en interne
 *     pour éviter le double comptage
 */
export function computeComplexityCoef(complexity: number): number {
  const c = clamp(Math.round(safeNumber(complexity, 0)), 0, 4);
  const table = [1.00, 1.12, 1.25, 1.40, 1.55];
  return table[c] ?? 1.0;
}

export function computeDefaultBufferPct(sim: TravauxSimulationV1): number {
  let base = 0.10;
  if (sim.renovationLevel === "standard") base = 0.12;
  if (sim.renovationLevel === "heavy")    base = 0.15;
  if (sim.renovationLevel === "full")     base = 0.18;

  // Complexity ajoute 0..+5% au buffer
  const c = clamp(sim.complexity, 0, 4);
  const add = [0, 0.01, 0.02, 0.03, 0.05][c] ?? 0;

  const humid = sim.options?.humiditeTraitement === "yes" ? 0.02 : 0;
  return clamp(base + add + humid, 0.08, 0.25);
}

function getUnitPrice(prices: Price3, range: "eco" | "standard" | "premium"): number {
  return safeNumber(prices[range], 0);
}

function addLine(
  lotsMap: Map<LotCode, ComputedLot>,
  lotCode: LotCode,
  lotLabel: string,
  code: PricingItemCode,
  label: string,
  unit: QuantityUnit,
  qty: number,
  unitPrice: number,
  amount: number
) {
  const lot = lotsMap.get(lotCode) ?? { code: lotCode, label: lotLabel, amount: 0, lines: [] };
  const line: ComputedLine = { code, label, unit, qty, unitPrice, amount };
  lot.lines.push(line);
  lot.amount += amount;
  lotsMap.set(lotCode, lot);
}

function lineFromPricing(code: PricingItemCode, qty: number, range: "eco" | "standard" | "premium") {
  const meta = PRICING_INDEX.get(code);
  if (!meta) return null;
  const unitPrice = getUnitPrice(meta.prices, range);
  const amount = qty * unitPrice;
  return { meta, unitPrice, amount };
}

function triToFactor(v: "none" | "partial" | "full"): number {
  if (v === "none")    return 0;
  if (v === "partial") return 0.5;
  return 1;
}

/**
 * Calcul des lots en mode Simple.
 *
 * FIX v2 : suppression de tous les `* complexityCoef` internes.
 * Le coefficient est appliqué une seule fois sur le total dans
 * computeTravauxSimulation, sans atténuation ×0.4.
 */
function computeSimpleLots(sim: TravauxSimulationV1): ComputedLot[] {
  const surface        = clamp(safeNumber(sim.surfaceTotalM2, 0), 0, 10_000);
  const range          = sim.range;
  const wallArea       = surface * 2.6;
  const plinthML       = surface * 0.9;
  const doorsApprox    = Math.max(1, Math.round(surface / 25));
  const windowsApprox  = Math.max(1, Math.round(surface / 35));
  const spotsApprox    = Math.max(6, Math.round(surface / 6));

  const lotsMap = new Map<LotCode, ComputedLot>();

  // ── Préliminaires (toujours) ──────────────────────────────────────
  {
    const l1 = lineFromPricing("prelim_protection", 1, range);
    if (l1) addLine(lotsMap, l1.meta.lot.code, l1.meta.lot.label, "prelim_protection", l1.meta.label, l1.meta.unit, 1, l1.unitPrice, l1.amount);
    const l2 = lineFromPricing("prelim_nettoyage", 1, range);
    if (l2) addLine(lotsMap, l2.meta.lot.code, l2.meta.lot.label, "prelim_nettoyage", l2.meta.label, l2.meta.unit, 1, l2.unitPrice, l2.amount);
  }

  // ── Démolition ────────────────────────────────────────────────────
  const demolFactor = triToFactor(sim.options.demolition);
  if (demolFactor > 0) {
    if (demolFactor >= 1) {
      const l = lineFromPricing("demol_curage_complet", surface, range);
      // NOTE v2 : plus de * complexityCoef ici — appliqué globalement
      if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "demol_curage_complet", l.meta.label, l.meta.unit, surface, l.unitPrice, l.amount);
    } else {
      const qtySols = surface * demolFactor;
      const lS = lineFromPricing("demol_depose_sols", qtySols, range);
      if (lS) addLine(lotsMap, lS.meta.lot.code, lS.meta.lot.label, "demol_depose_sols", lS.meta.label, lS.meta.unit, qtySols, lS.unitPrice, lS.amount);

      const lFa = lineFromPricing("demol_depose_faience_sanitaires", demolFactor, range);
      if (lFa) addLine(lotsMap, lFa.meta.lot.code, lFa.meta.lot.label, "demol_depose_faience_sanitaires", lFa.meta.label, lFa.meta.unit, demolFactor, lFa.unitPrice, lFa.amount);

      if (sim.options.cuisineRefaire !== "none") {
        const lCu = lineFromPricing("demol_depose_cuisine", 1, range);
        if (lCu) addLine(lotsMap, lCu.meta.lot.code, lCu.meta.lot.label, "demol_depose_cuisine", lCu.meta.label, lCu.meta.unit, 1, lCu.unitPrice, lCu.amount);
      }
    }
  }

  // ── Gravats ───────────────────────────────────────────────────────
  const gravatsFactor = triToFactor(sim.options.gravats);
  if (gravatsFactor > 0) {
    const qty = surface * gravatsFactor;
    const lEv = lineFromPricing("gravats_evacuation", qty, range);
    if (lEv) addLine(lotsMap, lEv.meta.lot.code, lEv.meta.lot.label, "gravats_evacuation", lEv.meta.label, lEv.meta.unit, qty, lEv.unitPrice, lEv.amount);

    if (sim.renovationLevel === "heavy" || sim.renovationLevel === "full" || gravatsFactor >= 1) {
      const lBe = lineFromPricing("gravats_benne", 1, range);
      if (lBe) addLine(lotsMap, lBe.meta.lot.code, lBe.meta.lot.label, "gravats_benne", lBe.meta.label, lBe.meta.unit, 1, lBe.unitPrice, lBe.amount);
    }
  }

  // ── Maçonnerie / supports ─────────────────────────────────────────
  if (sim.renovationLevel !== "refresh") {
    const ragQty = surface * (sim.renovationLevel === "standard" ? 0.5 : 0.9);
    const lR = lineFromPricing("macon_ragreage", ragQty, range);
    if (lR) addLine(lotsMap, lR.meta.lot.code, lR.meta.lot.label, "macon_ragreage", lR.meta.label, lR.meta.unit, ragQty, lR.unitPrice, lR.amount);

    const lS = lineFromPricing("macon_reprises_supports", wallArea * 0.6, range);
    if (lS) addLine(lotsMap, lS.meta.lot.code, lS.meta.lot.label, "macon_reprises_supports", lS.meta.label, lS.meta.unit, wallArea * 0.6, lS.unitPrice, lS.amount);
  }

  // ── Isolation thermique ───────────────────────────────────────────
  const thFactor = triToFactor(sim.options.isolationThermique);
  if (thFactor > 0) {
    const lM = lineFromPricing("isol_th_murs", surface * 0.9 * thFactor, range);
    if (lM) addLine(lotsMap, lM.meta.lot.code, lM.meta.lot.label, "isol_th_murs", lM.meta.label, lM.meta.unit, surface * 0.9 * thFactor, lM.unitPrice, lM.amount);
    const lP = lineFromPricing("isol_th_plafond", surface * 0.6 * thFactor, range);
    if (lP) addLine(lotsMap, lP.meta.lot.code, lP.meta.lot.label, "isol_th_plafond", lP.meta.label, lP.meta.unit, surface * 0.6 * thFactor, lP.unitPrice, lP.amount);
    const lSo = lineFromPricing("isol_th_sol_sous_couche", surface * thFactor, range);
    if (lSo) addLine(lotsMap, lSo.meta.lot.code, lSo.meta.lot.label, "isol_th_sol_sous_couche", lSo.meta.label, lSo.meta.unit, surface * thFactor, lSo.unitPrice, lSo.amount);
  }

  // ── Isolation phonique ────────────────────────────────────────────
  const phFactor = triToFactor(sim.options.isolationPhonique);
  if (phFactor > 0) {
    const lM = lineFromPricing("isol_ph_murs_mitoyens", surface * 0.55 * phFactor, range);
    if (lM) addLine(lotsMap, lM.meta.lot.code, lM.meta.lot.label, "isol_ph_murs_mitoyens", lM.meta.label, lM.meta.unit, surface * 0.55 * phFactor, lM.unitPrice, lM.amount);
    const lP = lineFromPricing("isol_ph_plafond", surface * 0.35 * phFactor, range);
    if (lP) addLine(lotsMap, lP.meta.lot.code, lP.meta.lot.label, "isol_ph_plafond", lP.meta.label, lP.meta.unit, surface * 0.35 * phFactor, lP.unitPrice, lP.amount);
    const lSo = lineFromPricing("isol_ph_sous_couche", surface * phFactor, range);
    if (lSo) addLine(lotsMap, lSo.meta.lot.code, lSo.meta.lot.label, "isol_ph_sous_couche", lSo.meta.label, lSo.meta.unit, surface * phFactor, lSo.unitPrice, lSo.amount);
    if (sim.range !== "eco" && sim.renovationLevel !== "refresh") {
      const n = Math.max(0, Math.round(doorsApprox * 0.3 * phFactor));
      const lD = lineFromPricing("isol_ph_portes_isophoniques", n, range);
      if (lD) addLine(lotsMap, lD.meta.lot.code, lD.meta.lot.label, "isol_ph_portes_isophoniques", lD.meta.label, lD.meta.unit, n, lD.unitPrice, lD.amount);
    }
  }

  // ── Plomberie ─────────────────────────────────────────────────────
  const plombFactor = triToFactor(sim.options.plomberie);
  if (plombFactor > 0) {
    if (plombFactor >= 1) {
      const l = lineFromPricing("plomb_reseau_complet", surface, range);
      if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "plomb_reseau_complet", l.meta.label, l.meta.unit, surface, l.unitPrice, l.amount);
      const lt = lineFromPricing("elec_tableau", 1, range);
      if (lt) addLine(lotsMap, lt.meta.lot.code, lt.meta.lot.label, "elec_tableau", lt.meta.label, lt.meta.unit, 1, lt.unitPrice, lt.amount);
    } else {
      const l = lineFromPricing("plomb_reseau_partiel", 1, range);
      if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "plomb_reseau_partiel", l.meta.label, l.meta.unit, 1, l.unitPrice, l.amount * plombFactor);
    }
    const points = (sim.options.cuisineRefaire !== "none" ? 1 : 0) + (sim.options.sdbRefaire !== "none" ? 1 : 0);
    if (points > 0) {
      const l = lineFromPricing("plomb_deplacement_points_eau", points * plombFactor, range);
      if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "plomb_deplacement_points_eau", l.meta.label, l.meta.unit, points * plombFactor, l.unitPrice, l.amount);
    }
    if (sim.renovationLevel === "heavy" || sim.renovationLevel === "full") {
      const l = lineFromPricing("plomb_chauffe_eau", 1, range);
      if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "plomb_chauffe_eau", l.meta.label, l.meta.unit, 1, l.unitPrice, l.amount * 0.5);
    }
  }

  // ── Électricité ───────────────────────────────────────────────────
  const elecFactor = triToFactor(sim.options.electricite);
  if (elecFactor > 0) {
    if (elecFactor >= 1) {
      const l = lineFromPricing("elec_reseau_complet", surface, range);
      if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "elec_reseau_complet", l.meta.label, l.meta.unit, surface, l.unitPrice, l.amount);
      const lt = lineFromPricing("elec_tableau", 1, range);
      if (lt) addLine(lotsMap, lt.meta.lot.code, lt.meta.lot.label, "elec_tableau", lt.meta.label, lt.meta.unit, 1, lt.unitPrice, lt.amount);
    } else {
      const l = lineFromPricing("elec_mise_aux_normes_partielle", surface * elecFactor, range);
      if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "elec_mise_aux_normes_partielle", l.meta.label, l.meta.unit, surface * elecFactor, l.unitPrice, l.amount);
    }
    const ls = lineFromPricing("elec_spots", spotsApprox * (0.6 + 0.4 * elecFactor), range);
    if (ls) addLine(lotsMap, ls.meta.lot.code, ls.meta.lot.label, "elec_spots", ls.meta.label, ls.meta.unit, spotsApprox * (0.6 + 0.4 * elecFactor), ls.unitPrice, ls.amount);
    if (sim.range !== "eco" && sim.renovationLevel !== "refresh") {
      const n = Math.max(2, Math.round(surface / 20));
      const lr = lineFromPricing("elec_rj45", n, range);
      if (lr) addLine(lotsMap, lr.meta.lot.code, lr.meta.lot.label, "elec_rj45", lr.meta.label, lr.meta.unit, n, lr.unitPrice, lr.amount);
    }
  }

  // ── Ventilation / Chauffage ───────────────────────────────────────
  if (sim.options.sdbRefaire !== "none" || sim.renovationLevel === "heavy" || sim.renovationLevel === "full") {
    const l = lineFromPricing("vent_vmc", 1, range);
    if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "vent_vmc", l.meta.label, l.meta.unit, 1, l.unitPrice, l.amount);
  }
  if (sim.renovationLevel !== "refresh") {
    const rad = Math.max(2, Math.round(surface / 20));
    const l = lineFromPricing("chauff_radiateurs", rad, range);
    if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "chauff_radiateurs", l.meta.label, l.meta.unit, rad, l.unitPrice, l.amount);
  }
  if (sim.options.sdbRefaire !== "none") {
    const l = lineFromPricing("chauff_seche_serviette", 1, range);
    if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "chauff_seche_serviette", l.meta.label, l.meta.unit, 1, l.unitPrice, l.amount);
  }

  // ── Menuiseries ───────────────────────────────────────────────────
  const menFactor = triToFactor(sim.options.menuiseries);
  if (menFactor > 0) {
    const lD = lineFromPricing("menuis_portes_int", doorsApprox * menFactor, range);
    if (lD) addLine(lotsMap, lD.meta.lot.code, lD.meta.lot.label, "menuis_portes_int", lD.meta.label, lD.meta.unit, doorsApprox * menFactor, lD.unitPrice, lD.amount);
    const lW = lineFromPricing("menuis_fenetres", windowsApprox * menFactor, range);
    if (lW) addLine(lotsMap, lW.meta.lot.code, lW.meta.lot.label, "menuis_fenetres", lW.meta.label, lW.meta.unit, windowsApprox * menFactor, lW.unitPrice, lW.amount);
  }

  // ── Sols ──────────────────────────────────────────────────────────
  if (sim.renovationLevel !== "refresh") {
    const lP = lineFromPricing("sol_parquet", surface, range);
    if (lP) addLine(lotsMap, lP.meta.lot.code, lP.meta.lot.label, "sol_parquet", lP.meta.label, lP.meta.unit, surface, lP.unitPrice, lP.amount);
    const lPl = lineFromPricing("sol_plinthes", plinthML, range);
    if (lPl) addLine(lotsMap, lPl.meta.lot.code, lPl.meta.lot.label, "sol_plinthes", lPl.meta.label, lPl.meta.unit, plinthML, lPl.unitPrice, lPl.amount);
  }

  // ── Murs / Peinture ───────────────────────────────────────────────
  const paintFactor = sim.renovationLevel === "refresh" ? 0.6 : 1.0;
  const lPe = lineFromPricing("mur_peinture_simple", wallArea * paintFactor, range);
  if (lPe) addLine(lotsMap, lPe.meta.lot.code, lPe.meta.lot.label, "mur_peinture_simple", lPe.meta.label, lPe.meta.unit, wallArea * paintFactor, lPe.unitPrice, lPe.amount);

  if ((sim.renovationLevel === "heavy" || sim.renovationLevel === "full") && sim.range !== "eco") {
    const lRa = lineFromPricing("mur_ratissage_complet", wallArea * 0.7, range);
    if (lRa) addLine(lotsMap, lRa.meta.lot.code, lRa.meta.lot.label, "mur_ratissage_complet", lRa.meta.label, lRa.meta.unit, wallArea * 0.7, lRa.unitPrice, lRa.amount);
  }

  // ── Cuisine / SDB ─────────────────────────────────────────────────
  const cuisFactor = triToFactor(sim.options.cuisineRefaire);
  if (cuisFactor > 0) {
    const l = lineFromPricing("cuisine_pack", 1, range);
    if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "cuisine_pack", l.meta.label, l.meta.unit, 1, l.unitPrice, l.amount * cuisFactor);
    const lp = lineFromPricing("cuisine_pose", 1, range);
    if (lp) addLine(lotsMap, lp.meta.lot.code, lp.meta.lot.label, "cuisine_pose", lp.meta.label, lp.meta.unit, 1, lp.unitPrice, lp.amount * cuisFactor);
  }

  const sdbFactor = triToFactor(sim.options.sdbRefaire);
  if (sdbFactor > 0) {
    const l = lineFromPricing("sdb_pack", 1, range);
    if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "sdb_pack", l.meta.label, l.meta.unit, 1, l.unitPrice, l.amount * sdbFactor);
    const ls = lineFromPricing("sdb_spec_etancheite", 1, range);
    if (ls) addLine(lotsMap, ls.meta.lot.code, ls.meta.lot.label, "sdb_spec_etancheite", ls.meta.label, ls.meta.unit, 1, ls.unitPrice, ls.amount * sdbFactor);
  }

  // ── Humidité / Divers ─────────────────────────────────────────────
  if (sim.options.humiditeTraitement === "yes") {
    const l = lineFromPricing("divers_humidite", 1, range);
    if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "divers_humidite", l.meta.label, l.meta.unit, 1, l.unitPrice, l.amount);
  }
  {
    const l = lineFromPricing("divers_petites_reparations", 1, range);
    if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "divers_petites_reparations", l.meta.label, l.meta.unit, 1, l.unitPrice, l.amount * 0.6);
  }

  return Array.from(lotsMap.values());
}

function computeExpertLots(sim: TravauxSimulationV1): ComputedLot[] {
  const range = sim.range;
  const lotsMap = new Map<LotCode, ComputedLot>();

  {
    const l1 = lineFromPricing("prelim_protection", 1, range);
    if (l1) addLine(lotsMap, l1.meta.lot.code, l1.meta.lot.label, "prelim_protection", l1.meta.label, l1.meta.unit, 1, l1.unitPrice, l1.amount);
    const l2 = lineFromPricing("prelim_nettoyage", 1, range);
    if (l2) addLine(lotsMap, l2.meta.lot.code, l2.meta.lot.label, "prelim_nettoyage", l2.meta.label, l2.meta.unit, 1, l2.unitPrice, l2.amount);
  }

  for (const piece of sim.pieces ?? []) {
    for (const li of piece.items ?? []) {
      const qty = safeNumber(li.qty, 0);
      if (qty <= 0) continue;
      const m = PRICING_INDEX.get(li.itemCode);
      if (!m) continue;
      const unitPrice = getUnitPrice(m.prices, range);
      const amount = qty * unitPrice;
      addLine(lotsMap, m.lot.code, m.lot.label, li.itemCode, m.label, m.unit, qty, unitPrice, amount);
    }
  }

  if (sim.options?.humiditeTraitement === "yes") {
    const l = lineFromPricing("divers_humidite", 1, range);
    if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "divers_humidite", l.meta.label, l.meta.unit, 1, l.unitPrice, l.amount);
  }
  {
    const l = lineFromPricing("divers_petites_reparations", 1, range);
    if (l) addLine(lotsMap, l.meta.lot.code, l.meta.lot.label, "divers_petites_reparations", l.meta.label, l.meta.unit, 1, l.unitPrice, l.amount * 0.6);
  }

  return Array.from(lotsMap.values());
}

function computeSurfaceFromPieces(sim: TravauxSimulationV1): number {
  return clamp((sim.pieces ?? []).reduce((acc, p) => acc + safeNumber(p.surfaceM2, 0), 0), 0, 10_000);
}

export function computeTravauxSimulation(sim: TravauxSimulationV1): ComputedTravaux {
  const mode           = sim.mode ?? "simple";
  const surface        = mode === "expert" ? computeSurfaceFromPieces(sim) : clamp(safeNumber(sim.surfaceTotalM2, 0), 0, 10_000);
  const complexityCoef = computeComplexityCoef(sim.complexity);
  const bufferPct      = typeof sim.bufferPct === "number"
    ? clamp(sim.bufferPct, 0.05, 0.3)
    : computeDefaultBufferPct(sim);

  const lots     = mode === "expert" ? computeExpertLots(sim) : computeSimpleLots(sim);
  const baseTotal = lots.reduce((acc, l) => acc + safeNumber(l.amount, 0), 0);

  // ── Application du coefficient de complexité — UNE SEULE FOIS ────
  // v2 FIX : on applique le coef complet (pas ×0.4).
  // Les lots internes ne le multiplient plus eux-mêmes.
  let total = baseTotal * complexityCoef;

  // ── MOE en option ─────────────────────────────────────────────────
  if (sim.options?.moe === "yes") {
    const moePct = TRAVAUX_PRICING_V1.lots
      .find((l) => l.code === "honoraires")
      ?.items.find((i) => i.code === "honoraires_moe_pct")?.prices?.[sim.range];
    const pct = typeof moePct === "number" ? moePct : (sim.range === "eco" ? 0.07 : sim.range === "premium" ? 0.12 : 0.09);
    const moeAmount = total * pct;

    const meta = PRICING_INDEX.get("honoraires_moe_pct");
    if (meta) {
      const lotsMap = new Map<LotCode, ComputedLot>();
      for (const l of lots) lotsMap.set(l.code, l);
      addLine(lotsMap, meta.lot.code, meta.lot.label, "honoraires_moe_pct", meta.label, meta.unit, pct, total, moeAmount);
      const updatedLots = Array.from(lotsMap.values());
      total = updatedLots.reduce((acc, l) => acc + safeNumber(l.amount, 0), 0) * complexityCoef;
      return finalizeComputed(sim, mode, surface, total, bufferPct, complexityCoef, updatedLots);
    }
    total += moeAmount;
  }

  return finalizeComputed(sim, mode, surface, total, bufferPct, complexityCoef, lots);
}

function finalizeComputed(
  sim: TravauxSimulationV1,
  mode: "simple" | "expert",
  surface: number,
  total: number,
  bufferPct: number,
  complexityCoef: number,
  lots: ComputedLot[]
): ComputedTravaux {
  const bufferAmount    = total * bufferPct;
  const totalWithBuffer = total + bufferAmount;
  const costPerM2       = surface > 0 ? totalWithBuffer / surface : null;

  const order      = TRAVAUX_PRICING_V1.lots.map((l) => l.code);
  const lotsSorted = [...lots].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
  const r2         = (n: number) => Math.round(n * 100) / 100;

  return {
    mode,
    range: sim.range,
    surfaceTotalM2: surface,
    total: r2(total),
    bufferPct: r2(bufferPct),
    bufferAmount: r2(bufferAmount),
    totalWithBuffer: r2(totalWithBuffer),
    costPerM2: costPerM2 ? r2(costPerM2) : null,
    complexityCoef: r2(complexityCoef),
    lots: lotsSorted.map((l) => ({
      ...l,
      amount: r2(l.amount),
      lines: (l.lines ?? []).map((x) => ({ ...x, qty: r2(x.qty), unitPrice: r2(x.unitPrice), amount: r2(x.amount) })),
    })),
  };
}