// Tests L1b R2 — anomalies du contrôle (G5, G5b, G6, V1, V2 intégrés) et mineures.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculerDistances, construireSegments, type ContourBatiment, type Pt } from "./boundaryDistances.ts";
import { controlerImplantation, type ControleImplantation } from "./implantationCheck.ts";
import { classementFinal, signatureParcelle } from "./limitesClassement.ts";
import { libelleSeuilsIndicatifs, lignesControlePdf, TITRE_SEUILS_INDICATIFS } from "./libellesSeuils.ts";
import {
  cleValidations, creerValidation, documentIdExploitable, extraireReglesRetrait, lireValidations, motifNonSourcee,
  nomValidateurExploitable, referenceExploitable, type EtatRuleset,
} from "./rulesetReculs.ts";

const P = (x: number, y: number): Pt => ({ x, y });
const CARRE: Pt[] = [P(0, 0), P(20, 0), P(20, 20), P(0, 20)];
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const rect = (x0: number, y0: number, x1: number, y1: number, id = "A"): ContourBatiment => ({
  id, nom: id, polygones: [[P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]],
});
const util = () => ({ categorie: "separative" as const, origine: "utilisateur" as const });
const RS = (over: Record<string, unknown> = {}, reculs: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: "plu_ruleset_v1", document_id: "PLU-RENNES-2019-modif3", commune_insee: "35238", zone_code: "UA",
  source: "AI_EXTRACTION", confidence_score: 0.8,
  reculs: { voirie: { type: "FIXED", min_m: 5 }, limites_separatives: { type: "FIXED", min_m: 3 }, fond_parcelle: { type: "FIXED", min_m: 4 }, implantation_en_limite: { autorisee: false }, ...reculs },
  ...over,
});
const OK = (rs: Record<string, unknown>): EtatRuleset => ({ statut: "ok", ruleset: rs });
const CONF = { signature: signatureParcelle([CARRE]), choix: { "p0-e0": "voirie", "p0-e1": "separative", "p0-e2": "fond", "p0-e3": "separative" } } as const;
const valider = (rs: Record<string, unknown>, cat: "voirie" | "separative" | "fond", ref: string, par: string) =>
  creerValidation(extraireReglesRetrait(rs)[cat], ref, par, new Date("2026-10-14T10:00:00Z"));
function ctl(bat: ContourBatiment[], etat: EtatRuleset, val: any = {}, commune: string | null = "35238"): ControleImplantation {
  const segs = construireSegments([CARRE], classementFinal([CARRE], 0, CONF as any));
  return controlerImplantation(segs, calculerDistances(segs, [CARRE], bat), etat, val, { communeParcelle: commune });
}
const lim = (c: ControleImplantation, id: string) => c.batiments[0]!.limites.find((l) => l.segmentId === id)!;
const BAT = [rect(6, 6, 14, 14)];

// ─── Géométrie ───────────────────────────────────────────────────────────

test("G5 arête commune PARTIELLE : seule la portion partagée est interne, le reste reste une limite", () => {
  const A = [P(0, 0), P(10, 0), P(10, 20), P(0, 20)];
  const B = [P(10, 0), P(20, 0), P(20, 5), P(10, 5)];
  const segs = construireSegments([A, B], util);
  const e1 = segs.find((s) => s.id === "p0-e1")!;
  assert.equal(e1.interne, false);
  near(e1.start.y, 5); near(e1.end.y, 20);
  const int = segs.find((s) => s.id === "p0-e1-i1")!;
  assert.equal(int.interne, true);
  near(int.start.y, 0); near(int.end.y, 5);
  assert.equal(segs.find((s) => s.id === "p1-e3")!.interne, true); // côté de B entièrement partagé
  const r = calculerDistances(segs, [A, B], [rect(6, 10, 9.5, 14)]);
  near(r.buildings[0]!.minDistance!, 0.5);
  assert.equal(r.buildings[0]!.insideParcel, true);
});

