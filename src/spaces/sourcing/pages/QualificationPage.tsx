import React, { useState, useEffect, useCallback } from "react";
import type {
  QualificationInput,
  QualificationResult,
  SourcingSmartScore,
  QualificationDecision,
} from "../qualification/qualification.types";
import { computeQualification } from "../qualification/qualification.engine";
import {
  loadSmartScore,
  setSmartScore,
  upsertQualification,
  readSourcingSnapshot,
} from "../shared/sourcingSnapshot.store";
import { useSourcingSnapshotTick } from "../shared/hooks/useSourcingSnapshotTick";
import {
  getActiveDealId,
  getDealContextSnapshot,
  subscribe as subscribeDealContext,
  type DealContextMeta,
} from "../../marchand/shared/marchandDealContext.store";

/* ────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────── */

function parseNumberFR(raw: string): number {
  if (!raw || !raw.trim()) return 0;
  const cleaned = raw.replace(/[€\s\u00a0\u202f]/g, "").replace(/,/g, ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

const fmtEur = (v: number) => Math.round(v).toLocaleString("fr-FR") + " €";
const fmtPct = (v: number) => v.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";

const DECISION_COLORS: Record<QualificationDecision, string> = {
  GO: "#16a34a", GO_AVEC_RESERVES: "#f59e0b", NO_GO: "#dc2626",
};
const DECISION_LABELS: Record<QualificationDecision, string> = {
  GO: "GO", GO_AVEC_RESERVES: "GO avec réserves", NO_GO: "NO GO",
};
const GRADE_COLORS: Record<string, string> = {
  A: "#16a34a", B: "#22c55e", C: "#f59e0b", D: "#f97316", E: "#dc2626", F: "#991b1b",
};

/* ────────────────────────────────────────────
   Form state
   ──────────────────────────────────────────── */

interface FormFields {
  prixAchat: string;
  fraisNotairePct: string;
  budgetTravaux: string;
  fraisDivers: string;
  prixReventeEstime: string;
  dureeMois: string;
  apport: string;
}

const DEFAULTS: FormFields = {
  prixAchat: "", fraisNotairePct: "8", budgetTravaux: "", fraisDivers: "",
  prixReventeEstime: "", dureeMois: "12", apport: "",
};

function inputToFields(inp: QualificationInput): FormFields {
  return {
    prixAchat: inp.prixAchat ? String(inp.prixAchat) : "",
    fraisNotairePct: String(inp.fraisNotairePct ?? 8),
    budgetTravaux: inp.budgetTravaux ? String(inp.budgetTravaux) : "",
    fraisDivers: inp.fraisDivers ? String(inp.fraisDivers) : "",
    prixReventeEstime: inp.prixReventeEstime ? String(inp.prixReventeEstime) : "",
    dureeMois: inp.dureeMois ? String(inp.dureeMois) : "12",
    apport: inp.apport ? String(inp.apport) : "",
  };
}

function buildFieldsFromMeta(meta: DealContextMeta | undefined): FormFields {
  if (!meta) return DEFAULTS;
  return {
    ...DEFAULTS,
    prixAchat: meta.purchasePrice != null && meta.purchasePrice > 0 ? String(meta.purchasePrice) : "",
    prixReventeEstime: meta.resaleTarget != null && meta.resaleTarget > 0 ? String(meta.resaleTarget) : "",
  };
}

/* ════════════════════════════════════════════
   QualificationPage
   ════════════════════════════════════════════ */

export default function QualificationPage() {
  const snapshot = useSourcingSnapshotTick();

  const [dealId, setDealId] = useState<string | null>(() => getActiveDealId());

  useEffect(() => {
    const unsub = subscribeDealContext((ctx) => { setDealId(ctx.activeDealId); });
    return unsub;
  }, []);

  const [fields, setFields] = useState<FormFields>(DEFAULTS);
  const [result, setResult] = useState<QualificationResult | null>(null);
  const [smartScore, setSmartScoreLocal] = useState<SourcingSmartScore | null>(null);

  /* ── Init / re-init quand le dealId change ── */
  useEffect(() => {
    if (!dealId) {
      setFields(DEFAULTS);
      setResult(null);
      setSmartScoreLocal(null);
      return;
    }

    const snap = readSourcingSnapshot();
    let ss = snap.smartScore ?? null;
    if (!ss) { ss = loadSmartScore(); if (ss) setSmartScore(ss); }
    setSmartScoreLocal(ss);

    if (snap.qualificationInput) {
      setFields(inputToFields(snap.qualificationInput));
    } else {
      const currentSnap = getDealContextSnapshot();
      setFields(buildFieldsFromMeta(currentSnap.meta));
    }

    setResult(snap.qualificationResult ?? null);
  }, [dealId]);

  const handleChange = (key: keyof FormFields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFields((prev) => ({ ...prev, [key]: e.target.value }));
  };

  const handleAnalyse = useCallback(() => {
    if (!dealId) return;
    const input: QualificationInput = {
      prixAchat: parseNumberFR(fields.prixAchat),
      fraisNotairePct: parseNumberFR(fields.fraisNotairePct) || 8,
      budgetTravaux: parseNumberFR(fields.budgetTravaux),
      fraisDivers: parseNumberFR(fields.fraisDivers),
      prixReventeEstime: parseNumberFR(fields.prixReventeEstime),
      dureeMois: parseNumberFR(fields.dureeMois) || 12,
      apport: parseNumberFR(fields.apport),
    };
    const res = computeQualification(input);
    setResult(res);
    upsertQualification(input, res);
  }, [fields, dealId]);

  const inputStyle: React.CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 };
  const fieldWrap: React.CSSProperties = { marginBottom: 14 };
  const cardStyle: React.CSSProperties = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24, marginBottom: 16 };

  if (!dealId) {
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "#111827", margin: 0 }}>Qualification</h1>
          <p style={{ fontSize: 15, color: "#6b7280", marginTop: 4 }}>Go / No-Go en 3 minutes — Profil Marchand de Biens</p>
        </div>
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 16, padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "#92400e", marginBottom: 8 }}>Aucun deal actif</div>
          <p style={{ fontSize: "0.875rem", color: "#b45309", lineHeight: 1.6, margin: 0 }}>
            Sélectionnez un deal dans le Pipeline pour lancer la qualification.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "#111827", margin: 0 }}>Qualification</h1>
        <p style={{ fontSize: 15, color: "#6b7280", marginTop: 4 }}>Go / No-Go en 3 minutes — Profil Marchand de Biens · Deal {dealId}</p>
      </div>

      <div style={{ display: "flex", gap: 32, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={cardStyle}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#111827", marginTop: 0, marginBottom: 18 }}>Paramètres de l'opération</h2>
            <Field label="Prix d'achat (€)" value={fields.prixAchat} onChange={handleChange("prixAchat")} placeholder="200 000" styles={{ inputStyle, labelStyle, fieldWrap }} />
            <Field label="Frais de notaire (%)" value={fields.fraisNotairePct} onChange={handleChange("fraisNotairePct")} placeholder="8" styles={{ inputStyle, labelStyle, fieldWrap }} />
            <Field label="Budget travaux (€)" value={fields.budgetTravaux} onChange={handleChange("budgetTravaux")} placeholder="50 000" styles={{ inputStyle, labelStyle, fieldWrap }} />
            <Field label="Frais divers (€)" value={fields.fraisDivers} onChange={handleChange("fraisDivers")} placeholder="5 000" styles={{ inputStyle, labelStyle, fieldWrap }} />
            <Field label="Prix de revente estimé (€)" value={fields.prixReventeEstime} onChange={handleChange("prixReventeEstime")} placeholder="350 000" styles={{ inputStyle, labelStyle, fieldWrap }} />
            <Field label="Durée de l'opération (mois)" value={fields.dureeMois} onChange={handleChange("dureeMois")} placeholder="12" styles={{ inputStyle, labelStyle, fieldWrap }} />
            <Field label="Apport personnel (€)" value={fields.apport} onChange={handleChange("apport")} placeholder="50 000" styles={{ inputStyle, labelStyle, fieldWrap }} />
            <button onClick={handleAnalyse} style={{ width: "100%", padding: "12px 0", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 8 }}>
              Analyser & enregistrer
            </button>
          </div>
        </div>

        <div style={{ width: 400, flexShrink: 0, position: "sticky", top: 24 }}>
          <SmartScoreCard smartScore={smartScore} />
          {result ? (
            <div style={cardStyle}>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <span style={{ display: "inline-block", padding: "8px 28px", borderRadius: 999, fontSize: 18, fontWeight: 700, color: "#fff", background: DECISION_COLORS[result.decision] }}>{DECISION_LABELS[result.decision]}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
                <Metric label="Coût total" value={fmtEur(result.coutTotalOperation)} />
                <Metric label="Frais notaire" value={fmtEur(result.fraisNotaire)} />
                <Metric label="Marge brute" value={fmtEur(result.margeBrute)} />
                <Metric label="Marge" value={fmtPct(result.margePct)} />
                <Metric label="ROI" value={fmtPct(result.roi)} />
                <Metric label="TRI annualisé" value={fmtPct(result.tri)} />
              </div>
              {result.raisons.length > 0 && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Analyse</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {result.raisons.map((r, i) => (<li key={i} style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.7 }}>{r}</li>))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div style={{ background: "#f9fafb", border: "1px dashed #d1d5db", borderRadius: 12, padding: 36, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>
              Renseignez les paramètres puis cliquez sur «&nbsp;Analyser&nbsp;»
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   Sub-components
   ════════════════════════════════════════════ */

function SmartScoreCard({ smartScore }: { smartScore: SourcingSmartScore | null }) {
  if (!smartScore) {
    return (
      <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 12, padding: 20, marginBottom: 16, fontSize: 13, color: "#92400e" }}>
        <strong>SmartScore absent</strong> — repassez par Sourcing / Enregistrer pour alimenter le score.
      </div>
    );
  }
  const gradeColor = GRADE_COLORS[smartScore.grade ?? ""] ?? "#6b7280";
  const verdictHint =
    smartScore.verdict === "NO_GO" ? { bg: "#fef2f2", border: "#fecaca", color: "#991b1b", text: "⚠ Acquisition NO_GO — qualification probablement défavorable" }
    : smartScore.verdict === "GO" ? { bg: "#f0fdf4", border: "#bbf7d0", color: "#166534", text: "✓ Bon signal — poursuivre qualification" }
    : smartScore.verdict === "GO_AVEC_RESERVES" ? { bg: "#fffbeb", border: "#fde68a", color: "#92400e", text: "~ Acquisition avec réserves — vérifier les indicateurs" }
    : null;

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>SmartScore (Acquisition)</div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 36, fontWeight: 800, color: "#111827", lineHeight: 1 }}>
          {smartScore.score}<span style={{ fontSize: 16, fontWeight: 500, color: "#9ca3af" }}>/100</span>
        </div>
        {smartScore.grade && <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, background: gradeColor, color: "#fff", fontSize: 18, fontWeight: 700 }}>{smartScore.grade}</span>}
        {smartScore.verdict && <span style={{ padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, color: "#fff", background: DECISION_COLORS[smartScore.verdict] ?? "#6b7280" }}>{DECISION_LABELS[smartScore.verdict] ?? smartScore.verdict}</span>}
      </div>
      {smartScore.rationale && <div style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.5, marginBottom: verdictHint ? 12 : 0 }}>{smartScore.rationale}</div>}
      {verdictHint && <div style={{ background: verdictHint.bg, border: `1px solid ${verdictHint.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 500, color: verdictHint.color }}>{verdictHint.text}</div>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, styles }: {
  label: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  styles: { inputStyle: React.CSSProperties; labelStyle: React.CSSProperties; fieldWrap: React.CSSProperties };
}) {
  return (
    <div style={styles.fieldWrap}>
      <label style={styles.labelStyle}>{label}</label>
      <input type="text" style={styles.inputStyle} value={value} onChange={onChange} placeholder={placeholder} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#f9fafb", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 500, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>{value}</div>
    </div>
  );
}