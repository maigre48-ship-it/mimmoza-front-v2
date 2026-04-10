// BuildingPropertiesPanel.tsx
// Panneau propriétés du bâtiment sélectionné — v2 avec contrat BuildingBlenderSpec

import React, { type FC, useMemo, useState } from "react";
import type {
  MassingBuildingModel, BuildingLevels, BuildingTransform,
  BuildingStyleOptions, RoofStyle, BuildingTemplateType, EditorTool,
} from "../massingScene.types";
import { totalHeightM, totalLevelsCount, BUILDING_TEMPLATES } from "../massingScene.types";
import { getTexturePresetsByFamily } from "../massingTextureFactory";
import { FACADE_STYLE_OPTIONS } from "../massingFacadeStyles";
import type { BuildingBlenderSpec } from "./buildingBlenderSpec.types";
import { ensureBuildingRenderSpec } from "../buildingBlenderSpec.helpers";

const ACCENT = "#5247b8";
type SpecSection = Exclude<keyof BuildingBlenderSpec, 'version'>;

// ─── Palettes ─────────────────────────────────────────────────────────────────

const FACADE_COLORS: { value: string; label: string }[] = [
  { value:"#EDE8DA",label:"Pierre claire"  },{ value:"#E0D8C4",label:"Pierre beige" },
  { value:"#D4C9AE",label:"Pierre dorée"   },{ value:"#C5B99A",label:"Pierre sablée"},
  { value:"#D8D5CF",label:"Béton clair"    },{ value:"#B8B5B0",label:"Béton gris"   },
  { value:"#F0EDE8",label:"Enduit blanc"   },{ value:"#E8E2D4",label:"Enduit crème" },
  { value:"#C0624A",label:"Brique rouge"   },{ value:"#B05540",label:"Brique foncée"},
  { value:"#D4886A",label:"Brique saumon"  },{ value:"#8B4A3A",label:"Brique brune" },
  { value:"#6E7A82",label:"Zinc bleuté"    },{ value:"#8A9298",label:"Zinc clair"   },
  { value:"#4A5560",label:"Zinc sombre"    },{ value:"#374151",label:"Anthracite"   },
  { value:"#A0734E",label:"Bois naturel"   },{ value:"#7A5535",label:"Bois foncé"   },
  { value:"#C89060",label:"Bois clair"     },{ value:"#3D2B1A",label:"Bois brûlé"   },
  { value:"#CDD8E8",label:"Bleu verre"     },{ value:"#E8EFF5",label:"Blanc laqué"  },
  { value:"#2C3E50",label:"Bleu nuit"      },{ value:"#1E4D2B",label:"Vert forêt"   },
];

const STRUCT_COLORS = [
  { value:"#1c1917",label:"Noir"        },{ value:"#374151",label:"Anthracite" },
  { value:"#64748b",label:"Gris acier"  },{ value:"#b5bdc9",label:"Gris clair" },
  { value:"#1e3a5f",label:"Bleu nuit"   },{ value:"#1e4d2b",label:"Vert foncé" },
  { value:"#7c3d12",label:"Terracotta"  },{ value:"#f5f5f4",label:"Blanc cassé"},
];

const GLASS_COLORS = [
  { value:"#0d1b2a",label:"Verre nuit"      },{ value:"#1b2838",label:"Verre bleu foncé"},
  { value:"#2A3540",label:"Verre ardoise"   },{ value:"#1e3a5f",label:"Verre bleu"      },
  { value:"#263340",label:"Verre gris bleu" },{ value:"#334155",label:"Verre gris foncé"},
  { value:"#475569",label:"Verre gris"      },{ value:"#b0c4d8",label:"Verre ciel"      },
  { value:"#c8dce8",label:"Verre pâle"      },{ value:"#e8f4f8",label:"Verre blanc"     },
  { value:"#1a2e1a",label:"Verre vert foncé"},{ value:"#2d4a2d",label:"Verre vert"      },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

const SLabel: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize:10, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5, marginTop:10 }}>
    {children}
  </div>
);

const Row: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:6 }}>
    <span style={{ fontSize:11, color:"#475569", flexShrink:0 }}>{label}</span>
    <div style={{ flex:1, minWidth:0 }}>{children}</div>
  </div>
);

const NumInput: FC<{ value:number; min?:number; max?:number; step?:number; unit?:string; onChange:(v:number)=>void }> = ({ value, min, max, step=1, unit, onChange }) => (
  <div style={{ display:"flex", alignItems:"center", gap:4 }}>
    <input type="number" value={value} min={min} max={max} step={step}
      onChange={e=>{ const v=parseFloat(e.target.value); if(Number.isFinite(v))onChange(v); }}
      style={{ width:"100%", padding:"4px 6px", borderRadius:6, border:"1px solid #cbd5e1", fontSize:11, fontVariantNumeric:"tabular-nums", color:"#0f172a", background:"white" }}
    />
    {unit&&<span style={{ fontSize:10, color:"#94a3b8", flexShrink:0 }}>{unit}</span>}
  </div>
);

const Divider = () => <div style={{ borderTop:"1px solid #f1f5f9", margin:"8px 0" }} />;

const ColorSwatch: FC<{ color:string; label:string; active:boolean; size?:number; onClick:()=>void }> = ({ color, label, active, size=22, onClick }) => (
  <button title={label} onClick={onClick} style={{
    width:size, height:size, borderRadius:"50%", background:color, cursor:"pointer", flexShrink:0,
    border:active?`2.5px solid ${ACCENT}`:"2px solid rgba(0,0,0,0.12)",
    boxShadow:active?`0 0 0 2px rgba(82,71,184,0.30),inset 0 0 0 1px rgba(255,255,255,0.4)`:"inset 0 0 0 1px rgba(255,255,255,0.25)",
    outline:"none", padding:0, transition:"transform .10s, box-shadow .10s",
    transform:active?"scale(1.15)":"scale(1)",
  }} />
);

const chip = (active:boolean): React.CSSProperties => ({
  padding:"4px 8px", borderRadius:6, cursor:"pointer", fontSize:10, fontWeight:600,
  border:active?`1.5px solid ${ACCENT}`:"1.5px solid #e2e8f0",
  background:active?`rgba(82,71,184,0.08)`:"white",
  color:active?ACCENT:"#475569", transition:"all .10s",
});

