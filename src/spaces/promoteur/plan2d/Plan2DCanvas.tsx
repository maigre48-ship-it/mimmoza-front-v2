// src/spaces/promoteur/plan2d/Plan2DCanvas.tsx — V5.1 multi-étages
//
// V5.1 : Pan sur clic-glisser fond vide (sélection)
//   + curseur grab/grabbing cohérent
//   Aucune régression fonctionnelle.

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useEditor2DStore, getFloorVolumes, getBuildingVolumes } from './editor2d.store';
import { DimensionOverlay } from './DimensionOverlay';
import {
  rectCorners, rectFromTwoPoints, squareFromTwoPoints,
  rectFromCenterAndPoint, squareFromCenterAndPoint, clampRectSize,
  rotationHandlePos, normalizeAngleDeg,
  rectFullyInsidePolygon, rectPartiallyInsidePolygon,
  moveRect, resizeRectFromHandle, pointHitsRect,
  toSvgPoints, polygonBBox, genId, computeParkingSlots, dist, angleDeg,
} from './editor2d.geometry';
import { snapPoint } from './editor2d.snap';
import type {
  Point2D, Building2D, Parking2D, DrawState, DragState,
  OrientedRect, HandleId, FacadeEdge, FloorPlan2D,
} from './editor2d.types';
import type { BuildingVolume2D, Balcon2D, Loggia2D, Terrasse2D } from './buildingProgram.types';
import {
  computeBuildableEnvelope, nearestParcelEdge,
  isRectPartiallyInsidePolygon, pointInPolygon,
} from './pluEnvelope.geometry';

// ── Helpers de base ───────────────────────────────────────────────────

function clamp(n:number,min:number,max:number){ return Math.max(min,Math.min(max,n)); }

function svgPoint(cx:number,cy:number,svg:SVGSVGElement):Point2D{
  const sr=svg.getBoundingClientRect(), vb=svg.viewBox.baseVal;
  if(sr.width<=0||sr.height<=0) return {x:0,y:0};
  if(!isFinite(vb.width)||vb.width<=0||!isFinite(vb.height)||vb.height<=0)
    return {x:cx-sr.left,y:cy-sr.top};
  return { x:vb.x+(cx-sr.left)*vb.width/sr.width, y:vb.y+(cy-sr.top)*vb.height/sr.height };
}
function svgZoom(svg:SVGSVGElement):number{
  const sr=svg.getBoundingClientRect(),vb=svg.viewBox.baseVal;
  if(sr.width>0&&isFinite(vb.width)&&vb.width>0) return sr.width/vb.width;
  if(sr.height>0&&isFinite(vb.height)&&vb.height>0) return sr.height/vb.height;
  return 1;
}

// ── Caméra ────────────────────────────────────────────────────────────

interface Camera { x:number;y:number;w:number;h:number }
function makeVB(poly:Point2D[],svgW:number,svgH:number,pad=15):Camera{
  if(!poly.length) return {x:-50,y:-50,w:100,h:100};
  const {min,max}=polygonBBox(poly);
  const pw=max.x-min.x+pad*2, ph=max.y-min.y+pad*2, asp=svgW/svgH;
  let vw=pw,vh=ph;
  if(pw/ph>asp) vh=pw/asp; else vw=ph*asp;
  return {x:min.x-pad-(vw-pw)/2,y:min.y-pad-(vh-ph)/2,w:vw,h:vh};
}

// ── Handles ───────────────────────────────────────────────────────────

const HANDLE_PX=9, ROT_HANDLE_PX=10, ROT_GAP=6;

function buildHandles(rect:OrientedRect){
  const [nw,ne,se,sw]=rectCorners(rect);
  const m=(a:Point2D,b:Point2D):Point2D=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  return [
    {id:'resize-nw' as HandleId,pos:nw},{id:'resize-n' as HandleId,pos:m(nw,ne)},
    {id:'resize-ne' as HandleId,pos:ne},{id:'resize-e' as HandleId,pos:m(ne,se)},
    {id:'resize-se' as HandleId,pos:se},{id:'resize-s' as HandleId,pos:m(se,sw)},
    {id:'resize-sw' as HandleId,pos:sw},{id:'resize-w' as HandleId,pos:m(sw,nw)},
  ];
}
function hitHandle(p:Point2D,rect:OrientedRect,zoom:number):HandleId|null{
  const thresh=HANDLE_PX/zoom, rh=rotationHandlePos(rect,ROT_GAP);
  if(dist(p,rh)<ROT_HANDLE_PX/zoom) return 'rotate';
  for(const h of buildHandles(rect)) if(dist(p,h.pos)<thresh) return h.id;
  return null;
}
function computeDrawRect(draw:DrawState):OrientedRect{
  const {origin,current,square,fromCenter}=draw;
  if(fromCenter&&square) return squareFromCenterAndPoint(origin,current);
  if(fromCenter)         return rectFromCenterAndPoint(origin,current);
  if(square)             return squareFromTwoPoints(origin,current);
  return rectFromTwoPoints(origin,current);
}

// ── Volumes par étage ─────────────────────────────────────────────────

function getEffectiveFloorVolumes(
  b:Building2D, levelIndex:number, liveRects:Record<string,OrientedRect>
):BuildingVolume2D[]{
  const baseVols = getFloorVolumes(b, levelIndex);
  const liveRect = liveRects[b.id];
  if(!liveRect || !baseVols.length) return baseVols;

  const dx=liveRect.center.x-b.rect.center.x, dy=liveRect.center.y-b.rect.center.y;
  const drot=liveRect.rotationDeg-b.rect.rotationDeg, hasRot=Math.abs(drot)>0.001;

  return baseVols.map(v=>{
    let cx=v.rect.center.x+dx, cy=v.rect.center.y+dy;
    if(hasRot){
      const gc=liveRect.center, rad=drot*Math.PI/180;
      const cos=Math.cos(rad), sin=Math.sin(rad);
      const rx=cx-gc.x, ry=cy-gc.y;
      cx=gc.x+rx*cos-ry*sin; cy=gc.y+rx*sin+ry*cos;
    }
    return {...v, rect:{...v.rect, center:{x:cx,y:cy}, rotationDeg:((v.rect.rotationDeg+drot)%360+360)%360}};
  });
}

function globalCenter(vols:BuildingVolume2D[]):Point2D{
  if(!vols.length) return {x:0,y:0};
  return { x:vols.reduce((s,v)=>s+v.rect.center.x,0)/vols.length, y:vols.reduce((s,v)=>s+v.rect.center.y,0)/vols.length };
}

function dot2(a:Point2D,b:Point2D){ return a.x*b.x+a.y*b.y; }
function sub2(a:Point2D,b:Point2D):Point2D{ return {x:a.x-b.x,y:a.y-b.y}; }
function lenSq2(v:Point2D){ return v.x*v.x+v.y*v.y; }

function ptSegDist(p:Point2D,a:Point2D,b:Point2D):number{
  const ab=sub2(b,a), ap=sub2(p,a), ab2=lenSq2(ab);
  if(ab2<1e-9) return Math.sqrt(lenSq2(ap));
  const t=Math.max(0,Math.min(1,dot2(ap,ab)/ab2));
  return Math.sqrt(lenSq2(sub2(p,{x:a.x+ab.x*t,y:a.y+ab.y*t})));
}

function segsIntersect(a1:Point2D,a2:Point2D,b1:Point2D,b2:Point2D):boolean{
  const cross=(u:Point2D,v:Point2D)=>u.x*v.y-u.y*v.x;
  const d1=sub2(a2,a1),d2=sub2(b2,b1),dn=cross(d1,d2);
  if(Math.abs(dn)<1e-9) return false;
  const t=cross(sub2(b1,a1),d2)/dn, u=cross(sub2(b1,a1),d1)/dn;
  return t>=0&&t<=1&&u>=0&&u<=1;
}

function ptInConvex(p:Point2D,poly:Point2D[]):boolean{
  let sign=0;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    const c=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
    if(Math.abs(c)<1e-9) continue;
    const s=Math.sign(c);
    if(!sign) sign=s; else if(sign!==s) return false;
  }
  return true;
}

function rectsMinDist(r1:OrientedRect,r2:OrientedRect):number{
  const c1=rectCorners(r1), c2=rectCorners(r2);
  if(ptInConvex(c1[0],c2)||ptInConvex(c2[0],c1)) return 0;
  const e1:[[Point2D,Point2D]][] = c1.map((_,i)=>[[c1[i],c1[(i+1)%4]]]) as any;
  const e2:[[Point2D,Point2D]][] = c2.map((_,i)=>[[c2[i],c2[(i+1)%4]]]) as any;
  for(let i=0;i<4;i++) for(let j=0;j<4;j++) if(segsIntersect(c1[i],c1[(i+1)%4],c2[j],c2[(j+1)%4])) return 0;
  let d=Infinity;
  for(let i=0;i<4;i++) for(let j=0;j<4;j++){
    const [a1,a2]=[c1[i],c1[(i+1)%4]], [b1,b2]=[c2[j],c2[(j+1)%4]];
    d=Math.min(d,ptSegDist(a1,b1,b2),ptSegDist(a2,b1,b2),ptSegDist(b1,a1,a2),ptSegDist(b2,a1,a2));
  }
  return d;
}

