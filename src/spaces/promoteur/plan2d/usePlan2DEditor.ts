// usePlan2DEditor.ts
// Hook principal d'interaction pour l'éditeur 2D Mimmoza.
// Gère : sélection, déplacement (move), redimensionnement (resize vectoriel).
//
// Architecture :
//   - transformRef (useRef) → état courant du drag, PAS de setState pendant le drag
//     → zéro re-render intermédiaire → fluidité maximale
//   - Pointer capture sur le SVG root → stabilité même si le curseur sort du canvas
//   - Delta calculé en mètres (espace SVG = espace monde parcelleLocal)
//   - Snap grille appliqué sur le delta move / la position cible des poignées
//   - Store mis à jour via useEditor2DStore.setState (batching Zustand)
//
// V2.0 — Resize vectoriel robuste + pointer capture + gestion Shift (ratio).
// ─────────────────────────────────────────────────────────────────────────────

import { useRef, useCallback, useEffect } from 'react';
import { useEditor2DStore }               from './editor2d.store';
import {
  applyResize,
  applyMove,
  snapDelta,
  getHandleWorldPos,
  snapPoint,
  type HandleId,
  type BuildingRect,
  type TPoint2D,
}                                         from './editor2d.transform';

// ─────────────────────────────────────────────────────────────────────────────
// Types publics
// ─────────────────────────────────────────────────────────────────────────────

export type EditorTool = 'select' | 'draw' | 'parking';

export interface UsePlan2DEditorOptions {
  /** Ref vers l'élément <svg> racine du canvas. Requis pour pointer capture + coords. */
  svgRef:      React.RefObject<SVGSVGElement>;
  /** Outil actif. Par défaut : 'select'. */
  tool?:       EditorTool;
  /**
   * Taille de la grille de snap en mètres (0 ou undefined = snap désactivé).
   * Appliqué sur le delta de déplacement et sur la position des poignées.
   */
  gridSnapM?:  number;
  /**
   * Callbacks optionnels pour brancher le mode "draw" (création de bâtiment).
   * Si absent, le mode 'draw' n'est pas géré par ce hook.
   */
  onDrawStart?: (worldPt: TPoint2D) => void;
  onDrawMove?:  (worldPt: TPoint2D) => void;
  onDrawEnd?:   (worldPt: TPoint2D) => void;
}

