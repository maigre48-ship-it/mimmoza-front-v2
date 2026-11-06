// src/spaces/copilot/studio3d/briefCreatif.ts
// =============================================================================
// LOT BRIEF-CRÉATIF — Carte « Brief créatif » du chat : logique PURE (testée par
// briefCreatif.test.ts avec `node --test`). Aucune I/O, aucun React ici.
//
// Quand `studio_lancer_rendu` renvoie `partial` + `brief_requis` (copilot-chat/
// agent/studio.ts, demandeBrief), le chat affiche une carte en 3 écrans au lieu
// de la question texte. « Valider le brief » envoie un message utilisateur dont
// un bloc ```mimmoza-brief``` porte le brief structuré : le serveur le relit
// lui-même (studio.ts::briefDuMessage) et le valide (listes fermées).
//
// PRÉCISION : la carte ne propose QUE ce que le Studio applique (table du lot
// E1-brief, corrigée par E1-rendu) :
//   - style : aucun choix (contemporain = dessin par défaut du Studio) ;
//     haussmannien et Art déco sont montrés « bientôt », non sélectionnables
//     (packs du Studio au stade « manifest » : rien n'est appliqué) ;
//   - rez-de-chaussée « hall d'entrée » : montré « bientôt » (non dessiné) ;
//   - précisions libres : absentes (le Studio ne les interprète pas).
// Les listes de valeurs sont COMPLÈTES et dans l'ordre du serveur (indisponibles
// comprises) : le test échoue si elles divergent de studio.ts.
//
// LOT BRIEF-UNIFIÉ (06/11/2026) : un seul lieu pour le brief — la section « Style et
// habillage » de l'Espace 3D (FicheProjet3D.tsx). Le chat n'affiche plus qu'une ligne
// (LigneHabillage) qui ouvre le panneau ; `demandeEnCours` dit au panneau qu'un rendu
// attend l'habillage (il s'ouvre de lui-même). Détails ajoutés (écran « Détails »,
// facultatif, valeurs proposées présélectionnées) : toiture, teinte, garde-corps,
// menuiseries, soubassement — chacun RÉELLEMENT rendu par le Studio (CHOIX.md du lot) ;
// volets / brise-soleil et entrée sont montrés « bientôt » (BIENTOT), jamais envoyés.
//
// APERÇU : `sceneApercu` habille le volume RÉEL de l'utilisateur (corps du
// Dossier 3D renvoyés par le serveur dans `data.apercu`) avec les dimensions du
// Studio (mimmozia-studio/src/core/architecture : defaults.ts, FacadeGenerator.ts
// windowDims, BalconyGenerator.ts) et les couleurs déclarées de ses matériaux
// (src/core/materials/archvizLibrary.ts, table LEGACY_TO_ARCHVIZ, jeu du paquet
// Unreal). `dessinTravee` dessine une travée de façade (vignette SVG) avec les
// mêmes règles. Textures, modénature et entrée ne sont PAS reproduites.
// =============================================================================

// ── Bloc du message (même langue et même version que studio.ts) ────────────────
export const BRIEF_BLOC_LANGUE = 'mimmoza-brief';
export const BRIEF_BLOC_VERSION = 1;
export const OUTIL_LANCER_RENDU = 'studio_lancer_rendu';

export type TypeRenduBrief = 'film' | 'visite360' | 'image';
export type Style = 'contemporain' | 'haussmannien' | 'art_deco';
export type Facade = 'enduit_clair' | 'enduit_blanc' | 'brique' | 'pierre' | 'beton' | 'bardage_bois' | 'verre';
export type Ouvertures = 'fenetres_verticales' | 'baies_vitrees' | 'fenetres_horizontales';
export type Balcons = 'balcons' | 'balcons_filants' | 'loggias' | 'aucun';
export type Rdc = 'logements' | 'commerces' | 'hall';
export type Ambiance = 'jour' | 'fin_de_journee' | 'nuit';
export type Toiture = 'terrasse' | 'vegetalisee' | 'deux_pans_tuiles' | 'deux_pans_ardoise' | 'deux_pans_zinc';
export type Teinte = 'naturelle' | 'claire' | 'foncee';
export type GardeCorps = 'metal' | 'verre' | 'plein';
export type Menuiseries = 'gris' | 'anthracite' | 'blanc' | 'bronze';
export type Soubassement = 'aucun' | 'pierre' | 'beton' | 'brique';

/** Champs que la carte fait choisir (le style et les précisions n'en font pas partie). */
export const CHAMPS_CARTE = ['facade', 'ouvertures', 'balcons', 'attique', 'rdc', 'ambiance', 'toiture', 'teinte', 'garde_corps', 'menuiseries', 'soubassement'] as const;
/** Lot brief-unifié : champs de l'écran « Détails » (facultatif). */
export const CHAMPS_DETAILS = ['toiture', 'teinte', 'garde_corps', 'menuiseries', 'soubassement'] as const;
export type ChampCarte = typeof CHAMPS_CARTE[number];

export interface ChoixBrief {
  facade: Facade;
  ouvertures: Ouvertures;
  balcons: Balcons;
  attique: boolean;
  rdc: Rdc;
  ambiance: Ambiance;
  toiture: Toiture;
  teinte: Teinte;
  garde_corps: GardeCorps;
  menuiseries: Menuiseries;
  soubassement: Soubassement;
}

export interface OptionBrief<V> {
  valeur: V;
  libelle: string;
  /** Une phrase simple, sans terme du Studio. */
  detail: string;
  /** Faux = montré « bientôt », jamais sélectionnable (le Studio ne l'applique pas). */
  disponible: boolean;
  /** Lot fiche-3d : descriptif court (deux lignes) des cartes de style de la fiche « Espace 3D ». */
  descriptif?: string;
}

// Couleurs DÉCLARÉES des matériaux du Studio (archvizLibrary.ts, jeu du paquet Unreal ;
// clé du moteur d'architecture → av-*, LEGACY_TO_ARCHVIZ l. 557-579). Le rendu Unreal
// ajoute textures et lumière : ces aplats sont une approximation de teinte, pas un rendu.
export const MATIERE_FACADE: Record<Facade, { materiau: string; couleur: string }> = {
  enduit_clair: { materiau: 'enduit-beige → av-enduit-creme', couleur: '#e2d9c6' },
  enduit_blanc: { materiau: 'enduit-blanc → av-enduit-blanc', couleur: '#e9e7e1' },
  brique: { materiau: 'brique-rouge → av-brique-rouge', couleur: '#8e4b38' },
  pierre: { materiau: 'pierre-claire-contemp → av-pierre-calcaire', couleur: '#cbc2ae' },
  beton: { materiau: 'beton-brut → av-beton-brut', couleur: '#a4a29d' },
  bardage_bois: { materiau: 'bardage-bois → av-bardage-bois-brun', couleur: '#8b6236' },
  verre: { materiau: 'verre-teinte → av-verre-teinte', couleur: '#c3d2d3' },
};
/** Lot brief-unifié : teintes (matériau distinct du Studio, couleur déclarée dans archvizLibrary.ts). */
export const MATIERE_TEINTE: Partial<Record<Facade, Partial<Record<Teinte, { materiau: string; couleur: string }>>>> = {
  brique: { claire: { materiau: 'brique-claire → av-brique-claire', couleur: '#c3a98c' } },
  beton: { claire: { materiau: 'beton-blanc → av-beton-clair', couleur: '#cfcdc8' } },
  bardage_bois: { foncee: { materiau: 'bois-brule → av-bardage-bois-noirci', couleur: '#2e2a26' } },
};
/** Teintes réellement distinctes par matière — identique à TEINTES_PAR_FACADE de studio.ts (vérifié par le test). */
export const TEINTES_PAR_FACADE: Record<Facade, readonly Teinte[]> = {
  enduit_clair: ['naturelle'], enduit_blanc: ['naturelle'], brique: ['naturelle', 'claire'], pierre: ['naturelle'],
  beton: ['naturelle', 'claire'], bardage_bois: ['naturelle', 'foncee'], verre: ['naturelle'],
};
/** Couleur de la façade (matière + teinte). */
export const couleurFacade = (c: Pick<ChoixBrief, 'facade' | 'teinte'>): string => MATIERE_TEINTE[c.facade]?.[c.teinte]?.couleur ?? MATIERE_FACADE[c.facade].couleur;
/** Couverture : av-toiture-vegetalisee, av-tuiles-terre-cuite, av-ardoise, av-zinc-anthracite (archvizLibrary.ts). */
export const COULEUR_TOITURE: Record<Toiture, string> = {
  terrasse: '#bdb8ae', vegetalisee: '#5f7440', deux_pans_tuiles: '#9c4c2e', deux_pans_ardoise: '#414750', deux_pans_zinc: '#4a4e53',
};
/** Menuiseries : av-aluminium-gris (défaut du Studio), -noir (RAL 7016), -blanc, -bronze. */
export const COULEUR_MENUISERIES: Record<Menuiseries, string> = { gris: '#84888c', anthracite: '#383e42', blanc: '#e8e8e6', bronze: '#7d6748' };
/** Soubassement : pierre-claire-contemp (av-pierre-calcaire), beton-brut, brique-rouge. */
export const COULEUR_SOUBASSEMENT: Record<Exclude<Soubassement, 'aucun'>, string> = { pierre: '#cbc2ae', beton: '#a4a29d', brique: '#8e4b38' };
/** Toit à deux pans du Studio : pente 35°, débord 0,40 m (h = 5,88 m pour 16 m de profondeur, mesuré le 06/11). */
export const TOIT_PENTE = { penteDeg: 35, debord: 0.4 } as const;
export const toitEnPente = (t: Toiture): boolean => t.startsWith('deux_pans_');
/** Hauteur du bandeau de soubassement posé par le worker (SOUBASSEMENT_HAUTEUR_M). */
export const HAUTEUR_SOUBASSEMENT = 0.6;

