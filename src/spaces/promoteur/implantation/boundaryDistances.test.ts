// Tests L1b — géométrie (node:test, imports suffixés .ts).
import assert from "node:assert/strict";
import test from "node:test";
import { calculerDistances, construireSegments, type ContourBatiment, type Pt } from "./boundaryDistances.ts";
import { classementFinal, proposerClassement, signatureParcelle } from "./limitesClassement.ts";
import { anneauxDepuisFeatureLocale, coinsRect, contourBatiment } from "./adapters.ts";

const P = (x: number, y: number): Pt => ({ x, y });
// Parcelle 20 × 20 : e0 = y=0 (de (0,0) à (20,0)), e1 = x=20, e2 = y=20, e3 = x=0.
const CARRE: Pt[] = [P(0, 0), P(20, 0), P(20, 20), P(0, 20)];
const nonClasse = () => ({ categorie: "non-classee" as const, origine: "aucune" as const });
const segs = (anneaux: Pt[][] = [CARRE]) => construireSegments(anneaux, nonClasse);
const rect = (id: string, x0: number, y0: number, x1: number, y1: number): ContourBatiment => ({
  id, nom: id, polygones: [[P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]],
});
const parSeg = (r: ReturnType<typeof calculerDistances>, b = 0) =>
  Object.fromEntries(r.buildings[b]!.perSegment.map((d) => [d.segmentId, d]));
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

test("rectangle aligné : distance à chaque limite, points les plus proches, dans la parcelle", () => {
  const r = calculerDistances(segs(), [CARRE], [rect("A", 5, 4, 15, 12)]);
  const d = parSeg(r);
  near(d["p0-e0"]!.distance, 4);
  near(d["p0-e1"]!.distance, 5);
  near(d["p0-e2"]!.distance, 8);
  near(d["p0-e3"]!.distance, 5);
  assert.equal(r.buildings[0]!.insideParcel, true);
  near(r.buildings[0]!.minDistance!, 4);
  assert.equal(d["p0-e0"]!.pointOnBoundary.y, 0);
  assert.equal(d["p0-e0"]!.pointOnBuilding.y, 4);
  // la portion retenue est la façade parallèle (y = 4), pas un coin quelconque
  assert.equal(d["p0-e0"]!.portion.start.y, 4);
  assert.equal(d["p0-e0"]!.portion.end.y, 4);
});

test("rotation : carré 4×4 à 45° et rectangle 4×2 à 30° (valeurs calculées à la main)", () => {
  const b45: ContourBatiment = { id: "R", nom: "R", polygones: [coinsRect({ center: P(10, 10), width: 4, depth: 4, rotationDeg: 45 })] };
  const d45 = parSeg(calculerDistances(segs(), [CARRE], [b45]));
  for (const k of ["p0-e0", "p0-e1", "p0-e2", "p0-e3"]) near(d45[k]!.distance, 10 - 2 * Math.SQRT2, 1e-9);
  const b30: ContourBatiment = { id: "S", nom: "S", polygones: [coinsRect({ center: P(10, 10), width: 4, depth: 2, rotationDeg: 30 })] };
  const d30 = parSeg(calculerDistances(segs(), [CARRE], [b30]));
  near(d30["p0-e0"]!.distance, 10 - (1 + Math.sqrt(3) / 2), 1e-9); // 8,1339746
  near(d30["p0-e3"]!.distance, 10 - (Math.sqrt(3) + 0.5), 1e-9); // 7,7679492
});

