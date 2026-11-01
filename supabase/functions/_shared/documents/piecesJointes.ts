// supabase/functions/_shared/documents/piecesJointes.ts
// =============================================================
// PIÈCES JOINTES PAR STOCKAGE — logique PURE (copilot-chat et mission conception).
//
// Avant : le navigateur encodait chaque fichier en base64 dans le corps de la
// requête (3 Mo par fichier, 4 Mo cumulés), et le fichier était perdu au tour
// suivant. Désormais le navigateur TÉLÉVERSE le fichier dans le bucket privé
// `copilot-pieces-jointes` (chemin `<uid>/<conversation|brouillon-uuid>/<horodatage>-<nom>`)
// et n'envoie qu'une RÉFÉRENCE ; pour un PDF il dépose à côté le texte extrait
// page par page (`<chemin>.texte.json`, extraction pdfjs dans le navigateur).
//
// Ce module décide, sans aucun accès réseau :
//   · si une référence est acceptable (le chemin appartient-il à l'utilisateur ?) ;
//   · COMMENT lire le document (PDF entier, texte intégral, texte ciblé sur la
//     zone, pages demandées, sommaire seul, refus) ;
//   · quelles pièces déjà jointes RE-TRANSMETTRE au tour courant ;
//   · combien RÉSERVER en plus pour couvrir la lecture (le débit reste le réel).
// =============================================================

import {
  assemblerTexte, estimerTokensTexte, listeArticles, pagesDepuisMessage, plagesLisibles, resumeChapitres,
  selectionnerPages, semblerScanne, titresArticles,
} from './lectureCiblee.ts';

export const BUCKET_PIECES_JOINTES = 'copilot-pieces-jointes';
/**
 * Plafond UNIQUE par fichier côté serveur (chat ET règlement de conception) :
 * 50 Mo = maximum de Supabase Storage sur le plan Free (doc « Storage — file
 * limits » : « For Free projects, the limit can't exceed 50 MB »). Égal au
 * file_size_limit des buckets (migration 20261101) et à la constante du front
 * (src/spaces/copilot/pieces-jointes/piecesJointesLogique.ts).
 */
export const TAILLE_MAX_PIECE_JOINTE = 50 * 1024 * 1024;
/** Limite de l'API Anthropic pour une image. */
export const TAILLE_MAX_IMAGE = 5 * 1024 * 1024;
/** Suffixe du texte extrait par le navigateur, déposé à côté du PDF. */
export const SUFFIXE_TEXTE = '.texte.json';
/** Limite de l'API Anthropic : 100 pages par requête quand le contexte est < 1 M tokens. */
export const MAX_PAGES_PDF_API = 100;
/** Jusqu'à ce nombre de pages, le PDF part ENTIER (tableaux, plans et images compris). */
export const SEUIL_PAGES_PDF_ENTIER = 20;
/** Estimation prudente du coût d'une page PDF envoyée en image + texte (doc Anthropic : 1 500 à 3 000). */
export const TOKENS_PAR_PAGE_PDF = 3000;
/** Texte extrait accepté : au plus 2 000 pages de 60 000 caractères. */
export const MAX_PAGES_TEXTE = 2000;
export const MAX_CARACTERES_PAGE = 60_000;

export const TYPES_IMAGE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const TYPES_ACCEPTES = new Set<string>([...TYPES_IMAGE, 'application/pdf']);

const EXT_PAR_TYPE: Record<string, RegExp> = {
  'application/pdf': /\.pdf$/,
  'image/png': /\.png$/,
  'image/jpeg': /\.jpe?g$/,
  'image/gif': /\.gif$/,
  'image/webp': /\.webp$/,
};

const RE_UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** <uid>/<conversation uuid | brouillon-uuid>/<AAAAMMJJ-HHMMSS>-<nom en minuscules>. */
const RE_CHEMIN = new RegExp(`^(${RE_UUID})/((?:brouillon-)?${RE_UUID})/(\\d{8}-\\d{6}-[a-z0-9._-]{1,120})$`);

