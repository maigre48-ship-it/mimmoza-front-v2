// src/components/SpaceSync.tsx
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export type Space =
  | "none"
  | "audit"
  | "promoteur"
  | "agence"
  | "marchand"
  | "banque"
  | "assurance";

type SpaceSyncProps = {
  setCurrentSpace: (space: Space) => void;
};

/**
 * SpaceSync
 * Synchronise currentSpace avec l’URL courante
 * (aucun rendu visuel)
 */
export function SpaceSync({ setCurrentSpace }: SpaceSyncProps) {
  const location = useLocation();

  useEffect(() => {
    const p = location.pathname || "/";

    const next: Space =
      p.startsWith("/promoteur") ? "promoteur" :
      p.startsWith("/particulier") ? "agence" :
      p.startsWith("/agence") ? "agence" :
      p.startsWith("/marchand-de-bien") ? "marchand" :
      p.startsWith("/marchand") ? "marchand" :
      p.startsWith("/banque") ? "banque" :
      p.startsWith("/assurance") ? "assurance" :
      p.startsWith("/audit") ? "audit" :
      "none";

    setCurrentSpace(next);
  }, [location.pathname, setCurrentSpace]);

  return null;
}
