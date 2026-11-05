// supabase/functions/copilot-chat/agent/rapport.ts
// =============================================================
// Rapport de mission v2 (CONTRAT_RAPPORT_ET_BILAN.md §A) — logique PURE.
//
// Pourquoi le rapport se construit maintenant PAR MORCEAUX
// --------------------------------------------------------
// Diagnostic de la 1re mission réelle (Montreuil, 7a7c855a…) : les tours 13 à
// 16 (« Réflexion » sans action, ~80 s et 4-5 jetons chacun) étaient des appels
// `terminer_mission` portant TOUT le rapport en une fois. La sortie d'une étape
// est plafonnée à 4 096 tokens : l'appel était coupé (stop_reason max_tokens),
// le bloc tool_use incomplet était abandonné par le parseur, seul le texte
// d'intro restait, et le modèle recommençait. Le 4e essai, plus court, est passé.
// Un rapport v2 (bilans, contraintes, contacts…) serait encore plus gros.
// → Le modèle dépose les éléments au fil de l'eau (rapport_hypotheses,
//   calculer_charge_fonciere, rapport_terrain, rapport_contact) dans
//   `etat.brouillon` ; `terminer_mission` ne porte plus que titre, synthèse,
//   classement et limites ; le moteur assemble.
//
// Pourquoi un calcul de charge foncière dédié
// -------------------------------------------
// Les 3 `partial` de calculer_bilan_financier venaient du poste obligatoire
// `autres_couts_eur` non envoyé (l'outil exige ses 10 postes, et dit à raison
// qu'un poste absent ne vaut pas zéro). Plus profondément, cet outil ne calcule
// pas la charge foncière : le modèle la déduisait « de tête » du solde, avec un
// programme identique pour tous les terrains. `calculer_charge_fonciere` calcule
// ICI, de façon déterministe, avec EXACTEMENT la formule de l'onglet Bilan du
// classeur Excel (agent FRONT), terrain par terrain, et enregistre le résultat
// dans le rapport : aucun chiffre de bilan ne vient de la plume du modèle.
//
// Conventions (pour l'agent FRONT) :
//   · tous les champs `*_pct` sont en POURCENT (8 = 8 %) ;
//   · montants en euros HT ; inconnu = null (jamais 0) ;
//   · formule : CA libre = SHAB × (1 − LLS%) × prix libre ; CA LLS = SHAB × LLS% × prix LLS ;
//     travaux = SDP × coût/m² ; honoraires = hon% × travaux ; aléas = aléas% × travaux ;
//     commercialisation = com% × CA ; frais financiers = ff% × CA ;
//     coûts hors foncier = travaux + honoraires + aléas + démolition + VRD + taxes + commercialisation + frais financiers ;
//     charge foncière admissible = (CA × (1 − marge%) − coûts hors foncier) / (1 + frais d'acquisition%).
// =============================================================

const texte = (v: unknown, max: number): string => {
  const s = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
const nombre = (v: unknown, min = 0, max = 1e12): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
const chaine = (v: unknown, max = 300): string | null =>
  typeof v === 'string' && v.trim() ? texte(v.trim(), max) : null;
const liste = (v: unknown, max = 20, lg = 400): string[] =>
  Array.isArray(v) ? v.filter((x) => x != null && x !== '').map((x) => texte(x, lg)).slice(0, max) : [];
const arrondi = (v: number) => Math.round(v);

// ── Hypothèses ──────────────────────────────────────────────────────────────

export interface Programme {
  nb_logements: number | null;
  shab_m2: number | null;
  sdp_m2: number | null;
  gabarit: string | null;
}

export interface Hypotheses {
  programme: Programme;
  prix_vente_libre_eur_m2_shab: number | null;
  source_prix: string | null;
  part_lls_pct: number | null;
  prix_cession_lls_eur_m2_shab: number | null;
  cout_travaux_eur_m2_sdp: number | null;
  source_couts: string | null;
  honoraires_pct_travaux: number | null;
  aleas_pct_travaux: number | null;
  commercialisation_pct_ca: number | null;
  frais_financiers_pct_ca: number | null;
  frais_acquisition_pct_foncier: number | null;
  taxes_urbanisme_eur: number | null;
  vrd_eur: number | null;
  demolition_eur: number | null;
  marge_cible_pct_ca: number | null;
  /** Lot Q3 (optionnel) : provenance des hypothèses reprises d'une autre mission (prospection d'origine). */
  source_hypotheses?: string | null;
}

export const CLES_PCT = [
  'part_lls_pct', 'honoraires_pct_travaux', 'aleas_pct_travaux', 'commercialisation_pct_ca',
  'frais_financiers_pct_ca', 'frais_acquisition_pct_foncier', 'marge_cible_pct_ca',
] as const;
export const CLES_EUR_M2 = ['prix_vente_libre_eur_m2_shab', 'prix_cession_lls_eur_m2_shab', 'cout_travaux_eur_m2_sdp'] as const;
export const CLES_EUR = ['taxes_urbanisme_eur', 'vrd_eur', 'demolition_eur'] as const;
export const CLES_SOURCES = ['source_prix', 'source_couts'] as const;

export function hypothesesVides(): Hypotheses {
  return {
    programme: { nb_logements: null, shab_m2: null, sdp_m2: null, gabarit: null },
    prix_vente_libre_eur_m2_shab: null, source_prix: null,
    part_lls_pct: null, prix_cession_lls_eur_m2_shab: null,
    cout_travaux_eur_m2_sdp: null, source_couts: null,
    honoraires_pct_travaux: null, aleas_pct_travaux: null, commercialisation_pct_ca: null,
    frais_financiers_pct_ca: null, frais_acquisition_pct_foncier: null,
    taxes_urbanisme_eur: null, vrd_eur: null, demolition_eur: null,
    marge_cible_pct_ca: null,
  };
}

/**
 * Lit un objet d'hypothèses PARTIEL : seules les clés présentes et valides sont
 * renvoyées (une clé absente ≠ une clé à null ; null explicite = « inconnu »).
 */
export function lireHypothesesPartielles(brut: unknown): Partial<Hypotheses> & { programme?: Partial<Programme> } {
  const b = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of CLES_PCT) if (k in b) out[k] = nombre(b[k], 0, 99.9);
  for (const k of CLES_EUR_M2) if (k in b) out[k] = nombre(b[k], 0, 100_000);
  for (const k of CLES_EUR) if (k in b) out[k] = nombre(b[k], 0, 1e10);
  for (const k of CLES_SOURCES) if (k in b) out[k] = chaine(b[k], 200);
  if ('source_hypotheses' in b) out.source_hypotheses = chaine(b.source_hypotheses, 200);   // lot Q3
  if (b.programme && typeof b.programme === 'object') {
    const p = b.programme as Record<string, unknown>;
    const prog: Partial<Programme> = {};
    if ('nb_logements' in p) prog.nb_logements = nombre(p.nb_logements, 0, 100_000);
    if ('shab_m2' in p) prog.shab_m2 = nombre(p.shab_m2, 0, 1e7);
    if ('sdp_m2' in p) prog.sdp_m2 = nombre(p.sdp_m2, 0, 1e7);
    if ('gabarit' in p) prog.gabarit = chaine(p.gabarit, 40);
    out.programme = prog;
  }
  return out as Partial<Hypotheses> & { programme?: Partial<Programme> };
}

