// supabase/functions/agent-action-envoyer-v1/pdf.ts
// Lettre A4 sobre (pdf-lib, polices standard, aucun accès réseau à l'exécution).
// Les polices standard sont en WinAnsi : accents français, « », €, œ, ’ passent ;
// tout autre caractère est remplacé (jamais d'exception au milieu d'un envoi).

import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'npm:pdf-lib@1.17.1';

export interface CourrierPdf {
  expediteur: { nom: string; lignes?: string[] };
  destinataire: { nom: string; adresse?: string };
  objet: string;
  corps: string;
  date: Date;
}

const A4: [number, number] = [595.28, 841.89];
const MARGE_G = 70, MARGE_D = 70, MARGE_H = 70, MARGE_B = 70;
const TAILLE = 11, INTERLIGNE = 15;

const REMPLACEMENTS: Record<string, string> = {
  '→': '->', '←': '<-', '≤': '<=', '≥': '>=', '≈': '~', '−': '-',
  '‑': '-', '‐': '-', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '′': "'", '″': '"', '✓': 'v', '✔': 'v',
};

/** Rend une chaîne encodable par la police (WinAnsi) : remplacements connus, sinon « ? ». */
export function assainir(texte: string, police: PDFFont): string {
  let out = '';
  for (const ch of texte.normalize('NFC')) {
    const c = REMPLACEMENTS[ch] ?? ch;
    try {
      police.encodeText(c);
      out += c;
    } catch {
      out += '?';
    }
  }
  return out;
}

/** Découpe un paragraphe en lignes tenant dans `largeur` (coupe aussi les mots trop longs). */
export function couperLignes(texte: string, police: PDFFont, taille: number, largeur: number): string[] {
  const mots = texte.split(/ +/);
  const lignes: string[] = [];
  let cour = '';
  const tient = (s: string) => police.widthOfTextAtSize(s, taille) <= largeur;
  for (let mot of mots) {
    while (!tient(mot)) { // mot plus long qu'une ligne
      let i = mot.length - 1;
      while (i > 1 && !tient(mot.slice(0, i))) i--;
      if (cour) { lignes.push(cour); cour = ''; }
      lignes.push(mot.slice(0, i));
      mot = mot.slice(i);
    }
    const essai = cour ? `${cour} ${mot}` : mot;
    if (tient(essai)) cour = essai;
    else { lignes.push(cour); cour = mot; }
  }
  lignes.push(cour);
  return lignes;
}

export function dateFrancaise(d: Date): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

export async function genererCourrierPdf(c: CourrierPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(c.objet.slice(0, 200));
  doc.setCreator('Mimmoza');
  doc.setProducer('Mimmoza');
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const largeur = A4[0] - MARGE_G - MARGE_D;
  const noir = rgb(0.1, 0.1, 0.12);

  let page = doc.addPage(A4);
  let y = A4[1] - MARGE_H;
  const nouvellePageSiBesoin = () => {
    if (y < MARGE_B) { page = doc.addPage(A4); y = A4[1] - MARGE_H; }
  };
  const ecrire = (t: string, opts: { police?: PDFFont; x?: number; taille?: number } = {}) => {
    nouvellePageSiBesoin();
    const police = opts.police ?? normal;
    page.drawText(assainir(t, police), { x: opts.x ?? MARGE_G, y, size: opts.taille ?? TAILLE, font: police, color: noir });
    y -= INTERLIGNE;
  };

  // En-tête expéditeur (en haut à gauche).
  ecrire(c.expediteur.nom, { police: gras });
  for (const l of c.expediteur.lignes ?? []) if (l.trim()) ecrire(l.trim());

  // Bloc destinataire (à droite, position fenêtre d'enveloppe).
  y = Math.min(y, A4[1] - 170);
  const xDest = A4[0] / 2 + 20;
  const largDest = A4[0] - MARGE_D - xDest;
  for (const l of couperLignes(assainir(c.destinataire.nom, gras), gras, TAILLE, largDest)) ecrire(l, { police: gras, x: xDest });
  for (const brut of (c.destinataire.adresse ?? '').split(/\r?\n|,\s*(?=\d{5}\b)/)) {
    if (!brut.trim()) continue;
    for (const l of couperLignes(assainir(brut.trim(), normal), normal, TAILLE, largDest)) ecrire(l, { x: xDest });
  }

  // Date.
  y -= INTERLIGNE;
  const dateTxt = `Le ${dateFrancaise(c.date)}`;
  ecrire(dateTxt, { x: A4[0] - MARGE_D - normal.widthOfTextAtSize(assainir(dateTxt, normal), TAILLE) });

  // Objet.
  y -= INTERLIGNE;
  const objet = couperLignes(assainir(`Objet : ${c.objet}`, gras), gras, TAILLE, largeur);
  for (const l of objet) ecrire(l, { police: gras });
  y -= INTERLIGNE;

  // Corps : paragraphes séparés par une ligne vide.
  const paragraphes = c.corps.replace(/\r\n?/g, '\n').split('\n');
  for (const p of paragraphes) {
    if (!p.trim()) { y -= INTERLIGNE * 0.6; continue; }
    for (const l of couperLignes(assainir(p.trim(), normal), normal, TAILLE, largeur)) ecrire(l);
  }

  // Signature.
  y -= INTERLIGNE * 2;
  ecrire(c.expediteur.nom, { police: gras, x: A4[0] / 2 + 20 });

  return await doc.save();
}
