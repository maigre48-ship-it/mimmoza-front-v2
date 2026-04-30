/**
 * promoteurMarketStudyBridge.ts
 * ─────────────────────────────────────────────────────────────────────
 * Deep merge récursif : données investisseur (prioritaire) + promoteur (fallback).
 *
 * Règles :
 * - Priorité absolue aux données investisseur quand elles existent
 * - Fallback sur promoteur quand investisseur est incomplet
 * - Tableaux : garder investisseur si non vide, sinon promoteur
 * - Pas de logique complexe, pas de transformation de données
 * - Ne touche PAS au module promoteur
 *
 * Préfixe logs : [InvestisseurBridge]
 * ─────────────────────────────────────────────────────────────────────
 */

import type { PromoteurSnapshotEnvelope } from "./readPromoteurMarketSnapshot";

// ─── Type helpers ────────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>;

function isPlainObject(val: unknown): val is AnyRecord {
  return (
    val !== null &&
    typeof val === "object" &&
    !Array.isArray(val) &&
    !(val instanceof Date) &&
    !(val instanceof RegExp)
  );
}

function isNonEmptyArray(val: unknown): val is unknown[] {
  return Array.isArray(val) && val.length > 0;
}

/**
 * Vérifie qu'une valeur est "remplie" (non null, non undefined,
 * non chaîne vide, non NaN).
 */
function isFilled(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === "string" && val.trim() === "") return false;
  if (typeof val === "number" && Number.isNaN(val)) return false;
  return true;
}

// ─── Deep merge récursif ─────────────────────────────────────────────

/**
 * Fusionne récursivement `investor` (prioritaire) avec `promoteur` (fallback).
 *
 * Comportement par clé :
 * 1. Si `investor[key]` est rempli (valeur primitive non nulle) → on garde investor
 * 2. Si `investor[key]` est un objet ET `promoteur[key]` aussi → merge récursif
 * 3. Si `investor[key]` est un tableau non vide → on garde investor
 * 4. Si `investor[key]` est un tableau vide ET `promoteur[key]` est un tableau non vide → promoteur
 * 5. Si `investor[key]` est absent/null/undefined → fallback promoteur
 *
 * @param investor   Données investisseur (source primaire)
 * @param promoteur  Données promoteur (fallback)
 * @returns Objet fusionné, nouveau (pas de mutation)
 */
function deepMergeObjects(investor: AnyRecord, promoteur: AnyRecord): AnyRecord {
  const result: AnyRecord = {};

  // Collecter toutes les clés (union des deux objets)
  const allKeys = new Set<string>([
    ...Object.keys(investor),
    ...Object.keys(promoteur),
  ]);

  for (const key of allKeys) {
    const invVal = investor[key];
    const proVal = promoteur[key];

    // ── Cas 1 : clé uniquement dans investisseur ─────────────────
    if (!(key in promoteur)) {
      result[key] = invVal;
      continue;
    }

    // ── Cas 2 : clé uniquement dans promoteur ────────────────────
    if (!(key in investor)) {
      result[key] = proVal;
      continue;
    }

    // ── Cas 3 : les deux sont des objets → merge récursif ────────
    if (isPlainObject(invVal) && isPlainObject(proVal)) {
      result[key] = deepMergeObjects(invVal, proVal);
      continue;
    }

    // ── Cas 4 : tableaux ─────────────────────────────────────────
    if (Array.isArray(invVal)) {
      // Investisseur non vide → on garde investisseur
      if (isNonEmptyArray(invVal)) {
        result[key] = invVal;
        continue;
      }
      // Investisseur vide, promoteur non vide → fallback promoteur
      if (isNonEmptyArray(proVal)) {
        result[key] = proVal;
        continue;
      }
      // Les deux vides → garder investisseur (tableau vide)
      result[key] = invVal;
      continue;
    }

    // ── Cas 5 : valeur primitive ─────────────────────────────────
    // Investisseur rempli → on garde investisseur
    if (isFilled(invVal)) {
      result[key] = invVal;
      continue;
    }

    // Investisseur non rempli → fallback promoteur
    if (isFilled(proVal)) {
      result[key] = proVal;
      continue;
    }

    // Aucun des deux rempli → garder investisseur (null/undefined)
    result[key] = invVal;
  }

  return result;
}

