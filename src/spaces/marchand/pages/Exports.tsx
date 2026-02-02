// src/spaces/marchand/pages/Exports.tsx

import React from "react";
import { Download, FileText } from "lucide-react";
import PageShell from "../shared/ui/PageShell";
import SectionCard from "../shared/ui/SectionCard";
import { exportMarchandCsv, exportMarchandPdf } from "../services/export.service";

export default function Exports() {
  return (
    <PageShell
      title="Exports"
      subtitle="Exporter les données du projet marchand (PDF / CSV)."
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <SectionCard
          title="Export PDF"
          subtitle="Dossier marchand prêt à imprimer ou partager."
        >
          <button
            type="button"
            onClick={exportMarchandPdf}
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
            <FileText size={18} />
            Générer le PDF
          </button>
        </SectionCard>

        <SectionCard
          title="Export CSV"
          subtitle="Données exploitables (Excel, Google Sheets, etc.)."
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
            Télécharger le CSV
          </button>
        </SectionCard>
      </div>
    </PageShell>
  );
}
