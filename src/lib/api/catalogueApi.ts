// src/lib/api/catalogueApi.ts
// =============================================================================
// CATALOGUE DE L'API PUBLIQUE MIMMOZA — SOURCE UNIQUE CÔTÉ FRONT
// =============================================================================
//
// Contrat : docs/api/CONTRAT_API.md (22/10/2026). Tout écran qui affiche une
// formule API, un prix, un quota, un coût en crédits ou la liste des endpoints
// lit CE fichier : /api, /api/keys, /api/playground, /tarifs, /admin/tarifs.
//
// La table des coûts (API_ENDPOINT_COSTS) doit être IDENTIQUE à celle de la
// passerelle (supabase/functions/_shared/apiCatalogue.ts) : un test node:test
// (catalogueApi.test.ts) le vérifie.
//
// Principe : aucun crédit « à crédit ». Quota épuisé = appel refusé, sauf
// crédits de recharge PRÉPAYÉS. Les crédits ne sont prélevés que si l'appel
// réussit. Le quota est porté par le COMPTE, pas par la clé.
//
// Tous les montants sont HORS TAXES, en euros.
// Fichier sans dépendance (importé par les tests node:test).
// =============================================================================

/** URL de base de la passerelle publique. */
export const API_BASE_URL = "https://fwvrqngbafqdaekbdfnm.supabase.co/functions/v1/api-gateway";

// ── Formules ─────────────────────────────────────────────────────────────────

export type ApiFormuleId = "essai" | "starter" | "growth" | "scale";

export const API_FORMULE_IDS: readonly ApiFormuleId[] = ["essai", "starter", "growth", "scale"];

export interface ApiFormule {
  id: ApiFormuleId;
  nom: string;
  accroche: string;
  /** Prix mensuel HT sans engagement. 0 = gratuit. */
  prixMensuelHT: number;
  /** Prix mensuel HT équivalent en facturation annuelle (null : sans objet). */
  prixMensuelAnnuelHT: number | null;
  /** Crédits accordés : chaque mois (« mensuel ») ou une seule fois (« unique »). */
  credits: number;
  renouvellement: "mensuel" | "unique";
  /** Durée de validité des crédits de l'essai, en jours (null : formule mensuelle). */
  dureeEssaiJours: number | null;
  /** Prix HT de 1 000 crédits de recharge prépayée (null : pas de recharge). */
  rechargeParMilleHT: number | null;
  /** Débit maximal, en requêtes par minute. */
  debitParMinute: number;
  /** Nombre maximal de clés actives sur le compte. */
  clesMax: number;
  /** Avantages RÉELS, dans l'ordre d'affichage. */
  avantages: string[];
  miseEnAvant?: boolean;
}

/** Durée de validité des crédits de recharge, en mois. */
export const RECHARGE_VALIDITE_MOIS = 12;

const nf = (n: number) => n.toLocaleString("fr-FR");

export const API_FORMULES: readonly ApiFormule[] = [
  {
    id: "essai",
    nom: "Essai",
    accroche: "Pour découvrir l'API",
    prixMensuelHT: 0,
    prixMensuelAnnuelHT: null,
    credits: 500,
    renouvellement: "unique",
    dureeEssaiJours: 30,
    rechargeParMilleHT: null,
    debitParMinute: 10,
    clesMax: 2,
    avantages: [
      "500 crédits offerts, valables 30 jours",
      "Accès à tous les endpoints",
      "10 requêtes par minute",
      "2 clés au maximum",
    ],
  },
  {
    id: "starter",
    nom: "Starter",
    accroche: "Pour un premier outil en production",
    prixMensuelHT: 49,
    prixMensuelAnnuelHT: 39,
    credits: 10_000,
    renouvellement: "mensuel",
    dureeEssaiJours: null,
    rechargeParMilleHT: 5.9,
    debitParMinute: 60,
    clesMax: 5,
    avantages: [
      "10 000 crédits par mois",
      "Accès à tous les endpoints",
      "60 requêtes par minute",
      "5 clés au maximum",
    ],
  },
  {
    id: "growth",
    nom: "Growth",
    accroche: "Pour les équipes qui intègrent plusieurs outils",
    prixMensuelHT: 149,
    prixMensuelAnnuelHT: 119,
    credits: 50_000,
    renouvellement: "mensuel",
    dureeEssaiJours: null,
    rechargeParMilleHT: 3.5,
    debitParMinute: 200,
    clesMax: 20,
    avantages: [
      "50 000 crédits par mois",
      "Accès à tous les endpoints",
      "200 requêtes par minute",
      "20 clés au maximum",
    ],
    miseEnAvant: true,
  },
  {
    id: "scale",
    nom: "Scale",
    accroche: "Pour les gros volumes",
    prixMensuelHT: 499,
    prixMensuelAnnuelHT: 400,
    credits: 250_000,
    renouvellement: "mensuel",
    dureeEssaiJours: null,
    rechargeParMilleHT: 2.4,
    debitParMinute: 1000,
    clesMax: 100,
    avantages: [
      "250 000 crédits par mois",
      "Accès à tous les endpoints",
      "1 000 requêtes par minute",
      "100 clés au maximum",
    ],
  },
];