test("G5 bis : portion commune au milieu d'une arête → deux portions extérieures", () => {
  const A = [P(0, 0), P(10, 0), P(10, 20), P(0, 20)];
  const B = [P(10, 8), P(20, 8), P(20, 12), P(10, 12)];
  const segs = construireSegments([A, B], util).filter((s) => s.baseId === "p0-e1");
  assert.deepEqual(segs.map((s) => [s.id, s.interne, Math.round(s.length)]), [["p0-e1", false, 8], ["p0-e1-i1", true, 4], ["p0-e1-2", false, 8]]);
});

test("G5b conséquence : bâtiment à 0,50 m de la partie non commune, séparative 3 m validée → pas « Respecté »", () => {
  const A = [P(0, 0), P(10, 0), P(10, 20), P(0, 20)], B = [P(10, 0), P(20, 0), P(20, 5), P(10, 5)];
  const choix: any = { signature: signatureParcelle([A, B]), choix: {} };
  for (const s of construireSegments([A, B], util)) choix.choix[s.baseId] = s.baseId === "p0-e0" ? "voirie" : s.baseId === "p0-e2" ? "fond" : "separative";
  const segs = construireSegments([A, B], classementFinal([A, B], 0, choix));
  const rs = RS();
  const val: any = {};
  for (const [cat, ref] of [["voirie", "art. UA 6"], ["separative", "art. UA 7"], ["fond", "art. UA 7.2"]] as const) val[cat] = valider(rs, cat, "PLU Rennes " + ref, "Claire Martin").validation;
  const c = controlerImplantation(segs, calculerDistances(segs, [A, B], [rect(6, 10, 9.5, 14)]), OK(rs), val, { communeParcelle: "35238" });
  assert.equal(c.batiments[0]!.verdict, "non-respecte");
  const l = c.batiments[0]!.limites.find((x) => x.segmentId === "p0-e1")!;
  assert.equal(l.verdict, "non-respecte");
  assert.equal(l.marge, -2.5);
});

test("G6 coin franchi en diagonale : profondeur 3 m au-delà de CHAQUE limite (pas 4,24 m au coin)", () => {
  const segs = construireSegments([CARRE], util);
  const r = calculerDistances(segs, [CARRE], [rect(17, 17, 23, 23)]);
  const d = Object.fromEntries(r.buildings[0]!.perSegment.map((x) => [x.segmentId, x]));
  assert.equal(d["p0-e1"]!.exceedsBoundary && d["p0-e2"]!.exceedsBoundary, true);
  near(d["p0-e1"]!.outsideDepth, 3, 1e-6);
  near(d["p0-e2"]!.outsideDepth, 3, 1e-6);
  near(d["p0-e1"]!.distanceSignee, -3, 1e-6);
  // sens d'anneau inverse : même résultat
  const inv = [...CARRE].reverse();
  const r2 = calculerDistances(construireSegments([inv], util), [inv], [rect(17, 17, 23, 23)]);
  for (const x of r2.buildings[0]!.perSegment.filter((k) => k.exceedsBoundary)) near(x.outsideDepth, 3, 1e-6);
});

// ─── Références et noms factices ─────────────────────────────────────────

const REFS = ["N/A", "NON RENSEIGNÉ", "  Non   Applicable ", "Non-renseigné", "non_renseigne", "N.C.", "NC.", "Inconnu.", "PLU", "plu",
  "abc", "123", "SQL_CANON", "sql_canon", "SQL-AI", "document", "voir PLU", "à vérifier plus tard", "A VERIFIER", "à-vérifier", "pas encore lu",
  "sans_objet", "Sans-Objet", "fallback_defaults", "-", "???", "xxxx", "Règlement", "PLU zone UA"];

