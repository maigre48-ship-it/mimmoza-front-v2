// src/spaces/copilot/utils/lisibilite.ts
// =============================================================================
// LOT F1 — Lisibilité des réponses (logique PURE, testée par lisibilite.test.ts
// avec `node --test`).
//
// · `mettreEnForme` est la MÊME fonction que celle du serveur : elle est importée
//   telle quelle depuis supabase/functions/_shared (aucune copie à synchroniser).
//   Elle remet un élément par ligne dans les énumérations écrites en ligne — y
//   compris dans les textes déjà stockés (anciennes missions, anciens messages).
// · Le rendu reste celui du projet (`markdownToSafeHtml`, HTML échappé : aucune
//   injection possible) ; ce module ne fait que préparer le texte et marquer la
//   « réponse d'abord ».
// =============================================================================

import { mettreEnForme } from '../../../../supabase/functions/_shared/texte/miseEnForme.ts';

export { mettreEnForme };

/** Ligne de liste Markdown (« - … », « * … », « 1. … »). */
const LIGNE_LISTE = /^\s*(?:[-*•]\s+|\d{1,2}\.\s+)\S/;

/** Classe CSS de la première phrase-réponse mise en évidence. */
export const CLASSE_REPONSE_DABORD = 'mz-reponse-dabord';

/** Longueur (texte visible) au-delà de laquelle un premier paragraphe n'est plus « une réponse ». */
const REPONSE_MAX_CARS = 600;

/**
 * Met en évidence le premier paragraphe d'un HTML produit par `markdownToSafeHtml`
 * quand il suit la structure « réponse d'abord » : il ouvre le texte (au plus
 * précédé d'un titre), il est court, et il est suivi d'autre chose (liste,
 * titre, autre paragraphe) — sauf si `exigerSuite` vaut false.
 * Ne touche qu'à la balise ouvrante du paragraphe : le contenu reste échappé.
 */
export function marquerReponseDabord(html: string, options: { exigerSuite?: boolean } = {}): string {
  const exigerSuite = options.exigerSuite ?? true;
  const m = /^(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)?<p style="/.exec(html);
  if (!m) return html;
  const debut = m[1]?.length ?? 0;
  const fin = html.indexOf('</p>', debut);
  if (fin < 0) return html;
  if (exigerSuite && fin + 4 >= html.length) return html;
  const visible = html.slice(debut, fin).replace(/<[^>]+>/g, '');
  if (!visible.trim() || visible.length > REPONSE_MAX_CARS) return html;
  return `${html.slice(0, debut)}<p class="${CLASSE_REPONSE_DABORD}" style="${html.slice(debut + '<p style="'.length)}`;
}

/**
 * Texte → HTML sûr et lisible : `mettreEnForme` puis le rendu Markdown du projet
 * (passé en paramètre pour garder ce module sans dépendance d'affichage).
 */
export function htmlLisible(
  texte: string | null | undefined,
  rendu: (markdown: string) => string,
  options: { reponseDabord?: boolean; exigerSuite?: boolean } = {},
): string {
  if (!texte) return '';
  const html = rendu(mettreEnForme(texte));
  return options.reponseDabord ? marquerReponseDabord(html, { exigerSuite: options.exigerSuite }) : html;
}

export interface ObjectifScinde {
  /** Phrase(s) d'introduction (titre de la mission) ; '' si le texte commence par la liste. */
  titre: string;
  /** Liste des points (Markdown, un par ligne) et ce qui suit ; null s'il n'y a pas de liste. */
  detail: string | null;
  /** Nombre de points de la liste. */
  nbPoints: number;
}

/**
 * Objectif de mission → titre court + détail en liste. Un objectif « en un seul
 * bloc » (« La mission doit : (1) … ; (2) … ») est d'abord remis en forme.
 */
export function scinderObjectif(texte: string | null | undefined): ObjectifScinde {
  const t = mettreEnForme((texte ?? '').trim());
  if (!t) return { titre: '', detail: null, nbPoints: 0 };
  const lignes = t.split(/\r?\n/);
  const iListe = lignes.findIndex((l) => LIGNE_LISTE.test(l));
  if (iListe < 0) return { titre: t, detail: null, nbPoints: 0 };
  const suite = lignes.slice(iListe);
  return {
    titre: lignes.slice(0, iListe).join('\n').trim(),
    detail: suite.join('\n').trim(),
    nbPoints: suite.filter((l) => LIGNE_LISTE.test(l)).length,
  };
}

/**
 * Paragraphes de synthèse (rapportModele : une ligne de liste = un paragraphe,
 * pour les exports) → blocs d'affichage : une ligne d'introduction et les lignes
 * de liste qui la suivent forment UN bloc (rendu en vraie liste à l'écran).
 */
export function regrouperParagraphes(paragraphes: string[]): string[] {
  const blocs: string[] = [];
  let enListe = false;
  for (const p of paragraphes) {
    const liste = LIGNE_LISTE.test(p);
    if (liste && blocs.length && (enListe || /:\s*$/.test(blocs[blocs.length - 1]))) {
      blocs[blocs.length - 1] += `\n${p}`;
    } else {
      blocs.push(p);
    }
    enListe = liste;
  }
  return blocs;
}
