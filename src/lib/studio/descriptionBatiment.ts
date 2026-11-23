// src/lib/studio/descriptionBatiment.ts
// =============================================================================
// VIS-22 — « Dessiner le bâtiment » : CONTRAT « description du bâtiment » (v1).
//
// UN seul contrat pour les deux entrées du chat :
//   1. l'utilisateur DÉCRIT son bâtiment en langage naturel ;
//   2. l'utilisateur joint la PHOTO d'un bâtiment qui ressemble (référence de STYLE, jamais un relevé).
// Dans les deux cas le modèle PROPOSE une description (outil `studio_decrire_batiment`) et ce fichier la
// VALIDE sans confiance (listes fermées, bornes, cohérences). Le même contrat est ensuite traduit, par du
// code pur et testé, vers ce que la chaîne sait réellement produire :
//   - `versForme`       : forme et niveaux demandés au moteur déterministe (studio_preparer_3d) ;
//   - `versBrief`       : habillage du rendu (BriefRendu de copilot-chat/agent/studio.ts, listes identiques) ;
//   - `clausesStudio`   : clauses de la commande de création lues par le Studio (parseArchitectureRequest) :
//                         toit à quatre pans / monopente / mansardé, style basque ou normand, colombages,
//                         volets, lucarnes, cheminée ;
//   - `bilanRendu`      : ce qui est reproduit, approché ou PAS ENCORE reproduit, dit élément par élément.
//
// PUR : aucun import, aucune E/S, aucun React. Ce fichier est importé tel quel par le front, par la fonction
// Edge (chemin relatif, comme src/lib/studio/briefProjet.ts) et COPIÉ à l'identique dans le Studio
// (mimmozia-studio/src/core/echange/descriptionBatiment.ts ; le test du Studio y vérifie les clauses sur le
// vrai lecteur de phrases).
// =============================================================================

export const DESCRIPTION_VERSION = 1;
/** Langue du bloc porté par le message « Reproduire en 3D » (relu par le serveur, jamais fourni par le modèle). */
export const DESCRIPTION_BLOC_LANGUE = 'mimmoza-batiment';
/** Nom de l'outil du chat (le modèle propose, le serveur valide). */
export const OUTIL_DECRIRE_BATIMENT = 'studio_decrire_batiment';

export const ORIGINES = ['texte', 'photo'] as const;
export const TYPES_BATIMENT = ['maison', 'collectif', 'autre'] as const;
export const FORMES_BATIMENT = ['plot', 'barre', 'l', 'u', 'cour', 'redans'] as const;
export const STYLES_BATIMENT = ['contemporain', 'basque', 'normand', 'haussmannien', 'art_deco', 'provencal', 'breton', 'landais', 'alsacien', 'savoyard', 'nord_brique', 'toulousain', 'meuliere', 'autre'] as const;
export const FORMES_TOIT = ['terrasse', 'vegetalisee', 'deux_pans', 'quatre_pans', 'monopente', 'mansarde'] as const;
export const COUVERTURES = ['tuiles', 'ardoise', 'zinc'] as const;
// Mêmes valeurs, même ordre que BRIEF_* de copilot-chat/agent/studio.ts (vérifié par le test Deno).
export const FACADES_BATIMENT = ['enduit_clair', 'enduit_blanc', 'brique', 'pierre', 'beton', 'bardage_bois', 'verre'] as const;
export const TEINTES_BATIMENT = ['naturelle', 'claire', 'foncee'] as const;
export const OUVERTURES_BATIMENT = ['fenetres_verticales', 'baies_vitrees', 'fenetres_horizontales'] as const;
export const MENUISERIES_BATIMENT = ['gris', 'anthracite', 'blanc', 'bronze'] as const;
export const VOLETS = ['aucun', 'battants', 'persiennes', 'roulants', 'coulissants'] as const;
export const BALCONS_BATIMENT = ['balcons', 'balcons_filants', 'loggias', 'aucun'] as const;
export const GARDE_CORPS_BATIMENT = ['metal', 'verre', 'plein'] as const;
export const RDC_BATIMENT = ['logements', 'commerces'] as const;
export const SOUBASSEMENTS_BATIMENT = ['aucun', 'pierre', 'beton', 'brique'] as const;
export const COULEURS_BOIS = ['rouge', 'vert', 'brun', 'bleu', 'blanc', 'gris', 'noir', 'naturel'] as const;
export const ELEMENTS = ['colombages', 'lucarnes', 'cheminee', 'garage_accole', 'veranda', 'pergola', 'auvent', 'porche', 'bow_window', 'tourelle', 'escalier_exterieur', 'autre'] as const;
export const COTES = ['gauche', 'droite', 'avant', 'arriere'] as const;

export type Origine = typeof ORIGINES[number];
export type TypeBatiment = typeof TYPES_BATIMENT[number];
export type FormeBatiment = typeof FORMES_BATIMENT[number];
export type StyleBatiment = typeof STYLES_BATIMENT[number];
export type FormeToit = typeof FORMES_TOIT[number];
export type Couverture = typeof COUVERTURES[number];
export type FacadeBatiment = typeof FACADES_BATIMENT[number];
export type TeinteBatiment = typeof TEINTES_BATIMENT[number];
export type OuverturesBatiment = typeof OUVERTURES_BATIMENT[number];
export type MenuiseriesBatiment = typeof MENUISERIES_BATIMENT[number];
export type Volets = typeof VOLETS[number];
export type BalconsBatiment = typeof BALCONS_BATIMENT[number];
export type GardeCorpsBatiment = typeof GARDE_CORPS_BATIMENT[number];
export type RdcBatiment = typeof RDC_BATIMENT[number];
export type SoubassementBatiment = typeof SOUBASSEMENTS_BATIMENT[number];
export type CouleurBois = typeof COULEURS_BOIS[number];
export type TypeElement = typeof ELEMENTS[number];
export type Cote = typeof COTES[number];

