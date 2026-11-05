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

// ── Lot A (point 3) : jamais de coupure après « art. », « p. »… ni dans une parenthèse ──
//
// Constat (05/11/2026, synthèse de la mission de conception AE0414) : « … recul voie 0 ou 4 m au
// choix du constructeur (art.\n\nUC 6-1), reculs latéraux … (art.\n\nUC 13-1) ». La synthèse est
// découpée en phrases puis regroupée par 3 (rapportModele.paragrapher) avec une expression qui
// coupe après TOUT point suivi d'une espace — « (art. UC 6-1) » devenait deux phrases.

/** Abréviations après lesquelles un point ne termine jamais une phrase (« 28 m. » en termine une). */
const ABREVIATIONS_PHRASE = new Set([
  'art', 'p', 'pp', 'cf', 'n°', 'no', 'env', 'ex', 'réf', 'ref', 'al', 'chap', 'fig', 'vol', 'éd', 'av', 'bd', 'sect', 'mme', 'dr', 'st', 'ste',
]);

/** Profondeur de parenthèses / crochets ouverts à la fin de `t`. */
function parenthesesOuvertes(t: string): number {
  let d = 0;
  for (const c of t) {
    if (c === '(' || c === '[') d++;
    else if ((c === ')' || c === ']') && d > 0) d--;
  }
  return d;
}

/** Le texte se termine sur une abréviation (« (art. », « p. », « cf. »…). */
function finitParAbreviation(t: string): boolean {
  const m = /(?:^|[\s(«"“[])([\p{L}°]+)\.$/u.exec(t.trimEnd());
  return !!m && ABREVIATIONS_PHRASE.has(m[1].toLowerCase());
}

/**
 * Phrases d'un texte, SANS coupure après une abréviation (« art. », « p. », « cf. », « n° »,
 * « env. », « ex. »…) ni à l'intérieur de parenthèses ou de crochets. Fin de phrase : « . ! ? … »
 * suivis d'une espace puis d'une majuscule, d'un chiffre ou d'un guillemet (ou de la fin du texte). Phrases rognées, mots identiques : la jointure par
 * une espace redonne le texte d'origine (espaces normalisées). À utiliser par
 * rapportModele.paragrapher à la place de son expression régulière.
 */
export function phrasesLisibles(s: string): string[] {
  const out: string[] = [];
  let debut = 0;
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[') { d++; continue; }
    if ((c === ')' || c === ']') && d > 0) { d--; continue; }
    if (!/[.!?…]/u.test(c) || d > 0) continue;
    let j = i;
    while (j + 1 < s.length && /[.!?…]/u.test(s[j + 1])) j++;
    if (j + 1 < s.length && !/\s/u.test(s[j + 1])) { i = j; continue; }
    if (c === '.' && j === i && finitParAbreviation(s.slice(debut, i + 1))) continue;
    // La phrase suivante commence par une majuscule, un chiffre ou un guillemet (« … (art. UC 13-1) » : pas de coupure).
    const suivant = /\S/u.exec(s.slice(j + 1));
    if (suivant && !/[\p{Lu}\p{N}«"“*_#-]/u.test(suivant[0])) { i = j; continue; }
    const ph = s.slice(debut, j + 1).trim();
    if (ph) out.push(ph);
    debut = j + 1;
    i = j;
  }
  const reste = s.slice(debut).trim();
  if (reste) out.push(reste);
  return out;
}

/**
 * Recolle les paragraphes coupés à tort : un paragraphe qui finit sur une abréviation (« (art. »)
 * ou dans une parenthèse ouverte est rejoint au suivant par une espace (rattrape aussi les rapports
 * déjà construits avec l'ancien découpage). Une ligne de liste ou un titre ne sont jamais recollés.
 */
export function recollerCoupures(paragraphes: string[]): string[] {
  const out: string[] = [];
  for (const p of paragraphes) {
    const prec = out.length ? out[out.length - 1] : null;
    const coupe = prec != null && !/^\s*#/.test(prec) && (finitParAbreviation(prec) || parenthesesOuvertes(prec) > 0);
    if (coupe && !LIGNE_LISTE.test(p)) out[out.length - 1] = `${prec.trimEnd()} ${p.trimStart()}`;
    else out.push(p);
  }
  return out;
}

/**
 * Paragraphes de synthèse (rapportModele : une ligne de liste = un paragraphe,
 * pour les exports) → blocs d'affichage : une ligne d'introduction et les lignes
 * de liste qui la suivent forment UN bloc (rendu en vraie liste à l'écran).
 * Lot A : les paragraphes coupés après une abréviation ou dans une parenthèse sont recollés.
 */
export function regrouperParagraphes(paragraphes: string[]): string[] {
  const blocs: string[] = [];
  let enListe = false;
  for (const p of recollerCoupures(paragraphes)) {
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
