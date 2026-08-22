import { assertEquals, assert } from 'jsr:@std/assert@1';
import { selectToolNames } from './selector.ts';

const AVAILABLE = ['get_etude_parcelle', 'get_parcel_plu', 'get_zonage_plu', 'get_risks_georisques', 'get_dvf_comparables', 'get_etude_marche', 'get_dpe_ademe', 'get_couts_renovation', 'get_loyers_reference', 'get_equipements_proches', 'get_appels_offres', 'creer_veille_appels_offres', 'recherche_biens', 'creer_watchlist', 'action_ouvrir_page', 'action_creer_operation', 'action_lancer_etape'];

Deno.test('selectionne le PLU et conserve toutes les actions', () => {
  const result = selectToolNames('Quelle est la faisabilité PLU et la hauteur autorisée ?', AVAILABLE);
  assertEquals(result.intent, 'plu_feasibility'); assert(result.toolNames.includes('get_parcel_plu')); assert(result.toolNames.includes('get_zonage_plu')); assert(result.toolNames.includes('action_ouvrir_page')); assert(!result.toolNames.includes('get_dpe_ademe'));
});

Deno.test('couvre les principales familles métier', () => {
  const cases: Array<[string, string, string]> = [
    ['Fais une analyse complète de cette parcelle', 'parcel_analysis', 'get_etude_parcelle'], ['Quels sont les risques inondation et argile ?', 'risks', 'get_risks_georisques'], ['Estime ce bien avec les comparables DVF', 'valuation_dvf', 'get_dvf_comparables'], ['Fais une étude de marché immobilier', 'market', 'get_etude_marche'], ['Quel budget de rénovation pour améliorer le DPE ?', 'building_renovation', 'get_dpe_ademe'], ['Calcule la rentabilité avec le loyer', 'rental_profitability', 'get_loyers_reference'], ['Quels équipements et écoles sont proches ?', 'local_context', 'get_equipements_proches'], ["Trouve les appels d'offres BOAMP", 'tenders', 'get_appels_offres'], ['Recherche des biens et crée une watchlist', 'watch_search', 'recherche_biens'], ["Ouvre l'onglet de l'étude", 'navigation_actions', 'action_ouvrir_page'],
  ];
  for (const [message, intent, tool] of cases) { const result = selectToolNames(message, AVAILABLE); assertEquals(result.intent, intent, message); assert(result.toolNames.includes(tool), message) }
});

Deno.test('une demande ambiguë conserve tous les outils du mode', () => { const result = selectToolNames('Peux-tu regarder cela ?', AVAILABLE); assertEquals(result.isFallback, true); assertEquals(result.toolNames, AVAILABLE) });
Deno.test('ne renvoie jamais un outil indisponible', () => { const result = selectToolNames('Analyse complète de la parcelle', ['get_parcel_plu', 'action_ouvrir_page']); assertEquals(result.toolNames, ['get_parcel_plu', 'action_ouvrir_page']) });
