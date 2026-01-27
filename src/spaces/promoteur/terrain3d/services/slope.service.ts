// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/services/slope.service.ts
// ============================================================================

import type { TerrainGrid } from '../types/terrain.types';
import type { SlopeData, TerrainProfile } from '../types/earthworks.types';
import type { Point3D } from '../types/terrain.types';
import { distance2D, slopePercent, radToDeg } from '../utils/math3d.utils';

/**
 * Calcule la pente entre deux cellules de grille adjacentes
 */
function computeCellSlope(
  grid: TerrainGrid,
  col1: number,
  row1: number,
  col2: number,
  row2: number
): number {
  const z1 = grid.elevations[row1]?.[col1] ?? 0;
  const z2 = grid.elevations[row2]?.[col2] ?? 0;
  const dz = Math.abs(z2 - z1);
  const dx = Math.abs(col2 - col1) * grid.step;
  const dy = Math.abs(row2 - row1) * grid.step;
  const horizontalDist = Math.sqrt(dx * dx + dy * dy);
  
  return slopePercent(dz, horizontalDist);
}

/**
 * Service de calcul des pentes
 * 
 * TODO: Optimiser les calculs pour les grandes grilles
 */
export class SlopeService {
  /**
   * Calcule les données de pente pour une grille de terrain
   * 
   * TODO: Implémenter le calcul réel des pentes
   * Pour l'instant, retourne des valeurs stub
   */
  computeSlopeData(grid: TerrainGrid): SlopeData {
    const { rows, cols } = grid;
    
    // Initialise la grille des pentes
    const slopeGrid: number[][] = [];
    let totalSlope = 0;
    let maxSlope = 0;
    let minSlope = Infinity;
    let count = 0;
    
    // TODO: Implémenter le vrai calcul
    // Pour l'instant, grille de zéros (terrain plat)
    for (let row = 0; row < rows; row++) {
      const slopeRow: number[] = [];
      for (let col = 0; col < cols; col++) {
        // Calcul simplifié: moyenne des pentes vers les voisins
        let slope = 0;
        let neighbors = 0;
        
        if (col > 0) {
          slope += computeCellSlope(grid, col, row, col - 1, row);
          neighbors++;
        }
        if (col < cols - 1) {
          slope += computeCellSlope(grid, col, row, col + 1, row);
          neighbors++;
        }
        if (row > 0) {
          slope += computeCellSlope(grid, col, row, col, row - 1);
          neighbors++;
        }
        if (row < rows - 1) {
          slope += computeCellSlope(grid, col, row, col, row + 1);
          neighbors++;
        }
        
        const cellSlope = neighbors > 0 ? slope / neighbors : 0;
        slopeRow.push(cellSlope);
        
        totalSlope += cellSlope;
        maxSlope = Math.max(maxSlope, cellSlope);
        minSlope = Math.min(minSlope, cellSlope);
        count++;
      }
      slopeGrid.push(slopeRow);
    }
    
    const averageSlope = count > 0 ? totalSlope / count : 0;
    
    // TODO: Calculer la direction principale de la pente
    const mainDirection = 0; // Placeholder: azimut 0° (Nord)
    
    return {
      averageSlope,
      maxSlope,
      minSlope: minSlope === Infinity ? 0 : minSlope,
      mainDirection,
      slopeGrid,
    };
  }
  
  /**
   * Calcule un profil de terrain le long d'une ligne
   * 
   * TODO: Implémenter le calcul réel
   */
  computeProfile(
    grid: TerrainGrid,
    startPoint: Point3D,
    endPoint: Point3D,
    numSamples: number = 50
  ): TerrainProfile {
    const points: TerrainProfile['points'] = [];
    const totalLength = distance2D(startPoint, endPoint);
    
    // TODO: Implémenter l'interpolation le long de la ligne
    // Pour l'instant, profil plat
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const distance = t * totalLength;
      points.push({
        distance,
        elevation: grid.origin.z,
        position: {
          x: startPoint.x + t * (endPoint.x - startPoint.x),
          y: startPoint.y + t * (endPoint.y - startPoint.y),
          z: grid.origin.z,
        },
      });
    }
    
    return {
      points,
      totalLength,
      totalElevationChange: 0, // Terrain plat pour l'instant
    };
  }
  
  /**
   * Détermine la catégorie de pente (plat, modéré, raide, très raide)
   */
  categorizeSlope(slopePercent: number): 'flat' | 'moderate' | 'steep' | 'very_steep' {
    if (slopePercent < 5) return 'flat';
    if (slopePercent < 15) return 'moderate';
    if (slopePercent < 30) return 'steep';
    return 'very_steep';
  }
}

/**
 * Instance singleton du service
 */
let slopeServiceInstance: SlopeService | null = null;

/**
 * Récupère l'instance du service (singleton)
 */
export function getSlopeService(): SlopeService {
  if (!slopeServiceInstance) {
    slopeServiceInstance = new SlopeService();
  }
  return slopeServiceInstance;
}

/**
 * Réinitialise le service (utile pour les tests)
 */
export function resetSlopeService(): void {
  slopeServiceInstance = null;
}