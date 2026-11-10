// supabase/functions/_shared/documents/dispositionsCommunes.ts
// =============================================================
// Lot C8 « dispositions communes » (essai témoin n° 5 du 10/11/2026, Montreuil, PLUi Est Ensemble).
//
// Constat : après le lot C5, la mission « conception » lit 7 règles sur 9. Les deux manquantes —
// STATIONNEMENT et MIXITÉ SOCIALE — ne sont ni dans le chapitre de la zone ni dans les fiches
// d'indices : elles sont dans la partie « III DISPOSITIONS COMMUNES EN TOUTES ZONES » du règlement,
// que la sélection des pages ne renvoyait pas. Structure relevée en base le 10/11/2026 :
//   · stationnement p. 89-95 (« e. Stationnement 1. Dispositions écrites : … ») ; seule la p. 89
//     porte « place par logement » ; les p. 93-95 (accès mécanisés, locaux vélos, industrie) ne
//     répètent pas forcément le mot « stationnement » ;
//   · mixité fonctionnelle p. 103-109 (« a. La mixité fonctionnelle », linéaires, L. 151-16) ;
//   · mixité sociale p. 110-113 (« b. La mixité sociale », périmètres du document graphique) ;
//   · la mention courante « DISPOSITIONS COMMUNES EN TOUTES ZONES » figure sur presque toutes les
//     pages de la partie : elle dit la PARTIE, jamais le thème.
//
// Ce module est PUR et DÉTERMINISTE (aucun modèle, aucun réseau). Il ne lit aucune règle : il
// repère, à partir du seul texte des pages, QUELLES PAGES des parties communes traitent de chaque
// thème, et assemble leur texte sous une étiquette. La valeur des règles reste extraite ensuite,
// sur ces pages, avec citation. Rien n'est trouvé → c'est dit (« non trouvé dans le document ») ;
// aucune règle n'est jamais déduite ni complétée.
//
// Trois thèmes, dans l'ordre de priorité : stationnement, mixité sociale (logements sociaux
// imposés — ce qui compte pour un promoteur), puis mixité fonctionnelle (linéaires de
// rez-de-chaussée), FACULTATIVE : jointe seulement si elle tient en entier dans la place restante,
// sinon signalée « repérée, non jointe » avec ses pages. Elle ne prend jamais la place des deux autres.
//
// Principe :
//   1. PAGES NOYAUX : chaque page reçoit une note par thème (occurrences du mot-clé, tournures de
//      norme — « place par logement », « mixité sociale », « L. 151-15 » —, titre en tête de page),
//      sur un texte normalisé : sans accents, sans casse, césures recollées (« station-\nnement »),
//      titres en lettres espacées recollés ;
//   2. thème DÉJÀ traité, norme chiffrée à l'appui, dans les pages retenues pour la zone (PLU
//      classique : « Article UC 12 – Stationnement ») → rien n'est ajouté en double ;
//   3. un noyau n'est candidat que dans une partie commune : la page porte elle-même la mention
//      « dispositions communes / générales / toutes zones » sans en-tête de zone, OU elle précède
//      le premier chapitre de zone (hors sommaires, fiches d'indices, partie « dispositions
//      particulières ») ;
//   4. SUITE : un passage continue sur les pages suivantes tant qu'elles restent dans le champ
//      lexical du thème (vélos, voitures, « % de l'effectif »… pour le stationnement), une page
//      creuse tolérée au milieu, et s'arrête au titre d'un autre thème ;
//   5. le meilleur passage est retenu (norme chiffrée, titre, annonce du sommaire départagent),
//      borné en pages et en caractères. Les autres passages sont signalés, jamais passés sous silence.
// =============================================================

import { assemblerTexte, enTetesZones, plagesLisibles, type ChapitreZone } from './lectureCiblee.ts';
import { familleDeLaPage } from './reglementIndices.ts';

export type ThemeCommun = 'stationnement' | 'mixite_sociale' | 'mixite_fonctionnelle';

/** Pages jointes au plus par thème (le stationnement d'Est Ensemble en compte 7). */
export const MAX_PAGES_PAR_THEME = 8;
/** Longueur maximale d'un passage suivi de proche en proche (garde-fou). */
export const MAX_PAGES_PASSAGE = 14;
/** Plafond de caractères ajoutés pour l'ensemble des thèmes (≈ 12 000 tokens). */
export const MAX_CARACTERES_COMMUNES = 36_000;
/** Note minimale d'une page pour qu'elle soit un NOYAU du thème. */
export const SEUIL_PAGE = 5;
/** Une page de SUITE doit porter au moins un terme du champ lexical par tranche de ce nombre de caractères. */
export const CARACTERES_PAR_TERME_SUITE = 1_500;
/** En-dessous, on n'ajoute même pas la ligne d'étiquette (le budget de lecture est épuisé). */
const RESTE_MINIMAL = 400;