// ── Suppression des murs intérieurs ───────────────────────────────────

function rotatePointAround(p:Point2D,center:Point2D,deg:number):Point2D{
  const r=deg*Math.PI/180,cos=Math.cos(r),sin=Math.sin(r);
  const dx=p.x-center.x,dy=p.y-center.y;
  return {x:center.x+dx*cos-dy*sin,y:center.y+dx*sin+dy*cos};
}
function toLocalPoint(p:Point2D,rect:OrientedRect):Point2D{ return rotatePointAround(p,rect.center,-rect.rotationDeg); }
function toWorldPoint(p:Point2D,rect:OrientedRect):Point2D{ return rotatePointAround(p,rect.center,rect.rotationDeg); }

type EdgeSegment={a:Point2D;b:Point2D};

function subtractSegByLocalRect(aL:Point2D,bL:Point2D,r:OrientedRect,tol=0.08):EdgeSegment[]{
  const hw=r.width/2+tol,hd=r.depth/2+tol;
  const minX=r.center.x-hw,maxX=r.center.x+hw,minY=r.center.y-hd,maxY=r.center.y+hd;
  if(Math.abs(aL.x-bL.x)<1e-5){
    const x=aL.x;
    if(x<minX||x>maxX) return [{a:aL,b:bL}];
    const y1=Math.min(aL.y,bL.y),y2=Math.max(aL.y,bL.y);
    const os=Math.max(y1,minY),oe=Math.min(y2,maxY);
    if(oe<=os) return [{a:aL,b:bL}];
    const out:EdgeSegment[]=[];
    if(os>y1) out.push({a:{x,y:y1},b:{x,y:os}});
    if(oe<y2) out.push({a:{x,y:oe},b:{x,y:y2}});
    return out;
  }
  if(Math.abs(aL.y-bL.y)<1e-5){
    const y=aL.y;
    if(y<minY||y>maxY) return [{a:aL,b:bL}];
    const x1=Math.min(aL.x,bL.x),x2=Math.max(aL.x,bL.x);
    const os=Math.max(x1,minX),oe=Math.min(x2,maxX);
    if(oe<=os) return [{a:aL,b:bL}];
    const out:EdgeSegment[]=[];
    if(os>x1) out.push({a:{x:x1,y},b:{x:os,y}});
    if(oe<x2) out.push({a:{x:oe,y},b:{x:x2,y}});
    return out;
  }
  return [{a:aL,b:bL}];
}

function segLen(a:Point2D,b:Point2D):number{ return Math.hypot(b.x-a.x,b.y-a.y); }

function getVisibleEdgeSegments(edge:[Point2D,Point2D],vol:BuildingVolume2D,selfIdx:number,vols:BuildingVolume2D[]):EdgeSegment[]{
  let segs:EdgeSegment[]=[{a:toLocalPoint(edge[0],vol.rect),b:toLocalPoint(edge[1],vol.rect)}];
  for(let i=0;i<vols.length;i++){
    if(i===selfIdx||!segs.length) continue;
    const other=vols[i];
    segs=segs.flatMap(seg=>{
      const aOL=toLocalPoint(toWorldPoint(seg.a,vol.rect),other.rect);
      const bOL=toLocalPoint(toWorldPoint(seg.b,vol.rect),other.rect);
      return subtractSegByLocalRect(aOL,bOL,other.rect).map(p=>({
        a:toLocalPoint(toWorldPoint(p.a,other.rect),vol.rect),
        b:toLocalPoint(toWorldPoint(p.b,other.rect),vol.rect),
      }));
    });
  }
  return segs
    .map(s=>({a:toWorldPoint(s.a,vol.rect),b:toWorldPoint(s.b,vol.rect)}))
    .filter(s=>segLen(s.a,s.b)>0.12);
}

function getVisibleOutlineSegments(vol:BuildingVolume2D,selfIdx:number,vols:BuildingVolume2D[]):EdgeSegment[]{
  const c=rectCorners(vol.rect);
  return ([[c[0],c[1]],[c[1],c[2]],[c[2],c[3]],[c[3],c[0]]] as [Point2D,Point2D][])
    .flatMap(edge=>getVisibleEdgeSegments(edge,vol,selfIdx,vols));
}

function pointInOrientedRect(p:Point2D,rect:OrientedRect,tol=0.08):boolean{
  const local=rotatePointAround(p,rect.center,-rect.rotationDeg);
  const dx=Math.abs(local.x-rect.center.x),dy=Math.abs(local.y-rect.center.y);
  return dx<=rect.width/2+tol&&dy<=rect.depth/2+tol;
}

function isMostlyHiddenVolume(vol:BuildingVolume2D,selfIdx:number,vols:BuildingVolume2D[]):boolean{
  const c=rectCorners(vol.rect);
  const testPts=[
    vol.rect.center,
    ...c,
    {x:(c[0].x+c[1].x)/2,y:(c[0].y+c[1].y)/2},
    {x:(c[1].x+c[2].x)/2,y:(c[1].y+c[2].y)/2},
    {x:(c[2].x+c[3].x)/2,y:(c[2].y+c[3].y)/2},
    {x:(c[3].x+c[0].x)/2,y:(c[3].y+c[0].y)/2},
  ];
  let hidden=0;
  for(const p of testPts){
    for(let i=0;i<vols.length;i++){
      if(i===selfIdx) continue;
      if(pointInOrientedRect(p,vols[i].rect,0.12)){ hidden++; break; }
    }
  }
  return hidden>=testPts.length*0.6;
}

// ── Parking slots ─────────────────────────────────────────────────────

function ParkingSlots({rect,sw2,sd,aw}:{rect:OrientedRect;sw2:number;sd:number;aw:number}){
  const {width,depth,center,rotationDeg}=rect;
  const ox=center.x-width/2, oy=center.y-depth/2, bayH=sd*2+aw;
  const els:React.ReactNode[]=[];
  let k=0,y=oy;
  while(y<oy+depth){
    const dbl=y+bayH<=oy+depth+0.01, sgl=!dbl&&y+sd<=oy+depth;
    if(!dbl&&!sgl) break;
    for(let x=ox;x+sw2<=ox+width+0.01;x+=sw2)
      els.push(<rect key={k++} x={x} y={y} width={sw2} height={sd} fill="none" stroke="#93c5fd" strokeWidth={0.18}/>);
    if(dbl){ const y2=y+sd+aw; for(let x=ox;x+sw2<=ox+width+0.01;x+=sw2) els.push(<rect key={k++} x={x} y={y2} width={sw2} height={sd} fill="none" stroke="#93c5fd" strokeWidth={0.18}/>); y+=bayH; }
    else y+=sd;
  }
  return <g transform={`rotate(${rotationDeg},${center.x},${center.y})`}>{els}</g>;
}

// ── Programme bâtiment ────────────────────────────────────────────────

function compassToEdgeIndex(compass:FacadeEdge,rotationDeg:number):number{
  const idx=({north:0,east:1,south:2,west:3} as const)[compass];
  return (idx+(((Math.round(rotationDeg/90)%4)+4)%4))%4;
}
function getEdgePts(corners:Point2D[],ei:number):[Point2D,Point2D]{
  const map:[number,number][]= [[0,1],[1,2],[2,3],[3,0]];
  return [corners[map[ei][0]],corners[map[ei][1]]];
}
function edgeProj(corners:Point2D[],ei:number,offsetM:number,widthM:number,depthM:number,dir:1|-1):string{
  const [p1,p2]=getEdgePts(corners,ei);
  const dx=p2.x-p1.x,dy=p2.y-p1.y,len=Math.sqrt(dx*dx+dy*dy);
  if(len<0.01) return '';
  const ex=dx/len,ey=dy/len,nx=ey,ny=-ex;
  const mx=(p1.x+p2.x)/2+ex*offsetM, my=(p1.y+p2.y)/2+ey*offsetM, hw=widthM/2;
  return [{x:mx-ex*hw,y:my-ey*hw},{x:mx+ex*hw,y:my+ey*hw},{x:mx+ex*hw+nx*depthM*dir,y:my+ey*hw+ny*depthM*dir},{x:mx-ex*hw+nx*depthM*dir,y:my-ey*hw+ny*depthM*dir}].map(p=>`${p.x},${p.y}`).join(' ');
}

