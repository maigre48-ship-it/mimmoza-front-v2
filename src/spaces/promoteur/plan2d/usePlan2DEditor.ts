// ─── usePlan2DEditor.ts ───────────────────────────────────────────────────────
// Hook principal — version robuste
//
// CHANGEMENTS CLÉ vs v1 :
// • Retourne des React event handlers (plus d'addEventListener → zéro timing issue)
// • storeRef.current = store directement dans le render (pas de useEffect → toujours à jour)
// • Capture des coordonnées AVANT le RAF (pas de stale synthetic event)
// • Conversion screen→monde avec fallback si getScreenCTM() null
// • State transitoire dans un seul objet ref (zéro stale closure)

import { useRef, useEffect, useCallback } from 'react';
import type React from 'react';
import { useEditor2DStore } from './editor2d.store';
import { snapPoint }        from './editor2d.snap';
import {
  rectFromTwoPoints,
  pointHitsRect,
  moveRect,
  resizeRectFromHandle,
  genId,
  computeParkingSlots,
  rectCorners,
  dist,
} from './editor2d.geometry';
import type {
  Point2D,
  Building2D,
  Parking2D,
  DragOp,
  DrawOp,
  OrientedRect,
  HandleId,
} from './editor2d.types';

// ── Conversion coordonnées ────────────────────────────────────────────────────

function worldFromClient(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
): Point2D {
  // Méthode 1 : via CTM (précise, gère CSS transforms)
  try {
    const pt  = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const wp = pt.matrixTransform(ctm.inverse());
      return { x: wp.x, y: wp.y };
    }
  } catch (_) { /* ignore, fallback ci-dessous */ }

  // Méthode 2 : fallback BoundingRect + viewBox
  const rect = svg.getBoundingClientRect();
  const vb   = svg.viewBox.baseVal;
  if (rect.width > 0 && rect.height > 0) {
    return {
      x: vb.x + (clientX - rect.left) / rect.width  * vb.width,
      y: vb.y + (clientY - rect.top)  / rect.height * vb.height,
    };
  }
  return { x: 0, y: 0 };
}

/** Zoom actuel en pixels/unité monde */
function getZoom(svg: SVGSVGElement): number {
  try {
    const ctm = svg.getScreenCTM();
    if (ctm) return Math.abs(ctm.a);
  } catch (_) {}
  const rect = svg.getBoundingClientRect();
  const vb   = svg.viewBox.baseVal;
  return vb.width > 0 ? rect.width / vb.width : 1;
}

// ── Handles ───────────────────────────────────────────────────────────────────

const HANDLE_HIT_PX = 9;

interface HandleDef { id: HandleId; pos: Point2D }

function buildHandles(rect: OrientedRect): HandleDef[] {
  const [nw, ne, se, sw] = rectCorners(rect);
  const m = (a: Point2D, b: Point2D): Point2D => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  return [
    { id: 'resize-nw', pos: nw },       { id: 'resize-n',  pos: m(nw, ne) },
    { id: 'resize-ne', pos: ne },       { id: 'resize-e',  pos: m(ne, se) },
    { id: 'resize-se', pos: se },       { id: 'resize-s',  pos: m(se, sw) },
    { id: 'resize-sw', pos: sw },       { id: 'resize-w',  pos: m(sw, nw) },
  ];
}

function hitHandle(p: Point2D, rect: OrientedRect, zoom: number): HandleId | null {
  const thresh = HANDLE_HIT_PX / zoom;
  for (const h of buildHandles(rect)) {
    if (dist(p, h.pos) < thresh) return h.id;
  }
  return null;
}

// ── État transitoire interne (tout dans un ref → zéro stale closure) ──────────

