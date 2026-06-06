// ============================================================
// Mimmoza — Module Mobilité Immobilier
// mobilityScore.service.ts
// Calcul du TransportScore pondération immobilière
// (sans appel Google Maps, sans requête externe à la volée)
// ============================================================

import type {
  MobilityModeGroup,
  MobilityScore,
  PillarScore,
  TransportScoreRequest,
  TransportScoreResponse,
} from './mobility.types';

// ------------------------------------------------------------
// PONDÉRATION IMMOBILIÈRE
// Délibérément non urbano-centrique :
// Saint-Jean-de-Luz (TER) ≈ Lyon 3e (métro)
// ------------------------------------------------------------
const WEIGHTS = {
  rail:       0.40,   // Gare SNCF / TER / TGV
  urban:      0.25,   // Réseau urbain (métro, tram, BHNS, RER)
  employment: 0.20,   // Temps vers bassin d'emploi
  multimodal: 0.15,   // Diversité modale < 1km
} as const;

// ------------------------------------------------------------
// PILIER RAIL (40%)
// TGV < 800m → 100, TER < 500m → 85, TER < 2km → 65
// Logique : la gare SNCF la plus proche, peu importe la ville
// ------------------------------------------------------------
function scoreRail(groups: MobilityModeGroup[]): PillarScore {
  const rail = groups.find(g =>
    ['tgv', 'ter', 'rer', 'transilien'].includes(g.mode)
  );

  if (!rail) {
    return { score: 0, weight: WEIGHTS.rail, details: 'Aucune gare SNCF dans un rayon de 2 km' };
  }

  const d = rail.nearest_dist_m;
  const hasTgv = groups.some(g => g.has_tgv);

  let score = 0;
  let details = '';

  if (hasTgv && d < 500) {
    score = 100;
    details = `Gare TGV à ${Math.round(d)} m (${rail.nearest_name})`;
  } else if (hasTgv && d < 1200) {
    score = 88;
    details = `Gare TGV à ${Math.round(d)} m (${rail.nearest_name})`;
  } else if (hasTgv && d < 2000) {
    score = 75;
    details = `Gare TGV à ${Math.round(d)} m (${rail.nearest_name})`;
  } else if (d < 400) {
    score = 85;
    details = `Gare ${rail.mode.toUpperCase()} à ${Math.round(d)} m (${rail.nearest_name})`;
  } else if (d < 800) {
    score = 75;
    details = `Gare ${rail.mode.toUpperCase()} à ${Math.round(d)} m`;
  } else if (d < 1200) {
    score = 62;
    details = `Gare ${rail.mode.toUpperCase()} à ${Math.round(d)} m`;
  } else if (d < 2000) {
    score = 45;
    details = `Gare ${rail.mode.toUpperCase()} à ${Math.round(d)} m`;
  }

  return { score, weight: WEIGHTS.rail, details };
}

// ------------------------------------------------------------
// PILIER URBAN (25%)
// Métro / Tram / BHNS / RER — réseau dense
// Sans pénaliser les villes qui n'ont pas de métro
// ------------------------------------------------------------
function scoreUrban(groups: MobilityModeGroup[]): PillarScore {
  const urbanModes = groups.filter(g =>
    ['metro', 'tram', 'bhns', 'rer', 'transilien'].includes(g.mode)
  );

  if (urbanModes.length === 0) {
    return {
      score: 0,
      weight: WEIGHTS.urban,
      details: 'Pas de réseau urbain lourd dans un rayon de 2 km',
    };
  }

  // Mode le plus proche
  const nearest = urbanModes.reduce((a, b) =>
    a.nearest_dist_m < b.nearest_dist_m ? a : b
  );
  const d = nearest.nearest_dist_m;

  // Bonus ligne : nombre de lignes disponibles
  const totalLines = urbanModes.reduce(
    (acc, g) => acc + (g.line_ids?.length ?? 0), 0
  );
  const lineBonus = Math.min(15, totalLines * 3);

  let base = 0;
  if      (d < 200)  base = 85;
  else if (d < 400)  base = 75;
  else if (d < 700)  base = 62;
  else if (d < 1000) base = 48;
  else if (d < 1500) base = 32;
  else if (d < 2000) base = 18;

  const score = Math.min(100, base + lineBonus);
  const details = `${nearest.mode.toUpperCase()} à ${Math.round(d)} m (${nearest.nearest_name}), ${totalLines} ligne(s)`;

  return { score, weight: WEIGHTS.urban, details };
}

