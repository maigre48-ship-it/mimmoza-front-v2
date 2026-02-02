import React from "react";
import PageShell from "../shared/ui/PageShell";
import SectionCard from "../shared/ui/SectionCard";

export default function Synthese() {
  return (
    <PageShell title="Synthèse" subtitle="Dossier décisionnel / banque — (placeholder, futur générateur IA).">
      <SectionCard title="Dossier" subtitle="Placeholder : rendu structuré + export PDF (plus tard).">
        <div style={{ color: "#334155", fontSize: 13, lineHeight: 1.7 }}>
          On reprendra les blocs : deal, marché, travaux, risques, financement, sortie, KPIs.
        </div>
      </SectionCard>
    </PageShell>
  );
}
