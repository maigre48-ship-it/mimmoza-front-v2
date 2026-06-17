// ============================================================================
// banqueCommitteeNarrative.service.ts
// src/spaces/banque/services/banqueCommitteeNarrative.service.ts
//
// Service pour générer la note de synthèse comité via Edge Function Supabase.
// ✅ FIX: Enriched error reporting — includes error.context.body when available.
// ✅ DEBUG: Log raw response data to verify promptVersion/model/narrativeStructured.
// ✅ UX FIX: Human-readable error mapping for Anthropic / model-not-found cases.
// ============================================================================

import { supabase } from "@/lib/supabaseClient";

export interface CommitteeNarrativeResult {
  ok: boolean;
  narrative?: string;
  narrativeStructured?: any; // optional field (non-breaking)
  sourcesUsed?: string[];
  warnings?: string[];
  model?: string;
  promptVersion?: string;
  sourceHash?: string;
  generatedAt?: string;
  error?: string;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function readPossibleStreamBody(body: any): Promise<string> {
  if (!body) return "";

  if (typeof body === "string") return body;

  if (typeof body === "object" && typeof body.getReader !== "function") {
    return safeJsonStringify(body);
  }

  if (typeof body?.getReader === "function") {
    try {
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let done = false;

      while (!done) {
        const result = await reader.read();
        if (result.value) chunks.push(result.value);
        done = result.done;
      }

      const decoder = new TextDecoder();
      let text = "";
      for (const chunk of chunks) {
        text += decoder.decode(chunk, { stream: true });
      }
      text += decoder.decode();
      return text;
    } catch (err) {
      console.warn("[CommitteeNarrative] Could not read error stream:", err);
      return "";
    }
  }

  return String(body);
}

function tryParseJson(text: string): any | null {
  if (!text || typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractNestedErrorMessage(payload: any): string {
  if (!payload) return "";

  if (typeof payload === "string") return payload;

  const direct =
    payload?.error ??
    payload?.message ??
    payload?.detail ??
    payload?.details ??
    "";

  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const nested =
    payload?.detail?.error?.message ??
    payload?.detail?.message ??
    payload?.context?.message ??
    "";

  if (typeof nested === "string" && nested.trim()) return nested.trim();

  return "";
}

function normalizeNarrativeError(params: {
  baseMessage?: string;
  detailText?: string;
  detailJson?: any;
}): string {
  const baseMessage = params.baseMessage ?? "";
  const detailText = params.detailText ?? "";
  const detailJson = params.detailJson;

  const fullText = [baseMessage, detailText, safeJsonStringify(detailJson)]
    .filter(Boolean)
    .join(" ");

  const lower = fullText.toLowerCase();

  // Anthropic model not found / invalid model name
  if (
    lower.includes("anthropic api error") &&
    lower.includes("not_found_error") &&
    lower.includes("model")
  ) {
    const modelMatch =
      fullText.match(/model["']?\s*:\s*["']([^"']+)["']/i) ??
      fullText.match(/model\s+([a-z0-9\-._]+)/i);

    const modelLabel = modelMatch?.[1]?.trim();

    return modelLabel
      ? `Le modèle IA configuré pour la note comité est introuvable ou indisponible (${modelLabel}). Vérifie le nom du modèle dans l’Edge Function Supabase.`
      : `Le modèle IA configuré pour la note comité est introuvable ou indisponible. Vérifie le nom du modèle dans l’Edge Function Supabase.`;
  }

  // Anthropic generic error
  if (lower.includes("anthropic api error")) {
    const nestedMessage = extractNestedErrorMessage(detailJson) || detailText;
    return nestedMessage
      ? `Erreur du service IA : ${nestedMessage}`
      : "Erreur du service IA pendant la génération de la note comité.";
  }

  // HTTP 401 / auth-like
  if (lower.includes("401") || lower.includes("unauthorized")) {
    return "Accès non autorisé au service de génération de note comité.";
  }

  // HTTP 403
  if (lower.includes("403") || lower.includes("forbidden")) {
    return "Accès refusé au service de génération de note comité.";
  }

  // HTTP 404 generic
  if (lower.includes("404")) {
    return "La fonction de génération de note comité est introuvable ou mal configurée.";
  }

  // HTTP 500 / 502 / 503
  if (
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("edge function returned a non-2xx status code")
  ) {
    const nestedMessage = extractNestedErrorMessage(detailJson) || detailText;
    return nestedMessage
      ? `Le service de génération de note comité a échoué : ${nestedMessage}`
      : "Le service de génération de note comité a échoué.";
  }

  return baseMessage || detailText || "Erreur inconnue lors de la génération de la note comité.";
}

export async function generateCommitteeNarrative(
  report: any
): Promise<CommitteeNarrativeResult> {
  try {
    console.log("[CommitteeNarrative] Invoking edge function…");

    const { data, error } = await supabase.functions.invoke(
      "banque-committee-narrative-v1",
      {
        body: { report },
      }
    );

    if (error) {
      console.error("[CommitteeNarrative] Supabase function error:", error);

      let detailText = "";
      let detailJson: any = null;

      try {
        const ctx = (error as any)?.context;

        if (ctx) {
          detailText = await readPossibleStreamBody(ctx.body);

          const parsedFromBody = tryParseJson(detailText);
          if (parsedFromBody) {
            detailJson = parsedFromBody;
          } else if (ctx.body && typeof ctx.body === "object" && typeof ctx.body.getReader !== "function") {
            detailJson = ctx.body;
          }

          if (ctx.status) {
            const prefix = `[HTTP ${ctx.status}${ctx.statusText ? " " + ctx.statusText : ""}]`;
            detailText = detailText ? `${prefix} ${detailText}` : prefix;
          }
        }
      } catch (ctxErr) {
        console.warn("[CommitteeNarrative] Could not extract error context:", ctxErr);
      }

      const rawMessage = detailText
        ? `${error.message ?? "Edge function error"} — Detail: ${detailText.slice(0, 2000)}`
        : error.message ?? "Edge function error (no detail)";

      console.error("[CommitteeNarrative] Full raw error:", rawMessage);

      const friendlyMessage = normalizeNarrativeError({
        baseMessage: error.message,
        detailText,
        detailJson,
      });

      return { ok: false, error: friendlyMessage };
    }

    console.log("[CommitteeNarrative] Response data:", data);

    // Certaines versions renvoient ok:false dans data au lieu de remplir error
    if (data && typeof data === "object" && (data as any).ok === false) {
      const errMsg = (data as any).error ?? "Edge function returned ok:false";
      const errDetailRaw =
        (data as any).detail != null
          ? typeof (data as any).detail === "string"
            ? (data as any).detail
            : safeJsonStringify((data as any).detail)
          : "";

      const rawCombined = errDetailRaw
        ? `${String(errMsg)} — Detail: ${String(errDetailRaw).slice(0, 2000)}`
        : String(errMsg);

      console.error("[CommitteeNarrative] Edge function returned error:", rawCombined);

      const friendlyMessage = normalizeNarrativeError({
        baseMessage: String(errMsg),
        detailText: errDetailRaw,
        detailJson: (data as any).detail ?? data,
      });

      return { ok: false, error: friendlyMessage };
    }

    console.log(
      "[CommitteeNarrative] Success. Model:",
      (data as any)?.model,
      "Prompt:",
      (data as any)?.promptVersion,
      "Narrative length:",
      (data as any)?.narrative?.length ?? 0
    );

    return data as CommitteeNarrativeResult;
  } catch (err) {
    console.error("[CommitteeNarrative] Unexpected error:", err);

    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
        ? err
        : safeJsonStringify(err);

    return {
      ok: false,
      error: normalizeNarrativeError({
        baseMessage: message,
      }),
    };
  }
}