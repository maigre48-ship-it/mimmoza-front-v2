// src/spaces/copilot/agent/conception/conceptionLogique.ts
// =============================================================================
// Logique PURE de la conception (prospection → plan → modèle 3D → bilan vivant).
// Contrat : CONTRAT_CONCEPTION.md §4. Testée par conceptionLogique.test.ts.
//   · métriques du modèle → entrées du bilan (même calcul que le moteur et
//     l'Excel : bilanCalcul.ts), bilan au format `terrains[i].bilan` du rapport v2 ;
//   · conformité PLU affichée (ok / dépassement / inconnu), sans rien inventer ;
//   · formulaire des règles (question structurée) ; chemins du bucket.
// =============================================================================
import {
  LIBELLE_REGLE, REGLES_CLES, TYPOLOGIES, lireControles, lireMetriques, lireProgramme, lireRegles,
  type ControleRegle, type MetriquesModele, type ParcelleConception, type PrecisionPlan, type ProgrammeConception,
  type QuestionReglesConception, type RegleCle, type RegleConception,
} from '../../../promoteur/shared/echangeStudio/conception.ts';
import {
  construireModeleRapport, DEFINITIONS_HYPOTHESES, hypothesesTerrain, type JeuHypotheses, type ModeleRapport, type Nombre, type TerrainModele,
} from '../rapport/rapportModele.ts';
import { calculerBilan, entreesDepuisJeu, type EntreesBilan, type ResultatBilan } from '../rapport/bilanCalcul.ts';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ── Lignes de base ───────────────────────────────────────────────────────────

export type StatutConception = 'regles' | 'plan' | 'modele' | 'pret' | 'archive';

export interface Conception {
  id: string;
  mission_id: string | null;
  mission_origine_id: string | null;
  idu: string;
  commune: string | null;
  parcelle: ParcelleConception | null;
  regles: RegleConception[];
  programme: ProgrammeConception | null;
  plan_source: PrecisionPlan | null;
  plan_fichier: string | null;
  statut: StatutConception;
  version_courante: number;
  cree_le: string | null;
  maj_le: string | null;
}

export function lireConception(v: unknown): Conception | null {
  if (!estObj(v) || !texte(v.id) || !texte(v.idu)) return null;
  const p = estObj(v.parcelle) ? v.parcelle : null;
  const geo = p && estObj(p.geometrie) ? p.geometrie : p && estObj(p.geometry) ? p.geometry : p && (p.type === 'Polygon' || p.type === 'MultiPolygon') ? p : null;
  const parcelle: ParcelleConception | null = geo && (geo.type === 'Polygon' || geo.type === 'MultiPolygon') && Array.isArray(geo.coordinates)
    ? { idu: texte(p?.idu) ?? String(v.idu), geometrie: geo as unknown as ParcelleConception['geometrie'], surface_m2: nombre(p?.surface_m2), source: texte(p?.source) ?? 'cadastre' }
    : null;
  const statuts: StatutConception[] = ['regles', 'plan', 'modele', 'pret', 'archive'];
  const plan = v.plan_source === 'plan_fourni' || v.plan_source === 'dessin' || v.plan_source === 'auto' ? v.plan_source : null;
  return {
    id: String(v.id), mission_id: texte(v.mission_id), mission_origine_id: texte(v.mission_origine_id),
    idu: String(v.idu), commune: texte(v.commune), parcelle,
    regles: lireRegles(v.regles_plu), programme: lireProgramme(v.programme),
    plan_source: plan, plan_fichier: texte(v.plan_fichier),
    statut: statuts.includes(v.statut as StatutConception) ? (v.statut as StatutConception) : 'regles',
    version_courante: Math.max(0, Math.round(nombre(v.version_courante) ?? 0)),
    cree_le: texte(v.cree_le), maj_le: texte(v.maj_le),
  };
}

export type OrigineVersion = 'generation' | 'modification_clic' | 'modification_texte' | 'plan_relu';

export interface VersionConception {
  id: string;
  n: number;
  origine: OrigineVersion;
  resume: string;
  metriques: MetriquesModele | null;
  conformite: ControleRegle[];
  bilan: BilanVersion | null;
  modele_ref: string | null;
  cree_le: string | null;
}

