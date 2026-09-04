import { detectUnsupportedInferences, unsupportedInferencePolicy } from './inferences.ts';
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

Deno.test('policy states mandatory safeguards', () => {
  const policy = unsupportedInferencePolicy();
  for (const marker of ['get_etude_parcelle', 'G1', 'THRS', 'proximité immédiate', 'marché actif', 'ABF']) assert(policy.includes(marker), `missing: ${marker}`);
});

Deno.test('detects unsupported business inferences', () => {
  const response = 'Le rendement brut est calculé avec le loyer communal et le prix DVF. La pente rend le terrain aisément aménageable et sans surcoût de terrassement. Une étude G2 est obligatoire. La majoration THRS concerne les logements vacants. Le SPR est à proximité immédiate et l’intervention ABF est quasi certaine. Cette avenue structurante dessert un marché actif avec une demande soutenue et des risques élevés.';
  const codes = detectUnsupportedInferences(response).map((item) => item.code);
  for (const code of ['SPONTANEOUS_PARCEL_YIELD', 'SLOPE_COST_OR_FAVORABILITY', 'GEOTECH_LEGAL_OVERCLAIM', 'THRS_VACANT_CONFUSION', 'UNMEASURED_IMMEDIATE_PROXIMITY', 'STREET_NAME_CHARACTERIZATION', 'UNSOURCED_QUALITATIVE_LABEL', 'SPR_ABF_CERTAINTY']) assert(codes.includes(code), `${code} not detected`);
});

Deno.test('accepts qualified wording', () => {
  const response = "Un SPR est recensé dans la commune, sans intersection démontrée : l’intervention de l’ABF reste à vérifier. L’aléa argile justifie de déterminer avec un professionnel la mission géotechnique adaptée et de vérifier le champ d’application juridique.";
  assert(detectUnsupportedInferences(response).length === 0, 'qualified wording flagged');
});
