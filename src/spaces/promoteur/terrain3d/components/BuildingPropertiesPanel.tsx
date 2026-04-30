// BuildingPropertiesPanel.tsx
// v5 — Minimal : gabarit + terrassement uniquement
// v5 : suppression Toiture + Balcons
// v4 : suppression modèle, style, façade, vitrage, structure, aménagements
// v3 : suppression des sections liées à BuildingBlenderSpec

import React, { type FC } from "react";
import type {
  MassingBuildingModel, BuildingLevels, BuildingTransform, BuildingStyleOptions,
} from "../massingScene.types";
import { totalHeightM, totalLevelsCount } from "../massingScene.types";

const ACCENT = "#5247b8";

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

const chip = (active:boolean): React.CSSProperties => ({
  padding:"4px 8px", borderRadius:6, cursor:"pointer", fontSize:10, fontWeight:600,
  border:active?`1.5px solid ${ACCENT}`:"1.5px solid #e2e8f0",
  background:active?`rgba(82,71,184,0.08)`:"white",
  color:active?ACCENT:"#475569", transition:"all .10s",
});

// ─── Main panel ───────────────────────────────────────────────────────────────

interface Props {
  building:          MassingBuildingModel;
  onUpdateLevels:    (patch: Partial<BuildingLevels>) => void;
  onUpdateTransform: (patch: Partial<BuildingTransform>) => void;
  onUpdateStyle:     (patch: Partial<BuildingStyleOptions>) => void;
  onUpdateName:      (name: string) => void;
  onDelete:          () => void;
  onDuplicate:       () => void;
}

export const BuildingPropertiesPanel: FC<Props> = ({
  building,
  onUpdateLevels, onUpdateTransform, onUpdateStyle, onUpdateName,
  onDelete, onDuplicate,
}) => {
  const { levels, transform, style } = building;
  const hTotal  = totalHeightM(levels);
  const nLevels = totalLevelsCount(levels);
  const up = (patch: Partial<BuildingStyleOptions>) => onUpdateStyle(patch);

  return (
    <div style={{ background:"white", borderRadius:12, padding:14, border:"1px solid #e2e8f0", boxShadow:"0 1px 3px rgba(0,0,0,0.05)" }}>

      {/* ── Nom + actions ── */}
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

      <Divider />

      {/* ── Setbacks (retraits en hauteur → affectent le gabarit) ── */}
      <SLabel>Retraits en hauteur (setbacks)</SLabel>
      <div style={{ display:"flex", gap:4 }}>
        {[{v:0,l:"Aucun"},{v:1,l:"1 retrait"},{v:2,l:"2 retraits"}].map(({v,l})=>(
          <button key={v} style={{ ...chip(style.numSetbacks===v), flex:1 }} onClick={()=>up({numSetbacks:v as 0|1|2})}>{l}</button>
        ))}
      </div>

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