function BuildingProgramElements({b, activeFloor, sw}:{b:Building2D; activeFloor?:FloorPlan2D; sw:(px:number)=>number}){
  const balconies = activeFloor?.balconies ?? b.balconies ?? [];
  const loggias   = activeFloor?.loggias   ?? b.loggias   ?? [];
  const terraces  = activeFloor?.terraces  ?? b.terraces  ?? [];
  const has=!!b.facadeMainEdge||balconies.length>0||loggias.length>0||terraces.length>0;
  if(!has) return null;
  const corners=rectCorners(b.rect), rot=b.rect.rotationDeg, cx=b.rect.center.x, cy=b.rect.center.y;
  return (
    <g pointerEvents="none">
      {b.facadeMainEdge&&(()=>{
        const ei=compassToEdgeIndex(b.facadeMainEdge!,rot);
        const [p1,p2]=getEdgePts(corners,ei); const mx=(p1.x+p2.x)/2,my=(p1.y+p2.y)/2;
        return <><line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#ef4444" strokeWidth={sw(4)} strokeLinecap="round" opacity={0.85}/><circle cx={mx} cy={my} r={sw(5)} fill="#ef4444"/><text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={sw(6.5)} fill="white" fontFamily="Inter,sans-serif" fontWeight="800">{({north:'N',east:'E',south:'S',west:'O'} as const)[b.facadeMainEdge!]}</text></>;
      })()}
      {balconies.map((bal:Balcon2D)=>{const pts=edgeProj(corners,compassToEdgeIndex(bal.edge,rot),bal.offsetM,bal.widthM,bal.depthM,1); return pts?<polygon key={`bal-${bal.id}`} points={pts} fill="rgba(79,70,229,0.20)" stroke="#4f46e5" strokeWidth={sw(1.25)}/>:null;})}
      {loggias.map((log:Loggia2D)=>{const pts=edgeProj(corners,compassToEdgeIndex(log.edge,rot),log.offsetM,log.widthM,log.depthM,-1); return pts?<polygon key={`log-${log.id}`} points={pts} fill="rgba(255,255,255,0.82)" stroke="#7c3aed" strokeWidth={sw(1)} strokeDasharray={`${sw(2.5)},${sw(1.5)}`}/>:null;})}
      {terraces.map((t:Terrasse2D)=>{const hw=t.widthM/2,hd=t.depthM/2,patId=`tph-${t.id}`,gs=sw(3);const pts=`${cx-hw},${cy-hd} ${cx+hw},${cy-hd} ${cx+hw},${cy+hd} ${cx-hw},${cy+hd}`;return(<g key={`terr-${t.id}`}><defs><pattern id={patId} patternUnits="userSpaceOnUse" width={gs} height={gs} patternTransform={`rotate(45,${cx},${cy})`}><line x1="0" y1="0" x2="0" y2={gs} stroke="#0d9488" strokeWidth={sw(0.5)}/></pattern></defs><polygon points={pts} fill={`url(#${patId})`} stroke="#0d9488" strokeWidth={sw(1)} transform={`rotate(${rot},${cx},${cy})`}/></g>);})}
    </g>
  );
}

// ── Selection overlay ─────────────────────────────────────────────────

function SelectionOverlayV2({buildings,parkings,selectedIds,liveRects,hoveredHandle,zoom}:{
  buildings:Building2D[];parkings:Parking2D[];selectedIds:string[];
  liveRects:Record<string,OrientedRect>;hoveredHandle:{entityId:string;handle:HandleId}|null;zoom:number;
}){
  const sw=(px:number)=>px/zoom;
  return <>{selectedIds.map(id=>{
    const entity=buildings.find(b=>b.id===id)??parkings.find(p=>p.id===id);
    if(!entity) return null;
    const rect=liveRects[id]??entity.rect;
    const [nw,ne,se,sw2]=rectCorners(rect), color=entity.kind==='parking'?'#2563eb':'#4f46e5';
    const mid=(a:Point2D,b:Point2D):Point2D=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
    const rotPos=rotationHandlePos(rect,ROT_GAP), topMid=mid(nw,ne);
    const isHovRot=hoveredHandle?.entityId===id&&hoveredHandle?.handle==='rotate';
    const pts=[nw,ne,se,sw2].map(p=>`${p.x},${p.y}`).join(' ');
    return (<g key={id} pointerEvents="none">
      <polygon points={pts} fill="none" stroke={color} strokeWidth={sw(1.5)} strokeDasharray={`${sw(4)},${sw(2)}`} opacity={0.9}/>
      <line x1={topMid.x} y1={topMid.y} x2={rotPos.x} y2={rotPos.y} stroke={color} strokeWidth={sw(1)} strokeDasharray={`${sw(2)},${sw(2)}`} opacity={0.4}/>
      <circle cx={rotPos.x} cy={rotPos.y} r={isHovRot?sw(6.5):sw(5)} fill={isHovRot?color:'white'} stroke={color} strokeWidth={sw(1.5)}/>
      <text x={rotPos.x} y={rotPos.y} textAnchor="middle" dominantBaseline="middle" fontSize={sw(isHovRot?7:6)} fill={isHovRot?'white':color}>↻</text>
      {buildHandles(rect).map(h=>{const isHov=hoveredHandle?.entityId===id&&hoveredHandle?.handle===h.id,r2=isHov?sw(5.5):sw(4.5);return <rect key={h.id} x={h.pos.x-r2} y={h.pos.y-r2} width={r2*2} height={r2*2} rx={r2*0.3} fill={isHov?color:'white'} stroke={color} strokeWidth={sw(1.5)}/>;})}
    </g>);
  })}</>;
}

// ── Sélecteur d'étages ────────────────────────────────────────────────

function FloorSelector({buildings,activeLevelIndex,showGhost,storeActions}:{
  buildings:Building2D[]; activeLevelIndex:number; showGhost:boolean;
  storeActions:{setActiveLevelIndex:(n:number)=>void; setShowGhost:(v:boolean)=>void; addFloorToAll:(n:number)=>void; duplicateFloorToActive:()=>void; removeFloor:(n:number)=>void};
}){
  const levels = useMemo(()=>{
    const s=new Set<number>([0]);
    buildings.forEach(b=>(b.floorPlans??[]).forEach(fp=>s.add(fp.levelIndex)));
    return Array.from(s).sort((a,b)=>a-b);
  },[buildings]);

  const maxLevel = levels[levels.length-1] ?? 0;
  const lbl = (n:number) => n===0?'RDC':`R+${n}`;

  const btnBase:React.CSSProperties = {
    padding:'4px 12px', borderRadius:8, fontSize:12, fontWeight:700,
    cursor:'pointer', border:'1px solid', transition:'all 0.12s', height:30,
    display:'flex', alignItems:'center', gap:4,
  };

  return (
    <div style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 8px', background:'rgba(255,255,255,0.95)', borderRadius:12, border:'1px solid #e2e8f0', boxShadow:'0 2px 12px rgba(0,0,0,0.10)', backdropFilter:'blur(8px)' }}>
      {levels.map(li=>{
        const active=li===activeLevelIndex;
        return (
          <button key={li} onClick={()=>storeActions.setActiveLevelIndex(li)}
            style={{ ...btnBase, background:active?'#4f46e5':'transparent', color:active?'white':'#64748b', borderColor:active?'#4f46e5':'transparent' }}>
            {lbl(li)}
          </button>
        );
      })}

      <div style={{width:1,height:20,background:'#e2e8f0',margin:'0 2px'}}/>

      <button onClick={()=>storeActions.addFloorToAll(maxLevel+1)}
        style={{ ...btnBase, background:'#f1f5f9', color:'#475569', borderColor:'#e2e8f0' }}
        title="Ajouter un étage vide à tous les bâtiments">
        + Étage
      </button>

      {activeLevelIndex>0 && (
        <button onClick={()=>storeActions.duplicateFloorToActive()}
          style={{ ...btnBase, background:'#ede9fe', color:'#4f46e5', borderColor:'#c4b5fd' }}
          title={`Copier ${lbl(activeLevelIndex-1)} → ${lbl(activeLevelIndex)} pour tous les bâtiments`}>
          ⎘ Dupliquer {lbl(activeLevelIndex-1)}
        </button>
      )}

      {activeLevelIndex>0 && (
        <button
          onClick={()=>{ if(window.confirm(`Supprimer l'étage ${lbl(activeLevelIndex)} de tous les bâtiments ?`)) storeActions.removeFloor(activeLevelIndex); }}
          style={{ ...btnBase, background:'#fef2f2', color:'#dc2626', borderColor:'#fecaca' }}
          title={`Supprimer ${lbl(activeLevelIndex)}`}>
          ✕
        </button>
      )}

      <div style={{width:1,height:20,background:'#e2e8f0',margin:'0 2px'}}/>

      <button onClick={()=>storeActions.setShowGhost(!showGhost)}
        style={{ ...btnBase, background:showGhost?'#f0fdf4':'#f8fafc', color:showGhost?'#15803d':'#94a3b8', borderColor:showGhost?'#86efac':'#e2e8f0' }}
        title={showGhost?'Masquer le fantôme de l\'étage inférieur':'Afficher le fantôme de l\'étage inférieur'}>
        {showGhost?'👁 Fantôme':'👁 Fantôme'}
      </button>
    </div>
  );
}

