import { Link } from "react-router-dom";
import { Sparkles, TrendingDown, Home } from "lucide-react";

export function VeilleSummaryCard() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">
            Veille active
          </h2>

          <p className="text-sm text-slate-600">
            Mimmoza analyse en continu vos zones surveillées pour détecter les
            nouvelles opportunités.
          </p>
        </div>

        <Sparkles className="h-5 w-5 text-indigo-500" />
      </div>

      <div className="grid grid-cols-3 gap-4 mt-6">

        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Home className="h-4 w-4" />
            Nouveaux biens
          </div>

          <p className="text-xl font-semibold mt-1">
            11
          </p>

          <p className="text-xs text-slate-500">
            sur les 7 derniers jours
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <TrendingDown className="h-4 w-4" />
            Baisses de prix
          </div>

          <p className="text-xl font-semibold mt-1">
            7
          </p>

          <p className="text-xs text-slate-500">
            détectées cette semaine
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Sparkles className="h-4 w-4" />
            Opportunités
          </div>

          <p className="text-xl font-semibold mt-1">
            2
          </p>

          <p className="text-xs text-slate-500">
            score élevé
          </p>
        </div>

      </div>

      <div className="mt-6">
        <Link
          to="/veille"
          className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          Voir les opportunités détectées
        </Link>
      </div>
    </div>
  );
}