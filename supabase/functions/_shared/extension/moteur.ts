// supabase/functions/_shared/extension/moteur.ts
// COPIE (lot X3, 14/11/2026) de mimmozia-studio/src/core/extension/moteur.ts @ 0d3a044 (sha256 du fichier source : c15390988ac94632b028386b46380c23a914bcf33349bce8d0833f87036b8ff2).
// Seule modification : chemins d'import suffixés « .ts » (Deno). Le site fait tourner le MÊME moteur que le Studio pour
// dire tôt à l'utilisateur ce qui passe ou non (refus expliqués, surfaces créées estimées) ; le Studio fait foi.
// ----- DÉBUT DE LA COPIE -----
/**
 * MOTEUR D'EXTENSION DE MAISON (lot X2, 13/11/2026). Module PUR et DÉTERMINISTE : même entrée, même sortie, au
 * millimètre. Le LLM ne place AUCUNE géométrie : il peut seulement remplir la demande (contrat X0) ; ce module place.
 *
 * Entrée : la maison existante modélisée (lot X1, `MaisonExistante`), la parcelle dans le repère de scène (x = est,
 * z = sud, y = haut), les règles connues (fiche ou site) et la demande d'extension (contrat X0 `ExtensionDemandee`).
 * Sortie : le volume (emprise, hauteurs, toiture), les diagnostics (reculs, emprise, surfaces) et les RAISONS DE REFUS.
 * Chaque valeur porte son statut (mesurée / estimée / supposée / confirmée) et sa source. Rien n'est corrigé en silence :
 * une demande impossible est REFUSÉE avec sa raison, et le moteur dit ce qui passerait (profondeur maximale).
 *
 * RÈGLES ÉCRITES (chiffres dans `REGLES_EXTENSION`) :
 *   Façade d'accroche — côté vu DEPUIS LA RUE. La rue est la limite de parcelle classée voie (`categories`, sinon
 *     `segmentRue`) ; sa normale sortante donne la direction « rue ». Un observateur dans la rue regarde la maison :
 *     sa gauche est la « gauche ». Parmi les arêtes de l'emprise BD TOPO dont la normale sortante est à moins de 45° de
 *     la direction voulue, on prend la PLUS LONGUE (la façade principale, pas un décroché) ; à égalité, la plus avancée.
 *     `arete` (indice d'arête BD TOPO) prime si elle existe, mesure ≥ 1 m et regarde le côté demandé (< 90°).
 *   Murs — l'extension est un rectangle posé CONTRE l'arête choisie, murs dans l'alignement de cette arête.
 *     Largeur (le long de la façade) ≤ longueur de la façade, sauf `depasserFacade`. Position le long de la façade :
 *     latérale et garage alignés d'abord sur l'angle côté rue (alignement des façades sur rue), puis sur l'autre
 *     angle, puis centrés ; arrière et rue : centrés, puis angle gauche, puis angle droit. La première position qui
 *     respecte tout est retenue (ordre fixe : déterministe).
 *   Hauteur — latérale / arrière : 1 niveau de plain-pied (3 m à l'égout, SUPPOSÉ) faute de demande ; jamais au-dessus
 *     de l'égout existant, sauf l'option « même hauteur » (égout et niveaux de l'existant). Garage : 2,8 m SUPPOSÉS,
 *     plain-pied obligatoire. Hauteur minimale : 2,5 m (pièce de vie : 2,2 m sous plafond + plancher et toiture), 2,2 m
 *     pour un garage.
 *   Toiture — plat (acrotère compris dans la hauteur à l'égout) ; monopente ADOSSÉ (haut contre l'existant, pente 15°
 *     SUPPOSÉE) dont le haut reste sous l'égout existant (sinon l'égout de l'extension est abaissé, et refusé sous la
 *     hauteur minimale) ; 2 pans « dans le prolongement » SEULEMENT si l'extension prolonge le corps principal par son
 *     PIGNON, à la même largeur (± 0,15 m), la même hauteur à l'égout et la même pente — sinon refus documenté.
 *     4 pans : jamais produit pour une extension. Garage : plat ou monopente seulement.
 *   Surélévation — un ou plusieurs niveaux sur le CORPS PRINCIPAL ; la toiture existante de ce corps est remplacée,
 *     ce qui n'est accepté que si l'utilisateur a CONFIRMÉ la toiture existante (statut « confirmée ») — sinon refus.
 *     Hauteur d'étage = égout existant / niveaux existants (estimée, bornée 2,5–3,5 m), sinon 3 m SUPPOSÉS.
 *   Reculs — règle de la DEMANDE (fiche) d'abord, puis règle du SITE, sinon SUPPOSÉE et dite :
 *     · voie : 4 m SUPPOSÉS (même hypothèse que le volume d'étude P9), ramenés à la distance de la maison existante si
 *       elle est déjà plus près (extension dans l'alignement de l'existant) ;
 *     · limites séparatives et fond : règle nationale RNU (art. R.111-17 du code de l'urbanisme), SUPPOSÉE faute de
 *       PLU lu : en limite (≤ 5 cm), ou à une distance ≥ moitié de la hauteur, sans pouvoir être < 3 m.
 *     Une règle connue (statut ≠ supposée) s'applique telle quelle (0 m = implantation en limite autorisée).
 *     Surélévation : l'emprise ne change pas ; les reculs SUPPOSÉS sont seulement signalés, les règles connues
 *     sont opposées.
 *     Limites non classées : celle qui est parallèle à la voie (± 30°) et du côté opposé est le FOND (estimé), les
 *     autres sont séparatives (estimé).
 *   Emprise — l'extension doit tenir dans la parcelle (aucun point dehors) et ne chevaucher aucun bâtiment conservé.
 *     CES connu : emprise existante + extension ≤ CES × surface de la parcelle ; sinon « non contrôlé » (dit).
 *   Surfaces créées (ESTIMÉES, jamais réglementaires) : emprise = largeur × profondeur ; surface de plancher =
 *     niveaux × (emprise − 3 murs neufs × 0,25 m SUPPOSÉS) ; garage : 0 m² (stationnement déduit, art. R.111-22
 *     du code de l'urbanisme) ; surélévation : niveaux × (corps − périmètre × 0,25 m) − 3 m² de trémie SUPPOSÉE ;
 *     fourchette ± 15 % (mêmes hypothèses que X1).
 */
import type { CoteFacade, Donnee, ExtensionDemandee, FormeToit, FormeToitExtension, StatutDonnee, TypeExtension } from './contrat.ts';
import { aire, dedans, hauteurToiture, type Pt, type RectOriente } from './geometrie.ts';
import { REGLES_SURFACE, type MaisonExistante } from './maisonExistante.ts';

export const REGLES_EXTENSION = {
  angleFacadeMaxDeg: 45,
  areteMinM: 1,
  hauteurNiveauM: 3,
  egoutPlainPiedM: 3,
  egoutGarageM: 2.8,
  hauteurMinM: 2.5,
  hauteurMinGarageM: 2.2,
  hauteurEtageMinM: 2.5,
  hauteurEtageMaxM: 3.5,
  penteMonopenteDeg: 15,
  toleranceLargeurPignonM: 0.15,
  toleranceEgoutM: 0.05,
  tolerancePenteDeg: 1,
  reculVoieSupposeM: 4,
  reculRnuMinM: 3,
  enLimiteM: 0.05,
  angleFondDeg: 30,
  murNeufM: REGLES_SURFACE.epaisseurMursM,
  tremieM2: REGLES_SURFACE.tremieM2,
  incertitude: REGLES_SURFACE.incertitude,
  dimensionsSupposees: {
    laterale: { largeurM: 4, profondeurM: 4 },
    arriere: { largeurM: 5, profondeurM: 4 },
    garage: { largeurM: 6, profondeurM: 3 },
    rue: { largeurM: 4, profondeurM: 3 },
  },
} as const;

