/**
 * VIS-60 — PDF du « Dossier de présentation » (A4 paysage), par jsPDF + qrcode (dépendances directes du site).
 * Fonctionne dans le navigateur ET sous Node (tests) : aucune toile (canvas), le QR code est dessiné en carrés vectoriels.
 *
 * Pages : couverture (perspective pleine largeur, titre, adresse, date, mention) → programme et surfaces (SDP / SHAB,
 * logements, gabarit…) + contenu du dossier → une planche par image → plans (aperçus + liste des fichiers) → film et
 * visite 360° (QR codes et liens cliquables). Pied de page : « Mimmoza · Dossier de présentation · Images non
 * contractuelles · n / N ». Aucun nom de fournisseur d'assets ; aucun avertissement technique du worker.
 */
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { lignesProgramme, MENTION_DOSSIER, TITRE_DOSSIER, texteClient, type ManifesteDossier, type ProgrammeDossier } from './dossierClientLogique.ts';

export interface EntreePdfDossier {
  readonly titre: string;
  readonly adresse?: string | null;
  readonly date: string;
  readonly programme: ProgrammeDossier;
  readonly manifeste: ManifesteDossier;
  /** Octets des images à poser (clé : chemin de stockage, apercu si présent sinon original). Absente : planche omise. */
  readonly octets: ReadonlyMap<string, Uint8Array>;
  readonly lienFilm?: string | null;
  readonly lienVisite?: string | null;
  /** Tests : flux non compressés (texte lisible dans les octets). */
  readonly compresser?: boolean;
}

const BLEU = [30, 58, 138] as const;      // #1e3a8a
const BLEU_CLAIR = [219, 234, 254] as const; // #dbeafe
const GRIS = [71, 85, 105] as const;
const L = 297;
const H = 210;

/** Polices standard PDF (WinAnsi) : remplace ce qu'elles ne savent pas écrire. */
export function textePdf(s: string): string {
  return s.replace(/[’‘]/g, '\'').replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/œ/g, 'oe').replace(/Œ/g, 'OE')
    .replace(/≈/g, '~').replace(/[   ]/g, ' ').replace(/[^\x20-\x7e -ÿ\n]/g, '');
}

/** Dimensions d'un JPEG (marqueur SOFn) ou d'un PNG (IHDR) ; null si illisible. */
export function dimensionsImage(b: Uint8Array): { largeur: number; hauteur: number; format: 'JPEG' | 'PNG' } | null {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { largeur: v.getUint32(16), hauteur: v.getUint32(20), format: 'PNG' };
  }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1]!;
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { hauteur: (b[i + 5]! << 8) | b[i + 6]!, largeur: (b[i + 7]! << 8) | b[i + 8]!, format: 'JPEG' };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * JPEG réordonné pour jsPDF 4 : son lecteur d'en-tête prend le marqueur DHT (0xFFC4) pour un SOF et lit alors
 * 257 × 257 sans espace colorimétrique (PDF illisible) quand les tables de Huffman PRÉCÈDENT le SOF — ce que fait
 * ffmpeg, donc toutes les images livrées par le worker. On réécrit l'en-tête (légal : tables avant SOS, dans
 * n'importe quel ordre) : SOI, APP0 JFIF, DQT / DRI…, SOF, DHT, puis SOS et données inchangées. COM et APPn retirés.
 */
export function jpegPourJsPdf(b: Uint8Array): Uint8Array {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return b;
  const avant: Uint8Array[] = [];
  const sof: Uint8Array[] = [];
  const dht: Uint8Array[] = [];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return b;
    const m = b[i + 1]!;
    if (m === 0xff) { i++; continue; }
    if (m === 0xda) break;
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    const seg = b.subarray(i, i + 2 + len);
    if (m === 0xc4) dht.push(seg);
    else if (m >= 0xc0 && m <= 0xcf && m !== 0xc8 && m !== 0xcc) sof.push(seg);
    else if (m !== 0xfe && !(m >= 0xe0 && m <= 0xef)) avant.push(seg);
    i += 2 + len;
  }
  if (i + 4 > b.length || sof.length !== 1) return b;
  const app0 = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const morceaux = [app0, ...avant, ...sof, ...dht, b.subarray(i)];
  const sortie = new Uint8Array(morceaux.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of morceaux) { sortie.set(x, p); p += x.length; }
  return sortie;
}

