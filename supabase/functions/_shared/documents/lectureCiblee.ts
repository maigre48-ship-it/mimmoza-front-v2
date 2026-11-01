// supabase/functions/_shared/documents/lectureCiblee.ts
// =============================================================
// LECTURE CIBLÉE D'UN GROS DOCUMENT (règlement de PLU surtout) — logique PURE.
//
// Pourquoi : un règlement de PLU fait couramment 100 à 400 pages (5 à 30 Mo).
// L'envoyer entier au modèle coûte 150 000 à 1 000 000 de tokens, dépasse la
// limite de 100 pages par requête de l'API Anthropic (contexte < 1 M tokens) et
// la fenêtre de Haiku. Or une question sur une parcelle ne concerne que :
//   · les DISPOSITIONS GÉNÉRALES (définitions, règles communes) ;
//   · le CHAPITRE DE LA ZONE de la parcelle (UA, UC, 1AU, N…) ;
//   · éventuellement le LEXIQUE.
// Ce module repère ces parties dans le texte page par page (extrait côté
// navigateur par pdfjs, ou côté serveur par plu-reglement-v1) et assemble le
// texte des seules pages retenues, avec leur numéro — le modèle cite ainsi la
// page de chaque règle et sait qu'il ne voit PAS le reste du document.
//
// Aucune dépendance, aucun accès réseau : testé par lectureCiblee.test.ts.
// Les motifs d'en-tête reprennent ceux de plu-parser (sectionsDeZone) : un
// « en zone UB » dans le corps du texte n'est JAMAIS un en-tête.
// =============================================================

/** Code de zone PLU : UA, UCa, 1AUh, 2AU, A, Ap, N, Nh, UB1… (forme brute). */
const MOTIF_CODE_ZONE = '([1-9]?(?:AU|U|A|N)[A-Za-z0-9]{0,4})';

/** Caractères par token, volontairement BAS (le français tourne à 3,5–4) : on ne sous-estime jamais. */
export const CARACTERES_PAR_TOKEN = 3;

/** Longueur maximale d'un chapitre de zone retenu (au-delà, c'est un repérage raté). */
export const MAX_PAGES_CHAPITRE = 80;
/** Dispositions générales : au plus ces pages (les plus proches du début de la partie). */
export const MAX_PAGES_DISPOSITIONS_GENERALES = 25;
/** Lexique / définitions : au plus ces pages. */
export const MAX_PAGES_LEXIQUE = 10;

export function estimerTokensTexte(nbCaracteres: number): number {
  return Math.ceil(Math.max(0, nbCaracteres) / CARACTERES_PAR_TOKEN);
}

/** « Zone Uc », « uc », « UC » → « UC ». Null si ce n'est pas un code de zone. */
export function normaliserCodeZone(brut: unknown): string | null {
  if (typeof brut !== 'string') return null;
  const s = brut.trim().replace(/^zone\s+/i, '').replace(/\s+/g, '');
  if (!new RegExp(`^${MOTIF_CODE_ZONE}$`, 'i').test(s)) return null;
  return s.toUpperCase();
}

/**
 * Zones candidates, de la plus précise à la plus large : « UCA » → UCA, UC.
 * Un sous-secteur (UCa) est presque toujours traité DANS le chapitre de sa zone
 * mère (UC). On ne remonte jamais jusqu'à une lettre seule depuis un code de
 * plusieurs lettres (« UC » → « U » serait une autre zone).
 */
export function zonesCandidates(zone: string): string[] {
  const z = normaliserCodeZone(zone);
  if (!z) return [];
  const out = [z];
  const m = /^([1-9]?)(AU|U|A|N)([A-Z]*)(\d*)([A-Z]*)$/.exec(z);
  if (m) {
    const [, prefixe, racine, lettres] = m;
    if (lettres) out.push(`${prefixe}${racine}${lettres}`);        // UB1 → UB
    if (lettres.length > 1) out.push(`${prefixe}${racine}${lettres[0]}`); // UCA → UC
    // Ap → A, Nh → N, 1AUh → 1AU. Jamais UC → U : en zone urbaine, chaque
    // lettre désigne en général une zone à part entière, avec son chapitre.
    if (lettres.length >= 1 && racine !== 'U') out.push(`${prefixe}${racine}`);
  }
  return Array.from(new Set(out));
}

