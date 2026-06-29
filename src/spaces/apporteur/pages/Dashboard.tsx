// src/spaces/apporteur/pages/Dashboard.tsx

import {
  CheckCircle2,
  FileText,
  PlusCircle,
  TrendingUp,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

// Type d'une opportunite apporteur (branchement Supabase a venir).
interface ApporteurOpportunite {
  id: string;
  adresse: string;
  surface: string;
  statut: "brouillon" | "transmise" | "en_analyse";
  date: string;
  promoteur: string;
}

// Aucune donnee mockee : la vraie source (Supabase) sera branchee ici.
const OPPORTUNITES: ApporteurOpportunite[] = [];

const STATUT_META: Record<string, { label: string; bg: string; text: string }> = {
  brouillon: { label: "Brouillon", bg: "bg-slate-100", text: "text-slate-600" },
  transmise: { label: "Transmise", bg: "bg-emerald-100", text: "text-emerald-700" },
  en_analyse: { label: "En analyse", bg: "bg-blue-100", text: "text-blue-700" },
};

export function ApporteurDashboard() {
  const navigate = useNavigate();

  const total = OPPORTUNITES.length;
  const transmises = OPPORTUNITES.filter((o) => o.statut === "transmise").length;
  const enAnalyse = OPPORTUNITES.filter((o) => o.statut === "en_analyse").length;

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
            Qualifiez et transmettez vos opportunites foncieres
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
          Nouvelle opportunite
        </button>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-5xl px-6 py-8">

        {/* KPIs */}
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Opportunites deposees", value: String(total), icon: FileText, bg: "bg-slate-100", color: "text-slate-600" },
            { label: "Transmises a un promoteur", value: String(transmises), icon: CheckCircle2, bg: "bg-emerald-100", color: "text-emerald-700" },
            { label: "En cours d'analyse", value: String(enAnalyse), icon: TrendingUp, bg: "bg-blue-100", color: "text-blue-700" },
          ].map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div
                key={kpi.label}
                className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${kpi.bg}`}>
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

        {/* Liste des opportunites */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Mes opportunites
            </h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
              {total}
            </span>
          </div>

          {total === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50">
                <FileText className="h-6 w-6 text-emerald-500" />
              </div>
              <p className="text-sm font-semibold text-slate-700">
                Aucune opportunite deposee pour le moment
              </p>
              <p className="max-w-sm text-xs leading-5 text-slate-500">
                Deposez votre premiere opportunite fonciere pour la qualifier et la
                transmettre a un promoteur.
              </p>
              <button
                type="button"
                onClick={() => navigate("/apporteur/deposer")}
                className="mt-2 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-500"
              >
                <PlusCircle className="h-4 w-4" />
                Deposer un bien
              </button>
            </div>
          ) : (
            <>
              <div className="divide-y divide-slate-50">
                {OPPORTUNITES.map((opp) => {
                  const statut = STATUT_META[opp.statut] ?? STATUT_META.brouillon;
                  return (
                    <div
                      key={opp.id}
                      className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-slate-50"
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
                          <FileText className="h-4 w-4 text-emerald-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900">{opp.adresse}</p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {opp.surface} · Deposee le {opp.date}
                            {opp.promoteur !== "—" && (
                              <> · <span className="font-medium">{opp.promoteur}</span></>
                            )}
                          </p>
                        </div>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statut.bg} ${statut.text}`}>
                        {statut.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-slate-100 px-6 py-4">
                <button
                  type="button"
                  onClick={() => navigate("/apporteur/deposer")}
                  className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 transition-colors hover:text-emerald-700"
                >
                  <PlusCircle className="h-4 w-4" />
                  Deposer une nouvelle opportunite
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ApporteurDashboard;