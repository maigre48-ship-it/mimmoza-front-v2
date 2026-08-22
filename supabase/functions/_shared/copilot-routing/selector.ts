export type CopilotIntent = 'parcel_analysis' | 'plu_feasibility' | 'risks' | 'valuation_dvf' | 'market' | 'building_renovation' | 'rental_profitability' | 'local_context' | 'tenders' | 'watch_search' | 'navigation_actions';

export interface ToolSelection { intent: CopilotIntent | 'ambiguous'; confidence: number; reason: string; toolNames: string[]; isFallback: boolean }
interface IntentRule { intent: CopilotIntent; patterns: RegExp[]; tools: string[] }

const RULES: IntentRule[] = [
  { intent: 'parcel_analysis', patterns: [/etude complete/, /analyse (?:complete|globale|de la parcelle)/, /parcelle/, /terrain/, /adresse/], tools: ['get_etude_parcelle', 'get_parcel_summary', 'get_parcel_plu', 'get_zonage_plu', 'get_prescriptions_urbanisme', 'get_servitudes', 'get_risks_georisques', 'get_ppr_detail', 'get_altimetrie', 'get_assainissement', 'get_classement_sonore', 'get_potentiel_solaire', 'get_monuments_historiques', 'get_batiment_bdnb'] },
  { intent: 'plu_feasibility', patterns: [/\bplu\b/, /urbanis/, /constructib/, /faisabilit/, /zonage/, /servitude/, /prescription/, /permis/, /emprise/, /hauteur/], tools: ['get_parcel_summary', 'get_parcel_plu', 'get_zonage_plu', 'get_prescriptions_urbanisme', 'get_servitudes', 'get_altimetrie'] },
  { intent: 'risks', patterns: [/risque/, /georisque/, /inond/, /radon/, /argile/, /sism/, /pollu/, /\bppr\b/, /bruit/, /sonore/, /assainissement/], tools: ['get_risks_georisques', 'get_ppr_detail', 'get_classement_sonore', 'get_assainissement', 'get_batiment_bdnb'] },
  { intent: 'valuation_dvf', patterns: [/estim(?:e|er|ation)/, /valoris/, /valeur/, /prix au m/, /prix de vente/, /comparable/, /\bdvf\b/, /smartscore/], tools: ['get_dvf_comparables', 'compute_smartscore', 'get_quick_market_insight', 'get_batiment_bdnb', 'get_contexte_commune'] },
  { intent: 'market', patterns: [/etude de marche/, /marche immobilier/, /tendance/, /demande locale/, /offre locale/, /sitadel/, /logement social/, /vacance/, /population/], tools: ['get_etude_marche', 'get_quick_market_insight', 'get_dvf_comparables', 'get_sitadel', 'get_logement_social', 'get_contexte_commune', 'get_zonage_abc'] },
  { intent: 'building_renovation', patterns: [/\bdpe\b/, /energie/, /energet/, /renovation/, /travaux/, /batiment/, /construction/, /cout/, /solaire/, /patrimoine/, /monument/], tools: ['get_dpe_ademe', 'get_batiment_bdnb', 'get_couts_renovation', 'get_couts_construction', 'get_potentiel_solaire', 'get_monuments_historiques'] },
  { intent: 'rental_profitability', patterns: [/loyer/, /locati/, /rentabilit/, /rendement/, /cash.?flow/, /\btri\b/, /financ/, /zonage abc/, /fiscal/], tools: ['get_loyers_reference', 'get_zonage_abc', 'get_taxes_locales', 'get_dvf_comparables', 'get_quick_market_insight', 'get_couts_renovation'] },
  { intent: 'local_context', patterns: [/equipement/, /ecole/, /commerce/, /service/, /transport/, /etablissement/, /quartier/, /commune/, /contexte local/, /proximite/], tools: ['get_contexte_commune', 'get_equipements_proches', 'get_etablissements_proches', 'get_logement_social', 'get_sitadel'] },
  { intent: 'tenders', patterns: [/appel.? d.?offre/, /\bboamp\b/, /marche public/, /consultation publique/, /\bdce\b/, /veille appel/], tools: ['get_appels_offres', 'creer_veille_appels_offres', 'lister_veilles_appels_offres', 'lister_nouveautes_appels_offres', 'marquer_nouveautes_lues', 'desactiver_veille_appels_offres'] },
  { intent: 'watch_search', patterns: [/recherche.*bien/, /trouve.*bien/, /annonce/, /opportunit/, /watchlist/, /zone de veille/, /surveille/, /veille immobiliere/], tools: ['recherche_biens', 'creer_zone_veille', 'lister_zones_veille', 'desactiver_zone_veille', 'creer_watchlist', 'lister_watchlists', 'desactiver_watchlist'] },
  { intent: 'navigation_actions', patterns: [/^\s*(?:ouvre|ouvrir|affiche|va sur|navigue)/, /cree (?:une )?operation/, /lance (?:l etape|l'etape)/, /onglet/, /page/], tools: [] },
];

function normalize(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() }

/** Selects a conservative subset of available tools without any model call. */
export function selectToolNames(message: string, availableNames: readonly string[]): ToolSelection {
  const available = [...new Set(availableNames)];
  const actions = available.filter((name) => name.startsWith('action_'));
  const text = ` ${normalize(message)} `;
  const ranked = RULES.map((rule) => ({ rule, score: rule.patterns.reduce((n, pattern) => n + (pattern.test(text) ? 1 : 0), 0) })).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score);
  if (ranked.length === 0 || (ranked.length > 1 && ranked[0].score === ranked[1].score)) return { intent: 'ambiguous', confidence: 0, reason: 'Aucune intention dominante; conservation de tous les outils disponibles.', toolNames: available, isFallback: true };
  const winner = ranked[0];
  const selected = new Set([...winner.rule.tools, ...actions]);
  const toolNames = available.filter((name) => selected.has(name));
  if (toolNames.length === 0) return { intent: 'ambiguous', confidence: 0, reason: 'Aucun outil compatible avec le mode; conservation de tous les outils disponibles.', toolNames: available, isFallback: true };
  const margin = winner.score - (ranked[1]?.score ?? 0);
  return { intent: winner.rule.intent, confidence: Number(Math.min(0.98, 0.58 + winner.score * 0.1 + margin * 0.08).toFixed(2)), reason: `Intention ${winner.rule.intent} detectee par ${winner.score} signal(aux).`, toolNames, isFallback: false };
}
