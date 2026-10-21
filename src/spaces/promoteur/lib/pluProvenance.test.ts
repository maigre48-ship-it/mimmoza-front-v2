// Tests L2 — provenance PLU par valeur (node:test, imports .ts).
import assert from "node:assert/strict";
import test from "node:test";
import {
  AGE_DOCUMENT_ALERTE_ANS, EXTRAIT_MAX, PROVENANCE_VERSION, debutsPages, empreinteSource, enrichirRulesetResolu, estReferenceDocumentaire,
  etatDateDocument, libelleSourceDocumentaire, lireProvenancePlu,
} from "./pluProvenance.ts";
import { resolvePluRulesetV1 } from "./pluRulesetResolver.ts";

// Ruleset tel que l'écrit legacyRulesetToResolved (FoncierPluPage) — ancien format
const legacy = (): Record<string, unknown> => ({
  version: "plu_ruleset_v1", zone_code: "UB", zone_libelle: "Zone urbaine dense",
  hauteur: { max_m: 7, faitage_m: 10, note: null },
  ces: { max_ratio: 0.4, note: null },
  reculs: { voirie: { min_m: 5, note: "Alignement ou recul" }, limites_separatives: { min_m: 3, note: null }, facades: { avant: { min_m: 5 }, laterales: { min_m: 3 }, fond: { min_m: 3 } } },
  stationnement: { par_logement: 2, note: null },
  pleine_terre: { ratio_min: 0.3, note: null },
  cos: { max: null, note: null },
  completeness: { ok: true, missing: [] },
});

const P = (champ: string, valeur: number | null, extra: Record<string, unknown> = {}) => ({
  champ, valeur, regle: null, article: "7", article_intitule: "ARTICLE UB 7", article_zone_qualifie: true, article_zone: "UB",
  extrait: `… texte de l'article contenant ${valeur} m …`, page: 12, methode: "regex", confiance: 0.7, motif: null, ...extra,
});

// Réponse simulée de plu-parser 3.2.0
const reponse32 = () => ({
  success: true, commune_insee: "64065", parser_mode: "regex", provenance_version: PROVENANCE_VERSION,
  document: { id: "plu-txt-0123456789abcdef", intitule: "reglement.pdf", commune_insee: "64065", commune_nom: "Ascain", idurba: "64065_PLU_20230615", datvalid: "2023-07-01", date_approbation: "2023-06-15", nomfic: null, correspondance_gpu: "non-verifiee", empreinte_sha256: "0123456789abcdefa1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4", pages: 120 },
  zones_rulesets: [{
    zone_code: "UB", zone_libelle: "Zone urbaine dense",
    ruleset: { reculs: { voirie: { min_m: 5, regle: "ALIGNEMENT_OU_RETRAIT" }, limites_separatives: { min_m: 3, regle: "FIXED" } } },
    provenance: {
      "reculs.voirie.min_m": P("reculs.voirie.min_m", 5, { article: "6", regle: "ALIGNEMENT_OU_RETRAIT" }),
      "reculs.limites_separatives.min_m": P("reculs.limites_separatives.min_m", 3),
      "hauteur.hauteur_egout_m": P("hauteur.hauteur_egout_m", 7, { article: "10" }),
      "hauteur.hauteur_max_m": P("hauteur.hauteur_max_m", 7, { article: "10" }),
      "hauteur.hauteur_faitage_m": P("hauteur.hauteur_faitage_m", 10, { article: "10" }),
      "emprise_sol.emprise_sol_max": P("emprise_sol.emprise_sol_max", 0.4, { article: "9" }),
      "stationnement.places_par_logement": P("stationnement.places_par_logement", 2, { article: "12" }),
      "pleine_terre.min_pct": P("pleine_terre.min_pct", 30, { article: "13" }),
      "densite.cos_max": P("densite.cos_max", null, { article: "14", extrait: null, motif: "article-introuvable", confiance: 0 }),
    },
  }],
});

test("enrichissement : document, document_id, commune, provenance par valeur et type de règle", () => {
  const r = enrichirRulesetResolu(legacy(), reponse32(), "UB", "64065")!;
  assert.equal(r.version, "plu_ruleset_v1", "version inchangée (compatibilité des lecteurs)");
  assert.equal(r.provenance_version, PROVENANCE_VERSION);
  assert.equal(r.document_id, "plu-txt-0123456789abcdef");
  assert.equal(r.commune_insee, "64065");
  assert.equal(r.source, "plu-parser:regex");
  assert.equal((r.reculs as any).voirie.type, "ALIGNEMENT_OU_RETRAIT");
  const pp = lireProvenancePlu(r)!;
  assert.deepEqual(Object.keys(pp.valeurs).sort(), ["ces.max_ratio", "cos.max", "hauteur.faitage_m", "hauteur.max_m", "pleine_terre.ratio_min", "reculs.limites_separatives.min_m", "reculs.voirie.min_m", "stationnement.par_logement"]);
  assert.equal(pp.valeurs["pleine_terre.ratio_min"]!.valeur, 0.3);
  assert.equal(pp.valeurs["cos.max"]!.motif, "article-introuvable", "valeur absente : la raison est gardée");
  assert.equal(estReferenceDocumentaire(pp.valeurs["cos.max"], pp.document), false);
  assert.equal(pp.valeurs["reculs.limites_separatives.min_m"]!.page, 12);
  assert.equal(pp.document?.idurba, "64065_PLU_20230615");
  assert.ok(estReferenceDocumentaire(pp.valeurs["reculs.limites_separatives.min_m"], pp.document));
  assert.equal(libelleSourceDocumentaire(pp.valeurs["reculs.limites_separatives.min_m"]!, pp.document), "PLU de Ascain (64065_PLU_20230615), art. 7, p. 12");
});

