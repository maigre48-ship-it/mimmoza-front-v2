// src/spaces/copilot/studio3d/DemandePhotoMaison.tsx
// =============================================================================
// LOT X9 (17/11/2026) — « Envoyer une photo de ma maison ».
//
// Décision d'Albé : sans vraie photo de la maison, Mimmoza ne montre AUCUNE image d'extension et demande une photo.
// Ce bloc s'affiche (1) dans la carte de suivi d'un rendu d'extension terminé sans image, (2) sous la réponse de
// Mimmo quand le rendu n'a pas pu être lancé faute de photo. Il donne les consignes de prise de vue, propose
// « Ajuster le placement » quand la photo et le plan sont déposés, et ouvre l'envoi de la photo (consentement,
// EXIF, point de vue sur le plan : PhotoClientRue). La photo envoyée part dans un message du chat (bloc relu par
// le serveur) : Mimmo établit le devis de l'image, rien n'est lancé sans l'accord donné ensuite.
// =============================================================================
import { useState } from 'react';
import { Camera } from 'lucide-react';
import { PhotoClientRue } from './PhotoClientRue';
import { AtelierPlacement } from './AtelierPlacement';
import { messagePhotoMaison } from './choixFond';
import { lireFicheTravail, type PhotoClientOption, type TravailStudio } from '@/lib/studio/travaux';
import { CONSIGNES_PHOTO_MAISON, contourDeLaFiche, LIBELLE_ENVOYER_PHOTO, type PhotoRequise } from '@/lib/studio/photoReelle';
import type { LonLat } from '@/lib/studio/couverturePhotoRue';
import './ChoixFondImage.css';

export function DemandePhotoMaison({ requise, travail = null, contour = null, onSend, afficherTexte = false }: {
  requise: Pick<PhotoRequise, 'texte' | 'raison' | 'atelier'>;
  /** Travail terminé sans image (atelier et contour de la parcelle relus dans sa fiche) ; null sinon. */
  travail?: TravailStudio | null;
  /** Contour de la parcelle déjà connu (sortie de l'outil) ; sinon relu dans la fiche du travail. */
  contour?: LonLat[] | null;
  onSend?: (texte: string) => void;
  afficherTexte?: boolean;
}) {
  const [ouvert, setOuvert] = useState<{ contour: LonLat[] | null } | null>(null);
  const [lecture, setLecture] = useState(false);
  const [envoye, setEnvoye] = useState(false);

  const ouvrir = async () => {
    if (contour || !travail) { setOuvert({ contour }); return; }
    setLecture(true);
    let c: LonLat[] | null = null;
    try { c = contourDeLaFiche((await lireFicheTravail(travail.id))?.fiche); } catch { c = null; }
    setLecture(false);
    setOuvert({ contour: c });
  };
  const pret = (photo: PhotoClientOption) => {
    setOuvert(null);
    if (!onSend) return;
    onSend(messagePhotoMaison(photo));
    setEnvoye(true);
  };

  return (
    <div className="mz-fond-image" role="note" aria-label="Photo de votre maison">
      {afficherTexte && <p><strong>{requise.texte}</strong></p>}
      {requise.raison && <p className="mz-fond-image__note">Détail : {requise.raison}</p>}
      <p className="mz-fond-image__note">Pour que la photo soit utilisable :</p>
      <ul className="mz-photo-client__consignes">{CONSIGNES_PHOTO_MAISON.map((c) => <li key={c}>{c}</li>)}</ul>
      {requise.atelier && travail && <AtelierPlacement travail={travail} />}
      {envoye
        ? <p className="mz-fond-image__note">Photo envoyée : Mimmo prépare le devis de l’image ; rien n’est lancé sans votre accord.</p>
        : onSend
          ? <button type="button" className="mz-photo-client__bouton is-principal" onClick={() => void ouvrir()} disabled={lecture}>
            <Camera size={15} aria-hidden="true" /> {lecture ? 'Préparation…' : LIBELLE_ENVOYER_PHOTO}
          </button>
          : <p className="mz-fond-image__note">Écrivez à Mimmo « je veux envoyer une photo de ma maison ».</p>}
      {ouvert && <PhotoClientRue contour={ouvert.contour} onPret={pret} onFermer={() => setOuvert(null)}
        titre="Photo de votre maison" consignes={CONSIGNES_PHOTO_MAISON} libelleEnvoi="Envoyer la photo"
        introduction="Votre photo sert de fond à l’image de l’extension : rien n’est envoyé sans votre accord." />}
    </div>
  );
}
