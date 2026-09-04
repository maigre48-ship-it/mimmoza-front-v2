// =============================================================================
// REGISTRE DES ROUTES DE L'APPLICATION — source unique pour le copilote
// =============================================================================
//
// Pourquoi ce fichier existe
// --------------------------
// Avant lui, la doctrine de navigation du copilote vivait entièrement dans la
// `description` du tool `action_ouvrir_page`, qui ne citait que six routes,
// pendant que l'exécuteur acceptait n'importe quelle chaîne commençant par '/'.
// Résultat : le modèle inventait les routes des ~55 autres écrans (massing 3D,
// façades, bilan, synthèse, permis, contacts mairie, conformité, valorisation,
// veille, sourcing, deal-center…) et l'utilisateur atterrissait sur une 404.
//
// Ce registre est la liste opposable. `action_ouvrir_page` en dérive à la fois
// le catalogue montré au modèle et la validation de la route proposée.
//
// Règles de maintenance
// ---------------------
//  1. Toute route ajoutée dans src/App.tsx doit apparaître ici, sinon le
//     copilote ne saura pas l'ouvrir.
//  2. Ne listez PAS les pages de compte, de facturation, d'administration ni
//     les pages légales : le copilote n'a pas à y envoyer l'utilisateur.
//  3. `label` est ce que l'utilisateur lit dans la carte de confirmation.
//     `hint` est ce que le modèle lit pour choisir. Écrivez le second dans le
//     vocabulaire des questions posées, pas dans celui du code.
//  4. Les alias sont des routes de redirection déclarées dans App.tsx : elles
//     sont acceptées à la validation mais jamais proposées au modèle.
// =============================================================================

export type AppSpace =
  | 'commun'
  | 'promoteur'
  | 'marchand'
  | 'particulier'
  | 'rehabilitation'
  | 'assurance'
  | 'apporteur';

export interface AppRoute {
  /** Chemin canonique, sans query string. */
  path: string;
  /** Libellé utilisateur, affiché dans la carte de confirmation. */
  label: string;
  /** Espace métier auquel la page appartient. */
  space: AppSpace;
  /** À quoi sert la page, dans le vocabulaire de l'utilisateur. */
  hint: string;
  /** Query params supportés par la page, s'il y en a. */
  params?: string[];
  /** true si la page exige une étude promoteur active (PromoteurStudyRequired). */
  requiresStudy?: boolean;
}

