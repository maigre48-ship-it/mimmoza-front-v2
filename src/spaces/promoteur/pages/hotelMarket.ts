/** Observations officielles INSEE Melodi. Les unités et les géographies restent explicites. */
type Observation = {
  dimensions?: Record<string, string>;
  attributes?: Record<string, string>;
  measures?: { OBS_VALUE_NIVEAU?: { value?: number } };
};

export type HotelCapacity = { ranking: string; hotels: number | null; rooms: number | null };
export type HotelMonth = { month: string; nights: number | null; occupancyPct: number | null };
export type HotelEvidence = {
  communeInsee: string;
  department: string;
  capacityYear: number | null;
  frequencyYear: number | null;
  capacity: HotelCapacity[];
  months: HotelMonth[];
  annualNights: number | null;
  previousAnnualNights: number | null;
  nonResidentSharePct: number | null;
  annualUrl: string | null;
  capacityUrl: string | null;
  frequencyUrl: string | null;
  missing: string[];
  fetchedAt: string;
};

const RANKINGS = ['_T', 'NC', '1', '2', '3', '4', '5'];

function observationValue(item: Observation): number | null {
  const value = item.measures?.OBS_VALUE_NIVEAU?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function departmentFromInsee(insee: string): string {
  return /^9[78]/.test(insee) ? insee.slice(0, 3) : insee.slice(0, 2);
}

async function readMelodi(url: URL): Promise<Observation[]> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`INSEE Melodi : HTTP ${response.status}`);
  const data = await response.json() as { observations?: Observation[] };
  return Array.isArray(data.observations) ? data.observations : [];
}

export function parseHotelCapacity(observations: Observation[]): HotelCapacity[] {
  const hotels = observations.filter((item) => item.dimensions?.ACTIVITY === 'I551'
    && item.dimensions?.L_STAY === '_T' && item.dimensions?.FREQ === 'A');
  return RANKINGS.map((ranking) => {
    const select = (measure: string) => {
      const row = hotels.find((item) => item.dimensions?.UNIT_LOC_RANKING === ranking && item.dimensions?.TOUR_MEASURE === measure);
      return row ? observationValue(row) : null;
    };
    return { ranking, hotels: select('UNIT_LOC'), rooms: select('PLACE') };
  });
}

