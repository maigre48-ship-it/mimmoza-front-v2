// src/spaces/copilot/document/documentModele.ts
// =============================================================================
// LOT D1 — Réponse en document (logique PURE, testée par documentModele.test.ts
// avec `node --test`).
//
// Une réponse longue de MimmozIA (analyse, étude, bilan) est relue comme un
// document professionnel :
//   - une CONCLUSION (texte avant le premier titre, ou section « Ce qu'il faut
//     retenir / En bref / Conclusion / Synthèse / Verdict ») ;
//   - des SECTIONS numérotées automatiquement (titres « ## … ») ;
//   - les RÉSERVES et les SOURCES regroupées en pied de document.
// Aucun mot n'est réécrit : on ne fait que découper le Markdown reçu. Fonctionne
// aussi pour les anciens messages déjà stockés (aucune balise serveur requise).
// =============================================================================

import { phrasesLisibles } from '../utils/lisibilite.ts';

/** Section numérotée du document (Markdown brut, rendu ensuite par le rendu sûr du projet). */
export interface SectionDocument {
  titre: string;
  markdown: string;
}

export interface DocumentReponse {
  /** Libellé du type de document (« Analyse de parcelle », « Note d'analyse »…). */
  type: string;
  titre: string;
  /** Date lisible (« 9 novembre 2026 »), '' si inconnue. */
  date: string;
  /** Conclusion en Markdown ('' si aucune n'a pu être isolée). */
  conclusion: string;
  sections: SectionDocument[];
  reserves: string | null;
  sources: string | null;
}

/** Seuils : en dessous, la réponse reste un message de chat ordinaire. */
export const SEUIL_DOCUMENT_CARS = 1400;
export const SEUIL_DOCUMENT_TITRES_CARS = 700;

const TITRE_MD = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const RE_CONCLUSION = /^(ce qu['’]il faut retenir|en bref|en résumé|résumé|conclusion|synthèse|verdict|réponse|notre avis|recommandation)\b/i;
const RE_RESERVES = /^(réserves?|limites?|avertissements?|précautions?|points? de vigilance|à vérifier|mises? en garde)\b/i;
const RE_SOURCES = /^(sources?|références?|données utilisées)\b/i;

/** Blocs techniques jamais visibles comme du texte (puces cliquables, brouillon Studio). */
function sansBlocsTechniques(texte: string): string {
  return texte
    .replace(/```mimmoza-choix[\s\S]*?(```|$)/g, '')
    .replace(/```(?:jarvis|mimmoza-brief|mimmoza-jarvis)[\s\S]*?(```|$)/g, '')
    .trim();
}

