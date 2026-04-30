// src/spaces/marchand/pages/RenduTravauxPage.tsx
// V8 — Bouton "Utiliser dans la synthèse" + thème injectable + type de sol + couleur sol/murs

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useTravauxImageRender } from "../hooks/useTravauxImageRender";
import { supabase } from "../../../lib/supabase";
import type {
  TravauxRenduConfig,
  TravauxGamme,
  TravauxNiveau,
  TravauxLot,
  TravauxSolType,
} from "../types/rendutravaux.types";
import {
  TRAVAUX_LOT_LABELS,
  TRAVAUX_SOL_TYPE_LABELS,
} from "../types/rendutravaux.types";

// ── Thème ─────────────────────────────────────────────────────────

export type RenduTheme = {
  gradient: string;
  accent: string;
  accentLight: string;
  accentDark: string;
};

type Props = {
  theme?: RenduTheme;
  breadcrumb?: string;
};

const DEFAULT_THEME: RenduTheme = {
  gradient: "linear-gradient(90deg, #2196f3 0%, #21cbf3 100%)",
  accent: "#1a72c4",
  accentLight: "#dbeafe",
  accentDark: "#1a72c4",
};

type ExtendedTravauxRenduConfig = TravauxRenduConfig & {
  mobilier?: string;
};

function readTravauxConfig(): TravauxRenduConfig | null {
  try {
    for (const key of [
      "mimmoza.simulateur.travaux.v1",
      "mimmoza.execution.simulation.v1",
      "mimmoza.travaux.snapshot.v1",
    ]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const p = JSON.parse(raw);
      if (!p) continue;

      const c: Partial<TravauxRenduConfig> = {
        gamme: p.gamme ?? p.grade ?? p.materialGrade ?? undefined,
        niveau: p.niveau ?? p.level ?? p.renovationLevel ?? undefined,
        lots: p.lots ?? p.selectedLots ?? p.workPackages ?? [],
        solType: p.solType ?? undefined,
        solColor: p.solColor ?? p.couleurSol ?? undefined,
        murColor: p.murColor ?? p.couleurMurs ?? undefined,
      };

      if (c.gamme && c.niveau) return c as TravauxRenduConfig;
    }
  } catch {
    // ignore localStorage parse errors
  }

  return null;
}

// ── Palettes ──────────────────────────────────────────────────────

interface CouleurOption {
  label: string;
  value: string;
  swatch: string;
}

const PALETTE_SOL: CouleurOption[] = [
  { label: "Naturel", value: "natural light oak tone", swatch: "#d4a96a" },
  { label: "Blond", value: "blonde honey wood tone", swatch: "#e8c87a" },
  { label: "Chêne foncé", value: "dark smoked oak tone", swatch: "#7a5230" },
  { label: "Gris clair", value: "light grey stone tone", swatch: "#c8ccd0" },
  { label: "Gris anthracite", value: "dark charcoal grey tone", swatch: "#4a4e54" },
  { label: "Blanc", value: "white-washed tone", swatch: "#f0ece4" },
  { label: "Beige sable", value: "sandy beige tone", swatch: "#c8b89a" },
  { label: "Terracotta", value: "warm terracotta clay tone", swatch: "#b85c38" },
  { label: "Noir", value: "deep matte black tone", swatch: "#2a2a2a" },
];

const PALETTE_MURS: CouleurOption[] = [
  { label: "Blanc pur", value: "pure bright white", swatch: "#f8f8f6" },
  { label: "Blanc cassé", value: "warm off-white cream", swatch: "#f0ebe0" },
  { label: "Greige", value: "warm greige", swatch: "#c8b89e" },
  { label: "Gris perle", value: "soft pearl grey", swatch: "#c4c8cc" },
  { label: "Gris ardoise", value: "medium slate grey", swatch: "#7a8490" },
  { label: "Bleu ciel", value: "soft powder blue", swatch: "#a8c4d8" },
  { label: "Bleu canard", value: "deep teal blue", swatch: "#2e6878" },
  { label: "Sauge", value: "muted sage green", swatch: "#8aaa84" },
  { label: "Vert forêt", value: "deep forest green", swatch: "#2e5040" },
  { label: "Rose poudré", value: "dusty blush pink", swatch: "#d4a8a0" },
  { label: "Terracotta", value: "warm terracotta orange", swatch: "#c0643c" },
  { label: "Ocre", value: "warm ochre yellow", swatch: "#c89840" },
  { label: "Aubergine", value: "deep aubergine purple", swatch: "#5a2848" },
  { label: "Noir ardoise", value: "near-black dark charcoal", swatch: "#2a2e32" },
];

