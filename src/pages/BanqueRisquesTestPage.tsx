import { useState } from "react";
import { runBanqueRisques } from "../services/banqueRisques.service";

export default function BanqueRisquesTestPage() {
  const [dossierId, setDossierId] = useState("DOSS-TEST-001");
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const scoring = resp?.risks?.scoring;

  async function onRun() {
    setLoading(true);
    setErr(null);
    setResp(null);
    try {
      const data = await runBanqueRisques({
        dossierId,
        persist: true,
        debug: true,
      });
      setResp(data);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
        Test Banque — Risques (GeoRisques + Scoring)
      </h1>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <input
          value={dossierId}
          onChange={(e) => setDossierId(e.target.value)}
          placeholder="Dossier ID"
          style={{
            padding: "10px 12px",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            width: 280,
          }}
        />
        <button
          onClick={onRun}
          disabled={loading}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #e2e8f0",
            background: "white",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Analyse en cours..." : "Lancer analyse risques"}
        </button>
      </div>

      {err && (
        <div style={{ padding: 12, borderRadius: 12, border: "1px solid #fecaca", background: "#fff1f2", marginBottom: 12 }}>
          <b>Erreur</b>
          <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{err}</div>
        </div>
      )}

      {scoring && (
        <div style={{ padding: 14, borderRadius: 14, border: "1px solid #e2e8f0", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              Score: {scoring.score}/100
            </div>
            <div style={{ fontSize: 16 }}>
              Note: <b>{scoring.grade}</b> — {scoring.level_label}
            </div>
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              Confiance: {(Number(scoring.confidence ?? 0) * 100).toFixed(0)}%
            </div>
          </div>

          {Array.isArray(scoring.rationale) && scoring.rationale.length > 0 && (
            <ul style={{ marginTop: 10, paddingLeft: 18 }}>
              {scoring.rationale.slice(0, 5).map((r: string, i: number) => (
                <li key={i} style={{ marginBottom: 6 }}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {resp && (
        <details style={{ padding: 14, borderRadius: 14, border: "1px solid #e2e8f0" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Réponse brute</summary>
          <pre style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(resp, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