// ── Fusion par groupes connectés ──────────────────────────────────────

function findMergeGroups(
  buildings: Building2D[],
  levelIndex: number,
  thresholdM: number,
): string[][] {
  const candidates = buildings.filter(b => b.kind === 'building');
  const ids = candidates.map(b => b.id);
  const adj = new Map<string, Set<string>>();
  ids.forEach(id => adj.set(id, new Set()));

  for(let i=0;i<candidates.length;i++){
    for(let j=i+1;j<candidates.length;j++){
      const a=candidates[i], b=candidates[j];
      const av=getFloorVolumes(a,levelIndex).filter(v=>v.role!=='connector');
      const bv=getFloorVolumes(b,levelIndex).filter(v=>v.role!=='connector');
      if(!av.length||!bv.length) continue;
      const close=av.some(va=>bv.some(vb=>rectsMinDist(va.rect,vb.rect)<thresholdM));
      if(close){ adj.get(a.id)!.add(b.id); adj.get(b.id)!.add(a.id); }
    }
  }

  const visited=new Set<string>(), groups:string[][]=[];
  for(const id of ids){
    if(visited.has(id)) continue;
    const stack=[id], group:string[]=[];
    while(stack.length){
      const cur=stack.pop()!;
      if(visited.has(cur)) continue;
      visited.add(cur); group.push(cur);
      for(const nxt of adj.get(cur)??[]) if(!visited.has(nxt)) stack.push(nxt);
    }
    if(group.length>1) groups.push(group);
  }
  return groups;
}

// ── Composant principal ───────────────────────────────────────────────

export interface Plan2DCanvasProps {
  parcellePolygon:Point2D[]; height?:number; className?:string; style?:React.CSSProperties;
}