const SOL_TYPE_OPTIONS: { value: TravauxSolType; icon: string; desc: string }[] = [
  { value: "carrelage", icon: "▦", desc: "Dalles, joints visibles" },
  { value: "parquet", icon: "▤", desc: "Bois, lames longues" },
  { value: "stratifie", icon: "▤", desc: "Aspect parquet économique" },
  { value: "vinyle", icon: "▧", desc: "PVC / LVT" },
  { value: "moquette", icon: "▥", desc: "Textile doux" },
  { value: "tapis", icon: "▣", desc: "Tapis décoratif" },
  { value: "coco", icon: "▥", desc: "Fibre naturelle" },
  { value: "beton_cire", icon: "◼", desc: "Minéral continu" },
  { value: "pierre_naturelle", icon: "◩", desc: "Pierre / travertin" },
  { value: "terre_cuite", icon: "◫", desc: "Tomette / terre cuite" },
  { value: "resine", icon: "⬚", desc: "Sol lisse résine" },
  { value: "marbre", icon: "◇", desc: "Marbre premium" },
];

// ── UI Options ────────────────────────────────────────────────────

const GAMME_OPTIONS: { value: TravauxGamme; label: string; emoji: string }[] = [
  { value: "economique", label: "Économique", emoji: "🟢" },
  { value: "standard", label: "Standard", emoji: "🔵" },
  { value: "premium", label: "Premium", emoji: "🟣" },
  { value: "luxe", label: "Luxe", emoji: "⭐" },
];

const NIVEAU_OPTIONS: { value: TravauxNiveau; label: string; desc: string }[] = [
  { value: "leger", label: "Léger", desc: "Peinture, petites finitions" },
  { value: "moyen", label: "Moyen", desc: "Sol, cuisine, sdb" },
  { value: "lourd", label: "Lourd", desc: "Rénovation complète" },
  { value: "total", label: "Total", desc: "Remise à nu totale" },
];

const STYLE_OPTIONS = [
  { value: "contemporain", label: "Contemporain", emoji: "🏙️" },
  { value: "scandinave", label: "Scandinave", emoji: "🌿" },
  { value: "industriel", label: "Industriel", emoji: "🔩" },
  { value: "classique", label: "Classique", emoji: "🏛️" },
  { value: "japandi", label: "Japandi", emoji: "🍃" },
  { value: "boheme", label: "Bohème", emoji: "🌸" },
];

const MOBILIER_STYLES = [
  { value: "scandinave", label: "Scandinave", emoji: "🪵", desc: "Bois clair, lignes épurées" },
  { value: "contemporain", label: "Contemporain", emoji: "🛋️", desc: "Sobre, fonctionnel, neutre" },
  { value: "industriel", label: "Industriel", emoji: "🔩", desc: "Métal, loft, brut chic" },
  { value: "luxe", label: "Luxe", emoji: "✨", desc: "Velours, marbre, dorures" },
  { value: "japandi", label: "Japandi", emoji: "🍃", desc: "Zen, minimalisme naturel" },
  { value: "vintage", label: "Vintage", emoji: "🪑", desc: "Chiner, couleurs chaudes" },
];

const ALL_LOTS: TravauxLot[] = [
  "peinture",
  "revetements_murs",
  "cuisine",
  "salle_de_bain",
  "menuiseries_interieures",
  "menuiseries_exterieures",
  "chauffage",
  "isolation",
  "faux_plafonds",
];

// ── CSS ───────────────────────────────────────────────────────────

