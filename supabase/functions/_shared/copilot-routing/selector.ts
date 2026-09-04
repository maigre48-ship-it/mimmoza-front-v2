// =============================================================================
// SÉLECTEUR D'OUTILS — pré-filtrage sans appel au modèle
// =============================================================================
//
// Ce que fait ce module, et ce qu'il ne doit PAS faire
// ---------------------------------------------------
// Il réduit le nombre de schémas d'outils envoyés au modèle quand l'intention
// est claire. C'est une optimisation de coût, PAS une politique d'accès : un
// outil retiré ici est un outil que le modèle ne peut plus appeler, même si
// c'était le bon. La règle est donc : dans le doute, on garde tout.
//
// Trois garde-fous répondent aux mauvais routages observés en production :
//
//   1. SEUIL — un seul mot-clé ne suffit plus à restreindre. « Quelle est la
//      rentabilité de ce terrain ? » matchait `terrain` et perdait les outils
//      financiers. Il faut désormais MIN_SCORE_TO_RESTRICT signaux.
//
//   2. SOCLE — les outils de contexte de base (résumé de parcelle, commune,
//      DVF, actions) sont toujours joints à la sélection. Ils servent dans
//      presque toutes les réponses et leur absence produisait des réponses
//      sans données.
//
//   3. COUVERTURE — chaque règle liste les outils dont elle a besoin, pas
//      seulement ceux de son thème. `permis` amène `get_sitadel`, `mairie`
//      amène `get_contacts_mairies`.
//
// Maintenance : quand vous ajoutez un outil dans copilot-chat, ajoutez-le à au
// moins une règle ici, ou au socle. Sinon il ne sera proposé qu'en repli.
// =============================================================================

export type CopilotIntent =
  | 'parcel_analysis'
  | 'plu_feasibility'
  | 'risks'
  | 'valuation_dvf'
  | 'market'
  | 'building_renovation'
  | 'rental_profitability'
  | 'local_context'
  | 'contacts_institutions'
  | 'tenders'
  | 'watch_search'
  | 'navigation_actions';

export interface ToolSelection {
  intent: CopilotIntent | 'ambiguous';
  confidence: number;
  reason: string;
  toolNames: string[];
  isFallback: boolean;
}

interface IntentRule {
  intent: CopilotIntent;
  patterns: RegExp[];
  tools: string[];
}

/**
 * Nombre minimal de signaux avant d'oser restreindre. En dessous, on envoie
 * tous les outils du mode : un faux positif coûte une réponse fausse, un
 * élargissement inutile ne coûte que des tokens.
 */
const MIN_SCORE_TO_RESTRICT = 2;

/**
 * Outils joints à TOUTE sélection. Ils portent le contexte minimal dont une
 * réponse a besoin quelle que soit l'intention, et les actions de pilotage —
 * sans lesquelles le chat ne peut plus ouvrir une page ni lancer une étape.
 */
const CORE_TOOLS: readonly string[] = [
  'get_parcel_summary',
  'get_contexte_commune',
];

const RULES: IntentRule[] = [
  {
    intent: 'parcel_analysis',
    patterns: [
      /etude complete/, /analyse (?:complete|globale|de la parcelle)/, /parcelle/,
      /terrain/, /adresse/, /cadastr/, /fiche (?:terrain|parcelle)/,
    ],
    tools: [
      'get_etude_parcelle', 'get_parcel_summary', 'get_parcel_plu', 'get_zonage_plu',
      'get_prescriptions_urbanisme', 'get_servitudes', 'get_risks_georisques', 'get_ppr_detail',
      'get_altimetrie', 'get_assainissement', 'get_classement_sonore', 'get_potentiel_solaire',
      'get_monuments_historiques', 'get_batiment_bdnb', 'get_dvf_comparables', 'get_taxes_locales',
      // Savoir à qui appartient un terrain fait partie de son analyse : sans
      // cela, « analyse cette parcelle » écartait l'outil propriétaire, qui
      // n'était joignable que par l'intention rentabilité locative — un
      // classement sans rapport avec ce que l'outil fait.
      'get_proprietaire_parcelle',
    ],
  },
  {
    intent: 'plu_feasibility',
    patterns: [
      /\bplu\b/, /\bpos\b/, /\bplui\b/, /urbanis/, /constructib/, /faisabilit/, /zonage/,
      /servitude/, /prescription/, /permis/, /\bdp\b/, /declaration prealable/, /emprise/,
      /hauteur/, /gabarit/, /\bces\b/, /\bcos\b/, /recul/, /prospect/, /\boap\b/,
      /capacite constructible/, /massing/, /volumetri/, /programmation/,
    ],
    tools: [
      'get_parcel_summary', 'get_parcel_plu', 'get_zonage_plu', 'get_prescriptions_urbanisme',
      'get_servitudes', 'get_altimetrie', 'get_monuments_historiques', 'get_sitadel',
      'get_logement_social', 'get_couts_construction', 'get_bilan_promoteur',
    ],
  },
  {
    intent: 'risks',
    patterns: [
      /risque/, /georisque/, /inond/, /radon/, /argile/, /retrait.gonflement/, /sism/,
      /pollu/, /\bppr\b/, /\bppri\b/, /\bpprt\b/, /bruit/, /sonore/, /assainissement/,
      /cavite/, /minier/, /submersion/, /\bicpe\b/, /seveso/,
    ],
    tools: [
      'get_risks_georisques', 'get_ppr_detail', 'get_classement_sonore', 'get_assainissement',
      'get_batiment_bdnb', 'get_servitudes', 'get_altimetrie',
    ],
  },
  {
    intent: 'valuation_dvf',
    patterns: [
      /estim(?:e|er|ation)/, /valoris/, /valeur/, /prix au m/, /prix du m/, /prix de vente/,
      /comparable/, /\bdvf\b/, /smartscore/, /decote/, /surcote/, /combien vaut/,
      /mutation/, /transaction/,
    ],
    tools: [
      'get_dvf_comparables', 'compute_smartscore', 'get_quick_market_insight',
      'get_batiment_bdnb', 'get_contexte_commune', 'get_etude_marche', 'get_loyers_reference',
    ],
  },
  {
    intent: 'market',
    patterns: [
      /etude de marche/, /marche immobilier/, /tendance/, /demande locale/, /offre locale/,
      /sitadel/, /logement social/, /\bsru\b/, /vacance/, /population/, /demograph/,
      /absorption/, /concurrence/, /programme neuf/, /stock/,
    ],
    tools: [
      'get_etude_marche', 'get_quick_market_insight', 'get_dvf_comparables', 'get_sitadel',
      'get_logement_social', 'get_contexte_commune', 'get_zonage_abc', 'get_loyers_reference',
      'get_equipements_proches', 'get_veille_marche',
    ],
  },
  {
    intent: 'building_renovation',
    patterns: [
      /\bdpe\b/, /energie/, /energet/, /passoire/, /renovation/, /rehabilitation/, /travaux/,
      /batiment/, /construction/, /\bcout/, /chiffrage/, /devis/, /budget/, /solaire/,
      /photovolta/, /patrimoine/, /monument/, /\babf\b/, /isolation/, /chauffage/,
    ],
    tools: [
      'get_dpe_ademe', 'get_batiment_bdnb', 'get_couts_renovation', 'get_couts_construction',
      'get_potentiel_solaire', 'get_monuments_historiques', 'get_altimetrie',
    ],
  },
  {
    intent: 'rental_profitability',
    patterns: [
      /loyer/, /locati/, /rentabilit/, /rendement/, /cash.?flow/, /\btri\b/, /\btir\b/,
      /financ/, /emprunt/, /mensualite/, /zonage abc/, /fiscal/, /impot/, /taxe/,
      /marge/, /bilan/, /charge fonciere/, /plus.?value/, /\blmnp\b/, /pinel/, /deficit foncier/,
      // Dispositifs de défiscalisation. « pinel » figure volontairement ici bien
      // que le dispositif soit clos : la question se pose encore, et mieux vaut
      // router vers l'outil qui répond « c'est fermé » que laisser le modèle
      // improviser avec des barèmes de 2024.
      /defiscalis/, /jeanbrun/, /denormandie/, /loc.?avantages/, /amortissement/,
      /bailleur prive/, /plafond de (loyer|ressource)/, /conventionnement/, /\banah\b/,
      /censi.?bouvard/, /malraux/, /scellier/, /duflot/, /\bcosse\b/,
      // Identification du détenteur d'un foncier. Router vers l'outil est
      // important même quand la réponse sera « on ne peut pas » : sans lui, le
      // modèle improviserait des pistes qui n'existent pas légalement.
      /proprietaire/, /a qui appartient/, /qui detient/, /qui possede/,
      /\bsci\b/, /fonciere/, /\bsiren\b/, /releve de propriete/, /matrice cadastrale/,
    ],
    tools: [
      'get_loyers_reference', 'get_zonage_abc', 'get_taxes_locales', 'get_dvf_comparables',
      'get_quick_market_insight', 'get_couts_renovation', 'get_couts_construction',
      'get_etude_marche', 'get_bilan_promoteur', 'get_analyse_predictive',
      'get_dispositif_fiscal', 'get_proprietaire_parcelle',
    ],
  },
  {
    intent: 'local_context',
    patterns: [
      /equipement/, /ecole/, /college/, /lycee/, /creche/, /commerce/, /service/, /transport/,
      /gare/, /metro/, /tramway/, /etablissement/, /quartier/, /commune/, /contexte local/,
      /proximite/, /alentour/, /autour/, /a proximite/, /rayon/, /environnement/, /sante/,
      /medecin/, /pharmacie/, /supermarche/,
    ],
    tools: [
      'get_contexte_commune', 'get_equipements_proches', 'get_etablissements_proches',
      'get_logement_social', 'get_sitadel', 'get_contacts_mairies', 'get_etude_marche',
    ],
  },
  {
    // Nouvelle règle : les contacts institutionnels n'étaient couverts par
    // aucune intention, alors que la page Contacts mairie existe depuis
    // longtemps. « Qui contacter en mairie ? » tombait sur plu_feasibility.
    intent: 'contacts_institutions',
    patterns: [
      /mairie/, /\bmaire\b/, /\bmaires\b/, /\belu\b/, /\belus\b/, /contact/, /interlocuteur/,
      /coordonnee/, /telephone/, /\bmail\b/, /courriel/, /adjoint/, /service technique/,
      /service urbanisme/, /qui contacter/, /a qui s.adresser/,
    ],
    tools: [
      'get_contacts_mairies', 'get_contexte_commune', 'get_etablissements_proches',
      'get_logement_social',
    ],
  },
  {
    intent: 'tenders',
    patterns: [
      /appel.? d.?offre/, /\bboamp\b/, /marche public/, /consultation publique/, /\bdce\b/,
      /veille appel/, /avis de marche/, /modifi/, /renomm/, /ajoute.*departement/, /supprim/, /desactiv/,
    ],
    tools: [
      'get_appels_offres', 'creer_veille_appels_offres', 'lister_veilles_appels_offres',
      'lister_nouveautes_appels_offres', 'marquer_nouveautes_lues',
      'desactiver_veille_appels_offres', 'modifier_veille_appels_offres',
    ],
  },
  {
    intent: 'watch_search',
    patterns: [
      /recherche.*bien/, /trouve.*bien/, /annonce/, /opportunit/, /watchlist/, /zone de veille/,
      /surveille/, /veille immobiliere/, /alerte/,
    ],
    tools: [
      'recherche_biens', 'get_quick_market_insight', 'creer_zone_veille', 'lister_zones_veille',
      'desactiver_zone_veille', 'creer_watchlist', 'lister_watchlists', 'desactiver_watchlist',
      'get_veille_marche',
    ],
  },
  {
    // Patterns resserrés : `/page/` et `/onglet/` nus matchaient n'importe
    // quelle phrase contenant ces mots et parasitaient le classement des
    // autres règles. On exige maintenant un verbe de navigation.
    intent: 'navigation_actions',
    patterns: [
      /^\s*(?:ouvre|ouvrir|affiche|affiches|va sur|navigue|montre|amene.moi)/,
      /cree (?:une )?operation/,
      /lance (?:l ?etape|l'etape)/,
      /(?:ouvre|ouvrir|affiche|va sur|montre)[^.]{0,40}(?:page|onglet|ecran)/,
    ],
    tools: [],
  },
];

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Choisit un sous-ensemble conservateur d'outils, sans appel au modèle.
 * Retourne toujours au minimum le socle et les actions.
 */
export function selectToolNames(message: string, availableNames: readonly string[]): ToolSelection {
  const available = [...new Set(availableNames)];
  const actions = available.filter((name) => name.startsWith('action_'));
  const text = ` ${normalize(message)} `;

  const ranked = RULES
    .map((rule) => ({
      rule,
      score: rule.patterns.reduce((n, pattern) => n + (pattern.test(text) ? 1 : 0), 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return {
      intent: 'ambiguous', confidence: 0,
      reason: 'Aucune intention detectee; conservation de tous les outils disponibles.',
      toolNames: available, isFallback: true,
    };
  }

  const winner = ranked[0];
  const runnerUp = ranked[1]?.score ?? 0;
  const margin = winner.score - runnerUp;

  // Signal trop faible ou ex aequo : on ne restreint pas. Mieux vaut payer
  // quelques milliers de tokens que priver le modèle du bon outil.
  if (winner.score < MIN_SCORE_TO_RESTRICT || margin === 0) {
    return {
      intent: 'ambiguous', confidence: 0,
      reason: winner.score < MIN_SCORE_TO_RESTRICT
        ? `Signal trop faible (${winner.score}); conservation de tous les outils disponibles.`
        : 'Aucune intention dominante; conservation de tous les outils disponibles.',
      toolNames: available, isFallback: true,
    };
  }

  const selected = new Set([...winner.rule.tools, ...CORE_TOOLS, ...actions]);
  const toolNames = available.filter((name) => selected.has(name));

  if (toolNames.length === 0) {
    return {
      intent: 'ambiguous', confidence: 0,
      reason: 'Aucun outil compatible avec le mode; conservation de tous les outils disponibles.',
      toolNames: available, isFallback: true,
    };
  }

  return {
    intent: winner.rule.intent,
    confidence: Number(Math.min(0.98, 0.58 + winner.score * 0.1 + margin * 0.08).toFixed(2)),
    reason: `Intention ${winner.rule.intent} detectee par ${winner.score} signal(aux).`,
    toolNames,
    isFallback: false,
  };
}
