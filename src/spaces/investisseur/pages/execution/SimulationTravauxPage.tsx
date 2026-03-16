// src/spaces/investisseur/pages/execution/SimulationTravauxPage.tsx
// All-in-one: PieceEditor + PieceResultList + LotsBreakdown inlined.
// Only imports: types + pricing config + calculator service (already existing).
// v2: Persist travaux result into canonical Investisseur snapshot.
// v3: Also persist into Marchand snapshot via patchExecutionTravaux.
// v4: "Utiliser ce total dans mon analyse" → injecte totalWithBuffer dans la rentabilité.

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type {
  TravauxSimulationV1,
  TravauxRange,
  RenovationLevel,
  ChantierComplexity,
  TravauxOptionsSimple,
  TriChoice,
  BinaryChoice,
  ComputedTravaux,
  ComputedLot,
  PricingItemCode,
  ExpertLineItem,
  PieceTravaux,
  PieceType,
} from "../../shared/travauxSimulation.types";
import { computeTravauxSimulation } from "../../services/travauxCalculator.service";
import { TRAVAUX_PRICING_V1 } from "../../services/travauxPricing.config";
import {
  getInvestisseurSnapshot,
  upsertInvestisseurProject,
  addInvestisseurEvent,
} from "../../shared/investisseurSnapshot.store";
import {
  patchExecutionTravaux,
  readMarchandSnapshot,
  patchRentabiliteForDeal,
} from "../../../marchand/shared/marchandSnapshot.store";

/* ================================================================== */
/*  Design tokens — Investisseur                                       */
/* ================================================================== */

const GRAD_INV = "linear-gradient(90deg, #2196f3 0%, #21cbf3 100%)";
const ACCENT_INV = "#1a72c4";

/* ================================================================== */
/*  Pricing index (built once)                                         */
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
  return PRICING_MAP.get(code)?.[range] ?? 0;
}

/* ================================================================== */
/*  Formatting helpers                                                 */
/* ================================================================== */

const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const fmtEuro = (n: number) => `${fmt(n)} €`;

/* ================================================================== */
/*  Persist travaux into Investisseur snapshot                         */
/* ================================================================== */

/**
 * Persiste les résultats travaux dans le snapshot canonique Investisseur.
 * Merge propre : seul execution.travaux est écrit, les autres blocs
 * (rentabilite, marche, kpis, etc.) restent intacts.
 *
 * No-op si aucun projet actif dans le snapshot.
 */
function persistTravauxResult(
  input: TravauxSimulationV1,
  computed: ComputedTravaux
): void {
  const snap = getInvestisseurSnapshot();
  const projectId = snap.activeProjectId;
  if (!projectId) return;

  upsertInvestisseurProject(projectId, {
    execution: {
      travaux: {
        input,
        computed,
        updatedAt: new Date().toISOString(),
      },
    },
  });

  addInvestisseurEvent({
    type: "travaux_simulation_updated",
    projectId,
    message: `Travaux total=${computed.total}, totalWithBuffer=${computed.totalWithBuffer}`,
  });
}

/* ================================================================== */
/*  Persist travaux into Marchand snapshot                             */
/* ================================================================== */

/**
 * Persiste les résultats travaux dans le snapshot Marchand
 * via patchExecutionTravaux (non destructif sur le reste de execution).
 */
function persistTravauxToMarchand(
  input: TravauxSimulationV1,
  computed: ComputedTravaux
): void {
  patchExecutionTravaux({
    input,
    computed,
    updatedAt: new Date().toISOString(),
  });
}

/* ================================================================== */
/*  Apply travaux total to Rentabilité analysis                        */
/* ================================================================== */

/**
 * Injecte le total travaux (avec buffer) dans la rentabilité du deal actif.
 * Merge non destructif : seul `travauxEstimes` et `travauxSource` sont écrits
 * dans inputs, les autres champs existants restent intacts.
 *
 * Persiste aussi dans execution.travaux si patchExecutionTravaux est dispo.
 *
 * @returns true si la mise à jour a réussi, false sinon
 */
