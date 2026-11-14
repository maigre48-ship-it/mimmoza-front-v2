// supabase/functions/_shared/extension/parcours.ts
// =============================================================================
// LOT X3 (14/11/2026) — Parcours « extension de maison » de Mimmo. Module PUR et DÉTERMINISTE.
//
// Le LLM ne calcule rien et ne place rien. Ce module :
//   1. détecte une demande d'extension (« agrandir ma maison », « extension », « surélévation », « garage »…) ;
//   2. lit les réponses de l'utilisateur dans SON message (puces « Libellé : option · … » du bloc mimmoza-choix,
//      ou texte libre : « 4 x 5 m », « 118 m² ») — jamais une valeur proposée par le modèle ;
//   3. tient l'état du parcours (relu d'un tour à l'autre par le serveur) et choisit la question suivante :
//        conserver la maison ? → confirmer / corriger l'estimation (toit, niveaux) → type et façade (vue de la rue)
//        → dimensions → surface de plancher existante RÉELLE (ou « je ne sais pas ») et demandeur → synthèse ;
//   4. fait tourner le MÊME moteur d'extension que le Studio (copie X2) : refus expliqués, surfaces créées estimées ;
//   5. donne le régime INDICATIF (DP / PC) et l'obligation d'architecte (reglementation.ts, sources citées) ;
//   6. construit `fiche.projet_extension` (contrat X0, validé par lireProjetExtension) et l'option de travail
//      `existant: conserver`.
// Statuts : chaque valeur garde « mesurée / estimée / SUPPOSÉE / confirmée » et sa source. Une règle PLU estimée
// (non lue dans le règlement) n'est JAMAIS présentée comme lue.
// =============================================================================

import {
  FORMES_TOIT, libelleStatut, lireProjetExtension, optionTravailExistant, PROJET_EXTENSION_FORMAT, PROJET_EXTENSION_VERSION,
  type CoteFacade, type Donnee, type DonneesBdnb, type ExistantProjet, type ExtensionDemandee, type FormeToit, type ProjetExtension,
  type ReculsExtension, type StatutDonnee, type TypeExtension,
} from './contrat.ts';
import { estimerMaisonExistante, maisonPrincipale, type MaisonExistante, type SurchargesExistant } from './maisonExistante.ts';
import { calculerExtension, type CategorieLimite, type ParcelleMoteur, type ReglesExtension, type ResultatExtension } from './moteur.ts';
import { aire, type Pt } from './geometrie.ts';
import {
  batimentsSurParcelle, contourEnLambert93, entreeExistant, origineParcelle, versRepere, MENTION_BDTOPO,
  type BatimentBdTopo, type SommetL93,
} from './bdtopoParcelle.ts';
import { wgs84VersLambert93 } from './lambert93.ts';
import { LIBELLE_ARCHITECTE, LIBELLE_REGIME, regimeIndicatif, type RegimeIndicatif } from './reglementation.ts';

export const OUTIL_EXTENSION_MAISON = 'extension_maison';
export const VERSION_PARCOURS = 1;
/** Préfixe des identifiants de questions du bloc mimmoza-choix (repère la suite du parcours). */
export const PREFIXE_QUESTION = 'x3_';

// ── Libellés des questions et des options (le texte de la réponse les reprend : « Libellé : option ») ─────────
export const Q = {
  conserver: { id: 'x3_conserver', libelle: 'Maison existante', oui: 'Conserver la maison', non: 'Démolir (projet neuf)' },
  toit: { id: 'x3_toit', libelle: 'Toit de la maison' },
  niveaux: { id: 'x3_niveaux', libelle: 'Niveaux de la maison' },
  type: { id: 'x3_type', libelle: 'Type d’extension' },
  facade: { id: 'x3_facade', libelle: 'Façade (vue de la rue)' },
  dimensions: { id: 'x3_dimensions', libelle: 'Dimensions (largeur × profondeur)' },
  hauteur: { id: 'x3_hauteur', libelle: 'Hauteur de l’extension' },
  niveauxAjoutes: { id: 'x3_niveaux_ajoutes', libelle: 'Niveaux ajoutés' },
  surface: { id: 'x3_surface', libelle: 'Surface de plancher existante', inconnue: 'Je ne sais pas', saisie: 'Je l’indique' },
  demandeur: { id: 'x3_demandeur', libelle: 'Demandeur', particulier: 'Particulier', morale: 'Société (personne morale)' },
} as const;

export const OPTIONS_TOIT: Readonly<Record<FormeToit, string>> = { 'deux-pans': '2 pans', 'quatre-pans': '4 pans', plat: 'Toit plat', monopente: 'Monopente' };
export const OPTIONS_NIVEAUX: readonly [number, string][] = [[1, 'Plain-pied'], [2, 'R+1'], [3, 'R+2'], [4, 'R+3']];
export const OPTIONS_TYPE: Readonly<Record<TypeExtension, string>> = { laterale: 'Latérale', arriere: 'Arrière', surelevation: 'Surélévation', garage: 'Garage', veranda: 'Véranda (bientôt)' };
export const OPTIONS_FACADE: Readonly<Record<CoteFacade, string>> = { gauche: 'À gauche', droite: 'À droite', arriere: 'À l’arrière', rue: 'Côté rue' };
const COTE_LISIBLE: Readonly<Record<CoteFacade, string>> = { gauche: 'gauche', droite: 'droite', arriere: 'arrière', rue: 'rue' };
export const OPTIONS_DIMENSIONS = ['3 × 4 m', '4 × 5 m', '5 × 6 m'] as const;
export const OPTIONS_HAUTEUR = { 1: 'Plain-pied', 2: 'Sur 2 niveaux' } as const;
export const OPTIONS_NIVEAUX_AJOUTES = { 1: '1 niveau', 2: '2 niveaux' } as const;

export const SOURCE_SAISIE = 'saisie utilisateur (parcours extension de Mimmo)';

// ── État du parcours (sérialisable, relu d'un tour à l'autre) ───────────────────────────────────────────────
export interface EtatParcours {
  readonly v: 1;
  readonly idu: string | null;
  readonly conserver: boolean | null;
  readonly toit: FormeToit | null;
  readonly niveaux: number | null;
  readonly hauteurEgoutM: number | null;
  readonly type: TypeExtension | null;
  readonly facade: CoteFacade | null;
  readonly largeurM: number | null;
  readonly profondeurM: number | null;
  readonly niveauxExtension: number | null;
  readonly sdpExistanteM2: number | null;
  readonly sdpInconnue: boolean;
  readonly demandeur: 'particulier' | 'personne-morale' | null;
}