export const STYLES: readonly OptionBrief<Style>[] = [
  { valeur: 'contemporain', libelle: 'Contemporain', detail: 'Le dessin du Studio, personnalisé par vos choix.', disponible: true,
    descriptif: 'Volumes nets, toit plat, fenêtres régulières. C’est le dessin du Studio, que vous personnalisez : façade, fenêtres, balcons, attique.' },
  { valeur: 'haussmannien', libelle: 'Haussmannien', detail: 'Bientôt disponible.', disponible: false,
    descriptif: 'Pierre de taille, balcons filants, toit en zinc à la Mansart (Paris, 1853-1927). Prévu dans le Studio, pas encore rendu.' },
  { valeur: 'art_deco', libelle: 'Art déco', detail: 'Bientôt disponible.', disponible: false,
    descriptif: 'Verticalité marquée, bandeaux superposés, couronnement en gradins (1920-1939). Prévu dans le Studio, pas encore rendu.' },
];
export const FACADES: readonly OptionBrief<Facade>[] = [
  { valeur: 'enduit_clair', libelle: 'Enduit clair', detail: 'Enduit beige, chaleureux et sobre.', disponible: true },
  { valeur: 'enduit_blanc', libelle: 'Enduit blanc', detail: 'Blanc lumineux, très contemporain.', disponible: true },
  { valeur: 'brique', libelle: 'Brique', detail: 'Brique rouge appareillée.', disponible: true },
  { valeur: 'pierre', libelle: 'Pierre claire', detail: 'Pierre calcaire en plaques.', disponible: true },
  { valeur: 'beton', libelle: 'Béton', detail: 'Béton brut, gris minéral.', disponible: true },
  { valeur: 'bardage_bois', libelle: 'Bardage bois', detail: 'Lames de bois brun.', disponible: true },
  { valeur: 'verre', libelle: 'Verre', detail: 'Façade entièrement vitrée.', disponible: true },
];
export const OUVERTURES: readonly OptionBrief<Ouvertures>[] = [
  { valeur: 'fenetres_verticales', libelle: 'Fenêtres verticales', detail: 'Fenêtres hautes et étroites.', disponible: true },
  { valeur: 'baies_vitrees', libelle: 'Baies vitrées', detail: 'Grandes baies du sol au plafond.', disponible: true },
  { valeur: 'fenetres_horizontales', libelle: 'Fenêtres en bandeau', detail: 'Fenêtres larges et basses.', disponible: true },
];
export const BALCONS: readonly OptionBrief<Balcons>[] = [
  { valeur: 'balcons', libelle: 'Balcons', detail: 'Un balcon par fenêtre, sauf aux angles.', disponible: true },
  { valeur: 'balcons_filants', libelle: 'Balcons filants', detail: 'Un balcon continu sur toute la façade.', disponible: true },
  { valeur: 'loggias', libelle: 'Loggias', detail: 'Terrasses creusées dans la façade.', disponible: true },
  { valeur: 'aucun', libelle: 'Aucun', detail: 'Façade lisse, sans balcon.', disponible: true },
];
export const ATTIQUES: readonly OptionBrief<boolean>[] = [
  { valeur: false, libelle: 'Toit plat', detail: 'Le volume tel qu’il a été calculé.', disponible: true },
  { valeur: true, libelle: 'Avec attique', detail: 'Un étage en retrait ajouté au-dessus (à vérifier au PLU).', disponible: true },
];
export const RDCS: readonly OptionBrief<Rdc>[] = [
  { valeur: 'logements', libelle: 'Logements', detail: 'Le rez-de-chaussée comme les étages.', disponible: true },
  { valeur: 'commerces', libelle: 'Commerces', detail: 'Vitrines au rez-de-chaussée.', disponible: true },
  { valeur: 'hall', libelle: 'Hall d’entrée', detail: 'Bientôt disponible.', disponible: false },
];
export const AMBIANCES: readonly OptionBrief<Ambiance>[] = [
  { valeur: 'jour', libelle: 'Journée', detail: 'Lumière franche de la mi-journée.', disponible: true },
  { valeur: 'fin_de_journee', libelle: 'Fin de journée', detail: 'Soleil bas et lumière dorée.', disponible: true },
  { valeur: 'nuit', libelle: 'Nuit', detail: 'Fenêtres éclairées (film et visite).', disponible: true },
];
// ── Lot brief-unifié : détails (ordre et valeurs = studio.ts) ─────────────────
export const TOITURES: readonly OptionBrief<Toiture>[] = [
  { valeur: 'terrasse', libelle: 'Toit-terrasse', detail: 'Toit plat avec acrotère (dessin du Studio).', disponible: true },
  { valeur: 'vegetalisee', libelle: 'Végétalisée', detail: 'Terrasse plantée (sedum).', disponible: true },
  { valeur: 'deux_pans_tuiles', libelle: 'Deux pans, tuiles', detail: 'Pente 35°, tuiles terre cuite (plus haut : PLU).', disponible: true },
  { valeur: 'deux_pans_ardoise', libelle: 'Deux pans, ardoise', detail: 'Pente 35°, ardoise (plus haut : PLU).', disponible: true },
  { valeur: 'deux_pans_zinc', libelle: 'Deux pans, zinc', detail: 'Pente 35°, zinc anthracite (plus haut : PLU).', disponible: true },
];
export const TEINTES: readonly OptionBrief<Teinte>[] = [
  { valeur: 'naturelle', libelle: 'Naturelle', detail: 'La teinte de la matière choisie.', disponible: true },
  { valeur: 'claire', libelle: 'Claire', detail: 'Brique claire ou béton blanc.', disponible: true },
  { valeur: 'foncee', libelle: 'Foncée', detail: 'Bois noirci.', disponible: true },
];
export const GARDE_CORPS: readonly OptionBrief<GardeCorps>[] = [
  { valeur: 'metal', libelle: 'Métal', detail: 'Barreaudage acier.', disponible: true },
  { valeur: 'verre', libelle: 'Verre', detail: 'Vitrage clair.', disponible: true },
  { valeur: 'plein', libelle: 'Plein', detail: 'Allège pleine.', disponible: true },
];
export const MENUISERIES: readonly OptionBrief<Menuiseries>[] = [
  { valeur: 'gris', libelle: 'Alu gris', detail: 'Aluminium gris métal.', disponible: true },
  { valeur: 'anthracite', libelle: 'Anthracite', detail: 'Alu gris anthracite (RAL 7016).', disponible: true },
  { valeur: 'blanc', libelle: 'Blanc', detail: 'Alu laqué blanc.', disponible: true },
  { valeur: 'bronze', libelle: 'Bronze', detail: 'Alu laqué bronze.', disponible: true },
];
export const SOUBASSEMENTS: readonly OptionBrief<Soubassement>[] = [
  { valeur: 'aucun', libelle: 'Aucun', detail: 'La façade descend jusqu’au sol.', disponible: true },
  { valeur: 'pierre', libelle: 'Pierre', detail: 'Bandeau de 60 cm en pierre claire.', disponible: true },
  { valeur: 'beton', libelle: 'Béton', detail: 'Bandeau de 60 cm en béton brut.', disponible: true },
  { valeur: 'brique', libelle: 'Brique', detail: 'Bandeau de 60 cm en brique rouge.', disponible: true },
];
/** Nom d'une teinte pour la matière choisie (« Brique rouge » / « Brique claire »…). */
export function libelleTeinte(facade: Facade, t: Teinte): string {
  const noms: Partial<Record<Facade, Partial<Record<Teinte, string>>>> = {
    brique: { naturelle: 'Brique rouge', claire: 'Brique claire' },
    beton: { naturelle: 'Béton brut', claire: 'Béton blanc' },
    bardage_bois: { naturelle: 'Bois brun', foncee: 'Bois noirci' },
  };
  return noms[facade]?.[t] ?? TEINTES.find((o) => o.valeur === t)!.libelle;
}
/**
 * Montrés « bientôt », jamais sélectionnables ni envoyés (le serveur ne les accepte pas) :
 *   - volets / brise-soleil : champ du moteur d'architecture (`shading`) que le Studio ne dessine pas (sceneBuilder.ts) ;
 *   - entrée porche / renfoncée / auvent : composition d'entrée refusée par la scène (porte de largeur NaN, essai du 06/11).
 */
export const BIENTOT: readonly { titre: string; options: readonly string[]; raison: string }[] = [
  { titre: 'Volets ou brise-soleil', options: ['Volets', 'Brise-soleil'], raison: 'Le Studio ne les dessine pas encore.' },
  { titre: 'Entrée de l’immeuble', options: ['Porche', 'Renfoncée', 'Auvent'], raison: 'Pas encore rendue par le Studio.' },
];

/** Valeurs par défaut — identiques à BRIEF_DEFAUT de studio.ts (vérifié par le test). */
export const CHOIX_DEFAUT: ChoixBrief = {
  facade: 'enduit_clair', ouvertures: 'fenetres_verticales', balcons: 'balcons', attique: false, rdc: 'logements', ambiance: 'jour',
  toiture: 'terrasse', teinte: 'naturelle', garde_corps: 'metal', menuiseries: 'gris', soubassement: 'aucun',
};

/** Les écrans de la carte : trois écrans principaux, puis « Détails » (facultatif : on peut valider avant). */
export const ECRANS: readonly { id: string; titre: string; champs: readonly ChampCarte[]; facultatif?: boolean }[] = [
  { id: 'facade', titre: 'Façade et matière', champs: ['facade'] },
  { id: 'ouvertures', titre: 'Fenêtres et balcons', champs: ['ouvertures', 'balcons'] },
  { id: 'finitions', titre: 'Toit, rez-de-chaussée et lumière', champs: ['attique', 'rdc', 'ambiance'] },
  { id: 'details', titre: 'Détails', champs: [...CHAMPS_DETAILS], facultatif: true },
];

