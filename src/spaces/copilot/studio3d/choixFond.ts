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

import { BRIEF_BLOC_LANGUE, BRIEF_BLOC_VERSION, briefAEnvoyer, champsBloc, etatInitial, OUTIL_LANCER_RENDU, type BlocProjet, type DemandeBrief } from './briefCreatif.ts';
import { estVueCatalogue, libelleCourtVue, libelleVue, type PronosticVue, type VueCatalogue } from '../../../lib/studio/catalogueVues.ts';
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
export function messageFond(demande: Pick<DemandeBrief, 'actuel'> | null, fond: Omit<OptionsFond, 'fond'> & { fond: FondImage }, extra: BlocProjet = {}): string | null {
  if (!demande?.actuel) return null;
  const etat = etatInitial({ actuel: demande.actuel, ambiances: ['jour', 'fin_de_journee'] });
  const f = fondDe(fond);
  const bloc = { v: BRIEF_BLOC_VERSION, type: 'image', brief: briefAEnvoyer(etat, false), fond: f === 'etude' ? { fond: 'etude' } : { ...fond, fond: f }, ...champsBloc(extra, true) };
  const tete = f === 'photo_client'
    ? `Fond de l’image : ${LIBELLES_FOND.photo_client} (photo envoyée avec mon accord).`
    : `Fond de l’image : ${LIBELLES_FOND[f]}.`;
  return `${tete}\n\n\`\`\`${BRIEF_BLOC_LANGUE}\n${JSON.stringify(bloc)}\n\`\`\``;
}

/**
 * LOT X9 (17/11/2026) — « Envoyer une photo de ma maison » (projet d'extension, aucune image sans vraie photo) :
 * message du chat portant le bloc relu par le serveur, SANS brief (une extension n'a pas d'habillage de bâtiment
 * neuf) et avec la photo de l'utilisateur comme fond. Mimmo établit alors le devis de l'image ; rien n'est lancé
 * sans l'accord donné ensuite.
 */
export function messagePhotoMaison(photo: NonNullable<OptionsFond['photo_client']>): string {
  const bloc = { v: BRIEF_BLOC_VERSION, type: 'image', fond: { fond: 'photo_client', photo_client: photo } };
  return `Voici une photo de ma maison prise depuis la rue (envoyée avec mon accord) : utilisez-la pour l’image de l’extension.\n\n\`\`\`${BRIEF_BLOC_LANGUE}\n${JSON.stringify(bloc)}\n\`\`\``;
}

/**
 * VIS-04 — vues cochées sous le devis d'une image : message du chat portant le bloc relu par le serveur (même brief
 * et même fond que le devis, `vues` en plus, et les champs du brief projet). Mimmo établit le NOUVEAU devis ;
 * rien n'est lancé sans l'accord donné ensuite. null si le devis n'a pas de brief connu.
 */
export function messageVues(demande: Pick<DemandeBrief, 'actuel'> | null, vues: readonly VueCatalogue[], fondActuel: (Omit<OptionsFond, 'fond'> & { fond: FondImage }) | null, extra: BlocProjet = {}): string | null {
  if (!demande?.actuel || !vues.length) return null;
  const etat = etatInitial({ actuel: demande.actuel, ambiances: ['jour', 'fin_de_journee'] });
  const f = fondActuel ? fondDe(fondActuel) : 'etude';
  const bloc = {
    v: BRIEF_BLOC_VERSION, type: 'image', brief: briefAEnvoyer(etat, false),
    ...(fondActuel && f !== 'etude' ? { fond: { ...fondActuel, fond: f } } : {}),
    ...champsBloc({ ...extra, vues }, true),
  };
  return `Vues de l’image : ${vues.map(libelleCourtVue).join(', ')}.\n\n\`\`\`${BRIEF_BLOC_LANGUE}\n${JSON.stringify(bloc)}\n\`\`\``;
}

/**
 * VIS-10 — pronostic des vues « sous condition » du devis d'une image (`data.pronostic_vues`, serveur) ; [] si absent
 * ou illisible (jamais complété). Pur.
 */
export function lirePronosticDevis(call: { name: string; status?: string; output?: unknown }): PronosticVue[] {
  if (call.name !== OUTIL_LANCER_RENDU || !estObj(call.output)) return [];
  const d = estObj(call.output.data) ? call.output.data : null;
  if (!d || d.type !== 'image' || !Array.isArray(d.pronostic_vues)) return [];
  return d.pronostic_vues.filter(estObj).flatMap((p): PronosticVue[] => {
    if (!estVueCatalogue(p.vue) || (p.pronostic !== 'probablement_refusee' && p.pronostic !== 'selon_projet') || typeof p.raison !== 'string' || !p.raison.trim()) return [];
    return [{ vue: p.vue, libelle: libelleVue(p.vue), pronostic: p.pronostic, raison: p.raison }];
  }).slice(0, 15);
}
