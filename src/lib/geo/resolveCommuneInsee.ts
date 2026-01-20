export async function resolveCommuneInseeFromAddress(params: {
  address?: string | null;
  cp?: string | null;
  ville?: string | null;
}): Promise<string | null> {
  const address = (params.address ?? "").trim();
  const cp = (params.cp ?? "").trim();
  const ville = (params.ville ?? "").trim();

  // 1) BAN (API Adresse) — le plus fiable car renvoie citycode (INSEE)
  try {
    const q = encodeURIComponent([address, cp, ville].filter(Boolean).join(" "));
    if (q.length >= 4) {
      const url = `https://api-adresse.data.gouv.fr/search/?q=${q}&limit=1`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        const citycode = data?.features?.[0]?.properties?.citycode;
        if (typeof citycode === "string" && citycode.length === 5) return citycode;
      }
    }
  } catch {
    // ignore
  }

  // 2) Fallback Geo API Gouv (moins précis, CP peut matcher plusieurs communes)
  try {
    if (cp) {
      const url = `https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(cp)}&nom=${encodeURIComponent(ville || "")}&fields=code,nom&format=json&geometry=centre`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        const code = data?.[0]?.code;
        if (typeof code === "string" && code.length === 5) return code;
      }
    }
  } catch {
    // ignore
  }

  return null;
}
