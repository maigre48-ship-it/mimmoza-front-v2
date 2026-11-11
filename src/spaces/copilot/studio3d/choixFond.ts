// src/spaces/copilot/studio3d/choixFond.ts
// =============================================================================
// LOT P2 (11/11/2026) — « IMAGE DANS SA RUE » : carte « Fond de l'image » sous le devis d'une image.
// Logique PURE (testée par choixFond.test.ts) : lecture du devis (`data.fond_image` renvoyé par
// studio_lancer_rendu), tuiles proposées selon la couverture, et message envoyé au chat.
//
// Le message porte le MÊME bloc ```mimmoza-brief``` que la carte d'habillage (brief du devis inchangé) avec un
// champ `fond` : le serveur le relit lui-même dans le message reçu (briefDuMessage) et établit le nouveau devis ;
// le modèle ne recopie jamais un chemin de photo. Rien n'est lancé sans l'accord donné après ce nouveau devis.
// =============================================================================

import { BRIEF_BLOC_LANGUE, BRIEF_BLOC_VERSION, briefAEnvoyer, etatInitial, OUTIL_LANCER_RENDU, type DemandeBrief } from './briefCreatif.ts';
import { LIBELLES_FOND, fondDe, type FondImage, type OptionsFond } from '../../../lib/studio/fondImage.ts';
import { lireContour, lireCouvertureTransmise, type CouverturePhotoRue, type LonLat } from '../../../lib/studio/couverturePhotoRue.ts';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface DevisFond {
  /** Fond du devis présenté. */
  choisi: FondImage;
  /** Couverture vérifiée par le serveur au moment du devis ; null si non vérifiée (voir `raisonCouverture`). */
  couverture: CouverturePhotoRue | null;
  raisonCouverture: string | null;
  /** Phrase du serveur sur la façade sur voie (identifiée ou non, et pourquoi). */
  facade: string | null;
  /** Contour de la parcelle (WGS 84), pour le plan de la photo du client ; null si absent. */
  contour: LonLat[] | null;
}

/** Devis d'une IMAGE (sortie `confirmation_requise` de studio_lancer_rendu) portant `fond_image` ; null sinon. */
export function lireDevisFond(call: { name: string; status?: string; output?: unknown }): DevisFond | null {
  if (call.name !== OUTIL_LANCER_RENDU || call.status === 'running' || !estObj(call.output)) return null;
  const out = call.output;
  const d = estObj(out.data) ? out.data : null;
  if (out.status !== 'confirmation_requise' || !d || d.type !== 'image' || !estObj(d.fond_image)) return null;
  const f = d.fond_image;
  const couverture = lireCouvertureTransmise(f.couverture);
  const raison = !couverture && estObj(f.couverture) && typeof f.couverture.raison === 'string' ? f.couverture.raison : null;
  return {
    choisi: fondDe({ fond: f.choisi }),
    couverture,
    raisonCouverture: couverture ? null : raison ?? 'Couverture Panoramax non vérifiée.',
    facade: typeof f.facade_sur_voie === 'string' ? f.facade_sur_voie : null,
    contour: lireContour(f.contour),
  };
}

export interface TuileFond { fond: FondImage; libelle: string; actif: boolean; detail: string }

/** Tuiles proposées : la photo de la rue seulement si la couverture est établie ; la photo du client et l'étude toujours. */
export function tuilesFond(d: DevisFond): TuileFond[] {
  const rue = d.couverture?.couverte === true;
  return [
    {
      fond: 'photo_rue', libelle: LIBELLES_FOND.photo_rue, actif: rue,
      detail: rue ? 'Photo publique sous Licence Ouverte, choisie par la machine de rendu.'
        : d.couverture ? 'Aucune photo sous Licence Ouverte à moins de 60 m de la parcelle.' : (d.raisonCouverture ?? 'Couverture non vérifiée.'),
    },
    { fond: 'photo_client', libelle: LIBELLES_FOND.photo_client, actif: true, detail: 'Votre photo, prise du trottoir d’en face, envoyée après votre accord.' },
    { fond: 'etude', libelle: LIBELLES_FOND.etude, actif: true, detail: 'Image d’étude, décor de synthèse.' },
  ];
}

/**
 * Message du chat pour un fond choisi : une ligne lisible, puis le bloc relu par le serveur (même brief que le
 * devis, champ `fond` en plus). null si le devis n'a pas de brief connu (la carte propose alors d'écrire à Mimmo).
 */
export function messageFond(demande: Pick<DemandeBrief, 'actuel'> | null, fond: Omit<OptionsFond, 'fond'> & { fond: FondImage }): string | null {
  if (!demande?.actuel) return null;
  const etat = etatInitial({ actuel: demande.actuel, ambiances: ['jour', 'fin_de_journee'] });
  const f = fondDe(fond);
  const bloc = { v: BRIEF_BLOC_VERSION, type: 'image', brief: briefAEnvoyer(etat, false), fond: f === 'etude' ? { fond: 'etude' } : { ...fond, fond: f } };
  const tete = f === 'photo_client'
    ? `Fond de l’image : ${LIBELLES_FOND.photo_client} (photo envoyée avec mon accord).`
    : `Fond de l’image : ${LIBELLES_FOND[f]}.`;
  return `${tete}\n\n\`\`\`${BRIEF_BLOC_LANGUE}\n${JSON.stringify(bloc)}\n\`\`\``;
}