/** Référence envoyée par le navigateur (contrat copilot-chat V1.8). */
export interface ReferencePieceJointe {
  mediaType: string;
  storagePath: string;
  size: number;
  name?: string;
  /** Chemin du texte extrait (`storagePath + .texte.json`), PDF seulement. */
  textePath?: string;
}

export type ValidationReference =
  | { ok: true; ref: ReferencePieceJointe; dossier: string }
  | { ok: false; erreur: string };

/**
 * Le chemin doit être DANS le dossier de l'utilisateur authentifié : le premier
 * segment est son uid (même règle que la politique RLS du bucket). Le service
 * télécharge avec la clé de service, qui contourne la RLS : sans cette
 * vérification, un utilisateur pourrait faire lire au modèle le fichier d'un autre.
 */
export function validerReference(brut: unknown, userId: string): ValidationReference {
  const r = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
  const chemin = typeof r.storagePath === 'string' ? r.storagePath : '';
  const type = typeof r.mediaType === 'string' ? r.mediaType : '';
  if (!TYPES_ACCEPTES.has(type)) return { ok: false, erreur: `type de pièce jointe non pris en charge : ${type || '?'}` };
  if (!chemin || chemin.length > 400 || chemin.includes('..') || chemin.includes('\\') || chemin.startsWith('/')) {
    return { ok: false, erreur: 'chemin de pièce jointe invalide' };
  }
  const m = RE_CHEMIN.exec(chemin);
  if (!m) return { ok: false, erreur: 'chemin de pièce jointe invalide' };
  if (m[1] !== userId.toLowerCase()) return { ok: false, erreur: "pièce jointe hors du dossier de l'utilisateur" };
  if (!EXT_PAR_TYPE[type].test(m[3])) return { ok: false, erreur: 'extension incohérente avec le type du fichier' };
  const taille = Number(r.size);
  if (!Number.isFinite(taille) || taille <= 0) return { ok: false, erreur: 'taille de pièce jointe invalide' };
  const max = type === 'application/pdf' ? TAILLE_MAX_PIECE_JOINTE : TAILLE_MAX_IMAGE;
  if (taille > max) return { ok: false, erreur: `pièce jointe trop volumineuse (${Math.round(taille / 1048576)} Mo > ${Math.round(max / 1048576)} Mo)` };
  let textePath: string | undefined;
  if (r.textePath !== undefined && r.textePath !== null) {
    if (type !== 'application/pdf' || r.textePath !== cheminTexte(chemin)) {
      return { ok: false, erreur: 'chemin du texte extrait invalide' };
    }
    textePath = r.textePath as string;
  }
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 200) : undefined;
  return {
    ok: true,
    dossier: `${m[1]}/${m[2]}`,
    ref: { mediaType: type, storagePath: chemin, size: taille, ...(name ? { name } : {}), ...(textePath ? { textePath } : {}) },
  };
}

export const cheminTexte = (chemin: string) => `${chemin}${SUFFIXE_TEXTE}`;

/** Une entrée d'`attachments` est une référence Storage (et non l'ancien base64). */
export function estReferenceStockage(a: unknown): boolean {
  return !!a && typeof a === 'object' && typeof (a as Record<string, unknown>).storagePath === 'string';
}

/**
 * Texte extrait déposé par le navigateur : `{ version: 1, pages: string[] }`.
 * Toute autre forme est rejetée (null) — le serveur retombe alors sur sa propre
 * extraction ou sur le PDF entier.
 */
export function lireTexteExtrait(json: unknown): string[] | null {
  const j = (json && typeof json === 'object' ? json : null) as Record<string, unknown> | null;
  if (!j || j.version !== 1 || !Array.isArray(j.pages)) return null;
  if (j.pages.length === 0 || j.pages.length > MAX_PAGES_TEXTE) return null;
  const pages: string[] = [];
  for (const p of j.pages) {
    if (typeof p !== 'string') return null;
    pages.push(p.length > MAX_CARACTERES_PAGE ? p.slice(0, MAX_CARACTERES_PAGE) : p);
  }
  return pages;
}

