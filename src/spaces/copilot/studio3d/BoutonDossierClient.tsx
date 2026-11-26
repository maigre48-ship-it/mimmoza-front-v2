/**
 * VIS-60 — bouton UNIQUE « Préparer le dossier client » de l'Espace 3D.
 * Assemble dans le navigateur un ZIP : PDF de présentation (couverture, programme SDP/SHAB, planches, plans, QR codes
 * du film et de la visite 360°) + film MP4 + images HD + plans PDF/DXF/IFC + LISEZMOI. Aucun débit, aucune écriture.
 * S'ouvre aussi sur l'événement `mimmoza:dossier-client` (detail = conversationId) envoyé quand Mimmo le propose
 * dans le chat (outil copilot-chat `studio_dossier_client`).
 */
import { useCallback, useEffect, useState } from 'react';
import { etatDossier, collecterLivrables, type EtatDossier } from '@/lib/studio/dossierClient/dossierClientLogique';
import { lireTravauxDossier, preparerDossierClient, type ProgresDossier } from '@/lib/studio/dossierClient/preparerDossierClient';
import './DossierClient.css';

import { EVENEMENT_DOSSIER_CLIENT } from '@/lib/studio/dossierClient/evenement';
export { EVENEMENT_DOSSIER_CLIENT };

function telechargerBlob(blob: Blob, nom: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function BoutonDossierClient({ conversationId, titre, adresse }: { conversationId: string; titre: string; adresse?: string | null }) {
  const [etat, setEtat] = useState<EtatDossier | null>(null);
  const [progres, setProgres] = useState<ProgresDossier | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fini, setFini] = useState<string | null>(null);

  const relire = useCallback(async () => {
    try {
      const travaux = await lireTravauxDossier(conversationId);
      setEtat(etatDossier(travaux, collecterLivrables(travaux)));
    } catch { setEtat(null); }
  }, [conversationId]);

  useEffect(() => { void relire(); }, [relire]);

  const preparer = useCallback(async () => {
    if (progres) return; // un seul assemblage à la fois
    setErreur(null); setFini(null);
    try {
      const d = await preparerDossierClient({ conversationId, titre, adresse, surProgres: setProgres });
      telechargerBlob(d.blob, d.nomFichier);
      setFini(d.manquants.length ? `Dossier téléchargé. Non inclus : ${d.manquants.join(', ')}.` : 'Dossier téléchargé.');
      setEtat(d.etat);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Préparation impossible.');
    } finally {
      setProgres(null);
    }
  }, [adresse, conversationId, progres, titre]);

  // Mimmo propose le dossier dans le chat : le bouton se met en évidence (aucune préparation automatique).
  const [mis, setMis] = useState(false);
  useEffect(() => {
    const surDemande = (e: Event) => { if ((e as CustomEvent<string>).detail === conversationId) { setMis(true); void relire(); } };
    window.addEventListener(EVENEMENT_DOSSIER_CLIENT, surDemande);
    return () => window.removeEventListener(EVENEMENT_DOSSIER_CLIENT, surDemande);
  }, [conversationId, relire]);

  if (!etat || !etat.preparable) return null;
  const pourcent = progres && progres.total ? Math.round((progres.fait / progres.total) * 100) : 0;
  return (
    <section className="mz-dossier" aria-label="Dossier client">
      <p className="mz-dossier__titre">Dossier client</p>
      <p className="mz-dossier__phrase">{etat.phrase}</p>
      <button type="button" className={`mz-dossier__btn${mis ? ' is-actif' : ''}`} onClick={() => { void preparer(); }} disabled={!!progres}>
        {progres ? `${progres.etape}…` : 'Préparer le dossier client'}
      </button>
      {progres ? <div className="mz-dossier__barre" aria-hidden="true"><span style={{ width: `${pourcent}%` }} /></div> : null}
      {fini ? <p className="mz-dossier__note">{fini}</p> : null}
      {erreur ? <p className="mz-dossier__erreur">{erreur}</p> : null}
      <p className="mz-dossier__note">PDF de présentation + film, images HD et plans dans une archive ZIP. Aucun jeton débité.</p>
    </section>
  );
}

export default BoutonDossierClient;