/** « … en zone UC … », « zone 1AUh » dans le message de l'utilisateur. */
export function zoneDepuisMessage(message: string): string | null {
  const m = new RegExp(`\\bzone\\s+${MOTIF_CODE_ZONE}\\b`, 'i').exec(message ?? '');
  return m ? normaliserCodeZone(m[1]) : null;
}

/**
 * Pages explicitement demandées : « pages 40 à 60 », « p. 12-15 », « page 7 »,
 * « pages 3, 5 et 9 ». Bornées au document ; null si rien de lisible.
 */
export function pagesDepuisMessage(message: string, nbPages: number | null): number[] | null {
  const texte = message ?? '';
  const pages = new Set<number>();
  const max = nbPages && nbPages > 0 ? nbPages : 2000;
  const plage = /\b(?:pages?|p\.)\s*(\d{1,4})\s*(?:à|a|-|–|au)\s*(\d{1,4})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = plage.exec(texte)) !== null) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a >= 1 && b >= a && b - a <= 150) for (let p = a; p <= Math.min(b, max); p++) pages.add(p);
  }
  const liste = /\b(?:pages?|p\.)\s*((?:\d{1,4}\s*(?:,|et)\s*)*\d{1,4})\b(?!\s*(?:à|a|-|–|au)\s*\d)/gi;
  while ((m = liste.exec(texte)) !== null) {
    for (const x of m[1].split(/\s*(?:,|et)\s*/)) {
      const n = Number(x);
      if (n >= 1 && n <= max) pages.add(n);
    }
  }
  return pages.size ? Array.from(pages).sort((a, b) => a - b) : null;
}

/** Document scanné (images sans couche texte) : la lecture ciblée est impossible. */
export function semblerScanne(pages: readonly string[]): boolean {
  if (!pages.length) return true;
  const longueurs = pages.map((p) => (p ?? '').replace(/\s+/g, '').length);
  const vides = longueurs.filter((l) => l < 40).length;
  const moyenne = longueurs.reduce((s, l) => s + l, 0) / pages.length;
  return moyenne < 120 || vides / pages.length > 0.6;
}

export interface EnTeteZone {
  /** Page (1 = première). */
  page: number;
  zone: string;
  /** 'titre' : « Dispositions applicables à la zone UC », « Chapitre 3 – Zone UC ». 'entete' : « ZONE UC » en début de ligne. */
  force: 'titre' | 'entete';
}

const RE_TITRE = new RegExp(
  `(?:(?:DISPOSITIONS|R[ÈE]GLES?|R[ÈE]GLEMENT)\\s+(?:APPLICABLES?|PROPRES?|SP[ÉE]CIFIQUES?)\\s+(?:[ÀA]\\s+LA|AUX?|DE\\s+LA)\\s+ZONES?|CHAPITRE\\s+[IVXLC\\d]{1,6}\\s*[-–—:.]?\\s*(?:(?:LA|DE\\s+LA)\\s+)?ZONES?)\\s+${MOTIF_CODE_ZONE}\\b`,
  'gi',
);
// « ZONE UC » en début de ligne (pdfjs sépare les lignes par \n), en majuscules :
// les en-têtes courants de page (« PLU de X – Zone UC ») sont aussi captés par
// la seconde forme, après un tiret ou un séparateur.
const RE_ENTETE = new RegExp(`(?:^|\\n|[–—|-]\\s*)\\s*(?:ZONES?|Zones?)\\s+${MOTIF_CODE_ZONE}\\b(?!\\s*(?:et|,)\\s*[1-9]?(?:AU|U|A|N))`, 'g');

