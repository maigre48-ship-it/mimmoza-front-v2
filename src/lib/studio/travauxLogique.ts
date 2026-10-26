// src/lib/studio/travauxLogique.ts
//
// FILM OU VISITE 360° EN 3 CLICS — logique pure de la file `studio_jobs`.
//
// Construction du travail depuis la fiche de l'Espace 3D, options par défaut
// et validation (mêmes règles que la base), libellés d'état en français
// courant, liste des éléments omis. Aucun import de Supabase ni de React :
// testé avec node:test (travauxLogique.test.ts). Le service réseau est dans
// travaux.ts.

import { parseJarvisDraft, type JarvisDraft } from '../../spaces/copilot/studio3d/jarvisDraft.ts';
import type { ProjetMimmozaV2 } from '../../spaces/promoteur/shared/echangeStudio/mimmozaProjetV2.ts';
import { lireElementsOmis, type ElementOmis } from './manifesteVisite.ts';

export type { ElementOmis } from './manifesteVisite.ts';

export type TypeTravail = 'film' | 'visite360';
export type StatutTravail = 'en_attente' | 'en_cours' | 'termine' | 'echec' | 'annule';
export type Ambiance = 'jour' | 'fin_de_journee' | 'nuit';

export interface OptionsFilm {
  duree_s: 30 | 60 | 90;
  ambiance: Ambiance;
  format: '16:9' | '9:16';
  interieurs: boolean;
  musique: boolean;
}

export interface OptionsVisite {
  ambiance: Ambiance;
  interieurs: boolean;
  resolution: '6k' | '8k';
}

export type OptionsTravail = OptionsFilm | OptionsVisite;

/** `resultat` d'un film terminé (chemins dans le bucket privé `studio-rendus`). */
export interface ResultatFilm {
  video_path: string;
  poster_path?: string | null;
  duree_s?: number | null;
  avertissements: string[];
}

/** `resultat` d'une visite terminée (chemins dans le bucket public `visites`). */
export interface ResultatVisite {
  visite_id: string;
  manifest_path: string;
  panoramas?: number | null;
  avertissements: string[];
}

/**
 * Contenu de `studio_jobs.fiche`. `charge` = EXACTEMENT le projet Mimmoza v2
 * envoyé au Studio par « Voir en 3D » (terrain compris), construit par
 * preparerChargeVoirEn3D (src/spaces/copilot/studio3d/chargeVoirEn3D.ts).
 * Le worker ne reconstruit rien à partir du draft, gardé pour mémoire.
 */
export interface FicheTravail {
  version: 1;
  charge: ProjetMimmozaV2;
  draft: JarvisDraft;
  titre: string;
  conversation_id: string;
}

/** Ligne `studio_jobs` lue depuis la base (normalisée). */
export interface TravailStudio {
  id: string;
  conversation_id: string | null;
  type: TypeTravail;
  statut: StatutTravail;
  progression: number;
  etape: string | null;
  options: Record<string, unknown>;
  resultat: ResultatFilm | ResultatVisite | null;
  elements_omis: ElementOmis[];
  erreur: string | null;
  cree_le: string;
  maj_le: string;
  demarre_le: string | null;
  termine_le: string | null;
}

/** Ligne à insérer (le serveur force statut, suivi et dates). */
export interface NouveauTravail {
  user_id?: string;
  conversation_id: string;
  type: TypeTravail;
  fiche: FicheTravail;
  options: OptionsTravail;
}

export const OPTIONS_FILM_DEFAUT: Readonly<OptionsFilm> = Object.freeze({
  duree_s: 60, ambiance: 'jour', format: '16:9', interieurs: true, musique: true,
});

export const OPTIONS_VISITE_DEFAUT: Readonly<OptionsVisite> = Object.freeze({
  ambiance: 'jour', interieurs: true, resolution: '6k',
});

export const NOMBRE_MAX_TRAVAUX_ACTIFS = 2;

