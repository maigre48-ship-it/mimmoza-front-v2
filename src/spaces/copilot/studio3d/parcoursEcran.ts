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
  apercuValideDesMessages, lireBlocParcours, missionConceptionDeReference, sourcesVides, programmeDesCriteres, terrainDesCriteres, travailParcours, typeParcoursDesMessages,
  type InstantaneParcours, type ReglagesFilm, type ReglagesVisite, type SourcesParcours, type TravailParcours, type TypeParcours,
} from '../../../lib/studio/parcours.ts';
import { fondDe, type OptionsFond } from '../../../lib/studio/fondImage.ts';
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
  /** VIS-18b — fond de l'image mémorisé (étape 6 / carte du devis) ; prime sur celui du dernier devis. */
  fond?: OptionsFond | null;
  /** VIS-18b — gamme / cible du petit réglage (utilisées seulement SANS étude rattachée). */
  projet?: { gamme: string | null; cible: string | null } | null;
  /** VIS-18a — logement témoin personnalisé dans le Studio (temoinStudio.ts : lireTemoinPersonnalise / etatTemoinConversation). */
  temoinStudio?: { fait: boolean; resume: string | null } | null;
  /** 23/11 — 3D préparée EN BASE pour la conversation (action directe « Préparer » / « Ouvrir mon projet en 3D »,
   *  absente des messages) : studio_preparations la plus récente. */
  preparationBase?: { resume: string | null } | null;
}

/** 23/11 — une ligne lisible depuis studio_preparations.resume (bâtiments, gabarit, SDP, logements). */
export function resumePreparationBase(r: unknown): string | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const nf = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  const bat = n(o.batiments); const gab = typeof o.gabarit === 'string' ? o.gabarit : null;
  const sdp = n(o.sdp_estimee_m2); const lg = n(o.logements_places);
  const parts = [
    bat !== null && gab ? `${nf(bat)} bâtiment${bat > 1 ? 's' : ''} en ${gab}` : null,
    sdp !== null ? `≈ ${nf(sdp)} m² de surface de plancher` : null,
    lg !== null ? `${nf(lg)} logements` : null,
    typeof o.gabarit_retenu === 'string' && o.gabarit_retenu.trim() ? o.gabarit_retenu.trim() : null,
  ].filter((x): x is string => !!x);
  return parts.length ? parts.join(' · ') : null;
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

  // Conception : mission de conception de la conversation qui fait foi (statut réel), sinon fiche décrite.
  // VIS-21 : une conception TERMINÉE n'est plus masquée par un devis postérieur non lancé (missionConceptionDeReference).
  const reference = missionConceptionDeReference(e.missions
    .filter((m) => m.type === 'conception' && (!e.conversationId || m.conversation_id === e.conversationId)));
  const mission = reference.mission ?? undefined;
  const lignes = prep ? lignesCarte(prep) : [];
  const terrainFinal = terrain ?? terrainDesCriteres(mission?.criteres);
  const conception = mission
    ? { statut: mission.statut, resume: programmeDesCriteres(mission.criteres) ?? (lignes.length ? lignes.join(' · ') : null), missionId: mission.id,
      ...(reference.autreDevis ? { autreDevisEnAttente: true } : {}) }
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
      : e.preparationBase ? { pret: true, resume: e.preparationBase.resume ?? '3D préparée.' }
      : ficheDimensionnee ? { pret: true, resume: `Projet décrit : ${fiche!.dimensions}` } : { pret: false, resume: null },
    habillage: { resume: habillage, attenduParMimmo: !!demandeEnCours(e.messages) },
    interieurs: interieursDe(e),
    rendu: {
      vues: [...vues], vuesChoisies: vues.length > 0,
      ambiance: e.brief?.rendu.ambiance ?? null, saison: e.brief?.rendu.saison ?? null,
      fond: e.fond ? fondDe(e.fond) : fondDuDernierDevis(e.messages), etudeRattachee: !!e.brief,
    },
    film: e.film, visite: e.visite,
    temoinStudio: e.temoinStudio ? { fait: e.temoinStudio.fait, resume: e.temoinStudio.resume } : null,
    travaux,
    apercuValide: apercuValideDesMessages(textesUtilisateur),
    devisRenduEnAttente: devisRenduEnAttente(e.messages),
  };
}

/**
 * VIS-21 — devis de rendu en attente dans le fil : la dernière réponse de Mimmo (rien écrit depuis par l'utilisateur)
 * porte une sortie `confirmation_requise` de studio_lancer_rendu. Renvoie sa qualité (`apercu` / `finale`), null sinon.
 */
export function devisRenduEnAttente(messages: readonly MessageEcran[]): 'apercu' | 'finale' | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') return null;
    if (m.role !== 'assistant') continue;
    for (const t of [...(m.toolCalls ?? [])].reverse()) {
      if (t.name !== 'studio_lancer_rendu') continue;
      const o = t.output as { status?: unknown; data?: { options?: { qualite?: unknown } } } | undefined;
      if (o?.status !== 'confirmation_requise') return null;
      return o.data?.options?.qualite === 'apercu' ? 'apercu' : 'finale';
    }
    return null;
  }
  return null;
}

/** VIS-18b — gamme / cible : celles de l'étude rattachée, sinon celles du petit réglage du parcours (dit). */
function interieursDe(e: EntreeEcran): SourcesParcours['interieurs'] {
  const typologie = typologieTemoin(e.brief);
  if (e.brief) {
    // Étude : libellés de l'étude (origine non dite, comme avant) ; la cible s'ajoute seulement si elle existe.
    return { gamme: e.brief.gamme ?? null, typologie, ...(e.brief.cible ? { cible: e.brief.cible } : {}) };
  }
  const p = e.projet;
  if (!p || (!p.gamme && !p.cible)) return { gamme: null, typologie };
  return { gamme: p.gamme, typologie, ...(p.cible ? { cible: p.cible } : {}), origine: 'conversation' };
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
export function instantaneDepuisSources(s: SourcesParcours, typeChoisi: TypeParcours | null, fond: OptionsFond | null = null): InstantaneParcours {
  return {
    type: typeChoisi,
    habillage: s.habillage.resume,
    interieurs: { ...s.interieurs },
    // VIS-18b : le fond mémorisé (options complètes) part avec le message : le devis d'image du chat le reprend.
    rendu: { vues: [...s.rendu.vues], vuesChoisies: s.rendu.vuesChoisies, ambiance: s.rendu.ambiance, saison: s.rendu.saison, etudeRattachee: s.rendu.etudeRattachee, ...(fond ? { fond } : {}) },
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
