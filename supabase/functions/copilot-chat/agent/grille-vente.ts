// supabase/functions/copilot-chat/agent/grille-vente.ts
// =============================================================
// VIS-67 (27/11/2026) — GRILLE DE VENTE commandée par le chat Mimmoza (outil de vente du promoteur).
//
// Outil `grille_vente` : « montre-moi les T3 libres au-dessus du 2e étage orientés sud », « compare A203 et A305 ».
//   1. le SERVEUR lit la demande en filtre (module partagé src/lib/vente/filtreVente.ts, copie identique du Studio,
//      sans IA) ; les paramètres explicites du modèle la précisent ;
//   2. il rend la carte `commande-studio` (commande `grille-vente` du catalogue du pont, validée) : le SITE la transmet
//      au Studio, qui ouvre la grille filtrée (lots allumés sur la maquette 3D) et renvoie son compte rendu ;
//   3. si les lots du projet sont connus côté serveur (table `vente_lots`, migration VIS-67, écrite par le Studio), la
//      carte porte AUSSI une synthèse (nombre, statuts, fourchette de prix, premiers lots) que Mimmo peut citer.
// Sans table (migration non appliquée) ou sans lots : pas de synthèse, et Mimmo ne cite aucun lot (le Studio le fera).
// Module PUR (testé par Deno) — aucune dépendance à index.ts ; la lecture des lots est injectée (`lireLots`).
// =============================================================
import type { OutilDef, ResultatOutil } from './types.ts';
import { validerCommandeChat, PHRASE_EN_ATTENTE } from '../../../../src/spaces/promoteur/shared/echangeStudio/pontCommandesStudio.ts';
import {
  filtreDepuisParams, filtreDepuisPhrase, filtreVersParams, resumeFiltre, syntheseLots, euros, LIBELLES_STATUT,
  type FiltreVente, type LotFiltrable, type SyntheseLots, type StatutLot, type Orientation,
} from '../../../../src/lib/vente/filtreVente.ts';

export const OUTIL_GRILLE_VENTE = 'grille_vente';
export const SOURCE_GRILLE_VENTE = 'MimmozIA · Grille de vente';

export const OUTIL_GRILLE_VENTE_DEF: OutilDef = {
  name: OUTIL_GRILLE_VENTE,
  description:
    "GRILLE DE VENTE du projet (bureau de vente) : ouvre dans le Studio la maquette 3D où les lots qui correspondent s'allument, " +
    "avec fiche du lot, comparateur et statuts (libre / optionné / réservé / vendu). " +
    "QUAND : l'utilisateur cherche ou montre des lots — « montre-moi les T3 libres au-dessus du 2e étage orientés sud », " +
    "« les T2 à moins de 250 000 € avec balcon », « compare A203 et A305 », « qu'est-ce qui reste à vendre ? ». " +
    "COMMENT : `demande` = la phrase de l'utilisateur TELLE QUELLE (le serveur la lit sans IA) ; ajoute des paramètres " +
    "seulement pour préciser. « au-dessus du 2e étage » = etageMin 3. Pour changer un statut (« passe le A203 en réservé ») " +
    "ou le prix au m² de la grille, c'est `studio_commander` (commandes lot-statut, grille-vente-prix). " +
    "APRÈS L'APPEL : si une synthèse est rendue, cite ses chiffres (nombre de lots, fourchette de prix) en 2 phrases au plus ; " +
    "sinon ne cite AUCUN lot ni prix : la carte affichera le compte rendu du Studio.",
  input_schema: {
    type: 'object',
    properties: {
      demande: { type: 'string', description: 'La phrase de l’utilisateur, telle quelle.' },
      typologies: { type: 'string', description: 'T1, T2, T3, T4, T5, commerce (virgules).' },
      statuts: { type: 'string', description: 'libre, optionne, reserve, vendu (virgules).' },
      orientations: { type: 'string', description: 'nord, nord-est, est, sud-est, sud, sud-ouest, ouest, nord-ouest (virgules).' },
      etageMin: { type: 'number' }, etageMax: { type: 'number' },
      prixMin: { type: 'number' }, prixMax: { type: 'number' },
      surfaceMin: { type: 'number' }, surfaceMax: { type: 'number' },
      parkingsMin: { type: 'number' },
      exterieur: { type: 'boolean', description: 'Avec extérieur (vrai) ou sans (faux).' },
      comparer: { type: 'string', description: 'Lots à comparer, 2 ou 3 (« A203,A305 »).' },
      lot: { type: 'string', description: 'Lot dont la fiche s’ouvre.' },
    },
  },
  available_in_modes: ['quick', 'advanced', 'report'],
};

