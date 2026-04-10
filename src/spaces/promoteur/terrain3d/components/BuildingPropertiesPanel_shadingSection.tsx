// ═══════════════════════════════════════════════════════════════════════════════
// SNIPPET — BuildingPropertiesPanel.tsx
// Section "Protections de façade" à insérer dans le panneau existant.
//
// IMPORTS à ajouter en haut du fichier :
//   import { ShieldCheck } from "lucide-react";
//   import { Switch }       from "@/components/ui/switch";
//   import { Slider }       from "@/components/ui/slider";
//   import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
//              from "@/components/ui/select";
//   import { cn } from "@/lib/utils";
//   import type { ShadingConfig, ShadingDeviceType } from "./massingFacadeEngine";
//
// POSITION : après la section "Balcons" dans le JSX du panneau.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Constantes (hors JSX, dans le corps du composant) ───────────────────────

const SHADING_OPTIONS: { value: ShadingDeviceType | "none"; label: string }[] = [
  { value: "none",           label: "Aucune" },
  { value: "brise_soleil",   label: "Brise-soleil" },
  { value: "awning",         label: "Store banne" },
  { value: "swing_shutters", label: "Volets battants" },
  { value: "roller_shutter", label: "Volet roulant" },
  { value: "roller_blind",   label: "Store enrouleur" },
  { value: "sliding_panel",  label: "Panneau coulissant" },
];

// Helper pour patcher shadingConfig sans muter l'objet
function patchShading(
  building: BuildingAssemblyInput,
  onUpdate: (patch: Partial<BuildingAssemblyInput>) => void,
  patch: Partial<ShadingConfig>,
) {
  onUpdate({
    shadingConfig: {
      enabled:   false,
      type:      "none",
      openRatio: 0.5,
      frequency: 1,
      ...building.shadingConfig,
      ...patch,
    },
  });
}

// ─── JSX (à copier dans le rendu du composant) ────────────────────────────────

/*
{/* ═══ PROTECTIONS DE FAÇADE ═══════════════════════════════════════════════ *}
<div className="panel-section border border-zinc-800 rounded-lg p-3 space-y-2">

  {/* En-tête *}
  <div className="flex items-center gap-2 mb-1">
    <ShieldCheck size={13} className="text-violet-400 shrink-0" />
    <span className="text-xs font-medium text-zinc-300 uppercase tracking-wide">
      Protections de façade
    </span>
  </div>

  {/* Activer / désactiver *}
  <div className="flex items-center justify-between">
    <label className="text-xs text-zinc-400">Activer</label>
    <Switch
      checked={building.shadingConfig?.enabled ?? false}
      onCheckedChange={(v) =>
        patchShading(building, onUpdate, { enabled: v })
      }
    />
  </div>

  {(building.shadingConfig?.enabled) && (
    <div className="space-y-2 pt-1">

      {/* Type *}
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-zinc-400 shrink-0">Type</label>
        <Select
          value={building.shadingConfig?.type ?? "none"}
          onValueChange={(v) =>
            patchShading(building, onUpdate, { type: v as ShadingDeviceType })
          }
        >
          <SelectTrigger className="h-7 text-xs flex-1 bg-zinc-900 border-zinc-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="text-xs">
            {SHADING_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Ouverture / Fermeture (selon type) *}
      {["awning", "swing_shutters", "roller_shutter", "roller_blind", "sliding_panel"].includes(
        building.shadingConfig?.type ?? "",
      ) && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-xs text-zinc-400">
              {building.shadingConfig?.type === "roller_shutter"
                ? "Fermeture"
                : "Ouverture"}
            </label>
            <span className="text-xs text-zinc-500 tabular-nums">
              {Math.round((building.shadingConfig?.openRatio ?? 0.5) * 100)}%
            </span>
          </div>
          <Slider
            min={0}
            max={100}
            step={5}
            value={[(building.shadingConfig?.openRatio ?? 0.5) * 100]}
            onValueChange={([v]) =>
              patchShading(building, onUpdate, { openRatio: v / 100 })
            }
            className="w-full"
          />
        </div>
      )}

      {/* Fréquence *}
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-zinc-400 shrink-0">Fréquence</label>
        <Select
          value={String(building.shadingConfig?.frequency ?? 1)}
          onValueChange={(v) =>
            patchShading(building, onUpdate, { frequency: Number(v) })
          }
        >
          <SelectTrigger className="h-7 text-xs w-24 bg-zinc-900 border-zinc-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="1">Toutes les baies</SelectItem>
            <SelectItem value="2">1 baie sur 2</SelectItem>
            <SelectItem value="3">1 baie sur 3</SelectItem>
            <SelectItem value="4">1 baie sur 4</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Sélection des niveaux *}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-zinc-400">Niveaux</label>
          <button
            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={() => patchShading(building, onUpdate, { levels: undefined })}
          >
            Tous
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: building.totalFloors }, (_, i) => {
            const active = (building.shadingConfig?.levels ?? []).includes(i);
            return (
              <button
                key={i}
                onClick={() => {
                  const cur  = building.shadingConfig?.levels ?? [];
                  const next = cur.includes(i)
                    ? cur.filter((l) => l !== i)
                    : [...cur, i].sort((a, b) => a - b);
                  patchShading(building, onUpdate, { levels: next });
                }}
                className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors",
                  active
                    ? "bg-violet-700 border-violet-500 text-white"
                    : "bg-zinc-900 border-zinc-700 text-zinc-500 hover:text-zinc-300",
                )}
              >
                {i === 0 ? "RDC" : `R+${i}`}
              </button>
            );
          })}
        </div>
      </div>

    </div>
  )}
</div>
*/

// ─── Export vide (ce fichier est un snippet, pas un module réel) ─────────────
export {};