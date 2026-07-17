// src/spaces/copilot/store/activeCopilotContext.store.ts
// PATCH V1.1 : ajout de ActiveDealRef et PageContextRef dans le snapshot
// PATCH V1.2 : ajout de pageSnapshot (snapshot libre par page)
// PATCH V1.3 : ajout de risk_study (etude de risques deja calculee — LOT 9)
// PATCH V1.4 : ajout de studyId + implantation_2d (contexte etude promoteur)
// PATCH V1.5 : ajout de plu (regles extraites par le parser — tool get_parcel_plu)
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand';

// ─── Nouveaux types V1.1 ──────────────────────────────────────────────────────

export interface ActiveDealRef {
  id: string;
  title?: string;
  address?: string;
  parcelId?: string | null;
  surface?: number | null;
  purchasePrice?: number | null;
  resalePrice?: number | null;
  worksBudget?: number | null;
  status?: string;
}

export interface PageContextRef {
  pathname: string;
  space?: string;   // 'marchand' | 'investisseur' | 'promoteur' | ...
  mode?: string;    // 'acquisition' | 'execution' | 'analyse' | 'conception'
  tab?: string;     // 'pipeline' | 'simulation' | 'travaux' | 'implantation' | ...
}

// ─── V1.5 — PLU extrait par le parser ─────────────────────────────────────────
// Meme contrat que MimmozaContext.plu cote copilot-chat : le tool get_parcel_plu
// lit ctx.plu et le resume via summarizePluContext. SANS ce champ, le tool repond
// « reglement non importe » alors que le PLU est bien en base (study.plu).
export interface ActivePluRef {
  zone_code?: string;
  zone_libelle?: string;
  source?: string;
  ruleset?: Record<string, unknown> | null;
  oap?: Record<string, unknown> | null;
}

// ─── Type snapshot ─────────────────────────────────────────────────────────────
export interface ActiveCopilotSnapshot {
  activeListingId?: string;
  listingUrl?: string;
  city?: string;
  zipCode?: string;
  price?: number;
  surface?: number;
  propertyType?: string;
  parcelId?: string;
  route?: string;
  vertical?:
    | 'investisseur'
    | 'marchand'
    | 'promoteur'
    | 'apporteur'
    | 'particulier'
    | 'generique';
  // ── Travaux (simulateur) ─────────────────────────────────
  renovation_cost_total?: number;
  renovation_cost_per_m2?: number;
  renovation_level?: string;
  renovation_gamme?: string;
  // ── V1.1 — Deal actif et contexte de page ───────────────
  activeDeal?: ActiveDealRef;
  pageContext?: PageContextRef;
  // ── V1.2 — Snapshot libre par page (ex : valorisation rehabilitation) ──
  // Transmis tel quel au LLM via le spread du contexte. Cle/valeur lisibles.
  pageSnapshot?: Record<string, string | number | null>;
  // ── V1.3 — Etude de risques deja calculee (LOT 9) ───────
  // Resultat brut risk-study (meta/scores/data/categories/insights) pousse par
  // la page Risques. Injecte dans le system prompt de copilot-chat → le Copilot
  // repond aux questions de risques SANS appeler d'outil et sans halluciner.
  risk_study?: Record<string, unknown>;
  // ── V1.4 — Etude promoteur active ────────────────────────
  // UUID de l'etude courante (param d'URL ?study=). TOUJOURS valider le format
  // uuid avant de pousser : un slug non-uuid fait echouer l'insert conversations.
  // null = etude non identifiable (demo, param absent ou invalide).
  studyId?: string | null;
  // ── V1.4 — Snapshot de l'implantation 2D en cours ────────
  // Etat du canvas (batiments, emprise, surfaces, reculs PLU, cotes) pousse par
  // Implantation2DPage. Injecte dans le system prompt → le Copilot repond sur
  // l'implantation reellement dessinee et non sur une parcelle generique.
  implantation_2d?: Record<string, unknown>;
  // ── V1.5 — PLU extrait par le parser (study.plu) ─────────
  // Source de verite du tool get_parcel_plu. A pousser par toute page qui
  // dispose du reglement (Foncier/PLU, Implantation 2D, Programmation…).
  plu?: ActivePluRef | null;
}

// ─── Interface store ───────────────────────────────────────────────────────────
export interface ActiveCopilotContextState extends ActiveCopilotSnapshot {
  setActiveCopilotContext: (partial: Partial<ActiveCopilotSnapshot>) => void;
  clearActiveCopilotContext: () => void;
  getActiveCopilotContext: () => ActiveCopilotSnapshot;
}

