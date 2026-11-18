// supabase/functions/_shared/extension/retouchesExtension.ts
// =============================================================================
// LOT G7 (18/11/2026) — « On itère en parlant », comme avec ChatGPT, mais en restant exact : après un premier projet
// d'extension (parcours terminé), chaque demande de modification écrite librement (« fais-la en bardage bois clair »,
// « plus large d'1 m », « mets un toit plat », « enlève la baie », « vue depuis le jardin ») devient une VARIANTE du
// même projet, sans refaire le parcours. Module PUR et DÉTERMINISTE.
//
// Aucun modèle de langage : seules des formulations EXPLICITES sont reprises. Ce qui est ambigu (« en bois » sans
// teinte, « plus grande » sans chiffre, « RAL 7016 » sans dire pour quoi) n'est jamais deviné : une question à puces est
// posée, dont chaque option se relit d'elle-même (« Bardage bois clair », « 1 m plus large »). Ce que la bibliothèque
// ne sait pas encore dessiner (végétalisation, couleur RAL absente, porte-fenêtre à un endroit imposé) est DIT.
// Le moteur d'extension recalcule ensuite la variante (refus et reculs re-vérifiés) : ce module ne calcule rien.
// =============================================================================

import { COUVERTURES_CONTRAT, FACADES_CONTRAT, type CouvertureContrat, type FacadeContrat, type FormeToitExtension, type MenuiserieContrat } from './contrat.ts';
import { lireInstructions, normaliserInstructions } from './instructionsExtension.ts';

export type CoteRetouche = 'gauche' | 'droite' | 'arriere' | 'rue';
export type ToitRetouche = Exclude<FormeToitExtension, 'quatre-pans'>;

/** Dimension demandée : absolue (« largeur 5 m ») ou relative (« 1 m plus large » : +1 ; « 50 cm moins profonde » : −0,5). */
export type DimensionRetouche = { readonly abs: number } | { readonly rel: number };

/** Question à puces posée quand la demande est ambiguë ; chaque option se relit d'elle-même au tour suivant. */
export interface QuestionRetouche { readonly id: string; readonly libelle: string; readonly options: readonly string[] }

/** Ce que le message demande de changer (absent : rien de dit, ou ambigu → question). */
export interface RetouchesLues {
  readonly largeur?: DimensionRetouche;
  readonly profondeur?: DimensionRetouche;
  readonly cote?: CoteRetouche | 'autre';
  readonly hauteur?: 1 | 2 | 'meme';
  readonly toit?: ToitRetouche;
  readonly vegetalise?: true;
  /** `null` : « comme la maison » (retour à la convention : enduit accordé à la teinte mesurée sur la photo). */
  readonly facade?: FacadeContrat | null;
  readonly couverture?: CouvertureContrat;
  readonly menuiserie?: MenuiserieContrat;
  readonly baies?: 'auto' | 'aucune';
  /** « vue depuis le jardin », « un autre angle » : le point de vue est celui de la PHOTO (une autre photo est nécessaire). */
  readonly vueJardin?: true;
  /** Limites dites en mots simples (ce qui ne peut pas être dessiné tel quel). */
  readonly limites: readonly string[];
  readonly questions: readonly QuestionRetouche[];
}

// ── Questions (identifiants du bloc de choix du parcours : préfixe « x3_ ») ──────────────────────────────────────
export const QR = {
  retouche: { id: 'x3_retouche', libelle: 'Retoucher l’extension' },
  facade: { id: 'x3_ret_facade', libelle: 'Revêtement de l’extension' },
  largeur: { id: 'x3_ret_largeur', libelle: 'Largeur de l’extension' },
  profondeur: { id: 'x3_ret_profondeur', libelle: 'Profondeur de l’extension' },
  hauteur: { id: 'x3_ret_hauteur', libelle: 'Hauteur de l’extension (variante)' },
  toit: { id: 'x3_ret_toit', libelle: 'Toit de l’extension' },
  couleur: { id: 'x3_ret_couleur', libelle: 'Couleur demandée' },
  zinc: { id: 'x3_ret_zinc', libelle: 'Zinc pour' },
  cote: { id: 'x3_ret_cote', libelle: 'Côté de l’extension (variante)' },
} as const;

