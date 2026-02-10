// src/spaces/promoteur/shared/dataSyncHelpers.ts
// Utilitaires pour la synchronisation des données entre Foncier, PLU et Implantation2D

const LS_PLU_RESOLVED_RULESET_V1 = "mimmoza.plu.resolved_ruleset_v1";
const LS_PLU_AI_EXTRACT_RESULT = "mimmoza.plu.ai_extract_result";
const LS_PLU_USER_OVERRIDES_V1 = "mimmoza.plu.user_overrides_v1";
const LS_DETECTED_ZONE_CODE = "mimmoza.plu.detected_zone_code";
const LS_SELECTED_PLU_ZONE_CODE = "mimmoza.plu.selected_zone_code";
const LS_SELECTED_PLU_DOCUMENT_ID = "mimmoza.plu.selected_document_id";
const LS_SELECTED_PLU_COMMUNE_INSEE = "mimmoza.plu.selected_commune_insee";
const LS_SESSION_PARCEL_ID = "mimmoza.session.parcel_id";
const LS_SESSION_COMMUNE_INSEE = "mimmoza.session.commune_insee";

export type PluDataLinkage = {
  commune_insee: string;
  parcel_ids: string[];
  timestamp: string;
};

export type ResolvedRulesetWithLinkage = {
  version: string;
  commune_insee: string;
  zone_code: string;
  _linkage?: PluDataLinkage;
  [key: string]: unknown;
};

function readLS(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeLS(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
}

function removeLS(key: string): void {
  try { localStorage.removeItem(key); } catch {}
}

function safeJsonParse<T>(s: string | null): T | null {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

export function extractCommuneInseeFromParcelId(parcelId: string | null | undefined): string | null {
  if (!parcelId) return null;
  const match = parcelId.match(/^(\d{5})/);
  return match ? match[1] : null;
}

export function invalidatePluCache(): void {
  console.log("[DataSync] Invalidating PLU cache...");
  removeLS(LS_PLU_RESOLVED_RULESET_V1);
  removeLS(LS_PLU_AI_EXTRACT_RESULT);
  removeLS(LS_DETECTED_ZONE_CODE);
  removeLS(LS_SELECTED_PLU_ZONE_CODE);
  removeLS(LS_SELECTED_PLU_DOCUMENT_ID);
  removeLS(LS_SELECTED_PLU_COMMUNE_INSEE);
}

export function isPluDataConsistent(currentParcelIds: string[], currentCommuneInsee: string | null): boolean {
  if (!currentCommuneInsee) return false;
  if (currentParcelIds.length === 0) return false;
  const rulesetRaw = readLS(LS_PLU_RESOLVED_RULESET_V1);
  if (!rulesetRaw) return true;
  const ruleset = safeJsonParse<ResolvedRulesetWithLinkage>(rulesetRaw);
  if (!ruleset) return false;
  if (ruleset.commune_insee !== currentCommuneInsee) {
    console.log("[DataSync] PLU commune mismatch:", { plu: ruleset.commune_insee, current: currentCommuneInsee });
    return false;
  }
  if (ruleset._linkage) {
    const linkedParcels = ruleset._linkage.parcel_ids || [];
    const currentSet = new Set(currentParcelIds);
    const linkedSet = new Set(linkedParcels);
    if (currentSet.size !== linkedSet.size) return false;
    for (const pid of currentParcelIds) {
      if (!linkedSet.has(pid)) return false;
    }
  }
  return true;
}

export function checkAndInvalidatePluIfNeeded(currentParcelIds: string[], currentCommuneInsee: string | null): boolean {
  if (!isPluDataConsistent(currentParcelIds, currentCommuneInsee)) {
    invalidatePluCache();
    return true;
  }
  return false;
}

export function addLinkageToRuleset<T extends Record<string, unknown>>(
  ruleset: T, parcelIds: string[], communeInsee: string
): T & { _linkage: PluDataLinkage } {
  return { ...ruleset, _linkage: { commune_insee: communeInsee, parcel_ids: [...parcelIds], timestamp: new Date().toISOString() } };
}

export function persistPluRulesetWithLinkage(ruleset: Record<string, unknown>, parcelIds: string[], communeInsee: string): void {
  const withLinkage = addLinkageToRuleset(ruleset, parcelIds, communeInsee);
  writeLS(LS_PLU_RESOLVED_RULESET_V1, JSON.stringify(withLinkage));
}

export function updateSessionKeys(parcelId: string | null, communeInsee: string | null): void {
  if (parcelId) writeLS(LS_SESSION_PARCEL_ID, parcelId);
  if (communeInsee) writeLS(LS_SESSION_COMMUNE_INSEE, communeInsee);
}

export function getSessionKeys(): { parcelId: string | null; communeInsee: string | null } {
  return { parcelId: readLS(LS_SESSION_PARCEL_ID) || null, communeInsee: readLS(LS_SESSION_COMMUNE_INSEE) || null };
}

export function logDataSyncState(): void {
  console.group("[DataSync] Current state");
  console.log("Session parcel:", readLS(LS_SESSION_PARCEL_ID));
  console.log("Session commune:", readLS(LS_SESSION_COMMUNE_INSEE));
  console.log("PLU commune:", readLS(LS_SELECTED_PLU_COMMUNE_INSEE));
  console.log("PLU zone:", readLS(LS_SELECTED_PLU_ZONE_CODE));
  const ruleset = safeJsonParse<ResolvedRulesetWithLinkage>(readLS(LS_PLU_RESOLVED_RULESET_V1));
  if (ruleset) { console.log("PLU ruleset linkage:", ruleset._linkage); }
  console.groupEnd();
}