// ------------------------------------------------------------
// PILIER EMPLOI (20%)
// minutes_to_cbd : temps moyen vers bassin d'emploi
// Calculé à l'import GTFS, mis en cache, pas recalculé
// Si inconnu → score neutre (50) pour ne pas pénaliser
// ------------------------------------------------------------
function scoreEmployment(groups: MobilityModeGroup[], minutesToCbd?: number | null): PillarScore {
  if (minutesToCbd == null) {
    // Pas de données → score neutre, ne pénalise pas
    return {
      score: 50,
      weight: WEIGHTS.employment,
      details: 'Temps trajet CBD non disponible — score neutre',
    };
  }

  let score = 0;
  let details = '';

  if      (minutesToCbd <= 10)  { score = 100; details = `${minutesToCbd} min vers le bassin d'emploi`; }
  else if (minutesToCbd <= 20)  { score = 88;  details = `${minutesToCbd} min vers le bassin d'emploi`; }
  else if (minutesToCbd <= 30)  { score = 75;  details = `${minutesToCbd} min vers le bassin d'emploi`; }
  else if (minutesToCbd <= 45)  { score = 58;  details = `${minutesToCbd} min vers le bassin d'emploi`; }
  else if (minutesToCbd <= 60)  { score = 40;  details = `${minutesToCbd} min vers le bassin d'emploi`; }
  else if (minutesToCbd <= 90)  { score = 22;  details = `${minutesToCbd} min vers le bassin d'emploi`; }
  else                          { score = 8;   details = `${minutesToCbd} min (éloigné des bassins d'emploi)`; }

  return { score, weight: WEIGHTS.employment, details };
}

// ------------------------------------------------------------
// PILIER MULTIMODALITÉ (15%)
// Nombre de modes distincts accessibles à pied (< 1 km)
// Bonus qualité : TGV + TER + Metro = très rare = prime
// ------------------------------------------------------------
function scoreMultimodal(groups: MobilityModeGroup[]): PillarScore {
  const within1km = groups.filter(g => g.nearest_dist_m <= 1000);
  const modeCount = within1km.length;

  const hasPremiumCombo =
    within1km.some(g => ['tgv', 'ter'].includes(g.mode)) &&
    within1km.some(g => ['metro', 'tram', 'rer'].includes(g.mode));

  let score = 0;
  if      (modeCount >= 4) score = 100;
  else if (modeCount === 3) score = 82;
  else if (modeCount === 2) score = 60;
  else if (modeCount === 1) score = 30;

  if (hasPremiumCombo) score = Math.min(100, score + 15);

  const modeNames = within1km.map(g => g.mode.toUpperCase()).join(', ');
  const details = modeCount > 0
    ? `${modeCount} mode(s) < 1 km : ${modeNames}`
    : 'Un seul mode de transport accessible';

  return { score, weight: WEIGHTS.multimodal, details };
}

// ------------------------------------------------------------
// SCORE GLOBAL — agrège les 4 piliers
// ------------------------------------------------------------
export function computeMobilityScore(
  groups: MobilityModeGroup[],
  minutesToCbd?: number | null,
  radiusM = 2000
): MobilityScore {
  const rail       = scoreRail(groups);
  const urban      = scoreUrban(groups);
  const employment = scoreEmployment(groups, minutesToCbd);
  const multimodal = scoreMultimodal(groups);

  const total = Math.round(
    rail.score       * WEIGHTS.rail +
    urban.score      * WEIGHTS.urban +
    employment.score * WEIGHTS.employment +
    multimodal.score * WEIGHTS.multimodal
  );

  // Top 5 arrêts pour UI et PDF
  const top_stops = groups
    .sort((a, b) => a.nearest_dist_m - b.nearest_dist_m)
    .slice(0, 5)
    .map(g => ({
      name:       g.nearest_name,
      mode:       g.mode,
      distance_m: Math.round(g.nearest_dist_m),
      lines:      g.line_ids ?? [],
    }));

  return {
    total: Math.min(100, Math.max(0, total)),
    pillars: { rail, urban, employment, multimodal },
    top_stops,
    computed_at: new Date().toISOString(),
    radius_m:    radiusM,
  };
}

// ------------------------------------------------------------
// Exemples de résultats attendus (tests mentaux)
// Paris 11e   → rail≈55  urban≈92  employ≈100 multi≈100  total≈82
// Saint-Jean-de-Luz (TER) → rail≈75 urban≈0 employ≈55 multi≈30 total≈47
// Bayonne     → rail≈85  urban≈40  employ≈65 multi≈60   total≈66
// La Rochelle → rail≈80  urban≈35  employ≈50 multi≈45   total≈59
// Zone rurale → rail≈0   urban≈0   employ≈8  multi≈0    total≈12
// ------------------------------------------------------------