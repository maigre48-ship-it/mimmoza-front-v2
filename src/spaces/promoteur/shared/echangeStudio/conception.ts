// src/spaces/promoteur/shared/echangeStudio/conception.ts
// =============================================================================
// TYPES ET MESSAGES COMMUNS « CONCEPTION » — Mimmoza (front), Studio, moteur.
// Contrat : CONTRAT_CONCEPTION.md §3. Ce fichier est AUTONOME (aucun import) :
// le Studio le recopie À L'IDENTIQUE dans son module d'échange, le moteur de
// mission (Deno) en reprend les types. Toute évolution : incrémenter
// VERSION_CONCEPTION et rester capable de lire les versions précédentes.
//
// Règle d'or : jamais de donnée inventée. Une règle inconnue est `manquant`
// (valeur null) et un contrôle sur une règle inconnue vaut `ok: null`.
// =============================================================================

// ── Types de base (§3, identiques partout) ───────────────────────────────────

export type RegleCle =
  | 'hauteur_max_m' | 'niveaux_max' | 'emprise_sol_max_pct' | 'recul_voie_m' | 'recul_limites_m'
  | 'recul_limites_formule' | 'pleine_terre_min_pct' | 'stationnement_par_logement' | 'mixite_sociale_pct';

export const REGLES_CLES: readonly RegleCle[] = [
  'hauteur_max_m', 'niveaux_max', 'emprise_sol_max_pct', 'recul_voie_m', 'recul_limites_m',
  'recul_limites_formule', 'pleine_terre_min_pct', 'stationnement_par_logement', 'mixite_sociale_pct',
];

export type StatutRegle = 'confirme' | 'estime' | 'manquant';

export interface RegleConception {
  cle: RegleCle;
  /** Nombre (m, %, niveaux, places) ; texte pour `recul_limites_formule` (« H/2 min 4 m ») ; null = inconnue. */
  valeur: number | string | null;
  unite: string;
  statut: StatutRegle;
  /** Toujours renseignée : « règlement PLUi, art. UC 10 », « moteur de règles Mimmoza », « utilisateur »… */
  source: string;
  article?: string;
  /** Extrait cité du règlement, s'il a été lu. */
  texte?: string;
}

export type Typologie = 'T1' | 'T2' | 'T3' | 'T4' | 'T5';
export const TYPOLOGIES: readonly Typologie[] = ['T1', 'T2', 'T3', 'T4', 'T5'];

export type PrecisionPlan = 'plan_fourni' | 'dessin' | 'auto';

export interface MetriquesModele {
  emprise_m2: number;
  sdp_m2: number;
  shab_m2: number;
  /** null : logements non comptables (plan fourni sans découpage lisible) — jamais 0 inventé. */
  nb_logements: number | null;
  typologies: Record<Typologie, number>;
  niveaux: number;
  hauteur_m: number;
  pleine_terre_m2: number;
  places_stationnement: number | null;
  precision: PrecisionPlan;
}

export interface ControleRegle {
  cle: RegleCle;
  valeur_modele: number | null;
  limite: number | string | null;
  /** true = respecte, false = dépassement, null = règle inconnue (non contrôlable). */
  ok: boolean | null;
  ecart?: string;
}

/** Programme demandé (colonne `agent_conceptions.programme`). */
export interface ProgrammeConception {
  nb_logements: number | null;
  typologies: Partial<Record<Typologie, number>>;
  shab_cible_m2: number | null;
  sdp_cible_m2: number | null;
  gabarit: string | null;
  stationnement: number | null;
}

/** Parcelle réelle (colonne `agent_conceptions.parcelle`) : contour GeoJSON (WGS84). */
export interface ParcelleConception {
  idu: string;
  geometrie: { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };
  surface_m2: number | null;
  source: string;
}

// ── Libellés (français simple) ───────────────────────────────────────────────

export const LIBELLE_REGLE: Record<RegleCle, { libelle: string; unite: string }> = {
  hauteur_max_m: { libelle: 'Hauteur maximale', unite: 'm' },
  niveaux_max: { libelle: 'Nombre de niveaux maximal', unite: 'niveaux' },
  emprise_sol_max_pct: { libelle: 'Emprise au sol maximale', unite: '%' },
  recul_voie_m: { libelle: 'Recul par rapport à la voie', unite: 'm' },
  recul_limites_m: { libelle: 'Recul par rapport aux limites séparatives', unite: 'm' },
  recul_limites_formule: { libelle: 'Règle de recul aux limites (formule)', unite: 'formule' },
  pleine_terre_min_pct: { libelle: 'Pleine terre / espaces verts minimum', unite: '%' },
  stationnement_par_logement: { libelle: 'Places de stationnement par logement', unite: 'places/logement' },
  mixite_sociale_pct: { libelle: 'Part de logements sociaux imposée', unite: '%' },
};

// ── Validation (données venues d'une autre fenêtre ou de la base) ────────────

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positif = (v: unknown): v is number => fini(v) && v >= 0;
const chaine = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function lireRegle(v: unknown): RegleConception | null {
  if (!estObj(v)) return null;
  const cle = v.cle;
  if (typeof cle !== 'string' || !(REGLES_CLES as readonly string[]).includes(cle)) return null;
  const statut = v.statut === 'confirme' || v.statut === 'estime' || v.statut === 'manquant' ? v.statut : null;
  const source = chaine(v.source, 300);
  if (!statut || !source) return null; // une règle sans source n'existe pas
  let valeur: number | string | null = null;
  if (cle === 'recul_limites_formule') valeur = chaine(v.valeur, 120);
  else if (positif(v.valeur)) valeur = v.valeur;
  // Valeur absente → la règle est forcément « manquant » (jamais confirmée à vide).
  const statutFinal: StatutRegle = valeur === null ? 'manquant' : statut;
  const r: RegleConception = { cle: cle as RegleCle, valeur, unite: chaine(v.unite, 40) ?? LIBELLE_REGLE[cle as RegleCle].unite, statut: statutFinal, source };
  const article = chaine(v.article, 120); if (article) r.article = article;
  const texte = chaine(v.texte, 1500); if (texte) r.texte = texte;
  return r;
}

export function lireRegles(v: unknown): RegleConception[] {
  if (!Array.isArray(v)) return [];
  const vues = new Set<RegleCle>();
  const res: RegleConception[] = [];
  for (const x of v) { const r = lireRegle(x); if (r && !vues.has(r.cle)) { vues.add(r.cle); res.push(r); } }
  return res;
}

export function lireMetriques(v: unknown): MetriquesModele | null {
  if (!estObj(v)) return null;
  const champs = ['emprise_m2', 'sdp_m2', 'shab_m2', 'niveaux', 'hauteur_m', 'pleine_terre_m2'] as const;
  for (const c of champs) if (!positif(v[c])) return null;
  // Nombre de logements : positif, ou null / absent (inconnu). Toute autre valeur invalide le message.
  const nbBrut = v.nb_logements;
  if (nbBrut !== null && nbBrut !== undefined && !positif(nbBrut)) return null;
  const precision = v.precision === 'plan_fourni' || v.precision === 'dessin' || v.precision === 'auto' ? v.precision : null;
  if (!precision) return null;
  const typo = estObj(v.typologies) ? v.typologies : {};
  const typologies = Object.fromEntries(TYPOLOGIES.map((t) => [t, positif(typo[t]) ? Math.round(typo[t] as number) : 0])) as Record<Typologie, number>;
  return {
    emprise_m2: v.emprise_m2 as number, sdp_m2: v.sdp_m2 as number, shab_m2: v.shab_m2 as number,
    nb_logements: positif(nbBrut) ? Math.round(nbBrut) : null, typologies,
    niveaux: Math.round(v.niveaux as number), hauteur_m: v.hauteur_m as number, pleine_terre_m2: v.pleine_terre_m2 as number,
    places_stationnement: positif(v.places_stationnement) ? Math.round(v.places_stationnement) : null,
    precision,
  };
}

export function lireControles(v: unknown): ControleRegle[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): ControleRegle[] => {
    if (!estObj(x) || typeof x.cle !== 'string' || !(REGLES_CLES as readonly string[]).includes(x.cle)) return [];
    const ok = x.ok === true ? true : x.ok === false ? false : null;
    const limite = fini(x.limite) ? x.limite : chaine(x.limite, 120);
    const c: ControleRegle = { cle: x.cle as RegleCle, valeur_modele: fini(x.valeur_modele) ? x.valeur_modele : null, limite, ok: limite === null ? null : ok };
    const ecart = chaine(x.ecart, 300); if (ecart) c.ecart = ecart;
    return [c];
  });
}

