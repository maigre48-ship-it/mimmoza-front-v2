import React from 'react';
import type {
  Facade2DModel, Facade2DLevel, Facade2DPalette, Facade2DRenderTheme,
  Facade2DVegetation, Facade2DOpening, Facade2DStylePresetId,
} from './facade2d.types';

interface Props { model: Facade2DModel; width?: number; }

// ─── Projection ─────────────────────────────────────────────────────────────

const PX = 20;
const ANG = 36;
const DR = 0.44;
const R = (ANG * Math.PI) / 180;
const DX = Math.cos(R) * DR * PX;
const DY = Math.sin(R) * DR * PX;

function p(x: number, y: number, z: number, ox: number, by: number): [number, number] {
  return [ox + x * PX + z * DX, by - y * PX - z * DY];
}
function pts(c: [number, number, number][], ox: number, by: number): string {
  return c.map(v => p(v[0], v[1], v[2], ox, by).join(',')).join(' ');
}

// ─── Style helpers ──────────────────────────────────────────────────────────

interface StyleTraits {
  /** Window width ratio relative to bay width */
  winWRatio: number;
  /** Window height ratio relative to floor height */
  winHRatio: number;
  /** RDC opening height ratio */
  rdcHRatio: number;
  /** RDC opening width ratio */
  rdcWRatio: number;
  /** Attic opening height ratio */
  atticHRatio: number;
  /** Frame thickness multiplier */
  frameMul: number;
  /** Use arch on RDC */
  rdcArch: boolean;
  /** Use arch on typical floors */
  typicalArch: boolean;
  /** Railing style */
  railStyle: 'glass' | 'iron' | 'bars' | 'mixed';
  /** Entry canopy style */
  entryStyle: 'slab' | 'arch' | 'marquise' | 'none';
}

