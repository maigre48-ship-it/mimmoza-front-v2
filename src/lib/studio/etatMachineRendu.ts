/**
 * VIS-60 — ÉTAT DE LA MACHINE DE RENDU vu par le client (module PUR, testé : etatMachineRendu.test.ts).
 *
 * Deux sources, la meilleure d'abord :
 *   1. le SIGNAL DE VIE (migration 20261127010000_vis60_signal_vie_machine.sql, rpc `studio_machine_etat`) : le worker
 *      signale sa présence toutes les 60 s, au repos comme pendant un rendu → « hors ligne depuis … » est exact
 *      (à une minute près), calculé sur l'horloge du SERVEUR ;
 *   2. à défaut (migration non appliquée, worker pas encore rebranché) : l'état est DÉDUIT de la file (dernière écriture
 *      d'un travail) et formulé comme une déduction — jamais affirmé.
 * Règle de facturation affichée : AUCUN débit tant que le rendu n'a pas démarré (aujourd'hui les rendus ne sont pas
 * facturés du tout : `jetons: 0` dans le devis de copilot-chat ; la phrase reste vraie quand ils le seront, à condition
 * de débiter au démarrage effectif — voir le rapport VIS-60).
 */

/** Intervalle du signal du worker (worker/src/signalVie.ts). */
export const INTERVALLE_SIGNAL_S = 60;
/** Au-delà de 3 signaux manqués, la machine est tenue pour hors ligne. */
export const SEUIL_HORS_LIGNE_MS = 3 * INTERVALLE_SIGNAL_S * 1000;
/** Sans signal de vie : une écriture de travail de moins de 10 min vaut « active récemment ». */
export const ACTIVITE_RECENTE_MS = 10 * 60_000;

export interface SignalMachine {
  vu_le: string;
  demarre_le?: string | null;
  etat: 'pret' | 'occupe' | 'arret_demande' | 'degrade' | string;
  diagnostic?: { unreal?: boolean; disque_assets?: boolean; raison?: string } | null;
  /** Horloge de la base au moment de la lecture (ISO). */
  maintenant?: string | null;
}

export interface TravailFile {
  statut: string;
  cree_le: string;
  demarre_le?: string | null;
  maj_le?: string | null;
  termine_le?: string | null;
}

export type EtatMachineRendu = 'en_ligne' | 'occupee' | 'degradee' | 'hors_ligne' | 'inconnue';

export interface VueMachineRendu {
  etat: EtatMachineRendu;
  /** Vrai seulement avec un signal de vie (sinon déduction). */
  certain: boolean;
  /** Durée hors ligne (ms) quand etat = hors_ligne et certain. */
  horsLigneDepuisMs: number | null;
  /** Phrase courte du bandeau. */
  titre: string;
  /** Phrase pour le client dont un travail attend (null si aucun travail n'attend). */
  messageClient: string | null;
  /** Rappel de facturation (toujours vrai tant qu'aucun travail en attente n'a démarré). */
  facturation: string;
}

export const PHRASE_AUCUN_DEBIT = 'Rien n’est débité tant que le rendu n’a pas démarré.';

/**
 * Durée lisible et JUSTE (arrondie vers le bas : on n'annonce jamais plus que le réel) :
 * « moins d’une minute », « 7 min », « 2 h 05 », « 3 jours 4 h ».
 */
export function dureeLisible(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return 'moins d’une minute';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resteMin = min % 60;
  if (h < 48) return resteMin ? `${h} h ${String(resteMin).padStart(2, '0')}` : `${h} h`;
  const j = Math.floor(h / 24);
  const resteH = h % 24;
  return resteH ? `${j} jours ${resteH} h` : `${j} jours`;
}

