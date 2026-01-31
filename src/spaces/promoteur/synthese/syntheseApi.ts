// src/spaces/promoteur/synthese/syntheseApi.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SynthesePayload, SyntheseResult, SyntheseTone } from "./syntheseTypes";
import { getSnapshot } from "../shared/promoteurSnapshot.store";

type GenerateSyntheseArgs = {
  supabase: SupabaseClient;
  parcelId?: string;
  communeInsee?: string | null;
  tone?: SyntheseTone;
  // override snapshot optionnel
  snapshot?: Record<string, unknown>;
};

function isoNow() {
  return new Date().toISOString();
}

/**
 * Génère un dossier/synthèse via Edge Function.
 * - Backend cible: dossier-generate-v1 (si déjà en place)
 * - Fallback: renvoie un résultat minimal si la fonction n'existe pas encore.
 */
export async function generateSynthese(args: GenerateSyntheseArgs): Promise<SyntheseResult> {
  const tone: SyntheseTone = args.tone ?? "banque";
  const snapshot = args.snapshot ?? getSnapshot();

  const payload: SynthesePayload = {
    tone,
    parcelId: args.parcelId,
    communeInsee: args.communeInsee ?? null,
    snapshot,
  };

  // IMPORTANT: si tu as déjà nommé ta fonction autrement, change juste ici.
  const FN_NAME = "dossier-generate-v1";

  try {
    const { data, error } = await args.supabase.functions.invoke(FN_NAME, {
      body: payload,
    });

    if (error) {
      // fallback “soft” : on n’explose pas l’UI
      console.warn(`[SYNTH] invoke ${FN_NAME} error`, error);
      return fallbackResult(tone, payload, { error });
    }

    // On accepte 2 formats possibles:
    // 1) {title, generatedAt, tone, sections}
    // 2) {result: {...}}
    const res = (data?.result ?? data) as Partial<SyntheseResult> | undefined;

    if (!res || !Array.isArray(res.sections)) {
      return fallbackResult(tone, payload, { data });
    }

    return {
      title: res.title ?? "Dossier de présentation",
      generatedAt: res.generatedAt ?? isoNow(),
      tone: (res.tone as SyntheseTone) ?? tone,
      sections: res.sections,
      raw: data,
    };
  } catch (e) {
    console.warn(`[SYNTH] invoke ${FN_NAME} exception`, e);
    return fallbackResult(tone, payload, { exception: String(e) });
  }
}

function fallbackResult(tone: SyntheseTone, payload: SynthesePayload, raw?: unknown): SyntheseResult {
  return {
    title: "Dossier de présentation (fallback)",
    generatedAt: isoNow(),
    tone,
    sections: [
      {
        id: "resume",
        title: "Résumé",
        content:
          "La génération serveur n’est pas disponible pour le moment. " +
          "Vérifie que l’Edge Function `dossier-generate-v1` est bien déployée/servie. " +
          "En attendant, le snapshot projet a été récupéré côté front.",
      },
      {
        id: "snapshot",
        title: "Snapshot (debug)",
        content: "```json\n" + JSON.stringify(payload.snapshot ?? {}, null, 2) + "\n```",
      },
    ],
    raw,
  };
}