/**
 * En-têtes de zone page par page. Une page qui cite trois zones différentes ou
 * plus en position de titre est un SOMMAIRE (ou un tableau récapitulatif) : elle
 * est ignorée, sinon toutes les zones « commenceraient » en page 2.
 */
export function enTetesZones(pages: readonly string[]): { entetes: EnTeteZone[]; sommaires: number[] } {
  const entetes: EnTeteZone[] = [];
  const sommaires: number[] = [];
  pages.forEach((brut, i) => {
    const texte = brut ?? '';
    const trouves = new Map<string, EnTeteZone['force']>();
    let m: RegExpExecArray | null;
    RE_TITRE.lastIndex = 0;
    while ((m = RE_TITRE.exec(texte)) !== null) {
      const z = normaliserCodeZone(m[1]);
      if (z) trouves.set(z, 'titre');
    }
    RE_ENTETE.lastIndex = 0;
    while ((m = RE_ENTETE.exec(texte)) !== null) {
      const z = normaliserCodeZone(m[1]);
      if (z && !trouves.has(z)) trouves.set(z, 'entete');
    }
    if (trouves.size >= 3) { sommaires.push(i + 1); return; }
    for (const [zone, force] of trouves) entetes.push({ page: i + 1, zone, force });
  });
  return { entetes, sommaires };
}

const estSousZone = (code: string, mere: string) => code !== mere && code.startsWith(mere);

export interface ChapitreZone { zone: string; debut: number; fin: number }

/**
 * Chapitres de zone : chaque zone commence à sa première page d'en-tête (un
 * titre fort l'emporte sur un en-tête courant) et finit avant la page où
 * commence une AUTRE zone (une sous-zone — UCa dans UC — ne clôt pas le chapitre).
 */
export function chapitresZones(pages: readonly string[]): ChapitreZone[] {
  const { entetes } = enTetesZones(pages);
  const premierePage = new Map<string, number>();
  // Titres forts d'abord : ils fixent le début du chapitre.
  for (const f of ['titre', 'entete'] as const) {
    for (const e of entetes) {
      if (e.force === f && !premierePage.has(e.zone)) premierePage.set(e.zone, e.page);
    }
  }
  // Une zone citée en en-tête courant seulement APRÈS son titre garde son titre.
  const debuts = Array.from(premierePage.entries())
    .map(([zone, debut]) => ({ zone, debut }))
    .sort((a, b) => a.debut - b.debut || a.zone.localeCompare(b.zone));
  const out: ChapitreZone[] = [];
  for (let k = 0; k < debuts.length; k++) {
    const { zone, debut } = debuts[k];
    let fin = pages.length;
    for (let j = k + 1; j < debuts.length; j++) {
      const autre = debuts[j];
      if (autre.debut <= debut) continue;
      if (estSousZone(autre.zone, zone)) continue;
      fin = autre.debut - 1;
      break;
    }
    out.push({ zone, debut, fin: Math.min(fin, debut + MAX_PAGES_CHAPITRE - 1) });
  }
  return out;
}

const RE_DG = /DISPOSITIONS\s+G[ÉE]N[ÉE]RALES|DISPOSITIONS\s+COMMUNES\s+[ÀA]\s+TOUTES\s+LES\s+ZONES|R[ÈE]GLES\s+COMMUNES/i;
const RE_LEXIQUE = /\b(?:LEXIQUE|GLOSSAIRE|D[ÉE]FINITIONS?\s+(?:ET\s+)?(?:MODALIT[ÉE]S|DES\s+TERMES|UTILES|G[ÉE]N[ÉE]RALES))\b/;