export const QUESTIONS: Record<ChampCarte, string> = {
  facade: 'Quelle matière pour la façade ?',
  ouvertures: 'Quelles fenêtres ?',
  balcons: 'Balcons ou loggias ?',
  attique: 'Un étage en retrait sur le toit ?',
  rdc: 'Que met-on au rez-de-chaussée ?',
  ambiance: 'Quelle lumière pour le rendu ?',
  toiture: 'Quelle toiture ?',
  teinte: 'Quelle teinte pour la façade ?',
  garde_corps: 'Quels garde-corps ?',
  menuiseries: 'Quelle couleur de menuiseries ?',
  soubassement: 'Un soubassement au pied des façades ?',
};

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const TYPES: readonly TypeRenduBrief[] = ['film', 'visite360', 'image'];

export function optionsDe(champ: ChampCarte): readonly OptionBrief<string | boolean>[] {
  switch (champ) {
    case 'facade': return FACADES;
    case 'ouvertures': return OUVERTURES;
    case 'balcons': return BALCONS;
    case 'attique': return ATTIQUES;
    case 'rdc': return RDCS;
    case 'ambiance': return AMBIANCES;
    case 'toiture': return TOITURES;
    case 'teinte': return TEINTES;
    case 'garde_corps': return GARDE_CORPS;
    case 'menuiseries': return MENUISERIES;
    case 'soubassement': return SOUBASSEMENTS;
  }
}

// ── Demande lue dans la sortie d'outil ───────────────────────────────────────
export interface CorpsApercu {
  cx: number; cy: number; l: number; p: number; a: number; n: number;
  /**
   * Lot formes-batiment : côtés INTÉRIEURS d'une aile (accolés à une autre aile du même bâtiment) :
   * 0 = +v, 1 = −v, 2 = +u, 3 = −u. Ni fenêtres ni retrait d'attique de ces côtés. Absent : 4 façades.
   */
  int?: number[];
}
export interface ApercuVolume { corps: CorpsApercu[]; contour: [number, number][] | null }
export interface LimitesBrief {
  batiments: number; balcons: boolean;
  /**
   * Lot brief-formes : un bâtiment à ailes (en L, en U, cour fermée, redans) → pas de toit à deux pans (le Studio
   * couvrirait chaque aile d'un toit séparé, sans noue). Absent (serveur d'avant le lot) : déduit de l'aperçu.
   */
  ailes?: boolean;
}

/** Lot brief-formes : l'aperçu montre-t-il un bâtiment à ailes (côtés accolés) ? PUR. */
export const apercuAAiles = (a: ApercuVolume | null | undefined): boolean => !!a?.corps.some((c) => (c.int?.length ?? 0) > 0);
/**
 * Lot brief-formes : raison affichée sous l'option (courte : elle remplace la description de la vignette). Le serveur dit
 * la raison complète (studio.ts, RAISON_PENTE_AILES) : chaque aile couverte d'un toit séparé, sans noue.
 */
export const RAISON_PENTE_AILES = 'Pas encore pour un bâtiment à ailes (L, U, cour, redans).';
const avecAiles = (l: LimitesBrief, a: ApercuVolume | null | undefined): LimitesBrief => ({ ...l, ailes: l.ailes === true || apercuAAiles(a) });
/**
 * Lot brief-formes — limites du dossier (fiche « Espace 3D ») : nombre de bâtiments du moteur et bâtiment à ailes
 * (au moins deux ailes évaluées : en L, en U, cour fermée, redans — les redans n'ont pas de côté entièrement accolé,
 * d'où ce repère explicite plutôt que l'aperçu). PUR.
 */
export function limitesDossier(corps: readonly { ailesEvaluees?: readonly unknown[] | null }[] | null | undefined): LimitesBrief {
  return { batiments: Math.max(1, corps?.length ?? 1), balcons: true, ailes: !!corps?.some((c) => (c.ailesEvaluees?.length ?? 0) >= 2) };
}

export interface DemandeBrief {
  /**
   * 'demande' : brief exigé avant le devis (ou rouvert par Mimmo) ; 'devis' : « Modifier l'habillage » sous un devis ;
   * 'fiche' (lot fiche-3d) : habillage choisi dans la fiche « Espace 3D », sans rendu (type null).
   */
  origine: 'demande' | 'devis' | 'fiche';
  /** null : brief du projet choisi dans la fiche, sans rendu demandé (bloc sans type). */
  type: TypeRenduBrief | null;
  /** Ambiances proposées par le serveur pour ce type (l'image n'a pas de nuit). */
  ambiances: Ambiance[];
  /** Brief connu (modification) ; null si aucun. */
  actuel: (ChoixBrief & { defauts: string[] }) | null;
  apercu: ApercuVolume | null;
  limites: LimitesBrief;
}

const dans = <T extends string>(liste: readonly OptionBrief<T>[], v: unknown): v is T => liste.some((o) => o.valeur === v);

function lireApercu(v: unknown): ApercuVolume | null {
  if (!estObj(v) || !Array.isArray(v.corps)) return null;
  const corps = v.corps.filter((c): c is CorpsApercu => estObj(c) && [c.cx, c.cy, c.l, c.p, c.a, c.n].every(fini) && (c.l as number) > 0 && (c.p as number) > 0 && (c.n as number) >= 1)
    .slice(0, 12).map((c) => {
      // Lot brief-formes : côtés accolés d'une aile (lot formes-batiment) conservés — sinon l'aperçu du chat dessinerait des fenêtres entre deux ailes.
      const int = Array.isArray(c.int) ? [...new Set((c.int as unknown[]).filter((i): i is number => i === 0 || i === 1 || i === 2 || i === 3))] : [];
      return { cx: c.cx, cy: c.cy, l: c.l, p: c.p, a: c.a, n: Math.min(60, Math.round(c.n)), ...(int.length ? { int } : {}) };
    });
  if (!corps.length) return null;
  const contour = Array.isArray(v.contour)
    ? v.contour.filter((q): q is [number, number] => Array.isArray(q) && q.length === 2 && fini(q[0]) && fini(q[1])).slice(0, 64)
    : [];
  return { corps, contour: contour.length >= 3 ? contour : null };
}

function lireActuel(v: unknown): DemandeBrief['actuel'] {
  if (!estObj(v)) return null;
  if (!dans(FACADES, v.facade) || !dans(OUVERTURES, v.ouvertures) || !dans(BALCONS, v.balcons) || typeof v.attique !== 'boolean'
    || !dans(RDCS, v.rdc) || !dans(AMBIANCES, v.ambiance)) return null;
  // Lot brief-unifié : détails absents (sortie d'avant le lot) → valeurs proposées, comptées « par défaut ».
  const defauts = Array.isArray(v.defauts) ? v.defauts.filter((d): d is string => typeof d === 'string') : [];
  const detail = <T extends string>(champ: typeof CHAMPS_DETAILS[number], liste: readonly OptionBrief<T>[]): T => {
    const x = v[champ];
    if (dans(liste, x)) return x;
    if (!defauts.includes(champ)) defauts.push(champ);
    return CHOIX_DEFAUT[champ] as T;
  };
  const teinte = detail('teinte', TEINTES);
  return {
    facade: v.facade, ouvertures: v.ouvertures, balcons: v.balcons, attique: v.attique, rdc: v.rdc, ambiance: v.ambiance,
    toiture: detail('toiture', TOITURES), teinte: TEINTES_PAR_FACADE[v.facade].includes(teinte) ? teinte : 'naturelle',
    garde_corps: detail('garde_corps', GARDE_CORPS), menuiseries: detail('menuiseries', MENUISERIES), soubassement: detail('soubassement', SOUBASSEMENTS),
    defauts,
  };
}

/**
 * Sortie de `studio_lancer_rendu` → demande de brief pour la carte, ou null.
 *   - `partial` + `brief_requis` (garde du serveur ou `ouvrir_brief`) → carte ouverte ;
 *   - devis (`confirmation_requise`) portant `brief_actuel` → bouton « Modifier l'habillage ».
 * Tolère l'ancienne sortie (sans `apercu` ni `limites`) : carte avec vignettes seulement.
 */
export function lireDemandeBrief(call: { name: string; status?: string; output?: unknown }): DemandeBrief | null {
  if (call.name !== OUTIL_LANCER_RENDU || call.status === 'running' || !estObj(call.output)) return null;
  const out = call.output;
  const d = estObj(out.data) ? out.data : null;
  if (!d || !TYPES.includes(d.type as TypeRenduBrief)) return null;
  const type = d.type as TypeRenduBrief;
  const limitesBrutes = estObj(d.limites) ? d.limites : {};
  const limites: LimitesBrief = {
    batiments: fini(limitesBrutes.batiments) && limitesBrutes.batiments >= 1 ? Math.round(limitesBrutes.batiments) : 1,
    balcons: limitesBrutes.balcons !== false,
    ailes: limitesBrutes.ailes === true || apercuAAiles(lireApercu(d.apercu)),
  };
  if (out.status === 'partial' && d.brief_requis === true) {
    const champs = estObj(d.champs) ? d.champs : {};
    const amb = estObj(champs.ambiance) && Array.isArray(champs.ambiance.valeurs) ? champs.ambiance.valeurs : null;
    const ambiances = (amb ?? (type === 'image' ? ['jour', 'fin_de_journee'] : ['jour', 'fin_de_journee', 'nuit']))
      .filter((a): a is Ambiance => dans(AMBIANCES, a) && !(type === 'image' && a === 'nuit'));
    return { origine: 'demande', type, ambiances: ambiances.length ? ambiances : ['jour'], actuel: lireActuel(d.actuel), apercu: lireApercu(d.apercu), limites };
  }
  if (out.status === 'confirmation_requise' && estObj(d.brief_actuel)) {
    const actuel = lireActuel(d.brief_actuel);
    if (!actuel) return null;
    return { origine: 'devis', type, ambiances: type === 'image' ? ['jour', 'fin_de_journee'] : ['jour', 'fin_de_journee', 'nuit'], actuel, apercu: lireApercu(d.apercu), limites };
  }
  return null;
}