export function fusionnerHypotheses(base: Hypotheses, ajout: Partial<Hypotheses> & { programme?: Partial<Programme> }): Hypotheses {
  return { ...base, ...ajout, programme: { ...base.programme, ...(ajout.programme ?? {}) } } as Hypotheses;
}

/** Lot Q3 : aucune hypothèse connue (toutes null, programme compris) — brouillon jamais renseigné. */
export function hypothesesToutesInconnues(h: Hypotheses): boolean {
  const { programme, ...reste } = h;
  return Object.values(reste).every((v) => v == null) && Object.values(programme ?? {}).every((v) => v == null);
}

/**
 * Lot Q3 (hypothèses du bilan perdues, 05/11/2026) : hypothèses communes d'une mission d'origine
 * (prospection) reprises TELLES QUELLES (mêmes clés, mêmes bornes que rapport_hypotheses), avec leur
 * source d'origine : source_prix / source_couts suffixées, source_hypotheses renseignée. Rien n'est
 * inventé : une clé absente reste absente. null si l'origine ne porte aucune hypothèse.
 */
export function hypothesesDepuisOrigine(brut: unknown, origine: string): (Partial<Hypotheses> & { programme?: Partial<Programme> }) | null {
  const h = lireHypothesesPartielles(brut);
  const { programme, ...reste } = h;
  const valeurs = Object.entries(reste).filter(([k, v]) => v != null && !(CLES_SOURCES as readonly string[]).includes(k) && k !== 'source_hypotheses');
  const prog = programme && Object.values(programme).some((v) => v != null);
  if (!valeurs.length && !prog) return null;
  const marque = (src: string | null | undefined) => texte(`${src ?? 'source non précisée'} — repris de la ${origine}`, 200);
  if (h.prix_vente_libre_eur_m2_shab != null || h.source_prix) h.source_prix = marque(h.source_prix);
  if (h.cout_travaux_eur_m2_sdp != null || h.source_couts) h.source_couts = marque(h.source_couts);
  h.source_hypotheses = texte(`Hypothèses du bilan reprises de la ${origine}`, 200);
  return h;
}

/** Clés de `spec` dont la valeur diffère de `communes` (programme comparé champ par champ). */
export function differences(communes: Hypotheses, spec: Partial<Hypotheses> & { programme?: Partial<Programme> }): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec)) {
    if (k === 'programme') {
      const p: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as unknown as Record<string, unknown>)) {
        if ((communes.programme as unknown as Record<string, unknown>)[pk] !== pv) p[pk] = pv;
      }
      if (Object.keys(p).length) d.programme = p;
    } else if ((communes as unknown as Record<string, unknown>)[k] !== v) {
      d[k] = v;
    }
  }
  return d;
}

// ── Calcul de la charge foncière (formule de l'onglet Bilan Excel) ─────────

export interface BilanTerrain {
  hypotheses_specifiques: Record<string, unknown>;
  ca_ht: number | null;
  couts_hors_foncier_ht: number | null;
  charge_fonciere_admissible_ht: number | null;
  charge_fonciere_eur_m2_terrain: number | null;
  charge_fonciere_eur_m2_sdp: number | null;
  marge_cible_pct_ca: number | null;
  statut: 'complet' | 'partiel';
  manques: string[];
  detail: Record<string, number | null>;
  source: 'calculer_charge_fonciere';
}

const LIBELLES: Record<string, string> = {
  'programme.shab_m2': 'SHAB du programme (m²)',
  'programme.sdp_m2': 'SDP du programme (m²)',
  prix_vente_libre_eur_m2_shab: 'Prix de vente libre (€/m² SHAB)',
  part_lls_pct: 'Part de logements sociaux (%)',
  prix_cession_lls_eur_m2_shab: 'Prix de cession des logements sociaux (€/m² SHAB)',
  cout_travaux_eur_m2_sdp: 'Coût des travaux (€/m² SDP)',
  honoraires_pct_travaux: 'Honoraires (% travaux)',
  aleas_pct_travaux: 'Aléas (% travaux)',
  commercialisation_pct_ca: 'Commercialisation (% CA)',
  frais_financiers_pct_ca: 'Frais financiers (% CA)',
  frais_acquisition_pct_foncier: "Frais d'acquisition (% foncier)",
  taxes_urbanisme_eur: "Taxes d'urbanisme (€)",
  vrd_eur: 'VRD (€)',
  demolition_eur: 'Démolition (€)',
  marge_cible_pct_ca: 'Marge cible (% CA)',
  surface_terrain_m2: 'Surface du terrain (m²)',
};
export const libelleHypothese = (cle: string) => LIBELLES[cle] ?? cle;

