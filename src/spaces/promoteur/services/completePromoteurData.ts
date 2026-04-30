// src/spaces/promoteur/services/completePromoteurData.ts
// Orchestrateur séquentiel — complète automatiquement les données externes
// (foncier, marché, PLU, risques) manquantes avant régénération de la synthèse.

import { supabase } from '../../../lib/supabaseClient';
import type { PromoteurRawInput } from './promoteurSynthese.types';

export type StepId =
  | 'codepostal'
  | 'departement'
  | 'plu_reread'
  | 'market_dvf'
  | 'market_neuf'
  | 'market_absorption'
  | 'risques_georisques';

export type StepStatus = 'pending' | 'running' | 'success' | 'skipped' | 'error';

export interface CompletionStep {
  id: StepId;
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface CompletionResult {
  updatedInput: PromoteurRawInput;
  steps: CompletionStep[];
  hasErrors: boolean;
  completedAt: string;
}

interface CompleteParams {
  effectiveInput: PromoteurRawInput;
  snapshotFoncier: { communeInsee?: string; surfaceM2?: number; parcelId?: string };
  parcelCenter: { lat: number; lon: number } | null;
  onProgress: (steps: CompletionStep[]) => void;
}

const LS_PLU_RULESET = 'mimmoza.plu.resolved_ruleset_v1';
const GEORISQUES_BASE = 'https://georisques.gouv.fr/api/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function updateStep(steps: CompletionStep[], id: StepId, patch: Partial<CompletionStep>): CompletionStep[] {
  return steps.map(s => (s.id === id ? { ...s, ...patch } : s));
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Step : Code postal + département via geo.api.gouv.fr ─────────────────────
async function resolveCodePostalDept(
  communeInsee: string | undefined,
): Promise<{ codePostal?: string; departement?: string; error?: string }> {
  if (!communeInsee) return { error: 'Code INSEE commune manquant' };
  try {
    const url = `https://geo.api.gouv.fr/communes/${communeInsee}?fields=codesPostaux,departement`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const data = (await r.json()) as { codesPostaux?: string[]; departement?: { code?: string } };
    const codePostal = data.codesPostaux?.[0];
    const departement = data.departement?.code ?? communeInsee.slice(0, 2);
    return { codePostal, departement };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur réseau' };
  }
}

// ── Step : relecture PLU depuis localStorage ────────────────────────────────
function rereadPluFromLS(): {
  zone?: string;
  hauteurMax?: number;
  pleineTerre?: number;
  cub?: number;
  hasData: boolean;
} {
  try {
    const raw = localStorage.getItem(LS_PLU_RULESET);
    if (!raw) return { hasData: false };
    const r = JSON.parse(raw);
    const zone = typeof r.zone_code === 'string' && r.zone_code.trim() ? r.zone_code.trim() : undefined;
    const hauteurMax = typeof r.hauteur?.max_m === 'number' ? r.hauteur.max_m : undefined;
    const pleineTerre = typeof r.pleine_terre?.ratio_min === 'number' ? r.pleine_terre.ratio_min : undefined;
    const cub = typeof r.ces?.max_ratio === 'number' ? r.ces.max_ratio : undefined;
    const hasData = !!(zone || hauteurMax !== undefined || pleineTerre !== undefined || cub !== undefined);
    return { zone, hauteurMax, pleineTerre, cub, hasData };
  } catch {
    return { hasData: false };
  }
}

// ── Step : market-study-promoteur-v1 ────────────────────────────────────────
interface MarketStudyResponse {
  success: boolean;
  core?: {
    dvf?: {
      nb_transactions?: number;
      prix_m2_median?: number | null;
      prix_m2_moyen?: number | null;
      absorption_mensuelle?: number | null;
      absorption_annuelle?: number | null;
    };
  };
  error?: string;
}

async function callMarketStudy(
  communeInsee: string | undefined,
  parcelCenter: { lat: number; lon: number } | null,
): Promise<{ data?: MarketStudyResponse['core']; error?: string }> {
  if (!communeInsee && !parcelCenter) return { error: 'Ni commune ni coordonnées disponibles' };
  try {
    const body: Record<string, unknown> = { project_type: 'logement' };
    if (communeInsee) body.commune_insee = communeInsee;
    if (parcelCenter) { body.lat = parcelCenter.lat; body.lon = parcelCenter.lon; }
    const { data, error } = await supabase.functions.invoke<MarketStudyResponse>(
      'market-study-promoteur-v1',
      { body },
    );
    if (error) return { error: error.message ?? 'Erreur Edge Function' };
    if (!data?.success) return { error: data?.error ?? 'Réponse invalide' };
    return { data: data.core };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur réseau' };
  }
}

// ── Step : GeoRisques direct (inondation, sismicité, mvt terrain, radon) ────
interface GeoRisquesResult {
  risquesIdentifies: string[];
  zonageRisque?: string;
  error?: string;
}

async function callGeoRisques(
  parcelCenter: { lat: number; lon: number } | null,
  communeInsee: string | undefined,
): Promise<GeoRisquesResult> {
  if (!parcelCenter) {
    return { risquesIdentifies: [], error: 'Coordonnées indisponibles' };
  }

  const { lat, lon } = parcelCenter;
  const latlon = `${lon},${lat}`;
  const rayon = 500;

  const endpoints: Array<{ key: string; url: string }> = [
    { key: 'catnat',  url: `${GEORISQUES_BASE}/gaspar/catnat?latlon=${encodeURIComponent(latlon)}&rayon=${rayon}` },
    { key: 'risques', url: `${GEORISQUES_BASE}/gaspar/risques?latlon=${encodeURIComponent(latlon)}&rayon=${rayon}` },
  ];
  if (communeInsee) {
    endpoints.push({ key: 'radon', url: `${GEORISQUES_BASE}/radon?code_insee=${communeInsee}` });
  }

  const results: Record<string, any> = {};
  try {
    await Promise.all(
      endpoints.map(async (e) => {
        try {
          const r = await fetch(e.url, {
            signal: AbortSignal.timeout(6000),
            headers: { Accept: 'application/json' },
          });
          if (r.ok) results[e.key] = await r.json();
        } catch {
          // CORS / timeout — on ignore silencieusement, l'étape reportera partiel
        }
      }),
    );
  } catch (e) {
    return { risquesIdentifies: [], error: e instanceof Error ? e.message : 'GeoRisques inaccessible' };
  }

  // Extraction des libellés
  const risquesIdentifies: string[] = [];
  const risquesLabels: string[] = [];

  try {
    const details = results.risques?.data?.[0]?.risques_detail ?? [];
    for (const d of details) {
      const lbl = d?.libelle_risque_long ?? d?.libelle ?? d?.label ?? null;
      if (lbl) risquesLabels.push(String(lbl));
    }
  } catch { /* ignore */ }

  const has = (needle: string) => risquesLabels.some(x => x.toLowerCase().includes(needle));

  if (has('inond'))     risquesIdentifies.push('Risque inondation identifié');
  if (has('sism'))      risquesIdentifies.push('Zone sismique');
  if (has('mouvement') || has('glissement') || has('eboul')) {
    risquesIdentifies.push('Mouvement de terrain');
  }
  if (has('argile') || has('retrait'))  risquesIdentifies.push('Retrait-gonflement argiles');
  if (has('feu') || has('incendie'))    risquesIdentifies.push('Risque feu de forêt');

  // Radon
  try {
    const radonClasse = results.radon?.data?.[0]?.classe_potentiel;
    if (radonClasse === 3 || radonClasse === '3') risquesIdentifies.push('Radon : potentiel élevé');
    else if (radonClasse === 2 || radonClasse === '2') risquesIdentifies.push('Radon : potentiel modéré');
  } catch { /* ignore */ }

  // CatNat
  let zonageRisque: string | undefined;
  try {
    const catnatList = results.catnat?.data;
    if (Array.isArray(catnatList) && catnatList.length > 0) {
      zonageRisque = `Zone ayant connu ${catnatList.length} arrêté(s) CatNat`;
    }
  } catch { /* ignore */ }

  if (risquesIdentifies.length === 0 && !zonageRisque) {
    risquesIdentifies.push('Aucun risque majeur identifié via GeoRisques');
  }

  return { risquesIdentifies, zonageRisque };
}

// ── Orchestrateur principal ─────────────────────────────────────────────────

export async function completePromoteurData(params: CompleteParams): Promise<CompletionResult> {
  const { effectiveInput, snapshotFoncier, parcelCenter, onProgress } = params;
  const communeInsee = effectiveInput.foncier?.commune ?? snapshotFoncier.communeInsee;

  let steps: CompletionStep[] = [
    { id: 'codepostal',          label: 'Code postal',          status: 'pending' },
    { id: 'departement',         label: 'Département',          status: 'pending' },
    { id: 'plu_reread',          label: 'Relecture PLU',        status: 'pending' },
    { id: 'market_dvf',          label: 'Transactions DVF',     status: 'pending' },
    { id: 'market_neuf',         label: 'Prix de marché neuf',  status: 'pending' },
    { id: 'market_absorption',   label: 'Absorption mensuelle', status: 'pending' },
    { id: 'risques_georisques',  label: 'Analyse des risques',  status: 'pending' },
  ];
  const emit = () => onProgress([...steps]);
  emit();

  const updatedInput: PromoteurRawInput = JSON.parse(JSON.stringify(effectiveInput));
  let hasErrors = false;

  // ── 1 & 2 : Code postal + département ─────────────────────────────────────
  steps = updateStep(steps, 'codepostal', { status: 'running' });
  steps = updateStep(steps, 'departement', { status: 'running' });
  emit();
  await sleep(150);

  if (updatedInput.foncier?.codePostal && updatedInput.foncier?.departement) {
    steps = updateStep(steps, 'codepostal', { status: 'skipped', detail: 'Déjà renseigné' });
    steps = updateStep(steps, 'departement', { status: 'skipped', detail: 'Déjà renseigné' });
  } else {
    const { codePostal, departement, error } = await resolveCodePostalDept(communeInsee);
    updatedInput.foncier = {
      ...(updatedInput.foncier ?? {}),
      codePostal: updatedInput.foncier?.codePostal ?? codePostal,
      departement: updatedInput.foncier?.departement ?? departement,
    };
    if (error) {
      steps = updateStep(steps, 'codepostal', { status: 'error', detail: error });
      steps = updateStep(steps, 'departement', { status: 'error', detail: error });
      hasErrors = true;
    } else {
      steps = updateStep(steps, 'codepostal',
        codePostal ? { status: 'success', detail: codePostal } : { status: 'skipped', detail: 'Non disponible' });
      steps = updateStep(steps, 'departement',
        departement ? { status: 'success', detail: departement } : { status: 'skipped', detail: 'Non disponible' });
    }
  }
  emit();
  await sleep(200);

  // ── 3 : Relecture PLU ─────────────────────────────────────────────────────
  steps = updateStep(steps, 'plu_reread', { status: 'running' });
  emit();
  await sleep(250);

  const plu = rereadPluFromLS();
  if (plu.hasData) {
    updatedInput.plu = {
      zone: updatedInput.plu?.zone ?? plu.zone,
      hauteurMax: updatedInput.plu?.hauteurMax ?? plu.hauteurMax,
      pleineTerre: updatedInput.plu?.pleineTerre ?? plu.pleineTerre,
      cub: updatedInput.plu?.cub ?? plu.cub,
    };
    const parts: string[] = [];
    if (plu.zone !== undefined) parts.push(`zone ${plu.zone}`);
    if (plu.hauteurMax !== undefined) parts.push(`H max ${plu.hauteurMax} m`);
    if (plu.pleineTerre !== undefined) parts.push(`PT ${Math.round(plu.pleineTerre * 100)}%`);
    if (plu.cub !== undefined) parts.push(`CES ${plu.cub}`);
    steps = updateStep(steps, 'plu_reread', { status: 'success', detail: parts.join(' · ') || 'Relu' });
  } else {
    steps = updateStep(steps, 'plu_reread', { status: 'skipped', detail: 'Aucune donnée — extraire depuis la page PLU' });
  }
  emit();
  await sleep(200);

  // ── 4, 5, 6 : Market study ────────────────────────────────────────────────
  steps = updateStep(steps, 'market_dvf', { status: 'running' });
  emit();

  const market = await callMarketStudy(communeInsee, parcelCenter);

  if (market.error) {
    steps = updateStep(steps, 'market_dvf', { status: 'error', detail: market.error });
    steps = updateStep(steps, 'market_neuf', { status: 'error', detail: market.error });
    steps = updateStep(steps, 'market_absorption', { status: 'error', detail: market.error });
    hasErrors = true;
    emit();
  } else {
    const dvf = market.data?.dvf;
    const nbTx = dvf?.nb_transactions ?? 0;
    const prixMedian = dvf?.prix_m2_median ?? null;
    const prixMoyen = dvf?.prix_m2_moyen ?? null;

    if (nbTx > 0 && prixMedian) {
      updatedInput.marche = {
        ...(updatedInput.marche ?? {}),
        prixAncienM2: updatedInput.marche?.prixAncienM2 ?? prixMedian,
        prixMoyenDvf: updatedInput.marche?.prixMoyenDvf ?? prixMoyen ?? prixMedian,
        nbTransactionsDvf: updatedInput.marche?.nbTransactionsDvf ?? nbTx,
      };
      steps = updateStep(steps, 'market_dvf', {
        status: 'success',
        detail: `${nbTx} transactions · ${prixMedian.toLocaleString('fr-FR')} €/m²`,
      });
    } else {
      steps = updateStep(steps, 'market_dvf', { status: 'skipped', detail: 'Aucune transaction DVF' });
    }
    emit();
    await sleep(200);

    steps = updateStep(steps, 'market_neuf', { status: 'running' });
    emit();
    await sleep(250);
    if (updatedInput.marche?.prixNeufM2) {
      steps = updateStep(steps, 'market_neuf', {
        status: 'skipped',
        detail: `Déjà renseigné : ${updatedInput.marche.prixNeufM2.toLocaleString('fr-FR')} €/m²`,
      });
    } else if (prixMedian) {
      const prixNeuf = Math.round(prixMedian * 1.2);
      updatedInput.marche = { ...(updatedInput.marche ?? {}), prixNeufM2: prixNeuf };
      steps = updateStep(steps, 'market_neuf', {
        status: 'success',
        detail: `${prixNeuf.toLocaleString('fr-FR')} €/m² (estimé +20% sur ancien)`,
      });
    } else {
      steps = updateStep(steps, 'market_neuf', { status: 'skipped', detail: 'Base DVF insuffisante' });
    }
    emit();
    await sleep(200);

    steps = updateStep(steps, 'market_absorption', { status: 'running' });
    emit();
    await sleep(250);
    const absMois = dvf?.absorption_mensuelle ?? null;
    if (absMois != null && absMois > 0) {
      updatedInput.marche = { ...(updatedInput.marche ?? {}), absorptionMensuelle: absMois };
      steps = updateStep(steps, 'market_absorption', {
        status: 'success',
        detail: `${absMois} transaction${absMois > 1 ? 's' : ''}/mois (département)`,
      });
    } else {
      steps = updateStep(steps, 'market_absorption', { status: 'skipped', detail: 'Non calculable' });
    }
    emit();
    await sleep(200);
  }

  // ── 7 : Analyse des risques (GeoRisques direct) ───────────────────────────
  steps = updateStep(steps, 'risques_georisques', { status: 'running' });
  emit();
  await sleep(250);

  const existingRisques = updatedInput.risques?.risquesIdentifies ?? [];
  const existingZonage = updatedInput.risques?.zonageRisque;

  if (existingRisques.length > 0 && existingZonage) {
    steps = updateStep(steps, 'risques_georisques', {
      status: 'skipped',
      detail: `${existingRisques.length} risque(s) déjà identifié(s)`,
    });
  } else {
    const risques = await callGeoRisques(parcelCenter, communeInsee);
    if (risques.error) {
      steps = updateStep(steps, 'risques_georisques', { status: 'error', detail: risques.error });
      hasErrors = true;
    } else {
      updatedInput.risques = {
        ...(updatedInput.risques ?? {}),
        risquesIdentifies: existingRisques.length > 0 ? existingRisques : risques.risquesIdentifies,
        zonageRisque: existingZonage ?? risques.zonageRisque,
      };
      const detail = risques.risquesIdentifies.length > 0
        ? `${risques.risquesIdentifies.length} risque(s) identifié(s)`
        : 'Aucun risque majeur';
      steps = updateStep(steps, 'risques_georisques', { status: 'success', detail });
    }
  }
  emit();

  return {
    updatedInput,
    steps,
    hasErrors,
    completedAt: new Date().toISOString(),
  };
}