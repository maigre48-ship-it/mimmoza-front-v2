// src/spaces/copilot/agent/rapport/bilanExcel.ts
// =============================================================================
// Bilan promoteur Excel MODIFIABLE, avec de vraies formules (exceljs).
// Onglets : Hypothèses (cellules jaunes à saisir) → Bilan (tout en formules)
// → Sensibilité (terrain n°1, prix × coût) → Sources & limites.
// Règles de calcul = celles du moteur (calculerChargeFonciere) :
//   · hypothèse indispensable vide → « Bilan incomplet », pas de charge foncière ;
//   · part sociale, taxes, VRD, démolition vides → « non chiffré », comptés 0
//     et signalés (« Bilan partiel ») ; jamais un 0 silencieux.
// Chaque formule porte une valeur en cache calculée par bilanCalcul.ts (mêmes
// règles) pour les lecteurs qui ne recalculent pas ; Excel recalcule tout à
// l'ouverture (fullCalcOnLoad).
// =============================================================================
import ExcelJS from 'exceljs';
import {
  DEFINITIONS_HYPOTHESES, LIBELLE_UNITE, hypothesesTerrain, type CleHypothese, type ModeleRapport,
  type Nombre, type TerrainModele, type UniteHypothese,
} from './rapportModele.ts';
import {
  calculerBilan, chargeFonciereSensibilite, entreesDepuisJeu, libelleEtatBilan, type ResultatBilan,
} from './bilanCalcul.ts';

// ── Charte ───────────────────────────────────────────────────────────────────
const VIOLET = 'FF6D5DFC', TITRE = 'FF233451', GRIS = 'FF5B5F78', FOND_TITRE = 'FFF1EFFF', ENCRE = 'FF172238';
const SAISIE_FOND = 'FFFFF9DB', SAISIE_POLICE = 'FF1D4ED8', MANQUE_FORT = 'FFFDBA74', MANQUE_LEGER = 'FFFDE68A', NEUTRE = 'FFF3F4F6';
const POLICE = 'Aptos';

export const FEUILLE_HYP = 'Hypothèses';
export const FEUILLE_BILAN = 'Bilan';
export const FEUILLE_SENSI = 'Sensibilité';
export const FEUILLE_SOURCES = 'Sources & limites';

export const FORMATS: Record<UniteHypothese, string> = {
  nb: '#,##0', m2: '#,##0" m²"', eur_m2: '#,##0" €/m²"', pct: '0.0%', eur: '#,##0" €"',
};

