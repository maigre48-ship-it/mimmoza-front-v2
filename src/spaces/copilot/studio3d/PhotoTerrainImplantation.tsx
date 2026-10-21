import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Download, LocateFixed, MapPinned, X } from 'lucide-react';
import type { JarvisMassing } from './jarvisDraft';
import { footprintFits, footprintPoints, parcelBoundaryDistanceMeters, parcelContains, parcelDistanceMeters, parcelId, parcelLabel, type GpsPoint, type TerrainParcel } from './parcelFromGps';
import { searchIgnParcels } from './terrainCadastre';
import type { ConfirmedTerrain } from './terrainCadastre';
import { verifierRapport360 } from '@/spaces/promoteur/shared/environnement360';
import { JarvisMassingPreview } from './JarvisMassingPreview';
import { chargerReliefMesure, type TerrainStudio } from '@/spaces/promoteur/shared/ouvrirStudio3D';
import { estimateJarvisEarthworks, type JarvisEarthworkEstimate } from './terrainEarthworks';
import { calculateAccessRoute, snapAccessToBoundary, type AccessGate, type AccessKind, type AccessRoute } from './accessRoutes';
import './PhotoTerrainImplantation.css';

function rings(parcel: TerrainParcel): number[][][] {
  return parcel.geometry.type === 'Polygon' ? parcel.geometry.coordinates as number[][][]
    : parcel.geometry.coordinates.flatMap(polygon => polygon as number[][][]);
}

function ParcelPlan({ point, parcels, selected, onSelect, onPlace, onGate, tool, accesses, routes, implantation, widthM, depthM }: {
  point: GpsPoint; parcels: TerrainParcel[]; selected: TerrainParcel | null; onSelect: (parcel: TerrainParcel) => void;
  onPlace?: (point: GpsPoint) => void; onGate?: (gate: AccessGate) => void; tool: 'building' | AccessKind;
  accesses: AccessGate[]; routes: AccessRoute[];
  implantation?: { lon: number; lat: number; orientationDeg: number } | null; widthM: number; depthM: number;
}) {
  const coordinates = parcels.flatMap(parcel => rings(parcel).flat());
  const extent = Math.max(0.001, ...coordinates.map(coordinate => Math.abs(coordinate[0] - point.lon) * Math.cos(point.lat * Math.PI / 180)),
    ...coordinates.map(coordinate => Math.abs(coordinate[1] - point.lat)));
  const x = (lon: number) => 150 + (lon - point.lon) * Math.cos(point.lat * Math.PI / 180) / extent * 115;
  const y = (lat: number) => 120 - (lat - point.lat) / extent * 115;
  const place = (event: MouseEvent<SVGGElement>, parcel: TerrainParcel) => {
    if (selected !== parcel || !onPlace) { onSelect(parcel); return; }
    const svg = event.currentTarget.ownerSVGElement;
    const matrix = svg?.getScreenCTM()?.inverse();
    if (!matrix) return;
    const cursor = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    const location = { lon: point.lon + (cursor.x - 150) / 115 * extent / Math.cos(point.lat * Math.PI / 180),
      lat: point.lat - (cursor.y - 120) / 115 * extent };
    if (tool === 'building') { if (parcelContains(parcel, location)) onPlace(location); }
    else onGate?.({ kind: tool, ...snapAccessToBoundary(parcel, location) });
  };
  return <svg className="jarvis-terrain-plan" viewBox="0 0 300 240" role="img" aria-label="Plan local des parcelles autour du GPS">
    <path d="M0 120H300 M150 0V240" stroke="#324d65" strokeDasharray="3 5" />
    {parcels.map((parcel, index) => <g key={index} onClick={event => place(event, parcel)} className="jarvis-terrain-parcel">
      {rings(parcel).map((ring, ringIndex) => <polygon key={ringIndex} points={ring.map(coordinate => `${x(coordinate[0])},${y(coordinate[1])}`).join(' ')}
        fill={selected === parcel ? '#28d0df55' : '#8576f044'} stroke={selected === parcel ? '#3be6ef' : '#b4a5ff'} strokeWidth={selected === parcel ? 2.5 : 1.5} />)}
      <title>Parcelle {parcelLabel(parcel)}</title>
    </g>)}
    {implantation && selected && <polygon pointerEvents="none" points={footprintPoints(implantation, widthM, depthM, implantation.orientationDeg).map(p => `${x(p.lon)},${y(p.lat)}`).join(' ')}
      fill={footprintFits(selected, implantation, widthM, depthM, implantation.orientationDeg) ? '#35ecb655' : '#fb718555'}
      stroke={footprintFits(selected, implantation, widthM, depthM, implantation.orientationDeg) ? '#35ecb6' : '#fb7185'} strokeWidth="2" />}
    {routes.map(route => <line key={route.kind} pointerEvents="none" x1={x(route.gate.lon)} y1={y(route.gate.lat)} x2={x(route.entrance.lon)} y2={y(route.entrance.lat)} stroke={route.insideParcel ? route.kind === 'pieton' ? '#4de5c5' : '#f5bc69' : '#fb7185'} strokeWidth={route.kind === 'vehicule' ? 5 : 3} strokeDasharray={route.kind === 'pieton' ? '5 3' : undefined} />)}
    {accesses.map(gate => <g key={gate.kind} pointerEvents="none"><circle cx={x(gate.lon)} cy={y(gate.lat)} r="9" fill={gate.kind === 'pieton' ? '#149e92' : '#bd752b'} stroke="white" strokeWidth="1.5" /><text x={x(gate.lon)} y={y(gate.lat) + 3} textAnchor="middle" fill="white" fontSize="9">{gate.kind === 'pieton' ? 'P' : 'V'}</text></g>)}
    <circle cx="150" cy="120" r="5" fill="#f0527f" stroke="white" strokeWidth="2" />
    <text x="158" y="116" fill="white" fontSize="10">GPS</text>
  </svg>;
}

