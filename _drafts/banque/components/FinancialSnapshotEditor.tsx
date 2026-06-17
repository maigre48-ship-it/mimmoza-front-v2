import { useMemo, useState } from "react";
import type { FinancialSnapshotV1 } from "../shared/financialSnapshot.types";

type Props = {
  value: FinancialSnapshotV1;
  onChange: (next: FinancialSnapshotV1) => void;
};

const toNum = (s: string): number | null => {
  if (!s.trim()) return null;
  const x = Number(s.replace(/\u202F/g, " ").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(x) ? x : null;
};

export default function FinancialSnapshotEditor({ value, onChange }: Props) {
  const [totalCost, setTotalCost] = useState<string>(() => String(value.usesSources?.emplois?.totalCost ?? ""));
  const [equity, setEquity] = useState<string>(() => String(value.usesSources?.ressources?.equity ?? ""));
  const [debt, setDebt] = useState<string>(() => String(value.usesSources?.ressources?.debt ?? ""));

  const derivedLtc = useMemo(() => {
    const tc = toNum(totalCost);
    const d = toNum(debt);
    if (tc == null || d == null || tc <= 0) return null;
    return (d / tc) * 100;
  }, [totalCost, debt]);

  const apply = () => {
    const tc = toNum(totalCost);
    const eq = toNum(equity);
    const db = toNum(debt);

    const next: FinancialSnapshotV1 = {
      ...value,
      provenance: {
        ...value.provenance,
        source: "manual",
        updatedAt: new Date().toISOString(),
      },
      usesSources: {
        currency: "EUR",
        emplois: { ...value.usesSources?.emplois, totalCost: tc },
        ressources: { ...value.usesSources?.ressources, equity: eq, debt: db },
      },
      creditMetrics: {
        ...value.creditMetrics,
        ltcPct: derivedLtc,
      },
    };

    onChange(next);
  };

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}>
      <div style={{ fontWeight: 800, marginBottom: 10 }}>Plan de financement (Banque)</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <label style={{ fontSize: 12 }}>
          Coût total (EUR)
          <input
            value={totalCost}
            onChange={(e) => setTotalCost(e.target.value)}
            style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
            placeholder="ex: 49000"
          />
        </label>

        <label style={{ fontSize: 12 }}>
          Apport / Fonds propres (EUR)
          <input
            value={equity}
            onChange={(e) => setEquity(e.target.value)}
            style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
            placeholder="ex: 12000"
          />
        </label>

        <label style={{ fontSize: 12 }}>
          Dette senior (EUR)
          <input
            value={debt}
            onChange={(e) => setDebt(e.target.value)}
            style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
            placeholder="ex: 37000"
          />
        </label>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
        LTC (calculé) : {derivedLtc == null ? "—" : `${derivedLtc.toFixed(1)}%`}
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button
          onClick={apply}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #111827",
            background: "#111827",
            color: "white",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Enregistrer
        </button>
      </div>
    </div>
  );
}
