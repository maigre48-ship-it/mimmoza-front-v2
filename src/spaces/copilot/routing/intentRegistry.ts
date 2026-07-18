// intentRegistry.ts
// Registre d'intentions de MimmozIA (côté frontend).
// Le modèle ne "décide" jamais librement des moteurs : il classe une intention
// + extrait des slots, puis CE code résout un plan déterministe contre ce registre.
// La même table est dupliquée (volontairement) dans la fonction Edge `copilot-router`,
// parce que ton déploiement Edge est en copier-coller sans CLI. Garde les deux en phase.

export type EngineId =
  | "parcelle"
  | "plu"
  | "dvf"
  | "georisques"
  | "sitadel"
  | "merimee"
  | "smartscore"
  | "doc_parser";

export type Vertical =
  | "promoteur"
  | "investisseur"
  | "rehabilitation"
  | "apporteur"
  | "banque"
  | "generic";

export type OutputKind =
  | "synthese"     // lecture rapide multi-sources
  | "envelope"     // enveloppe constructible (faisabilité PLU)
  | "estimation"   // valorisation d'un bien / d'une opération
  | "rentabilite"  // calcul de rentabilité
  | "explication"; // pédagogie sur un document (DPE, PLU…)

export type IntentSlots = {
  address?: string;
  parcelle?: string;
  documentId?: string;
};

// Une entrée du registre : tout est fixé par TOI, pas par le modèle.
export type IntentDefinition = {
  intent: string;
  vertical: Vertical;
  engines: EngineId[];
  output: OutputKind;
  deeplink?: string;         // module Expert proposé en fin de parcours
  costMode: "quick" | "advanced" | "report"; // mappe sur ton ledger de jetons
};

// Plan résolu = définition + slots extraits du message.
export type ResolvedPlan = IntentDefinition & {
  slots: IntentSlots;
  confidence: number;
  isFallback: boolean;
};

// Les intentions maîtrisées jour 1. N'en ajoute une que quand les moteurs
// derrière sont réellement prêts à être orchestrés.
export const INTENT_REGISTRY: Record<string, IntentDefinition> = {
  analyse_adresse: {
    intent: "analyse_adresse",
    vertical: "generic",
    engines: ["parcelle", "dvf", "georisques", "smartscore"],
    output: "synthese",
    costMode: "quick",
  },
  faisabilite_plu: {
    intent: "faisabilite_plu",
    vertical: "promoteur",
    engines: ["plu", "sitadel", "smartscore"],
    output: "envelope",
    deeplink: "/promoteur/implantation",
    costMode: "advanced",
  },
  estimation_bien: {
    intent: "estimation_bien",
    vertical: "investisseur",
    engines: ["dvf", "smartscore"],
    output: "estimation",
    deeplink: "/investisseur/analyse",
    costMode: "advanced",
  },
  rentabilite_operation: {
    intent: "rentabilite_operation",
    vertical: "investisseur",
    engines: ["dvf", "smartscore"],
    output: "rentabilite",
    deeplink: "/investisseur/rentabilite",
    costMode: "advanced",
  },
  explication_document: {
    intent: "explication_document",
    vertical: "generic",
    engines: ["doc_parser"],
    output: "explication",
    costMode: "quick",
  },
};

// Plan de repli : intention inconnue ou confiance trop basse.
// MimmozIA répond en langage naturel et propose d'ouvrir le mode Expert.
export const FALLBACK_PLAN: IntentDefinition = {
  intent: "fallback",
  vertical: "generic",
  engines: [],
  output: "explication",
  costMode: "quick",
};

const CONFIDENCE_THRESHOLD = 0.55;

// Résolution déterministe : c'est ici, pas dans le modèle, que le plan est fixé.
export function resolvePlan(
  intent: string,
  slots: IntentSlots,
  confidence: number,
): ResolvedPlan {
  const def = INTENT_REGISTRY[intent];
  if (!def || confidence < CONFIDENCE_THRESHOLD) {
    return { ...FALLBACK_PLAN, slots, confidence, isFallback: true };
  }
  return { ...def, slots, confidence, isFallback: false };
}