function BuildingSketch({ massing }: { massing: JarvisMassing }) {
  const colors = { brique: '#a75e50', bois: '#b58d62', 'beton-blanc': '#d2d7d9', 'beton-brut': '#969fa8', verre: '#5796b3' };
  const front = massing.appearance.facade ? colors[massing.appearance.facade] : '#a8bed0';
  const floors = Math.max(1, Math.min(12, massing.buildings?.[0]?.niveaux ?? massing.niveaux));
  const top = Math.max(17, 109 - floors * 8);
  const wing = ['l', 'u', 't', 'h', 'cour'].includes(massing.appearance.shape ?? '');
  const second = massing.buildings?.[1];
  const secondTop = second ? Math.max(12, 104 - Math.min(12, second.niveaux) * 8) : 0;
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 180" role="img" aria-label="Volume indicatif du bâtiment demandé">
    <ellipse cx="132" cy="169" rx="112" ry="9" fill="#071525" opacity=".35" />
    {second && <><path d={`M166 ${secondTop + 8}L225 ${secondTop + 30}L246 ${secondTop + 22}L186 ${secondTop}Z`} fill="#dce8ef" stroke="#e9fbff" />
      <path d={`M166 ${secondTop + 8}L225 ${secondTop + 30}L225 153L166 132Z`} fill="#9fb7c4" stroke="#e9fbff" />
      <path d={`M225 ${secondTop + 30}L246 ${secondTop + 22}L246 145L225 153Z`} fill="#6f91a5" stroke="#e9fbff" /></>}
    {wing && <><path d={`M153 ${top + 14} L217 ${top + 38} L237 ${top + 30} L171 ${top + 7}Z`} fill="#d9e4e8" stroke="#d8f7ff" />
      <path d={`M217 ${top + 38}L237 ${top + 30}L237 146L217 156Z`} fill="#7d97a7" stroke="#d8f7ff" /></>}
    <path d={`M23 ${top + 24}L174 ${top + 9}L224 ${top + 31}L72 ${top + 48}Z`} fill="#dce8ef" stroke="#e9fbff" strokeWidth="2" />
    <path d={`M23 ${top + 24}L72 ${top + 48}L72 164L23 141Z`} fill={front} opacity=".91" stroke="#e3f9ff" strokeWidth="2" />
    <path d={`M72 ${top + 48}L224 ${top + 31}L224 149L72 164Z`} fill={front} stroke="#e3f9ff" strokeWidth="2" />
    {Array.from({ length: floors - 1 }, (_, index) => {
      const fraction = (index + 1) / floors;
      return <path key={index} d={`M23 ${top + 24 + (141 - top - 24) * fraction}L72 ${top + 48 + (164 - top - 48) * fraction}L224 ${top + 31 + (149 - top - 31) * fraction}`}
        fill="none" stroke="#e7faff" strokeWidth="1" opacity=".8" />;
    })}
    <path d="M18 157L72 174L230 158" fill="none" stroke="#43e4ed" strokeWidth="2" strokeDasharray="4 4" />
  </svg>;
}