// ── Plan de lecture ─────────────────────────────────────────────────────────

export type ModeLecture =
  | 'image' | 'pdf_entier' | 'texte_integral' | 'texte_cible' | 'pages_demandees' | 'sommaire' | 'refus';

export interface PlanLecture {
  mode: ModeLecture;
  /** Pages transmises (1 = première) ; vide pour une image ou un refus. */
  pages: number[];
  /** Texte à transmettre (modes texte_* , pages_demandees, sommaire). */
  texte?: string;
  /** Tokens ESTIMÉS de la lecture (le comptage exact se fait ensuite par count_tokens). */
  tokensEstimes: number;
  /** Phrase courte, destinée au modèle ET à l'utilisateur. */
  description: string;
  /** Zone retenue pour une lecture ciblée. */
  zone?: string | null;
  nbPages: number | null;
  /**
   * V1.8 — mode 'sommaire' : question PRÉCISE à poser à l'utilisateur AVANT
   * toute lecture coûteuse (quelle zone ? quels articles / pages ?), avec les
   * choix trouvés dans le document. Le moteur de mission la pose telle quelle.
   */
  question?: string;
}

export interface EntreePlan {
  mediaType: string;
  taille: number;
  nom: string;
  /** Texte page par page, si disponible (navigateur ou serveur). */
  pages: string[] | null;
  /** Nombre de pages connu sans le texte (PDF scanné). */
  nbPages?: number | null;
  /** Zone de la parcelle (contexte, GPU ou message). */
  zone: string | null;
  message: string;
  /** Budget de tokens de document pour CE tour. */
  budgetTokens: number;
  /** Pages imposées par l'appelant (réponse de l'utilisateur en mission) ; prioritaires sur le message. */
  pagesDemandees?: number[] | null;
}

/**
 * Comment lire une pièce jointe. Ordre des décisions :
 *   1. image → image (aucune lecture ciblée possible) ;
 *   2. pages demandées par l'utilisateur et texte disponible → ces pages ;
 *   3. petit PDF (≤ 20 pages) qui tient dans le budget → PDF ENTIER (plans et tableaux compris) ;
 *   4. texte disponible et non scanné :
 *      a. le texte entier tient dans le budget → texte intégral ;
 *      b. zone connue et trouvée, chapitre lisible dans le budget → chapitre + dispositions générales ;
 *      c. sinon (zone inconnue, introuvable, ou chapitre trop long pour le budget) →
 *         SOMMAIRE + question précise : on DEMANDE à l'utilisateur quoi lire (zone,
 *         articles, pages) au lieu de choisir seul ou de couper à l'aveugle ;
 *   5. pas de texte (scanné) : PDF entier si ≤ 100 pages et dans le budget, sinon refus motivé.
 */