/** Date et heure de Paris, « 26/11 à 21 h 23 ». */
export function heureParisCourte(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('day')}/${v('month')} à ${v('hour')} h ${v('minute')}`;
}

const t = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN);

/** Libellé du travail qui attend (« Votre film », « Votre visite 360° »…). */
export function libelleTravailAttente(type: string | null | undefined): string {
  return type === 'film' ? 'Votre film' : type === 'visite360' ? 'Votre visite 360°' : type === 'image' ? 'Vos images' : 'Votre rendu';
}

/**
 * État de la machine pour l'écran du client.
 * @param signal  ligne de `studio_machine_etat()` (null : rpc absente ou aucune ligne)
 * @param file    travaux VISIBLES du client (les siens), pour savoir si l'un attend
 * @param derniereActiviteFile  dernière écriture d'un travail, toutes files confondues (repli sans signal)
 */
export function vueMachineRendu(o: {
  signal: SignalMachine | null;
  file: readonly (TravailFile & { type?: string })[];
  derniereActiviteFile?: string | null;
  maintenant: number;
}): VueMachineRendu {
  const enAttente = o.file.filter((x) => x.statut === 'en_attente');
  const attente = enAttente.length ? enAttente.reduce((a, b) => (t(a.cree_le) <= t(b.cree_le) ? a : b)) : null;
  const facturation = PHRASE_AUCUN_DEBIT;

  if (o.signal && Number.isFinite(t(o.signal.vu_le))) {
    // Horloge du serveur si fournie : la durée ne dépend pas de l'heure (parfois fausse) du PC du client.
    const maintenant = Number.isFinite(t(o.signal.maintenant)) ? t(o.signal.maintenant) : o.maintenant;
    const ecart = Math.max(0, maintenant - t(o.signal.vu_le));
    if (ecart > SEUIL_HORS_LIGNE_MS) {
      const depuis = dureeLisible(ecart);
      return {
        etat: 'hors_ligne', certain: true, horsLigneDepuisMs: ecart,
        titre: `Machine de rendu hors ligne depuis ${depuis} (dernier signal le ${heureParisCourte(o.signal.vu_le)}).`,
        messageClient: attente
          ? `${libelleTravailAttente(attente.type)} attend la machine de rendu, hors ligne depuis ${depuis}. Il démarrera automatiquement dès son retour, sans rien relancer. ${facturation}`
          : null,
        facturation,
      };
    }
    const diag = o.signal.diagnostic ?? null;
    if (o.signal.etat === 'degrade' || diag?.unreal === false || diag?.disque_assets === false) {
      const raison = diag?.raison ?? (diag?.unreal === false ? 'moteur 3D introuvable' : diag?.disque_assets === false ? 'disque des assets absent' : 'en maintenance');
      return {
        etat: 'degradee', certain: true, horsLigneDepuisMs: null,
        titre: `Machine de rendu allumée mais indisponible (${raison}).`,
        messageClient: attente ? `${libelleTravailAttente(attente.type)} attend : la machine de rendu est en maintenance. Il démarrera dès qu’elle sera rétablie. ${facturation}` : null,
        facturation,
      };
    }
    if (o.signal.etat === 'occupe') {
      return {
        etat: 'occupee', certain: true, horsLigneDepuisMs: null,
        titre: 'Machine de rendu en ligne, un rendu en cours (un seul à la fois).',
        messageClient: attente ? `${libelleTravailAttente(attente.type)} est dans la file : il démarrera après le rendu en cours. ${facturation}` : null,
        facturation,
      };
    }
    return {
      etat: 'en_ligne', certain: true, horsLigneDepuisMs: null,
      titre: o.signal.etat === 'arret_demande' ? 'Machine de rendu en ligne (arrêt programmé après le rendu en cours).' : 'Machine de rendu en ligne.',
      messageClient: attente ? `${libelleTravailAttente(attente.type)} va démarrer d’un instant à l’autre. ${facturation}` : null,
      facturation,
    };
  }

  // Repli : aucune source fiable. Formulé comme une DÉDUCTION.
  const activite = t(o.derniereActiviteFile);
  const ecart = Number.isFinite(activite) ? Math.max(0, o.maintenant - activite) : Number.POSITIVE_INFINITY;
  const enCours = o.file.some((x) => x.statut === 'en_cours');
  if (enCours && ecart <= ACTIVITE_RECENTE_MS) {
    return { etat: 'occupee', certain: false, horsLigneDepuisMs: null, titre: 'Machine de rendu active (un rendu en cours).', messageClient: attente ? `${libelleTravailAttente(attente.type)} est dans la file. ${facturation}` : null, facturation };
  }
  if (ecart <= ACTIVITE_RECENTE_MS) {
    return { etat: 'en_ligne', certain: false, horsLigneDepuisMs: null, titre: `Machine de rendu active il y a ${dureeLisible(ecart)}.`, messageClient: attente ? `${libelleTravailAttente(attente.type)} est dans la file. ${facturation}` : null, facturation };
  }
  const attenteMs = attente ? Math.max(0, o.maintenant - t(attente.cree_le)) : 0;
  const derniere = Number.isFinite(ecart) ? `dernière activité connue il y a ${dureeLisible(ecart)}` : 'aucune activité connue';
  return {
    etat: 'inconnue', certain: false, horsLigneDepuisMs: null,
    titre: `État de la machine de rendu non confirmé (${derniere}).`,
    messageClient: attente
      ? `${libelleTravailAttente(attente.type)} attend depuis ${dureeLisible(attenteMs)} : la machine de rendu ne s’est pas manifestée (${derniere}), elle est peut-être éteinte. Il démarrera automatiquement à son retour. ${facturation}`
      : null,
    facturation,
  };
}
