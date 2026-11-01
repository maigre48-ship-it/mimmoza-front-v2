// deno test --allow-read --allow-env --allow-net=registry.npmjs.org supabase/functions/_shared/documents/extractionPdf.test.ts
// Extraction réelle (unpdf) sur un PDF construit à la main, sans fichier externe.
import * as na from 'node:assert/strict';
import { compterPages, extraireLot, texteDesItems } from './extractionPdf.ts';
import { selectionnerPages } from './lectureCiblee.ts';

const assertEquals = (a: unknown, b: unknown, msg?: string) => na.deepStrictEqual(a, b, msg);

/** PDF minimal valide (Helvetica, une ou plusieurs lignes par page), xref calculée. */
function pdfMinimal(pages: string[][]): Uint8Array {
  const objets: string[] = [];
  const nb = pages.length;
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objets.push('<< /Type /Catalog /Pages 2 0 R >>');
  objets.push(`<< /Type /Pages /Kids [${kids}] /Count ${nb} >>`);
  objets.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((lignes, i) => {
    const flux = lignes.map((l, k) => `BT /F1 12 Tf 50 ${780 - k * 16} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n');
    objets.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objets.push(`<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objets.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const doc = pdfMinimal([
  ['PLAN LOCAL D URBANISME', 'Reglement ecrit'],
  ['TITRE I - DISPOSITIONS GENERALES', 'Article 1 - Champ d application'],
  ['CHAPITRE 1 - DISPOSITIONS APPLICABLES A LA ZONE UA', 'Article UA 10 - Hauteur maximale : 15 m'],
  ['CHAPITRE 2 - DISPOSITIONS APPLICABLES A LA ZONE UC', 'Article UC 10 - Hauteur maximale : 12 m'],
  ['PLU - Zone UC', 'Article UC 12 - Stationnement : 1 place par logement'],
]);

Deno.test('texte des items : lignes reconstruites', () => {
  assertEquals(texteDesItems([{ str: 'A', transform: [0, 0, 0, 0, 0, 10] }, { str: 'B', transform: [0, 0, 0, 0, 0, 10] }, { str: 'C', transform: [0, 0, 0, 0, 0, 20] }]), 'AB\nC');
  assertEquals(texteDesItems([{ str: 'x', hasEOL: true }, { str: 'y' }]), 'x\ny');
});

Deno.test('extraction par lots : progression, reprise, puis sélection de la zone', async () => {
  assertEquals(await compterPages(doc), 5);
  const lot1 = await extraireLot(doc, 1, { budgetMs: 10_000, maxPages: 2 });
  assertEquals(lot1.pages.map((p) => p.n), [1, 2]);
  assertEquals(lot1.termine, false);
  const lot2 = await extraireLot(doc, lot1.prochaine, { budgetMs: 10_000, maxPages: 50 });
  assertEquals(lot2.pages.map((p) => p.n), [3, 4, 5]);
  assertEquals(lot2.termine, true);
  const pages = [...lot1.pages, ...lot2.pages].map((p) => p.texte);
  na.match(pages[3], /ZONE UC\nArticle UC 10 - Hauteur maximale : 12 m/);
  const s = selectionnerPages(pages, 'UC', 100_000);
  assertEquals(s.pagesZone, [4, 5]);
  assertEquals(s.pagesDispositionsGenerales, [2]);
});

Deno.test('budget de temps : au moins une page par appel', async () => {
  let t = 0;
  const lot = await extraireLot(doc, 1, { budgetMs: 5, maxPages: 50, maintenant: () => (t += 10) });
  assertEquals(lot.pages.length, 1);
  assertEquals(lot.prochaine, 2);
});
