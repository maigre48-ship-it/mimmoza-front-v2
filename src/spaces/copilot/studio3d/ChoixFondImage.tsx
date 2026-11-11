// src/spaces/copilot/studio3d/ChoixFondImage.tsx
// =============================================================================
// LOT P2 (11/11/2026) — carte « Fond de l'image » sous le devis d'une image (contrat agents-1111/CONTRAT-PHOTO-RUE.md).
//
// Trois choix, selon la couverture vérifiée par le serveur au moment du devis :
//   · « Photo de la rue (Panoramax / IGN) » — seulement s'il existe des photos sous Licence Ouverte à 60 m au plus ;
//   · « Votre photo du trottoir » — consentement, consignes, EXIF, point de vue sur le plan, envoi du fichier d'origine ;
//   · « Étude seule ».
// Un choix envoie un message au chat (bloc relu par le serveur) : Mimmo établit le NOUVEAU devis, l'utilisateur
// donne son accord ensuite. Rien n'est lancé depuis cette carte. Logique pure : choixFond.ts.
// =============================================================================
import { useMemo, useState } from 'react';
import { Image as IconeImage, RefreshCw } from 'lucide-react';
import { useCopilotStore } from '../store/copilotStore';
import { demandeDepassee, type DemandeBrief } from './briefCreatif';
import { lireDevisFond, messageFond, tuilesFond } from './choixFond';
import { PhotoClientRue } from './PhotoClientRue';
import { demanderCouverturePhotoRue, LIBELLES_FOND, type PhotoClientOption } from '@/lib/studio/travaux';
import { phraseCouverture, type CouverturePhotoRue } from '@/lib/studio/couverturePhotoRue';
import './CarteBriefCreatif.css';

export function ChoixFondImage({ call, demande, messageId, onSend }: {
  call: { name: string; status?: string; output?: unknown };
  demande: DemandeBrief;
  messageId: string;
  onSend?: (texte: string) => void;
}) {
  const devis = useMemo(() => lireDevisFond(call), [call]);
  const messages = useCopilotStore((s) => s.messages);
  const depasse = useMemo(() => demandeDepassee(messages, messageId), [messages, messageId]);
  const [photoOuverte, setPhotoOuverte] = useState(false);
  const [couverture, setCouverture] = useState<CouverturePhotoRue | null>(null);
  const [verification, setVerification] = useState<{ enCours: boolean; erreur: string }>({ enCours: false, erreur: '' });
  const [envoye, setEnvoye] = useState<string | null>(null);
  if (!devis) return null;
  const d = couverture ? { ...devis, couverture, raisonCouverture: null } : devis;
  if (depasse || envoye) {
    return (
      <section className="mz-ligne-habillage" aria-label="Fond de l’image">
        <IconeImage size={16} aria-hidden="true" />
        <p><strong>Fond de l’image</strong> · {envoye ?? LIBELLES_FOND[d.choisi]}</p>
      </section>
    );
  }
  const envoyer = (texte: string | null, libelle: string) => {
    if (!onSend || !texte) return;
    onSend(texte);
    setEnvoye(libelle);
  };
  const choisirRue = () => envoyer(messageFond(demande, { fond: 'photo_rue' }), LIBELLES_FOND.photo_rue);
  const choisirEtude = () => envoyer(messageFond(demande, { fond: 'etude' }), LIBELLES_FOND.etude);
  const photoPrete = (photo: PhotoClientOption) => {
    setPhotoOuverte(false);
    envoyer(messageFond(demande, { fond: 'photo_client', photo_client: photo }), LIBELLES_FOND.photo_client);
  };
  const verifier = async () => {
    if (!d.contour) return;
    setVerification({ enCours: true, erreur: '' });
    const r = await demanderCouverturePhotoRue(d.contour);
    if (r.ok) { setCouverture(r.couverture); setVerification({ enCours: false, erreur: '' }); }
    else setVerification({ enCours: false, erreur: r.raison });
  };
  const sansBrief = !demande.actuel;
  return (
    <section className="mz-brief mz-fond-image" aria-label="Fond de l’image">
      <header className="mz-fond-image__tete">
        <IconeImage size={16} aria-hidden="true" />
        <strong>Fond de l’image</strong>
        <span>· devis actuel : {LIBELLES_FOND[d.choisi]}</span>
      </header>
      {d.couverture && <p className="mz-fond-image__note">{phraseCouverture(d.couverture)}</p>}
      {d.facade && <p className="mz-fond-image__note">Façade sur voie : {d.facade}.</p>}
      <div className="mz-fond-image__tuiles" role="group" aria-label="Choisir le fond de l’image">
        {tuilesFond(d).map((t) => (
          <button key={t.fond} type="button" className={`mz-fond-image__tuile${t.fond === d.choisi ? ' is-choisi' : ''}`}
            disabled={!t.actif || !onSend || sansBrief || t.fond === d.choisi}
            onClick={() => (t.fond === 'photo_rue' ? choisirRue() : t.fond === 'etude' ? choisirEtude() : setPhotoOuverte(true))}>
            <b>{t.libelle}</b><small>{t.detail}</small>
          </button>
        ))}
      </div>
      {!d.couverture && d.contour && <button type="button" className="mz-fond-image__verifier" onClick={() => void verifier()} disabled={verification.enCours}>
        <RefreshCw size={13} aria-hidden="true" /> {verification.enCours ? 'Vérification…' : 'Vérifier les photos de rue disponibles'}
      </button>}
      {verification.erreur && <p className="mz-fond-image__note" role="alert">{verification.erreur}</p>}
      {sansBrief && <p className="mz-fond-image__note">Pour changer le fond, écrivez-le à Mimmo (« image sur la photo de la rue »).</p>}
      <p className="mz-fond-image__note">Un choix demande un nouveau devis à Mimmo ; rien n’est lancé avant votre accord.</p>
      {photoOuverte && <PhotoClientRue contour={d.contour} onPret={photoPrete} onFermer={() => setPhotoOuverte(false)} />}
    </section>
  );
}
