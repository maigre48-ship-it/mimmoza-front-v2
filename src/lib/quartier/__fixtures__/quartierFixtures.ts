// src/lib/quartier/__fixtures__/quartierFixtures.ts
// VIS-70 — jeux d'essai.
//  · BPE et gares / arrêts : RÉELS, extraits le 27/11/2026 (lecture seule) de public.bpe_equipements et
//    public.mobility_stops du projet Supabase Mimmoza.
//  · OSM et SIRENE : FACTICES (« démo ») — Overpass et l'API Recherche d'entreprises sont refusés par le réseau de la
//    machine de test ; leur forme suit exactement les réponses réelles (Overpass JSON `out center tags`, items de
//    etablissements-sirene-v1).
// Ascain : parcelle 64065000AI0002 (maison hexagonale), centroïde approché du contour cadastral.

export const ASCAIN = { lat: 43.34797, lon: -1.62101, libelle: 'Maison hexagonale — Ascain', adresse: 'Ascain (64310)', communeInsee: '64065', precision: 'parcelle' as const,
  contour: [[-1.62138314, 43.34842995], [-1.62053462, 43.3475121], [-1.62086819, 43.34752045], [-1.62104468, 43.3476625], [-1.62130915, 43.34800831], [-1.62146652, 43.34823498], [-1.62148356, 43.34829967], [-1.62138314, 43.34842995]] as [number, number][] };

export const BPE_ASCAIN = [
  { typequ: 'C201', nomrs: 'COLLEGE CHANTACO', latitude: 43.3766, longitude: -1.638623, libcom: 'SAINT-JEAN-DE-LUZ' },
  { typequ: 'C302', nomrs: 'LP LYCEE DES METIERS RAMIRO ARRUE', latitude: 43.375283, longitude: -1.638339, libcom: 'SAINT-JEAN-DE-LUZ' },
  { typequ: 'C610', nomrs: 'LYCEE PROFESSIONNEL RAMIRO ARRUE', latitude: 43.375283, longitude: -1.638339, libcom: 'SAINT-JEAN-DE-LUZ' },
  { typequ: 'D307', nomrs: 'PHARMACIE ANDENIA', latitude: 43.376157, longitude: -1.639206, libcom: 'SAINT-JEAN-DE-LUZ' },
  { typequ: 'A206', nomrs: 'ASCAIN BP', latitude: 43.345358, longitude: -1.621907, libcom: 'ASCAIN' },
  { typequ: 'B202', nomrs: 'GDS', latitude: 43.348, longitude: -1.623354, libcom: 'ASCAIN' },
  { typequ: 'B202', nomrs: 'HAUTE VERONIQUE', latitude: 43.347464, longitude: -1.622346, libcom: 'ASCAIN' },
  { typequ: 'B202', nomrs: 'DUMORA ETXEA', latitude: 43.342081, longitude: -1.614236, libcom: 'ASCAIN' },
  { typequ: 'B206', nomrs: 'FRANCISCO BERTRAND', latitude: 43.341926, longitude: -1.638917, libcom: 'ASCAIN' },
  { typequ: 'B207', nomrs: 'IBANEKO', latitude: 43.347153, longitude: -1.622326, libcom: 'ASCAIN' },
  { typequ: 'B207', nomrs: 'AU CROISSANT DE LA RHUNE', latitude: 43.348465, longitude: -1.623594, libcom: 'ASCAIN' },
  { typequ: 'B207', nomrs: 'BIAK', latitude: 43.357251, longitude: -1.629779, libcom: 'ASCAIN' },
  { typequ: 'B207', nomrs: 'G.S. TALOA', latitude: 43.332255, longitude: -1.612214, libcom: 'ASCAIN' },
  { typequ: 'B207', nomrs: 'MARTIN EMMANUELLE', latitude: 43.348898, longitude: -1.623426, libcom: 'ASCAIN' },
  { typequ: 'B207', nomrs: 'GOXOBAT', latitude: 43.363242, longitude: -1.637195, libcom: 'ASCAIN' },
  { typequ: 'B207', nomrs: 'MARC CHAROLLAIS', latitude: 43.357215, longitude: -1.627679, libcom: 'ASCAIN' },
  { typequ: 'B207', nomrs: 'PASTEL', latitude: 43.357346, longitude: -1.630366, libcom: 'ASCAIN' },
  { typequ: 'B207', nomrs: 'GIRARD MARIE', latitude: 43.344246, longitude: -1.616529, libcom: 'ASCAIN' },
  { typequ: 'C108', nomrs: 'ECOLE PRIMAIRE PUBLIQUE', latitude: 43.347907, longitude: -1.625629, libcom: 'ASCAIN' },
  { typequ: 'C108', nomrs: 'ECOLE PRIMAIRE PRIVEE STE-MARIE', latitude: 43.345616, longitude: -1.619507, libcom: 'ASCAIN' },
  { typequ: 'C108', nomrs: 'ECOLE PRIMAIRE PRIVEE IKASTOLA', latitude: 43.346482, longitude: -1.617248, libcom: 'ASCAIN' },
  { typequ: 'D307', nomrs: "PHARMACIE D'ASCAIN", latitude: 43.348792, longitude: -1.625887, libcom: 'ASCAIN' },
];

