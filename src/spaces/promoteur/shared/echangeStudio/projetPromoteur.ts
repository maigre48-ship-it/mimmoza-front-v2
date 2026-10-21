// src/spaces/promoteur/shared/echangeStudio/projetPromoteur.ts
//
// LOT L3 — parcours promoteur (Implantation 2D) ↔ contrat `mimmoza-projet-v2`.
// Pur (aucune API navigateur) : testable avec node:test.
//
//   projetDepuisPromoteur : éditeur 2D + parcelles + relief + règles + contrôle → projet v2
//   appliquerRetourAuPlan : projet v2 renvoyé par Studio → bâtiments de l'éditeur 2D
//   controleRecalcule     : contrôle d'implantation RECALCULÉ côté Mimmoza (L1b/L2),
//                           jamais repris tel quel du verdict de Studio.
//
// Repère : celui d'Implantation2DPage (`wgs84FeatureToLocalMeters` + `featureToPoint2D`) :
// projection équirectangulaire autour de la moyenne des sommets du premier anneau,
// x = est, y = sud (axe y inversé). Écart ≈ 0,5 % (≈ 10 cm sur 20 m) par rapport à
// Lambert-93 côté Studio : les positions font foi en WGS 84 dans le contrat.

import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { Building2D, OrientedRect, Point2D } from "../../plan2d/editor2d.types.ts";
import type { BuildingVolume2D, FloorPlan2D } from "../../plan2d/buildingProgram.types.ts";
import { contourBatiment } from "../../implantation/adapters.ts";
import { calculerDistances, type Pt, type SegmentLimite } from "../../implantation/boundaryDistances.ts";
import { controlerImplantation, type ControleImplantation, type Verdict } from "../../implantation/implantationCheck.ts";
import { CATEGORIES_REGLE, extraireReglesRetrait, type EtatRuleset, type ValidationsRegles } from "../../implantation/rulesetReculs.ts";
import {
  ecartAngle, validerProjet,
  type BatimentV2, type Changement, type ControleV2, type LectureProjet, type LonLat, type ProjetMimmozaV2, type RegleV2, type SessionV2, type TypeChangement,
} from "./mimmozaProjetV2.ts";

/** Mêmes valeurs que `shared/buildingMetrics.ts` (non importé : ce module reste sans alias « @/ »). */
const HAUTEUR_RDC_M = 3.0;
const HAUTEUR_ETAGE_M = 2.8;

export interface ProjectionLocale {
  readonly centLon: number;
  readonly centLat: number;
  readonly mPerDegLon: number;
  readonly mPerDegLat: number;
}

/** Même calcul que `wgs84FeatureToLocalMeters` d'Implantation2DPage (centre = moyenne des sommets du 1er anneau). */
export function projectionDepuisFeature(feature: Feature<Polygon | MultiPolygon> | null | undefined): ProjectionLocale | null {
  if (!feature?.geometry) return null;
  const anneaux: number[][][] = feature.geometry.type === "Polygon"
    ? (feature.geometry.coordinates as number[][][])
    : (feature.geometry.coordinates as number[][][][]).flat(1);
  const ext = anneaux[0] ?? [];
  if (ext.length === 0) return null;
  const centLon = ext.reduce((s, c) => s + c[0]!, 0) / ext.length;
  const centLat = ext.reduce((s, c) => s + c[1]!, 0) / ext.length;
  return { centLon, centLat, mPerDegLon: 111_320 * Math.cos(centLat * (Math.PI / 180)), mPerDegLat: 110_574 };
}

export function versLocal(pr: ProjectionLocale, ll: LonLat): Point2D {
  return { x: (ll.lon - pr.centLon) * pr.mPerDegLon, y: -((ll.lat - pr.centLat) * pr.mPerDegLat) };
}

const r9 = (v: number): number => Math.round(v * 1e9) / 1e9;
export function versLonLat(pr: ProjectionLocale, p: Point2D): LonLat {
  return { lon: r9(pr.centLon + p.x / pr.mPerDegLon), lat: r9(pr.centLat - p.y / pr.mPerDegLat) };
}