function applyTravauxToAnalyse(
  total: number,
  sourceMode: "simple" | "expert",
  simulation: TravauxSimulationV1,
  computed: ComputedTravaux
): boolean {
  const snap = readMarchandSnapshot();
  const dealId = snap?.activeDealId ?? snap?.deal?.id;

  if (!dealId) {
    console.warn(
      "[SimulationTravaux] Aucun deal actif trouvé – impossible d'injecter les travaux dans la rentabilité."
    );
    return false;
  }

  // ── Lecture des inputs existants pour merge non destructif ──────────
  const existingRenta = snap?.deals?.[dealId]?.rentabilite ?? snap?.rentabilite;
  const existingInputs =
    (existingRenta as Record<string, unknown> | undefined)?.inputs ?? {};

  patchRentabiliteForDeal(dealId, {
    inputs: {
      ...(existingInputs as Record<string, unknown>),
      travauxEstimes: total,
      travauxSource: "simulation" as const,
    },
  });

  // ── Persist execution.travaux avec sourceMode ──────────────────────
  patchExecutionTravaux({
    input: simulation,
    computed,
    updatedAt: new Date().toISOString(),
    sourceMode,
  });

  return true;
}

/* ================================================================== */
/*  PieceUI model                                                      */
/* ================================================================== */

interface PieceUI {
  id: string;
  kind: PieceType;
  name: string;
  surfaceM2: number;
  peinture: boolean;
  sol: boolean;
  elec: boolean;
  plomb: boolean;
  isolTh: boolean;
  isolPh: boolean;
  cuisinePack: boolean;
  cuisinePose: boolean;
  cuisineDepose: boolean;
  sdbPack: boolean;
  sdbSpec: boolean;
  sdbDepose: boolean;
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

const PIECE_ICONS: Record<string, string> = Object.fromEntries(
  PIECE_TYPE_OPTIONS.map((o) => [o.value, o.icon])
);

function defaultQtys(kind: PieceType, surfaceM2: number) {
  const s = Math.max(0, surfaceM2);
  return {
    qtyPeinture: Math.round(s * 2.6),
    qtySol: s,
    qtySpots: Math.max(1, Math.round(s / 6)),
    qtyRj45:
      kind === "sdb" || kind === "wc"
        ? 0
        : Math.max(0, Math.round(s / 25)),
    qtyPlombPoints:
      kind === "cuisine" ? 2 : kind === "sdb" ? 2 : kind === "wc" ? 1 : 0,
    qtyIsolTh: s,
    qtyIsolPh: s,
  };
}

function defaultToggles(kind: PieceType) {
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

let _counter = 0;
function createPieceUI(kind: PieceType = "sejour", surfaceM2 = 15): PieceUI {
  _counter++;
  const label =
    PIECE_TYPE_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
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
  if (p.sol) push("sol_parquet", p.qtySol);
  if (p.elec) {
    push("elec_spots", p.qtySpots);
    push("elec_rj45", p.qtyRj45);
  }
  if (p.plomb && p.qtyPlombPoints > 0)
    push("plomb_deplacement_points_eau", p.qtyPlombPoints);
  if (p.isolTh) push("isol_th_murs", p.qtyIsolTh);
  if (p.isolPh) push("isol_ph_murs_mitoyens", p.qtyIsolPh);
  if (p.kind === "cuisine") {
    if (p.cuisinePack) push("cuisine_pack", 1);
    if (p.cuisinePose) push("cuisine_pose", 1);
    if (p.cuisineDepose) push("demol_depose_cuisine", 1);
  }
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
/*  Defaults & config                                                  */
/* ================================================================== */

const DEFAULT_OPTIONS: TravauxOptionsSimple = {
  cuisineRefaire: "none",
  sdbRefaire: "none",
  electricite: "none",
  plomberie: "none",
  menuiseries: "none",
  isolationThermique: "none",
  isolationPhonique: "none",
  demolition: "none",
  gravats: "none",
  humiditeTraitement: "none",
  moe: "none",
};

const RANGE_OPTIONS: { value: TravauxRange; label: string; color: string }[] = [
  { value: "eco", label: "Éco", color: "bg-emerald-100 text-emerald-700 border-emerald-300" },
  { value: "standard", label: "Standard", color: "bg-violet-100 text-violet-700 border-violet-300" },
  { value: "premium", label: "Premium", color: "bg-amber-100 text-amber-700 border-amber-300" },
];

const LEVEL_OPTIONS: { value: RenovationLevel; label: string }[] = [
  { value: "refresh", label: "Rafraîchissement" },
  { value: "standard", label: "Standard" },
  { value: "heavy", label: "Lourde" },
  { value: "full", label: "Complète" },
];

const TRI_LABELS: Record<TriChoice, string> = {
  none: "Non",
  partial: "Partiel",
  full: "Complet",
};

/* ================================================================== */
/*  Shared UI atoms                                                    */
/* ================================================================== */

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
    {children}
  </h3>
);

const TriSelect: React.FC<{
  label: string;
  value: TriChoice;
  onChange: (v: TriChoice) => void;
}> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between gap-2 py-1.5">
    <span className="text-sm text-gray-700">{label}</span>
    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
      {(["none", "partial", "full"] as TriChoice[]).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`px-3 py-1 text-xs font-medium transition-colors ${
            value === opt
              ? "bg-violet-600 text-white"
              : "bg-white text-gray-500 hover:bg-gray-50"
          }`}
        >
          {TRI_LABELS[opt]}
        </button>
      ))}
    </div>
  </div>
);