export const GARES_ASCAIN = [
  { stop_id: '87677120', stop_name: 'Saint-Jean-de-Luz - Ciboure', lat: 43.385838, lon: -1.66122, mode: 'ter', line_ids: null },
  { stop_id: '87673459', stop_name: 'Guéthary', lat: 43.425349, lon: -1.609862, mode: 'ter', line_ids: null },
  { stop_id: '87673400', stop_name: 'Biarritz', lat: 43.459397, lon: -1.545915, mode: 'ter', line_ids: null },
];

/** FACTICE (forme Overpass). */
export const OSM_ASCAIN_DEMO = { elements: [
  { type: 'node', id: 1, lat: 43.34762, lon: -1.62302, tags: { amenity: 'restaurant', name: 'Restaurant du fronton (démo)' } },
  { type: 'node', id: 2, lat: 43.34731, lon: -1.62247, tags: { amenity: 'cafe', name: 'Café de la place (démo)' } },
  { type: 'way', id: 3, center: { lat: 43.34705, lon: -1.62406 }, tags: { leisure: 'park', name: 'Jardin public (démo)' } },
  { type: 'way', id: 4, center: { lat: 43.34688, lon: -1.62488 }, tags: { leisure: 'sports_centre', name: 'Fronton municipal (démo)' } },
  { type: 'node', id: 5, lat: 43.34839, lon: -1.62367, tags: { highway: 'bus_stop', name: 'Ascain Bourg (démo)', route_ref: '3' } },
  { type: 'node', id: 6, lat: 43.3479, lon: -1.6216, tags: { amenity: 'restaurant' } },
] };

/** FACTICE (forme items de etablissements-sirene-v1). */
export const SIRENE_ASCAIN_DEMO = [
  { nom: 'Employeur démo A', activite: 'Hébergement et restauration (NAF 55.10Z)', adresse: 'Ascain', distance_m: 650, effectif: '50 à 99 salariés' },
  { nom: 'Commerce démo B', activite: 'Commerce (NAF 47.11F)', adresse: 'Ascain', distance_m: 400, effectif: '3 à 5 salariés' },
];

export const PARIS = { lat: 48.8566, lon: 2.3522, libelle: 'Programme démo — Hôtel de Ville', adresse: 'Paris 4e', communeInsee: '75104', precision: 'point' as const };

export const BPE_PARIS = [
  { typequ: 'A203', nomrs: 'BRED BANQUE POPULAIRE', latitude: 48.857631, longitude: 2.350576 },
  { typequ: 'A206', nomrs: 'PARIS RIVOLI BP', latitude: 48.855908, longitude: 2.357699 },
  { typequ: 'B207', nomrs: 'BCF PARIS RIVOLI', latitude: 48.857503, longitude: 2.351969 },
  { typequ: 'B207', nomrs: 'ERNEST & VALENTIN RENARD', latitude: 48.857972, longitude: 2.35155 },
  { typequ: 'B202', nomrs: 'BAZAR DU RENARD', latitude: 48.858105, longitude: 2.351944 },
  { typequ: 'B104', nomrs: 'SEGM BHV', latitude: 48.857861, longitude: 2.353417 },
  { typequ: 'B104', nomrs: 'SEGM BHV', latitude: 48.857917, longitude: 2.35332 },
  { typequ: 'B304', nomrs: 'GEOX FRANCE', latitude: 48.857464, longitude: 2.353338 },
  { typequ: 'C108', nomrs: 'ECOLE PRIMAIRE PRIVEE SAINT JEAN GABRIEL', latitude: 48.858953, longitude: 2.35174 },
  { typequ: 'C109', nomrs: 'ECOLE ELEMENTAIRE PUBLIQUE RENARD', latitude: 48.859115, longitude: 2.35249 },
  { typequ: 'C201', nomrs: 'COLLEGE FRANCOIS COUPERIN', latitude: 48.860328, longitude: 2.351894 },
  { typequ: 'C301', nomrs: 'LYCEE GENERAL ET TECHNOLOGIQUE SOPHIE GERMAIN', latitude: 48.85486, longitude: 2.358191 },
  { typequ: 'C107', nomrs: "ECOLE MATERNELLE PUBLIQUE ST GERMAIN L'AUXERROIS", latitude: 48.858219, longitude: 2.345381 },
  { typequ: 'D307', nomrs: 'SELARL PHARMACIE DES ARCHIVES', latitude: 48.857083, longitude: 2.354118 },
  { typequ: 'D307', nomrs: 'PHARMACIE DE LA MAIRIE', latitude: 48.857704, longitude: 2.354314 },
  { typequ: 'D108', nomrs: 'CENTRE DENTAIRE PARIS - HOTEL DE VILLE', latitude: 48.859224, longitude: 2.352231 },
  { typequ: 'D106', nomrs: 'GRP HOSP UNIVERSITAIRE PARIS CENTRE SITE HOTEL DIEU APHP', latitude: 48.854632, longitude: 2.348811 },
  { typequ: 'D101', nomrs: 'GRP HOSP UNIVERSITAIRE PARIS CENTRE SITE HOTEL DIEU APHP', latitude: 48.854632, longitude: 2.348811 },
  { typequ: 'A101', nomrs: 'DIR TERRITORIALE SECURITE PROXIMITE', latitude: 48.856164, longitude: 2.355667 },
];

/** Réel (mobility_stops, IDFM) : tous typés « metro » dans la table — voir ModeTransport. */
export const MOBILITE_PARIS = [
  { stop_id: 'IDFM:StopPlaceEntrance:50148394', stop_name: 'Hôtel de Ville', lat: 48.857028, lon: 2.352031, mode: 'metro' },
  { stop_id: 'IDFM:415852', stop_name: 'Hôtel de Ville', lat: 48.856621, lon: 2.351538, mode: 'metro' },
  { stop_id: 'IDFM:463080', stop_name: 'Hôtel de Ville', lat: 48.857105, lon: 2.352957, mode: 'metro' },
  { stop_id: 'IDFM:StopPlaceEntrance:50148395', stop_name: 'r. de Lobau', lat: 48.856838, lon: 2.353369, mode: 'metro' },
  { stop_id: 'IDFM:486056', stop_name: 'Châtelet', lat: 48.856986, lon: 2.350805, mode: 'metro' },
  { stop_id: 'IDFM:415744', stop_name: 'La Verrerie', lat: 48.857726, lon: 2.354571, mode: 'metro' },
  { stop_id: 'IDFM:463552', stop_name: "Pont d'Arcole", lat: 48.854774, lon: 2.350914, mode: 'metro' },
  { stop_id: 'IDFM:422537', stop_name: 'Châtelet - Quai de Gesvres', lat: 48.856811, lon: 2.348381, mode: 'metro' },
];

