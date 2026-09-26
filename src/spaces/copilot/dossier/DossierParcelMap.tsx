import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { DossierParcel } from './parcelDossier';
import type { FeatureCollection } from 'geojson';

interface Props {
  point: { lat: number; lon: number };
  detectedId: string | null;
  selected: DossierParcel[];
  onChange: (parcels: DossierParcel[]) => void;
}

type CadastreFeature = {
  type: 'Feature';
  geometry: unknown;
  properties?: { idu?: string; contenance?: number | string };
};

function parcelOf(feature: CadastreFeature): DossierParcel | null {
  const id = feature.properties?.idu;
  if (typeof id !== 'string' || !/^[0-9A-Z]{14}$/i.test(id)) return null;
  const rawArea = Number(feature.properties?.contenance);
  return { id, areaM2: Number.isFinite(rawArea) && rawArea >= 0 ? rawArea : null };
}

export function DossierParcelMap({ point, detectedId, selected, onChange }: Props) {
  const [radiusM, setRadiusM] = useState(100);
  const [features, setFeatures] = useState<CadastreFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedIds = useMemo(() => new Set(selected.map((parcel) => parcel.id)), [selected]);

  useEffect(() => {
    const controller = new AbortController();
    const latDelta = radiusM / 111_000;
    const lonDelta = radiusM / (111_000 * Math.cos(point.lat * Math.PI / 180));
    const west = point.lon - lonDelta, east = point.lon + lonDelta;
    const south = point.lat - latDelta, north = point.lat + latDelta;
    const geom = encodeURIComponent(JSON.stringify({
      type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
    }));
    queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setError(null); } });
    fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?geom=${geom}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Cadastre indisponible (${response.status})`);
        return response.json();
      })
      .then((collection) => {
        const items = Array.isArray(collection?.features) ? collection.features as CadastreFeature[] : [];
        setFeatures(items.slice(0, 400));
        if (!items.length) setError('Aucune parcelle trouvée autour du point d’adresse.');
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'Chargement du cadastre impossible.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [point.lat, point.lon, radiusM]);

  const parcels = features.map(parcelOf).filter((parcel): parcel is DossierParcel => Boolean(parcel));
  const toggle = (parcel: DossierParcel) => {
    onChange(selectedIds.has(parcel.id)
      ? selected.filter((item) => item.id !== parcel.id)
      : [...selected, parcel]);
  };

  return <div className="mzia-dossier-map-wrap">
    <div className="mzia-dossier-map-toolbar">
      <span>{loading ? 'Chargement du cadastre…' : `${parcels.length} parcelles affichées`}</span>
      <button type="button" onClick={() => setRadiusM((n) => n === 100 ? 250 : n === 250 ? 500 : 100)}>
        Rayon {radiusM} m · agrandir
      </button>
    </div>
    {error && <p role="status" className="mzia-dossier-error">{error}</p>}
    <div className="mzia-dossier-map">
      <MapContainer center={[point.lat, point.lon]} zoom={18} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <CircleMarker center={[point.lat, point.lon]} radius={5} pathOptions={{ color: '#dc2626', fillColor: '#ef4444', fillOpacity: 1 }}>
          <Tooltip>Point d’adresse</Tooltip>
        </CircleMarker>
        {features.length > 0 && <GeoJSON
          key={`${radiusM}:${selected.map((item) => item.id).join(',')}`}
          data={{ type: 'FeatureCollection', features } as unknown as FeatureCollection}
          style={(feature) => {
            const parcel = parcelOf(feature as CadastreFeature);
            const isSelected = parcel ? selectedIds.has(parcel.id) : false;
            const isDetected = parcel?.id === detectedId;
            return {
              color: isSelected ? '#059669' : isDetected ? '#d97706' : '#6366f1',
              weight: isSelected ? 3 : isDetected ? 2.5 : 1,
              fillOpacity: isSelected ? 0.35 : isDetected ? 0.22 : 0.08,
            };
          }}
          onEachFeature={(feature, layer) => {
            const parcel = parcelOf(feature as CadastreFeature);
            if (!parcel) return;
            layer.bindTooltip(`${parcel.id} · ${parcel.areaM2 ?? '?'} m²`);
            layer.on('click', () => toggle(parcel));
          }}
        />}
      </MapContainer>
    </div>
    <p className="mzia-dossier-help">Le point rouge est l’adresse. Sélectionnez les parcelles qui composent réellement le bien ; la parcelle orange est seulement celle détectée sous ce point.</p>
    {selected.length > 0 && <ul className="mzia-dossier-selected">
      {selected.map((parcel) => <li key={parcel.id}>
        <span>{parcel.id} · {parcel.areaM2 == null ? 'surface inconnue' : `${parcel.areaM2.toLocaleString('fr-FR')} m²`}</span>
        <button type="button" onClick={() => toggle(parcel)} aria-label={`Retirer la parcelle ${parcel.id}`}>Retirer</button>
      </li>)}
    </ul>}
  </div>;
}
