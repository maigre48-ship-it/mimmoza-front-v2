// src/spaces/copilot/agent/rapport/rapportModele.ts
// =============================================================================
// Modèle de présentation d'un rapport de mission (écran + exports PDF, Word,
// Excel, bilan Excel). Lit le rapport v2 (CONTRAT_RAPPORT_ET_BILAN.md, §A)
// et reste compatible v1 : ce qui manque est laissé vide (null), jamais 0.
//
// PUR : aucune dépendance navigateur, testé par rapportExport.test.ts.
// =============================================================================

export type Nombre = number | null;

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const nombre = (v: unknown): Nombre => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[\s  ]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const textes = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? lisible(x) : '')).filter(Boolean) : [];

// ── Texte lisible ────────────────────────────────────────────────────────────

const SIGLES: Record<string, string> = {
  dvf: 'DVF', gpu: 'GPU', plu: 'PLU', plui: 'PLUi', sru: 'SRU', dpu: 'DPU', oap: 'OAP', pprn: 'PPRN',
  ppri: 'PPRI', ppr: 'PPR', insee: 'INSEE', ign: 'IGN', sdp: 'SDP', shab: 'SHAB', lls: 'LLS', vrd: 'VRD',
  dgfip: 'DGFiP', siren: 'SIREN', oph: 'OPH', bt01: 'BT01', ht: 'HT', ttc: 'TTC',
};
/** Remet en capitales les sigles écrits en minuscules (« dvf » → « DVF ») et resserre les espaces. */
export function lisible(s: string): string {
  return s.replace(/\b([a-z][a-z0-9]{1,5})\b/g, (m) => SIGLES[m] ?? m).replace(/[ \t]{2,}/g, ' ').trim();
}

// ── Formats ──────────────────────────────────────────────────────────────────

/** Groupe les milliers avec une espace simple (compatible PDF, Word, écran). */
export function grouper(n: number, decimales = 0): string {
  const signe = n < 0 ? '-' : '';
  const [ent, dec] = Math.abs(n).toFixed(decimales).split('.');
  const g = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return signe + g + (dec ? ',' + dec : '');
}
export const fEur = (n: Nombre): string => (n == null ? '—' : `${grouper(n)} €`);
export const fM2 = (n: Nombre): string => (n == null ? '—' : `${grouper(n)} m²`);
export const fEurM2 = (n: Nombre): string => (n == null ? '—' : `${grouper(n)} €/m²`);
export const fPct = (fraction: Nombre): string => (fraction == null ? '—' : `${grouper(fraction * 100, Number.isInteger(Math.round(fraction * 1000) / 10) ? 0 : 1)} %`);
export const fNb = (n: Nombre): string => (n == null ? '—' : grouper(n));

/** Les champs `*_pct` du rapport sont en POURCENT (8 = 8 %) : on les ramène en fraction (0,08) pour Excel. */
export function pctVersFraction(v: Nombre): Nombre {
  return v == null ? null : v / 100;
}

// ── Hypothèses du bilan ──────────────────────────────────────────────────────

export type CleHypothese =
  | 'nb_logements' | 'shab_m2' | 'sdp_m2'
  | 'prix_vente_libre_eur_m2_shab' | 'part_lls_pct' | 'prix_cession_lls_eur_m2_shab'
  | 'cout_travaux_eur_m2_sdp' | 'honoraires_pct_travaux' | 'aleas_pct_travaux'
  | 'demolition_eur' | 'vrd_eur' | 'taxes_urbanisme_eur'
  | 'commercialisation_pct_ca' | 'frais_financiers_pct_ca' | 'frais_acquisition_pct_foncier'
  | 'marge_cible_pct_ca';

export type UniteHypothese = 'nb' | 'm2' | 'eur_m2' | 'pct' | 'eur';

/**
 * Rôle d'une hypothèse dans le calcul (aligné sur calculerChargeFonciere du moteur) :
 *  · essentielle : vide → pas de charge foncière ;
 *  · secondaire  : vide → comptée à 0 ET signalée « non chiffré » (part sociale, taxes, VRD, démolition) ;
 *  · conditionnelle : prix de cession LLS, nécessaire seulement si la part sociale est > 0 ;
 *  · info : sans effet sur le calcul.
 */
export type RoleHypothese = 'essentielle' | 'secondaire' | 'conditionnelle' | 'info';

export interface DefinitionHypothese {
  cle: CleHypothese;
  libelle: string;
  unite: UniteHypothese;
  role: RoleHypothese;
  /** Doit être renseignée pour un bilan complet (tout sauf « info »). */
  requise: boolean;
}

/** Ordre d'affichage ET ordre des lignes de l'onglet Excel « Hypothèses ». */
const def = (cle: CleHypothese, libelle: string, unite: UniteHypothese, role: RoleHypothese): DefinitionHypothese =>
  ({ cle, libelle, unite, role, requise: role === 'essentielle' || role === 'secondaire' });

/** Ordre d'affichage ET ordre des lignes de l'onglet Excel « Hypothèses ». */
export const DEFINITIONS_HYPOTHESES: readonly DefinitionHypothese[] = [
  def('nb_logements', 'Nombre de logements', 'nb', 'info'),
  def('shab_m2', 'Surface habitable vendable (SHAB)', 'm2', 'essentielle'),
  def('sdp_m2', 'Surface de plancher construite (SDP)', 'm2', 'essentielle'),
  def('prix_vente_libre_eur_m2_shab', 'Prix de vente libre (par m² SHAB)', 'eur_m2', 'essentielle'),
  def('part_lls_pct', 'Part de logements sociaux (LLS)', 'pct', 'secondaire'),
  def('prix_cession_lls_eur_m2_shab', 'Prix de cession des logements sociaux (par m² SHAB)', 'eur_m2', 'conditionnelle'),
  def('cout_travaux_eur_m2_sdp', 'Coût des travaux (par m² SDP)', 'eur_m2', 'essentielle'),
  def('honoraires_pct_travaux', 'Honoraires (en % des travaux)', 'pct', 'essentielle'),
  def('aleas_pct_travaux', 'Aléas (en % des travaux)', 'pct', 'essentielle'),
  def('demolition_eur', 'Démolition', 'eur', 'secondaire'),
  def('vrd_eur', 'Voirie et réseaux (VRD)', 'eur', 'secondaire'),
  def('taxes_urbanisme_eur', 'Taxes d’urbanisme (TA, RAP…)', 'eur', 'secondaire'),
  def('commercialisation_pct_ca', 'Commercialisation (en % du CA)', 'pct', 'essentielle'),
  def('frais_financiers_pct_ca', 'Frais financiers (en % du CA)', 'pct', 'essentielle'),
  def('frais_acquisition_pct_foncier', 'Frais d’acquisition (en % du foncier)', 'pct', 'essentielle'),
  def('marge_cible_pct_ca', 'Marge cible (en % du CA)', 'pct', 'essentielle'),
];

export const LIBELLE_UNITE: Record<UniteHypothese, string> = { nb: 'nb', m2: 'm²', eur_m2: '€/m²', pct: '%', eur: '€ HT' };

export interface ValeurHypothese { valeur: Nombre; source: string | null }
export type JeuHypotheses = Record<CleHypothese, ValeurHypothese>;

const vide = (): JeuHypotheses =>
  Object.fromEntries(DEFINITIONS_HYPOTHESES.map((d) => [d.cle, { valeur: null, source: null }])) as unknown as JeuHypotheses;

export function formatHypothese(def: DefinitionHypothese, v: Nombre): string {
  if (v == null) return 'à renseigner';
  switch (def.unite) {
    case 'pct': return fPct(v);
    case 'm2': return fM2(v);
    case 'eur_m2': return fEurM2(v);
    case 'eur': return fEur(v);
    default: return fNb(v);
  }
}