export type CategorieLimite = 'voie' | 'separative' | 'fond';

/** Parcelle dans le repère de scène. `categories[i]` : limite contour[i] → contour[i+1] (null = non classée). */
export interface ParcelleMoteur {
  readonly contour: readonly Pt[];
  readonly surfaceM2?: number | null;
  readonly categories?: readonly (CategorieLimite | null)[];
  /** Indice de la limite sur rue (ParcelleProjet.rue.segment), si `categories` ne la donne pas. */
  readonly segmentRue?: number | null;
}

/** Règles connues (fiche Mimmoza, site du Studio). Absente = inconnue (le moteur suppose et le dit). */
export interface ReglesExtension {
  readonly voieM?: Donnee<number>;
  readonly limitesSeparativesM?: Donnee<number>;
  readonly fondM?: Donnee<number>;
  /** Coefficient d'emprise au sol, 0..1. */
  readonly cesMax?: Donnee<number>;
  readonly hauteurMaxM?: Donnee<number>;
}

export interface HabillageExtension {
  /** Identifiants de la bibliothèque ArchViz (av-…). */
  readonly facade?: Donnee<string>;
  readonly toiture?: Donnee<string>;
}

export interface OptionsMoteurExtension {
  /** Égout et niveaux de l'existant (latérale / arrière). */
  readonly memeHauteur?: boolean;
  /** Autorise une largeur supérieure à la façade d'accroche (demande explicite). */
  readonly depasserFacade?: boolean;
  /** Autres bâtiments CONSERVÉS de la parcelle (annexes) : emprise totale et chevauchements. */
  readonly autresBatiments?: readonly { readonly id: string; readonly anneau: readonly Pt[] }[];
  readonly habillage?: HabillageExtension;
}

export interface EntreeMoteurExtension {
  readonly maison: MaisonExistante;
  readonly demande: ExtensionDemandee;
  readonly parcelle: ParcelleMoteur | null;
  readonly regles?: ReglesExtension;
  readonly options?: OptionsMoteurExtension;
}

export type NiveauDiagnostic = 'ok' | 'info' | 'alerte' | 'refus';
export interface DiagnosticExtension {
  readonly code: string;
  readonly niveau: NiveauDiagnostic;
  readonly message: string;
}

export interface ReculMesure {
  readonly limite: number;
  readonly categorie: CategorieLimite;
  readonly sourceCategorie: string;
  readonly distanceM: number;
  readonly minimumM: number;
  readonly regle: Donnee<number> | null;
  /** Phrase de la règle appliquée (RNU, P9, fiche…). */
  readonly libelle: string;
  readonly enLimite: boolean;
  readonly ok: boolean;
}

export interface FacadeRetenue {
  readonly cote: CoteFacade;
  readonly arete: number;
  readonly longueurM: number;
  readonly source: string;
  readonly a: Pt;
  readonly b: Pt;
  /** Normale sortante (unitaire). */
  readonly nx: number;
  readonly nz: number;
}

export interface VolumeExtension {
  readonly type: TypeExtension;
  /** 4 coins (repère de scène) : contre la façade (début, fin), puis côté extérieur (fin, début). */
  readonly empreinte: readonly Pt[];
  /** Pied du volume (m) : sol de la maison ; surélévation : égout existant. */
  readonly baseM: number;
  readonly largeurM: Donnee<number>;
  readonly profondeurM: Donnee<number>;
  readonly niveaux: Donnee<number>;
  /** Hauteur à l'égout au-dessus du SOL de la maison (m). */
  readonly hauteurEgoutM: Donnee<number>;
  /** Point le plus haut au-dessus du sol (faîtage, haut du monopente, acrotère). */
  readonly hauteurMaxM: Donnee<number>;
  readonly toiture: {
    readonly forme: Donnee<FormeToit>;
    readonly penteDeg: Donnee<number>;
    /** Monopente : direction de la PENTE descendante (unitaire, sortante). 2 pans : axe du faîtage (unitaire). */
    readonly dx: number;
    readonly dz: number;
    readonly prolongement: boolean;
  };
  readonly habillage: { readonly facade: Donnee<string>; readonly toiture: Donnee<string> };
  /** Surélévation : corps de l'existant surélevé (sa toiture est remplacée). */
  readonly corpsSureleve?: RectOriente;
}

export interface SurfacesExtension {
  readonly empriseCreeeM2: Donnee<number>;
  readonly surfacePlancherCreeeM2: Donnee<number> & { readonly minM2: number; readonly maxM2: number };
  readonly empriseExistanteM2: number;
  readonly empriseApresM2: number;
  readonly surfaceParcelleM2: number | null;
  readonly empriseMaxM2: Donnee<number> | null;
  readonly empriseResiduelleM2: number | null;
  readonly controleCes: 'ok' | 'depasse' | 'non-controle';
}

export interface ResultatExtension {
  readonly ok: boolean;
  readonly type: TypeExtension;
  readonly existantId: string;
  readonly refus: readonly string[];
  readonly diagnostics: readonly DiagnosticExtension[];
  readonly facade: FacadeRetenue | null;
  readonly volume: VolumeExtension | null;
  readonly reculs: readonly ReculMesure[];
  readonly surfaces: SurfacesExtension | null;
  readonly hypotheses: readonly string[];
  /** Ce qui passerait (même façade, même position) quand la profondeur est refusée. */
  readonly suggestion: { readonly profondeurMaxM: number } | null;
  /** Surélévation : la toiture existante du corps principal est remplacée (patch de confirmation obligatoire). */
  readonly remplaceToitureExistante: boolean;
}

/* ------------------------------------------------------------------ */
/* Géométrie plane                                                     */
/* ------------------------------------------------------------------ */

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const fr = (v: number, d = 2): string => v.toFixed(d).replace('.', ',');
const D = <T,>(valeur: T, statut: StatutDonnee, source: string): Donnee<T> => ({ valeur, statut, source });
const RAD = Math.PI / 180;

function distPointSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

function croisent(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt): number => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

function distSegments(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (croisent(a, b, c, d)) return 0;
  return Math.min(distPointSegment(a, c, d), distPointSegment(b, c, d), distPointSegment(c, a, b), distPointSegment(d, a, b));
}

/** Distance d'un polygone à un segment ; 0 s'ils se coupent. */
export function distPolygoneSegment(poly: readonly Pt[], a: Pt, b: Pt): number {
  let m = Infinity;
  for (let i = 0; i < poly.length; i += 1) m = Math.min(m, distSegments(poly[i]!, poly[(i + 1) % poly.length]!, a, b));
  return m;
}

/** Rétrécit un polygone convexe de `e` m vers son centre (approximation suffisante pour un test de contact). */
function retrecir(rect: readonly Pt[], e: number): Pt[] {
  const cx = rect.reduce((s, p) => s + p.x, 0) / rect.length;
  const cz = rect.reduce((s, p) => s + p.z, 0) / rect.length;
  return rect.map((p) => {
    const l = Math.hypot(p.x - cx, p.z - cz);
    return l > e * 2 ? { x: p.x + ((cx - p.x) / l) * e * Math.SQRT2, z: p.z + ((cz - p.z) / l) * e * Math.SQRT2 } : { x: cx, z: cz };
  });
}

