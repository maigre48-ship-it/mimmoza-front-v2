/**
 * SourcingHomePage - Page d'accueil du module Sourcing
 * Avec SmartScore EN PREMIER puis Résumé EN DESSOUS
 *
 * ── Deal-scoped ──
 * Toute persistance (smartscore, formState, draft) est scoppée par dealId.
 * Si aucun deal actif → affiche un placeholder "Sélectionnez un deal".
 * Nouveau deal sans données → pré-rempli depuis le dealContext meta (Pipeline).
 *
 * ── FIX v3 : initialValues synchrone + double écriture LS ──
 * 1. initialValues calculé via useMemo (synchrone, même cycle de render)
 * 2. Seed écrit dans la clé LS scoppée AVANT le mount de SourcingForm
 * 3. Seed AUSSI écrit dans la clé LS legacy (non-scoppée) pour compatibilité
 *    avec SourcingForm qui peut hydrater depuis sa propre source LS interne.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { SourcingForm } from "../forms/SourcingForm";
import SmartScorePanel from "../../../components/sourcing/SmartScorePanel";

import { useSmartScore } from "../shared/hooks/useSmartScore";

import type {
  SourcingItemDraft,
  ProfileTarget,
  PropertyType,
} from "../types/sourcing.types";

import {
  formatFloor,
  formatPrice,
  formatSurface,
  calculatePricePerSqm,
  parseFloor,
} from "../utils/validators";

import { getPropertyTypeLabel } from "../selectors/propertySelectors";

import {
  getActiveDealId,
  getDealContextSnapshot,
  getDealContextMeta,
  subscribe as subscribeDealContext,
  type DealContextMeta,
} from "../../marchand/shared/marchandDealContext.store";

// ============================================
// FORM STATE
// ============================================

interface FormState {
  codePostal: string;
  rueProche: string;
  ville: string;
  arrondissement: string;
  quartier: string;
  propertyType: string;
  price: string;
  surface: string;
  floor: string;
  [key: string]: string;
}

const EMPTY_FORM: FormState = {
  codePostal: "",
  rueProche: "",
  ville: "",
  arrondissement: "",
  quartier: "",
  propertyType: "",
  price: "",
  surface: "",
  floor: "",
};

// ============================================
// DEAL-SCOPED PERSISTENCE KEYS
// ============================================

const SMARTSCORE_LS_PREFIX = "mimmoza.sourcing.smartscore.v1";

/** Clé scoppée par deal  */
function smartscoreKey(dealId: string): string {
  return `${SMARTSCORE_LS_PREFIX}.${dealId}`;
}

/**
 * Clés LS legacy NON-scoppées que SourcingForm pourrait lire en interne.
 * On y écrit le seed pour que SourcingForm trouve les bonnes données au mount.
 */
const LEGACY_LS_KEYS = [
  "mimmoza.sourcing.smartscore.v1",     // ancienne clé SmartScore
  "mimmoza.sourcing.formState",          // état formulaire
  "mimmoza.sourcing.snapshot.v1",        // snapshot
] as const;

// ============================================
// PARSER FR
// ============================================

