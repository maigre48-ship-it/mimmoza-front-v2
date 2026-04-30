// src/spaces/promoteur/pages/syntheseComponents.tsx
// Composants additionnels pour PromoteurSynthesePage v4.0
// À importer dans PromoteurSynthesePage.tsx

import React from 'react';
import {
  AlertTriangle, XCircle, CheckCircle2, AlertCircle,
  Info, Database, ChevronRight, ShieldAlert,
} from 'lucide-react';
import type { AnomalieItem, ModuleQualite, RecommendationType, ModuleStatut, DataQualite } from '../services/promoteurSynthese.types';

// ─── Constantes couleurs ──────────────────────────────────────────────────────

export const REC_CFG: Record<RecommendationType, {
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

const ANOMALIE_CFG = {
  CRITIQUE: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', badge: 'bg-red-100 text-red-700', icon: XCircle },
  ALERTE:   { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700', icon: AlertTriangle },
  INFO:     { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-700', icon: Info },
} as const;

const STATUT_CFG: Record<ModuleStatut, { bg: string; text: string; label: string }> = {
  COMPLET:     { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'COMPLET' },
  PARTIEL:     { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'PARTIEL' },
  INSUFFISANT: { bg: 'bg-red-100',     text: 'text-red-700',     label: 'INSUFFISANT' },
};

const QUALITE_CFG: Record<DataQualite, { bg: string; border: string; text: string; label: string }> = {
  HAUTE:       { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', label: 'HAUTE' },
  MOYENNE:     { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   label: 'MOYENNE' },
  FAIBLE:      { bg: 'bg-orange-50',  border: 'border-orange-200',  text: 'text-orange-700',  label: 'FAIBLE' },
  INSUFFISANT: { bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-700',     label: 'INSUFFISANTE' },
};

// ─── RecBanner v4 ─────────────────────────────────────────────────────────────

export const RecBanner: React.FC<{
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

// ─── AnomaliesSection ─────────────────────────────────────────────────────────

export const AnomaliesSection: React.FC<{ anomalies: AnomalieItem[] }> = ({ anomalies }) => {
  if (anomalies.length === 0) return null;

  const critiques = anomalies.filter(a => a.niveau === 'CRITIQUE');
  const alertes   = anomalies.filter(a => a.niveau === 'ALERTE');
  const infos     = anomalies.filter(a => a.niveau === 'INFO');

  return (
    <div className="space-y-3">
      {/* Critiques en premier */}
      {critiques.length > 0 && (
        <div className="rounded-xl border-2 border-red-200 bg-red-50 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-red-100 border-b border-red-200">
            <XCircle className="h-4 w-4 text-red-600" />
            <span className="text-xs font-bold uppercase tracking-wider text-red-700">
              {critiques.length} Anomalie{critiques.length > 1 ? 's' : ''} critique{critiques.length > 1 ? 's' : ''} — bloque{critiques.length > 1 ? 'nt' : ''} la recommandation
            </span>
          </div>
          <div className="p-3 space-y-3">
            {critiques.map(a => (
              <AnomalieCard key={a.id} anomalie={a} />
            ))}
          </div>
        </div>
      )}

      {/* Alertes */}
      {alertes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-100 border-b border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700">
              {alertes.length} Alerte{alertes.length > 1 ? 's' : ''} — à corriger avant décision
            </span>
          </div>
          <div className="p-3 space-y-3">
            {alertes.map(a => (
              <AnomalieCard key={a.id} anomalie={a} />
            ))}
          </div>
        </div>
      )}

      {/* Infos */}
      {infos.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
          <div className="p-3 space-y-2">
            {infos.map(a => (
              <AnomalieCard key={a.id} anomalie={a} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const AnomalieCard: React.FC<{ anomalie: AnomalieItem }> = ({ anomalie }) => {
  const cfg = ANOMALIE_CFG[anomalie.niveau];
  const Icon = cfg.icon;
  return (
    <div className="flex items-start gap-3">
      <Icon className={`h-4 w-4 flex-shrink-0 mt-0.5 ${cfg.text}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.badge}`}>
            {anomalie.module}
          </span>
          <p className={`text-xs font-semibold ${cfg.text}`}>{anomalie.libelle}</p>
        </div>
        {anomalie.detail && (
          <p className={`text-xs mt-0.5 leading-relaxed ${cfg.text} opacity-75`}>{anomalie.detail}</p>
        )}
        {anomalie.actionRequise && (
          <p className={`text-xs mt-1 font-medium ${cfg.text} flex items-center gap-1`}>
            <ChevronRight className="h-3 w-3 flex-shrink-0" />
            {anomalie.actionRequise}
          </p>
        )}
      </div>
    </div>
  );
};

// ─── QualiteSection ───────────────────────────────────────────────────────────

export const QualiteSection: React.FC<{
  modules: ModuleQualite[];
  dataQualite: DataQualite;
}> = ({ modules, dataQualite }) => {
  const cfg = QUALITE_CFG[dataQualite];

  return (
    <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-slate-50">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Qualité des données</span>
        </div>
        <span className={`text-xs font-bold rounded-full px-3 py-1 border ${cfg.border} ${cfg.bg} ${cfg.text}`}>
          {cfg.label}
        </span>
      </div>

      {/* Tableau */}
      <div className="divide-y divide-slate-50">
        {modules.map(mod => {
          const sc = STATUT_CFG[mod.statut];
          return (
            <div key={mod.module} className="px-4 py-3 flex items-start gap-3">
              <div className="flex items-center gap-2 w-32 flex-shrink-0 pt-0.5">
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold ${sc.bg} ${sc.text}`}>
                  {sc.label}
                </span>
                <span className="text-xs font-semibold text-slate-600 truncate">{mod.module}</span>
              </div>
              <div className="flex-1 min-w-0">
                {mod.donneesManquantes.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {mod.donneesManquantes.map((d, i) => (
                      <span key={i} className={`inline-flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 ${
                        d.includes('CRITIQUE') ? 'bg-red-100 text-red-600 font-bold' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {d.startsWith('⚠') ? d : `— ${d}`}
                      </span>
                    ))}
                  </div>
                )}
                {mod.donneesPresentes.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {mod.donneesPresentes.map((d, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">
                        ✓ {d}
                      </span>
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
};

// ─── NON RENSEIGNÉ badge ──────────────────────────────────────────────────────

export const NonRenseigne: React.FC<{ label?: string }> = ({ label = 'NON RENSEIGNÉ' }) => (
  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold bg-red-50 text-red-500 border border-red-100">
    {label}
  </span>
);

// ─── DONNÉE MANQUANTE badge ───────────────────────────────────────────────────

export const DonneeManquante: React.FC<{ label?: string }> = ({ label = 'DONNÉE MANQUANTE' }) => (
  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-500">
    {label}
  </span>
);

// ─── Analyse Non Fiable banner ────────────────────────────────────────────────

export const AnalyseNonFiable: React.FC<{ module: string; detail?: string }> = ({ module, detail }) => (
  <div className="flex items-start gap-2 p-3 rounded-lg border border-red-100 bg-red-50/60">
    <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
    <div>
      <p className="text-xs font-bold text-red-600 uppercase tracking-wide">{module} non fiable</p>
      {detail && <p className="text-xs text-red-500 mt-0.5 leading-relaxed">{detail}</p>}
    </div>
  </div>
);