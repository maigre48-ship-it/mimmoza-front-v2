/** Offre hôtelière communale INSEE dans un bassin de centres de communes. */
export type BasinHotelRow = {
  insee: string;
  name: string;
  distanceKm: number;
  hotels: number;
  rooms: number;
  roomsByRanking: Record<string, number>;
  sourceUrl: string;
};
export type HotelBasin = {
  centreInsee: string;
  year: number;
  radiusKm: number;
  selectedCommunes: number;
  measuredCommunes: number;
  rows: BasinHotelRow[];
  communeSourceUrl: string;
};

type Commune = { code?: string; nom?: string; centre?: { type?: string; coordinates?: number[] } };
const RANKS = ['NC', '1', '2', '3', '4', '5'];
const deptFromInsee = (insee: string) => /^9[78]/.test(insee) ? insee.slice(0, 3) : insee.slice(0, 2);

export function distanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function selectBasinCommunes(communes: Commune[], centreInsee: string, radiusKm = 15, maxCommunes = 20): Array<{ code: string; nom: string; distanceKm: number }> {
  const centre = communes.find((item) => item.code === centreInsee)?.centre?.coordinates;
  if (!centre || centre.length < 2 || !centre.every(Number.isFinite)) return [];
  return communes.flatMap((item) => {
    const coordinates = item.centre?.coordinates;
    if (!item.code || !item.nom || !coordinates || coordinates.length < 2 || !coordinates.every(Number.isFinite)) return [];
    const km = distanceKm(centre[0], centre[1], coordinates[0], coordinates[1]);
    return km <= radiusKm ? [{ code: item.code, nom: item.nom, distanceKm: Math.round(km * 10) / 10 }] : [];
  }).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, maxCommunes);
}

async function readCapacity(code: string, year: number): Promise<{ hotels: number; rooms: number; roomsByRanking: Record<string, number>; sourceUrl: string } | null> {
  const url = new URL('https://api.insee.fr/melodi/data/DS_TOUR_CAP');
  url.searchParams.set('GEO', `COM-${code}`);
  url.searchParams.set('ACTIVITY', 'I551');
  url.searchParams.set('TIME_PERIOD', String(year));
  url.searchParams.set('maxResult', '100');
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) return null;
  const data = await response.json() as { observations?: Array<{ dimensions?: Record<string, string>; measures?: { OBS_VALUE_NIVEAU?: { value?: number } } }> };
  const observations = data.observations ?? [];
  const value = (ranking: string, measure: string) => {
    const row = observations.find((item) => item.dimensions?.ACTIVITY === 'I551' && item.dimensions?.L_STAY === '_T'
      && item.dimensions?.FREQ === 'A' && item.dimensions?.UNIT_LOC_RANKING === ranking && item.dimensions?.TOUR_MEASURE === measure);
    const n = row?.measures?.OBS_VALUE_NIVEAU?.value;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  };
  const hotels = value('_T', 'UNIT_LOC'), rooms = value('_T', 'PLACE');
  if (hotels == null || rooms == null) return null;
  const roomsByRanking: Record<string, number> = {};
  for (const rank of RANKS) { const count = value(rank, 'PLACE'); if (count != null) roomsByRanking[rank] = count; }
  return { hotels, rooms, roomsByRanking, sourceUrl: url.toString() };
}

export async function fetchHotelBasin(insee: string, year: number): Promise<HotelBasin> {
  const department = deptFromInsee(insee);
  const communeSourceUrl = `https://geo.api.gouv.fr/departements/${encodeURIComponent(department)}/communes?fields=nom,code,centre&format=json`;
  const response = await fetch(communeSourceUrl, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`API communes : HTTP ${response.status}`);
  const all = await response.json() as Commune[];
  if (!Array.isArray(all)) throw new Error('Liste des communes invalide.');
  const selected = selectBasinCommunes(all, insee);
  if (!selected.length) throw new Error('Centre communal introuvable.');
  const rows: BasinHotelRow[] = [];
  for (let i = 0; i < selected.length; i += 4) {
    const batch = selected.slice(i, i + 4);
    const results = await Promise.all(batch.map(async (commune) => {
      try { return await readCapacity(commune.code, year); } catch { return null; }
    }));
    for (let j = 0; j < batch.length; j++) {
      if (results[j]) rows.push({ insee: batch[j].code, name: batch[j].nom, distanceKm: batch[j].distanceKm, ...results[j]! });
    }
  }
  return { centreInsee: insee, year, radiusKm: 15, selectedCommunes: selected.length, measuredCommunes: rows.length, rows, communeSourceUrl };
}
