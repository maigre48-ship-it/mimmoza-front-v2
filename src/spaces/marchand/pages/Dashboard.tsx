import React, { useMemo } from "react";
import { Briefcase, TrendingUp, Hammer, Banknote } from "lucide-react";
import PageShell from "../shared/ui/PageShell";
import KpiCard from "../shared/ui/KpiCard";
import SectionCard from "../shared/ui/SectionCard";
import { readMarchandSnapshot } from "../shared/marchandSnapshot.store";
import useMarchandSnapshotTick from "../shared/hooks/useMarchandSnapshotTick";

export default function Dashboard() {
  const snapTick = useMarchandSnapshotTick();
  const snapshot = useMemo(() => readMarchandSnapshot(), [snapTick]);

  const totalDeals = snapshot.deals.length;
  const vendus = snapshot.deals.filter((d) => d.status === "Vendu").length;
  const enCours = snapshot.deals.filter((d) => d.status !== "Vendu").length;

  const margeCible = "—"; // à calculer quand Rentabilite sera branché
  const travaux = "—"; // à brancher sur Travaux/Execution
  const dette = "—"; // à brancher sur Financement

  return (
    <PageShell
      title="Dashboard"
      subtitle="Vue globale — deals, marges, travaux, financement. (Branché snapshot: KPIs basiques.)"
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <KpiCard label="Opportunités" value={`${enCours}`} hint={`Total: ${totalDeals} · Vendus: ${vendus}`} icon={<Briefcase size={18} />} />
        <KpiCard label="Marge cible" value={margeCible} hint="Qualification (à brancher)" icon={<TrendingUp size={18} />} />
        <KpiCard label="Travaux" value={travaux} hint="Budget + planning (à brancher)" icon={<Hammer size={18} />} />
        <KpiCard label="Dette" value={dette} hint="Financement (à brancher)" icon={<Banknote size={18} />} />
      </div>

      <div style={{ height: 12 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 12 }}>
        <SectionCard title="À faire (prochaines étapes)" subtitle="On rend le flow ultra-guidé (checklist).">
          <ul style={{ margin: 0, paddingLeft: 18, color: "#334155", lineHeight: 1.8 }}>
            <li>Créer un “deal” + importer infos (adresse, surface, prix, DPE, photos)</li>
            <li>Qualification express : marge, coûts, délais, risques</li>
            <li>Travaux : lots, devis, buffer, planning</li>
            <li>Financement : coût de la dette, notaire, frais, trésorerie</li>
            <li>Synthèse : dossier banque / décisionnel</li>
          </ul>
        </SectionCard>

        <SectionCard title="Qualité des données" subtitle="Ce qu’on branchera ensuite.">
          <div style={{ color: "#334155", lineHeight: 1.7, fontSize: 13 }}>
            <div>• Snapshot (localStorage / supabase)</div>
            <div>• Prix/m² : DVF + comparables</div>
            <div>• Scénarios travaux + aléas</div>
            <div>• Sortie : revente / location / découpe</div>
          </div>
        </SectionCard>
      </div>
    </PageShell>
  );
}
