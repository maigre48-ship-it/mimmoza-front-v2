import { useMemo } from "react";
import { getSnapshot as getPromoteurSnapshot } from "../../promoteur/shared/promoteurSnapshot.store";

import { mapPromoteurToFinancialSnapshot } from "../shared/financialSnapshot.mapper";
import { computeSmartScoreBankV1 } from "../shared/smartscoreBank.engine";

export default function BanqueSmartScoreDebug() {
  // 1) On lit le snapshot Promoteur existant (source de vérité actuelle)
  const promoteurSnapshot = useMemo(() => getPromoteurSnapshot(), []);

  // 🔎 utile pour diagnostiquer le parsing du coût (bilan.summary)
  const bilanSummary = useMemo(() => {
    const s: any = promoteurSnapshot as any;
    return s?.bilan?.summary ?? null;
  }, [promoteurSnapshot]);

  // 2) On mappe vers le pivot Banque
  const financialSnapshot = useMemo(() => {
    return mapPromoteurToFinancialSnapshot(promoteurSnapshot as any, {
      dossierId: "DOSS-DEBUG-001",
      dossierName: "Debug Banque (depuis snapshot promoteur)",
      stage: "analyse",
      source: "mimmoza",
    });
  }, [promoteurSnapshot]);

  // 3) On calcule le SmartScore Banque
  const result = useMemo(() => computeSmartScoreBankV1(financialSnapshot), [financialSnapshot]);

  // console.log("[DEBUG] FinancialSnapshot =", financialSnapshot);

  const fsDebug = useMemo(() => {
    return {
      bilanSummary,
      mapped: {
        totalCost: financialSnapshot.usesSources?.emplois?.totalCost ?? null,
        equity: financialSnapshot.usesSources?.ressources?.equity ?? null,
        debt: financialSnapshot.usesSources?.ressources?.debt ?? null,
        marginPct: financialSnapshot.profitability?.grossMarginPct ?? null,
        ltcPct: financialSnapshot.creditMetrics?.ltcPct ?? null,
      },
      completeness: financialSnapshot.completeness,
    };
  }, [financialSnapshot, bilanSummary]);

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>
        Banque — SmartScore Debug
      </h1>

      <div style={{ opacity: 0.8, marginBottom: 18 }}>{result.summary}</div>

      {/* 🔎 DEBUG MAPPING */}
      <div
        style={{
          marginBottom: 18,
          padding: 12,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          background: "#fafafa",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>
          Debug mapping (Promoteur → FinancialSnapshot)
        </div>
        <pre
          style={{
            margin: 0,
            fontSize: 12,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {JSON.stringify(fsDebug, null, 2)}
        </pre>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Score</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{result.score}/100</div>
        </div>
        <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Décision</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{result.decision}</div>
        </div>
        <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Confiance</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{result.confidencePct}%</div>
        </div>
        <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Complétude</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{result.completenessPct}%</div>
        </div>
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Blocs</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        {result.blocks.map((b) => (
          <div key={b.key} style={{ padding: 14, border: "1px solid #e5e7eb", borderRadius: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontWeight: 800, textTransform: "capitalize" }}>{b.key}</div>
              <div style={{ opacity: 0.75 }}>Poids {(b.weight * 100).toFixed(0)}%</div>
            </div>

            <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800 }}>
              {b.score == null ? "—" : `${Math.round(b.score)}/100`}
            </div>

            {b.flags.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Flags</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {b.flags.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}

            {b.reasons.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Raisons</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {b.reasons.map((r, idx) => (
                    <li key={idx}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      {result.globalFlags.length > 0 && (
        <div
          style={{
            marginTop: 18,
            padding: 14,
            border: "1px solid #fecaca",
            background: "#fff1f2",
            borderRadius: 14,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Global Flags</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {result.globalFlags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