/** Lit un objet d'hypothèses v2 (communes ou spécifiques). Les clés absentes restent `null`. */
function lireHypotheses(o: unknown, sourceParDefaut: string | null): { jeu: Partial<JeuHypotheses>; gabarit: string | null } {
  if (!estObj(o)) return { jeu: {}, gabarit: null };
  const prog = estObj(o.programme) ? o.programme : {};
  const brut: Partial<Record<CleHypothese, unknown>> = {
    nb_logements: 'nb_logements' in prog ? prog.nb_logements : o.nb_logements,
    shab_m2: 'shab_m2' in prog ? prog.shab_m2 : o.shab_m2,
    sdp_m2: 'sdp_m2' in prog ? prog.sdp_m2 : o.sdp_m2,
  };
  for (const d of DEFINITIONS_HYPOTHESES) if (!(d.cle in brut) && d.cle in o) brut[d.cle] = o[d.cle];
  const jeu: Partial<JeuHypotheses> = {};
  for (const d of DEFINITIONS_HYPOTHESES) {
    if (!(d.cle in brut) || brut[d.cle] === undefined) continue;
    let v = nombre(brut[d.cle]);
    if (v != null && d.unite === 'pct') v = pctVersFraction(v);
    const source = d.cle === 'prix_vente_libre_eur_m2_shab' ? texte(o.source_prix) ?? sourceParDefaut
      : d.cle === 'cout_travaux_eur_m2_sdp' ? texte(o.source_couts) ?? sourceParDefaut
      : sourceParDefaut;
    jeu[d.cle] = { valeur: v, source: v == null ? null : source };
  }
  return { jeu, gabarit: texte(prog.gabarit) ?? texte(o.gabarit) };
}

const SOURCE_V1 = 'Texte du rapport (version 1, non structuré) — à vérifier';
const nb = (s: string) => nombre(s.replace(/[\s  ]/g, ''));

/**
 * Rapport v1 : les hypothèses ne figurent que dans le texte de synthèse. On ne
 * reprend que des tournures sans ambiguïté, chacune marquée « à vérifier ».
 */
export function extraireHypothesesV1(synthese: string): Partial<JeuHypotheses> {
  const s = synthese.replace(/[  ]/g, ' ');
  const jeu: Partial<JeuHypotheses> = {};
  const prendre = (cle: CleHypothese, re: RegExp, transf = (n: number) => n) => {
    const m = re.exec(s);
    const v = m ? nb(m[1]) : null;
    if (v != null && v > 0) jeu[cle] = { valeur: transf(v), source: SOURCE_V1 };
  };
  prendre('prix_vente_libre_eur_m2_shab', /m[ée]diane\s+(?:DVF\s+)?(?:de\s+|à\s+)?(\d[\d ]*\d|\d)\s*€\s*\/\s*m²/i);
  prendre('cout_travaux_eur_m2_sdp', /(\d[\d ]*\d|\d)\s*€\s*\/\s*m²\s*SDP/i);
  prendre('shab_m2', /(\d[\d ]*\d|\d)\s*m²\s*SHAB/i);
  prendre('sdp_m2', /(\d[\d ]*\d|\d)\s*m²\s*SDP/i);
  prendre('marge_cible_pct_ca', /marge\s+cible\s+(?:de\s+)?(\d+(?:[,.]\d+)?)\s*%/i, (n) => n / 100);
  return jeu;
}

// ── Terrains ─────────────────────────────────────────────────────────────────

