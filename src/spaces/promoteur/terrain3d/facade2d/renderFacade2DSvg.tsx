import React from 'react';
import type {
  Facade2DModel, Facade2DLevel, Facade2DPalette, Facade2DRenderTheme,
  Facade2DVegetation,
} from './facade2d.types';

interface Props {
  model: Facade2DModel;
  width?: number;
}

const PX = 18; // px per meter
const GROUND_H = 16;
const MARGIN = 24;
const TREE_ZONE = 50; // extra width each side for vegetation

const Facade2DSvgRenderer: React.FC<Props> = ({ model, width = 600 }) => {
  const { theme, levels, widthM, heightM, roofKind, hasCornice, hasSocle, vegetation } = model;
  const pal = theme.palette;

  const facadeW = widthM * PX;
  const facadeH = heightM * PX;
  const roofH = roofKind === 'flat' ? 5 : facadeH * 0.11;
  const vegMargin = vegetation !== 'aucune' ? TREE_ZONE : 0;

  const vbW = facadeW + MARGIN * 2 + vegMargin * 2;
  const vbH = facadeH + GROUND_H + roofH + MARGIN * 2;
  const ox = MARGIN + vegMargin;
  const oy = MARGIN + roofH;

  return (
    <svg
      viewBox={`0 0 ${vbW} ${vbH}`}
      width={width}
      style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="sky-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={pal.skyTop} />
          <stop offset="100%" stopColor={pal.skyBottom} />
        </linearGradient>
      </defs>

      {/* Sky */}
      <rect x={0} y={0} width={vbW} height={oy + facadeH} fill="url(#sky-grad)" />

      {/* Ground */}
      <rect x={0} y={oy + facadeH} width={vbW} height={GROUND_H + MARGIN} fill={pal.groundFill} />

      {/* Ground shadow */}
      {theme.showShadow && (
        <rect x={ox + 3} y={oy + facadeH} width={facadeW - 2} height={5} fill={pal.shadow} rx={1} />
      )}

      {/* Facade body */}
      <rect x={ox} y={oy} width={facadeW} height={facadeH}
        fill={pal.facade} stroke={pal.facadeAccent} strokeWidth={theme.strokeWidth}
        rx={theme.cornerRadius} />

      {/* Socle — darker band at bottom of facade */}
      {hasSocle && (
        <rect x={ox} y={oy + facadeH - 10} width={facadeW} height={10}
          fill={pal.base} opacity={0.2} />
      )}

      {/* Roof */}
      <Roof kind={roofKind} ox={ox} oy={oy} w={facadeW} h={roofH} pal={pal} sw={theme.strokeWidth} />

      {/* Corniche */}
      {hasCornice && (
        <g>
          <rect x={ox - 4} y={oy - 1} width={facadeW + 8} height={4}
            fill={pal.corniceFill} rx={1} />
          <rect x={ox - 2} y={oy + 3} width={facadeW + 4} height={2}
            fill={pal.corniceFill} opacity={0.6} />
        </g>
      )}

      {/* Levels */}
      <Levels levels={levels} ox={ox} oy={oy} facadeW={facadeW} facadeH={facadeH} pal={pal} theme={theme} />

      {/* Ground line */}
      <line x1={ox - 6} y1={oy + facadeH} x2={ox + facadeW + 6} y2={oy + facadeH}
        stroke={pal.base} strokeWidth={theme.strokeWidth * 1.5} />

      {/* Vegetation */}
      <Vegetation
        vegetation={vegetation}
        groundY={oy + facadeH}
        vbW={vbW}
        facadeLeft={ox}
        facadeRight={ox + facadeW}
        pal={pal}
      />
    </svg>
  );
};

export default Facade2DSvgRenderer;

// ─── Roof ───────────────────────────────────────────────────────────────────

const Roof: React.FC<{
  kind: string; ox: number; oy: number; w: number; h: number;
  pal: Facade2DPalette; sw: number;
}> = ({ kind, ox, oy, w, h, pal, sw }) => {
  if (kind === 'flat') {
    return (
      <rect x={ox} y={oy - h} width={w} height={h}
        fill={pal.facadeAccent} stroke={pal.roofFill} strokeWidth={sw} />
    );
  }
  if (kind === 'mansard') {
    const inset = w * 0.08;
    return (
      <g>
        <polygon
          points={`${ox},${oy} ${ox + inset},${oy - h} ${ox + w - inset},${oy - h} ${ox + w},${oy}`}
          fill={pal.roofFill} stroke={pal.roofFill} strokeWidth={sw} />
        <line x1={ox + inset} y1={oy - h} x2={ox + w - inset} y2={oy - h}
          stroke={pal.facadeAccent} strokeWidth={sw * 0.7} />
      </g>
    );
  }
  const apex = kind === 'hip' ? w * 0.25 : 0;
  return (
    <polygon
      points={`${ox},${oy} ${ox + apex},${oy - h} ${ox + w - apex},${oy - h} ${ox + w},${oy}`}
      fill={pal.roofFill} stroke={pal.roofFill} strokeWidth={sw} />
  );
};