/** Le rectangle chevauche-t-il le polygone (au-delà d'un simple contact) ? Sommets, milieux et croisements, après retrait de 5 cm. */
export function chevauche(rect: readonly Pt[], poly: readonly Pt[]): boolean {
  const r = retrecir(rect, 0.05);
  if (r.some((p) => dedans(p.x, p.z, poly))) return true;
  const cx = r.reduce((s, p) => s + p.x, 0) / r.length, cz = r.reduce((s, p) => s + p.z, 0) / r.length;
  if (dedans(cx, cz, poly)) return true;
  for (let i = 0; i < r.length; i += 1) {
    const a = r[i]!, b = r[(i + 1) % r.length]!;
    if (dedans((a.x + b.x) / 2, (a.z + b.z) / 2, poly)) return true;
    for (let j = 0; j < poly.length; j += 1) if (croisent(a, b, poly[j]!, poly[(j + 1) % poly.length]!)) return true;
  }
  return poly.some((p) => dedans(p.x, p.z, r));
}

/** Normale sortante unitaire de l'arête i d'un polygone. */
function normaleSortante(poly: readonly Pt[], i: number): { nx: number; nz: number; l: number } {
  const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  let nx = (b.z - a.z) / l, nz = -(b.x - a.x) / l;
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  if (dedans(mx + nx * 0.05, mz + nz * 0.05, poly)) { nx = -nx; nz = -nz; }
  return { nx, nz, l };
}

/* ------------------------------------------------------------------ */
/* Direction de la rue, limites                                        */
/* ------------------------------------------------------------------ */

interface Rue { readonly nx: number; readonly nz: number }
interface Limites {
  readonly cat: readonly CategorieLimite[];
  readonly source: readonly string[];
  readonly rue: Rue | null;
}

function classerLimites(p: ParcelleMoteur): Limites {
  const n = p.contour.length;
  const cat: (CategorieLimite | null)[] = Array.from({ length: n }, (_, i) => p.categories?.[i] ?? null);
  const source: string[] = cat.map((c) => (c ? 'classement de la parcelle (site)' : ''));
  if (!cat.includes('voie') && typeof p.segmentRue === 'number' && p.segmentRue >= 0 && p.segmentRue < n) {
    cat[p.segmentRue] = 'voie';
    source[p.segmentRue] = 'limite sur rue de la parcelle (implantation)';
  }
  // Direction de la rue : la plus longue limite classée voie.
  let rue: Rue | null = null;
  let best = 0;
  for (let i = 0; i < n; i += 1) {
    if (cat[i] !== 'voie') continue;
    const ns = normaleSortante(p.contour, i);
    if (ns.l > best) { best = ns.l; rue = { nx: ns.nx, nz: ns.nz }; }
  }
  for (let i = 0; i < n; i += 1) {
    if (cat[i]) continue;
    const ns = normaleSortante(p.contour, i);
    if (rue && ns.nx * rue.nx + ns.nz * rue.nz < -Math.cos(REGLES_EXTENSION.angleFondDeg * RAD)) {
      cat[i] = 'fond';
      source[i] = 'limite non classée, opposée à la voie (± 30°) : FOND estimé';
    } else {
      cat[i] = 'separative';
      source[i] = 'limite non classée : séparative estimée';
    }
  }
  return { cat: cat as CategorieLimite[], source, rue };
}

/** Direction (unitaire) du côté demandé, vue depuis la rue. */
export function directionCote(cote: CoteFacade, rue: Rue): { x: number; z: number } {
  // Observateur dans la rue regardant la maison : regard d = −n_rue ; sa gauche = (d.z, −d.x) dans (x = est, z = sud).
  const d = { x: -rue.nx, z: -rue.nz };
  if (cote === 'rue') return { x: rue.nx, z: rue.nz };
  if (cote === 'arriere') return d;
  if (cote === 'gauche') return { x: d.z, z: -d.x };
  return { x: -d.z, z: d.x };
}

/* ------------------------------------------------------------------ */
/* Le moteur                                                           */
/* ------------------------------------------------------------------ */

function choisirFacade(m: MaisonExistante, cote: CoteFacade, arete: number | undefined, rue: Rue, diag: DiagnosticExtension[]): FacadeRetenue | null {
  const dir = directionCote(cote, rue);
  const poly = m.anneau;
  const n = poly.length;
  const mk = (i: number, source: string): FacadeRetenue => {
    const ns = normaleSortante(poly, i);
    return { cote, arete: i, longueurM: r2(ns.l), source, a: poly[i]!, b: poly[(i + 1) % n]!, nx: ns.nx, nz: ns.nz };
  };
  if (typeof arete === 'number') {
    if (Number.isInteger(arete) && arete >= 0 && arete < n) {
      const ns = normaleSortante(poly, arete);
      if (ns.l >= REGLES_EXTENSION.areteMinM && ns.nx * dir.x + ns.nz * dir.z > 0) return mk(arete, `arête ${arete} de l’emprise BD TOPO (désignée)`);
      diag.push({ code: 'arete-ignoree', niveau: 'alerte', message: `Arête ${arete} ignorée : trop courte (< 1 m) ou ne regarde pas le côté « ${cote} » ; façade choisie par la règle.` });
    } else diag.push({ code: 'arete-ignoree', niveau: 'alerte', message: `Arête ${String(arete)} inexistante (l’emprise a ${n} arêtes) ; façade choisie par la règle.` });
  }
  let best: { i: number; l: number; avance: number } | null = null;
  for (let i = 0; i < n; i += 1) {
    const ns = normaleSortante(poly, i);
    if (ns.l < REGLES_EXTENSION.areteMinM) continue;
    if (ns.nx * dir.x + ns.nz * dir.z < Math.cos(REGLES_EXTENSION.angleFacadeMaxDeg * RAD)) continue;
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    const avance = ((a.x + b.x) / 2) * dir.x + ((a.z + b.z) / 2) * dir.z;
    if (!best || ns.l > best.l + 0.01 || (Math.abs(ns.l - best.l) <= 0.01 && avance > best.avance)) best = { i, l: ns.l, avance };
  }
  return best ? mk(best.i, `façade « ${cote} » : plus longue arête de l’emprise BD TOPO tournée de ce côté (± 45°)`) : null;
}

function rectangleContre(f: FacadeRetenue, t0: number, largeur: number, profondeur: number): Pt[] {
  const L = Math.hypot(f.b.x - f.a.x, f.b.z - f.a.z) || 1;
  const ux = (f.b.x - f.a.x) / L, uz = (f.b.z - f.a.z) / L;
  const p0 = { x: f.a.x + ux * t0, z: f.a.z + uz * t0 };
  const p1 = { x: p0.x + ux * largeur, z: p0.z + uz * largeur };
  return [p0, p1, { x: p1.x + f.nx * profondeur, z: p1.z + f.nz * profondeur }, { x: p0.x + f.nx * profondeur, z: p0.z + f.nz * profondeur }].map((p) => ({ x: r3(p.x), z: r3(p.z) }));
}

interface ContexteControle {
  readonly parcelle: ParcelleMoteur | null;
  readonly limites: Limites | null;
  readonly regles: ReglesExtension;
  readonly demande: ExtensionDemandee;
  readonly maison: MaisonExistante;
  readonly autres: readonly { readonly id: string; readonly anneau: readonly Pt[] }[];
  /** Distance actuelle de la maison à la voie (règle supposée « pas plus près que l'existant »). */
  readonly distanceMaisonVoieM: number | null;
  readonly surelevation: boolean;
}

