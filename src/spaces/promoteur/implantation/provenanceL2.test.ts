// Tests L2 — contrôle d'implantation fondé sur la provenance PLU par valeur (node:test, imports .ts).
import assert from "node:assert/strict";
import test from "node:test";
import { calculerDistances, construireSegments, type ContourBatiment, type Pt } from "./boundaryDistances.ts";
import { controlerImplantation, type ControleImplantation } from "./implantationCheck.ts";
import { classementFinal, signatureParcelle } from "./limitesClassement.ts";
import {
  creerValidation, creerValidationDepuisSource, documentIdExploitable, ecrireValidations, extraireReglesRetrait, lireValidations,
  motifNonSourcee, natureReference, referenceExploitable, type EtatRuleset, type ValidationsRegles,
} from "./rulesetReculs.ts";
import { PROVENANCE_VERSION } from "../lib/pluProvenance.ts";

const P = (x: number, y: number): Pt => ({ x, y });
const CARRE: Pt[] = [P(0, 0), P(20, 0), P(20, 20), P(0, 20)];
const CONF = { signature: signatureParcelle([CARRE]), choix: { "p0-e0": "voirie", "p0-e1": "separative", "p0-e2": "fond", "p0-e3": "separative" } } as const;
const rect = (x0: number, y0: number, x1: number, y1: number): ContourBatiment => ({ id: "A", nom: "A", polygones: [[P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]] });
const OK = (rs: Record<string, unknown>): EtatRuleset => ({ statut: "ok", ruleset: rs });
const MAINTENANT = new Date("2026-10-14T10:00:00Z");
function ctl(bat: ContourBatiment[], rs: Record<string, unknown>, val: ValidationsRegles = {}): ControleImplantation {
  const segs = construireSegments([CARRE], classementFinal([CARRE], 0, CONF as any));
  return controlerImplantation(segs, calculerDistances(segs, [CARRE], bat), OK(rs), val, { communeParcelle: "64065", maintenant: MAINTENANT });
}
const lim = (c: ControleImplantation, id: string) => c.batiments[0]!.limites.find((l) => l.segmentId === id)!;

const PV = (valeur: number, article: string, extra: Record<string, unknown> = {}) => ({
  valeur, regle: "FIXED", article, article_intitule: `ARTICLE UB ${article}`, article_zone: "UB", article_zone_qualifie: true, extrait: `Les constructions doivent respecter un retrait d'au moins ${valeur} m.`, page: 12, methode: "regex", confiance: 0.7, motif: null, ...extra,
});
/** Ruleset résolu L2 (tel qu'écrit par FoncierPluPage avec plu-parser 3.2.0). */
const RS2 = (over: Record<string, unknown> = {}, prov: Record<string, unknown> = {}, doc: Record<string, unknown> | null = {}): Record<string, unknown> => ({
  version: "plu_ruleset_v1", provenance_version: PROVENANCE_VERSION,
  document_id: "plu-txt-0123456789abcdef", commune_insee: "64065", zone_code: "UB", source: "plu-parser:regex",
  document: doc === null ? null : { id: "plu-txt-0123456789abcdef", intitule: "reglement.pdf", commune_insee: "64065", commune_nom: "Ascain", idurba: "64065_PLU_20230615", datvalid: "2023-07-01", date_approbation: "2023-06-15", empreinte_sha256: "0123456789abcdefa1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4", ...doc },
  reculs: { voirie: { type: "FIXED", min_m: 5 }, limites_separatives: { type: "FIXED", min_m: 3 }, fond_parcelle: { type: "FIXED", min_m: 4 }, implantation_en_limite: { autorisee: false } },
  provenance: { "reculs.voirie.min_m": PV(5, "6"), "reculs.limites_separatives.min_m": PV(3, "7"), "reculs.fond_parcelle.min_m": PV(4, "7"), ...prov },
  ...over,
});
const BAT = [rect(6, 6, 14, 14)];

