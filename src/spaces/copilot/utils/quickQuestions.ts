// src/spaces/copilot/utils/quickQuestions.ts
// ─────────────────────────────────────────────────────────────────────────────
// Questions rapides dynamiques selon la route, le tab (query param) et le mode.
//
// ⚠️  Les tabs de /marchand-de-bien/analyse sont des query params ?tab=xxx.
//     CopilotEmptyState construit un "pathname virtuel" :
//       /marchand-de-bien/analyse?tab=rentabilite
//       → effectivePathname = /marchand-de-bien/analyse/rentabilite
//
// ─────────────────────────────────────────────────────────────────────────────
// RÉVISION AUDIT — alignement question ↔ capacité réelle du Copilot
//   • Questions visuelles (massing 3D, façades, implantation) reformulées vers
//     les règles PLU réellement sourçables : le Copilot ne voit ni le rendu 3D,
//     ni le plan masse, ni la façade. Il ne se prononce donc plus dessus.
//   • Questions fiscalité / TRI / projection pluriannuelle / sensibilité
//     retirées : aucun moteur ni source ne les alimente (réponse non sourcée).
//   • Questions promettant risques/DVF/SmartScore retirées du mode "quick"
//     (ces tools n'existent qu'en mode "advanced") et déplacées en "advanced".
//   • bilan / analyse-plan : questions conservées — alimentées par le contexte
//     injecté côté page (cf. câblage BilanPage / AnalysePlanPage).
// ─────────────────────────────────────────────────────────────────────────────

export interface QuickQuestion {
  label: string;
  prompt: string;
}

export interface QuickQuestionsContext {
  pathname: string;
  mode?: 'quick' | 'advanced';
  activeDeal?: {
    id?: string;
    title?: string;
    address?: string;
    surface?: number | null;
    purchasePrice?: number | null;
    resalePrice?: number | null;
    worksBudget?: number | null;
    status?: string;
  } | null;
}

