// src/spaces/marchand/questionnaire/questionnaireSchema.ts


// ─── Schema types ────────────────────────────────────────────────────

export type FieldType = "text" | "number" | "select" | "textarea";
export type Priority = "critical" | "important" | "secondary";
export type QuestionnaireMode = "fast" | "deep";
export type ValidationSeverity = "info" | "warning" | "blocking";

export interface QuestionOption {
  value: string;
  label: string;
}

export interface QuestionDef {
  id: string;
  /** Dot path into snapshot: "propertyDraft.address" or "assumptions.strategie" */
  path: string;
  label: string;
  placeholder?: string;
  type: FieldType;
  options?: QuestionOption[];
  unit?: string;
  required?: boolean;
  /** Priority level for Fast/Deep mode filtering */
  priority: Priority;
  /** Weight impact for sorting (0–100, higher = shown first) */
  weightImpact: number;
  /** Show only when these conditions are met (AND logic) */
  showWhen?: {
    field: string;
    oneOf: string[];
  }[];
}

export interface QuestionSection {
  id: string;
  title: string;
  icon: string;
  stepIndex: number; // 0=Bien, 1=Projet, 2=Hypothèses
  questions: QuestionDef[];
}

export interface ValidationWarning {
  key: string;
  label: string;
  message: string;
  severity: ValidationSeverity;
  /** Which field(s) are concerned */
  relatedFields: string[];
}

// ─── Schema ──────────────────────────────────────────────────────────

export const STEP_LABELS = ["Bien", "Projet", "Hypothèses", "Résultat"] as const;