// ── État de la carte ──────────────────────────────────────────────────────────
export interface EtatBrief {
  choix: ChoixBrief;
  /** Champs choisis par l'utilisateur (les autres restent « proposés par Mimmo »). */
  touches: ChampCarte[];
}

/** État initial : brief connu (sans les valeurs que le Studio n'applique pas) ou valeurs proposées. */
export function etatInitial(d: Pick<DemandeBrief, 'actuel' | 'ambiances'> & { limites?: LimitesBrief }): EtatBrief {
  const a = d.actuel;
  const choix: ChoixBrief = a
    ? { facade: a.facade, ouvertures: a.ouvertures, balcons: a.balcons, attique: a.attique, rdc: a.rdc, ambiance: a.ambiance,
      toiture: a.toiture, teinte: a.teinte, garde_corps: a.garde_corps, menuiseries: a.menuiseries, soubassement: a.soubassement }
    : { ...CHOIX_DEFAUT };
  let touches: ChampCarte[] = a ? CHAMPS_CARTE.filter((c) => !a.defauts.includes(c)) : [];
  // « hall » (non dessiné) → logements, proposé à nouveau ; ambiance hors liste (nuit pour une image) → journée.
  if (choix.rdc === 'hall') { choix.rdc = 'logements'; touches = touches.filter((c) => c !== 'rdc'); }
  if (!d.ambiances.includes(choix.ambiance)) { choix.ambiance = d.ambiances[0] ?? 'jour'; touches = touches.filter((c) => c !== 'ambiance'); }
  // Lot brief-formes : toit à deux pans connu mais bâtiment à ailes → toit-terrasse proposé à nouveau.
  if (d.limites?.ailes && toitEnPente(choix.toiture)) { choix.toiture = 'terrasse'; touches = touches.filter((c) => c !== 'toiture'); }
  return { choix, touches };
}

/** Raison pour laquelle une option n'est pas cliquable dans ce contexte ; null = cliquable. */
export function raisonIndisponible(champ: ChampCarte, valeur: string | boolean, choix: ChoixBrief, d: Pick<DemandeBrief, 'ambiances' | 'limites'>): string | null {
  const opt = optionsDe(champ).find((o) => o.valeur === valeur);
  if (!opt) return 'Valeur inconnue.';
  if (!opt.disponible) return 'Bientôt disponible.';
  if (champ === 'ambiance' && !d.ambiances.includes(valeur as Ambiance)) return 'L’image se rend de jour ou en fin de journée.';
  if (champ === 'ouvertures' && choix.facade === 'verre') return 'Avec une façade en verre, les baies couvrent déjà toute la façade.';
  if (champ === 'balcons' && !d.limites.balcons) return 'Pour cet ensemble, le Studio ne sait pas encore poser les balcons.';
  // Lot brief-unifié : combinaisons que le Studio ne rend pas (le serveur les refuse aussi).
  if (champ === 'teinte' && !TEINTES_PAR_FACADE[choix.facade].includes(valeur as Teinte)) return 'Une seule teinte pour cette matière.';
  if (champ === 'attique' && valeur === true && toitEnPente(choix.toiture)) return 'Avec un toit à deux pans, pas d’attique.';
  if (champ === 'toiture' && toitEnPente(valeur as Toiture) && d.limites.ailes) return RAISON_PENTE_AILES;
  if (champ === 'soubassement' && valeur !== 'aucun' && choix.rdc === 'commerces') return 'Avec des vitrines au rez-de-chaussée, pas de soubassement.';
  if (champ === 'garde_corps' && (choix.balcons === 'aucun' || !d.limites.balcons)) return 'Sans balcon, pas de garde-corps à choisir.';
  return null;
}

/**
 * Un clic : choisit la valeur si elle est cliquable (sinon état inchangé). Les choix devenus incompatibles sont
 * remis à leur valeur proposée (teinte d'une autre matière, attique sous un toit à deux pans, soubassement
 * sous des vitrines) : jamais une combinaison que le Studio ne rendrait pas.
 */
export function choisir(etat: EtatBrief, champ: ChampCarte, valeur: string | boolean, d: Pick<DemandeBrief, 'ambiances' | 'limites'>): EtatBrief {
  if (raisonIndisponible(champ, valeur, etat.choix, d)) return etat;
  const choix = { ...etat.choix, [champ]: valeur } as ChoixBrief;
  let touches = etat.touches.includes(champ) ? etat.touches : [...etat.touches, champ];
  const remettre = (c: ChampCarte) => { (choix as unknown as Record<string, unknown>)[c] = CHOIX_DEFAUT[c]; touches = touches.filter((t) => t !== c); };
  if (!TEINTES_PAR_FACADE[choix.facade].includes(choix.teinte)) remettre('teinte');
  if (champ === 'toiture' && toitEnPente(choix.toiture) && choix.attique) { choix.attique = false; if (!touches.includes('attique')) touches = [...touches, 'attique']; }
  if (champ === 'rdc' && choix.rdc === 'commerces' && choix.soubassement !== 'aucun') remettre('soubassement');
  return { choix, touches };
}

const LIB_COURT: { [K in ChampCarte]: (c: ChoixBrief) => string | null } = {
  facade: (c) => c.teinte !== 'naturelle' ? libelleTeinte(c.facade, c.teinte)
    : ({ enduit_clair: 'Enduit clair', enduit_blanc: 'Enduit blanc', brique: 'Brique', pierre: 'Pierre claire', beton: 'Béton', bardage_bois: 'Bardage bois', verre: 'Façade en verre' })[c.facade],
  ouvertures: (c) => (c.facade === 'verre' ? null : ({ fenetres_verticales: 'fenêtres verticales', baies_vitrees: 'baies vitrées', fenetres_horizontales: 'fenêtres en bandeau' })[c.ouvertures]),
  balcons: (c) => ({ balcons: 'balcons', balcons_filants: 'balcons filants', loggias: 'loggias', aucun: 'sans balcon' })[c.balcons],
  // Toit : attique et toiture réunis (« toit plat », « avec attique », « toiture végétalisée avec attique », « toit à deux pans en tuiles »).
  attique: (c) => {
    if (toitEnPente(c.toiture)) return ({ deux_pans_tuiles: 'toit à deux pans en tuiles', deux_pans_ardoise: 'toit à deux pans en ardoise', deux_pans_zinc: 'toit à deux pans en zinc' } as Record<string, string>)[c.toiture];
    if (c.toiture === 'vegetalisee') return c.attique ? 'toiture végétalisée avec attique' : 'toiture végétalisée';
    return c.attique ? 'avec attique' : 'toit plat';
  },
  rdc: (c) => (c.rdc === 'commerces' ? 'commerces en rez-de-chaussée' : 'logements en rez-de-chaussée'),
  ambiance: (c) => ({ jour: 'journée', fin_de_journee: 'fin de journée', nuit: 'nuit' })[c.ambiance],
  // Détails : écrits seulement s'ils changent le dessin par défaut du Studio (même règle que libelleBrief côté serveur).
  toiture: () => null,
  teinte: () => null,
  garde_corps: (c) => (c.balcons === 'aucun' || c.garde_corps === 'metal' ? null : c.garde_corps === 'verre' ? 'garde-corps en verre' : 'garde-corps pleins'),
  menuiseries: (c) => (c.menuiseries === 'gris' ? null : `menuiseries ${({ anthracite: 'anthracite', blanc: 'blanches', bronze: 'bronze' } as Record<string, string>)[c.menuiseries]}`),
  soubassement: (c) => (c.soubassement === 'aucun' ? null : `soubassement en ${({ pierre: 'pierre', beton: 'béton', brique: 'brique' } as Record<string, string>)[c.soubassement]}`),
};

/** Récapitulatif d'une ligne (« Brique · fenêtres verticales · loggias · avec attique · commerces en rez-de-chaussée · journée »). */
export function recapitulatif(c: ChoixBrief, d?: Pick<DemandeBrief, 'limites'>): string {
  return CHAMPS_CARTE
    .map((champ) => ((champ === 'balcons' || champ === 'garde_corps') && d && !d.limites.balcons ? null : LIB_COURT[champ](c)))
    .filter((t): t is string => !!t).join(' · ');
}

/**
 * Brief envoyé au serveur (format accepté par validerBrief) : les champs choisis par l'utilisateur ;
 * s'il en reste de non choisis (ou « Laisser Mimmo choisir »), `a_toi_de_choisir: true` — le devis
 * les dira alors « par défaut », honnêtement. Jamais de style ni de précisions.
 */
export function briefAEnvoyer(etat: EtatBrief, mimmoChoisit = false): Obj {
  const champs = etat.touches;
  const b: Obj = {};
  for (const c of CHAMPS_CARTE) if (champs.includes(c)) b[c] = etat.choix[c];
  if (mimmoChoisit || CHAMPS_CARTE.some((c) => !champs.includes(c))) b.a_toi_de_choisir = true;
  return b;
}

/** Choix qui seront réellement appliqués (champs non choisis = valeurs proposées). */
export function choixAppliques(etat: EtatBrief, mimmoChoisit = false): ChoixBrief {
  if (!mimmoChoisit) return etat.choix;
  const c = { ...CHOIX_DEFAUT };
  for (const champ of etat.touches) (c as Record<string, unknown>)[champ] = etat.choix[champ];
  return c;
}

const LIB_TYPE: Record<TypeRenduBrief, string> = { film: 'le film', visite360: 'la visite 360°', image: 'l’image' };

/**
 * Message envoyé au chat : une ligne lisible, puis le bloc relu par le serveur. Sans type (fiche « Espace 3D ») :
 * bloc sans `type` — le serveur l'enregistre comme habillage du projet, sans lancer de devis.
 */
