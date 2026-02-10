/**
 * useBanqueAlerts.ts
 *
 * Hook React pour consommer le moteur d'alertes banque.
 * Fournit state réactif + actions (runAlerts, acknowledge, seed demo).
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  type BanqueSnapshot,
  type BanqueAlert,
  type AlertSeverity,
  type RunAlertsOptions,
  readBanqueSnapshot,
  runAndPersistAlerts,
  acknowledgeAlert,
  getAllAlerts,
  getAlertStats,
  seedDemoDossiers,
} from "../services/banqueAlerts";

export interface UseBanqueAlertsReturn {
  snapshot: BanqueSnapshot;
  alerts: BanqueAlert[];
  stats: ReturnType<typeof getAlertStats>;
  /** Filtres actifs */
  filters: AlertFilters;
  setFilters: (f: Partial<AlertFilters>) => void;
  /** Alertes après application des filtres */
  filteredAlerts: BanqueAlert[];
  /** Recalcule toutes les alertes */
  recalculate: (opts?: RunAlertsOptions) => void;
  /** Acquitte une alerte */
  acknowledge: (dossierId: string, alertId: string) => void;
  /** Charge les dossiers de démo */
  seedDemo: () => void;
  /** Refresh depuis localStorage */
  refresh: () => void;
  /** Timestamp du dernier calcul */
  lastRun: string | null;
}

export interface AlertFilters {
  severity: AlertSeverity | "all";
  dossierId: string | "all";
  ruleKey: string | "all";
  acknowledged: "all" | "yes" | "no";
  search: string;
}

const defaultFilters: AlertFilters = {
  severity: "all",
  dossierId: "all",
  ruleKey: "all",
  acknowledged: "all",
  search: "",
};

export function useBanqueAlerts(): UseBanqueAlertsReturn {
  const [snapshot, setSnapshot] = useState<BanqueSnapshot>(() => readBanqueSnapshot());
  const [filters, setFiltersState] = useState<AlertFilters>(defaultFilters);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setSnapshot(readBanqueSnapshot());
  }, []);

  // Écouter les changements localStorage (multi-onglet)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "mimmoza.banque.snapshot.v1") {
        refresh();
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [refresh]);

  const alerts = useMemo(() => getAllAlerts(snapshot), [snapshot]);
  const stats = useMemo(() => getAlertStats(snapshot), [snapshot]);

  const filteredAlerts = useMemo(() => {
    let result = alerts;
    if (filters.severity !== "all") {
      result = result.filter((a) => a.severity === filters.severity);
    }
    if (filters.dossierId !== "all") {
      result = result.filter((a) => a.dossierId === filters.dossierId);
    }
    if (filters.ruleKey !== "all") {
      result = result.filter((a) => a.ruleKey === filters.ruleKey);
    }
    if (filters.acknowledged === "yes") {
      result = result.filter((a) => !!a.acknowledgedAt);
    } else if (filters.acknowledged === "no") {
      result = result.filter((a) => !a.acknowledgedAt);
    }
    if (filters.search.trim()) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.message.toLowerCase().includes(q) ||
          a.dossierId.toLowerCase().includes(q)
      );
    }
    return result;
  }, [alerts, filters]);

  const setFilters = useCallback((patch: Partial<AlertFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }));
  }, []);

  const recalculate = useCallback((opts?: RunAlertsOptions) => {
    const updated = runAndPersistAlerts(opts);
    setSnapshot(updated);
    setLastRun(new Date().toISOString());
  }, []);

  const acknowledge = useCallback((dossierId: string, alertId: string) => {
    const updated = acknowledgeAlert(dossierId, alertId);
    setSnapshot(updated);
  }, []);

  const seedDemo = useCallback(() => {
    const snap = seedDemoDossiers();
    setSnapshot(snap);
    setLastRun(new Date().toISOString());
  }, []);

  return {
    snapshot,
    alerts,
    stats,
    filters,
    setFilters,
    filteredAlerts,
    recalculate,
    acknowledge,
    seedDemo,
    refresh,
    lastRun,
  };
}