// ─── Levels ─────────────────────────────────────────────────────────────────

const Levels: React.FC<{
  levels: Facade2DLevel[]; ox: number; oy: number;
  facadeW: number; facadeH: number;
  pal: Facade2DPalette; theme: Facade2DRenderTheme;
}> = ({ levels, ox, oy, facadeW, facadeH, pal, theme }) => {
  const els: React.ReactNode[] = [];
  let curY = oy + facadeH;

  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i];
    const lvlH = lvl.heightM * PX;
    curY -= lvlH;

    // Base level tinted band
    if (lvl.kind === 'base') {
      const socleH = lvlH * 0.28;
      els.push(
        <rect key={`socle-${i}`} x={ox} y={curY + lvlH - socleH} width={facadeW} height={socleH}
          fill={pal.base} opacity={0.12} />
      );
    }

    // Attic separator line
    if (lvl.kind === 'attic') {
      els.push(
        <line key={`at-${i}`} x1={ox} y1={curY} x2={ox + facadeW} y2={curY}
          stroke={pal.facadeAccent} strokeWidth={theme.strokeWidth * 1.5} />
      );
    }

    // Floor line
    if (i > 0) {
      els.push(
        <line key={`fl-${i}`} x1={ox} y1={curY + lvlH} x2={ox + facadeW} y2={curY + lvlH}
          stroke={pal.facadeAccent} strokeWidth={theme.strokeWidth * 0.5} />
      );
    }

    // Loggias — drawn BEFORE openings as recessed background
    for (let j = 0; j < lvl.loggias.length; j++) {
      const lg = lvl.loggias[j];
      const lx = ox + lg.offsetXM * PX;
      const ly = curY + lg.offsetYM * PX;
      const lw = lg.widthM * PX;
      const lh = lg.heightM * PX;
      els.push(
        <rect key={`lg-${i}-${j}`} x={lx} y={ly} width={lw} height={lh}
          fill={pal.loggiaBg} stroke={pal.facadeAccent} strokeWidth={theme.strokeWidth * 0.6} rx={1} />
      );
    }

    // Openings
    for (let j = 0; j < lvl.openings.length; j++) {
      const op = lvl.openings[j];
      const opX = ox + op.offsetXM * PX;
      const opY = curY + op.offsetYM * PX;
      const opW = op.widthM * PX;
      const opH = op.heightM * PX;
      const k = `o${i}${j}`;

      // Frame (slightly larger behind glass)
      els.push(
        <rect key={`${k}f`} x={opX - 1.2} y={opY - 1.2} width={opW + 2.4} height={opH + 2.4}
          fill={pal.frameFill} rx={theme.cornerRadius * 0.5 + 1} />
      );

      // Arch top (replaces top of window rect)
      if (op.hasArch) {
        const archR = opW / 2;
        els.push(
          <path key={`${k}ar`}
            d={`M${opX},${opY + archR} A${archR},${archR} 0 0,1 ${opX + opW},${opY + archR} L${opX + opW},${opY + opH} L${opX},${opY + opH} Z`}
            fill={pal.openingFill} stroke={pal.openingStroke} strokeWidth={theme.strokeWidth} />
        );
      } else {
        // Glass
        els.push(
          <rect key={k} x={opX} y={opY} width={opW} height={opH}
            fill={pal.openingFill} stroke={pal.openingStroke}
            strokeWidth={theme.strokeWidth} rx={theme.cornerRadius * 0.5} />
        );
      }

      // Mullion vertical
      if (op.kind === 'window' || op.kind === 'french-window') {
        els.push(
          <line key={`${k}v`}
            x1={opX + opW / 2} y1={opY + (op.hasArch ? opW / 2 : 0)} x2={opX + opW / 2} y2={opY + opH}
            stroke={pal.openingStroke} strokeWidth={theme.strokeWidth * 0.4} />
        );
      }
      // Mullion horizontal (windows only)
      if (op.kind === 'window') {
        els.push(
          <line key={`${k}h`}
            x1={opX} y1={opY + opH * 0.45} x2={opX + opW} y2={opY + opH * 0.45}
            stroke={pal.openingStroke} strokeWidth={theme.strokeWidth * 0.4} />
        );
      }

      // Shutters
      if (op.hasShutter) {
        const sw = 3.5;
        els.push(
          <rect key={`${k}sl`} x={opX - sw - 1.5} y={opY} width={sw} height={opH} fill={pal.shutterFill} rx={1} />,
          <rect key={`${k}sr`} x={opX + opW + 1.5} y={opY} width={sw} height={opH} fill={pal.shutterFill} rx={1} />,
        );
        // Shutter slat lines
        const slatCount = Math.floor(opH / 4);
        for (let s = 1; s < slatCount; s++) {
          const sy = opY + (opH / slatCount) * s;
          els.push(
            <line key={`${k}sll${s}`} x1={opX - sw - 1.5} y1={sy} x2={opX - 1.5} y2={sy} stroke={pal.shadow} strokeWidth={0.3} />,
            <line key={`${k}slr${s}`} x1={opX + opW + 1.5} y1={sy} x2={opX + opW + 1.5 + sw} y2={sy} stroke={pal.shadow} strokeWidth={0.3} />,
          );
        }
      }
    }

    // Balconies
    for (let j = 0; j < lvl.balconies.length; j++) {
      const bal = lvl.balconies[j];
      const bx = ox + bal.offsetXM * PX;
      const refOpH = (lvl.openings[0]?.heightM ?? 1.5) * PX;
      const refOpY = (lvl.openings[0]?.offsetYM ?? 0.5) * PX;
      const by = curY + refOpY + refOpH;
      const bw = bal.widthM * PX;
      const bd = Math.max(bal.depthM * PX, 2.5);

      // Slab
      els.push(
        <rect key={`b${i}${j}`} x={bx} y={by} width={bw} height={bd}
          fill={pal.balconyFill} stroke={pal.balconyStroke} strokeWidth={theme.strokeWidth} />
      );

      // Railing
      if (bal.mode === 'continuous') {
        // Solid rail line
        els.push(
          <line key={`r${i}${j}`} x1={bx} y1={by - 1} x2={bx + bw} y2={by - 1}
            stroke={pal.balconyStroke} strokeWidth={theme.strokeWidth * 0.7} />
        );
        // Balusters
        const spacing = 6;
        const n = Math.floor(bw / spacing);
        for (let b = 1; b < n; b++) {
          els.push(
            <line key={`bl${i}${j}${b}`}
              x1={bx + b * spacing} y1={by - 1} x2={bx + b * spacing} y2={by}
              stroke={pal.balconyStroke} strokeWidth={0.5} />
          );
        }
      } else {
        // Punctual: dashed rail
        els.push(
          <line key={`r${i}${j}`} x1={bx} y1={by - 1} x2={bx + bw} y2={by - 1}
            stroke={pal.balconyStroke} strokeWidth={theme.strokeWidth * 0.6}
            strokeDasharray="3 2" />
        );
      }

      // Slab shadow
      els.push(
        <rect key={`bs${i}${j}`} x={bx + 1} y={by + bd} width={bw - 2} height={1.5}
          fill={pal.shadow} rx={0.5} />
      );
    }
  }

  return <>{els}</>;
};

