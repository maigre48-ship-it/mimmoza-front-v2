// src/spaces/promoteur/plan2d/BuildingInspectorPanel.tsx — V2 multi-étages

import React, { useState } from 'react';
import { useEditor2DStore } from './editor2d.store';
import type { Building2D, FacadeEdge, FloorPlan2D } from './editor2d.types';
import type { Balcon2D, Loggia2D, Terrasse2D } from './buildingProgram.types';
import { genId } from './editor2d.geometry';

// ─── TOKENS ───────────────────────────────────────────────────────────

const T = {
  slate900:'#0f172a', slate700:'#334155', slate600:'#475569', slate500:'#64748b',
  slate400:'#94a3b8', slate200:'#e2e8f0', slate100:'#f1f5f9', slate50:'#f8fafc', white:'#ffffff',
  indigo600:'#4f46e5', indigo50:'#eef2ff', indigo200:'#c7d2fe',
  violet600:'#7c3aed', violet50:'#f5f3ff', violet200:'#ddd6fe',
  teal600:'#0d9488',   teal50:'#f0fdfa',   teal200:'#99f6e4',
  red600:'#dc2626',    red50:'#fef2f2',
  amber50:'#fffbeb',   amber600:'#d97706',
  green50:'#f0fdf4',   green700:'#15803d',
} as const;

const levelLabel = (n: number) => n === 0 ? 'RDC' : `R+${n}`;

// ─── MINI COMPOSANTS ──────────────────────────────────────────────────

const SectionHeader: React.FC<{ label: string; icon?: string }> = ({ label, icon }) => (
  <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 0 5px', borderBottom:`1px solid ${T.slate200}`, marginBottom:8 }}>
    {icon && <span style={{ fontSize:13 }}>{icon}</span>}
    <span style={{ fontSize:10, fontWeight:700, color:T.slate500, letterSpacing:'0.08em', textTransform:'uppercase' }}>{label}</span>
  </div>
);

const NumInput: React.FC<{ label:string; value:number; min?:number; max?:number; step?:number; unit?:string; onChange:(v:number)=>void }> = ({ label, value, min=0, max=99, step=1, unit, onChange }) => (
  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
    <span style={{ fontSize:11.5, color:T.slate600 }}>{label}</span>
    <div style={{ display:'flex', alignItems:'center', gap:4 }}>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width:58, padding:'3px 7px', borderRadius:6, border:`1px solid ${T.slate200}`, fontSize:12, fontWeight:600, color:T.slate900, textAlign:'right', background:T.white, outline:'none' }}
      />
      {unit && <span style={{ fontSize:11, color:T.slate400, minWidth:16 }}>{unit}</span>}
    </div>
  </div>
);

const ReadonlyRow: React.FC<{ label:string; value:string }> = ({ label, value }) => (
  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
    <span style={{ fontSize:11, color:T.slate400 }}>{label}</span>
    <span style={{ fontSize:12, fontWeight:600, color:T.slate700, fontVariantNumeric:'tabular-nums' }}>{value}</span>
  </div>
);

// ─── EDGE COMPASS ─────────────────────────────────────────────────────

const EdgeCompass: React.FC<{ value?:FacadeEdge; onChange:(v:FacadeEdge)=>void }> = ({ value, onChange }) => {
  const edges: { dir:FacadeEdge; label:string; pos:{top:number;left:number} }[] = [
    { dir:'north', label:'N', pos:{top:2,  left:24} },
    { dir:'east',  label:'E', pos:{top:18, left:42} },
    { dir:'south', label:'S', pos:{top:34, left:24} },
    { dir:'west',  label:'O', pos:{top:18, left:6 } },
  ];
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10 }}>
      <div style={{ position:'relative', width:60, height:60, flexShrink:0 }}>
        <div style={{ position:'absolute', top:15, left:15, width:30, height:30, border:`1.5px solid ${T.slate200}`, borderRadius:4, background:T.slate50 }}/>
        {edges.map(e => {
          const active = value === e.dir;
          return (
            <button key={e.dir} onClick={() => onChange(e.dir)} style={{
              position:'absolute', top:e.pos.top, left:e.pos.left,
              width:16, height:16, borderRadius:'50%',
              border:`1.5px solid ${active ? T.red600 : T.slate200}`,
              background:active ? T.red600 : T.white,
              color:active ? T.white : T.slate500,
              fontSize:8, fontWeight:700, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center',
            }}>{e.label}</button>
          );
        })}
      </div>
      <div>
        <div style={{ fontSize:11, fontWeight:600, color:T.slate700 }}>
          {value ? `Façade ${{ north:'N', east:'E', south:'S', west:'O' }[value]}` : 'Non définie'}
        </div>
        <div style={{ fontSize:10, color:T.slate400, marginTop:2, lineHeight:1.4 }}>
          Façade principale<br/>de référence
        </div>
      </div>
    </div>
  );
};

