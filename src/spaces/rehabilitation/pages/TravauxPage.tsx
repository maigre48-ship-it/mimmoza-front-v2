// src/spaces/rehabilitation/pages/TravauxPage.tsx
// Copie autonome du simulateur travaux — adapté Réhabilitation (thème orange).
// Modifiable indépendamment de la version Investisseur.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeTravauxSimulation } from "../../investisseur/services/travauxCalculator.service";
import { TRAVAUX_PRICING_V1 } from "../../investisseur/services/travauxPricing.config";
import type {
  BinaryChoice,
  ChantierComplexity,
  ComputedLot,
  ComputedTravaux,
  ExpertLineItem,
  PieceTravaux,
  PieceType,
  PricingItemCode,
  RenovationLevel,
  TravauxOptionsSimple,
  TravauxRange,
  TravauxSimulationV1,
  TriChoice,
} from "../../investisseur/shared/travauxSimulation.types";
import { setRehabTravauxSnapshot } from "../shared/rehabTravauxSnapshot.store";
import { getActiveRehabSurface } from "../lib/activeProjectData";

/* ================================================================== */
/*  Thème Réhabilitation                                               */
/* ================================================================== */

const ACCENT       = "#f97316";
const ACCENT_LIGHT = "#fff7ed";
const ACCENT_DARK  = "#c2410c";
const GRAD         = "linear-gradient(135deg, #ea580c 0%, #fb923c 100%)";

/* ================================================================== */
/*  Pricing index                                                      */
/* ================================================================== */

interface PricingMeta {
  lotLabel: string;
  label: string;
  unit: string;
  prices: { eco: number; standard: number; premium: number };
}

const PRICING_MAP: Map<PricingItemCode, PricingMeta> = (() => {
  const m = new Map<PricingItemCode, PricingMeta>();
  for (const lot of TRAVAUX_PRICING_V1.lots) {
    for (const item of lot.items) {
      m.set(item.code, {
        lotLabel: lot.label,
        label: item.label,
        unit: item.unit,
        prices: item.prices,
      });
    }
  }
  return m;
})();

function getUnitPrice(code: PricingItemCode, range: TravauxRange): number {
  return PRICING_MAP.get(code)?.prices?.[range] ?? 0;
}

/* ================================================================== */
/*  Formatting                                                         */
/* ================================================================== */

const fmt     = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const fmtEuro = (n: number) => `${fmt(n)} €`;

/* ================================================================== */
/*  PieceUI model                                                      */
/* ================================================================== */

interface PieceUI {
  id: string; kind: PieceType; name: string; surfaceM2: number;
  peinture: boolean; sol: boolean; elec: boolean; plomb: boolean;
  isolTh: boolean; isolPh: boolean;
  cuisinePack: boolean; cuisinePose: boolean; cuisineDepose: boolean;
  sdbPack: boolean; sdbSpec: boolean; sdbDepose: boolean;
  qtyPeinture: number; qtySol: number; qtySpots: number; qtyRj45: number;
  qtyPlombPoints: number; qtyIsolTh: number; qtyIsolPh: number;
}

const PIECE_TYPE_OPTIONS: { value: PieceType; label: string; icon: string }[] = [
  { value: "sejour",  label: "Séjour",       icon: "🛋️" },
  { value: "chambre", label: "Chambre",       icon: "🛏️" },
  { value: "cuisine", label: "Cuisine",       icon: "🍳" },
  { value: "sdb",     label: "Salle de bain", icon: "🚿" },
  { value: "wc",      label: "WC",            icon: "🚽" },
  { value: "entree",  label: "Entrée",        icon: "🚪" },
  { value: "couloir", label: "Couloir",       icon: "🏠" },
  { value: "bureau",  label: "Bureau",        icon: "💻" },
  { value: "autre",   label: "Autre",         icon: "📐" },
];
const PIECE_ICONS: Record<string, string> = Object.fromEntries(
  PIECE_TYPE_OPTIONS.map((o) => [o.value, o.icon])
);

function defaultQtys(kind: PieceType, surfaceM2: number) {
  const s = Math.max(0, surfaceM2);
  return {
    qtyPeinture:     Math.round(s * 2.6),
    qtySol:          s,
    qtySpots:        Math.max(1, Math.round(s / 6)),
    qtyRj45:         kind === "sdb" || kind === "wc" ? 0 : Math.max(0, Math.round(s / 25)),
    qtyPlombPoints:  kind === "cuisine" ? 2 : kind === "sdb" ? 2 : kind === "wc" ? 1 : 0,
    qtyIsolTh:       s,
    qtyIsolPh:       s,
  };
}

function defaultToggles(kind: PieceType) {
  return {
    peinture:       true,
    sol:            true,
    elec:           true,
    plomb:          kind === "cuisine" || kind === "sdb" || kind === "wc",
    isolTh:         false,
    isolPh:         false,
    cuisinePack:    kind === "cuisine",
    cuisinePose:    kind === "cuisine",
    cuisineDepose:  false,
    sdbPack:        kind === "sdb",
    sdbSpec:        kind === "sdb",
    sdbDepose:      false,
  };
}

