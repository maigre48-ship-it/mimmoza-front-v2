// FILE: src/spaces/promoteur/etudes/marche/components/MarketStudyMap.tsx

import React, { useEffect, useRef, useState } from "react";
import type { MarketStudyResponse, Poi, PoiCategory } from "../types/marketStudy.types";
import { POI_CATEGORY_ICONS, POI_CATEGORY_LABELS } from "../types/marketStudy.types";

interface MarketStudyMapProps {
  data: MarketStudyResponse | null;
  loading: boolean;
  selectedCategories?: PoiCategory[];
  onPoiClick?: (poi: Poi) => void;
}

// Vérifier si Leaflet est disponible
let L: typeof import("leaflet") | null = null;
try {
  // @ts-expect-error - Import dynamique
  L = await import("leaflet");
} catch {
  L = null;
}

export const MarketStudyMap: React.FC<MarketStudyMapProps> = ({
  data,
  loading,
  selectedCategories,
  onPoiClick,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  // Filtrer les POIs par catégorie sélectionnée
  const filteredPois = data?.pois.all.filter(
    (poi) => !selectedCategories || selectedCategories.includes(poi.category)
  );

  // Initialisation de la carte Leaflet
  useEffect(() => {
    if (!L || !mapContainerRef.current || !data) return;

    // Détruire l'ancienne carte si elle existe
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    try {
      // Créer la carte
      const map = L.map(mapContainerRef.current).setView(
        [data.location.lat, data.location.lon],
        13
      );

      // Ajouter le layer OpenStreetMap
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Marqueur central (position de l'étude)
      const centerIcon = L.divIcon({
        html: '<div style="font-size: 24px;">📍</div>',
        className: "center-marker",
        iconSize: [30, 30],
        iconAnchor: [15, 30],
      });

      L.marker([data.location.lat, data.location.lon], { icon: centerIcon })
        .addTo(map)
        .bindPopup(
          `<strong>${data.location.commune_nom || "Centre"}</strong><br/>Point d'étude`
        );

      // Cercle du rayon
      L.circle([data.location.lat, data.location.lon], {
        radius: data.context.radius_km * 1000,
        color: "#3b82f6",
        fillColor: "#3b82f6",
        fillOpacity: 0.1,
        weight: 2,
      }).addTo(map);

      // Ajouter les POIs
      if (filteredPois) {
        for (const poi of filteredPois.slice(0, 100)) {
          // Limiter à 100 marqueurs
          const icon = L.divIcon({
            html: `<div style="font-size: 16px;">${POI_CATEGORY_ICONS[poi.category]}</div>`,
            className: "poi-marker",
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          });

          const marker = L.marker([poi.lat, poi.lon], { icon }).addTo(map);

          marker.bindPopup(
            `<strong>${poi.name || POI_CATEGORY_LABELS[poi.category]}</strong><br/>
             ${POI_CATEGORY_LABELS[poi.category]}<br/>
             Distance: ${poi.distance_km.toFixed(2)} km`
          );

          if (onPoiClick) {
            marker.on("click", () => onPoiClick(poi));
          }
        }
      }

      // Ajuster la vue
      map.fitBounds([
        [
          data.location.lat - data.context.radius_km / 111,
          data.location.lon - data.context.radius_km / 85,
        ],
        [
          data.location.lat + data.context.radius_km / 111,
          data.location.lon + data.context.radius_km / 85,
        ],
      ]);

      mapRef.current = map;
    } catch (err) {
      console.error("Leaflet error:", err);
      setMapError("Erreur lors de l'initialisation de la carte");
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [data, filteredPois, onPoiClick]);

  // Affichage pendant le chargement
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow h-96 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-gray-500">Chargement de la carte...</p>
        </div>
      </div>
    );
  }

  // Si pas de données
  if (!data) {
    return (
      <div className="bg-white rounded-lg shadow h-96 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <p className="text-4xl mb-2">🗺️</p>
          <p>La carte s'affichera après le lancement de l'étude</p>
        </div>
      </div>
    );
  }

  // Fallback si Leaflet n'est pas disponible
  if (!L || mapError) {
    return (
      <FallbackMap
        data={data}
        filteredPois={filteredPois || []}
        error={mapError}
      />
    );
  }

  // Carte Leaflet
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div ref={mapContainerRef} className="h-96 w-full" />
      <div className="p-2 bg-gray-50 text-xs text-gray-500 flex justify-between">
        <span>
          {filteredPois?.length || 0} points affichés (max 100)
        </span>
        <span>Rayon: {data.context.radius_km} km</span>
      </div>
    </div>
  );
};

// Composant fallback sans Leaflet
interface FallbackMapProps {
  data: MarketStudyResponse;
  filteredPois: Poi[];
  error?: string | null;
}

const FallbackMap: React.FC<FallbackMapProps> = ({
  data,
  filteredPois,
  error,
}) => {
  // Lien vers OpenStreetMap externe
  const osmUrl = `https://www.openstreetmap.org/?mlat=${data.location.lat}&mlon=${data.location.lon}#map=13/${data.location.lat}/${data.location.lon}`;

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Message */}
      <div className="bg-yellow-50 border-b border-yellow-100 p-3">
        <p className="text-sm text-yellow-800">
          ⚠️ {error || "Carte interactive non disponible. Affichage simplifié."}
        </p>
      </div>

      {/* Coordonnées et lien */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900">
              📍 {data.location.commune_nom || "Position"}
            </h3>
            <p className="text-sm text-gray-500">
              {data.location.lat.toFixed(6)}, {data.location.lon.toFixed(6)}
            </p>
          </div>
          <a
            href={osmUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Voir sur OpenStreetMap ↗
          </a>
        </div>

        {/* Liste des POIs les plus proches */}
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700">
            POIs les plus proches ({Math.min(filteredPois.length, 10)} /{" "}
            {filteredPois.length})
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filteredPois.slice(0, 10).map((poi) => (
              <div
                key={poi.id}
                className="px-3 py-2 border-t border-gray-100 flex items-center justify-between hover:bg-gray-50"
              >
                <div className="flex items-center gap-2">
                  <span>{POI_CATEGORY_ICONS[poi.category]}</span>
                  <span className="text-sm text-gray-900">
                    {poi.name || POI_CATEGORY_LABELS[poi.category]}
                  </span>
                </div>
                <span className="text-xs text-gray-500">
                  {poi.distance_km.toFixed(2)} km
                </span>
              </div>
            ))}
            {filteredPois.length === 0 && (
              <div className="px-3 py-4 text-center text-gray-500 text-sm">
                Aucun POI dans cette zone
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketStudyMap;