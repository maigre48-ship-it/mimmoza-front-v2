// Tests L2 R2 — anomalies du contrôle L2 (controle-l2/front, C1–C4, V2, V3, R2-1 bis, R2-2 bis)
// devenues tests de non-régression (node:test, imports .ts).
import assert from "node:assert/strict";
import test from "node:test";
import { calculerDistances, construireSegments, type ContourBatiment, type Pt } from "./boundaryDistances.ts";
import { controlerImplantation, type ControleImplantation } from "./implantationCheck.ts";
import { classementFinal, signatureParcelle } from "./limitesClassement.ts";
import { creerValidationDepuisSource, documentIdExploitable, extraireReglesRetrait, nomValidateurExploitable, referenceExploitable } from "./rulesetReculs.ts";
import { extraitContientValeur } from "../lib/pluProvenance.ts";

const P = (x: number, y: number): Pt => ({ x, y });
const CARRE: Pt[] = [P(0, 0), P(20, 0), P(20, 20), P(0, 20)];
const CONF = { signature: signatureParcelle([CARRE]), choix: { "p0-e0": "voirie", "p0-e1": "separative", "p0-e2": "fond", "p0-e3": "separative" } } as const;
const rect = (x0: number, y0: number, x1: number, y1: number): ContourBatiment => ({ id: "A", nom: "A", polygones: [[P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]] });
const M = new Date("2026-10-14T10:00:00Z");
const EMP = "0123456789abcdef" + "a1b2c3d4".repeat(6);
function ctl(rs: Record<string, unknown>, val: any = {}): ControleImplantation {
  const segs = construireSegments([CARRE], classementFinal([CARRE], 0, CONF as any));
  return controlerImplantation(segs, calculerDistances(segs, [CARRE], [rect(6, 6, 14, 14)]), { statut: "ok", ruleset: rs }, val, { communeParcelle: "64065", maintenant: M });
}
const lim = (c: ControleImplantation, id: string) => c.batiments[0]!.limites.find((l) => l.segmentId === id)!;
const PV = (valeur: number, article: string, extra: Record<string, unknown> = {}) => ({
  valeur, regle: "FIXED", article, article_intitule: `ARTICLE UB ${article}`, article_zone: "UB", article_zone_qualifie: true,
  extrait: `Les constructions respectent un retrait d'au moins ${String(valeur).replace(".", ",")} m.`, page: 12, methode: "regex", confiance: 0.7, motif: null, ...extra,
});
const RS = (prov: Record<string, unknown> = {}, doc: Record<string, unknown> | null = {}, over: Record<string, unknown> = {}) => ({
  version: "plu_ruleset_v1", provenance_version: "plu_provenance_v1", document_id: "plu-txt-0123456789abcdef", commune_insee: "64065", zone_code: "UB",
  document: doc === null ? null : { id: "plu-txt-0123456789abcdef", intitule: "reglement.pdf", commune_nom: "Ascain", idurba: "64065_PLU_20230615", datvalid: "2023-07-01", empreinte_sha256: EMP, ...doc },
  reculs: { voirie: { type: "FIXED", min_m: 5 }, limites_separatives: { type: "FIXED", min_m: 3 } },
  provenance: { "reculs.voirie.min_m": PV(5, "6"), "reculs.limites_separatives.min_m": PV(3, "7"), ...prov },
  ...over,
});
const valider = (rs: any, cat: "voirie" | "separative", par = "Claire Martin") => creerValidationDepuisSource(extraireReglesRetrait(rs)[cat], par, M);

test("A2 : « PLU v2 », « PLU de 2023 », « PLU zone 1 », « règlement de 2019 », « PLU art. 0 »… ne sont pas des références", () => {
  for (const r of ["PLU v2", "PLU de 2023", "PLU version 2", "PLU zone 1", "PLU ok 1", "PLU art. 0", "PLU p. 0", "PLU p. 12", "PLU page 42", "PLU 7", "PLU UB",
    "PLU tome 2", "règlement de 2019", "PLU 2019 rev 3", "OAP n 1", "PLU art. ?", "PLU art.", "Article7", "PLU 2019", "PLU UB 2019",
    // R3 (A2-bis)
    "PLU A4", "PLU format A4", "PLU version A 2", "PLU UNE 2", "PLU Annexe A 3", "PLU UB 7", "PLU N 12", "PLU U 2", "PLU 2AU 2026", "PLU A 2019", "PLU article de 12"]) {
    assert.equal(referenceExploitable(r), false, r);
  }
  for (const r of ["PLU, art. 7", "PLU UB-7", "PLU UB.7", "PLUi UB1-7", "PLU Rennes, art. UA 6", "PLUi, art. UB1-7", "PLUi Métropole, UB 7.2", "RNU art. R111-17", "PPRI, § 3.2", "PLU de 2023, art. 12"]) {
    assert.equal(referenceExploitable(r), true, r);
  }
});