function buildStyles(accent: string, accentLight: string): string {
  return `
    @keyframes rt-in   { from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none} }
    @keyframes rt-spin { to{transform:rotate(360deg)} }
    .rt-in   { animation:rt-in .3s ease both }
    .rt-spin { animation:rt-spin 1s linear infinite }
    .rt-btn  { transition:all .15s ease }
    .rt-btn:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px)}
    .rt-btn:active:not(:disabled){transform:scale(.97)}
    .rt-btn:disabled{opacity:.5;cursor:not-allowed}
    .rt-drop{transition:all .2s ease}
    .rt-drop.drag{border-color:${accent}!important;background:${accentLight}!important;transform:scale(1.01)}
    .rt-thumb{transition:all .15s ease;cursor:pointer}
    .rt-thumb:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(37,99,235,.25)}
    .rt-thumb.sel{outline:3px solid ${accent};outline-offset:2px}
    .rt-pill{transition:all .15s ease;cursor:pointer;user-select:none}
    .rt-swatch { transition:all .15s ease; cursor:pointer; }
    .rt-swatch:hover { transform:scale(1.12); box-shadow:0 4px 12px rgba(0,0,0,.2); }
    .rt-swatch.active { transform:scale(1.18); box-shadow:0 0 0 3px #fff, 0 0 0 5px ${accent}; }
    .rt-toggle-track{transition:background .2s ease}
    .rt-toggle-thumb{transition:left .2s ease}
  `;
}

const STYLE_TAG_ID = "rt-styles";

function injectStyles(accent: string, accentLight: string) {
  let s = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!s) {
    s = document.createElement("style");
    s.id = STYLE_TAG_ID;
    document.head.appendChild(s);
  }
  s.textContent = buildStyles(accent, accentLight);
}

// ── Composants ────────────────────────────────────────────────────

const Toggle: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  accent: string;
}> = ({ checked, onChange, label, accent }) => (
  <button
    onClick={() => onChange(!checked)}
    className="rt-btn"
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      background: "none",
      border: "none",
      cursor: "pointer",
      padding: 0,
    }}
  >
    <div
      className="rt-toggle-track"
      style={{
        width: 42,
        height: 24,
        borderRadius: 12,
        background: checked ? accent : "#cbd5e1",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <div
        className="rt-toggle-thumb"
        style={{
          position: "absolute",
          top: 3,
          left: checked ? 21 : 3,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 4px rgba(0,0,0,.2)",
        }}
      />
    </div>
    <span style={{ fontSize: 13, fontWeight: 700, color: checked ? accent : "#64748b" }}>{label}</span>
  </button>
);

const ColorPalette: React.FC<{
  label: string;
  palette: CouleurOption[];
  selected: string | null;
  onSelect: (v: string | null) => void;
  accent: string;
  accentLight: string;
  accentDark: string;
}> = ({ label, palette, selected, onSelect, accent, accentLight, accentDark }) => (
  <div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2 }}>
        {label}
      </div>
      {selected && (
        <button
          className="rt-btn"
          onClick={() => onSelect(null)}
          style={{ fontSize: 11, color: "#64748b", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}
        >
          ✕ Effacer
        </button>
      )}
    </div>

    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: selected ? 10 : 0 }}>
      {palette.map((c) => (
        <div
          key={c.value}
          title={c.label}
          className={`rt-swatch${selected === c.value ? " active" : ""}`}
          onClick={() => onSelect(selected === c.value ? null : c.value)}
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: c.swatch,
            border: `2px solid ${selected === c.value ? accent : "rgba(0,0,0,.1)"}`,
          }}
        />
      ))}
    </div>

    {selected && (
      <div
        style={{
          fontSize: 12,
          color: accentDark,
          fontWeight: 600,
          background: accentLight,
          borderRadius: 6,
          padding: "4px 10px",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: palette.find((c) => c.value === selected)?.swatch ?? "#ccc",
            border: "1px solid rgba(0,0,0,.15)",
          }}
        />
        {palette.find((c) => c.value === selected)?.label}
      </div>
    )}
  </div>
);

