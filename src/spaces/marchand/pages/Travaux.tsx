import React from "react";
import PageShell from "../shared/ui/PageShell";
import SectionCard from "../shared/ui/SectionCard";

export default function Travaux() {
  return (
    <PageShell title="Travaux" subtitle="Lots, budget, devis, planning, aléas.">
      <SectionCard title="Plan travaux" subtitle="Placeholder : lots + estimation + suivi.">
        <div style={{ color: "#334155", fontSize: 13, lineHeight: 1.7 }}>
          Lots : démolition, plomberie, élec, menuiserie, peinture, sols, cuisine, SDB…
        </div>
      </SectionCard>
    </PageShell>
  );
}
