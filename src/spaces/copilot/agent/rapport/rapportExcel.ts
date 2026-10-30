// src/spaces/copilot/agent/rapport/rapportExcel.ts
// Export Excel du rapport de mission : onglets « Rapport », « Comparatif »,
// « Fiches terrains », « Contacts », SUIVIS des onglets du bilan modifiable
// (Hypothèses, Bilan, Sensibilité, Sources & limites).
import ExcelJS from 'exceljs';
import { ajouterOngletsBilan, preparerClasseur, FORMATS } from './bilanExcel.ts';
import { DEFINITIONS_HYPOTHESES, formatHypothese, type ModeleRapport, type TerrainModele } from './rapportModele.ts';
import { LIBELLE_QUALITE_CONTACT, proprietaireTexte } from './rapportTexte.ts';

const VIOLET = 'FF6D5DFC', TITRE = 'FF233451', GRIS = 'FF5B5F78', FOND_TITRE = 'FFF1EFFF', ENCRE = 'FF172238';
const police = (o: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: 'Aptos', size: 10.5, color: { argb: ENCRE }, ...o });
const remplir = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const filet: Partial<ExcelJS.Borders> = { bottom: { style: 'hair', color: { argb: 'FFD9D9D9' } } };
type Valeur = string | number | null;

function feuille(wb: ExcelJS.Workbook, nom: string, largeurs: number[], paysage: boolean, ySplit = 0): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(nom, {
    views: [{ showGridLines: false, ...(ySplit ? { state: 'frozen' as const, ySplit } : {}) }],
    pageSetup: { paperSize: 9, orientation: paysage ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = largeurs.map((width) => ({ width }));
  ws.headerFooter.oddFooter = '&LMimmoza · Étude indicative, à faire valider par un professionnel&R&P / &N';
  return ws;
}

function ligneTexte(ws: ExcelJS.Worksheet, texte: string, style: 'titre' | 'section' | 'texte' | 'note' = 'texte') {
  const r = ws.addRow([texte]);
  ws.mergeCells(r.number, 1, r.number, ws.columnCount);
  const c = r.getCell(1);
  c.alignment = { wrapText: true, vertical: 'top' };
  if (style === 'titre') { c.font = police({ size: 16, bold: true, color: { argb: TITRE } }); c.fill = remplir(FOND_TITRE); r.height = 34; return; }
  if (style === 'section') { c.font = police({ size: 12.5, bold: true, color: { argb: TITRE } }); c.fill = remplir(FOND_TITRE); r.height = 22; return; }
  c.font = style === 'note' ? police({ size: 9.5, italic: true, color: { argb: GRIS } }) : police();
  const largeur = ws.columns.reduce((s, col) => s + (col.width ?? 10), 0);
  r.height = Math.max(18, Math.ceil(texte.length / (largeur * 1.1)) * 15 + 4);
}

function tableau(ws: ExcelJS.Worksheet, colonnes: string[], lignes: Valeur[][], formats: (string | null)[] = []) {
  const h = ws.addRow(colonnes);
  h.height = 30;
  h.eachCell((c) => { c.font = police({ bold: true, color: { argb: 'FFFFFFFF' } }); c.fill = remplir(VIOLET); c.alignment = { wrapText: true, vertical: 'middle' }; });
  lignes.forEach((valeurs, i) => {
    const r = ws.addRow(valeurs.map((v) => v ?? '—'));
    r.eachCell({ includeEmpty: true }, (c, col) => {
      c.font = police(); c.border = filet; c.alignment = { wrapText: true, vertical: 'top' };
      if (i % 2) c.fill = remplir('FFF8F7FF');
      const f = formats[col - 1];
      if (f && typeof valeurs[col - 1] === 'number') { c.numFmt = f; c.alignment = { horizontal: 'right', vertical: 'top' }; }
    });
    const plusLong = Math.max(...valeurs.map((v, k) => String(v ?? '').length / Math.max(8, (ws.getColumn(k + 1).width ?? 12) - 2)));
    r.height = Math.min(300, Math.max(18, Math.ceil(plusLong) * 14 + 4));
  });
  ws.addRow([]);
}

export function lignesComparatif(m: ModeleRapport): Valeur[][] {
  return m.terrains.map((t) => [
    t.rang, t.idu, [t.adresse, t.commune].filter(Boolean).join(', ') || null, t.surface_m2, t.zonageCode,
    proprietaireTexte(t), t.charge_fonciere, t.charge_fonciere_m2, t.verdict,
  ]);
}
export const COLONNES_COMPARATIF = ['Rang', 'Parcelle', 'Adresse', 'Surface', 'Zonage', 'Propriétaire', 'Charge foncière admissible', 'Par m² de terrain', 'Verdict'];

function fiche(ws: ExcelJS.Worksheet, t: TerrainModele) {
  ligneTexte(ws, `#${t.rang} — ${t.idu}${t.adresse ? ` — ${t.adresse}` : ''}`, 'section');
  const infos: [string, Valeur, string | null][] = [
    ['Commune', t.commune, null], ['Surface', t.surface_m2, FORMATS.m2], ['Zonage', [t.zonageCode, t.zonageLibelle].filter(Boolean).join(' — ') || null, null],
    ['Verdict', t.verdict, null], ['Score', t.score, '0.0'], ['Logements possibles', t.potentiel_logements, '0'],
    ['Propriétaire', proprietaireTexte(t), null], ['Charge foncière admissible', t.charge_fonciere, FORMATS.eur],
    ['Charge foncière par m² de terrain', t.charge_fonciere_m2, FORMATS.eur_m2],
  ];
  if (t.bilan) {
    infos.push(['Bilan (moteur)', t.bilan.statut === 'complet' ? 'Complet' : 'Partiel', null]);
    if (t.bilan.ca_ht != null) infos.push(['Chiffre d’affaires HT', t.bilan.ca_ht, FORMATS.eur]);
    if (t.bilan.couts_hors_foncier_ht != null) infos.push(['Coûts hors foncier HT', t.bilan.couts_hors_foncier_ht, FORMATS.eur]);
    if (t.bilan.justification) infos.push(['Hypothèses propres', t.bilan.justification, null]);
  }
  for (const [k, v, f] of infos) {
    const r = ws.addRow([k, v ?? '—']);
    ws.mergeCells(r.number, 2, r.number, ws.columnCount);
    r.getCell(1).font = police({ bold: true, color: { argb: GRIS } });
    const c = r.getCell(2); c.font = police(); c.alignment = { wrapText: true, horizontal: 'left' };
    if (f && typeof v === 'number') c.numFmt = f;
  }
  const liste = (titreListe: string, items: string[]) => {
    if (!items.length) return;
    const r = ws.addRow([titreListe]); r.getCell(1).font = police({ bold: true });
    for (const it of items) ligneTexte(ws, `• ${it}`);
  };
  liste('Points forts', t.points_forts);
  liste('Points bloquants', t.points_bloquants);
  liste('Contraintes', t.contraintes.map((c) => `${c.type} : ${c.libelle}${c.source ? ` (source : ${c.source})` : ''}`));
  if (t.bilan?.manques.length) liste('À renseigner pour le bilan', t.bilan.manques);
  if (t.sources.length) ligneTexte(ws, `Sources : ${t.sources.join(' ; ')}`, 'note');
  ws.addRow([]);
}

export function construireClasseurRapport(m: ModeleRapport): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  preparerClasseur(wb, m);

  const r = feuille(wb, 'Rapport', [26, 22, 22, 22, 22], false);
  ligneTexte(r, m.titre, 'titre');
  ligneTexte(r, `Mimmoza · ${m.dateAffichee}${m.commune ? ` · ${m.commune}` : ''}`, 'note');
  if (m.objectif) { ligneTexte(r, 'Objectif', 'section'); ligneTexte(r, m.objectif); }
  ligneTexte(r, 'Synthèse', 'section');
  m.synthese.forEach((p) => ligneTexte(r, p));
  if (m.noteBilanIdentique) ligneTexte(r, m.noteBilanIdentique, 'note');
  if (m.classement.length) {
    ligneTexte(r, 'Classement', 'section');
    tableau(r, ['Rang', 'Parcelle', 'Justification'], m.classement.map((c) => [c.rang, c.idu, c.justification]));
    r.mergeCells(r.rowCount - m.classement.length - 1, 3, r.rowCount - m.classement.length - 1, 5);
  }
  ligneTexte(r, 'Hypothèses communes du bilan', 'section');
  tableau(r, ['Hypothèse', 'Valeur', 'Source'], DEFINITIONS_HYPOTHESES.map((d) => [d.libelle, formatHypothese(d, m.hypotheses[d.cle].valeur), m.hypotheses[d.cle].source]));
  ligneTexte(r, 'Les onglets « Hypothèses », « Bilan » et « Sensibilité » permettent de modifier ces hypothèses : tout se recalcule.', 'note');
  ligneTexte(r, 'Avertissement', 'section');
  ligneTexte(r, m.avertissement, 'note');

  const c = feuille(wb, 'Comparatif', [7, 18, 30, 12, 14, 30, 18, 14, 14], true, 1);
  tableau(c, COLONNES_COMPARATIF, lignesComparatif(m), [null, null, null, FORMATS.m2, null, null, FORMATS.eur, FORMATS.eur_m2, null]);

  const f = feuille(wb, 'Fiches terrains', [30, 30, 30, 30], false);
  m.terrains.forEach((t) => fiche(f, t));
  if (!m.terrains.length) ligneTexte(f, 'Aucun terrain dans ce rapport.');

  if (m.contacts.length) {
    const k = feuille(wb, 'Contacts', [16, 28, 16, 28, 34, 26], true, 1);
    tableau(k, ['Qualité', 'Nom', 'Téléphone', 'E-mail', 'Adresse', 'Source'],
      m.contacts.map((x) => [LIBELLE_QUALITE_CONTACT[x.qualite] ?? x.qualite, x.nom, x.telephone, x.email, x.adresse, x.source]));
  }

  ajouterOngletsBilan(wb, m);
  return wb;
}