function getStyleTraits(id: Facade2DStylePresetId): StyleTraits {
  switch (id) {
    case 'contemporain-urbain':
      return { winWRatio: 0.62, winHRatio: 0.62, rdcHRatio: 0.72, rdcWRatio: 0.68,
        atticHRatio: 0.48, frameMul: 0.7, rdcArch: false, typicalArch: false,
        railStyle: 'glass', entryStyle: 'slab' };
    case 'residentiel-premium':
      return { winWRatio: 0.44, winHRatio: 0.58, rdcHRatio: 0.65, rdcWRatio: 0.50,
        atticHRatio: 0.45, frameMul: 1.0, rdcArch: false, typicalArch: false,
        railStyle: 'mixed', entryStyle: 'marquise' };
    case 'classique-revisite':
      return { winWRatio: 0.40, winHRatio: 0.62, rdcHRatio: 0.68, rdcWRatio: 0.55,
        atticHRatio: 0.42, frameMul: 1.3, rdcArch: true, typicalArch: false,
        railStyle: 'iron', entryStyle: 'arch' };
    case 'mediterraneen-lumineux':
      return { winWRatio: 0.44, winHRatio: 0.54, rdcHRatio: 0.62, rdcWRatio: 0.52,
        atticHRatio: 0.42, frameMul: 0.9, rdcArch: true, typicalArch: true,
        railStyle: 'bars', entryStyle: 'slab' };
    default:
      return { winWRatio: 0.48, winHRatio: 0.56, rdcHRatio: 0.66, rdcWRatio: 0.55,
        atticHRatio: 0.44, frameMul: 1.0, rdcArch: false, typicalArch: false,
        railStyle: 'bars', entryStyle: 'slab' };
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

const GROUND_H = 38;
const SKY_H = 58;
const ML = 46;
const MR = 26;
const VEG_W = 68;

const FacadePerspectiveSketchRenderer: React.FC<Props> = ({ model, width = 840 }) => {
  const { theme, levels, widthM, heightM, roofKind, hasCornice, hasSocle,
    vegetation, ambiance, hasAttic, stylePresetId } = model;
  const pal = theme.palette;
  const depthM = widthM * 0.52;
  const st = getStyleTraits(stylePresetId);

  const fW = widthM * PX;
  const fH = heightM * PX;
  const dPxX = depthM * DX;
  const dPxY = depthM * DY;

  const vegPad = vegetation !== 'aucune' ? VEG_W : 24;
  const vbW = fW + dPxX + ML + MR + vegPad;
  const vbH = fH + dPxY + GROUND_H + SKY_H;
  const ox = ML + vegPad * 0.55;
  const by = SKY_H + fH + dPxY;

  const dark = ambiance === 'crepuscule';
  const warm = ambiance === 'golden';
  const sideTint = dark ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.10)';

  const atticLvl = levels.find(l => l.kind === 'attic');
  const atticH = atticLvl ? atticLvl.heightM : 0;
  const bodyH = heightM - atticH;
  const sb = 0.09;
  const aL = widthM * sb;
  const aR = widthM * (1 - sb);
  const aD = depthM * (1 - sb);

  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} width={width}
      style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
      xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ps-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={pal.skyTop} />
          <stop offset="72%" stopColor={pal.skyBottom} />
          <stop offset="100%" stopColor={dark ? '#48384E' : warm ? '#F2E8D4' : '#EDEBE4'} />
        </linearGradient>
        <linearGradient id="ps-gnd" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={dark ? '#484444' : '#CCC4B8'} />
          <stop offset="100%" stopColor={dark ? '#282828' : '#B4ACA0'} />
        </linearGradient>
        <linearGradient id="ps-gl" x1="0" y1="0" x2="0.12" y2="1">
          <stop offset="0%" stopColor={dark ? '#3A4A5A' : '#B0CDE0'} stopOpacity="0.85" />
          <stop offset="100%" stopColor={dark ? '#283848' : '#84AAC4'} />
        </linearGradient>
        <linearGradient id="ps-gls" x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0%" stopColor={dark ? '#283848' : '#8CA4BA'} stopOpacity="0.78" />
          <stop offset="100%" stopColor={dark ? '#1A2838' : '#7494AA'} />
        </linearGradient>
        <filter id="ps-pap" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" stitchTiles="stitch" result="n" />
          <feColorMatrix type="saturate" values="0" in="n" result="g" />
          <feBlend in="SourceGraphic" in2="g" mode="multiply" />
          <feComponentTransfer><feFuncA type="linear" slope="0.96" /></feComponentTransfer>
        </filter>
        <filter id="ps-sh">
          <feGaussianBlur in="SourceAlpha" stdDeviation="3.8" />
          <feOffset dx="5" dy="5" />
          <feComponentTransfer><feFuncA type="linear" slope="0.08" /></feComponentTransfer>
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Sky + ground */}
      <rect x={0} y={0} width={vbW} height={by} fill="url(#ps-sky)" />
      <rect x={0} y={by} width={vbW} height={GROUND_H + 12} fill="url(#ps-gnd)" />

      <g filter="url(#ps-pap)">

        {/* Ground shadow */}
        <polygon points={pts([[-0.6, 0, -0.4], [widthM + 0.6, 0, -0.4], [widthM + 1.2, 0, depthM * 0.35], [-0.6, 0, depthM * 0.35]], ox, by)}
          fill="rgba(0,0,0,0.04)" />

        {/* Sidewalk — 3 bands */}
        {[
          { z1: -0.9, z2: -0.55, op: 0.3 },
          { z1: -0.55, z2: -0.3, op: 0.45 },
          { z1: -0.3, z2: -0.08, op: 0.25 },
        ].map(({ z1, z2, op }, idx) => (
          <polygon key={`sw${idx}`}
            points={pts([[-0.8, 0.01, z1], [widthM + 0.8, 0.01, z1], [widthM + 0.8, 0.01, z2], [-0.8, 0.01, z2]], ox, by)}
            fill={dark ? '#504C4C' : '#D4CCC2'} opacity={op} />
        ))}

        {/* ═══ Body ═══ */}
        <g filter="url(#ps-sh)">
          {/* Front */}
          <polygon points={pts([[0, 0, 0], [widthM, 0, 0], [widthM, bodyH, 0], [0, bodyH, 0]], ox, by)}
            fill={pal.facade} stroke={pal.facadeAccent} strokeWidth={0.35} />
          {/* Side */}
          <polygon points={pts([[widthM, 0, 0], [widthM, 0, depthM], [widthM, bodyH, depthM], [widthM, bodyH, 0]], ox, by)}
            fill={pal.facade} stroke={pal.facadeAccent} strokeWidth={0.3} />
          <polygon points={pts([[widthM, 0, 0], [widthM, 0, depthM], [widthM, bodyH, depthM], [widthM, bodyH, 0]], ox, by)}
            fill={sideTint} />
        </g>

        {/* Corner line accent */}
        {(() => {
          const [cx1, cy1] = p(widthM, 0, 0, ox, by);
          const [cx2, cy2] = p(widthM, bodyH, 0, ox, by);
          return <line x1={cx1} y1={cy1} x2={cx2} y2={cy2} stroke={pal.facadeAccent} strokeWidth={0.6} />;
        })()}

        {/* ═══ Socle ═══ */}
        {hasSocle && <Socle widthM={widthM} depthM={depthM} ox={ox} by={by} pal={pal} dark={dark} />}

        {/* ═══ Corniche ═══ */}
        {hasCornice && <Corniche widthM={widthM} depthM={depthM} bodyH={bodyH} ox={ox} by={by} pal={pal} />}

        {/* Roof top (no attic) */}
        {!hasAttic && (
          <polygon points={pts([[-0.04, bodyH, -0.04], [widthM + 0.04, bodyH, -0.04], [widthM + 0.04, bodyH, depthM + 0.04], [-0.04, bodyH, depthM + 0.04]], ox, by)}
            fill={pal.roofFill} opacity={0.5} stroke={pal.roofFill} strokeWidth={0.25} />
        )}

        {/* ═══ Attic ═══ */}
        {hasAttic && atticH > 0 && (
          <AtticBlock widthM={widthM} depthM={depthM} bodyH={bodyH} heightM={heightM} atticH={atticH}
            aL={aL} aR={aR} aD={aD}
            ox={ox} by={by} pal={pal} sideTint={sideTint}
            vegetation={vegetation} atticLvl={atticLvl!} st={st} />
        )}

        {/* ═══ Front openings + balconies ═══ */}
        <FrontDetails levels={levels} widthM={widthM} ox={ox} by={by} pal={pal} theme={theme} model={model} st={st} />

        {/* ═══ Side windows ═══ */}
        <SideWindows levels={levels} widthM={widthM} depthM={depthM} ox={ox} by={by} pal={pal} st={st} />

      </g>

      {/* ═══ Ground planting ═══ */}
      <GroundPlanting vegetation={vegetation} widthM={widthM} ox={ox} by={by} pal={pal} dark={dark} />

      {/* ═══ Trees ═══ */}
      <Trees vegetation={vegetation} ox={ox} by={by} widthM={widthM} depthM={depthM} pal={pal} dark={dark} />

      {/* Ground line */}
      {(() => {
        const [x1, y1] = p(-1, 0, 0, ox, by);
        const [x2, y2] = p(widthM + 1, 0, 0, ox, by);
        return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={pal.base} strokeWidth={0.5} />;
      })()}
    </svg>
  );
};