// ─── Vegetation ─────────────────────────────────────────────────────────────

const Vegetation: React.FC<{
  vegetation: Facade2DVegetation;
  groundY: number;
  vbW: number;
  facadeLeft: number;
  facadeRight: number;
  pal: Facade2DPalette;
}> = ({ vegetation, groundY, vbW, facadeLeft, facadeRight, pal }) => {
  if (vegetation === 'aucune') return null;

  const trees: React.ReactNode[] = [];

  const drawTree = (cx: number, size: 'small' | 'medium' | 'large', key: string) => {
    const trunkH = size === 'large' ? 18 : size === 'medium' ? 14 : 10;
    const crownR = size === 'large' ? 16 : size === 'medium' ? 12 : 8;
    const crownY = groundY - trunkH - crownR * 0.6;

    trees.push(
      <g key={key}>
        {/* Trunk */}
        <rect x={cx - 1.5} y={groundY - trunkH} width={3} height={trunkH}
          fill={pal.treeTrunk} rx={1} />
        {/* Crown */}
        <ellipse cx={cx} cy={crownY} rx={crownR} ry={crownR * 0.85}
          fill={pal.treeFill} opacity={0.85} />
        {/* Crown highlight */}
        <ellipse cx={cx - crownR * 0.2} cy={crownY - crownR * 0.15} rx={crownR * 0.6} ry={crownR * 0.5}
          fill={pal.treeFill} opacity={0.4} />
      </g>
    );
  };

  const leftZone = facadeLeft - 10;
  const rightZone = facadeRight + 10;

  switch (vegetation) {
    case 'legere':
      drawTree(leftZone - 15, 'medium', 't-l1');
      drawTree(rightZone + 18, 'small', 't-r1');
      break;
    case 'residentielle':
      drawTree(leftZone - 12, 'medium', 't-l1');
      drawTree(leftZone - 30, 'small', 't-l2');
      drawTree(rightZone + 14, 'medium', 't-r1');
      drawTree(rightZone + 32, 'small', 't-r2');
      break;
    case 'premium':
      drawTree(leftZone - 10, 'large', 't-l1');
      drawTree(leftZone - 28, 'medium', 't-l2');
      drawTree(leftZone - 42, 'small', 't-l3');
      drawTree(rightZone + 12, 'large', 't-r1');
      drawTree(rightZone + 30, 'medium', 't-r2');
      drawTree(rightZone + 44, 'small', 't-r3');
      break;
  }

  return <>{trees}</>;
};