import { useEffect, useState } from "react";
import {
  getUserOpportunities,
  type Opportunity,
} from "../services/opportunities.service";

export function useUserOpportunities() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setLoading(true);
      const data = await getUserOpportunities();
      setOpportunities(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return {
    opportunities,
    loading,
    refresh: load,
  };
}