export default FacadePerspectiveSketchRenderer;

// ═════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═════════════════════════════════════════════════════════════════════════════

// ─── Socle ──────────────────────────────────────────────────────────────────

const Socle: React.FC<{
  widthM: number; depthM: number; ox: number; by: number;
  pal: Facade2DPalette; dark: boolean;
}> = ({ widthM, depthM, ox, by, pal }) => {
  const h = 0.55;
  const pr = 0.05; // projection
  return (
    <g>
      {/* Front band */}
      <polygon points={pts([[-pr, 0, -pr], [widthM + pr, 0, -pr], [widthM + pr, h, -pr], [-pr, h, -pr]], ox, by)}
        fill={pal.base} opacity={0.16} />
      {/* Top line */}
      {(() => { const [a, b] = p(-pr, h, -pr, ox, by); const [c, d] = p(widthM + pr, h, -pr, ox, by);
        return <line x1={a} y1={b} x2={c} y2={d} stroke={pal.base} strokeWidth={0.3} opacity={0.3} />; })()}
      {/* Bottom line */}
      {(() => { const [a, b] = p(-pr, 0.02, -pr, ox, by); const [c, d] = p(widthM + pr, 0.02, -pr, ox, by);
        return <line x1={a} y1={b} x2={c} y2={d} stroke={pal.base} strokeWidth={0.2} opacity={0.2} />; })()}
      {/* Side */}
      <polygon points={pts([[widthM + pr, 0, -pr], [widthM + pr, 0, depthM], [widthM + pr, h, depthM], [widthM + pr, h, -pr]], ox, by)}
        fill={pal.base} opacity={0.08} />
    </g>
  );
};

// ─── Corniche ───────────────────────────────────────────────────────────────

const Corniche: React.FC<{
  widthM: number; depthM: number; bodyH: number;
  ox: number; by: number; pal: Facade2DPalette;
}> = ({ widthM, depthM, bodyH, ox, by, pal }) => {
  const cH = 0.16;
  const pr = 0.12;
  return (
    <g>
      <polygon points={pts([[-pr, bodyH, -pr], [widthM + pr, bodyH, -pr], [widthM + pr, bodyH + cH, -pr], [-pr, bodyH + cH, -pr]], ox, by)}
        fill={pal.corniceFill} />
      {/* Shadow under */}
      <polygon points={pts([[-pr, bodyH - 0.03, -pr], [widthM + pr, bodyH - 0.03, -pr], [widthM + pr, bodyH, -pr], [-pr, bodyH, -pr]], ox, by)}
        fill="rgba(0,0,0,0.05)" />
      {/* Side return */}
      <polygon points={pts([[widthM + pr, bodyH, -pr], [widthM + pr, bodyH, depthM], [widthM + pr, bodyH + cH, depthM], [widthM + pr, bodyH + cH, -pr]], ox, by)}
        fill={pal.corniceFill} opacity={0.55} />
      {/* Top */}
      <polygon points={pts([[-pr, bodyH + cH, -pr], [widthM + pr, bodyH + cH, -pr], [widthM + pr, bodyH + cH, depthM], [-pr, bodyH + cH, depthM]], ox, by)}
        fill={pal.corniceFill} opacity={0.25} />
    </g>
  );
};

// ─── Attic ──────────────────────────────────────────────────────────────────