// ── Messages front ↔ studio (postMessage, même origine /studio/) ─────────────
//
// Enveloppe « à côté » du protocole mimmoza-echange-v2 (transportStudio) :
// même session (sessionId de la poignée de main), même filtrage d'origine.
//   front  → studio : conception.ouvrir
//   studio → front  : conception.pret (le Studio sait faire de la conception),
//                     conception.metriques (à chaque modification, ~1/s au plus),
//                     conception.enregistrer (bouton « Enregistrer cette version »)
//   front  → studio : conception.demander_enregistrement (bouton « Enregistrer cette
//                     version » du bilan : le Studio répond par conception.enregistrer)
//   front  → studio : conception.enregistre (accusé : version n enregistrée, ou erreur)
// Compatibilité : un lecteur accepte toute version ≤ VERSION_CONCEPTION et ignore
// les champs inconnus ; une version supérieure est refusée avec une raison claire.

export const TYPE_MESSAGE_CONCEPTION = 'mimmoza-conception' as const;
export const VERSION_CONCEPTION = 1 as const;

export type CanalConception =
  | 'conception.ouvrir' | 'conception.pret' | 'conception.metriques' | 'conception.enregistrer' | 'conception.enregistre'
  | 'conception.demander_enregistrement';

export interface ChargeOuvrir {
  conception_id: string;
  parcelle: ParcelleConception;
  regles: RegleConception[];
  programme: ProgrammeConception | null;
  plan_source: PrecisionPlan;
  /** URL signée du plan fourni (bucket agent-conception), si `plan_fourni`. */
  plan_url?: string;
  /** URL signée d'un modèle déjà enregistré, pour reprendre une version. */
  modele_url?: string;
}

export interface ChargeMetriques {
  conception_id: string;
  /** Compteur local au Studio, croissant à chaque modification. */
  version_locale: number;
  metriques: MetriquesModele;
  conformite: ControleRegle[];
  resume: string;
}

export interface ChargeEnregistrer extends ChargeMetriques {
  /** Projet Studio sérialisé (objet JSON), stocké tel quel dans le bucket. */
  modele: Record<string, unknown>;
  origine: 'generation' | 'modification_clic' | 'modification_texte' | 'plan_relu';
}

export interface ChargeEnregistre {
  conception_id: string;
  version_locale: number;
  ok: boolean;
  /** Numéro de version en base (agent_conception_versions.n) si ok. */
  n?: number;
  erreur?: string;
}

export interface ChargePret { capacites: Array<'plan_fourni' | 'dessin' | 'auto'> }

export interface ChargeDemanderEnregistrement {
  conception_id: string;
  /** Résumé proposé par l'utilisateur (facultatif), repris dans `conception.enregistrer`. */
  resume?: string;
}

export type MessageConception =
  | { type: typeof TYPE_MESSAGE_CONCEPTION; version: number; sessionId: string; canal: 'conception.ouvrir'; charge: ChargeOuvrir }
  | { type: typeof TYPE_MESSAGE_CONCEPTION; version: number; sessionId: string; canal: 'conception.pret'; charge: ChargePret }
  | { type: typeof TYPE_MESSAGE_CONCEPTION; version: number; sessionId: string; canal: 'conception.metriques'; charge: ChargeMetriques }
  | { type: typeof TYPE_MESSAGE_CONCEPTION; version: number; sessionId: string; canal: 'conception.enregistrer'; charge: ChargeEnregistrer }
  | { type: typeof TYPE_MESSAGE_CONCEPTION; version: number; sessionId: string; canal: 'conception.enregistre'; charge: ChargeEnregistre }
  | { type: typeof TYPE_MESSAGE_CONCEPTION; version: number; sessionId: string; canal: 'conception.demander_enregistrement'; charge: ChargeDemanderEnregistrement };

type ChargeDe<C extends CanalConception> = Extract<MessageConception, { canal: C }>['charge'];

export function creerMessageConception<C extends CanalConception>(canal: C, sessionId: string, charge: ChargeDe<C>): Extract<MessageConception, { canal: C }> {
  return { type: TYPE_MESSAGE_CONCEPTION, version: VERSION_CONCEPTION, sessionId, canal, charge } as Extract<MessageConception, { canal: C }>;
}

