type RecordData = Record<string, unknown>;
const record = (value: unknown): RecordData => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : {};
export function gpuEvidenceSummary(statsValue: unknown, view: 'zonage' | 'prescriptions'): string {
  const stats = record(statsValue);
  const count = (key: string) => typeof stats[key] === 'number' && Number.isFinite(stats[key]) ? String(stats[key]) : 'nombre non précisé';
  return view === 'zonage'
    ? `Zonage GPU au point de recherche : ${count('nb_zones')} zone(s) retournée(s). Le point ne confirme ni le numéro d’adresse ni les limites du terrain. Les destinations, la constructibilité et les règles opposables restent à vérifier dans les documents écrits et graphiques applicables.`
    : `GPU au point de recherche : ${count('nb_prescriptions')} prescription(s) et ${count('nb_informations')} information(s) retournée(s). Une information et une prescription sont distinctes ; absence de résultat ne signifie pas absence de règle. Cet appel ne conclut pas sur le zonage ni sur un droit de préemption applicable à une cession.`;
}
export const GPU_EVIDENCE_WARNING = 'Les libellés SPR/SS et les codes GPU signalent des objets cartographiques. Ils ne prouvent pas seuls le régime du projet, l’intervention de l’ABF, la destination autorisée, un droit de préemption ou un délai de procédure. Vérifier périmètres, documents et acte projeté. Le règlement écrit n’a pas été lu par cet outil. Aucune applicabilité de la loi Littoral n’est déduite du seul résultat GPU.';
