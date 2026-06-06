// src/spaces/promoteur/pages/Dashboard.tsx
// VERSION 3.4.0 — UI unifiée Promoteur (PromoteurPageHero + tokens)
//   Seule la couche visuelle du Hero et des boutons a été modifiée.
//   Toute la logique métier, les états, les callbacks sont intacts.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  clearAllPromoteurSessionKeys,
  clearActiveStudyId,
  setActiveStudyId,
} from "../shared/promoteurSnapshot.store";
import { PromoteurStudyService } from "../shared/promoteurStudyService";
import type { PromoteurStudySummary } from "../shared/promoteurStudy.types";
import {
  listApporteurDeals,
  updateApporteurDeal,
} from "../../apporteur/shared/apporteurDeals.store";
import type { ApporteurDeal } from "../../apporteur/shared/apporteurDeals.store";
import {
  ArrowRight,
  Building2,
  Calculator,
  ChevronRight,
  Download,
  FileSearch,
  FileText,
  Grid3X3,
  Layers,
  MapPin,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
  AlertTriangle,
  BarChart3,
  Clock,
  Landmark,
  UserCheck,
  Euro,
  X,
} from "lucide-react";

// ─── Design tokens Promoteur ──────────────────────────────────────────────────
import {
  PROMOTEUR_COLORS,
  PROMOTEUR_RADIUS,
  PROMOTEUR_SHADOWS,
  PROMOTEUR_BUTTON_STYLES,
  GRAD,
} from "../shared/promoteurDesign.tokens";
import { PromoteurPageHero, HeroPrimaryButton, HeroGhostButton } from "../shared/components/PromoteurPageHero";

// ─── Alias locaux (compatibilité avec le code existant) ───────────────────────
const GRAD_LOCAL  = GRAD;                         // gradient diagonal
const ACCENT      = PROMOTEUR_COLORS.violetHover;
const ACCENT2     = PROMOTEUR_COLORS.violet;

// ─── Constants ────────────────────────────────────────────────────────────────

const LS_QUICK_ADDRESS = "mimmoza.promoteur.quick.address";
const LS_QUICK_COMMUNE = "mimmoza.promoteur.quick.commune";
const LS_QUICK_SURFACE = "mimmoza.promoteur.quick.surface";

// ─── Types ────────────────────────────────────────────────────────────────────

type PipelineStep = {
  id:          string;
  label:       string;
  description: string;
  route:       string;
  icon:        React.ComponentType<{ className?: string }>;
  color:       string;
  bg:          string;
  border:      string;
};

type QuickAction = {
  label: string;
  route: string;
  icon:  React.ComponentType<{ className?: string }>;
  tag?:  string;
};

// ─── Data ─────────────────────────────────────────────────────────────────────

const PIPELINE_STEPS: PipelineStep[] = [
  {
    id: "opportunite", label: "Opportunité",
    description: "Identification, import foncier, veille",
    route: "/promoteur/foncier",
    icon: MapPin, color: "#7c3aed", bg: "#faf5ff", border: "#e9d5ff",
  },
  {
    id: "preanalyse", label: "Pré-analyse",
    description: "PLU express, risques bloquants, score",
    route: "/promoteur/foncier",
    icon: Search, color: "#4338ca", bg: "#eef2ff", border: "#c7d2fe",
  },
  {
    id: "faisabilite", label: "Faisabilité",
    description: "Implantation 2D, massing 3D, façades",
    route: "/promoteur/implantation-2d",
    icon: Grid3X3, color: "#0369a1", bg: "#f0f9ff", border: "#bae6fd",
  },
  {
    id: "marche", label: "Marché",
    description: "DVF, prix de sortie, étude de marché",
    route: "/promoteur/estimation",
    icon: TrendingUp, color: "#047857", bg: "#ecfdf5", border: "#a7f3d0",
  },
  {
    id: "bilan", label: "Bilan",
    description: "Promoteur, scénarios, charge foncière",
    route: "/promoteur/bilan-promoteur",
    icon: Calculator, color: "#b45309", bg: "#fffbeb", border: "#fde68a",
  },
  {
    id: "comite", label: "Comité",
    description: "Synthèse, export PDF, recommandation",
    route: "/promoteur/synthese",
    icon: Landmark, color: "#be185d", bg: "#fdf2f8", border: "#fbcfe8",
  },
];