export const API_FORMULES_PAYANTES: readonly ApiFormule[] = API_FORMULES.filter((f) => f.prixMensuelHT > 0);

export function formuleApi(id: ApiFormuleId): ApiFormule {
  return API_FORMULES.find((f) => f.id === id) ?? API_FORMULES[0];
}

/**
 * Ramène un code de plan venu de la base (ou d'un ancien écran) à une formule
 * connue. Les anciens codes « free » / « payg » / inconnus deviennent « essai ».
 */
export function normaliserFormuleApi(code: unknown): ApiFormuleId {
  const c = typeof code === "string" ? code.trim().toLowerCase() : "";
  return (API_FORMULE_IDS as readonly string[]).includes(c) ? (c as ApiFormuleId) : "essai";
}

/** Prix mensuel affiché selon la périodicité choisie. */
export function prixMensuelApi(f: ApiFormule, periodicite: "mensuel" | "annuel"): number {
  return periodicite === "annuel" && f.prixMensuelAnnuelHT != null ? f.prixMensuelAnnuelHT : f.prixMensuelHT;
}

/** Prix HT de 1 000 crédits inclus dans le forfait (null pour l'essai). */
export function prixParMilleCreditsForfait(f: ApiFormule, periodicite: "mensuel" | "annuel"): number | null {
  if (f.prixMensuelHT === 0 || f.renouvellement !== "mensuel") return null;
  return (prixMensuelApi(f, periodicite) / f.credits) * 1000;
}

/** Économie (en %) de la facturation annuelle, arrondie. */
export function remiseAnnuelleApi(f: ApiFormule): number {
  if (!f.prixMensuelHT || f.prixMensuelAnnuelHT == null) return 0;
  return Math.round(((f.prixMensuelHT - f.prixMensuelAnnuelHT) / f.prixMensuelHT) * 100);
}

/** Plus forte économie annuelle parmi les formules payantes (pour le sélecteur). */
export const REMISE_ANNUELLE_MAX_API = Math.max(...API_FORMULES_PAYANTES.map(remiseAnnuelleApi));

// ── Textes de facturation ────────────────────────────────────────────────────

export const API_ESSAI = formuleApi("essai");

/** Phrase de facturation, reprise sur /api et /tarifs. */
export const PHRASE_FACTURATION_API =
  "Chaque appel consomme des crédits, prélevés uniquement si l'appel réussit. " +
  "Aucun dépassement n'est facturé après coup : une fois vos crédits épuisés, les appels sont refusés " +
  "jusqu'au renouvellement de vos crédits ou à une recharge prépayée. " +
  `L'essai offre ${nf(API_ESSAI.credits)} crédits valables ${API_ESSAI.dureeEssaiJours} jours, sans carte bancaire.`;

export const PHRASE_RECHARGE_API =
  "Les abonnés peuvent acheter à l'avance des crédits de recharge, utilisés une fois les crédits du mois épuisés " +
  `et valables ${RECHARGE_VALIDITE_MOIS} mois. Les crédits du mois non utilisés ne sont pas reportés.`;

// ── Endpoints ────────────────────────────────────────────────────────────────

export type ApiGroupeId = "scoring" | "foncier" | "batiment" | "territoire" | "service";

export const API_GROUPES: readonly { id: ApiGroupeId; libelle: string }[] = [
  { id: "scoring", libelle: "Score & marché" },
  { id: "foncier", libelle: "Parcelle & urbanisme" },
  { id: "batiment", libelle: "Bâtiment & travaux" },
  { id: "territoire", libelle: "Territoire & risques" },
  { id: "service", libelle: "Service" },
];

export interface ApiEndpoint {
  methode: "GET" | "POST";
  chemin: string;
  /** Crédits consommés par appel réussi. */
  credits: number;
  /** « bientot » : route annoncée mais fermée (licence de la source en attente) — non facturée. */
  statut: "live" | "beta" | "bientot";
  groupe: ApiGroupeId;
  titre: string;
  description: string;
  /** Corps JSON d'exemple (null pour un GET). */
  exemple: Record<string, unknown> | null;
}

const POINT_PARIS = { lat: 48.8686, lon: 2.3306 };