const RE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
export function idPropre(id: string): string {
  const t = id.replace(/[^A-Za-z0-9._:-]/g, "-").replace(/^[^A-Za-z0-9]+/, "");
  return (t || "x").slice(0, 80);
}
/** Identifiant de contrat d'un bâtiment né dans Mimmoza. */
export const idContratFront = (frontId: string): string => idPropre(`f-${frontId}`);

const r2 = (v: number): number => Math.round(v * 100) / 100;

export interface EntreeProjetPromoteur {
  readonly projetId: string;
  readonly etudeId: string | null;
  readonly horodatage: string;
  readonly session: SessionV2 | null;
  /** Feature WGS 84 combinée (celle d'où Implantation2DPage tire son repère). */
  readonly featureCombinee: Feature<Polygon | MultiPolygon> | null;
  readonly parcelles: readonly { readonly id: string; readonly feature: unknown }[];
  readonly communeInsee: string | null;
  readonly adresse: string | null;
  readonly pointAdresse: LonLat | null;
  readonly relief: {
    readonly provider: string; readonly renderBounds: readonly [number, number, number, number]; readonly parcelBounds: readonly [number, number, number, number];
    readonly grid: { readonly z: readonly (readonly number[])[]; readonly n: number }; readonly altitudeMin: number; readonly altitudeMax: number; readonly penteMoyenne: number | null;
  } | null;
  readonly buildings: readonly Building2D[];
  readonly base: ProjetMimmozaV2 | null;
  /** Correspondance identifiant de contrat → identifiant du bâtiment dans l'éditeur. */
  readonly refsFront: Readonly<Record<string, string>>;
  readonly etatRuleset: EtatRuleset;
  readonly validations: ValidationsRegles;
  readonly controle: ControleImplantation | null;
  readonly logementsVises: number | null;
}

function geometrieDe(feature: unknown): unknown {
  if (!feature || typeof feature !== "object") return null;
  const f = feature as { type?: unknown; geometry?: unknown };
  const g = (f.type === "Feature" ? f.geometry : f) as { type?: unknown; coordinates?: unknown } | null;
  return g && (g.type === "Polygon" || g.type === "MultiPolygon") ? { type: g.type, coordinates: g.coordinates } : null;
}

/** Contrat ← bâtiments + correspondance (inverse : bâtiment de l'éditeur → identifiant de contrat). */
export function idContratDe(frontId: string, refsFront: Readonly<Record<string, string>>): string {
  for (const [contrat, front] of Object.entries(refsFront)) if (front === frontId) return contrat;
  return idContratFront(frontId);
}

function batimentVersContrat(b: Building2D, pr: ProjectionLocale, base: ProjetMimmozaV2 | null, refsFront: Readonly<Record<string, string>>): BatimentV2 | null {
  if (!(b.rect.width >= 0.5 && b.rect.depth >= 0.5)) return null;
  const id = idContratDe(b.id, refsFront);
  const precedent = base?.batiments.find((x) => x.id === id) ?? null;
  const niveaux = Math.max(1, Math.min(60, Math.round((b.floorsAboveGround ?? 0) + 1)));
  const contour = contourBatiment(b);
  const emprise = contour.polygones
    .filter((ring) => ring.length >= 3)
    .map((ring) => {
      const ll = ring.map((p) => { const g = versLonLat(pr, p); return [g.lon, g.lat]; });
      return [...ll, ll[0]!];
    });
  return {
    id,
    nom: (b.label?.trim() || b.id).slice(0, 80),
    // R2 — la nature déclarée (ex. « visé », « estimé ») n'est pas réécrite par le plan 2D.
    nature: precedent?.nature ?? "modelise",
    centre: versLonLat(pr, b.rect.center),
    rotationDeg: r9(ecartAngle(0, b.rect.rotationDeg)),
    largeurM: r9(b.rect.width),
    profondeurM: r9(b.rect.depth),
    niveaux,
    // Studio modélise la hauteur avec ses propres hauteurs d'étage : conservée tant que le nombre de niveaux ne change pas.
    hauteurM: precedent && precedent.niveaux === niveaux
      ? precedent.hauteurM
      : r2((b.groundFloorHeightM ?? HAUTEUR_RDC_M) + (niveaux - 1) * (b.typicalFloorHeightM ?? HAUTEUR_ETAGE_M)),
    // Le plan 2D ne connaît ni la cote d'entrée ni les ailes de Studio : elles sont conservées telles quelles.
    niveauEntree: precedent?.niveauEntree ?? { relatifTerrainM: null, coteM: null },
    ailes: precedent?.ailes ?? [],
    emprise,
    refs: { front: RE_ID.test(b.id) ? b.id : null, studio: precedent?.refs.studio ?? null },
  };
}

