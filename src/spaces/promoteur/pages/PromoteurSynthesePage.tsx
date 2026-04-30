// src/spaces/promoteur/pages/PromoteurSynthesePage.tsx
// v4.3 — Patch DVF : lecture de study.marche.raw_data.core.dvf via
//        usePromoteurStudy et injection dans effectiveRawInput.marche.
//        Le PDF synthèse reçoit maintenant nb_transactions, prix moyen/min/max,
//        période et absorption mensuelle issus de market-study-promoteur-v1.
//
// v4.2 — Ajout bouton "Compléter les données" (séquentiel) + bloc "Actions utilisateur restantes"
// Fix : wrap des textes inline après icônes dans <span> pour éviter erreur Babel
//
// v4.4 — Facade IA : lecture depuis cache mémoire module-level (getFacadeImage)
//        en priorité sur readCaptures (localStorage soumis au quota).

import React, { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FileText, RefreshCw, AlertCircle, CheckCircle2, XCircle, AlertTriangle,
  TrendingUp, TrendingDown, BarChart3, Euro, Layers, Scale, MapPin,
  ChevronRight, Loader2, Download, ShieldAlert, Building2, Camera,
  Map, Grid3X3, Box, ExternalLink, Info, Sparkles, ArrowRight,
} from 'lucide-react';
import { generatePromoteurSynthese } from '../services/generatePromoteurSynthese';
import { exportPromoteurPdf }         from '../services/exportPromoteurPdf';
import { completePromoteurData, type CompletionStep } from '../services/completePromoteurData';
import { usePromoteurProjectStore }   from '../store/promoteurProject.store';
import { getSnapshot, getFacadeImage } from '../shared/promoteurSnapshot.store';
import { readCaptures }               from '../shared/captures.store';
import { usePromoteurStudy }          from '../shared/usePromoteurStudy';
import {
  totalEmpriseM2 as snapTotalEmprise,
  totalSdpM2    as snapTotalSdp,
} from '../plan2d/implantation2d.snapshot';
import type { Implantation2DSnapshot } from '../plan2d/implantation2d.snapshot';
import type {
  PromoteurSynthese, PromoteurRawInput, RisqueItem, RisqueNiveau,
  Scenario, RecommendationType, AnomalieItem, ModuleQualite, ModuleStatut, DataQualite,
} from '../services/promoteurSynthese.types';

// ── Clés localStorage ─────────────────────────────────────────────────────────
const SYNTHESE_RAW_KEY      = "mimmoza.promoteur.synthese.rawInput.v1";
const LS_FONCIER_SELECTED   = "mimmoza.promoteur.foncier.selected_v1";
const LS_PLU_RULESET        = "mimmoza.plu.resolved_ruleset_v1";
const AUTOCOMPLETE_DONE_KEY = "mimmoza.promoteur.synthese.autocomplete_done_v1";
// Données DVF locales sauvegardées par EvaluationPage (source la plus précise — scope CP/commune)
const LS_EVALUATION = "mimmoza.promoteur.evaluation.v1";
const LS_RENDU_TRAVAUX_SYNTHESE = "mimmoza.promoteur.renduTravaux.synthese.v1";
// ─── Types ───────────────────────────────────────────────────────────────────

interface StudyData {
  foncier?: { adresse_complete?: string; commune?: string; code_postal?: string; departement?: string; surface_m2?: number; commune_insee?: string; };
  plu?: { zone_plu?: string; cos?: number; hauteur_max?: number; pleine_terre_pct?: number; };
  marche?: { prix_m2_neuf?: number; prix_m2_ancien?: number; nb_transactions?: number; prix_moyen_dvf?: number; nb_programmes_concurrents?: number; absorption_mensuelle?: number; };
  risques?: { zonage_risque?: string; };
  evaluation?: { cout_foncier?: number; };
  bilan?: { ca_previsionnel?: number; prix_revient_total?: number; marge_nette?: number; taux_marge_nette_pct?: number; taux_credit_pct?: number; };
}

interface RenduTravauxSyntheseUi {
  id: string;
  generatedImageUrl: string;
  sourcePreview?: string;
  prompt?: string;
  generatedAt?: string | Date;
  durationMs?: number;
  configSnapshot?: Record<string, unknown> | null;
}
interface Props {
  rawInputOverride?: PromoteurRawInput;
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function eur(v: number): string { return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }); }
function pct(v: number): string { return `${v.toFixed(1)}%`; }
function m2(v: number): string  { return `${Math.round(v).toLocaleString('fr-FR')} m²`; }

function featureCentroid(feature: any): { lat: number; lon: number } | null {
  try {
    const geom = feature?.geometry;
    if (!geom) return null;
    let coords: number[][] = [];
    if      (geom.type === 'Polygon')      coords = geom.coordinates[0];
    else if (geom.type === 'MultiPolygon') coords = geom.coordinates[0][0];
    else return null;
    if (!coords.length) return null;
    const lat = coords.reduce((s: number, c: number[]) => s + c[1], 0) / coords.length;
    const lon = coords.reduce((s: number, c: number[]) => s + c[0], 0) / coords.length;
    return { lat, lon };
  } catch { return null; }
}

