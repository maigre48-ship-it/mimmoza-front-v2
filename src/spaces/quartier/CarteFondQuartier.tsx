// src/spaces/quartier/CarteFondQuartier.tsx
// =============================================================================
// VIS-70 — fond cartographique de la page Quartier : MapLibre (déjà dans le site) + orthophotographie IGN
// (Géoplateforme, Licence Ouverte 2.0, src/lib/cartes/couchesIgn.ts), parcelle du projet en or, isochrones simples
// 5 / 10 / 15 min à pied, repères des lieux de la catégorie choisie. Repli automatique sur le plan dessiné
// (PlanSchematique) si la carte ne peut pas s'afficher : la page reste utilisable hors ligne.
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as CarteMaplibre, Marker as RepereMaplibre } from 'maplibre-gl';

type ModuleMaplibre = typeof import('maplibre-gl');
import { ATTRIBUTION_IGN_TEXTE, FOND_SATELLITE_IGN_URL, ZOOM_NATIF_MAX_SATELLITE } from '../../lib/cartes/couchesIgn';
import { DEFINITIONS_CATEGORIES, type CategorieQuartier } from '../../lib/quartier/categoriesQuartier.ts';
import { cercleGeoJson, rayonIsochroneM } from '../../lib/quartier/tempsTrajet.ts';
import type { AtoutsQuartier, LieuQuartier } from '../../lib/quartier/atoutsQuartier.ts';
import { PlanSchematique } from './PlanSchematique';

interface Props {
  atouts: AtoutsQuartier;
  categorie: CategorieQuartier | null;
  lieuActif: string | null;
  onLieu: (l: LieuQuartier) => void;
  /** « plan-masse » : cadrage serré sur la parcelle ; « situation » : quartier. */
  cadrage: 'plan-masse' | 'situation';
  /** Force le plan dessiné (tests, capture hors ligne). */
  forcerPlan?: boolean;
}

