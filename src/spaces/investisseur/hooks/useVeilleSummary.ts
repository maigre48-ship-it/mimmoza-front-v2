import { useEffect, useState } from "react";
import { getVeilleSummary } from "../services/veille.service";
import type { VeilleSummary } from "../services/veille.service";

export function useVeilleSummary() {
  const [data, setData] = useState<VeilleSummary | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await getVeilleSummary();
    setData(res);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  return {
    data,
    loading,
    refresh: load,
  };
}