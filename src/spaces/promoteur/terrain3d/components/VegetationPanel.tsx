// VegetationPanel.tsx — v2 Blender
// Contrôles végétation Three.js + contrat export Blender

import React, { type FC, useState } from "react";
import type { VegetationOptions } from "./MassingRenderer";
import type { TreeType } from "../massingVegetationEngine";

const ACCENT = "#5247b8";

// ─── Data ─────────────────────────────────────────────────────────────────────

const TREE_TYPES: { value: TreeType; label: string; icon: string }[] = [
  { value: "deciduous", label: "Feuillu",  icon: "🌳" },
  { value: "round",     label: "Boule",    icon: "🟢" },
  { value: "conifer",   label: "Conifère", icon: "🌲" },
  { value: "columnar",  label: "Cyprès",   icon: "🌿" },
  { value: "palm",      label: "Palmier",  icon: "🌴" },
];

const SEASONS = [
  { v: "spring", l: "🌸 Printemps" },
  { v: "summer", l: "☀ Été" },
  { v: "autumn", l: "🍂 Automne" },
  { v: "winter", l: "❄ Hiver" },
] as const;

// ─── Micro-composants ─────────────────────────────────────────────────────────

const Toggle: FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
  <div onClick={() => onChange(!checked)} style={{
    width: 34, height: 20, borderRadius: 10, cursor: "pointer",
    background: checked ? ACCENT : "#d1d5db",
    position: "relative", transition: "background .15s", flexShrink: 0,
  }}>
    <div style={{
      width: 16, height: 16, borderRadius: 8, background: "white",
      position: "absolute", top: 2, left: checked ? 16 : 2,
      transition: "left .15s", boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
    }} />
  </div>
);

const SLabel: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, marginTop: 10 }}>
    {children}
  </div>
);

const Row: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
    <span style={{ fontSize: 11, color: "#475569", flexShrink: 0 }}>{label}</span>
    <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
  </div>
);

const ToggleRow: FC<{ icon: string; label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ icon, label, checked, onChange }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
    <span style={{ fontSize: 12, fontWeight: 500, color: "#374151", display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 14 }}>{icon}</span> {label}
    </span>
    <Toggle checked={checked} onChange={onChange} />
  </div>
);

const SliderRow: FC<{ label: string; min: number; max: number; step: number; value: number; unit: string; onChange: (v: number) => void }> = ({
  label, min, max, step, value, unit, onChange,
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0 3px 20px", marginBottom: 4 }}>
    <span style={{ fontSize: 10, color: "#64748b", minWidth: 64 }}>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      style={{ flex: 1, accentColor: ACCENT, cursor: "pointer" }} />
    <span style={{ fontSize: 10, color: "#94a3b8", minWidth: 32, textAlign: "right" }}>{value}{unit}</span>
  </div>
);

function chip(active: boolean): React.CSSProperties {
  return {
    padding: "4px 8px", borderRadius: 6, cursor: "pointer", fontSize: 10, fontWeight: 600,
    border: active ? `1.5px solid ${ACCENT}` : "1.5px solid #e2e8f0",
    background: active ? "rgba(82,71,184,0.08)" : "white",
    color: active ? ACCENT : "#475569", transition: "all .10s",
  };
}

function ChipGroup<T extends string>({ options, value, onChange, wrap }: {
  options: { v: T; l: string }[];
  value: T;
  onChange: (v: T) => void;
  wrap?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: wrap ? "wrap" : "nowrap", padding: "2px 0 6px 20px" }}>
      {options.map(o => (
        <button key={o.v} style={{ ...chip(value === o.v) }} onClick={() => onChange(o.v)}>{o.l}</button>
      ))}
    </div>
  );
}

