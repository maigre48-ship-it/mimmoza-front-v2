// src/spaces/rehabilitation/pages/AuditPage.tsx
// Onglet central "Audit de réhabilitation" — remplace Diagnostic + Travaux
// Workflow : Vue d'ensemble → Conformité → Analyse du plan → Budget → Synthèse

import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  BadgeEuro,
  Building2,
  Calculator,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardCheck,
  DoorOpen,
  FileText,
  Flame,
  Hammer,
  Info,
  Layers,
  LayoutDashboard,
  MapPin,
  Ruler,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  SquareCheckBig,
  TrendingUp,
  Upload,
  Users,
  XCircle
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type AuditTab = "overview" | "conformite" | "analyse-plan" | "budget" | "synthese";
type ComplianceStatus = "ok" | "attention" | "bloquant" | "non-verifie";
type DestinationType = "" | "habitation" | "bureaux" | "commerce" | "erp" | "mixte";

interface ComplianceItem {
  id: string;
  label: string;
  description: string;
  status: ComplianceStatus;
  note: string;
  category: string;
}

interface BudgetPoste {
  id: string;
  label: string;
  category: string;
  prixUnitaire: number;
  quantite: number;
  montant: number;
  enabled: boolean;
}

interface ComplianceBudgetLine {
  id: string;
  label: string;
  category: string;
  trigger: string;
  estimationMode: "forfait" | "surface";
  unitPrice: number;
  quantity: number;
  minAmount: number;
  maxAmount: number;
  severity: "normal" | "attention" | "bloquant";
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TABS: {
  id: AuditTab;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  step: number;
}[] = [
  { id: "overview",      label: "Vue d'ensemble", shortLabel: "Projet",     icon: LayoutDashboard, description: "Contexte et paramètres du projet",                               step: 1 },
  { id: "conformite",    label: "Conformité",      shortLabel: "Conformité", icon: ShieldCheck,     description: "Contraintes réglementaires, diagnostics et coûts estimés",       step: 2 },
  { id: "analyse-plan",  label: "Analyse du plan", shortLabel: "Plan",       icon: ScanSearch,      description: "Surfaces, circulations et potentiel spatial",                    step: 3 },
  { id: "budget",        label: "Budget travaux",  shortLabel: "Budget",     icon: Calculator,      description: "Chiffrage global travaux + coûts de conformité intégrés",        step: 4 },
  { id: "synthese",      label: "Synthèse audit",  shortLabel: "Synthèse",   icon: Sparkles,        description: "Récapitulatif, faisabilité et recommandations",                  step: 5 },
];

const COMPLIANCE_INITIAL: ComplianceItem[] = [
  { id: "sdis",             category: "Sécurité incendie",  label: "SDIS — Service Incendie",             description: "Avis du Service Départemental d'Incendie et de Secours",                                              status: "non-verifie", note: "" },
  { id: "incendie-erp",     category: "Sécurité incendie",  label: "Sécurité incendie ERP",               description: "Réglementation ERP : désenfumage, issues de secours, cloisonnement CF",                              status: "non-verifie", note: "" },
  { id: "detection",        category: "Sécurité incendie",  label: "Système de détection / SSI",          description: "SSI, détecteurs automatiques d'incendie selon catégorie ERP ou logement",                             status: "non-verifie", note: "" },
  { id: "erp-classement",   category: "ERP",                label: "Classement ERP",                      description: "Type et catégorie de l'ERP si changement de destination vers accueil public",                         status: "non-verifie", note: "" },
  { id: "erp-autorisation", category: "ERP",                label: "Autorisation d'ouverture ERP",        description: "Dossier de demande d'ouverture à déposer en mairie / préfecture",                                     status: "non-verifie", note: "" },
  { id: "pmr-logements",    category: "PMR & Accessibilité", label: "Accessibilité logements PMR",        description: "Quota de logements accessibles (art. R111-18 CCH) et cheminements",                                   status: "non-verifie", note: "" },
  { id: "pmr-parties-communes", category: "PMR & Accessibilité", label: "Parties communes accessibles",  description: "Hall, couloirs, ascenseur, stationnement PMR",                                                         status: "non-verifie", note: "" },
  { id: "accessibilite-erp", category: "PMR & Accessibilité", label: "Accessibilité ERP (Ad'AP)",         description: "Agenda d'Accessibilité Programmée si ERP existant",                                                   status: "non-verifie", note: "" },
  { id: "destination",      category: "Urbanisme",           label: "Changement de destination",          description: "PC ou déclaration préalable selon surface et type de destination",                                     status: "non-verifie", note: "" },
  { id: "plu",              category: "Urbanisme",           label: "Conformité PLU / POS",               description: "Gabarit, hauteur, emprise au sol, prospect, stationnement",                                           status: "non-verifie", note: "" },
  { id: "patrimoine",       category: "Urbanisme",           label: "Monuments historiques / AVAP",       description: "Périmètre de protection, avis ABF obligatoire",                                                        status: "non-verifie", note: "" },
  { id: "syndic",           category: "Copropriété",         label: "Accord de l'assemblée générale",     description: "Travaux privatifs affectant parties communes ou aspect extérieur",                                     status: "non-verifie", note: "" },
  { id: "reglement-copro",  category: "Copropriété",         label: "Règlement de copropriété",           description: "Clause d'habitation bourgeoise, interdiction d'activité professionnelle",                              status: "non-verifie", note: "" },
  { id: "amiante",          category: "Diagnostics",         label: "Diagnostic amiante (DAPP)",          description: "Bâtiments permis avant 01/07/1997 — DAPP / DAP avant travaux",                                        status: "non-verifie", note: "" },
  { id: "plomb",            category: "Diagnostics",         label: "Diagnostic plomb (CREP)",            description: "Bâtiments avant 01/01/1949 — CREP obligatoire avant travaux",                                         status: "non-verifie", note: "" },
  { id: "dpe",              category: "Diagnostics",         label: "DPE avant travaux",                  description: "Étiquette énergie initiale — obligation de rénovation si F ou G (loi Climat)",                         status: "non-verifie", note: "" },
  { id: "termites",         category: "Diagnostics",         label: "Diagnostic termites / parasites",    description: "Obligatoire dans les zones délimitées par arrêté préfectoral",                                         status: "non-verifie", note: "" },
  { id: "electricite",      category: "Diagnostics",         label: "Diagnostic électricité / gaz",       description: "Installations de plus de 15 ans — diagnostic réglementaire",                                          status: "non-verifie", note: "" },
];

const BUDGET_POSTES_INITIAL: BudgetPoste[] = [
  { id: "go-structure",     category: "Gros œuvre",             label: "Reprise de structure / planchers",          prixUnitaire: 180, quantite: 0, montant: 0, enabled: false },
  { id: "go-murs",          category: "Gros œuvre",             label: "Ravalement / isolation extérieure (ITE)",   prixUnitaire: 250, quantite: 0, montant: 0, enabled: false },
  { id: "go-toiture",       category: "Gros œuvre",             label: "Réfection toiture / charpente",             prixUnitaire: 150, quantite: 0, montant: 0, enabled: false },
  { id: "so-cloisons",      category: "Second œuvre",           label: "Cloisons / distribution intérieure",        prixUnitaire: 80,  quantite: 0, montant: 0, enabled: false },
  { id: "so-menuiseries",   category: "Second œuvre",           label: "Menuiseries extérieures",                   prixUnitaire: 600, quantite: 0, montant: 0, enabled: false },
  { id: "so-revetements",   category: "Second œuvre",           label: "Revêtements sols et murs",                  prixUnitaire: 90,  quantite: 0, montant: 0, enabled: false },
  { id: "tech-elec",        category: "Équipements techniques", label: "Installation électrique (mise aux normes)",  prixUnitaire: 110, quantite: 0, montant: 0, enabled: false },
  { id: "tech-plomberie",   category: "Équipements techniques", label: "Plomberie / sanitaires",                    prixUnitaire: 120, quantite: 0, montant: 0, enabled: false },
  { id: "tech-chauffage",   category: "Équipements techniques", label: "Chauffage / ventilation (VMC)",             prixUnitaire: 140, quantite: 0, montant: 0, enabled: false },
];

// ─────────────────────────────────────────────────────────────────────────────
// Compliance budget estimation engine
// ─────────────────────────────────────────────────────────────────────────────

function estimateComplianceBudget(
  overview: OverviewData,
  items: ComplianceItem[]
): ComplianceBudgetLine[] {
  const surfaceRef = parseFloat(overview.surfaceTotale) || 0;
  const annee = parseInt(overview.anneeConstruction) || 0;
  const lines: ComplianceBudgetLine[] = [];
  const addedIds = new Set<string>();

  const relevant = items.filter(
    (i) => i.status === "attention" || i.status === "bloquant"
  );

  function getSeverity(ids: string[]): "attention" | "bloquant" {
    return relevant.some((i) => ids.includes(i.id) && i.status === "bloquant")
      ? "bloquant"
      : "attention";
  }

  function add(line: ComplianceBudgetLine) {
    if (!addedIds.has(line.id)) {
      addedIds.add(line.id);
      lines.push(line);
    }
  }

  // ── PMR / Accessibilité ───────────────────────────────────────────────────
  const pmrIds = ["accessibilite-erp", "pmr-logements", "pmr-parties-communes"];
  if (relevant.some((i) => pmrIds.includes(i.id))) {
    add({
      id: "budget-pmr",
      label: "Mise en accessibilité PMR",
      category: "Accessibilité PMR",
      trigger: relevant.filter((i) => pmrIds.includes(i.id)).map((i) => i.label).join(", "),
      estimationMode: "forfait",
      unitPrice: 0,
      quantity: 0,
      minAmount: 8_000,
      maxAmount: 35_000,
      severity: getSeverity(pmrIds),
    });
  }

  // ── Sécurité incendie ─────────────────────────────────────────────────────
  const fireIds = ["incendie-erp", "sdis", "detection", "erp-classement"];
  if (relevant.some((i) => fireIds.includes(i.id))) {
    add({
      id: "budget-incendie",
      label: "Sécurité incendie / désenfumage / SSI",
      category: "Sécurité incendie",
      trigger: relevant.filter((i) => fireIds.includes(i.id)).map((i) => i.label).join(", "),
      estimationMode: "forfait",
      unitPrice: 0,
      quantity: 0,
      minAmount: 12_000,
      maxAmount: 60_000,
      severity: getSeverity(fireIds),
    });
  }

  // ── Amiante ───────────────────────────────────────────────────────────────
  if (relevant.some((i) => i.id === "amiante")) {
    const min = surfaceRef > 0 ? Math.round(surfaceRef * 40) : 5_000;
    const max = surfaceRef > 0 ? Math.round(surfaceRef * 120) : 25_000;
    add({
      id: "budget-amiante",
      label: "Désamiantage",
      category: "Diagnostics / désamiantage",
      trigger: "Diagnostic amiante (DAPP) marqué",
      estimationMode: surfaceRef > 0 ? "surface" : "forfait",
      unitPrice: 80,
      quantity: surfaceRef,
      minAmount: min,
      maxAmount: max,
      severity: getSeverity(["amiante"]),
    });
  }

  // ── Plomb ─────────────────────────────────────────────────────────────────
  if (relevant.some((i) => i.id === "plomb")) {
    const min = surfaceRef > 0 ? Math.round(surfaceRef * 25) : 3_000;
    const max = surfaceRef > 0 ? Math.round(surfaceRef * 80) : 15_000;
    add({
      id: "budget-plomb",
      label: "Traitement plomb (CREP)",
      category: "Diagnostics / plomb",
      trigger: "Diagnostic plomb (CREP) marqué",
      estimationMode: surfaceRef > 0 ? "surface" : "forfait",
      unitPrice: 50,
      quantity: surfaceRef,
      minAmount: min,
      maxAmount: max,
      severity: getSeverity(["plomb"]),
    });
  }

  // ── DPE ───────────────────────────────────────────────────────────────────
  if (relevant.some((i) => i.id === "dpe")) {
    const isBad = overview.classeDpe === "F" || overview.classeDpe === "G";
    const minPu = isBad ? 400 : 120;
    const maxPu = isBad ? 900 : 300;
    const min = surfaceRef > 0 ? Math.round(surfaceRef * minPu) : (isBad ? 40_000 : 12_000);
    const max = surfaceRef > 0 ? Math.round(surfaceRef * maxPu) : (isBad ? 90_000 : 30_000);
    add({
      id: "budget-dpe",
      label: `Rénovation énergétique${isBad ? " (prioritaire)" : ""}`,
      category: "Rénovation énergétique",
      trigger: `DPE ${overview.classeDpe || "non renseigné"} — item DPE marqué`,
      estimationMode: surfaceRef > 0 ? "surface" : "forfait",
      unitPrice: Math.round((minPu + maxPu) / 2),
      quantity: surfaceRef,
      minAmount: min,
      maxAmount: max,
      severity: isBad ? "bloquant" : "attention",
    });
  }

  // ── Urbanisme ─────────────────────────────────────────────────────────────
  const urbIds = ["destination", "plu", "patrimoine"];
  if (relevant.some((i) => urbIds.includes(i.id))) {
    add({
      id: "budget-urbanisme",
      label: "Études et autorisations urbanisme",
      category: "Urbanisme / études",
      trigger: relevant.filter((i) => urbIds.includes(i.id)).map((i) => i.label).join(", "),
      estimationMode: "forfait",
      unitPrice: 0,
      quantity: 0,
      minAmount: 3_000,
      maxAmount: 15_000,
      severity: getSeverity(urbIds),
    });
  }

  // ── Copropriété ───────────────────────────────────────────────────────────
  const coprIds = ["syndic", "reglement-copro"];
  if (relevant.some((i) => coprIds.includes(i.id))) {
    add({
      id: "budget-copro",
      label: "Démarches copropriété / juridique",
      category: "Copropriété / juridique",
      trigger: relevant.filter((i) => coprIds.includes(i.id)).map((i) => i.label).join(", "),
      estimationMode: "forfait",
      unitPrice: 0,
      quantity: 0,
      minAmount: 1_500,
      maxAmount: 8_000,
      severity: getSeverity(coprIds),
    });
  }

  // ── Auto-triggers depuis overview ─────────────────────────────────────────

  // Risque plomb — avant 1949
  if (annee > 0 && annee < 1949 && !addedIds.has("budget-plomb")) {
    const min = surfaceRef > 0 ? Math.round(surfaceRef * 25) : 3_000;
    const max = surfaceRef > 0 ? Math.round(surfaceRef * 80) : 15_000;
    add({
      id: "budget-plomb-auto",
      label: "Risque plomb — bâtiment antérieur à 1949",
      category: "Diagnostics / plomb",
      trigger: `Année de construction : ${overview.anneeConstruction}`,
      estimationMode: surfaceRef > 0 ? "surface" : "forfait",
      unitPrice: 50,
      quantity: surfaceRef,
      minAmount: min,
      maxAmount: max,
      severity: "attention",
    });
  }

  // Risque amiante — avant 1997
  if (annee > 0 && annee < 1997 && !addedIds.has("budget-amiante")) {
    const min = surfaceRef > 0 ? Math.round(surfaceRef * 40) : 5_000;
    const max = surfaceRef > 0 ? Math.round(surfaceRef * 120) : 25_000;
    add({
      id: "budget-amiante-auto",
      label: "Risque amiante — bâtiment antérieur à 1997",
      category: "Diagnostics / désamiantage",
      trigger: `Année de construction : ${overview.anneeConstruction}`,
      estimationMode: surfaceRef > 0 ? "surface" : "forfait",
      unitPrice: 80,
      quantity: surfaceRef,
      minAmount: min,
      maxAmount: max,
      severity: "attention",
    });
  }

  // Changement de destination
  if (
    overview.destinationActuelle &&
    overview.destinationCible &&
    overview.destinationActuelle !== overview.destinationCible &&
    !addedIds.has("budget-urbanisme") &&
    !addedIds.has("budget-destination-auto")
  ) {
    add({
      id: "budget-destination-auto",
      label: "Changement de destination",
      category: "Urbanisme / études",
      trigger: `${overview.destinationActuelle} → ${overview.destinationCible}`,
      estimationMode: "forfait",
      unitPrice: 0,
      quantity: 0,
      minAmount: 3_000,
      maxAmount: 15_000,
      severity: "attention",
    });
  }

  // DPE F/G auto
  if (
    (overview.classeDpe === "F" || overview.classeDpe === "G") &&
    !addedIds.has("budget-dpe")
  ) {
    const min = surfaceRef > 0 ? Math.round(surfaceRef * 400) : 40_000;
    const max = surfaceRef > 0 ? Math.round(surfaceRef * 900) : 90_000;
    add({
      id: "budget-dpe-auto",
      label: "Rénovation énergétique prioritaire — passoire thermique",
      category: "Rénovation énergétique",
      trigger: `DPE ${overview.classeDpe} — obligation légale`,
      estimationMode: surfaceRef > 0 ? "surface" : "forfait",
      unitPrice: 650,
      quantity: surfaceRef,
      minAmount: min,
      maxAmount: max,
      severity: "bloquant",
    });
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function statusColor(s: ComplianceStatus): string {
  if (s === "ok")        return "text-emerald-600 bg-emerald-50 border-emerald-200";
  if (s === "attention") return "text-amber-600 bg-amber-50 border-amber-200";
  if (s === "bloquant")  return "text-red-600 bg-red-50 border-red-200";
  return "text-slate-500 bg-slate-50 border-slate-200";
}

function statusIcon(s: ComplianceStatus): React.ReactNode {
  if (s === "ok")        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (s === "attention") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (s === "bloquant")  return <XCircle className="h-4 w-4 text-red-500" />;
  return <Circle className="h-4 w-4 text-slate-300" />;
}

function statusLabel(s: ComplianceStatus): string {
  if (s === "ok")        return "Conforme";
  if (s === "attention") return "À vérifier";
  if (s === "bloquant")  return "Bloquant";
  return "Non vérifié";
}

function severityBadge(s: "normal" | "attention" | "bloquant"): React.ReactNode {
  if (s === "bloquant")
    return <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600">Bloquant</span>;
  if (s === "attention")
    return <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">À vérifier</span>;
  return null;
}

function fmtEur(v: number): string {
  return v.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function fmtRange(min: number, max: number): string {
  return `${fmtEur(min)} — ${fmtEur(max)}`;
}

function groupBy<T, K extends string>(arr: T[], key: (item: T) => K): Record<K, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item);
    if (!acc[k]) acc[k] = [] as T[];
    acc[k].push(item);
    return acc;
  }, {} as Record<K, T[]>);
}

