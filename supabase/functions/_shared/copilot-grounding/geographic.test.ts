import { detectGeographicOverclaims, geographicGroundingPolicy } from './geographic.ts';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

Deno.test('policy contains the mandatory geographic distinctions', () => {
  const policy = geographicGroundingPolicy();
  for (const marker of ['CATNAT', 'Altitude basse', 'SEVESO/ICPE', 'SISPEA', 'OLD', 'Pente ponctuelle', 'SIS à proximité', 'intersection géométrique']) assert(policy.includes(marker), `missing policy marker: ${marker}`);
});

Deno.test('detects known parcel-level overclaims', () => {
  const response = 'Les arrêtés CATNAT prouvent que la parcelle est inondable. L’altitude faible confirme donc un risque de crue. Le site SEVESO à proximité place le terrain dans le périmètre PPRT. La pente indique qu’il n’y aura pas de surcoût de terrassement.';
  const codes = detectGeographicOverclaims(response).map((item) => item.code);
  for (const code of ['CATNAT_PARCEL_INFERENCE', 'LOW_ALTITUDE_FLOOD_PROOF', 'NEARBY_SEVESO_PPRT_INFERENCE', 'SLOPE_GEOTECHNICAL_INFERENCE']) assert(codes.includes(code), `${code} not detected`);
});

Deno.test('accepts scoped and qualified wording', () => {
  const response = 'À l’échelle de la commune, 12 CATNAT sont recensés : c’est un indicateur, à vérifier à la parcelle par intersection géométrique. Un site SEVESO est recensé dans un rayon de 5 km, sans preuve que l’adresse soit dans un PPRT.';
  assert(detectGeographicOverclaims(response).length === 0, 'qualified wording should not be flagged');
});