export function planifierLecture(e: EntreePlan): PlanLecture {
  const budgetCar = Math.max(0, e.budgetTokens) * 3;   // 3 caractères par token (prudent)
  if (e.mediaType !== 'application/pdf') {
    return { mode: 'image', pages: [], tokensEstimes: 1600, description: `image « ${e.nom} »`, nbPages: null };
  }
  const pages = e.pages && e.pages.length ? e.pages : null;
  const nbPages = pages ? pages.length : (e.nbPages ?? null);
  const scanne = !pages || semblerScanne(pages);

  if (pages && !scanne) {
    const demandees = e.pagesDemandees?.filter((n) => Number.isInteger(n) && n >= 1 && n <= pages.length).slice(0, 300) ?? pagesDepuisMessage(e.message, pages.length);
    if (demandees && demandees.length) {
      const texte = assemblerTexte(pages, demandees, budgetCar);
      return {
        mode: 'pages_demandees', pages: demandees, texte, nbPages,
        tokensEstimes: estimerTokensTexte(texte.length),
        description: `« ${e.nom} » : pages ${plagesLisibles(demandees)} sur ${pages.length} (demandées par l'utilisateur, texte extrait)`,
      };
    }
  }

  if (nbPages != null && nbPages <= SEUIL_PAGES_PDF_ENTIER && nbPages * TOKENS_PAR_PAGE_PDF <= e.budgetTokens) {
    return {
      mode: 'pdf_entier', pages: [], nbPages, tokensEstimes: nbPages * TOKENS_PAR_PAGE_PDF,
      description: `« ${e.nom} » : document entier (${nbPages} page${nbPages > 1 ? 's' : ''})`,
    };
  }

  if (pages && !scanne) {
    const total = pages.reduce((s, p) => s + p.length + 16, 0);
    if (total <= budgetCar) {
      const tout = pages.map((_, i) => i + 1);
      const texte = assemblerTexte(pages, tout, budgetCar);
      return {
        mode: 'texte_integral', pages: tout, texte, nbPages, tokensEstimes: estimerTokensTexte(texte.length),
        description: `« ${e.nom} » : texte intégral des ${pages.length} pages (sans les images)`,
      };
    }
    const sel = selectionnerPages(pages, e.zone, budgetCar);
    if (sel.statut === 'zone_trouvee' && sel.pages.length && !sel.tronque) {
      const texte = assemblerTexte(pages, sel.pages, budgetCar);
      return {
        mode: 'texte_cible', pages: sel.pages, texte, nbPages, zone: sel.zoneRetenue,
        tokensEstimes: estimerTokensTexte(texte.length),
        description: `« ${e.nom} » (${pages.length} pages) : lecture ciblée de la zone ${sel.zoneRetenue}` +
          ` — chapitre p. ${plagesLisibles(sel.pagesZone)}` +
          (sel.pagesDispositionsGenerales.length ? `, dispositions générales p. ${plagesLisibles(sel.pagesDispositionsGenerales)}` : '') +
          (sel.pagesLexique.length ? `, lexique p. ${plagesLisibles(sel.pagesLexique)}` : ''),
      };
    }
    // Zone inconnue, introuvable, ou chapitre trop long : on ne choisit PAS seul.
    // Sommaire + premières pages, et une question précise listant les choix.
    const premieres = [1, 2, 3, 4].filter((p) => p <= pages.length);
    let raison: string;
    let question: string;
    let articles = '';
    if (sel.statut === 'zone_trouvee') {
      const ch = sel.chapitres.find((c) => c.zone === sel.zoneRetenue)!;
      const tokensChapitre = estimerTokensTexte(pages.slice(ch.debut - 1, ch.fin).reduce((s, p) => s + p.length + 16, 0));
      articles = listeArticles(titresArticles(pages, ch.debut, ch.fin));
      raison = `le chapitre de la zone ${sel.zoneRetenue} (p. ${ch.debut}-${ch.fin}, ≈ ${tokensChapitre.toLocaleString('fr-FR')} tokens) dépasse ce qu'un tour peut lire`;
      question = `Le règlement « ${e.nom} » est long : le chapitre de la zone ${sel.zoneRetenue} occupe les pages ${ch.debut} à ${ch.fin}. ` +
        'Quels articles ou quelles pages voulez-vous que je lise (par exemple « hauteur et stationnement » ou « pages ' +
        `${ch.debut} à ${Math.min(ch.fin, ch.debut + 9)} »)` + (articles ? ` ? Articles repérés : ${articles}.` : ' ?');
    } else if (sel.statut === 'zone_introuvable') {
      raison = `la zone ${sel.zone} n'y a pas été repérée`;
      question = `Je ne trouve pas la zone ${sel.zone} dans « ${e.nom} ». ${resumeChapitres(sel.chapitres)} ` +
        'Quel chapitre (ou quelles pages) dois-je lire ?';
    } else {
      raison = 'la zone de la parcelle est inconnue';
      question = `Quelle est la zone de votre parcelle dans « ${e.nom} » ? ${resumeChapitres(sel.chapitres)} ` +
        'Vous pouvez aussi m\'indiquer directement les pages à lire.';
    }
    const texte = `${resumeChapitres(sel.chapitres)}${articles ? `\nArticles repérés dans le chapitre : ${articles}` : ''}\n\n` +
      assemblerTexte(pages, premieres, Math.min(budgetCar, 12_000));
    return {
      mode: 'sommaire', pages: premieres, texte, nbPages, zone: sel.zone, question,
      tokensEstimes: estimerTokensTexte(texte.length),
      description: `« ${e.nom} » (${pages.length} pages) : ${raison} — seuls le sommaire et les premières pages sont transmis, ` +
        'en attendant que l\'utilisateur précise quoi lire',
    };
  }

  // Pas de texte exploitable (PDF scanné ou extraction impossible).
  if (nbPages != null && nbPages <= MAX_PAGES_PDF_API && nbPages * TOKENS_PAR_PAGE_PDF <= e.budgetTokens) {
    return {
      mode: 'pdf_entier', pages: [], nbPages, tokensEstimes: nbPages * TOKENS_PAR_PAGE_PDF,
      description: `« ${e.nom} » : document entier (${nbPages} pages, sans texte extractible — lecture en images, plus coûteuse)`,
    };
  }
  if (nbPages == null && e.taille <= 3 * 1024 * 1024) {
    // Ancien comportement (≤ 3 Mo) : PDF entier, le comptage exact tranchera.
    return {
      mode: 'pdf_entier', pages: [], nbPages, tokensEstimes: Math.ceil(e.taille / 1024) * 20,
      description: `« ${e.nom} » : document entier`,
    };
  }
  return {
    mode: 'refus', pages: [], nbPages, tokensEstimes: 0,
    description: `« ${e.nom} »${nbPages ? ` (${nbPages} pages)` : ''} n'a pas pu être lu : ` +
      (scanne && pages ? 'document scanné (aucun texte extractible) et trop long pour une lecture en images. '
        : 'texte non extrait et document trop long. ') +
      "Demande à l'utilisateur d'indiquer les pages utiles (ex. « pages 40 à 55 ») ou de joindre seulement le chapitre de sa zone.",
  };
}

