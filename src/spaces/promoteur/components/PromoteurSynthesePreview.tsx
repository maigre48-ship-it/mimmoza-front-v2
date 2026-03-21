// src/spaces/promoteur/components/PromoteurSynthesePreview.tsx

import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertCircle,
  BarChart3,
  MapPin,
  Euro,
  Building2,
  Scale,
  Layers,
  ChevronRight,
  FileText,
} from 'lucide-react';
import type {
  PromoteurSynthese,
  RecommendationType,
  RisqueNiveau,
  RisqueItem,
  Scenario,
} from '../services/promoteurSynthese.types';
import type { ReportType } from '../services/promoteurSynthese.types';

// ??? Helpers ????????????????????????????????????????????????????????????????

function eur(v: number): string {
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}
function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

// ??? Sub-components ?????????????????????????????????????????????????????????

const SkeletonBlock: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />
);

const SkeletonPreview: React.FC = () => (
  <div className="space-y-4">
    <SkeletonBlock className="h-16 w-full" />
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} className="h-20" />)}
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <SkeletonBlock className="h-36" />
      <SkeletonBlock className="h-36" />
    </div>
    <SkeletonBlock className="h-48" />
    <SkeletonBlock className="h-32" />
  </div>
);

const EmptyState: React.FC = () => (
  <div className="flex flex-col items-center justify-center py-20 gap-4">
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50 border-2 border-dashed border-violet-200">
      <FileText className="h-7 w-7 text-violet-300" />
    </div>
    <div className="text-center">
      <p className="text-sm font-semibold text-slate-600">Aucune synthese generee</p>
      <p className="text-xs text-slate-400 mt-1 max-w-xs">
        Selectionnez un type de rapport et cliquez sur "Generer la synthese" pour obtenir votre dossier.
      </p>
    </div>
  </div>
);

// ??? Rec Banner ??????????????????????????????????????????????????????????????

const REC_CONFIG: Record<RecommendationType, {
  bg: string; border: string; text: string; icon: React.ComponentType<{ className?: string }>; label: string;
}> = {
  GO: {
    bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700',
    icon: CheckCircle2, label: '?  GO -- Operation recommandee',
  },
  GO_CONDITION: {
    bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700',
    icon: AlertCircle, label: '?  GO CONDITIONNEL -- Ajustements requis',
  },
  NO_GO: {
    bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700',
    icon: XCircle, label: '?  NO GO -- Operation non viable en l\'etat',
  },
};

const RecommendationBanner: React.FC<{ rec: RecommendationType; motif: string }> = ({ rec, motif }) => {
  const cfg = REC_CONFIG[rec];
  const Icon = cfg.icon;
  return (
    <div className={`flex items-start gap-3 rounded-xl border-2 ${cfg.border} ${cfg.bg} p-4`}>
      <Icon className={`h-6 w-6 flex-shrink-0 mt-0.5 ${cfg.text}`} />
      <div>
        <p className={`text-sm font-bold ${cfg.text}`}>{cfg.label}</p>
        <p className={`text-xs mt-0.5 ${cfg.text} opacity-80`}>{motif}</p>
      </div>
    </div>
  );
};

// ??? KPI Card ????????????????????????????????????????????????????????????????

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  trend?: 'up' | 'down' | 'neutral';
  alert?: boolean;
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, sub, trend, alert }) => (
  <div className={`rounded-xl border bg-white p-4 shadow-sm ${alert ? 'border-red-200' : 'border-slate-100'}`}>
    <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-1">{label}</p>
    <div className="flex items-end gap-1.5">
      <span className={`text-xl font-bold ${alert ? 'text-red-600' : 'text-slate-800'}`}>{value}</span>
      {trend === 'up' && <TrendingUp className="h-4 w-4 text-emerald-500 mb-0.5" />}
      {trend === 'down' && <TrendingDown className="h-4 w-4 text-red-500 mb-0.5" />}
    </div>
    {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
  </div>
);

// ??? Score Bar ????????????????????????????????????????????????????????????????

const ScoreBar: React.FC<{ label: string; score: number; invert?: boolean }> = ({ label, score, invert = false }) => {
  const display = invert ? 100 - score : score;
  const color = display >= 70 ? 'bg-emerald-500' : display >= 45 ? 'bg-amber-400' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-28 flex-shrink-0 truncate">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(score, 100)}%` }} />
      </div>
      <span className="text-xs font-semibold text-slate-600 w-7 text-right">{score}</span>
    </div>
  );
};

