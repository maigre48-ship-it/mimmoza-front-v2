import React from "react";
import PageShell from "../shared/ui/PageShell";
import SectionCard from "../shared/ui/SectionCard";

export default function Revente() {
  return (
    <PageShell title="Revente" subtitle="Stratégie de sortie : revente, location, découpe, arbitrage.">
      <SectionCard title="Scénarios de sortie" subtitle="Placeholder : scénarios + sensibilité prix/délai.">
        <div style={{ color: "#334155", fontSize: 13, lineHeight: 1.7 }}>
          Scénarios : prix cible, délai, frais commercialisation, fiscalité, marge nette.
        </div>
      </SectionCard>
    </PageShell>
  );
}
