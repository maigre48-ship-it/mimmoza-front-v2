// src/spaces/investisseur/components/travaux/PieceEditor.tsx
import React, { useCallback } from "react";
import type {
  TravauxRange,
  PieceTravaux,
  PieceType,
  PricingItemCode,
  ExpertLineItem,
} from "../../shared/travauxSimulation.types";
import { TRAVAUX_PRICING_V1 } from "../../services/travauxPricing.config";

/* ================================================================== */
/*  Types & constants                                                  */
/* ================================================================== */

export interface PieceUI {
  id: string;
  kind: PieceType;
  name: string;
  surfaceM2: number;

  // Generic toggles
  peinture: boolean;
  sol: boolean;
  elec: boolean;
  plomb: boolean;
  isolTh: boolean;
  isolPh: boolean;

  // Cuisine-specific
  cuisinePack: boolean;
  cuisinePose: boolean;
  cuisineDepose: boolean;

  // SDB-specific
  sdbPack: boolean;
  sdbSpec: boolean;
  sdbDepose: boolean;

  // Overridable quantities
  qtyPeinture: number;
  qtySol: number;
  qtySpots: number;
  qtyRj45: number;
  qtyPlombPoints: number;
  qtyIsolTh: number;
  qtyIsolPh: number;
}

const PIECE_TYPE_OPTIONS: { value: PieceType; label: string; icon: string }[] =
  [
    { value: "sejour", label: "Séjour", icon: "🛋️" },
    { value: "chambre", label: "Chambre", icon: "🛏️" },
    { value: "cuisine", label: "Cuisine", icon: "🍳" },
    { value: "sdb", label: "Salle de bain", icon: "🚿" },
    { value: "wc", label: "WC", icon: "🚽" },
    { value: "entree", label: "Entrée", icon: "🚪" },
    { value: "couloir", label: "Couloir", icon: "🏠" },
    { value: "bureau", label: "Bureau", icon: "💻" },
    { value: "autre", label: "Autre", icon: "📐" },
  ];

/* ================================================================== */
/*  Default quantities from surface                                    */
/* ================================================================== */

function defaultQtys(
  kind: PieceType,
  surfaceM2: number
): Pick<
  PieceUI,
  | "qtyPeinture"
  | "qtySol"
  | "qtySpots"
  | "qtyRj45"
  | "qtyPlombPoints"
  | "qtyIsolTh"
  | "qtyIsolPh"
> {
  const s = Math.max(0, surfaceM2);
  return {
    qtyPeinture: Math.round(s * 2.6),
    qtySol: s,
    qtySpots: Math.max(1, Math.round(s / 6)),
    qtyRj45: kind === "sdb" || kind === "wc" ? 0 : Math.max(0, Math.round(s / 25)),
    qtyPlombPoints:
      kind === "cuisine" ? 2 : kind === "sdb" ? 2 : kind === "wc" ? 1 : 0,
    qtyIsolTh: s,
    qtyIsolPh: s,
  };
}

/* ================================================================== */
/*  Default toggles per piece kind                                     */
/* ================================================================== */

function defaultToggles(kind: PieceType): Pick<
  PieceUI,
  | "peinture"
  | "sol"
  | "elec"
  | "plomb"
  | "isolTh"
  | "isolPh"
  | "cuisinePack"
  | "cuisinePose"
  | "cuisineDepose"
  | "sdbPack"
  | "sdbSpec"
  | "sdbDepose"
> {
  return {
    peinture: true,
    sol: true,
    elec: true,
    plomb: kind === "cuisine" || kind === "sdb" || kind === "wc",
    isolTh: false,
    isolPh: false,
    cuisinePack: kind === "cuisine",
    cuisinePose: kind === "cuisine",
    cuisineDepose: false,
    sdbPack: kind === "sdb",
    sdbSpec: kind === "sdb",
    sdbDepose: false,
  };
}

/* ================================================================== */
/*  Create a new PieceUI                                               */
/* ================================================================== */