export const API_ENDPOINTS: readonly ApiEndpoint[] = [
  {
    methode: "POST", chemin: "/v1/scoring/smart", credits: 10, statut: "live", groupe: "scoring",
    titre: "SmartScore",
    description: "Note d'emplacement sur 100 : transports, commerces, écoles, santé, marché et environnement.",
    exemple: { ...POINT_PARIS },
  },
  {
    methode: "POST", chemin: "/v1/market/dvf", credits: 3, statut: "live", groupe: "scoring",
    titre: "Marché DVF",
    description: "Statistiques des ventes autour d'un point : prix médian et moyen au m², quartiles, volumes. Aucune vente individuelle.",
    exemple: { ...POINT_PARIS },
  },
  {
    methode: "POST", chemin: "/v1/estimation", credits: 15, statut: "beta", groupe: "scoring",
    titre: "Estimation",
    description: "Estimation de la valeur d'un bien à partir de sa localisation et de ses caractéristiques.",
    exemple: { ...POINT_PARIS, type_bien: "appartement", surface_m2: 65 },
  },
  {
    methode: "POST", chemin: "/v1/parcelle", credits: 1, statut: "live", groupe: "foncier",
    titre: "Parcelle cadastrale",
    description: "Contour, surface et commune d'une parcelle à partir de son identifiant cadastral.",
    exemple: { reference_cadastrale: "75108000AB0012" },
  },
  {
    methode: "POST", chemin: "/v1/plu", credits: 4, statut: "live", groupe: "foncier",
    titre: "Règles du PLU",
    description: "Zone du plan local d'urbanisme d'une parcelle et principales règles applicables.",
    exemple: { reference_cadastrale: "75108000AB0012" },
  },
  {
    methode: "POST", chemin: "/v1/servitudes", credits: 2, statut: "live", groupe: "foncier",
    titre: "Servitudes",
    description: "Servitudes d'utilité publique qui grèvent un point (Géoportail de l'urbanisme).",
    exemple: { ...POINT_PARIS },
  },
  {
    methode: "POST", chemin: "/v1/faisabilite", credits: 25, statut: "live", groupe: "foncier",
    titre: "Faisabilité",
    description: "Synthèse de constructibilité d'une parcelle : règles du PLU, contraintes et potentiel.",
    exemple: { reference_cadastrale: "75108000AB0012" },
  },
  {
    methode: "POST", chemin: "/v1/permis", credits: 2, statut: "live", groupe: "foncier",
    titre: "Permis de construire",
    description: "Permis de construire et logements autorisés sur un territoire (base Sitadel).",
    exemple: { code_insee: "75108" },
  },
  {
    methode: "POST", chemin: "/v1/batiment", credits: 2, statut: "bientot", groupe: "batiment",
    titre: "Bâtiment",
    description: "Caractéristiques d'un bâtiment : année de construction, hauteur, matériaux, usage (BDNB). Ouverture prochaine, en attente de l'accord du producteur des données.",
    exemple: { adresse: "10 rue de la Paix, 75002 Paris" },
  },
  {
    methode: "POST", chemin: "/v1/dpe", credits: 1, statut: "live", groupe: "batiment",
    titre: "DPE",
    description: "Diagnostics de performance énergétique publiés autour d'un point (ADEME).",
    exemple: { ...POINT_PARIS, rayon_m: 100 },
  },
  {
    methode: "POST", chemin: "/v1/couts", credits: 2, statut: "beta", groupe: "batiment",
    titre: "Coûts de travaux",
    description: "Fourchette de coûts de construction ou de rénovation selon la surface et la gamme.",
    exemple: { nature: "construction", typologie: "collectif_r4", gamme: "standard", surface_sdp_m2: 1200, code_insee: "75108" },
  },
  {
    methode: "POST", chemin: "/v1/risks", credits: 3, statut: "live", groupe: "territoire",
    titre: "Risques",
    description: "Risques naturels et technologiques connus autour d'un point.",
    exemple: { ...POINT_PARIS },
  },
  {
    methode: "POST", chemin: "/v1/environnement", credits: 3, statut: "live", groupe: "territoire",
    titre: "Environnement",
    description: "Bruit, potentiel solaire, altitude et monuments historiques à proximité.",
    exemple: { ...POINT_PARIS },
  },
  {
    methode: "POST", chemin: "/v1/mobilite", credits: 2, statut: "live", groupe: "territoire",
    titre: "Mobilité",
    description: "Desserte en transports en commun autour d'un point.",
    exemple: { ...POINT_PARIS },
  },
  {
    methode: "POST", chemin: "/v1/loyers", credits: 1, statut: "live", groupe: "territoire",
    titre: "Loyers de référence",
    description: "Loyers de marché de la commune, par type de bien.",
    exemple: { code_insee: "75108" },
  },
  {
    methode: "POST", chemin: "/v1/fiscalite", credits: 2, statut: "live", groupe: "territoire",
    titre: "Fiscalité locale",
    description: "Taux des taxes locales et zonage A/B/C de la commune.",
    exemple: { code_insee: "75108" },
  },
  {
    methode: "GET", chemin: "/health", credits: 0, statut: "live", groupe: "service",
    titre: "État du service",
    description: "Vérifie que l'API répond. Gratuit.",
    exemple: null,
  },
];