export function messageBrief(etat: EtatBrief, d: Pick<DemandeBrief, 'type' | 'limites'>, mimmoChoisit = false): string {
  const bloc = d.type ? { v: BRIEF_BLOC_VERSION, type: d.type, brief: briefAEnvoyer(etat, mimmoChoisit) } : { v: BRIEF_BLOC_VERSION, brief: briefAEnvoyer(etat, mimmoChoisit) };
  const recap = recapitulatif(choixAppliques(etat, mimmoChoisit), d);
  const mimmo = mimmoChoisit && etat.touches.length < CHAMPS_CARTE.length;
  const tete = !d.type
    ? (mimmo ? `Habillage du projet choisi dans la fiche : je laisse Mimmo choisir${etat.touches.length ? ' le reste' : ''} — ${recap}.` : `Habillage du projet choisi dans la fiche : ${recap}.`)
    : mimmo
      ? `Brief créatif pour ${LIB_TYPE[d.type]} (rendu) : je laisse Mimmo choisir${etat.touches.length ? ' le reste' : ''} — ${recap}.`
      : `Brief créatif validé pour ${LIB_TYPE[d.type]} (rendu) : ${recap}.`;
  return `${tete}\n\n\`\`\`${BRIEF_BLOC_LANGUE}\n${JSON.stringify(bloc)}\n\`\`\``;
}

const RE_BLOC = new RegExp('```' + BRIEF_BLOC_LANGUE + '[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n?```');

/** Message utilisateur → texte à afficher (sans le bloc) et présence d'un brief. */
export function lireBlocBrief(texte: string): { visible: string; brief: boolean } {
  const m = RE_BLOC.exec(texte);
  if (!m) return { visible: texte, brief: false };
  return { visible: texte.replace(m[0], '').replace(/\n{3,}/g, '\n\n').trim(), brief: true };
}

/** Un brief a-t-il été envoyé APRÈS ce message ? Renvoie sa ligne lisible (pour l'état « envoyé » de la carte). */
export function briefEnvoyeApres(messages: readonly { id: string; role: string; text: string }[], messageId: string): string | null {
  const i = messages.findIndex((m) => m.id === messageId);
  if (i < 0) return null;
  for (let k = messages.length - 1; k > i; k--) {
    const m = messages[k];
    if (m.role !== 'user') continue;
    const l = lireBlocBrief(m.text);
    if (l.brief) return l.visible.replace(/^(?:Brief créatif|Habillage du projet)[^:]*:\s*/, '').replace(/\.$/, '');
  }
  return null;
}

/**
 * La demande de brief de ce message est-elle dépassée ? (un brief envoyé, ou un devis / lancement
 * de rendu plus loin dans le fil) — la carte s'affiche alors repliée, sans reposer la question.
 */
export function demandeDepassee(messages: readonly { id: string; role: string; text: string; toolCalls?: readonly { name: string; output?: unknown }[] }[], messageId: string): boolean {
  const i = messages.findIndex((m) => m.id === messageId);
  if (i < 0) return false;
  return messages.slice(i + 1).some((m) => (m.role === 'user' && lireBlocBrief(m.text).brief)
    || (m.toolCalls ?? []).some((t) => t.name === OUTIL_LANCER_RENDU && estObj(t.output) && (t.output.status === 'confirmation_requise' || t.output.status === 'ok')));
}

// ── Lot fiche-3d : le MÊME brief dans la fiche « Espace 3D » ───────────────────
export interface BriefCourant extends ChoixBrief {
  /** Champs non choisis par l'utilisateur (valeurs proposées par Mimmo). */
  defauts: string[];
  /** D'où vient le brief : bloc d'un message (carte ou fiche) ou devis de rendu. */
  origine: 'message' | 'devis';
}

/** Bloc ```mimmoza-brief``` d'un message → choix (valeurs absentes = proposées) ; null si absent ou refusé par les listes. */
export function briefDuBloc(texte: string): BriefCourant | null {
  const m = RE_BLOC.exec(texte);
  if (!m) return null;
  let brut: unknown;
  try { brut = JSON.parse(m[1]); } catch { return null; }
  if (!estObj(brut) || brut.v !== BRIEF_BLOC_VERSION || !estObj(brut.brief)) return null;
  const b = brut.brief;
  const choix: ChoixBrief = { ...CHOIX_DEFAUT };
  const defauts: string[] = [];
  for (const c of CHAMPS_CARTE) {
    const v = b[c];
    if (v === undefined || v === null) { defauts.push(c); continue; }
    const ok = c === 'attique' ? typeof v === 'boolean' : optionsDe(c).some((o) => o.valeur === v);
    if (!ok) return null;
    (choix as unknown as Record<string, unknown>)[c] = v;
  }
  // Mêmes règles que validerBrief (studio.ts) pour les combinaisons.
  if (!TEINTES_PAR_FACADE[choix.facade].includes(choix.teinte)) { if (!defauts.includes('teinte')) return null; choix.teinte = 'naturelle'; }
  if (choix.attique && toitEnPente(choix.toiture)) { if (!defauts.includes('attique') && !defauts.includes('toiture')) return null; if (defauts.includes('attique')) choix.attique = false; else choix.toiture = 'terrasse'; }
  if (choix.rdc === 'commerces' && choix.soubassement !== 'aucun') { if (!defauts.includes('rdc') && !defauts.includes('soubassement')) return null; if (defauts.includes('rdc')) choix.rdc = 'logements'; else choix.soubassement = 'aucun'; }
  if (b.style !== undefined && b.style !== null && !STYLES.some((s) => s.valeur === b.style)) return null;
  return { ...choix, defauts, origine: 'message' };
}

/**
 * Brief actuel de la conversation, quel que soit l'endroit où il a été choisi (fiche ou carte « Brief créatif »,
 * ou devis de rendu) : le PLUS RÉCENT gagne — même règle que le serveur (studio.ts::briefDuFil). null : aucun.
 */
export function briefCourant(messages: readonly { role: string; text: string; toolCalls?: readonly { name: string; status?: string; output?: unknown }[] }[]): BriefCourant | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') { const b = briefDuBloc(m.text); if (b) return b; continue; }
    const appels = m.toolCalls ?? [];
    for (let j = appels.length - 1; j >= 0; j--) {
      const d = lireDemandeBrief(appels[j]);
      if (d?.actuel) return { ...d.actuel, origine: 'devis' };
    }
  }
  return null;
}

/** Demande de brief ouverte depuis la fiche « Espace 3D » (aucun rendu : type null, toutes les ambiances). */
export function demandeFiche(actuel: BriefCourant | null, apercu: ApercuVolume | null, limites: LimitesBrief): DemandeBrief {
  return {
    origine: 'fiche', type: null, ambiances: ['jour', 'fin_de_journee', 'nuit'],
    actuel: actuel ? {
      facade: actuel.facade, ouvertures: actuel.ouvertures, balcons: actuel.balcons, attique: actuel.attique, rdc: actuel.rdc, ambiance: actuel.ambiance,
      toiture: actuel.toiture, teinte: actuel.teinte, garde_corps: actuel.garde_corps, menuiseries: actuel.menuiseries, soubassement: actuel.soubassement,
      defauts: actuel.defauts,
    } : null,
    apercu, limites: avecAiles(limites, apercu),
  };
}

/**
 * Lot brief-unifié — demande de brief EN SUSPENS dans la conversation (dernière sortie `brief_requis` de
 * studio_lancer_rendu, sans brief envoyé ni devis plus loin) : le panneau Espace 3D s'ouvre de lui-même sur
 * l'habillage et « Valider » envoie un bloc TYPÉ (Mimmo enchaîne sur le devis). null : rien en attente.
 */
export function demandeEnCours(messages: readonly { id: string; role: string; text: string; toolCalls?: readonly { name: string; status?: string; output?: unknown }[] }[]): { demande: DemandeBrief; messageId: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && lireBlocBrief(m.text).brief) return null;
    for (const t of m.toolCalls ?? []) {
      const d = lireDemandeBrief(t);
      if (d?.origine === 'demande') return demandeDepassee(messages, m.id) ? null : { demande: d, messageId: m.id };
      if (t.name === OUTIL_LANCER_RENDU && estObj(t.output) && (t.output.status === 'confirmation_requise' || t.output.status === 'ok')) return null;
    }
  }
  return null;
}

/**
 * Demande à ouvrir dans la section habillage du panneau : celle du chat (rendu en attente ou « Modifier
 * l'habillage » sous un devis), complétée du brief courant et de l'aperçu du dossier quand elle n'en a pas ;
 * sinon l'habillage du projet sans rendu (`demandeFiche`).
 */
export function demandePanneau(enCours: DemandeBrief | null, actuel: BriefCourant | null, apercu: ApercuVolume | null, limites: LimitesBrief): DemandeBrief {
  const fiche = demandeFiche(actuel, apercu, limites);
  if (!enCours) return fiche;
  const ap = enCours.apercu ?? apercu;
  return { ...enCours, actuel: enCours.actuel ?? fiche.actuel, apercu: ap, limites: avecAiles(enCours.apercu ? enCours.limites : limites, ap) };
}

/**
 * Vignette d'un style NON rendu par le Studio (haussmannien, Art déco) : élévation schématique de 3 travées,
 * à partir des données des packs du Studio (src/core/stylepack/packs/planned.ts : trame, niveaux types, toiture,
 * matériaux, description). Illustration, PAS un rendu du Studio ; null pour le contemporain (VignetteTravee).
 */
