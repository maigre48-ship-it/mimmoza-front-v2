// src/spaces/promoteur/pages/PromoteurSimulationTravauxPage.tsx
// v4 — Bridge bilan enrichi : surface totale transmise avec le total travaux
// v4.1 — Hero v2 : PromoteurPageHero (design unifié Promoteur)

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeTravauxSimulation } from "../../investisseur/services/travauxCalculator.service";
import { TRAVAUX_PRICING_V1 } from "../../investisseur/services/travauxPricing.config";
import {
  addInvestisseurEvent,
  getInvestisseurSnapshot,
  upsertInvestisseurProject,
} from "../../investisseur/shared/investisseurSnapshot.store";
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
import { patchExecutionTravaux } from "../../marchand/shared/marchandSnapshot.store";
import {
  HeroGhostButton,
  PromoteurPageHero,
} from "../shared/components/PromoteurPageHero";
import { ACCENT_PRO, GRAD_PRO } from "../shared/promoteurDesign.tokens";

/* ================================================================== */
/*  Bridge bilan promoteur                                             */
/* ================================================================== */

export const BILAN_TRAVAUX_KEY   = "mimmoza.promoteur.bilan.travaux.v1";
export const BILAN_TRAVAUX_EVENT = "mimmoza:promoteur-bilan-travaux-updated";

export interface BilanTravauxBridgePayload {
  totalWithBuffer: number;
  totalHT: number;
  bufferPct: number;
  mode: "simple" | "expert";
  surfaceTotaleM2: number;
  updatedAt: string;
}

