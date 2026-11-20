// src/spaces/copilot/studio3d/parcoursEcran.ts
// =============================================================================
// VIS-17 (20/11/2026) — sources du PARCOURS vues de l'écran (Espace 3D + carte du chat).
//
// `assemblerSourcesEcran` (PUR, testé par node) rassemble l'état RÉEL connu de l'écran pour src/lib/studio/parcours.ts :
//   · base     : missions de la conversation (listerMissions), rendus (listerTravaux → studio_jobs) ;
//   · fil      : 3D préparée (sortie de studio_preparer_3d), fiche du projet décrite, habillage validé (bloc
//                mimmoza-brief / devis), demande d'habillage en attente, aperçu validé (bloc mimmoza-parcours) ;
//   · navigateur : parcelle retenue, brief projet de l'étude (vues, lumière, saison, gamme, typologies), réglages du
//                film / de la visite et type de parcours choisi (parcours.store.ts).
// `instantaneDepuisSources` : la part que seul l'écran connaît, envoyée au serveur (context.parcours) pour le bloc
// « PARCOURS — FAIT FOI » ; le serveur relit lui-même missions, 3D préparée, rendus et aperçu validé en base.
// =============================================================================
import type { BriefProjet } from '../../../lib/studio/briefProjet.ts';
import {
  apercuValideDesMessages, lireBlocParcours, sourcesVides, programmeDesCriteres, terrainDesCriteres, travailParcours, typeParcoursDesMessages,
  type InstantaneParcours, type ReglagesFilm, type ReglagesVisite, type SourcesParcours, type TravailParcours, type TypeParcours,
} from '../../../lib/studio/parcours.ts';
import { dernierePreparation, lignesCarte, type MessageOutils } from './preparationStudio.ts';
import { briefCourant, demandeEnCours, recapitulatif } from './briefCreatif.ts';
import { latestJarvisDraft } from './jarvisDraft.ts';

type MessageEcran = MessageOutils & { id: string; role: string; text: string; status?: string };

export interface MissionEcran { id: string; type: string; statut: string; conversation_id: string | null; cree_le?: string | null; criteres?: unknown }

export interface EntreeEcran {
  messages: readonly MessageEcran[];
  conversationId: string | null;
  /** Type choisi par l'utilisateur (sélecteur) ; null : déduit des messages. */
  typeChoisi: TypeParcours | null;
  missions: readonly MissionEcran[];
  travaux: readonly unknown[];
  /** Libellé de la parcelle retenue pour la conversation (navigateur), s'il y en a une. */
  parcelle: string | null;
  brief: BriefProjet | null;
  film: ReglagesFilm | null;
  visite: ReglagesVisite | null;
}

const ROLES_HABILLAGE = ['facade', 'menuiseries', 'garde_corps', 'soubassement', 'toiture'];

/** Typologie la plus vendue du programme (« T3 »), comme le logement témoin du worker (VIS-05). */
function typologieTemoin(brief: BriefProjet | null): string | null {
  const t = [...(brief?.programme.typologies ?? [])].sort((a, b) => b.nombre - a.nombre)[0];
  return t && t.nombre > 0 ? t.type : null;
}

