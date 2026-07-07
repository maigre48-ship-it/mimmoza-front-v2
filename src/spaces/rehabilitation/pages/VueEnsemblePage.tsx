// src/spaces/rehabilitation/pages/VueEnsemblePage.tsx
// Vue d'ensemble projet — Mimmoza / Espace Réhabilitation

import { ArrowRight, Building2, CheckCheck, Save } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { userStorage } from "@/lib/storage/userScopedStorage";

/* ── Thème ── */
const ACCENT  = "#f97316";
const GRAD    = "linear-gradient(135deg, #ea580c 0%, #fb923c 100%)";

// Cle de l'overview, dediee au projet actif (selectionne via "Ouvrir" sur ProjetsPage).
// Repli sur la cle historique si aucun projet actif (compatibilite ascendante).
function overviewKey(): string {
  try {
    const id = userStorage.getItem("mimmoza.rehab.activeProjectId");
    if (id) return `mimmoza_rehab_overview_${id}`;
  } catch { /* noop */ }
  return "mimmoza_rehab_overview";
}

/* ── Types ── */
type ErpStatus  = "oui" | "non" | "a_confirmer" | "";
type DpeLabel   = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "inconnu" | "";
type CoproStatus = "oui" | "non" | "a_confirmer" | "";

interface OverviewData {
  nomProjet:       string;
  adresse:         string;
  usageCible:      string;
  surface:         string;
  anneeConstruction: string;
  erp:             ErpStatus;
  dpe:             DpeLabel;
  copropriete:     CoproStatus;
  notes:           string;
}

const INITIAL: OverviewData = {
  nomProjet: "", adresse: "", usageCible: "", surface: "",
  anneeConstruction: "", erp: "", dpe: "", copropriete: "", notes: "",
};

