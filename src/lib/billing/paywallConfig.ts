// src/lib/billing/paywallConfig.ts
// Configuration centrale du paywall par espace.
// Un seul endroit pour le cout en jetons + le perimetre (routes protegees),
// afin qu'un futur ecran admin puisse l'ajuster sans toucher au code metier.

import type { ProjectSpace } from "./projectUnlock";

export type SpacePaywallConfig = {
  enabled: boolean;
  tokenCost: number;
  /** Validite du deverrouillage en jours (re-paiement au-dela). */
  validityDays: number;
  /** Prefixes de routes proteges (une route protegee commence par l'un d'eux). */
  protectedRoutePrefixes: string[];
  /** Routes exemptees (prioritaire sur protectedRoutePrefixes). */
  freeRoutePrefixes: string[];
  /** Liste d'acces affichee dans la modal. */
  features: string[];
};

// ─── Config par defaut ──────────────────────────────────────────────────────────
// Promoteur : tout /promoteur/* protege SAUF l'onglet Opportunites (routes ci-dessous).

export const DEFAULT_PAYWALL_CONFIG: Record<ProjectSpace, SpacePaywallConfig> = {
  promoteur: {
    enabled: true,
    tokenCost: 1,
    validityDays: 30,
    protectedRoutePrefixes: ["/promoteur/"],
    // PATCH Modèle A — SOURCE DE VÉRITÉ = le guard <PromoteurStudyRequired> dans
    // src/App.tsx. Cette liste DOIT refléter EXACTEMENT les routes /promoteur/*
    // laissées HORS de ce guard (routes libres). Si tu ajoutes/retires une route
    // du guard dans App.tsx, mets à jour cette liste (et inversement), sinon
    // AppShell.handleProtectedNavigate et le guard divergeront.
    freeRoutePrefixes: [
      "/promoteur/veille",
      "/promoteur/nouvelle-opportunite",
      "/promoteur/opportunites/nouvelle",
      "/promoteur/recherche-contacts",
      "/promoteur/permis-construire",
      "/promoteur/opportunites-apporteurs",
      "/promoteur/plu-faisabilite", // redirection -> /promoteur/foncier
      "/promoteur/faisabilite",     // redirection -> /promoteur/foncier
    ],
    features: ["Pre-analyse PLU", "Faisabilite (2D/3D)", "Marche & DVF", "Bilan promoteur", "Synthese comite"],
  },
  rehabilitation: {
    // Active plus tard. Laisse false pour l'instant (cf decision : promoteur d'abord).
    enabled: false,
    tokenCost: 1,
    validityDays: 30,
    protectedRoutePrefixes: ["/rehabilitation/"],
    freeRoutePrefixes: ["/rehabilitation/projets"],
    features: ["Analyse de plan", "Conformite ERP/PMR", "Travaux", "Valorisation"],
  },
  apporteur: {
    enabled: false,
    tokenCost: 1,
    validityDays: 30,
    protectedRoutePrefixes: [],
    freeRoutePrefixes: [],
    features: ["Acces complet au deal"],
  },
  marchand: {
    // Gere par le chemin existant (dealUnlock + DealUnlockModal). Ne pas doubler.
    enabled: false,
    tokenCost: 1,
    validityDays: 30,
    protectedRoutePrefixes: [],
    freeRoutePrefixes: [],
    features: ["Sourcing", "Execution", "Analyse"],
  },
};

// ─── Surcharges admin (placeholder pour V2) ─────────────────────────────────────

let cachedConfig: Record<ProjectSpace, SpacePaywallConfig> | null = null;

export function getPaywallConfig(): Record<ProjectSpace, SpacePaywallConfig> {
  return cachedConfig ?? DEFAULT_PAYWALL_CONFIG;
}

export function getSpacePaywallConfig(space: ProjectSpace): SpacePaywallConfig {
  return getPaywallConfig()[space];
}

export function setPaywallConfigOverrides(
  overrides: Partial<Record<ProjectSpace, Partial<SpacePaywallConfig>>>
): void {
  const merged = { ...DEFAULT_PAYWALL_CONFIG };
  (Object.keys(overrides) as ProjectSpace[]).forEach((space) => {
    merged[space] = { ...merged[space], ...overrides[space] };
  });
  cachedConfig = merged;
}

// ─── Helper : une route est-elle protegee pour cet espace ? ─────────────────────

export function isRouteProtected(space: ProjectSpace, path: string): boolean {
  const cfg = getSpacePaywallConfig(space);
  if (!cfg.enabled) return false;

  // path peut contenir une query string : on ne teste que le pathname
  const pathname = path.split("?")[0];

  if (cfg.freeRoutePrefixes.some((p) => pathname.startsWith(p))) return false;
  return cfg.protectedRoutePrefixes.some((p) => pathname.startsWith(p));
}