// ??? Risk Badge ??????????????????????????????????????????????????????????????

const RISQUE_STYLE: Record<RisqueNiveau, string> = {
  CRITIQUE: 'bg-red-100 text-red-700 border-red-200',
  ELEVE: 'bg-orange-100 text-orange-700 border-orange-200',
  MODERE: 'bg-amber-100 text-amber-700 border-amber-200',
  FAIBLE: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const RisqueBadge: React.FC<{ niveau: RisqueNiveau }> = ({ niveau }) => (
  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${RISQUE_STYLE[niveau]}`}>
    {niveau}
  </span>
);

// ??? Section Wrapper ??????????????????????????????????????????????????????????

const Section: React.FC<{
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  accent?: boolean;
}> = ({ title, icon: Icon, children, accent = false }) => (
  <div className={`rounded-xl border bg-white shadow-sm overflow-hidden ${accent ? 'border-violet-100' : 'border-slate-100'}`}>
    <div className={`flex items-center gap-2 px-4 py-3 border-b ${accent ? 'bg-violet-50 border-violet-100' : 'bg-slate-50 border-slate-100'}`}>
      <Icon className={`h-4 w-4 ${accent ? 'text-violet-500' : 'text-slate-400'}`} />
      <span className={`text-xs font-bold uppercase tracking-wider ${accent ? 'text-violet-700' : 'text-slate-600'}`}>{title}</span>
    </div>
    <div className="p-4">{children}</div>
  </div>
);

// ??? Kill Switch Alert ????????????????????????????????????????????????????????

const KillSwitchAlert: React.FC<{ items: string[] }> = ({ items }) => {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <ShieldAlert className="h-5 w-5 text-red-600" />
        <span className="text-sm font-bold text-red-700">Kill switches actifs</span>
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-red-600">
            <span className="mt-0.5 flex-shrink-0">?</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ??? Scenario Row ?????????????????????????????????????????????????????????????

const ScenarioRow: React.FC<{ scenario: Scenario }> = ({ scenario }) => {
  const recStyle: Record<RecommendationType, string> = {
    GO: 'text-emerald-600 bg-emerald-50',
    GO_CONDITION: 'text-amber-600 bg-amber-50',
    NO_GO: 'text-red-600 bg-red-50',
  };
  const typeStyle: Record<Scenario['type'], string> = {
    OPTIMISTE: 'text-emerald-700',
    BASE: 'text-violet-700',
    PESSIMISTE: 'text-amber-700',
    STRESS: 'text-red-700',
  };
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`text-xs font-bold w-20 flex-shrink-0 ${typeStyle[scenario.type]}`}>{scenario.type}</span>
        <span className="text-xs text-slate-400 truncate">{scenario.libelle}</span>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-xs font-semibold text-slate-700">{pct(scenario.resultat.margeNettePercent)}</span>
        <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${recStyle[scenario.resultat.recommendation]}`}>
          {scenario.resultat.recommendation}
        </span>
      </div>
    </div>
  );
};

// ??? Section Renderers ????????????????????????????????????????????????????????

const FinancierSection: React.FC<{ s: PromoteurSynthese }> = ({ s }) => (
  <Section title="Analyse financiere" icon={Euro}>
    <div className="space-y-2">
      {[
        ['Chiffre d\'affaires', eur(s.financier.chiffreAffairesTotal)],
        ['Cout de revient', eur(s.financier.coutRevientTotal)],
        ['Marge nette', `${eur(s.financier.margeNette)} (${pct(s.financier.margeNettePercent)})`],
        ['Travaux / m2', `${s.financier.coutTravauxM2.toLocaleString('fr-FR')} ?/m2`],
        ['TRN', pct(s.financier.trnRendement)],
      ].map(([label, val]) => (
        <div key={label} className="flex justify-between items-center text-xs">
          <span className="text-slate-500">{label}</span>
          <span className="font-semibold text-slate-700">{val}</span>
        </div>
      ))}
    </div>
  </Section>
);

