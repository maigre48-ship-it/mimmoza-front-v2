import type { InvestisseurSnapshot } from "../store/investisseurSnapshot.store";

export interface EnrichResult {
  market: any | null;
  insee: any | null;
  risques: any | null;
  errors: string[];
}

export function extractFromAdText(rawText: string): Partial<{
  surfaceHabitable: number;
  rooms: number;
  priceAsked: number;
  dpe: string;
  propertyType: string;
}> {
  const result: Record<string, unknown> = {};

  const surfaceMatch = rawText.match(/(\d+(?:[.,]\d+)?)\s*m[²2]/i);
  if (surfaceMatch) {
    result.surfaceHabitable = parseFloat(surfaceMatch[1].replace(",", "."));
  }

  const roomsMatch =
    rawText.match(/(\d+)\s*pi[eè]ces?/i) || rawText.match(/[TF](\d)/i);
  if (roomsMatch) {
    result.rooms = parseInt(roomsMatch[1], 10);
  }

  const priceMatch = rawText.match(/(\d{1,3}(?:[\s.]?\d{3})*)\s*€/);
  if (priceMatch) {
    result.priceAsked = parseInt(priceMatch[1].replace(/[\s.]/g, ""), 10);
  }

  const dpeMatch = rawText.match(
    /(?:DPE|classe\s*[ée]nergie)\s*:?\s*([A-G])/i
  );
  if (dpeMatch) {
    result.dpe = dpeMatch[1].toUpperCase();
  }

  const text = rawText.toLowerCase();
  if (text.includes("appartement") || text.includes("studio")) {
    result.propertyType = "appartement";
  } else if (
    text.includes("maison") ||
    text.includes("villa") ||
    text.includes("pavillon")
  ) {
    result.propertyType = "maison";
  } else if (text.includes("terrain")) {
    result.propertyType = "terrain";
  } else if (text.includes("immeuble")) {
    result.propertyType = "immeuble";
  } else if (
    text.includes("local") ||
    text.includes("commerce") ||
    text.includes("bureau")
  ) {
    result.propertyType = "local";
  }

  return result;
}

export async function enrichSnapshot(
  snapshot: InvestisseurSnapshot
): Promise<EnrichResult> {
  const errors: string[] = [];
  let market: any | null = null;
  let insee: any | null = null;
  let risques: any | null = null;

  const d = snapshot.propertyDraft;
  const hasLocation = !!(d.address || (d.lat && d.lng));

  if (!hasLocation) {
    return {
      market: null,
      insee: null,
      risques: null,
      errors: ["Aucune localisation fournie — enrichissement impossible."],
    };
  }

  try {
    const basePrixM2: Record<string, number> = {
      appartement: 4200,
      maison: 3100,
      terrain: 180,
      immeuble: 2800,
      local: 2500,
    };
    const base = basePrixM2[d.propertyType ?? "appartement"] ?? 3500;
    const variance = d.zipCode
      ? (parseInt(d.zipCode.slice(0, 2), 10) % 10) * 100
      : 0;

    market = {
      prixM2Median: base + variance,
      prixM2Min: Math.round((base + variance) * 0.75),
      prixM2Max: Math.round((base + variance) * 1.35),
      nbTransactions12m: 42 + (variance % 30),
      tendance: "stable" as const,
      source: "mock",
      updatedAt: new Date().toISOString(),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "erreur inconnue";
    errors.push("Marché : " + msg);
  }

  try {
    insee = {
      population: 12500,
      revenuMedian: 22800,
      tauxChomage: 8.2,
      densiteHab: 3200,
      source: "mock",
      codeCommune: d.zipCode ?? "00000",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "erreur inconnue";
    errors.push("INSEE : " + msg);
  }

  try {
    risques = {
      inondation: false,
      seisme: false,
      argiles: false,
      radon: false,
      pollution: false,
      nbRisques: 0,
      source: "mock",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "erreur inconnue";
    errors.push("Risques : " + msg);
  }

  return { market, insee, risques, errors };
}