// Tests L1b — règles de vérité et lecture du ruleset (node:test, imports .ts).
import assert from "node:assert/strict";
import test from "node:test";
import { calculerDistances, construireSegments, type ContourBatiment, type Pt } from "./boundaryDistances.ts";
import { classementFinal, signatureParcelle } from "./limitesClassement.ts";
import { controlerImplantation, type ControleImplantation } from "./implantationCheck.ts";
import {
  CLE_RULESET, creerValidation, ecrireValidations, extraireReglesRetrait, lireRulesetPlu, lireValidations,
  motifNonSourcee, referenceExploitable, type EtatRuleset, type ValidationsRegles,
} from "./rulesetReculs.ts";

const P = (x: number, y: number): Pt => ({ x, y });
const CARRE: Pt[] = [P(0, 0), P(20, 0), P(20, 20), P(0, 20)];
const TOUS_CONFIRMES = { signature: signatureParcelle([CARRE]), choix: { "p0-e0": "voirie", "p0-e1": "separative", "p0-e2": "fond", "p0-e3": "separative" } } as const;
const rect = (x0: number, y0: number, x1: number, y1: number, id = "A"): ContourBatiment => ({
  id, nom: `Bâtiment ${id}`, polygones: [[P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]],
});

function ruleset(over: Record<string, unknown> = {}, reculs: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "plu_ruleset_v1",
    document_id: "8f2c1a7e-plu-lyon-2019",
    commune_insee: "69123",
    zone_code: "UA",
    zone_libelle: "Zone urbaine centrale",
    source: "plu-universal-parser",
    confidence_score: 0.82,
    reculs: {
      voirie: { type: "FIXED", min_m: 5, note: null },
      limites_separatives: { type: "FIXED", min_m: 3, note: null },
      fond_parcelle: { type: "FIXED", min_m: 4, note: null },
      implantation_en_limite: { autorisee: false },
      facades: { avant: { type: "UNKNOWN", min_m: 5, derived: true }, laterales: { type: "UNKNOWN", min_m: 3, derived: true }, fond: { type: "UNKNOWN", min_m: 4, derived: true } },
      ...reculs,
    },
    ...over,
  };
}
const ok = (rs: Record<string, unknown>): EtatRuleset => ({ statut: "ok", ruleset: rs });

function controle(
  bat: ContourBatiment[],
  etat: EtatRuleset,
  validations: ValidationsRegles = {},
  choix: { signature: string; choix: Record<string, any> } | null = TOUS_CONFIRMES,
  front: number | null = 0,
  commune: string | null = "69123",
): ControleImplantation {
  const segs = construireSegments([CARRE], classementFinal([CARRE], front, choix));
  return controlerImplantation(segs, calculerDistances(segs, [CARRE], bat), etat, validations, { communeParcelle: commune });
}
const limite = (c: ControleImplantation, id: string, b = 0) => c.batiments[b]!.limites.find((l) => l.segmentId === id)!;
const pasDeConforme = (c: ControleImplantation) =>
  assert.ok(!/\bconforme\b/i.test(JSON.stringify(c)), "aucun « conforme » ne doit apparaître");

function valider(rs: Record<string, unknown>, cat: "voirie" | "separative" | "fond", ref = "PLU Lyon, art. UA 6", par = "Claire Martin"): ValidationsRegles {
  const r = creerValidation(extraireReglesRetrait(rs)[cat], ref, par, new Date("2026-10-14T10:00:00Z"));
  assert.equal(r.erreur, null);
  return { [cat]: r.validation! };
}

test("aucun ruleset : tout est « à vérifier » avec renvoi vers Foncier / PLU, jamais « conforme »", () => {
  const c = controle([rect(5, 5, 15, 15)], { statut: "absent" });
  assert.ok(c.batiments[0]!.limites.every((l) => l.verdict === "a-verifier" && l.raison === "ruleset-absent"));
  assert.equal(c.niveau, "a-verifier");
  assert.match(c.batiments[0]!.limites[0]!.explication, /Foncier \/ PLU/);
  assert.equal(c.regles, null);
  pasDeConforme(c);
});

test("ruleset illisible ou d'un autre format : « à vérifier »", () => {
  assert.equal(controle([rect(5, 5, 15, 15)], { statut: "illisible", message: "x" }).batiments[0]!.limites[0]!.raison, "ruleset-illisible");
  assert.equal(controle([rect(5, 5, 15, 15)], { statut: "format-inconnu", version: null }).batiments[0]!.limites[0]!.raison, "ruleset-format-inconnu");
});

test("valeur présente mais sans document : « à vérifier — sans document identifié »", () => {
  const rs = ruleset({ document_id: null });
  const c = controle([rect(5, 6, 15, 15)], ok(rs));
  assert.equal(limite(c, "p0-e0").raison, "regle-non-sourcee");
  assert.equal(limite(c, "p0-e0").verdict, "a-verifier");
  assert.equal(limite(c, "p0-e0").verdictIndicatif, "respecte");
});