const FloorTypeSelector: React.FC<{
  selected: TravauxSolType | null;
  onSelect: (v: TravauxSolType | null) => void;
  accent: string;
  accentLight: string;
  accentDark: string;
}> = ({ selected, onSelect, accent, accentLight, accentDark }) => (
  <div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2 }}>
        ▦ Type de sol
      </div>
      {selected && (
        <button
          className="rt-btn"
          onClick={() => onSelect(null)}
          style={{ fontSize: 11, color: "#64748b", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}
        >
          ✕ Effacer
        </button>
      )}
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      {SOL_TYPE_OPTIONS.map((s) => {
        const active = selected === s.value;
        return (
          <button
            key={s.value}
            className="rt-btn"
            onClick={() => onSelect(active ? null : s.value)}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: `2px solid ${active ? accent : "#e2e8f0"}`,
              background: active ? accentLight : "#fff",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ color: active ? accentDark : "#64748b", fontWeight: 900 }}>{s.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: active ? accentDark : "#374151" }}>
                {TRAVAUX_SOL_TYPE_LABELS[s.value]}
              </span>
            </div>
            <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 2 }}>{s.desc}</div>
          </button>
        );
      })}
    </div>
  </div>
);
const BeforeAfterSlider: React.FC<{ beforeUrl: string; afterUrl: string; accent: string }> = ({
  beforeUrl,
  afterUrl,
  accent,
}) => {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);

  const update = useCallback((x: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos(Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100)));
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16/9",
        borderRadius: 12,
        overflow: "hidden",
        userSelect: "none",
        cursor: "ew-resize",
      }}
      onMouseDown={() => {
        drag.current = true;
      }}
      onMouseMove={(e) => {
        if (drag.current) update(e.clientX);
      }}
      onMouseUp={() => {
        drag.current = false;
      }}
      onMouseLeave={() => {
        drag.current = false;
      }}
      onTouchMove={(e) => update(e.touches[0].clientX)}
    >
      <img
        src={beforeUrl}
        alt="Avant"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        draggable={false}
      />

      <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={afterUrl} alt="Après" style={{ width: "100%", height: "100%", objectFit: "cover" }} draggable={false} />
      </div>

      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${pos}%`,
          transform: "translateX(-50%)",
          width: 3,
          background: "#fff",
          boxShadow: "0 0 8px rgba(0,0,0,.3)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 2px 12px rgba(0,0,0,.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            fontWeight: 700,
            color: accent,
          }}
        >
          ⇔
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          background: "rgba(0,0,0,.55)",
          color: "#fff",
          borderRadius: 6,
          padding: "3px 10px",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        AVANT
      </div>

      <div
        style={{
          position: "absolute",
          top: 10,
          right: 12,
          background: `${accent}dd`,
          color: "#fff",
          borderRadius: 6,
          padding: "3px 10px",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        APRÈS IA
      </div>
    </div>
  );
};

const DropZone: React.FC<{ onFiles: (f: FileList) => void; accent: string; accentLight: string }> = ({
  onFiles,
  accent,
  accentLight,
}) => {
  const [drag, setDrag] = useState(false);
  const inp = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`rt-drop${drag ? " drag" : ""}`}
      style={{
        border: `2px dashed ${drag ? accent : "#cbd5e1"}`,
        borderRadius: 14,
        padding: "36px 24px",
        textAlign: "center",
        background: drag ? accentLight : "#f8fafc",
        cursor: "pointer",
      }}
      onClick={() => inp.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      }}
    >
      <div style={{ fontSize: 36, marginBottom: 10 }}>📷</div>
      <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b", marginBottom: 6 }}>Glissez vos photos ici</div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>JPEG, PNG, WebP · max 10 Mo</div>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 18px",
          borderRadius: 8,
          background: accent,
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        📁 Choisir
      </div>
      <input
        ref={inp}
        type="file"
        multiple
        accept="image/jpeg,image/jpg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
        }}
      />
    </div>
  );
};

const Loader: React.FC<{ progress: number; accent: string }> = ({ progress, accent }) => (
  <div style={{ padding: "48px 24px", textAlign: "center" }}>
    <div
      className="rt-spin"
      style={{
        width: 52,
        height: 52,
        border: `4px solid #e2e8f0`,
        borderTopColor: accent,
        borderRadius: "50%",
        margin: "0 auto 20px",
      }}
    />
    <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b", marginBottom: 8 }}>Génération en cours…</div>
    <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
      L'IA analyse votre bien et génère le rendu après travaux
    </div>
    <div style={{ maxWidth: 320, margin: "0 auto", height: 6, borderRadius: 3, background: "#e2e8f0", overflow: "hidden" }}>
      <div
        style={{
          height: "100%",
          borderRadius: 3,
          background: `linear-gradient(90deg,${accent},#0ea5e9)`,
          width: `${progress}%`,
          transition: "width .5s ease",
        }}
      />
    </div>
    <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>{progress}%</div>
  </div>
);

// ── Page ──────────────────────────────────────────────────────────