export interface DefTheme {
  theme: ThemeCommun;
  libelle: string;
  /** Faux : thème joint seulement s'il tient en entier après les thèmes essentiels. */
  essentiel: boolean;
  /** Préfiltre peu coûteux sur le texte brut (évite de normaliser 600 pages). */
  amorce: RegExp;
  /** Mots-clés simples : 1 point par occurrence (plafonné). */
  mots: RegExp;
  /** Tournures de norme ou de titre de servitude : 3 points par occurrence (plafonné). */
  forts: RegExp;
  /** Ligne courte qui a la forme d'un titre du thème (texte normalisé). */
  titre: RegExp;
  /** Le mot-clé du titre, tel qu'il s'écrit dans le texte brut (pour citer le titre d'un texte sans retours à la ligne). */
  titreBrut: string;
  /** Champ lexical : ce qui fait qu'une page SUIVANTE continue le passage. */
  champ: RegExp;
  /** Norme chiffrée : exigée pour dire que le thème est DÉJÀ traité dans les pages lues. */
  norme: RegExp;
}

const LOGEMENT_SOCIAL = '(?:logements? (?:locatifs? )?(?:sociaux|social|aides?)|mixite sociale)';
const LINEAIRE = 'lineaires? (?:actifs?|commerciaux|commercial|de commerces?|artisana\\w+)';

export const THEMES_COMMUNS: readonly DefTheme[] = [
  {
    theme: 'stationnement',
    libelle: 'stationnement',
    essentiel: true,
    amorce: /station/i,
    mots: /stationnement/g,
    forts: new RegExp(
      [
        'places? (?:de stationnement )?(?:par|pour) (?:\\d+ |chaque |tout )?logements?',
        'places? (?:de stationnement )?(?:par|pour) (?:tranche (?:entamee |complete )?de )?\\d[\\d ]* ?m ?(?:2|²)',
        'normes? (?:minimales? |maximales? |plancher |plafond )?(?:de|en matiere de) stationnement',
        'obligations? (?:minimales? |imposees? )?(?:en matiere )?de (?:realisation d\'aires de )?stationnement',
        'stationnement des (?:velos|cycles|deux[- ]roues|vehicules)',
        'plan de stationnement',
      ].join('|'), 'g'),
    titre: /^.{0,60}?\bstationnement\b/,
    titreBrut: 'stationnement',
    champ: /stationnement|\bplaces?\b|\bparkings?\b|\bvelos?\b|\bvoitures?\b|trottinettes?|poussettes?|deux[- ]roues|\bcycles?\b|\bgarages?\b|% de l'effectif/g,
    norme: /\d+(?:[.,]\d+)? ?places?\b|\bplaces? (?:de stationnement )?(?:par|pour)\b|\bune place\b/,
  },
  {
    theme: 'mixite_sociale',
    libelle: 'mixité sociale',
    essentiel: true,
    amorce: /mixit|socia|151-15/i,
    mots: /mixite sociale|logements? (?:locatifs? )?sociaux|logement (?:locatif )?social/g,
    forts: new RegExp(
      [
        'mixite sociale',
        'l\\.? ?151-15\\b',
        `\\d{1,3} ?% [^.]{0,80}${LOGEMENT_SOCIAL}`,
      ].join('|'), 'g'),
    titre: /^.{0,60}?\b(?:mixite sociale|logements? (?:locatifs? )?sociaux|logement (?:locatif )?social)\b/,
    titreBrut: 'mixit[ée] sociale|logements? (?:locatifs? )?sociaux|logement (?:locatif )?social',
    champ: /mixite sociale|\blogements?\b|\bsoci(?:al|ale|aux)\b|\bzac\b|emplacements? reserves?|surface de plancher/g,
    norme: new RegExp(`${LOGEMENT_SOCIAL}[^.]{0,200}\\d{1,3} ?%|\\d{1,3} ?%[^.]{0,200}${LOGEMENT_SOCIAL}`),
  },
  {
    theme: 'mixite_fonctionnelle',
    libelle: 'mixité fonctionnelle',
    essentiel: false,
    amorce: /mixit|lin[ée]aire|151-16|commerciale/i,
    mots: new RegExp(`mixite fonctionnelle|${LINEAIRE}|diversite commerciale`, 'g'),
    forts: new RegExp(`mixite fonctionnelle|l\\.? ?151-16\\b|${LINEAIRE}`, 'g'),
    titre: /^.{0,60}?\b(?:mixite fonctionnelle|diversite commerciale)\b/,
    titreBrut: 'mixit[ée] fonctionnelle|diversit[ée] commerciale',
    champ: /mixite fonctionnelle|lineaires?|\bcommerc\w+|rez-de-chaussee|artisana\w+|l\.? ?151-16\b/g,
    norme: new RegExp(`${LINEAIRE}|l\\.? ?151-16\\b`),
  },
];

