export type DesignSignal = { id: string; title: string; url: string; observation: string; scope: string; year: string; family: 'durable' | 'contemporain' | 'expressif' };
export type DesignFact = { label: string; value: string; scope: string; source: string; url: string };
export type StrategyContext = { programmeDetail: string | null; units: string | null; grossAreaM2: string | null;
  facts: DesignFact[]; pluZone: string | null; pluSource: string | null;
  envelope: { cesRatio: number | null; heightM: number | null; parkingPerHousing: number | null } | null };
export type DesignPacket = { programme: string; target: string; location: string; pluZone: string | null;
  horizonYears: number; priority: string; signals: DesignSignal[]; answers?: Record<QuestionId, string>; strategy?: StrategyContext };
export const QUESTION_IDS = ['audience', 'atmosphere', 'operation', 'identity'] as const;
export type QuestionId = typeof QUESTION_IDS[number];
export type QuestionPacket = { programme: string; target: string | null; location: string; pluZone: string | null;
  horizonYears: number; priority: string; strategy?: StrategyContext };
export type DesignQuestion = { id: QuestionId; question: string; why: string; options: string[] };
export type GeneratedDirection = { family: DesignSignal['family']; title: string; intent: string;
  palette: { name: string; hex: string; use: string }[]; materials: string[]; architecture: string[]; interiors: string[];
  lasting: string[]; adaptable: string[]; vigilance: string; sourceIds: string[]; audienceFit?: string };
export type GeneratedDesign = { directions: GeneratedDirection[]; recommendedFamily: DesignSignal['family'];
  rationale: string; checks: string[]; generatedAt?: string; model?: string };

const obj = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const str = (value: unknown, min: number, max: number): string | null => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max ? value.trim() : null;
const strings = (value: unknown, min: number, max: number, maxLength = 250): string[] | null => Array.isArray(value) && value.length >= min
  && value.length <= max && value.every((item) => str(item, 2, maxLength)) ? value.map((item) => item.trim()) : null;
const families = new Set(['durable', 'contemporain', 'expressif']);
const https = (value: unknown, max = 400): string | null => {
  const url = str(value, 10, max);
  if (!url) return null;
  try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; }
};

export function sanitizeStrategyContext(value: unknown): StrategyContext | null {
  if (value == null) return null;
  const raw = obj(value);
  if (!raw || !Array.isArray(raw.facts) || raw.facts.length > 8) return null;
  const facts: DesignFact[] = [];
  for (const candidate of raw.facts) {
    const fact = obj(candidate);
    const label = str(fact?.label, 3, 100), measuredValue = str(fact?.value, 1, 100);
    const scope = str(fact?.scope, 3, 150), source = str(fact?.source, 3, 100), url = https(fact?.url);
    if (!label || !measuredValue || !scope || !source || !url) return null;
    facts.push({ label, value: measuredValue, scope, source, url });
  }
  if (raw.programmeDetail != null && !str(raw.programmeDetail, 3, 600)) return null;
  if (raw.units != null && !/^\d{1,5}$/.test(String(raw.units))) return null;
  if (raw.grossAreaM2 != null && !/^\d{1,8}(?:[.,]\d{1,2})?$/.test(String(raw.grossAreaM2))) return null;
  if (raw.pluSource != null && !https(raw.pluSource)) return null;
  let envelope: StrategyContext['envelope'] = null;
  if (raw.envelope != null) {
    const values = obj(raw.envelope);
    if (!values) return null;
    const cesRatio = values.cesRatio, heightM = values.heightM, parkingPerHousing = values.parkingPerHousing;
    if (cesRatio != null && (typeof cesRatio !== 'number' || !Number.isFinite(cesRatio) || cesRatio <= 0 || cesRatio > 1)) return null;
    if (heightM != null && (typeof heightM !== 'number' || !Number.isFinite(heightM) || heightM <= 0 || heightM > 300)) return null;
    if (parkingPerHousing != null && (typeof parkingPerHousing !== 'number' || !Number.isFinite(parkingPerHousing) || parkingPerHousing < 0 || parkingPerHousing > 20)) return null;
    envelope = { cesRatio: cesRatio as number | null, heightM: heightM as number | null, parkingPerHousing: parkingPerHousing as number | null };
  }
  return { programmeDetail: str(raw.programmeDetail, 3, 600), units: raw.units == null ? null : String(raw.units),
    grossAreaM2: raw.grossAreaM2 == null ? null : String(raw.grossAreaM2), facts,
    pluZone: str(raw.pluZone, 1, 40), pluSource: https(raw.pluSource), envelope };
}

export function sanitizeQuestionPacket(value: unknown): QuestionPacket | null {
  const raw = obj(value);
  const programme = str(raw?.programme, 3, 120), location = str(raw?.location, 2, 180), priority = str(raw?.priority, 3, 150);
  const horizonYears = raw?.horizonYears;
  if (!programme || !location || !priority || typeof horizonYears !== 'number' || !Number.isInteger(horizonYears) || horizonYears < 5 || horizonYears > 30) return null;
  if (raw?.target != null && raw.target !== '' && !str(raw.target, 3, 240)) return null;
  const strategy = sanitizeStrategyContext(raw?.strategy);
  if (raw?.strategy != null && !strategy) return null;
  return { programme, target: str(raw?.target, 3, 240), location, priority, horizonYears, pluZone: str(raw?.pluZone, 1, 40), ...(strategy ? { strategy } : {}) };
}

