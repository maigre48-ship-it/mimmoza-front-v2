import { WatchlistsSettingsCard } from "../components/veille/WatchlistsSettingsCard";
import { VeilleSummaryCard } from "../components/veille/VeilleSummaryCard";

export default function VeilleSettingsPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-slate-950">
          Paramètres de veille
        </h1>

        <p className="text-slate-600 max-w-2xl">
          Configurez les zones et critères que Mimmoza doit surveiller pour
          détecter les nouveaux biens, les baisses de prix et les opportunités
          d'investissement.
        </p>
      </div>

      {/* résumé veille */}
      <VeilleSummaryCard />

      {/* gestion des zones */}
      <WatchlistsSettingsCard />
    </div>
  );
}