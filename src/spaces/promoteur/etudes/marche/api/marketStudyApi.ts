// FILE: src/spaces/promoteur/etudes/marche/api/marketStudyApi.ts

import type {
  MarketStudyRequest,
  MarketStudyResponse,
  MarketStudyError,
} from "../types/marketStudy.types";

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

// URL et clé Supabase depuis les variables d'environnement Vite
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

// ─────────────────────────────────────────────────────────────
// API Function
// ─────────────────────────────────────────────────────────────

/**
 * Appelle l'Edge Function market-study-v1 pour générer une étude de marché
 */
export async function fetchMarketStudy(
  params: MarketStudyRequest
): Promise<MarketStudyResponse> {
  if (!SUPABASE_URL) {
    throw new Error(
      "Configuration manquante: VITE_SUPABASE_URL n'est pas défini dans .env"
    );
  }

  const url = `${SUPABASE_URL}/functions/v1/market-study-v1`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Ajouter les headers d'authentification si la clé est disponible
  if (SUPABASE_ANON_KEY) {
    headers["Authorization"] = `Bearer ${SUPABASE_ANON_KEY}`;
    headers["apikey"] = SUPABASE_ANON_KEY;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMessage =
        (data as MarketStudyError)?.error ||
        `Erreur ${response.status}: ${response.statusText}`;
      throw new Error(errorMessage);
    }

    // Vérifier si c'est une erreur dans le body
    if ("error" in data && typeof data.error === "string") {
      throw new Error((data as MarketStudyError).error);
    }

    return data as MarketStudyResponse;
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error("Erreur inconnue lors de l'appel API");
  }
}

/**
 * Export des données en JSON (côté client)
 */
export function exportMarketStudyToJson(
  data: MarketStudyResponse,
  filename?: string
): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const defaultFilename = `etude-marche-${
    data.location.commune_nom?.replace(/\s+/g, "-") || "export"
  }-${new Date().toISOString().split("T")[0]}.json`;

  const a = document.createElement("a");
  a.href = url;
  a.download = filename || defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export des données en CSV simplifié (KPIs + POIs)
 */
export function exportMarketStudyToCsv(
  data: MarketStudyResponse,
  filename?: string
): void {
  const lines: string[] = [];

  // Header
  lines.push("Étude de Marché - Export CSV");
  lines.push(`Commune: ${data.location.commune_nom || "N/A"}`);
  lines.push(`Coordonnées: ${data.location.lat}, ${data.location.lon}`);
  lines.push(`Rayon: ${data.context.radius_km} km`);
  lines.push(`Généré le: ${data.meta.generated_at}`);
  lines.push("");

  // KPIs INSEE
  lines.push("INDICATEURS INSEE");
  lines.push(
    `Population: ${data.insee.population?.toLocaleString("fr-FR") || "N/A"}`
  );
  lines.push(
    `Densité: ${data.insee.densite_hab_km2?.toLocaleString("fr-FR") || "N/A"} hab/km²`
  );
  lines.push("");

  // Comptages POI
  lines.push("ÉQUIPEMENTS ET SERVICES (dans le rayon)");
  lines.push("Catégorie,Nombre,Distance min (km)");

  const categories = Object.keys(data.kpis.counts) as Array<
    keyof typeof data.kpis.counts
  >;
  for (const cat of categories) {
    const count = data.kpis.counts[cat];
    const nearest = data.kpis.nearest[cat];
    lines.push(
      `${cat},${count},${nearest !== null ? nearest.toFixed(2) : "N/A"}`
    );
  }
  lines.push("");

  // DVF
  if (data.comps.dvf_available && data.comps.items.length > 0) {
    lines.push("TRANSACTIONS IMMOBILIÈRES (DVF)");
    lines.push("Date,Type,Valeur (€),Surface (m²),Prix/m²,Commune");
    for (const tx of data.comps.items.slice(0, 20)) {
      lines.push(
        `${tx.date_mutation},${tx.type_local || "N/A"},${tx.valeur_fonciere},${tx.surface_reelle_bati || "N/A"},${tx.prix_m2 || "N/A"},${tx.commune || "N/A"}`
      );
    }
  }

  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const defaultFilename = `etude-marche-${
    data.location.commune_nom?.replace(/\s+/g, "-") || "export"
  }-${new Date().toISOString().split("T")[0]}.csv`;

  const a = document.createElement("a");
  a.href = url;
  a.download = filename || defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}