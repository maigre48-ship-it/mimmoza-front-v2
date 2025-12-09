import { useEffect, useRef } from "react";
import L, {
  Map as LeafletMap,
  GeoJSON,
  PathOptions,
} from "leaflet";
import "leaflet/dist/leaflet.css";

type GeocodingCenter = { lat: number; lon: number } | null;

interface CadastreMapProps {
  center: GeocodingCenter;          // pour centrer la première fois (geocoding)
  communeInsee: string | null;      // code INSEE pour charger le cadastre
  selectedParcelIds?: string[];     // TOUTES les parcelles sélectionnées (IDU)
  onParcelClick?: (parcel: { id: string; surface: number | null }) => void;
  height?: string;
}

const SUPABASE_URL = "https://fwvrqngbafqdaekbdfnm.supabase.co";

// Helper : extraire un ID “stable” pour la parcelle (IDU)
function getParcelIdFromFeature(feature: any): string | undefined {
  const props = feature?.properties || {};
  // Dans les GeoJSON du cadastre, l’ID complet est dans properties.id
  // et également en feature.id → on prend d’abord properties.id
  return props.id ?? feature.id ?? undefined;
}

// Helper : convertir une surface quelconque en number | null
function normalizeSurface(value: any): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function CadastreMap({
  center,
  communeInsee,
  selectedParcelIds = [],
  onParcelClick,
  height = "320px",
}: CadastreMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const cadastreLayerRef = useRef<GeoJSON | null>(null);
  const selectionOutlineLayerRef = useRef<GeoJSON | null>(null);

  // -------------------------------------------------------
  // 1. Création de la carte (une seule fois)
  // -------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const initialCenter: [number, number] = center
      ? [center.lat, center.lon]
      : [46.5, 2.5];

    // Zoom assez proche si on a un geocoding
    const initialZoom = center ? 17 : 6;

    const map = L.map(containerRef.current).setView(initialCenter, initialZoom);
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // -------------------------------------------------------
  // 2. Si le center change (nouvelle adresse), on recadre UNE fois
  // -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center) return;

    map.setView([center.lat, center.lon], 17);
  }, [center]);

  // -------------------------------------------------------
  // 3. Charger le cadastre et gérer la sélection
  // -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!communeInsee) return;

    const url = `${SUPABASE_URL}/functions/v1/cadastre-geojson-proxy?insee=${communeInsee}&type=parcelles`;

    // Nettoyage des anciennes couches
    if (cadastreLayerRef.current) {
      map.removeLayer(cadastreLayerRef.current);
      cadastreLayerRef.current = null;
    }
    if (selectionOutlineLayerRef.current) {
      map.removeLayer(selectionOutlineLayerRef.current);
      selectionOutlineLayerRef.current = null;
    }

    const selectedIdsSet = new Set(selectedParcelIds);

    async function loadGeoJson() {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const geojson: any = await res.json();

        const defaultStyle: PathOptions = {
          weight: 1,
          opacity: 0.7,
          fillOpacity: 0.1,
          color: "#3b82f6", // bleu clair
        };

        const selectedStyle: PathOptions = {
          weight: 2,
          opacity: 1,
          fillOpacity: 0.25,
          color: "#1d4ed8", // bleu plus marqué
        };

        // Couche principale : toutes les parcelles, cliquables
        const baseLayer = L.geoJSON(geojson, {
          style: (feature) => {
            const idParcelle = getParcelIdFromFeature(feature);
            if (idParcelle && selectedIdsSet.has(idParcelle)) {
              return selectedStyle;
            }
            return defaultStyle;
          },
          onEachFeature: (feature, leafletLayer) => {
            const props: any = feature.properties || {};
            const idParcelle = getParcelIdFromFeature(feature);

            const rawSurface =
              props.contenance ||
              props.surface ||
              props.SURFACE ||
              null;
            const surface = normalizeSurface(rawSurface);

            leafletLayer.on("click", () => {
              leafletLayer
                .bindPopup(
                  `
                    <div style="font-size:13px;line-height:1.4;">
                      <strong>Parcelle :</strong> ${idParcelle ?? "?"}<br/>
                      <strong>Surface :</strong> ${
                        surface ?? "N/A"
                      } m²
                    </div>
                  `
                )
                .openPopup();

              if (idParcelle && onParcelClick) {
                onParcelClick({ id: idParcelle, surface });
              }
            });
          },
        }).addTo(map);

        cadastreLayerRef.current = baseLayer;

        // --------- 3.a Contour global des parcelles sélectionnées ---------
        const selectedFeatures =
          Array.isArray(geojson.features) && selectedParcelIds.length > 0
            ? geojson.features.filter((f: any) => {
                const idParcelle = getParcelIdFromFeature(f);
                return idParcelle && selectedIdsSet.has(idParcelle);
              })
            : [];

        if (selectedFeatures.length > 0) {
          const outlineStyle: PathOptions = {
            weight: 3,
            opacity: 0.9,
            fillOpacity: 0,
            color: "#1d4ed8",
            interactive: false, // ⚠️ ne bloque pas les clics
          };

          const selectionLayer = L.geoJSON(
            {
              type: "FeatureCollection",
              features: selectedFeatures,
            } as any,
            {
              style: outlineStyle,
            }
          ).addTo(map);

          selectionOutlineLayerRef.current = selectionLayer;

          // Vue FIXE : on ne change pas le zoom ici
        }

        // Pas de fitBounds global : on laisse la vue telle quelle
      } catch (err) {
        console.error("Erreur chargement cadastre :", err);
      }
    }

    loadGeoJson();
  }, [communeInsee, selectedParcelIds, onParcelClick]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height,
        borderRadius: "12px",
        border: "1px solid #e5e7eb",
        overflow: "hidden",
      }}
    />
  );
}
