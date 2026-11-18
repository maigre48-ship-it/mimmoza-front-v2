// src/spaces/copilot/studio3d/planExistantStudio.ts
// =============================================================================
// LOT F5 (17/11/2026) — « PLAN DE L'EXISTANT » : le site confie la lecture d'un plan au Studio intégré, et reçoit en
// retour le relevé VALIDÉ par la personne. Logique PURE (node --test : planExistantStudio.test.ts).
//
// Remplace la transcription de plans par gpt-4o (fonctions `analyze-rehab-plan` et `transcribe-rehab-plan`, retirées) :
// la lecture se fait dans le Studio, dans le navigateur (calcul local, AUCUN jeton), recalée sur l'emprise du bâtiment
// existant ; chaque valeur garde son statut (lu, mesuré, déduit, supposé, à confirmer) et les valeurs incertaines sont
// posées en questions fermées. Le modèle de langage ne lit pas le plan, ne calcule rien et ne place aucune géométrie.
//
// CONTRAT D'ÉCHANGE (site ⇄ Studio intégré, même origine, cible = origine exacte, jamais « * ») :
//   ALLER — compléments joints au message « projet » (à côté de `projetExtension`, comme `dossier` du lot D9) :
//     · `planExistant` : { format: 'mimmoza-plan-existant', version: 1, ouvrir: 'import-plan', provenance,
//                          fichiers: [{ nom, type, taille, octets?: ArrayBuffer, url?: 'https://…' (signée, 1 h) }],
//                          expireLe: ISO | null, mention }
//       → le Studio ouvre « Plans & dossier › Plan de l'existant », écran « Importer un plan », fichiers préchargés.
//     · `photoCalee`   : { format: 'mimmoza-photo-calee', version: 1, travailId, photoUrl, planUrl, verdict, mention,
//                          date, expireLe } — photo et plan de calage d'un travail « image dans sa rue » (seau privé,
//                          adresses signées 1 h) → écran « Relevé sur la photo calée ».
//   RETOUR — quand la personne POSE le relevé (questions fermées répondues) :
//     { type: 'mimmoza.studio.releve-existant', version: 1, sessionId, releve: <mimmoza-releve-existant v1>,
//       synthese: { pieces: [{ nom, niveau, surfaceM2, statutSurface, statutNom }], murs: { exterieurs, interieurs } } }
//     relu ici (`lireRetourReleve`) : rien n'est complété ; une valeur illisible est écartée et dite.
// =============================================================================

// LOT G6 — résumé « plan lu » (échelle, dimensions, emprise / BD TOPO, pièces, points douteux) et contexte du parcours.
import { contextePlanLu, lirePlanLuStudio, type PlanLuSite } from './planLuChat.ts';

export const EVENEMENT_IMPORTER_PLAN_EXISTANT = 'mimmoza:importer-plan-existant';
export const FORMAT_PLAN_EXISTANT = 'mimmoza-plan-existant';
export const FORMAT_PHOTO_CALEE = 'mimmoza-photo-calee';
export const TYPE_RETOUR_RELEVE = 'mimmoza.studio.releve-existant';
export const FORMAT_RELEVE = 'mimmoza-releve-existant';

/** Limites contrôlées AVANT tout envoi (même plafond que le seau `studio-transfert`). */
export const TAILLE_MAX_FICHIER_PLAN = 20 * 1024 * 1024;
export const NB_MAX_FICHIERS_PLAN = 6;
export const TAILLE_MAX_TOTALE_PLAN = 60 * 1024 * 1024;
/** Durée de validité des adresses signées transmises au Studio (s). */
export const DUREE_URL_PLAN_S = 3600;

/** Formats lus par le Studio (lecture de plan) : DXF, PDF (vectoriel ou scanné), PNG, JPEG. */
export const ACCEPTE_PLAN_EXISTANT = '.dxf,.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';