export const ETAT_INITIAL: EtatParcours = {
  v: 1, idu: null, conserver: null, toit: null, niveaux: null, hauteurEgoutM: null, type: null, facade: null,
  largeurM: null, profondeurM: null, niveauxExtension: null, sdpExistanteM2: null, sdpInconnue: false, demandeur: null,
};

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const dans = <T extends string>(v: unknown, l: readonly T[]): v is T => typeof v === 'string' && (l as readonly string[]).includes(v);
const nb = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
const ent = (v: unknown, min: number, max: number): number | null => { const x = nb(v, min, max); return x !== null && Number.isInteger(x) ? x : null; };

/** Relit un état stocké (sortie d'outil d'un tour précédent). Toute valeur hors bornes est ignorée, jamais corrigée. */
export function lireEtat(v: unknown): EtatParcours {
  if (!estObj(v) || v.v !== 1) return ETAT_INITIAL;
  return {
    v: 1,
    idu: typeof v.idu === 'string' && /^[0-9A-Z]{14}$/.test(v.idu) ? v.idu : null,
    conserver: typeof v.conserver === 'boolean' ? v.conserver : null,
    toit: dans(v.toit, FORMES_TOIT) ? v.toit : null,
    niveaux: ent(v.niveaux, 1, 60),
    hauteurEgoutM: nb(v.hauteurEgoutM, 0.5, 200),
    type: dans(v.type, ['laterale', 'arriere', 'surelevation', 'garage', 'veranda'] as const) ? v.type : null,
    facade: dans(v.facade, ['rue', 'arriere', 'gauche', 'droite'] as const) ? v.facade : null,
    largeurM: nb(v.largeurM, 0.5, 500),
    profondeurM: nb(v.profondeurM, 0.5, 500),
    niveauxExtension: ent(v.niveauxExtension, 1, 60),
    sdpExistanteM2: nb(v.sdpExistanteM2, 1, 100_000),
    sdpInconnue: v.sdpInconnue === true,
    demandeur: dans(v.demandeur, ['particulier', 'personne-morale'] as const) ? v.demandeur : null,
  };
}