function poserImage(doc: jsPDF, b: Uint8Array, x: number, y: number, w: number, h: number, mode: 'contenir' | 'couvrir'): boolean {
  const d = dimensionsImage(b);
  if (!d || !d.largeur || !d.hauteur) return false;
  const r = d.largeur / d.hauteur;
  let iw = w;
  let ih = w / r;
  if (mode === 'contenir' ? ih > h : ih < h) { ih = h; iw = h * r; }
  const ix = x + (w - iw) / 2;
  const iy = y + (h - ih) / 2;
  if (mode === 'couvrir') {
    doc.saveGraphicsState();
    doc.rect(x, y, w, h, null as unknown as string);
    doc.clip();
    doc.discardPath();
  }
  doc.addImage(d.format === 'JPEG' ? jpegPourJsPdf(b) : b, d.format, ix, iy, iw, ih, undefined, 'FAST');
  if (mode === 'couvrir') doc.restoreGraphicsState();
  return true;
}

function qr(doc: jsPDF, lien: string, x: number, y: number, cote: number): void {
  const q = QRCode.create(lien, { errorCorrectionLevel: 'M' });
  const n = q.modules.size;
  const marge = 2;
  const p = cote / (n + marge * 2);
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, cote, cote, 'F');
  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.modules.get(r, c)) doc.rect(x + (c + marge) * p, y + (r + marge) * p, p + 0.02, p + 0.02, 'F');
  doc.link(x, y, cote, cote, { url: lien });
}

