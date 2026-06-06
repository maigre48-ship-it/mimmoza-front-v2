import { useState, useMemo } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Info,
  ChevronRight,
  ChevronDown,
  Wrench,
  Building2,
  FileWarning,
  ClipboardList,
  BadgeAlert,
  TriangleAlert,
  CircleDashed,
  ArrowRight,
  HelpCircle,
  Calculator,
  Send,
  CheckCheck,
  Banknote,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════
   TYPES MÉTIER
═══════════════════════════════════════════════════════════════ */

type UsageProjet =
  | "logement"
  | "coliving"
  | "location_courte_duree"
  | "commerce"
  | "restaurant"
  | "bureaux"
  | "hotel"
  | "residence_senior"
  | "ehpad"
  | "etablissement_soins"
  | "enseignement"
  | "mixte"
  | "autre";

type ErpQualification = "non_erp" | "erp" | "a_confirmer";

type ErpType = "J" | "M" | "N" | "O" | "P" | "R" | "U" | "W";
type ErpCategory = "1" | "2" | "3" | "4" | "5";

interface ErpContext {
  qualification: ErpQualification | "";
  type: ErpType | "";
  category: ErpCategory | "";
  hasSleeping: boolean;
  hasKitchen: boolean;
  hasCareActivity: boolean;
}

type ComplianceAnswer = "oui" | "non" | "nsp" | "";

type ComplianceStatus =
  | "conforme"
  | "a_verifier"
  | "non_conforme"
  | "non_applicable";

type ComplianceImpact =
  | "bloquant_exploitation"
  | "bloquant_assurance"
  | "risque_juridique"
  | "risque_travaux"
  | "risque_revente"
  | "recommandation";

type CompliancePriority = "haute" | "moyenne" | "faible";

type ProjectDecision = "conforme" | "a_verifier" | "sous_conditions" | "bloquant";

interface AnswerOutcome {
  status: ComplianceStatus;
  impact?: ComplianceImpact;
  constat?: string;
  consequence?: string;
  action?: string;
  priorite?: CompliancePriority;
  lotTravaux?: string;
  coutIndicatif?: string;
}

interface ComplianceControl {
  id: string;
  label: string;
  question: string;
  usages: UsageProjet[];
  group: string;
  requiresErp?: boolean;
  erpTypes?: ErpType[];
  erpCategories?: ErpCategory[];
  condition?: (ctx: { usage: UsageProjet | ""; erp: ErpContext }) => boolean;
  onOui: AnswerOutcome;
  onNon: AnswerOutcome;
  onNsp: AnswerOutcome;
}

interface ComplianceFinding {
  controlId: string;
  label: string;
  answer: ComplianceAnswer;
  status: ComplianceStatus;
  impact?: ComplianceImpact;
  constat?: string;
  consequence?: string;
  action?: string;
  priorite?: CompliancePriority;
  lotTravaux?: string;
  coutIndicatif?: string;
}

interface GeneratedWorkLot {
  nom: string;
  sources: string[];
}

interface LotBudgetEstimate {
  nom: string;
  min: number;
  max: number;
  calcMode: "per_m2" | "flat";
}

interface BudgetEstimation {
  lots: LotBudgetEstimate[];
  totalMin: number;
  totalMax: number;
  surface: number;
  hasPerM2Items: boolean;
}

/* ═══════════════════════════════════════════════════════════════
   DONNÉES : USAGES & ERP
═══════════════════════════════════════════════════════════════ */

const USAGES_OPTIONS: { value: UsageProjet; label: string; desc: string }[] = [
  { value: "logement", label: "Logement", desc: "Résidence principale ou secondaire" },
  { value: "coliving", label: "Coliving", desc: "Cohabitation organisée, chambres meublées" },
  { value: "location_courte_duree", label: "Location courte durée", desc: "Airbnb, Booking, saisonnier" },
  { value: "commerce", label: "Commerce", desc: "Boutique, retail, artisanat" },
  { value: "restaurant", label: "Restaurant", desc: "Restauration, débits de boissons" },
  { value: "bureaux", label: "Bureaux", desc: "Open space, cabinet, coworking" },
  { value: "hotel", label: "Hôtel", desc: "Hébergement touristique" },
  { value: "residence_senior", label: "Résidence senior", desc: "Résidence services, foyer" },
  { value: "ehpad", label: "EHPAD", desc: "Hébergement personnes âgées dépendantes" },
  { value: "etablissement_soins", label: "Établ. de soins", desc: "Clinique, centre médical" },
  { value: "enseignement", label: "Enseignement", desc: "École, centre de formation" },
  { value: "mixte", label: "Mixte", desc: "Combinaison d'usages" },
  { value: "autre", label: "Autre", desc: "Usage non listé ci-dessus" },
];

const ERP_TYPES: { val: ErpType; label: string; hasSleeping?: boolean; hasKitchen?: boolean; hasCareActivity?: boolean }[] = [
  { val: "J", label: "J – Structures personnes âgées / handicapées", hasSleeping: true, hasCareActivity: true },
  { val: "M", label: "M – Magasins, centres commerciaux" },
  { val: "N", label: "N – Restaurants, débits de boissons", hasKitchen: true },
  { val: "O", label: "O – Hôtels, pensions de famille", hasSleeping: true },
  { val: "P", label: "P – Salles de danse, salles de jeux" },
  { val: "R", label: "R – Enseignement, colonies de vacances", hasSleeping: true },
  { val: "U", label: "U – Établissements de soins", hasSleeping: true, hasCareActivity: true },
  { val: "W", label: "W – Administrations, banques, bureaux" },
];

const ERP_CATEGORIES: { val: ErpCategory; label: string; effectif: string; ssiap: string }[] = [
  { val: "1", label: "Catégorie 1", effectif: "> 1 500 personnes", ssiap: "SSIAP 3 obligatoire" },
  { val: "2", label: "Catégorie 2", effectif: "701 à 1 500 personnes", ssiap: "SSIAP 2 obligatoire" },
  { val: "3", label: "Catégorie 3", effectif: "301 à 700 personnes", ssiap: "SSIAP 1 selon type" },
  { val: "4", label: "Catégorie 4", effectif: "jusqu'à 300 personnes", ssiap: "Pas de SSIAP obligatoire" },
  { val: "5", label: "Catégorie 5", effectif: "< seuil minimal (≈ 20)", ssiap: "Régime simplifié" },
];

/* ── Arrays d'usages helper ── */
const ALL_USAGES: UsageProjet[] = [
  "logement", "coliving", "location_courte_duree", "commerce", "restaurant",
  "bureaux", "hotel", "residence_senior", "ehpad", "etablissement_soins",
  "enseignement", "mixte", "autre",
];
const RESIDENTIAL: UsageProjet[] = [
  "logement", "coliving", "location_courte_duree", "residence_senior", "ehpad", "mixte",
];
const ERP_ELIGIBLE: UsageProjet[] = [
  "commerce", "restaurant", "bureaux", "hotel", "residence_senior",
  "ehpad", "etablissement_soins", "enseignement", "mixte", "autre",
];
const NEEDS_FIRE_SAFETY: UsageProjet[] = [
  "coliving", "residence_senior", "ehpad", "etablissement_soins",
  "enseignement", "commerce", "restaurant", "hotel", "mixte", "autre",
];

/* ═══════════════════════════════════════════════════════════════
   INFÉRENCE ERP
═══════════════════════════════════════════════════════════════ */

interface InferredErp {
  qualification: ErpQualification;
  suggestedType: ErpType | "";
  hasSleeping: boolean;
  hasKitchen: boolean;
  hasCareActivity: boolean;
  warning?: string;
}

function inferErpContextFromUsage(usage: UsageProjet): InferredErp {
  switch (usage) {
    case "ehpad":
      return { qualification: "erp", suggestedType: "J", hasSleeping: true, hasKitchen: false, hasCareActivity: true };
    case "etablissement_soins":
      return { qualification: "erp", suggestedType: "U", hasSleeping: true, hasKitchen: false, hasCareActivity: true };
    case "hotel":
      return { qualification: "erp", suggestedType: "O", hasSleeping: true, hasKitchen: false, hasCareActivity: false };
    case "restaurant":
      return { qualification: "erp", suggestedType: "N", hasSleeping: false, hasKitchen: true, hasCareActivity: false };
    case "commerce":
      return { qualification: "erp", suggestedType: "M", hasSleeping: false, hasKitchen: false, hasCareActivity: false };
    case "enseignement":
      return { qualification: "erp", suggestedType: "R", hasSleeping: false, hasKitchen: false, hasCareActivity: false };
    case "residence_senior":
      return {
        qualification: "a_confirmer", suggestedType: "J",
        hasSleeping: true, hasKitchen: false, hasCareActivity: false,
        warning: "Une résidence senior peut relever d'un ERP selon les services proposés (restauration collective, soins, accueil du public), les locaux communs et l'organisation de l'exploitation. À confirmer selon le projet.",
      };
    case "bureaux":
      return {
        qualification: "a_confirmer", suggestedType: "W",
        hasSleeping: false, hasKitchen: false, hasCareActivity: false,
        warning: "Des bureaux ouverts au public (accueil clientèle, guichets, réception) peuvent être qualifiés d'ERP de type W. À confirmer selon la configuration réelle.",
      };
    case "mixte":
    case "autre":
      return {
        qualification: "a_confirmer", suggestedType: "",
        hasSleeping: false, hasKitchen: false, hasCareActivity: false,
        warning: "La qualification ERP dépend de la nature exacte des activités et de l'accueil du public. À confirmer selon le projet avec un professionnel.",
      };
    default:
      return { qualification: "non_erp", suggestedType: "", hasSleeping: false, hasKitchen: false, hasCareActivity: false };
  }
}