export const LIBELLES_AMBIANCE: Record<Ambiance, string> = {
  jour: 'En journée', fin_de_journee: 'Fin de journée', nuit: 'De nuit',
};

export const LIBELLES_TYPE: Record<TypeTravail, string> = { film: 'Film', visite360: 'Visite 360°' };

export function optionsParDefaut(type: 'film'): OptionsFilm;
export function optionsParDefaut(type: 'visite360'): OptionsVisite;
export function optionsParDefaut(type: TypeTravail): OptionsTravail;
export function optionsParDefaut(type: TypeTravail): OptionsTravail {
  return type === 'film' ? { ...OPTIONS_FILM_DEFAUT } : { ...OPTIONS_VISITE_DEFAUT };
}

export type Validation<T> = { ok: true; valeur: T } | { ok: false; erreur: string };

const AMBIANCES: readonly Ambiance[] = ['jour', 'fin_de_journee', 'nuit'];
const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Valide les options (mêmes règles que `_studio_job_options_valides` en base). Les absentes prennent la valeur par défaut. */
export function validerOptions(type: TypeTravail, brut: unknown): Validation<OptionsTravail> {
  if (type !== 'film' && type !== 'visite360') return { ok: false, erreur: 'Type de rendu inconnu.' };
  if (brut !== undefined && !estObjet(brut)) return { ok: false, erreur: 'Options illisibles.' };
  const o = (brut ?? {}) as Record<string, unknown>;
  const permises = type === 'film' ? ['duree_s', 'ambiance', 'format', 'interieurs', 'musique'] : ['ambiance', 'interieurs', 'resolution'];
  const inconnue = Object.keys(o).find(k => !permises.includes(k));
  if (inconnue) return { ok: false, erreur: `Option inconnue : ${inconnue}.` };
  const defaut = optionsParDefaut(type);
  const ambiance = o.ambiance ?? defaut.ambiance;
  if (!AMBIANCES.includes(ambiance as Ambiance)) return { ok: false, erreur: 'Choisissez une ambiance : journée, fin de journée ou nuit.' };
  const interieurs = o.interieurs ?? defaut.interieurs;
  if (typeof interieurs !== 'boolean') return { ok: false, erreur: 'Indiquez si les intérieurs sont inclus.' };
  if (type === 'film') {
    const d = defaut as OptionsFilm;
    const duree = o.duree_s ?? d.duree_s;
    if (duree !== 30 && duree !== 60 && duree !== 90) return { ok: false, erreur: 'La durée du film doit être de 30, 60 ou 90 secondes.' };
    const format = o.format ?? d.format;
    if (format !== '16:9' && format !== '9:16') return { ok: false, erreur: 'Le format doit être paysage (16:9) ou vertical (9:16).' };
    const musique = o.musique ?? d.musique;
    if (typeof musique !== 'boolean') return { ok: false, erreur: 'Indiquez si le film a une musique.' };
    return { ok: true, valeur: { duree_s: duree, ambiance: ambiance as Ambiance, format, interieurs, musique } };
  }
  const resolution = o.resolution ?? (defaut as OptionsVisite).resolution;
  if (resolution !== '6k' && resolution !== '8k') return { ok: false, erreur: 'La qualité doit être 6K ou 8K.' };
  return { ok: true, valeur: { ambiance: ambiance as Ambiance, interieurs, resolution } };
}

/** Titre lisible du film ou de la visite, tiré de la fiche (« 12 logements — 12 rue des Lilas, Lyon »). */
export function titreDepuisFiche(draft: JarvisDraft): string {
  const parties = [draft.programme, draft.localisation].map(v => v?.trim()).filter((v): v is string => Boolean(v));
  const titre = (parties.length ? parties.join(' — ') : draft.objectif?.trim() || 'Projet Mimmoza').replace(/\s+/g, ' ');
  return titre.length > 120 ? `${titre.slice(0, 119)}…` : titre;
}

/** Charge Studio exploitable : un objet projet Mimmoza v2 avec son identifiant. */
export function chargeValide(charge: unknown): charge is ProjetMimmozaV2 {
  return estObjet(charge) && typeof charge.projetId === 'string' && charge.projetId.trim() !== '';
}

