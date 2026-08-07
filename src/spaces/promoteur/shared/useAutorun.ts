// ============================================================================
// `?autorun=1` — exécution d'une étape déclenchée par le copilote.
//
// L'outil `action_lancer_etape` ne calcule rien : il ouvre la page de l'étape
// avec `?autorun=1`. Ce hook est la moitié manquante — sans lui, le chat amène
// l'utilisateur au bon endroit et le laisse cliquer.
//
// Trois garde-fous, chacun pour une raison précise :
//
// 1. `ready` — on ne lance pas tant que la page n'a pas chargé ses entrées.
//    Lancer une analyse de marché avant que la parcelle soit connue produit
//    une erreur, pas un résultat.
// 2. Un ref — dans le cycle de vie React (StrictMode, re-rendus), l'effet peut
//    repasser plusieurs fois. Une étape ne se lance qu'une fois par montage.
// 3. `sessionStorage` — le paramètre `autorun` reste dans l'URL, volontairement :
//    c'est lui qui renseigne la provenance `agent` au moment de l'écriture.
//    Conséquence, un simple F5 relancerait le calcul (et le coût qui va avec).
//    On mémorise donc le déclenchement par étude et par étape.
// ============================================================================

import { useEffect, useRef } from 'react';

import { isAgentRun, type PromoteurStep } from './promoteurChain';

interface UseAutorunOptions {
  /** Étape concernée — sert à ne pas rejouer le même autorun après un refresh. */
  step: PromoteurStep;
  studyId: string | null;
  /** La page a-t-elle de quoi calculer ? Tant que c'est faux, on attend. */
  ready: boolean;
  /** Le calcul de la page. Exactement celui du bouton — pas une copie. */
  run: () => void | Promise<void>;
  /** Coupe le mécanisme (ex. un résultat est déjà affiché). */
  skip?: boolean;
}

function autorunKey(studyId: string | null, step: PromoteurStep): string {
  return `mimmoza.autorun.${studyId ?? 'nostudy'}.${step}`;
}

function alreadyFired(studyId: string | null, step: PromoteurStep): boolean {
  try {
    return sessionStorage.getItem(autorunKey(studyId, step)) === '1';
  } catch {
    return false;
  }
}

function markFired(studyId: string | null, step: PromoteurStep): void {
  try {
    sessionStorage.setItem(autorunKey(studyId, step), '1');
  } catch {
    /* sessionStorage indisponible : on retombe sur le seul garde-fou du ref. */
  }
}

/**
 * L'URL porte aussi `step` : c'est l'étape que le copilote a demandée.
 * Sans cette vérification, toute page montée pendant qu'un `?autorun=1` traîne
 * dans l'URL se lancerait — le cas concret étant la synthèse, rendue en onglet
 * à l'intérieur du bilan : ouvrir le bilan en autorun puis cliquer sur l'onglet
 * « Synthèse » déclencherait une génération de PDF que personne n'a demandée.
 * Si `step` est absent (URL construite à la main), on ne bloque pas.
 */
function isTargetStep(step: PromoteurStep): boolean {
  try {
    const asked = new URLSearchParams(window.location.search).get('step');
    return asked === null || asked === step;
  } catch {
    return false;
  }
}

export function useAutorun({ step, studyId, ready, run, skip }: UseAutorunOptions): void {
  const firedRef = useRef(false);
  const runRef = useRef(run);

  // L'écriture d'un ref pendant le rendu est interdite (react-hooks/refs) :
  // on synchronise après le rendu.
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    if (firedRef.current) return;
    if (skip) return;
    if (!isAgentRun()) return;
    if (!isTargetStep(step)) return;
    if (!ready) return;
    if (alreadyFired(studyId, step)) return;

    firedRef.current = true;
    markFired(studyId, step);

    void Promise.resolve()
      .then(() => runRef.current())
      .catch((e) => console.error(`[autorun:${step}] échec`, e));
  }, [step, studyId, ready, skip]);
}

/** Repart de zéro pour une étude — utile après un « recalculer » manuel. */
export function resetAutorun(studyId: string | null, step: PromoteurStep): void {
  try {
    sessionStorage.removeItem(autorunKey(studyId, step));
  } catch {
    /* rien à faire */
  }
}
