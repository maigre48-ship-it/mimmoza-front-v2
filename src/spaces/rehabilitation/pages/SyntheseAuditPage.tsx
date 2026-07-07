// src/spaces/rehabilitation/pages/SyntheseAuditPage.tsx
// Synthèse audit — Mimmoza / Espace Réhabilitation

import {
  ArrowRight, Building2, Calculator, CheckCircle2, ClipboardList,
  RefreshCw, ShieldCheck,
  TriangleAlert, XCircle
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getActiveProjectId, scopedKey } from "../lib/rehabScope";
import { userStorage } from "@/lib/storage/userScopedStorage";

/* ── Thème ── */
const ACCENT    = "#f97316";
const GRAD      = "linear-gradient(135deg, #ea580c 0%, #fb923c 100%)";
const ACCENT_DARK = "#c2410c";

/* ── Clés localStorage ── */
const LS_OVERVIEW   = "mimmoza_rehab_overview";
const LS_CONFORMITE = "mimmoza_rehab_budget_import";
const LS_TRAVAUX    = "mimmoza_rehab_travaux_simulation";
const LS_PLAN       = "mimmoza_rehab_plan_analysis";

/* ── Types ── */
interface OverviewData {
  nomProjet?: string; adresse?: string; usageCible?: string;
  surface?: string; anneeConstruction?: string;
  erp?: string; dpe?: string; copropriete?: string; notes?: string;
}

interface ConformiteBudget {
  source?: string; date?: string; usage?: string; surface?: number;
  totalMin?: number; totalMax?: number;
  lots?: { nom: string; min: number; max: number; calcMode: string }[];
}

interface TravauxSimu {
  totalWithBuffer?: number; total?: number; bufferPct?: number;
  costPerM2?: number; range?: string; renovationLevel?: string;
  mode?: string; surfaceTotalM2?: number;
  lots?: { label: string; amount: number; code: string }[];
}

interface PlanAnalysis {
  score?: number; summary?: string; riskLevel?: string;
  recommendations?: { title: string; priority: string }[];
}

/* ── Helpers ── */
const fmt = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} M€`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)} k€`;
  return `${Math.round(n).toLocaleString("fr-FR")} €`;
};

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0",
      padding: 24, ...parseStyle(className),
    }}>
      {children}
    </div>
  );
}

// Mini helper pour convertir des classes simples en styles (on n'a pas Tailwind dans ce fichier)
function parseStyle(_cls: string): React.CSSProperties { return {}; }

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center", color: ACCENT }}>
        {icon}
      </div>
      <h2 style={{ fontSize: 15, fontWeight: 800, color: "#1e293b", margin: 0 }}>{title}</h2>
    </div>
  );
}

function Pill({ children, color = "#64748b", bg = "#f8fafc", border = "#e2e8f0" }: {
  children: React.ReactNode; color?: string; bg?: string; border?: string;
}) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 99, border: `1px solid ${border}`,
      background: bg, color, fontSize: 11, fontWeight: 700,
    }}>
      {children}
    </span>
  );
}

function EmptyState({ label, action, onAction }: { label: string; action: string; onAction: () => void }) {
  return (
    <div style={{ textAlign: "center", padding: "28px 16px", border: "1px dashed #e2e8f0", borderRadius: 12 }}>
      <p style={{ fontSize: 13, color: "#94a3b8", margin: "0 0 10px" }}>{label}</p>
      <button
        type="button" onClick={onAction}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "8px 16px", borderRadius: 10, border: `1px solid ${ACCENT}`,
          background: "#fff7ed", color: ACCENT_DARK, fontSize: 12, fontWeight: 700, cursor: "pointer",
        }}
      >
        {action} <ArrowRight size={13} />
      </button>
    </div>
  );
}

