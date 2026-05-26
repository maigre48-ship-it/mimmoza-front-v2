// src/spaces/promoteur/pages/BesoinLogementsSociauxPage.tsx

import { useState, useEffect, useRef } from "react";
import {
  Users,
  Search,
  AlertTriangle,
  TrendingUp,
  Building2,
  CheckCircle,
  Info,
  Database,
  ChevronRight,
  BarChart3,
  XCircle,
} from "lucide-react";
import { supabase } from "../../../lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type DeficitMode = "officiel" | "calcule" | "indisponible";
type RplsMode = "reel" | "estime" | "indisponible";

interface CommuneData {
  commune: string;
  codePostal: string;
  codeInsee: string;
  statutSRU: string | null;
  tauxLLS: number | null;
  objectifSRU: number | null;
  deficitEstime: number | null;
  deficitMode: DeficitMode | null;
  logementsSociaux: number | null;
  residencesPrincipales: number | null;
  demandesEnAttente: number | null;
  attributionsAnnuelles: number | null;
  tensionTheorique: number | null;
  logementsRpls: number | null;
  logementsLocatifsSociaux: number | null;
  rplsAnnee: number | null;
  rplsSource: string | null;
  rplsMode: RplsMode;
  scoreLabel: "Élevé" | "Modéré" | "Faible" | "Indisponible";
  scorePartiel: boolean;
  scoreColor: string;
  scoreBg: string;
  dataStatus: "real" | "partial" | "unavailable";
  sources: string[];
  warnings: string[];
}

interface ApiResponse {
  commune: string;
  codePostal: string;
  codeInsee: string;
  statutSRU: string | null;
  tauxLLS: number | null;
  objectifSRU: number | null;
  deficitEstime: number | null;
  deficitMode: DeficitMode | null;
  logementsSociaux: number | null;
  residencesPrincipales: number | null;
  demandesEnAttente: number | null;
  attributionsAnnuelles: number | null;
  tensionTheorique: number | null;
  logementsRpls: number | null;
  logementsLocatifsSociaux: number | null;
  rplsAnnee: number | null;
  rplsSource: string | null;
  rplsMode: RplsMode;
  scoreLabel: "Élevé" | "Modéré" | "Faible" | "Indisponible";
  scorePartiel: boolean;
  dataStatus: "real" | "partial" | "unavailable";
  sources: string[];
  warnings: string[];
}

