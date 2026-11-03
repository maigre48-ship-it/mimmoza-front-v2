// src/spaces/copilot/studio3d/contexteVolume.ts
//
// QUELLE PARCELLE, QUEL PROGRAMME, QUELLES RÈGLES POUR LE VOLUME PROPOSÉ
// (logique PURE, testée ; aucune requête réseau ici).
//
// Parcelle affichée = celle CHOISIE dans la conversation, sinon la PLUS
// SUSCEPTIBLE de l'être. Ordre (le premier signal présent l'emporte) :
//   a. parcelle confirmée et retenue pour la conversation (parcelleConfirmee.ts) —
//      seule source déjà validée par l'utilisateur pour Studio ;
//   m. choix manuel dans le sélecteur « Autres candidates » (mémorisé par
//      conversation, stockage scopé utilisateur) — geste explicite le plus récent ;
//   b. IDU (ou « AE0376 » d'une candidate connue) cité par l'UTILISATEUR dans son
//      dernier message qui en cite un seul ;
//   b'. parcelle unique choisie sur la carte du dernier « Dossier de décision » ;
//   c. parcelle RECOMMANDÉE par Mimmo dans sa dernière synthèse : signal
//      structuré d'abord (rapport_terrain verdict « prioritaire », unique), sinon
//      phrase qui ne cite qu'une candidate avec « recommand », « priorit »,
//      « à retenir », « profil le plus net », « meilleur choix », « en premier »…
//      (négations écartées) ;
//   d. la mieux classée de rechercher_parcelles parmi les candidates étudiées
//      (sinon la 1re du classement) ; à défaut, score de rapport_terrain ;
//   e. parcelle du dernier « Dossier de décision » (dernière étudiée) ;
//   f. aucune.
// Programme : fiche 3D, sinon dernier message utilisateur chiffrant des logements.
// Règles : reglesPlu.ts, filtrées sur l'IDU / la zone de la parcelle affichée.

import { buildParcelDossier, type DossierParcel } from '../dossier/parcelDossier.ts';
import type { ParcelleRetenue } from './parcelleConfirmee.ts';
import type { JarvisDraft } from './jarvisDraft.ts';
import { normaliserIdu } from './missionPreparation3D.ts';
import { lotsReglesDesMessages, normaliserZone, reglesPourParcelle } from './reglesPlu.ts';
import type { ProgrammeVolume, ReglesPluVolume } from './volumeParcelle.ts';

export interface MessageContexte {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: { name: string; status: string; input?: unknown; output?: unknown }[];
  createdAt: string;
}

export interface StockageLecture { getItem(cle: string): string | null }

export type RaisonParcelle = 'confirmee' | 'manuel' | 'citee-utilisateur' | 'carte-dossier' | 'recommandee' | 'classement' | 'dernier-dossier';

export const LIBELLES_RAISON: Record<RaisonParcelle, string> = {
  confirmee: 'parcelle confirmée',
  manuel: 'choisie par vous',
  'citee-utilisateur': 'choisie dans la conversation',
  'carte-dossier': 'choisie dans la conversation (carte du dossier)',
  recommandee: 'recommandée par Mimmo',
  classement: '1re du classement',
  'dernier-dossier': 'dernière étudiée',
};

export interface CandidateParcelle {
  idu: string;
  surfaceM2: number | null;
  zone: string | null;
  /** Point connu (centroïde de la recherche, point d'adresse) pour charger le contour ; null sinon. */
  point: { lat: number; lon: number } | null;
  /** Rang dans le dernier rechercher_parcelles (1 = premier). */
  rang: number | null;
  /** Étudiée (get_etude_parcelle, Dossier de décision, rapport de mission). */
  etudiee: boolean;
}

export type SourceParcelle =
  | { type: 'confirmee'; retenue: ParcelleRetenue; idu: string | null }
  | { type: 'candidate'; candidate: CandidateParcelle; raison: Exclude<RaisonParcelle, 'confirmee'>; detail: string | null }
  | { type: 'aucune' };