export function assemblerSourcesEcran(e: EntreeEcran): SourcesParcours {
  const textesUtilisateur = e.messages.filter((m) => m.role === 'user').map((m) => m.text);
  const type = e.typeChoisi ?? typeParcoursDesMessages(textesUtilisateur);
  const s = sourcesVides(type);

  // Volume / terrain : 3D préparée par Mimmo (moteur), sinon fiche du projet décrite et complète.
  const prep = dernierePreparation(e.messages);
  const fiche = latestJarvisDraft(e.messages);
  const ficheDimensionnee = !!fiche && !!fiche.dimensions?.trim() && !!fiche.programme?.trim();
  const terrain = e.parcelle ?? (prep ? `${prep.idu}${prep.commune ? ` · ${prep.commune}` : ''}` : null);

  // Conception : dernière mission de conception de la conversation (statut réel), sinon fiche décrite.
  const mission = [...e.missions]
    .filter((m) => m.type === 'conception' && (!e.conversationId || m.conversation_id === e.conversationId))
    .sort((a, b) => Date.parse(b.cree_le ?? '') - Date.parse(a.cree_le ?? ''))[0];
  const lignes = prep ? lignesCarte(prep) : [];
  const terrainFinal = terrain ?? terrainDesCriteres(mission?.criteres);
  const conception = mission
    ? { statut: mission.statut, resume: programmeDesCriteres(mission.criteres) ?? (lignes.length ? lignes.join(' · ') : null) }
    : ficheDimensionnee ? { statut: 'fiche', resume: fiche!.programme } : null;

  // Habillage : brief validé dans le fil (ou devis), sinon celui mémorisé dans le brief projet de l'étude.
  const courant = briefCourant(e.messages);
  const materiaux = (e.brief?.materiaux ?? []).filter((m) => ROLES_HABILLAGE.includes(m.role)).map((m) => m.libelle);
  const habillage = courant ? recapitulatif(courant) : e.brief?.sources.habillage && materiaux.length ? materiaux.join(' · ') : null;

  const travaux = e.travaux.map(travailParcours).filter((t): t is TravailParcours => t !== null);
  const vues = e.brief?.rendu.vues ?? [];
  return {
    ...s,
    terrain: terrainFinal,
    conception,
    volume: prep
      ? { pret: true, resume: lignes.length ? lignes.join(' · ') : '3D préparée par Mimmo.' }
      : ficheDimensionnee ? { pret: true, resume: `Projet décrit : ${fiche!.dimensions}` } : { pret: false, resume: null },
    habillage: { resume: habillage, attenduParMimmo: !!demandeEnCours(e.messages) },
    interieurs: { gamme: e.brief?.gamme ?? null, typologie: typologieTemoin(e.brief) },
    rendu: {
      vues: [...vues], vuesChoisies: vues.length > 0,
      ambiance: e.brief?.rendu.ambiance ?? null, saison: e.brief?.rendu.saison ?? null,
      fond: fondDuDernierDevis(e.messages), etudeRattachee: !!e.brief,
    },
    film: e.film, visite: e.visite,
    travaux,
    apercuValide: apercuValideDesMessages(textesUtilisateur),
  };
}

/** Fond de l'image du dernier devis d'image du fil (« etude », « photo_rue », « photo_client »), lu, jamais deviné. */
function fondDuDernierDevis(messages: readonly MessageEcran[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const t of [...(messages[i].toolCalls ?? [])].reverse()) {
      if (t.name !== 'studio_lancer_rendu') continue;
      const o = (t.output as { data?: { options?: { fond?: unknown } } } | undefined)?.data?.options;
      if (o && typeof o === 'object') return typeof o.fond === 'string' ? o.fond : 'etude';
    }
  }
  return null;
}

/** Part de l'état que seul l'écran connaît, envoyée au serveur avec chaque message (context.parcours). */
export function instantaneDepuisSources(s: SourcesParcours, typeChoisi: TypeParcours | null): InstantaneParcours {
  return {
    type: typeChoisi,
    habillage: s.habillage.resume,
    interieurs: { ...s.interieurs },
    rendu: { vues: [...s.rendu.vues], vuesChoisies: s.rendu.vuesChoisies, ambiance: s.rendu.ambiance, saison: s.rendu.saison, etudeRattachee: s.rendu.etudeRattachee },
    film: s.film, visite: s.visite,
  };
}

const RE_OUTILS_PARCOURS = /^(studio_|proposer_mission$|etat_mission$)/;

/**
 * Message après lequel la carte « Votre parcours » s'affiche (UNE seule carte vivante par conversation) : la dernière
 * réponse de Mimmo qui touche au parcours (question sur une image / un film / une visite / la plaquette, outil Studio ou
 * mission, bloc d'habillage ou de parcours). À défaut, si une conception est terminée ou une 3D préparée, la dernière
 * réponse. null : pas de carte.
 */
export function ancreCarteParcours(messages: readonly MessageEcran[], sources: SourcesParcours | null): string | null {
  let derniereReponse: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    derniereReponse ??= m.id;
    const question = [...messages.slice(0, i)].reverse().find((x) => x.role === 'user')?.text ?? '';
    const lu = lireBlocParcours(question);
    const pertinent = lu.present || /```mimmoza-brief/.test(question) || typeParcoursDesMessagesStrict(lu.visible)
      || (m.toolCalls ?? []).some((t) => RE_OUTILS_PARCOURS.test(t.name));
    if (pertinent) return m.id;
  }
  const avance = !!sources && (sources.volume.pret || sources.conception?.statut === 'terminee' || sources.travaux.length > 0);
  return avance ? derniereReponse : null;
}

function typeParcoursDesMessagesStrict(texte: string): boolean {
  // typeParcoursDesMessages retombe sur « image » ; ici seul un vrai mot du parcours compte.
  return /(^|[^\p{L}])(images?|visuels?|perspectives?|plaquettes?|rendus?|films?|vid[ée]os?|visites?\s*(?:virtuelles?|360)|360\s*°?)(?![\p{L}\d])/iu.test(texte);
}
