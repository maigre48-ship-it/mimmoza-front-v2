// src/spaces/copilot/agent/rapport/rapportPdf.ts
// Export PDF du rapport de mission (jsPDF + jspdf-autotable), charte des PDF
// « premium » de Mimmoza (palette indigo/violet, cartes, en-têtes discrets).
// Construit dans le navigateur, sans appel serveur. Le texte passe par
// textePdf() : la police standard des PDF ne sait pas dessiner ≈, −, →…
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DEFINITIONS_HYPOTHESES, fEur, fEurM2, fM2, fNb, formatHypothese, type ModeleRapport, type TerrainModele, type TonVerdict } from './rapportModele.ts';
import { LIBELLE_QUALITE_CONTACT, proprietaireTexte, textePdf as T } from './rapportTexte.ts';

type RGB = [number, number, number];
const C: Record<string, RGB> = {
  indigo900: [49, 46, 129], violet: [109, 93, 252], violet600: [124, 58, 237], violet100: [237, 233, 254], violet50: [245, 243, 255],
  nuit: [35, 52, 81], encre: [23, 34, 56], gris: [91, 95, 120], gris2: [148, 163, 184], trait: [226, 232, 240], blanc: [255, 255, 255],
  vert: [4, 120, 87], vertFond: [236, 253, 245], orange: [180, 83, 9], orangeFond: [255, 251, 235], rouge: [185, 28, 28], rougeFond: [254, 242, 242],
};
const TON: Record<TonVerdict, [RGB, RGB]> = {
  bon: [C.vert, C.vertFond], moyen: [C.orange, C.orangeFond], mauvais: [C.rouge, C.rougeFond], neutre: [C.gris, C.violet50],
};

const PW = 210, PH = 297, ML = 16, CW = PW - 2 * ML, HAUT = 24, BAS = PH - 16;

export interface OptionsPdf {
  /** Logo Mimmoza en data URL (PNG) ; sans logo, le nom est écrit en toutes lettres. */
  logo?: { dataUrl: string; aspect: number } | null;
}