function reglesDepuisRuleset(etat: EtatRuleset, validations: ValidationsRegles): RegleV2[] {
  if (etat.statut !== "ok") return [];
  const regles = extraireReglesRetrait(etat.ruleset);
  return CATEGORIES_REGLE.map((cat) => {
    const r = regles[cat];
    const pv = r.provenanceValeur ?? null;
    const doc = r.provenance.document ?? null;
    const v = validations[cat];
    const valide = v !== undefined && r.valeur !== null && v.valeur === r.valeur;
    return {
      id: `recul-${cat}`,
      champ: r.champ ?? `reculs.${cat}`,
      categorie: cat,
      valeur: r.valeur,
      unite: "m",
      zone: r.provenance.zoneCode,
      source: {
        documentId: r.provenance.documentId,
        intitule: doc?.intitule ?? null,
        article: pv?.article ?? null,
        extrait: pv?.extrait ? pv.extrait.slice(0, 600) : null,
        page: pv?.page !== null && pv?.page !== undefined && Number.isInteger(pv.page) && pv.page >= 0 ? pv.page : null,
        date: doc?.dateApprobation ?? doc?.datvalid ?? null,
      },
      provenance: r.documentaire ? "document" : valide && v.source === "saisie" ? "saisie" : pv?.methode === "llm" ? "ia" : pv?.methode === "saisie" ? "saisie" : "inconnue",
      validation: valide ? { statut: "validee", par: v.par.slice(0, 120), le: v.le } : { statut: "non-validee", par: null, le: null },
      etat: "ordinaire",
    };
  });
}

function controleVersContrat(c: ControleImplantation, refsFront: Readonly<Record<string, string>>, horodatage: string): ControleV2 {
  return {
    calculePar: "mimmoza-front",
    calculeLe: horodatage,
    niveau: c.niveau,
    libelle: c.libelleNiveau.slice(0, 300),
    lignes: c.batiments.flatMap((b) => b.limites.map((l) => ({
      batimentId: idContratDe(b.buildingId, refsFront),
      limiteId: l.segmentId.slice(0, 80),
      categorie: l.categorie,
      distanceM: r2(l.horsParcelle ? l.distanceSignee : l.distance),
      minimumM: l.retraitRequis !== null && l.retraitRequis >= 0 ? l.retraitRequis : null,
      verdict: l.verdict,
      raison: l.raison,
    }))).slice(0, 2000),
    indicatif: true,
  };
}