export function lireVersion(v: unknown): VersionConception | null {
  if (!estObj(v) || !texte(v.id) || nombre(v.n) == null) return null;
  const o = v.origine;
  return {
    id: String(v.id), n: Math.round(v.n as number),
    origine: o === 'generation' || o === 'modification_texte' || o === 'plan_relu' ? o : 'modification_clic',
    resume: texte(v.resume) ?? '', metriques: lireMetriques(v.metriques), conformite: lireControles(v.conformite),
    bilan: estObj(v.bilan) ? (v.bilan as unknown as BilanVersion) : null,
    modele_ref: texte(v.modele_ref), cree_le: texte(v.cree_le),
  };
}

export const prochainNumero = (versions: readonly Pick<VersionConception, 'n'>[]): number =>
  versions.reduce((m, x) => Math.max(m, x.n), 0) + 1;

export const LIBELLE_STATUT_CONCEPTION: Record<StatutConception, string> = {
  regles: 'Règles du PLU à réunir', plan: 'Choisir la voie du plan', modele: 'Modèle 3D en cours', pret: 'Prêt', archive: 'Archivée',
};

export const VOIES_PLAN: Record<PrecisionPlan, { titre: string; texte: string; precision: string }> = {
  plan_fourni: { titre: 'J’ai le plan', texte: 'Déposez le plan de l’architecte (PDF ou image). Mimmoza le lit et construit le bâtiment dessus.', precision: 'La plus précise : surfaces reprises du plan.' },
  dessin: { titre: 'Je dessine l’emprise', texte: 'Tracez l’emprise sur la parcelle, indiquez les étages et la répartition T1 à T5 : Mimmoza génère le reste.', precision: 'Précision moyenne : surfaces estimées à partir de votre tracé.' },
  auto: { titre: 'Mimmoza propose', texte: 'Mimmoza implante seul un projet qui respecte les règles connues du PLU.', precision: 'Indicatif : à affiner avec un architecte.' },
};

// ── Métriques → bilan ────────────────────────────────────────────────────────

export interface EntreesConception {
  entrees: EntreesBilan;
  jeu: JeuHypotheses;
  /** Hypothèses remplacées par le modèle ou par une règle, avec leur source. */
  remplacees: Partial<Record<keyof JeuHypotheses, string>>;
}

const JEU_VIDE = (): JeuHypotheses =>
  Object.fromEntries(DEFINITIONS_HYPOTHESES.map((d) => [d.cle, { valeur: null, source: null }])) as unknown as JeuHypotheses;

/**
 * Entrées du bilan pour une version du modèle : hypothèses du rapport de
 * prospection (communes + propres au terrain), MAIS surfaces et nombre de
 * logements du modèle, et part sociale de la règle de mixité si elle est connue.
 */
export function entreesConception(
  rapport: Pick<ModeleRapport, 'hypotheses'> | null,
  terrain: Pick<TerrainModele, 'hypothesesSpecifiques'> | null,
  metriques: MetriquesModele,
  regles: readonly RegleConception[],
  surfaceTerrain: Nombre,
  prixNegocie: Nombre = null,
): EntreesConception {
  const jeu: JeuHypotheses = rapport ? hypothesesTerrain(rapport, terrain ?? { hypothesesSpecifiques: {} }) : JEU_VIDE();
  const precision = { plan_fourni: 'plan fourni', dessin: 'dessin', auto: 'proposition Mimmoza' }[metriques.precision];
  const source = `Modèle 3D (${precision})`;
  const remplacees: EntreesConception['remplacees'] = {};
  const poser = (cle: keyof JeuHypotheses, valeur: number, src: string) => { jeu[cle] = { valeur, source: src }; remplacees[cle] = src; };
  poser('shab_m2', metriques.shab_m2, source);
  poser('sdp_m2', metriques.sdp_m2, source);
  // Logements non comptables (plan fourni) : « à préciser », jamais l'hypothèse de la prospection ni 0.
  if (metriques.nb_logements != null) poser('nb_logements', metriques.nb_logements, source);
  else { jeu.nb_logements = { valeur: null, source: `${source} : nombre de logements à préciser` }; remplacees.nb_logements = jeu.nb_logements.source!; }
  const mixite = regles.find((r) => r.cle === 'mixite_sociale_pct');
  if (mixite && mixite.statut !== 'manquant' && typeof mixite.valeur === 'number') {
    poser('part_lls_pct', mixite.valeur / 100, `Règle PLU de mixité sociale (${mixite.source}${mixite.article ? `, ${mixite.article}` : ''})`);
  }
  return { entrees: entreesDepuisJeu(jeu, surfaceTerrain, prixNegocie), jeu, remplacees };
}