const RisquesSection: React.FC<{ risques: RisqueItem[]; max?: number }> = ({ risques, max = 5 }) => (
  <Section title={`Risques (${risques.length})`} icon={AlertTriangle}>
    {risques.length === 0 ? (
      <p className="text-xs text-slate-400">Aucun risque identifie.</p>
    ) : (
      <div className="space-y-2">
        {risques.slice(0, max).map((r) => (
          <div key={r.id} className="flex items-start gap-2">
            <RisqueBadge niveau={r.niveau} />
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-700 truncate">{r.libelle}</p>
              <p className="text-xs text-slate-400 truncate">{r.mitigation}</p>
            </div>
          </div>
        ))}
        {risques.length > max && (
          <p className="text-xs text-slate-400 mt-1">+{risques.length - max} autres risques?</p>
        )}
      </div>
    )}
  </Section>
);

const MarcheSection: React.FC<{ s: PromoteurSynthese }> = ({ s }) => (
  <Section title="Marche" icon={BarChart3}>
    <div className="space-y-2">
      {[
        ['Zone', s.marche.zoneMarche.replace('_', ' ')],
        ['Prix neuf moy.', `${s.marche.prixNeufMoyenM2.toLocaleString('fr-FR')} ?/m2`],
        ['Prix projet', `${s.marche.prixProjetM2.toLocaleString('fr-FR')} ?/m2`],
        ['Position vs marche', `${s.marche.positionPrix > 0 ? '+' : ''}${pct(s.marche.positionPrix)}`],
        ['Concurrence', `${s.marche.offreConcurrente} programme(s)`],
        ...(s.marche.delaiEcoulementMois != null
          ? [['Delai ecoulement', `${s.marche.delaiEcoulementMois} mois`] as [string, string]]
          : []),
      ].map(([label, val]) => (
        <div key={label} className="flex justify-between items-center text-xs">
          <span className="text-slate-500">{label}</span>
          <span className="font-semibold text-slate-700">{val}</span>
        </div>
      ))}
    </div>
  </Section>
);

