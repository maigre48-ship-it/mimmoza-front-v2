import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { FeatureCollection } from 'geojson';
import type { DossierParcel } from './parcelDossier';

export type CadastreFeature = {
  type: 'Feature';
  geometry: unknown;
  properties?: { idu?: string; contenance?: number | string };
};
type GpuFeature = { type: 'Feature'; geometry: unknown; properties?: Record<string, unknown> };
type LayerData = { features: GpuFeature[]; available: boolean };

interface Props {
  point: { lat: number; lon: number };
  detectedId: string | null;
  selected: DossierParcel[];
  onChange: (parcels: DossierParcel[]) => void;
  onFeaturesLoaded?: (features: CadastreFeature[]) => void;
}

function parcelOf(feature: CadastreFeature): DossierParcel | null {
  const id = feature.properties?.idu;
  if (typeof id !== 'string' || !/^[0-9A-Z]{14}$/i.test(id)) return null;
  const raw = feature.properties?.contenance;
  const area = raw == null || raw === '' ? null : Number(raw);
  return { id, areaM2: area !== null && Number.isFinite(area) && area >= 0 ? area : null };
}

function collection(features: Array<CadastreFeature | GpuFeature>): FeatureCollection {
  return { type: 'FeatureCollection', features } as unknown as FeatureCollection;
}

function labelOf(feature: GpuFeature): string {
  const p = feature.properties ?? {};
  return [p.libelle, p.nomsuplitt, p.nomass, p.nom].find((value) => typeof value === 'string' && value.trim()) as string | undefined ?? 'Couche GPU';
}

async function gpuAtPoint(layer: 'zone-urba' | 'prescription-surf', point: Props['point'], signal: AbortSignal): Promise<LayerData> {
  const geom = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [point.lon, point.lat] }));
  try {
    const response = await fetch(`https://apicarto.ign.fr/api/gpu/${layer}?geom=${geom}`, { signal });
    if (!response.ok) return { features: [], available: false };
    const result = await response.json();
    if (!Array.isArray(result?.features)) return { features: [], available: false };
    return { features: result.features.filter((f: GpuFeature) => f?.geometry).slice(0, 20), available: true };
  } catch {
    return { features: [], available: false };
  }
}

