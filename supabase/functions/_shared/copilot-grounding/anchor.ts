export type AnchorType = 'cadastral_parcel' | 'address_point' | 'coordinate_point' | 'municipality_centroid' | 'none';

export interface GeographicAnchor {
  anchor_type: AnchorType;
  cadastral_resolved: boolean;
  geometry_basis: 'cadastre_centroid' | 'address_geocode' | 'provided_coordinates' | 'municipality_centroid' | 'none';
  claim_permissions: {
    parcel_identity: boolean;
    parcel_intersection: boolean;
    parcel_surface: boolean;
    point_measurements: boolean;
    municipality_claims: boolean;
  };
}

export function deriveGeographicAnchor(input: {
  cadastralResolved: boolean;
  hasCoordinates: boolean;
  coordinatesFromCadastre?: boolean;
  coordinatesFromMunicipality?: boolean;
  hasAddress?: boolean;
  hasCadastralSurface?: boolean;
}): GeographicAnchor {
  const cadastral = input.cadastralResolved === true;
  let anchor_type: AnchorType = 'none';
  let geometry_basis: GeographicAnchor['geometry_basis'] = 'none';

  if (cadastral) {
    anchor_type = 'cadastral_parcel';
    geometry_basis = 'cadastre_centroid';
  } else if (input.coordinatesFromMunicipality) {
    anchor_type = 'municipality_centroid';
    geometry_basis = 'municipality_centroid';
  } else if (input.hasCoordinates) {
    anchor_type = input.hasAddress ? 'address_point' : 'coordinate_point';
    geometry_basis = input.hasAddress ? 'address_geocode' : 'provided_coordinates';
  }

  return {
    anchor_type,
    cadastral_resolved: cadastral,
    geometry_basis,
    claim_permissions: {
      parcel_identity: cadastral,
      // La résolution API Carto fournit ici un centroïde, pas une géométrie
      // d'intersection opposable. Une source aval doit démontrer elle-même
      // l'intersection avant de promouvoir la portée à `parcel`.
      parcel_intersection: false,
      parcel_surface: cadastral && input.hasCadastralSurface === true,
      point_measurements: input.hasCoordinates && !input.coordinatesFromMunicipality,
      municipality_claims: true,
    },
  };
}

export function groundingProhibitions(anchor: GeographicAnchor): string[] {
  if (anchor.cadastral_resolved) return [];
  return [
    "Ne pas affirmer qu'une parcelle cadastrale est confirmée ou résolue.",
    "Ne pas affirmer une intersection avec la parcelle sans géométrie cadastrale et résultat explicite d'intersection.",
    "Ne pas calculer ni commenter une emprise au sol, une surface parcellaire ou un prix au m² de terrain.",
    "Ne pas transformer un risque communal ou situé à proximité (inondation, CATNAT, SEVESO, SIS) en exposition de la parcelle.",
    "Ne pas déduire un coût ou une absence de terrassement d'une pente mesurée en un point.",
    "Ne pas déduire une intervention ABF du nombre de monuments recensés dans la commune ou à proximité.",
  ];
}