export interface ContexteVolume {
  parcelle: SourceParcelle;
  /** Toutes les candidates connues (sélecteur « Autres candidates »), la parcelle affichée comprise. */
  candidates: CandidateParcelle[];
  adresse: string | null;
  zone: string | null;
  /** Le dossier signale « Règlement PLU manquant » pour cette parcelle. */
  pluManquant: boolean;
  programme: ProgrammeVolume;
  regles: ReglesPluVolume;
}

const enr = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const nombre = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'");

/** Clé du choix manuel (stockage scopé utilisateur : userStorage). */
export const cleChoixManuel = (conversationId: string) => `mzia.dossier3d.parcelle.${conversationId}`;

/** Choix de parcelles conservé par la carte du « Dossier de décision » (même clé que ParcelDecisionDossier). */
export function selectionDossier(conversationId: string, messageId: string, stockage: StockageLecture | null): DossierParcel[] {
  try {
    const brut = JSON.parse(stockage?.getItem(`mimmoza.parcel-dossier.v1.${conversationId}.${messageId}`) ?? 'null') as { selected?: unknown } | null;
    const liste = Array.isArray(brut?.selected) ? brut.selected : [];
    return liste.map(p => ({ id: normaliserIdu((p as DossierParcel)?.id), areaM2: nombre((p as DossierParcel)?.areaM2) }))
      .filter((p): p is DossierParcel => Boolean(p.id));
  } catch { return []; }
}

// --- Programme --------------------------------------------------------------------------------
const MOTS_NOMBRES: Record<string, number> = { deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, quinze: 15, vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, cent: 100 };
const LOGEMENTS = /\b(\d{1,4}|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze|quinze|vingt|trente|quarante|cinquante|soixante|cent)\s+(logements?|appartements?)(\s+(?:sociaux|social|locatifs?\s+sociaux|[ée]tudiants?|seniors?|en\s+accession))?/i;

/** Nombre de logements écrit dans un texte (« 40 logements sociaux ») ; ignore « 40 logements maximum ». */
export function programmeDepuisTexte(texte: string | null | undefined): { logements: number; libelle: string } | null {
  if (!texte) return null;
  const m = LOGEMENTS.exec(texte);
  if (!m) return null;
  const suite = texte.slice(m.index + m[0].length, m.index + m[0].length + 20);
  if (/^\s*(?:max(?:imum)?|au\s+plus)\b/i.test(suite)) return null;
  const n = MOTS_NOMBRES[m[1].toLowerCase()] ?? Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 2000) return null;
  const social = /\bsocia(?:l|ux)\b/i.test(texte) && !/sociaux|social/i.test(m[3] ?? '');
  const libelle = `${n} ${m[2].toLowerCase().replace(/s?$/, n > 1 ? 's' : '')}${m[3] ? m[3].toLowerCase() : social ? ' sociaux' : ''}`;
  return { logements: n, libelle };
}

export function programmeDuContexte(messages: readonly MessageContexte[], fiche: JarvisDraft | null): ProgrammeVolume {
  const depuisFiche = programmeDepuisTexte(fiche?.programme) ?? programmeDepuisTexte(fiche?.objectif);
  if (depuisFiche) return { ...depuisFiche, origine: 'fiche' };
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue;
    const p = programmeDepuisTexte(messages[i].text);
    if (p) return { ...p, origine: 'conversation' };
  }
  return { logements: null, libelle: null, origine: null };
}

// --- Candidates ---------------------------------------------------------------------------------
function zoneAuPoint(data: Record<string, unknown> | null): string | null {
  const couches = Array.isArray(enr(data?.urbanisme_point)?.couches) ? enr(data?.urbanisme_point)!.couches as unknown[] : [];
  const c = couches.map(enr).find(v => v?.couche === 'zone-urba' && v.statut === 'interrogee');
  const el = Array.isArray(c?.elements) ? enr(c!.elements[0]) : null;
  return normaliserZone(el?.libelle) ?? normaliserZone(el?.nom);
}