export const APP_ROUTES: readonly AppRoute[] = [
  // ── Commun ────────────────────────────────────────────────────────────────
  { path: '/dashboard', label: 'Tableau de bord', space: 'commun',
    hint: "vue d'ensemble des dossiers, études et alertes de l'utilisateur" },
  { path: '/analyse-rapide', label: 'Analyse rapide', space: 'commun',
    hint: "analyse complète d'une adresse en un écran : prix, risques, PLU, scores" },
  { path: '/opportunites', label: 'Opportunités', space: 'commun',
    hint: 'biens détectés par les veilles et les scans de portails, triés par score' },
  { path: '/veille/marche', label: 'Veille marché', space: 'commun',
    hint: "suivi d'un secteur : stock d'annonces, évolution des prix, nouvelles opportunités" },
  { path: '/parametres/veille', label: 'Réglages des veilles', space: 'commun',
    hint: 'zones de veille et watchlists : création, critères, désactivation' },

  // ── Promoteur ─────────────────────────────────────────────────────────────
  { path: '/promoteur', label: 'Accueil promoteur', space: 'promoteur',
    hint: 'liste des opérations promoteur et état de leur chaîne d’études' },
  { path: '/promoteur/nouvelle-opportunite', label: 'Nouvelle opération', space: 'promoteur',
    hint: "création d'une opération promoteur à partir d'une adresse ou d'une parcelle" },
  { path: '/promoteur/veille', label: 'Veille foncière', space: 'promoteur',
    hint: 'terrains et gisements fonciers suivis sur un secteur' },
  { path: '/promoteur/foncier', label: 'Foncier, PLU et faisabilité', space: 'promoteur',
    hint: 'sélection des parcelles, zonage PLU, règles opposables, capacité constructible',
    params: ['study'] },
  { path: '/promoteur/marche', label: 'Étude de marché', space: 'promoteur',
    hint: "étude de marché locale : prix, absorption, concurrence, programmation. '&highlight=pdf' met en avant le bouton de génération du rapport PDF",
    params: ['study', 'highlight'] },
  { path: '/promoteur/risques', label: 'Étude de risques', space: 'promoteur',
    hint: 'risques naturels et technologiques, PPR, servitudes, scoring bancaire',
    params: ['study'] },
  { path: '/promoteur/permis-construire', label: 'Permis de construire', space: 'promoteur',
    hint: 'permis et déclarations préalables déposés autour du projet, avec filtres et dates' },
  { path: '/promoteur/recherche-contacts', label: 'Contacts mairie', space: 'promoteur',
    hint: "coordonnées des mairies d'un secteur et des maires : email, téléphone, adresse, nom de l'élu, avec export et envoi groupé" },
  { path: '/promoteur/logements-sociaux', label: 'Besoin en logements sociaux', space: 'promoteur',
    hint: 'obligations SRU de la commune, déficit de logements sociaux, carence' },
  { path: '/promoteur/opportunites-apporteurs', label: 'Opportunités apporteurs', space: 'promoteur',
    hint: "affaires déposées par les apporteurs et proposées à l'achat" },
  { path: '/promoteur/programmation', label: 'Programmation', space: 'promoteur',
    hint: 'mix typologique, répartition des surfaces, nombre de logements' },
  { path: '/promoteur/massing', label: 'Analyse de capacité', space: 'promoteur',
    hint: 'capacité constructible du terrain : emprise, hauteur, SDP mobilisable' },
  { path: '/promoteur/estimation', label: 'Estimation et comparables', space: 'promoteur',
    hint: 'valeur du bien ou du terrain, transactions DVF comparables, fourchette de prix',
    params: ['study'], requiresStudy: true },
  { path: '/promoteur/implantation-2d', label: 'Implantation 2D', space: 'promoteur',
    hint: 'plan masse : implantation des bâtiments, reculs, prospects, contrôle de conformité',
    requiresStudy: true },
  { path: '/promoteur/massing-3d', label: 'Massing 3D', space: 'promoteur',
    hint: 'volumétrie 3D du projet sur le terrain naturel, métré SDP et SHAB',
    requiresStudy: true },
  { path: '/promoteur/generateur-facades', label: 'Générateur de façades', space: 'promoteur',
    hint: 'génération d’images de façades pour le projet', requiresStudy: true },
  { path: '/promoteur/simulation-travaux', label: 'Simulation travaux', space: 'promoteur',
    hint: 'coût de construction détaillé poste par poste', requiresStudy: true },
  { path: '/promoteur/bilan-promoteur', label: 'Bilan promoteur', space: 'promoteur',
    hint: 'bilan financier de l’opération : CA, coûts, marge, charge foncière admissible',
    requiresStudy: true },
  { path: '/promoteur/synthese', label: 'Synthèse et dossier comité', space: 'promoteur',
    hint: 'synthèse de l’opération et dossier de présentation en comité', requiresStudy: true },
  { path: '/promoteur/exports', label: 'Exports promoteur', space: 'promoteur',
    hint: 'export des études et du bilan en PDF ou Excel', requiresStudy: true },

  // ── Marchand de biens / investisseur ──────────────────────────────────────
  { path: '/marchand-de-bien', label: 'Pipeline', space: 'marchand',
    hint: 'pipeline des affaires en cours, de la détection à la revente' },
  { path: '/marchand-de-bien/sourcing', label: 'Sourcing', space: 'marchand',
    hint: 'recherche de biens et SmartScore de sourcing' },
  { path: '/marchand-de-bien/analyse', label: 'Analyse du deal', space: 'marchand',
    hint: "analyse complète d'un bien. Onglets : '?tab=rentabilite' (rendement, TRI, cash-flow), '?tab=marche_risques' (marché et risques), '?tab=due-diligence', '?tab=analyse_predictive'",
    params: ['tab'] },
  { path: '/marchand-de-bien/deal-center', label: 'Deal center', space: 'marchand',
    hint: 'centre de décision du deal : moteur financier, pack investisseur, comité' },
  { path: '/marchand-de-bien/estimation', label: 'Estimation', space: 'marchand',
    hint: 'estimation de la valeur du bien et comparables DVF' },
  { path: '/marchand-de-bien/marche', label: 'Étude de marché', space: 'marchand',
    hint: 'étude de marché locale sur le secteur du bien' },
  { path: '/marchand-de-bien/risques', label: 'Étude de risques', space: 'marchand',
    hint: 'risques naturels et technologiques sur le bien' },
  { path: '/marchand-de-bien/execution', label: 'Exécution des travaux', space: 'marchand',
    hint: 'suivi de chantier, planning des travaux, avancement' },
  { path: '/marchand-de-bien/execution/simulation', label: 'Simulation travaux', space: 'marchand',
    hint: 'chiffrage des travaux de rénovation poste par poste' },
  { path: '/marchand-de-bien/planning', label: 'Rendu travaux', space: 'marchand',
    hint: 'rendu visuel avant/après des travaux' },
  { path: '/marchand-de-bien/sortie', label: 'Sortie et revente', space: 'marchand',
    hint: 'scénarios de sortie, prix de revente, plus-value' },
  { path: '/marchand-de-bien/exports', label: 'Exports', space: 'marchand',
    hint: 'export du dossier en PDF ou Excel' },

  // ── Particulier ───────────────────────────────────────────────────────────
  { path: '/particulier', label: 'Accueil particulier', space: 'particulier',
    hint: 'tableau de bord du projet immobilier personnel' },
  { path: '/particulier/projet', label: 'Mon projet', space: 'particulier',
    hint: 'définition du projet : budget, secteur, critères' },
  { path: '/particulier/recherche', label: 'Recherche de biens', space: 'particulier',
    hint: 'recherche d’annonces correspondant au projet' },
  { path: '/particulier/favoris', label: 'Favoris', space: 'particulier',
    hint: 'biens mis de côté' },
  { path: '/particulier/comparateur', label: 'Comparateur', space: 'particulier',
    hint: 'comparaison de plusieurs biens côte à côte' },
  { path: '/particulier/alertes', label: 'Alertes', space: 'particulier',
    hint: 'alertes sur les nouvelles annonces correspondant aux critères' },
  { path: '/particulier/estimation', label: 'Estimation', space: 'particulier',
    hint: 'estimation de la valeur d’un bien' },
  { path: '/particulier/quartier', label: 'Quartier', space: 'particulier',
    hint: 'qualité du quartier : transports, écoles, commerces, services' },
  { path: '/particulier/charges', label: 'Charges', space: 'particulier',
    hint: 'charges courantes du logement : copropriété, taxe foncière, énergie' },
  { path: '/particulier/financement', label: 'Capacité d’emprunt', space: 'particulier',
    hint: 'capacité d’emprunt, mensualités, apport nécessaire' },
  { path: '/particulier/scenarios', label: 'Scénarios de financement', space: 'particulier',
    hint: 'comparaison de plusieurs montages de financement' },
  { path: '/particulier/dossier', label: 'Dossier banque', space: 'particulier',
    hint: 'constitution du dossier de prêt à présenter à la banque' },
  { path: '/particulier/travaux', label: 'Budget travaux', space: 'particulier',
    hint: 'chiffrage des travaux à prévoir' },
  { path: '/particulier/conformite', label: 'Conformité', space: 'particulier',
    hint: 'diagnostics et conformité réglementaire du logement' },
  { path: '/particulier/planning', label: 'Planning', space: 'particulier',
    hint: 'planning des étapes du projet d’achat' },
  { path: '/particulier/documents', label: 'Mes documents', space: 'particulier',
    hint: 'documents du dossier' },
  { path: '/particulier/exports', label: 'Exports', space: 'particulier',
    hint: 'export du dossier' },
  { path: '/particulier/historique', label: 'Historique', space: 'particulier',
    hint: 'historique des recherches et estimations' },

  // ── Réhabilitation ────────────────────────────────────────────────────────
  { path: '/rehabilitation/projets', label: 'Projets de réhabilitation', space: 'rehabilitation',
    hint: 'liste des bâtiments en cours de réhabilitation' },
  { path: '/rehabilitation/vue-ensemble', label: 'Vue d’ensemble', space: 'rehabilitation',
    hint: 'état du bâtiment, diagnostic global, audit' },
  { path: '/rehabilitation/conformite', label: 'Conformité', space: 'rehabilitation',
    hint: 'conformité ERP, accessibilité, sécurité incendie, changement d’usage' },
  { path: '/rehabilitation/analyse-plan', label: 'Analyse de plan', space: 'rehabilitation',
    hint: 'lecture automatique d’un plan existant : pièces, surfaces, structure' },
  { path: '/rehabilitation/travaux', label: 'Travaux', space: 'rehabilitation',
    hint: 'chiffrage des travaux de réhabilitation' },
  { path: '/rehabilitation/planning-travaux', label: 'Planning des travaux', space: 'rehabilitation',
    hint: 'phasage et planning du chantier' },
  { path: '/rehabilitation/synthese-audit', label: 'Synthèse d’audit', space: 'rehabilitation',
    hint: 'synthèse de l’audit technique et réglementaire' },
  { path: '/rehabilitation/valorisation', label: 'Valorisation', space: 'rehabilitation',
    hint: 'valeur du bien après travaux, scénarios de sortie' },
  { path: '/rehabilitation/rendu-travaux', label: 'Rendu travaux', space: 'rehabilitation',
    hint: 'rendu visuel avant/après' },

  // ── Assurance ─────────────────────────────────────────────────────────────
  { path: '/assurance', label: 'Accueil assurance', space: 'assurance',
    hint: 'tableau de bord des dossiers de souscription' },
  { path: '/assurance/souscription', label: 'Souscription', space: 'assurance',
    hint: 'dossier de souscription' },
  { path: '/assurance/exposition', label: 'Exposition', space: 'assurance',
    hint: 'exposition aux risques du bien assuré' },
  { path: '/assurance/tarification', label: 'Tarification', space: 'assurance',
    hint: 'calcul de la prime' },
  { path: '/assurance/offre', label: 'Offre', space: 'assurance',
    hint: 'édition de l’offre commerciale' },
  { path: '/assurance/monitoring', label: 'Monitoring', space: 'assurance',
    hint: 'suivi du portefeuille assuré' },

  // ── Apporteur ─────────────────────────────────────────────────────────────
  { path: '/apporteur', label: 'Accueil apporteur', space: 'apporteur',
    hint: 'affaires déposées et leur statut' },
  { path: '/apporteur/deposer', label: 'Déposer une affaire', space: 'apporteur',
    hint: 'dépôt d’une nouvelle affaire dans le pool' },
] as const;

