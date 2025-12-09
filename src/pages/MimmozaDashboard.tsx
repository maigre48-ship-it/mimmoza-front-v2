import React from "react";
import { MainLayout } from "../components/layouts/MainLayout";
import { PageContainer } from "../components/layouts/PageContainer";
import { ContentSection } from "../components/layouts/ContentSection";
import { Grid } from "../components/layouts/Grid";
import { StatCard } from "../components/layouts/StatCard";
import { Card, CardHeader, CardTitle, CardBody, CardFooter } from "../components/layouts/Card";
import { EmptyState } from "../components/layouts/EmptyState";

const MimmozaDashboard: React.FC = () => {
  return (
    <MainLayout
      title="Mimmoza Promoteur"
      subtitle="Studio de faisabilité foncière assistée par IA"
      breadcrumbs={[
        { label: "Accueil", href: "/" },
        { label: "Promoteur" },
      ]}
      actions={
        <>
          <button className="bg-white/70 hover:bg-white text-slate-900 px-4 py-2 rounded-full font-medium text-sm shadow-sm border border-slate-200 transition">
            Voir toutes les études
          </button>
          <button className="bg-gradient-to-r from-[#c9a227] to-[#b8922a] hover:from-[#b8922a] hover:to-[#a4811f] text-white px-5 py-2.5 rounded-full font-semibold text-sm shadow-md transition flex items-center gap-2">
            <span className="text-lg">+</span>
            Nouvelle étude foncière
          </button>
        </>
      }
    >
      <div className="bg-[#f8f7f4] -m-8 min-h-screen">
        <PageContainer maxWidth="xl" padding={true}>
          {/* HERO SECTION */}
          <div className="mt-4 mb-8">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 text-white shadow-[0_22px_45px_rgba(15,23,42,0.48)]">
              <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_top,_#c9a227_0,_transparent_55%),radial-gradient(circle_at_bottom,_#22c55e_0,_transparent_55%)]" />
              <div className="relative px-8 py-7 md:px-10 md:py-8 flex flex-col md:flex-row md:items-center gap-8">
                {/* Colonne gauche */}
                <div className="flex-1 space-y-3">
                  <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-3 py-1 text-xs font-medium tracking-wide uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="text-emerald-200">Beta privée</span>
                    <span className="text-white/80">PLU Engine · Promoteur v1</span>
                  </div>
                  <h1 className="text-2xl md:text-3xl lg:text-4xl font-semibold tracking-tight">
                    De la parcelle au bilan promoteur,
                    <span className="text-[#facc15]"> en suivant le PLU.</span>
                  </h1>
                  <p className="text-sm md:text-base text-slate-200 max-w-xl">
                    Mimmoza assemble cadastre, PLU, DVF et règles promoteur dans un seul studio.
                    Localisez, simulez, arbitrez — avec une traçabilité complète pour les banques et les investisseurs.
                  </p>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <div className="inline-flex items-center gap-2 text-xs text-slate-200">
                      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                      Faisabilité PLU automatisée
                    </div>
                    <div className="inline-flex items-center gap-2 text-xs text-slate-200">
                      <span className="w-1.5 h-1.5 bg-sky-400 rounded-full" />
                      Bilan promoteur paramétrable
                    </div>
                    <div className="inline-flex items-center gap-2 text-xs text-slate-200">
                      <span className="w-1.5 h-1.5 bg-amber-300 rounded-full" />
                      Prêt à être partagé aux partenaires
                    </div>
                  </div>
                </div>

                {/* Colonne droite */}
                <div className="w-full md:w-72 lg:w-80">
                  <div className="bg-white/10 border border-white/15 rounded-2xl px-4 py-4 backdrop-blur-sm">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-100">
                        Dernière étude simulée
                      </p>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-400/40">
                        Prototype
                      </span>
                    </div>
                    <div className="space-y-2.5 text-xs text-slate-100">
                      <div className="flex justify-between">
                        <span className="text-slate-300">Marge cible</span>
                        <span className="font-semibold">18–22 %</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">SDP estimée</span>
                        <span className="font-semibold">+ 2 450 m²</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">Niveaux possibles</span>
                        <span className="font-semibold">R+4 (sous réserve PLU)</span>
                      </div>
                    </div>
                    <div className="mt-4">
                      <button className="w-full inline-flex items-center justify-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl bg-white text-slate-900 hover:bg-slate-100 transition shadow-sm">
                        Lancer une étude type
                        <span className="text-slate-400 text-[11px]">Mock</span>
                      </button>
                      <p className="mt-2 text-[11px] text-slate-200">
                        Ce bloc est purement visuel pour l&apos;instant. On branchera ensuite les Edge Functions Supabase.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* STAT CARDS */}
          <ContentSection spacing="normal">
            <Grid cols={4} gap={6}>
              <StatCard
                title="Sites analysés"
                value="0"
                subtitle="Historique sur ce compte"
                icon="??"
                gradient="from-sky-500 to-sky-600"
              />
              <StatCard
                title="Études en cours"
                value="0"
                subtitle="Pipeline actif"
                icon="???"
                gradient="from-violet-500 to-violet-600"
              />
              <StatCard
                title="Marge cible moyenne"
                value="20%"
                subtitle="Objectif promoteur"
                icon="??"
                gradient="from-emerald-500 to-emerald-600"
              />
              <StatCard
                title="PLU structurés"
                value="0"
                subtitle="Communes prêtes à l&apos;emploi"
                icon="??"
                gradient="from-amber-500 to-amber-600"
              />
            </Grid>
          </ContentSection>

          {/* GRILLE PRINCIPALE */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4 pb-10">
            {/* Colonne gauche */}
            <div className="lg:col-span-2 space-y-6">
              {/* PIPELINE */}
              <ContentSection
                title="Pipeline d'analyse foncière"
                subtitle="Un flux unique : Adresse ? Parcelles ? PLU ? Bilan promoteur."
                card
              >
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Card padding="sm" className="bg-white shadow-sm border-0">
                    <div className="text-[11px] font-semibold text-slate-400 mb-1 uppercase tracking-wide">
                      Étape 1
                    </div>
                    <CardTitle className="text-sm">Adresse & localisation</CardTitle>
                    <CardBody className="mt-2 text-xs text-slate-600 space-y-1.5">
                      <p>Saisie d&apos;adresse, géocodage précis et détection de la commune.</p>
                      <p className="text-[11px] text-slate-400">
                        Sortie : point géographique, commune, code INSEE.
                      </p>
                    </CardBody>
                  </Card>

                  <Card padding="sm" className="bg-white shadow-sm border-0">
                    <div className="text-[11px] font-semibold text-slate-400 mb-1 uppercase tracking-wide">
                      Étape 2
                    </div>
                    <CardTitle className="text-sm">Parcelle(s) cadastrale(s)</CardTitle>
                    <CardBody className="mt-2 text-xs text-slate-600 space-y-1.5">
                      <p>Récupération automatique et ajout manuel des parcelles du terrain réel.</p>
                      <p className="text-[11px] text-slate-400">
                        Sortie : liste de parcelles, surface totale, forme du terrain.
                      </p>
                    </CardBody>
                  </Card>

                  <Card padding="sm" className="bg-white shadow-sm border-0">
                    <div className="text-[11px] font-semibold text-slate-400 mb-1 uppercase tracking-wide">
                      Étape 3
                    </div>
                    <CardTitle className="text-sm">PLU & règles d&apos;urbanisme</CardTitle>
                    <CardBody className="mt-2 text-xs text-slate-600 space-y-1.5">
                      <p>Chargement automatique ou upload du PLU, puis extraction des articles clés.</p>
                      <p className="text-[11px] text-slate-400">
                        Sortie : zone, emprise, hauteurs, stationnement, servitudes.
                      </p>
                    </CardBody>
                  </Card>

                  <Card padding="sm" className="bg-white shadow-sm border-0">
                    <div className="text-[11px] font-semibold text-slate-400 mb-1 uppercase tracking-wide">
                      Étape 4
                    </div>
                    <CardTitle className="text-sm">Bilan promoteur</CardTitle>
                    <CardBody className="mt-2 text-xs text-slate-600 space-y-1.5">
                      <p>Simulation automatique des SDP, typologies, coûts et marges.</p>
                      <p className="text-[11px] text-slate-400">
                        Sortie : bilan promoteur détaillé + appréciation synthétique.
                      </p>
                    </CardBody>
                  </Card>
                </div>
              </ContentSection>

              {/* PLACEHOLDER FORMULAIRE */}
              <ContentSection
                title="Nouvelle étude foncière"
                subtitle="Cette zone accueillera le futur flux complet (adresse, parcelles, PLU, bilan)."
                card
              >
                <div className="border border-dashed border-slate-300 rounded-2xl p-6 bg-white/60">
                  <p className="text-sm text-slate-700 mb-3">
                    Ici, on intégrera progressivement :
                  </p>
                  <ul className="list-disc list-inside text-sm text-slate-600 space-y-1.5">
                    <li>Saisie de l&apos;adresse avec appel à <code className="text-[11px] bg-slate-100 px-1 rounded">plu-from-address</code></li>
                    <li>Sélection et ajout de parcelles via la carte cadastrale Mimmoza</li>
                    <li>Upload / sélection du PLU structuré pour la commune</li>
                    <li>Lancement du calcul automatique du bilan promoteur</li>
                  </ul>
                  <p className="mt-4 text-[11px] text-slate-400">
                    Le but : garder une UX propre dès aujourd&apos;hui, puis brancher les Edge Functions une par une.
                  </p>
                </div>
              </ContentSection>

              {/* ÉTUDES RÉCENTES */}
              <ContentSection
                title="Études récentes"
                subtitle="Vos dernières analyses foncières apparaîtront ici."
                card
              >
                <EmptyState
                  icon="??"
                  title="Aucune étude pour le moment"
                  description="Dès que vous lancerez une première analyse, elle apparaîtra ici avec ses parcelles, son PLU et le bilan promoteur associé."
                  action={{
                    label: "Démarrer une première étude",
                    onClick: () => {
                      console.log("Nouvelle étude");
                    },
                  }}
                />
              </ContentSection>
            </div>

            {/* Colonne droite */}
            <div className="space-y-6">
              <ContentSection title="Actions rapides" card spacing="tight">
                <div className="space-y-2">
                  {[
                    { icon: "??", label: "Nouvelle étude par adresse" },
                    { icon: "???", label: "Choisir une parcelle sur la carte" },
                    { icon: "??", label: "Charger / uploader un PLU" },
                    { icon: "??", label: "Générer un bilan promoteur" },
                  ].map((action, i) => (
                    <button
                      key={i}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-[#f3efe3] rounded-xl transition text-left text-sm shadow-sm border border-slate-200/70"
                    >
                      <span className="text-lg">{action.icon}</span>
                      <span className="font-medium text-slate-800">
                        {action.label}
                      </span>
                    </button>
                  ))}
                </div>
              </ContentSection>

              <Card className="bg-gradient-to-br from-[#f5e9c9] via-[#f8f7f4] to-white border-0 shadow-md">
                <CardHeader className="border-none pb-2 mb-1">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">
                    Roadmap Mimmoza
                  </p>
                  <CardTitle className="text-base text-slate-900">
                    PLU Engine & Promoteur v1
                  </CardTitle>
                </CardHeader>
                <CardBody className="text-sm text-slate-700 space-y-1.5">
                  <p>?? Objectif : automatiser la faisabilité foncière à partir du PLU.</p>
                  <ul className="list-disc list-inside space-y-1.5">
                    <li>Parsing des règles PLU (zones, hauteurs, emprise, stationnement)</li>
                    <li>Calcul automatique des SDP et des gabarits 3D</li>
                    <li>Bilan promoteur : coûts, marges, appréciation & scénario</li>
                  </ul>
                </CardBody>
                <CardFooter className="border-none mt-2 pt-0">
                  <p className="text-[11px] text-slate-500">
                    Cette page sert de vitrine pendant que l&apos;on branche progressivement toutes les fonctions backend.
                  </p>
                </CardFooter>
              </Card>

              <Card className="border border-slate-200/80 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm">Support & documentation interne</CardTitle>
                </CardHeader>
                <CardBody className="text-sm text-slate-600 space-y-2">
                  <p>
                    Tu pourras ajouter ici des liens vers :
                  </p>
                  <ul className="list-disc list-inside space-y-1.5">
                    <li>La documentation interne Mimmoza</li>
                    <li>La liste des Edge Functions disponibles</li>
                    <li>Les modèles de rapports pour banques et partenaires</li>
                  </ul>
                </CardBody>
              </Card>
            </div>
          </div>
        </PageContainer>
      </div>
    </MainLayout>
  );
};

export default MimmozaDashboard;

