// src/spaces/promoteur/pages/ProgrammationPage.tsx
//
// V4 — MULTI-BÂTIMENTS. Branchée sur le store central « programme ».
//   • Chaque bâtiment (plot) a ses propres niveaux, emprise, typologies + surfaces,
//     et commerce. Cas d'usage : village sénior, village vacances, îlot multi-plots.
//   • « + Ajouter un bâtiment » / dupliquer / supprimer (min. 1 bâtiment).
//   • Contrôle PLU sur les AGRÉGATS : emprise = Σ bâtiments (CES parcelle-globale),
//     hauteur = MAX des niveaux. Parkings / espaces verts restent à l'échelle parcelle.
//   • Enveloppe (SDP géométrique) reste la vérité géométrique TOTALE du Massing 3D ;
//     la réconciliation compare Σ SDP programme vs SDP enveloppe.
//   • Plus AUCUN calcul € ici : l'argent est entièrement au Bilan.

import { CheckCircle, Copy, Loader2, Plus, Target, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

// V1.1 — Publication du contexte vers l'Analyste Mimmoza.
// Le panneau Copilot est monté hors de cette page (layout global) : le seul
// canal est activeCopilotContext. Sans publication → réponse générique.
import {
  setActiveCopilotContext,
  clearActiveCopilotContext,
  normalizeStudyId,
} from "../../copilot/store/activeCopilotContext.store";
import {
  HeroPrimaryButton,
  PromoteurPageHero,
} from "../shared/components/PromoteurPageHero";
import { getSnapshot, patchModule } from "../shared/promoteurSnapshot.store";
import { usePromoteurStudy } from "../shared/usePromoteurStudy";
// V1.4 — Mapper PLU factorisé (partagé avec Implantation 2D, Massing 3D…)
import { mapPluRuleset } from "../shared/pluRuleset.mapper";
import {
  aggregatedTypologies,
  commerceProgrammeM2,
  empriseTotaleM2,
  HAUTEUR_NIVEAU_M,
  maxNiveaux,
  nbLogementsBatiment,
  nbLogementsMix,
  reconcile,
  sdpProgrammeM2,
  shabBatiment,
  shabProgrammeM2,
  usePromoteurProgrammeStore,
  weightedSurfaces,
  type ProgrammeBatiment,
  type ProgrammeEnvelope,
  type TypologieKey,
} from "../store/promoteurProgramme.store";
// PATCH — SDP géométrique DÉDUITE du programme (Σ emprise × niveaux × 0,82),
// ne vient plus du Massing 3D.
import { sdpGeometriqueDerive } from "../plan2d/programSync";

// ─── Types ────────────────────────────────────────────────────────────────────

type TypeProjet = "collectif" | "maisons_groupees" | "residence_senior" | "mixte";
type ComplianceStatus = "conforme" | "a_verifier" | "non_conforme";
type ViabiliteStatus = "viable" | "conditions" | "non_viable";

const TYPE_PROJET_OPTIONS: Array<{ label: string; value: TypeProjet }> = [
  { label: "Collectif (logements)",          value: "collectif" },
  { label: "Maisons groupées",               value: "maisons_groupees" },
  { label: "Résidence senior",               value: "residence_senior" },
  { label: "Mixte logements + commerce",     value: "mixte" },
];

const NIVEAUX_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "RDC seulement (1 niveau)", value: "1" },
  ...Array.from({ length: 19 }, (_, i) => ({
    label: `R+${i + 1} (${i + 2} niveaux)`,
    value: String(i + 2),
  })),
];

const TYPO_KEYS: TypologieKey[] = ["T1", "T2", "T3", "T4", "T5"];

// ─── Helpers format ───────────────────────────────────────────────────────────

function fmt(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat("fr-FR", opts).format(n);
}
function fmtEur(n: number): string {
  return fmt(n, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}
function fmtPct(n: number): string {
  return fmt(n, { maximumFractionDigits: 1 }) + "\u00a0%";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ title, children, style, action }: {
  title: string; children: React.ReactNode; style?: React.CSSProperties; action?: React.ReactNode;
}) {
  return (
    <div style={{
      background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12,
      padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", ...style,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #EDE9FE", paddingBottom: 10, marginBottom: 16 }}>
        <h2 style={{
          margin: 0, fontSize: 13, fontWeight: 700, color: "#6D28D9",
          textTransform: "uppercase", letterSpacing: "0.06em",
        }}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function SubHeading({ label }: { label: string }) {
  return (
    <p style={{
      margin: "14px 0 8px", fontSize: 11, fontWeight: 700, color: "#7C3AED",
      textTransform: "uppercase", letterSpacing: "0.05em",
    }}>
      {label}
    </p>
  );
}

function FieldRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      padding: "7px 0", borderBottom: "1px solid #F3F4F6",
    }}>
      <span style={{ fontSize: 13, color: "#6B7280", flexShrink: 0, paddingRight: 12 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", textAlign: "right" }}>
        {value}
        {note && <span style={{ fontSize: 11, color: "#9CA3AF", display: "block" }}>{note}</span>}
      </span>
    </div>
  );
}

function KpiCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: boolean;
}) {
  return (
    <div style={{
      background: accent ? "#F5F3FF" : "#F9FAFB",
      border: `1px solid ${accent ? "#DDD6FE" : "#E5E7EB"}`,
      borderRadius: 10, padding: "12px 14px",
    }}>
      <p style={{ margin: 0, fontSize: 10, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </p>
      <p style={{ margin: "3px 0 0", fontSize: 17, fontWeight: 800, color: accent ? "#6D28D9" : "#111827", lineHeight: 1.1 }}>
        {value}
      </p>
      {sub && <p style={{ margin: "3px 0 0", fontSize: 11, color: "#9CA3AF" }}>{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: ComplianceStatus }) {
  const map: Record<ComplianceStatus, { bg: string; text: string; border: string; label: string }> = {
    conforme:     { bg: "#F0FDF4", text: "#15803D", border: "#BBF7D0", label: "✓ Conforme" },
    a_verifier:   { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A", label: "⚠ À vérifier" },
    non_conforme: { bg: "#FEF2F2", text: "#B91C1C", border: "#FECACA", label: "✗ Non conforme" },
  };
  const s = map[status];
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 9999,
      fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
      background: s.bg, color: s.text, border: `1px solid ${s.border}`,
    }}>
      {s.label}
    </span>
  );
}

function NumberInput({ label, value, onChange, unit, min, max, step, disabled, hint }: {
  label: string; value: number; onChange: (v: number) => void;
  unit?: string; min?: number; max?: number; step?: number; disabled?: boolean; hint?: string;
}) {
  // V1.3 — Saisie libre : le champ était piloté par un `number`, donc impossible
  // de le vider pour retaper (« 0 » collant, « 058 »…) → on tenait le state en
  // string pendant la frappe et on ne remonte au parent qu'une valeur valide.
  const [draft, setDraft] = useState<string>(String(value));
  const [focused, setFocused] = useState(false);

  // Resynchronise quand le parent change la valeur hors saisie (reset, duplication…).
  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const commit = (raw: string) => {
    const n = raw.trim() === "" ? 0 : Number(raw);
    onChange(Number.isFinite(n) ? n : 0);
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 3 }}>
        {label}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="number" value={draft} min={min ?? 0} max={max} step={step ?? 1} disabled={disabled}
          onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
          style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: 13, color: disabled ? "#6B7280" : "#111827", outline: "none", background: disabled ? "#F3F4F6" : "#FAFAFA", fontFamily: "inherit" }}
          onFocus={(e) => {
            setFocused(true);
            if (!disabled) {
              e.currentTarget.style.borderColor = "#7C3AED";
              e.currentTarget.select();   // tout sélectionné : on tape par-dessus
            }
          }}
          onBlur={(e) => {
            setFocused(false);
            setDraft(String(value));      // normalise l'affichage (« 058 » → « 58 »)
            e.currentTarget.style.borderColor = "#D1D5DB";
          }}
        />
        {unit && <span style={{ fontSize: 12, color: "#9CA3AF", minWidth: 38, textAlign: "left" }}>{unit}</span>}
      </div>
      {hint && <p style={{ margin: "3px 0 0", fontSize: 10, color: "#9CA3AF" }}>{hint}</p>}
    </div>
  );
}

function SelectInput<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void;
  options: Array<{ label: string; value: T }>;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 3 }}>
        {label}
      </label>
      <select
        value={value} onChange={(e) => onChange(e.target.value as T)}
        style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: 13, color: "#111827", background: "#FAFAFA", outline: "none", fontFamily: "inherit" }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "#7C3AED")}
        onBlur={(e)  => (e.currentTarget.style.borderColor = "#D1D5DB")}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ─── Réconciliation enveloppe ↔ programme ──────────────────────────────────────