function applyTravauxToBilanPromo(
  totalWithBuffer: number,
  totalHT: number,
  bufferPct: number,
  mode: "simple" | "expert",
  surfaceTotaleM2: number,
): boolean {
  try {
    const payload: BilanTravauxBridgePayload = {
      totalWithBuffer, totalHT, bufferPct, mode, surfaceTotaleM2,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(BILAN_TRAVAUX_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent<BilanTravauxBridgePayload>(BILAN_TRAVAUX_EVENT, { detail: payload }));
    return true;
  } catch { return false; }
}

/* ================================================================== */
/*  Thème violet                                                       */
/* ================================================================== */

const GRAD         = GRAD_PRO;
const ACCENT       = ACCENT_PRO;
const ACCENT_LIGHT = "#ede9fe";
const ACCENT_DARK  = "#4338ca";

/* ================================================================== */
/*  Pricing index                                                      */
/* ================================================================== */

interface PricingMeta { lotLabel: string; label: string; unit: string; prices: { eco: number; standard: number; premium: number }; }

const PRICING_MAP: Map<PricingItemCode, PricingMeta> = (() => {
  const m = new Map<PricingItemCode, PricingMeta>();
  for (const lot of TRAVAUX_PRICING_V1.lots)
    for (const item of lot.items)
      m.set(item.code, { lotLabel: lot.label, label: item.label, unit: item.unit, prices: item.prices });
  return m;
})();

function getUnitPrice(code: PricingItemCode, range: TravauxRange): number { return PRICING_MAP.get(code)?.[range] ?? 0; }

const fmt     = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const fmtEuro = (n: number) => `${fmt(n)} €`;

/* ================================================================== */
/*  Persist helpers                                                    */
/* ================================================================== */

function persistTravauxResult(input: TravauxSimulationV1, computed: ComputedTravaux): void {
  const snap = getInvestisseurSnapshot();
  const projectId = snap.activeProjectId;
  if (!projectId) return;
  upsertInvestisseurProject(projectId, { execution: { travaux: { input, computed, updatedAt: new Date().toISOString() } } });
  addInvestisseurEvent({ type: "travaux_simulation_updated", projectId, message: `total=${computed.total}, withBuffer=${computed.totalWithBuffer}` });
}
function persistTravauxToMarchand(input: TravauxSimulationV1, computed: ComputedTravaux): void {
  patchExecutionTravaux({ input, computed, updatedAt: new Date().toISOString() });
}

/* ================================================================== */
/*  Zones Promoteur                                                    */
/* ================================================================== */

const PROMOTEUR_ZONE_OPTIONS: { value: PieceType; label: string; icon: string }[] = [
  { value: "sejour",  label: "Logements",                  icon: "🏠" },
  { value: "chambre", label: "Parties communes",           icon: "🏢" },
  { value: "entree",  label: "Hall / Entrée immeuble",     icon: "🚪" },
  { value: "couloir", label: "Circulations",               icon: "🔄" },
  { value: "cuisine", label: "Réseaux techniques",         icon: "⚡" },
  { value: "sdb",     label: "Sous-sol / Parking",         icon: "🅿️" },
  { value: "bureau",  label: "Local commercial / RDC",     icon: "🏪" },
  { value: "wc",      label: "Extérieurs",                 icon: "🌿" },
  { value: "autre",   label: "Structure / Façades / Toit", icon: "🔧" },
];
const ZONE_ICONS: Record<string, string> = Object.fromEntries(PROMOTEUR_ZONE_OPTIONS.map((o) => [o.value, o.icon]));

/* ================================================================== */
/*  Postes lourds visuels                                              */
/* ================================================================== */

interface PostePromo { id: string; label: string; checked: boolean; }
const POSTES_INIT: PostePromo[] = [
  { id: "curage",          label: "Curage / démolition lourde",           checked: false },
  { id: "desamiantage",    label: "Désamiantage / déplombage",            checked: false },
  { id: "structure",       label: "Reprise structurelle",                 checked: false },
  { id: "toiture",         label: "Réfection toiture",                    checked: false },
  { id: "ravalement",      label: "Ravalement façade",                    checked: false },
  { id: "menuiseries_ext", label: "Remplacement menuiseries extérieures", checked: false },
  { id: "colonnes",        label: "Colonnes techniques / réseaux",        checked: false },
  { id: "elec_pc",         label: "Électricité parties communes",         checked: false },
  { id: "incendie",        label: "Sécurité incendie",                    checked: false },
  { id: "pmr",             label: "Accessibilité PMR",                    checked: false },
  { id: "ascenseur",       label: "Ascenseur",                            checked: false },
  { id: "amenagement_pc",  label: "Aménagement parties communes",         checked: false },
];

/* ================================================================== */
/*  PieceUI — avec multiplicateur                                      */
/* ================================================================== */

interface PieceUI {
  id: string; kind: PieceType; name: string; surfaceM2: number; multiplier: number;
  peinture: boolean; sol: boolean; elec: boolean; plomb: boolean; isolTh: boolean; isolPh: boolean;
  cuisinePack: boolean; cuisinePose: boolean; cuisineDepose: boolean;
  sdbPack: boolean; sdbSpec: boolean; sdbDepose: boolean;
  qtyPeinture: number; qtySol: number; qtySpots: number; qtyRj45: number;
  qtyPlombPoints: number; qtyIsolTh: number; qtyIsolPh: number;
}

function defaultQtys(kind: PieceType, s: number) {
  s = Math.max(0, s);
  return {
    qtyPeinture: Math.round(s * 2.6), qtySol: s,
    qtySpots: Math.max(1, Math.round(s / 6)),
    qtyRj45: kind === "sdb" || kind === "wc" ? 0 : Math.max(0, Math.round(s / 25)),
    qtyPlombPoints: kind === "cuisine" ? 2 : kind === "sdb" ? 2 : kind === "wc" ? 1 : 0,
    qtyIsolTh: s, qtyIsolPh: s,
  };
}
function defaultToggles(kind: PieceType) {
  return {
    peinture: true, sol: true, elec: true,
    plomb: kind === "cuisine" || kind === "sdb" || kind === "wc",
    isolTh: false, isolPh: false,
    cuisinePack: kind === "cuisine", cuisinePose: kind === "cuisine", cuisineDepose: false,
    sdbPack: kind === "sdb", sdbSpec: kind === "sdb", sdbDepose: false,
  };
}

let _counter = 0;
function createPieceUI(kind: PieceType = "sejour", surfaceM2 = 100): PieceUI {
  _counter++;
  const label = PROMOTEUR_ZONE_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
  return { id: `zone_${Date.now()}_${_counter}`, kind, name: label, surfaceM2, multiplier: 1, ...defaultToggles(kind), ...defaultQtys(kind, surfaceM2) };
}

function pieceUIToTravaux(p: PieceUI): PieceTravaux {
  const m = Math.max(1, p.multiplier);
  const items: ExpertLineItem[] = [];
  const push = (code: PricingItemCode, qty: number) => { if (qty > 0) items.push({ itemCode: code, qty: qty * m }); };
  if (p.peinture) push("mur_peinture_simple", p.qtyPeinture);
  if (p.sol)      push("sol_parquet", p.qtySol);
  if (p.elec)     { push("elec_spots", p.qtySpots); push("elec_rj45", p.qtyRj45); }
  if (p.plomb && p.qtyPlombPoints > 0) push("plomb_deplacement_points_eau", p.qtyPlombPoints);
  if (p.isolTh)   push("isol_th_murs", p.qtyIsolTh);
  if (p.isolPh)   push("isol_ph_murs_mitoyens", p.qtyIsolPh);
  if (p.kind === "cuisine") { if (p.cuisinePack) push("cuisine_pack", 1); if (p.cuisinePose) push("cuisine_pose", 1); if (p.cuisineDepose) push("demol_depose_cuisine", 1); }
  if (p.kind === "sdb")     { if (p.sdbPack) push("sdb_pack", 1); if (p.sdbSpec) push("sdb_spec_etancheite", 1); if (p.sdbDepose) push("demol_depose_faience_sanitaires", 1); }
  return { id: p.id, type: p.kind, name: m > 1 ? `${p.name} (×${m})` : p.name, surfaceM2: p.surfaceM2 * m, items };
}

function computeUnitCost(p: PieceUI, range: TravauxRange): number {
  const items: ExpertLineItem[] = [];
  const push = (code: PricingItemCode, qty: number) => { if (qty > 0) items.push({ itemCode: code, qty }); };
  if (p.peinture) push("mur_peinture_simple", p.qtyPeinture);
  if (p.sol)      push("sol_parquet", p.qtySol);
  if (p.elec)     { push("elec_spots", p.qtySpots); push("elec_rj45", p.qtyRj45); }
  if (p.plomb && p.qtyPlombPoints > 0) push("plomb_deplacement_points_eau", p.qtyPlombPoints);
  if (p.isolTh)   push("isol_th_murs", p.qtyIsolTh);
  if (p.isolPh)   push("isol_ph_murs_mitoyens", p.qtyIsolPh);
  if (p.kind === "cuisine") { if (p.cuisinePack) push("cuisine_pack", 1); if (p.cuisinePose) push("cuisine_pose", 1); if (p.cuisineDepose) push("demol_depose_cuisine", 1); }
  if (p.kind === "sdb")     { if (p.sdbPack) push("sdb_pack", 1); if (p.sdbSpec) push("sdb_spec_etancheite", 1); if (p.sdbDepose) push("demol_depose_faience_sanitaires", 1); }
  return items.reduce((sum, li) => sum + li.qty * getUnitPrice(li.itemCode, range), 0);
}

/* ================================================================== */
/*  Defaults                                                           */
/* ================================================================== */

const DEFAULT_OPTIONS: TravauxOptionsSimple = {
  cuisineRefaire: "none", sdbRefaire: "none", electricite: "none", plomberie: "none",
  menuiseries: "none", isolationThermique: "none", isolationPhonique: "none",
  demolition: "none", gravats: "none", humiditeTraitement: "none", moe: "none",
};
const RANGE_OPTIONS: { value: TravauxRange; label: string }[] = [
  { value: "eco", label: "Éco" }, { value: "standard", label: "Standard" }, { value: "premium", label: "Premium" },
];
const LEVEL_OPTIONS: { value: RenovationLevel; label: string; desc: string }[] = [
  { value: "refresh",  label: "Rafraîchissement", desc: "Peinture, finitions légères" },
  { value: "standard", label: "Standard",         desc: "Sol, cuisine, sdb" },
  { value: "heavy",    label: "Lourde",           desc: "Rénovation complète par lots" },
  { value: "full",     label: "Complète",         desc: "Remise à nu totale" },
];
const TRI_LABELS: Record<TriChoice, string> = { none: "Non", partial: "Partiel", full: "Complet" };
const BTN: React.CSSProperties = { transition: "all .15s", cursor: "pointer" };

/* ================================================================== */
/*  UI atoms                                                           */
/* ================================================================== */

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>{children}</div>
);

