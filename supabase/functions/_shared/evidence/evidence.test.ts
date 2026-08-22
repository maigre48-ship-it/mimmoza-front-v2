import { createEvidence, fromLegacyEvidence, isEvidence, validateEvidence } from "./evidence.ts";

function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

Deno.test("createEvidence normalizes text, dates and defaults", () => {
  const evidence = createEvidence({
    value: 245_000, source_id: "  dvf  ", source_label: "  Demandes de valeurs foncières  ",
    source_url: " https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres/ ",
    source_date: "2025-01-15", retrieved_at: "2026-08-21T10:30:00+02:00",
    scope: "parcel", geo_precision: "parcel", confidence: 0.92,
  });
  assertEquals(evidence.source_id, "dvf");
  assertEquals(evidence.source_label, "Demandes de valeurs foncières");
  assertEquals(evidence.status, "available");
  assertEquals(evidence.source_date, "2025-01-15T00:00:00.000Z");
  assertEquals(evidence.retrieved_at, "2026-08-21T08:30:00.000Z");
  assert(isEvidence(evidence));
});

Deno.test("createEvidence rejects confidence outside 0..1", () => {
  let error: unknown;
  try {
    createEvidence({ value: null, source_id: "test", source_label: "Test", scope: "custom", geo_precision: "unknown", confidence: 1.1 });
  } catch (caught) { error = caught; }
  assert(error instanceof RangeError);
});

Deno.test("validateEvidence reports malformed fields", () => {
  const result = validateEvidence({ value: 12, source_id: "", source_label: "Source", retrieved_at: "not-a-date", scope: "street", geo_precision: "gps-ish", confidence: -0.2, status: "ok" });
  assertEquals(result.valid, false);
  assert(result.errors.length >= 6, `Expected at least 6 errors, received ${result.errors.length}`);
});

Deno.test("fromLegacyEvidence converts camelCase fields", () => {
  const evidence = fromLegacyEvidence({
    value: { zone: "UA" }, sourceId: "gpu", sourceLabel: "Géoportail de l'urbanisme",
    retrievedAt: new Date("2026-08-21T12:00:00Z"), scope: "parcel", geoPrecision: "parcel",
    confidence: 1, warning: "  Document à confirmer auprès de la commune.  ",
  });
  assertEquals(evidence.source_id, "gpu");
  assertEquals(evidence.warning, "Document à confirmer auprès de la commune.");
});

Deno.test("null is accepted as an explicit value", () => {
  const evidence = createEvidence({ value: null, source_id: "georisques", source_label: "Géorisques", retrieved_at: "2026-08-21T12:00:00Z", scope: "address", geo_precision: "address", confidence: 1, status: "not_found" });
  assert(isEvidence(evidence));
});