export interface Plan2DEditorHandlers {
  /**
   * À attacher sur pointerdown du corps SVG d'un bâtiment (rectangle principal).
   * Déclenche : sélection + move.
   */
  onBuildingPointerDown: (e: React.PointerEvent, buildingId: string) => void;
  /**
   * À attacher sur pointerdown d'une poignée de SelectionOverlay.
   * Déclenche : resize vectoriel.
   */
  onHandlePointerDown:   (e: React.PointerEvent, buildingId: string, handle: HandleId) => void;
  /**
   * À attacher sur pointerdown du fond du canvas (aucun bâtiment visé).
   * Déclenche : désélection (+ début dessin si tool === 'draw').
   */
  onCanvasPointerDown:   (e: React.PointerEvent) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types internes
// ─────────────────────────────────────────────────────────────────────────────

interface ActiveTransform {
  kind:         'move' | 'resize';
  buildingId:   string;
  handle?:      HandleId;
  pointerId:    number;
  /** Position monde du pointer au départ du drag (mètres parcelleLocal). */
  pointerStart: TPoint2D;
  /**
   * Snapshot du rect au départ du drag.
   * CRITIQUE : ne jamais muter ce snapshot — le delta est toujours calculé
   * depuis l'état initial pour éviter l'accumulation d'erreurs d'arrondi.
   */
  initialRect:  Readonly<BuildingRect>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversion coordonnées écran → monde SVG
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convertit les coordonnées écran d'un PointerEvent en coordonnées SVG.
 *
 * Puisque le viewBox SVG est exprimé en mètres (parcelleLocal), les coordonnées
 * SVG renvoyées sont directement les coordonnées monde.
 *
 * Utilise getScreenCTM() pour tenir compte du zoom, pan, et transforms CSS/SVG.
 * Fallback : coordonnées client brutes (sans transform) si CTM indisponible.
 */
function getSVGWorldPoint(svgEl: SVGSVGElement, e: PointerEvent): TPoint2D {
  const ctm = svgEl.getScreenCTM();
  if (!ctm) {
    // Fallback dégradé — rare (SVG hors écran ou display:none)
    console.warn('[usePlan2DEditor] getScreenCTM() returned null — coords dégradées');
    return { x: e.clientX, y: e.clientY };
  }
  const pt = svgEl.createSVGPoint();
  pt.x     = e.clientX;
  pt.y     = e.clientY;
  const svgPt = pt.matrixTransform(ctm.inverse());
  return { x: svgPt.x, y: svgPt.y };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook principal
// ─────────────────────────────────────────────────────────────────────────────

export function usePlan2DEditor({
  svgRef,
  tool      = 'select',
  gridSnapM = 0.5,
  onDrawStart,
  onDrawMove,
  onDrawEnd,
}: UsePlan2DEditorOptions): Plan2DEditorHandlers {

  /**
   * État courant de la transformation.
   * Ref (pas state) → aucun re-render pendant le drag → fluidité max.
   * Le store Zustand se charge des re-renders du canvas quand le rect change.
   */
  const transformRef = useRef<ActiveTransform | null>(null);

  // ── Helpers store ────────────────────────────────────────────────────────

  /** Met à jour le rect d'un bâtiment dans le store (patch partiel). */
  const patchRect = useCallback((id: string, patch: Partial<BuildingRect>) => {
    useEditor2DStore.setState(state => ({
      buildings: state.buildings.map(b =>
        b.id === id ? { ...b, rect: { ...b.rect, ...patch } } : b,
      ),
    }));
  }, []);

  const setSelectedIds = useCallback((ids: string[]) => {
    useEditor2DStore.setState({ selectedIds: ids });
  }, []);

  // ── Pointer capture helpers ───────────────────────────────────────────────

  const capturePointer = useCallback((pointerId: number) => {
    if (!svgRef.current) return;
    try { svgRef.current.setPointerCapture(pointerId); } catch (_) { /* ok */ }
  }, [svgRef]);

  const releasePointer = useCallback((pointerId: number) => {
    if (!svgRef.current) return;
    try { svgRef.current.releasePointerCapture(pointerId); } catch (_) { /* ok */ }
  }, [svgRef]);

  // ── Pointermove ───────────────────────────────────────────────────────────

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const tf = transformRef.current;
    if (!tf || !svgRef.current) return;

    // Ne traiter que les événements du même pointer (multi-touch safe)
    if (e.pointerId !== tf.pointerId) return;

    const currentWorld = getSVGWorldPoint(svgRef.current, e);

    // Delta brut en mètres depuis le départ du drag (calculé toujours depuis
    // initialRect → pas d'accumulation d'erreurs d'arrondi)
    const rawDelta: TPoint2D = {
      x: currentWorld.x - tf.pointerStart.x,
      y: currentWorld.y - tf.pointerStart.y,
    };

    if (tf.kind === 'move') {
      // ── Move : snap du delta ──────────────────────────────────────
      const delta = (gridSnapM && gridSnapM > 0)
        ? snapDelta(rawDelta, gridSnapM)
        : rawDelta;

      const moved = applyMove(tf.initialRect, delta);
      patchRect(tf.buildingId, moved);

    } else if (tf.kind === 'resize' && tf.handle) {
      // ── Resize vectoriel ──────────────────────────────────────────
      //
      // Option A (actuelle) : snap du delta brut → simple, cohérent
      // Option B (alternative) : snap de la position monde de la poignée,
      //   puis recalcul du delta → plus précis pour le snap absolu
      //   mais peut créer un jitter si la grille est grande vs. la bâtiment
      //
      // On utilise ici l'Option A pour les bâtiments de taille standard.
      // Décommenter le bloc ci-dessous pour passer en Option B.
      /*
      const handleCurrentWorld: TPoint2D = {
        x: tf.pointerStart.x + rawDelta.x,
        y: tf.pointerStart.y + rawDelta.y,
      };
      const snappedHandle = (gridSnapM && gridSnapM > 0)
        ? snapPoint(handleCurrentWorld, gridSnapM)
        : handleCurrentWorld;
      const delta: TPoint2D = {
        x: snappedHandle.x - tf.pointerStart.x,
        y: snappedHandle.y - tf.pointerStart.y,
      };
      */
      const delta = rawDelta;

      const result = applyResize(
        tf.initialRect,
        tf.handle,
        delta,
        e.shiftKey,
      );
      patchRect(tf.buildingId, result);
    }
  }, [svgRef, gridSnapM, patchRect]);

  // ── Pointerup ─────────────────────────────────────────────────────────────