/* ── Page ── */
const SyntheseAuditPage: React.FC = () => {
  const navigate = useNavigate();

  const [overview,    setOverview]    = useState<OverviewData | null>(null);
  const [conformite,  setConformite]  = useState<ConformiteBudget | null>(null);
  const [travaux,     setTravaux]     = useState<TravauxSimu | null>(null);
  const [plan,        setPlan]        = useState<PlanAnalysis | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  function loadAll() {
    // Reset : on repart de zero a chaque chargement pour ne pas garder
    // les donnees d'un projet precedent si les cles sont vides.
    setOverview(null);
    setConformite(null);
    setTravaux(null);
    setPlan(null);
    try {
      const raw1 = userStorage.getItem(scopedKey(LS_OVERVIEW));
      if (raw1) setOverview(JSON.parse(raw1));
    } catch { /* silent */ }
    try {
      const raw2 = userStorage.getItem(scopedKey(LS_CONFORMITE));
      if (raw2) setConformite(JSON.parse(raw2));
    } catch { /* silent */ }
    try {
      const raw3 = userStorage.getItem(scopedKey(LS_TRAVAUX));
      if (raw3) setTravaux(JSON.parse(raw3));
    } catch { /* silent */ }
    try {
      const raw4 = userStorage.getItem(scopedKey(LS_PLAN));
      if (raw4) setPlan(JSON.parse(raw4));
    } catch { /* silent */ }
    setLastRefresh(new Date());
  }

  useEffect(() => { loadAll(); }, []);

  /* ── Enveloppes (deux estimateurs distincts — Option 1, on ne fusionne pas) ── */
  const budgetConformiteMin = conformite?.totalMin ?? 0;
  const budgetConformiteMax = conformite?.totalMax ?? 0;
  const budgetTravaux       = travaux?.totalWithBuffer ?? travaux?.total ?? 0;

  /* ── Points bloquants depuis lots conformité (heuristique) ── */
  const lotsBloquants = (conformite?.lots ?? []).filter((l) =>
    ["Sécurité incendie", "Accessibilité", "Désamiantage", "Électricité"].includes(l.nom)
  );

  const dpeIssue = overview?.dpe === "F" || overview?.dpe === "G";
  const hasCritical = lotsBloquants.length > 0 || dpeIssue;

  /* ── Décision globale ── */
  function globalDecision(): { label: string; sublabel: string; color: string; bg: string } {
    if (hasCritical) return {
      label: "Points bloquants identifiés",
      sublabel: "Des travaux obligatoires bloquent l'exploitation ou la mise en location.",
      color: "#991b1b", bg: "#fef2f2",
    };
    if ((conformite?.totalMin ?? 0) > 0 || (travaux?.totalWithBuffer ?? 0) > 0) return {
      label: "Projet chiffrable",
      sublabel: "Le projet est viable sous réserve de réaliser les travaux identifiés.",
      color: "#92400e", bg: "#fff7ed",
    };
    return {
      label: "Données incomplètes",
      sublabel: "Complétez les étapes Conformité et Travaux pour générer la synthèse.",
      color: "#475569", bg: "#f8fafc",
    };
  }

  const decision = globalDecision();

  // Aucun projet actif : on n'affiche pas de donnees (evite d'afficher
  // les residus d'un ancien test). On invite a ouvrir un projet.
  if (!getActiveProjectId()) {
    return (
      <div style={{ minHeight: "100vh", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 420, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "32px 28px" }}>
          <Building2 size={28} color={ACCENT} style={{ marginBottom: 12 }} />
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", margin: "0 0 8px" }}>Aucun projet selectionne</h2>
          <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, margin: "0 0 18px" }}>
            Ouvrez un projet depuis la liste pour consulter sa synthese d'audit.
          </p>
          <button
            type="button"
            onClick={() => navigate("/rehabilitation/projets")}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 22px", borderRadius: 12, border: "none", background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            Aller aux projets <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>

      {/* Bannière */}
      <div style={{
        background: GRAD, borderRadius: 24, padding: "32px 36px", marginBottom: 24,
        boxShadow: "0 8px 32px rgba(234,88,12,0.22)",
        position: "relative", overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 20, flexWrap: "wrap",
      }}>
        <div style={{ position: "relative" }}>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>

            Réhabilitation · Synthèse audit
          </p>
          <h1 style={{ fontSize: 36, fontWeight: 600, color: "#fff", marginBottom: 10, lineHeight: 1.1, letterSpacing: "-0.025em" }}>

            Synthèse audit
          </h1>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", maxWidth: 460, lineHeight: 1.55, margin: 0 }}>
            Consolidation de toutes les étapes du projet
          </p>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 10, marginBottom: 0 }}>
            Dernière mise à jour : {lastRefresh.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <button
          type="button" onClick={loadAll}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 20px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.15)", color: "#fff",
            fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0,
          }}
        >
          <RefreshCw size={14} />
          Actualiser
        </button>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── Décision globale ── */}
        <div style={{
          borderRadius: 16, padding: 24, border: `2px solid ${decision.color}20`,
          background: decision.bg,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            {hasCritical
              ? <XCircle size={22} color={decision.color} style={{ flexShrink: 0, marginTop: 2 }} />
              : <CheckCircle2 size={22} color={decision.color} style={{ flexShrink: 0, marginTop: 2 }} />
            }
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 18, fontWeight: 900, color: decision.color, margin: "0 0 4px" }}>{decision.label}</p>
              <p style={{ fontSize: 13, color: decision.color, opacity: 0.8, margin: 0 }}>{decision.sublabel}</p>
            </div>
          </div>

          {/* KPIs — deux enveloppes distinctes (pas de total fusionné) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginTop: 20 }}>
            {[
              {
                label: "Enveloppe conformité (indicative)",
                value: budgetConformiteMin > 0 ? `${fmt(budgetConformiteMin)} – ${fmt(budgetConformiteMax)}` : "—",
                hint: "Fourchette du risque réglementaire",
              },
              {
                label: "Budget travaux (chantier)",
                value: budgetTravaux > 0 ? fmt(budgetTravaux) : "—",
                hint: budgetTravaux > 0 ? "Estimatif détaillé + buffer" : "Lancez la Simulation travaux",
              },
            ].map((kpi) => (
              <div key={kpi.label} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", textAlign: "center", border: "1px solid #e2e8f0" }}>
                <p style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 6px" }}>{kpi.label}</p>
                <p style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", margin: "0 0 4px" }}>{kpi.value}</p>
                <p style={{ fontSize: 10, color: "#cbd5e1", margin: 0 }}>{kpi.hint}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Données projet ── */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", padding: 24 }}>
          <SectionTitle icon={<Building2 size={15} />} title="Données projet" />
          {overview ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                { label: "Projet",       value: overview.nomProjet       || "—" },
                { label: "Adresse",      value: overview.adresse         || "—" },
                { label: "Usage cible",  value: overview.usageCible      || "—" },
                { label: "Surface",      value: overview.surface ? `${overview.surface} m²` : "—" },
                { label: "Construction", value: overview.anneeConstruction || "—" },
                { label: "ERP",          value: overview.erp === "oui" ? "Oui" : overview.erp === "non" ? "Non" : overview.erp === "a_confirmer" ? "À confirmer" : "—" },
                { label: "DPE",          value: overview.dpe || "—" },
                { label: "Copropriété",  value: overview.copropriete === "oui" ? "Oui" : overview.copropriete === "non" ? "Non" : overview.copropriete === "a_confirmer" ? "À confirmer" : "—" },
              ].map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f8fafc" }}>
                  <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>{row.label}</span>
                  <span style={{ fontSize: 13, color: "#1e293b", fontWeight: 700 }}>{row.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              label="Aucune donnée projet. Remplissez la vue d'ensemble."
              action="Vue d'ensemble"
              onAction={() => navigate("/rehabilitation/vue-ensemble")}
            />
          )}
        </div>

        {/* ── Conformité ── */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", padding: 24 }}>
          <SectionTitle icon={<ShieldCheck size={15} />} title="Enveloppe de mise en conformité (indicative)" />
          {conformite ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: "12px 16px", background: "#fff7ed", borderRadius: 12, border: "1px solid #fed7aa" }}>
                <Calculator size={16} color={ACCENT} />
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: ACCENT_DARK }}>
                    {fmt(conformite.totalMin ?? 0)} – {fmt(conformite.totalMax ?? 0)}
                  </p>
                  {conformite.surface && conformite.surface > 0 && (
                    <p style={{ margin: 0, fontSize: 11, color: "#9a3412" }}>
                      Surface : {conformite.surface} m² · Usage : {conformite.usage || "—"}
                    </p>
                  )}
                </div>
              </div>

              {(conformite.lots ?? []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {conformite.lots!.map((lot) => (
                    <div key={lot.nom} style={{ border: "1px solid #fed7aa", background: "#fff7ed", borderRadius: 10, padding: "8px 12px" }}>
                      <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: ACCENT_DARK }}>{lot.nom}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9a3412" }}>
                        {fmt(lot.min)} – {fmt(lot.max)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Points bloquants */}
              {lotsBloquants.length > 0 && (
                <div style={{ marginTop: 16, padding: "12px 16px", background: "#fef2f2", borderRadius: 12, border: "1px solid #fecaca" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <TriangleAlert size={14} color="#dc2626" />
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#dc2626" }}>Points bloquants identifiés</span>
                  </div>
                  {lotsBloquants.map((l) => (
                    <div key={l.nom} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <XCircle size={12} color="#dc2626" />
                      <span style={{ fontSize: 12, color: "#991b1b" }}>{l.nom} — {fmt(l.min)} à {fmt(l.max)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              label="Aucun résultat de conformité. Complétez l'étape Conformité."
              action="Aller à Conformité"
              onAction={() => navigate("/rehabilitation/conformite")}
            />
          )}
        </div>

        {/* ── Travaux ── */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", padding: 24 }}>
          <SectionTitle icon={<Calculator size={15} />} title="Simulation travaux (chantier détaillé)" />
          {travaux && (travaux.total ?? 0) > 0 ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 16 }}>
                {[
                  { label: "Total HT",       value: fmt(travaux.total ?? 0) },
                  { label: "Total + buffer", value: fmt(travaux.totalWithBuffer ?? 0), highlight: true },
                  { label: "€/m²",          value: travaux.costPerM2 ? fmt(travaux.costPerM2) : "—" },
                  { label: "Gamme",          value: travaux.range ?? "—" },
                ].map((kpi) => (
                  <div key={kpi.label} style={{
                    padding: "12px 16px", borderRadius: 12, textAlign: "center",
                    background: kpi.highlight ? "#fff7ed" : "#f8fafc",
                    border: `1px solid ${kpi.highlight ? "#fed7aa" : "#e2e8f0"}`,
                  }}>
                    <p style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 4px" }}>{kpi.label}</p>
                    <p style={{ fontSize: 16, fontWeight: 800, color: kpi.highlight ? ACCENT_DARK : "#1e293b", margin: 0 }}>{kpi.value}</p>
                  </div>
                ))}
              </div>

              {/* Lots principaux */}
              {(travaux.lots ?? []).filter((l) => l.amount > 0).slice(0, 6).map((lot) => (
                <div key={lot.code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ fontSize: 13, color: "#475569" }}>{lot.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{fmt(lot.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              label="Aucune simulation travaux enregistrée. Lancez la Simulation travaux pour alimenter la synthèse."
              action="Aller à Travaux"
              onAction={() => navigate("/rehabilitation/travaux")}
            />
          )}
        </div>

        {/* ── Analyse du plan ── */}
        {plan && (
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", padding: 24 }}>
            <SectionTitle icon={<ClipboardList size={15} />} title="Analyse du plan" />
            {plan.summary && (
              <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, marginBottom: 12 }}>{plan.summary}</p>
            )}
            {plan.score != null && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>Score global :</span>
                <span style={{ fontSize: 20, fontWeight: 900, color: plan.score >= 70 ? "#10b981" : plan.score >= 50 ? "#f97316" : "#ef4444" }}>
                  {plan.score}/100
                </span>
              </div>
            )}
            {(plan.recommendations ?? []).filter((r) => r.priority === "urgente").map((r) => (
              <div key={r.title} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <TriangleAlert size={13} color="#dc2626" />
                <span style={{ fontSize: 12, color: "#991b1b" }}>{r.title}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Actions recommandées ── */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", padding: 24 }}>
          <SectionTitle icon={<ClipboardList size={15} />} title="Actions prioritaires" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dpeIssue && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", background: "#fef2f2", borderRadius: 10, border: "1px solid #fecaca" }}>
                <XCircle size={15} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#991b1b" }}>DPE {overview?.dpe} — Passoire thermique</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9a3412" }}>Travaux d'isolation ou de chauffage requis avant mise en location.</p>
                </div>
              </div>
            )}
            {lotsBloquants.map((lot) => (
              <div key={lot.nom} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", background: "#fef2f2", borderRadius: 10, border: "1px solid #fecaca" }}>
                <XCircle size={15} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#991b1b" }}>{lot.nom} — obligatoire</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9a3412" }}>Budget estimé : {fmt(lot.min)} – {fmt(lot.max)}</p>
                </div>
              </div>
            ))}
            {!dpeIssue && lotsBloquants.length === 0 && (
              <p style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>
                Aucun point bloquant identifié. Complétez les étapes Conformité et Vue d'ensemble pour affiner.
              </p>
            )}
          </div>
        </div>

        {/* ── Accès Valorisation ── */}
        <div style={{
          background: GRAD, borderRadius: 16, padding: 24,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 16, flexWrap: "wrap",
        }}>
          <div>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,.6)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: 1 }}>
              Étape suivante
            </p>
            <p style={{ fontSize: 18, fontWeight: 900, color: "#fff", margin: 0 }}>Valorisation du bien</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,.75)", margin: "4px 0 0" }}>
              Estimez la valeur après travaux et calculez votre marge de réhabilitation.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/rehabilitation/valorisation")}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "12px 24px", borderRadius: 12, border: "none",
              background: "#fff", color: ACCENT_DARK,
              fontSize: 14, fontWeight: 800, cursor: "pointer", flexShrink: 0,
            }}
          >
            Accéder à la Valorisation <ArrowRight size={16} />
          </button>
        </div>

        <div style={{ height: 16 }} />
      </div>
    </div>
  );
};

export default SyntheseAuditPage;