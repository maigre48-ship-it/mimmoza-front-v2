// src/spaces/investisseur/pages/deal-center/tabs/ExportsTab.tsx
//
// Exports — V4 — Exports fonctionnels (jsPDF + XLSX + ZIP)
// Style identique à AnalysePage.tsx

import {
  AlertCircle,
  Archive,
  CheckCheck,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Info,
  Loader2,
  XCircle
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import useMarchandSnapshotTick from "../../../../marchand/shared/hooks/useMarchandSnapshotTick";
import {
  ensureActiveDeal,
  readMarchandSnapshot,
  type MarcheRisquesSaved,
  type RentabiliteSaved,
} from "../../../../marchand/shared/marchandSnapshot.store";

import type { RentabiliteSnapshot } from "../../../types/rentabilite.types";

// ─── Types ────────────────────────────────────────────────────────────────────

type ExportFormat  = "PDF" | "Excel" | "ZIP";
type ExportStatus  = "ready" | "partial" | "unavailable";
type ExportState   = "idle" | "loading" | "success" | "error";

interface ExportCard {
  id:          string;
  title:       string;
  description: string;
  format:      ExportFormat[];
  status:      ExportStatus;
  statusLabel: string;
  source:      string;
}

// ─── Toast interne ────────────────────────────────────────────────────────────

interface Toast {
  id:      number;
  type:    "success" | "error";
  message: string;
}

let toastCounter = 0;

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((type: Toast["type"], message: string) => {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  return { toasts, push };
}

function ToastStack({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 print:hidden">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[
            "flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ring-1",
            t.type === "success"
              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
              : "bg-red-50 text-red-800 ring-red-200",
          ].join(" ")}
        >
          {t.type === "success"
            ? <CheckCheck className="h-4 w-4 text-emerald-500 shrink-0" />
            : <XCircle    className="h-4 w-4 text-red-500    shrink-0" />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function castComputed(saved: RentabiliteSaved | undefined): RentabiliteSnapshot | null {
  if (!saved?.computed) return null;
  return saved.computed as RentabiliteSnapshot;
}

function deriveExportStatuses(
  deal:        ReturnType<typeof ensureActiveDeal>,
  snapshot:    RentabiliteSnapshot | null,
  marcheSaved: MarcheRisquesSaved  | undefined,
): Record<string, ExportStatus> {
  const hasBaseDeal = !!(deal?.prixAchat || deal?.address);
  const hasRenta    = !!snapshot?.scenarios?.base;
  const hasMarche   = !!marcheSaved?.data;

  const qualifStatus: ExportStatus =
    hasBaseDeal && (hasRenta || hasMarche) ? "partial"
    : hasBaseDeal ? "partial"
    : "unavailable";

  const dataConfStatus: ExportStatus =
    hasMarche || hasRenta ? "partial" : "unavailable";

  const invPackStatus: ExportStatus =
    hasBaseDeal && hasRenta ? "partial"
    : hasBaseDeal ? "partial"
    : "unavailable";

  const committeeStatus: ExportStatus =
    hasRenta && hasMarche ? "partial"
    : hasRenta || hasMarche ? "partial"
    : "unavailable";

  const financialStatus: ExportStatus =
    hasRenta ? "partial" : "unavailable";

  return {
    qualification:      qualifStatus,
    "data-confidence":  dataConfStatus,
    "investment-pack":  invPackStatus,
    "committee-review": committeeStatus,
    "financial-engine": financialStatus,
  };
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function getStatusCls(status: ExportStatus) {
  if (status === "ready")   return { wrapper: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200", icon: CheckCircle2, iconCls: "text-emerald-500" };
  if (status === "partial") return { wrapper: "bg-amber-50  text-amber-700  ring-1 ring-amber-200",    icon: AlertCircle,  iconCls: "text-amber-500"   };
  return                           { wrapper: "bg-gray-50   text-gray-500   ring-1 ring-gray-200",     icon: AlertCircle,  iconCls: "text-gray-400"    };
}

function getStatusLabel(status: ExportStatus): string {
  if (status === "ready")   return "Prêt";
  if (status === "partial") return "Données partielles";
  return "Données manquantes";
}

function getFormatCls(fmt: ExportFormat): string {
  if (fmt === "PDF")   return "bg-red-50    text-red-700    ring-1 ring-red-200";
  if (fmt === "Excel") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  return                      "bg-violet-50  text-violet-700  ring-1 ring-violet-200";
}

function getFormatIcon(fmt: ExportFormat) {
  if (fmt === "Excel") return FileSpreadsheet;
  if (fmt === "ZIP")   return Archive;
  return FileText;
}

// ─── Config cartes ────────────────────────────────────────────────────────────

function buildExportCards(statuts: Record<string, ExportStatus>): ExportCard[] {
  return [
    {
      id:          "qualification",
      title:       "Synthèse Qualification",
      description: "Scorecard, résumé exécutif, points favorables, vigilances, kill switches et recommandation Mimmoza.",
      format:      ["PDF"],
      status:      statuts["qualification"]     ?? "unavailable",
      statusLabel: getStatusLabel(statuts["qualification"]     ?? "unavailable"),
      source:      "Onglet Qualification",
    },
    {
      id:          "data-confidence",
      title:       "Rapport Data Confidence",
      description: "Matrice de fiabilité des sources, données manquantes et impact sur le SmartScore.",
      format:      ["PDF"],
      status:      statuts["data-confidence"]   ?? "unavailable",
      statusLabel: getStatusLabel(statuts["data-confidence"]   ?? "unavailable"),
      source:      "Onglet Data Confidence",
    },
    {
      id:          "investment-pack",
      title:       "Investment Pack",
      description: "Fiche deal, hypothèses financières, tableau de rentabilité, comparables DVF et risques synthétiques.",
      format:      ["PDF"],
      status:      statuts["investment-pack"]   ?? "unavailable",
      statusLabel: getStatusLabel(statuts["investment-pack"]   ?? "unavailable"),
      source:      "Onglet Investment Pack",
    },
    {
      id:          "committee-review",
      title:       "Rapport Comité",
      description: "Fiche de présentation, grille de décision, verdict GO/NO GO et conditions suspensives.",
      format:      ["PDF"],
      status:      statuts["committee-review"]  ?? "unavailable",
      statusLabel: getStatusLabel(statuts["committee-review"]  ?? "unavailable"),
      source:      "Onglet Committee Review",
    },
    {
      id:          "financial-engine",
      title:       "Modèle Financier",
      description: "Paramètres, résultats, scénarios, analyse de sensibilité et décomposition des charges.",
      format:      ["PDF", "Excel"],
      status:      statuts["financial-engine"]  ?? "unavailable",
      statusLabel: getStatusLabel(statuts["financial-engine"]  ?? "unavailable"),
      source:      "Onglet Financial Engine",
    },
  ];
}

// ─── Hook export individuel ───────────────────────────────────────────────────

function useExportFn(fn: () => Promise<void>, label: string, toast: (t: Toast["type"], m: string) => void) {
  const [state, setState] = useState<ExportState>("idle");

  const trigger = useCallback(async () => {
    if (state === "loading") return;
    setState("loading");
    try {
      await fn();
      setState("success");
      toast("success", `${label} téléchargé.`);
      setTimeout(() => setState("idle"), 2500);
    } catch (err) {
      console.error(`[Export] ${label}`, err);
      setState("error");
      toast("error", `Erreur lors de l'export : ${label}`);
      setTimeout(() => setState("idle"), 3000);
    }
  }, [fn, label, state, toast]);

  return { state, trigger };
}

// ─── Bouton export ────────────────────────────────────────────────────────────

interface ExportButtonProps {
  label:    string;
  disabled: boolean;
  state:    ExportState;
  onClick:  () => void;
  size?:    "sm" | "md";
  fmt?:     ExportFormat;
}

function ExportButton({ label, disabled, state, onClick, size = "sm", fmt }: ExportButtonProps) {
  const Icon =
    state === "loading" ? Loader2 :
    state === "success" ? CheckCheck :
    state === "error"   ? XCircle :
    Download;

  const base = size === "md"
    ? "inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-medium shrink-0 print:hidden transition-all"
    : "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold print:hidden transition-all";

  const cls =
    state === "success" ? `${base} border-emerald-200 bg-emerald-50 text-emerald-700` :
    state === "error"   ? `${base} border-red-200 bg-red-50 text-red-700` :
    disabled            ? `${base} border-gray-200 bg-white text-gray-400 cursor-not-allowed opacity-60` :
    `${base} border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 cursor-pointer`;

  return (
    <button
      type="button"
      disabled={disabled || state === "loading"}
      onClick={onClick}
      className={cls}
    >
      <Icon className={["shrink-0", state === "loading" ? "animate-spin" : "", size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"].join(" ")} />
      {label}
    </button>
  );
}

// ─── Bloc Export complet ──────────────────────────────────────────────────────

function ExportComplet({
  cards,
  toast,
}: {
  cards: ExportCard[];
  toast: (t: Toast["type"], m: string) => void;
}) {
  const readyCount   = cards.filter((c) => c.status === "ready").length;
  const partialCount = cards.filter((c) => c.status === "partial").length;
  const available    = readyCount + partialCount;

  const [zipState, setZipState]       = useState<ExportState>("idle");
  const [zipProgress, setZipProgress] = useState<string>("");

  const handleZip = useCallback(async () => {
    if (zipState === "loading" || available === 0) return;
    setZipState("loading");
    try {
      const { exportZip } = await import("../exports/exportZip");
      const result = await exportZip((label, pct) => {
        setZipProgress(`${label} (${pct}%)`);
      });
      if (result.ok) {
        setZipState("success");
        toast("success", `Archive ZIP générée — ${result.count} document${result.count > 1 ? "s" : ""}.`);
      } else {
        setZipState("error");
        toast("error", `ZIP partiel — erreurs : ${result.errors.join(", ")}`);
      }
      setTimeout(() => { setZipState("idle"); setZipProgress(""); }, 3000);
    } catch (err) {
      console.error("[ExportZip]", err);
      setZipState("error");
      toast("error", "Erreur lors de la génération de l'archive ZIP.");
      setTimeout(() => { setZipState("idle"); setZipProgress(""); }, 3000);
    }
  }, [available, zipState, toast]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 print:text-black">Export complet</h3>
          <p className="mt-1 text-sm text-gray-500 print:text-gray-700">Archive unique de l'ensemble des documents disponibles.</p>
        </div>
        <div className={[
          "hidden sm:flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 print:bg-white print:ring-gray-300",
          available > 0 ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-gray-50 text-gray-600 ring-gray-200",
        ].join(" ")}>
          <span className={["h-1.5 w-1.5 rounded-full", available > 0 ? "bg-amber-500" : "bg-gray-400"].join(" ")} />
          {available} / {cards.length} disponibles
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-5 rounded-xl bg-gray-50 ring-1 ring-gray-200 px-5 py-4 print:bg-white print:ring-gray-300">
        <div className={[
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
          available > 0 ? "bg-amber-100" : "bg-gray-200",
        ].join(" ")}>
          <Archive className={["h-6 w-6", available > 0 ? "text-amber-600" : "text-gray-500"].join(" ")} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-800">Archive ZIP — Tous les documents</div>
          <div className="text-xs text-gray-500 mt-1 leading-relaxed">
            {zipState === "loading" && zipProgress
              ? zipProgress
              : "Génère une archive contenant l'ensemble des exports disponibles : Qualification, Investment Pack, rapport comité, modèle financier."}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <span className={[
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 print:bg-white print:ring-gray-300",
              available > 0 ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-gray-100 text-gray-500 ring-gray-200",
            ].join(" ")}>
              {available} document{available > 1 ? "s" : ""} disponible{available > 1 ? "s" : ""}
            </span>
            <span className="text-[11px] text-gray-400">· PDF + Excel inclus</span>
          </div>
        </div>
        <ExportButton
          label={zipState === "loading" ? "Génération…" : "Télécharger ZIP"}
          disabled={available === 0}
          state={zipState}
          onClick={handleZip}
          size="md"
          fmt="ZIP"
        />
      </div>
    </div>
  );
}

// ─── Carte export individuelle ────────────────────────────────────────────────

function ExportCardItem({
  card,
  toast,
}: {
  card:  ExportCard;
  toast: (t: Toast["type"], m: string) => void;
}) {
  const statusCls  = getStatusCls(card.status);
  const StatusIcon = statusCls.icon;

  // États par format
  const [pdfState,   setPdfState]   = useState<ExportState>("idle");
  const [xlsxState,  setXlsxState]  = useState<ExportState>("idle");

  const runExport = useCallback(async (fmt: ExportFormat) => {
    const setS = fmt === "Excel" ? setXlsxState : setPdfState;
    if ((fmt === "Excel" ? xlsxState : pdfState) === "loading") return;
    setS("loading");
    try {
      switch (card.id) {
        case "qualification": {
          const { exportQualificationPdf } = await import("../exports/exportQualification");
          await exportQualificationPdf();
          break;
        }
        case "data-confidence": {
          const { exportDataConfidencePdf } = await import("../exports/exportDataConfidence");
          await exportDataConfidencePdf();
          break;
        }
        case "investment-pack": {
          const { exportInvestmentPackPdf } = await import("../exports/exportInvestmentPack");
          await exportInvestmentPackPdf();
          break;
        }
        case "committee-review": {
          const { exportCommitteeReviewPdf } = await import("../exports/exportCommitteeReview");
          await exportCommitteeReviewPdf();
          break;
        }
        case "financial-engine": {
          if (fmt === "Excel") {
            const { exportFinancialEngineExcel } = await import("../exports/exportFinancialEngine");
            await exportFinancialEngineExcel();
          } else {
            const { exportFinancialEnginePdf } = await import("../exports/exportFinancialEngine");
            await exportFinancialEnginePdf();
          }
          break;
        }
      }
      setS("success");
      toast("success", `${card.title} (${fmt}) téléchargé.`);
      setTimeout(() => setS("idle"), 2500);
    } catch (err) {
      console.error(`[Export:${card.id}:${fmt}]`, err);
      setS("error");
      toast("error", `Erreur export ${card.title} (${fmt})`);
      setTimeout(() => setS("idle"), 3000);
    }
  }, [card, pdfState, xlsxState, toast]);

  const isAvailable = card.status !== "unavailable";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col print:shadow-none print:border-gray-300">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900 leading-tight">{card.title}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{card.source}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {card.format.map((fmt) => {
            const FmtIcon = getFormatIcon(fmt);
            return (
              <span key={fmt} className={["inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold print:bg-white print:text-gray-700 print:ring-gray-300", getFormatCls(fmt)].join(" ")}>
                <FmtIcon className="h-2.5 w-2.5" />
                {fmt}
              </span>
            );
          })}
        </div>
      </div>

      <div className="px-5 py-3.5 flex-1">
        <p className="text-xs text-gray-500 leading-relaxed">{card.description}</p>
      </div>

      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-3">
        <span className={["inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold print:bg-white print:text-gray-700 print:ring-gray-300", statusCls.wrapper].join(" ")}>
          <StatusIcon className={["h-3 w-3", statusCls.iconCls].join(" ")} />
          {card.statusLabel}
        </span>

        <div className="flex items-center gap-1.5 print:hidden">
          {/* Bouton PDF */}
          {card.format.includes("PDF") && (
            <ExportButton
              label="PDF"
              disabled={!isAvailable}
              state={pdfState}
              onClick={() => runExport("PDF")}
            />
          )}
          {/* Bouton Excel (uniquement financial-engine) */}
          {card.format.includes("Excel") && (
            <ExportButton
              label="Excel"
              disabled={!isAvailable}
              state={xlsxState}
              onClick={() => runExport("Excel")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Grille exports ───────────────────────────────────────────────────────────

function GrilleExports({
  cards,
  toast,
}: {
  cards: ExportCard[];
  toast: (t: Toast["type"], m: string) => void;
}) {
  const readyCount = cards.filter((c) => c.status !== "unavailable").length;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 print:text-black">Documents disponibles</h3>
          <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
            Chaque document s'active automatiquement dès que ses données source sont connectées.
          </p>
        </div>
        <div className={[
          "hidden sm:flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 print:bg-white print:ring-gray-300",
          readyCount > 0 ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-gray-50 text-gray-600 ring-gray-200",
        ].join(" ")}>
          <span className={["h-1.5 w-1.5 rounded-full", readyCount > 0 ? "bg-amber-500" : "bg-gray-400"].join(" ")} />
          {readyCount} / {cards.length} avec données
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((card) => (
          <ExportCardItem key={card.id} card={card} toast={toast} />
        ))}
      </div>
    </div>
  );
}

// ─── Historique ───────────────────────────────────────────────────────────────

function HistoriqueExports() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 print:text-black">Historique des exports</h3>
          <p className="mt-1 text-sm text-gray-500 print:text-gray-700">Traçabilité des téléchargements associés à ce deal.</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 rounded-full bg-gray-50 px-3 py-1.5 text-xs text-gray-600 ring-1 ring-gray-200 print:bg-white print:ring-gray-300">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          0 export
        </div>
      </div>
      <div className="hidden sm:grid grid-cols-5 mt-4 px-3 py-2 bg-gray-50 rounded-xl ring-1 ring-gray-200 print:bg-white print:ring-gray-300">
        {["Document", "Format", "Date", "Poids", "Télécharger"].map((h) => (
          <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 text-center first:text-left last:text-right">{h}</span>
        ))}
      </div>
      <div className="mt-3 flex flex-col items-center justify-center py-12 gap-3 rounded-xl bg-gray-50 ring-1 ring-gray-200 print:bg-white print:ring-gray-300">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-200">
          <History className="h-5 w-5 text-gray-400" />
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-gray-700">Aucun export réalisé</div>
          <div className="text-xs text-gray-500 mt-1 max-w-xs leading-relaxed">
            L'historique des exports apparaîtra ici après le premier téléchargement.
          </div>
        </div>
      </div>
      <p className="mt-4 text-[11px] text-gray-400 flex items-center gap-1.5">
        <Info className="h-3 w-3 shrink-0" />
        Les exports sont conservés 30 jours et associés au deal actif.
      </p>
    </div>
  );
}

// ─── Paramètres ───────────────────────────────────────────────────────────────

const PARAMS = [
  { label: "Logo société",         hint: "Affiché en en-tête de chaque document"    },
  { label: "Mentions légales",     hint: "Ajoutées automatiquement en pied de page" },
  { label: "Destinataire",         hint: "Nom affiché dans le rapport comité"       },
  { label: "Langue des documents", hint: "Français par défaut"                      },
] as const;

function ParametresExport() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900 print:text-black">Paramètres d'export</h3>
        <p className="mt-1 text-sm text-gray-500 print:text-gray-700">Options globales appliquées à tous les documents de ce deal.</p>
      </div>
      <ul className="space-y-2">
        {PARAMS.map(({ label, hint }) => (
          <li key={label} className="flex items-center justify-between gap-4 rounded-xl bg-gray-50 ring-1 ring-gray-200 px-4 py-3 print:bg-white print:ring-gray-300">
            <div>
              <div className="text-sm font-medium text-gray-800">{label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{hint}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm font-semibold text-gray-300 select-none">—</span>
              <button type="button" disabled className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-400 cursor-not-allowed opacity-60 print:hidden">
                Modifier
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[11px] text-gray-400 flex items-center gap-1.5">
        <Info className="h-3 w-3 shrink-0" />
        Ces paramètres s'appliqueront à tous les exports de ce deal.
      </p>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function ExportsTab() {
  const tick = useMarchandSnapshotTick();
  const { toasts, push: pushToast } = useToasts();

  const { deal, rentaSaved, marcheSaved } = useMemo(() => {
    const snap       = readMarchandSnapshot();
    const activeDeal = ensureActiveDeal();
    const id         = activeDeal?.id ?? null;
    return {
      deal:        activeDeal,
      rentaSaved:  id ? snap.rentabiliteByDeal[id]   : undefined,
      marcheSaved: id ? snap.marcheRisquesByDeal[id] : undefined,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const snapshot = useMemo(() => castComputed(rentaSaved), [rentaSaved]);
  const statuts  = useMemo(() => deriveExportStatuses(deal, snapshot, marcheSaved), [deal, snapshot, marcheSaved]);
  const cards    = useMemo(() => buildExportCards(statuts), [statuts]);

  return (
    <>
      <div className="space-y-5">
        <ExportComplet cards={cards} toast={pushToast} />
        <GrilleExports cards={cards} toast={pushToast} />
        <HistoriqueExports />
        <ParametresExport />
      </div>
      <ToastStack toasts={toasts} />
    </>
  );
}