interface CommuneSuggestion {
  nom: string;
  code: string;
  codesPostaux: string[];
  departement?: {
    code: string;
    nom: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(
  value: number | null | undefined,
  options?: { suffix?: string; decimals?: number },
): string {
  if (value == null) return "Non disponible";
  const rounded =
    options?.decimals != null ? value.toFixed(options.decimals) : String(Math.round(value));
  return options?.suffix ? `${rounded} ${options.suffix}` : rounded;
}

function fmtLocale(value: number | null | undefined, suffix?: string): string {
  if (value == null) return "Non disponible";
  const s = value.toLocaleString("fr-FR");
  return suffix ? `${s} ${suffix}` : s;
}

function getScoreColors(
  label: "Élevé" | "Modéré" | "Faible" | "Indisponible",
): { scoreColor: string; scoreBg: string } {
  if (label === "Élevé")        return { scoreColor: "#dc2626", scoreBg: "#fef2f2" };
  if (label === "Modéré")       return { scoreColor: "#d97706", scoreBg: "#fffbeb" };
  if (label === "Faible")       return { scoreColor: "#059669", scoreBg: "#d1fae5" };
  return { scoreColor: "#64748b", scoreBg: "#f8fafc" };
}

function buildCommuneData(api: ApiResponse): CommuneData {
  const { scoreColor, scoreBg } = getScoreColors(api.scoreLabel);
  return { ...api, scoreColor, scoreBg };
}

function deficitModeLabel(result: CommuneData): string {
  if (result.deficitMode === "officiel") {
    return "Déficit SRU officiel";
  }

  if (result.deficitMode === "calcule") {
    const statutAtteint = result.statutSRU?.toLowerCase().includes("atteint");
    const objectifAtteint =
      result.tauxLLS != null &&
      result.objectifSRU != null &&
      result.tauxLLS >= result.objectifSRU;

    if (result.deficitEstime === 0 && (statutAtteint || objectifAtteint)) {
      return "Objectif SRU atteint : déficit estimé à 0";
    }

    if (result.residencesPrincipales != null) {
      return "Calcul Mimmoza : objectif SRU × résidences principales − logements sociaux";
    }

    return "Estimation Mimmoza via taux LLS, objectif SRU et logements sociaux";
  }

  if (result.deficitMode === "indisponible") {
    return "Données insuffisantes pour calculer le déficit";
  }

  return "Non disponible";
}

/**
 * Retourne true si l'une des sources contient "sne" (insensible à la casse).
 */
function hasSneSource(sources: string[]): boolean {
  return sources.some((s) => s.toLowerCase().includes("sne"));
}

/**
 * Retourne le libellé exact de la source SNE active, ou null si absente.
 */
function getSneSourceLabel(sources: string[]): string | null {
  return sources.find((s) => s.toLowerCase().includes("sne")) ?? null;
}

function hasRplsSource(sources: string[]): boolean {
  return sources.some((s) => s.toLowerCase().includes("rpls"));
}

function getRplsSourceLabel(sources: string[]): string | null {
  return sources.find((s) => s.toLowerCase().includes("rpls")) ?? null;
}

/**
 * Filtre les sources "techniques" à ne pas afficher dans les bandeaux de statut.
 */
function displayableSources(sources: string[]): string[] {
  return sources.filter((s) => s !== "geo.api.gouv.fr");
}

// ─── Composants ───────────────────────────────────────────────────────────────

function KpiCard(props: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  bg: string;
  unavailable?: boolean;
}) {
  return (
    <div
      style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 16 }}
      className="p-5 flex flex-col gap-3 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 13, color: "#64748b", fontWeight: 500 }}>{props.label}</span>
        <div
          style={{
            background: props.unavailable ? "#f8fafc" : props.bg,
            borderRadius: 10,
            padding: "6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {props.icon}
        </div>
      </div>
      <div
        style={{
          fontSize: props.unavailable ? 15 : 28,
          fontWeight: 700,
          color: props.unavailable ? "#94a3b8" : "#0f172a",
          lineHeight: 1.1,
          fontStyle: props.unavailable ? "italic" : "normal",
        }}
      >
        {props.value}
      </div>
      {props.sub && (
        <div style={{ fontSize: 12, color: "#94a3b8" }}>{props.sub}</div>
      )}
    </div>
  );
}

function DeficitCard(props: { result: CommuneData }) {
  const { result } = props;
  const unavailable = result.deficitEstime == null;
  return (
    <div
      style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 16 }}
      className="p-5 flex flex-col gap-3 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 13, color: "#64748b", fontWeight: 500 }}>Déficit estimé</span>
        <div
          style={{
            background: unavailable ? "#f8fafc" : "#fffbeb",
            borderRadius: 10,
            padding: "6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AlertTriangle
            style={{ width: 18, height: 18, color: unavailable ? "#94a3b8" : "#d97706" }}
          />
        </div>
      </div>
      <div
        style={{
          fontSize: unavailable ? 15 : 28,
          fontWeight: 700,
          color: unavailable ? "#94a3b8" : "#0f172a",
          lineHeight: 1.1,
          fontStyle: unavailable ? "italic" : "normal",
        }}
      >
        {result.deficitEstime != null
          ? `${result.deficitEstime.toLocaleString("fr-FR")} lgts`
          : "Non disponible"}
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8" }}>
        {deficitModeLabel(result)}
      </div>
      {result.deficitMode === "calcule" &&
        result.logementsSociaux != null &&
        result.residencesPrincipales != null &&
        result.objectifSRU != null && (
          <div style={{ fontSize: 11, color: "#c4b5fd", marginTop: -4 }}>
            {`(${result.objectifSRU}% × ${result.residencesPrincipales.toLocaleString("fr-FR")} − ${result.logementsSociaux.toLocaleString("fr-FR")})`}
          </div>
        )}
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function BesoinLogementsSociauxPage() {
  const [query, setQuery]       = useState("");
  const [result, setResult]     = useState<CommuneData | null>(null);
  const [loading, setLoading]   = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [suggestions, setSuggestions]         = useState<CommuneSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedCommune, setSelectedCommune] = useState<CommuneSuggestion | null>(null);
  const [activeIndex, setActiveIndex]         = useState(-1);
  const dropdownRef                           = useRef<HTMLDivElement>(null);

  const VIOLET       = "#6d28d9";
  const VIOLET_LIGHT = "#ede9fe";

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || selectedCommune?.nom === q) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const isPostalCode = /^\d{5}$/.test(q);
        const url = isPostalCode
          ? `https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(q)}&fields=nom,code,codesPostaux,departement&format=json&limit=8`
          : `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(q)}&boost=population&limit=8&fields=nom,code,codesPostaux,departement&format=json`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json();
        setSuggestions(Array.isArray(data) ? data : []);
        setShowSuggestions(true);
        setActiveIndex(-1);
      } catch {
        // abort silencieux
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, selectedCommune]);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  function handleSelectCommune(commune: CommuneSuggestion) {
    setSelectedCommune(commune);
    setQuery(`${commune.nom} ${commune.codesPostaux?.[0] ?? ""}`.trim());
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, -1));
        return;
      }
      if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        handleSelectCommune(suggestions[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        setShowSuggestions(false);
        return;
      }
    }
    if (e.key === "Enter") void handleAnalyse();
  }

  async function handleAnalyse() {
    if (!query.trim()) return;
    setLoading(true);
    setResult(null);
    setApiError(null);
    setShowSuggestions(false);

    try {
      const { data, error } = await supabase.functions.invoke("besoin-logements-sociaux", {
        body: { query: selectedCommune?.code ?? query.trim() },
      });

      if (import.meta.env.DEV) {
        console.log("[Mimmoza] logements sociaux:", data, error);
      }

      if (error) {
        setApiError("La source de données est indisponible. Veuillez réessayer.");
        return;
      }

      if (!data) {
        setApiError("Aucune donnée retournée pour cette commune.");
        return;
      }

      setResult(buildCommuneData(data as ApiResponse));
    } catch (err) {
      console.error("[Mimmoza] logements sociaux erreur:", err);
      setApiError("Erreur réseau. Vérifiez votre connexion et réessayez.");
    } finally {
      setLoading(false);
    }
  }

  // ── Valeurs affichées (calculées depuis result) ────────────────────────────

  const tensionLabel = (() => {
    if (!result) return "Non disponible";
    const dem = result.demandesEnAttente;
    const att = result.attributionsAnnuelles;
    if (dem == null && att == null) return "Non disponible";
    return `${fmtLocale(dem)} dem. / ${fmtLocale(att)} attr./an`;
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 900 }}>

      {/* ── Bandeau titre ── */}
      <div
        style={{
          background: "linear-gradient(135deg, #6d28d9 0%, #7c3aed 60%, #a78bfa 100%)",
          borderRadius: 20,
          padding: "28px 32px",
          color: "white",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", right: 24, top: 24, opacity: 0.12 }}>
          <Users style={{ width: 80, height: 80 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <div style={{ background: "rgba(255,255,255,0.2)", borderRadius: 10, padding: 8, display: "flex" }}>
            <Users style={{ width: 20, height: 20 }} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", opacity: 0.85, textTransform: "uppercase" }}>
            Module Promoteur · Marché
          </span>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, marginBottom: 8 }}>
          Besoin logements sociaux
        </h1>
        <p style={{ fontSize: 14, opacity: 0.85, margin: 0, maxWidth: 560, lineHeight: 1.6 }}>
          Détectez les communes où un programme intégrant du logement social ou abordable peut renforcer
          l'acceptabilité politique et la faisabilité de l'opération.
        </p>
      </div>

      {/* ── Formulaire ── */}
      <div
        style={{
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: 16,
          padding: "24px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 600, color: "#0f172a", margin: 0 }}>
          Rechercher une commune
        </h2>
        <div style={{ display: "flex", gap: 12 }}>
          <div ref={dropdownRef} style={{ flex: 1, position: "relative" }}>
            <Search
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                width: 16,
                height: 16,
                color: "#94a3b8",
                pointerEvents: "none",
                zIndex: 1,
              }}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedCommune(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ex : Suresnes, 92150, Nanterre…"
              style={{
                width: "100%",
                boxSizing: "border-box",
                paddingLeft: 40,
                paddingRight: 14,
                paddingTop: 11,
                paddingBottom: 11,
                fontSize: 14,
                border: "1.5px solid #e2e8f0",
                borderRadius: 10,
                outline: "none",
                color: "#0f172a",
                background: "#f8fafc",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#7c3aed";
                e.currentTarget.style.background  = "white";
                if (suggestions.length > 0) setShowSuggestions(true);
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#e2e8f0";
                e.currentTarget.style.background  = "#f8fafc";
              }}
            />

            {showSuggestions && suggestions.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  left: 0,
                  right: 0,
                  background: "white",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.12)",
                  zIndex: 30,
                  overflow: "hidden",
                }}
              >
                {suggestions.map((s, idx) => (
                  <button
                    key={s.code}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectCommune(s);
                    }}
                    onMouseEnter={() => setActiveIndex(idx)}
                    style={{
                      width: "100%",
                      border: "none",
                      borderBottom: idx < suggestions.length - 1 ? "1px solid #f1f5f9" : "none",
                      background: activeIndex === idx ? "#f5f3ff" : "white",
                      padding: "10px 14px",
                      cursor: "pointer",
                      textAlign: "left",
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      transition: "background 0.1s",
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{s.nom}</span>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>
                      {s.codesPostaux?.join(", ")}
                      {s.departement ? ` · ${s.departement.nom}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleAnalyse()}
            disabled={loading || !query.trim()}
            style={{
              background: loading || !query.trim()
                ? "#c4b5fd"
                : "linear-gradient(90deg, #6d28d9, #7c3aed)",
              color: "white",
              border: "none",
              borderRadius: 10,
              padding: "0 22px",
              fontSize: 14,
              fontWeight: 600,
              cursor: loading || !query.trim() ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              whiteSpace: "nowrap",
            }}
          >
            {loading ? (
              <>
                <span
                  style={{
                    display: "inline-block",
                    width: 14,
                    height: 14,
                    border: "2px solid rgba(255,255,255,0.4)",
                    borderTopColor: "white",
                    borderRadius: "50%",
                    animation: "spin 0.7s linear infinite",
                  }}
                />
                Analyse…
              </>
            ) : (
              <>
                <BarChart3 style={{ width: 15, height: 15 }} />
                Analyser la commune
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Erreur API ── */}
      {apiError && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 12,
            padding: "12px 16px",
          }}
        >
          <XCircle style={{ width: 16, height: 16, color: "#dc2626", flexShrink: 0, marginTop: 2 }} />
          <p style={{ fontSize: 13, color: "#991b1b", margin: 0, lineHeight: 1.5 }}>
            <strong>Erreur.</strong> {apiError}
          </p>
        </div>
      )}

      {/* ── Résultats ── */}
      {result && (
        <>
          {/* ── Badge statut données ── */}
          {result.dataStatus === "unavailable" && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 12,
                padding: "12px 16px",
              }}
            >
              <XCircle style={{ width: 16, height: 16, color: "#dc2626", flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 13, color: "#991b1b", lineHeight: 1.5 }}>
                <strong>Données officielles indisponibles pour cette commune.</strong>{" "}
                Les sources SRU et SNE ne contiennent aucune entrée pour ce code INSEE.
              </div>
            </div>
          )}

          {result.dataStatus === "partial" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "#fffbeb",
                border: "1px solid #fde68a",
                borderRadius: 12,
                padding: "10px 16px",
              }}
            >
              <AlertTriangle style={{ width: 15, height: 15, color: "#d97706", flexShrink: 0 }} />
              <p style={{ fontSize: 13, color: "#92400e", margin: 0 }}>
                <strong>Données officielles partielles.</strong>{" "}
                {displayableSources(result.sources).length > 0
                  ? `Sources disponibles : ${displayableSources(result.sources).join(", ")}.`
                  : "Certaines sources sont indisponibles pour cette commune."}
              </p>
            </div>
          )}

          {result.dataStatus === "real" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 12,
                padding: "10px 16px",
              }}
            >
              <CheckCircle style={{ width: 15, height: 15, color: "#059669", flexShrink: 0 }} />
              <p style={{ fontSize: 13, color: "#065f46", margin: 0 }}>
                <strong>Données officielles disponibles.</strong>{" "}
                {displayableSources(result.sources).length > 0
                  ? `Sources : ${displayableSources(result.sources).join(", ")}.`
                  : ""}
              </p>
            </div>
          )}

          {/* ── Warnings ── */}
          {result.warnings.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {result.warnings.map((w) => (
                <div
                  key={w}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    background: "#fafafa",
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    padding: "9px 13px",
                  }}
                >
                  <Info style={{ width: 13, height: 13, color: "#94a3b8", flexShrink: 0, marginTop: 2 }} />
                  <span style={{ fontSize: 12, color: "#64748b" }}>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── En-tête commune ── */}
          <div
            style={{
              background: "white",
              border: "1px solid #e2e8f0",
              borderRadius: 16,
              padding: "20px 28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ background: VIOLET_LIGHT, borderRadius: 12, padding: 10, display: "flex" }}>
                <Building2 style={{ width: 22, height: 22, color: VIOLET }} />
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>
                  {result.commune}
                  <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 400, marginLeft: 8 }}>
                    {result.codePostal}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
                  {result.statutSRU ?? "Statut SRU non disponible"}
                </div>
              </div>
            </div>

            {/* ── Score badge ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  background: result.scoreBg,
                  border: `1.5px solid ${result.scoreColor}30`,
                  borderRadius: 20,
                  padding: "6px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  color: result.scoreColor,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <div
                  style={{ width: 8, height: 8, borderRadius: "50%", background: result.scoreColor }}
                />
                Score besoin : {result.scoreLabel}
              </div>
              {result.scorePartiel && (
                <div
                  style={{
                    background: "#fffbeb",
                    border: "1px solid #fde68a",
                    borderRadius: 20,
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#92400e",
                  }}
                  title="Score calculé sur données SRU uniquement, sans tension de demande SNE"
                >
                  Partiel
                </div>
              )}
            </div>
          </div>

          {/* ── KPI cards ── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: 14,
            }}
          >
            <KpiCard
              label="Taux LLS actuel"
              value={fmt(result.tauxLLS, { suffix: "%", decimals: 1 })}
              sub="Part de logements locatifs sociaux"
              icon={<TrendingUp style={{ width: 18, height: 18, color: result.tauxLLS != null ? VIOLET : "#94a3b8" }} />}
              bg={VIOLET_LIGHT}
              unavailable={result.tauxLLS == null}
            />
            <KpiCard
              label="Objectif SRU"
              value={fmt(result.objectifSRU, { suffix: "%", decimals: 0 })}
              sub="Seuil loi SRU applicable"
              icon={<CheckCircle style={{ width: 18, height: 18, color: result.objectifSRU != null ? "#059669" : "#94a3b8" }} />}
              bg="#d1fae5"
              unavailable={result.objectifSRU == null}
            />
            <DeficitCard result={result} />
            <KpiCard
              label={result.rplsMode === "estime" ? "Parc social estimé" : "Parc social RPLS"}
              value={fmtLocale(result.logementsRpls, "lgts")}
              sub={
                result.rplsMode === "reel"
                  ? result.rplsAnnee
                    ? `RPLS réel ${result.rplsAnnee}`
                    : "RPLS réel"
                  : result.rplsMode === "estime"
                    ? "Estimation depuis données SRU"
                    : "RPLS non disponible"
              }
              icon={<Building2 style={{ width: 18, height: 18, color: result.logementsRpls != null ? VIOLET : "#94a3b8" }} />}
              bg={VIOLET_LIGHT}
              unavailable={result.logementsRpls == null}
            />
            <KpiCard
              label="Tension demande"
              value={fmt(result.tensionTheorique, { suffix: "x", decimals: 1 })}
              sub={tensionLabel}
              icon={<Users style={{ width: 18, height: 18, color: result.tensionTheorique != null ? "#dc2626" : "#94a3b8" }} />}
              bg="#fef2f2"
              unavailable={result.tensionTheorique == null}
            />
          </div>

          {/* ── Lecture promoteur ── */}
          {result.dataStatus !== "unavailable" && (
            <div
              style={{
                background: "#faf5ff",
                border: "1px solid #ddd6fe",
                borderRadius: 16,
                padding: "22px 26px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <Info style={{ width: 18, height: 18, color: VIOLET }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: "#3b0764" }}>Lecture promoteur</span>
              </div>
              <p style={{ fontSize: 14, color: "#4c1d95", margin: "0 0 14px 0", lineHeight: 1.6 }}>
                La commune présente un besoin marqué en logements sociaux ou abordables. Un projet intégrant
                une part sociale peut améliorer l'acceptabilité politique, faciliter les échanges avec la mairie
                et renforcer la justification du programme.
              </p>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  "Intégrer une part de logements sociaux / abordables",
                  "Étudier un montage avec bailleur social",
                  "Positionner le projet comme réponse au déficit communal",
                  "Préparer un argumentaire mairie",
                ].map((point) => (
                  <li key={point} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <ChevronRight style={{ width: 15, height: 15, color: VIOLET, flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: 13, color: "#4c1d95" }}>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Recommandation Mimmoza ── */}
          {result.dataStatus !== "unavailable" && (
            <div
              style={{
                background: "white",
                border: "1.5px solid #7c3aed",
                borderRadius: 16,
                padding: "22px 26px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ background: VIOLET_LIGHT, borderRadius: 8, padding: 6, display: "flex" }}>
                  <CheckCircle style={{ width: 16, height: 16, color: VIOLET }} />
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Recommandation Mimmoza</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  "Prévoir 25 à 35 % de logements sociaux ou abordables dans la programmation initiale.",
                  "Contacter la mairie et/ou les bailleurs sociaux actifs sur le secteur.",
                ].map((rec) => (
                  <div
                    key={rec}
                    style={{
                      background: VIOLET_LIGHT,
                      borderRadius: 10,
                      padding: "10px 14px",
                      fontSize: 13,
                      color: "#3b0764",
                      lineHeight: 1.5,
                    }}
                  >
                    {rec}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Sources ── */}
          <div
            style={{
              background: "white",
              border: "1px solid #e2e8f0",
              borderRadius: 16,
              padding: "22px 26px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <Database style={{ width: 16, height: 16, color: "#64748b" }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Sources de données</span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                gap: 10,
              }}
            >
              {(() => {
                const sneActive  = hasSneSource(result.sources);
                const sneLabel   = getSneSourceLabel(result.sources);
                const rplsActive = hasRplsSource(result.sources);
                const rplsLabel  = getRplsSourceLabel(result.sources);
                const sruActive  = result.sources.includes("Inventaire SRU");

                return [
                  {
                    label:       "geo.api.gouv.fr",
                    desc:        "Résolution commune et code INSEE",
                    branche:     true,
                    activeLabel: null,
                  },
                  {
                    label:       "Inventaire SRU",
                    desc:        "Données logements sociaux par commune",
                    branche:     sruActive,
                    activeLabel: null,
                  },
                  {
                    label:       "SNE",
                    desc:        "Demandes et attributions de logement social",
                    branche:     sneActive,
                    activeLabel: sneActive && sneLabel ? sneLabel : null,
                  },
                  {
                    label:       "RPLS",
                    desc:        result.rplsMode === "estime"
                      ? "Parc locatif social estimé depuis SRU"
                      : "Répertoire du parc locatif social",
                    branche:     rplsActive,
                    activeLabel: rplsActive && rplsLabel ? rplsLabel : null,
                  },
                ].map((src) => (
                  <div
                    key={src.label}
                    style={{
                      background: src.branche ? "#f0fdf4" : "#f8fafc",
                      border: `1px solid ${src.branche ? "#bbf7d0" : "#e2e8f0"}`,
                      borderRadius: 10,
                      padding: "10px 14px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: src.branche ? "#22c55e" : "#cbd5e1",
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>{src.label}</div>
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{src.desc}</div>
                    <div
                      style={{
                        fontSize: 10,
                        color: src.branche ? "#16a34a" : "#94a3b8",
                        marginTop: 4,
                        fontWeight: 500,
                      }}
                    >
                      {src.branche ? "Branché" : "Non encore branché"}
                    </div>
                    {src.activeLabel && (
                      <div
                        style={{
                          fontSize: 10,
                          color: "#6b7280",
                          marginTop: 3,
                          fontStyle: "italic",
                        }}
                      >
                        Source active : {src.activeLabel}
                      </div>
                    )}
                  </div>
                ));
              })()}
            </div>
          </div>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}