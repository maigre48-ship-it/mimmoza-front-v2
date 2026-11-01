// supabase/functions/_shared/documents/extractionPdf.ts
// =============================================================
// Extraction du texte d'un PDF, page par page, PAR LOTS bornés en temps.
//
// Bibliothèque : unpdf (build « serverless » de pdf.js, sans worker ni canvas,
// prévue pour Deno / edge). Importée UNIQUEMENT par plu-reglement-v1 : jamais
// par copilot-chat, pour que le chat ne porte ni son poids ni son coût CPU.
//
// ⚠️ Pourquoi par lots : une Edge Function Supabase dispose de 2 s de CPU par
// requête (hors I/O) et de 256 Mo de mémoire. Le parsing serveur d'un gros PDF
// a déjà provoqué l'erreur 546 (WORKER_LIMIT) dans plu-parser, d'où son plafond
// de 45 pages. Mesure faite sur un règlement de test de 300 pages (texte dense) :
// ~3,5 ms de CPU par page après chargement, ~80 ms d'ouverture à froid — un
// règlement réel (polices, tableaux) peut coûter 2 à 3 fois plus. On extrait
// donc au plus `budgetMs` (mur ≥ CPU) par appel ; l'appelant enregistre les
// pages et rappelle pour la suite.
// =============================================================

import { getDocumentProxy } from 'npm:unpdf@1.4.0';

export interface PageExtraite { n: number; texte: string }
export interface LotExtraction {
  nbPages: number;
  pages: PageExtraite[];
  /** Prochaine page à extraire (nbPages + 1 si terminé). */
  prochaine: number;
  termine: boolean;
}

type ItemTexte = { str?: string; hasEOL?: boolean; transform?: number[] };

/** Texte d'une page : retour à la ligne quand la ligne de base change (comme plu-parser) ou en fin de ligne. */
export function texteDesItems(items: readonly ItemTexte[]): string {
  let t = '';
  let dernierY: number | undefined;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const y = Array.isArray(it.transform) ? it.transform[5] : undefined;
    if (dernierY !== undefined && y !== undefined && y !== dernierY && !t.endsWith('\n')) t += '\n';
    t += it.str;
    if (it.hasEOL) t += '\n';
    if (y !== undefined) dernierY = y;
  }
  return t.replace(/[ \t]+\n/g, '\n').trim();
}

/** Nombre de pages seul (ouverture du document, sans extraction). */
export async function compterPages(octets: Uint8Array): Promise<number> {
  const pdf = await getDocumentProxy(new Uint8Array(octets));
  try { return pdf.numPages; } finally { await pdf.destroy(); }
}

/**
 * Extrait les pages à partir de `depuis` (1 = première) jusqu'à épuisement du
 * budget de temps ou de `maxPages`. Au moins UNE page est extraite par appel
 * (sinon un document dont la première page dépasse le budget ne progresserait jamais).
 */
export async function extraireLot(
  octets: Uint8Array, depuis: number, opts: { budgetMs: number; maxPages: number; maintenant?: () => number; copier?: boolean },
): Promise<LotExtraction> {
  const maintenant = opts.maintenant ?? (() => performance.now());
  const debut = maintenant();
  // Copie par défaut : pdf.js peut détacher le tampon reçu. `copier: false` quand
  // l'appelant n'en a plus besoin (économise la taille du PDF en mémoire : 256 Mo par isolate).
  const pdf = await getDocumentProxy(opts.copier === false ? octets : new Uint8Array(octets));
  try {
    const nbPages = pdf.numPages;
    const pages: PageExtraite[] = [];
    let n = Math.max(1, Math.trunc(depuis));
    while (n <= nbPages && pages.length < opts.maxPages) {
      if (pages.length > 0 && maintenant() - debut > opts.budgetMs) break;
      const page = await pdf.getPage(n);
      try {
        const contenu = await page.getTextContent();
        pages.push({ n, texte: texteDesItems(contenu.items as ItemTexte[]) });
      } catch {
        pages.push({ n, texte: '' });   // page illisible : vide, jamais inventée
      } finally {
        page.cleanup();
      }
      n++;
    }
    return { nbPages, pages, prochaine: n, termine: n > nbPages };
  } finally {
    await pdf.destroy();
  }
}