export interface PolySvg { points: [number, number][]; fill: string; opacite?: number }
export function dessinStyle(style: Style): (DessinTravee & { polys: PolySvg[] }) | null {
  if (style === 'contemporain') return null;
  const ciel = '#dce8f3', sol = '#e7e3da';
  const vitrage = '#4d5d68';
  const rects: RectSvg[] = [];
  const polys: PolySvg[] = [];
  if (style === 'haussmannien') {
    // Pack french_haussmann_v1 : trame 3,05 m, 6 niveaux types, comble brisé en zinc, pierre calcaire, balcons filants aux 2ᵉ et 5ᵉ étages.
    const trame = 3.05, L = 3 * trame + 0.6, rez = 4.2, etage = 3.0, n = 5, comble = 3.2;
    const hMur = rez + n * etage, H = hMur + comble + 1.6, solY = H - 0.6;
    const y = (z: number, h: number) => solY - z - h;
    rects.push({ x: -2, y: -2, w: L + 4, h: H + 4, fill: ciel });
    rects.push({ x: 0, y: y(0, hMur), w: L, h: hMur, fill: MATIERE_FACADE.pierre.couleur, trait: '#00000022' });
    rects.push({ x: 0, y: y(0, rez), w: L, h: rez, fill: '#bfb59f' });
    // Comble brisé (zinc) et lucarnes.
    polys.push({ points: [[-0.3, y(hMur, 0)], [L + 0.3, y(hMur, 0)], [L - 0.6, y(hMur + comble * 0.75, 0)], [0.6, y(hMur + comble * 0.75, 0)]], fill: '#59626b' });
    polys.push({ points: [[0.6, y(hMur + comble * 0.75, 0)], [L - 0.6, y(hMur + comble * 0.75, 0)], [L - 1.4, y(hMur + comble, 0)], [1.4, y(hMur + comble, 0)]], fill: '#4a525a' });
    for (let t = 0; t < 3; t++) {
      const cx = 0.3 + trame * (t + 0.5);
      rects.push({ x: cx - 0.55, y: y(0.3, rez - 0.9), w: 1.1, h: rez - 0.9, fill: vitrage, trait: '#2f3a40' });
      for (let e = 0; e < n; e++) {
        const z = rez + e * etage;
        rects.push({ x: cx - 0.55, y: y(z + 0.55, 2.1), w: 1.1, h: 2.1, fill: vitrage, trait: '#2f3a40' });
      }
      rects.push({ x: cx - 0.4, y: y(hMur + 0.35, 1.2), w: 0.8, h: 1.2, fill: vitrage, trait: '#2f3a40' });
    }
    for (const e of [1, 4]) { // balcons filants aux 2ᵉ et 5ᵉ étages
      const z = rez + e * etage;
      rects.push({ x: 0.1, y: y(z + 0.55, 0.9), w: L - 0.2, h: 0.12, fill: '#2b2f33' });
      rects.push({ x: 0.1, y: y(z + 0.55, 0.12), w: L - 0.2, h: 0.12, fill: '#2b2f33' });
    }
    rects.push({ x: -0.15, y: y(hMur - 0.25, 0.25), w: L + 0.3, h: 0.25, fill: '#b3a990' }); // corniche
    rects.push({ x: -2, y: solY, w: L + 4, h: 2, fill: sol });
    return { largeur: L, hauteur: H, rects, motif: null, polys };
  }
  // Pack art_deco_v1 : trame 2,8 m, 5 niveaux types, toit plat à acrotère, enduit crème, bandeaux et couronnement en gradins.
  const trame = 2.8, L = 3 * trame + 0.8, rez = 3.6, etage = 2.9, n = 4;
  const hMur = rez + n * etage, H = hMur + 3.2, solY = H - 0.6;
  const y = (z: number, h: number) => solY - z - h;
  const enduit = MATIERE_FACADE.enduit_clair.couleur;
  rects.push({ x: -2, y: -2, w: L + 4, h: H + 4, fill: ciel });
  rects.push({ x: 0, y: y(0, hMur), w: L, h: hMur, fill: enduit, trait: '#00000022' });
  // Couronnement en gradins.
  rects.push({ x: 1.2, y: y(hMur, 0.9), w: L - 2.4, h: 0.9, fill: enduit, trait: '#00000022' });
  rects.push({ x: 2.4, y: y(hMur + 0.9, 0.8), w: L - 4.8, h: 0.8, fill: enduit, trait: '#00000022' });
  rects.push({ x: 0, y: y(0, rez), w: L, h: rez, fill: MATIERE_FACADE.pierre.couleur });
  for (let t = 0; t < 3; t++) {
    const cx = 0.4 + trame * (t + 0.5);
    rects.push({ x: cx - 0.9, y: y(0.3, rez - 0.8), w: 1.8, h: rez - 0.8, fill: vitrage, trait: '#2f3a40' });
    // Travée verticale continue : fenêtres superposées reliées par des allèges sombres.
    rects.push({ x: cx - 0.6, y: y(rez + 0.4, n * etage - 0.8), w: 1.2, h: n * etage - 0.8, fill: '#8d8a80' });
    for (let e = 0; e < n; e++) rects.push({ x: cx - 0.55, y: y(rez + e * etage + 0.6, 1.9), w: 1.1, h: 1.9, fill: vitrage });
  }
  for (const t of [0, 1, 2, 3]) rects.push({ x: 0.4 + trame * t - 0.18, y: y(rez, n * etage + 0.6), w: 0.36, h: n * etage + 0.6, fill: '#ece5d6', trait: '#00000018' }); // pilastres
  for (let e = 1; e <= n; e++) rects.push({ x: -0.1, y: y(rez + e * etage - 0.08, 0.16), w: L + 0.2, h: 0.16, fill: '#d2c8b3' }); // bandeaux
  rects.push({ x: -2, y: solY, w: L + 4, h: 2, fill: sol });
  return { largeur: L, hauteur: H, rects, motif: null, polys };
}

// ── Dimensions du Studio (mimmozia-studio/src/core/architecture) ──────────────
/** defaults.ts DEFAULT_LEVELS / DEFAULT_FACADE ; BalconyGenerator.ts BALCONY_DEFAULTS. */
export const STUDIO = {
  hauteurRdc: 3.3, hauteurEtage: 2.8, hauteurAttique: 2.7, dalle: 0.22, retraitAttique: 2,
  trame: 3.2, margeExtremite: 0.9,
  balcon: { profondeur: 1.4, epaisseur: 0.18, gardeCorps: 1.05, retraitFilant: 0.3 },
  allegeMurRideau: 0.9,
} as const;

/** FacadeGenerator.ts::windowDims (DEFAULT_FACADE : 1,40 × 1,55 m, allège 0,95 m) pour les trois types du brief. */
export function dimsFenetre(o: Ouvertures, trame: number, hauteurNiveau: number): { largeur: number; hauteur: number; allege: number } {
  const maxW = Math.max(0.6, trame - 0.6);
  const maxH = Math.max(0.6, hauteurNiveau - 0.5);
  const clamp = (w: number, h: number, s: number) => ({
    largeur: Math.min(w, maxW),
    hauteur: Math.min(h, maxH - Math.min(s, maxH - 0.4)),
    allege: Math.min(s, Math.max(0, maxH - 0.6)),
  });
  if (o === 'baies_vitrees') return clamp(maxW, hauteurNiveau - 0.55, 0.08);
  if (o === 'fenetres_horizontales') return clamp(1.4 * 1.6, 1, 1.2);
  return clamp(0.8, Math.max(1.8, 1.55 * 1.3), 0.7);
}

/** Niveaux d'un corps : rez + étages (+ attique), cote de plancher et hauteur libre. */
export function niveauxCorps(n: number, attique: boolean): { role: 'rdc' | 'etage' | 'attique'; cote: number; hauteur: number }[] {
  const out: { role: 'rdc' | 'etage' | 'attique'; cote: number; hauteur: number }[] = [{ role: 'rdc', cote: 0, hauteur: STUDIO.hauteurRdc }];
  let z = STUDIO.hauteurRdc;
  for (let i = 1; i < n; i++) { z += STUDIO.dalle; out.push({ role: 'etage', cote: z, hauteur: STUDIO.hauteurEtage }); z += STUDIO.hauteurEtage; }
  if (attique) { z += STUDIO.dalle; out.push({ role: 'attique', cote: z, hauteur: STUDIO.hauteurAttique }); }
  return out;
}

/** Hauteur totale (R+2 = 9,34 m ; + attique = 12,26 m, valeurs mesurées sur le Studio au lot E1-rendu). */
export function hauteurCorps(n: number, attique: boolean): number {
  const nv = niveauxCorps(n, attique);
  const d = nv[nv.length - 1];
  return Math.round((d.cote + d.hauteur) * 100) / 100;
}

/** Travées d'une façade de longueur L : centres (le long de la façade, origine au milieu) et angles. */
export function travees(L: number): { centre: number; largeur: number; angle: boolean }[] {
  const utile = L - 2 * STUDIO.margeExtremite;
  const n = Math.max(1, Math.floor(utile / STUDIO.trame + 1e-9));
  const w = utile > 0 ? utile / n : L;
  return Array.from({ length: n }, (_, i) => ({ centre: -utile / 2 + w * (i + 0.5), largeur: Math.min(w, L), angle: n > 2 && (i === 0 || i === n - 1) }));
}

// ── Palette de l'aperçu ───────────────────────────────────────────────────────
export type Matiere = 'mur' | 'vitrage' | 'vitrageAllume' | 'vitrine' | 'dalle' | 'gardeCorps' | 'fondLoggia' | 'allege' | 'menuiserie' | 'soubassement' | 'toiture';
/** Opacité des garde-corps de l'aperçu selon leur type. */
export const opaciteGardeCorps = (g: GardeCorps): number => (g === 'verre' ? 0.45 : g === 'plein' ? 1 : 0.8);

export interface Lumiere { ciel: string; sol: string; soleil: string; intensiteSoleil: number; ambiante: number; elevationDeg: number; fenetresAllumees: boolean }

