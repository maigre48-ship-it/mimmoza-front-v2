// src/spaces/apporteur/pages/Dashboard.tsx

import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  PlusCircle,
  TrendingUp
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const MOCK_OPPORTUNITES = [
  {
    id: "opp-1",
    adresse: "12 rue des Acacias, Lyon 3e",
    surface: "620 m²",
    statut: "transmise",
    date: "08/05/2025",
    promoteur: "Nexity",
  },
  {
    id: "opp-2",
    adresse: "Allée du Parc, Villeurbanne",
    surface: "1 040 m²",
    statut: "en_analyse",
    date: "02/05/2025",
    promoteur: "Bouygues Immo",
  },
  {
    id: "opp-3",
    adresse: "Route de Grenoble, Bourgoin-Jallieu",
    surface: "2 200 m²",
    statut: "brouillon",
    date: "28/04/2025",
    promoteur: "—",
  },
];

const STATUT_META: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  brouillon: { label: "Brouillon", bg: "bg-slate-100", text: "text-slate-600" },
  transmise: { label: "Transmise", bg: "bg-emerald-100", text: "text-emerald-700" },
  en_analyse: { label: "En analyse", bg: "bg-blue-100", text: "text-blue-700" },
};

export function ApporteurDashboard() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#f7f8fc]">

      {/* Bandeau vert Apporteur */}
      <div style={{
        background: "linear-gradient(135deg, #16a34a 0%, #4ade80 100%)",
        borderRadius: 24,
        padding: "32px 36px",
        marginBottom: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        boxShadow: "0 8px 32px rgba(22,163,74,0.22)",
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", letterSpacing: 1.8, textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>
            Apporteur · Deals
          </div>
          <div className="text-4xl font-semibold tracking-tight" style={{ color: "#fff", marginBottom: 10 }}>
  Espace Apporteur d'affaire
</div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", maxWidth: 460, lineHeight: 1.55 }}>
            Qualifiez et transmettez vos opportunités foncières
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate("/apporteur/deposer")}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "13px 22px", borderRadius: 14, border: "none",
            background: "#fff", color: "#15803d",
            fontWeight: 700, fontSize: 14, cursor: "pointer",
            flexShrink: 0, boxShadow: "0 4px 20px rgba(0,0,0,0.16)",
          }}
        >
          <PlusCircle className="h-4 w-4" />
          Nouvelle opportunité
        </button>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-5xl px-6 py-8">

        {/* KPIs */}
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          {[
            {
              label: "Opportunités déposées",
              value: "3",
              icon: FileText,
              bg: "bg-slate-100",
              color: "text-slate-600",
            },
            {
              label: "Transmises à un promoteur",
              value: "1",
              icon: CheckCircle2,
              bg: "bg-emerald-100",
              color: "text-emerald-700",
            },
            {
              label: "En cours d'analyse",
              value: "1",
              icon: TrendingUp,
              bg: "bg-blue-100",
              color: "text-blue-700",
            },
          ].map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div
                key={kpi.label}
                className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-xl ${kpi.bg}`}
                >
                  <Icon className={`h-5 w-5 ${kpi.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{kpi.value}</p>
                  <p className="text-xs text-slate-500">{kpi.label}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Liste des opportunités */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Mes opportunités
            </h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
              {MOCK_OPPORTUNITES.length}
            </span>
          </div>

          <div className="divide-y divide-slate-50">
            {MOCK_OPPORTUNITES.map((opp) => {
              const statut = STATUT_META[opp.statut] ?? STATUT_META.brouillon;
              return (
                <div
                  key={opp.id}
                  className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
                      <Clock className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {opp.adresse}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {opp.surface} · Déposée le {opp.date}
                        {opp.promoteur !== "—" && (
                          <> · <span className="font-medium">{opp.promoteur}</span></>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${statut.bg} ${statut.text}`}
                    >
                      {statut.label}
                    </span>
                    <ArrowRight className="h-4 w-4 text-slate-300" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* CTA vide */}
          <div className="border-t border-slate-100 px-6 py-4">
            <button
              type="button"
              onClick={() => navigate("/apporteur/deposer")}
              className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 transition-colors hover:text-emerald-700"
            >
              <PlusCircle className="h-4 w-4" />
              Déposer une nouvelle opportunité
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ApporteurDashboard;