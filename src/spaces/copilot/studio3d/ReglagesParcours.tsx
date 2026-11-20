// src/spaces/copilot/studio3d/ReglagesParcours.tsx
// =============================================================================
// VIS-18b (20/11/2026) — petits réglages affichés DANS une étape du panneau « Votre parcours » (pas de nouvel écran) :
//   · ReglageCibleGamme : cible (étape 4) ou gamme (étape 5) quand aucune étude Style & tendances n'est rattachée —
//     mémorisées par conversation (parcours.store) et transmises comme le brief projet (brief.cible / brief.gamme) ;
//   · ChoixFondParcours : fond de l'image (étape 6 du parcours Images), mêmes tuiles que la carte « Fond de l'image »
//     du devis (tuilesFond, PhotoClientRue) ; mémorisé et repris par le devis du chat.
// Logique pure : reglagesParcoursLogique.ts ; listes : src/lib/studio/parcours.ts.
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CIBLES_PARCOURS, GAMMES_PARCOURS, type EtapeParcours } from '@/lib/studio/parcours';
import type { OptionsFond, PhotoClientOption } from '@/lib/studio/fondImage';
import { demanderCouverturePhotoRue } from '@/lib/studio/travaux';
import { phraseCouverture, type CouverturePhotoRue } from '@/lib/studio/couverturePhotoRue';
import { tuilesFond } from './choixFond';
import { PhotoClientRue } from './PhotoClientRue';
import { parcelleRetenue } from './parcelleConfirmee';
import { lireMemoireParcours, majMemoireParcours, patcherInstantaneFond, PARCOURS_EVENT, type MemoireParcours } from './parcours.store';
import { contourDeParcelle, devisDeLEtape, devisImageEnAttente, fondDuChoix, messageFondParcours, resumeFond } from './reglagesParcoursLogique';
import type { MessageOutils } from './preparationStudio';
import './ChoixFondImage.css';

/** Mémoire du parcours de la conversation, relue à chaque mise à jour. */
function useMemoire(conversationId: string): MemoireParcours {
  const [m, setM] = useState(() => lireMemoireParcours(conversationId));
  useEffect(() => {
    setM(lireMemoireParcours(conversationId));
    const maj = () => setM(lireMemoireParcours(conversationId));
    window.addEventListener(PARCOURS_EVENT, maj);
    return () => window.removeEventListener(PARCOURS_EVENT, maj);
  }, [conversationId]);
  return m;
}

export function ReglageCibleGamme({ conversationId, quoi }: { conversationId: string; quoi: 'cible' | 'gamme' }) {
  const m = useMemoire(conversationId);
  const projet = m.projet ?? { gamme: null, cible: null };
  const options: [string, string][] = quoi === 'gamme' ? GAMMES_PARCOURS.map((g) => [g.valeur, g.libelle]) : CIBLES_PARCOURS.map((c) => [c, c]);
  const valeur = quoi === 'gamme' ? projet.gamme : projet.cible;
  const choisir = (v: string) => majMemoireParcours(conversationId, { projet: { ...projet, [quoi]: v === valeur ? null : v } as MemoireParcours['projet'] });
  return <div className="mz-parcours__reglage" role="group" aria-label={quoi === 'gamme' ? 'Gamme du projet' : 'Cible du projet'}>
    <small>{quoi === 'gamme' ? 'Gamme' : 'Pour qui'} :</small>
    {options.map(([v, libelle]) => <button key={v} type="button" aria-pressed={v === valeur} className={v === valeur ? 'is-actif' : ''}
      onClick={() => choisir(v)}>{libelle}</button>)}
  </div>;
}

export function ChoixFondParcours({ conversationId, messages, onSend }: { conversationId: string; messages: readonly MessageOutils[]; onSend?: (texte: string) => void }) {
  const m = useMemoire(conversationId);
  const contour = useMemo(() => contourDeParcelle(parcelleRetenue(conversationId)?.parcel), [conversationId]);
  const [couverture, setCouverture] = useState<CouverturePhotoRue | null>(null);
  const [verification, setVerification] = useState<{ enCours: boolean; erreur: string }>({ enCours: false, erreur: '' });
  const [photoOuverte, setPhotoOuverte] = useState(false);
  const devis = devisDeLEtape(messages, m.fond ?? null, contour);
  const d = couverture ? { ...devis, couverture, raisonCouverture: null } : devis;
  const choisir = (fond: OptionsFond) => {
    majMemoireParcours(conversationId, { fond });
    patcherInstantaneFond(conversationId, fond);
    // Un devis d'image attend : Mimmo le refait avec ce fond (le serveur le lit dans le parcours, jamais dans le texte).
    if (onSend && devisImageEnAttente(messages)) onSend(messageFondParcours(fond));
  };
  const verifier = async () => {
    if (!d.contour) return;
    setVerification({ enCours: true, erreur: '' });
    const r = await demanderCouverturePhotoRue(d.contour);
    if (r.ok) { setCouverture(r.couverture); setVerification({ enCours: false, erreur: '' }); } else setVerification({ enCours: false, erreur: r.raison });
  };
  return <div className="mz-parcours__fond" aria-label="Fond de l’image">
    <small>{resumeFond(m.fond ?? null)}</small>
    <div className="mz-fond-image__tuiles" role="group" aria-label="Choisir le fond de l’image">
      {tuilesFond(d).map((t) => <button key={t.fond} type="button" className={`mz-fond-image__tuile${t.fond === d.choisi && m.fond ? ' is-choisi' : ''}`}
        aria-pressed={t.fond === d.choisi && !!m.fond} disabled={!t.actif}
        onClick={() => (t.fond === 'photo_client' ? setPhotoOuverte(true) : choisir(fondDuChoix(t.fond)))}>
        <b>{t.libelle}</b><small>{t.detail}</small>
      </button>)}
    </div>
    {d.couverture && <p className="mz-fond-image__note">{phraseCouverture(d.couverture)}</p>}
    {!d.couverture && d.contour && <button type="button" className="mz-fond-image__verifier" onClick={() => void verifier()} disabled={verification.enCours}>
      <RefreshCw size={13} aria-hidden="true" /> {verification.enCours ? 'Vérification…' : 'Vérifier les photos de rue disponibles'}
    </button>}
    {!d.contour && <p className="mz-fond-image__note">Photo de la rue : confirmez d’abord la parcelle (étape 1).</p>}
    {verification.erreur && <p className="mz-fond-image__note" role="alert">{verification.erreur}</p>}
    {photoOuverte && <PhotoClientRue contour={d.contour} libelleEnvoi="Envoyer la photo et la garder pour l’image"
      onPret={(photo: PhotoClientOption) => { setPhotoOuverte(false); choisir(fondDuChoix('photo_client', photo)); }} onFermer={() => setPhotoOuverte(false)} />}
  </div>;
}

/** Réglage à afficher sous une étape du panneau (null : aucun). */
export function reglageDeLEtape(e: EtapeParcours, p: { conversationId: string | null; messages: readonly MessageOutils[]; onSend?: (texte: string) => void }) {
  if (!e.reglage || !p.conversationId || e.statut === 'bloquee') return null;
  if (e.reglage === 'fond') return <ChoixFondParcours conversationId={p.conversationId} messages={p.messages} onSend={p.onSend} />;
  return <ReglageCibleGamme conversationId={p.conversationId} quoi={e.reglage} />;
}
