// src/spaces/copilot/studio3d/suiviRenduChat.ts
// =============================================================================
// LOT E1-suivi — Carte « Rendu en cours » dans le fil du chat : logique PURE
// (testée par suiviRenduChat.test.ts avec `node --test`). Aucune I/O ici.
//
// Constat (05/11/2026) : un rendu lancé par Mimmo s'est terminé en moins de
// 10 min, mais l'utilisateur a dû demander « où en est mon rendu ? » pour voir
// les images — Mimmo ne parle qu'en réponse à un message. La carte suit donc le
// travail elle-même (lecture de `studio_jobs` sous l'identité de l'utilisateur,
// RLS) et affiche le résultat dès qu'il est prêt.
//
// · Repérage : sorties des outils `studio_lancer_rendu` (lance / deja_lance) et
//   `studio_etat_rendu` (travail existant de la conversation). Une seule carte
//   vivante par travail : celle du DERNIER appel qui le cite.
// · État affiché : celui écrit en base par la machine de rendu (travauxLogique),
//   jamais une progression inventée. Les phrases « machine » et « position dans
//   la file » viennent de la sortie de l'outil (le serveur seul peut lire la
//   file entière) et sont datées comme telles.
// · Liens du résultat : MÊMES chemins que studio_etat_rendu (copilot-chat/agent/
//   studio.ts, etatRendu) : film → video_path (+ poster_path), image → jpeg_path
//   des vues (3 au plus) sinon image_path, visite → page publique /visite/<id>.
// =============================================================================

import {
  LIBELLES_TYPE, libelleResultatImage, phraseElementsOmis, phraseSuivi,
  type LibelleImage, type ResultatFilm, type ResultatImage, type ResultatVisite, type StatutTravail, type TravailStudio, type TypeTravail,
} from '../../../lib/studio/travauxLogique.ts';

export const OUTIL_LANCER_RENDU = 'studio_lancer_rendu';
export const OUTIL_ETAT_RENDU = 'studio_etat_rendu';

/** Sondage de la carte du chat (le temps réel fait l'essentiel ; le sondage est le filet). */
export const SONDAGE_SUIVI_CHAT_MS = 12_000;
/** Même valeur que ATTENTE_SUSPECTE_MS (copilot-chat/agent/studio.ts) — vérifié par le test. */
export const ATTENTE_SUSPECTE_MS = 10 * 60_000;
/** Même valeur que ACTIVITE_RECENTE_MS (copilot-chat/agent/studio.ts) — vérifié par le test. */
export const ACTIVITE_RECENTE_MS = 15 * 60_000;
/** Vues livrées au plus (studio_etat_rendu : chemins.slice(0, 3)). */
export const IMAGES_MAX = 3;

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const txt = (v: unknown, max = 600): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: readonly TypeTravail[] = ['film', 'visite360', 'image'];
const STATUTS: readonly StatutTravail[] = ['en_attente', 'en_cours', 'termine', 'echec', 'annule'];

export function estOutilSuiviRendu(nom: string): boolean {
  return nom === OUTIL_LANCER_RENDU || nom === OUTIL_ETAT_RENDU;
}

/** Ce que la sortie d'outil dit du travail (au moment de l'appel). */
export interface IndiceSuivi {
  jobId: string;
  origine: 'lance' | 'deja_lance' | 'etat';
  type: TypeTravail | null;
  statut: StatutTravail | null;
  /** Phrase du serveur sur la machine de rendu (au lancement ou à la dernière vérification). */
  machine: string | null;
  /** Rendus en attente devant celui-ci lors de la dernière vérification (studio_etat_rendu). */
  positionFile: number | null;
}

export interface AppelOutil { id: string; name: string; status: string; output?: unknown }
export interface MessageAvecOutils { toolCalls?: readonly AppelOutil[] }

/**
 * Indice de suivi d'un appel d'outil RÉUSSI (`status: success`, sortie `ok`) ; null sinon.
 * studio_lancer_rendu : seulement si `lance: true` ou `deja_lance: true` (un devis n'a rien lancé).
 */
export function lireIndiceSuivi(appel: AppelOutil): IndiceSuivi | null {
  if (!estOutilSuiviRendu(appel.name) || appel.status !== 'success') return null;
  const sortie = estObj(appel.output) ? appel.output : null;
  if (sortie?.status !== 'ok' || !estObj(sortie.data)) return null;
  const d = sortie.data;
  const jobId = typeof d.job_id === 'string' && RE_UUID.test(d.job_id) ? d.job_id : null;
  if (!jobId) return null;
  let origine: IndiceSuivi['origine'];
  if (appel.name === OUTIL_ETAT_RENDU) origine = 'etat';
  else if (d.lance === true) origine = 'lance';
  else if (d.deja_lance === true) origine = 'deja_lance';
  else return null;
  const pos = d.position_file;
  return {
    jobId, origine,
    type: TYPES.find((t) => t === d.type) ?? null,
    statut: STATUTS.find((s) => s === d.statut) ?? null,
    machine: txt(d.machine),
    positionFile: typeof pos === 'number' && Number.isInteger(pos) && pos >= 0 ? pos : null,
  };
}

