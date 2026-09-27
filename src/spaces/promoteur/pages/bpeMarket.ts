/** Dénombrements BPE 2025, tels que publiés par l'Insee dans Melodi (DS_BPE). */
export type BpeObservation = {
  dimensions?: { GEO?: string; TIME_PERIOD?: string; FACILITY_TYPE?: string; BPE_MEASURE?: string; UNIT_MEASURE?: string };
  attributes?: { OBS_STATUS?: string; UNIT_MULT?: string };
  measures?: { OBS_VALUE_NIVEAU?: { value?: number } };
};
export type BpeMarket = {
  year: number;
  communeInsee: string;
  department: string;
  commune: Record<string, number>;
  departmentCounts: Record<string, number>;
  communeUrl: string;
  departmentUrl: string;
  fetchedAt: string;
};

export const BPE_TYPES = {
  B104: 'Hypermarchés et grands magasins', B105: 'Supermarchés et magasins multi-commerces',
  B201: 'Supérettes', B202: 'Épiceries',
  C501: 'UFR', C502: 'Instituts universitaires', C503: 'Écoles d’ingénieurs',
  C504: 'Enseignement supérieur privé', C509: 'Autres établissements supérieurs',
  C701: 'Résidences universitaires CROUS',
  D101: 'Établissements de soins de courte durée', D102: 'Établissements de soins de suite et de réadaptation',
  D103: 'Établissements de soins de longue durée', D104: 'Établissements psychiatriques',
  D401: 'Hébergements pour personnes âgées', D402: 'Services de soins à domicile pour personnes âgées',
} as const;

const BPE_YEAR = 2025;
const deptFromInsee = (insee: string) => /^9[78]/.test(insee) ? insee.slice(0, 3) : insee.slice(0, 2);
const sameGeo = (raw: string | undefined, scope: 'COM' | 'DEP', code: string) =>
  raw === `${scope}-${code}` || raw === `2026-${scope}-${code}`;

/** Les absences restent inconnues : Melodi ne renvoie pas nécessairement une ligne pour zéro. */
export function parseBpeCounts(rows: BpeObservation[], scope: 'COM' | 'DEP', code: string, year = BPE_YEAR): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    const d = row.dimensions;
    const type = d?.FACILITY_TYPE;
    const value = row.measures?.OBS_VALUE_NIVEAU?.value;
    if (!type || !(type in BPE_TYPES) || !sameGeo(d?.GEO, scope, code) || d?.TIME_PERIOD !== String(year)
      || d?.BPE_MEASURE !== 'FACILITIES' || d?.UNIT_MEASURE !== 'NR'
      || row.attributes?.UNIT_MULT !== '0' || row.attributes?.OBS_STATUS !== 'A'
      || typeof value !== 'number' || !Number.isInteger(value) || value < 0) continue;
    result[type] = value;
  }
  return result;
}

async function readBpe(scope: 'COM' | 'DEP', code: string) {
  const url = new URL('https://api.insee.fr/melodi/data/DS_BPE');
  url.searchParams.set('GEO', `${scope}-${code}`);
  url.searchParams.set('TIME_PERIOD', String(BPE_YEAR));
  url.searchParams.set('maxResult', '1000');
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`INSEE BPE : HTTP ${response.status}`);
  const data = await response.json() as { observations?: BpeObservation[]; paging?: { next?: string } };
  if (!Array.isArray(data.observations) || data.paging?.next) throw new Error('INSEE BPE : réponse incomplète.');
  return { counts: parseBpeCounts(data.observations, scope, code), url: url.toString() };
}

export async function fetchBpeMarket(insee: string): Promise<BpeMarket> {
  if (!/^(?:\d{5}|2[AB]\d{3})$/.test(insee)) throw new Error('Code INSEE vérifié requis pour la BPE.');
  const department = deptFromInsee(insee);
  const [commune, dept] = await Promise.all([readBpe('COM', insee), readBpe('DEP', department)]);
  return { year: BPE_YEAR, communeInsee: insee, department, commune: commune.counts, departmentCounts: dept.counts,
    communeUrl: commune.url, departmentUrl: dept.url, fetchedAt: new Date().toISOString() };
}
