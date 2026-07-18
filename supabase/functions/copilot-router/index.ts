// copilot-router / index.ts
// Fonction Edge Deno — étape de ROUTAGE en amont de ton orchestrateur `copilot-chat`.
// Le modèle ne fait QUE : (1) classer l'intention, (2) extraire des slots.
// Le plan (vertical, moteurs, sortie) est ensuite résolu DÉTERMINISTEMENT ici.
//
// Déploiement : copier-coller dans le Dashboard Supabase (aucun CLI requis).
// Secret réutilisé : ANTHROPIC_API_KEY (le même que `copilot-chat`).
// Classification volontairement sur Haiku : rapide, bon marché → facturable 0 jeton.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const CLASSIFIER_MODEL = "claude-haiku-4-5-20251001"; // passe à Sonnet si la classif dérape
const CONFIDENCE_THRESHOLD = 0.55;

const CORS_HEADERS = {
  // En prod, remplace "*" par ton domaine (ex. "https://app.mimmoza.fr").
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- Registre (copie autonome de intentRegistry.ts — garde les deux en phase) ---
type EngineId =
  | "parcelle" | "plu" | "dvf" | "georisques"
  | "sitadel" | "merimee" | "smartscore" | "doc_parser";
type Vertical =
  | "promoteur" | "investisseur" | "rehabilitation"
  | "apporteur" | "banque" | "generic";
type OutputKind =
  | "synthese" | "envelope" | "estimation" | "rentabilite" | "explication";

type IntentDefinition = {
  intent: string;
  vertical: Vertical;
  engines: EngineId[];
  output: OutputKind;
  deeplink?: string;
  costMode: "quick" | "advanced" | "report";
};

const INTENT_REGISTRY: Record<string, IntentDefinition> = {
  analyse_adresse: {
    intent: "analyse_adresse", vertical: "generic",
    engines: ["parcelle", "dvf", "georisques", "smartscore"],
    output: "synthese", costMode: "quick",
  },
  faisabilite_plu: {
    intent: "faisabilite_plu", vertical: "promoteur",
    engines: ["plu", "sitadel", "smartscore"],
    output: "envelope", deeplink: "/promoteur/implantation", costMode: "advanced",
  },
  estimation_bien: {
    intent: "estimation_bien", vertical: "investisseur",
    engines: ["dvf", "smartscore"],
    output: "estimation", deeplink: "/investisseur/analyse", costMode: "advanced",
  },
  rentabilite_operation: {
    intent: "rentabilite_operation", vertical: "investisseur",
    engines: ["dvf", "smartscore"],
    output: "rentabilite", deeplink: "/investisseur/rentabilite", costMode: "advanced",
  },
  explication_document: {
    intent: "explication_document", vertical: "generic",
    engines: ["doc_parser"],
    output: "explication", costMode: "quick",
  },
};

const FALLBACK_PLAN: IntentDefinition = {
  intent: "fallback", vertical: "generic",
  engines: [], output: "explication", costMode: "quick",
};

const KNOWN_INTENTS = [...Object.keys(INTENT_REGISTRY), "unknown"] as const;

// --- Outil de classification (structured output forcé) ------------------------
const CLASSIFIER_TOOL = {
  name: "plan_analysis",
  description:
    "Classe la demande immobilière de l'utilisateur en une intention connue et " +
    "extrait les identifiants utiles (adresse, parcelle, document). " +
    "Ne choisis PAS de moteurs : renvoie seulement l'intention et les slots.",
  input_schema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: KNOWN_INTENTS,
        description: "L'intention la plus proche, ou 'unknown' si aucune ne colle.",
      },
      slots: {
        type: "object",
        properties: {
          address: { type: "string", description: "Adresse postale si mentionnée." },
          parcelle: { type: "string", description: "Référence cadastrale si mentionnée." },
          documentId: { type: "string", description: "Identifiant de document si fourni." },
        },
        additionalProperties: false,
      },
      confidence: {
        type: "number",
        description: "Confiance 0..1 dans la classification.",
      },
    },
    required: ["intent", "confidence"],
    additionalProperties: false,
  },
} as const;

const SYSTEM_PROMPT =
  "Tu es le routeur d'intention de MimmozIA, assistant immobilier français. " +
  "Choisis UNE intention parmi la liste fournie via l'outil plan_analysis, " +
  "extrais les slots présents, et estime ta confiance. " +
  "Si la demande ne correspond à aucune intention connue, renvoie intent='unknown'.";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

type ClassifierOutput = {
  intent: string;
  slots?: { address?: string; parcelle?: string; documentId?: string };
  confidence: number;
};

async function classify(message: string): Promise<ClassifierOutput> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLASSIFIER_MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: [CLASSIFIER_TOOL],
      tool_choice: { type: "tool", name: "plan_analysis" },
      messages: [{ role: "user", content: message }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}`);
  }

  const data = await res.json();
  const toolUse = (data.content ?? []).find(
    (b: { type: string; name?: string }) =>
      b.type === "tool_use" && b.name === "plan_analysis",
  );
  if (!toolUse) throw new Error("Aucun bloc tool_use retourné");
  return toolUse.input as ClassifierOutput;
}

// Résolution déterministe : le plan est fixé par le registre, pas par le modèle.
function resolvePlan(c: ClassifierOutput) {
  const def = INTENT_REGISTRY[c.intent];
  const slots = c.slots ?? {};
  if (!def || c.confidence < CONFIDENCE_THRESHOLD) {
    return { ...FALLBACK_PLAN, slots, confidence: c.confidence, isFallback: true };
  }
  return { ...def, slots, confidence: c.confidence, isFallback: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "Configuration serveur manquante" }, 500);
  }

  // Validation d'entrée (garde-fou : borne la taille, refuse le vide).
  let message: unknown;
  try {
    ({ message } = await req.json());
  } catch {
    return jsonResponse({ error: "JSON invalide" }, 400);
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    return jsonResponse({ error: "'message' requis" }, 400);
  }
  if (message.length > 4000) {
    return jsonResponse({ error: "'message' trop long" }, 400);
  }

  try {
    const classification = await classify(message.trim());
    const plan = resolvePlan(classification);
    // Le plan part vers `copilot-chat`, qui exécutera plan.engines et fusionnera.
    return jsonResponse({ plan });
  } catch (err) {
    // Log sans fuiter le contenu utilisateur.
    console.error("copilot-router:", err instanceof Error ? err.message : "erreur");
    // Dégradé propre : on renvoie le fallback plutôt qu'une 500.
    return jsonResponse({
      plan: { ...FALLBACK_PLAN, slots: {}, confidence: 0, isFallback: true },
    });
  }
});