/* ═══════════════════════════════════════════════════════════════
   CONTRÔLES DE CONFORMITÉ
═══════════════════════════════════════════════════════════════ */

const CONTROLS: ComplianceControl[] = [
  /* ── DIAGNOSTICS TECHNIQUES ── */
  {
    id: "electricite", label: "Installations électriques",
    question: "Les installations électriques sont-elles conformes (tableau, protections, mise à la terre) ?",
    usages: ALL_USAGES, group: "diagnostics",
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "bloquant_assurance", constat: "Installation électrique non conforme aux normes NF C 15-100.", consequence: "Risque incendie, refus d'assurance habitation, interdiction de mise en location.", action: "Réaliser un diagnostic électrique complet (CONSUEL) et remettre aux normes.", priorite: "haute", lotTravaux: "Électricité", coutIndicatif: "80 à 180 €/m²" },
    onNsp: { status: "a_verifier", impact: "bloquant_assurance", constat: "État des installations électriques inconnu.", consequence: "Risque sécuritaire non évalué. Blocage assurance possible.", action: "Faire réaliser un diagnostic électrique par un professionnel certifié.", priorite: "haute", lotTravaux: "Électricité", coutIndicatif: "80 à 180 €/m² (si remise en conformité)" },
  },
  {
    id: "gaz", label: "Installations gaz",
    question: "Les installations gaz sont-elles conformes et ont-elles fait l'objet d'un diagnostic récent ?",
    usages: [...RESIDENTIAL, "restaurant", "hotel", "etablissement_soins"], group: "diagnostics",
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "bloquant_assurance", constat: "Installation gaz non conforme ou diagnostic absent.", consequence: "Risque explosion / intoxication CO. Refus d'assurance probable.", action: "Diagnostic gaz obligatoire (installations > 15 ans) puis remise aux normes si nécessaire.", priorite: "haute", lotTravaux: "Plomberie / Chauffage", coutIndicatif: "115 à 250 € (diagnostic) + travaux variables" },
    onNsp: { status: "a_verifier", impact: "bloquant_assurance", constat: "État des installations gaz non vérifié.", consequence: "Risque sécuritaire majeur si installation vétuste.", action: "Diagnostic gaz obligatoire pour toute installation de plus de 15 ans.", priorite: "haute", lotTravaux: "Plomberie / Chauffage", coutIndicatif: "115 à 250 € (diagnostic)" },
  },
  {
    id: "dpe", label: "DPE (Diagnostic de Performance Énergétique)",
    question: "Le bien dispose-t-il d'un DPE valide avec une étiquette A à E ?",
    usages: ["logement", "coliving", "location_courte_duree", "residence_senior", "mixte"], group: "diagnostics",
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "bloquant_assurance", constat: "DPE absent ou étiquette F/G (passoire thermique).", consequence: "Interdiction progressive de mise en location (G interdit depuis 2025, F en 2028). Dépréciation à la revente.", action: "Réaliser des travaux d'isolation ou de chauffage pour atteindre a minima l'étiquette E. Commander un DPE.", priorite: "haute", lotTravaux: "Isolation / Thermique", coutIndicatif: "150 à 600 €/m² selon niveau de rénovation" },
    onNsp: { status: "a_verifier", impact: "risque_revente", constat: "DPE non connu ou non réalisé.", consequence: "Impossibilité d'évaluer la conformité locative future.", action: "Commander un DPE auprès d'un diagnostiqueur certifié (100 à 250 €).", priorite: "haute", coutIndicatif: "100 à 250 € (DPE) + rénovation si F/G" },
  },
  {
    id: "amiante", label: "Amiante (bâtiment avant 1997)",
    question: "Le diagnostic amiante a-t-il été réalisé et s'avère-t-il négatif ou sans risque immédiat ?",
    usages: ALL_USAGES, group: "diagnostics",
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "bloquant_exploitation", constat: "Présence d'amiante avérée ou diagnostic absent pour un bâtiment antérieur à 1997.", consequence: "Interdiction de travaux sans désamiantage préalable. Responsabilité pénale engagée.", action: "Réaliser un DTA (Dossier Technique Amiante) puis plan de retrait ou confinement avec entreprise certifiée.", priorite: "haute", lotTravaux: "Désamiantage", coutIndicatif: "5 000 € à plusieurs dizaines de milliers €" },
    onNsp: { status: "a_verifier", impact: "bloquant_exploitation", constat: "Diagnostic amiante non disponible.", consequence: "Blocage potentiel des travaux. Risques sanitaires et juridiques majeurs.", action: "Faire réaliser le DTA avant toute intervention si le bâtiment date d'avant 1997.", priorite: "haute", coutIndicatif: "À prévoir si bâtiment < 1997" },
  },
  {
    id: "plomb", label: "Plomb / CREP",
    question: "Le CREP (Constat de Risque d'Exposition au Plomb) est-il réalisé et négatif ?",
    usages: ["logement", "coliving", "location_courte_duree", "residence_senior", "ehpad", "mixte"], group: "diagnostics",
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "risque_juridique", constat: "Présence de plomb détectée ou CREP absent (obligatoire avant 1949).", consequence: "Obligation de travaux si présence à risque. Responsabilité du bailleur engagée.", action: "Réaliser le CREP auprès d'un diagnostiqueur certifié. Si positif : traitement ou confinement obligatoire.", priorite: "haute", lotTravaux: "Peintures / Revêtements", coutIndicatif: "100 à 220 € (CREP) + travaux selon résultats" },
    onNsp: { status: "a_verifier", impact: "risque_juridique", constat: "CREP non disponible.", consequence: "Obligation légale pour tout bien construit avant 1949.", action: "Commander le CREP à un diagnostiqueur certifié avant travaux.", priorite: "haute", coutIndicatif: "100 à 220 € (CREP)" },
  },
  /* ── ÉTAT DU BIEN ── */
  {
    id: "ventilation", label: "Ventilation / VMC",
    question: "Le bien dispose-t-il d'une ventilation mécanique ou naturelle conforme et fonctionnelle ?",
    usages: ALL_USAGES, group: "etat",
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "risque_travaux", constat: "Absence ou défaillance du système de ventilation.", consequence: "Risque humidité, moisissures, inconfort, non-conformité décence. DPE dégradé.", action: "Installer ou reprendre une VMC simple ou double flux selon les caractéristiques du bien.", priorite: "moyenne", lotTravaux: "Ventilation", coutIndicatif: "2 500 à 8 000 €" },
    onNsp: { status: "a_verifier", impact: "risque_travaux", constat: "Système de ventilation non connu.", consequence: "Risque de non-conformité thermique et sanitaire.", action: "Vérifier la présence et le bon fonctionnement de la ventilation lors de la visite technique.", priorite: "moyenne", lotTravaux: "Ventilation", coutIndicatif: "2 500 à 8 000 € (si installation)" },
  },
  {
    id: "humidite", label: "Humidité / Infiltrations",
    question: "Le bien est-il exempt d'humidité problématique ou d'infiltrations visibles ?",
    usages: ALL_USAGES, group: "etat",
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "risque_travaux", constat: "Présence d'humidité, moisissures ou infiltrations.", consequence: "Non-conformité décence possible. Risque santé. Dépréciation de la valeur du bien.", action: "Diagnostic humidité, traitement des remontées capillaires, reprise d'étanchéité ou isolation.", priorite: "moyenne", lotTravaux: "Gros œuvre / Maçonnerie", coutIndicatif: "3 000 à 25 000 € selon ampleur" },
    onNsp: { status: "a_verifier", impact: "risque_travaux", constat: "Présence d'humidité non vérifiée.", consequence: "Risque de désordres non détectés compromettant la réhabilitation.", action: "Inspection visuelle approfondie et diagnostic humidité si doute.", priorite: "moyenne", coutIndicatif: "À évaluer lors de l'inspection" },
  },
  {
    id: "evacuation", label: "Évacuation des eaux usées",
    question: "Les réseaux d'évacuation (eaux usées et eaux vannes) sont-ils conformes et fonctionnels ?",
    usages: ALL_USAGES, group: "etat",
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "risque_travaux", constat: "Réseau d'évacuation non conforme ou défaillant.", consequence: "Risque remontées, odeurs, dégâts des eaux. Travaux de plomberie importants.", action: "Inspection caméra des réseaux, reprise partielle ou totale si nécessaire.", priorite: "moyenne", lotTravaux: "Plomberie", coutIndicatif: "5 000 à 30 000 € selon ampleur" },
    onNsp: { status: "a_verifier", impact: "risque_travaux", constat: "État des réseaux d'évacuation inconnu.", consequence: "Risque de désordres structurants non détectés.", action: "Faire réaliser une inspection caméra des réseaux existants.", priorite: "moyenne", lotTravaux: "Plomberie", coutIndicatif: "5 000 à 30 000 € (si reprise)" },
  },
  /* ── RÉGLEMENTATION LOCATIVE ── */
  {
    id: "decence", label: "Décence du logement",
    question: "Le logement respecte-t-il les critères de décence (surface, hauteur, sanitaires, sécurité) ?",
    usages: ["logement", "coliving", "location_courte_duree", "residence_senior", "mixte"], group: "locatif",
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "bloquant_assurance", constat: "Le logement ne répond pas aux critères légaux de décence (loi du 6 juillet 1989).", consequence: "Mise en location impossible. Risque de procédure locataire ou administrative.", action: "Mise en conformité décence : surface, hauteur sous plafond, équipements sanitaires, état des installations.", priorite: "haute", lotTravaux: "Gros œuvre / Second œuvre", coutIndicatif: "Variable – de quelques milliers € à réhabilitation complète" },
    onNsp: { status: "a_verifier", impact: "risque_juridique", constat: "La conformité décence n'a pas été vérifiée.", consequence: "Risque de non-location ou de recours locataire post-occupation.", action: "Faire vérifier par un architecte ou diagnostiqueur les critères de décence.", priorite: "haute", coutIndicatif: "À évaluer selon état du bien" },
  },
  {
    id: "surfaces_minimales", label: "Surfaces minimales par unité",
    question: "Chaque unité (chambre, studio) respecte-t-elle les surfaces minimales réglementaires (loi Boutin) ?",
    usages: ["logement", "coliving", "residence_senior", "ehpad"], group: "locatif",
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "risque_juridique", constat: "Une ou plusieurs unités sont en dessous des surfaces minimales réglementaires.", consequence: "Requalification en logement indécent possible. Impossibilité de mise en location.", action: "Reconfigurer le plan ou renoncer aux unités non conformes (min. 9 m² / 20 m³ habitables).", priorite: "haute", lotTravaux: "Cloisonnement / Second œuvre", coutIndicatif: "À chiffrer selon reconfiguration" },
    onNsp: { status: "a_verifier", impact: "risque_juridique", constat: "Surfaces des unités non mesurées (loi Boutin).", consequence: "Risque de non-conformité décence non anticipé.", action: "Mesurer chaque unité et vérifier le respect des seuils légaux avant tout travail de cloisonnement.", priorite: "moyenne", coutIndicatif: "À confirmer après mesurage" },
  },
  /* ── USAGE ET URBANISME ── */
  {
    id: "changement_destination", label: "Changement de destination / usage",
    question: "Le changement de destination envisagé a-t-il reçu les autorisations d'urbanisme nécessaires (PC, DP) ?",
    usages: ALL_USAGES, group: "usage",
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "risque_juridique", constat: "Changement de destination prévu sans autorisation d'urbanisme.", consequence: "Infraction urbanistique. Risque d'astreinte judiciaire ou d'ordre de remise en état.", action: "Déposer un permis de construire ou une déclaration préalable selon les travaux. Consulter le PLU.", priorite: "haute", coutIndicatif: "Honoraires architecte 2 000 à 8 000 € pour le dossier" },
    onNsp: { status: "a_verifier", impact: "risque_juridique", constat: "Situation urbanistique non clarifiée.", consequence: "Risque de non-conformité au PLU découvert après travaux.", action: "Consulter le PLU en mairie et vérifier si une autorisation est requise.", priorite: "haute" },
  },
  {
    id: "autorisation_mairie_lcd", label: "Autorisation de changement d'usage (LCD)",
    question: "L'autorisation de changement d'usage pour la location courte durée a-t-elle été obtenue en mairie ?",
    usages: ["location_courte_duree"], group: "usage",
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "risque_juridique", constat: "Absence d'autorisation de changement d'usage pour la location courte durée.", consequence: "Amende pouvant aller jusqu'à 50 000 € en zone tendue. Obligation de remise en location classique.", action: "Déposer une demande en mairie. Prévoir une compensation si en zone tendue (art. L631-7 CCH).", priorite: "haute", coutIndicatif: "Jusqu'à 50 000 € d'amende si exploitation illégale" },
    onNsp: { status: "a_verifier", impact: "risque_juridique", constat: "Autorisation de changement d'usage non vérifiée.", consequence: "Exploitation potentiellement illégale avec sanctions financières lourdes.", action: "Contacter la Direction du Logement de la mairie pour vérifier les conditions d'autorisation.", priorite: "haute" },
  },
  {
    id: "reglement_copro", label: "Règlement de copropriété",
    question: "Le règlement de copropriété autorise-t-il explicitement l'usage prévu ?",
    usages: ["coliving", "location_courte_duree", "commerce", "restaurant", "mixte"], group: "usage",
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "bloquant_exploitation", constat: "Le règlement de copropriété interdit ou restreint l'usage envisagé.", consequence: "Blocage juridique par le syndicat de copropriété. Procédure possible.", action: "Consulter un avocat spécialisé copropriété. Envisager une modification du règlement en AG.", priorite: "haute", coutIndicatif: "Honoraires avocat 1 500 à 5 000 €+" },
    onNsp: { status: "a_verifier", impact: "risque_juridique", constat: "Règlement de copropriété non consulté.", consequence: "Risque de blocage post-acquisition non anticipé.", action: "Demander le règlement de copropriété et le faire analyser par un juriste avant signature.", priorite: "haute" },
  },
  /* ── SÉCURITÉ ET ACCESSIBILITÉ ── */
  {
    id: "pmr", label: "Accessibilité PMR",
    question: "Le bien est-il conforme aux normes d'accessibilité PMR (rampes, largeurs de passage, sanitaires adaptés) ?",
    usages: ERP_ELIGIBLE, group: "securite",
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "bloquant_exploitation", constat: "Non-conformité aux règles d'accessibilité PMR.", consequence: "Blocage d'exploitation pour ERP et commerces. Mise en demeure administrative possible.", action: "Audit accessibilité complet, travaux de rampe, circulations, sanitaires adaptés. Ad'AP si délais accordés.", priorite: "haute", lotTravaux: "Accessibilité", coutIndicatif: "5 000 à 80 000 €+" },
    onNsp: { status: "a_verifier", impact: "bloquant_exploitation", constat: "Conformité PMR non évaluée.", consequence: "Risque de blocage d'exploitation ou de mise en demeure administrative.", action: "Faire réaliser un audit accessibilité par un bureau de contrôle agréé.", priorite: "haute", lotTravaux: "Accessibilité", coutIndicatif: "5 000 à 80 000 €+ (si mise en conformité)" },
  },
  {
    id: "incendie", label: "Sécurité incendie",
    question: "Le bien est-il conforme à la réglementation incendie (détecteurs, désenfumage, issues, compartimentage) ?",
    usages: NEEDS_FIRE_SAFETY, group: "securite",
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "bloquant_exploitation", constat: "Non-conformité à la réglementation incendie.", consequence: "Blocage d'ouverture pour ERP. Refus d'assurance. Risque pénal pour le gestionnaire.", action: "Faire intervenir un bureau de contrôle incendie spécialisé (SDIS). Travaux de mise en conformité.", priorite: "haute", lotTravaux: "Sécurité incendie", coutIndicatif: "10 000 à 100 000 €+ selon type et surface" },
    onNsp: { status: "a_verifier", impact: "bloquant_exploitation", constat: "Conformité incendie non vérifiée.", consequence: "Risque sécuritaire et blocage d'exploitation non anticipé.", action: "Faire diagnostiquer par un bureau de contrôle ou le SDIS local.", priorite: "haute", lotTravaux: "Sécurité incendie", coutIndicatif: "10 000 à 100 000 €+ (si travaux)" },
  },
  /* ── CONTRÔLES ERP SPÉCIFIQUES ── */
  {
    id: "commission_securite", label: "Commission de sécurité ERP",
    question: "La commission de sécurité a-t-elle rendu un avis favorable pour ce type d'ERP ?",
    usages: ERP_ELIGIBLE, group: "securite", requiresErp: true, erpCategories: ["1", "2", "3", "4"],
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "bloquant_exploitation", constat: "Avis défavorable ou absence de passage en commission de sécurité.", consequence: "Interdiction d'ouverture de l'ERP. Blocage total de l'exploitation.", action: "Réaliser les travaux prescrits, puis solliciter un nouveau passage en commission (Préfecture).", priorite: "haute", lotTravaux: "Sécurité incendie", coutIndicatif: "Variable selon prescriptions" },
    onNsp: { status: "a_verifier", impact: "bloquant_exploitation", constat: "Passage en commission de sécurité non confirmé.", consequence: "Ouverture de l'ERP conditionnée à cet avis préalable obligatoire.", action: "Contacter la Préfecture ou la mairie pour programmer le passage en commission.", priorite: "haute" },
  },
  {
    id: "erp_degagements", label: "Dégagements ERP",
    question: "Les dégagements, issues de secours et cheminements sont-ils adaptés à l'effectif reçu ?",
    usages: ERP_ELIGIBLE, group: "securite", requiresErp: true,
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "bloquant_exploitation", constat: "Les dégagements ne semblent pas adaptés à l'effectif ERP.", consequence: "Avis défavorable possible de la commission de sécurité et blocage d'ouverture.", action: "Vérifier largeur, nombre d'issues, sens d'ouverture et cheminements d'évacuation avec un bureau de contrôle ERP.", priorite: "haute", lotTravaux: "Sécurité incendie", coutIndicatif: "À chiffrer avec un bureau de contrôle ERP" },
    onNsp: { status: "a_verifier", impact: "bloquant_exploitation", constat: "La conformité des dégagements n'est pas vérifiée.", consequence: "Risque de blocage lors de l'autorisation d'ouverture.", action: "Contrôler largeur, nombre d'issues, sens d'ouverture et cheminements d'évacuation.", priorite: "haute", lotTravaux: "Sécurité incendie" },
  },
  {
    id: "erp_service_securite_incendie", label: "Service de sécurité incendie (SSIAP)",
    question: "Un service de sécurité incendie (SSIAP) est-il prévu conformément à la catégorie de l'ERP ?",
    usages: ERP_ELIGIBLE, group: "securite", requiresErp: true, erpCategories: ["1", "2", "3"],
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "bloquant_exploitation", constat: "Absence de service de sécurité incendie conforme à la catégorie de l'ERP.", consequence: "Exploitation non conforme. Refus probable de la commission de sécurité.", action: "Recruter ou externaliser un service SSIAP dimensionné à la catégorie (SSIAP 1 cat.3, SSIAP 2 cat.2, SSIAP 3 cat.1).", priorite: "haute", lotTravaux: "Sécurité incendie", coutIndicatif: "Coût RH annuel selon catégorie" },
    onNsp: { status: "a_verifier", impact: "bloquant_exploitation", constat: "Présence d'un SSIAP non confirmée.", consequence: "Obligation réglementaire pour les catégories 1, 2 et certains ERP de catégorie 3.", action: "Vérifier les obligations SSIAP auprès du SDIS ou d'un bureau de contrôle.", priorite: "haute" },
  },
  {
    id: "erp_registre_securite", label: "Registre de sécurité ERP",
    question: "Le registre de sécurité est-il tenu à jour (vérifications périodiques, formations, exercices) ?",
    usages: ERP_ELIGIBLE, group: "securite", requiresErp: true,
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "risque_juridique", constat: "Registre de sécurité absent ou non tenu à jour.", consequence: "Manquement réglementaire. Responsabilité du gestionnaire engagée en cas d'incident.", action: "Créer ou mettre à jour le registre de sécurité (vérifications électriques, désenfumage, extincteurs, exercices).", priorite: "moyenne", coutIndicatif: "< 500 € (registre + vérifications annuelles)" },
    onNsp: { status: "a_verifier", impact: "risque_juridique", constat: "Existence et conformité du registre de sécurité non vérifiées.", consequence: "Risque de non-conformité documentaire lors d'un contrôle.", action: "Demander le registre de sécurité existant et vérifier sa mise à jour.", priorite: "moyenne" },
  },
  {
    id: "erp_affichage_obligatoire", label: "Affichage réglementaire obligatoire",
    question: "Les affichages obligatoires sont-ils en place (consignes incendie, sorties, capacité, licences…) ?",
    usages: ERP_ELIGIBLE, group: "securite", requiresErp: true,
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "risque_juridique", constat: "Affichages réglementaires absents ou incomplets.", consequence: "Infraction constatée en cas de contrôle. Amende administrative possible.", action: "Mettre en place les affichages obligatoires selon le type d'ERP (plans d'évacuation, consignes, capacité d'accueil, licence).", priorite: "faible", coutIndicatif: "< 500 € (impression et pose)" },
    onNsp: { status: "a_verifier", impact: "recommandation", constat: "Présence des affichages réglementaires non vérifiée.", consequence: "Risque de non-conformité documentaire lors d'un contrôle.", action: "Vérifier la liste des affichages obligatoires selon le type et la catégorie ERP.", priorite: "faible" },
  },
  {
    id: "erp_hebergement_sommeil", label: "Locaux à sommeil",
    question: "Les locaux à sommeil respectent-ils les exigences incendie propres aux hébergements (alarme, compartimentage, désenfumage) ?",
    usages: ERP_ELIGIBLE, group: "securite", requiresErp: true,
    erpTypes: ["J", "O", "R", "U"],
    condition: ({ erp }) => erp.hasSleeping === true,
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "bloquant_exploitation", constat: "Les locaux à sommeil ne sont pas sécurisés selon les exigences ERP.", consequence: "Risque majeur en cas d'incendie nocturne. Blocage probable de l'exploitation.", action: "Vérifier alarme de type 1, compartimentage coupe-feu, désenfumage, évacuation et consignes spécifiques.", priorite: "haute", lotTravaux: "Sécurité incendie", coutIndicatif: "Variable selon configuration" },
    onNsp: { status: "a_verifier", impact: "bloquant_exploitation", constat: "Les exigences liées aux locaux à sommeil n'ont pas été vérifiées.", consequence: "Point sensible pour hôtels, soins, enseignement avec internat ou résidences seniors.", action: "Faire auditer par un bureau de contrôle ERP spécialisé hébergement.", priorite: "haute", lotTravaux: "Sécurité incendie" },
  },
  {
    id: "erp_cuisine_restaurant", label: "Cuisine professionnelle",
    question: "Les équipements de cuisine, extraction, gaz et séparations coupe-feu sont-ils conformes ?",
    usages: ERP_ELIGIBLE, group: "securite", requiresErp: true,
    erpTypes: ["N"],
    condition: ({ erp }) => erp.hasKitchen === true,
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "bloquant_exploitation", constat: "La cuisine professionnelle présente un risque réglementaire.", consequence: "Risque incendie, refus d'assurance ou avis défavorable à l'ouverture.", action: "Contrôler extraction, installation gaz, ventilation, extincteurs type K et séparations coupe-feu obligatoires.", priorite: "haute", lotTravaux: "Cuisine / Extraction", coutIndicatif: "15 000 à 80 000 € selon configuration" },
    onNsp: { status: "a_verifier", impact: "bloquant_assurance", constat: "La conformité de la cuisine professionnelle n'est pas connue.", consequence: "Risque d'exploitation non maîtrisé. Assurance professionnelle potentiellement invalide.", action: "Faire vérifier l'installation par un bureau de contrôle et un installateur qualifié.", priorite: "haute", lotTravaux: "Cuisine / Extraction", coutIndicatif: "15 000 à 80 000 € (si travaux)" },
  },
  {
    id: "erp_soins_specifiques", label: "Locaux de soins et équipements médicaux",
    question: "Les locaux de soins, évacuations médicalisées et équipements spécifiques sont-ils conformes ?",
    usages: ERP_ELIGIBLE, group: "securite", requiresErp: true,
    erpTypes: ["J", "U"],
    condition: ({ erp }) => erp.hasCareActivity === true,
    onOui: { status: "conforme" },
    onNon: { status: "non_conforme", impact: "bloquant_exploitation", constat: "Les locaux ou équipements de soins ne sont pas conformes aux exigences ERP de type J ou U.", consequence: "Refus d'autorisation d'exploitation. Risques sanitaires et sécuritaires pour les résidents.", action: "Audit par un bureau de contrôle ERP spécialisé santé. Travaux (évacuation médicalisée, largeurs, équipements).", priorite: "haute", lotTravaux: "Accessibilité", coutIndicatif: "À chiffrer selon configuration" },
    onNsp: { status: "a_verifier", impact: "bloquant_exploitation", constat: "Conformité des locaux de soins non vérifiée.", consequence: "Point critique pour obtenir l'autorisation d'exploitation d'un établissement de soins ou seniors.", action: "Faire réaliser un audit par un bureau de contrôle spécialisé ERP santé (type J/U).", priorite: "haute", lotTravaux: "Accessibilité" },
  },
];

