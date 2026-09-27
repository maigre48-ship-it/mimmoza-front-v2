export type OperatorFollowUp = { status: 'non_contacte' | 'contacte' | 'reponse_attente' | 'interet_declare' | 'refus';
  name: string; kind: string; contactDate: string; responseDate: string; source: string; criteria: string; note: string; nextAction: string };
export const EMPTY_OPERATOR_FOLLOWUP: OperatorFollowUp = { status: 'non_contacte', name: '', kind: '', contactDate: '', responseDate: '', source: '', criteria: '', note: '', nextAction: '' };

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && value <= new Date().toISOString().slice(0, 10);
export function documentedInterest(value: Partial<OperatorFollowUp> | undefined): boolean {
  return value?.status === 'interet_declare' && validDate(value.responseDate ?? '')
    && (value.source?.trim().length ?? 0) >= 4 && (value.note?.trim().length ?? 0) >= 12;
}

export function summarizeOperatorFollowups(values: Record<string, Partial<OperatorFollowUp>>, sirens: string[]) {
  const unique = [...new Set(sirens)];
  const items = unique.map((siren) => ({ siren, value: values[siren] }));
  return { total: unique.length,
    contacted: items.filter(({ value }) => value && value.status !== 'non_contacte').length,
    answered: items.filter(({ value }) => value?.status === 'interet_declare' || value?.status === 'refus').length,
    interests: items.filter(({ value }) => documentedInterest(value)).map(({ siren, value }) => ({ siren, value: value! })),
    refusals: items.filter(({ value }) => value?.status === 'refus').length };
}