/** Projet v2 depuis l'état du parcours promoteur. Refus explicite si la parcelle n'a pas de repère. */
export function projetDepuisPromoteur(e: EntreeProjetPromoteur): LectureProjet {
  const pr = projectionDepuisFeature(e.featureCombinee);
  if (!pr) return { ok: false, erreur: "Parcelle sans géométrie WGS 84 : impossible de situer les bâtiments pour Studio." };
  const base = e.base;
  const batiments = e.buildings.filter((b) => (b.kind ?? "building") === "building")
    .map((b) => batimentVersContrat(b, pr, base, e.refsFront)).filter((b): b is BatimentV2 => b !== null);
  const reglesFront = reglesDepuisRuleset(e.etatRuleset, e.validations);
  const idsFront = new Set(reglesFront.map((r) => r.id));
  const parcellesAvecGeo = e.parcelles.map((p) => ({ id: p.id, geometrie: geometrieDe(p.feature) }));
  const parcelles = parcellesAvecGeo.length > 0 && parcellesAvecGeo.every((p) => p.geometrie !== null)
    ? parcellesAvecGeo
    : [{ id: (e.parcelles.map((p) => p.id).join("+") || "unite-fonciere").slice(0, 64), geometrie: geometrieDe(e.featureCombinee) }];
  const relief = e.relief
    ? { nature: "mesure", fournisseur: e.relief.provider, renderBounds: e.relief.renderBounds, parcelBounds: e.relief.parcelBounds,
        grille: { n: e.relief.grid.n, z: e.relief.grid.z }, altitudeMin: e.relief.altitudeMin, altitudeMax: e.relief.altitudeMax, penteMoyenne: e.relief.penteMoyenne }
    : base?.site.relief ?? null;
  return validerProjet({
    format: "mimmoza-projet-v2",
    version: 2,
    projetId: e.projetId,
    etudeId: e.etudeId,
    revision: base ? base.revision + 1 : 0,
    parentEmpreinte: null,
    horodatage: e.horodatage,
    origine: "mimmoza-front",
    session: e.session,
    site: { communeInsee: e.communeInsee, adresse: e.adresse, pointAdresse: e.pointAdresse, parcelles, relief, reliefOmis: false },
    repere: { origine: { lon: r9(pr.centLon), lat: r9(pr.centLat) }, rotationDeg: 0, echelle: 1, axes: "x-est-y-sud" },
    batiments,
    acces: base?.acces ?? [],
    programme: { ...(base?.programme ?? { logementsVises: null, logementsModelises: null, surfacePlancherM2: null, brief: null, commandeArchitecture: null }),
      ...(e.logementsVises !== null ? { logementsVises: e.logementsVises } : {}) },
    photos: base?.photos ?? [],
    regles: [...reglesFront, ...(base?.regles ?? []).filter((r) => !idsFront.has(r.id))],
    controle: e.controle ? controleVersContrat(e.controle, e.refsFront, e.horodatage) : null,
    extensionsV1: base?.extensionsV1 ?? { implantation: null, compositionArchitecture: null, volumeAiles: null },
  });
}

/* ------------------------------------------------------------------ */
/* Retour Studio → plan 2D                                             */
/* ------------------------------------------------------------------ */

function tourner(p: Point2D, deg: number): Point2D {
  const a = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
}

/** Déplace, tourne et met à l'échelle un bâtiment ET ses volumes d'étage (repère du bâtiment conservé). */
export function transformerBatiment(b: Building2D, cible: OrientedRect): Building2D {
  const ancien = b.rect;
  const sx = ancien.width > 0.001 ? cible.width / ancien.width : 1;
  const sy = ancien.depth > 0.001 ? cible.depth / ancien.depth : 1;
  const drot = cible.rotationDeg - ancien.rotationDeg;
  const volume = (v: BuildingVolume2D): BuildingVolume2D => {
    const rel = tourner({ x: v.rect.center.x - ancien.center.x, y: v.rect.center.y - ancien.center.y }, -ancien.rotationDeg);
    const nv = tourner({ x: rel.x * sx, y: rel.y * sy }, cible.rotationDeg);
    return { ...v, rect: { center: { x: cible.center.x + nv.x, y: cible.center.y + nv.y }, width: v.rect.width * sx, depth: v.rect.depth * sy, rotationDeg: (((v.rect.rotationDeg + drot) % 360) + 360) % 360 } };
  };
  return {
    ...b,
    rect: { ...cible },
    floorPlans: (b.floorPlans ?? []).map((fp) => ({ ...fp, volumes: fp.volumes.map(volume) })),
    volumes: (b.volumes ?? []).map(volume),
  };
}

export interface ResultatApplication {
  readonly buildings: Building2D[];
  readonly refsFront: Record<string, string>;
  readonly ajoutes: string[];
  readonly supprimes: string[];
  /** Ce que le plan 2D ne sait pas représenter (conservé pour Studio). */
  readonly nonApplique: string[];
}

/**
 * Applique le projet renvoyé par Studio aux bâtiments de l'éditeur 2D :
 * position, rotation, largeur, profondeur, niveaux. Un bâtiment créé dans Studio
 * est ajouté ; un bâtiment présent dans la base mais retiré par Studio est retiré ;
 * un bâtiment ajouté dans Mimmoza après l'envoi est conservé. Parkings intacts.
 */
export function appliquerRetourAuPlan(
  buildings: readonly Building2D[],
  retour: ProjetMimmozaV2,
  base: ProjetMimmozaV2 | null,
  refsFront: Readonly<Record<string, string>>,
  pr: ProjectionLocale,
  nouvelId: () => string,
): ResultatApplication {
  const refs: Record<string, string> = { ...refsFront };
  const parFront = new Map(buildings.map((b) => [b.id, b] as const));
  const contratDe = new Map(buildings.map((b) => [b.id, idContratDe(b.id, refsFront)] as const));
  const frontDe = (bat: BatimentV2): string | null => {
    if (refs[bat.id] && parFront.has(refs[bat.id]!)) return refs[bat.id]!;
    for (const [f, c] of contratDe) if (c === bat.id) return f;
    return bat.refs.front && parFront.has(bat.refs.front) ? bat.refs.front : null;
  };
  const ajoutes: string[] = [];
  const nonApplique: string[] = [];
  const traites = new Set<string>();
  const resultat: Building2D[] = [];
  const nouveaux: Building2D[] = [];
  const cibleDe = (bat: BatimentV2): OrientedRect => ({ center: versLocal(pr, bat.centre), width: bat.largeurM, depth: bat.profondeurM, rotationDeg: (((bat.rotationDeg % 360) + 360) % 360) });
  for (const bat of retour.batiments) {
    const f = frontDe(bat);
    const avant = base?.batiments.find((x) => x.id === bat.id) ?? null;
    if (avant && JSON.stringify(avant.ailes) !== JSON.stringify(bat.ailes) && bat.ailes.length > 0) {
      nonApplique.push(`${bat.nom} : ${String(bat.ailes.length)} aile(s) définies dans Studio, conservées pour Studio mais non dessinées dans le plan 2D`);
    }
    if (f) {
      const b = parFront.get(f)!;
      traites.add(f);
      refs[bat.id] = f;
      resultat.push({ ...transformerBatiment(b, cibleDe(bat)), floorsAboveGround: bat.niveaux - 1, label: bat.nom });
    } else {
      const id = nouvelId();
      const cible = cibleDe(bat);
      const rdc: FloorPlan2D = { id: nouvelId(), levelIndex: 0, label: "RDC", volumes: [{ id: nouvelId(), rect: { ...cible, center: { ...cible.center } }, role: "main" }], balconies: [], loggias: [], terraces: [] };
      nouveaux.push({
        id, kind: "building", rect: cible, label: bat.nom, floorPlans: [rdc], floorsAboveGround: bat.niveaux - 1,
        groundFloorHeightM: HAUTEUR_RDC_M, typicalFloorHeightM: HAUTEUR_ETAGE_M, roofType: "flat", balconies: [], loggias: [], terraces: [], volumes: [],
      });
      refs[bat.id] = id;
      ajoutes.push(bat.nom);
    }
  }
  const idsRetour = new Set(retour.batiments.map((b) => b.id));
  const idsBase = new Set((base?.batiments ?? []).map((b) => b.id));
  const supprimes: string[] = [];
  for (const b of buildings) {
    if (traites.has(b.id)) continue;
    const c = contratDe.get(b.id)!;
    if ((b.kind ?? "building") === "building" && idsBase.has(c) && !idsRetour.has(c)) { supprimes.push(b.label || b.id); delete refs[c]; continue; }
    resultat.push(b);
  }
  // Ordre d'origine conservé, nouveaux bâtiments à la fin.
  const ordre = new Map(buildings.map((b, i) => [b.id, i] as const));
  resultat.sort((a, b) => (ordre.get(a.id) ?? 0) - (ordre.get(b.id) ?? 0));
  return { buildings: [...resultat, ...nouveaux], refsFront: refs, ajoutes, supprimes, nonApplique };
}

