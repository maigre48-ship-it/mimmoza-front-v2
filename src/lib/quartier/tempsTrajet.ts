// src/lib/quartier/tempsTrajet.ts
// =============================================================================
// VIS-70 — distances et temps de trajet « réalistes » SANS moteur d'itinéraire (aucun n'est branché dans Mimmoza) :
//   distance réseau = distance à vol d'oiseau × coefficient de détour (1,25 en ville, 1,35 hors agglomération) ;
//   à pied 4,5 km/h ; à vélo 15 km/h + 1 min de stationnement ; en transport = marche jusqu'à l'arrêt le plus proche
//   + attente moyenne (moitié de l'intervalle type du mode) + trajet à la vitesse commerciale du mode + 4 min de marche
//   à l'arrivée. Isochrones simples : cercles de rayon (minutes × vitesse ÷ détour).
// Ce sont des ESTIMATIONS : la page et Mimmo le disent (« ≈ »), elles ne sont jamais présentées comme un itinéraire.
// Module PUR.
// =============================================================================
import type { ModeTransport } from './categoriesQuartier.ts';

export const VITESSE_PIED_M_MIN = 75;      // 4,5 km/h
export const VITESSE_VELO_M_MIN = 250;     // 15 km/h
export const DETOUR_URBAIN = 1.25;
export const DETOUR_RURAL = 1.35;
export const STATIONNEMENT_VELO_MIN = 1;
export const MARCHE_ARRIVEE_MIN = 4;
/** Au-delà, le vélo n'est plus un argument de vente (temps non affiché). */
export const VELO_MAX_M = 10_000;
/** Un arrêt plus loin que cela n'est pas « à portée » pour le calcul en transport. */
export const ARRET_MAX_M = 800;

/** Attente moyenne (min) et vitesse commerciale (m/min) par mode. */
export const PROFILS_MODE: Readonly<Record<ModeTransport, { attente: number; vitesse: number }>> = {
  metro: { attente: 2, vitesse: 450 }, rer: { attente: 5, vitesse: 650 }, transilien: { attente: 8, vitesse: 650 },
  tram: { attente: 4, vitesse: 300 }, bhns: { attente: 5, vitesse: 280 }, bus: { attente: 7, vitesse: 230 },
  ter: { attente: 15, vitesse: 1000 }, tgv: { attente: 20, vitesse: 2000 }, car: { attente: 15, vitesse: 500 }, velo_libre: { attente: 0, vitesse: 250 },
  arret: { attente: 7, vitesse: 230 }, gare: { attente: 20, vitesse: 1000 },
};

export interface Point { readonly lat: number; readonly lon: number }

/** Distance à vol d'oiseau (m), formule de haversine. */
export function distanceM(a: Point, b: Point): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const detour = (urbain: boolean): number => (urbain ? DETOUR_URBAIN : DETOUR_RURAL);

/** Minutes à pied (au moins 1). */
export function minutesPied(distanceVolOiseauM: number, urbain: boolean): number {
  return Math.max(1, Math.round((distanceVolOiseauM * detour(urbain)) / VITESSE_PIED_M_MIN));
}

/** Minutes à vélo ; null au-delà de VELO_MAX_M. */
export function minutesVelo(distanceVolOiseauM: number, urbain: boolean): number | null {
  const reseau = distanceVolOiseauM * detour(urbain);
  if (reseau > VELO_MAX_M) return null;
  return Math.max(1, Math.round(reseau / VITESSE_VELO_M_MIN) + STATIONNEMENT_VELO_MIN);
}

export interface ArretDepart { readonly mode: ModeTransport; readonly distance_m: number; readonly nom: string | null }

/**
 * Minutes en transport en commun ; null si aucun arrêt à portée, si le lieu est proche (< 1,2 km : on y va à pied)
 * ou si le transport n'est pas plus rapide que la marche. Volontairement prudent.
 */
export function minutesTransport(distanceVolOiseauM: number, urbain: boolean, arret: ArretDepart | null): number | null {
  if (!arret || arret.distance_m > ARRET_MAX_M || arret.mode === 'velo_libre') return null;
  if (distanceVolOiseauM < 1200) return null;
  const p = PROFILS_MODE[arret.mode];
  const t = minutesPied(arret.distance_m, urbain) + p.attente + (distanceVolOiseauM * 1.15) / p.vitesse + MARCHE_ARRIVEE_MIN;
  const total = Math.round(t);
  return total < minutesPied(distanceVolOiseauM, urbain) ? total : null;
}

/** Rayon (m, à vol d'oiseau) de l'isochrone simple « N minutes » d'un mode. */
export function rayonIsochroneM(minutes: number, mode: 'pied' | 'velo', urbain: boolean): number {
  const v = mode === 'pied' ? VITESSE_PIED_M_MIN : VITESSE_VELO_M_MIN;
  const m = mode === 'velo' ? Math.max(0, minutes - STATIONNEMENT_VELO_MIN) : minutes;
  return Math.round((m * v) / detour(urbain));
}

/** « 350 m », « 1,2 km », « 12 km ». */
export function libelleDistance(m: number): string {
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

/** « 4 min », « 1 h 05 ». */
export function libelleMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, '0')}`;
}

/** Polygone (anneau GeoJSON fermé) d'un cercle de rayon r autour d'un point : isochrone simple pour la carte. */
export function cercleGeoJson(c: Point, rayonM: number, pas = 64): [number, number][] {
  const out: [number, number][] = [];
  const dLat = rayonM / 111_320;
  const dLon = rayonM / (111_320 * Math.cos((c.lat * Math.PI) / 180));
  for (let i = 0; i <= pas; i++) {
    const a = (i / pas) * 2 * Math.PI;
    out.push([+(c.lon + dLon * Math.cos(a)).toFixed(7), +(c.lat + dLat * Math.sin(a)).toFixed(7)]);
  }
  return out;
}