test("R2-2 bis : identifiants génériques ou répétés refusés", () => {
  for (const id of ["plu-txt-0000000000000000", "00000000-0000-0000-0000-000000000000", "doc12345", "ID000001", "zz99"]) assert.equal(documentIdExploitable(id), false, id);
  for (const id of ["plu-txt-deadbeefdeadbeef", "doc_35238_2019", "35238_PLU_20190101", "XY12AB34"]) assert.equal(documentIdExploitable(id), true, id);
});

test("A3 / C2 : article d'une AUTRE zone (ou zone inconnue) → pas de référence documentaire, « à vérifier »", () => {
  for (const extra of [{ article_intitule: "ARTICLE UA 7", article_zone: "UA" }, { article_intitule: "ARTICLE 7", article_zone: null, article_zone_qualifie: false }]) {
    const rs = RS({ "reculs.limites_separatives.min_m": PV(3, "7", extra) });
    const r = extraireReglesRetrait(rs).separative;
    assert.equal(r.documentaire, false);
    assert.equal(r.motifNonDocumentaire, extra.article_zone ? "article-autre-zone" : "zone-article-inconnue");
    assert.match(valider(rs, "separative").erreur ?? "", /Pas de source documentaire/);
    assert.equal(lim(ctl(rs), "p0-e1").verdict, "a-verifier");
  }
  // zone écrite « ub 1 » côté provenance et « UB1 » côté ruleset : même zone
  const rs = RS({ "reculs.limites_separatives.min_m": PV(3, "7", { article_zone: "ub 1" }) }, {}, { zone_code: "UB1" });
  assert.equal(extraireReglesRetrait(rs).separative.documentaire, true);
});

test("A4 / C4 : l'extrait doit contenir la valeur (virgule ou point, m ou mètres)", () => {
  for (const e of ["Les constructions s'implantent en retrait de l'alignement.", "Les constructions s'implantent à au moins 8 m.", "au moins 15 m", "une surface de 5 m²", "La hauteur au faîtage est mesurée depuis le sol."]) {
    const rs = RS({ "reculs.voirie.min_m": PV(5, "6", { extrait: e }) });
    assert.equal(extraireReglesRetrait(rs).voirie.documentaire, false, e);
    assert.equal(extraireReglesRetrait(rs).voirie.motifNonDocumentaire, "valeur-absente-de-l-extrait", e);
  }
  assert.ok(extraitContientValeur("retrait de 5 mètres", "reculs.voirie.min_m", 5));
  assert.ok(extraitContientValeur("retrait de 5,00 m", "reculs.voirie.min_m", 5));
  assert.ok(extraitContientValeur("retrait de 2.5 m", "reculs.voirie.min_m", 2.5));
  assert.ok(extraitContientValeur("retrait de 2,50 m", "reculs.voirie.min_m", 2.5));
  assert.ok(extraitContientValeur("emprise limitée à 40 %", "ces.max_ratio", 0.4));
  assert.equal(extraitContientValeur("retrait de 25 m", "reculs.voirie.min_m", 5), false);
});

test("A8 / C1 : document inventé dans le stockage local (id sans empreinte serveur cohérente) → « source locale non vérifiée »", () => {
  for (const doc of [{ id: "plu-txt-deadbeefdeadbeef", empreinte_sha256: null }, { id: "plu-txt-deadbeefdeadbeef", empreinte_sha256: EMP }, { id: "plu-txt-0123456789abcdef", empreinte_sha256: "0".repeat(64) }]) {
    const rs = RS({}, { ...doc, idurba: null }, { document_id: doc.id });
    const r = extraireReglesRetrait(rs).voirie;
    assert.equal(r.motifNonDocumentaire, "source-locale-non-verifiee", JSON.stringify(doc));
    assert.ok(valider(rs, "voirie").erreur);
  }
  assert.equal(extraireReglesRetrait(RS()).voirie.documentaire, true, "id = plu-txt- + empreinte[0:16] : vérifiable");
});

test("A16 : une provenance issue du cache n'est pas proposée en un clic", () => {
  const rs = RS({ "reculs.voirie.min_m": PV(5, "6", { methode: "cache" }) });
  assert.equal(extraireReglesRetrait(rs).voirie.motifNonDocumentaire, "source-cache");
});

test("A9 / V3 : changer la zone de l'intitulé, datvalid ou date d'approbation périme la validation", () => {
  const v = { voirie: valider(RS(), "voirie").validation };
  assert.equal(lim(ctl(RS(), v), "p0-e0").verdict, "respecte");
  for (const rs of [
    RS({ "reculs.voirie.min_m": PV(5, "6", { article_intitule: "ARTICLE 6" }) }),
    RS({}, { datvalid: "2026-01-01" }),
    RS({}, { date_approbation: "2023-06-15" }),
  ]) assert.equal(lim(ctl(rs, v), "p0-e0").raison, "validation-perimee");
});

test("A14 / V2 : rôles génériques refusés comme nom de validateur", () => {
  for (const par of ["Admin 2", "Utilisateur 1", "Le Promoteur", "Personne Physique", "Jean 2"]) assert.equal(nomValidateurExploitable(par), false, par);
  for (const par of ["Claire Martin", "Jean Dupont", "Anne-Marie Le Gall"]) assert.equal(nomValidateurExploitable(par), true, par);
});