test("ancienne réponse (plu-parser 3.1.0) : ruleset inchangé, sans provenance (commune complétée)", () => {
  const ancien = { success: true, parser_mode: "regex", zones_rulesets: [{ zone_code: "UB", ruleset: {} }] };
  const r = enrichirRulesetResolu(legacy(), ancien, "UB", "64065")!;
  assert.equal(r.provenance_version, undefined);
  assert.equal(r.document_id, undefined);
  assert.equal(r.commune_insee, "64065");
  assert.equal(lireProvenancePlu(r), null);
  assert.equal(enrichirRulesetResolu(null, reponse32(), "UB", "64065"), null);
});

test("une provenance dont la valeur diffère de la valeur résolue n'est PAS attachée", () => {
  const rep = reponse32();
  (rep.zones_rulesets[0]!.provenance as any)["reculs.limites_separatives.min_m"].valeur = 4;
  const r = enrichirRulesetResolu(legacy(), rep, "UB", "64065")!;
  assert.equal(lireProvenancePlu(r)!.valeurs["reculs.limites_separatives.min_m"], undefined);
});

test("lecture assainie : extrait borné, méthode inconnue rejetée, ancien v1 → null", () => {
  const r = { ...legacy(), provenance_version: PROVENANCE_VERSION, document: { id: "plu-txt-0123456789abcdef" }, provenance: {
    "reculs.voirie.min_m": { valeur: 5, article: 6, extrait: "x".repeat(900), page: 0, methode: "regex", confiance: 3 },
    "hauteur.max_m": { valeur: 7, methode: "devin" },
  } };
  const pp = lireProvenancePlu(r)!;
  const v = pp.valeurs["reculs.voirie.min_m"]!;
  assert.equal(v.extrait!.length, EXTRAIT_MAX);
  assert.equal(v.page, null);
  assert.equal(v.confiance, 1);
  assert.equal(v.article, "6");
  assert.equal(pp.valeurs["hauteur.max_m"], undefined);
  assert.equal(lireProvenancePlu(legacy()), null);
});

test("date du document : inconnue, récente, plus de N ans", () => {
  const now = new Date("2026-10-14T00:00:00Z");
  assert.equal(etatDateDocument(null, now).libelle, "Date du document inconnue");
  assert.equal(etatDateDocument({ id: "plu-txt-0123456789abcdef", intitule: null, communeInsee: null, communeNom: null, idurba: null, datvalid: null, dateApprobation: null, nomfic: null, correspondanceGpu: null, pages: null, empreinteSha256: null }, now).statut, "inconnue");
  const recent = etatDateDocument({ id: "a", intitule: null, communeInsee: null, communeNom: null, idurba: "x", datvalid: "2023-07-01", dateApprobation: "2023-06-15", nomfic: null, correspondanceGpu: null, pages: null, empreinteSha256: null }, now);
  assert.equal(recent.statut, "recente");
  assert.equal(recent.nature, "approbation");
  assert.match(recent.libelle, /approuvé le 15\/06\/2023/);
  const vieux = etatDateDocument({ id: "a", intitule: null, communeInsee: null, communeNom: null, idurba: null, datvalid: "2009-01-20", dateApprobation: null, nomfic: null, correspondanceGpu: null, pages: null, empreinteSha256: null }, now);
  assert.equal(vieux.statut, "ancienne");
  assert.match(vieux.libelle, new RegExp(`plus de ${AGE_DOCUMENT_ALERTE_ANS} ans`));
});

test("empreinte de la source : change avec l'extrait, la page ou le document", () => {
  const r = enrichirRulesetResolu(legacy(), reponse32(), "UB", "64065")!;
  const pp = lireProvenancePlu(r)!;
  const p = pp.valeurs["reculs.limites_separatives.min_m"]!;
  const e1 = empreinteSource(p, pp.document);
  assert.ok(e1);
  assert.notEqual(empreinteSource({ ...p, extrait: p.extrait + " modifié" }, pp.document), e1);
  assert.notEqual(empreinteSource({ ...p, page: 13 }, pp.document), e1);
  assert.notEqual(empreinteSource(p, { ...pp.document!, idurba: "autre" }), e1);
  assert.equal(empreinteSource({ ...p, extrait: null }, pp.document), null);
});

test("débuts de pages du texte envoyé (pages.join(\"\\n\"))", () => {
  const pages = ["abc", "", "de"];
  const t = pages.join("\n");
  const d = debutsPages(pages);
  assert.deepEqual(d, [0, 4, 5]);
  assert.equal(t.slice(d[2]!), "de");
});

test("résolveur : recopie la provenance de la ligne source, n'en invente pas", () => {
  const ligne = { document_id: "d1", commune_insee: "64065", zone_code: "UB", zone_libelle: null, confidence_score: null, source: null, created_at: "", rules: {} };
  assert.equal(resolvePluRulesetV1(ligne).provenance_version, undefined);
  const avec = resolvePluRulesetV1({ ...ligne, rules: { _provenance_v1: { document: { id: "plu-txt-0123456789abcdef" }, valeurs: { "hauteur.hauteur_max_m": { valeur: 7, methode: "regex" } } } } });
  assert.equal(avec.provenance_version, PROVENANCE_VERSION);
  assert.deepEqual(Object.keys(avec.provenance ?? {}), ["hauteur.max_m"]);
});