/** Taille maximale d'un modèle sérialisé accepté (caractères JSON). */
export const TAILLE_MAX_MODELE = 25_000_000;

export type LectureConception = { ok: true; message: MessageConception } | { ok: false; erreur: string };

const RE_SESSION = /^[A-Za-z0-9_-]{8,128}$/;
const RE_ID = /^[0-9a-fA-F-]{8,64}$/;

/** Valide la FORME d'un message conception (l'origine et la session se contrôlent à part, AVANT). */
export function lireMessageConception(data: unknown): LectureConception {
  if (!estObj(data) || data.type !== TYPE_MESSAGE_CONCEPTION) return { ok: false, erreur: 'pas un message conception' };
  if (!fini(data.version) || data.version < 1) return { ok: false, erreur: 'version invalide' };
  if (data.version > VERSION_CONCEPTION) return { ok: false, erreur: `version ${data.version} non prise en charge (max ${VERSION_CONCEPTION}) : mettre à jour` };
  if (typeof data.sessionId !== 'string' || !RE_SESSION.test(data.sessionId)) return { ok: false, erreur: 'session invalide' };
  const c = estObj(data.charge) ? data.charge : null;
  if (!c) return { ok: false, erreur: 'charge manquante' };
  const base = { type: TYPE_MESSAGE_CONCEPTION, version: data.version, sessionId: data.sessionId };
  const id = typeof c.conception_id === 'string' && RE_ID.test(c.conception_id) ? c.conception_id : null;
  switch (data.canal) {
    case 'conception.pret': {
      const caps = Array.isArray(c.capacites) ? c.capacites.filter((x): x is PrecisionPlan => x === 'plan_fourni' || x === 'dessin' || x === 'auto') : [];
      return { ok: true, message: { ...base, canal: 'conception.pret', charge: { capacites: caps } } };
    }
    case 'conception.ouvrir': {
      if (!id) return { ok: false, erreur: 'conception_id invalide' };
      const p = estObj(c.parcelle) ? c.parcelle : null;
      const geo = p && estObj(p.geometrie) && (p.geometrie.type === 'Polygon' || p.geometrie.type === 'MultiPolygon') && Array.isArray(p.geometrie.coordinates) ? p.geometrie : null;
      const idu = p ? chaine(p.idu, 40) : null;
      if (!p || !geo || !idu) return { ok: false, erreur: 'parcelle invalide' };
      const plan = c.plan_source === 'plan_fourni' || c.plan_source === 'dessin' || c.plan_source === 'auto' ? c.plan_source : null;
      if (!plan) return { ok: false, erreur: 'voie du plan invalide' };
      const charge: ChargeOuvrir = {
        conception_id: id,
        parcelle: { idu, geometrie: geo as unknown as ParcelleConception['geometrie'], surface_m2: positif(p.surface_m2) ? p.surface_m2 : null, source: chaine(p.source, 200) ?? 'non précisée' },
        regles: lireRegles(c.regles),
        programme: lireProgramme(c.programme),
        plan_source: plan,
      };
      const planUrl = urlSure(c.plan_url); if (planUrl) charge.plan_url = planUrl;
      const modeleUrl = urlSure(c.modele_url); if (modeleUrl) charge.modele_url = modeleUrl;
      return { ok: true, message: { ...base, canal: 'conception.ouvrir', charge } };
    }
    case 'conception.metriques':
    case 'conception.enregistrer': {
      if (!id) return { ok: false, erreur: 'conception_id invalide' };
      const metriques = lireMetriques(c.metriques);
      if (!metriques) return { ok: false, erreur: 'métriques invalides' };
      if (!fini(c.version_locale) || c.version_locale < 0) return { ok: false, erreur: 'version_locale invalide' };
      const m: ChargeMetriques = { conception_id: id, version_locale: Math.round(c.version_locale), metriques, conformite: lireControles(c.conformite), resume: chaine(c.resume, 1000) ?? '' };
      if (data.canal === 'conception.metriques') return { ok: true, message: { ...base, canal: 'conception.metriques', charge: m } };
      if (!estObj(c.modele)) return { ok: false, erreur: 'modèle manquant' };
      const origine = c.origine === 'generation' || c.origine === 'modification_clic' || c.origine === 'modification_texte' || c.origine === 'plan_relu' ? c.origine : 'modification_clic';
      return { ok: true, message: { ...base, canal: 'conception.enregistrer', charge: { ...m, modele: c.modele, origine } } };
    }
    case 'conception.demander_enregistrement': {
      if (!id) return { ok: false, erreur: 'conception_id invalide' };
      const charge: ChargeDemanderEnregistrement = { conception_id: id };
      const resume = chaine(c.resume, 500); if (resume) charge.resume = resume;
      return { ok: true, message: { ...base, canal: 'conception.demander_enregistrement', charge } };
    }
    case 'conception.enregistre': {
      if (!id || !fini(c.version_locale)) return { ok: false, erreur: 'accusé invalide' };
      const charge: ChargeEnregistre = { conception_id: id, version_locale: Math.round(c.version_locale), ok: c.ok === true };
      if (fini(c.n)) charge.n = Math.round(c.n);
      const e = chaine(c.erreur, 300); if (e) charge.erreur = e;
      return { ok: true, message: { ...base, canal: 'conception.enregistre', charge } };
    }
    default:
      return { ok: false, erreur: `canal « ${String(data.canal)} » inconnu` };
  }
}