// ─────────────────────────────────────────────────────────────────────────────
// OverviewData type (forward-declared for estimateComplianceBudget)
// ─────────────────────────────────────────────────────────────────────────────

interface OverviewData {
  adresse: string;
  codePostal: string;
  ville: string;
  anneeConstruction: string;
  surfaceTotale: string;
  niveaux: string;
  destinationActuelle: DestinationType;
  destinationCible: DestinationType;
  typeBatiment: string;
  copropriete: "oui" | "non" | "";
  classeDpe: string;
  notes: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// OverviewSection
// ─────────────────────────────────────────────────────────────────────────────

function OverviewSection({
  data,
  onChange,
  onNext,
}: {
  data: OverviewData;
  onChange: (d: OverviewData) => void;
  onNext: () => void;
}) {
  function set<K extends keyof OverviewData>(k: K, v: OverviewData[K]) {
    onChange({ ...data, [k]: v });
  }

  const inputCls =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100 transition-colors";
  const labelCls = "block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1";

  const DESTINATIONS: { value: DestinationType; label: string }[] = [
    { value: "",          label: "— Sélectionner —" },
    { value: "habitation", label: "Habitation" },
    { value: "bureaux",   label: "Bureaux" },
    { value: "commerce",  label: "Commerce / local" },
    { value: "erp",       label: "ERP" },
    { value: "mixte",     label: "Mixte" },
  ];

  const DPE_CLASSES = ["A", "B", "C", "D", "E", "F", "G", "Non réalisé"];

  const hasChangement =
    data.destinationActuelle &&
    data.destinationCible &&
    data.destinationActuelle !== data.destinationCible;

  return (
    <div className="space-y-8">
      <div className="flex items-start gap-4 rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 to-amber-50 p-6">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-500 shadow-md">
          <Building2 className="h-6 w-6 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">Contexte du projet</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Renseignez les informations clés du bâtiment à réhabiliter. Ces données alimentent
            l'audit réglementaire, les estimations budgétaires et le chiffrage travaux.
          </p>
        </div>
      </div>

      <SectionCard title="Localisation du bien" icon={MapPin}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className={labelCls}>Adresse</label>
            <input type="text" className={inputCls} placeholder="12 rue de la Paix" value={data.adresse} onChange={(e) => set("adresse", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Code postal</label>
            <input type="text" className={inputCls} placeholder="75001" value={data.codePostal} onChange={(e) => set("codePostal", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Ville</label>
            <input type="text" className={inputCls} placeholder="Paris" value={data.ville} onChange={(e) => set("ville", e.target.value)} />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Caractéristiques du bâtiment" icon={Building2}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <label className={labelCls}>Année de construction</label>
            <input type="text" className={inputCls} placeholder="1970" value={data.anneeConstruction} onChange={(e) => set("anneeConstruction", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Surface totale (m²)</label>
            <input type="number" className={inputCls} placeholder="450" value={data.surfaceTotale} onChange={(e) => set("surfaceTotale", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Nombre de niveaux</label>
            <input type="number" className={inputCls} placeholder="4" value={data.niveaux} onChange={(e) => set("niveaux", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Classe DPE</label>
            <select className={inputCls} value={data.classeDpe} onChange={(e) => set("classeDpe", e.target.value)}>
              <option value="">— Classe —</option>
              {DPE_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Type de bâtiment</label>
            <select className={inputCls} value={data.typeBatiment} onChange={(e) => set("typeBatiment", e.target.value)}>
              <option value="">— Type —</option>
              <option value="immeuble-haussmannien">Immeuble haussmannien</option>
              <option value="immeuble-annees50-70">Immeuble années 50-70</option>
              <option value="immeuble-contemporain">Immeuble contemporain</option>
              <option value="maison">Maison / villa</option>
              <option value="hangar-industriel">Hangar / industriel</option>
              <option value="entrepot">Entrepôt</option>
              <option value="bureaux">Immeuble de bureaux</option>
              <option value="autre">Autre</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>En copropriété ?</label>
            <div className="mt-1 flex gap-2">
              {(["oui", "non"] as const).map((v) => (
                <button key={v} type="button" onClick={() => set("copropriete", v)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    data.copropriete === v
                      ? "border-orange-400 bg-orange-50 text-orange-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}>
                  {v === "oui" ? "Oui" : "Non"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Destination & usage cible" icon={DoorOpen}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Destination actuelle</label>
            <select className={inputCls} value={data.destinationActuelle} onChange={(e) => set("destinationActuelle", e.target.value as DestinationType)}>
              {DESTINATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Destination cible (projet)</label>
            <select className={inputCls} value={data.destinationCible} onChange={(e) => set("destinationCible", e.target.value as DestinationType)}>
              {DESTINATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
        </div>
        {hasChangement && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Changement de destination détecté</p>
              <p className="mt-0.5 text-xs text-amber-700">
                Nécessite une autorisation d'urbanisme. Une estimation budgétaire sera générée dans l'onglet Conformité.
              </p>
            </div>
          </div>
        )}
        {(data.classeDpe === "F" || data.classeDpe === "G") && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-semibold text-red-800">Passoire thermique — obligation de rénovation</p>
              <p className="mt-0.5 text-xs text-red-700">
                Classe {data.classeDpe} : calendrier d'interdiction de location (loi Climat &amp; Résilience).
                Une estimation de rénovation énergétique sera intégrée dans l'onglet Conformité.
              </p>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Notes complémentaires" icon={FileText}>
        <textarea
          className={`${inputCls} min-h-[100px] resize-none`}
          placeholder="Contexte particulier, contraintes connues, historique du bâtiment…"
          value={data.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </SectionCard>

      <div className="flex justify-end">
        <button type="button" onClick={onNext}
          className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-md transition-all hover:bg-orange-600 hover:shadow-lg">
          Passer à la Conformité
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ConformiteSection — avec estimation budgétaire intégrée
// ─────────────────────────────────────────────────────────────────────────────

function ConformiteSection({
  overview,
  items,
  onChange,
  onNext,
}: {
  overview: OverviewData;
  items: ComplianceItem[];
  onChange: (items: ComplianceItem[]) => void;
  onNext: () => void;
}) {
  function updateItem(id: string, patch: Partial<ComplianceItem>) {
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  const grouped = groupBy(items, (i) => i.category);
  const categories = [...new Set(items.map((i) => i.category))];

  const counts = {
    ok:         items.filter((i) => i.status === "ok").length,
    attention:  items.filter((i) => i.status === "attention").length,
    bloquant:   items.filter((i) => i.status === "bloquant").length,
    nonVerifie: items.filter((i) => i.status === "non-verifie").length,
  };

  // ── Budget estimation ────────────────────────────────────────────────────
  const budgetLines = useMemo(
    () => estimateComplianceBudget(overview, items),
    [overview, items]
  );
  const totalMin = budgetLines.reduce((s, l) => s + l.minAmount, 0);
  const totalMax = budgetLines.reduce((s, l) => s + l.maxAmount, 0);
  const surfaceRef = parseFloat(overview.surfaceTotale) || 0;

  const categoryIcon: Record<string, React.ComponentType<{ className?: string }>> = {
    "Sécurité incendie":  Flame,
    "ERP":                Building2,
    "PMR & Accessibilité": Users,
    "Urbanisme":          Layers,
    "Copropriété":        FileText,
    "Diagnostics":        ClipboardCheck,
  };

  // Group budget lines by category
  const budgetGrouped = groupBy(budgetLines, (l) => l.category);
  const budgetCategories = [...new Set(budgetLines.map((l) => l.category))];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start gap-4 rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 to-amber-50 p-6">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-500 shadow-md">
          <ShieldCheck className="h-6 w-6 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">Audit de conformité réglementaire</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Évaluez chaque exigence réglementaire. Les estimations budgétaires de mise en conformité
            sont calculées automatiquement et remontées dans le Budget travaux.
          </p>
        </div>
      </div>

      {/* Score rapide */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Conformes",    count: counts.ok,         color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
          { label: "À vérifier",   count: counts.attention,  color: "text-amber-600 bg-amber-50 border-amber-200" },
          { label: "Bloquants",    count: counts.bloquant,   color: "text-red-600 bg-red-50 border-red-200" },
          { label: "Non vérifiés", count: counts.nonVerifie, color: "text-slate-500 bg-slate-50 border-slate-200" },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border px-4 py-3 text-center ${s.color}`}>
            <div className="text-2xl font-bold">{s.count}</div>
            <div className="mt-0.5 text-xs font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      {counts.bloquant > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <p className="text-sm text-red-700">
            <strong>{counts.bloquant} point{counts.bloquant > 1 ? "s" : ""} bloquant{counts.bloquant > 1 ? "s" : ""}</strong>{" "}
            détecté{counts.bloquant > 1 ? "s" : ""}. Ces éléments conditionnent la faisabilité du projet.
          </p>
        </div>
      )}

      {/* ── Estimation budgétaire de mise en conformité ─────────────────────── */}
      <div className="rounded-2xl border border-orange-200 bg-white shadow-sm overflow-hidden">
        {/* Card header */}
        <div className="flex items-center justify-between border-b border-orange-100 bg-gradient-to-r from-orange-50 to-amber-50 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <BadgeEuro className="h-5 w-5 text-orange-500" />
            <div>
              <h3 className="text-sm font-bold text-slate-800">Estimation budgétaire de mise en conformité</h3>
              <p className="text-[11px] text-slate-500">
                Calculée automatiquement · Alimentée dans le Budget travaux
                {surfaceRef > 0 && ` · Surface de référence : ${surfaceRef.toLocaleString("fr-FR")} m²`}
              </p>
            </div>
          </div>
          {budgetLines.length > 0 && (
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-orange-500">Fourchette totale</div>
                <div className="text-sm font-bold text-slate-900">
                  {fmtEur(totalMin)} — {fmtEur(totalMax)}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-5">
          {budgetLines.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                <BadgeEuro className="h-6 w-6 text-slate-300" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-600">Aucune estimation réglementaire générée</p>
                <p className="mt-1 max-w-md text-xs text-slate-400">
                  Marquez des points comme "À vérifier" ou "Bloquant", ou renseignez l'année de construction,
                  la classe DPE et la destination du projet dans l'onglet Vue d'ensemble.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Totaux synthétiques */}
              <div className="mb-4 grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Lignes</div>
                  <div className="mt-0.5 text-xl font-bold text-slate-800">{budgetLines.length}</div>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-500">Minimum</div>
                  <div className="mt-0.5 text-sm font-bold text-amber-800">{fmtEur(totalMin)}</div>
                </div>
                <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-orange-500">Maximum</div>
                  <div className="mt-0.5 text-sm font-bold text-orange-800">{fmtEur(totalMax)}</div>
                </div>
              </div>

              {/* Lignes par catégorie */}
              {budgetCategories.map((cat) => (
                <div key={cat} className="overflow-hidden rounded-xl border border-slate-100">
                  <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{cat}</span>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {(budgetGrouped[cat] ?? []).map((line) => (
                      <div key={line.id} className="flex items-start gap-3 px-3 py-3">
                        <div className="mt-0.5 shrink-0">{severityBadge(line.severity)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{line.label}</p>
                          <p className="mt-0.5 text-[11px] text-slate-400 truncate">
                            Déclencheur : {line.trigger}
                            {line.estimationMode === "surface" && surfaceRef > 0 &&
                              ` · ${surfaceRef.toLocaleString("fr-FR")} m² × ${line.unitPrice} €/m²`}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-xs font-bold text-slate-700">
                            {fmtEur(line.minAmount)}
                          </div>
                          <div className="text-[10px] text-slate-400">à {fmtEur(line.maxAmount)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div className="mt-2 flex items-center gap-2 rounded-lg border border-orange-100 bg-orange-50 px-3 py-2">
                <ArrowDownToLine className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                <p className="text-[11px] text-orange-700">
                  Ces estimations sont intégrées automatiquement dans l'onglet <strong>Budget travaux</strong> en section séparée.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Catégories de conformité */}
      {categories.map((cat) => {
        const catItems = grouped[cat] ?? [];
        const CatIcon = categoryIcon[cat] ?? ShieldCheck;
        return (
          <SectionCard key={cat} title={cat} icon={CatIcon}>
            <div className="space-y-3">
              {catItems.map((item) => (
                <div key={item.id} className={`rounded-xl border p-4 transition-colors ${statusColor(item.status)}`}>
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">{statusIcon(item.status)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {(["ok", "attention", "bloquant", "non-verifie"] as const).map((s) => (
                            <button key={s} type="button" onClick={() => updateItem(item.id, { status: s })}
                              title={statusLabel(s)}
                              className={`rounded-lg border px-2 py-1 text-[10px] font-semibold transition-colors ${
                                item.status === s
                                  ? s === "ok"        ? "border-emerald-400 bg-emerald-500 text-white"
                                  : s === "attention" ? "border-amber-400 bg-amber-500 text-white"
                                  : s === "bloquant"  ? "border-red-400 bg-red-500 text-white"
                                                      : "border-slate-400 bg-slate-500 text-white"
                                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                              }`}>
                              {s === "ok" ? "OK" : s === "attention" ? "⚠" : s === "bloquant" ? "✕" : "?"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <input type="text"
                        className="mt-2 w-full rounded-lg border border-slate-200 bg-white/80 px-2 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:border-orange-400 focus:outline-none"
                        placeholder="Note ou observation…"
                        value={item.note}
                        onChange={(e) => updateItem(item.id, { note: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        );
      })}

      <div className="flex justify-end">
        <button type="button" onClick={onNext}
          className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-md transition-all hover:bg-orange-600">
          Passer à l'Analyse du plan
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AnalysePlanSection (inchangé)
// ─────────────────────────────────────────────────────────────────────────────

interface PlanData {
  surfaceHabitable: string;
  surfaceCommunes: string;
  surfaceTerrasse: string;
  hauteurSousPlafond: string;
  nbrePieces: string;
  nbreLogements: string;
  circulations: "bonne" | "moyenne" | "mauvaise" | "";
  potentielDivision: "oui" | "non" | "partiel" | "";
  contraintes: string;
  cloisonnementNote: string;
  planUploaded: boolean;
}

function AnalysePlanSection({ data, onChange, onNext }: { data: PlanData; onChange: (d: PlanData) => void; onNext: () => void }) {
  function set<K extends keyof PlanData>(k: K, v: PlanData[K]) { onChange({ ...data, [k]: v }); }

  const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100";
  const labelCls = "block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1";

  const sdpTotal = (parseFloat(data.surfaceHabitable) || 0) + (parseFloat(data.surfaceCommunes) || 0);

  return (
    <div className="space-y-8">
      <div className="flex items-start gap-4 rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 to-amber-50 p-6">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-500 shadow-md">
          <ScanSearch className="h-6 w-6 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">Analyse spatiale du bâtiment</h2>
          <p className="mt-0.5 text-sm text-slate-500">Surfaces, distribution et potentiel de valorisation spatiale.</p>
        </div>
      </div>

      <SectionCard title="Plan(s) du bâtiment" icon={Upload}>
        <div
          className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${data.planUploaded ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50 hover:border-orange-300 hover:bg-orange-50"}`}
          onClick={() => set("planUploaded", !data.planUploaded)}>
          {data.planUploaded ? (
            <><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" /><p className="mt-2 text-sm font-semibold text-emerald-700">Plans chargés</p><p className="text-xs text-emerald-600">Cliquez pour retirer</p></>
          ) : (
            <><Upload className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-2 text-sm font-semibold text-slate-600">Déposer le(s) plan(s) ici</p><p className="text-xs text-slate-400">PDF, DWG, PNG — simulation disponible sans plan</p></>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Surfaces & métrés" icon={Ruler}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div><label className={labelCls}>Surface habitable / utile (m²)</label><input type="number" className={inputCls} placeholder="380" value={data.surfaceHabitable} onChange={(e) => set("surfaceHabitable", e.target.value)} /></div>
          <div><label className={labelCls}>Parties communes (m²)</label><input type="number" className={inputCls} placeholder="70" value={data.surfaceCommunes} onChange={(e) => set("surfaceCommunes", e.target.value)} /></div>
          <div><label className={labelCls}>Terrasses / extérieurs (m²)</label><input type="number" className={inputCls} placeholder="0" value={data.surfaceTerrasse} onChange={(e) => set("surfaceTerrasse", e.target.value)} /></div>
          <div><label className={labelCls}>Hauteur sous plafond (m)</label><input type="number" step="0.05" className={inputCls} placeholder="2.70" value={data.hauteurSousPlafond} onChange={(e) => set("hauteurSousPlafond", e.target.value)} /></div>
        </div>
        {sdpTotal > 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
            <Info className="h-4 w-4 shrink-0 text-orange-500" />
            <span className="text-sm font-medium text-orange-700">SDP totale estimée : <strong>{sdpTotal.toLocaleString("fr-FR")} m²</strong></span>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Distribution & cloisonnement" icon={Layers}>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={labelCls}>Nombre de pièces / lots</label><input type="number" className={inputCls} placeholder="8" value={data.nbrePieces} onChange={(e) => set("nbrePieces", e.target.value)} /></div>
          <div><label className={labelCls}>Nombre de logements (si immeuble)</label><input type="number" className={inputCls} placeholder="4" value={data.nbreLogements} onChange={(e) => set("nbreLogements", e.target.value)} /></div>
        </div>
        <div className="mt-4">
          <label className={labelCls}>Qualité des circulations</label>
          <div className="flex gap-2">
            {(["bonne", "moyenne", "mauvaise"] as const).map((v) => (
              <button key={v} type="button" onClick={() => set("circulations", v)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                  data.circulations === v
                    ? v === "bonne"   ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                    : v === "moyenne" ? "border-amber-400 bg-amber-50 text-amber-700"
                                      : "border-red-400 bg-red-50 text-red-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}>
                {v === "bonne" ? "✓ Bonne" : v === "moyenne" ? "⚠ Moyenne" : "✕ Mauvaise"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <label className={labelCls}>Notes sur le cloisonnement</label>
          <textarea className={`${inputCls} min-h-[80px] resize-none`} placeholder="Cloisons porteuses, murs mitoyens, poteaux béton, trémies existantes…" value={data.cloisonnementNote} onChange={(e) => set("cloisonnementNote", e.target.value)} />
        </div>
      </SectionCard>

      <SectionCard title="Potentiel de valorisation" icon={TrendingUp}>
        <div>
          <label className={labelCls}>Potentiel de division / création de lots</label>
          <div className="flex gap-2">
            {(["oui", "partiel", "non"] as const).map((v) => (
              <button key={v} type="button" onClick={() => set("potentielDivision", v)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  data.potentielDivision === v ? "border-orange-400 bg-orange-50 text-orange-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}>
                {v === "oui" ? "Oui" : v === "partiel" ? "Partiel" : "Non"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <label className={labelCls}>Contraintes spatiales identifiées</label>
          <textarea className={`${inputCls} min-h-[80px] resize-none`} placeholder="Hauteur sous plafond insuffisante, colonnes en attente, contraintes acoustiques, mitoyens…" value={data.contraintes} onChange={(e) => set("contraintes", e.target.value)} />
        </div>
      </SectionCard>

      <div className="flex justify-end">
        <button type="button" onClick={onNext} className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-md transition-all hover:bg-orange-600">
          Passer au Budget travaux <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BudgetSection — avec section conformité intégrée en lecture
// ─────────────────────────────────────────────────────────────────────────────

function BudgetSection({
  postes,
  onChange,
  onNext,
  overview,
  conformiteItems,
}: {
  postes: BudgetPoste[];
  onChange: (postes: BudgetPoste[]) => void;
  onNext: () => void;
  overview: OverviewData;
  conformiteItems: ComplianceItem[];
}) {
  function togglePoste(id: string) {
    onChange(postes.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)));
  }

  function updatePoste(id: string, field: "prixUnitaire" | "quantite", value: number) {
    onChange(postes.map((p) => {
      if (p.id !== id) return p;
      const updated = { ...p, [field]: value };
      updated.montant = updated.prixUnitaire * updated.quantite;
      return updated;
    }));
  }

  // ── Conformité budget ────────────────────────────────────────────────────
  const complianceLines = useMemo(
    () => estimateComplianceBudget(overview, conformiteItems),
    [overview, conformiteItems]
  );
  const complianceMin = complianceLines.reduce((s, l) => s + l.minAmount, 0);
  const complianceMax = complianceLines.reduce((s, l) => s + l.maxAmount, 0);
  const complianceMid = Math.round((complianceMin + complianceMax) / 2);

  const grouped   = groupBy(postes, (p) => p.category);
  const categories = [...new Set(postes.map((p) => p.category))];

  const travauxHT  = postes.filter((p) => p.enabled).reduce((s, p) => s + p.montant, 0);
  const travauxTTC = travauxHT * 1.1;
  const moeHT      = travauxHT * 0.1;

  // Grand total : travaux TTC + MOE TTC + conformité milieu
  const grandTotal = travauxTTC + moeHT * 1.2 + complianceMid;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start gap-4 rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 to-amber-50 p-6">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-500 shadow-md">
          <Calculator className="h-6 w-6 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">Chiffrage global des travaux</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Budget technique + coûts de mise en conformité (remontés depuis l'onglet Conformité).
            Activez les postes applicables et ajustez les quantités.
          </p>
        </div>
      </div>

      {/* ── Section coûts conformité (lecture seule) ───────────────────────── */}
      <div className="rounded-2xl border-2 border-orange-200 bg-white overflow-hidden shadow-sm">
        <div className="flex items-center justify-between border-b border-orange-100 bg-gradient-to-r from-orange-50 to-amber-50 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-orange-500" />
            <div>
              <h3 className="text-sm font-bold text-slate-800">Coûts de mise en conformité</h3>
              <p className="text-[11px] text-slate-500">
                Calculés depuis l'onglet Conformité · {complianceLines.length} ligne{complianceLines.length !== 1 ? "s" : ""}
                {parseFloat(overview.surfaceTotale) > 0 && ` · Surface : ${parseFloat(overview.surfaceTotale).toLocaleString("fr-FR")} m²`}
              </p>
            </div>
          </div>
          {complianceLines.length > 0 && (
            <div className="shrink-0 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-orange-500">Fourchette</div>
              <div className="text-sm font-bold text-slate-900">{fmtRange(complianceMin, complianceMax)}</div>
            </div>
          )}
        </div>

        <div className="p-5">
          {complianceLines.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-4">
              <Info className="h-5 w-5 shrink-0 text-slate-300" />
              <p className="text-sm text-slate-500">
                Aucune estimation générée. Renseignez les données dans l'onglet <strong>Vue d'ensemble</strong> et
                marquez des items dans <strong>Conformité</strong>.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {complianceLines.map((line) => (
                <div key={line.id}
                  className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
                    line.severity === "bloquant" ? "border-red-100 bg-red-50/50"
                    : "border-amber-100 bg-amber-50/50"
                  }`}>
                  <div className="mt-0.5 shrink-0">{severityBadge(line.severity)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{line.label}</p>
                    <p className="text-[11px] text-slate-400">
                      {line.category}
                      {line.estimationMode === "surface" && parseFloat(overview.surfaceTotale) > 0
                        && ` · ${parseFloat(overview.surfaceTotale).toLocaleString("fr-FR")} m² × ${line.unitPrice} €/m²`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs font-bold text-slate-700">{fmtEur(line.minAmount)}</div>
                    <div className="text-[10px] text-slate-400">à {fmtEur(line.maxAmount)}</div>
                  </div>
                </div>
              ))}

              {/* Sous-total conformité */}
              <div className="mt-3 flex items-center justify-between rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
                <span className="text-sm font-semibold text-orange-800">Sous-total conformité (valeur médiane)</span>
                <span className="text-sm font-bold text-orange-700">{fmtEur(complianceMid)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Postes travaux ─────────────────────────────────────────────────── */}
      {categories.map((cat) => {
        const catPostes  = grouped[cat] ?? [];
        const catTotal   = catPostes.filter((p) => p.enabled).reduce((s, p) => s + p.montant, 0);
        return (
          <SectionCard key={cat} title={cat} icon={Hammer}>
            {catTotal > 0 && (
              <div className="mb-3 text-right text-sm font-semibold text-orange-600">
                Sous-total : {fmtEur(catTotal)}
              </div>
            )}
            <div className="space-y-2">
              {catPostes.map((poste) => (
                <div key={poste.id}
                  className={`rounded-xl border p-4 transition-all ${poste.enabled ? "border-orange-200 bg-orange-50/50" : "border-slate-100 bg-white opacity-60"}`}>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => togglePoste(poste.id)}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${poste.enabled ? "border-orange-500 bg-orange-500" : "border-slate-300 bg-white"}`}>
                      {poste.enabled && <SquareCheckBig className="h-3.5 w-3.5 text-white" />}
                    </button>
                    <span className="flex-1 text-sm font-medium text-slate-800">{poste.label}</span>
                    {poste.enabled && <span className="text-sm font-bold text-orange-700">{fmtEur(poste.montant)}</span>}
                  </div>
                  {poste.enabled && (
                    <div className="mt-3 grid grid-cols-2 gap-3 pl-8">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Prix unitaire (€/m²)</label>
                        <input type="number" className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-orange-400 focus:outline-none"
                          value={poste.prixUnitaire} onChange={(e) => updatePoste(poste.id, "prixUnitaire", parseFloat(e.target.value) || 0)} />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Quantité (m²)</label>
                        <input type="number" className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-orange-400 focus:outline-none"
                          value={poste.quantite} onChange={(e) => updatePoste(poste.id, "quantite", parseFloat(e.target.value) || 0)} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        );
      })}

      {/* ── Récapitulatif global ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-slate-100 bg-slate-50 px-5 py-3.5">
          <Calculator className="h-4 w-4 text-orange-500" />
          <h3 className="text-sm font-semibold text-slate-800">Récapitulatif global</h3>
        </div>
        <div className="divide-y divide-slate-50 p-5">
          {/* Ligne travaux */}
          <div className="flex items-center justify-between py-2.5">
            <span className="text-sm text-slate-600">Budget travaux HT</span>
            <span className="text-sm font-semibold text-slate-900">{fmtEur(travauxHT)}</span>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <span className="text-sm text-slate-600">TVA 10% (réhabilitation)</span>
            <span className="text-sm font-semibold text-slate-900">{fmtEur(travauxHT * 0.1)}</span>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <span className="text-sm text-slate-600">Honoraires MOE (10% HT)</span>
            <span className="text-sm font-semibold text-slate-900">{fmtEur(moeHT * 1.2)}</span>
          </div>

          {/* Séparateur conformité */}
          {complianceLines.length > 0 && (
            <>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-sm text-amber-700">
                  Conformité réglementaire
                  <span className="ml-1.5 text-[11px] text-slate-400">(fourchette : {fmtRange(complianceMin, complianceMax)})</span>
                </span>
                <span className="text-sm font-semibold text-amber-700">{fmtEur(complianceMid)}</span>
              </div>
            </>
          )}

          {/* Grand total */}
          <div className="flex items-center justify-between rounded-xl bg-slate-900 px-4 py-4 mt-2">
            <div>
              <span className="text-sm font-bold text-white">Total projet estimé TTC</span>
              {complianceLines.length > 0 && (
                <p className="text-[10px] text-slate-400 mt-0.5">Travaux TTC + MOE TTC + conformité (médiane)</p>
              )}
            </div>
            <span className="text-xl font-bold text-white">{fmtEur(grandTotal)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={onNext}
          className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-md transition-all hover:bg-orange-600">
          Voir la Synthèse <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SyntheseSection — distingue budget travaux et coûts conformité
// ─────────────────────────────────────────────────────────────────────────────

function SyntheseSection({
  overview,
  conformite,
  plan,
  postes,
}: {
  overview: OverviewData;
  conformite: ComplianceItem[];
  plan: PlanData;
  postes: BudgetPoste[];
}) {
  const bloquants = conformite.filter((i) => i.status === "bloquant");
  const attention = conformite.filter((i) => i.status === "attention");
  const ok        = conformite.filter((i) => i.status === "ok");

  // Travaux
  const travauxHT  = postes.filter((p) => p.enabled).reduce((s, p) => s + p.montant, 0);
  const travauxTTC = travauxHT * 1.1;
  const moeHT      = travauxHT * 0.1;
  const surface    = parseFloat(plan.surfaceHabitable) || 0;
  const coutM2     = surface > 0 && travauxHT > 0 ? travauxHT / surface : 0;

  // Conformité
  const complianceLines = useMemo(
    () => estimateComplianceBudget(overview, conformite),
    [overview, conformite]
  );
  const complianceMin  = complianceLines.reduce((s, l) => s + l.minAmount, 0);
  const complianceMax  = complianceLines.reduce((s, l) => s + l.maxAmount, 0);
  const complianceMid  = Math.round((complianceMin + complianceMax) / 2);

  const grandTotalMin  = travauxTTC + moeHT * 1.2 + complianceMin;
  const grandTotalMax  = travauxTTC + moeHT * 1.2 + complianceMax;
  const grandTotalMid  = travauxTTC + moeHT * 1.2 + complianceMid;

  const faisabilite: "excellente" | "bonne" | "risquee" | "critique" = (() => {
    if (bloquants.length >= 3) return "critique";
    if (bloquants.length >= 1) return "risquee";
    if (attention.length >= 3) return "bonne";
    return "excellente";
  })();

  const faisabiliteConfig = {
    excellente: { color: "text-emerald-700 bg-emerald-50 border-emerald-200", label: "Faisabilité excellente", icon: CheckCircle2 },
    bonne:      { color: "text-sky-700 bg-sky-50 border-sky-200",             label: "Faisabilité bonne",       icon: Info },
    risquee:    { color: "text-amber-700 bg-amber-50 border-amber-200",       label: "Faisabilité risquée",     icon: AlertTriangle },
    critique:   { color: "text-red-700 bg-red-50 border-red-200",             label: "Faisabilité critique",    icon: XCircle },
  };

  const fc     = faisabiliteConfig[faisabilite];
  const FcIcon = fc.icon;

  return (
    <div className="space-y-8">
      <div className="flex items-start gap-4 rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 to-amber-50 p-6">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-500 shadow-md">
          <Sparkles className="h-6 w-6 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">Synthèse de l'audit de réhabilitation</h2>
          <p className="mt-0.5 text-sm text-slate-500">Récapitulatif consolidé — conformité, plan et budget.</p>
        </div>
      </div>

      {/* Verdict faisabilité */}
      <div className={`rounded-2xl border-2 p-6 ${fc.color}`}>
        <div className="flex items-center gap-3">
          <FcIcon className="h-8 w-8 shrink-0" />
          <div>
            <p className="text-lg font-bold">{fc.label}</p>
            <p className="text-sm opacity-75">
              {bloquants.length} bloquant{bloquants.length !== 1 ? "s" : ""} —{" "}
              {attention.length} point{attention.length !== 1 ? "s" : ""} à vérifier —{" "}
              {ok.length} conforme{ok.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* ── Tableau budgétaire global ───────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-slate-100 bg-slate-50 px-5 py-3.5">
          <Calculator className="h-4 w-4 text-orange-500" />
          <h3 className="text-sm font-semibold text-slate-800">Synthèse financière du projet</h3>
        </div>
        <div className="p-5 space-y-4">
          {/* Bloc travaux */}
          <div className="rounded-xl border border-slate-100 overflow-hidden">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Budget travaux techniques</span>
            </div>
            <div className="divide-y divide-slate-50">
              <div className="flex justify-between px-4 py-2.5 text-sm"><span className="text-slate-600">Travaux HT</span><span className="font-semibold text-slate-900">{fmtEur(travauxHT)}</span></div>
              <div className="flex justify-between px-4 py-2.5 text-sm"><span className="text-slate-600">TVA 10%</span><span className="font-semibold text-slate-900">{fmtEur(travauxHT * 0.1)}</span></div>
              <div className="flex justify-between px-4 py-2.5 text-sm"><span className="text-slate-600">Honoraires MOE (10% HT)</span><span className="font-semibold text-slate-900">{fmtEur(moeHT * 1.2)}</span></div>
              {coutM2 > 0 && <div className="flex justify-between px-4 py-2.5 text-sm"><span className="text-slate-600">Coût travaux au m² habitable</span><span className="font-semibold text-slate-900">{Math.round(coutM2).toLocaleString("fr-FR")} €/m²</span></div>}
            </div>
          </div>

          {/* Bloc conformité */}
          {complianceLines.length > 0 && (
            <div className="rounded-xl border border-orange-100 overflow-hidden">
              <div className="border-b border-orange-100 bg-orange-50 px-4 py-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-orange-500">Coûts de mise en conformité</span>
              </div>
              <div className="divide-y divide-orange-50">
                {complianceLines.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      {severityBadge(l.severity)}
                      <span className="text-sm text-slate-700 truncate">{l.label}</span>
                    </div>
                    <span className="shrink-0 text-[11px] text-slate-500">{fmtRange(l.minAmount, l.maxAmount)}</span>
                  </div>
                ))}
                <div className="flex justify-between px-4 py-2.5 text-sm">
                  <span className="text-orange-700 font-semibold">Total conformité (fourchette)</span>
                  <span className="font-bold text-orange-700">{fmtRange(complianceMin, complianceMax)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Grand total */}
          <div className="rounded-xl bg-slate-900 px-5 py-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-bold text-white">Enveloppe totale projet TTC</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {complianceLines.length > 0
                    ? "Travaux TTC + MOE + conformité (médiane estimée)"
                    : "Travaux TTC + MOE"}
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-white">{fmtEur(grandTotalMid)}</div>
                {complianceLines.length > 0 && (
                  <div className="text-[11px] text-slate-400">
                    Fourchette : {fmtEur(grandTotalMin)} — {fmtEur(grandTotalMax)}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPIs surface */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Surface habitable",   value: surface > 0 ? `${surface.toLocaleString("fr-FR")} m²` : "—" },
          { label: "Travaux HT",          value: travauxHT > 0 ? fmtEur(travauxHT) : "—" },
          { label: "Conformité (médiane)",value: complianceLines.length > 0 ? fmtEur(complianceMid) : "—" },
          { label: "Coût /m² travaux",    value: coutM2 > 0 ? `${Math.round(coutM2).toLocaleString("fr-FR")} €/m²` : "—" },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{kpi.label}</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Bâtiment */}
      {(overview.adresse || overview.typeBatiment) && (
        <SectionCard title="Bâtiment" icon={Building2}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {overview.adresse && <><dt className="text-slate-500">Adresse</dt><dd className="font-medium text-slate-900 sm:col-span-2">{overview.adresse}, {overview.codePostal} {overview.ville}</dd></>}
            {overview.anneeConstruction && <><dt className="text-slate-500">Année</dt><dd className="font-medium">{overview.anneeConstruction}</dd></>}
            {overview.classeDpe && <><dt className="text-slate-500">DPE</dt><dd className="font-medium">{overview.classeDpe}</dd></>}
            {overview.destinationCible && <><dt className="text-slate-500">Destination cible</dt><dd className="font-medium capitalize">{overview.destinationCible}</dd></>}
            {overview.copropriete && <><dt className="text-slate-500">Copropriété</dt><dd className="font-medium capitalize">{overview.copropriete}</dd></>}
          </dl>
        </SectionCard>
      )}

      {/* Points bloquants */}
      {bloquants.length > 0 && (
        <SectionCard title="Points bloquants à traiter" icon={XCircle}>
          <ul className="space-y-2">
            {bloquants.map((b) => (
              <li key={b.id} className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span><strong>{b.label}</strong>{b.note ? ` — ${b.note}` : ""}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {attention.length > 0 && (
        <SectionCard title="Points à vérifier" icon={AlertTriangle}>
          <ul className="space-y-2">
            {attention.map((a) => (
              <li key={a.id} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span><strong>{a.label}</strong>{a.note ? ` — ${a.note}` : ""}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Prochaines étapes */}
      <SectionCard title="Prochaines étapes" icon={ClipboardCheck}>
        <ul className="space-y-3">
          {bloquants.length > 0 && (
            <li className="flex items-start gap-3 text-sm text-slate-700">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-600">1</div>
              <span>Lever les <strong>{bloquants.length} point{bloquants.length !== 1 ? "s" : ""} bloquant{bloquants.length !== 1 ? "s" : ""}</strong> avant tout engagement contractuel.</span>
            </li>
          )}
          <li className="flex items-start gap-3 text-sm text-slate-700">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-600">{bloquants.length > 0 ? "2" : "1"}</div>
            <span>Consulter un architecte pour la faisabilité du plan de distribution envisagé.</span>
          </li>
          <li className="flex items-start gap-3 text-sm text-slate-700">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-600">{bloquants.length > 0 ? "3" : "2"}</div>
            <span>Valider le budget avec 3 devis d'entreprises et affiner la MOE.</span>
          </li>
          <li className="flex items-start gap-3 text-sm text-slate-700">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-600">{bloquants.length > 0 ? "4" : "3"}</div>
            <span>Passer à la valorisation pour estimer la valeur après travaux (VAT) et la rentabilité.</span>
          </li>
        </ul>
      </SectionCard>

      <div className="flex justify-end">
        <button type="button" onClick={() => {}}
          className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-md transition-all hover:bg-orange-600">
          Accéder à la Valorisation <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SectionCard helper
// ─────────────────────────────────────────────────────────────────────────────

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-slate-100 bg-slate-50/60 px-5 py-3.5">
        <Icon className="h-4 w-4 text-orange-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main AuditPage
// ─────────────────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab    = searchParams.get("tab") as AuditTab | null;
  const activeTab: AuditTab = rawTab && TABS.some((t) => t.id === rawTab) ? rawTab : "overview";

  const setTab = useCallback((tab: AuditTab) => {
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set("tab", tab); return n; });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [setSearchParams]);

  // ── State ──────────────────────────────────────────────────────────────────
  const [overview, setOverview] = useState<OverviewData>({
    adresse: "", codePostal: "", ville: "",
    anneeConstruction: "", surfaceTotale: "", niveaux: "",
    destinationActuelle: "", destinationCible: "",
    typeBatiment: "", copropriete: "", classeDpe: "", notes: "",
  });

  const [conformite, setConformite] = useState<ComplianceItem[]>(COMPLIANCE_INITIAL);
  const [plan, setPlan]             = useState<PlanData>({
    surfaceHabitable: "", surfaceCommunes: "", surfaceTerrasse: "",
    hauteurSousPlafond: "", nbrePieces: "", nbreLogements: "",
    circulations: "", potentielDivision: "", contraintes: "",
    cloisonnementNote: "", planUploaded: false,
  });
  const [postes, setPostes] = useState<BudgetPoste[]>(BUDGET_POSTES_INITIAL);

  // ── Badges ─────────────────────────────────────────────────────────────────
  const bloquantsCount = conformite.filter((i) => i.status === "bloquant").length;
  const attentionCount = conformite.filter((i) => i.status === "attention").length;
  const activeTabMeta  = TABS.find((t) => t.id === activeTab)!;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 shadow-md">
          <Hammer className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Audit de réhabilitation</h1>
          <p className="text-xs text-slate-400">Conformité · Plan · Chiffrage · Synthèse</p>
        </div>
      </div>

      {/* Step tabs */}
      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex items-stretch gap-1 overflow-x-auto">
          {TABS.map((tab, idx) => {
            const Icon   = tab.icon;
            const active = tab.id === activeTab;
            const isLast = idx === TABS.length - 1;
            return (
              <div key={tab.id} className="flex items-center gap-1">
                <button type="button" onClick={() => setTab(tab.id)}
                  className={`group flex min-w-[90px] flex-col items-center gap-1 rounded-xl px-4 py-3 text-center transition-all ${
                    active ? "bg-orange-500 shadow-md text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                  }`}>
                  <div className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${active ? "bg-white/20" : "bg-slate-100 group-hover:bg-slate-200"}`}>
                    {tab.id === "conformite" && bloquantsCount > 0 ? (
                      <span className={active ? "text-white" : "text-red-500"}>{bloquantsCount}</span>
                    ) : tab.id === "conformite" && attentionCount > 0 ? (
                      <span className={active ? "text-white" : "text-amber-500"}>{attentionCount}</span>
                    ) : (
                      <Icon className={`h-3.5 w-3.5 ${active ? "text-white" : "text-slate-400"}`} />
                    )}
                  </div>
                  <span className="whitespace-nowrap text-[11px] font-semibold leading-tight">{tab.shortLabel}</span>
                  <span className={`whitespace-nowrap text-[9px] ${active ? "text-orange-100" : "text-slate-400"}`}>Étape {tab.step}</span>
                </button>
                {!isLast && <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Active tab description */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <activeTabMeta.icon className="h-4 w-4 text-orange-500" />
        <span className="font-medium text-slate-800">{activeTabMeta.label}</span>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        <span>{activeTabMeta.description}</span>
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <OverviewSection data={overview} onChange={setOverview} onNext={() => setTab("conformite")} />
      )}
      {activeTab === "conformite" && (
        <ConformiteSection
          overview={overview}
          items={conformite}
          onChange={setConformite}
          onNext={() => setTab("analyse-plan")}
        />
      )}
      {activeTab === "analyse-plan" && (
        <AnalysePlanSection data={plan} onChange={setPlan} onNext={() => setTab("budget")} />
      )}
      {activeTab === "budget" && (
        <BudgetSection
          postes={postes}
          onChange={setPostes}
          onNext={() => setTab("synthese")}
          overview={overview}
          conformiteItems={conformite}
        />
      )}
      {activeTab === "synthese" && (
        <SyntheseSection overview={overview} conformite={conformite} plan={plan} postes={postes} />
      )}
    </div>
  );
}