const QUICK_ACTIONS: QuickAction[] = [
  { label: "PLU express",        route: "/promoteur/foncier",            icon: Layers,     tag: "Pré-analyse" },
  { label: "Contacts mairie",    route: "/promoteur/recherche-contacts", icon: Users,      tag: "Opportunité" },
  { label: "Permis comparables", route: "/promoteur/permis-construire",  icon: FileSearch, tag: "Opportunité" },
  { label: "DVF & comparables",  route: "/promoteur/estimation",         icon: BarChart3,  tag: "Marché" },
  { label: "Implantation 2D",    route: "/promoteur/implantation-2d",    icon: Grid3X3,    tag: "Faisabilité" },
  { label: "Synthèse comité",    route: "/promoteur/synthese",           icon: Sparkles,   tag: "Comité" },
];

const TYPE_BIEN_OPTIONS = [
  { value: "",          label: "— Choisir —" },
  { value: "terrain",   label: "Terrain nu" },
  { value: "immeuble",  label: "Immeuble existant" },
  { value: "maison",    label: "Maison avec terrain" },
  { value: "dent",      label: "Dent creuse" },
  { value: "friche",    label: "Friche / reconversion" },
  { value: "autre",     label: "Autre" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateFR(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

function formatDateTimeFR(iso: string) {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function formatEur(v: number) {
  return v.toLocaleString("fr-FR") + " €";
}

const TYPE_BIEN_LABEL: Record<ApporteurDeal["typeBien"], string> = {
  terrain:  "Terrain",
  maison:   "Maison",
  immeuble: "Immeuble",
  autre:    "Autre",
};

// ─── Modal Nouvelle Opportunité ───────────────────────────────────────────────
// (identique à la v3.3.0, aucun changement logique)

function NouvelleOpportuniteModal({
  open,
  onClose,
  onCreate,
  isCreating,
}: {
  open:       boolean;
  onClose:    () => void;
  onCreate:   (fields: { nom: string; adresse: string; commune: string; surface: string; typeBien: string }) => void;
  isCreating: boolean;
}) {
  const [nom,      setNom]      = useState("");
  const [adresse,  setAdresse]  = useState("");
  const [commune,  setCommune]  = useState("");
  const [surface,  setSurface]  = useState("");
  const [typeBien, setTypeBien] = useState("");

  const prevOpen = useRef(open);
  useEffect(() => {
    if (open && !prevOpen.current) {
      setNom(""); setAdresse(""); setCommune(""); setSurface(""); setTypeBien("");
    }
    prevOpen.current = open;
  }, [open]);

  if (!open) return null;

  const handleSubmit = () => onCreate({ nom, adresse, commune, surface, typeBien });

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: PROMOTEUR_RADIUS.input,
    border: `1.5px solid ${PROMOTEUR_COLORS.violetBorder}`,
    background: "#FAFAFA",
    fontSize: 14,
    color: PROMOTEUR_COLORS.textPrimary,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s, box-shadow 0.15s",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: "#374151",
    marginBottom: 6,
    display: "block",
  };

  const focusProps = {
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
      e.currentTarget.style.borderColor = PROMOTEUR_COLORS.violetLight;
      e.currentTarget.style.boxShadow   = `0 0 0 3px rgba(124,99,217,0.10)`;
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
      e.currentTarget.style.borderColor = PROMOTEUR_COLORS.violetBorder;
      e.currentTarget.style.boxShadow   = "none";
    },
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "rgba(2,6,23,0.45)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px 16px",
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: "100%", maxWidth: 480,
          background: "#fff",
          borderRadius: PROMOTEUR_RADIUS.card,
          boxShadow: "0 24px 64px rgba(2,6,23,0.20)",
          overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header modal */}
        <div style={{
          padding: "24px 28px 20px",
          borderBottom: `1px solid ${PROMOTEUR_COLORS.borderLight}`,
          display: "flex", alignItems: "flex-start", gap: 16,
        }}>
          <div style={{
            width: 48, height: 48,
            borderRadius: 14,
            background: PROMOTEUR_COLORS.gradMain,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
            boxShadow: PROMOTEUR_SHADOWS.button,
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M3 21h18M5 21V9l7-6 7 6v12M10 21v-5h4v5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: PROMOTEUR_COLORS.textPrimary, lineHeight: 1.25, marginBottom: 3 }}>
              Nouvelle opportunité
            </div>
            <div style={{ fontSize: 13, color: PROMOTEUR_COLORS.violetLight }}>
              Promoteur foncier
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: 32, height: 32,
              borderRadius: 8,
              border: `1px solid ${PROMOTEUR_COLORS.violetBorder}`,
              background: PROMOTEUR_COLORS.pageBg,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: PROMOTEUR_COLORS.textSecondary,
              flexShrink: 0, fontSize: 18, lineHeight: 1,
            }}
          >×</button>
        </div>

        {/* Corps modal */}
        <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>
              Nom du projet
              <span style={{ color: PROMOTEUR_COLORS.violetLight, fontWeight: 400, marginLeft: 4 }}>
                (optionnel — généré automatiquement)
              </span>
            </label>
            <input type="text" value={nom} onChange={(e) => setNom(e.target.value)}
              placeholder="Ex: Opportunité — 29 rue Georges Mandel"
              style={inputStyle} {...focusProps} />
          </div>

          <div>
            <label style={labelStyle}>Adresse / Localisation</label>
            <input type="text" value={adresse} onChange={(e) => setAdresse(e.target.value)}
              placeholder="Ex: 12 rue de la Paix, 75001 Paris"
              style={inputStyle} {...focusProps} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Commune</label>
              <input type="text" value={commune} onChange={(e) => setCommune(e.target.value)}
                placeholder="Ex: Bordeaux" style={inputStyle} {...focusProps} />
            </div>
            <div>
              <label style={labelStyle}>Surface terrain (m²)</label>
              <input type="number" value={surface} onChange={(e) => setSurface(e.target.value)}
                placeholder="Ex: 1200" style={inputStyle} {...focusProps} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Type de bien</label>
            <select value={typeBien} onChange={(e) => setTypeBien(e.target.value)}
              style={{ ...inputStyle, cursor: "pointer" }}>
              {TYPE_BIEN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer modal */}
        <div style={{ padding: "0 28px 24px", display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} disabled={isCreating}
            style={{
              padding: "11px 22px",
              borderRadius: PROMOTEUR_RADIUS.button,
              border: `1.5px solid ${PROMOTEUR_COLORS.violetBorder}`,
              background: "#fff", color: "#374151",
              fontWeight: 600, fontSize: 14, cursor: "pointer",
              opacity: isCreating ? 0.5 : 1,
            }}>
            Annuler
          </button>

          <button type="button" onClick={handleSubmit} disabled={isCreating}
            style={{
              ...PROMOTEUR_BUTTON_STYLES.primary,
              background: isCreating ? PROMOTEUR_COLORS.violetLight : PROMOTEUR_COLORS.gradMain,
              cursor: isCreating ? "default" : "pointer",
              boxShadow: isCreating ? "none" : PROMOTEUR_SHADOWS.button,
            }}
            onMouseEnter={(e) => { if (!isCreating) { e.currentTarget.style.opacity = "0.92"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateY(0)"; }}>
            {isCreating ? (
              <>
                <span style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                Création…
              </>
            ) : (
              <>
                <Plus style={{ width: 15, height: 15 }} />
                Créer l'opportunité
              </>
            )}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── RecentStudyRow ───────────────────────────────────────────────────────────
// (identique à v3.3.0)

function RecentStudyRow({
  study, onOpen, onDelete,
}: {
  study:    PromoteurStudySummary;
  onOpen:   () => void;
  onDelete: () => void;
}) {
  const surface = study.foncier?.surface_m2    ?? 0;
  const commune = study.foncier?.commune_insee ?? null;

  return (
    <div
      className="group flex items-center gap-4 rounded-xl border bg-white px-5 py-4 transition-all duration-150 hover:-translate-y-[1px] hover:shadow-[0_4px_16px_rgba(124,99,217,0.12)] cursor-pointer"
      style={{ borderColor: PROMOTEUR_COLORS.violetBorder }}
      onClick={onOpen}
    >
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px]"
        style={{ background: PROMOTEUR_COLORS.violetBg }}>
        <Building2 className="h-5 w-5" style={{ color: ACCENT }} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold" style={{ color: PROMOTEUR_COLORS.textPrimary }}>
          {study.title}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-[11px]" style={{ color: PROMOTEUR_COLORS.violetLight }}>
          {commune && <span>INSEE {commune}</span>}
          {surface > 0 && <span>{Math.round(surface).toLocaleString("fr-FR")} m²</span>}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDateFR(study.updated_at)}
          </span>
        </div>
      </div>

      <span
        className="flex-shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
        style={{
          background: study.status === "active" ? PROMOTEUR_COLORS.violetBg : study.status === "archived" ? "#f1f5f9" : "#fef3c7",
          color:      study.status === "active" ? ACCENT                    : study.status === "archived" ? "#64748b"  : "#92400e",
        }}
      >
        {study.status === "active" ? "Active" : study.status === "archived" ? "Archivée" : "Brouillon"}
      </span>

      <div className="flex flex-shrink-0 items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="rounded-lg border border-red-100 bg-red-50 px-2.5 py-1.5 text-[11px] font-medium text-red-500 hover:bg-red-100 transition-colors"
        >
          Supprimer
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-all"
          style={{ borderColor: PROMOTEUR_COLORS.violetBorder, background: PROMOTEUR_COLORS.violetBg, color: ACCENT }}
        >
          Ouvrir
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ─── ApporteurDealRow ─────────────────────────────────────────────────────────
// (identique à v3.3.0)

function ApporteurDealRow({
  deal, onOpen, isOpening,
}: {
  deal:      ApporteurDeal;
  onOpen:    () => void;
  isOpening: boolean;
}) {
  return (
    <div
      className="group flex items-center gap-4 rounded-xl border bg-white px-5 py-4 transition-all duration-150 hover:-translate-y-[1px] hover:shadow-[0_4px_16px_rgba(34,197,94,0.10)]"
      style={{ borderColor: "#bbf7d0" }}
    >
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-emerald-50">
        <UserCheck className="h-5 w-5 text-emerald-600" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold" style={{ color: PROMOTEUR_COLORS.textPrimary }}>
          {deal.adresse}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]" style={{ color: "#6b7280" }}>
          {deal.commune && <span>{deal.commune}</span>}
          <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide" style={{ background: "#f0fdf4", color: "#16a34a" }}>
            {TYPE_BIEN_LABEL[deal.typeBien]}
          </span>
          {deal.surfaceTerrainM2 != null && <span>{deal.surfaceTerrainM2.toLocaleString("fr-FR")} m²</span>}
          {deal.prixVendeur != null && (
            <span className="flex items-center gap-0.5 font-semibold text-emerald-700">
              <Euro className="h-3 w-3" />{formatEur(deal.prixVendeur)}
            </span>
          )}
        </div>
        {deal.commentaire && (
          <div className="mt-1 truncate text-[11px] italic" style={{ color: "#9ca3af" }}>{deal.commentaire}</div>
        )}
      </div>

      {deal.promoteurStudyId && (
        <span className="hidden flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide sm:inline-block"
          style={{ background: PROMOTEUR_COLORS.violetBg, color: ACCENT }}>
          Étude liée
        </span>
      )}

      <button
        onClick={onOpen}
        disabled={isOpening}
        className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-50"
        style={{ borderColor: "#6ee7b7", background: "#f0fdf4", color: "#065f46" }}
      >
        {isOpening ? <span className="animate-pulse">Création…</span> : <><span>Ouvrir</span><ArrowRight className="h-3 w-3" /></>}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function Dashboard(): React.ReactElement {
  const navigate = useNavigate();

  const [studies,       setStudies]       = useState<PromoteurStudySummary[]>([]);
  const [isLoaded,      setIsLoaded]      = useState(false);
  const [loadError,     setLoadError]     = useState<string | null>(null);
  const [quickAddress,  setQuickAddress]  = useState("");
  const [quickCommune,  setQuickCommune]  = useState("");
  const [quickSurface,  setQuickSurface]  = useState("");
  const [apporteurDeals,setApporteurDeals]= useState<ApporteurDeal[]>([]);
  const [openingDealId, setOpeningDealId] = useState<string | null>(null);
  const [showModal,     setShowModal]     = useState(false);
  const [isCreating,    setIsCreating]    = useState(false);

  // ── Chargement études ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await PromoteurStudyService.listStudies();
      if (cancelled) return;
      if (result.ok) {
        setStudies(result.data);
        if (result.data.length === 0) { clearActiveStudyId(); clearAllPromoteurSessionKeys(); }
      } else {
        setLoadError(result.error);
      }
      setIsLoaded(true);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const all = listApporteurDeals();
    setApporteurDeals(all.filter(d => d.status === "transmis_promoteur"));
  }, []);

  const sortedStudies = useMemo(
    () => [...studies].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [studies]
  );

  // ── Créer depuis la modal ─────────────────────────────────────────────────
  const handleModalCreate = useCallback(async (fields: {
    nom: string; adresse: string; commune: string; surface: string; typeBien: string;
  }) => {
    setIsCreating(true);
    const { nom, adresse, commune, surface } = fields;
    const title = nom.trim()
      ? nom.trim()
      : adresse.trim() ? `Opportunité — ${adresse.trim()}`
      : commune.trim() ? `Opportunité — ${commune.trim()}`
      : `Nouvelle étude — ${formatDateTimeFR(new Date().toISOString())}`;

    const result = await PromoteurStudyService.createStudy(title);
    if (!result.ok) { alert(`Impossible de créer l'étude : ${result.error}`); setIsCreating(false); return; }
    const newStudy = result.data;
    clearAllPromoteurSessionKeys();
    setActiveStudyId(newStudy.id);

    if (adresse.trim()) localStorage.setItem(LS_QUICK_ADDRESS, adresse.trim());
    else                localStorage.removeItem(LS_QUICK_ADDRESS);
    if (commune.trim()) localStorage.setItem(LS_QUICK_COMMUNE, commune.trim());
    else                localStorage.removeItem(LS_QUICK_COMMUNE);
    const surfaceNum = parseFloat(surface.replace(",", "."));
    if (!isNaN(surfaceNum) && surfaceNum > 0) localStorage.setItem(LS_QUICK_SURFACE, String(Math.round(surfaceNum)));
    else                                       localStorage.removeItem(LS_QUICK_SURFACE);

    const summary: PromoteurStudySummary = {
      id: newStudy.id, user_id: newStudy.user_id, title: newStudy.title,
      status: newStudy.status, created_at: newStudy.created_at, updated_at: newStudy.updated_at, foncier: null,
    };
    setStudies(prev => [summary, ...prev]);
    setIsCreating(false);
    setShowModal(false);
    navigate(`/promoteur/foncier?study=${encodeURIComponent(newStudy.id)}`);
  }, [navigate]);

  const openStudy = useCallback((study: PromoteurStudySummary) => {
    setActiveStudyId(study.id);
    navigate(`/promoteur/foncier?study=${encodeURIComponent(study.id)}`);
  }, [navigate]);

  const deleteStudy = useCallback(async (studyId: string) => {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer cette étude ?")) return;
    await PromoteurStudyService.deleteStudy(studyId);
    setStudies(prev => prev.filter(s => s.id !== studyId));
    const activeId = localStorage.getItem("mimmoza.promoteur.active_study_id");
    if (activeId === studyId) { clearActiveStudyId(); clearAllPromoteurSessionKeys(); }
  }, []);

  const handleQuickLaunch = useCallback(async () => {
    const address = quickAddress.trim();
    const commune = quickCommune.trim();
    const surface = quickSurface.trim().replace(/\s/g, "");
    const title = address ? `Opportunité — ${address}` : commune ? `Opportunité — ${commune}` : `Nouvelle étude — ${formatDateTimeFR(new Date().toISOString())}`;

    const result = await PromoteurStudyService.createStudy(title);
    if (!result.ok) { alert(`Impossible de créer l'étude : ${result.error}`); return; }
    const newStudy = result.data;
    clearAllPromoteurSessionKeys();
    setActiveStudyId(newStudy.id);

    if (address) localStorage.setItem(LS_QUICK_ADDRESS, address); else localStorage.removeItem(LS_QUICK_ADDRESS);
    if (commune) localStorage.setItem(LS_QUICK_COMMUNE, commune); else localStorage.removeItem(LS_QUICK_COMMUNE);
    if (surface !== "") {
      const sn = parseFloat(surface.replace(",", "."));
      if (!isNaN(sn) && sn > 0) localStorage.setItem(LS_QUICK_SURFACE, String(Math.round(sn)));
      else                       localStorage.removeItem(LS_QUICK_SURFACE);
    } else { localStorage.removeItem(LS_QUICK_SURFACE); }

    const summary: PromoteurStudySummary = {
      id: newStudy.id, user_id: newStudy.user_id, title: newStudy.title,
      status: newStudy.status, created_at: newStudy.created_at, updated_at: newStudy.updated_at, foncier: null,
    };
    setStudies(prev => [summary, ...prev]);
    navigate(`/promoteur/foncier?study=${encodeURIComponent(newStudy.id)}`);
  }, [quickAddress, quickCommune, quickSurface, navigate]);

  const openApporteurDeal = useCallback(async (deal: ApporteurDeal) => {
    if (deal.promoteurStudyId) { navigate(`/promoteur/foncier?study=${encodeURIComponent(deal.promoteurStudyId)}`); return; }
    setOpeningDealId(deal.id);
    const title  = `Deal apporteur — ${deal.adresse}`;
    const result = await PromoteurStudyService.createStudy(title);
    if (!result.ok) { alert(`Impossible de créer l'étude : ${result.error}`); setOpeningDealId(null); return; }
    const newStudy = result.data;
    clearAllPromoteurSessionKeys();
    setActiveStudyId(newStudy.id);
    updateApporteurDeal(deal.id, { promoteurStudyId: newStudy.id });
    setApporteurDeals(prev => prev.map(d => d.id === deal.id ? { ...d, promoteurStudyId: newStudy.id } : d));
    if (deal.adresse)           localStorage.setItem(LS_QUICK_ADDRESS, deal.adresse);
    if (deal.commune)           localStorage.setItem(LS_QUICK_COMMUNE, deal.commune);
    if (deal.surfaceTerrainM2 != null && deal.surfaceTerrainM2 > 0)
      localStorage.setItem(LS_QUICK_SURFACE, String(Math.round(deal.surfaceTerrainM2)));
    const summary: PromoteurStudySummary = {
      id: newStudy.id, user_id: newStudy.user_id, title: newStudy.title,
      status: newStudy.status, created_at: newStudy.created_at, updated_at: newStudy.updated_at, foncier: null,
    };
    setStudies(prev => [summary, ...prev]);
    setOpeningDealId(null);
    navigate(`/promoteur/foncier?study=${encodeURIComponent(newStudy.id)}`);
  }, [navigate]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <NouvelleOpportuniteModal
        open={showModal}
        onClose={() => !isCreating && setShowModal(false)}
        onCreate={handleModalCreate}
        isCreating={isCreating}
      />

      <div className="space-y-6">

        {/* ══ 1. HERO v2 — identique à VeilleMarchePage ════════════════════ */}
        <PromoteurPageHero
          badge="Promoteur · Cockpit foncier"
          title="Opportunités"
          metaLines={[
            {
              text: "Importez une opportunité, qualifiez-la rapidement, testez la faisabilité et préparez votre comité foncier.",
            },
            {
              text: `${sortedStudies.length} étude${sortedStudies.length > 1 ? "s" : ""} active${sortedStudies.length > 1 ? "s" : ""}`,
            },
          ]}
          statCards={[
            { label: "Opportunités", value: String(sortedStudies.length), tone: "indigo" },
            { label: "Deals apporteurs", value: String(apporteurDeals.length), tone: "emerald" },
          ]}
          actions={
            <>
              <HeroPrimaryButton onClick={() => setShowModal(true)}>
                <Plus style={{ width: 16, height: 16 }} />
                Nouvelle opportunité
              </HeroPrimaryButton>
              <HeroGhostButton title="Bientôt disponible">
                <Download style={{ width: 15, height: 15 }} />
                Import Kel Foncier
              </HeroGhostButton>
            </>
          }
        />

        {/* ══ 2. SAISIE RAPIDE ═════════════════════════════════════════════ */}
        <div className="rounded-2xl border bg-white px-6 py-5"
          style={{ borderColor: PROMOTEUR_COLORS.violetBorder }}>
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ background: PROMOTEUR_COLORS.violetBg }}>
              <Zap className="h-3.5 w-3.5" style={{ color: ACCENT2 }} />
            </div>
            <p className="text-sm font-semibold" style={{ color: PROMOTEUR_COLORS.textPrimary }}>Lancement rapide</p>
            <span className="ml-1 rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide"
              style={{ background: PROMOTEUR_COLORS.violetBg, color: ACCENT2 }}>
              Pré-analyse express
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="relative sm:col-span-1">
              <MapPin className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                style={{ color: PROMOTEUR_COLORS.violetLight }} />
              <input type="text" value={quickAddress} onChange={(e) => setQuickAddress(e.target.value)}
                placeholder="Adresse ou n° parcelle"
                className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100 transition-all"
                style={{ borderColor: PROMOTEUR_COLORS.violetBorder, color: PROMOTEUR_COLORS.textPrimary }} />
            </div>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                style={{ color: PROMOTEUR_COLORS.violetLight }} />
              <input type="text" value={quickCommune} onChange={(e) => setQuickCommune(e.target.value)}
                placeholder="Commune"
                className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100 transition-all"
                style={{ borderColor: PROMOTEUR_COLORS.violetBorder, color: PROMOTEUR_COLORS.textPrimary }} />
            </div>
            <div className="relative">
              <Layers className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                style={{ color: PROMOTEUR_COLORS.violetLight }} />
              <input type="text" value={quickSurface} onChange={(e) => setQuickSurface(e.target.value)}
                placeholder="Surface terrain (m², optionnel)"
                className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100 transition-all"
                style={{ borderColor: PROMOTEUR_COLORS.violetBorder, color: PROMOTEUR_COLORS.textPrimary }} />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-[11px]" style={{ color: PROMOTEUR_COLORS.violetLight }}>
              Ces informations seront pré-remplies dans votre nouvelle étude.
            </p>
            <button onClick={handleQuickLaunch}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
              style={{ background: PROMOTEUR_COLORS.gradMain, color: "white", boxShadow: PROMOTEUR_SHADOWS.button }}>
              Lancer la pré-analyse
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ══ 3. PIPELINE ══════════════════════════════════════════════════ */}
        <div>
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.13em]"
              style={{ color: PROMOTEUR_COLORS.violetLight }}>Parcours métier</p>
            <p className="mt-0.5 text-sm font-semibold" style={{ color: PROMOTEUR_COLORS.textPrimary }}>
              Pipeline Opportunité → Comité
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {PIPELINE_STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <Link key={step.id} to={step.route}
                  className="group relative flex flex-col gap-3 rounded-xl border p-4 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(15,10,40,0.08)]"
                  style={{ background: step.bg, borderColor: step.border }}>
                  <div className="flex items-center justify-between">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg transition-transform duration-150 group-hover:scale-105"
                      style={{ background: step.color + "18" }}>
                      <Icon className="h-4 w-4" style={{ color: step.color }} />
                    </div>
                    <span className="text-[9px] font-bold tabular-nums" style={{ color: step.color + "80" }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold leading-tight" style={{ color: PROMOTEUR_COLORS.textPrimary }}>{step.label}</p>
                    <p className="mt-1 text-[10px] leading-[1.45]" style={{ color: PROMOTEUR_COLORS.violetLight }}>{step.description}</p>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] font-medium" style={{ color: step.color }}>
                    <span>Accéder</span>
                    <ChevronRight className="h-3 w-3 transition-transform duration-150 group-hover:translate-x-0.5" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* ══ 4. OPPORTUNITÉS APPORTEURS ═══════════════════════════════════ */}
        {apporteurDeals.length > 0 && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "#f0fdf4" }}>
                <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
              </div>
              <p className="text-sm font-semibold" style={{ color: PROMOTEUR_COLORS.textPrimary }}>
                Opportunités apporteurs
              </p>
              <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                style={{ background: "#f0fdf4", color: "#16a34a" }}>
                {apporteurDeals.length} transmis
              </span>
            </div>
            <div className="space-y-2">
              {apporteurDeals.map(deal => (
                <ApporteurDealRow key={deal.id} deal={deal}
                  onOpen={() => openApporteurDeal(deal)}
                  isOpening={openingDealId === deal.id} />
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-5">

          {/* ══ 5. ACTIONS RAPIDES ═══════════════════════════════════════ */}
          <div className="lg:col-span-2">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em]"
              style={{ color: PROMOTEUR_COLORS.violetLight }}>Actions rapides</p>

            <div className="overflow-hidden rounded-2xl border bg-white"
              style={{ borderColor: PROMOTEUR_COLORS.violetBorder }}>
              {QUICK_ACTIONS.map((action, i) => {
                const Icon   = action.icon;
                const isLast = i === QUICK_ACTIONS.length - 1;
                return (
                  <Link key={action.label} to={action.route}
                    className="group flex items-center gap-3 px-4 py-3.5 transition-colors duration-100 hover:bg-violet-50"
                    style={{ borderBottom: isLast ? "none" : `0.5px solid ${PROMOTEUR_COLORS.borderLight}` }}>
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] transition-transform duration-150 group-hover:scale-105"
                      style={{ background: PROMOTEUR_COLORS.violetBg }}>
                      <Icon className="h-4 w-4" style={{ color: ACCENT2 }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold" style={{ color: PROMOTEUR_COLORS.textPrimary }}>{action.label}</p>
                      {action.tag && <p className="text-[10px]" style={{ color: PROMOTEUR_COLORS.violetLight }}>{action.tag}</p>}
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 opacity-0 transition-all duration-150 group-hover:translate-x-0.5 group-hover:opacity-100"
                      style={{ color: ACCENT2 }} />
                  </Link>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between rounded-xl border px-4 py-3.5"
              style={{ borderColor: PROMOTEUR_COLORS.violetBorder, background: PROMOTEUR_COLORS.violetBg }}>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px]"
                  style={{ background: "#fff" }}>
                  <Download className="h-4 w-4" style={{ color: ACCENT2 }} />
                </div>
                <div>
                  <p className="text-xs font-semibold" style={{ color: PROMOTEUR_COLORS.textPrimary }}>Import Kel Foncier</p>
                  <p className="text-[10px]" style={{ color: PROMOTEUR_COLORS.violetLight }}>Connexion bientôt disponible</p>
                </div>
              </div>
              <span className="rounded-full px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                style={{ background: PROMOTEUR_COLORS.violetBg, color: ACCENT }}>
                Bientôt
              </span>
            </div>
          </div>

          {/* ══ 6. DOSSIERS RÉCENTS ══════════════════════════════════════ */}
          <div className="lg:col-span-3">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.13em]"
                style={{ color: PROMOTEUR_COLORS.violetLight }}>
                Opportunités récentes
                {isLoaded && sortedStudies.length > 0 && (
                  <span className="ml-2 rounded-full px-2 py-0.5 text-[9px] normal-case tracking-normal"
                    style={{ background: PROMOTEUR_COLORS.violetBg, color: ACCENT }}>
                    {sortedStudies.length}
                  </span>
                )}
              </p>
              {isLoaded && sortedStudies.length > 0 && (
                <button onClick={() => setShowModal(true)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all hover:brightness-110"
                  style={{ background: PROMOTEUR_COLORS.violetBg, color: ACCENT }}>
                  <Plus className="h-3 w-3" />Nouvelle
                </button>
              )}
            </div>

            {!isLoaded && (
              <div className="flex items-center justify-center rounded-2xl border py-10"
                style={{ borderColor: PROMOTEUR_COLORS.border, background: "white" }}>
                <p className="text-sm" style={{ color: PROMOTEUR_COLORS.violetLight }}>Chargement des études…</p>
              </div>
            )}

            {isLoaded && loadError && (
              <div className="mb-3 flex items-center gap-2 rounded-xl border px-4 py-3 text-xs"
                style={{ background: "#fffbeb", borderColor: "#fde68a", color: "#92400e" }}>
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                Connexion Supabase limitée ({loadError})
              </div>
            )}

            {isLoaded && sortedStudies.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-2xl border px-8 py-12 text-center"
                style={{ borderColor: PROMOTEUR_COLORS.violetBorder, background: "white", borderStyle: "dashed" }}>
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
                  style={{ background: PROMOTEUR_COLORS.violetBg }}>
                  <FileText className="h-6 w-6" style={{ color: ACCENT2 }} />
                </div>
                <p className="mb-1 text-sm font-semibold" style={{ color: PROMOTEUR_COLORS.textPrimary }}>Aucune opportunité active</p>
                <p className="mb-5 text-xs leading-5" style={{ color: PROMOTEUR_COLORS.violetLight }}>
                  Créez votre première étude foncière pour démarrer le parcours d'analyse.
                </p>
                <button onClick={() => setShowModal(true)}
                  className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all hover:brightness-110 active:scale-[0.98]"
                  style={{ background: PROMOTEUR_COLORS.gradMain, color: "white", boxShadow: PROMOTEUR_SHADOWS.button }}>
                  <Plus className="h-4 w-4" />Créer une opportunité
                </button>
              </div>
            )}

            {isLoaded && sortedStudies.length > 0 && (
              <div className="space-y-2">
                {sortedStudies.slice(0, 6).map((s) => (
                  <RecentStudyRow key={s.id} study={s}
                    onOpen={() => openStudy(s)}
                    onDelete={() => deleteStudy(s.id)} />
                ))}
                {sortedStudies.length > 6 && (
                  <p className="pt-1 text-center text-[11px]" style={{ color: PROMOTEUR_COLORS.violetLight }}>
                    + {sortedStudies.length - 6} autres études
                  </p>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}