/** Phrase dite à la personne (aucun nom d'outil interne). */
export const MENTION_LECTURE_LOCALE = 'Lecture du plan dans le Studio : calcul sur votre ordinateur, aucun jeton consommé. Chaque valeur garde son statut (lu, mesuré, déduit, supposé, à confirmer) ; les valeurs incertaines vous sont posées en questions avant d’être retenues.';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const txt = (v: unknown, n = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fr = (v: number, d = 1): string => v.toFixed(d).replace('.', ',');

/* ------------------------------------------------------------------ */
/* Fichiers transmis                                                   */
/* ------------------------------------------------------------------ */

export type TypePlan = 'application/pdf' | 'image/png' | 'image/jpeg' | 'application/dxf';

/** Type retenu : par le type MIME, sinon par l'extension (un DXF arrive souvent sans type MIME). Pur. */
export function typePlan(nom: string, type: string): TypePlan | null {
  const t = (type || '').toLowerCase();
  const ext = (nom.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]) ?? '';
  if (t === 'application/pdf' || (!t && ext === 'pdf') || (t === 'application/octet-stream' && ext === 'pdf')) return 'application/pdf';
  if (t === 'image/png' || (!t && ext === 'png')) return 'image/png';
  if (t === 'image/jpeg' || t === 'image/jpg' || (!t && (ext === 'jpg' || ext === 'jpeg'))) return 'image/jpeg';
  if (ext === 'dxf' && (!t || t === 'application/dxf' || t === 'image/vnd.dxf' || t === 'image/x-dxf' || t === 'application/octet-stream' || t === 'text/plain')) return 'application/dxf';
  return null;
}

export type ControleFichier = { ok: true; type: TypePlan } | { ok: false; raison: string };

/** Contrôle d'un fichier de plan (type et taille). Pur. */
export function controlerFichierPlan(f: { nom: string; type: string; taille: number }): ControleFichier {
  const t = typePlan(f.nom, f.type);
  if (!t) return { ok: false, raison: `${f.nom} : format non pris en charge (DXF, PDF, PNG ou JPEG).` };
  if (!fini(f.taille) || f.taille <= 0) return { ok: false, raison: `${f.nom} : fichier vide.` };
  if (f.taille > TAILLE_MAX_FICHIER_PLAN) return { ok: false, raison: `${f.nom} : plus de 20 Mo.` };
  return { ok: true, type: t };
}

export interface FichierPlanTransmis {
  nom: string;
  type: TypePlan;
  taille: number;
  /** Octets du fichier (fichier en mémoire du navigateur : passé tel quel au Studio, même origine). */
  octets?: ArrayBuffer;
  /** Adresse signée (fichier déjà stocké) ; https seulement. */
  url?: string;
}

export type ProvenancePlan = 'rehabilitation' | 'conversation' | 'marchand';

export interface BlocPlanExistant {
  format: typeof FORMAT_PLAN_EXISTANT;
  version: 1;
  ouvrir: 'import-plan';
  provenance: ProvenancePlan;
  fichiers: FichierPlanTransmis[];
  expireLe: string | null;
  mention: string;
}

/**
 * Bloc `planExistant` du message « projet ». Sans fichier : le Studio ouvre l'écran d'import vide (la personne choisit
 * son fichier là-bas). Refus lisible si un fichier ne passe pas les contrôles. Pur.
 */
export function blocPlanExistant(e: {
  provenance: ProvenancePlan;
  fichiers: readonly { nom: string; type: string; taille: number; octets?: ArrayBuffer; url?: string }[];
  maintenantMs: number;
}): { ok: true; bloc: BlocPlanExistant } | { ok: false; raison: string } {
  if (e.fichiers.length > NB_MAX_FICHIERS_PLAN) return { ok: false, raison: `Au plus ${NB_MAX_FICHIERS_PLAN} fichiers de plan (un par niveau).` };
  const total = e.fichiers.reduce((s, f) => s + (fini(f.taille) ? f.taille : 0), 0);
  if (total > TAILLE_MAX_TOTALE_PLAN) return { ok: false, raison: 'Les plans dépassent 60 Mo au total.' };
  const fichiers: FichierPlanTransmis[] = [];
  let signe = false;
  for (const f of e.fichiers) {
    const c = controlerFichierPlan(f);
    if (!c.ok) return { ok: false, raison: c.raison };
    const aOctets = f.octets instanceof ArrayBuffer && f.octets.byteLength > 0;
    const aUrl = typeof f.url === 'string' && /^https:\/\//.test(f.url);
    if (!aOctets && !aUrl) return { ok: false, raison: `${f.nom} : contenu indisponible (ni fichier ni adresse sécurisée).` };
    if (aOctets && f.octets!.byteLength !== f.taille) return { ok: false, raison: `${f.nom} : taille incohérente.` };
    if (!aOctets) signe = true;
    fichiers.push({ nom: f.nom.slice(0, 160), type: c.type, taille: f.taille, ...(aOctets ? { octets: f.octets! } : { url: f.url! }) });
  }
  return {
    ok: true,
    bloc: {
      format: FORMAT_PLAN_EXISTANT, version: 1, ouvrir: 'import-plan', provenance: e.provenance, fichiers,
      expireLe: signe ? new Date(e.maintenantMs + DUREE_URL_PLAN_S * 1000).toISOString() : null,
      mention: MENTION_LECTURE_LOCALE,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Plan en attente (fourni ailleurs sur le site, lu depuis Mimmo)      */
/* ------------------------------------------------------------------ */

export interface PlanEnAttente {
  nom: string;
  type: string;
  taille: number;
  octets: ArrayBuffer;
  provenance: ProvenancePlan;
  deposeLeMs: number;
}

/** Durée de vie d'un plan déposé en attente (mémoire de l'onglet seulement ; un rechargement l'efface). */
export const DUREE_PLAN_EN_ATTENTE_MS = 60 * 60 * 1000;

let enAttente: PlanEnAttente | null = null;

/** Dépose un plan en mémoire de l'onglet (aucun envoi, aucun stockage). Contrôlé d'abord. */
export function deposerPlanEnAttente(p: PlanEnAttente): ControleFichier {
  const c = controlerFichierPlan({ nom: p.nom, type: p.type, taille: p.taille });
  if (c.ok) enAttente = { ...p };
  return c;
}

/** Plan en attente encore valide (sans le retirer). */
export function planEnAttente(maintenantMs: number): PlanEnAttente | null {
  if (enAttente && maintenantMs - enAttente.deposeLeMs > DUREE_PLAN_EN_ATTENTE_MS) enAttente = null;
  return enAttente;
}

export function oublierPlanEnAttente(): void { enAttente = null; }

/* ------------------------------------------------------------------ */
/* Photo calée du travail d'image                                      */
/* ------------------------------------------------------------------ */

/** Forme minimale d'un travail lue ici (sous-ensemble de `TravailStudio`, `src/lib/studio/travauxLogique.ts`). */
export interface TravailPourPhoto {
  id: string;
  type: string;
  statut: string;
  termine_le: string | null;
  resultat: unknown;
}

export interface PhotoCaleeTrouvee {
  travailId: string;
  photoPath: string;
  planPath: string;
  verdict: string | null;
  mention: string | null;
  date: string | null;
}

/**
 * Photo calée disponible : dernier travail d'image dont la machine de rendu a déposé la photo ET le plan de calage
 * (`resultat.photomontage.atelier`). Les travaux du plus récent au plus ancien (ordre de `listerTravaux`). Pur.
 * Un photomontage « livré » ne dépose pas son plan de calage (contrat P2) : il n'est donc pas proposé.
 */
export function photoCaleePourStudio(travaux: readonly TravailPourPhoto[]): PhotoCaleeTrouvee | null {
  for (const t of travaux) {
    if (t.type !== 'image' || t.statut !== 'termine' || !estObj(t.resultat)) continue;
    const pm = t.resultat['photomontage'];
    if (!estObj(pm) || !estObj(pm['atelier'])) continue;
    const photoPath = txt(pm['atelier']['photo_path'], 500);
    const planPath = txt(pm['atelier']['plan_path'], 500);
    if (!photoPath || !planPath || !/\.json$/i.test(planPath)) continue;
    return { travailId: t.id, photoPath, planPath, verdict: txt(pm['verdict'], 40), mention: txt(pm['mention'], 300), date: t.termine_le };
  }
  return null;
}

export interface BlocPhotoCalee {
  format: typeof FORMAT_PHOTO_CALEE;
  version: 1;
  travailId: string;
  photoUrl: string;
  planUrl: string;
  verdict: string | null;
  mention: string | null;
  date: string | null;
  expireLe: string;
}

/** Bloc `photoCalee` (adresses signées https uniquement). Pur. */
export function blocPhotoCalee(p: PhotoCaleeTrouvee, photoUrl: string, planUrl: string, maintenantMs: number): BlocPhotoCalee | null {
  if (!/^https:\/\//.test(photoUrl) || !/^https:\/\//.test(planUrl)) return null;
  return {
    format: FORMAT_PHOTO_CALEE, version: 1, travailId: p.travailId, photoUrl, planUrl, verdict: p.verdict, mention: p.mention, date: p.date,
    expireLe: new Date(maintenantMs + DUREE_URL_PLAN_S * 1000).toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Retour : relevé validé                                              */
/* ------------------------------------------------------------------ */

export type StatutReleve = 'lu' | 'mesure' | 'deduit' | 'suppose' | 'a-confirmer' | 'non-visible' | 'confirme' | 'mesuree' | 'estimee' | 'supposee' | 'confirmee';
const STATUTS: readonly StatutReleve[] = ['lu', 'mesure', 'deduit', 'suppose', 'a-confirmer', 'non-visible', 'confirme', 'mesuree', 'estimee', 'supposee', 'confirmee'];
export const LIBELLE_STATUT: Readonly<Record<StatutReleve, string>> = {
  lu: 'lu sur le plan', mesure: 'mesuré', deduit: 'déduit', suppose: 'supposé', 'a-confirmer': 'à confirmer', 'non-visible': 'non visible', confirme: 'confirmé',
  mesuree: 'mesuré', estimee: 'estimé', supposee: 'supposé', confirmee: 'confirmé',
};
const statut = (v: unknown): StatutReleve | null => (STATUTS.includes(v as StatutReleve) ? v as StatutReleve : null);

export type SourceReleve = 'import-plan' | 'photo' | 'saisie' | 'fusion';
const SOURCES: readonly SourceReleve[] = ['import-plan', 'photo', 'saisie', 'fusion'];
export const LIBELLE_SOURCE_RELEVE: Readonly<Record<SourceReleve, string>> = {
  'import-plan': 'plan fourni (lecture automatique)', photo: 'relevé sur photographie', saisie: 'saisie manuelle', fusion: 'plan fourni et photographie comparés',
};

export interface PieceReleve { nom: string | null; niveau: string; surfaceM2: number; statutSurface: StatutReleve; statutNom: StatutReleve | null }
export interface BaieReleveSite { cote: number; niveau: number; type: string; largeurM: number | null; hauteurM: number | null; statutLargeur: StatutReleve | null; statutHauteur: StatutReleve | null }

export interface SyntheseReleve {
  source: SourceReleve;
  origine: string;
  maisonId: string;
  recuLeMs: number;
  pieces: PieceReleve[];
  /** Somme des surfaces des pièces relevées (aucune pièce : null). Statut : celui de la moins sûre des pièces. */
  surfacePiecesM2: number | null;
  statutSurfacePieces: StatutReleve | null;
  murs: { exterieurs: number | null; interieurs: number | null };
  baies: BaieReleveSite[];
  facadesVues: number[] | null;
  zonesNonVues: number;
  avertissements: string[];
  ecartes: string[];
  /** LOT G6 — résumé de la lecture d'un plan fourni (absent pour une photo ou une saisie dans le Studio). */
  planLu?: PlanLuSite | null;
}

/** Ordre de prudence : la somme prend le statut le moins sûr de ses termes. */
const RANG: Readonly<Record<StatutReleve, number>> = {
  confirme: 0, confirmee: 0, lu: 1, mesure: 1, mesuree: 1, deduit: 2, estimee: 3, suppose: 4, supposee: 4, 'a-confirmer': 5, 'non-visible': 6,
};

function donnee(v: unknown): { valeur: number; statut: StatutReleve } | null {
  if (!estObj(v) || !fini(v['valeur']) || v['valeur'] <= 0) return null;
  const s = statut(v['statut']);
  return s ? { valeur: v['valeur'], statut: s } : null;
}

export type RetourReleve = { ok: true; synthese: SyntheseReleve } | { ok: false; raison: string };

/**
 * Message de retour du Studio → synthèse pour les écrans du site. Ne complète rien : une pièce sans surface lisible
 * ou sans statut est ÉCARTÉE (et dite dans `ecartes`). Session obligatoire (celle du Studio intégré ouvert). Pur.
 */
export function lireRetourReleve(data: unknown, sessionId: string, maintenantMs: number): RetourReleve {
  if (!estObj(data) || data['type'] !== TYPE_RETOUR_RELEVE) return { ok: false, raison: 'message non attendu' };
  if (data['version'] !== 1) return { ok: false, raison: 'version du relevé non prise en charge' };
  if (data['sessionId'] !== sessionId) return { ok: false, raison: 'session inconnue' };
  const r = data['releve'];
  if (!estObj(r) || r['format'] !== FORMAT_RELEVE || r['version'] !== 1) return { ok: false, raison: 'relevé illisible' };
  const source = SOURCES.includes(r['source'] as SourceReleve) ? r['source'] as SourceReleve : null;
  const maisonId = txt(r['maisonId'], 120);
  if (!source || !maisonId) return { ok: false, raison: 'relevé sans source ou sans bâtiment' };
  const ecartes: string[] = [];
  const syn = estObj(data['synthese']) ? data['synthese'] : {};

  const pieces: PieceReleve[] = [];
  for (const p of Array.isArray(syn['pieces']) ? syn['pieces'].slice(0, 200) : []) {
    if (!estObj(p)) continue;
    const surf = p['surfaceM2'];
    const st = statut(p['statutSurface']);
    const nom = txt(p['nom'], 80);
    if (!fini(surf) || surf <= 0 || surf > 100000 || !st) { ecartes.push(`Pièce ${nom ?? 'sans nom'} : surface illisible, écartée.`); continue; }
    pieces.push({ nom, niveau: txt(p['niveau'], 40) ?? '?', surfaceM2: Math.round(surf * 100) / 100, statutSurface: st, statutNom: statut(p['statutNom']) });
  }
  const somme = pieces.length ? Math.round(pieces.reduce((s, p) => s + p.surfaceM2, 0) * 100) / 100 : null;
  const statutSomme = pieces.length ? pieces.map((p) => p.statutSurface).sort((a, b) => RANG[b] - RANG[a])[0]! : null;

  const baies: BaieReleveSite[] = [];
  for (const b of Array.isArray(r['baies']) ? r['baies'].slice(0, 400) : []) {
    if (!estObj(b) || !fini(b['cote']) || !fini(b['niveau'])) continue;
    const l = donnee(b['largeurM']), h = donnee(b['hauteurM']);
    baies.push({ cote: b['cote'], niveau: b['niveau'], type: txt(b['type'], 40) ?? 'baie', largeurM: l?.valeur ?? null, hauteurM: h?.valeur ?? null, statutLargeur: l?.statut ?? null, statutHauteur: h?.statut ?? null });
  }
  const murs = estObj(syn['murs']) ? syn['murs'] : {};
  const nb = (v: unknown): number | null => (fini(v) && v >= 0 && Number.isInteger(v) ? v : null);
  const facades = Array.isArray(r['facadesVues']) ? r['facadesVues'].filter(fini) : null;
  return {
    ok: true,
    synthese: {
      source, origine: txt(r['origine'], 200) ?? '', maisonId, recuLeMs: maintenantMs,
      pieces, surfacePiecesM2: somme, statutSurfacePieces: statutSomme,
      murs: { exterieurs: nb(murs['exterieurs']), interieurs: nb(murs['interieurs']) },
      baies, facadesVues: facades, zonesNonVues: Array.isArray(r['zonesNonVues']) ? r['zonesNonVues'].length : 0,
      avertissements: (Array.isArray(r['avertissements']) ? r['avertissements'] : []).map((a) => txt(a, 300)).filter((a): a is string => !!a).slice(0, 30),
      ecartes,
      // LOT G6 — résumé « plan lu » (relu sans rien compléter ; absent pour un relevé sur photo ou une saisie).
      planLu: lirePlanLuStudio(r['planLu'], txt(r['origine'], 200) ?? '', maintenantMs),
    },
  };
}

/** Lignes lisibles du relevé (écrans du site, résumé du tchat). Pur. */
export function lignesReleve(s: SyntheseReleve): string[] {
  const out = [`Relevé de l’existant validé dans le Studio — ${LIBELLE_SOURCE_RELEVE[s.source]}${s.origine ? ` (${s.origine})` : ''}.`];
  if (s.pieces.length) {
    out.push(`${s.pieces.length} pièce(s), surface des pièces ${fr(s.surfacePiecesM2!, 2)} m² (${LIBELLE_STATUT[s.statutSurfacePieces!]}, somme des pièces relevées).`);
  } else {
    out.push('Aucune pièce relevée : l’intérieur n’est pas connu (un relevé sur photo ne voit que les façades).');
  }
  const m = [s.murs.exterieurs !== null ? `${s.murs.exterieurs} façade(s)` : null, s.murs.interieurs !== null ? `${s.murs.interieurs} mur(s) intérieur(s)` : null].filter(Boolean);
  if (m.length) out.push(`Murs : ${m.join(', ')}.`);
  out.push(`${s.baies.length} baie(s) relevée(s).`);
  if (s.zonesNonVues) out.push(`${s.zonesNonVues} zone(s) de façade non vue(s) : des baies peuvent s’y trouver.`);
  return out;
}

/** Champs du contexte du copilote (mêmes clés que l'ancienne analyse : le serveur les lit déjà). Pur. */
export function contexteCopilotReleve(s: SyntheseReleve): Record<string, string | number | null> {
  return {
    plan_summary: lignesReleve(s).join(' '),
    plan_surface_retenue_m2: s.surfacePiecesM2,
    plan_room_count: s.pieces.length || null,
    plan_rooms: s.pieces.length ? s.pieces.map((p) => `${p.nom ?? 'pièce sans nom'} (${fr(p.surfaceM2, 2)} m², ${LIBELLE_STATUT[p.statutSurface]})`).join(', ') : null,
    plan_anomalies: s.avertissements.length ? s.avertissements.slice(0, 20).join(' | ') : null,
    // LOT G6 — plan lu (valeurs et statuts) relu par le parcours d'extension.
    ...(s.planLu ? contextePlanLu(s.planLu) : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Mémoire du dernier relevé (stockage injectable)                     */
/* ------------------------------------------------------------------ */

export const CLE_RELEVE_MEMORISE = 'mimmoza.releveExistant.v1';
export interface StockageReleve { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export function memoriserReleve(stock: StockageReleve | null, s: SyntheseReleve, conversationId: string | null): void {
  try { stock?.setItem(CLE_RELEVE_MEMORISE, JSON.stringify({ v: 1, conversationId, synthese: s })); } catch { /* quota : silencieux */ }
}

export function releveMemorise(stock: StockageReleve | null): { conversationId: string | null; synthese: SyntheseReleve } | null {
  try {
    const brut = stock?.getItem(CLE_RELEVE_MEMORISE);
    if (!brut) return null;
    const o = JSON.parse(brut) as unknown;
    if (!estObj(o) || o['v'] !== 1 || !estObj(o['synthese'])) return null;
    const s = o['synthese'] as unknown as SyntheseReleve;
    if (!SOURCES.includes(s.source) || !Array.isArray(s.pieces) || !Array.isArray(s.baies)) return null;
    return { conversationId: typeof o['conversationId'] === 'string' ? o['conversationId'] : null, synthese: s };
  } catch { return null; }
}

/* ------------------------------------------------------------------ */
/* Bouton de la carte « Extension de maison »                          */
/* ------------------------------------------------------------------ */

/**
 * « Lire le plan de l'existant » : visible dès que le projet d'extension (contrat X0) est transmissible et que la maison
 * existante est CONSERVÉE (le Studio cale le plan sur son emprise). Pur.
 */
export function etatLirePlanExistant(v: { projetEnregistre: boolean; projetExtension: { existants: readonly { mode: string }[] } | null } | null): boolean {
  return !!v && v.projetEnregistre && !!v.projetExtension && v.projetExtension.existants.some((x) => x.mode === 'conserver');
}
