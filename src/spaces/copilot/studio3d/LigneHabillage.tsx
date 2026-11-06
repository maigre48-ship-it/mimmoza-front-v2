// src/spaces/copilot/studio3d/LigneHabillage.tsx
// =============================================================================
// LOT BRIEF-UNIFIÉ (06/11/2026) — Ligne compacte du chat à la place de la carte
// « Brief créatif » complète. Décision d'Albé : le brief se fait à UN SEUL endroit,
// la section « Style et habillage » de l'Espace 3D (panneau de droite). Cette ligne
// ouvre le panneau sur cette section (et l'agrandit si besoin, voir CopilotChat).
//   - demande de Mimmo en suspens : « Choisir l'habillage → » (le panneau s'ouvre aussi de lui-même) ;
//   - brief envoyé après ce message : « Brief envoyé · récapitulatif » + « Modifier » ;
//   - sous un devis : « Habillage · récapitulatif » + « Modifier l'habillage → ».
// Logique dans briefCreatif.ts (briefEnvoyeApres, demandeDepassee, recapitulatif).
// =============================================================================
import { useMemo } from 'react';
import { ArrowRight, Palette } from 'lucide-react';
import { useCopilotStore } from '../store/copilotStore';
import { briefEnvoyeApres, demandeDepassee, etatInitial, recapitulatif, type DemandeBrief } from './briefCreatif';
import './CarteBriefCreatif.css';

export function LigneHabillage({ demande, messageId, onOuvrir }: {
  demande: DemandeBrief; messageId: string;
  /** Ouvre le panneau Espace 3D sur l'habillage, avec cette demande (type du rendu, brief connu). */
  onOuvrir: (demande: DemandeBrief) => void;
}) {
  const messages = useCopilotStore((s) => s.messages);
  const envoye = useMemo(() => briefEnvoyeApres(messages, messageId), [messages, messageId]);
  const depassee = useMemo(() => demandeDepassee(messages, messageId), [messages, messageId]);
  const recap = demande.actuel ? recapitulatif(etatInitial(demande).choix, demande) : null;
  const enAttente = demande.origine === 'demande' && !envoye && !depassee;
  return (
    <section className="mz-ligne-habillage" aria-label="Habillage du projet">
      <Palette size={16} aria-hidden="true" />
      <p>
        {envoye ? <><strong>Brief envoyé</strong> · {envoye}</>
          : enAttente ? <><strong>Habillage à choisir</strong>{recap ? <> · {recap}</> : ' · dans l’Espace 3D, à droite'}</>
            : <><strong>Habillage</strong>{recap ? <> · {recap}</> : ''}</>}
      </p>
      <button type="button" className={enAttente ? '' : 'is-leger'} onClick={() => onOuvrir(demande)}>
        {enAttente ? 'Choisir l’habillage' : 'Modifier l’habillage'} <ArrowRight size={14} aria-hidden="true" />
      </button>
    </section>
  );
}