test("forme en L : polygone unique et deux volumes superposés donnent les mêmes distances", () => {
  const L: ContourBatiment = { id: "L", nom: "L", polygones: [[P(2, 2), P(12, 2), P(12, 6), P(6, 6), P(6, 14), P(2, 14)]] };
  const dL = parSeg(calculerDistances(segs(), [CARRE], [L]));
  near(dL["p0-e0"]!.distance, 2);
  near(dL["p0-e1"]!.distance, 8);
  near(dL["p0-e2"]!.distance, 6);
  near(dL["p0-e3"]!.distance, 2);
  const volumes = contourBatiment({
    id: "V", kind: "building", label: "Aile en L", rect: { center: P(7, 8), width: 10, depth: 12, rotationDeg: 0 },
    floorPlans: [{ id: "f0", levelIndex: 0, label: "RDC", volumes: [
      { id: "v1", rect: { center: P(7, 4), width: 10, depth: 4, rotationDeg: 0 } },
      { id: "v2", rect: { center: P(4, 8), width: 4, depth: 12, rotationDeg: 0 } },
    ] }],
    floorsAboveGround: 2, groundFloorHeightM: 3, typicalFloorHeightM: 2.8,
  });
  assert.equal(volumes.nom, "Aile en L");
  assert.equal(volumes.polygones.length, 2);
  const dV = parSeg(calculerDistances(segs(), [CARRE], [volumes]));
  for (const k of ["p0-e0", "p0-e1", "p0-e2", "p0-e3"]) near(dV[k]!.distance, dL[k]!.distance);
});

test("deux bâtiments : un rapport par bâtiment", () => {
  const r = calculerDistances(segs(), [CARRE], [rect("A", 2, 2, 6, 6), rect("B", 14, 10, 18, 19)]);
  assert.equal(r.buildings.length, 2);
  near(parSeg(r, 0)["p0-e2"]!.distance, 14);
  near(parSeg(r, 1)["p0-e2"]!.distance, 1);
  near(parSeg(r, 1)["p0-e1"]!.distance, 2);
  assert.ok(r.buildings.every((b) => b.insideParcel));
});

test("bâtiment qui touche la limite : 0 m, contact, toujours dans la parcelle", () => {
  const d = parSeg(calculerDistances(segs(), [CARRE], [rect("T", 0, 5, 5, 10)]));
  near(d["p0-e3"]!.distance, 0);
  assert.equal(d["p0-e3"]!.touchesBoundary, true);
  assert.equal(d["p0-e3"]!.exceedsBoundary, false);
  const r = calculerDistances(segs(), [CARRE], [rect("T", 0, 5, 5, 10)]);
  assert.equal(r.buildings[0]!.insideParcel, true);
});

test("bâtiment hors parcelle : limite franchie, profondeur et distance signée négative", () => {
  const r = calculerDistances(segs(), [CARRE], [rect("H", 25, 5, 30, 9)]);
  const d = parSeg(r);
  assert.equal(r.buildings[0]!.insideParcel, false);
  assert.equal(d["p0-e1"]!.exceedsBoundary, true);
  near(d["p0-e1"]!.distance, 5);
  near(d["p0-e1"]!.outsideDepth, 10);
  near(d["p0-e1"]!.distanceSignee, -10);
  assert.equal(d["p0-e3"]!.exceedsBoundary, false);
});

test("coin franchi en diagonale : les deux limites du coin sont franchies", () => {
  const r = calculerDistances(segs(), [CARRE], [rect("C", 18, 18, 22, 22)]);
  const d = parSeg(r);
  assert.equal(r.buildings[0]!.insideParcel, false);
  assert.equal(d["p0-e1"]!.exceedsBoundary, true);
  assert.equal(d["p0-e2"]!.exceedsBoundary, true);
  assert.equal(d["p0-e0"]!.exceedsBoundary, false);
  assert.equal(d["p0-e3"]!.exceedsBoundary, false);
});

test("angle rentrant traversé sans sommet dehors : hors parcelle", () => {
  const LPARC: Pt[] = [P(0, 0), P(20, 0), P(20, 10), P(10, 10), P(10, 20), P(0, 20)];
  const tri: ContourBatiment = { id: "T", nom: "T", polygones: [[P(5, 5), P(16, 5), P(5, 16)]] };
  const r = calculerDistances(construireSegments([LPARC], nonClasse), [LPARC], [tri]);
  assert.equal(r.buildings[0]!.insideParcel, false);
  assert.ok(r.buildings[0]!.perSegment.some((x) => x.exceedsBoundary));
});