/**
 * Appels d'outils qui portent une carte de suivi VIVANTE : pour chaque travail, le dernier
 * appel de la conversation qui le cite (les appels plus anciens gardent leur carte d'outil
 * habituelle). Clé : identifiant de l'appel d'outil.
 */
export function cartesSuivi(messages: readonly MessageAvecOutils[]): Map<string, IndiceSuivi> {
  const parTravail = new Map<string, { appelId: string; indice: IndiceSuivi }>();
  for (const m of messages) {
    for (const a of m.toolCalls ?? []) {
      const indice = lireIndiceSuivi(a);
      if (indice) parTravail.set(indice.jobId, { appelId: a.id, indice });
    }
  }
  return new Map([...parTravail.values()].map((x) => [x.appelId, x.indice]));
}

/**
 * LOT P2 — reste du défaut du 10/11 : appels de suivi RÉUSSIS (lancé, déjà lancé, état) dont le travail a sa carte
 * vivante sur un AUTRE appel (plus récent). Leur sortie est figée (« en_attente », machine…) : le chat n'affiche plus
 * leur carte d'outil générique, seulement un renvoi vers la carte vivante. Clé : identifiant de l'appel d'outil.
 */
export function appelsSuiviRemplaces(messages: readonly MessageAvecOutils[]): Set<string> {
  const vivantes = cartesSuivi(messages);
  const remplaces = new Set<string>();
  for (const m of messages) {
    for (const a of m.toolCalls ?? []) {
      if (!vivantes.has(a.id) && lireIndiceSuivi(a)) remplaces.add(a.id);
    }
  }
  return remplaces;
}

