export const PROJECT_KEYS = ['logement', 'hotel', 'ehpad', 'commerce', 'bureaux', 'residence_etudiante', 'clinique'] as const;
export type ProjectKey = typeof PROJECT_KEYS[number];
type Fact = { id: string; label: string; value: string; scope: string; source: string; sourceUrl?: string; direct: boolean };
type Sector = { key: ProjectKey; label: string; eligible: boolean; targetHypothesis: string; programmeHint: string; facts: Fact[]; missing: string[] };
export type Packet = { parcelId: string; communeInsee: string; terrainM2: number; pluZone: string | null; dataDate: string; sectors: Sector[] };
export type AiResult = { status: 'piste_prioritaire' | 'aucune_priorite'; projectKey: ProjectKey | null; target: string; programme: string; rationale: string; evidenceIds: string[]; alternatives: { key: ProjectKey; reason: string }[]; conditions: string[] };

const keys = new Set<string>(PROJECT_KEYS);
const bounded = (v: unknown, max: number) => typeof v === 'string' && v.length <= max ? v.trim() : '';
const record = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const officialUrl = (v: unknown) => {
  if (typeof v !== 'string' || v.length > 500) return undefined;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' && ['api.insee.fr', 'www.insee.fr', 'www.data.gouv.fr', 'data.gouv.fr'].includes(url.hostname) ? url.toString() : undefined;
  } catch { return undefined; }
};

export function sanitizePacket(raw: unknown): Packet | null {
  const input = record(raw);
  if (!input) return null;
  const communeInsee = bounded(input.communeInsee, 5);
  const parcelId = bounded(input.parcelId, 20).toUpperCase();
  const terrainM2 = input.terrainM2;
  if (!/^(?:\d{5}|2[AB]\d{3})$/.test(communeInsee) || (parcelId && !/^[0-9A-Z]{14}$/.test(parcelId))
    || typeof terrainM2 !== 'number' || !Number.isFinite(terrainM2) || terrainM2 <= 0 || terrainM2 > 10_000_000
    || !Array.isArray(input.sectors) || input.sectors.length !== PROJECT_KEYS.length) return null;
  if (parcelId && parcelId.slice(0, 5) !== communeInsee) return null;
  const sectors: Sector[] = [];
  for (const value of input.sectors) {
    const sector = record(value);
    if (!sector || !keys.has(String(sector.key)) || !Array.isArray(sector.facts) || sector.facts.length > 8 || !Array.isArray(sector.missing)) return null;
    const facts: Fact[] = [];
    for (const rawFact of sector.facts) {
      const fact = record(rawFact);
      if (!fact) return null;
      const id = bounded(fact.id, 35), label = bounded(fact.label, 140), value = bounded(fact.value, 60);
      const scope = bounded(fact.scope, 120), source = bounded(fact.source, 120);
      if (!id || !label || !value || !scope || !source || !/^\w+:[1-8]$/.test(id) || !id.startsWith(`${sector.key}:`)) return null;
      facts.push({ id, label, value, scope, source, sourceUrl: officialUrl(fact.sourceUrl), direct: fact.direct === true });
    }
    sectors.push({ key: sector.key as ProjectKey, label: bounded(sector.label, 80), eligible: facts.some((fact) => fact.direct),
      targetHypothesis: bounded(sector.targetHypothesis, 350), programmeHint: bounded(sector.programmeHint, 500), facts,
      missing: sector.missing.slice(0, 5).map((v: unknown) => bounded(v, 200)).filter(Boolean) });
  }
  if (new Set(sectors.map((sector) => sector.key)).size !== PROJECT_KEYS.length || new Set(sectors.flatMap((sector) => sector.facts.map((fact) => fact.id))).size !== sectors.flatMap((sector) => sector.facts).length) return null;
  return { parcelId, communeInsee, terrainM2, pluZone: bounded(input.pluZone, 30) || null,
    dataDate: bounded(input.dataDate, 40), sectors };
}

export function validateAiResult(raw: unknown, packet: Packet): AiResult | null {
  const result = record(raw);
  if (!result || (result.status !== 'piste_prioritaire' && result.status !== 'aucune_priorite')) return null;
  const projectKey = keys.has(String(result.projectKey)) ? result.projectKey as ProjectKey : null;
  const rationale = bounded(result.rationale, 1200);
  if (!rationale) return null;
  const allFacts = new Set(packet.sectors.flatMap((sector) => sector.facts.map((fact) => fact.id)));
  const evidenceIds = Array.isArray(result.evidenceIds) ? result.evidenceIds.filter((id): id is string => typeof id === 'string' && allFacts.has(id)).slice(0, 6) : [];
  const conditions = Array.isArray(result.conditions) ? result.conditions.map((value: unknown) => bounded(value, 280)).filter(Boolean).slice(0, 5) : [];
  if (result.status === 'piste_prioritaire' && (!projectKey || !packet.sectors.find((sector) => sector.key === projectKey)?.eligible
    || !bounded(result.target, 350) || !bounded(result.programme, 500) || !evidenceIds.some((id) => id.startsWith(projectKey + ':')) || conditions.length === 0)) return null;
  const alternatives = Array.isArray(result.alternatives) ? result.alternatives.flatMap((rawAlt) => {
    const alt = record(rawAlt);
    return alt && keys.has(String(alt.key)) && alt.key !== projectKey && bounded(alt.reason, 280)
      ? [{ key: alt.key as ProjectKey, reason: bounded(alt.reason, 280) }] : [];
  }).slice(0, 2) : [];
  return { status: result.status, projectKey: result.status === 'piste_prioritaire' ? projectKey : null,
    target: bounded(result.target, 350), programme: bounded(result.programme, 500), rationale, evidenceIds,
    alternatives, conditions };
}
