// src/spaces/promoteur/terrain3d/facade/requestFacadeAiRender.ts

import { supabase } from "../../../../lib/supabase";
import type {
  FacadeAiRenderRequest,
  FacadeAiRenderResult,
} from "./facadeAi.types";

export async function requestFacadeAiRender(
  payload: FacadeAiRenderRequest
): Promise<FacadeAiRenderResult> {
  const normalizedPayload: FacadeAiRenderRequest = {
    ...payload,

    // Harmonisation douce des IDs UI → backend
    view:
      payload.view === "3_quarts_legers"
        ? "three-quarter-light"
        : payload.view === "perspective_entree"
        ? "entree"
        : payload.view === "angle_rue"
        ? "street-angle"
        : payload.view ?? "frontale",

    drawingStyle:
      payload.drawingStyle === "brochure_archi"
        ? "brochure-archi"
        : payload.drawingStyle ?? "aquarelle",
  };

  const { data, error } = await supabase.functions.invoke("facade-ai-render", {
    body: normalizedPayload,
  });

  if (error) {
    // supabase-js ne met PAS le corps de la réponse dans `error.message` sur un
    // statut non-2xx : on n'obtient que « Edge Function returned a non-2xx
    // status code », et la vraie réponse est dans `error.context`. Sans cette
    // lecture, un refus pour solde insuffisant (402) s'affichait à
    // l'utilisateur comme une panne technique.
    const contexte = (error as { context?: Response }).context;
    if (contexte && typeof contexte.json === "function") {
      try {
        const corps = await contexte.json();
        if (corps?.message) throw new Error(corps.message);
      } catch (e) {
        if (e instanceof Error && e.message && !e.message.includes("JSON")) throw e;
      }
    }
    throw new Error(error.message || "Facade AI render failed");
  }

  if (!data?.imageUrl) {
    throw new Error("Facade AI render: imageUrl manquant dans la réponse");
  }

  return {
    imageUrl: data.imageUrl,
    promptUsed: data.promptUsed ?? normalizedPayload.prompt,
  };
}