/** Texte visible approximatif (pour mesurer la longueur), sans blocs de code ni balises Markdown. */
function texteVisible(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nbTitres(md: string): number {
  return md.split(/\r?\n/).filter((l) => /^#{2,3}\s+\S/.test(l.trim())).length;
}

/**
 * Vrai si la réponse mérite d'être présentée comme un document : longue
 * (≥ 1 400 caractères visibles), ou structurée (≥ 2 sous-titres et ≥ 700 caractères).
 */
export function estReponseDocument(texte: string | null | undefined): boolean {
  const md = sansBlocsTechniques(texte ?? '');
  if (!md) return false;
  const n = texteVisible(md).length;
  if (n >= SEUIL_DOCUMENT_CARS) return true;
  return n >= SEUIL_DOCUMENT_TITRES_CARS && nbTitres(md) >= 2;
}

/** « 1. Urbanisme », « **2) Marché** », « A — Bilan » → « Urbanisme », « Marché », « Bilan ». */
export function nettoyerTitre(titre: string): string {
  return titre
    .replace(/^\*\*(.*)\*\*$/, '$1')
    .replace(/^(?:\d{1,2}|[A-Z]|[IVX]{1,4})\s*[.)—–-]\s+/, '')
    .replace(/[:：]\s*$/, '')
    .trim();
}

interface Bloc { titre: string | null; niveau: number; lignes: string[] }

function decouperBlocs(md: string): Bloc[] {
  const blocs: Bloc[] = [{ titre: null, niveau: 0, lignes: [] }];
  let dansCode = false;
  for (const ligne of md.split(/\r?\n/)) {
    if (/^\s*```/.test(ligne)) dansCode = !dansCode;
    const t = dansCode ? null : TITRE_MD.exec(ligne.trim());
    if (t) blocs.push({ titre: nettoyerTitre(t[2]), niveau: t[1].length, lignes: [] });
    else blocs[blocs.length - 1].lignes.push(ligne);
  }
  return blocs;
}

const contenu = (b: Bloc) => b.lignes.join('\n').trim();

/** Type de document déduit de la question et du texte (libellé seulement, aucun effet métier). */
const TYPES: [RegExp, string][] = [
  [/bilan (promoteur|financier|d['’]opération)|marge promoteur|charge foncière/, 'Bilan d’opération'],
  [/parcelle|terrain|\bplu\b|constructib|cadastr/, 'Analyse de parcelle'],
  [/travaux|rénovation|renovation|chiffrage/, 'Estimation de travaux'],
  [/rendement|investiss|locatif|loyer/, 'Analyse d’investissement'],
  [/march[ée]|prix au m|\bdvf\b|comparables/, 'Étude de marché'],
];

/** Type de document : la QUESTION décide d'abord ; le début du texte seulement si la question ne dit rien. */
export function typeDocument(question: string | null | undefined, texte: string): string {
  for (const source of [(question ?? '').toLowerCase(), texte.slice(0, 600).toLowerCase()]) {
    const trouve = TYPES.find(([re]) => re.test(source));
    if (trouve) return trouve[1];
  }
  return 'Note d’analyse';
}

/** Titre du document : 1er titre de niveau 1 s'il existe, sinon la question raccourcie. */
export function titreDocument(question: string | null | undefined, blocs: { titre: string | null; niveau: number }[], type: string): string {
  const h1 = blocs.find((b) => b.niveau === 1 && b.titre);
  if (h1?.titre) return h1.titre;
  const q = (question ?? '').replace(/\s+/g, ' ').trim();
  if (!q) return type;
  const court = q.length > 110 ? `${q.slice(0, 107).replace(/\s+\S*$/, '')}…` : q;
  return court.charAt(0).toUpperCase() + court.slice(1);
}

export function dateLongue(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
}

/** Découpe une réponse Markdown en document. Mots inchangés ; seuls les titres sont nettoyés de leur numéro. */
export function construireDocumentReponse(params: {
  texte: string;
  question?: string | null;
  createdAt?: string | null;
}): DocumentReponse {
  const md = sansBlocsTechniques(params.texte);
  const blocs = decouperBlocs(md);
  const type = typeDocument(params.question, md);
  const titre = titreDocument(params.question, blocs, type);

  let conclusion = contenu(blocs[0]);
  const sections: SectionDocument[] = [];
  const reserves: string[] = [];
  const sources: string[] = [];

  for (const b of blocs.slice(1)) {
    const c = contenu(b);
    const t = b.titre ?? '';
    if (b.niveau === 1 && t === titre) { if (c) conclusion = conclusion ? `${conclusion}\n\n${c}` : c; continue; }
    if (RE_RESERVES.test(t)) { if (c) reserves.push(c); continue; }
    if (RE_SOURCES.test(t)) { if (c) sources.push(c); continue; }
    if (!conclusion && RE_CONCLUSION.test(t) && c) { conclusion = c; continue; }
    // Un sous-titre de niveau 3 sous une section reste DANS la section (pas de renumérotation).
    if (b.niveau === 3 && sections.length) {
      sections[sections.length - 1].markdown += `\n\n### ${t}\n${c}`;
      continue;
    }
    if (!c && !t) continue;
    sections.push({ titre: t || 'Détail', markdown: c });
  }

  return {
    type,
    titre,
    date: dateLongue(params.createdAt),
    conclusion,
    sections: sections.filter((s) => s.markdown.trim() || s.titre),
    reserves: reserves.length ? reserves.join('\n\n') : null,
    sources: sources.length ? sources.join('\n\n') : null,
  };
}

/** Longueur maximale du résumé affiché dans le chat. */
export const RESUME_CHAT_MAX_CARS = 360;

/**
 * Résumé affiché dans le fil du chat : les 1 à 3 premières phrases de la
 * conclusion (ou de la 1re section), sans dépasser ~360 caractères.
 * Le Markdown inline (gras) est conservé ; les listes sont aplaties.
 */
export function resumeChat(doc: DocumentReponse): string {
  const source = doc.conclusion || doc.sections[0]?.markdown || '';
  const premierBloc = source.split(/\n\s*\n/).find((p) => p.trim() && !/^\s*\|/.test(p)) ?? '';
  const aplati = premierBloc.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d{1,2}\.)\s+/, '').trim()).filter(Boolean).join(' ');
  let out = '';
  for (const ph of phrasesLisibles(aplati).slice(0, 3)) {
    const suivant = out ? `${out} ${ph}` : ph;
    if (suivant.length > RESUME_CHAT_MAX_CARS && out) break;
    out = suivant;
  }
  if (out.length > RESUME_CHAT_MAX_CARS) out = `${out.slice(0, RESUME_CHAT_MAX_CARS - 1).replace(/\s+\S*$/, '')}…`;
  return out;
}

/**
 * Titre d'un objectif de mission : la phrase d'annonce finale (« La mission doit : »,
 * « Points à traiter : ») est retirée ; un « : » final seul est ôté. Mots inchangés sinon.
 */
export function titreObjectif(titre: string | null | undefined): string {
  const t = (titre ?? '').replace(/\s+/g, ' ').trim();
  if (!t.endsWith(':')) return t;
  const phrases = phrasesLisibles(t);
  if (phrases.length > 1) return phrases.slice(0, -1).join(' ').trim();
  return t.replace(/\s*:\s*$/, '').trim();
}

/** Points d'un objectif de mission (Markdown « - … » / « 1. … ») → textes, un par point. */
export function pointsListe(detail: string | null | undefined): string[] {
  if (!detail) return [];
  return detail.split(/\r?\n/)
    .map((l) => /^\s*(?:[-*•]|\d{1,2}[.)])\s+(.*)$/.exec(l)?.[1]?.trim() ?? '')
    .filter(Boolean);
}