export function parseHotelMonths(observations: Observation[], year: number): HotelMonth[] {
  const hotel = observations.filter((item) => item.dimensions?.ACTIVITY === 'I551'
    && item.dimensions?.FREQ === 'M' && item.dimensions?.TOUR_RESID === '_T'
    && item.dimensions?.UNIT_LOC_RANKING === '_T');
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`;
    const select = (measure: string) => hotel.find((item) => item.dimensions?.TIME_PERIOD === month && item.dimensions?.TOUR_MEASURE === measure);
    const nights = select('NIGHT_SPENT');
    const occupancy = select('PLACE_OCCUPANCY_RATE');
    const nightsValue = nights ? observationValue(nights) : null;
    const multiplier = nights?.attributes?.UNIT_MULT;
    return {
      month,
      nights: nightsValue == null || multiplier !== '3' ? null : nightsValue * 1000,
      occupancyPct: occupancy?.dimensions?.UNIT_MEASURE === 'PT' ? observationValue(occupancy) : null,
    };
  });
}

export function parseHotelAnnual(observations: Observation[]): { nights: number | null; nonResidentSharePct: number | null } {
  const nights = observations.find((item) => item.dimensions?.ACTIVITY === 'I551' && item.dimensions?.FREQ === 'A' && item.dimensions?.TOUR_MEASURE === 'NIGHT_SPENT' && item.dimensions?.TOUR_RESID === '_T');
  const share = observations.find((item) => item.dimensions?.ACTIVITY === 'I551' && item.dimensions?.FREQ === 'A' && item.dimensions?.TOUR_MEASURE === 'PT_NIGHTSPENT_NON_RESIDENT');
  const n = nights ? observationValue(nights) : null;
  return { nights: n == null || nights?.attributes?.UNIT_MULT !== '3' ? null : n * 1000, nonResidentSharePct: share?.attributes?.UNIT_MULT === '0' ? observationValue(share) : null };
}

/** Offre communale et fréquentation départementale : aucun classement de programme. */
export async function fetchHotelEvidence(insee: string): Promise<HotelEvidence> {
  if (!/^(?:\d{5}|2[AB]\d{3})$/.test(insee)) throw new Error('Code INSEE vérifié requis pour l’étude hôtelière.');
  const department = departmentFromInsee(insee);
  const currentYear = new Date().getFullYear();
  let capacity: HotelCapacity[] = [];
  let months: HotelMonth[] = [];
  let capacityYear: number | null = null;
  let frequencyYear: number | null = null;
  let capacityUrl: string | null = null;
  let frequencyUrl: string | null = null;
  let annualUrl: string | null = null;
  let annualNights: number | null = null;
  let previousAnnualNights: number | null = null;
  let nonResidentSharePct: number | null = null;
  const missing: string[] = [];

  for (const year of [currentYear, currentYear - 1]) {
    const url = new URL('https://api.insee.fr/melodi/data/DS_TOUR_CAP');
    url.searchParams.set('GEO', `COM-${insee}`);
    url.searchParams.set('ACTIVITY', 'I551');
    url.searchParams.set('TIME_PERIOD', String(year));
    url.searchParams.set('maxResult', '100');
    try {
      const parsed = parseHotelCapacity(await readMelodi(url));
      if (parsed[0].hotels != null && parsed[0].rooms != null) {
        capacity = parsed; capacityYear = year; capacityUrl = url.toString(); break;
      }
    } catch { /* millésime indisponible : essayer l'année précédente */ }
  }
  if (!capacityYear) missing.push('Capacité hôtelière communale INSEE indisponible.');

  for (const year of [currentYear - 1, currentYear - 2]) {
    const url = new URL('https://api.insee.fr/melodi/data/DS_TOUR_FREQ');
    url.searchParams.set('GEO', `DEP-${department}`);
    url.searchParams.set('ACTIVITY', 'I551');
    url.searchParams.set('FREQ', 'M');
    url.searchParams.set('TOUR_RESID', '_T');
    url.searchParams.set('startPeriod', `${year}-01-01`);
    url.searchParams.set('endPeriod', `${year}-12-31`);
    url.searchParams.set('maxResult', '100');
    try {
      const parsed = parseHotelMonths(await readMelodi(url), year);
      if (parsed.filter((item) => item.nights != null && item.occupancyPct != null).length >= 10) {
        months = parsed; frequencyYear = year; frequencyUrl = url.toString(); break;
      }
    } catch { /* millésime indisponible */ }
  }
  if (!frequencyYear) missing.push('Fréquentation hôtelière mensuelle départementale INSEE indisponible.');
  if (frequencyYear) {
    const annual = async (year: number) => {
      const url = new URL('https://api.insee.fr/melodi/data/DS_TOUR_FREQ');
      url.searchParams.set('GEO', `DEP-${department}`);
      url.searchParams.set('ACTIVITY', 'I551');
      url.searchParams.set('FREQ', 'A');
      url.searchParams.set('TIME_PERIOD', String(year));
      url.searchParams.set('maxResult', '100');
      return { data: parseHotelAnnual(await readMelodi(url)), url: url.toString() };
    };
    try {
      const current = await annual(frequencyYear);
      annualNights = current.data.nights;
      nonResidentSharePct = current.data.nonResidentSharePct;
      annualUrl = current.url;
      const prior = await annual(frequencyYear - 1);
      previousAnnualNights = prior.data.nights;
    } catch { missing.push('Comparaison annuelle ou origine des nuitées indisponible.'); }
  }
  return { communeInsee: insee, department, capacityYear, frequencyYear, capacity, months, annualNights, previousAnnualNights, nonResidentSharePct, annualUrl, capacityUrl, frequencyUrl, missing, fetchedAt: new Date().toISOString() };
}

export type HotelAssumptions = { rooms: string; adr: string; occupancy: string; variableCost: string; fixedCosts: string; investment: string };
export type HotelEconomics = { roomNights: number; revenue: number; operatingResult: number; breakEvenOccupancy: number | null; investmentYield: number | null };

export function calculateHotelEconomics(input: HotelAssumptions): HotelEconomics | null {
  const rooms = Number(input.rooms), adr = Number(input.adr), occupancy = Number(input.occupancy);
  const variableCost = Number(input.variableCost), fixedCosts = Number(input.fixedCosts);
  const investment = input.investment.trim() ? Number(input.investment) : null;
  if (!input.rooms.trim() || !input.adr.trim() || !input.occupancy.trim() || !input.variableCost.trim() || !input.fixedCosts.trim()) return null;
  if (![rooms, adr, occupancy, variableCost, fixedCosts].every(Number.isFinite)
    || rooms <= 0 || adr <= 0 || occupancy < 0 || occupancy > 100 || variableCost < 0 || fixedCosts < 0
    || (investment != null && (!Number.isFinite(investment) || investment <= 0))) return null;
  const roomNights = rooms * 365 * occupancy / 100;
  const revenue = roomNights * adr;
  const operatingResult = revenue - roomNights * variableCost - fixedCosts;
  const breakEvenOccupancy = adr > variableCost ? 100 * fixedCosts / (rooms * 365 * (adr - variableCost)) : null;
  return { roomNights, revenue, operatingResult, breakEvenOccupancy, investmentYield: investment ? operatingResult / investment * 100 : null };
}