export function CarteFondQuartier({ atouts, categorie, lieuActif, onLieu, cadrage, forcerPlan = false }: Props) {
  const conteneur = useRef<HTMLDivElement | null>(null);
  const carte = useRef<CarteMaplibre | null>(null);
  const reperes = useRef<RepereMaplibre[]>([]);
  const lib = useRef<ModuleMaplibre | null>(null);
  const [echec, setEchec] = useState<string | null>(forcerPlan ? 'plan' : null);
  const [prete, setPrete] = useState(false);
  const { lat, lon } = atouts.projet;

  // Création de la carte (une fois par projet).
  useEffect(() => {
    if (echec || !conteneur.current) return;
    let annule = false;
    (async () => {
      try {
        const mod = await import('maplibre-gl');
        const maplibregl = ((mod as unknown as { default?: ModuleMaplibre }).default ?? mod) as ModuleMaplibre;
        if (annule || !conteneur.current) return;
        lib.current = maplibregl;
        const m = new maplibregl.Map({
          container: conteneur.current,
          style: {
            version: 8,
            sources: { ortho: { type: 'raster', tiles: [FOND_SATELLITE_IGN_URL], tileSize: 256, maxzoom: ZOOM_NATIF_MAX_SATELLITE, attribution: `${ATTRIBUTION_IGN_TEXTE} · © les contributeurs d’OpenStreetMap` } },
            layers: [{ id: 'ortho', type: 'raster', source: 'ortho', paint: { 'raster-saturation': -0.25, 'raster-brightness-max': 0.92 } }],
          },
          center: [lon, lat], zoom: cadrage === 'plan-masse' ? 18 : 15, pitch: cadrage === 'plan-masse' ? 0 : 35, attributionControl: { compact: true },
        });
        carte.current = m;
        m.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');
        let tuilesKo = 0;
        m.on('error', () => { tuilesKo++; if (tuilesKo > 6 && !m.loaded()) setEchec('tuiles'); });
        m.on('load', () => {
          if (annule) return;
          const urbain = atouts.urbain;
          for (const [min, op] of [[15, 0.0], [10, 0.0], [5, 0.12]] as const) {
            const id = `iso-${min}`;
            m.addSource(id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [cercleGeoJson({ lat, lon }, rayonIsochroneM(min, 'pied', urbain))] } } });
            m.addLayer({ id: `${id}-f`, type: 'fill', source: id, paint: { 'fill-color': '#c8a96a', 'fill-opacity': op } });
            m.addLayer({ id: `${id}-l`, type: 'line', source: id, paint: { 'line-color': '#f5e6c4', 'line-width': 1.6, 'line-opacity': 0.85, 'line-dasharray': min === 5 ? [1, 0] : [3, 2] } });
          }
          if (atouts.projet.contour?.length) {
            m.addSource('parcelle', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [atouts.projet.contour.map((p) => [p[0], p[1]])] } } });
            m.addLayer({ id: 'parcelle-f', type: 'fill', source: 'parcelle', paint: { 'fill-color': '#c8a96a', 'fill-opacity': 0.35 } });
            m.addLayer({ id: 'parcelle-l', type: 'line', source: 'parcelle', paint: { 'line-color': '#f5e6c4', 'line-width': 3 } });
          }
          const el = document.createElement('div');
          el.className = 'mz-qr-repere-projet';
          el.innerHTML = `<span></span><b>${(atouts.projet.libelle ?? 'Le projet').replace(/[<>&]/g, '')}</b>`;
          new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lon, lat]).addTo(m);
          setPrete(true);
        });
      } catch {
        if (!annule) setEchec('maplibre');
      }
    })();
    return () => { annule = true; try { carte.current?.remove(); } catch { /* déjà retirée */ } carte.current = null; setPrete(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, echec]);

  // Cadrage.
  useEffect(() => {
    const m = carte.current;
    if (!m || !prete) return;
    m.easeTo({ center: [lon, lat], zoom: cadrage === 'plan-masse' ? 18 : 15, pitch: cadrage === 'plan-masse' ? 0 : 35, duration: 900 });
  }, [cadrage, prete, lat, lon]);

  // Repères de la catégorie choisie.
  useEffect(() => {
    const m = carte.current, gl = lib.current;
    if (!m || !gl || !prete) return;
    for (const r of reperes.current) r.remove();
    reperes.current = [];
    const cats = atouts.categories.filter((c) => categorie === null ? c.id !== 'emploi' : c.id === categorie);
    for (const c of cats) {
      for (const l of c.lieux.slice(0, categorie === null ? 4 : 30)) {
        if (l.lat === null || l.lon === null) continue;
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `mz-qr-repere${l.id === lieuActif ? ' is-actif' : ''}`;
        el.style.background = DEFINITIONS_CATEGORIES[l.categorie].couleur;
        el.title = `${l.nom} — ${l.pied_min} min à pied`;
        el.setAttribute('aria-label', el.title);
        el.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${DEFINITIONS_CATEGORIES[l.categorie].picto}"/></svg>`;
        el.addEventListener('click', (e) => { e.stopPropagation(); onLieu(l); });
        reperes.current.push(new gl.Marker({ element: el }).setLngLat([l.lon, l.lat]).addTo(m));
      }
    }
    const actif = atouts.categories.flatMap((c) => c.lieux).find((l) => l.id === lieuActif);
    if (actif?.lat != null && actif.lon != null) m.easeTo({ center: [(actif.lon + lon) / 2, (actif.lat + lat) / 2], duration: 700 });
  }, [atouts, categorie, lieuActif, prete, onLieu, lat, lon]);

  if (echec) {
    return (
      <div className="mz-qr-fond mz-qr-fond--plan">
        <PlanSchematique atouts={atouts} categorie={categorie} lieuActif={lieuActif} onLieu={onLieu}
          rayonM={cadrage === 'plan-masse' ? rayonIsochroneM(5, 'pied', atouts.urbain) * 1.3 : undefined} />
        {echec !== 'plan' && <p className="mz-qr-fond__note">Vue aérienne indisponible : plan de situation dessiné.</p>}
      </div>
    );
  }
  return <div className="mz-qr-fond" ref={conteneur} />;
}