/**
 * Routes de redirection déclarées dans App.tsx. Acceptées à la validation
 * (le modèle peut les avoir apprises), jamais proposées dans le catalogue.
 */
const ROUTE_ALIASES: Readonly<Record<string, string>> = {
  '/veille': '/opportunites',
  '/marchand': '/marchand-de-bien',
  '/marchand-de-bien/rentabilite': '/marchand-de-bien/analyse?tab=rentabilite',
  '/marchand-de-bien/due-diligence': '/marchand-de-bien/analyse?tab=due-diligence',
  '/marchand-de-bien/analyse-predictive': '/marchand-de-bien/analyse?tab=analyse_predictive',
  '/promoteur/plu-faisabilite': '/promoteur/foncier',
  '/promoteur/faisabilite': '/promoteur/foncier',
  '/promoteur/plan-2d': '/promoteur/implantation-2d',
  '/promoteur/bilan': '/promoteur/bilan-promoteur',
  '/particulier/evaluation': '/particulier/estimation',
  '/rehabilitation/audit': '/rehabilitation/vue-ensemble',
  '/rehabilitation/analyse': '/rehabilitation/vue-ensemble',
};

const BY_PATH = new Map(APP_ROUTES.map((r) => [r.path, r]));

/** Retire la query string et le slash final, sans casser la racine '/'. */
function canonicalize(route: string): string {
  const withoutQuery = route.split('?')[0].split('#')[0];
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) return withoutQuery.slice(0, -1);
  return withoutQuery;
}

