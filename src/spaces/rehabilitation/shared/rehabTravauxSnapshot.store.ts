// src/spaces/rehabilitation/shared/rehabTravauxSnapshot.store.ts
// Source de vérité partagée entre l'onglet "Simulation travaux" (TravauxPage),
// l'onglet "Planning travaux" (PlanningTravauxPage) et la "Synthèse audit"
// (SyntheseAuditPage).
//
// Singleton module + useSyncExternalStore : survit à la navigation entre onglets
// pendant la session, ET au reload grâce à la persistance userStorage scopée
// par projet actif.
//
// Clé de persistance = scopedKey("mimmoza_rehab_travaux_simulation").
// C'est LA MÊME clé que lit SyntheseAuditPage → la carte "Budget travaux" se
// remplit sans aucune modif côté Synthèse. On ajoute un alias `total` (= budgetHT)
// à la persistance pour rester compatible avec l'interface TravauxSimu lue par
// la Synthèse (dont le gate d'affichage teste `travaux.total > 0`).
//
// GARDE DE VALIDITÉ : un snapshot sans surface (surfaceM2 <= 0) n'est pas
// chiffrable (pas de €/m², planning incohérent). Il est traité comme absent
// en lecture ET purgé du storage, pour éviter d'afficher un budget "fantôme"
// issu de lots forfaitaires (MOE, packs…) alors qu'aucune surface n'est saisie.

import { useSyncExternalStore } from "react";
import { scopedKey } from "../lib/rehabScope";
import { userStorage } from "@/lib/storage/userScopedStorage";
import type {
  ChantierComplexity,
  RenovationLevel,
  TravauxRange,
} from "../../investisseur/shared/travauxSimulation.types";

export interface RehabTravauxSnapshot {
  budgetHT: number;            // result.total (HT, hors buffer)
  bufferPct: number;           // ex. 0.1
  bufferAmount: number;        // result.bufferAmount
  totalWithBuffer: number;     // result.totalWithBuffer
  costPerM2: number | null;    // result.costPerM2
  surfaceM2: number;           // surface totale prise en compte
  renovationLevel: RenovationLevel;
  complexity: ChantierComplexity;
  range: TravauxRange;
  updatedAt: string;           // ISO
}

/** Base de clé (non scopée) — scopée au projet actif via scopedKey(). */
const SNAPSHOT_KEY = "mimmoza_rehab_travaux_simulation";

let _snapshot: RehabTravauxSnapshot | null = null;
// Clé scopée pour laquelle _snapshot est valide. Sert de garde anti-projet :
// si le projet actif change (donc la clé scopée), on relit depuis userStorage.
let _hydratedKey: string | null = null;
const _listeners = new Set<() => void>();

function currentKey(): string {
  return scopedKey(SNAPSHOT_KEY);
}

/** Un snapshot n'est exploitable que s'il a une surface strictement positive. */
function isValid(s: RehabTravauxSnapshot | null): s is RehabTravauxSnapshot {
  return !!s && typeof s.surfaceM2 === "number" && s.surfaceM2 > 0;
}

function readFromStorage(key: string): RehabTravauxSnapshot | null {
  try {
    const raw = userStorage.getItem(key);
    if (!raw) return null;
    // L'alias `total` éventuellement présent est ignoré au rehydrate (le store
    // travaille avec budgetHT ; total n'existe que pour la lecture Synthèse).
    return JSON.parse(raw) as RehabTravauxSnapshot;
  } catch {
    return null;
  }
}

export function getRehabTravauxSnapshot(): RehabTravauxSnapshot | null {
  const key = currentKey();
  // Hydratation paresseuse + garde anti-projet : première lecture, ou clé
  // scopée différente (changement de projet actif) → on relit userStorage.
  // La référence retournée reste stable tant que la clé ne change pas, ce qui
  // est requis par useSyncExternalStore (pas de nouvel objet à chaque appel).
  if (_hydratedKey !== key) {
    const loaded = readFromStorage(key);
    if (isValid(loaded)) {
      _snapshot = loaded;
    } else {
      // Snapshot absent ou invalide (surface 0) : on le neutralise ET on purge
      // la clé pour ne pas laisser traîner un budget fantôme au prochain reload.
      _snapshot = null;
      if (loaded) { try { userStorage.removeItem(key); } catch { /* silent */ } }
    }
    _hydratedKey = key;
  }
  // Double garde : même un snapshot posé en mémoire via setRehabTravauxSnapshot
  // ne sort d'ici que s'il est valide.
  return isValid(_snapshot) ? _snapshot : null;
}

export function setRehabTravauxSnapshot(next: RehabTravauxSnapshot | null): void {
  const valid = isValid(next) ? next : null;
  _snapshot = valid;
  const key = currentKey();
  _hydratedKey = key;
  try {
    if (valid) {
      // Persiste le snapshot + alias `total` (= budgetHT) pour compat TravauxSimu.
      userStorage.setItem(key, JSON.stringify({ ...valid, total: valid.budgetHT }));
    } else {
      userStorage.removeItem(key);
    }
  } catch {
    /* silent : la persistance ne doit jamais casser la simulation */
  }
  _listeners.forEach(function (l) { l(); });
}

function subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  return function () { _listeners.delete(cb); };
}

/** Hook React : renvoie le dernier snapshot de simulation valide (ou null). */
export function useRehabTravauxSnapshot(): RehabTravauxSnapshot | null {
  return useSyncExternalStore(subscribe, getRehabTravauxSnapshot, function () { return null; });
}