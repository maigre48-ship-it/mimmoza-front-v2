import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, GeoJSON, useMapEvents, useMap } from "react-leaflet";
import type { FeatureCollection, Feature } from "geojson";
import L from "leaflet";
import { supabase } from "../../../supabaseClient";
import turfArea from "@turf/area";

// Import explicite de la CSS Leaflet pour garantir l'affichage correct
import "leaflet/dist/leaflet.css";

type BBox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

type Props = {
  communeInsee: string;
  selectedIds: string[];
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

  // Style par défaut (parcelle non sélectionnée) - COMPLET avec couleurs visibles
  const defaultStyle = useMemo(
    () => ({
      color: "#2563eb",        // stroke bleu
      opacity: 0.9,            // opacité du contour
      weight: 2,               // épaisseur du contour
      fillColor: "#60a5fa",    // remplissage bleu clair
      fillOpacity: 0.18,       // opacité du remplissage
    }),
    [],
  );

  // Style sélectionné - COMPLET avec couleurs vertes visibles
  const selectedStyle = useMemo(
    () => ({
      color: "#16a34a",        // stroke vert
      opacity: 1,              // opacité du contour
      weight: 3,               // épaisseur du contour
      fillColor: "#86efac",    // remplissage vert clair
      fillOpacity: 0.35,       // opacité du remplissage
    }),
    [],
  );

  // Style hover pour parcelle non sélectionnée
  const hoverDefaultStyle = useMemo(
    () => ({
      color: "#2563eb",
      opacity: 1,
      weight: 3,
      fillColor: "#60a5fa",
      fillOpacity: 0.28,
    }),
    [],
  );

  // Style hover pour parcelle sélectionnée
  const hoverSelectedStyle = useMemo(
    () => ({
      color: "#16a34a",
      opacity: 1,
      weight: 4,
      fillColor: "#86efac",
      fillOpacity: 0.45,
    }),
    [],
  );

  const onEachFeature = (feature: any, layer: L.Layer) => {
    const pid = getParcelIdFromFeature(feature);
    if (!pid) return;

    const isSelected = selectedSet.has(pid);

    // @ts-ignore
    layer.setStyle?.(isSelected ? selectedStyle : defaultStyle);

    layer.on("mouseover", () => {
      // @ts-ignore
      layer.setStyle?.(isSelected ? hoverSelectedStyle : hoverDefaultStyle);
    });

    layer.on("mouseout", () => {
      // @ts-ignore
      layer.setStyle?.(isSelected ? selectedStyle : defaultStyle);
    });

    layer.on("click", () => {
      const area_m2 = computeAreaM2(feature);
      onToggleParcel(pid, feature, area_m2);
    });
  };

  // IMPORTANT: GeoJSON de react-leaflet ne rerend pas toujours le style par feature.
  // On force un key qui change quand la sélection change pour rafraîchir.
  const key = useMemo(() => selectedIds.join("|"), [selectedIds]);

  return (
    <GeoJSON
      key={key}
      data={data as any}
      onEachFeature={onEachFeature as any}
      style={() => defaultStyle as any}
    />
  );
}

function MapEvents({
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

/**
 * Composant interne pour :
 * 1) Stocker la référence map dans mapRef (via useMap)
 * 2) Déclencher le fetch initial IMMÉDIATEMENT au montage (sans délai bloquant)
 * 3) Centrer sur la parcelle focus dès qu'elle est disponible dans fc
 *
 * FIX PRINCIPAL : Le centrage ne dépend plus de lastBboxKey.
 * On utilise uniquement focusParcelId comme clé de contrôle.
 * Ainsi, dès que la feature focus apparaît dans fc, on centre dessus une seule fois.
 */
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

  // Ref pour éviter de refaire le fetch initial plusieurs fois
  const didInitialFetchRef = useRef(false);

  // Ref pour éviter de recentrer en boucle sur la même parcelle
  // Clé = focusParcelId pour lequel on a déjà fait un fitBounds
  const didFitForParcelRef = useRef<string | null>(null);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1) FETCH INITIAL : déclenché une seule fois dès que la map est prête
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map || didInitialFetchRef.current) return;

    didInitialFetchRef.current = true;

    // FIX: On utilise requestAnimationFrame pour s'assurer que la map est rendue
    // avant de lire ses bounds. Cela évite les problèmes de timing au montage.
    requestAnimationFrame(() => {
      const bbox = boundsToBBox(map.getBounds());
      console.log("[ParcelMapSelector] Initial fetch triggered immediately with bbox:", bbox);
      onViewportBbox(bbox);
    });
  }, [map, onViewportBbox]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 2) CENTRAGE AUTOMATIQUE : dès que focusParcelId est trouvé dans fc
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !focusParcelId || fc.features.length === 0) return;

    // FIX: On ne dépend plus de lastBboxKey. On utilise uniquement focusParcelId.
    // Cela garantit que le centrage se fait dès que la feature est disponible,
    // sans attendre un changement de bbox.
    if (didFitForParcelRef.current === focusParcelId) {
      // Déjà centré sur cette parcelle, ne pas refaire
      return;
    }

    // Rechercher la feature correspondant à focusParcelId
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

        // Marquer comme "déjà centré" AVANT d'appeler fitBounds
        // pour éviter tout re-déclenchement pendant l'animation
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

  // ─────────────────────────────────────────────────────────────────────────────
  // 3) RESET de la ref de centrage si focusParcelId change
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Si focusParcelId change (nouvelle recherche), on autorise un nouveau centrage
    if (focusParcelId && didFitForParcelRef.current !== focusParcelId) {
      // Ne pas reset à null, laisser l'effet de centrage faire son travail
    }
  }, [focusParcelId]);

  return null;
}