export function lireProgramme(v: unknown): ProgrammeConception | null {
  if (!estObj(v)) return null;
  const typo = estObj(v.typologies) ? v.typologies : {};
  const typologies: Partial<Record<Typologie, number>> = {};
  for (const t of TYPOLOGIES) if (positif(typo[t])) typologies[t] = Math.round(typo[t] as number);
  const n = (x: unknown) => (positif(x) ? x : null);
  return { nb_logements: n(v.nb_logements), typologies, shab_cible_m2: n(v.shab_cible_m2), sdp_cible_m2: n(v.sdp_cible_m2), gabarit: chaine(v.gabarit, 40), stationnement: n(v.stationnement) };
}

/** Seules les URL signées du stockage Supabase du projet sont acceptées (comme côté Studio). */
export const PREFIXE_URL_SIGNEE = 'https://fwvrqngbafqdaekbdfnm.supabase.co/storage/v1/object/sign/';

function urlSure(v: unknown): string | null {
  const s = chaine(v, 4000);
  if (!s || !s.startsWith(PREFIXE_URL_SIGNEE)) return null;
  try {
    const u = new URL(s);
    return u.origin + '/' === new URL(PREFIXE_URL_SIGNEE).origin + '/' && u.pathname.startsWith('/storage/v1/object/sign/') && !u.pathname.includes('..') ? s : null;
  } catch { return null; }
}

// ── Question structurée des règles (moteur ↔ front, via la mission) ──────────
//
// Le moteur pose la question en écrivant dans `agent_missions.question_en_attente`
// la chaîne JSON d'une `QuestionReglesConception` (type 'regles_conception').
// Le front affiche un formulaire et répond avec `agent_mission_repondre(p_id,
// p_reponse)` où p_reponse = JSON d'une `ReponseReglesConception` (≤ 4 000
// caractères : pas de champ `texte` dans la réponse). Une question qui n'est pas
// ce JSON reste une question en texte libre (comportement actuel).

export const TYPE_QUESTION_REGLES = 'regles_conception' as const;
export const TYPE_REPONSE_REGLES = 'reponse_regles_conception' as const;

export interface QuestionReglesConception {
  type: typeof TYPE_QUESTION_REGLES;
  version: 1;
  /** Phrase affichée en tête du formulaire. */
  message: string;
  idu: string;
  conception_id?: string;
  /** Règles clés pré-remplies (statut estime/confirme) ou manquantes. */
  regles: RegleConception[];
  /** Chemin bucket attendu pour un règlement déposé : `<user_id>/<conception_id>/reglement-*.pdf`. */
  dossier_reglement?: string;
}