interface Releve {
  candidates: Map<string, CandidateParcelle>;
  dernierDossier: { messageId: string; dossier: NonNullable<ReturnType<typeof buildParcelDossier>> } | null;
  /** Index du message du dernier rechercher_parcelles (début de la « session » de comparaison). */
  indexRecherche: number;
}

function releverCandidates(messages: readonly MessageContexte[]): Releve {
  const candidates = new Map<string, CandidateParcelle>();
  const fusionner = (idu: string, c: Partial<CandidateParcelle>) => {
    const a = candidates.get(idu) ?? { idu, surfaceM2: null, zone: null, point: null, rang: null, etudiee: false };
    candidates.set(idu, {
      idu, surfaceM2: a.surfaceM2 ?? c.surfaceM2 ?? null, zone: a.zone ?? c.zone ?? null, point: a.point ?? c.point ?? null,
      rang: c.rang !== undefined ? c.rang : a.rang, etudiee: a.etudiee || Boolean(c.etudiee),
    });
  };
  let dernierDossier: Releve['dernierDossier'] = null, indexRecherche = -1;
  messages.forEach((m, index) => {
    for (const a of m.toolCalls ?? []) {
      if (a.status !== 'success') continue;
      const d = enr(enr(a.output)?.data) ?? {};
      if (a.name === 'rechercher_parcelles' && Array.isArray(d.parcelles)) {
        // Seul le DERNIER classement donne les rangs ; les précédents restent candidats sans rang.
        for (const c of candidates.values()) c.rang = null;
        indexRecherche = index;
        (d.parcelles as unknown[]).forEach((e, i) => {
          const p = enr(e); const idu = normaliserIdu(p?.idu);
          if (!p || !idu) return;
          const ce = Array.isArray(p.centroide) && nombre(p.centroide[0]) !== null && nombre(p.centroide[1]) !== null ? { lon: p.centroide[0] as number, lat: p.centroide[1] as number } : null;
          fusionner(idu, { surfaceM2: nombre(p.surface_m2), zone: normaliserZone(p.zone), point: ce, rang: i + 1 });
        });
      }
      if (a.name === 'get_etude_parcelle') {
        const p = enr(d.parcelle); const idu = normaliserIdu(p?.idu) ?? normaliserIdu(enr(a.input)?.cadastral_ref) ?? normaliserIdu(enr(a.input)?.parcel_id);
        if (idu) fusionner(idu, { etudiee: true, surfaceM2: nombre(p?.surface_m2), zone: zoneAuPoint(d),
          point: nombre(p?.lat) !== null && nombre(p?.lon) !== null ? { lat: p!.lat as number, lon: p!.lon as number } : null });
      }
      if (a.name === 'get_parcelle_depuis_adresse') {
        const p = enr(d.parcelle), ad = enr(d.adresse); const idu = normaliserIdu(p?.idu);
        if (idu) fusionner(idu, { surfaceM2: nombre(p?.contenance_m2), point: nombre(ad?.lat) !== null && nombre(ad?.lon) !== null ? { lat: ad!.lat as number, lon: ad!.lon as number } : null });
      }
      if (a.name === 'rapport_terrain') {
        const e = enr(a.input); const idu = normaliserIdu(e?.idu);
        if (idu) fusionner(idu, { etudiee: true, surfaceM2: nombre(e?.surface_m2), zone: normaliserZone(e?.zonage) });
      }
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const dossier = buildParcelDossier(m.toolCalls as Parameters<typeof buildParcelDossier>[0], m.createdAt);
      const idu = normaliserIdu(dossier?.detectedParcel?.id);
      if (dossier && idu) {
        dernierDossier = { messageId: m.id, dossier };
        fusionner(idu, { etudiee: true, surfaceM2: dossier.detectedParcel?.areaM2 ?? null, zone: normaliserZone(dossier.zone), point: dossier.point });
      }
    }
  });
  return { candidates, dernierDossier, indexRecherche };
}

