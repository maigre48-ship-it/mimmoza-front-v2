import type {
  PermisConstruireItem,
  PermisConstruireProjectType,
  PermisConstruireSortKey,
  PermisConstruireSortOrder,
  PermisConstruireStatut,
  PermisConstruireTypeAutorisation,
} from "../types/permisConstruire.types";

const FALLBACK = "Non renseigné";
const FALLBACK_DISTANCE = "—";

export function formatDistance(km: number | null | undefined): string {
  if (km === null || km === undefined || Number.isNaN(km)) return FALLBACK_DISTANCE;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return FALLBACK;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return FALLBACK;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatInteger(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return FALLBACK;
  return n.toLocaleString("fr-FR");
}

export function formatSurface(m2: number | null | undefined): string {
  if (m2 === null || m2 === undefined || Number.isNaN(m2)) return FALLBACK;
  return `${Math.round(m2).toLocaleString("fr-FR")} m²`;
}

export function formatText(v: string | null | undefined): string {
  if (!v || !v.trim()) return FALLBACK;
  return v;
}

const LABEL_TYPE: Record<PermisConstruireTypeAutorisation, string> = {
  PC: "Permis de construire",
  PA: "Permis d'aménager",
  PD: "Permis de démolir",
  DP: "Déclaration préalable",
};

export function formatTypeAutorisation(
  t: PermisConstruireTypeAutorisation | null | undefined,
): string {
  if (!t) return FALLBACK;
  return LABEL_TYPE[t] ?? t;
}

const LABEL_TYPOLOGIE: Record<PermisConstruireProjectType, string> = {
  logement_individuel: "Logement individuel",
  logement_collectif: "Logement collectif",
  logement_mixte: "Logement mixte",
  activite: "Activité",
  tous: "Tous",
};

export function formatTypologie(
  t: PermisConstruireProjectType | null | undefined,
): string {
  if (!t) return FALLBACK;
  return LABEL_TYPOLOGIE[t] ?? t;
}

const LABEL_STATUT: Record<PermisConstruireStatut, string> = {
  depose: "Déposé",
  en_instruction: "En instruction",
  accorde: "Accordé",
  refuse: "Refusé",
  retire: "Retiré",
  inconnu: "Inconnu",
};

export function formatStatut(s: PermisConstruireStatut | null | undefined): string {
  if (!s) return FALLBACK;
  return LABEL_STATUT[s] ?? s;
}

/**
 * Tri explicite, stable (décoration/index), sans logique cachée.
 * Les items dont la valeur de tri est absente sont relégués en fin
 * de liste pour les tris ascendants.
 */
export function sortPermis(
  items: PermisConstruireItem[],
  by: PermisConstruireSortKey,
  order: PermisConstruireSortOrder = "asc",
): PermisConstruireItem[] {
  const mul = order === "asc" ? 1 : -1;

  const value = (it: PermisConstruireItem): number => {
    switch (by) {
      case "distance":
        return it.distanceKm ?? Number.POSITIVE_INFINITY;
      case "date": {
        if (!it.dateDepot) return order === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
        const t = new Date(it.dateDepot).getTime();
        return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
      }
      case "logements":
        return it.nombreLogements ?? (order === "asc" ? Number.POSITIVE_INFINITY : -1);
      case "surface":
        return it.surface ?? (order === "asc" ? Number.POSITIVE_INFINITY : -1);
      default:
        return 0;
    }
  };

  return items
    .map((it, i) => ({ it, i, v: value(it) }))
    .sort((a, b) => {
      const diff = (a.v - b.v) * mul;
      return diff !== 0 ? diff : a.i - b.i;
    })
    .map((x) => x.it);
}