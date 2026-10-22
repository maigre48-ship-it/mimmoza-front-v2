// src/spaces/copilot/onboarding/reserve.ts
// =============================================================================
// Lecture SYNCHRONE du dernier affichage connu du premier contact, pour réserver
// la place de l'encart avant son chargement différé (pas de saut de mise en page).
//   'encart'    → encart + checklist la dernière fois (ou première visite sur ce navigateur)
//   'checklist' → checklist compacte seule
//   'rien'      → rien à réserver
// =============================================================================

import { userStorage } from '@/lib/storage/userScopedStorage';

export type AffichagePremierContact = 'encart' | 'checklist' | 'rien';

export const CLE_AFFICHAGE = 'mzia.onboarding.affichage';

export function affichageMemorise(): AffichagePremierContact {
  const v = userStorage.getItem(CLE_AFFICHAGE);
  return v === 'checklist' || v === 'rien' ? v : 'encart';
}

export function memoriserAffichage(a: AffichagePremierContact): void {
  userStorage.setItem(CLE_AFFICHAGE, a);
}
