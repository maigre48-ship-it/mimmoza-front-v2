// src/spaces/promoteur/pages/EvaluationPage.tsx
// Règle fondamentale : Mimmoza n'invente jamais de données.
// Version 2.0 — Fiche d'analyse immobilière complète, inspirée onglet Investisseur.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { DvfCompRow } from "../../../lib/dvfEstimateApi";
import { fetchBestDvfEstimate, fetchDvfComps } from "../../../lib/dvfEstimateApi";
import { supabase } from "../../../supabaseClient";
import {
  HeroGhostButton,
  HeroPrimaryButton,
  PromoteurPageHero,
} from "../shared/components/PromoteurPageHero";
import { ACCENT_PRO } from "../shared/promoteurDesign.tokens";
import { usePromoteurStudy } from "../shared/usePromoteurStudy";

// ─────────────────────────────────────────────
// Constantes design
// ─────────────────────────────────────────────
const ACCENT_LIGHT = "rgba(82,71,184,0.08)";
const ACCENT_BORDER = "rgba(82,71,184,0.2)";

// ─────────────────────────────────────────────
// Clés localStorage
// ─────────────────────────────────────────────
const LS_MARKET_STUDY = "synthesis_market_study";
const LS_EVALUATION = "mimmoza.promoteur.evaluation.v1";
const LOCALSTORAGE_KEY = "particulier:lastAddress";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type TypeBien = "Appartement" | "Maison" | "Immeuble" | "Terrain";
type EtatGeneral = "" | "Excellent" | "Bon" | "Correct" | "À rénover" | "À démolir";
type DpeNote = "" | "A" | "B" | "C" | "D" | "E" | "F" | "G";
type EpoqueImmeuble = "" | "Avant 1900" | "1900–1945" | "1945–1970" | "1970–1990" | "1990–2010" | "Après 2010";

type LocalisationInputs = {
  codePostal: string;
  ville: string;
  rueProcheRepere: string;
  quartier: string;
  arrondissement: string;
};

type CaracteristiquesInputs = {
  typeBien: TypeBien;
  prixAcquisition: number;
  surfaceM2: number;
  pieces: number;
  etage: number;
  etatGeneral: EtatGeneral;
  dpe: DpeNote;
  epoque: EpoqueImmeuble;
};

type QuartierInputs = {
  proximiteMetro: boolean;
  proximiteBus: boolean;
  proximiteTram: boolean;
  proximiteTrain: boolean;
  commerces: boolean;
  nuisances: boolean;
  expositionSud: boolean;
  ruePassante: boolean;
  standingImmeuble: "" | "Économique" | "Standard" | "Haut de gamme" | "Prestige";
  commentaire: string;
};

type OptionsAppartInputs = {
  ascenseur: boolean;
  balcon: boolean;
  loggia: boolean;
  cave: boolean;
  parking: boolean;
  box: boolean;
  calme: boolean;
  lumineux: boolean;
  traversant: boolean;
  faibleVisAVis: boolean;
  vueDegagee: boolean;
  rdcSurRue: boolean;
};

type DvfUi = {
  scope: "cp" | "commune";
  prixBas: number;
  prixCible: number;
  prixHaut: number;
  prixM2: number | null;
  transactions: number;
  confiance: "Faible" | "Moyenne" | "Élevée";
  meta?: any;
};

type MarcheMarket = {
  absorption_mensuelle: number | null;
  absorption_annuelle: number | null;
  prix_m2_median: number | null;
  prix_m2_median_neuf: number | null;
  nb_transactions: number | null;
  commune_nom: string | null;
  score_global: number | null;
};

type ScoreResult = {
  score: number;
  verdict: "Opportunité forte" | "À approfondir" | "Risque élevé";
  verdictColor: string;
  verdictBg: string;
  facteurs: Array<{ label: string; pts: number; max: number; ok: boolean }>;
  donneesManquantes: string[];
};

// ─────────────────────────────────────────────
// Valeurs par défaut
// ─────────────────────────────────────────────
const DEFAULT_LOCALISATION: LocalisationInputs = {
  codePostal: "",
  ville: "",
  rueProcheRepere: "",
  quartier: "",
  arrondissement: "",
};

const DEFAULT_CARAC: CaracteristiquesInputs = {
  typeBien: "Appartement",
  prixAcquisition: 0,
  surfaceM2: 0,
  pieces: 0,
  etage: 0,
  etatGeneral: "",
  dpe: "",
  epoque: "",
};

const DEFAULT_QUARTIER: QuartierInputs = {
  proximiteMetro: false,
  proximiteBus: false,
  proximiteTram: false,
  proximiteTrain: false,
  commerces: false,
  nuisances: false,
  expositionSud: false,
  ruePassante: false,
  standingImmeuble: "",
  commentaire: "",
};

const DEFAULT_OPTIONS_APPART: OptionsAppartInputs = {
  ascenseur: false,
  balcon: false,
  loggia: false,
  cave: false,
  parking: false,
  box: false,
  calme: false,
  lumineux: false,
  traversant: false,
  faibleVisAVis: false,
  vueDegagee: false,
  rdcSurRue: false,
};

// ─────────────────────────────────────────────
// Fonctions utilitaires
// ─────────────────────────────────────────────
function fmt(n: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtN(n: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);
}

function fmtD(n: number, d = 1) {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
}

function mapConf(c: "HIGH" | "MEDIUM" | "LOW" | null | undefined): DvfUi["confiance"] {
  if (c === "HIGH") return "Élevée";
  if (c === "MEDIUM") return "Moyenne";
  return "Faible";
}

function confColor(c: DvfUi["confiance"]) {
  if (c === "Élevée") return "#16a34a";
  if (c === "Moyenne") return "#d97706";
  return "#dc2626";
}

function qualifyAbsorption(abs: number): { label: string; color: string; bg: string } {
  if (abs < 5) return { label: "Marché peu liquide", color: "#dc2626", bg: "#fee2e2" };
  if (abs < 20) return { label: "Rythme modéré", color: "#d97706", bg: "#fef3c7" };
  if (abs < 80) return { label: "Bon rythme", color: "#16a34a", bg: "#dcfce7" };
  return { label: "Marché très actif", color: "#059669", bg: "#ecfdf5" };
}

function dpeColor(dpe: DpeNote): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    A: { bg: "#00a000", text: "#fff" },
    B: { bg: "#52b200", text: "#fff" },
    C: { bg: "#a0c800", text: "#0f172a" },
    D: { bg: "#f0c800", text: "#0f172a" },
    E: { bg: "#f0961e", text: "#fff" },
    F: { bg: "#e05a00", text: "#fff" },
    G: { bg: "#c80000", text: "#fff" },
  };
  return map[dpe] ?? { bg: "#e2e8f0", text: "#334155" };
}

