import type { DecisionRecord } from './decisionDossier.ts';
import type { HotelEvidence } from './hotelMarket.ts';
import type { BpeMarket } from './bpeMarket.ts';
import type { MarketSupply } from './marketSupply.ts';
import type { FinessSupply } from './finessSupply.ts';
import { programmeKind, type PluEnvelope } from './projectProgramme.ts';
import { readSector, type MarketResult, type SectorKey } from './sectorScreening.ts';
import type { StrategyContext } from '../../../../supabase/functions/design-direction-v1/validation.ts';

export type DesignStrategyScenario = {
  id: string; programme: string; parcelId?: string; address?: string; insee?: string; date?: string;
  pluZone?: string | null; pluSource?: string | null; pluEnvelope?: PluEnvelope | null;
  market?: MarketResult | null; hotelEvidence?: HotelEvidence | null; bpe?: BpeMarket | null;
  supply?: MarketSupply | null; finess?: FinessSupply | null;
};

const sectorByKind: Record<string, SectorKey | null> = {
  hotel: 'hotel', housing: 'logement', ehpad: 'ehpad', clinic: 'clinique', retail: 'commerce', office: 'bureaux', student: 'residence_etudiante', other: null,
};
const validUrl = (value: string | null | undefined): string | null => {
  try { return value && new URL(value).protocol === 'https:' ? value : null; } catch { return null; }
};
const whole = (value: string | undefined): string | null => /^\d{1,5}$/.test(value?.trim() ?? '') && Number(value) > 0 ? value!.trim() : null;
const area = (value: string | undefined): string | null => /^\d{1,8}(?:[.,]\d{1,2})?$/.test(value?.trim() ?? '') && Number(value?.replace(',', '.')) > 0 ? value!.trim() : null;
const bounded = (value: number | null | undefined, min: number, max: number): number | null => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;

/** Réemploie seulement les mesures déjà collectées pour ce scénario et leur lien public. */
export function buildDesignStrategyContext(scenario: DesignStrategyScenario, decision?: DecisionRecord | null,
  studyPlu?: { zone?: string | null; source?: string | null }): StrategyContext {
  const sector = sectorByKind[programmeKind(scenario.programme)];
  const insee = scenario.insee?.trim().toUpperCase();
  const market = scenario.market?.meta?.commune_insee && insee && scenario.market.meta.commune_insee !== insee ? null : scenario.market;
  const hotel = scenario.hotelEvidence?.communeInsee && insee && scenario.hotelEvidence.communeInsee !== insee ? null : scenario.hotelEvidence;
  const scopedMarket = market ?? (hotel && insee ? { meta: { commune_insee: insee } } : null);
  const facts = sector ? readSector({ key: sector, market: scopedMarket, error: null, hotel: hotel ?? null,
    bpe: scenario.bpe?.communeInsee === insee ? scenario.bpe : null,
    supply: scenario.supply ?? null, finess: scenario.finess ?? null }).facts
    .flatMap((fact) => {
      const url = validUrl(fact.sourceUrl);
      return url ? [{ label: fact.label, value: fact.value, scope: fact.scope, source: fact.source, url }] : [];
    }).slice(0, 8) : [];
  const envelope = scenario.pluEnvelope ? { cesRatio: bounded(scenario.pluEnvelope.cesRatio, 0.001, 1),
    heightM: bounded(scenario.pluEnvelope.heightM, 0.01, 300), parkingPerHousing: bounded(scenario.pluEnvelope.parkingPerHousing, 0, 20) } : null;
  return { programmeDetail: decision?.programme?.trim().slice(0, 600) || null,
    units: whole(decision?.units), grossAreaM2: area(decision?.grossAreaM2), facts,
    pluZone: (scenario.pluZone || studyPlu?.zone || '').trim().slice(0, 40) || null,
    pluSource: validUrl(scenario.pluSource) ?? validUrl(studyPlu?.source),
    envelope: envelope && Object.values(envelope).some((value) => value != null) ? envelope : null };
}

export function strategyPrefill(scenario: DesignStrategyScenario, decision?: DecisionRecord | null) {
  return { programme: scenario.programme.trim().slice(0, 120), target: decision?.target?.trim().slice(0, 240) ?? '',
    location: (scenario.address || scenario.parcelId || scenario.insee || '').trim().slice(0, 180) };
}
