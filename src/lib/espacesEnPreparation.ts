// src/lib/espacesEnPreparation.ts
//
// Espaces et pages masqués tant qu'ils ne sont pas prêts (audit du
// 21/10/2026, P1 n°10). Le code est CONSERVÉ : passer une valeur à true
// rétablit la route et l'entrée de navigation correspondantes.
//
//   particulier      — 8 pages vides (projet, favoris, quartier…)
//   assurance        — 7 pages vides
//   banque           — hors build depuis la migration de types (_drafts/banque)
//   promoteurExports — /promoteur/exports, page sans contenu
//   apiDashboard     — /api/developer, alimenté par des données fictives
//                      (src/features/api/member/apiMemberMock.ts)

export const ESPACES_VISIBLES = {
  particulier: false,
  assurance: false,
  banque: false,
  promoteurExports: false,
  apiDashboard: false,
} as const;
