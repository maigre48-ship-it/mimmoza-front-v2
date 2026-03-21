// src/spaces/promoteur/components/PromoteurSyntheseReportSelector.tsx
import type { ReportType } from '../services/promoteurSynthese.types';

import React from 'react';
import {
  Building2,
  TrendingUp,
  HardHat,
  ChevronRight,
} from 'lucide-react';



interface ReportCardDef {
  type: ReportType;
  label: string;
  subtitle: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  sections: string[];
  badge: string;
}

const REPORT_CARDS: ReportCardDef[] = [
  {
    type: 'banque',
    label: 'Banque / Credit',
    subtitle: 'Comite d\'engagement',
    description: 'Dossier structure pour presentation en comite bancaire ou credit promoteur.',
    icon: Building2,
    sections: ['Bilan financier', 'Risques & garanties', 'Plan de financement', 'Stress tests'],
    badge: 'Credit promoteur',
  },
  {
    type: 'investisseur',
    label: 'Investisseur',
    subtitle: 'Comite d\'investissement',
    description: 'Synthese orientee rentabilite, positionnement marche et retour sur investissement.',
    icon: TrendingUp,
    sections: ['Etude de marche', 'Marge & TRN', 'Scenarios', 'Executive summary'],
    badge: 'Capital & rendement',
  },
  {
    type: 'technique',
    label: 'Technique',
    subtitle: 'Faisabilite & reglementation',
    description: 'Analyse reglementaire approfondie, contraintes PLU et faisabilite architecturale.',
    icon: HardHat,
    sections: ['Contraintes PLU', 'Gabarit & reculs', 'Programme architectural', 'Risques techniques'],
    badge: 'PLU & conception',
  },
];

interface Props {
  value: ReportType;
  onChange: (value: ReportType) => void;
  disabled?: boolean;
}

export const PromoteurSyntheseReportSelector: React.FC<Props> = ({
  value,
  onChange,
  disabled = false,
}) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-5 rounded-full bg-violet-500" />
        <p className="text-sm font-semibold text-slate-700 uppercase tracking-widest">
          Type de rapport
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {REPORT_CARDS.map((card) => {
          const Icon = card.icon;
          const isSelected = value === card.type;

          return (
            <button
              key={card.type}
              type="button"
              disabled={disabled}
              onClick={() => onChange(card.type)}
              className={[
                'group relative flex flex-col text-left rounded-xl border-2 p-4 transition-all duration-200',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2',
                disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                isSelected
                  ? 'border-violet-500 bg-violet-50 shadow-md shadow-violet-100'
                  : 'border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50/40 hover:shadow-sm',
              ].join(' ')}
              aria-pressed={isSelected}
            >
              {/* Selected indicator */}
              {isSelected && (
                <span className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-violet-500">
                  <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}

              {/* Icon */}
              <div
                className={[
                  'flex h-10 w-10 items-center justify-center rounded-lg mb-3 transition-colors',
                  isSelected
                    ? 'bg-violet-500 text-white'
                    : 'bg-slate-100 text-slate-500 group-hover:bg-violet-100 group-hover:text-violet-600',
                ].join(' ')}
              >
                <Icon className="h-5 w-5" />
              </div>

              {/* Label & badge */}
              <div className="flex items-start justify-between gap-2 mb-1">
                <span
                  className={[
                    'text-sm font-bold leading-tight',
                    isSelected ? 'text-violet-700' : 'text-slate-800',
                  ].join(' ')}
                >
                  {card.label}
                </span>
              </div>

              <span
                className={[
                  'text-xs font-medium mb-2',
                  isSelected ? 'text-violet-500' : 'text-slate-400',
                ].join(' ')}
              >
                {card.subtitle}
              </span>

              <p className="text-xs text-slate-500 leading-relaxed mb-3 flex-1">
                {card.description}
              </p>

              {/* Sections list */}
              <ul className="space-y-1">
                {card.sections.map((s) => (
                  <li key={s} className="flex items-center gap-1.5 text-xs text-slate-400">
                    <ChevronRight
                      className={[
                        'h-3 w-3 flex-shrink-0',
                        isSelected ? 'text-violet-400' : 'text-slate-300',
                      ].join(' ')}
                    />
                    {s}
                  </li>
                ))}
              </ul>

              {/* Badge */}
              <div className="mt-3 pt-3 border-t border-dashed border-slate-200">
                <span
                  className={[
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                    isSelected
                      ? 'bg-violet-100 text-violet-700'
                      : 'bg-slate-100 text-slate-500',
                  ].join(' ')}
                >
                  {card.badge}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};