/* ═══════════════════════════════════════════════════════════════
   GROUPES DE CONTRÔLES
═══════════════════════════════════════════════════════════════ */

const CONTROL_GROUPS: { id: string; label: string; icon: typeof Building2 }[] = [
  { id: "diagnostics", label: "Diagnostics techniques obligatoires", icon: FileWarning },
  { id: "etat", label: "État du bien", icon: Building2 },
  { id: "locatif", label: "Réglementation locative", icon: ClipboardList },
  { id: "usage", label: "Usage et urbanisme", icon: ArrowRight },
  { id: "securite", label: "Sécurité et accessibilité", icon: ShieldCheck },
];

/* ═══════════════════════════════════════════════════════════════
   LOGIQUE MÉTIER
═══════════════════════════════════════════════════════════════ */

function computeFindings(controls: ComplianceControl[], answers: Record<string, ComplianceAnswer>): ComplianceFinding[] {
  return controls.map((ctrl) => {
    const answer = answers[ctrl.id] ?? "";
    const outcome: AnswerOutcome = answer === "oui" ? ctrl.onOui : answer === "non" ? ctrl.onNon : ctrl.onNsp;
    return { controlId: ctrl.id, label: ctrl.label, answer, ...outcome };
  });
}

function computeProjectDecision(findings: ComplianceFinding[]): ProjectDecision {
  if (findings.some((f) => f.status === "non_conforme" && (f.impact === "bloquant_exploitation" || f.impact === "bloquant_assurance"))) return "bloquant";
  if (findings.some((f) => f.status === "non_conforme")) return "sous_conditions";
  if (findings.some((f) => f.status === "a_verifier")) return "a_verifier";
  return "conforme";
}

