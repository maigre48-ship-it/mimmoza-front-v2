// ─────────────────────────────────────────────────────────────────────────────
// AnalysePlanPage.tsx
// v9 : extraction surface officielle depuis spatialMetrics.totalSurface
//      (champ retourné par la Edge Function après ajout de la règle 13)
// ─────────────────────────────────────────────────────────────────────────────

import {
  AlertOctagon, AlertTriangle, ArrowRightLeft, BookOpen, CheckCircle2,
  ChevronDown, Eye, FileText, Info, Layers, LayoutGrid, Lightbulb,
  Loader2, Puzzle, Ruler, ScanLine, ShieldAlert, Sparkles, TriangleAlert,
  Upload, X, XCircle, Zap,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { analyzePlanReal } from "../services/analyzePlanReal";
import type {
  AnalysisError, AnalysisStatus, BuildingParams, BuildingType, ComplianceLevel,
  DetectedSpatialElements, ErpCategory, ErpType, FloorCount, IssueSeverity, PlanAnalysisResult,
  PlanUpload, RecommendationPriority, RiskLevel,
} from "../shared/planAnalysis.types";
import {
  useRehabilitationProject,
  type RehabilitationAnalysisResult,
} from "../shared/rehabilitationProject.store";
import { getActiveRehabProject } from "../lib/activeProjectData";

import { PlanOverlayViewer } from "../components/PlanOverlayViewer";
import { extractPlanMetadata } from "../plan-reader/planMetadataExtractor";
import { createEmptySnapshot, usePlanOverlaySnapshot } from "../plan-reader/planOverlayStore";
import { calibratePlan } from "../plan-reader/planScaleCalibrator";
import { validatePlan } from "../plan-reader/planValidationEngine";
import type {
  LayerVisibility,
  ValidationIssue as PipelineValidationIssue,
  PlanCalibration,
  PlanOverlaySnapshot, RawAIResult,
} from '../plan-reader/types';
import { EMPTY_GEOMETRY, confidenceLabel } from '../plan-reader/types';
import { transcribePlanReal, generatePlanId } from "../services/transcribePlanReal";
import { transcriptionToGeometry } from "../plan-reader/transcriptionToGeometry";
import { sumRoomSurfaces } from "../plan-reader/sumRoomSurfaces";
import { setActiveCopilotContext } from "@/spaces/copilot/store/activeCopilotContext.store";
import { evaluatePlanQuality, type QualityVerdict } from "../cv/planQualityGate";

// ─── Thème ────────────────────────────────────────────────────────────────────

const ACCENT       = "#f97316";
const ACCENT_LIGHT = "#fff7ed";
const ACCENT_DARK  = "#c2410c";
const GRAD         = "linear-gradient(135deg, #ea580c 0%, #fb923c 100%)";

// ─── Types locaux ─────────────────────────────────────────────────────────────

type EvidenceLevel =
  | "detected" | "to_confirm" | "not_verifiable" | "regulatory_assumption";
type ReadingReliability       = "forte" | "moyenne" | "faible";
type ReadingQuality           = "bonne" | "moyenne" | "faible";
type RegulatoryReadingQuality = "bonne" | "partielle" | "faible";
type PlanAnalysisIssue        = PlanAnalysisResult["issues"][number];

// ─── Constants ────────────────────────────────────────────────────────────────

const BUILDING_TYPES: BuildingType[] = [
  "ERP", "Logement", "Bureau", "Commerce", "Hôtel", "Résidence senior",
];
const ERP_TYPES: ErpType[]          = ["J", "M", "N", "O", "R", "U", "W"];
const ERP_CATEGORIES: ErpCategory[] = [1, 2, 3, 4, 5];
const FLOOR_COUNTS: FloorCount[]    = ["RDC", "R+1", "R+2", "R+3", "R+4+"];
const ACCEPTED_TYPES                = ["application/pdf", "image/png", "image/jpeg"];

const INITIAL_PARAMS: BuildingParams = {
  buildingType: "ERP", targetUsage: "", isErp: false,
  erpType: null, erpCategory: null, floorCount: "RDC",
  estimatedSurface: null, capacity: null,
};

const METRIC_PATTERN = /\b\d+[,.]\d+\s*m\b|\b\d+\s*m\b|\b\d+\s*ml\b/i;

const AI_ESTIMATED_SURFACE_RE =
  /(?:estim[ée]e?\s+(?:à|a)|environ|approximativement|approx\.?|~|≈|\bvers\b|\bautour\s+de|\bordre\s+de)\s*(\d{1,5}(?:[.,]\d{1,3})?)\s*m\s*[²2]/gi;

const SPATIAL_ELEMENT_LABELS: Record<string, string> = {
  halls: "Halls / Entrées", corridors: "Circulations", rooms: "Pièces principales",
  sanitarySpaces: "Sanitaires / WC", technicalRooms: "Locaux techniques",
  stairs: "Escaliers / Rampes", exits: "Issues de secours",
  receptionAreas: "Accueil / Réception", therapyAreas: "Espaces de thérapie",
  careRooms: "Salles de soins",
};

const PLACEHOLDER_VALUES = new Set([
  "vide", "-", "aucun", "non détecté", "non detecte",
  "aucun élément", "non identifié", "non identifie", "",
]);

// ─── Helpers généraux ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function filterSpatialItems(items: string[]): string[] {
  return items.filter((s) => {
    const n = s.trim().toLowerCase();
    return n.length > 0 && !PLACEHOLDER_VALUES.has(n);
  });
}

// ─── v8/v9 — Helpers pipeline plan-reader ─────────────────────────────────────

function concatAllResultText(result: PlanAnalysisResult): string {
  const parts: string[] = [];
  parts.push(result.summary ?? "");
  const obs = result.functionalObservations;
  if (obs) parts.push(...obs);
  const archReading = result.architecturalReading;
  if (archReading) {
    parts.push(
      archReading.geometry ?? "", archReading.functional ?? "",
      archReading.regulatory ?? "", archReading.summary ?? "",
    );
  }

  const spatialInt = result.spatialIntelligence;
  if (spatialInt) {
    parts.push(spatialInt.summary ?? "");
    parts.push(...(spatialInt.constraints ?? []));
    parts.push(...(spatialInt.opportunities ?? []));
  }

  const spatial = result.detectedSpatialElements;
  if (spatial) {
    for (const items of Object.values(spatial)) parts.push(...items);
  }

  for (const issue of result.issues) {
    parts.push(issue.title ?? "", issue.description ?? "", issue.regulatoryRef ?? "");
  }
  for (const rec of result.recommendations) {
    parts.push(rec.title ?? "", rec.description ?? "");
  }

  return parts.join("\n");
}

function extractAIEstimatedSurface(text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(AI_ESTIMATED_SURFACE_RE)) {
    const v = Number(m[1].replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 100_000) {
      best = best === null ? v : Math.max(best, v);
    }
  }
  return best;
}

function imageDimensionsFromDataUrl(
  dataUrl: string,
): Promise<{ widthPx: number; heightPx: number }> {
  if (!dataUrl.startsWith("data:image/")) {
    return Promise.resolve({ widthPx: 0, heightPx: 0 });
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload  = () => resolve({ widthPx: img.naturalWidth, heightPx: img.naturalHeight });
    img.onerror = () => resolve({ widthPx: 0, heightPx: 0 });
    img.src = dataUrl;
  });
}

// ─── Configs qualitatives ─────────────────────────────────────────────────────

function complianceLevelConfig(level: ComplianceLevel) {
  switch (level) {
    case "conforme":     return { label: "Apparemment conforme",       cls: "text-emerald-700 bg-emerald-50 border-emerald-200" };
    case "partiel":      return { label: "Partiellement conforme",     cls: "text-amber-700 bg-amber-50 border-amber-200" };
    case "non_conforme": return { label: "Non-conformité potentielle", cls: "text-red-700 bg-red-50 border-red-200" };
    case "non_evalue":   return { label: "Non évalué",                 cls: "text-slate-500 bg-slate-100 border-slate-200" };
  }
}

function riskLevelConfig(level: RiskLevel) {
  switch (level) {
    case "faible":   return { label: "Faible",   description: "Aucun point bloquant identifié à ce stade.",                          cls: "text-emerald-700 bg-emerald-50", bar: "bg-emerald-400", barWidth: "25%" };
    case "modere":   return { label: "Modéré",   description: "Quelques points à clarifier avant travaux.",                          cls: "text-amber-700 bg-amber-50",   bar: "bg-amber-400",   barWidth: "50%" };
    case "eleve":    return { label: "Élevé",    description: "Plusieurs non-conformités potentielles à instruire.",                 cls: "text-orange-700 bg-orange-50", bar: "bg-orange-400",  barWidth: "75%" };
    case "critique": return { label: "Critique", description: "Points bloquants détectés — expertise obligatoire avant engagement.", cls: "text-red-700 bg-red-50",       bar: "bg-red-500",     barWidth: "100%" };
  }
}