const TriSelect: React.FC<{ label: string; value: TriChoice; onChange: (v: TriChoice) => void }> = ({ label, value, onChange }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0" }}>
    <span style={{ fontSize: 13, color: "#374151" }}>{label}</span>
    <div style={{ display: "flex", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden" }}>
      {(["none", "partial", "full"] as TriChoice[]).map((opt) => (
        <button key={opt} type="button" onClick={() => onChange(opt)}
          style={{ ...BTN, padding: "4px 10px", border: "none", fontSize: 11, fontWeight: 600, background: value === opt ? ACCENT : "#fff", color: value === opt ? "#fff" : "#94a3b8" }}>
          {TRI_LABELS[opt]}
        </button>
      ))}
    </div>
  </div>
);

const BinSelect: React.FC<{ label: string; value: BinaryChoice; onChange: (v: BinaryChoice) => void }> = ({ label, value, onChange }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0" }}>
    <span style={{ fontSize: 13, color: "#374151" }}>{label}</span>
    <div style={{ display: "flex", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden" }}>
      {(["none", "yes"] as BinaryChoice[]).map((opt) => (
        <button key={opt} type="button" onClick={() => onChange(opt)}
          style={{ ...BTN, padding: "4px 10px", border: "none", fontSize: 11, fontWeight: 600, background: value === opt ? ACCENT : "#fff", color: value === opt ? "#fff" : "#94a3b8" }}>
          {opt === "none" ? "Non" : "Oui"}
        </button>
      ))}
    </div>
  </div>
);

const ToggleRow: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; children?: React.ReactNode }> = ({ label, checked, onChange, hint, children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
    <div onClick={() => onChange(!checked)} style={{ width: 36, height: 20, borderRadius: 10, flexShrink: 0, cursor: "pointer", position: "relative", background: checked ? ACCENT : "#cbd5e1", transition: "background .2s" }}>
      <div style={{ position: "absolute", top: 2, left: checked ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.2)", transition: "left .2s" }} />
    </div>
    <span style={{ fontSize: 12, color: "#374151", width: 90, flexShrink: 0 }}>{label}{hint && <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 4 }}>({hint})</span>}</span>
    {children && <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>{children}</div>}
  </div>
);

const InlineQty: React.FC<{ value: number; unit: string; onChange: (v: number) => void }> = ({ value, unit, onChange }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
    <input type="number" min={0} step={1} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      style={{ width: 56, fontSize: 12, textAlign: "right", border: "1px solid #e2e8f0", borderRadius: 6, padding: "3px 6px", outline: "none" }} />
    <span style={{ fontSize: 10, color: "#94a3b8", whiteSpace: "nowrap" }}>{unit}</span>
  </div>
);

/* ================================================================== */
/*  MultiplierControl                                                  */
/* ================================================================== */

const MultiplierControl: React.FC<{ value: number; onChange: (v: number) => void; unitCost: number }> = ({ value, onChange, unitCost }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, background: value > 1 ? ACCENT_LIGHT : "#f8fafc", border: `1px solid ${value > 1 ? ACCENT : "#e2e8f0"}`, marginBottom: 10 }}>
    <span style={{ fontSize: 16 }}>🔢</span>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: value > 1 ? ACCENT_DARK : "#64748b" }}>Lots similaires</div>
      {value > 1 && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>{fmtEuro(unitCost)} / lot × {value} = <strong style={{ color: ACCENT_DARK }}>{fmtEuro(unitCost * value)}</strong></div>}
    </div>
    <div style={{ display: "flex", alignItems: "center", borderRadius: 8, border: `1px solid ${value > 1 ? ACCENT : "#e2e8f0"}`, overflow: "hidden", background: "#fff" }}>
      <button type="button" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1}
        style={{ ...BTN, width: 28, height: 28, border: "none", background: "none", fontSize: 16, color: value <= 1 ? "#cbd5e1" : ACCENT, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
      <input type="number" min={1} max={999} value={value} onChange={(e) => onChange(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
        style={{ width: 40, textAlign: "center", border: "none", borderLeft: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0", fontSize: 13, fontWeight: 700, color: value > 1 ? ACCENT_DARK : "#374151", outline: "none", padding: "4px 0" }} />
      <button type="button" onClick={() => onChange(Math.min(999, value + 1))}
        style={{ ...BTN, width: 28, height: 28, border: "none", background: "none", fontSize: 16, color: ACCENT, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
    </div>
  </div>
);

/* ================================================================== */
/*  ApplyToBilanButton                                                 */
/* ================================================================== */

type ApplyStatus = "idle" | "success" | "error";

const ApplyToBilanButton: React.FC<{
  totalWithBuffer: number; totalHT: number; bufferPct: number;
  sourceMode: "simple" | "expert"; surfaceTotaleM2: number;
}> = ({ totalWithBuffer, totalHT, bufferPct, sourceMode, surfaceTotaleM2 }) => {
  const [status, setStatus] = useState<ApplyStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current !== null) clearTimeout(timerRef.current); }, []);

  const handleClick = useCallback(() => {
    const ok = applyTravauxToBilanPromo(totalWithBuffer, totalHT, bufferPct, sourceMode, surfaceTotaleM2);
    setStatus(ok ? "success" : "error");
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { setStatus("idle"); timerRef.current = null; }, 2400);
  }, [totalWithBuffer, totalHT, bufferPct, sourceMode, surfaceTotaleM2]);

  if (status === "success") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d", fontSize: 13, fontWeight: 700 }}>
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
      Transmis au bilan ({fmtEuro(totalWithBuffer)}{surfaceTotaleM2 > 0 ? ` · ${Math.round(surfaceTotaleM2)} m²` : ""})
    </div>
  );
  if (status === "error") return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", fontSize: 13, fontWeight: 700 }}>
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" /></svg>
      Erreur — réessayez
    </div>
  );
  return (
    <button type="button" onClick={handleClick}
      style={{ ...BTN, display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 10, border: "none", background: GRAD, color: "#fff", fontSize: 13, fontWeight: 700, boxShadow: `0 4px 16px ${ACCENT}44` }}>
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
      Utiliser ce total dans le bilan promoteur
    </button>
  );
};

/* ================================================================== */
/*  ZoneCard                                                           */
/* ================================================================== */

const ZoneCard: React.FC<{ piece: PieceUI; range: TravauxRange; onChange: (u: PieceUI) => void; onRemove: () => void }> = ({ piece, range, onChange, onRemove }) => {
  const p = piece;
  const update = (partial: Partial<PieceUI>) => onChange({ ...p, ...partial });
  const updateKind = (kind: PieceType) => {
    const label = PROMOTEUR_ZONE_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
    update({ kind, ...defaultToggles(kind), ...defaultQtys(kind, p.surfaceM2), name: label });
  };
  const updateSurface = (s: number) => update({ surfaceM2: s, ...defaultQtys(p.kind, s) });
  const unitCost  = computeUnitCost(p, range);
  const totalCost = unitCost * Math.max(1, p.multiplier);
  const icon      = ZONE_ICONS[p.kind] ?? "🔧";

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${p.multiplier > 1 ? ACCENT + "55" : "#e2e8f0"}`, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <select value={p.kind} onChange={(e) => updateKind(e.target.value as PieceType)}
          style={{ fontSize: 12, fontWeight: 700, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "4px 8px", flex: 1, minWidth: 0, outline: "none" }}>
          {PROMOTEUR_ZONE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.icon} {opt.label}</option>)}
        </select>
        <input type="text" value={p.name} onChange={(e) => update({ name: e.target.value })}
          style={{ fontSize: 12, background: "transparent", border: "none", borderBottom: "1px solid #e2e8f0", outline: "none", padding: "2px 4px", minWidth: 0, flex: 1 }} placeholder="Nom" />
        {p.multiplier > 1 && <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: ACCENT, borderRadius: 20, padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0 }}>×{p.multiplier}</span>}
        <span style={{ fontSize: 13, fontWeight: 700, color: ACCENT, whiteSpace: "nowrap", flexShrink: 0 }}>{fmtEuro(totalCost)}</span>
        <button type="button" onClick={onRemove} style={{ ...BTN, background: "none", border: "none", color: "#cbd5e1", fontSize: 18, padding: 2 }}>×</button>
      </div>
      <MultiplierControl value={p.multiplier} onChange={(v) => update({ multiplier: v })} unitCost={unitCost} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>Surface / lot :</span>
        <input type="number" min={1} max={5000} value={p.surfaceM2} onChange={(e) => updateSurface(Math.max(1, Number(e.target.value) || 1))}
          style={{ width: 72, fontSize: 13, fontWeight: 700, textAlign: "right", border: "1px solid #e2e8f0", borderRadius: 8, padding: "4px 8px", outline: "none" }} />
        <span style={{ fontSize: 11, color: "#94a3b8" }}>m² {p.multiplier > 1 && <span style={{ color: ACCENT_DARK }}>= {Math.round(p.surfaceM2 * p.multiplier)} m² total</span>}</span>
      </div>
      <div>
        <ToggleRow label="Peinture"     checked={p.peinture} onChange={(v) => update({ peinture: v })}>{p.peinture && <InlineQty value={p.qtyPeinture}    unit="m²"    onChange={(v) => update({ qtyPeinture: v })} />}</ToggleRow>
        <ToggleRow label="Sol"          checked={p.sol}      onChange={(v) => update({ sol: v })}>{p.sol      && <InlineQty value={p.qtySol}         unit="m²"    onChange={(v) => update({ qtySol: v })} />}</ToggleRow>
        <ToggleRow label="Électricité"  checked={p.elec}     onChange={(v) => update({ elec: v })}>{p.elec     && <InlineQty value={p.qtySpots}       unit="spots" onChange={(v) => update({ qtySpots: v })} />}</ToggleRow>
        <ToggleRow label="Plomberie"    checked={p.plomb}    onChange={(v) => update({ plomb: v })}>{p.plomb    && <InlineQty value={p.qtyPlombPoints} unit="pts"   onChange={(v) => update({ qtyPlombPoints: v })} />}</ToggleRow>
        <ToggleRow label="Isol. therm." checked={p.isolTh}   onChange={(v) => update({ isolTh: v })}>{p.isolTh   && <InlineQty value={p.qtyIsolTh}      unit="m²"    onChange={(v) => update({ qtyIsolTh: v })} />}</ToggleRow>
        <ToggleRow label="Isol. phon."  checked={p.isolPh}   onChange={(v) => update({ isolPh: v })}>{p.isolPh   && <InlineQty value={p.qtyIsolPh}      unit="m²"    onChange={(v) => update({ qtyIsolPh: v })} />}</ToggleRow>
      </div>
      {p.kind === "cuisine" && (
        <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 8, marginTop: 4 }}>
          <ToggleRow label="Pack réseau" checked={p.cuisinePack}  onChange={(v) => update({ cuisinePack: v })} />
          <ToggleRow label="Pose"        checked={p.cuisinePose}  onChange={(v) => update({ cuisinePose: v })} />
          <ToggleRow label="Dépose"      checked={p.cuisineDepose} onChange={(v) => update({ cuisineDepose: v })} hint="forfait" />
        </div>
      )}
      {p.kind === "sdb" && (
        <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 8, marginTop: 4 }}>
          <ToggleRow label="Pack"        checked={p.sdbPack}  onChange={(v) => update({ sdbPack: v })} />
          <ToggleRow label="Étanchéité"  checked={p.sdbSpec}  onChange={(v) => update({ sdbSpec: v })} />
          <ToggleRow label="Dépose"      checked={p.sdbDepose} onChange={(v) => update({ sdbDepose: v })} hint="forfait" />
        </div>
      )}
    </div>
  );
};

/* ================================================================== */
/*  ZoneEditor                                                         */
/* ================================================================== */

const ZoneEditor: React.FC<{ pieces: PieceUI[]; onChange: (p: PieceUI[]) => void; range: TravauxRange }> = ({ pieces, onChange, range }) => {
  const upd = useCallback((id: string, u: PieceUI) => onChange(pieces.map((p) => (p.id === id ? u : p))), [pieces, onChange]);
  const rm  = useCallback((id: string) => onChange(pieces.filter((p) => p.id !== id)), [pieces, onChange]);
  const add = useCallback((kind: PieceType = "sejour") => onChange([...pieces, createPieceUI(kind, 100)]), [pieces, onChange]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {pieces.map((p) => <ZoneCard key={p.id} piece={p} range={range} onChange={(u) => upd(p.id, u)} onRemove={() => rm(p.id)} />)}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 4 }}>
        {PROMOTEUR_ZONE_OPTIONS.slice(0, 5).map((opt) => (
          <button key={opt.value} type="button" onClick={() => add(opt.value)}
            style={{ ...BTN, display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc", fontSize: 11, fontWeight: 600, color: "#475569" }}>
            <span>{opt.icon}</span><span>+ {opt.label.split(" / ")[0]}</span>
          </button>
        ))}
        <div style={{ position: "relative" }} className="group">
          <button type="button" style={{ ...BTN, padding: "6px 10px", borderRadius: 8, border: "1px dashed #cbd5e1", background: "#f8fafc", fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>+ Autre…</button>
          <div className="hidden group-hover:flex" style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.12)", zIndex: 20, flexDirection: "column", minWidth: 200 }}>
            {PROMOTEUR_ZONE_OPTIONS.slice(5).map((opt) => (
              <button key={opt.value} type="button" onClick={() => add(opt.value)}
                style={{ ...BTN, textAlign: "left", padding: "8px 14px", background: "none", border: "none", fontSize: 12, color: "#374151" }}>{opt.icon} {opt.label}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ================================================================== */
/*  ZoneResultList                                                     */
/* ================================================================== */

interface LineResult { code: PricingItemCode; label: string; unit: string; qty: number; unitPrice: number; amount: number; }
interface LotGroup   { lotLabel: string; amount: number; lines: LineResult[]; }

function computeZoneBreakdown(items: ExpertLineItem[], range: TravauxRange): { groups: LotGroup[]; total: number } {
  const groupMap = new Map<string, LotGroup>(); let total = 0;
  for (const li of items) {
    if (li.qty <= 0) continue; const meta = PRICING_MAP.get(li.itemCode); if (!meta) continue;
    const up = meta.prices[range]; const amount = li.qty * up; total += amount;
    const existing = groupMap.get(meta.lotLabel) ?? { lotLabel: meta.lotLabel, amount: 0, lines: [] };
    existing.amount += amount;
    existing.lines.push({ code: li.itemCode, label: meta.label, unit: meta.unit, qty: li.qty, unitPrice: up, amount });
    groupMap.set(meta.lotLabel, existing);
  }
  return { groups: Array.from(groupMap.values()).sort((a, b) => b.amount - a.amount), total };
}

const ZoneResultList: React.FC<{ pieces: PieceTravaux[]; originals: PieceUI[]; range: TravauxRange }> = ({ pieces, originals, range }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (pieces.length === 0) return <div style={{ textAlign: "center", padding: "24px 0", color: "#94a3b8", fontSize: 13 }}>Ajoutez des zones ou lots techniques pour voir le détail.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {pieces.map((piece, idx) => {
        const orig = originals[idx]; const multiplier = orig?.multiplier ?? 1;
        const { groups, total } = computeZoneBreakdown(piece.items, range);
        const unitTotal = multiplier > 1 ? total / multiplier : total;
        const isOpen = expandedId === piece.id; const icon = ZONE_ICONS[piece.type] ?? "🔧";
        return (
          <div key={piece.id} style={{ background: "#fff", borderRadius: 10, border: `1px solid ${multiplier > 1 ? ACCENT + "44" : "#e2e8f0"}`, overflow: "hidden" }}>
            <button type="button" onClick={() => setExpandedId((prev) => (prev === piece.id ? null : piece.id))}
              style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "none", border: "none", textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>{icon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>{orig?.name ?? piece.name}</span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>{orig?.surfaceM2 ?? piece.surfaceM2} m²/lot</span>
                {multiplier > 1 && <span style={{ fontSize: 10, fontWeight: 800, color: ACCENT_DARK, background: ACCENT_LIGHT, borderRadius: 20, padding: "1px 8px", border: `1px solid ${ACCENT}44` }}>×{multiplier} lots</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {multiplier > 1 && <span style={{ fontSize: 11, color: "#94a3b8" }}>{fmtEuro(unitTotal)} × {multiplier}</span>}
                <span style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{fmtEuro(total)}</span>
                <svg style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .2s", color: "#94a3b8" }} width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </div>
            </button>
            {isOpen && groups.length > 0 && (
              <div style={{ borderTop: "1px solid #f1f5f9", padding: "10px 14px", background: "#fafafa" }}>
                {multiplier > 1 && <div style={{ marginBottom: 10, padding: "6px 10px", background: ACCENT_LIGHT, borderRadius: 8, fontSize: 11, color: ACCENT_DARK, fontWeight: 600 }}>📐 {fmtEuro(unitTotal)} / lot × {multiplier} lots = {fmtEuro(total)}</div>}
                {groups.map((g) => (
                  <div key={g.lotLabel} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: 1 }}>{g.lotLabel}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>{fmtEuro(g.amount)}</span>
                    </div>
                    {g.lines.map((line, i) => (
                      <div key={`${line.code}-${i}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", paddingLeft: 8, paddingBottom: 2 }}>
                        <span>{line.label}</span>
                        <span style={{ whiteSpace: "nowrap" }}>{line.qty % 1 === 0 ? line.qty : line.qty.toFixed(1)} × {fmtEuro(line.unitPrice)} = <strong style={{ color: "#1e293b" }}>{fmtEuro(line.amount)}</strong></span>
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
  lots: ComputedLot[]; total: number; bufferPct: number;
  totalWithBuffer: number; costPerM2: number | null; complexityCoef: number;
  simulation: TravauxSimulationV1; computed: ComputedTravaux; sourceMode: "simple" | "expert";
  disabledLots: Set<string>; onToggleLot: (code: string) => void;
  surfaceTotaleM2: number;
}> = ({ lots, total, bufferPct, totalWithBuffer, costPerM2, complexityCoef, simulation, computed, sourceMode, disabledLots, onToggleLot, surfaceTotaleM2 }) => {
  const [expandedLot, setExpandedLot] = useState<string | null>(null);
  const activeLots = lots.filter((l) => l.amount > 0);
  const filteredTotal = activeLots.filter((l) => !disabledLots.has(l.code)).reduce((s, l) => s + l.amount, 0);
  const filteredBuffer = Math.round(filteredTotal * bufferPct);
  const filteredTotalWithBuffer = filteredTotal + filteredBuffer;
  const filteredCostPerM2 = costPerM2 !== null && total > 0 ? Math.round((filteredTotal / total) * (costPerM2 ?? 0)) : null;
  const disabledCount = disabledLots.size;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Cartes résumé */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
        {[
          { label: "Total HT",       value: fmtEuro(filteredTotal),          sub: disabledCount > 0 ? `${disabledCount} lot${disabledCount > 1 ? "s" : ""} masqué${disabledCount > 1 ? "s" : ""}` : null, color: "#1e293b", bg: "#fff" },
          { label: `Buffer (${(bufferPct * 100).toFixed(0)}%)`, value: fmtEuro(filteredBuffer), sub: null, color: "#d97706", bg: "#fff" },
          { label: "Total + Buffer", value: fmtEuro(filteredTotalWithBuffer), sub: null, color: "#fff", bg: GRAD },
          { label: "€/m²",          value: filteredCostPerM2 !== null ? fmtEuro(filteredCostPerM2) : "—", sub: surfaceTotaleM2 > 0 ? `${Math.round(surfaceTotaleM2)} m² réhab` : null, color: "#1e293b", bg: "#fff" },
        ].map((c) => (
          <div key={c.label} style={{ borderRadius: 12, border: c.bg === "#fff" ? "1px solid #e2e8f0" : "none", padding: "14px 12px", textAlign: "center", background: c.bg }}>
            <p style={{ fontSize: 10, color: c.bg === "#fff" ? "#94a3b8" : "rgba(255,255,255,.7)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{c.label}</p>
            <p style={{ fontSize: 18, fontWeight: 800, color: c.color }}>{c.value}</p>
            {c.sub && <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{c.sub}</p>}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          {disabledCount > 0 && (
            <button type="button" onClick={() => onToggleLot("__reset__")}
              style={{ ...BTN, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: `1px solid ${ACCENT}`, background: ACCENT_LIGHT, color: ACCENT_DARK, fontSize: 11, fontWeight: 700 }}>
              ↺ Réafficher tous les lots
            </button>
          )}
        </div>
        <ApplyToBilanButton totalWithBuffer={filteredTotalWithBuffer} totalHT={filteredTotal} bufferPct={bufferPct} sourceMode={sourceMode} surfaceTotaleM2={surfaceTotaleM2} />
      </div>

      {complexityCoef > 1 && <p style={{ fontSize: 11, color: "#94a3b8", textAlign: "right" }}>Coef. complexité : ×{complexityCoef.toFixed(2)}</p>}

      {/* Liste lots */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {activeLots.map((lot) => {
          const isDisabled = disabledLots.has(lot.code);
          const pct = filteredTotal > 0 && !isDisabled ? (lot.amount / filteredTotal) * 100 : 0;
          const isOpen = expandedLot === lot.code && !isDisabled;
          return (
            <div key={lot.code} style={{ borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden", opacity: isDisabled ? 0.4 : 1, background: isDisabled ? "#f8fafc" : "#fff", transition: "opacity .2s" }}>
              <div style={{ display: "flex" }}>
                <button type="button" onClick={() => onToggleLot(lot.code)} title={isDisabled ? "Réactiver" : "Masquer"}
                  style={{ ...BTN, width: 34, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRight: "1px solid #f1f5f9", color: isDisabled ? ACCENT : "#cbd5e1", fontSize: 14 }}>
                  {isDisabled ? "↺" : "×"}
                </button>
                <button type="button" onClick={() => !isDisabled && setExpandedLot((prev) => (prev === lot.code ? null : lot.code))} disabled={isDisabled}
                  style={{ ...BTN, flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "none", border: "none", textAlign: "left", cursor: isDisabled ? "default" : "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ height: 8, borderRadius: 4, background: ACCENT, width: isDisabled ? 4 : `${Math.max(4, pct * 0.7)}px`, opacity: isDisabled ? 0.3 : 1, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: isDisabled ? "#94a3b8" : "#1e293b", textDecoration: isDisabled ? "line-through" : "none" }}>{lot.label}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    {!isDisabled && <span style={{ fontSize: 11, color: "#94a3b8" }}>{pct.toFixed(1)}%</span>}
                    <span style={{ fontSize: 13, fontWeight: 700, color: isDisabled ? "#94a3b8" : "#1e293b" }}>{fmtEuro(lot.amount)}</span>
                    {!isDisabled && <svg style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .2s", color: "#94a3b8" }} width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>}
                  </div>
                </button>
              </div>
              {isOpen && lot.lines.length > 0 && (
                <div style={{ borderTop: "1px solid #f1f5f9", padding: "8px 14px", background: "#fafafa" }}>
                  <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ color: "#94a3b8" }}>
                        <th style={{ textAlign: "left", paddingBottom: 4 }}>Poste</th>
                        <th style={{ textAlign: "right", paddingBottom: 4 }}>Qté</th>
                        <th style={{ textAlign: "right", paddingBottom: 4 }}>P.U.</th>
                        <th style={{ textAlign: "right", paddingBottom: 4 }}>Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lot.lines.map((line, idx) => (
                        <tr key={`${line.code}-${idx}`} style={{ borderTop: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "4px 0", color: "#475569" }}>{line.label}</td>
                          <td style={{ textAlign: "right", color: "#64748b", whiteSpace: "nowrap" }}>{line.qty % 1 === 0 ? line.qty : line.qty.toFixed(1)} {line.unit !== "forfait" && line.unit !== "pct" ? line.unit : ""}</td>
                          <td style={{ textAlign: "right", color: "#64748b", whiteSpace: "nowrap" }}>{line.unit === "pct" ? `${(line.qty * 100).toFixed(0)}%` : fmtEuro(line.unitPrice)}</td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: "#1e293b", whiteSpace: "nowrap" }}>{fmtEuro(line.amount)}</td>
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
/*  PostesPromoSection + Disclaimer + EmptyState                       */
/* ================================================================== */

const PostesPromoSection: React.FC<{ postes: PostePromo[]; onChange: (p: PostePromo[]) => void }> = ({ postes, onChange }) => {
  const toggle = (id: string) => onChange(postes.map((p) => (p.id === id ? { ...p, checked: !p.checked } : p)));
  const count = postes.filter((p) => p.checked).length;
  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <Label>🏗 Postes lourds à chiffrer séparément</Label>
        {count > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT, background: ACCENT_LIGHT, borderRadius: 20, padding: "2px 10px" }}>{count} coché{count > 1 ? "s" : ""}</span>}
      </div>
      <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12, lineHeight: 1.5 }}>Non inclus dans le calcul. Cochez et faites chiffrer séparément.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {postes.map((p) => (
          <button key={p.id} type="button" onClick={() => toggle(p.id)}
            style={{ ...BTN, display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, border: `1px solid ${p.checked ? ACCENT : "#e2e8f0"}`, background: p.checked ? ACCENT_LIGHT : "#f8fafc", textAlign: "left" }}>
            <div style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, border: `2px solid ${p.checked ? ACCENT : "#cbd5e1"}`, background: p.checked ? ACCENT : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {p.checked && <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: p.checked ? ACCENT_DARK : "#374151" }}>{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

const DisclaimerPromo: React.FC = () => (
  <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "12px 16px", display: "flex", gap: 10, alignItems: "flex-start" }}>
    <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
    <p style={{ fontSize: 12, color: "#92400e", lineHeight: 1.6, margin: 0 }}>
      <strong>Estimation indicative</strong> hors honoraires techniques détaillés, diagnostics, aléas structurels non visibles, désamiantage confirmé, taxes, assurances et coûts de portage. À valider par métrés, diagnostics et entreprises.
    </p>
  </div>
);

const RecapEmptyState: React.FC<{ mode: "simple" | "expert" }> = ({ mode }) => (
  <div style={{ textAlign: "center", padding: "48px 24px", background: "#fff", borderRadius: 14, border: "1px dashed #e2e8f0" }}>
    <div style={{ fontSize: 44, marginBottom: 14 }}>🏗</div>
    <div style={{ fontSize: 15, fontWeight: 700, color: "#475569", marginBottom: 8 }}>Aucune simulation en cours</div>
    <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6, maxWidth: 300, margin: "0 auto" }}>
      {mode === "simple" ? "Renseignez la surface réhabilitée et les hypothèses pour obtenir une estimation." : "Ajoutez des zones ou lots techniques pour démarrer la simulation."}
    </div>
  </div>
);

/* ================================================================== */
/*  Main Page                                                          */
/* ================================================================== */

const PERSIST_DEBOUNCE_MS = 600;

const PromoteurSimulationTravauxPage: React.FC = () => {
  const [mode, setMode]                = useState<"simple" | "expert">("simple");
  const [range, setRange]              = useState<TravauxRange>("standard");
  const [renovationLevel, setRenovLvl] = useState<RenovationLevel>("heavy");
  const [complexity, setComplexity]    = useState<ChantierComplexity>(2);
  const [surface, setSurface]          = useState(0);
  const [options, setOptions]          = useState<TravauxOptionsSimple>(DEFAULT_OPTIONS);
  const [piecesUI, setPiecesUI]        = useState<PieceUI[]>([]);
  const [disabledLots, setDisabledLots]= useState<Set<string>>(new Set());
  const [postesPromo, setPostesPromo]  = useState<PostePromo[]>(POSTES_INIT);

  const handleToggleLot = useCallback((code: string) => {
    if (code === "__reset__") { setDisabledLots(new Set()); return; }
    setDisabledLots((prev) => { const n = new Set(prev); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  }, []);

  const handleReset = useCallback(() => {
    setMode("simple"); setRange("standard"); setRenovLvl("heavy");
    setComplexity(2); setSurface(0); setOptions(DEFAULT_OPTIONS);
    setPiecesUI([]); setDisabledLots(new Set()); setPostesPromo(POSTES_INIT);
  }, []);

  const zonesTravaux = useMemo(() => piecesUI.map(pieceUIToTravaux), [piecesUI]);

  const surfaceTotaleM2 = useMemo(() => {
    if (mode === "simple") return surface;
    return piecesUI.reduce((acc, p) => acc + p.surfaceM2 * Math.max(1, p.multiplier), 0);
  }, [mode, surface, piecesUI]);

  const simulation = useMemo((): TravauxSimulationV1 => {
    const surfaceTotal = mode === "expert" ? zonesTravaux.reduce((acc, p) => acc + p.surfaceM2, 0) : surface;
    return { version: 1, mode, range, renovationLevel, surfaceTotalM2: surfaceTotal, options, complexity, pieces: zonesTravaux, updatedAt: new Date().toISOString() };
  }, [mode, range, renovationLevel, complexity, surface, options, zonesTravaux]);

  const result: ComputedTravaux = useMemo(() => computeTravauxSimulation(simulation), [simulation]);

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTravauxResult(simulation, result);
      persistTravauxToMarchand(simulation, result);
      persistTimerRef.current = null;
    }, PERSIST_DEBOUNCE_MS);
    return () => { if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current); };
  }, [simulation, result]);

  const setOpt = <K extends keyof TravauxOptionsSimple>(key: K, value: TravauxOptionsSimple[K]) =>
    setOptions((prev) => ({ ...prev, [key]: value }));

  const isEmpty = mode === "simple" ? surface === 0 : piecesUI.length === 0;

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>

      {/* ── Hero v2 ── */}
      <div style={{ marginBottom: 20 }}>
        <PromoteurPageHero
          badge="Promoteur · Rénovation"
          title="Réhabilitation lourde"
          metaLines={[
            { text: "Estimez le coût de rénovation lourde d'un immeuble ou d'une opération de restructuration." },
            ...(surfaceTotaleM2 > 0 ? [{ text: `📐 ${Math.round(surfaceTotaleM2)} m² · ${range} · ${renovationLevel}` }] : []),
          ]}
          actions={
            <HeroGhostButton onClick={handleReset}>
              ↺ Nouvelle simulation
            </HeroGhostButton>
          }
        />
      </div>

      <div style={{ marginBottom: 20 }}><DisclaimerPromo /></div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, alignItems: "start" }}>

        {/* Colonne gauche */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Mode */}
          <div style={{ background: "#fff", borderRadius: 12, padding: 6, display: "flex", gap: 4, border: "1px solid #e2e8f0" }}>
            {(["simple", "expert"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                style={{ ...BTN, flex: 1, padding: "7px 4px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 700, background: mode === m ? ACCENT : "transparent", color: mode === m ? "#fff" : "#64748b" }}>
                {m === "simple" ? "Simple" : "Par zones / lots"}
              </button>
            ))}
          </div>

          {/* Niveau de prestation */}
          <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #e2e8f0" }}>
            <Label>Niveau de prestation</Label>
            <div style={{ display: "flex", gap: 6 }}>
              {RANGE_OPTIONS.map((r) => (
                <button key={r.value} type="button" onClick={() => setRange(r.value)}
                  style={{ ...BTN, flex: 1, padding: "8px 4px", borderRadius: 8, border: `2px solid ${range === r.value ? ACCENT : "#e2e8f0"}`, background: range === r.value ? ACCENT_LIGHT : "#fff", color: range === r.value ? ACCENT_DARK : "#94a3b8", fontSize: 12, fontWeight: 700 }}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Niveau de rénovation */}
          <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: 8 }}>
            <Label>Niveau de rénovation</Label>
            {LEVEL_OPTIONS.map((l) => (
              <button key={l.value} type="button" onClick={() => setRenovLvl(l.value)}
                style={{ ...BTN, padding: "8px 12px", borderRadius: 8, textAlign: "left", border: `2px solid ${renovationLevel === l.value ? ACCENT : "#e2e8f0"}`, background: renovationLevel === l.value ? ACCENT_LIGHT : "#fff" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: renovationLevel === l.value ? ACCENT_DARK : "#374151" }}>{l.label}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{l.desc}</div>
              </button>
            ))}
            <div style={{ paddingTop: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Complexité chantier</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT_DARK }}>{complexity}/4</span>
              </div>
              <input type="range" min={0} max={4} step={1} value={complexity}
                onChange={(e) => setComplexity(Number(e.target.value) as ChantierComplexity)}
                style={{ width: "100%", accentColor: ACCENT }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8" }}><span>Standard</span><span>Très complexe</span></div>
            </div>
          </div>

          {/* Surface (mode simple) */}
          {mode === "simple" && (
            <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #e2e8f0" }}>
              <Label>Surface réhabilitée</Label>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <input type="number" min={0} max={50000} value={surface === 0 ? "" : surface} placeholder="Ex : 800"
                  onChange={(e) => setSurface(Math.max(0, Number(e.target.value) || 0))}
                  style={{ width: 100, fontSize: 18, fontWeight: 700, textAlign: "right", border: `2px solid ${ACCENT}`, borderRadius: 10, padding: "8px 12px", outline: "none", color: "#1e293b" }} />
                <span style={{ fontSize: 14, color: "#64748b", fontWeight: 600 }}>m²</span>
              </div>
            </div>
          )}

          {/* Hypothèses (mode simple) */}
          {mode === "simple" && (
            <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #e2e8f0" }}>
              <Label>Hypothèses de réhabilitation</Label>
              <TriSelect label="Cuisine / équipements" value={options.cuisineRefaire}     onChange={(v) => setOpt("cuisineRefaire", v)} />
              <TriSelect label="Salle de bain"         value={options.sdbRefaire}         onChange={(v) => setOpt("sdbRefaire", v)} />
              <TriSelect label="Électricité"           value={options.electricite}        onChange={(v) => setOpt("electricite", v)} />
              <TriSelect label="Plomberie"             value={options.plomberie}          onChange={(v) => setOpt("plomberie", v)} />
              <TriSelect label="Menuiseries int."      value={options.menuiseries}        onChange={(v) => setOpt("menuiseries", v)} />
              <TriSelect label="Isolation thermique"   value={options.isolationThermique} onChange={(v) => setOpt("isolationThermique", v)} />
              <TriSelect label="Isolation phonique"    value={options.isolationPhonique}  onChange={(v) => setOpt("isolationPhonique", v)} />
              <TriSelect label="Démolition intérieure" value={options.demolition}         onChange={(v) => setOpt("demolition", v)} />
              <TriSelect label="Évacuation gravats"    value={options.gravats}            onChange={(v) => setOpt("gravats", v)} />
              <BinSelect label="Traitement humidité"   value={options.humiditeTraitement} onChange={(v) => setOpt("humiditeTraitement", v)} />
              <BinSelect label="Maîtrise d'œuvre"      value={options.moe}               onChange={(v) => setOpt("moe", v)} />
            </div>
          )}

          {/* Zones (mode expert) */}
          {mode === "expert" && (
            <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Label>Zones / lots techniques</Label>
                {surfaceTotaleM2 > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT, background: ACCENT_LIGHT, borderRadius: 20, padding: "2px 10px" }}>
                    {Math.round(surfaceTotaleM2)} m² total
                  </span>
                )}
              </div>
              <ZoneEditor pieces={piecesUI} onChange={setPiecesUI} range={range} />
            </div>
          )}

          {/* Options globales (mode expert) */}
          {mode === "expert" && (
            <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #e2e8f0" }}>
              <Label>Options globales</Label>
              <BinSelect label="Traitement humidité" value={options.humiditeTraitement} onChange={(v) => setOpt("humiditeTraitement", v)} />
              <BinSelect label="Maîtrise d'œuvre"    value={options.moe}               onChange={(v) => setOpt("moe", v)} />
            </div>
          )}

          <PostesPromoSection postes={postesPromo} onChange={setPostesPromo} />
        </div>

        {/* Colonne droite */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", overflow: "hidden", minHeight: 400 }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#1e293b" }}>{mode === "expert" ? "Détail par zone & récapitulatif" : "Récapitulatif par lots"}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{mode === "simple" ? "Renseignez la surface et les hypothèses pour voir l'estimation" : "Ajoutez des zones ou lots techniques pour démarrer"}</div>
            </div>
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
              {mode === "expert" && zonesTravaux.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>Détail par zone</div>
                  <ZoneResultList pieces={zonesTravaux} originals={piecesUI} range={range} />
                </div>
              )}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>Récapitulatif par lots</div>
                {isEmpty ? <RecapEmptyState mode={mode} /> : (
                  <LotsBreakdown
                    lots={result.lots} total={result.total} bufferPct={result.bufferPct}
                    bufferAmount={result.bufferAmount} totalWithBuffer={result.totalWithBuffer}
                    costPerM2={result.costPerM2} complexityCoef={result.complexityCoef}
                    simulation={simulation} computed={result} sourceMode={mode}
                    disabledLots={disabledLots} onToggleLot={handleToggleLot}
                    surfaceTotaleM2={surfaceTotaleM2}
                  />
                )}
              </div>
              {postesPromo.filter((p) => p.checked).length > 0 && (
                <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "12px 16px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>🏗 Postes lourds à chiffrer séparément</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {postesPromo.filter((p) => p.checked).map((p) => (
                      <span key={p.id} style={{ fontSize: 11, fontWeight: 600, color: "#92400e", background: "#fef3c7", borderRadius: 20, padding: "3px 10px", border: "1px solid #fde68a" }}>{p.label}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`.group:hover .hidden { display: flex !important; }`}</style>
    </div>
  );
};

export default PromoteurSimulationTravauxPage;