export function construirePdfRapport(m: ModeleRapport, options: OptionsPdf = {}): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: T(m.titre), creator: 'Mimmoza', subject: 'Rapport de mission MimmozIA' });
  let y = HAUT;

  const police = (taille: number, style: 'normal' | 'bold' | 'italic' = 'normal', couleur: RGB = C.encre) => {
    doc.setFont('helvetica', style); doc.setFontSize(taille); doc.setTextColor(...couleur);
  };
  const entetePage = () => {
    // L'en-tête ne doit pas changer la police du texte en cours (sinon la suite s'écrit en gris).
    const f = doc.getFont(), taille = doc.getFontSize(), couleur = doc.getTextColor();
    police(7.5, 'bold', C.violet); doc.text('MIMMOZA', ML, 12);
    police(7.5, 'normal', C.gris2);
    const t = T(m.titre);
    doc.text(t.length > 95 ? t.slice(0, 92) + '...' : t, PW - ML, 12, { align: 'right' });
    doc.setDrawColor(...C.trait); doc.setLineWidth(0.2); doc.line(ML, 15, PW - ML, 15);
    doc.setFont(f.fontName, f.fontStyle); doc.setFontSize(taille); doc.setTextColor(couleur);
  };
  const nouvellePage = () => { doc.addPage(); entetePage(); y = HAUT; };
  const place = (h: number) => { if (y + h > BAS) nouvellePage(); };

  const section = (titre: string) => {
    place(16);
    y += 3;
    doc.setFillColor(...C.violet); doc.rect(ML, y - 4.2, 1.4, 6, 'F');
    police(13, 'bold', C.nuit); doc.text(T(titre), ML + 4, y);
    y += 6;
  };
  const sousTitre = (titre: string) => { place(10); police(10, 'bold', C.nuit); doc.text(T(titre), ML, y); y += 5; };
  const paragraphe = (texte: string, taille = 9.5, couleur: RGB = C.encre, style: 'normal' | 'italic' = 'normal', retrait = 0) => {
    police(taille, style, couleur);
    const lignes = doc.splitTextToSize(T(texte), CW - retrait) as string[];
    const h = taille * 0.42;
    for (const l of lignes) { place(h); doc.text(l, ML + retrait, y); y += h; }
    y += 2;
  };
  const puces = (items: string[], taille = 9) => {
    for (const it of items) {
      police(taille, 'normal', C.encre);
      const lignes = doc.splitTextToSize(T(it), CW - 5) as string[];
      const h = taille * 0.42;
      place(h * Math.min(lignes.length, 3));
      doc.setFillColor(...C.violet); doc.circle(ML + 1.2, y - 1.1, 0.7, 'F');
      for (const l of lignes) { place(h); doc.text(l, ML + 4, y); y += h; }
      y += 0.8;
    }
    y += 1.5;
  };
  const tableau = (tete: string[], corps: string[][], o: { largeurs?: number[]; taille?: number; colVerdict?: number; tons?: TonVerdict[] } = {}) => {
    autoTable(doc, {
      startY: y, head: [tete.map(T)], body: corps.map((l) => l.map(T)),
      margin: { left: ML, right: ML, top: HAUT, bottom: PH - BAS },
      styles: { font: 'helvetica', fontSize: o.taille ?? 8.3, cellPadding: 1.8, textColor: C.encre, lineColor: C.trait, lineWidth: 0.15, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: C.nuit, textColor: C.blanc, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: C.violet50 },
      columnStyles: Object.fromEntries((o.largeurs ?? []).map((w, i) => [i, { cellWidth: w }])),
      didParseCell: (d) => {
        if (d.section === 'body' && o.colVerdict != null && d.column.index === o.colVerdict && o.tons) {
          const [txt, fond] = TON[o.tons[d.row.index] ?? 'neutre'];
          d.cell.styles.textColor = txt; d.cell.styles.fillColor = fond; d.cell.styles.fontStyle = 'bold';
        }
      },
      // En-tête redessiné sur chaque page que le tableau occupe (identique, sans effet sur la page en cours).
      didDrawPage: () => entetePage(),
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
  };

  // ── Page de garde ──
  const bandes = 60;
  for (let i = 0; i < bandes; i++) {
    const t = i / (bandes - 1);
    doc.setFillColor(Math.round(49 + (124 - 49) * t), Math.round(46 + (58 - 46) * t), Math.round(129 + (237 - 129) * t));
    doc.rect((PW / bandes) * i, 0, PW / bandes + 0.4, 74, 'F');
  }
  if (options.logo?.dataUrl) {
    const h = 12, w = Math.min(60, h * (options.logo.aspect || 3.2));
    doc.setFillColor(...C.blanc); doc.roundedRect(ML - 2, 14, w + 4, h + 4, 2, 2, 'F');
    doc.addImage(options.logo.dataUrl, 'PNG', ML, 16, w, h);
  } else {
    police(16, 'bold', C.blanc); doc.text('MIMMOZA', ML, 26);
  }
  police(9, 'bold', C.violet100); doc.text('RAPPORT DE MISSION  ·  AGENT MIMMOZIA', ML, 44);
  police(9, 'normal', C.violet100); doc.text(T(`${m.dateAffichee}${m.commune ? `  ·  ${m.commune}` : ''}`), ML, 51);

  y = 92;
  police(21, 'bold', C.nuit);
  for (const l of doc.splitTextToSize(T(m.titre), CW) as string[]) { doc.text(l, ML, y); y += 9; }
  y += 4;
  if (m.objectif) {
    police(9, 'normal', C.encre);
    const lignes = doc.splitTextToSize(T(m.objectif), CW - 12) as string[];
    const h = lignes.length * 4 + 14;
    doc.setFillColor(...C.violet50); doc.setDrawColor(...C.violet100); doc.roundedRect(ML, y, CW, h, 3, 3, 'FD');
    police(8, 'bold', C.violet600); doc.text('OBJECTIF', ML + 6, y + 7);
    police(9, 'normal', C.encre); lignes.forEach((l, i) => doc.text(l, ML + 6, y + 13 + i * 4));
    y += h + 8;
  }
  // Cartes chiffres
  const meilleur = m.terrains[0];
  const cfs = m.terrains.map((t) => t.charge_fonciere).filter((x): x is number => x != null);
  const cartes: [string, string, string][] = [
    ['Terrains retenus', String(m.terrains.length), m.terrains.length ? m.terrains.map((t) => t.idu.slice(-6)).join(' · ') : '—'],
    ['Terrain n°1', meilleur ? meilleur.idu.slice(-6) : '—', meilleur?.verdict ?? ''],
    ['Charge foncière (max.)', cfs.length ? fEur(Math.max(...cfs)) : 'non calculée', 'hors taxes'],
  ];
  const lc = (CW - 8) / 3;
  cartes.forEach(([lib, val, sous], i) => {
    const x = ML + i * (lc + 4);
    doc.setFillColor(...C.blanc); doc.setDrawColor(...C.trait); doc.roundedRect(x, y, lc, 26, 3, 3, 'FD');
    police(7.5, 'bold', C.gris); doc.text(T(lib.toUpperCase()), x + 5, y + 7);
    police(14, 'bold', C.nuit); doc.text(T(val), x + 5, y + 16);
    police(7.5, 'normal', C.gris2); doc.text(T(sous).slice(0, 40), x + 5, y + 22);
  });
  y += 36;
  if (m.jetons != null) { police(8, 'normal', C.gris); doc.text(T(`Coût de la mission : ${fNb(m.jetons)} jetons`), ML, y); }
  police(8, 'italic', C.gris);
  const avert = doc.splitTextToSize(T(m.avertissement), CW) as string[];
  avert.forEach((l, i) => doc.text(l, ML, PH - 30 + i * 3.8));

  // ── Synthèse ──
  nouvellePage();
  section('Synthèse');
  m.synthese.forEach((p) => paragraphe(p));
  if (m.noteBilanIdentique) paragraphe(m.noteBilanIdentique, 8.5, C.orange, 'italic');

  if (m.classement.length) {
    section('Classement');
    tableau(['Rang', 'Parcelle', 'Justification'], m.classement.map((c) => [String(c.rang), c.idu, c.justification ?? '—']), { largeurs: [14, 36] });
  }
  if (m.terrains.length) {
    section('Tableau comparatif');
    tableau(['Rang', 'Parcelle', 'Surface', 'Zonage', 'Propriétaire', 'Charge foncière', '€/m² terrain', 'Verdict'],
      m.terrains.map((t) => [String(t.rang), t.idu.slice(-6), fM2(t.surface_m2), t.zonageCode ?? '—', proprietaireTexte(t), fEur(t.charge_fonciere), fEurM2(t.charge_fonciere_m2), t.verdict ?? '—']),
      { largeurs: [11, 17, 18, 22, 42, 25, 20, 23], taille: 7.6, colVerdict: 7, tons: m.terrains.map((t) => t.ton) });
  }

  // ── Fiches ──
  m.terrains.forEach((t, i) => {
    if (i === 0) { nouvellePage(); section('Fiches des terrains'); } else place(70);
    fiche(t);
  });

  function fiche(t: TerrainModele) {
    place(40);
    const [txt, fond] = TON[t.ton];
    doc.setFillColor(...fond); doc.roundedRect(ML, y - 5, CW, 11, 2, 2, 'F');
    police(11, 'bold', C.nuit); doc.text(T(`#${t.rang}  ${t.idu}`), ML + 4, y + 2);
    if (t.verdict) { police(9, 'bold', txt); doc.text(T(t.verdict), PW - ML - 4, y + 2, { align: 'right' }); }
    y += 11;
    if (t.adresse || t.commune) paragraphe([t.adresse, t.commune].filter(Boolean).join(' · '), 8.5, C.gris);
    const infos: string[][] = [
      ['Surface', fM2(t.surface_m2)], ['Zonage', [t.zonageCode, t.zonageLibelle].filter(Boolean).join(' - ') || '—'],
      ['Propriétaire', proprietaireTexte(t) + (t.proprietaire?.source ? ` (source : ${t.proprietaire.source})` : '')],
      ['Logements possibles', fNb(t.potentiel_logements)], ['Charge foncière admissible', fEur(t.charge_fonciere)],
      ['Par m² de terrain', fEurM2(t.charge_fonciere_m2) + (t.cfM2Calculee ? ' (charge / surface)' : '')],
    ];
    if (t.score != null) infos.unshift(['Score', fNb(t.score)]);
    if (t.bilan) {
      infos.push(['Bilan', t.bilan.statut === 'complet' ? 'Complet' : 'Partiel']);
      if (t.bilan.ca_ht != null) infos.push(['Chiffre d’affaires HT', fEur(t.bilan.ca_ht)]);
      if (t.bilan.couts_hors_foncier_ht != null) infos.push(['Coûts hors foncier HT', fEur(t.bilan.couts_hors_foncier_ht)]);
      if (t.bilan.justification) infos.push(['Hypothèses propres', t.bilan.justification]);
    }
    autoTable(doc, {
      startY: y, body: infos.map((l) => l.map(T)), theme: 'plain',
      margin: { left: ML, right: ML, top: HAUT, bottom: PH - BAS },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 }, textColor: C.encre },
      columnStyles: { 0: { cellWidth: 48, textColor: C.gris, fontStyle: 'bold' } },
      didDrawPage: () => entetePage(),
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 4;
    if (t.points_forts.length) { sousTitre('Points forts'); puces(t.points_forts, 8.5); }
    if (t.points_bloquants.length) { sousTitre('Points bloquants'); puces(t.points_bloquants, 8.5); }
    if (t.contraintes.length) { sousTitre('Contraintes'); puces(t.contraintes.map((c) => `${c.type} : ${c.libelle}${c.source ? ` (source : ${c.source})` : ''}`), 8.5); }
    if (t.bilan?.manques.length) { sousTitre('À renseigner pour le bilan'); puces(t.bilan.manques, 8.5); }
    if (t.sources.length) paragraphe(`Sources : ${t.sources.join(' ; ')}`, 7.5, C.gris2);
    y += 4;
  }

  // ── Hypothèses, contacts, sources, limites ──
  nouvellePage();
  section('Hypothèses du bilan');
  if (m.hypothesesDepuisTexte) paragraphe('Certaines valeurs ont été reprises du texte du rapport : à vérifier.', 8.5, C.orange, 'italic');
  tableau(['Hypothèse', 'Valeur', 'Source'], DEFINITIONS_HYPOTHESES.map((d) => [d.libelle, formatHypothese(d, m.hypotheses[d.cle].valeur), m.hypotheses[d.cle].source ?? '—']), { largeurs: [70, 30] });
  paragraphe('Le bilan Excel modifiable reprend ces hypothèses avec de vraies formules : changez une valeur, tout se recalcule.', 8.5, C.gris, 'italic');
  if (m.contacts.length) {
    section('Contacts');
    tableau(['Qualité', 'Nom', 'Téléphone', 'E-mail', 'Adresse', 'Source'],
      m.contacts.map((c) => [LIBELLE_QUALITE_CONTACT[c.qualite] ?? c.qualite, c.nom, c.telephone ?? '—', c.email ?? '—', c.adresse ?? '—', c.source ?? '—']), { taille: 7.6 });
  }
  if (m.sources.length) { section('Sources'); puces(m.sources, 8.5); }
  if (m.limites.length) { section('Limites'); puces(m.limites, 8.5); }
  section('Avertissement');
  paragraphe(m.avertissement, 9, C.gris, 'italic');

  // ── Pieds de page ──
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    police(7, 'normal', C.gris2);
    doc.text(T('Mimmoza · Étude indicative, à faire valider par un professionnel'), ML, PH - 8);
    doc.text(`${p} / ${total}`, PW - ML, PH - 8, { align: 'right' });
  }
  return doc;
}
