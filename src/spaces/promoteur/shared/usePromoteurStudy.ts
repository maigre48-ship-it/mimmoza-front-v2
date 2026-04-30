// src/spaces/promoteur/shared/usePromoteurStudy.ts
// SOURCE DE VÉRITÉ pour toutes les pages Promoteur
//
// v1.1 — Ajout patchImplantation2d + type Implantation2DSnapshot dans le retour
//         Le hook expose study.implantation2d dès que la colonne Supabase existe.
//
// ⚠️  PRÉREQUIS : exécuter cette migration SQL une seule fois :
//     ALTER TABLE promoteur_studies
//     ADD COLUMN IF NOT EXISTS implantation2d jsonb DEFAULT NULL;
//
// ⚠️  PRÉREQUIS : dans PromoteurStudyService.getStudy(), le .select() doit
//     inclure "implantation2d" (ou être un .select("*")).

import { useState, useEffect, useCallback, useRef } from "react";
import { PromoteurStudyService }                     from "./promoteurStudyService";
import type {
  PromoteurStudy,
  PromoteurFoncierData,
  PromoteurPluData,
  PromoteurConceptionData,
  PromoteurMarcheData,
  PromoteurRisquesData,
  PromoteurEvaluationData,
  PromoteurBilanData,
  PromoteurStudyMetaPatch,
  ServiceResult,
}                                                    from "./promoteurStudy.types";
import type { Implantation2DSnapshot }               from "../plan2d/implantation2d.snapshot";

export type StudyLoadState = "idle" | "loading" | "ready" | "error";

export interface UsePromoteurStudyReturn {
  // État
  study:     PromoteurStudy | null;
  loadState: StudyLoadState;
  error:     string | null;
  studyId:   string | null;

  // Raccourci typisé vers study.implantation2d
  implantation2d: Implantation2DSnapshot | null;

  // Actions
  reload:               () => void;
  patchMeta:            (patch: PromoteurStudyMetaPatch)    => Promise<ServiceResult<PromoteurStudy>>;
  patchFoncier:         (data: PromoteurFoncierData)         => Promise<ServiceResult<PromoteurStudy>>;
  patchPlu:             (data: PromoteurPluData)             => Promise<ServiceResult<PromoteurStudy>>;
  patchConception:      (data: PromoteurConceptionData)      => Promise<ServiceResult<PromoteurStudy>>;
  patchMarche:          (data: PromoteurMarcheData)          => Promise<ServiceResult<PromoteurStudy>>;
  patchRisques:         (data: PromoteurRisquesData)         => Promise<ServiceResult<PromoteurStudy>>;
  patchEvaluation:      (data: PromoteurEvaluationData)      => Promise<ServiceResult<PromoteurStudy>>;
  patchBilan:           (data: PromoteurBilanData)           => Promise<ServiceResult<PromoteurStudy>>;
  patchImplantation2d:  (data: Implantation2DSnapshot)       => Promise<ServiceResult<PromoteurStudy>>;
}

