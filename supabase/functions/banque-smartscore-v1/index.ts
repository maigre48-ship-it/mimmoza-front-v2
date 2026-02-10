interface SnapshotSection { key: string; label: string; data: Record<string, unknown>; }
interface RequestPayload { projectId: string; montant: number; createdAt: string; snapshot: { sections: SnapshotSection[] }; pieces: { id: string; name: string; type: string; dateAdded: string }[]; hasDossierGenerated: boolean; }
interface SubScore { key: string; label: string; value: number; weight: number; justification: string; sources: string[]; }

const WEIGHTS: Record<string, { label: string; weight: number }> = {
  marche: { label: "Marché", weight: 0.20 }, risques: { label: "Risques", weight: 0.20 }, reglementaire: { label: "Réglementaire", weight: 0.10 },
  finance: { label: "Finance", weight: 0.25 }, delai: { label: "Délai", weight: 0.10 }, completude: { label: "Complétude données", weight: 0.15 },
};

function computeSubscore(key: string, payload: RequestPayload): Omit<SubScore, "weight"> {
  const sections = payload.snapshot.sections;
  const hasSection = (k: string) => sections.some((s) => s.key === k);
  switch (key) {
    case "marche": { const has = hasSection("market"); return { key, label: "Marché", value: has ? 70 : 35, justification: has ? "Données marché présentes." : "Aucune donnée marché (unknown).", sources: has ? ["snapshot.sections.market"] : [] }; }
    case "risques": { const has = hasSection("risks"); return { key, label: "Risques", value: has ? 65 : 30, justification: has ? "Analyse de risques identifiée." : "Aucune analyse de risques (unknown).", sources: has ? ["snapshot.sections.risks"] : [] }; }
    case "reglementaire": { const has = hasSection("regulation") || hasSection("plu"); return { key, label: "Réglementaire", value: has ? 75 : 40, justification: has ? "Données réglementaires présentes." : "Données réglementaires manquantes (unknown).", sources: has ? ["snapshot.sections.regulation"] : [] }; }
    case "finance": { const hasFin = hasSection("financials"); let value = 50; if (hasFin) value += 20; if (payload.montant > 0) value += 10; value = Math.min(value, 100); return { key, label: "Finance", value, justification: hasFin && payload.montant > 0 ? `Montant: ${(payload.montant / 1e6).toFixed(1)}M€. Données financières présentes.` : payload.montant > 0 ? `Montant: ${(payload.montant / 1e6).toFixed(1)}M€. Pas de section financière.` : "Montant inconnu (unknown).", sources: hasFin ? ["snapshot.sections.financials", "project.montant"] : ["project.montant"] }; }
    case "delai": { const diffMonths = (Date.now() - new Date(payload.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30); let value = 80; if (diffMonths > 6) value = 50; if (diffMonths > 12) value = 30; return { key, label: "Délai", value, justification: diffMonths > 6 ? `Dossier ouvert depuis ${Math.round(diffMonths)} mois.` : `Dossier récent (${Math.round(diffMonths)} mois).`, sources: ["project.createdAt"] }; }
    case "completude": { const present = sections.length; const piecesCount = payload.pieces.length; let value = Math.round((present / 6) * 60); if (piecesCount >= 3) value += 20; else if (piecesCount >= 1) value += 10; if (payload.hasDossierGenerated) value += 20; value = Math.min(value, 100); return { key, label: "Complétude données", value, justification: `${present}/6 sections, ${piecesCount} pièce(s).`, sources: ["snapshot.sections", "project.pieces"] }; }
    default: return { key, label: key, value: 50, justification: "Score par défaut", sources: [] };
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json();
    if (!body.snapshot || !Array.isArray(body.snapshot.sections)) throw new Error("snapshot with sections array is required");
    const payload: RequestPayload = { projectId: body.projectId ?? "unknown", montant: body.montant ?? 0, createdAt: body.createdAt ?? new Date().toISOString(), snapshot: body.snapshot, pieces: body.pieces ?? [], hasDossierGenerated: body.hasDossierGenerated ?? false };

    const keys = Object.keys(WEIGHTS);
    const subscores: SubScore[] = keys.map((key) => { const result = computeSubscore(key, payload); return { ...result, weight: WEIGHTS[key].weight }; });
    const global = Math.min(100, Math.max(0, Math.round(subscores.reduce((acc, s) => acc + s.value * s.weight, 0))));

    return new Response(JSON.stringify({
      score: global, subscores, explanations: subscores.map((s) => `${s.label}: ${s.value}/100 — ${s.justification}`), computedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