let _counter = 0;
export function createPieceUI(
  kind: PieceType = "sejour",
  surfaceM2 = 15
): PieceUI {
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

/* ================================================================== */
/*  Convert PieceUI → PieceTravaux (for calculator)                    */
/* ================================================================== */

export function pieceUIToTravaux(p: PieceUI): PieceTravaux {
  const items: ExpertLineItem[] = [];

  const push = (itemCode: PricingItemCode, qty: number) => {
    if (qty > 0) items.push({ itemCode, qty });
  };

  if (p.peinture) push("mur_peinture_simple", p.qtyPeinture);
  if (p.sol) push("sol_parquet", p.qtySol);

  if (p.elec) {
    push("elec_spots", p.qtySpots);
    push("elec_rj45", p.qtyRj45);
  }

  if (p.plomb && p.qtyPlombPoints > 0) {
    push("plomb_deplacement_points_eau", p.qtyPlombPoints);
  }

  if (p.isolTh) push("isol_th_murs", p.qtyIsolTh);
  if (p.isolPh) push("isol_ph_murs_mitoyens", p.qtyIsolPh);

  // Cuisine specifics
  if (p.kind === "cuisine") {
    if (p.cuisinePack) push("cuisine_pack", 1);
    if (p.cuisinePose) push("cuisine_pose", 1);
    if (p.cuisineDepose) push("demol_depose_cuisine", 1);
  }

  // SDB specifics
  if (p.kind === "sdb") {
    if (p.sdbPack) push("sdb_pack", 1);
    if (p.sdbSpec) push("sdb_spec_etancheite", 1);
    if (p.sdbDepose) push("demol_depose_faience_sanitaires", 1);
  }

  return {
    id: p.id,
    type: p.kind,
    name: p.name,
    surfaceM2: p.surfaceM2,
    items,
  };
}

/* ================================================================== */
/*  Price lookup helper                                                */
/* ================================================================== */

const PRICE_MAP: Map<
  PricingItemCode,
  { eco: number; standard: number; premium: number }
> = (() => {
  const m = new Map<
    PricingItemCode,
    { eco: number; standard: number; premium: number }
  >();
  for (const lot of TRAVAUX_PRICING_V1.lots) {
    for (const item of lot.items) {
      m.set(item.code, item.prices);
    }
  }
  return m;
})();

function unitPrice(code: PricingItemCode, range: TravauxRange): number {
  return PRICE_MAP.get(code)?.[range] ?? 0;
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

const Toggle: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}> = ({ label, checked, onChange, hint }) => (
  <label className="flex items-center gap-2 cursor-pointer select-none group">
    <div
      className={`w-9 h-5 rounded-full transition-colors relative ${
        checked ? "bg-violet-500" : "bg-gray-300"
      }`}
      onClick={() => onChange(!checked)}
    >
      <div
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </div>
    <span className="text-xs text-gray-700 group-hover:text-gray-900">
      {label}
    </span>
    {hint && <span className="text-[10px] text-gray-400">{hint}</span>}
  </label>
);

const NumberInput: React.FC<{
  label: string;
  value: number;
  unit: string;
  onChange: (v: number) => void;
  min?: number;
  disabled?: boolean;
}> = ({ label, value, unit, onChange, min = 0, disabled }) => (
  <div className="flex items-center gap-2">
    <span className="text-xs text-gray-500 w-20 truncate">{label}</span>
    <input
      type="number"
      min={min}
      step={1}
      value={value}
      onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
      disabled={disabled}
      className="w-16 text-xs text-right border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-40"
    />
    <span className="text-[10px] text-gray-400">{unit}</span>
  </div>
);

/* ================================================================== */
/*  Single Piece Card                                                  */
/* ================================================================== */

interface PieceCardProps {
  piece: PieceUI;
  range: TravauxRange;
  onChange: (updated: PieceUI) => void;
  onRemove: () => void;
}

const PieceCard: React.FC<PieceCardProps> = ({
  piece,
  range,
  onChange,
  onRemove,
}) => {
  const p = piece;

  const update = (partial: Partial<PieceUI>) => {
    const next = { ...p, ...partial };
    onChange(next);
  };

  const updateKind = (kind: PieceType) => {
    const newToggles = defaultToggles(kind);
    const newQtys = defaultQtys(kind, p.surfaceM2);
    const label =
      PIECE_TYPE_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
    update({ kind, ...newToggles, ...newQtys, name: label });
  };

  const updateSurface = (surfaceM2: number) => {
    const newQtys = defaultQtys(p.kind, surfaceM2);
    update({ surfaceM2, ...newQtys });
  };

  const isCuisine = p.kind === "cuisine";
  const isSDB = p.kind === "sdb";
  const icon =
    PIECE_TYPE_OPTIONS.find((o) => o.value === p.kind)?.icon ?? "📐";

  // Quick total preview
  const travaux = pieceUIToTravaux(p);
  const quickTotal = travaux.items.reduce(
    (sum, li) => sum + li.qty * unitPrice(li.itemCode, range),
    0
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-lg">{icon}</span>
          <select
            value={p.kind}
            onChange={(e) => updateKind(e.target.value as PieceType)}
            className="text-sm font-medium bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
          >
            {PIECE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.icon} {opt.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={p.name}
            onChange={(e) => update({ name: e.target.value })}
            className="text-sm bg-transparent border-b border-gray-200 focus:border-violet-400 outline-none px-1 py-0.5 min-w-0 flex-1"
            placeholder="Nom"
          />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-bold text-violet-700">
            {quickTotal.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €
          </span>
          <button
            type="button"
            onClick={onRemove}
            className="text-gray-400 hover:text-red-500 transition-colors p-1"
            title="Supprimer"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Surface */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-gray-500">Surface :</label>
        <input
          type="number"
          min={1}
          max={200}
          value={p.surfaceM2}
          onChange={(e) =>
            updateSurface(Math.max(1, Number(e.target.value) || 1))
          }
          className="w-16 text-sm text-right border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400"
        />
        <span className="text-xs text-gray-400">m²</span>
      </div>

      {/* Toggles — generic */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4">
        <Toggle
          label="Peinture"
          checked={p.peinture}
          onChange={(v) => update({ peinture: v })}
        />
        <Toggle
          label="Sol"
          checked={p.sol}
          onChange={(v) => update({ sol: v })}
        />
        <Toggle
          label="Électricité"
          checked={p.elec}
          onChange={(v) => update({ elec: v })}
        />
        <Toggle
          label="Plomberie"
          checked={p.plomb}
          onChange={(v) => update({ plomb: v })}
        />
        <Toggle
          label="Isol. thermique"
          checked={p.isolTh}
          onChange={(v) => update({ isolTh: v })}
        />
        <Toggle
          label="Isol. phonique"
          checked={p.isolPh}
          onChange={(v) => update({ isolPh: v })}
        />
      </div>

      {/* Cuisine-specific toggles */}
      {isCuisine && (
        <div className="border-t border-gray-100 pt-2 grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4">
          <Toggle
            label="Pack cuisine"
            checked={p.cuisinePack}
            onChange={(v) => update({ cuisinePack: v })}
          />
          <Toggle
            label="Pose cuisine"
            checked={p.cuisinePose}
            onChange={(v) => update({ cuisinePose: v })}
          />
          <Toggle
            label="Dépose cuisine"
            checked={p.cuisineDepose}
            onChange={(v) => update({ cuisineDepose: v })}
            hint="(forfait)"
          />
        </div>
      )}

      {/* SDB-specific toggles */}
      {isSDB && (
        <div className="border-t border-gray-100 pt-2 grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4">
          <Toggle
            label="Pack SDB"
            checked={p.sdbPack}
            onChange={(v) => update({ sdbPack: v })}
          />
          <Toggle
            label="Étanchéité SPEC"
            checked={p.sdbSpec}
            onChange={(v) => update({ sdbSpec: v })}
          />
          <Toggle
            label="Dépose faïence"
            checked={p.sdbDepose}
            onChange={(v) => update({ sdbDepose: v })}
            hint="(forfait)"
          />
        </div>
      )}

      {/* Editable quantities */}
      <div className="border-t border-gray-100 pt-2 grid grid-cols-2 sm:grid-cols-3 gap-y-1.5 gap-x-4">
        {p.peinture && (
          <NumberInput
            label="Peinture"
            value={p.qtyPeinture}
            unit="m²"
            onChange={(v) => update({ qtyPeinture: v })}
          />
        )}
        {p.sol && (
          <NumberInput
            label="Sol"
            value={p.qtySol}
            unit="m²"
            onChange={(v) => update({ qtySol: v })}
          />
        )}
        {p.elec && (
          <NumberInput
            label="Spots"
            value={p.qtySpots}
            unit="u"
            onChange={(v) => update({ qtySpots: v })}
          />
        )}
        {p.elec && (
          <NumberInput
            label="RJ45"
            value={p.qtyRj45}
            unit="u"
            onChange={(v) => update({ qtyRj45: v })}
          />
        )}
        {p.plomb && (
          <NumberInput
            label="Points d'eau"
            value={p.qtyPlombPoints}
            unit="u"
            onChange={(v) => update({ qtyPlombPoints: v })}
          />
        )}
        {p.isolTh && (
          <NumberInput
            label="Isol. th."
            value={p.qtyIsolTh}
            unit="m²"
            onChange={(v) => update({ qtyIsolTh: v })}
          />
        )}
        {p.isolPh && (
          <NumberInput
            label="Isol. ph."
            value={p.qtyIsolPh}
            unit="m²"
            onChange={(v) => update({ qtyIsolPh: v })}
          />
        )}
      </div>
    </div>
  );
};

/* ================================================================== */
/*  Main PieceEditor                                                   */
/* ================================================================== */

interface PieceEditorProps {
  pieces: PieceUI[];
  onChange: (pieces: PieceUI[]) => void;
  range: TravauxRange;
}

const PieceEditor: React.FC<PieceEditorProps> = ({
  pieces,
  onChange,
  range,
}) => {
  const handleUpdate = useCallback(
    (id: string, updated: PieceUI) => {
      onChange(pieces.map((p) => (p.id === id ? updated : p)));
    },
    [pieces, onChange]
  );

  const handleRemove = useCallback(
    (id: string) => {
      onChange(pieces.filter((p) => p.id !== id));
    },
    [pieces, onChange]
  );

  const handleAdd = useCallback(
    (kind: PieceType = "sejour") => {
      onChange([...pieces, createPieceUI(kind, 15)]);
    },
    [pieces, onChange]
  );

  return (
    <div className="space-y-3">
      {pieces.map((p) => (
        <PieceCard
          key={p.id}
          piece={p}
          range={range}
          onChange={(u) => handleUpdate(p.id, u)}
          onRemove={() => handleRemove(p.id)}
        />
      ))}

      {/* Add piece */}
      <div className="flex flex-wrap gap-2 pt-1">
        {PIECE_TYPE_OPTIONS.slice(0, 5).map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleAdd(opt.value)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-violet-50 hover:text-violet-700 border border-gray-200 hover:border-violet-300 rounded-lg transition-colors"
          >
            <span>{opt.icon}</span>
            <span>+ {opt.label}</span>
          </button>
        ))}
        <div className="relative group">
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-500 bg-gray-50 hover:bg-gray-100 border border-dashed border-gray-300 rounded-lg transition-colors"
          >
            + Autre…
          </button>
          <div className="hidden group-hover:flex absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 flex-col min-w-[140px]">
            {PIECE_TYPE_OPTIONS.slice(5).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleAdd(opt.value)}
                className="text-left px-3 py-2 text-xs text-gray-700 hover:bg-violet-50 hover:text-violet-700 transition-colors first:rounded-t-lg last:rounded-b-lg"
              >
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PieceEditor;