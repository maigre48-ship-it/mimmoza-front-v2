// src/spaces/promoteur/implantation/CotesControleOverlay.tsx
// LOT L1b — cotes colorées du contrôle d'implantation, dessinées dans le SVG
// de Plan2DCanvas (repère parcelleLocal, mètres). Vert = respecté (règle
// sourcée), rouge = non respecté, orange pointillé = à vérifier.

import React from "react";
import type { ControleImplantation } from "./implantationCheck";
import { VERDICT_COLORS, VERDICT_LABELS } from "./implantationCheck";
import { LIBELLES_CATEGORIE } from "./rulesetReculs";

const fmt = (v: number): string => `${v.toFixed(2).replace(".", ",")} m`;

export const CotesControleOverlay: React.FC<{ controle: ControleImplantation; zoom: number }> = ({ controle, zoom }) => {
  const sw = (px: number): number => px / (zoom > 0 ? zoom : 1);
  return (
    <g pointerEvents="none" data-l1b-cotes>
      {controle.batiments.flatMap((b) =>
        b.limites.map((l) => {
          const c = VERDICT_COLORS[l.verdict];
          const a = l.pointOnBuilding;
          const p = l.pointOnBoundary;
          const mx = (a.x + p.x) / 2;
          const my = (a.y + p.y) / 2;
          const label = l.horsParcelle ? `−${fmt(Math.abs(l.distanceSignee))}` : fmt(l.distance);
          return (
            <g key={`${b.buildingId}-${l.segmentId}`}>
              <title>{`${b.buildingName} · ${LIBELLES_CATEGORIE[l.categorie]} ${l.segmentId} : ${VERDICT_LABELS[l.verdict]} — ${l.explication}`}</title>
              <line
                x1={a.x} y1={a.y} x2={p.x} y2={p.y}
                stroke={c} strokeWidth={sw(1.6)}
                strokeDasharray={l.verdict === "a-verifier" ? `${sw(4)},${sw(3)}` : undefined}
              />
              <circle cx={a.x} cy={a.y} r={sw(2.4)} fill={c} />
              <circle cx={p.x} cy={p.y} r={sw(2.4)} fill="white" stroke={c} strokeWidth={sw(1.2)} />
              <text
                x={mx} y={my} textAnchor="middle" dominantBaseline="middle"
                fontSize={sw(9)} fontWeight={700} fill={c} fontFamily="Inter,system-ui,sans-serif"
                paintOrder="stroke" stroke="white" strokeWidth={sw(2.6)}
              >
                {label}
              </text>
            </g>
          );
        }),
      )}
    </g>
  );
};