const AtticBlock: React.FC<{
  widthM: number; depthM: number; bodyH: number; heightM: number; atticH: number;
  aL: number; aR: number; aD: number;
  ox: number; by: number; pal: Facade2DPalette; sideTint: string;
  vegetation: Facade2DVegetation; atticLvl: Facade2DLevel; st: StyleTraits;
}> = ({ widthM, depthM, bodyH, heightM, aL, aR, aD, ox, by, pal, sideTint, vegetation, atticLvl, st }) => {
  const railH = 1.0;
  return (
    <g>
      {/* Terrace floor */}
      <polygon points={pts([[0, bodyH, 0], [widthM, bodyH, 0], [widthM, bodyH, depthM], [0, bodyH, depthM]], ox, by)}
        fill={pal.facadeAccent} opacity={0.3} stroke={pal.facadeAccent} strokeWidth={0.15} />

      {/* Attic front */}
      <polygon points={pts([[aL, bodyH, 0], [aR, bodyH, 0], [aR, heightM, 0], [aL, heightM, 0]], ox, by)}
        fill={pal.facade} stroke={pal.facadeAccent} strokeWidth={0.3} />
      {/* Attic side */}
      <polygon points={pts([[aR, bodyH, 0], [aR, bodyH, aD], [aR, heightM, aD], [aR, heightM, 0]], ox, by)}
        fill={pal.facade} stroke={pal.facadeAccent} strokeWidth={0.25} />
      <polygon points={pts([[aR, bodyH, 0], [aR, bodyH, aD], [aR, heightM, aD], [aR, heightM, 0]], ox, by)}
        fill={sideTint} />
      {/* Attic corner accent */}
      {(() => { const [a, b] = p(aR, bodyH, 0, ox, by); const [c, d] = p(aR, heightM, 0, ox, by);
        return <line x1={a} y1={b} x2={c} y2={d} stroke={pal.facadeAccent} strokeWidth={0.45} />; })()}

      {/* Attic roof */}
      <polygon points={pts([[aL, heightM, 0], [aR, heightM, 0], [aR, heightM, aD], [aL, heightM, aD]], ox, by)}
        fill={pal.roofFill} opacity={0.55} stroke={pal.roofFill} strokeWidth={0.2} />

      {/* Terrace railing — left wing */}
      {(() => {
        const [a, b] = p(0, bodyH + railH, -0.04, ox, by);
        const [c, d] = p(aL - 0.15, bodyH + railH, -0.04, ox, by);
        return <line x1={a} y1={b} x2={c} y2={d} stroke={pal.balconyStroke} strokeWidth={0.35} />;
      })()}
      {/* Terrace railing — right wing */}
      {(() => {
        const [a, b] = p(aR + 0.15, bodyH + railH, -0.04, ox, by);
        const [c, d] = p(widthM, bodyH + railH, -0.04, ox, by);
        return <line x1={a} y1={b} x2={c} y2={d} stroke={pal.balconyStroke} strokeWidth={0.35} />;
      })()}
      {/* Terrace balusters */}
      {[0.08, 0.18, 0.28, 0.38].map(pct => {
        const xm = widthM * pct;
        const [a, b] = p(xm, bodyH + 0.05, -0.04, ox, by);
        const [c, d] = p(xm, bodyH + railH, -0.04, ox, by);
        return <line key={`tlb${pct}`} x1={a} y1={b} x2={c} y2={d} stroke={pal.balconyStroke} strokeWidth={0.2} />;
      })}
      {[0.62, 0.72, 0.82, 0.92].map(pct => {
        const xm = widthM * pct;
        const [a, b] = p(xm, bodyH + 0.05, -0.04, ox, by);
        const [c, d] = p(xm, bodyH + railH, -0.04, ox, by);
        return <line key={`trb${pct}`} x1={a} y1={b} x2={c} y2={d} stroke={pal.balconyStroke} strokeWidth={0.2} />;
      })}

      {/* Terrace planters */}
      {vegetation !== 'aucune' && [0.18, 0.35, 0.65, 0.82].map(pct => {
        const bx = widthM * pct;
        const bw = 1.1;
        const bh = 0.45;
        const [cx, cy] = p(bx, bodyH + bh + 0.25, 0.35, ox, by);
        return (
          <g key={`plt${pct}`}>
            <polygon points={pts([[bx - bw / 2, bodyH, 0.25], [bx + bw / 2, bodyH, 0.25], [bx + bw / 2, bodyH + bh, 0.25], [bx - bw / 2, bodyH + bh, 0.25]], ox, by)}
              fill={pal.treeFill} opacity={0.28} />
            <ellipse cx={cx} cy={cy} rx={bw * PX * 0.2} ry={bw * PX * 0.14} fill={pal.treeFill} opacity={0.45} />
          </g>
        );
      })}

      {/* Attic openings (from level data) */}
      {atticLvl.openings.map((op, j) => {
        const oL = aL + op.offsetXM * ((aR - aL) / widthM);
        const oB = bodyH + op.offsetYM;
        const oW = op.widthM * ((aR - aL) / widthM);
        const oH = op.heightM;
        const zF = -0.02;
        return (
          <g key={`ato${j}`}>
            <polygon points={pts([[oL - 0.03, oB - 0.03, zF], [oL + oW + 0.03, oB - 0.03, zF], [oL + oW + 0.03, oB + oH + 0.03, zF], [oL - 0.03, oB + oH + 0.03, zF]], ox, by)}
              fill={pal.frameFill} />
            <polygon points={pts([[oL, oB, zF], [oL + oW, oB, zF], [oL + oW, oB + oH, zF], [oL, oB + oH, zF]], ox, by)}
              fill="url(#ps-gl)" stroke={pal.openingStroke} strokeWidth={0.25} />
          </g>
        );
      })}
    </g>
  );
};