test("référence documentaire (document + article + extrait) : proposée, mais pas de verdict sans personne nommée", () => {
  const rs = RS2();
  const r = extraireReglesRetrait(rs);
  assert.equal(r.voirie.documentaire, true);
  assert.equal(r.voirie.provenanceValeur?.article, "6");
  assert.equal(r.voirie.provenance.confiance, 0.7, "confiance de la VALEUR");
  assert.equal(motifNonSourcee(r.voirie, null), "regle-ia-non-confirmee");
  const c = ctl(BAT, rs);
  assert.equal(lim(c, "p0-e0").verdict, "a-verifier");
  assert.equal(lim(c, "p0-e0").natureReference, "documentaire");
  assert.match(lim(c, "p0-e0").reference ?? "", /PLU de Ascain \(64065_PLU_20230615\), art\. 6, p\. 12 \(source extraite, non validée\)/);
  assert.equal(c.etatDateDocument?.statut, "recente");
});

test("« Valider avec la source » par une personne nommée → verdict ; périmée si l'extrait change", () => {
  const rs = RS2();
  const v = creerValidationDepuisSource(extraireReglesRetrait(rs).voirie, "Claire Martin", MAINTENANT);
  assert.equal(v.erreur, null);
  assert.equal(v.validation!.source, "documentaire");
  assert.equal(v.validation!.reference, "PLU de Ascain (64065_PLU_20230615), art. 6, p. 12");
  assert.ok(referenceExploitable(v.validation!.reference), "le libellé proposé est une référence exploitable");
  const val = { voirie: v.validation! };
  assert.equal(lim(ctl(BAT, rs, val), "p0-e0").verdict, "respecte");
  assert.equal(lim(ctl([rect(6, 4, 14, 14)], rs, val), "p0-e0").verdict, "non-respecte");
  // l'extrait (ou la page, ou le document) change : validation périmée
  const rs2 = RS2({}, { "reculs.voirie.min_m": PV(5, "6", { extrait: "Autre passage : retrait de 5 m." }) });
  assert.equal(lim(ctl(BAT, rs2, val), "p0-e0").raison, "validation-perimee");
  const rs3 = RS2({}, {}, { idurba: "64065_PLU_20250101" });
  assert.equal(lim(ctl(BAT, rs3, val), "p0-e0").raison, "validation-perimee");
  // nom factice refusé
  assert.match(creerValidationDepuisSource(extraireReglesRetrait(rs).voirie, "moi").erreur ?? "", /Nom non exploitable/);
  // aller-retour stockage
  const store = new Map<string, string>();
  const st = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, x: string) => void store.set(k, x) };
  ecrireValidations(st, "S1", val);
  assert.deepEqual(lireValidations(st, "S1"), val);
});

test("provenance incomplète (extrait vide, article absent, document non identifié) → pas de référence documentaire", () => {
  for (const [prov, doc] of [
    [{ "reculs.voirie.min_m": PV(5, "6", { extrait: null }) }, {}],
    [{ "reculs.voirie.min_m": PV(5, "6", { article: null }) }, {}],
    [{}, null],
  ] as const) {
    const rs = RS2({}, prov as any, doc as any);
    const r = extraireReglesRetrait(rs).voirie;
    assert.equal(r.documentaire, false);
    assert.match(creerValidationDepuisSource(r, "Claire Martin").erreur ?? "", /Pas de source documentaire/);
  }
  // provenance d'une autre valeur (6 m au lieu de 5) : ignorée
  const r = extraireReglesRetrait(RS2({}, { "reculs.voirie.min_m": PV(6, "6") })).voirie;
  assert.equal(r.provenanceValeur, null);
  assert.equal(r.documentaire, false);
});

test("R2-1 levée : référence saisie sans document identifiable ou sans article numéroté → reste « à vérifier »", () => {
  const rs = RS2();
  const regle = extraireReglesRetrait(rs).voirie;
  for (const ref of ["Art. 7", "Article7", "Article-7", "Art.7.2.1", "UA 7", "PLU art. ?", "PLU art.", "PLU page", "PLU p.", "PLU 0", "PLU art. xx", "règlement art. ...", "voir PLU art", "XYZ123456"]) {
    assert.equal(creerValidation(regle, ref, "Claire Martin").validation, null, ref);
    // même une validation forgée (stockage modifié à la main) n'est pas acceptée
    const forge = { voirie: { categorie: "voirie" as const, valeur: 5, documentId: rs.document_id as string, zoneCode: "UB", reference: ref, par: "Claire Martin", le: "2026-10-14" } };
    assert.equal(lim(ctl(BAT, rs, forge), "p0-e0").verdict, "a-verifier", ref);
  }
  // identifiant EXACT du document du ruleset : accepté
  assert.ok(referenceExploitable("64065_PLU_20230615", ["plu-txt-0123456789abcdef", "64065_PLU_20230615"]));
  assert.equal(referenceExploitable("64065_PLU_20230615"), false, "sans contexte, un identifiant seul ne suffit pas");
  const v = creerValidation(regle, "64065_PLU_20230615", "Claire Martin", MAINTENANT);
  assert.equal(v.erreur, null);
  assert.equal(lim(ctl(BAT, rs, { voirie: v.validation! }), "p0-e0").verdict, "respecte");
  assert.equal(natureReference(regle, v.validation), "saisie");
});