  const handlePointerUp = useCallback((e: PointerEvent) => {
    const tf = transformRef.current;
    if (!tf || e.pointerId !== tf.pointerId) return;

    releasePointer(tf.pointerId);
    transformRef.current = null;
  }, [releasePointer]);

  // ── Pointercancel (perte de focus, notification OS, etc.) ─────────────────

  const handlePointerCancel = useCallback((e: PointerEvent) => {
    const tf = transformRef.current;
    if (!tf || e.pointerId !== tf.pointerId) return;

    // Annuler la transformation → restaurer l'état initial
    patchRect(tf.buildingId, tf.initialRect);
    releasePointer(tf.pointerId);
    transformRef.current = null;
  }, [patchRect, releasePointer]);

  // ── Listeners window ─────────────────────────────────────────────────────
  // Attachés sur window (pas sur le SVG) pour capturer les events même si le
  // curseur sort du canvas — pointer capture garantit la continuité.

  useEffect(() => {
    const opts: AddEventListenerOptions = { passive: false };
    window.addEventListener('pointermove',   handlePointerMove,   opts);
    window.addEventListener('pointerup',     handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove',   handlePointerMove);
      window.removeEventListener('pointerup',     handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [handlePointerMove, handlePointerUp, handlePointerCancel]);

  // ── Handlers exposés ─────────────────────────────────────────────────────

  /**
   * Pointerdown sur le corps d'un bâtiment → sélection + initialisation du move.
   *
   * Doit être appelé depuis l'élément SVG du bâtiment dans Plan2DCanvas :
   *   <rect onPointerDown={e => onBuildingPointerDown(e, b.id)} />
   */
  const onBuildingPointerDown = useCallback((
    e: React.PointerEvent,
    buildingId: string,
  ) => {
    if (tool !== 'select') return;
    e.stopPropagation(); // empêche onCanvasPointerDown de désélectionner

    const state    = useEditor2DStore.getState();
    const building = state.buildings.find(b => b.id === buildingId);
    if (!building || !svgRef.current) return;

    const nativeEvent = e.nativeEvent as PointerEvent;

    // Capture pointer → le SVG reçoit tous les pointermove même hors canvas
    capturePointer(nativeEvent.pointerId);

    const worldPt = getSVGWorldPoint(svgRef.current, nativeEvent);

    // Sélectionner le bâtiment si pas déjà sélectionné
    setSelectedIds([buildingId]);

    transformRef.current = {
      kind:         'move',
      buildingId,
      pointerId:    nativeEvent.pointerId,
      pointerStart: worldPt,
      initialRect:  { ...building.rect }, // snapshot immuable
    };
  }, [tool, svgRef, capturePointer, setSelectedIds]);

  /**
   * Pointerdown sur une poignée de SelectionOverlay → initialisation du resize.
   *
   * Doit être appelé depuis SelectionOverlay :
   *   onHandlePointerDown={(e, handle) => handlers.onHandlePointerDown(e, buildingId, handle)}
   */
  const onHandlePointerDown = useCallback((
    e: React.PointerEvent,
    buildingId: string,
    handle: HandleId,
  ) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    e.preventDefault(); // empêche la sélection de texte pendant le drag

    const state    = useEditor2DStore.getState();
    const building = state.buildings.find(b => b.id === buildingId);
    if (!building || !svgRef.current) return;

    const nativeEvent = e.nativeEvent as PointerEvent;
    capturePointer(nativeEvent.pointerId);

    const worldPt = getSVGWorldPoint(svgRef.current, nativeEvent);

    transformRef.current = {
      kind:         'resize',
      buildingId,
      handle,
      pointerId:    nativeEvent.pointerId,
      // pointerStart = position monde de la poignée au départ du drag
      // (légèrement plus précis que la position brute du pointer en cas de hitbox large)
      pointerStart: worldPt,
      initialRect:  { ...building.rect }, // snapshot immuable
    };
  }, [tool, svgRef, capturePointer]);

  /**
   * Pointerdown sur le fond du canvas.
   * → Désélection en mode 'select'.
   * → Début dessin en mode 'draw' / 'parking'.
   */
  const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if (tool === 'select') {
      setSelectedIds([]);
      return;
    }

    if ((tool === 'draw' || tool === 'parking') && svgRef.current) {
      const worldPt = getSVGWorldPoint(svgRef.current, e.nativeEvent as PointerEvent);
      onDrawStart?.(worldPt);
    }
  }, [tool, svgRef, setSelectedIds, onDrawStart]);

  return {
    onBuildingPointerDown,
    onHandlePointerDown,
    onCanvasPointerDown,
  };
}