// ── 1. Détection de la demande ──────────────────────────────────────────────────────────────────────────────
export function normaliser(t: string): string {
  return (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
}

const RE_AGRANDIR = /\b(?:agrandir|agrandissement|agrandisse\w*|surelev\w*|rehausse\w*|rehausser)\b/;
const RE_EXTENSION = /\bextension\b/;
const RE_CONTEXTE_MAISON = /\b(?:maison|pavillon|villa|habitation|chez moi|existant|garage|cuisine|chambre|salon|piece|pieces|veranda|lateral\w*|arriere|etage|m2|plain[- ]pied|annexe)\b|m²/;
const RE_GARAGE = /\b(?:construire|ajouter|faire|creer|accoler|batir|monter)\b[^.?!]{0,40}\b(?:garage|veranda|abri de voiture|carport)\b|\b(?:garage|veranda)\b[^.?!]{0,30}\b(?:accole|contre (?:la|ma) maison|en extension)\b/;
const RE_NEGATIF = /\bextension (?:de|du|des) (?:delai|delais|navigateur|chrome|fichier|garantie|contrat|zone|plu|reseau|ligne)\b|\bextension (?:chrome|firefox|navigateur)\b|\b(?:delai|delais) d'extension\b/;

export interface IntentionExtension { readonly extension: boolean; readonly motif?: string }

/** Vrai pour une demande d'agrandissement d'un bâtiment existant (pas un « délai d'extension »). */
export function detecterIntentionExtension(message: string): IntentionExtension {
  const t = normaliser(message);
  if (!t || t.length < 6) return { extension: false };
  if (RE_NEGATIF.test(t)) return { extension: false, motif: 'extension sans rapport avec un bâtiment' };
  if (RE_AGRANDIR.test(t) && (RE_CONTEXTE_MAISON.test(t) || /\b(?:agrandir|surelev\w*)\b/.test(t))) return { extension: true, motif: 'agrandissement / surélévation' };
  if (RE_EXTENSION.test(t) && RE_CONTEXTE_MAISON.test(t)) return { extension: true, motif: 'extension de maison' };
  if (RE_GARAGE.test(t)) return { extension: true, motif: 'garage ou véranda accolé' };
  return { extension: false };
}

/** Le dernier message de Mimmo portait-il une question du parcours (bloc de choix aux identifiants « x3_ ») ? */
export function suiteDuParcours(texteAssistant: string | null | undefined): boolean {
  return typeof texteAssistant === 'string' && /```mimmoza-choix[\s\S]*?"id"\s*:\s*"x3_/.test(texteAssistant);
}

/** La réponse de l'utilisateur répond-elle à une question du parcours (libellé repris, dimensions, surface) ? */
export function reponseAuParcours(texteUtilisateur: string): boolean {
  const t = normaliser(texteUtilisateur);
  const libelles = Object.values(Q).map((q) => normaliser(q.libelle));
  return libelles.some((l) => t.includes(`${l} :`) || t.includes(`${l}:`)) || RE_DIM.test(t) || /\b\d+(?:[.,]\d+)?\s*(?:m2|m²)(?![a-z0-9])/.test(t);
}

// ── 2. Lecture des réponses ─────────────────────────────────────────────────────────────────────────────────
const RE_DIM = /(\d+(?:[.,]\d+)?)\s*(?:m(?:etres?)?\s*)?(?:x|×|\*|sur)\s*(\d+(?:[.,]\d+)?)\s*(?:m\b|metres?\b)?/;
const versNombre = (s: string): number => Number(s.replace(',', '.'));

/** Segments « libellé : valeur » de la réponse (séparés par « · », retours à la ligne ou « ; »). */
function segments(texte: string): { cle: string; valeur: string }[] {
  return texte.split(/[·\n;]/).flatMap((s) => {
    const i = s.indexOf(':');
    if (i < 0) return [];
    return [{ cle: normaliser(s.slice(0, i)), valeur: s.slice(i + 1).trim() }];
  });
}

function valeurDe(segs: { cle: string; valeur: string }[], libelle: string): string | null {
  const l = normaliser(libelle);
  return segs.find((s) => s.cle === l || s.cle.endsWith(l))?.valeur ?? null;
}

function optionParmi<T extends string | number>(valeur: string | null, options: readonly (readonly [T, string])[]): T | null {
  if (!valeur) return null;
  const v = normaliser(valeur);
  const exacte = options.find(([, lib]) => normaliser(lib) === v);
  if (exacte) return exacte[0];
  const debut = options.find(([, lib]) => v.startsWith(normaliser(lib)));
  return debut ? debut[0] : null;
}

/**
 * Nouvel état = état précédent + réponses lues dans le message de l'utilisateur. N'invente rien : seule une valeur
 * explicitement donnée (puce cliquée ou texte) est prise. `attendues` : questions posées au tour précédent (pour lire
 * un nombre isolé, « 118 m² », comme la surface existante seulement si c'était la question posée).
 */
export function lireReponses(etat: EtatParcours, texte: string, attendues: readonly string[] = []): EtatParcours {
  if (!texte) return etat;
  const segs = segments(texte);
  const t = normaliser(texte);
  let e: { -readonly [K in keyof EtatParcours]: EtatParcours[K] } = { ...etat };

  // Conserver / démolir.
  const c = valeurDe(segs, Q.conserver.libelle);
  if (c) {
    const n = normaliser(c);
    if (n.startsWith(normaliser(Q.conserver.oui)) || /\b(?:conserver|garder)\b/.test(n)) e.conserver = true;
    else if (n.startsWith('demolir') || /\bdemoli/.test(n)) e.conserver = false;
  } else if (attendues.includes(Q.conserver.id)) {
    if (/\b(?:je (?:la |veux la )?(?:conserve|garde)|conserver la maison|garder la maison|on la garde|on garde)\b/.test(t)) e.conserver = true;
    else if (/\b(?:demolir|demolition|raser)\b/.test(t)) e.conserver = false;
  }

  // Toit et niveaux de la maison (confirmation ou correction de l'estimation).
  const toit = optionParmi(valeurDe(segs, Q.toit.libelle), Object.entries(OPTIONS_TOIT) as [FormeToit, string][]);
  if (toit) e.toit = toit;
  const niv = optionParmi(valeurDe(segs, Q.niveaux.libelle), OPTIONS_NIVEAUX);
  if (niv) e.niveaux = niv;
  const mEgout = /\begout\b[^0-9]{0,20}(\d+(?:[.,]\d+)?)\s*m\b/.exec(t);
  if (mEgout) { const h = versNombre(mEgout[1]!); if (h >= 0.5 && h <= 200) e.hauteurEgoutM = h; }

  // Type et façade.
  const type = optionParmi(valeurDe(segs, Q.type.libelle), Object.entries(OPTIONS_TYPE) as [TypeExtension, string][])
    ?? optionParmi(valeurDe(segs, Q.type.libelle), [['veranda', 'Véranda']] as [TypeExtension, string][]);
  if (type) e.type = type;
  const facade = optionParmi(valeurDe(segs, Q.facade.libelle), Object.entries(OPTIONS_FACADE) as [CoteFacade, string][]);
  if (facade) e.facade = facade;

  // Dimensions : « Dimensions (largeur × profondeur) : 4 × 5 m », ou « 4 x 5 m » en texte libre.
  const dimTexte = valeurDe(segs, Q.dimensions.libelle) ?? texte;
  const d = RE_DIM.exec(normaliser(dimTexte));
  if (d) {
    const L = versNombre(d[1]!), P = versNombre(d[2]!);
    if (L >= 0.5 && L <= 500 && P >= 0.5 && P <= 500) { e.largeurM = L; e.profondeurM = P; }
  }
  const mL = /\blargeur\b[^0-9]{0,12}(\d+(?:[.,]\d+)?)\s*m\b/.exec(t);
  if (mL) { const v = versNombre(mL[1]!); if (v >= 0.5 && v <= 500) e.largeurM = v; }
  const mP = /\bprofondeur\b[^0-9]{0,12}(\d+(?:[.,]\d+)?)\s*m\b/.exec(t);
  if (mP) { const v = versNombre(mP[1]!); if (v >= 0.5 && v <= 500) e.profondeurM = v; }
  const h = optionParmi(valeurDe(segs, Q.hauteur.libelle), Object.entries(OPTIONS_HAUTEUR).map(([k, v]) => [Number(k), v] as [number, string]));
  if (h) e.niveauxExtension = h;
  const na = optionParmi(valeurDe(segs, Q.niveauxAjoutes.libelle), Object.entries(OPTIONS_NIVEAUX_AJOUTES).map(([k, v]) => [Number(k), v] as [number, string]));
  if (na) e.niveauxExtension = na;

  // Surface de plancher existante : saisie, ou « je ne sais pas ».
  const s = valeurDe(segs, Q.surface.libelle);
  const nombreSurface = (x: string): number | null => {
    const m = /(\d{1,3}(?:[   ]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(?:m2|m²|metres? carres?)?/.exec(normaliser(x));
    if (!m) return null;
    const v = versNombre(m[1]!.replace(/[   ]/g, ''));
    return v >= 1 && v <= 100_000 ? v : null;
  };
  const libreSurface = (): number | null => {
    const libre = /\bsurface de plancher\b[^0-9]{0,40}(\d+(?:[.,]\d+)?)\s*(?:m2|m²)/.exec(t);
    if (libre) { const v = versNombre(libre[1]!); return v >= 1 && v <= 100_000 ? v : null; }
    const isole = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:m2|m²)(?![a-z0-9])/.exec(t);
    if (isole && !d) { const v = versNombre(isole[1]!); return v >= 1 && v <= 100_000 ? v : null; }
    return null;
  };
  if (s) {
    const n = normaliser(s);
    const v = nombreSurface(s) ?? libreSurface();
    if (v !== null) { e.sdpExistanteM2 = v; e.sdpInconnue = false; }
    else if (n.startsWith(normaliser(Q.surface.inconnue)) || /\bsais pas\b|\binconnue?\b/.test(n)) { e.sdpInconnue = true; e.sdpExistanteM2 = null; }
  } else {
    const libre = /\bsurface de plancher\b[^0-9]{0,40}(\d+(?:[.,]\d+)?)\s*(?:m2|m²)/.exec(t);
    if (libre) { e.sdpExistanteM2 = versNombre(libre[1]!); e.sdpInconnue = false; }
    else if (attendues.includes(Q.surface.id)) {
      const isole = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:m2|m²)(?![a-z0-9])/.exec(t);
      if (isole && !d) { const v = versNombre(isole[1]!); if (v >= 1 && v <= 100_000) { e.sdpExistanteM2 = v; e.sdpInconnue = false; } }
      else if (/\bje ne sais pas\b|\bsais pas\b/.test(t)) e.sdpInconnue = true;
    }
  }

  // Demandeur.
  const dem = valeurDe(segs, Q.demandeur.libelle);
  if (dem) {
    const n = normaliser(dem);
    if (n.startsWith('particulier')) e.demandeur = 'particulier';
    else if (/societe|personne morale|sci|sarl|sas\b/.test(n)) e.demandeur = 'personne-morale';
  }
  return e;
}

// ── 3. Contexte (données lues par le serveur) ───────────────────────────────────────────────────────────────
export interface RegleSite {
  readonly cle: string;
  readonly valeur: number | string | null;
  readonly statut: 'confirme' | 'estime' | 'manquant';
  readonly source: string;
  readonly article?: string | null;
  readonly nature?: string | null;
}

export interface ContexteParcours {
  readonly idu: string;
  readonly commune: string | null;
  /** Contour cadastral WGS 84 (anneau extérieur) ; null si inconnu. */
  readonly contourWgs84: readonly (readonly [number, number])[] | null;
  readonly surfaceParcelleM2: number | null;
  /** Bâtiments BD TOPO lus dans le rectangle de la parcelle ; null si la BD TOPO n'a pas répondu. */
  readonly batiments: readonly BatimentBdTopo[] | null;
  readonly raisonBdTopo: string | null;
  readonly dateBdTopo: string | null;
  readonly bdnb: DonneesBdnb | null;
  readonly noteBdnb: string | null;
  readonly zoneU: { readonly valeur: boolean | null; readonly source: string };
  readonly regles: readonly RegleSite[];
  /** Façades sur voie (lot P9, déduites du cadastre et des parcelles voisines), WGS 84. */
  readonly facadesVoie: readonly { readonly debut: readonly [number, number]; readonly fin: readonly [number, number] }[];
  readonly raisonFacades: string | null;
}

/**
 * Source d'une règle rendue lisible : les noms techniques d'outils (« get_prescriptions_urbanisme GPU ») ne sont jamais
 * montrés ; ils sont remplacés par le nom du service public interrogé.
 */
export function sourceLisible(source: string): string {
  return (source || 'source non précisée')
    .replace(/\bget_prescriptions_urbanisme\b(?:\s*GPU)?/g, 'prescriptions du Géoportail de l’urbanisme (GPU)')
    .replace(/\bget_zonage_plu\b(?:\s*GPU)?/g, 'zonage du Géoportail de l’urbanisme (GPU)')
    .replace(/\blire_regles_plu_importees\b/g, 'règlement importé dans Mimmoza')
    .replace(/\b[a-z]+(?:_[a-z0-9]+){1,}\b/g, 'source automatique')
    .replace(/\s+/g, ' ').trim();
}

/** Reculs et règles connues du moteur, depuis les règles PLU de la conception (lue → « estimée », estimée → « SUPPOSÉE »). */
export function reglesMoteur(regles: readonly RegleSite[]): { regles: ReglesExtension; reculs: ReculsExtension; lignes: string[] } {
  const garder = (cle: string, plusForte: boolean): RegleSite | null => {
    let r: RegleSite | null = null;
    for (const x of regles) {
      if (x.cle !== cle || (x.statut !== 'confirme' && x.statut !== 'estime') || x.nature === 'non_reglementee') continue;
      if (typeof x.valeur !== 'number' || !Number.isFinite(x.valeur) || x.valeur < 0) continue;
      if (!r || (plusForte ? x.valeur > (r.valeur as number) : x.valeur < (r.valeur as number))) r = x;
    }
    return r;
  };
  const donnee = (r: RegleSite, valeur: number): Donnee<number> => ({
    valeur,
    statut: r.statut === 'confirme' ? 'estimee' : 'supposee',
    source: (r.statut === 'confirme'
      ? `PLU lu dans le règlement (lecture automatique, à vérifier) : ${sourceLisible(r.source)}${r.article ? `, ${r.article}` : ''}`
      : `PLU ESTIMÉ, non lu dans le règlement : ${sourceLisible(r.source)}`).slice(0, 300),
  });
  const out: { -readonly [K in keyof ReglesExtension]: ReglesExtension[K] } = {};
  const reculs: { -readonly [K in keyof ReculsExtension]: ReculsExtension[K] } = {};
  const lignes: string[] = [];
  const voie = garder('recul_voie_m', true);
  if (voie) { out.voieM = reculs.voieM = donnee(voie, voie.valeur as number); }
  const lim = garder('recul_limites_m', true);
  if (lim) { out.limitesSeparativesM = reculs.limitesSeparativesM = donnee(lim, lim.valeur as number); }
  const ces = garder('emprise_sol_max_pct', false);
  if (ces && (ces.valeur as number) > 0 && (ces.valeur as number) <= 100) out.cesMax = donnee(ces, (ces.valeur as number) / 100);
  const h = garder('hauteur_max_m', false);
  if (h && (h.valeur as number) > 0) out.hauteurMaxM = donnee(h, h.valeur as number);
  const dire = (nom: string, d: Donnee<number> | undefined, unite: string, facteur = 1): void => {
    if (!d) { lignes.push(`${nom} : inconnu — le moteur applique une hypothèse SUPPOSÉE (bloquante) et le dit.`); return; }
    lignes.push(`${nom} : ${fr(d.valeur * facteur, 1)} ${unite} — ${d.statut === 'estimee' ? 'lu dans le règlement (à vérifier)' : 'ESTIMÉ, non lu dans le règlement'} (${d.source}).`);
  };
  dire('Recul à la voie', out.voieM, 'm');
  dire('Recul aux limites séparatives', out.limitesSeparativesM, 'm');
  if (out.cesMax) dire('Emprise au sol maximale', out.cesMax, '%', 100);
  if (out.hauteurMaxM) dire('Hauteur maximale', out.hauteurMaxM, 'm');
  return { regles: out, reculs, lignes };
}

const fr = (v: number, d = 1): string => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR', { maximumFractionDigits: d }).replace(/ | /g, ' ');

/** Parcelle dans le repère de calcul ; limite « voie » = arête du contour portée par une façade sur voie (≤ 1 m). */
export function parcelleMoteur(contourL93: readonly SommetL93[], origine: SommetL93, facades: ContexteParcours['facadesVoie'], surfaceM2: number | null): ParcelleMoteur {
  const contour: Pt[] = contourL93.map((p) => versRepere(p, origine));
  const segs = facades.map((f) => [versRepere(wgs84VersLambert93(f.debut[0], f.debut[1]), origine), versRepere(wgs84VersLambert93(f.fin[0], f.fin[1]), origine)] as const);
  const dist = (p: Pt, a: Pt, b: Pt): number => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
  };
  const categories: (CategorieLimite | null)[] = contour.map((p, i) => {
    const q = contour[(i + 1) % contour.length]!;
    return segs.some(([a, b]) => dist(p, a, b) <= 1 && dist(q, a, b) <= 1 && Math.hypot(q.x - p.x, q.z - p.z) > 0.2) ? 'voie' : null;
  });
  return { contour, surfaceM2: surfaceM2 && surfaceM2 > 0 ? surfaceM2 : Math.round(Math.abs(aire(contour))), categories };
}

// ── 4. Sortie ───────────────────────────────────────────────────────────────────────────────────────────────
export type Etape = 'sans_parcelle' | 'sans_bdtopo' | 'aucun_batiment' | 'conserver' | 'neuf' | 'confirmer' | 'type' | 'dimensions' | 'surface' | 'termine';

export interface LigneVue { readonly libelle: string; readonly valeur: string; readonly statut: StatutDonnee | null; readonly source: string }

export interface VueExtension {
  readonly v: 1;
  readonly etape: Etape;
  readonly idu: string;
  readonly commune: string | null;
  readonly maison: { readonly id: string; readonly conservee: boolean | null; readonly lignes: readonly LigneVue[]; readonly hypotheses: readonly string[] } | null;
  readonly extension: {
    readonly type: string; readonly facade: string | null; readonly dimensions: string | null;
    readonly verdict: 'ok' | 'refus' | 'non-calcule'; readonly refus: readonly string[]; readonly alertes: readonly string[];
    readonly empriseCreeeM2: number | null; readonly sdpCreee: { valeur: number; min: number; max: number; source: string } | null;
    readonly suggestion: string | null;
  } | null;
  readonly regles: readonly string[];
  readonly regime: { readonly libelle: string; readonly architecte: string; readonly ferme: boolean; readonly lignes: readonly string[]; readonly sources: readonly { titre: string; url: string }[]; readonly mention: string } | null;
  readonly avertissements: readonly string[];
  readonly sources: readonly string[];
}

export interface QuestionBloc { id: string; libelle: string; options: string[]; multiple: boolean; defaut?: string }

export interface SortieParcours {
  readonly etat: EtatParcours;
  readonly etape: Etape;
  /** Questions posées à ce tour (identifiants), pour lire la réponse au tour suivant. */
  readonly attendues: readonly string[];
  /** Texte affiché par le serveur (markdown), sans aucun nom d'outil interne. */
  readonly texte: string;
  /** Bloc ```mimmoza-choix``` à placer à la toute fin de la réponse (null si aucune question). */
  readonly blocChoix: string | null;
  readonly vue: VueExtension;
  /** Bloc `fiche.projet_extension` validé (contrat X0) ; null tant que le parcours n'est pas complet ou s'il est invalide. */
  readonly projet: ProjetExtension | null;
  readonly optionTravail: { readonly existant: 'conserver' | 'effacer' } | null;
  readonly erreursProjet: readonly string[];
  readonly regime: RegimeIndicatif | null;
  readonly resultatMoteur: ResultatExtension | null;
}

export function blocChoix(questions: readonly QuestionBloc[]): string | null {
  if (!questions.length) return null;
  const qs = questions.slice(0, 6).map((q) => ({
    id: q.id, libelle: q.libelle, options: q.options.slice(0, 10), multiple: q.multiple,
    ...(q.defaut && q.options.includes(q.defaut) ? { defaut: q.defaut } : {}),
  }));
  return '```mimmoza-choix\n' + JSON.stringify({ v: 1, questions: qs, libre: true, a_toi_de_choisir: false }) + '\n```';
}

const D = <T,>(valeur: T, statut: StatutDonnee, source: string): Donnee<T> => ({ valeur, statut, source: source.slice(0, 300) });
const ligne = (libelle: string, valeur: string, d: { statut: StatutDonnee; source: string } | null): LigneVue => ({ libelle, valeur, statut: d?.statut ?? null, source: d?.source ?? '' });
const statutCourt = (s: StatutDonnee): string => libelleStatut(s);

function lignesMaison(m: MaisonExistante, bdnb: DonneesBdnb | null): LigneVue[] {
  const t = m.toit;
  const l: LigneVue[] = [
    ligne('Emprise au sol', `${fr(m.empriseM2, 0)} m²`, { statut: 'mesuree', source: 'BD TOPO, contour du bâtiment' }),
    ligne('Hauteur à l’égout', `${fr(m.hauteurEgout.valeur, 1)} m`, m.hauteurEgout),
    ligne('Toit', `${OPTIONS_TOIT[t.forme.valeur]}${t.forme.valeur !== 'plat' ? `, pente ${fr(t.penteDeg.valeur, 0)}°` : ''}`, t.forme),
    ligne('Faîtage', `${fr(m.hauteurFaitage.valeur, 1)} m`, m.hauteurFaitage),
    ligne('Niveaux', `${m.niveaux.valeur}`, m.niveaux),
    ligne('Surface de plancher', m.surfacePlancher.statut === 'confirmee' ? `${fr(m.surfacePlancher.valeur, 0)} m²` : `≈ ${fr(m.surfacePlancher.valeur, 0)} m² (entre ${fr(m.surfacePlancher.minM2, 0)} et ${fr(m.surfacePlancher.maxM2, 0)} m²)`, m.surfacePlancher),
  ];
  if (bdnb?.anneeConstruction) l.push(ligne('Année de construction', String(bdnb.anneeConstruction), { statut: 'mesuree', source: 'BDNB (CSTB)' }));
  return l;
}

function tableauMarkdown(lignes: readonly LigneVue[]): string {
  return ['| | Valeur | Statut |', '|---|---|---|', ...lignes.map((x) => `| ${x.libelle} | ${x.valeur} | ${x.statut ? statutCourt(x.statut) : '—'} |`)].join('\n');
}

/**
 * Avance le parcours d'un tour. `etatPrecedent` : état relu ; `texte` : message REÇU de l'utilisateur ;
 * `attenduesPrecedentes` : questions posées au tour précédent ; `contexte` : données lues par le serveur.
 */
export function avancerParcours(etatPrecedent: EtatParcours, texte: string, attenduesPrecedentes: readonly string[], ctx: ContexteParcours): SortieParcours {
  const base = etatPrecedent.idu && etatPrecedent.idu !== ctx.idu ? { ...ETAT_INITIAL } : etatPrecedent;
  const etat: EtatParcours = { ...lireReponses(base, texte, attenduesPrecedentes), idu: ctx.idu };
  const avert: string[] = [];
  const sources: string[] = [];
  const vueVide = (etape: Etape, msg: string): SortieParcours => ({
    etat, etape, attendues: [], texte: msg, blocChoix: null, projet: null, optionTravail: null, erreursProjet: [], regime: null, resultatMoteur: null,
    vue: { v: 1, etape, idu: ctx.idu, commune: ctx.commune, maison: null, extension: null, regles: [], regime: null, avertissements: [msg], sources },
  });

  if (!ctx.contourWgs84 || ctx.contourWgs84.length < 3) return vueVide('sans_parcelle', `Le contour cadastral de la parcelle ${ctx.idu} n’est pas disponible : je ne peux pas situer la maison existante.`);
  if (!ctx.batiments) return vueVide('sans_bdtopo', `La base des bâtiments de l’IGN (BD TOPO) n’a pas répondu (${ctx.raisonBdTopo ?? 'raison inconnue'}). Rien n’est estimé ; réessayez dans un instant.`);
  const contourL93 = contourEnLambert93(ctx.contourWgs84);
  const origine = origineParcelle(contourL93);
  const surParcelle = batimentsSurParcelle(ctx.batiments, contourL93);
  sources.push(`${MENTION_BDTOPO}${ctx.dateBdTopo ? `, lue le ${ctx.dateBdTopo}` : ''}`);
  if (ctx.bdnb) sources.push('BDNB (CSTB) — base de données nationale des bâtiments');
  if (ctx.noteBdnb) avert.push(ctx.noteBdnb);
  if (!surParcelle.length) return vueVide('aucun_batiment', `Aucun bâtiment de la BD TOPO n’a son emprise sur la parcelle ${ctx.idu} : il n’y a pas de maison existante à conserver. Si la maison est récente, elle n’est peut-être pas encore dans la base de l’IGN.`);

  const principal = maisonPrincipale(surParcelle.map((b) => ({ ...b, anneau: b.anneaux[0]!.map(([x, z]) => ({ x, z })) })))!;
  const bat = surParcelle.find((b) => b.id === principal.id)!;
  const autres = surParcelle.filter((b) => b.id !== bat.id);
  const surcharges: SurchargesExistant = {
    ...(etat.toit ? { formeToit: etat.toit } : {}),
    ...(etat.niveaux ? { niveaux: etat.niveaux } : {}),
    ...(etat.hauteurEgoutM ? { hauteurEgoutM: etat.hauteurEgoutM } : {}),
    ...(etat.sdpExistanteM2 ? { surfacePlancherM2: etat.sdpExistanteM2 } : {}),
  };
  const estimation = estimerMaisonExistante(entreeExistant(bat, origine, ctx.bdnb ?? undefined));
  const m = estimerMaisonExistante(entreeExistant(bat, origine, ctx.bdnb ?? undefined), surcharges);
  const lignes = lignesMaison(m, ctx.bdnb);
  const maisonVue = { id: m.id, conservee: etat.conserver, lignes, hypotheses: [...m.hypotheses, ...m.avertissements] };
  if (autres.length) avert.push(`${autres.length} autre(s) bâtiment(s) BD TOPO sur la parcelle (annexes, abris) : conservés et pris comme obstacles par le moteur.`);
  const presentation = `Sur la parcelle ${ctx.idu}${ctx.commune ? ` (${ctx.commune})` : ''}, la base de l’IGN (BD TOPO) décrit un bâtiment de ${fr(m.empriseM2, 0)} m² d’emprise au sol.`;

  const sortie = (etape: Etape, texteQ: string, questions: QuestionBloc[], extra: Partial<Pick<SortieParcours, 'projet' | 'optionTravail' | 'erreursProjet' | 'regime' | 'resultatMoteur'>> & { extension?: VueExtension['extension']; regles?: string[] } = {}): SortieParcours => ({
    etat, etape, attendues: questions.map((q) => q.id), texte: texteQ, blocChoix: blocChoix(questions),
    projet: extra.projet ?? null, optionTravail: extra.optionTravail ?? null, erreursProjet: extra.erreursProjet ?? [], regime: extra.regime ?? null, resultatMoteur: extra.resultatMoteur ?? null,
    vue: {
      v: 1, etape, idu: ctx.idu, commune: ctx.commune, maison: maisonVue, extension: extra.extension ?? null, regles: extra.regles ?? [],
      regime: extra.regime ? { libelle: LIBELLE_REGIME[extra.regime.regime], architecte: LIBELLE_ARCHITECTE[extra.regime.architecte], ferme: extra.regime.ferme, lignes: extra.regime.lignes, sources: extra.regime.sources.map((s) => ({ ...s })), mention: extra.regime.mention } : null,
      avertissements: avert, sources,
    },
  });

  // Étape 1 : conserver la maison ?
  if (etat.conserver === null) {
    return sortie('conserver', `${presentation}\n\n**Voulez-vous conserver cette maison et l’agrandir, ou la démolir pour un projet neuf ?**`, [
      { id: Q.conserver.id, libelle: Q.conserver.libelle, options: [Q.conserver.oui, Q.conserver.non], multiple: false },
    ]);
  }
  if (etat.conserver === false) {
    return sortie('neuf', 'Entendu : la maison existante serait **démolie** (projet neuf). Le parcours d’extension s’arrête ici ; pour un bâtiment neuf, la préparation 3D habituelle s’applique (l’existant est effacé de l’image).', []);
  }

  // Étape 2 : confirmer / corriger l'estimation, puis type et façade.
  const q: QuestionBloc[] = [];
  const optionsToit = Object.values(OPTIONS_TOIT);
  if (!etat.toit) q.push({ id: Q.toit.id, libelle: Q.toit.libelle, options: optionsToit, multiple: false, defaut: OPTIONS_TOIT[estimation.toit.forme.valeur] });
  if (!etat.niveaux) q.push({ id: Q.niveaux.id, libelle: Q.niveaux.libelle, options: OPTIONS_NIVEAUX.map(([, l]) => l), multiple: false, defaut: OPTIONS_NIVEAUX.find(([n]) => n === estimation.niveaux.valeur)?.[1] });
  const typeValide = etat.type && etat.type !== 'veranda' ? etat.type : null;
  if (etat.type === 'veranda') avert.push('Véranda : le volume vitré n’est pas encore produit (lot à venir). Choisissez une extension latérale, arrière, un garage ou une surélévation.');
  if (!typeValide) q.push({ id: Q.type.id, libelle: Q.type.libelle, options: (['laterale', 'arriere', 'surelevation', 'garage'] as TypeExtension[]).map((k) => OPTIONS_TYPE[k]), multiple: false });
  if (typeValide !== 'surelevation' && !etat.facade) q.push({ id: Q.facade.id, libelle: Q.facade.libelle, options: Object.values(OPTIONS_FACADE), multiple: false });
  if (q.length) {
    const intro = !etat.toit || !etat.niveaux
      ? `${presentation} Voici ce que j’en estime ; **confirmez ou corrigez** (les valeurs SUPPOSÉES ne sont pas des mesures) :\n\n${tableauMarkdown(lignes)}\n\nLa surface de plancher ci-dessus est une **estimation** ; je vous demanderai la surface réelle plus loin.`
      : 'Merci. **Quel agrandissement envisagez-vous**, et de quel côté de la maison, vu depuis la rue ?';
    return sortie(q.some((x) => x.id === Q.toit.id || x.id === Q.niveaux.id) ? 'confirmer' : 'type', intro, q);
  }

  // Étape 3 : dimensions.
  const type = typeValide!;
  const q3: QuestionBloc[] = [];
  if (type === 'surelevation') {
    if (!etat.niveauxExtension) q3.push({ id: Q.niveauxAjoutes.id, libelle: Q.niveauxAjoutes.libelle, options: Object.values(OPTIONS_NIVEAUX_AJOUTES), multiple: false });
  } else {
    if (!etat.largeurM || !etat.profondeurM) q3.push({ id: Q.dimensions.id, libelle: Q.dimensions.libelle, options: [...OPTIONS_DIMENSIONS], multiple: false });
    if (type !== 'garage' && !etat.niveauxExtension) q3.push({ id: Q.hauteur.id, libelle: Q.hauteur.libelle, options: Object.values(OPTIONS_HAUTEUR), multiple: false });
  }
  if (q3.length) {
    return sortie('dimensions', type === 'surelevation'
      ? '**Combien de niveaux ajouter** sur la maison ?'
      : `**Quelles dimensions pour l’extension ${OPTIONS_TYPE[type].toLowerCase()}** ? La largeur se mesure le long de la façade de la maison, la profondeur en s’en éloignant (vous pouvez écrire par exemple « 4,5 × 6 m »).`, q3);
  }

  // Étape 4 : surface de plancher existante réelle et demandeur.
  const q4: QuestionBloc[] = [];
  if (etat.sdpExistanteM2 === null && !etat.sdpInconnue) q4.push({ id: Q.surface.id, libelle: Q.surface.libelle, options: [Q.surface.inconnue, Q.surface.saisie], multiple: false });
  if (!etat.demandeur) q4.push({ id: Q.demandeur.id, libelle: Q.demandeur.libelle, options: [Q.demandeur.particulier, Q.demandeur.morale], multiple: false });
  if (q4.length) {
    return sortie('surface', `Pour savoir s’il faut une déclaration préalable ou un permis, et si un architecte est obligatoire, j’ai besoin de la **surface de plancher RÉELLE de la maison aujourd’hui** (acte de vente, avis de taxe foncière, plans) — écrivez-la, par exemple « 118 m² ». Mon estimation (${fr(estimation.surfacePlancher.valeur, 0)} m², entre ${fr(estimation.surfacePlancher.minM2, 0)} et ${fr(estimation.surfacePlancher.maxM2, 0)} m²) n’est pas une mesure.`, q4);
  }

  // Étape 5 : synthèse — moteur, régime, projet.
  const rm = reglesMoteur(ctx.regles);
  const pm = parcelleMoteur(contourL93, origine, ctx.facadesVoie, ctx.surfaceParcelleM2);
  if (!pm.categories?.some((c) => c === 'voie')) avert.push(`Limite sur rue non identifiée${ctx.raisonFacades ? ` (${ctx.raisonFacades})` : ''} : sans elle, le moteur ne sait pas où sont la gauche, la droite et l’arrière, et refuse l’extension.`);
  const dimensions: ExtensionDemandee['dimensions'] = type === 'surelevation'
    ? { niveaux: D(etat.niveauxExtension!, 'confirmee', SOURCE_SAISIE) }
    : {
      largeurM: D(etat.largeurM!, 'confirmee', SOURCE_SAISIE),
      profondeurM: D(etat.profondeurM!, 'confirmee', SOURCE_SAISIE),
      ...(etat.niveauxExtension ? { niveaux: D(etat.niveauxExtension, 'confirmee', SOURCE_SAISIE) } : {}),
    };
  const demande: ExtensionDemandee = {
    type,
    ...(type !== 'surelevation' ? { facade: { cote: etat.facade! } } : {}),
    existantId: m.id,
    dimensions,
    ...(Object.keys(rm.reculs).length ? { reculs: rm.reculs } : {}),
  };
  const res = calculerExtension({
    maison: m, demande, parcelle: pm, regles: rm.regles,
    options: { autresBatiments: autres.map((b) => ({ id: b.id, anneau: b.anneaux[0]!.map((p) => versRepere(p, origine)) })) },
  });
  const sdpC = res.surfaces?.surfacePlancherCreeeM2 ?? null;
  const empC = res.surfaces ? res.surfaces.empriseCreeeM2.valeur : type === 'surelevation' ? 0 : (etat.largeurM! * etat.profondeurM!);
  const regime = regimeIndicatif({
    creee: { empriseM2: empC, sdpM2: sdpC?.valeur ?? null, sdpMinM2: sdpC?.minM2 ?? null, sdpMaxM2: sdpC?.maxM2 ?? null },
    existant: { sdpM2: m.surfacePlancher.valeur, statut: m.surfacePlancher.statut, minM2: m.surfacePlancher.minM2, maxM2: m.surfacePlancher.maxM2, empriseM2: m.empriseM2 },
    zoneU: ctx.zoneU,
    demandeur: etat.demandeur,
  });

  // Projet (contrat X0) : la maison conservée avec ses valeurs ET leurs statuts, corrections de l'utilisateur comprises.
  const existant: ExistantProjet = {
    id: m.id, source: 'bdtopo', mode: 'conserver',
    hauteurEgoutM: m.hauteurEgout,
    ...(m.hauteurFaitage.statut === 'mesuree' || m.hauteurFaitage.statut === 'confirmee' ? { hauteurFaitageM: m.hauteurFaitage } : {}),
    formeToit: m.toit.forme.statut === 'confirmee'
      ? D(m.toit.forme.valeur, 'confirmee', `${SOURCE_SAISIE} ; estimation proposée : ${OPTIONS_TOIT[estimation.toit.forme.valeur]} (${statutCourt(estimation.toit.forme.statut)})`)
      : m.toit.forme,
    ...(m.toit.forme.valeur !== 'plat' && (etat.toit === null || etat.toit === estimation.toit.forme.valeur) ? { penteToitDeg: m.toit.penteDeg } : {}),
    niveaux: m.niveaux,
    surfacePlancherM2: m.surfacePlancher.statut === 'confirmee'
      ? D(m.surfacePlancher.valeur, 'confirmee', m.surfacePlancher.source)
      : D(m.surfacePlancher.valeur, m.surfacePlancher.statut, `${m.surfacePlancher.source} ; fourchette ${m.surfacePlancher.minM2}–${m.surfacePlancher.maxM2} m² ; surface réelle non communiquée`),
    ...(ctx.bdnb && Object.keys(ctx.bdnb).length ? { bdnb: ctx.bdnb } : {}),
  };
  const brut = {
    format: PROJET_EXTENSION_FORMAT, version: PROJET_EXTENSION_VERSION, nature: 'extension', modeExistantParDefaut: 'conserver',
    existants: [existant], extension: demande, ...(etat.demandeur ? { demandeur: etat.demandeur } : {}),
  };
  const lu = lireProjetExtension(JSON.parse(JSON.stringify(brut)));
  const projet = lu.ok ? lu.projet : null;
  if (lu.ok) avert.push(...lu.avertissements);

  const refus = res.refus;
  const alertes = res.diagnostics.filter((d) => d.niveau === 'alerte').map((d) => d.message);
  const vueExt: NonNullable<VueExtension['extension']> = {
    type: OPTIONS_TYPE[type],
    facade: type === 'surelevation' ? null : OPTIONS_FACADE[etat.facade!],
    dimensions: type === 'surelevation' ? `${etat.niveauxExtension} niveau(x) ajouté(s) sur le corps principal` : `${fr(etat.largeurM!, 2)} × ${fr(etat.profondeurM!, 2)} m${etat.niveauxExtension ? `, ${etat.niveauxExtension === 1 ? 'plain-pied' : `${etat.niveauxExtension} niveaux`}` : ''}`,
    verdict: res.ok ? 'ok' : 'refus',
    refus, alertes,
    empriseCreeeM2: res.surfaces ? res.surfaces.empriseCreeeM2.valeur : null,
    sdpCreee: sdpC ? { valeur: sdpC.valeur, min: sdpC.minM2, max: sdpC.maxM2, source: sdpC.source } : null,
    suggestion: res.suggestion ? `À cette position, une profondeur de ${fr(res.suggestion.profondeurMaxM, 2)} m au plus passerait.` : null,
  };
  const lignesTexte = [
    `**Votre projet : ${type === 'surelevation' ? 'surélévation' : type === 'garage' ? 'garage accolé' : `extension ${OPTIONS_TYPE[type].toLowerCase()}`}${type !== 'surelevation' ? `, côté ${COTE_LISIBLE[etat.facade!]} (vu de la rue)` : ''}, ${vueExt.dimensions}** — maison existante **conservée**.`,
    '',
    res.ok
      ? `Le moteur d’extension la place sans refus${sdpC ? ` : surface de plancher créée ESTIMÉE ≈ ${fr(sdpC.valeur, 1)} m² (entre ${fr(sdpC.minM2, 0)} et ${fr(sdpC.maxM2, 0)} m²)` : ''}${res.surfaces ? `, emprise au sol créée ${fr(res.surfaces.empriseCreeeM2.valeur, 1)} m²` : ''}.`
      : `Le moteur d’extension **refuse** ce placement :\n${refus.map((r) => `- ${r}`).join('\n')}${vueExt.suggestion ? `\n\n${vueExt.suggestion}` : ''}`,
    ...(alertes.length ? ['', ...alertes.map((a) => `- ${a}`)] : []),
    '',
    `**Autorisation (indicatif) : ${LIBELLE_REGIME[regime.regime]} — ${LIBELLE_ARCHITECTE[regime.architecte]}.**`,
    ...regime.lignes.map((x) => `- ${x}`),
    '',
    `_${regime.mention}_ Sources : [F36777](${regime.sources[0]!.url}), [F20568](${regime.sources[1]!.url}).`,
    '',
    'Règles d’implantation utilisées :',
    ...rm.lignes.map((x) => `- ${x}`),
  ];
  if (!projet) avert.push(`Projet non transmissible (contrat refusé) : ${('erreurs' in lu ? lu.erreurs : []).join(' ; ')}`);
  return sortie('termine', lignesTexte.join('\n'), [], {
    projet, optionTravail: projet ? { existant: optionTravailExistant(projet) } : null, erreursProjet: 'erreurs' in lu ? lu.erreurs : [],
    regime, resultatMoteur: res, extension: vueExt, regles: rm.lignes,
  });
}
