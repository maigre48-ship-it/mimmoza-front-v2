// useSynchroModeleStudio.ts — R5 : le Bilan s'abonne au métré de Studio, sans clic
// ─────────────────────────────────────────────────────────────────────────────
// Chaque métré relié à l'étude est projeté en MassingMetrics et écrit par
// writeMassingMetrics : l'écouteur MASSING_METRICS_EVENT déjà présent dans la
// page met `massing` à jour, et tout le pro forma se recalcule (useMemo).
// Aucune hypothèse de prix ou de coût n'est touchée ici.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { MASSING_METRICS_EVENT, readMassingMetrics, writeMassingMetrics } from "../terrain3d/massingBilanBridge";
import { demanderLiaison, ecouterMetreStudio, envParDefaut, lireMetrePersistant } from "./canalMetreStudio";
import { metreConcerneEtude, metreVersMassing, plusRecent, type MetreStudioV2 } from "./metreStudio";
import { linkStudioBim, readStudioBimLink } from "./studioBimBridge";

export interface SynchroModeleStudio {
  /** Dernier métré Studio relié à l'étude (appliqué au bilan). */
  metre: MetreStudioV2 | null;
  /** Métré Studio reçu mais pas encore relié à une étude. */
  enAttente: MetreStudioV2 | null;
  /** Horodatage du métré actuellement retenu par le bilan (Studio ou Massing 3D). */
  majModeleLe: string | null;
  relier(m: MetreStudioV2): void;
  ignorer(): void;
}

export function useSynchroModeleStudio(studyId: string | null): SynchroModeleStudio {
  const [metre, setMetre] = useState<MetreStudioV2 | null>(null);
  const [enAttente, setEnAttente] = useState<MetreStudioV2 | null>(null);
  const [majModeleLe, setMajModeleLe] = useState<string | null>(null);
  const appliqueRef = useRef<string | null>(null);
  const ignoreRef = useRef<string | null>(null);

  const appliquer = useCallback((m: MetreStudioV2, ecrire: boolean) => {
    if (!studyId) return;
    setEnAttente(null);
    setMetre((prev) => (prev && prev.empreinte === m.empreinte && !plusRecent(m, prev) ? prev : m));
    const cle = `${m.architectureId}|${m.empreinte}`;
    if (ecrire && appliqueRef.current !== cle) {
      appliqueRef.current = cle;
      writeMassingMetrics(studyId, metreVersMassing(m));
    }
  }, [studyId]);

  useEffect(() => {
    setMetre(null); setEnAttente(null); appliqueRef.current = null;
    if (!studyId) { setMajModeleLe(null); return; }
    const env = envParDefaut();
    const recevoir = (m: MetreStudioV2): void => {
      if (metreConcerneEtude(m, studyId, readStudioBimLink())) { appliquer(m, true); return; }
      if (!m.etudeId && ignoreRef.current !== m.architectureId) setEnAttente((prev) => (plusRecent(m, prev) ? m : prev));
    };
    // Métré persistant : aucune expiration ; il n'écrase le bilan que s'il est plus récent que le métré retenu.
    const { etude, dernier } = lireMetrePersistant(studyId, env.stockage);
    if (etude) {
      const snap = readMassingMetrics(studyId);
      appliquer(etude, !snap || Date.parse(etude.emisLe) > Date.parse(snap.updatedAt));
    }
    if (dernier && dernier.empreinte !== etude?.empreinte) recevoir(dernier);
    const stop = ecouterMetreStudio(studyId, recevoir, env);
    const majSnap = (): void => setMajModeleLe(readMassingMetrics(studyId)?.updatedAt ?? null);
    majSnap();
    window.addEventListener(MASSING_METRICS_EVENT, majSnap);
    return () => { stop(); window.removeEventListener(MASSING_METRICS_EVENT, majSnap); };
  }, [studyId, appliquer]);

  const relier = useCallback((m: MetreStudioV2) => {
    if (!studyId) return;
    linkStudioBim(m.architectureId, studyId);
    demanderLiaison(studyId, m.architectureId);
    appliquer(m, true);
  }, [studyId, appliquer]);

  const ignorer = useCallback(() => {
    setEnAttente((prev) => { ignoreRef.current = prev?.architectureId ?? null; return null; });
  }, []);

  return { metre, enAttente, majModeleLe, relier, ignorer };
}
