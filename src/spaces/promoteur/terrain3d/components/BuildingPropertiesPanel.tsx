// BuildingPropertiesPanel.tsx
// v12 — bloc "Balcons" : filant / par travée / à la française + garde-corps
//       (barreaux/verre/plein), profondeur, hauteur, couleur, premier étage
// v11 — "Ouvertures" détaillé + personnalisation PAR FAÇADE
//       (type fenêtre, volets, porte, petits-bois, appui — base + overrides par arête)
// v10 — bloc "Ouvertures" : fenêtres / volets / porte (grille réglable)
// v9 — sélecteur tuile de toit (ROOF_LIBRARY) sur les pentes
// v8 — bloc "Toiture" : terrasse / 2 pentes / 4 pentes + pente + débord
// v7 — bloc "Matière façade" branché sur FACADE_LIBRARY (registre extensible)
//      + couleur unie + texture perso (dataURL downscalé persistant)
// v6 — bloc "Matière façade" : presets enduit/béton/brique + couleur + texture perso
// v5 — Minimal : gabarit + terrassement uniquement
// v4 : suppression modèle, style, façade, vitrage, structure, aménagements
// v3 : suppression des sections liées à BuildingBlenderSpec

import React, { useState, type FC } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DEFAULT_BALCONIES,
  type BalconyConfig, type BalconyMode, type RailingStyle,
} from "../massingBalconies";
import { FACADE_LIBRARY } from "../massingBuildingAssemblerV1";
import { ROOF_LIBRARY } from "../massingRoofEngine";
import type {
  BuildingLevels,
  BuildingStyleOptions,
  BuildingTransform,
  FacadeMaterialSpec,
  MassingBuildingModel,
  MaterialBandsConfig,
  OpeningsConfig, OpeningStyle,
  RoofConfig,
} from "../massingScene.types";
import { eaveHeightM, ridgeHeightM, roofRiseM, totalLevelsCount } from "../massingScene.types";

const ACCENT = "#5247b8";

// ─── Presets matière dérivés du registre de l'assembleur ─────────────────────
const FACADE_PRESETS: Array<{ id: string; label: string }> =
  Object.entries(FACADE_LIBRARY).map(([id, e]) => ({ id, label: e.label }));

// ─── Tuiles de toit dérivées du registre du moteur ────────────────────────────
const ROOF_TILES: Array<{ id: string; label: string }> =
  Object.entries(ROOF_LIBRARY).map(([id, e]) => ({ id, label: e.label }));

// ─── Style d'ouverture par défaut ─────────────────────────────────────────────
const DEFAULT_OPENING_STYLE: OpeningStyle = {
  windowType: "casement2", mullions: true, sill: true,
  shutterType: "battants", doorType: "glazed", widthRatio: 0.45, heightRatio: 0.6,
};

// ─── Upload texture → dataURL downscalé (survit au localStorage) ──────────────
function fileToDataUrlDownscaled(file: File, maxDim = 512, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const cnv = document.createElement("canvas");
      cnv.width = w; cnv.height = h;
      const ctx = cnv.getContext("2d");
      if (!ctx) { reject(new Error("no 2d ctx")); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(cnv.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img load failed")); };
    img.src = url;
  });
}

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