test("références factices refusées (document ou validation)", () => {
  for (const f of ["n/a", "N/A", "-", "non renseigné", "Non applicable", "à vérifier", "sans objet", "SANS OBJET.", "???", "xxxx"]) {
    assert.equal(referenceExploitable(f), false, f);
    const rs = ruleset({ document_id: f });
    assert.equal(motifNonSourcee(extraireReglesRetrait(rs).voirie, null), "reference-factice", f);
    const v = creerValidation(extraireReglesRetrait(ruleset()).voirie, f, "Claire Martin");
    assert.equal(v.validation, null, f);
  }
  // une validation stockée avec une référence factice ne fonde rien
  const rs = ruleset();
  const val = { ...valider(rs, "voirie").voirie!, reference: "non renseigné" };
  assert.equal(motifNonSourcee(extraireReglesRetrait(rs).voirie, val), "reference-factice");
  assert.equal(referenceExploitable("PLU art. UA 6"), true);
});

test("règle extraite par l'IA sans validation nommée : « à vérifier »", () => {
  const rs = ruleset();
  const c = controle([rect(5, 6, 15, 15)], ok(rs));
  assert.equal(limite(c, "p0-e0").raison, "regle-ia-non-confirmee");
  assert.equal(limite(c, "p0-e0").verdict, "a-verifier");
  // validation sans nom refusée à la création et ignorée à la lecture
  assert.match(creerValidation(extraireReglesRetrait(rs).voirie, "PLU art. UA 6", "   ").erreur ?? "", /nom/);
  const store = new Map<string, string>([["mimmoza.implantation.validations_retraits_v1.S1", JSON.stringify({ voirie: { valeur: 5, documentId: rs.document_id, zoneCode: "UA", reference: "PLU art. UA 6", par: "", le: "2026-10-14" } })]]);
  assert.deepEqual(lireValidations({ getItem: (k) => store.get(k) ?? null }, "S1"), {});
});

test("retrait respecté pile (5,00 m pour 5 m) avec règle validée : « Respecté », marge 0", () => {
  const rs = ruleset();
  const c = controle([rect(5, 5, 15, 15)], ok(rs), valider(rs, "voirie"));
  const l = limite(c, "p0-e0");
  assert.equal(l.verdict, "respecte");
  assert.equal(l.raison, null);
  assert.equal(l.marge, 0);
  assert.equal(l.reference, "PLU Lyon, art. UA 6");
  // les autres limites restent à vérifier : niveau « respecte les retraits sourcés connues » + points restants
  assert.equal(c.niveau, "respecte-regles-sourcees-connues");
  assert.match(c.libelleNiveau, /point\(s\) restent à vérifier/);
  pasDeConforme(c);
});

test("retrait violé de 10 cm (4,90 m pour 5 m) : « Non respecté », il manque 0,10 m", () => {
  const rs = ruleset();
  const c = controle([rect(5, 4.9, 15, 15)], ok(rs), valider(rs, "voirie"));
  const l = limite(c, "p0-e0");
  assert.equal(l.verdict, "non-respecte");
  assert.equal(l.marge, -0.1);
  assert.match(l.explication, /il manque 0,10 m/);
  assert.equal(c.niveau, "non-respecte");
  pasDeConforme(c);
});

test("validation périmée si la valeur ou la zone du ruleset change", () => {
  const v = valider(ruleset(), "voirie");
  const c1 = controle([rect(5, 6, 15, 15)], ok(ruleset({}, { voirie: { type: "FIXED", min_m: 6 } })), v);
  assert.equal(limite(c1, "p0-e0").raison, "validation-perimee");
  const c2 = controle([rect(5, 6, 15, 15)], ok(ruleset({ zone_code: "UB" })), v);
  assert.equal(limite(c2, "p0-e0").raison, "validation-perimee");
});

test("limite non classée ou classement déduit : « à vérifier »", () => {
  const rs = ruleset();
  const v = valider(rs, "voirie");
  const sansFacade = controle([rect(5, 5, 15, 15)], ok(rs), v, null, null);
  assert.ok(sansFacade.batiments[0]!.limites.every((l) => l.raison === "limite-non-classee"));
  // R2 : la façade du store global n'est pas un choix tant qu'elle n'a pas été cliquée sur CETTE parcelle
  const deduit = controle([rect(5, 5, 15, 15)], ok(rs), { ...v, ...valider(rs, "fond") }, null, 0);
  assert.equal(limite(deduit, "p0-e0").raison, "classement-deduit");
  assert.equal(limite(deduit, "p0-e2").raison, "classement-deduit");
  const clique = controle([rect(5, 5, 15, 15)], ok(rs), v, { signature: signatureParcelle([CARRE]), choix: {}, facade: 0 } as any, 0);
  assert.equal(limite(clique, "p0-e0").verdict, "respecte"); // arête cliquée sur cette parcelle
  assert.equal(limite(clique, "p0-e2").raison, "classement-deduit");
});

