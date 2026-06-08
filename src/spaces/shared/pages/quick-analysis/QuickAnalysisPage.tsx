// ─────────────────────────────────────────────────────────────────────────────
// Mimmoza — Page "Analyse rapide" v6
// Branché sur valuation-engine v1.1 (Edge Function).
// Nouveautés v6 :
//  - Jamais 0 € : affichage du repli marché (valuationBasis) + fiabilité honnête.
//  - Bloc Emplacement (Transports / Commerces / Écoles / Marché).
//  - Bloc Réhabilitation (valeur après travaux, marges, TRI).
//  - Bloc Promoteur (SDP, constructibilité, charge foncière).
//  - Sources réelles PLU / Sitadel / Cadastre (plus de flags hardcodés).
// Principe conservé : zéro fictif. Chaque bloc masqué si données absentes.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  useValuationEngine,
  type EngineInput,
  type ComparableSale,
  type MarketPosition,
  type AnalysisType,
  type PropertyType,
} from "./useValuationEngine";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers d'affichage
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, suffix = "€"): string | null {
  if (n == null || !isFinite(n)) return null;
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + "\u202f" + suffix;
}
function fmtSafe(n: number | null | undefined, suffix = "€"): string {
  return fmt(n, suffix) ?? "—";
}
function fmtPct(n: number | null | undefined): string | null {
  if (n == null || !isFinite(n)) return null;
  return n.toFixed(1) + "\u202f%";
}

function getOpportunityStyle(score: number): { label: string; color: string; bg: string } {
  if (score >= 86) return { label: "Excellente opportunité", color: "#166534", bg: "#dcfce7" };
  if (score >= 71) return { label: "Bonne opportunité",      color: "#1e40af", bg: "#dbeafe" };
  if (score >= 51) return { label: "Opportunité correcte",   color: "#854d0e", bg: "#fef9c3" };
  if (score >= 31) return { label: "Opportunité faible",     color: "#9a3412", bg: "#ffedd5" };
  return               { label: "Mauvaise opportunité",      color: "#991b1b", bg: "#fee2e2" };
}
function getMarketPositionLabel(pos: MarketPosition, deltaPct?: number): { text: string; color: string } {
  const d = deltaPct != null ? ` (${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)} %)` : "";
  if (pos === "underpriced") return { text: `Décote détectée${d}`,            color: "#166534" };
  if (pos === "overpriced")  return { text: `Prix supérieur au marché${d}`,   color: "#991b1b" };
  return                            { text: `Prix cohérent avec le marché${d}`, color: "#166534" };
}
function getSecurityColor(score: number): string {
  if (score >= 75) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}
function getConfidenceLabel(score: number): string {
  if (score >= 80) return "Très forte fiabilité";
  if (score >= 65) return "Forte fiabilité";
  if (score >= 45) return "Fiabilité moyenne";
  return "Fiabilité faible";
}
function scoreColor(v: number): string {
  if (v >= 75) return "#166534";
  if (v >= 50) return "#854d0e";
  return "#991b1b";
}

function splitComparables(comps: ComparableSale[]): { primary: ComparableSale[]; extended: ComparableSale[] } {
  const primary  = comps.filter((c) => c.weight >= 0.3 && !c.outOfMarket);
  const extended = comps.filter((c) => c.weight < 0.3 || c.outOfMarket);
  return { primary, extended };
}
function comparableQuality(c: ComparableSale): { label: string; color: string } {
  if (c.outOfMarket) return { label: "Hors marché", color: "#991b1b" };
  if (c.weight >= 0.6) return { label: "Très pertinent", color: "#166534" };
  if (c.weight >= 0.3) return { label: "Pertinent",      color: "#854d0e" };
  return                    { label: "Élargi",          color: "#6b7280" };
}