const toggle = (val:boolean): React.CSSProperties => ({
  width:32, height:18, borderRadius:9, position:"relative", cursor:"pointer", border:"none",
  background:val?ACCENT:"#cbd5e1", transition:"background .15s", flexShrink:0, padding:0,
});

const ToolBtn: FC<{ icon:string; label:string; active:boolean; onClick:()=>void; color?:string }> = ({ icon, label, active, onClick, color=ACCENT }) => (
  <button onClick={onClick} style={{
    flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3,
    padding:"8px 4px", borderRadius:8, cursor:"pointer",
    border:active?`1.5px solid ${color}`:"1.5px solid #e2e8f0",
    background:active?`rgba(82,71,184,0.09)`:"white", transition:"all .12s",
  }}>
    <span style={{ fontSize:18 }}>{icon}</span>
    <span style={{ fontSize:9, fontWeight:600, color:active?color:"#475569" }}>{label}</span>
  </button>
);

const ROOF_OPTS: { value:RoofStyle; label:string; emoji:string }[] = [
  { value:"terrasse",   label:"Terrasse",    emoji:"⬜" },
  { value:"vegetalise", label:"Végétalisée", emoji:"🌿" },
  { value:"inclinee",   label:"Inclinée",    emoji:"🏠" },
];

const StepBtn: FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button onClick={onClick} style={{
    width: 22, height: 22, borderRadius: 5, flexShrink: 0,
    border: "1.5px solid #e2e8f0", background: "white",
    color: "#475569", fontSize: 14, lineHeight: 1,
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 600, padding: 0, transition: "background .10s, border-color .10s",
  }}
    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `rgba(82,71,184,0.08)`; (e.currentTarget as HTMLButtonElement).style.borderColor = ACCENT; }}
    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "white"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#e2e8f0"; }}
  >
    {label}
  </button>
);

const SliderRow: FC<{
  label:string; value:number; min:number; max:number; step:number;
  displayValue:string; onChange:(v:number)=>void;
}> = ({ label, value, min, max, step, displayValue, onChange }) => {
  const dec = () => onChange(Math.max(min, parseFloat((value - step).toFixed(10))));
  const inc = () => onChange(Math.min(max, parseFloat((value + step).toFixed(10))));
  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
        <span style={{ fontSize:11, color:"#475569" }}>{label}</span>
        <span style={{ fontSize:11, fontWeight:600, color:ACCENT, minWidth:42, textAlign:"right" }}>{displayValue}</span>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:5 }}>
        <StepBtn label="−" onClick={dec} />
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ flex:1, accentColor:ACCENT, cursor:"pointer" }} />
        <StepBtn label="+" onClick={inc} />
      </div>
    </div>
  );
};