export function validateDesignQuestions(value: unknown): DesignQuestion[] | null {
  const raw = obj(value);
  if (!Array.isArray(raw?.questions) || raw.questions.length !== QUESTION_IDS.length) return null;
  const questions: DesignQuestion[] = [];
  for (const id of QUESTION_IDS) {
    const item = obj(raw.questions.find((candidate: unknown) => obj(candidate)?.id === id));
    const question = str(item?.question, 12, 220), why = str(item?.why, 8, 220);
    const options = strings(item?.options, 3, 3, 100);
    if (!question || !why || !options || new Set(options.map((option) => option.toLowerCase())).size !== 3) return null;
    questions.push({ id, question, why, options });
  }
  return questions;
}

export function sanitizeDesignPacket(value: unknown): DesignPacket | null {
  const raw = obj(value);
  const programme = str(raw?.programme, 3, 120), target = str(raw?.target, 3, 240);
  const location = str(raw?.location, 2, 180), priority = str(raw?.priority, 3, 150);
  const horizonYears = raw?.horizonYears;
  if (!programme || !target || !location || !priority || typeof horizonYears !== 'number' || !Number.isInteger(horizonYears) || horizonYears < 5 || horizonYears > 30) return null;
  if (!Array.isArray(raw?.signals) || raw.signals.length < 1 || raw.signals.length > 15) return null;
  const signals: DesignSignal[] = [];
  for (const value of raw.signals) {
    const item = obj(value);
    const id = str(item?.id, 2, 48), title = str(item?.title, 3, 150), observation = str(item?.observation, 15, 650);
    const url = str(item?.url, 10, 400), scope = str(item?.scope, 2, 120), year = str(item?.year, 4, 30);
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || !title || !observation || !url || !scope || !year || !families.has(String(item?.family))) return null;
    try { if (new URL(url).protocol !== 'https:') return null; } catch { return null; }
    if (signals.some((signal) => signal.id === id)) return null;
    signals.push({ id, title, url, observation, scope, year, family: item!.family as DesignSignal['family'] });
  }
  let answers: Record<QuestionId, string> | undefined;
  if (raw.answers != null) {
    const received = obj(raw.answers);
    if (!received || Object.keys(received).length !== QUESTION_IDS.length) return null;
    const entries = QUESTION_IDS.map((id) => [id, str(received[id], 2, 240)] as const);
    if (entries.some(([, answer]) => !answer)) return null;
    answers = Object.fromEntries(entries) as Record<QuestionId, string>;
  }
  const strategy = sanitizeStrategyContext(raw.strategy);
  if (raw.strategy != null && !strategy) return null;
  return { programme, target, location, priority, horizonYears, pluZone: str(raw?.pluZone, 1, 40), signals,
    ...(answers ? { answers } : {}), ...(strategy ? { strategy } : {}) };
}

export function validateGeneratedDesign(value: unknown, packet: DesignPacket): GeneratedDesign | null {
  const raw = obj(value);
  if (!raw || !Array.isArray(raw.directions) || raw.directions.length !== 3 || !families.has(String(raw.recommendedFamily))) return null;
  const ids = new Set(packet.signals.map((signal) => signal.id));
  const foundFamilies = new Set<string>();
  const directions: GeneratedDirection[] = [];
  for (const item of raw.directions) {
    const direction = obj(item), family = String(direction?.family ?? '');
    if (!families.has(family) || foundFamilies.has(family)) return null;
    foundFamilies.add(family);
    const title = str(direction?.title, 3, 100), intent = str(direction?.intent, 15, 400);
    const audienceFit = str(direction?.audienceFit, 20, 400);
    const materials = strings(direction?.materials, 2, 5, 140), architecture = strings(direction?.architecture, 2, 4);
    const interiors = strings(direction?.interiors, 2, 4), lasting = strings(direction?.lasting, 2, 4);
    const adaptable = strings(direction?.adaptable, 2, 4), vigilance = str(direction?.vigilance, 15, 400);
    const sourceIds = strings(direction?.sourceIds, 1, 5, 48);
    if (!title || !intent || !materials || !architecture || !interiors || !lasting || !adaptable || !vigilance || !sourceIds
      || sourceIds.some((id) => !ids.has(id))) return null;
    const palette = direction?.palette;
    if (!Array.isArray(palette) || palette.length !== 3) return null;
    const colors = palette.map(obj);
    if (colors.some((color) => !str(color?.name, 2, 60) || !str(color?.use, 4, 120) || typeof color?.hex !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(color.hex))) return null;
    directions.push({ family: family as DesignSignal['family'], title, intent, materials, architecture, interiors, lasting,
      adaptable, vigilance, sourceIds, ...(audienceFit ? { audienceFit } : {}),
      palette: colors.map((color) => ({ name: String(color!.name), hex: String(color!.hex).toUpperCase(), use: String(color!.use) })) });
  }
  const rationale = str(raw.rationale, 20, 600), checks = strings(raw.checks, 3, 6, 250);
  if (!rationale || !checks) return null;
  return { directions, recommendedFamily: raw.recommendedFamily as DesignSignal['family'], rationale, checks };
}
