// src/spaces/marchand/pages/Exports.tsx

import React, { useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import PageShell from "../shared/ui/PageShell";
import SectionCard from "../shared/ui/SectionCard";
import {
  exportMarchandCsv,
  exportSnapshotToPdfWithAi,
} from "../services/export.service";

export default function Exports() {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGeneratePdf() {
    setPdfLoading(true);
    setError(null);

    try {
      // ✅ Le snapshot est lu dans export.service.ts
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
    <PageShell
      title="Exports"
      subtitle="Exporter les donnees du projet marchand (PDF / CSV)."
    >
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
    </PageShell>
  );
}
