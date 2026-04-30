// src/spaces/promoteur/plan2d/BuildingInspectorPanel.tsx — V3 dimensions directes
//
// Changements vs V2 :
//   SUPPRIMÉ : Façade principale (EdgeCompass), Balcons, Loggias, Terrasses
//   AJOUTÉ   : Section "Dimensions" — inputs directs width/depth/rotation/centre
//              → modifient le rect via updateBuildingRect en temps réel
//   CONSERVÉ : Header (label éditable, KPIs emprise/hauteur/niveaux)
//              Programme volumétrique (étages, hauteurs, toiture)
//              Badge étage actif

import React, { useState, useCallback } from 'react';
import { useEditor2DStore }              from './editor2d.store';
import type { Building2D, OrientedRect } from './editor2d.types';

// ─── TOKENS ───────────────────────────────────────────────────────────

const T = {
  slate900:'#0f172a', slate700:'#334155', slate600:'#475569', slate500:'#64748b',
  slate400:'#94a3b8', slate200:'#e2e8f0', slate100:'#f1f5f9', slate50:'#f8fafc', white:'#ffffff',
  indigo600:'#4f46e5', indigo50:'#eef2ff', indigo200:'#c7d2fe',
  violet600:'#7c3aed',
  amber50:'#fffbeb',   amber600:'#d97706',
  green100:'#dcfce7',  green700:'#15803d',
  red600:'#dc2626',
} as const;

const levelLabel = (n: number) => n === 0 ? 'RDC' : `R+${n}`;

// ─── MINI COMPOSANTS ──────────────────────────────────────────────────

const SectionHeader: React.FC<{ label: string; icon?: string }> = ({ label, icon }) => (
  <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 0 5px', borderBottom:`1px solid ${T.slate200}`, marginBottom:8 }}>
    {icon && <span style={{ fontSize:13 }}>{icon}</span>}
    <span style={{ fontSize:10, fontWeight:700, color:T.slate500, letterSpacing:'0.08em', textTransform:'uppercase' }}>{label}</span>
  </div>
);

/** Input numérique avec label à gauche et unité à droite. */
const NumInput: React.FC<{
  label:    string;
  value:    number;
  min?:     number;
  max?:     number;
  step?:    number;
  unit?:    string;
  accent?:  string;
  onChange: (v: number) => void;
}> = ({ label, value, min = 0, max = 9999, step = 1, unit, accent, onChange }) => (
  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
    <span style={{ fontSize:11.5, color:T.slate600 }}>{label}</span>
    <div style={{ display:'flex', alignItems:'center', gap:4 }}>
      <input
        type="number" value={value} min={min} max={max} step={step}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          width:64, padding:'3px 7px', borderRadius:6,
          border:`1.5px solid ${accent ?? T.slate200}`,
          fontSize:12, fontWeight:600, color:T.slate900,
          textAlign:'right', background:T.white, outline:'none',
        }}
      />
      {unit && <span style={{ fontSize:11, color:T.slate400, minWidth:18 }}>{unit}</span>}
    </div>
  </div>
);

/** Ligne lecture seule. */
const ReadonlyRow: React.FC<{ label: string; value: string; accent?: string }> = ({ label, value, accent }) => (
  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
    <span style={{ fontSize:11, color:T.slate400 }}>{label}</span>
    <span style={{ fontSize:12, fontWeight:600, color: accent ?? T.slate700, fontVariantNumeric:'tabular-nums' }}>{value}</span>
  </div>
);

// ─── MAIN PANEL ───────────────────────────────────────────────────────

export interface BuildingInspectorPanelProps { buildingId: string; }

