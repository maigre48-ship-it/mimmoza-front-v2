// src/services/massing/pluMassingAdapter.ts
// ─────────────────────────────────────────────────────────────────────────────
// PLU ADAPTER
// Convertit les règles du PLU Engine (ResolvedPluRulesetV1) en contraintes
// volumétriques exploitables par le Massing Engine.
//
// Ne recalcule RIEN du PLU : lecture seule + dérivation géométrique.
// Tout champ absent reste `null` (jamais inventé) et alimente `warnings`.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  MassingConfig,
  MassingConstraints,
  PluRulesetInput,
} from "./massing.types";

/**
 * Nombre de niveaux constructibles dérivé d'une hauteur PLU max.
 * RDC compté à `groundFloorHeightM`, étages suivants à `typicalFloorHeightM`.
 */
export function levelsFromHeight(
  hauteurMaxM: number | null,
  groundFloorHeightM: number,
  typicalFloorHeightM: number,
): number | null {
  if (hauteurMaxM == null || hauteurMaxM <= 0) return null;
  if (typicalFloorHeightM <= 0) return null;
  if (hauteurMaxM < groundFloorHeightM) {
    // Pas assez pour un RDC plein ; 1 niveau seulement si gabarit minimal habitable.
    return hauteurMaxM >= 2.4 ? 1 : 0;
  }
  return 1 + Math.floor((hauteurMaxM - groundFloorHeightM) / typicalFloorHeightM);
}

function reculValue(rule: { min_m: number | null } | null | undefined): number | null {
  if (!rule) return null;
  return rule.min_m ?? null;
}

export function pluToMassingConstraints(
  plu: PluRulesetInput | null,
  surfaceM2: number,
  config: MassingConfig,
): MassingConstraints {
  const warnings: string[] = [];

  const cesMax = plu?.ces?.max_ratio ?? null;
  const hauteurMaxM = plu?.hauteur?.max_m ?? null;

  const stationnementParLogement = plu?.stationnement?.par_logement ?? null;
  const stationnementPar100m2 = plu?.stationnement?.par_100m2 ?? null;

  const reculVoirieM = reculValue(plu?.reculs?.voirie);
  const reculLimitesM = reculValue(plu?.reculs?.limites_separatives);
  const reculFondM = reculValue(plu?.reculs?.fond_parcelle);
  const implantationLimiteAutorisee =
    plu?.reculs?.implantation_en_limite?.autorisee ?? null;

  const espacesVertsMinRatio = plu?.espaces_verts?.min_ratio ?? null;

  // ── Dérivés ────────────────────────────────────────────────────────────────
  const footprintMaxM2 =
    cesMax != null && surfaceM2 > 0 ? round2(surfaceM2 * cesMax) : null;

  const niveauxMax = levelsFromHeight(
    hauteurMaxM,
    config.groundFloorHeightM,
    config.typicalFloorHeightM,
  );

  // ── Diagnostics / warnings ───────────────────────────────────────────────────
  if (!plu) warnings.push("Aucune règle PLU fournie — capacité non calculable.");
  if (cesMax == null) warnings.push("CES (emprise au sol max) absent du PLU.");
  if (hauteurMaxM == null) warnings.push("Hauteur max absente du PLU.");
  if (stationnementParLogement == null && stationnementPar100m2 == null) {
    warnings.push("Règle de stationnement absente — besoin parking non quantifié.");
  }
  if (espacesVertsMinRatio == null) {
    warnings.push("Ratio d'espaces verts non porté par le ruleset (à vérifier au règlement).");
  }

  const completenessBase = plu?.completeness ?? {
    ok: cesMax != null && hauteurMaxM != null,
    missing: [],
  };
  const missing = [...(completenessBase.missing ?? [])];
  if (cesMax == null && !missing.includes("ces")) missing.push("ces");
  if (hauteurMaxM == null && !missing.includes("hauteur")) missing.push("hauteur");

  return {
    cesMax,
    hauteurMaxM,
    stationnementParLogement,
    stationnementPar100m2,
    reculVoirieM,
    reculLimitesM,
    reculFondM,
    implantationLimiteAutorisee,
    espacesVertsMinRatio,
    footprintMaxM2,
    niveauxMax,
    completeness: {
      ok: cesMax != null && hauteurMaxM != null,
      missing,
    },
    warnings,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}