export interface SelectionPages {
  statut: 'zone_trouvee' | 'zone_introuvable' | 'zone_inconnue';
  zone: string | null;
  /** Zone dont le chapitre a été retenu (peut être la zone mère : UC pour UCa). */
  zoneRetenue: string | null;
  pagesZone: number[];
  pagesDispositionsGenerales: number[];
  pagesLexique: number[];
  /** Union finale, triée, après application du budget. */
  pages: number[];
  chapitres: ChapitreZone[];
  /** Vrai si le budget a obligé à écarter des pages pertinentes. */
  tronque: boolean;
}

const plage = (a: number, b: number) => (b < a ? [] : Array.from({ length: b - a + 1 }, (_, i) => a + i));

/** Pages des dispositions générales : du titre « Dispositions générales » au premier chapitre de zone. */
export function pagesDispositionsGenerales(pages: readonly string[], chapitres: ChapitreZone[], sommaires: number[]): number[] {
  const premierChapitre = chapitres.length ? Math.min(...chapitres.map((c) => c.debut)) : pages.length + 1;
  let debut = -1;
  for (let i = 0; i < pages.length && i + 1 < premierChapitre; i++) {
    if (sommaires.includes(i + 1)) continue;
    if (RE_DG.test(pages[i] ?? '')) { debut = i + 1; break; }
  }
  if (debut < 0) return [];
  return plage(debut, Math.min(premierChapitre - 1, debut + MAX_PAGES_DISPOSITIONS_GENERALES - 1));
}

/** Pages de lexique (souvent en fin de règlement), hors chapitres de zone déjà retenus. */
export function pagesLexique(pages: readonly string[], sommaires: number[]): number[] {
  for (let i = 0; i < pages.length; i++) {
    if (sommaires.includes(i + 1)) continue;
    const tete = (pages[i] ?? '').slice(0, 400);
    if (RE_LEXIQUE.test(tete)) return plage(i + 1, Math.min(pages.length, i + MAX_PAGES_LEXIQUE));
  }
  return [];
}

/**
 * Sélection des pages à lire pour une zone, sous un budget de caractères.
 * Priorité : chapitre de la zone, puis dispositions générales, puis lexique ;
 * dans chaque groupe, on garde le début (titre et premiers articles d'abord).
 */
export function selectionnerPages(pages: readonly string[], zone: string | null, maxCaracteres: number): SelectionPages {
  const chapitres = chapitresZones(pages);
  const { sommaires } = enTetesZones(pages);
  const dg = pagesDispositionsGenerales(pages, chapitres, sommaires);
  const zoneNorm = zone ? normaliserCodeZone(zone) : null;

  let chapitre: ChapitreZone | null = null;
  if (zoneNorm) {
    // De la plus LARGE à la plus précise : le chapitre de la zone mère (UC)
    // englobe celui du sous-secteur (UCa), et les règles de UC s'appliquent
    // aussi en UCa — lire UCa seul ferait manquer les articles communs.
    for (const z of zonesCandidates(zoneNorm).reverse()) {
      chapitre = chapitres.find((c) => c.zone === z) ?? null;
      if (chapitre) break;
    }
  }
  const pagesZone = chapitre ? plage(chapitre.debut, chapitre.fin) : [];
  const dejaPrises = new Set([...pagesZone, ...dg]);
  const lex = chapitre ? pagesLexique(pages, sommaires).filter((p) => !dejaPrises.has(p)) : [];

  const longueur = (p: number) => (pages[p - 1] ?? '').length + 16;
  let budget = Math.max(0, maxCaracteres);
  let tronque = false;
  const garder = (groupe: number[]) => {
    const out: number[] = [];
    for (const p of groupe) {
      const l = longueur(p);
      if (l > budget) { tronque = true; break; }
      budget -= l;
      out.push(p);
    }
    return out;
  };
  const zoneGardee = garder(pagesZone);
  const dgGardees = garder(dg);
  const lexGardees = garder(lex);

  return {
    statut: !zoneNorm ? 'zone_inconnue' : chapitre ? 'zone_trouvee' : 'zone_introuvable',
    zone: zoneNorm,
    zoneRetenue: chapitre?.zone ?? null,
    pagesZone: zoneGardee,
    pagesDispositionsGenerales: dgGardees,
    pagesLexique: lexGardees,
    pages: Array.from(new Set([...zoneGardee, ...dgGardees, ...lexGardees])).sort((a, b) => a - b),
    chapitres,
    tronque,
  };
}