/**
 * Gère les événements move/zoom pour re-fetch les parcelles
 * (séparé de MapController pour clarté)
 */
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

export default function ParcelMapSelector({
  communeInsee,
  selectedIds,
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

  // Debug state
  const [lastBboxKey, setLastBboxKey] = useState<string>("");
  const [backendCount, setBackendCount] = useState<number | null>(null);

  const cacheRef = useRef<Map<string, FeatureCollection>>(new Map());
  const lastKeyRef = useRef<string>("");

  // Ref pour tracker quels selectedIds ont déjà été enrichis (éviter appels en boucle)
  const enrichedIdsRef = useRef<Set<string>>(new Set());

  const center = useMemo(() => {
    if (initialCenter?.lat != null && initialCenter?.lon != null) {
      return [initialCenter.lat, initialCenter.lon] as [number, number];
    }
    // fallback : centre approximatif (Ascain)
    return [43.345, -1.621] as [number, number];
  }, [initialCenter]);

  const fetchBbox = useCallback(async (bbox: BBox) => {
    if (!communeInsee) {
      console.log("[ParcelMapSelector] fetchBbox skipped: no communeInsee");
      return;
    }

    const key = `${communeInsee}::${makeBboxKey(bbox)}`;
    setLastBboxKey(key);

    // éviter de re-fetch si bbox identique
    if (lastKeyRef.current === key) {
      console.log("[ParcelMapSelector] fetchBbox skipped: same key", key);
      return;
    }
    lastKeyRef.current = key;

    // cache local
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

      // Track backend count if available
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

      // Si success=true mais 0 features, afficher un warning non-bloquant
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

  // Auto-enrichissement des parcelles sélectionnées avec leur surface
  useEffect(() => {
    if (!onAutoEnrichSelected || fc.features.length === 0 || selectedIds.length === 0) return;

    const updates: { id: string; area_m2: number | null }[] = [];

    for (const pid of selectedIds) {
      // Éviter de ré-enrichir une parcelle déjà traitée
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

  // reset cache si commune change
  useEffect(() => {
    console.log("[ParcelMapSelector] Commune changed to:", communeInsee, "- clearing cache");
    cacheRef.current.clear();
    lastKeyRef.current = "";
    enrichedIdsRef.current.clear();
    setFc({ type: "FeatureCollection", features: [] });
    setLastBboxKey("");
    setBackendCount(null);
    setEmptyWarning(null);
  }, [communeInsee]);

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        overflow: "hidden",
        background: "#fff",
        height: heightPx,
        position: "relative",
      }}
    >
      <MapContainer
        center={center}
        zoom={initialZoom}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/*
          MapController unifié :
          - Déclenche le fetch initial via requestAnimationFrame (sans délai arbitraire)
          - Centre automatiquement sur focusParcelId dès que la feature est disponible
          - Utilise des refs pour éviter les re-déclenchements en boucle
        */}
        <MapController
          onViewportBbox={fetchBbox}
          fc={fc}
          focusParcelId={focusParcelId}
        />

        {/* Gestion des événements move/zoom pour re-fetch */}
        <MapMoveHandler onViewportBbox={fetchBbox} />

        {fc?.features?.length > 0 && (
          <ParcelLayer
            data={fc}
            selectedIds={selectedIds}
            onToggleParcel={onToggleParcel}
          />
        )}
      </MapContainer>

      {/* Debug overlay - toujours visible */}
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
        <div><strong>Bbox key:</strong> {lastBboxKey || "(aucune)"}</div>
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

      {/* Warning non-bloquant pour 0 parcelles */}
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