import type { JarvisFacadeRule, JarvisMassing } from './jarvisDraft';

type BuildingVolume = Pick<JarvisMassing, 'largeurM' | 'profondeurM' | 'appearance'> & Partial<Pick<JarvisMassing, 'segments' | 'facadeRules'>>;

export interface MassingRect { x: number; z: number; width: number; depth: number; topLevel?: number; name?: string }

/** Retraits alternés côté façade avant ; la limite arrière reste alignée. */
function articulated(rect: MassingRect, depthM: number, bays: number): MassingRect[] {
  const available = Math.min(bays, Math.floor(rect.width / 2.4));
  const count = available % 2 === 0 ? available - 1 : available;
  if (count < 3 || rect.depth - depthM < 3) return [rect];
  const width = rect.width / count;
  return Array.from({ length: count }, (_, index) => {
    const inset = index % 2 === 1 ? depthM : 0;
    return { ...rect, name: `${rect.name ?? 'Façade'} ${index + 1}`,
      x: rect.x - rect.width / 2 + width * (index + .5), z: rect.z + inset / 2,
      width, depth: rect.depth - inset };
  });
}

function withArticulation(massing: BuildingVolume, rects: MassingRect[]): MassingRect[] {
  const rule = massing.appearance.articulation;
  if (!rule) return rects;
  const bays = rects.length === 1 ? rule.bays : 3;
  return rects.flatMap(rect => articulated(rect, rule.depthM, bays));
}

function cutAlong(rect: MassingRect, axis: 'x' | 'z', low: number, high: number): MassingRect[] {
  const size = axis === 'x' ? rect.width : rect.depth;
  const center = rect[axis];
  const start = center - size / 2, end = center + size / 2;
  const cuts = [start, Math.max(start, Math.min(end, low)), Math.max(start, Math.min(end, high)), end]
    .filter((value, index, values) => index === 0 || value - values[index - 1]! > .001);
  return cuts.slice(1).map((value, index) => {
    const from = cuts[index]!;
    return { ...rect, [axis]: (from + value) / 2, [axis === 'x' ? 'width' : 'depth']: value - from };
  });
}

function targeted(massing: BuildingVolume, floor: number, rects: MassingRect[]): MassingRect[] {
  for (const rule of massing.facadeRules ?? []) {
    if (floor < rule.fromLevel || (rule.toLevel !== null && floor > rule.toLevel)) continue;
    const alongX = rule.side === 'sud' || rule.side === 'nord';
    const span = alongX ? massing.largeurM : massing.profondeurM;
    const width = Math.min(rule.widthM ?? span / 3, span);
    const low = rule.position === 'gauche' ? -span / 2 : rule.position === 'droite' ? span / 2 - width : -width / 2;
    const high = low + width;
    const face = (rect: MassingRect) => alongX
      ? rect.z + (rule.side === 'nord' ? rect.depth / 2 : -rect.depth / 2)
      : rect.x + (rule.side === 'est' ? rect.width / 2 : -rect.width / 2);
    const extreme = (rule.side === 'nord' || rule.side === 'est')
      ? Math.max(...rects.map(face)) : Math.min(...rects.map(face));
    const axis = alongX ? 'x' : 'z';
    const next: MassingRect[] = [];
    for (const rect of rects) {
      if (Math.abs(face(rect) - extreme) > .01) { next.push(rect); continue; }
      for (const strip of cutAlong(rect, axis, low, high)) {
        const middle = strip[axis] >= low - .001 && strip[axis] <= high + .001;
        if (!middle || (axis === 'x' ? strip.width : strip.depth) < .5) { next.push(strip); continue; }
        const sign = rule.action === 'retrait' ? 1 : -1;
        const facing = rule.side === 'sud' || rule.side === 'ouest' ? 1 : -1;
        const dimension = alongX ? strip.depth : strip.width;
        const updated = dimension - sign * rule.depthM;
        if (updated < 1) { next.push(strip); continue; }
        next.push({ ...strip, name: `${strip.name ?? 'Façade'} ${rule.action}`,
          [alongX ? 'depth' : 'width']: updated,
          [alongX ? 'z' : 'x']: strip[alongX ? 'z' : 'x'] + facing * sign * rule.depthM / 2 });
      }
    }
    rects = next;
  }
  return rects;
}

/** Rectangles jointifs composant l'emprise extérieure, sans dessiner de distribution intérieure. */
export function levelFootprint(massing: BuildingVolume, floor: number): MassingRect[] {
  const finish = (rects: MassingRect[]) => targeted(massing, floor, withArticulation(massing, rects));
  if (massing.segments) return finish(massing.segments.filter(part => floor >= (part.fromLevelIndex ?? 0) && floor < part.niveaux)
    .map(part => ({ x: part.x, z: part.z, width: part.largeurM, depth: part.profondeurM, topLevel: part.niveaux, name: part.name })));
  const w = massing.largeurM, d = massing.profondeurM;
  const shape = massing.appearance.shape ?? 'barre';
  if (shape === 'l') return finish([
    { x: 0, z: -d * .32, width: w, depth: d * .36 },
    { x: -w * .34, z: d * .18, width: w * .32, depth: d * .64 },
  ]);
  if (shape === 'u') return finish([
    { x: 0, z: -d * .35, width: w, depth: d * .3 },
    { x: -w * .38, z: d * .15, width: w * .24, depth: d * .7 },
    { x: w * .38, z: d * .15, width: w * .24, depth: d * .7 },
  ]);
  if (shape === 't') return finish([
    { x: 0, z: -d * .35, width: w, depth: d * .3 },
    { x: 0, z: d * .15, width: w * .32, depth: d * .7 },
  ]);
  if (shape === 'h') return finish([
    { x: -w * .36, z: 0, width: w * .28, depth: d },
    { x: w * .36, z: 0, width: w * .28, depth: d },
    { x: 0, z: 0, width: w * .44, depth: d * .3 },
  ]);
  if (shape === 'cour') return finish([
    { x: 0, z: -d * .38, width: w, depth: d * .24 },
    { x: 0, z: d * .38, width: w, depth: d * .24 },
    { x: -w * .38, z: 0, width: w * .24, depth: d * .52 },
    { x: w * .38, z: 0, width: w * .24, depth: d * .52 },
  ]);
  if (shape === 'gradins') {
    const fraction = Math.min(.55, floor * .09);
    return finish([{ x: 0, z: fraction * d / 2, width: w * (1 - fraction * .55), depth: d * (1 - fraction) }]);
  }
  if (shape === 'socle-tour' && floor > 0) {
    return finish([{ x: 0, z: 0, width: w * .54, depth: d * .62 }]);
  }
  return finish([{ x: 0, z: 0, width: w, depth: d }]);
}

/** Une toiture générique en pente est esquissée à deux pans ; le type reste modifiable dans Studio. */
export function previewRoof(massing: BuildingVolume): 'terrasse' | 'deux-pans' | 'quatre-pans' {
  const explicit = massing.appearance.roof;
  if (explicit === 'pente' || explicit === 'deux-pans') return 'deux-pans';
  if (explicit === 'quatre-pans') return 'quatre-pans';
  if (explicit === 'terrasse') return 'terrasse';
  if (massing.appearance.architecturalStyle === 'traditionnel' || massing.appearance.architecturalStyle === 'haussmannien') return 'quatre-pans';
  if (massing.appearance.architecturalStyle === 'industriel') return 'deux-pans';
  return 'terrasse';
}