function regleDe(ctx: ContexteControle, cat: CategorieLimite): Donnee<number> | null {
  const d = ctx.demande.reculs;
  const r = cat === 'voie'
    ? d?.voieM ?? ctx.regles.voieM
    : cat === 'fond'
      ? d?.fondM ?? ctx.regles.fondM ?? d?.limitesSeparativesM ?? ctx.regles.limitesSeparativesM
      : d?.limitesSeparativesM ?? ctx.regles.limitesSeparativesM;
  return r ?? null;
}

const libelleStatutCourt = (s: StatutDonnee): string => (s === 'confirmee' ? 'confirmée' : s === 'mesuree' ? 'mesurée' : s === 'estimee' ? 'estimée' : 'SUPPOSÉE');

/** Contrôle d'une empreinte : dans la parcelle, reculs, chevauchements. `hauteurMaxM` sert au prospect RNU supposé. */
function controler(ctx: ContexteControle, rect: readonly Pt[], hauteurMaxM: number): { refus: string[]; reculs: ReculMesure[]; alertes: string[] } {
  const refus: string[] = [];
  const alertes: string[] = [];
  const reculs: ReculMesure[] = [];
  if (ctx.parcelle && ctx.limites) {
    const c = ctx.parcelle.contour;
    const dehors = rect.filter((p) => !dedans(p.x, p.z, c) && Math.min(...c.map((_, i) => distPointSegment(p, c[i]!, c[(i + 1) % c.length]!))) > 0.01);
    const coupe = rect.some((p, i) => c.some((q, j) => croisent(p, rect[(i + 1) % rect.length]!, q, c[(j + 1) % c.length]!)));
    if (dehors.length || coupe) refus.push(`Hors parcelle : ${dehors.length ? `${dehors.length} angle(s) de l’extension hors du terrain` : 'l’extension coupe une limite de la parcelle'}.`);
    for (let i = 0; i < c.length; i += 1) {
      const cat = ctx.limites.cat[i]!;
      const dist = r2(distPolygoneSegment(rect, c[i]!, c[(i + 1) % c.length]!));
      const regle = regleDe(ctx, cat);
      let minimum: number;
      let libelle: string;
      let enLimiteAdmis = false;
      if (regle && regle.statut !== 'supposee') {
        minimum = regle.valeur;
        libelle = `${fr(regle.valeur)} m (${regle.source}, ${libelleStatutCourt(regle.statut)})`;
        enLimiteAdmis = regle.valeur === 0;
      } else if (cat === 'voie') {
        const base = regle?.valeur ?? REGLES_EXTENSION.reculVoieSupposeM;
        const existant = ctx.distanceMaisonVoieM;
        minimum = existant !== null && existant < base ? r2(existant) : base;
        libelle = existant !== null && existant < base
          ? `${fr(minimum)} m SUPPOSÉS : alignement de la maison existante (plus près que ${fr(base, 0)} m)`
          : `${fr(base, 0)} m SUPPOSÉS (hypothèse du volume d’étude P9, PLU non lu)`;
      } else {
        minimum = r2(Math.max(regle?.valeur ?? REGLES_EXTENSION.reculRnuMinM, hauteurMaxM / 2));
        libelle = `RNU R.111-17 SUPPOSÉ (PLU non lu) : en limite, ou ≥ max(3 m, H/2 = ${fr(hauteurMaxM / 2)} m)`;
        enLimiteAdmis = true;
      }
      const enLimite = dist <= REGLES_EXTENSION.enLimiteM;
      const ok = dist + 1e-6 >= minimum || (enLimite && enLimiteAdmis);
      const supposee = !regle || regle.statut === 'supposee';
      reculs.push({ limite: i, categorie: cat, sourceCategorie: ctx.limites.source[i]!, distanceM: dist, minimumM: minimum, regle: regle ?? null, libelle, enLimite, ok });
      if (!ok) {
        const msg = `Recul ${cat === 'voie' ? 'à la voie' : cat === 'fond' ? 'au fond' : 'à la limite séparative'} (limite ${i}) : ${fr(dist)} m < ${fr(minimum)} m — ${libelle}.`;
        if (ctx.surelevation && supposee) alertes.push(`${msg} Surélévation sur l’emprise existante : règle SUPPOSÉE seulement signalée, à vérifier au PLU.`);
        else refus.push(msg);
      } else if (enLimite && !ctx.surelevation) alertes.push(`Implantation EN LIMITE (limite ${i}) : mur sur la limite séparative — servitudes, mitoyenneté et accord du voisin à vérifier.`);
    }
  }
  if (!ctx.surelevation) {
    for (const b of [{ id: ctx.maison.id, anneau: ctx.maison.anneau }, ...ctx.autres]) {
      if (chevauche(rect, b.anneau)) refus.push(`L’extension chevauche ${b.id === ctx.maison.id ? 'la maison existante elle-même (décroché de l’emprise)' : `le bâtiment conservé ${b.id}`}.`);
    }
  }
  return { refus, reculs, alertes };
}

function habillageDefaut(forme: FormeToit, prolongement: boolean, h?: HabillageExtension): { facade: Donnee<string>; toiture: Donnee<string> } {
  return {
    facade: h?.facade ?? D('av-enduit-creme', 'supposee', 'même enduit neutre que l’existant, SUPPOSÉ (à choisir)'),
    toiture: h?.toiture ?? (forme === 'plat'
      ? D('av-membrane-sombre', 'supposee', 'toit plat : membrane d’étanchéité, SUPPOSÉE')
      : forme === 'monopente'
        ? D('av-zinc-anthracite', 'supposee', 'monopente faible pente : zinc, SUPPOSÉ')
        : D('av-tuiles-terre-cuite', 'supposee', prolongement ? 'prolongement : même couverture que l’existant (tuile SUPPOSÉE)' : 'tuile SUPPOSÉE')),
  };
}

/** Distance minimale de la maison existante aux limites sur voie (null sans voie). */
function distanceVoie(m: MaisonExistante, p: ParcelleMoteur | null, l: Limites | null): number | null {
  if (!p || !l) return null;
  let d: number | null = null;
  for (let i = 0; i < l.cat.length; i += 1) {
    if (l.cat[i] !== 'voie') continue;
    const v = distPolygoneSegment(m.anneau, p.contour[i]!, p.contour[(i + 1) % p.contour.length]!);
    d = d === null ? v : Math.min(d, v);
  }
  return d;
}

function surfaceParcelle(p: ParcelleMoteur | null): number | null {
  if (!p) return null;
  return p.surfaceM2 && p.surfaceM2 > 0 ? p.surfaceM2 : r2(Math.abs(aire(p.contour)));
}

type Sdp = Donnee<number> & { readonly minM2: number; readonly maxM2: number };