function severityConfig(severity: IssueSeverity, reliability: ReadingReliability) {
  const weak = reliability === "faible" || reliability === "moyenne";
  switch (severity) {
    case "non_conforme": return {
      icon: <XCircle className="w-4 h-4" />,
      label: weak ? "Non-conformité potentielle" : "Non-conformité identifiée",
      badgeCls: "bg-red-50 text-red-700 border-red-200",
      cardCls:  "border-l-red-400 bg-red-50/40", dotCls: "bg-red-400",
    };
    case "a_verifier": return {
      icon: <AlertTriangle className="w-4 h-4" />,
      label: "À vérifier",
      badgeCls: "bg-amber-50 text-amber-700 border-amber-200",
      cardCls:  "border-l-amber-400 bg-amber-50/40", dotCls: "bg-amber-400",
    };
    case "conforme": return {
      icon: <CheckCircle2 className="w-4 h-4" />,
      label: "Conformité apparente",
      badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200",
      cardCls:  "border-l-emerald-400 bg-emerald-50/40", dotCls: "bg-emerald-400",
    };
  }
}

function priorityConfig(priority: RecommendationPriority) {
  switch (priority) {
    case "urgente":     return { label: "À confirmer en priorité", cls: "bg-red-100 text-red-700 border-red-200" };
    case "importante":  return { label: "Importante",              cls: "bg-amber-100 text-amber-700 border-amber-200" };
    case "recommandee": return { label: "Recommandée",             cls: "bg-orange-50 text-orange-700 border-orange-200" };
  }
}

// ─── EvidenceLevel ────────────────────────────────────────────────────────────

function inferEvidenceLevel(issue: PlanAnalysisIssue): EvidenceLevel {
  const apiLevel = issue.evidenceLevel;
  if (apiLevel && ["detected", "to_confirm", "not_verifiable", "regulatory_assumption"].includes(apiLevel)) {
    return apiLevel;
  }
  const corpus = [issue.title ?? "", issue.description ?? "", issue.regulatoryRef ?? "", issue.planZone ?? ""]
    .join(" ").toLowerCase();
  if (/type\s+[jmnoruw]|catégorie\s+erp|classement\s+erp|erp\s+type|établissement.{0,20}type/i.test(corpus))
    return "regulatory_assumption";
  if (/coupe[- ]feu|ssi|système\s+de\s+(sécurité|détection)|résistance\s+au\s+feu|rf\s*\d|matériau|pare[- ]flamme|non.{0,20}vérifiabl/i.test(corpus))
    return "not_verifiable";
  if (
    /à confirmer|semble|ne peut être confirmé|vérification|apparent|supposé|estimé|mesure indiquée|probable|potentiellement/i.test(corpus) ||
    METRIC_PATTERN.test(corpus)
  ) return "to_confirm";
  return "detected";
}

function evidenceConfig(level: EvidenceLevel) {
  switch (level) {
    case "detected":              return { label: "Détecté sur plan",          badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200", dotCls: "bg-emerald-400" };
    case "to_confirm":            return { label: "À confirmer sur plan coté", badgeCls: "bg-amber-50 text-amber-700 border-amber-200",       dotCls: "bg-amber-400" };
    case "not_verifiable":        return { label: "Non vérifiable sur image",  badgeCls: "bg-slate-100 text-slate-600 border-slate-200",      dotCls: "bg-slate-400" };
    case "regulatory_assumption": return { label: "Hypothèse réglementaire",   badgeCls: "bg-blue-50 text-blue-700 border-blue-200",          dotCls: "bg-blue-400" };
  }
}

// ─── Fiabilité ────────────────────────────────────────────────────────────────

function resolveReadingReliability(result: PlanAnalysisResult): ReadingReliability {
  const api = result.reliability;
  if (api && ["forte", "moyenne", "faible"].includes(api)) return api;
  return computeReadingReliability(result.issues);
}

function computeReadingReliability(issues: PlanAnalysisIssue[]): ReadingReliability {
  const levels    = issues.map(inferEvidenceLevel);
  const total     = levels.length || 1;
  const detected  = levels.filter((l) => l === "detected").length;
  const weak      = levels.filter((l) => l === "not_verifiable" || l === "regulatory_assumption").length;
  const toConfirm = levels.filter((l) => l === "to_confirm").length;
  if (detected >= total / 2)                                 return "forte";
  if (weak >= total / 2 || toConfirm + weak >= total * 0.75) return "faible";
  return "moyenne";
}

function reliabilityConfig(r: ReadingReliability) {
  switch (r) {
    case "forte":   return { label: "Forte",   description: "La majorité des éléments a été détectée directement sur le plan.",       cls: "text-emerald-700 bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" };
    case "moyenne": return { label: "Moyenne", description: "Plusieurs éléments nécessitent confirmation sur plan coté.",              cls: "text-amber-700 bg-amber-50 border-amber-200",       dot: "bg-amber-500" };
    case "faible":  return { label: "Faible",  description: "Nombreux éléments non vérifiables ou fondés sur hypothèse réglementaire.", cls: "text-red-700 bg-red-50 border-red-200",             dot: "bg-red-500" };
  }
}

function readingQualityConfig(q: ReadingQuality | RegulatoryReadingQuality | string) {
  switch (q) {
    case "bonne":     return { label: "Bonne",     color: "#16a34a", bg: "#f0fdf4", bar: 100 };
    case "partielle": return { label: "Partielle", color: "#d97706", bg: "#fffbeb", bar: 60  };
    case "moyenne":   return { label: "Moyenne",   color: "#d97706", bg: "#fffbeb", bar: 60  };
    case "faible":    return { label: "Faible",    color: "#dc2626", bg: "#fef2f2", bar: 25  };
    default:          return { label: String(q),   color: "#6b7280", bg: "#f9fafb", bar: 40  };
  }
}

// ─── softenIssueText ──────────────────────────────────────────────────────────

const SOFTEN_RULES: [RegExp, string][] = [
  [/présente une largeur de/gi,          "semble présenter une largeur estimée de"],
  [/présentent une largeur libre/gi,     "semblent présenter une largeur libre"],
  [/impose un minimum/gi,                "prévoit généralement un minimum"],
  [/est obligatoire/gi,                  "est généralement requis"],
  [/est conforme\b/gi,                   "semble conforme sous réserve de vérification"],
  [/cloisonnement coupe-feu apparent/gi, "cloisonnement potentiellement coupe-feu, non vérifiable sur image seule"],
  [/\bexcède\b/gi,                       "pourrait excéder"],
  [/\bexcèdent\b/gi,                     "pourraient excéder"],
  [/\bconforme\b(?! sous réserve)/gi,    "potentiellement conforme"],
];

function softenIssueText(text: string): string {
  return SOFTEN_RULES.reduce((s, [pat, rep]) => s.replace(pat, rep), text);
}

// ─── detectErpInconsistency ───────────────────────────────────────────────────

function detectErpInconsistency(result: PlanAnalysisResult, params: BuildingParams): boolean {
  if (!params.isErp || !params.erpType) return false;
  const corpus = result.issues
    .map((i) => `${i.description ?? ""} ${i.regulatoryRef ?? ""} ${i.title ?? ""}`)
    .join(" ");
  return (["J", "M", "N", "O", "R", "U", "W"] as ErpType[])
    .filter((t) => t !== params.erpType)
    .some((t) => new RegExp(`type\\s+${t}\\b`, "i").test(corpus));
}

// ─── EvidenceCounts ───────────────────────────────────────────────────────────

interface EvidenceCounts {
  detected: number; to_confirm: number;
  not_verifiable: number; regulatory_assumption: number;
}

function computeEvidenceCounts(issues: PlanAnalysisIssue[]): EvidenceCounts {
  return issues.reduce<EvidenceCounts>(
    (acc, issue) => { acc[inferEvidenceLevel(issue)]++; return acc; },
    { detected: 0, to_confirm: 0, not_verifiable: 0, regulatory_assumption: 0 },
  );
}

// ─── Composants UI génériques ─────────────────────────────────────────────────

const Card: React.FC<{ children: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ children, className = "", style }) => (
  <div className={`bg-white border border-slate-200 rounded-2xl shadow-sm ${className}`} style={style}>{children}</div>
);