const Sel: FC<{ value: string; options: { v: string; l: string }[]; onChange: (v: string) => void }> = ({ value, options, onChange }) => (
  <select value={value} onChange={e => onChange(e.target.value)}
    style={{ width: "100%", padding: "5px 8px", borderRadius: 8, border: "1.5px solid #cbd5e1", fontSize: 11, color: "#0f172a", background: "white", cursor: "pointer" }}>
    {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
  </select>
);

const Divider = () => <div style={{ borderTop: "1px solid #f1f5f9", margin: "6px 0" }} />;

const ColSection: FC<{ title: string; open: boolean; onToggle: () => void; children: React.ReactNode; badge?: string }> = ({
  title, open, onToggle, children, badge,
}) => (
  <div>
    <button onClick={onToggle} style={{
      width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
      background: "none", border: "none", cursor: "pointer", padding: "5px 0", marginTop: 2,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>{title}</span>
        {badge && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "rgba(82,71,184,0.10)", color: ACCENT, fontWeight: 700 }}>{badge}</span>}
      </div>
      <span style={{ fontSize: 10, color: "#b0bac4" }}>{open ? "▲" : "▼"}</span>
    </button>
    {open && children}
  </div>
);

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  vegetation: VegetationOptions;
  onChange: (v: VegetationOptions) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const VegetationPanel: FC<Props> = ({ vegetation, onChange }) => {
  const upd = (patch: Partial<VegetationOptions>) => onChange({ ...vegetation, ...patch });

  const [open, setOpen] = useState<Record<string, boolean>>({
    haies_detail:   false,
    arbres_detail:  false,
    sol_detail:     false,
    ambiance:       false,
  });
  const tog = (id: string) => setOpen(p => ({ ...p, [id]: !p[id] }));

  const hasAnything = vegetation.showHedges || vegetation.showTrees || vegetation.showBushes;

  return (
    <div style={{ background: "white", borderRadius: 12, padding: 14, border: "1px solid #e2e8f0" }}>

      {/* ── Header ── */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 15 }}>🌿</span> Végétation
      </div>

      {/* ── Ambiance globale (NEW) ── */}
      <SLabel>Ambiance générale</SLabel>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {([
          { v: "minimal",  l: "Mineral" },
          { v: "standard", l: "Standard" },
          { v: "lush",     l: "Luxuriant" },
          { v: "jungle",   l: "Dense" },
        ] as const).map(o => (
          <button key={o.v} style={{ ...chip((vegetation.greenDensity ?? "standard") === o.v), flex: 1 }}
            onClick={() => upd({ greenDensity: o.v })}>{o.l}</button>
        ))}
      </div>

      {/* Saison globale */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>Saison</div>
        <div style={{ display: "flex", gap: 4 }}>
          {SEASONS.map(o => (
            <button key={o.v} style={{ ...chip((vegetation.season ?? "summer") === o.v), flex: 1, fontSize: 9 }}
              onClick={() => upd({ season: o.v })}>{o.l}</button>
          ))}
        </div>
      </div>

      {/* Entretien */}
      <Row label="Entretien">
        <Sel value={vegetation.maintenanceLevel ?? "maintained"} onChange={v => upd({ maintenanceLevel: v as any })} options={[
          { v: "wild",       l: "🌾 Sauvage" },
          { v: "natural",    l: "🌿 Naturel" },
          { v: "maintained", l: "✂ Entretenu" },
          { v: "formal",     l: "🏛 Formel" },
        ]} />
      </Row>

      <Divider />

      {/* ── HAIES ── */}
      <ToggleRow icon="🌱" label="Haies périmètre" checked={!!vegetation.showHedges} onChange={v => upd({ showHedges: v })} />
      {vegetation.showHedges && (
        <>
          <SliderRow label="Hauteur" min={0.5} max={3} step={0.1}
            value={vegetation.hedgeHeight ?? 1.2} unit="m"
            onChange={v => upd({ hedgeHeight: v })} />

          <ColSection title="Détail haies" badge="Blender" open={open.haies_detail} onToggle={() => tog('haies_detail')}>
            <Row label="Espèce">
              <Sel value={vegetation.hedgeSpecies ?? "buis"} onChange={v => upd({ hedgeSpecies: v as any })} options={[
                { v: "buis",    l: "Buis" },
                { v: "laurier", l: "Laurier" },
                { v: "charme",  l: "Charme" },
                { v: "thuya",   l: "Thuya" },
                { v: "bambou",  l: "Bambou" },
              ]} />
            </Row>
            <div style={{ padding: "0 0 4px 0" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>Densité</div>
              <ChipGroup value={vegetation.hedgeDensity ?? "medium"} onChange={v => upd({ hedgeDensity: v })} options={[
                { v: "sparse", l: "Clairsemée" }, { v: "medium", l: "Moyenne" }, { v: "dense", l: "Dense" },
              ]} />
            </div>
            <div style={{ paddingLeft: 0, marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "#475569" }}>Floraison</span>
                <Toggle checked={vegetation.hedgeFlowering ?? false} onChange={v => upd({ hedgeFlowering: v })} />
              </div>
            </div>
          </ColSection>
        </>
      )}

      <Divider />

      {/* ── ARBRES ── */}
      <ToggleRow icon="🌳" label="Arbres" checked={!!vegetation.showTrees} onChange={v => upd({ showTrees: v })} />
      {vegetation.showTrees && (
        <>
          {/* Type (existant) */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "4px 0 4px 20px" }}>
            {TREE_TYPES.map(t => (
              <button key={t.value}
                style={{ ...chip((vegetation.treeType ?? "deciduous") === t.value), display: "flex", alignItems: "center", gap: 3 }}
                onClick={() => upd({ treeType: t.value })}>
                <span style={{ fontSize: 13 }}>{t.icon}</span>
                <span style={{ fontSize: 10 }}>{t.label}</span>
              </button>
            ))}
          </div>

          <SliderRow label="Espacement" min={4} max={20} step={1}
            value={vegetation.treeSpacing ?? 8} unit="m"
            onChange={v => upd({ treeSpacing: v })} />

          <ColSection title="Détail arbres" badge="Blender" open={open.arbres_detail} onToggle={() => tog('arbres_detail')}>
            <SliderRow label="Hauteur" min={2} max={20} step={0.5}
              value={vegetation.treeHeightM ?? 6} unit="m"
              onChange={v => upd({ treeHeightM: v })} />
            <SliderRow label="Couronne" min={1} max={12} step={0.5}
              value={vegetation.treeCrownM ?? 4} unit="m"
              onChange={v => upd({ treeCrownM: v })} />
            <Row label="Nombre">
              <input type="number" min={0} max={100} value={vegetation.treeCount ?? 0}
                onChange={e => upd({ treeCount: Math.max(0, parseInt(e.target.value) || 0) })}
                style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 11, color: "#0f172a" }} />
            </Row>
            <div style={{ padding: "0 0 4px 0" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>Disposition</div>
              <ChipGroup value={vegetation.treeAlignment ?? "random"} onChange={v => upd({ treeAlignment: v })} options={[
                { v: "random",     l: "Aléatoire" },
                { v: "aligned",    l: "Aligné" },
                { v: "double_row", l: "Double rangée" },
              ]} />
            </div>
            <div style={{ padding: "0 0 4px 0" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>Feuillage (saison arbre)</div>
              <ChipGroup value={vegetation.treeSeason ?? "summer"} onChange={v => upd({ treeSeason: v })} options={[
                { v: "spring", l: "🌸" },
                { v: "summer", l: "☀" },
                { v: "autumn", l: "🍂" },
                { v: "winter", l: "❄" },
              ]} />
            </div>
            <Row label="Espèce">
              <input type="text" value={vegetation.treeSpecies ?? ""}
                placeholder="ex. Platane, Chêne…"
                onChange={e => upd({ treeSpecies: e.target.value })}
                style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 11, color: "#0f172a" }} />
            </Row>
          </ColSection>
        </>
      )}

      <Divider />

      {/* ── BUISSONS ── */}
      <ToggleRow icon="🌿" label="Buissons (angles)" checked={!!vegetation.showBushes} onChange={v => upd({ showBushes: v })} />

      <Divider />

      {/* ── SOL / TAPIS VÉGÉTAL (NEW) ── */}
      <ColSection title="🌾 Sol végétal" badge="Blender" open={open.sol_detail} onToggle={() => tog('sol_detail')}>
        <Row label="Tapis de sol">
          <Sel value={vegetation.groundCover ?? "none"} onChange={v => upd({ groundCover: v as any })} options={[
            { v: "none",        l: "Aucun" },
            { v: "grass_short", l: "🌿 Gazon ras" },
            { v: "grass_long",  l: "🌾 Herbe haute" },
            { v: "wildflower",  l: "🌼 Prairie fleurie" },
            { v: "moss",        l: "Mousse" },
          ]} />
        </Row>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
          {[
            { key: "plantingStrips",  label: "Bandes plantées" },
            { key: "flowerBeds",      label: "Massifs fleuris" },
            { key: "climbingPlants",  label: "Plantes grimpantes" },
          ].map(({ key, label }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, color: "#334155" }}>{label}</span>
              <Toggle checked={!!(vegetation as any)[key]} onChange={v => upd({ [key]: v } as any)} />
            </div>
          ))}
          {vegetation.climbingPlants && (
            <Row label="Espèce grimpante">
              <Sel value={vegetation.climbingSpecies ?? "lierre"} onChange={v => upd({ climbingSpecies: v as any })} options={[
                { v: "lierre",      l: "Lierre" },
                { v: "glycine",     l: "Glycine" },
                { v: "rosier",      l: "Rosier grimpant" },
                { v: "vigne_vierge", l: "Vigne vierge" },
              ]} />
            </Row>
          )}
        </div>
      </ColSection>

      {/* ── Résumé export ── */}
      {hasAnything && (
        <div style={{
          marginTop: 10, padding: "8px 10px", borderRadius: 8,
          background: "rgba(82,71,184,0.05)", border: "1px solid rgba(82,71,184,0.15)",
          fontSize: 10, color: "#64748b", lineHeight: 1.6,
        }}>
          <strong style={{ color: ACCENT }}>Export Blender</strong>
          {" · "}{vegetation.season ?? "summer"}
          {" · "}{vegetation.greenDensity ?? "standard"}
          {" · "}{vegetation.maintenanceLevel ?? "maintained"}
          {vegetation.showHedges && ` · haie ${vegetation.hedgeSpecies ?? "buis"} ${(vegetation.hedgeHeight ?? 1.2).toFixed(1)}m`}
          {vegetation.showTrees && ` · ${vegetation.treeType} ×${vegetation.treeCount ?? "auto"}`}
          {vegetation.groundCover && vegetation.groundCover !== "none" && ` · ${vegetation.groundCover}`}
        </div>
      )}
    </div>
  );
};