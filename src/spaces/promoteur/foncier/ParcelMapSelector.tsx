import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, GeoJSON, useMapEvents, useMap } from "react-leaflet";
import type { FeatureCollection, Feature } from "geojson";
import L from "leaflet";
import { supabase } from "../../../supabaseClient";
import turfArea from "@turf/area";

// Import explicite de la CSS Leaflet pour garantir l'affichage correct
import "leaflet/dist/leaflet.css";

type BBox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

type SelectedParcelData = {
  id: string;
  feature?: any;
  area_m2?: number | null;
};

type Props = {
  communeInsee: string;
  selectedIds: string[];
  /** Parcelles sélectionnées avec leurs features GeoJSON (pour overlay vert) */
  selectedParcels?: SelectedParcelData[];
  onToggleParcel: (parcelId: string, feature: any, area_m2: number | null) => void;

  initialCenter?: { lat: number; lon: number } | null;
  initialZoom?: number;
  heightPx?: number;

  /** ID de la parcelle à centrer automatiquement */
  focusParcelId?: string | null;

  /** Callback pour enrichir automatiquement les parcelles sélectionnées avec leur surface */
  onAutoEnrichSelected?: (updates: { id: string; area_m2: number | null }[]) => void;
};

type CadastreBboxResponse = {
  success: boolean;
  version?: string;
  commune_insee?: string;
  bbox?: BBox;
  featureCollection?: FeatureCollection;
  features?: Feature[];
  count?: number;
  error?: string;
  message?: string;
};

function getParcelIdFromFeature(f: any): string | null {
  const p = f?.properties ?? {};
  const pid = p.parcel_id ?? p.idu ?? p.id ?? p.IDU ?? p.ID ?? null;
  if (pid && typeof pid === "string") return pid;

  const section = p.section || p.SECTION;
  const numero = p.numero || p.NUMERO;
  const code_insee = p.code_insee || p.CODE_INSEE;
  if (code_insee && section && numero) {
    return `${String(code_insee)}-${String(section)}-${String(numero)}`;
  }
  return null;
}

function makeBboxKey(b: BBox): string {
  const r = (x: number) => Math.round(x * 1e4) / 1e4;
  return `${r(b.minLon)},${r(b.minLat)},${r(b.maxLon)},${r(b.maxLat)}`;
}

