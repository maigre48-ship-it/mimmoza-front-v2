// ═══════════════════════════════════════════════════════════════════════════════
// MODIFICATIONS EXACTES À APPORTER À Implantation2DPage.tsx
// ═══════════════════════════════════════════════════════════════════════════════
//
// Ce fichier documente ligne par ligne les changements à faire.
// Il ne remplace pas le fichier — il indique QUOI ajouter / modifier / supprimer.
// ──────────────────────────────────────────────────────────────────────────────

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ÉTAPE 1 — AJOUTER CES IMPORTS en haut du fichier
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/*
import { Plan2DCanvas }   from './plan2d/Plan2DCanvas';
import { Plan2DToolbar }  from './plan2d/Plan2DToolbar';
import { useEditor2DStore } from './plan2d/editor2d.store';
import { geoPolygonToLocal, polygonCentroid } from './plan2d/editor2d.geometry';
import type { Point2D } from './plan2d/editor2d.types';
*/

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ÉTAPE 2 — CONSTRUIRE parcelleLocal depuis la parcelle GeoJSON
//
// À placer dans le corps du composant, après la récupération de la parcelle.
// Adapter selon comment la parcelle est stockée dans votre état existant.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/*
// ── Conversion GeoJSON → coordonnées locales en mètres ──────────────────────
//
// Cas A : la parcelle vient de promoteurSnapshot.selectedParcelle.geometry
//         (GeoJSON Polygon avec coordinates[0] = [[lon, lat], ...])
//
const parcelleLocal = useMemo((): Point2D[] => {
  // Adapter le chemin selon votre store :
  const geo = promoteurSnapshot?.selectedParcelle?.geometry
           ?? promoteurSnapshot?.foncierData?.geometry;
  if (!geo || geo.type !== 'Polygon') return [];

  const coords = geo.coordinates[0] as [number, number][];
  if (coords.length < 3) return [];

  // Centroïde géographique pour la projection locale
  const lons = coords.map(c => c[0]);
  const lats  = coords.map(c => c[1]);
  const originLon = lons.reduce((a, b) => a + b, 0) / lons.length;
  const originLat = lats.reduce((a, b) => a + b, 0) / lats.length;

  return geoPolygonToLocal(coords, originLon, originLat);
}, [promoteurSnapshot]);
//
// Cas B : vous avez déjà un polygone en pixels/SVG local
//         → convertir simplement en Point2D[]
//
// const parcelleLocal = useMemo((): Point2D[] =>
//   existingParcellePoints.map(p => ({ x: p.x, y: p.y })),
// [existingParcellePoints]);
*/

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ÉTAPE 3 — MESURER le conteneur SVG pour Plan2DCanvas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/*
const containerRef = useRef<HTMLDivElement>(null);
const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });

useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  const ro = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect;
    setCanvasSize({ w: Math.round(width), h: Math.round(height) });
  });
  ro.observe(el);
  return () => ro.disconnect();
}, []);
*/

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ÉTAPE 4 — CHARGER la persistance snapshot au montage (optionnel)
//
// Si vous voulez synchroniser le store éditeur avec votre promoteurSnapshot :
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/*
const { loadSnapshot } = useEditor2DStore();

useEffect(() => {
  // Exemple : charger depuis promoteurSnapshot si des données implantation existent
  const implantation = promoteurSnapshot?.implantation2d;
  if (implantation?.buildings || implantation?.parkings) {
    loadSnapshot(
      implantation.buildings ?? [],
      implantation.parkings  ?? [],
    );
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // une seule fois au montage
*/

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ÉTAPE 5 — REMPLACER le JSX de la toolbar et du canvas dans le return
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/*
// ── AVANT (exemple de ce que vous aviez) ────────────────────────────────────
//
// <div className="flex gap-2">
//   <button onClick={() => setActiveTool('selection')}>Sélection</button>
//   <button onClick={() => setActiveTool('building')}>Bâtiment</button>
//   <button onClick={() => setActiveTool('parking')}>Parking</button>
//   <button onClick={() => setActiveTool('cotes')}>Cotes</button>
// </div>
// <div className="relative flex-1">
//   <svg ref={svgRef} ... >
//     ... rendu parcelle existant ...
//   </svg>
// </div>

// ── APRÈS ─────────────────────────────────────────────────────────────────────
//
// Bloc toolbar — remplace vos anciens boutons :

<div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-white">
  <Plan2DToolbar />
  {/* Conserver vos éventuels autres boutons droite (export, etc.) */}
</div>

// Bloc canvas — remplace votre ancien <svg> de parcelle :

<div ref={containerRef} className="relative flex-1 bg-gray-50 overflow-hidden">
  {parcelleLocal.length > 0 ? (
    <Plan2DCanvas
      parcellePolygon={parcelleLocal}
      containerWidth={canvasSize.w}
      containerHeight={canvasSize.h}
      className="absolute inset-0 w-full h-full"
    />
  ) : (
    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
      Aucune parcelle sélectionnée
    </div>
  )}
</div>
*/

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RÉSUMÉ DES SUPPRESSIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/*
À SUPPRIMER de Implantation2DPage.tsx :
- Le state local activeTool (useState) → géré par le store
- Les handlers onClick des anciens boutons (setActiveTool)
- L'ancien <svg> de rendu parcelle (remplacé par Plan2DCanvas)
- Tout useRef/useEffect lié à l'ancien canvas SVG

À CONSERVER :
- Tout le code de récupération de la parcelle depuis l'API / localStorage
- La navigation, le header, les autres panels
- Les exports PDF existants
- Le code de résolution PLU
*/

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXEMPLE COMPLET D'INTÉGRATION (structure minimale)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/*
export function Implantation2DPage() {
  // ... vos states existants (promoteurSnapshot, etc.) ...

  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });

  // Mesure du conteneur
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(e => {
      const { width, height } = e[0].contentRect;
      setCanvasSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Conversion parcelle
  const parcelleLocal = useMemo((): Point2D[] => {
    const geo = promoteurSnapshot?.selectedParcelle?.geometry;
    if (!geo || geo.type !== 'Polygon') return [];
    const coords = geo.coordinates[0] as [number, number][];
    const originLon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const originLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    return geoPolygonToLocal(coords, originLon, originLat);
  }, [promoteurSnapshot?.selectedParcelle]);

  return (
    <div className="flex flex-col h-full">
      {/* Header / navigation existant */}

      {/* Toolbar */}
      <div className="flex items-center px-4 py-2 border-b border-gray-100 bg-white shadow-sm">
        <Plan2DToolbar />
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="relative flex-1 bg-gray-50">
        {parcelleLocal.length > 0 ? (
          <Plan2DCanvas
            parcellePolygon={parcelleLocal}
            containerWidth={canvasSize.w}
            containerHeight={canvasSize.h}
            className="absolute inset-0 w-full h-full"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            Sélectionnez une parcelle dans l'onglet Foncier
          </div>
        )}
      </div>

      {/* Vos autres panels existants (sidebar, etc.) */}
    </div>
  );
}
*/