// src/spaces/marchand/services/exportAiReport.service.ts

import { supabase } from "../../../lib/supabaseClient";
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
 * generateExportAiReport
 *
 * CHANGELOG
 * ---------
 * v1.5.0 – 2026-02-26
 *   • Ajout du bloc BPE « Équipements & cadre de vie » dans narrativeMarkdown.
 *     - Lit core.bpe.score_v2 / coverage_pct_v2 / coverage_v2 / source_v2 depuis le contexte ExportContextV1.
 *     - Fallback automatique sur core.bpe.score (legacy) si score_v2 absent.
 *     - Insertion après « ### Lecture marché » (ou fin de narrative).
 *     - Aucune modification du contenu existant (DVF/marge/verdict/etc.).
 *     - Aucun changement de schéma de réponse API.
 */

// ─────────────────────────────────────────────────────────────────────────────
// BPE helpers (pure functions, zero deps)
// ─────────────────────────────────────────────────────────────────────────────

interface BpeContext {
  score_v2?: number | null;
  coverage_v2?: number | null;
  coverage_pct_v2?: number | null;
  source_v2?: string | null;

  score?: number | null; // legacy
  nb_ecoles?: number | null;
  commerces?: { count?: number | null } | null;
  sante?: { count?: number | null } | null;
  nb_pharmacies?: number | null;
  nb_supermarches?: number | null;
}

function getBpeLevel(score: number): string {
  if (score >= 80) return "TRÈS FORT";
  if (score >= 65) return "FORT";
  if (score >= 50) return "MOYEN";
  if (score >= 35) return "FAIBLE";
  return "TRÈS FAIBLE";
}

function getBpeLiquiditeImpact(score: number): string {
  if (score >= 65) return "Liquidité soutenue — friction de sortie faible.";
  if (score >= 50)
    return "Impact neutre — dépend du pricing et de la qualité intrinsèque du bien.";
  return "Friction de sortie probable — prime à la décote à anticiper.";
}

function getBpeRisqueDelai(score: number): string {
  if (score >= 65)
    return "Risque délai modéré — forte demande liée au cadre de vie.";
  if (score >= 50)
    return "Risque délai moyen — attractivité correcte mais non différenciante.";
  return "Risque délai élevé — faible attractivité, délai de commercialisation allongé.";
}

function nd(value: number | null | undefined): string {
  return value != null ? String(value) : "ND";
}

function buildBpeMarkdownBlock(bpe: BpeContext): string | null {
  // Resolve score: v2 prioritaire, fallback legacy
  const hasV2 = bpe.score_v2 != null;
  const score = hasV2 ? bpe.score_v2! : bpe.score ?? null;
  if (score == null) return null; // aucun score dispo → on skip

  const source = hasV2 ? (bpe.source_v2 ?? "bpe-score-v2") : "legacy (fallback)";
  const level = getBpeLevel(score);

  const coveragePct =
    bpe.coverage_pct_v2 != null ? `${Math.round(bpe.coverage_pct_v2)}%` : "ND";

  const maybeCoverageCats =
    bpe.coverage_v2 != null ? ` (${bpe.coverage_v2} catégories couvertes)` : "";

  const lines: string[] = [
    "",
    "### Équipements & cadre de vie (BPE)",
    "",
    `BPE Score : **${Math.round(score)}/100** — **${level}** (source : ${source})`,
    `Couverture : **${coveragePct}**${maybeCoverageCats}`,
    "",
    `- **Impact liquidité** : ${getBpeLiquiditeImpact(score)}`,
    `- **Impact risque délai** : ${getBpeRisqueDelai(score)}`,
    `- **Drivers** : Écoles (${nd(bpe.nb_ecoles)}) · Commerces (${nd(
      bpe.commerces?.count
    )}) · Santé (${nd(bpe.sante?.count)}) · Pharmacies (${nd(
      bpe.nb_pharmacies
    )}) · Supermarchés (${nd(bpe.nb_supermarches)})`,
    "",
  ];

  return lines.join("\n");
}

