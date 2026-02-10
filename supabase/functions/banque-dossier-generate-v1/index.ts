const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

interface RequestPayload {
  tone: "prudent" | "neutre" | "offensif";
  project: { id: string; title: string; address: string; sponsor: string; montant: number; statut: string };
  projectSnapshot: unknown;
  smartscoreDetails: unknown;
  riskSummary: unknown;
  marketSummary: unknown;
}

const OUTPUT_SCHEMA = `{
  "meta": { "tone": string, "created_at": string, "model": string },
  "executive_summary": { "recommendation": string, "rationale": string, "key_numbers": string[] },
  "project_overview": { "title": string, "address": string, "sponsor": string, "montant": number, "type": string, "surface_estimee": string },
  "market": { "demand_level": string, "price_trend": string, "competition": string, "commentary": string },
  "risks": { "global_level": "faible" | "modéré" | "élevé" | "critique", "items": [{ "label": string, "level": string, "detail": string }] },
  "regulation": { "plu_compliant": boolean, "permits_status": string, "commentary": string },
  "financials": { "total_investment": number, "estimated_margin": string, "debt_ratio": string, "commentary": string },
  "decision": { "proposed_decision": "GO" | "GO sous conditions" | "NO GO", "conditions": string[], "next_steps": string[] },
  "annexes": { "sources": string[], "assumptions": string[] }
}`;

function validatePayload(body: unknown): RequestPayload {
  const b = body as Record<string, unknown>;
  if (!b || typeof b !== "object") throw new Error("Body must be a JSON object");
  if (!["prudent", "neutre", "offensif"].includes(b.tone as string)) throw new Error("tone must be prudent/neutre/offensif");
  if (!b.project || typeof b.project !== "object") throw new Error("project object is required");
  const p = b.project as Record<string, unknown>;
  if (!p.title || typeof p.title !== "string") throw new Error("project.title is required");
  return b as unknown as RequestPayload;
}

function buildPrompt(payload: RequestPayload): string {
  const toneInstruction = payload.tone === "prudent"
    ? "Adopte un ton conservateur et vigilant. Mets l'accent sur les risques et les conditions suspensives."
    : payload.tone === "offensif"
      ? "Adopte un ton optimiste et orienté action. Mets en avant les opportunités et le potentiel."
      : "Adopte un ton équilibré et factuel. Présente les avantages et risques de manière neutre.";

  return `Tu es un analyste crédit senior dans une banque française spécialisée en financement immobilier.
Tu dois produire une note comité crédit complète, structurée en JSON STRICT.

${toneInstruction}

## Projet
- Nom : ${payload.project.title}
- Adresse : ${payload.project.address}
- Promoteur : ${payload.project.sponsor}
- Montant : ${(payload.project.montant / 1e6).toFixed(2)}M€
- Statut : ${payload.project.statut}

## Données disponibles (snapshot)
${JSON.stringify(payload.projectSnapshot, null, 2)}

## SmartScore
${JSON.stringify(payload.smartscoreDetails, null, 2)}

## Résumé risques
${JSON.stringify(payload.riskSummary, null, 2)}

## Résumé marché
${JSON.stringify(payload.marketSummary, null, 2)}

## CONSIGNES STRICTES
1. Ta réponse doit être UNIQUEMENT du JSON valide — pas de texte avant ou après, pas de markdown
2. Respecte exactement ce schéma : ${OUTPUT_SCHEMA}
3. Tous les champs sont obligatoires
4. Les textes doivent être en français
5. Sois précis et concret
6. Si des données sont manquantes, mentionne-le explicitement

Réponds UNIQUEMENT avec le JSON.`;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json();
    const payload = validatePayload(body);
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const prompt = buildPrompt(payload);
    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return new Response(JSON.stringify({ error: `Anthropic API error: ${anthropicRes.status}`, detail: errText }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const anthropicData = await anthropicRes.json();
    const textContent = anthropicData.content?.[0]?.text ?? "";
    let cleanJson = textContent.trim();
    if (cleanJson.startsWith("```")) cleanJson = cleanJson.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(cleanJson); }
    catch { return new Response(JSON.stringify({ error: "Failed to parse Claude response as JSON", raw: textContent.substring(0, 500) }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

    if (!parsed.meta || typeof parsed.meta !== "object") parsed.meta = {};
    const meta = parsed.meta as Record<string, unknown>;
    meta.tone = payload.tone;
    meta.created_at = new Date().toISOString();
    meta.model = "claude-sonnet-4-20250514";

    return new Response(JSON.stringify(parsed), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