test("règle H/2, ruleset d'une autre commune, implantation en limite autorisée", () => {
  const h2 = ruleset({}, { facades: { avant: { type: "H_OVER_2_MIN", min_m: 4 }, laterales: { type: "UNKNOWN", min_m: 3, derived: true }, fond: { type: "UNKNOWN", min_m: 4, derived: true } } });
  assert.equal(limite(controle([rect(5, 6, 15, 15)], ok(h2)), "p0-e0").raison, "regle-non-chiffree");
  const rs = ruleset();
  assert.equal(limite(controle([rect(5, 6, 15, 15)], ok(rs), valider(rs, "voirie"), TOUS_CONFIRMES, 0, "75056"), "p0-e0").raison, "ruleset-autre-commune");
  const enLimite = ruleset({}, { implantation_en_limite: { autorisee: true } });
  const c = controle([rect(1, 6, 15, 15)], ok(enLimite), valider(enLimite, "separative"));
  assert.equal(limite(c, "p0-e3").raison, "implantation-en-limite-possible");
  assert.equal(limite(c, "p0-e3").verdict, "a-verifier");
});

test("bâtiment hors parcelle : limites franchies « non respecté », aucune autre « respecté »", () => {
  const rs = ruleset();
  const v = { ...valider(rs, "voirie"), ...valider(rs, "separative"), ...valider(rs, "fond") };
  const c = controle([rect(25, 5, 30, 9)], ok(rs), v);
  assert.equal(limite(c, "p0-e1").verdict, "non-respecte");
  assert.ok(c.batiments[0]!.limites.every((l) => l.verdict !== "respecte"));
  assert.equal(c.batiments[0]!.verdict, "non-respecte");
  assert.match(c.libelleNiveau, /déborde de la parcelle/);
  const diag = controle([rect(18, 18, 22, 22)], ok(rs), v);
  assert.equal(limite(diag, "p0-e1").verdict, "non-respecte");
  assert.equal(limite(diag, "p0-e2").verdict, "non-respecte");
});

test("ancien format (legacyRulesetToResolved) : le fond n'est pas déduit des séparatives", () => {
  const legacy = { version: "plu_ruleset_v1", zone_code: "UA", zone_libelle: null, reculs: { voirie: { min_m: 5, note: null }, limites_separatives: { min_m: 3, note: null }, facades: { avant: { min_m: 5 }, laterales: { min_m: 3 }, fond: { min_m: 3 } } }, completeness: { ok: true, missing: [] } };
  const r = extraireReglesRetrait(legacy);
  assert.equal(r.fond.valeur, null);
  assert.equal(r.voirie.valeur, 5);
  assert.equal(r.voirie.provenance.documentId, null);
  assert.equal(motifNonSourcee(r.voirie, null), "regle-non-sourcee");
  assert.equal(motifNonSourcee(r.fond, null), "valeur-absente");
});

test("lecture du ruleset depuis un stockage simulé isolé par utilisateur (u:{userId}:{base})", () => {
  const physique = new Map<string, string>();
  const scoped = (uid: string | null) => ({
    getItem: (k: string) => physique.get(uid ? `u:${uid}:${k}` : k) ?? null,
    setItem: (k: string, v: string) => void physique.set(uid ? `u:${uid}:${k}` : k, v),
  });
  physique.set(`u:alice:${CLE_RULESET}`, JSON.stringify(ruleset()));
  const a = lireRulesetPlu(scoped("alice"));
  assert.equal(a.statut, "ok");
  assert.equal(a.statut === "ok" && extraireReglesRetrait(a.ruleset).separative.valeur, 3);
  assert.deepEqual(lireRulesetPlu(scoped("bob")), { statut: "absent" });
  physique.set(`u:bob:${CLE_RULESET}`, "{pas du json");
  assert.equal(lireRulesetPlu(scoped("bob")).statut, "illisible");
  physique.set(`u:carol:${CLE_RULESET}`, JSON.stringify({ version: "plu_ruleset_v2", hauteurs: {} }));
  assert.deepEqual(lireRulesetPlu(scoped("carol")), { statut: "format-inconnu", version: "plu_ruleset_v2" });
  assert.equal(lireRulesetPlu({ getItem: () => { throw new Error("SecurityError"); } }).statut, "illisible");
  // validations : aller-retour par étude
  const v = valider(ruleset(), "voirie");
  ecrireValidations(scoped("alice"), "S1", v);
  assert.deepEqual(lireValidations(scoped("alice"), "S1"), v);
  assert.deepEqual(lireValidations(scoped("alice"), "S2"), {});
  assert.deepEqual(lireValidations(scoped("bob"), "S1"), {});
});

test("deux bâtiments : verdicts indépendants", () => {
  const rs = ruleset();
  const v = { ...valider(rs, "voirie"), ...valider(rs, "fond") };
  const c = controle([rect(5, 6, 9, 10, "A"), rect(11, 4.5, 15, 10, "B")], ok(rs), v);
  assert.equal(limite(c, "p0-e0", 0).verdict, "respecte");
  assert.equal(limite(c, "p0-e0", 1).verdict, "non-respecte");
  assert.equal(c.batiments[1]!.verdict, "non-respecte");
});