/** Parcelles citées dans un texte : IDU complets (espaces tolérés), ou « AE0376 » / « AE 376 » d'une candidate connue. */
export function parcellesCitees(texte: string, candidates: readonly string[]): string[] {
  const vues: string[] = [];
  const ajouter = (idu: string) => { if (!vues.includes(idu)) vues.push(idu); };
  for (const m of texte.matchAll(/\b(?:2[AB]|\d{2})\d{3}\s?\d{3}\s?[0-9A-Z]{2}\s?\d{4}\b/gi)) { const idu = normaliserIdu(m[0]); if (idu) ajouter(idu); }
  for (const m of texte.matchAll(/\b([A-Z]{1,2})\s?(\d{1,4})\b/g)) {
    const suffixe = m[1].padStart(2, '0') + m[2].padStart(4, '0');
    const trouvees = candidates.filter(c => c.slice(8) === suffixe);
    if (trouvees.length === 1) ajouter(trouvees[0]);
  }
  return vues;
}

const RECOMMANDATION = /(recommand|priorit|a retenir|je retiens|nous retenons|retenir en premier|profil le plus net|meilleur choix|meilleure option|premier choix|en premier|a privilegier|le plus prometteu|la plus prometteu|le plus favorable|la plus favorable|mon choix|choix n°?\s?1)/;
const NEGATION = /(ne (?:la |le |les )?(?:recommande|retiens|retenons|privilegie)\w* pas|a ecarter|ecart(?:e|ee|er)\b|deconseill|a eviter|pas prioritaire|non prioritaire|en second|second choix|deuxieme choix)/;

/** Parcelle recommandée dans un message de l'assistant (null si aucune ou ambiguë). */
export function recommandationDuMessage(m: MessageContexte, candidates: readonly string[]): { idu: string; detail: string } | null {
  // Signal structuré : une seule fiche de mission « prioritaire ».
  const prioritaires = [...new Set((m.toolCalls ?? []).filter(a => a.name === 'rapport_terrain' && a.status === 'success' && enr(a.input)?.verdict === 'prioritaire')
    .map(a => normaliserIdu(enr(a.input)?.idu)).filter((v): v is string => Boolean(v)))];
  if (prioritaires.length === 1) return { idu: prioritaires[0], detail: 'fiche de mission « prioritaire »' };
  const phrases = m.text.replace(/\*\*/g, '').split(/(?<=[.!?])\s+|\n+/);
  for (const phrase of phrases) {
    const f = sansAccents(phrase);
    if (!RECOMMANDATION.test(f) || NEGATION.test(f)) continue;
    const citees = parcellesCitees(phrase, candidates);
    if (citees.length === 1) return { idu: citees[0], detail: phrase.trim().slice(0, 160) };
  }
  return null;
}

