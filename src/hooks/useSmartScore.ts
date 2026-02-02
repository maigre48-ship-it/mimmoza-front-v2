/**
 * useSmartScore Hook
 */

import { useState, useCallback } from 'react';
import {
  analyzeSourcingItem,
  computeSmartScore,
  analyzeAndScore,
  type SourcingItemNormalized,
  type GeocodeResponse,
  type AnalyzeResponse,
  type ScoreResponse,
} from '../services/sourcing.service';
import type { SmartScoreResult } from '../types/sourcing.types';

interface UseSmartScoreState {
  isAnalyzing: boolean;
  isScoring: boolean;
  isLoading: boolean;
  normalized: SourcingItemNormalized | null;
  geocode: GeocodeResponse | null;
  score: SmartScoreResult | null;
  hints: string[];
  warnings: string[];
  errors: string[];
  analyzeTimeMs: number;
  scoreTimeMs: number;
}

const initialState: UseSmartScoreState = {
  isAnalyzing: false,
  isScoring: false,
  isLoading: false,
  normalized: null,
  geocode: null,
  score: null,
  hints: [],
  warnings: [],
  errors: [],
  analyzeTimeMs: 0,
  scoreTimeMs: 0,
};

export function useSmartScore() {
  const [state, setState] = useState<UseSmartScoreState>(initialState);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  const analyze = useCallback(async (draft: any, saveToDb = false): Promise<AnalyzeResponse> => {
    setState(prev => ({ ...prev, isAnalyzing: true, isLoading: true, errors: [] }));
    const result = await analyzeSourcingItem(draft, saveToDb);
    setState(prev => ({
      ...prev,
      isAnalyzing: false,
      isLoading: prev.isScoring,
      normalized: result.normalized,
      geocode: result.geocode,
      hints: result.hints,
      warnings: [...prev.warnings, ...result.warnings],
      errors: result.success ? prev.errors : result.errors,
      analyzeTimeMs: result.processingTimeMs,
    }));
    return result;
  }, []);

  const computeScoreHook = useCallback(async (
    normalized: SourcingItemNormalized,
    geocode?: GeocodeResponse | null
  ): Promise<SmartScoreResult | null> => {
    setState(prev => ({ ...prev, isScoring: true, isLoading: true, errors: [] }));
    const result = await computeSmartScore(normalized, geocode);
    setState(prev => ({
      ...prev,
      isScoring: false,
      isLoading: false,
      score: result.score,
      warnings: [...prev.warnings, ...result.warnings],
      errors: result.success ? prev.errors : result.errors,
      scoreTimeMs: result.processingTimeMs,
    }));
    return result.score;
  }, []);

  const analyzeAndComputeScore = useCallback(async (draft: any, saveToDb = false): Promise<SmartScoreResult | null> => {
    setState(prev => ({
      ...prev,
      isAnalyzing: true,
      isScoring: true,
      isLoading: true,
      errors: [],
      warnings: [],
      hints: [],
    }));

    const result = await analyzeAndScore(draft, saveToDb);

    setState(prev => ({
      ...prev,
      isAnalyzing: false,
      isScoring: false,
      isLoading: false,
      normalized: result.analyzeResult?.normalized || null,
      geocode: result.analyzeResult?.geocode || null,
      score: result.scoreResult?.score || null,
      hints: result.analyzeResult?.hints || [],
      warnings: [
        ...(result.analyzeResult?.warnings || []),
        ...(result.scoreResult?.warnings || []),
      ],
      errors: result.errors,
      analyzeTimeMs: result.analyzeResult?.processingTimeMs || 0,
      scoreTimeMs: result.scoreResult?.processingTimeMs || 0,
    }));

    return result.scoreResult?.score || null;
  }, []);

  return {
    ...state,
    analyze,
    computeScore: computeScoreHook,
    analyzeAndComputeScore,
    reset,
  };
}