test("V1 références factices refusées comme document_id ET comme référence de validation", () => {
  const acceptes: string[] = [];
  for (const r of REFS) {
    const rsD = RS({ document_id: r });
    const v = valider(rsD, "voirie", "PLU Rennes, art. UA 6", "Claire Martin");
    const vd = lim(ctl(BAT, OK(rsD), v.validation ? { voirie: v.validation } : {}), "p0-e0").verdict;
    const rs = RS();
    const v2 = valider(rs, "voirie", r, "Claire Martin");
    const vr = v2.validation ? lim(ctl(BAT, OK(rs), { voirie: v2.validation }), "p0-e0").verdict : "refusée";
    if (vd === "respecte" || vr === "respecte") acceptes.push(`${r} doc→${vd} réf→${vr}`);
  }
  assert.deepEqual(acceptes, []);
  assert.equal(documentIdExploitable("SQL_CANON"), false);
  assert.equal(motifNonSourcee(extraireReglesRetrait(RS({ document_id: "SQL_CANON" })).voirie, null), "reference-factice");
});

test("V1 bis : références réelles acceptées (identifiant de document, ou type + article / page)", () => {
  for (const r of ["PLU Rennes, art. UA 6", "PLUi Métropole, UB 7.2", "PLU art. 7", "RNU art. R111-17", "PPRI, § 3.2"]) {
    assert.equal(referenceExploitable(r), true, r);
  }
  // L2 R2 (A2) : une page n'est pas un article — « Règlement PLU page 42 » est désormais refusée.
  assert.equal(referenceExploitable("Règlement PLU page 42"), false);
  for (const id of ["PLU-RENNES-2019-modif3", "8f2c1a7e-0b4d-4e2a-9c1f-2a6b7c8d9e0f", "doc_35238_2019"]) assert.equal(documentIdExploitable(id), true, id);
  for (const id of ["PLU Rennes 2019", "123456", "abcdef"]) assert.equal(documentIdExploitable(id), false, id);
});

test("V2 noms de validateur factices refusés", () => {
  const acceptes: string[] = [];
  for (const par of ["", "   ", "-", "x", "n/a", "???", "Anonyme", "moi", "Test", "admin", "xx", "Mimmo", "à vérifier"]) {
    const rs = RS();
    const v = valider(rs, "voirie", "PLU Rennes, art. UA 6", par);
    if (v.validation && lim(ctl(BAT, OK(rs), { voirie: v.validation }), "p0-e0").verdict === "respecte") acceptes.push(JSON.stringify(par));
  }
  assert.deepEqual(acceptes, []);
  for (const n of ["Claire Martin", "J. Dupont", "Lê Văn An"]) assert.equal(nomValidateurExploitable(n), true, n);
  // une validation stockée avec un nom factice est ignorée à la lecture
  const st = { getItem: () => JSON.stringify({ voirie: { valeur: 5, documentId: "PLU-RENNES-2019-modif3", zoneCode: "UA", reference: "PLU art 6", par: "moi", le: "2026-10-14" } }) };
  assert.deepEqual(lireValidations(st, "S1"), {});
});

// ─── Mineures ────────────────────────────────────────────────────────────

test("commune de la parcelle ou du règlement inconnue → « à vérifier »", () => {
  const rs = RS();
  const v = { voirie: valider(rs, "voirie", "PLU Rennes, art. UA 6", "Claire Martin").validation };
  assert.equal(lim(ctl(BAT, OK(rs), v, null), "p0-e0").raison, "commune-non-verifiable");
  assert.equal(lim(ctl(BAT, OK(RS({ commune_insee: null })), v), "p0-e0").raison, "commune-non-verifiable");
  assert.equal(lim(ctl(BAT, OK(rs), v), "p0-e0").verdict, "respecte");
});