/** Construit la fiche jointe au travail : charge « Voir en 3D » + fiche de la conversation. */
export function construireFiche(draftBrut: unknown, conversationId: string, charge: unknown): Validation<FicheTravail> {
  const draft = parseJarvisDraft(draftBrut);
  if (!conversationId?.trim()) return { ok: false, erreur: 'Ouvrez d’abord une conversation.' };
  if (!draft?.objectif?.trim()) return { ok: false, erreur: 'Décrivez d’abord le projet dans la conversation.' };
  if (!chargeValide(charge)) return { ok: false, erreur: 'Le projet n’a pas pu être préparé pour le Studio. Réessayez.' };
  return { ok: true, valeur: { version: 1, charge, draft, titre: titreDepuisFiche(draft), conversation_id: conversationId } };
}

/** Construit la ligne à insérer dans `studio_jobs` (clic « Lancer »). */
export function construireTravail(type: TypeTravail, draft: unknown, conversationId: string, charge: unknown, options: unknown): Validation<NouveauTravail> {
  const opts = validerOptions(type, options);
  if (!opts.ok) return opts;
  const fiche = construireFiche(draft, conversationId, charge);
  if (!fiche.ok) return fiche;
  return { ok: true, valeur: { conversation_id: conversationId, type, fiche: fiche.valeur, options: opts.valeur } };
}

export function estActif(statut: StatutTravail): boolean {
  return statut === 'en_attente' || statut === 'en_cours';
}

/** Libellé court de l'état, pour une pastille. */
export function libelleStatut(statut: StatutTravail): string {
  switch (statut) {
    case 'en_attente': return 'En attente';
    case 'en_cours': return 'En préparation';
    case 'termine': return 'Prêt';
    case 'echec': return 'Échec';
    case 'annule': return 'Annulé';
  }
}

/** Phrase de suivi affichée sous la barre de progression. */
export function phraseSuivi(travail: Pick<TravailStudio, 'type' | 'statut' | 'etape' | 'progression' | 'erreur'>): string {
  const quoi = travail.type === 'film' ? 'Votre film' : 'Votre visite 360°';
  switch (travail.statut) {
    case 'en_attente': return `${quoi} est dans la file : la préparation démarre dès que le Studio est libre.`;
    case 'en_cours': return travail.etape?.trim() ? `${travail.etape.trim()} — ${String(borner(travail.progression))} %` : `Préparation en cours — ${String(borner(travail.progression))} %`;
    case 'termine': return `${quoi} est prêt${travail.type === 'visite360' ? 'e' : ''}.`;
    case 'echec': return travail.erreur?.trim() ? `La préparation n’a pas abouti : ${travail.erreur.trim()}` : 'La préparation n’a pas abouti. Vous pouvez relancer.';
    case 'annule': return 'Préparation annulée.';
  }
}

function borner(n: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));
}

/** Phrase listant les éléments retirés faute d'asset photoréaliste ; `null` si aucun. */
export function phraseElementsOmis(liste: unknown): string | null {
  const elements = lireElementsOmis(liste);
  if (!elements.length) return null;
  return `Pour garder un rendu photoréaliste, ces éléments n’ont pas été ajoutés : ${elements.map(e => e.categorie).join(', ')}.`;
}

/** Résumé d'une ligne des options, pour l'historique. */
export function resumeOptions(type: TypeTravail, options: unknown): string {
  const v = validerOptions(type, options);
  const o = v.ok ? v.valeur : optionsParDefaut(type);
  const parts: string[] = [];
  if (type === 'film') {
    const f = o as OptionsFilm;
    parts.push(`${String(f.duree_s)} s`, LIBELLES_AMBIANCE[f.ambiance].toLowerCase(), f.format === '16:9' ? 'paysage' : 'vertical');
    if (f.interieurs) parts.push('intérieurs');
    if (f.musique) parts.push('musique');
  } else {
    const vi = o as OptionsVisite;
    parts.push(LIBELLES_AMBIANCE[vi.ambiance].toLowerCase(), vi.resolution.toUpperCase());
    if (vi.interieurs) parts.push('intérieurs');
  }
  return parts.join(' · ');
}