/** Coût en crédits des endpoints facturés « /v1/… » — doit égaler la table de la passerelle. */
export const API_ENDPOINT_COSTS: Readonly<Record<string, number>> = Object.fromEntries(
  API_ENDPOINTS.filter((e) => e.chemin.startsWith("/v1/")).map((e) => [e.chemin, e.credits]),
);

export function endpointApi(chemin: string): ApiEndpoint | undefined {
  return API_ENDPOINTS.find((e) => e.chemin === chemin);
}

export function endpointsDuGroupe(groupe: ApiGroupeId): ApiEndpoint[] {
  return API_ENDPOINTS.filter((e) => e.groupe === groupe);
}

/** Nombre d'endpoints facturés (hors /health). */
export const NB_ENDPOINTS_API = Object.keys(API_ENDPOINT_COSTS).length;

// ── Coût de revient (hypothèses prudentes, sans cache) ──────────────────────
// Sert à garantir par test qu'aucun appel n'est vendu à perte et que la marge
// brute reste ≥ MARGE_BRUTE_MIN_API même au prix le plus bas (Scale annuel).
// Hypothèses (octobre 2026, à revoir si un fournisseur change ses prix) :
//   · Supabase Pro : ~2 $ / million d'appels de fonctions au-delà du forfait,
//     soit ~0,000002 € par appel interne (une route en enchaîne 2 à 8) ;
//   · OpenStreetMap via un serveur Overpass payant (Geofabrik « Medium » :
//     80 € HT / 100 000 requêtes = 0,0008 € / requête) — 3 requêtes au plus par
//     SmartScore ;
//   · sources publiques gratuites (IGN, DGFiP, ADEME, Géorisques, INSEE…) : 0 €.
// Chaque valeur inclut une large marge d'erreur (×10 sur Supabase).
export const COUT_REVIENT_MAX_EUR: Readonly<Record<string, number>> = {
  "/health": 0,
  "/v1/scoring/smart": 0.003,
  "/v1/market/dvf": 0.0003,
  "/v1/risks": 0.0003,
  "/v1/parcelle": 0.0003,
  "/v1/plu": 0.0003,
  "/v1/servitudes": 0.0003,
  "/v1/faisabilite": 0.001,
  "/v1/permis": 0.0003,
  "/v1/dpe": 0.0003,
  "/v1/batiment": 0.0003,
  "/v1/loyers": 0.0003,
  "/v1/fiscalite": 0.0003,
  "/v1/environnement": 0.0005,
  "/v1/mobilite": 0.0003,
  "/v1/couts": 0.0003,
  "/v1/estimation": 0.001,
};

/** Marge brute minimale exigée sur CHAQUE endpoint, au prix le plus bas vendu. */
export const MARGE_BRUTE_MIN_API = 0.8;

/** Prix le plus bas d'un crédit (€ HT), toutes formules et périodicités confondues. */
export function prixCreditPlancherEur(): number {
  const prix = API_FORMULES_PAYANTES.flatMap((f) => (["mensuel", "annuel"] as const)
    .map((p) => prixParMilleCreditsForfait(f, p))
    .filter((x): x is number => x != null));
  return Math.min(...prix) / 1000;
}

/** Corps d'exemple formaté pour un éditeur ou un bloc de code. */
export function exempleJson(e: ApiEndpoint): string {
  return e.exemple ? JSON.stringify(e.exemple, null, 2) : "";
}

/** Commande cURL d'exemple pour un endpoint. */
export function exempleCurl(e: ApiEndpoint, cle = "mk_live_xxxxxxxxxxxx"): string {
  const base = `curl -X ${e.methode} ${API_BASE_URL}${e.chemin}`;
  if (e.methode === "GET") return `${base} \\\n  -H "Authorization: Bearer ${cle}"`;
  return (
    `${base} \\\n  -H "Authorization: Bearer ${cle}" \\\n  -H "Content-Type: application/json" \\\n` +
    `  -d '${JSON.stringify(e.exemple ?? {})}'`
  );
}

export function libelleCredits(n: number): string {
  if (n === 0) return "gratuit";
  return `${nf(n)} crédit${n > 1 ? "s" : ""}`;
}
