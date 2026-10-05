import type { ChatMessage } from '../types/copilot.types';
import { calculateChatBilan } from '../../../../supabase/functions/_shared/finance/chatBilan';

export function exportTestResponse():ChatMessage{
  const bilan=calculateChatBilan({titre:'Opération fictive pour validation',base_montants:'HT',recettes_eur:2000000,surface_vendable_m2:500,foncier_eur:400000,frais_acquisition_eur:30000,travaux_eur:900000,honoraires_eur:200000,assurances_eur:20000,taxes_eur:50000,commercialisation_eur:40000,financement_eur:60000,aleas_eur:50000,autres_couts_eur:0,fonds_propres_eur:300000,marge_cible_pct:20});
  return {id:'export-test',role:'assistant',status:'complete',createdAt:'2026-10-05T10:00:00Z',text:'## Synthèse\nDonnées fictives pour valider les exports. Le résultat avant fiscalité est de **250 000 €**, pour une marge sur recettes de **12,5 %**. La cible déclarée de 20 % reste à atteindre.\n\n| Scénario | Résultat |\n| --- | --- |\n| Base | 250 000 € |\n| Combiné | 60 000 € |\n\n## Points à vérifier\n- Règlement écrit et périmètre cadastral.\n- Prix de commercialisation et devis des travaux.\n\n```mimmoza-chart\n{"type":"bar","title":"Résultats déclarés","unit":"€","source":"Exemple fictif","data":[{"label":"Base","value":250000},{"label":"Combiné","value":60000}]}\n```',
    toolCalls:[
      {id:'dvf',name:'get_dvf_comparables',status:'success',output:{status:'ok',source:'DVF · source fictive de test',data:{commune:'Ascain',stats:{transactions_count:12,price_median_eur_m2:4000,price_q1_eur_m2:3500,price_q3_eur_m2:5200,price_mean_eur_m2:null},comparables:Array.from({length:12},(_,i)=>({date:'2026-01-12',adresse:`Comparable fictif ${i+1}`,surface_m2:50+i,price_m2:4000+i}))}}},
      {id:'dpe',name:'get_dpe_ademe',status:'success',output:{status:'ok',source:'ADEME · source fictive de test',data:{stats:{total:29,nb_passoires_fg:7,plus_recent:'2026-02-12',distribution_dpe:{A:1,B:3,C:8,D:6,E:4,F:5,G:2}}}}},
      {id:'bilan',name:'calculer_bilan_financier',status:'success',output:bilan},
      {id:'web',name:'web_search',status:'success',output:{sources:[{title:'Source fictive',url:'https://example.fr/'}]}},
      {id:'web-fail',name:'web_fetch',status:'error',error:'too_many_requests'},
    ]};
}