const BinSelect: React.FC<{
  label: string;
  value: BinaryChoice;
  onChange: (v: BinaryChoice) => void;
}> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between gap-2 py-1.5">
    <span className="text-sm text-gray-700">{label}</span>
    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
      {(["none", "yes"] as BinaryChoice[]).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`px-3 py-1 text-xs font-medium transition-colors ${
            value === opt
              ? "bg-violet-600 text-white"
              : "bg-white text-gray-500 hover:bg-gray-50"
          }`}
        >
          {opt === "none" ? "Non" : "Oui"}
        </button>
      ))}
    </div>
  </div>
);

const ToggleRow: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  children?: React.ReactNode;
}> = ({ label, checked, onChange, hint, children }) => (
  <div className="flex items-center gap-3 py-1">
    <div
      className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer flex-shrink-0 ${
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
    <span className="text-xs text-gray-700 w-[5.5rem] flex-shrink-0 select-none">
      {label}
      {hint && <span className="text-[10px] text-gray-400 ml-1">({hint})</span>}
    </span>
    {children && <div className="flex-1 flex justify-end">{children}</div>}
  </div>
);

const InlineQty: React.FC<{
  value: number;
  unit: string;
  onChange: (v: number) => void;
}> = ({ value, unit, onChange }) => (
  <div className="flex items-center gap-1">
    <input
      type="number"
      min={0}
      step={1}
      value={value}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      className="w-14 text-xs text-right border border-gray-200 rounded-md px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400"
    />
    <span className="text-[10px] text-gray-400 whitespace-nowrap">{unit}</span>
  </div>
);

/* ================================================================== */
/*  ApplyToAnalyseButton                                               */
/* ================================================================== */

type ApplyStatus = "idle" | "success" | "error";

const ApplyToAnalyseButton: React.FC<{
  totalWithBuffer: number;
  sourceMode: "simple" | "expert";
  simulation: TravauxSimulationV1;
  computed: ComputedTravaux;
}> = ({ totalWithBuffer, sourceMode, simulation, computed }) => {
  const [status, setStatus] = useState<ApplyStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = useCallback(() => {
    const ok = applyTravauxToAnalyse(totalWithBuffer, sourceMode, simulation, computed);
    setStatus(ok ? "success" : "error");
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setStatus("idle");
      timerRef.current = null;
    }, 2000);
  }, [totalWithBuffer, sourceMode, simulation, computed]);

  if (status === "success") {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium transition-all">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Ajouté à l'analyse
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm font-medium transition-all">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />
        </svg>
        Aucun deal actif
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white text-sm font-medium shadow-sm transition-colors"
    >
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      Utiliser ce total dans mon analyse
    </button>
  );
};

/* ================================================================== */
/*  PieceCard                                                          */
/* ================================================================== */

