// supabase/functions/_shared/extension/maisonExistante.ts
// COPIE (lot X3, 14/11/2026) de mimmozia-studio/src/core/extension/maisonExistante.ts @ 0d3a044 (sha256 du fichier source : 9f747b0805ed5f4b41e33ed448c3e2fbb679fbb4c4ff92a421807632674b63a7).
// Copie PARTIELLE : estimation seulement (règles R0–R4, hauteurs, niveaux, surface de plancher, triangles, maisonPrincipale). Retirés : la partie Scene Graph (noeudMaisonExistante, patchAjoutExistant, patchConfirmationExistant) et ses imports, sans objet côté site ; chemins d'import suffixés « .ts ». Aucune règle modifiée.
// Le Studio fait foi : toute évolution du contrat se fait d'abord dans le Studio, puis est recopiée ici.
// ----- DÉBUT DE LA COPIE -----
/**
 * MAISON EXISTANTE MODÉLISÉE (lot X1, 13/11/2026). Module PUR et déterministe.
 *
 * Un bâtiment BD TOPO situé sur la parcelle devient, quand le projet le CONSERVE (extension), un bâtiment VERROUILLÉ
 * du Scene Graph, posé par `SceneGraphPatch` (src/core/scene/patch.ts) : murs = emprise BD TOPO exacte extrudée à la
 * hauteur à l'égout ; toiture = forme ESTIMÉE par des règles écrites ci-dessous, avec un niveau de confiance, et
 * remplaçable par la saisie de l'utilisateur (statut « confirmée »). Rien n'est placé par un LLM ; aucune valeur n'est
 * donnée sans son statut (mesurée / estimée / supposée / confirmée).
 *
 * CONSTAT (essais réels du 11–12/11, output/photomontage-rue/*\/bdtopo.json) : `altitude_maximale_toit` n'est publiée
 * pour AUCUN des 320 bâtiments reçus à Montfermeil (P0646, O0521) et Montreuil (AS0249), et pour 3 sur 14 à Trappes.
 * Le faîtage des pavillons est donc presque toujours ESTIMÉ (pente SUPPOSÉE) : la confirmation par l'utilisateur
 * n'est pas un luxe, c'est la règle.
 *
 * RÈGLES (dans l'ordre ; la première qui s'applique gagne) — forme du toit :
 *   R0  saisie de l'utilisateur (forme, pente, hauteurs, orientation) → « confirmée », confiance haute ;
 *   R1  altitudes min ET max du toit publiées (MESURÉ, prime sur toute supposition) : écart < 1 m → plat (estimé) ;
 *       écart ≥ 1 m → toit à pentes (estimé), 4 pans si le corps principal est quasi carré (longueur / largeur < 1,2),
 *       sinon 2 pans ; pente déduite de l'écart et de la demi-largeur du corps principal ; confiance moyenne si
 *       l'emprise est bien décrite par ses corps rectangulaires (couverture ≥ 85 %), sinon faible ;
 *   R2  construction légère BD TOPO (abri, appentis, carport) sans altitudes de toit → plat, SUPPOSÉ (pente faible
 *       assimilée à plat), faible ;
 *   R3  faîtage non publié, bâtiment collectif ou épais (≥ 4 niveaux, ou égout ≥ 11 m, ou corps principal > 14 m de
 *       large) → plat, SUPPOSÉ, faible ;
 *   R4  faîtage non publié, cas pavillonnaire → 2 pans (4 pans si quasi carré), pente 35° SUPPOSÉE (même hypothèse
 *       que l'effacement P5-BIS, `TOITURE_SUPPOSEE`), hauteur de toiture bornée à [1 ; 6] m, faible.
 *   Monopente : jamais choisie automatiquement (indiscernable d'un 2 pans avec les seules altitudes) — saisie seule.
 *   Faîtage : parallèle au GRAND axe de chaque corps (« estimé » si longueur / largeur ≥ 1,2, sinon « supposé »).
 *
 * Hauteur à l'égout (au-dessus du pied) : `hauteur` BD TOPO (mesurée) → `altitude_minimale_toit − altitude_minimale_sol`
 * (mesurée) → `nombre_d_etages` × 3 m (estimée) → BDNB `nb_niveau` × 3 m (estimée) → 3 m si légère, sinon 6 m (SUPPOSÉE).
 *
 * Surface de plancher existante (ESTIMÉE, jamais réglementaire) : niveaux × (emprise − périmètre × 0,25 m de murs
 * SUPPOSÉS) − 3 m² de trémie d'escalier SUPPOSÉE par niveau au-dessus du rez-de-chaussée ; fourchette ± 15 % ;
 * combles aménagés et sous-sol NON comptés (inconnus). Niveaux : BD TOPO `nombre_d_etages` (mesuré), sinon BDNB
 * `nb_niveau` (mesuré, source CSTB), sinon arrondi(égout / 3 m) (estimé). La BDNB ne publie pas de surface de plancher :
 * elle n'apporte ici que des niveaux (et une emprise, non utilisée : l'emprise BD TOPO est celle qu'on dessine).
 */