export const questionnaireSchema: QuestionSection[] = [
  // ── STEP 0: Le Bien ──
  {
    id: "localisation",
    title: "Localisation",
    icon: "📍",
    stepIndex: 0,
    questions: [
      {
        id: "address",
        path: "propertyDraft.address",
        label: "Adresse du bien",
        placeholder: "12 rue de la Paix, 75002 Paris",
        type: "text",
        required: true,
        priority: "critical",
        weightImpact: 95,
      },
      {
        id: "city",
        path: "propertyDraft.city",
        label: "Ville",
        placeholder: "Paris",
        type: "text",
        priority: "important",
        weightImpact: 60,
      },
      {
        id: "zipCode",
        path: "propertyDraft.zipCode",
        label: "Code postal",
        placeholder: "75002",
        type: "text",
        priority: "important",
        weightImpact: 55,
      },
      {
        id: "lat",
        path: "propertyDraft.lat",
        label: "Latitude",
        placeholder: "48.8566",
        type: "number",
        priority: "secondary",
        weightImpact: 15,
      },
      {
        id: "lng",
        path: "propertyDraft.lng",
        label: "Longitude",
        placeholder: "2.3522",
        type: "number",
        priority: "secondary",
        weightImpact: 15,
      },
    ],
  },
  {
    id: "description_bien",
    title: "Description du bien",
    icon: "🏠",
    stepIndex: 0,
    questions: [
      {
        id: "propertyType",
        path: "propertyDraft.propertyType",
        label: "Type de bien",
        type: "select",
        required: true,
        priority: "critical",
        weightImpact: 90,
        options: [
          { value: "appartement", label: "Appartement" },
          { value: "maison", label: "Maison" },
          { value: "terrain", label: "Terrain" },
          { value: "immeuble", label: "Immeuble" },
          { value: "local", label: "Local commercial" },
        ],
      },
      {
        id: "surfaceHabitable",
        path: "propertyDraft.surfaceHabitable",
        label: "Surface habitable",
        placeholder: "65",
        type: "number",
        unit: "m²",
        required: true,
        priority: "critical",
        weightImpact: 88,
      },
      {
        id: "rooms",
        path: "propertyDraft.rooms",
        label: "Nombre de pièces",
        placeholder: "3",
        type: "number",
        priority: "important",
        weightImpact: 40,
        showWhen: [
          {
            field: "propertyDraft.propertyType",
            oneOf: ["appartement", "maison", "immeuble"],
          },
        ],
      },
      {
        id: "condition",
        path: "propertyDraft.condition",
        label: "État du bien",
        type: "select",
        priority: "important",
        weightImpact: 70,
        options: [
          { value: "neuf", label: "Neuf / Récent" },
          { value: "bon", label: "Bon état" },
          { value: "a_renover", label: "À rénover" },
          { value: "a_rehabiliter", label: "À réhabiliter" },
        ],
        showWhen: [
          {
            field: "propertyDraft.propertyType",
            oneOf: ["appartement", "maison", "immeuble", "local"],
          },
        ],
      },
      {
        id: "dpe",
        path: "propertyDraft.dpe",
        label: "DPE",
        type: "select",
        priority: "important",
        weightImpact: 65,
        options: [
          { value: "A", label: "A" },
          { value: "B", label: "B" },
          { value: "C", label: "C" },
          { value: "D", label: "D" },
          { value: "E", label: "E" },
          { value: "F", label: "F" },
          { value: "G", label: "G" },
          { value: "NC", label: "Non communiqué" },
        ],
        showWhen: [
          {
            field: "propertyDraft.propertyType",
            oneOf: ["appartement", "maison", "immeuble", "local"],
          },
        ],
      },
    ],
  },
  {
    id: "financier_bien",
    title: "Données financières du bien",
    icon: "💰",
    stepIndex: 0,
    questions: [
      {
        id: "priceAsked",
        path: "propertyDraft.priceAsked",
        label: "Prix demandé",
        placeholder: "250000",
        type: "number",
        unit: "€",
        required: true,
        priority: "critical",
        weightImpact: 92,
      },
      {
        id: "chargesMensuelles",
        path: "propertyDraft.chargesMensuelles",
        label: "Charges mensuelles",
        placeholder: "150",
        type: "number",
        unit: "€/mois",
        priority: "important",
        weightImpact: 45,
      },
      {
        id: "taxeFonciere",
        path: "propertyDraft.taxeFonciere",
        label: "Taxe foncière",
        placeholder: "1200",
        type: "number",
        unit: "€/an",
        priority: "important",
        weightImpact: 42,
      },
    ],
  },
  {
    id: "annonce",
    title: "Texte d'annonce (optionnel)",
    icon: "📋",
    stepIndex: 0,
    questions: [
      {
        id: "rawAdText",
        path: "propertyDraft.rawAdText",
        label: "Coller le texte de l'annonce",
        placeholder: "Collez ici le texte complet de l'annonce immobilière…",
        type: "textarea",
        priority: "secondary",
        weightImpact: 10,
      },
    ],
  },

  // ── STEP 1: Projet ──
  {
    id: "strategie",
    title: "Stratégie d'investissement",
    icon: "🎯",
    stepIndex: 1,
    questions: [
      {
        id: "strategie",
        path: "assumptions.strategie",
        label: "Stratégie visée",
        type: "select",
        required: true,
        priority: "critical",
        weightImpact: 95,
        options: [
          { value: "location", label: "Location (rendement)" },
          { value: "revente", label: "Revente (plus-value)" },
          { value: "patrimonial", label: "Patrimonial (mixte)" },
        ],
      },
      {
        id: "horizonMois",
        path: "assumptions.horizonMois",
        label: "Horizon d'investissement",
        placeholder: "60",
        type: "number",
        unit: "mois",
        priority: "important",
        weightImpact: 55,
      },
      {
        id: "loyerMensuelCible",
        path: "assumptions.loyerMensuelCible",
        label: "Loyer mensuel cible",
        placeholder: "850",
        type: "number",
        unit: "€/mois",
        priority: "critical",
        weightImpact: 85,
        showWhen: [
          { field: "assumptions.strategie", oneOf: ["location", "patrimonial"] },
        ],
      },
      // ── Dynamic: Revente → Marge cible ──
      {
        id: "margeCiblePct",
        path: "assumptions.margeCiblePct",
        label: "Marge nette cible (revente)",
        placeholder: "20",
        type: "number",
        unit: "%",
        priority: "critical",
        weightImpact: 85,
        showWhen: [{ field: "assumptions.strategie", oneOf: ["revente"] }],
      },
      {
        id: "prixReventeCible",
        path: "assumptions.prixReventeCible",
        label: "Prix de revente estimé",
        placeholder: "320000",
        type: "number",
        unit: "€",
        priority: "important",
        weightImpact: 75,
        showWhen: [{ field: "assumptions.strategie", oneOf: ["revente"] }],
      },
    ],
  },

  // ── STEP 2: Hypothèses ──
  {
    id: "travaux",
    title: "Travaux",
    icon: "🔨",
    stepIndex: 2,
    questions: [
      {
        id: "travauxBudget",
        path: "assumptions.travauxBudget",
        label: "Budget travaux estimé",
        placeholder: "30000",
        type: "number",
        unit: "€",
        priority: "important",
        weightImpact: 70,
      },
      // ── Dynamic: condition a_renover / a_rehabiliter → sous-section travaux ──
      {
        id: "travauxDetailNature",
        path: "assumptions.travauxDetailNature",
        label: "Nature des travaux",
        type: "select",
        priority: "important",
        weightImpact: 65,
        options: [
          { value: "rafraichissement", label: "Rafraîchissement" },
          { value: "renovation_partielle", label: "Rénovation partielle" },
          { value: "renovation_complete", label: "Rénovation complète" },
          { value: "rehabilitation", label: "Réhabilitation lourde" },
        ],
        showWhen: [
          {
            field: "propertyDraft.condition",
            oneOf: ["a_renover", "a_rehabiliter"],
          },
        ],
      },
      {
        id: "travauxDureeMois",
        path: "assumptions.travauxDureeMois",
        label: "Durée estimée des travaux",
        placeholder: "6",
        type: "number",
        unit: "mois",
        priority: "secondary",
        weightImpact: 35,
        showWhen: [
          {
            field: "propertyDraft.condition",
            oneOf: ["a_renover", "a_rehabiliter"],
          },
        ],
      },
    ],
  },
  // ── Dynamic: DPE F/G → Audit énergétique ──
  {
    id: "audit_energetique",
    title: "Audit énergétique",
    icon: "⚡",
    stepIndex: 2,
    questions: [
      {
        id: "auditEnergetiquePrevu",
        path: "assumptions.auditEnergetiquePrevu",
        label: "Audit énergétique prévu ?",
        type: "select",
        priority: "important",
        weightImpact: 72,
        options: [
          { value: "oui", label: "Oui" },
          { value: "non", label: "Non" },
          { value: "fait", label: "Déjà réalisé" },
        ],
        showWhen: [{ field: "propertyDraft.dpe", oneOf: ["F", "G"] }],
      },
      {
        id: "budgetRenovationEnergetique",
        path: "assumptions.budgetRenovationEnergetique",
        label: "Budget rénovation énergétique",
        placeholder: "15000",
        type: "number",
        unit: "€",
        priority: "important",
        weightImpact: 68,
        showWhen: [{ field: "propertyDraft.dpe", oneOf: ["F", "G"] }],
      },
    ],
  },
  {
    id: "financement",
    title: "Financement",
    icon: "🏦",
    stepIndex: 2,
    questions: [
      {
        id: "financement",
        path: "assumptions.financement",
        label: "Mode de financement",
        type: "select",
        priority: "critical",
        weightImpact: 80,
        options: [
          { value: "cash", label: "Cash (fonds propres)" },
          { value: "credit", label: "Crédit immobilier" },
        ],
      },
      {
        id: "apport",
        path: "assumptions.apport",
        label: "Apport personnel",
        placeholder: "50000",
        type: "number",
        unit: "€",
        priority: "important",
        weightImpact: 60,
      },
      // ── Dynamic: financement = credit → section crédit ──
      {
        id: "tauxCredit",
        path: "assumptions.tauxCredit",
        label: "Taux de crédit",
        placeholder: "3.5",
        type: "number",
        unit: "%",
        priority: "critical",
        weightImpact: 78,
        showWhen: [{ field: "assumptions.financement", oneOf: ["credit"] }],
      },
      {
        id: "dureeMois",
        path: "assumptions.dureeMois",
        label: "Durée du crédit",
        placeholder: "240",
        type: "number",
        unit: "mois",
        priority: "critical",
        weightImpact: 76,
        showWhen: [{ field: "assumptions.financement", oneOf: ["credit"] }],
      },
      {
        id: "assuranceCredit",
        path: "assumptions.assuranceCredit",
        label: "Taux assurance crédit",
        placeholder: "0.34",
        type: "number",
        unit: "%",
        priority: "secondary",
        weightImpact: 30,
        showWhen: [{ field: "assumptions.financement", oneOf: ["credit"] }],
      },
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────

/** Get a nested value from snapshot using dot path */
export function getNestedValue(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

/** Set a nested value on a shallow-cloned snapshot */
export function setNestedValue(obj: any, path: string, value: any): any {
  const keys = path.split(".");
  const result = { ...obj };
  let current: any = result;

  for (let i = 0; i < keys.length - 1; i++) {
    current[keys[i]] = { ...current[keys[i]] };
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
  return result;
}

/** Check if a question should be visible given current snapshot */
export function isQuestionVisible(q: QuestionDef, snapshot: any): boolean {
  if (!q.showWhen || q.showWhen.length === 0) return true;
  return q.showWhen.every((cond) => {
    const val = getNestedValue(snapshot, cond.field);
    return val !== undefined && cond.oneOf.includes(String(val));
  });
}

/** Filter questions by mode: fast = critical only, deep = all */
export function filterByMode(
  questions: QuestionDef[],
  mode: QuestionnaireMode
): QuestionDef[] {
  if (mode === "fast") {
    return questions.filter((q) => q.priority === "critical");
  }
  return questions;
}

/** Count missing required fields for a given step */
export function countMissingForStep(
  stepIndex: number,
  snapshot: any,
  mode: QuestionnaireMode = "deep"
): number {
  let missing = 0;
  for (const section of questionnaireSchema) {
    if (section.stepIndex !== stepIndex) continue;
    for (const q of section.questions) {
      if (!q.required) continue;
      if (!isQuestionVisible(q, snapshot)) continue;
      if (mode === "fast" && q.priority !== "critical") continue;
      const val = getNestedValue(snapshot, q.path);
      if (val === undefined || val === null || val === "") missing++;
    }
  }
  return missing;
}

// ─── Validation Rules ────────────────────────────────────────────────

export function validateSnapshot(snapshot: any): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const d = snapshot.propertyDraft;
  const a = snapshot.assumptions;

  // Surface < 15 m²
  if (d.surfaceHabitable != null && d.surfaceHabitable > 0 && d.surfaceHabitable < 15) {
    warnings.push({
      key: "surface_trop_petite",
      label: "Surface très faible",
      message: `Surface de ${d.surfaceHabitable} m² — inhabituellement petite. Vérifiez la saisie.`,
      severity: "warning",
      relatedFields: ["propertyDraft.surfaceHabitable"],
    });
  }

  // Prix/m² incohérent (> 15 000 €/m²)
  if (
    d.priceAsked > 0 &&
    d.surfaceHabitable > 0
  ) {
    const prixM2 = d.priceAsked / d.surfaceHabitable;
    if (prixM2 > 15000) {
      warnings.push({
        key: "prix_m2_eleve",
        label: "Prix/m² très élevé",
        message: `${Math.round(prixM2).toLocaleString("fr-FR")} €/m² — au-dessus du seuil de cohérence (15 000 €/m²). Vérifiez prix ou surface.`,
        severity: "warning",
        relatedFields: ["propertyDraft.priceAsked", "propertyDraft.surfaceHabitable"],
      });
    }
  }

  // Loyer cible trop élevé vs marché enrichi
  if (
    a.loyerMensuelCible > 0 &&
    snapshot.enriched?.market?.loyerM2Median &&
    d.surfaceHabitable > 0
  ) {
    const loyerMarcheEstime =
      snapshot.enriched.market.loyerM2Median * d.surfaceHabitable;
    const ratio = a.loyerMensuelCible / loyerMarcheEstime;
    if (ratio > 1.5) {
      warnings.push({
        key: "loyer_trop_eleve",
        label: "Loyer cible élevé",
        message: `Loyer cible de ${a.loyerMensuelCible} €/mois — supérieur à 150% du marché estimé (${Math.round(loyerMarcheEstime)} €/mois). Risque de vacance locative.`,
        severity: "warning",
        relatedFields: ["assumptions.loyerMensuelCible"],
      });
    }
  }

  // Travaux trop faibles si état lourd
  if (
    (d.condition === "a_rehabiliter" || d.condition === "a_renover") &&
    d.priceAsked > 0
  ) {
    const travauxBudget = a.travauxBudget ?? 0;
    const ratio = travauxBudget / d.priceAsked;

    if (d.condition === "a_rehabiliter" && ratio < 0.15) {
      warnings.push({
        key: "travaux_insuffisants_rehab",
        label: "Budget travaux faible",
        message: `Bien à réhabiliter mais budget travaux = ${travauxBudget.toLocaleString("fr-FR")} € (${(ratio * 100).toFixed(1)}% du prix). Un budget ≥15% est recommandé.`,
        severity: "warning",
        relatedFields: ["assumptions.travauxBudget", "propertyDraft.condition"],
      });
    } else if (d.condition === "a_renover" && ratio < 0.05) {
      warnings.push({
        key: "travaux_insuffisants_renov",
        label: "Budget travaux faible",
        message: `Bien à rénover mais budget travaux = ${travauxBudget.toLocaleString("fr-FR")} € (${(ratio * 100).toFixed(1)}% du prix). Un budget ≥5% est recommandé.`,
        severity: "info",
        relatedFields: ["assumptions.travauxBudget", "propertyDraft.condition"],
      });
    }
  }

  // DPE F/G sans audit prévu
  if (
    (d.dpe === "F" || d.dpe === "G") &&
    a.auditEnergetiquePrevu !== "oui" &&
    a.auditEnergetiquePrevu !== "fait"
  ) {
    warnings.push({
      key: "dpe_passoire_sans_audit",
      label: "Passoire énergétique",
      message: `DPE ${d.dpe} — un audit énergétique est fortement recommandé (obligation légale pour vente depuis 2023).`,
      severity: "info",
      relatedFields: ["propertyDraft.dpe", "assumptions.auditEnergetiquePrevu"],
    });
  }

  // Revente sans marge cible
  if (a.strategie === "revente" && !a.margeCiblePct && !a.prixReventeCible) {
    warnings.push({
      key: "revente_sans_objectif",
      label: "Objectif revente manquant",
      message:
        "Stratégie revente sélectionnée mais ni marge cible ni prix de revente estimé renseigné.",
      severity: "info",
      relatedFields: ["assumptions.margeCiblePct", "assumptions.prixReventeCible"],
    });
  }

  // Crédit sans taux ou durée
  if (a.financement === "credit") {
    if (!a.tauxCredit) {
      warnings.push({
        key: "credit_sans_taux",
        label: "Taux de crédit manquant",
        message: "Financement par crédit sélectionné mais taux non renseigné.",
        severity: "blocking",
        relatedFields: ["assumptions.tauxCredit"],
      });
    }
    if (!a.dureeMois) {
      warnings.push({
        key: "credit_sans_duree",
        label: "Durée de crédit manquante",
        message: "Financement par crédit sélectionné mais durée non renseignée.",
        severity: "blocking",
        relatedFields: ["assumptions.dureeMois"],
      });
    }
  }

  return warnings;
}