function buildStaticMapUrl(lat: number, lon: number): string {
  return (
    `https://maps.geoapify.com/v1/staticmap?style=osm-bright` +
    `&width=480&height=280&center=lonlat:${lon.toFixed(5)},${lat.toFixed(5)}&zoom=17` +
    `&marker=lonlat:${lon.toFixed(5)},${lat.toFixed(5)};color:%235247b8;size:medium`
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />
);

const LoadingPreview: React.FC = () => (
  <div className="space-y-4 py-4">
    <Skeleton className="h-16 w-full" />
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[0,1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>
    <div className="grid grid-cols-2 gap-4"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
    <Skeleton className="h-32" /><Skeleton className="h-48" />
  </div>
);

// ─── RecBanner v4 ─────────────────────────────────────────────────────────────

const REC_CFG: Record<RecommendationType, {
  bg: string; border: string; text: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}> = {
  GO: {
    bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700',
    icon: CheckCircle2, label: 'GO — Opération recommandée',
  },
  GO_CONDITION: {
    bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700',
    icon: AlertCircle, label: 'GO CONDITIONNEL — Ajustements requis',
  },
  NO_GO: {
    bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700',
    icon: XCircle, label: "NO GO — Opération non viable en l'état",
  },
  ANALYSE_INSUFFISANTE: {
    bg: 'bg-slate-50', border: 'border-slate-400', text: 'text-slate-700',
    icon: ShieldAlert, label: 'ANALYSE INSUFFISANTE — Données critiques manquantes',
  },
};

const RecBanner: React.FC<{
  rec: RecommendationType;
  motif: string;
  analyseSuffisante: boolean;
}> = ({ rec, motif, analyseSuffisante }) => {
  const cfg = REC_CFG[rec];
  const Icon = cfg.icon;
  return (
    <div className={`flex items-start gap-3 rounded-xl border-2 ${cfg.border} ${cfg.bg} p-4`}>
      <Icon className={`h-6 w-6 flex-shrink-0 mt-0.5 ${cfg.text}`} />
      <div className="flex-1">
        <p className={`text-sm font-bold ${cfg.text}`}>{cfg.label}</p>
        <p className={`text-xs mt-1 leading-relaxed ${cfg.text} opacity-80`}>{motif}</p>
        {!analyseSuffisante && (
          <p className={`text-xs mt-2 font-semibold ${cfg.text}`}>
            ⛔ Aucune recommandation d'investissement ne peut être émise tant que les points bloquants ne sont pas résolus.
          </p>
        )}
      </div>
    </div>
  );
};

// ─── CompletionBlock ──────────────────────────────────────────────────────────

const STEP_ICON: Record<CompletionStep['status'], React.FC<{ className?: string }>> = {
  pending: ({ className }) => <div className={`rounded-full border border-slate-300 ${className ?? ''}`} />,
  running: Loader2,
  success: CheckCircle2,
  skipped: Info,
  error:   XCircle,
};

const STEP_COLOR: Record<CompletionStep['status'], string> = {
  pending: 'text-slate-400',
  running: 'text-violet-600',
  success: 'text-emerald-600',
  skipped: 'text-slate-500',
  error:   'text-red-600',
};

interface CompletionBlockProps {
  steps: CompletionStep[] | null;
  running: boolean;
  done: boolean;
  onStart: () => void;
}

const CompletionBlock: React.FC<CompletionBlockProps> = ({ steps, running, done, onStart }) => {
  if (!steps && !running && !done) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5">
        <button
          onClick={onStart}
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-200 hover:bg-violet-700 hover:-translate-y-0.5 transition-all"
        >
          <Sparkles className="h-4 w-4" />
          <span>Compléter les données automatiquement</span>
        </button>
        <p className="text-xs text-slate-500 text-center max-w-md leading-relaxed">
          Récupère les données de marché (DVF, absorption), PLU et informations foncières manquantes.
          L'implantation 2D et la façade IA restent à votre charge.
        </p>
      </div>
    );
  }

  if (!steps) return null;

  const successCount = steps.filter(s => s.status === 'success').length;
  const errorCount   = steps.filter(s => s.status === 'error').length;
  const headerText = running
    ? 'Complétion automatique des données…'
    : errorCount > 0
      ? `Complétion terminée — ${successCount} réussie(s), ${errorCount} erreur(s)`
      : `Complétion terminée — ${successCount} donnée(s) complétée(s)`;

  return (
    <div className={`rounded-xl border-2 p-4 ${
      running
        ? 'border-violet-200 bg-violet-50'
        : errorCount > 0
          ? 'border-amber-200 bg-amber-50'
          : 'border-emerald-200 bg-emerald-50'
    }`}>
      <div className="flex items-center gap-2 mb-3">
        {running
          ? <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
          : errorCount > 0
            ? <AlertTriangle className="h-4 w-4 text-amber-600" />
            : <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        }
        <p className={`text-sm font-bold ${
          running ? 'text-violet-700' : errorCount > 0 ? 'text-amber-700' : 'text-emerald-700'
        }`}>
          {headerText}
        </p>
      </div>
      <div className="space-y-1.5 pl-1">
        {steps.map(s => {
          const Icon = STEP_ICON[s.status];
          return (
            <div key={s.id} className="flex items-center gap-2 text-xs">
              <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${STEP_COLOR[s.status]} ${s.status === 'running' ? 'animate-spin' : ''}`} />
              <span className={`${STEP_COLOR[s.status]} ${s.status === 'running' ? 'font-semibold' : ''}`}>{s.label}</span>
              {s.detail && <span className="text-slate-400 truncate">— {s.detail}</span>}
            </div>
          );
        })}
      </div>
      {done && !running && (
        <div className="mt-3 pt-3 border-t border-emerald-200 flex items-center gap-2 text-xs text-emerald-700">
          <ArrowRight className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="font-medium">
            Cliquez sur <strong>Regénérer</strong> en haut de la page pour mettre à jour la synthèse.
          </span>
        </div>
      )}
    </div>
  );
};

// ─── UserActionsBlock ─────────────────────────────────────────────────────────

interface UserActionsBlockProps {
  anomalies: AnomalieItem[];
  studyId: string | null;
}

const resolveActionTarget = (
  a: AnomalieItem,
  studyQ: string,
): { href: string; label: string } | null => {
  const txt = `${a.module} ${a.libelle}`.toLowerCase();
  if (txt.includes('implantation') || txt.includes('sdp')) {
    return { href: `/promoteur/implantation-2d${studyQ}`, label: 'Ouvrir Implantation 2D' };
  }
  if (txt.includes('bilan') || txt.includes('programme') || txt.includes('logement')) {
    return { href: `/promoteur/bilan${studyQ}`, label: 'Ouvrir le Bilan' };
  }
  if (txt.includes('plu') || txt.includes('ces') || txt.includes('cub')) {
    return { href: `/promoteur/plu${studyQ}`, label: 'Ouvrir PLU' };
  }
  if (txt.includes('foncier')) {
    return { href: `/promoteur/foncier${studyQ}`, label: 'Ouvrir Foncier' };
  }
  return null;
};

const UserActionRow: React.FC<{ anomalie: AnomalieItem; studyQ: string }> = ({ anomalie, studyQ }) => {
  const target = resolveActionTarget(anomalie, studyQ);
  const linkClass = 'inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-amber-700 no-underline flex-shrink-0 hover:bg-amber-100';

  return (
    <div className="flex items-start gap-3 rounded-lg bg-white/70 border border-amber-200 p-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold bg-amber-200 text-amber-800">{anomalie.module}</span>
          <p className="text-xs font-semibold text-amber-900">{anomalie.libelle}</p>
        </div>
        {anomalie.detail ? <p className="text-xs text-amber-800 opacity-80 leading-relaxed">{anomalie.detail}</p> : null}
        {anomalie.actionRequise ? <p className="text-xs mt-1 font-medium text-amber-900">→ {anomalie.actionRequise}</p> : null}
      </div>
      {target ? <a href={target.href} className={linkClass}>{target.label}</a> : null}
    </div>
  );
};

const UserActionsBlock: React.FC<UserActionsBlockProps> = ({ anomalies, studyId }) => {
  const studyQ = studyId ? `?study=${encodeURIComponent(studyId)}` : '';
  const countLabel = `${anomalies.length} point${anomalies.length > 1 ? 's' : ''}`;

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
        <p className="text-sm font-bold text-amber-800">Actions utilisateur restantes ({anomalies.length})</p>
      </div>
      <p className="text-xs text-amber-700 leading-relaxed mb-3">
        Les données externes ont été complétées automatiquement. Il reste {countLabel} nécessitant votre intervention — ces éléments ne peuvent pas être résolus automatiquement.
      </p>
      <div className="space-y-2">
        {anomalies.map(a => <UserActionRow key={a.id} anomalie={a} studyQ={studyQ} />)}
      </div>
    </div>
  );
};

// ─── AnomaliesSection ─────────────────────────────────────────────────────────

const ANOMALIE_NIVEAU_CFG = {
  CRITIQUE: { bg: 'bg-red-50',   border: 'border-red-200',   text: 'text-red-700',   badge: 'bg-red-100 text-red-700',   icon: XCircle },
  ALERTE:   { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700', icon: AlertTriangle },
  INFO:     { bg: 'bg-blue-50',  border: 'border-blue-200',  text: 'text-blue-700',  badge: 'bg-blue-100 text-blue-700',  icon: Info },
} as const;

const AnomalieCard: React.FC<{ anomalie: AnomalieItem }> = ({ anomalie }) => {
  const cfg = ANOMALIE_NIVEAU_CFG[anomalie.niveau];
  const Icon = cfg.icon;
  return (
    <div className="flex items-start gap-3">
      <Icon className={`h-4 w-4 flex-shrink-0 mt-0.5 ${cfg.text}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.badge}`}>{anomalie.module}</span>
          <p className={`text-xs font-semibold ${cfg.text}`}>{anomalie.libelle}</p>
        </div>
        {anomalie.detail && <p className={`text-xs leading-relaxed ${cfg.text} opacity-75`}>{anomalie.detail}</p>}
        {anomalie.actionRequise && (
          <p className={`text-xs mt-1 font-medium ${cfg.text} flex items-center gap-1`}>
            <ChevronRight className="h-3 w-3 flex-shrink-0" />
            <span>{anomalie.actionRequise}</span>
          </p>
        )}
      </div>
    </div>
  );
};

const AnomaliesSection: React.FC<{ anomalies: AnomalieItem[] }> = ({ anomalies }) => {
  if (anomalies.length === 0) return null;
  const critiques = anomalies.filter(a => a.niveau === 'CRITIQUE');
  const alertes   = anomalies.filter(a => a.niveau === 'ALERTE');
  const infos     = anomalies.filter(a => a.niveau === 'INFO');
  return (
    <div className="space-y-3">
      {critiques.length > 0 && (
        <div className="rounded-xl border-2 border-red-200 bg-red-50 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-red-100 border-b border-red-200">
            <XCircle className="h-4 w-4 text-red-600" />
            <span className="text-xs font-bold uppercase tracking-wider text-red-700">
              {critiques.length} anomalie{critiques.length > 1 ? 's' : ''} critique{critiques.length > 1 ? 's' : ''} — bloque{critiques.length > 1 ? 'nt' : ''} la recommandation
            </span>
          </div>
          <div className="p-3 space-y-3">{critiques.map(a => <AnomalieCard key={a.id} anomalie={a} />)}</div>
        </div>
      )}
      {alertes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-100 border-b border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700">
              {alertes.length} alerte{alertes.length > 1 ? 's' : ''} — à corriger avant décision
            </span>
          </div>
          <div className="p-3 space-y-3">{alertes.map(a => <AnomalieCard key={a.id} anomalie={a} />)}</div>
        </div>
      )}
      {infos.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
          <div className="p-3 space-y-2">{infos.map(a => <AnomalieCard key={a.id} anomalie={a} />)}</div>
        </div>
      )}
    </div>
  );
};

// ─── QualiteSection ───────────────────────────────────────────────────────────

const STATUT_CFG: Record<ModuleStatut, { bg: string; text: string; label: string }> = {
  COMPLET:     { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'COMPLET' },
  PARTIEL:     { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'PARTIEL' },
  INSUFFISANT: { bg: 'bg-red-100',     text: 'text-red-700',     label: 'INSUFFISANT' },
};

const QUALITE_BADGE: Record<DataQualite, string> = {
  HAUTE:       'bg-emerald-50 text-emerald-600 border-emerald-200',
  MOYENNE:     'bg-amber-50 text-amber-600 border-amber-200',
  FAIBLE:      'bg-orange-50 text-orange-600 border-orange-200',
  INSUFFISANT: 'bg-red-50 text-red-600 border-red-200',
};

const QualiteSection: React.FC<{ modules: ModuleQualite[]; dataQualite: DataQualite }> = ({ modules, dataQualite }) => (
  <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-slate-50">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Qualité des données par module</span>
      <span className={`text-xs font-bold rounded-full px-3 py-1 border ${QUALITE_BADGE[dataQualite]}`}>Données {dataQualite}</span>
    </div>
    <div className="divide-y divide-slate-50">
      {modules.map(mod => {
        const sc = STATUT_CFG[mod.statut];
        return (
          <div key={mod.module} className="px-4 py-3 flex items-start gap-3">
            <div className="flex items-center gap-2 w-36 flex-shrink-0 pt-0.5">
              <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold ${sc.bg} ${sc.text}`}>{sc.label}</span>
              <span className="text-xs font-semibold text-slate-600 truncate">{mod.module}</span>
            </div>
            <div className="flex-1 min-w-0">
              {mod.donneesManquantes.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {mod.donneesManquantes.map((d, i) => (
                    <span key={i} className={`inline-flex text-[10px] rounded px-1.5 py-0.5 ${d.includes('CRITIQUE') ? 'bg-red-100 text-red-600 font-bold' : 'bg-amber-100 text-amber-700'}`}>
                      — {d}
                    </span>
                  ))}
                </div>
              )}
              {mod.donneesPresentes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {mod.donneesPresentes.map((d, i) => (
                    <span key={i} className="inline-flex text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">✓ {d}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

// ─── KPI card ─────────────────────────────────────────────────────────────────

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

// ─── Section wrapper ──────────────────────────────────────────────────────────

const Section: React.FC<{ title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; accent?: boolean }> = ({ title, icon: Icon, children, accent }) => (
  <div className={`rounded-xl border bg-white shadow-sm overflow-hidden ${accent ? 'border-violet-100' : 'border-slate-100'}`}>
    <div className={`flex items-center gap-2 px-4 py-3 border-b ${accent ? 'bg-violet-50 border-violet-100' : 'bg-slate-50 border-slate-100'}`}>
      <Icon className={`h-4 w-4 ${accent ? 'text-violet-500' : 'text-slate-400'}`} />
      <span className={`text-xs font-bold uppercase tracking-wider ${accent ? 'text-violet-700' : 'text-slate-600'}`}>{title}</span>
    </div>
    <div className="p-4">{children}</div>
  </div>
);

const Row: React.FC<{ label: string; value: string; highlight?: boolean; missing?: boolean }> = ({ label, value, highlight, missing }) => (
  <div className="flex justify-between items-center text-xs py-1 border-b border-slate-50 last:border-0">
    <span className="text-slate-500">{label}</span>
    <span className={`font-semibold ${missing ? 'text-red-500' : highlight ? 'text-violet-700' : 'text-slate-700'}`}>{value}</span>
  </div>
);

const RISK_STYLE: Record<RisqueNiveau, string> = {
  CRITIQUE: 'bg-red-100 text-red-700',
  ELEVE:    'bg-orange-100 text-orange-700',
  MODERE:   'bg-amber-100 text-amber-700',
  FAIBLE:   'bg-emerald-100 text-emerald-700',
};

// ─── VisuelSlot ───────────────────────────────────────────────────────────────

const VisuelSlot: React.FC<{
  title: string; icon: React.ComponentType<{ className?: string }>;
  imageDataUrl?: string; staticUrl?: string;
  captureHref?: string; captureLabel?: string; captured?: boolean;
}> = ({ title, icon: Icon, imageDataUrl, staticUrl, captureHref, captureLabel = 'Aller capturer', captured }) => {
  const hasImage = !!imageDataUrl || !!staticUrl;
  return (
    <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-slate-50 flex-shrink-0">
        <Icon className="h-4 w-4 text-slate-400" />
        <span className="text-xs font-bold uppercase tracking-wider text-slate-600 flex-1">{title}</span>
        {captured ? <span className="text-xs text-emerald-600 font-medium flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Capturé</span>
          : staticUrl ? <span className="text-xs text-blue-500 font-medium">Carte statique</span> : null}
      </div>
      {imageDataUrl ? (
        <img src={imageDataUrl} alt={title} className="w-full object-cover" style={{ maxHeight: 220 }} />
      ) : staticUrl ? (
        <img src={staticUrl} alt={title} className="w-full object-cover" style={{ maxHeight: 220 }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
            const sib = (e.currentTarget as HTMLImageElement).nextElementSibling as HTMLElement | null;
            if (sib) sib.style.display = 'flex';
          }} />
      ) : null}
      {!imageDataUrl && (
        <div className="flex flex-col items-center justify-center gap-3 p-5 flex-1" style={{ minHeight: 140, display: staticUrl ? 'none' : 'flex' }}>
          <Camera className="h-8 w-8 text-slate-200" />
          <p className="text-xs text-slate-400 text-center leading-relaxed max-w-xs">
            Pas encore capturé. Allez sur la page correspondante et cliquez sur <strong>📸 Synthèse</strong>.
          </p>
          {captureHref && (
            <a href={captureHref} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 transition-colors no-underline">
              <ExternalLink className="h-3.5 w-3.5" />
              <span>{captureLabel}</span>
            </a>
          )}
        </div>
      )}
      {hasImage && captureHref && (
        <div className="flex justify-end px-3 py-1.5 border-t border-slate-50 bg-slate-50 flex-shrink-0">
          <a href={captureHref} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-violet-600 transition-colors no-underline">
            <RefreshCw className="h-3 w-3" />
            <span>Recapturer</span>
          </a>
        </div>
      )}
    </div>
  );
};

// ─── VisuelsSection ───────────────────────────────────────────────────────────

const VisuelsSection: React.FC<{
  captures: { cadastre?: string; impl2d?: string; massing3d?: string } | null;
  facadeRenderUrl: string | null;
  renduTravauxSynthese: RenduTravauxSyntheseUi | null;
  parcelCenter: { lat: number; lon: number } | null;
  studyId: string | null;
}> = ({ captures, facadeRenderUrl, renduTravauxSynthese, parcelCenter, studyId }) => {
  const studyQ = studyId ? `?study=${encodeURIComponent(studyId)}` : '';
  const cadastreStaticUrl = parcelCenter ? buildStaticMapUrl(parcelCenter.lat, parcelCenter.lon) : undefined;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <VisuelSlot title="Carte cadastrale" icon={Map} imageDataUrl={captures?.cadastre} staticUrl={!captures?.cadastre ? cadastreStaticUrl : undefined} captured={!!captures?.cadastre} captureHref={`/promoteur/foncier${studyQ}`} captureLabel="Aller sur Foncier" />
        <VisuelSlot title="Implantation 2D" icon={Grid3X3} imageDataUrl={captures?.impl2d} captured={!!captures?.impl2d} captureHref={`/promoteur/implantation-2d${studyQ}`} captureLabel="Aller sur Implantation 2D" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <VisuelSlot title="Massing 3D — Relief terrain" icon={Box} imageDataUrl={captures?.massing3d} captured={!!captures?.massing3d} captureHref={`/promoteur/massing-3d${studyQ}`} captureLabel="Aller sur Massing 3D" />
        <VisuelSlot
          title="Perspective façade IA"
          icon={Building2}
          imageDataUrl={facadeRenderUrl ?? undefined}
          captured={!!facadeRenderUrl}
          captureHref={`/promoteur/generateur-facades${studyQ}`}
          captureLabel="Générer une façade IA"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <VisuelSlot
          title="Rendu travaux IA"
          icon={Sparkles}
          imageDataUrl={renduTravauxSynthese?.generatedImageUrl}
          captured={!!renduTravauxSynthese?.generatedImageUrl}
          captureHref={`/promoteur/rendu-travaux${studyQ}`}
          captureLabel="Aller sur Rendu travaux"
        />
      </div>
    </div>
  );
};

// ─── PreGenerationView ────────────────────────────────────────────────────────

const PreGenerationView: React.FC<{
  snapshotFoncier: { communeInsee?: string; surfaceM2?: number; parcelId?: string };
  snapshotImpl2D:  { nbBatiments: number; sdp: number | null; emprise: number | null } | null;
  effectiveInput:  PromoteurRawInput;
  captures:        { cadastre?: string; impl2d?: string; massing3d?: string } | null;
  parcelCenter:    { lat: number; lon: number } | null;
  facadeRenderUrl: string | null;
  renduTravauxSynthese: RenduTravauxSyntheseUi | null;
  studyId:         string | null;
  onGenerate:      () => void;
}> = ({ snapshotFoncier, snapshotImpl2D, effectiveInput, captures, parcelCenter, facadeRenderUrl, renduTravauxSynthese, studyId, onGenerate }) => {
  const caTotal    = effectiveInput.bilan?.chiffreAffaires;
  const marge      = effectiveInput.bilan?.margeNettePercent;
  const sdp        = effectiveInput.conception?.surfacePlancher ?? snapshotImpl2D?.sdp;
  const commune    = effectiveInput.foncier?.commune ?? snapshotFoncier.communeInsee;
  const surface    = effectiveInput.foncier?.surfaceTerrain ?? snapshotFoncier.surfaceM2;
  const hasData    = (caTotal ?? 0) > 0;
  const hasFoncier = !!effectiveInput.bilan?.coutFoncier || !!effectiveInput.foncier?.prixAcquisition;

  return (
    <div className="space-y-5">
      <div className={`rounded-xl border p-4 ${hasData ? 'border-violet-100 bg-violet-50' : 'border-amber-200 bg-amber-50'}`}>
        <div className="flex items-center gap-2 mb-3">
          {hasData ? <CheckCircle2 className="h-4 w-4 text-violet-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
          <p className={`text-xs font-bold uppercase tracking-wide ${hasData ? 'text-violet-700' : 'text-amber-700'}`}>
            {hasData ? 'Données disponibles pour la synthèse' : 'Données insuffisantes — synthèse possible avec signalement des manquants'}
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'CA total HT', value: caTotal ? `${(caTotal / 1_000_000).toFixed(2)} M €` : 'NON RENSEIGNÉ', ok: !!caTotal },
            { label: 'Marge nette', value: marge != null ? pct(marge) + (hasFoncier ? '' : ' ⚠') : 'NON RENSEIGNÉ', ok: marge != null },
            { label: 'SDP',         value: sdp ? m2(sdp) : 'NON RENSEIGNÉ', ok: !!sdp },
            { label: 'Commune',     value: commune ?? 'NON RENSEIGNÉ', ok: !!commune },
          ].map(item => (
            <div key={item.label} className="bg-white rounded-lg p-3 border border-white/80">
              <p className="text-xs text-slate-400 font-medium mb-1">{item.label}</p>
              <p className={`text-sm font-bold ${item.ok ? 'text-slate-800' : 'text-red-500'}`}>{item.value}</p>
            </div>
          ))}
        </div>
        {!hasFoncier && (
          <p className="mt-3 text-xs text-amber-700 font-medium">
            ⚠ Coût foncier absent — la synthèse signalera cette anomalie critique et bloquera la recommandation.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="h-4 w-4 text-violet-500" />
            <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Foncier</p>
          </div>
          <div className="space-y-1">
            <Row label="Référence / adresse" value={effectiveInput.foncier?.adresse ?? snapshotFoncier.parcelId ?? 'NON RENSEIGNÉ'} highlight={!!effectiveInput.foncier?.adresse} missing={!effectiveInput.foncier?.adresse && !snapshotFoncier.parcelId} />
            <Row label="Commune / INSEE"     value={commune ?? 'NON RENSEIGNÉ'} highlight={!!commune} missing={!commune} />
            <Row label="Département"         value={effectiveInput.foncier?.departement ?? snapshotFoncier.communeInsee?.slice(0, 2) ?? 'NON RENSEIGNÉ'} />
            <Row label="Surface terrain"     value={surface ? m2(surface) : 'NON RENSEIGNÉ'} highlight={!!surface} missing={!surface} />
            <Row label="Prix acquisition"    value={hasFoncier ? eur(effectiveInput.bilan?.coutFoncier ?? effectiveInput.foncier?.prixAcquisition ?? 0) : 'NON RENSEIGNÉ'} highlight={hasFoncier} missing={!hasFoncier} />
          </div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Grid3X3 className="h-4 w-4 text-violet-500" />
            <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Implantation 2D</p>
          </div>
          {snapshotImpl2D ? (
            <div className="space-y-1">
              <Row label="Bâtiments"     value={`${snapshotImpl2D.nbBatiments} bâtiment${snapshotImpl2D.nbBatiments > 1 ? 's' : ''}`} />
              <Row label="SDP estimée"   value={snapshotImpl2D.sdp ? m2(snapshotImpl2D.sdp) : 'NON RENSEIGNÉ'} highlight={!!snapshotImpl2D.sdp} missing={!snapshotImpl2D.sdp} />
              <Row label="Emprise bâtie" value={snapshotImpl2D.emprise ? m2(snapshotImpl2D.emprise) : 'NON RENSEIGNÉ'} />
              <Row label="Nb logements"  value={effectiveInput.conception?.nbLogements ? String(effectiveInput.conception.nbLogements) : 'NON RENSEIGNÉ'} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-4 gap-2">
              <Grid3X3 className="h-8 w-8 text-slate-200" />
              <p className="text-xs text-slate-400 text-center">Aucune donnée d'implantation</p>
            </div>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Visuels du projet</p>
        <VisuelsSection
  captures={captures}
  facadeRenderUrl={facadeRenderUrl}
  renduTravauxSynthese={renduTravauxSynthese}
  parcelCenter={parcelCenter}
  studyId={studyId}
/>
      </div>

      <div className="flex flex-col items-center gap-3 pt-2">
        <button onClick={onGenerate}
          className="inline-flex items-center gap-2.5 rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-violet-200 hover:bg-violet-700 hover:-translate-y-0.5 transition-all">
          <FileText className="h-4 w-4" />
          <span>Générer la synthèse et exporter PDF</span>
        </button>
        {!hasData && (
          <p className="text-xs text-slate-400 text-center max-w-sm">
            La synthèse sera générée avec signalement explicite de toutes les données manquantes.
            Aucune recommandation ne sera émise sans données suffisantes.
          </p>
        )}
      </div>
    </div>
  );
};

// ─── SynthesePreview ─────────────────────────────────────────────────────────

interface SynthesePreviewProps {
  synthese:         PromoteurSynthese;
  facadeRenderUrl?: string | null;
  renduTravauxSynthese: RenduTravauxSyntheseUi | null;
  captures:         { cadastre?: string; impl2d?: string; massing3d?: string } | null;
  parcelCenter:     { lat: number; lon: number } | null;
  studyId:          string | null;
  completionSlot?:  React.ReactNode;
  userActionsSlot?: React.ReactNode;
}

const SynthesePreview: React.FC<SynthesePreviewProps> = ({
  synthese, facadeRenderUrl, renduTravauxSynthese, captures, parcelCenter, studyId, completionSlot, userActionsSlot,
}) => {
  const { executiveSummary: es, financier, marche, technique, risques, scenarios, financement, syntheseIA } = synthese;
  const stressScenario = scenarios.find(s => s.type === 'STRESS');

  return (
    <div className="space-y-5">

      <div className="flex items-start gap-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100">
          <MapPin className="h-5 w-5 text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 leading-tight">{es.titreOperation}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {synthese.projet.adresse !== 'Adresse non renseignée' ? synthese.projet.adresse : synthese.projet.commune}
            {synthese.projet.surfaceTerrain && ` · ${synthese.projet.surfaceTerrain.toLocaleString('fr-FR')} m² terrain`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-center">
            <div className={`text-lg font-black ${es.scores.global >= 65 ? 'text-emerald-600' : es.scores.global >= 45 ? 'text-amber-600' : 'text-red-600'}`}>
              {es.scores.global}/100
            </div>
            <div className="text-[9px] text-slate-400 uppercase tracking-wide">Score</div>
          </div>
          <span className={`text-xs rounded-full px-2 py-0.5 font-medium border flex-shrink-0 ${QUALITE_BADGE[synthese.metadata.dataQualite]}`}>
            Données {synthese.metadata.dataQualite}
          </span>
        </div>
      </div>

      <Section title="Visuels du projet" icon={Camera} accent>
        <VisuelsSection
  captures={captures}
  facadeRenderUrl={facadeRenderUrl ?? null}
  renduTravauxSynthese={renduTravauxSynthese}
  parcelCenter={parcelCenter}
  studyId={studyId}
/>
      </Section>

      <RecBanner rec={es.recommendation} motif={es.motifRecommandation} analyseSuffisante={synthese.metadata.analyseSuffisante} />

      {completionSlot}
      {userActionsSlot}

      {synthese.anomalies.length > 0 && <AnomaliesSection anomalies={synthese.anomalies} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label={financier.coutFoncierPresent ? 'Marge nette' : 'Marge nette ⚠'} value={financier.chiffreAffairesTotal > 0 ? pct(financier.margeNettePercent) : '—'} sub={financier.coutFoncierPresent ? eur(financier.margeNette) : 'Hors foncier — non fiable'} alert={!financier.coutFoncierPresent || financier.margeNettePercent < 8} trend={financier.coutFoncierPresent && financier.margeNettePercent >= 12 ? 'up' : 'down'} />
        <KpiCard label="CA total HT" value={financier.chiffreAffairesTotal > 0 ? `${(financier.chiffreAffairesTotal / 1_000_000).toFixed(2)} M €` : '—'} sub={financier.chiffreAffairesM2 > 0 ? `${financier.chiffreAffairesM2.toLocaleString('fr-FR')} €/m²` : undefined} />
        <KpiCard label={financier.coutFoncierPresent ? 'TRN' : 'TRN ⚠'} value={financier.trnRendement > 0 ? pct(financier.trnRendement) : '—'} sub={!financier.coutFoncierPresent ? 'Hors foncier — non fiable' : 'Taux de rendement net'} alert={!financier.coutFoncierPresent || financier.trnRendement < 8} trend={financier.coutFoncierPresent && financier.trnRendement >= 10 ? 'up' : 'down'} />
        <KpiCard label="Score global" value={`${es.scores.global}/100`} sub={`${synthese.projet.nbLogements} logement${synthese.projet.nbLogements > 1 ? 's' : ''} · ${synthese.projet.programmeType}`} trend={es.scores.global >= 65 ? 'up' : 'down'} />
      </div>

      {!financier.coutFoncierPresent && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-red-200 bg-red-50 p-4">
          <ShieldAlert className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-700">Coût foncier absent — indicateurs financiers non exploitables</p>
            <p className="text-xs text-red-600 mt-1 leading-relaxed">
              La marge ({pct(financier.margeNettePercent)}) et le TRN ({pct(financier.trnRendement)}) sont calculés hors foncier.
              Ces valeurs sont surestimées et ne peuvent pas servir de base de décision.
              Renseigner le prix d'acquisition dans le Bilan.
            </p>
          </div>
        </div>
      )}

      {(es.pointsForts.length > 0 || es.pointsVigilance.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {es.pointsForts.length > 0 && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 mb-3"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">Points forts</p></div>
              <ul className="space-y-1.5">{es.pointsForts.map((p, i) => <li key={i} className="flex items-start gap-1.5 text-xs text-emerald-700"><ChevronRight className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" /><span>{p}</span></li>)}</ul>
            </div>
          )}
          {es.pointsVigilance.length > 0 && (
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
              <div className="flex items-center gap-2 mb-3"><AlertTriangle className="h-4 w-4 text-amber-600" /><p className="text-xs font-bold text-amber-700 uppercase tracking-wide">Points de vigilance</p></div>
              <ul className="space-y-1.5">{es.pointsVigilance.map((p, i) => <li key={i} className="flex items-start gap-1.5 text-xs text-amber-700"><ChevronRight className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" /><span>{p}</span></li>)}</ul>
            </div>
          )}
        </div>
      )}

      <QualiteSection modules={synthese.qualiteParModule} dataQualite={synthese.metadata.dataQualite} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Étude de marché" icon={BarChart3}>
          {!marche.analyseFiable && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-red-100 bg-red-50/60 mb-3">
              <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-red-600 uppercase tracking-wide">ANALYSE DE MARCHÉ NON FIABLE</p>
                <p className="text-xs text-red-500 mt-0.5">Données DVF et concurrence absentes. Le prix de vente est une hypothèse non étayée par des transactions réelles.</p>
              </div>
            </div>
          )}
          <div className="space-y-0">
            <Row label="Zone marché" value={marche.zoneMarche} />
            <Row label="Prix neuf moyen" value={marche.prixNeufMoyenM2 > 0 ? `${marche.prixNeufMoyenM2.toLocaleString('fr-FR')} €/m²` : 'NON RENSEIGNÉ'} highlight={marche.prixNeufMoyenM2 > 0} missing={marche.prixNeufMoyenM2 === 0} />
            <Row label="Prix projet" value={marche.prixProjetM2 > 0 ? `${marche.prixProjetM2.toLocaleString('fr-FR')} €/m²` : 'NON RENSEIGNÉ'} missing={marche.prixProjetM2 === 0} />
            {marche.prixNeufMoyenM2 > 0 && marche.prixProjetM2 > 0 && <Row label="Position vs marché" value={`${marche.positionPrix > 0 ? '+' : ''}${pct(marche.positionPrix)}`} highlight={Math.abs(marche.positionPrix) > 5} />}
            {marche.primiumNeuf !== 0 && <Row label="Prime neuf/ancien" value={pct(marche.primiumNeuf)} />}
            <Row label="Transactions DVF" value={marche.analyseFiable ? 'Présentes (base DVF exploitée)' : 'NON RENSEIGNÉ'} highlight={marche.analyseFiable} missing={!marche.analyseFiable} />
            <Row label="Concurrence" value={marche.offreConcurrente > 0 ? `${marche.offreConcurrente} programme(s)` : 'Non répertoriée'} />
            {marche.delaiEcoulementMois != null && <Row label="Délai écoulement estimé" value={`${marche.delaiEcoulementMois} mois`} />}
          </div>
          {marche.notesMarcheLibre.filter(n => !n.startsWith('ANALYSE DE MARCHÉ NON FIABLE')).length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
              {marche.notesMarcheLibre.filter(note => !note.startsWith('ANALYSE DE MARCHÉ NON FIABLE')).map((note, i) => (
                <p key={i} className="text-xs text-amber-600 flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" /><span>{note}</span></p>
              ))}
            </div>
          )}
        </Section>

        <Section title="Faisabilité technique" icon={Layers} accent>
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-xs font-bold rounded-full px-3 py-1 border ${
              technique.faisabiliteTechnique === 'CONFIRME'     ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
              technique.faisabiliteTechnique === 'SOUS_RESERVE' ? 'bg-amber-50 text-amber-700 border-amber-200' :
              technique.faisabiliteTechnique === 'IMPOSSIBLE'   ? 'bg-red-50 text-red-700 border-red-200' :
              'bg-slate-50 text-slate-600 border-slate-200'
            }`}>
              {technique.faisabiliteTechnique === 'CONFIRME'     ? 'Confirmée' :
               technique.faisabiliteTechnique === 'SOUS_RESERVE' ? 'Sous réserve' :
               technique.faisabiliteTechnique === 'IMPOSSIBLE'   ? '⛔ Impossible' :
               'NON DÉTERMINABLE'}
            </span>
            <span className="text-xs text-slate-400">Zone {technique.zonePlu !== 'NON RENSEIGNÉ' ? technique.zonePlu : '—'}</span>
          </div>
          <div className="space-y-0">
            <Row label="CES / CUB"       value={technique.cub != null ? String(technique.cub) : 'NON RENSEIGNÉ'} missing={technique.cub == null} />
            <Row label="Hauteur max PLU" value={technique.hauteurMax != null ? `${technique.hauteurMax} m` : 'NON RENSEIGNÉ'} missing={technique.hauteurMax == null} />
            <Row label="Hauteur projet"  value={technique.hauteurProjet != null ? `${technique.hauteurProjet} m` : 'NON RENSEIGNÉ'} missing={technique.hauteurProjet == null} />
            <Row label="Niveaux"         value={technique.nbNiveaux != null ? String(technique.nbNiveaux) : 'NON RENSEIGNÉ'} missing={technique.nbNiveaux == null} />
            <Row label="Pleine terre"    value={technique.pleineTerre != null ? `${technique.pleineTerre}% min` : 'NON RENSEIGNÉ'} missing={technique.pleineTerre == null} />
          </div>
          {technique.contraintes.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Contraintes</p>
              {technique.contraintes.map((c, i) => (
                <div key={i} className="flex items-start gap-2 text-xs mb-1.5">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${c.statut === 'BLOQUANT' ? 'bg-red-500' : c.statut === 'A_VERIFIER' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                  <span className="text-slate-600 flex-1">{c.libelle}</span>
                  <div className="flex gap-1 flex-shrink-0">
                    {(c as any).valeurProjet && <span className="text-slate-500 bg-slate-100 px-1 rounded">{(c as any).valeurProjet}</span>}
                    {(c as any).valeurPlu && <span className={`px-1 rounded font-medium ${c.statut === 'BLOQUANT' ? 'bg-red-100 text-red-600' : c.statut === 'A_VERIFIER' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>PLU: {(c as any).valeurPlu}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section title="Analyse financière — Comité d'investissement" icon={Euro}>
        {!financier.coutFoncierPresent && (
          <div className="mb-3 p-2 rounded-lg bg-red-50 border border-red-100 text-xs text-red-600 font-semibold">
            ⛔ DONNÉES INCOMPLÈTES — Coût foncier absent. Les indicateurs ci-dessous sont non fiables.
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-0">
          <div className="col-span-2 md:col-span-3 pb-2 mb-1 border-b border-slate-100"><p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Bilan économique</p></div>
          <Row label="Chiffre d'affaires"    value={financier.chiffreAffairesTotal > 0 ? eur(financier.chiffreAffairesTotal) : 'NON RENSEIGNÉ'} missing={financier.chiffreAffairesTotal === 0} />
          <Row label="CA / m² vendable"      value={financier.chiffreAffairesM2 > 0 ? `${financier.chiffreAffairesM2.toLocaleString('fr-FR')} €/m²` : '—'} />
          <Row label="Coût de revient total" value={financier.coutRevientTotal > 0 ? eur(financier.coutRevientTotal) : '—'} />
          <Row label="Coût revient / m²"     value={financier.coutRevientM2 > 0 ? `${financier.coutRevientM2.toLocaleString('fr-FR')} €/m²` : '—'} />
          <Row label="Foncier"               value={financier.coutFoncierPresent ? eur(financier.coutFoncier) : 'NON RENSEIGNÉ'} highlight={financier.coutFoncierPresent} missing={!financier.coutFoncierPresent} />
          <Row label="Travaux"               value={financier.coutTravaux > 0 ? `${eur(financier.coutTravaux)} (${financier.coutTravauxM2.toLocaleString('fr-FR')} €/m²)` : '—'} />
          <Row label="Frais financiers"      value={financier.coutFinanciers > 0 ? eur(financier.coutFinanciers) : '—'} />
          <Row label="Commercialisation"     value={financier.fraisCommercialisation > 0 ? eur(financier.fraisCommercialisation) : '—'} />
          <div className="col-span-2 md:col-span-3 pt-2 mt-1 border-t border-slate-100"><p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Rentabilité</p></div>
          <Row label={financier.coutFoncierPresent ? 'Marge nette' : 'Marge nette ⚠ (hors foncier)'} value={financier.chiffreAffairesTotal > 0 ? `${eur(financier.margeNette)} (${pct(financier.margeNettePercent)})` : 'NON CALCULABLE'} highlight missing={financier.chiffreAffairesTotal === 0} />
          <Row label="Marge opérationnelle"  value={financier.margeOperationnellePercent !== 0 ? pct(financier.margeOperationnellePercent) : '—'} />
          <Row label={financier.coutFoncierPresent ? 'TRN' : 'TRN ⚠ (hors foncier)'} value={financier.trnRendement > 0 ? pct(financier.trnRendement) : '—'} highlight />
          <Row label="Part foncier / CA"     value={financier.bilancielRatio > 0 ? pct(financier.bilancielRatio) : '—'} />
        </div>
      </Section>

      <Section title="Plan de financement" icon={Scale}>
        {financement.notesBancaires.length > 0 && (
          <div className="mb-3 space-y-1">
            {financement.notesBancaires.map((note, i) => (
              <p key={i} className="text-xs text-red-600 flex items-start gap-1.5 font-medium">
                <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                <span>{note}</span>
              </p>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-6 gap-y-0">
          <Row label="Fonds propres requis" value={`${eur(financement.fondsPropresRequis)} (${pct(financement.fondsPropresPercent)})`} />
          <Row label="Crédit promoteur"     value={eur(financement.creditPromoteurMontant)} />
          <Row label="Durée crédit estimée" value={`${financement.creditPromoteurDuree} mois`} />
          <Row label="Taux crédit estimé"   value={pct(financement.tauxCredit)} />
          <Row label="Préfinancement VEFA"  value={pct(financement.prefinancementVentes)} />
        </div>
      </Section>

      {scenarios.length > 0 && (
        <Section title="Scénarios de sensibilité" icon={TrendingUp}>
          <div className="space-y-2">
            {scenarios.map((sc: Scenario) => (
              <div key={sc.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-xs font-bold w-24 flex-shrink-0 ${sc.type === 'OPTIMISTE' ? 'text-emerald-600' : sc.type === 'BASE' ? 'text-violet-600' : sc.type === 'PESSIMISTE' ? 'text-amber-600' : 'text-red-600'}`}>{sc.type}</span>
                  <span className="text-xs text-slate-400 truncate">{sc.libelle}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`text-xs font-semibold ${sc.resultat.margeNettePercent < 8 ? 'text-red-600' : sc.resultat.margeNettePercent < 12 ? 'text-amber-600' : 'text-emerald-600'}`}>{pct(sc.resultat.margeNettePercent)}</span>
                  <span className={`text-xs rounded-full px-2 py-0.5 font-semibold ${sc.resultat.recommendation === 'GO' ? 'bg-emerald-50 text-emerald-600' : sc.resultat.recommendation === 'GO_CONDITION' ? 'bg-amber-50 text-amber-600' : sc.resultat.recommendation === 'ANALYSE_INSUFFISANTE' ? 'bg-slate-100 text-slate-500' : 'bg-red-50 text-red-600'}`}>
                    {sc.resultat.recommendation === 'ANALYSE_INSUFFISANTE' ? 'NON FIABLE' : sc.resultat.recommendation}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {stressScenario && (
            <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-100">
              Stress test ({stressScenario.libelle}) : marge {pct(stressScenario.resultat.margeNettePercent)} —{' '}
              {stressScenario.resultat.recommendation === 'GO' ? 'opération résiliente.' :
               stressScenario.resultat.recommendation === 'GO_CONDITION' ? 'opération fragile en scénario dégradé.' :
               stressScenario.resultat.recommendation === 'ANALYSE_INSUFFISANTE' ? 'analyse incomplète, données insuffisantes.' :
               'opération non viable en scénario dégradé.'}
            </p>
          )}
        </Section>
      )}

      {risques.length > 0 && (
        <Section title={`Risques identifiés (${risques.length})`} icon={AlertTriangle}>
          <div className="space-y-2">
            {risques.map((r: RisqueItem) => (
              <div key={r.id} className="flex items-start gap-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold flex-shrink-0 ${RISK_STYLE[r.niveau]}`}>{r.niveau}</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-700">{r.libelle}</p>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{r.mitigation}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Synthèse analytique" icon={FileText} accent>
        <div className="space-y-4">
          {[
            { t: 'Résumé exécutif', c: syntheseIA.texteExecutif },
            { t: 'Marché',          c: syntheseIA.analyseMarche },
            { t: 'Technique',       c: syntheseIA.analyseTechnique },
            { t: 'Financier',       c: syntheseIA.analyseFinanciere },
            { t: 'Risques',         c: syntheseIA.analyseRisques },
          ].map(({ t, c }) => (
            <div key={t}>
              <p className="text-xs font-bold text-violet-600 mb-1">{t}</p>
              <p className="text-xs text-slate-600 leading-relaxed">{c}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 -mx-4 -mb-4 px-4 pb-4 pt-3 bg-violet-50 border-t border-violet-100">
          <p className="text-xs font-bold text-violet-700 mb-1">Conclusion</p>
          <p className="text-xs text-violet-700 leading-relaxed">{syntheseIA.conclusion}</p>
        </div>
      </Section>

    </div>
  );
};

// ─── Page principale ──────────────────────────────────────────────────────────

export const PromoteurSynthesePage: React.FC<Props> = ({ rawInputOverride, studyData, bilanValues }) => {
  const [synthese, setSynthese] = useState<PromoteurSynthese | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const [completing,       setCompleting]       = useState(false);
  const [completionSteps,  setCompletionSteps]  = useState<CompletionStep[] | null>(null);
  const [autocompleteDone, setAutocompleteDone] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(AUTOCOMPLETE_DONE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return !!parsed?.timestamp;
    } catch { return false; }
  });

  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");

  const { study } = usePromoteurStudy(studyId);

  const studyMarcheDvf = useMemo(() => {
    const rawData = (study as any)?.marche?.raw_data;
    const dvf     = rawData?.core?.dvf;
    if (!dvf || typeof dvf !== 'object') return null;

    const asNum = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;

    const horizon = asNum(dvf.horizon_mois_absorption) ?? 12;

    return {
      nbTransactionsDvf:   asNum(dvf.nb_transactions),
      prixMoyenDvf:        asNum(dvf.prix_m2_moyen),
      prixMedianDvf:       asNum(dvf.prix_m2_median),
      prixMinDvf:          asNum(dvf.prix_m2_min),
      prixMaxDvf:          asNum(dvf.prix_m2_max),
      absorptionMensuelle: asNum(dvf.absorption_mensuelle),
      periodeDvf:          horizon ? `${horizon} mois glissants` : undefined,
    };
  }, [study]);

  // ── [v4.4] DVF local depuis EvaluationPage (priorité max) ────────────────
  // EvaluationPage sauvegarde les résultats DVF locaux (scope CP ou commune)
  // dans LS_EVALUATION. Ces données sont plus précises que study.marche
  // (scope plus large, 500+ transactions) car filtrées sur la zone exacte.
  const evaluationDvf = useMemo(() => {
    try {
      const raw = localStorage.getItem(LS_EVALUATION);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.prixM2) return null; // données incomplètes
      return {
        // dvfLocalTransactions = dvfBest.transactions (26 local) sauvé par EvaluationPage
      // NE PAS lire parsed.nbTransactions = marche.nb_transactions (500 du market study large)
      nbTransactionsDvf:   typeof parsed.dvfLocalTransactions === 'number' ? parsed.dvfLocalTransactions : undefined,
        prixMoyenDvf:        typeof parsed.prixM2 === 'number' ? parsed.prixM2 : undefined,
        prixMedianDvf:       typeof parsed.prixM2Median === 'number' ? parsed.prixM2Median : undefined,
        absorptionMensuelle: typeof parsed.absorptionMensuelle === 'number' ? parsed.absorptionMensuelle : undefined,
      };
    } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionSteps]);

  // ── Captures scopées par studyId ──────────────────────────────────────────
  const captureImages = useMemo(() => {
    const caps = readCaptures(studyId);
    return {
      cadastre:  caps.cadastre,
      impl2d:    caps.impl2d,
      massing3d: caps.massing3d,
    };
  }, [studyId]);

  // ── [v4.4] Facade IA — cache mémoire en priorité sur localStorage ─────────
  // Le cache mémoire module-level (_facadeImageCache dans promoteurSnapshot.store)
  // est insensible au quota localStorage et survit aux remounts de composant.
  // Fallback sur readCaptures pour les images persistées en session précédente.
  const facadeRenderUrl = useMemo<string | null>(() => {
    const cached = getFacadeImage(studyId);
    if (cached) {
      console.log('[PromoteurSynthese] Image façade lue depuis cache mémoire ✓');
      return cached;
    }
    const caps = readCaptures(studyId);
    return caps.facadeIA ?? null;
  }, [studyId]);

    const renduTravauxSynthese = useMemo<RenduTravauxSyntheseUi | null>(() => {
    try {
      const raw = localStorage.getItem(LS_RENDU_TRAVAUX_SYNTHESE);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as Partial<RenduTravauxSyntheseUi>;

      const memoryImage = (window as any).__mimmozaRenduTravauxSyntheseImage;

const generatedImageUrl =
  typeof memoryImage === "string"
    ? memoryImage
    : typeof parsed.generatedImageUrl === "string"
      ? parsed.generatedImageUrl
      : null;

if (!generatedImageUrl) return null;

      return {
        id: parsed.id ?? `rendu-travaux-${Date.now()}`,
        generatedImageUrl,
        sourcePreview: parsed.sourcePreview,
        prompt: parsed.prompt,
        generatedAt: parsed.generatedAt,
        durationMs: parsed.durationMs,
        configSnapshot: parsed.configSnapshot ?? null,
      };
    } catch (e) {
      console.warn('[PromoteurSynthese] lecture rendu travaux synthèse impossible:', e);
      return null;
    }
  }, []);


  // ── Snapshot foncier ──────────────────────────────────────────────────────
  const snapshotFoncier = useMemo(() => {
    try {
      const snap = getSnapshot() as any;
      const communeInsee = snap?.foncier?.communeInsee ?? (() => { try { return localStorage.getItem("mimmoza.session.commune_insee") ?? undefined; } catch { return undefined; } })();
      const surfaceM2    = snap?.foncier?.surfaceM2    ?? (() => { try { const v = localStorage.getItem("mimmoza.session.surface_m2"); return v ? Number(v) || undefined : undefined; } catch { return undefined; } })();
      const parcelId     = snap?.foncier?.parcelId     ?? (() => { try { return localStorage.getItem("mimmoza.session.parcel_id") ?? undefined; } catch { return undefined; } })();
      return { communeInsee, surfaceM2, parcelId };
    } catch { return {}; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parcelData = useMemo(() => {
    try {
      const raw = localStorage.getItem(LS_FONCIER_SELECTED);
      if (!raw) return null;
      const parcels = JSON.parse(raw);
      const feature = parcels?.[0]?.feature ?? parcels?.[0];
      if (!feature) return null;
      const props   = feature.properties ?? {};
      const section = props.section ?? props.prefixe_section ?? '';
      const numero  = props.numero  ?? props.numero_plan     ?? '';
      const surface = props.contenance ?? props.surface_m2   ?? null;
      const adresse = props.adresse    ?? props.label        ?? null;
      const id      = props.id         ?? null;
      const ref = section && numero
        ? `Section ${String(section).trim()} n°${String(numero).replace(/^0+/, '')}`
        : (id ?? null);
      return { ref, surface: surface != null ? Number(surface) : null, adresse: adresse ?? ref ?? null, id };
    } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const snapshotImpl2D = useMemo(() => {
    try {
      const snap   = getSnapshot() as any;
      const impl2d = snap?.implantation2d as Implantation2DSnapshot | null;
      if (!impl2d?.buildings?.length) return null;
      const sdp     = snapTotalSdp(impl2d);
      const emprise = snapTotalEmprise(impl2d);
      return { nbBatiments: impl2d.buildings.length, sdp: sdp > 0 ? sdp : null, emprise: emprise > 0 ? emprise : null };
    } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parcelCenter = useMemo(() => {
    try {
      const raw = localStorage.getItem(LS_FONCIER_SELECTED);
      if (!raw) return null;
      const parcels = JSON.parse(raw);
      const feature = parcels?.[0]?.feature ?? parcels?.[0];
      return featureCentroid(feature);
    } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pluFromLS = useMemo(() => {
    try {
      const raw = localStorage.getItem(LS_PLU_RULESET);
      if (!raw) return null;
      const r = JSON.parse(raw);
      const zone        = typeof r.zone_code === 'string' && r.zone_code.trim() ? r.zone_code.trim() : undefined;
      const hauteurMax  = typeof r.hauteur?.max_m === 'number' ? r.hauteur.max_m : undefined;
      const pleineTerre = typeof r.pleine_terre?.ratio_min === 'number' ? r.pleine_terre.ratio_min : undefined;
      const cub         = typeof r.ces?.max_ratio === 'number' ? r.ces.max_ratio : undefined;
      if (!zone && hauteurMax === undefined && pleineTerre === undefined) return null;
      return { zone, hauteurMax, pleineTerre, cub };
    } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionSteps]);

  const rawInputFromLS = useMemo((): PromoteurRawInput | null => {
    try {
      const raw = localStorage.getItem(SYNTHESE_RAW_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as PromoteurRawInput;
    } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionSteps]);

  // ── [FIX] rawInputFromStudy — reconstruit depuis Supabase + localStorage bilan ─
  // Fallback critique quand mimmoza.promoteur.synthese.rawInput.v1 est vide.
  // Sources par priorité :
  //   1. mimmoza.bilan.assumptions.{studyId} → landPriceEur, prix vente, travaux
  //   2. mimmoza.bilan.land_price_eur.{studyId} → prix foncier backup
  //   3. study.bilan → ca_previsionnel, marge (depuis patchBilan Supabase)
  //   4. study.foncier / plu / conception → données structurelles
  // Ces clés localStorage NE sont PAS dans la liste des clés supprimées.
  const rawInputFromStudy = useMemo((): PromoteurRawInput | null => {
    if (!study && !studyId) return null;

    const f = study?.foncier ?? null;
    const p = study?.plu ?? null;
    const c = study?.conception ?? null;
    const m = study?.marche ?? null;
    const b = study?.bilan ?? null;

    // Lire les hypothèses bilan depuis localStorage (clés scopées par studyId)
    // Ces clés survivent à la suppression de synthese.rawInput.v1
    let bilanAss: Record<string, unknown> | null = null;
    let landPriceEur: number | undefined = undefined;
    if (studyId) {
      try {
        const rawAss = localStorage.getItem(`mimmoza.bilan.assumptions.${studyId}`);
        if (rawAss) bilanAss = JSON.parse(rawAss);
      } catch { /* ignore */ }
      try {
        const rawPrice = localStorage.getItem(`mimmoza.bilan.land_price_eur.${studyId}`);
        const price = rawPrice ? Number(rawPrice) : NaN;
        if (Number.isFinite(price) && price > 0) landPriceEur = price;
      } catch { /* ignore */ }
    }

    // Récupérer landPriceEur depuis bilanAss si pas trouvé directement
    if (!landPriceEur && bilanAss) {
      const lp = Number(bilanAss.landPriceEur);
      if (Number.isFinite(lp) && lp > 0) landPriceEur = lp;
    }

    const salePriceEurM2Hab = Number((bilanAss?.salePriceEurM2Hab as number | undefined) ?? 0);
    const worksCostEurM2Sdp = Number((bilanAss?.worksCostEurM2Sdp as number | undefined) ?? 0);
    const financingRatePct  = Number((bilanAss?.financingRatePct as number | undefined) ?? 4);
    const marketingPctCa    = Number((bilanAss?.marketingPctCa as number | undefined) ?? 2);
    const moePct            = Number((bilanAss?.moePct as number | undefined) ?? 10);

    // Extraire PLU depuis ruleset Supabase
    const ruleset        = p?.ruleset as Record<string, unknown> | null ?? null;
    const pluHauteurMax  = (ruleset?.hauteur as any)?.max_m ?? p?.hauteur_max ?? null;
    const pluPleineTerre = (ruleset?.pleine_terre as any)?.ratio_min ?? p?.pleine_terre_pct ?? null;
    const pluCub         = (ruleset?.ces as any)?.max_ratio ?? p?.cos ?? null;

    // Ne retourner null que si VRAIMENT rien n'est disponible
    if (!f && !b && !bilanAss && !landPriceEur) return null;

    return {
      foncier: {
        commune:        f?.commune_insee ?? undefined,
        departement:    f?.commune_insee ? String(f.commune_insee).slice(0, 2) : undefined,
        surfaceTerrain: f?.surface_m2 ?? undefined,
        prixAcquisition: landPriceEur,
      },
      plu: {
        zone:        p?.zone_code ?? undefined,
        hauteurMax:  pluHauteurMax ?? undefined,
        pleineTerre: pluPleineTerre ?? undefined,
        cub:         pluCub ?? undefined,
      },
      conception: c ? {
        surfacePlancher: c.shon_total_m2 ?? undefined,
        nbLogements:     c.nb_logements_total ?? undefined,
        nbNiveaux:       c.nb_niveaux ?? undefined,
        hauteurProjet:   c.hauteur_retenue_m ?? undefined,
        programmeType:   'Résidentiel collectif',
      } : undefined,
      marche: {
        prixNeufM2:   m?.prix_m2_neuf ?? (salePriceEurM2Hab > 0 ? salePriceEurM2Hab : undefined),
        prixAncienM2: m?.prix_m2_ancien ?? undefined,
      },
      risques: { risquesIdentifies: [] },
      evaluation: {
        prixVenteM2:   salePriceEurM2Hab > 0 ? salePriceEurM2Hab : undefined,
        prixVenteTotal: b?.ca_previsionnel ?? undefined,
        nbLogementsLibres: c?.nb_logements_libres ?? undefined,
      },
      bilan: {
        coutFoncier:            landPriceEur,
        coutTravaux:            b?.prix_revient_total && landPriceEur
          ? b.prix_revient_total - landPriceEur
          : undefined,
        coutTravauxM2:          worksCostEurM2Sdp > 0 ? worksCostEurM2Sdp : undefined,
        fraisFinanciers:        undefined,
        fraisCommercialisation: undefined,
        fraisGestion:           undefined,
        chiffreAffaires:        b?.ca_previsionnel ?? undefined,
        margeNette:             b?.marge_nette ?? undefined,
        margeNettePercent:      b?.taux_marge_nette_pct ?? undefined,
        trnRendement:           b?.roi_pct ?? undefined,
        fondsPropres:           b?.fonds_propres ?? undefined,
        creditPromoteur:        b?.credit_promotion ?? undefined,
      },
    };
  }, [study, studyId]);

  const rawInputLegacy = useMemo((): PromoteurRawInput => ({
    foncier: {
      adresse: bilanValues?.adresse ?? studyData?.foncier?.adresse_complete,
      commune: bilanValues?.commune ?? studyData?.foncier?.commune,
      codePostal: bilanValues?.codePostal ?? studyData?.foncier?.code_postal,
      departement: studyData?.foncier?.departement,
      surfaceTerrain: studyData?.foncier?.surface_m2,
      prixAcquisition: (bilanValues?.totalFoncier || undefined) ?? (studyData?.evaluation?.cout_foncier || undefined),
      pollutionDetectee: false,
    },
    plu: { zone: studyData?.plu?.zone_plu, cub: studyData?.plu?.cos, hauteurMax: studyData?.plu?.hauteur_max, pleineTerre: studyData?.plu?.pleine_terre_pct },
    conception: { surfacePlancher: bilanValues?.sdpM2 || undefined, nbLogements: bilanValues?.nbLogements || undefined, programmeType: bilanValues?.programmeType ?? 'Résidentiel collectif' },
    marche: { prixNeufM2: studyData?.marche?.prix_m2_neuf ?? (bilanValues?.salePriceEurM2Hab || undefined), prixAncienM2: studyData?.marche?.prix_m2_ancien, nbTransactionsDvf: studyData?.marche?.nb_transactions, prixMoyenDvf: studyData?.marche?.prix_moyen_dvf, offreConcurrente: studyData?.marche?.nb_programmes_concurrents, absorptionMensuelle: studyData?.marche?.absorption_mensuelle },
    risques: { risquesIdentifies: [], zonageRisque: studyData?.risques?.zonage_risque },
    evaluation: { prixVenteM2: bilanValues?.salePriceEurM2Hab || undefined, prixVenteTotal: bilanValues?.caTotal || undefined, nbLogementsLibres: bilanValues?.nbLogements || undefined },
    bilan: {
      coutFoncier: bilanValues?.totalFoncier || undefined,
      coutTravaux: bilanValues?.coutTravauxBase || undefined,
      coutTravauxM2: bilanValues?.coutTravauxM2 || undefined,
      fraisFinanciers: bilanValues?.totalFin || undefined,
      fraisCommercialisation: bilanValues?.totalCom || undefined,
      fraisGestion: bilanValues?.totalEtudes || undefined,
      chiffreAffaires: (bilanValues?.caTotal || undefined) ?? (studyData?.bilan?.ca_previsionnel || undefined),
      margeNette: bilanValues?.marge ?? studyData?.bilan?.marge_nette,
      margeNettePercent: bilanValues?.margePct ?? studyData?.bilan?.taux_marge_nette_pct,
      trnRendement: (bilanValues?.caTotal && bilanValues?.coutTotal) ? (bilanValues.marge / bilanValues.coutTotal) * 100 : undefined,
      fondsPropres: undefined, creditPromoteur: undefined,
    },
  }), [studyData, bilanValues]);

  const effectiveRawInput = useMemo((): PromoteurRawInput => {
    // Priorité : override > localStorage > Supabase study > legacy props
    const base = rawInputOverride ?? rawInputFromLS ?? rawInputFromStudy ?? rawInputLegacy;

    const needsCommunePatch = !base.foncier?.commune        && snapshotFoncier.communeInsee;
    const needsSurfacePatch = !base.foncier?.surfaceTerrain && (snapshotFoncier.surfaceM2 ?? parcelData?.surface);
    const needsAdressePatch = !base.foncier?.adresse        && (parcelData?.adresse ?? parcelData?.ref);

    const needsPluMerge = pluFromLS && (
      !base.plu?.zone       ||
      !base.plu?.hauteurMax ||
      !base.plu?.pleineTerre
    );

    const needsDvfMerge = !!studyMarcheDvf;

    return {
      ...base,
      foncier: (needsCommunePatch || needsSurfacePatch || needsAdressePatch) ? {
        ...base.foncier,
        commune:        needsCommunePatch ? snapshotFoncier.communeInsee  : base.foncier?.commune,
        departement:    base.foncier?.departement ?? snapshotFoncier.communeInsee?.slice(0, 2),
        surfaceTerrain: needsSurfacePatch ? (snapshotFoncier.surfaceM2 ?? parcelData?.surface ?? undefined) : base.foncier?.surfaceTerrain,
        adresse:        needsAdressePatch ? (parcelData?.adresse ?? parcelData?.ref ?? undefined) : base.foncier?.adresse,
      } : base.foncier,
      plu: needsPluMerge ? {
        zone:        base.plu?.zone        ?? pluFromLS.zone,
        hauteurMax:  base.plu?.hauteurMax  ?? pluFromLS.hauteurMax,
        pleineTerre: base.plu?.pleineTerre ?? pluFromLS.pleineTerre,
        cub:         base.plu?.cub         ?? pluFromLS.cub,
      } : base.plu,
      marche: needsDvfMerge ? {
        ...base.marche,
        // [v4.5] Priorité DVF : evaluationDvf (EvaluationPage, scope local CP/commune)
        //   > studyMarcheDvf (Supabase market-study, scope large ~500 transactions)
        //   > undefined (honnête si aucune source)
        // On ne fallback JAMAIS sur base.marche pour les champs DVF bruts
        // car base.marche peut contenir des valeurs stale (ex: 500 du localStorage).
        nbTransactionsDvf:   evaluationDvf?.nbTransactionsDvf   ?? studyMarcheDvf!.nbTransactionsDvf,
        prixMoyenDvf:        evaluationDvf?.prixMoyenDvf        ?? studyMarcheDvf!.prixMoyenDvf,
        prixMinDvf:          studyMarcheDvf!.prixMinDvf,
        prixMaxDvf:          studyMarcheDvf!.prixMaxDvf,
        periodeDvf:          studyMarcheDvf!.periodeDvf,
        // prixAncienM2 = médian DVF local (EvaluationPage) ou médian Supabase
        prixAncienM2:        evaluationDvf?.prixMedianDvf        ?? studyMarcheDvf!.prixMedianDvf,
        // Absorption : EvaluationPage (locale) prioritaire sur Supabase (large)
        absorptionMensuelle: evaluationDvf?.absorptionMensuelle  ?? studyMarcheDvf!.absorptionMensuelle,
        // prixNeufM2 : prix de vente projet (saisie utilisateur) — jamais écrasé
        prixNeufM2:          base.marche?.prixNeufM2,
        offreConcurrente:    base.marche?.offreConcurrente,
      } : base.marche,
    };
  }, [rawInputOverride, rawInputFromLS, rawInputFromStudy, rawInputLegacy, snapshotFoncier, parcelData, pluFromLS, studyMarcheDvf, evaluationDvf]);

  const buildExportOptions = useCallback(() => ({
    facadeRenderUrl:        facadeRenderUrl          ?? undefined,
    renduTravauxUrl:        renduTravauxSynthese?.generatedImageUrl ?? undefined,
    carteScreenshot:        captureImages?.cadastre  ?? undefined,
    implantationScreenshot: captureImages?.impl2d    ?? undefined,
    massing3DScreenshot:    captureImages?.massing3d ?? undefined,
  }), [facadeRenderUrl, renduTravauxSynthese, captureImages]);

  const handleGenerate = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      await new Promise<void>(r => setTimeout(r, 60));
      const result = generatePromoteurSynthese(effectiveRawInput);
      setSynthese(result);
      await new Promise<void>(r => setTimeout(r, 40));
      const pdfResult = await exportPromoteurPdf(result, buildExportOptions());
      if (!pdfResult.success) {
        console.error('[PromoteurSynthese] Export PDF échoué:', pdfResult.error);
        setError(`PDF non généré : ${pdfResult.error ?? 'erreur inconnue'}`);
      }
    } catch (e) {
      console.error('[PromoteurSynthese] handleGenerate crash:', e);
      setError(e instanceof Error ? e.message : 'Erreur lors de la génération');
    } finally { setLoading(false); }
  }, [effectiveRawInput, buildExportOptions]);

  const handleRegenerate = useCallback(async () => {
    if (!synthese) return;
    setLoading(true); setError(null);
    try {
      await new Promise<void>(r => setTimeout(r, 40));
      const pdfResult = await exportPromoteurPdf(synthese, buildExportOptions());
      if (!pdfResult.success) {
        console.error('[PromoteurSynthese] Export PDF échoué:', pdfResult.error);
        setError(`PDF non généré : ${pdfResult.error ?? 'erreur inconnue'}`);
      }
    } catch (e) {
      console.error('[PromoteurSynthese] handleRegenerate crash:', e);
      setError(e instanceof Error ? e.message : 'Erreur lors du re-téléchargement');
    } finally { setLoading(false); }
  }, [synthese, buildExportOptions]);

  const handleComplete = useCallback(async () => {
    setCompleting(true);
    setError(null);
    setCompletionSteps([]);
    try {
      const result = await completePromoteurData({
        effectiveInput: effectiveRawInput,
        snapshotFoncier,
        parcelCenter,
        onProgress: (steps) => setCompletionSteps(steps),
      });

      try {
        localStorage.setItem(SYNTHESE_RAW_KEY, JSON.stringify(result.updatedInput));
      } catch (e) {
        console.warn('[PromoteurSynthese] Échec persistance rawInput:', e);
      }

      try {
        localStorage.setItem(AUTOCOMPLETE_DONE_KEY, JSON.stringify({
          timestamp: result.completedAt,
          studyId,
          steps: result.steps,
        }));
      } catch (e) {
        console.warn('[PromoteurSynthese] Échec persistance flag autocomplete:', e);
      }

      setAutocompleteDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la complétion');
    } finally {
      setCompleting(false);
    }
  }, [effectiveRawInput, snapshotFoncier, parcelCenter, studyId]);

  const isAnalyseInsuffisante = synthese?.executiveSummary.recommendation === 'ANALYSE_INSUFFISANTE';

  const completionSlot = synthese && isAnalyseInsuffisante ? (
    <CompletionBlock
      steps={completionSteps}
      running={completing}
      done={autocompleteDone && !completing}
      onStart={handleComplete}
    />
  ) : null;

  const userActionsRemaining = useMemo(() => {
    if (!synthese || !autocompleteDone) return [];
    return synthese.anomalies.filter(a => a.niveau === 'ALERTE' || a.niveau === 'CRITIQUE');
  }, [synthese, autocompleteDone]);

  const userActionsSlot = synthese && autocompleteDone && !completing && userActionsRemaining.length > 0 ? (
    <UserActionsBlock anomalies={userActionsRemaining} studyId={studyId} />
  ) : null;

  return (
    <div className="space-y-5">

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-700">Erreur</p>
            <p className="text-xs text-red-600 mt-0.5">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-lg leading-none flex-shrink-0">×</button>
        </div>
      )}

      {!synthese && !loading && (
        <PreGenerationView
          snapshotFoncier={snapshotFoncier}
          snapshotImpl2D={snapshotImpl2D}
          effectiveInput={effectiveRawInput}
          captures={captureImages}
          parcelCenter={parcelCenter}
          facadeRenderUrl={facadeRenderUrl}
          renduTravauxSynthese={renduTravauxSynthese}
          studyId={studyId}
          onGenerate={handleGenerate}
        />
      )}

      {loading && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-violet-100 bg-violet-50 p-4">
            <Loader2 className="h-5 w-5 text-violet-500 animate-spin flex-shrink-0" />
            <p className="text-sm font-medium text-violet-700">
              {synthese ? 'Export PDF en cours...' : 'Analyse en cours — validation des données et génération de la synthèse...'}
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
              <span className="text-sm font-semibold text-emerald-700">
                Synthèse générée — {synthese.metadata.analyseSuffisante ? 'PDF téléchargé' : 'analyse insuffisante, voir les anomalies'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleRegenerate} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 transition-colors">
                <Download className="h-3.5 w-3.5" />
                <span>Re-télécharger PDF</span>
              </button>
              <button
                onClick={() => { setSynthese(null); setCompletionSteps(null); }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  autocompleteDone
                    ? 'border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 animate-pulse'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Regénérer</span>
              </button>
            </div>
          </div>
          <SynthesePreview
            synthese={synthese}
            facadeRenderUrl={facadeRenderUrl}
            renduTravauxSynthese={renduTravauxSynthese}
            captures={captureImages}
            parcelCenter={parcelCenter}
            studyId={studyId}
            completionSlot={completionSlot}
            userActionsSlot={userActionsSlot}
          />
        </>
      )}
    </div>
  );
};