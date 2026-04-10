// src/spaces/promoteur/plan2d/FloorElementsPanel.tsx
// Panneau simple pour ajouter balcons / loggias / terrasses à l'étage actif.
// V1 : ajoute un élément avec des valeurs par défaut intelligentes (40% de l'emprise, etc.)

import React, { useState } from 'react';
import { useEditor2DStore } from './editor2d.store';
import type { FloorBalcony2D, FloorLoggia2D, FloorTerrace2D, FloorEdge } from './floorElements.types';
import { genId } from './editor2d.geometry';

// ─── TOKENS ───────────────────────────────────────────────────────────

const T = {
  white:'#ffffff', slate50:'#f8fafc', slate100:'#f1f5f9', slate200:'#e2e8f0',
  slate400:'#94a3b8', slate500:'#64748b', slate700:'#334155', slate900:'#0f172a',
  indigo50:'#eef2ff', indigo200:'#c7d2fe', indigo600:'#4f46e5',
  violet50:'#f5f3ff', violet200:'#ddd6fe', violet600:'#7c3aed',
  teal50:'#f0fdfa',   teal200:'#99f6e4',   teal600:'#0d9488',
  amber50:'#fffbeb',  amber600:'#d97706',
  red600:'#dc2626',
} as const;

const levelLabel = (n: number) => n === 0 ? 'RDC' : `R+${n}`;

// ─── EDGE SELECTOR ────────────────────────────────────────────────────

const EdgeSelector: React.FC<{ value: FloorEdge; onChange: (v: FloorEdge) => void }> = ({ value, onChange }) => (
  <div style={{ display:'flex', gap:4 }}>
    {(['north','east','south','west'] as FloorEdge[]).map(e => {
      const label = { north:'N', east:'E', south:'S', west:'O' }[e];
      const active = value === e;
      return (
        <button key={e} onClick={() => onChange(e)} style={{
          padding:'2px 7px', borderRadius:6, fontSize:10, fontWeight:700, cursor:'pointer',
          border:`1px solid ${active?T.slate700:T.slate200}`,
          background:active?T.slate700:T.white, color:active?T.white:T.slate500,
        }}>{label}</button>
      );
    })}
  </div>
);

// ─── ELEMENT ROW ──────────────────────────────────────────────────────

interface ElementRowProps {
  id:       string;
  color:    string; bg: string; border: string;
  title:    string;
  showEdge?: boolean; edge?: FloorEdge; onEdgeChange?: (v: FloorEdge) => void;
  fields:   { label:string; key:string; value:number; step?:number; min?:number }[];
  onChange: (key:string, val:number) => void;
  onDelete: () => void;
}

const ElementRow: React.FC<ElementRowProps> = ({ id, color, bg, border, title, showEdge, edge, onEdgeChange, fields, onChange, onDelete }) => (
  <div style={{ background:T.white, border:`1px solid ${border}`, borderRadius:8, padding:'7px 10px', marginBottom:6 }}>
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:10, fontWeight:700, color, letterSpacing:'0.04em' }}>{title}</span>
        {showEdge && edge && onEdgeChange && <EdgeSelector value={edge} onChange={onEdgeChange}/>}
      </div>
      <button onClick={onDelete} style={{ background:'none', border:'none', cursor:'pointer', color:T.red600, fontSize:15, lineHeight:1, padding:'0 2px' }}>×</button>
    </div>
    <div style={{ display:'grid', gridTemplateColumns:`repeat(${fields.length},1fr)`, gap:5 }}>
      {fields.map(f => (
        <div key={f.key} style={{ textAlign:'center' }}>
          <div style={{ fontSize:9, color:T.slate400, marginBottom:2, fontWeight:600 }}>{f.label}</div>
          <input type="number" value={f.value} step={f.step??0.5} min={f.min??0}
            onChange={e => onChange(f.key, Number(e.target.value))}
            style={{ width:'100%', padding:'2px 4px', borderRadius:5, border:`1px solid ${T.slate200}`, fontSize:11, fontWeight:600, textAlign:'center', background:bg, outline:'none' }}
          />
        </div>
      ))}
    </div>
  </div>
);

// ─── SECTION HEADER ───────────────────────────────────────────────────

const SectionHeader: React.FC<{ icon:string; label:string; count:number; onAdd:()=>void; addBg:string; addColor:string; addBorder:string }> = ({
  icon, label, count, onAdd, addBg, addColor, addBorder,
}) => (
  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:7 }}>
    <div style={{ display:'flex', alignItems:'center', gap:5 }}>
      <span>{icon}</span>
      <span style={{ fontSize:11, fontWeight:700, color:T.slate700 }}>{label}</span>
      <span style={{ fontSize:9, fontWeight:600, color:T.slate400, background:T.slate100, borderRadius:10, padding:'1px 6px' }}>{count}</span>
    </div>
    <button onClick={onAdd} style={{
      padding:'3px 10px', borderRadius:6, fontSize:10.5, fontWeight:700, cursor:'pointer',
      border:`1px solid ${addBorder}`, background:addBg, color:addColor,
    }}>+ Ajouter</button>
  </div>
);