// ── Pièces conservées : quand les re-transmettre ? ──────────────────────────

export interface PieceConservee {
  id: string;
  nom: string;
  media_type: string;
  /** Tour (rang du message utilisateur) où la pièce a été jointe. */
  tour_ajout: number;
  /** Dernier tour où elle a été transmise au modèle. */
  tour_derniere_lecture: number;
  /** Tokens de sa dernière lecture (estimation de son coût de re-transmission). */
  tokens_derniere_lecture: number | null;
}

/** Une pièce jointe reste « pertinente » pendant ce nombre de tours sans être citée. */
export const TOURS_PERTINENCE = 3;

const RE_ALLUSION_DOCUMENT =
  /\b(?:document|pdf|r[èe]glement|pi[èe]ce[s]? jointe[s]?|fichier|annexe|plan|image|photo|devis|diagnostic|rapport|page[s]?\s*\d+|article\s+[A-Z0-9]+)/i;

/**
 * Pièces déjà jointes à re-transmettre au tour `tour` : celles lues il y a
 * moins de TOURS_PERTINENCE tours, ou citées dans le message (nom du fichier,
 * « le règlement », « page 12 »…), les plus récentes d'abord, dans le budget.
 */
export function piecesARetransmettre(
  pieces: readonly PieceConservee[], p: { tour: number; message: string; budgetTokens: number },
): { retenues: PieceConservee[]; ecartees: Array<{ piece: PieceConservee; raison: 'ancienne' | 'budget' }> } {
  const msg = (p.message ?? '').toLowerCase();
  const allusion = RE_ALLUSION_DOCUMENT.test(p.message ?? '');
  const citee = (x: PieceConservee) => {
    const base = x.nom.toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '');
    return base.length >= 4 && msg.includes(base);
  };
  const triees = [...pieces].sort((a, b) => b.tour_derniere_lecture - a.tour_derniere_lecture || b.tour_ajout - a.tour_ajout);
  const retenues: PieceConservee[] = [];
  const ecartees: Array<{ piece: PieceConservee; raison: 'ancienne' | 'budget' }> = [];
  let budget = p.budgetTokens;
  for (const x of triees) {
    const recente = p.tour - x.tour_derniere_lecture <= TOURS_PERTINENCE;
    if (!recente && !citee(x) && !(allusion && triees.length === 1)) { ecartees.push({ piece: x, raison: 'ancienne' }); continue; }
    const cout = x.tokens_derniere_lecture ?? 0;
    if (cout > budget) { ecartees.push({ piece: x, raison: 'budget' }); continue; }
    budget -= cout;
    retenues.push(x);
  }
  return { retenues, ecartees };
}