function surfacesDe(ctx: ContexteControle, type: TypeExtension, empriseCree: number, sdp: Sdp, refus: string[], diag: DiagnosticExtension[]): SurfacesExtension {
  const existante = r2(ctx.maison.empriseM2 + ctx.autres.reduce((s, b) => s + Math.abs(aire(b.anneau)), 0));
  const apres = r2(existante + empriseCree);
  const sp = surfaceParcelle(ctx.parcelle);
  const ces = ctx.regles.cesMax;
  let max: Donnee<number> | null = null;
  let residuelle: number | null = null;
  let controle: SurfacesExtension['controleCes'] = 'non-controle';
  if (ces && sp) {
    max = D(r2(ces.valeur * sp), ces.statut, `CES ${fr(ces.valeur * 100, 0)} % (${ces.source}) × parcelle ${fr(sp, 0)} m²`);
    residuelle = r2(max.valeur - existante);
    controle = apres <= max.valeur + 1e-6 ? 'ok' : 'depasse';
    if (controle === 'depasse') refus.push(`Emprise au sol : ${fr(apres, 1)} m² après travaux > ${fr(max.valeur, 1)} m² autorisés (${max.source}) ; emprise résiduelle ${fr(Math.max(0, residuelle), 1)} m².`);
    else diag.push({ code: 'ces', niveau: 'ok', message: `Emprise au sol : ${fr(apres, 1)} m² après travaux ≤ ${fr(max.valeur, 1)} m² (résiduelle avant extension ${fr(residuelle, 1)} m²).` });
  } else diag.push({ code: 'ces', niveau: 'info', message: `Emprise au sol après travaux ${fr(apres, 1)} m² : CES du PLU inconnu, emprise résiduelle NON CONTRÔLÉE.` });
  return {
    empriseCreeeM2: D(r2(empriseCree), 'estimee', type === 'surelevation' ? 'surélévation : emprise inchangée' : 'largeur × profondeur du volume posé'),
    surfacePlancherCreeeM2: sdp, empriseExistanteM2: existante, empriseApresM2: apres, surfaceParcelleM2: sp, empriseMaxM2: max, empriseResiduelleM2: residuelle, controleCes: controle,
  };
}

/** Coins d'un rectangle orienté. */
function coins(r: RectOriente): Pt[] {
  const a = r.longueur / 2, b = r.largeur / 2, vx = -r.uz, vz = r.ux;
  return [
    { x: r.cx - a * r.ux - b * vx, z: r.cz - a * r.uz - b * vz },
    { x: r.cx + a * r.ux - b * vx, z: r.cz + a * r.uz - b * vz },
    { x: r.cx + a * r.ux + b * vx, z: r.cz + a * r.uz + b * vz },
    { x: r.cx - a * r.ux + b * vx, z: r.cz - a * r.uz + b * vz },
  ].map((p) => ({ x: r3(p.x), z: r3(p.z) }));
}

function surelevation(e: EntreeMoteurExtension, ctx: ContexteControle, diag: DiagnosticExtension[], hyp: string[]): ResultatExtension {
  const { maison: m, demande: dem } = e;
  const regles = ctx.regles;
  const refus: string[] = [];
  const corps = m.corps[0]!;
  const hE = m.hauteurEgout.valeur;
  if (m.toit.forme.statut !== 'confirmee') {
    refus.push(`Surélévation refusée : la toiture existante (${m.toit.forme.valeur}, ${libelleStatutCourt(m.toit.forme.statut)}) n’est pas CONFIRMÉE. La surélévation REMPLACE cette toiture : confirmez d’abord sa forme et sa pente (« Confirmer la toiture »).`);
  }
  const niv = dem.dimensions.niveaux ?? D(1, 'supposee', '1 niveau ajouté, SUPPOSÉ');
  const hEtage = m.hauteurEgout.statut !== 'supposee' && m.niveaux.statut !== 'estimee' && m.niveaux.valeur > 0
    ? D(r2(Math.min(REGLES_EXTENSION.hauteurEtageMaxM, Math.max(REGLES_EXTENSION.hauteurEtageMinM, hE / m.niveaux.valeur))), 'estimee' as StatutDonnee, `égout existant ${fr(hE)} m / ${m.niveaux.valeur} niveau(x), borné 2,5–3,5 m`)
    : D(REGLES_EXTENSION.hauteurNiveauM, 'supposee' as StatutDonnee, '3 m par niveau SUPPOSÉS');
  const egout = D(r2(hE + niv.valeur * hEtage.valeur), 'estimee' as StatutDonnee, `égout existant ${fr(hE)} m + ${niv.valeur} × ${fr(hEtage.valeur)} m (${hEtage.source})`);
  const fd = dem.toiture?.forme;
  const forme: Donnee<FormeToit> = !fd || fd.valeur === 'prolongement' ? D(m.toit.forme.valeur, m.toit.forme.statut, 'même forme que la toiture existante') : (fd as Donnee<FormeToit>);
  const pente = forme.valeur === 'plat' ? D(0, forme.statut, 'toit plat') : dem.toiture?.penteDeg ?? D(m.toit.penteDeg.valeur, m.toit.penteDeg.statut, 'même pente que la toiture existante');
  const larg = m.toit.orientation.valeur === 'grand-axe' ? corps.largeur : corps.longueur;
  const hToit = hauteurToiture(forme.valeur, larg, pente.valeur);
  const hMax = D(r2(egout.valeur + hToit), egout.statut, `égout ${fr(egout.valeur)} m + toiture ${forme.valeur} ${fr(hToit)} m`);
  if (regles.hauteurMaxM && hMax.valeur > regles.hauteurMaxM.valeur + 1e-6) refus.push(`Hauteur ${fr(hMax.valeur)} m > hauteur maximale ${fr(regles.hauteurMaxM.valeur)} m (${regles.hauteurMaxM.source}).`);
  else if (!regles.hauteurMaxM) diag.push({ code: 'hauteur', niveau: 'info', message: `Hauteur après surélévation ${fr(hMax.valeur)} m : hauteur maximale du PLU inconnue, NON CONTRÔLÉE.` });
  const empreinte = coins(corps);
  const ctl = controler(ctx, empreinte, hMax.valeur);
  refus.push(...ctl.refus);
  for (const a of ctl.alertes) diag.push({ code: 'recul', niveau: 'alerte', message: a });
  const parNiveau = Math.max(0, corps.longueur * corps.largeur - 2 * (corps.longueur + corps.largeur) * REGLES_EXTENSION.murNeufM);
  const v = Math.max(0, niv.valeur * parNiveau - REGLES_EXTENSION.tremieM2);
  const sdp: Sdp = { ...D(Math.round(v * 10) / 10, 'estimee' as StatutDonnee, `${niv.valeur} niveau(x) × (corps ${fr(corps.longueur, 1)} × ${fr(corps.largeur, 1)} m − murs 0,25 m SUPPOSÉS) − 3 m² de trémie SUPPOSÉE`), minM2: Math.round(v * (1 - REGLES_EXTENSION.incertitude)), maxM2: Math.round(v * (1 + REGLES_EXTENSION.incertitude)) };
  const surfaces = surfacesDe(ctx, 'surelevation', 0, sdp, refus, diag);
  if (m.corps.length > 1) hyp.push(`Surélévation du seul corps principal (${fr(corps.longueur, 1)} × ${fr(corps.largeur, 1)} m) ; les ${m.corps.length - 1} autre(s) corps gardent leur toiture.`);
  const ax = m.toit.orientation.valeur === 'grand-axe' ? { dx: corps.ux, dz: corps.uz } : { dx: -corps.uz, dz: corps.ux };
  const volume: VolumeExtension = {
    type: 'surelevation', empreinte, baseM: r2(m.baseM + hE),
    largeurM: D(corps.longueur, 'estimee', 'corps principal (BD TOPO)'), profondeurM: D(corps.largeur, 'estimee', 'corps principal (BD TOPO)'),
    niveaux: niv, hauteurEgoutM: egout, hauteurMaxM: hMax,
    toiture: { forme, penteDeg: pente, ...ax, prolongement: false },
    habillage: habillageDefaut(forme.valeur, false, e.options?.habillage),
    corpsSureleve: corps,
  };
  diag.push({ code: 'toiture-existante', niveau: refus.length ? 'refus' : 'info', message: 'La toiture existante du corps principal est REMPLACÉE : patch de confirmation nommant la maison existante (verrou levé pour ce seul bâtiment).' });
  return { ok: refus.length === 0, type: 'surelevation', existantId: m.id, refus, diagnostics: diag, facade: null, volume, reculs: ctl.reculs, surfaces, hypotheses: hyp, suggestion: null, remplaceToitureExistante: true };
}

