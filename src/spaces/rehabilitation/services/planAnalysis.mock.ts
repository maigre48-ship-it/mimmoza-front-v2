// ─────────────────────────────────────────────────────────────────────────────
// planAnalysis.mock.ts
// Service mock — Analyse du plan / Mimmoza Réhabilitation
// Remplacé en V2 par le vrai moteur réglementaire + IA vision
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ComplianceLevel,
  ComplianceScore,
  PlanAnalysisInput,
  PlanAnalysisResult,
  PlanIssue,
  PlanRecommendation,
  RiskLevel,
} from "../shared/planAnalysis.types";

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calcule un score de conformité simulé basé sur les paramètres bâtiment.
 * En V2 : remplacé par analyse géométrique + moteur réglementaire.
 */
function computeMockScores(
  input: PlanAnalysisInput
): ComplianceScore {
  const { building } = input;

  // Base : ERP = contraintes renforcées, logement = plus souple
  const base = building.isErp ? 52 : 68;

  // Malus selon catégorie ERP (catégorie 1 = exigences max)
  const erpPenalty =
    building.isErp && building.erpCategory !== null
      ? Math.max(0, (5 - building.erpCategory) * 4)
      : 0;

  // Malus selon nombre de niveaux (évacuation + PMR plus complexes)
  const floorPenalty: Record<string, number> = {
    RDC: 0,
    "R+1": 3,
    "R+2": 6,
    "R+3": 9,
    "R+4+": 14,
  };
  const floors = floorPenalty[building.floorCount] ?? 0;

  const globalRaw = base - erpPenalty - floors;
  const global = Math.min(100, Math.max(20, globalRaw));

  return {
    global,
    pmr: Math.min(100, global - 8 + Math.floor(Math.random() * 12)),
    fireSafety: Math.min(100, global + 4 - Math.floor(Math.random() * 10)),
    circulation: Math.min(100, global - 4 + Math.floor(Math.random() * 8)),
    sanitaryFacilities: Math.min(100, global - 12 + Math.floor(Math.random() * 14)),
  };
}

function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 80) return "faible";
  if (score >= 60) return "modere";
  if (score >= 40) return "eleve";
  return "critique";
}

function scoreToComplianceLevel(score: number): ComplianceLevel {
  if (score >= 80) return "conforme";
  if (score >= 55) return "partiel";
  return "non_conforme";
}

// ---------------------------------------------------------------------------
// Issues mockées — corpus réaliste PMR / incendie / circulation
// ---------------------------------------------------------------------------

const ISSUE_CORPUS: Omit<PlanIssue, "id">[] = [
  {
    severity: "non_conforme",
    category: "PMR",
    title: "Largeur de couloir insuffisante",
    description:
      "Le couloir principal présente une largeur de 1,10 m. La réglementation impose un minimum de 1,40 m pour les ERP (1,20 m pour le logement).",
    regulatoryRef: "Art. R162-4 CCH — Arrêté du 20/04/2017",
    planZone: "Couloir RDC — Zone A",
  },
  {
    severity: "non_conforme",
    category: "PMR",
    title: "Absence de sanitaire PMR détecté",
    description:
      "Aucun sanitaire accessible aux personnes à mobilité réduite n'a été identifié sur le plan. Un WC adapté est obligatoire dès le premier niveau accessible au public.",
    regulatoryRef: "Art. R162-9 CCH — Arrêté du 08/12/2014",
    planZone: "Bloc sanitaire — Zone B",
  },
  {
    severity: "non_conforme",
    category: "Sécurité incendie",
    title: "Distance maximale d'évacuation dépassée",
    description:
      "La distance entre le fond de la salle principale et l'issue la plus proche excède 40 m. Le seuil réglementaire pour un ERP de type M est de 40 m.",
    regulatoryRef: "Règlement de sécurité ERP — Art. CO 46",
    planZone: "Salle principale — Zone C",
  },
  {
    severity: "a_verifier",
    category: "Sécurité incendie",
    title: "Dégagement complémentaire à vérifier",
    description:
      "La configuration de l'escalier secondaire ne permet pas de confirmer sa conformité comme dégagement d'évacuation. Une vérification sur plan coté est nécessaire.",
    regulatoryRef: "Règlement de sécurité ERP — Art. CO 36",
    planZone: "Cage escalier — Zone D",
  },
  {
    severity: "a_verifier",
    category: "PMR",
    title: "Rampe d'accès — pente à confirmer",
    description:
      "Une rampe est présente en façade principale. La pente semble supérieure à 5 % mais ne peut être confirmée sans côtes précises. Au-delà de 5 %, un palier de repos est obligatoire tous les 10 m.",
    regulatoryRef: "Arrêté du 20/04/2017 — Art. 10",
    planZone: "Façade principale — Zone E",
  },
  {
    severity: "a_verifier",
    category: "Circulation",
    title: "Zone de manœuvre fauteuil à confirmer",
    description:
      "L'espace de retournement devant la porte de l'accueil semble inférieur à 1,50 m × 1,50 m. Vérification sur plan coté requise.",
    regulatoryRef: "Art. R162-11 CCH",
    planZone: "Hall d'accueil — Zone F",
  },
  {
    severity: "conforme",
    category: "Sécurité incendie",
    title: "Cloisonnement coupe-feu apparent",
    description:
      "Les parois séparant les locaux techniques semblent présenter un cloisonnement coupe-feu cohérent avec les exigences ERP. À confirmer avec les fiches matériaux.",
    regulatoryRef: "Règlement de sécurité ERP — Art. C 14",
    planZone: "Locaux techniques — Zone G",
  },
  {
    severity: "conforme",
    category: "Circulation",
    title: "Largeur des portes de circulation principale",
    description:
      "Les portes identifiées sur le parcours principal présentent une largeur libre apparente ≥ 0,90 m, conforme aux exigences PMR.",
    regulatoryRef: "Arrêté du 20/04/2017 — Art. 8",
    planZone: "Parcours principal — Zones A, B, F",
  },
];