export const LIBELLE_VERDICT: Record<string, string> = {
  prioritaire: 'Prioritaire', retenu: 'Retenu', favorable: 'Favorable', a_etudier: 'À étudier',
  a_creuser: 'À creuser', a_verifier: 'À vérifier', reserve: 'Avec réserves', defavorable: 'Défavorable',
  ecarte: 'Écarté', a_eviter: 'À éviter', indeterminable: 'Indéterminable',
};
export function libelleVerdict(v: string | null): string | null {
  if (!v) return null;
  const cle = v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s-]+/g, '_');
  if (LIBELLE_VERDICT[cle]) return LIBELLE_VERDICT[cle];
  if (/^[a-z_]+$/.test(v.trim())) { const t = v.trim().replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); }
  return lisible(v);
}
export type TonVerdict = 'bon' | 'moyen' | 'mauvais' | 'neutre';
export function tonDuVerdict(libelle: string | null): TonVerdict {
  const v = (libelle ?? '').toLowerCase();
  if (!v) return 'neutre';
  if (/(écart|bloqu|défavorable|éviter|rejet)/.test(v)) return 'mauvais';
  if (/(étudier|creuser|vérifier|réserve|indéterminable|possible)/.test(v)) return 'moyen';
  if (/(prioritaire|retenu|favorable)/.test(v)) return 'bon';
  return 'neutre';
}

export const LIBELLE_CONTRAINTE: Record<string, string> = {
  mixite_sociale: 'Mixité sociale', ppr: 'Plan de prévention des risques', argiles: 'Argiles (retrait-gonflement)',
  bruit: 'Bruit', dpu: 'Droit de préemption', oap: 'OAP', servitude: 'Servitude', autre: 'Autre',
};

export interface Proprietaire { nom: string; forme: string | null; siren: string | null; source: string | null; deduit: boolean }
export interface Contrainte { type: string; libelle: string; source: string | null }

export interface BilanTerrain {
  ca_ht: Nombre; couts_hors_foncier_ht: Nombre; charge_fonciere_admissible_ht: Nombre;
  charge_fonciere_eur_m2_terrain: Nombre; charge_fonciere_eur_m2_sdp: Nombre; marge_cible_pct_ca: Nombre;
  statut: 'complet' | 'partiel' | null; manques: string[]; source: string | null;
  /** Détail des postes calculés par le moteur (€ HT), quand il est fourni. */
  detail: Record<string, Nombre>;
  /** Pourquoi les hypothèses de ce terrain diffèrent des hypothèses communes. */
  justification: string | null;
}

export interface TerrainModele {
  rang: number;
  idu: string;
  commune: string | null;
  adresse: string | null;
  surface_m2: Nombre;
  zonageCode: string | null;
  zonageLibelle: string | null;
  verdict: string | null;
  ton: TonVerdict;
  score: Nombre;
  potentiel_logements: Nombre;
  proprietaire: Proprietaire | null;
  contraintes: Contrainte[];
  points_forts: string[];
  points_bloquants: string[];
  sources: string[];
  charge_fonciere: Nombre;
  /** Charge foncière / m² de terrain ; `cfM2Calculee` = déduite ici (charge ÷ surface). */
  charge_fonciere_m2: Nombre;
  cfM2Calculee: boolean;
  bilan: BilanTerrain | null;
  hypothesesSpecifiques: Partial<JeuHypotheses>;
}

/** « UC91D19 — Zone de Centralité (PLUi Est E… » → code + libellé. */
export function separerZonage(z: string | null, libelleZone: string | null): { code: string | null; libelle: string | null } {
  if (!z) return { code: null, libelle: libelleZone };
  const [code, ...reste] = z.split(/\s+[—–-]\s+/);
  const lib = libelleZone ?? (reste.join(' — ').replace(/\s*…$/, '…') || null);
  return { code: code.trim() || null, libelle: lib };
}

/** v1 : le propriétaire n'existe que dans les points forts/bloquants. */
function proprietaireDepuisPoints(points: string[]): Proprietaire | null {
  const p = points.find((x) => /propri[ée]taire/i.test(x));
  if (!p) return null;
  const apres = p.includes(':') ? p.slice(p.indexOf(':') + 1) : p;
  const nom = apres.split(/\s+[—–]\s+/)[0].trim();
  if (/non identifi/i.test(p)) return { nom: `Non identifié${nom ? ` (${nom})` : ''}`, forme: null, siren: null, source: 'Texte du rapport', deduit: true };
  return nom ? { nom, forme: null, siren: null, source: 'Texte du rapport', deduit: true } : null;
}

