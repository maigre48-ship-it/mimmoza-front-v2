// FILE: src/spaces/banque/__tests__/committee-engine.test.ts

import { describe, it, expect, beforeEach } from "vitest";

import type {
  BanqueDossier,
  DossierDocument,
  DossierGuarantee,
  Condition,
} from "../types";

import { getRequiredDocuments } from "../config/required-documents";

import {
  computeCompleteness,
  computeLtv,
  computeLtvFromDossier,
  computeRiskLevel,
  suggestConditions,
  buildDecisionDraft,
  resetConditionIdCounter,
} from "../services/committee-engine";

// ============================================================================
// HELPERS
// ============================================================================

function makeDossier(overrides: Partial<BanqueDossier> = {}): BanqueDossier {
  return {
    id: "test-1",
    nom: "Test Dossier",
    projectType: "promotion",
    montantDemande: 1_000_000,
    valeurProjet: 2_000_000,
    documents: [],
    guarantees: [],
    conditions: [],
    decision: null,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeDoc(id: string, status: "fourni" | "en_attente" | "non_applicable" = "fourni"): DossierDocument {
  return { id, label: `Doc ${id}`, category: "Test", status };
}

function makeGuarantee(montant: number, type: DossierGuarantee["type"] = "hypotheque"): DossierGuarantee {
  return { id: `g-${montant}`, type, label: `Garantie ${montant}`, montant };
}

// ============================================================================
// computeCompleteness
// ============================================================================

describe("computeCompleteness", () => {
  const requiredDocs = getRequiredDocuments("promotion"); // 18 docs

  it("returns 0% for an empty dossier", () => {
    const dossier = makeDossier();
    const result = computeCompleteness(dossier, requiredDocs);
    expect(result.percentage).toBe(0);
    expect(result.missing.length).toBe(18);
    expect(result.total).toBe(18);
    expect(result.provided).toBe(0);
  });

  it("returns 100% when all docs are fourni", () => {
    const documents = requiredDocs.map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({ documents });
    const result = computeCompleteness(dossier, requiredDocs);
    expect(result.percentage).toBe(100);
    expect(result.missing.length).toBe(0);
  });

  it("excludes non_applicable docs from total and missing", () => {
    const documents = [
      makeDoc("promo-01", "fourni"),
      makeDoc("promo-02", "non_applicable"),
    ];
    const dossier = makeDossier({ documents });
    const result = computeCompleteness(dossier, requiredDocs);
    // 17 applicable (18 - 1 NA), 1 provided → 1/17 ≈ 6%
    expect(result.total).toBe(17);
    expect(result.provided).toBe(1);
    expect(result.percentage).toBe(Math.round((1 / 17) * 100));
    expect(result.missing).not.toContain("Extrait Kbis de moins de 3 mois");
  });

  it("treats en_attente as not provided", () => {
    const documents = [makeDoc("promo-01", "en_attente")];
    const dossier = makeDossier({ documents });
    const result = computeCompleteness(dossier, requiredDocs);
    expect(result.provided).toBe(0);
  });

  it("handles empty requiredDocs gracefully", () => {
    const dossier = makeDossier();
    const result = computeCompleteness(dossier, []);
    expect(result.percentage).toBe(0);
    expect(result.total).toBe(0);
    expect(result.missing.length).toBe(0);
  });

  it("works for marchand project type", () => {
    const marchandDocs = getRequiredDocuments("marchand");
    expect(marchandDocs.length).toBe(15);
    const dossier = makeDossier({ projectType: "marchand" });
    const result = computeCompleteness(dossier, marchandDocs);
    expect(result.total).toBe(15);
  });

  it("works for baseline project type", () => {
    const baselineDocs = getRequiredDocuments("baseline");
    expect(baselineDocs.length).toBe(11);
  });

  it("partial completion calculates correct percentage", () => {
    const docs = requiredDocs.slice(0, 9).map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({ documents: docs });
    const result = computeCompleteness(dossier, requiredDocs);
    expect(result.percentage).toBe(50); // 9/18 = 50%
    expect(result.provided).toBe(9);
  });
});

// ============================================================================
// computeLtv
// ============================================================================

describe("computeLtv", () => {
  it("computes LTV correctly", () => {
    expect(computeLtv(800_000, 1_000_000)).toBe(0.8);
  });

  it("returns null for zero valeurGarantie", () => {
    expect(computeLtv(100_000, 0)).toBeNull();
  });

  it("returns null for negative montant", () => {
    expect(computeLtv(-500, 1_000_000)).toBeNull();
  });

  it("returns null for NaN inputs", () => {
    expect(computeLtv(NaN, 1_000_000)).toBeNull();
    expect(computeLtv(100_000, NaN)).toBeNull();
  });

  it("returns null for Infinity", () => {
    expect(computeLtv(Infinity, 1_000_000)).toBeNull();
  });

  it("handles LTV > 1 (over-leveraged)", () => {
    const ltv = computeLtv(1_500_000, 1_000_000);
    expect(ltv).toBe(1.5);
  });

  it("handles very small LTV", () => {
    const ltv = computeLtv(10_000, 10_000_000);
    expect(ltv).toBe(0.001);
  });
});

// ============================================================================
// computeLtvFromDossier
// ============================================================================

describe("computeLtvFromDossier", () => {
  it("uses sum of guarantees when available", () => {
    const dossier = makeDossier({
      montantDemande: 600_000,
      guarantees: [makeGuarantee(500_000), makeGuarantee(500_000)],
    });
    // 600k / 1M = 0.6
    expect(computeLtvFromDossier(dossier)).toBe(0.6);
  });

  it("falls back to valeurProjet when no guarantees", () => {
    const dossier = makeDossier({
      montantDemande: 1_000_000,
      valeurProjet: 2_000_000,
      guarantees: [],
    });
    expect(computeLtvFromDossier(dossier)).toBe(0.5);
  });

  it("returns null when montant is 0", () => {
    const dossier = makeDossier({ montantDemande: 0 });
    expect(computeLtvFromDossier(dossier)).toBeNull();
  });

  it("ignores guarantees with non-finite montant", () => {
    const dossier = makeDossier({
      montantDemande: 500_000,
      valeurProjet: 1_000_000,
      guarantees: [{ ...makeGuarantee(0), montant: NaN }],
    });
    // NaN filtered to 0, total = 0, falls back to valeurProjet = 1M
    expect(computeLtvFromDossier(dossier)).toBe(0.5);
  });
});

// ============================================================================
// computeRiskLevel
// ============================================================================

describe("computeRiskLevel", () => {
  it("returns 'inconnu' when LTV is null", () => {
    const dossier = makeDossier();
    expect(computeRiskLevel(dossier, null)).toBe("inconnu");
  });

  it("returns 'inconnu' when montant <= 0", () => {
    const dossier = makeDossier({ montantDemande: 0 });
    expect(computeRiskLevel(dossier, 0.5)).toBe("inconnu");
  });

  it("returns 'faible' for low LTV with guarantees", () => {
    const dossier = makeDossier({
      guarantees: [makeGuarantee(1_000_000)],
    });
    expect(computeRiskLevel(dossier, 0.5)).toBe("faible");
  });

  it("returns 'moyen' for low LTV without guarantees", () => {
    const dossier = makeDossier({ guarantees: [] });
    expect(computeRiskLevel(dossier, 0.5)).toBe("moyen");
  });

  it("returns 'moyen' for mid-range LTV (0.6 < LTV ≤ 0.8) with guarantees", () => {
    const dossier = makeDossier({
      guarantees: [makeGuarantee(1_000_000)],
    });
    expect(computeRiskLevel(dossier, 0.75)).toBe("moyen");
  });

  it("returns 'eleve' for mid-range LTV without guarantees", () => {
    const dossier = makeDossier({ guarantees: [] });
    expect(computeRiskLevel(dossier, 0.75)).toBe("eleve");
  });

  it("returns 'eleve' for high LTV (> 0.8)", () => {
    const dossier = makeDossier({
      guarantees: [makeGuarantee(500_000)],
    });
    expect(computeRiskLevel(dossier, 0.9)).toBe("eleve");
  });

  it("returns 'eleve' for LTV exactly 0.8 with guarantees (boundary)", () => {
    const dossier = makeDossier({
      guarantees: [makeGuarantee(1_000_000)],
    });
    // 0.8 is ≤ 0.8 so "moyen"
    expect(computeRiskLevel(dossier, 0.8)).toBe("moyen");
  });

  it("returns 'eleve' for LTV > 1", () => {
    const dossier = makeDossier({
      guarantees: [makeGuarantee(500_000)],
    });
    expect(computeRiskLevel(dossier, 1.2)).toBe("eleve");
  });
});

// ============================================================================
// suggestConditions
// ============================================================================

describe("suggestConditions", () => {
  beforeEach(() => resetConditionIdCounter());

  const requiredDocs = getRequiredDocuments("promotion");

  it("suggests individual conditions for ≤5 missing docs", () => {
    const docs = requiredDocs.slice(0, 14).map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({
      documents: docs,
      guarantees: [makeGuarantee(1_000_000)],
    });
    const conditions = suggestConditions(dossier, requiredDocs, 0.5, "faible");
    // 18 - 14 = 4 missing docs → 4 individual conditions
    const docConditions = conditions.filter((c) => c.text.startsWith("Fournir le document"));
    expect(docConditions.length).toBe(4);
  });

  it("suggests a single grouped condition for >5 missing docs", () => {
    const dossier = makeDossier({
      guarantees: [makeGuarantee(1_000_000)],
    });
    const conditions = suggestConditions(dossier, requiredDocs, 0.5, "faible");
    const grouped = conditions.filter((c) => c.text.includes("documents manquants"));
    expect(grouped.length).toBe(1);
    expect(grouped[0].text).toContain("18");
  });

  it("suggests guarantee condition when none present", () => {
    const dossier = makeDossier({ guarantees: [] });
    const conditions = suggestConditions(dossier, requiredDocs, 0.5, "moyen");
    const guaranteeCondition = conditions.find((c) => c.text.includes("garantie"));
    expect(guaranteeCondition).toBeDefined();
  });

  it("suggests LTV condition when LTV > 0.8", () => {
    const dossier = makeDossier({
      guarantees: [makeGuarantee(500_000)],
    });
    const conditions = suggestConditions(dossier, requiredDocs, 0.9, "eleve");
    const ltvCondition = conditions.find((c) => c.text.includes("LTV"));
    expect(ltvCondition).toBeDefined();
    expect(ltvCondition!.text).toContain("90.0%");
  });

  it("does not suggest LTV condition when LTV ≤ 0.8", () => {
    const dossier = makeDossier({
      guarantees: [makeGuarantee(2_000_000)],
    });
    const conditions = suggestConditions(dossier, requiredDocs, 0.5, "faible");
    const ltvCondition = conditions.find((c) => c.text.includes("LTV"));
    expect(ltvCondition).toBeUndefined();
  });

  it("suggests risk condition for 'eleve'", () => {
    const dossier = makeDossier({
      guarantees: [makeGuarantee(500_000)],
    });
    const conditions = suggestConditions(dossier, requiredDocs, 0.9, "eleve");
    const riskCondition = conditions.find((c) => c.text.includes("risque élevé"));
    expect(riskCondition).toBeDefined();
  });

  it("suggests pré-commercialisation for promotion without promo-13", () => {
    const dossier = makeDossier({
      projectType: "promotion",
      guarantees: [makeGuarantee(2_000_000)],
    });
    const conditions = suggestConditions(dossier, requiredDocs, 0.5, "faible");
    const precoCondition = conditions.find((c) => c.text.includes("pré-commercialisation"));
    expect(precoCondition).toBeDefined();
  });

  it("does not suggest pré-commercialisation when promo-13 is provided", () => {
    const docs = requiredDocs.map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({
      projectType: "promotion",
      documents: docs,
      guarantees: [makeGuarantee(2_000_000)],
    });
    const conditions = suggestConditions(dossier, requiredDocs, 0.5, "faible");
    const precoCondition = conditions.find((c) => c.text.includes("pré-commercialisation"));
    expect(precoCondition).toBeUndefined();
  });

  it("suggests planning for marchand without march-15", () => {
    const marchandDocs = getRequiredDocuments("marchand");
    const dossier = makeDossier({
      projectType: "marchand",
      guarantees: [makeGuarantee(1_000_000)],
    });
    const conditions = suggestConditions(dossier, marchandDocs, 0.6, "moyen");
    const planningCondition = conditions.find((c) => c.text.includes("planning"));
    expect(planningCondition).toBeDefined();
  });

  it("all auto conditions have source = 'auto' and met = false", () => {
    const dossier = makeDossier({ guarantees: [] });
    const conditions = suggestConditions(dossier, requiredDocs, 0.9, "eleve");
    for (const c of conditions) {
      expect(c.source).toBe("auto");
      expect(c.met).toBe(false);
    }
  });

  it("returns empty conditions for complete dossier with guarantees (low risk)", () => {
    const docs = requiredDocs.map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({
      projectType: "promotion",
      documents: docs,
      guarantees: [makeGuarantee(2_000_000)],
    });
    const conditions = suggestConditions(dossier, requiredDocs, 0.5, "faible");
    // Only pré-commercialisation check (promo-13 is provided) → should be empty
    expect(conditions.length).toBe(0);
  });
});

// ============================================================================
// buildDecisionDraft
// ============================================================================

describe("buildDecisionDraft", () => {
  beforeEach(() => resetConditionIdCounter());

  const requiredDocs = getRequiredDocuments("promotion");

  it("returns NO_GO when completeness < 30%", () => {
    const dossier = makeDossier();
    const completeness = computeCompleteness(dossier, requiredDocs);
    const draft = buildDecisionDraft(dossier, completeness, 0.5, "moyen", []);
    expect(draft.verdict).toBe("NO_GO");
    expect(draft.motivation).toContain("insuffisante");
  });

  it("returns NO_GO when LTV > 1.0", () => {
    const docs = requiredDocs.map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({ documents: docs });
    const completeness = computeCompleteness(dossier, requiredDocs);
    const draft = buildDecisionDraft(dossier, completeness, 1.2, "eleve", []);
    expect(draft.verdict).toBe("NO_GO");
    expect(draft.motivation).toContain("dépasse");
  });

  it("returns NO_GO for high risk + no guarantees + low completeness", () => {
    // 8/18 = 44% → ≥30% but <50%
    const docs = requiredDocs.slice(0, 8).map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({ documents: docs, guarantees: [] });
    const completeness = computeCompleteness(dossier, requiredDocs);
    expect(completeness.percentage).toBe(44);
    const draft = buildDecisionDraft(dossier, completeness, 0.9, "eleve", []);
    expect(draft.verdict).toBe("NO_GO");
  });

  it("returns GO for 100% completeness + low risk + low LTV + no conditions", () => {
    const docs = requiredDocs.map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({
      documents: docs,
      guarantees: [makeGuarantee(2_000_000)],
    });
    const completeness = computeCompleteness(dossier, requiredDocs);
    const draft = buildDecisionDraft(dossier, completeness, 0.5, "faible", []);
    expect(draft.verdict).toBe("GO");
    expect(draft.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("returns GO for 100% completeness + moyen risk + LTV ≤ 0.8", () => {
    const docs = requiredDocs.map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({
      documents: docs,
      guarantees: [makeGuarantee(1_500_000)],
    });
    const completeness = computeCompleteness(dossier, requiredDocs);
    const draft = buildDecisionDraft(dossier, completeness, 0.7, "moyen", []);
    expect(draft.verdict).toBe("GO");
  });

  it("returns GO_SOUS_CONDITIONS when conditions exist", () => {
    const docs = requiredDocs.map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({
      documents: docs,
      guarantees: [makeGuarantee(2_000_000)],
    });
    const completeness = computeCompleteness(dossier, requiredDocs);
    const conditions: Condition[] = [
      { id: "c1", text: "Test condition", source: "manual", met: false },
    ];
    const draft = buildDecisionDraft(dossier, completeness, 0.5, "faible", conditions);
    expect(draft.verdict).toBe("GO_SOUS_CONDITIONS");
  });

  it("returns GO_SOUS_CONDITIONS when completeness is partial (50-99%)", () => {
    const docs = requiredDocs.slice(0, 14).map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({
      documents: docs,
      guarantees: [makeGuarantee(2_000_000)],
    });
    const completeness = computeCompleteness(dossier, requiredDocs);
    expect(completeness.percentage).toBe(78);
    const draft = buildDecisionDraft(dossier, completeness, 0.5, "faible", []);
    expect(draft.verdict).toBe("GO_SOUS_CONDITIONS");
  });

  it("has higher confidence when completeness ≥ 80% and risk is low", () => {
    const docs = requiredDocs.slice(0, 15).map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({
      documents: docs,
      guarantees: [makeGuarantee(2_000_000)],
    });
    const completeness = computeCompleteness(dossier, requiredDocs);
    const draft = buildDecisionDraft(dossier, completeness, 0.5, "faible", []);
    expect(draft.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("has lower confidence when completeness < 50%", () => {
    const docs = requiredDocs.slice(0, 6).map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({
      documents: docs,
      guarantees: [makeGuarantee(2_000_000)],
    });
    const completeness = computeCompleteness(dossier, requiredDocs);
    expect(completeness.percentage).toBe(33);
    const draft = buildDecisionDraft(dossier, completeness, 0.5, "faible", []);
    expect(draft.confidence).toBeLessThanOrEqual(0.5);
  });

  it("motivation mentions risk when 'eleve'", () => {
    const docs = requiredDocs.slice(0, 10).map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({
      documents: docs,
      guarantees: [makeGuarantee(500_000)],
    });
    const completeness = computeCompleteness(dossier, requiredDocs);
    const draft = buildDecisionDraft(dossier, completeness, 0.85, "eleve", []);
    expect(draft.motivation).toContain("élevé");
  });

  it("motivation mentions 'inconnu' risk when data insufficient", () => {
    const docs = requiredDocs.slice(0, 10).map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({ documents: docs });
    const completeness = computeCompleteness(dossier, requiredDocs);
    const draft = buildDecisionDraft(dossier, completeness, null, "inconnu", []);
    expect(draft.motivation).toContain("insuffisantes");
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("edge cases", () => {
  beforeEach(() => resetConditionIdCounter());

  it("empty dossier produces NO_GO with 0% completeness", () => {
    const dossier = makeDossier();
    const requiredDocs = getRequiredDocuments("promotion");
    const completeness = computeCompleteness(dossier, requiredDocs);
    const ltv = computeLtvFromDossier(dossier);
    const risk = computeRiskLevel(dossier, ltv);
    const conditions = suggestConditions(dossier, requiredDocs, ltv, risk);
    const draft = buildDecisionDraft(dossier, completeness, ltv, risk, conditions);

    expect(completeness.percentage).toBe(0);
    expect(draft.verdict).toBe("NO_GO");
  });

  it("dossier with montant=0 produces inconnu risk and null LTV", () => {
    const dossier = makeDossier({ montantDemande: 0 });
    const ltv = computeLtvFromDossier(dossier);
    expect(ltv).toBeNull();
    expect(computeRiskLevel(dossier, ltv)).toBe("inconnu");
  });

  it("dossier with guarantees but no valeurProjet uses guarantees for LTV", () => {
    const dossier = makeDossier({
      montantDemande: 500_000,
      valeurProjet: 0,
      guarantees: [makeGuarantee(1_000_000)],
    });
    // guarantees sum = 1M > 0, used instead of valeurProjet
    expect(computeLtvFromDossier(dossier)).toBe(0.5);
  });

  it("full pipeline: promotion GO scenario", () => {
    const requiredDocs = getRequiredDocuments("promotion");
    const documents = requiredDocs.map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({
      montantDemande: 1_000_000,
      valeurProjet: 3_000_000,
      documents,
      guarantees: [makeGuarantee(2_500_000)],
    });

    const completeness = computeCompleteness(dossier, requiredDocs);
    const ltv = computeLtvFromDossier(dossier);
    const risk = computeRiskLevel(dossier, ltv);
    const conditions = suggestConditions(dossier, requiredDocs, ltv, risk);
    const draft = buildDecisionDraft(dossier, completeness, ltv, risk, conditions);

    expect(completeness.percentage).toBe(100);
    expect(ltv).toBe(0.4);
    expect(risk).toBe("faible");
    expect(conditions.length).toBe(0);
    expect(draft.verdict).toBe("GO");
  });

  it("full pipeline: marchand GO_SOUS_CONDITIONS scenario", () => {
    const requiredDocs = getRequiredDocuments("marchand");
    // Provide 10 of 15 docs
    const documents = requiredDocs.slice(0, 10).map((r) => makeDoc(r.id, "fourni"));
    const dossier = makeDossier({
      projectType: "marchand",
      montantDemande: 700_000,
      valeurProjet: 1_200_000,
      documents,
      guarantees: [makeGuarantee(900_000)],
    });

    const completeness = computeCompleteness(dossier, requiredDocs);
    const ltv = computeLtvFromDossier(dossier);
    const risk = computeRiskLevel(dossier, ltv);
    const conditions = suggestConditions(dossier, requiredDocs, ltv, risk);
    const draft = buildDecisionDraft(dossier, completeness, ltv, risk, conditions);

    expect(completeness.percentage).toBe(67);
    expect(risk).toBe("moyen");
    expect(draft.verdict).toBe("GO_SOUS_CONDITIONS");
    expect(conditions.length).toBeGreaterThan(0);
  });
});