interface TransientState {
  isDown:  boolean;
  draw:    DrawOp | null;
  drag:    DragOp | null;
  lastPos: { clientX: number; clientY: number };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UsePlan2DEditorOptions {
  parcellePolygon: Point2D[];
  svgRef:          React.RefObject<SVGSVGElement>;
}

export function usePlan2DEditor({ parcellePolygon, svgRef }: UsePlan2DEditorOptions) {
  // ── Store : lecture synchrone à chaque render (JAMAIS via useEffect) ─────
  const store    = useEditor2DStore();
  const storeRef = useRef(store);
  storeRef.current = store;          // mis à jour à chaque render, avant tout handler

  const polyRef  = useRef(parcellePolygon);
  polyRef.current = parcellePolygon;

  // ── État transitoire dans un seul ref ────────────────────────────────────
  const state = useRef<TransientState>({
    isDown: false, draw: null, drag: null, lastPos: { clientX: 0, clientY: 0 },
  });

  // ── RAF ───────────────────────────────────────────────────────────────────
  const rafId = useRef(0);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const getSvg = (): SVGSVGElement | null => svgRef.current;

  const getWorld = (clientX: number, clientY: number): Point2D => {
    const svg = getSvg();
    return svg ? worldFromClient(clientX, clientY, svg) : { x: 0, y: 0 };
  };

  const currentZoom = (): number => {
    const svg = getSvg();
    return svg ? getZoom(svg) : 1;
  };

  const findEntity = (p: Point2D): string | null => {
    const { buildings, parkings } = storeRef.current;
    for (let i = buildings.length - 1; i >= 0; i--)
      if (pointHitsRect(p, buildings[i].rect)) return buildings[i].id;
    for (let i = parkings.length - 1; i >= 0; i--)
      if (pointHitsRect(p, parkings[i].rect)) return parkings[i].id;
    return null;
  };

  const getEntityRect = (id: string): OrientedRect | null => {
    const { buildings, parkings } = storeRef.current;
    return buildings.find(b => b.id === id)?.rect
        ?? parkings.find(p => p.id === id)?.rect
        ?? null;
  };

  const commitRect = (entityId: string, rect: OrientedRect) => {
    const { buildings } = storeRef.current;
    if (buildings.some(b => b.id === entityId))
      storeRef.current.updateBuildingRect(entityId, rect);
    else
      storeRef.current.updateParkingRect(entityId, rect);
  };

  // ── onPointerDown ─────────────────────────────────────────────────────────

  const onPointerDown = useCallback((e: React.PointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);

    state.current.isDown  = true;
    state.current.lastPos = { clientX: e.clientX, clientY: e.clientY };

    const { activeTool, selectedIds } = storeRef.current;
    const world = getWorld(e.clientX, e.clientY);
    const zoom  = currentZoom();

    // ── Sélection ──────────────────────────────────────────────────────────
    if (activeTool === 'selection') {
      if (selectedIds.length === 1) {
        const rect = getEntityRect(selectedIds[0]);
        if (rect) {
          const handle = hitHandle(world, rect, zoom);
          if (handle) {
            state.current.drag = {
              type: 'resize', entityId: selectedIds[0],
              handle, startWorld: world, currentWorld: world, originalRect: rect,
            };
            storeRef.current.setDrag(state.current.drag);
            return;
          }
        }
      }
      const hitId = findEntity(world);
      if (hitId) {
        if (!selectedIds.includes(hitId)) storeRef.current.selectIds([hitId], e.shiftKey);
        const rect = getEntityRect(hitId);
        if (rect) {
          state.current.drag = {
            type: 'move', entityId: hitId,
            startWorld: world, currentWorld: world, originalRect: rect,
          };
          storeRef.current.setDrag(state.current.drag);
        }
      } else {
        storeRef.current.clearSelection();
        state.current.drag = null;
      }
      return;
    }

    // ── Dessin bâtiment / parking ──────────────────────────────────────────
    if (activeTool === 'building' || activeTool === 'parking') {
      const op: DrawOp = { tool: activeTool, origin: world, current: world };
      state.current.draw = op;
      storeRef.current.setDraw(op);
      // ← DEBUG (supprimer en prod) :
      // console.log('[plan2d] draw start', { activeTool, world });
    }
  }, []); // pas de deps — tout lu via refs

  // ── onPointerMove ──────────────────────────────────────────────────────────