// ── Réservation ─────────────────────────────────────────────────────────────

/**
 * Nombre de tours du modèle pendant lesquels un document est supposé RENVOYÉ :
 * l'historique (document compris) repart à chaque itération de la boucle
 * d'outils. 2 = la question + un tour d'outil, cas le plus courant. Ce n'est
 * qu'une EMPREINTE (gate de solde) : le débit final reste l'usage réel.
 */
export const TOURS_SUPPOSES_DOCUMENT = 2;

/**
 * Jetons à réserver EN PLUS du pire cas du message pour couvrir la lecture des
 * documents. `debit(tokensEntree)` = debitJetons(tier, tokensEntree, 0, 0) de
 * copilot-chat ; on fait la différence pour ne pas compter deux fois le minimum
 * de 1 jeton.
 */
export function jetonsSupplementairesDocuments(
  tokensDocuments: number, debit: (tokensEntree: number) => number, tours = TOURS_SUPPOSES_DOCUMENT,
): number {
  if (!(tokensDocuments > 0)) return 0;
  return Math.max(0, debit(tokensDocuments * tours) - debit(0));
}

// ── Trace dans le texte persisté ────────────────────────────────────────────

export interface PieceTracee { nom?: string; mediaType: string; conservee: boolean }

/**
 * Marqueur ajouté au texte du message utilisateur persisté (copilot_messages).
 * Pièces toutes NON conservées (ancien base64) : texte historique inchangé,
 * lu par la règle 4duodetricies. Dès qu'une pièce est conservée, le marqueur
 * le dit, fichier par fichier.
 */
export function marqueurPieces(pieces: readonly PieceTracee[]): string {
  if (!pieces.length) return '';
  const nom = (a: PieceTracee, i: number) => {
    const type = a.mediaType === 'application/pdf' ? 'PDF' : 'image';
    return a.nom?.trim() ? `${a.nom.trim().replace(/[[\]]/g, '')} (${type})` : `${type} n°${i + 1}`;
  };
  if (!pieces.some((a) => a.conservee)) {
    const noms = pieces.map(nom).join(', ');
    return `\n\n[PIÈCES JOINTES À CE MESSAGE : ${noms}. Le contenu de ces fichiers a été lu ` +
      `à ce tour-là UNIQUEMENT. Il n'est PAS conservé dans l'historique : aux tours suivants, ` +
      `tu ne disposes plus du document.]`;
  }
  const noms = pieces.map((a, i) => {
    const type = a.mediaType === 'application/pdf' ? 'PDF' : 'image';
    const etat = a.conservee ? 'conservée' : 'non conservée';
    return a.nom?.trim() ? `${a.nom.trim().replace(/[[\]]/g, '')} (${type}, ${etat})` : `${type} n°${i + 1} (${etat})`;
  }).join(', ');
  return `\n\n[PIÈCES JOINTES À CE MESSAGE : ${noms}. Les pièces « conservées » restent rattachées ` +
    `à la conversation : quand elles sont pertinentes, elles te sont RE-TRANSMISES aux tours suivants ` +
    `(section « DOCUMENTS DE LA CONVERSATION »). Les pièces « non conservées » ont été lues à ce tour-là UNIQUEMENT.]`;
}
