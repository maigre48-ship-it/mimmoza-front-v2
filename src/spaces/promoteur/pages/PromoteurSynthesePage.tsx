// src/spaces/promoteur/pages/PromoteurSynthesePage.tsx

import React, { useState, useMemo, useCallback } from 'react';
import {
  FileText, RefreshCw, AlertCircle, CheckCircle2, XCircle, AlertTriangle,
  TrendingUp, TrendingDown, BarChart3, Euro, Layers, Scale, MapPin,
  ChevronRight, Loader2, Download, ShieldAlert, Building2,
} from 'lucide-react';
import { generatePromoteurSynthese } from '../services/generatePromoteurSynthese';
import { exportPromoteurPdf } from '../services/exportPromoteurPdf';
import { usePromoteurProjectStore } from '../store/promoteurProject.store';
import type {
  PromoteurSynthese, PromoteurRawInput, RisqueItem, RisqueNiveau, Scenario, RecommendationType,
} from '../services/promoteurSynthese.types';

// ---- Types ------------------------------------------------------------------

interface StudyData {
  foncier?: { adresse_complete?: string; commune?: string; code_postal?: string; departement?: string; surface_m2?: number; commune_insee?: string; };
  plu?: { zone_plu?: string; cos?: number; hauteur_max?: number; pleine_terre_pct?: number; };
  marche?: { prix_m2_neuf?: number; prix_m2_ancien?: number; nb_transactions?: number; prix_moyen_dvf?: number; nb_programmes_concurrents?: number; absorption_mensuelle?: number; };
  risques?: { zonage_risque?: string; };
  evaluation?: { cout_foncier?: number; };
  bilan?: { ca_previsionnel?: number; prix_revient_total?: number; marge_nette?: number; taux_marge_nette_pct?: number; taux_credit_pct?: number; };
}

interface Props {
  studyData?: StudyData;
  bilanValues?: {
    caTotal: number; coutTotal: number; marge: number; margePct: number;
    coutTravauxBase: number; coutTravauxM2: number; totalFoncier: number;
    totalFin: number; totalCom: number; totalEtudes: number;
    sdpM2: number; surfaceVendableM2: number; nbLogements: number;
    financingRatePct: number; salePriceEurM2Hab: number;
    commune?: string; codePostal?: string; adresse?: string; programmeType?: string;
  };
}

// ---- Helpers ----------------------------------------------------------------

function eur(v: number): string {
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}
function pct(v: number): string { return `${v.toFixed(1)}%`; }

// ---- Skeleton ---------------------------------------------------------------

const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />
);

const LoadingPreview: React.FC = () => (
  <div className="space-y-4 py-4">
    <Skeleton className="h-16 w-full" />
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[0,1,2,3].map(i => <Skeleton key={i} className="h-20" />)}
    </div>
    <div className="grid grid-cols-2 gap-4">
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
    <Skeleton className="h-32" />
    <Skeleton className="h-48" />
  </div>
);

// ---- Recommendation banner --------------------------------------------------