interface RouteQuestions {
  prefix: string;
  quick: QuickQuestion[];
  advanced: QuickQuestion[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Banque de questions — routes réelles de l'app
// (préfixe le plus long gagne — trier du plus spécifique au plus générique)
// ─────────────────────────────────────────────────────────────────────────────

const ROUTE_QUESTIONS: RouteQuestions[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // MARCHAND DE BIEN — /marchand-de-bien/analyse + tabs (pathname virtuel)
  // ══════════════════════════════════════════════════════════════════════════

  {
    prefix: '/marchand-de-bien/analyse/rentabilite',
    quick: [
      { label: '📊 Rentabilité brute',                  prompt: "Quelle est la rentabilité brute de ce bien ? Calcule rapidement avec le prix d'achat et le prix de revente." },
      { label: '🔄 Revente ou location ?',              prompt: "Ce bien est-il plus adapté à la revente ou à la location ? Donne un avis basé sur les données disponibles." },
      { label: '💶 Loyer de marché estimé',             prompt: "Quel loyer mensuel de marché peut-on espérer pour ce bien selon les données locales ? Donne une fourchette réaliste et le rendement brut associé." },
    ],
    advanced: [
      { label: '🔬 Rentabilité nette détaillée',        prompt: "Détaille la rentabilité nette à partir du rendement et de la marge calculés par Mimmoza : brut → net après charges et travaux. Appuie-toi uniquement sur les données disponibles." },
      { label: '📊 Rendement vs marché local',          prompt: "Compare le rendement de ce bien aux niveaux observés sur le marché local. Le positionnement est-il favorable ?" },
      { label: '📈 Prix de revente cible et marge',     prompt: "Quel prix de revente cible ressort de l'analyse Mimmoza et quelle marge brute y est associée ?" },
    ],
  },

  {
    prefix: '/marchand-de-bien/analyse/due_diligence',
    quick: [
      { label: '📁 Documents critiques manquants',      prompt: "Quels documents critiques sont manquants dans cette due diligence ? Liste-les par priorité." },
      { label: '🚨 Points de vigilance bloquants',      prompt: "Y a-t-il des points de vigilance bloquants qui empêchent de sécuriser l'achat en l'état ?" },
      { label: '✅ Due diligence suffisante ?',          prompt: "La due diligence actuelle est-elle suffisante pour sécuriser l'achat ? Donne un verdict rapide." },
    ],
    advanced: [
      { label: '📋 Synthèse complète avec criticité',   prompt: "Synthèse complète de la due diligence : points vérifiés, manquants et risques classifiés par criticité (bloquant / important / mineur)." },
      { label: '⚖️ Risques juridiques et admin',        prompt: "Quels risques juridiques ou administratifs identifier sur ce bien ? (servitudes, PLU, recours, copropriété, urbanisme)" },
      { label: '🔧 Actions avant signature',            prompt: "Quelles actions correctives dois-je exiger ou réaliser avant la signature pour sécuriser l'acquisition ?" },
    ],
  },

  {
    prefix: '/marchand-de-bien/analyse/marche_risques',
    quick: [
      { label: '📈 Marché porteur dans cette zone ?',   prompt: "Le marché immobilier est-il porteur dans cette zone ? Tendance des prix et niveau de la demande." },
      { label: '⚠️ Zone à risque naturel ?',            prompt: "Ce bien est-il dans une zone à risque naturel ou technologique ? Résume les principaux risques." },
      { label: '🏘️ Tension locative ici',               prompt: "La tension locative est-elle forte dans cette zone ? Facilité de revente et niveau des prix." },
    ],
    advanced: [
      { label: '📊 Analyse marché complète',            prompt: "Analyse complète du marché local : offre, demande, tendance des prix sur 3 ans et comparaison avec marchés voisins." },
      { label: '🗺️ Rapport Géorisques détaillé',        prompt: "Rapport Géorisques détaillé : inondation, sismique, retrait-gonflement argiles, mouvement de terrain. Niveau de risque et conseils." },
      { label: '📈 DVF : ce bien vs ventes récentes',   prompt: "Compare ce bien aux ventes DVF récentes dans la zone : prix médian au m², distribution et positionnement." },
    ],
  },

  {
    prefix: '/marchand-de-bien/analyse/analyse_predictive',
    quick: [
      { label: '📈 Tendance des prix ici',              prompt: "La tendance des prix est-elle à la hausse ou à la baisse dans cette zone ? Appuie-toi sur l'évolution des prix et les scores marché disponibles." },
      { label: '🏙️ Zone en tension ou en déclin ?',     prompt: "Ce bien est-il dans une zone en tension (demande > offre) ou en déclin démographique ? Base-toi sur les indicateurs disponibles." },
    ],
    advanced: [
      { label: '🚦 Indicateurs prédictifs au vert/rouge', prompt: "Quels indicateurs prédictifs Mimmoza (évolution des prix, scores marché, démographie, Sitadel, pression crédit BCE) sont favorables ou défavorables sur ce deal ? Synthétise sans extrapoler au-delà des données." },
      { label: '🔢 Lecture croisée prix + marge',        prompt: "Croise l'évolution des prix et la marge calculée par Mimmoza : que disent les données sur l'intérêt de l'opération ?" },
    ],
  },

  {
    prefix: '/marchand-de-bien/analyse/synthese_ia',
    quick: [
      { label: '⚡ Résumé en 3 points clés',            prompt: "Résume cette opération en 3 points : forces principales, faiblesses à surveiller, verdict." },
      { label: '✅ Recommandes-tu cette opération ?',    prompt: "Recommandes-tu cette opération ? Donne un verdict clair avec les 2-3 raisons principales." },
    ],
    advanced: [
      { label: '📄 Synthèse IA complète',               prompt: "Synthèse IA complète : marché local, rentabilité détaillée, risques identifiés, forces/faiblesses et recommandation finale." },
      { label: '📋 Note pour un comité',                prompt: "Prépare une note d'investissement structurée pour un comité : contexte, analyse financière, risques, recommandation et conditions de succès." },
    ],
  },

  // Fallback /analyse sans tab reconnu
  {
    prefix: '/marchand-de-bien/analyse',
    quick: [
      { label: '📊 Rentabilité brute',                  prompt: "Quelle est la rentabilité brute de cette opération ?" },
      { label: '⚠️ Risques principaux',                 prompt: "Quels sont les risques principaux sur ce bien ?" },
      { label: '🔄 Revente ou location ?',              prompt: "Ce bien est-il plus adapté à la revente ou à la location ?" },
    ],
    advanced: [
      { label: '🔬 Rentabilité nette détaillée',        prompt: "Détaille la rentabilité nette à partir des données Mimmoza (rendement, marge, cash-flow)." },
      { label: '📊 Analyse marché + Géorisques',        prompt: "Analyse marché complète et rapport Géorisques pour ce bien." },
      { label: '📄 Synthèse IA complète',               prompt: "Synthèse IA complète : marché, rentabilité, risques et recommandation." },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // MARCHAND DE BIEN — Acquisition / Pipeline
  // ══════════════════════════════════════════════════════════════════════════

  {
    prefix: '/marchand-de-bien/acquisition/pipeline',
    quick: [
      { label: '🔍 Analyse ce deal',                    prompt: "Analyse ce deal : situation du marché local, potentiel de revente et risques principaux." },
      { label: '💶 Prix d\'achat maximal',               prompt: "Calcule le prix d'achat maximal pour atteindre une marge nette de 15%." },
      { label: '⚠️ Risques sur ce bien',                 prompt: "Quels sont les principaux risques sur ce bien ? (juridiques, travaux, marché)" },
      { label: '💧 Le marché est-il liquide ici ?',      prompt: "Le marché est-il liquide dans cette zone ? Facilité de revente et délai moyen." },
    ],
    advanced: [
      { label: '📊 Analyse complète du deal',            prompt: "Analyse complète : marché local, décote estimée, potentiel de revente, risques et verdict." },
      { label: '📈 Compare aux ventes DVF récentes',     prompt: "Compare ce bien aux ventes DVF récentes dans un rayon de 500m. Décote et positionnement." },
      { label: '💶 Prix maximal avec marge 15% nette',   prompt: "Quel prix d'achat maximal pour une marge nette de 15% après travaux ? Détaille le calcul à partir des données disponibles." },
      { label: '📋 Fiche deal complète',                 prompt: "Prépare une fiche deal complète : bien, marché, financier (achat/travaux/revente/marge), risques et recommandation." },
    ],
  },

  {
    prefix: '/marchand-de-bien/acquisition',
    quick: [
      { label: '🔍 Analyse ce deal',                    prompt: "Analyse ce deal : potentiel, risques et rentabilité estimée." },
      { label: '💶 Prix d\'achat maximal',               prompt: "Quel est le prix d'achat maximal pour une marge de 15% ?" },
      { label: '⚠️ Risques principaux',                  prompt: "Quels risques dois-je anticiper sur ce bien ?" },
    ],
    advanced: [
      { label: '📊 Analyse complète + DVF',              prompt: "Analyse complète : marché, décote DVF, risques, marge cible et recommandation." },
      { label: '📋 Fiche deal',                          prompt: "Prépare une fiche deal complète avec tous les éléments financiers et risques." },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // MARCHAND DE BIEN — Execution
  // ══════════════════════════════════════════════════════════════════════════

  {
    prefix: '/marchand-de-bien/execution/simulation',
    quick: [
      { label: '🏗️ Budget travaux estimé',               prompt: "Estime le budget travaux global pour ce bien en fonction de sa surface et de son état." },
      { label: '📦 Travaux par lots',                    prompt: "Décompose les travaux par lots (gros œuvre, second œuvre, finitions, équipements) avec fourchettes budgétaires." },
      { label: '📉 Impact sur la marge',                 prompt: "Quel est l'impact du budget travaux actuel sur la marge finale ?" },
      { label: '⚠️ Postes à risque',                     prompt: "Quels postes de travaux sont les plus risqués en termes de dépassement de budget ?" },
    ],
    advanced: [
      { label: '🔢 3 scénarios + impact marge',           prompt: "Simule 3 scénarios travaux (léger / standard / complet) : budget, délai estimé et impact sur la marge nette." },
      { label: '📋 Synthèse travaux complète',            prompt: "Prépare une synthèse complète : budget par poste, planning, marge résiduelle et recommandation de scénario." },
      { label: '💸 Optimisation marge/travaux',           prompt: "Quelle combinaison travaux/prix de revente maximise la marge nette sur cette opération ?" },
    ],
  },

  {
    prefix: '/marchand-de-bien/execution/travaux',
    quick: [
      { label: '📊 Suivi budget travaux',                prompt: "Donne un suivi du budget travaux : engagé vs prévu vs restant." },
      { label: '🚨 Postes en dépassement',               prompt: "Détecte les postes en dépassement de budget et propose des actions correctives." },
      { label: '📅 Risque planning',                     prompt: "Quel est le risque de glissement du planning et son impact sur le coût de portage ?" },
    ],
    advanced: [
      { label: '📋 Suivi complet + alertes',              prompt: "Suivi complet : budget prévu vs engagé, postes critiques avec alertes et recommandations." },
      { label: '💸 Impact dépassement 20%',               prompt: "Quel serait l'impact d'un dépassement de 20% du budget travaux sur la marge finale ?" },
    ],
  },

  {
    prefix: '/marchand-de-bien/execution',
    quick: [
      { label: '🏗️ Budget travaux estimé',               prompt: "Estime le budget travaux pour ce bien." },
      { label: '📉 Impact sur la marge',                 prompt: "Quel est l'impact des coûts actuels sur la marge finale ?" },
    ],
    advanced: [
      { label: '📋 Synthèse exécution',                  prompt: "Synthèse complète de l'exécution : budget, planning, marge résiduelle et risques." },
    ],
  },

  // Fallback racine marchand
  {
    prefix: '/marchand-de-bien',
    quick: [
      { label: '🔍 Analyse ce deal',                    prompt: "Analyse ce deal : potentiel, risques et rentabilité estimée." },
      { label: '💶 Marge estimée',                      prompt: "Quelle marge peut-on espérer sur cette opération ?" },
      { label: '⚠️ Risques principaux',                  prompt: "Quels sont les risques principaux sur ce bien ?" },
    ],
    advanced: [
      { label: '📊 Analyse complète',                   prompt: "Analyse complète : marché, travaux, marge et recommandation." },
      { label: '📋 Fiche deal',                         prompt: "Prépare une fiche deal complète avec tous les éléments financiers et risques." },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PROMOTEUR
  // ══════════════════════════════════════════════════════════════════════════

  {
    prefix: '/promoteur/nouvelle-opportunite',
    quick: [
      { label: '🔍 Ce terrain vaut-il une étude ?',     prompt: "Ce terrain vaut-il la peine d'être étudié ? Donne un premier avis rapide sur le potentiel." },
      { label: '📋 Quels critères regarder en premier ?', prompt: "Quels sont les critères prioritaires à vérifier en premier sur cette opportunité foncière ?" },
    ],
    advanced: [
      { label: '📊 Analyse complète de l\'opportunité', prompt: "Analyse complète de cette opportunité foncière : potentiel constructif, marché local, risques et verdict go/no-go." },
      { label: '🚨 Red flags à vérifier',               prompt: "Quels sont les red flags à vérifier avant de lancer une étude complète sur cette opportunité ?" },
    ],
  },

  {
    prefix: '/promoteur/foncier',
    quick: [
      { label: '🗺️ Quelle est la zone PLU ?',           prompt: "Quelle est la zone PLU applicable sur cette parcelle et quelles sont les grandes règles associées ?" },
      { label: '📐 Reculs obligatoires',                prompt: "Quels sont les reculs obligatoires sur cette parcelle (prospect, limite séparative, voie) ?" },
      { label: '📏 Hauteur maximale autorisée',         prompt: "Quelle est la hauteur maximale autorisée sur cette parcelle selon le PLU ?" },
      { label: '🚗 Places de parking requises',         prompt: "Combien de places de parking par logement sont exigées par le PLU pour ce programme ?" },
    ],
    advanced: [
      { label: '📋 Analyse PLU complète',               prompt: "Analyse complète des règles PLU applicables : zone, COS/CES, hauteur, reculs, stationnement, OAP et servitudes. Conclus sur la constructibilité." },
      { label: '🏗️ Constructibilité maximale théorique', prompt: "Calcule la constructibilité maximale théorique sur cette parcelle selon les règles PLU (SDP max, emprise, hauteur)." },
      { label: '📏 OAP — contraintes spécifiques',      prompt: "Y a-t-il une OAP applicable ? Quelles contraintes spécifiques impose-t-elle sur l'aménagement ou le programme ?" },
      { label: '✅ Conformité programme / PLU',          prompt: "Compare les règles PLU avec le programme envisagé — est-il conforme ? Quels ajustements sont nécessaires ?" },
    ],
  },

  {
    prefix: '/promoteur/risques',
    quick: [
      { label: '🚨 Risques bloquants sur cette parcelle ?', prompt: "Y a-t-il des risques bloquants sur cette parcelle ? Résume les points d'alerte principaux." },
      { label: '🌊 Zone inondable ou risque naturel ?', prompt: "Ce terrain est-il en zone inondable, sismique ou soumis à un autre risque naturel majeur ?" },
      { label: '⚖️ Servitudes ou contraintes cachées ?', prompt: "Y a-t-il des servitudes d'utilité publique ou des contraintes cachées à anticiper sur ce terrain ?" },
    ],
    advanced: [
      { label: '🗺️ Rapport Géorisques complet',         prompt: "Rapport Géorisques complet : inondation, sismique, retrait-gonflement des argiles, pollution des sols, risques technologiques. Niveau de risque et impact sur le projet." },
      { label: '⚖️ Servitudes d\'utilité publique',      prompt: "Quelles servitudes d'utilité publique affectent cette parcelle et quel est leur impact sur le projet ?" },
      { label: '✅ Go / No-go sur les risques',          prompt: "Ces risques sont-ils rédhibitoires ou gérables ? Donne une recommandation go/no-go motivée avec les conditions de levée des risques." },
    ],
  },

  {
    prefix: '/promoteur/programmation',
    quick: [
      { label: '✅ Programme cohérent avec le PLU ?',   prompt: "Ce programme est-il cohérent avec les règles PLU ? Y a-t-il des points de non-conformité ?" },
      { label: '🏘️ Nombre de logements réaliste ?',     prompt: "Le nombre de logements envisagé est-il réaliste sur cette emprise et selon les règles PLU ?" },
      { label: '🏠 Quelle typologie privilégier ?',      prompt: "Quel mix typologique (T2/T3/T4) privilégier pour ce secteur et ce type d'acquéreurs ?" },
    ],
    advanced: [
      { label: '🎯 Optimise le mix typologique',         prompt: "Optimise le mix typologique pour maximiser la marge sur ce programme en tenant compte du marché local et des règles PLU." },
      { label: '📐 SDP max réglementaire',              prompt: "Calcule la surface de plancher maximale réglementaire (SDP max) sur cette parcelle avec les hypothèses de programme actuelles." },
      { label: '📊 Benchmark marché local',             prompt: "Compare ce programme à ce qui se vend bien dans ce marché local. Le mix est-il adapté à la demande ?" },
      { label: '🏗️ Densité max sans dépasser le PLU',   prompt: "Quelle densité et quelle emprise au sol maximiser sans dépasser les règles PLU ? Donne les valeurs limites." },
    ],
  },

  {
    prefix: '/promoteur/implantation-2d',
    quick: [
      { label: '📐 Reculs imposés par le PLU',          prompt: "Quels reculs le PLU impose-t-il sur cette parcelle (voirie, limites séparatives, fond de parcelle) ?" },
      { label: '📏 Emprise au sol maximale',            prompt: "Quelle emprise au sol maximale le PLU autorise-t-il sur cette parcelle ?" },
      { label: '📐 Hauteur et prospect',                prompt: "Quelles règles de hauteur et de prospect s'appliquent à l'implantation selon le PLU ?" },
    ],
    advanced: [
      { label: '📋 Contraintes PLU pour l\'implantation', prompt: "Synthétise toutes les contraintes PLU qui encadrent l'implantation : reculs, emprise, hauteur, prospect, stationnement." },
      { label: '📐 SDP maximale réglementaire',         prompt: "Calcule la SDP maximale réglementaire à partir des règles PLU (emprise, hauteur, gabarit)." },
      { label: '🏗️ Marges pour densifier',              prompt: "Selon les règles PLU, quelles marges de manœuvre existent pour maximiser la SDP constructible sur cette parcelle ?" },
    ],
  },

  {
    prefix: '/promoteur/massing-3d',
    quick: [
      { label: '📏 Hauteur max autorisée',              prompt: "Quelle hauteur maximale le PLU autorise-t-il sur cette parcelle (égout / faîtage) ?" },
      { label: '📐 Règles de gabarit PLU',              prompt: "Quelles règles de gabarit et de prospect le PLU impose-t-il pour le volume bâti ?" },
      { label: '🏗️ Combien de niveaux possibles ?',      prompt: "Combien de niveaux sont envisageables selon la hauteur maximale autorisée par le PLU ?" },
    ],
    advanced: [
      { label: '📊 Enveloppe constructible PLU',         prompt: "Décris l'enveloppe constructible maximale autorisée par le PLU (emprise × hauteur) et le volume théorique associé." },
      { label: '🏗️ Optimiser la SDP dans le gabarit',   prompt: "Comment maximiser la SDP en restant dans le gabarit PLU autorisé sur cette parcelle ?" },
      { label: '⚖️ Contraintes de hauteur et servitudes', prompt: "Quelles contraintes de hauteur ou servitudes pourraient limiter le volume constructible sur cette parcelle ?" },
    ],
  },

  {
    prefix: '/promoteur/generateur-facades',
    quick: [
      { label: '🧱 Matériaux courants du secteur',       prompt: "À titre indicatif, quels matériaux de façade sont couramment utilisés et bien perçus pour ce type de programme et de secteur ?" },
      { label: '📋 Règles de façade à vérifier',        prompt: "Quelles règles d'aspect extérieur (PLU, ABF/AVAP) faut-il vérifier avant d'arrêter le traitement de façade ?" },
    ],
    advanced: [
      { label: '🎯 Critères d\'attractivité façade',     prompt: "En conseil général, quels critères de façade influencent l'attractivité commerciale d'un programme neuf auprès des acquéreurs cibles ?" },
      { label: '💸 Leviers de coût façade',             prompt: "En conseil général, quels leviers permettent de réduire le coût d'une façade sans dégrader la qualité perçue ?" },
    ],
  },

  {
    prefix: '/promoteur/simulation-travaux',
    quick: [
      { label: '💰 Budget au m² dans la moyenne ?',      prompt: "Le budget travaux au m² est-il dans la moyenne du marché pour ce type de programme et cette région ?" },
      { label: '📦 Postes qui pèsent le plus',          prompt: "Quels postes de construction pèsent le plus sur le coût total et méritent une attention particulière ?" },
      { label: '📊 Compatible avec la marge cible ?',   prompt: "Ce budget travaux est-il compatible avec la marge promoteur cible ? Donne un verdict rapide." },
    ],
    advanced: [
      { label: '📋 Analyse complète par corps d\'état',  prompt: "Analyse complète du budget travaux par corps d'état avec benchmarks marché. Quels postes sont sur-estimés ou sous-estimés ?" },
      { label: '🔢 3 scénarios construction + marge',   prompt: "Simule 3 scénarios de construction (économique / standard / premium) avec pour chacun le coût au m² SDP et l'impact sur le taux de marge." },
      { label: '🎯 Optimisation pour la marge cible',   prompt: "Quels postes optimiser en priorité pour tenir l'objectif de marge promoteur sans dégrader la qualité livrable ?" },
      { label: '💶 Coût compatible avec la marge',      prompt: "À titre indicatif, quel niveau de coût de construction au m² SDP resterait compatible avec une marge promoteur saine ?" },
    ],
  },

  {
    prefix: '/promoteur/marche',
    quick: [
      { label: '💶 Prix de vente au m² du secteur',     prompt: "Quel est le prix de vente au m² constaté dans ce secteur pour ce type de programme neuf ?" },
      { label: '📈 Demande forte pour ce programme ?',  prompt: "La demande est-elle forte pour ce type de programme dans ce secteur ? Donne un signal marché rapide." },
      { label: '📅 Délais de commercialisation',        prompt: "Quels sont les délais de commercialisation habituels pour un programme neuf dans ce marché ?" },
    ],
    advanced: [
      { label: '📊 Analyse DVF complète',               prompt: "Analyse DVF complète : prix médian au m², tendance sur 3 ans, volume de transactions, comparaison neuf/ancien dans ce secteur." },
      { label: '🏘️ Logements sociaux exigés ?',          prompt: "Quelle part de logements sociaux sera exigée par la commune pour ce programme ? Quel impact sur le bilan ?" },
      { label: '🏗️ Concurrence promoteurs actifs',      prompt: "Quels promoteurs concurrents sont actifs dans ce secteur ? Quels programmes sont en cours et à quels prix ?" },
      { label: '💶 Prix de sortie défendable',          prompt: "Quel prix de sortie au m² est réaliste et défendable auprès d'investisseurs ou d'acquéreurs institutionnels dans ce marché ?" },
    ],
  },

  {
    prefix: '/promoteur/bilan-promoteur',
    quick: [
      { label: '📊 Taux de marge suffisant ?',          prompt: "À partir du bilan, le taux de marge promoteur est-il suffisant pour valider l'opération ? Donne un verdict rapide." },
      { label: '💶 Prix foncier maximal acceptable',    prompt: "À partir du bilan, quel est le prix foncier maximal acceptable pour maintenir la marge promoteur cible ?" },
      { label: '🏦 Bilan bancable en l\'état ?',         prompt: "Ce bilan promoteur est-il bancable en l'état ? Y a-t-il des points bloquants pour un financement ?" },
    ],
    advanced: [
      { label: '🔬 Analyse bilan complète',             prompt: "Analyse complète du bilan promoteur : CA, coûts détaillés, marge brute, marge nette et comparaison aux standards du marché." },
      { label: '💶 Prix foncier max pour la marge cible', prompt: "À partir des données du bilan, quel prix foncier maximal permet de tenir la marge promoteur cible ?" },
      { label: '📊 Benchmark standards marché',         prompt: "Compare ce bilan aux standards du marché promoteur dans ce secteur. Marge, coûts et prix sont-ils dans les normes ?" },
    ],
  },

  {
    prefix: '/promoteur/bilan',
    quick: [
      { label: '📊 Taux de marge suffisant ?',          prompt: "À partir du bilan, le taux de marge promoteur est-il suffisant pour valider l'opération ?" },
      { label: '💶 Prix foncier maximal acceptable',    prompt: "À partir du bilan, quel est le prix foncier maximal acceptable pour cette opération ?" },
    ],
    advanced: [
      { label: '🔬 Analyse bilan complète',             prompt: "Analyse complète du bilan promoteur : CA, coûts, marge et benchmark marché." },
      { label: '📊 Postes qui pèsent sur la marge',     prompt: "Quels postes du bilan pèsent le plus sur la marge ? Où sont les principaux leviers d'optimisation ?" },
    ],
  },

  {
    prefix: '/promoteur/synthese',
    quick: [
      { label: '✅ Dossier prêt pour le comité ?',      prompt: "Ce dossier est-il prêt pour présentation en comité foncier ? Quels éléments manquent encore ?" },
      { label: '💪 3 points forts à mettre en avant',   prompt: "Quels sont les 3 points forts principaux de ce dossier à défendre en comité ?" },
      { label: '⚠️ Risques résiduels à signaler',       prompt: "Quels risques résiduels doivent être signalés au comité avec les mesures de mitigation associées ?" },
    ],
    advanced: [
      { label: '📋 Note de comité complète',            prompt: "Prépare une note de comité foncier complète : opportunité, marché, programme, bilan financier, risques identifiés et recommandation go/no-go." },
      { label: '🎯 Arguments face à un comité exigeant', prompt: "Quels arguments préparer pour répondre aux questions difficiles d'un comité d'investissement exigeant sur ce dossier ?" },
      { label: '🔀 Synthèse go/no-go structurée',       prompt: "Synthèse go/no-go structurée avec conditions suspensives, prochaines étapes et calendrier cible pour ce dossier." },
    ],
  },

  {
    prefix: '/promoteur/veille',
    quick: [
      { label: '🔍 Opportunités dans cette zone ?',     prompt: "Y a-t-il des opportunités foncières intéressantes dans cette zone de veille ?" },
      { label: '📈 La zone est-elle en développement ?', prompt: "Cette zone est-elle en développement actif ? Y a-t-il des projets d'aménagement en cours ?" },
    ],
    advanced: [
      { label: '📊 Analyse de la zone de veille',       prompt: "Analyse complète de cette zone de veille : dynamique foncière, prix terrain, projets en cours, opportunités à cibler." },
      { label: '🎯 Stratégie d\'approche foncière',      prompt: "Quelle stratégie d'approche recommandes-tu pour prospecter des terrains dans cette zone ?" },
    ],
  },

  {
    prefix: '/promoteur/permis-construire',
    quick: [
      { label: '📋 Dossier PC complet ?',               prompt: "Le dossier de permis de construire est-il complet ? Quelles pièces sont manquantes ?" },
      { label: '⏱️ Délai d\'instruction estimé',        prompt: "Quel est le délai d'instruction du permis de construire estimé pour ce type de programme ?" },
    ],
    advanced: [
      { label: '⚠️ Risques de recours sur ce PC',       prompt: "Quels sont les risques de recours sur ce permis de construire ? Quelles dispositions prendre pour les limiter ?" },
      { label: '📋 Conformité architecturale et PLU',   prompt: "Le projet architectural est-il conforme aux exigences PLU et aux règles de l'AVAP ou de l'ABF si applicable ?" },
    ],
  },

  {
    prefix: '/promoteur/recherche-contacts',
    quick: [
      { label: '👥 Qui contacter en mairie ?',          prompt: "Qui sont les interlocuteurs clés à contacter en mairie pour ce projet (urbanisme, élus, services techniques) ?" },
      { label: '📋 Arguments pour un RDV mairie',       prompt: "Quels arguments préparer pour un premier rendez-vous en mairie sur ce projet ?" },
    ],
    advanced: [
      { label: '🤝 Stratégie de négociation mairie',    prompt: "Quelle stratégie adopter pour négocier les conditions du projet avec la mairie (cessions, logements sociaux, équipements publics) ?" },
      { label: '📋 Prépare un dossier de présentation', prompt: "Prépare un dossier de présentation synthétique du projet pour un premier contact avec les services d'urbanisme." },
    ],
  },

  // Fallback promoteur générique
  {
    prefix: '/promoteur',
    quick: [
      { label: '🔍 Ce terrain vaut-il une étude ?',     prompt: "Ce terrain vaut-il la peine d'être étudié ? Potentiel, risques et premier avis." },
      { label: '🗺️ Quelle est la zone PLU ?',           prompt: "Quelle est la zone PLU applicable et les grandes règles de constructibilité ?" },
      { label: '⚠️ Risques bloquants ?',                 prompt: "Y a-t-il des risques bloquants sur ce projet à identifier en priorité ?" },
    ],
    advanced: [
      { label: '📊 Analyse complète de l\'opportunité', prompt: "Analyse complète de cette opportunité foncière : PLU, constructibilité, marché, bilan et recommandation." },
      { label: '📋 Note de comité',                     prompt: "Prépare une note de comité synthétique pour ce projet promoteur." },
      { label: '💶 Prix foncier maximal',               prompt: "Quel prix foncier maximal pour tenir une marge promoteur saine dans les hypothèses actuelles ?" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // RÉHABILITATION
  // ══════════════════════════════════════════════════════════════════════════

  {
    prefix: '/rehabilitation/projets',
    quick: [
      { label: '🏗️ Ce bâtiment est bon candidat ?',     prompt: "Ce bâtiment est-il un bon candidat à la réhabilitation ? Donne un premier avis sur le potentiel." },
      { label: '📋 Quels critères évaluer en premier ?', prompt: "Quels critères évaluer en priorité pour qualifier ce projet de réhabilitation ?" },
      { label: '🔢 Quel projet prioriser ?',             prompt: "Quel projet de réhabilitation dois-je prioriser dans mon portefeuille actuel et pourquoi ?" },
    ],
    advanced: [
      { label: '📊 Analyse complète du potentiel',       prompt: "Analyse complète du potentiel de ce projet : état du bâti estimé, conformité probable, rentabilité estimée et recommandation." },
      { label: '🔧 Travaux prioritaires pour ce type',   prompt: "Quels types de travaux sont généralement prioritaires pour ce type de bâtiment (époque, structure, pathologies fréquentes) ?" },
      { label: '📈 Compare coût/valorisation projets',   prompt: "Compare les projets actifs : lequel offre le meilleur rapport coût de réhabilitation / valorisation après travaux ?" },
    ],
  },

  {
    prefix: '/rehabilitation/vue-ensemble',
    quick: [
      { label: '✅ Données suffisantes pour l\'audit ?',  prompt: "Les données actuelles de ce projet sont-elles suffisantes pour lancer un audit technique complet ?" },
      { label: '🏛️ Profil et pathologies typiques',      prompt: "Quel est le profil typique de ce type de bâtiment (année de construction, structure, pathologies fréquentes à anticiper) ?" },
      { label: '⚠️ Risques structurels à anticiper',     prompt: "Quels risques structurels dois-je anticiper sur ce bâtiment avant de lancer les travaux ?" },
    ],
    advanced: [
      { label: '📋 Analyse complète du projet',          prompt: "Analyse complète du projet : localisation, type de bâtiment, surface, risques techniques et potentiel de valorisation." },
      { label: '📁 Données manquantes pour l\'audit',    prompt: "Quelles informations manquent pour compléter le dossier d'audit technique ? Liste par ordre de priorité." },
      { label: '💶 Éligibilité aides à la rénovation',   prompt: "Ce projet est-il éligible aux aides à la rénovation (MaPrimeRénov, CEE, Denormandie, ANAH) ? Quels montants potentiels ?" },
    ],
  },

  {
    prefix: '/rehabilitation/conformite',
    quick: [
      { label: '⚖️ Obligations réglementaires prioritaires ?', prompt: "Quelles sont les obligations réglementaires prioritaires pour l'usage envisagé sur ce bâtiment ?" },
      { label: '🚨 Non-conformités bloquantes ?',        prompt: "Y a-t-il des non-conformités bloquantes pour l'usage envisagé ? Liste-les par criticité." },
      { label: '♿ ERP / accessibilité / incendie ?',    prompt: "Quelles normes ERP, accessibilité PMR et sécurité incendie s'appliquent à ce bâtiment selon l'usage choisi ?" },
    ],
    advanced: [
      { label: '📋 Analyse réglementaire complète',      prompt: "Analyse complète des obligations réglementaires selon l'usage : accessibilité PMR, sécurité incendie, normes électriques, DPE et RT2020." },
      { label: '💶 Budget mise en conformité par poste', prompt: "Chiffre le budget de mise en conformité par poste réglementaire (accessibilité, incendie, électricité, ventilation, isolation)." },
      { label: '🔧 Dérogations pour réduire les coûts', prompt: "Quelles dérogations ou aménagements réglementaires sont possibles pour réduire le coût de mise en conformité sans risque juridique ?" },
    ],
  },

  {
    prefix: '/rehabilitation/analyse-plan',
    quick: [
      { label: '📐 Surface cohérente avec le permis ?',  prompt: "À partir de l'analyse de plan disponible, la surface utile est-elle cohérente avec la surface indiquée au permis ou à l'état des lieux ?" },
      { label: '⚠️ Anomalies relevées sur le plan ?',    prompt: "Quelles anomalies ou incohérences ont été relevées par l'analyse de plan sur ce bâtiment ?" },
      { label: '✅ Plan compatible avec l\'usage visé ?', prompt: "Selon l'analyse de plan, ce bâtiment permet-il l'usage envisagé sans modification majeure de la structure ou des circulations ?" },
    ],
    advanced: [
      { label: '📊 Analyse fonctionnelle complète',      prompt: "À partir de l'analyse de plan : analyse réglementaire et fonctionnelle complète (surfaces, circulations, conformité, potentiel de redistribution et optimisations possibles)." },
      { label: '🎯 Optimiser la surface utile',          prompt: "Selon l'analyse de plan, quelles modifications permettraient d'optimiser la surface utile sans toucher aux murs porteurs ?" },
      { label: '🏘️ Division en plusieurs lots possible ?', prompt: "Selon l'analyse de plan, ce bâtiment peut-il être divisé en plusieurs lots ? Quelles contraintes techniques, réglementaires et de copropriété ?" },
    ],
  },

  {
    prefix: '/rehabilitation/travaux',
    quick: [
      { label: '💰 Budget au m² réaliste ?',             prompt: "Ce budget travaux au m² est-il réaliste pour ce niveau de rénovation et ce type de bâtiment ?" },
      { label: '🎨 Quelle gamme de finitions ?',         prompt: "Quelle gamme de finitions recommandes-tu (éco / standard / premium) pour maximiser la valorisation après travaux ?" },
      { label: '⚠️ Postes à risque de dépassement',      prompt: "Quels postes de travaux sont les plus risqués en termes de dépassement de budget sur ce type de réhabilitation ?" },
    ],
    advanced: [
      { label: '📋 Analyse complète par lots',           prompt: "Analyse complète du budget travaux par lots avec benchmarks marché pour ce type et cette époque de bâtiment." },
      { label: '🔢 3 niveaux + impact valorisation',     prompt: "Compare les 3 niveaux de rénovation (rafraîchissement / standard / complet) : budget estimé, délai et impact sur la valorisation finale." },
      { label: '🎯 Postes à prioriser',                  prompt: "Quels postes prioriser pour tenir le budget et maximiser la plus-value après travaux ?" },
    ],
  },

  {
    prefix: '/rehabilitation/synthese-audit',
    quick: [
      { label: '✅ Audit complet ? Étapes manquantes ?',  prompt: "L'audit est-il complet ? Quelles étapes restent à renseigner pour finaliser la synthèse ?" },
      { label: '🎯 Verdict global sur le projet',        prompt: "Quel est le verdict global sur ce projet de réhabilitation ? Go / no-go avec les raisons principales." },
      { label: '⚠️ 3 points d\'attention principaux',    prompt: "Quels sont les 3 points d'attention principaux à surveiller sur ce projet ?" },
    ],
    advanced: [
      { label: '📋 Synthèse audit complète',             prompt: "Synthèse complète de l'audit : conformité, plan, travaux, budget global consolidé et recommandation go/no-go." },
      { label: '🔍 Risques résiduels après réhabilitation', prompt: "Quels risques résiduels subsistent après la réhabilitation prévue ? Comment les mitiger ?" },
      { label: '📄 Note de présentation investisseur',   prompt: "Prépare une note de synthèse structurée pour présenter ce projet à un investisseur ou un financeur (contexte, travaux, budget, valorisation, risques)." },
    ],
  },

  {
    prefix: '/rehabilitation/valorisation',
    quick: [
      { label: '💶 Prix de sortie cohérent ?',           prompt: "Le prix de sortie visé est-il cohérent avec la valorisation Mimmoza du bien ? Donne un verdict rapide." },
      { label: '📊 Marge suffisante pour valider ?',     prompt: "La marge après travaux est-elle suffisante pour valider l'opération ? Donne un verdict rapide." },
      { label: '⚖️ Prix de sortie minimal à l\'équilibre', prompt: "Quel prix de sortie minimal faut-il atteindre pour être à l'équilibre sur cette opération ?" },
    ],
    advanced: [
      { label: '🔬 Valorisation complète',               prompt: "Calcule la valorisation complète : prix de revient total (acquisition + travaux + frais), prix de sortie minimal et marge nette." },
      { label: '📈 Compare aux DVF du secteur',          prompt: "Compare ce projet aux transactions DVF récentes dans ce secteur pour valider le prix de sortie envisagé." },
    ],
  },

  // Fallback réhabilitation générique
  {
    prefix: '/rehabilitation',
    quick: [
      { label: '🏗️ Ce projet est-il viable ?',           prompt: "Ce projet de réhabilitation est-il viable techniquement et financièrement ? Premier avis." },
      { label: '💰 Budget travaux réaliste ?',           prompt: "Le budget travaux est-il réaliste pour ce type de réhabilitation ?" },
      { label: '⚠️ Risques principaux à anticiper',      prompt: "Quels sont les risques principaux à anticiper sur ce projet de réhabilitation ?" },
    ],
    advanced: [
      { label: '📊 Analyse complète du projet',          prompt: "Analyse complète : état du bâti, conformité, travaux, valorisation et recommandation go/no-go." },
      { label: '📄 Note de présentation investisseur',   prompt: "Prépare une note de présentation complète pour ce projet de réhabilitation." },
      { label: '📈 Valorisation et rentabilité',         prompt: "Calcule la valorisation après travaux et la rentabilité de cette opération de réhabilitation." },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Fonction principale exportée
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne les questions adaptées à la route et au mode.
 * Cherche la correspondance la plus spécifique (préfixe le plus long).
 * Retourne null si aucune route ne correspond → fallback statique dans CopilotEmptyState.
 */
export function getCopilotQuickQuestions(
  ctx: QuickQuestionsContext,
): QuickQuestion[] | null {
  const { pathname, mode = 'quick' } = ctx;

  const matched = ROUTE_QUESTIONS
    .filter(r => pathname.startsWith(r.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];

  if (!matched) return null;
  return mode === 'advanced' ? matched.advanced : matched.quick;
}

/**
 * Construit le label de contexte affiché dans le badge Copilot.
 * Ex : "14A avenue Pierre Iaramendy — Simulation travaux"
 */
export function getCopilotContextLabel(ctx: QuickQuestionsContext): string | null {
  const { pathname, activeDeal } = ctx;

  const SEGMENT_LABELS: Record<string, string> = {
    // Marchand tabs (query params → pathname virtuel)
    'rentabilite':         'Rentabilité',
    'due_diligence':       'Due Diligence',
    'marche_risques':      'Marché & Risques',
    'analyse_predictive':  'Analyse prédictive',
    'synthese_ia':         'Synthèse IA',
    // Marchand paths
    'pipeline':            'Pipeline',
    'simulation':          'Simulation travaux',
    'travaux':             'Suivi travaux',
    'analyse':             'Analyse',
    'sortie':              'Sortie',
    'sourcing':            'Sourcing',
    // Réhabilitation paths
    'projets':             'Projets',
    'vue-ensemble':        'Vue d\'ensemble',
    'conformite':          'Conformité réglementaire',
    'analyse-plan':        'Analyse du plan',
    'synthese-audit':      'Synthèse audit',
    'valorisation':        'Valorisation',
    // Promoteur paths
    'foncier':             'PLU & Foncier',
    'risques':             'Risques bloquants',
    'programmation':       'Programmation',
    'implantation-2d':     'Implantation 2D',
    'massing-3d':          'Massing 3D',
    'generateur-facades':  'Façades IA',
    'simulation-travaux':  'Simulation travaux',
    'marche':              'Marché',
    'bilan-promoteur':     'Bilan promoteur',
    'bilan':               'Bilan',
    'synthese':            'Comité foncier',
    'veille':              'Veille foncière',
    'permis-construire':   'Permis de construire',
    'recherche-contacts':  'Contacts mairie',
  };

  const segments = pathname.split('/').filter(Boolean);
  const lastSeg  = segments[segments.length - 1] ?? '';
  const tabLabel = SEGMENT_LABELS[lastSeg] ?? null;

  if (!activeDeal?.address && !activeDeal?.title) return tabLabel;
  const dealLabel = activeDeal.address ?? activeDeal.title ?? null;
  if (!dealLabel) return tabLabel;
  if (!tabLabel)  return dealLabel;
  return `${dealLabel} — ${tabLabel}`;
}