const sansAccents = (t: string): string => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’]/g, "'");

/** Le tour parle de lots à montrer / chercher / comparer (outil proposé au modèle). Pur. */
export function grilleVentePertinente(textes: readonly string[]): boolean {
  return textes.some((brut) => {
    const t = sansAccents(brut ?? '');
    if (/\bgrille de (vente|prix)\b|\bbureau de vente\b|\bplan de vente\b.*\blots?\b/.test(t)) return true;
    const objet = /\b(t[1-5]|lots?|appartements?|apparts?|logements?|studios?|commerces?|\d pieces|[a-z]\d{3,4})\b/.test(t);
    const geste = /\b(libre|disponible|dispo|vendu|reserv|option|reste a vendre|orient|expos|etage|au-dessus|rdc|prix|compar|filtr|montre|affiche|liste|allume|cherche|trouve)|€|\bm2\b|m²/.test(t);
    return objet && geste;
  });
}

/** Ligne de `vente_lots` (instantané écrit par le Studio). */
export interface LigneVenteLot {
  lot_id?: unknown; niveau?: unknown; typologie?: unknown; shab_m2?: unknown; exterieur_m2?: unknown; orientation?: unknown;
  azimuts_deg?: unknown; parkings?: unknown; prix_grille_eur?: unknown; prix_force_eur?: unknown; statut?: unknown; empreinte_modele?: unknown; maj_le?: unknown;
}

const num = (v: unknown): number | null => { const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };

/** Lignes de la table → lots filtrables (empreinte la plus récente seulement). Pur. */
export function lotsDepuisLignes(lignes: readonly LigneVenteLot[]): LotFiltrable[] {
  if (!lignes.length) return [];
  const recente = [...lignes].sort((a, b) => String(b.maj_le ?? '').localeCompare(String(a.maj_le ?? '')))[0]!.empreinte_modele;
  return lignes.filter((l) => l.empreinte_modele === recente).flatMap((l) => {
    const id = typeof l.lot_id === 'string' ? l.lot_id : null;
    const niveau = num(l.niveau), shab = num(l.shab_m2);
    if (!id || niveau === null || shab === null || typeof l.typologie !== 'string') return [];
    const statut = (['libre', 'optionne', 'reserve', 'vendu'] as const).includes(l.statut as StatutLot) ? l.statut as StatutLot : 'libre';
    const az = Array.isArray(l.azimuts_deg) ? (l.azimuts_deg as unknown[]).map(num).filter((x): x is number => x !== null) : [];
    return [{
      id, lot: id, niveau, typologie: l.typologie, shabM2: shab, prixEur: num(l.prix_force_eur) ?? num(l.prix_grille_eur),
      azimutsDeg: az, orientation: typeof l.orientation === 'string' ? l.orientation as Orientation : null,
      exterieurM2: num(l.exterieur_m2) ?? 0, parkings: num(l.parkings) ?? 0, statut,
    }];
  });
}

export interface EnvGrilleVente {
  texteRecu: string;
  conversationId: string | null;
  /** Lecture des lots du projet (null : table absente ou aucun lot) — injectée par index.ts. */
  lireLots?: (conversationId: string) => Promise<LotFiltrable[] | null>;
  maintenant?: () => number;
}