export function contexteVolume(options: {
  messages: readonly MessageContexte[];
  conversationId: string | null;
  fiche: JarvisDraft | null;
  retenue: ParcelleRetenue | null;
  /** localStorage brut (clé du Dossier de décision, écrite sans scope par ParcelDecisionDossier). */
  stockage: StockageLecture | null;
  /** Stockage scopé utilisateur (userStorage) : choix manuel de la parcelle. */
  stockageUtilisateur?: StockageLecture | null;
}): ContexteVolume {
  const { messages, conversationId, fiche, retenue, stockage } = options;
  const releve = releverCandidates(messages);
  const { dernierDossier } = releve;
  const selection = dernierDossier && conversationId ? selectionDossier(conversationId, dernierDossier.messageId, stockage) : [];
  for (const p of selection) if (!releve.candidates.has(p.id)) releve.candidates.set(p.id, { idu: p.id, surfaceM2: p.areaM2, zone: null, point: dernierDossier?.dossier.point ?? null, rang: null, etudiee: false });
  const ids = () => [...releve.candidates.keys()];
  const ajouterCitee = (idu: string) => { if (!releve.candidates.has(idu)) releve.candidates.set(idu, { idu, surfaceM2: null, zone: null, point: null, rang: null, etudiee: false }); };

  let parcelle: SourceParcelle = { type: 'aucune' };
  const choisir = (idu: string, raison: Exclude<RaisonParcelle, 'confirmee'>, detail: string | null = null) => {
    ajouterCitee(idu);
    parcelle = { type: 'candidate', candidate: releve.candidates.get(idu)!, raison, detail };
  };

  if (retenue) {
    const idu = normaliserIdu(retenue.parcel.properties?.idu) ?? normaliserIdu(retenue.parcel.properties?.id);
    parcelle = { type: 'confirmee', retenue, idu };
  }
  // m. Choix manuel (prime sur b–f, jamais sur une parcelle confirmée).
  const manuel = parcelle.type === 'aucune' && conversationId ? normaliserIdu(options.stockageUtilisateur?.getItem(cleChoixManuel(conversationId))) : null;
  if (manuel) choisir(manuel, 'manuel');
  // b. Dernier message utilisateur citant UNE parcelle.
  if (parcelle.type === 'aucune') {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== 'user') continue;
      const citees = parcellesCitees(messages[i].text, ids());
      if (!citees.length) continue;
      if (citees.length === 1) choisir(citees[0], 'citee-utilisateur');
      else citees.forEach(ajouterCitee);
      break;
    }
  }
  // b'. Parcelle unique choisie sur la carte du dernier Dossier de décision.
  if (parcelle.type === 'aucune' && selection.length === 1) choisir(selection[0].id, 'carte-dossier');
  // c. Recommandation de Mimmo dans sa dernière synthèse (depuis le dernier classement).
  if (parcelle.type === 'aucune') {
    for (let i = messages.length - 1; i >= Math.max(0, releve.indexRecherche); i--) {
      if (messages[i].role !== 'assistant') continue;
      const r = recommandationDuMessage(messages[i], ids());
      if (r) { choisir(r.idu, 'recommandee', r.detail); break; }
    }
  }
  // d. Classement : la mieux classée parmi les étudiées, sinon la 1re.
  if (parcelle.type === 'aucune') {
    const classees = [...releve.candidates.values()].filter(c => c.rang !== null).sort((a, b) => a.rang! - b.rang!);
    const meilleure = classees.find(c => c.etudiee) ?? classees[0];
    if (meilleure) choisir(meilleure.idu, 'classement', meilleure.rang === 1 ? null : `${meilleure.rang}e du classement, 1re parmi les terrains étudiés`);
  }
  // e. Dernière parcelle étudiée dans un Dossier de décision.
  if (parcelle.type === 'aucune' && dernierDossier) {
    const idu = normaliserIdu(dernierDossier.dossier.detectedParcel?.id);
    if (idu) choisir(idu, 'dernier-dossier');
  }

  const p = parcelle as SourceParcelle;
  const idu = p.type === 'confirmee' ? p.idu : p.type === 'candidate' ? p.candidate.idu : null;
  const candidateAffichee = idu ? releve.candidates.get(idu) ?? null : null;
  const dossierDeCetteParcelle = dernierDossier && normaliserIdu(dernierDossier.dossier.detectedParcel?.id) === idu ? dernierDossier.dossier : null;
  const zone = candidateAffichee?.zone ?? normaliserZone(dossierDeCetteParcelle?.zone) ?? null;
  const lots = lotsReglesDesMessages(messages);
  const uneSeule = releve.candidates.size <= 1;
  return {
    parcelle: p,
    candidates: [...releve.candidates.values()].sort((a, b) => (a.rang ?? 999) - (b.rang ?? 999)),
    adresse: p.type === 'confirmee' ? p.retenue.adresse ?? null : dossierDeCetteParcelle?.address ?? (uneSeule ? fiche?.localisation ?? null : null),
    zone,
    pluManquant: Boolean(dossierDeCetteParcelle?.evidences.some(e => e.id === 'reglement_plu' && e.status === 'unavailable')),
    programme: programmeDuContexte(messages, fiche),
    regles: reglesPourParcelle(lots, { idu, zone }, uneSeule),
  };
}