  const onPointerMove = useCallback((e: React.PointerEvent<SVGElement>) => {
    // Capture des coords MAINTENANT (avant que le RAF ne s'exécute)
    const clientX = e.clientX;
    const clientY = e.clientY;
    state.current.lastPos = { clientX, clientY };

    // Hover sans drag
    if (!state.current.isDown) {
      const world = getWorld(clientX, clientY);
      storeRef.current.setHovered(findEntity(world));
      return;
    }

    // RAF throttle
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = 0;
      const { clientX: cx, clientY: cy } = state.current.lastPos;
      const world = getWorld(cx, cy);
      const zoom  = currentZoom();
      const { activeTool } = storeRef.current;

      // Update dessin
      if ((activeTool === 'building' || activeTool === 'parking') && state.current.draw) {
        const snapped = snapPoint(world, {
          options:         storeRef.current.snapOptions,
          zoom,
          parcellePolygon: polyRef.current,
          orthogonalRef:   state.current.draw.origin,
        }).point;
        const next: DrawOp = { ...state.current.draw, current: snapped };
        state.current.draw = next;
        storeRef.current.setDraw(next);
        // ← DEBUG : console.log('[plan2d] draw move', next);
        return;
      }

      // Update drag sélection
      if (activeTool === 'selection' && state.current.drag) {
        const op = state.current.drag;
        const snapped = snapPoint(world, {
          options:         storeRef.current.snapOptions,
          zoom,
          parcellePolygon: polyRef.current,
        }).point;

        if (op.type === 'move') {
          const dx = snapped.x - op.startWorld.x;
          const dy = snapped.y - op.startWorld.y;
          commitRect(op.entityId, moveRect(op.originalRect, dx, dy));

        } else if (op.type === 'resize' && op.handle) {
          commitRect(op.entityId, resizeRectFromHandle(
            op.originalRect, op.handle,
            { x: snapped.x - op.startWorld.x, y: snapped.y - op.startWorld.y },
          ));
        }
        state.current.drag = { ...op, currentWorld: snapped };
      }
    });
  }, []);

  // ── onPointerUp ────────────────────────────────────────────────────────────

  const onPointerUp = useCallback((e: React.PointerEvent<SVGElement>) => {
    cancelAnimationFrame(rafId.current);
    rafId.current = 0;
    state.current.isDown = false;

    const { activeTool } = storeRef.current;
    const world = getWorld(e.clientX, e.clientY);

    // ── Commit bâtiment ──────────────────────────────────────────────────
    if (activeTool === 'building' && state.current.draw) {
      const { origin, current } = state.current.draw;
      const rect = rectFromTwoPoints(origin, current);

      // ← DEBUG : console.log('[plan2d] draw end', { rect });

      if (rect.width > 0.5 && rect.depth > 0.5) {
        const id = genId();
        const b: Building2D = {
          id,
          kind:   'building',
          rect,
          levels: 3,
          label:  `Bât. ${id.slice(0, 4).toUpperCase()}`,
        };
        storeRef.current.addBuilding(b);
        storeRef.current.selectIds([id]);
        storeRef.current.setTool('selection');   // revenir en sélection après dessin
        // ← DEBUG : console.log('[plan2d] building created', b);
      }
      state.current.draw = null;
      storeRef.current.setDraw(null);
      return;
    }

    // ── Commit parking ────────────────────────────────────────────────────
    if (activeTool === 'parking' && state.current.draw) {
      const { origin, current } = state.current.draw;
      const rect = rectFromTwoPoints(origin, current);

      if (rect.width > 1 && rect.depth > 1) {
        const id = genId();
        const slotW = 2.5, slotD = 5.0, aisleW = 6.0;
        const p: Parking2D = {
          id,
          kind:            'parking',
          rect,
          slotWidth:       slotW,
          slotDepth:       slotD,
          driveAisleWidth: aisleW,
          slotCount:       computeParkingSlots(rect.width, rect.depth, slotW, slotD, aisleW),
        };
        storeRef.current.addParking(p);
        storeRef.current.selectIds([id]);
        storeRef.current.setTool('selection');
      }
      state.current.draw = null;
      storeRef.current.setDraw(null);
      return;
    }

    // ── Fin drag ──────────────────────────────────────────────────────────
    state.current.drag = null;
    storeRef.current.setDrag(null);
  }, []);

  // ── Clavier ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'Delete' || e.key === 'Backspace')
        storeRef.current.deleteSelected();

      if (e.key === 'Escape') {
        storeRef.current.clearSelection();
        storeRef.current.setDraw(null);
        storeRef.current.setDrag(null);
        state.current.draw = null;
        state.current.drag = null;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        storeRef.current.duplicateSelected();
      }

      // Raccourcis outil
      const tools: Record<string, string> = { v: 'selection', b: 'building', p: 'parking' };
      const t = tools[e.key.toLowerCase()];
      if (t && !e.ctrlKey && !e.metaKey) storeRef.current.setTool(t as any);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Exposer les handlers + helper handles pour le SelectionOverlay
  return { onPointerDown, onPointerMove, onPointerUp, buildHandles };
}