test("confiance faible ou source de repli : verdict possible après validation, mais avertissement maintenu", () => {
  const rs = RS({ confidence_score: 0.2, source: "fallback_defaults" });
  const v = { voirie: valider(rs, "voirie", "PLU Rennes, art. UA 6", "Claire Martin").validation };
  const c = ctl(BAT, OK(rs), v);
  const l = lim(c, "p0-e0");
  assert.equal(l.verdict, "respecte");
  assert.equal(l.avertissements.length, 2);
  assert.match(l.explication, /Confiance déclarée faible \(20 %\)/);
  assert.match(l.explication, /Source de repli/);
  assert.equal(c.regles!.voirie.avertissements.length, 2);
});

test("« 3 m (ou H/2) » = règle conditionnelle → « à vérifier » ; « 5,0 » et « 5 m » restent chiffrés", () => {
  const r = extraireReglesRetrait(RS({}, { voirie: { min_m: "3 m (ou H/2)" }, limites_separatives: { min_m: "5,0" }, fond_parcelle: { min_m: "5 m" } }));
  assert.equal(r.voirie.valeur, 3);
  assert.equal(r.voirie.typeRegle, "CONDITIONNEL");
  assert.equal(motifNonSourcee(r.voirie, null), "regle-non-chiffree");
  assert.equal(r.separative.valeur, 5);
  assert.equal(r.fond.valeur, 5);
  assert.notEqual(r.separative.typeRegle, "CONDITIONNEL");
});

test("validations liées à l'étude ou, à défaut, à la parcelle", () => {
  assert.equal(cleValidations("S1"), "mimmoza.implantation.validations_retraits_v1.S1");
  assert.equal(cleValidations(null, "v1:abc:12"), "mimmoza.implantation.validations_retraits_v1.parcelle.v1:abc:12");
  assert.equal(cleValidations("S1", "v1:abc:12"), "mimmoza.implantation.validations_retraits_v1.S1");
});

test("façade du store global : pas un choix pour une autre parcelle", () => {
  const AUTRE = [P(0, 0), P(30, 0), P(30, 12), P(0, 12)];
  assert.equal(classementFinal([AUTRE], 2, null)(0, 2, "p0-e2").origine, "deduite");
  // façade enregistrée pour CARRE : ne vaut pas pour AUTRE
  const choixCarre = { signature: signatureParcelle([CARRE]), choix: {}, facade: 2 };
  assert.equal(classementFinal([AUTRE], 2, choixCarre)(0, 2, "p0-e2").origine, "deduite");
  assert.equal(classementFinal([CARRE], 2, choixCarre)(0, 2, "p0-e2").origine, "utilisateur");
});

test("exports : libellés des seuils et lignes PDF sans « conforme »", () => {
  for (const s of ["CONFORME", "LIMITE", "BLOQUANT"] as const) assert.doesNotMatch(libelleSeuilsIndicatifs(s), /conforme/i);
  assert.match(TITRE_SEUILS_INDICATIFS, /non réglementaires/);
  const sans = lignesControlePdf(null);
  assert.match(sans[0]!.texte, /seuils ci-dessus sont indicatifs, non réglementaires/);
  const rs = RS();
  const v = { voirie: valider(rs, "voirie", "PLU Rennes, art. UA 6", "Claire Martin").validation };
  const lignes = lignesControlePdf(ctl([rect(6, 4.9, 14, 14)], OK(rs), v));
  const txt = lignes.map((l) => l.texte).join("\n");
  assert.doesNotMatch(txt, /\bconforme\b/i);
  assert.match(txt, /Voirie \(alignement\) p0-e0 : 4,90 m mesurés, retrait 5,00 m \(PLU Rennes, art\. UA 6, validé par Claire Martin\) : Non respecté/);
  assert.ok(lignes.some((l) => l.verdict === "a-verifier"));
  // source du PDF : plus de libellé « Conforme » ni de titre « Conformité PLU »
  const pdf = readFileSync(new URL("../services/exportDrawnScenarioPdf.ts", import.meta.url), "utf-8");
  assert.doesNotMatch(pdf, /'Conforme'|"Conforme"|'Conformité PLU'|C\.green : s === 'LIMITE'/);
});