/**
 * Texte normalisé pour le repérage : minuscules, sans accents, apostrophes droites, césures
 * recollées (« station-\nnement », « station- nement »), lettres espacées recollées, blancs réduits.
 * Ne sert QU'AU REPÉRAGE : le texte rendu au lecteur est toujours celui du règlement.
 */
export function normaliserPourReperage(texte: string): string {
  return (texte ?? '')
    .replace(/­/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/([a-z])[-‐‑]\s*\n\s*([a-z])/g, '$1$2')
    .replace(/([a-z])[-‐‑] +(?=[a-z])/g, '$1')
    .replace(/\b(?:[a-z] ){4,}[a-z]\b/g, (m) => m.replace(/ /g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

const compter = (t: string, re: RegExp): number => {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(t) !== null) { n++; if (n > 50) break; }
  re.lastIndex = 0;
  return n;
};

/**
 * Titre du thème sur la page, tel qu'écrit ; null sinon.
 *  · texte avec retours à la ligne : une ligne courte, le mot-clé en tête (« 4. Stationnement ») ;
 *  · texte d'un seul tenant : le mot-clé dans les 110 premiers caractères, précédé d'un repère de
 *    plan (« e. », « 4. ») ou écrit avec une majuscule (« e. Stationnement », « b. La mixité sociale »).
 *    Un mot en minuscules dans une phrase (« …le stationnement des… ») n'est pas un titre.
 */
export function titreDuTheme(brut: string, def: DefTheme): string | null {
  const texte = (brut ?? '').replace(/­/g, '');
  if (!texte.includes('\n')) {
    const tete = texte.slice(0, 110);
    if (/\.{4,}|…{2,}|(?:\. ){4,}/.test(tete)) return null;   // ligne de sommaire
    if (!def.titre.test(normaliserPourReperage(tete))) return null;
    const m = new RegExp(`(\\b(?:[a-zA-Z]|\\d{1,2}|[IVX]{1,4})[.)]\\s+)?((?:la|le|les)\\s+)?(?:${def.titreBrut})`, 'i').exec(tete);
    if (!m) return null;
    const corps = m[0].slice((m[1] ?? '').length);
    if (!m[1] && corps.charAt(0) === corps.charAt(0).toLowerCase()) return null;
    return m[0].replace(/\s+/g, ' ').trim();
  }
  const lignes = texte.split('\n');
  for (let i = 0; i < lignes.length; i++) {
    // Un titre peut être coupé sur deux lignes par une césure : on recolle la suivante pour le test.
    const l = lignes[i].trim();
    if (l.length < 4 || l.length > 110) continue;
    const suite = /[-‐‑]$/.test(l) && lignes[i + 1] ? `${l}\n${lignes[i + 1]}` : l;
    const n = normaliserPourReperage(suite);
    if (/[,;]$/.test(n)) continue;
    // Une ligne de sommaire (points de conduite) n'est pas un titre de la page.
    if (/\.{4,}|…{2,}|(?:\. ){4,}/.test(l)) continue;
    if (def.titre.test(n)) return suite.replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  return null;
}

export interface NotePage { note: number; mots: number; forts: number; titre: string | null; norme: boolean }

/** Note d'une page pour un thème. */
export function noterPage(brut: string, def: DefTheme): NotePage {
  if (!brut || !def.amorce.test(brut)) return { note: 0, mots: 0, forts: 0, titre: null, norme: false };
  const t = normaliserPourReperage(brut);
  const mots = compter(t, def.mots);
  if (mots === 0 && compter(t, def.forts) === 0) return { note: 0, mots: 0, forts: 0, titre: null, norme: false };
  const forts = compter(t, def.forts);
  const titre = titreDuTheme(brut, def);
  const note = Math.min(mots, 6) + 3 * Math.min(forts, 4) + (titre ? 3 : 0);
  return { note, mots, forts, titre, norme: def.norme.test(t) };
}

/** Nombre de termes du champ lexical du thème sur la page (pages de SUITE). */
export function termesDuChamp(brut: string, def: DefTheme): number {
  return brut ? compter(normaliserPourReperage(brut), def.champ) : 0;
}

const RE_POINTS_CONDUITE = /\.{4,}\s*\d{1,4}|…{2,}\s*\d{1,4}|(?:\. ){4,}\s*\d{1,4}/g;

/** Page de sommaire : au moins quatre lignes « titre ........ 12 ». */
export function estSommaire(brut: string): boolean {
  return compter(brut ?? '', RE_POINTS_CONDUITE) >= 4;
}

export interface EntreeSommaire { titre: string; page_annoncee: number }

/** Entrée du sommaire qui annonce le thème (titre tel qu'écrit, page telle qu'imprimée). */
export function entreeSommaire(pages: readonly string[], sommaires: readonly number[], def: DefTheme): EntreeSommaire | null {
  const re = /(?:\.{4,}|…{2,}|(?:\. ){4,})\s*(\d{1,4})/g;
  for (const n of sommaires) {
    const brut = pages[n - 1] ?? '';
    if (!def.amorce.test(brut)) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let fin = 0;
    while ((m = re.exec(brut)) !== null) {
      // Le titre : ce qui précède les points de conduite, depuis l'entrée précédente ou le début de la ligne.
      const avant = brut.slice(fin, m.index);
      const titre = avant.slice(avant.lastIndexOf('\n') + 1).replace(/\s+/g, ' ').trim().slice(-120);
      fin = m.index + m[0].length;
      if (titre.length >= 3 && compter(normaliserPourReperage(titre), def.mots) > 0) return { titre, page_annoncee: Number(m[1]) };
    }
  }
  return null;
}

const RE_PARTIE_COMMUNE = /dispositions (?:communes|generales)|regles communes|(?:applicables?|communes?|valables?) (?:a|dans|en|pour) (?:toutes? )?(?:les )?(?:zones|l'ensemble des zones)|toutes zones/;
const RE_PARTIE_PARTICULIERE = /dispositions (?:particulieres|specifiques|propres) (?:applicables? )?(?:a la|aux|a chaque|de la|des) zones?|fiches? d'indices?/;
const RE_ARTICLE_DE_ZONE = /\barticle [1-9]?(?:au|u|a|n)[a-z]{0,3} ?[-.]? ?\d{1,2}\b/;

/** Partie du règlement que la page dit elle-même porter (en-tête courant, titre) ; null si elle ne dit rien, ou les deux. */
export function partieDeLaPage(brut: string): 'commune' | 'particuliere' | null {
  const t = normaliserPourReperage(brut);
  const c = RE_PARTIE_COMMUNE.test(t);
  const p = RE_PARTIE_PARTICULIERE.test(t);
  if (c === p) return null;
  return c ? 'commune' : 'particuliere';
}

/** La page porte-t-elle un en-tête de zone ou un titre d'article de zone (« Article UA 12 ») ? */
export function porteUneZone(brut: string): boolean {
  if (enTetesZones([brut ?? '']).entetes.length > 0) return true;
  return RE_ARTICLE_DE_ZONE.test(normaliserPourReperage(brut));
}

export type StatutDisposition = 'jointe' | 'deja_dans_les_pages_lues' | 'reperee_non_jointe' | 'non_trouvee';

export interface DispositionCommune {
  theme: ThemeCommun;
  libelle: string;
  /** Faux pour la mixité fonctionnelle : jointe seulement si elle tient en entier après les thèmes essentiels. */
  essentiel: boolean;
  statut: StatutDisposition;
  /** Phrase en français, lisible telle quelle. */
  message: string;
  /** 'jointe' : pages ajoutées au texte. 'deja_dans_les_pages_lues' : pages déjà lues qui en traitent. Sinon vide. */
  pages: number[];
  /** Les mêmes, en plages lisibles (« 89-95 »). */
  plages: string;
  /** Toutes les pages du passage retenu (peut dépasser `pages` : plafond de pages ou de caractères). */
  pages_reperees: number[];
  /** Pages d'autres passages qui traitent aussi du thème, NON jointes. */
  autres_pages: number[];
  /** Titre repéré sur la première page du passage, tel qu'écrit ; null si aucun. */
  titre: string | null;
  /** Ce que le sommaire annonce pour ce thème (numéro imprimé, qui peut différer du numéro de page du fichier). */
  sommaire: EntreeSommaire | null;
  /** Ce qui fait dire que ces pages sont « communes ». */
  contexte: 'mention_dispositions_communes' | 'avant_les_chapitres_de_zone' | null;
  /** Vrai si des pages repérées n'ont pas été jointes, ou si une page a été coupée. */
  tronque: boolean;
}

export interface ResultatDispositionsCommunes {
  themes: DispositionCommune[];
  /** Pages jointes, tous thèmes confondus, triées. */
  pages: number[];
  /** Bloc à placer APRÈS le texte de la zone ('' si rien à dire). */
  texte: string;
  tronque: boolean;
}

export interface OptionsDispositionsCommunes {
  /** Chapitres de zone du règlement (selectionnerPages().chapitres). */
  chapitres: readonly ChapitreZone[];
  /** Pages déjà retenues pour la zone (chapitre, fiches d'indices, dispositions générales, lexique). */
  pagesLues: readonly number[];
  /** Caractères encore disponibles dans la réponse (budget total moins le texte déjà assemblé). */
  maxCaracteres: number;
  themes?: readonly ThemeCommun[];
}

const ENTETE_BLOC =
  '[Dispositions communes du règlement — pages ajoutées par Mimmoza, situées HORS du chapitre de la zone]\n' +
  'Ces pages ont été repérées par mots-clés, sans interprétation. Le texte dit lui-même à quelles zones, communes ou ' +
  'secteurs chaque règle s\'applique : ne retiens que ce qui vise la zone et la commune de la parcelle. Une règle qui ' +
  'dépend d\'un périmètre du règlement graphique reste « par secteur » tant que ce périmètre n\'est pas connu. ' +
  'Cite chaque règle avec sa page.';

const debutPlage = (pages: readonly number[]) =>
  pages.length === 0 ? '' : pages.length === 1 ? `page ${pages[0]}` : `pages ${plagesLisibles(pages).replace(/-/g, ' à ')}`;

interface Passage { pages: number[]; total: number }
interface Travail {
  def: DefTheme; notes: Map<number, NotePage>; sommaire: EntreeSommaire | null;
  fini?: DispositionCommune; ligne?: string;
  passage?: Passage; autres?: number[]; contexte?: DispositionCommune['contexte']; titre?: string | null;
  aJoindre?: number[]; choisies?: number[]; besoin?: number;
}

/**
 * Repère les pages des dispositions communes qui traitent du stationnement et de la mixité, et
 * assemble leur texte étiqueté. Ne modifie rien de la sélection existante.
 */
export function repererDispositionsCommunes(pages: readonly string[], opts: OptionsDispositionsCommunes): ResultatDispositionsCommunes {
  const defs = THEMES_COMMUNS.filter((d) => !opts.themes || opts.themes.includes(d.theme));
  const lues = new Set(opts.pagesLues);
  const sommaires = new Set<number>(enTetesZones(pages).sommaires);
  pages.forEach((p, i) => { if (estSommaire(p)) sommaires.add(i + 1); });
  // Tout ce qui suit le début du premier chapitre de zone est « partie des zones » (un chapitre borné à
  // 80 pages par lectureCiblee laisse des pages orphelines : elles ne sont pas communes pour autant).
  const premierChapitre = opts.chapitres.length ? Math.min(...opts.chapitres.map((c) => c.debut)) : pages.length + 1;
  const memo = <T>(f: (n: number) => T) => { const m = new Map<number, T>(); return (n: number) => { if (!m.has(n)) m.set(n, f(n)); return m.get(n)!; }; };
  const partieDe = memo((n) => partieDeLaPage(pages[n - 1] ?? ''));
  const zoneSur = memo((n) => porteUneZone(pages[n - 1] ?? ''));
  const fiche = memo((n) => familleDeLaPage(pages[n - 1] ?? '') != null);
  /** Page qui peut appartenir à un passage commun (noyau ou suite). */
  const admissible = (n: number) => n >= 1 && n <= pages.length && !sommaires.has(n) && !fiche(n) && partieDe(n) !== 'particuliere';
  /** Noyau : la page dit elle-même « dispositions communes » (sans en-tête de zone), ou précède le premier chapitre de zone. */
  const contexteDe = (n: number): DispositionCommune['contexte'] =>
    partieDe(n) === 'commune' && !zoneSur(n) ? 'mention_dispositions_communes' : n < premierChapitre ? 'avant_les_chapitres_de_zone' : null;

  // Notes de toutes les pages pour TOUS les thèmes : le titre d'un autre thème arrête un passage.
  const notesDe = new Map<ThemeCommun, Map<number, NotePage>>();
  for (const def of THEMES_COMMUNS) {
    const notes = new Map<number, NotePage>();
    pages.forEach((p, i) => { const x = noterPage(p, def); if (x.note > 0) notes.set(i + 1, x); });
    notesDe.set(def.theme, notes);
  }
  const titreDunAutreTheme = (n: number, theme: ThemeCommun) =>
    THEMES_COMMUNS.some((d) => d.theme !== theme && !!notesDe.get(d.theme)!.get(n)?.titre && (notesDe.get(d.theme)!.get(n)?.note ?? 0) >= SEUIL_PAGE);

  // ── Étape A : pour chaque thème, déjà lu / non trouvé / meilleur passage ──
  const travaux: Travail[] = defs.map((def) => {
    const notes = notesDe.get(def.theme)!;
    const sommaire = entreeSommaire(pages, Array.from(sommaires), def);
    const t: Travail = { def, notes, sommaire };
    const base = { theme: def.theme, libelle: def.libelle, essentiel: def.essentiel, sommaire };
    const vide = { pages: [] as number[], plages: '', pages_reperees: [] as number[], autres_pages: [] as number[], titre: null, contexte: null, tronque: false };

    // 1. Déjà traité, norme chiffrée à l'appui, dans les pages lues pour la zone → rien en double.
    const dejaLues = Array.from(lues).filter((n) => {
      const x = notes.get(n);
      return !!x && x.note >= SEUIL_PAGE && x.norme && !sommaires.has(n);
    }).sort((a, b) => a - b);
    if (dejaLues.length) {
      t.fini = {
        ...base, ...vide, statut: 'deja_dans_les_pages_lues', pages: dejaLues, plages: plagesLisibles(dejaLues),
        titre: dejaLues.map((n) => notes.get(n)!.titre).find((x) => !!x) ?? null,
        message: `${majuscule(def.libelle)} : déjà traité dans les pages lues pour la zone (${debutPlage(dejaLues)}) ; aucune page ajoutée.`,
      };
      return t;
    }

    // 2. Noyaux des parties communes.
    const estNoyau = (n: number) => (notes.get(n)?.note ?? 0) >= SEUIL_PAGE && admissible(n) && contexteDe(n) != null;
    const noyaux = Array.from(notes.keys()).filter(estNoyau).sort((a, b) => a - b);
    if (!noyaux.length) {
      t.fini = {
        ...base, ...vide, statut: 'non_trouvee',
        message: `${majuscule(def.libelle)} : non trouvé dans le document (aucune page des dispositions communes de ce fichier n'en traite, ` +
          `${pages.length} pages examinées). Ce n'est pas une absence de règle : elle peut figurer dans une autre pièce du PLU ` +
          `(annexe, orientation d'aménagement, règlement graphique) ou être formulée autrement.`,
      };
      if (def.essentiel) {
        t.ligne = `[Dispositions communes — ${def.libelle} : NON TROUVÉ dans le document par le repérage automatique. ` +
          `Cela ne veut pas dire « non réglementé » : n'en déduis aucune règle, signale-le comme non trouvé.]`;
      }
      return t;
    }

    // 3. Passages : chaque noyau, prolongé de proche en proche par ses pages de suite.
    const suite = (n: number) => admissible(n) && !zoneSur(n) && !titreDunAutreTheme(n, def.theme)
      && termesDuChamp(pages[n - 1] ?? '', def) >= Math.max(1, Math.floor((pages[n - 1] ?? '').length / CARACTERES_PAR_TERME_SUITE));
    const passages: Passage[] = [];
    const prises = new Set<number>();
    for (const n of noyaux) {
      if (prises.has(n)) continue;
      const pp = [n];
      for (let p = n + 1; pp.length < MAX_PAGES_PASSAGE; p++) {
        if (titreDunAutreTheme(p, def.theme) && !estNoyau(p)) break;
        if (estNoyau(p) || suite(p)) { pp.push(p); continue; }
        // Une page creuse (tableau, schéma) ne coupe pas le passage si la suivante le continue.
        const apres = p + 1;
        if (admissible(p) && !zoneSur(p) && !titreDunAutreTheme(p, def.theme) && pp.length + 1 < MAX_PAGES_PASSAGE
          && !(titreDunAutreTheme(apres, def.theme) && !estNoyau(apres)) && (estNoyau(apres) || suite(apres))) {
          pp.push(p, apres); p = apres; continue;
        }
        break;
      }
      pp.forEach((p) => prises.add(p));
      passages.push({ pages: pp, total: pp.reduce((x, p) => x + (notes.get(p)?.note ?? 0), 0) });
    }

    // 4. Meilleur passage ; norme chiffrée, titre et sommaire départagent.
    const prime = (g: Passage) => (sommaire && g.pages.some((p) => p >= sommaire.page_annoncee - 3 && p <= sommaire.page_annoncee + 10) ? 6 : 0)
      + (g.pages.some((p) => !!notes.get(p)?.titre) ? 3 : 0)
      + (g.pages.some((p) => notes.get(p)?.norme) ? SEUIL_PAGE : 0);
    const meilleur = passages.reduce((x, y) => (y.total + prime(y) > x.total + prime(x) ? y : x));
    // Pages du passage déjà lues avec la zone (dispositions générales d'un PLU classique) : jamais jointes deux fois.
    const aJoindre = meilleur.pages.filter((p) => !lues.has(p));
    if (!aJoindre.length) {
      t.fini = {
        ...base, ...vide, statut: 'deja_dans_les_pages_lues', pages: meilleur.pages, plages: plagesLisibles(meilleur.pages), pages_reperees: meilleur.pages,
        titre: meilleur.pages.map((p) => notes.get(p)?.titre ?? null).find((x) => !!x) ?? null,
        message: `${majuscule(def.libelle)} : déjà dans les pages lues pour la zone (${debutPlage(meilleur.pages)}) ; aucune page ajoutée.`,
      };
      return t;
    }
    t.passage = meilleur;
    t.aJoindre = aJoindre;
    t.autres = passages.filter((g) => g !== meilleur).flatMap((g) => g.pages);
    t.contexte = contexteDe(meilleur.pages[0]);
    t.titre = meilleur.pages.map((p) => notes.get(p)?.titre ?? null).find((x) => !!x) ?? null;
    // Au-delà du plafond de pages : les mieux notées d'abord (la norme chiffrée compte double), la première toujours.
    const poids = (p: number) => (notes.get(p)?.note ?? 0) + (notes.get(p)?.norme ? SEUIL_PAGE : 0);
    const ordre = aJoindre.length <= MAX_PAGES_PAR_THEME ? aJoindre : [...aJoindre].sort((a, b) => poids(b) - poids(a) || a - b);
    t.choisies = Array.from(new Set([aJoindre[0], ...ordre])).slice(0, MAX_PAGES_PAR_THEME);
    t.besoin = etiquette(def, t.choisies).length + 1 + t.choisies.reduce((x, p) => x + (pages[p - 1] ?? '').length + 16, 0);
    return t;
  });

  // ── Étape B : budget. Les thèmes essentiels d'abord, chacun sa part ; le facultatif en entier ou pas du tout. ──
  const budgetInitial = Math.max(0, Math.min(MAX_CARACTERES_COMMUNES, Math.floor(opts.maxCaracteres)));
  // Réserve : l'en-tête du bloc et une ligne par thème.
  let reste = Math.max(0, budgetInitial - ENTETE_BLOC.length - 2 - 320 * defs.length);
  const blocs: string[] = [];
  const ordreBudget = [...travaux.filter((t) => t.def.essentiel), ...travaux.filter((t) => !t.def.essentiel)];
  for (const t of ordreBudget) {
    if (t.fini || !t.passage || !t.choisies) continue;
    const { def } = t;
    const meilleur = t.passage, autres = t.autres ?? [], aJoindre = t.aJoindre ?? t.passage.pages;
    const dejaLuesDuPassage = meilleur.pages.filter((p) => lues.has(p));
    const base = { theme: def.theme, libelle: def.libelle, essentiel: def.essentiel, sommaire: t.sommaire };
    const aVenir = ordreBudget.slice(ordreBudget.indexOf(t) + 1).filter((x) => x.def.essentiel && !x.fini && x.besoin != null);
    // Part du thème : au moins sa part égale, et tout ce que les thèmes essentiels suivants n'utiliseront pas.
    const budget = def.essentiel
      ? Math.max(Math.floor(reste / (aVenir.length + 1)), reste - aVenir.reduce((x, y) => x + y.besoin!, 0))
      : reste;
    const gardees: number[] = [];
    if (!def.essentiel) {
      if (t.besoin! <= budget) gardees.push(...t.choisies);
    } else {
      let pris = etiquette(def, t.choisies).length + 1;
      for (const p of t.choisies) {
        const l = (pages[p - 1] ?? '').length + 16;
        if (pris + l <= budget) { gardees.push(p); pris += l; continue; }
        // Page plus longue que le budget : jointe seule et coupée (c'est dit), si la place restante a un sens.
        if (!gardees.length && budget - pris >= RESTE_MINIMAL) gardees.push(p);
        break;
      }
    }
    gardees.sort((a, b) => a - b);
    if (!gardees.length) {
      t.fini = {
        ...base, statut: 'reperee_non_jointe', pages: [], plages: '', pages_reperees: meilleur.pages, autres_pages: autres,
        titre: t.titre ?? null, contexte: t.contexte ?? null, tronque: true,
        message: `${majuscule(def.libelle)} : traité ${debutPlage(meilleur.pages)} des dispositions communes, pages non jointes ` +
          `(${def.essentiel ? 'budget de lecture atteint' : 'thème secondaire, place insuffisante après le stationnement et la mixité sociale'}). ` +
          `Redemander ces pages pour les lire.`,
      };
      t.ligne = `[Dispositions communes — ${def.libelle} : repéré ${debutPlage(meilleur.pages)}, NON JOINT ` +
        `(${def.essentiel ? 'budget de lecture atteint' : 'thème secondaire, place insuffisante'}). Aucune règle de ce thème n'est lue ici.]`;
      continue;
    }
    const tete = etiquette(def, gardees);
    const corps = assemblerTexte(pages, gardees, Math.max(RESTE_MINIMAL, budget - tete.length - 1));
    const bloc = `${tete}\n${corps}`;
    reste = Math.max(0, reste - bloc.length - 2);
    const coupe = corps.includes('budget de lecture atteint');
    blocs.push(bloc);
    t.fini = {
      ...base, statut: 'jointe', pages: gardees, plages: plagesLisibles(gardees), pages_reperees: meilleur.pages, autres_pages: autres,
      titre: t.titre ?? null, contexte: t.contexte ?? null, tronque: coupe || gardees.length < aJoindre.length,
      message: `${majuscule(def.libelle)} : dispositions communes, ${debutPlage(gardees)}` +
        (t.titre ? ` (titre repéré : « ${t.titre} »)` : '') +
        (gardees.length < aJoindre.length ? ` ; le passage s'étend ${debutPlage(meilleur.pages)}, toutes ses pages n'ont pas pu être jointes` : '') +
        (dejaLuesDuPassage.length ? ` ; ${debutPlage(dejaLuesDuPassage)} du même passage déjà lue(s) avec la zone` : '') +
        (coupe ? ' ; dernière page coupée (budget de lecture atteint)' : '') +
        (autres.length ? ` ; le thème est aussi abordé ${debutPlage(autres)} (non jointes)` : '') + '.',
    };
  }

  // ── Assemblage, dans l'ordre des thèmes. Rien à dire (tout est déjà dans les pages lues) → aucun texte ajouté. ──
  const themes = travaux.map((t) => t.fini!);
  const lignes = travaux.map((t) => t.ligne).filter((l): l is string => !!l);
  const blocsOrdonnes = travaux.map((t) => blocs.find((b) => b.startsWith(`[Dispositions communes — ${t.def.libelle} — `))).filter((b): b is string => !!b);
  const morceaux: string[] = [];
  if (blocsOrdonnes.length) morceaux.push(ENTETE_BLOC, ...blocsOrdonnes);
  morceaux.push(...lignes);
  let texte = morceaux.join('\n\n');
  if (texte.length > budgetInitial) {
    // Budget trop court même pour les étiquettes : on ne garde que les lignes qui tiennent, jamais un texte coupé au hasard.
    const tenus: string[] = [];
    let total = 0;
    for (const m of lignes) { if (total + m.length + 2 <= budgetInitial) { tenus.push(m); total += m.length + 2; } }
    for (const t of themes) {
      if (t.statut === 'jointe') {
        t.statut = 'reperee_non_jointe'; t.tronque = true; t.pages = []; t.plages = '';
        t.message = `${majuscule(t.libelle)} : traité ${debutPlage(t.pages_reperees)} des dispositions communes, pages non jointes (budget de lecture atteint).`;
      }
    }
    texte = tenus.join('\n\n');
  }
  const jointes = Array.from(new Set(themes.filter((t) => t.statut === 'jointe').flatMap((t) => t.pages))).sort((a, b) => a - b);
  return { themes, pages: jointes, texte, tronque: themes.some((t) => t.tronque) };
}

function etiquette(def: DefTheme, jointes: readonly number[]): string {
  return `[Dispositions communes — ${def.libelle} — ${debutPlage(jointes)}]`;
}

function majuscule(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Champs FACULTATIFS ajoutés à la réponse de plu-reglement-v1 (les anciens champs ne changent pas de sens). */
export interface ChampsDispositionsCommunes {
  /** Un élément par thème cherché (stationnement, mixité sociale, mixité fonctionnelle), toujours présent : joint, déjà lu, repéré non joint, ou « non trouvé ». */
  dispositions_communes: DispositionCommune[];
  /** Pages jointes au titre des dispositions communes, en plages lisibles ('' si aucune). */
  pages_dispositions_communes: string;
  /** Vrai si des pages repérées n'ont pas pu être jointes en entier. Distinct de `tronque` (chapitre de la zone). */
  dispositions_communes_tronque: boolean;
  /** Longueur du texte de la zone seul : `texte.slice(0, caracteres_texte_zone)` est le texte d'avant ce lot. */
  caracteres_texte_zone: number;
}

/**
 * Texte de la zone + bloc des dispositions communes, dans le budget TOTAL `maxCaracteres` : le texte de la
 * zone est prioritaire et rendu tel quel, le bloc n'occupe que la place restante.
 */
export function joindreDispositionsCommunes(
  pages: readonly string[], texteZone: string,
  opts: { chapitres: readonly ChapitreZone[]; pagesLues: readonly number[]; maxCaracteres: number },
): { texte: string; champs: ChampsDispositionsCommunes } {
  const r = repererDispositionsCommunes(pages, {
    chapitres: opts.chapitres, pagesLues: opts.pagesLues, maxCaracteres: opts.maxCaracteres - texteZone.length - 2,
  });
  return {
    texte: r.texte ? `${texteZone}\n\n${r.texte}` : texteZone,
    champs: {
      dispositions_communes: r.themes,
      pages_dispositions_communes: plagesLisibles(r.pages),
      dispositions_communes_tronque: r.tronque,
      caracteres_texte_zone: texteZone.length,
    },
  };
}