/** Ambiance → lumière de l'aperçu (indicative ; la lumière réelle est celle d'Unreal). */
export function lumiere(a: Ambiance): Lumiere {
  if (a === 'fin_de_journee') return { ciel: '#f3d2b0', sol: '#d9cdbd', soleil: '#ffb877', intensiteSoleil: 2.2, ambiante: 0.75, elevationDeg: 14, fenetresAllumees: false };
  if (a === 'nuit') return { ciel: '#1d2740', sol: '#2a2f3a', soleil: '#8aa2d6', intensiteSoleil: 0.5, ambiante: 0.6, elevationDeg: 40, fenetresAllumees: true };
  return { ciel: '#dce8f3', sol: '#e7e3da', soleil: '#fff6e8', intensiteSoleil: 2.6, ambiante: 0.8, elevationDeg: 50, fenetresAllumees: false };
}

export function couleurs(c: ChoixBrief): Record<Matiere, string> {
  const nuit = c.ambiance === 'nuit';
  return {
    mur: couleurFacade(c),
    vitrage: c.facade === 'verre' ? '#7f9aa0' : '#4d5d68',
    vitrageAllume: '#f6c56b',
    vitrine: nuit ? '#f8d48a' : '#6f8792',
    dalle: '#d8d5cf',
    // Lot brief-unifié : garde-corps du brief (le worker l'impose aussi pour un bâtiment seul : plus d'effet « baies vitrées »).
    gardeCorps: c.garde_corps === 'verre' ? '#b9cfd6' : c.garde_corps === 'plein' ? '#d8d5cf' : '#5f656c',
    fondLoggia: '#3d3a36',
    allege: c.facade === 'verre' ? '#8c979b' : couleurFacade(c),
    menuiserie: COULEUR_MENUISERIES[c.menuiseries],
    soubassement: c.soubassement === 'aucun' ? couleurFacade(c) : COULEUR_SOUBASSEMENT[c.soubassement],
    toiture: COULEUR_TOITURE[c.toiture],
  };
}

// ── Scène 3D de l'aperçu (boîtes) ─────────────────────────────────────────────
/** Boîte : centre (x est, y haut, z sud — repère three), tailles le long du corps (u, hauteur, v), rotation Y (rad). */
export interface Boite { m: Matiere; p: [number, number, number]; s: [number, number, number]; r: number; opacite?: number }
/** Toit à deux pans d'un corps : prisme (centre, axe du faîtage le long du grand côté, base au-dessus du dernier niveau). */
export interface ToitPente { cx: number; cy: number; a: number; l: number; p: number; base: number; h: number }
export interface SceneApercu { boites: Boite[]; toits: ToitPente[]; contour: [number, number][] | null; rayon: number; hauteurMax: number; centre: [number, number] }

/** Éléments au plus (au-delà, les fenêtres des corps suivants sont omises : aperçu, pas rendu). */
export const BOITES_MAX = 6000;

/**
 * Volume réel + choix → boîtes de l'aperçu. Corps : centre et angle du Dossier 3D (même repère
 * que corpsAffiches : x est, y nord, angle du grand côté depuis l'est, sens trigonométrique).
 */
export function sceneApercu(apercu: ApercuVolume, c: ChoixBrief, limites: LimitesBrief = { batiments: 1, balcons: true }): SceneApercu {
  const boites: Boite[] = [];
  const toits: ToitPente[] = [];
  const allume = c.ambiance === 'nuit';
  const verre = c.facade === 'verre';
  const opGc = opaciteGardeCorps(c.garde_corps);
  let hMax = 0;
  const pts: [number, number][] = [];
  for (const k of apercu.corps) {
    const a = (k.a * Math.PI) / 180;
    const cu = Math.cos(a), su = Math.sin(a);
    // Point du corps (u le long, v en profondeur, h hauteur) → repère three.
    const monde = (u: number, v: number, h: number): [number, number, number] => {
      const x = k.cx + u * cu - v * su, y = k.cy + u * su + v * cu;
      return [x, h, -y];
    };
    const ajoute = (m: Matiere, u: number, v: number, h: number, su_: number, sh: number, sv: number, opacite?: number) => {
      if (boites.length >= BOITES_MAX) return;
      boites.push({ m, p: monde(u, v, h), s: [su_, sh, sv], r: a, ...(opacite !== undefined ? { opacite } : {}) });
    };
    const pente = toitEnPente(c.toiture);
    const niveaux = niveauxCorps(k.n, c.attique && !pente);
    const hCorps = niveaux.filter((nv) => nv.role !== 'attique').reduce((m, nv) => Math.max(m, nv.cote + nv.hauteur), 0);
    const hToit = pente ? hauteurToitPente(k.l, k.p) : 0;
    hMax = Math.max(hMax, hauteurCorps(k.n, c.attique && !pente) + hToit);
    for (const [u, v] of [[-k.l / 2, -k.p / 2], [k.l / 2, -k.p / 2], [k.l / 2, k.p / 2], [-k.l / 2, k.p / 2]] as const) {
      const w = monde(u, v, 0); pts.push([w[0], -w[2]]);
    }
    // Corps plein.
    ajoute('mur', 0, 0, hCorps / 2, k.l, hCorps, k.p, verre ? 0.92 : undefined);
    // Soubassement : bandeau de 0,60 m, légèrement en saillie (Studio : même nu, matière différente).
    if (c.soubassement !== 'aucun') ajoute('soubassement', 0, 0, HAUTEUR_SOUBASSEMENT / 2, k.l + 0.06, HAUTEUR_SOUBASSEMENT, k.p + 0.06);
    // Lot formes-batiment : côtés accolés à une autre aile (aucune façade, aucun retrait d'attique).
    const interieur = (i: number) => k.int?.includes(i) ?? false;
    const attiqueIci = c.attique && !pente;
    if (attiqueIci) {
      const at = niveaux[niveaux.length - 1];
      const r = STUDIO.retraitAttique, ext = (i: number) => (interieur(i) ? 0 : r);
      const la = Math.max(1, k.l - ext(2) - ext(3)), pa = Math.max(1, k.p - ext(0) - ext(1));
      ajoute('mur', (ext(3) - ext(2)) / 2, (ext(1) - ext(0)) / 2, at.cote + at.hauteur / 2, la, at.hauteur + STUDIO.dalle, pa, verre ? 0.92 : undefined);
    }
    // Toiture : végétalisée = tapis vert sur la terrasse (et sur l'attique) ; deux pans = prisme au-dessus du dernier niveau.
    if (c.toiture === 'vegetalisee') {
      ajoute('toiture', 0, 0, hCorps + 0.08, Math.max(1, k.l - 0.6), 0.16, Math.max(1, k.p - 0.6));
    }
    if (pente) {
      const grand = k.l >= k.p;
      toits.push({ cx: k.cx, cy: k.cy, a: grand ? k.a : k.a + 90, l: (grand ? k.l : k.p) + 2 * TOIT_PENTE.debord, p: (grand ? k.p : k.l) + 2 * TOIT_PENTE.debord, base: hCorps, h: hToit });
    }
    // Façades : 4 côtés (normale +v, −v, +u, −u).
    // t : abscisse le long de la façade (origine au milieu) ; d : avancée vers l'extérieur ; r : retrait (attique).
    const cotes: { long: number; uv: (t: number, d: number, r: number) => [number, number]; leLongDeU: boolean }[] = [
      { long: k.l, uv: (t, d, r) => [t, k.p / 2 - r + d], leLongDeU: true },
      { long: k.l, uv: (t, d, r) => [-t, -k.p / 2 + r - d], leLongDeU: true },
      { long: k.p, uv: (t, d, r) => [k.l / 2 - r + d, t], leLongDeU: false },
      { long: k.p, uv: (t, d, r) => [-k.l / 2 + r - d, -t], leLongDeU: false },
    ];
    for (const nv of niveaux) {
      const retrait = nv.role === 'attique' ? STUDIO.retraitAttique : 0;
      for (const [iCote, f] of cotes.entries()) {
        if (interieur(iCote)) continue;
        const L = f.long - 2 * retrait;
        if (L < 1) continue;
        const box = (m: Matiere, t: number, d: number, h: number, le: number, hh: number, ep: number, op?: number) => {
          const [u, v] = f.uv(t, d, retrait);
          ajoute(m, u, v, h, f.leLongDeU ? le : ep, hh, f.leLongDeU ? ep : le, op);
        };
        if (verre) {
          // Mur-rideau : allège opaque de 0,9 m en pied de chaque niveau (FacadeGenerator CURTAIN_WALL_SPANDREL_M).
          box('allege', 0, 0.02, nv.cote + STUDIO.allegeMurRideau / 2, L, STUDIO.allegeMurRideau, 0.06);
          if (allume) box('vitrageAllume', 0, 0.01, nv.cote + STUDIO.allegeMurRideau + (nv.hauteur - STUDIO.allegeMurRideau) / 2, L - 0.4, nv.hauteur - STUDIO.allegeMurRideau - 0.2, 0.04, 0.55);
          continue;
        }
        const commerces = nv.role === 'rdc' && c.rdc === 'commerces';
        const fen = dimsFenetre(c.ouvertures, STUDIO.trame, nv.hauteur);
        const balconsIci = nv.role === 'etage' && c.balcons !== 'aucun' && limites.balcons;
        if (balconsIci && c.balcons === 'balcons_filants') {
          const lb = Math.max(0.5, L - 2 * STUDIO.balcon.retraitFilant);
          box('dalle', 0, STUDIO.balcon.profondeur / 2, nv.cote - STUDIO.balcon.epaisseur / 2, lb, STUDIO.balcon.epaisseur, STUDIO.balcon.profondeur);
          box('gardeCorps', 0, STUDIO.balcon.profondeur, nv.cote + STUDIO.balcon.gardeCorps / 2, lb, STUDIO.balcon.gardeCorps, 0.04, opGc);
        }
        for (const t of travees(L)) {
          if (commerces) {
            // Vitrine : la travée vitrée presque entière, sur la hauteur du rez (aperçu).
            box('vitrine', t.centre, 0.03, nv.cote + 0.15 + (nv.hauteur - 0.6) / 2, Math.max(0.6, t.largeur - 0.5), nv.hauteur - 0.6, 0.06);
            continue;
          }
          const loggia = balconsIci && c.balcons === 'loggias' && !t.angle;
          const balcon = balconsIci && c.balcons === 'balcons' && !t.angle;
          if (loggia) {
            // Loggia : creux sombre de la travée (le Studio creuse le mur de 1,40 m) + garde-corps au nu de la façade.
            const lg = Math.max(0.8, t.largeur - 0.3);
            box('fondLoggia', t.centre, 0.02, nv.cote + nv.hauteur / 2, lg, nv.hauteur, 0.05);
            box('vitrage', t.centre, 0.05, nv.cote + fen.allege + fen.hauteur / 2, Math.min(fen.largeur, lg - 0.2), fen.hauteur, 0.04, 0.9);
            box('gardeCorps', t.centre, 0.08, nv.cote + STUDIO.balcon.gardeCorps / 2, lg, STUDIO.balcon.gardeCorps, 0.04, opGc);
            continue;
          }
          // Menuiserie : cadre de 7 cm autour du vitrage (FacadeGenerator frameWidth), couleur du brief.
          box('menuiserie', t.centre, 0.02, nv.cote + fen.allege + fen.hauteur / 2, fen.largeur + 0.14, fen.hauteur + 0.14, 0.05);
          box(allume ? 'vitrageAllume' : 'vitrage', t.centre, 0.04, nv.cote + fen.allege + fen.hauteur / 2, fen.largeur, fen.hauteur, 0.06);
          if (balcon) {
            const lb = Math.max(0.8, t.largeur - 0.3);
            box('dalle', t.centre, STUDIO.balcon.profondeur / 2, nv.cote - STUDIO.balcon.epaisseur / 2, lb, STUDIO.balcon.epaisseur, STUDIO.balcon.profondeur);
            box('gardeCorps', t.centre, STUDIO.balcon.profondeur, nv.cote + STUDIO.balcon.gardeCorps / 2, lb, STUDIO.balcon.gardeCorps, 0.04, opGc);
          }
        }
      }
    }
  }
  const contour = apercu.contour;
  for (const q of contour ?? []) pts.push(q);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const centre: [number, number] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const rayon = Math.max(10, ...pts.map((q) => Math.hypot(q[0] - centre[0], q[1] - centre[1])));
  return { boites, toits, contour, rayon, hauteurMax: hMax, centre };
}

