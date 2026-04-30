// src/spaces/promoteur/shared/promoteurStudyService.ts
// VERSION 2.1.0
//
// Nouveautés v2.1.0 :
//   - patchImplantation2d : persist la colonne implantation2d (jsonb)
//
// ⚠️  MIGRATION SQL requise une seule fois :
//     ALTER TABLE promoteur_studies
//     ADD COLUMN IF NOT EXISTS implantation2d jsonb DEFAULT NULL;
//
// VERSION 2.0.1 — fix listStudies (syntaxe foncier->x non supportée par Supabase JS)

import { supabase } from "../../../supabaseClient";
import type {
  PromoteurStudy,
  PromoteurStudySummary,
  PromoteurStudyMetaPatch,
  PromoteurFoncierData,
  PromoteurPluData,
  PromoteurConceptionData,
  PromoteurMarcheData,
  PromoteurRisquesData,
  PromoteurEvaluationData,
  PromoteurBilanData,
  ServiceResult,
} from "./promoteurStudy.types";
import type { Implantation2DSnapshot } from "../plan2d/implantation2d.snapshot";

const TABLE = "promoteur_studies" as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toResult<T>(data: T | null, error: { message: string } | null): ServiceResult<T> {
  if (error)         return { ok: false, error: error.message };
  if (data === null) return { ok: false, error: "Aucun résultat retourné" };
  return { ok: true, data };
}

