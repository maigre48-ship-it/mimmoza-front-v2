// ============================================================================
// banqueCommitteeNarrative.service.ts
// src/spaces/banque/services/banqueCommitteeNarrative.service.ts
//
// Service pour générer la note de synthèse comité via Edge Function Supabase.
// ✅ FIX: Enriched error reporting — includes error.context.body when available.
// ✅ DEBUG: Log raw response data to verify promptVersion/model/narrativeStructured.
// ============================================================================

import { supabase } from "@/lib/supabaseClient";

export interface CommitteeNarrativeResult {
  ok: boolean;
  narrative?: string;
  narrativeStructured?: any; // ✅ NEW optional field (non-breaking)
  sourcesUsed?: string[];
  warnings?: string[];
  model?: string;
  promptVersion?: string;
  sourceHash?: string;
  generatedAt?: string;
  error?: string;
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

      // ── Enriched error detail: extract context.body if present ──
      let detail = "";
      try {
        const ctx = (error as any)?.context;
        if (ctx) {
          // ctx.body can be a ReadableStream, a string, or an object
          if (typeof ctx.body === "string" && ctx.body.length > 0) {
            detail = ctx.body;
          } else if (
            ctx.body &&
            typeof ctx.body === "object" &&
            typeof ctx.body.getReader !== "function"
          ) {
            // Plain object (not a stream)
            detail = JSON.stringify(ctx.body);
          } else if (ctx.body && typeof ctx.body.getReader === "function") {
            // ReadableStream — try to consume it
            try {
              const reader = ctx.body.getReader();
              const chunks: Uint8Array[] = [];
              let done = false;
              while (!done) {
                const result = await reader.read();
                if (result.value) chunks.push(result.value);
                done = result.done;
              }
              const decoder = new TextDecoder();
              detail = chunks
                .map((c) => decoder.decode(c, { stream: true }))
                .join("");
            } catch (streamErr) {
              console.warn(
                "[CommitteeNarrative] Could not read error stream:",
                streamErr
              );
            }
          }

          // Also try ctx.status / ctx.statusText
          if (ctx.status) {
            detail = `[HTTP ${ctx.status}${
              ctx.statusText ? " " + ctx.statusText : ""
            }] ${detail}`;
          }
        }
      } catch (ctxErr) {
        console.warn(
          "[CommitteeNarrative] Could not extract error context:",
          ctxErr
        );
      }

      const fullMessage = detail
        ? `${error.message ?? "Edge function error"} — Detail: ${detail.slice(
            0,
            2000
          )}`
        : error.message ?? "Edge function error (no detail)";

      console.error("[CommitteeNarrative] Full error:", fullMessage);

      return { ok: false, error: fullMessage };
    }

    // ✅ DEBUG: voir exactement ce que renvoie l'Edge Function
    console.log("[CommitteeNarrative] Response data:", data);

    // ── Handle non-ok responses that come back as data (some Supabase versions) ──
    if (data && typeof data === "object" && (data as any).ok === false) {
      const errMsg = (data as any).error ?? "Edge function returned ok:false";
      const errDetail = (data as any).detail
        ? ` — Detail: ${String((data as any).detail).slice(0, 2000)}`
        : "";
      console.error(
        "[CommitteeNarrative] Edge function returned error:",
        errMsg + errDetail
      );
      return { ok: false, error: errMsg + errDetail };
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
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
