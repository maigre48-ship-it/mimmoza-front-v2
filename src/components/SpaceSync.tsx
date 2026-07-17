// src/components/SpaceSync.tsx
//
// Synchronise l'espace actif (currentSpace) en fonction du pathname courant.
// Déclenché à chaque changement de route pour que le header reflète toujours
// le bon espace, même lors d'une navigation directe par URL.

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// ── Type Space — doit rester en phase avec AppShell.tsx ──────────────────────
export type Space =
  | "none"
  | "promoteur"
  | "agence"
  | "marchand"
  | "banque"
  | "rehabilitation"
  | "mimmozia";

interface SpaceSyncProps {
  currentSpace: Space;
  setCurrentSpace: (space: Space) => void;
}

/**
 * SpaceSync
 *
 * Composant sans rendu dont le seul rôle est de déduire l'espace actif
 * depuis `location.pathname` et de mettre à jour `currentSpace` en conséquence.
 *
 * Règles de correspondance (ordre de priorité décroissante) :
 *   /rehabilitation   → "rehabilitation"
 *   /promoteur        → "promoteur"
 *   /marchand-de-bien → "marchand"
 *   /apporteur        → "agence"
 *   /mimmozia         → "mimmozia"
 *   /banque           → "banque"
 *   tout le reste     → "none"
 *
 * Les préfixes sont testés avec startsWith pour couvrir tous les sous-chemins.
 */
export function SpaceSync({ currentSpace, setCurrentSpace }: SpaceSyncProps): null {
  const location = useLocation();

  useEffect(() => {
    const pathname = location.pathname;

    let detected: Space = "none";

    if (pathname.startsWith("/rehabilitation")) {
      detected = "rehabilitation";
    } else if (pathname.startsWith("/promoteur")) {
      detected = "promoteur";
    } else if (pathname.startsWith("/marchand-de-bien")) {
      detected = "marchand";
    } else if (pathname.startsWith("/apporteur")) {
      detected = "agence";
    } else if (pathname.startsWith("/mimmozia")) {
      detected = "mimmozia";
    } else if (pathname.startsWith("/banque")) {
      detected = "banque";
    }

    // Mise à jour uniquement si l'espace a changé pour éviter les re-renders
    // inutiles sur les navigations internes à un même espace.
    if (detected !== currentSpace) {
      setCurrentSpace(detected);
    }
  }, [location.pathname, currentSpace, setCurrentSpace]);

  return null;
}