// supabase/functions/copilot-chat/agent/plaquette.ts
// =============================================================================
// VIS-16 (20/11/2026) — « Préparer la plaquette » (fin de mission de conception). Module PUR (testé par Deno).
//
// Essai du 20/11 (conversation f9fa5476…, 06:29–06:30) :
//   · deux premiers clics : Mimmo répond « la mission est encore au statut devis » alors qu'elle est terminée depuis
//     6 min — il lisait la SORTIE de proposer_mission rappelée par buildPriorToolResultsBlock (« utilise-les
//     directement… »), un état figé au moment du devis. → les sorties d'outils d'ÉTAT (missions, suivi de rendu) ne
//     sont plus rappelées, et l'état RÉEL des missions de la conversation est relu en base à chaque message.
//   · troisième clic : « 3 visuels (trois-quarts gauche, trois-quarts droite, face) » = ancien jeu de vues (description
//     de studio_lancer_rendu d'avant VIS-04). → demande « plaquette » : vues du brief projet si enregistrées, sinon
//     PACK_PLAQUETTE du catalogue commun (6 vues), choisies par le SERVEUR (`pack: "plaquette"`).
// =============================================================================
import { libelleCourtVue, PACK_PLAQUETTE, VUES_DISPONIBLES, type VueCatalogue } from '../../../../src/lib/studio/catalogueVues.ts';

/**
 * Outils dont la sortie décrit un ÉTAT qui change (statut d'une mission, d'un rendu) : leur sortie ne doit jamais être
 * rappelée au modèle comme une donnée « déjà obtenue » (elle se périme). L'état réel est relu à chaque message.
 */
export const OUTILS_ETAT_VOLATIL: ReadonlySet<string> = new Set(['proposer_mission', 'etat_mission', 'lister_missions', 'studio_etat_rendu']);

const RE_PLAQUETTE = /(^|[^\p{L}])(plaquettes?|visuels?\s+(?:de\s+)?commercialisation|visuels?\s+commerciaux|images?\s+commerciales?)(?![\p{L}])/iu;
const RE_PLAQUETTE_NIE = /(^|[^\p{L}])(pas|sans|aucune?)\s+(?:de\s+|la\s+)?plaquettes?(?![\p{L}])/iu;

/** Le message demande-t-il la plaquette (pack de visuels de commercialisation) ? */
export function demandePlaquette(texte: string | null | undefined): boolean {
  const t = texte ?? '';
  return RE_PLAQUETTE.test(t) && !RE_PLAQUETTE_NIE.test(t);
}

/** Vues du pack plaquette que la machine de rendu sait produire (ordre du pack). */
export function vuesPackPlaquette(dispo: readonly string[] = VUES_DISPONIBLES): VueCatalogue[] {
  return PACK_PLAQUETTE.filter((v) => dispo.includes(v));
}

const VUES_ANCIENNES = ['trois_quarts_gauche', 'trois_quarts_droite', 'face'];
/**
 * Vues écrites par le modèle remplaçables par le pack : absentes, ou seulement l'ancien jeu (3/4 gauche, 3/4 droite,
 * face) que l'ancienne description de l'outil lui apprenait. Un choix plus précis (aérienne, séjour…) est gardé.
 */
export function vuesDuModeleRemplacables(vues: unknown): boolean {
  if (vues === undefined || vues === null) return true;
  return Array.isArray(vues) && vues.every((v) => VUES_ANCIENNES.includes(String(v)));
}

/** « 3/4 gauche, 3/4 droite, aérienne, cœur d’îlot, terrasse et séjour ». */
export function phraseVues(vues: readonly string[]): string {
  const l = vues.map((v) => libelleCourtVue(v as VueCatalogue));
  return l.length <= 1 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}`;
}

export interface MissionEtatReel {
  id: string;
  type: string;
  statut: string;
  etapes_faites?: number | null;
  etapes_max?: number | null;
  termine_le?: string | null;
  erreur?: string | null;
  /** Conception enregistrée par la mission (agent_conceptions.mission_id), s'il y en a une. */
  conception_id?: string | null;
}

const LIBELLE_STATUT: Record<string, string> = {
  devis: 'DEVIS PROPOSÉ, PAS ENCORE LANCÉE', en_attente: 'EN FILE', en_cours: 'EN COURS', attente_utilisateur: 'EN ATTENTE D’UNE RÉPONSE',
  terminee: 'TERMINÉE', budget_atteint: 'TERMINÉE (plafond atteint, rapport partiel)', echec: 'EN ÉCHEC', annulee: 'ANNULÉE', expiree: 'DEVIS EXPIRÉ',
};

function heureParis(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
}

/**
 * Bloc système « état réel des missions de cette conversation », relu en base à chaque message (index.ts). Vide sans
 * mission. Il prime explicitement sur les statuts écrits plus haut dans la conversation.
 */
export function blocEtatMissions(missions: readonly MissionEtatReel[]): string {
  if (!missions.length) return '';
  const lignes = missions.map((m) => {
    const statut = LIBELLE_STATUT[m.statut] ?? m.statut.toUpperCase();
    const fin = (m.statut === 'terminee' || m.statut === 'budget_atteint') ? heureParis(m.termine_le) : null;
    const etapes = Number.isFinite(m.etapes_faites) && Number.isFinite(m.etapes_max) ? ` (${String(m.etapes_faites)}/${String(m.etapes_max)} étapes)` : '';
    const conception = m.type === 'conception' && m.conception_id
      ? ` · conception enregistrée ${m.conception_id} → 3D : studio_preparer_3d { conception_id: "${m.conception_id}" }`
      : '';
    return `- mission ${m.id} · ${m.type} · statut « ${m.statut} » = ${statut}${fin ? ` le ${fin}` : ''}${etapes}${m.erreur ? ` · erreur : ${m.erreur.slice(0, 120)}` : ''}${conception}`;
  });
  return [
    '---',
    '# ÉTAT RÉEL DES MISSIONS DE CETTE CONVERSATION (relu en base à l’instant — FAIT FOI)',
    'Les statuts écrits plus haut dans la conversation (« devis », « en cours »…) ou dans d’anciens résultats d’outils sont',
    'PÉRIMÉS dès qu’ils diffèrent de ce bloc. Ne dis jamais qu’une mission est au statut devis, en cours ou non lancée si ce bloc',
    'la dit terminée ; inutile d’appeler etat_mission pour le vérifier.',
    ...lignes,
    '---',
  ].join('\n');
}

/** Consigne du tour quand l'utilisateur demande la plaquette (index.ts, outils Studio proposés). */
export function consignePlaquette(dispo: readonly string[] = VUES_DISPONIBLES): string {
  const pack = vuesPackPlaquette(dispo);
  return 'PLAQUETTE DEMANDÉE (pack de visuels de commercialisation). Fie-toi à l’ÉTAT RÉEL DES MISSIONS ci-dessus : ' +
    'si une mission de conception est TERMINÉE, appelle studio_preparer_3d avec son conception_id, puis, DANS LE MÊME TOUR, ' +
    'studio_lancer_rendu avec type « image » et pack « plaquette », SANS `vues` ni `fond` : le serveur choisit les vues ' +
    `(celles du brief projet si elles sont enregistrées, sinon le pack plaquette : ${String(pack.length)} vues — ${phraseVues(pack)}). ` +
    'N’annonce QUE les vues et la durée renvoyées par l’outil (data.vues_prevues, data.duree_prevue ou le devis) — jamais « 3 visuels » ' +
    'ni « trois-quarts gauche, trois-quarts droite, face » de toi-même. Sans mission de conception terminée : dis-le en une phrase et propose-la.';
}
