import { useEffect, useState } from "react";
import { getUserWatchlists } from "../services/watchlists.service";
import type { UserWatchlist } from "../services/watchlists.service";

export function useUserWatchlists() {
  const [watchlists, setWatchlists] = useState<UserWatchlist[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const data = await getUserWatchlists();
    setWatchlists(data);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  return {
    watchlists,
    loading,
    refresh: load,
  };
}