/** Section repliable légère — uniquement pour les sections Blender */
const ColSection: FC<{ title:string; open:boolean; onToggle:()=>void; children:React.ReactNode; badge?:string }> = ({ title, open, onToggle, children, badge }) => (
  <div>
    <button onClick={onToggle} style={{
      width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center",
      background:"none", border:"none", cursor:"pointer", padding:"6px 0", marginTop:4,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
        <span style={{ fontSize:10, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.08em" }}>{title}</span>
        {badge && <span style={{ fontSize:9, padding:"1px 6px", borderRadius:10, background:"rgba(82,71,184,0.10)", color:ACCENT, fontWeight:700 }}>{badge}</span>}
      </div>
      <span style={{ fontSize:10, color:"#b0bac4" }}>{open ? "▲" : "▼"}</span>
    </button>
    {open && children}
  </div>
);

/** Toggle row réutilisable */
const ToggleRow: FC<{ label:string; value:boolean; onChange:(v:boolean)=>void }> = ({ label, value, onChange }) => (
  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
    <span style={{ fontSize:11, color:"#334155" }}>{label}</span>
    <button style={toggle(value)} onClick={() => onChange(!value)}>
      <div style={{ position:"absolute", top:2, left:value?14:2, width:14, height:14, borderRadius:"50%", background:"white", transition:"left .15s" }} />
    </button>
  </div>
);

/** Select réutilisable compact */
const Sel: FC<{ value:string; options:{v:string;l:string}[]; onChange:(v:string)=>void }> = ({ value, options, onChange }) => (
  <select value={value} onChange={e => onChange(e.target.value)}
    style={{ width:"100%", padding:"6px 8px", borderRadius:8, border:"1.5px solid #cbd5e1", fontSize:11, color:"#0f172a", background:"white", cursor:"pointer" }}>
    {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
  </select>
);

/** Chips horizontaux — liste de {v, l} options */
function ChipRow<T extends string>({ value, options, onChange, wrap }: {
  value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; wrap?: boolean;
}) {
  return (
    <div style={{ display:"flex", gap:4, flexWrap:wrap?"wrap":"nowrap", marginBottom:6 }}>
      {options.map(o => (
        <button key={o.v} style={{ ...chip(value === o.v), flex:wrap?"0 0 auto":"1" }} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

const STYLE_ICONS: Record<string, string> = {
  residential_modern: "🏢", residential_brique: "🧱", residential_pierre: "🏛",
  modern_glass: "🪟",       urban_mixed: "🏬",         minimal_white: "◻️",
};

// ─── Main panel ───────────────────────────────────────────────────────────────

interface Props {
  building:              MassingBuildingModel;
  activeTool:            EditorTool;
  onUpdateLevels:        (patch: Partial<BuildingLevels>) => void;
  onUpdateTransform:     (patch: Partial<BuildingTransform>) => void;
  onUpdateStyle:         (patch: Partial<BuildingStyleOptions>) => void;
  onUpdateName:          (name: string) => void;
  onUpdateRenderSpec:    (spec: BuildingBlenderSpec) => void;
  onDelete:              () => void;
  onDuplicate:           () => void;
  onApplyTemplate:       (type: BuildingTemplateType) => void;
  onSetTool:             (tool: EditorTool) => void;
}

export const BuildingPropertiesPanel: FC<Props> = ({
  building, activeTool,
  onUpdateLevels, onUpdateTransform, onUpdateStyle, onUpdateName,
  onUpdateRenderSpec,
  onDelete, onDuplicate, onApplyTemplate, onSetTool,
}) => {
  const { levels, transform, style } = building;
  const hTotal  = totalHeightM(levels);
  const nLevels = totalLevelsCount(levels);

  // Existing style helpers
  const up = (patch: Partial<BuildingStyleOptions>) => onUpdateStyle(patch);

  // BuildingBlenderSpec — dérivé paresseusement, jamais null
  const spec = useMemo(() => ensureBuildingRenderSpec(building), [building]);

  // Patch ciblé sur une section du spec
  const upSpec = (section: SpecSection, patch: Record<string, unknown>) => {
    onUpdateRenderSpec({
      ...spec,
      [section]: { ...(spec[section] as Record<string, unknown>), ...patch },
    } as BuildingBlenderSpec);
  };

  // Section collapsibles (seulement pour les nouvelles sections Blender)
  const [open, setOpen] = useState<Record<string, boolean>>({
    morpho_avance:  false,
    facade_detail:  false,
    roof_detail:    false,
    paysage:        false,
    blender_render: true,
  });
  const tog = (id: string) => setOpen(p => ({ ...p, [id]: !p[id] }));

  // Facade aliases
  const facadeColor           = style.facadeColor           ?? FACADE_COLORS[0].value;
  const facadeTextureId       = style.facadeTextureId        ?? "concrete/concrete047a";
  const roofTextureId         = style.roofTextureId          ?? "roof/roofingtiles014a";
  const facadeTextureRotation = style.facadeTextureRotation  ?? 0;
  const facadeTextureScale    = style.facadeTextureScale      ?? 1;
  const glassColor            = style.glassColor             ?? "#2A3540";
  const glassOpacity          = style.glassOpacity           ?? 0.80;
  const facadeStyleId         = style.facadeStyleId          ?? "";

  const facadeTextureOptions = [
    ...getTexturePresetsByFamily("brick"),
    ...getTexturePresetsByFamily("concrete"),
    ...getTexturePresetsByFamily("wood"),
    ...getTexturePresetsByFamily("procedural").filter(p =>
      ["procedural/wood_default","procedural/concrete_default","procedural/brick_default"].includes(p.id)
    ),
  ];
  const roofTextureOptions = getTexturePresetsByFamily("roof");

  const zoomLabel = (() => {
    const v = 1 / facadeTextureScale;
    return `×${v < 1 ? v.toFixed(2) : v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}`;
  })();

  return (
    <div style={{ background:"white", borderRadius:12, padding:14, border:"1px solid #e2e8f0", boxShadow:"0 1px 3px rgba(0,0,0,0.05)" }}>

      {/* ── Modèle ── */}
      <SLabel>Modèle de bâtiment</SLabel>
      <select defaultValue="" onChange={e=>{ if(e.target.value){onApplyTemplate(e.target.value as BuildingTemplateType);e.target.value="";} }}
        style={{ width:"100%", padding:"7px 8px", borderRadius:8, border:"1.5px solid #e2e8f0", fontSize:11, fontWeight:600, color:"#374151", background:"white", cursor:"pointer", marginBottom:10, appearance:"auto" }}>
        <option value="" disabled>Appliquer un modèle…</option>
        {Object.values(BUILDING_TEMPLATES).map(t=><option key={t.type} value={t.type}>{t.label}</option>)}
      </select>

      {/* ── Identité bâtiment (NEW) ── */}
      <SLabel>Identité</SLabel>
      <Row label="Usage">
        <Sel value={spec.identity.usage} onChange={v => upSpec('identity', { usage: v })} options={[
          {v:'logement_collectif', l:'Logement collectif'},
          {v:'tertiaire',          l:'Bureaux / Tertiaire'},
          {v:'mixte',              l:'Mixte'},
          {v:'hotel',              l:'Hôtel'},
          {v:'residence_senior',   l:'Résidence senior'},
          {v:'commerce_logement',  l:'Commerce + logement'},
        ]} />
      </Row>
      <div style={{ marginBottom:6 }}>
        <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Standing</div>
        <ChipRow value={spec.identity.standing} onChange={v => upSpec('identity', { standing: v })} options={[
          {v:'economique', l:'Éco.'}, {v:'standard', l:'Std'},
          {v:'premium',    l:'Prem.'},{v:'prestige',  l:'Prest.'},
        ]} />
      </div>

      {/* ── Nom ── */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8, marginBottom:10 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <input value={building.name} onChange={e=>onUpdateName(e.target.value)}
            style={{ width:"100%", fontSize:12, fontWeight:700, color:"#0f172a", border:"none", borderBottom:"1px solid #e2e8f0", background:"transparent", paddingBottom:3, outline:"none" }} />
          <div style={{ fontSize:10, color:"#94a3b8", marginTop:2 }}>
            {hTotal.toFixed(1)} m · {nLevels} niveaux
            {building.meta?.footprintM2 ? ` · ${building.meta.footprintM2.toLocaleString("fr-FR")} m² emprise` : ""}
          </div>
        </div>
        <div style={{ display:"flex", gap:4 }}>
          <button onClick={onDuplicate} title="Dupliquer" style={{ padding:"4px 8px", borderRadius:6, border:"1px solid #e2e8f0", background:"white", cursor:"pointer", fontSize:14 }}>⧉</button>
          <button onClick={onDelete}    title="Supprimer" style={{ padding:"4px 8px", borderRadius:6, border:"1px solid rgba(239,68,68,0.3)", background:"rgba(239,68,68,0.05)", color:"#dc2626", cursor:"pointer", fontSize:14 }}>🗑</button>
        </div>
      </div>

      <Divider />

      {/* ── Niveaux ── */}
      <SLabel>Niveaux</SLabel>
      <Row label="Étages (R+N)">
        <NumInput value={levels.aboveGroundFloors} min={0} max={50}
          onChange={v=>onUpdateLevels({aboveGroundFloors:Math.max(0,Math.round(v))})} />
      </Row>
      <Row label="Hauteur RDC">
        <NumInput value={levels.groundFloorHeightM} min={2} max={8} step={0.1} unit="m"
          onChange={v=>onUpdateLevels({groundFloorHeightM:Math.max(2,v)})} />
      </Row>
      <Row label="Hauteur étage">
        <NumInput value={levels.typicalFloorHeightM} min={2} max={6} step={0.1} unit="m"
          onChange={v=>onUpdateLevels({typicalFloorHeightM:Math.max(2,v)})} />
      </Row>

      {/* Socle RDC (NEW) */}
      <Row label="Socle RDC">
        <div style={{ display:"flex", gap:4 }}>
          {([{v:'none',l:'—'},{v:'hall',l:'Hall'},{v:'retail',l:'Commerce'},{v:'office',l:'Bureau'}] as const).map(o => (
            <button key={o.v} style={{ ...chip(spec.morphology.groundFloorType === o.v), flex:1, padding:"4px 2px" }}
              onClick={() => upSpec('morphology', { groundFloorType: o.v })}>{o.l}</button>
          ))}
        </div>
      </Row>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 8px", borderRadius:7, background:`rgba(82,71,184,0.06)`, border:`1px solid rgba(82,71,184,0.15)`, marginBottom:4 }}>
        <span style={{ fontSize:11, color:"#475569" }}>Hauteur totale</span>
        <span style={{ fontSize:12, fontWeight:700, color:ACCENT }}>{hTotal.toFixed(1)} m</span>
      </div>

      <Divider />

      {/* ── Position ── */}
      <SLabel>Position (décalage scène)</SLabel>
      <Row label="Décalage X"><NumInput value={parseFloat(transform.offsetX.toFixed(1))} step={1} unit="u" onChange={v=>onUpdateTransform({offsetX:v})} /></Row>
      <Row label="Décalage Y"><NumInput value={parseFloat(transform.offsetY.toFixed(1))} step={1} unit="u" onChange={v=>onUpdateTransform({offsetY:v})} /></Row>
      <Row label="Rotation">
        <NumInput value={parseFloat((transform.rotationRad*180/Math.PI).toFixed(1))} min={-180} max={180} step={5} unit="°"
          onChange={v=>onUpdateTransform({rotationRad:v*Math.PI/180})} />
      </Row>

      {/* ── Morphologie avancée (collapsible, NEW) ── */}
      <ColSection title="Morphologie avancée" badge="Blender" open={open.morpho_avance} onToggle={() => tog('morpho_avance')}>
        {spec.morphology.setbacksCount > 0 && (
          <Row label="Profondeur retraits">
            <NumInput value={spec.morphology.setbackDepthM ?? 2} min={0.5} max={6} step={0.5} unit="m"
              onChange={v => upSpec('morphology', { setbackDepthM: v })} />
          </Row>
        )}
        <Row label="Hauteur attique">
          <NumInput value={spec.morphology.atticHeightM ?? 0} min={0} max={4} step={0.1} unit="m"
            onChange={v => upSpec('morphology', { atticHeightM: v > 0 ? v : undefined })} />
        </Row>
        {style.hasBalconies && (<>
          <Row label="Prof. balcons">
            <NumInput value={spec.morphology.balconyDepthM ?? 1.2} min={0.6} max={2.5} step={0.1} unit="m"
              onChange={v => upSpec('morphology', { balconyDepthM: v })} />
          </Row>
          <div style={{ marginBottom:6 }}>
            <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Type balcon</div>
            <ChipRow value={spec.morphology.balconyType ?? 'filant'} onChange={v => upSpec('morphology', { balconyType: v })} options={[
              {v:'filant',l:'Filant'},{v:'ponctuel',l:'Ponctuel'},{v:'loggia',l:'Loggia'},
            ]} />
          </div>
        </>)}
      </ColSection>

      <Divider />

      {/* ── Style architectural ── */}
      <SLabel>Style architectural</SLabel>
      <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:8 }}>
        {FACADE_STYLE_OPTIONS.map(opt => {
          const active = facadeStyleId === opt.value;
          return (
            <button key={opt.value} onClick={() => up({ facadeStyleId: opt.value })} style={{
              padding:"6px 10px", borderRadius:8, cursor:"pointer", fontSize:10, fontWeight:600,
              border:active?`1.5px solid ${ACCENT}`:"1.5px solid #e2e8f0",
              background:active?`rgba(82,71,184,0.08)`:"white", color:active?ACCENT:"#475569",
              transition:"all .10s", display:"flex", alignItems:"center", gap:4,
            }}>
              <span style={{ fontSize:14 }}>{STYLE_ICONS[opt.value] ?? "🏗"}</span>
              {opt.label}
            </button>
          );
        })}
      </div>

      <Divider />

      {/* ── Façade couleur ── */}
      <SLabel>Façade</SLabel>

      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
        <div style={{ width:32, height:32, borderRadius:7, flexShrink:0, background:facadeColor, border:"1.5px solid rgba(0,0,0,0.12)", boxShadow:"inset 0 0 0 1px rgba(255,255,255,0.3)" }} />
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:"#0f172a" }}>{FACADE_COLORS.find(c=>c.value===facadeColor)?.label??"Personnalisée"}</div>
          <div style={{ fontSize:10, color:"#94a3b8" }}>{facadeColor.toUpperCase()}</div>
        </div>
        <input type="color" value={facadeColor} onChange={e=>up({facadeColor:e.target.value})} title="Couleur personnalisée"
          style={{ marginLeft:"auto", width:28, height:28, borderRadius:6, border:"1.5px solid #e2e8f0", cursor:"pointer", padding:1, background:"white" }} />
      </div>

      {[
        { label:"Pierre / calcaire", range:[0,4]   as [number,number] },
        { label:"Béton / enduit",    range:[4,8]   as [number,number] },
        { label:"Brique",            range:[8,12]  as [number,number] },
        { label:"Zinc / métal",      range:[12,16] as [number,number] },
        { label:"Bois / bardage",    range:[16,20] as [number,number] },
        { label:"Contemporain",      range:[20,24] as [number,number] },
      ].map(({ label, range }) => (
        <div key={label} style={{ marginBottom:6 }}>
          <div style={{ fontSize:9, color:"#b0b8c4", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>{label}</div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {FACADE_COLORS.slice(range[0], range[1]).map(c=>(
              <ColorSwatch key={c.value} color={c.value} label={c.label} active={facadeColor===c.value} onClick={()=>up({facadeColor:c.value})} />
            ))}
          </div>
        </div>
      ))}

      <Row label="Texture façade">
        <select value={facadeTextureId} onChange={e=>up({facadeTextureId:e.target.value})}
          style={{ width:"100%", padding:"6px 8px", borderRadius:8, border:"1.5px solid #cbd5e1", fontSize:11, color:"#0f172a", background:"white", cursor:"pointer" }}>
          {facadeTextureOptions.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Row>

      <SliderRow label="Inclinaison texture" value={facadeTextureRotation} min={-180} max={180} step={1}
        displayValue={`${facadeTextureRotation > 0 ? "+" : ""}${facadeTextureRotation}°`}
        onChange={v => up({ facadeTextureRotation: v })} />
      <SliderRow label="Zoom texture" value={facadeTextureScale} min={0.25} max={4} step={0.05}
        displayValue={zoomLabel} onChange={v => up({ facadeTextureScale: parseFloat(v.toFixed(2)) })} />

      <Row label={`Vitrage ${Math.round(style.windowRatio*100)}%`}>
        <input type="range" min={0.25} max={0.90} step={0.05} value={style.windowRatio}
          onChange={e=>up({windowRatio:parseFloat(e.target.value)})}
          style={{ width:"100%", accentColor:ACCENT, cursor:"pointer" }} />
      </Row>
      <Row label={`Travée ${style.bayWidthM.toFixed(1)} m`}>
        <input type="range" min={2.0} max={6.0} step={0.5} value={style.bayWidthM}
          onChange={e=>up({bayWidthM:parseFloat(e.target.value)})}
          style={{ width:"100%", accentColor:ACCENT, cursor:"pointer" }} />
      </Row>

      {/* ── Façade détail (collapsible, NEW) ── */}
      <ColSection title="Façade — détail architectural" badge="Blender" open={open.facade_detail} onToggle={() => tog('facade_detail')}>
        <div style={{ marginBottom:6 }}>
          <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Famille de matériau</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
            {([
              {v:'enduit',l:'Enduit'},{v:'beton',l:'Béton'},{v:'brique',l:'Brique'},
              {v:'pierre',l:'Pierre'},{v:'zinc_metal',l:'Zinc'},{v:'bois_bardage',l:'Bois'},{v:'mur_rideau',l:'Mur rideau'},
            ] as const).map(o => (
              <button key={o.v} style={{ ...chip(spec.facade.family === o.v) }}
                onClick={() => upSpec('facade', { family: o.v })}>{o.l}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom:6 }}>
          <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Relief façade</div>
          <ChipRow value={spec.facade.reliefLevel} onChange={v => upSpec('facade', { reliefLevel: v })} options={[
            {v:'flat',l:'Plat'},{v:'light',l:'Léger'},{v:'marked',l:'Marqué'},
          ]} />
        </div>
        <Row label="Modénature">
          <Sel value={spec.facade.modulationType} onChange={v => upSpec('facade', { modulationType: v })} options={[
            {v:'none',l:'Aucune'},{v:'horizontal_bands',l:'Bandes horiz.'},{v:'vertical_rhythm',l:'Rythme vert.'},
            {v:'framed_openings',l:'Encadrements'},{v:'cornice',l:'Corniche'},
          ]} />
        </Row>
        <div style={{ marginBottom:6 }}>
          <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Type d'ouverture</div>
          <ChipRow value={spec.facade.openingType} onChange={v => upSpec('facade', { openingType: v })} options={[
            {v:'window',l:'Fenêtre'},{v:'french_window',l:'Porte-fen.'},{v:'sliding',l:'Coulissant'},{v:'curtain_wall',l:'Mur rideau'},
          ]} wrap />
        </div>
        <div style={{ marginBottom:6 }}>
          <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Rythme d'ouverture</div>
          <ChipRow value={spec.facade.openingRhythm} onChange={v => upSpec('facade', { openingRhythm: v })} options={[
            {v:'regular',l:'Régulier'},{v:'alternating',l:'Alternance'},{v:'vertical',l:'Vertical'},{v:'mixed',l:'Mixte'},
          ]} wrap />
        </div>
        <Row label="Couleur menuiseries">
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:20, height:20, borderRadius:4, background:spec.facade.frameColor??'#374151', border:"1.5px solid rgba(0,0,0,0.12)", flexShrink:0 }} />
            <input type="color" value={spec.facade.frameColor??'#374151'}
              onChange={e => upSpec('facade', { frameColor: e.target.value })}
              style={{ width:24, height:24, borderRadius:5, border:"1.5px solid #e2e8f0", cursor:"pointer", padding:1 }} />
            <span style={{ fontSize:10, color:"#94a3b8" }}>{(spec.facade.frameColor??'#374151').toUpperCase()}</span>
          </div>
        </Row>
        <div style={{ marginBottom:6 }}>
          <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Profondeur cadres</div>
          <ChipRow value={spec.facade.frameDepth??'standard'} onChange={v => upSpec('facade', { frameDepth: v })} options={[
            {v:'thin',l:'Fin'},{v:'standard',l:'Standard'},{v:'strong',l:'Fort'},
          ]} />
        </div>
        <div style={{ marginBottom:6 }}>
          <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Type garde-corps</div>
          <ChipRow value={spec.facade.railingType??'metal'} onChange={v => upSpec('facade', { railingType: v })} options={[
            {v:'metal',l:'Métal'},{v:'glass',l:'Verre'},{v:'masonry',l:'Maçonnerie'},
          ]} />
        </div>
        <Row label="Couleur garde-corps">
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:20, height:20, borderRadius:4, background:spec.facade.railingColor??'#374151', border:"1.5px solid rgba(0,0,0,0.12)", flexShrink:0 }} />
            <input type="color" value={spec.facade.railingColor??'#374151'}
              onChange={e => upSpec('facade', { railingColor: e.target.value })}
              style={{ width:24, height:24, borderRadius:5, border:"1.5px solid #e2e8f0", cursor:"pointer", padding:1 }} />
          </div>
        </Row>
      </ColSection>

      <Divider />

      {/* ── Vitrage ── */}
      <SLabel>Vitrage</SLabel>
      <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:6 }}>
        {GLASS_COLORS.map(c=>(
          <ColorSwatch key={c.value} color={c.value} label={c.label} active={glassColor===c.value} size={20} onClick={()=>up({glassColor:c.value})} />
        ))}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
        <input type="color" value={glassColor} onChange={e=>up({glassColor:e.target.value})} title="Couleur vitrage personnalisée"
          style={{ width:24, height:24, borderRadius:5, border:"1.5px solid #e2e8f0", cursor:"pointer", padding:1, background:"white", flexShrink:0 }} />
        <span style={{ fontSize:10, color:"#94a3b8", flex:1 }}>{glassColor.toUpperCase()}</span>
      </div>
      <SliderRow label="Opacité vitrage" value={glassOpacity} min={0.10} max={1.0} step={0.05}
        displayValue={`${Math.round(glassOpacity*100)}%`}
        onChange={v => up({ glassOpacity: parseFloat(v.toFixed(2)) })} />

      <Divider />

      {/* ── Toiture ── */}
      <SLabel>Toiture</SLabel>
      <div style={{ display:"flex", gap:4, marginBottom:6 }}>
        {ROOF_OPTS.map(o=>(
          <button key={o.value} style={{ ...chip(style.roof===o.value), flex:1 }} onClick={()=>up({roof:o.value})}>
            {o.emoji} {o.label}
          </button>
        ))}
      </div>
      <Row label="Texture toiture">
        <select value={roofTextureId} onChange={e=>up({roofTextureId:e.target.value})}
          style={{ width:"100%", padding:"6px 8px", borderRadius:8, border:"1.5px solid #cbd5e1", fontSize:11, color:"#0f172a", background:"white", cursor:"pointer" }}>
          {roofTextureOptions.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Row>

      {style.roof==="inclinee"&&(
        <>
          <SLabel>Nombre de pentes</SLabel>
          <div style={{ display:"flex", gap:4, marginBottom:6 }}>
            {[{v:1,label:"1 pente",desc:"Shed"},{v:2,label:"2 pentes",desc:"Pignon"},{v:4,label:"4 pentes",desc:"Croupe"}].map(({v,label,desc})=>{
              const active=(style.roofSlopes??2)===v;
              return(
                <button key={v} title={desc} onClick={()=>up({roofSlopes:v as 1|2|4})}
                  style={{ flex:1, padding:"6px 4px", borderRadius:8, cursor:"pointer", border:active?`1.5px solid ${ACCENT}`:"1.5px solid #e2e8f0", background:active?`rgba(82,71,184,0.09)`:"white", display:"flex", flexDirection:"column", alignItems:"center", gap:2, transition:"all .10s" }}>
                  <svg width="32" height="18" viewBox="0 0 32 18" fill="none">
                    {v===1&&<><rect x="2" y="12" width="28" height="4" fill={active?ACCENT:"#e2e8f0"} rx="1"/><polygon points="2,12 30,4 30,12" fill={active?ACCENT:"#94a3b8"} opacity="0.7"/></>}
                    {v===2&&<><rect x="2" y="12" width="28" height="4" fill={active?ACCENT:"#e2e8f0"} rx="1"/><polygon points="2,12 16,3 30,12" fill={active?ACCENT:"#94a3b8"} opacity="0.7"/></>}
                    {v===4&&<><rect x="2" y="12" width="28" height="4" fill={active?ACCENT:"#e2e8f0"} rx="1"/><polygon points="2,12 16,3 30,12" fill={active?ACCENT:"#94a3b8"} opacity="0.7"/><polygon points="2,12 8,12 16,3" fill={active?"#1e3a8a":"#64748b"} opacity="0.35"/><polygon points="30,12 24,12 16,3" fill={active?"#1e3a8a":"#64748b"} opacity="0.35"/></>}
                  </svg>
                  <span style={{ fontSize:10, fontWeight:600, color:active?ACCENT:"#475569" }}>{label}</span>
                  <span style={{ fontSize:9, color:"#94a3b8" }}>{desc}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ── Toiture détail (collapsible, NEW) ── */}
      <ColSection title="Toiture — détail" badge="Blender" open={open.roof_detail} onToggle={() => tog('roof_detail')}>
        <Row label="Couleur toiture">
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:20, height:20, borderRadius:4, background:spec.roof.roofColor??'#8A8278', border:"1.5px solid rgba(0,0,0,0.12)", flexShrink:0 }} />
            <input type="color" value={spec.roof.roofColor??'#8A8278'}
              onChange={e => upSpec('roof', { roofColor: e.target.value })}
              style={{ width:24, height:24, borderRadius:5, border:"1.5px solid #e2e8f0", cursor:"pointer", padding:1 }} />
            <span style={{ fontSize:10, color:"#94a3b8" }}>{(spec.roof.roofColor??'#8A8278').toUpperCase()}</span>
          </div>
        </Row>
        <Row label="Couronnement">
          <Sel value={spec.roof.crownType} onChange={v => upSpec('roof', { crownType: v })} options={[
            {v:'neutral',l:'Neutre'},{v:'thin_parapet',l:'Acrotère fin'},
            {v:'thick_parapet',l:'Acrotère épais'},{v:'attic_marked',l:'Attique marqué'},{v:'cornice',l:'Corniche'},
          ]} />
        </Row>
        <ToggleRow label="Volumes techniques visibles" value={spec.roof.technicalVolumesVisible}
          onChange={v => upSpec('roof', { technicalVolumesVisible: v })} />
        <ToggleRow label="Panneaux solaires" value={spec.roof.solarPanels}
          onChange={v => upSpec('roof', { solarPanels: v })} />
        {style.roof === 'vegetalise' && (
          <div style={{ marginBottom:6 }}>
            <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Intensité végétalisation</div>
            <ChipRow value={spec.roof.vegetationLevel??'medium'} onChange={v => upSpec('roof', { vegetationLevel: v })} options={[
              {v:'low',l:'Faible'},{v:'medium',l:'Moyenne'},{v:'high',l:'Dense'},
            ]} />
          </div>
        )}
        <div style={{ marginBottom:6 }}>
          <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Garde-corps toit</div>
          <ChipRow value={spec.roof.roofRailing??'discreet'} onChange={v => upSpec('roof', { roofRailing: v })} options={[
            {v:'none',l:'Aucun'},{v:'discreet',l:'Discret'},{v:'visible',l:'Visible'},
          ]} />
        </div>
      </ColSection>

      {/* ── Structure ── */}
      <SLabel>Couleur structure</SLabel>
      <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:6 }}>
        {STRUCT_COLORS.map(c=>(
          <ColorSwatch key={c.value} color={c.value} label={c.label} active={style.structureColor===c.value} size={24} onClick={()=>up({structureColor:c.value})} />
        ))}
      </div>

      <Divider />

      {/* ── Options ── */}
      <SLabel>Options</SLabel>
      {[{key:"hasBanding",label:"Dalles en saillie"},{key:"hasCorner",label:"Poteaux de rive"},{key:"hasBalconies",label:"Balcons"}].map(({key,label})=>(
        <div key={key} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
          <span style={{ fontSize:11, color:"#334155" }}>{label}</span>
          <button style={toggle(!!(style as Record<string,unknown>)[key])} onClick={()=>up({[key]:!(style as Record<string,unknown>)[key]} as Partial<BuildingStyleOptions>)}>
            <div style={{ position:"absolute", top:2, left:(style as Record<string,unknown>)[key]?14:2, width:14, height:14, borderRadius:"50%", background:"white", transition:"left .15s" }} />
          </button>
        </div>
      ))}
      {style.hasBalconies&&(
        <Row label={`Balcons tous les ${style.balconyFreq} étage(s)`}>
          <input type="range" min={1} max={4} step={1} value={style.balconyFreq}
            onChange={e=>up({balconyFreq:parseInt(e.target.value)})}
            style={{ width:"100%", accentColor:ACCENT, cursor:"pointer" }} />
        </Row>
      )}

      <Divider />

      {/* ── Setbacks ── */}
      <SLabel>Retraits en hauteur (setbacks)</SLabel>
      <div style={{ display:"flex", gap:4 }}>
        {[{v:0,l:"Aucun"},{v:1,l:"1 retrait"},{v:2,l:"2 retraits"}].map(({v,l})=>(
          <button key={v} style={{ ...chip(style.numSetbacks===v), flex:1 }} onClick={()=>up({numSetbacks:v as 0|1|2})}>{l}</button>
        ))}
      </div>

      <Divider />

      {/* ── Aménagements (existing) ── */}
      <SLabel>🏗 Aménagements</SLabel>
      <div style={{ fontSize:10, color:"#94a3b8", marginBottom:6 }}>Activez un outil puis cliquez dans la scène pour placer l'élément.</div>
      <div style={{ display:"flex", gap:6 }}>
        <ToolBtn icon="🚪" label="Portail" active={activeTool==="place_portail"} onClick={()=>onSetTool(activeTool==="place_portail"?"select":"place_portail")} />
        <ToolBtn icon="🌳" label="Arbre"   active={activeTool==="place_tree"}    onClick={()=>onSetTool(activeTool==="place_tree"?"select":"place_tree")} />
      </div>
      {(activeTool==="place_portail"||activeTool==="place_tree")&&(
        <div style={{ marginTop:8, padding:"6px 10px", borderRadius:7, background:"rgba(82,71,184,0.07)", border:"1px solid rgba(82,71,184,0.2)", fontSize:10, color:ACCENT, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
          <span>✦</span>
          <span>{activeTool==="place_portail"?"Cliquez dans la scène pour placer un portail":"Cliquez dans la scène pour placer un arbre"}</span>
        </div>
      )}

      <Divider />

      {/* ── Paysage (collapsible, NEW) ── */}
      <ColSection title="🌿 Paysage" badge="Blender" open={open.paysage} onToggle={() => tog('paysage')}>
        <div style={{ marginBottom:6 }}>
          <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Niveau d'aménagement</div>
          <ChipRow value={spec.landscape.siteFinish} onChange={v => upSpec('landscape', { siteFinish: v })} options={[
            {v:'raw',l:'Brut'},{v:'simple',l:'Simple'},{v:'landscaped',l:'Paysagé'},{v:'premium',l:'Premium'},
          ]} />
        </div>
        <Row label="Matériau de sol">
          <Sel value={spec.landscape.groundMaterial} onChange={v => upSpec('landscape', { groundMaterial: v })} options={[
            {v:'asphalt',l:'Bitume'},{v:'concrete',l:'Béton'},{v:'pavers',l:'Pavés'},{v:'gravel',l:'Gravier'},{v:'grass',l:'Herbe'},
          ]} />
        </Row>
        <ToggleRow label="Parking visible" value={spec.landscape.parkingVisible}
          onChange={v => upSpec('landscape', { parkingVisible: v })} />
        <Row label="Clôture">
          <Sel value={spec.landscape.fenceType} onChange={v => upSpec('landscape', { fenceType: v })} options={[
            {v:'none',l:'Aucune'},{v:'grid',l:'Grille'},{v:'low_wall',l:'Muret'},{v:'hedge',l:'Haie'},{v:'mixed',l:'Mixte'},
          ]} />
        </Row>
        <ToggleRow label="Haies périmètre" value={spec.landscape.hedgeEnabled}
          onChange={v => upSpec('landscape', { hedgeEnabled: v })} />
        {spec.landscape.hedgeEnabled && (
          <Row label="Hauteur haies">
            <NumInput value={spec.landscape.hedgeHeightM??1.2} min={0.3} max={3} step={0.1} unit="m"
              onChange={v => upSpec('landscape', { hedgeHeightM: v })} />
          </Row>
        )}
        <Row label="Nombre d'arbres">
          <NumInput value={spec.landscape.treeCount??0} min={0} max={50}
            onChange={v => upSpec('landscape', { treeCount: Math.max(0, Math.round(v)) })} />
        </Row>
        {(spec.landscape.treeCount??0) > 0 && (
          <Row label="Type d'arbres">
            <Sel value={spec.landscape.treeType??'deciduous'} onChange={v => upSpec('landscape', { treeType: v })} options={[
              {v:'deciduous',l:'Feuillu'},{v:'conifer',l:'Conifère'},{v:'palm',l:'Palmier'},{v:'round',l:'Boule'},{v:'columnar',l:'Fastigié'},
            ]} />
          </Row>
        )}
        <ToggleRow label="Portail" value={spec.landscape.gateEnabled??false}
          onChange={v => upSpec('landscape', { gateEnabled: v })} />
        <Row label="Mobilier urbain">
          <Sel value={spec.landscape.lightStreetFurniture??'none'} onChange={v => upSpec('landscape', { lightStreetFurniture: v })} options={[
            {v:'none',l:'Aucun'},{v:'residential',l:'Résidentiel'},{v:'tertiary',l:'Tertiaire'},
          ]} />
        </Row>
      </ColSection>

      <Divider />

      {/* ── Rendu Blender (collapsible, NEW) ── */}
      <ColSection title="🎬 Rendu Blender" badge="Export" open={open.blender_render} onToggle={() => tog('blender_render')}>

        {/* Intent */}
        <div style={{ marginBottom:6 }}>
          <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Intent de rendu</div>
          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
            {([
              {v:'esquisse_blanche',   l:'✏ Esquisse blanche'},
              {v:'aquarelle',          l:'🎨 Aquarelle'},
              {v:'realiste_doux',      l:'📷 Réaliste doux'},
              {v:'promoteur_premium',  l:'⭐ Promoteur premium'},
              {v:'comite_investissement', l:'💼 Comité investissement'},
            ] as const).map(o => (
              <button key={o.v} style={{ ...chip(spec.render.intent === o.v), textAlign:'left', padding:"5px 8px" }}
                onClick={() => upSpec('render', { intent: o.v })}>{o.l}</button>
            ))}
          </div>
        </div>

        {/* Point de vue */}
        <div style={{ marginBottom:6 }}>
          <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Point de vue</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
            {([
              {v:'pedestrian',   l:'👤 Piéton'},
              {v:'aerial_3q',    l:'🚁 Aérien 3/4'},
              {v:'street_front', l:'📸 Face rue'},
              {v:'parcel_corner',l:'📐 Coin parcelle'},
            ] as const).map(o => (
              <button key={o.v} style={{ ...chip(spec.render.cameraView === o.v) }}
                onClick={() => upSpec('render', { cameraView: o.v })}>{o.l}</button>
            ))}
          </div>
        </div>

        {/* Heure + Ciel */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
          <div>
            <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Heure</div>
            <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
              {([
                {v:'morning',l:'🌅 Matin'},{v:'midday',l:'☀ Midi'},
                {v:'afternoon',l:'🌤 A-midi'},{v:'sunset',l:'🌇 Coucher'},
              ] as const).map(o => (
                <button key={o.v} style={{ ...chip(spec.render.timeOfDay === o.v), textAlign:'left', padding:"4px 7px" }}
                  onClick={() => upSpec('render', { timeOfDay: o.v })}>{o.l}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Ciel</div>
            <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
              {([
                {v:'clear',l:'☀ Dégagé'},{v:'light_clouds',l:'⛅ Voilé'},
                {v:'warm_sunny',l:'🌞 Ensoleillé'},{v:'neutral',l:'☁ Neutre'},
              ] as const).map(o => (
                <button key={o.v} style={{ ...chip(spec.render.sky === o.v), textAlign:'left', padding:"4px 7px" }}
                  onClick={() => upSpec('render', { sky: o.v })}>{o.l}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Détail + Contexte */}
        <div style={{ marginBottom:6 }}>
          <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Niveau de détail</div>
          <ChipRow value={spec.render.detailLevel} onChange={v => upSpec('render', { detailLevel: v })} options={[
            {v:'fast',l:'⚡ Rapide'},{v:'standard',l:'⚙ Standard'},{v:'premium',l:'💎 Premium'},
          ]} />
        </div>
        <div style={{ marginBottom:6 }}>
          <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Contexte urbain</div>
          <ChipRow value={spec.render.urbanContext} onChange={v => upSpec('render', { urbanContext: v })} options={[
            {v:'none',l:'Aucun'},{v:'neutral_masses',l:'Masses neutres'},{v:'simplified_context',l:'Contexte simplifié'},
          ]} wrap />
        </div>

        {/* Focale */}
        <div style={{ marginBottom:6 }}>
          <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Focale</div>
          <div style={{ display:"flex", gap:4 }}>
            {([35,50,70] as const).map(f => (
              <button key={f} style={{ ...chip(spec.render.focalLengthMm === f), flex:1 }}
                onClick={() => upSpec('render', { focalLengthMm: f })}>{f} mm</button>
            ))}
          </div>
        </div>

        {/* Format + Usage */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:4 }}>
          <div>
            <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Format</div>
            <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
              {([
                {v:'square',l:'⬜ Carré'},{v:'landscape',l:'📐 Paysage'},{v:'portrait_a4',l:'📄 A4 portrait'},
              ] as const).map(o => (
                <button key={o.v} style={{ ...chip(spec.render.outputFormat === o.v), textAlign:'left', padding:"4px 7px" }}
                  onClick={() => upSpec('render', { outputFormat: o.v })}>{o.l}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>Usage image</div>
            <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
              {([
                {v:'faisabilite',l:'📋 Faisabilité'},{v:'banque',l:'🏦 Banque'},
                {v:'comite',l:'👔 Comité'},{v:'commercial',l:'📣 Commercial'},
              ] as const).map(o => (
                <button key={o.v} style={{ ...chip(spec.render.usage === o.v), textAlign:'left', padding:"4px 7px" }}
                  onClick={() => upSpec('render', { usage: o.v })}>{o.l}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Badge résumé */}
        <div style={{ marginTop:10, padding:"8px 10px", borderRadius:8, background:"rgba(82,71,184,0.05)", border:"1px solid rgba(82,71,184,0.15)", fontSize:10, color:"#64748b", lineHeight:1.6 }}>
          <strong style={{ color:ACCENT }}>Export Blender</strong> · {spec.render.intent.replace(/_/g,' ')} · {spec.render.cameraView.replace(/_/g,' ')} · {spec.render.detailLevel} · {spec.render.focalLengthMm}mm · {spec.render.outputFormat.replace(/_/g,' ')}
        </div>
      </ColSection>

      {/* ── Estimations ── */}
      {building.meta&&(
        <>
          <Divider />
          <SLabel>Estimations</SLabel>
          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
            {building.meta.footprintM2!=null&&<div style={{ display:"flex", justifyContent:"space-between", fontSize:11 }}><span style={{ color:"#64748b" }}>Emprise</span><span style={{ fontWeight:600 }}>{building.meta.footprintM2.toLocaleString("fr-FR")} m²</span></div>}
            {building.meta.sdpEstimeeM2!=null&&<div style={{ display:"flex", justifyContent:"space-between", fontSize:11 }}><span style={{ color:"#64748b" }}>SDP estimée</span><span style={{ fontWeight:600 }}>{building.meta.sdpEstimeeM2.toLocaleString("fr-FR")} m²</span></div>}
            {building.meta.nbLogementsEst!=null&&<div style={{ display:"flex", justifyContent:"space-between", fontSize:11 }}><span style={{ color:"#64748b" }}>Logements est.</span><span style={{ fontWeight:600 }}>{building.meta.nbLogementsEst}</span></div>}
          </div>
        </>
      )}
    </div>
  );
};