/** Colonne Excel (1 → A, 27 → AA). */
export function lettre(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

// ── Plan des lignes (partagé avec les tests) ─────────────────────────────────
export const COL_PREMIER_TERRAIN = 4; // colonne D, dans les deux onglets
export const LIGNE_ENTETE = 4;
export const LIGNE_SURFACE = 5;
export const LIGNE_HYP = Object.fromEntries(DEFINITIONS_HYPOTHESES.map((d, i) => [d.cle, 6 + i])) as Record<CleHypothese, number>;
export const LIGNE_NEGOCIE = 6 + DEFINITIONS_HYPOTHESES.length;
export const LIGNE_GABARIT = LIGNE_NEGOCIE + 1;

export const LIGNES_BILAN = {
  etat: 5, postes: 6, bloquants: 7,
  titreCa: 9, caLibre: 10, caLls: 11, ca: 12,
  titreCouts: 14, travaux: 15, honoraires: 16, aleas: 17, demolition: 18, vrd: 19, taxes: 20,
  commercialisation: 21, fraisFinanciers: 22, couts: 23,
  titreResultat: 25, margeCible: 26, chargeFonciere: 27, cfM2Terrain: 28, cfM2Sdp: 29, cfRapport: 30,
  titreNego: 32, negocie: 33, fraisAcq: 34, margeReelle: 35, margeReellePct: 36,
} as const;
type CleLigne = keyof typeof LIGNES_BILAN;
export type CleFormule = Exclude<CleLigne, `titre${string}` | 'cfRapport'>;

const refH = (cle: CleHypothese | 'surface' | 'negocie', col: string, absolu = false) => {
  const ligne = cle === 'surface' ? LIGNE_SURFACE : cle === 'negocie' ? LIGNE_NEGOCIE : LIGNE_HYP[cle];
  return absolu ? `'${FEUILLE_HYP}'!$${col}$${ligne}` : `'${FEUILLE_HYP}'!${col}${ligne}`;
};

/** Formules de l'onglet Bilan pour une colonne de terrain (exportées pour les tests). */
export function formulesBilan(col: string): Record<CleFormule, string> {
  const H = (c: CleHypothese | 'surface' | 'negocie') => refH(c, col);
  const B = (k: CleLigne) => `${col}${LIGNES_BILAN[k]}`;
  const vide = (...refs: string[]) => `OR(${refs.map((r) => `${r}=""`).join(',')})`;
  const llsSansPrix = `IF(AND(N(${H('part_lls_pct')})>0,${H('prix_cession_lls_eur_m2_shab')}=""),1,0)`;
  const compte = (role: (d: (typeof DEFINITIONS_HYPOTHESES)[number]) => boolean) =>
    DEFINITIONS_HYPOTHESES.filter(role).map((d) => `COUNTBLANK(${H(d.cle)})`).join('+');
  const secondaire = (c: CleHypothese) => `IF(${H(c)}="","non chiffré",${H(c)})`;
  return {
    postes: `${compte((d) => d.requise)}+${llsSansPrix}`,
    bloquants: `${compte((d) => d.role === 'essentielle')}+${llsSansPrix}`,
    etat: `IF(${B('bloquants')}>0,"Bilan incomplet : "&${B('bloquants')}&" poste(s) indispensable(s) à renseigner",`
      + `IF(${B('postes')}>0,"Bilan partiel : "&${B('postes')}&" poste(s) non chiffré(s), comptés à 0","Bilan complet"))`,
    caLibre: `IF(${vide(H('shab_m2'), H('prix_vente_libre_eur_m2_shab'))},"",${H('shab_m2')}*(1-N(${H('part_lls_pct')}))*${H('prix_vente_libre_eur_m2_shab')})`,
    caLls: `IF(${H('shab_m2')}="","",IF(N(${H('part_lls_pct')})=0,0,IF(${H('prix_cession_lls_eur_m2_shab')}="","",${H('shab_m2')}*${H('part_lls_pct')}*${H('prix_cession_lls_eur_m2_shab')})))`,
    ca: `IF(${vide(B('caLibre'), B('caLls'))},"",${B('caLibre')}+${B('caLls')})`,
    travaux: `IF(${vide(H('sdp_m2'), H('cout_travaux_eur_m2_sdp'))},"",${H('sdp_m2')}*${H('cout_travaux_eur_m2_sdp')})`,
    honoraires: `IF(${vide(B('travaux'), H('honoraires_pct_travaux'))},"",${B('travaux')}*${H('honoraires_pct_travaux')})`,
    aleas: `IF(${vide(B('travaux'), H('aleas_pct_travaux'))},"",${B('travaux')}*${H('aleas_pct_travaux')})`,
    demolition: secondaire('demolition_eur'),
    vrd: secondaire('vrd_eur'),
    taxes: secondaire('taxes_urbanisme_eur'),
    commercialisation: `IF(${vide(B('ca'), H('commercialisation_pct_ca'))},"",${B('ca')}*${H('commercialisation_pct_ca')})`,
    fraisFinanciers: `IF(${vide(B('ca'), H('frais_financiers_pct_ca'))},"",${B('ca')}*${H('frais_financiers_pct_ca')})`,
    // SUM ignore les « non chiffré » (texte) : ces postes comptent 0, et c'est affiché.
    couts: `IF(${vide(B('travaux'), B('honoraires'), B('aleas'), B('commercialisation'), B('fraisFinanciers'))},"",SUM(${B('travaux')}:${B('fraisFinanciers')}))`,
    margeCible: `IF(${vide(B('ca'), H('marge_cible_pct_ca'))},"",${B('ca')}*${H('marge_cible_pct_ca')})`,
    chargeFonciere: `IF(${vide(B('ca'), B('couts'), H('marge_cible_pct_ca'), H('frais_acquisition_pct_foncier'))},"",(${B('ca')}*(1-${H('marge_cible_pct_ca')})-${B('couts')})/(1+${H('frais_acquisition_pct_foncier')}))`,
    cfM2Terrain: `IF(OR(${B('chargeFonciere')}="",N(${H('surface')})=0),"",${B('chargeFonciere')}/${H('surface')})`,
    cfM2Sdp: `IF(OR(${B('chargeFonciere')}="",N(${H('sdp_m2')})=0),"",${B('chargeFonciere')}/${H('sdp_m2')})`,
    negocie: `IF(${H('negocie')}="","",${H('negocie')})`,
    fraisAcq: `IF(${vide(B('negocie'), H('frais_acquisition_pct_foncier'))},"",${B('negocie')}*${H('frais_acquisition_pct_foncier')})`,
    margeReelle: `IF(${vide(B('negocie'), B('ca'), B('couts'), H('frais_acquisition_pct_foncier'))},"",${B('ca')}-${B('couts')}-${B('negocie')}*(1+${H('frais_acquisition_pct_foncier')}))`,
    margeReellePct: `IF(OR(${B('margeReelle')}="",N(${B('ca')})=0),"",${B('margeReelle')}/${B('ca')})`,
  };
}

export const VARIATIONS_SENSIBILITE = [-0.1, -0.05, 0, 0.05, 0.1] as const;

/** Formule d'une case de l'onglet Sensibilité (terrain n°1 = colonne D). */
export function formuleSensibilite(celPrix: string, celCout: string): string {
  const col = lettre(COL_PREMIER_TERRAIN);
  const H = (c: CleHypothese) => refH(c, col, true);
  const bloquants = `'${FEUILLE_BILAN}'!$${col}$${LIGNES_BILAN.bloquants}`;
  const ca = `(${H('shab_m2')}*(1-N(${H('part_lls_pct')}))*${H('prix_vente_libre_eur_m2_shab')}*(1+${celPrix})`
    + `+IF(N(${H('part_lls_pct')})=0,0,${H('shab_m2')}*${H('part_lls_pct')}*${H('prix_cession_lls_eur_m2_shab')}))`;
  return `IF(${bloquants}>0,"",(${ca}*(1-${H('marge_cible_pct_ca')}-${H('commercialisation_pct_ca')}-${H('frais_financiers_pct_ca')})`
    + `-${H('sdp_m2')}*${H('cout_travaux_eur_m2_sdp')}*(1+${celCout})*(1+${H('honoraires_pct_travaux')}+${H('aleas_pct_travaux')})`
    + `-N(${H('demolition_eur')})-N(${H('vrd_eur')})-N(${H('taxes_urbanisme_eur')}))/(1+${H('frais_acquisition_pct_foncier')}))`;
}

// ── Styles ───────────────────────────────────────────────────────────────────
type Feuille = ExcelJS.Worksheet;
const police = (o: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: POLICE, size: 10.5, color: { argb: ENCRE }, ...o });
const remplir = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const filet: Partial<ExcelJS.Borders> = { bottom: { style: 'hair', color: { argb: 'FFD9D9D9' } } };
const cadreSaisie: Partial<ExcelJS.Borders> = Object.fromEntries(['top', 'bottom', 'left', 'right'].map((k) => [k, { style: 'thin', color: { argb: 'FFE5DCA0' } }]));
const formule = (f: string, r: Nombre | string): ExcelJS.CellFormulaValue => ({ formula: f, result: r == null ? '' : r } as ExcelJS.CellFormulaValue);