// ─── MAIN PANEL ───────────────────────────────────────────────────────

export interface FloorElementsPanelProps {
  buildingId: string;
}

export const FloorElementsPanel: React.FC<FloorElementsPanelProps> = ({ buildingId }) => {
  const buildings        = useEditor2DStore(s => s.buildings);
  const activeLevelIndex = useEditor2DStore(s => s.activeLevelIndex);
  const updateFloorPlan  = useEditor2DStore(s => s.updateFloorPlan);

  const b = buildings.find(x => x.id === buildingId);
  if (!b) return null;

  const activeFloor = b.floorPlans?.find(fp => fp.levelIndex === activeLevelIndex);

  // Les éléments de l'étage actif
  const balconies: FloorBalcony2D[] = (activeFloor?.balconies as FloorBalcony2D[]) ?? [];
  const loggias:   FloorLoggia2D[]  = (activeFloor?.loggias   as FloorLoggia2D[])  ?? [];
  const terraces:  FloorTerrace2D[] = (activeFloor?.terraces  as FloorTerrace2D[]) ?? [];

  const up = (patch: { balconies?:FloorBalcony2D[]; loggias?:FloorLoggia2D[]; terraces?:FloorTerrace2D[] }) =>
    updateFloorPlan(buildingId, activeLevelIndex, patch as any);

  // ── Defaults basés sur l'emprise du bâtiment ──────────────────────
  const w40 = Math.round(b.rect.width * 0.4 * 10) / 10;
  const w60 = Math.round(b.rect.width * 0.6 * 10) / 10;
  const d60 = Math.round(b.rect.depth * 0.6 * 10) / 10;

  // ── BALCONS ───────────────────────────────────────────────────────
  const addBalcony = () => {
    const item: FloorBalcony2D = { id:genId(), edge:'south', offsetM:0, widthM:w40, depthM:1.5, levelIndex:activeLevelIndex };
    up({ balconies: [...balconies, item] });
  };
  const updateBalcony = (id:string, key:string, val:number) =>
    up({ balconies: balconies.map(x => x.id===id ? {...x,[key]:val} : x) });
  const changeBalconyEdge = (id:string, edge:FloorEdge) =>
    up({ balconies: balconies.map(x => x.id===id ? {...x,edge} : x) });
  const deleteBalcony = (id:string) =>
    up({ balconies: balconies.filter(x => x.id!==id) });

  // ── LOGGIAS ───────────────────────────────────────────────────────
  const addLoggia = () => {
    const item: FloorLoggia2D = { id:genId(), edge:'south', offsetM:0, widthM:w40, depthM:2.0, levelIndex:activeLevelIndex };
    up({ loggias: [...loggias, item] });
  };
  const updateLoggia = (id:string, key:string, val:number) =>
    up({ loggias: loggias.map(x => x.id===id ? {...x,[key]:val} : x) });
  const changeLoggiaEdge = (id:string, edge:FloorEdge) =>
    up({ loggias: loggias.map(x => x.id===id ? {...x,edge} : x) });
  const deleteLoggia = (id:string) =>
    up({ loggias: loggias.filter(x => x.id!==id) });

  // ── TERRASSES ─────────────────────────────────────────────────────
  const addTerrace = () => {
    const item: FloorTerrace2D = { id:genId(), kind:'roof', widthM:w60, depthM:d60, levelIndex:activeLevelIndex };
    up({ terraces: [...terraces, item] });
  };
  const updateTerrace = (id:string, key:string, val:number) =>
    up({ terraces: terraces.map(x => x.id===id ? {...x,[key]:val} : x) });
  const deleteTerrace = (id:string) =>
    up({ terraces: terraces.filter(x => x.id!==id) });

  const floorLabel = levelLabel(activeLevelIndex);

  return (
    <div style={{ fontFamily:'Inter,system-ui,sans-serif', background:T.slate50 }}>
      {/* Header */}
      <div style={{ padding:'8px 12px', borderBottom:`1px solid ${T.slate200}`, background:T.slate100 }}>
        <div style={{ fontSize:10, fontWeight:700, color:T.slate500, letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:2 }}>
          Éléments architecturaux
        </div>
        <div style={{ fontSize:12, fontWeight:700, color:T.slate800 as any }}>
          {b.label} — <span style={{ color:T.indigo600 }}>{floorLabel}</span>
        </div>
      </div>

      {!activeFloor ? (
        <div style={{ padding:'12px', background:T.amber50, fontSize:11.5, color:T.amber600, lineHeight:1.5 }}>
          ⚠️ Aucun plan pour <strong>{floorLabel}</strong>.<br/>
          Dupliquez l'étage inférieur pour créer ce niveau.
        </div>
      ) : (
        <div style={{ padding:'10px 12px 14px', display:'flex', flexDirection:'column', gap:14 }}>

          {/* ── BALCONS ── */}
          <div>
            <SectionHeader icon="🏗" label="Balcons" count={balconies.length}
              onAdd={addBalcony} addBg={T.indigo50} addColor={T.indigo600} addBorder={T.indigo200}/>
            {balconies.map(bal => (
              <ElementRow key={bal.id} id={bal.id}
                color={T.indigo600} bg={T.indigo50} border={T.indigo200}
                title="Balcon" showEdge edge={bal.edge}
                onEdgeChange={e => changeBalconyEdge(bal.id, e)}
                fields={[
                  { label:'Larg. m', key:'widthM',  value:bal.widthM,  step:0.5, min:0.5 },
                  { label:'Prof. m', key:'depthM',  value:bal.depthM,  step:0.1, min:0.3 },
                  { label:'Décal. m',key:'offsetM', value:bal.offsetM, step:0.5, min:-20  },
                ]}
                onChange={(k,v) => updateBalcony(bal.id,k,v)}
                onDelete={() => deleteBalcony(bal.id)}
              />
            ))}
            {!balconies.length && (
              <div style={{ fontSize:11, color:T.slate400, textAlign:'center', padding:'6px 0', fontStyle:'italic' }}>
                Cliquez + Ajouter pour créer un balcon
              </div>
            )}
          </div>

          {/* ── LOGGIAS ── */}
          <div>
            <SectionHeader icon="🔲" label="Loggias" count={loggias.length}
              onAdd={addLoggia} addBg={T.violet50} addColor={T.violet600} addBorder={T.violet200}/>
            {loggias.map(log => (
              <ElementRow key={log.id} id={log.id}
                color={T.violet600} bg={T.violet50} border={T.violet200}
                title="Loggia" showEdge edge={log.edge}
                onEdgeChange={e => changeLoggiaEdge(log.id, e)}
                fields={[
                  { label:'Larg. m', key:'widthM',  value:log.widthM,  step:0.5, min:0.5 },
                  { label:'Prof. m', key:'depthM',  value:log.depthM,  step:0.1, min:0.5 },
                  { label:'Décal. m',key:'offsetM', value:log.offsetM, step:0.5, min:-20  },
                ]}
                onChange={(k,v) => updateLoggia(log.id,k,v)}
                onDelete={() => deleteLoggia(log.id)}
              />
            ))}
            {!loggias.length && (
              <div style={{ fontSize:11, color:T.slate400, textAlign:'center', padding:'6px 0', fontStyle:'italic' }}>
                Cliquez + Ajouter pour créer une loggia
              </div>
            )}
          </div>

          {/* ── TERRASSES ── */}
          <div>
            <SectionHeader icon="☀️" label="Terrasses" count={terraces.length}
              onAdd={addTerrace} addBg={T.teal50} addColor={T.teal600} addBorder={T.teal200}/>
            {terraces.map(t => (
              <div key={t.id} style={{ background:T.white, border:`1px solid ${T.teal200}`, borderRadius:8, padding:'7px 10px', marginBottom:6 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                  <div style={{ display:'flex', gap:4 }}>
                    {(['roof','setback'] as const).map(k => (
                      <button key={k} onClick={() => up({ terraces: terraces.map(x => x.id===t.id ? {...x,kind:k} : x) })} style={{
                        padding:'2px 8px', borderRadius:6, fontSize:9.5, fontWeight:700, cursor:'pointer',
                        border:`1px solid ${t.kind===k?T.teal600:T.slate200}`,
                        background:t.kind===k?T.teal600:T.white, color:t.kind===k?T.white:T.slate500,
                      }}>{k==='roof'?'Rooftop':'Retrait'}</button>
                    ))}
                  </div>
                  <button onClick={() => deleteTerrace(t.id)} style={{ background:'none', border:'none', cursor:'pointer', color:T.red600, fontSize:15 }}>×</button>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
                  {[
                    { label:'Larg. m', key:'widthM', value:t.widthM, step:0.5, min:1 },
                    { label:'Prof. m', key:'depthM', value:t.depthM, step:0.5, min:1 },
                  ].map(f => (
                    <div key={f.key} style={{ textAlign:'center' }}>
                      <div style={{ fontSize:9, color:T.slate400, marginBottom:2, fontWeight:600 }}>{f.label}</div>
                      <input type="number" value={f.value} step={f.step} min={f.min}
                        onChange={e => updateTerrace(t.id, f.key, Number(e.target.value))}
                        style={{ width:'100%', padding:'2px 4px', borderRadius:5, border:`1px solid ${T.slate200}`, fontSize:11, fontWeight:600, textAlign:'center', background:T.teal50 }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!terraces.length && (
              <div style={{ fontSize:11, color:T.slate400, textAlign:'center', padding:'6px 0', fontStyle:'italic' }}>
                Cliquez + Ajouter pour créer une terrasse
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
};

export default FloorElementsPanel;