/* ── Helpers UI ── */
function SegmentedSelect<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T | "";
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
        {label}
      </label>
      <div className="flex gap-2 flex-wrap">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="px-3 py-2 rounded-xl text-xs font-semibold border transition-all"
            style={
              value === opt.value
                ? { background: ACCENT, color: "#fff", borderColor: ACCENT }
                : { background: "#fff", color: "#64748b", borderColor: "#e2e8f0" }
            }
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text", suffix,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; suffix?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:border-transparent transition"
          style={{ "--tw-ring-color": ACCENT } as React.CSSProperties}
        />
        {suffix && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Page ── */
const VueEnsemblePage: React.FC = () => {
  const navigate  = useNavigate();
  const [data,     setData]     = useState<OverviewData>(INITIAL);
  const [saved,    setSaved]    = useState(false);
  const [hydrated, setHydrated] = useState(false);

  /* Charger depuis localStorage (cle dediee au projet actif) */
  useEffect(() => {
    try {
      const raw = userStorage.getItem(overviewKey());
      if (raw) setData({ ...INITIAL, ...JSON.parse(raw) });
    } catch { /* silent */ }
    setHydrated(true);
  }, []);

  /* Autosave : persiste à chaque changement (après hydratation) pour éviter
     la perte de données si l'utilisateur quitte sans cliquer Enregistrer.
     Le flag `hydrated` empêche d'écraser le storage avec INITIAL avant que
     le chargement initial n'ait injecté les vraies données. */
  useEffect(() => {
    if (!hydrated) return;
    try {
      userStorage.setItem(overviewKey(), JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
    } catch { /* silent */ }
  }, [data, hydrated]);

  function update<K extends keyof OverviewData>(key: K, val: OverviewData[K]) {
    setData((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  function handleSave() {
    try {
      userStorage.setItem(overviewKey(), JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* silent */ }
  }

  const dpeColor: Record<DpeLabel, string> = {
    A: "#059669", B: "#10b981", C: "#84cc16", D: "#eab308",
    E: "#f97316", F: "#ef4444", G: "#991b1b", inconnu: "#94a3b8", "": "#94a3b8",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>

      {/* Bannière */}
      <div style={{ background: GRAD, borderRadius: 24, padding: "32px 36px", marginBottom: 24, boxShadow: "0 8px 32px rgba(234,88,12,0.22)", position: "relative", overflow: "hidden" }}>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,.9)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>

          Réhabilitation › Vue d'ensemble
        </p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Building2 size={22} color="#fff" />
            <div>
              <h1 style={{ fontSize: 36, fontWeight: 600, color: "#fff", margin: 0, lineHeight: 1.1, letterSpacing: "-0.025em" }}>Vue d'ensemble</h1>

              <p style={{ fontSize: 13, color: "rgba(255,255,255,.75)", margin: 0 }}>
                Données générales du projet de réhabilitation
              </p>
            </div>
          </div>
          {data.nomProjet && (
            <div style={{
              background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,.25)",
              borderRadius: 10, padding: "8px 14px", color: "#fff", fontSize: 13, fontWeight: 700,
            }}>
              {data.nomProjet}
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto" }}>

        {/* Identification */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", padding: 24, marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 16 }}>
            Identification du projet
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Nom du projet" value={data.nomProjet} onChange={(v) => update("nomProjet", v)} placeholder="Ex : Immeuble Voltaire — Nantes" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Adresse" value={data.adresse} onChange={(v) => update("adresse", v)} placeholder="12 rue Voltaire, 44000 Nantes" />
            </div>
            <Field label="Usage cible" value={data.usageCible} onChange={(v) => update("usageCible", v)} placeholder="Ex : Coliving, Commerce, Logements…" />
            <Field label="Surface totale" value={data.surface} onChange={(v) => update("surface", v)} type="number" placeholder="0" suffix="m²" />
            <Field label="Année de construction" value={data.anneeConstruction} onChange={(v) => update("anneeConstruction", v)} type="number" placeholder="Ex : 1972" />
          </div>
        </div>

        {/* Qualifications réglementaires */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", padding: 24, marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 16 }}>
            Qualifications réglementaires
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <SegmentedSelect<ErpStatus>
              label="ERP (Établissement Recevant du Public)"
              value={data.erp}
              options={[
                { value: "oui",        label: "Oui — ERP" },
                { value: "non",        label: "Non ERP" },
                { value: "a_confirmer", label: "À confirmer" },
              ]}
              onChange={(v) => update("erp", v)}
            />

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                DPE actuel
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(["A", "B", "C", "D", "E", "F", "G", "inconnu"] as DpeLabel[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => update("dpe", d)}
                    style={{
                      width: 44, height: 44, borderRadius: 10, border: "2px solid",
                      fontWeight: 800, fontSize: 13, cursor: "pointer", transition: "all .15s",
                      borderColor: data.dpe === d ? dpeColor[d] : "#e2e8f0",
                      background: data.dpe === d ? dpeColor[d] : "#fff",
                      color: data.dpe === d ? "#fff" : "#94a3b8",
                    }}
                  >
                    {d === "inconnu" ? "?" : d}
                  </button>
                ))}
              </div>
              {data.dpe === "F" || data.dpe === "G" ? (
                <p style={{ fontSize: 11, color: "#ef4444", marginTop: 6 }}>
                  ⚠ Passoire thermique — mise en location contrainte (G interdit depuis 2025, F en 2028)
                </p>
              ) : null}
            </div>

            <SegmentedSelect<CoproStatus>
              label="Copropriété"
              value={data.copropriete}
              options={[
                { value: "oui",        label: "En copropriété" },
                { value: "non",        label: "Monopropriété" },
                { value: "a_confirmer", label: "À confirmer" },
              ]}
              onChange={(v) => update("copropriete", v)}
            />
          </div>
        </div>

        {/* Notes */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", padding: 24, marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 12 }}>
            Notes libres
          </p>
          <textarea
            value={data.notes}
            onChange={(e) => update("notes", e.target.value)}
            rows={4}
            placeholder="Observations, points à clarifier, contexte du projet…"
            style={{
              width: "100%", border: "1px solid #e2e8f0", borderRadius: 12,
              padding: "12px 14px", fontSize: 14, color: "#1e293b",
              resize: "vertical", outline: "none", fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
          <button
            type="button"
            onClick={handleSave}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "11px 22px", borderRadius: 12, border: "none",
              background: saved ? "#10b981" : ACCENT,
              color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "background .2s",
            }}
          >
            {saved ? <><CheckCheck size={16} />Enregistré</> : <><Save size={16} />Enregistrer</>}
          </button>

          <button
            type="button"
            onClick={() => navigate("/rehabilitation/conformite")}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "11px 22px", borderRadius: 12,
              border: `1px solid ${ACCENT}`, background: "#fff7ed",
              color: "#c2410c", fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}
          >
            Passer à Conformité <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default VueEnsemblePage;