export const LYON = { lat: 45.7578, lon: 4.832, libelle: 'Programme démo — Bellecour', adresse: 'Lyon 2e', communeInsee: '69382', precision: 'point' as const };

export const BPE_LYON = [
  { typequ: 'B207', nomrs: 'CAFES CHOCOLATS VOISIN', latitude: 45.758188, longitude: 4.833463 },
  { typequ: 'B201', nomrs: "MONOP'", latitude: 45.756945, longitude: 4.833801 },
  { typequ: 'A206', nomrs: 'LYON BELLECOUR', latitude: 45.755531, longitude: 4.834124 },
  { typequ: 'C108', nomrs: 'ECOLE PRIMAIRE PRIVEE DU SACRE COEUR', latitude: 45.75605, longitude: 4.830106 },
  { typequ: 'C108', nomrs: 'ECOLE PRIMAIRE PUBLIQUE LAMARTINE', latitude: 45.76032, longitude: 4.832524 },
  { typequ: 'C201', nomrs: 'COLLEGE PRIVE CHEVREUL', latitude: 45.756257, longitude: 4.829145 },
  { typequ: 'C301', nomrs: 'LYCEE GEN.ET TECHNOL.PRIVE SAINT MARC', latitude: 45.754688, longitude: 4.828815 },
  { typequ: 'D307', nomrs: 'PHARMACIE BELLECOUR', latitude: 45.758717, longitude: 4.830577 },
  { typequ: 'D307', nomrs: 'PHARMACIE REBOUL', latitude: 45.759036, longitude: 4.834036 },
  { typequ: 'D302', nomrs: 'LBM UNIBIO LYON ST EXUPÉRY', latitude: 45.758037, longitude: 4.828854 },
  { typequ: 'D108', nomrs: 'CENTRE DE SANTE DENTAIRE LYON REPUBLIQUE', latitude: 45.760523, longitude: 4.836144 },
];

export const GARES_LYON = [
  { stop_id: '87721159', stop_name: 'Lyon Saint-Paul', lat: 45.76601, lon: 4.827057, mode: 'tgv' },
  { stop_id: '87722025', stop_name: 'Lyon Perrache', lat: 45.748476, lon: 4.825733, mode: 'tgv' },
  { stop_id: '87723197', stop_name: 'Lyon Part Dieu', lat: 45.760559, lon: 4.859355, mode: 'tgv' },
];

/** FACTICE (forme Overpass) : station de métro et arrêts de tram, pour vérifier les transports urbains hors IDF. */
export const OSM_LYON_DEMO = { elements: [
  { type: 'node', id: 11, lat: 45.75795, lon: 4.83305, tags: { railway: 'station', station: 'subway', name: 'Bellecour' } },
  { type: 'node', id: 12, lat: 45.75415, lon: 4.82672, tags: { railway: 'tram_stop', name: 'Perrache (démo)' } },
  { type: 'node', id: 13, lat: 45.75760, lon: 4.83220, tags: { highway: 'bus_stop', name: 'Bellecour (démo)' } },
  { type: 'way', id: 14, center: { lat: 45.7578, lon: 4.8325 }, tags: { leisure: 'park', name: 'Place Bellecour (démo)' } },
  { type: 'node', id: 15, lat: 45.7581, lon: 4.8331, tags: { amenity: 'cafe', name: 'Café démo' } },
  { type: 'node', id: 16, lat: 45.7572, lon: 4.8312, tags: { amenity: 'restaurant', name: 'Bouchon démo' } },
] };