function titre(ws: Feuille, texte: string, sousTitre: string, nbCol: number) {
  ws.mergeCells(1, 1, 1, nbCol);
  const c = ws.getCell(1, 1);
  c.value = texte; c.font = police({ size: 15, bold: true, color: { argb: TITRE } }); c.fill = remplir(FOND_TITRE); c.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, nbCol);
  const s = ws.getCell(2, 1);
  s.value = sousTitre; s.font = police({ size: 9.5, italic: true, color: { argb: GRIS } }); s.alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(2).height = Math.max(30, Math.ceil(sousTitre.length / 140) * 14 + 8);
}

function entete(ws: Feuille, ligne: number, valeurs: string[]) {
  const r = ws.getRow(ligne);
  valeurs.forEach((v, i) => {
    const c = r.getCell(i + 1);
    c.value = v; c.font = police({ bold: true, color: { argb: 'FFFFFFFF' } }); c.fill = remplir(VIOLET);
    c.alignment = { wrapText: true, vertical: 'middle', horizontal: i >= 2 ? 'center' : 'left' };
  });
  r.height = 36;
}

function saisie(c: ExcelJS.Cell) {
  c.fill = remplir(SAISIE_FOND);
  c.font = police({ color: { argb: SAISIE_POLICE } });
  c.border = cadreSaisie;
}

const validationPct: ExcelJS.DataValidation = {
  type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 1],
  showErrorMessage: true, errorTitle: 'Pourcentage', error: 'Saisissez un pourcentage entre 0 % et 100 % (par exemple 8 %).',
};

export const enteteTerrain = (t: Pick<TerrainModele, 'rang' | 'idu' | 'adresse'>): string =>
  `#${t.rang} · ${t.idu.length > 8 ? t.idu.slice(-6) : t.idu}${t.adresse ? `\n${t.adresse.split(',')[0]}` : ''}`;

const TERRAIN_VIDE = {
  rang: 1, idu: 'Terrain', adresse: null, surface_m2: null, hypothesesSpecifiques: {}, charge_fonciere: null, sources: [],
} as unknown as TerrainModele;