function buildPriceExplanation(
  stats: { medianPriceM2: number; meanPriceM2: number; weightedPriceM2: number; sampleSize: number } | null,
  primaryCount: number
): string | null {
  if (!stats || stats.weightedPriceM2 <= 0) return null;
  const w = stats.weightedPriceM2;
  const med = stats.medianPriceM2;
  if (primaryCount >= 3) {
    if (w > med) return `Les ventes les plus proches et récentes présentent un prix/m² supérieur à la médiane globale (${fmtSafe(med, "€/m²")}). Le moteur privilégie ces transactions — le prix retenu (${fmtSafe(w, "€/m²")}) est légèrement supérieur.`;
    if (w < med) return `Les ventes les plus proches et récentes présentent un prix/m² inférieur à la médiane globale (${fmtSafe(med, "€/m²")}). Le moteur privilégie ces transactions — le prix retenu (${fmtSafe(w, "€/m²")}) est légèrement inférieur.`;
    return `Le prix pondéré (${fmtSafe(w, "€/m²")}) est très proche de la médiane — échantillon homogène.`;
  }
  return `Échantillon limité (${stats.sampleSize} comparable${stats.sampleSize > 1 ? "s" : ""}). Le prix retenu (${fmtSafe(w, "€/m²")}) est une approximation — fiabilité réduite.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Composants UI atomiques
// ─────────────────────────────────────────────────────────────────────────────

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; className?: string }> = ({ children, style, className }) => (
  <div className={className} style={{ background: "#fff", borderRadius: 16,
    border: "1px solid #e5e7eb", boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
    padding: "18px 22px", ...style }}>{children}</div>
);
const ST: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.09em",
    textTransform: "uppercase", color: "#9ca3af", marginBottom: 10, marginTop: 0 }}>{children}</p>
);
const Lbl: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>{children}</label>
);
const Inp: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input {...props}
    style={{ width: "100%", boxSizing: "border-box", border: "1px solid #d1d5db",
      borderRadius: 8, padding: "7px 11px", fontSize: 13, color: "#111827",
      outline: "none", background: "#fff", transition: "border-color .12s", ...props.style }}
    onFocus={(e) => { e.currentTarget.style.borderColor = "#6366f1"; }}
    onBlur={(e)  => { e.currentTarget.style.borderColor = "#d1d5db"; }} />
);
const Bar: React.FC<{ value: number; color: string; h?: number }> = ({ value, color, h = 5 }) => (
  <div style={{ height: h, background: "#f3f4f6", borderRadius: h, overflow: "hidden" }}>
    <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, value))}%`,
      background: color, borderRadius: h, transition: "width .6s ease" }} />
  </div>
);
const Ring: React.FC<{ score: number; color: string; size?: number }> = ({ score, color, size = 80 }) => {
  const r = 30; const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 80 80">
      <circle cx={40} cy={40} r={r} fill="none" stroke="#f3f4f6" strokeWidth={6} />
      <circle cx={40} cy={40} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={c} strokeDashoffset={c - (score / 100) * c}
        strokeLinecap="round" transform="rotate(-90 40 40)"
        style={{ transition: "stroke-dashoffset .7s ease" }} />
      <text x={40} y={36} textAnchor="middle" fontSize={16} fontWeight={800} fill={color}>{score}</text>
      <text x={40} y={50} textAnchor="middle" fontSize={9} fill="#9ca3af">/100</text>
    </svg>
  );
};
const KV: React.FC<{ label: string; value: string | null; c?: string }> = ({ label, value, c }) => {
  if (!value) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
      <span style={{ fontSize: 12, color: "#6b7280" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: c ?? "#111827" }}>{value}</span>
    </div>
  );
};
const StepDot: React.FC<{ status: string }> = ({ status }) => (
  <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
    background: status === "ok" ? "#22c55e" : status === "loading" ? "#6366f1"
      : status === "error" ? "#ef4444" : "#d1d5db",
    animation: status === "loading" ? "pulse 1.2s infinite" : "none", display: "inline-block" }} />
);
const SourceRow: React.FC<{ label: string; ok: boolean | "loading" }> = ({ label, ok }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f9fafb" }}>
    <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#374151" }}>
      <StepDot status={ok === true ? "ok" : ok === "loading" ? "loading" : "idle"} />{label}
    </span>
    <span style={{ fontSize: 11, fontWeight: 600,
      color: ok === true ? "#166534" : ok === "loading" ? "#4338ca" : "#9ca3af" }}>
      {ok === true ? "Disponible" : ok === "loading" ? "Chargement" : "Non disponible"}
    </span>
  </div>
);

// Mini-cellule de score (Emplacement, Promoteur…)
const ScoreCell: React.FC<{ label: string; value: number | null | undefined }> = ({ label, value }) => {
  if (value == null || !isFinite(value)) return null;
  const v = Math.round(value);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: scoreColor(v) }}>{v}</span>
      </div>
      <Bar value={v} color={scoreColor(v)} />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Tableau comparables
// ─────────────────────────────────────────────────────────────────────────────