/** Pages groupées en plages lisibles : [3,4,5,9] → « 3-5, 9 ». */
export function plagesLisibles(pages: readonly number[]): string {
  const t = Array.from(new Set(pages)).sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < t.length; i++) {
    let j = i;
    while (j + 1 < t.length && t[j + 1] === t[j] + 1) j++;
    out.push(i === j ? String(t[i]) : `${t[i]}-${t[j]}`);
    i = j;
  }
  return out.join(', ');
}

/**
 * Texte des pages retenues, chaque page précédée de « [Page N] ». Le texte est
 * normalisé (blancs réduits) mais jamais réécrit. Borné à `maxCaracteres`.
 */
export function assemblerTexte(pages: readonly string[], numeros: readonly number[], maxCaracteres = Infinity): string {
  const morceaux: string[] = [];
  let total = 0;
  for (const n of numeros) {
    const brut = (pages[n - 1] ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const bloc = `[Page ${n}]\n${brut}`;
    if (total + bloc.length > maxCaracteres) {
      const reste = maxCaracteres - total;
      if (reste > 200) morceaux.push(`${bloc.slice(0, reste)}\n[… page ${n} coupée : budget de lecture atteint]`);
      break;
    }
    morceaux.push(bloc);
    total += bloc.length + 2;
  }
  return morceaux.join('\n\n');
}

/**
 * Sommaire de secours quand la zone est inconnue : les chapitres détectés avec
 * leurs pages, pour que le modèle DEMANDE la zone ou les pages à l'utilisateur
 * au lieu de deviner.
 */
export function resumeChapitres(chapitres: readonly ChapitreZone[]): string {
  if (!chapitres.length) return 'Aucun chapitre de zone repéré automatiquement dans ce document.';
  return 'Chapitres de zone repérés : ' +
    chapitres.map((c) => `zone ${c.zone} (p. ${c.debut === c.fin ? c.debut : `${c.debut}-${c.fin}`})`).join(' ; ') + '.';
}

/**
 * V1.8 — Titres d'articles d'un chapitre (« Article UC 10 – Hauteur maximale »),
 * avec leur page : de quoi poser une question PRÉCISE à l'utilisateur quand le
 * chapitre est trop long pour être lu en un tour (« quels articles lire ? »).
 * Un renvoi dans le corps (« à l'article UC 7 ») n'est pas un titre : seuls
 * les « Article … » en début de ligne comptent.
 */
export function titresArticles(pages: readonly string[], debut: number, fin: number, max = 40): Array<{ titre: string; page: number }> {
  const out: Array<{ titre: string; page: number }> = [];
  const vus = new Set<string>();
  const re = /(?:^|\n)\s*((?:ARTICLE|Article|ART\.)\s+[A-Z0-9]{0,6}\s*[-.]?\s*\d{1,2}(?:\.\d{1,2})?\b[^\n]{0,80})/g;
  for (let p = Math.max(1, debut); p <= Math.min(pages.length, fin); p++) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(pages[p - 1] ?? '')) !== null) {
      const titre = m[1].replace(/\s+/g, ' ').trim();
      const cle = titre.slice(0, 24).toUpperCase();
      if (vus.has(cle)) continue;
      vus.add(cle);
      out.push({ titre, page: p });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** « Article UC 10 – Hauteur (p. 121) ; … » — liste lisible pour une question. */
export function listeArticles(titres: ReadonlyArray<{ titre: string; page: number }>): string {
  return titres.map((t) => `${t.titre} (p. ${t.page})`).join(' ; ');
}
