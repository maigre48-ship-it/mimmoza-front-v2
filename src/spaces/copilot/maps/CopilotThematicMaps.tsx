import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, CircleMarker, GeoJSON, MapContainer, Pane, ScaleControl, TileLayer, Tooltip, WMSTileLayer, useMap } from 'react-leaflet';
import type { FeatureCollection, Feature } from 'geojson';
import type { ActiveToolCall } from '../types/copilot.types';
import { THEMES, WMS_URL, featureLabel, legendUrl, mapAnchors, noiseProperties, searchPolygon, validGeometry, type MapAnchor, type ThemeId } from './thematicMapModel';
import 'leaflet/dist/leaflet.css';
import './CopilotThematicMaps.css';
type Layer = { id: string; label: string; color: string; features: Feature[]; error: boolean; truncated: boolean };
function MapViewport({ point, radius }: { point: MapAnchor; radius: number }) {
  const map = useMap();
  useEffect(() => {
    const ring = searchPolygon(point, radius).coordinates[0];
    map.fitBounds([[ring[0][1],ring[0][0]], [ring[2][1],ring[2][0]]]);
    const observer = new ResizeObserver(() => map.invalidateSize()); observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map, point, radius]);
  return null;
}
function OfficialLayer({ id, opacity, onState }: { id: string; opacity: number; onState: (id:string,state:string) => void }) {
  const failed = useRef(false);
  return <WMSTileLayer url={WMS_URL} layers={id} format="image/png" transparent version="1.3.0" opacity={opacity} attribution="Géorisques / BRGM" eventHandlers={{ loading: () => { failed.current = false; onState(id,'Chargement…'); }, tileerror: () => { failed.current = true; onState(id,'Certaines tuiles sont indisponibles'); }, load: () => onState(id,failed.current ? 'Certaines tuiles sont indisponibles' : 'Couche consultée') }} />;
}
export function CopilotThematicMaps({ calls, onSend }: { calls: ActiveToolCall[]; onSend?: (text: string) => void }) {
  const anchors = useMemo(() => mapAnchors(calls), [calls]);
  const [anchorIndex, setAnchorIndex] = useState(0);
  const point = anchors[Math.min(anchorIndex, anchors.length - 1)];
  const [themeId, setThemeId] = useState<ThemeId>('flood');
  const [selected, setSelected] = useState<string[]>([THEMES[0].layers[0].id]);
  const [radius, setRadius] = useState(1000);
  const [opacity, setOpacity] = useState(0.65);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [visibleGpu, setVisibleGpu] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(true);
  const [baseError, setBaseError] = useState(false);
  const [statuses, setStatuses] = useState<Record<string,string>>({});
  const onLayerState = useCallback((id:string,state:string) => setStatuses(prev => prev[id] === state ? prev : {...prev,[id]:state}), []);
  const theme = THEMES.find(t => t.id === themeId)!;
  useEffect(() => {
    if (!point || !opened || !['noise','urbanism'].includes(themeId)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    let disposed = false;
    setLoading(true); setLayers([]);
    const endpoints = themeId === 'noise' ? ['info-surf','prescription-surf'] : ['zone-urba','prescription-surf','assiette-sup-s'];
    const geom = encodeURIComponent(JSON.stringify(searchPolygon(point, radius)));
    void Promise.all(endpoints.map(async (id): Promise<Layer> => {
      const label = id === 'zone-urba' ? 'Zones PLU' : id === 'assiette-sup-s' ? 'Servitudes' : themeId === 'noise' ? `Secteurs sonores · ${id === 'info-surf' ? 'informations' : 'prescriptions'}` : 'Prescriptions';
      const color = themeId === 'noise' ? '#c2410c' : id === 'zone-urba' ? '#6d28d9' : id === 'assiette-sup-s' ? '#be185d' : '#d97706';
      try {
        const response = await fetch(`https://apicarto.ign.fr/api/gpu/${id}?geom=${geom}`, { signal: controller.signal });
        if (!response.ok) throw new Error('GPU indisponible');
        const json = await response.json();
        if (!Array.isArray(json.features)) throw new Error('Réponse illisible');
        const all = json.features.filter((f: Feature) => f?.type === 'Feature' && validGeometry(f.geometry) && (themeId !== 'noise' || noiseProperties(f.properties)));
        return { id, label, color, features: all.slice(0,300), error:false, truncated: all.length > 300 || Number(json.totalFeatures ?? json.numberMatched) > json.features.length || json.features.some((f:Feature) => !validGeometry(f.geometry)) };
      } catch { return { id, label, color, features: [], error:true, truncated:false }; }
    })).then(results => { if (!disposed) { clearTimeout(timer); setLayers(results); setLoading(false); } });
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [point, themeId, radius, opened]);
  const choose = (id: ThemeId) => { const next = THEMES.find(t => t.id === id)!; setThemeId(id); setSelected(next.layers.length ? [next.layers[0].id] : []); setVisibleGpu(id === 'noise' ? ['info-surf','prescription-surf'] : ['zone-urba']); setLayers([]); setStatuses({}); };
  return <section className="copilot-thematic-maps" aria-label="Cartes thématiques de l’étude">
    <header><div><span>EXPLORER LE TERRAIN</span><h3>Cartes par thème</h3></div><button type="button" onClick={() => setOpened(!opened)} aria-expanded={opened}>{opened ? 'Réduire' : 'Afficher les cartes'}</button></header>
    {opened && <>{!point ? <div className="copilot-map-missing"><p>Un point d’adresse ou de parcelle vérifié est nécessaire pour centrer les cartes. Les seules mentions de risques ne permettent pas de dessiner une zone.</p>{onSend && <button type="button" onClick={() => onSend('Localise précisément le terrain de cette étude avec l’outil adresse vers parcelle pour afficher les cartes thématiques. Si l’adresse exacte manque, demande-la-moi.')}>Localiser le terrain</button>}</div> : <>
      <div className="copilot-map-location">{anchors.length > 1 ? <label>Lieu <select value={anchorIndex} onChange={e => setAnchorIndex(Number(e.target.value))}>{anchors.map((a,i) => <option key={i} value={i}>{a.label} · {a.precision}</option>)}</select></label> : <strong>{point.label}</strong>}<small>{point.precision} · {point.lat.toFixed(5)}, {point.lon.toFixed(5)}</small></div>
      <div className="copilot-map-tabs" role="group" aria-label="Choisir le thème">{THEMES.map(t => <button key={t.id} type="button" aria-pressed={themeId === t.id} onClick={() => choose(t.id)}>{t.label}</button>)}</div>
      <div className="copilot-map-controls"><label>Périmètre <select value={radius} onChange={e => setRadius(Number(e.target.value))}><option value={500}>500 m</option><option value={1000}>1 km</option><option value={3000}>3 km</option><option value={5000}>5 km</option></select></label><label>Opacité <input type="range" min="0.2" max="1" step="0.05" value={opacity} onChange={e => setOpacity(Number(e.target.value))} /></label></div>
      {theme.layers.length > 0 && <div className="copilot-map-toggles">{theme.layers.map(l => <label key={l.id}><input type="checkbox" checked={selected.includes(l.id)} onChange={() => setSelected(prev => prev.includes(l.id) ? prev.filter(id => id !== l.id) : [...prev,l.id])} />{l.label}</label>)}</div>}
      {layers.length > 0 && <div className="copilot-map-toggles">{layers.map(l => <label key={l.id}><input type="checkbox" disabled={l.error} checked={visibleGpu.includes(l.id)} onChange={() => setVisibleGpu(prev => prev.includes(l.id) ? prev.filter(id => id !== l.id) : [...prev,l.id])} /><i style={{background:l.color}} />{l.label}</label>)}</div>}
      <div className="copilot-map-canvas"><MapContainer center={[point.lat,point.lon]} zoom={14} scrollWheelZoom={false} style={{ width:'100%', height:'100%' }}>
        <MapViewport point={point} radius={radius} />
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' eventHandlers={{ tileerror: () => setBaseError(true) }} />
        {selected.map(id => <OfficialLayer key={`${id}:${point.lat}:${point.lon}`} id={id} opacity={opacity} onState={onLayerState} />)}
        {layers.filter(l => visibleGpu.includes(l.id) && !l.error && l.features.length > 0).map(l => <GeoJSON key={`${themeId}:${l.id}:${point.lat}:${point.lon}:${radius}`} data={{ type:'FeatureCollection', features:l.features } as FeatureCollection} style={{ color:l.color, weight:2, fillColor:l.color, fillOpacity:opacity * .35 }} onEachFeature={(f,layer) => { const tip = document.createElement('span'); tip.textContent = `${l.label} : ${featureLabel(f.properties)}`; layer.bindTooltip(tip); }} />)}
        <Pane name="study-reference" style={{ zIndex:620 }}>
        <Circle center={[point.lat,point.lon]} radius={radius} pathOptions={{ color:'#475569', weight:1, dashArray:'5 5', fill:false }} />
        <CircleMarker center={[point.lat,point.lon]} radius={7} pathOptions={{ color:'#fff', weight:3, fillColor:'#0f172a', fillOpacity:1 }}><Tooltip>{point.label} · {point.precision}</Tooltip></CircleMarker></Pane><ScaleControl position="bottomleft" imperial={false} />
      </MapContainer></div>
      {baseError && <p className="copilot-map-note" role="status">Le fond de carte est partiellement indisponible.</p>}
      <div className="copilot-map-legend"><strong>Lecture de la carte</strong><p>● Point de référence · cercle pointillé : périmètre de consultation</p>{selected.map(id => <details key={id} open={selected.length === 1}><summary>{theme.layers.find(l => l.id === id)?.label} · légende officielle</summary><p role="status">{statuses[id] ?? 'Chargement…'}</p><img src={legendUrl(id)} alt={`Légende officielle ${id}`} onError={e => { e.currentTarget.hidden = true; }} /><a href={legendUrl(id)} target="_blank" rel="noopener noreferrer">Ouvrir la légende</a></details>)}{loading && <p role="status">Consultation des couches GPU…</p>}{layers.map(l => <p key={l.id}><i style={{ background:l.color }} />{l.label} : {l.error ? 'source indisponible' : `${l.features.length} géométrie(s) reçue(s)`}{l.truncated ? ' · affichage partiel' : ''}</p>)}</div>
      <p className="copilot-map-note">{theme.note} Une carte sans symbole ou zone colorée ne prouve pas l’absence de risque ou de nuisance. Les couches sont consultées en direct ; elles peuvent être plus récentes que la réponse du tchat.</p>
      <footer>Source : {theme.layers.length ? <a href="https://www.georisques.gouv.fr/cartes-interactives" target="_blank" rel="noopener noreferrer">Géorisques / BRGM</a> : <a href="https://www.geoportail-urbanisme.gouv.fr/" target="_blank" rel="noopener noreferrer">Géoportail de l’urbanisme · API Carto IGN</a>} · fond OpenStreetMap</footer>
    </>}</>}
  </section>;
}