const TechniqueSection: React.FC<{ s: PromoteurSynthese }> = ({ s }) => {
  const statusStyle: Record<typeof s.technique.faisabiliteTechnique, string> = {
    CONFIRME: 'text-emerald-600 bg-emerald-50 border-emerald-200',
    SOUS_RESERVE: 'text-amber-600 bg-amber-50 border-amber-200',
    IMPOSSIBLE: 'text-red-600 bg-red-50 border-red-200',
  };
  const statusLabel: Record<typeof s.technique.faisabiliteTechnique, string> = {
    CONFIRME: '? Confirmee',
    SOUS_RESERVE: '? Sous reserve',
    IMPOSSIBLE: '? Impossible',
  };
  return (
    <Section title="Faisabilite technique" icon={Layers} accent>
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-xs font-bold rounded-full border px-3 py-1 ${statusStyle[s.technique.faisabiliteTechnique]}`}>
          {statusLabel[s.technique.faisabiliteTechnique]}
        </span>
        <span className="text-xs text-slate-400">Zone {s.technique.zonePlu}</span>
      </div>
      <div className="space-y-1.5">
        {[
          ['CUB', s.technique.cub != null ? String(s.technique.cub) : 'N/D'],
          ['Hauteur max', s.technique.hauteurMax != null ? `${s.technique.hauteurMax} m` : 'N/D'],
          ['Hauteur projet', s.technique.hauteurProjet != null ? `${s.technique.hauteurProjet} m` : 'N/D'],
          ['Niveaux', s.technique.nbNiveaux != null ? String(s.technique.nbNiveaux) : 'N/D'],
          ['Pleine terre', s.technique.pleineTerre != null ? `${s.technique.pleineTerre}%` : 'N/D'],
        ].map(([label, val]) => (
          <div key={label} className="flex justify-between text-xs">
            <span className="text-slate-500">{label}</span>
            <span className="font-semibold text-slate-700">{val}</span>
          </div>
        ))}
      </div>
      {s.technique.contraintes.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-500 mb-2">
            Contraintes ({s.technique.contraintes.length})
          </p>
          <div className="space-y-1">
            {s.technique.contraintes.slice(0, 4).map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={[
                  'flex-shrink-0 rounded-full w-1.5 h-1.5',
                  c.statut === 'BLOQUANT' ? 'bg-red-500' :
                  c.statut === 'LIMITE' ? 'bg-amber-400' : 'bg-emerald-400',
                ].join(' ')} />
                <span className="text-slate-600 truncate">{c.libelle}</span>
                <span className={[
                  'ml-auto flex-shrink-0 font-medium',
                  c.statut === 'BLOQUANT' ? 'text-red-500' :
                  c.statut === 'LIMITE' ? 'text-amber-500' : 'text-emerald-500',
                ].join(' ')}>{c.statut}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
};

const FinancementSection: React.FC<{ s: PromoteurSynthese }> = ({ s }) => (
  <Section title="Financement" icon={Building2}>
    <div className="space-y-2">
      {[
        ['Fonds propres requis', `${eur(s.financement.fondsPropresRequis)} (${pct(s.financement.fondsPropresPercent)})`],
        ['Credit promoteur', eur(s.financement.creditPromoteurMontant)],
        ['Duree credit', `${s.financement.creditPromoteurDuree} mois`],
        ['Taux credit estime', pct(s.financement.tauxCredit)],
        ['Prefinancement VEFA', pct(s.financement.prefinancementVentes)],
      ].map(([label, val]) => (
        <div key={label} className="flex justify-between items-center text-xs">
          <span className="text-slate-500">{label}</span>
          <span className="font-semibold text-slate-700">{val}</span>
        </div>
      ))}
    </div>
    {s.financement.notesBancaires.length > 0 && (
      <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
        {s.financement.notesBancaires.map((n, i) => (
          <p key={i} className="flex items-start gap-1.5 text-xs text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />{n}
          </p>
        ))}
      </div>
    )}
  </Section>
);

const ScenarioSection: React.FC<{ scenarios: Scenario[] }> = ({ scenarios }) => (
  <Section title="Scenarios" icon={Scale}>
    {scenarios.map((sc) => <ScenarioRow key={sc.id} scenario={sc} />)}
  </Section>
);

const SyntheseIASection: React.FC<{ s: PromoteurSynthese }> = ({ s }) => {
  if (!s.syntheseIA) return null;
  return (
    <Section title="Synthese analytique" icon={FileText} accent>
      <div className="space-y-3">
        {[
          { title: 'Resume', text: s.syntheseIA.texteExecutif },
          { title: 'Marche', text: s.syntheseIA.analyseMarche },
          { title: 'Technique', text: s.syntheseIA.analyseTechnique },
          { title: 'Financier', text: s.syntheseIA.analyseFinanciere },
          { title: 'Risques', text: s.syntheseIA.analyseRisques },
        ].map(({ title, text }) => (
          <div key={title}>
            <p className="text-xs font-bold text-violet-600 mb-1">{title}</p>
            <p className="text-xs text-slate-600 leading-relaxed">{text}</p>
          </div>
        ))}
      </div>
      {s.syntheseIA.conclusion && (
        <div className="mt-4 pt-3 border-t border-violet-100 rounded-b-lg bg-violet-50 -mx-4 -mb-4 px-4 pb-4">
          <p className="text-xs font-bold text-violet-700 mb-1">Conclusion</p>
          <p className="text-xs text-violet-700 leading-relaxed">{s.syntheseIA.conclusion}</p>
        </div>
      )}
    </Section>
  );
};

// ??? Main Preview ?????????????????????????????????????????????????????????????

interface Props {
  synthese: PromoteurSynthese | null;
  reportType: ReportType;
  loading?: boolean;
}

export const PromoteurSynthesePreview: React.FC<Props> = ({
  synthese,
  reportType,
  loading = false,
}) => {
  if (loading) return <SkeletonPreview />;
  if (!synthese) return <EmptyState />;

  const { executiveSummary: es, projet } = synthese;

  const kpis = [
    {
      label: 'Marge nette',
      value: pct(synthese.financier.margeNettePercent),
      sub: eur(synthese.financier.margeNette),
      trend: (synthese.financier.margeNettePercent >= 12 ? 'up' : 'down') as 'up' | 'down',
      alert: synthese.financier.margeNettePercent < 8,
    },
    {
      label: 'CA total HT',
      value: `${(synthese.financier.chiffreAffairesTotal / 1_000_000).toFixed(2)} M?`,
      sub: `${synthese.financier.chiffreAffairesM2.toLocaleString('fr-FR')} ?/m2`,
      trend: 'neutral' as const,
    },
    {
      label: 'TRN',
      value: pct(synthese.financier.trnRendement),
      sub: 'Taux de rendement net',
      trend: (synthese.financier.trnRendement >= 10 ? 'up' : 'down') as 'up' | 'down',
      alert: synthese.financier.trnRendement < 8,
    },
    {
      label: 'Score global',
      value: `${es.scores.global}/100`,
      sub: `${projet.nbLogements} logements`,
      trend: (es.scores.global >= 65 ? 'up' : 'down') as 'up' | 'down',
    },
  ];

  // Layout varies by report type
  const renderBanqueLayout = () => (
    <>
      <FinancierSection s={synthese} />
      <FinancementSection s={synthese} />
      <div className="col-span-1 md:col-span-2">
        <RisquesSection risques={synthese.risques} max={6} />
      </div>
      <ScenarioSection scenarios={synthese.scenarios} />
      <TechniqueSection s={synthese} />
    </>
  );

  const renderInvestisseurLayout = () => (
    <>
      <MarcheSection s={synthese} />
      <FinancierSection s={synthese} />
      <div className="col-span-1 md:col-span-2">
        <ScenarioSection scenarios={synthese.scenarios} />
      </div>
      <TechniqueSection s={synthese} />
      <FinancementSection s={synthese} />
    </>
  );

  const renderTechniqueLayout = () => (
    <>
      <div className="col-span-1 md:col-span-2">
        <TechniqueSection s={synthese} />
      </div>
      <MarcheSection s={synthese} />
      <FinancierSection s={synthese} />
      <RisquesSection risques={synthese.risques} max={5} />
      <FinancementSection s={synthese} />
    </>
  );

  return (
    <div className="space-y-4">
      {/* Projet header */}
      <div className="flex items-start gap-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100">
          <MapPin className="h-5 w-5 text-violet-600" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800 leading-tight truncate">
            {es.titreOperation}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">{projet.adresse} -- {projet.commune} ({projet.codePostal})</p>
        </div>
        <div className="ml-auto flex-shrink-0 flex items-center gap-1.5">
          <span className={`text-xs rounded-full px-2 py-0.5 font-medium border ${
            synthese.metadata.dataQualite === 'HAUTE'
              ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
              : synthese.metadata.dataQualite === 'MOYENNE'
              ? 'bg-amber-50 text-amber-600 border-amber-200'
              : 'bg-red-50 text-red-600 border-red-200'
          }`}>
            {synthese.metadata.dataQualite}
          </span>
        </div>
      </div>

      {/* Recommendation */}
      <RecommendationBanner rec={es.recommendation} motif={es.motifRecommandation} />

      {/* Kill switches */}
      <KillSwitchAlert items={es.killSwitchesActifs} />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((kpi) => <KpiCard key={kpi.label} {...kpi} />)}
      </div>

      {/* Scores */}
      <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Scores par dimension</p>
        <div className="space-y-2">
          <ScoreBar label="Foncier" score={es.scores.foncier} />
          <ScoreBar label="Technique / PLU" score={es.scores.technique} />
          <ScoreBar label="Marche" score={es.scores.marche} />
          <ScoreBar label="Financier" score={es.scores.financier} />
          <ScoreBar label="Risque (inverse)" score={es.scores.risque} invert />
          <div className="pt-2 border-t border-slate-100">
            <ScoreBar label="Score global" score={es.scores.global} />
          </div>
        </div>
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

      {/* Main content by report type */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reportType === 'banque' && renderBanqueLayout()}
        {reportType === 'investisseur' && renderInvestisseurLayout()}
        {reportType === 'technique' && renderTechniqueLayout()}
      </div>

      {/* Synthese IA */}
      <SyntheseIASection s={synthese} />

      {/* Avertissements metadata */}
      {synthese.metadata.avertissements.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" />Avertissements sur la qualite des donnees
          </p>
          <ul className="space-y-1">
            {synthese.metadata.avertissements.map((a, i) => (
              <li key={i} className="text-xs text-slate-400">{a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};