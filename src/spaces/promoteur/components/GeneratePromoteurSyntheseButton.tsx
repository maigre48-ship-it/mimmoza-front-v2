// src/spaces/promoteur/components/GeneratePromoteurSyntheseButton.tsx

import React, { useState, useCallback } from 'react';
import { FileDown, Loader2, Sparkles } from 'lucide-react';
import { generatePromoteurSynthese } from '../services/generatePromoteurSynthese';
import { exportPromoteurPdf } from '../services/exportPromoteurPdf';
import type { PromoteurRawInput, PromoteurSynthese } from '../services/promoteurSynthese.types';
import type { ReportType } from '../services/promoteurSynthese.types';

interface Props {
  rawData: PromoteurRawInput;
  reportType: ReportType;
  onGenerated?: (synthese: PromoteurSynthese) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
  className?: string;
}

type ButtonPhase = 'idle' | 'generating' | 'exporting' | 'done';

const PHASE_LABELS: Record<ButtonPhase, string> = {
  idle: 'Generer la synthese',
  generating: 'Analyse en cours?',
  exporting: 'Export PDF?',
  done: 'Synthese generee',
};

const PHASE_ICONS: Record<ButtonPhase, React.ComponentType<{ className?: string }>> = {
  idle: Sparkles,
  generating: Loader2,
  exporting: FileDown,
  done: FileDown,
};

export const GeneratePromoteurSyntheseButton: React.FC<Props> = ({
  rawData,
  reportType,
  onGenerated,
  onError,
  disabled = false,
  className = '',
}) => {
  const [phase, setPhase] = useState<ButtonPhase>('idle');

  const isLoading = phase === 'generating' || phase === 'exporting';
  const isDisabled = disabled || isLoading;

  const handleGenerate = useCallback(async () => {
    if (isDisabled) return;

    setPhase('generating');

    try {
      // Small tick to let React flush the state update before the sync work
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      const synthese = generatePromoteurSynthese(rawData);

      setPhase('exporting');

      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      exportPromoteurPdf(synthese);

      setPhase('done');
      onGenerated?.(synthese);

      // Reset after a moment
      setTimeout(() => setPhase('idle'), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la generation';
      onError?.(message);
      setPhase('idle');
    }
  }, [rawData, isDisabled, onGenerated, onError]);

  const Icon = PHASE_ICONS[phase];
  const label = PHASE_LABELS[phase];

  const reportLabel: Record<ReportType, string> = {
    banque: 'Banque',
    investisseur: 'Investisseur',
    technique: 'Technique',
  };

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={handleGenerate}
      className={[
        'group relative inline-flex items-center gap-2.5 rounded-xl px-5 py-3',
        'text-sm font-semibold transition-all duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2',
        isDisabled
          ? 'cursor-not-allowed opacity-60 bg-slate-100 text-slate-400'
          : phase === 'done'
          ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200 cursor-default'
          : [
              'bg-violet-600 text-white shadow-md shadow-violet-200',
              'hover:bg-violet-700 hover:shadow-lg hover:shadow-violet-200 hover:-translate-y-0.5',
              'active:translate-y-0 active:shadow-sm',
            ].join(' '),
        className,
      ].join(' ')}
      aria-busy={isLoading}
      aria-label={`${label} -- rapport ${reportLabel[reportType]}`}
    >
      {/* Animated background pulse during loading */}
      {isLoading && (
        <span className="absolute inset-0 rounded-xl bg-white/10 animate-pulse" />
      )}

      <Icon
        className={[
          'h-4 w-4 flex-shrink-0',
          isLoading ? 'animate-spin' : 'group-hover:scale-110 transition-transform',
        ].join(' ')}
      />

      <span className="relative">
        {label}
      </span>

      {/* Report type badge */}
      <span
        className={[
          'rounded-md px-1.5 py-0.5 text-xs font-bold',
          isDisabled
            ? 'bg-slate-200 text-slate-400'
            : phase === 'done'
            ? 'bg-emerald-400/40 text-white'
            : 'bg-white/20 text-white',
        ].join(' ')}
      >
        {reportLabel[reportType]}
      </span>

      {/* Progress indicator */}
      {isLoading && (
        <span className="absolute bottom-0 left-0 h-0.5 rounded-full bg-white/50 transition-all duration-500"
          style={{ width: phase === 'generating' ? '55%' : '95%' }}
        />
      )}
    </button>
  );
};