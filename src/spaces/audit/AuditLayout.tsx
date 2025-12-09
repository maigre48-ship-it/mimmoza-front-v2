// src/spaces/audit/AuditLayout.tsx
import React from "react";

type AuditSection = {
  id: string;
  icon: string;
  title: string;
  description: string;
  anchor: string;
};

const auditSections: AuditSection[] = [
  {
    id: "analyse",
    icon: "🔍",
    title: "Analyse d'adresse",
    description:
      "Saisie et analyse de l'adresse, géocodage, identification de la commune et du contexte urbain.",
    anchor: "analyse-adresse",
  },
  {
    id: "carte-parcelles",
    icon: "🗺️",
    title: "Carte + Parcelles",
    description:
      "Visualisation cartographique, sélection des parcelles voisines, contexte foncier et morphologie urbaine.",
    anchor: "carte-parcelles",
  },
  {
    id: "cadastre",
    icon: "📐",
    title: "Données cadastrales",
    description:
      "Surface de terrain, emprise bâtie, formes des parcelles, bâtiments existants, références cadastrales.",
    anchor: "donnees-cadastrales",
  },
  {
    id: "smartscore",
    icon: "📊",
    title: "SmartScore complet (5 piliers)",
    description:
      "Notation complète du bien sur les 5 piliers : emplacement, marché & liquidité, qualité du bien, rentabilité & prix, risques & complexité.",
    anchor: "smartscore-complet",
  },
  {
    id: "risques",
    icon: "⚠️",
    title: "Risques naturels / climat / nuisances",
    description:
      "Synthèse des risques : inondation, mouvements de terrain, recul du trait de côte, bruit, pollution, nuisances diverses.",
    anchor: "risques-naturels",
  },
  {
    id: "valeur",
    icon: "💶",
    title: "Valeur estimative",
    description:
      "Estimation de la valeur du bien et du terrain, fourchette de prix, cohérence par rapport au marché local.",
    anchor: "valeur-estimative",
  },
  {
    id: "dvf",
    icon: "📈",
    title: "Données DVF",
    description:
      "Transactions comparables issues de DVF : prix au m², typologie des ventes, dynamique du secteur.",
    anchor: "donnees-dvf",
  },
];

export const AuditLayout: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row gap-6 px-4 py-4 lg:px-8 lg:py-6 bg-slate-950/40">
      {/* Sidebar de navigation des sections */}
      <aside className="w-full lg:w-64 flex-shrink-0">
        <div className="sticky top-4 space-y-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-slate-200 tracking-wide uppercase">
              Espace
            </h2>
            <p className="mt-1 text-lg font-semibold text-slate-50">
              Audit immobilier
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Synthèse complète pour achats, refinancement, arbitrage ou
              assurance.
            </p>
          </div>

          <nav className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 space-y-1">
            <p className="px-2 pb-1 text-xs font-semibold text-slate-400 uppercase">
              Sections
            </p>
            {auditSections.map((section) => (
              <a
                key={section.id}
                href={`#${section.anchor}`}
                className="flex items-center gap-2 px-2 py-2 rounded-xl text-sm text-slate-200 hover:bg-slate-800/80 transition-colors"
              >
                <span className="text-base">{section.icon}</span>
                <span className="leading-tight">{section.title}</span>
              </a>
            ))}
          </nav>
        </div>
      </aside>

      {/* Contenu principal */}
      <main className="flex-1 flex flex-col gap-6 pb-10">
        {/* En-tête de page */}
        <header className="bg-gradient-to-r from-slate-900/90 to-slate-800/80 border border-slate-800 rounded-2xl px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
            Mimmoza · Espace Audit
          </p>
          <div className="mt-2 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold text-slate-50">
                Audit complet d&apos;un bien immobilier
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Structure de page inspirée de Base44, adaptée à l&apos;écosystème
                Mimmoza. Les blocs seront ensuite branchés sur les fonctions
                Supabase (PLU, DVF, SmartScore, risques…).
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/80 border border-slate-700 px-3 py-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-medium text-slate-200">
                Version layout · Audit v1
              </span>
            </div>
          </div>
        </header>

        {/* Cartes / sections */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {auditSections.map((section) => (
            <section
              key={section.id}
              id={section.anchor}
              className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-800">
                    <span className="text-lg">{section.icon}</span>
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-slate-50">
                      {section.title}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {section.description}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-slate-800 text-slate-300 uppercase tracking-wide">
                  À brancher
                </span>
              </div>

              {/* Contenu placeholder pour la V1 (à remplacer par les vrais composants) */}
              <div className="mt-2 rounded-xl border border-dashed border-slate-700 bg-slate-900/70 px-4 py-3">
                <p className="text-xs text-slate-400">
                  Zone de contenu pour <span className="font-semibold">{section.title}</span>.
                  <br />
                  <span className="text-slate-500">
                    Prochaine étape : remplacer ce bloc par les composants
                    connectés (Supabase, Edge Functions, cartes, graphiques…).
                  </span>
                </p>
              </div>

              <div className="mt-1 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full bg-slate-800/80 px-2.5 py-1 text-[11px] text-slate-300">
                  ● Layout prêt
                </span>
                <span className="inline-flex items-center rounded-full bg-slate-800/60 px-2.5 py-1 text-[11px] text-slate-400">
                  ● Données à connecter
                </span>
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
};
