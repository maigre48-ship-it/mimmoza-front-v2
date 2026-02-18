// src/spaces/marchand/services/exportAiReport.service.ts

import type { ExportContextV1 } from "../types/exportContext.types";

export interface ExportAiReportResult {
  ok: boolean;
  executiveSummary?: string;
  decision?: "GO" | "GO_AVEC_RESERVES" | "NO_GO";
  confidence?: number;
  redFlags?: string[];
  actionPlan?: string[];
  narrativeMarkdown?: string;
  error?: string;
  generatedAt?: string;
}

/**
 * Appelle la Supabase Edge Function "export-report-v1" pour generer
 * une synthese IA a partir du contexte d'export complet.
 *
 * En cas d'erreur, retourne { ok: false, error } afin de permettre
 * une degradation gracieuse (le PDF est genere sans note IA).
 */
export async function generateExportAiReport(
  context: ExportContextV1
): Promise<ExportAiReportResult> {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return {
        ok: false,
        error:
          "Supabase URL ou Anon Key manquante. Impossible d'appeler l'IA.",
      };
    }

    const res = await fetch(
      `${supabaseUrl}/functions/v1/export-report-v1`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ context }),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Edge Function HTTP ${res.status}: ${text}`,
      };
    }

    const data = await res.json();

    if (!data) {
      return { ok: false, error: "Reponse vide de la Edge Function." };
    }

    return {
      ok: true,
      executiveSummary: data.executiveSummary ?? data.executive_summary,
      decision: data.decision,
      confidence: data.confidence,
      redFlags: data.redFlags ?? data.red_flags,
      actionPlan: data.actionPlan ?? data.action_plan,
      narrativeMarkdown: data.narrativeMarkdown ?? data.narrative_markdown,
      generatedAt: data.generatedAt ?? new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message ?? "Erreur inconnue lors de l'appel IA.",
    };
  }
}