const REC_CFG: Record<RecommendationType, { bg: string; border: string; text: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  GO:           { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700', icon: CheckCircle2, label: 'GO - Operation recommandee' },
  GO_CONDITION: { bg: 'bg-amber-50',   border: 'border-amber-300',   text: 'text-amber-700',   icon: AlertCircle,  label: 'GO CONDITIONNEL - Ajustements requis' },
  NO_GO:        { bg: 'bg-red-50',     border: 'border-red-300',     text: 'text-red-700',     icon: XCircle,      label: "NO GO - Operation non viable en l'etat" },
};

const RecBanner: React.FC<{ rec: RecommendationType; motif: string }> = ({ rec, motif }) => {
  const cfg = REC_CFG[rec];
  const Icon = cfg.icon;
  return (
    <div className={`flex items-start gap-3 rounded-xl border-2 ${cfg.border} ${cfg.bg} p-4`}>
      <Icon className={`h-6 w-6 flex-shrink-0 mt-0.5 ${cfg.text}`} />
      <div>
        <p className={`text-sm font-bold ${cfg.text}`}>{cfg.label}</p>
        <p className={`text-xs mt-0.5 ${cfg.text} opacity-75`}>{motif}</p>
      </div>
    </div>
  );
};

// ---- KPI card ---------------------------------------------------------------

const KpiCard: React.FC<{ label: string; value: string; sub?: string; alert?: boolean; trend?: 'up' | 'down' }> = ({ label, value, sub, alert, trend }) => (
  <div className={`rounded-xl border bg-white p-4 shadow-sm ${alert ? 'border-red-200' : 'border-slate-100'}`}>
    <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-1">{label}</p>
    <div className="flex items-end gap-1.5">
      <span className={`text-xl font-bold ${alert ? 'text-red-600' : 'text-slate-800'}`}>{value}</span>
      {trend === 'up'   && <TrendingUp   className="h-4 w-4 text-emerald-500 mb-0.5" />}
      {trend === 'down' && <TrendingDown className="h-4 w-4 text-red-500 mb-0.5" />}
    </div>
    {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
  </div>
);

// ---- Section wrapper --------------------------------------------------------

const Section: React.FC<{ title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; accent?: boolean }> = ({ title, icon: Icon, children, accent }) => (
  <div className={`rounded-xl border bg-white shadow-sm overflow-hidden ${accent ? 'border-violet-100' : 'border-slate-100'}`}>
    <div className={`flex items-center gap-2 px-4 py-3 border-b ${accent ? 'bg-violet-50 border-violet-100' : 'bg-slate-50 border-slate-100'}`}>
      <Icon className={`h-4 w-4 ${accent ? 'text-violet-500' : 'text-slate-400'}`} />
      <span className={`text-xs font-bold uppercase tracking-wider ${accent ? 'text-violet-700' : 'text-slate-600'}`}>{title}</span>
    </div>
    <div className="p-4">{children}</div>
  </div>
);

// ---- Row helper -------------------------------------------------------------

const Row: React.FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
  <div className="flex justify-between items-center text-xs py-1 border-b border-slate-50 last:border-0">
    <span className="text-slate-500">{label}</span>
    <span className={`font-semibold ${highlight ? 'text-violet-700' : 'text-slate-700'}`}>{value}</span>
  </div>
);

// ---- Risk badge -------------------------------------------------------------

const RISK_STYLE: Record<RisqueNiveau, string> = {
  CRITIQUE: 'bg-red-100 text-red-700',
  ELEVE:    'bg-orange-100 text-orange-700',
  MODERE:   'bg-amber-100 text-amber-700',
  FAIBLE:   'bg-emerald-100 text-emerald-700',
};

// ---- Main preview -----------------------------------------------------------

const SynthesePreview: React.FC<{ synthese: PromoteurSynthese; facadeRenderUrl?: string | null }> = ({ synthese, facadeRenderUrl }) => {
  const { executiveSummary: es, financier, marche, technique, risques, scenarios, financement, syntheseIA } = synthese;
  const stressScenario = scenarios.find(s => s.type === 'STRESS');

  return (
    <div className="space-y-5">

      {/* Header projet */}
      <div className="flex items-start gap-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100">
          <MapPin className="h-5 w-5 text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 leading-tight">{es.titreOperation}</p>
          <p className="text-xs text-slate-400 mt-0.5">{synthese.projet.adresse} - {synthese.projet.commune}</p>
        </div>
        <span className={`text-xs rounded-full px-2 py-0.5 font-medium border flex-shrink-0 ${
          synthese.metadata.dataQualite === 'HAUTE' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
          synthese.metadata.dataQualite === 'MOYENNE' ? 'bg-amber-50 text-amber-600 border-amber-200' :
          'bg-red-50 text-red-600 border-red-200'
        }`}>{synthese.metadata.dataQualite}</span>
      </div>

      {/* Rendu facade */}
      {facadeRenderUrl && (
        <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b bg-slate-50 border-slate-100">
            <Building2 className="h-4 w-4 text-violet-500" />
            <span className="text-xs font-bold uppercase tracking-wider text-violet-700">Perspective facade</span>
          </div>
          <div className="p-3">
            <img
              src={facadeRenderUrl}
              alt="Rendu facade du projet"
              className="w-full rounded-lg object-cover"
              style={{ maxHeight: 360 }}
            />
          </div>
        </div>
      )}

      {/* Recommendation */}
      <RecBanner rec={es.recommendation} motif={es.motifRecommandation} />

      {/* Kill switches */}
      {es.killSwitchesActifs.length > 0 && (
        <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className="h-5 w-5 text-red-600" />
            <span className="text-sm font-bold text-red-700">Points bloquants</span>
          </div>
          <ul className="space-y-1">
            {es.killSwitchesActifs.map((ks, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-red-600">
                <span className="flex-shrink-0">x</span>{ks}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* KPIs principaux */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Marge nette" value={pct(financier.margeNettePercent)} sub={eur(financier.margeNette)} alert={financier.margeNettePercent < 8} trend={financier.margeNettePercent >= 12 ? 'up' : 'down'} />
        <KpiCard label="CA total HT" value={`${(financier.chiffreAffairesTotal / 1000000).toFixed(2)} M EUR`} sub={`${financier.chiffreAffairesM2.toLocaleString('fr-FR')} EUR/m2`} />
        <KpiCard label="TRN" value={pct(financier.trnRendement)} sub="Taux de rendement net" alert={financier.trnRendement < 8} trend={financier.trnRendement >= 10 ? 'up' : 'down'} />
        <KpiCard label="Score global" value={`${es.scores.global}/100`} sub={`${synthese.projet.nbLogements} logements`} trend={es.scores.global >= 65 ? 'up' : 'down'} />
      </div>

      {/* Points forts / vigilance */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">Points forts</p>
          </div>
          <ul className="space-y-1.5">
            {es.pointsForts.map((p, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-emerald-700">
                <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />{p}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">Points de vigilance</p>
          </div>
          <ul className="space-y-1.5">
            {es.pointsVigilance.map((p, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-amber-700">
                <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />{p}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 2 sections principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Etude de marche" icon={BarChart3}>
          <Row label="Zone marche"       value={marche.zoneMarche.replace('_', ' ')} />
          <Row label="Prix neuf moyen"   value={`${marche.prixNeufMoyenM2.toLocaleString('fr-FR')} EUR/m2`} />
          <Row label="Prix projet"       value={`${marche.prixProjetM2.toLocaleString('fr-FR')} EUR/m2`} />
          <Row label="Position vs marche" value={`${marche.positionPrix > 0 ? '+' : ''}${pct(marche.positionPrix)}`} highlight={Math.abs(marche.positionPrix) > 5} />
          <Row label="Prime neuf/ancien" value={pct(marche.primiumNeuf)} />
          <Row label="Concurrence"       value={`${marche.offreConcurrente} programme(s)`} />
          {marche.delaiEcoulementMois != null && (
            <Row label="Delai ecoulement" value={`${marche.delaiEcoulementMois} mois`} />
          )}
          {marche.notesMarcheLibre.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
              {marche.notesMarcheLibre.map((n, i) => (
                <p key={i} className="text-xs text-amber-600 flex items-start gap-1.5">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />{n}
                </p>
              ))}
            </div>
          )}
        </Section>

        <Section title="Faisabilite technique" icon={Layers} accent>
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-xs font-bold rounded-full px-3 py-1 border ${
              technique.faisabiliteTechnique === 'CONFIRME'     ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
              technique.faisabiliteTechnique === 'SOUS_RESERVE' ? 'bg-amber-50 text-amber-700 border-amber-200' :
              'bg-red-50 text-red-700 border-red-200'
            }`}>
              {technique.faisabiliteTechnique === 'CONFIRME' ? 'Confirmee' :
               technique.faisabiliteTechnique === 'SOUS_RESERVE' ? 'Sous reserve' : 'Impossible'}
            </span>
            <span className="text-xs text-slate-400">Zone {technique.zonePlu}</span>
          </div>
          <Row label="CUB"            value={technique.cub != null ? String(technique.cub) : 'N/D'} />
          <Row label="Hauteur max"    value={technique.hauteurMax != null ? `${technique.hauteurMax} m` : 'N/D'} />
          <Row label="Hauteur projet" value={technique.hauteurProjet != null ? `${technique.hauteurProjet} m` : 'N/D'} />
          <Row label="Niveaux"        value={technique.nbNiveaux != null ? String(technique.nbNiveaux) : 'N/D'} />
          <Row label="Pleine terre"   value={technique.pleineTerre != null ? `${technique.pleineTerre}%` : 'N/D'} />
          {technique.contraintes.filter(c => c.statut !== 'CONFORME').length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-500 mb-2">Contraintes a surveiller</p>
              {technique.contraintes.filter(c => c.statut !== 'CONFORME').slice(0, 3).map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs mb-1">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.statut === 'BLOQUANT' ? 'bg-red-500' : 'bg-amber-400'}`} />
                  <span className="text-slate-600 truncate">{c.libelle}</span>
                  <span className={`ml-auto font-medium flex-shrink-0 ${c.statut === 'BLOQUANT' ? 'text-red-500' : 'text-amber-500'}`}>{c.statut}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Analyse financiere */}
      <Section title="Analyse financiere - Comite d'investissement" icon={Euro}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1">
          <div className="col-span-2 md:col-span-3 pb-2 mb-1 border-b border-slate-100">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Bilan economique</p>
          </div>
          <Row label="Chiffre d'affaires"    value={eur(financier.chiffreAffairesTotal)} />
          <Row label="CA / m2 vendable"      value={`${financier.chiffreAffairesM2.toLocaleString('fr-FR')} EUR/m2`} />
          <Row label="Cout de revient total" value={eur(financier.coutRevientTotal)} />
          <Row label="Cout revient / m2"     value={`${financier.coutRevientM2.toLocaleString('fr-FR')} EUR/m2`} />
          <Row label="Foncier"               value={eur(financier.coutFoncier)} />
          <Row label="Travaux"               value={`${eur(financier.coutTravaux)} (${financier.coutTravauxM2.toLocaleString('fr-FR')} EUR/m2)`} />
          <Row label="Frais financiers"      value={eur(financier.coutFinanciers)} />
          <Row label="Commercialisation"     value={eur(financier.fraisCommercialisation)} />
          <div className="col-span-2 md:col-span-3 pt-2 mt-1 border-t border-slate-100">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Rentabilite</p>
          </div>
          <Row label="Marge nette" value={`${eur(financier.margeNette)} (${pct(financier.margeNettePercent)})`} highlight />
          <Row label="Marge operationnelle" value={pct(financier.margeOperationnellePercent)} />
          <Row label="TRN" value={pct(financier.trnRendement)} highlight />
          <Row label="Part foncier / CA" value={pct(financier.bilancielRatio)} />
        </div>
      </Section>

      {/* Plan de financement */}
      <Section title="Plan de financement" icon={Scale}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          <Row label="Fonds propres requis" value={`${eur(financement.fondsPropresRequis)} (${pct(financement.fondsPropresPercent)})`} />
          <Row label="Credit promoteur"     value={eur(financement.creditPromoteurMontant)} />
          <Row label="Duree credit"         value={`${financement.creditPromoteurDuree} mois`} />
          <Row label="Taux credit estime"   value={pct(financement.tauxCredit)} />
          <Row label="Prefinancement VEFA"  value={pct(financement.prefinancementVentes)} />
        </div>
        {financement.notesBancaires.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
            {financement.notesBancaires.map((n, i) => (
              <p key={i} className="text-xs text-amber-600 flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />{n}
              </p>
            ))}
          </div>
        )}
      </Section>

      {/* Scenarios */}
      <Section title="Scenarios de sensibilite" icon={TrendingUp}>
        <div className="space-y-2">
          {scenarios.map((sc: Scenario) => (
            <div key={sc.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-xs font-bold w-20 flex-shrink-0 ${
                  sc.type === 'OPTIMISTE'  ? 'text-emerald-600' :
                  sc.type === 'BASE'       ? 'text-violet-600' :
                  sc.type === 'PESSIMISTE' ? 'text-amber-600' : 'text-red-600'
                }`}>{sc.type}</span>
                <span className="text-xs text-slate-400 truncate">{sc.libelle}</span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className={`text-xs font-semibold ${
                  sc.resultat.margeNettePercent < 8 ? 'text-red-600' :
                  sc.resultat.margeNettePercent < 12 ? 'text-amber-600' : 'text-emerald-600'
                }`}>{pct(sc.resultat.margeNettePercent)}</span>
                <span className={`text-xs rounded-full px-2 py-0.5 font-semibold ${
                  sc.resultat.recommendation === 'GO' ? 'bg-emerald-50 text-emerald-600' :
                  sc.resultat.recommendation === 'GO_CONDITION' ? 'bg-amber-50 text-amber-600' :
                  'bg-red-50 text-red-600'
                }`}>{sc.resultat.recommendation}</span>
              </div>
            </div>
          ))}
        </div>
        {stressScenario && (
          <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-100">
            Stress test (prix -12%, travaux +10%) : marge {pct(stressScenario.resultat.margeNettePercent)} --
            {stressScenario.resultat.recommendation === 'GO' ? ' operation resiliente.' :
             stressScenario.resultat.recommendation === 'GO_CONDITION' ? ' operation fragile en scenario degrade.' :
             ' operation non viable en scenario degrade.'}
          </p>
        )}
      </Section>

      {/* Risques */}
      {risques.length > 0 && (
        <Section title={`Risques identifies (${risques.length})`} icon={AlertTriangle}>
          <div className="space-y-2">
            {risques.slice(0, 6).map((r: RisqueItem) => (
              <div key={r.id} className="flex items-start gap-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold flex-shrink-0 ${RISK_STYLE[r.niveau]}`}>
                  {r.niveau}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-700">{r.libelle}</p>
                  <p className="text-xs text-slate-400 truncate">{r.mitigation}</p>
                </div>
              </div>
            ))}
            {risques.length > 6 && (
              <p className="text-xs text-slate-400">+{risques.length - 6} autres risques dans le PDF</p>
            )}
          </div>
        </Section>
      )}

      {/* Synthese narrative */}
      {syntheseIA && (
        <Section title="Synthese analytique" icon={FileText} accent>
          <div className="space-y-4">
            {[
              { t: 'Resume executif',   c: syntheseIA.texteExecutif },
              { t: 'Marche',            c: syntheseIA.analyseMarche },
              { t: 'Technique',         c: syntheseIA.analyseTechnique },
              { t: 'Financier',         c: syntheseIA.analyseFinanciere },
              { t: 'Risques',           c: syntheseIA.analyseRisques },
            ].map(({ t, c }) => (
              <div key={t}>
                <p className="text-xs font-bold text-violet-600 mb-1">{t}</p>
                <p className="text-xs text-slate-600 leading-relaxed">{c}</p>
              </div>
            ))}
          </div>
          {syntheseIA.conclusion && (
            <div className="mt-4 -mx-4 -mb-4 px-4 pb-4 pt-3 bg-violet-50 border-t border-violet-100">
              <p className="text-xs font-bold text-violet-700 mb-1">Conclusion</p>
              <p className="text-xs text-violet-700 leading-relaxed">{syntheseIA.conclusion}</p>
            </div>
          )}
        </Section>
      )}

    </div>
  );
};

// ---- Main page --------------------------------------------------------------

export const PromoteurSynthesePage: React.FC<Props> = ({ studyData, bilanValues }) => {
  const [synthese, setSynthese] = useState<PromoteurSynthese | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lecture de l'image façade depuis le store (injectée par FacadeGeneratorPage)
  const facadeRenderUrl = usePromoteurProjectStore((s) => {
    try {
      return (s as Record<string, unknown>).facadeRenderUrl as string | null ?? null;
    } catch {
      return null;
    }
  });

  const rawInput = useMemo((): PromoteurRawInput => ({
    foncier: {
      adresse:           bilanValues?.adresse ?? studyData?.foncier?.adresse_complete,
      commune:           bilanValues?.commune ?? studyData?.foncier?.commune,
      codePostal:        bilanValues?.codePostal ?? studyData?.foncier?.code_postal,
      departement:       studyData?.foncier?.departement,
      surfaceTerrain:    studyData?.foncier?.surface_m2,
      prixAcquisition:   bilanValues?.totalFoncier ?? studyData?.evaluation?.cout_foncier,
      pollutionDetectee: false,
    },
    plu: {
      zone:        studyData?.plu?.zone_plu,
      cub:         studyData?.plu?.cos,
      hauteurMax:  studyData?.plu?.hauteur_max,
      pleineTerre: studyData?.plu?.pleine_terre_pct,
    },
    conception: {
      surfacePlancher: bilanValues?.sdpM2,
      nbLogements:     bilanValues?.nbLogements,
      programmeType:   bilanValues?.programmeType ?? 'Residentiel collectif',
    },
    marche: {
      prixNeufM2:          studyData?.marche?.prix_m2_neuf ?? bilanValues?.salePriceEurM2Hab,
      prixAncienM2:        studyData?.marche?.prix_m2_ancien,
      nbTransactionsDvf:   studyData?.marche?.nb_transactions,
      prixMoyenDvf:        studyData?.marche?.prix_moyen_dvf,
      offreConcurrente:    studyData?.marche?.nb_programmes_concurrents,
      absorptionMensuelle: studyData?.marche?.absorption_mensuelle,
    },
    risques: {
      risquesIdentifies: [],
      zonageRisque: studyData?.risques?.zonage_risque,
    },
    evaluation: {
      prixVenteM2:    bilanValues?.salePriceEurM2Hab,
      prixVenteTotal: bilanValues?.caTotal,
      nbLogementsLibres: bilanValues?.nbLogements,
    },
    bilan: {
      coutFoncier:            bilanValues?.totalFoncier,
      coutTravaux:            bilanValues?.coutTravauxBase,
      coutTravauxM2:          bilanValues?.coutTravauxM2,
      fraisFinanciers:        bilanValues?.totalFin,
      fraisCommercialisation: bilanValues?.totalCom,
      fraisGestion:           bilanValues?.totalEtudes,
      chiffreAffaires:        bilanValues?.caTotal ?? studyData?.bilan?.ca_previsionnel,
      margeNette:             bilanValues?.marge    ?? studyData?.bilan?.marge_nette,
      margeNettePercent:      bilanValues?.margePct ?? studyData?.bilan?.taux_marge_nette_pct,
      trnRendement:           bilanValues?.caTotal && bilanValues?.coutTotal
        ? (bilanValues.marge / bilanValues.coutTotal) * 100
        : undefined,
      fondsPropres:    undefined,
      creditPromoteur: undefined,
    },
  }), [studyData, bilanValues]);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await new Promise<void>(r => setTimeout(r, 60));
      const result = generatePromoteurSynthese(rawInput);
      setSynthese(result);
      await new Promise<void>(r => setTimeout(r, 40));
      exportPromoteurPdf(result, { facadeRenderUrl: facadeRenderUrl ?? undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la generation');
    } finally {
      setLoading(false);
    }
  }, [rawInput, facadeRenderUrl]);

  const handleRegenerate = useCallback(async () => {
    if (!synthese) return;
    setLoading(true);
    try {
      await new Promise<void>(r => setTimeout(r, 40));
      exportPromoteurPdf(synthese, { facadeRenderUrl: facadeRenderUrl ?? undefined });
    } finally {
      setLoading(false);
    }
  }, [synthese, facadeRenderUrl]);

  return (
    <div className="space-y-5">

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-700">Erreur de generation</p>
            <p className="text-xs text-red-600 mt-0.5">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-lg leading-none flex-shrink-0">x</button>
        </div>
      )}

      {!synthese && !loading && (
        <div className="flex flex-col items-center justify-center py-12 gap-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50 border-2 border-dashed border-violet-200">
            <FileText className="h-7 w-7 text-violet-400" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-700">Synthese Promoteur - Comite d'investissement</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              Etude de marche, analyse economique du bilan et presentation financiere generes automatiquement.
            </p>
          </div>

          {facadeRenderUrl && (
            <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2">
              <Building2 className="h-4 w-4 text-violet-500" />
              <span className="text-xs font-medium text-violet-700">Image facade disponible — sera incluse dans le PDF</span>
            </div>
          )}

          <button
            onClick={handleGenerate}
            className="inline-flex items-center gap-2.5 rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-violet-200 hover:bg-violet-700 hover:-translate-y-0.5 transition-all"
          >
            <FileText className="h-4 w-4" />
            Generer la synthese et exporter PDF
          </button>
        </div>
      )}

      {loading && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-violet-100 bg-violet-50 p-4">
            <Loader2 className="h-5 w-5 text-violet-500 animate-spin flex-shrink-0" />
            <p className="text-sm font-medium text-violet-700">
              {synthese ? 'Export PDF en cours...' : 'Analyse en cours - generation de la synthese...'}
            </p>
          </div>
          {!synthese && <LoadingPreview />}
        </div>
      )}

      {synthese && !loading && (
        <>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
              <span className="text-sm font-semibold text-emerald-700">Synthese generee - PDF telecharge</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleRegenerate} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 transition-colors">
                <Download className="h-3.5 w-3.5" />
                Re-telecharger PDF
              </button>
              <button onClick={() => setSynthese(null)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerer
              </button>
            </div>
          </div>

          <SynthesePreview synthese={synthese} facadeRenderUrl={facadeRenderUrl} />
        </>
      )}

    </div>
  );
};