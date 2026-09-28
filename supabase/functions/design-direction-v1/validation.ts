export type DesignSignal = { id: string; title: string; url: string; observation: string; scope: string; year: string; family: 'durable' | 'contemporain' | 'expressif' };
export type DesignPacket = { programme: string; target: string; location: string; pluZone: string | null;
  horizonYears: number; priority: string; signals: DesignSignal[]; answers?: Record<QuestionId, string> };
export const QUESTION_IDS = ['audience', 'atmosphere', 'operation', 'identity'] as const;
export type QuestionId = typeof QUESTION_IDS[number];
export type QuestionPacket = { programme: string; target: string | null; location: string; pluZone: string | null;
  horizonYears: number; priority: string };
export type DesignQuestion = { id: QuestionId; question: string; why: string; options: string[] };
export type GeneratedDirection = { family: DesignSignal['family']; title: string; intent: string;
  palette: { name: string; hex: string; use: string }[]; materials: string[]; architecture: string[]; interiors: string[];
  lasting: string[]; adaptable: string[]; vigilance: string; sourceIds: string[] };
export type GeneratedDesign = { directions: GeneratedDirection[]; recommendedFamily: DesignSignal['family'];
  rationale: string; checks: string[]; generatedAt?: string; model?: string };

const obj = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const str = (value: unknown, min: number, max: number): string | null => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max ? value.trim() : null;
const strings = (value: unknown, min: number, max: number, maxLength = 250): string[] | null => Array.isArray(value) && value.length >= min
  && value.length <= max && value.every((item) => str(item, 2, maxLength)) ? value.map((item) => item.trim()) : null;
const families = new Set(['durable', 'contemporain', 'expressif']);

export function sanitizeQuestionPacket(value: unknown): QuestionPacket | null {
  const raw = obj(value);
  const programme = str(raw?.programme, 3, 120), location = str(raw?.location, 2, 180), priority = str(raw?.priority, 3, 150);
  const horizonYears = raw?.horizonYears;
  if (!programme || !location || !priority || typeof horizonYears !== 'number' || !Number.isInteger(horizonYears) || horizonYears < 5 || horizonYears > 30) return null;
  if (raw?.target != null && raw.target !== '' && !str(raw.target, 3, 240)) return null;
  return { programme, target: str(raw?.target, 3, 240), location, priority, horizonYears, pluZone: str(raw?.pluZone, 1, 40) };
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
  return { programme, target, location, priority, horizonYears, pluZone: str(raw?.pluZone, 1, 40), signals, ...(answers ? { answers } : {}) };
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
      adaptable, vigilance, sourceIds, palette: colors.map((color) => ({ name: String(color!.name), hex: String(color!.hex).toUpperCase(), use: String(color!.use) })) });
  }
  const rationale = str(raw.rationale, 20, 600), checks = strings(raw.checks, 3, 6, 250);
  if (!rationale || !checks) return null;
  return { directions, recommendedFamily: raw.recommendedFamily as DesignSignal['family'], rationale, checks };
}