export interface ReponseReglesConception {
  type: typeof TYPE_REPONSE_REGLES;
  version: 1;
  /** Une entrée par règle de la question : valeur confirmée par l'utilisateur (statut confirme, source « utilisateur ») ou inconnue (manquant). */
  regles: Array<Pick<RegleConception, 'cle' | 'valeur' | 'unite' | 'statut' | 'source'> & { article?: string }>;
  /** Chemin du règlement déposé dans le bucket agent-conception, s'il y en a un. */
  reglement?: string;
  /** L'utilisateur demande que l'agent lise le règlement déposé (lecture comptée en jetons). */
  lire_reglement: boolean;
  commentaire?: string;
}

/** Lit `question_en_attente` : une question structurée de règles, ou null (question texte). */
export function lireQuestionRegles(question: string | null | undefined): QuestionReglesConception | null {
  if (!question || !question.trim().startsWith('{')) return null;
  let o: unknown;
  try { o = JSON.parse(question); } catch { return null; }
  if (!estObj(o) || o.type !== TYPE_QUESTION_REGLES) return null;
  const idu = chaine(o.idu, 40);
  if (!idu) return null;
  // Toutes les règles clés apparaissent dans le formulaire, même celles que le moteur n'a pas citées.
  const lues = lireRegles(o.regles);
  const regles = REGLES_CLES.map((cle) => lues.find((r) => r.cle === cle)
    ?? { cle, valeur: null, unite: LIBELLE_REGLE[cle].unite, statut: 'manquant' as const, source: 'non trouvée' });
  const q: QuestionReglesConception = { type: TYPE_QUESTION_REGLES, version: 1, message: chaine(o.message, 1000) ?? 'Merci de vérifier les règles du PLU de la parcelle.', idu, regles };
  const cid = typeof o.conception_id === 'string' && RE_ID.test(o.conception_id) ? o.conception_id : null; if (cid) q.conception_id = cid;
  const dossier = chaine(o.dossier_reglement, 300); if (dossier) q.dossier_reglement = dossier;
  return q;
}

export const TAILLE_MAX_REPONSE = 4000;

/** Construit la réponse JSON (chaîne ≤ 4 000 caractères) envoyée par agent_mission_repondre. */
export function construireReponseRegles(
  saisies: Array<{ cle: RegleCle; valeur: number | string | null; unite: string; article?: string }>,
  options: { reglement?: string | null; lire_reglement?: boolean; commentaire?: string | null } = {},
): string {
  const rep: ReponseReglesConception = {
    type: TYPE_REPONSE_REGLES,
    version: 1,
    regles: saisies.map((s) => {
      const vide = s.valeur === null || (typeof s.valeur === 'string' && !s.valeur.trim());
      return {
        cle: s.cle,
        valeur: vide ? null : s.valeur,
        unite: s.unite,
        statut: vide ? 'manquant' : 'confirme',
        source: 'utilisateur',
        ...(s.article && s.article.trim() ? { article: s.article.trim().slice(0, 60) } : {}),
      };
    }),
    lire_reglement: Boolean(options.lire_reglement && options.reglement),
    ...(options.reglement ? { reglement: options.reglement } : {}),
    ...(options.commentaire && options.commentaire.trim() ? { commentaire: options.commentaire.trim().slice(0, 500) } : {}),
  };
  let json = JSON.stringify(rep);
  if (json.length > TAILLE_MAX_REPONSE && rep.commentaire) { delete rep.commentaire; json = JSON.stringify(rep); }
  if (json.length > TAILLE_MAX_REPONSE) throw new Error('Réponse trop longue (4 000 caractères au plus).');
  return json;
}

// ── Suite proposée par une prospection (rapport.suite_proposee) ──────────────

export interface SuiteProposee {
  type: 'conception';
  terrains: Array<{ idu: string; rang: number; raison: string }>;
  texte: string;
}

export function lireSuiteProposee(v: unknown): SuiteProposee | null {
  if (!estObj(v) || v.type !== 'conception' || !Array.isArray(v.terrains)) return null;
  const terrains = v.terrains.flatMap((t, i) => {
    if (!estObj(t)) return [];
    const idu = chaine(t.idu, 40);
    return idu ? [{ idu, rang: fini(t.rang) ? Math.round(t.rang) : i + 1, raison: chaine(t.raison, 500) ?? '' }] : [];
  }).sort((a, b) => a.rang - b.rang);
  if (!terrains.length) return null;
  return { type: 'conception', terrains, texte: chaine(v.texte, 1500) ?? 'Concevoir le projet sur un terrain retenu.' };
}