// Indicateur de RENDEMENT surfacique SHAB/SDP (remplace l'ancienne réconciliation
// programme↔enveloppe, devenue une donnée à elle-même depuis que la SDP géométrique
// est DÉDUITE du programme). Bande saine 75–85 % (collectif).
function RendementBanner({ shab, sdp }: { shab: number; sdp: number }) {
  const ratio = sdp > 0 ? shab / sdp : 0;
  const pct = Math.round(ratio * 100);
  const state: "vide" | "bas" | "ok" | "haut" =
    sdp <= 0 ? "vide" : ratio < 0.75 ? "bas" : ratio > 0.85 ? "haut" : "ok";
  const theme = {
    vide: { bg: "#F9FAFB", border: "#E5E7EB", text: "#6B7280", icon: "📐", msg: "Renseignez l'emprise et les niveaux des bâtiments." },
    bas:  { bg: "#FFFBEB", border: "#FDE68A", text: "#B45309", icon: "🟡", msg: "Circulations / pertes élevées (rendement sous 75 %)." },
    ok:   { bg: "#F0FDF4", border: "#86EFAC", text: "#15803D", icon: "✅", msg: "Rendement dans la fourchette courante (75–85 %)." },
    haut: { bg: "#FFFBEB", border: "#FDE68A", text: "#B45309", icon: "🟡", msg: "SHAB supérieure au ratio courant — vérifiez les surfaces saisies." },
  }[state];
  const showBar = sdp > 0;
  // Barre 0–100 % avec repère de bande saine 75–85 %.
  const barPct = Math.min(100, pct);
  return (
    <div style={{ background: theme.bg, border: `1.5px solid ${theme.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: showBar ? 10 : 0 }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>{theme.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>
            Rendement SHAB / SDP{showBar ? ` : ${pct} %` : ""} — {theme.msg}
          </div>
        </div>
      </div>
      {showBar && (
        <div>
          <div style={{ position: "relative", height: 8, borderRadius: 6, background: "rgba(0,0,0,0.06)", overflow: "hidden" }}>
            {/* bande saine 75–85 % */}
            <div style={{ position: "absolute", left: "75%", width: "10%", height: "100%", background: "rgba(21,128,61,0.18)" }} />
            <div style={{ width: `${barPct}%`, height: "100%", background: theme.text, opacity: 0.55, transition: "width 0.25s" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: theme.text, marginTop: 4, fontWeight: 600 }}>
            <span>SHAB {Math.round(shab)} m²</span>
            <span>SDP {Math.round(sdp)} m² (déduit du programme)</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ConclusionCard({ status, reasons }: { status: ViabiliteStatus; reasons: string[] }) {
  const map: Record<ViabiliteStatus, { bg: string; border: string; text: string; title: string; icon: string }> = {
    viable:     { bg: "#F0FDF4", border: "#86EFAC", text: "#15803D", title: "Projet viable en l'état",       icon: "✅" },
    conditions: { bg: "#FFFBEB", border: "#FDE68A", text: "#B45309", title: "Projet viable sous conditions", icon: "⚠️" },
    non_viable: { bg: "#FEF2F2", border: "#FECACA", text: "#B91C1C", title: "Projet non viable",            icon: "❌" },
  };
  const s = map[status];
  return (
    <div style={{ background: s.bg, border: `2px solid ${s.border}`, borderRadius: 10, padding: "18px 22px" }}>
      <p style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 800, color: s.text }}>{s.icon}&nbsp; {s.title}</p>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {reasons.map((r, i) => <li key={i} style={{ fontSize: 13, color: s.text, marginBottom: 4 }}>{r}</li>)}
      </ul>
    </div>
  );
}

// ─── Carte d'un bâtiment ───────────────────────────────────────────────────────

function BatimentCard({
  bat, index, canRemove, showCommerce,
  onPatch, onSetTypologie, onSetSurface, onDuplicate, onRemove,
}: {
  bat: ProgrammeBatiment;
  index: number;
  canRemove: boolean;
  showCommerce: boolean;
  onPatch: (patch: Partial<Omit<ProgrammeBatiment, "id" | "typologies" | "surfaces">>) => void;
  onSetTypologie: (key: TypologieKey, nb: number) => void;
  onSetSurface: (key: TypologieKey, m2: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const nb   = nbLogementsBatiment(bat);
  const shab = shabBatiment(bat);
  const hauteur = bat.niveaux * HAUTEUR_NIVEAU_M;

  return (
    <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 16px", marginBottom: 14, background: "#FCFCFD" }}>
      {/* En-tête bâtiment */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 26, height: 26, borderRadius: 8, background: "#EDE9FE",
          color: "#6D28D9", fontSize: 13, fontWeight: 800, flexShrink: 0,
        }}>
          {index + 1}
        </span>
        <input
          type="text" value={bat.nom} onChange={(e) => onPatch({ nom: e.target.value })}
          placeholder={`Bâtiment ${index + 1}`}
          style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid #E5E7EB", fontSize: 13, fontWeight: 600, color: "#111827", outline: "none", background: "#FFFFFF", fontFamily: "inherit" }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#7C3AED")}
          onBlur={(e)  => (e.currentTarget.style.borderColor = "#E5E7EB")}
        />
        <button type="button" onClick={onDuplicate} title="Dupliquer"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 7, border: "1px solid #E5E7EB", background: "#FFFFFF", color: "#6B7280", cursor: "pointer" }}>
          <Copy size={14} />
        </button>
        <button type="button" onClick={onRemove} disabled={!canRemove}
          title={canRemove ? "Supprimer" : "Au moins un bâtiment requis"}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 7, border: "1px solid #E5E7EB", background: "#FFFFFF", color: canRemove ? "#DC2626" : "#D1D5DB", cursor: canRemove ? "pointer" : "not-allowed" }}>
          <Trash2 size={14} />
        </button>
      </div>

      {/* Niveaux + emprise */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
        <SelectInput<string> label="Nombre de niveaux" value={String(bat.niveaux)}
          onChange={(v) => onPatch({ niveaux: Number(v) })} options={NIVEAUX_OPTIONS} />
        <NumberInput label="Emprise au sol projetée" value={bat.empriseSolM2}
          onChange={(v) => onPatch({ empriseSolM2: Math.max(0, v || 0) })} unit="m²" min={0}
          hint={`hauteur estimée ${hauteur.toFixed(1)} m`} />
      </div>

      {/* Typologies du bâtiment */}
      <div style={{ border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden", marginTop: 6, marginBottom: showCommerce ? 8 : 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "56px 1fr 1fr 72px", background: "#F5F3FF", padding: "7px 12px", fontSize: 11, fontWeight: 700, color: "#7C3AED", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>
          <span>Type</span><span>Nb logements</span><span>Surface (m²)</span><span style={{ textAlign: "right" as const }}>SDP</span>
        </div>
        {TYPO_KEYS.map((key, i) => {
          const nbT = bat.typologies[key] || 0;
          const surf = bat.surfaces[key] || 0;
          const sdp = nbT * surf; const isActive = nbT > 0;
          return (
            <div key={key} style={{ display: "grid", gridTemplateColumns: "56px 1fr 1fr 72px", alignItems: "center", padding: "6px 12px", borderTop: i > 0 ? "1px solid #F3F4F6" : undefined, background: isActive ? "#FDFCFF" : "white" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: isActive ? "#7C3AED" : "#9CA3AF" }}>{key}</span>
              <div style={{ paddingRight: 10 }}>
                <input type="number" value={nbT} min={0} onChange={e => onSetTypologie(key, Number(e.target.value))} placeholder="0"
                  style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: `1px solid ${isActive ? "#C4B5FD" : "#E5E7EB"}`, fontSize: 13, color: "#111827", outline: "none", background: isActive ? "#F5F3FF" : "#FAFAFA", fontFamily: "inherit", boxSizing: "border-box" as const }}
                  onFocus={e => (e.currentTarget.style.borderColor = "#7C3AED")} onBlur={e => (e.currentTarget.style.borderColor = isActive ? "#C4B5FD" : "#E5E7EB")} />
              </div>
              <div style={{ paddingRight: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <input type="number" value={surf} min={10} step={1} onChange={e => onSetSurface(key, Number(e.target.value))}
                  style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: `1px solid ${isActive ? "#C4B5FD" : "#E5E7EB"}`, fontSize: 13, color: "#111827", outline: "none", background: isActive ? "#F5F3FF" : "#FAFAFA", fontFamily: "inherit", boxSizing: "border-box" as const }}
                  onFocus={e => (e.currentTarget.style.borderColor = "#7C3AED")} onBlur={e => (e.currentTarget.style.borderColor = isActive ? "#C4B5FD" : "#E5E7EB")} />
                <span style={{ fontSize: 11, color: "#9CA3AF", flexShrink: 0 }}>m²</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: isActive ? "#5B21B6" : "#D1D5DB", textAlign: "right" as const }}>{isActive ? `${Math.round(sdp)} m²` : "—"}</span>
            </div>
          );
        })}
        <div style={{ display: "grid", gridTemplateColumns: "56px 1fr 1fr 72px", alignItems: "center", padding: "8px 12px", background: "#EDE9FE", borderTop: "2px solid #DDD6FE" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#6D28D9" }}>Sous-total</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>{nb} lgt.</span>
          <span style={{ fontSize: 11, color: "#7C3AED" }}>{nb > 0 ? `moy. ${(shab / nb).toFixed(0)} m²` : "—"}</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#5B21B6", textAlign: "right" as const }}>{Math.round(shab)} m²</span>
        </div>
      </div>

      {showCommerce && (
        <NumberInput label="Surface commerce (ce bâtiment)" value={bat.commerceM2}
          onChange={(v) => onPatch({ commerceM2: Math.max(0, v || 0) })} unit="m²" min={0} />
      )}
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function ProgrammationPage() {
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");
  const { study, loadState } = usePromoteurStudy(studyId);

  // ── Store programme (source de vérité) ──
  const envelope             = usePromoteurProgrammeStore((s) => s.envelope);
  const mix                  = usePromoteurProgrammeStore((s) => s.mix);
  const loadStudy            = usePromoteurProgrammeStore((s) => s.loadStudy);
  const addBatiment          = usePromoteurProgrammeStore((s) => s.addBatiment);
  const removeBatiment       = usePromoteurProgrammeStore((s) => s.removeBatiment);
  const duplicateBatiment    = usePromoteurProgrammeStore((s) => s.duplicateBatiment);
  const patchBatiment        = usePromoteurProgrammeStore((s) => s.patchBatiment);
  const setBatimentTypologie = usePromoteurProgrammeStore((s) => s.setBatimentTypologie);
  const setBatimentSurface   = usePromoteurProgrammeStore((s) => s.setBatimentSurface);
  const patchMix             = usePromoteurProgrammeStore((s) => s.patchMix);
  const importNotice         = usePromoteurProgrammeStore((s) => s.importNotice);
  const clearImportNotice    = usePromoteurProgrammeStore((s) => s.clearImportNotice);

  useEffect(() => { loadStudy(studyId); }, [studyId, loadStudy]);

  // ── Terrain (lecture étude / snapshot) ──
  const foncierData = useMemo(() => {
    const fromStudy = (study as any)?.foncier;
    const fromSnap  = getSnapshot()?.foncier as any;
    return fromStudy ?? fromSnap ?? null;
  }, [study]);

  const terrain = useMemo(() => {
    const f = foncierData;
    if (!f) return { surfaceM2: 0, prixVendeur: 0, codePostal: "", commune: "", typeBien: "", adresse: "", pluDisponible: false };
    const featureProps = f.parcels_raw?.[0]?.feature?.properties ?? {};
    const inseeFromParcel = (() => {
      const id = f.focus_id ?? f.parcel_ids?.[0] ?? "";
      return typeof id === "string" && id.length >= 5 ? id.slice(0, 5) : "";
    })();
    const commune =
      f.commune_nom ?? f.commune ?? f.ville ?? f.city ??
      f.nom_commune ?? f.libelle_commune ??
      featureProps.nom_com ?? featureProps.nom_commune ??
      featureProps.commune ?? featureProps.libelle_commune ??
      (inseeFromParcel ? `INSEE ${inseeFromParcel}` : "");
    const codePostal = f.code_postal ?? f.codePostal ?? f.cp ?? f.zip ?? f.parcels_raw?.[0]?.feature?.properties?.code_postal ?? "";
    const adresse = f.adresse ?? f.address ?? f.label ?? f.source_label ?? f.libelle ?? f.adresse_complete ?? f.focus_id ?? "";
    const typeBien = f.type_bien ?? f.typeBien ?? f.type ?? f.nature ?? "Terrain";
    const prixVendeur = f.prix_foncier ?? f.prixVendeur ?? f.prix_vendeur ?? f.prix ?? f.price ?? f.valeur ?? 0;
    return {
      surfaceM2: f.surface_m2 ?? f.surfaceM2 ?? f.surface ?? 0,
      prixVendeur, codePostal, commune, typeBien, adresse,
      pluDisponible: Boolean((study as any)?.plu ?? getSnapshot()?.plu),
    };
  }, [foncierData, study]);

  // ───────────────────────────────────────────────────────────────────────────
  // V1.4 — Lecture du PLU via le mapper factorisé.
  //   Avant : ~100 lignes de parsing dupliquées avec Implantation2DPage, avec
  //   des listes de clés DIVERGENTES — un bug corrigé dans l'une réapparaissait
  //   dans l'autre (ex. `max_m` absent → hauteur max à 0 → « à vérifier » sur
  //   une règle pourtant lue).
  //
  //   Deux bugs corrigés au passage :
  //     • `empriseMaxPct: numFrom(ces) ?? 0` lisait `ces.max_ratio` (un RATIO
  //       0–1) et l'affichait tel quel → « 0,6 % » d'emprise max au lieu de 60 %.
  //     • idem `pleine_terre.ratio_min: 0.35` → « 0,35 % » au lieu de 35 %.
  //   Invisibles sur une zone sans CES (Ascain UB), faux partout ailleurs.
  //
  //   ⚠️ Le contrat local (zone/description/reculVoirie/espaceVertMinPct…) est
  //   conservé : le reste de la page (FieldRow, pluChecks) est inchangé.
  // ───────────────────────────────────────────────────────────────────────────
  const plu = useMemo(() => {
    const raw = (study as any)?.plu ?? getSnapshot()?.plu ?? null;
    const r   = mapPluRuleset(raw);

    return {
      zone:                 r.zone,
      description:          r.description,
      hauteurEgoutM:        r.hauteurEgoutM,
      hauteurFaitageM:      r.hauteurFaitageM,
      hauteurMaxM:          r.hauteurMaxM,
      hauteurEgoutFromNote: r.hauteurEgoutFromNote,
      // 0 = pas de règle CES (cf. r.empriseAbsente) — jamais « emprise nulle ».
      empriseMaxPct:        r.empriseMaxPct,
      empriseNote:          r.empriseNote,
      reculVoirie:          r.reculVoirieM,
      reculVoirieNote:      r.reculVoirieNote,
      reculLimites:         r.reculLimitesM,
      reculLimitesNote:     r.reculLimitesNote,
      parkingParLogement:   r.parkingParLogement,
      espaceVertMinPct:     r.pleineTerreMinPct ?? 0,
      pleineTerreMinPct:    r.pleineTerreMinPct,
      pleineTerreNote:      r.pleineTerreNote,
      coefficientOccupSol:  r.coefficientOccupSol,
      cosNote:              r.cosNote,
      extra:                r.extra,
    };
  }, [study]);

  // ── Valeurs effectives ──
  const typeProjet   = (mix.typeProjet || "collectif") as TypeProjet;
  const showCommerce = typeProjet === "mixte";
  const batiments    = mix.batiments;

  // Agrégats (source des contrôles PLU à l'échelle parcelle).
  const empriseTotale = empriseTotaleM2(mix);
  const niveauxMaxVal = maxNiveaux(mix);
  // PATCH — SDP géométrique DÉDUITE du programme (Σ emprise × niveaux × 0,82).
  const sdpGeo        = useMemo(() => sdpGeometriqueDerive(mix), [mix]);
  const envFromMassing = envelope?.source === "massing";

  // ── Dérivés programme ──
  const nbLogements     = nbLogementsMix(mix);
  const sdpLogement     = shabProgrammeM2(mix);
  const commerceTotal   = commerceProgrammeM2(mix);
  const hauteurEstimeeM = niveauxMaxVal * HAUTEUR_NIVEAU_M;
  // PATCH — réconciliation calculée sur le SDP géométrique DÉDUIT du programme
  // (enveloppe synthétique), et non plus sur l'enveloppe Massing. Compare la SDP
  // des typologies (nb×surf + commerce) à la SDP géométrique (emprise×niveaux).
  // Le BANDEAU, lui, affiche le rendement SHAB/SDP (RendementBanner).
  const recon = useMemo(() => {
    if (sdpGeo <= 0) return reconcile(null, mix);
    const synthEnv: ProgrammeEnvelope = {
      empriseSolM2: empriseTotale, niveaux: niveauxMaxVal, sdpGeoM2: sdpGeo,
      facadeM2: 0, facadeNetteM2: 0, toitureTerrasseM2: 0, toiturePenteM2: 0,
      balconsM2: 0, nbMenuiseries: 0, nbBatiments: batiments.length,
      source: "manual", updatedAt: new Date(0).toISOString(),
    };
    return reconcile(synthEnv, mix);
  }, [mix, sdpGeo, empriseTotale, niveauxMaxVal, batiments.length]);

  // ───────────────────────────────────────────────────────────────────────────
  // V1.1 — Publication du contexte vers l'Analyste Mimmoza
  //   On passe par pageSnapshot (LOT 8) : déjà supporté de bout en bout
  //   (store → copilotClient → copilot-chat → system prompt), donc aucun
  //   patch Edge Function nécessaire.
  //   ⚠️ Les deps contiennent l'état vivant (mix, envelope) : le snapshot doit
  //      se rafraîchir à chaque saisie, pas seulement au montage.
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setActiveCopilotContext({
      studyId:  normalizeStudyId(studyId),
      parcelId: foncierData?.focus_id ?? foncierData?.parcel_ids?.[0] ?? undefined,
      surface:  terrain.surfaceM2 > 0 ? Math.round(terrain.surfaceM2) : undefined,
      city:     terrain.commune || undefined,
      zipCode:  terrain.codePostal || undefined,
      route:    "/promoteur/programmation",
      vertical: "promoteur",
      pageContext: {
        pathname: "/promoteur/programmation",
        space:    "promoteur",
        mode:     "conception",
        tab:      "programmation",
      },
      pageSnapshot: {
        // ── Terrain ──
        parcelle:              foncierData?.focus_id ?? null,
        adresse:               terrain.adresse || null,
        commune:               terrain.commune || null,
        surface_terrain_m2:    Math.round(terrain.surfaceM2) || null,
        type_de_bien:          terrain.typeBien || null,
        prix_vendeur_eur:      terrain.prixVendeur || null,
        // ── Règles PLU appliquées ──
        plu_disponible:        terrain.pluDisponible ? "oui" : "non — règlement non importé",
        plu_zone:              plu.zone || null,
        plu_zone_libelle:      plu.description || null,
        plu_hauteur_max_m:     plu.hauteurMaxM || null,
        plu_emprise_max_pct:   plu.empriseMaxPct || null,
        plu_parking_par_logement: plu.parkingParLogement ?? null,
        // ── Programme saisi ──
        nb_batiments:          mix.batiments?.length ?? 0,
        nb_logements:          nbLogements,
        shab_logements_m2:     Math.round(sdpLogement) || null,
        commerce_m2:           Math.round(commerceTotal) || null,
        emprise_totale_m2:     Math.round(empriseTotale) || null,
        emprise_pct_terrain:   terrain.surfaceM2 > 0
          ? Math.round((empriseTotale / terrain.surfaceM2) * 1000) / 10
          : null,
        sdp_enveloppe_m2:      sdpGeo > 0 ? Math.round(sdpGeo) : null,
        sdp_enveloppe_source:  "déduit du programme",
        taux_remplissage_pct:  recon.sdpGeoM2 > 0 ? Math.round(recon.tauxRemplissage * 100) : null,
        hauteur_max_projet_m:  hauteurEstimeeM > 0 ? Math.round(hauteurEstimeeM * 10) / 10 : null,
        nb_parkings:           mix.nbParkings || null,
        espaces_verts_m2:      mix.espacesVertsM2 || null,
      },
    });
    return () => clearActiveCopilotContext();
  }, [
    studyId, foncierData, terrain, plu,
    mix, envelope, sdpGeo, envFromMassing, recon, hauteurEstimeeM,
    nbLogements, sdpLogement, commerceTotal, empriseTotale,
  ]);

  // ── Contrôle PLU (réglementaire, NON chiffré) — sur AGRÉGATS ──
  type PluCheck = { critere: string; valeurProjet: string; valeurPLU: string; status: ComplianceStatus };

  const pluChecks = useMemo((): PluCheck[] => {
    if (!terrain.pluDisponible) return [];
    const emprisePctProjet = terrain.surfaceM2 > 0 ? (empriseTotale / terrain.surfaceM2) * 100 : 0;
    const parkingsRequis  = nbLogements * plu.parkingParLogement;
    const espaceVertMin   = terrain.surfaceM2 * ((plu.pleineTerreMinPct ?? plu.espaceVertMinPct) / 100);
    const checkEmprise = (): ComplianceStatus => {
      if (plu.empriseMaxPct === 0) return "a_verifier";
      if (emprisePctProjet <= plu.empriseMaxPct) return "conforme";
      if (emprisePctProjet <= plu.empriseMaxPct * 1.05) return "a_verifier";
      return "non_conforme";
    };
    const checkHauteur = (): ComplianceStatus => {
      const hMax = plu.hauteurEgoutM ?? plu.hauteurMaxM;
      if (!hMax) return "a_verifier";
      if (hauteurEstimeeM <= hMax) return "conforme";
      if (hauteurEstimeeM <= hMax * 1.05) return "a_verifier";
      return "non_conforme";
    };
    const checkParkings = (): ComplianceStatus => {
      if (mix.nbParkings >= parkingsRequis) return "conforme";
      if (mix.nbParkings >= Math.ceil(parkingsRequis * 0.9)) return "a_verifier";
      return "non_conforme";
    };
    const checkVerts = (): ComplianceStatus => {
      if (mix.espacesVertsM2 >= espaceVertMin) return "conforme";
      if (mix.espacesVertsM2 >= espaceVertMin * 0.9) return "a_verifier";
      return "non_conforme";
    };
    const hauteurLabel = batiments.length > 1 ? `${hauteurEstimeeM.toFixed(1)} m (max, ${niveauxMaxVal} niv.)` : `${hauteurEstimeeM.toFixed(1)} m (${niveauxMaxVal} niv.)`;
    const empriseLabel = batiments.length > 1 ? `${fmtPct(emprisePctProjet)} (${fmt(empriseTotale)} m² · ${batiments.length} bât.)` : `${fmtPct(emprisePctProjet)} (${fmt(empriseTotale)} m²)`;
    return [
      { critere: "Emprise au sol",               valeurProjet: empriseLabel, valeurPLU: plu.empriseMaxPct > 0 ? `max. ${fmtPct(plu.empriseMaxPct)}` : "Pas de règle CES", status: checkEmprise() },
      { critere: "Hauteur du projet",            valeurProjet: hauteurLabel, valeurPLU: plu.hauteurEgoutM != null ? `max. ${plu.hauteurEgoutM} m (égout)` : plu.hauteurMaxM > 0 ? `max. ${plu.hauteurMaxM} m` : "—", status: checkHauteur() },
      { critere: "Stationnement",                valeurProjet: `${mix.nbParkings} place${mix.nbParkings > 1 ? "s" : ""}`, valeurPLU: `min. ${parkingsRequis} (${plu.parkingParLogement} pl/logt)`, status: checkParkings() },
      { critere: "Pleine terre / espaces verts", valeurProjet: `${fmt(mix.espacesVertsM2)} m²`, valeurPLU: espaceVertMin > 0 ? `min. ${fmt(Math.round(espaceVertMin))} m² (${plu.pleineTerreMinPct ?? plu.espaceVertMinPct} %)` : "Pas de règle", status: checkVerts() },
    ];
  }, [terrain, empriseTotale, nbLogements, plu, hauteurEstimeeM, niveauxMaxVal, mix.nbParkings, mix.espacesVertsM2, batiments.length]);

  // ── Conclusion viabilité (PLU + cohérence enveloppe, sans argent) ──
  const { viabilite, reasons } = useMemo((): { viabilite: ViabiliteStatus; reasons: string[] } => {
    const msgs: string[] = [];
    let warnings = 0;
    for (const check of pluChecks) {
      if (check.status === "non_conforme") { warnings++; msgs.push(`PLU — ${check.critere} à confirmer : ${check.valeurProjet} (règle : ${check.valeurPLU})`); }
      else if (check.status === "a_verifier") { warnings++; msgs.push(`PLU — ${check.critere} à vérifier : ${check.valeurProjet} (règle : ${check.valeurPLU})`); }
    }
    if (!terrain.pluDisponible) { warnings++; msgs.push("PLU non chargé — le contrôle réglementaire reste à confirmer"); }
    if (nbLogements === 0) { warnings++; msgs.push("Aucun logement saisi — renseignez au moins un type de logement"); }
    if (batiments.length > 1) { msgs.push(`Projet multi-bâtiments : ${batiments.length} bâtiments — contrôles PLU calculés sur les agrégats (emprise Σ, hauteur max).`); }
    if (recon.statut === "depassement") { warnings++; msgs.push(recon.message); }
    else if (recon.statut === "sous_rempli") { msgs.push(recon.message); }
    else if (recon.statut === "coherent") { msgs.push(recon.message); }
    else if (recon.statut === "no_envelope") { warnings++; msgs.push("Enveloppe non définie — dessinez le volume dans le Massing 3D ou saisissez l'emprise/niveaux."); }
    const status: ViabiliteStatus = warnings > 0 ? "conditions" : "viable";
    return { viabilite: status, reasons: msgs };
  }, [pluChecks, terrain.pluDisponible, nbLogements, recon, batiments.length]);

  // ── Snapshot synthèse (sans argent — l'argent est au Bilan) ──
  const [validated, setValidated] = useState(false);
  const handleSaveForBilan = () => {
    setValidated(true);
    setTimeout(() => setValidated(false), 2600);
    patchModule("programmation", {
      typeProjet,
      niveaux: niveauxMaxVal,                       // max des bâtiments (compat)
      nbLogements,
      empriseSol: empriseTotale,                    // Σ emprises (compat)
      typologies: aggregatedTypologies(mix),        // agrégé (compat)
      surfacesTypologies: weightedSurfaces(mix),    // moyenne pondérée (compat)
      surfaceCommerce: showCommerce ? commerceTotal : 0,
      nbParkings: mix.nbParkings, espacesVerts: mix.espacesVertsM2,
      sdpLogement, sdpGeoM2: sdpGeo,
      tauxRemplissage: recon.tauxRemplissage,
      pluViabilite: viabilite,
      // ── Détail multi-bâtiments ──
      nbBatiments: batiments.length,
      batiments: batiments.map((b) => ({
        id: b.id, nom: b.nom, niveaux: b.niveaux, empriseSolM2: b.empriseSolM2,
        typologies: { ...b.typologies }, surfaces: { ...b.surfaces },
        commerceM2: b.commerceM2,
        nbLogements: nbLogementsBatiment(b), shabM2: shabBatiment(b),
      })),
      ok: true, validated: true,
      summary: `${batiments.length} bât. · ${nbLogements} logement(s) · ${Math.round(sdpLogement)} m² SHAB · ${viabilite}`,
      updatedAt: new Date().toISOString(),
    } as any);
  };

  if (loadState === "loading") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, fontFamily: "inherit" }}>
        <Loader2 size={28} color="#7C3AED" style={{ animation: "spin 1s linear infinite" }} />
        <span style={{ marginLeft: 14, fontSize: 14, color: "#6B7280" }}>Chargement de l'étude…</span>
        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "inherit" }}>

      {/* ── Hero ── */}
      <div style={{ marginBottom: 24 }}>
        <PromoteurPageHero
          badge="Promoteur · Programmation"
          title="Programmation du projet"
          metaLines={[
            { text: "Répartissez vos logements et vérifiez la cohérence avec l'enveloppe et le PLU." },
            ...(batiments.length > 1 ? [{ text: `🏢 Projet multi-bâtiments — ${batiments.length} bâtiments.` }] : []),
            ...(!terrain.pluDisponible ? [{ text: "⚠️ PLU non encore chargé — contrôle réglementaire provisoire." }] : []),
            // V1.5 — La SDP est désormais DÉDUITE du programme (Programmation =
            // source de vérité) : le Massing 3D n'alimente plus l'enveloppe.
          ]}
          statCards={[
            { label: batiments.length > 1 ? "Bât. / Logts" : "Logements", value: batiments.length > 1 ? `${batiments.length} / ${nbLogements}` : `${nbLogements}`, tone: "indigo" as const },
            ...(recon.sdpGeoM2 > 0
              ? [{ label: "Remplissage", value: `${Math.round(recon.tauxRemplissage * 100)} %`, tone: "emerald" as const }]
              : [{ label: "SHAB", value: `${Math.round(sdpLogement)} m²`, tone: "emerald" as const }]),
          ]}
          actions={
            <HeroPrimaryButton onClick={handleSaveForBilan}>
              {validated ? "✓ Programme validé" : "Valider le programme"}
            </HeroPrimaryButton>
          }
        />
      </div>

      <div style={{ padding: "0 0 32px" }}>

        {/* ── Ligne 1 : Terrain + Programme ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

          <SectionCard title="Terrain analysé">
            <FieldRow label="Numéro de parcelle" value={terrain.adresse || "—"} />
            <FieldRow label="Commune"      value={terrain.commune ? `${terrain.commune}${terrain.codePostal ? ` (${terrain.codePostal})` : ""}` : "—"} />
            <FieldRow label="Type de bien" value={terrain.typeBien || "—"} />
            <FieldRow label="Surface terrain" value={terrain.surfaceM2 > 0 ? `${fmt(terrain.surfaceM2)} m²` : "—"} />
            <FieldRow label="Prix vendeur"    value={terrain.prixVendeur > 0 ? fmtEur(terrain.prixVendeur) : "—"} />
            <FieldRow label="Prix terrain au m²" value={terrain.surfaceM2 > 0 && terrain.prixVendeur > 0 ? `${fmt(Math.round(terrain.prixVendeur / terrain.surfaceM2))} €/m²` : "—"} />

            {terrain.pluDisponible ? (
              <>
                <SubHeading label="Règles PLU" />
                <FieldRow label="Zone" value={plu.zone || "—"} />
                {plu.description ? <div style={{ fontSize: 12, color: "#6B7280", padding: "2px 0 8px", fontStyle: "italic" }}>{plu.description}</div> : null}
                {(plu.hauteurEgoutM != null || plu.hauteurEgoutFromNote != null) && <FieldRow label="Hauteur max. (égout)" value={`${plu.hauteurEgoutM ?? plu.hauteurEgoutFromNote} m`} />}
                {plu.hauteurFaitageM != null && <FieldRow label="Hauteur faîtage" value={`${plu.hauteurFaitageM} m`} />}
                {plu.hauteurEgoutM == null && plu.hauteurEgoutFromNote == null && plu.hauteurFaitageM == null && plu.hauteurMaxM > 0 && <FieldRow label="Hauteur max." value={`${plu.hauteurMaxM} m`} />}
                <FieldRow label="Emprise au sol (CES)" value={plu.empriseMaxPct > 0 ? `${plu.empriseMaxPct} %` : "—"} note={plu.empriseNote ?? (plu.empriseMaxPct === 0 ? "Pas de règle" : undefined)} />
                {plu.reculVoirie != null && <FieldRow label="Recul voirie" value={`${plu.reculVoirie} m`} note={plu.reculVoirieNote ?? undefined} />}
                {plu.reculLimites != null && <FieldRow label="Recul limites" value={`${plu.reculLimites} m`} note={plu.reculLimitesNote ?? undefined} />}
                <FieldRow label="Stationnement" value={`${plu.parkingParLogement} pl/logt`} />
                {plu.pleineTerreMinPct != null && <FieldRow label="Pleine terre min." value={`${plu.pleineTerreMinPct} %`} note={plu.pleineTerreNote ?? undefined} />}
                {plu.espaceVertMinPct > 0 && plu.pleineTerreMinPct == null && <FieldRow label="Espaces verts min." value={`${plu.espaceVertMinPct} %`} />}
                <FieldRow label="COS" value={plu.coefficientOccupSol != null ? String(plu.coefficientOccupSol) : "—"} note={plu.cosNote ?? (plu.coefficientOccupSol == null ? "Pas de COS" : undefined)} />
                {plu.extra.map(e => <FieldRow key={e.label} label={e.label} value={e.value ?? "—"} note={e.note ?? undefined} />)}
              </>
            ) : (
              <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 8, background: "#F9FAFB", border: "1px dashed #D1D5DB", fontSize: 13, color: "#9CA3AF", textAlign: "center" }}>
                📋 PLU non encore chargé — contrôle provisoire.
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Programme immobilier"
            action={
              <button type="button" onClick={addBatiment}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "1px solid #DDD6FE", background: "#F5F3FF", color: "#6D28D9", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                <Plus size={14} /> Ajouter un bâtiment
              </button>
            }
          >
            {/* Réconciliation enveloppe ↔ programme (agrégée) */}
            {importNotice > 0 && (
              <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#B45309" }}>
                  ⚠️ {importNotice} bâtiment{importNotice > 1 ? "s" : ""} importé{importNotice > 1 ? "s" : ""} depuis le plan masse — vérifiez les doublons.
                </span>
                <button onClick={clearImportNotice} style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 8, border: "1px solid #FDE68A", background: "white", color: "#B45309", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  Compris
                </button>
              </div>
            )}
            <RendementBanner shab={sdpLogement} sdp={sdpGeo} />

            <SelectInput<TypeProjet> label="Type de projet" value={typeProjet} onChange={(v) => patchMix({ typeProjet: v })} options={TYPE_PROJET_OPTIONS} />

            {/* SDP géométrique — enveloppe TOTALE (Massing) */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 3 }}>SDP géométrique (enveloppe totale)</label>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid #E5E7EB", fontSize: 13, color: sdpGeo > 0 ? "#111827" : "#9CA3AF", background: "#F3F4F6" }}>
                  {sdpGeo > 0 ? `${fmt(Math.round(sdpGeo))}` : "—"}
                </div>
                <span style={{ fontSize: 12, color: "#9CA3AF", minWidth: 38 }}>m²</span>
              </div>
              <p style={{ margin: "3px 0 0", fontSize: 10, color: "#9CA3AF" }}>
                {sdpGeo > 0
                  ? "📐 déduit du programme (Σ emprise × niveaux × 0,82)"
                  : "renseignez l'emprise et les niveaux ci-dessous"}
              </p>
            </div>

            {/* Bâtiments */}
            <SubHeading label={batiments.length > 1 ? `Bâtiments (${batiments.length})` : "Bâtiment"} />
            {batiments.map((bat, index) => (
              <BatimentCard
                key={bat.id}
                bat={bat}
                index={index}
                canRemove={batiments.length > 1}
                showCommerce={showCommerce}
                onPatch={(patch) => patchBatiment(bat.id, patch)}
                onSetTypologie={(key, nb) => setBatimentTypologie(bat.id, key, nb)}
                onSetSurface={(key, m2) => setBatimentSurface(bat.id, key, m2)}
                onDuplicate={() => duplicateBatiment(bat.id)}
                onRemove={() => removeBatiment(bat.id)}
              />
            ))}

            {/* Total tous bâtiments */}
            {batiments.length > 1 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, padding: "12px 14px", background: "#EDE9FE", border: "2px solid #DDD6FE", borderRadius: 10, marginBottom: 4 }}>
                <div><p style={{ margin: 0, fontSize: 10, color: "#7C3AED", textTransform: "uppercase" as const, fontWeight: 700 }}>Total logements</p><p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 800, color: "#111827" }}>{nbLogements}</p></div>
                <div><p style={{ margin: 0, fontSize: 10, color: "#7C3AED", textTransform: "uppercase" as const, fontWeight: 700 }}>SHAB total</p><p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 800, color: "#5B21B6" }}>{fmt(Math.round(sdpLogement))} m²</p></div>
                <div><p style={{ margin: 0, fontSize: 10, color: "#7C3AED", textTransform: "uppercase" as const, fontWeight: 700 }}>Emprise Σ</p><p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 800, color: "#111827" }}>{fmt(Math.round(empriseTotale))} m²</p></div>
              </div>
            )}

            {/* Équipements — échelle parcelle */}
            <SubHeading label="Équipements (parcelle)" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              <NumberInput label="Parkings prévus" value={mix.nbParkings}   onChange={(v) => patchMix({ nbParkings: Math.max(0, Math.floor(v || 0)) })} min={0} />
              <NumberInput label="Espaces verts"   value={mix.espacesVertsM2} onChange={(v) => patchMix({ espacesVertsM2: Math.max(0, v || 0) })} unit="m²" min={0} />
            </div>
          </SectionCard>
        </div>

        {/* ── Ligne 2 : Programme & enveloppe (surfaces, sans argent) ── */}
        <SectionCard title="Programme & enveloppe" style={{ marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <KpiCard label="Bâtiments"         value={`${batiments.length}`} accent />
            <KpiCard label="Logements"         value={`${nbLogements}`} sub={nbLogements > 0 ? `moy. ${(sdpLogement / nbLogements).toFixed(0)} m²/lgt` : undefined} accent />
            <KpiCard label="SHAB logements"    value={`${fmt(Math.round(sdpLogement))} m²`} />
            {showCommerce && <KpiCard label="Surface commerce" value={`${fmt(Math.round(commerceTotal))} m²`} />}
            <KpiCard label="SDP programme"     value={`${fmt(Math.round(sdpProgrammeM2(mix)))} m²`} sub="SHAB + commerce" />
            <KpiCard label="SDP géométrique"   value={sdpGeo > 0 ? `${fmt(Math.round(sdpGeo))} m²` : "—"} sub="déduit du programme" />
            <KpiCard label="Remplissage"       value={recon.sdpGeoM2 > 0 ? `${Math.round(recon.tauxRemplissage * 100)} %` : "—"} accent={recon.statut === "coherent"} />
            <KpiCard label="Hauteur max."      value={`${hauteurEstimeeM.toFixed(1)} m`} sub={`${niveauxMaxVal} niveaux`} />
            <KpiCard label="Emprise au sol"    value={empriseTotale > 0 ? `${fmt(Math.round(empriseTotale))} m²` : "—"} sub={terrain.surfaceM2 > 0 && empriseTotale > 0 ? `${fmtPct((empriseTotale / terrain.surfaceM2) * 100)} du terrain` : undefined} />
          </div>
        </SectionCard>

        {/* ── Contrôle PLU ── */}
        <SectionCard title="Contrôle PLU" style={{ marginBottom: 20 }}>
          {!terrain.pluDisponible ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#9CA3AF", fontSize: 14, background: "#F9FAFB", borderRadius: 8 }}>
              📋 PLU non chargé — le contrôle réglementaire sera disponible après chargement du PLU.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  <th style={thStyle}>Critère PLU</th>
                  <th style={thStyle}>Valeur projet</th>
                  <th style={thStyle}>Règle PLU</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Statut</th>
                </tr>
              </thead>
              <tbody>
                {pluChecks.map((check, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={tdStyle}>{check.critere}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{check.valeurProjet}</td>
                    <td style={{ ...tdStyle, color: "#6B7280" }}>{check.valeurPLU}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}><StatusBadge status={check.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        {/* ── Conclusion ── */}
        <SectionCard title="Conclusion & viabilité" style={{ marginBottom: 20 }}>
          <ConclusionCard status={viabilite} reasons={reasons} />
          <p style={{ margin: "14px 0 0", fontSize: 12, color: "#9CA3AF" }}>
            * Viabilité réglementaire et cohérence d'enveloppe. Le bilan financier (CA, coûts, marge) est calculé dans l'onglet <strong>Bilan</strong>.
          </p>
        </SectionCard>

        {/* ── Footer ── */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handleSaveForBilan}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "12px 24px", borderRadius: 10, border: "none",
              fontSize: 14, fontWeight: 700,
              cursor: validated ? "default" : "pointer",
              background: validated
                ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
                : "linear-gradient(135deg, #7c6fcd 0%, #5247b8 100%)",
              color: "white",
              transform: validated ? "scale(1.03)" : "scale(1)",
              boxShadow: validated ? "0 6px 18px rgba(16,185,129,0.4)" : "0 2px 8px rgba(82,71,184,0.25)",
              transition: "all 0.25s cubic-bezier(0.34,1.56,0.64,1)",
            }}
          >
            {validated
              ? <><CheckCircle size={16} />Programme validé ✓</>
              : <><Target size={16} />Valider le programme</>}
          </button>
        </div>

      </div>
    </div>
  );
}

// ─── Styles statiques ─────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700,
  color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.04em",
  borderBottom: "2px solid #E5E7EB",
};
const tdStyle: React.CSSProperties = {
  padding: "11px 14px", color: "#111827",
};