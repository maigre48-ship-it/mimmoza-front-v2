import { readSector, SCREENING_SECTORS, type SectorKey, type SectorSnapshot } from './sectorScreening.ts';
import { validateAiResult } from '../../../../supabase/functions/project-recommendation-v1/validation.ts';

export type RecommendationFact = { id: string; label: string; value: string; scope: string; source: string; sourceUrl?: string; direct: boolean };
export type RecommendationSector = { key: SectorKey; label: string; eligible: boolean; targetHypothesis: string; programmeHint: string; facts: RecommendationFact[]; missing: string[] };
export type RecommendationPacket = {
  parcelId: string; communeInsee: string; terrainM2: number; pluZone: string | null;
  dataDate: string; sectors: RecommendationSector[];
};
export type ProjectRecommendation = {
  status: 'piste_prioritaire' | 'aucune_priorite';
  projectKey: SectorKey | null;
  target: string;
  programme: string;
  rationale: string;
  evidenceIds: string[];
  alternatives: { key: SectorKey; reason: string }[];
  conditions: string[];
  generatedAt: string;
  model: string;
};

const keys = new Set<SectorKey>(SCREENING_SECTORS.map((sector) => sector.key));

export function acceptAiRecommendation(raw: unknown, packet: RecommendationPacket): ProjectRecommendation | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const response = raw as Record<string, unknown>;
  const validated = validateAiResult(response.recommendation, packet);
  if (!validated) return null;
  const item = response.recommendation as Record<string, unknown>;
  return { ...validated, generatedAt: typeof item.generatedAt === 'string' && !Number.isNaN(Date.parse(item.generatedAt)) ? item.generatedAt : new Date().toISOString(),
    model: typeof item.model === 'string' && item.model.length <= 100 ? item.model : 'IA' };
}

export function buildRecommendationPacket(input: {
  parcelId: string; communeInsee: string; terrainM2: number; pluZone: string | null;
  dataDate: string; snapshots: SectorSnapshot[];
}): RecommendationPacket {
  const sectors = input.snapshots.filter((item) => keys.has(item.key)).map((snapshot) => {
    const reading = readSector(snapshot);
    const facts = reading.facts.slice(0, 8).map((fact, index) => ({ ...fact, id: `${snapshot.key}:${index + 1}` }));
    return { key: snapshot.key, label: reading.label, eligible: facts.some((fact) => fact.direct),
      targetHypothesis: reading.target, programmeHint: reading.programme, facts, missing: reading.missing.slice(0, 5) };
  });
  return { parcelId: input.parcelId.slice(0, 20), communeInsee: input.communeInsee, terrainM2: input.terrainM2,
    pluZone: input.pluZone?.slice(0, 30) ?? null, dataDate: input.dataDate, sectors };
}

/** Une priorité d'instruction se fonde sur une activité observée, puis sur la proximité du périmètre. */
export function recommendProjectLocally(packet: RecommendationPacket): ProjectRecommendation {
  const candidates = packet.sectors.flatMap((sector) => {
    const observed = sector.key === 'logement' ? sector.facts.find((fact) => fact.label === 'Transactions DVF' && fact.direct && Number(fact.value.replace(/\s/g, '')) > 0)
      : sector.key === 'hotel' ? sector.facts.find((fact) => fact.label === 'Nuitées hôtelières' && fact.direct && Number(fact.value.replace(/\s/g, '')) > 0)
        : undefined;
    if (!observed) return [];
    const geography = /commune/i.test(observed.scope) ? 3 : /bassin|epci|intercommunalit/i.test(observed.scope) ? 2 : /département/i.test(observed.scope) ? 1 : 0;
    return [{ sector, observed, geography }];
  }).sort((a, b) => b.geography - a.geography);
  const best = candidates[0];
  const base = { generatedAt: new Date().toISOString(), model: 'analyse locale des faits' };
  if (!best || (candidates[1] && candidates[1].geography === best.geography)) return {
    ...base, status: 'aucune_priorite', projectKey: null, target: '', programme: '', evidenceIds: [],
    rationale: best ? 'Plusieurs usages disposent de signaux d’activité au même périmètre. Les données disponibles ne permettent pas de les départager sans marchés locaux et bilans comparables.'
      : 'Aucune activité de marché propre à un usage n’est suffisamment mesurée pour classer les programmes. Les populations et dénombrements d’équipements seuls ne prouvent pas une demande.',
    alternatives: candidates.slice(0, 2).map(({ sector }) => ({ key: sector.key, reason: 'Marché et bilan spécifiques à documenter avant arbitrage.' })),
    conditions: ['Vérifier les destinations autorisées et contraintes de la parcelle.', 'Mesurer la demande, les prix, la concurrence et l’économie de chaque usage.'],
  };
  const { sector, observed } = best;
  const supporting = sector.facts.filter((fact) => fact.direct && fact.id !== observed.id).slice(0, 2);
  return {
    ...base, status: 'piste_prioritaire', projectKey: sector.key,
    target: sector.targetHypothesis, programme: sector.programmeHint,
    rationale: `${sector.label} est la première piste à instruire : ${observed.label.toLowerCase()} observées à l’échelle ${observed.scope.toLowerCase()} (${observed.value}). Ce signal est plus proche du marché étudié que les seuls indicateurs de population ou d’offre disponibles pour les autres usages. Il ne prouve ni la demande pour ce bâtiment, ni la rentabilité de son programme. La surface de ${new Intl.NumberFormat('fr-FR').format(packet.terrainM2)} m² ne suffit pas à en déduire une capacité constructible.`,
    evidenceIds: [observed.id, ...supporting.map((fact) => fact.id)],
    alternatives: candidates.slice(1, 3).map(({ sector: other }) => ({ key: other.key, reason: 'Activité observée, mais sur un périmètre moins proche du terrain ; comparer les bilans.' })),
    conditions: [
      'Confirmer la destination autorisée, les servitudes, les risques et la capacité réelle du terrain.',
      ...sector.missing.slice(0, 2),
      'Chiffrer un programme, un bilan prudent et obtenir la réponse d’un acquéreur ou exploitant.',
    ],
  };
}
