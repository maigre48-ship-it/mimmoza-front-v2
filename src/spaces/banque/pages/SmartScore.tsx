import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { getSnapshot as getPromoteurSnapshot } from "../../promoteur/shared/promoteurSnapshot.store";
import { mapPromoteurToFinancialSnapshot } from "../shared/financialSnapshot.mapper";
import { computeSmartScoreBankV1 } from "../shared/smartscoreBank.engine";

import type { FinancialSnapshotV1 } from "../shared/financialSnapshot.types";
import {
  readBanqueFinancialSnapshot,
  writeBanqueFinancialSnapshot,
  resetBanqueFinancialSnapshot,
} from "../shared/banqueFinancialSnapshot.store";

import FinancialSnapshotEditor from "../components/FinancialSnapshotEditor";

function makeEmptyFs(dossierId: string): FinancialSnapshotV1 {
  return {
    version: "financialSnapshot.v1",
    provenance: {
      source: "manual",
      sourceRef: "banque",
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    completeness: { percent: 0, missing: [], warnings: [] },
    project: {
      dossierId,
      stage: "analyse",
      assetClass: "autre",
    },
    usesSources: {
      currency: "EUR",
      emplois: { totalCost: null },
      ressources: { equity: null, debt: null },
    },
    creditMetrics: {},
    profitability: {},
    docs: {},
    risks: { available: false, source: "external" },
    market: { available: false, source: "external" },
    notes: {},
  };
}

export default function BanqueSmartScorePage() {
  const { id } = useParams();
  const dossierId = id ?? "UNKNOWN";

  const promoteurSnapshot = useMemo(() => getPromoteurSnapshot(), []);

  // Fallback: si rien côté banque, on part du promoteur mappé
  const fallbackFromPromoteur = useMemo(() => {
    return mapPromoteurToFinancialSnapshot(promoteurSnapshot as any, {
      dossierId,
      dossierName: `Dossier ${dossierId}`,
      stage: "analyse",
      source: "mimmoza",
    });
  }, [promoteurSnapshot, dossierId]);

  const [fs, setFs] = useState<FinancialSnapshotV1>(() => {
    return readBanqueFinancialSnapshot(dossierId) ?? fallbackFromPromoteur ?? makeEmptyFs(dossierId);
  });

  const smart = useMemo(() => computeSmartScoreBankV1(fs), [fs]);

  const save = (next: FinancialSnapshotV1) => {
    setFs(next);
    writeBanqueFinancialSnapshot(dossierId, next);
  };

  const handleReset = () => {
    if (!window.confirm("Réinitialiser le snapshot financier Banque de ce dossier ?")) return;
    resetBanqueFinancialSnapshot(dossierId);
    const next = fallbackFromPromoteur ?? makeEmptyFs(dossierId);
    setFs(next);
  };

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Banque — SmartScore</h1>
          <div style={{ opacity: 0.7, fontSize: 12 }}>Dossier: {dossierId}</div>
        </div>

        <button
          onClick={handleReset}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "white",
            fontWeight: 700,
            cursor: "pointer",
          }}
          title="Supprime la saisie Banque (retour fallback Promoteur / vide)"
        >
          Réinitialiser (Banque)
        </button>
      </div>

      <div style={{ opacity: 0.85, marginTop: 10, marginBottom: 18 }}>{smart.summary}</div>

      {/* Saisie Banque (source externe/manual) */}
      <FinancialSnapshotEditor value={fs} onChange={save} />

      <div style={{ marginTop: 18, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Score</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{smart.score}/100</div>
        </div>
        <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Décision</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{smart.decision}</div>
        </div>
        <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Confiance</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{smart.confidencePct}%</div>
        </div>
        <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Complétude</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{smart.completenessPct}%</div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Blocs</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          {smart.blocks.map((b) => (
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
      </div>

      {/* Debug rapide */}
      <div style={{ marginTop: 18, padding: 12, border: "1px solid #e5e7eb", borderRadius: 12, background: "#fafafa" }}>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Debug (valeurs pivot)</div>
        <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
{JSON.stringify({
  totalCost: fs.usesSources?.emplois?.totalCost ?? null,
  equity: fs.usesSources?.ressources?.equity ?? null,
  debt: fs.usesSources?.ressources?.debt ?? null,
  ltcPct: fs.creditMetrics?.ltcPct ?? null,
  provenance: fs.provenance,
}, null, 2)}
        </pre>
      </div>
    </div>
  );
}