export function DossierParcelMap({ point, detectedId, selected, onChange, onFeaturesLoaded }: Props) {
  const [radiusM, setRadiusM] = useState(100);
  const [features, setFeatures] = useState<CadastreFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zone, setZone] = useState<LayerData>({ features: [], available: false });
  const [prescriptions, setPrescriptions] = useState<LayerData>({ features: [], available: false });
  const [showZone, setShowZone] = useState(false);
  const [showPrescriptions, setShowPrescriptions] = useState(true);
  const selectedIds = useMemo(() => new Set(selected.map((parcel) => parcel.id)), [selected]);

  useEffect(() => {
    const controller = new AbortController();
    const latDelta = radiusM / 111_000;
    const lonDelta = radiusM / (111_000 * Math.cos(point.lat * Math.PI / 180));
    const west = point.lon - lonDelta, east = point.lon + lonDelta;
    const south = point.lat - latDelta, north = point.lat + latDelta;
    const geom = encodeURIComponent(JSON.stringify({ type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] }));
    queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setError(null); } });
    fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?geom=${geom}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Cadastre indisponible (${response.status})`);
        return response.json();
      })
      .then((result) => {
        const items = Array.isArray(result?.features) ? result.features.filter((f: CadastreFeature) => f?.geometry).slice(0, 400) as CadastreFeature[] : [];
        setFeatures(items);
        onFeaturesLoaded?.(items);
        if (!items.length) setError('Aucune parcelle trouvée autour du point d’adresse.');
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'Chargement du cadastre impossible.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [point.lat, point.lon, radiusM, onFeaturesLoaded]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([gpuAtPoint('zone-urba', { lat: point.lat, lon: point.lon }, controller.signal), gpuAtPoint('prescription-surf', { lat: point.lat, lon: point.lon }, controller.signal)])
      .then(([zoneResult, prescriptionResult]) => {
        if (!controller.signal.aborted) { setZone(zoneResult); setPrescriptions(prescriptionResult); }
      });
    return () => controller.abort();
  }, [point.lat, point.lon]);

  const parcels = features.map(parcelOf).filter((parcel): parcel is DossierParcel => Boolean(parcel));
  const toggle = (parcel: DossierParcel) => onChange(selectedIds.has(parcel.id)
    ? selected.filter((item) => item.id !== parcel.id) : [...selected, parcel]);

  return <div className="mzia-dossier-map-wrap">
    <div className="mzia-dossier-section-heading"><div><span className="mzia-dossier-eyebrow">1 · Situer le bien</span><h4>Plan cadastral autour de l’adresse</h4></div><span className="mzia-dossier-map-count">{loading ? 'Chargement…' : `${parcels.length} parcelles voisines`}</span></div>
    <div className="mzia-dossier-map-toolbar">
      <div className="mzia-dossier-map-toggles">
        <label><input type="checkbox" checked={showZone} onChange={(event) => setShowZone(event.target.checked)} disabled={!zone.features.length} /> Zone PLU</label>
        <label><input type="checkbox" checked={showPrescriptions} onChange={(event) => setShowPrescriptions(event.target.checked)} disabled={!prescriptions.features.length} /> Prescriptions GPU</label>
      </div>
      <button type="button" onClick={() => setRadiusM((n) => n === 100 ? 250 : n === 250 ? 500 : 100)} aria-label={`Rayon de recherche actuel ${radiusM} mètres, agrandir`}>Rayon {radiusM} m</button>
    </div>
    {error && <p role="status" className="mzia-dossier-error">{error}</p>}
    <div className="mzia-dossier-map">
      <MapContainer center={[point.lat, point.lon]} zoom={18} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {showZone && zone.features.length > 0 && <GeoJSON key={`zone-${point.lat}-${point.lon}`} data={collection(zone.features)} style={{ color: '#6366f1', weight: 2, fillColor: '#818cf8', fillOpacity: 0.14 }} onEachFeature={(feature, layer) => layer.bindTooltip(`Zone PLU : ${labelOf(feature as GpuFeature)}`)} />}
        {showPrescriptions && prescriptions.features.length > 0 && <GeoJSON key={`prescriptions-${point.lat}-${point.lon}`} data={collection(prescriptions.features)} style={{ color: '#c2410c', weight: 2, dashArray: '5 5', fillColor: '#fb923c', fillOpacity: 0.21 }} onEachFeature={(feature, layer) => layer.bindTooltip(`Prescription GPU : ${labelOf(feature as GpuFeature)}`)} />}
        {features.length > 0 && <GeoJSON key={`${radiusM}:${selected.map((item) => item.id).join(',')}`} data={collection(features)}
          style={(feature) => {
            const parcel = parcelOf(feature as CadastreFeature);
            const isSelected = parcel ? selectedIds.has(parcel.id) : false;
            const isDetected = parcel?.id === detectedId;
            return { color: isSelected ? '#047857' : isDetected ? '#b45309' : '#475569', weight: isSelected ? 3.5 : isDetected ? 3 : 1.1, fillColor: isSelected ? '#10b981' : isDetected ? '#f59e0b' : '#cbd5e1', fillOpacity: isSelected ? 0.35 : isDetected ? 0.3 : 0.04 };
          }}
          onEachFeature={(feature, layer) => {
            const parcel = parcelOf(feature as CadastreFeature);
            if (!parcel) return;
            layer.bindTooltip(`${parcel.id} · ${parcel.areaM2 ?? '?'} m² · cliquer pour ${selectedIds.has(parcel.id) ? 'retirer' : 'sélectionner'}`);
            layer.on('click', () => toggle(parcel));
          }} />}
        <CircleMarker center={[point.lat, point.lon]} radius={6} pathOptions={{ color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 }}><Tooltip>Point d’adresse, pas le périmètre du bien</Tooltip></CircleMarker>
      </MapContainer>
    </div>
    <div className="mzia-dossier-map-legend"><span><i className="mzia-map-dot mzia-map-dot--point" /> Point d’adresse</span><span><i className="mzia-map-dot mzia-map-dot--detected" /> Parcelle repérée</span><span><i className="mzia-map-dot mzia-map-dot--selected" /> Parcelles choisies</span>{showPrescriptions && prescriptions.features.length > 0 && <span><i className="mzia-map-dot mzia-map-dot--prescription" /> Prescription GPU</span>}</div>
    <p className="mzia-dossier-help">Cliquez sur les parcelles qui composent réellement le bien. Les couches GPU sont interrogées au point d’adresse ; leur affichage ne remplace pas le plan réglementaire détaillé du PPRI ni la vérification des parcelles sélectionnées. {!zone.available || !prescriptions.available ? 'Une ou plusieurs couches GPU sont indisponibles pour cette carte.' : ''}</p>
    {selected.length > 0 && <ul className="mzia-dossier-selected">{selected.map((parcel) => <li key={parcel.id}><span>{parcel.id} · {parcel.areaM2 == null ? 'surface inconnue' : `${parcel.areaM2.toLocaleString('fr-FR')} m²`}</span><button type="button" onClick={() => toggle(parcel)} aria-label={`Retirer la parcelle ${parcel.id}`}>Retirer</button></li>)}</ul>}
  </div>;
}