// ─── Front Details ──────────────────────────────────────────────────────────

const FrontDetails: React.FC<{
  levels: Facade2DLevel[]; widthM: number;
  ox: number; by: number;
  pal: Facade2DPalette; theme: Facade2DRenderTheme;
  model: Facade2DModel; st: StyleTraits;
}> = ({ levels, widthM, ox, by, pal, theme, model, st }) => {
  const els: React.ReactNode[] = [];
  let curY = 0;

  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i];
    const h = lvl.heightM;
    const isBase = lvl.kind === 'base';
    const isAttic = lvl.kind === 'attic';

    if (isAttic) { curY += h; continue; } // attic handled separately

    // Floor line
    if (i > 0) {
      const [x1, y1] = p(0.2, curY, 0, ox, by);
      const [x2, y2] = p(widthM - 0.2, curY, 0, ox, by);
      els.push(
        <line key={`fl${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={pal.facadeAccent} strokeWidth={isBase ? 0.45 : 0.2}
          strokeDasharray={isBase ? 'none' : '1.5 4'} />
      );
    }

    // ─── Openings ───
    for (let j = 0; j < lvl.openings.length; j++) {
      const op = lvl.openings[j];
      const oL = op.offsetXM;
      const oB = curY + op.offsetYM;
      const oW = op.widthM;
      const oH = op.heightM;
      const zF = -0.025;

      const isEntry = isBase && j === Math.floor(lvl.openings.length / 2) && model.baseKind === 'residential';
      const useArch = isBase ? st.rdcArch : st.typicalArch;
      const doArch = (op.hasArch || useArch) && !isAttic;

      // Frame thickness based on style
      const ft = 0.035 * st.frameMul;

      // Lintel
      if (!doArch) {
        const lH = 0.05 * st.frameMul;
        els.push(
          <polygon key={`lt${i}${j}`}
            points={pts([[oL - ft, oB + oH, zF], [oL + oW + ft, oB + oH, zF], [oL + oW + ft, oB + oH + lH, zF], [oL - ft, oB + oH + lH, zF]], ox, by)}
            fill={pal.frameFill} opacity={0.45} />
        );
      }

      // Frame
      els.push(
        <polygon key={`fr${i}${j}`}
          points={pts([[oL - ft, oB - ft, zF], [oL + oW + ft, oB - ft, zF], [oL + oW + ft, oB + oH + ft, zF], [oL - ft, oB + oH + ft, zF]], ox, by)}
          fill={pal.frameFill} />
      );

      // Glass
      if (doArch) {
        const r = oW / 2;
        const [blx, bly] = p(oL, oB, zF, ox, by);
        const [brx, bry] = p(oL + oW, oB, zF, ox, by);
        const [trx, try_] = p(oL + oW, oB + oH - r, zF, ox, by);
        const [tlx, tly] = p(oL, oB + oH - r, zF, ox, by);
        const [apx, apy] = p(oL + oW / 2, oB + oH + r * 0.15, zF, ox, by);
        els.push(
          <path key={`ga${i}${j}`}
            d={`M${blx},${bly} L${brx},${bry} L${trx},${try_} Q${apx},${apy} ${tlx},${tly} Z`}
            fill="url(#ps-gl)" stroke={pal.openingStroke} strokeWidth={0.28} />
        );
      } else {
        els.push(
          <polygon key={`gl${i}${j}`}
            points={pts([[oL, oB, zF], [oL + oW, oB, zF], [oL + oW, oB + oH, zF], [oL, oB + oH, zF]], ox, by)}
            fill="url(#ps-gl)" stroke={pal.openingStroke} strokeWidth={0.28} />
        );
      }

      // Mullions
      if (op.kind === 'window' || op.kind === 'french-window') {
        const mTop = doArch ? oB + oH * 0.45 : oB;
        const [a, b] = p(oL + oW / 2, mTop, zF, ox, by);
        const [c, d] = p(oL + oW / 2, oB + oH, zF, ox, by);
        els.push(<line key={`mv${i}${j}`} x1={a} y1={b} x2={c} y2={d} stroke={pal.frameFill} strokeWidth={0.35} />);
      }
      if (op.kind === 'window') {
        const [a, b] = p(oL, oB + oH * 0.42, zF, ox, by);
        const [c, d] = p(oL + oW, oB + oH * 0.42, zF, ox, by);
        els.push(<line key={`mh${i}${j}`} x1={a} y1={b} x2={c} y2={d} stroke={pal.frameFill} strokeWidth={0.3} />);
      }

      // Sill
      els.push(
        <polygon key={`si${i}${j}`}
          points={pts([[oL - ft * 1.5, oB - 0.015, zF - 0.015], [oL + oW + ft * 1.5, oB - 0.015, zF - 0.015], [oL + oW + ft * 1.5, oB + 0.035, zF - 0.015], [oL - ft * 1.5, oB + 0.035, zF - 0.015]], ox, by)}
          fill={pal.frameFill} opacity={0.4} />
      );

      // Shutters
      if (op.hasShutter) {
        const shW = 0.18;
        els.push(
          <polygon key={`shl${i}${j}`}
            points={pts([[oL - shW - ft, oB, zF], [oL - ft, oB, zF], [oL - ft, oB + oH, zF], [oL - shW - ft, oB + oH, zF]], ox, by)}
            fill={pal.shutterFill} opacity={0.85} />,
          <polygon key={`shr${i}${j}`}
            points={pts([[oL + oW + ft, oB, zF], [oL + oW + ft + shW, oB, zF], [oL + oW + ft + shW, oB + oH, zF], [oL + oW + ft, oB + oH, zF]], ox, by)}
            fill={pal.shutterFill} opacity={0.85} />,
        );
      }

      // Entry canopy
      if (isEntry) {
        const canD = 0.75;
        const canW2 = oW * 0.55;
        if (st.entryStyle === 'marquise' || st.entryStyle === 'slab') {
          els.push(
            <polygon key={`can${i}${j}`}
              points={pts([[oL - 0.2, oB + oH + 0.04, 0], [oL + oW + 0.2, oB + oH + 0.04, 0], [oL + oW + 0.2, oB + oH + 0.04, -canD], [oL - 0.2, oB + oH + 0.04, -canD]], ox, by)}
              fill={pal.facadeAccent} stroke={pal.balconyStroke} strokeWidth={0.2} />,
            <polygon key={`canf${i}${j}`}
              points={pts([[oL - 0.2, oB + oH + 0.04, -canD], [oL + oW + 0.2, oB + oH + 0.04, -canD], [oL + oW + 0.2, oB + oH - 0.02, -canD], [oL - 0.2, oB + oH - 0.02, -canD]], ox, by)}
              fill={pal.base} opacity={0.15} />,
          );
        }
      }

      // Glass reflection
      {
        const rW = oW * 0.16;
        const rH = oH * 0.28;
        els.push(
          <polygon key={`rf${i}${j}`}
            points={pts([[oL + oW * 0.22, oB + oH * 0.55, zF - 0.001], [oL + oW * 0.22 + rW, oB + oH * 0.55, zF - 0.001], [oL + oW * 0.22 + rW, oB + oH * 0.55 + rH, zF - 0.001], [oL + oW * 0.22, oB + oH * 0.55 + rH, zF - 0.001]], ox, by)}
            fill="white" opacity={0.05} />
        );
      }
    }

    // ─── Balconies ───
    for (let j = 0; j < lvl.balconies.length; j++) {
      const bal = lvl.balconies[j];
      const bL = bal.offsetXM;
      const refH = lvl.openings[0]?.heightM ?? 1.5;
      const refY = lvl.openings[0]?.offsetYM ?? 0.5;
      const bBot = curY + refY + refH;
      const bW = bal.widthM;
      const bD = 0.9;
      const slabH = 0.08;
      const railH = 0.98;

      // Slab top
      els.push(
        <polygon key={`bt${i}${j}`}
          points={pts([[bL, bBot, 0], [bL + bW, bBot, 0], [bL + bW, bBot, -bD], [bL, bBot, -bD]], ox, by)}
          fill={pal.balconyFill} stroke={pal.balconyStroke} strokeWidth={0.25} />
      );
      // Slab front edge
      els.push(
        <polygon key={`bf${i}${j}`}
          points={pts([[bL, bBot, -bD], [bL + bW, bBot, -bD], [bL + bW, bBot - slabH, -bD], [bL, bBot - slabH, -bD]], ox, by)}
          fill={pal.balconyStroke} opacity={0.35} />
      );
      // Underside shadow
      els.push(
        <polygon key={`bsh${i}${j}`}
          points={pts([[bL + 0.1, bBot - slabH - 0.01, -bD + 0.04], [bL + bW - 0.1, bBot - slabH - 0.01, -bD + 0.04], [bL + bW - 0.1, bBot - slabH - 0.06, -bD + 0.04], [bL + 0.1, bBot - slabH - 0.06, -bD + 0.04]], ox, by)}
          fill="rgba(0,0,0,0.03)" />
      );

      // Railing — style-dependent
      const rTop = bBot + railH;
      const rBase = bBot + 0.06;
      // Top rail
      {
        const [a, b] = p(bL, rTop, -bD, ox, by);
        const [c, d] = p(bL + bW, rTop, -bD, ox, by);
        els.push(<line key={`brt${i}${j}`} x1={a} y1={b} x2={c} y2={d} stroke={pal.balconyStroke} strokeWidth={st.railStyle === 'glass' ? 0.5 : 0.4} />);
      }
      // Bottom rail (skip for glass)
      if (st.railStyle !== 'glass') {
        const [a, b] = p(bL, rBase, -bD, ox, by);
        const [c, d] = p(bL + bW, rBase, -bD, ox, by);
        els.push(<line key={`brb${i}${j}`} x1={a} y1={b} x2={c} y2={d} stroke={pal.balconyStroke} strokeWidth={0.25} />);
      }
      // Fill (glass style gets a semi-transparent panel)
      if (st.railStyle === 'glass') {
        els.push(
          <polygon key={`brgl${i}${j}`}
            points={pts([[bL + 0.05, rBase, -bD], [bL + bW - 0.05, rBase, -bD], [bL + bW - 0.05, rTop, -bD], [bL + 0.05, rTop, -bD]], ox, by)}
            fill={pal.openingFill} opacity={0.12} />
        );
      } else {
        // Balusters
        const nB = Math.max(3, Math.floor(bW / (st.railStyle === 'iron' ? 0.6 : 0.8)));
        const step = bW / (nB + 1);
        for (let b = 1; b <= nB; b++) {
          const bx = bL + b * step;
          const [a, ay] = p(bx, rBase, -bD, ox, by);
          const [c, cy] = p(bx, rTop, -bD, ox, by);
          els.push(<line key={`blst${i}${j}${b}`} x1={a} y1={ay} x2={c} y2={cy} stroke={pal.balconyStroke} strokeWidth={0.18} />);
        }
      }
    }

    // ─── Loggias ───
    for (let j = 0; j < lvl.loggias.length; j++) {
      const lg = lvl.loggias[j];
      const lx = lg.offsetXM;
      const ly = curY + lg.offsetYM;
      const lw = lg.widthM;
      const lh = lg.heightM;
      const ld = 0.18;
      els.push(
        <g key={`lg${i}${j}`}>
          <polygon points={pts([[lx, ly, ld], [lx + lw, ly, ld], [lx + lw, ly + lh, ld], [lx, ly + lh, ld]], ox, by)}
            fill={pal.loggiaBg} stroke={pal.facadeAccent} strokeWidth={0.2} />
          {/* Left reveal */}
          <polygon points={pts([[lx, ly, 0], [lx, ly, ld], [lx, ly + lh, ld], [lx, ly + lh, 0]], ox, by)}
            fill="rgba(0,0,0,0.035)" />
          {/* Top reveal */}
          <polygon points={pts([[lx, ly + lh, 0], [lx + lw, ly + lh, 0], [lx + lw, ly + lh, ld], [lx, ly + lh, ld]], ox, by)}
            fill="rgba(0,0,0,0.025)" />
        </g>
      );
    }

    curY += h;
  }

  return <>{els}</>;
};

// ─── Side Windows ───────────────────────────────────────────────────────────

const SideWindows: React.FC<{
  levels: Facade2DLevel[]; widthM: number; depthM: number;
  ox: number; by: number; pal: Facade2DPalette; st: StyleTraits;
}> = ({ levels, widthM, depthM, ox, by, pal, st }) => {
  const els: React.ReactNode[] = [];
  let curY = 0;
  const nBays = Math.max(2, Math.floor(depthM / 3.5));
  const bayD = depthM / (nBays + 1);

  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i];
    const h = lvl.heightM;
    const isBase = lvl.kind === 'base';
    const isAttic = lvl.kind === 'attic';
    if (isAttic) { curY += h; continue; }

    const winH = h * (isBase ? 0.52 : 0.46);
    const winD = isBase ? 0.75 : 0.5;
    const winY = (h - winH) * 0.55;

    for (let b = 0; b < nBays; b++) {
      const zC = bayD * (b + 1);
      const wy = curY + winY;
      const ft = 0.03 * st.frameMul;

      // Frame
      els.push(
        <polygon key={`swf${i}${b}`}
          points={pts([[widthM, wy - ft, zC - winD / 2 - ft], [widthM, wy - ft, zC + winD / 2 + ft], [widthM, wy + winH + ft, zC + winD / 2 + ft], [widthM, wy + winH + ft, zC - winD / 2 - ft]], ox, by)}
          fill={pal.frameFill} opacity={0.65} />
      );
      // Glass
      els.push(
        <polygon key={`sw${i}${b}`}
          points={pts([[widthM, wy, zC - winD / 2], [widthM, wy, zC + winD / 2], [widthM, wy + winH, zC + winD / 2], [widthM, wy + winH, zC - winD / 2]], ox, by)}
          fill="url(#ps-gls)" stroke={pal.openingStroke} strokeWidth={0.18} />
      );
    }
    curY += h;
  }
  return <>{els}</>;
};

// ─── Ground Planting ────────────────────────────────────────────────────────

const GroundPlanting: React.FC<{
  vegetation: Facade2DVegetation; widthM: number;
  ox: number; by: number; pal: Facade2DPalette; dark: boolean;
}> = ({ vegetation, widthM, ox, by, pal, dark }) => {
  if (vegetation === 'aucune') return null;
  const density = vegetation === 'premium' ? 0.28 : vegetation === 'residentielle' ? 0.2 : 0.12;
  return (
    <g>
      {/* Planting strip */}
      <polygon points={pts([[-0.3, 0.015, -0.75], [widthM + 0.3, 0.015, -0.75], [widthM + 0.3, 0.015, -0.3], [-0.3, 0.015, -0.3]], ox, by)}
        fill={pal.treeFill} opacity={density} />
      {/* Shrubs */}
      {Array.from({ length: Math.floor(widthM / 2.8) }, (_, i) => {
        const sx = 1.2 + i * 2.8 + (i % 2) * 0.4; // slight offset for organic feel
        const [cx, cy] = p(sx, 0.2, -0.5, ox, by);
        const r = 5 + (i % 3) * 1.5;
        return <ellipse key={`sh${i}`} cx={cx} cy={cy} rx={r} ry={r * 0.6}
          fill={pal.treeFill} opacity={0.25 + (i % 2) * 0.08} />;
      })}
    </g>
  );
};

// ─── Trees ──────────────────────────────────────────────────────────────────

const Trees: React.FC<{
  vegetation: Facade2DVegetation;
  ox: number; by: number; widthM: number; depthM: number;
  pal: Facade2DPalette; dark: boolean;
}> = ({ vegetation, ox, by, widthM, depthM, pal, dark }) => {
  if (vegetation === 'aucune') return null;
  const els: React.ReactNode[] = [];

  const tree = (x: number, z: number, sz: 'S' | 'M' | 'L', k: string) => {
    const tH = sz === 'L' ? 4.0 : sz === 'M' ? 2.8 : 1.8;
    const cR = sz === 'L' ? 2.5 : sz === 'M' ? 1.8 : 1.1;
    const [bx, bsy] = p(x, 0, z, ox, by);
    const [tx, ty] = p(x, tH, z, ox, by);
    const [cx, cy] = p(x, tH + cR * 0.35, z, ox, by);
    const crPx = cR * PX * 0.5;
    const leaf = dark ? '#284020' : pal.treeFill;
    const leaf2 = dark ? '#385030' : lighten(pal.treeFill, 18);
    const leaf3 = dark ? '#1A3018' : darken(pal.treeFill, 12);
    const trunk = dark ? '#382820' : pal.treeTrunk;

    els.push(
      <g key={k}>
        {/* Ground shadow */}
        <ellipse cx={bx + 3} cy={bsy + 1.5} rx={crPx * 0.5} ry={2} fill="rgba(0,0,0,0.03)" />
        {/* Trunk — slight taper */}
        <line x1={bx} y1={bsy} x2={tx} y2={ty} stroke={trunk}
          strokeWidth={sz === 'L' ? 2.8 : sz === 'M' ? 2 : 1.3} strokeLinecap="round" />
        {/* Crown layers — organic */}
        <ellipse cx={cx + crPx * 0.08} cy={cy + crPx * 0.1} rx={crPx * 0.95} ry={crPx * 0.78} fill={leaf3} opacity={0.5} />
        <ellipse cx={cx} cy={cy} rx={crPx} ry={crPx * 0.82} fill={leaf} opacity={0.85} />
        <ellipse cx={cx - crPx * 0.28} cy={cy - crPx * 0.2} rx={crPx * 0.55} ry={crPx * 0.45} fill={leaf2} opacity={0.4} />
        <ellipse cx={cx + crPx * 0.22} cy={cy - crPx * 0.08} rx={crPx * 0.38} ry={crPx * 0.32} fill={leaf2} opacity={0.25} />
      </g>
    );
  };

  switch (vegetation) {
    case 'legere':
      tree(-2.5, -1.2, 'M', 'a'); tree(widthM + 2, -1.5, 'S', 'b');
      break;
    case 'residentielle':
      tree(-2, -0.8, 'M', 'a'); tree(-4, -2.5, 'S', 'b');
      tree(widthM + 1.5, -1.2, 'M', 'c'); tree(widthM + 3.5, depthM * 0.3, 'S', 'd');
      break;
    case 'premium':
      tree(-1.5, -0.6, 'L', 'a'); tree(-3.5, -2.5, 'M', 'b'); tree(-5, 0.8, 'S', 'c');
      tree(widthM + 1.5, -1, 'L', 'd'); tree(widthM + 3.5, depthM * 0.35, 'M', 'e'); tree(widthM + 5, -2.5, 'S', 'f');
      break;
  }
  return <>{els}</>;
};

// ─── Color utils ────────────────────────────────────────────────────────────

function lighten(hex: string, n: number): string {
  const h = hex.replace('#', '');
  const r = Math.min(255, parseInt(h.substring(0, 2), 16) + n);
  const g = Math.min(255, parseInt(h.substring(2, 4), 16) + n);
  const b = Math.min(255, parseInt(h.substring(4, 6), 16) + n);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function darken(hex: string, n: number): string {
  const h = hex.replace('#', '');
  const r = Math.max(0, parseInt(h.substring(0, 2), 16) - n);
  const g = Math.max(0, parseInt(h.substring(2, 4), 16) - n);
  const b = Math.max(0, parseInt(h.substring(4, 6), 16) - n);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}