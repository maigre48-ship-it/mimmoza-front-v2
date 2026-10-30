// src/spaces/copilot/agent/rapport/rapportWord.ts
// Export Word (docx) du rapport de mission. Même charte que les exports
// existants du chat (exports/exportWord.ts) : Aptos, tableaux à en-tête foncé.
import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, PageBreak, PageNumber, Paragraph, ShadingType,
  Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
} from 'docx';
import { DEFINITIONS_HYPOTHESES, fEur, fEurM2, fM2, fNb, formatHypothese, type ModeleRapport, type TerrainModele } from './rapportModele.ts';
import { LIBELLE_QUALITE_CONTACT, proprietaireTexte } from './rapportTexte.ts';

const LARGEUR = 9360; // A4, marges ~2,2 cm (twips)
const VIOLET = '6D5DFC', NUIT = '233451', GRIS = '5B5F78';

const titre = (texte: string, niveau: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1, sautAvant = false) =>
  new Paragraph({ text: texte, heading: niveau, keepNext: true, pageBreakBefore: sautAvant, spacing: { before: 200, after: 120 } });
const para = (texte: string, o: { petit?: boolean; gris?: boolean; gras?: boolean; italique?: boolean } = {}) =>
  new Paragraph({ spacing: { after: 120, line: 290 }, children: [new TextRun({ text: texte, size: o.petit ? 18 : 21, color: o.gris ? GRIS : '172238', bold: o.gras, italics: o.italique })] });
const puce = (texte: string) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: texte, size: 20 })] });

function table(colonnes: string[], lignes: string[][], poids?: number[]): Table {
  const p = poids ?? colonnes.map((c, i) => Math.max(8, Math.min(40, Math.max(c.length, ...lignes.map((l) => (l[i] ?? '').length)))));
  const total = p.reduce((a, b) => a + b, 0);
  const largeurs = p.map((x) => Math.round((LARGEUR * x) / total));
  const bord = { style: BorderStyle.SINGLE, size: 4, color: 'DDDDE8' };
  const toutes = [colonnes, ...lignes];
  return new Table({
    width: { size: LARGEUR, type: WidthType.DXA }, columnWidths: largeurs, layout: TableLayoutType.FIXED,
    borders: { top: bord, bottom: bord, left: bord, right: bord, insideHorizontal: bord, insideVertical: bord },
    rows: toutes.map((ligne, r) => new TableRow({
      tableHeader: r === 0, cantSplit: true,
      children: ligne.map((texte, c) => new TableCell({
        width: { size: largeurs[c], type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: r === 0 ? NUIT : r % 2 ? 'FFFFFF' : 'F6F5FF' },
        children: [new Paragraph({
          alignment: r > 0 && /^[\d\s.,%€/m²+−-]+$/.test(texte) && /\d/.test(texte) ? AlignmentType.RIGHT : AlignmentType.LEFT,
          spacing: { after: 0, line: 250 },
          children: [new TextRun({ text: texte, size: 17, bold: r === 0, color: r === 0 ? 'FFFFFF' : '172238' })],
        })],
      })),
    })),
  });
}