const PlanPreview: React.FC<{ plan: PlanUpload }> = ({ plan }) => {
  const [zoomed, setZoomed] = React.useState(false);
  const isPdf = plan.file.type === "application/pdf";
  const isImg = plan.file.type === "image/png" || plan.file.type === "image/jpeg";
  return (
    <>
      <div className="mt-4 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 relative" style={{ minHeight: 220 }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-white">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Aperçu du plan</span>
          {isImg && (
            <button onClick={() => setZoomed(true)}
              className="text-xs font-medium flex items-center gap-1 px-2 py-1 rounded-lg transition-colors hover:bg-slate-100"
              style={{ color: ACCENT }}>
              <Eye className="w-3.5 h-3.5" /> Plein écran
            </button>
          )}
        </div>
        {isImg && (
          <div className="flex items-center justify-center p-3 cursor-zoom-in" onClick={() => setZoomed(true)}>
            <img src={plan.previewUrl} alt="Aperçu du plan"
              className="max-w-full rounded-lg object-contain transition-all duration-300"
              style={{ maxHeight: 420, boxShadow: "0 1px 8px rgba(0,0,0,0.08)" }} />
          </div>
        )}
        {isPdf && (
          <iframe src={plan.previewUrl} title="Aperçu PDF" className="w-full" style={{ height: 420, border: "none" }} />
        )}
      </div>
      {zoomed && isImg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(4px)" }}
          onClick={() => setZoomed(false)}>
          <button onClick={() => setZoomed(false)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
            aria-label="Fermer">
            <X className="w-5 h-5 text-white" />
          </button>
          <img src={plan.previewUrl} alt="Plan — plein écran"
            className="max-w-full max-h-full rounded-xl object-contain"
            style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}
            onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
};

const SectionTitle: React.FC<{ icon: React.ReactNode; title: string; badge?: string }> = ({ icon, title, badge }) => (
  <div className="flex items-center gap-2.5 mb-5">
    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: ACCENT_LIGHT, color: ACCENT }}>{icon}</div>
    <h2 className="text-base font-semibold text-slate-800">{title}</h2>
    {badge && (
      <span className="ml-auto text-xs font-medium px-2.5 py-1 rounded-full border"
        style={{ background: ACCENT_LIGHT, color: ACCENT_DARK, borderColor: "#fed7aa" }}>
        {badge}
      </span>
    )}
  </div>
);

const StyledSelect: React.FC<{
  label: string; value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void; hint?: string;
}> = ({ label, value, options, onChange, hint }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</label>
    <div className="relative">
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none transition-colors pr-9">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
    </div>
    {hint && <p className="text-xs text-slate-400">{hint}</p>}
  </div>
);

const StyledInput: React.FC<{
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; suffix?: string; type?: "text" | "number";
}> = ({ label, value, onChange, placeholder, suffix, type = "text" }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</label>
    <div className="relative">
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-300 focus:outline-none transition-colors" />
      {suffix && <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">{suffix}</span>}
    </div>
  </div>
);

const ToggleSwitch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <div className="flex items-center gap-3">
    <div className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 cursor-pointer"
      style={{ background: checked ? ACCENT : "#e2e8f0" }}
      onClick={() => onChange(!checked)}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </div>
    <span className="text-sm text-slate-700 font-medium">{label}</span>
  </div>
);

const EvidenceBadge: React.FC<{ level: EvidenceLevel }> = ({ level }) => {
  const cfg = evidenceConfig(level);
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cfg.badgeCls}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dotCls}`} />
      {cfg.label}
    </span>
  );
};

const LOADING_STEPS = [
  "Lecture du plan…",
  "Extraction géométrique…",
  "Vérifications réglementaires…",
  "Calibration et validation métier…",
];

const AnalysisLoading: React.FC<{ step: number }> = ({ step }) => (
  <Card className="p-8">
    <div className="flex flex-col items-center gap-6 py-4">
      <div className="relative">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: ACCENT_LIGHT }}>
          <ScanLine className="w-8 h-8 animate-pulse" style={{ color: ACCENT }} />
        </div>
        <div className="absolute -top-1 -right-1">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: ACCENT }} />
        </div>
      </div>
      <div className="flex flex-col items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Analyse en cours</h3>
        <p className="text-sm text-slate-400 text-center">{LOADING_STEPS[step] ?? "Finalisation…"}</p>
      </div>
      <div className="w-full max-w-xs flex flex-col gap-2">
        {LOADING_STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full flex items-center justify-center transition-colors"
              style={{ background: i < step ? ACCENT : i === step ? "#fed7aa" : "#f1f5f9" }}>
              {i < step  && <CheckCircle2 className="w-3 h-3 text-white" />}
              {i === step && <Loader2 className="w-2.5 h-2.5 animate-spin" style={{ color: ACCENT }} />}
            </div>
            <span className={`text-xs ${i === step ? "text-slate-700 font-medium" : i < step ? "text-slate-400 line-through" : "text-slate-300"}`}>{s}</span>
          </div>
        ))}
      </div>
    </div>
  </Card>
);

const PrudentReadingAlert: React.FC = () => (
  <div className="flex items-start gap-3 p-4 rounded-xl border border-blue-200 bg-blue-50">
    <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
    <div>
      <p className="text-sm font-semibold text-blue-800 mb-1">Lecture prudente de l'analyse</p>
      <p className="text-xs text-blue-700 leading-relaxed">
        Mimmoza distingue les éléments détectés sur le plan des hypothèses réglementaires et des points nécessitant
        une confirmation sur plan coté. Les cotes, distances d'évacuation, largeurs de portes, classements ERP et
        performances coupe-feu doivent être vérifiés par un professionnel.
      </p>
    </div>
  </div>
);

const ErpInconsistencyAlert: React.FC = () => (
  <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-300 bg-amber-50">
    <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
    <div>
      <p className="text-sm font-semibold text-amber-800 mb-1">Incohérence réglementaire détectée</p>
      <p className="text-xs text-amber-700 leading-relaxed">
        L'analyse mentionne un autre type ERP que celui renseigné. Vérifiez le classement ERP avant interprétation.
      </p>
    </div>
  </div>
);

const CotedPlanAlert: React.FC = () => (
  <div className="flex items-start gap-3 p-4 rounded-xl border" style={{ borderColor: "#fed7aa", background: ACCENT_LIGHT }}>
    <ScanLine className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: ACCENT }} />
    <div>
      <p className="text-sm font-semibold" style={{ color: ACCENT_DARK }}>Plan coté recommandé</p>
      <p className="text-xs leading-relaxed" style={{ color: "#9a3412" }}>
        Certaines conclusions nécessitent des cotes exactes : largeurs de couloirs, portes, distances d'évacuation,
        pente de rampe et espaces de manœuvre PMR.
      </p>
    </div>
  </div>
);

const StrongDisclaimer: React.FC = () => (
  <div className="flex items-start gap-3 p-5 rounded-xl border border-slate-200 bg-slate-50">
    <AlertTriangle className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
    <p className="text-xs text-slate-500 leading-relaxed">
      <span className="font-semibold text-slate-600">Cette analyse est une prélecture.</span>{" "}
      Elle ne constitue ni un avis de bureau de contrôle, ni une attestation réglementaire. Les conclusions doivent
      être confirmées par un architecte, un bureau de contrôle, le SDIS ou l'autorité compétente.
    </p>
  </div>
);

// ─── v8 — Alertes pipeline ────────────────────────────────────────────────────

const SurfaceMismatchAlert: React.FC<{ snapshot: PlanOverlaySnapshot }> = ({ snapshot }) => {
  const v = snapshot.validation;
  if (!v.surfaceIARejetee || v.surfaceOfficielleM2 === null || v.surfaceIAEstimeeM2 === null) return null;
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border border-red-300 bg-red-50">
      <AlertOctagon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-red-800 mb-1">Surface IA incohérente avec la surface officielle détectée.</p>
        <p className="text-xs text-red-700 leading-relaxed">
          Le plan indique <strong>{v.surfaceOfficielleM2.toFixed(1)} m²</strong>, l'IA propose{" "}
          <strong>{v.surfaceIAEstimeeM2.toFixed(1)} m²</strong> (écart{" "}
          <strong>{((v.ecartRelatif ?? 0) * 100).toFixed(0)} %</strong>). La surface IA est rejetée ;
          la surface officielle est retenue pour la page Création de plan.
        </p>
      </div>
    </div>
  );
};

const PipelineIssuesPanel: React.FC<{ issues: PipelineValidationIssue[] }> = ({ issues }) => {
  const filtered = issues.filter((i) => i.code !== "SURFACE_IA_INCOHERENTE");
  if (filtered.length === 0) return null;
  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Vérifications pipeline</p>
      {filtered.map((it, i) => {
        const cls =
          it.severity === "error"   ? "border-red-200 bg-red-50/60 text-red-700" :
          it.severity === "warning" ? "border-amber-200 bg-amber-50/60 text-amber-700" :
                                      "border-slate-200 bg-slate-50 text-slate-600";
        return (
          <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${cls}`}>
            <span className="font-mono text-[10px] opacity-70 mt-0.5">{it.code}</span>
            <span className="flex-1">{it.message}</span>
          </div>
        );
      })}
    </div>
  );
};

