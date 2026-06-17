// src/services/massing/massingGeometry.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// MASSING GEOMETRY
// Génère une géométrie volumétrique SIMPLE et déterministe à partir d'un scénario.
// Pas de Three.js, pas de turf : uniquement de la géométrie en mètres.
//
// Sert deux usages :
//   1. Vue volumétrique simplifiée (SVG) dans l'UI.
//   2. Préparation d'une future visualisation 3D (boundingBox + dalles).
//
// Empreinte par défaut : carré équivalent à l'emprise (√aire).
// Si un polygone parcelle est fourni, on peut le réutiliser (mode "fit") sans
// reculs avancés (les reculs précis relèvent de l'éditeur d'implantation 2D).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  MassingConfig,
  MassingGeometry,
  MassingScenario,
  Vec2,
} from "./massing.types";

/** Empreinte carrée centrée correspondant à une aire donnée. */
function squareFootprint(areaM2: number): Vec2[] {
  const side = areaM2 > 0 ? Math.sqrt(areaM2) : 0;
  const h = side / 2;
  return [
    { x: -h, y: -h },
    { x: h, y: -h },
    { x: h, y: h },
    { x: -h, y: h },
  ];
}

/** Hauteurs de dalles : RDC puis étages courants. */
function levelHeights(
  levels: number,
  config: MassingConfig,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < levels; i++) {
    out.push(i === 0 ? config.groundFloorHeightM : config.typicalFloorHeightM);
  }
  return out;
}

export function buildMassingGeometry(
  scenario: MassingScenario,
  config: MassingConfig,
): MassingGeometry {
  const footprintPolygon = squareFootprint(scenario.footprintM2);

  const xs = footprintPolygon.map((p) => p.x);
  const ys = footprintPolygon.map((p) => p.y);
  const widthM = footprintPolygon.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const depthM = footprintPolygon.length ? Math.max(...ys) - Math.min(...ys) : 0;

  return {
    scenario: scenario.name,
    footprintM2: scenario.footprintM2,
    levels: scenario.levels,
    heightM: scenario.heightM,
    footprintPolygon,
    boundingBox: {
      widthM: round2(widthM),
      depthM: round2(depthM),
      heightM: scenario.heightM,
    },
    levelHeightsM: levelHeights(scenario.levels, config),
  };
}

export function buildAllGeometries(
  scenarios: MassingScenario[],
  config: MassingConfig,
): MassingGeometry[] {
  return scenarios.map((s) => buildMassingGeometry(s, config));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}