export const BuildingInspectorPanel: React.FC<BuildingInspectorPanelProps> = ({ buildingId }) => {

  const buildings             = useEditor2DStore(s => s.buildings);
  const activeLevelIndex      = useEditor2DStore(s => s.activeLevelIndex);
  const updateBuildingProgram = useEditor2DStore(s => s.updateBuildingProgram);
  const updateBuildingRect    = useEditor2DStore(s => s.updateBuildingRect);

  const b = buildings.find(x => x.id === buildingId);
  if (!b) return null;

  const activeFloor = b.floorPlans?.find(fp => fp.levelIndex === activeLevelIndex);
  const floorLabel  = levelLabel(activeLevelIndex);

  const upB    = (patch: Partial<Building2D>) => updateBuildingProgram(buildingId, patch);
  const upRect = (patch: Partial<OrientedRect>) =>
    updateBuildingRect(buildingId, { ...b.rect, ...patch }, true);

  const totalH   = b.groundFloorHeightM + b.floorsAboveGround * b.typicalFloorHeightM;
  const emprise  = b.rect.width * b.rect.depth;
  const floorArea = (activeFloor?.volumes ?? []).reduce((s, v) => s + v.rect.width * v.rect.depth, 0);

  return (
    <div style={{ background:T.slate50, fontFamily:'Inter,system-ui,sans-serif' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ padding:'10px 14px 8px', borderBottom:`1px solid ${T.slate200}`, background:T.indigo50 }}>

        {/* Label éditable */}
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
          <span style={{
            fontSize:9, fontWeight:700, color:T.indigo600, background:T.white,
            border:`1px solid ${T.indigo200}`, borderRadius:20,
            padding:'2px 6px', letterSpacing:'0.06em', textTransform:'uppercase', flexShrink:0,
          }}>
            ⬜ Bâtiment
          </span>
          <input
            value={b.label}
            onChange={e => upB({ label: e.target.value })}
            style={{ flex:1, border:'none', background:'transparent', fontSize:13, fontWeight:700, color:T.slate900, outline:'none' }}
          />
        </div>

        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, marginBottom:6 }}>
          {[
            { label:'Emprise',    value:`${emprise.toFixed(0)} m²`       },
            { label:'Haut. tot.', value:`${totalH.toFixed(1)} m`          },
            { label:'Niveaux',    value:`R+${b.floorsAboveGround}`         },
          ].map(kpi => (
            <div key={kpi.label} style={{
              background:T.white, border:`1px solid ${T.indigo200}`,
              borderRadius:8, padding:'5px 7px', textAlign:'center',
            }}>
              <div style={{ fontSize:9, color:T.slate400, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:2 }}>{kpi.label}</div>
              <div style={{ fontSize:12, fontWeight:700, color:T.slate900, fontVariantNumeric:'tabular-nums' }}>{kpi.value}</div>
            </div>
          ))}
        </div>

        {/* Badge étage actif */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          background:T.white, border:`1px solid ${T.indigo200}`,
          borderRadius:8, padding:'5px 10px',
        }}>
          <span style={{ fontSize:11, fontWeight:700, color:T.indigo600 }}>Étage actif : {floorLabel}</span>
          {activeFloor ? (
            <span style={{ fontSize:10.5, color:T.slate500, fontVariantNumeric:'tabular-nums' }}>
              {floorArea.toFixed(0)} m² · {activeFloor.volumes?.length ?? 0} vol.
            </span>
          ) : (
            <span style={{ fontSize:10, color:T.amber600 }}>Aucun plan ici</span>
          )}
        </div>
      </div>

      <div style={{ padding:'10px 14px 16px', display:'flex', flexDirection:'column', gap:14 }}>

        {/* ── Dimensions directes ────────────────────────────────────────── */}
        <div>
          <SectionHeader label="Dimensions" icon="📏"/>

          {/* Largeur × Profondeur sur une ligne */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:7 }}>
            {[
              { label:'Largeur',    key:'width', val:b.rect.width  },
              { label:'Profondeur', key:'depth', val:b.rect.depth  },
            ].map(f => (
              <div key={f.key}>
                <div style={{ fontSize:10, color:T.slate400, marginBottom:3 }}>{f.label}</div>
                <div style={{ display:'flex', alignItems:'center', gap:3 }}>
                  <input
                    type="number" value={parseFloat(f.val.toFixed(2))} min={3} max={500} step={0.5}
                    onChange={e => upRect({ [f.key]: Math.max(3, Number(e.target.value)) })}
                    style={{
                      width:'100%', padding:'4px 7px', borderRadius:7,
                      border:`1.5px solid ${T.indigo200}`,
                      fontSize:13, fontWeight:700, color:T.slate900,
                      textAlign:'right', background:T.indigo50, outline:'none',
                    }}
                  />
                  <span style={{ fontSize:11, color:T.slate400, flexShrink:0 }}>m</span>
                </div>
              </div>
            ))}
          </div>

          {/* Surface calculée */}
          <div style={{
            display:'flex', justifyContent:'space-between', alignItems:'center',
            background:T.white, border:`1px solid ${T.slate200}`,
            borderRadius:7, padding:'5px 10px', marginBottom:9,
          }}>
            <span style={{ fontSize:11, color:T.slate500 }}>Surface au sol</span>
            <span style={{ fontSize:13, fontWeight:700, color:T.indigo600, fontVariantNumeric:'tabular-nums' }}>
              {emprise.toFixed(1)} m²
            </span>
          </div>

          {/* Rotation */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
            <span style={{ fontSize:11.5, color:T.slate600 }}>Rotation</span>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <input
                type="range" min={0} max={359} step={1}
                value={Math.round(((b.rect.rotationDeg % 360) + 360) % 360)}
                onChange={e => upRect({ rotationDeg: Number(e.target.value) })}
                style={{ width:72, accentColor:T.indigo600 }}
              />
              <input
                type="number" min={0} max={359} step={1}
                value={Math.round(((b.rect.rotationDeg % 360) + 360) % 360)}
                onChange={e => upRect({ rotationDeg: Number(e.target.value) })}
                style={{
                  width:48, padding:'3px 5px', borderRadius:6,
                  border:`1.5px solid ${T.slate200}`,
                  fontSize:12, fontWeight:600, color:T.slate900,
                  textAlign:'right', background:T.white, outline:'none',
                }}
              />
              <span style={{ fontSize:11, color:T.slate400 }}>°</span>
            </div>
          </div>

          {/* Boutons rotation rapide */}
          <div style={{ display:'flex', gap:4, marginBottom:10 }}>
            {[-90, -45, -15, +15, +45, +90].map(delta => {
              const current = ((b.rect.rotationDeg % 360) + 360) % 360;
              const next    = ((current + delta) % 360 + 360) % 360;
              return (
                <button
                  key={delta}
                  onClick={() => upRect({ rotationDeg: next })}
                  style={{
                    flex:1, padding:'3px 0', borderRadius:6,
                    border:`1px solid ${T.slate200}`, background:T.white,
                    fontSize:10, fontWeight:600, color:T.slate600, cursor:'pointer',
                  }}
                >
                  {delta > 0 ? `+${delta}°` : `${delta}°`}
                </button>
              );
            })}
          </div>

          {/* Centre X / Y */}
          <div style={{ marginBottom:2 }}>
            <div style={{ fontSize:10, color:T.slate400, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>Position du centre</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {[
                { axis:'X', key:'x', val:b.rect.center.x },
                { axis:'Y', key:'y', val:b.rect.center.y },
              ].map(f => (
                <div key={f.key}>
                  <div style={{ fontSize:10, color:T.slate400, marginBottom:2 }}>Centre {f.axis}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:3 }}>
                    <input
                      type="number" value={parseFloat(f.val.toFixed(2))} step={0.5}
                      onChange={e => upRect({ center: { ...b.rect.center, [f.key]: Number(e.target.value) } })}
                      style={{
                        width:'100%', padding:'3px 6px', borderRadius:7,
                        border:`1.5px solid ${T.slate200}`,
                        fontSize:12, fontWeight:600, color:T.slate700,
                        textAlign:'right', background:T.white, outline:'none',
                      }}
                    />
                    <span style={{ fontSize:10, color:T.slate400, flexShrink:0 }}>m</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Programme volumétrique ────────────────────────────────────── */}
        <div>
          <SectionHeader label="Programme volumétrique" icon="📐"/>

          <NumInput
            label="Étages au-dessus du RDC" value={b.floorsAboveGround} min={0} max={30}
            onChange={v => upB({ floorsAboveGround: v })}
          />
          <NumInput
            label="Hauteur RDC" value={b.groundFloorHeightM} step={0.1} min={2.5} max={6} unit="m"
            onChange={v => upB({ groundFloorHeightM: v })}
          />
          <NumInput
            label="Hauteur étages courants" value={b.typicalFloorHeightM} step={0.1} min={2.4} max={5} unit="m"
            onChange={v => upB({ typicalFloorHeightM: v })}
          />
          <ReadonlyRow label="Hauteur totale estimée" value={`${totalH.toFixed(2)} m`} accent={T.slate700}/>

          {/* Toiture */}
          <div style={{ marginTop:8 }}>
            <div style={{ fontSize:11, color:T.slate500, marginBottom:4 }}>Toiture</div>
            <div style={{ display:'flex', gap:5 }}>
              {([
                { val:'flat'    as const, label:'⬜ Plate'   },
                { val:'pitched' as const, label:'🏠 Pente'   },
                { val:'attic'   as const, label:'🏛 Attique' },
              ]).map(r => (
                <button key={r.val} onClick={() => upB({ roofType: r.val })} style={{
                  flex:1, padding:'4px 0', borderRadius:6, fontSize:10.5, fontWeight:600, cursor:'pointer',
                  border:`1px solid ${b.roofType === r.val ? T.indigo600 : T.slate200}`,
                  background:b.roofType === r.val ? T.indigo50 : T.white,
                  color:b.roofType === r.val ? T.indigo600 : T.slate600,
                }}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Avertissement étage sans plan */}
        {!activeFloor && (
          <div style={{
            background:T.amber50, border:'1px solid #fde68a',
            borderRadius:10, padding:'10px 14px',
            fontSize:11.5, color:T.amber600, lineHeight:1.5,
          }}>
            ⚠️ Aucun plan pour <strong>{floorLabel}</strong>.<br/>
            Utilisez <strong>Dupliquer {levelLabel(activeLevelIndex - 1)}</strong> dans le sélecteur d'étages.
          </div>
        )}

      </div>
    </div>
  );
};

export default BuildingInspectorPanel;