/**
 * Injecte le bloc BPE dans le narrativeMarkdown existant,
 * juste après "### Lecture marché" (ou à la fin si absent).
 * Ne touche à aucun contenu existant.
 */
function injectBpeIntoNarrative(
  narrative: string | undefined | null,
  context: ExportContextV1
): string | undefined {
  if (!narrative) return narrative ?? undefined;

  // Extraire l'objet bpe depuis le contexte (core.bpe)
  const bpe: BpeContext = (context as any)?.core?.bpe ?? {};
  const block = buildBpeMarkdownBlock(bpe);
  if (!block) return narrative; // rien à injecter

  // Point d'insertion : juste après la section "### Lecture marché"
  // On cherche le prochain "###" après "### Lecture marché" pour insérer avant.
  const anchorPattern = /^###\s+Lecture\s+march[ée]/im;
  const anchorMatch = anchorPattern.exec(narrative);

  if (anchorMatch) {
    const anchorEnd = anchorMatch.index + anchorMatch[0].length;
    const rest = narrative.slice(anchorEnd);

    const nextSectionMatch = /^###\s+/m.exec(rest);
    if (nextSectionMatch) {
      const insertPos = anchorEnd + nextSectionMatch.index;
      return (
        narrative.slice(0, insertPos).trimEnd() +
        "\n" +
        block +
        "\n" +
        narrative.slice(insertPos)
      );
    }

    // Pas de section suivante → append à la fin
    return narrative.trimEnd() + "\n" + block;
  }

  // Fallback : pas de "Lecture marché" trouvé → append à la fin
  return narrative.trimEnd() + "\n" + block;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Appelle la Supabase Edge Function "export-report-v1" pour générer
 * une synthèse IA à partir du contexte d'export complet.
 *
 * En cas d'erreur, retourne { ok: false, error } afin de permettre
 * une dégradation gracieuse (le PDF est généré sans note IA).
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
        error: "Supabase URL ou Anon Key manquante. Impossible d'appeler l'IA.",
      };
    }

    // Auth correcte: Bearer = access_token user (pas l'anon key)
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError) {
      return {
        ok: false,
        error: sessionError.message || "Erreur session Supabase.",
      };
    }

    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
      return {
        ok: false,
        error: "Session expirée, reconnectez-vous.",
      };
    }

    // Timeout réseau (60s)
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 60_000);

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/export-report-v1`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ context }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          error: `Edge Function HTTP ${res.status}: ${text}`,
        };
      }

      const data = await res.json().catch(() => null);
      if (!data) {
        return { ok: false, error: "Réponse vide de la Edge Function." };
      }

      // ── Injection du bloc BPE dans le narrativeMarkdown (post-processing) ──
      const rawNarrative: string | undefined =
        data.narrativeMarkdown ?? data.narrative_markdown;

      const enrichedNarrative = injectBpeIntoNarrative(rawNarrative, context);

      return {
        ok: true,
        executiveSummary: data.executiveSummary ?? data.executive_summary,
        decision: data.decision,
        confidence: data.confidence,
        redFlags: data.redFlags ?? data.red_flags,
        actionPlan: data.actionPlan ?? data.action_plan,
        narrativeMarkdown: enrichedNarrative,
        generatedAt: data.generatedAt ?? new Date().toISOString(),
      };
    } catch (e: any) {
      const isAbort =
        e?.name === "AbortError" ||
        String(e?.message || "").toLowerCase().includes("abort");
      return {
        ok: false,
        error: isAbort
          ? "Timeout lors de l'appel à export-report-v1."
          : e?.message ?? "Erreur réseau lors de l'appel IA.",
      };
    } finally {
      window.clearTimeout(timeoutId);
    }
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message ?? "Erreur inconnue lors de l'appel IA.",
    };
  }
}