function lireProprietaire(v: unknown): Proprietaire | null {
  if (!estObj(v)) return null;
  const nom = texte(v.nom);
  if (!nom) return null;
  return { nom, forme: texte(v.forme), siren: texte(v.siren), source: texte(v.source), deduit: false };
}

function lireBilan(v: unknown): BilanTerrain | null {
  if (!estObj(v)) return null;
  const statut = v.statut === 'complet' || v.statut === 'partiel' ? v.statut : null;
  const detail: Record<string, Nombre> = {};
  if (estObj(v.detail)) for (const [k, x] of Object.entries(v.detail)) detail[k] = nombre(x);
  const spec = estObj(v.hypotheses_specifiques) ? v.hypotheses_specifiques : {};
  return {
    ca_ht: nombre(v.ca_ht),
    couts_hors_foncier_ht: nombre(v.couts_hors_foncier_ht),
    charge_fonciere_admissible_ht: nombre(v.charge_fonciere_admissible_ht),
    charge_fonciere_eur_m2_terrain: nombre(v.charge_fonciere_eur_m2_terrain),
    charge_fonciere_eur_m2_sdp: nombre(v.charge_fonciere_eur_m2_sdp),
    marge_cible_pct_ca: pctVersFraction(nombre(v.marge_cible_pct_ca)),
    statut,
    manques: textes(v.manques),
    source: texte(v.source),
    detail,
    justification: texte(spec.justification) ?? texte(v.justification),
  };
}

// ── Modèle complet ───────────────────────────────────────────────────────────

export interface Contact { qualite: string; nom: string; telephone: string | null; email: string | null; adresse: string | null; source: string | null }
export interface LigneClassement { rang: number; idu: string; libelle: string; justification: string | null }

export interface ModeleRapport {
  version: 1 | 2;
  titre: string;
  objectif: string;
  typeMission: string;
  dateIso: string;
  dateAffichee: string;
  commune: string | null;
  synthese: string[];
  classement: LigneClassement[];
  terrains: TerrainModele[];
  hypotheses: JeuHypotheses;
  gabarit: string | null;
  hypothesesDepuisTexte: boolean;
  contacts: Contact[];
  sources: string[];
  limites: string[];
  jetons: Nombre;
  /** Message honnête quand tous les terrains ont la même charge foncière. */
  noteBilanIdentique: string | null;
  avertissement: string;
}

export const AVERTISSEMENT =
  'Étude indicative produite par MimmozIA à partir de données publiques. Elle ne constitue ni un conseil en investissement, '
  + 'ni une étude de faisabilité, ni une garantie de constructibilité. À faire valider par un professionnel (architecte, juriste, promoteur, notaire).';

export interface MissionPourRapport {
  objectif?: string | null;
  type?: string | null;
  cree_le?: string | null;
  termine_le?: string | null;
  criteres?: Record<string, unknown> | null;
}

