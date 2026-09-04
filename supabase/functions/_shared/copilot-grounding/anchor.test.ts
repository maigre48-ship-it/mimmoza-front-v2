import { deriveGeographicAnchor, groundingProhibitions } from './anchor.ts';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

Deno.test('coordinates associated with an address remain an address point', () => {
  const anchor = deriveGeographicAnchor({ cadastralResolved: false, hasCoordinates: true, hasAddress: true });
  assert(anchor.anchor_type === 'address_point', 'expected address_point');
  assert(anchor.cadastral_resolved === false, 'cadastre must remain unresolved');
  assert(anchor.claim_permissions.point_measurements, 'point measurements should be allowed');
  assert(!anchor.claim_permissions.parcel_intersection, 'parcel intersection must be forbidden');
  assert(groundingProhibitions(anchor).length >= 6, 'unresolved anchor needs explicit prohibitions');
});

Deno.test('successful cadastre resolution grants cadastral permissions', () => {
  const anchor = deriveGeographicAnchor({ cadastralResolved: true, hasCoordinates: true, coordinatesFromCadastre: true, hasCadastralSurface: true });
  assert(anchor.anchor_type === 'cadastral_parcel', 'expected cadastral_parcel');
  assert(anchor.claim_permissions.parcel_identity, 'parcel identity should be allowed');
  assert(!anchor.claim_permissions.parcel_intersection, 'a cadastre centroid alone must not prove an intersection');
  assert(anchor.claim_permissions.parcel_surface, 'cadastral surface should be allowed');
  assert(groundingProhibitions(anchor).length === 0, 'resolved parcel should not receive unresolved prohibitions');
});

Deno.test('municipality fallback never grants point or parcel permissions', () => {
  const anchor = deriveGeographicAnchor({ cadastralResolved: false, hasCoordinates: true, coordinatesFromMunicipality: true });
  assert(anchor.anchor_type === 'municipality_centroid', 'expected municipality_centroid');
  assert(!anchor.claim_permissions.point_measurements, 'centroid is not a precise point measurement');
  assert(!anchor.claim_permissions.parcel_identity, 'parcel identity must be forbidden');
});