/** Le moteur. Pur et déterministe. */
export function calculerExtension(e: EntreeMoteurExtension): ResultatExtension {
  const { maison: m, demande: dem } = e;
  const opts = e.options ?? {};
  const regles = e.regles ?? {};
  const refus: string[] = [];
  const diag: DiagnosticExtension[] = [];
  const hyp: string[] = [];
  const type = dem.type;
  const vide = (raisons: string[]): ResultatExtension => ({ ok: false, type, existantId: m.id, refus: raisons, diagnostics: diag, facade: null, volume: null, reculs: [], surfaces: null, hypotheses: hyp, suggestion: null, remplaceToitureExistante: false });

  if (dem.existantId !== m.id) return vide([`La demande vise le bâtiment ${dem.existantId}, pas ${m.id}.`]);
  if (type === 'veranda') return vide(['Véranda : non encore produite par le moteur (volume vitré, lot X2b). Choisissez latérale, arrière, garage ou surélévation.']);

  const limites = e.parcelle && e.parcelle.contour.length >= 3 ? classerLimites(e.parcelle) : null;
  if (!limites) diag.push({ code: 'parcelle', niveau: 'alerte', message: 'Parcelle inconnue : reculs, emprise au sol et débord hors parcelle NON CONTRÔLÉS.' });
  const ctx: ContexteControle = {
    parcelle: limites ? e.parcelle : null, limites, regles, demande: dem, maison: m, autres: opts.autresBatiments ?? [],
    distanceMaisonVoieM: distanceVoie(m, e.parcelle, limites), surelevation: type === 'surelevation',
  };
  if (type === 'surelevation') return surelevation(e, ctx, diag, hyp);

  /* ---------------- Latérale, arrière, garage ---------------- */
  const hEgoutExistant = m.hauteurEgout.valeur;
  const dims = dem.dimensions;
  if (!dem.facade) return vide([`Extension ${type} : la façade d’accroche (rue, arrière, gauche, droite) est obligatoire.`]);
  let rue: Rue | null = limites?.rue ?? null;
  if (!rue) {
    const a = dem.facade.arete;
    if (typeof a !== 'number' || !Number.isInteger(a) || a < 0 || a >= m.anneau.length) {
      return vide(['Côté rue inconnu (aucune limite classée voie sur la parcelle) : impossible de dire où sont la gauche, la droite et l’arrière. Classez la limite sur rue, ou désignez l’arête de la façade.']);
    }
    // Sans rue, seule l'arête désignée vaut : on reconstruit une « rue » telle que cette arête regarde le côté demandé.
    const ns = normaleSortante(m.anneau, a);
    const c = dem.facade.cote;
    rue = c === 'rue' ? { nx: ns.nx, nz: ns.nz } : c === 'arriere' ? { nx: -ns.nx, nz: -ns.nz } : c === 'gauche' ? { nx: ns.nz, nz: -ns.nx } : { nx: -ns.nz, nz: ns.nx };
    diag.push({ code: 'rue', niveau: 'alerte', message: 'Côté rue inconnu : la façade est l’arête désignée, sans contrôle du côté.' });
  }
  const f = choisirFacade(m, dem.facade.cote, dem.facade.arete, rue, diag);
  if (!f) return vide([`Aucune façade de la maison ne regarde le côté « ${dem.facade.cote} » (± 45°) : désignez l’arête.`]);
  diag.push({ code: 'facade', niveau: 'info', message: `Façade d’accroche : ${f.source}, ${fr(f.longueurM)} m.` });

  const garage = type === 'garage';
  const formeDemandee = dem.toiture?.forme;
  const formeBrute: FormeToitExtension = formeDemandee?.valeur ?? 'plat';
  const formeStatut: StatutDonnee = formeDemandee?.statut ?? 'supposee';
  if (!formeDemandee) hyp.push('Toiture de l’extension non demandée : toit plat SUPPOSÉ.');
  const prolongement = formeBrute === 'prolongement' || formeBrute === 'deux-pans';
  if (formeBrute === 'quatre-pans') return vide(['Toiture 4 pans : non produite pour une extension (raccord de croupes non déterministe). Choisissez plat, monopente adossé ou 2 pans dans le prolongement.']);
  if (garage && prolongement) return vide(['Garage : toit plat ou monopente seulement (garage simple de plain-pied).']);

  // Hauteurs
  const sup = garage ? REGLES_EXTENSION.dimensionsSupposees.garage : type === 'arriere' ? REGLES_EXTENSION.dimensionsSupposees.arriere : dem.facade.cote === 'rue' ? REGLES_EXTENSION.dimensionsSupposees.rue : REGLES_EXTENSION.dimensionsSupposees.laterale;
  let niveaux: Donnee<number>;
  let egout: Donnee<number>;
  if (garage) {
    if (dims.niveaux && dims.niveaux.valeur > 1) return vide(['Garage : plain-pied seulement (1 niveau).']);
    niveaux = D(1, 'confirmee', 'garage de plain-pied');
    egout = dims.hauteurEgoutM ?? D(REGLES_EXTENSION.egoutGarageM, 'supposee', 'garage : 2,8 m SUPPOSÉS');
  } else if (opts.memeHauteur) {
    niveaux = D(m.niveaux.valeur, m.niveaux.statut, `même nombre de niveaux que l’existant (${m.niveaux.source})`);
    egout = D(hEgoutExistant, m.hauteurEgout.statut, `même hauteur à l’égout que l’existant (${m.hauteurEgout.source})`);
  } else {
    niveaux = dims.niveaux ?? D(1, 'supposee', 'plain-pied SUPPOSÉ');
    egout = dims.hauteurEgoutM ?? (dims.niveaux ? D(dims.niveaux.valeur * REGLES_EXTENSION.hauteurNiveauM, 'estimee', `${dims.niveaux.valeur} niveau(x) × 3 m`) : D(REGLES_EXTENSION.egoutPlainPiedM, 'supposee', 'plain-pied : 3 m SUPPOSÉS'));
  }
  if (egout.valeur > hEgoutExistant + REGLES_EXTENSION.toleranceEgoutM) {
    return vide([`Hauteur à l’égout ${fr(egout.valeur)} m > égout de la maison existante ${fr(hEgoutExistant)} m (${libelleStatutCourt(m.hauteurEgout.statut)}) : par défaut l’extension reste sous l’égout existant. Réduisez la hauteur ou cochez « même hauteur ».`]);
  }
  const hMin = garage ? REGLES_EXTENSION.hauteurMinGarageM : REGLES_EXTENSION.hauteurMinM;

  // Dimensions
  let largeur: Donnee<number> | null = dims.largeurM ?? null;
  let profondeur: Donnee<number> | null = dims.profondeurM ?? null;
  const S = dims.surfacePlancherM2;
  if (S && !largeur && !profondeur) {
    profondeur = D(sup.profondeurM, 'supposee', `${sup.profondeurM} m SUPPOSÉS`);
    largeur = D(r2(S.valeur / niveaux.valeur / sup.profondeurM), 'estimee', `surface demandée ${fr(S.valeur, 0)} m² / ${niveaux.valeur} niveau(x) / profondeur`);
  } else if (S && largeur && !profondeur) profondeur = D(r2(S.valeur / niveaux.valeur / largeur.valeur), 'estimee', 'surface demandée / largeur');
  else if (S && !largeur && profondeur) largeur = D(r2(S.valeur / niveaux.valeur / profondeur.valeur), 'estimee', 'surface demandée / profondeur');
  if (!largeur) { largeur = D(Math.min(sup.largeurM, f.longueurM), 'supposee', `${fr(Math.min(sup.largeurM, f.longueurM), 1)} m SUPPOSÉS (≤ façade)`); hyp.push(`Largeur de l’extension non demandée : ${largeur.source}.`); }
  if (!profondeur) { profondeur = D(sup.profondeurM, 'supposee', `${sup.profondeurM} m SUPPOSÉS`); hyp.push(`Profondeur de l’extension non demandée : ${profondeur.source}.`); }

  // Toiture
  const corps = m.corps[0]!;
  const ridge = m.toit.orientation.valeur === 'grand-axe' ? { x: corps.ux, z: corps.uz } : { x: -corps.uz, z: corps.ux };
  const largPignon = m.toit.orientation.valeur === 'grand-axe' ? corps.largeur : corps.longueur;
  let penteToit: Donnee<number>;
  let formeToit: Donnee<FormeToit>;
  let rectFixe: Pt[] | null = null;
  if (prolongement) {
    const raisons: string[] = [];
    if (m.toit.forme.valeur !== 'deux-pans') raisons.push(`la toiture existante est « ${m.toit.forme.valeur} » (2 pans requis)`);
    const L = Math.hypot(f.b.x - f.a.x, f.b.z - f.a.z) || 1;
    const ex = (f.b.x - f.a.x) / L, ez = (f.b.z - f.a.z) / L;
    const surPignon = Math.abs(ex * ridge.x + ez * ridge.z) < Math.sin(10 * RAD);
    const mx = (f.a.x + f.b.x) / 2, mz = (f.a.z + f.b.z) / 2;
    const s = (mx - corps.cx) * ridge.x + (mz - corps.cz) * ridge.z;
    const demiL = (m.toit.orientation.valeur === 'grand-axe' ? corps.longueur : corps.largeur) / 2;
    if (!surPignon) raisons.push('la façade choisie n’est pas un pignon du corps principal (elle est parallèle au faîtage)');
    else if (Math.abs(Math.abs(s) - demiL) > 0.3) raisons.push('la façade choisie n’est pas l’about du corps principal');
    if (dims.largeurM && Math.abs(dims.largeurM.valeur - largPignon) > REGLES_EXTENSION.toleranceLargeurPignonM) raisons.push(`largeur ${fr(dims.largeurM.valeur)} m ≠ largeur du pignon ${fr(largPignon)} m (± 0,15 m)`);
    if (Math.abs(egout.valeur - hEgoutExistant) > REGLES_EXTENSION.toleranceEgoutM) raisons.push(`hauteur à l’égout ${fr(egout.valeur)} m ≠ égout existant ${fr(hEgoutExistant)} m (cochez « même hauteur »)`);
    if (dem.toiture?.penteDeg && Math.abs(dem.toiture.penteDeg.valeur - m.toit.penteDeg.valeur) > REGLES_EXTENSION.tolerancePenteDeg) raisons.push(`pente ${fr(dem.toiture.penteDeg.valeur, 0)}° ≠ pente existante ${fr(m.toit.penteDeg.valeur, 0)}°`);
    if (raisons.length) return vide([`2 pans dans le prolongement refusés : ${raisons.join(' ; ')}. Choisissez un toit plat ou un monopente adossé.`]);
    if (m.toit.forme.statut !== 'confirmee') diag.push({ code: 'toiture-existante', niveau: 'alerte', message: `Prolongement d’une toiture existante ${libelleStatutCourt(m.toit.forme.statut)} : confirmez la toiture existante.` });
    largeur = D(r2(largPignon), 'estimee', 'largeur du pignon du corps principal');
    penteToit = D(m.toit.penteDeg.valeur, m.toit.penteDeg.statut, 'même pente que la toiture existante');
    formeToit = D('deux-pans', formeStatut, 'prolongement de la toiture existante');
    // Rectangle calé sur le corps (même largeur, même axe de faîtage) : prolongement exact.
    const sgn = s >= 0 ? 1 : -1;
    const vx = -ridge.z, vz = ridge.x;
    const cx = corps.cx + ridge.x * sgn * demiL, cz = corps.cz + ridge.z * sgn * demiL;
    const b = largPignon / 2, P0 = profondeur.valeur;
    rectFixe = [
      { x: cx - vx * b, z: cz - vz * b }, { x: cx + vx * b, z: cz + vz * b },
      { x: cx + vx * b + ridge.x * sgn * P0, z: cz + vz * b + ridge.z * sgn * P0 }, { x: cx - vx * b + ridge.x * sgn * P0, z: cz - vz * b + ridge.z * sgn * P0 },
    ].map((p) => ({ x: r3(p.x), z: r3(p.z) }));
  } else {
    formeToit = D(formeBrute as FormeToit, formeStatut, formeDemandee?.source ?? 'toit plat SUPPOSÉ');
    penteToit = formeBrute === 'plat' ? D(0, formeStatut, 'toit plat') : dem.toiture?.penteDeg ?? D(REGLES_EXTENSION.penteMonopenteDeg, 'supposee', 'monopente : 15° SUPPOSÉS');
  }
  if (!opts.depasserFacade && !prolongement && largeur.valeur > f.longueurM + 0.01) {
    return vide([`Largeur ${fr(largeur.valeur)} m > façade d’accroche ${fr(f.longueurM)} m : par défaut l’extension ne dépasse pas la façade (cochez « dépasser la façade » pour une demande explicite).`]);
  }

  // Monopente adossé : le haut reste sous l'égout existant.
  const tanP = Math.tan(penteToit.valeur * RAD);
  if (formeToit.valeur === 'monopente') {
    const haut = egout.valeur + profondeur.valeur * tanP;
    if (haut > hEgoutExistant + REGLES_EXTENSION.toleranceEgoutM) {
      const abaisse = r2(hEgoutExistant - profondeur.valeur * tanP);
      if (abaisse < hMin) return vide([`Monopente adossé : à ${fr(penteToit.valeur, 0)}° sur ${fr(profondeur.valeur)} m, le haut (${fr(haut)} m) dépasse l’égout existant (${fr(hEgoutExistant)} m) et l’égout abaissé (${fr(abaisse)} m) serait sous ${fr(hMin)} m. Réduisez la pente ou la profondeur, ou prenez un toit plat.`]);
      diag.push({ code: 'monopente', niveau: 'alerte', message: `Monopente adossé : égout abaissé de ${fr(egout.valeur)} à ${fr(abaisse)} m pour que le haut reste sous l’égout existant (${fr(hEgoutExistant)} m).` });
      egout = D(abaisse, 'estimee', `abaissé pour un monopente adossé sous l’égout existant (${egout.source})`);
    }
  }
  if (egout.valeur < hMin - 1e-6) return vide([`Hauteur à l’égout ${fr(egout.valeur)} m < ${fr(hMin)} m minimum (${garage ? 'garage' : 'pièce de vie : 2,2 m sous plafond + plancher et toiture'}).`]);
  const hToit = formeToit.valeur === 'plat' ? 0 : formeToit.valeur === 'monopente' ? profondeur.valeur * tanP : hauteurToiture('deux-pans', largeur.valeur, penteToit.valeur);
  const hMax = D(r2(egout.valeur + hToit), egout.statut, formeToit.valeur === 'plat' ? 'toit plat : acrotère à l’égout' : `égout + toiture ${formeToit.valeur} ${fr(hToit)} m`);
  if (regles.hauteurMaxM && hMax.valeur > regles.hauteurMaxM.valeur + 1e-6) return vide([`Hauteur ${fr(hMax.valeur)} m > hauteur maximale ${fr(regles.hauteurMaxM.valeur)} m (${regles.hauteurMaxM.source}).`]);

  // Positions candidates le long de la façade (ordre fixe).
  const Lf = Math.hypot(f.b.x - f.a.x, f.b.z - f.a.z);
  const W = largeur.valeur, P = profondeur.valeur;
  const finA = 0, finB = Math.max(0, Lf - W), centre = Math.max(0, (Lf - W) / 2);
  const r0 = rue;
  const versRue = (p: Pt): number => p.x * r0.nx + p.z * r0.nz;
  const aCoteRue = versRue(f.a) >= versRue(f.b);
  const g = directionCote('gauche', rue);
  const debutGauche = f.a.x * g.x + f.a.z * g.z >= f.b.x * g.x + f.b.z * g.z;
  const lateral = dem.facade.cote === 'gauche' || dem.facade.cote === 'droite';
  const ordre: { t0: number; nom: string }[] = rectFixe
    ? [{ t0: 0, nom: 'prolongement du corps principal (même largeur, même axe)' }]
    : lateral
      ? [{ t0: aCoteRue ? finA : finB, nom: 'alignée sur l’angle côté rue' }, { t0: aCoteRue ? finB : finA, nom: 'alignée sur l’angle arrière' }, { t0: centre, nom: 'centrée sur la façade' }]
      : [{ t0: centre, nom: 'centrée sur la façade' }, { t0: debutGauche ? finA : finB, nom: 'alignée sur l’angle gauche' }, { t0: debutGauche ? finB : finA, nom: 'alignée sur l’angle droit' }];
  let retenu: { rect: Pt[]; nom: string; ctl: ReturnType<typeof controler>; t0: number } | null = null;
  let premier: { rect: Pt[]; nom: string; ctl: ReturnType<typeof controler>; t0: number } | null = null;
  const vus = new Set<number>();
  for (const o of ordre) {
    const k = Math.round(o.t0 * 1000);
    if (vus.has(k)) continue;
    vus.add(k);
    const rect = rectFixe ?? rectangleContre(f, o.t0, W, P);
    const ctl = controler(ctx, rect, hMax.valeur);
    const c = { rect, nom: o.nom, ctl, t0: o.t0 };
    if (!premier) premier = c;
    if (ctl.refus.length === 0) { retenu = c; break; }
  }
  const choisi = retenu ?? premier!;
  diag.push({ code: 'position', niveau: retenu ? 'info' : 'refus', message: `Position : ${choisi.nom}${retenu ? '' : ' (aucune position ne respecte tout ; diagnostic de la première)'}.` });
  refus.push(...choisi.ctl.refus);
  for (const a of choisi.ctl.alertes) diag.push({ code: 'recul', niveau: 'alerte', message: a });
  for (const r of choisi.ctl.reculs) if (r.ok) diag.push({ code: 'recul', niveau: 'ok', message: `Recul ${r.categorie === 'voie' ? 'à la voie' : r.categorie === 'fond' ? 'au fond' : 'séparatif'} (limite ${r.limite}) : ${fr(r.distanceM)} m ≥ ${fr(r.minimumM)} m — ${r.libelle}.` });

  // Profondeur maximale (même façade, première position) si refusé.
  let suggestion: ResultatExtension['suggestion'] = null;
  if (!retenu && !rectFixe && premier) {
    const t0 = premier.t0;
    const passe = (p: number): boolean => controler(ctx, rectangleContre(f, t0, W, p), formeToit.valeur === 'monopente' ? egout.valeur + p * tanP : hMax.valeur).refus.length === 0;
    if (passe(0.5)) {
      let lo = 0.5, hi = P;
      for (let k = 0; k < 20; k += 1) { const mid = (lo + hi) / 2; if (passe(mid)) lo = mid; else hi = mid; }
      suggestion = { profondeurMaxM: Math.floor(lo * 20) / 20 };
      diag.push({ code: 'suggestion', niveau: 'info', message: `À cette position, une profondeur de ${fr(suggestion.profondeurMaxM)} m au plus passerait.` });
    } else diag.push({ code: 'suggestion', niveau: 'info', message: 'À cette position, même 0,5 m de profondeur ne passerait pas.' });
  }

  // Surfaces créées.
  const emprise = W * P;
  let sdp: Sdp;
  if (garage) sdp = { ...D(0, 'estimee' as StatutDonnee, 'garage : surface de stationnement déduite de la surface de plancher (code de l’urbanisme, art. R.111-22)'), minM2: 0, maxM2: 0 };
  else {
    const parNiveau = Math.max(0, emprise - (2 * P + W) * REGLES_EXTENSION.murNeufM);
    const v = Math.max(0, niveaux.valeur * parNiveau - Math.max(0, niveaux.valeur - 1) * REGLES_EXTENSION.tremieM2);
    sdp = { ...D(Math.round(v * 10) / 10, 'estimee' as StatutDonnee, `${niveaux.valeur} niveau(x) × (emprise ${fr(emprise, 1)} m² − 3 murs neufs × 0,25 m SUPPOSÉS)`), minM2: Math.round(v * (1 - REGLES_EXTENSION.incertitude)), maxM2: Math.round(v * (1 + REGLES_EXTENSION.incertitude)) };
  }
  const surfaces = surfacesDe(ctx, type, emprise, sdp, refus, diag);

  // Direction de la toiture : monopente = pente descendante sortante ; 2 pans = axe du faîtage.
  const tdir = prolongement ? { dx: ridge.x, dz: ridge.z } : { dx: f.nx, dz: f.nz };
  const volume: VolumeExtension = {
    type, empreinte: choisi.rect, baseM: m.baseM, largeurM: largeur, profondeurM: profondeur, niveaux, hauteurEgoutM: egout, hauteurMaxM: hMax,
    toiture: { forme: formeToit, penteDeg: penteToit, ...tdir, prolongement },
    habillage: habillageDefaut(formeToit.valeur, prolongement, opts.habillage),
  };
  return { ok: refus.length === 0, type, existantId: m.id, refus, diagnostics: diag, facade: f, volume, reculs: choisi.ctl.reculs, surfaces, hypotheses: hyp, suggestion, remplaceToitureExistante: false };
}

/** Parcelle du moteur depuis la parcelle du projet Studio (classement PUB1, sinon segment de la rue PA2). Pur. */
export function parcelleMoteurDepuisProjet(
  p: {
    readonly contour: readonly Pt[];
    readonly surfaceM2?: number;
    readonly rue?: { readonly segment: number };
    readonly limites?: readonly { readonly segment: number; readonly categorie: string }[];
  } | undefined | null,
): ParcelleMoteur | null {
  if (!p || p.contour.length < 3) return null;
  const cat: (CategorieLimite | null)[] = p.contour.map(() => null);
  for (const l of p.limites ?? []) {
    if (l.segment < 0 || l.segment >= cat.length) continue;
    cat[l.segment] = l.categorie === 'public-road' || l.categorie === 'private-road' ? 'voie' : l.categorie === 'rear' ? 'fond' : l.categorie === 'lateral' || l.categorie === 'neighbor' ? 'separative' : null;
  }
  return { contour: p.contour, surfaceM2: p.surfaceM2 && p.surfaceM2 > 0 ? p.surfaceM2 : null, categories: cat, segmentRue: p.rue?.segment ?? null };
}