// ─── Valeur verrouillée (dimensions pilotées ailleurs) ──────────────────────
const LockedVal: FC<{ text: string }> = ({ text }) => (
  <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "inline-flex", alignItems: "center", gap: 4 }}>
    <span style={{ fontSize: 10 }}>🔒</span>{text}
  </span>
);
const lockLinkStyle: React.CSSProperties = {
  display: "inline-block", marginTop: 4, fontSize: 10, fontWeight: 700,
  color: ACCENT, textDecoration: "underline",
};

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
  // PATCH — liens vers les vraies sources : Programmation (gabarit) / Impl 2D (position).
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");
  const progHref = studyId ? `/promoteur/programmation?study=${encodeURIComponent(studyId)}` : "/promoteur/programmation";
  const implHref = studyId ? `/promoteur/implantation-2d?study=${encodeURIComponent(studyId)}` : "/promoteur/implantation-2d";
  void transform; void onUpdateLevels; void onUpdateTransform; // dims/position verrouillées (lecture seule)
  // V1.1 — Deux hauteurs distinctes : le PLU impose typiquement une limite à
  // l'égout ET une au faîtage. Afficher une seule « hauteur totale » à l'égout
  // masquait plusieurs mètres de toiture.
  const hEave  = eaveHeightM(levels);
  const hRidge = ridgeHeightM(levels, building.footprint, style.roofConfig);
  const hRoof  = roofRiseM(building.footprint, style.roofConfig);
  const nLevels = totalLevelsCount(levels);
  const up = (patch: Partial<BuildingStyleOptions>) => onUpdateStyle(patch);

  const [importing, setImporting] = useState(false);
  const [editEdge, setEditEdge] = useState<number | "all">("all");

  // Matière façade courante
  const fm: FacadeMaterialSpec | undefined = style.facadeMaterial;
  // Absent → l'assembleur applique le preset par kind (generique → enduit) :
  // on surligne "enduit" pour refléter le rendu réel.
  const activeLibId: string | null =
    fm?.mode === "lib" ? fm.id : (fm ? null : "enduit");
  const colorValue = fm?.mode === "color" ? fm.color : (style.facadeColor || "#EDE8DA");

  // Toiture courante (absent → terrasse)
  const rc: RoofConfig = style.roofConfig ?? { shape: "flat" };
  const setRoof = (patch: Partial<RoofConfig>) =>
    up({ roofConfig: { ...rc, ...patch } });

  // Ouvertures courantes (absent → désactivées, format par-façade)
  const oc: OpeningsConfig = style.openings ?? {
    enabled: false, baysPerEdge: 4, door: true,
    base: { ...DEFAULT_OPENING_STYLE }, edgeOverrides: {},
  };
  const nEdges = building.footprint.points.length;

  // style effectif de la façade éditée
  const effStyle: OpeningStyle =
    editEdge === "all"
      ? { ...DEFAULT_OPENING_STYLE, ...oc.base }
      : { ...DEFAULT_OPENING_STYLE, ...oc.base, ...(oc.edgeOverrides?.[editEdge] ?? {}) };

  const setOpenBase = (patch: Partial<OpeningsConfig>) =>
    up({ openings: { ...oc, ...patch } });

  // applique un patch de style : à toutes les façades (base) ou à une seule (override)
  const setStyle = (patch: Partial<OpeningStyle>) => {
    if (editEdge === "all") {
      up({ openings: { ...oc, base: { ...oc.base, ...patch }, edgeOverrides: {} } });
    } else {
      const prev = oc.edgeOverrides?.[editEdge] ?? {};
      up({ openings: { ...oc, edgeOverrides: { ...oc.edgeOverrides, [editEdge]: { ...prev, ...patch } } } });
    }
  };

  // Bandeaux de matière (absent → désactivés)
  const bc: MaterialBandsConfig = style.bands ?? {
    enabled: false, color: "#A57C52", perEdge: 2, widthRatio: 0.3,
  };
  const setBands = (patch: Partial<MaterialBandsConfig>) =>
    up({ bands: { ...bc, ...patch } });

  // Balcons (absent → désactivés). Profondeur/hauteur exprimées en mètres via la
  // hauteur d'étage (le moteur stocke des fractions de floorH).
  const floorHm = levels.typicalFloorHeightM || 3;
  const blc: BalconyConfig = style.balconies ?? { ...DEFAULT_BALCONIES };
  const setBalc = (patch: Partial<BalconyConfig>) =>
    up({ balconies: { ...blc, ...patch } });

  const onPickTexture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de re-sélectionner le même fichier
    if (!file) return;
    setImporting(true);
    try {
      const dataUrl = await fileToDataUrlDownscaled(file, 512, 0.8);
      up({ facadeMaterial: { mode: "custom", textureUrl: dataUrl, tileM: 3 } });
    } catch (err) {
      console.warn("[BuildingPropertiesPanel] import texture échoué:", err);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ background:"white", borderRadius:12, padding:14, border:"1px solid #e2e8f0", boxShadow:"0 1px 3px rgba(0,0,0,0.05)" }}>

      {/* ── Nom + actions ── */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8, marginBottom:10 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <input value={building.name} onChange={e=>onUpdateName(e.target.value)}
            style={{ width:"100%", fontSize:12, fontWeight:700, color:"#0f172a", border:"none", borderBottom:"1px solid #e2e8f0", background:"transparent", paddingBottom:3, outline:"none" }} />
          <div style={{ fontSize:10, color:"#94a3b8", marginTop:2 }}>
            {hRidge.toFixed(1)} m · {nLevels} niveaux
            {building.meta?.footprintM2 ? ` · ${building.meta.footprintM2.toLocaleString("fr-FR")} m² emprise` : ""}
          </div>
        </div>
        <div style={{ display:"flex", gap:4 }}>
          <button onClick={onDuplicate} title="Dupliquer" style={{ padding:"4px 8px", borderRadius:6, border:"1px solid #e2e8f0", background:"white", cursor:"pointer", fontSize:14 }}>⧉</button>
          <button onClick={onDelete}    title="Supprimer" style={{ padding:"4px 8px", borderRadius:6, border:"1px solid rgba(239,68,68,0.3)", background:"rgba(239,68,68,0.05)", color:"#dc2626", cursor:"pointer", fontSize:14 }}>🗑</button>
        </div>
      </div>

      <Divider />

      {/* ── Niveaux — VERROUILLÉS (source de vérité = Programmation) ── */}
      <SLabel>Niveaux</SLabel>
      <Row label="Étages (R+N)"><LockedVal text={`R+${levels.aboveGroundFloors}`} /></Row>
      <Row label="Hauteur RDC"><LockedVal text={`${levels.groundFloorHeightM} m`} /></Row>
      <Row label="Hauteur étage"><LockedVal text={`${levels.typicalFloorHeightM} m`} /></Row>
      <a href={progHref} style={lockLinkStyle}>Modifier le gabarit dans la Programmation →</a>

      {/* V1.1 — Égout et faîtage séparés : ce sont les deux limites du PLU. */}
      <div style={{ padding:"5px 8px", borderRadius:7, background:`rgba(82,71,184,0.06)`, border:`1px solid rgba(82,71,184,0.15)`, marginBottom:4 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:11, color:"#475569" }}>Hauteur à l'égout</span>
          <span style={{ fontSize:12, fontWeight:700, color:ACCENT }}>{hEave.toFixed(1)} m</span>
        </div>
        {hRoof > 0.05 && (
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:3, paddingTop:3, borderTop:"1px solid rgba(82,71,184,0.12)" }}>
            <span style={{ fontSize:11, color:"#475569" }}>
              Hauteur au faîtage
              <span style={{ fontSize:9, color:"#94a3b8" }}> · +{hRoof.toFixed(1)} m toiture</span>
            </span>
            <span style={{ fontSize:12, fontWeight:700, color:ACCENT }}>{hRidge.toFixed(1)} m</span>
          </div>
        )}
      </div>

      <Divider />

      {/* ── Setbacks ── */}
      <SLabel>Retraits en hauteur (setbacks)</SLabel>
      <div style={{ display:"flex", gap:4 }}>
        {[{v:0,l:"Aucun"},{v:1,l:"1 retrait"},{v:2,l:"2 retraits"}].map(({v,l})=>(
          <button key={v} style={{ ...chip(style.numSetbacks===v), flex:1 }} onClick={()=>up({numSetbacks:v as 0|1|2})}>{l}</button>
        ))}
      </div>

      <Divider />

      {/* ── Matière façade ── */}
      <SLabel>Matière façade</SLabel>
      <div style={{ display:"flex", gap:4, marginBottom:8, flexWrap:"wrap" }}>
        {FACADE_PRESETS.map(p => (
          <button key={p.id}
            style={{ ...chip(activeLibId === p.id), flex:"1 0 28%" }}
            onClick={()=>up({ facadeMaterial: { mode:"lib", id:p.id } })}>
            {p.label}
          </button>
        ))}
      </div>

      <Row label="Couleur unie">
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <input type="color" value={colorValue}
            onChange={e=>up({ facadeMaterial: { mode:"color", color:e.target.value }, facadeColor: e.target.value })}
            style={{ width:34, height:24, padding:0, border:"1px solid #cbd5e1", borderRadius:6, background:"white", cursor:"pointer" }} />
          <span style={{ fontSize:10, color: fm?.mode==="color" ? ACCENT : "#94a3b8", fontWeight: fm?.mode==="color"?700:400 }}>
            {fm?.mode==="color" ? colorValue.toUpperCase() : "inactive"}
          </span>
        </div>
      </Row>

      <Row label="Texture perso">
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <label style={{ ...chip(fm?.mode==="custom"), cursor: importing?"wait":"pointer", display:"inline-block", margin:0 }}>
            {importing ? "Import…" : (fm?.mode==="custom" ? "Remplacer" : "Importer…")}
            <input type="file" accept="image/*" disabled={importing}
              style={{ display:"none" }} onChange={onPickTexture} />
          </label>
          {fm?.mode==="custom" && !importing && (
            <button onClick={()=>up({ facadeMaterial: { mode:"lib", id:"enduit" } })}
              title="Retirer la texture"
              style={{ padding:"2px 7px", borderRadius:6, border:"1px solid #e2e8f0", background:"white", cursor:"pointer", fontSize:11, color:"#64748b" }}>✕</button>
          )}
        </div>
      </Row>

      {fm?.mode==="custom" && (
        <Row label="Échelle motif">
          <NumInput value={fm.tileM ?? 3} min={0.3} max={20} step={0.1} unit="m"
            onChange={v=>up({ facadeMaterial: { mode:"custom", textureUrl: fm.textureUrl, tileM: Math.max(0.3, v) } })} />
        </Row>
      )}

      <div style={{ fontSize:9.5, color:"#94a3b8", marginTop:2, lineHeight:1.4 }}>
        Texture réduite à 512 px (JPEG) pour la persistance locale.
      </div>

      <Divider />

      {/* ── Toiture ── */}
      <SLabel>Toiture</SLabel>
      <div style={{ display:"flex", gap:4, marginBottom:6 }}>
        {[{v:"flat",l:"Terrasse"},{v:"gable",l:"2 pentes"},{v:"hip",l:"4 pentes"}].map(({v,l})=>(
          <button key={v}
            style={{ ...chip(rc.shape === v), flex:1 }}
            onClick={()=>setRoof({ shape: v as RoofConfig["shape"] })}>
            {l}
          </button>
        ))}
      </div>
      {rc.shape !== "flat" && (
        <>
          <Row label="Pente">
            <NumInput value={rc.slopeDeg ?? 30} min={5} max={60} step={1} unit="°"
              onChange={v=>setRoof({ slopeDeg: Math.max(5, Math.min(60, v)) })} />
          </Row>
          <Row label="Débord">
            <NumInput value={rc.overhangM ?? 0.4} min={0} max={2} step={0.1} unit="m"
              onChange={v=>setRoof({ overhangM: Math.max(0, v) })} />
          </Row>
          <Row label="Orientation">
            <button
              style={{ ...chip(!!rc.rotate90), padding:"4px 10px" }}
              onClick={()=>setRoof({ rotate90: !rc.rotate90 })}>
              {rc.rotate90 ? "Faîtage 90°" : "Faîtage 0°"}
            </button>
          </Row>

          <div style={{ fontSize:10, color:"#94a3b8", marginTop:4, marginBottom:4 }}>Tuile</div>
          <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
            <button
              style={{ ...chip(!rc.textureId), flex:"1 0 28%" }}
              onClick={()=>setRoof({ textureId: undefined })}>
              Unie
            </button>
            {ROOF_TILES.map(t => (
              <button key={t.id}
                style={{ ...chip(rc.textureId === t.id), flex:"1 0 28%" }}
                onClick={()=>setRoof({ textureId: t.id })}>
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}

      <Divider />

      {/* ── Ouvertures ── */}
      <SLabel>Ouvertures</SLabel>
      <div style={{ display:"flex", gap:4, marginBottom:6 }}>
        {[{v:false,l:"Aucune"},{v:true,l:"Fenêtres"}].map(({v,l})=>(
          <button key={String(v)}
            style={{ ...chip(oc.enabled === v), flex:1 }}
            onClick={()=>setOpenBase({ enabled: v })}>
            {l}
          </button>
        ))}
      </div>

      {oc.enabled && (
        <>
          <Row label="Travées / façade">
            <NumInput value={oc.baysPerEdge} min={1} max={12} step={1}
              onChange={v=>setOpenBase({ baysPerEdge: Math.max(1, Math.round(v)) })} />
          </Row>
          <div style={{ display:"flex", gap:4, marginBottom:6 }}>
            <button style={{ ...chip(oc.door), flex:1 }}
              onClick={()=>setOpenBase({ door: !oc.door })}>Porte RDC</button>
          </div>

          {/* Couleur des volets — GLOBALE, indépendante de la couleur du bâtiment */}
          <Row label="Couleur volets">
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <input type="color" value={oc.shutterColor ?? "#5c6b78"}
                onChange={e=>setOpenBase({ shutterColor: e.target.value })}
                style={{ width:34, height:24, padding:0, border:"1px solid #cbd5e1", borderRadius:6, background:"white", cursor:"pointer" }} />
              <span style={{ fontSize:10, color:"#94a3b8" }}>{(oc.shutterColor ?? "#5c6b78").toUpperCase()}</span>
            </div>
          </Row>

          {/* Sélecteur de façade à éditer */}
          <Row label="Façade éditée">
            <select value={String(editEdge)}
              onChange={e=>setEditEdge(e.target.value === "all" ? "all" : Number(e.target.value))}
              style={{ width:"100%", padding:"4px 6px", borderRadius:6, border:"1px solid #cbd5e1", fontSize:11, background:"white", color:"#0f172a" }}>
              <option value="all">Toutes</option>
              {Array.from({ length: nEdges }).map((_, i) => (
                <option key={i} value={i}>Façade {i + 1}</option>
              ))}
            </select>
          </Row>

          {/* Type de fenêtre */}
          <div style={{ fontSize:10, color:"#94a3b8", marginTop:4, marginBottom:4 }}>Type de fenêtre</div>
          <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
            {[{v:"single",l:"Simple"},{v:"casement2",l:"2 vantaux"},{v:"cross4",l:"4 carreaux"},{v:"bay",l:"Baie"}].map(({v,l})=>(
              <button key={v} style={{ ...chip(effStyle.windowType === v), flex:"1 0 45%" }}
                onClick={()=>setStyle({ windowType: v as OpeningStyle["windowType"] })}>{l}</button>
            ))}
          </div>

          {/* Volets */}
          <div style={{ fontSize:10, color:"#94a3b8", marginTop:6, marginBottom:4 }}>Volets</div>
          <div style={{ display:"flex", gap:4 }}>
            {[{v:"none",l:"Aucun"},{v:"battants",l:"Battants"},{v:"roulant",l:"Roulant"}].map(({v,l})=>(
              <button key={v} style={{ ...chip(effStyle.shutterType === v), flex:1 }}
                onClick={()=>setStyle({ shutterType: v as OpeningStyle["shutterType"] })}>{l}</button>
            ))}
          </div>

          {/* Porte (type) */}
          <div style={{ fontSize:10, color:"#94a3b8", marginTop:6, marginBottom:4 }}>Porte</div>
          <div style={{ display:"flex", gap:4 }}>
            {[{v:"plain",l:"Pleine"},{v:"glazed",l:"Vitrée"},{v:"transom",l:"Imposte"}].map(({v,l})=>(
              <button key={v} style={{ ...chip(effStyle.doorType === v), flex:1 }}
                onClick={()=>setStyle({ doorType: v as OpeningStyle["doorType"] })}>{l}</button>
            ))}
          </div>

          {/* Détails + dimensions */}
          <div style={{ display:"flex", gap:4, marginTop:6 }}>
            <button style={{ ...chip(effStyle.mullions), flex:1 }}
              onClick={()=>setStyle({ mullions: !effStyle.mullions })}>Petits-bois</button>
            <button style={{ ...chip(effStyle.sill), flex:1 }}
              onClick={()=>setStyle({ sill: !effStyle.sill })}>Appui</button>
          </div>
          <Row label="Largeur">
            <NumInput value={effStyle.widthRatio} min={0.2} max={0.9} step={0.05}
              onChange={v=>setStyle({ widthRatio: Math.max(0.2, Math.min(0.9, v)) })} />
          </Row>
          <Row label="Hauteur">
            <NumInput value={effStyle.heightRatio} min={0.2} max={0.8} step={0.05}
              onChange={v=>setStyle({ heightRatio: Math.max(0.2, Math.min(0.8, v)) })} />
          </Row>

          <div style={{ fontSize:9.5, color:"#94a3b8", marginTop:2, lineHeight:1.4 }}>
            {editEdge === "all"
              ? "Réglages appliqués à toutes les façades."
              : `Réglages spécifiques à la façade ${Number(editEdge) + 1}.`}
          </div>
        </>
      )}

      <Divider />

      {/* ── Balcons ── */}
      <SLabel>Balcons (en étage)</SLabel>
      <div style={{ display:"flex", gap:4, marginBottom:6 }}>
        {[{v:false,l:"Aucun"},{v:true,l:"Balcons"}].map(({v,l})=>(
          <button key={String(v)}
            style={{ ...chip(blc.enabled === v), flex:1 }}
            onClick={()=>setBalc({ enabled: v })}>
            {l}
          </button>
        ))}
      </div>

      {blc.enabled && (
        <>
          <div style={{ fontSize:10, color:"#94a3b8", marginTop:4, marginBottom:4 }}>Disposition</div>
          <div style={{ display:"flex", gap:4 }}>
            {[{v:"continuous",l:"Filant"},{v:"perBay",l:"Par travée"},{v:"french",l:"À la française"}].map(({v,l})=>(
              <button key={v} style={{ ...chip(blc.mode === v), flex:1 }}
                onClick={()=>setBalc({ mode: v as BalconyMode })}>{l}</button>
            ))}
          </div>

          <Row label="Premier étage">
            <NumInput value={blc.fromFloor} min={0} max={50} step={1}
              onChange={v=>setBalc({ fromFloor: Math.max(0, Math.round(v)) })} />
          </Row>

          {blc.mode !== "french" && (
            <Row label="Profondeur">
              <NumInput value={+(floorHm * blc.depthFrac).toFixed(1)} min={0.5} max={3} step={0.1} unit="m"
                onChange={v=>setBalc({ depthFrac: Math.max(0.15, Math.min(1.0, v / floorHm)) })} />
            </Row>
          )}

          <div style={{ fontSize:10, color:"#94a3b8", marginTop:6, marginBottom:4 }}>Garde-corps</div>
          <div style={{ display:"flex", gap:4 }}>
            {[{v:"bars",l:"Barreaux"},{v:"glass",l:"Verre"},{v:"solid",l:"Plein"}].map(({v,l})=>(
              <button key={v} style={{ ...chip(blc.railStyle === v), flex:1 }}
                onClick={()=>setBalc({ railStyle: v as RailingStyle })}>{l}</button>
            ))}
          </div>

          <Row label="Hauteur G-C">
            <NumInput value={+(floorHm * blc.railHeightFrac).toFixed(2)} min={0.8} max={1.5} step={0.05} unit="m"
              onChange={v=>setBalc({ railHeightFrac: Math.max(0.25, Math.min(0.6, v / floorHm)) })} />
          </Row>

          <Row label="Couleur G-C">
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <input type="color" value={blc.railColor ?? "#4a4f55"}
                onChange={e=>setBalc({ railColor: e.target.value })}
                style={{ width:34, height:24, padding:0, border:"1px solid #cbd5e1", borderRadius:6, background:"white", cursor:"pointer" }} />
              <span style={{ fontSize:10, color:"#94a3b8" }}>{(blc.railColor ?? "#4a4f55").toUpperCase()}</span>
            </div>
          </Row>

          <div style={{ fontSize:9.5, color:"#94a3b8", marginTop:2, lineHeight:1.4 }}>
            {blc.mode === "french"
              ? "Garde-corps plaqué devant chaque fenêtre, sans dalle saillante."
              : blc.mode === "continuous"
                ? "Dalle filante sur toute la façade."
                : "Une dalle devant chaque travée de fenêtre."}
            {" Posé à partir du niveau indiqué (RDC = 0), sur toutes les façades."}
          </div>
        </>
      )}

      <Divider />

      {/* ── Bandeaux de matière ── */}
      <SLabel>Bandeaux de matière</SLabel>
      <div style={{ display:"flex", gap:4, marginBottom:6 }}>
        {[{v:false,l:"Aucun"},{v:true,l:"Bandes bois"}].map(({v,l})=>(
          <button key={String(v)}
            style={{ ...chip(bc.enabled === v), flex:1 }}
            onClick={()=>setBands({ enabled: v })}>
            {l}
          </button>
        ))}
      </div>
      {bc.enabled && (
        <>
          <Row label="Couleur">
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <input type="color" value={bc.color}
                onChange={e=>setBands({ color: e.target.value })}
                style={{ width:34, height:24, padding:0, border:"1px solid #cbd5e1", borderRadius:6, background:"white", cursor:"pointer" }} />
              <span style={{ fontSize:10, color:"#94a3b8" }}>{bc.color.toUpperCase()}</span>
            </div>
          </Row>
          <Row label="Bandes / façade">
            <NumInput value={bc.perEdge} min={1} max={8} step={1}
              onChange={v=>setBands({ perEdge: Math.max(1, Math.round(v)) })} />
          </Row>
          <Row label="Largeur">
            <NumInput value={bc.widthRatio} min={0.1} max={0.9} step={0.05}
              onChange={v=>setBands({ widthRatio: Math.max(0.1, Math.min(0.9, v)) })} />
          </Row>
          <div style={{ fontSize:9.5, color:"#94a3b8", marginTop:2, lineHeight:1.4 }}>
            Bandes fines = accents entre fenêtres. Larges = pan plein (à réserver à une façade sans fenêtres, sinon elles cachent les vitres).
          </div>
        </>
      )}

      <Divider />

      {/* ── Position — définie en Implantation 2D (le 3D illustre, ne positionne pas) ── */}
      <SLabel>Position</SLabel>
      <div style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 10 }}>🔒</span> Position et rotation définies dans l'Implantation 2D.
      </div>
      <a href={implHref} style={lockLinkStyle}>Modifier la position dans l'Implantation 2D →</a>

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