function readMarcheFromLS(): MarcheMarket {
  const empty: MarcheMarket = {
    absorption_mensuelle: null,
    absorption_annuelle: null,
    prix_m2_median: null,
    prix_m2_median_neuf: null,
    nb_transactions: null,
    commune_nom: null,
    score_global: null,
  };
  try {
    const raw = localStorage.getItem(LS_MARKET_STUDY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    const market = parsed?.data?.market ?? null;
    if (!market) return empty;
    return {
      absorption_mensuelle: market?.dvf?.absorption_mensuelle ?? null,
      absorption_annuelle: market?.dvf?.absorption_annuelle ?? null,
      prix_m2_median: market?.dvf?.prix_m2_median ?? null,
      prix_m2_median_neuf: market?.prices?.median_eur_m2 ?? null,
      nb_transactions: market?.dvf?.nb_transactions ?? market?.transactions?.count ?? null,
      commune_nom: parsed?.data?.meta?.commune_nom ?? null,
      score_global: market?.score ?? parsed?.score ?? null,
    };
  } catch {
    return empty;
  }
}

function pickPostalCodeFromStudy(study: any): string {
  const f = study?.foncier;
  const m = study?.marche;
  const candidates = [
    f?.code_postal, f?.codePostal, f?.cp, f?.address?.code_postal,
    f?.address?.codePostal, f?.commune?.code_postal, f?.commune?.codePostal,
    m?.raw_data?.meta?.code_postal, m?.raw_data?.meta?.codePostal,
    m?.raw_data?.address?.code_postal, m?.raw_data?.address?.codePostal,
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (/^\d{5}$/.test(value)) return value;
  }
  return "";
}

async function resolveVilleFromCp(cp: string): Promise<string | null> {
  const cleanCp = String(cp ?? "").trim();
  if (!/^\d{5}$/.test(cleanCp)) return null;
  try {
    const r = await fetch(
      `https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(cleanCp)}&fields=nom,code,codesPostaux&format=json`
    );
    if (!r.ok) return null;
    const data = await r.json();
    const first = Array.isArray(data) ? data[0] : null;
    const nom = first?.nom;
    if (typeof nom === "string" && nom.trim()) return nom.trim();
  } catch { /* ignore */ }
  return null;
}

async function resolveCommuneInseeFromVilleCp({ cp, ville }: { cp: string; ville: string }): Promise<string | null> {
  try {
    if (cp || ville) {
      const p = new URLSearchParams();
      if (cp) p.set("codePostal", cp);
      if (ville) p.set("nom", ville);
      p.set("fields", "code,nom,codesPostaux");
      p.set("format", "json");
      const r = await fetch(`https://geo.api.gouv.fr/communes?${p.toString()}`);
      if (r.ok) {
        const d = await r.json();
        const code = d?.[0]?.code;
        if (typeof code === "string" && code.length === 5) return code;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function persistAddress(
  loc: LocalisationInputs,
  carac: CaracteristiquesInputs,
  communeInsee?: string | null,
  extra?: { prix?: number | null }
) {
  try {
    const sanitizedInsee =
      communeInsee && communeInsee !== "00000" && communeInsee.trim() !== ""
        ? communeInsee.trim()
        : null;
    localStorage.setItem(
      LOCALSTORAGE_KEY,
      JSON.stringify({
        address: loc.rueProcheRepere?.trim() ?? "",
        cp: loc.codePostal.trim(),
        ville: loc.ville.trim(),
        commune_insee: sanitizedInsee,
        parcel_id: null,
        surface_m2: Number(carac.surfaceM2 || 0) || null,
        prix: extra?.prix ?? null,
        type_local: carac.typeBien ?? null,
      })
    );
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────
// Score opportunité promoteur
// ─────────────────────────────────────────────
function computeScoreOpportunite({
  dvfBest,
  prixSortie,
  marche,
  carac,
}: {
  dvfBest: DvfUi | null;
  prixSortie: { prixCible: number; prixBas: number; prixHaut: number; prixM2Ref: number; source: string } | null;
  marche: MarcheMarket;
  carac: CaracteristiquesInputs;
}): ScoreResult | null {
  if (!dvfBest) return null;

  const donneesManquantes: string[] = [];
  let score = 0;
  const facteurs: ScoreResult["facteurs"] = [];

  // 1. Marge brute (max 40 pts)
  const prixAcq = Number(carac.prixAcquisition || 0);
  let margeScore = 0;
  if (prixAcq > 0 && prixSortie && prixSortie.prixCible > 0) {
    const pct = ((prixSortie.prixCible - prixAcq) / prixSortie.prixCible) * 100;
    if (pct >= 20) margeScore = 40;
    else if (pct >= 15) margeScore = 32;
    else if (pct >= 10) margeScore = 22;
    else if (pct >= 5) margeScore = 12;
    else margeScore = 2;
    facteurs.push({ label: `Marge brute estimée ${fmtD(pct)}%`, pts: margeScore, max: 40, ok: pct >= 15 });
  } else {
    donneesManquantes.push("Prix d'acquisition requis pour calculer la marge");
    facteurs.push({ label: "Marge brute (prix acquisition manquant)", pts: 0, max: 40, ok: false });
  }
  score += margeScore;

  // 2. Confiance DVF (max 20 pts)
  const confScore = dvfBest.confiance === "Élevée" ? 20 : dvfBest.confiance === "Moyenne" ? 12 : 5;
  facteurs.push({ label: `Confiance DVF : ${dvfBest.confiance}`, pts: confScore, max: 20, ok: confScore >= 12 });
  score += confScore;

  // 3. Liquidité marché (max 20 pts)
  let absScore = 0;
  if (marche.absorption_mensuelle != null) {
    const a = marche.absorption_mensuelle;
    if (a >= 80) absScore = 20;
    else if (a >= 20) absScore = 15;
    else if (a >= 5) absScore = 8;
    else absScore = 2;
    facteurs.push({ label: `Absorption ${fmtD(a)} ventes/mois`, pts: absScore, max: 20, ok: absScore >= 8 });
  } else {
    donneesManquantes.push("Absorption mensuelle (lancer une étude marché)");
    facteurs.push({ label: "Liquidité marché (étude marché manquante)", pts: 0, max: 20, ok: false });
  }
  score += absScore;

  // 4. Données DVF complètes (max 10 pts)
  const dvfScore = prixSortie ? 10 : 0;
  facteurs.push({ label: prixSortie ? "Prix de sortie estimé disponible" : "Prix de sortie indisponible", pts: dvfScore, max: 10, ok: !!prixSortie });
  score += dvfScore;

  // 5. DPE bonus (max 10 pts)
  let dpeScore = 0;
  if (carac.dpe) {
    if (carac.dpe === "A" || carac.dpe === "B") dpeScore = 10;
    else if (carac.dpe === "C") dpeScore = 7;
    else if (carac.dpe === "D") dpeScore = 4;
    else dpeScore = 0;
    facteurs.push({ label: `DPE ${carac.dpe}`, pts: dpeScore, max: 10, ok: dpeScore >= 7 });
  } else {
    donneesManquantes.push("DPE du bien");
    facteurs.push({ label: "DPE (non renseigné)", pts: 0, max: 10, ok: false });
  }
  score += dpeScore;

  let verdict: ScoreResult["verdict"];
  let verdictColor: string;
  let verdictBg: string;
  if (score >= 70) {
    verdict = "Opportunité forte";
    verdictColor = "#16a34a";
    verdictBg = "#dcfce7";
  } else if (score >= 40) {
    verdict = "À approfondir";
    verdictColor = "#d97706";
    verdictBg = "#fef3c7";
  } else {
    verdict = "Risque élevé";
    verdictColor = "#dc2626";
    verdictBg = "#fee2e2";
  }

  return { score, verdict, verdictColor, verdictBg, facteurs, donneesManquantes };
}

// ─────────────────────────────────────────────
// Composants réutilisables
// ─────────────────────────────────────────────
const SectionTitle: React.FC<{ icon: string; title: string; subtitle?: string }> = ({ icon, title, subtitle }) => (
  <div style={{ marginBottom: 14, paddingBottom: 10, borderBottom: "2px solid rgba(82,71,184,0.12)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 15, fontWeight: 800, color: "#1e1b4b" }}>{title}</span>
    </div>
    {subtitle && <div style={{ fontSize: 12, color: "#64748b", marginTop: 3, marginLeft: 24 }}>{subtitle}</div>}
  </div>
);

const FLD: React.FC<{ label: string; children: React.ReactNode; col?: "full" | "half" }> = ({ label, children }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
    <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
    {children}
  </label>
);

const Toggle: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void; icon?: string }> = ({ label, value, onChange, icon }) => (
  <button
    onClick={() => onChange(!value)}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "6px 12px",
      borderRadius: 8,
      border: value ? `1.5px solid ${ACCENT_PRO}` : "1.5px solid rgba(15,23,42,0.12)",
      background: value ? ACCENT_LIGHT : "#f8fafc",
      color: value ? ACCENT_PRO : "#64748b",
      fontWeight: value ? 700 : 500,
      fontSize: 12,
      cursor: "pointer",
      transition: "all 140ms ease",
      whiteSpace: "nowrap",
    }}
  >
    {icon && <span>{icon}</span>}
    {label}
  </button>
);

const KPI: React.FC<{ label: string; value: string; accent?: boolean; sub?: string }> = ({ label, value, accent, sub }) => (
  <div style={{
    padding: "13px 14px",
    borderRadius: 12,
    background: accent ? ACCENT_LIGHT : "#f8fafc",
    border: `1px solid ${accent ? ACCENT_BORDER : "rgba(15,23,42,0.06)"}`,
  }}>
    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>{label}</div>
    <div style={{ fontSize: accent ? 21 : 18, fontWeight: 900, color: accent ? ACCENT_PRO : "#0f172a" }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>{sub}</div>}
  </div>
);

// ─────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────
const EvaluationPage: React.FC = () => {
  const [loc, setLoc] = useState<LocalisationInputs>(DEFAULT_LOCALISATION);
  const [carac, setCarac] = useState<CaracteristiquesInputs>(DEFAULT_CARAC);
  const [quartier, setQuartier] = useState<QuartierInputs>(DEFAULT_QUARTIER);
  const [options, setOptions] = useState<OptionsAppartInputs>(DEFAULT_OPTIONS_APPART);

  const [villeAutoLoading, setVilleAutoLoading] = useState(false);
  const [villeAutoError, setVilleAutoError] = useState<string | null>(null);

  const [hasSearched, setHasSearched] = useState(false);
  const [dvfLoading, setDvfLoading] = useState(false);
  const [dvfError, setDvfError] = useState<string | null>(null);
  const [dvfBest, setDvfBest] = useState<DvfUi | null>(null);
  const [dvfDetails, setDvfDetails] = useState<{ cp: DvfUi | null; commune: DvfUi | null }>({ cp: null, commune: null });
  const [dvfComps, setDvfComps] = useState<DvfCompRow[]>([]);
  const [dvfCompsError, setDvfCompsError] = useState<string | null>(null);
  const [synthSaved, setSynthSaved] = useState(false);
  const [marche, setMarche] = useState<MarcheMarket>(() => readMarcheFromLS());

  useEffect(() => {
    const onFocus = () => setMarche(readMarcheFromLS());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");
  const { study, loadState } = usePromoteurStudy(studyId);

  useEffect(() => {
    if (loadState !== "ready" || !study) return;
    const f = study.foncier;
    const m = study.marche;
    const ville = (m?.raw_data as any)?.meta?.commune_nom ?? (f as any)?.commune_nom ?? (f as any)?.ville ?? "";
    const codePostal = pickPostalCodeFromStudy(study);
    setLoc((prev) => ({
      ...prev,
      ...(ville ? { ville } : {}),
      ...(codePostal ? { codePostal } : {}),
    }));
  }, [loadState, study]);

  // Auto-remplissage commune via code postal
  useEffect(() => {
    const cp = loc.codePostal.trim();
    setVilleAutoError(null);
    if (!/^\d{5}$/.test(cp)) { setVilleAutoLoading(false); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setVilleAutoLoading(true);
      try {
        const ville = await resolveVilleFromCp(cp);
        if (cancelled) return;
        if (ville) setLoc((prev) => ({ ...prev, ville }));
        else setVilleAutoError("Commune introuvable pour ce code postal.");
      } finally {
        if (!cancelled) setVilleAutoLoading(false);
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [loc.codePostal]);

  // Calcul prix de sortie
  const prixSortie = useMemo(() => {
    const surface = Number(carac.surfaceM2 || 0);
    if (surface <= 0) return null;
    const prixRef =
      marche.prix_m2_median_neuf ??
      (marche.prix_m2_median ? Math.round(marche.prix_m2_median * 1.2) : null) ??
      (dvfBest?.prixM2 ? Math.round(dvfBest.prixM2 * 1.2) : null);
    if (!prixRef) return null;
    const source = marche.prix_m2_median_neuf
      ? "Étude marché (prix neuf)"
      : marche.prix_m2_median
      ? "DVF étude marché +20%"
      : "DVF local +20%";
    return {
      prixM2Ref: prixRef,
      prixBas: Math.round(prixRef * 0.95 * surface),
      prixCible: Math.round(prixRef * surface),
      prixHaut: Math.round(prixRef * 1.05 * surface),
      source,
    };
  }, [carac.surfaceM2, marche, dvfBest]);

  // Score opportunité
  const scoreResult = useMemo(() =>
    computeScoreOpportunite({ dvfBest, prixSortie, marche, carac }),
    [dvfBest, prixSortie, marche, carac]
  );

  // Calcul DVF
  const handleComputeDvf = useCallback(async () => {
    setDvfLoading(true);
    setDvfError(null);
    setDvfBest(null);
    setDvfDetails({ cp: null, commune: null });
    setDvfComps([]);
    setDvfCompsError(null);

    let resolvedInsee: string | null = null;
    try {
      resolvedInsee = await resolveCommuneInseeFromVilleCp({ cp: loc.codePostal.trim(), ville: loc.ville.trim() });
    } catch { /* ignore */ }

    persistAddress(loc, carac, resolvedInsee);

    try {
      const cp = loc.codePostal.trim();
      const surface = Number(carac.surfaceM2 || 0);

      if (!/^\d{5}$/.test(cp)) {
        setDvfError("Code postal La Poste invalide (5 chiffres requis, ex : 33000).");
        return;
      }
      if (!Number.isFinite(surface) || surface <= 0) {
        setDvfError("Surface habitable invalide (> 0 requis).");
        return;
      }

      const baseParams = {
        commune_insee: resolvedInsee || "00000",
        code_postal: cp,
        surface_m2: surface,
        pieces: Number.isFinite(carac.pieces) && carac.pieces > 0 ? carac.pieces : null,
        months: 24,
      };

      let res = await fetchBestDvfEstimate(supabase, { ...baseParams, type_local: carac.typeBien });
      if (!res.best) {
        res = await fetchBestDvfEstimate(supabase, { ...baseParams, type_local: null });
      }

      const toUi = (scope: "cp" | "commune", r: any): DvfUi | null => {
        if (!r?.success) return null;
        const low = r?.estimate?.low ?? null;
        const target = r?.estimate?.target ?? null;
        const high = r?.estimate?.high ?? null;
        if (low == null || target == null || high == null) return null;
        return {
          scope,
          prixBas: Number(low),
          prixCible: Number(target),
          prixHaut: Number(high),
          prixM2: r?.stats?.price_m2_median ?? null,
          transactions: r?.stats?.transactions_count ?? 0,
          confiance: mapConf(r?.confidence),
          meta: r?.meta,
        };
      };

      const cpUi = res.cp ? toUi("cp", res.cp) : null;
      const communeUi = res.commune ? toUi("commune", res.commune) : null;
      setDvfDetails({ cp: cpUi, commune: communeUi });

      const retrievedInsee = res.best?.result?.meta?.commune_insee ?? null;

      if (res.best) {
        const bestUi = toUi(res.best.scope, res.best.result);
        if (bestUi) {
          setDvfBest(bestUi);
          persistAddress(loc, carac, retrievedInsee || resolvedInsee, { prix: bestUi.prixCible ?? null });

          try {
            const compsParams: any = {
              commune_insee: retrievedInsee || resolvedInsee || "00000",
              code_postal: cp,
              scope: res.best.scope === "commune" ? "commune" : "cp",
              type_local: carac.typeBien,
              pieces: Number.isFinite(carac.pieces) && carac.pieces > 0 ? carac.pieces : null,
              months: 24,
              limit: 30,
            };
            if (res.best.scope === "commune" && res.best.result?.meta?.commune_insee) {
              compsParams.commune_insee = res.best.result.meta.commune_insee;
            }
            const compsResult = await fetchDvfComps(supabase, compsParams);
            if (!compsResult.success) {
              setDvfComps([]);
              setDvfCompsError(compsResult.message ?? "Erreur RPC.");
            } else {
              setDvfComps(compsResult.data);
            }
          } catch (e: any) {
            setDvfComps([]);
            setDvfCompsError(e?.message ?? "Erreur ventes DVF.");
          }
        } else {
          setDvfError("Réponse DVF invalide — fourchette incalculable.");
        }
      } else {
        setDvfError(
          "Données DVF insuffisantes pour cette zone.\nConseils : vérifiez le code postal La Poste, supprimez le filtre pièces ou changez le type de bien."
        );
      }
    } catch (e: any) {
      setDvfError(e?.message ?? String(e));
    } finally {
      setHasSearched(true);
      setDvfLoading(false);
    }
  }, [loc, carac]);

  // Sauvegarde synthèse
  const handleSaveForSynthesis = useCallback(() => {
    if (!dvfBest) return;
    try {
      localStorage.setItem(
        LS_EVALUATION,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          // DVF
          prixCible: dvfBest.prixCible,
          prixBas: dvfBest.prixBas,
          prixHaut: dvfBest.prixHaut,
          prixM2: dvfBest.prixM2,
          confiance: dvfBest.confiance,
          dvfLocalTransactions: dvfBest.transactions,
          // Prix sortie
          prixSortieNeuf: prixSortie ?? null,
          // Marché
          absorptionMensuelle: marche.absorption_mensuelle,
          absorptionAnnuelle: marche.absorption_annuelle,
          prixM2Median: marche.prix_m2_median,
          prixM2MedianNeuf: marche.prix_m2_median_neuf,
          nbTransactions: marche.nb_transactions,
          // Score
          scoreOpportunite: scoreResult?.score ?? null,
          verdictOpportunite: scoreResult?.verdict ?? null,
          // Localisation
          localisation: loc,
          // Caractéristiques
          caracteristiques: carac,
          // Quartier
          quartier,
          // Options
          options: carac.typeBien === "Appartement" ? options : null,
          // Compat legacy
          surfaceM2: Number(carac.surfaceM2 || 0) || null,
          typeBien: carac.typeBien,
          inputs: {
            ville: loc.ville,
            codePostal: loc.codePostal,
            surfaceM2: carac.surfaceM2,
            pieces: carac.pieces,
            typeBien: carac.typeBien,
          },
        })
      );
      setSynthSaved(true);
      setTimeout(() => setSynthSaved(false), 3000);
    } catch { /* ignore */ }
  }, [dvfBest, prixSortie, marche, scoreResult, loc, carac, quartier, options]);

  const handleReset = () => {
    setLoc(DEFAULT_LOCALISATION);
    setCarac(DEFAULT_CARAC);
    setQuartier(DEFAULT_QUARTIER);
    setOptions(DEFAULT_OPTIONS_APPART);
    setVilleAutoError(null);
    setVilleAutoLoading(false);
    setDvfError(null);
    setDvfBest(null);
    setDvfDetails({ cp: null, commune: null });
    setDvfComps([]);
    setDvfCompsError(null);
    setHasSearched(false);
  };

  const hasMarcheData = !!(marche.absorption_mensuelle != null || marche.prix_m2_median || marche.prix_m2_median_neuf);
  const absQual = marche.absorption_mensuelle != null ? qualifyAbsorption(marche.absorption_mensuelle) : null;
  const hasDvfData = dvfBest !== null;
  const prixAcq = Number(carac.prixAcquisition || 0);
  const margeImplicite = hasDvfData && prixSortie && prixAcq > 0
    ? prixSortie.prixCible - prixAcq
    : null;
  const margePct = margeImplicite != null && prixSortie && prixSortie.prixCible > 0
    ? (margeImplicite / prixSortie.prixCible) * 100
    : null;
  const spreadPrixM2 = hasDvfData && dvfBest?.prixM2 && prixSortie
    ? prixSortie.prixM2Ref - dvfBest.prixM2
    : null;

  // Données manquantes synthèse
  const donneesManquantes: string[] = [];
  if (!loc.codePostal) donneesManquantes.push("Code postal");
  if (!carac.surfaceM2) donneesManquantes.push("Surface m²");
  if (!carac.prixAcquisition) donneesManquantes.push("Prix d'acquisition");
  if (!hasDvfData) donneesManquantes.push("Estimation DVF (cliquer Calculer DVF)");
  if (!hasMarcheData) donneesManquantes.push("Étude marché (onglet Études › Marché)");
  if (!carac.dpe) donneesManquantes.push("DPE du bien");
  if (!carac.etatGeneral) donneesManquantes.push("État général");

  return (
    <div style={S.page}>
      {/* ── HERO ── */}
      <div style={{ marginBottom: 18 }}>
  <PromoteurPageHero
    badge="Promoteur · Évaluation"
    title="Fiche d'analyse du bien"
    metaLines={[{ text: "Données DVF réelles uniquement · Aucune donnée inventée" }]}
    statCards={hasDvfData && dvfBest ? [
      {
        label: "Estimation cible",
        value: fmt(dvfBest.prixCible),
        tone: "indigo" as const,
      },
      {
        label: "Confiance DVF",
        value: dvfBest.confiance,
        tone: "emerald" as const,
      },
    ] : undefined}
    actions={
      <>
        <HeroGhostButton onClick={handleReset}>↺ Réinitialiser</HeroGhostButton>
        {hasDvfData && (
          <HeroPrimaryButton onClick={handleSaveForSynthesis}>
            {synthSaved ? "✓ Enregistré" : "📌 Utiliser dans la synthèse"}
          </HeroPrimaryButton>
        )}
        <HeroPrimaryButton onClick={handleComputeDvf} disabled={dvfLoading}>
          {dvfLoading ? <><span style={S.spinner} />Analyse DVF…</> : <>⚡ Calculer DVF</>}
        </HeroPrimaryButton>
      </>
    }
  />
</div>

      {/* ── GRID ── */}
      <div style={S.grid}>
        {/* ══════════════════════════════
            COLONNE GAUCHE — formulaire
        ══════════════════════════════ */}
        <div style={S.col}>

          {/* 1. Localisation */}
          <div style={S.card}>
            <SectionTitle icon="📍" title="Localisation" subtitle="Code postal requis pour le calcul DVF" />
            <div style={S.grid2}>
              <FLD label="Code postal La Poste ⚠︎">
                <input
                  style={{ ...S.input, borderColor: "rgba(234,88,12,0.4)" }}
                  value={loc.codePostal}
                  onChange={(e) => setLoc((p) => ({ ...p, codePostal: e.target.value, ville: "" }))}
                  placeholder="75011"
                />
              </FLD>
              <FLD label="Ville / commune">
                <div style={{ position: "relative" }}>
                  <input
                    style={S.input}
                    value={loc.ville}
                    onChange={(e) => setLoc((p) => ({ ...p, ville: e.target.value }))}
                    placeholder="Auto-remplie"
                  />
                  {villeAutoLoading && <div style={S.autoTag}>⟳</div>}
                </div>
                {villeAutoError && <div style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>{villeAutoError}</div>}
              </FLD>
              <FLD label="Rue proche / repère">
                <input
                  style={S.input}
                  value={loc.rueProcheRepere}
                  onChange={(e) => setLoc((p) => ({ ...p, rueProcheRepere: e.target.value }))}
                  placeholder="Rue de la Paix, proche gare…"
                />
              </FLD>
              <FLD label="Quartier (optionnel)">
                <input
                  style={S.input}
                  value={loc.quartier}
                  onChange={(e) => setLoc((p) => ({ ...p, quartier: e.target.value }))}
                  placeholder="Marais, Confluence…"
                />
              </FLD>
              {["75", "69", "13"].some((pfx) => loc.codePostal.startsWith(pfx)) && (
                <FLD label="Arrondissement">
                  <input
                    style={S.input}
                    value={loc.arrondissement}
                    onChange={(e) => setLoc((p) => ({ ...p, arrondissement: e.target.value }))}
                    placeholder="3e, 6e…"
                  />
                </FLD>
              )}
            </div>
            <div style={S.infoBox}>
              ⚠️ <strong>Code postal La Poste requis</strong> — pas le code INSEE. La commune est remplie automatiquement.
            </div>
          </div>

          {/* 2. Caractéristiques du bien */}
          <div style={S.card}>
            <SectionTitle icon="🏠" title="Caractéristiques du bien" />
            <div style={S.grid2}>
              <FLD label="Type de bien">
                <select
                  style={S.input}
                  value={carac.typeBien}
                  onChange={(e) => setCarac((p) => ({ ...p, typeBien: e.target.value as TypeBien }))}
                >
                  {["Appartement", "Maison", "Immeuble", "Terrain"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </FLD>

              <FLD label="Prix affiché / acquisition (€)">
                <input
                  style={S.input}
                  type="number"
                  min={0}
                  value={carac.prixAcquisition || ""}
                  onChange={(e) => setCarac((p) => ({ ...p, prixAcquisition: Number(e.target.value || 0) }))}
                  placeholder="ex : 320000"
                />
              </FLD>

              <FLD label="Surface habitable (m²) ⚠︎">
                <input
                  style={{ ...S.input, borderColor: "rgba(234,88,12,0.4)" }}
                  type="number"
                  min={0}
                  max={2000}
                  value={carac.surfaceM2 || ""}
                  onChange={(e) => setCarac((p) => ({ ...p, surfaceM2: Number(e.target.value || 0) }))}
                  placeholder="ex : 65"
                />
              </FLD>

              <FLD label="Pièces (optionnel)">
                <input
                  style={S.input}
                  type="number"
                  min={0}
                  max={20}
                  value={carac.pieces || ""}
                  onChange={(e) => setCarac((p) => ({ ...p, pieces: Number(e.target.value || 0) }))}
                  placeholder="laisser vide si peu de données"
                />
              </FLD>

              {carac.typeBien === "Appartement" && (
                <FLD label="Étage">
                  <input
                    style={S.input}
                    type="number"
                    min={0}
                    max={50}
                    value={carac.etage || ""}
                    onChange={(e) => setCarac((p) => ({ ...p, etage: Number(e.target.value || 0) }))}
                    placeholder="0 = RDC"
                  />
                </FLD>
              )}

              <FLD label="État général">
                <select
                  style={S.input}
                  value={carac.etatGeneral}
                  onChange={(e) => setCarac((p) => ({ ...p, etatGeneral: e.target.value as EtatGeneral }))}
                >
                  <option value="">— Non renseigné</option>
                  {["Excellent", "Bon", "Correct", "À rénover", "À démolir"].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </FLD>

              <FLD label="DPE">
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["", "A", "B", "C", "D", "E", "F", "G"] as DpeNote[]).map((d) => {
                    const colors = dpeColor(d);
                    const selected = carac.dpe === d;
                    return (
                      <button
                        key={d || "none"}
                        onClick={() => setCarac((p) => ({ ...p, dpe: d }))}
                        style={{
                          width: d ? 34 : 44,
                          height: 34,
                          borderRadius: 8,
                          border: selected ? "2.5px solid #0f172a" : "1.5px solid transparent",
                          background: d ? colors.bg : (selected ? "#f1f5f9" : "#e2e8f0"),
                          color: d ? colors.text : "#94a3b8",
                          fontWeight: 900,
                          fontSize: 13,
                          cursor: "pointer",
                          boxShadow: selected ? "0 0 0 2px rgba(15,23,42,0.15)" : "none",
                        }}
                      >
                        {d || "—"}
                      </button>
                    );
                  })}
                </div>
              </FLD>

              <FLD label="Époque / année immeuble">
                <select
                  style={S.input}
                  value={carac.epoque}
                  onChange={(e) => setCarac((p) => ({ ...p, epoque: e.target.value as EpoqueImmeuble }))}
                >
                  <option value="">— Non renseigné</option>
                  {["Avant 1900", "1900–1945", "1945–1970", "1970–1990", "1990–2010", "Après 2010"].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </FLD>
            </div>
          </div>

          {/* 3. Informations quartier */}
          <div style={S.card}>
            <SectionTitle icon="🏙" title="Informations quartier" />

            <div style={{ marginBottom: 12 }}>
              <div style={S.subLabel}>Transports à proximité</div>
              <div style={S.tagRow}>
                <Toggle label="Métro" icon="Ⓜ️" value={quartier.proximiteMetro} onChange={(v) => setQuartier((p) => ({ ...p, proximiteMetro: v }))} />
                <Toggle label="Bus" icon="🚌" value={quartier.proximiteBus} onChange={(v) => setQuartier((p) => ({ ...p, proximiteBus: v }))} />
                <Toggle label="Tram" icon="🚊" value={quartier.proximiteTram} onChange={(v) => setQuartier((p) => ({ ...p, proximiteTram: v }))} />
                <Toggle label="RER / Train" icon="🚆" value={quartier.proximiteTrain} onChange={(v) => setQuartier((p) => ({ ...p, proximiteTrain: v }))} />
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={S.subLabel}>Environnement</div>
              <div style={S.tagRow}>
                <Toggle label="Commerces proches" icon="🛒" value={quartier.commerces} onChange={(v) => setQuartier((p) => ({ ...p, commerces: v }))} />
                <Toggle label="Nuisances" icon="🔊" value={quartier.nuisances} onChange={(v) => setQuartier((p) => ({ ...p, nuisances: v }))} />
                <Toggle label="Exposition sud" icon="☀️" value={quartier.expositionSud} onChange={(v) => setQuartier((p) => ({ ...p, expositionSud: v }))} />
                <Toggle label="Rue passante" icon="🚗" value={quartier.ruePassante} onChange={(v) => setQuartier((p) => ({ ...p, ruePassante: v }))} />
              </div>
            </div>

            <div style={S.grid2}>
              <FLD label="Standing immeuble">
                <select
                  style={S.input}
                  value={quartier.standingImmeuble}
                  onChange={(e) => setQuartier((p) => ({ ...p, standingImmeuble: e.target.value as QuartierInputs["standingImmeuble"] }))}
                >
                  <option value="">— Non renseigné</option>
                  {["Économique", "Standard", "Haut de gamme", "Prestige"].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </FLD>
            </div>

            <div style={{ marginTop: 12 }}>
              <FLD label="Commentaire libre">
                <textarea
                  style={{ ...S.input, height: 72, resize: "vertical", paddingTop: 8 }}
                  value={quartier.commentaire}
                  onChange={(e) => setQuartier((p) => ({ ...p, commentaire: e.target.value }))}
                  placeholder="Vue dégagée côté cour, copropriété bien entretenue, projet de rénovation de façade…"
                />
              </FLD>
            </div>
          </div>

          {/* 4. Options appartement (conditionnel) */}
          {carac.typeBien === "Appartement" && (
            <div style={S.card}>
              <SectionTitle icon="🏢" title="Options appartement" subtitle="Équipements & atouts" />
              <div style={S.tagRow}>
                <Toggle label="Ascenseur" icon="🛗" value={options.ascenseur} onChange={(v) => setOptions((p) => ({ ...p, ascenseur: v }))} />
                <Toggle label="Balcon" icon="🌿" value={options.balcon} onChange={(v) => setOptions((p) => ({ ...p, balcon: v }))} />
                <Toggle label="Loggia" value={options.loggia} onChange={(v) => setOptions((p) => ({ ...p, loggia: v }))} />
                <Toggle label="Cave" value={options.cave} onChange={(v) => setOptions((p) => ({ ...p, cave: v }))} />
                <Toggle label="Parking" icon="🅿️" value={options.parking} onChange={(v) => setOptions((p) => ({ ...p, parking: v }))} />
                <Toggle label="Box" value={options.box} onChange={(v) => setOptions((p) => ({ ...p, box: v }))} />
                <Toggle label="Calme" icon="🔇" value={options.calme} onChange={(v) => setOptions((p) => ({ ...p, calme: v }))} />
                <Toggle label="Lumineux" icon="💡" value={options.lumineux} onChange={(v) => setOptions((p) => ({ ...p, lumineux: v }))} />
                <Toggle label="Traversant" value={options.traversant} onChange={(v) => setOptions((p) => ({ ...p, traversant: v }))} />
                <Toggle label="Faible vis-à-vis" value={options.faibleVisAVis} onChange={(v) => setOptions((p) => ({ ...p, faibleVisAVis: v }))} />
                <Toggle label="Vue dégagée" icon="🌄" value={options.vueDegagee} onChange={(v) => setOptions((p) => ({ ...p, vueDegagee: v }))} />
                <Toggle label="RDC sur rue" value={options.rdcSurRue} onChange={(v) => setOptions((p) => ({ ...p, rdcSurRue: v }))} />
              </div>
            </div>
          )}

          {/* Bouton Calculer DVF bas de formulaire */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button style={S.btnSec} onClick={handleReset}>↺ Réinitialiser</button>
            <button style={S.btnPri} onClick={handleComputeDvf} disabled={dvfLoading}>
              {dvfLoading ? <><span style={S.spinner} />Analyse DVF…</> : "⚡ Calculer DVF"}
            </button>
          </div>
        </div>

        {/* ══════════════════════════════
            COLONNE DROITE — résultats
        ══════════════════════════════ */}
        <div style={S.col}>

          {/* 5. Analyse DVF */}
          <div style={S.card}>
            <SectionTitle icon="📊" title="Analyse DVF" subtitle="Données réelles Demande de Valeurs Foncières" />

            {!hasSearched ? (
              <div style={S.emptyState}>
                <div style={S.emptyIcon}>⚡</div>
                <div style={{ fontWeight: 700, color: "#334155", marginBottom: 6 }}>En attente de calcul</div>
                <div style={{ fontSize: 13, color: "#64748b" }}>
                  Renseignez le <strong>code postal</strong> et la <strong>surface</strong>, puis cliquez <strong>Calculer DVF</strong>.
                </div>
              </div>
            ) : dvfError && !hasDvfData ? (
              <div style={S.errorBox}>
                <strong>Données DVF insuffisantes</strong>
                <div style={{ marginTop: 6, whiteSpace: "pre-line", fontSize: 13 }}>{dvfError}</div>
              </div>
            ) : hasDvfData ? (
              <>
                {/* Fourchette estimation */}
                <div style={S.dvfRangeBar}>
                  <div style={S.rangeLabel}>Fourchette d'estimation DVF</div>
                  <div style={S.rangeRow}>
                    <div style={S.rangeBound}>
                      <div style={S.rangeBoundLabel}>Basse</div>
                      <div style={S.rangeBoundValue}>{fmt(dvfBest!.prixBas)}</div>
                    </div>
                    <div style={S.rangeCenter}>
                      <div style={S.rangeCenterLabel}>Cible</div>
                      <div style={S.rangeCenterValue}>{fmt(dvfBest!.prixCible)}</div>
                    </div>
                    <div style={S.rangeBound}>
                      <div style={S.rangeBoundLabel}>Haute</div>
                      <div style={S.rangeBoundValue}>{fmt(dvfBest!.prixHaut)}</div>
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "12px 0" }}>
                  <KPI
                    label="Prix / m²"
                    value={dvfBest!.prixM2 != null ? `${fmtN(dvfBest!.prixM2)} €/m²` : "—"}
                  />
                  <KPI label="Transactions DVF" value={`${dvfBest!.transactions}`} sub="24 derniers mois" />
                  <div style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    background: `${confColor(dvfBest!.confiance)}14`,
                    border: `1px solid ${confColor(dvfBest!.confiance)}40`,
                    gridColumn: "1 / -1",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>Niveau de confiance</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                        Périmètre : {dvfBest!.scope === "cp" ? "Code postal" : "Commune"}
                      </div>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: confColor(dvfBest!.confiance) }}>{dvfBest!.confiance}</div>
                  </div>
                </div>

                {/* Comparaison CP vs Commune */}
                {(dvfDetails.cp || dvfDetails.commune) && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={S.subLabel}>Périmètres disponibles</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {dvfDetails.cp && (
                        <div style={{ ...S.dvfDetailRow, borderColor: dvfBest!.scope === "cp" ? ACCENT_BORDER : "transparent", background: dvfBest!.scope === "cp" ? ACCENT_LIGHT : "#f8fafc" }}>
                          <span style={{ fontWeight: 700, color: dvfBest!.scope === "cp" ? ACCENT_PRO : "#64748b", fontSize: 12 }}>Code postal</span>
                          <span>{dvfDetails.cp.transactions} ventes · {dvfDetails.cp.prixM2 ? `${fmtN(dvfDetails.cp.prixM2)} €/m²` : "—"} · {dvfDetails.cp.confiance}</span>
                        </div>
                      )}
                      {dvfDetails.commune && (
                        <div style={{ ...S.dvfDetailRow, borderColor: dvfBest!.scope === "commune" ? ACCENT_BORDER : "transparent", background: dvfBest!.scope === "commune" ? ACCENT_LIGHT : "#f8fafc" }}>
                          <span style={{ fontWeight: 700, color: dvfBest!.scope === "commune" ? ACCENT_PRO : "#64748b", fontSize: 12 }}>Commune</span>
                          <span>{dvfDetails.commune.transactions} ventes · {dvfDetails.commune.prixM2 ? `${fmtN(dvfDetails.commune.prixM2)} €/m²` : "—"} · {dvfDetails.commune.confiance}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Tableau ventes DVF */}
                {dvfCompsError && <div style={S.compsWarning}>{dvfCompsError}</div>}
                {dvfComps.length > 0 && (
                  <>
                    <div style={S.subLabel}>
                      {dvfComps.length} vente{dvfComps.length > 1 ? "s" : ""} DVF affichée{dvfBest ? ` sur ${dvfBest.transactions}` : ""}
                    </div>
                    <div style={{ overflowX: "auto", marginTop: 6 }}>
                      <table style={S.table}>
                        <thead>
                          <tr>
                            {["Date", "Commune", "Type", "Pièces", "Surface", "Valeur", "€/m²"].map((h, i) => (
                              <th key={h} style={{ ...S.th, textAlign: i >= 4 ? "right" : "left" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {dvfComps.map((c, idx) => {
                            const s = Number(c.surface_reelle_bati) || 0;
                            const v = Number(c.valeur_fonciere) || 0;
                            const pm2 = Number(c.price_m2) || 0;
                            return (
                              <tr key={`${c.date_mutation ?? "date"}-${idx}`} style={{ background: idx % 2 === 0 ? "white" : "#f8fafc" }}>
                                <td style={S.td}>{c.date_mutation ?? "—"}</td>
                                <td style={S.td}>{c.commune ?? "—"}</td>
                                <td style={S.td}>{c.type_local ?? "—"}</td>
                                <td style={S.td}>{c.nombre_pieces_principales ?? "—"}</td>
                                <td style={{ ...S.td, textAlign: "right" }}>{s > 0 ? fmtN(Math.round(s)) : "—"}</td>
                                <td style={{ ...S.td, textAlign: "right" }}>{v > 0 ? fmt(v) : "—"}</td>
                                <td style={{ ...S.td, textAlign: "right" }}>{pm2 > 0 ? `${fmtN(Math.round(pm2))} €/m²` : "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {hasDvfData && dvfComps.length === 0 && !dvfCompsError && (
                  <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>Aucune vente DVF détaillée à afficher.</div>
                )}
              </>
            ) : null}
          </div>

          {/* 6. Analyse Promoteur */}
          <div style={S.analysisCard}>
            <SectionTitle icon="🏗" title="Analyse Promoteur" subtitle="Prix de sortie · Spread · Opportunité" />

            {/* Prix de sortie */}
            {!prixSortie ? (
              <div style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic", marginBottom: 14 }}>
                {!carac.surfaceM2 || carac.surfaceM2 <= 0
                  ? "Saisissez une surface m² pour estimer le prix de sortie."
                  : "Calculez le DVF ou lancez une étude de marché pour obtenir le prix de sortie neuf."}
              </div>
            ) : (
              <>
                <div style={S.sortieRangeBar}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: ACCENT_PRO, marginBottom: 8 }}>
                    Prix de sortie programme neuf
                  </div>
                  <div style={S.rangeRow}>
                    <div style={S.rangeBound}>
                      <div style={S.rangeBoundLabel}>Basse</div>
                      <div style={{ ...S.rangeBoundValue, color: ACCENT_PRO }}>{fmt(prixSortie.prixBas)}</div>
                    </div>
                    <div style={S.rangeCenter}>
                      <div style={S.rangeCenterLabel}>Cible</div>
                      <div style={{ ...S.rangeCenterValue, color: ACCENT_PRO, fontSize: 20 }}>{fmt(prixSortie.prixCible)}</div>
                    </div>
                    <div style={S.rangeBound}>
                      <div style={S.rangeBoundLabel}>Haute</div>
                      <div style={{ ...S.rangeBoundValue, color: ACCENT_PRO }}>{fmt(prixSortie.prixHaut)}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 8 }}>
                    Référence {fmtN(prixSortie.prixM2Ref)} €/m² · {fmtN(Number(carac.surfaceM2))} m² · Source : {prixSortie.source}
                  </div>
                </div>

                {marche.absorption_mensuelle != null && marche.absorption_mensuelle < 5 && (
                  <div style={S.warningBox}>
                    ⚠️ Marché peu liquide — envisagez une décote de 5–10% sur le prix de sortie.
                  </div>
                )}
              </>
            )}

            {/* Métriques promoteur */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
              <KPI
                label="Prix acquisition"
                value={prixAcq > 0 ? fmt(prixAcq) : "—"}
                sub={prixAcq > 0 && carac.surfaceM2 > 0 ? `${fmtN(Math.round(prixAcq / carac.surfaceM2))} €/m²` : undefined}
              />
              <KPI
                label="Spread acquisition / sortie"
                value={spreadPrixM2 != null ? `${fmtN(spreadPrixM2)} €/m²` : "—"}
                sub="Prix sortie neuf – prix DVF ancien"
              />
              <KPI
                label="Marge implicite brute"
                value={margeImplicite != null ? fmt(margeImplicite) : "—"}
                accent={margeImplicite != null && margeImplicite > 0}
                sub={margePct != null ? `${fmtD(margePct)}% du prix de sortie` : undefined}
              />
              <KPI
                label="Prime neuf vs ancien"
                value={dvfBest?.prixM2 && prixSortie
                  ? `+${fmtD(((prixSortie.prixM2Ref - dvfBest.prixM2) / dvfBest.prixM2) * 100)}%`
                  : "—"}
                sub="Prix neuf vs prix DVF médian"
              />
            </div>

            {/* Signal marché */}
            {hasMarcheData && absQual && (
              <div style={{ ...S.signalBox, background: absQual.bg, borderColor: `${absQual.color}40` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>Signal marché</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: absQual.color }}>{absQual.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: absQual.color }}>
                    {fmtD(marche.absorption_mensuelle!)} ventes/mois
                  </span>
                </div>
              </div>
            )}

            {/* Score opportunité */}
            {scoreResult ? (
              <div style={{ marginTop: 14 }}>
                <div style={S.subLabel}>Score opportunité promoteur</div>
                <div style={{ ...S.verdictBox, background: scoreResult.verdictBg, borderColor: `${scoreResult.verdictColor}40` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 28, fontWeight: 900, color: scoreResult.verdictColor, lineHeight: 1 }}>
                        {scoreResult.score}<span style={{ fontSize: 16, fontWeight: 600 }}>/100</span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: scoreResult.verdictColor, marginTop: 6 }}>
                        {scoreResult.verdict}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                      {scoreResult.facteurs.map((f) => (
                        <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: f.ok ? "#16a34a" : "#dc2626" }}>
                          <span>{f.ok ? "✓" : "✗"}</span>
                          <span style={{ color: "#475569" }}>{f.label}</span>
                          <span style={{ fontWeight: 700 }}>{f.pts}/{f.max}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, fontStyle: "italic" }}>
                  Score indicatif — fiabilité fonction de la complétude des données.
                </div>
              </div>
            ) : !hasSearched ? (
              <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 12, fontStyle: "italic" }}>
                Le score apparaîtra après calcul DVF.
              </div>
            ) : null}
          </div>

          {/* 7. Synthèse */}
          <div style={S.synthCard}>
            <SectionTitle icon="✅" title="Synthèse" subtitle="Récapitulatif de l'analyse" />

            {hasDvfData ? (
              <>
                <ul style={S.synthList}>
                  {loc.ville && <li>Bien situé à <strong>{loc.ville}{loc.arrondissement ? ` (${loc.arrondissement})` : ""}</strong>{loc.quartier ? `, quartier ${loc.quartier}` : ""} (CP {loc.codePostal})</li>}
                  <li>
                    Valeur estimée DVF : <strong>{fmt(dvfBest!.prixBas)} – {fmt(dvfBest!.prixHaut)}</strong>{" "}
                    <span style={{ color: confColor(dvfBest!.confiance), fontWeight: 700 }}>({dvfBest!.confiance})</span>
                    , {dvfBest!.transactions} transaction{dvfBest!.transactions > 1 ? "s" : ""}
                  </li>
                  {dvfBest!.prixM2 && <li>Prix médian DVF : <strong>{fmtN(dvfBest!.prixM2)} €/m²</strong> (bien ancien)</li>}
                  {prixSortie && (
                    <li>
                      Prix de sortie estimé : <strong>{fmt(prixSortie.prixBas)} – {fmt(prixSortie.prixHaut)}</strong>
                      {" "}<span style={{ fontSize: 12, color: "#64748b" }}>({prixSortie.source})</span>
                    </li>
                  )}
                  {margeImplicite != null && (
                    <li>
                      Marge brute implicite : <strong>{fmt(margeImplicite)}</strong>
                      {margePct != null && ` (${fmtD(margePct)}% du prix de sortie)`}
                    </li>
                  )}
                  {marche.absorption_mensuelle != null && absQual && (
                    <li>
                      Marché : <strong>{fmtD(marche.absorption_mensuelle)} ventes/mois</strong> — <span style={{ color: absQual.color }}>{absQual.label}</span>
                    </li>
                  )}
                  {scoreResult && (
                    <li>
                      Score opportunité : <strong style={{ color: scoreResult.verdictColor }}>{scoreResult.score}/100 — {scoreResult.verdict}</strong>
                    </li>
                  )}
                </ul>

                {/* Données manquantes */}
                {(scoreResult?.donneesManquantes?.length ?? 0) + donneesManquantes.filter(d => !hasDvfData || d !== "Estimation DVF (cliquer Calculer DVF)").length > 0 && (
                  <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: "#fffbeb", border: "1px solid #fde68a" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 6 }}>📋 Données manquantes pour affiner l'analyse</div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "#78350f" }}>
                      {[
                        ...donneesManquantes.filter(d => d !== "Estimation DVF (cliquer Calculer DVF)"),
                        ...(scoreResult?.donneesManquantes ?? []),
                      ].filter((v, i, arr) => arr.indexOf(v) === i).map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ marginTop: 14 }}>
                  <button onClick={handleSaveForSynthesis} style={S.btnSaveForSynth}>
                    {synthSaved ? "✓ Données enregistrées" : "📌 Utiliser dans la synthèse"}
                  </button>
                </div>
              </>
            ) : (
              <div style={S.emptyState}>
                <div style={S.emptyIcon}>📋</div>
                <div style={{ fontWeight: 700, color: "#334155", marginBottom: 6 }}>Synthèse indisponible</div>
                <div style={{ fontSize: 13, color: "#64748b" }}>
                  Renseignez les caractéristiques du bien et cliquez <strong>Calculer DVF</strong>.
                </div>
                {donneesManquantes.length > 0 && (
                  <div style={{ marginTop: 12, textAlign: "left", fontSize: 12, color: "#64748b" }}>
                    Données requises :
                    <ul style={{ margin: "6px 0 0 0", paddingLeft: 16 }}>
                      {donneesManquantes.map((d) => <li key={d}>{d}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Indicateurs marché (si disponibles) */}
          {hasMarcheData && (
            <div style={{ ...S.card, borderLeft: `4px solid ${ACCENT_PRO}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: ACCENT_PRO }}>📊 Indicateurs marché</div>
                {marche.commune_nom && <span style={{ fontSize: 12, color: "#64748b" }}>{marche.commune_nom}</span>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                <div style={{ ...S.kpiCard, ...(absQual ? { background: absQual.bg, borderColor: `${absQual.color}40` } : {}) }}>
                  <div style={S.kpiLabel}>Absorption</div>
                  {marche.absorption_mensuelle != null ? (
                    <>
                      <div style={{ fontSize: 20, fontWeight: 900, color: absQual?.color ?? "#0f172a" }}>{fmtD(marche.absorption_mensuelle)}<span style={{ fontSize: 11, fontWeight: 500 }}>/mois</span></div>
                      <div style={{ fontSize: 11, color: absQual?.color, fontWeight: 600, marginTop: 4 }}>{absQual?.label}</div>
                    </>
                  ) : <div style={{ fontSize: 13, color: "#94a3b8" }}>—</div>}
                </div>
                <div style={S.kpiCard}>
                  <div style={S.kpiLabel}>Médian ancien DVF</div>
                  {marche.prix_m2_median != null ? (
                    <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a" }}>{fmtN(marche.prix_m2_median)}<span style={{ fontSize: 11, fontWeight: 500 }}> €/m²</span></div>
                  ) : <div style={{ fontSize: 13, color: "#94a3b8" }}>—</div>}
                </div>
                <div style={S.kpiCard}>
                  <div style={S.kpiLabel}>Prix marché neuf</div>
                  {marche.prix_m2_median_neuf != null ? (
                    <div style={{ fontSize: 20, fontWeight: 900, color: ACCENT_PRO }}>{fmtN(marche.prix_m2_median_neuf)}<span style={{ fontSize: 11, fontWeight: 500 }}> €/m²</span></div>
                  ) : marche.prix_m2_median != null ? (
                    <div style={{ fontSize: 20, fontWeight: 900, color: ACCENT_PRO }}>{fmtN(Math.round(marche.prix_m2_median * 1.2))}<span style={{ fontSize: 11, fontWeight: 500 }}> €/m²</span></div>
                  ) : <div style={{ fontSize: 13, color: "#94a3b8" }}>—</div>}
                </div>
              </div>
            </div>
          )}

          {!hasMarcheData && (
            <div style={{ ...S.card, borderLeft: "4px solid #e2e8f0", background: "#f8fafc" }}>
              <div style={{ fontSize: 13, color: "#64748b" }}>
                📊 <strong>Étude marché non chargée.</strong><br />
                Allez sur <strong>Études › Marché</strong>, lancez l'analyse, puis cliquez "Utiliser pour la synthèse".
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EvaluationPage;

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  page: {
    color: "#0f172a",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  },
  
  grid: {
    display: "grid",
    gridTemplateColumns: "1.1fr 0.9fr",
    gap: 16,
    "@media (max-width: 900px)": { gridTemplateColumns: "1fr" },
  } as React.CSSProperties,
  col: { display: "flex", flexDirection: "column", gap: 16 },
  card: {
    background: "#ffffff",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.07)",
    boxShadow: "0 4px 20px rgba(2,6,23,0.05)",
    padding: "18px 20px",
  },
  analysisCard: {
    background: "linear-gradient(135deg, #fafaff 0%, #f0eeff 100%)",
    borderRadius: 14,
    border: "1px solid rgba(82,71,184,0.12)",
    borderLeft: `4px solid ${ACCENT_PRO}`,
    boxShadow: "0 4px 20px rgba(2,6,23,0.05)",
    padding: "18px 20px",
  },
  synthCard: {
    background: "#f0fdf4",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.07)",
    borderLeft: "4px solid #16a34a",
    boxShadow: "0 4px 20px rgba(2,6,23,0.05)",
    padding: "18px 20px",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  input: {
    height: 40,
    borderRadius: 10,
    border: "1px solid rgba(15,23,42,0.12)",
    padding: "0 12px",
    outline: "none",
    background: "#ffffff",
    width: "100%",
    boxSizing: "border-box",
    fontSize: 14,
    color: "#1e293b",
    fontFamily: "inherit",
  },
  btnPri: {
    height: 44,
    padding: "0 22px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.35)",
    background: "linear-gradient(135deg, #5b4fc7 0%, #7c6fcd 45%, #b39ddb 100%)",
    color: "#fff",
    fontWeight: 900,
    fontSize: 14,
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(82,71,184,0.28)",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    transition: "transform 140ms ease, box-shadow 140ms ease",
  },
  btnSec: {
    height: 44,
    padding: "0 18px",
    borderRadius: 999,
    border: "1px solid rgba(82,71,184,0.18)",
    background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 55%, #f1f5f9 100%)",
    color: "#475569",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    boxShadow: "0 8px 18px rgba(15,23,42,0.08)",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  btnSaveForSynth: {
    width: "100%",
    height: 46,
    borderRadius: 12,
    border: "1.5px solid #16a34a",
    background: "linear-gradient(135deg, #f0fdf4, #dcfce7)",
    color: "#166534",
    fontWeight: 800,
    fontSize: 14,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  infoBox: {
    marginTop: 12,
    padding: "8px 12px",
    borderRadius: 8,
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    fontSize: 12,
    color: "#92400e",
  },
  subLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: 8,
  },
  tagRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
  },
  autoTag: {
    position: "absolute" as const,
    right: 12,
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: 14,
    color: "#94a3b8",
    animation: "spin 1s linear infinite",
  },
  emptyState: {
    textAlign: "center" as const,
    padding: "28px 16px",
    color: "#94a3b8",
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 10,
    opacity: 0.5,
  },
  errorBox: {
    color: "#b91c1c",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 10,
    padding: "12px 14px",
  },
  dvfRangeBar: {
    background: "#f8fafc",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.07)",
    padding: "14px 16px",
    marginBottom: 4,
  },
  sortieRangeBar: {
    background: ACCENT_LIGHT,
    borderRadius: 12,
    border: `1px solid ${ACCENT_BORDER}`,
    padding: "14px 16px",
    marginBottom: 12,
  },
  rangeLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    marginBottom: 10,
  },
  rangeRow: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
  },
  rangeBound: { textAlign: "center" as const, flex: "0 0 auto" },
  rangeBoundLabel: { fontSize: 10, color: "#94a3b8", fontWeight: 600, marginBottom: 4 },
  rangeBoundValue: { fontSize: 15, fontWeight: 700, color: "#475569" },
  rangeCenter: { textAlign: "center" as const, flex: 1 },
  rangeCenterLabel: { fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 4 },
  rangeCenterValue: { fontSize: 22, fontWeight: 900, color: "#0f172a", letterSpacing: "-0.02em" },
  dvfDetailRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 12px",
    borderRadius: 8,
    border: "1.5px solid transparent",
    fontSize: 12,
    color: "#475569",
    gap: 8,
  },
  compsWarning: {
    fontSize: 12,
    color: "#b45309",
    fontStyle: "italic" as const,
    marginBottom: 8,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 12,
    minWidth: 460,
  },
  th: {
    padding: "7px 8px",
    fontWeight: 800,
    color: "#334155",
    borderBottom: "2px solid rgba(15,23,42,0.1)",
    whiteSpace: "nowrap" as const,
  },
  td: {
    padding: "7px 8px",
    color: "#475569",
    borderBottom: "1px solid rgba(15,23,42,0.05)",
    whiteSpace: "nowrap" as const,
  },
  kpiCard: {
    padding: "12px 14px",
    borderRadius: 12,
    background: "#f8fafc",
    border: "1px solid rgba(15,23,42,0.06)",
  },
  kpiLabel: {
    fontSize: 10,
    color: "#64748b",
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    marginBottom: 6,
  },
  signalBox: {
    marginTop: 14,
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid transparent",
  },
  verdictBox: {
    marginTop: 8,
    padding: "14px 16px",
    borderRadius: 12,
    border: "1px solid transparent",
  },
  warningBox: {
    marginTop: 10,
    padding: "8px 12px",
    background: "#fee2e2",
    borderRadius: 8,
    fontSize: 12,
    color: "#991b1b",
  },
  synthList: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 13,
    color: "#166534",
    lineHeight: 1.9,
  },
  spinner: {
    display: "inline-block",
    width: 14,
    height: 14,
    border: "2px solid rgba(82,71,184,0.3)",
    borderTopColor: ACCENT_PRO,
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
};