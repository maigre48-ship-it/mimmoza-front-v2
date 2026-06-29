// =============================================================
// Mimmoza · Opportunity Engine — Hook front (V2)
// Gère : formulaire, loading, error, result, reset, submit.
// V2 : enrichissement zone (localisation GTFS + référence DVF) AVANT scoring,
//      identique au scanner — débloque les piliers Décote marché & Localisation
//      dans le testeur manuel. Enrichissement non bloquant (échec => score sur
//      les seuls champs saisis).
// =============================================================

import { useCallback, useState } from 'react';

import { computeOpportunity } from './opportunityEngine.service';
import { resolveLocationForZone } from './opportunityLocation.service';
import { resolveMarketReference } from './opportunityMarket.service';
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

    const zip = form.postalCode.trim() || undefined;
    const city = form.city.trim() || undefined;
    const typedInsee = form.codeInsee.trim() || undefined;

    const input: OpportunityInput = {
      source: 'manual',
      address: form.address.trim() || undefined,
      city,
      postalCode: zip,
      codeInsee: typedInsee,
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
      // ── Enrichissement zone (identique au scanner), non bloquant. ─────────
      // 1) Localisation : géocodage BAN -> lat/lng + INSEE réel + mobilité GTFS.
      //    Débloque le pilier "Localisation" et fiabilise le contexte PLU.
      if (zip || city) {
        try {
          const loc = await resolveLocationForZone(zip, city);
          if (loc.latitude != null) input.latitude = loc.latitude;
          if (loc.longitude != null) input.longitude = loc.longitude;
          // INSEE résolu prioritaire sur la saisie manuelle (placeholder/erreur).
          if (loc.codeInsee) input.codeInsee = loc.codeInsee;
          if (typeof loc.mobilityScore === 'number') input.mobilityScore = loc.mobilityScore;
        } catch {
          // silencieux : on garde les champs saisis.
        }
      }

      // 2) Référence marché DVF par (zone + type) -> prix/m² médian + échantillon.
      //    Débloque le pilier "Décote marché".
      if (zip || city || input.codeInsee) {
        try {
          const market = await resolveMarketReference({
            codeInsee: input.codeInsee ?? null,
            zip,
            assetType: form.assetType,
          });
          if (market.refPriceM2 != null && market.refPriceM2 > 0) {
            input.marketRefPriceM2 = market.refPriceM2;
            input.marketSampleSize = market.sampleSize;
          }
        } catch {
          // silencieux : décote restera "en attente" si DVF indisponible.
        }
      }

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
