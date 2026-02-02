import React from "react";
import PageShell from "../shared/ui/PageShell";
import SectionCard from "../shared/ui/SectionCard";

export default function Qualification() {
  return (
    <PageShell title="Qualification" subtitle="Go / No-Go en 3 minutes : marge, risques, contraintes, sortie.">
      <SectionCard title="Analyse express" subtitle="Placeholder : inputs + KPIs + décision.">
        <div style={{ color: "#334155", fontSize: 13, lineHeight: 1.7 }}>
          KPIs : prix achat + frais, budget travaux, prix revente estimé, marge €, marge %, TRI.
        </div>
      </SectionCard>
    </PageShell>
  );
}
