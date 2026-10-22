// src/spaces/copilot/onboarding/useSuiviExportPdf.ts
// =============================================================================
// Constate un export PDF réel (clic sur un bouton d'export PDF de MimmozIA) pour
// cocher l'étape « Exporter un rapport en PDF » de la checklist.
//
// Les boutons d'export vivent hors de cette zone (CopilotMessage.tsx,
// ParcelDecisionDossier.tsx) et n'émettent encore aucun événement : on écoute
// les clics en phase de capture sur leurs libellés accessibles. Quand ces
// composants appelleront `track('report_download', { format: 'pdf' })`
// eux-mêmes, ce hook pourra être retiré (la checklist lit aussi user_events).
// Module léger : la couche données n'est chargée qu'au premier export.
// =============================================================================

import { useEffect } from 'react';

const SELECTEUR_EXPORT_PDF = [
  'button[aria-label="Exporter cette réponse en PDF"]',
  'button[title="Exporter la conversation en PDF"]',
].join(',');

function estBoutonExportPdf(cible: EventTarget | null): boolean {
  if (!(cible instanceof Element)) return false;
  const bouton = cible.closest('button');
  if (!bouton || bouton.disabled) return false;
  if (bouton.matches(SELECTEUR_EXPORT_PDF)) return true;
  return /exporter le dossier pdf/i.test(bouton.textContent ?? '');
}

export function useSuiviExportPdf(): void {
  useEffect(() => {
    let fait = false;
    const surClic = (e: MouseEvent) => {
      if (fait || !estBoutonExportPdf(e.target)) return;
      fait = true;
      void import('./onboardingDonnees').then((m) => m.marquerEtape('export_pdf')).catch(() => { fait = false; });
    };
    document.addEventListener('click', surClic, true);
    return () => document.removeEventListener('click', surClic, true);
  }, []);
}