function JarvisEarthworkSection({ estimate }: { estimate: JarvisEarthworkEstimate }) {
  const { profile, platformM } = estimate;
  const values = profile.map(p => p.groundM);
  const min = Math.min(platformM, ...values) - .5, max = Math.max(platformM, ...values) + .5;
  const x = (index: number) => 20 + index / (profile.length - 1) * 380;
  const y = (level: number) => 130 - (level - min) / (max - min) * 105;
  const line = profile.map((p, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(p.groundM).toFixed(1)}`).join(' ');
  return <svg viewBox="0 0 420 160" className="jarvis-terrain-section" role="img" aria-label="Coupe du terrain naturel et de la plateforme du bâtiment">
    <line x1="20" x2="400" y1={y(platformM)} y2={y(platformM)} stroke="#f3bf6a" strokeWidth="2" strokeDasharray="6 4" />
    {profile.slice(0, -1).map((p, index) => <polygon key={index}
      points={`${x(index)},${y(p.groundM)} ${x(index + 1)},${y(profile[index + 1]!.groundM)} ${x(index + 1)},${y(platformM)} ${x(index)},${y(platformM)}`}
      fill={(p.groundM + profile[index + 1]!.groundM) / 2 >= platformM ? '#f1a06d66' : '#5ce4bd66'} />)}
    <path d={line} stroke="#7eeaf2" strokeWidth="2.5" fill="none" />
    <text x="22" y="151" fontSize="11" fill="#bfe7ed">Terrain naturel</text>
    <text x="273" y="151" fontSize="11" fill="#f3bf6a">Entrée {platformM.toFixed(1)} m</text>
  </svg>;
}

export function PhotoTerrainImplantation({ massing, onContinue, onTerrainMeasured }: { massing: JarvisMassing; onContinue?: (terrain: ConfirmedTerrain) => Promise<void>; onTerrainMeasured?: (terrain: TerrainStudio | null) => void }) {
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState('');
  const [panorama, setPanorama] = useState<{ url: string; kind: 'image' | 'video'; file: File } | null>(null);
  const [point, setPoint] = useState<GpsPoint | null>(null);
  const [lat, setLat] = useState(''); const [lon, setLon] = useState('');
  const [parcels, setParcels] = useState<TerrainParcel[]>([]);
  const [selected, setSelected] = useState<TerrainParcel | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [terrainData, setTerrainData] = useState<TerrainStudio | null>(null);
  const [terrainBusy, setTerrainBusy] = useState(false);
  const [terrainError, setTerrainError] = useState('');
  const [implantationPoint, setImplantationPoint] = useState<GpsPoint | null>(null);
  const [orientationDeg, setOrientationDeg] = useState(0);
  const [entryOffsetM, setEntryOffsetM] = useState(0);
  const [accessTool, setAccessTool] = useState<'building' | AccessKind>('building');
  const [accesses, setAccesses] = useState<AccessGate[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [continuing, setContinuing] = useState(false);
  const [placement, setPlacement] = useState({ x: 50, y: 88, scale: 68, angle: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const panoramaInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const earthwork = terrainData && implantationPoint
    ? estimateJarvisEarthworks(terrainData, { ...implantationPoint, orientationDeg, entryOffsetM }, massing.largeurM, massing.profondeurM)
    : null;
  const routes = selected && terrainData && implantationPoint
    ? accesses.map(gate => calculateAccessRoute(selected, terrainData, implantationPoint, massing.largeurM, massing.profondeurM, orientationDeg, entryOffsetM, gate)) : [];
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);
  useEffect(() => () => { if (panorama) URL.revokeObjectURL(panorama.url); }, [panorama]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  useEffect(() => {
    if (!confirmed || !selected) { setTerrainData(null); onTerrainMeasured?.(null); setTerrainError(''); setTerrainBusy(false); return; }
    let cancelled = false;
    setTerrainData(null); onTerrainMeasured?.(null); setTerrainError(''); setTerrainBusy(true);
    void chargerReliefMesure([{ id: parcelId(selected), feature: selected }], selected.properties.code_insee as string | undefined)
      .then(data => { if (!cancelled) { setTerrainData(data); onTerrainMeasured?.(data); } })
      .catch(cause => { if (!cancelled) setTerrainError(cause instanceof Error ? cause.message : 'Relief indisponible.'); })
      .finally(() => { if (!cancelled) setTerrainBusy(false); });
    return () => { cancelled = true; };
  }, [confirmed, selected, onTerrainMeasured]);

  const locate = () => {
    if (!navigator.geolocation) { setError('GPS indisponible. Saisissez les coordonnées.'); return; }
    setBusy(true); setError('');
    navigator.geolocation.getCurrentPosition(position => {
      const next = { lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy };
      setPoint(next); setLat(String(next.lat)); setLon(String(next.lon)); setBusy(false);
      setSelected(null); setConfirmed(false); setParcels([]); setImplantationPoint(null); setAccesses([]);
    }, failure => { setBusy(false); setError(failure.code === 1 ? 'Localisation refusée. Autorisez le GPS dans le navigateur ou saisissez les coordonnées.' : 'Position indisponible. Réessayez dehors ou saisissez les coordonnées.'); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  };
  const search = async () => {
    const searchPoint = { lat: Number(lat.replace(',', '.')), lon: Number(lon.replace(',', '.')), accuracy: point?.accuracy };
    if (!Number.isFinite(searchPoint.lat) || !Number.isFinite(searchPoint.lon) || Math.abs(searchPoint.lat) > 90 || Math.abs(searchPoint.lon) > 180) {
      setError('Coordonnées invalides.'); return;
    }
    setPoint(searchPoint); setParcels([]); setSelected(null); setConfirmed(false); setImplantationPoint(null); setAccesses([]); setBusy(true); setError('');
    try {
      const found = await searchIgnParcels(searchPoint);
      setParcels(found);
      if (!found.length) setError('Aucune parcelle à cette position. Vérifiez les coordonnées ou réessayez sur le terrain.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Recherche cadastrale indisponible.'); }
    finally { setBusy(false); }
  };
  const addPhoto = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choisissez une image.'); return; }
    setPhoto(URL.createObjectURL(file)); setPhotoName(file.name); setError('');
  };
  const addPanorama = async (file?: File) => {
    if (!file) return;
    const kind = /^image\/(jpeg|png)$/.test(file.type) ? 'image' : /^video\/(mp4|webm)$/.test(file.type) ? 'video' : null;
    if (!kind) { setError('Choisissez une photo 360° JPEG/PNG ou une vidéo 360° MP4/WebM.'); return; }
    if (file.size > (kind === 'video' ? 200 : 60) * 1024 * 1024) { setError('Fichier trop volumineux pour la prévisualisation (60 Mo photo, 200 Mo vidéo).'); return; }
    const url = URL.createObjectURL(file);
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        if (kind === 'image') {
          const image = new Image();
          image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
          image.onerror = () => reject(new Error('Photo 360° illisible.'));
          image.src = url;
        } else {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
          video.onerror = () => reject(new Error('Vidéo 360° illisible sur cet appareil.'));
          video.src = url;
        }
      });
      const refusal = verifierRapport360(dimensions.width, dimensions.height);
      if (refusal) throw new Error(`Panorama refusé : ${refusal}.`);
      setPanorama({ url, kind, file }); setError('');
    } catch (cause) {
      URL.revokeObjectURL(url);
      setError(cause instanceof Error ? cause.message : 'Panorama impossible à ouvrir.');
    }
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !stageRef.current) return;
    const bounds = stageRef.current.getBoundingClientRect();
    setPlacement(value => ({ ...value, x: Math.max(10, Math.min(90, (event.clientX - bounds.left) / bounds.width * 100)),
      y: Math.max(20, Math.min(98, (event.clientY - bounds.top) / bounds.height * 100)) }));
  };
  const download = async () => {
    if (!photo || !stageRef.current || !selected) return;
    try {
      const source = new Image(); source.src = photo; await source.decode();
      const canvas = document.createElement('canvas'); canvas.width = source.naturalWidth; canvas.height = source.naturalHeight;
      const context = canvas.getContext('2d'); if (!context) return;
      context.drawImage(source, 0, 0);
      const svg = stageRef.current.querySelector('svg');
      if (svg) {
        const sketch = new Image(); sketch.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
        await sketch.decode();
        const stage = stageRef.current;
        const overlay = stage.querySelector('.jarvis-terrain-building') as HTMLElement | null;
        if (overlay) {
          const width = overlay.offsetWidth / stage.clientWidth * canvas.width;
          const height = overlay.offsetHeight / stage.clientHeight * canvas.height;
          context.save();
          context.translate(placement.x / 100 * canvas.width, placement.y / 100 * canvas.height);
          context.rotate(placement.angle * Math.PI / 180);
          context.drawImage(sketch, -width / 2, -height, width, height);
          context.restore();
        }
      }
      const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = `implantation-${parcelLabel(selected).replace(/[^\w-]/g, '-')}.png`; link.click();
    } catch { setError('Export impossible sur cet appareil. Vous pouvez faire une capture d’écran.'); }
  };

  return <>
    <button type="button" className="jarvis-terrain-launch" onClick={() => setOpen(true)}><Camera size={17} /> Photo, panorama 360° et implantation 3D</button>
    {open && createPortal(<div className="jarvis-terrain-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="jarvis-terrain-dialog" role="dialog" aria-modal="true" aria-label="Implanter le bâtiment sur une photo du terrain">
        <header><div><span>MIMMO · TERRAIN</span><h2>Terrain et implantation 3D</h2><p>Tournez autour du volume et confrontez-le au panorama du site</p></div><button type="button" aria-label="Fermer" onClick={() => setOpen(false)}><X size={20} /></button></header>
        <div className="jarvis-terrain-content">
          <section><h3>1. Photographier le terrain</h3><p>Sur téléphone, le bouton ouvre l’appareil photo. La photo reste sur cet appareil.</p>
            <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={event => addPhoto(event.target.files?.[0])} />
            <button type="button" onClick={() => inputRef.current?.click()}><Camera size={16} /> {photo ? 'Changer la photo' : 'Prendre ou choisir une photo'}</button>
            {photoName && <small>{photoName}</small>}</section>
          <section className="jarvis-terrain-immersive"><h3>Vue 360° et vrai volume 3D</h3>
            <p>Ajoutez une photo sphérique ou une vidéo 360° complète. Faites glisser la scène pour tourner autour du bâtiment. Le fichier reste sur cet appareil pendant la prévisualisation.</p>
            <input ref={panoramaInputRef} type="file" accept="image/jpeg,image/png,video/mp4,video/webm" hidden onChange={event => { void addPanorama(event.target.files?.[0]); event.target.value = ''; }} />
            <button type="button" onClick={() => panoramaInputRef.current?.click()}><Camera size={16} /> {panorama ? 'Changer le panorama 360°' : 'Choisir une photo ou vidéo 360°'}</button>
            {panorama && <small>{panorama.file.name} · {panorama.kind === 'video' ? 'Vidéo locale' : 'Photo sphérique locale'}</small>}
            <JarvisMassingPreview massing={massing} panorama={panorama} terrain={terrainData} implantation={implantationPoint ? { ...implantationPoint, orientationDeg, entryOffsetM } : null} routes={routes} />
            {terrainBusy && <p role="status">Mesure du relief de la parcelle confirmée…</p>}
            {terrainData && <p role="status" className="jarvis-terrain-metrics">Relief {terrainData.provider} · altitude de la parcelle {terrainData.altitudeMin.toFixed(1)} à {terrainData.altitudeMax.toFixed(1)} m · dénivelé {(terrainData.altitudeMax - terrainData.altitudeMin).toFixed(1)} m{terrainData.penteMoyenne !== null ? ` · pente estimée ${terrainData.penteMoyenne.toFixed(1)} %` : ''}. Le sol 3D suit la grille mesurée{implantationPoint ? ' et le volume suit votre implantation.' : ' ; touchez le plan cadastral pour placer le volume.'}</p>}
            {terrainError && <p role="alert" className="jarvis-terrain-error">{terrainError}</p>}
            <p className="jarvis-terrain-caution">Le bâtiment possède une géométrie 3D aux dimensions du projet. Le panorama sert de contexte visuel : sans relevé de profondeur ni points de calage, sa perspective ne permet pas de mesurer la distance aux objets photographiés.</p>
          </section>
          <section><h3>2. Retrouver la parcelle</h3><p>Activez le GPS du téléphone, puis lancez la recherche cadastrale. Les coordonnées sont envoyées à l’IGN après votre clic.</p>
            <button type="button" onClick={locate} disabled={busy}><LocateFixed size={16} /> Utiliser mon GPS</button>
            <div className="jarvis-terrain-coordinates"><label>Latitude<input inputMode="decimal" placeholder="48.8584" value={lat} onChange={event => setLat(event.target.value)} /></label>
              <label>Longitude<input inputMode="decimal" placeholder="2.2945" value={lon} onChange={event => setLon(event.target.value)} /></label></div>
            {point?.accuracy && <small>Précision GPS annoncée : ± {Math.round(point.accuracy)} m. Vérifiez la parcelle proposée.</small>}
            <button type="button" className="is-primary" disabled={busy || !lat || !lon} onClick={() => void search()}><MapPinned size={16} /> {busy ? 'Recherche…' : 'Chercher la parcelle avec l’IGN'}</button>
            {point && parcels.length > 0 && <><ParcelPlan point={point} parcels={parcels} selected={selected} onSelect={parcel => { setSelected(parcel); setConfirmed(false); setImplantationPoint(null); setAccesses([]); }}
              onPlace={confirmed ? setImplantationPoint : undefined} onGate={gate => setAccesses(current => [...current.filter(item => item.kind !== gate.kind), gate])} tool={accessTool} accesses={accesses} routes={routes}
              implantation={implantationPoint ? { ...implantationPoint, orientationDeg } : null} widthM={massing.largeurM} depthM={massing.profondeurM} />
              <div className="jarvis-terrain-candidates">{parcels.map((parcel, index) => <button type="button" key={index} className={selected === parcel ? 'is-selected' : ''} onClick={() => { setSelected(parcel); setConfirmed(false); setImplantationPoint(null); setAccesses([]); }}>
                {parcelLabel(parcel)} <span>{parcelContains(parcel, point) ? 'GPS dans la parcelle' : `~${Math.round(parcelDistanceMeters(parcel, point))} m du GPS`}</span></button>)}</div>
              {selected && <button type="button" className="is-primary" onClick={() => setConfirmed(true)}>{confirmed ? 'Parcelle confirmée ✓' : `Confirmer ${parcelLabel(selected)}`}</button>}</>}
            {confirmed && selected && point && <p className="jarvis-terrain-metrics">
              GPS → limite cadastrale la plus proche : <strong>≈ {parcelBoundaryDistanceMeters(selected, point).toFixed(1)} m</strong>
              {point.accuracy ? ` (précision GPS annoncée ±${Math.round(point.accuracy)} m)` : ''}. Emprise rectangulaire du projet : <strong>{Math.round(massing.largeurM * massing.profondeurM)} m²</strong>.
              Le GPS situe la recherche, puis votre clic sur le plan fixe le centre du bâtiment.
            </p>}
            {confirmed && selected && <div className="jarvis-terrain-geopose"><h3>Implantation sur la parcelle</h3>
              <p>Choisissez ce que vous placez, puis touchez le plan. Les accès se calent sur la limite cadastrale ; vérifiez sur place la présence d’une voie et d’un portail.</p>
              <div className="jarvis-terrain-tools" role="group" aria-label="Éléments à placer sur la parcelle">
                {([['building', 'Bâtiment'], ['pieton', 'Accès piéton'], ['vehicule', 'Accès véhicule']] as const).map(([kind, label]) => <button key={kind} type="button" className={accessTool === kind ? 'is-primary' : ''} onClick={() => setAccessTool(kind)}>{label}</button>)}
              </div>
              <p>Le contour vert représente l’emprise de {massing.largeurM} × {massing.profondeurM} m ; le rouge indique qu’elle déborde de la parcelle.</p>
              <div className="jarvis-terrain-sliders"><label>Rotation · {orientationDeg}°<input type="range" min="-180" max="180" step="5" value={orientationDeg} onChange={event => setOrientationDeg(Number(event.target.value))} /></label>
                <label>Niveau d’entrée / terrain · {entryOffsetM.toFixed(1)} m<input type="range" min="-2" max="5" step="0.1" value={entryOffsetM} onChange={event => setEntryOffsetM(Number(event.target.value))} /></label></div>
              {implantationPoint && <p role="status" className="jarvis-terrain-metrics">Centre : {implantationPoint.lat.toFixed(6)}, {implantationPoint.lon.toFixed(6)} · rotation {orientationDeg}° · entrée {entryOffsetM >= 0 ? '+' : ''}{entryOffsetM.toFixed(1)} m par rapport au terrain naturel.{!footprintFits(selected, implantationPoint, massing.largeurM, massing.profondeurM, orientationDeg) ? ' L’emprise déborde de la parcelle : déplacez ou tournez le bâtiment.' : ' Emprise contenue dans la parcelle sur ce plan indicatif.'}</p>}
              {routes.length > 0 && <div className="jarvis-terrain-routes"><h3>Accès et raccordement au bâtiment</h3>{routes.map(route => <div key={route.kind} className="jarvis-terrain-route"><strong>{route.kind === 'pieton' ? 'Piéton' : 'Véhicule'}</strong> · {route.lengthM.toFixed(1)} m · pente moyenne {route.slopePercent >= 0 ? '+' : ''}{route.slopePercent.toFixed(1)} % · {route.gateElevationM.toFixed(1)} → {route.entranceElevationM.toFixed(1)} m
                {!route.insideParcel && <p className="jarvis-terrain-error">Le trajet direct sort de la parcelle : déplacez l’accès ou adaptez le cheminement dans Studio.</p>}
                <svg viewBox="0 0 420 100" role="img" aria-label={`Coupe de l’accès ${route.kind}`}><polyline fill="none" stroke="#7eeaf2" strokeWidth="2" points={route.profile.map((p, i) => `${20 + i / (route.profile.length - 1) * 380},${85 - (p.groundM - Math.min(...route.profile.map(v => Math.min(v.groundM, v.pathM))) + .3) / (Math.max(...route.profile.map(v => Math.max(v.groundM, v.pathM))) - Math.min(...route.profile.map(v => Math.min(v.groundM, v.pathM))) + .6) * 70}`).join(' ')} /><line x1="20" y1={85 - (route.gateElevationM - Math.min(...route.profile.map(v => Math.min(v.groundM, v.pathM))) + .3) / (Math.max(...route.profile.map(v => Math.max(v.groundM, v.pathM))) - Math.min(...route.profile.map(v => Math.min(v.groundM, v.pathM))) + .6) * 70} x2="400" y2={85 - (route.entranceElevationM - Math.min(...route.profile.map(v => Math.min(v.groundM, v.pathM))) + .3) / (Math.max(...route.profile.map(v => Math.max(v.groundM, v.pathM))) - Math.min(...route.profile.map(v => Math.min(v.groundM, v.pathM))) + .6) * 70} stroke={route.kind === 'pieton' ? '#4de5c5' : '#f5bc69'} strokeWidth="3" /></svg>
              </div>)}<small>Tracé direct indicatif, sans vérification d’accessibilité, de voirie ni de travaux de rampe.</small></div>}
              {earthwork && <div className="jarvis-terrain-earthwork" aria-label="Terrassement estimatif"><h3>Déblais et remblais estimatifs</h3>
                <div className="jarvis-terrain-earthwork-numbers"><span>Déblai <strong>≈ {earthwork.cutM3.toFixed(0)} m³</strong></span><span>Remblai <strong>≈ {earthwork.fillM3.toFixed(0)} m³</strong></span><span>Sol sous l’emprise <strong>{earthwork.minGroundM.toFixed(1)} à {earthwork.maxGroundM.toFixed(1)} m</strong></span></div>
                <JarvisEarthworkSection estimate={earthwork} />
                <p className="jarvis-terrain-caution">Coupe suivant la longueur du bâtiment. Estimation sous son enveloppe rectangulaire et pour une plateforme horizontale. Studio recalcule sur l’emprise réelle ; talus, fondations et sous-sol restent à étudier.</p>
              </div>}
            </div>}
          </section>
          <section><h3>3. Poser le bâtiment sur la photo</h3>
            {!photo && <p>Ajoutez une photo pour voir la proposition.</p>}
            {photo && !confirmed && <p>Confirmez la parcelle avant de placer le bâtiment. Les limites cadastrales sont visibles sur le plan, pas automatiquement dans la perspective de la photo.</p>}
            {photo && confirmed && <><p>Glissez le volume sur l’image, puis ajustez sa taille et son angle.</p>
              <div className="jarvis-terrain-stage" ref={stageRef} onPointerMove={move} onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}>
                <img src={photo} alt="Terrain photographié" /><div className="jarvis-terrain-building" style={{ left: `${placement.x}%`, top: `${placement.y}%`, width: `${placement.scale}%`, transform: `translate(-50%, -100%) rotate(${placement.angle}deg)` }}
                  onPointerDown={event => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}><BuildingSketch massing={massing} /></div></div>
              <div className="jarvis-terrain-sliders"><label>Taille<input type="range" min="25" max="100" value={placement.scale} onChange={event => setPlacement(value => ({ ...value, scale: Number(event.target.value) }))} /></label>
                <label>Angle<input type="range" min="-30" max="30" value={placement.angle} onChange={event => setPlacement(value => ({ ...value, angle: Number(event.target.value) }))} /></label></div>
              <p className="jarvis-terrain-caution">Parcelle {parcelLabel(selected!)} · {massing.largeurM} × {massing.profondeurM} m · R+{massing.niveaux - 1}. Esquisse indicative : échelle, orientation et limites à vérifier sur le terrain et dans Studio.</p>
              <button type="button" className="is-primary" onClick={() => void download()}><Download size={16} /> Télécharger l’image</button></>}
            {confirmed && selected && point && onContinue && <div className="jarvis-terrain-next">
              <p>La parcelle et le projet 3D seront repris dans Studio. La photo 360° choisie sera enregistrée dans votre espace privé Studio. La photo ordinaire et la vidéo restent sur cet appareil.</p>
              <button type="button" className="is-primary" disabled={continuing || !terrainData || !implantationPoint || !footprintFits(selected, implantationPoint, massing.largeurM, massing.profondeurM, orientationDeg) || routes.some(route => !route.insideParcel)} onClick={() => {
                setContinuing(true); setError('');
                void onContinue({ parcel: selected, point, panorama: panorama?.kind === 'image' ? panorama.file : undefined, terrainData: terrainData ?? undefined,
                  implantation: implantationPoint ? { lon: implantationPoint.lon, lat: implantationPoint.lat, orientationDeg, entryOffsetM } : undefined,
                  accesses: accesses.filter(gate => routes.some(route => route.kind === gate.kind && route.insideParcel)) }).then(() => setOpen(false))
                  .catch(cause => setError(cause instanceof Error ? cause.message : 'Ouverture de Studio impossible.'))
                  .finally(() => setContinuing(false));
              }}>{continuing ? 'Préparation…' : 'Continuer dans Studio avec cette parcelle'}</button>
              {!terrainData && <small>Le relief mesuré doit être chargé avant le transfert de cette implantation.</small>}
              {routes.some(route => !route.insideParcel) && <small>Un accès sort de la parcelle : replacez son point sur la limite avant le transfert.</small>}
            </div>}
          </section>
          {error && <p className="jarvis-terrain-error" role="alert">{error}</p>}
        </div>
      </section>
    </div>, document.body)}
  </>;
}