/** Bornes du contrat (niveaux : comme le moteur et le Studio, 30 au plus). */
export const BORNES_DESCRIPTION = { niveauxMin: 1, niveauxMax: 30, elementsMax: 8, precisionMax: 80, remarquesMax: 200 } as const;

export interface ElementRemarquable {
  type: TypeElement;
  /** Teinte des bois ou de l'élément quand elle est dite ou visible. */
  couleur: CouleurBois | null;
  /** Côté du bâtiment vu depuis la rue (« garage accolé à gauche »). */
  cote: Cote | null;
  /** Précision courte en clair (« balcon en bois sur toute la largeur »). */
  precision: string | null;
}

export interface DescriptionBatiment {
  v: typeof DESCRIPTION_VERSION;
  origine: Origine;
  type: TypeBatiment;
  /** Forme en plan ; null : laissée au moteur (il choisit celle qui tient sur le terrain). */
  forme: FormeBatiment | null;
  /** Niveaux hors sol, rez-de-chaussée compris (R+1 = 2) ; null : laissés au moteur. */
  niveaux: number | null;
  style: StyleBatiment;
  toiture: { forme: FormeToit; couverture: Couverture | null };
  facade: { materiau: FacadeBatiment; teinte: TeinteBatiment; /** Couleur dite ou vue (#rrggbb) : indicative. */ couleur: string | null };
  ouvertures: { type: OuverturesBatiment; menuiseries: MenuiseriesBatiment; volets: Volets; couleurVolets: CouleurBois | null };
  balcons: { type: BalconsBatiment; gardeCorps: GardeCorpsBatiment };
  attique: boolean;
  rdc: RdcBatiment;
  soubassement: SoubassementBatiment;
  elements: ElementRemarquable[];
  remarques: string | null;
  /** Champs que le modèle n'a pas pu lire avec certitude (photo floue, texte muet) : affichés « à vérifier ». */
  incertains: ChampDescription[];
}

/** Champs affichés et modifiables dans la carte (ordre de la carte). */
export const CHAMPS_DESCRIPTION = ['type', 'forme', 'niveaux', 'style', 'toiture', 'facade', 'ouvertures', 'menuiseries', 'volets', 'balcons', 'garde_corps', 'attique', 'rdc', 'soubassement', 'elements'] as const;
export type ChampDescription = typeof CHAMPS_DESCRIPTION[number];

export const DESCRIPTION_DEFAUT: Omit<DescriptionBatiment, 'origine'> = {
  v: DESCRIPTION_VERSION, type: 'collectif', forme: null, niveaux: null, style: 'contemporain',
  toiture: { forme: 'terrasse', couverture: null },
  facade: { materiau: 'enduit_clair', teinte: 'naturelle', couleur: null },
  ouvertures: { type: 'fenetres_verticales', menuiseries: 'gris', volets: 'aucun', couleurVolets: null },
  balcons: { type: 'aucun', gardeCorps: 'metal' },
  attique: false, rdc: 'logements', soubassement: 'aucun', elements: [], remarques: null, incertains: [],
};

/** Teintes réellement distinctes par matière : identique à TEINTES_PAR_FACADE de studio.ts (test Deno). */
export const TEINTES_PAR_FACADE_BATIMENT: Record<FacadeBatiment, readonly TeinteBatiment[]> = {
  enduit_clair: ['naturelle'], enduit_blanc: ['naturelle'], brique: ['naturelle', 'claire'], pierre: ['naturelle'],
  beton: ['naturelle', 'claire'], bardage_bois: ['naturelle', 'foncee'], verre: ['naturelle'],
};
export const toitEnPenteBatiment = (f: FormeToit): boolean => f === 'deux_pans' || f === 'quatre_pans' || f === 'monopente' || f === 'mansarde';
export const formeAAiles = (f: FormeBatiment | null): boolean => f === 'l' || f === 'u' || f === 'cour' || f === 'redans';
/** Styles que le Studio sait réellement appliquer (packs « operational » : basque, normand ; contemporain = dessin de base). */
export const STYLES_REPRODUITS: readonly StyleBatiment[] = ['contemporain', 'basque', 'normand'];
type StylePack = 'basque' | 'normand';
const styleAPack = (s: StyleBatiment): s is StylePack => s === 'basque' || s === 'normand';
/** Teintes de bois de chaque pack du Studio (stylepack/packs/basque.ts, norman.ts). */
export const COULEURS_PACK: Record<StylePack, readonly CouleurBois[]> = { basque: ['rouge', 'vert', 'brun', 'bleu'], normand: ['brun', 'naturel'] };

// ---- Validation sans confiance ------------------------------------------------