// ─── ELEMENT ROW ──────────────────────────────────────────────────────

const ElementRow: React.FC<{
  color: string; bg: string; borderColor: string;
  title: string;
  fields: { label:string; key:string; val:number; step?:number; min?:number }[];
  showEdge?: boolean; edge?: FacadeEdge;
  onChange: (patch: Record<string,unknown>) => void;
  onDelete: () => void;
}> = ({ color, bg, borderColor, title, fields, showEdge, edge, onChange, onDelete }) => {
  const edgeMap: Record<FacadeEdge,string> = { north:'N', east:'E', south:'S', west:'O' };
  return (
    <div style={{ background:T.white, border:`1px solid ${borderColor}`, borderRadius:8, padding:'7px 9px', marginBottom:6 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
        <span style={{ fontSize:10.5, fontWeight:700, color }}>{title}</span>
        <div style={{ display:'flex', gap:4 }}>
          {showEdge && (['north','east','south','west'] as FacadeEdge[]).map(dir => (
            <button key={dir} onClick={() => onChange({ edge: dir })} style={{
              padding:'2px 5px', borderRadius:5, fontSize:9, fontWeight:700, cursor:'pointer',
              border:`1px solid ${edge===dir ? color : T.slate200}`,
              background:edge===dir ? color : T.white,
              color:edge===dir ? T.white : T.slate500,
            }}>{edgeMap[dir]}</button>
          ))}
          <button onClick={onDelete} style={{ background:'none', border:'none', cursor:'pointer', color:T.red600, fontSize:14, padding:'0 2px' }}>×</button>
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${fields.length},1fr)`, gap:5 }}>
        {fields.map(f => (
          <div key={f.key} style={{ textAlign:'center' }}>
            <div style={{ fontSize:9, color:T.slate400, marginBottom:2 }}>{f.label}</div>
            <input type="number" value={f.val} step={f.step??0.5} min={f.min??0}
              onChange={e => onChange({ [f.key]: Number(e.target.value) })}
              style={{ width:'100%', padding:'2px 4px', borderRadius:5, border:`1px solid ${T.slate200}`, fontSize:11, textAlign:'center', background:bg }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── MAIN PANEL ───────────────────────────────────────────────────────

export interface BuildingInspectorPanelProps { buildingId: string; }

export const BuildingInspectorPanel: React.FC<BuildingInspectorPanelProps> = ({ buildingId }) => {
  const buildings             = useEditor2DStore(s => s.buildings);
  const activeLevelIndex      = useEditor2DStore(s => s.activeLevelIndex);
  const updateBuildingProgram = useEditor2DStore(s => s.updateBuildingProgram);
  const updateFloorPlan       = useEditor2DStore(s => s.updateFloorPlan);

  const b = buildings.find(x => x.id === buildingId);
  if (!b) return null;

  const activeFloor: FloorPlan2D | undefined = b.floorPlans?.find(fp => fp.levelIndex === activeLevelIndex);
  const floorLabel = levelLabel(activeLevelIndex);

  const upB  = (patch: Partial<Building2D>) => updateBuildingProgram(buildingId, patch);
  const upFP = (patch: Partial<FloorPlan2D>) => updateFloorPlan(buildingId, activeLevelIndex, patch);

  const balconies = activeFloor?.balconies ?? [];
  const loggias   = activeFloor?.loggias   ?? [];
  const terraces  = activeFloor?.terraces  ?? [];

  const addBalcon = () => {
    const item: Balcon2D = { id:genId(), edge:'south', offsetM:0, widthM:3, depthM:1.2, levelStart:activeLevelIndex, levelEnd:activeLevelIndex };
    upFP({ balconies:[...balconies, item] });
  };
  const updateBalcon = (id:string, patch:Partial<Balcon2D>) =>
    upFP({ balconies: balconies.map(x => x.id===id ? {...x,...patch} : x) });
  const deleteBalcon = (id:string) =>
    upFP({ balconies: balconies.filter(x => x.id!==id) });

  const addLoggia = () => {
    const item: Loggia2D = { id:genId(), edge:'south', offsetM:0, widthM:2.5, depthM:1.5, levelStart:activeLevelIndex, levelEnd:activeLevelIndex };
    upFP({ loggias:[...loggias, item] });
  };
  const updateLoggia = (id:string, patch:Partial<Loggia2D>) =>
    upFP({ loggias: loggias.map(x => x.id===id ? {...x,...patch} : x) });
  const deleteLoggia = (id:string) =>
    upFP({ loggias: loggias.filter(x => x.id!==id) });

  const addTerrasse = () => {
    const vols = activeFloor?.volumes ?? [];
    const firstVol = vols[0];
    const w = firstVol ? firstVol.rect.width * 0.6 : 6;
    const d = firstVol ? firstVol.rect.depth * 0.6 : 4;
    const item: Terrasse2D = { id:genId(), kind:'roof', widthM:w, depthM:d, levelIndex:activeLevelIndex };
    upFP({ terraces:[...terraces, item] });
  };
  const updateTerrasse = (id:string, patch:Partial<Terrasse2D>) =>
    upFP({ terraces: terraces.map(x => x.id===id ? {...x,...patch} : x) });
  const deleteTerrasse = (id:string) =>
    upFP({ terraces: terraces.filter(x => x.id!==id) });

  const totalH  = b.groundFloorHeightM + b.floorsAboveGround * b.typicalFloorHeightM;
  const emprise = (b.rect.width * b.rect.depth).toFixed(0);
  const floorArea = (activeFloor?.volumes ?? []).reduce((s, v) => s + v.rect.width * v.rect.depth, 0);

  return (
    <div style={{ background:T.slate50, fontFamily:'Inter,system-ui,sans-serif' }}>

      {/* ── Header ── */}
      <div style={{ padding:'10px 14px 8px', borderBottom:`1px solid ${T.slate200}`, background:T.indigo50 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
          <span style={{ fontSize:9, fontWeight:700, color:T.indigo600, background:T.white, border:`1px solid ${T.indigo200}`, borderRadius:20, padding:'2px 6px', letterSpacing:'0.06em', textTransform:'uppercase' }}>
            ⬜ Bâtiment
          </span>
          <input value={b.label} onChange={e => upB({ label: e.target.value })}
            style={{ flex:1, border:'none', background:'transparent', fontSize:13, fontWeight:700, color:T.slate900, outline:'none' }}
          />
        </div>

        {/* KPI */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, marginBottom:6 }}>
          {[
            { label:'Emprise',  value:`${emprise} m²`         },
            { label:'Haut. tot.', value:`${totalH.toFixed(1)} m` },
            { label:'Niveaux',  value:`R+${b.floorsAboveGround}` },
          ].map(kpi => (
            <div key={kpi.label} style={{ background:T.white, border:`1px solid ${T.indigo200}`, borderRadius:8, padding:'5px 7px', textAlign:'center' }}>
              <div style={{ fontSize:9, color:T.slate400, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:2 }}>{kpi.label}</div>
              <div style={{ fontSize:12, fontWeight:700, color:T.slate900, fontVariantNumeric:'tabular-nums' }}>{kpi.value}</div>
            </div>
          ))}
        </div>

        {/* Étage actif badge */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:T.white, border:`1px solid ${T.indigo200}`, borderRadius:8, padding:'5px 10px' }}>
          <span style={{ fontSize:11, fontWeight:700, color:T.indigo600 }}>Étage actif : {floorLabel}</span>
          {activeFloor ? (
            <span style={{ fontSize:10.5, color:T.slate500, fontVariantNumeric:'tabular-nums' }}>
              {floorArea.toFixed(0)} m² · {(activeFloor.volumes?.length ?? 0)} vol.
            </span>
          ) : (
            <span style={{ fontSize:10, color:T.amber600 }}>Aucun plan à cet étage</span>
          )}
        </div>
      </div>

      <div style={{ padding:'10px 14px 14px', display:'flex', flexDirection:'column', gap:12 }}>

        {/* ── Programme volumétrique — sans Typologie ── */}
        <div>
          <SectionHeader label="Programme volumétrique" icon="📐"/>

          <NumInput label="Étages au-dessus du RDC" value={b.floorsAboveGround} min={0} max={30}
            onChange={v => upB({ floorsAboveGround: v })} />
          <NumInput label="Hauteur RDC" value={b.groundFloorHeightM} step={0.1} min={2.5} max={6} unit="m"
            onChange={v => upB({ groundFloorHeightM: v })} />
          <NumInput label="Hauteur étages courants" value={b.typicalFloorHeightM} step={0.1} min={2.4} max={5} unit="m"
            onChange={v => upB({ typicalFloorHeightM: v })} />
          <ReadonlyRow label="Hauteur totale estimée" value={`${totalH.toFixed(2)} m`}/>

          {/* Toiture */}
          <div style={{ marginTop:8 }}>
            <div style={{ fontSize:11, color:T.slate500, marginBottom:4 }}>Toiture</div>
            <div style={{ display:'flex', gap:5 }}>
              {([{val:'flat',label:'⬜ Plate'},{val:'pitched',label:'🏠 Pente'},{val:'attic',label:'🏛 Attique'}] as const).map(r => (
                <button key={r.val} onClick={() => upB({ roofType: r.val })} style={{
                  flex:1, padding:'4px 0', borderRadius:6, fontSize:10.5, fontWeight:600, cursor:'pointer',
                  border:`1px solid ${b.roofType===r.val ? T.indigo600 : T.slate200}`,
                  background:b.roofType===r.val ? T.indigo50 : T.white,
                  color:b.roofType===r.val ? T.indigo600 : T.slate600,
                }}>{r.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Façade principale ── */}
        <div>
          <SectionHeader label="Façade principale" icon="🧭"/>
          <EdgeCompass value={b.facadeMainEdge} onChange={v => upB({ facadeMainEdge: v })}/>
        </div>

        {/* ── BALCONS ── */}
        {activeFloor && (
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
              <SectionHeader label={`Balcons — ${floorLabel} (${balconies.length})`} icon="🏗"/>
              <button onClick={addBalcon} style={{ padding:'3px 10px', borderRadius:6, border:`1px solid ${T.indigo200}`, background:T.indigo50, color:T.indigo600, fontSize:10.5, fontWeight:700, cursor:'pointer', marginTop:-4 }}>+ Ajouter</button>
            </div>
            {balconies.map(bal => (
              <ElementRow key={bal.id}
                color={T.indigo600} bg={T.indigo50} borderColor={T.indigo200}
                title="Balcon" showEdge edge={bal.edge}
                fields={[
                  { label:'Larg.', key:'widthM',  val:bal.widthM,  step:0.5, min:0.5 },
                  { label:'Prof.', key:'depthM',  val:bal.depthM,  step:0.1, min:0.3 },
                  { label:'Déc.',  key:'offsetM', val:bal.offsetM, step:0.5, min:-20 },
                ]}
                onChange={p => updateBalcon(bal.id, p as Partial<Balcon2D>)}
                onDelete={() => deleteBalcon(bal.id)}
              />
            ))}
            {!balconies.length && <div style={{ fontSize:11, color:T.slate400, textAlign:'center', padding:'6px 0' }}>Aucun balcon · Ajouter →</div>}
          </div>
        )}

        {/* ── LOGGIAS ── */}
        {activeFloor && (
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
              <SectionHeader label={`Loggias — ${floorLabel} (${loggias.length})`} icon="🔲"/>
              <button onClick={addLoggia} style={{ padding:'3px 10px', borderRadius:6, border:`1px solid ${T.violet200}`, background:T.violet50, color:T.violet600, fontSize:10.5, fontWeight:700, cursor:'pointer', marginTop:-4 }}>+ Ajouter</button>
            </div>
            {loggias.map(log => (
              <ElementRow key={log.id}
                color={T.violet600} bg={T.violet50} borderColor={T.violet200}
                title="Loggia" showEdge edge={log.edge}
                fields={[
                  { label:'Larg.', key:'widthM',  val:log.widthM,  step:0.5, min:0.5 },
                  { label:'Prof.', key:'depthM',  val:log.depthM,  step:0.1, min:0.3 },
                  { label:'Déc.',  key:'offsetM', val:log.offsetM, step:0.5, min:-20 },
                ]}
                onChange={p => updateLoggia(log.id, p as Partial<Loggia2D>)}
                onDelete={() => deleteLoggia(log.id)}
              />
            ))}
            {!loggias.length && <div style={{ fontSize:11, color:T.slate400, textAlign:'center', padding:'6px 0' }}>Aucune loggia · Ajouter →</div>}
          </div>
        )}

        {/* ── TERRASSES ── */}
        {activeFloor && (
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
              <SectionHeader label={`Terrasses — ${floorLabel} (${terraces.length})`} icon="☀️"/>
              <button onClick={addTerrasse} style={{ padding:'3px 10px', borderRadius:6, border:`1px solid ${T.teal200}`, background:T.teal50, color:T.teal600, fontSize:10.5, fontWeight:700, cursor:'pointer', marginTop:-4 }}>+ Ajouter</button>
            </div>
            {terraces.map(t => (
              <div key={t.id} style={{ background:T.white, border:`1px solid ${T.teal200}`, borderRadius:8, padding:'7px 9px', marginBottom:6 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                  <div style={{ display:'flex', gap:5 }}>
                    {(['roof','setback'] as const).map(k => (
                      <button key={k} onClick={() => updateTerrasse(t.id, { kind:k })} style={{
                        padding:'2px 7px', borderRadius:5, fontSize:9.5, fontWeight:700, cursor:'pointer',
                        border:`1px solid ${t.kind===k ? T.teal600 : T.slate200}`,
                        background:t.kind===k ? T.teal600 : T.white,
                        color:t.kind===k ? T.white : T.slate500,
                      }}>{k==='roof' ? 'Rooftop' : 'Retrait'}</button>
                    ))}
                  </div>
                  <button onClick={() => deleteTerrasse(t.id)} style={{ background:'none', border:'none', cursor:'pointer', color:T.red600, fontSize:14, padding:'0 2px' }}>×</button>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
                  {[
                    { label:'Larg.', key:'widthM', val:t.widthM, step:0.5, min:1 },
                    { label:'Prof.', key:'depthM', val:t.depthM, step:0.5, min:1 },
                  ].map(f => (
                    <div key={f.key} style={{ textAlign:'center' }}>
                      <div style={{ fontSize:9, color:T.slate400, marginBottom:2 }}>{f.label}</div>
                      <input type="number" value={f.val} step={f.step} min={f.min}
                        onChange={e => updateTerrasse(t.id, { [f.key]: Number(e.target.value) })}
                        style={{ width:'100%', padding:'2px 4px', borderRadius:5, border:`1px solid ${T.slate200}`, fontSize:11, textAlign:'center', background:T.teal50 }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!terraces.length && <div style={{ fontSize:11, color:T.slate400, textAlign:'center', padding:'6px 0' }}>Aucune terrasse · Ajouter →</div>}
          </div>
        )}

        {!activeFloor && (
          <div style={{ background:T.amber50, border:`1px solid #fde68a`, borderRadius:10, padding:'10px 14px', fontSize:11.5, color:T.amber600, lineHeight:1.5 }}>
            ⚠️ Aucun plan pour <strong>{floorLabel}</strong> sur ce bâtiment.<br/>
            Utilisez <strong>Dupliquer {levelLabel(activeLevelIndex-1)}</strong> dans le sélecteur d'étages pour créer ce niveau.
          </div>
        )}

      </div>
    </div>
  );
};

export default BuildingInspectorPanel;