import React from "react";
import PageShell from "../shared/ui/PageShell";
import SectionCard from "../shared/ui/SectionCard";

export default function Financement() {
  return (
    <PageShell title="Financement" subtitle="Dette, apport, trésorerie, coût global, échéancier.">
      <SectionCard title="Structure financière" subtitle="Placeholder : paramètres prêt + cashflow.">
        <div style={{ color: "#334155", fontSize: 13, lineHeight: 1.7 }}>
          On branchera : taux, durée, différé, frais dossier, garanties, bridge, etc.
        </div>
      </SectionCard>
    </PageShell>
  );
}
