import { useState, useCallback, useEffect } from "react";

import {
  computeBankSmartScore,
  buildRiskAnalysisPatch,
  detectScoreDrop,
  buildComitePayload,
  type SmartScoreInput,
  type SmartScoreResult,
} from "../shared/services/banqueSmartscore";

import {
  readBanqueSnapshot,
  patchSmartScore,
  patchRiskAnalysis,
  onBanqueSnapshotChange,
} from "../store/banqueSnapshot.store";

import { useBanqueDossierContext } from "./useBanqueDossierContext";

/* ================================================================
   §1 — useSmartScore (Analyse / Risque)
   ================================================================ */

export interface UseSmartScoreReturn {
  result: SmartScoreResult | null;
  isComputing: boolean;
  error: string | null;
  recalculate: (overrides?: Partial<SmartScoreInput>) => SmartScoreResult | null;
}

export function useSmartScore(): UseSmartScoreReturn {
  const { dossierId, dossier } = useBanqueDossierContext();
  const [result, setResult] = useState<SmartScoreResult | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const snap = readBanqueSnapshot();
    const existing = (snap as Record<string, unknown>).smartScore as SmartScoreResult | undefined;
    if (existing && typeof existing.score === "number") {
      setResult(existing);
    }
  }, [dossierId]);

  const recalculate = useCallback(
    (overrides?: Partial<SmartScoreInput>): SmartScoreResult | null => {
      if (!dossierId) {
        setError("Aucun dossier selectionne");
        return null;
      }

      setIsComputing(true);
      setError(null);

      try {
        const snap = readBanqueSnapshot();
        const input = mapSnapshotToInput(snap, dossier);
        const merged: SmartScoreInput = overrides ? deepMerge(input, overrides) : input;
        const scoreResult = computeBankSmartScore(merged);

        patchSmartScore(dossierId, scoreResult as unknown as Record<string, unknown>);
        patchRiskAnalysis(dossierId, buildRiskAnalysisPatch(scoreResult));

        setResult(scoreResult);
        return scoreResult;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erreur de calcul";
        setError(msg);
        console.error("[useSmartScore]", e);
        return null;
      } finally {
        setIsComputing(false);
      }
    },
    [dossierId, dossier]
  );

  return { result, isComputing, error, recalculate };
}

/* ================================================================
   §2 — useScoreMonitoring (Monitoring)
   ================================================================ */

export interface ScoreDropAlert {
  dossierId: string;
  label: string;
  previousScore: number;
  currentScore: number;
  drop: number;
}

export interface UseScoreMonitoringReturn {
  alerts: ScoreDropAlert[];
  threshold: number;
  setThreshold: (n: number) => void;
  scan: () => void;
}

export function useScoreMonitoring(initialThreshold = 10): UseScoreMonitoringReturn {
  const [threshold, setThreshold] = useState(initialThreshold);
  const [alerts, setAlerts] = useState<ScoreDropAlert[]>([]);

  const scan = useCallback(() => {
    const snap = readBanqueSnapshot() as Record<string, unknown>;
    const ss = snap.smartScore as SmartScoreResult | undefined;
    const newAlerts: ScoreDropAlert[] = [];

    if (ss && ss.scoreHistory) {
      const drop = detectScoreDrop(ss.scoreHistory, threshold);
      if (drop) {
        newAlerts.push({
          dossierId: (snap.activeDossierId as string) || "unknown",
          label: ((snap.dossier as Record<string, unknown>)?.label as string) || "Dossier",
          ...drop,
        });
      }
    }

    setAlerts(newAlerts);
  }, [threshold]);

  useEffect(() => { scan(); }, [scan]);
  useEffect(() => onBanqueSnapshotChange(() => scan()), [scan]);

  return { alerts, threshold, setThreshold, scan };
}

/* ================================================================
   §3 — useComitePayload (Decision)
   ================================================================ */

export function useComitePayload() {
  const { dossier } = useBanqueDossierContext();
  const [payload, setPayload] = useState<ReturnType<typeof buildComitePayload> | null>(null);

  const refresh = useCallback(() => {
    const snap = readBanqueSnapshot() as Record<string, unknown>;
    const ss = snap.smartScore as SmartScoreResult | undefined;
    if (ss && typeof ss.score === "number") {
      const label = (dossier as unknown as Record<string, unknown>)?.label as string || "Dossier";
      setPayload(buildComitePayload(ss, label));
    } else {
      setPayload(null);
    }
  }, [dossier]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => onBanqueSnapshotChange(() => refresh()), [refresh]);

  return { payload, refresh };
}