export const LIBELLES_FACADE: Readonly<Record<FacadeContrat, string>> = {
  'av-enduit-blanc': 'enduit blanc', 'av-enduit-creme': 'enduit crème', 'av-enduit-beige': 'enduit beige',
  'av-bardage-bois-brun': 'bardage bois brun', 'av-bardage-bois-clair': 'bardage bois clair', 'av-bardage-bois-noirci': 'bardage bois noirci',
  'av-brique-rouge': 'brique rouge', 'av-brique-claire': 'brique claire', 'av-pierre-calcaire': 'pierre calcaire',
  'av-beton-clair': 'béton clair', 'av-beton-brut': 'béton brut', 'av-zinc-facade': 'bardage zinc',
};
export const LIBELLES_COUVERTURE: Readonly<Record<CouvertureContrat, string>> = {
  'av-tuiles-terre-cuite': 'tuiles terre cuite', 'av-ardoise': 'ardoise', 'av-zinc-anthracite': 'zinc anthracite', 'av-membrane-sombre': 'membrane d’étanchéité sombre',
};
export const LIBELLES_TOIT_EXT: Readonly<Record<ToitRetouche, string>> = {
  plat: 'toit plat', monopente: 'toit à un pan (monopente)', 'deux-pans': 'toit à 2 pans', prolongement: 'même toit que la maison',
};
export const LIBELLES_MENUISERIE: Readonly<Record<MenuiserieContrat, string>> = {
  'av-aluminium-noir': 'menuiseries anthracite (RAL 7016)', 'av-aluminium-blanc': 'menuiseries blanches', 'av-chene-porte': 'menuiseries bois',
};
export const LIBELLES_COTE: Readonly<Record<CoteRetouche, string>> = { gauche: 'à gauche', droite: 'à droite', arriere: 'à l’arrière', rue: 'côté rue' };

const OPTIONS_BARDAGE = ['Bardage bois brun', 'Bardage bois clair', 'Bardage bois noirci'] as const;
const OPTIONS_TOIT = ['Toit plat', 'Toit monopente', 'Toit à 2 pans', 'Même toit que la maison'] as const;

/** Texte sans les « Libellé : » des questions de retouche (« Revêtement de l’extension : Bardage bois clair » → valeur seule). */
export function sansLibellesRetouche(texte: string): string {
  const connus = Object.values(QR).map((q) => normaliserInstructions(q.libelle));
  return (texte ?? '').replace(/```[\s\S]*?```/g, ' ').split(/[·\n;]/).map((s) => {
    const i = s.indexOf(':');
    if (i < 0) return s;
    const cle = normaliserInstructions(s.slice(0, i));
    return connus.some((l) => cle === l || cle.endsWith(l)) ? s.slice(i + 1) : s;
  }).join(' . ');
}

const NB = '(\\d+(?:[.,]\\d+)?)\\s*(m|metres?|cm|centimetres?)\\b';
const metres = (n: string, u: string): number => {
  const v = Number(n.replace(',', '.'));
  return /^c/.test(u) ? v / 100 : v;
};

/** Variation relative d'une dimension (« 1 m plus large », « élargir de 50 cm », « +1 m en profondeur »). */
function relatif(t: string, plus: string, moins: string, nom: string): number | null | 'sans-chiffre' {
  const pats: [RegExp, 1 | -1][] = [
    [new RegExp(`\\b${plus}\\b[^.0-9]{0,12}\\bde\\s+${NB}`), 1],
    [new RegExp(`${NB}\\s+(?:de\\s+)?plus\\s+(?:en\\s+|de\\s+)?${nom}\\b`), 1],
    [new RegExp(`${NB}\\s+plus\\s+${plus.replace('plus ', '')}\\b`), 1],
    [new RegExp(`\\+\\s*${NB}\\s+(?:en\\s+|de\\s+)?${nom}\\b`), 1],
    [new RegExp(`\\b${nom}\\s*\\+\\s*${NB}`), 1],
    [new RegExp(`\\b${moins}\\b[^.0-9]{0,12}\\bde\\s+${NB}`), -1],
    [new RegExp(`${NB}\\s+(?:de\\s+)?moins\\s+(?:en\\s+|de\\s+)?${nom}\\b`), -1],
    [new RegExp(`${NB}\\s+moins\\s+${plus.replace('plus ', '')}\\b`), -1],
    [new RegExp(`\\b${nom}\\s*-\\s*${NB}`), -1],
  ];
  for (const [re, signe] of pats) {
    const m = re.exec(t);
    if (m) return signe * metres(m[1]!, m[2]!);
  }
  return new RegExp(`\\b(?:${plus}|${moins})\\b`).test(t) ? 'sans-chiffre' : null;
}

/** Contexte d'une couleur RAL ou du zinc : menuiseries, façade, toiture, ou rien de dit. */
function contexte(t: string): { men: boolean; fac: boolean; toit: boolean } {
  return {
    men: /\b(?:menuiser\w*|fenetres?|chassis|huisser\w*|baies?|portes?-fenetres?|alu(?:minium)?)\b/.test(t),
    fac: /\b(?:facades?|enduit|murs?|crepi|bardage|revetement)\b/.test(t),
    toit: /\b(?:toit\w*|couverture|toiture)\b/.test(t),
  };
}

/**
 * Demandes de modification du message (texte libre et réponses aux questions de retouche). Les dimensions absolues
 * (« 5 × 6 m », « largeur 5 m ») sont lues par le parcours lui-même (lireReponses) : seules les variations relatives
 * sont lues ici.
 */
export function lireRetouches(texte: string): RetouchesLues {
  const t = normaliserInstructions(sansLibellesRetouche(texte))
    .replace(/\bd'un demi[- ]metre\b/g, 'de 0,5 m').replace(/\bun demi[- ]metre\b/g, '0,5 m')
    .replace(/\bd'un metre\b/g, 'de 1 m').replace(/\bun metre\b/g, '1 m').replace(/\bd'(\d)/g, 'de $1');
  const out: { -readonly [K in keyof RetouchesLues]: RetouchesLues[K] } = { limites: [], questions: [] };
  const limites: string[] = [];
  const questions: QuestionRetouche[] = [];
  if (!t) return out;

  // Dimensions relatives.
  const l = relatif(t, '(?:plus large|elargi\\w*|agrandi\\w* (?:la )?largeur)', '(?:moins large|retreci\\w*|redui\\w* (?:la )?largeur)', 'largeur');
  if (typeof l === 'number') out.largeur = { rel: l };
  else if (l === 'sans-chiffre') questions.push({ id: QR.largeur.id, libelle: QR.largeur.libelle, options: ['50 cm plus large', '1 m plus large', '2 m plus large', '1 m moins large'] });
  const p = relatif(t, '(?:plus profonde?|allonge\\w*|agrandi\\w* (?:la )?profondeur)', '(?:moins profonde?|raccourci\\w*|redui\\w* (?:la )?profondeur)', 'profondeur');
  if (typeof p === 'number') out.profondeur = { rel: p };
  else if (p === 'sans-chiffre') questions.push({ id: QR.profondeur.id, libelle: QR.profondeur.libelle, options: ['50 cm plus profonde', '1 m plus profonde', '2 m plus profonde', '1 m moins profonde'] });
  if (!out.largeur && !out.profondeur && !questions.length && /\b(?:plus grande?|plus petite?|agrandi[rs]? l'extension|reduire l'extension|redui[st] l'extension)\b/.test(t)) {
    questions.push({ id: QR.largeur.id, libelle: QR.largeur.libelle, options: ['1 m plus large', '1 m plus profonde', '1 m moins large', '1 m moins profonde'] });
  }

  // Côté, hauteur, menuiseries, baies : mêmes formulations explicites que les instructions de départ (lot G3).
  const ins = lireInstructions(texte);
  // « la baie à gauche » ne déplace pas l'extension : le côté doit porter sur l'extension elle-même.
  const coteDOuverture = /\b(?:baies?|fenetres?|portes?|ouvertures?|clotures?|portails?|haies?|grilles?)\b[^.]{0,25}\b(?:a gauche|a droite|a l'arriere|cote rue|sur (?:la )?rue)\b/.test(t);
  if (ins.facade && !coteDOuverture) out.cote = ins.facade;
  else if (/\b(?:de l'autre cote|cote oppose|l'autre cote)\b/.test(t)) out.cote = 'autre';
  if (ins.memeHauteur) out.hauteur = 'meme';
  else if (ins.niveauxExtension) out.hauteur = ins.niveauxExtension;
  else if (/\b(?:plus haute?|moins haute?|plus basse?|rehausse\w* l'extension|abaisse\w*)\b/.test(t)) {
    questions.push({ id: QR.hauteur.id, libelle: QR.hauteur.libelle, options: ['Plain-pied', 'Sur 2 niveaux', 'Même hauteur que la maison'] });
  }
  if (ins.menuiserie) out.menuiserie = ins.menuiserie;

  // Ouvertures.
  const sansBaie = /\b(?:enleve\w*|supprime\w*|retire\w*|sans|pas de|aucune?)\s+(?:la |les |de |une |grande )?(?:baies?|baie vitree|fenetres?|ouvertures?)\b|\bmurs? pleins?\b/.test(t);
  const avecBaie = /\b(?:ajoute\w*|remet\w*|avec|mets?|met)\s+(?:une |la |des |les |de |grande )?(?:baies?|baie vitree|grande baie|baie coulissante|fenetres?|portes?-fenetres?|ouvertures?)\b/.test(t);
  if (sansBaie && !avecBaie) out.baies = 'aucune';
  else if (avecBaie && !sansBaie) out.baies = 'auto';
  if (avecBaie && /\bportes?-fenetres?\b/.test(t)) limites.push('Les ouvertures sont placées par règle (baie coulissante sur la façade principale, fenêtres ailleurs) : je ne peux pas encore imposer une porte-fenêtre à un endroit précis.');

  // Toit de l'EXTENSION (jamais celui de la maison : « le toit de la maison est… » se corrige par la question du parcours).
  const toitMaison = /\btoit (?:de (?:la|ma) maison|existant)\b/.test(t) && !/\b(?:meme toit|comme (?:le toit de )?(?:la|ma) maison|meme toiture)\b/.test(t);
  if (!toitMaison) {
    const veg = /\b(?:toit\w*|toiture)\s+(?:\w+\s+)?vegetalis\w*|\bvegetalis\w*\b/.test(t);
    const plat = veg || /\btoit(?:ure)?[- ]?(?:plat|terrasse)\b|\btoit en terrasse\b/.test(t);
    const mono = /\b(?:mono[- ]?pente|un seul pan|(?:a |en )?(?:un|1) pan)\b/.test(t);
    const deux = /\b(?:(?:deux|2) pans|toit a pans)\b/.test(t);
    const prol = /\b(?:meme toit|meme toiture|toit comme (?:la|ma) maison|meme couverture que (?:la|ma) maison)\b/.test(t);
    const n = [plat, mono, deux, prol].filter(Boolean).length;
    if (n === 1) out.toit = plat ? 'plat' : mono ? 'monopente' : deux ? 'deux-pans' : 'prolongement';
    else if (n > 1 || /\btoit en pente\b/.test(t)) questions.push({ id: QR.toit.id, libelle: QR.toit.libelle, options: [...OPTIONS_TOIT] });
    if (veg && out.toit === 'plat') {
      out.vegetalise = true;
      limites.push('Toit végétalisé : le toit plat est dessiné, mais la végétation de toiture n’est pas encore dans la bibliothèque de rendu (membrane sombre à la place, dite sur l’image).');
    }
  }

  // Revêtement de façade.
  const ctx = contexte(t);
  const facades: FacadeContrat[] = [];
  const bois = /\bbardage (?:en )?bois\b|\b(?:facade|revetement|habillage|murs?) (?:en )?bois\b/.test(t)
    || (/\ben bois\b/.test(t) && !/\b(?:menuiser\w*|fenetres?|chassis|portes?|huisser\w*)\s+(?:en )?bois\b/.test(t));
  if (bois) {
    const clair = /\bbois (?:clair|blond|naturel|pin|meleze)\b|\bbardage (?:bois )?clair\b/.test(t);
    const noir = /\bbois (?:noir|noirci|brule|fonce|sombre)\b|\bbardage (?:bois )?(?:noir|noirci)\b/.test(t);
    const brun = /\bbois (?:brun|marron|teck|chene)\b|\bbardage (?:bois )?brun\b/.test(t);
    const k = [clair, noir, brun].filter(Boolean).length;
    if (k === 1) facades.push(clair ? 'av-bardage-bois-clair' : noir ? 'av-bardage-bois-noirci' : 'av-bardage-bois-brun');
    else questions.push({ id: QR.facade.id, libelle: QR.facade.libelle, options: [...OPTIONS_BARDAGE] });
  } else if (/\bbardage\b/.test(t) && !/\bzinc\b/.test(t)) {
    questions.push({ id: QR.facade.id, libelle: QR.facade.libelle, options: [...OPTIONS_BARDAGE, 'Bardage zinc'] });
  }
  if (/\b(?:bardage|facade|revetement) (?:en )?zinc\b|\bbardage zinc\b/.test(t)) facades.push('av-zinc-facade');
  else if (/\bzinc\b/.test(t)) {
    if (ctx.toit && !ctx.fac) out.couverture = 'av-zinc-anthracite';
    else if (ctx.fac && !ctx.toit) facades.push('av-zinc-facade');
    else questions.push({ id: QR.zinc.id, libelle: QR.zinc.libelle, options: ['Toit en zinc', 'Bardage zinc'] });
  }
  if (/\bbrique\b|\bbriques\b/.test(t)) {
    if (/\bbriques? (?:rouges?|rouge)\b/.test(t)) facades.push('av-brique-rouge');
    else if (/\bbriques? (?:claires?|blanches?|beiges?|sablees?)\b/.test(t)) facades.push('av-brique-claire');
    else questions.push({ id: QR.facade.id, libelle: QR.facade.libelle, options: ['Brique rouge', 'Brique claire'] });
  }
  if (/(?<!ton )\bpierre\b/.test(t) && !/\bpierre (?:de )?(?:tombe|angle)\b/.test(t)) facades.push('av-pierre-calcaire');
  if (/\bbeton\b/.test(t)) {
    if (/\bbeton (?:brut|banche|de decoffrage)\b|\bdecoffrage\b/.test(t)) facades.push('av-beton-brut');
    else if (/\bbeton (?:clair|lisse|blanc)\b/.test(t)) facades.push('av-beton-clair');
    else questions.push({ id: QR.facade.id, libelle: QR.facade.libelle, options: ['Béton clair', 'Béton brut'] });
  }
  if (/\benduit\b|\bcrepi\b|\bfacade (?:blanche|creme|beige)\b|\bmurs? (?:blancs|cremes?|beiges?)\b/.test(t)) {
    const blanc = /\b(?:enduit|crepi|facade|murs?) (?:blanc|blanche|blancs)\b/.test(t);
    const creme = /\b(?:enduit|crepi|facade|murs?) (?:creme|cremes|ivoire|ton pierre|sable)\b/.test(t);
    const beige = /\b(?:enduit|crepi|facade|murs?) (?:beige|beiges)\b/.test(t);
    const k = [blanc, creme, beige].filter(Boolean).length;
    if (k === 1) facades.push(blanc ? 'av-enduit-blanc' : creme ? 'av-enduit-creme' : 'av-enduit-beige');
    else if (!/\b(?:comme|meme)\b/.test(t)) questions.push({ id: QR.facade.id, libelle: QR.facade.libelle, options: ['Enduit blanc', 'Enduit crème', 'Enduit beige'] });
  }
  if (/\b(?:meme (?:enduit|facade|revetement) que (?:la|ma) maison|(?:facade|enduit|revetement) comme (?:la|ma) maison|comme la maison existante)\b/.test(t)) out.facade = null;
  const uniques = [...new Set(facades)];
  if (uniques.length === 1) out.facade = uniques[0]!;
  else if (uniques.length > 1) questions.push({ id: QR.facade.id, libelle: QR.facade.libelle, options: uniques.map((f) => LIBELLES_FACADE[f].replace(/^./, (c) => c.toUpperCase())) });

  // Couverture du toit de l'extension.
  if (/\bardoises?\b/.test(t)) out.couverture = 'av-ardoise';
  else if (/\btuiles?\b/.test(t)) out.couverture = 'av-tuiles-terre-cuite';

  // Couleurs RAL simples.
  for (const m of t.matchAll(/\bral\s*(\d{4})\b/g)) {
    const code = m[1]!;
    const pourMen = ctx.men && !ctx.fac, pourFac = ctx.fac && !ctx.men;
    if (!pourMen && !pourFac) {
      questions.push({ id: QR.couleur.id, libelle: QR.couleur.libelle, options: [`Menuiseries RAL ${code}`, `Façade RAL ${code}`] });
      continue;
    }
    if (pourMen) {
      const men: MenuiserieContrat | null = code === '7016' ? 'av-aluminium-noir' : ['9010', '9016', '9003'].includes(code) ? 'av-aluminium-blanc' : null;
      if (men) out.menuiserie = men;
      else limites.push(`Menuiseries RAL ${code} : cette couleur n’est pas encore dans la bibliothèque (disponibles : anthracite RAL 7016, blanc RAL 9010/9016, bois).`);
    } else {
      const fac: FacadeContrat | null = ['9010', '9016', '9003'].includes(code) ? 'av-enduit-blanc' : ['1013', '1015'].includes(code) ? 'av-enduit-creme' : ['1001', '1014'].includes(code) ? 'av-enduit-beige' : null;
      if (fac) out.facade = fac;
      else limites.push(`Façade RAL ${code} : cette teinte n’est pas encore dans la bibliothèque (disponibles : enduit blanc, crème ou beige, bardages bois, briques, pierre, bétons, zinc).`);
    }
  }

  // Point de vue : celui de la photo.
  if (/\b(?:vue|vu|voir|image|photo) (?:depuis|du|cote|de) (?:le |du )?jardin\b|\bdepuis le jardin\b|\bvue (?:de )?(?:derriere|arriere)\b|\b(?:un |une )?autre (?:angle|point de vue|vue)\b/.test(t)) out.vueJardin = true;

  out.limites = limites;
  // Une même question n'est posée qu'une fois (options fusionnées).
  const parId = new Map<string, QuestionRetouche>();
  for (const q of questions) {
    const deja = parId.get(q.id);
    parId.set(q.id, deja ? { ...deja, options: [...new Set([...deja.options, ...q.options])].slice(0, 6) } : q);
  }
  out.questions = [...parId.values()];
  return out;
}

/** Le message demande-t-il une retouche (ou pose-t-il une question de retouche) ? Pour le routage du chat. */
export function demandeRetouche(texte: string): boolean {
  const r = lireRetouches(texte);
  return r.questions.length > 0 || r.limites.length > 0 || r.vueJardin === true
    || (['largeur', 'profondeur', 'cote', 'hauteur', 'toit', 'facade', 'couverture', 'menuiserie', 'baies'] as const).some((k) => r[k] !== undefined);
}

// ── Application à l'état du parcours ─────────────────────────────────────────────────────────────────────────
/** Champs de l'état du parcours qu'une retouche peut changer (sous-ensemble structurel de EtatParcours). */
export interface EtatRetouchable {
  readonly type: string | null;
  readonly facade: CoteRetouche | null;
  readonly largeurM: number | null;
  readonly profondeurM: number | null;
  readonly niveauxExtension: number | null;
  readonly memeHauteur?: boolean;
  readonly menuiserie?: MenuiserieContrat | 'inconnue' | null;
  readonly baies?: 'auto' | 'aucune' | 'inconnue' | null;
  readonly toitExtension?: ToitRetouche | null;
  readonly vegetalise?: boolean;
  readonly facadeExtension?: FacadeContrat | null;
  readonly couvertureExtension?: CouvertureContrat | null;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const AUTRE_COTE: Readonly<Record<CoteRetouche, CoteRetouche | null>> = { gauche: 'droite', droite: 'gauche', arriere: null, rue: null };

/** Nouvel état après les retouches lues ; `limites` : demandes non appliquées, dites. Pur. */
export function appliquerRetouches<E extends EtatRetouchable>(etat: E, r: RetouchesLues): { etat: E; limites: string[] } {
  const e = { ...etat } as Record<string, unknown>;
  const limites = [...r.limites];
  const dim = (cle: 'largeurM' | 'profondeurM', d: DimensionRetouche | undefined, nom: string) => {
    if (!d) return;
    const avant = etat[cle];
    if (avant === null) { limites.push(`La ${nom} ne s’applique pas à ce type d’agrandissement.`); return; }
    const v = r2('abs' in d ? d.abs : avant + d.rel);
    if (v < 1) { limites.push(`Une ${nom} de ${String(v).replace('.', ',')} m n’est pas possible : la ${nom} reste de ${String(avant).replace('.', ',')} m.`); return; }
    if (v > 60) { limites.push(`Une ${nom} de ${String(v).replace('.', ',')} m dépasse ce que je sais dessiner pour une extension.`); return; }
    e[cle] = v;
  };
  dim('largeurM', r.largeur, 'largeur');
  dim('profondeurM', r.profondeur, 'profondeur');
  if (r.cote) {
    if (etat.type === 'surelevation') limites.push('Une surélévation n’a pas de côté : elle porte sur toute la maison.');
    else if (r.cote === 'autre') {
      const autre = etat.facade ? AUTRE_COTE[etat.facade] : null;
      if (autre) e.facade = autre; else limites.push('« De l’autre côté » : dites lequel (à gauche, à droite, à l’arrière ou côté rue).');
    } else e.facade = r.cote;
  }
  if (r.hauteur !== undefined) {
    if (etat.type === 'garage' || etat.type === 'surelevation') limites.push('La hauteur d’un garage ou d’une surélévation se règle autrement (garage de plain-pied, niveaux ajoutés).');
    else if (r.hauteur === 'meme') { e.memeHauteur = true; e.niveauxExtension = null; }
    else { e.niveauxExtension = r.hauteur; e.memeHauteur = false; }
  }
  if (r.toit) {
    if (etat.type === 'surelevation') limites.push('Le toit d’une surélévation reprend celui de la maison.');
    else e.toitExtension = r.toit;
  }
  if (r.vegetalise) e.vegetalise = true;
  else if (r.toit && r.toit !== 'plat') e.vegetalise = false;
  if (r.facade !== undefined) e.facadeExtension = r.facade;
  if (r.couverture) {
    const toit = (e.toitExtension as ToitRetouche | null | undefined) ?? null;
    if (toit === 'plat' && r.couverture !== 'av-membrane-sombre') limites.push(`Un toit plat n’a pas de couverture en ${LIBELLES_COUVERTURE[r.couverture]} : choisissez d’abord un toit à pans (« toit à 2 pans », « monopente »).`);
    else e.couvertureExtension = r.couverture;
  }
  if (r.menuiserie) e.menuiserie = r.menuiserie;
  if (r.baies) {
    if (etat.type === 'garage') limites.push('Un garage n’a pas de baie vitrée (porte de garage).');
    else e.baies = r.baies;
  }
  return { etat: e as E, limites };
}

/** Changements lisibles entre deux états (« largeur 4 → 5 m », « façade : bardage bois clair »). Pur. */
export function changementsEntre(a: EtatRetouchable, b: EtatRetouchable): string[] {
  const out: string[] = [];
  const m = (v: number | null): string => (v === null ? '—' : `${String(v).replace('.', ',')} m`);
  if (a.facade !== b.facade && b.facade) out.push(`côté : ${LIBELLES_COTE[b.facade]}${a.facade ? ` (au lieu de ${LIBELLES_COTE[a.facade]})` : ''}`);
  if (a.largeurM !== b.largeurM) out.push(`largeur ${m(a.largeurM)} → ${m(b.largeurM)}`);
  if (a.profondeurM !== b.profondeurM) out.push(`profondeur ${m(a.profondeurM)} → ${m(b.profondeurM)}`);
  const h = (x: EtatRetouchable): string => (x.memeHauteur ? 'même hauteur que la maison' : x.niveauxExtension === 1 ? 'plain-pied' : x.niveauxExtension ? `${x.niveauxExtension} niveaux` : '—');
  if (h(a) !== h(b)) out.push(`hauteur : ${h(b)}`);
  if ((a.toitExtension ?? null) !== (b.toitExtension ?? null) || (a.vegetalise ?? false) !== (b.vegetalise ?? false)) {
    out.push(`toit : ${b.toitExtension ? LIBELLES_TOIT_EXT[b.toitExtension] : 'comme calculé par défaut'}${b.vegetalise ? ' (végétalisé demandé)' : ''}`);
  }
  if ((a.facadeExtension ?? null) !== (b.facadeExtension ?? null)) out.push(`façade : ${b.facadeExtension ? LIBELLES_FACADE[b.facadeExtension] : 'comme la maison (teinte mesurée sur la photo)'}`);
  if ((a.couvertureExtension ?? null) !== (b.couvertureExtension ?? null) && b.couvertureExtension) out.push(`couverture : ${LIBELLES_COUVERTURE[b.couvertureExtension]}`);
  const men = (x: EtatRetouchable): string | null => (x.menuiserie && x.menuiserie !== 'inconnue' ? LIBELLES_MENUISERIE[x.menuiserie] : null);
  if (men(a) !== men(b) && men(b)) out.push(men(b)!);
  const ba = (x: EtatRetouchable): string | null => (x.baies === 'auto' ? 'avec baie vitrée' : x.baies === 'aucune' ? 'sans baie (murs pleins)' : null);
  if (ba(a) !== ba(b) && ba(b)) out.push(ba(b)!);
  return out;
}

/** Résumé d'une variante (« façade bardage bois clair · toit plat · menuiseries anthracite »). Pur. */
export function resumeHabillage(e: EtatRetouchable): string {
  return [
    e.facadeExtension ? LIBELLES_FACADE[e.facadeExtension] : 'façade comme la maison',
    e.toitExtension ? `${LIBELLES_TOIT_EXT[e.toitExtension]}${e.vegetalise ? ' végétalisé (demandé)' : ''}` : null,
    e.couvertureExtension ? LIBELLES_COUVERTURE[e.couvertureExtension] : null,
    e.menuiserie && e.menuiserie !== 'inconnue' ? LIBELLES_MENUISERIE[e.menuiserie] : null,
    e.baies === 'auto' ? 'avec baie vitrée' : e.baies === 'aucune' ? 'sans baie' : null,
  ].filter(Boolean).join(' · ');
}

/** Suggestions de retouche (puces) adaptées à la variante affichée : chaque option se relit d'elle-même. Pur. */
export function suggestionsRetouche(e: EtatRetouchable): string[] {
  const s: string[] = [];
  if (e.type !== 'surelevation') s.push(e.facadeExtension === 'av-bardage-bois-clair' ? 'Façade en enduit blanc' : 'Façade en bardage bois clair');
  if (e.type !== 'surelevation') s.push(e.toitExtension === 'plat' ? 'Toit à 2 pans' : 'Toit plat');
  if (e.largeurM !== null) s.push('1 m plus large');
  if (e.type !== 'garage' && e.type !== 'surelevation') s.push(e.baies === 'aucune' ? 'Avec baie vitrée' : 'Sans baie vitrée');
  return s.slice(0, 4);
}

/** Sous-listes fermées exportées pour les tests et le routage. */
export const LISTES = { FACADES_CONTRAT, COUVERTURES_CONTRAT } as const;