export function calculerChargeFonciere(
  communes: Hypotheses,
  specifiquesBrutes: Partial<Hypotheses> & { programme?: Partial<Programme> },
  surfaceTerrain: number | null,
): BilanTerrain {
  const h = fusionnerHypotheses(communes, specifiquesBrutes);
  const manques: string[] = [];
  const req = (cle: string, v: number | null) => { if (v == null) manques.push(libelleHypothese(cle)); return v; };

  const shab = req('programme.shab_m2', h.programme.shab_m2);
  const sdp = req('programme.sdp_m2', h.programme.sdp_m2);
  const prixLibre = req('prix_vente_libre_eur_m2_shab', h.prix_vente_libre_eur_m2_shab);
  const cout = req('cout_travaux_eur_m2_sdp', h.cout_travaux_eur_m2_sdp);
  const hon = req('honoraires_pct_travaux', h.honoraires_pct_travaux);
  const ale = req('aleas_pct_travaux', h.aleas_pct_travaux);
  const com = req('commercialisation_pct_ca', h.commercialisation_pct_ca);
  const ff = req('frais_financiers_pct_ca', h.frais_financiers_pct_ca);
  const fa = req('frais_acquisition_pct_foncier', h.frais_acquisition_pct_foncier);
  const marge = req('marge_cible_pct_ca', h.marge_cible_pct_ca);
  const essentielsManquants = manques.length > 0;

  // Postes « secondaires » : inconnus → exclus du calcul ET signalés (jamais 0 silencieux).
  let lls = h.part_lls_pct;
  if (lls == null) {
    manques.push('Part de logements sociaux (%) — calcul fait sans logement social');
    lls = null;
  }
  let prixLls = h.prix_cession_lls_eur_m2_shab;
  if (lls != null && lls > 0 && prixLls == null) manques.push(libelleHypothese('prix_cession_lls_eur_m2_shab'));
  const taxes = h.taxes_urbanisme_eur, vrd = h.vrd_eur, demo = h.demolition_eur;
  if (taxes == null) manques.push(`${libelleHypothese('taxes_urbanisme_eur')} — non compté`);
  if (vrd == null) manques.push(`${libelleHypothese('vrd_eur')} — non compté`);
  if (demo == null) manques.push(`${libelleHypothese('demolition_eur')} — non compté`);
  if (surfaceTerrain == null) manques.push(libelleHypothese('surface_terrain_m2'));

  const vide: BilanTerrain = {
    hypotheses_specifiques: differences(communes, specifiquesBrutes),
    ca_ht: null, couts_hors_foncier_ht: null, charge_fonciere_admissible_ht: null,
    charge_fonciere_eur_m2_terrain: null, charge_fonciere_eur_m2_sdp: null,
    marge_cible_pct_ca: marge, statut: 'partiel', manques, detail: {}, source: 'calculer_charge_fonciere',
  };
  // Logement social sans prix de cession : on ne sait pas chiffrer le CA → pas de résultat.
  if (essentielsManquants || (lls != null && lls > 0 && prixLls == null)) return vide;

  const partLls = (lls ?? 0) / 100;
  prixLls = prixLls ?? 0;
  const caLibre = shab! * (1 - partLls) * prixLibre!;
  const caLls = shab! * partLls * prixLls;
  const ca = caLibre + caLls;
  const travaux = sdp! * cout!;
  const honoraires = travaux * hon! / 100;
  const aleas = travaux * ale! / 100;
  const commercialisation = ca * com! / 100;
  const fraisFin = ca * ff! / 100;
  const couts = travaux + honoraires + aleas + (demo ?? 0) + (vrd ?? 0) + (taxes ?? 0) + commercialisation + fraisFin;
  const cf = (ca * (1 - marge! / 100) - couts) / (1 + fa! / 100);
  return {
    ...vide,
    ca_ht: arrondi(ca),
    couts_hors_foncier_ht: arrondi(couts),
    charge_fonciere_admissible_ht: arrondi(cf),
    charge_fonciere_eur_m2_terrain: surfaceTerrain ? arrondi(cf / surfaceTerrain) : null,
    charge_fonciere_eur_m2_sdp: sdp ? arrondi(cf / sdp!) : null,
    statut: manques.length ? 'partiel' : 'complet',
    detail: {
      ca_libre_ht: arrondi(caLibre), ca_lls_ht: arrondi(caLls), travaux_ht: arrondi(travaux),
      honoraires_ht: arrondi(honoraires), aleas_ht: arrondi(aleas), demolition_ht: demo, vrd_ht: vrd,
      taxes_urbanisme_ht: taxes, commercialisation_ht: arrondi(commercialisation), frais_financiers_ht: arrondi(fraisFin),
    },
  };
}

// ── Brouillon de rapport (dans etat) ───────────────────────────────────────

export interface BrouillonRapport {
  hypotheses_communes: Hypotheses;
  terrains: Record<string, Record<string, unknown>>;
  bilans: Record<string, BilanTerrain>;
  contacts: Array<Record<string, unknown>>;
}

export function brouillonVide(): BrouillonRapport {
  return { hypotheses_communes: hypothesesVides(), terrains: {}, bilans: {}, contacts: [] };
}

export function chargerBrouillon(b: unknown): BrouillonRapport {
  const x = (b && typeof b === 'object' ? b : {}) as Partial<BrouillonRapport>;
  return {
    hypotheses_communes: fusionnerHypotheses(hypothesesVides(), lireHypothesesPartielles(x.hypotheses_communes)),
    terrains: x.terrains && typeof x.terrains === 'object' ? x.terrains : {},
    bilans: x.bilans && typeof x.bilans === 'object' ? x.bilans : {},
    contacts: Array.isArray(x.contacts) ? x.contacts : [],
  };
}

const IDU_RE = /^[0-9AB]{2}[0-9]{3}[0-9A-Z]{3}[A-Z0-9]{2}[0-9]{4}$/i;
export function normaliserIdu(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, '').toUpperCase();
  return IDU_RE.test(s) ? s : (s.length >= 5 && s.length <= 20 ? s : null);
}

const TYPES_CONTRAINTE = new Set(['mixite_sociale', 'ppr', 'argiles', 'bruit', 'dpu', 'oap', 'servitude', 'fiscalite', 'autre']);
const QUALITES_CONTACT = new Set(['mairie', 'proprietaire', 'autre']);
const VERDICTS = new Set(['prioritaire', 'a_etudier', 'ecarte', 'indetermine']);
export const LIBELLES_VERDICT: Record<string, string> = {
  prioritaire: 'Prioritaire', a_etudier: 'À étudier', ecarte: 'Écarté', indetermine: 'Indéterminé',
};

export function normaliserProprietaire(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  const nom = chaine(p.nom, 200);
  if (!nom) return null;
  const siren = typeof p.siren === 'string' && /^\d{9}$/.test(p.siren.replace(/\s/g, '')) ? p.siren.replace(/\s/g, '') : null;
  // Lot Q1 (D) : le Géoportail de l'urbanisme ne publie aucune information de propriété : source fausse → effacée.
  const source = chaine(p.source, 200);
  return { nom, forme: chaine(p.forme, 80), siren, source: source && RE_SOURCE_GPU.test(source) ? null : source };
}

// ── Lot Q1 (D) : typage et source DÉTERMINISTES des contraintes ────────────
//
// Constat (missions du 04/11/2026, Nanterre) : « Secteur de taxe d'aménagement
// majorée Emile Zola » typé « bruit » ; « Propriétaire = CDC Habitat Social » typé
// « mixite_sociale » et sourcé « Géoportail de l'urbanisme » (l'information vient
// de la DGFiP). Le type se déduit désormais du LIBELLÉ quand c'est possible (le type
// proposé par le modèle ne sert qu'à défaut), la source de l'OUTIL d'origine, et une
// information de propriété n'est jamais une contrainte.