const STATUTS: readonly StatutTravail[] = ['en_attente', 'en_cours', 'termine', 'echec', 'annule'];
const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function lireResultat(type: TypeTravail, brut: unknown): ResultatFilm | ResultatVisite | null {
  if (!estObjet(brut)) return null;
  const avertissements = Array.isArray(brut.avertissements) ? brut.avertissements.filter((a): a is string => typeof a === 'string' && a.trim() !== '') : [];
  if (type === 'film') {
    const video = texte(brut.video_path);
    if (!video) return null;
    return { video_path: video, poster_path: texte(brut.poster_path), duree_s: typeof brut.duree_s === 'number' ? brut.duree_s : null, avertissements };
  }
  const visite = texte(brut.visite_id);
  if (!visite || !/^[A-Za-z0-9_-]{8,64}$/.test(visite)) return null;
  return { visite_id: visite, manifest_path: texte(brut.manifest_path) ?? `${visite}/manifest.json`, panoramas: typeof brut.panoramas === 'number' ? brut.panoramas : null, avertissements };
}

/** Normalise une ligne `studio_jobs` ; `null` si inexploitable. */
export function lireTravail(brut: unknown): TravailStudio | null {
  if (!estObjet(brut)) return null;
  const id = texte(brut.id);
  const type = brut.type === 'film' || brut.type === 'visite360' ? brut.type : null;
  const statut = STATUTS.includes(brut.statut as StatutTravail) ? brut.statut as StatutTravail : null;
  if (!id || !type || !statut) return null;
  return {
    id, type, statut,
    conversation_id: texte(brut.conversation_id),
    progression: borner(typeof brut.progression === 'number' ? brut.progression : 0),
    etape: texte(brut.etape),
    options: estObjet(brut.options) ? brut.options : {},
    resultat: lireResultat(type, brut.resultat),
    elements_omis: lireElementsOmis(brut.elements_omis),
    erreur: texte(brut.erreur),
    cree_le: texte(brut.cree_le) ?? '',
    maj_le: texte(brut.maj_le) ?? '',
    demarre_le: texte(brut.demarre_le),
    termine_le: texte(brut.termine_le),
  };
}

/** Adresse publique d'une visite (page /visite/:visiteId). */
export function lienVisite(visiteId: string, origine: string): string {
  return `${origine.replace(/\/+$/, '')}/visite/${encodeURIComponent(visiteId)}`;
}

/** Vrai si l'erreur Supabase signifie « la file n'existe pas encore » (migration non appliquée). */
export function fileIndisponible(erreur: unknown): boolean {
  if (!estObjet(erreur)) return false;
  const code = typeof erreur.code === 'string' ? erreur.code : '';
  const message = typeof erreur.message === 'string' ? erreur.message : '';
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202') return true;
  return /studio_jobs/.test(message) && /(does not exist|could not find|schema cache)/i.test(message);
}

/** Message clair pour une erreur de création ou d'annulation. */
export function messageErreurTravail(erreur: unknown): string {
  if (fileIndisponible(erreur)) return 'Films et visites 360° : bientôt disponible.';
  const message = estObjet(erreur) && typeof erreur.message === 'string' ? erreur.message : erreur instanceof Error ? erreur.message : '';
  if (/déjà 2 films ou visites/.test(message)) return message;
  if (/Options du travail invalides/.test(message)) return 'Ces options ne sont pas acceptées. Rechargez la page puis réessayez.';
  if (/row-level security|permission denied|JWT/i.test(message)) return 'Connectez-vous pour lancer un film ou une visite.';
  return 'Le lancement n’a pas abouti. Réessayez dans un instant.';
}

/** Date courte en français (« 26 oct., 14:32 »). */
export function dateCourte(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