const PipelineMetadataPanel: React.FC<{ snapshot: PlanOverlaySnapshot }> = ({ snapshot }) => {
  const m = snapshot.metadata;
  const c = snapshot.calibration;
  const renderField = (value: string | number | null, suffix = "") => {
    if (value === null || value === "") return <em className="text-slate-400 not-italic font-normal">à confirmer</em>;
    return <span className="font-medium text-slate-800">{value}{suffix}</span>;
  };
  const rows = [
    { label: "Surface totale (plan)", value: renderField(m.surfaceTotale.value, " m²"),     hint: confidenceLabel(m.surfaceTotale.confidence) },
    { label: "Échelle",               value: m.echelle.value ? <span className="font-medium text-slate-800">1/{m.echelle.value}</span> : <em className="text-slate-400 not-italic">à confirmer</em>, hint: confidenceLabel(m.echelle.confidence) },
    { label: "Niveau",                value: renderField(m.niveau.value),                   hint: confidenceLabel(m.niveau.confidence) },
    { label: "Hauteur sous plafond",  value: renderField(m.hauteurSousPlafond.value, " m"), hint: confidenceLabel(m.hauteurSousPlafond.confidence) },
    { label: "Date document",         value: renderField(m.dateDocument.value),             hint: confidenceLabel(m.dateDocument.confidence) },
    { label: "Format papier",         value: renderField(m.formatPapier.value),             hint: confidenceLabel(m.formatPapier.confidence) },
    { label: "Calibration",           value: <span className="font-medium text-slate-800">{c.method ?? "—"}</span>, hint: c.pixelsPerMeter ? `${c.pixelsPerMeter.toFixed(1)} px/m` : "—" },
  ];
  return (
    <div className="mt-5 rounded-xl border border-slate-100 overflow-hidden">
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Métadonnées détectées</span>
      </div>
      <dl className="divide-y divide-slate-50">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 px-4 py-2">
            <dt className="text-xs text-slate-500">{r.label}</dt>
            <dd className="flex items-center gap-2 text-sm">
              {r.value}
              {r.hint && <span className="text-[10px] text-slate-400 italic">({r.hint})</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

const SurfaceArbitrationCard: React.FC<{ snapshot: PlanOverlaySnapshot }> = ({ snapshot }) => {
  const v = snapshot.validation;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
      <div className="p-4 rounded-xl border" style={{ background: ACCENT_LIGHT, borderColor: "#fed7aa" }}>
        <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "#9a3412" }}>Surface retenue</div>
        <div className="mt-1 text-2xl font-bold" style={{ color: "#7c2d12" }}>
          {v.surfaceRetenueM2 !== null ? `${v.surfaceRetenueM2.toFixed(1)} m²` : "—"}
        </div>
        <div className="mt-1 text-[11px]" style={{ color: "#9a3412" }}>Surface retenue pour le projet</div>
      </div>
      <div className="p-4 rounded-xl border border-slate-200 bg-white">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Surface officielle (plan)</div>
        <div className="mt-1 text-2xl font-bold text-slate-800">
          {v.surfaceOfficielleM2 !== null ? `${v.surfaceOfficielleM2.toFixed(1)} m²` : <em className="text-slate-400 not-italic font-normal text-base">non détectée</em>}
        </div>
        <div className="mt-1 text-[11px] text-slate-400">Texte explicite « Surface totale »</div>
      </div>
      <div className="p-4 rounded-xl border border-slate-200 bg-white">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Surface estimée IA</div>
        <div className="mt-1 text-2xl font-bold"
          style={{ color: v.surfaceIARejetee ? "#dc2626" : "#0f172a", textDecoration: v.surfaceIARejetee ? "line-through" : "none" }}>
          {v.surfaceIAEstimeeM2 !== null ? `${v.surfaceIAEstimeeM2.toFixed(1)} m²` : <em className="text-slate-400 not-italic font-normal text-base">non fournie</em>}
        </div>
        <div className="mt-1 text-[11px] text-slate-400">
          {v.surfaceIARejetee ? `Rejetée — écart ${((v.ecartRelatif ?? 0) * 100).toFixed(0)} %`
            : v.ecartRelatif !== null ? `Écart ${(v.ecartRelatif * 100).toFixed(0)} %` : "À comparer"}
        </div>
      </div>
    </div>
  );
};

const CalquesUnavailableBanner: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50">
    <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
    <div className="flex-1">
      <p className="text-sm font-semibold text-amber-800 mb-1">Calques géométriques indisponibles</p>
      <p className="text-xs text-amber-700 leading-relaxed">{message}</p>
      <p className="text-[11px] text-amber-600 mt-1.5">
        L'analyse réglementaire ci-dessous reste valable — seuls les calques superposés nécessitent un export CAO couleur net (≥ 1500 px).
      </p>
    </div>
  </div>
);

const PlanOverlayInsightSection: React.FC<{
  snapshot: PlanOverlaySnapshot;
  onToggleLayer: (layer: keyof LayerVisibility) => void;
  quality: QualityVerdict | null;
}> = ({ snapshot, onToggleLayer, quality }) => {
  const hasImage = !!snapshot.sourceImage.dataUrl && snapshot.sourceImage.widthPx > 0;
  const calquesEligible = quality ? quality.eligible : true;
  return (
    <Card className="p-6">
      <SectionTitle icon={<Layers className="w-4 h-4" />} title="Lecture du plan — calques superposés" badge="Pipeline v1" />
      <SurfaceMismatchAlert snapshot={snapshot} />
      <div className={snapshot.validation.surfaceIARejetee ? "mt-4" : ""}>
        <SurfaceArbitrationCard snapshot={snapshot} />
      </div>
      {!calquesEligible ? (
        <CalquesUnavailableBanner message={quality?.message ?? "Calques indisponibles pour ce plan."} />
      ) : hasImage ? (
        <PlanOverlayViewer snapshot={snapshot} onToggleLayer={onToggleLayer} maxHeight={520} />
      ) : (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
          <Ruler className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-700 mb-1">Viewer multi-calques indisponible</p>
            <p className="text-xs text-slate-500 leading-relaxed">
              Pour un PDF, exportez le plan en PNG ou JPG depuis votre logiciel CAO pour activer l'affichage des calques.
            </p>
          </div>
        </div>
      )}
      <PipelineMetadataPanel snapshot={snapshot} />
      <PipelineIssuesPanel issues={snapshot.validation.issues} />
    </Card>
  );
};

// ─── QualitativeKpiGrid ───────────────────────────────────────────────────────

const QualitativeKpiGrid: React.FC<{
  result: PlanAnalysisResult;
  reliability: ReadingReliability;
  counts: EvidenceCounts;
  issuesByGroup: { non_conforme: PlanAnalysisIssue[]; a_verifier: PlanAnalysisIssue[]; conforme: PlanAnalysisIssue[] };
}> = ({ result, reliability, counts, issuesByGroup }) => {
  const relCfg  = reliabilityConfig(reliability);
  const riskCfg = riskLevelConfig(result.riskLevel);
  const pmrCfg  = complianceLevelConfig(result.pmrLevel);
  const fireCfg = complianceLevelConfig(result.fireSafetyLevel);
  const weak    = reliability === "faible" || reliability === "moyenne";
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-slate-400" />
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Fiabilité de lecture</p>
          </div>
          <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border self-start ${relCfg.cls}`}>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${relCfg.dot}`} />
            <span className="text-sm font-bold">{relCfg.label}</span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">{relCfg.description}</p>
        </div>
        <div className="flex flex-col gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-slate-400" />
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Risque réglementaire</p>
          </div>
          <div className={`inline-flex items-center px-3 py-2 rounded-lg self-start text-sm font-bold ${riskCfg.cls}`}>{riskCfg.label}</div>
          <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${riskCfg.bar}`} style={{ width: riskCfg.barWidth }} />
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">{riskCfg.description}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2 p-4 rounded-xl border border-slate-100 bg-slate-50/60">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Accessibilité PMR</p>
          <span className={`inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-semibold border self-start ${pmrCfg.cls}`}>{pmrCfg.label}</span>
        </div>
        <div className="flex flex-col gap-2 p-4 rounded-xl border border-slate-100 bg-slate-50/60">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Sécurité incendie</p>
          <span className={`inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-semibold border self-start ${fireCfg.cls}`}>{fireCfg.label}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: <XCircle className="w-4 h-4 text-red-400" />,        value: issuesByGroup.non_conforme.length, label: weak ? "Non-conformités potentielles" : "Non-conformités identifiées", cls: "border-red-100 bg-red-50/50",     valueCls: "text-red-600" },
          { icon: <TriangleAlert className="w-4 h-4 text-amber-400" />, value: counts.to_confirm,                label: "À confirmer sur plan coté",                                          cls: "border-amber-100 bg-amber-50/50", valueCls: "text-amber-600" },
          { icon: <Eye className="w-4 h-4 text-slate-400" />,           value: counts.not_verifiable,            label: "Non vérifiables sur image",                                          cls: "border-slate-200 bg-slate-50",    valueCls: "text-slate-600" },
          { icon: <BookOpen className="w-4 h-4 text-blue-400" />,       value: counts.regulatory_assumption,     label: "Hypothèses réglementaires",                                          cls: "border-blue-100 bg-blue-50/50",   valueCls: "text-blue-600" },
        ].map(({ icon, value, label, cls, valueCls }) => (
          <div key={label} className={`flex flex-col gap-1.5 p-3 rounded-xl border ${cls}`}>
            {icon}
            <span className={`text-2xl font-bold tabular-nums ${valueCls}`}>{value}</span>
            <span className="text-[10px] text-slate-500 font-medium leading-tight">{label}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {(["detected", "to_confirm", "not_verifiable", "regulatory_assumption"] as EvidenceLevel[]).map((level) => {
          const count = counts[level];
          const cfg   = evidenceConfig(level);
          return (
            <span key={level} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.badgeCls}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotCls}`} />
              {count} {cfg.label.toLowerCase()}
            </span>
          );
        })}
      </div>
    </div>
  );
};

// ─── Sections architecturales ─────────────────────────────────────────────────