/** Contrôle d'implantation recalculé par Mimmoza (L1b/L2) sur des bâtiments proposés. */
export function controleRecalcule(
  segments: readonly SegmentLimite[],
  anneaux: readonly (readonly Pt[])[],
  buildings: readonly Building2D[],
  etatRuleset: EtatRuleset,
  validations: ValidationsRegles,
  communeInsee: string | null,
): ControleImplantation {
  const contours = buildings.filter((b) => (b.kind ?? "building") === "building").map(contourBatiment);
  const rapport = calculerDistances(segments, anneaux, contours, { includePairs: false });
  return controlerImplantation(segments, rapport, etatRuleset, validations, { communeParcelle: communeInsee });
}

const RANG: Readonly<Record<Verdict, number>> = { respecte: 0, "a-verifier": 1, "non-respecte": 2 };

/** Compare, bâtiment par bâtiment, le verdict annoncé par Studio et celui recalculé par Mimmoza. */
export function comparerVerdicts(
  mimmoza: ControleImplantation,
  studio: ControleV2 | null,
  refsFront: Readonly<Record<string, string>>,
): { readonly divergences: readonly string[]; readonly libelle: string } {
  if (!studio) return { divergences: [], libelle: "Studio n’a pas transmis de contrôle : seul le recalcul Mimmoza fait foi." };
  const pire = new Map<string, Verdict>();
  for (const l of studio.lignes) {
    const p = pire.get(l.batimentId);
    if (!p || RANG[l.verdict] > RANG[p]) pire.set(l.batimentId, l.verdict);
  }
  const divergences: string[] = [];
  for (const b of mimmoza.batiments) {
    const id = idContratDe(b.buildingId, refsFront);
    const s = pire.get(id);
    if (s && s !== b.verdict) divergences.push(`${b.buildingName} : Studio annonçait « ${s} », Mimmoza recalcule « ${b.verdict} »`);
  }
  return {
    divergences,
    libelle: divergences.length === 0
      ? "Contrôle recalculé par Mimmoza : cohérent avec l’indication de Studio."
      : `Contrôle recalculé par Mimmoza : ${String(divergences.length)} divergence(s) avec l’indication de Studio — le recalcul Mimmoza fait foi.`,
  };
}

/* ------------------------------------------------------------------ */
/* R2 — ce que la fenêtre de confirmation montre, et ce qui devient la base */
/* ------------------------------------------------------------------ */

const APPLIQUES: ReadonlySet<TypeChangement> = new Set(["batiment-ajoute", "batiment-supprime", "renommage", "deplacement", "rotation", "dimensions", "niveaux"]);
const A_CONFIRMER: ReadonlySet<TypeChangement> = new Set(["regle", "parcelles", "site"]);

export interface ChangementsClasses {
  /** Appliqués au plan 2D par « Appliquer ». */
  readonly appliques: readonly Changement[];
  /** Repris dans le projet échangé, sans effet sur le dessin (ailes, cote d'entrée, hauteur, accès, programme, photos). */
  readonly conserves: readonly Changement[];
  /** NON appliqués : règles, parcelles et site restent ceux de Mimmoza ; à confirmer dans le parcours Foncier / PLU. */
  readonly aConfirmer: readonly Changement[];
}

export function classerChangements(changements: readonly Changement[]): ChangementsClasses {
  return {
    appliques: changements.filter((c) => APPLIQUES.has(c.type)),
    aConfirmer: changements.filter((c) => A_CONFIRMER.has(c.type)),
    conserves: changements.filter((c) => !APPLIQUES.has(c.type) && !A_CONFIRMER.has(c.type)),
  };
}

/**
 * Base commune après « Appliquer » : le retour de Studio, SAUF les règles, les
 * parcelles et le site, qui restent ceux de Mimmoza (non appliqués). Ainsi l'état
 * local recalculé après application coïncide avec la base (pas de faux conflit).
 */
export function baseApresAcceptation(retour: ProjetMimmozaV2, local: ProjetMimmozaV2 | null): ProjetMimmozaV2 {
  if (!local) return retour;
  const idsLocaux = new Set(local.regles.map((r) => r.id));
  return {
    ...retour,
    site: { ...retour.site, communeInsee: local.site.communeInsee, adresse: local.site.adresse, pointAdresse: local.site.pointAdresse, parcelles: local.site.parcelles },
    regles: [...local.regles, ...retour.regles.filter((r) => !idsLocaux.has(r.id))],
  };
}