/* ================================================================
   §4 — Mapper Snapshot -> SmartScoreInput
   ================================================================ */

function mapSnapshotToInput(
  snap: Record<string, unknown>,
  dossier: Record<string, unknown> | null,
): SmartScoreInput {
  const d = (dossier || {}) as Record<string, unknown>;
  const origination = (d.origination || {}) as Record<string, unknown>;
  const analyse = (d.analyse || {}) as Record<string, unknown>;
  const risk = (snap.riskAnalysis || {}) as Record<string, unknown>;
  const market = (snap.market || {}) as Record<string, unknown>;
  const docs = (snap.documents || {}) as Record<string, unknown>;
  const guarantees = (snap.guarantees || {}) as Record<string, unknown>;
  const existingSS = snap.smartScore as SmartScoreResult | undefined;

  const obtainedOrItems = guarantees.obtained || guarantees.items;
  const docListOrItems = docs.list || docs.items;

  return {
    origination: {
      montantDemande: origination.montantDemande as number | undefined,
      dureeEnMois: origination.dureeEnMois as number | undefined,
      typeProjet: origination.typeProjet as string | undefined,
      commune: origination.commune as string | undefined,
      surfaceTerrain: origination.surfaceTerrain as number | undefined,
      surfaceSDP: origination.surfaceSDP as number | undefined,
    },

    market: {
      tensionMarche: market.tensionMarche as string | undefined,
      tauxVacance: market.tauxVacance as number | undefined,
      evolutionPrix12m: market.evolutionPrix12m as number | undefined,
      delaiVenteMoyen: market.delaiVenteMoyen as number | undefined,
      prixM2Median: market.prixM2Median as number | undefined,
      verdict: market.verdict as string | undefined,
    },

    risks: {
      globalLevel: risk.globalLevel as string | undefined,
      presentCount: risk.presentCount as number | undefined,
      unknownCount: risk.unknownCount as number | undefined,
      absentCount: risk.absentCount as number | undefined,
      totalCategories: risk.totalCategories as number | undefined,
      blockers: risk.blockers as string[] | undefined,
    },

    finance: {
      scoreCreditGlobal: analyse.scoreCreditGlobal as number | undefined,
      ratioLTV: analyse.ratioLTV as number | undefined,
      ratioDSCR: analyse.ratioDSCR as number | undefined,
      tauxEndettement: analyse.tauxEndettement as number | undefined,
      fondsPropresPct: analyse.fondsPropresPct as number | undefined,
      triProjet: analyse.triProjet as number | undefined,
      chiffreAffairesPrev: analyse.chiffreAffairesPrev as number | undefined,
      margeBrutePrev: analyse.margeBrutePrev as number | undefined,
      garanties: Array.isArray(obtainedOrItems)
        ? (obtainedOrItems as Array<Record<string, unknown>>).map(function(g) {
            return {
              type: (g.type as string) || "autre",
              couverturePct: g.couverturePct as number | undefined,
              montant: (g.valeurEstimee || g.montant) as number | undefined,
            };
          })
        : undefined,
    },

    completeness: {
      documentsPresents: Array.isArray(docListOrItems)
        ? (docListOrItems as Array<Record<string, unknown>>)
            .filter(function(dd) { return dd.statut === "recu" || dd.statut === "valide"; })
            .map(function(dd) { return dd.type as string; })
        : [],
      documentsManquants: docs.missing as string[] | undefined,
      totalDocumentsRequis: Array.isArray(docs.required) ? (docs.required as string[]).length : undefined,
    },

    previousScoreHistory: existingSS ? existingSS.scoreHistory : undefined,
  };
}

/* ================================================================
   §5 — Utils
   ================================================================ */

function deepMerge<T extends Record<string, unknown>>(a: T, b: Partial<T>): T {
  const out = { ...a } as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    const bv = (b as Record<string, unknown>)[key];
    const av = out[key];
    if (av && bv && typeof av === "object" && typeof bv === "object" && !Array.isArray(bv)) {
      out[key] = deepMerge(av as Record<string, unknown>, bv as Record<string, unknown>);
    } else if (bv !== undefined) {
      out[key] = bv;
    }
  }
  return out as T;
}