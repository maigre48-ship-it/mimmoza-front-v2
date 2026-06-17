// =============================================================
// Mimmoza · Opportunity Engine — Hook front (V1)
// Gère : formulaire, loading, error, result, reset, submit.
// =============================================================

import { useCallback, useState } from 'react';

import { computeOpportunity } from './opportunityEngine.service';
import type {
  OpportunityAssetType,
  OpportunityInput,
  OpportunityResult,
  OpportunityStrategy,
} from './opportunityEngine.types';

export interface OpportunityFormState {
  address: string;
  city: string;
  postalCode: string;
  codeInsee: string;
  assetType: OpportunityAssetType;
  strategy: OpportunityStrategy;
  askingPrice: string;
  livingArea: string;
  landArea: string;
  description: string;
}

export const EMPTY_OPPORTUNITY_FORM: OpportunityFormState = {
  address: '',
  city: '',
  postalCode: '',
  codeInsee: '',
  assetType: 'unknown',
  strategy: 'investisseur',
  askingPrice: '',
  livingArea: '',
  landArea: '',
  description: '',
};

/** Parse tolérant : "1 250 000", "1250,5", "" → number | null. */
function parseNumber(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export interface UseOpportunityEngine {
  form: OpportunityFormState;
  setField: <K extends keyof OpportunityFormState>(
    key: K,
    value: OpportunityFormState[K],
  ) => void;
  loading: boolean;
  error: string | null;
  result: OpportunityResult | null;
  submit: () => Promise<void>;
  reset: () => void;
}

export function useOpportunityEngine(
  initial?: Partial<OpportunityFormState>,
): UseOpportunityEngine {
  const [form, setForm] = useState<OpportunityFormState>({
    ...EMPTY_OPPORTUNITY_FORM,
    ...initial,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OpportunityResult | null>(null);

  const setField = useCallback(
    <K extends keyof OpportunityFormState>(key: K, value: OpportunityFormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const reset = useCallback(() => {
    setForm({ ...EMPTY_OPPORTUNITY_FORM, ...initial });
    setResult(null);
    setError(null);
    setLoading(false);
  }, [initial]);

  const submit = useCallback(async () => {
    setError(null);

    const askingPrice = parseNumber(form.askingPrice);
    const livingArea = parseNumber(form.livingArea);
    const landArea = parseNumber(form.landArea);

    // Validation minimale : au moins un prix ou une surface.
    if (askingPrice == null && livingArea == null && landArea == null) {
      setError("Renseigne au moins un prix demandé ou une surface pour lancer l'analyse.");
      return;
    }

    const input: OpportunityInput = {
      source: 'manual',
      address: form.address.trim() || undefined,
      city: form.city.trim() || undefined,
      postalCode: form.postalCode.trim() || undefined,
      codeInsee: form.codeInsee.trim() || undefined,
      assetType: form.assetType,
      strategy: form.strategy,
      askingPrice,
      livingArea,
      landArea,
      description: form.description.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    setLoading(true);
    try {
      const r = await computeOpportunity(input);
      setResult(r);
    } catch {
      setError("Erreur lors de l'analyse de l'opportunité.");
    } finally {
      setLoading(false);
    }
  }, [form]);

  return { form, setField, loading, error, result, submit, reset };
}