const ComparableTable: React.FC<{ comps: ComparableSale[]; title: string; hasDistance: boolean }> = ({ comps, title, hasDistance }) => {
  if (comps.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: "#374151" }}>
        {title}{" "}
        <span style={{ fontWeight: 400, color: "#9ca3af" }}>— {comps.length} résultat{comps.length > 1 ? "s" : ""}</span>
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {["Date", "Surface", "Prix", "€/m²", "Pertinence", ...(hasDistance ? ["Distance"] : [])].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "5px 7px", fontSize: 10, fontWeight: 700,
                  color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em",
                  borderBottom: "2px solid #f3f4f6" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comps.map((c, i) => {
              const q = comparableQuality(c);
              const qBg = q.color === "#166534" ? "#dcfce7"
                : q.color === "#854d0e" ? "#fef9c3"
                : q.color === "#991b1b" ? "#fee2e2" : "#f3f4f6";
              return (
                <tr key={i} style={{ borderBottom: "1px solid #f9fafb",
                  background: c.outOfMarket ? "#fff5f5" : (i % 2 === 0 ? "#fff" : "#fafafa"),
                  opacity: c.outOfMarket ? 0.7 : 1 }}>
                  <td style={{ padding: "7px 7px", color: "#6b7280" }}>
                    {new Date(c.saleDate).toLocaleDateString("fr-FR", { month: "short", year: "numeric" })}
                  </td>
                  <td style={{ padding: "7px 7px" }}>{c.surface} m²</td>
                  <td style={{ padding: "7px 7px", fontWeight: 700, color: "#111827" }}>{fmtSafe(c.price)}</td>
                  <td style={{ padding: "7px 7px", fontWeight: 700,
                    color: c.outOfMarket ? "#991b1b" : "#6366f1",
                    textDecoration: c.outOfMarket ? "line-through" : "none" }}>{fmtSafe(c.priceM2, "€/m²")}</td>
                  <td style={{ padding: "7px 7px" }}>
                    <span style={{ fontSize: 10, background: qBg,
                      color: q.color, borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>{q.label}</span>
                  </td>
                  {hasDistance && (<td style={{ padding: "7px 7px", color: "#9ca3af" }}>{c.distanceMeters} m</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Formulaire — état local
// ─────────────────────────────────────────────────────────────────────────────

interface FormState {
  address: string; city: string; postalCode: string;
  surface: string; askingPrice: string;
  propertyType: PropertyType; analysisType: AnalysisType;
  expectedRent: string; worksAmount: string; resaleTarget: string; landSurface: string;
}
const defaultForm: FormState = {
  address: "", city: "", postalCode: "", surface: "", askingPrice: "",
  propertyType: "appartement", analysisType: "investisseur",
  expectedRent: "", worksAmount: "", resaleTarget: "", landSurface: "",
};
const ANALYSIS_TYPES: { id: AnalysisType; label: string; icon: string; color: string; bg: string }[] = [
  { id: "investisseur",   label: "Investisseur",   icon: "📈", color: "#6366f1", bg: "#eef2ff" },
  { id: "rehabilitateur", label: "Réhabilitateur", icon: "🔨", color: "#f59e0b", bg: "#fffbeb" },
  { id: "promoteur",      label: "Promoteur",      icon: "🏗️", color: "#10b981", bg: "#ecfdf5" },
];
const PROPERTY_TYPES: { id: PropertyType; label: string }[] = [
  { id: "appartement", label: "Appartement" }, { id: "maison", label: "Maison" },
  { id: "immeuble", label: "Immeuble" }, { id: "terrain", label: "Terrain" },
  { id: "local_commercial", label: "Local commercial" }, { id: "autre", label: "Autre" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────────────────────────────────────

const SNAPSHOT_KEY = "mimmoza.quickAnalysis.snapshot.v6";

const QuickAnalysisPage: React.FC = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(defaultForm);
  const { state, run, reset } = useValuationEngine();

  const setF = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
  }, []);

  const vCfg = ANALYSIS_TYPES.find((a) => a.id === form.analysisType)!;
  const { result, loading, error, location, steps, context } = state;

  const handleRun = useCallback(async () => {
    if (!form.surface || isNaN(+form.surface) || +form.surface <= 0) return;
    const input: EngineInput = {
      address:      form.address,
      city:         form.city,
      postalCode:   form.postalCode,
      surface:      +form.surface,
      askingPrice:  form.askingPrice ? +form.askingPrice : undefined,
      landSurface:  form.landSurface ? +form.landSurface : undefined,
      propertyType: form.propertyType,
      analysisType: form.analysisType,
      medianRentM2: form.expectedRent && form.surface ? +form.expectedRent / +form.surface : undefined,
      worksAmount:  form.worksAmount ? +form.worksAmount : undefined,
      resaleTarget: form.resaleTarget ? +form.resaleTarget : undefined,
    };
    await run(input);
  }, [form, run]);

  const handleReset = useCallback(() => { setForm(defaultForm); reset(); }, [reset]);

  const handleDeepAnalysis = useCallback(() => {
    const routes: Record<AnalysisType, string> = {
      investisseur:   "/marchand-de-bien/analyse",
      rehabilitateur: "/rehabilitation/vue-ensemble",
      promoteur:      "/promoteur/foncier",
    };
    if (result) {
      try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ form, result })); } catch { /* noop */ }
    }
    navigate(routes[form.analysisType]);
  }, [navigate, form, result]);

  // ── Dérivés ───────────────────────────────────────────────────────────────
  const oppStyle   = result ? getOpportunityStyle(result.opportunityScore) : null;
  const mpLabel    = result ? getMarketPositionLabel(result.marketPosition) : null;
  const secColor   = result ? getSecurityColor(result.securityScore) : "#9ca3af";
  const stats      = result?.meta.marketStats ?? null;
  const allComps   = result?.comparables ?? [];
  const { primary, extended } = splitComparables(allComps);
  const hasDistance = allComps.some((c) => c.distanceMeters > 0);
  const priceExpl  = result ? buildPriceExplanation(stats, primary.length) : null;
  const isReferenceBasis = result?.valuationBasis === "market_reference";
  const isInsufficient   = result?.valuationBasis === "insufficient";

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc",
      fontFamily: "'Geist','DM Sans','Inter',system-ui,sans-serif" }}>
      <style>{`
        @keyframes pulse  {0%,100%{opacity:1}50%{opacity:.35}}
        @keyframes spin   {from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes fadein {from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        .fi{animation:fadein 0.3s ease both}
      `}</style>

      {/* HERO */}
      <div
        style={{
          background: "linear-gradient(135deg, #6366f1 0%, #7c83f7 50%, #818cf8 100%)",
borderRadius: 32,
padding: "40px 44px",
marginTop: 24,
marginBottom: 32,
display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.9)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              marginBottom: 10,
              fontWeight: 600,
            }}
          >
            MIMMOZA · ANALYSE RAPIDE
          </div>

          <div
            style={{
              fontSize: 36,
              fontWeight: 600,
              color: "#fff",
              marginBottom: 10,
              lineHeight: 1.1,
              letterSpacing: "-0.025em",
            }}
          >
            Analyse rapide
          </div>

          <div
            style={{
              fontSize: 14,
              color: "rgba(255,255,255,0.75)",
              maxWidth: 520,
              lineHeight: 1.55,
            }}
          >
            Valeur · Opportunité · Risque · Recommandation — moteur Mimmoza
          </div>
        </div>

        {result && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => window.print()}
              style={{
                border: "1px solid rgba(255,255,255,0.3)",
                background: "rgba(255,255,255,0.15)",
                color: "#fff",
                borderRadius: 10,
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              📄 PDF
            </button>

            <button
              onClick={handleDeepAnalysis}
              style={{
                background: "#fff",
                color: "#1d6fe8",
                border: "none",
                borderRadius: 10,
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Analyse approfondie →
            </button>
          </div>
        )}
      </div>

      {error && (
        <div style={{ margin:"14px 28px 0", padding:"10px 14px", background:"#fee2e2", borderRadius:10,
          border:"1px solid #fca5a5", color:"#991b1b", fontSize:13, fontWeight:600 }}>⚠ {error}</div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"272px 1fr 308px", gap:16, padding:"18px 28px 18px", maxWidth:1440, margin:"0 auto" }}>

        {/* ══ GAUCHE ══ */}
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <Card>
            <ST>Votre bien</ST>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div><Lbl>Adresse</Lbl>
                <Inp value={form.address} placeholder="6 Parc de la Bérengère" onChange={(e) => setF("address", e.target.value)} /></div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:7 }}>
                <div><Lbl>Ville</Lbl><Inp value={form.city} placeholder="Saint-Cloud" onChange={(e) => setF("city", e.target.value)} /></div>
                <div><Lbl>CP</Lbl><Inp value={form.postalCode} placeholder="92210" onChange={(e) => setF("postalCode", e.target.value)} /></div>
              </div>
            </div>
            {location && (
              <div style={{ marginTop:9, padding:"6px 10px", background:"#f0fdf4", borderRadius:8, border:"1px solid #bbf7d0" }}>
                <p style={{ margin:0, fontSize:11, fontWeight:700, color:"#166534" }}>✓ {location.label}</p>
                <p style={{ margin:"1px 0 0", fontSize:10, color:"#4ade80" }}>
                  INSEE {location.communeInsee} · {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                </p>
              </div>
            )}
            <button onClick={handleReset}
              style={{ marginTop:9, width:"100%", background:"none", border:"1px solid #e5e7eb",
                borderRadius:8, padding:"5px 10px", fontSize:11, color:"#9ca3af", cursor:"pointer", fontWeight:600 }}>
              Nouveau lieu
            </button>
          </Card>

          <Card>
            <ST>Profil d'analyse</ST>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {ANALYSIS_TYPES.map((a) => {
                const active = form.analysisType === a.id;
                return (
                  <button key={a.id} onClick={() => setF("analysisType", a.id)}
                    style={{ display:"flex", alignItems:"center", gap:9, padding:"8px 12px",
                      border: active ? `2px solid ${a.color}` : "2px solid #e5e7eb", borderRadius:10,
                      background: active ? a.bg : "#fafafa", cursor:"pointer", textAlign:"left", transition:"all .12s" }}>
                    <span style={{ fontSize:15 }}>{a.icon}</span>
                    <span style={{ fontSize:13, fontWeight:700, color: active ? a.color : "#374151" }}>{a.label}</span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <ST>Paramètres</ST>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div><Lbl>Type de bien</Lbl>
                <select value={form.propertyType} onChange={(e) => setF("propertyType", e.target.value as PropertyType)}
                  style={{ width:"100%", border:"1px solid #d1d5db", borderRadius:8, padding:"7px 11px",
                    fontSize:13, color:"#111827", background:"#fff", outline:"none" }}>
                  {PROPERTY_TYPES.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}
                </select>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:7 }}>
                <div><Lbl>Surface (m²) *</Lbl><Inp type="number" value={form.surface} placeholder="65" onChange={(e) => setF("surface", e.target.value)} /></div>
                <div><Lbl>Prix demandé (€)</Lbl><Inp type="number" value={form.askingPrice} placeholder="520000" onChange={(e) => setF("askingPrice", e.target.value)} /></div>
              </div>
              {form.analysisType === "investisseur" && (
                <div><Lbl>Loyer attendu (€/mois)</Lbl><Inp type="number" value={form.expectedRent} placeholder="1500" onChange={(e) => setF("expectedRent", e.target.value)} /></div>
              )}
              {form.analysisType === "rehabilitateur" && (<>
                <div><Lbl>Budget travaux (€)</Lbl><Inp type="number" value={form.worksAmount} placeholder="40000" onChange={(e) => setF("worksAmount", e.target.value)} /></div>
                <div><Lbl>Prix revente cible (€)</Lbl><Inp type="number" value={form.resaleTarget} placeholder="260000" onChange={(e) => setF("resaleTarget", e.target.value)} /></div>
              </>)}
              {form.analysisType === "promoteur" && (
                <div><Lbl>Surface terrain (m²)</Lbl><Inp type="number" value={form.landSurface} placeholder="800" onChange={(e) => setF("landSurface", e.target.value)} /></div>
              )}
            </div>

            <button onClick={handleRun} disabled={loading || !form.surface}
              style={{ marginTop:12, width:"100%",
                background: loading || !form.surface ? "#a5b4fc" : "linear-gradient(135deg,#6366f1,#818cf8)",
                color:"#fff", border:"none", borderRadius:10, padding:"11px 14px", fontSize:14, fontWeight:800,
                cursor: loading || !form.surface ? "not-allowed" : "pointer",
                boxShadow: loading || !form.surface ? "none" : "0 2px 10px rgba(99,102,241,.4)", transition:"all .15s" }}>
              {loading ? (
                <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>
                  <span style={{ display:"inline-block", width:13, height:13, border:"2px solid rgba(255,255,255,.4)",
                    borderTopColor:"#fff", borderRadius:"50%", animation:"spin .7s linear infinite" }}/>
                  {steps.geocode==="loading" ? "Localisation…"
                    : steps.smartscore==="loading" || steps.georisques==="loading" ? "Données…" : "Moteur de valorisation…"}
                </span>
              ) : "⚡ Lancer l'analyse"}
            </button>

            {loading && (
              <div style={{ marginTop:9, display:"flex", flexDirection:"column", gap:3 }}>
                {([
                  ["Localisation", steps.geocode], ["SmartScore", steps.smartscore],
                  ["Géorisques", steps.georisques], ["Moteur", steps.engine],
                ] as [string, string][]).map(([l, s]) => (
                  <div key={l} style={{ display:"flex", alignItems:"center", gap:5, fontSize:10, color:"#6b7280" }}>
                    <StepDot status={s} />{l} {s === "ok" ? "✓" : s === "loading" ? "…" : s === "error" ? "✗" : ""}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ══ CENTRE ══ */}
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

          {!result && !loading && (
            <Card style={{ textAlign:"center", padding:"52px 28px" }}>
              <div style={{ fontSize:48, marginBottom:14 }}>⚡</div>
              <h2 style={{ margin:"0 0 8px", fontSize:19, fontWeight:800, color:"#111827" }}>Prêt à analyser</h2>
              <p style={{ margin:0, fontSize:13, color:"#6b7280", lineHeight:1.6, maxWidth:340, marginLeft:"auto", marginRight:"auto" }}>
                Renseignez l'adresse et la surface. Mimmoza récupère DVF, SmartScore et Géorisques,
                puis calcule une valeur estimée tracée.
              </p>
            </Card>
          )}

          {loading && (
            <Card style={{ textAlign:"center", padding:"46px 28px" }}>
              <div style={{ width:44, height:44, border:"4px solid #e0e7ff", borderTopColor:"#6366f1",
                borderRadius:"50%", animation:"spin .8s linear infinite", margin:"0 auto 14px" }}/>
              <p style={{ margin:0, fontSize:13, fontWeight:600, color:"#374151" }}>Analyse en cours…</p>
              <p style={{ margin:"4px 0 0", fontSize:11, color:"#9ca3af" }}>Géocodage · SmartScore · Géorisques · Valorisation DVF</p>
            </Card>
          )}

          {result && (<>

            {/* Bandeau base de calcul (repli marché) */}
            {isReferenceBasis && (
              <div className="fi" style={{ padding:"10px 14px", background:"#fffbeb", borderRadius:10,
                border:"1px solid #fde68a", color:"#854d0e", fontSize:12, fontWeight:600, lineHeight:1.5 }}>
                ⓘ Estimation basée sur la moyenne du secteur{context.marketReferenceSource ? ` (${context.marketReferenceSource})` : ""} —
                comparables directs insuffisants. Fiabilité réduite, fourchette élargie.
              </div>
            )}
            {isInsufficient && (
              <div className="fi" style={{ padding:"10px 14px", background:"#fee2e2", borderRadius:10,
                border:"1px solid #fca5a5", color:"#991b1b", fontSize:12, fontWeight:600 }}>
                ⚠ Aucune donnée de marché exploitable sur cette commune (ni DVF ni SmartScore). Estimation non calculable.
              </div>
            )}

            {/* Score Opportunité + Sécurité */}
            <Card className="fi">
              <div style={{ display:"flex", gap:20, flexWrap:"wrap" }}>
                <div style={{ flex:1, minWidth:160 }}>
                  <ST>Score Opportunité</ST>
                  <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                    <Ring score={result.opportunityScore} color={oppStyle!.color} />
                    <div>
                      <span style={{ display:"inline-block", padding:"3px 10px", background:oppStyle!.bg,
                        color:oppStyle!.color, borderRadius:20, fontSize:12, fontWeight:700, marginBottom:8 }}>{oppStyle!.label}</span>
                      <p style={{ margin:0, fontSize:12, color:mpLabel!.color, fontWeight:700 }}>{mpLabel!.text}</p>
                    </div>
                  </div>
                </div>
                <div style={{ width:1, background:"#f3f4f6", alignSelf:"stretch" }} />
                <div style={{ flex:1, minWidth:160 }}>
                  <ST>Sécurité du projet</ST>
                  <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                    <Ring score={result.securityScore} color={secColor} />
                    <div>
                      <p style={{ margin:"0 0 6px", fontSize:13, fontWeight:700, color:secColor }}>
                        {result.securityScore >= 75 ? "Secteur sûr" : result.securityScore >= 50 ? "Risque modéré" : "Risque élevé"}
                      </p>
                      <p style={{ margin:0, fontSize:11, color:"#6b7280" }}>Indépendant du score opportunité</p>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Emplacement (SmartScore) */}
            {result.locationAvailable && (
              <Card className="fi">
                <ST>Emplacement</ST>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px 22px" }}>
                  <ScoreCell label="Transports" value={result.locationBreakdown.transport} />
                  <ScoreCell label="Commerces"  value={result.locationBreakdown.commerces} />
                  <ScoreCell label="Écoles"     value={result.locationBreakdown.ecoles} />
                  <ScoreCell label="Marché"     value={result.locationBreakdown.marche_local} />
                </div>
                <p style={{ margin:"10px 0 0", fontSize:11, color:"#9ca3af" }}>
                  Score localisation global : <b style={{ color:scoreColor(result.locationScore) }}>{result.locationScore}/100</b>
                </p>
              </Card>
            )}

            {/* Positionnement marché */}
            {form.askingPrice && result.estimatedValue > 0 && (
              <Card className="fi">
                <ST>Positionnement marché</ST>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                  {[
                    { l:"Prix demandé",   v:fmt(+form.askingPrice),       c:"#374151" },
                    { l:"Estimé Mimmoza", v:fmt(result.estimatedValue),    c:"#4338ca" },
                    { l:"Marché local",   v:fmt(result.marketPriceM2,"€/m²"), c:"#6366f1" },
                  ].filter((x) => x.v).map(({l,v,c}) => (
                    <div key={l} style={{ textAlign:"center", padding:"10px 6px", background:"#f8fafc", borderRadius:10 }}>
                      <p style={{ margin:0, fontSize:9, color:"#9ca3af", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>{l}</p>
                      <p style={{ margin:"5px 0 0", fontSize:16, fontWeight:800, color:c }}>{v}</p>
                    </div>
                  ))}
                </div>
                <p style={{ margin:"8px 0 0", textAlign:"center", fontSize:12, fontWeight:700, color:mpLabel!.color }}>{mpLabel!.text}</p>
              </Card>
            )}

            {/* Drivers */}
            {result.valuationDrivers.length > 0 && !isReferenceBasis && (
              <Card className="fi">
                <ST>Comment est calculé ce score ?</ST>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {result.valuationDrivers.map((d) => {
                    const direction = d.impactPct > 0.1 ? "↑" : d.impactPct < -0.1 ? "↓" : "→";
                    const color = d.impactPct > 0.1 ? "#166534" : d.impactPct < -0.1 ? "#991b1b" : "#6b7280";
                    return (
                      <div key={d.key} style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                        padding:"8px 12px", background:"#f8fafc", borderRadius:8 }}>
                        <div>
                          <p style={{ margin:0, fontSize:12, fontWeight:600, color:"#374151" }}>{d.label}</p>
                          <p style={{ margin:0, fontSize:10, color:"#9ca3af" }}>Poids : {Math.round(d.weight * 100)} %</p>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <span style={{ fontSize:16, fontWeight:800, color }}>{direction}</span>
                          {d.impactPct !== 0 && (
                            <p style={{ margin:0, fontSize:10, color, fontWeight:600 }}>{d.impactPct > 0 ? "+" : ""}{d.impactPct.toFixed(1)} %</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p style={{ margin:"10px 0 0", fontSize:11, color:"#9ca3af", fontStyle:"italic" }}>
                  Les ajustements sont bornés à ±25 % du prix de marché brut.
                </p>
              </Card>
            )}

            {/* Prix retenu — détail (seulement si comparables) */}
            {stats && stats.weightedPriceM2 > 0 && (
              <Card className="fi">
                <ST>Prix retenu — détail du calcul</ST>
                <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                  {stats.meanPriceM2 > 0 && (<KV label="Prix moyen des comparables" value={fmtSafe(stats.meanPriceM2,"€/m²")} />)}
                  {stats.medianPriceM2 > 0 && (<KV label="Prix médian des comparables" value={fmtSafe(stats.medianPriceM2,"€/m²")} />)}
                  {stats.p25PriceM2 && stats.p75PriceM2 && (
                    <KV label="Fourchette P25–P75" value={`${fmtSafe(stats.p25PriceM2,"€/m²")} → ${fmtSafe(stats.p75PriceM2,"€/m²")}`} />
                  )}
                  {stats.weightedPriceM2 > 0 && (<KV label="Prix pondéré retenu (distance × récence)" value={fmtSafe(stats.weightedPriceM2,"€/m²")} c="#4338ca" />)}
                  {form.surface && stats.weightedPriceM2 > 0 && (<KV label="× Surface" value={`${form.surface} m²`} />)}
                  <KV label="Comparables utilisés" value={`${stats.sampleSize}`} />
                </div>
                {priceExpl && (
                  <div style={{ marginTop:10, padding:"9px 12px", background:"#f0f9ff", borderRadius:8, border:"1px solid #bae6fd" }}>
                    <p style={{ margin:0, fontSize:12, color:"#0369a1", lineHeight:1.6 }}>{priceExpl}</p>
                  </div>
                )}
              </Card>
            )}

            {/* Comparables */}
            <Card className="fi">
              <ST>Biens similaires vendus (DVF)</ST>
              {allComps.length === 0 ? (
                <div style={{ padding:"18px 0", textAlign:"center" }}>
                  <p style={{ margin:0, fontSize:22 }}>📂</p>
                  <p style={{ margin:"7px 0 0", fontSize:13, color:"#9ca3af" }}>
                    Aucun comparable DVF suffisamment pertinent — estimation issue de la moyenne du secteur.
                  </p>
                </div>
              ) : (
                <>
                  <ComparableTable comps={primary} hasDistance={hasDistance} title="Comparables principaux (poids ≥ 0.3)" />
                  <ComparableTable comps={extended} hasDistance={hasDistance} title="Comparables élargis" />
                </>
              )}
            </Card>

            {/* Potentiel locatif (investisseur) */}
            {form.analysisType === "investisseur" && (result.estimatedRent || result.grossYield) && (
              <Card className="fi">
                <ST>Potentiel locatif</ST>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
                  {[
                    { l:"Loyer estimé",   v:fmt(result.estimatedRent,"€/mois") },
                    { l:"Rendement brut", v:fmtPct(result.grossYield) },
                    { l:"Rendement net",  v:fmtPct(result.netYield) },
                  ].filter((x) => x.v).map(({l,v}) => (
                    <div key={l} style={{ textAlign:"center", padding:"10px 6px", background:"#f8fafc", borderRadius:10 }}>
                      <p style={{ margin:0, fontSize:9, color:"#9ca3af", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>{l}</p>
                      <p style={{ margin:"5px 0 0", fontSize:16, fontWeight:800, color:"#4338ca" }}>{v}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Réhabilitation */}
            {form.analysisType === "rehabilitateur" && result.rehab && (
              <Card className="fi">
                <ST>Potentiel réhabilitation</ST>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
                  {[
                    { l:"Valeur après travaux", v:fmt(result.rehab.valeurApresTravaux), c:"#4338ca" },
                    { l:"Budget travaux",       v:fmt(result.rehab.budgetTravaux),      c:"#854d0e" },
                    { l:"Coût total",           v:fmt(result.rehab.coutTotal),          c:"#374151" },
                    { l:"Marge brute",          v:fmt(result.rehab.margeBrute),         c: result.rehab.margeBrute >= 0 ? "#166534" : "#991b1b" },
                    { l:"Marge nette",          v:fmt(result.rehab.margeNette),         c: result.rehab.margeNette >= 0 ? "#166534" : "#991b1b" },
                    { l:"Marge nette %",        v:fmtPct(result.rehab.margeNettePct),   c: result.rehab.margeNettePct >= 0 ? "#166534" : "#991b1b" },
                    ...(result.rehab.triEstime != null ? [{ l:"TRI estimé", v:fmtPct(result.rehab.triEstime), c:"#0369a1" }] : []),
                  ].filter((x) => x.v).map(({l,v,c}) => (
                    <div key={l} style={{ textAlign:"center", padding:"10px 6px", background:"#f8fafc", borderRadius:10 }}>
                      <p style={{ margin:0, fontSize:9, color:"#9ca3af", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>{l}</p>
                      <p style={{ margin:"5px 0 0", fontSize:15, fontWeight:800, color:c }}>{v}</p>
                    </div>
                  ))}
                </div>
                <p style={{ margin:"8px 0 0", fontSize:11, color:"#9ca3af", fontStyle:"italic" }}>
                  TRI indicatif (hypothèse de durée d'opération). Affiner via l'analyse approfondie.
                </p>
              </Card>
            )}

            {/* Promoteur */}
            {form.analysisType === "promoteur" && result.promoteur && (
              <Card className="fi">
                <ST>Potentiel promoteur</ST>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:12 }}>
                  {[
                    { l:"SDP potentielle",   v:fmt(result.promoteur.sdpPotentielM2,"m²"),       c:"#059669" },
                    { l:"Emprise au sol",    v:fmt(result.promoteur.empriseAuSolM2,"m²"),       c:"#374151" },
                    { l:"Charge foncière",   v:fmt(result.promoteur.chargeFonciereM2Sdp,"€/m² SDP"), c:"#4338ca" },
                  ].filter((x) => x.v).map(({l,v,c}) => (
                    <div key={l} style={{ textAlign:"center", padding:"10px 6px", background:"#f8fafc", borderRadius:10 }}>
                      <p style={{ margin:0, fontSize:9, color:"#9ca3af", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>{l}</p>
                      <p style={{ margin:"5px 0 0", fontSize:15, fontWeight:800, color:c }}>{v}</p>
                    </div>
                  ))}
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px 22px" }}>
                  <ScoreCell label="Constructibilité" value={result.promoteur.constructibiliteScore} />
                  <ScoreCell label="Densification"    value={result.promoteur.densificationScore} />
                </div>
                {!context.plu && (
                  <p style={{ margin:"10px 0 0", fontSize:11, color:"#854d0e", fontStyle:"italic" }}>
                    ⚠ Règles PLU non branchées : potentiel calculé sur hypothèses. Brancher le PLU Engine pour fiabiliser.
                  </p>
                )}
              </Card>
            )}

          </>)}
        </div>

        {/* ══ DROITE — Synthèse ══ */}
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <Card style={{ position:"sticky", top:78 }}>
            {result ? (<>

              {/* Valeur estimée */}
              <div style={{ background:"linear-gradient(135deg,#eef2ff,#f5f3ff)", borderRadius:12,
                padding:"14px 16px", marginBottom:12, border:"1px solid #e0e7ff" }}>
                <p style={{ margin:"0 0 3px", fontSize:9, fontWeight:700, color:"#818cf8",
                  textTransform:"uppercase", letterSpacing:"0.09em" }}>Valeur estimée — moteur Mimmoza</p>
                <p style={{ margin:0, fontSize:28, fontWeight:800, color:"#4338ca", letterSpacing:"-0.025em" }}>
                  {result.estimatedValue > 0 ? fmtSafe(result.estimatedValue) : "Non calculable"}
                </p>
                {result.estimatedValue > 0 && (
                  <p style={{ margin:"3px 0 0", fontSize:10, color:"#6366f1" }}>
                    {fmtSafe(result.minEstimatedValue)} → {fmtSafe(result.maxEstimatedValue)}
                  </p>
                )}
                {result.marketPriceM2 > 0 && (
                  <p style={{ margin:"3px 0 0", fontSize:10, color:"#818cf8" }}>Marché : {fmtSafe(result.marketPriceM2,"€/m²")}</p>
                )}
                {isReferenceBasis && (
                  <p style={{ margin:"4px 0 0", fontSize:10, color:"#b45309", fontWeight:600 }}>
                    Base : moyenne du secteur{context.marketReferenceSource ? ` · ${context.marketReferenceSource}` : ""}
                  </p>
                )}
              </div>

              <KV label="Score opportunité" value={`${result.opportunityScore}/100`} c={oppStyle!.color} />
              <KV label="Sécurité du projet" value={`${result.securityScore}/100`} c={secColor} />
              <KV label="Positionnement" value={mpLabel!.text} c={mpLabel!.color} />
              {form.askingPrice && result.estimatedValue > 0 && (
                <KV label="Écart prix / estimation"
                  value={(() => {
                    const d = +form.askingPrice - result.estimatedValue;
                    const pct = (d / result.estimatedValue) * 100;
                    return `${d > 0 ? "+" : ""}${fmtSafe(d)} (${d > 0 ? "+" : ""}${pct.toFixed(1)} %)`;
                  })()}
                  c={(+form.askingPrice - result.estimatedValue) > 0 ? "#991b1b" : "#166534"} />
              )}

              {/* Fiabilité */}
              <div style={{ padding:"10px 0", borderBottom:"1px solid #f3f4f6" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                  <span style={{ fontSize:12, fontWeight:600, color:"#374151" }}>Fiabilité de l'estimation</span>
                  <span style={{ fontSize:13, fontWeight:700, color: scoreColor(result.confidenceScore) }}>{result.confidenceScore}/100</span>
                </div>
                <Bar value={result.confidenceScore}
                  color={result.confidenceScore>=65?"#22c55e":result.confidenceScore>=45?"#f59e0b":"#ef4444"} />
                <p style={{ margin:"4px 0 0", fontSize:10, color: scoreColor(result.confidenceScore) }}>
                  {getConfidenceLabel(result.confidenceScore)}
                </p>
              </div>

              {/* Détail fiabilité */}
              <div style={{ padding:"10px 0", borderBottom:"1px solid #f3f4f6" }}>
                <p style={{ margin:"0 0 7px", fontSize:10, fontWeight:700, color:"#9ca3af",
                  textTransform:"uppercase", letterSpacing:"0.08em" }}>Détail fiabilité</p>
                {allComps.length > 0 && (
                  <div style={{ display:"flex", gap:5, fontSize:11, color:"#166534", marginBottom:2 }}>
                    <span>✓</span><span>DVF : {allComps.length} comparable{allComps.length>1?"s":""}</span>
                  </div>
                )}
                {allComps.length > 0 && (
                  <div style={{ display:"flex", gap:5, fontSize:11, color:"#166534", marginBottom:2 }}>
                    <span>✓</span><span>Comparables récents : {allComps.filter(c=>c.ageYears<2).length} &lt; 2 ans</span>
                  </div>
                )}
                {isReferenceBasis && (
                  <div style={{ display:"flex", gap:5, fontSize:11, color:"#854d0e", marginBottom:2 }}>
                    <span>⚠</span><span>Valeur issue de la moyenne du secteur</span>
                  </div>
                )}
                {steps.georisques === "ok" && (
                  <div style={{ display:"flex", gap:5, fontSize:11, color:"#166534", marginBottom:2 }}>
                    <span>✓</span><span>Géorisques disponibles</span>
                  </div>
                )}
                {steps.smartscore === "ok" && (
                  <div style={{ display:"flex", gap:5, fontSize:11, color:"#166534", marginBottom:2 }}>
                    <span>✓</span><span>Prix marché local disponible</span>
                  </div>
                )}
                {!form.askingPrice && (
                  <div style={{ display:"flex", gap:5, fontSize:11, color:"#854d0e", marginBottom:2 }}>
                    <span>⚠</span><span>Prix demandé non renseigné</span>
                  </div>
                )}
              </div>

              {/* Sources (réelles) */}
              <div style={{ padding:"10px 0", borderBottom:"1px solid #f3f4f6" }}>
                <p style={{ margin:"0 0 6px", fontSize:10, fontWeight:700, color:"#9ca3af",
                  textTransform:"uppercase", letterSpacing:"0.08em" }}>Sources</p>
                <SourceRow label="DVF (Supabase RPC)" ok={steps.dvf === "ok" ? true : steps.dvf === "loading" ? "loading" : false} />
                <SourceRow label="SmartScore"         ok={steps.smartscore === "ok" ? true : steps.smartscore === "loading" ? "loading" : false} />
                <SourceRow label="Géorisques"         ok={steps.georisques === "ok" ? true : steps.georisques === "loading" ? "loading" : false} />
              </div>

              {/* PLU / Sitadel / Cadastre — affichés seulement si données présentes */}
              {context.plu && (
                <div style={{ padding:"10px 0", borderBottom:"1px solid #f3f4f6" }}>
                  <p style={{ margin:"0 0 6px", fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:"0.08em" }}>PLU</p>
                  <KV label="Zone" value={context.plu.zone ?? null} />
                  <KV label="CES max" value={context.plu.cesMaxPercent != null ? `${context.plu.cesMaxPercent} %` : null} />
                  <KV label="Hauteur max" value={context.plu.hauteurMaxM != null ? `${context.plu.hauteurMaxM} m` : (context.plu.hauteurMaxNiveaux != null ? `${context.plu.hauteurMaxNiveaux} niv.` : null)} />
                  <KV label="Pleine terre" value={context.plu.pleineTerrePercent != null ? `${context.plu.pleineTerrePercent} %` : null} />
                </div>
              )}

              {context.cadastre && (
                <div style={{ padding:"10px 0", borderBottom:"1px solid #f3f4f6" }}>
                  <p style={{ margin:"0 0 6px", fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:"0.08em" }}>Cadastre</p>
                  <KV label="Section" value={context.cadastre.section ?? null} />
                  <KV label="Parcelle" value={context.cadastre.parcelle ?? null} />
                  <KV label="Surface cadastrale" value={context.cadastre.surfaceCadastraleM2 != null ? `${context.cadastre.surfaceCadastraleM2} m²` : null} />
                </div>
              )}

              {/* Recommandation */}
              <div style={{ padding:"10px 0 0" }}>
                <p style={{ margin:"0 0 7px", fontSize:10, fontWeight:700, color:"#9ca3af",
                  textTransform:"uppercase", letterSpacing:"0.08em" }}>Recommandation Mimmoza</p>
                <p style={{ margin:"0 0 10px", fontSize:12, color:"#374151", lineHeight:1.6, fontWeight:500 }}>{result.recommendation}</p>
                {result.strengths.map((s, i) => (
                  <div key={`s${i}`} style={{ display:"flex", gap:5, fontSize:11, color:"#166534", marginBottom:2 }}><span>✓</span><span>{s}</span></div>
                ))}
                {result.warnings
                .filter((w) => !w.toLowerCase().includes("plu"))
                .map((w, i) => (
                <div key={`w${i}`} style={{ display:"flex", gap:5, fontSize:11, color:"#854d0e", marginBottom:2 }}><span>⚠</span><span>{w}</span></div>
      ))}
                {result.weaknesses.map((w, i) => (
                  <div key={`k${i}`} style={{ display:"flex", gap:5, fontSize:11, color:"#991b1b", marginBottom:2 }}><span>✗</span><span>{w}</span></div>
                ))}
              </div>

              <button onClick={handleDeepAnalysis}
                style={{ marginTop:14, width:"100%", background:"linear-gradient(135deg,#6366f1,#818cf8)",
                  color:"#fff", border:"none", borderRadius:10, padding:"12px 14px", fontSize:13, fontWeight:800,
                  cursor:"pointer", boxShadow:"0 3px 10px rgba(99,102,241,.4)" }}>Analyse approfondie →</button>
              <p style={{ margin:"7px 0 0", textAlign:"center", fontSize:10, color:"#9ca3af" }}>
                Moteur {result.meta.engineVersion} · {result.meta.comparablesUsed} comparables
              </p>

            </>) : (
              <div style={{ textAlign:"center", padding:"32px 0", color:"#d1d5db" }}>
                <p style={{ fontSize:30, margin:0 }}>📊</p>
                <p style={{ fontSize:12, margin:"9px 0 0", color:"#9ca3af" }}>La synthèse apparaîtra ici après l'analyse</p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default QuickAnalysisPage;