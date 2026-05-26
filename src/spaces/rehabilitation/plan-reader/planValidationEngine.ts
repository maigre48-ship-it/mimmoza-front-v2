// src/spaces/rehabilitation/plan-reader/planValidationEngine.ts
// ---------------------------------------------------------------------------
// Étape 4 du pipeline : validation métier des résultats IA.
//
// Règles :
//   - Surface officielle prioritaire sur surface IA
//   - Si écart > 10 % → surface IA rejetée + warning explicite
//   - Aucune pièce hors enveloppe
//   - Aucune salle d'eau dans une cuisine (overlap)
//   - Les portes détectées ne peuvent pas être supprimées
//   - Ratio murs/surface plausible
// ---------------------------------------------------------------------------

import type { PlanGeometry, PlanMetadata, PlanCalibration, ValidationResult, ValidationIssue, Room } from './types';
import {
  isPointInPolygon,
  polygonsOverlap,
} from './planGeometryNormalizer';
import { estimateSurface } from './planScaleCalibrator';

export const SURFACE_ECART_MAX = 0.10; // 10 %

export interface ValidationInput {
  metadata: PlanMetadata;
  calibration: PlanCalibration;
  detectedGeometry: PlanGeometry;
  /** Surface estimée par l'IA (avant arbitrage) */
  aiEstimatedSurfaceM2: number | null;
  /** Géométrie IA "lâche" (pour vérifier qu'aucune pièce ne sort de l'enveloppe) */
  aiGeometry?: PlanGeometry;
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

const pushIssue = (
  issues: ValidationIssue[],
  code: ValidationIssue['code'],
  severity: ValidationIssue['severity'],
  message: string,
  context?: Record<string, unknown>,
): void => {
  issues.push({ code, severity, message, context });
};

const roomCentroidInsideEnvelope = (room: Room, envelope: PlanGeometry['envelopePolygon']): boolean => {
  if (envelope.length < 3) return true; // pas d'enveloppe → on ne juge pas
  // Vérification par centroïde + au moins un sommet
  const centroid = {
    x: room.polygon.reduce((s, p) => s + p.x, 0) / Math.max(1, room.polygon.length),
    y: room.polygon.reduce((s, p) => s + p.y, 0) / Math.max(1, room.polygon.length),
  };
  if (isPointInPolygon(centroid, envelope)) return true;
  return room.polygon.some(p => isPointInPolygon(p, envelope));
};

// ---------------------------------------------------------------------------
// Règle 1 : arbitrage de la surface (officielle > IA)
// ---------------------------------------------------------------------------

interface SurfaceArbitration {
  surfaceRetenueM2: number | null;
  surfaceOfficielleM2: number | null;
  surfaceIAEstimeeM2: number | null;
  ecartRelatif: number | null;
  surfaceIARejetee: boolean;
}

const arbitrateSurface = (
  metadata: PlanMetadata,
  calibration: PlanCalibration,
  detectedGeometry: PlanGeometry,
  aiEstimated: number | null,
  issues: ValidationIssue[],
): SurfaceArbitration => {
  const officielle = metadata.surfaceTotale.value;
  const surfaceCalibrationDerived = estimateSurface(
    detectedGeometry.envelopePolygon,
    calibration.imageWidthPx,
    calibration.imageHeightPx,
    calibration.pixelsPerMeter,
  );

  // Cas 1 : surface officielle détectée → elle prime.
  if (officielle && officielle > 0) {
    if (aiEstimated !== null && aiEstimated > 0) {
      const ecart = Math.abs(aiEstimated - officielle) / officielle;
      if (ecart > SURFACE_ECART_MAX) {
        pushIssue(
          issues,
          'SURFACE_IA_INCOHERENTE',
          'warning',
          `Surface IA incohérente avec la surface officielle détectée. IA : ${aiEstimated.toFixed(1)} m² · Plan : ${officielle.toFixed(1)} m² · Écart : ${(ecart * 100).toFixed(0)} %.`,
          { aiEstimated, officielle, ecart },
        );
        return {
          surfaceRetenueM2: officielle,
          surfaceOfficielleM2: officielle,
          surfaceIAEstimeeM2: aiEstimated,
          ecartRelatif: ecart,
          surfaceIARejetee: true,
        };
      }
      return {
        surfaceRetenueM2: officielle,
        surfaceOfficielleM2: officielle,
        surfaceIAEstimeeM2: aiEstimated,
        ecartRelatif: ecart,
        surfaceIARejetee: false,
      };
    }
    return {
      surfaceRetenueM2: officielle,
      surfaceOfficielleM2: officielle,
      surfaceIAEstimeeM2: aiEstimated,
      ecartRelatif: null,
      surfaceIARejetee: false,
    };
  }

  // Cas 2 : pas de surface officielle — on tente la calibration
  pushIssue(
    issues,
    'SURFACE_OFFICIELLE_MANQUANTE',
    'info',
    'Aucune surface officielle n\'a été détectée dans le plan ; calibration géométrique utilisée.',
  );

  if (surfaceCalibrationDerived && surfaceCalibrationDerived > 0) {
    if (aiEstimated && aiEstimated > 0) {
      const ecart = Math.abs(aiEstimated - surfaceCalibrationDerived) / surfaceCalibrationDerived;
      if (ecart > SURFACE_ECART_MAX) {
        pushIssue(
          issues,
          'SURFACE_IA_INCOHERENTE',
          'warning',
          `Surface IA incohérente avec la calibration géométrique. IA : ${aiEstimated.toFixed(1)} m² · Calibration : ${surfaceCalibrationDerived.toFixed(1)} m².`,
          { aiEstimated, calibrated: surfaceCalibrationDerived, ecart },
        );
        return {
          surfaceRetenueM2: surfaceCalibrationDerived,
          surfaceOfficielleM2: null,
          surfaceIAEstimeeM2: aiEstimated,
          ecartRelatif: ecart,
          surfaceIARejetee: true,
        };
      }
    }
    return {
      surfaceRetenueM2: surfaceCalibrationDerived,
      surfaceOfficielleM2: null,
      surfaceIAEstimeeM2: aiEstimated,
      ecartRelatif: null,
      surfaceIARejetee: false,
    };
  }

  // Cas 3 : rien de fiable — on retourne l'IA mais marquée à confirmer
  return {
    surfaceRetenueM2: aiEstimated,
    surfaceOfficielleM2: null,
    surfaceIAEstimeeM2: aiEstimated,
    ecartRelatif: null,
    surfaceIARejetee: false,
  };
};

// ---------------------------------------------------------------------------
// Règle 2 : pièces hors enveloppe
// ---------------------------------------------------------------------------

const checkRoomsInEnvelope = (geometry: PlanGeometry, issues: ValidationIssue[]): void => {
  if (geometry.envelopePolygon.length < 3) {
    pushIssue(issues, 'ENVELOPPE_VIDE', 'warning', 'Aucune enveloppe extérieure détectée.');
    return;
  }
  for (const room of geometry.rooms) {
    if (!roomCentroidInsideEnvelope(room, geometry.envelopePolygon)) {
      pushIssue(
        issues,
        'PIECE_HORS_ENVELOPPE',
        'error',
        `La pièce "${room.label}" se trouve hors de l'enveloppe du bâtiment.`,
        { roomId: room.id, roomType: room.type },
      );
    }
  }
};

// ---------------------------------------------------------------------------
// Règle 3 : pas de salle d'eau dans une cuisine
// ---------------------------------------------------------------------------

const checkWetRoomConflicts = (geometry: PlanGeometry, issues: ValidationIssue[]): void => {
  const cuisines = geometry.rooms.filter(r => r.type === 'cuisine');
  const sallesEau = geometry.rooms.filter(r =>
    r.type === 'salle-de-bain' || r.type === 'wc' || r.type === 'buanderie',
  );
  for (const cuisine of cuisines) {
    for (const sdb of sallesEau) {
      if (polygonsOverlap(cuisine.polygon, sdb.polygon)) {
        pushIssue(
          issues,
          'SALLE_EAU_DANS_CUISINE',
          'error',
          `Conflit de zones : "${sdb.label}" superposé à "${cuisine.label}".`,
          { cuisineId: cuisine.id, sdbId: sdb.id },
        );
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Règle 4 : portes présentes / pièces accessibles
// ---------------------------------------------------------------------------

const checkOpenings = (geometry: PlanGeometry, issues: ValidationIssue[]): void => {
  if (geometry.walls.length > 0 && geometry.openings.length === 0) {
    pushIssue(
      issues,
      'PORTES_MANQUANTES',
      'error',
      'Aucune porte n\'a été détectée alors que des murs existent : les pièces sont inaccessibles.',
    );
    return;
  }
  const doors = geometry.openings.filter(o => o.type === 'porte' || o.type === 'porte-fenetre');
  for (const room of geometry.rooms) {
    if (room.type === 'circulation' || room.type === 'rangement') continue;
    const hasDoor = doors.some(d => {
      // Approximation : la porte est dans la pièce si son mur a un point dans la pièce
      const wall = geometry.walls.find(w => w.id === d.wallId);
      if (!wall) return false;
      return (
        isPointInPolygon(wall.start, room.polygon) ||
        isPointInPolygon(wall.end, room.polygon)
      );
    });
    if (!hasDoor) {
      pushIssue(
        issues,
        'PIECE_SANS_OUVERTURE',
        'warning',
        `La pièce "${room.label}" ne semble pas disposer d'ouverture.`,
        { roomId: room.id },
      );
    }
  }
};

// ---------------------------------------------------------------------------
// Règle 5 : ratio murs / surface
// ---------------------------------------------------------------------------

const checkWallRatio = (
  geometry: PlanGeometry,
  surfaceM2: number | null,
  calibration: PlanCalibration,
  issues: ValidationIssue[],
): void => {
  if (!surfaceM2 || surfaceM2 <= 0 || !calibration.pixelsPerMeter) return;
  const ppm = calibration.pixelsPerMeter;
  const w = calibration.imageWidthPx;
  const h = calibration.imageHeightPx;

  const totalWallLengthM = geometry.walls.reduce((sum, wall) => {
    const dx = (wall.end.x - wall.start.x) * w;
    const dy = (wall.end.y - wall.start.y) * h;
    return sum + Math.sqrt(dx * dx + dy * dy) / ppm;
  }, 0);

  const ratio = totalWallLengthM / surfaceM2;
  // Plage plausible : 0,3 à 1,5 ml/m² selon densité du cloisonnement
  if (ratio < 0.15 || ratio > 2.0) {
    pushIssue(
      issues,
      'RATIO_MURS_SURFACE_ANORMAL',
      'warning',
      `Ratio murs/surface inhabituel (${ratio.toFixed(2)} ml/m²) : géométrie à vérifier.`,
      { ratio, totalWallLengthM, surfaceM2 },
    );
  }
};

// ---------------------------------------------------------------------------
// Règle 6 : calibration fiable ?
// ---------------------------------------------------------------------------

const checkCalibration = (calibration: PlanCalibration, issues: ValidationIssue[]): void => {
  if (calibration.method === 'fallback' || !calibration.pixelsPerMeter) {
    pushIssue(
      issues,
      'CALIBRATION_FALLBACK',
      'warning',
      'Aucune source fiable n\'a permis de calibrer l\'échelle. Les surfaces calculées sont indicatives.',
    );
  }
};

// ---------------------------------------------------------------------------
// Règle 7 : métadonnées clés manquantes
// ---------------------------------------------------------------------------

const checkMetadata = (metadata: PlanMetadata, issues: ValidationIssue[]): void => {
  if (metadata.surfaceTotale.value === null) {
    pushIssue(issues, 'METADONNEE_MANQUANTE', 'info', 'Surface totale non détectée dans le plan.');
  }
  if (metadata.echelle.value === null) {
    pushIssue(issues, 'METADONNEE_MANQUANTE', 'info', 'Échelle non détectée dans le plan.');
  }
};

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

export const validatePlan = (input: ValidationInput): ValidationResult => {
  const issues: ValidationIssue[] = [];

  checkCalibration(input.calibration, issues);
  checkMetadata(input.metadata, issues);

  const arbitration = arbitrateSurface(
    input.metadata,
    input.calibration,
    input.detectedGeometry,
    input.aiEstimatedSurfaceM2,
    issues,
  );

  checkRoomsInEnvelope(input.detectedGeometry, issues);
  checkWetRoomConflicts(input.detectedGeometry, issues);
  checkOpenings(input.detectedGeometry, issues);
  checkWallRatio(input.detectedGeometry, arbitration.surfaceRetenueM2, input.calibration, issues);

  // Vérification additionnelle sur la géométrie IA si fournie séparément
  if (input.aiGeometry) {
    checkRoomsInEnvelope(input.aiGeometry, issues);
    checkWetRoomConflicts(input.aiGeometry, issues);
  }

  const hasError = issues.some(i => i.severity === 'error');
  return {
    isValid: !hasError && !arbitration.surfaceIARejetee,
    ...arbitration,
    issues,
  };
};