function couverture(m: ModeleRapport): Paragraph[] {
  return [
    new Paragraph({ spacing: { before: 1800, after: 120 }, children: [new TextRun({ text: 'MIMMOZA', bold: true, size: 28, color: VIOLET, characterSpacing: 60 })] }),
    new Paragraph({ spacing: { after: 360 }, children: [new TextRun({ text: 'Rapport de mission · agent MimmozIA', size: 22, color: GRIS })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 360 }, children: [new TextRun({ text: m.titre })] }),
    ...(m.objectif ? [para('Objectif de la mission', { gras: true }), para(m.objectif)] : []),
    para(`Date : ${m.dateAffichee}${m.commune ? ` · Commune : ${m.commune}` : ''} · ${m.terrains.length} terrain${m.terrains.length > 1 ? 's' : ''} étudié${m.terrains.length > 1 ? 's' : ''}`, { gris: true }),
    new Paragraph({ spacing: { before: 600 }, border: { top: { style: BorderStyle.SINGLE, size: 6, color: VIOLET, space: 8 } }, children: [new TextRun({ text: m.avertissement, size: 18, italics: true, color: GRIS })] }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function ficheTerrain(t: TerrainModele): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [titre(`#${t.rang} — ${t.idu}${t.adresse ? ` — ${t.adresse}` : ''}`, HeadingLevel.HEADING_2)];
  const infos: [string, string][] = [
    ['Verdict', t.verdict ?? '—'], ['Surface', fM2(t.surface_m2)],
    ['Zonage', [t.zonageCode, t.zonageLibelle].filter(Boolean).join(' — ') || '—'],
    ['Propriétaire', `${proprietaireTexte(t)}${t.proprietaire?.source ? ` (source : ${t.proprietaire.source})` : ''}`],
    ['Logements possibles', fNb(t.potentiel_logements)],
    ['Charge foncière admissible', fEur(t.charge_fonciere)],
    ['Par m² de terrain', `${fEurM2(t.charge_fonciere_m2)}${t.cfM2Calculee ? ' (charge ÷ surface)' : ''}`],
  ];
  if (t.score != null) infos.splice(1, 0, ['Score', fNb(t.score)]);
  if (t.bilan) {
    infos.push(['Bilan', t.bilan.statut === 'complet' ? 'Complet' : 'Partiel']);
    if (t.bilan.ca_ht != null) infos.push(['Chiffre d’affaires HT', fEur(t.bilan.ca_ht)]);
    if (t.bilan.couts_hors_foncier_ht != null) infos.push(['Coûts hors foncier HT', fEur(t.bilan.couts_hors_foncier_ht)]);
    if (t.bilan.justification) infos.push(['Hypothèses propres au terrain', t.bilan.justification]);
  }
  out.push(table(['Élément', 'Valeur'], infos, [30, 70]));
  const liste = (nom: string, items: string[]) => { if (items.length) out.push(para(nom, { gras: true }), ...items.map(puce)); };
  liste('Points forts', t.points_forts);
  liste('Points bloquants', t.points_bloquants);
  liste('Contraintes', t.contraintes.map((c) => `${c.type} : ${c.libelle}${c.source ? ` (source : ${c.source})` : ''}`));
  if (t.bilan?.manques.length) liste('À renseigner pour le bilan', t.bilan.manques);
  if (t.sources.length) out.push(para(`Sources : ${t.sources.join(' ; ')}`, { petit: true, gris: true }));
  return out;
}

export function construireWordRapport(m: ModeleRapport): Document {
  const enfants: (Paragraph | Table)[] = [...couverture(m)];
  enfants.push(titre('Synthèse'), ...m.synthese.map((p) => para(p)));
  if (m.noteBilanIdentique) enfants.push(para(m.noteBilanIdentique, { italique: true, gris: true }));
  if (m.classement.length) {
    enfants.push(titre('Classement'), table(['Rang', 'Parcelle', 'Justification'], m.classement.map((c) => [String(c.rang), c.idu, c.justification ?? '—']), [8, 22, 70]));
  }
  if (m.terrains.length) {
    enfants.push(titre('Tableau comparatif'), table(
      ['Rang', 'Parcelle', 'Surface', 'Zonage', 'Propriétaire', 'Charge foncière', '€/m² terrain', 'Verdict'],
      m.terrains.map((t) => [String(t.rang), t.idu.slice(-6), fM2(t.surface_m2), t.zonageCode ?? '—', proprietaireTexte(t), fEur(t.charge_fonciere), fEurM2(t.charge_fonciere_m2), t.verdict ?? '—']),
      [8, 11, 11, 12, 23, 14, 12, 11],
    ));
    enfants.push(titre('Fiches des terrains', HeadingLevel.HEADING_1, true));
    m.terrains.forEach((t) => enfants.push(...ficheTerrain(t)));
  }
  enfants.push(titre('Hypothèses du bilan', HeadingLevel.HEADING_1, true));
  if (m.hypothesesDepuisTexte) enfants.push(para('Certaines valeurs ont été reprises du texte du rapport : à vérifier.', { italique: true, gris: true }));
  enfants.push(table(['Hypothèse', 'Valeur', 'Source'], DEFINITIONS_HYPOTHESES.map((d) => [d.libelle, formatHypothese(d, m.hypotheses[d.cle].valeur), m.hypotheses[d.cle].source ?? '—']), [40, 18, 42]));
  enfants.push(para('Le bilan modifiable (Excel, avec formules) permet de changer ces hypothèses terrain par terrain.', { petit: true, gris: true }));
  if (m.contacts.length) {
    enfants.push(titre('Contacts'), table(['Qualité', 'Nom', 'Téléphone', 'E-mail', 'Adresse', 'Source'],
      m.contacts.map((c) => [LIBELLE_QUALITE_CONTACT[c.qualite] ?? c.qualite, c.nom, c.telephone ?? '—', c.email ?? '—', c.adresse ?? '—', c.source ?? '—'])));
  }
  if (m.sources.length) enfants.push(titre('Sources'), ...m.sources.map(puce));
  if (m.limites.length) enfants.push(titre('Limites'), ...m.limites.map(puce));
  enfants.push(titre('Avertissement'), para(m.avertissement, { italique: true }));

  return new Document({
    creator: 'Mimmoza', title: m.titre, description: 'Rapport de mission de l’agent MimmozIA',
    styles: {
      default: { document: { run: { font: 'Aptos', size: 21, color: '172238' } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', run: { font: 'Aptos Display', size: 44, bold: true, color: NUIT } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', run: { size: 30, bold: true, color: NUIT } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', run: { size: 25, bold: true, color: VIOLET } },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1100, bottom: 1100, left: 1273, right: 1273 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
        new TextRun({ text: 'Mimmoza · Étude indicative, à faire valider par un professionnel · ', size: 16, color: '64748B' }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '64748B' }),
      ] })] }) },
      children: enfants,
    }],
  });
}
