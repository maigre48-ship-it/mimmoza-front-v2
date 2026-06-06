// ============================================================
// Mimmoza — Frontend service
// src/services/mobility/mobilityClient.ts
// Wrapper d'appel à transport-score-gtfs-v1
// Importé par les pages d'analyse (Marchand, Investisseur, Promoteur)
// v4.4 — formatMobilityForSnapshot retourne TransportGtfsSnapshot
//         (au lieu de string) pour injection dans predictive_snapshot Copilot
// v4.4.1 — FIX has_metro_train/has_tram/is_urban lus depuis la réponse GTFS
//           FIX summary : mode en minuscules (pas de TOUPPERCASE trompeur)
// ============================================================

import { supabase } from '@/lib/supabaseClient';
import type { MobilityScore, TransportScoreResponse } from './mobility.types';
import type { TransportGtfsSnapshot } from '@/spaces/copilot/types/copilot.types';

// ------------------------------------------------------------
// Fetch principal — appelé depuis les pages d'analyse
// lat/lon du bien analysé
// ------------------------------------------------------------
export async function fetchMobilityScore(
  lat: number,
  lon: number,
  radiusM = 2000
): Promise<MobilityScore> {
  const { data, error } = await supabase.functions.invoke<TransportScoreResponse>(
    'transport-score-gtfs-v1',
    { body: { lat, lon, radius_m: radiusM } }
  );

  if (error) throw new Error(`[mobilityClient] ${error.message}`);
  if (!data?.score) throw new Error('[mobilityClient] Réponse vide');

  return data.score;
}

// ------------------------------------------------------------
// Version avec fallback silencieux — pour les snapshots
// Ne lève pas d'erreur, retourne null si échec
// Usage : buildPredictiveSnapshotForCopilot, SmartScore V4
// ------------------------------------------------------------
export async function fetchMobilityScoreSafe(
  lat: number,
  lon: number,
  radiusM = 2000
): Promise<MobilityScore | null> {
  try {
    return await fetchMobilityScore(lat, lon, radiusM);
  } catch (err) {
    console.warn('[mobilityClient] Score mobilité non disponible', err);
    return null;
  }
}

// ------------------------------------------------------------
// Formatage du score pour injection dans predictive_snapshot Copilot
// Retourne un TransportGtfsSnapshot (objet structuré) — pas une string.
//
// Règle Copilot 4dodicies :
//   - Le Copilot doit utiliser transport_gtfs.total (plus précis que transport.score legacy)
//   - Citer les pillars si pertinent : rail (RER/Métro/TGV/TER), urban, employment, multimodal
//   - Ne jamais confondre pillars.rail avec le SmartScore global (règle 4decies)
//   - Si is_urban=false ET pillars.rail > 0 → mentionner TER/TGV même hors agglo
//
// v4.4.1 :
//   - has_metro_train / has_tram / is_urban lus depuis la réponse GTFS en priorité
//     (le backend les calcule proprement depuis les types d'arrêts)
//   - Fallback sur top_stops uniquement si absent de la réponse
//   - summary : mode en minuscules pour éviter "BUS" ou "METRO" trompeur
// ------------------------------------------------------------
export function formatMobilityForSnapshot(score: MobilityScore): TransportGtfsSnapshot {
  const raw = score as any;
  return {
    total: score.total,
    pillars: {
      rail:       score.pillars.rail.score       ?? null,
      urban:      score.pillars.urban.score      ?? null,
      employment: score.pillars.employment.score ?? null,
      multimodal: score.pillars.multimodal.score ?? null,
    },
    nearest_stop_m: score.top_stops[0]?.distance_m ?? null,
    // Priorité aux champs calculés par le backend GTFS
    has_metro_train: raw.has_metro_train
      ?? score.top_stops.some(s =>
          ['metro', 'rer', 'train', 'ter', 'tgv'].includes(s.mode.toLowerCase())
        ),
    has_tram: raw.has_tram
      ?? score.top_stops.some(s => s.mode.toLowerCase() === 'tram'),
    is_urban: raw.is_urban
      ?? (score.total > 0 && (score.pillars.urban.score ?? 0) > 0),
    label:   _labelFromScore(score.total),
    summary: _buildSummary(score),
  };
}

// ------------------------------------------------------------
// Helpers internes
// ------------------------------------------------------------
function _labelFromScore(total: number): string {
  if (total >= 80) return 'Très bien desservi';
  if (total >= 60) return 'Bien desservi';
  if (total >= 40) return 'Desservi';
  if (total >= 20) return 'Peu desservi';
  return 'Faiblement desservi';
}

function _buildSummary(score: MobilityScore): string {
  if (score.total === 0 || score.top_stops.length === 0) {
    return 'Aucun transport structurant dans le rayon analysé.';
  }
  const nearest = score.top_stops[0];
  const railScore = score.pillars.rail.score ?? 0;
  const parts: string[] = [`Score mobilité ${score.total}/100.`];
  if (nearest) {
    // mode en minuscules — pas de toUpperCase() qui transforme "bus" en "BUS" ou "metro" en "METRO"
    parts.push(
      `Stop le plus proche : ${nearest.name} (${nearest.mode}) à ${nearest.distance_m} m.`
    );
  }
  if (railScore > 0) {
    parts.push(`Rail (TER/RER/Métro) : ${railScore}/100.`);
  }
  return parts.join(' ');
}

// ------------------------------------------------------------
// Intégration SmartScore V4
// Remplace l'ancien bloc Overpass OSM dans smartscore-enriched-v3
//
// Usage dans banqueSmartScoreUniversal.ts ou smartscore-enriched-v3 :
//
//   import { fetchMobilityScoreSafe } from '@/services/mobility/mobilityClient';
//
//   const mobility = await fetchMobilityScoreSafe(lat, lon);
//   const transportPillarScore = mobility?.total ?? 0;
// ------------------------------------------------------------