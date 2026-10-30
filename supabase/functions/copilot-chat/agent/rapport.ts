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

const TYPES_CONTRAINTE = new Set(['mixite_sociale', 'ppr', 'argiles', 'bruit', 'dpu', 'oap', 'servitude', 'autre']);
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
  return { nom, forme: chaine(p.forme, 80), siren, source: chaine(p.source, 200) };
}

export function normaliserContrainte(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const libelle = chaine(c.libelle, 300);
  if (!libelle) return null;
  const type = TYPES_CONTRAINTE.has(String(c.type)) ? String(c.type) : 'autre';
  return { type, libelle, source: chaine(c.source, 200) };
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
    proprietaire: normaliserProprietaire(t.proprietaire),
    contraintes: (Array.isArray(t.contraintes) ? t.contraintes : []).map(normaliserContrainte).filter(Boolean).slice(0, 20),
    points_forts: liste(t.points_forts),
    points_bloquants: liste(t.points_bloquants),
    sources: liste(t.sources, 30, 200),
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

/**
 * Assemble le rapport v2 : brouillon accumulé + rapport final (terminer_mission
 * v2 léger, ou rapport v1 complet, ou rapport partiel JSON).
 */
export function assemblerRapportV2(
  brouillon: BrouillonRapport,
  final: Record<string, unknown> | null,
  commun: { actions_proposees: string[]; memoire_ajoutee: number; jetons_consommes: number; limites_ajoutees: string[] },
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
  return {
    version: 2,
    titre: texte(b.titre ?? 'Rapport de mission', 200),
    synthese: texte(b.synthese ?? '', 6000),
    hypotheses_communes: brouillon.hypotheses_communes,
    terrains: fiches.slice(0, 30),
    classement,
    contacts: contacts.slice(0, 30),
    actions_proposees: [...commun.actions_proposees],
    memoire_ajoutee: commun.memoire_ajoutee,
    limites,
    jetons_consommes: commun.jetons_consommes,
    ...(Array.isArray(b.elements) ? { elements: b.elements.slice(0, 40) } : {}),
  };
}
