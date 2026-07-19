// src/lib/billing/pricingPolicy.ts
//
// Cœur économique du modèle "débit variable" (façon Base44).
// Règle d'or : on débite TOUJOURS le coût API réel × marge, jamais un forfait.
// Conséquence : aucun dépassement de facturation possible, profit garanti
// à chaque requête par construction.
//
// Le débit RÉEL se calcule côté serveur (copilot-chat), APRÈS l'appel, à partir
// du bloc `usage` renvoyé par l'API Anthropic (input_tokens / output_tokens).
// Ne jamais calculer le débit côté client : il serait falsifiable.

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTES ÉCONOMIQUES — les SEULS nombres à ajuster
// ─────────────────────────────────────────────────────────────────────────

/** 1 jeton = 10 centimes d'euro. */
export const JETON_VALUE_EUR = 0.10;

/** Marge cible sur le coût API. ×3 => on encaisse 3× ce que la requête coûte. */
export const MARGIN = 3;

/**
 * Taux USD→EUR volontairement prudent (surestime légèrement le coût, donc
 * la marge réelle est toujours >= marge affichée). À réviser si l'euro bouge.
 */
export const USD_TO_EUR = 0.95;

/**
 * Tarifs API Anthropic, en USD par MILLION de tokens (entrée / sortie).
 * ⚠️ À vérifier périodiquement : https://www.anthropic.com/pricing
 * (valeurs de référence : Haiku 4.5 = 1/5, Sonnet 5 = 3/15, Opus 4.8 = 5/25)
 */
export const MODEL_RATES = {
  haiku:  { in: 1, out: 5  },
  sonnet: { in: 3, out: 15 },
  opus:   { in: 5, out: 25 },
} as const;

export type ModelId = keyof typeof MODEL_RATES;
export type Plan = "basic" | "advanced" | "pro";

// ─────────────────────────────────────────────────────────────────────────
// ACCÈS — plan → modèles autorisés + déverrouillage des modules Expert
// ─────────────────────────────────────────────────────────────────────────

export const PLAN_POLICY: Record<Plan, {
  models: ModelId[];        // modèles que ce plan peut utiliser
  defaultModel: ModelId;    // modèle appliqué si l'utilisateur ne choisit pas
  unlockAllTabs: boolean;   // Pro déverrouille tous les onglets Expert
}> = {
  basic:    { models: ["haiku"],          defaultModel: "haiku",  unlockAllTabs: false },
  advanced: { models: ["sonnet"],         defaultModel: "sonnet", unlockAllTabs: false },
  pro:      { models: ["sonnet", "opus"], defaultModel: "sonnet", unlockAllTabs: true  },
};

/** Le plan a-t-il le droit d'utiliser ce modèle ? */
export function canUseModel(plan: Plan, model: ModelId): boolean {
  return PLAN_POLICY[plan].models.includes(model);
}

/**
 * Résout le modèle effectif : respecte le choix de l'utilisateur (ex. un Pro
 * qui demande Opus), mais le borne toujours à ce que son plan autorise.
 */
export function resolveModel(plan: Plan, requested?: ModelId): ModelId {
  const policy = PLAN_POLICY[plan];
  if (requested && policy.models.includes(requested)) return requested;
  return policy.defaultModel;
}

/** Pro déverrouille tous les onglets Expert. */
export function unlocksAllTabs(plan: Plan): boolean {
  return PLAN_POLICY[plan].unlockAllTabs;
}

// ─────────────────────────────────────────────────────────────────────────
// COÛT & DÉBIT
// ─────────────────────────────────────────────────────────────────────────

/** Coût API brut d'un appel, en euros, à partir de l'usage réel de tokens. */
export function apiCostEur(model: ModelId, inputTokens: number, outputTokens: number): number {
  const r = MODEL_RATES[model];
  const usd = (inputTokens * r.in + outputTokens * r.out) / 1_000_000;
  return usd * USD_TO_EUR;
}

/**
 * Débit en jetons = coût réel × marge, converti en jetons, arrondi au supérieur.
 * Toujours >= 1 : on n'offre jamais une requête facturable.
 * À appeler APRÈS l'appel API, avec le `usage` réel.
 */
export function debitJetons(model: ModelId, inputTokens: number, outputTokens: number): number {
  const cost = apiCostEur(model, inputTokens, outputTokens);
  return Math.max(1, Math.ceil((cost * MARGIN) / JETON_VALUE_EUR));
}

/**
 * Pré-appel : débit du PIRE cas (sortie = max_tokens), pour vérifier que le
 * solde couvre la requête AVANT de la lancer. On ne laisse jamais partir un
 * appel que l'utilisateur ne pourrait pas payer.
 */
export function worstCaseJetons(model: ModelId, estInputTokens: number, maxTokens: number): number {
  return debitJetons(model, estInputTokens, maxTokens);
}

// ─────────────────────────────────────────────────────────────────────────
// SÉQUENCE D'USAGE (côté copilot-chat)
// ─────────────────────────────────────────────────────────────────────────
//
//   const model = resolveModel(plan, requestedModel);
//   const worst = worstCaseJetons(model, estInput, MAX_TOKENS);
//   if (solde < worst) => refuser / proposer un pack de jetons.
//
//   const res = await anthropic.messages.create({ model, max_tokens: MAX_TOKENS, ... });
//
//   const { input_tokens, output_tokens } = res.usage;
//   const debit = debitJetons(model, input_tokens, output_tokens); // <= worst
//   await ledger.debit(userId, debit);
//
// L'asymétrie worst-case (gate) / réel (débit) est la garantie :
// jamais d'appel impayable, jamais de surfacturation.