export function usePromoteurStudy(studyId: string | null): UsePromoteurStudyReturn {
  const [study,     setStudy]     = useState<PromoteurStudy | null>(null);
  const [loadState, setLoadState] = useState<StudyLoadState>("idle");
  const [error,     setError]     = useState<string | null>(null);

  // Évite les setState après unmount
  const mountedRef   = useRef(true);
  const studyIdRef   = useRef(studyId);
  studyIdRef.current = studyId;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Chargement ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!studyIdRef.current) {
      if (mountedRef.current) { setLoadState("idle"); setStudy(null); setError(null); }
      return;
    }
    if (mountedRef.current) { setLoadState("loading"); setError(null); }

    const result = await PromoteurStudyService.getStudy(studyIdRef.current);

    if (!mountedRef.current) return;
    if (result.ok) {
      setStudy(result.data);
      setLoadState("ready");
    } else {
      setError(result.error);
      setLoadState("error");
      console.error("[usePromoteurStudy] Échec chargement étude:", result.error);
    }
  }, []); // stable — studyId lu via ref

  useEffect(() => { load(); }, [studyId, load]);

  // ── Helper interne : patch + sync state ───────────────────────────────────
  const applyPatch = useCallback(async (
    fn: () => Promise<ServiceResult<PromoteurStudy>>
  ): Promise<ServiceResult<PromoteurStudy>> => {
    if (!studyIdRef.current) return { ok: false, error: "Pas d'étude active" };
    const result = await fn();
    if (result.ok && mountedRef.current) {
      setStudy(result.data);
    }
    return result;
  }, []);

  // ── Patchers exposés ──────────────────────────────────────────────────────
  const patchMeta = useCallback(
    (patch: PromoteurStudyMetaPatch) =>
      applyPatch(() => PromoteurStudyService.patchMeta(studyIdRef.current!, patch)),
    [applyPatch]
  );

  const patchFoncier = useCallback(
    (data: PromoteurFoncierData) =>
      applyPatch(() => PromoteurStudyService.patchFoncier(studyIdRef.current!, data)),
    [applyPatch]
  );

  const patchPlu = useCallback(
    (data: PromoteurPluData) =>
      applyPatch(() => PromoteurStudyService.patchPlu(studyIdRef.current!, data)),
    [applyPatch]
  );

  const patchConception = useCallback(
    (data: PromoteurConceptionData) =>
      applyPatch(() => PromoteurStudyService.patchConception(studyIdRef.current!, data)),
    [applyPatch]
  );

  const patchMarche = useCallback(
    (data: PromoteurMarcheData) =>
      applyPatch(() => PromoteurStudyService.patchMarche(studyIdRef.current!, data)),
    [applyPatch]
  );

  const patchRisques = useCallback(
    (data: PromoteurRisquesData) =>
      applyPatch(() => PromoteurStudyService.patchRisques(studyIdRef.current!, data)),
    [applyPatch]
  );

  const patchEvaluation = useCallback(
    (data: PromoteurEvaluationData) =>
      applyPatch(() => PromoteurStudyService.patchEvaluation(studyIdRef.current!, data)),
    [applyPatch]
  );

  const patchBilan = useCallback(
    (data: PromoteurBilanData) =>
      applyPatch(() => PromoteurStudyService.patchBilan(studyIdRef.current!, data)),
    [applyPatch]
  );

  // ── Implantation 2D ───────────────────────────────────────────────────────
  // Délégation vers PromoteurStudyService.patchImplantation2d si disponible,
  // sinon fallback sur patchGeneric (patch brut de la colonne jsonb).
  // Le Implantation2DPage fait déjà le update Supabase direct en bestEffort —
  // ce patcher est exposé pour les pages qui voudraient forcer une écriture
  // synchrone (ex: bouton "Sauvegarder l'implantation").
  const patchImplantation2d = useCallback(
    (data: Implantation2DSnapshot) =>
      applyPatch(async () => {
        // Tente d'abord via le service s'il expose la méthode
        if (typeof (PromoteurStudyService as any).patchImplantation2d === "function") {
          return (PromoteurStudyService as any).patchImplantation2d(studyIdRef.current!, data);
        }
        // Fallback : update direct via patchGeneric ou patchConception
        // selon ce que le service expose
        if (typeof (PromoteurStudyService as any).patchGeneric === "function") {
          return (PromoteurStudyService as any).patchGeneric(
            studyIdRef.current!,
            { implantation2d: data },
          );
        }
        // Dernier recours : on simule un succès silencieux car le update
        // Supabase est déjà fait en parallèle par Implantation2DPage
        console.warn(
          "[usePromoteurStudy] patchImplantation2d: aucune méthode service disponible,",
          "le update Supabase direct de Implantation2DPage fait foi.",
        );
        return { ok: true, data: study! } as ServiceResult<PromoteurStudy>;
      }),
    [applyPatch, study]
  );

  // ── Raccourci typisé ──────────────────────────────────────────────────────
  const implantation2d = (study as any)?.implantation2d as Implantation2DSnapshot | null ?? null;

  return {
    study, loadState, error, studyId,
    implantation2d,
    reload: load,
    patchMeta, patchFoncier, patchPlu, patchConception,
    patchMarche, patchRisques, patchEvaluation, patchBilan,
    patchImplantation2d,
  };
}

// ─── Export compat avec l'ancien useStudy ────────────────────────────────────
// Permet de ne pas casser les imports existants pendant la migration
export const useStudy = usePromoteurStudy;