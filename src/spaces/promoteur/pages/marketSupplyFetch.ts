import { supabase } from '@/lib/supabaseClient';
import { parseRpls, parseSitadel, type MarketSupply } from './marketSupply';

/** Lecture ponctuelle de services existants. Aucun nouvel enregistrement de données DVF ou RPLS. */
export async function fetchMarketSupply(insee: string): Promise<MarketSupply> {
  if (!/^(?:\d{5}|2[AB]\d{3})$/.test(insee)) return { pipeline: null, social: null, warnings: ['Code INSEE invalide.'] };
  const [sitadel, rpls] = await Promise.allSettled([
    supabase.functions.invoke('sitadel-commune-v1', { body: { code_insee: insee } }),
    supabase.functions.invoke('besoin-logements-sociaux', { body: { query: insee } }),
  ]);
  const sitadelData = sitadel.status === 'fulfilled' && !sitadel.value.error ? sitadel.value.data : null;
  const rplsData = rpls.status === 'fulfilled' && !rpls.value.error ? rpls.value.data : null;
  const pipeline = parseSitadel(sitadelData, insee);
  const social = parseRpls(rplsData, insee);
  return { pipeline, social, warnings: [!pipeline ? 'Permis Sitadel communaux non vérifiés ou indisponibles.' : '',
    !social ? 'Parc RPLS réel communal indisponible ; aucune estimation n’est retenue.' : ''].filter(Boolean) };
}