const ArchitecturalReadingSection: React.FC<{ result: PlanAnalysisResult }> = ({ result }) => {
  const ar = result.architecturalReading;
  if (!ar) return null;
  const scores = [
    { label: "Lecture géométrique",   value: ar.geometry   },
    { label: "Lecture fonctionnelle", value: ar.functional },
    { label: "Lecture réglementaire", value: ar.regulatory },
  ];
  return (
    <Card className="p-6">
      <SectionTitle icon={<Layers className="w-4 h-4" />} title="Lecture architecturale" badge="v2" />
      <div className="grid grid-cols-3 gap-3 mb-5">
        {scores.map((s) => {
          const cfg = readingQualityConfig(s.value);
          return (
            <div key={s.label} className="flex flex-col gap-2 p-3 rounded-xl border text-center"
              style={{ borderColor: cfg.color + "33", background: cfg.bg }}>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{s.label}</span>
              <span className="text-sm font-bold capitalize" style={{ color: cfg.color }}>{cfg.label}</span>
              <div className="w-full h-1.5 bg-white/60 rounded-full overflow-hidden mt-auto">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${cfg.bar}%`, background: cfg.color }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
        <p className="text-sm text-blue-900 leading-relaxed">{ar.summary}</p>
      </div>
    </Card>
  );
};

const SpatialElementsSection: React.FC<{ result: PlanAnalysisResult }> = ({ result }) => {
  const dse = result.detectedSpatialElements;
  if (!dse) return null;
  const populated = Object.entries(dse)
    .map(([key, items]) => ({ key, items: filterSpatialItems(items) }))
    .filter(({ items }) => items.length > 0);
  if (populated.length === 0) return null;
  return (
    <Card className="p-6">
      <SectionTitle icon={<Eye className="w-4 h-4" />} title="Éléments détectés sur le plan" badge={`${populated.length} catégories`} />
      <div className="flex flex-col gap-3">
        {populated.map(({ key, items }) => (
          <div key={key} className="rounded-xl border border-slate-100 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex-1">{SPATIAL_ELEMENT_LABELS[key] ?? key}</span>
              <span className="text-xs text-slate-400">{items.length}</span>
            </div>
            <ul className="divide-y divide-slate-50">
              {items.map((item, i) => (
                <li key={i} className="px-4 py-2 text-sm text-slate-700 flex items-start gap-2">
                  <span className="text-slate-300 flex-shrink-0 mt-0.5">—</span>{item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
};

const FunctionalObservationsSection: React.FC<{ result: PlanAnalysisResult }> = ({ result }) => {
  const obs = result.functionalObservations;
  if (!obs || obs.length === 0) return null;
  return (
    <Card className="p-6">
      <SectionTitle icon={<FileText className="w-4 h-4" />} title="Observations fonctionnelles" badge={`${obs.length} observations`} />
      <ul className="flex flex-col gap-2">
        {obs.map((o, i) => (
          <li key={i} className="flex items-start gap-3 rounded-lg border border-purple-50 bg-purple-50/50 px-4 py-2.5">
            <span className="text-purple-400 font-mono text-xs mt-0.5 flex-shrink-0">{String(i + 1).padStart(2, "0")}</span>
            <span className="text-sm text-slate-700">{o}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
};

type SpatialIntelligenceData = {
  flowQuality: "bonne" | "moyenne" | "faible";
  zoningQuality: "bonne" | "moyenne" | "faible";
  modularity: "bonne" | "moyenne" | "faible";
  constraints: string[]; opportunities: string[]; summary: string;
};

const SpatialIntelligenceSection: React.FC<{ result: PlanAnalysisResult }> = ({ result }) => {
  const si = result.spatialIntelligence;
  if (!si) return null;
  const scores = [
    { icon: <ArrowRightLeft className="w-4 h-4" />, label: "Qualité des flux",   value: si.flowQuality   },
    { icon: <LayoutGrid     className="w-4 h-4" />, label: "Zoning fonctionnel", value: si.zoningQuality },
    { icon: <Puzzle         className="w-4 h-4" />, label: "Modularité",          value: si.modularity    },
  ];
  const constraints   = filterSpatialItems(si.constraints);
  const opportunities = filterSpatialItems(si.opportunities);
  return (
    <Card className="p-6">
      <SectionTitle icon={<Sparkles className="w-4 h-4" />} title="Intelligence spatiale" badge="Flux · Zoning · Modularité" />
      <div className="grid grid-cols-3 gap-3 mb-5">
        {scores.map((s) => {
          const cfg = readingQualityConfig(s.value);
          return (
            <div key={s.label} className="flex flex-col gap-2 p-3 rounded-xl border text-center"
              style={{ borderColor: cfg.color + "33", background: cfg.bg }}>
              <div className="flex items-center justify-center gap-1.5 mb-0.5">
                <span style={{ color: cfg.color }}>{s.icon}</span>
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{s.label}</span>
              </div>
              <span className="text-sm font-bold capitalize" style={{ color: cfg.color }}>{cfg.label}</span>
              <div className="w-full h-1.5 bg-white/60 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${cfg.bar}%`, background: cfg.color }} />
              </div>
            </div>
          );
        })}
      </div>
      {si.summary && (
        <div className="rounded-xl border border-violet-100 bg-violet-50 p-4 mb-5">
          <p className="text-sm text-violet-900 leading-relaxed">{si.summary}</p>
        </div>
      )}
      {(constraints.length > 0 || opportunities.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {constraints.length > 0 && (
            <div className="rounded-xl border border-red-100 bg-red-50/40 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-red-100 bg-red-50">
                <AlertOctagon className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                <span className="text-xs font-semibold text-red-700 uppercase tracking-wider">Contraintes détectées</span>
                <span className="ml-auto text-xs text-red-400 font-medium">{constraints.length}</span>
              </div>
              <ul className="divide-y divide-red-50">
                {constraints.map((c, i) => (
                  <li key={i} className="px-4 py-2.5 flex items-start gap-2">
                    <span className="text-red-300 flex-shrink-0 mt-0.5 text-xs font-mono">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-sm text-slate-700 leading-snug">{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {opportunities.length > 0 && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-emerald-100 bg-emerald-50">
                <Lightbulb className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Opportunités spatiales</span>
                <span className="ml-auto text-xs text-emerald-500 font-medium">{opportunities.length}</span>
              </div>
              <ul className="divide-y divide-emerald-50">
                {opportunities.map((o, i) => (
                  <li key={i} className="px-4 py-2.5 flex items-start gap-2">
                    <span className="text-emerald-300 flex-shrink-0 mt-0.5 text-xs font-mono">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-sm text-slate-700 leading-snug">{o}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

// ─── Erreurs ──────────────────────────────────────────────────────────────────

const ERROR_TITLES: Record<string, string> = {
  NO_FILE: "Aucun plan chargé", TIMEOUT: "Délai dépassé",
  NETWORK_ERROR: "Erreur réseau", OPENAI_RATE_LIMIT: "Service surchargé",
  JSON_PARSE: "Réponse IA invalide", FILE_READ_ERROR: "Fichier illisible",
  UNSUPPORTED_FORMAT: "Format non supporté", INVALID_STRUCTURE: "Réponse incomplète",
};
function getErrorTitle(code: string): string { return ERROR_TITLES[code] ?? "Erreur d'analyse"; }

// ─────────────────────────────────────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────────────────────────────────────

export const AnalysePlanPage: React.FC = () => {
  const [plan,        setPlan]        = useState<PlanUpload | null>(null);
  const [isDragging,  setIsDragging]  = useState(false);
  const [params,      setParams]      = useState<BuildingParams>(INITIAL_PARAMS);
  const [status,      setStatus]      = useState<AnalysisStatus>("idle");
  const [loadingStep, setLoadingStep] = useState(0);
  const [result,      setResult]      = useState<PlanAnalysisResult | null>(null);
  const [error,       setError]       = useState<AnalysisError | null>(null);
  const [planQuality, setPlanQuality] = useState<QualityVerdict | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pré-remplit les paramètres depuis le projet réhab actif (restent éditables).
  useEffect(() => {
    const p = getActiveRehabProject();
    if (!p) return;
    setParams((prev) => ({
      ...prev,
      estimatedSurface: p.surfaceM2 ?? prev.estimatedSurface,
      targetUsage:      p.usageCible || prev.targetUsage,
      isErp:            p.erp === "oui" ? true : prev.isErp,
    }));
  }, []);

  const { plan: storePlan, updatePlan } = useRehabilitationProject();
  const [overlaySnapshot, updateOverlay] = usePlanOverlaySnapshot();

  useEffect(() => {
    if (plan || !storePlan?.imageDataUrl) return;
    fetch(storePlan.imageDataUrl)
      .then((r) => r.blob())
      .then((blob) => {
        const mimeType   = storePlan.imageDataUrl!.split(";")[0]?.split(":")[1] ?? "image/png";
        const file       = new File([blob], storePlan.fileName ?? "plan", { type: mimeType });
        const previewUrl = URL.createObjectURL(blob);
        setPlan({ file, previewUrl });
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleLayer = useCallback((layer: keyof LayerVisibility) => {
    updateOverlay((s) => ({
      ...s,
      layerVisibility: { ...s.layerVisibility, [layer]: !s.layerVisibility[layer] },
    }));
  }, [updateOverlay]);

  const handleFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) return;
    if (plan?.previewUrl) URL.revokeObjectURL(plan.previewUrl);
    setPlanQuality(null);
    setResult(null);          // purge l'analyse précédente
    setError(null);
    // purge toute surface/géométrie résiduelle d'un plan précédent
    updateOverlay((s) => ({ ...(s ?? createEmptySnapshot()), detectedGeometry: EMPTY_GEOMETRY }));
    setPlan({ file, previewUrl: URL.createObjectURL(file) });
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = (e.target?.result as string) ?? null;
      updatePlan({
        imageDataUrl: dataUrl, fileName: file.name,
        uploadedAt: new Date().toISOString(),
        analysisResult: undefined, hasStructuralWalls: undefined,
        hasWetZones: undefined, hasOpenings: undefined, detectedSurface: undefined,
      });
      if (dataUrl) {
        imageDimensionsFromDataUrl(dataUrl).then(({ widthPx, heightPx }) => {
          updateOverlay((s) => ({
            ...(s ?? createEmptySnapshot()),
            sourceImage: { dataUrl, filename: file.name, mimeType: file.type, widthPx, heightPx },
            metadata: createEmptySnapshot().metadata,
            calibration: createEmptySnapshot().calibration,
            detectedGeometry: EMPTY_GEOMETRY,
            aiHypothesis: null, generatedPlan: null,
            validation: createEmptySnapshot().validation,
          }));
        });
      }
    };
    reader.readAsDataURL(file);
  }, [plan, updatePlan, updateOverlay]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);

  const removePlan = () => {
    if (plan?.previewUrl) URL.revokeObjectURL(plan.previewUrl);
    setPlan(null);
    updatePlan({ imageDataUrl: null, fileName: null });
    updateOverlay((s) => ({
      ...s,
      sourceImage: createEmptySnapshot().sourceImage,
      detectedGeometry: EMPTY_GEOMETRY,
      aiHypothesis: null, generatedPlan: null,
      validation: createEmptySnapshot().validation,
      metadata: createEmptySnapshot().metadata,
      calibration: createEmptySnapshot().calibration,
    }));
  };

  const setParam = <K extends keyof BuildingParams>(key: K, value: BuildingParams[K]) =>
    setParams((prev) => ({ ...prev, [key]: value }));

  // ── Analyse ───────────────────────────────────────────────────────────────

  const handleAnalyze = async () => {
    if (!plan) {
      setError({ code: "NO_FILE", message: "Veuillez d'abord uploader un plan." });
      setStatus("error");
      return;
    }

    setStatus("analyzing");
    setResult(null);
    setError(null);
    setLoadingStep(0);

    const stepTimer = setInterval(() => {
      setLoadingStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1));
    }, 12_000);

    try {
      const analysisResult = await analyzePlanReal({ plan, building: params });
      clearInterval(stepTimer);
      setResult(analysisResult);
      setStatus("done");

      // ── V1.6 — pousse le plan au Copilot via pageSnapshot (canal lu par copilotClient) ──
      {
        const rc = sumRoomSurfaces(analysisResult);
        // Surface officielle recalculée en local (spatialMetrics est déclaré plus bas)
        const arLocal = analysisResult as unknown as Record<string, unknown>;
        const sm = arLocal.spatialMetrics as { totalSurface?: number | null } | undefined;
        const officialLocal =
          typeof sm?.totalSurface === "number" && sm.totalSurface > 0 ? sm.totalSurface : null;

        const anomalies = (analysisResult.issues ?? [])
          .filter((i) => i.severity === "non_conforme" || i.severity === "a_verifier")
          .map((i) => `${i.severity === "non_conforme" ? "❌" : "⚠️"} ${i.title ?? i.category ?? "—"}`)
          .slice(0, 20);

        console.log("[V1.6] push plan au Copilot:", {
          surface: officialLocal ?? rc.total,
          rooms: rc.count,
          anomalies: anomalies.length,
        });

        setActiveCopilotContext({
          vertical: "generique",
          pageContext: { pathname: "/rehabilitation/analyse-plan", space: "rehabilitation", tab: "analyse-plan" },
          pageSnapshot: {
            plan_summary: analysisResult.summary ?? null,
            plan_surface_retenue_m2: officialLocal ?? rc.total,
            plan_room_count: rc.count,
            plan_rooms: rc.rooms.length
              ? rc.rooms.map((r) => `${r.label} (${r.surfaceM2} m²)`).join(", ")
              : null,
            plan_anomalies: anomalies.length ? anomalies.join(" | ") : null,
          },
        });
      }

      // ── (1) Store rehabilitation ──────────────────────────────────────────
      const ar = analysisResult as unknown as Record<string, unknown>;
      const spatial: Partial<DetectedSpatialElements> =
        analysisResult.detectedSpatialElements ??
        (ar.spatialElements as Partial<DetectedSpatialElements>) ??
        (ar.rooms as Partial<DetectedSpatialElements>) ??
        {};

      console.log(
        "[AnalysePlanPage v11] detectedSpatialElements keys:",
        Object.keys(spatial),
        "| total items:",
        Object.values(spatial).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0),
      );
      console.log(
        "[v11] RAW detectedSpatialElements:",
        JSON.stringify(analysisResult.detectedSpatialElements)?.slice(0, 600) ?? "undefined",
      );
      console.log(
        "[v11] roomSum:",
        JSON.stringify(sumRoomSurfaces(analysisResult)),
        "| aiSurfaceFromText will read from summary/obs",
      );

      // ── v9 — Surface officielle depuis spatialMetrics.totalSurface ────────
      // La Edge Function retourne désormais ce champ quand une annotation
      // "Surface totale : X m²" est visible sur le plan (règle 13 du prompt).
      const spatialMetrics = ar.spatialMetrics as
        { totalSurface?: number | null; surfaceSource?: string } | undefined;
      const officialSurface: number | null =
        (typeof spatialMetrics?.totalSurface === "number" && spatialMetrics.totalSurface > 0)
          ? spatialMetrics.totalSurface
          : null;

      console.log(
        "[AnalysePlanPage v9] Surface officielle spatialMetrics:",
        officialSurface,
        "| source:", spatialMetrics?.surfaceSource ?? "—",
      );

      const roomSum = sumRoomSurfaces(analysisResult);

      updatePlan({
        analysisResult: {
          analyzedAt:              analysisResult.analyzedAt,
          riskLevel:               analysisResult.riskLevel,
          pmrLevel:                analysisResult.pmrLevel,
          fireSafetyLevel:         ar.fireSafetyLevel as string | undefined,
          summary:                 analysisResult.summary,
          detectedSpatialElements: spatial,
          functionalObservations:  ar.functionalObservations as string[] | undefined,
          // V1.6 — anomalies (subset) persistées pour le Copilot
          issues: analysisResult.issues?.map((i) => ({
            severity: i.severity,
            title:    i.title,
            category: i.category,
          })),
          spatialIntelligence:     ar.spatialIntelligence    as RehabilitationAnalysisResult["spatialIntelligence"],
          architecturalReading:    ar.architecturalReading   as RehabilitationAnalysisResult["architecturalReading"],
        } satisfies RehabilitationAnalysisResult,

        hasStructuralWalls: analysisResult.issues.some((i) =>
          ["porteur", "structure", "structural", "refend"].some((kw) =>
            (i.category ?? "").toLowerCase().includes(kw) ||
            (i.title    ?? "").toLowerCase().includes(kw),
          )
        ),
        hasWetZones:
          (spatial.sanitarySpaces?.length ?? 0) > 0 ||
          (spatial.therapyAreas?.length   ?? 0) > 0 ||
          (spatial.careRooms?.length      ?? 0) > 0,
        hasOpenings:
          (spatial.exits?.length ?? 0) > 0 ||
          analysisResult.issues.some((i) =>
            ["ouverture", "fenêtre", "porte", "baie"].some((kw) =>
              (i.category ?? "").toLowerCase().includes(kw),
            )
          ),

        // ── v10 — priorité : cartouche > somme des pièces (jamais le 78 formulaire) ──
        detectedSurface:
          officialSurface ??
          (roomSum.total && roomSum.total > 0 ? roomSum.total : undefined),
        detectedOpeningsCount: spatial.exits?.length ?? 0,
        detectedWetZonesCount:
          (spatial.sanitarySpaces?.length ?? 0) +
          (spatial.therapyAreas?.length   ?? 0),
        structuralWallsCount: analysisResult.issues.filter((i) =>
          ["porteur", "structure", "refend"].some((kw) =>
            (i.category ?? "").toLowerCase().includes(kw),
          )
        ).length,
      });

      // ── (2) Pipeline plan-reader v8/v9 ────────────────────────────────────
      setLoadingStep(LOADING_STEPS.length - 1);

      const allText           = concatAllResultText(analysisResult);
      const metadata          = extractPlanMetadata({ aiText: allText });
      const aiSurfaceFromText = extractAIEstimatedSurface(allText);

      // Priorité surface (JAMAIS params.estimatedSurface = le 78 du formulaire) :
      //   1. spatialMetrics.totalSurface (officielle, lue au cartouche)
      //   2. surface trouvée dans le discours IA ("environ X m²")
      //   3. somme des pièces détectées
      const aiEstimatedSurface: number | null =
        officialSurface
        ?? aiSurfaceFromText
        ?? (roomSum.total && roomSum.total > 0 ? roomSum.total : null);

      const dataUrl = storePlan?.imageDataUrl ?? null;
      const dims = dataUrl
        ? await imageDimensionsFromDataUrl(dataUrl)
        : { widthPx: 0, heightPx: 0 };

      const pipelineCalibration = calibratePlan({
        widthPx:          dims.widthPx,
        heightPx:         dims.heightPx,
        metadata,
        detectedGeometry: EMPTY_GEOMETRY,
      });

      const calibration: PlanCalibration = {
        pixelsPerMeter:    pipelineCalibration.pixelsPerMeter,
        method:            pipelineCalibration.pixelsPerMeter !== null ? "echelle" : null,
        confidence:        metadata.echelle.confidence,
        imageWidthPx:      pipelineCalibration.widthPx,
        imageHeightPx:     pipelineCalibration.heightPx,
        envelopeSurfaceM2: null,
      };

      const validation = validatePlan({
        metadata,
        calibration,
        detectedGeometry:     EMPTY_GEOMETRY,
        aiEstimatedSurfaceM2: aiEstimatedSurface,
      });

      const aiHypothesis: RawAIResult = {
        rawResponse: JSON.stringify({
          summary:         analysisResult.summary,
          aiSurface:       aiEstimatedSurface,
          officialSurface: officialSurface,
          surfaceSource:   spatialMetrics?.surfaceSource ?? "—",
          model:           analysisResult.engineMeta?.version,
        }),
        surfaceM2: aiEstimatedSurface,
        geometry:  EMPTY_GEOMETRY,
        metadata:  {},
        model:     analysisResult.engineMeta?.version ?? "vision",
        invokedAt: analysisResult.analyzedAt,
      };

      updateOverlay((s) => {
        const base = s ?? createEmptySnapshot();
        return {
          ...base,
          sourceImage: {
            dataUrl,
            filename: plan.file.name,
            mimeType: plan.file.type,
            widthPx:  dims.widthPx,
            heightPx: dims.heightPx,
          },
          metadata,
          calibration,
          aiHypothesis,
          validation,
        };
      });

      // ── (3) Gate qualité → calques (option A) ─────────────────────────────
      // On n'alimente les calques QUE si le plan respecte le contrat de qualité
      // (export CAO couleur net ≥ 1500 px). Sinon : bandeau honnête, aucun faux
      // calque, et on évite l'appel de transcription (économie).
      const quality = await evaluatePlanQuality(plan.previewUrl);
      setPlanQuality(quality);
      console.log(
        "[AnalysePlanPage] gate qualité —",
        quality.eligible ? "ÉLIGIBLE" : `REJETÉ (${quality.code})`,
        quality.metrics,
      );

      if (quality.eligible) {
        // 2e appel gpt-4o. Son échec ne doit jamais casser l'analyse déjà réussie.
        try {
          const planId = generatePlanId(plan.file.name ?? "plan");
          const transcription = await transcribePlanReal(planId, plan.file);
          // TODO(pipeline CV) : adapter PlanTranscriptionResult → TranscriptionResult.
          // En attendant, on ne convertit pas (types incompatibles) — l'analyse principale reste intacte.
          const geometry = transcriptionToGeometry(null);
          void transcription;
          updateOverlay((s) => ({ ...(s ?? createEmptySnapshot()), detectedGeometry: geometry }));
          console.log(
            "[AnalysePlanPage] calques alimentés —",
            geometry.walls.length, "murs,",
            geometry.rooms.length, "pièces,",
            geometry.openings.length, "ouvertures",
          );
        } catch (txErr) {
          console.warn("[AnalysePlanPage] transcription échouée (calques non alimentés):", txErr);
        }
      } else {
        // Plan hors contrat : on purge toute géométrie parasite.
        updateOverlay((s) => ({ ...(s ?? createEmptySnapshot()), detectedGeometry: EMPTY_GEOMETRY }));
      }

      // ── v10 — Surface finale : officielle (cartouche) SINON somme des pièces ─
      // On n'utilise JAMAIS la "surface estimée IA" comme surface retenue
      // (source du 78 m² fantôme). Hiérarchie stricte :
      //   1. officialSurface  → cartouche "Surface totale : X m²"
      //   2. somme des pièces détectées (surface plancher calculée)

      const finalSurface =
        officialSurface ??
        (roomSum.total && roomSum.total > 0 ? roomSum.total : null);

      console.log(
        "[AnalysePlanPage v10] surface —",
        "officielle:", officialSurface,
        "| somme pièces:", roomSum.total, `(${roomSum.count} pièces)`,
        "| retenue:", finalSurface,
      );
      if (finalSurface !== null && finalSurface > 0) {
        updatePlan({ detectedSurface: finalSurface });
        console.log("[AnalysePlanPage v9] detectedSurface final:", finalSurface, "m²");
      }

    } catch (err: unknown) {
      clearInterval(stepTimer);
      const code    = (err as { code?: string }).code ?? "ANALYSIS_FAILED";
      const message = (err as Error).message          ?? "Une erreur est survenue. Veuillez réessayer.";
      setError({ code, message });
      setStatus("error");
    }
  };

  // ── Dérivés ───────────────────────────────────────────────────────────────

  const issuesByGroup = result ? {
    non_conforme: result.issues.filter((i) => i.severity === "non_conforme"),
    a_verifier:   result.issues.filter((i) => i.severity === "a_verifier"),
    conforme:     result.issues.filter((i) => i.severity === "conforme"),
  } : null;

  const reliability    = result ? resolveReadingReliability(result) : null;
  const evidenceCounts = result ? computeEvidenceCounts(result.issues) : null;
  const hasErpMismatch = result ? detectErpInconsistency(result, params) : false;
  const hasCotedNeeded = evidenceCounts ? evidenceCounts.to_confirm > 0 : false;

  const showOverlaySection = useMemo(
    () => !!overlaySnapshot && !!overlaySnapshot.sourceImage.dataUrl,
    [overlaySnapshot],
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>

      {/* Bannière */}
      <div style={{
        background: GRAD, borderRadius: 24, padding: "32px 36px",
        marginBottom: 24, display: "flex", alignItems: "center",
        justifyContent: "space-between", flexWrap: "wrap", gap: 20,
        boxShadow: "0 8px 32px rgba(234,88,12,0.22)",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>

            Réhabilitation · Analyse du plan
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 600, color: "#fff", marginBottom: 10, lineHeight: 1.1, letterSpacing: "-0.025em" }}>

            Analyse du plan
          </h1>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", maxWidth: 460, lineHeight: 1.55 }}>
            Analyse réglementaire et fonctionnelle du bâtiment
          </p>
        </div>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "8px 14px", borderRadius: 12,
          background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)",
          color: "#fff", fontSize: 12, fontWeight: 700, flexShrink: 0,
        }}>
          <Sparkles size={13} />
          V9 — Surface officielle plan
        </span>
      </div>

      {/* Contenu */}
      <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Upload */}
        <Card className="p-6">
          <SectionTitle icon={<Upload className="w-4 h-4" />} title="Plan du bâtiment" badge="PDF · PNG · JPG" />
          {plan ? (
            <>
              <div className="flex items-center gap-4 p-4 rounded-xl border" style={{ background: ACCENT_LIGHT, borderColor: "#fed7aa" }}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#fed7aa" }}>
                  <FileText className="w-5 h-5" style={{ color: ACCENT_DARK }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{plan.file.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatBytes(plan.file.size)} — {plan.file.type === "application/pdf" ? "PDF" : plan.file.type === "image/png" ? "PNG" : "JPEG"}
                  </p>
                </div>
                <button onClick={removePlan}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  aria-label="Supprimer le plan">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <PlanPreview plan={plan} />
            </>
          ) : (
            <button type="button" onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
              className="w-full rounded-xl border-2 border-dashed p-10 flex flex-col items-center gap-3 transition-colors cursor-pointer"
              style={{ borderColor: isDragging ? ACCENT : "#e2e8f0", background: isDragging ? ACCENT_LIGHT : "#f8fafc" }}>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center transition-colors"
                style={{ background: isDragging ? "#fed7aa" : "#f1f5f9" }}>
                <Upload className="w-6 h-6" style={{ color: isDragging ? ACCENT : "#94a3b8" }} />
              </div>
              <div className="flex flex-col items-center gap-1">
                <p className="text-sm font-semibold text-slate-700">Déposer un plan ici</p>
                <p className="text-xs text-slate-400">
                  ou <span style={{ color: ACCENT }} className="font-medium underline underline-offset-2">cliquer pour parcourir</span>
                </p>
              </div>
              <p className="text-xs text-slate-300">PDF, PNG, JPG acceptés</p>
            </button>
          )}
          <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); e.target.value = ""; }} />
        </Card>

        {/* Paramètres bâtiment */}
        <Card className="p-6">
          <SectionTitle icon={<FileText className="w-4 h-4" />} title="Paramètres du bâtiment" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <StyledSelect label="Type de bâtiment" value={params.buildingType}
              options={BUILDING_TYPES.map((t) => ({ value: t, label: t }))}
              onChange={(v) => setParam("buildingType", v as BuildingType)} />
            <StyledInput label="Usage cible" value={params.targetUsage}
              onChange={(v) => setParam("targetUsage", v)}
              placeholder="Ex : Crèche privée, Résidence étudiante…" />
            <StyledSelect label="Niveaux" value={params.floorCount}
              options={FLOOR_COUNTS.map((f) => ({ value: f, label: f }))}
              onChange={(v) => setParam("floorCount", v as FloorCount)} />
            <StyledInput label="Surface estimée"
              value={params.estimatedSurface?.toString() ?? ""}
              onChange={(v) => setParam("estimatedSurface", v === "" ? null : parseFloat(v) || null)}
              type="number" placeholder="0" suffix="m²" />
            <StyledInput label="Capacité d'accueil"
              value={params.capacity?.toString() ?? ""}
              onChange={(v) => setParam("capacity", v === "" ? null : parseInt(v, 10) || null)}
              type="number" placeholder="0" suffix="pers." />
            <div className="flex flex-col gap-1.5 justify-center">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Établissement recevant du public</label>
              <ToggleSwitch
                checked={params.isErp}
                onChange={(v) => { setParam("isErp", v); if (!v) { setParam("erpType", null); setParam("erpCategory", null); } }}
                label={params.isErp ? "ERP activé" : "Non ERP"} />
            </div>
          </div>
          {params.isErp && (
            <div className="mt-5 pt-5 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Paramètres ERP</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <StyledSelect label="Type ERP" value={params.erpType ?? ""}
                  options={[{ value: "", label: "Sélectionner…" }, ...ERP_TYPES.map((t) => ({ value: t, label: `Type ${t}` }))]}
                  onChange={(v) => setParam("erpType", v === "" ? null : (v as ErpType))}
                  hint="J=Personnes âgées · M=Magasins · N=Restauration · O=Hôtels · R=Enseignement · U=Sanitaires · W=Bureaux" />
                <StyledSelect label="Catégorie ERP" value={params.erpCategory?.toString() ?? ""}
                  options={[
                    { value: "", label: "Sélectionner…" },
                    ...ERP_CATEGORIES.map((c) => ({
                      value: c.toString(),
                      label: `Catégorie ${c}${c === 1 ? " (> 1 500 pers.)" : c === 5 ? " (< seuil cat. 4)" : ""}`,
                    })),
                  ]}
                  onChange={(v) => setParam("erpCategory", v === "" ? null : (parseInt(v, 10) as ErpCategory))} />
              </div>
            </div>
          )}
        </Card>

        {/* Bouton Analyser */}
        <div className="flex justify-end">
          <button onClick={handleAnalyze} disabled={status === "analyzing"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 10,
              padding: "12px 28px", borderRadius: 12, border: "none",
              background: status === "analyzing" ? "#e2e8f0" : GRAD,
              color: status === "analyzing" ? "#94a3b8" : "#fff",
              fontSize: 14, fontWeight: 700,
              cursor: status === "analyzing" ? "not-allowed" : "pointer",
              transition: "all .15s",
              boxShadow: status === "analyzing" ? "none" : "0 2px 8px rgba(249,115,22,.35)",
            }}>
            {status === "analyzing"
              ? <><Loader2 className="w-4 h-4 animate-spin" />Analyse en cours…</>
              : <><Zap className="w-4 h-4" />Analyser le plan</>}
          </button>
        </div>

        {status === "analyzing" && <AnalysisLoading step={loadingStep} />}

        {/* Erreur */}
        {status === "error" && error && (
          <Card className="p-6" style={{ borderColor: "#fecaca", background: "#fef2f2" }}>
            <div className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-700 mb-1">{getErrorTitle(error.code)}</p>
                <p className="text-sm text-red-600">{error.message}</p>
                {error.code === "TIMEOUT" && <p className="text-xs text-red-400 mt-2">Conseil : réduisez la résolution du plan ou exportez-le en PNG depuis votre logiciel CAO.</p>}
                {error.code === "OPENAI_RATE_LIMIT" && <p className="text-xs text-red-400 mt-2">Le service est momentanément surchargé. Réessayez dans quelques secondes.</p>}
              </div>
            </div>
          </Card>
        )}

        {showOverlaySection && overlaySnapshot && (
          <PlanOverlayInsightSection snapshot={overlaySnapshot} onToggleLayer={handleToggleLayer} quality={planQuality} />
        )}

        {/* Résultats */}
        {status === "done" && result && reliability && evidenceCounts && issuesByGroup && (
          <div className="flex flex-col gap-5">
            <PrudentReadingAlert />
            {hasErpMismatch && <ErpInconsistencyAlert />}
            {hasCotedNeeded  && <CotedPlanAlert />}

            <Card className="p-6">
              <SectionTitle
                icon={<CheckCircle2 className="w-4 h-4" />}
                title="Résultats de l'analyse"
                badge={new Date(result.analyzedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              />
              <QualitativeKpiGrid result={result} reliability={reliability} counts={evidenceCounts} issuesByGroup={issuesByGroup} />
              <div className="mt-6 pt-5 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Synthèse</p>
                <p className="text-sm text-slate-600 leading-relaxed">{softenIssueText(result.summary)}</p>
              </div>
            </Card>

            <ArchitecturalReadingSection result={result} />
            <SpatialElementsSection result={result} />
            <FunctionalObservationsSection result={result} />
            <SpatialIntelligenceSection result={result} />

            {/* Points de contrôle */}
            <Card className="p-6">
              <SectionTitle icon={<AlertTriangle className="w-4 h-4" />} title="Points de contrôle" badge={`${result.issues.length} points`} />
              <div className="flex flex-col gap-3">
                {(["non_conforme", "a_verifier", "conforme"] as IssueSeverity[]).map((sev) => {
                  const issues = result.issues.filter((i) => i.severity === sev);
                  if (issues.length === 0) return null;
                  const cfg = severityConfig(sev, reliability);
                  return (
                    <div key={sev} className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-2 h-2 rounded-full ${cfg.dotCls}`} />
                        <span className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${cfg.badgeCls}`}>{cfg.label}</span>
                      </div>
                      {issues.map((issue) => {
                        const evidence = inferEvidenceLevel(issue);
                        return (
                          <div key={issue.id} className={`rounded-xl border-l-4 p-4 ${cfg.cardCls}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                  <span className="text-xs font-semibold text-slate-500 bg-white/70 px-2 py-0.5 rounded border border-slate-200/80">{issue.category}</span>
                                  {issue.planZone && <span className="text-xs text-slate-400">{issue.planZone}</span>}
                                  <EvidenceBadge level={evidence} />
                                  {Boolean(issue.confidence) && (
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-slate-50 text-slate-500 border-slate-200">
                                      Confiance {String(issue.confidence)}
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm font-semibold text-slate-800">{issue.title}</p>
                                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{softenIssueText(issue.description)}</p>
                                {issue.regulatoryRef && <p className="text-xs text-slate-400 mt-2 font-mono">📋 {issue.regulatoryRef}</p>}
                                {evidence === "not_verifiable" && (
                                  <p className="text-[10px] text-slate-400 mt-2 italic">Ce point ne peut pas être vérifié sur image seule — expertise technique requise.</p>
                                )}
                                {evidence === "regulatory_assumption" && (
                                  <p className="text-[10px] text-blue-500 mt-2 italic">Hypothèse fondée sur les paramètres ERP renseignés — à confirmer avec le SDIS ou l'autorité compétente.</p>
                                )}
                              </div>
                              <div className={`flex items-center gap-1 flex-shrink-0 text-xs font-medium px-2 py-1 rounded-lg border ${cfg.badgeCls}`}>{cfg.icon}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Recommandations */}
            <Card className="p-6">
              <SectionTitle icon={<Sparkles className="w-4 h-4" />} title="Recommandations" badge={`${result.recommendations.length} actions`} />
              <div className="flex flex-col gap-3">
                {(["urgente", "importante", "recommandee"] as RecommendationPriority[]).map((priority) => {
                  const recs = result.recommendations.filter((r) => r.priority === priority);
                  if (recs.length === 0) return null;
                  const cfg = priorityConfig(priority);
                  return (
                    <div key={priority} className="flex flex-col gap-2">
                      <span className={`self-start text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded border ${cfg.cls}`}>{cfg.label}</span>
                      {recs.map((rec, idx) => (
                        <div key={rec.id} className="bg-slate-50 border border-slate-100 rounded-xl p-4 hover:border-slate-200 transition-colors">
                          <div className="flex items-start gap-3">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                              style={{ background: ACCENT_LIGHT, color: ACCENT_DARK }}>
                              {idx + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-800">{rec.title}</p>
                              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{softenIssueText(rec.description)}</p>
                              {rec.estimatedCost && (
                                <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs text-slate-600 font-medium">
                                  <span>Coût estimé :</span>
                                  <span className="font-semibold text-slate-800">
                                    {rec.estimatedCost.min.toLocaleString("fr-FR")} – {rec.estimatedCost.max.toLocaleString("fr-FR")} {rec.estimatedCost.unit}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </Card>

            <StrongDisclaimer />

            <div className="flex items-center justify-end gap-2 text-xs text-slate-300 pb-2">
              <ScanLine className="w-3 h-3" />
              <span>Moteur {result.engineMeta.version} · Mode {result.engineMeta.mode} · Traitement {result.engineMeta.processingTimeMs} ms</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalysePlanPage;