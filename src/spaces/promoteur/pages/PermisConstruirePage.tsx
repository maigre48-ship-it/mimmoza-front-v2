import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type {
  PermisConstruireProjectType,
  PermisConstruireSearchParams,
  PermisConstruireSortKey,
  PermisConstruireSortOrder,
  PermisConstruireStatut,
  PermisConstruireTypeAutorisation,
} from "../types/permisConstruire.types";
import { usePermisConstruire } from "../hooks/usePermisConstruire";
import {
  formatDate,
  formatDistance,
  formatInteger,
  formatStatut,
  formatSurface,
  formatText,
  formatTypeAutorisation,
  formatTypologie,
  sortPermis,
} from "../utils/permisConstruire.format";
import type { CommuneSuggestion } from "../utils/communeResolver";
import { getCommuneByLatLon } from "../utils/communeResolver";
import { CommuneAutocomplete } from "../components/CommuneAutocomplete";

/* ------------------------------------------------------------------
 * Lecture de la localisation projet.
 *
 * Source principale (la bonne) : la page Foncier écrit sa sélection
 * validée dans `mimmoza.promoteur.foncier.selected_v1`, chaque élément
 * contenant { id, area_m2, commune_insee, feature? }. On en extrait
 * le centroïde de la première parcelle.
 *
 * Sources legacy conservées pour compat : `mimmoza.parcelFeature.*`,
 * `mimmoza.parcelleLocal.*`, `mimmoza.promoteur.captures.v1`.
 * ------------------------------------------------------------------ */

const LS_FONCIER_SELECTED = "mimmoza.promoteur.foncier.selected_v1";
const LS_FONCIER_COMMUNE  = "mimmoza.promoteur.foncier.commune_v1";
const LS_SESSION_COMMUNE  = "mimmoza.session.commune_insee";

type ProjectLocation = {
  latitude: number | null;
  longitude: number | null;
  communeInsee: string | null;
  studyId: string | null;
};

type AnyRecord = Record<string, unknown>;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function centroidOfRing(ring: unknown): { lat: number; lon: number } | null {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let sx = 0, sy = 0, n = 0;
  for (const pt of ring) {
    if (Array.isArray(pt) && pt.length >= 2 && isFiniteNumber(pt[0]) && isFiniteNumber(pt[1])) {
      sx += pt[0] as number;
      sy += pt[1] as number;
      n += 1;
    }
  }
  if (n === 0) return null;
  return { lon: sx / n, lat: sy / n };
}

function centroidOfGeoJsonGeometry(geom: unknown): { lat: number; lon: number } | null {
  if (!geom || typeof geom !== "object") return null;
  const g = geom as AnyRecord;
  const type = typeof g.type === "string" ? g.type : null;
  const coords = g.coordinates as unknown;
  if (!type || !coords) return null;
  switch (type) {
    case "Point":
      if (Array.isArray(coords) && isFiniteNumber(coords[0]) && isFiniteNumber(coords[1])) {
        return { lon: coords[0] as number, lat: coords[1] as number };
      }
      return null;
    case "Polygon":
      if (Array.isArray(coords) && Array.isArray(coords[0])) return centroidOfRing(coords[0]);
      return null;
    case "MultiPolygon":
      if (Array.isArray(coords) && Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
        return centroidOfRing(coords[0][0]);
      }
      return null;
    default:
      return null;
  }
}

function extractFromFoncierSelected(raw: string | null) {
  if (!raw) return { lat: null, lon: null, commune: null as string | null };
  try {
    const parcels = JSON.parse(raw) as Array<AnyRecord>;
    if (!Array.isArray(parcels) || parcels.length === 0) {
      return { lat: null, lon: null, commune: null };
    }
    const first = parcels[0] ?? {};
    const communeInsee =
      typeof first.commune_insee === "string" ? (first.commune_insee as string) : null;
    const feature = first.feature as AnyRecord | null | undefined;
    if (feature) {
      const geom = (feature.geometry ?? feature) as unknown;
      const c = centroidOfGeoJsonGeometry(geom);
      if (c) return { lat: c.lat, lon: c.lon, commune: communeInsee };
    }
    // Feature absente (parcelle trop grosse pour LS ou non trouvée) :
    // au moins on renvoie l'INSEE pour pré-sélectionner la commune.
    return { lat: null, lon: null, commune: communeInsee };
  } catch {
    return { lat: null, lon: null, commune: null };
  }
}

function extractFromParcelFeatureLegacy(raw: string | null) {
  if (!raw) return { lat: null, lon: null, commune: null as string | null };
  try {
    const parsed = JSON.parse(raw) as AnyRecord;
    const geom = (parsed.geometry ?? parsed) as unknown;
    const c = centroidOfGeoJsonGeometry(geom);
    const props = (parsed.properties ?? {}) as AnyRecord;
    const commune =
      typeof props.commune === "string" ? (props.commune as string)
      : typeof props.nom_com === "string" ? (props.nom_com as string)
      : typeof props.nomCommune === "string" ? (props.nomCommune as string)
      : null;
    return { lat: c?.lat ?? null, lon: c?.lon ?? null, commune };
  } catch {
    return { lat: null, lon: null, commune: null };
  }
}

function readProjectLocation(studyId: string | null): ProjectLocation {
  // 1) Source principale : sélection Foncier validée
  try {
    const raw = localStorage.getItem(LS_FONCIER_SELECTED);
    const r = extractFromFoncierSelected(raw);
    if (r.lat !== null && r.lon !== null) {
      return { latitude: r.lat, longitude: r.lon, communeInsee: r.commune, studyId };
    }
    if (r.commune) {
      // On a au moins l'INSEE : on pourra pré-sélectionner la commune
      // (le centre du projet proviendra du centroïde INSEE).
      return { latitude: null, longitude: null, communeInsee: r.commune, studyId };
    }
  } catch { /* ignore */ }

  // 2) Fallback legacy parcelFeature (ancienne clé)
  if (studyId) {
    try {
      const raw = localStorage.getItem(`mimmoza.parcelFeature.${studyId}`);
      const r = extractFromParcelFeatureLegacy(raw);
      if (r.lat !== null && r.lon !== null) {
        return { latitude: r.lat, longitude: r.lon, communeInsee: r.commune, studyId };
      }
    } catch { /* ignore */ }
  }

  // 3) Fallback legacy parcelleLocal (ancienne clé)
  if (studyId) {
    try {
      const raw = localStorage.getItem(`mimmoza.parcelleLocal.${studyId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as AnyRecord;
        const lat =
          (isFiniteNumber(parsed.latitude) && (parsed.latitude as number)) ||
          (isFiniteNumber((parsed as AnyRecord).lat) && ((parsed as AnyRecord).lat as number)) || null;
        const lon =
          (isFiniteNumber(parsed.longitude) && (parsed.longitude as number)) ||
          (isFiniteNumber((parsed as AnyRecord).lon) && ((parsed as AnyRecord).lon as number)) || null;
        const commune = typeof parsed.commune === "string" ? (parsed.commune as string) : null;
        if (lat !== null && lon !== null) {
          return { latitude: lat, longitude: lon, communeInsee: commune, studyId };
        }
      }
    } catch { /* ignore */ }
  }

  // 4) Dernier recours : INSEE connu dans la session
  try {
    const insee =
      localStorage.getItem(LS_SESSION_COMMUNE) ||
      localStorage.getItem(LS_FONCIER_COMMUNE);
    if (insee) {
      return { latitude: null, longitude: null, communeInsee: insee, studyId };
    }
  } catch { /* ignore */ }

  return { latitude: null, longitude: null, communeInsee: null, studyId };
}

/* ------------------------------------------------------------------
 * Résolution d'une commune par code INSEE via geo.api.gouv.fr.
 * Renvoie un objet compatible avec CommuneSuggestion (code + centre).
 * ------------------------------------------------------------------ */

async function resolveCommuneByInsee(
  insee: string,
  signal: AbortSignal,
): Promise<CommuneSuggestion | null> {
  try {
    const url =
      `https://geo.api.gouv.fr/communes/${encodeURIComponent(insee)}` +
      `?fields=code,nom,centre,codesPostaux,codeDepartement,codeRegion,population&format=json`;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const d = (await res.json()) as AnyRecord;
    const code = typeof d.code === "string" ? d.code : null;
    if (!code) return null;
    const centreRaw = d.centre as AnyRecord | undefined;
    let centre: { lat: number; lon: number } | undefined;
    if (centreRaw && Array.isArray(centreRaw.coordinates)) {
      const [lon, lat] = centreRaw.coordinates as [number, number];
      if (isFiniteNumber(lat) && isFiniteNumber(lon)) {
        centre = { lat, lon };
      }
    }
    // On fabrique un objet compatible. CommuneSuggestion peut avoir plus
    // de champs, mais un cast suffit pour pré-sélectionner la commune
    // dans CommuneAutocomplete ; l'utilisateur peut toujours la remplacer.
    const suggestion: Record<string, unknown> = {
      code,
      nom: typeof d.nom === "string" ? d.nom : code,
      centre,
      codesPostaux: Array.isArray(d.codesPostaux) ? d.codesPostaux : [],
      codeDepartement: typeof d.codeDepartement === "string" ? d.codeDepartement : null,
      codeRegion: typeof d.codeRegion === "string" ? d.codeRegion : null,
      population: isFiniteNumber(d.population) ? d.population : null,
    };
    return suggestion as unknown as CommuneSuggestion;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------
 * Géocodage d'adresse via l'API BAN (api-adresse.data.gouv.fr).
 * ------------------------------------------------------------------ */

type BanFeature = {
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    label: string;
    city?: string;
    citycode?: string;
    postcode?: string;
    context?: string;
  };
};

async function geocodeAddress(
  query: string,
  signal: AbortSignal,
): Promise<BanFeature[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5&autocomplete=1`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: BanFeature[] };
    return Array.isArray(data.features) ? data.features : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */

const DEFAULT_RAYON_KM = 5;

type PeriodePreset = 12 | 24 | 36 | "custom";
const DEFAULT_PERIODE_MOIS: PeriodePreset = 24;

const SELECTION_EVENT = "mimmoza.promoteur.permisConstruire.updated";

function selectionStorageKey(studyId: string | null): string | null {
  if (!studyId) return null;
  return `mimmoza.promoteur.permisConstruire.selection.v1.${studyId}`;
}

export default function PermisConstruirePage() {
  const location = useLocation();
  const studyId = useMemo(() => {
    try {
      const sp = new URLSearchParams(location.search);
      return sp.get("study");
    } catch {
      return null;
    }
  }, [location.search]);

  const {
    latitude: projectLatitude,
    longitude: projectLongitude,
    communeInsee: projectCommuneInsee,
  } = useMemo(() => readProjectLocation(studyId), [studyId]);

  // ----- Adresse saisie manuellement (BAN) -----
  const [manualAddress, setManualAddress] = useState<string>("");
  const [addressSuggestions, setAddressSuggestions] = useState<BanFeature[]>([]);
  const [addressOpen, setAddressOpen] = useState<boolean>(false);
  const [manualCoords, setManualCoords] = useState<{
    lat: number;
    lon: number;
    label: string;
    citycode?: string;
  } | null>(null);

  // Coordonnées effectives : saisie manuelle > projet Foncier
  const latitude = manualCoords?.lat ?? projectLatitude;
  const longitude = manualCoords?.lon ?? projectLongitude;
  const effectiveInsee = manualCoords?.citycode ?? projectCommuneInsee;

  // ----- Filtre commune (prioritaire, obligatoire) -----
  const [selectedCommune, setSelectedCommune] =
    useState<CommuneSuggestion | null>(null);
  const [communePrefillState, setCommunePrefillState] =
    useState<"idle" | "loading" | "done" | "failed">("idle");

  // ----- Autres filtres -----
  const [rayonKm, setRayonKm] = useState<number>(DEFAULT_RAYON_KM);
  const [periodePreset, setPeriodePreset] =
    useState<PeriodePreset>(DEFAULT_PERIODE_MOIS);
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [typeAut, setTypeAut] = useState<PermisConstruireTypeAutorisation[]>([
    "PC",
    "PA",
    "PD",
    "DP",
  ]);
  const [typologie, setTypologie] = useState<PermisConstruireProjectType>("tous");
  const [logementsMin, setLogementsMin] = useState<string>("");
  const [logementsMax, setLogementsMax] = useState<string>("");
  const [surfaceMin, setSurfaceMin] = useState<string>("");
  const [surfaceMax, setSurfaceMax] = useState<string>("");

  // ----- Tri + sélection -----
  const [sortBy, setSortBy] = useState<PermisConstruireSortKey>("distance");
  const [sortOrder, setSortOrder] = useState<PermisConstruireSortOrder>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionSavedAt, setSelectionSavedAt] = useState<string | null>(null);

  const { state, run } = usePermisConstruire();

  // ----- Debounced geocoding des adresses tapées -----
  useEffect(() => {
    const q = manualAddress.trim();
    if (!q) {
      setAddressSuggestions([]);
      return;
    }
    if (manualCoords && manualAddress === manualCoords.label) {
      setAddressSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      void geocodeAddress(q, ctrl.signal).then((features) => {
        if (!ctrl.signal.aborted) setAddressSuggestions(features);
      });
    }, 250);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [manualAddress, manualCoords]);

  const onSelectAddressSuggestion = (f: BanFeature) => {
    const [lon, lat] = f.geometry.coordinates;
    setManualCoords({
      lat,
      lon,
      label: f.properties.label,
      citycode: f.properties.citycode,
    });
    setManualAddress(f.properties.label);
    setAddressSuggestions([]);
    setAddressOpen(false);
    setSelectedCommune(null);
    setCommunePrefillState("idle");
  };

  const onClearAddress = () => {
    setManualCoords(null);
    setManualAddress("");
    setAddressSuggestions([]);
    setAddressOpen(false);
    setSelectedCommune(null);
    setCommunePrefillState("idle");
  };

  // ----- Pré-remplissage commune -----
  //
  // Si on a des coordonnées → reverse-geocode via getCommuneByLatLon.
  // Sinon, si on a un INSEE → fetch direct geo.api.gouv.fr.
  useEffect(() => {
    if (selectedCommune || communePrefillState !== "idle") return;

    const ctrl = new AbortController();

    if (latitude !== null && longitude !== null) {
      setCommunePrefillState("loading");
      void getCommuneByLatLon(latitude, longitude).then((res) => {
        if (ctrl.signal.aborted) return;
        if (res) {
          setSelectedCommune(res);
          setCommunePrefillState("done");
        } else {
          setCommunePrefillState("failed");
        }
      });
    } else if (effectiveInsee) {
      setCommunePrefillState("loading");
      void resolveCommuneByInsee(effectiveInsee, ctrl.signal).then((res) => {
        if (ctrl.signal.aborted) return;
        if (res) {
          setSelectedCommune(res);
          setCommunePrefillState("done");
        } else {
          setCommunePrefillState("failed");
        }
      });
    }

    return () => {
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude, effectiveInsee]);

  // ----- Construction des params -----
  //
  // Le centre de recherche envoyé au backend est celui de la COMMUNE
  // SÉLECTIONNÉE (centroïde INSEE), avec fallback sur les coords du
  // projet / adresse saisie si la commune n'a pas de centre renseigné.
  const buildParams = useCallback((): PermisConstruireSearchParams | null => {
    if (!selectedCommune) return null;

    const searchLat = selectedCommune.centre?.lat ?? latitude ?? null;
    const searchLon = selectedCommune.centre?.lon ?? longitude ?? null;

    if (searchLat === null || searchLon === null) return null;

    const clampedRayon = Math.max(0.2, Math.min(25, rayonKm));
    const periodeMois =
      periodePreset === "custom" ? DEFAULT_PERIODE_MOIS : periodePreset;

    return {
      latitude: searchLat,
      longitude: searchLon,
      rayonKm: clampedRayon,
      periodeMois,
      periodeStart: periodePreset === "custom" ? (customStart || undefined) : undefined,
      periodeEnd: periodePreset === "custom" ? (customEnd || undefined) : undefined,
      typeAutorisation: typeAut,
      typologie,
      logementsMin: logementsMin ? Number(logementsMin) : null,
      logementsMax: logementsMax ? Number(logementsMax) : null,
      surfaceMin: surfaceMin ? Number(surfaceMin) : null,
      surfaceMax: surfaceMax ? Number(surfaceMax) : null,
      commune: selectedCommune.code,
      sortBy,
      sortOrder,
    };
  }, [
    latitude,
    longitude,
    selectedCommune,
    rayonKm,
    periodePreset,
    customStart,
    customEnd,
    typeAut,
    typologie,
    logementsMin,
    logementsMax,
    surfaceMin,
    surfaceMax,
    sortBy,
    sortOrder,
  ]);

  // ----- Relance auto dès qu'une commune est choisie -----
  useEffect(() => {
    if (!selectedCommune) return;
    const params = buildParams();
    if (!params) return;
    void run(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCommune]);

  const onRelancer = () => {
    const params = buildParams();
    if (!params) return;
    void run(params);
  };

  // ----- Tri local -----
  const displayedItems = useMemo(() => {
    if (!state.response) return [];
    return sortPermis(state.response.items, sortBy, sortOrder);
  }, [state.response, sortBy, sortOrder]);

  // ----- Sélection synthèse -----
  const storageKey = selectionStorageKey(studyId);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as AnyRecord;
      if (Array.isArray(parsed.ids)) {
        setSelectedIds(new Set(parsed.ids.filter((x): x is string => typeof x === "string")));
      }
      if (typeof parsed.savedAt === "string") {
        setSelectionSavedAt(parsed.savedAt);
      }
    } catch { /* ignore */ }
  }, [storageKey]);

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveSelection = () => {
    if (!storageKey) return;
    const ids = Array.from(selectedIds);
    const items = displayedItems.filter((it) => selectedIds.has(it.id));
    const payload = {
      studyId,
      ids,
      items,
      savedAt: new Date().toISOString(),
      source: "promoteur-permis-construire",
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
      setSelectionSavedAt(payload.savedAt);
      try {
        window.dispatchEvent(new CustomEvent(SELECTION_EVENT, { detail: payload }));
      } catch { /* ignore */ }
    } catch { /* ignore */ }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    if (storageKey) {
      try {
        localStorage.removeItem(storageKey);
        setSelectionSavedAt(null);
        window.dispatchEvent(new CustomEvent(SELECTION_EVENT, { detail: null }));
      } catch { /* ignore */ }
    }
  };

  const toggleType = (t: PermisConstruireTypeAutorisation) => {
    setTypeAut((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  };

  // ------------------------------------------------------------------
  //  Rendu
  // ------------------------------------------------------------------

  const canSearch = selectedCommune !== null;
  const hasAnyProjectContext =
    projectLatitude !== null || projectCommuneInsee !== null || manualCoords !== null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
        {/* En-tête violet */}
        <div className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-400 to-violet-500 px-6 py-6 shadow-sm md:px-8 md:py-7">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-violet-100">
            Promoteur › Études
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white backdrop-blur-sm"
              aria-hidden="true"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M9 13h6" />
                <path d="M9 17h6" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white md:text-3xl">
              Permis de construire
            </h1>
            {selectedCommune && (
              <span className="inline-flex items-center rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                INSEE {selectedCommune.code}
              </span>
            )}
            {state.response && (
              <span className="inline-flex items-center rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                {state.response.total} permis
              </span>
            )}
            <span
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm"
              title="Base officielle des autorisations d'urbanisme · data.gouv.fr"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              Source : Sit@del2 · data.gouv.fr
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-violet-50/90">
            Recherchez les permis déposés autour du projet dans un rayon paramétrable.
            Filtres explicites, tri explicite, aucun scoring.
          </p>
        </div>

        {!hasAnyProjectContext && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            Aucun contexte projet détecté depuis l'onglet « Foncier ».
            Saisissez une adresse ci-dessous ou choisissez directement une commune.
          </div>
        )}

        {/* Filtres */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-slate-800">
              Filtres de recherche
            </h2>
            <button
              type="button"
              onClick={onRelancer}
              disabled={!canSearch || state.loading}
              className="rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-violet-700 hover:to-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.loading ? "Recherche…" : "Relancer la recherche"}
            </button>
          </div>

          {/* Adresse (optionnel, géocodage BAN) */}
          <div className="relative mb-5">
            <label
              htmlFor="pc-address"
              className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700"
            >
              <span>Adresse du projet</span>
              <span className="text-xs font-normal text-slate-400">(optionnel)</span>
              {projectLatitude !== null && !manualCoords && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Parcelle du Foncier
                </span>
              )}
              {projectLatitude === null && projectCommuneInsee && !manualCoords && (
                <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                  INSEE {projectCommuneInsee} (Foncier)
                </span>
              )}
              {manualCoords && (
                <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                  Saisie manuelle
                </span>
              )}
            </label>
            <input
              id="pc-address"
              type="text"
              value={manualAddress}
              onChange={(e) => {
                setManualAddress(e.target.value);
                if (manualCoords && e.target.value !== manualCoords.label) {
                  setManualCoords(null);
                }
                setAddressOpen(true);
              }}
              onFocus={() => setAddressOpen(true)}
              onBlur={() => {
                window.setTimeout(() => setAddressOpen(false), 150);
              }}
              placeholder="Ex : 10 rue de Rivoli, 75001 Paris"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
              autoComplete="off"
            />
            {addressOpen && addressSuggestions.length > 0 && (
              <ul className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {addressSuggestions.map((f, i) => (
                  <li key={`${f.properties.label}-${i}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onSelectAddressSuggestion(f)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-violet-50"
                    >
                      <div className="font-medium text-slate-800">
                        {f.properties.label}
                      </div>
                      {f.properties.context && (
                        <div className="text-[11px] text-slate-500">
                          {f.properties.context}
                        </div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {!manualCoords && !hasAnyProjectContext && (
                <span className="text-slate-500">
                  Saisissez une adresse pour géocoder, ou choisissez directement une commune ci-dessous.
                </span>
              )}
              {!manualCoords && projectLatitude !== null && (
                <span className="text-slate-500">
                  Laissez vide pour utiliser les coordonnées du Foncier, ou saisissez une autre adresse.
                </span>
              )}
              {!manualCoords && projectLatitude === null && projectCommuneInsee && (
                <span className="text-slate-500">
                  Parcelle Foncier sans géométrie — la recherche est centrée sur le centroïde de la commune.
                  Saisissez une adresse pour affiner.
                </span>
              )}
              {manualCoords && (
                <>
                  <span className="inline-flex items-center gap-1 text-violet-700">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    {manualCoords.lat.toFixed(5)}, {manualCoords.lon.toFixed(5)}
                  </span>
                  <button
                    type="button"
                    onClick={onClearAddress}
                    className="text-slate-500 underline hover:text-slate-700"
                  >
                    Effacer
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Commune (obligatoire) */}
          <div className="mb-5">
            <label
              htmlFor="pc-commune"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Commune <span className="text-rose-500">*</span>
            </label>
            <CommuneAutocomplete
              id="pc-commune"
              value={selectedCommune}
              onChange={setSelectedCommune}
              placeholder="Tapez le nom de la commune, un code INSEE ou un code postal"
              required
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {communePrefillState === "loading" && (
                <span className="text-slate-500">
                  Détection de la commune du projet…
                </span>
              )}
              {communePrefillState === "done" && selectedCommune && (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Commune détectée automatiquement
                </span>
              )}
              {communePrefillState === "failed" && !selectedCommune && (
                <span className="text-amber-700">
                  Impossible de détecter la commune automatiquement — choisissez-la.
                </span>
              )}
              {!selectedCommune && communePrefillState === "idle" && (
                <span className="text-slate-500">
                  Sélectionnez une commune pour lancer la recherche.
                </span>
              )}
            </div>
          </div>

          {/* Autres filtres */}
          <div className="grid gap-5 md:grid-cols-3">
            {/* Rayon */}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Rayon : {rayonKm} km
              </label>
              <input
                type="range"
                min={0.2}
                max={25}
                step={0.2}
                value={rayonKm}
                onChange={(e) => setRayonKm(Number(e.target.value))}
                className="w-full accent-violet-600"
              />
              <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                <span>0 km</span>
                <span>25 km</span>
              </div>
            </div>

            {/* Période */}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Période
              </label>
              <div className="flex flex-wrap gap-2">
                {([12, 24, 36] as PeriodePreset[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPeriodePreset(m)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                      periodePreset === m
                        ? "border-violet-500 bg-violet-50 text-violet-700"
                        : "border-slate-300 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {m} mois
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPeriodePreset("custom")}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                    periodePreset === "custom"
                      ? "border-violet-500 bg-violet-50 text-violet-700"
                      : "border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Personnalisée
                </button>
              </div>
              {periodePreset === "custom" && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                  />
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                  />
                </div>
              )}
            </div>

            {/* Type d'autorisation */}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Type d'autorisation
              </label>
              <div className="flex flex-wrap gap-2">
                {(["PC", "PA", "PD", "DP"] as PermisConstruireTypeAutorisation[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleType(t)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                      typeAut.includes(t)
                        ? "border-violet-500 bg-violet-50 text-violet-700"
                        : "border-slate-300 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                PC · PA · PD · DP — désélectionnez pour restreindre.
              </div>
            </div>

            {/* Typologie */}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Typologie projet
              </label>
              <select
                value={typologie}
                onChange={(e) =>
                  setTypologie(e.target.value as PermisConstruireProjectType)
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
              >
                <option value="tous">Tous</option>
                <option value="logement_individuel">Logement individuel</option>
                <option value="logement_collectif">Logement collectif</option>
                <option value="logement_mixte">Logement mixte</option>
                <option value="activite">Activité</option>
              </select>
            </div>

            {/* Logements */}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Nombre de logements (min / max)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min={0}
                  placeholder="Min"
                  value={logementsMin}
                  onChange={(e) => setLogementsMin(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
                <input
                  type="number"
                  min={0}
                  placeholder="Max"
                  value={logementsMax}
                  onChange={(e) => setLogementsMax(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
            </div>

            {/* Surface */}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Surface en m² (min / max)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min={0}
                  placeholder="Min"
                  value={surfaceMin}
                  onChange={(e) => setSurfaceMin(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
                <input
                  type="number"
                  min={0}
                  placeholder="Max"
                  value={surfaceMax}
                  onChange={(e) => setSurfaceMax(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bandeau résumé */}
        <div className="mt-6 rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/60 to-fuchsia-50/40 p-5">
          <div className="grid gap-4 md:grid-cols-5">
            <ResumeKpi
              label="Permis trouvés"
              value={
                state.response ? String(state.response.total) : state.loading ? "…" : "—"
              }
            />
            <ResumeKpi label="Rayon appliqué" value={`${rayonKm} km`} />
            <ResumeKpi
              label="Période"
              value={
                periodePreset === "custom"
                  ? `${customStart || "—"} → ${customEnd || "—"}`
                  : `${periodePreset} mois`
              }
            />
            <ResumeKpi
              label="Type d'autorisation"
              value={
                typeAut.length === 0
                  ? "Aucun"
                  : typeAut.length === 4
                  ? "Tous (PC, PA, PD, DP)"
                  : typeAut.join(" · ")
              }
            />
            <ResumeKpi
              label="Typologie projet"
              value={
                typologie === "tous"
                  ? "Toutes"
                  : formatTypologie(
                      typologie === "logement_individuel"
                        ? "individuel"
                        : typologie === "logement_collectif"
                        ? "collectif"
                        : typologie === "logement_mixte"
                        ? "mixte"
                        : "activite",
                    )
              }
            />
          </div>
          {state.response?.notices && state.response.notices.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-violet-100 pt-3 text-xs text-violet-800">
              {state.response.notices.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Erreur */}
        {state.error && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            Impossible de charger les permis de construire : {state.error}
          </div>
        )}

        {/* Résultats */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="text-sm font-semibold text-slate-700">
              Résultats ({state.response?.total ?? 0})
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Tri :</span>
              <SortButton
                active={sortBy === "distance"}
                order={sortOrder}
                onClick={() => {
                  if (sortBy === "distance") {
                    setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                  } else {
                    setSortBy("distance");
                    setSortOrder("asc");
                  }
                }}
                label="Distance"
              />
              <SortButton
                active={sortBy === "date"}
                order={sortOrder}
                onClick={() => {
                  if (sortBy === "date") {
                    setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                  } else {
                    setSortBy("date");
                    setSortOrder("desc");
                  }
                }}
                label="Date"
              />
              <SortButton
                active={sortBy === "logements"}
                order={sortOrder}
                onClick={() => {
                  if (sortBy === "logements") {
                    setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                  } else {
                    setSortBy("logements");
                    setSortOrder("desc");
                  }
                }}
                label="Logements"
              />
              <SortButton
                active={sortBy === "surface"}
                order={sortOrder}
                onClick={() => {
                  if (sortBy === "surface") {
                    setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                  } else {
                    setSortBy("surface");
                    setSortOrder("desc");
                  }
                }}
                label="Surface"
              />

              <div className="ml-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveSelection}
                  disabled={selectedIds.size === 0}
                  className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Utiliser dans la synthèse ({selectedIds.size})
                </button>
                {selectionSavedAt && (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    title="Effacer la sélection enregistrée"
                  >
                    Vider
                  </button>
                )}
              </div>
            </div>
          </div>

          {state.loading ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">
              Chargement des permis…
            </div>
          ) : displayedItems.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">
              {selectedCommune
                ? "Aucun permis ne correspond aux filtres."
                : "Sélectionnez une commune (ou saisissez une adresse) pour lancer la recherche."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-10 px-4 py-2.5 text-left">
                      <span className="sr-only">Sélection</span>
                    </th>
                    <th className="px-4 py-2.5 text-left">Distance</th>
                    <th className="px-4 py-2.5 text-left">Commune</th>
                    <th className="px-4 py-2.5 text-left">Date dépôt</th>
                    <th className="px-4 py-2.5 text-left">Type</th>
                    <th className="px-4 py-2.5 text-left">Nature / Typologie</th>
                    <th className="px-4 py-2.5 text-right">Logements</th>
                    <th className="px-4 py-2.5 text-right">Surface</th>
                    <th className="px-4 py-2.5 text-left">Statut</th>
                    <th className="px-4 py-2.5 text-left">Référence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayedItems.map((it) => (
                    <tr
                      key={it.id}
                      className={`transition ${
                        selectedIds.has(it.id) ? "bg-violet-50/40" : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(it.id)}
                          onChange={() => toggleSelection(it.id)}
                          className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                          aria-label="Sélectionner ce permis"
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-slate-700">
                        {formatDistance(it.distanceKm)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {formatText(it.commune)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
                        {formatDate(it.dateDepot)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
                        {formatTypeAutorisation(it.typeAutorisation)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        <div>{formatText(it.natureProjet)}</div>
                        <div className="text-xs text-slate-500">
                          {formatTypologie(it.typologie)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-slate-700">
                        {formatInteger(it.nombreLogements)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-slate-700">
                        {formatSurface(it.surface)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <StatutBadge statut={it.statut} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-500">
                        {formatText(it.referenceDossier)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Source des données */}
        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 md:px-5">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-slate-700">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
              Source des données
            </div>
            <div className="flex-1 min-w-[240px]">
              <div>
                <span className="font-medium text-slate-800">Sit@del2</span>
                {" — "}
                base nationale des autorisations d'urbanisme
                {" ("}
                <a
                  href="https://www.data.gouv.fr/fr/datasets/base-des-permis-de-construire-et-autres-autorisations-durbanisme-sitadel/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-800"
                >
                  data.gouv.fr
                </a>
                {"), publiée par le "}
                <span className="text-slate-700">
                  Ministère de la Transition écologique (SDES)
                </span>.
              </div>
              <div className="mt-1 text-slate-500">
                Couvre les permis de construire (PC), d'aménager (PA), de démolir (PD) et
                les déclarations préalables (DP). Les dates correspondent au dépôt en mairie.
                Mises à jour mensuelles ; un délai de publication peut exister pour les dossiers récents.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ResumeKpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-600">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-bold text-slate-800">{value}</div>
    </div>
  );
}

function SortButton({
  active,
  order,
  onClick,
  label,
}: {
  active: boolean;
  order: PermisConstruireSortOrder;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
        active
          ? "border-violet-500 bg-violet-50 text-violet-700"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
      {active && <span className="text-[10px]">{order === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
}

function StatutBadge({ statut }: { statut: PermisConstruireStatut | null }) {
  const label = formatStatut(statut);
  let classes = "bg-slate-100 text-slate-700";
  if (statut === "accorde") classes = "bg-emerald-100 text-emerald-700";
  else if (statut === "refuse") classes = "bg-rose-100 text-rose-700";
  else if (statut === "en_instruction") classes = "bg-amber-100 text-amber-700";
  else if (statut === "retire") classes = "bg-slate-200 text-slate-700";
  else if (statut === "depose") classes = "bg-sky-100 text-sky-700";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}