function parseNumberFR(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  const s = String(v)
    .trim()
    .replace(/[\s\u00A0\u202F]/g, "")
    .replace(/[^\d,.-]/g, "")
    .replace(",", ".");

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ============================================
// MINIMUM VIABLE MESSAGE
// ============================================

const MINIMUM_VIABLE_MSG =
  "Renseigner le prix et la surface pour calculer le SmartScore.";

// ============================================
// LOCAL SMARTSCORE COMPUTATION
// ============================================

interface LocalSmartScoreResult {
  globalScore: number;
  score: number;
  grade: "A" | "B" | "C" | "D" | "E";
  verdict: "GO" | "GO_AVEC_RESERVES" | "NO_GO";
  globalRationale: string;
  rationale: string;
  details: {
    prixM2: number | null;
    bonusMalus: { label: string; value: number }[];
  };
  minimumMet: boolean;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function gradeFromScore(s: number): "A" | "B" | "C" | "D" | "E" {
  if (s >= 80) return "A";
  if (s >= 65) return "B";
  if (s >= 50) return "C";
  if (s >= 35) return "D";
  return "E";
}

function verdictFromScore(s: number): "GO" | "GO_AVEC_RESERVES" | "NO_GO" {
  if (s >= 65) return "GO";
  if (s >= 40) return "GO_AVEC_RESERVES";
  return "NO_GO";
}

function computeSmartScoreFromDraft(draft: any): LocalSmartScoreResult {
  const price = Number(draft.input?.price || draft.price) || 0;
  const surface = Number(draft.input?.surface || draft.surface) || 0;

  if (price <= 0 || surface <= 0) {
    return {
      globalScore: 0, score: 0, grade: "E", verdict: "NO_GO",
      globalRationale: MINIMUM_VIABLE_MSG, rationale: MINIMUM_VIABLE_MSG,
      details: { prixM2: null, bonusMalus: [] }, minimumMet: false,
    };
  }

  const bonusMalus: { label: string; value: number }[] = [];
  const prixM2 = price / surface;
  const baseScore = clamp(Math.round(100 - prixM2 / 200), 0, 100);
  let totalBonus = 0;

  const etat = draft.input?.etatGeneral || draft.etatGeneral;
  if (etat) {
    const etatMap: Record<string, number> = {
      neuf: 8, bon: 4, moyen: 0, a_renover: -5, travaux_importants: -10,
    };
    const v = etatMap[etat] ?? 0;
    if (v !== 0) { bonusMalus.push({ label: `État: ${etat}`, value: v }); totalBonus += v; }
  }

  const dpe = draft.input?.dpe || draft.dpe;
  if (dpe) {
    const dpeMap: Record<string, number> = { A: 6, B: 4, C: 2, D: 0, E: -2, F: -5, G: -8 };
    const v = dpeMap[dpe.toUpperCase()] ?? 0;
    if (v !== 0) { bonusMalus.push({ label: `DPE ${dpe.toUpperCase()}`, value: v }); totalBonus += v; }
  }

  const equipements: [string, string, number][] = [
    ["ascenseur", "Ascenseur", 2], ["balcon", "Balcon", 2], ["terrasse", "Terrasse", 3],
    ["cave", "Cave", 1], ["parking", "Parking", 3], ["jardin", "Jardin", 3], ["garage", "Garage", 2],
  ];
  for (const [key, label, bonus] of equipements) {
    const val = draft.input?.[key] ?? draft[key];
    if (val === true || val === "oui" || val === "true") {
      bonusMalus.push({ label, value: bonus }); totalBonus += bonus;
    }
  }

  const nbPieces = Number(draft.input?.nbPieces || draft.nbPieces) || 0;
  if (nbPieces >= 4) {
    const pb = Math.min((nbPieces - 3) * 2, 6);
    bonusMalus.push({ label: `${nbPieces} pièces`, value: pb }); totalBonus += pb;
  }

  const finalScore = clamp(Math.round(baseScore + totalBonus), 0, 100);
  const grade = gradeFromScore(finalScore);
  const verdict = verdictFromScore(finalScore);

  let rationale = `Prix/m² : ${Math.round(prixM2).toLocaleString("fr-FR")} €/m²`;
  if (bonusMalus.length > 0) {
    rationale += ` · Ajustements : ${bonusMalus.map((b) => `${b.label} (${b.value > 0 ? "+" : ""}${b.value})`).join(", ")}`;
  }
  rationale += ` · Verdict : ${verdict.replace(/_/g, " ")}`;

  return {
    globalScore: finalScore, score: finalScore, grade, verdict,
    globalRationale: rationale, rationale,
    details: { prixM2, bonusMalus }, minimumMet: true,
  };
}

// ============================================
// ENRICHISSEMENT
// ============================================

function buildEnrichedScore(
  computed: LocalSmartScoreResult, draft: any, hookScore: any, history: number[],
) {
  const { prixM2, bonusMalus } = computed.details;
  const price = Number(draft?.input?.price || draft?.price) || 0;
  const surface = Number(draft?.input?.surface || draft?.surface) || 0;
  const propertyType = draft?.input?.propertyType || draft?.propertyType || "";

  if (!computed.minimumMet) {
    return {
      globalScore: 0, score: 0, grade: "E" as const, verdict: "NO_GO",
      globalRationale: MINIMUM_VIABLE_MSG, rationale: MINIMUM_VIABLE_MSG,
      explanations: [MINIMUM_VIABLE_MSG],
      missingData: [...(price <= 0 ? ["price"] : []), ...(surface <= 0 ? ["surface"] : [])],
      subscores: [
        { name: "prix", label: "Prix/m²", rawScore: 0, weight: 0.4, hasData: false },
        { name: "qualite", label: "Qualité", rawScore: 0, weight: 0.3, hasData: false },
        { name: "completude", label: "Complétude", rawScore: 0, weight: 0.3, hasData: false },
      ],
      penalties: [], blockers: [], engineVersion: "sourcing-local-v1",
      computedAt: new Date().toISOString(), inputHash: "local",
      scoreHistory: history.length > 0 ? history : [0],
      details: computed.details, minimumMet: false,
    };
  }

  const explanations: string[] = [];
  if (prixM2 != null) explanations.push(`Prix/m² estimé : ${Math.round(prixM2).toLocaleString("fr-FR")} €/m²`);
  if (bonusMalus.length > 0) {
    explanations.push(`Ajustements : ${bonusMalus.map((b) => `${b.label} (${b.value > 0 ? "+" : ""}${b.value})`).join(", ")}`);
  }
  explanations.push(`Verdict : ${computed.verdict.replace(/_/g, " ")}`);

  const missingData: string[] = [];
  if (!propertyType) missingData.push("propertyType");

  const hasPriceData = price > 0 && surface > 0;
  const prixRawScore = hasPriceData ? clamp(Math.round(100 - (price / surface) / 200), 0, 100) : 0;

  const qualiteBonuses = bonusMalus.filter((b) =>
    b.label.startsWith("État") || b.label.startsWith("DPE") ||
    ["Ascenseur", "Balcon", "Terrasse", "Cave", "Parking", "Jardin", "Garage"].includes(b.label)
  );
  const qualiteSum = qualiteBonuses.reduce((acc, b) => acc + b.value, 0);
  const qualiteRawScore = clamp(Math.round(((qualiteSum + 18) / 48) * 100), 0, 100);

  const completudeFields = [
    price > 0, surface > 0, !!propertyType,
    !!(draft?.input?.etatGeneral || draft?.etatGeneral),
    !!(draft?.input?.dpe || draft?.dpe),
    !!(draft?.input?.nbPieces || draft?.nbPieces),
    !!(draft?.location?.codePostal),
    !!(draft?.location?.rueProche),
  ];
  const completudeRawScore = Math.round((completudeFields.filter(Boolean).length / completudeFields.length) * 100);

  return {
    ...((hookScore && typeof hookScore === "object") ? hookScore : {}),
    globalScore: computed.globalScore, score: computed.globalScore,
    grade: computed.grade, verdict: computed.verdict,
    globalRationale: computed.globalRationale, rationale: computed.rationale,
    explanations, missingData,
    subscores: [
      { name: "prix", label: "Prix/m²", rawScore: prixRawScore, weight: 0.4, hasData: hasPriceData },
      { name: "qualite", label: "Qualité", rawScore: qualiteRawScore, weight: 0.3, hasData: true },
      { name: "completude", label: "Complétude", rawScore: completudeRawScore, weight: 0.3, hasData: true },
    ],
    penalties: [], blockers: [], engineVersion: "sourcing-local-v1",
    computedAt: new Date().toISOString(), inputHash: "local",
    scoreHistory: history.length > 0 ? history : [computed.globalScore],
    details: computed.details, minimumMet: true,
  };
}

// ============================================
// RESOLVER
// ============================================

function resolveSmartScore(obj: any): { resolved: any | null; resolvedScore: number | null; } {
  if (obj == null) return { resolved: null, resolvedScore: null };
  const ss = obj.smartScore ?? obj.smartscore ?? obj.smartScoreResult ?? null;
  if (ss == null) {
    const directScore = obj.globalScore ?? obj.score ?? null;
    if (typeof directScore === "number") return { resolved: obj, resolvedScore: directScore };
    return { resolved: null, resolvedScore: null };
  }
  if (typeof ss === "number") return { resolved: { score: ss, globalScore: ss }, resolvedScore: ss };
  if (typeof ss === "object") {
    const n = ss.globalScore ?? ss.score ?? null;
    return { resolved: ss, resolvedScore: typeof n === "number" ? n : null };
  }
  return { resolved: null, resolvedScore: null };
}

// ============================================
// META → FORM STATE SEED
// ============================================

function buildSeedFromMeta(meta: DealContextMeta | undefined): FormState | null {
  if (!meta) return null;
  const hasAnyData = meta.zipCode || meta.city || meta.address || meta.purchasePrice || meta.surface;
  if (!hasAnyData) return null;

  return {
    codePostal: meta.zipCode ?? "",
    rueProche: meta.address ?? "",
    ville: meta.city ?? "",
    arrondissement: "",
    quartier: "",
    propertyType: "",
    price: meta.purchasePrice != null && meta.purchasePrice > 0 ? String(meta.purchasePrice) : "",
    surface: meta.surface != null && meta.surface > 0 ? String(meta.surface) : "",
    floor: "",
  };
}

// ============================================
// SCOPED LS HYDRATION (pure function)
// ============================================

interface HydrationBag {
  formState: FormState | null; // null = rien en LS
  localScore: LocalSmartScoreResult | null;
  lastDraft: any;
  scoreHistory: number[];
}

const EMPTY_BAG: HydrationBag = { formState: null, localScore: null, lastDraft: null, scoreHistory: [] };

function hydrateFromScopedLS(dealId: string): HydrationBag {
  const key = smartscoreKey(dealId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return EMPTY_BAG;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return EMPTY_BAG;

    const bag: HydrationBag = { ...EMPTY_BAG };
    const c = saved.computed;
    if (c && typeof c === "object" && typeof c.globalScore === "number" && c.minimumMet === true) {
      bag.localScore = c as LocalSmartScoreResult;
    }
    const fs = saved.formState;
    if (fs && typeof fs === "object" && typeof fs.price === "string") {
      bag.formState = fs as FormState;
    }
    if (saved.lastDraft && typeof saved.lastDraft === "object") bag.lastDraft = saved.lastDraft;
    if (Array.isArray(saved.scoreHistory)) bag.scoreHistory = saved.scoreHistory;
    return bag;
  } catch {
    return EMPTY_BAG;
  }
}

/**
 * Écrit le seed dans TOUTES les clés LS possibles que SourcingForm
 * pourrait lire au mount :
 *  - clé scoppée (mimmoza.sourcing.smartscore.v1.<dealId>)
 *  - clés legacy NON-scoppées (fallback)
 *
 * Le but est de garantir que SourcingForm, peu importe sa logique
 * interne d'hydratation, trouve les données du deal actif.
 */
function writeSeedToAllLSKeys(dealId: string, formState: FormState): void {
  const payload = JSON.stringify({
    formState,
    savedAt: new Date().toISOString(),
  });

  try {
    // 1. Clé scoppée (seulement si vide — ne pas écraser des données existantes)
    const scopedKey = smartscoreKey(dealId);
    if (!localStorage.getItem(scopedKey)) {
      localStorage.setItem(scopedKey, payload);
    }

    // 2. Clés legacy → TOUJOURS écraser (c'est le deal actif, ces clés ne sont pas scoppées)
    for (const legacyKey of LEGACY_LS_KEYS) {
      try {
        localStorage.setItem(legacyKey, payload);
      } catch { /* quota */ }
    }
  } catch { /* quota — silent */ }
}

/**
 * Résout formState + bag pour un dealId donné.
 * Pure function, synchrone, pas de side-effects React.
 *
 * Priorité :
 * 1) Données scoppées en LS (l'utilisateur a déjà travaillé sur ce deal)
 * 2) Seed depuis dealContext meta (Pipeline)
 * 3) null (page blanche)
 */
function resolveForDeal(dealId: string): { formState: FormState | null; bag: HydrationBag } {
  // 1) Tenter hydratation depuis clé LS scoppée
  const bag = hydrateFromScopedLS(dealId);
  if (bag.formState) {
    // Données existantes → aussi les écrire dans les clés legacy
    // pour que SourcingForm les retrouve
    writeSeedToAllLSKeys(dealId, bag.formState);
    return { formState: bag.formState, bag };
  }

  // 2) Seed depuis dealContext meta
  const meta = getDealContextMeta();
  const seed = buildSeedFromMeta(meta);
  if (seed) {
    writeSeedToAllLSKeys(dealId, seed);
    return { formState: seed, bag };
  }

  // 3) Rien — nettoyer les clés legacy pour éviter de polluer
  for (const legacyKey of LEGACY_LS_KEYS) {
    try { localStorage.removeItem(legacyKey); } catch { /* ignore */ }
  }
  return { formState: null, bag };
}

// ============================================
// STYLES
// ============================================

const styles = {
  page: { minHeight: "100vh", background: "#f5f7fa" } as React.CSSProperties,
  container: { display: "flex", gap: "24px", padding: "24px", maxWidth: "1600px", margin: "0 auto" } as React.CSSProperties,
  formSection: { flex: "1 1 55%", minWidth: 0 } as React.CSSProperties,
  rightSection: { flex: "1 1 45%", minWidth: "320px", maxWidth: "450px", position: "sticky" as const, top: "24px", alignSelf: "flex-start", display: "flex", flexDirection: "column" as const, gap: "16px" } as React.CSSProperties,
  smartScoreCard: { background: "#fff", borderRadius: "16px", padding: "32px 24px", textAlign: "center" as const, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", border: "1px solid #e2e8f0" } as React.CSSProperties,
  smartScoreIcon: { width: "72px", height: "72px", margin: "0 auto 16px", background: "linear-gradient(135deg, #e8f5e9 0%, #fff3e0 50%, #e3f2fd 100%)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" } as React.CSSProperties,
  smartScoreTitle: { fontSize: "1.25rem", fontWeight: "600", color: "#1e293b", marginBottom: "8px" } as React.CSSProperties,
  smartScoreText: { fontSize: "0.875rem", color: "#64748b", lineHeight: 1.6, maxWidth: "280px", margin: "0 auto" } as React.CSSProperties,
  summaryCard: { background: "#fff", borderRadius: "12px", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", border: "1px solid #e2e8f0" } as React.CSSProperties,
  summaryTitle: { fontSize: "1rem", fontWeight: "600", color: "#1e293b", margin: "0 0 16px 0", display: "flex", alignItems: "center", gap: "8px" } as React.CSSProperties,
  summarySection: { marginBottom: "16px" } as React.CSSProperties,
  summarySectionTitle: { fontSize: "0.75rem", fontWeight: "600", color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: "8px" } as React.CSSProperties,
  summaryRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: "0.875rem", borderBottom: "1px solid #f1f5f9" } as React.CSSProperties,
  summaryLabel: { color: "#64748b" } as React.CSSProperties,
  summaryValue: { color: "#1e293b", fontWeight: "500" } as React.CSSProperties,
  summaryValueEmpty: { color: "#cbd5e1" } as React.CSSProperties,
  summaryHighlight: { background: "#e0f2fe", padding: "12px", borderRadius: "8px", textAlign: "center" as const, marginTop: "12px" } as React.CSSProperties,
  summaryPricePerSqm: { fontSize: "1.25rem", fontWeight: "600", color: "#0369a1" } as React.CSSProperties,
  summaryPriceLabel: { fontSize: "0.75rem", color: "#64748b", marginTop: "2px" } as React.CSSProperties,
  validationBox: { marginTop: "16px", padding: "12px", background: "#fffbeb", borderRadius: "8px", border: "1px solid #fbbf24" } as React.CSSProperties,
  validationBoxSuccess: { background: "#ecfdf5", border: "1px solid #10b981" } as React.CSSProperties,
  validationTitle: { fontSize: "0.75rem", fontWeight: "600", color: "#92400e", textTransform: "uppercase" as const, marginBottom: "4px" } as React.CSSProperties,
  validationText: { fontSize: "0.875rem", color: "#b45309", margin: 0 } as React.CSSProperties,
  loadingContainer: { background: "#fff", borderRadius: "16px", padding: "48px 24px", textAlign: "center" as const, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" } as React.CSSProperties,
  spinner: { width: "48px", height: "48px", border: "4px solid #e2e8f0", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" } as React.CSSProperties,
  loadingTitle: { fontSize: "1.125rem", fontWeight: "600", color: "#1e293b", marginBottom: "4px" } as React.CSSProperties,
  loadingText: { fontSize: "0.875rem", color: "#64748b" } as React.CSSProperties,
  toast: { position: "fixed" as const, bottom: "24px", right: "24px", background: "#10b981", color: "#fff", padding: "16px 24px", borderRadius: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.15)", display: "flex", alignItems: "center", gap: "12px", zIndex: 1000, animation: "slideIn 0.3s ease-out", maxWidth: "400px" } as React.CSSProperties,
  toastError: { background: "#ef4444" } as React.CSSProperties,
  toastIcon: { fontSize: "1.5rem", flexShrink: 0 } as React.CSSProperties,
  toastContent: { display: "flex", flexDirection: "column" as const, gap: "2px", flex: 1, minWidth: 0 } as React.CSSProperties,
  toastTitle: { fontWeight: "600", fontSize: "0.9375rem" } as React.CSSProperties,
  toastMessage: { fontSize: "0.8125rem", opacity: 0.9, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" } as React.CSSProperties,
  toastClose: { background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", cursor: "pointer", padding: "6px", borderRadius: "6px", opacity: 0.8, fontSize: "1.125rem", lineHeight: 1, flexShrink: 0, transition: "opacity 0.2s" } as React.CSSProperties,
  noDealCard: { background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "16px", padding: "48px 24px", textAlign: "center" as const } as React.CSSProperties,
  noDealTitle: { fontSize: "1.25rem", fontWeight: "600", color: "#92400e", marginBottom: "8px" } as React.CSSProperties,
  noDealText: { fontSize: "0.875rem", color: "#b45309", lineHeight: 1.6 } as React.CSSProperties,
};

const injectStyles = () => {
  if (typeof document === "undefined") return;
  if (document.getElementById("sourcing-toast-styles")) return;
  const style = document.createElement("style");
  style.id = "sourcing-toast-styles";
  style.textContent = `
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);
};

interface ToastProps { type: "success" | "error"; title: string; message?: string; onClose: () => void; }
const Toast: React.FC<ToastProps> = ({ type, title, message, onClose }) => {
  useEffect(() => { injectStyles(); }, []);
  return (
    <div style={{ ...styles.toast, ...(type === "error" ? styles.toastError : {}) }}>
      <span style={styles.toastIcon}>{type === "success" ? "✓" : "✕"}</span>
      <div style={styles.toastContent}>
        <span style={styles.toastTitle}>{title}</span>
        {message && <span style={styles.toastMessage}>{message}</span>}
      </div>
      <button style={styles.toastClose} onClick={onClose} aria-label="Fermer">×</button>
    </div>
  );
};

// ============================================
// Résumé
// ============================================

const SummaryPanel: React.FC<{ form: FormState }> = ({ form }) => {
  const price = parseNumberFR(form.price);
  const surface = parseNumberFR(form.surface);
  const pricePerSqm = calculatePricePerSqm(price, surface);
  const hasLocation = !!(form.codePostal && form.rueProche);
  const hasBasicInfo = !!(form.propertyType && form.price && form.surface);
  const isValid = hasLocation && hasBasicInfo;
  return (
    <div style={styles.summaryCard}>
      <h3 style={styles.summaryTitle}>📋 Résumé</h3>
      <div style={styles.summarySection}>
        <div style={styles.summarySectionTitle}>LOCALISATION</div>
        <div style={styles.summaryRow}><span style={styles.summaryLabel}>Code postal</span><span style={form.codePostal ? styles.summaryValue : styles.summaryValueEmpty}>{form.codePostal || "-"}</span></div>
        <div style={styles.summaryRow}><span style={styles.summaryLabel}>Rue proche</span><span style={form.rueProche ? styles.summaryValue : styles.summaryValueEmpty}>{form.rueProche || "-"}</span></div>
        {form.ville && <div style={styles.summaryRow}><span style={styles.summaryLabel}>Ville</span><span style={styles.summaryValue}>{form.ville}</span></div>}
      </div>
      <div style={styles.summarySection}>
        <div style={styles.summarySectionTitle}>BIEN</div>
        <div style={styles.summaryRow}><span style={styles.summaryLabel}>Type</span><span style={form.propertyType ? styles.summaryValue : styles.summaryValueEmpty}>{form.propertyType ? getPropertyTypeLabel(form.propertyType as PropertyType) : "-"}</span></div>
        <div style={styles.summaryRow}><span style={styles.summaryLabel}>Prix</span><span style={price > 0 ? styles.summaryValue : styles.summaryValueEmpty}>{price > 0 ? formatPrice(price) : "-"}</span></div>
        <div style={styles.summaryRow}><span style={styles.summaryLabel}>Surface</span><span style={surface > 0 ? styles.summaryValue : styles.summaryValueEmpty}>{surface > 0 ? formatSurface(surface) : "-"}</span></div>
        <div style={styles.summaryRow}><span style={styles.summaryLabel}>Étage</span><span style={form.floor ? styles.summaryValue : styles.summaryValueEmpty}>{form.floor ? formatFloor(parseFloor(form.floor)) : "-"}</span></div>
      </div>
      {pricePerSqm ? (<div style={styles.summaryHighlight}><div style={styles.summaryPricePerSqm}>{formatPrice(pricePerSqm)}</div><div style={styles.summaryPriceLabel}>prix au m²</div></div>) : null}
      <div style={{ ...styles.validationBox, ...(isValid ? styles.validationBoxSuccess : {}) }}>
        <div style={{ ...styles.validationTitle, color: isValid ? "#065f46" : "#92400e" }}>VALIDATION</div>
        <p style={{ ...styles.validationText, color: isValid ? "#047857" : "#b45309", margin: 0 }}>{isValid ? "✓ Prêt à analyser" : "Remplir les champs obligatoires"}</p>
      </div>
    </div>
  );
};

// ============================================
// Placeholders
// ============================================

const SmartScorePlaceholder: React.FC = () => (
  <div style={styles.smartScoreCard}>
    <div style={styles.smartScoreIcon}>
      <svg width="36" height="36" viewBox="0 0 32 32" fill="none">
        <rect x="6" y="14" width="6" height="12" rx="1" fill="#22c55e" />
        <rect x="13" y="8" width="6" height="18" rx="1" fill="#f59e0b" />
        <rect x="20" y="4" width="6" height="22" rx="1" fill="#3b82f6" />
      </svg>
    </div>
    <div style={styles.smartScoreTitle}>SmartScore</div>
    <p style={styles.smartScoreText}>Remplissez le formulaire et cliquez sur "Enregistrer" pour calculer le score.</p>
  </div>
);

const NoDealPlaceholder: React.FC = () => (
  <div style={styles.noDealCard}>
    <div style={styles.noDealTitle}>Aucun deal actif</div>
    <p style={styles.noDealText}>Sélectionnez un deal dans le Pipeline pour commencer l'analyse Sourcing.</p>
  </div>
);

// ============================================
// COMPOSANT PRINCIPAL
// ============================================

interface SourcingHomePageProps { profileTarget?: ProfileTarget; }

export const SourcingHomePage: React.FC<SourcingHomePageProps> = ({
  profileTarget = "mdb",
}) => {
  /* ══════════════════════════════════════════
     DEAL ACTIF
     ══════════════════════════════════════════ */
  const [dealId, setDealId] = useState<string | null>(() => getActiveDealId());

  useEffect(() => {
    const unsub = subscribeDealContext((ctx) => { setDealId(ctx.activeDealId); });
    return unsub;
  }, []);

  /* ══════════════════════════════════════════
     INITIAL VALUES — synchrone via useMemo
     ══════════════════════════════════════════
     Critique : recalculé DANS LE MÊME RENDER que le changement de dealId.
     Ainsi, quand key={dealId} force le remount de SourcingForm,
     initialValues ET les clés LS sont déjà à jour.

     Side-effect volontaire dans useMemo (écriture LS) :
     c'est nécessaire pour que SourcingForm, qui peut hydrater
     depuis LS dans son useState initial, trouve les bonnes données.
  */
  const resolved = useMemo(() => {
    if (!dealId) return { formState: null as FormState | null, bag: EMPTY_BAG };
    return resolveForDeal(dealId);
  }, [dealId]);

  /* ══════════════════════════════════════════
     REACT STATE
     ══════════════════════════════════════════ */
  const [toast, setToast] = useState<{ show: boolean; type: "success" | "error"; title: string; message?: string; } | null>(null);
  const [formState, setFormState] = useState<FormState>(resolved.formState ?? EMPTY_FORM);
  const [localScore, setLocalScore] = useState<LocalSmartScoreResult | null>(resolved.bag.localScore);
  const [isComputing, setIsComputing] = useState(false);
  const [lastDraft, setLastDraft] = useState<any>(resolved.bag.lastDraft);
  const [scoreHistory, setScoreHistory] = useState<number[]>(resolved.bag.scoreHistory);

  // Guard protège contre les onFormChange parasites au premier mount
  const mountGuardRef = useRef(!!(resolved.formState));

  const { isLoading, score, hints, errors, analyzeAndComputeScore } = useSmartScore();

  /* ── Quand dealId change → reset state depuis resolved ── */
  const prevDealIdRef = useRef<string | null>(dealId);
  useEffect(() => {
    if (dealId === prevDealIdRef.current) return;
    prevDealIdRef.current = dealId;
    setFormState(resolved.formState ?? EMPTY_FORM);
    setLocalScore(resolved.bag.localScore);
    setLastDraft(resolved.bag.lastDraft);
    setScoreHistory(resolved.bag.scoreHistory);
    mountGuardRef.current = !!(resolved.formState);
  }, [dealId, resolved]);

  useEffect(() => { injectStyles(); }, []);
  useEffect(() => {
    if (toast?.show) { const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }
  }, [toast]);
  useEffect(() => {
    if ((errors?.length || 0) > 0) setToast({ show: true, type: "error", title: "Erreur de scoring", message: errors[0] });
  }, [errors]);

  /* ══════════════════════════════════════════
     CALLBACKS
     ══════════════════════════════════════════ */

  const handleFormChange = useCallback((form: FormState) => {
    if (mountGuardRef.current) {
      // Bloquer les émissions vides (SourcingForm émet souvent un form vide au mount)
      const isEmptyForm = !form.price && !form.surface && !form.codePostal;
      if (isEmptyForm) return;
      mountGuardRef.current = false;
    }
    setFormState(form);
  }, []);

  const handleSubmit = useCallback(
    async (draft: SourcingItemDraft) => {
      const currentDealId = getActiveDealId();
      if (!currentDealId) {
        setToast({ show: true, type: "error", title: "Aucun deal actif", message: "Sélectionnez un deal dans le Pipeline avant d'enregistrer." });
        return;
      }

      const apiDraft: any = {
        profileTarget: draft.profileTarget,
        location: { codePostal: draft.location?.codePostal || "", rueProche: draft.location?.rueProche || "", ville: draft.location?.ville || "" },
        input: {
          price: parseNumberFR(draft.price), surface: parseNumberFR(draft.surface),
          propertyType: draft.propertyType || "appartement", floor: draft.floor || "1",
          nbPieces: draft.nbPieces, etatGeneral: draft.etatGeneral, dpe: draft.dpe,
          ascenseur: draft.ascenseur, balcon: draft.balcon, terrasse: draft.terrasse,
          cave: draft.cave, parking: draft.parking, jardin: draft.jardin, garage: draft.garage,
        },
        quartier: draft.quartier || {},
      };

      setIsComputing(true);
      const computed = computeSmartScoreFromDraft(apiDraft);

      const smartScoreObj = {
        score: computed.globalScore, globalScore: computed.globalScore,
        grade: computed.grade, verdict: computed.verdict,
        globalRationale: computed.globalRationale, rationale: computed.rationale,
      };
      (draft as any).smartScore = smartScoreObj;
      (draft as any).smartscore = smartScoreObj;
      (draft as any).smartScoreResult = smartScoreObj;

      const newHistory = [...scoreHistory, computed.globalScore];
      setLocalScore(computed);
      setLastDraft(apiDraft);
      setScoreHistory(newHistory);
      setIsComputing(false);

      const savedFormState: FormState = {
        codePostal: draft.location?.codePostal || "",
        rueProche: draft.location?.rueProche || "",
        ville: draft.location?.ville || "",
        arrondissement: draft.location?.arrondissement || "",
        quartier: typeof draft.quartier === "string" ? draft.quartier : draft.quartier?.nom || "",
        propertyType: draft.propertyType || "",
        price: String(draft.price || ""),
        surface: String(draft.surface || ""),
        floor: String(draft.floor || ""),
      };
      setFormState(savedFormState);

      // ── Persist dans LS scoppée + legacy ──
      const key = smartscoreKey(currentDealId);
      const payload = {
        computed, formState: savedFormState, lastDraft: apiDraft,
        scoreHistory: newHistory, savedAt: new Date().toISOString(),
      };
      if (computed.minimumMet) {
        try {
          const json = JSON.stringify(payload);
          localStorage.setItem(key, json);
          // Legacy aussi
          for (const lk of LEGACY_LS_KEYS) {
            try { localStorage.setItem(lk, json); } catch { /* quota */ }
          }
        } catch { /* quota */ }
      } else {
        try { localStorage.removeItem(key); } catch { /* ignore */ }
      }

      if (computed.minimumMet) {
        try { await analyzeAndComputeScore(apiDraft, false); } catch { /* silent */ }
      }

      if (computed.minimumMet) {
        setToast({ show: true, type: "success", title: `SmartScore: ${computed.globalScore}/100 (${computed.grade})`, message: computed.globalRationale });
      } else {
        setToast({ show: true, type: "error", title: "Données insuffisantes", message: MINIMUM_VIABLE_MSG });
      }
    },
    [analyzeAndComputeScore, scoreHistory]
  );

  /* ══════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════ */

  if (!dealId) {
    return (
      <div style={styles.page}>
        <div style={{ ...styles.container, justifyContent: "center" }}><NoDealPlaceholder /></div>
      </div>
    );
  }

  const priceNum = parseNumberFR(formState.price);
  const surfaceNum = parseNumberFR(formState.surface);
  const hasMinimum = priceNum > 0 && surfaceNum > 0;

  const localResolved = localScore != null && localScore.minimumMet
    ? { resolved: localScore, resolvedScore: localScore.globalScore }
    : { resolved: null as any, resolvedScore: null as number | null };
  const hookResolved = hasMinimum && score != null ? resolveSmartScore(score) : { resolved: null, resolvedScore: null };
  const resolvedSS = localResolved.resolved ?? hookResolved.resolved ?? null;
  const resolvedScore = localResolved.resolvedScore ?? hookResolved.resolvedScore ?? null;

  const effectiveScore =
    localScore != null && localScore.minimumMet
      ? buildEnrichedScore(localScore, lastDraft, score, scoreHistory)
      : hasMinimum && resolvedScore != null
        ? {
            ...((score && typeof score === "object") ? score : {}),
            globalScore: resolvedScore, score: resolvedScore,
            grade: resolvedSS?.grade ?? gradeFromScore(resolvedScore),
            verdict: resolvedSS?.verdict ?? verdictFromScore(resolvedScore),
            globalRationale: resolvedSS?.globalRationale ?? resolvedSS?.rationale ?? "",
            rationale: resolvedSS?.rationale ?? resolvedSS?.globalRationale ?? "",
            explanations: [], missingData: [], subscores: [], penalties: [], blockers: [],
            engineVersion: "sourcing-hook-fallback",
            computedAt: new Date().toISOString(), inputHash: "hook",
            scoreHistory: [resolvedScore],
          }
        : null;

  const effectiveLoading = isComputing || isLoading;

  // initialValues : calculé synchrone, LS déjà pré-rempli par resolveForDeal()
  const sourcingInitialValues = resolved.formState ?? undefined;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.formSection}>
          <SourcingForm
            key={dealId}
            profileTarget={profileTarget}
            onSubmit={handleSubmit}
            onFormChange={handleFormChange}
            initialValues={sourcingInitialValues}
          />
        </div>

        <div style={styles.rightSection}>
          {effectiveLoading ? (
            <div style={styles.loadingContainer}>
              <div style={styles.spinner}></div>
              <div style={styles.loadingTitle}>Analyse en cours...</div>
              <div style={styles.loadingText}>Géocodage et calcul du SmartScore</div>
            </div>
          ) : resolvedScore != null && effectiveScore != null ? (
            <SmartScorePanel score={effectiveScore} hints={hints} compact />
          ) : (
            <SmartScorePlaceholder />
          )}
          <SummaryPanel form={formState} />
        </div>
      </div>

      {toast?.show && (
        <Toast type={toast.type} title={toast.title} message={toast.message} onClose={() => setToast(null)} />
      )}
    </div>
  );
};

export default SourcingHomePage;