test("ancien ruleset v1 sans provenance : « à vérifier », pas de source proposée, date du document inconnue", () => {
  const v1: Record<string, unknown> = { version: "plu_ruleset_v1", document_id: "PLU-ASCAIN-2023-r1", commune_insee: "64065", zone_code: "UB", reculs: { voirie: { type: "FIXED", min_m: 5 } } };
  const r = extraireReglesRetrait(v1).voirie;
  assert.equal(r.documentaire, false);
  assert.equal(r.provenanceValeur, null);
  const c = ctl(BAT, v1);
  assert.equal(lim(c, "p0-e0").verdict, "a-verifier");
  assert.equal(lim(c, "p0-e0").natureReference, "aucune");
  assert.equal(c.provenancePlu, null);
  assert.equal(c.etatDateDocument?.libelle, "Date du document inconnue");
  // une référence saisie qui identifie document + article reste possible (validation nommée)
  const v = creerValidation(r, "PLU Ascain, art. UB 6", "Claire Martin", MAINTENANT);
  assert.equal(lim(ctl(BAT, v1, { voirie: v.validation! }), "p0-e0").verdict, "respecte");
});

test("règles non simples venues du texte : alternative alignement / retrait et H/2 restent « à vérifier » même validées", () => {
  const alt = RS2({ reculs: { voirie: { type: "ALIGNEMENT_OU_RETRAIT", min_m: 5 } } });
  const rv = extraireReglesRetrait(alt).voirie;
  assert.equal(motifNonSourcee(rv, null), "regle-alternative");
  const v = creerValidationDepuisSource(rv, "Claire Martin", MAINTENANT);
  assert.equal(lim(ctl(BAT, alt, { voirie: v.validation! }), "p0-e0").raison, "regle-alternative");
  const h2 = RS2({ reculs: { limites_separatives: { type: "H_OVER_2_MIN", min_m: 3 } } });
  assert.equal(motifNonSourcee(extraireReglesRetrait(h2).separative, null), "regle-non-chiffree");
});

test("date du document : plus de 10 ans signalée ; absente → « date du document inconnue »", () => {
  assert.equal(ctl(BAT, RS2({}, {}, { date_approbation: "2008-03-01", datvalid: null })).etatDateDocument?.statut, "ancienne");
  const sansDate = ctl(BAT, RS2({}, {}, { date_approbation: null, datvalid: null, idurba: null }));
  assert.equal(sansDate.etatDateDocument?.libelle, "Date du document inconnue");
  assert.ok(!/\bconforme\b/i.test(JSON.stringify(sansDate)));
});

test("R2-2 : identifiants de repli refusés, identifiants réels et identifiant d'analyse acceptés", () => {
  for (const id of ["SQLCANON1", "fallback2", "unknown1", "null123", "none_0001", "temp123", "LOCAL01", "plu_ruleset_v1", "ruleset-v1", "AI_EXTRACTION_1", "ID000001", "doc1234", "zone-UA-1", "upload1", "manual01"]) {
    assert.equal(documentIdExploitable(id), false, id);
  }
  for (const id of ["35238_PLU_20190101", "PLU-RENNES-2019-modif3", "doc_35238_2019", "plu-txt-0123456789abcdef", "4f1c2b8e-0d3a-4c1e-9b7a-2f6d8e1a3c5b"]) {
    assert.equal(documentIdExploitable(id), true, id);
  }
});