const PieceCard: React.FC<{
  piece: PieceUI;
  range: TravauxRange;
  onChange: (updated: PieceUI) => void;
  onRemove: () => void;
}> = ({ piece, range, onChange, onRemove }) => {
  const p = piece;
  const update = (partial: Partial<PieceUI>) => onChange({ ...p, ...partial });

  const updateKind = (kind: PieceType) => {
    const label = PIECE_TYPE_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
    update({ kind, ...defaultToggles(kind), ...defaultQtys(kind, p.surfaceM2), name: label });
  };

  const updateSurface = (surfaceM2: number) => {
    update({ surfaceM2, ...defaultQtys(p.kind, surfaceM2) });
  };

  const isCuisine = p.kind === "cuisine";
  const isSDB = p.kind === "sdb";
  const icon = PIECE_TYPE_OPTIONS.find((o) => o.value === p.kind)?.icon ?? "📐";

  const travaux = pieceUIToTravaux(p);
  const quickTotal = travaux.items.reduce(
    (sum, li) => sum + li.qty * getUnitPrice(li.itemCode, range),
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
          <span className="text-sm font-bold text-violet-700">{fmtEuro(quickTotal)}</span>
          <button
            type="button"
            onClick={onRemove}
            className="text-gray-400 hover:text-red-500 transition-colors p-1"
            title="Supprimer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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
          onChange={(e) => updateSurface(Math.max(1, Number(e.target.value) || 1))}
          className="w-16 text-sm text-right border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400"
        />
        <span className="text-xs text-gray-400">m²</span>
      </div>

      {/* Postes — toggle + quantité inline */}
      <div className="space-y-1.5">
        <ToggleRow label="Peinture" checked={p.peinture} onChange={(v) => update({ peinture: v })}>
          {p.peinture && <InlineQty value={p.qtyPeinture} unit="m²" onChange={(v) => update({ qtyPeinture: v })} />}
        </ToggleRow>
        <ToggleRow label="Sol" checked={p.sol} onChange={(v) => update({ sol: v })}>
          {p.sol && <InlineQty value={p.qtySol} unit="m²" onChange={(v) => update({ qtySol: v })} />}
        </ToggleRow>
        <ToggleRow label="Électricité" checked={p.elec} onChange={(v) => update({ elec: v })}>
          {p.elec && <InlineQty value={p.qtySpots} unit="spots" onChange={(v) => update({ qtySpots: v })} />}
        </ToggleRow>
        {p.elec && (
          <div className="flex items-center gap-3 py-1 pl-12">
            <span className="text-xs text-gray-400 w-[5.5rem] flex-shrink-0">↳ Prises RJ45</span>
            <div className="flex-1 flex justify-end">
              <InlineQty value={p.qtyRj45} unit="prises" onChange={(v) => update({ qtyRj45: v })} />
            </div>
          </div>
        )}
        <ToggleRow label="Plomberie" checked={p.plomb} onChange={(v) => update({ plomb: v })}>
          {p.plomb && <InlineQty value={p.qtyPlombPoints} unit="pts d'eau" onChange={(v) => update({ qtyPlombPoints: v })} />}
        </ToggleRow>
        <ToggleRow label="Isol. thermique" checked={p.isolTh} onChange={(v) => update({ isolTh: v })}>
          {p.isolTh && <InlineQty value={p.qtyIsolTh} unit="m²" onChange={(v) => update({ qtyIsolTh: v })} />}
        </ToggleRow>
        <ToggleRow label="Isol. phonique" checked={p.isolPh} onChange={(v) => update({ isolPh: v })}>
          {p.isolPh && <InlineQty value={p.qtyIsolPh} unit="m²" onChange={(v) => update({ qtyIsolPh: v })} />}
        </ToggleRow>
      </div>

      {/* Cuisine specifics */}
      {isCuisine && (
        <div className="border-t border-gray-100 pt-2 space-y-1.5">
          <ToggleRow label="Pack cuisine" checked={p.cuisinePack} onChange={(v) => update({ cuisinePack: v })} />
          <ToggleRow label="Pose cuisine" checked={p.cuisinePose} onChange={(v) => update({ cuisinePose: v })} />
          <ToggleRow label="Dépose cuisine" checked={p.cuisineDepose} onChange={(v) => update({ cuisineDepose: v })} hint="forfait" />
        </div>
      )}

      {/* SDB specifics */}
      {isSDB && (
        <div className="border-t border-gray-100 pt-2 space-y-1.5">
          <ToggleRow label="Pack SDB" checked={p.sdbPack} onChange={(v) => update({ sdbPack: v })} />
          <ToggleRow label="Étanchéité SPEC" checked={p.sdbSpec} onChange={(v) => update({ sdbSpec: v })} />
          <ToggleRow label="Dépose faïence" checked={p.sdbDepose} onChange={(v) => update({ sdbDepose: v })} hint="forfait" />
        </div>
      )}
    </div>
  );
};