function boundsToBBox(bounds: L.LatLngBounds): BBox {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return {
    minLon: sw.lng,
    minLat: sw.lat,
    maxLon: ne.lng,
    maxLat: ne.lat,
  };
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let t: any = null;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Calcule l'aire d'une feature GeoJSON en m² (arrondi à l'unité).
 */
function computeAreaM2(feature: any): number | null {
  if (!feature || !feature.geometry) return null;
  try {
    const area = turfArea(feature);
    return Math.round(area);
  } catch (e) {
    console.warn("[ParcelMapSelector] Error computing area:", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const STYLE_DEFAULT = {
  color: "#2563eb",
  opacity: 0.9,
  weight: 2,
  fillColor: "#60a5fa",
  fillOpacity: 0.18,
};

const STYLE_SELECTED = {
  color: "#16a34a",
  opacity: 1,
  weight: 3,
  fillColor: "#22c55e",
  fillOpacity: 0.35,
};

const STYLE_HOVER_DEFAULT = {
  color: "#2563eb",
  opacity: 1,
  weight: 3,
  fillColor: "#60a5fa",
  fillOpacity: 0.28,
};

const STYLE_HOVER_SELECTED = {
  color: "#16a34a",
  opacity: 1,
  weight: 4,
  fillColor: "#22c55e",
  fillOpacity: 0.45,
};

// ─────────────────────────────────────────────────────────────────────────────
// ParcelLayer: affiche les parcelles du cadastre
// ─────────────────────────────────────────────────────────────────────────────

function ParcelLayer({
  data,
  selectedIds,
  onToggleParcel,
}: {
  data: FeatureCollection;
  selectedIds: string[];
  onToggleParcel: (pid: string, feature: any, area_m2: number | null) => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const onEachFeature = (feature: any, layer: L.Layer) => {
    const pid = getParcelIdFromFeature(feature);
    if (!pid) return;

    const isSelected = selectedSet.has(pid);

    // @ts-ignore
    layer.setStyle?.(isSelected ? STYLE_SELECTED : STYLE_DEFAULT);

    layer.on("mouseover", () => {
      // @ts-ignore
      layer.setStyle?.(isSelected ? STYLE_HOVER_SELECTED : STYLE_HOVER_DEFAULT);
    });

    layer.on("mouseout", () => {
      // @ts-ignore
      layer.setStyle?.(isSelected ? STYLE_SELECTED : STYLE_DEFAULT);
    });

    layer.on("click", () => {
      const area_m2 = computeAreaM2(feature);
      onToggleParcel(pid, feature, area_m2);
    });
  };

  const key = useMemo(() => selectedIds.join("|"), [selectedIds]);

  return (
    <GeoJSON
      key={key}
      data={data as any}
      onEachFeature={onEachFeature as any}
      style={() => STYLE_DEFAULT as any}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SelectedParcelsOverlay: overlay vert pour les parcelles sélectionnées
// ─────────────────────────────────────────────────────────────────────────────

function SelectedParcelsOverlay({
  selectedParcels,
  cadastreFeatures,
}: {
  selectedParcels: SelectedParcelData[];
  cadastreFeatures: FeatureCollection;
}) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);

  // Construire la FeatureCollection des parcelles sélectionnées
  const selectedFc = useMemo(() => {
    const features: Feature[] = [];

    for (const parcel of selectedParcels) {
      // 1) Utiliser la feature stockée dans le parcel si disponible
      if (parcel.feature && parcel.feature.geometry) {
        features.push(parcel.feature);
        continue;
      }

      // 2) Sinon, chercher dans les features du cadastre chargées
      const fromCadastre = cadastreFeatures.features.find(
        (f) => getParcelIdFromFeature(f) === parcel.id
      );
      if (fromCadastre) {
        features.push(fromCadastre);
      }
    }

    return {
      type: "FeatureCollection" as const,
      features,
    };
  }, [selectedParcels, cadastreFeatures]);

  useEffect(() => {
    // Supprimer l'ancien layer
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (selectedFc.features.length === 0) return;

    // Créer le nouveau layer
    const layer = L.geoJSON(selectedFc as any, {
      style: {
        color: "#16a34a",
        weight: 3,
        opacity: 1,
        fillColor: "#22c55e",
        fillOpacity: 0.35,
      },
      interactive: false, // Pas d'interaction sur l'overlay
    });

    layer.addTo(map);
    layer.bringToFront();
    layerRef.current = layer;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, selectedFc]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MapInvalidateSizeHandler: force invalidateSize après mount et visibility changes
// ─────────────────────────────────────────────────────────────────────────────

function MapInvalidateSizeHandler() {
  const map = useMap();
  const invalidatedRef = useRef(false);

  useEffect(() => {
    if (!map) return;

    // Immédiat
    map.invalidateSize();

    // Après un court délai (pour les animations CSS)
    const t1 = setTimeout(() => map.invalidateSize(), 100);
    const t2 = setTimeout(() => map.invalidateSize(), 300);
    const t3 = setTimeout(() => map.invalidateSize(), 500);

    // Observer les changements de visibilité du conteneur
    const container = map.getContainer();
    if (container && typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(() => {
        map.invalidateSize();
      });
      resizeObserver.observe(container);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
        resizeObserver.disconnect();
      };
    }

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [map]);

  // Invalider aussi quand le document redevient visible
  useEffect(() => {
    if (!map) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setTimeout(() => map.invalidateSize(), 100);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [map]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MapController: gère le fetch initial et le centrage sur focusParcelId
// ─────────────────────────────────────────────────────────────────────────────

function MapController({
  onViewportBbox,
  fc,
  focusParcelId,
}: {
  onViewportBbox: (bbox: BBox) => void;
  fc: FeatureCollection;
  focusParcelId: string | null | undefined;
}) {
  const map = useMap();

  const didInitialFetchRef = useRef(false);
  const didFitForParcelRef = useRef<string | null>(null);

  // Fetch initial
  useEffect(() => {
    if (!map || didInitialFetchRef.current) return;

    didInitialFetchRef.current = true;

    // Double RAF pour s'assurer que le layout est stable
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        map.invalidateSize();
        const bbox = boundsToBBox(map.getBounds());
        console.log("[ParcelMapSelector] Initial fetch triggered with bbox:", bbox);
        onViewportBbox(bbox);
      });
    });
  }, [map, onViewportBbox]);

  // Centrage sur focusParcelId
  useEffect(() => {
    if (!map || !focusParcelId || fc.features.length === 0) return;

    if (didFitForParcelRef.current === focusParcelId) {
      return;
    }

    const targetFeature = fc.features.find((f) => getParcelIdFromFeature(f) === focusParcelId);

    if (!targetFeature) {
      console.log("[ParcelMapSelector] Focus parcel not yet in current features:", focusParcelId);
      return;
    }

    try {
      const geoJsonLayer = L.geoJSON(targetFeature as any);
      const bounds = geoJsonLayer.getBounds();

      if (bounds.isValid()) {
        console.log("[ParcelMapSelector] Fitting map to focus parcel:", focusParcelId);
        didFitForParcelRef.current = focusParcelId;

        map.fitBounds(bounds, {
          padding: [30, 30],
          maxZoom: 19,
          animate: true,
        });
      }
    } catch (e) {
      console.warn("[ParcelMapSelector] Error fitting to focus parcel:", e);
    }
  }, [map, fc, focusParcelId]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MapMoveHandler: re-fetch les parcelles quand on bouge/zoom
// ─────────────────────────────────────────────────────────────────────────────

function MapMoveHandler({
  onViewportBbox,
}: {
  onViewportBbox: (bbox: BBox) => void;
}) {
  const handler = useMemo(
    () =>
      debounce((map: L.Map) => {
        const bbox = boundsToBBox(map.getBounds());
        onViewportBbox(bbox);
      }, 350),
    [onViewportBbox],
  );

  useMapEvents({
    moveend(e) {
      // @ts-ignore
      handler(e.target);
    },
    zoomend(e) {
      // @ts-ignore
      handler(e.target);
    },
  });

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────────────────────────────────────

export default function ParcelMapSelector({
  communeInsee,
  selectedIds,
  selectedParcels = [],
  onToggleParcel,
  initialCenter,
  initialZoom = 16,
  heightPx = 440,
  focusParcelId,
  onAutoEnrichSelected,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyWarning, setEmptyWarning] = useState<string | null>(null);

  const [fc, setFc] = useState<FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });

  const [lastBboxKey, setLastBboxKey] = useState<string>("");
  const [backendCount, setBackendCount] = useState<number | null>(null);

  const cacheRef = useRef<Map<string, FeatureCollection>>(new Map());
  const lastKeyRef = useRef<string>("");
  const enrichedIdsRef = useRef<Set<string>>(new Set());

  // Clé unique pour forcer re-render du MapContainer
  const mapKeyRef = useRef<string>(`map-${communeInsee}-${Date.now()}`);

  const center = useMemo(() => {
    if (initialCenter?.lat != null && initialCenter?.lon != null) {
      return [initialCenter.lat, initialCenter.lon] as [number, number];
    }
    return [43.345, -1.621] as [number, number];
  }, [initialCenter]);

  const fetchBbox = useCallback(async (bbox: BBox) => {
    if (!communeInsee) {
      console.log("[ParcelMapSelector] fetchBbox skipped: no communeInsee");
      return;
    }

    const key = `${communeInsee}::${makeBboxKey(bbox)}`;
    setLastBboxKey(key);

    if (lastKeyRef.current === key) {
      console.log("[ParcelMapSelector] fetchBbox skipped: same key", key);
      return;
    }
    lastKeyRef.current = key;

    const cached = cacheRef.current.get(key);
    if (cached) {
      console.log("[ParcelMapSelector] Using cached data for key:", key, "features:", cached.features.length);
      setFc(cached);
      setError(null);
      setEmptyWarning(cached.features.length === 0 ? "0 parcelles en cache pour cette zone" : null);
      return;
    }

    setLoading(true);
    setError(null);
    setEmptyWarning(null);

    console.log("[ParcelMapSelector] Fetching parcels for commune:", communeInsee, "bbox:", bbox);

    try {
      const { data, error } = await supabase.functions.invoke("cadastre-from-commune", {
        body: { commune_insee: communeInsee, bbox },
      });

      console.log("[ParcelMapSelector] Supabase response - data:", data, "error:", error);

      if (error) {
        throw error;
      }

      const payload = (data ?? null) as CadastreBboxResponse | null;
      if (!payload || payload.success !== true) {
        const msg = payload?.error || payload?.message || "Réponse invalide de cadastre-from-commune.";
        throw new Error(msg);
      }

      if (typeof payload.count === "number") {
        setBackendCount(payload.count);
      } else {
        setBackendCount(null);
      }

      const featureCollection =
        payload.featureCollection ??
        (payload.features ? ({ type: "FeatureCollection", features: payload.features } as FeatureCollection) : null);

      if (!featureCollection || featureCollection.type !== "FeatureCollection") {
        throw new Error("FeatureCollection manquante.");
      }

      console.log("[ParcelMapSelector] Received features:", featureCollection.features.length);

      cacheRef.current.set(key, featureCollection);
      setFc(featureCollection);

      if (featureCollection.features.length === 0) {
        setEmptyWarning("0 parcelles trouvées — zoomez/déplacez ou vérifiez le code commune");
      }
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : "Erreur lors du chargement des parcelles.";
      console.error("[ParcelMapSelector] Error:", msg, e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [communeInsee]);

  // Auto-enrichissement des parcelles sélectionnées
  useEffect(() => {
    if (!onAutoEnrichSelected || fc.features.length === 0 || selectedIds.length === 0) return;

    const updates: { id: string; area_m2: number | null }[] = [];

    for (const pid of selectedIds) {
      if (enrichedIdsRef.current.has(pid)) continue;

      const feature = fc.features.find((f) => getParcelIdFromFeature(f) === pid);
      if (feature) {
        const area_m2 = computeAreaM2(feature);
        updates.push({ id: pid, area_m2 });
        enrichedIdsRef.current.add(pid);
      }
    }

    if (updates.length > 0) {
      console.log("[ParcelMapSelector] Auto-enriching selected parcels:", updates);
      onAutoEnrichSelected(updates);
    }
  }, [fc, selectedIds, onAutoEnrichSelected]);

  // Reset cache si commune change
  useEffect(() => {
    console.log("[ParcelMapSelector] Commune changed to:", communeInsee, "- clearing cache");
    cacheRef.current.clear();
    lastKeyRef.current = "";
    enrichedIdsRef.current.clear();
    setFc({ type: "FeatureCollection", features: [] });
    setLastBboxKey("");
    setBackendCount(null);
    setEmptyWarning(null);
    // Nouvelle clé pour forcer re-mount du MapContainer
    mapKeyRef.current = `map-${communeInsee}-${Date.now()}`;
  }, [communeInsee]);

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        overflow: "hidden",
        background: "#fff",
        height: heightPx,
        minHeight: heightPx,
        position: "relative",
      }}
    >
      <MapContainer
        key={mapKeyRef.current}
        center={center}
        zoom={initialZoom}
        style={{ height: "100%", width: "100%", minHeight: heightPx }}
        scrollWheelZoom
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Force invalidateSize après mount et visibility changes */}
        <MapInvalidateSizeHandler />

        {/* Gère le fetch initial et le centrage */}
        <MapController
          onViewportBbox={fetchBbox}
          fc={fc}
          focusParcelId={focusParcelId}
        />

        {/* Gestion des événements move/zoom */}
        <MapMoveHandler onViewportBbox={fetchBbox} />

        {/* Parcelles du cadastre */}
        {fc?.features?.length > 0 && (
          <ParcelLayer
            data={fc}
            selectedIds={selectedIds}
            onToggleParcel={onToggleParcel}
          />
        )}

        {/* Overlay vert pour les parcelles sélectionnées */}
        {selectedParcels.length > 0 && (
          <SelectedParcelsOverlay
            selectedParcels={selectedParcels}
            cadastreFeatures={fc}
          />
        )}
      </MapContainer>

      {/* Debug overlay */}
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          padding: "8px 12px",
          borderRadius: 8,
          background: "rgba(30, 41, 59, 0.9)",
          color: "#e2e8f0",
          fontSize: 11,
          fontFamily: "monospace",
          lineHeight: 1.5,
          zIndex: 1000,
          maxWidth: 280,
          wordBreak: "break-all",
        }}
      >
        <div><strong>Parcelles:</strong> {fc.features.length}{backendCount !== null && ` (backend: ${backendCount})`}</div>
        <div><strong>Sélectionnées:</strong> {selectedIds.length}</div>
        <div><strong>Commune:</strong> {communeInsee || "(non définie)"}</div>
        {focusParcelId && <div><strong>Focus:</strong> {focusParcelId}</div>}
      </div>

      {loading && (
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            padding: "6px 10px",
            borderRadius: 10,
            background: "rgba(15,23,42,0.88)",
            color: "white",
            fontSize: 12,
            fontWeight: 700,
            zIndex: 1000,
          }}
        >
          Chargement des parcelles…
        </div>
      )}

      {emptyWarning && !error && !loading && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            right: 10,
            padding: "8px 10px",
            borderRadius: 10,
            background: "rgba(254, 249, 195, 0.95)",
            border: "1px solid #fde047",
            color: "#854d0e",
            fontSize: 12,
            fontWeight: 600,
            zIndex: 1000,
          }}
        >
          ⚠️ {emptyWarning}
        </div>
      )}

      {error && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            right: 10,
            padding: "8px 10px",
            borderRadius: 10,
            background: "rgba(254,242,242,0.95)",
            border: "1px solid #fecaca",
            color: "#991b1b",
            fontSize: 12,
            fontWeight: 700,
            zIndex: 1000,
          }}
        >
          ❌ {error}
        </div>
      )}
    </div>
  );
}