let _counter = 0;
function createPieceUI(kind: PieceType = "sejour", surfaceM2 = 15): PieceUI {
  _counter++;
  const label = PIECE_TYPE_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
  return {
    id: `piece_${Date.now()}_${_counter}`,
    kind,
    name: `${label} ${_counter}`,
    surfaceM2,
    ...defaultToggles(kind),
    ...defaultQtys(kind, surfaceM2),
  };
}

function pieceUIToTravaux(p: PieceUI): PieceTravaux {
  const items: ExpertLineItem[] = [];
  const push = (itemCode: PricingItemCode, qty: number) => {
    if (qty > 0) items.push({ itemCode, qty });
  };
  if (p.peinture) push("mur_peinture_simple", p.qtyPeinture);
  if (p.sol)      push("sol_parquet", p.qtySol);
  if (p.elec) {
    push("elec_spots", p.qtySpots);
    push("elec_rj45", p.qtyRj45);
  }
  if (p.plomb && p.qtyPlombPoints > 0)
    push("plomb_deplacement_points_eau", p.qtyPlombPoints);
  if (p.isolTh) push("isol_th_murs", p.qtyIsolTh);
  if (p.isolPh) push("isol_ph_murs_mitoyens", p.qtyIsolPh);
  if (p.kind === "cuisine") {
    if (p.cuisinePack)   push("cuisine_pack", 1);
    if (p.cuisinePose)   push("cuisine_pose", 1);
    if (p.cuisineDepose) push("demol_depose_cuisine", 1);
  }
  if (p.kind === "sdb") {
    if (p.sdbPack)   push("sdb_pack", 1);
    if (p.sdbSpec)   push("sdb_spec_etancheite", 1);
    if (p.sdbDepose) push("demol_depose_faience_sanitaires", 1);
  }
  return { id: p.id, type: p.kind, name: p.name, surfaceM2: p.surfaceM2, items };
}

/* ================================================================== */
/*  Defaults                                                           */
/* ================================================================== */

const DEFAULT_OPTIONS: TravauxOptionsSimple = {
  cuisineRefaire:       "none",
  sdbRefaire:           "none",
  electricite:          "none",
  plomberie:            "none",
  menuiseries:          "none",
  isolationThermique:   "none",
  isolationPhonique:    "none",
  demolition:           "none",
  gravats:              "none",
  humiditeTraitement:   "none",
  moe:                  "none",
};

const RANGE_OPTIONS: { value: TravauxRange; label: string }[] = [
  { value: "eco",      label: "Éco"      },
  { value: "standard", label: "Standard" },
  { value: "premium",  label: "Premium"  },
];

const LEVEL_OPTIONS: { value: RenovationLevel; label: string }[] = [
  { value: "refresh",  label: "Rafraîchissement" },
  { value: "standard", label: "Standard"         },
  { value: "heavy",    label: "Lourde"           },
  { value: "full",     label: "Complète"         },
];

const TRI_LABELS: Record<TriChoice, string> = { none: "Non", partial: "Partiel", full: "Complet" };

/* ================================================================== */
/*  UI atoms                                                           */
/* ================================================================== */

const TriSelect: React.FC<{
  label: string; value: TriChoice; onChange: (v: TriChoice) => void;
}> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between gap-2 py-1.5">
    <span className="text-sm text-gray-700">{label}</span>
    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
      {(["none", "partial", "full"] as TriChoice[]).map((opt) => (
        <button
          key={opt} type="button" onClick={() => onChange(opt)}
          className={`px-3 py-1 text-xs font-medium transition-colors ${
            value === opt ? "text-white" : "bg-white text-gray-500 hover:bg-gray-50"
          }`}
          style={value === opt ? { background: ACCENT } : undefined}
        >
          {TRI_LABELS[opt]}
        </button>
      ))}
    </div>
  </div>
);

const BinSelect: React.FC<{
  label: string; value: BinaryChoice; onChange: (v: BinaryChoice) => void;
}> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between gap-2 py-1.5">
    <span className="text-sm text-gray-700">{label}</span>
    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
      {(["none", "yes"] as BinaryChoice[]).map((opt) => (
        <button
          key={opt} type="button" onClick={() => onChange(opt)}
          className={`px-3 py-1 text-xs font-medium transition-colors ${
            value === opt ? "text-white" : "bg-white text-gray-500 hover:bg-gray-50"
          }`}
          style={value === opt ? { background: ACCENT } : undefined}
        >
          {opt === "none" ? "Non" : "Oui"}
        </button>
      ))}
    </div>
  </div>
);

