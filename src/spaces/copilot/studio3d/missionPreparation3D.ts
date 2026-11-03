import type { Mission } from '../agent/agent.types';
import type { JarvisDraft } from './jarvisDraft';
const STATUTS = new Set(['en_attente','en_cours','attente_utilisateur','terminee','budget_atteint']);

// --- Références cadastrales : une seule normalisation pour critères, rapport et parcelle ---
/** Format IDU (14 caractères) : INSEE (5, Corse 2A/2B) + préfixe (3) + section (2) + numéro (4). */
export const FORMAT_IDU = /^(?:2[AB]\d{3}|\d{5})\d{3}[0-9A-Z]{2}\d{4}$/;
/** Espaces retirés, majuscules, format contrôlé ; null si ce n'est pas un IDU lisible. */
export function normaliserIdu(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null;
  const idu = valeur.replace(/\s+/g, '').toUpperCase();
  return FORMAT_IDU.test(idu) ? idu : null;
}
/** Clés de critères désignant UNE parcelle (texte libre rédigé par le modèle). */
const CLES_PARCELLE = ['idu', 'parcelle', 'parcelle_idu', 'idu_parcelle', 'reference_cadastrale', 'ref_cadastrale', 'reference', 'terrain'] as const;
/** Clés dont la valeur est forcément une référence cadastrale (comparées même si illisibles). */
const CLES_REFERENCE_STRICTE = ['idu', 'parcelle_idu', 'idu_parcelle', 'reference_cadastrale', 'ref_cadastrale'] as const;
/** Clés de critères pouvant lister PLUSIEURS parcelles. */
const CLES_LISTES = ['terrains', 'parcelles', 'parcel_ids', 'idus', 'references_cadastrales', 'refs_cadastrales', 'references'] as const;
const iduDeValeur = (v: unknown): string | null =>
  normaliserIdu(v) ?? (v && typeof v === 'object' && !Array.isArray(v) ? normaliserIdu((v as Record<string, unknown>).idu) : null);

/** IDU de la parcelle confirmée : propriété idu/parcel_id/id, sinon reconstruit depuis INSEE + préfixe + section + numéro (jamais le libellé « AJ 209 »). */
export function iduDeParcelle(parcel: { properties?: Record<string, unknown> | null } | null | undefined): string | null {
  const p = parcel?.properties ?? {};
  for (const cle of ['idu', 'parcel_id', 'id']) { const idu = normaliserIdu(p[cle]); if (idu) return idu; }
  const insee = String(p.code_insee ?? '').trim();
  const prefixe = String(p.com_abs ?? p.prefixe ?? '000').trim().padStart(3, '0');
  const section = String(p.section ?? p.SECTION ?? '').trim().toUpperCase().padStart(2, '0');
  const numero = String(p.numero ?? p.NUMERO ?? '').trim().padStart(4, '0');
  return insee && section && numero ? normaliserIdu(insee + prefixe + section + numero) : null;
}

export interface ReferencesMission { idus: string[]; plusieurs: boolean }
/** Toutes les références cadastrales lisibles de la mission (critères + rapport), dédoublonnées après normalisation. */
export function referencesMission(m: Mission): ReferencesMission {
  const c = (m.criteres ?? {}) as Record<string, unknown>;
  const idus = new Set<string>(); let plusieurs = false;
  for (const cle of CLES_PARCELLE) { const idu = iduDeValeur(c[cle]); if (idu) idus.add(idu); }
  for (const cle of [...CLES_LISTES, ...CLES_PARCELLE]) {
    const v = c[cle];
    if (!Array.isArray(v)) continue;
    if (v.length > 1) plusieurs = true;
    for (const e of v) { const idu = iduDeValeur(e); if (idu) idus.add(idu); }
  }
  const terrains = Array.isArray(m.rapport?.terrains) ? m.rapport!.terrains : [];
  if (terrains.length > 1) plusieurs = true;
  for (const t of terrains) { const idu = iduDeValeur(t); if (idu) idus.add(idu); }
  // Références illisibles (hors format IDU) : non retenues comme attendues, mais deux valeurs différentes restent une contradiction.
  const brutes = new Set<string>();
  const brute = (v: unknown) => { if (typeof v === 'string' && v.trim()) brutes.add(normaliserIdu(v) ?? v.replace(/\s+/g, '').toUpperCase()); };
  for (const cle of CLES_REFERENCE_STRICTE) brute(c[cle]);
  for (const t of terrains) brute((t as unknown as Record<string, unknown> | null)?.idu);
  return { idus: [...idus], plusieurs: plusieurs || idus.size > 1 || brutes.size > 1 };
}

const MOTS_BATIMENT = /\b(maisons?|villas?|immeubles?|b[âa]timents?|r[ée]sidences?|logements?|appartements?|construction|construire|r[ée]novation|r[ée]habilitation|extension|sur[ée]l[ée]vation|programme)\b|\bR\s*\+\s*\d{1,2}\b/i;
const MOTS_FAISABILITE = /faisabilit|\bparcelle\b|\bterrain\b|\bfoncier\b|\bconstructibilit/i;
const EXCLUSIONS = /(?:comparer|comparaison|rechercher|recherche\s+de|prospect)/i;
const PLUSIEURS_TERRAINS = /\b(?:[2-9]|[1-9]\d+|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|plusieurs)\s+(?:terrains?|parcelles?)\b/i;

