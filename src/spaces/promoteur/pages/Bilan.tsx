// src/spaces/promoteur/pages/Bilan.tsx

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BarChart2, Save, Loader2, Sparkles,
  TrendingUp, TrendingDown, AlertTriangle,
  FileText, Info
} from "lucide-react";
import { supabase } from "../../../supabaseClient";
import { usePromoteurStudy } from "../shared/usePromoteurStudy";
import type { PromoteurBilanData } from "../shared/promoteurStudy.types";

const GRAD_PRO   = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
const ACCENT_PRO = "#5247b8";

const styles = {
  container:  { padding: "24px", maxWidth: "1100px", margin: "0 auto", fontFamily: "'Inter', -apple-system, sans-serif" } as React.CSSProperties,
  card:       { background: "white", borderRadius: "14px", border: "1px solid #e2e8f0", overflow: "hidden", marginBottom: 20 } as React.CSSProperties,
  cardHeader: { padding: "16px 20px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "space-between" } as React.CSSProperties,
  cardTitle:  { fontSize: "14px", fontWeight: 700, color: "#0f172a", display: "flex", alignItems: "center", gap: "8px", margin: 0 } as React.CSSProperties,
  cardBody:   { padding: "20px" } as React.CSSProperties,
  grid2:      { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 } as React.CSSProperties,
  fieldWrap:  { display: "flex", flexDirection: "column" as const, gap: 6 },
  label:      { fontSize: "12px", fontWeight: 600, color: "#475569" } as React.CSSProperties,
  hint:       { fontSize: "11px", color: "#94a3b8", marginTop: 2 } as React.CSSProperties,
  input:      { padding: "10px 12px", borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "13px", outline: "none", width: "100%", boxSizing: "border-box" as const } as React.CSSProperties,
  button:     { display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "10px 18px", borderRadius: "10px", border: "none", fontSize: "13px", fontWeight: 600, cursor: "pointer" } as React.CSSProperties,
};

function numVal(v: number | null): string { return v != null ? String(v) : ""; }
function parseNum(s: string): number | null { const n = parseFloat(s.replace(",", ".")); return isNaN(n) ? null : n; }
function fmtEur(v: number | null): string { return v != null ? v.toLocaleString("fr-FR") + " €" : "—"; }
function fmtPct(v: number | null, dec = 1): string { return v != null ? v.toFixed(dec) + " %" : "—"; }

export default function Bilan(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");
  const { study, loadState, patchBilan } = usePromoteurStudy(studyId);

  const [fondsPropres,    setFondsPropres]    = useState<number | null>(null);
  const [creditPromotion, setCreditPromotion] = useState<number | null>(null);
  const [tauxCreditPct,   setTauxCreditPct]   = useState<number | null>(null);
  const [dureeMois,       setDureeMois]       = useState<number | null>(null);
  const [roiPct,          setRoiPct]          = useState<number | null>(null);
  const [triPct,          setTriPct]          = useState<number | null>(null);
  const [notes,           setNotes]           = useState("");
  const [aiNarrative,     setAiNarrative]     = useState<string | null>(null);
  const [aiGeneratedAt,   setAiGeneratedAt]   = useState<string | null>(null);
  const [isSaving,        setIsSaving]        = useState(false);
  const [isGenerating,    setIsGenerating]    = useState(false);
  const [saveMsg,         setSaveMsg]         = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Données depuis les autres modules de l'étude
  const evaluation = study?.evaluation ?? null;
  const foncier    = study?.foncier    ?? null;
  const conception = study?.conception ?? null;
  const plu        = study?.plu        ?? null;
  const marche     = study?.marche     ?? null;

  const prixRevientTotal = evaluation?.prix_revient_total ?? null;
  const caPrevisionnel   = evaluation?.ca_previsionnel    ?? null;
  const margeBrute       = evaluation?.marge_brute        ?? null;
  const tauxMargePct     = evaluation?.taux_marge_pct     ?? null;
  const communeInsee     = foncier?.commune_insee         ?? null;

  // Hydratation depuis Supabase
  useEffect(() => {
    if (loadState !== "ready" || !study?.bilan) return;
    const b = study.bilan;
    setFondsPropres(b.fonds_propres);
    setCreditPromotion(b.credit_promotion);
    setTauxCreditPct(b.taux_credit_pct);
    setDureeMois(b.duree_mois);
    setRoiPct(b.roi_pct);
    setTriPct(b.tri_pct);
    setNotes(b.notes ?? "");
    setAiNarrative(b.ai_narrative);
    setAiGeneratedAt(b.ai_generated_at);
  }, [loadState, study]);

  // Calculs automatiques
  const computed = useMemo(() => {
    const roiCalc = fondsPropres && margeBrute ? (margeBrute / fondsPropres) * 100 : null;
    const interets = creditPromotion && tauxCreditPct && dureeMois
      ? creditPromotion * (tauxCreditPct / 100) * (dureeMois / 12)
      : null;
    return { roiCalc, interets };
  }, [fondsPropres, margeBrute, creditPromotion, tauxCreditPct, dureeMois]);

  // Génération narrative IA
  const handleGenerateNarrative = useCallback(async () => {
    if (!studyId) return;
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("promoteur-bilan-narrative-v1", {
        body: { study_id: studyId, foncier, plu, conception, evaluation, marche },
      });
      if (error) throw error;
      const narrative = data?.narrative ?? "";
      if (mountedRef.current) {
        setAiNarrative(narrative);
        setAiGeneratedAt(new Date().toISOString());
      }
      await patchBilan({
        prix_revient_total:   prixRevientTotal,
        ca_previsionnel:      caPrevisionnel,
        marge_nette:          margeBrute,
        taux_marge_nette_pct: tauxMargePct,
        fonds_propres:        fondsPropres,
        credit_promotion:     creditPromotion,
        taux_credit_pct:      tauxCreditPct,
        duree_mois:           dureeMois,
        roi_pct:              roiPct ?? computed.roiCalc,
        tri_pct:              triPct,
        ai_narrative:         narrative,
        ai_generated_at:      new Date().toISOString(),
        notes:                notes || null,
        done:                 true,
      });
    } catch (e: any) {
      console.error("[Bilan] AI narrative failed:", e?.message);
    } finally {
      if (mountedRef.current) setIsGenerating(false);
    }
  }, [studyId, foncier, plu, conception, evaluation, marche,
      prixRevientTotal, caPrevisionnel, margeBrute, tauxMargePct,
      fondsPropres, creditPromotion, tauxCreditPct, dureeMois,
      roiPct, triPct, notes, computed.roiCalc, patchBilan]);

  // Sauvegarde
  const handleSave = useCallback(async () => {
    if (!studyId) return;
    setIsSaving(true);
    const result = await patchBilan({
      prix_revient_total:   prixRevientTotal,
      ca_previsionnel:      caPrevisionnel,
      marge_nette:          margeBrute,
      taux_marge_nette_pct: tauxMargePct,
      fonds_propres:        fondsPropres,
      credit_promotion:     creditPromotion,
      taux_credit_pct:      tauxCreditPct,
      duree_mois:           dureeMois,
      roi_pct:              roiPct ?? computed.roiCalc,
      tri_pct:              triPct,
      ai_narrative:         aiNarrative,
      ai_generated_at:      aiGeneratedAt,
      notes:                notes || null,
      done:                 true,
    });
    if (mountedRef.current) {
      setIsSaving(false);
      if (result.ok) {
        setSaveMsg("✓ Bilan enregistré");
        setTimeout(() => { if (mountedRef.current) setSaveMsg(null); }, 4000);
      } else {
        setSaveMsg("⚠ Erreur d'enregistrement");
      }
    }
  }, [studyId, prixRevientTotal, caPrevisionnel, margeBrute, tauxMargePct,
      fondsPropres, creditPromotion, tauxCreditPct, dureeMois,
      roiPct, triPct, aiNarrative, aiGeneratedAt, notes, computed.roiCalc, patchBilan]);

  // Loading
  if (loadState === "loading") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, fontFamily: "'Inter', sans-serif" }}>
        <Loader2 size={32} color={ACCENT_PRO} style={{ animation: "spin 1s linear infinite" }} />
        <span style={{ marginLeft: 16, fontSize: 15, color: "#64748b" }}>Chargement de l'étude…</span>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const margePositive = margeBrute != null && margeBrute > 0;
  const roiFinal = roiPct ?? computed.roiCalc;

  return (
    <div style={styles.container}>
      {/* Banner */}
      <div style={{ background: GRAD_PRO, borderRadius: 14, padding: "20px 24px", marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>Promoteur › Bilan</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4 }}>Bilan de l'opération</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>Synthèse financière et décision d'investissement.</div>
        </div>
        {communeInsee && (
          <div style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.15)", color: "white", fontSize: 11, fontWeight: 500, border: "1px solid rgba(255,255,255,0.25)", marginTop: 4 }}>
            INSEE {communeInsee}
          </div>
        )}
      </div>

      {/* Alerte si pas d'évaluation */}
      {!evaluation && (
        <div style={{ ...styles.card, border: "1px solid #fde68a" }}>
          <div style={{ ...styles.cardBody, display: "flex", alignItems: "center", gap: 12 }}>
            <AlertTriangle size={20} color="#d97706" />
            <p style={{ fontSize: 13, color: "#92400e", margin: 0 }}>
              Aucune évaluation financière trouvée. Complétez d'abord la page <strong>Évaluation</strong>.
            </p>
          </div>
        </div>
      )}

      {/* KPIs récap depuis évaluation */}
      {evaluation && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
          {[
            { label: "Prix de revient",  val: fmtEur(prixRevientTotal), color: "#0f172a" },
            { label: "CA prévisionnel",  val: fmtEur(caPrevisionnel),   color: "#0f172a" },
            { label: "Marge brute",      val: fmtEur(margeBrute),       color: margePositive ? "#16a34a" : "#dc2626" },
            { label: "Taux de marge",    val: fmtPct(tauxMargePct),     color: tauxMargePct != null && tauxMargePct >= 8 ? "#16a34a" : "#dc2626" },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ padding: 16, borderRadius: 12, border: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase" as const, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Financement */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}><BarChart2 size={16} color={ACCENT_PRO} />Structure de financement</h3>
        </div>
        <div style={styles.cardBody}>
          <div style={styles.grid2}>
            <div style={styles.fieldWrap}>
              <label style={styles.label}>Fonds propres (€)</label>
              <input type="number" value={numVal(fondsPropres)} onChange={e => setFondsPropres(parseNum(e.target.value))} placeholder="—" style={styles.input} />
            </div>
            <div style={styles.fieldWrap}>
              <label style={styles.label}>Crédit promoteur (€)</label>
              <input type="number" value={numVal(creditPromotion)} onChange={e => setCreditPromotion(parseNum(e.target.value))} placeholder="—" style={styles.input} />
            </div>
            <div style={styles.fieldWrap}>
              <label style={styles.label}>Taux crédit (%)</label>
              <input type="number" value={numVal(tauxCreditPct)} onChange={e => setTauxCreditPct(parseNum(e.target.value))} placeholder="ex: 4.5" style={styles.input} />
            </div>
            <div style={styles.fieldWrap}>
              <label style={styles.label}>Durée (mois)</label>
              <input type="number" value={numVal(dureeMois)} onChange={e => setDureeMois(parseNum(e.target.value))} placeholder="ex: 24" style={styles.input} />
              {computed.interets && <span style={styles.hint}>Intérêts estimés : {fmtEur(Math.round(computed.interets))}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Rentabilité */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}><TrendingUp size={16} color="#16a34a" />Rentabilité</h3>
        </div>
        <div style={styles.cardBody}>
          <div style={styles.grid2}>
            <div style={styles.fieldWrap}>
              <label style={styles.label}>ROI (%)</label>
              <input type="number" value={numVal(roiPct)} onChange={e => setRoiPct(parseNum(e.target.value))} placeholder={computed.roiCalc ? computed.roiCalc.toFixed(1) : "—"} style={styles.input} />
              {computed.roiCalc && !roiPct && <span style={styles.hint}>Calculé automatiquement : {computed.roiCalc.toFixed(1)} %</span>}
            </div>
            <div style={styles.fieldWrap}>
              <label style={styles.label}>TRI (%)</label>
              <input type="number" value={numVal(triPct)} onChange={e => setTriPct(parseNum(e.target.value))} placeholder="—" style={styles.input} />
            </div>
          </div>

          {roiFinal != null && (
            <div style={{
              marginTop: 16, padding: "16px 20px", borderRadius: 12,
              background: roiFinal >= 15 ? "#f0fdf4" : roiFinal >= 8 ? "#fffbeb" : "#fef2f2",
              border: `1px solid ${roiFinal >= 15 ? "#bbf7d0" : roiFinal >= 8 ? "#fde68a" : "#fecaca"}`,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase" as const }}>
                  {roiFinal >= 15 ? "✓ Excellent rendement" : roiFinal >= 8 ? "→ Rendement correct" : "⚠ Rendement faible"}
                </div>
                {fondsPropres && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Fonds propres : {fmtEur(fondsPropres)}</div>}
              </div>
              <div style={{ fontSize: 36, fontWeight: 900, color: roiFinal >= 15 ? "#16a34a" : roiFinal >= 8 ? "#d97706" : "#dc2626" }}>
                {roiFinal.toFixed(1)} %
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Narrative IA */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}><Sparkles size={16} color="#8b5cf6" />Note de synthèse IA</h3>
          {aiGeneratedAt && (
            <span style={{ fontSize: 11, color: "#94a3b8" }}>
              Générée le {new Date(aiGeneratedAt).toLocaleDateString("fr-FR")}
            </span>
          )}
        </div>
        <div style={styles.cardBody}>
          {aiNarrative ? (
            <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.8, whiteSpace: "pre-wrap" as const, background: "#f8fafc", borderRadius: 10, padding: "16px 20px", border: "1px solid #e2e8f0" }}>
              {aiNarrative}
            </div>
          ) : (
            <div style={{ textAlign: "center" as const, padding: "30px 20px", color: "#94a3b8" }}>
              <Sparkles size={28} style={{ marginBottom: 12, opacity: 0.4 }} />
              <p style={{ margin: 0, fontSize: 13 }}>Générez une note de synthèse automatique à partir des données de l'étude.</p>
            </div>
          )}
          <button
            onClick={handleGenerateNarrative}
            disabled={isGenerating || !evaluation}
            style={{
              ...styles.button,
              width: "100%", marginTop: 14,
              background: isGenerating || !evaluation ? "#e2e8f0" : "linear-gradient(135deg, #7c6fcd, #8b5cf6)",
              color: isGenerating || !evaluation ? "#94a3b8" : "white",
              cursor: isGenerating || !evaluation ? "not-allowed" : "pointer",
            }}
          >
            {isGenerating
              ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />Génération en cours…</>
              : <><Sparkles size={16} />{aiNarrative ? "Regénérer la note" : "Générer la note de synthèse"}</>}
          </button>
          {!evaluation && (
            <p style={{ fontSize: 11, color: "#94a3b8", textAlign: "center" as const, marginTop: 8 }}>
              Complétez l'évaluation financière pour activer la génération IA.
            </p>
          )}
        </div>
      </div>

      {/* Notes */}
      <div style={styles.card}>
        <div style={styles.cardHeader}><h3 style={styles.cardTitle}><FileText size={16} color="#64748b" />Notes de décision</h3></div>
        <div style={styles.cardBody}>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Points de vigilance, conditions suspensives, décision d'investissement…"
            rows={4}
            style={{ ...styles.input, resize: "vertical" as const, lineHeight: 1.6 }}
          />
        </div>
      </div>

      {/* Barre de sauvegarde */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14 }}>
        {saveMsg && (
          <span style={{ fontSize: 13, fontWeight: 600, color: saveMsg.startsWith("✓") ? "#16a34a" : "#dc2626" }}>
            {saveMsg}
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={isSaving}
          style={{ ...styles.button, background: isSaving ? "#a78bfa" : ACCENT_PRO, color: "white", cursor: isSaving ? "not-allowed" : "pointer", minWidth: 180 }}
        >
          {isSaving
            ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />Enregistrement…</>
            : <><Save size={16} />Enregistrer le bilan</>}
        </button>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}