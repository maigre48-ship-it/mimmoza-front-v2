import type { ActiveToolCall } from '../types/copilot.types';
import { record } from './apiResultModel';

/** Evidence checks independent of the generated recommendation. */
export function tertiaryReview(question: string | null | undefined, calls: ActiveToolCall[]): string[] {
  if (!question || !/(bureaux|commerces?|locaux? d['’ ]activit[eé]|immobilier.{0,10}tertiaire)/i.test(question) || !/(compar|meilleur|pertinent|projet|programme)/i.test(question)) return [];
  const reasons: string[] = [];
  const results = calls.filter(c => c.status === 'success' && !['error','not_found','not_configured'].includes(String(record(c.output).status)));
  const plu = results.some(c => {
    const d = record(record(c.output).data);
    if (c.name === 'get_parcel_plu') return Boolean(d.zone_code) && Object.keys(record(d.regles)).length > 0;
    if (c.name === 'get_etude_parcelle') return Array.isArray(d.evidences) && d.evidences.some(e => record(e).id === 'reglement_plu' && record(e).status === 'confirmed');
    return false;
  });
  if (!plu) reasons.push('Règlement PLU et droits à bâtir non confirmés par les résultats de cette réponse : les surfaces et gabarits proposés restent des hypothèses.');
  if (/(locaux? d['’ ]activit[eé])/i.test(question)) reasons.push('Locaux d’activité : aucun connecteur spécialisé ne mesure actuellement la demande, la vacance ou les loyers signés. Les sources Internet doivent être qualifiées séparément.');
  if (results.some(c => c.name === 'get_etude_marche')) reasons.push('Les scores communaux, le DVF tous biens et le nombre d’équipements ne départagent pas les programmes tertiaires. Des loyers comparables et des besoins utilisateurs documentés sont nécessaires.');
  return reasons;
}