/** Bilan d'une version, au schéma de `terrains[i].bilan` du rapport v2 (pourcentages en POURCENT). */
export interface BilanVersion {
  hypotheses_specifiques: Record<string, number | null>;
  ca_ht: Nombre; couts_hors_foncier_ht: Nombre; charge_fonciere_admissible_ht: Nombre;
  charge_fonciere_eur_m2_terrain: Nombre; charge_fonciere_eur_m2_sdp: Nombre; marge_cible_pct_ca: Nombre;
  statut: 'complet' | 'partiel';
  manques: string[];
  detail: Record<string, Nombre>;
  source: 'bilan_vivant';
}

const arrondi = (v: Nombre): Nombre => (v == null ? null : Math.round(v));

export function bilanVersion(e: EntreesConception): { resultat: ResultatBilan; bilan: BilanVersion } {
  const r = calculerBilan(e.entrees);
  const manques = DEFINITIONS_HYPOTHESES.filter((d) => d.requise && e.entrees[d.cle] == null).map((d) => d.libelle);
  if ((e.entrees.part_lls_pct ?? 0) > 0 && e.entrees.prix_cession_lls_eur_m2_shab == null) manques.push('Prix de cession des logements sociaux');
  if (e.entrees.surface_terrain_m2 == null) manques.push('Surface du terrain');
  const spec: Record<string, number | null> = {};
  for (const cle of Object.keys(e.remplacees) as (keyof JeuHypotheses)[]) {
    const def = DEFINITIONS_HYPOTHESES.find((d) => d.cle === cle);
    const v = e.jeu[cle].valeur;
    spec[cle] = v == null ? null : def?.unite === 'pct' ? Math.round(v * 1000) / 10 : v;
  }
  return {
    resultat: r,
    bilan: {
      hypotheses_specifiques: spec,
      ca_ht: arrondi(r.ca), couts_hors_foncier_ht: arrondi(r.coutsHorsFoncier),
      charge_fonciere_admissible_ht: arrondi(r.chargeFonciere),
      charge_fonciere_eur_m2_terrain: arrondi(r.chargeFonciereM2Terrain), charge_fonciere_eur_m2_sdp: arrondi(r.chargeFonciereM2Sdp),
      marge_cible_pct_ca: e.entrees.marge_cible_pct_ca == null ? null : Math.round(e.entrees.marge_cible_pct_ca * 1000) / 10,
      statut: r.etat === 'complet' ? 'complet' : 'partiel',
      manques,
      detail: {
        ca_libre_ht: arrondi(r.caLibre), ca_lls_ht: arrondi(r.caLls), travaux_ht: arrondi(r.travaux),
        honoraires_ht: arrondi(r.honoraires), aleas_ht: arrondi(r.aleas), demolition_ht: r.demolition, vrd_ht: r.vrd,
        taxes_urbanisme_ht: r.taxes, commercialisation_ht: arrondi(r.commercialisation), frais_financiers_ht: arrondi(r.fraisFinanciers),
      },
      source: 'bilan_vivant',
    },
  };
}

export interface Ecart { avant: number; apres: number; delta: number }
export interface EcartsBilan { ca: Ecart | null; couts: Ecart | null; chargeFonciere: Ecart | null; sdp: Ecart | null }

const ecart = (a: Nombre, b: Nombre): Ecart | null => (a == null || b == null ? null : { avant: a, apres: b, delta: b - a });
export function ecartsBilan(
  avant: { resultat: Pick<ResultatBilan, 'ca' | 'coutsHorsFoncier' | 'chargeFonciere'>; sdp: Nombre } | null,
  apres: { resultat: Pick<ResultatBilan, 'ca' | 'coutsHorsFoncier' | 'chargeFonciere'>; sdp: Nombre },
): EcartsBilan | null {
  if (!avant) return null;
  return {
    ca: ecart(avant.resultat.ca, apres.resultat.ca),
    couts: ecart(avant.resultat.coutsHorsFoncier, apres.resultat.coutsHorsFoncier),
    chargeFonciere: ecart(avant.resultat.chargeFonciere, apres.resultat.chargeFonciere),
    sdp: ecart(avant.sdp, apres.sdp),
  };
}