/** Exécution de l'outil : filtre lu, commande `grille-vente` validée, synthèse si les lots sont connus. */
export async function executerOutilGrilleVente(input: Record<string, unknown>, env: EnvGrilleVente): Promise<ResultatOutil> {
  const demande = (typeof input.demande === 'string' && input.demande.trim() ? input.demande : env.texteRecu).replace(/\s+/g, ' ').trim().slice(0, 300);
  const lu = demande ? filtreDepuisPhrase(demande) : { filtre: {} as FiltreVente, comparer: [] as readonly string[], compris: [] as readonly string[] };
  const explicite = filtreDepuisParams(input);
  const filtre: FiltreVente = { ...lu.filtre, ...explicite };
  const comparer = typeof input.comparer === 'string' && input.comparer.trim()
    ? input.comparer.split(/[,;\s]+/).map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]\d{2,4}$/.test(x)).slice(0, 3)
    : [...lu.comparer];
  const lot = typeof input.lot === 'string' && /^[A-Za-z]\d{2,4}$/.test(input.lot.trim()) ? input.lot.trim().toUpperCase() : null;
  const params: Record<string, string | number | boolean> = {
    ...filtreVersParams(filtre), ...(demande ? { demande } : {}), ...(comparer.length ? { comparer: comparer.join(',') } : {}), ...(lot ? { lot } : {}),
  };
  const v = validerCommandeChat('grille-vente', params);
  if (!v.ok) return { status: 'error', source: SOURCE_GRILLE_VENTE, message: `Filtre refusé : ${(v as { erreur: string }).erreur}. Rien n’a été envoyé au Studio.` };
  let synthese: SyntheseLots | null = null;
  if (env.conversationId && env.lireLots) {
    try { const lots = await env.lireLots(env.conversationId); if (lots && lots.length) synthese = syntheseLots(lots, filtre, 8); } catch { synthese = null; }
  }
  const resume = resumeFiltre(filtre);
  const message = synthese
    ? `Grille de vente ouverte dans le Studio, filtre « ${resume} ». Synthèse (instantané du Studio) : ${synthese.retenus} lot(s) sur ${synthese.total}` +
      `${synthese.prixMin !== null ? `, de ${euros(synthese.prixMin)} à ${euros(synthese.prixMax!)}` : ''}` +
      `${synthese.lots.length ? ` ; premiers : ${synthese.lots.slice(0, 4).map((l) => `${l.lot} (${l.typologie}, ${l.niveau === 0 ? 'RDC' : `R+${l.niveau}`}, ${l.prixEur === null ? 'non chiffré' : euros(l.prixEur)}, ${LIBELLES_STATUT[l.statut].toLowerCase()})`).join(', ')}` : ''}. ` +
      'Réponds en 2 phrases au plus avec ces chiffres ; la carte montre le détail et le Studio allume les lots.'
    : `Grille de vente demandée au Studio, filtre « ${resume} »${comparer.length >= 2 ? `, comparateur ${comparer.join(' / ')}` : ''}. ` +
      `Ne cite AUCUN lot ni prix : le compte rendu du Studio, sous ta réponse, les donnera. Si le Studio n'est pas ouvert : « ${PHRASE_EN_ATTENTE} » Réponds en UNE phrase.`;
  return {
    status: 'ok', source: SOURCE_GRILLE_VENTE, message,
    data: {
      carte: 'commande-studio', commande: { id: v.id, params: v.params }, phrase: null, libelle: 'Grille de vente',
      grille_vente: { filtre, resume, compris: lu.compris, comparer, synthese },
      emis_le: (env.maintenant ?? Date.now)(),
    },
  };
}

/** Lecture des lots par le client service (index.ts) : propriétaire ET conversation (le rôle service ignore la RLS). */
export function lecteurLotsSupabase(admin: { from(t: string): unknown } | null, userId: string | null): EnvGrilleVente['lireLots'] {
  if (!admin || !userId) return undefined;
  return async (conversationId: string) => {
    // deno-lint-ignore no-explicit-any
    const q = (admin as any).from('vente_lots')
      .select('lot_id, niveau, typologie, shab_m2, exterieur_m2, orientation, azimuts_deg, parkings, prix_grille_eur, prix_force_eur, statut, empreinte_modele, maj_le')
      .eq('conversation_id', conversationId).eq('user_id', userId).limit(2000);
    const { data, error } = await q;
    if (error || !Array.isArray(data)) return null; // table absente (migration non appliquée) : pas de synthèse
    return lotsDepuisLignes(data as LigneVenteLot[]);
  };
}