/* ================================================================== */
/*  PieceEditor                                                        */
/* ================================================================== */

const PieceEditor: React.FC<{
  pieces: PieceUI[];
  onChange: (pieces: PieceUI[]) => void;
  range: TravauxRange;
}> = ({ pieces, onChange, range }) => {
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

/* ================================================================== */
/*  PieceResultList                                                    */
/* ================================================================== */

interface LineResult {
  code: PricingItemCode;
  label: string;
  unit: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

interface LotGroup {
  lotLabel: string;
  amount: number;
  lines: LineResult[];
}

function computePieceBreakdown(
  items: ExpertLineItem[],
  range: TravauxRange
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
    const existing = groupMap.get(meta.lotLabel) ?? {
      lotLabel: meta.lotLabel,
      amount: 0,
      lines: [],
    };
    existing.amount += amount;
    existing.lines.push({
      code: li.itemCode,
      label: meta.label,
      unit: meta.unit,
      qty: li.qty,
      unitPrice: up,
      amount,
    });
    groupMap.set(meta.lotLabel, existing);
  }
  return {
    groups: Array.from(groupMap.values()).sort((a, b) => b.amount - a.amount),
    total,
  };
}

const PieceResultList: React.FC<{
  pieces: PieceTravaux[];
  range: TravauxRange;
}> = ({ pieces, range }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (pieces.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic py-4 text-center">
        Ajoutez des pièces pour voir le détail.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {pieces.map((piece) => {
        const { groups, total } = computePieceBreakdown(piece.items, range);
        const isOpen = expandedId === piece.id;
        const icon = PIECE_ICONS[piece.type] ?? "📐";

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
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {isOpen && groups.length > 0 && (
              <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/50 space-y-3">
                {groups.map((g) => (
                  <div key={g.lotLabel}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-violet-700 uppercase tracking-wide">{g.lotLabel}</span>
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
  lots: ComputedLot[];
  total: number;
  bufferPct: number;
  bufferAmount: number;
  totalWithBuffer: number;
  costPerM2: number | null;
  complexityCoef: number;
  simulation: TravauxSimulationV1;
  computed: ComputedTravaux;
  sourceMode: "simple" | "expert";
}> = ({ lots, total, bufferPct, bufferAmount, totalWithBuffer, costPerM2, complexityCoef, simulation, computed, sourceMode }) => {
  const [expandedLot, setExpandedLot] = useState<string | null>(null);
  const nonEmptyLots = lots.filter((l) => l.amount > 0);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total HT</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmtEuro(total)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Buffer ({(bufferPct * 100).toFixed(0)}%)</p>
          <p className="text-xl font-bold text-amber-600 mt-1">{fmtEuro(bufferAmount)}</p>
        </div>
        <div className="bg-gradient-to-br from-violet-600 to-indigo-700 rounded-xl p-4 text-center text-white">
          <p className="text-xs uppercase tracking-wide opacity-80">Total + Buffer</p>
          <p className="text-xl font-bold mt-1">{fmtEuro(totalWithBuffer)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">€/m²</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{costPerM2 !== null ? fmtEuro(costPerM2) : "—"}</p>
        </div>
      </div>

      {/* Apply to analyse button */}
      <div className="flex justify-end">
        <ApplyToAnalyseButton
          totalWithBuffer={totalWithBuffer}
          sourceMode={sourceMode}
          simulation={simulation}
          computed={computed}
        />
      </div>

      {complexityCoef > 1 && (
        <p className="text-xs text-gray-500 text-right">
          Coef. complexité appliqué : ×{complexityCoef.toFixed(2)}
        </p>
      )}

      {/* Lots detail */}
      <div className="space-y-2">
        {nonEmptyLots.map((lot) => {
          const pct = total > 0 ? (lot.amount / total) * 100 : 0;
          const isOpen = expandedLot === lot.code;

          return (
            <div key={lot.code} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedLot((prev) => (prev === lot.code ? null : lot.code))}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-2 rounded-full bg-violet-500 flex-shrink-0" style={{ width: `${Math.max(4, pct * 0.8)}px` }} />
                  <span className="text-sm font-medium text-gray-800 truncate">{lot.label}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs text-gray-400">{pct.toFixed(1)}%</span>
                  <span className="text-sm font-semibold text-gray-900">{fmtEuro(lot.amount)}</span>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

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
/*  Main Page                                                          */
/* ================================================================== */

/** Debounce delay (ms) for persisting travaux into snapshot */
const PERSIST_DEBOUNCE_MS = 600;

const SimulationTravauxPage: React.FC = () => {
  const [mode, setMode] = useState<"simple" | "expert">("simple");
  const [range, setRange] = useState<TravauxRange>("standard");
  const [renovationLevel, setRenovationLevel] = useState<RenovationLevel>("standard");
  const [complexity, setComplexity] = useState<ChantierComplexity>(1);
  const [surface, setSurface] = useState(55);
  const [options, setOptions] = useState<TravauxOptionsSimple>(DEFAULT_OPTIONS);
  const [piecesUI, setPiecesUI] = useState<PieceUI[]>([]);

  const simulation = useMemo((): TravauxSimulationV1 => {
    const pieces = piecesUI.map(pieceUIToTravaux);
    const surfaceTotal = mode === "expert"
      ? pieces.reduce((acc, p) => acc + p.surfaceM2, 0)
      : surface;
    return {
      version: 1,
      mode,
      range,
      renovationLevel,
      surfaceTotalM2: surfaceTotal,
      options,
      complexity,
      pieces,
      updatedAt: new Date().toISOString(),
    };
  }, [mode, range, renovationLevel, complexity, surface, options, piecesUI]);

  const result: ComputedTravaux = useMemo(
    () => computeTravauxSimulation(simulation),
    [simulation]
  );

  // ── Persist into Investisseur + Marchand snapshots (debounced) ─────
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      persistTravauxResult(simulation, result);
      persistTravauxToMarchand(simulation, result);
      persistTimerRef.current = null;
    }, PERSIST_DEBOUNCE_MS);

    return () => {
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current);
      }
    };
  }, [simulation, result]);

  const setOpt = <K extends keyof TravauxOptionsSimple>(
    key: K,
    value: TravauxOptionsSimple[K]
  ) => setOptions((prev) => ({ ...prev, [key]: value }));

  const piecesTravaux = useMemo(() => piecesUI.map(pieceUIToTravaux), [piecesUI]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Bannière Investisseur › Exécution ── */}
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 24px 0" }}>
        <div style={{
          background: GRAD_INV,
          borderRadius: 14,
          padding: "20px 24px",
          marginBottom: 20,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>
              Investisseur › Exécution
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4 }}>
              Simulation Travaux
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
              Estimez le budget travaux de votre opération
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 space-y-6">
        {/* Mode toggle */}
        <div className="flex items-center gap-1 bg-white rounded-xl border border-gray-200 p-1 w-fit">
          {(["simple", "expert"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
                mode === m ? "bg-violet-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {m === "simple" ? "Simple" : "Expert (pièce par pièce)"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left: Parameters */}
          <div className="lg:col-span-2 space-y-4">
            {/* Gamme */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <SectionTitle>Gamme de finitions</SectionTitle>
              <div className="flex gap-2">
                {RANGE_OPTIONS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRange(r.value)}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                      range === r.value ? r.color : "bg-white text-gray-400 border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Niveau réno + complexité */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <SectionTitle>Niveau de rénovation</SectionTitle>
              <div className="grid grid-cols-2 gap-2">
                {LEVEL_OPTIONS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => setRenovationLevel(l.value)}
                    className={`py-2 text-xs font-medium rounded-lg border transition-colors ${
                      renovationLevel === l.value
                        ? "bg-violet-100 text-violet-700 border-violet-300"
                        : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <div className="pt-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">Complexité chantier</span>
                  <span className="text-xs font-medium text-gray-700">{complexity}/4</span>
                </div>
                <input
                  type="range" min={0} max={4} step={1} value={complexity}
                  onChange={(e) => setComplexity(Number(e.target.value) as ChantierComplexity)}
                  className="w-full accent-violet-600"
                />
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>Facile</span>
                  <span>Complexe</span>
                </div>
              </div>
            </div>

            {/* Surface — simple only */}
            {mode === "simple" && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <SectionTitle>Surface totale</SectionTitle>
                <div className="flex items-center gap-3">
                  <input
                    type="number" min={5} max={500} value={surface}
                    onChange={(e) => setSurface(Math.max(5, Number(e.target.value) || 5))}
                    className="w-24 text-lg text-right font-semibold border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />
                  <span className="text-gray-500">m²</span>
                </div>
              </div>
            )}

            {/* Options — simple */}
            {mode === "simple" && (
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-1">
                <SectionTitle>Options de travaux</SectionTitle>
                <TriSelect label="Cuisine" value={options.cuisineRefaire} onChange={(v) => setOpt("cuisineRefaire", v)} />
                <TriSelect label="Salle de bain" value={options.sdbRefaire} onChange={(v) => setOpt("sdbRefaire", v)} />
                <TriSelect label="Électricité" value={options.electricite} onChange={(v) => setOpt("electricite", v)} />
                <TriSelect label="Plomberie" value={options.plomberie} onChange={(v) => setOpt("plomberie", v)} />
                <TriSelect label="Menuiseries" value={options.menuiseries} onChange={(v) => setOpt("menuiseries", v)} />
                <TriSelect label="Isolation thermique" value={options.isolationThermique} onChange={(v) => setOpt("isolationThermique", v)} />
                <TriSelect label="Isolation phonique" value={options.isolationPhonique} onChange={(v) => setOpt("isolationPhonique", v)} />
                <TriSelect label="Démolition" value={options.demolition} onChange={(v) => setOpt("demolition", v)} />
                <TriSelect label="Gravats" value={options.gravats} onChange={(v) => setOpt("gravats", v)} />
                <BinSelect label="Traitement humidité" value={options.humiditeTraitement} onChange={(v) => setOpt("humiditeTraitement", v)} />
                <BinSelect label="Maîtrise d'œuvre (MOE)" value={options.moe} onChange={(v) => setOpt("moe", v)} />
              </div>
            )}

            {/* Piece editor — expert */}
            {mode === "expert" && (
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <SectionTitle>Pièces</SectionTitle>
                <PieceEditor pieces={piecesUI} onChange={setPiecesUI} range={range} />
              </div>
            )}

            {/* Expert: global options */}
            {mode === "expert" && (
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-1">
                <SectionTitle>Options globales</SectionTitle>
                <BinSelect label="Traitement humidité" value={options.humiditeTraitement} onChange={(v) => setOpt("humiditeTraitement", v)} />
                <BinSelect label="Maîtrise d'œuvre (MOE)" value={options.moe} onChange={(v) => setOpt("moe", v)} />
              </div>
            )}
          </div>

          {/* Right: Results */}
          <div className="lg:col-span-3 space-y-4">
            {mode === "expert" && (
              <div>
                <SectionTitle>Détail par pièce</SectionTitle>
                <PieceResultList pieces={piecesTravaux} range={range} />
              </div>
            )}
            <div>
              <SectionTitle>Récapitulatif par lots</SectionTitle>
              <LotsBreakdown
                lots={result.lots}
                total={result.total}
                bufferPct={result.bufferPct}
                bufferAmount={result.bufferAmount}
                totalWithBuffer={result.totalWithBuffer}
                costPerM2={result.costPerM2}
                complexityCoef={result.complexityCoef}
                simulation={simulation}
                computed={result}
                sourceMode={mode}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SimulationTravauxPage;