const INITIAL_STATE: ActiveCopilotSnapshot = {
  activeListingId:        undefined,
  listingUrl:             undefined,
  city:                   undefined,
  zipCode:                undefined,
  price:                  undefined,
  surface:                undefined,
  propertyType:           undefined,
  parcelId:               undefined,
  route:                  undefined,
  vertical:               undefined,
  renovation_cost_total:  undefined,
  renovation_cost_per_m2: undefined,
  renovation_level:       undefined,
  renovation_gamme:       undefined,
  // V1.1
  activeDeal:             undefined,
  pageContext:            undefined,
  // V1.2
  pageSnapshot:           undefined,
  // V1.3
  risk_study:             undefined,
  // V1.4
  studyId:                undefined,
  implantation_2d:        undefined,
  // V1.5
  plu:                    undefined,
};

export const useActiveCopilotContext = create<ActiveCopilotContextState>(
  (set, get) => ({
    ...INITIAL_STATE,

    setActiveCopilotContext(partial) {
      set((prev) => ({ ...prev, ...partial }));
    },

    clearActiveCopilotContext() {
      set(INITIAL_STATE);
    },

    getActiveCopilotContext(): ActiveCopilotSnapshot {
      const {
        setActiveCopilotContext,
        clearActiveCopilotContext,
        getActiveCopilotContext,
        ...rest
      } = get();
      return rest;
    },
  }),
);

// ─── Singletons fonctionnels (utilisables hors composant React) ───────────────
export function setActiveCopilotContext(partial: Partial<ActiveCopilotSnapshot>): void {
  useActiveCopilotContext.getState().setActiveCopilotContext(partial);
}

export function clearActiveCopilotContext(): void {
  useActiveCopilotContext.getState().clearActiveCopilotContext();
}

export function getActiveCopilotContext(): ActiveCopilotSnapshot {
  return useActiveCopilotContext.getState().getActiveCopilotContext();
}

export function hasActiveListing(): boolean {
  const ctx = getActiveCopilotContext();
  return !!(
    ctx.activeListingId ||
    ctx.listingUrl ||
    (ctx.city && ctx.price && ctx.surface)
  );
}

/** V1.1 — Retourne true si un deal est actif dans le contexte courant */
export function hasActiveDeal(): boolean {
  const ctx = getActiveCopilotContext();
  return !!(ctx.activeDeal?.id);
}

// ─── V1.4 — Helpers etude ─────────────────────────────────────────────────────

/** Format uuid v1-v5 canonique. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Normalise un identifiant d'etude issu d'un param d'URL.
 * Retourne l'uuid si valide, sinon null — evite l'erreur Postgres
 * « invalid input syntax for type uuid » a l'insert de la conversation.
 */
export function normalizeStudyId(raw: string | null | undefined): string | null {
  return raw && UUID_RE.test(raw) ? raw : null;
}

/** V1.4 — Retourne true si une etude identifiable est active. */
export function hasActiveStudy(): boolean {
  return !!getActiveCopilotContext().studyId;
}

// ─── V1.5 — Helpers PLU ───────────────────────────────────────────────────────

/**
 * V1.5 — Retourne true si un PLU exploitable est present dans le contexte.
 * Meme critere que toolParcelPlu cote copilot-chat : zone_code OU ruleset OU oap.
 */
export function hasActivePlu(): boolean {
  const plu = getActiveCopilotContext().plu;
  return !!(plu && (plu.zone_code || plu.ruleset || plu.oap));
}

/**
 * V1.5 — Normalise study.plu (jsonb brut) vers le contrat ActivePluRef.
 * Evite de dupliquer le mapping dans chaque page qui publie le contexte.
 */
export function toActivePluRef(studyPlu: unknown): ActivePluRef | null {
  if (!studyPlu || typeof studyPlu !== 'object') return null;
  const p = studyPlu as Record<string, unknown>;
  const ref: ActivePluRef = {
    zone_code:    typeof p.zone_code    === 'string' ? p.zone_code    : undefined,
    zone_libelle: typeof p.zone_libelle === 'string' ? p.zone_libelle : undefined,
    source:       typeof p.source       === 'string' ? p.source       : 'plu-parser',
    ruleset:      (p.ruleset as Record<string, unknown> | undefined) ?? null,
    oap:          (p.oap     as Record<string, unknown> | undefined) ?? null,
  };
  // Rien d'exploitable → null (le tool dira franchement « non importe »).
  if (!ref.zone_code && !ref.ruleset && !ref.oap) return null;
  return ref;
}