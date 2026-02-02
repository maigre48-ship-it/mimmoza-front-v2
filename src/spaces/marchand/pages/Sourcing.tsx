import React from "react";
import PageShell from "../shared/ui/PageShell";
import SectionCard from "../shared/ui/SectionCard";

export default function Sourcing() {
  return (
    <PageShell title="Sourcing" subtitle="Entrée des opportunités — leads, biens, import.">
      <SectionCard title="Opportunités" subtitle="Placeholder : table + filtres + import (Leboncoin / SeLoger / CSV).">
        <div style={{ color: "#334155", fontSize: 13, lineHeight: 1.7 }}>
          Ici : liste des deals, statut (nouveau, visité, offre, sous promesse), tags, source.
        </div>
      </SectionCard>
    </PageShell>
  );
}
