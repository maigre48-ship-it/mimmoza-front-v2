// src/spaces/marchand/pages/Exports.tsx

import React, { useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import SectionCard from "../shared/ui/SectionCard";
import {
  exportMarchandCsv,
  exportSnapshotToPdfWithAi,
} from "../services/export.service";

// ─── Design tokens — Investisseur ────────────────────────────────────

const GRAD_INV   = "linear-gradient(90deg, #2196f3 0%, #21cbf3 100%)";
const ACCENT_INV = "#1a72c4";

export default function Exports() {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGeneratePdf() {
    setPdfLoading(true);
    setError(null);

    try {
      await exportSnapshotToPdfWithAi();
    } catch (err: any) {
      const msg =
        err?.message ??
        "Une erreur est survenue lors de la generation du PDF.";
      setError(msg);
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fa" }}>
      {/* ── Bannière Investisseur › Acquisition ── */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 24px 0" }}>
        <div style={{
          background: GRAD_INV,
          borderRadius: 14,
          padding: "20px 24px",
          marginBottom: 20,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>
              Investisseur › Acquisition
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4 }}>
              Exports
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
              Exporter les données du projet marchand (PDF / CSV).
            </div>
          </div>
          <button style={{
            padding: "9px 18px", borderRadius: 10, border: "none",
            background: "white", color: ACCENT_INV, fontWeight: 600,
            fontSize: 13, cursor: "default", flexShrink: 0, marginTop: 4,
          }}>
            PDF &amp; CSV
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 24px 24px" }}>
        {error && (
          <div
            role="alert"
            style={{
              marginBottom: 12,
              padding: "10px 14px",
              borderRadius: 8,
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#991b1b",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <SectionCard
            title="Export PDF"
            subtitle="Dossier marchand complet avec synthese IA."
          >
            <button
              type="button"
              onClick={handleGeneratePdf}
              disabled={pdfLoading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(15,23,42,0.10)",
                background: pdfLoading
                  ? "rgba(15,23,42,0.08)"
                  : "rgba(15,23,42,0.04)",
                fontWeight: 900,
                cursor: pdfLoading ? "not-allowed" : "pointer",
                opacity: pdfLoading ? 0.6 : 1,
              }}
            >
              {pdfLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <FileText size={18} />
              )}
              {pdfLoading ? "Generation en cours..." : "Generer le PDF"}
            </button>
          </SectionCard>

          <SectionCard
            title="Export CSV"
            subtitle="Donnees exploitables (Excel, Google Sheets, etc.)."
          >
            <button
              type="button"
              onClick={exportMarchandCsv}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(15,23,42,0.10)",
                background: "rgba(15,23,42,0.04)",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              <Download size={18} />
              Telecharger le CSV
            </button>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}