function computeWorkLots(findings: ComplianceFinding[]): GeneratedWorkLot[] {
  const map = new Map<string, string[]>();
  findings.filter((f) => f.status !== "conforme" && f.lotTravaux).forEach((f) => {
    const lot = f.lotTravaux!;
    if (!map.has(lot)) map.set(lot, []);
    map.get(lot)!.push(f.label);
  });
  return Array.from(map.entries()).map(([nom, sources]) => ({ nom, sources }));
}

/* ═══════════════════════════════════════════════════════════════
   CONFIG UI
═══════════════════════════════════════════════════════════════ */

const STATUS_CONFIG: Record<ComplianceStatus, { label: string; icon: typeof CheckCircle2; badge: string; dot: string }> = {
  conforme: { label: "Conforme", icon: CheckCircle2, badge: "text-emerald-700 bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
  a_verifier: { label: "À vérifier", icon: AlertTriangle, badge: "text-amber-700 bg-amber-50 border-amber-200", dot: "bg-amber-500" },
  non_conforme: { label: "Non conforme", icon: XCircle, badge: "text-red-700 bg-red-50 border-red-200", dot: "bg-red-500" },
  non_applicable: { label: "Non applicable", icon: CircleDashed, badge: "text-slate-500 bg-slate-50 border-slate-200", dot: "bg-slate-300" },
};

const IMPACT_CONFIG: Record<ComplianceImpact, { label: string; color: string }> = {
  bloquant_exploitation: { label: "Bloquant exploitation", color: "text-red-700 bg-red-50 border-red-200" },
  bloquant_assurance: { label: "Bloquant assurance", color: "text-orange-700 bg-orange-50 border-orange-200" },
  risque_juridique: { label: "Risque juridique", color: "text-purple-700 bg-purple-50 border-purple-200" },
  risque_travaux: { label: "Risque travaux", color: "text-blue-700 bg-blue-50 border-blue-200" },
  risque_revente: { label: "Risque revente", color: "text-indigo-700 bg-indigo-50 border-indigo-200" },
  recommandation: { label: "Recommandation", color: "text-slate-600 bg-slate-50 border-slate-200" },
};

const DECISION_CONFIG: Record<ProjectDecision, { label: string; sublabel: string; bg: string; border: string; text: string; icon: typeof CheckCircle2 }> = {
  conforme: { label: "Conforme", sublabel: "Aucun point bloquant identifié. Le projet peut avancer.", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-800", icon: CheckCircle2 },
  a_verifier: { label: "À vérifier", sublabel: "Des points restent à clarifier avant de finaliser le projet.", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", icon: AlertTriangle },
  sous_conditions: { label: "Sous conditions", sublabel: "Des non-conformités corrigeables doivent être traitées avant exploitation.", bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-800", icon: TriangleAlert },
  bloquant: { label: "Bloquant", sublabel: "Un ou plusieurs points majeurs bloquent l'exploitation ou l'assurance du bien.", bg: "bg-red-50", border: "border-red-200", text: "text-red-800", icon: BadgeAlert },
};

const PRIORITY_CONFIG: Record<CompliancePriority, { label: string; color: string }> = {
  haute: { label: "Priorité haute", color: "text-red-600 bg-red-50 border-red-200" },
  moyenne: { label: "Priorité moyenne", color: "text-amber-600 bg-amber-50 border-amber-200" },
  faible: { label: "Priorité faible", color: "text-slate-500 bg-slate-50 border-slate-200" },
};

const selectClass = "w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition";

/* ═══════════════════════════════════════════════════════════════
   SOUS-COMPOSANTS
═══════════════════════════════════════════════════════════════ */

// ── RadioGroup : boutons OUI / NON / NE SAIS PAS + coût indicatif inline ──

function RadioGroup({
  label,
  value,
  onChange,
  coutIndicatif,
}: {
  label: string;
  value: ComplianceAnswer;
  onChange: (v: ComplianceAnswer) => void;
  coutIndicatif?: string;
}) {
  const showCost = coutIndicatif && (value === "non" || value === "nsp");

  return (
    <div className="py-3.5 border-b border-slate-100 last:border-0">
      {/* Ligne question + boutons */}
      <div className="flex items-start justify-between gap-4">
        <span className="text-sm text-slate-700 flex-1 leading-snug pt-0.5">{label}</span>
        <div className="flex gap-2 shrink-0">
          {(["oui", "non", "nsp"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={`px-3.5 py-2 rounded-xl text-[11px] font-bold border transition-all whitespace-nowrap min-w-[52px] ${
                value === v
                  ? v === "oui"
                    ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                    : v === "non"
                    ? "bg-red-500 text-white border-red-500 shadow-sm"
                    : "bg-amber-500 text-white border-amber-500 shadow-sm"
                  : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
              }`}
            >
              {v === "oui" ? "OUI" : v === "non" ? "NON" : "NE SAIS PAS"}
            </button>
          ))}
        </div>
      </div>

      {/* Coût indicatif affiché si réponse NON ou NE SAIS PAS */}
      {showCost && (
        <div className="flex items-center gap-1.5 mt-2 ml-0">
          <Banknote size={12} className="text-orange-500 shrink-0" />
          <span className="text-[11px] text-orange-700 font-medium italic">
            Coût indicatif : {coutIndicatif}
          </span>
        </div>
      )}
    </div>
  );
}

function FindingCard({ finding }: { finding: ComplianceFinding }) {
  const [open, setOpen] = useState(false);
  const cfg = STATUS_CONFIG[finding.status];
  const hasDetail = finding.status !== "conforme" && (finding.constat || finding.consequence || finding.action);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button type="button" onClick={() => hasDetail && setOpen((o) => !o)}
        className={`w-full text-left px-5 py-4 flex items-center gap-3 ${hasDetail ? "hover:bg-slate-50/70 transition-colors" : ""}`}>
        <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
        <span className="text-sm font-medium text-slate-800 flex-1">{finding.label}</span>
        {finding.impact && (
          <span className={`hidden sm:inline text-[10px] font-semibold px-2 py-0.5 rounded-full border ${IMPACT_CONFIG[finding.impact].color}`}>
            {IMPACT_CONFIG[finding.impact].label}
          </span>
        )}
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${cfg.badge}`}>{cfg.label}</span>
        {hasDetail && <ChevronDown size={14} className={`text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && hasDetail && (
        <div className="px-5 pb-4 ml-5 space-y-2.5">
          {finding.impact && <span className={`sm:hidden inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${IMPACT_CONFIG[finding.impact].color}`}>{IMPACT_CONFIG[finding.impact].label}</span>}
          {finding.constat && <div className="text-xs text-slate-600 leading-relaxed"><span className="font-semibold text-slate-700">Constat : </span>{finding.constat}</div>}
          {finding.consequence && <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 leading-relaxed"><span className="font-semibold">Conséquence : </span>{finding.consequence}</div>}
          {finding.action && <div className="text-xs text-slate-700 leading-relaxed"><span className="font-semibold">Action recommandée : </span>{finding.action}</div>}
          <div className="flex flex-wrap gap-2 pt-0.5">
            {finding.priorite && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${PRIORITY_CONFIG[finding.priorite].color}`}>{PRIORITY_CONFIG[finding.priorite].label}</span>}
            {finding.lotTravaux && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border text-slate-600 bg-slate-50 border-slate-200">Lot : {finding.lotTravaux}</span>}
          </div>
          {finding.coutIndicatif && <p className="text-[11px] text-slate-500 italic">Coût indicatif : {finding.coutIndicatif}</p>}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   BUDGET : BARÈMES PAR LOT
═══════════════════════════════════════════════════════════════ */

const LOT_COST_CONFIG: Record<string, { calcMode: "per_m2" | "flat"; minPerM2?: number; maxPerM2?: number; flatMin?: number; flatMax?: number }> = {
  "Électricité":               { calcMode: "per_m2", minPerM2: 80,  maxPerM2: 180 },
  "Ventilation":               { calcMode: "flat",   flatMin: 2500, flatMax: 8000 },
  "Plomberie":                 { calcMode: "per_m2", minPerM2: 40,  maxPerM2: 120 },
  "Plomberie / Chauffage":     { calcMode: "per_m2", minPerM2: 50,  maxPerM2: 150 },
  "Isolation / Thermique":     { calcMode: "per_m2", minPerM2: 150, maxPerM2: 600 },
  "Gros œuvre / Maçonnerie":   { calcMode: "per_m2", minPerM2: 80,  maxPerM2: 250 },
  "Gros œuvre / Second œuvre": { calcMode: "per_m2", minPerM2: 100, maxPerM2: 350 },
  "Cloisonnement / Second œuvre": { calcMode: "per_m2", minPerM2: 80, maxPerM2: 200 },
  "Désamiantage":              { calcMode: "flat",   flatMin: 5000,  flatMax: 50000 },
  "Peintures / Revêtements":   { calcMode: "per_m2", minPerM2: 20,  maxPerM2: 60 },
  "Accessibilité":             { calcMode: "flat",   flatMin: 5000,  flatMax: 80000 },
  "Sécurité incendie":         { calcMode: "flat",   flatMin: 10000, flatMax: 100000 },
  "Cuisine / Extraction":      { calcMode: "flat",   flatMin: 15000, flatMax: 80000 },
};

function formatEur(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} M€`;
  if (n >= 1000) return `${Math.round(n / 1000)} k€`;
  return `${n.toLocaleString("fr-FR")} €`;
}

function computeBudgetEstimation(lots: GeneratedWorkLot[], surface: number): BudgetEstimation {
  const items: LotBudgetEstimate[] = lots.flatMap((lot) => {
    const cfg = LOT_COST_CONFIG[lot.nom];
    if (!cfg) return [];
    if (cfg.calcMode === "per_m2" && surface > 0) {
      return [{ nom: lot.nom, min: cfg.minPerM2! * surface, max: cfg.maxPerM2! * surface, calcMode: "per_m2" }];
    }
    if (cfg.calcMode === "flat") {
      return [{ nom: lot.nom, min: cfg.flatMin!, max: cfg.flatMax!, calcMode: "flat" }];
    }
    return [];
  });
  const totalMin = items.reduce((s, l) => s + l.min, 0);
  const totalMax = items.reduce((s, l) => s + l.max, 0);
  const hasPerM2Items = items.some((l) => l.calcMode === "per_m2");
  return { lots: items, totalMin, totalMax, surface, hasPerM2Items };
}

/* ═══════════════════════════════════════════════════════════════
   PAGE PRINCIPALE
═══════════════════════════════════════════════════════════════ */

const INITIAL_ERP: ErpContext = { qualification: "", type: "", category: "", hasSleeping: false, hasKitchen: false, hasCareActivity: false };

export default function RehabilitationConformitePage() {
  const [usage, setUsage] = useState<UsageProjet | "">("");
  const [erp, setErp] = useState<ErpContext>(INITIAL_ERP);
  const [surface, setSurface] = useState<string>("");
  const [answers, setAnswers] = useState<Record<string, ComplianceAnswer>>({});
  const [findings, setFindings] = useState<ComplianceFinding[] | null>(null);
  const [budgetSaved, setBudgetSaved] = useState(false);

  const inferred = useMemo(() => (usage ? inferErpContextFromUsage(usage as UsageProjet) : null), [usage]);

  const activeControls = useMemo(() => {
    if (!usage) return [];
    return CONTROLS.filter((c) => {
      if (!c.usages.includes(usage as UsageProjet)) return false;
      if (c.requiresErp && erp.qualification !== "erp") return false;
      if (erp.qualification === "erp") {
        if (c.erpTypes?.length && !c.erpTypes.includes(erp.type as ErpType)) return false;
        if (c.erpCategories?.length && !c.erpCategories.includes(erp.category as ErpCategory)) return false;
        if (c.condition && !c.condition({ usage, erp })) return false;
      }
      return true;
    });
  }, [usage, erp]);

  const activeGroups = useMemo(() => {
    const used = new Set(activeControls.map((c) => c.group));
    return CONTROL_GROUPS.filter((g) => used.has(g.id));
  }, [activeControls]);

  const step2Ready = usage !== "";
  const erpContextReady = erp.qualification !== "" && (erp.qualification !== "erp" || (erp.type !== "" && erp.category !== ""));
  const step3Ready = step2Ready && erpContextReady;
  const isComplete = useMemo(
    () => step3Ready && activeControls.length > 0 && activeControls.every((c) => answers[c.id] !== "" && answers[c.id] !== undefined),
    [step3Ready, activeControls, answers]
  );

  function handleUsageChange(val: UsageProjet) {
    setUsage(val);
    const inf = inferErpContextFromUsage(val);
    const found = ERP_TYPES.find((t) => t.val === inf.suggestedType);
    setErp({
      qualification: inf.qualification,
      type: inf.suggestedType,
      category: "",
      hasSleeping: found?.hasSleeping ?? inf.hasSleeping,
      hasKitchen: found?.hasKitchen ?? inf.hasKitchen,
      hasCareActivity: found?.hasCareActivity ?? inf.hasCareActivity,
    });
    setAnswers({});
    setFindings(null);
  }

  function handleQualificationChange(q: ErpQualification) {
    const typeSuggestion = inferred?.suggestedType ?? "";
    const found = ERP_TYPES.find((t) => t.val === typeSuggestion);
    setErp({
      qualification: q,
      type: q !== "non_erp" ? typeSuggestion : "",
      category: "",
      hasSleeping: q !== "non_erp" ? (found?.hasSleeping ?? inferred?.hasSleeping ?? false) : false,
      hasKitchen: q !== "non_erp" ? (found?.hasKitchen ?? inferred?.hasKitchen ?? false) : false,
      hasCareActivity: q !== "non_erp" ? (found?.hasCareActivity ?? inferred?.hasCareActivity ?? false) : false,
    });
    setAnswers({});
    setFindings(null);
  }

  function handleErpTypeChange(type: ErpType | "") {
    const found = ERP_TYPES.find((t) => t.val === type);
    setErp((prev) => ({ ...prev, type, hasSleeping: found?.hasSleeping ?? false, hasKitchen: found?.hasKitchen ?? false, hasCareActivity: found?.hasCareActivity ?? false }));
    setAnswers({});
    setFindings(null);
  }

  function handleErpCategoryChange(category: ErpCategory | "") {
    setErp((prev) => ({ ...prev, category }));
    setAnswers({});
    setFindings(null);
  }

  function handleAnswer(controlId: string, answer: ComplianceAnswer) {
    setAnswers((prev) => ({ ...prev, [controlId]: answer }));
    setFindings(null);
  }

  function handleAnalyze() {
    if (!isComplete) return;
    const computed = computeFindings(activeControls, answers);
    setFindings(computed);
    setTimeout(() => { document.getElementById("conformite-result")?.scrollIntoView({ behavior: "smooth" }); }, 100);
  }

  const decision = useMemo(() => (findings ? computeProjectDecision(findings) : null), [findings]);
  const workLots = useMemo(() => (findings ? computeWorkLots(findings) : []), [findings]);
  const surfaceNum = parseFloat(surface) || 0;
  const budgetEstimation = useMemo(
    () => (findings && workLots.length > 0 ? computeBudgetEstimation(workLots, surfaceNum) : null),
    [findings, workLots, surfaceNum]
  );
  const bloquants = findings?.filter((f) => f.status === "non_conforme" && (f.impact === "bloquant_exploitation" || f.impact === "bloquant_assurance")) ?? [];
  const nonConformes = findings?.filter((f) => f.status === "non_conforme") ?? [];
  const aVerifier = findings?.filter((f) => f.status === "a_verifier") ?? [];
  const conformes = findings?.filter((f) => f.status === "conforme") ?? [];
  const actionsByPriority = useMemo(() => {
    if (!findings) return { haute: [], moyenne: [], faible: [] };
    const actives = findings.filter((f) => f.status !== "conforme" && f.action && f.priorite);
    return { haute: actives.filter((f) => f.priorite === "haute"), moyenne: actives.filter((f) => f.priorite === "moyenne"), faible: actives.filter((f) => f.priorite === "faible") };
  }, [findings]);
  const decisionCfg = decision ? DECISION_CONFIG[decision] : null;

  function handleUseBudget() {
    if (!budgetEstimation) return;
    const payload = {
      source: "conformite_reglementaire",
      date: new Date().toISOString(),
      usage,
      surface: budgetEstimation.surface,
      totalMin: budgetEstimation.totalMin,
      totalMax: budgetEstimation.totalMax,
      lots: budgetEstimation.lots.map((l) => ({ nom: l.nom, min: l.min, max: l.max, calcMode: l.calcMode })),
    };
    try { localStorage.setItem("mimmoza_rehab_budget_import", JSON.stringify(payload)); } catch (_) { /* silent */ }
    setBudgetSaved(true);
    setTimeout(() => setBudgetSaved(false), 3500);
  }

  /* ─────────────────────────────────────────── */

  return (
    <div className="w-full">

      {/* ── BANNIÈRE GRADIENT ── */}
      <div
        className="w-full mb-6"
        style={{
          background: "linear-gradient(135deg, #ea580c 0%, #fb923c 100%)",
          borderRadius: 24,
          padding: "32px 36px",
          boxShadow: "0 8px 32px rgba(234,88,12,0.22)",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
        }}
      >
        <div style={{ position: "relative" }}>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", letterSpacing: 1.8, textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>
            Réhabilitation · Conformité
          </p>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: "#fff", marginBottom: 10, lineHeight: 1.12, letterSpacing: -0.5 }}>
            Conformité réglementaire
          </h1>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", maxWidth: 460, lineHeight: 1.55 }}>
            Analysez les risques et identifiez les actions prioritaires selon l'usage du bien
          </p>
        </div>
        {findings && decision && (
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 12, padding: "8px 14px" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: decision === "conforme" ? "#6ee7b7" : decision === "a_verifier" ? "#fcd34d" : decision === "sous_conditions" ? "#fdba74" : "#fca5a5" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>
              {DECISION_CONFIG[decision].label}
            </span>
          </div>
        )}
      </div>

      {/* ── CONTENU ── */}
      <div className="max-w-3xl mx-auto px-4 sm:px-0 space-y-5">

        {/* ÉTAPE 1 : Usage */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Usage prévu du bien</p>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {USAGES_OPTIONS.map((u) => (
                <button key={u.value} type="button" onClick={() => handleUsageChange(u.value)}
                  className={`text-left p-3 rounded-xl border transition-all text-xs ${usage === u.value ? "bg-orange-50 border-orange-300 ring-1 ring-orange-300" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}>
                  <div className={`font-semibold mb-0.5 ${usage === u.value ? "text-orange-800" : "text-slate-700"}`}>{u.label}</div>
                  <div className="text-slate-400 font-normal leading-tight">{u.desc}</div>
                </button>
              ))}
            </div>

            {/* Surface */}
            <div className="flex items-center gap-3 pt-1 border-t border-slate-100">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
                  <Calculator size={12} className="text-orange-500" />
                  Surface du bien
                  <span className="normal-case font-normal text-slate-400 tracking-normal">(pour estimation budgétaire)</span>
                </label>
                <div className="relative max-w-[200px]">
                  <input
                    type="number" min="0" step="1" placeholder="ex. 120" value={surface}
                    onChange={(e) => setSurface(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 pr-10 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">m²</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ÉTAPE 2 : Qualification réglementaire */}
        {step2Ready && inferred && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Qualification réglementaire</p>
            </div>
            <div className="p-5 space-y-4">
              {inferred.warning && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <HelpCircle size={14} className="text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-700 leading-relaxed">{inferred.warning}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-2.5">Ce projet relève-t-il d'un ERP (Établissement Recevant du Public) ?</p>
                <div className="flex gap-2 flex-wrap">
                  {([
                    { val: "erp" as ErpQualification, label: "Oui — ERP confirmé", activeClass: "bg-red-50 border-red-300 text-red-800 ring-1 ring-red-300" },
                    { val: "non_erp" as ErpQualification, label: "Non — pas d'ERP", activeClass: "bg-emerald-50 border-emerald-300 text-emerald-800 ring-1 ring-emerald-300" },
                    { val: "a_confirmer" as ErpQualification, label: "À confirmer", activeClass: "bg-amber-50 border-amber-300 text-amber-800 ring-1 ring-amber-300" },
                  ] as const).map((opt) => (
                    <button key={opt.val} type="button" onClick={() => handleQualificationChange(opt.val)}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${erp.qualification === opt.val ? opt.activeClass : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {(erp.qualification === "erp" || erp.qualification === "a_confirmer") && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">
                      Type d'ERP {erp.qualification === "erp" && <span className="text-red-400">*</span>}
                    </label>
                    <select value={erp.type} onChange={(e) => handleErpTypeChange(e.target.value as ErpType | "")} className={selectClass}>
                      <option value="">-- Sélectionner le type --</option>
                      {ERP_TYPES.map((t) => <option key={t.val} value={t.val}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">
                      Catégorie ERP {erp.qualification === "erp" && <span className="text-red-400">*</span>}
                    </label>
                    <select value={erp.category} onChange={(e) => handleErpCategoryChange(e.target.value as ErpCategory | "")} className={selectClass}>
                      <option value="">-- Sélectionner la catégorie --</option>
                      {ERP_CATEGORIES.map((c) => <option key={c.val} value={c.val}>{c.label} — {c.effectif}</option>)}
                    </select>
                    {erp.category && <p className="text-[11px] text-slate-400 italic">{ERP_CATEGORIES.find((c) => c.val === erp.category)?.ssiap}</p>}
                  </div>
                </div>
              )}

              {(erp.qualification === "erp" || erp.qualification === "a_confirmer") && erp.type && (erp.hasSleeping || erp.hasKitchen || erp.hasCareActivity) && (
                <div className="flex flex-wrap gap-2">
                  <p className="text-[11px] text-slate-500 w-full">Contrôles spécifiques activés :</p>
                  {erp.hasSleeping && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-blue-50 border-blue-200 text-blue-700">Locaux à sommeil</span>}
                  {erp.hasKitchen && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-orange-50 border-orange-200 text-orange-700">Cuisine professionnelle</span>}
                  {erp.hasCareActivity && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-purple-50 border-purple-200 text-purple-700">Activité de soins</span>}
                </div>
              )}

              {erp.qualification === "non_erp" && (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                  <p className="text-xs text-emerald-700">Ce projet ne relève pas d'un ERP. Les contrôles ERP spécifiques ne s'appliquent pas.</p>
                </div>
              )}

              {erp.qualification === "erp" && (!erp.type || !erp.category) && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <AlertTriangle size={13} className="shrink-0" />
                  Sélectionnez le type et la catégorie ERP pour afficher tous les contrôles adaptés.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ÉTAPE 3 : Points de conformité */}
        {step3Ready && activeControls.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Points de conformité ({activeControls.length} contrôle{activeControls.length > 1 ? "s" : ""})
              </p>
            </div>

            {activeGroups.map((group) => {
              const groupControls = activeControls.filter((c) => c.group === group.id);
              if (groupControls.length === 0) return null;
              const GroupIcon = group.icon;
              return (
                <div key={group.id}>
                  <div className="flex items-center gap-2 px-6 py-2.5 bg-slate-50/80 border-b border-slate-100">
                    <GroupIcon size={13} className="text-slate-400" />
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{group.label}</p>
                  </div>
                  <div className="px-4">
                    {groupControls.map((ctrl) => {
                      // Coût indicatif : NON prioritaire sur NSP
                      const coutIndicatif = ctrl.onNon.coutIndicatif ?? ctrl.onNsp.coutIndicatif;
                      return (
                        <RadioGroup
                          key={ctrl.id}
                          label={ctrl.question}
                          value={answers[ctrl.id] ?? ""}
                          onChange={(v) => handleAnswer(ctrl.id, v)}
                          coutIndicatif={coutIndicatif}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="p-5 border-t border-slate-100">
              {!isComplete && <p className="text-xs text-slate-400 text-center mb-3">Répondez à tous les contrôles pour générer l'analyse</p>}
              <button type="button" onClick={handleAnalyze} disabled={!isComplete}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
                style={{ background: "linear-gradient(90deg, #f97316 0%, #ef4444 100%)" }}>
                <ShieldCheck size={16} />
                Analyser la conformité
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* RÉSULTATS */}
        {findings && decision && decisionCfg && (
          <div id="conformite-result" className="space-y-5">

            {/* Décision projet */}
            <div className={`rounded-2xl border-2 p-5 ${decisionCfg.bg} ${decisionCfg.border}`}>
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${decisionCfg.bg} border ${decisionCfg.border}`}>
                  {(() => { const DecIcon = decisionCfg.icon; return <DecIcon size={18} className={decisionCfg.text} />; })()}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-[11px] font-bold uppercase tracking-widest ${decisionCfg.text} opacity-70`}>Décision projet</span>
                    <span className={`text-base font-bold ${decisionCfg.text}`}>{decisionCfg.label}</span>
                  </div>
                  <p className={`text-sm ${decisionCfg.text} opacity-80`}>{decisionCfg.sublabel}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                {[
                  { n: bloquants.length, label: "Bloquant", color: "text-red-700", bg: "bg-red-50 border-red-200" },
                  { n: nonConformes.length - bloquants.length, label: "Non conforme", color: "text-orange-700", bg: "bg-orange-50 border-orange-200" },
                  { n: aVerifier.length, label: "À vérifier", color: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
                  { n: conformes.length, label: "Conforme", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
                ].map((s) => (
                  <div key={s.label} className={`rounded-xl border px-3 py-2.5 text-center ${s.bg}`}>
                    <div className={`text-xl font-bold ${s.color}`}>{s.n}</div>
                    <div className={`text-[10px] font-semibold ${s.color} opacity-80 mt-0.5`}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions recommandées */}
            {(actionsByPriority.haute.length > 0 || actionsByPriority.moyenne.length > 0 || actionsByPriority.faible.length > 0) && (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                  <Wrench size={15} className="text-slate-400" />
                  <h2 className="text-sm font-bold text-slate-800">Actions recommandées</h2>
                </div>
                {(["haute", "moyenne", "faible"] as CompliancePriority[]).map((p) => {
                  const items = actionsByPriority[p];
                  if (items.length === 0) return null;
                  const pcfg = PRIORITY_CONFIG[p];
                  return (
                    <div key={p} className="px-5 py-4 border-b border-slate-100 last:border-0">
                      <div className="flex items-center gap-2 mb-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${pcfg.color}`}>{pcfg.label}</span>
                      </div>
                      <div className="space-y-2.5">
                        {items.map((f, i) => (
                          <div key={f.controlId} className="flex gap-2.5">
                            <span className="text-xs font-bold text-slate-400 w-4 shrink-0 pt-0.5">{i + 1}.</span>
                            <div className="flex-1">
                              <p className="text-xs font-semibold text-slate-700">{f.label}</p>
                              {f.action && <p className="text-xs text-slate-500 leading-relaxed mt-0.5">{f.action}</p>}
                              {f.coutIndicatif && (
                                <div className="flex items-center gap-1 mt-1">
                                  <Banknote size={11} className="text-orange-500 shrink-0" />
                                  <p className="text-[11px] text-orange-700 font-medium italic">{f.coutIndicatif}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Points de conformité */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <ClipboardList size={15} className="text-slate-400" />
                <h2 className="text-sm font-bold text-slate-800">Points de conformité</h2>
                <span className="text-xs text-slate-400 ml-auto">Cliquer pour voir le détail</span>
              </div>
              <div>{findings.map((f) => <FindingCard key={f.controlId} finding={f} />)}</div>
            </div>

            {/* Lots travaux */}
            {workLots.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                  <Wrench size={15} className="text-slate-400" />
                  <h2 className="text-sm font-bold text-slate-800">Lots travaux générés</h2>
                  <span className="text-xs text-slate-400">({workLots.length} lot{workLots.length > 1 ? "s" : ""})</span>
                </div>
                <div className="p-5 flex flex-wrap gap-3">
                  {workLots.map((lot) => (
                    <div key={lot.nom} className="border border-orange-200 bg-orange-50 rounded-xl px-3 py-2.5 min-w-[120px]">
                      <div className="text-xs font-bold text-orange-800 flex items-center gap-1.5 mb-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                        {lot.nom}
                      </div>
                      <div className="text-[10px] text-orange-600 space-y-0.5">{lot.sources.map((s) => <div key={s}>— {s}</div>)}</div>
                    </div>
                  ))}
                </div>
                <div className="px-5 pb-4">
                  <p className="text-[11px] text-slate-400 italic">Ces lots sont générés à titre indicatif et peuvent servir de base pour l'estimation budgétaire.</p>
                </div>
              </div>
            )}

            {/* Estimation budgétaire */}
            {budgetEstimation && budgetEstimation.lots.length > 0 && (
              <div className="bg-white border-2 border-orange-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-orange-100 bg-orange-50/60 flex items-center gap-2">
                  <Calculator size={15} className="text-orange-600" />
                  <h2 className="text-sm font-bold text-orange-900">Estimation budgétaire</h2>
                  {surfaceNum > 0 && <span className="ml-auto text-[11px] text-orange-600 font-medium">{surfaceNum} m²</span>}
                </div>
                <div className="divide-y divide-slate-100">
                  {budgetEstimation.lots.map((lot) => (
                    <div key={lot.nom} className="flex items-center justify-between px-5 py-3 gap-4">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                        <span className="text-xs text-slate-700 font-medium">{lot.nom}</span>
                        {lot.calcMode === "per_m2" && surfaceNum > 0 && (
                          <span className="text-[10px] text-slate-400 italic hidden sm:inline">
                            ({LOT_COST_CONFIG[lot.nom]?.minPerM2}–{LOT_COST_CONFIG[lot.nom]?.maxPerM2} €/m²)
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-semibold text-slate-600 shrink-0 tabular-nums">
                        {formatEur(lot.min)} – {formatEur(lot.max)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-4 bg-orange-50 border-t border-orange-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">Total estimé</span>
                    <div className="text-right">
                      <p className="text-lg font-bold text-orange-800 tabular-nums">
                        {formatEur(budgetEstimation.totalMin)} – {formatEur(budgetEstimation.totalMax)}
                      </p>
                      {budgetEstimation.hasPerM2Items && surfaceNum > 0 && (
                        <p className="text-[11px] text-orange-600">
                          soit {Math.round(budgetEstimation.totalMin / surfaceNum)}–{Math.round(budgetEstimation.totalMax / surfaceNum)} €/m²
                        </p>
                      )}
                    </div>
                  </div>
                  {budgetEstimation.hasPerM2Items && surfaceNum === 0 && (
                    <p className="text-[11px] text-orange-700 bg-orange-100 border border-orange-200 rounded-lg px-3 py-2">
                      Certains lots sont calculés au m². Renseignez la surface en étape 1 pour affiner l'estimation.
                    </p>
                  )}
                  <p className="text-[11px] text-orange-700/70 italic">
                    Montants indicatifs TTC hors honoraires et imprévus. À confirmer par des devis professionnels.
                  </p>
                  <button
                    type="button" onClick={handleUseBudget}
                    className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all shadow-sm ${
                      budgetSaved ? "bg-emerald-600 text-white" : "text-white"
                    }`}
                    style={budgetSaved ? {} : { background: "linear-gradient(90deg, #f97316 0%, #ef4444 100%)" }}
                  >
                    {budgetSaved ? (
                      <><CheckCheck size={16} />Montant envoyé vers Budget Travaux</>
                    ) : (
                      <><Send size={15} />Utiliser ce montant dans Budget Travaux</>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Disclaimer */}
            <div className="flex items-start gap-2.5 bg-orange-50 border border-orange-200 rounded-xl p-4">
              <Info size={15} className="text-orange-600 mt-0.5 shrink-0" />
              <p className="text-xs text-orange-700 leading-relaxed">
                <strong>Cette analyse ne remplace pas un diagnostic réglementaire réalisé par un professionnel qualifié.</strong>{" "}
                Elle constitue une première orientation indicative. Les coûts affichés sont purement indicatifs.
                Consultez un architecte, un bureau de contrôle, le SDIS, la DREAL ou tout professionnel compétent
                avant toute décision d'investissement ou d'exploitation.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}