// ---------------------------------------------------------------------------
// Recommandations mockées
// ---------------------------------------------------------------------------

const RECOMMENDATION_CORPUS: Omit<PlanRecommendation, "id">[] = [
  {
    priority: "urgente",
    title: "Élargir le couloir principal à 1,40 m minimum",
    description:
      "Reconfigurer la cloison est de la zone A pour atteindre 1,40 m de largeur libre. Prévoir dépose et reconstruction de la cloison sur environ 12 m linéaires.",
    estimatedCost: { min: 4800, max: 9500, unit: "€" },
    relatedIssueIds: [],
  },
  {
    priority: "urgente",
    title: "Créer un sanitaire PMR au niveau RDC",
    description:
      "Intégrer un WC PMR complet (1,50 m × 2,10 m minimum) à proximité du hall d'accueil. Inclure barre d'appui, lavabo adapté, espace de transfert latéral.",
    estimatedCost: { min: 8000, max: 14000, unit: "€" },
    relatedIssueIds: [],
  },
  {
    priority: "importante",
    title: "Créer ou repositionner une issue de secours",
    description:
      "Ajouter une sortie de secours au fond de la salle principale pour ramener la distance d'évacuation maximale sous 40 m. Prévoir porte coupe-feu CF 30 avec barre anti-panique.",
    estimatedCost: { min: 3500, max: 7000, unit: "€" },
    relatedIssueIds: [],
  },
  {
    priority: "importante",
    title: "Vérifier et corriger la pente de la rampe d'accès",
    description:
      "Lever les cotes de la rampe façade principale. Si pente > 5 %, reprofiler pour atteindre 4 % max ou ajouter palier de repos tous les 10 m.",
    estimatedCost: { min: 2000, max: 5500, unit: "€" },
    relatedIssueIds: [],
  },
  {
    priority: "recommandee",
    title: "Agrandir l'espace de manœuvre devant l'accueil",
    description:
      "Reculer le comptoir d'accueil de 30 cm pour libérer un espace de retournement fauteuil de 1,50 m × 1,50 m conforme.",
    estimatedCost: { min: 1200, max: 3000, unit: "€" },
    relatedIssueIds: [],
  },
];

// ---------------------------------------------------------------------------
// Fonction principale exportée
// ---------------------------------------------------------------------------

/**
 * analyzePlanMock
 *
 * Simule une analyse réglementaire et fonctionnelle d'un plan de bâtiment.
 * Délai artificiel pour reproduire le comportement d'un vrai moteur.
 *
 * @future Remplacé par :
 *   - OCR / vision IA (extraction géométrique)
 *   - Moteur réglementaire paramétré (PMR, ERP, CCH)
 *   - Graph spatial (détection couloirs, portes, pièces)
 *   - Scoring pondéré selon type/catégorie ERP
 */
export async function analyzePlanMock(
  input: PlanAnalysisInput
): Promise<PlanAnalysisResult> {
  const startTime = Date.now();

  // Simulation d'un traitement en plusieurs étapes
  await delay(600);  // Lecture plan
  await delay(800);  // Extraction géométrique
  await delay(900);  // Vérifications réglementaires

  const scores = computeMockScores(input);
  const riskLevel = scoreToRiskLevel(scores.global);

  // Sélection d'issues selon le contexte
  const { building } = input;
  let selectedIssues = [...ISSUE_CORPUS];

  // Si pas d'ERP, on retire certaines issues spécifiques ERP
  if (!building.isErp) {
    selectedIssues = selectedIssues.filter(
      (i) =>
        i.category !== "Sécurité incendie" ||
        i.severity !== "non_conforme"
    );
  }

  // Injecter les IDs
  const issues: PlanIssue[] = selectedIssues.map((issue) => ({
    ...issue,
    id: generateId(),
  }));

  // Lier les recommandations aux issues
  const recommendations: PlanRecommendation[] = RECOMMENDATION_CORPUS.map(
    (rec, idx) => ({
      ...rec,
      id: generateId(),
      relatedIssueIds: issues
        .filter((_, i) => i % (idx + 1) === 0)
        .map((issue) => issue.id),
    })
  );

  const processingTimeMs = Date.now() - startTime;

  return {
    id: generateId(),
    analyzedAt: new Date().toISOString(),
    input,
    complianceScore: scores,
    riskLevel,
    pmrLevel: scoreToComplianceLevel(scores.pmr),
    fireSafetyLevel: scoreToComplianceLevel(scores.fireSafety),
    issues,
    recommendations,
    summary:
      `L'analyse du bâtiment de type « ${building.buildingType} »${
        building.isErp
          ? ` (ERP type ${building.erpType ?? "—"}, catégorie ${
              building.erpCategory ?? "—"
            })`
          : ""
      } révèle un score de conformité global de ${scores.global}/100. ` +
      `${issues.filter((i) => i.severity === "non_conforme").length} points de non-conformité ont été identifiés, ` +
      `${issues.filter((i) => i.severity === "a_verifier").length} points requièrent une vérification complémentaire. ` +
      `${recommendations.filter((r) => r.priority === "urgente").length} recommandations urgentes sont à traiter en priorité.`,
    engineMeta: {
      version: "mock-1.0.0",
      mode: "mock",
      processingTimeMs,
      confidence: null,
    },
  };
}