test("parcelle multiple : arête commune interne exclue, bâtiment à cheval dans la parcelle", () => {
  const A: Pt[] = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
  const B: Pt[] = [P(10, 0), P(20, 0), P(20, 10), P(10, 10)];
  const s = construireSegments([A, B], nonClasse);
  const r = calculerDistances(s, [A, B], [rect("X", 8, 2, 12, 8)]);
  assert.deepEqual([...r.segmentsInternes].sort(), ["p0-e1", "p1-e3"]);
  assert.equal(r.anneauxParcelle, 2);
  assert.equal(r.buildings[0]!.insideParcel, true);
  assert.equal(r.buildings[0]!.perSegment.length, 6);
  near(r.buildings[0]!.minDistance!, 2);
});

test("parcelle multiple disjointe : le second polygone est aussi mesuré (pas seulement le premier)", () => {
  const A: Pt[] = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
  const B: Pt[] = [P(30, 0), P(40, 0), P(40, 10), P(30, 10)];
  const r = calculerDistances(construireSegments([A, B], nonClasse), [A, B], [rect("Y", 32, 2, 38, 8)]);
  assert.equal(r.buildings[0]!.insideParcel, true);
  assert.equal(r.segmentsInternes.length, 0);
  const d = parSeg(r);
  near(d["p1-e0"]!.distance, 2);
  near(d["p1-e3"]!.distance, 2);
});

test("adaptateur MultiPolygon : tous les polygones sont conservés, le plus grand en premier, y inversé", () => {
  const f = {
    type: "Feature" as const, properties: {},
    geometry: { type: "MultiPolygon" as const, coordinates: [
      [[[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]],
      [[[10, 0], [30, 0], [30, 20], [10, 20], [10, 0]], [[12, 2], [13, 2], [13, 3], [12, 2]]],
    ] },
  };
  const a = anneauxDepuisFeatureLocale(f);
  assert.equal(a.nbPolygones, 2);
  assert.equal(a.indexPrincipal, 1);
  assert.equal(a.anneaux.length, 2);
  assert.deepEqual(a.anneaux[0]![1], { x: 30, y: -0 });
  assert.equal(a.anneaux[0]![2]!.y, -20);
  assert.equal(a.trousIgnores, 1);
});

test("classement : façade désignée = voirie (utilisateur), opposée = fond, côtés = séparatives (déduits)", () => {
  const c = proposerClassement(CARRE, 0);
  assert.deepEqual(c.map((x) => x.categorie), ["voirie", "separative", "fond", "separative"]);
  assert.deepEqual(c.map((x) => x.origine), ["utilisateur", "deduite", "deduite", "deduite"]);
  assert.ok(proposerClassement(CARRE, null).every((x) => x.categorie === "non-classee"));
  // choix utilisateur valable seulement pour la même géométrie
  const sig = signatureParcelle([CARRE]);
  const f = classementFinal([CARRE], 0, { signature: sig, choix: { "p0-e1": "voirie" } });
  assert.deepEqual(f(0, 1, "p0-e1"), { categorie: "voirie", origine: "utilisateur" });
  assert.deepEqual(f(0, 2, "p0-e2"), { categorie: "fond", origine: "deduite" });
  const g = classementFinal([CARRE], 0, { signature: "autre", choix: { "p0-e1": "voirie" } });
  assert.deepEqual(g(0, 1, "p0-e1"), { categorie: "separative", origine: "deduite" });
  // polygone secondaire : non classé tant que l'utilisateur ne l'a pas classé
  assert.deepEqual(f(1, 0, "p1-e0"), { categorie: "non-classee", origine: "aucune" });
});