export type ValidationDescription =
  | { ok: true; valeur: DescriptionBatiment; /** Ce que le code a corrigé ou écarté (dit au modèle et à l'utilisateur). */ corrections: string[] }
  | { ok: false; erreur: string };

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const dans = <T extends string>(liste: readonly T[], v: unknown): v is T => typeof v === 'string' && (liste as readonly string[]).includes(v);
/** Texte court sans caractère de contrôle ni accent grave de bloc ; null si vide. */
function texteCourt(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = Array.from(v, (ch) => (ch.charCodeAt(0) < 32 || ch === '`' ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

const CLES_PERMISES = ['v', 'origine', 'type', 'forme', 'niveaux', 'style', 'toiture', 'facade', 'ouvertures', 'balcons', 'attique', 'rdc', 'soubassement', 'elements', 'remarques', 'incertains'];

/**
 * Description brute (proposée par le modèle, ou relue d'un bloc du message) vers description validée.
 * `strict` (bloc de la carte) : toute valeur hors liste, toute incohérence est une ERREUR. Sinon (proposition du
 * modèle) : la valeur hors liste est écartée, remplacée par la valeur par défaut et notée dans `corrections`,
 * jamais devinée ; les cohérences (attique / toit en pente, teinte / matière, soubassement / commerces) sont
 * rétablies et dites.
 */
export function validerDescription(brut: unknown, strict = false): ValidationDescription {
  if (!estObj(brut)) return { ok: false, erreur: 'Description illisible : objet attendu.' };
  if ((brut.v !== undefined || strict) && brut.v !== DESCRIPTION_VERSION) return { ok: false, erreur: 'Description d’une version inconnue.' };
  const corrections: string[] = [];
  let erreur: string | null = null;
  const refuser = (strictMsg: string, note: string): void => { if (strict) erreur ??= strictMsg; else corrections.push(note); };
  const inconnue = Object.keys(brut).find((k) => !CLES_PERMISES.includes(k));
  if (inconnue) refuser(`Description : champ inconnu ${inconnue.slice(0, 30)}.`, `champ inconnu « ${inconnue.slice(0, 30)} » ignoré`);
  /** Valeur d'une liste fermée ; absente : défaut ; hors liste : erreur (strict) ou défaut noté. */
  const choisir = <T extends string, D extends T | null>(nom: string, liste: readonly T[], v: unknown, defaut: D): T | D => {
    if (v === undefined || v === null) return defaut;
    if (dans(liste, v)) return v;
    refuser(`Valeur refusée pour ${nom} : ${liste.join(', ')}.`, `${nom} : valeur hors liste écartée`);
    return defaut;
  };
  const sous = (nom: string, v: unknown): Obj => {
    if (v === undefined || v === null) return {};
    if (estObj(v)) return v;
    refuser(`${nom} : objet attendu.`, `${nom} illisible : valeurs par défaut`);
    return {};
  };
  const D = DESCRIPTION_DEFAUT;
  const origine = choisir('origine', ORIGINES, brut.origine, 'texte');
  const type = choisir('type', TYPES_BATIMENT, brut.type, D.type);
  const forme = choisir('forme', FORMES_BATIMENT, brut.forme, null);
  let niveaux: number | null = null;
  if (brut.niveaux !== undefined && brut.niveaux !== null) {
    if (typeof brut.niveaux !== 'number' || !Number.isFinite(brut.niveaux)) refuser('niveaux : nombre attendu.', 'niveaux illisibles : laissés au moteur');
    else {
      niveaux = Math.max(BORNES_DESCRIPTION.niveauxMin, Math.min(BORNES_DESCRIPTION.niveauxMax, Math.round(brut.niveaux)));
      if (niveaux !== brut.niveaux) refuser(`niveaux : entier de ${BORNES_DESCRIPTION.niveauxMin} à ${BORNES_DESCRIPTION.niveauxMax}.`, `niveaux ramenés à ${niveaux}`);
    }
  }
  const style = choisir('style', STYLES_BATIMENT, brut.style, D.style);
  const t = sous('toiture', brut.toiture);
  const toitForme = choisir('toiture.forme', FORMES_TOIT, t.forme, D.toiture.forme);
  let couverture = choisir('toiture.couverture', COUVERTURES, t.couverture, null);
  const f = sous('facade', brut.facade);
  const materiau = choisir('facade.materiau', FACADES_BATIMENT, f.materiau, D.facade.materiau);
  let teinte = choisir('facade.teinte', TEINTES_BATIMENT, f.teinte, D.facade.teinte);
  let couleur: string | null = null;
  if (f.couleur !== undefined && f.couleur !== null) {
    if (typeof f.couleur === 'string' && /^#[0-9a-fA-F]{6}$/.test(f.couleur)) couleur = f.couleur.toLowerCase();
    else refuser('facade.couleur : #rrggbb attendu.', 'couleur de façade illisible : ignorée');
  }
  const o = sous('ouvertures', brut.ouvertures);
  const typeOuv = choisir('ouvertures.type', OUVERTURES_BATIMENT, o.type, D.ouvertures.type);
  const menuiseries = choisir('ouvertures.menuiseries', MENUISERIES_BATIMENT, o.menuiseries, D.ouvertures.menuiseries);
  const volets = choisir('ouvertures.volets', VOLETS, o.volets, D.ouvertures.volets);
  let couleurVolets = choisir('ouvertures.couleurVolets', COULEURS_BOIS, o.couleurVolets, null);
  const b = sous('balcons', brut.balcons);
  const typeBalcons = choisir('balcons.type', BALCONS_BATIMENT, b.type, D.balcons.type);
  const gardeCorps = choisir('balcons.gardeCorps', GARDE_CORPS_BATIMENT, b.gardeCorps, D.balcons.gardeCorps);
  let attique = false;
  if (brut.attique !== undefined && brut.attique !== null) {
    if (typeof brut.attique === 'boolean') attique = brut.attique;
    else refuser('attique : vrai ou faux attendu.', 'attique illisible : sans attique');
  }
  const rdc = choisir('rdc', RDC_BATIMENT, brut.rdc, D.rdc);
  let soubassement = choisir('soubassement', SOUBASSEMENTS_BATIMENT, brut.soubassement, D.soubassement);
  // Éléments remarquables : liste bornée, doublons (même type et même côté) retirés.
  const elements: ElementRemarquable[] = [];
  if (brut.elements !== undefined && brut.elements !== null) {
    if (!Array.isArray(brut.elements)) refuser('elements : liste attendue.', 'éléments illisibles : ignorés');
    else {
      if (brut.elements.length > BORNES_DESCRIPTION.elementsMax) refuser(`elements : ${BORNES_DESCRIPTION.elementsMax} au plus.`, `éléments : les ${BORNES_DESCRIPTION.elementsMax} premiers sont gardés`);
      for (const e of brut.elements.slice(0, BORNES_DESCRIPTION.elementsMax)) {
        if (!estObj(e) || !dans(ELEMENTS, e.type)) { refuser('elements : élément inconnu.', 'élément inconnu écarté'); continue; }
        const el: ElementRemarquable = {
          type: e.type,
          couleur: choisir('elements.couleur', COULEURS_BOIS, e.couleur, null),
          cote: choisir('elements.cote', COTES, e.cote, null),
          precision: texteCourt(e.precision, BORNES_DESCRIPTION.precisionMax),
        };
        if (el.type === 'autre' && !el.precision) { refuser('elements : un élément « autre » doit être précisé.', 'élément « autre » sans précision écarté'); continue; }
        if (el.type !== 'autre' && elements.some((x) => x.type === el.type && x.cote === el.cote)) continue;
        elements.push(el);
      }
    }
  }
  const remarques = texteCourt(brut.remarques, BORNES_DESCRIPTION.remarquesMax);
  let incertains: ChampDescription[] = [];
  if (Array.isArray(brut.incertains)) { const liste: unknown[] = brut.incertains; incertains = CHAMPS_DESCRIPTION.filter((c) => liste.includes(c)); }
  else if (brut.incertains !== undefined && brut.incertains !== null) refuser('incertains : liste attendue.', 'liste des points incertains illisible : ignorée');

  // Cohérences (mêmes règles que validerBrief de studio.ts), rétablies et dites.
  if (!toitEnPenteBatiment(toitForme)) {
    if (couverture !== null) refuser('toiture : pas de couverture pour un toit plat.', 'couverture sans objet pour un toit plat : retirée');
    couverture = null;
  } else if (couverture === null) { couverture = 'tuiles'; refuser('toiture : couverture attendue pour un toit en pente.', 'couverture non précisée : tuiles proposées'); }
  if (!TEINTES_PAR_FACADE_BATIMENT[materiau].includes(teinte)) {
    refuser(`facade : teinte « ${teinte} » indisponible pour cette matière.`, `teinte « ${teinte} » indisponible pour cette façade : teinte naturelle`);
    teinte = 'naturelle';
  }
  if (attique && toitEnPenteBatiment(toitForme)) { attique = false; refuser('Un toit en pente ne se combine pas avec un attique.', 'un toit en pente ne se combine pas avec un attique : attique retiré'); }
  if (rdc === 'commerces' && soubassement !== 'aucun') { soubassement = 'aucun'; refuser('Pas de soubassement avec des commerces en rez-de-chaussée.', 'pas de soubassement avec des commerces en rez-de-chaussée : soubassement retiré'); }
  if (volets === 'aucun' && couleurVolets !== null) { couleurVolets = null; refuser('ouvertures : couleur de volets sans volets.', 'couleur de volets sans volets : retirée'); }
  if (erreur) return { ok: false, erreur };
  return {
    ok: true, corrections,
    valeur: {
      v: DESCRIPTION_VERSION, origine, type, forme, niveaux, style,
      toiture: { forme: toitForme, couverture },
      facade: { materiau, teinte, couleur },
      ouvertures: { type: typeOuv, menuiseries, volets, couleurVolets },
      balcons: { type: typeBalcons, gardeCorps },
      attique, rdc, soubassement, elements, remarques, incertains,
    },
  };
}

// ---- Libellés (français, sans jargon) -----------------------------------------

export const LIBELLES = {
  type: { maison: 'Maison', collectif: 'Immeuble de logements', autre: 'Autre bâtiment' },
  forme: { plot: 'Compact (plot)', barre: 'Allongé (barre)', l: 'En L', u: 'En U', cour: 'Autour d’une cour', redans: 'À redans (décrochés)' },
  style: {
    contemporain: 'Contemporain', basque: 'Basque', normand: 'Normand', haussmannien: 'Haussmannien', art_deco: 'Art déco', provencal: 'Provençal',
    breton: 'Breton', landais: 'Landais', alsacien: 'Alsacien', savoyard: 'Savoyard (chalet)', nord_brique: 'Maison du Nord en brique',
    toulousain: 'Toulousain', meuliere: 'Meulière francilienne', autre: 'Autre style',
  },
  toit: { terrasse: 'Toit-terrasse', vegetalisee: 'Toiture végétalisée', deux_pans: 'Toit à deux pans', quatre_pans: 'Toit à quatre pans', monopente: 'Toit à une pente', mansarde: 'Toit mansardé' },
  couverture: { tuiles: 'tuiles', ardoise: 'ardoise', zinc: 'zinc' },
  facade: { enduit_clair: 'Enduit clair', enduit_blanc: 'Enduit blanc', brique: 'Brique', pierre: 'Pierre claire', beton: 'Béton', bardage_bois: 'Bardage bois', verre: 'Verre' },
  teinte: { naturelle: 'teinte naturelle', claire: 'teinte claire', foncee: 'teinte foncée' },
  ouvertures: { fenetres_verticales: 'Fenêtres verticales', baies_vitrees: 'Baies vitrées', fenetres_horizontales: 'Fenêtres en bandeau' },
  menuiseries: { gris: 'Alu gris', anthracite: 'Anthracite', blanc: 'Blanc', bronze: 'Bronze' },
  volets: { aucun: 'Sans volets', battants: 'Volets battants', persiennes: 'Persiennes', roulants: 'Volets roulants', coulissants: 'Volets coulissants' },
  balcons: { balcons: 'Balcons', balcons_filants: 'Balcons filants', loggias: 'Loggias', aucun: 'Sans balcon' },
  gardeCorps: { metal: 'Garde-corps métal', verre: 'Garde-corps en verre', plein: 'Garde-corps pleins' },
  rdc: { logements: 'Logements', commerces: 'Commerces' },
  soubassement: { aucun: 'Sans soubassement', pierre: 'Soubassement en pierre', beton: 'Soubassement en béton', brique: 'Soubassement en brique' },
  couleur: { rouge: 'rouge', vert: 'vert', brun: 'brun', bleu: 'bleu', blanc: 'blanc', gris: 'gris', noir: 'noir', naturel: 'bois naturel' },
  element: {
    colombages: 'Colombages', lucarnes: 'Lucarnes', cheminee: 'Cheminée', garage_accole: 'Garage accolé', veranda: 'Véranda', pergola: 'Pergola',
    auvent: 'Auvent', porche: 'Porche', bow_window: 'Bow-window', tourelle: 'Tourelle', escalier_exterieur: 'Escalier extérieur', autre: 'Autre élément',
  },
  cote: { gauche: 'à gauche', droite: 'à droite', avant: 'à l’avant', arriere: 'à l’arrière' },
} as const;

/** « R+1 », « Rez-de-chaussée seul ». */
export const libelleNiveauxBatiment = (n: number): string => (n <= 1 ? 'Rez-de-chaussée seul' : `R+${n - 1}`);
export function libelleToiture(t: DescriptionBatiment['toiture']): string {
  return t.couverture && toitEnPenteBatiment(t.forme) ? `${LIBELLES.toit[t.forme]} en ${LIBELLES.couverture[t.couverture]}` : LIBELLES.toit[t.forme];
}
export function libelleVolets(o: DescriptionBatiment['ouvertures']): string {
  return `${LIBELLES.volets[o.volets]}${o.volets !== 'aucun' && o.couleurVolets ? ` ${LIBELLES.couleur[o.couleurVolets]}` : ''}`;
}
export function libelleElement(e: ElementRemarquable): string {
  const base = e.type === 'autre' ? (e.precision ?? LIBELLES.element.autre) : LIBELLES.element[e.type];
  return [base, e.couleur ? LIBELLES.couleur[e.couleur] : null, e.cote ? LIBELLES.cote[e.cote] : null].filter(Boolean).join(' ')
    + (e.type !== 'autre' && e.precision ? ` (${e.precision})` : '');
}
/** Phrase lisible de toute la description (message de l'utilisateur, devis, journal du rendu). */
export function phraseDescription(d: DescriptionBatiment): string {
  const style = d.style === 'contemporain' ? ' contemporain' : d.style === 'autre' ? '' : ` de style ${LIBELLES.style[d.style].toLowerCase()}`;
  const p: (string | null)[] = [
    `${LIBELLES.type[d.type].toLowerCase()}${style}`,
    d.niveaux ? libelleNiveauxBatiment(d.niveaux) : null,
    d.forme ? LIBELLES.forme[d.forme].toLowerCase() : null,
    libelleToiture(d.toiture).toLowerCase(),
    `façade ${LIBELLES.facade[d.facade.materiau].toLowerCase()}${d.facade.teinte !== 'naturelle' ? ` (${LIBELLES.teinte[d.facade.teinte]})` : ''}`,
    LIBELLES.ouvertures[d.ouvertures.type].toLowerCase(),
    `menuiseries ${LIBELLES.menuiseries[d.ouvertures.menuiseries].toLowerCase()}`,
    d.ouvertures.volets !== 'aucun' ? libelleVolets(d.ouvertures).toLowerCase() : null,
    d.balcons.type !== 'aucun' ? `${LIBELLES.balcons[d.balcons.type].toLowerCase()} (${LIBELLES.gardeCorps[d.balcons.gardeCorps].toLowerCase()})` : null,
    d.attique ? 'attique' : null,
    d.rdc === 'commerces' ? 'commerces en rez-de-chaussée' : null,
    d.soubassement !== 'aucun' ? LIBELLES.soubassement[d.soubassement].toLowerCase() : null,
    ...d.elements.map((e) => libelleElement(e).toLowerCase()),
  ];
  return p.filter(Boolean).join(', ').replace(/R\+/gi, 'R+').replace(/\ben ([lu])(?![\p{L}])/gu, (_m, x: string) => `en ${x.toUpperCase()}`);
}

// ---- Traductions vers ce que la chaîne sait produire --------------------------

/** Forme et niveaux demandés au moteur déterministe (qui garde la main : terrain, règles, gabarit). */
export function versForme(d: DescriptionBatiment): { forme: FormeBatiment | null; niveaux: number | null } {
  return { forme: d.forme, niveaux: d.niveaux };
}

/** Toiture du brief de rendu la plus proche (le brief ne connaît que terrasse, végétalisée et deux pans). */
function toitureBrief(d: DescriptionBatiment): string {
  if (d.toiture.forme === 'terrasse' || d.toiture.forme === 'vegetalisee') return d.toiture.forme;
  // Bâtiment à ailes : le Studio ne raccorde pas les toits en pente entre les ailes (RAISON_PENTE_AILES de studio.ts).
  if (formeAAiles(d.forme)) return 'terrasse';
  return `deux_pans_${d.toiture.couverture ?? 'tuiles'}`;
}

/** Longueur maximale des précisions du brief (BRIEF_PRECISIONS_MAX de studio.ts, vérifié par le test Deno). */
export const PRECISIONS_BRIEF_MAX = 100;

/**
 * Description vers brief d'habillage du rendu (mêmes champs et mêmes valeurs que `validerBrief` de studio.ts, qui le
 * REVALIDE côté serveur). Ce que le brief ne sait pas porter (style, éléments, volets) part en `precisions` (texte
 * court, informatif) et, pour ce que le Studio sait lire, dans `clausesStudio`.
 */
export function versBrief(d: DescriptionBatiment): Record<string, string | boolean> {
  const extras = [
    d.style !== 'contemporain' && d.style !== 'autre' ? `style ${LIBELLES.style[d.style].toLowerCase()}` : null,
    d.ouvertures.volets !== 'aucun' ? libelleVolets(d.ouvertures).toLowerCase() : null,
    ...d.elements.map((e) => libelleElement({ ...e, precision: e.type === 'autre' ? e.precision : null }).toLowerCase()),
  ].filter((x): x is string => !!x);
  let precisions = '';
  for (const x of extras) { const suite = precisions ? `${precisions} ; ${x}` : x; if (suite.length > PRECISIONS_BRIEF_MAX) break; precisions = suite; }
  return {
    facade: d.facade.materiau, ouvertures: d.ouvertures.type, balcons: d.balcons.type, attique: d.attique, rdc: d.rdc,
    toiture: toitureBrief(d), teinte: d.facade.teinte, garde_corps: d.balcons.gardeCorps, menuiseries: d.ouvertures.menuiseries,
    soubassement: d.soubassement, ...(precisions ? { precisions } : {}),
  };
}

const CLAUSE_TOIT: Record<FormeToit, string | null> = {
  terrasse: null, vegetalisee: 'toiture végétalisée', deux_pans: 'toiture à deux pans', quatre_pans: 'toiture à quatre pans',
  monopente: 'toiture monopente', mansarde: 'toiture mansardée',
};

export interface ClausesStudio {
  /** Clause de toiture (remplace celle du brief) ; null : toit-terrasse (dessin par défaut du Studio). */
  toiture: string | null;
  /** Style et éléments que le Studio lit dans la commande de création d'UN bâtiment (jamais pour plusieurs). */
  extras: string[];
}

/**
 * Clauses de la commande de création du Studio : formulations VÉRIFIÉES sur le vrai lecteur du Studio
 * (parseArchitectureRequest, test mimmozia-studio/tests/descriptionBatiment.test.ts) :
 *   « toiture à quatre pans en ardoise » : toit à croupes ; « toiture monopente en zinc » : une pente ;
 *   « toiture mansardée en zinc » : mansarde ; « de style basque » : pack de style basque ;
 *   « colombages rouges », « volets verts », « avec lucarnes », « avec cheminée » : composants du pack.
 * Colombages, volets, lucarnes et cheminée ne sont lus par le Studio QU'AVEC un style basque ou normand.
 */
export function clausesStudio(d: DescriptionBatiment): ClausesStudio {
  const ailes = formeAAiles(d.forme);
  const pente = toitEnPenteBatiment(d.toiture.forme);
  const base = ailes && pente ? null : CLAUSE_TOIT[d.toiture.forme];
  const toiture = base && pente && d.toiture.couverture ? `${base} en ${d.toiture.couverture}` : base;
  const extras: string[] = [];
  if (styleAPack(d.style) && !ailes) {
    extras.push(`de style ${d.style}`);
    const teintes = COULEURS_PACK[d.style];
    const accord = (c: CouleurBois | null): string => (c && c !== 'naturel' && teintes.includes(c) ? ` ${c}s` : '');
    const col = d.elements.find((e) => e.type === 'colombages');
    if (col) extras.push(`colombages${accord(col.couleur)}`);
    if (d.ouvertures.volets === 'battants') extras.push(`volets${accord(d.ouvertures.couleurVolets)}`);
    if (d.ouvertures.volets === 'persiennes') extras.push('volets persiennes');
    if (d.elements.some((e) => e.type === 'lucarnes')) extras.push('avec lucarnes');
    if (d.elements.some((e) => e.type === 'cheminee')) extras.push('avec cheminée');
  }
  return { toiture, extras };
}

const CLAUSE_FACADE_BATIMENT: Record<FacadeBatiment, string> = {
  enduit_clair: 'façade en enduit', enduit_blanc: 'façade en enduit blanc', brique: 'façade en brique', pierre: 'façade en pierre',
  beton: 'façade en béton', bardage_bois: 'façade en bardage bois', verre: 'façade en verre',
};
function clauseFacadeBatiment(d: DescriptionBatiment): string {
  const { materiau, teinte } = d.facade;
  if (materiau === 'brique' && teinte === 'claire') return 'façade en brique claire';
  if (materiau === 'beton' && teinte === 'claire') return 'façade en béton blanc';
  if (materiau === 'bardage_bois' && teinte === 'foncee') return 'façade en bois brûlé';
  return CLAUSE_FACADE_BATIMENT[materiau];
}
const CLAUSE_OUVERTURES_BATIMENT: Record<OuverturesBatiment, string> = {
  fenetres_verticales: 'fenêtres verticales', baies_vitrees: 'baies vitrées', fenetres_horizontales: 'fenêtres horizontales',
};

/**
 * Toutes les clauses d'UN bâtiment (façade, ouvertures, balcons, attique, commerces, toiture, style, éléments) :
 * mêmes formulations que `clausesBrief` de studio.ts (égalité vérifiée par le test Deno), plus `clausesStudio`.
 * Sert à l'ouverture du Studio depuis le chat (la commande n'y porte pas l'habillage du chat).
 */
export function clausesCompletes(d: DescriptionBatiment): string[] {
  const c = clausesStudio(d);
  return [
    clauseFacadeBatiment(d),
    d.facade.materiau === 'verre' ? null : CLAUSE_OUVERTURES_BATIMENT[d.ouvertures.type],
    d.balcons.type === 'balcons' ? 'avec balcons' : d.balcons.type === 'balcons_filants' ? 'avec balcons filants' : d.balcons.type === 'loggias' ? 'avec loggias' : null,
    d.attique ? 'avec attique' : null,
    d.rdc === 'commerces' ? 'commerces en rez-de-chaussée' : null,
    c.toiture,
    ...c.extras,
  ].filter((x): x is string => !!x);
}

const sansPointFinal = (s: string): string => s.trim().replace(/\.+$/, '');
const estClauseToit = (s: string): boolean => /^(?:toit|toiture)(?![\p{L}])/iu.test(s.trim());
const estClauseFacade = (s: string): boolean => /^fa[çc]ade(?![\p{L}])/iu.test(s.trim());
/** Longueur maximale de la commande d'architecture du contrat d'échange v2 (mimmozaProjetV2.ts). */
export const COMMANDE_MAX = 1000;

/**
 * Commande de création + clauses de la description. `dejaHabillee` : la commande porte déjà l'habillage du brief
 * (chemin du rendu, `commandeAvecBrief`) : seule la toiture est REMPLACÉE et le style / les éléments sont ajoutés ;
 * sinon (ouverture du Studio) toutes les clauses sont ajoutées, sans doubler une façade déjà écrite.
 * Une commande qui dépasserait la longueur du contrat est rendue telle quelle (jamais tronquée au milieu d'une clause).
 */
export function commandeAvecDescription(commande: string | null, d: DescriptionBatiment | null, dejaHabillee = false): string | null {
  if (!commande || !d) return commande;
  const c = clausesStudio(d);
  const segments = sansPointFinal(commande).split(/,\s*/);
  const tete = segments[0] ?? '';
  const suite = segments.slice(1).filter((s) => !estClauseToit(s));
  let ajouts: string[];
  if (dejaHabillee) ajouts = [c.toiture, ...c.extras].filter((x): x is string => !!x);
  else {
    const facadeEcrite = /\sen (?:brique|pierre|b[ée]ton|bardage|bois|verre|enduit)/i.test(tete) || suite.some(estClauseFacade);
    ajouts = clausesCompletes(d).filter((x) => !(facadeEcrite && estClauseFacade(x)));
  }
  const resultat = `${[tete, ...suite, ...ajouts].join(', ')}.`;
  return resultat.length <= COMMANDE_MAX ? resultat : commande;
}

/** Habillage à part d'un projet à PLUSIEURS bâtiments : seule la toiture y est remplacée (ni style ni éléments). */
export function clausesHabillageAvecDescription(clauses: readonly string[], d: DescriptionBatiment | null): string[] {
  if (!d) return [...clauses];
  const t = clausesStudio(d).toiture;
  return [...clauses.filter((s) => !estClauseToit(s)), ...(t ? [t] : [])].slice(0, 6);
}

// ---- Ce qui est reproduit, approché, pas encore reproduit ---------------------

export type EtatRendu = 'reproduit' | 'approche' | 'non_reproduit';
export interface LigneBilan { champ: ChampDescription; libelle: string; valeur: string; etat: EtatRendu; note: string | null; aVerifier: boolean }

const NOTE_MOTEUR = 'Dans la limite de ce que votre terrain et ses règles permettent.';
const NOTE_UN_BATIMENT = 'Reproduit quand le projet compte un seul bâtiment.';
const NOTE_TEINTE_PACK = 'Cette teinte n’existe pas dans ce style : teinte du style à la place.';

/** Bilan honnête, ligne par ligne, de ce que la 3D et les images reproduisent (affiché dans la carte du chat). */
export function bilanRendu(d: DescriptionBatiment): LigneBilan[] {
  const pack: StylePack | null = styleAPack(d.style) ? d.style : null;
  const ailes = formeAAiles(d.forme);
  const horsPack = (c: CouleurBois | null): boolean => !!pack && c !== null && c !== 'naturel' && !COULEURS_PACK[pack].includes(c);
  const l = (champ: ChampDescription, libelle: string, valeur: string, etat: EtatRendu, note: string | null = null): LigneBilan =>
    ({ champ, libelle, valeur, etat, note, aVerifier: d.incertains.includes(champ) });
  const pente = toitEnPenteBatiment(d.toiture.forme);
  const voletsPack = !!pack && !ailes && (d.ouvertures.volets === 'battants' || d.ouvertures.volets === 'persiennes');
  const lignes: LigneBilan[] = [
    l('type', 'Type de bâtiment', LIBELLES.type[d.type], 'reproduit', d.type === 'maison' ? 'Le volume est calculé sur votre terrain par le moteur.' : null),
    l('forme', 'Forme', d.forme ? LIBELLES.forme[d.forme] : 'Choisie par le moteur', 'reproduit', d.forme ? NOTE_MOTEUR : null),
    l('niveaux', 'Hauteur', d.niveaux ? libelleNiveauxBatiment(d.niveaux) : 'Choisie par le moteur', 'reproduit', d.niveaux ? NOTE_MOTEUR : null),
    d.style === 'contemporain' ? l('style', 'Style', LIBELLES.style[d.style], 'reproduit')
      : !pack ? l('style', 'Style', LIBELLES.style[d.style], 'non_reproduit', 'Ce style n’est pas encore disponible : seuls les matériaux, la toiture et les ouvertures ci-dessous sont repris.')
        : ailes ? l('style', 'Style', LIBELLES.style[d.style], 'non_reproduit', 'Pas encore disponible pour un bâtiment à ailes (en L, en U, cour, redans).')
          : l('style', 'Style', LIBELLES.style[d.style], 'reproduit', NOTE_UN_BATIMENT),
    !pente ? l('toiture', 'Toiture', libelleToiture(d.toiture), 'reproduit')
      : ailes ? l('toiture', 'Toiture', libelleToiture(d.toiture), 'non_reproduit', 'Toit en pente pas encore disponible pour un bâtiment à ailes : toit-terrasse à la place.')
        : d.toiture.forme === 'deux_pans' ? l('toiture', 'Toiture', libelleToiture(d.toiture), 'reproduit', 'Plus haut qu’un toit plat : à vérifier avec les règles du terrain.')
          : l('toiture', 'Toiture', libelleToiture(d.toiture), 'reproduit', 'Reproduit dans le Studio et les images d’un bâtiment simple ; l’aperçu rapide du chat le montre à deux pans.'),
    l('facade', 'Façade', `${LIBELLES.facade[d.facade.materiau]}${d.facade.teinte !== 'naturelle' ? `, ${LIBELLES.teinte[d.facade.teinte]}` : ''}`,
      d.facade.couleur ? 'approche' : 'reproduit', d.facade.couleur ? 'La matière est reprise ; la couleur exacte ne l’est pas encore.' : null),
    l('ouvertures', 'Fenêtres', LIBELLES.ouvertures[d.ouvertures.type], d.facade.materiau === 'verre' ? 'approche' : 'reproduit', d.facade.materiau === 'verre' ? 'Façade vitrée : grandes baies partout.' : null),
    l('menuiseries', 'Menuiseries', LIBELLES.menuiseries[d.ouvertures.menuiseries], 'reproduit'),
    d.ouvertures.volets === 'aucun' ? l('volets', 'Volets', LIBELLES.volets.aucun, 'reproduit')
      : voletsPack ? l('volets', 'Volets', libelleVolets(d.ouvertures), horsPack(d.ouvertures.couleurVolets) ? 'approche' : 'reproduit', horsPack(d.ouvertures.couleurVolets) ? NOTE_TEINTE_PACK : NOTE_UN_BATIMENT)
        : l('volets', 'Volets', libelleVolets(d.ouvertures), 'non_reproduit', 'Pas encore reproduits (aujourd’hui : volets battants ou persiennes des styles basque et normand).'),
    l('balcons', 'Balcons', LIBELLES.balcons[d.balcons.type], 'reproduit'),
    ...(d.balcons.type !== 'aucun' ? [l('garde_corps', 'Garde-corps', LIBELLES.gardeCorps[d.balcons.gardeCorps], 'reproduit')] : []),
    l('attique', 'Dernier étage en retrait', d.attique ? 'Oui (attique)' : 'Non', 'reproduit', d.attique ? 'Un étage en retrait ajouté au-dessus : à vérifier avec les règles du terrain.' : null),
    l('rdc', 'Rez-de-chaussée', LIBELLES.rdc[d.rdc], 'reproduit'),
    l('soubassement', 'Soubassement', LIBELLES.soubassement[d.soubassement], 'reproduit'),
  ];
  for (const e of d.elements) {
    const duPack = e.type === 'colombages' || e.type === 'lucarnes' || e.type === 'cheminee';
    const viaPack = !!pack && !ailes && duPack;
    const approche = viaPack && e.type === 'colombages' && horsPack(e.couleur);
    lignes.push(l('elements', 'Élément remarquable', libelleElement(e),
      viaPack ? (approche ? 'approche' : 'reproduit') : 'non_reproduit',
      viaPack ? (approche ? NOTE_TEINTE_PACK : NOTE_UN_BATIMENT)
        : duPack ? 'Reproduit seulement avec un style basque ou normand, sur un bâtiment simple.'
          : 'Pas encore reproduit en 3D : noté dans le projet, à ajouter à la main dans le Studio.'));
  }
  return lignes;
}

/** Éléments de la description qui ne seront PAS reproduits (phrases courtes, pour le chat et le journal du rendu). */
export function nonReproduits(d: DescriptionBatiment): string[] {
  return bilanRendu(d).filter((x) => x.etat === 'non_reproduit').map((x) => `${x.libelle.toLowerCase()} : ${x.valeur.toLowerCase()}`);
}

// ---- Bloc du message « Reproduire en 3D » -------------------------------------

const RE_BLOC_DESCRIPTION = new RegExp('```' + DESCRIPTION_BLOC_LANGUE + '[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n?```');

/**
 * Bloc ```mimmoza-batiment``` d'un message utilisateur vers description validée (mode strict). null : pas de bloc.
 * Présent mais refusé : `ok: false` (dit à l'utilisateur, jamais deviné).
 */
export function descriptionDuMessage(texte: unknown): ValidationDescription | null {
  if (typeof texte !== 'string') return null;
  const m = RE_BLOC_DESCRIPTION.exec(texte);
  if (!m) return null;
  let brut: unknown;
  try { brut = JSON.parse(m[1] ?? ''); } catch { return { ok: false, erreur: 'Bloc de description illisible (JSON invalide).' }; }
  return validerDescription(brut, true);
}

/** Texte du message sans le bloc de description (bulle de l'utilisateur). */
export function sansBlocDescription(texte: string): { visible: string; description: boolean } {
  const m = RE_BLOC_DESCRIPTION.exec(texte);
  if (!m) return { visible: texte, description: false };
  return { visible: (texte.slice(0, m.index) + texte.slice(m.index + m[0].length)).replace(/\n{3,}/g, '\n\n').trim(), description: true };
}

/** Début du message « Reproduire en 3D » (reconnu par le serveur pour proposer les outils du Studio). */
export const TETE_REPRODUIRE = 'Reproduis ce bâtiment en 3D';

/**
 * Message envoyé par le bouton « Reproduire en 3D » : une phrase lisible + le bloc de description + le bloc
 * d'habillage (```mimmoza-brief```, sans type de rendu : le serveur l'enregistre comme habillage du projet,
 * exactement comme la fiche de l'Espace 3D). Les deux blocs sont REVALIDÉS par le serveur.
 */
export function messageReproduire(d: DescriptionBatiment): string {
  const brief = { v: 1, brief: versBrief(d) };
  return `${TETE_REPRODUIRE} : ${phraseDescription(d)}.\n\n\`\`\`${DESCRIPTION_BLOC_LANGUE}\n${JSON.stringify(d)}\n\`\`\`\n\n\`\`\`mimmoza-brief\n${JSON.stringify(brief)}\n\`\`\``;
}

/** Mention obligatoire quand la description vient d'une photo. */
export const MENTION_PHOTO = 'La photo sert de référence de style : le bâtiment produit s’en inspire, ce n’est ni un relevé ni une copie exacte.';
