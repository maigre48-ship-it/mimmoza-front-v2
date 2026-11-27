// src/spaces/quartier/BoutonPageQuartier.tsx
// VIS-70 — bouton « Quartier et plan masse » de l'Espace 3D : ouvre la page Quartier de la conversation dans un nouvel
// onglet. Un seul bouton, une seule action. Branchement décrit dans le rapport VIS-70 (fichier de l'Espace 3D partagé).
import { adressePageQuartier } from '../../lib/quartier/navigationVente.ts';
import './CarteQuartierChat.css';

export function BoutonPageQuartier({ conversationId, libelle = 'Quartier et plan masse' }: { conversationId: string | null | undefined; libelle?: string }) {
  if (!conversationId) return null;
  return (
    <a className="mz-qrc__bouton" href={adressePageQuartier({ conversationId })} target="_blank" rel="noopener noreferrer"
      title="Vue aérienne du projet dans son quartier : transports, commerces, écoles, santé, loisirs, restaurants, emploi">
      {libelle}
    </a>
  );
}