const ToggleRow: React.FC<{
  label: string; checked: boolean; onChange: (v: boolean) => void;
  hint?: string; children?: React.ReactNode;
}> = ({ label, checked, onChange, hint, children }) => (
  <div className="flex items-center gap-3 py-1">
    <div
      className="w-9 h-5 rounded-full transition-colors relative cursor-pointer flex-shrink-0"
      style={{ background: checked ? ACCENT : "#d1d5db" }}
      onClick={() => onChange(!checked)}
    >
      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </div>
    <span className="text-xs text-gray-700 w-[5.5rem] flex-shrink-0 select-none">
      {label}
      {hint && <span className="text-[10px] text-gray-400 ml-1">({hint})</span>}
    </span>
    {children && <div className="flex-1 flex justify-end">{children}</div>}
  </div>
);

const InlineQty: React.FC<{
  value: number; unit: string; onChange: (v: number) => void;
}> = ({ value, unit, onChange }) => (
  <div className="flex items-center gap-1">
    <input
      type="number" min={0} step={1} value={value}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      className="w-14 text-xs text-right border border-gray-200 rounded-md px-1.5 py-1 focus:outline-none"
      style={{ focusRingColor: ACCENT } as React.CSSProperties}
    />
    <span className="text-[10px] text-gray-400 whitespace-nowrap">{unit}</span>
  </div>
);

/* ================================================================== */
/*  PieceCard                                                          */
/* ================================================================== */

const PieceCard: React.FC<{
  piece: PieceUI; range: TravauxRange;
  onChange: (updated: PieceUI) => void; onRemove: () => void;
}> = ({ piece, range, onChange, onRemove }) => {
  const p = piece;
  const update = (partial: Partial<PieceUI>) => onChange({ ...p, ...partial });
  const updateKind = (kind: PieceType) => {
    const label = PIECE_TYPE_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
    update({ kind, ...defaultToggles(kind), ...defaultQtys(kind, p.surfaceM2), name: label });
  };
  const updateSurface = (surfaceM2: number) =>
    update({ surfaceM2, ...defaultQtys(p.kind, surfaceM2) });
  const isCuisine = p.kind === "cuisine";
  const isSDB     = p.kind === "sdb";
  const icon      = PIECE_TYPE_OPTIONS.find((o) => o.value === p.kind)?.icon ?? "📐";
  const travaux   = pieceUIToTravaux(p);
  const quickTotal = travaux.items.reduce(
    (sum, li) => sum + li.qty * getUnitPrice(li.itemCode, range), 0
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-lg">{icon}</span>
          <select
            value={p.kind}
            onChange={(e) => updateKind(e.target.value as PieceType)}
            className="text-sm font-medium bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none"
          >
            {PIECE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.icon} {opt.label}</option>
            ))}
          </select>
          <input
            type="text" value={p.name}
            onChange={(e) => update({ name: e.target.value })}
            className="text-sm bg-transparent border-b border-gray-200 focus:border-orange-400 outline-none px-1 py-0.5 min-w-0 flex-1"
            placeholder="Nom"
          />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-bold" style={{ color: ACCENT_DARK }}>{fmtEuro(quickTotal)}</span>
          <button type="button" onClick={onRemove}
            className="text-gray-400 hover:text-red-500 transition-colors p-1" title="Supprimer">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs text-gray-500">Surface :</label>
        <input
          type="number" min={1} max={200} value={p.surfaceM2}
          onChange={(e) => updateSurface(Math.max(1, Number(e.target.value) || 1))}
          className="w-16 text-sm text-right border border-gray-200 rounded-md px-2 py-1 focus:outline-none"
        />
        <span className="text-xs text-gray-400">m²</span>
      </div>
      <div className="space-y-1.5">
        <ToggleRow label="Peinture"        checked={p.peinture} onChange={(v) => update({ peinture: v })}>
          {p.peinture && <InlineQty value={p.qtyPeinture} unit="m²"       onChange={(v) => update({ qtyPeinture: v })} />}
        </ToggleRow>
        <ToggleRow label="Sol"             checked={p.sol}      onChange={(v) => update({ sol: v })}>
          {p.sol      && <InlineQty value={p.qtySol}      unit="m²"       onChange={(v) => update({ qtySol: v })} />}
        </ToggleRow>
        <ToggleRow label="Électricité"     checked={p.elec}     onChange={(v) => update({ elec: v })}>
          {p.elec     && <InlineQty value={p.qtySpots}    unit="spots"    onChange={(v) => update({ qtySpots: v })} />}
        </ToggleRow>
        {p.elec && (
          <div className="flex items-center gap-3 py-1 pl-12">
            <span className="text-xs text-gray-400 w-[5.5rem] flex-shrink-0">↳ Prises RJ45</span>
            <div className="flex-1 flex justify-end">
              <InlineQty value={p.qtyRj45} unit="prises" onChange={(v) => update({ qtyRj45: v })} />
            </div>
          </div>
        )}
        <ToggleRow label="Plomberie"       checked={p.plomb}    onChange={(v) => update({ plomb: v })}>
          {p.plomb    && <InlineQty value={p.qtyPlombPoints} unit="pts d'eau" onChange={(v) => update({ qtyPlombPoints: v })} />}
        </ToggleRow>
        <ToggleRow label="Isol. thermique" checked={p.isolTh}   onChange={(v) => update({ isolTh: v })}>
          {p.isolTh   && <InlineQty value={p.qtyIsolTh}   unit="m²"       onChange={(v) => update({ qtyIsolTh: v })} />}
        </ToggleRow>
        <ToggleRow label="Isol. phonique"  checked={p.isolPh}   onChange={(v) => update({ isolPh: v })}>
          {p.isolPh   && <InlineQty value={p.qtyIsolPh}   unit="m²"       onChange={(v) => update({ qtyIsolPh: v })} />}
        </ToggleRow>
      </div>
      {isCuisine && (
        <div className="border-t border-gray-100 pt-2 space-y-1.5">
          <ToggleRow label="Pack cuisine"   checked={p.cuisinePack}   onChange={(v) => update({ cuisinePack: v })} />
          <ToggleRow label="Pose cuisine"   checked={p.cuisinePose}   onChange={(v) => update({ cuisinePose: v })} />
          <ToggleRow label="Dépose cuisine" checked={p.cuisineDepose} onChange={(v) => update({ cuisineDepose: v })} hint="forfait" />
        </div>
      )}
      {isSDB && (
        <div className="border-t border-gray-100 pt-2 space-y-1.5">
          <ToggleRow label="Pack SDB"        checked={p.sdbPack}   onChange={(v) => update({ sdbPack: v })} />
          <ToggleRow label="Étanchéité SPEC" checked={p.sdbSpec}   onChange={(v) => update({ sdbSpec: v })} />
          <ToggleRow label="Dépose faïence"  checked={p.sdbDepose} onChange={(v) => update({ sdbDepose: v })} hint="forfait" />
        </div>
      )}
    </div>
  );
};

