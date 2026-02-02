/**
 * Sourcing API Service
 */

import { supabase } from '../lib/supabaseClient';
import type { SmartScoreResult } from '../types/sourcing.types';

const FUNCTIONS_BASE_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1';

export interface SourcingItemNormalized {
  profileTarget: string;
  location: any;
  input: any;
  quartier: any;
  normalizedAt: string;
  version: string;
}

export interface GeocodeResponse {
  bestMatch: any;
  alternatives: any[];
  query: string;
  source: string;
  fetchedAt: string;
}

export interface AnalyzeResponse {
  success: boolean;
  normalized: SourcingItemNormalized | null;
  geocode: GeocodeResponse | null;
  hints: string[];
  warnings: string[];
  errors: string[];
  processingTimeMs: number;
}

export interface ScoreResponse {
  success: boolean;
  score: SmartScoreResult | null;
  warnings: string[];
  errors: string[];
  processingTimeMs: number;
}

export async function analyzeSourcingItem(draft: any, saveToDb = false): Promise<AnalyzeResponse> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;

    const response = await fetch(`${FUNCTIONS_BASE_URL}/sourcing-analyze-v1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ draft, saveToDb }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.errors?.[0] || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[analyzeSourcingItem] Error:', error);
    return {
      success: false,
      normalized: null,
      geocode: null,
      hints: [],
      warnings: [],
      errors: [error instanceof Error ? error.message : 'Erreur inconnue'],
      processingTimeMs: 0,
    };
  }
}

export async function computeSmartScore(
  normalized: SourcingItemNormalized,
  geocode?: GeocodeResponse | null
): Promise<ScoreResponse> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;

    const response = await fetch(`${FUNCTIONS_BASE_URL}/sourcing-score-v1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ normalized, geocode }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.errors?.[0] || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[computeSmartScore] Error:', error);
    return {
      success: false,
      score: null,
      warnings: [],
      errors: [error instanceof Error ? error.message : 'Erreur inconnue'],
      processingTimeMs: 0,
    };
  }
}

export async function analyzeAndScore(draft: any, saveToDb = false): Promise<{
  success: boolean;
  analyzeResult: AnalyzeResponse | null;
  scoreResult: ScoreResponse | null;
  errors: string[];
}> {
  const analyzeResult = await analyzeSourcingItem(draft, saveToDb);

  if (!analyzeResult.success || !analyzeResult.normalized) {
    return {
      success: false,
      analyzeResult,
      scoreResult: null,
      errors: analyzeResult.errors,
    };
  }

  const scoreResult = await computeSmartScore(analyzeResult.normalized, analyzeResult.geocode);

  return {
    success: scoreResult.success,
    analyzeResult,
    scoreResult,
    errors: [...analyzeResult.errors, ...scoreResult.errors],
  };
}