function entete(doc: jsPDF, titre: string, sousTitre: string): void {
  doc.setFillColor(...BLEU_CLAIR);
  doc.rect(0, 0, L, 22, 'F');
  doc.setTextColor(...BLEU);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(textePdf(titre), 14, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(textePdf(sousTitre), L - 14, 14, { align: 'right' });
}

/** Construit le PDF ; rend ses octets. */
export function construirePdfDossier(e: EntreePdfDossier): Uint8Array {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: e.compresser !== false });
  doc.setProperties({ title: textePdf(`${TITRE_DOSSIER} - ${e.titre}`), subject: TITRE_DOSSIER, author: 'Mimmoza', creator: 'Mimmoza' });
  const m = e.manifeste;
  const titre = texteClient(e.titre) ?? 'Projet';
  const octetsDe = (f: { chemin: string; cheminApercu?: string } | null | undefined): Uint8Array | null =>
    f ? (f.cheminApercu ? e.octets.get(f.cheminApercu) : undefined) ?? e.octets.get(f.chemin) ?? null : null;

  // 1. Couverture.
  const persp = octetsDe(m.perspective);
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, L, 167, 'F');
  if (!(persp && poserImage(doc, persp, 0, 0, L, 167, 'couvrir'))) {
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.text(textePdf('Perspective à venir'), L / 2, 85, { align: 'center' });
  }
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 167, L, 43, 'F');
  doc.setTextColor(...BLEU);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text(textePdf(titre), 14, 184);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(...GRIS);
  const adresse = texteClient(e.adresse ?? null);
  doc.text(textePdf([TITRE_DOSSIER, adresse, e.date].filter(Boolean).join('  ·  ')), 14, 194);
  doc.setFontSize(9);
  doc.text(textePdf(MENTION_DOSSIER), 14, 203);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLEU);
  doc.setFontSize(14);
  doc.text('Mimmoza', L - 14, 184, { align: 'right' });

  // 2. Programme et contenu.
  doc.addPage();
  entete(doc, 'Programme', titre);
  doc.setFontSize(11);
  let y = 38;
  let rang = 0;
  for (const [lib, val] of lignesProgramme(e.programme)) {
    if (rang++ % 2) doc.setFillColor(255, 255, 255); else doc.setFillColor(241, 245, 249);
    doc.rect(14, y - 6, 140, 10, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRIS);
    doc.text(textePdf(lib), 18, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BLEU);
    doc.text(textePdf(val), 150, y, { align: 'right' });
    y += 11;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRIS);
  doc.text(textePdf('Surfaces de l’étude de capacité, indicatives ; à confirmer par le géomètre et l’architecte du projet.'), 14, y + 2);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLEU);
  doc.text(textePdf('Contenu du dossier'), 170, 38);
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRIS);
  const contenu = [
    m.images.length ? `${m.images.length} planche${m.images.length > 1 ? 's' : ''} d’images en haute définition` : null,
    m.film ? `Film du projet${m.film.dureeS ? ` (${Math.round(m.film.dureeS)} s)` : ''}` : null,
    m.visite ? 'Visite virtuelle 360°' : null,
    m.plans.length ? `Plans : ${m.plans.map((p) => p.libelle).filter((v, i, t) => t.indexOf(v) === i).join(', ')}` : null,
  ].filter((x): x is string => !!x);
  contenu.forEach((c, i) => doc.text(textePdf(`-  ${c}`), 172, 49 + i * 8));
  doc.setFontSize(9);
  doc.text(textePdf('Fichiers complets (film MP4, images HD, plans) dans l’archive ZIP jointe.'), 172, 49 + contenu.length * 8 + 4);

  // 3. Planches.
  m.images.forEach((im, i) => {
    const b = octetsDe(im);
    if (!b) return;
    doc.addPage();
    entete(doc, `Planche ${i + 1} — ${texteClient(im.libelle) ?? 'Vue du projet'}`, titre);
    if (!poserImage(doc, b, 14, 28, L - 28, 162, 'contenir')) doc.text(textePdf('Image illisible'), L / 2, 110, { align: 'center' });
  });

  // 4. Plans.
  if (m.plans.length) {
    const apercus = m.plans.filter((p) => p.genre === 'plan_apercu' && e.octets.get(p.chemin));
    for (const p of apercus) {
      doc.addPage();
      entete(doc, 'Plan', titre);
      poserImage(doc, e.octets.get(p.chemin)!, 14, 28, L - 28, 162, 'contenir');
    }
    doc.addPage();
    entete(doc, 'Plans fournis', titre);
    doc.setFontSize(11);
    doc.setTextColor(...GRIS);
    m.plans.filter((p) => p.genre !== 'plan_apercu').forEach((p, i) => {
      doc.setFont('helvetica', 'bold');
      doc.text(textePdf(p.libelle), 18, 40 + i * 9);
      doc.setFont('helvetica', 'normal');
      doc.text(textePdf(p.nomZip), 90, 40 + i * 9);
    });
  }

  // 5. Film et visite : QR codes + liens.
  const liens = [
    e.lienFilm && m.film ? { titre: 'Film du projet', lien: e.lienFilm, note: 'Lien de visionnage (temporaire) ; le fichier MP4 est aussi dans l’archive.' } : null,
    e.lienVisite && m.visite ? { titre: 'Visite virtuelle 360°', lien: e.lienVisite, note: 'Ouvrir avec l’appareil photo du téléphone, ou cliquer.' } : null,
  ].filter((x): x is { titre: string; lien: string; note: string } => !!x);
  if (liens.length) {
    doc.addPage();
    entete(doc, liens.length > 1 ? 'Film et visite 360°' : liens[0]!.titre, titre);
    liens.forEach((l, i) => {
      const x = 30 + i * 135;
      qr(doc, l.lien, x, 40, 70);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(...BLEU);
      doc.text(textePdf(l.titre), x, 122);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...GRIS);
      doc.text(doc.splitTextToSize(textePdf(l.note), 110), x, 130);
      doc.setTextColor(...BLEU);
      doc.textWithLink(textePdf('Ouvrir le lien'), x, 146, { url: l.lien });
    });
  }

  // Pieds de page (toutes les pages sauf la couverture).
  const n = doc.getNumberOfPages();
  for (let p = 2; p <= n; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GRIS);
    doc.text(textePdf(`Mimmoza · ${TITRE_DOSSIER} · ${MENTION_DOSSIER}`), 14, H - 7);
    doc.text(`${p} / ${n}`, L - 14, H - 7, { align: 'right' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