export function Plan2DCanvas({parcellePolygon,height,className,style}:Plan2DCanvasProps){
  const wrapperRef=useRef<HTMLDivElement>(null!);
  const svgRef=useRef<SVGSVGElement>(null!);
  const [size,setSize]=useState({w:800,h:height??560});

  useEffect(()=>{
    const el=wrapperRef.current; if(!el) return;
    const ro=new ResizeObserver(([e])=>{ const {width,height:h2}=e.contentRect; if(width>10&&h2>10) setSize({w:Math.round(width),h:Math.round(h2)}); });
    ro.observe(el); return ()=>ro.disconnect();
  },[]);

  const baseVB=useMemo(()=>makeVB(parcellePolygon,size.w,size.h),[parcellePolygon,size.w,size.h]);
  const [camera,setCamera]=useState<Camera>(baseVB);
  useEffect(()=>{ setCamera(baseVB); /* eslint-disable-next-line */ },[baseVB.x,baseVB.y,baseVB.w,baseVB.h]);

  const viewBox=`${camera.x} ${camera.y} ${camera.w} ${camera.h}`;
  const approxZoom=size.w/camera.w;
  const sw=(px:number)=>px/approxZoom;

  const cameraRef=useRef(camera); cameraRef.current=camera;
  const baseVBRef=useRef(baseVB); baseVBRef.current=baseVB;

  useEffect(()=>{
    const svg=svgRef.current; if(!svg) return;
    function handler(e:WheelEvent){ e.preventDefault(); const p=svgPoint(e.clientX,e.clientY,svg!),cam=cameraRef.current,bvb=baseVBRef.current; const factor=e.deltaY>0?1.12:0.88; const nextW=clamp(cam.w*factor,bvb.w*0.1,bvb.w*10),nextH=clamp(cam.h*factor,bvb.h*0.1,bvb.h*10); const rx=cam.w>0?(p.x-cam.x)/cam.w:0.5,ry=cam.h>0?(p.y-cam.y)/cam.h:0.5; setCamera({x:p.x-rx*nextW,y:p.y-ry*nextH,w:nextW,h:nextH}); }
    svg.addEventListener('wheel',handler,{passive:false}); return ()=>svg.removeEventListener('wheel',handler);
  },[]);

  const zoomBy=useCallback((factor:number)=>{ setCamera(cam=>{ const cx=cam.x+cam.w/2,cy=cam.y+cam.h/2,bvb=baseVBRef.current; const nextW=clamp(cam.w*factor,bvb.w*0.1,bvb.w*10),nextH=clamp(cam.h*factor,bvb.h*0.1,bvb.h*10); return {x:cx-nextW/2,y:cy-nextH/2,w:nextW,h:nextH}; }); },[]);
  const resetCamera=useCallback(()=>setCamera(baseVBRef.current),[]);

  // ── Store ────────────────────────────────────────────────────────
  const store=useEditor2DStore();
  const storeRef=useRef(store); storeRef.current=store;
  const {buildings,parkings,selectedIds,hoveredId,cotesVisible,activeTool,activeLevelIndex,showGhost,parcelFrontEdgeIndex,setbackRules}=store;

  // ── Façade terrain & enveloppe constructible ──────────────────────
  const [selectingFacade, setSelectingFacade]   = useState(false);
  const [hoveredEdgeIdx,  setHoveredEdgeIdx]    = useState<number|null>(null);

  const buildableEnvelope = useMemo(() => {
    if (parcelFrontEdgeIndex === null || parcellePolygon.length < 3) return null;
    return computeBuildableEnvelope(parcellePolygon, parcelFrontEdgeIndex, setbackRules);
  }, [parcellePolygon, parcelFrontEdgeIndex, setbackRules]);

  const [previewDraw,setPreviewDraw]=useState<DrawState|null>(null);
  const [liveRects,setLiveRects]=useState<Record<string,OrientedRect>>({});
  const liveRectsRef=useRef<Record<string,OrientedRect>>({});
  const [hoveredHandle,setHoveredHandle]=useState<{entityId:string;handle:HandleId}|null>(null);
  const [spaceDown,setSpaceDown]=useState(false);
  const [isPanning,setIsPanning]=useState(false);

  // ── V5.1 : état "survol fond vide" pour le curseur grab ──────────
  // true quand la souris est sur le fond en mode sélection (pas d'entité).
  const [isHoverEmpty,setIsHoverEmpty]=useState(false);

  // ── Fusion auto ──────────────────────────────────────────────────
  const [fusionAuto,setFusionAuto]=useState(false);
  const fusionAutoRef=useRef(false); fusionAutoRef.current=fusionAuto;
  const FUSION_THRESHOLD_M = 2.5;

  const handleToggleFusion=useCallback(()=>{
    const next=!fusionAutoRef.current;
    if(!next){
      const mergedComposites=storeRef.current.buildings.filter(b=>
        b.floorPlans?.some(fp=>fp.volumes.some(v=>v.role==='connector'))
      );
      mergedComposites.forEach(b=>storeRef.current.splitBuilding(b.id));
      setFusionAuto(false);
      return;
    }
    setFusionAuto(true);
    const {buildings:curBuildings, activeLevelIndex:ali}=storeRef.current;
    const groups=findMergeGroups(curBuildings,ali,FUSION_THRESHOLD_M);
    for(const group of groups) storeRef.current.mergeBuildings(group);
  },[]);

  interface PanStart{startClientX:number;startClientY:number;cameraX:number;cameraY:number;cameraW:number;cameraH:number;svgW:number;svgH:number;}
  const ts=useRef({ isDown:false, draw:null as DrawState|null, drag:null as DragState|null, pos:{clientX:0,clientY:0}, shiftKey:false, altKey:false, spaceKey:false, panStart:null as PanStart|null });
  const rafId=useRef(0);

  const effectiveBuildings=useMemo(()=>buildings.map(b=>({...b,rect:liveRects[b.id]??b.rect})),[buildings,liveRects]);
  const effectiveParkings=useMemo(()=>parkings.map(p=>({...p,rect:liveRects[p.id]??p.rect})),[parkings,liveRects]);

  const getWorld=useCallback((cx:number,cy:number)=>svgRef.current?svgPoint(cx,cy,svgRef.current):{x:0,y:0},[]);
  const getZoom=useCallback(()=>svgRef.current?svgZoom(svgRef.current):approxZoom,[approxZoom]);

  const hitEntity=useCallback((p:Point2D):string|null=>{
    const {buildings:bs,parkings:ps,activeLevelIndex:ali}=storeRef.current;
    for(let i=bs.length-1;i>=0;i--){
      const vols=getEffectiveFloorVolumes(bs[i],ali,liveRectsRef.current);
      if(vols.some(v=>pointHitsRect(p,v.rect))) return bs[i].id;
    }
    for(let i=ps.length-1;i>=0;i--) if(pointHitsRect(p,liveRectsRef.current[ps[i].id]??ps[i].rect)) return ps[i].id;
    return null;
  },[]);

  const getEffectiveRect=useCallback((id:string):OrientedRect|null=>{
    if(liveRectsRef.current[id]) return liveRectsRef.current[id];
    const {buildings:bs,parkings:ps}=storeRef.current;
    return bs.find(b=>b.id===id)?.rect??ps.find(p=>p.id===id)?.rect??null;
  },[]);

  const commitRect=useCallback((id:string,rect:OrientedRect)=>{
    const {buildings:bs,updateBuildingRect,updateParkingRect}=storeRef.current;
    if(bs.some(b=>b.id===id)) updateBuildingRect(id,rect,true);
    else updateParkingRect(id,rect,true);
  },[]);

  // ── Helper pan ────────────────────────────────────────────────────
  // Démarre le pan depuis un événement pointer.
  // Réutilise l'infrastructure panStart existante.
  const startPan=useCallback((clientX:number,clientY:number)=>{
    const cam=cameraRef.current;
    ts.current.panStart={
      startClientX:clientX, startClientY:clientY,
      cameraX:cam.x, cameraY:cam.y,
      cameraW:cam.w, cameraH:cam.h,
      svgW:size.w, svgH:size.h,
    };
    setIsPanning(true);
  },[size.w,size.h]);

  // ── onPointerDown ────────────────────────────────────────────────
  const onPD=useCallback((e:React.PointerEvent<SVGSVGElement>)=>{
    if(e.button!==0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    ts.current.isDown=true; ts.current.shiftKey=e.shiftKey; ts.current.altKey=e.altKey;
    ts.current.pos={clientX:e.clientX,clientY:e.clientY};

    // ── PRIORITÉ 0 : mode sélection façade terrain ────────────────
    if(selectingFacade){
      const w=getWorld(e.clientX,e.clientY), z=getZoom();
      const edgeIdx=nearestParcelEdge(w, parcellePolygon, 10/z);
      if(edgeIdx!==null) storeRef.current.setParcelFrontEdge(edgeIdx);
      setSelectingFacade(false); setHoveredEdgeIdx(null);
      ts.current.isDown=false; return;
    }

    // ── PRIORITÉ 1 : Space → pan forcé ───────────────────────────
    if(ts.current.spaceKey){
      startPan(e.clientX,e.clientY);
      return;
    }

    const w=getWorld(e.clientX,e.clientY), z=getZoom(), tool=storeRef.current.activeTool;

    // ── PRIORITÉ 2 : outil dessin ─────────────────────────────────
    if(tool==='building'||tool==='parking'){
      const draw:DrawState={tool,origin:w,current:w,square:e.shiftKey,fromCenter:e.altKey};
      ts.current.draw=draw; setPreviewDraw(draw); return;
    }

    // ── PRIORITÉ 3 : outil sélection ─────────────────────────────
    if(tool==='selection'){
      const {selectedIds:sel}=storeRef.current;

      // 3a. Handle sur entité sélectionnée → resize / rotate
      if(sel.length===1){
        const rect=getEffectiveRect(sel[0]);
        if(rect){
          const handle=hitHandle(w,rect,z);
          if(handle){
            ts.current.drag={
              type:handle==='rotate'?'rotate':'resize',
              entityId:sel[0], handle,
              startWorld:w, originalRect:rect,
              startAngleDeg:handle==='rotate'?angleDeg(rect.center,w):undefined,
            };
            return;
          }
        }
      }

      // 3b. Hit sur une entité → sélection + move
      const hit=hitEntity(w);
      if(hit){
        if(!storeRef.current.selectedIds.includes(hit)) storeRef.current.selectIds([hit],e.shiftKey);
        const rect=getEffectiveRect(hit);
        if(rect) ts.current.drag={type:'move',entityId:hit,startWorld:w,originalRect:rect};
        return;
      }

      // 3c. Fond vide → clear sélection + pan
      // C'est le seul changement par rapport à V5 :
      // au lieu de s'arrêter après clearSelection, on démarre le pan.
      storeRef.current.clearSelection();
      startPan(e.clientX,e.clientY);
    }
  },[getWorld,getZoom,hitEntity,getEffectiveRect,startPan,selectingFacade,parcellePolygon]);

  // ── onPointerMove ────────────────────────────────────────────────
  const onPM=useCallback((e:React.PointerEvent<SVGSVGElement>)=>{
    const cx=e.clientX,cy=e.clientY;
    ts.current.pos={clientX:cx,clientY:cy}; ts.current.shiftKey=e.shiftKey; ts.current.altKey=e.altKey;

    if(!ts.current.isDown){
      // ── Hover façade terrain ──────────────────────────────────
      if(selectingFacade){
        const z=getZoom();
        setHoveredEdgeIdx(nearestParcelEdge(getWorld(cx,cy), parcellePolygon, 10/z));
        return;
      }
      // ── Hover normal : entité + handle + empty ────────────────
      const w=getWorld(cx,cy);
      storeRef.current.setHovered(hitEntity(w));
      const {selectedIds:sel,activeTool:tool}=storeRef.current;
      if(sel.length===1){
        const rect=getEffectiveRect(sel[0]);
        if(rect){ const h=hitHandle(w,rect,getZoom()); setHoveredHandle(h?{entityId:sel[0],handle:h}:null); }
        else setHoveredHandle(null);
      } else setHoveredHandle(null);

      // V5.1 : mise à jour isHoverEmpty pour le curseur grab
      if(tool==='selection'){
        setIsHoverEmpty(hitEntity(w)===null);
      } else {
        setIsHoverEmpty(false);
      }
      return;
    }

    if(rafId.current) return;
    rafId.current=requestAnimationFrame(()=>{
      rafId.current=0;
      const {clientX:lx,clientY:ly}=ts.current.pos;

      // ── Pan (Space ou fond vide) ──────────────────────────────
      if(ts.current.panStart){
        const {startClientX,startClientY,cameraX,cameraY,cameraW,cameraH,svgW,svgH}=ts.current.panStart;
        setCamera(cam=>({...cam,x:cameraX-(lx-startClientX)*(cameraW/svgW),y:cameraY-(ly-startClientY)*(cameraH/svgH)}));
        return;
      }

      const w=getWorld(lx,ly), z=getZoom(), tool=storeRef.current.activeTool;
      if(!Number.isFinite(w.x)||!Number.isFinite(w.y)) return;

      if((tool==='building'||tool==='parking')&&ts.current.draw){
        const snapped=snapPoint(w,{options:{...storeRef.current.snapOptions,parcelleVertices:false,parcelleEdges:false,orthogonal:true},zoom:z,parcellePolygon,orthogonalRef:ts.current.draw.origin}).point;
        ts.current.draw={...ts.current.draw,current:snapped,square:ts.current.shiftKey,fromCenter:ts.current.altKey};
        setPreviewDraw({...ts.current.draw}); return;
      }

      if(tool==='selection'&&ts.current.drag){
        const op=ts.current.drag;
        const snapped=snapPoint(w,{options:storeRef.current.snapOptions,zoom:z,parcellePolygon}).point;
        if(!Number.isFinite(snapped.x)||!Number.isFinite(snapped.y)) return;
        if(op.type==='move'){ const nr=moveRect(op.originalRect,snapped.x-op.startWorld.x,snapped.y-op.startWorld.y); liveRectsRef.current={[op.entityId]:nr}; setLiveRects({...liveRectsRef.current}); }
        else if(op.type==='resize'&&op.handle){ const nr=resizeRectFromHandle(op.originalRect,op.handle,{x:snapped.x-op.startWorld.x,y:snapped.y-op.startWorld.y}); liveRectsRef.current={[op.entityId]:nr}; setLiveRects({...liveRectsRef.current}); }
        else if(op.type==='rotate'&&op.startAngleDeg!==undefined){ let nd=normalizeAngleDeg(op.originalRect.rotationDeg+angleDeg(op.originalRect.center,w)-op.startAngleDeg); if(ts.current.shiftKey) nd=Math.round(nd/15)*15; liveRectsRef.current={[op.entityId]:{...op.originalRect,rotationDeg:nd}}; setLiveRects({...liveRectsRef.current}); }
      }
    });
  },[getWorld,getZoom,hitEntity,getEffectiveRect,parcellePolygon,selectingFacade]);

  // ── onPointerUp ──────────────────────────────────────────────────
  const onPU=useCallback((_e:React.PointerEvent<SVGSVGElement>)=>{
    cancelAnimationFrame(rafId.current); rafId.current=0; ts.current.isDown=false;

    // Arrêt pan (Space ou fond vide)
    if(ts.current.panStart){ ts.current.panStart=null; setIsPanning(false); return; }

    const tool=storeRef.current.activeTool;

    if((tool==='building'||tool==='parking')&&ts.current.draw){
      const rawRect=computeDrawRect(ts.current.draw);
      if(Number.isFinite(rawRect.width)&&Number.isFinite(rawRect.depth)&&rawRect.width>0.5&&rawRect.depth>0.5){
        const rect=clampRectSize(rawRect,1,1);
        const corners=rectCorners(rect);
        const anyInsideParcel=corners.some(c=>pointInPolygon(c,parcellePolygon));
        if(!anyInsideParcel){
          ts.current.draw=null; setPreviewDraw(null); return;
        }
        if(tool==='building'){
          const id=genId();
          const {activeLevelIndex:ali}=storeRef.current;
          const lbl=ali===0?'RDC':`R+${ali}`;
          storeRef.current.addBuilding({
            id, kind:'building', rect, label:`Bât. ${id.slice(0,4).toUpperCase()}`,
            floorsAboveGround:ali, groundFloorHeightM:3.0, typicalFloorHeightM:2.8,
            roofType:'flat', balconies:[], loggias:[], terraces:[], volumes:[],
            floorPlans:[{ id:genId(), levelIndex:ali, label:lbl, volumes:[{id:genId(),rect,role:'main' as const}] }],
          });
          storeRef.current.selectIds([id]);
        } else {
          const id=genId(); const [slotW,slotD,aisleW]=[2.5,5.0,6.0];
          storeRef.current.addParking({id,kind:'parking',rect,slotWidth:slotW,slotDepth:slotD,driveAisleWidth:aisleW,slotCount:computeParkingSlots(rect.width,rect.depth,slotW,slotD,aisleW)});
          storeRef.current.selectIds([id]);
        }
      }
      ts.current.draw=null; setPreviewDraw(null); return;
    }

    if(ts.current.drag){
      const entityId=ts.current.drag.entityId;
      const isDragMove=ts.current.drag.type==='move';
      const finalRect=liveRectsRef.current[entityId];

      let allowCommit=true;
      if(isDragMove && finalRect && parcellePolygon.length>=3){
        const corners=rectCorners(finalRect);
        allowCommit=corners.some(c=>pointInPolygon(c,parcellePolygon));
      }
      if(allowCommit && finalRect) commitRect(entityId,finalRect);

      if(isDragMove&&fusionAutoRef.current){
        const bs=storeRef.current.buildings, {activeLevelIndex:ali}=storeRef.current;
        const dropped=bs.find(b=>b.id===entityId);
        if(dropped&&dropped.kind==='building'){
          const droppedVols=getEffectiveFloorVolumes(dropped,ali,liveRectsRef.current);
          const toMerge=[entityId];
          for(const other of bs){
            if(other.id===entityId||other.kind!=='building') continue;
            const otherVols=getFloorVolumes(other,ali);
            const close=droppedVols.some(dv=>otherVols.some(ov=>rectsMinDist(dv.rect,ov.rect)<FUSION_THRESHOLD_M));
            if(close) toMerge.push(other.id);
          }
          if(toMerge.length>1) storeRef.current.mergeBuildings(toMerge);
        }
      }
    }
    liveRectsRef.current={}; setLiveRects({}); ts.current.drag=null;
  },[commitRect,parcellePolygon,FUSION_THRESHOLD_M]);

  // ── Clavier ──────────────────────────────────────────────────────
  useEffect(()=>{
    const onDown=(e:KeyboardEvent)=>{
      const tag=(document.activeElement as HTMLElement)?.tagName;
      if(tag==='INPUT'||tag==='TEXTAREA') return;
      if(e.code==='Space'){ ts.current.spaceKey=true; setSpaceDown(true); e.preventDefault(); return; }
      if(e.key==='Delete'||e.key==='Backspace') storeRef.current.deleteSelected();
      if(e.key==='Escape'){
        storeRef.current.clearSelection();
        ts.current.draw=ts.current.drag=null;
        // Arrêt propre du pan au Escape
        ts.current.panStart=null; setIsPanning(false);
        liveRectsRef.current={}; setPreviewDraw(null); setLiveRects({}); setHoveredHandle(null);
      }
      if((e.ctrlKey||e.metaKey)&&e.key==='d'){ e.preventDefault(); storeRef.current.duplicateSelected(); }
      const map:Record<string,string>={v:'selection',b:'building',p:'parking'};
      const t=map[e.key.toLowerCase()];
      if(t&&!e.ctrlKey&&!e.metaKey) storeRef.current.setTool(t as 'selection'|'building'|'parking');
    };
    const onUp=(e:KeyboardEvent)=>{
      if(e.code==='Space'){
        ts.current.spaceKey=false; setSpaceDown(false);
        // Arrêt pan Space au relâchement
        ts.current.panStart=null; setIsPanning(false);
      }
    };
    window.addEventListener('keydown',onDown); window.addEventListener('keyup',onUp);
    return ()=>{ window.removeEventListener('keydown',onDown); window.removeEventListener('keyup',onUp); };
  },[]);

  // ── Curseur ───────────────────────────────────────────────────────
  // Priorité :
  //   grabbing  → pan en cours
  //   grab      → Space enfoncé OU (sélection + survol fond vide)
  //   crosshair → outil dessin
  //   default   → sinon
  const cursor = isPanning
    ? 'grabbing'
    : spaceDown || (activeTool === 'selection' && isHoverEmpty)
      ? 'grab'
      : activeTool === 'building' || activeTool === 'parking'
        ? 'crosshair'
        : 'default';

  // ── Surfaces (étage actif) ────────────────────────────────────────
  const totalBuildingArea=useMemo(()=>effectiveBuildings.reduce((s,b)=>{ const vols=getEffectiveFloorVolumes(b,activeLevelIndex,liveRects); return s+vols.reduce((vs,v)=>vs+v.rect.width*v.rect.depth,0); },0),[effectiveBuildings,activeLevelIndex,liveRects]);
  const totalParkingArea=useMemo(()=>effectiveParkings.reduce((s,p)=>s+p.rect.width*p.rect.depth,0),[effectiveParkings]);
  const selBuildingArea=useMemo(()=>effectiveBuildings.filter(b=>selectedIds.includes(b.id)).reduce((s,b)=>{ const vols=getEffectiveFloorVolumes(b,activeLevelIndex,liveRects); return s+vols.reduce((vs,v)=>vs+v.rect.width*v.rect.depth,0); },0),[effectiveBuildings,selectedIds,activeLevelIndex,liveRects]);
  const selParkingArea=useMemo(()=>effectiveParkings.filter(p=>selectedIds.includes(p.id)).reduce((s,p)=>s+p.rect.width*p.rect.depth,0),[effectiveParkings,selectedIds]);
  const hasEntities=effectiveBuildings.length+effectiveParkings.length>0;
  const hasSelection=selectedIds.length>0;

  const previewRect=previewDraw?computeDrawRect(previewDraw):null;
  const previewCorners=previewRect?rectCorners(previewRect):null;

  const storeActions=useMemo(()=>({
    setActiveLevelIndex: (n:number)=>storeRef.current.setActiveLevelIndex(n),
    setShowGhost: (v:boolean)=>storeRef.current.setShowGhost(v),
    addFloorToAll: (n:number)=>storeRef.current.addFloorToAll(n),
    duplicateFloorToActive: ()=>storeRef.current.duplicateFloorToActive(),
    removeFloor: (n:number)=>storeRef.current.removeFloor(n),
  }),[]);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div ref={wrapperRef} className={className} style={{position:'relative',width:'100%',height:height??'100%',...style}}>

      {/* ── Sélecteur d'étages ── */}
      <div style={{position:'absolute',top:12,left:'50%',transform:'translateX(-50%)',zIndex:25}}>
        <FloorSelector buildings={buildings} activeLevelIndex={activeLevelIndex} showGhost={showGhost} storeActions={storeActions}/>
      </div>

      {/* ── Fusion auto ── */}
      <div style={{position:'absolute',bottom:16,left:16,zIndex:30}}>
        <button type="button" onClick={handleToggleFusion} style={{ display:'flex',alignItems:'center',gap:8,padding:'7px 14px',borderRadius:10,border:fusionAuto?'1.5px solid #4f46e5':'1.5px solid #cbd5e1',background:fusionAuto?'#4f46e5':'rgba(255,255,255,0.95)',color:fusionAuto?'white':'#64748b',fontSize:12,fontWeight:700,cursor:'pointer',boxShadow:fusionAuto?'0 4px 16px rgba(79,70,229,0.35)':'0 2px 8px rgba(0,0,0,0.10)',backdropFilter:'blur(6px)' }}>
          <div style={{width:32,height:18,borderRadius:9,background:fusionAuto?'rgba(255,255,255,0.35)':'#e2e8f0',position:'relative',flexShrink:0}}><div style={{position:'absolute',top:2,width:14,height:14,borderRadius:7,background:fusionAuto?'white':'#94a3b8',left:fusionAuto?16:2,transition:'left 0.15s'}}/></div>
          <span>⊞ Fusion auto</span>
          <span style={{fontSize:10,fontWeight:600,padding:'1px 6px',borderRadius:10,background:fusionAuto?'rgba(255,255,255,0.25)':'#f1f5f9',color:fusionAuto?'white':'#94a3b8'}}>{fusionAuto?'ON':'OFF'}</span>
        </button>
      </div>

      {/* ── Façade terrain + Reculs PLU ── */}
      <div style={{position:'absolute',bottom:64,left:16,zIndex:30,display:'flex',flexDirection:'column',gap:5,alignItems:'flex-start'}}>
        <button type="button" onClick={()=>setSelectingFacade(v=>!v)}
          title="Cliquer un bord de la parcelle pour définir la façade sur rue"
          style={{padding:'6px 12px',borderRadius:8,border:selectingFacade?'1.5px solid #dc2626':'1.5px solid #cbd5e1',background:selectingFacade?'#dc2626':'rgba(255,255,255,0.95)',color:selectingFacade?'white':'#64748b',fontSize:11,fontWeight:700,cursor:'pointer',backdropFilter:'blur(6px)',boxShadow:'0 2px 8px rgba(0,0,0,0.08)',whiteSpace:'nowrap'}}>
          📍 {selectingFacade?'Cliquer un bord…':'Façade terrain'+(parcelFrontEdgeIndex!==null?' ✓':'')}
        </button>
        {parcelFrontEdgeIndex!==null&&(
          <div style={{background:'rgba(255,255,255,0.97)',border:'1px solid #fde68a',borderRadius:10,padding:'8px 10px',fontSize:11,boxShadow:'0 2px 8px rgba(0,0,0,0.08)',backdropFilter:'blur(6px)'}}>
            <div style={{fontSize:9,fontWeight:700,color:'#92400e',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:5}}>Reculs PLU (m)</div>
            {([
              {label:'Avant', key:'frontM' as const, val:setbackRules.frontM},
              {label:'Latér.',key:'sideM'  as const, val:setbackRules.sideM},
              {label:'Fond',  key:'rearM'  as const, val:setbackRules.rearM},
            ]).map(f=>(
              <div key={f.key} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:3}}>
                <span style={{color:'#78716c',minWidth:36}}>{f.label}</span>
                <input type="number" value={f.val} min={0} max={30} step={0.5}
                  onChange={e=>storeRef.current.setSetbackRules({[f.key]:Number(e.target.value)})}
                  style={{width:44,padding:'2px 5px',borderRadius:5,border:'1px solid #e5e7eb',fontSize:11,fontWeight:600,textAlign:'right'}}/>
                <span style={{color:'#a8a29e',fontSize:10}}>m</span>
              </div>
            ))}
            <button onClick={()=>storeRef.current.setParcelFrontEdge(null)} style={{marginTop:3,width:'100%',fontSize:9.5,color:'#dc2626',background:'none',border:'none',cursor:'pointer',textAlign:'left',padding:0}}>× Réinitialiser</button>
          </div>
        )}
      </div>

      {/* ── Zoom buttons ── */}
      <div style={{position:'absolute',top:12,right:12,zIndex:20,display:'flex',flexDirection:'column',gap:4}}>
        {[{label:'+',action:()=>zoomBy(0.8)},{label:'−',action:()=>zoomBy(1.25)},{label:'⊙',action:resetCamera}].map(({label,action})=>(
          <button key={label} type="button" onClick={action} style={{width:32,height:32,borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#374151',fontSize:16,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>{label}</button>
        ))}
      </div>

      {/* ── Surfaces ── */}
      {hasEntities&&(
        <div style={{position:'absolute',top:148,right:12,zIndex:20,minWidth:180,padding:'10px 12px',borderRadius:12,border:'1px solid #e2e8f0',background:'rgba(255,255,255,0.97)',boxShadow:'0 4px 14px rgba(0,0,0,0.07)',fontFamily:'Inter,system-ui,sans-serif'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#94a3b8',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.05em'}}>Surfaces — {activeLevelIndex===0?'RDC':`R+${activeLevelIndex}`}</div>
          {effectiveBuildings.length>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}><span style={{color:'#64748b'}}>Bâtiments</span><strong style={{color:'#4f46e5'}}>{totalBuildingArea.toFixed(0)} m²</strong></div>}
          {effectiveParkings.length>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}><span style={{color:'#64748b'}}>Parkings</span><strong style={{color:'#2563eb'}}>{totalParkingArea.toFixed(0)} m²</strong></div>}
          <div style={{height:1,background:'#f1f5f9',margin:'6px 0'}}/>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:13}}><span style={{color:'#0f172a',fontWeight:600}}>Total</span><strong style={{color:'#111827'}}>{(totalBuildingArea+totalParkingArea).toFixed(0)} m²</strong></div>
          {hasSelection&&<><div style={{height:1,background:'#f1f5f9',margin:'6px 0'}}/><div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:'#64748b'}}>Sélection</span><strong style={{color:'#475569'}}>{(selBuildingArea+selParkingArea).toFixed(0)} m²</strong></div></>}
          <div style={{marginTop:6,fontSize:11,color:'#94a3b8'}}>
            {effectiveBuildings.length>0&&`${effectiveBuildings.length} bât.`}{effectiveBuildings.length>0&&effectiveParkings.length>0&&' · '}
            {effectiveParkings.length>0&&`${effectiveParkings.length} parking${effectiveParkings.length>1?'s':''}`}
          </div>
        </div>
      )}

      <svg ref={svgRef} viewBox={viewBox} width="100%" height="100%"
        style={{cursor,userSelect:'none',touchAction:'none',display:'block'}}
        onPointerDown={onPD} onPointerMove={onPM} onPointerUp={onPU}>

        <rect x={camera.x} y={camera.y} width={camera.w} height={camera.h} fill="#f8fafc"/>
        <defs><pattern id="p2d-g" patternUnits="userSpaceOnUse" width={sw(20)} height={sw(20)}>
          <path d={`M${sw(20)} 0 L0 0 0 ${sw(20)}`} fill="none" stroke="#e5e7eb" strokeWidth={sw(0.4)}/>
        </pattern></defs>
        <rect x={camera.x} y={camera.y} width={camera.w} height={camera.h} fill="url(#p2d-g)"/>

        <polygon points={toSvgPoints(parcellePolygon)} fill="#edf7e6" stroke="none" pointerEvents="none"/>
        <polygon points={toSvgPoints(parcellePolygon)} fill="none" stroke="#4a7c59" strokeWidth={sw(2.5)} strokeLinejoin="round" pointerEvents="none"/>

        {/* ── Enveloppe constructible PLU ── */}
        {buildableEnvelope&&buildableEnvelope.length>=3&&(
          <g pointerEvents="none">
            <polygon points={toSvgPoints(buildableEnvelope)}
              fill="rgba(245,158,11,0.06)"
              stroke="#f59e0b"
              strokeWidth={sw(1.8)}
              strokeDasharray={`${sw(7)},${sw(3.5)}`}
              strokeLinejoin="round"
            />
          </g>
        )}

        {/* ── Façade terrain sélectionnée ── */}
        {parcelFrontEdgeIndex!==null&&parcellePolygon.length>0&&(()=>{
          const n=parcellePolygon.length;
          const p1=parcellePolygon[parcelFrontEdgeIndex], p2=parcellePolygon[(parcelFrontEdgeIndex+1)%n];
          const mx=(p1.x+p2.x)/2, my=(p1.y+p2.y)/2;
          return (
            <g pointerEvents="none">
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#dc2626" strokeWidth={sw(5)} strokeLinecap="round" opacity={0.9}/>
              <circle cx={mx} cy={my} r={sw(7)} fill="#dc2626"/>
              <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={sw(7)} fill="white" fontFamily="Inter,sans-serif" fontWeight="800">R</text>
              <text x={mx+sw(10)} y={my} dominantBaseline="middle" fontSize={sw(7)} fill="#dc2626" fontFamily="Inter,sans-serif" fontWeight="700" paintOrder="stroke" stroke="white" strokeWidth={sw(2)}>Rue</text>
            </g>
          );
        })()}

        {/* ── Arête hovered mode façade ── */}
        {selectingFacade&&hoveredEdgeIdx!==null&&parcellePolygon.length>0&&(()=>{
          const n=parcellePolygon.length;
          const p1=parcellePolygon[hoveredEdgeIdx], p2=parcellePolygon[(hoveredEdgeIdx+1)%n];
          return (
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke="#f59e0b" strokeWidth={sw(5)} strokeLinecap="round" opacity={0.75}
              pointerEvents="none"/>
          );
        })()}

        {/* ── Parkings ── */}
        {effectiveParkings.map(pk=>{
          const cs=rectCorners(pk.rect),sel=selectedIds.includes(pk.id),hov=hoveredId===pk.id&&!sel;
          return (<g key={pk.id} pointerEvents="none">
            <polygon points={toSvgPoints(cs)} fill={sel?'#dbeafe':'#eff6ff'} stroke={sel?'#2563eb':hov?'#60a5fa':'#93c5fd'} strokeWidth={sw(sel?2:1.2)}/>
            <ParkingSlots rect={pk.rect} sw2={pk.slotWidth} sd={pk.slotDepth} aw={pk.driveAisleWidth}/>
            <text x={pk.rect.center.x} y={pk.rect.center.y} textAnchor="middle" dominantBaseline="middle" fontSize={sw(11)} fill="#1d4ed8" fontFamily="Inter,sans-serif" fontWeight="700" transform={`rotate(${pk.rect.rotationDeg},${pk.rect.center.x},${pk.rect.center.y})`} paintOrder="stroke" stroke="white" strokeWidth={sw(2.5)}>{Math.max(0,computeParkingSlots(pk.rect.width,pk.rect.depth,pk.slotWidth,pk.slotDepth,pk.driveAisleWidth))}pl</text>
          </g>);
        })}

        {/* ── Bâtiments ── */}
        {effectiveBuildings.map(b=>{
          const sel=selectedIds.includes(b.id), hov=hoveredId===b.id&&!sel;
          const floors=b.floorsAboveGround??Math.max(0,(b as any).levels-1??0);

          const activeVols=getEffectiveFloorVolumes(b,activeLevelIndex,liveRects);
          const ghostVols=activeLevelIndex>0&&showGhost?getFloorVolumes(b,activeLevelIndex-1):[];

          if(!activeVols.length&&!ghostVols.length) return null;

          const mainVols = activeVols.filter(v => v.role !== 'connector');
          const gc = globalCenter(mainVols.length > 0 ? mainVols : activeVols);

          const fill   = sel?'#ede9fe':hov?'#f5f3ff':'#f0eeff';
          const stroke = sel?'#4f46e5':hov?'#818cf8':'#a5b4fc';
          const strokeW = sw(sel?2.5:1.5);

          return (
            <g key={b.id} pointerEvents="none">

              {ghostVols.filter(v=>v.role!=='connector').map(vol=>{
                const cs=rectCorners(vol.rect);
                return (
                  <polygon key={`ghost-${vol.id}`} points={toSvgPoints(cs)}
                    fill="rgba(100,116,139,0.07)"
                    stroke="rgba(100,116,139,0.30)"
                    strokeWidth={sw(1.2)}
                    strokeDasharray={`${sw(5)},${sw(3)}`}
                    pointerEvents="none"
                  />
                );
              })}

              {activeVols.map((vol,vi)=>{
                const cs=rectCorners(vol.rect);
                const isConnector=vol.role==='connector';
                const visibleSegments=getVisibleOutlineSegments(vol,vi,activeVols);
                const hidden=isMostlyHiddenVolume(vol,vi,activeVols);
                return (
                  <g key={vol.id}>
                    {!isConnector&&!hidden&&visibleSegments.length>=2&&(
                      <polygon points={toSvgPoints(cs.map(p=>({x:p.x+sw(2),y:p.y+sw(2)})))} fill="rgba(0,0,0,0.06)"/>
                    )}
                    <polygon points={toSvgPoints(cs)}
                      fill={hidden?'none':isConnector?'rgba(79,70,229,0.08)':fill}
                      stroke="none"
                    />
                    {visibleSegments.map((seg,si)=>(
                      <line key={`${vol.id}-s${si}`}
                        x1={seg.a.x} y1={seg.a.y} x2={seg.b.x} y2={seg.b.y}
                        stroke={isConnector?'#818cf8':stroke}
                        strokeWidth={isConnector?sw(1):strokeW}
                        strokeDasharray={isConnector?`${sw(5)},${sw(3)}`:undefined}
                        strokeLinecap="round"
                      />
                    ))}
                    {vi===0&&!isConnector&&!hidden&&visibleSegments.length>0&&(()=>{
                      const facadeSeg=[...visibleSegments].sort((a,b)=>segLen(b.a,b.b)-segLen(a.a,a.b))[0];
                      return <line x1={facadeSeg.a.x} y1={facadeSeg.a.y} x2={facadeSeg.b.x} y2={facadeSeg.b.y} stroke={stroke} strokeWidth={sw(4)} opacity={0.4}/>;
                    })()}
                  </g>
                );
              })}

              {activeVols.length>0&&(()=>{
                const activeFloor = b.floorPlans?.find(fp => fp.levelIndex === activeLevelIndex);
                return <BuildingProgramElements b={b} activeFloor={activeFloor} sw={sw}/>;
              })()}

              <text x={gc.x} y={gc.y-sw(6)} textAnchor="middle" dominantBaseline="middle"
                fontSize={sw(10)} fill="#3730a3" fontFamily="Inter,sans-serif" fontWeight="700"
                paintOrder="stroke" stroke="white" strokeWidth={sw(2.5)}>{b.label}</text>
              <text x={gc.x} y={gc.y+sw(7)} textAnchor="middle" dominantBaseline="middle"
                fontSize={sw(8)} fill="#6d28d9" opacity={0.8} fontFamily="Inter,sans-serif"
                paintOrder="stroke" stroke="white" strokeWidth={sw(2)}>R+{floors}</text>
            </g>
          );
        })}

        {/* ── Preview dessin ── */}
        {previewRect&&previewCorners&&(()=>{
          const isBldg=previewDraw!.tool==='building';
          const fullyIn=rectFullyInsidePolygon(previewRect,parcellePolygon);
          const partlyIn=fullyIn||rectPartiallyInsidePolygon(previewRect,parcellePolygon);
          const lc=!partlyIn?'#dc2626':!fullyIn?'#f59e0b':isBldg?'#4f46e5':'#2563eb';
          const fc=!partlyIn?'rgba(220,38,38,0.10)':!fullyIn?'rgba(245,158,11,0.10)':isBldg?'rgba(79,70,229,0.12)':'rgba(37,99,235,0.12)';
          return (<g pointerEvents="none">
            <polygon points={toSvgPoints(previewCorners)} fill={fc} stroke={lc} strokeWidth={sw(2)} strokeDasharray={`${sw(5)},${sw(2.5)}`}/>
            {previewDraw!.tool==='parking'&&previewRect.width>4&&previewRect.depth>4&&<ParkingSlots rect={previewRect} sw2={2.5} sd={5.0} aw={6.0}/>}
            <text x={previewRect.center.x} y={previewRect.center.y-sw(5)} textAnchor="middle" dominantBaseline="middle" fontSize={sw(10)} fill={lc} fontFamily="Inter,sans-serif" fontWeight="700" paintOrder="stroke" stroke="white" strokeWidth={sw(2.5)}>
              {previewRect.width.toFixed(1)} × {previewRect.depth.toFixed(1)} m{previewDraw!.square?' ⬛':previewDraw!.fromCenter?' ⊕':''}
            </text>
            {!fullyIn&&previewRect.width>2&&<text x={previewRect.center.x} y={previewRect.center.y+sw(8)} textAnchor="middle" dominantBaseline="middle" fontSize={sw(7.5)} fill={lc} fontFamily="Inter,sans-serif" fontWeight="600" paintOrder="stroke" stroke="white" strokeWidth={sw(2)}>{!partlyIn?'Hors parcelle':'Déborde'}</text>}
            {previewDraw!.tool==='parking'&&previewRect.width>2&&previewRect.depth>2&&<text x={previewRect.center.x} y={previewRect.center.y+sw(!fullyIn?17:8)} textAnchor="middle" dominantBaseline="middle" fontSize={sw(8)} fill={lc} opacity={0.7} fontFamily="Inter,sans-serif" paintOrder="stroke" stroke="white" strokeWidth={sw(2)}>~{computeParkingSlots(previewRect.width,previewRect.depth,2.5,5.0,6.0)}pl</text>}
          </g>);
        })()}

        <SelectionOverlayV2 buildings={effectiveBuildings} parkings={effectiveParkings} selectedIds={selectedIds} liveRects={liveRects} hoveredHandle={hoveredHandle} zoom={approxZoom}/>

        {cotesVisible&&<DimensionOverlay parcellePolygon={parcellePolygon} buildings={effectiveBuildings} parkings={effectiveParkings} selectedIds={selectedIds} zoom={approxZoom}/>}
      </svg>
    </div>
  );
}