export function missionVisualisable(m: Mission | null, conversationId: string | null): boolean {
  if (!m || !conversationId || m.conversation_id !== conversationId || !STATUTS.has(m.statut) || m.erreur) return false;
  if (!['faisabilite','libre'].includes(m.type)) return false;
  // Plusieurs terrains, ou critères et rapport désignant des parcelles différentes : pas de choix arbitraire.
  const refs = referencesMission(m);
  if (refs.plusieurs) return false;
  const t = m.objectif ?? '';
  if (EXCLUSIONS.test(t) || PLUSIEURS_TERRAINS.test(t)) return false;
  if (MOTS_BATIMENT.test(t)) return true;
  // Faisabilité d'un terrain : pas de mots exacts exigés, une parcelle identifiée ou le sujet foncier suffit.
  if (m.type === 'faisabilite') return refs.idus.length === 1 || MOTS_FAISABILITE.test(t);
  return refs.idus.length === 1;
}
export function ficheObjectifMission(m: Mission): JarvisDraft {
  return { version: 1, objectif: m.objectif, dimensions: null, localisation: null, programme: null, style: null, contraintes: null, questions: [], pieces: [] };
}
/** IDU attendu (normalisé) si la mission en désigne exactement un. */
export function iduAttenduMission(m: Mission): string | null {
  const refs = referencesMission(m);
  return !refs.plusieurs && refs.idus.length === 1 ? refs.idus[0] : null;
}
/** Confirmation de parcelle liée à UNE mission et UNE conversation (état du panneau, pas reconstruite). */
export interface ConfirmationParcelleMission { missionId: string; conversationId: string; parcelId: string }
export function verifierTerrainMission(missionId: string, conversationId: string, confirmation: ConfirmationParcelleMission, attendu: string | null): void {
  if (confirmation.missionId !== missionId || confirmation.conversationId !== conversationId) throw new Error('Cette parcelle a été confirmée pour une autre mission ou conversation.');
  if (!attendu) return;
  const choisie = normaliserIdu(confirmation.parcelId);
  if (!choisie) throw new Error('La référence cadastrale de la parcelle choisie est illisible ; elle ne peut pas être comparée à celle de la mission (' + attendu + ').');
  if (choisie !== normaliserIdu(attendu)) throw new Error('Cette parcelle ne correspond pas à celle de la mission (' + attendu + ').');
}
/** Verrou avant le premier await, identité et statut serveur relus au clic ; aucun lancement ni appel IA. */
export function creerActionVisualisationMission(options: {
  missionId: string; conversationId: string; lire: (id: string) => Promise<Mission | null>;
  courante: () => boolean; ouvrir: (m: Mission) => void | Promise<void>;
}) {
  let enCours = false;
  return async () => {
    if (enCours) return;
    enCours = true;
    try {
      const m = await options.lire(options.missionId);
      if (!options.courante()) throw new Error('La conversation ou la mission a changé. Rouvrez la préparation depuis sa carte.');
      if (!m || m.id !== options.missionId || !missionVisualisable(m, options.conversationId)) throw new Error('Cette mission ne permet plus d’ouvrir une préparation 3D.');
      await options.ouvrir(m);
    } finally { enCours = false; }
  };
}

/** Aucun résultat d'une attente ne peut ouvrir l'ancienne mission après navigation/fermeture. */
export async function attendreMissionCourante<T>(courante: () => boolean, action: () => Promise<T>): Promise<T> {
  if (!courante()) throw new Error('La préparation de mission a changé.');
  const resultat = await action();
  if (!courante()) throw new Error('La préparation de mission a changé pendant le transfert.');
  return resultat;
}

// --- Maquette déjà chargée dans Studio : jamais remplacée sans choix explicite ---
export interface EtatMaquette { chargee: boolean; conversationId: string | null }
export class MaquetteDejaChargeeError extends Error {
  readonly memeConversation: boolean;
  constructor(memeConversation: boolean) {
    super(memeConversation
      ? 'Une maquette de cette conversation est déjà chargée dans Studio. Remplacez-la par ce projet, ou fermez-la d’abord.'
      : 'Une maquette d’une autre conversation est chargée dans Studio. Remplacez-la par ce projet, ou fermez-la d’abord.');
    this.name = 'MaquetteDejaChargeeError';
    this.memeConversation = memeConversation;
  }
}
export function controlerMaquetteChargee(etat: EtatMaquette, conversationId: string, remplacer: boolean): void {
  if (etat.chargee && !remplacer) throw new MaquetteDejaChargeeError(etat.conversationId === conversationId);
}
/**
 * Transfert d'une mission : maquette contrôlée AVANT toute entrée/sortie (relief, fichiers, signatures, panorama),
 * puis mission/conversation et maquette recontrôlées après l'attente.
 */
export async function preparerTransfertMission<T>(options: {
  conversationId: string; remplacer: boolean; maquette: () => EtatMaquette; courante: () => boolean; preparer: () => Promise<T>;
}): Promise<T> {
  controlerMaquetteChargee(options.maquette(), options.conversationId, options.remplacer);
  const resultat = await attendreMissionCourante(options.courante, options.preparer);
  controlerMaquetteChargee(options.maquette(), options.conversationId, options.remplacer);
  return resultat;
}

// --- Point de départ : la fiche ENREGISTRÉE de la conversation, jamais la dernière proposition du chat ---
export type PointDeDepart =
  | { type: 'enregistree'; fiche: JarvisDraft; statut: 'draft' | 'validated'; majLe: string }
  | { type: 'aucune' }
  | { type: 'erreur'; message: string };
export async function chargerPointDeDepart(
  conversationId: string,
  charger: (id: string) => Promise<{ draft: JarvisDraft; status: 'draft' | 'validated'; updatedAt: string } | null>,
): Promise<PointDeDepart> {
  try {
    const r = await charger(conversationId);
    return r ? { type: 'enregistree', fiche: r.draft, statut: r.status, majLe: r.updatedAt } : { type: 'aucune' };
  } catch (e) {
    return { type: 'erreur', message: e instanceof Error ? e.message : 'Lecture impossible.' };
  }
}
