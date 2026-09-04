// ──────────────────────────────────────────────────────────────────────────────
// ecbRate.service.ts — CACHE NAVIGATEUR au-dessus de la logique BCE partagée
// ──────────────────────────────────────────────────────────────────────────────
//
// Ce fichier contenait deux choses mêlées : la logique BCE (récupération des
// séries, analyse de pression et de tendance, repli) et un cache localStorage.
// La logique est partie dans supabase/functions/_shared/predictive/ecb.ts pour
// que les edge functions puissent l'utiliser — localStorage n'existe pas côté
// Deno, et c'était le seul obstacle au partage.
//
// Il ne reste ici QUE le cache navigateur, qui n'a de sens que dans le front :
// éviter de rappeler l'API BCE à chaque montage de la page prédictive.
//
// La signature publique est inchangée : les appelants existants n'ont rien à
// modifier.
// ──────────────────────────────────────────────────────────────────────────────

import { userStorage } from "@/lib/storage/userScopedStorage";
import { fetchEcbRatesAnalysis } from "@shared/predictive/ecb.ts";
import type { EcbRatesAnalysis } from "@shared/predictive/ecb.ts";

export type { RateTrend, EcbRatePoint, EcbRatesAnalysis } from "@shared/predictive/ecb.ts";

const CACHE_KEY = "mimmoza.ecb.rates_analysis";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 h

interface CachedAnalysis {
  data: EcbRatesAnalysis;
  cachedAt: number;
}

function readCache(): EcbRatesAnalysis | null {
  try {
    const raw = userStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAnalysis;
    if (!parsed?.data || !parsed?.cachedAt) return null;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data: EcbRatesAnalysis): void {
  try {
    const entry: CachedAnalysis = { data, cachedAt: Date.now() };
    userStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* quota dépassé — non bloquant */
  }
}

/**
 * Récupère et analyse les taux directeurs BCE.
 *
 * Cascade : cache local (12 h) → API BCE → repli interne.
 *
 * ⚠️ Le repli est mis en cache lui aussi, volontairement : sans cela, une API
 * BCE durablement injoignable ferait repartir un appel réseau à chaque montage
 * de la page. Le champ `source` distingue toujours `"ecb"` de `"fallback"` —
 * l'affichage DOIT s'en servir, un taux de repli n'est pas un taux constaté.
 */
export async function getEcbRatesAnalysis(): Promise<EcbRatesAnalysis> {
  const cached = readCache();
  if (cached) return cached;

  const analysis = await fetchEcbRatesAnalysis();
  writeCache(analysis);
  return analysis;
}

/**
 * Lecture synchrone du cache uniquement.
 * Renvoie null si rien en cache — appeler getEcbRatesAnalysis() d'abord.
 */
export function readEcbRatesAnalysisSync(): EcbRatesAnalysis | null {
  return readCache();
}