// ─── Extracteur de données marché depuis l'envelope promoteur ────────

/**
 * Extrait les données marché exploitables depuis le snapshot promoteur.
 * Le snapshot promoteur est un Record plat — les données marché peuvent
 * être sous différentes clés selon le flux qui les a écrites.
 */
function extractMarketDataFromEnvelope(
  envelope: PromoteurSnapshotEnvelope | null,
): AnyRecord | null {
  if (!envelope) return null;

  // Chercher dans les clés connues
  const market =
    envelope.marketStudy ??
    envelope.marcheRisques ??
    envelope.marche ??
    envelope.data ??
    null;

  if (market && isPlainObject(market)) {
    return market as AnyRecord;
  }

  // Fallback : le snapshot contient peut-être les champs directement
  // (dvf, insee, bpe, scores, core…)
  const directKeys = ["dvf", "insee", "bpe", "transport", "finess",
    "risques", "concurrence", "scores", "core", "scoreGlobal"];
  const hasDirect = directKeys.some((k) => isFilled((envelope as AnyRecord)[k]));

  if (hasDirect) {
    // Retourner l'envelope elle-même (sans clés non-marché comme projectInfo)
    const filtered: AnyRecord = {};
    for (const [k, v] of Object.entries(envelope)) {
      // Exclure les clés purement promoteur/admin
      if (k === "projectInfo" || k === "bilan" || k === "synthese" ||
          k === "implantation" || k === "foncier" || k === "plu") {
        continue;
      }
      if (isFilled(v)) {
        filtered[k] = v;
      }
    }
    return Object.keys(filtered).length > 0 ? filtered : null;
  }

  return null;
}

// ─── Fonction publique principale ────────────────────────────────────

/**
 * Fusionne les données investisseur (prioritaire) avec le snapshot promoteur (fallback).
 *
 * @param investorStudyData      Données marcheRisques investisseur (depuis marchandSnapshot)
 * @param promoteurSnapshot      Snapshot promoteur complet (depuis readPromoteurMarketSnapshot)
 * @returns Objet fusionné, ou investorStudyData seul si pas de promoteur, ou null si rien.
 */
export function deepMergeInvestorWithPromoteur(
  investorStudyData: AnyRecord | null,
  promoteurSnapshot: PromoteurSnapshotEnvelope | null,
): AnyRecord | null {
  const promoteurMarket = extractMarketDataFromEnvelope(promoteurSnapshot);

  // ── Pas de promoteur → retourner investisseur tel quel ─────────
  if (!promoteurMarket) {
    if (investorStudyData) {
      console.debug(
        "[InvestisseurBridge] deepMerge — pas de données promoteur, investisseur seul",
      );
    }
    return investorStudyData;
  }

  // ── Pas d'investisseur → retourner promoteur comme fallback ────
  if (!investorStudyData) {
    console.debug(
      "[InvestisseurBridge] deepMerge — pas de données investisseur, fallback promoteur complet",
      { promoteurKeys: Object.keys(promoteurMarket) },
    );
    return promoteurMarket;
  }

  // ── Les deux existent → merge récursif ─────────────────────────
  const merged = deepMergeObjects(investorStudyData, promoteurMarket);

  console.debug(
    "[InvestisseurBridge] deepMerge — fusion investisseur ← promoteur",
    {
      investorKeys: Object.keys(investorStudyData),
      promoteurKeys: Object.keys(promoteurMarket),
      mergedKeys: Object.keys(merged),
    },
  );

  return merged;
}