/* ================================================================== */
/*  PieceEditor                                                        */
/* ================================================================== */

const PieceEditor: React.FC<{
  pieces: PieceUI[]; onChange: (pieces: PieceUI[]) => void; range: TravauxRange;
}> = ({ pieces, onChange, range }) => {
  const handleUpdate = useCallback(
    (id: string, updated: PieceUI) => onChange(pieces.map((p) => (p.id === id ? updated : p))),
    [pieces, onChange]
  );
  const handleRemove = useCallback(
    (id: string) => onChange(pieces.filter((p) => p.id !== id)),
    [pieces, onChange]
  );
  const handleAdd = useCallback(
    (kind: PieceType = "sejour") => onChange([...pieces, createPieceUI(kind, 15)]),
    [pieces, onChange]
  );

  return (
    <div className="space-y-3">
      {pieces.map((p) => (
        <PieceCard
          key={p.id} piece={p} range={range}
          onChange={(u) => handleUpdate(p.id, u)}
          onRemove={() => handleRemove(p.id)}
        />
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        {PIECE_TYPE_OPTIONS.slice(0, 5).map((opt) => (
          <button
            key={opt.value} type="button" onClick={() => handleAdd(opt.value)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg transition-colors hover:bg-orange-50 hover:text-orange-700 hover:border-orange-300"
          >
            <span>{opt.icon}</span><span>+ {opt.label}</span>
          </button>
        ))}
        <div className="relative group">
          <button type="button"
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-500 bg-gray-50 hover:bg-gray-100 border border-dashed border-gray-300 rounded-lg transition-colors">
            + Autre…
          </button>
          <div className="hidden group-hover:flex absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 flex-col min-w-[140px]">
            {PIECE_TYPE_OPTIONS.slice(5).map((opt) => (
              <button key={opt.value} type="button" onClick={() => handleAdd(opt.value)}
                className="text-left px-3 py-2 text-xs text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors first:rounded-t-lg last:rounded-b-lg">
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ================================================================== */
/*  PieceResultList                                                    */
/* ================================================================== */

interface LineResult {
  code: PricingItemCode; label: string; unit: string;
  qty: number; unitPrice: number; amount: number;
}
interface LotGroup { lotLabel: string; amount: number; lines: LineResult[]; }

function computePieceBreakdown(
  items: ExpertLineItem[], range: TravauxRange
): { groups: LotGroup[]; total: number } {
  const groupMap = new Map<string, LotGroup>();
  let total = 0;
  for (const li of items) {
    if (li.qty <= 0) continue;
    const meta = PRICING_MAP.get(li.itemCode);
    if (!meta) continue;
    const up = meta.prices[range];
    const amount = li.qty * up;
    total += amount;
    const existing = groupMap.get(meta.lotLabel) ?? { lotLabel: meta.lotLabel, amount: 0, lines: [] };
    existing.amount += amount;
    existing.lines.push({ code: li.itemCode, label: meta.label, unit: meta.unit, qty: li.qty, unitPrice: up, amount });
    groupMap.set(meta.lotLabel, existing);
  }
  return { groups: Array.from(groupMap.values()).sort((a, b) => b.amount - a.amount), total };
}

const PieceResultList: React.FC<{ pieces: PieceTravaux[]; range: TravauxRange }> = ({ pieces, range }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (pieces.length === 0)
    return <p className="text-sm text-gray-400 italic py-4 text-center">Ajoutez des pièces pour voir le détail.</p>;
  return (
    <div className="space-y-2">
      {pieces.map((piece) => {
        const { groups, total } = computePieceBreakdown(piece.items, range);
        const isOpen = expandedId === piece.id;
        const icon   = PIECE_ICONS[piece.type] ?? "📐";
        return (
          <div key={piece.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedId((prev) => (prev === piece.id ? null : piece.id))}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base">{icon}</span>
                <span className="text-sm font-medium text-gray-800 truncate">{piece.name}</span>
                <span className="text-xs text-gray-400">{piece.surfaceM2} m²</span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-sm font-semibold text-gray-900">{fmtEuro(total)}</span>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {isOpen && groups.length > 0 && (
              <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/50 space-y-3">
                {groups.map((g) => (
                  <div key={g.lotLabel}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: ACCENT_DARK }}>{g.lotLabel}</span>
                      <span className="text-xs font-medium text-gray-600">{fmtEuro(g.amount)}</span>
                    </div>
                    {g.lines.map((line, idx) => (
                      <div key={`${line.code}-${idx}`} className="flex items-center justify-between text-xs text-gray-600 pl-2 py-0.5">
                        <span className="truncate pr-2">{line.label}</span>
                        <span className="whitespace-nowrap">
                          {line.qty % 1 === 0 ? line.qty : line.qty.toFixed(1)} × {fmtEuro(line.unitPrice)} ={" "}
                          <span className="font-medium text-gray-800">{fmtEuro(line.amount)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ================================================================== */
/*  LotsBreakdown                                                      */
/* ================================================================== */

const LotsBreakdown: React.FC<{
  lots: ComputedLot[]; total: number; bufferPct: number; bufferAmount: number;
  totalWithBuffer: number; costPerM2: number | null; complexityCoef: number;
  disabledLots: Set<string>; onToggleLot: (code: string) => void;
}> = ({ lots, total, bufferPct, totalWithBuffer, costPerM2, complexityCoef, disabledLots, onToggleLot }) => {
  const [expandedLot, setExpandedLot] = useState<string | null>(null);
  const activeLots    = lots.filter((l) => l.amount > 0);
  const filteredTotal = activeLots.filter((l) => !disabledLots.has(l.code)).reduce((sum, l) => sum + l.amount, 0);
  const filteredBuffer          = Math.round(filteredTotal * bufferPct);
  const filteredTotalWithBuffer = filteredTotal + filteredBuffer;
  const filteredCostPerM2       = costPerM2 !== null && total > 0
    ? Math.round((filteredTotal / total) * (costPerM2 ?? 0)) : null;
  const disabledCount = disabledLots.size;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total HT</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmtEuro(filteredTotal)}</p>
          {disabledCount > 0 && (
            <p className="text-[10px] text-gray-400 mt-0.5">
              {disabledCount} lot{disabledCount > 1 ? "s" : ""} masqué{disabledCount > 1 ? "s" : ""}
            </p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Buffer ({(bufferPct * 100).toFixed(0)}%)</p>
          <p className="text-xl font-bold text-amber-600 mt-1">{fmtEuro(filteredBuffer)}</p>
        </div>
        <div className="rounded-xl p-4 text-center text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DARK})` }}>
          <p className="text-xs uppercase tracking-wide opacity-80">Total + Buffer</p>
          <p className="text-xl font-bold mt-1">{fmtEuro(filteredTotalWithBuffer)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">€/m²</p>
          <p className="text-xl font-bold text-gray-900 mt-1">
            {filteredCostPerM2 !== null ? fmtEuro(filteredCostPerM2) : "—"}
          </p>
        </div>
      </div>

      {/* Reset lots */}
      {disabledCount > 0 && (
        <div className="flex justify-start">
          <button
            type="button" onClick={() => onToggleLot("__reset__")}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 8,
              border: `1px solid ${ACCENT}`, background: ACCENT_LIGHT,
              color: ACCENT_DARK, fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
            </svg>
            Réafficher tous les lots
          </button>
        </div>
      )}

      {complexityCoef > 1 && (
        <p className="text-xs text-gray-500 text-right">Coef. complexité appliqué : ×{complexityCoef.toFixed(2)}</p>
      )}

      {/* Liste lots */}
      <div className="space-y-2">
        {activeLots.map((lot) => {
          const isDisabled = disabledLots.has(lot.code);
          const pct        = filteredTotal > 0 && !isDisabled ? (lot.amount / filteredTotal) * 100 : 0;
          const isOpen     = expandedLot === lot.code && !isDisabled;
          return (
            <div
              key={lot.code}
              className={`rounded-xl border overflow-hidden transition-opacity ${
                isDisabled ? "opacity-40 border-gray-200 bg-gray-50" : "border-gray-200 bg-white"
              }`}
            >
              <div className="flex items-center gap-0">
                <button
                  type="button" onClick={() => onToggleLot(lot.code)}
                  title={isDisabled ? "Réactiver ce lot" : "Masquer ce lot"}
                  className="flex-shrink-0 w-9 h-full flex items-center justify-center border-r border-gray-100 text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors"
                  style={{ minHeight: 48 }}
                >
                  {isDisabled ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => !isDisabled && setExpandedLot((prev) => (prev === lot.code ? null : lot.code))}
                  disabled={isDisabled}
                  className="flex-1 flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="h-2 rounded-full flex-shrink-0 transition-all"
                      style={{ width: isDisabled ? 4 : Math.max(4, pct * 0.8), background: ACCENT, opacity: isDisabled ? 0.3 : 1 }}
                    />
                    <span className={`text-sm font-medium truncate ${isDisabled ? "line-through text-gray-400" : "text-gray-800"}`}>
                      {lot.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {!isDisabled && <span className="text-xs text-gray-400">{pct.toFixed(1)}%</span>}
                    <span className={`text-sm font-semibold ${isDisabled ? "text-gray-400" : "text-gray-900"}`}>
                      {fmtEuro(lot.amount)}
                    </span>
                    {!isDisabled && (
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </div>
                </button>
              </div>
              {isOpen && lot.lines.length > 0 && (
                <div className="border-t border-gray-100 px-4 py-2 bg-gray-50/50">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 uppercase tracking-wider">
                        <th className="text-left py-1 font-medium">Poste</th>
                        <th className="text-right py-1 font-medium">Qté</th>
                        <th className="text-right py-1 font-medium">P.U.</th>
                        <th className="text-right py-1 font-medium">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lot.lines.map((line, idx) => (
                        <tr key={`${line.code}-${idx}`} className="border-t border-gray-100">
                          <td className="py-1.5 text-gray-700 pr-2">{line.label}</td>
                          <td className="py-1.5 text-right text-gray-600 whitespace-nowrap">
                            {line.qty % 1 === 0 ? line.qty : line.qty.toFixed(1)}{" "}
                            {line.unit !== "forfait" && line.unit !== "pct" ? line.unit : ""}
                          </td>
                          <td className="py-1.5 text-right text-gray-600 whitespace-nowrap">
                            {line.unit === "pct" ? `${(line.qty * 100).toFixed(0)}%` : fmtEuro(line.unitPrice)}
                          </td>
                          <td className="py-1.5 text-right font-medium text-gray-900 whitespace-nowrap">
                            {fmtEuro(line.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ================================================================== */
/*  EmptyState                                                         */
/* ================================================================== */

const RecapEmptyState: React.FC<{ mode: "simple" | "expert" }> = ({ mode }) => (
  <div style={{ textAlign: "center", padding: "48px 32px", background: "#fff", borderRadius: 14, border: "1px dashed #e2e8f0" }}>
    <div style={{ fontSize: 44, marginBottom: 14 }}>🏗️</div>
    <div style={{ fontSize: 15, fontWeight: 700, color: "#475569", marginBottom: 8 }}>Aucune simulation en cours</div>
    <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6, maxWidth: 300, margin: "0 auto" }}>
      {mode === "simple"
        ? "Renseignez une surface et configurez les options de travaux pour obtenir une estimation."
        : "Ajoutez des pièces via le panneau de gauche pour démarrer la simulation."}
    </div>
  </div>
);

/* ================================================================== */
/*  Main Page                                                          */
/* ================================================================== */

const PERSIST_DEBOUNCE_MS = 600;

const TravauxPage: React.FC = () => {
  const [mode,             setMode]             = useState<"simple" | "expert">("simple");
  const [range,            setRange]            = useState<TravauxRange>("standard");
  const [renovationLevel,  setRenovationLevel]  = useState<RenovationLevel>("standard");
  const [complexity,       setComplexity]       = useState<ChantierComplexity>(1);
  const [surface,          setSurface]          = useState(0);
  const [options,          setOptions]          = useState<TravauxOptionsSimple>(DEFAULT_OPTIONS);
  const [piecesUI,         setPiecesUI]         = useState<PieceUI[]>([]);
  const [disabledLots,     setDisabledLots]     = useState<Set<string>>(new Set());

  // Pré-remplit la surface depuis le projet réhab actif (reste éditable).
  useEffect(() => {
    const s = getActiveRehabSurface();
    if (s && s > 0) setSurface(s);
  }, []);

  const handleToggleLot = useCallback((code: string) => {
    if (code === "__reset__") { setDisabledLots(new Set()); return; }
    setDisabledLots((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setMode("simple"); setRange("standard"); setRenovationLevel("standard");
    setComplexity(1); setSurface(0); setOptions(DEFAULT_OPTIONS);
    setPiecesUI([]); setDisabledLots(new Set());
  }, []);

  const simulation = useMemo((): TravauxSimulationV1 => {
    const pieces       = piecesUI.map(pieceUIToTravaux);
    const surfaceTotal = mode === "expert"
      ? pieces.reduce((acc, p) => acc + p.surfaceM2, 0)
      : surface;
    return {
      version: 1, mode, range, renovationLevel,
      surfaceTotalM2: surfaceTotal, options, complexity,
      pieces, updatedAt: new Date().toISOString(),
    };
  }, [mode, range, renovationLevel, complexity, surface, options, piecesUI]);

  const result: ComputedTravaux = useMemo(() => computeTravauxSimulation(simulation), [simulation]);

  // Persist debounced (optionnel : brancher sur un store Réhabilitation si besoin)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      setRehabTravauxSnapshot(
        result.total > 0 && simulation.surfaceTotalM2 > 0
          ? {
              budgetHT:        result.total,
              bufferPct:       result.bufferPct,
              bufferAmount:    result.bufferAmount,
              totalWithBuffer: result.totalWithBuffer,
              costPerM2:       result.costPerM2,
              surfaceM2:       simulation.surfaceTotalM2,
              renovationLevel: simulation.renovationLevel,
              complexity:      simulation.complexity,
              range:           simulation.range,
              updatedAt:       simulation.updatedAt,
            }
          : null
      );
      persistTimerRef.current = null;
    }, PERSIST_DEBOUNCE_MS);
    return () => { if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current); };
  }, [simulation, result]);

  const setOpt = <K extends keyof TravauxOptionsSimple>(key: K, value: TravauxOptionsSimple[K]) =>
    setOptions((prev) => ({ ...prev, [key]: value }));

  const piecesTravaux = useMemo(() => piecesUI.map(pieceUIToTravaux), [piecesUI]);
  const isEmpty = mode === "simple" ? surface === 0 : piecesUI.length === 0;

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>

      {/* ── Bannière Réhabilitation ── */}
      <div style={{
        background: GRAD, borderRadius: 24, padding: "32px 36px",
        marginBottom: 24, display: "flex", alignItems: "center",
        justifyContent: "space-between", flexWrap: "wrap", gap: 20,
        boxShadow: "0 8px 32px rgba(234,88,12,0.22)",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>

            Réhabilitation · Simulation travaux
          </div>
          <div style={{ fontSize: 36, fontWeight: 600, color: "#fff", marginBottom: 10, lineHeight: 1.1, letterSpacing: "-0.025em" }}>

            Simulation travaux
          </div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", maxWidth: 460, lineHeight: 1.55 }}>
            Estimez le budget travaux de votre projet de réhabilitation
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{
            background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)",
            borderRadius: 10, padding: "8px 14px", fontSize: 12, color: "#fff", fontWeight: 600,
          }}>
            {range} · {renovationLevel}
          </div>
          <button
            type="button" onClick={handleReset}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "9px 18px", borderRadius: 10, border: "none",
              cursor: "pointer", background: "rgba(255,255,255,0.18)",
              color: "#fff", fontSize: 13, fontWeight: 600, flexShrink: 0, transition: "background .15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.30)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.18)")}
            title="Remettre à zéro"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
            </svg>
            Nouvelle simulation
          </button>
        </div>
      </div>

      {/* ── Corps : grille 300px + 1fr ── */}
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, alignItems: "start" }}>

        {/* ── Colonne gauche : contrôles ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Mode toggle */}
          <div style={{ background: "#fff", borderRadius: 12, padding: 6, display: "flex", gap: 4, border: "1px solid #e2e8f0" }}>
            {(["simple", "expert"] as const).map((m) => (
              <button
                key={m} type="button" onClick={() => setMode(m)}
                style={{
                  flex: 1, padding: "7px 4px", borderRadius: 8, border: "none",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                  background: mode === m ? ACCENT : "transparent",
                  color: mode === m ? "#fff" : "#64748b",
                  transition: "all .15s",
                }}
              >
                {m === "simple" ? "Simple" : "Pièce par pièce"}
              </button>
            ))}
          </div>

          {/* Gamme de finitions */}
          <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>
              Gamme de finitions
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r.value} type="button" onClick={() => setRange(r.value)}
                  style={{
                    flex: 1, padding: "8px 4px", borderRadius: 8,
                    border: `2px solid ${range === r.value ? ACCENT : "#e2e8f0"}`,
                    background: range === r.value ? ACCENT_LIGHT : "#fff",
                    color: range === r.value ? ACCENT_DARK : "#94a3b8",
                    fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "all .15s",
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Niveau de rénovation */}
          <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2 }}>
              Niveau de rénovation
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {LEVEL_OPTIONS.map((l) => (
                <button
                  key={l.value} type="button" onClick={() => setRenovationLevel(l.value)}
                  style={{
                    padding: "8px 10px", borderRadius: 8,
                    border: `2px solid ${renovationLevel === l.value ? ACCENT : "#e2e8f0"}`,
                    background: renovationLevel === l.value ? ACCENT_LIGHT : "#fff",
                    color: renovationLevel === l.value ? ACCENT_DARK : "#374151",
                    fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "all .15s",
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
            {/* Complexité */}
            <div style={{ paddingTop: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Complexité chantier</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT_DARK }}>{complexity}/4</span>
              </div>
              <input
                type="range" min={0} max={4} step={1} value={complexity}
                onChange={(e) => setComplexity(Number(e.target.value) as ChantierComplexity)}
                style={{ width: "100%", accentColor: ACCENT }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8" }}>
                <span>Facile</span><span>Complexe</span>
              </div>
            </div>
          </div>

          {/* Surface (mode simple) */}
          {mode === "simple" && (
            <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>
                Surface totale
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <input
                  type="number" min={0} max={500}
                  value={surface === 0 ? "" : surface}
                  placeholder="Ex : 55"
                  onChange={(e) => setSurface(Math.max(0, Number(e.target.value) || 0))}
                  style={{
                    width: 90, fontSize: 18, fontWeight: 700, textAlign: "right",
                    border: `2px solid ${ACCENT}`, borderRadius: 10, padding: "8px 12px",
                    outline: "none", color: "#1e293b",
                  }}
                />
                <span style={{ fontSize: 14, color: "#64748b", fontWeight: 600 }}>m²</span>
              </div>
            </div>
          )}

          {/* Options de travaux (mode simple) */}
          {mode === "simple" && (
            <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
                Options de travaux
              </div>
              <TriSelect label="Cuisine"             value={options.cuisineRefaire}     onChange={(v) => setOpt("cuisineRefaire", v)} />
              <TriSelect label="Salle de bain"       value={options.sdbRefaire}         onChange={(v) => setOpt("sdbRefaire", v)} />
              <TriSelect label="Électricité"         value={options.electricite}        onChange={(v) => setOpt("electricite", v)} />
              <TriSelect label="Plomberie"           value={options.plomberie}          onChange={(v) => setOpt("plomberie", v)} />
              <TriSelect label="Menuiseries"         value={options.menuiseries}        onChange={(v) => setOpt("menuiseries", v)} />
              <TriSelect label="Isolation thermique" value={options.isolationThermique} onChange={(v) => setOpt("isolationThermique", v)} />
              <TriSelect label="Isolation phonique"  value={options.isolationPhonique}  onChange={(v) => setOpt("isolationPhonique", v)} />
              <TriSelect label="Démolition"          value={options.demolition}         onChange={(v) => setOpt("demolition", v)} />
              <TriSelect label="Gravats"             value={options.gravats}            onChange={(v) => setOpt("gravats", v)} />
              <BinSelect label="Traitement humidité" value={options.humiditeTraitement} onChange={(v) => setOpt("humiditeTraitement", v)} />
              <BinSelect label="Maîtrise d'œuvre"   value={options.moe}               onChange={(v) => setOpt("moe", v)} />
            </div>
          )}

          {/* Pièces (mode expert) */}
          {mode === "expert" && (
            <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>
                Pièces
              </div>
              <PieceEditor pieces={piecesUI} onChange={setPiecesUI} range={range} />
            </div>
          )}

          {/* Options globales (mode expert) */}
          {mode === "expert" && (
            <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
                Options globales
              </div>
              <BinSelect label="Traitement humidité" value={options.humiditeTraitement} onChange={(v) => setOpt("humiditeTraitement", v)} />
              <BinSelect label="Maîtrise d'œuvre"   value={options.moe}               onChange={(v) => setOpt("moe", v)} />
            </div>
          )}
        </div>

        {/* ── Colonne droite : résultats ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", overflow: "hidden", minHeight: 400 }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#1e293b" }}>
                {mode === "expert" ? "Détail par pièce & récapitulatif" : "Récapitulatif par lots"}
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                {mode === "simple"
                  ? "Saisissez une surface pour voir l'estimation"
                  : "Ajoutez des pièces pour démarrer"}
              </div>
            </div>

            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
              {mode === "expert" && piecesTravaux.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>
                    Détail par pièce
                  </div>
                  <PieceResultList pieces={piecesTravaux} range={range} />
                </div>
              )}

              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>
                  Récapitulatif par lots
                </div>
                {isEmpty ? (
                  <RecapEmptyState mode={mode} />
                ) : (
                  <LotsBreakdown
                    lots={result.lots}
                    total={result.total}
                    bufferPct={result.bufferPct}
                    bufferAmount={result.bufferAmount}
                    totalWithBuffer={result.totalWithBuffer}
                    costPerM2={result.costPerM2}
                    complexityCoef={result.complexityCoef}
                    disabledLots={disabledLots}
                    onToggleLot={handleToggleLot}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default TravauxPage;