/** Résultats JS par terrain (mêmes règles que les formules). */
export function resultatsBilan(m: ModeleRapport): ResultatBilan[] {
  const terrains = m.terrains.length ? m.terrains : [TERRAIN_VIDE];
  return terrains.map((t) => calculerBilan(entreesDepuisJeu(hypothesesTerrain(m, t), t.surface_m2)));
}

// ── Onglets ──────────────────────────────────────────────────────────────────

/** Ajoute les 4 onglets du bilan à un classeur (seul, ou à la suite du rapport). */
export function ajouterOngletsBilan(wb: ExcelJS.Workbook, m: ModeleRapport): void {
  const terrains = m.terrains.length ? m.terrains : [TERRAIN_VIDE];
  const n = terrains.length;
  const colT = (i: number) => lettre(COL_PREMIER_TERRAIN + i);
  const colEtat = COL_PREMIER_TERRAIN + n;
  const premier = colT(0), dernier = colT(n - 1);
  const jeux = terrains.map((t) => hypothesesTerrain(m, t));
  const resultats = resultatsBilan(m);
  const mise: Partial<ExcelJS.PageSetup> = {
    paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
  const pied = '&LMimmoza · Bilan promoteur indicatif, à faire valider par un professionnel&R&P / &N';

  // ── Hypothèses ──
  const h = wb.addWorksheet(FEUILLE_HYP, { views: [{ state: 'frozen', xSplit: 3, ySplit: LIGNE_ENTETE, showGridLines: false }], pageSetup: mise });
  h.columns = [{ width: 50 }, { width: 8 }, { width: 18 }, ...terrains.map(() => ({ width: 19 })), { width: 15 }];
  h.headerFooter.oddFooter = pied;
  titre(h, 'Hypothèses du bilan promoteur — modifiables',
    'Cellules jaunes = à saisir ou modifier : tout le classeur se recalcule. Cellule vide = donnée inconnue (« à renseigner »), jamais remplacée par 0 en silence. '
    + 'Chaque colonne de terrain reprend la valeur commune, sauf valeur propre au terrain. Pourcentages : saisir 8 % (ou 0,08). La source de chaque valeur est en commentaire.'
    + (m.hypothesesDepuisTexte ? ' Certaines valeurs ont été reprises du texte du rapport (version 1) : à vérifier.' : ''), colEtat);
  entete(h, LIGNE_ENTETE, ['Hypothèse', 'Unité', 'Valeur commune', ...terrains.map(enteteTerrain), 'État']);
  terrains.forEach((t, i) => { h.getCell(LIGNE_ENTETE, COL_PREMIER_TERRAIN + i).note = `Parcelle ${t.idu}${t.adresse ? ` — ${t.adresse}` : ''}`; });

  const ligneSansCommun = (ligne: number, libelle: string, unite: string) => {
    h.getCell(ligne, 1).value = libelle; h.getCell(ligne, 1).font = police({ bold: true });
    h.getCell(ligne, 2).value = unite; h.getCell(ligne, 2).font = police({ color: { argb: GRIS } });
    const c = h.getCell(ligne, 3); c.value = '—'; c.font = police({ color: { argb: GRIS } }); c.alignment = { horizontal: 'center' }; c.fill = remplir(NEUTRE);
    h.getRow(ligne).height = 20;
  };

  ligneSansCommun(LIGNE_SURFACE, 'Surface du terrain', 'm²');
  terrains.forEach((t, i) => {
    const c = h.getCell(LIGNE_SURFACE, COL_PREMIER_TERRAIN + i);
    if (t.surface_m2 != null) { c.value = t.surface_m2; c.note = 'Source : cadastre (rapport de mission)'; }
    saisie(c); c.numFmt = FORMATS.m2;
  });

  for (const d of DEFINITIONS_HYPOTHESES) {
    const ligne = LIGNE_HYP[d.cle];
    const a = h.getCell(ligne, 1);
    const suffixe = d.role === 'secondaire' ? ' — vide : non compté' : d.role === 'conditionnelle' ? ' — si part sociale > 0' : d.role === 'info' ? ' (information)' : '';
    a.value = d.libelle + suffixe; a.font = police({ bold: d.role === 'essentielle' }); a.alignment = { wrapText: true, vertical: 'middle' };
    h.getCell(ligne, 2).value = LIBELLE_UNITE[d.unite]; h.getCell(ligne, 2).font = police({ color: { argb: GRIS } });
    const commun = m.hypotheses[d.cle];
    const cc = h.getCell(ligne, 3);
    if (commun.valeur != null) { cc.value = commun.valeur; if (commun.source) cc.note = `Source : ${commun.source}`; }
    saisie(cc); cc.numFmt = FORMATS[d.unite];
    if (d.unite === 'pct') cc.dataValidation = validationPct;
    terrains.forEach((t, i) => {
      const c = h.getCell(ligne, COL_PREMIER_TERRAIN + i);
      const spec = t.hypothesesSpecifiques[d.cle];
      if (spec !== undefined) {
        // Valeur propre au terrain (null = inconnue pour ce terrain : cellule vide).
        if (spec.valeur != null) c.value = spec.valeur;
        c.note = `Valeur propre à ce terrain${spec.valeur == null ? ' : inconnue, à renseigner' : ''}. Source : ${spec.source ?? 'non précisée'}`
          + (t.bilan?.justification ? `\nPourquoi : ${t.bilan.justification}` : '');
      } else {
        c.value = formule(`IF($C${ligne}="","",$C${ligne})`, commun.valeur);
      }
      saisie(c); c.numFmt = FORMATS[d.unite];
      if (d.unite === 'pct') c.dataValidation = validationPct;
    });
    const e = h.getCell(ligne, colEtat);
    if (d.requise) {
      const manque = jeux.some((j) => j[d.cle].valeur == null);
      e.value = formule(`IF(COUNTBLANK(${premier}${ligne}:${dernier}${ligne})>0,"à renseigner","")`, manque ? 'à renseigner' : '');
      h.addConditionalFormatting({ ref: `${premier}${ligne}:${dernier}${ligne}`, rules: [{
        type: 'expression', priority: 1, formulae: [`LEN(${premier}${ligne})=0`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: d.role === 'essentielle' ? MANQUE_FORT : MANQUE_LEGER } } },
      }] });
    } else if (d.role === 'conditionnelle') {
      const lls = LIGNE_HYP.part_lls_pct;
      const conds = terrains.map((_, i) => `AND(N(${colT(i)}${lls})>0,${colT(i)}${ligne}="")`).join(',');
      const manque = jeux.some((j) => (j.part_lls_pct.valeur ?? 0) > 0 && j.prix_cession_lls_eur_m2_shab.valeur == null);
      e.value = formule(`IF(OR(${conds}),"à renseigner","")`, manque ? 'à renseigner' : '');
    }
    e.font = police({ bold: true, color: { argb: 'FFB45309' } }); e.alignment = { horizontal: 'center', vertical: 'middle' };
    h.getRow(ligne).height = 20;
  }

  ligneSansCommun(LIGNE_NEGOCIE, 'Prix d’acquisition négocié (si connu)', '€ HT');
  terrains.forEach((_, i) => {
    const c = h.getCell(LIGNE_NEGOCIE, COL_PREMIER_TERRAIN + i);
    saisie(c); c.numFmt = FORMATS.eur;
    c.note = 'Saisissez le prix discuté avec le vendeur : l’onglet « Bilan » calcule alors la marge réelle.';
  });
  h.getCell(LIGNE_GABARIT, 1).value = 'Gabarit visé (information)'; h.getCell(LIGNE_GABARIT, 1).font = police();
  const g = h.getCell(LIGNE_GABARIT, 3); if (m.gabarit) g.value = m.gabarit; saisie(g);
  for (let r = LIGNE_SURFACE; r <= LIGNE_GABARIT; r++) for (let c = 1; c <= colEtat; c++) { const x = h.getCell(r, c); if (!x.border || !Object.keys(x.border).length) x.border = filet; }

  // ── Bilan ──
  const b = wb.addWorksheet(FEUILLE_BILAN, { views: [{ state: 'frozen', xSplit: 3, ySplit: LIGNE_ENTETE, showGridLines: false }], pageSetup: mise });
  b.columns = [{ width: 44 }, { width: 8 }, { width: 42 }, ...terrains.map(() => ({ width: 19 }))];
  b.headerFooter.oddFooter = pied;
  const derniereCol = COL_PREMIER_TERRAIN + n - 1;
  titre(b, 'Bilan promoteur — charge foncière admissible (calcul à rebours)',
    'Tout est calculé par formules à partir de l’onglet « Hypothèses ». Charge foncière admissible = (CA × (1 − marge cible) − coûts hors foncier) ÷ (1 + frais d’acquisition). '
    + 'Si une hypothèse indispensable est vide, le résultat n’est pas affiché ; part sociale, taxes, VRD ou démolition inconnues sont signalées « non chiffré » et comptées 0.'
    + (m.noteBilanIdentique ? ` ${m.noteBilanIdentique}` : ''), derniereCol);
  entete(b, LIGNE_ENTETE, ['Poste', 'Unité', 'Mode de calcul', ...terrains.map(enteteTerrain)]);

  const L = LIGNES_BILAN;
  type Def = [CleFormule, string, string, string, string, (r: ResultatBilan) => Nombre | string, boolean];
  const eur = FORMATS.eur, eurM2 = FORMATS.eur_m2;
  const nc = (v: Nombre) => (v == null ? 'non chiffré' : v);
  const defs: Def[] = [
    ['etat', 'État du bilan', '', '', '@', (r) => libelleEtatBilan(r), true],
    ['postes', 'Postes à renseigner', 'nb', 'Hypothèses encore vides (toutes)', '0', (r) => r.postesManquants, false],
    ['bloquants', 'dont postes indispensables', 'nb', 'Sans eux, pas de charge foncière', '0', (r) => r.postesBloquants, false],
    ['caLibre', 'CA logements libres', '€ HT', 'SHAB × (1 − part LLS) × prix libre', eur, (r) => r.caLibre, false],
    ['caLls', 'CA logements sociaux', '€ HT', 'SHAB × part LLS × prix de cession LLS', eur, (r) => r.caLls, false],
    ['ca', 'Chiffre d’affaires total', '€ HT', 'CA libre + CA LLS', eur, (r) => r.ca, true],
    ['travaux', 'Travaux', '€ HT', 'SDP × coût des travaux', eur, (r) => r.travaux, false],
    ['honoraires', 'Honoraires', '€ HT', 'Travaux × % honoraires', eur, (r) => r.honoraires, false],
    ['aleas', 'Aléas', '€ HT', 'Travaux × % aléas', eur, (r) => r.aleas, false],
    ['demolition', 'Démolition', '€ HT', 'Saisie ; vide = non chiffré (compté 0)', eur, (r) => nc(r.demolition), false],
    ['vrd', 'Voirie et réseaux (VRD)', '€ HT', 'Saisie ; vide = non chiffré (compté 0)', eur, (r) => nc(r.vrd), false],
    ['taxes', 'Taxes d’urbanisme', '€ HT', 'Saisie ; vide = non chiffré (compté 0)', eur, (r) => nc(r.taxes), false],
    ['commercialisation', 'Commercialisation', '€ HT', 'CA × % commercialisation', eur, (r) => r.commercialisation, false],
    ['fraisFinanciers', 'Frais financiers', '€ HT', 'CA × % frais financiers', eur, (r) => r.fraisFinanciers, false],
    ['couts', 'Total coûts hors foncier', '€ HT', 'Somme des postes ci-dessus', eur, (r) => r.coutsHorsFoncier, true],
    ['margeCible', 'Marge cible', '€ HT', 'CA × % marge cible', eur, (r) => r.margeCible, false],
    ['chargeFonciere', 'Charge foncière admissible', '€ HT', '(CA × (1 − marge) − coûts) ÷ (1 + frais d’acquisition)', eur, (r) => r.chargeFonciere, true],
    ['cfM2Terrain', 'Charge foncière par m² de terrain', '€/m²', 'Charge foncière ÷ surface du terrain', eurM2, (r) => r.chargeFonciereM2Terrain, false],
    ['cfM2Sdp', 'Charge foncière par m² de SDP', '€/m²', 'Charge foncière ÷ SDP', eurM2, (r) => r.chargeFonciereM2Sdp, false],
    ['negocie', 'Prix d’acquisition négocié', '€ HT', 'Repris des hypothèses (si saisi)', eur, (r) => r.prixNegocie, false],
    ['fraisAcq', 'Frais d’acquisition', '€ HT', 'Prix négocié × % frais d’acquisition', eur, (r) => r.fraisAcquisition, false],
    ['margeReelle', 'Marge réelle', '€ HT', 'CA − coûts − prix négocié × (1 + frais)', eur, (r) => r.margeReelle, true],
    ['margeReellePct', 'Marge réelle en % du CA', '%', 'Marge réelle ÷ CA', FORMATS.pct, (r) => r.margeReellePct, true],
  ];
  const sousTitres: [CleLigne, string][] = [['titreCa', 'Chiffre d’affaires'], ['titreCouts', 'Coûts hors foncier'], ['titreResultat', 'Résultat'], ['titreNego', 'Si un prix d’acquisition est négocié']];
  for (const [k, t] of sousTitres) {
    b.mergeCells(L[k], 1, L[k], derniereCol);
    const c = b.getCell(L[k], 1); c.value = t; c.font = police({ bold: true, size: 11.5, color: { argb: TITRE } }); c.fill = remplir(FOND_TITRE);
    b.getRow(L[k]).height = 22;
  }
  for (const [k, libelle, unite, mode] of defs) {
    b.getCell(L[k], 1).value = libelle; b.getCell(L[k], 1).font = police({ bold: ['ca', 'couts', 'chargeFonciere', 'margeReelle', 'etat'].includes(k) });
    b.getCell(L[k], 2).value = unite; b.getCell(L[k], 2).font = police({ color: { argb: GRIS } });
    const mc = b.getCell(L[k], 3); mc.value = mode; mc.font = police({ size: 9, color: { argb: GRIS } }); mc.alignment = { wrapText: true, vertical: 'middle' };
    b.getRow(L[k]).height = 20;
  }
  terrains.forEach((t, i) => {
    const f = formulesBilan(colT(i));
    for (const [k, , , , fmt, val, gras] of defs) {
      const c = b.getCell(L[k], COL_PREMIER_TERRAIN + i);
      c.value = formule(f[k], val(resultats[i]));
      c.numFmt = fmt; c.font = police({ bold: gras }); c.border = filet;
      c.alignment = k === 'etat' ? { wrapText: true, horizontal: 'center', vertical: 'middle' } : { horizontal: 'right' };
      if (k === 'chargeFonciere') c.fill = remplir('FFEDE9FE');
    }
    const r = b.getCell(L.cfRapport, COL_PREMIER_TERRAIN + i);
    if (t.charge_fonciere != null) { r.value = t.charge_fonciere; r.note = 'Valeur indiquée dans le rapport de mission, pour comparaison. Elle n’est pas recalculée.'; }
    r.numFmt = eur; r.font = police({ italic: true, color: { argb: GRIS } }); r.alignment = { horizontal: 'right' }; r.border = filet;
  });
  b.getCell(L.cfRapport, 1).value = 'Charge foncière annoncée dans le rapport (référence)'; b.getCell(L.cfRapport, 1).font = police({ italic: true, color: { argb: GRIS } });
  b.getCell(L.cfRapport, 2).value = '€ HT'; b.getCell(L.cfRapport, 2).font = police({ color: { argb: GRIS } });
  b.getCell(L.cfRapport, 3).value = 'Valeur du rapport, non recalculée'; b.getCell(L.cfRapport, 3).font = police({ size: 9, color: { argb: GRIS } });
  b.getRow(L.etat).height = 46;
  b.addConditionalFormatting({ ref: `${premier}${L.etat}:${dernier}${L.etat}`, rules: [
    { type: 'expression', priority: 1, formulae: [`${premier}${L.bloquants}>0`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEE2E2' } }, font: { color: { argb: 'FFB91C1C' }, bold: true } } },
    { type: 'expression', priority: 2, formulae: [`${premier}${L.postes}>0`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEF3C7' } }, font: { color: { argb: 'FFB45309' }, bold: true } } },
    { type: 'expression', priority: 3, formulae: [`${premier}${L.postes}=0`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFDCFCE7' } }, font: { color: { argb: 'FF047857' }, bold: true } } },
  ] });

  // ── Sensibilité ──
  const s = wb.addWorksheet(FEUILLE_SENSI, { views: [{ showGridLines: false }], pageSetup: mise });
  s.columns = [{ width: 3 }, { width: 30 }, ...VARIATIONS_SENSIBILITE.map(() => ({ width: 18 }))];
  s.headerFooter.oddFooter = pied;
  const t1 = terrains[0];
  titre(s, `Sensibilité — charge foncière admissible du terrain n°${t1.rang} (${t1.idu})`,
    'Lignes : variation du prix de vente libre. Colonnes : variation du coût des travaux. Les variations (cellules jaunes) sont modifiables. '
    + 'La case centrale (0 % / 0 %) est égale à la charge foncière de l’onglet « Bilan ». Vide tant qu’une hypothèse indispensable manque.', 2 + VARIATIONS_SENSIBILITE.length);
  const LS = 4;
  const coin = s.getCell(LS, 2); coin.value = 'Prix de vente ↓  /  Coût des travaux →';
  coin.font = police({ bold: true, color: { argb: 'FFFFFFFF' } }); coin.fill = remplir(VIOLET); coin.alignment = { wrapText: true, vertical: 'middle' };
  s.getRow(LS).height = 34;
  const e1 = entreesDepuisJeu(jeux[0], t1.surface_m2);
  const fmtVar = '+0%;-0%;0%';
  VARIATIONS_SENSIBILITE.forEach((dc, j) => {
    const c = s.getCell(LS, 3 + j); c.value = dc; saisie(c); c.numFmt = fmtVar; c.font = police({ bold: true, color: { argb: SAISIE_POLICE } }); c.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  VARIATIONS_SENSIBILITE.forEach((dp, i) => {
    const ligne = LS + 1 + i;
    const v = s.getCell(ligne, 2); v.value = dp; saisie(v); v.numFmt = fmtVar; v.font = police({ bold: true, color: { argb: SAISIE_POLICE } }); v.alignment = { horizontal: 'center' };
    VARIATIONS_SENSIBILITE.forEach((dc, j) => {
      const c = s.getCell(ligne, 3 + j);
      c.value = formule(formuleSensibilite(`$B${ligne}`, `${lettre(3 + j)}$${LS}`), chargeFonciereSensibilite(e1, dp, dc));
      c.numFmt = FORMATS.eur; c.border = filet; c.alignment = { horizontal: 'right' };
      const centre = dp === 0 && dc === 0;
      c.font = police({ bold: centre }); if (centre) c.fill = remplir('FFEDE9FE');
    });
    s.getRow(ligne).height = 22;
  });
  const fin = lettre(2 + VARIATIONS_SENSIBILITE.length);
  s.addConditionalFormatting({ ref: `C${LS + 1}:${fin}${LS + VARIATIONS_SENSIBILITE.length}`, rules: [
    { type: 'expression', priority: 1, formulae: [`AND(ISNUMBER(C${LS + 1}),C${LS + 1}<0)`], style: { font: { color: { argb: 'FFB91C1C' } } } },
  ] });

  // ── Sources & limites ──
  const src = wb.addWorksheet(FEUILLE_SOURCES, { views: [{ showGridLines: false }], pageSetup: { ...mise, orientation: 'portrait' } });
  src.columns = [{ width: 88 }];
  src.headerFooter.oddFooter = pied;
  titre(src, 'Sources, limites et mode d’emploi', `${m.titre} — ${m.dateAffichee}`, 1);
  const bloc = (titreBloc: string, lignes: string[]) => {
    if (!lignes.length) return;
    src.addRow([]);
    const r = src.addRow([titreBloc]); r.getCell(1).font = police({ bold: true, size: 12, color: { argb: TITRE } }); r.getCell(1).fill = remplir(FOND_TITRE); r.height = 20;
    for (const l of lignes) {
      const x = src.addRow([l]); x.getCell(1).font = police(); x.getCell(1).alignment = { wrapText: true, vertical: 'top' };
      x.height = Math.max(18, Math.ceil(l.length / 82) * 15 + 4);
    }
  };
  bloc('Mode d’emploi', [
    '1. Onglet « Hypothèses » : modifiez les cellules jaunes (valeur commune, ou valeur propre d’un terrain). Orange = indispensable et vide ; jaune foncé = non chiffré (compté 0).',
    '2. Onglet « Bilan » : chiffre d’affaires, coûts, charge foncière admissible et, si vous saisissez un prix négocié, la marge réelle.',
    '3. Onglet « Sensibilité » : effet d’une variation du prix de vente et du coût des travaux sur la charge foncière du terrain n°1.',
    'Pour qu’un terrain reprenne la valeur commune, recopiez la formule d’une cellule voisine de la même ligne (=SI($C…="";"";$C…)).',
  ]);
  bloc('Sources des hypothèses communes', DEFINITIONS_HYPOTHESES.map((d) => {
    const v = m.hypotheses[d.cle];
    return `${d.libelle} : ${v.valeur == null ? 'à renseigner' : v.source ?? 'source non précisée'}`;
  }));
  const specifiques = terrains.flatMap((t) => Object.entries(t.hypothesesSpecifiques).map(([k, v]) => {
    const d = DEFINITIONS_HYPOTHESES.find((x) => x.cle === k);
    return d && v ? `#${t.rang} ${t.idu} — ${d.libelle} : ${v.valeur == null ? 'inconnue pour ce terrain' : v.source ?? 'source non précisée'}` : '';
  }).filter(Boolean));
  bloc('Hypothèses propres à un terrain', specifiques);
  bloc('Sources par terrain', terrains.map((t) => `#${t.rang} ${t.idu} : ${t.sources.length ? t.sources.join(' ; ') : 'non précisées'}`));
  if (m.noteBilanIdentique) bloc('À savoir', [m.noteBilanIdentique]);
  bloc('Limites', m.limites);
  bloc('Avertissement', [m.avertissement]);
}

export function preparerClasseur(wb: ExcelJS.Workbook, m: ModeleRapport): void {
  wb.creator = 'Mimmoza';
  wb.title = m.titre;
  const d = new Date(m.dateIso);
  wb.created = Number.isFinite(d.getTime()) ? d : new Date();
  // Recalcul complet à l'ouverture : les valeurs en cache ne sont qu'un filet.
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true };
}

export function construireClasseurBilan(m: ModeleRapport): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  preparerClasseur(wb, m);
  ajouterOngletsBilan(wb, m);
  return wb;
}