function dateFr(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `${d.getUTCDate()} ${mois[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Découpe la synthèse en paragraphes de lecture (phrases regroupées par 3). */
function paragrapher(s: string): string[] {
  const blocs = s.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (blocs.length > 1) return blocs.map(lisible);
  const phrases = s.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map((p) => p.trim()).filter(Boolean) ?? [s];
  const res: string[] = [];
  for (let i = 0; i < phrases.length; i += 3) res.push(lisible(phrases.slice(i, i + 3).join(' ')));
  return res;
}

export function construireModeleRapport(mission: MissionPourRapport, brut: unknown, maintenant = new Date()): ModeleRapport | null {
  let r: unknown = brut;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch { return null; } }
  if (!estObj(r)) return null;
  const version: 1 | 2 = Number(r.version) >= 2 ? 2 : 1;

  // Hypothèses communes
  const hypotheses = vide();
  const comm = lireHypotheses(r.hypotheses_communes, 'Hypothèses communes de la mission');
  Object.assign(hypotheses, comm.jeu);
  let hypothesesDepuisTexte = false;
  if (version === 1 || !estObj(r.hypotheses_communes)) {
    const extrait = extraireHypothesesV1(texte(r.synthese) ?? '');
    for (const [k, v] of Object.entries(extrait) as [CleHypothese, ValeurHypothese][]) {
      if (hypotheses[k].valeur == null) { hypotheses[k] = v; hypothesesDepuisTexte = true; }
    }
  }

  // Terrains
  const bruts = Array.isArray(r.terrains) ? r.terrains.filter(estObj) : [];
  const terrains: TerrainModele[] = bruts.map((t, i) => {
    const points_forts = textes(t.points_forts);
    const points_bloquants = textes(t.points_bloquants);
    const z = separerZonage(texte(t.zonage), texte(t.libelle_zone));
    const verdict = texte(t.verdict_libelle) ?? libelleVerdict(texte(t.verdict));
    const bilan = lireBilan(t.bilan);
    const surface = nombre(t.surface_m2);
    // Un bilan v2 présent fait foi, même vide (null = non calculable) ; sinon valeur v1.
    const cf = bilan ? bilan.charge_fonciere_admissible_ht : nombre(t.charge_fonciere_admissible);
    const cfM2Source = bilan?.charge_fonciere_eur_m2_terrain ?? null;
    const cfM2 = cfM2Source ?? (cf != null && surface ? Math.round(cf / surface) : null);
    const contraintes: Contrainte[] = Array.isArray(t.contraintes)
      ? t.contraintes.filter(estObj).flatMap((c) => {
          const libelle = texte(c.libelle);
          if (!libelle) return [];
          const type = texte(c.type) ?? 'autre';
          return [{ type: LIBELLE_CONTRAINTE[type] ?? lisible(type), libelle: lisible(libelle), source: texte(c.source) }];
        })
      : [];
    const spec = estObj(bilan) && estObj((t.bilan as Obj).hypotheses_specifiques)
      ? lireHypotheses((t.bilan as Obj).hypotheses_specifiques, bilan?.source ?? 'calculer_bilan_financier').jeu
      : {};
    return {
      rang: nombre(t.rang) ?? i + 1,
      idu: texte(t.idu) ?? '—',
      commune: texte(t.commune),
      adresse: texte(t.adresse),
      surface_m2: surface,
      zonageCode: z.code,
      zonageLibelle: z.libelle,
      verdict,
      ton: tonDuVerdict(verdict),
      score: nombre(t.score),
      potentiel_logements: nombre(t.potentiel_logements),
      proprietaire: lireProprietaire(t.proprietaire) ?? (t.proprietaire === undefined ? proprietaireDepuisPoints([...points_forts, ...points_bloquants]) : null),
      contraintes,
      points_forts,
      points_bloquants,
      sources: textes(t.sources),
      charge_fonciere: cf,
      charge_fonciere_m2: cfM2,
      cfM2Calculee: cfM2Source == null && cfM2 != null,
      bilan,
      hypothesesSpecifiques: spec,
    };
  }).sort((a, b) => a.rang - b.rang);

  // Nombre de logements : v1 → potentiel commun aux terrains, s'il est unique.
  if (hypotheses.nb_logements.valeur == null) {
    const pots = [...new Set(terrains.map((t) => t.potentiel_logements).filter((x): x is number => x != null))];
    if (pots.length === 1) hypotheses.nb_logements = { valeur: pots[0], source: 'Potentiel indiqué pour chaque terrain' };
  }

  const classement: LigneClassement[] = Array.isArray(r.classement) && r.classement.some(estObj)
    ? r.classement.filter(estObj).map((c, i) => {
        const idu = texte(c.idu) ?? '—';
        const t = terrains.find((x) => x.idu === idu);
        return { rang: nombre(c.rang) ?? i + 1, idu, libelle: t?.adresse ?? t?.zonageCode ?? '', justification: texte(c.justification) ? lisible(texte(c.justification)!) : null };
      }).sort((a, b) => a.rang - b.rang)
    : terrains.map((t) => ({ rang: t.rang, idu: t.idu, libelle: t.adresse ?? t.zonageCode ?? '', justification: t.verdict }));

  const contacts: Contact[] = Array.isArray(r.contacts)
    ? r.contacts.filter(estObj).flatMap((c) => {
        const nom = texte(c.nom);
        if (!nom) return [];
        return [{ qualite: texte(c.qualite) ?? 'autre', nom, telephone: texte(c.telephone), email: texte(c.email), adresse: texte(c.adresse), source: texte(c.source) }];
      })
    : [];

  const sources = [...new Set([
    ...terrains.flatMap((t) => t.sources),
    ...Object.values(hypotheses).map((h) => h.source).filter((s): s is string => !!s),
  ])];

  const cfs = terrains.map((t) => t.charge_fonciere);
  const noteBilanIdentique = terrains.length > 1 && cfs.every((c) => c != null && c === cfs[0])
    ? 'Même charge foncière pour tous les terrains : le bilan n’a tenu compte que du programme commun, pas des contraintes propres à chaque terrain (logements sociaux imposés, démolition, fondations…). À affiner terrain par terrain dans le bilan Excel.'
    : null;

  const dateIso = mission.termine_le ?? mission.cree_le ?? maintenant.toISOString();
  const crit = mission.criteres ?? {};
  const communeCrit = Array.isArray(crit.communes) ? texte(crit.communes[0]) : null;

  return {
    version,
    titre: lisible(texte(r.titre) ?? 'Rapport de mission'),
    objectif: lisible(texte(mission.objectif) ?? ''),
    typeMission: texte(mission.type) ?? 'libre',
    dateIso,
    dateAffichee: dateFr(dateIso),
    commune: terrains.find((t) => t.commune)?.commune ?? communeCrit,
    synthese: texte(r.synthese) ? paragrapher(texte(r.synthese)!) : [],
    classement,
    terrains,
    hypotheses,
    gabarit: comm.gabarit,
    hypothesesDepuisTexte,
    contacts,
    sources,
    limites: textes(r.limites),
    jetons: nombre(r.jetons_consommes),
    noteBilanIdentique,
    avertissement: AVERTISSEMENT,
  };
}

/** Hypothèses effectives d'un terrain : communes, remplacées par ses valeurs propres. */
/**
 * Hypothèses effectives d'un terrain : communes, remplacées par ses valeurs
 * propres. Comme le moteur, une valeur propre à `null` signifie « inconnue
 * pour ce terrain » et remplace la valeur commune.
 */
export function hypothesesTerrain(m: Pick<ModeleRapport, 'hypotheses'>, t: Pick<TerrainModele, 'hypothesesSpecifiques'>): JeuHypotheses {
  return { ...m.hypotheses, ...Object.fromEntries(Object.entries(t.hypothesesSpecifiques).filter(([, v]) => v !== undefined)) } as JeuHypotheses;
}

// ── Noms de fichiers ─────────────────────────────────────────────────────────

const PREFIXE_TYPE: Record<string, string> = {
  prospection_fonciere: 'Prospection', faisabilite: 'Faisabilite', etude_marche: 'Etude-marche', veille: 'Veille',
};
export function segmentFichier(s: string | null, defaut: string): string {
  const t = (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return t || defaut;
}
export function nomFichierRapport(m: Pick<ModeleRapport, 'typeMission' | 'commune' | 'dateIso'>, ext: 'pdf' | 'docx' | 'xlsx', bilan = false): string {
  const prefixe = bilan ? 'Bilan' : PREFIXE_TYPE[m.typeMission] ?? 'Mission';
  const d = new Date(m.dateIso);
  const date = Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : 'sans-date';
  return `Mimmoza_${prefixe}_${segmentFichier(m.commune, 'Commune')}_${date}.${ext}`;
}