/** La route existe-t-elle vraiment dans l'application ? */
export function isKnownRoute(route: string): boolean {
  const path = canonicalize(route);
  return BY_PATH.has(path) || Object.prototype.hasOwnProperty.call(ROUTE_ALIASES, path);
}

/** Entrée du registre correspondant à une route, alias résolus. */
export function findRoute(route: string): AppRoute | null {
  const path = canonicalize(route);
  const direct = BY_PATH.get(path);
  if (direct) return direct;
  const alias = ROUTE_ALIASES[path];
  return alias ? BY_PATH.get(canonicalize(alias)) ?? null : null;
}

/** Libellé utilisateur d'une route, ou la route elle-même si inconnue. */
export function routeLabel(route: string): string {
  return findRoute(route)?.label ?? route;
}

/**
 * Suggestions de routes proches, pour le message d'erreur renvoyé au modèle
 * quand il propose une route inexistante. Compare les segments du chemin.
 */
export function suggestRoutes(route: string, limit = 5): AppRoute[] {
  const wanted = canonicalize(route).split('/').filter(Boolean);
  if (wanted.length === 0) return [];
  return APP_ROUTES
    .map((r) => {
      const segments = r.path.split('/').filter(Boolean);
      const overlap = segments.filter((s) => wanted.includes(s)).length;
      return { route: r, overlap };
    })
    .filter(({ overlap }) => overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, limit)
    .map(({ route: r }) => r);
}

/**
 * Catalogue injecté dans la description du tool `action_ouvrir_page`.
 * Une ligne par route : chemin, libellé, à quoi elle sert.
 */
export function routeCatalogue(): string {
  const bySpace = new Map<AppSpace, AppRoute[]>();
  for (const r of APP_ROUTES) {
    const list = bySpace.get(r.space);
    if (list) list.push(r);
    else bySpace.set(r.space, [r]);
  }
  const blocks: string[] = [];
  for (const [space, routes] of bySpace) {
    const lines = routes.map((r) => {
      const study = r.requiresStudy ? ' [exige une étude active]' : '';
      return `  ${r.path} — ${r.label} : ${r.hint}${study}`;
    });
    blocks.push(`${space.toUpperCase()} :\n${lines.join('\n')}`);
  }
  return blocks.join('\n');
}