/** « +120 000 € » / « −45 000 € » / « = » (signe moins typographique). */
export function texteDelta(d: number, unite = '€'): string {
  if (Math.abs(d) < 0.5) return '=';
  const v = Math.round(Math.abs(d)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${d > 0 ? '+' : '−'}${v} ${unite}`;
}

// ── Conformité PLU affichée ──────────────────────────────────────────────────

export type OrigineControle = 'studio' | 'calcul' | 'inconnu';
export interface LigneConformite {
  cle: RegleCle;
  libelle: string;
  regle: RegleConception | null;
  valeur_modele: number | null;
  limite: number | string | null;
  ok: boolean | null;
  ecart: string | null;
  origine: OrigineControle;
  /** Unité de `limite` et `valeur_modele` à l'affichage (« places » pour le stationnement calculé). */
  unite: string;
}

const TOLERANCE = 1e-6;
const f1 = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',');

/**
 * Une ligne par règle clé. Priorité au contrôle du Studio (qui connaît la
 * géométrie) ; sinon contrôle calculable depuis les métriques (hauteur,
 * niveaux, emprise, pleine terre, stationnement) ; sinon « non contrôlée ».
 * Une règle inconnue n'est JAMAIS déclarée respectée.
 */
export function conformiteAffichee(
  regles: readonly RegleConception[],
  controlesStudio: readonly ControleRegle[],
  m: MetriquesModele | null,
  surfaceTerrain: Nombre,
): LigneConformite[] {
  return REGLES_CLES.map((cle): LigneConformite => {
    const libelle = LIBELLE_REGLE[cle].libelle;
    const regle = regles.find((r) => r.cle === cle) ?? null;
    const connue = regle && regle.statut !== 'manquant' && regle.valeur !== null;
    const base = { cle, libelle, regle, unite: regle?.unite || LIBELLE_REGLE[cle].unite };
    if (!connue) return { ...base, valeur_modele: null, limite: null, ok: null, ecart: 'Règle inconnue : non contrôlée', origine: 'inconnu' };
    const st = controlesStudio.find((c) => c.cle === cle);
    if (st) return { ...base, valeur_modele: st.valeur_modele, limite: st.limite ?? regle.valeur, ok: st.ok, ecart: st.ecart ?? null, origine: 'studio' };
    const lim = regle.valeur;
    if (!m || typeof lim !== 'number') return { ...base, valeur_modele: null, limite: lim, ok: null, ecart: 'Contrôlé dans l’Atelier 3D (géométrie)', origine: 'inconnu' };
    const max = (val: number, unite: string) => ({ ...base, valeur_modele: val, limite: lim, ok: val <= lim + TOLERANCE, ecart: val <= lim + TOLERANCE ? null : `Dépasse de ${f1(val - lim)} ${unite}`, origine: 'calcul' as const });
    switch (cle) {
      case 'hauteur_max_m': return max(m.hauteur_m, 'm');
      case 'niveaux_max': return max(m.niveaux, 'niveau(x)');
      case 'emprise_sol_max_pct':
        if (!surfaceTerrain) break;
        return max((m.emprise_m2 / surfaceTerrain) * 100, 'point(s) de %');
      case 'pleine_terre_min_pct': {
        if (!surfaceTerrain) break;
        const val = (m.pleine_terre_m2 / surfaceTerrain) * 100;
        const ok = val + TOLERANCE >= lim;
        return { ...base, valeur_modele: val, limite: lim, ok, ecart: ok ? null : `Manque ${f1(lim - val)} point(s) de %`, origine: 'calcul' };
      }
      case 'stationnement_par_logement': {
        if (m.nb_logements == null) return { ...base, valeur_modele: m.places_stationnement, limite: lim, ok: null, ecart: 'Nombre de logements à préciser : non contrôlé', origine: 'inconnu' };
        if (m.places_stationnement == null) break;
        const besoin = Math.ceil(lim * m.nb_logements - TOLERANCE);
        const ok = m.places_stationnement >= besoin;
        return { ...base, unite: 'places', valeur_modele: m.places_stationnement, limite: besoin, ok, ecart: ok ? null : `Manque ${besoin - m.places_stationnement} place(s)`, origine: 'calcul' };
      }
      default: break;
    }
    return { ...base, valeur_modele: null, limite: lim, ok: null, ecart: cle === 'mixite_sociale_pct' ? 'Pris en compte dans le bilan (part sociale)' : 'Contrôlé dans l’Atelier 3D (géométrie)', origine: 'inconnu' };
  });
}

export function resumeConformite(lignes: readonly LigneConformite[]): { ok: number; depassements: number; inconnues: number } {
  return {
    ok: lignes.filter((l) => l.ok === true).length,
    depassements: lignes.filter((l) => l.ok === false).length,
    inconnues: lignes.filter((l) => l.ok === null).length,
  };
}

// ── Formulaire des règles (question structurée) ──────────────────────────────

export interface LigneFormulaire {
  cle: RegleCle;
  libelle: string;
  unite: string;
  saisie: string;
  inconnu: boolean;
  statut: RegleConception['statut'];
  source: string;
  article: string;
  texte: string | null;
  formule: boolean;
}

export function lignesFormulaire(q: QuestionReglesConception): LigneFormulaire[] {
  return q.regles.map((r) => ({
    cle: r.cle, libelle: LIBELLE_REGLE[r.cle].libelle, unite: r.unite || LIBELLE_REGLE[r.cle].unite,
    saisie: r.valeur == null ? '' : String(r.valeur).replace('.', ','),
    inconnu: r.valeur == null, statut: r.statut, source: r.source, article: r.article ?? '', texte: r.texte ?? null,
    formule: r.cle === 'recul_limites_formule',
  }));
}

export type Saisie = { ok: true; valeur: number | string | null } | { ok: false; erreur: string };

/** Lit une saisie du formulaire. Vide ou « inconnu » → null (jamais 0). */
export function lireSaisie(l: Pick<LigneFormulaire, 'cle' | 'formule' | 'unite'>, brut: string, inconnu: boolean): Saisie {
  if (inconnu) return { ok: true, valeur: null };
  const s = brut.trim();
  if (!s) return { ok: true, valeur: null };
  if (l.formule) return { ok: true, valeur: s.slice(0, 120) };
  const n = Number(s.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return { ok: false, erreur: 'Nombre positif attendu' };
  if (l.unite === '%' && n > 100) return { ok: false, erreur: 'Pourcentage entre 0 et 100' };
  if (l.cle === 'niveaux_max' && !Number.isInteger(n)) return { ok: false, erreur: 'Nombre entier de niveaux' };
  return { ok: true, valeur: n };
}

// ── Fichiers du bucket agent-conception ──────────────────────────────────────

export const BUCKET_CONCEPTION = 'agent-conception';
export const TAILLE_MAX_PLAN = 25 * 1024 * 1024;
/** Au-delà, l'agent refuse de lire le règlement : mieux vaut ne déposer que les pages de la zone. */
export const TAILLE_MAX_REGLEMENT = 3 * 1024 * 1024;

const EXT_PLAN: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };

export type CheminFichier = { ok: true; chemin: string; type: string } | { ok: false; erreur: string };

const horodatage = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');

export function cheminPlan(uid: string, dossier: string, f: { type: string; size: number }, maintenant = new Date()): CheminFichier {
  const ext = EXT_PLAN[f.type];
  if (!ext) return { ok: false, erreur: 'Format accepté : PDF, PNG ou JPG.' };
  if (f.size > TAILLE_MAX_PLAN) return { ok: false, erreur: 'Fichier trop lourd (25 Mo au plus).' };
  return { ok: true, chemin: `${uid}/${dossier}/plan-${horodatage(maintenant)}.${ext}`, type: f.type };
}

export function cheminReglement(uid: string, dossier: string, f: { type: string; size: number }, maintenant = new Date()): CheminFichier {
  if (f.type !== 'application/pdf') return { ok: false, erreur: 'Le règlement doit être un PDF.' };
  if (f.size > TAILLE_MAX_REGLEMENT) return { ok: false, erreur: 'Ce PDF dépasse 3 Mo : l’agent ne pourrait pas le lire. Déposez seulement les pages de votre zone (dispositions générales et chapitre de la zone, par exemple UC).' };
  return { ok: true, chemin: `${uid}/${dossier}/reglement-${horodatage(maintenant)}.pdf`, type: f.type };
}

/**
 * Nom UNIQUE à chaque essai d'enregistrement : `modele-v<n>-<8 hex>.mstudio.json`.
 * Un fichier n'est jamais réutilisé : la version référence exactement celui-ci.
 */
export const cheminModele = (uid: string, conceptionId: string, n: number, suffixe: string): string =>
  `${uid}/${conceptionId}/modele-v${n}-${suffixe}.mstudio.json`;
/** Nom accepté par la politique du bucket : n de 1 à 6 chiffres sans zéro devant, suffixe en hexadécimal minuscule. */
export const RE_NOM_MODELE = /^modele-v[1-9][0-9]{0,5}(-[a-f0-9]{8})?\.mstudio\.json$/;
export function suffixeAleatoire(octets: Uint8Array = crypto.getRandomValues(new Uint8Array(4))): string {
  return Array.from(octets.slice(0, 4), (o) => o.toString(16).padStart(2, '0')).join('');
}

/**
 * Dossier d'un dépôt de règlement : la base n'accepte que `<uid>/<conception_id>/…`.
 * Sans conception connue, pas de dépôt possible (null).
 */
export function dossierReglement(q: Pick<QuestionReglesConception, 'dossier_reglement' | 'conception_id'>, uid: string): string | null {
  if (q.conception_id) return q.conception_id;
  const annonce = q.dossier_reglement?.replace(/^\/+|\/+$/g, '');
  const m = annonce ? new RegExp(`^${uid}/([0-9a-fA-F-]{8,64})$`).exec(annonce) : null;
  return m ? m[1] : null;
}

// ── Lancer la conception depuis le rapport de prospection ────────────────────

export function messageLancerConception(t: { idu: string; adresse?: string | null; commune?: string | null; raison?: string | null }, missionOrigineId: string): string {
  const lieu = [t.adresse, t.commune].filter(Boolean).join(', ');
  return `Concevoir le projet sur le terrain ${t.idu}${lieu ? ` (${lieu})` : ''}, retenu par la prospection ${missionOrigineId}. `
    + `Propose-moi une mission de conception (type « conception », critères : idu ${t.idu}, mission_origine_id ${missionOrigineId}) avec son devis.`;
}

// ── Programme affiché ────────────────────────────────────────────────────────

export function texteTypologies(t: Partial<Record<(typeof TYPOLOGIES)[number], number>>): string {
  const parts = TYPOLOGIES.filter((k) => (t[k] ?? 0) > 0).map((k) => `${t[k]} ${k}`);
  return parts.length ? parts.join(' · ') : '—';
}

/** Débit limité : vrai si au moins `ms` se sont écoulées depuis le dernier traitement. */
export const peutTraiter = (dernierMs: number | null, maintenantMs: number, ms = 1000): boolean => dernierMs == null || maintenantMs - dernierMs >= ms;

// ── Modèle « rapport » d'une version, pour réutiliser le bilan Excel ─────────

/**
 * Rapport à un seul terrain dont les hypothèses propres sont celles de la
 * version (surfaces du modèle, part sociale de la règle) : `construireClasseurBilan`
 * produit alors le bilan Excel à formules de CETTE version.
 */
export function modeleRapportVersion(
  rapport: ModeleRapport | null,
  conception: Pick<Conception, 'idu' | 'commune' | 'parcelle'>,
  e: EntreesConception,
  n: number | null,
): ModeleRapport {
  const base = rapport ?? construireModeleRapport({ objectif: null, type: 'conception' }, { titre: `Conception ${conception.idu}`, terrains: [{ idu: conception.idu, commune: conception.commune }] })!;
  const terrain = base.terrains.find((t) => t.idu === conception.idu) ?? base.terrains[0] ?? null;
  const specifiques = { ...(terrain?.hypothesesSpecifiques ?? {}) } as TerrainModele['hypothesesSpecifiques'];
  for (const cle of Object.keys(e.remplacees) as (keyof JeuHypotheses)[]) specifiques[cle] = { ...e.jeu[cle] };
  const surface = e.entrees.surface_terrain_m2 ?? terrain?.surface_m2 ?? null;
  const t: TerrainModele = {
    ...(terrain ?? { rang: 1, idu: conception.idu, commune: conception.commune, adresse: null, zonageCode: null, zonageLibelle: null, verdict: null, ton: 'neutre', score: null, potentiel_logements: null, proprietaire: null, contraintes: [], points_forts: [], points_bloquants: [], sources: [], charge_fonciere: null, charge_fonciere_m2: null, cfM2Calculee: false, bilan: null }),
    rang: 1, surface_m2: surface, hypothesesSpecifiques: specifiques,
  } as TerrainModele;
  return {
    ...base,
    titre: `Bilan du projet — parcelle ${conception.idu}${n ? ` — version ${n}` : ' — version en cours'}`,
    terrains: [t],
    classement: [],
    noteBilanIdentique: null,
  };
}

// ── Rapport d'une mission de conception (rapport.conception) ─────────────────

export interface ConceptionPrete {
  conception_id: string;
  idu: string;
  commune: string | null;
  surface_m2: number | null;
  regles: RegleConception[];
  regles_manquantes: string[];
  alertes_programme: string[];
  prochaine_etape: string | null;
}

export function lireConceptionPrete(rapport: unknown): ConceptionPrete | null {
  const c = estObj(rapport) && estObj(rapport.conception) ? rapport.conception : null;
  if (!c || !texte(c.conception_id) || !texte(c.idu)) return null;
  const liste = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : estObj(x) ? texte(x.libelle) ?? texte(x.cle) ?? '' : '')).filter(Boolean) : []);
  return {
    conception_id: String(c.conception_id), idu: String(c.idu), commune: texte(c.commune),
    surface_m2: estObj(c.parcelle) ? nombre(c.parcelle.surface_m2) : null,
    regles: lireRegles(c.regles),
    regles_manquantes: liste(c.regles_manquantes).map((x) => (REGLES_CLES as readonly string[]).includes(x) ? LIBELLE_REGLE[x as RegleCle].libelle : x),
    alertes_programme: liste(c.alertes_programme),
    prochaine_etape: texte(c.prochaine_etape),
  };
}

// ── Avertissement de saisie : fraction dans une règle en % ──────────────────

/** « 0,4 » pour une règle en % : probablement 40 % (simple avertissement, la valeur reste celle saisie). */
export function avertissementSaisie(l: Pick<LigneFormulaire, 'unite' | 'inconnu'>, valeur: number | string | null): string | null {
  if (l.inconnu || l.unite !== '%' || typeof valeur !== 'number' || valeur <= 0 || valeur > 1) return null;
  const pct = Math.round(valeur * 1000) / 10;
  return `Vouliez-vous dire ${String(pct).replace('.', ',')} % ?`;
}

// ── Ouverture de la conception dans le Studio (une fois par session) ─────────
//
// Le Studio répond « prêt » (protocole d'échange) à chaque « bonjour » envoyé
// toutes les 2 s : on ne doit PAS renvoyer conception.ouvrir à chaque fois
// (le Studio remettrait tout à zéro). Règle : un seul envoi par session, au
// premier conception.pret ; à défaut, 1,5 s après le premier « prêt » (Studio
// qui ne l'annonce pas). Sans conception.pret ni métriques 10 s après le premier
// « prêt » : Studio trop ancien pour la conception (message à l'utilisateur).

export interface EtatOuverture { cadrePret: boolean; conceptionPret: boolean; envoye: boolean; recuMetriques: boolean; studioAncien: boolean }
export type EvenementOuverture = 'cadre_pret' | 'conception_pret' | 'delai_envoi' | 'delai_ancien' | 'metriques';
export const DELAI_ENVOI_MS = 1500;
export const DELAI_STUDIO_ANCIEN_MS = 10_000;

export const ouvertureInitiale = (): EtatOuverture => ({ cadrePret: false, conceptionPret: false, envoye: false, recuMetriques: false, studioAncien: false });

/** Transition pure : nouvel état, et faut-il envoyer conception.ouvrir maintenant ? */
export function transitionOuverture(e: EtatOuverture, ev: EvenementOuverture): { etat: EtatOuverture; envoyer: boolean } {
  switch (ev) {
    case 'cadre_pret': return { etat: { ...e, cadrePret: true }, envoyer: false };
    case 'conception_pret': return { etat: { ...e, conceptionPret: true, envoye: true, studioAncien: false }, envoyer: !e.envoye };
    case 'delai_envoi': return e.cadrePret && !e.envoye ? { etat: { ...e, envoye: true }, envoyer: true } : { etat: e, envoyer: false };
    case 'delai_ancien': return { etat: { ...e, studioAncien: e.cadrePret && !e.conceptionPret && !e.recuMetriques }, envoyer: false };
    case 'metriques': return { etat: { ...e, recuMetriques: true, studioAncien: false }, envoyer: false };
  }
}