async function patchColumn<K extends keyof PromoteurStudy>(
  studyId: string,
  column: K,
  value: PromoteurStudy[K]
): Promise<ServiceResult<PromoteurStudy>> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .update({ [column]: value })
      .eq("id", studyId)
      .select()
      .single();
    return toResult(data as PromoteurStudy | null, error);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Erreur réseau" };
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const PromoteurStudyService = {

  // ── Lecture ──────────────────────────────────────────────────────────────

  async getStudy(studyId: string): Promise<ServiceResult<PromoteurStudy>> {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("*")       // implantation2d inclus dès que la colonne existe
        .eq("id", studyId)
        .single();
      return toResult(data as PromoteurStudy | null, error);
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Erreur réseau" };
    }
  },

  async listStudies(): Promise<ServiceResult<PromoteurStudySummary[]>> {
    try {
      // ✅ Sélectionner foncier entier — la syntaxe `foncier->x` n'est pas
      //    supportée par Supabase JS client et fait échouer la requête
      const { data, error } = await supabase
        .from(TABLE)
        .select("id, user_id, title, status, created_at, updated_at, foncier")
        .order("updated_at", { ascending: false });

      if (error) return { ok: false, error: error.message };

      const shaped: PromoteurStudySummary[] = (data ?? []).map((row: any) => ({
        id:         row.id,
        user_id:    row.user_id,
        title:      row.title,
        status:     row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        // Extraction JSONB côté JS
        foncier: row.foncier?.commune_insee
          ? {
              commune_insee: row.foncier.commune_insee,
              surface_m2:    row.foncier.surface_m2 ?? null,
            }
          : null,
      }));

      return { ok: true, data: shaped };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Erreur réseau" };
    }
  },

  // ── Création ─────────────────────────────────────────────────────────────

  async createStudy(title: string): Promise<ServiceResult<PromoteurStudy>> {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) return { ok: false, error: "Non authentifié" };
      const { data, error } = await supabase
        .from(TABLE)
        .insert({ user_id: user.id, title: title.trim() || "Nouvelle étude", status: "draft" })
        .select()
        .single();
      return toResult(data as PromoteurStudy | null, error);
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Erreur réseau" };
    }
  },

  // ── Patch méta (titre, statut) ────────────────────────────────────────────

  async patchMeta(studyId: string, patch: PromoteurStudyMetaPatch): Promise<ServiceResult<PromoteurStudy>> {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .update(patch)
        .eq("id", studyId)
        .select()
        .single();
      return toResult(data as PromoteurStudy | null, error);
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Erreur réseau" };
    }
  },

  // ── Patch par module ──────────────────────────────────────────────────────

  patchFoncier(studyId: string, data: PromoteurFoncierData): Promise<ServiceResult<PromoteurStudy>> {
    return patchColumn(studyId, "foncier", data);
  },

  patchPlu(studyId: string, data: PromoteurPluData): Promise<ServiceResult<PromoteurStudy>> {
    return patchColumn(studyId, "plu", data);
  },

  patchConception(studyId: string, data: PromoteurConceptionData): Promise<ServiceResult<PromoteurStudy>> {
    return patchColumn(studyId, "conception", data);
  },

  patchMarche(studyId: string, data: PromoteurMarcheData): Promise<ServiceResult<PromoteurStudy>> {
    return patchColumn(studyId, "marche", data);
  },

  patchRisques(studyId: string, data: PromoteurRisquesData): Promise<ServiceResult<PromoteurStudy>> {
    return patchColumn(studyId, "risques", data);
  },

  patchEvaluation(studyId: string, data: PromoteurEvaluationData): Promise<ServiceResult<PromoteurStudy>> {
    return patchColumn(studyId, "evaluation", data);
  },

  patchBilan(studyId: string, data: PromoteurBilanData): Promise<ServiceResult<PromoteurStudy>> {
    return patchColumn(studyId, "bilan", data);
  },

  // ── Implantation 2D ───────────────────────────────────────────────────────
  // Persist la colonne jsonb `implantation2d`.
  // Appelé par Implantation2DPage (auto-save debounced) et par patchImplantation2d
  // de usePromoteurStudy (écriture synchrone si besoin).
  //
  // ⚠️  La colonne doit exister en base :
  //     ALTER TABLE promoteur_studies
  //     ADD COLUMN IF NOT EXISTS implantation2d jsonb DEFAULT NULL;
  async patchImplantation2d(
    studyId: string,
    data: Implantation2DSnapshot,
  ): Promise<ServiceResult<PromoteurStudy>> {
    try {
      const { data: row, error } = await supabase
        .from(TABLE)
        .update({ implantation2d: data })
        .eq("id", studyId)
        .select()
        .single();
      if (error) {
        console.error("[PromoteurStudyService] patchImplantation2d error:", error.message);
      }
      return toResult(row as PromoteurStudy | null, error);
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Erreur réseau" };
    }
  },

  // ── Suppression ──────────────────────────────────────────────────────────

  async deleteStudy(studyId: string): Promise<ServiceResult<void>> {
    try {
      const { error } = await supabase.from(TABLE).delete().eq("id", studyId);
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: undefined };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Erreur réseau" };
    }
  },

  // ── Compat legacy (à supprimer après migration) ───────────────────────────
  async patchFoncierLegacy(studyId: string, flat: {
    foncier_parcel_ids?:    string[];
    foncier_focus_id?:      string;
    foncier_commune_insee?: string;
    foncier_surface_m2?:    number | null;
    foncier_parcels_raw?:   any[];
    foncier_done?:          boolean;
  }): Promise<ServiceResult<PromoteurStudy>> {
    const foncier: PromoteurFoncierData = {
      parcel_ids:    flat.foncier_parcel_ids    ?? [],
      focus_id:      flat.foncier_focus_id      ?? "",
      commune_insee: flat.foncier_commune_insee ?? "",
      surface_m2:    flat.foncier_surface_m2    ?? null,
      parcels_raw:   flat.foncier_parcels_raw   ?? [],
      done:          flat.foncier_done          ?? false,
    };
    return patchColumn(studyId, "foncier", foncier);
  },
} as const;

// ─── Export legacy pour compat avec les imports existants ─────────────────────
export const StudyService = PromoteurStudyService;
export type  SelectedParcelRaw = import("./promoteurStudy.types").PromoteurParcelRaw;