/** Hauteur d'un toit à deux pans du Studio : (demi-petit côté + débord) × tan 35° (5,88 m pour 16 m, mesuré le 06/11). */
export function hauteurToitPente(l: number, p: number): number {
  return Math.round((Math.min(l, p) / 2 + TOIT_PENTE.debord) * Math.tan((TOIT_PENTE.penteDeg * Math.PI) / 180) * 100) / 100;
}

// ── Vignette : une travée de façade en élévation (SVG) ─────────────────────────
export interface RectSvg { x: number; y: number; w: number; h: number; fill: string; opacite?: number; trait?: string }
export interface DessinTravee { largeur: number; hauteur: number; rects: RectSvg[]; motif: 'brique' | 'bois' | 'pierre' | null; murIndex?: number }

/**
 * Élévation de 3 travées (rez + 2 étages, + attique) aux dimensions du Studio, en mètres
 * (le composant met à l'échelle). La travée du milieu porte balcon / loggia ; les angles non.
 */
export function dessinTravee(c: ChoixBrief): DessinTravee {
  const col = couleurs(c);
  const nuit = c.ambiance === 'nuit';
  const L = 3 * STUDIO.trame + 2 * STUDIO.margeExtremite;
  const pente = toitEnPente(c.toiture);
  const attique = c.attique && !pente;
  const niveaux = niveauxCorps(3, attique);
  // Toit à deux pans vu de la façade longue : bande de couverture (vignette : hauteur réduite de moitié pour rester lisible).
  const hToit = pente ? hauteurToitPente(20, 16) / 2 : 0;
  const H = hauteurCorps(3, attique) + 1.2 + hToit;
  const sol = H - 0.6;
  const y = (cote: number, h: number) => sol - cote - h;
  const ciel = lumiere(c.ambiance).ciel;
  const rects: RectSvg[] = [{ x: -2, y: -2, w: L + 4, h: H + 4, fill: ciel }];
  const hCorps = niveaux.filter((n) => n.role !== 'attique').reduce((m, n) => Math.max(m, n.cote + n.hauteur), 0);
  rects.push({ x: 0, y: y(0, hCorps), w: L, h: hCorps, fill: col.mur, trait: '#00000022' });
  if (pente) rects.push({ x: -TOIT_PENTE.debord, y: y(hCorps, hToit), w: L + 2 * TOIT_PENTE.debord, h: hToit, fill: col.toiture, trait: '#00000033' });
  if (c.toiture === 'vegetalisee') rects.push({ x: 0.2, y: y(hCorps, 0.35), w: L - 0.4, h: 0.35, fill: col.toiture });
  if (c.soubassement !== 'aucun') rects.push({ x: -0.03, y: y(0, HAUTEUR_SOUBASSEMENT), w: L + 0.06, h: HAUTEUR_SOUBASSEMENT, fill: col.soubassement, trait: '#00000022' });
  if (attique) {
    const at = niveaux[niveaux.length - 1];
    rects.push({ x: STUDIO.retraitAttique, y: y(at.cote - STUDIO.dalle, at.hauteur + STUDIO.dalle), w: L - 2 * STUDIO.retraitAttique, h: at.hauteur + STUDIO.dalle, fill: col.mur, trait: '#00000022' });
  }
  const verre = c.facade === 'verre';
  for (const nv of niveaux) {
    const x0 = nv.role === 'attique' ? STUDIO.retraitAttique : 0;
    const Lnv = L - 2 * x0;
    const cx = (t: number) => x0 + Lnv / 2 + t;
    if (verre) {
      rects.push({ x: x0, y: y(nv.cote, STUDIO.allegeMurRideau), w: Lnv, h: STUDIO.allegeMurRideau, fill: col.allege });
      rects.push({ x: x0 + 0.1, y: y(nv.cote + STUDIO.allegeMurRideau, nv.hauteur - STUDIO.allegeMurRideau), w: Lnv - 0.2, h: nv.hauteur - STUDIO.allegeMurRideau, fill: nuit ? col.vitrageAllume : col.vitrage, opacite: nuit ? 0.8 : 0.55 });
      for (const t of travees(Lnv)) rects.push({ x: cx(t.centre + t.largeur / 2) - 0.03, y: y(nv.cote, nv.hauteur), w: 0.06, h: nv.hauteur, fill: '#5d676b' });
      continue;
    }
    const fen = dimsFenetre(c.ouvertures, STUDIO.trame, nv.hauteur);
    const balconsIci = nv.role === 'etage' && c.balcons !== 'aucun';
    const opGc = opaciteGardeCorps(c.garde_corps);
    for (const t of travees(Lnv)) {
      if (nv.role === 'rdc' && c.rdc === 'commerces') {
        rects.push({ x: cx(t.centre) - (t.largeur - 0.5) / 2, y: y(0.15, nv.hauteur - 0.6), w: t.largeur - 0.5, h: nv.hauteur - 0.6, fill: col.vitrine, trait: '#2f3a40' });
        continue;
      }
      const milieu = !t.angle;
      if (balconsIci && c.balcons === 'loggias' && milieu) {
        const lg = t.largeur - 0.3;
        rects.push({ x: cx(t.centre) - lg / 2, y: y(nv.cote, nv.hauteur), w: lg, h: nv.hauteur, fill: col.fondLoggia });
      }
      rects.push({ x: cx(t.centre) - fen.largeur / 2 - 0.07, y: y(nv.cote + fen.allege - 0.07, fen.hauteur + 0.14), w: fen.largeur + 0.14, h: fen.hauteur + 0.14, fill: col.menuiserie });
      rects.push({ x: cx(t.centre) - fen.largeur / 2, y: y(nv.cote + fen.allege, fen.hauteur), w: fen.largeur, h: fen.hauteur, fill: nuit ? col.vitrageAllume : col.vitrage });
      if (balconsIci && milieu && (c.balcons === 'balcons' || c.balcons === 'loggias')) {
        const lb = t.largeur - 0.3;
        if (c.balcons === 'balcons') rects.push({ x: cx(t.centre) - lb / 2, y: y(nv.cote - STUDIO.balcon.epaisseur, STUDIO.balcon.epaisseur), w: lb, h: STUDIO.balcon.epaisseur, fill: col.dalle });
        rects.push({ x: cx(t.centre) - lb / 2, y: y(nv.cote, STUDIO.balcon.gardeCorps), w: lb, h: STUDIO.balcon.gardeCorps, fill: col.gardeCorps, opacite: opGc });
      }
    }
    if (balconsIci && c.balcons === 'balcons_filants') {
      const lb = Lnv - 2 * STUDIO.balcon.retraitFilant;
      rects.push({ x: x0 + STUDIO.balcon.retraitFilant, y: y(nv.cote - STUDIO.balcon.epaisseur, STUDIO.balcon.epaisseur), w: lb, h: STUDIO.balcon.epaisseur, fill: col.dalle });
      rects.push({ x: x0 + STUDIO.balcon.retraitFilant, y: y(nv.cote, STUDIO.balcon.gardeCorps), w: lb, h: STUDIO.balcon.gardeCorps, fill: col.gardeCorps, opacite: opGc });
    }
  }
  rects.push({ x: -2, y: sol, w: L + 4, h: 2, fill: lumiere(c.ambiance).sol });
  const motif = c.facade === 'brique' ? 'brique' : c.facade === 'bardage_bois' ? 'bois' : c.facade === 'pierre' ? 'pierre' : null;
  return { largeur: L, hauteur: H, rects, motif, murIndex: 1 };
}