import type { DonneesBdnb, Donnee, FormeToit, OrientationFaitage, StatutDonnee } from './contrat.ts';
import {
  aire,
  coinsRect,
  decomposerEnCorps,
  hauteurToiture,
  perimetre,
  rectangleOriente,
  trianglesPrismeVertical,
  trianglesToiture,
  type Pt,
  type RectOriente,
} from './geometrie.ts';

/** Règles chiffrées (toutes SUPPOSÉES sauf mention) — exportées pour les tests et la documentation. */
export const REGLES_TOIT = {
  /** Même seuil que `volumes.ts` (voisinage) : sous 1 m d'écart entre altitudes du toit, toit plat. */
  ecartPlatM: 1,
  rapportQuasiCarre: 1.2,
  /** = `TOITURE_SUPPOSEE` de src/core/effacement/masque.ts (lot P5-BIS) ; un test vérifie l'égalité. */
  penteSupposeeDeg: 35,
  hauteurToitMinM: 1,
  hauteurToitMaxM: 6,
  collectifNiveaux: 4,
  collectifEgoutM: 11,
  largeurPlatM: 14,
  couvertureBonne: 0.85,
  penteVraisemblable: [10, 60] as const,
} as const;

export const REGLES_HAUTEUR = { parNiveauM: 3, legereM: 3, defautM: 6, ecartAlerteM: 1 } as const;
export const REGLES_SURFACE = { epaisseurMursM: 0.25, tremieM2: 3, incertitude: 0.15 } as const;

export type Confiance = 'haute' | 'moyenne' | 'faible';

/** Entrée : un bâtiment BD TOPO dans le repère de scène. */
export interface EntreeExistant {
  readonly id: string;
  readonly anneau: readonly Pt[];
  /** Pied dans la scène (m). 0 par défaut (le bâtiment de la parcelle définit le niveau du terrain). */
  readonly baseM?: number;
  readonly hauteurM: number | null;
  readonly etages: number | null;
  readonly altitudeSolM: number | null;
  readonly altitudeToitMinM: number | null;
  readonly altitudeToitMaxM: number | null;
  readonly legere: boolean;
  readonly usage: string | null;
  readonly bdnb?: DonneesBdnb;
}

/** Corrections / confirmations de l'utilisateur (toutes facultatives). Hauteurs au-dessus du pied, m. */
export interface SurchargesExistant {
  readonly formeToit?: FormeToit;
  readonly penteDeg?: number;
  readonly hauteurEgoutM?: number;
  readonly hauteurFaitageM?: number;
  readonly orientationFaitage?: OrientationFaitage;
  readonly niveaux?: number;
  readonly surfacePlancherM2?: number;
}

export interface ToitEstime {
  readonly forme: Donnee<FormeToit>;
  readonly penteDeg: Donnee<number>;
  readonly orientation: Donnee<OrientationFaitage>;
  readonly confiance: Confiance;
  /** Règle appliquée (R0…R4) et sa phrase. */
  readonly regle: string;
}

export interface MaisonExistante {
  readonly id: string;
  readonly anneau: readonly Pt[];
  readonly baseM: number;
  readonly empriseM2: number;
  readonly perimetreM: number;
  readonly rectangle: RectOriente;
  /** Corps rectangulaires portant les toitures (le premier = corps principal). */
  readonly corps: readonly RectOriente[];
  readonly couverture: number;
  readonly hauteurEgout: Donnee<number>;
  readonly hauteurFaitage: Donnee<number>;
  readonly toit: ToitEstime;
  readonly niveaux: Donnee<number>;
  readonly surfacePlancher: Donnee<number> & { readonly minM2: number; readonly maxM2: number };
  readonly hypotheses: readonly string[];
  readonly avertissements: readonly string[];
  readonly verrouille: true;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const fr = (v: number, d = 1): string => v.toFixed(d).replace('.', ',');
const ok = (v: number | null | undefined, min = 0): v is number => typeof v === 'number' && Number.isFinite(v) && v > min;
const D = <T,>(valeur: T, statut: StatutDonnee, source: string): Donnee<T> => ({ valeur, statut, source });

function egout(e: EntreeExistant, s: SurchargesExistant, avert: string[]): Donnee<number> {
  if (ok(s.hauteurEgoutM)) return D(r2(s.hauteurEgoutM), 'confirmee', 'saisie utilisateur');
  const parAlt = ok(e.altitudeToitMinM) && ok(e.altitudeSolM) && e.altitudeToitMinM > e.altitudeSolM ? e.altitudeToitMinM - e.altitudeSolM : null;
  if (ok(e.hauteurM, 0.5) && e.hauteurM < 200) {
    if (parAlt !== null && Math.abs(parAlt - e.hauteurM) > REGLES_HAUTEUR.ecartAlerteM) {
      avert.push(`BD TOPO incohérente : hauteur ${fr(e.hauteurM)} m mais altitudes toit min − sol = ${fr(parAlt)} m ; la hauteur publiée est retenue.`);
    }
    return D(r2(e.hauteurM), 'mesuree', 'BD TOPO « hauteur » (sol → gouttière)');
  }
  if (parAlt !== null && parAlt > 0.5) return D(r2(parAlt), 'mesuree', 'BD TOPO altitude minimale du toit − altitude minimale du sol');
  if (ok(e.etages, 0) && e.etages >= 1) return D(e.etages * REGLES_HAUTEUR.parNiveauM, 'estimee', `BD TOPO ${e.etages} étage(s) × ${fr(REGLES_HAUTEUR.parNiveauM, 0)} m`);
  if (ok(e.bdnb?.nbNiveaux, 0)) return D(e.bdnb!.nbNiveaux! * REGLES_HAUTEUR.parNiveauM, 'estimee', `BDNB ${e.bdnb!.nbNiveaux} niveau(x) × ${fr(REGLES_HAUTEUR.parNiveauM, 0)} m`);
  if (e.legere) return D(REGLES_HAUTEUR.legereM, 'supposee', 'construction légère sans hauteur publiée : 3 m SUPPOSÉS');
  return D(REGLES_HAUTEUR.defautM, 'supposee', 'aucune hauteur publiée (BD TOPO, BDNB) : 6 m SUPPOSÉS (pavillon R+1)');
}

function niveaux(e: EntreeExistant, s: SurchargesExistant, hEgout: number): Donnee<number> {
  if (ok(s.niveaux) && Number.isInteger(s.niveaux)) return D(s.niveaux, 'confirmee', 'saisie utilisateur');
  if (ok(e.etages) && e.etages >= 1) return D(Math.round(e.etages), 'mesuree', 'BD TOPO « nombre_d_etages » (compté rez-de-chaussée compris — à vérifier)');
  if (ok(e.bdnb?.nbNiveaux)) return D(Math.round(e.bdnb!.nbNiveaux!), 'mesuree', 'BDNB « nb_niveau » (CSTB)');
  return D(Math.max(1, Math.round(hEgout / REGLES_HAUTEUR.parNiveauM)), 'estimee', `arrondi(hauteur à l’égout ${fr(hEgout)} m / ${fr(REGLES_HAUTEUR.parNiveauM, 0)} m)`);
}

/** Estimation complète de la maison existante. Pur et déterministe. */
export function estimerMaisonExistante(e: EntreeExistant, s: SurchargesExistant = {}): MaisonExistante {
  const hyp: string[] = [];
  const avert: string[] = [];
  const anneau = e.anneau;
  const empriseM2 = r2(Math.abs(aire(anneau)));
  const perimetreM = r2(perimetre(anneau));
  const rectangle = rectangleOriente(anneau);
  const dec = decomposerEnCorps(anneau);
  const corps = dec.corps.length ? dec.corps : [rectangle];
  if (!dec.corps.length) avert.push('Emprise non décomposable en corps rectangulaires : toiture posée sur le rectangle englobant (déborde des murs) — à confirmer.');
  const principal = corps[0]!;
  const rapport = principal.largeur > 0 ? principal.longueur / principal.largeur : 1;
  const quasiCarre = rapport < REGLES_TOIT.rapportQuasiCarre;
  if (dec.couverture < REGLES_TOIT.couvertureBonne) {
    hyp.push(`Emprise complexe : ${dec.corps.length} corps rectangulaire(s) couvrent ${Math.round(dec.couverture * 100)} % de l’emprise ; le reste est couvert par la dalle haute des murs (toit plat).`);
  }

  const hE = egout(e, s, avert);
  const ecartToit = ok(e.altitudeToitMaxM) && ok(e.altitudeToitMinM) ? e.altitudeToitMaxM - e.altitudeToitMinM : null;
  const faitagePublie = ok(e.altitudeToitMaxM) && ok(e.altitudeSolM) && e.altitudeToitMaxM > e.altitudeSolM ? e.altitudeToitMaxM - e.altitudeSolM : null;
  const nivProv = ok(e.etages) ? e.etages : ok(e.bdnb?.nbNiveaux) ? e.bdnb!.nbNiveaux! : Math.round(hE.valeur / REGLES_HAUTEUR.parNiveauM);

  // --- Forme du toit (R0 à R4) ---
  let forme: Donnee<FormeToit>;
  let regle: string;
  let confiance: Confiance;
  if (s.formeToit) {
    forme = D(s.formeToit, 'confirmee', 'saisie utilisateur');
    regle = 'R0 : forme confirmée par l’utilisateur';
    confiance = 'haute';
  } else if (ecartToit !== null) {
    if (ecartToit < REGLES_TOIT.ecartPlatM) {
      forme = D('plat', 'estimee', `R1 : altitudes du toit BD TOPO à ${fr(ecartToit, 2)} m d’écart (< 1 m)`);
      regle = 'R1 : écart des altitudes du toit < 1 m → plat';
    } else {
      forme = D(quasiCarre ? 'quatre-pans' : 'deux-pans', 'estimee', `R1 : altitudes du toit BD TOPO à ${fr(ecartToit, 2)} m d’écart ; corps principal ${fr(principal.longueur)} × ${fr(principal.largeur)} m${quasiCarre ? ' (quasi carré → 4 pans)' : ' → 2 pans'}`);
      regle = `R1 : faîtage publié → ${quasiCarre ? '4 pans (quasi carré)' : '2 pans'}`;
    }
    confiance = dec.couverture >= REGLES_TOIT.couvertureBonne ? 'moyenne' : 'faible';
  } else if (e.legere) {
    forme = D('plat', 'supposee', 'R2 : construction légère BD TOPO sans altitudes de toit (pente faible assimilée à plat)');
    regle = 'R2 : construction légère → plat SUPPOSÉ';
    confiance = 'faible';
  } else if (nivProv >= REGLES_TOIT.collectifNiveaux || hE.valeur >= REGLES_TOIT.collectifEgoutM || principal.largeur > REGLES_TOIT.largeurPlatM) {
    forme = D('plat', 'supposee', `R3 : faîtage non publié, bâtiment collectif ou épais (${String(nivProv)} niveau(x), égout ${fr(hE.valeur)} m, corps de ${fr(principal.largeur)} m de large)`);
    regle = 'R3 : collectif / épais sans faîtage publié → plat SUPPOSÉ';
    confiance = 'faible';
  } else {
    forme = D(quasiCarre ? 'quatre-pans' : 'deux-pans', 'supposee', `R4 : faîtage non publié, pavillon ; corps principal ${fr(principal.longueur)} × ${fr(principal.largeur)} m${quasiCarre ? ' (quasi carré → 4 pans)' : ' → 2 pans'}`);
    regle = `R4 : pavillon sans faîtage publié → ${quasiCarre ? '4 pans' : '2 pans'} SUPPOSÉ, pente 35° SUPPOSÉE`;
    confiance = 'faible';
  }

  // --- Orientation du faîtage ---
  const orientation: Donnee<OrientationFaitage> = s.orientationFaitage
    ? D(s.orientationFaitage, 'confirmee', 'saisie utilisateur')
    : D('grand-axe', quasiCarre ? 'supposee' : 'estimee', quasiCarre ? 'corps quasi carré : orientation indiscernable, grand axe SUPPOSÉ' : 'faîtage parallèle au grand axe du corps (règle courante)');
  const largeurPorteuse = orientation.valeur === 'grand-axe' ? principal.largeur : principal.longueur;

  // --- Pente et hauteurs ---
  let pente: Donnee<number>;
  let hF: Donnee<number>;
  const f = forme.valeur;
  if (f === 'plat') {
    pente = D(0, forme.statut, 'toit plat');
    hF = ok(s.hauteurFaitageM) ? D(r2(s.hauteurFaitageM), 'confirmee', 'saisie utilisateur') : D(hE.valeur, hE.statut, 'toit plat : faîtage = égout');
  } else if (ok(s.hauteurFaitageM) && s.hauteurFaitageM > hE.valeur) {
    hF = D(r2(s.hauteurFaitageM), 'confirmee', 'saisie utilisateur');
    const h = hF.valeur - hE.valeur;
    pente = ok(s.penteDeg) ? D(s.penteDeg, 'confirmee', 'saisie utilisateur') : D(r2((Math.atan(h / (f === 'monopente' ? largeurPorteuse : largeurPorteuse / 2)) * 180) / Math.PI), 'estimee', 'déduite du faîtage saisi et de la largeur du corps');
  } else if (ok(s.penteDeg)) {
    pente = D(s.penteDeg, 'confirmee', 'saisie utilisateur');
    hF = D(r2(hE.valeur + hauteurToiture(f, largeurPorteuse, s.penteDeg)), 'estimee', `égout + toiture à ${fr(s.penteDeg, 0)}° (pente saisie) sur ${fr(largeurPorteuse)} m`);
  } else if (faitagePublie !== null && faitagePublie > hE.valeur) {
    hF = D(r2(faitagePublie), 'mesuree', 'BD TOPO altitude maximale du toit − altitude minimale du sol');
    const h = faitagePublie - hE.valeur;
    const p = (Math.atan(h / (f === 'monopente' ? largeurPorteuse : largeurPorteuse / 2)) * 180) / Math.PI;
    pente = D(r2(p), 'estimee', `déduite : atan(${fr(h, 2)} m / ${fr(f === 'monopente' ? largeurPorteuse : largeurPorteuse / 2, 2)} m)`);
    if (p < REGLES_TOIT.penteVraisemblable[0] || p > REGLES_TOIT.penteVraisemblable[1]) {
      avert.push(`Pente déduite de ${fr(p, 0)}° peu vraisemblable pour un toit ${f} : forme ou orientation probablement fausse — à confirmer.`);
      confiance = 'faible';
    }
  } else {
    const p = REGLES_TOIT.penteSupposeeDeg;
    const brut = hauteurToiture(f, largeurPorteuse, p);
    const h = Math.min(REGLES_TOIT.hauteurToitMaxM, Math.max(REGLES_TOIT.hauteurToitMinM, brut));
    pente = D(p, 'supposee', `${p}° SUPPOSÉS (pavillons franciliens : tuile mécanique, 30 à 40°)`);
    hF = D(r2(hE.valeur + h), 'supposee', `égout + ${fr(h, 2)} m (toiture ${p}° SUPPOSÉS sur ${fr(largeurPorteuse)} m${brut !== h ? ', bornée à 1–6 m' : ''})`);
  }
  if (!s.formeToit && f !== 'plat') hyp.push(`Toiture ${f} ${forme.statut === 'supposee' ? 'SUPPOSÉE' : 'estimée'} (${regle}) : à confirmer par l’utilisateur.`);

  // --- Niveaux et surface de plancher ---
  const niv = niveaux(e, s, hE.valeur);
  let sdp: Donnee<number> & { minM2: number; maxM2: number };
  if (ok(s.surfacePlancherM2)) {
    sdp = { ...D(r2(s.surfacePlancherM2), 'confirmee', 'saisie utilisateur'), minM2: r2(s.surfacePlancherM2), maxM2: r2(s.surfacePlancherM2) };
  } else {
    const parNiveau = Math.max(0, empriseM2 - perimetreM * REGLES_SURFACE.epaisseurMursM);
    const v = Math.max(0, niv.valeur * parNiveau - Math.max(0, niv.valeur - 1) * REGLES_SURFACE.tremieM2);
    sdp = {
      ...D(Math.round(v), 'estimee', `${String(niv.valeur)} niveau(x) (${niv.source}) × (emprise ${fr(empriseM2, 0)} m² − périmètre ${fr(perimetreM, 0)} m × 0,25 m de murs SUPPOSÉS) − 3 m² de trémie SUPPOSÉE par étage ; combles et sous-sol non comptés`),
      minM2: Math.round(v * (1 - REGLES_SURFACE.incertitude)),
      maxM2: Math.round(v * (1 + REGLES_SURFACE.incertitude)),
    };
    if (!ok(e.etages) && !ok(e.bdnb?.nbNiveaux)) hyp.push('Nombre de niveaux non publié (BD TOPO, BDNB) : déduit de la hauteur — surface de plancher très incertaine.');
    if (!e.bdnb) hyp.push('BDNB non fournie : seule la BD TOPO a servi (le site peut transmettre les niveaux BDNB, lot X3).');
  }
  return {
    id: e.id,
    anneau,
    baseM: e.baseM ?? 0,
    empriseM2,
    perimetreM,
    rectangle,
    corps,
    couverture: dec.couverture,
    hauteurEgout: hE,
    hauteurFaitage: hF,
    toit: { forme, penteDeg: pente, orientation, confiance, regle },
    niveaux: niv,
    surfacePlancher: sdp,
    hypotheses: hyp,
    avertissements: avert,
    verrouille: true,
  };
}

/** Toitures posées : (corps, y égout, hauteur) — même pente sur tous les corps, faîtage du corps principal respecté. */
export function toituresPosees(m: MaisonExistante): { corps: RectOriente; y0: number; h: number }[] {
  const f = m.toit.forme.valeur;
  const y0 = m.baseM + m.hauteurEgout.valeur;
  if (f === 'plat') return [];
  const hPrincipal = Math.max(0, m.hauteurFaitage.valeur - m.hauteurEgout.valeur);
  const p = m.toit.penteDeg.valeur;
  return m.corps.map((c, i) => {
    const larg = m.toit.orientation.valeur === 'grand-axe' ? c.largeur : c.longueur;
    const h = i === 0 ? hPrincipal : Math.min(hPrincipal, hauteurToiture(f, larg, p));
    return { corps: c, y0, h: r2(h) };
  });
}

/** Triangles (x, y, z) des murs et de la toiture : aperçus, silhouettes, futur z-buffer d'occultation (lot X4). */
export function trianglesMaisonExistante(m: MaisonExistante): { murs: Float64Array; toit: Float64Array; tout: Float64Array } {
  const murs = trianglesPrismeVertical(m.anneau, m.baseM, m.baseM + m.hauteurEgout.valeur, true);
  const toit: number[] = [];
  for (const t of toituresPosees(m)) toit.push(...trianglesToiture(t.corps, m.toit.forme.valeur, t.y0, t.h, m.toit.orientation.valeur));
  return { murs: Float64Array.from(murs), toit: Float64Array.from(toit), tout: Float64Array.from([...murs, ...toit]) };
}

/* ------------------------------------------------------------------ */
/* Adaptateurs                                                          */
/* ------------------------------------------------------------------ */

/** Le bâtiment « principal » parmi ceux de la parcelle : la plus grande emprise non légère (sinon la plus grande). */
export function maisonPrincipale<T extends { readonly anneau: readonly Pt[]; readonly legere?: boolean | null }>(bats: readonly T[]): T | null {
  const tri = [...bats].sort((a, b) => Math.abs(aire(b.anneau)) - Math.abs(aire(a.anneau)));
  return tri.find((b) => !b.legere) ?? tri[0] ?? null;
}

/** Points du contour d'un rectangle orienté (aperçus). */
export { coinsRect };