/** Libellé → type (ordre significatif : la première correspondance l'emporte). */
export const TYPAGE_CONTRAINTES: ReadonlyArray<readonly [RegExp, string]> = [
  [/taxe\s+d['’ ]?\s*am[ée]nagement|versement pour sous-densit/i, 'fiscalite'],
  [/pr[ée]emption|\bDPU\b|\bZAD\b/i, 'dpu'],
  [/orientations?\s+d['’ ]?\s*am[ée]nagement|\bOAP\b/i, 'oap'],
  [/argiles?\b|retrait[- ]gonflement/i, 'argiles'],
  [/plan\s+de\s+pr[ée]vention|\bPPR[A-Z]?\b/i, 'ppr'],
  [/classement\s+sonore|\bbruit\b|nuisances?\s+sonores?|\bPEB\b/i, 'bruit'],
  [/mixit[ée]\s+sociale|logements?\s+sociaux|\bLLS\b/i, 'mixite_sociale'],
  [/servitude|\bSUP\b|emplacement\s+r[ée]serv/i, 'servitude'],
];
/** Type d'une contrainte d'après son libellé (null : aucune règle ne s'applique). */
export function typeContrainteDepuisLibelle(libelle: string): string | null {
  for (const [re, type] of TYPAGE_CONTRAINTES) if (re.test(libelle)) return type;
  return null;
}

const RE_SOURCE_GPU = /g[ée]oportail|\bGPU\b/i;
/** Information de propriété (jamais une contrainte d'urbanisme). */
const RE_PROPRIETE = /propri[ée]taire|\bpropri[ée]t[ée]\s+de\b|personne\s+morale\s+propri/i;

/** Outil d'origine → source affichée (libellés repris des outils eux-mêmes). */
export const SOURCE_PAR_OUTIL: Readonly<Record<string, string>> = {
  get_prescriptions_urbanisme: "Géoportail de l'urbanisme via API Carto (IGN)",
  get_zonage_plu: "Géoportail de l'urbanisme via API Carto (IGN)",
  get_proprietaire_parcelle: 'DGFiP — Fichiers des parcelles des personnes morales (Licence Ouverte 2.0)',
};

/** Source d'une donnée : celle de l'outil d'origine s'il est connu, sinon la source déclarée. */
function sourceDepuisOutil(outil: string | null, declaree: string | null): string | null {
  if (outil && SOURCE_PAR_OUTIL[outil]) return SOURCE_PAR_OUTIL[outil];
  return declaree ?? (outil ? `outil ${outil}` : null);
}

export function normaliserContrainte(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const libelle = chaine(c.libelle, 300);
  if (!libelle) return null;
  const outil = chaine(c.outil, 60);
  // Une information de propriété n'est pas une contrainte (voir proprietaireDepuisContrainte).
  if (outil === 'get_proprietaire_parcelle' || RE_PROPRIETE.test(libelle)) return null;
  const type = typeContrainteDepuisLibelle(libelle) ?? (TYPES_CONTRAINTE.has(String(c.type)) ? String(c.type) : 'autre');
  return { type, libelle, source: sourceDepuisOutil(outil, chaine(c.source, 200)), ...(outil ? { outil } : {}) };
}

/**
 * Contrainte qui est en fait une information de PROPRIÉTÉ → propriétaire (nom après « = » ou « : »),
 * avec la source de l'outil d'origine ; une source « Géoportail » est effacée (jamais vraie pour un propriétaire).
 */
export function proprietaireDepuisContrainte(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const libelle = chaine(c.libelle, 300);
  const outil = chaine(c.outil, 60);
  if (!libelle || !(outil === 'get_proprietaire_parcelle' || RE_PROPRIETE.test(libelle))) return null;
  const m = /[=:]\s*(.+)$/.exec(libelle);
  const nom = chaine((m ? m[1] : libelle.replace(RE_PROPRIETE, '')).replace(/^[\s:=–—-]+/, ''), 200);
  if (!nom) return null;
  const declaree = chaine(c.source, 200);
  return { nom, forme: null, siren: null, source: sourceDepuisOutil(outil, declaree && RE_SOURCE_GPU.test(declaree) ? null : declaree) };
}

export function normaliserContact(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const nom = chaine(c.nom, 200);
  if (!nom) return null;
  const email = typeof c.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim()) ? c.email.trim() : null;
  return {
    qualite: QUALITES_CONTACT.has(String(c.qualite)) ? String(c.qualite) : 'autre',
    nom, telephone: chaine(c.telephone, 40), email, adresse: chaine(c.adresse, 300), source: chaine(c.source, 200),
  };
}

/** Terrain déposé par `rapport_terrain` (ou v1) → forme v2 SANS le bilan (ajouté par le moteur). */
export function normaliserTerrainBrut(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  const idu = normaliserIdu(t.idu);
  if (!idu) return null;
  const verdict = VERDICTS.has(String(t.verdict)) ? String(t.verdict) : 'indetermine';
  const brutes = Array.isArray(t.contraintes) ? t.contraintes : [];
  // Lot Q1 (D) : une « contrainte » de propriété devient le propriétaire (s'il n'est pas déjà connu).
  const proprietaire = normaliserProprietaire(t.proprietaire) ?? brutes.map(proprietaireDepuisContrainte).find(Boolean) ?? null;
  const preuves = (Array.isArray(t.preuves_reglementaires) ? t.preuves_reglementaires : []).map(normaliserPreuve).filter(Boolean).slice(0, 10);
  return {
    idu,
    commune: texte(t.commune ?? '', 120),
    adresse: chaine(t.adresse, 200),
    surface_m2: nombre(t.surface_m2, 0, 1e8),
    zonage: chaine(t.zonage, 40),
    libelle_zone: chaine(t.libelle_zone, 200),
    score: nombre(t.score, 0, 1000),
    verdict,
    potentiel_logements: nombre(t.potentiel_logements, 0, 100_000),
    proprietaire,
    contraintes: brutes.map(normaliserContrainte).filter(Boolean).slice(0, 20),
    points_forts: liste(t.points_forts),
    points_bloquants: liste(t.points_bloquants),
    sources: liste(t.sources, 30, 200),
    // Lot Q1 : champs ajoutés seulement s'ils portent quelque chose (fiches v2 existantes inchangées).
    ...(preuves.length ? { preuves_reglementaires: preuves } : {}),
    ...(liste(t.a_verifier).length ? { a_verifier: liste(t.a_verifier) } : {}),
  };
}

export function normaliserClassement(v: unknown, idusConnus: Set<string>): Array<{ rang: number; idu: string; justification: string }> {
  const out: Array<{ rang: number; idu: string; justification: string }> = [];
  const vus = new Set<string>();
  for (const x of Array.isArray(v) ? v : []) {
    const c = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const idu = normaliserIdu(c.idu);
    if (!idu || vus.has(idu) || (idusConnus.size && !idusConnus.has(idu))) continue;
    vus.add(idu);
    out.push({ rang: 0, idu, justification: texte(c.justification ?? '', 600) });
  }
  // Rangs renumérotés dans l'ordre donné (1, 2, 3…) : pas d'ex æquo ni de trou.
  out.forEach((c, i) => { c.rang = i + 1; });
  return out.slice(0, 30);
}


// ── Lot Q1 (B) : aucune affirmation de conformité sans règle citée ──────────
//
// Constat (04/11/2026, Nanterre AE0414) : « Zone UBa compatible R+4 » (prospection)
// et « confirmée constructible en logement collectif » (conception), sans citer ni
// l'article de hauteur ni les articles de destination (UC 1 / UC 2). Garde
// DÉTERMINISTE appliquée au rapport assemblé : une phrase qui AFFIRME une
// compatibilité / constructibilité / conformité (hauteur, gabarit R+n, destination)
// n'est gardée que si une règle CITÉE (source + article + page) du bon sujet existe ;
// sinon elle est reformulée « À vérifier » (synthèse, justification) ou déplacée des
// points forts vers `a_verifier`, et une limite explicite est ajoutée. Les phrases
// déjà négatives ou conditionnelles ne sont jamais touchées.

export type SujetPreuve = 'hauteur' | 'destination';
export interface PreuveReglementaire { sujet: SujetPreuve; source: string; article: string; page: string | null }

const RE_PAGE = /\b(?:p\.?|pages?)\s*\d+/i;
/** Preuve valable : sujet connu, source, article, et page (champ `page` ou « p. N » dans l'article). */
export function normaliserPreuve(v: unknown): PreuveReglementaire | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  const sujet = p.sujet === 'hauteur' || p.sujet === 'destination' ? p.sujet : null;
  const source = chaine(p.source, 200);
  const article = chaine(p.article, 80);
  const page = typeof p.page === 'number' && Number.isFinite(p.page) ? String(p.page) : chaine(p.page, 20);
  if (!sujet || !source || !article || !(page || RE_PAGE.test(article))) return null;
  return { sujet, source, article, page };
}

const LETTRE = '\\p{L}\\p{N}';
const mot = (alternatives: string) => new RegExp(`(?<![${LETTRE}])(?:${alternatives})(?![${LETTRE}])`, 'iu');
/** Verbes / adjectifs d'affirmation réglementaire. */
const RE_AFFIRMATION = mot('compatibles?|constructibles?|autoris[ée]e?s?|conformes?|admise?s?|permise?s?|réalisables?|confirm[ée]e?s?|respecte|respectent');
/** Phrase déjà négative, conditionnelle ou prudente : jamais réécrite. */
const RE_PRUDENCE = new RegExp(
  `(?<![${LETTRE}])n['’](?=\\p{L})|` +
  mot('non|pas|ne|ni|aucune?|sans|si|sauf|incompatibles?|inconstructibles?|interdite?s?|probablement|potentiellement|éventuellement|semblent?|hypothèse|indéterminable|indéterminée?|à vérifier|a verifier|à confirmer|à préciser|reste à|sous réserve|de principe|a priori|à priori').source,
  'iu');
const RE_HAUTEUR = mot('R\\s*\\+\\s*\\d+|hauteurs?|gabarits?|niveaux?|étages?|acrotères?|faîtages?|égouts?');
const RE_DESTINATION = mot('logements?|habitations?|résidentiel(?:le)?s?|destinations?|collectifs?|bureaux|commerces?|constructibles?|constructibilité');
const RE_CADRE_PLU = mot('zones?|zonages?|règlements?|urbanisme');
/** Code de zone ou PLU, SENSIBLE à la casse (« UC », « UBa », « 1AUh », « PLUi » ; jamais « aux »). */
const RE_CODE_ZONE = new RegExp(`(?<![${LETTRE}])(?:PLUi?|[1-9]?AU[a-z0-9]{0,3}|U(?:[A-Z][a-z0-9]{0,3}|[0-9][a-z0-9]{0,2})?)(?![${LETTRE}])`, 'u');

/** Sujets qu'une phrase affirme sans réserve (vide : rien à prouver). */
export function sujetsAffirmes(phrase: string): SujetPreuve[] {
  if (!RE_AFFIRMATION.test(phrase) || RE_PRUDENCE.test(phrase)) return [];
  const sujets: SujetPreuve[] = [];
  if (RE_HAUTEUR.test(phrase)) sujets.push('hauteur');
  if (RE_DESTINATION.test(phrase)) sujets.push('destination');
  if (!sujets.length && (RE_CADRE_PLU.test(phrase) || RE_CODE_ZONE.test(phrase))) sujets.push('destination');
  return sujets;
}

const LIBELLE_SUJET: Record<SujetPreuve, string> = {
  hauteur: 'règle de hauteur (article de hauteur du règlement)',
  destination: 'règle de destination (articles des occupations interdites / soumises à conditions)',
};

/** Citation complète DANS la phrase : article ET page (« art. UC 10, p. 109 »). */
const RE_CITATION_EN_LIGNE = /\bart(?:icle)?\.?\s*[A-Z0-9][\w.-]*(?:\s*[\w.-]+)?\s*[,(–—-]\s*(?:p\.?|page)\s*\d+/iu;
/** Lot Q3 : citation « (UC 6-1, p. 106) » — article du règlement (code de zone + numéro) ET page, sans « art. ». */
const RE_CITATION_ZONE_PAGE = new RegExp(`(?<![${LETTRE}])[1-9]?[A-Z]{1,4}[a-z0-9]{0,3}\\s+\\d{1,2}(?:[-.]\\d{1,2})*\\s*[,(–—-]\\s*(?:p\\.?|page)\\s*\\d+`, 'u');

/** Sujets affirmés mais non prouvés, ou vide si la phrase passe. */
function sujetsSansPreuve(phrase: string, preuves: readonly PreuveReglementaire[]): SujetPreuve[] {
  if (RE_CITATION_EN_LIGNE.test(phrase) || RE_CITATION_ZONE_PAGE.test(phrase)) return [];
  return sujetsAffirmes(phrase).filter((s) => !preuves.some((p) => p.sujet === s));
}

const sansPointFinal = (p: string) => p.trim().replace(/[.!…\s]+$/u, '');
/** Reformulation « à vérifier » d'une affirmation non prouvée, avec la règle manquante nommée. */
export function reformulerAVerifier(phrase: string, manquants: SujetPreuve[]): string {
  return `À vérifier : ${sansPointFinal(phrase)} — ${manquants.map((m) => LIBELLE_SUJET[m]).join(' et ')} non citée (source, article et page requis).`;
}

/** Abréviations après lesquelles un point ne termine pas la phrase (« p. 109 », « art. UC 1 », « M. Durand »). */
const ABREVIATIONS = new Set(['art', 'p', 'pp', 'cf', 'ex', 'réf', 'ref', 'al', 'n°', 'no', 'm', 'mme', 'mm', 'dr', 'st', 'ste', 'env', 'av', 'bd', 'chap', 'fig', 'vol', 'éd', 'min', 'max', 'hab', 'sect']);

/**
 * Lot Q3 : découpe un texte en phrases SANS RIEN PERDRE — la concaténation des `phrase + sep` est
 * EXACTEMENT le texte d'entrée (espaces, sauts de ligne, puces conservés). Fin de phrase : un saut
 * de ligne, ou « . ! ? … » suivi d'espace(s) puis d'une majuscule / « / " — jamais après une
 * abréviation (« p. », « art. », « cf. »…) ni une initiale (« J. »). Un point collé (« .pdf) »,
 * « 09/12/2025) », « UC 6-1 ») n'est jamais une fin de phrase.
 */
export function decouperPhrases(t: string): Array<{ phrase: string; sep: string }> {
  const out: Array<{ phrase: string; sep: string }> = [];
  const re = /\s+/gu;
  let debut = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const i = m.index;
    const w = m[0];
    let fin = w.includes('\n');
    if (!fin && i > 0 && /[.!?…]/u.test(t[i - 1]) && /[\p{Lu}«"]/u.test(t[i + w.length] ?? '')) {
      if (t[i - 1] !== '.') fin = true;
      else {
        const mot = /([\p{L}°]+)\.$/u.exec(t.slice(Math.max(debut, i - 12), i))?.[1] ?? '';
        const initiale = /^\p{Lu}$/u.test(mot) && (i - 2 === debut || /[\s(]/u.test(t[i - 3] ?? ' '));
        fin = !initiale && !ABREVIATIONS.has(mot.toLowerCase());
      }
    }
    if (fin && i > debut) {
      out.push({ phrase: t.slice(debut, i), sep: w });
      debut = i + w.length;
    } else if (fin && i === debut) {
      // Séparateur en tête (texte qui commence par des blancs) : rattaché à une phrase vide.
      out.push({ phrase: '', sep: w });
      debut = i + w.length;
    }
  }
  out.push({ phrase: t.slice(debut), sep: '' });
  return out;
}

/**
 * Réécrit, phrase par phrase, un texte libre (synthèse, justification). Lot Q3 : le texte NON
 * réécrit sort STRICTEMENT identique à l'entrée (seules les phrases réécrites changent).
 */
export function garderTexte(t: string, preuves: readonly PreuveReglementaire[]): { texte: string; reecrites: string[] } {
  if (!t) return { texte: t, reecrites: [] };
  const reecrites: string[] = [];
  const out = decouperPhrases(t).map(({ phrase, sep }) => {
    const m = phrase.trim() ? sujetsSansPreuve(phrase, preuves) : [];
    if (!m.length) return phrase + sep;
    const r = reformulerAVerifier(phrase, m);
    reecrites.push(r);
    return r + sep;
  });
  return { texte: out.join(''), reecrites };
}

/** Points forts : une affirmation non prouvée quitte les points forts pour `a_verifier`. */
export function garderPointsForts(points: string[], preuves: readonly PreuveReglementaire[]): { gardes: string[]; a_verifier: string[] } {
  const gardes: string[] = [];
  const aVerifier: string[] = [];
  for (const p of points) {
    const m = sujetsSansPreuve(p, preuves);
    if (m.length) aVerifier.push(reformulerAVerifier(p, m)); else gardes.push(p);
  }
  return { gardes, a_verifier: aVerifier };
}

// ── Lot Q1 (C) : zone et libellé de zone SOURCÉS ───────────────────────────
//
// Constat : la prospection a classé AE0414 en « UBa » et décrit UC comme
// « équipements et espaces verts » (libellé écrit par le modèle, sans source) ;
// la conception a lu UC au Géoportail de l'urbanisme (get_zonage_plu). Le moteur
// garde désormais les zones LUES par les outils (`etat.zonages_lus`) : le libellé
// de zone ne vient que d'elles (GPU libelong), sinon null ; un écart entre la zone
// de la fiche et la zone lue, ou plusieurs zones lues, devient une alerte explicite.

/** Une lecture de zone par un outil, pour une parcelle. */
export interface LectureZonage { zone: string | null; libelle: string | null; zones: string[]; source: string; outil: string }

/** « Zone UBa — résidentiel » → « UBa » (casse d'origine) ; null si ce n'est pas un code de zone. */
export function codeZone(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const tete = v.trim().split(/\s+[—–-]\s+|\s*\(|\s*,|\s*:/u)[0].replace(/^zone\s+/i, '').replace(/\s+/g, '');
  return /^[1-9]?(?:AU|U|A|N)[A-Za-z0-9]{0,6}$/i.test(tete) ? tete : null;
}
/** Comparaison de codes de zone insensible à la casse (« UBa » = « UBA »). */
const memeZone = (a: string | null, b: string | null) => a != null && b != null && a.toUpperCase() === b.toUpperCase();

/** Codes lus (casse d'origine), sans doublon insensible à la casse. */
function codesLus(lectures: readonly LectureZonage[]): string[] {
  const out: string[] = [];
  for (const z of lectures.flatMap((l) => [l.zone, ...l.zones]).map(codeZone)) {
    if (z && !out.some((x) => memeZone(x, z))) out.push(z);
  }
  return out;
}

/** Lectures de zone tirées d'un résultat d'outil (get_zonage_plu, rechercher_parcelles), par idu. */
export function zonagesDepuisResultat(
  outil: string, input: Record<string, unknown> | null | undefined, res: unknown, iduParDefaut: string | null,
): Array<[string, LectureZonage]> {
  const r = (res && typeof res === 'object' ? res : {}) as Record<string, unknown>;
  if (r.status !== 'ok' && r.status !== 'partial') return [];
  const d = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>;
  const src = chaine(d.source, 200) ?? chaine(r.source, 200) ?? outil;
  if (outil === 'get_zonage_plu') {
    const i = (input ?? {}) as Record<string, unknown>;
    const idu = normaliserIdu(i.idu ?? i.cadastral_ref ?? i.parcel_id ?? iduParDefaut);
    if (!idu) return [];
    const zs = (Array.isArray(d.zones) ? d.zones : []) as Array<Record<string, unknown>>;
    const zp = (d.zone_principale && typeof d.zone_principale === 'object' ? d.zone_principale : zs[0] ?? null) as Record<string, unknown> | null;
    if (!zp && !zs.length) return [];
    return [[idu, {
      zone: chaine(zp?.zone, 40), libelle: chaine(zp?.libelle_long, 200),
      zones: zs.map((z) => chaine(z.zone, 40)).filter((z): z is string => z != null).slice(0, 10), source: src, outil,
    }]];
  }
  if (outil === 'rechercher_parcelles') {
    const ps = (Array.isArray(d.parcelles) ? d.parcelles : []) as Array<Record<string, unknown>>;
    return ps.flatMap((p): Array<[string, LectureZonage]> => {
      const idu = normaliserIdu(p.idu);
      const zone = chaine(p.zone, 40);
      // rechercher_parcelles ne donne pas de libellé : il n'en sera pas inventé.
      // Lot Q3 : plusieurs zones au point (documents superposés) → toutes gardées (alerte « plusieurs zones »).
      const autres = (Array.isArray(p.zonages_au_point) ? p.zonages_au_point : [])
        .map((x) => chaine(String(x).split(' (')[0], 40)).filter((x): x is string => x != null);
      const zones = [...new Set([zone, ...autres].filter((x): x is string => x != null))].slice(0, 10);
      return idu && zone ? [[idu, { zone, libelle: null, zones, source: `${src} (zone lue au centroïde)`, outil }]] : [];
    }).slice(0, 60);
  }
  return [];
}

/** Ajoute des lectures à la table (≤ 4 par parcelle, ≤ 80 parcelles), sans doublon. */
export function ajouterZonages(table: Record<string, LectureZonage[]>, ajouts: Array<[string, LectureZonage]>): Record<string, LectureZonage[]> {
  for (const [idu, l] of ajouts) {
    const liste = table[idu] ?? [];
    if (!liste.some((x) => x.outil === l.outil && x.zone === l.zone)) liste.push(l);
    table[idu] = liste.slice(-4);
  }
  const cles = Object.keys(table);
  for (const k of cles.slice(0, Math.max(0, cles.length - 80))) delete table[k];
  return table;
}

/** Alertes d'écart : zone attendue (fiche, prospection) ≠ zone lue, ou plusieurs zones lues. */
export function alertesZonage(idu: string, zoneAttendue: string | null, origineAttendue: string, lectures: readonly LectureZonage[]): string[] {
  const alertes: string[] = [];
  const lus = codesLus(lectures);
  const attendue = codeZone(zoneAttendue);
  const quiLit = lectures.map((l) => `${l.outil} : ${l.zone ?? '?'}`).join(' ; ');
  if (attendue && lus.length && !lus.some((z) => memeZone(z, attendue))) {
    alertes.push(`Zonage ${idu} : ${origineAttendue} indique ${attendue}, mais la zone lue est ${lus.join(' / ')} (${quiLit}). Zone à vérifier sur le plan de zonage avant toute conclusion.`);
  }
  if (lus.length > 1) {
    alertes.push(`Zonage ${idu} : plusieurs zones lues pour la parcelle (${lus.join(', ')}) — parcelle à cheval ou documents superposés. Les règles de chaque zone sont à vérifier.`);
  }
  return alertes;
}

/** Libellé de zone SOURCÉ (GPU libelong) pour le code donné, sinon null. */
export function libelleZoneSource(code: string | null, lectures: readonly LectureZonage[]): { libelle: string; source: string } | null {
  if (!code) return null;
  const l = lectures.find((x) => x.libelle && memeZone(codeZone(x.zone), code));
  return l ? { libelle: l.libelle!, source: l.source } : null;
}

/**
 * Assemble le rapport v2 : brouillon accumulé + rapport final (terminer_mission
 * v2 léger, ou rapport v1 complet, ou rapport partiel JSON).
 */
export function assemblerRapportV2(
  brouillon: BrouillonRapport,
  final: Record<string, unknown> | null,
  commun: {
    actions_proposees: string[]; memoire_ajoutee: number; jetons_consommes: number; limites_ajoutees: string[];
    /** Lot Q1 (B) : règles citées connues du moteur (ex. règles de conception lues avec article et page). */
    preuves?: PreuveReglementaire[];
    /** Lot Q1 (C) : zones lues par les outils, par idu. Fourni → libellés non sourcés effacés, écarts signalés. */
    zonages_lus?: Record<string, LectureZonage[]>;
  },
): Record<string, unknown> {
  const b = final ?? {};
  // Terrains : brouillon + ceux du rapport final (v1) — le dernier dépôt l'emporte, le bilan reste celui du moteur.
  const terrains = new Map<string, Record<string, unknown>>();
  for (const t of Object.values(brouillon.terrains)) { const n = normaliserTerrainBrut(t); if (n) terrains.set(String(n.idu), n); }
  for (const t of Array.isArray(b.terrains) ? b.terrains : []) {
    const n = normaliserTerrainBrut(t);
    if (n) terrains.set(String(n.idu), { ...(terrains.get(String(n.idu)) ?? {}), ...Object.fromEntries(Object.entries(n).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length))) });
  }
  // Un bilan calculé pour un terrain non déposé : on crée une fiche minimale plutôt que de le perdre.
  for (const idu of Object.keys(brouillon.bilans)) {
    if (!terrains.has(idu)) terrains.set(idu, normaliserTerrainBrut({ idu })!);
  }
  const classement = normaliserClassement(b.classement, new Set(terrains.keys()));
  const rangs = new Map(classement.map((c) => [c.idu, c.rang]));
  const fiches = [...terrains.values()].map((t): Record<string, unknown> & { rang: number | null; bilan: BilanTerrain | null } => {
    const bilan = brouillon.bilans[String(t.idu)] ?? null;
    return {
      ...t,
      rang: rangs.get(String(t.idu)) ?? null,
      verdict_libelle: LIBELLES_VERDICT[String(t.verdict)] ?? 'Indéterminé',
      bilan,
      // Compatibilité v1 : champ plat lu par l'affichage existant.
      charge_fonciere_admissible: bilan?.charge_fonciere_admissible_ht ?? null,
    };
  }).sort((a, b2) => {
    const ra = a.rang ?? 1e9, rb = b2.rang ?? 1e9;  // classés d'abord, puis par score décroissant
    if (ra !== rb) return ra - rb;
    return (Number(b2.score) || 0) - (Number(a.score) || 0);
  });
  // Contacts : brouillon + final, dédoublonnés par (nom, téléphone, e-mail).
  const contacts: Array<Record<string, unknown>> = [];
  const cles = new Set<string>();
  for (const c of [...brouillon.contacts, ...(Array.isArray(b.contacts) ? b.contacts : [])]) {
    const n = normaliserContact(c);
    if (!n) continue;
    const k = `${String(n.nom).toLowerCase()}|${n.telephone ?? ''}|${n.email ?? ''}`;
    if (cles.has(k)) continue;
    cles.add(k);
    contacts.push(n);
  }
  const memeProgramme = fiches.filter((t) => t.bilan).length > 1 &&
    fiches.filter((t) => t.bilan).every((t) => !Object.keys((t.bilan as BilanTerrain).hypotheses_specifiques ?? {}).length);
  const limites = [...liste(b.limites, 30), ...commun.limites_ajoutees];
  if (memeProgramme) limites.push('Programme et hypothèses identiques pour tous les terrains, faute de règles chiffrées du PLU propres à chaque parcelle : la charge foncière ne les départage pas.');

  // Lot Q1 (C) : zone et libellé sourcés, écarts signalés.
  const alertes: string[] = [];
  if (commun.zonages_lus) {
    for (const t of fiches) {
      const idu = String(t.idu);
      const lectures = commun.zonages_lus[idu] ?? [];
      const code = codeZone(t.zonage);
      const lus = codesLus(lectures);
      if (code) t.zonage = code;                                   // le libellé n'est jamais collé au code
      else if (!t.zonage && lus.length === 1) t.zonage = lus[0];   // zone lue par un outil, unique
      const lib = libelleZoneSource(codeZone(t.zonage), lectures);
      t.libelle_zone = lib ? lib.libelle : null;
      if (lib) t.libelle_zone_source = lib.source;
      const a = alertesZonage(idu, code, 'la fiche du terrain', lectures);
      if (a.length) { t.alertes = a; alertes.push(...a); }
    }
  }

  // Lot Q1 (B) : aucune affirmation de conformité sans règle citée.
  const preuvesGlobales = [...(commun.preuves ?? []),
    ...(Array.isArray(b.preuves_reglementaires) ? b.preuves_reglementaires : []).map(normaliserPreuve).filter((p): p is PreuveReglementaire => p != null)];
  const preuvesDe = (t: Record<string, unknown>) => [...preuvesGlobales, ...((t.preuves_reglementaires as PreuveReglementaire[] | undefined) ?? [])];
  const reformulees: string[] = [];
  for (const t of fiches) {
    if (!Array.isArray(t.points_forts)) continue;
    const g = garderPointsForts(t.points_forts as string[], preuvesDe(t));
    if (g.a_verifier.length) {
      t.points_forts = g.gardes;
      t.a_verifier = [...((t.a_verifier as string[] | undefined) ?? []), ...g.a_verifier];
      reformulees.push(...g.a_verifier.map((x) => `${t.idu} — ${x}`));
    }
  }
  const parIdu = new Map(fiches.map((t) => [String(t.idu), t]));
  for (const c of classement) {
    const t = parIdu.get(c.idu);
    const g = garderTexte(c.justification, t ? preuvesDe(t) : preuvesGlobales);
    if (g.reecrites.length) { c.justification = texte(g.texte, 600); reformulees.push(...g.reecrites.map((x) => `${c.idu} — ${x}`)); }
  }
  // Synthèse : preuves globales, ou celles de l'unique terrain du rapport.
  const preuvesSynthese = fiches.length === 1 ? preuvesDe(fiches[0]) : preuvesGlobales;
  const gs = garderTexte(texte(b.synthese ?? '', 6000), preuvesSynthese);
  reformulees.push(...gs.reecrites);
  if (reformulees.length) {
    alertes.push(...reformulees);
    limites.push(`${reformulees.length} affirmation(s) de compatibilité, de constructibilité ou de conformité sans règle citée (source, article et page du règlement) : reformulée(s) « à vérifier ». Rien n'est établi tant que la règle n'est pas citée.`);
  }
  limites.push(...alertes.filter((a) => a.startsWith('Zonage ')));

  return {
    version: 2,
    titre: texte(b.titre ?? 'Rapport de mission', 200),
    synthese: texte(gs.texte, 6000),
    hypotheses_communes: brouillon.hypotheses_communes,
    terrains: fiches.slice(0, 30),
    classement,
    contacts: contacts.slice(0, 30),
    actions_proposees: [...commun.actions_proposees],
    memoire_ajoutee: commun.memoire_ajoutee,
    limites,
    jetons_consommes: commun.jetons_consommes,
    ...(Array.isArray(b.elements) ? { elements: b.elements.slice(0, 40) } : {}),
    // Lot Q1 : alertes « à vérifier » (zonage, affirmations non prouvées) — champ présent seulement s'il y en a.
    ...(alertes.length ? { alertes_verification: alertes.slice(0, 40) } : {}),
  };
}

// ── Lot Q3 : adresse des terrains (Base Adresse Nationale, reverse, sans clé) ──

export const URL_BAN_REVERSE = 'https://api-adresse.data.gouv.fr/reverse/';

/** Adresse la plus proche d'un point (BAN reverse) avec sa source, ou null. `fetchFn` injectable. */
export async function adresseDepuisPoint(
  pt: { lat: number; lon: number }, fetchFn: typeof fetch, timeoutMs = 4000,
): Promise<{ adresse: string; source: string } | null> {
  if (!Number.isFinite(pt?.lat) || !Number.isFinite(pt?.lon) || Math.abs(pt.lat) > 90 || Math.abs(pt.lon) > 180) return null;
  try {
    const url = `${URL_BAN_REVERSE}?lon=${pt.lon.toFixed(6)}&lat=${pt.lat.toFixed(6)}&limit=1`;
    const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const j = await r.json();
    const p = j?.features?.[0]?.properties;
    const label = chaine(p?.label, 200);
    if (!label) return null;
    const d = typeof p?.distance === 'number' && Number.isFinite(p.distance) ? `, à ${Math.round(p.distance)} m` : '';
    return { adresse: label, source: `Base Adresse Nationale (api-adresse.data.gouv.fr/reverse) — adresse la plus proche du centroïde de la parcelle${d}` };
  } catch {
    return null;
  }
}

/**
 * Complète l'adresse des fiches du rapport (terrains sans adresse dont le centroïde est connu) et,
 * pour une conception, `rapport.conception.adresse`. Au plus 10 appels, 5 en parallèle ; une adresse
 * non trouvée reste null. Une adresse déjà présente (outil, modèle) n'est jamais remplacée.
 */
export async function completerAdresses(
  rapport: Record<string, unknown>, points: Record<string, { lat: number; lon: number }>, fetchFn: typeof fetch,
): Promise<number> {
  const terrains = (Array.isArray(rapport.terrains) ? rapport.terrains : []) as Array<Record<string, unknown>>;
  const conception = rapport.conception && typeof rapport.conception === 'object' ? rapport.conception as Record<string, unknown> : null;
  const cibles = new Map<string, { lat: number; lon: number }>();
  for (const t of terrains) {
    const idu = String(t.idu ?? '');
    if (!t.adresse && points[idu]) cibles.set(idu, points[idu]);
  }
  const iduC = conception ? String(conception.idu ?? '') : '';
  if (conception && !conception.adresse && points[iduC]) cibles.set(iduC, points[iduC]);
  const liste = [...cibles.entries()].slice(0, 10);
  const trouvees = new Map<string, { adresse: string; source: string }>();
  for (let i = 0; i < liste.length; i += 5) {
    await Promise.all(liste.slice(i, i + 5).map(async ([idu, pt]) => {
      const a = await adresseDepuisPoint(pt, fetchFn);
      if (a) trouvees.set(idu, a);
    }));
  }
  for (const t of terrains) {
    const a = trouvees.get(String(t.idu ?? ''));
    if (a && !t.adresse) { t.adresse = a.adresse; t.adresse_source = a.source; }
  }
  if (conception && !conception.adresse) {
    const a = trouvees.get(iduC);
    conception.adresse = a?.adresse ?? null;
    if (a) conception.adresse_source = a.source;
  }
  return trouvees.size;
}