/** Durée lisible (« 1 min », « 12 min », « 2 h », « 3 jours »). */
export function dureeLisible(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 172_800_000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / 86_400_000)} jours`;
}

export type EtatCarte = 'chargement' | 'introuvable' | StatutTravail;

export interface VueCarteSuivi {
  etat: EtatCarte;
  /** Vrai tant que le travail est en attente ou en cours (ou pas encore relu) : le suivi continue. */
  actif: boolean;
  titre: string;
  /** Pastille courte. */
  pastille: string;
  /** Pourcentage écrit par la machine de rendu (en cours seulement). */
  progression: number | null;
  phrase: string;
  /** Informations datées (position dans la file, machine). */
  details: string[];
  /** Signal honnête d'une machine probablement arrêtée ; null sinon. */
  alerte: string | null;
  omis: string | null;
  avertissements: string[];
  /**
   * LOT P2 — image TERMINÉE : libellé honnête (insérée dans la photo, ou image d'étude et pourquoi), mention de
   * la source à afficher sous l'image, atelier « Ajuster le placement ». null pour les autres cas.
   */
  image: LibelleImage | null;
}

const QUOI: Record<TypeTravail, string> = { film: 'Le film', visite360: 'La visite 360°', image: 'L’image' };

/**
 * Vue de la carte. `travail` : ligne relue (null = pas encore relue) ; `introuvable` : la
 * lecture a répondu « aucune ligne » (supprimée ou non visible) ; `maintenant` : horloge (ms).
 */
export function vueCarteSuivi(travail: TravailStudio | null, indice: IndiceSuivi, maintenant: number, introuvable = false): VueCarteSuivi {
  const type = travail?.type ?? indice.type;
  const libelle = type ? LIBELLES_TYPE[type] : 'Rendu Studio';
  const base = { progression: null, details: [] as string[], alerte: null, omis: null, avertissements: [] as string[], image: null };
  if (!travail) {
    return introuvable
      ? { ...base, etat: 'introuvable', actif: false, titre: libelle, pastille: 'Introuvable', phrase: 'Ce rendu n’est plus accessible depuis votre compte.' }
      : { ...base, etat: 'chargement', actif: true, titre: libelle, pastille: 'Lecture…', phrase: 'Lecture du suivi du rendu…' };
  }
  const quoi = QUOI[travail.type];
  const quand = indice.origine === 'etat' ? 'Lors de la dernière vérification par Mimmo' : 'Au moment du lancement';
  const depuis = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? maintenant - Date.parse(iso) : null);

  switch (travail.statut) {
    case 'en_attente': {
      const attente = depuis(travail.cree_le);
      const details: string[] = [];
      if (indice.origine === 'etat' && indice.positionFile !== null) {
        details.push(`${quand} : ${indice.positionFile === 0 ? 'aucun rendu devant le vôtre' : `${indice.positionFile} rendu${indice.positionFile > 1 ? 's' : ''} devant le vôtre`} dans la file.`);
      }
      if (indice.machine) details.push(`${quand} : ${indice.machine}`);
      const alerte = attente !== null && attente > ATTENTE_SUSPECTE_MS
        ? `Ce rendu n’a pas encore été pris après ${dureeLisible(attente)} d’attente : la machine de rendu est peut-être éteinte, ou occupée par un autre rendu. Il démarrera dès qu’elle le prendra ; cette carte se mettra à jour seule.`
        : null;
      return {
        ...base, etat: 'en_attente', actif: true, titre: `${libelle} — rendu en attente`, pastille: 'En attente', details, alerte,
        phrase: `${quoi} est dans la file : la machine de rendu ne l’a pas encore pris${attente !== null ? ` (en attente depuis ${dureeLisible(attente)})` : ''}.`,
      };
    }
    case 'en_cours': {
      const silence = depuis(travail.maj_le || travail.demarre_le);
      return {
        ...base, etat: 'en_cours', actif: true, titre: `${libelle} — rendu en cours`, pastille: 'En cours',
        progression: travail.progression, phrase: phraseSuivi(travail),
        alerte: silence !== null && silence > ACTIVITE_RECENTE_MS
          ? `Aucune progression reçue depuis ${dureeLisible(silence)} : la machine de rendu a peut-être été interrompue. Le statut se mettra à jour dès qu’elle reprendra.`
          : null,
      };
    }
    case 'termine': {
      // LOT P2 : une image n'est « insérée dans la photo de la rue » que si la machine de rendu l'a livrée ainsi ;
      // sinon c'est une image d'étude, et la raison est dite.
      const image = travail.type === 'image' && travail.resultat ? libelleResultatImage(travail.resultat as ResultatImage) : null;
      return {
        ...base, etat: 'termine', actif: false, titre: `${image ? image.titre : libelle} — prêt${travail.type === 'film' ? '' : 'e'}`, pastille: 'Prêt', image,
        phrase: travail.resultat ? phraseSuivi(travail) : `${quoi} est indiqué${travail.type === 'film' ? '' : 'e'} comme terminé${travail.type === 'film' ? '' : 'e'}, mais aucun fichier n’est lisible dans le résultat.`,
        omis: phraseElementsOmis(travail.elements_omis),
        avertissements: travail.resultat?.avertissements ?? [],
      };
    }
    case 'echec':
      return {
        ...base, etat: 'echec', actif: false, titre: `${libelle} — échec`, pastille: 'Échec',
        phrase: `${phraseSuivi(travail).replace(/ Vous pouvez relancer\.$/, '').replace(/([^.!?…])$/u, '$1.')} Vous pouvez demander à Mimmo de relancer le rendu.`,
      };
    case 'annule':
      return { ...base, etat: 'annule', actif: false, titre: `${libelle} — annulé`, pastille: 'Annulé', phrase: 'Ce rendu a été annulé.' };
  }
}

/** Fichier du résultat à présenter (chemins du bucket privé `studio-rendus`, ou visite publique). */
export type FichierResultat =
  | { genre: 'image'; chemin: string; libelle: string }
  | { genre: 'video'; chemin: string; affiche: string | null }
  | { genre: 'visite'; visiteId: string };

/** Fichiers d'un travail TERMINÉ (mêmes règles que studio_etat_rendu) ; [] sinon. */
export function fichiersResultat(travail: TravailStudio | null): FichierResultat[] {
  if (!travail || travail.statut !== 'termine' || !travail.resultat) return [];
  if (travail.type === 'film') {
    const r = travail.resultat as ResultatFilm;
    return r.video_path ? [{ genre: 'video', chemin: r.video_path, affiche: r.poster_path ?? null }] : [];
  }
  if (travail.type === 'image') {
    const r = travail.resultat as ResultatImage;
    const vues = (r.images ?? []).filter((i) => i.jpeg_path).slice(0, IMAGES_MAX).map((i) => ({ genre: 'image' as const, chemin: i.jpeg_path, libelle: i.libelle }));
    return vues.length ? vues : r.image_path ? [{ genre: 'image', chemin: r.image_path, libelle: 'Image' }] : [];
  }
  const r = travail.resultat as ResultatVisite;
  return /^[A-Za-z0-9_-]{8,64}$/.test(r.visite_id ?? '') ? [{ genre: 'visite', visiteId: r.visite_id }] : [];
}