export default function RenduTravauxPage({ theme, breadcrumb }: Props) {
  const t = theme ?? DEFAULT_THEME;
  const GRAD = t.gradient;
  const ACCENT = t.accent;
  const ACCENT_LIGHT = t.accentLight;
  const ACCENT_DARK = t.accentDark;

  useEffect(() => {
    injectStyles(ACCENT, ACCENT_LIGHT);
  }, [ACCENT, ACCENT_LIGHT]);

  const { state, addImages, removeImage, selectImage, setStyleDecoration, generateRendu, clearResults, latestResult } =
    useTravauxImageRender();

  const existingConfig = useMemo(() => readTravauxConfig(), []);

  const [gamme, setGamme] = useState<TravauxGamme>(existingConfig?.gamme ?? "standard");
  const [niveau, setNiveau] = useState<TravauxNiveau>(existingConfig?.niveau ?? "moyen");
  const [selectedLots, setSelectedLots] = useState<TravauxLot[]>(
    existingConfig?.lots ?? ["peinture", "revetements_sols", "cuisine", "salle_de_bain"],
  );

  const [avecMobilier, setAvecMobilier] = useState(false);
  const [styleMobilier, setStyleMobilier] = useState("scandinave");

  const [solType, setSolType] = useState<TravauxSolType | null>(existingConfig?.solType ?? null);
  const [couleurSol, setCouleurSol] = useState<string | null>(existingConfig?.solColor ?? null);
  const [couleurMurs, setCouleurMurs] = useState<string | null>(existingConfig?.murColor ?? null);

  const [activeTab, setActiveTab] = useState<"upload" | "config">("upload");

  const resolvedBreadcrumb = breadcrumb ?? "Investisseur › Exécution";

  const toggleLot = (lot: TravauxLot) =>
    setSelectedLots((prev) => (prev.includes(lot) ? prev.filter((l) => l !== lot) : [...prev, lot]));

  const handleGenerate = async () => {
    if (!state.selectedImageId) return;

    const config: ExtendedTravauxRenduConfig = {
      gamme,
      niveau,
      lots: selectedLots,
      styleDecoration: state.styleDecoration,
      mobilier: avecMobilier ? styleMobilier : "none",
      solType: solType ?? undefined,
      solColor: couleurSol ?? undefined,
      murColor: couleurMurs ?? undefined,
    };

    await generateRendu(state.selectedImageId, config);
  };

  const dl = (url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `rendu-travaux-${Date.now()}.png`;
    a.click();
  };

  // ── Synthèse ──────────────────────────────────────────────────
  
  const useInSynthese = async (result: typeof latestResult) => {
    if (!result) return;

    try {
      const response = await fetch(result.generatedImageUrl);
      if (!response.ok) {
        throw new Error(`Image inaccessible (${response.status})`);
      }

      const blob = await response.blob();

      const fileName = `rendu-travaux-${Date.now()}.png`;
      const filePath = `public/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("rendu-travaux-synthese")
        .upload(filePath, blob, {
          contentType: blob.type || "image/png",
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from("rendu-travaux-synthese")
        .getPublicUrl(filePath);

      const publicUrl = data.publicUrl;

      const payload = {
        id: result.id,
        sourceImageId: result.sourceImageId,
        generatedImageUrl: publicUrl,
        prompt: result.prompt,
        generatedAt: result.generatedAt,
        durationMs: result.durationMs,
        configSnapshot: result.configSnapshot ?? null,
      };

      localStorage.setItem(
        "mimmoza.promoteur.renduTravaux.synthese.v1",
        JSON.stringify(payload)
      );

      window.dispatchEvent(
        new CustomEvent("mimmoza:promoteur-rendu-travaux-synthese", {
          detail: payload,
        })
      );

      alert("Rendu travaux ajouté à la synthèse.");
    } catch (e) {
      console.error("[RenduTravaux] upload Supabase échoué:", e);
      alert("Erreur lors de l'envoi du rendu travaux vers Supabase.");
    }
  };
  
  const isLoading = state.status === "uploading" || state.status === "generating";
  const hasImages = state.images.length > 0;

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      {/* Bannière */}
      <div
        style={{
          background: GRAD,
          borderRadius: 16,
          padding: "24px 28px",
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>
            {resolvedBreadcrumb}
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: "#fff", marginBottom: 4 }}>🎨 Rendu Travaux</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,.75)" }}>
            Visualisez votre bien après rénovation grâce à l'intelligence artificielle
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {existingConfig && (
            <div
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "1px solid rgba(255,255,255,0.25)",
                borderRadius: 10,
                padding: "8px 14px",
                fontSize: 12,
                color: "#fff",
                fontWeight: 600,
              }}
            >
              ✓ Config simulateur
            </div>
          )}
          <div
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: 10,
              padding: "8px 14px",
              fontSize: 12,
              color: "#fff",
              fontWeight: 600,
            }}
          >
            {gamme} · {niveau}
            {avecMobilier ? ` · 🛋️ ${styleMobilier}` : ""}
            {solType ? ` · ▦ ${TRAVAUX_SOL_TYPE_LABELS[solType]}` : ""}
            {couleurSol ? ` · sol` : ""}
            {couleurMurs ? ` · murs` : ""}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, alignItems: "start" }}>
        {/* Gauche */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Tabs */}
          <div style={{ background: "#fff", borderRadius: 12, padding: 6, display: "flex", gap: 4, border: "1px solid #e2e8f0" }}>
            {(["upload", "config"] as const).map((tab) => (
              <button
                key={tab}
                className="rt-btn"
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: "7px 4px",
                  borderRadius: 8,
                  border: "none",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  background: activeTab === tab ? ACCENT : "transparent",
                  color: activeTab === tab ? "#fff" : "#64748b",
                }}
              >
                {tab === "upload" ? "📷 Photos" : "⚙️ Config"}
              </button>
            ))}
          </div>

          {/* Upload */}
          {activeTab === "upload" && (
            <div
              className="rt-in"
              style={{
                background: "#fff",
                borderRadius: 14,
                padding: 16,
                border: "1px solid #e2e8f0",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <DropZone onFiles={(fl) => addImages(fl)} accent={ACCENT} accentLight={ACCENT_LIGHT} />

              {hasImages && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>
                    {state.images.length} image{state.images.length > 1 ? "s" : ""} · Cliquer pour sélectionner
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8 }}>
                    {state.images.map((img) => (
                      <div key={img.id} style={{ position: "relative" }}>
                        <img
                          src={img.preview}
                          alt={img.name}
                          onClick={() => selectImage(img.id)}
                          className={`rt-thumb${state.selectedImageId === img.id ? " sel" : ""}`}
                          style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 8, display: "block" }}
                        />
                        <button
                          onClick={() => removeImage(img.id)}
                          style={{
                            position: "absolute",
                            top: 4,
                            right: 4,
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            border: "none",
                            background: "rgba(0,0,0,.6)",
                            color: "#fff",
                            fontSize: 11,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          ×
                        </button>
                        {state.selectedImageId === img.id && (
                          <div
                            style={{
                              position: "absolute",
                              bottom: 4,
                              left: 4,
                              background: ACCENT,
                              color: "#fff",
                              borderRadius: 4,
                              fontSize: 9,
                              fontWeight: 800,
                              padding: "2px 6px",
                            }}
                          >
                            ACTIVE
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Config */}
          {activeTab === "config" && (
            <div
              className="rt-in"
              style={{
                background: "#fff",
                borderRadius: 14,
                padding: 16,
                border: "1px solid #e2e8f0",
                display: "flex",
                flexDirection: "column",
                gap: 18,
              }}
            >
              {existingConfig && (
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#1d4ed8" }}>
                  ✓ Données importées du simulateur travaux
                </div>
              )}

              {/* Gamme */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
                  Gamme
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {GAMME_OPTIONS.map((g) => (
                    <button
                      key={g.value}
                      className="rt-btn"
                      onClick={() => setGamme(g.value)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: `2px solid ${gamme === g.value ? ACCENT : "#e2e8f0"}`,
                        background: gamme === g.value ? ACCENT_LIGHT : "#fff",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 700,
                        color: gamme === g.value ? ACCENT_DARK : "#374151",
                        textAlign: "left",
                      }}
                    >
                      {g.emoji} {g.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Niveau */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
                  Niveau de travaux
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {NIVEAU_OPTIONS.map((n) => (
                    <button
                      key={n.value}
                      className="rt-btn"
                      onClick={() => setNiveau(n.value)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: `2px solid ${niveau === n.value ? ACCENT : "#e2e8f0"}`,
                        background: niveau === n.value ? ACCENT_LIGHT : "#fff",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: niveau === n.value ? ACCENT_DARK : "#374151" }}>{n.label}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{n.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Style déco */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
                  Style de décoration
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {STYLE_OPTIONS.map((s) => (
                    <button
                      key={s.value}
                      className="rt-btn"
                      onClick={() => setStyleDecoration(s.value)}
                      style={{
                        padding: "7px 8px",
                        borderRadius: 8,
                        border: `2px solid ${state.styleDecoration === s.value ? ACCENT : "#e2e8f0"}`,
                        background: state.styleDecoration === s.value ? ACCENT_LIGHT : "#fff",
                        cursor: "pointer",
                        fontSize: 11,
                        fontWeight: 700,
                        color: state.styleDecoration === s.value ? ACCENT_DARK : "#374151",
                      }}
                    >
                      {s.emoji} {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sols / couleurs */}
              <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
                <FloorTypeSelector
                  selected={solType}
                  onSelect={setSolType}
                  accent={ACCENT}
                  accentLight={ACCENT_LIGHT}
                  accentDark={ACCENT_DARK}
                />

                <ColorPalette
                  label="🪵 Couleur du sol"
                  palette={PALETTE_SOL}
                  selected={couleurSol}
                  onSelect={setCouleurSol}
                  accent={ACCENT}
                  accentLight={ACCENT_LIGHT}
                  accentDark={ACCENT_DARK}
                />

                <ColorPalette
                  label="🎨 Couleur des murs"
                  palette={PALETTE_MURS}
                  selected={couleurMurs}
                  onSelect={setCouleurMurs}
                  accent={ACCENT}
                  accentLight={ACCENT_LIGHT}
                  accentDark={ACCENT_DARK}
                />
              </div>

              {/* Mobilier */}
              <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: avecMobilier ? 14 : 0 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2 }}>Mobilier</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Ajouter des meubles au rendu</div>
                  </div>
                  <Toggle checked={avecMobilier} onChange={setAvecMobilier} label={avecMobilier ? "Avec" : "Sans"} accent={ACCENT} />
                </div>

                {avecMobilier && (
                  <div className="rt-in" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {MOBILIER_STYLES.map((m) => (
                      <button
                        key={m.value}
                        className="rt-btn"
                        onClick={() => setStyleMobilier(m.value)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "9px 12px",
                          borderRadius: 10,
                          border: `2px solid ${styleMobilier === m.value ? ACCENT : "#e2e8f0"}`,
                          background: styleMobilier === m.value ? ACCENT_LIGHT : "#fff",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span style={{ fontSize: 20, lineHeight: 1 }}>{m.emoji}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: styleMobilier === m.value ? ACCENT_DARK : "#374151" }}>{m.label}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>{m.desc}</div>
                        </div>
                        {styleMobilier === m.value && (
                          <div style={{ width: 18, height: 18, borderRadius: "50%", background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", fontWeight: 800 }}>
                            ✓
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Lots */}
              <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
                  Lots inclus ({selectedLots.length})
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {ALL_LOTS.map((lot) => {
                    const active = selectedLots.includes(lot);
                    return (
                      <button
                        key={lot}
                        className="rt-pill rt-btn"
                        onClick={() => toggleLot(lot)}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 20,
                          border: `1px solid ${active ? ACCENT : "#e2e8f0"}`,
                          background: active ? ACCENT_LIGHT : "#f8fafc",
                          fontSize: 11,
                          fontWeight: 600,
                          color: active ? ACCENT_DARK : "#64748b",
                        }}
                      >
                        {active ? "✓ " : ""}
                        {TRAVAUX_LOT_LABELS[lot].split("/")[0].trim()}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Bouton */}
          <button
            className="rt-btn"
            onClick={handleGenerate}
            disabled={!hasImages || !state.selectedImageId || isLoading}
            style={{
              width: "100%",
              padding: "14px 0",
              borderRadius: 12,
              border: "none",
              background: !hasImages || !state.selectedImageId || isLoading ? "#e2e8f0" : GRAD,
              color: !hasImages || isLoading ? "#94a3b8" : "#fff",
              fontSize: 15,
              fontWeight: 800,
              cursor: !hasImages || isLoading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              boxShadow: !hasImages || isLoading ? "none" : "0 4px 20px rgba(37,99,235,.3)",
            }}
          >
            {isLoading ? (
              <>
                <span
                  className="rt-spin"
                  style={{
                    display: "inline-block",
                    width: 16,
                    height: 16,
                    border: "2px solid rgba(255,255,255,.4)",
                    borderTopColor: "#fff",
                    borderRadius: "50%",
                  }}
                />{" "}
                Génération…
              </>
            ) : (
              <>✨ Générer le rendu IA</>
            )}
          </button>

          {state.error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#dc2626", lineHeight: 1.5 }}>
              ⚠ {state.error}
            </div>
          )}
        </div>

        {/* Droite */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", overflow: "hidden", minHeight: 400 }}>
            {isLoading && <Loader progress={state.progress} accent={ACCENT} />}

            {!isLoading && latestResult && (
              <div className="rt-in">
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#1e293b" }}>Rendu généré — Comparaison avant / après</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                      Glissez le curseur · {latestResult.durationMs ? `${(latestResult.durationMs / 1000).toFixed(1)}s` : "—"}
                    </div>
                  </div>
                  {/* ── Boutons d'action ── */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="rt-btn"
                      onClick={() => useInSynthese(latestResult)}
                      style={{
                        padding: "7px 14px",
                        borderRadius: 8,
                        border: `1px solid ${ACCENT}`,
                        background: ACCENT,
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      📌 Utiliser dans la synthèse
                    </button>
                    <button
                      className="rt-btn"
                      onClick={() => dl(latestResult.generatedImageUrl)}
                      style={{
                        padding: "7px 14px",
                        borderRadius: 8,
                        border: `1px solid ${ACCENT}`,
                        background: ACCENT_LIGHT,
                        color: ACCENT_DARK,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      ⬇ Télécharger
                    </button>
                    <button
                      className="rt-btn"
                      onClick={clearResults}
                      style={{
                        padding: "7px 14px",
                        borderRadius: 8,
                        border: "1px solid #e2e8f0",
                        background: "#f8fafc",
                        color: "#64748b",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      🗑 Effacer
                    </button>
                  </div>
                </div>

                <div style={{ padding: 20 }}>
                  <BeforeAfterSlider beforeUrl={latestResult.sourcePreview} afterUrl={latestResult.generatedImageUrl} accent={ACCENT} />
                </div>

                <div style={{ padding: "0 20px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
                      📷 Avant
                    </div>
                    <img
                      src={latestResult.sourcePreview}
                      alt="Avant"
                      style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 10, border: "1px solid #e2e8f0" }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
                      ✨ Après IA
                    </div>
                    <img
                      src={latestResult.generatedImageUrl}
                      alt="Après"
                      style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 10, border: `1px solid ${ACCENT}` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {!isLoading && !latestResult && (
              <div style={{ padding: "64px 32px", textAlign: "center", color: "#94a3b8" }}>
                <div style={{ fontSize: 56, marginBottom: 16 }}>🏠</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#64748b", marginBottom: 8 }}>Votre rendu apparaîtra ici</div>
                <div style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 320, margin: "0 auto" }}>
                  Uploadez une photo, configurez les travaux, et cliquez sur «{" "}
                  <strong style={{ color: ACCENT }}>Générer le rendu IA</strong> ».
                </div>
              </div>
            )}
          </div>

          {latestResult && !isLoading && (
            <div className="rt-in" style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: "16px 20px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
                Prompt de génération
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: "#475569",
                  lineHeight: 1.6,
                  margin: 0,
                  fontFamily: "monospace",
                  background: "#f8fafc",
                  borderRadius: 8,
                  padding: 12,
                  border: "1px solid #e2e8f0",
                }}
              >
                {latestResult.prompt}
              </p>
            </div>
          )}

          {state.results.length > 1 && (
            <div className="rt-in" style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: "16px 20px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 12 }}>
                Historique ({state.results.length} rendus)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
                {state.results.map((r) => (
                  <div key={r.id} style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid #e2e8f0" }}>
                    <img src={r.generatedImageUrl} alt="Rendu" style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }} />
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        background: "linear-gradient(transparent,rgba(0,0,0,.6))",
                        padding: "8px 6px 6px",
                        fontSize: 10,
                        color: "#fff",
                        fontWeight: 600,
                      }}
                    >
                      {new Date(r.generatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <button
                      onClick={() => dl(r.generatedImageUrl)}
                      title="Télécharger"
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        border: "none",
                        background: "rgba(0,0,0,.5)",
                        color: "#fff",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      ⬇
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}