// src/spaces/investisseur/pages/deal-center/tabs/InvestmentPackTab.tsx
//
// Investment Pack — V6 — Investment Memorandum
// ───────────────────────────────────────────────────────────────────────────
// Nouveautés V6 (additives — aucun calcul de rentabilité V5 modifié) :
//   1. Comparables DVF réels (extraction tolérante depuis marcheSaved / snapshot)
//   2. Synthèse DVF automatique (médiane / projet / écart + verdict)
//   3. Investment Rating (note A+ → D + score global /100 + jauge)
//   4. Risques synthétiques enrichis (Marché / Accessibilité / Liquidité / Env.)
//   5. Carte MapLibre réelle (marqueur + cercle 500 m) avec fallback conservé
//   6. Structure investmentPackData prête pour l'export PDF (non implémenté)
//
// La logique FinancialEngine V5 (computeTriAnnualise / computeLocalScenario /
// reconstruction du snapshot) est conservée à l'identique.
//
// Style identique à AnalysePage.tsx.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  MapPin,
  Ruler,
  Euro,
  Hammer,
  TrendingUp,
  Sparkles,
  Clock,
  BarChart3,
  Map,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Info,
  Calendar,
  Percent,
  XCircle,
  Award,
  Gauge,
  Scale,
  Navigation,
  Droplets,
  Trees,
} from "lucide-react";

import useMarchandSnapshotTick from "../../../../marchand/shared/hooks/useMarchandSnapshotTick";
import {
  readMarchandSnapshot,
  ensureActiveDeal,
  type MarchandDeal,
  type MarcheRisquesSaved,
  type RentabiliteSaved,
} from "../../../../marchand/shared/marchandSnapshot.store";

import type { RentabiliteSnapshot, RentabiliteInput, RentabiliteResult } from "../../../../marchand/types/rentabilite.types";

// ─── Types internes ───────────────────────────────────────────────────────────

interface StrategyInputs {
  prixAchat?:             number;
  prixReventeCible?:      number;
  prixReventeEstime?:     number;
  strategy?:              string;
  travauxUtilises?:       number;
  travauxEstimes?:        number;
  loyerMensuel?:          number;
  chargesMensuelles?:     number;
  dureeMois?:             number;
  fraisNotairePct?:       number;
  fraisDivers?:           number;
  apportPersonnel?:       number;
  tmiPct?:                number;
  pfuPct?:                number;
  fiscalMode?:            string;
  montantPret?:           number;
  tauxNominalAnnuelPct?:  number;
  tauxAssuranceAnnuelPct?: number;
  fraisDossierEur?:       number;
  fraisGarantieEur?:      number;
  fraisCourtierEur?:      number;
  surfaceM2?:             number;
  [k: string]: unknown;
}

interface ScenarioFinancials {
  prixAchat:       number;
  fraisNotaire:    number;
  fraisDivers:     number;
  travauxBase:     number;
  fraisFinanciers: number;
  reventeBase:     number;
  apport:          number;
  dureeAnnees:     number;
  cashflow:        number;
}

// Comparable DVF normalisé (V6)
interface NormalizedComp {
  adresse?:    string;
  dateLabel?:  string;   // "03/2025"
  dateTs?:     number;   // timestamp pour le tri
  surface?:    number;   // m²
  prixTotal?:  number;   // €
  prixM2?:     number;   // €/m²
  distanceM?:  number;   // mètres
}

// ─── Moteur de scénario local (V5 — INCHANGÉ) ─────────────────────────────────

function computeTriAnnualise(
  apport: number,
  margeBrute: number,
  dureeAnnees: number,
): number | null {
  if (apport <= 0 || dureeAnnees <= 0) return null;

  const fluxFinal = apport + margeBrute;

  // Si les fonds propres sont entièrement détruits, le TRI n'est pas calculable.
  if (fluxFinal <= 0) return null;

  const multiple = fluxFinal / apport;

  return (Math.pow(multiple, 1 / dureeAnnees) - 1) * 100;
}

function computeLocalScenario(
  f: ScenarioFinancials,
  reventeFactor: number,
  travauxFactor: number,
): RentabiliteResult {
  const travauxScenario    = f.travauxBase * travauxFactor;
  const coutTotalScenario  = f.prixAchat + f.fraisNotaire + f.fraisDivers + travauxScenario + f.fraisFinanciers;
  const prixReventeScenario = f.reventeBase * reventeFactor;
  const margeBrute = prixReventeScenario - coutTotalScenario;
  const margePct   = coutTotalScenario > 0 ? (margeBrute / coutTotalScenario) * 100 : 0;
  const roiPct     = f.apport > 0 ? (margeBrute / f.apport) * 100 : 0;
  const triPct     = computeTriAnnualise(f.apport, margeBrute, f.dureeAnnees);
  return {
    fraisNotaire:    f.fraisNotaire,
    coutTotal:       coutTotalScenario,
    margeBrute,
    margePct,
    roiPct,
    triPct: triPct ?? undefined,
    cashflowMensuel: f.cashflow,
    rendementBrutPct: 0,
    decision: margePct >= 15 ? "GO" : margePct >= 8 ? "GO_AVEC_RESERVES" : "NO_GO",
    reasons: [],
  } as RentabiliteResult;
}

// ─── Extraction des raw inputs depuis le store (V5 — INCHANGÉ) ────────────────

function extractRawInputs(saved: RentabiliteSaved | undefined): StrategyInputs | null {
  if (!saved?.inputs) return null;
  return saved.inputs as StrategyInputs;
}

// ─── Helpers format ───────────────────────────────────────────────────────────

function fmtEUR(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(2)} %`;
}

function fmtM2(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toLocaleString("fr-FR")} m²`;
}

function fmtEURm2(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n).toLocaleString("fr-FR")} €/m²`;
}

function fmtDist(m: number | null | undefined): string {
  if (m == null) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace(".", ",")} km`;
  return `${Math.round(m)} m`;
}

function fmtSignedPct(n: number | null | undefined): string {
  if (n == null) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(1).replace(".", ",")} %`;
}

// ─── Helpers numériques génériques (V6) ───────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function toNum(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/\s/g, "").replace(/,/g, "."));
    if (isFinite(n)) return n;
  }
  return undefined;
}

function pickNum(o: Record<string, unknown> | null | undefined, keys: string[]): number | undefined {
  if (!o) return undefined;
  for (const k of keys) {
    const n = toNum(o[k]);
    if (n != null) return n;
  }
  return undefined;
}

function pickStr(o: Record<string, unknown> | null | undefined, keys: string[]): string | undefined {
  if (!o) return undefined;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function median(nums: number[]): number | null {
  const a = nums.filter((n) => isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Lecture des coordonnées (tolérante) ──────────────────────────────────────

function readCoords(obj: Record<string, unknown> | null | undefined): { lat?: number; lng?: number } {
  if (!obj || typeof obj !== "object") return {};
  let lat = pickNum(obj, ["lat", "latitude", "y"]);
  let lng = pickNum(obj, ["lng", "lon", "longitude", "x"]);
  if (lat != null && lng != null) return { lat, lng };

  for (const key of ["geo", "coordinates", "coords", "centroid", "center", "position", "geometry"]) {
    const v = obj[key];
    if (Array.isArray(v) && v.length >= 2) {
      // GeoJSON : [lng, lat]
      const a = toNum(v[0]);
      const b = toNum(v[1]);
      lng = lng ?? a;
      lat = lat ?? b;
    } else if (v && typeof v === "object") {
      const c = readCoords(v as Record<string, unknown>);
      lat = lat ?? c.lat;
      lng = lng ?? c.lng;
    }
    if (lat != null && lng != null) break;
  }
  return { lat, lng };
}

// ─── Extraction du tableau de comparables (tolérante) ─────────────────────────

const DVF_ARRAY_KEYS = [
  "dvf", "comparables", "comps", "transactions", "mutations", "ventes",
  "ventesComparables", "dvfComparables", "dvf_comparables", "comparablesDvf",
];

function findCompsArray(
  ...sources: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown>[] {
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    // niveau direct
    for (const k of DVF_ARRAY_KEYS) {
      const v = src[k];
      if (Array.isArray(v) && v.length) return v as Record<string, unknown>[];
    }
    // niveau imbriqué (1 cran)
    for (const val of Object.values(src)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        for (const k of DVF_ARRAY_KEYS) {
          const v = (val as Record<string, unknown>)[k];
          if (Array.isArray(v) && v.length) return v as Record<string, unknown>[];
        }
      }
    }
  }
  return [];
}

// Heuristique : un objet « comparable » possède un prix ET (une surface OU un prix/m²).
function looksLikeComp(o: Record<string, unknown>): boolean {
  const hasPrice =
    pickNum(o, ["valeur_fonciere", "valeurFonciere", "prix", "prix_total", "prixTotal", "montant", "valeur", "price"]) != null ||
    pickNum(o, ["prix_m2", "prixM2", "prix_au_m2", "pxm2"]) != null;
  const hasSurface =
    pickNum(o, ["surface_reelle_bati", "surfaceReelleBati", "surface", "surface_bati", "surfaceM2", "surface_m2", "surf"]) != null ||
    pickNum(o, ["prix_m2", "prixM2", "prix_au_m2", "pxm2"]) != null;
  return hasPrice && hasSurface;
}

// Repli : parcourt récursivement tout l'objet et retient le plus grand tableau
// d'objets ressemblant à des transactions DVF, quelle que soit la profondeur.
function deepFindComps(root: unknown, maxDepth = 7): Record<string, unknown>[] {
  const seen = new Set<unknown>();
  let best: Record<string, unknown>[] = [];

  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > maxDepth || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      const objs = node.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
      const matches = objs.filter(looksLikeComp);
      if (matches.length > best.length) best = matches;
      for (const x of node) visit(x, depth + 1);
      return;
    }

    for (const v of Object.values(node as Record<string, unknown>)) visit(v, depth + 1);
  };

  visit(root, 0);
  return best;
}

// Géocodage via la Base Adresse Nationale (gratuit, CORS, sans clé).
async function geocodeBan(query: string): Promise<{ lat: number; lng: number } | null> {
  if (!query || query.trim().length < 4) return null;
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const coords = json?.features?.[0]?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const lng = toNum(coords[0]);
      const lat = toNum(coords[1]);
      if (lat != null && lng != null) return { lat, lng };
    }
    return null;
  } catch (e) {
    console.warn("[InvestmentPack] géocodage BAN échoué :", e);
    return null;
  }
}

function parseDvfDate(raw?: string): { label?: string; ts?: number } {
  if (!raw) return {};
  let d: Date | null = null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const fr  = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  const mY  = raw.match(/^(\d{2})\/(\d{4})/);
  if (iso) d = new Date(+iso[1], +iso[2] - 1, +iso[3]);
  else if (fr) d = new Date(+fr[3], +fr[2] - 1, +fr[1]);
  else if (mY) d = new Date(+mY[2], +mY[1] - 1, 1);
  else {
    const t = Date.parse(raw);
    if (!isNaN(t)) d = new Date(t);
  }
  if (!d || isNaN(d.getTime())) return { label: raw };
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return { label: `${mm}/${d.getFullYear()}`, ts: d.getTime() };
}

function normalizeComp(
  raw: Record<string, unknown>,
  dealLat?: number,
  dealLng?: number,
): NormalizedComp {
  const adresse = pickStr(raw, ["adresse", "address", "adresse_complete", "voie", "libelle", "label", "nom"]);
  const dateRaw = pickStr(raw, ["date_mutation", "dateMutation", "date", "mutation_date", "date_vente", "datemut"]);
  const { label, ts } = parseDvfDate(dateRaw);
  const surface = pickNum(raw, ["surface_reelle_bati", "surfaceReelleBati", "surface", "surface_bati", "surfaceM2", "surface_m2", "surf"]);
  const prixTotal = pickNum(raw, ["valeur_fonciere", "valeurFonciere", "prix", "prix_total", "prixTotal", "montant", "price", "valeur"]);
  let prixM2 = pickNum(raw, ["prix_m2", "prixM2", "prix_au_m2", "prix_metre_carre", "pxm2", "prix_m2_bati"]);
  if (prixM2 == null && prixTotal != null && surface != null && surface > 0) {
    prixM2 = prixTotal / surface;
  }

  let distanceM = pickNum(raw, ["distance", "distance_m", "distanceM", "dist", "dist_m"]);
  if (distanceM == null && dealLat != null && dealLng != null) {
    const { lat, lng } = readCoords(raw);
    if (lat != null && lng != null) {
      distanceM = haversineM(dealLat, dealLng, lat, lng);
    }
  }

  return { adresse, dateLabel: label, dateTs: ts, surface, prixTotal, prixM2, distanceM };
}

function sortComps(a: NormalizedComp, b: NormalizedComp): number {
  const da = a.distanceM ?? Infinity;
  const db = b.distanceM ?? Infinity;
  if (da !== db) return da - db;          // proximité d'abord
  return (b.dateTs ?? 0) - (a.dateTs ?? 0); // date la plus récente ensuite
}

// ─── Verdict DVF ───────────────────────────────────────────────────────────────

interface DvfSynthese {
  medianeM2: number | null;
  projetM2:  number | null;
  ecartPct:  number | null;
  verdict:   string | null;
  tone:      "good" | "neutral" | "warn" | null;
}

function buildDvfVerdict(ecartPct: number | null): { verdict: string | null; tone: DvfSynthese["tone"] } {
  if (ecartPct == null) return { verdict: null, tone: null };
  if (ecartPct < -10) {
    return { verdict: "Prix de sortie inférieur au marché. Commercialisation facilitée.", tone: "good" };
  }
  if (ecartPct <= 10) {
    return { verdict: "Prix de sortie cohérent avec les références DVF.", tone: "neutral" };
  }
  return { verdict: "Prix de sortie supérieur aux références DVF. Risque commercial accru.", tone: "warn" };
}

// ─── Investment Rating ─────────────────────────────────────────────────────────

interface RatingCriterion {
  key:   string;
  label: string;
  raw:   number | null;   // valeur brute affichée (%, /100…)
  score: number | null;   // score normalisé 0–100
  display: string;
}

interface InvestmentRatingResult {
  global:    number | null;
  grade:     string | null;
  criteria:  RatingCriterion[];
}

function marketGlobalScore(marcheSaved: MarcheRisquesSaved | undefined): number | null {
  if (!marcheSaved) return null;
  const m = marcheSaved as unknown as Record<string, unknown>;
  const direct = pickNum(m, ["score", "scoreGlobal", "score_global", "note", "smartScore", "smartscore"]);
  if (direct != null) return clamp(direct, 0, 100);
  const b = marcheSaved.breakdown as Record<string, unknown> | undefined;
  if (b) {
    const vals = Object.values(b)
      .map(toNum)
      .filter((n): n is number => n != null);
    if (vals.length) return clamp(vals.reduce((s, n) => s + n, 0) / vals.length, 0, 100);
  }
  return null;
}

function risqueScore(
  snapshot: RentabiliteSnapshot | null,
  marcheSaved: MarcheRisquesSaved | undefined,
): number | null {
  const base = snapshot?.scenarios?.base ?? null;
  const env  = pickNum(marcheSaved?.breakdown as Record<string, unknown> | undefined, ["environnement", "environment", "env"]);
  if (!base && env == null) return null;

  let score = 78;
  if (base) {
    const ks = buildKillSwitches(snapshot);
    if (ks.length) score -= ks.length * 30;
    if (base.decision === "GO") score += 12;
    if (base.decision === "NO_GO") score -= 25;
  }
  if (env != null) score = (score + env) / 2;
  return clamp(score, 0, 100);
}

function computeRating(
  snapshot: RentabiliteSnapshot | null,
  marcheSaved: MarcheRisquesSaved | undefined,
): InvestmentRatingResult {
  const base = snapshot?.scenarios?.base ?? null;

  const margePct = base?.margePct ?? null;
  const roiPct   = base?.roiPct ?? null;
  const triPct   = base?.triPct ?? null;
  const marche   = marketGlobalScore(marcheSaved);
  const risque   = risqueScore(snapshot, marcheSaved);

  const sMarge  = margePct != null ? clamp((margePct / 20) * 100, 0, 100) : null;   // 20 %+ → 100
  const sRoi    = roiPct   != null ? clamp((roiPct / 40) * 100, 0, 100)   : null;   // 40 %+ → 100
  const sTri    = triPct   != null ? clamp((triPct / 25) * 100, 0, 100)   : null;   // 25 %+ → 100
  const sMarche = marche   != null ? clamp(marche, 0, 100)                : null;
  const sRisque = risque   != null ? clamp(risque, 0, 100)                : null;

  const criteria: RatingCriterion[] = [
    { key: "marge",  label: "Marge nette",      raw: margePct, score: sMarge,  display: fmtPct(margePct) },
    { key: "roi",    label: "ROI fonds propres", raw: roiPct,   score: sRoi,    display: fmtPct(roiPct) },
    { key: "tri",    label: "TRI",               raw: triPct,   score: sTri,    display: fmtPct(triPct) },
    { key: "marche", label: "SmartScore marché", raw: marche,   score: sMarche, display: marche != null ? `${Math.round(marche)}/100` : "—" },
    { key: "risque", label: "Risques",           raw: risque,   score: sRisque, display: risque != null ? `${Math.round(risque)}/100` : "—" },
  ];

  const weights: Record<string, number> = { marge: 0.30, roi: 0.20, tri: 0.20, marche: 0.20, risque: 0.10 };
  const present = criteria.filter((c) => c.score != null);
  const totalW = present.reduce((s, c) => s + (weights[c.key] ?? 0), 0);
  const global =
    totalW > 0
      ? present.reduce((s, c) => s + (c.score as number) * (weights[c.key] ?? 0), 0) / totalW
      : null;

  const grade = global == null ? null : gradeFromScore(global);

  return { global, grade, criteria };
}

function gradeFromScore(s: number): string {
  if (s >= 90) return "A+";
  if (s >= 80) return "A";
  if (s >= 70) return "B+";
  if (s >= 60) return "B";
  if (s >= 45) return "C";
  return "D";
}

function gradeStyle(grade: string): { text: string; bg: string; ring: string } {
  switch (grade) {
    case "A+":
    case "A":  return { text: "text-emerald-700", bg: "bg-emerald-50", ring: "ring-emerald-200" };
    case "B+":
    case "B":  return { text: "text-amber-700",   bg: "bg-amber-50",   ring: "ring-amber-200" };
    case "C":  return { text: "text-orange-700",  bg: "bg-orange-50",  ring: "ring-orange-200" };
    default:   return { text: "text-rose-700",    bg: "bg-rose-50",    ring: "ring-rose-200" };
  }
}

// ─── Bloc 1 — Fiche Deal (V5 — INCHANGÉ) ─────────────────────────────────────

function FicheDeal({ deal, inputs }: { deal: MarchandDeal | null; inputs: RentabiliteInput | null }) {
  const adresse = deal ? [deal.address, deal.zipCode, deal.city].filter(Boolean).join(", ") : null;
  const typeOp  = inputs?.strategy === "revente"  ? "Marchand de bien / Revente"
    : inputs?.strategy === "location" ? "Investissement locatif" : null;

  const carats = [
    { label: "Type de bien",  icon: Building2,  value: typeOp ?? null },
    { label: "Stratégie",     icon: TrendingUp, value: inputs?.strategy === "revente" ? "Achat / Revente" : inputs?.strategy === "location" ? "Locatif" : null },
    { label: "Durée portage", icon: Calendar,   value: inputs?.dureeMois ? `${inputs.dureeMois} mois` : null },
    { label: "Régime fiscal", icon: Percent,    value: inputs?.useFlatTax ? "Flat tax 30 %" : inputs?.tmiPct ? `TMI ${inputs.tmiPct} %` : null },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden print:shadow-none print:border-gray-300">
      <div className="px-6 py-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100">
            <Building2 className={["h-6 w-6", typeOp ? "text-indigo-500" : "text-gray-300"].join(" ")} />
          </div>
          <div>
            <div className={["text-base font-bold", typeOp ? "text-gray-900" : "text-gray-400 select-none"].join(" ")}>
              {typeOp ?? "— Type d'opération"}
            </div>
            <div className="flex items-center gap-1 text-sm text-gray-400 mt-0.5">
              <MapPin className="h-3.5 w-3.5" />
              <span className={adresse ? "text-gray-600" : "select-none"}>
                {adresse || "— Adresse non renseignée"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm shrink-0">
          {deal?.surfaceM2 && (
            <div className="flex items-center gap-1.5 text-gray-600">
              <Ruler className="h-3.5 w-3.5" />
              <span className="font-medium">{fmtM2(deal.surfaceM2)}</span>
            </div>
          )}
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-center print:bg-white print:border-gray-300">
            <div className="text-xs text-gray-500 font-medium">Prix achat</div>
            <div className={["text-lg font-bold", deal?.prixAchat ? "text-gray-800" : "text-gray-300 select-none"].join(" ")}>
              {fmtEUR(deal?.prixAchat)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-gray-100">
        {carats.map(({ label, icon: Icon, value }) => (
          <div key={label} className="px-5 py-4 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <Icon className={["h-3.5 w-3.5", value ? "text-gray-500" : "text-gray-300"].join(" ")} />
              <span className="text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
            </div>
            <span className={["text-sm font-semibold", value ? "text-gray-800" : "text-gray-300 select-none"].join(" ")}>
              {value ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Bloc 2 — Hypothèses financières (V5 — INCHANGÉ) ─────────────────────────

function HypothesesFinancieres({ deal, inputs }: { deal: MarchandDeal | null; inputs: RentabiliteInput | null }) {
  const rows = [
    { label: "Prix d'acquisition",    icon: Euro,       hint: "Prix net vendeur",           value: fmtEUR(deal?.prixAchat ?? inputs?.prixAchat)             },
    { label: "Frais de notaire",      icon: Percent,    hint: "~7–8 % dans l'ancien",       value: inputs ? fmtPct(inputs.fraisNotairePct) : "—"             },
    { label: "Frais divers",          icon: Euro,       hint: "Si applicable",              value: inputs?.fraisDivers != null ? fmtEUR(inputs.fraisDivers) : "—" },
    { label: "Budget travaux",        icon: Hammer,     hint: "Estimation TCE",             value: inputs?.budgetTravaux != null ? fmtEUR(inputs.budgetTravaux) : "—" },
    { label: "Prix de revente cible", icon: TrendingUp, hint: "Prix net vendeur estimé",    value: fmtEUR(deal?.prixReventeCible ?? inputs?.prixReventeCible) },
    { label: "Durée de portage",      icon: Calendar,   hint: "En mois",                    value: inputs?.dureeMois ? `${inputs.dureeMois} mois` : "—"       },
    { label: "Apport personnel",      icon: Euro,       hint: "Fonds propres engagés",      value: inputs?.apport != null ? fmtEUR(inputs.apport) : "—"       },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden print:shadow-none print:border-gray-300">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900 print:text-black">Hypothèses financières</h3>
        <p className="mt-1 text-sm text-gray-500 print:text-gray-700">Paramètres du montage synchronisés depuis l'analyse de rentabilité.</p>
      </div>
      <div className="grid grid-cols-3 px-5 py-3 bg-gray-50 border-b border-gray-100 print:bg-white">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Poste</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 text-center">Valeur</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 text-right">Note</span>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(({ label, icon: Icon, hint, value }) => {
          const hasVal = value !== "—";
          return (
            <div key={label} className="grid grid-cols-3 items-center px-5 py-3.5 gap-2">
              <div className="flex items-center gap-2">
                <Icon className={["h-3.5 w-3.5 shrink-0", hasVal ? "text-gray-500" : "text-gray-300"].join(" ")} />
                <span className="text-sm font-medium text-gray-700">{label}</span>
              </div>
              <div className="text-center">
                <span className={[
                  "inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-sm font-semibold min-w-[80px]",
                  hasVal
                    ? "border-gray-200 bg-white text-gray-800"
                    : "border-gray-200 bg-gray-50 text-gray-300 select-none print:text-gray-400",
                ].join(" ")}>
                  {value}
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs text-gray-500">{hint}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 print:bg-white">
        <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
          <Info className="h-3 w-3 shrink-0" />
          Modifiez ces valeurs depuis la page Analyse / Rentabilité.
        </p>
      </div>
    </div>
  );
}

// ─── Bloc 3 — Tableau de rentabilité (V5 — INCHANGÉ) ─────────────────────────

function TableauRentabilite({ snapshot }: { snapshot: RentabiliteSnapshot | null }) {
  const base = snapshot?.scenarios?.base ?? null;

  const metrics = [
    { label: "Marge brute",       icon: Euro,       sub: "Revente − Coût total",       value: fmtEUR(base?.margeBrute),        pct: base ? Math.min(100, Math.max(0, base.margePct * 4)) : 0 },
    { label: "Marge nette %",     icon: TrendingUp, sub: "En % du coût total",         value: fmtPct(base?.margePct),          pct: base ? Math.min(100, Math.max(0, base.margePct * 4)) : 0 },
    { label: "TRI",               icon: Percent,    sub: "Taux de rendement interne",  value: fmtPct(base?.triPct),            pct: base?.triPct != null ? Math.min(100, Math.max(0, base.triPct * 3)) : 0 },
    { label: "Cash-flow mensuel", icon: BarChart3,  sub: "Pendant le portage",         value: fmtEUR(base?.cashflowMensuel),   pct: base?.cashflowMensuel ? 60 : 0                          },
    { label: "Coût total",        icon: Clock,      sub: "Acquisition + travaux + frais", value: fmtEUR(base?.coutTotal),      pct: base ? 100 : 0                                          },
    { label: "ROI",               icon: Sparkles,   sub: "Rendement fonds propres",    value: fmtPct(base?.roiPct),            pct: base ? Math.min(100, Math.max(0, (base.roiPct ?? 0) * 2)) : 0 },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="mb-5">
        <h3 className="text-sm font-semibold text-gray-900 print:text-black">Tableau de rentabilité</h3>
        <p className="mt-1 text-sm text-gray-500 print:text-gray-700">Indicateurs financiers synthétiques du deal.</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {metrics.map(({ label, icon: Icon, sub, value, pct }) => {
          const hasVal = value !== "—";
          return (
            <div key={label} className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 flex flex-col gap-1.5 print:shadow-none print:border-gray-300">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-gray-500 leading-tight">{label}</span>
                <Icon className={["h-3.5 w-3.5 shrink-0", hasVal ? "text-gray-500" : "text-gray-300"].join(" ")} />
              </div>
              <div className={["text-3xl leading-none font-semibold min-h-[36px]", hasVal ? "text-gray-800" : "text-gray-400"].join(" ")}>
                {value}
              </div>
              <span className="text-[11px] text-gray-400">{sub}</span>
              <div className="mt-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500/75 via-fuchsia-500/65 to-amber-500/60 transition-all duration-500 print:bg-gray-900"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Bloc V6 — Investment Rating ───────────────────────────────────────────────

function InvestmentRating({ rating }: { rating: InvestmentRatingResult }) {
  const { global, grade, criteria } = rating;
  const gs = grade ? gradeStyle(grade) : null;
  const scaleGrades = ["A+", "A", "B+", "B", "C", "D"];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 print:text-black flex items-center gap-2">
            <Award className="h-4 w-4 text-indigo-500" />
            Investment Rating
          </h3>
          <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
            Note de synthèse pondérée — marge, ROI, TRI, marché et risques.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-5">
        {/* Badge note */}
        <div className={[
          "flex flex-col items-center justify-center rounded-2xl ring-1 px-6 py-5 shrink-0 w-full sm:w-44",
          gs ? `${gs.bg} ${gs.ring}` : "bg-gray-50 ring-gray-200",
        ].join(" ")}>
          <span className={["text-5xl font-bold leading-none", gs ? gs.text : "text-gray-300 select-none"].join(" ")}>
            {grade ?? "—"}
          </span>
          <span className="mt-2 text-[11px] uppercase tracking-wide text-gray-500">Note du deal</span>
          <div className="mt-3 flex items-center gap-1">
            {scaleGrades.map((g) => (
              <span
                key={g}
                className={[
                  "text-[10px] font-semibold rounded px-1 py-0.5",
                  g === grade ? (gs ? `${gs.text} ${gs.bg}` : "text-gray-700 bg-gray-100") : "text-gray-300",
                ].join(" ")}
              >
                {g}
              </span>
            ))}
          </div>
        </div>

        {/* Score global + jauge */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-end justify-between">
            <div className="flex items-center gap-2">
              <Gauge className={["h-4 w-4", global != null ? "text-gray-500" : "text-gray-300"].join(" ")} />
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Score global</span>
            </div>
            <span className={["text-2xl font-bold", global != null ? "text-gray-800" : "text-gray-300 select-none"].join(" ")}>
              {global != null ? `${Math.round(global)}/100` : "—"}
            </span>
          </div>
          <div className="mt-2 h-2.5 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500/80 via-fuchsia-500/70 to-amber-500/65 transition-all duration-500 print:bg-gray-900"
              style={{ width: `${global != null ? clamp(global, 0, 100) : 0}%` }}
            />
          </div>

          {/* Critères */}
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
            {criteria.map((c) => {
              const has = c.score != null;
              return (
                <div key={c.key} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600">{c.label}</span>
                    <span className={["text-xs font-semibold", has ? "text-gray-700" : "text-gray-300 select-none"].join(" ")}>
                      {c.display}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-400/70 to-fuchsia-400/60 transition-all duration-500 print:bg-gray-800"
                      style={{ width: `${has ? clamp(c.score as number, 0, 100) : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {global == null && (
        <div className="mt-4 px-4 py-3 rounded-xl bg-gray-50 ring-1 ring-gray-200 print:bg-white print:ring-gray-300">
          <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
            <Info className="h-3 w-3 shrink-0" />
            La note se calculera automatiquement une fois la rentabilité et le SmartScore marché renseignés.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Bloc 4 — Comparables DVF (V6 — données réelles) ──────────────────────────

function ComparablesDVF({ comps }: { comps: NormalizedComp[] }) {
  const hasComps = comps.length > 0;
  const headers = ["Distance", "Date", "Surface", "Prix total", "Prix / m²"];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden print:shadow-none print:border-gray-300">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900 print:text-black">Comparables DVF</h3>
        <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
          Transactions de référence extraites du moteur DVF, triées par proximité puis date.
        </p>
      </div>
      <div className="hidden sm:grid grid-cols-5 px-5 py-3 bg-gray-50 border-b border-gray-100 print:bg-white">
        {headers.map((h) => (
          <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 text-center first:text-left">{h}</span>
        ))}
      </div>
      <div className="divide-y divide-gray-100">
        {hasComps ? comps.map((c, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-5 items-center px-5 py-3.5 gap-2">
            <div className="col-span-2 sm:col-span-1 flex items-center gap-2 min-w-0">
              <div className="h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0" />
              <div className="min-w-0">
                <span className="text-sm font-semibold text-gray-700">{fmtDist(c.distanceM)}</span>
                {c.adresse && (
                  <span className="block text-[11px] text-gray-400 truncate">{c.adresse}</span>
                )}
              </div>
            </div>
            <div className="text-center hidden sm:block text-sm text-gray-600">{c.dateLabel ?? "—"}</div>
            <div className="text-center hidden sm:block text-sm text-gray-600">{c.surface != null ? fmtM2(c.surface) : "—"}</div>
            <div className="text-center hidden sm:block text-sm text-gray-600">{fmtEUR(c.prixTotal)}</div>
            <div className="text-center hidden sm:block text-sm font-semibold text-gray-700">{fmtEURm2(c.prixM2)}</div>
          </div>
        )) : Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-5 items-center px-5 py-3.5 gap-2">
            <div className="col-span-2 sm:col-span-1 flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-gray-200 shrink-0" />
              <span className="text-sm text-gray-300 select-none">— Distance</span>
            </div>
            {["Date", "Surface", "Prix total", "Prix / m²"].map((col) => (
              <div key={col} className="text-center hidden sm:block text-sm text-gray-300 select-none">—</div>
            ))}
          </div>
        ))}
      </div>
      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 print:bg-white">
        <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
          <Info className="h-3 w-3 shrink-0" />
          {hasComps
            ? `${comps.length} transaction${comps.length > 1 ? "s" : ""} comparable${comps.length > 1 ? "s" : ""} retenue${comps.length > 1 ? "s" : ""} (max. 10).`
            : "Les transactions comparables seront extraites du moteur DVF une fois la parcelle renseignée."}
        </p>
      </div>
    </div>
  );
}

// ─── Bloc V6 — Synthèse DVF ─────────────────────────────────────────────────────

function SyntheseDVF({ synthese }: { synthese: DvfSynthese }) {
  const { medianeM2, projetM2, ecartPct, verdict, tone } = synthese;

  const tiles = [
    { label: "Médiane DVF", icon: Scale,       value: fmtEURm2(medianeM2),     muted: medianeM2 == null },
    { label: "Projet",      icon: Building2,    value: fmtEURm2(projetM2),      muted: projetM2 == null },
    { label: "Écart",       icon: TrendingUp,   value: fmtSignedPct(ecartPct),  muted: ecartPct == null },
  ];

  const toneCls =
    tone === "good"   ? "bg-emerald-50 ring-emerald-200 text-emerald-700"
    : tone === "warn" ? "bg-rose-50 ring-rose-200 text-rose-700"
    : tone === "neutral" ? "bg-indigo-50 ring-indigo-200 text-indigo-700"
    : "bg-gray-50 ring-gray-200 text-gray-500";

  const VerdictIcon = tone === "good" ? CheckCircle2 : tone === "warn" ? AlertTriangle : Info;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900 print:text-black">Analyse DVF</h3>
        <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
          Positionnement du prix de sortie par rapport aux références de marché.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        {tiles.map(({ label, icon: Icon, value, muted }) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col gap-1.5 print:border-gray-300">
            <div className="flex items-center gap-1.5">
              <Icon className={["h-3.5 w-3.5", muted ? "text-gray-300" : "text-gray-500"].join(" ")} />
              <span className="text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
            </div>
            <span className={["text-xl font-bold leading-tight", muted ? "text-gray-300 select-none" : "text-gray-800"].join(" ")}>
              {value}
            </span>
          </div>
        ))}
      </div>

      <div className={["flex items-start gap-2.5 rounded-xl ring-1 px-4 py-3 print:bg-white print:ring-gray-300", toneCls].join(" ")}>
        <VerdictIcon className="h-4 w-4 mt-0.5 shrink-0" />
        <span className="text-sm font-medium">
          {verdict ?? "Verdict disponible une fois les comparables DVF et le prix de revente renseignés."}
        </span>
      </div>
    </div>
  );
}

// ─── Bloc 5 — Carte localisation (V6 — MapLibre réelle + fallback) ────────────

function circlePolygon(lng: number, lat: number, radiusM: number, points = 64) {
  const coords: [number, number][] = [];
  const distanceX = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const distanceY = radiusM / 110540;
  for (let i = 0; i < points; i++) {
    const theta = (i / points) * 2 * Math.PI;
    coords.push([lng + distanceX * Math.cos(theta), lat + distanceY * Math.sin(theta)]);
  }
  coords.push(coords[0]);
  return {
    type: "Feature" as const,
    geometry: { type: "Polygon" as const, coordinates: [coords] },
    properties: {},
  };
}

function ensureMaplibreCss() {
  if (typeof document === "undefined") return;
  const id = "maplibre-gl-css-cdn";
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
  document.head.appendChild(link);
}

function CarteLocalisation({
  deal,
  lat,
  lng,
  geoStatus = "idle",
}: {
  deal: MarchandDeal | null;
  lat?: number;
  lng?: number;
  geoStatus?: "idle" | "loading" | "ok" | "failed";
}) {
  const adresse = deal ? [deal.address, deal.zipCode, deal.city].filter(Boolean).join(", ") : null;
  const hasCoords = lat != null && lng != null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    if (!hasCoords || mapFailed) return;
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any;

    ensureMaplibreCss();

    (async () => {
      try {
        // maplibre-gl est installé : import dynamique standard, résolu et
        // pré-bundlé par Vite. Chargé à la demande (~800 ko) uniquement quand
        // des coordonnées sont disponibles. En cas d'échec → catch → fallback.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod: any = await import("maplibre-gl");
        const maplibregl = mod.default ?? mod;
        if (cancelled || !containerRef.current) return;

        map = new maplibregl.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "© OpenStreetMap",
              },
            },
            layers: [{ id: "osm", type: "raster", source: "osm" }],
          },
          center: [lng as number, lat as number],
          zoom: 14,
          attributionControl: true,
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

        map.on("load", () => {
          if (cancelled) return;
          map.addSource("rayon-500", {
            type: "geojson",
            data: circlePolygon(lng as number, lat as number, 500),
          });
          map.addLayer({
            id: "rayon-500-fill",
            type: "fill",
            source: "rayon-500",
            paint: { "fill-color": "#6366f1", "fill-opacity": 0.12 },
          });
          map.addLayer({
            id: "rayon-500-line",
            type: "line",
            source: "rayon-500",
            paint: { "line-color": "#6366f1", "line-width": 2, "line-opacity": 0.6 },
          });
          new maplibregl.Marker({ color: "#6366f1" })
            .setLngLat([lng as number, lat as number])
            .addTo(map);
        });
      } catch {
        if (!cancelled) setMapFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      try { map?.remove(); } catch { /* noop */ }
    };
  }, [hasCoords, lat, lng, mapFailed]);

  // ── Carte réelle ─────────────────────────────────────────────────────────
  if (hasCoords && !mapFailed) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-900 print:text-black">Localisation</h3>
          <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
            {adresse ? adresse : "Positionnement du bien et rayon de 500 m."}
          </p>
        </div>
        <div
          ref={containerRef}
          className="h-72 w-full rounded-xl overflow-hidden ring-1 ring-gray-200 print:ring-gray-300"
        />
        <p className="mt-2 text-[11px] text-gray-400 flex items-center gap-1.5">
          <MapPin className="h-3 w-3 shrink-0" />
          Position du bien et zone d'influence (rayon 500 m).
        </p>
      </div>
    );
  }

  // ── Fallback (messages d'état distincts) ──────────────────────────────────
  const fallbackMsg = mapFailed
    ? "Carte indisponible : échec du chargement de MapLibre (voir la console)."
    : geoStatus === "loading"
    ? "Recherche des coordonnées de l'adresse…"
    : geoStatus === "failed"
    ? "Géocodage indisponible pour cette adresse (vérifiez la connexion réseau ou la CSP)."
    : adresse
    ? "Intégration cartographique disponible après connexion des coordonnées GPS."
    : "La carte s'affichera automatiquement une fois les coordonnées GPS du bien renseignées.";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900 print:text-black">Localisation</h3>
        <p className="mt-1 text-sm text-gray-500 print:text-gray-700">Positionnement du bien dans son environnement.</p>
      </div>
      <div className="flex flex-col items-center justify-center py-14 gap-3 rounded-xl bg-gray-50 ring-1 ring-gray-200 print:bg-white print:ring-gray-300">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-200">
          <Map className="h-6 w-6 text-gray-400" />
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-gray-600">
            {adresse ? adresse : "Carte non disponible"}
          </div>
          <div className="text-xs text-gray-500 mt-1 max-w-xs leading-relaxed">
            {fallbackMsg}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Bloc 6 — Risques synthétiques (V5 conservé + métriques marché V6) ────────

function buildFeuxVerts(snapshot: RentabiliteSnapshot | null, marcheSaved: MarcheRisquesSaved | undefined): string[] {
  const items: string[] = [];
  const base = snapshot?.scenarios?.base;
  const b    = marcheSaved?.breakdown;
  if (base?.margePct   != null && base.margePct   >= 15) items.push(`Marge nette solide (${base.margePct.toFixed(1)} %)`);
  if (base?.triPct     != null && base.triPct     >= 15) items.push(`TRI attractif (${base.triPct.toFixed(1)} %)`);
  if (base?.decision   === "GO")                         items.push("Rentabilité GO selon les paramètres actuels");
  if (b?.demande       != null && b.demande       >= 65) items.push(`Demande solide (${b.demande}/100)`);
  if (b?.accessibilite != null && b.accessibilite >= 65) items.push(`Bonne accessibilité (${b.accessibilite}/100)`);
  return items;
}

function buildVigilances(snapshot: RentabiliteSnapshot | null, marcheSaved: MarcheRisquesSaved | undefined): string[] {
  const items: string[] = [];
  const base = snapshot?.scenarios?.base;
  const b    = marcheSaved?.breakdown;
  if (base?.margePct     != null && base.margePct     < 10) items.push(`Marge nette faible (${base.margePct.toFixed(1)} %)`);
  if (base?.triPct       != null && base.triPct       < 15) items.push(`TRI insuffisant (${base.triPct.toFixed(1)} %)`);
  if (b?.environnement   != null && b.environnement   < 50) items.push(`Environnement dégradé (${b.environnement}/100)`);
  if (b?.demande         != null && b.demande         < 50) items.push(`Demande faible (${b.demande}/100)`);
  return items;
}

function buildKillSwitches(snapshot: RentabiliteSnapshot | null): string[] {
  const base = snapshot?.scenarios?.base;
  if (!base) return [];
  const ks: string[] = [];
  if (base.decision   === "NO_GO")  ks.push("Rentabilité NO GO — opération non viable");
  if (base.margeBrute  < 0)         ks.push("Marge brute négative — perte certaine");
  if (base.margePct    < 5)         ks.push(`Marge nette < 5 % (${base.margePct.toFixed(1)} %)`);
  return ks;
}

interface MarketMetric {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}

function buildMarketMetrics(marcheSaved: MarcheRisquesSaved | undefined): MarketMetric[] {
  const b = marcheSaved?.breakdown as Record<string, unknown> | undefined;
  if (!b) return [];
  const defs: Array<{ label: string; keys: string[]; icon: MarketMetric["icon"] }> = [
    { label: "Marché",        keys: ["marche", "marché", "market", "demande"], icon: TrendingUp },
    { label: "Accessibilité", keys: ["accessibilite", "accessibilité", "access"], icon: Navigation },
    { label: "Liquidité",     keys: ["liquidite", "liquidité", "liquidity"], icon: Droplets },
    { label: "Environnement", keys: ["environnement", "environment", "env"], icon: Trees },
  ];
  const out: MarketMetric[] = [];
  for (const d of defs) {
    const v = pickNum(b, d.keys);
    if (v != null) out.push({ label: d.label, value: clamp(v, 0, 100), icon: d.icon });
  }
  return out;
}

function RisquesSynthetiques({
  snapshot,
  marcheSaved,
}: {
  snapshot:    RentabiliteSnapshot | null;
  marcheSaved: MarcheRisquesSaved  | undefined;
}) {
  const feuxVerts     = useMemo(() => buildFeuxVerts(snapshot, marcheSaved),   [snapshot, marcheSaved]);
  const vigilances    = useMemo(() => buildVigilances(snapshot, marcheSaved),  [snapshot, marcheSaved]);
  const killSwitches  = useMemo(() => buildKillSwitches(snapshot),             [snapshot]);
  const marketMetrics = useMemo(() => buildMarketMetrics(marcheSaved),         [marcheSaved]);

  const Section = ({
    title, icon: Icon, items, emptyMsg, iconCls, itemCls, ItemIcon,
  }: {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    items: string[];
    emptyMsg: string;
    iconCls: string;
    itemCls: string;
    ItemIcon: React.ComponentType<{ className?: string }>;
  }) => (
    <div className="rounded-xl bg-gray-50 ring-1 ring-gray-200 overflow-hidden print:bg-white print:ring-gray-300">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <Icon className={["h-4 w-4", iconCls].join(" ")} />
        <span className="text-sm font-semibold text-gray-700">{title}</span>
        {items.length > 0 && (
          <span className="ml-auto text-[11px] font-semibold text-gray-500">{items.length}</span>
        )}
      </div>
      {items.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-2 px-4 py-2.5">
              <ItemIcon className={["h-3.5 w-3.5 mt-0.5 shrink-0", itemCls].join(" ")} />
              <span className="text-sm text-gray-700">{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-3 text-sm text-gray-500">{emptyMsg}</div>
      )}
    </div>
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 print:shadow-none print:border-gray-300">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900 print:text-black">Risques synthétiques</h3>
        <p className="mt-1 text-sm text-gray-500 print:text-gray-700">
          Synthèse des points favorables, vigilances et kill switches.
        </p>
      </div>

      {/* Métriques marché (V6) — affichées uniquement si disponibles */}
      {marketMetrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {marketMetrics.map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-xl border border-gray-200 bg-white p-3 flex flex-col gap-1.5 print:border-gray-300">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
                <Icon className="h-3.5 w-3.5 text-gray-400" />
              </div>
              <span className="text-lg font-bold text-gray-800 leading-none">{Math.round(value)}<span className="text-xs font-medium text-gray-400">/100</span></span>
              <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500/75 via-fuchsia-500/65 to-amber-500/60 transition-all duration-500 print:bg-gray-900"
                  style={{ width: `${value}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <Section
          title="Points favorables" icon={CheckCircle2}
          items={feuxVerts} emptyMsg="Disponible après analyse SmartScore."
          iconCls="text-emerald-500" itemCls="text-emerald-500" ItemIcon={CheckCircle2}
        />
        <Section
          title="Points de vigilance" icon={AlertTriangle}
          items={vigilances} emptyMsg="Disponible après analyse Géorisques et marché."
          iconCls="text-amber-500" itemCls="text-amber-500" ItemIcon={AlertTriangle}
        />
      </div>
      <Section
        title="Kill Switches" icon={ShieldAlert}
        items={killSwitches} emptyMsg="Aucun kill switch détecté — analyse des risques non lancée."
        iconCls={killSwitches.length > 0 ? "text-rose-500" : "text-gray-400"}
        itemCls="text-rose-500" ItemIcon={XCircle}
      />
    </div>
  );
}

// ─── Structure investmentPackData (V6 — prête pour l'onglet Exports) ──────────

interface InvestmentPackData {
  generatedAt: string;
  ficheDeal: {
    typeOperation: string | null;
    adresse:       string | null;
    surfaceM2:     number | null;
    prixAchat:     number | null;
    strategy:      string | null;
    dureeMois:     number | null;
    regimeFiscal:  string | null;
  };
  hypotheses: {
    prixAchat:        number | null;
    fraisNotairePct:  number | null;
    fraisDivers:      number | null;
    budgetTravaux:    number | null;
    prixReventeCible: number | null;
    dureeMois:        number | null;
    apport:           number | null;
  };
  rentabilite: {
    margeBrute:      number | null;
    margePct:        number | null;
    triPct:          number | null;
    roiPct:          number | null;
    coutTotal:       number | null;
    cashflowMensuel: number | null;
    decision:        string | null;
  };
  comparablesDvf: NormalizedComp[];
  syntheseDvf: DvfSynthese;
  smartScore: {
    global: number | null;
    grade:  string | null;
    criteria: RatingCriterion[];
  };
  risques: {
    feuxVerts:    string[];
    vigilances:   string[];
    killSwitches: string[];
    market:       MarketMetric[];
  };
  carte: {
    lat: number | null;
    lng: number | null;
  };
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function InvestmentPackTab() {
  const tick = useMarchandSnapshotTick();

  const { deal, rentaSaved, marcheSaved } = useMemo(() => {
    const snap       = readMarchandSnapshot();
    const activeDeal = ensureActiveDeal();
    const id         = activeDeal?.id ?? null;
    return {
      deal:        activeDeal,
      rentaSaved:  id ? snap.rentabiliteByDeal[id]   : undefined,
      marcheSaved: id ? snap.marcheRisquesByDeal[id] : undefined,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // ── Raw inputs depuis le store (V5 — INCHANGÉ) ─────────────────────────────
  const rawInputs = useMemo(() => extractRawInputs(rentaSaved), [rentaSaved]);

  // ── RentabiliteInput normalisé (V5 — INCHANGÉ) ─────────────────────────────
  const inputs = useMemo((): RentabiliteInput | null => {
    if (!rawInputs) return null;
    return {
      strategy:              (rawInputs.strategy as "revente" | "location") ?? "revente",
      prixAchat:             deal?.prixAchat ?? rawInputs.prixAchat ?? 0,
      fraisNotairePct:       (rawInputs.fraisNotairePct as number) ?? 0,
      budgetTravaux:         rawInputs.travauxUtilises ?? rawInputs.travauxEstimes ?? 0,
      fraisDivers:           (rawInputs.fraisDivers as number) ?? 0,
      dureeMois:             rawInputs.dureeMois            ?? 24,
      surface:               deal?.surfaceM2 ?? (rawInputs.surfaceM2 as number) ?? 0,
      prixReventeCible:      deal?.prixReventeCible ?? rawInputs.prixReventeCible ?? rawInputs.prixReventeEstime ?? 0,
      loyerMensuel:          rawInputs.loyerMensuel         ?? 0,
      chargesMensuelles:     rawInputs.chargesMensuelles    ?? 0,
      taxeFoncieresAnnuelle: 0,
      tmiPct:                rawInputs.tmiPct               ?? 30,
      taxFlatPct:            rawInputs.pfuPct               ?? 30,
      useFlatTax:            rawInputs.fiscalMode === "pfu",
      apport:                rawInputs.apportPersonnel      ?? 0,
    };
  }, [rawInputs, deal]);

  // ── Données financières de base (V5 — INCHANGÉ) ────────────────────────────
  const financials = useMemo((): ScenarioFinancials | null => {
    if (!rawInputs) return null;

    const prixAchat       = deal?.prixAchat ?? rawInputs.prixAchat ?? 0;
    const fraisNotairePct = (rawInputs.fraisNotairePct as number) ?? 8;
    const fraisNotaire    = prixAchat * (fraisNotairePct / 100);
    const fraisDivers     = (rawInputs.fraisDivers as number) ?? 0;
    const travauxBase     = rawInputs.travauxUtilises ?? rawInputs.travauxEstimes ?? 0;
    const dureeMois       = (rawInputs.dureeMois as number) ?? 24;
    const dureeAnnees     = Math.max(0.5, dureeMois / 12);
    const apport          = rawInputs.apportPersonnel ?? 0;
    const reventeBase     = deal?.prixReventeCible ?? rawInputs.prixReventeCible ?? rawInputs.prixReventeEstime ?? prixAchat;
    const strategy        = (rawInputs.strategy as string) ?? "revente";

    const montantPret     = (rawInputs.montantPret as number) ?? 0;
    const tauxNominal     = (rawInputs.tauxNominalAnnuelPct as number) ?? 3.5;
    const tauxAssurance   = (rawInputs.tauxAssuranceAnnuelPct as number) ?? 0.34;
    const interets        = montantPret > 0 ? montantPret * (tauxNominal / 100)   * (dureeMois / 12) : 0;
    const assurance       = montantPret > 0 ? montantPret * (tauxAssurance / 100) * (dureeMois / 12) : 0;
    const fraisBancaires  = ((rawInputs.fraisDossierEur as number) ?? 0)
                          + ((rawInputs.fraisGarantieEur as number) ?? 0)
                          + ((rawInputs.fraisCourtierEur as number) ?? 0);
    const fraisFinanciers = interets + assurance + fraisBancaires;

    const cashflow = strategy === "location"
      ? (rawInputs.loyerMensuel ?? 0) - (rawInputs.chargesMensuelles ?? 0)
      : 0;

    return { prixAchat, fraisNotaire, fraisDivers, travauxBase, fraisFinanciers, reventeBase, apport, dureeAnnees, cashflow };
  }, [rawInputs, deal]);

  // ── Snapshot reconstruit localement (V5 — INCHANGÉ) ────────────────────────
  const snapshot = useMemo((): RentabiliteSnapshot | null => {
    if (!inputs || !financials) return null;
    return {
      input: inputs,
      scenarios: {
        pessimiste: computeLocalScenario(financials, 0.95, 1.10),
        base:       computeLocalScenario(financials, 1.00, 1.00),
        optimiste:  computeLocalScenario(financials, 1.03, 0.95),
      },
      stressTests: {
        reventeMoins5: computeLocalScenario(financials, 0.95, 1.00),
        travauxPlus10: computeLocalScenario(financials, 1.00, 1.10),
      },
      updatedAt: new Date().toISOString(),
    } as RentabiliteSnapshot;
  }, [inputs, financials]);

  // ── Coordonnées du bien — depuis les données (V6) ──────────────────────────
  const rawCoords = useMemo(() => {
    const fromDeal = readCoords(deal as unknown as Record<string, unknown>);
    if (fromDeal.lat != null && fromDeal.lng != null) return fromDeal;
    return readCoords((marcheSaved?.data as Record<string, unknown>) ?? null);
  }, [deal, marcheSaved]);

  // ── Géocodage de secours via la Base Adresse Nationale (V6) ────────────────
  const adresseComplete = useMemo(
    () => (deal ? [deal.address, deal.zipCode, deal.city].filter(Boolean).join(", ") : ""),
    [deal],
  );
  const adresseFallback = useMemo(
    () => (deal ? [deal.zipCode, deal.city].filter(Boolean).join(" ") : ""),
    [deal],
  );
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "ok" | "failed">("idle");

  useEffect(() => {
    if (rawCoords.lat != null && rawCoords.lng != null) { setGeo(null); setGeoStatus("idle"); return; }
    if (!adresseComplete) { setGeo(null); setGeoStatus("idle"); return; }
    let cancelled = false;
    setGeoStatus("loading");
    (async () => {
      let r = await geocodeBan(adresseComplete);
      if (!r && adresseFallback) r = await geocodeBan(adresseFallback);
      if (cancelled) return;
      if (r) { setGeo(r); setGeoStatus("ok"); }
      else { setGeo(null); setGeoStatus("failed"); }
    })();
    return () => { cancelled = true; };
    // deps primitives : évite les ré-exécutions dues à l'identité des objets
  }, [rawCoords.lat, rawCoords.lng, adresseComplete, adresseFallback]);

  const coords = useMemo(
    (): { lat?: number; lng?: number } =>
      rawCoords.lat != null && rawCoords.lng != null ? rawCoords : (geo ?? {}),
    [rawCoords, geo],
  );

  // ── Comparables DVF normalisés (V6) ────────────────────────────────────────
  const comps = useMemo((): NormalizedComp[] => {
    let raws = findCompsArray(
      marcheSaved?.data as Record<string, unknown> | undefined,
      marcheSaved as unknown as Record<string, unknown> | undefined,
    );
    // Repli : scan récursif de tout l'objet marcheSaved si rien trouvé par clé.
    if (!raws.length) raws = deepFindComps(marcheSaved);
    const normalized = raws.map((r) => normalizeComp(r, coords.lat, coords.lng));
    return normalized.sort(sortComps).slice(0, 10);
  }, [marcheSaved, coords]);

  // ── Synthèse DVF (V6) ──────────────────────────────────────────────────────
  const dvfSynthese = useMemo((): DvfSynthese => {
    const medianeM2 = median(comps.map((c) => c.prixM2).filter((n): n is number => n != null));
    const revente   = deal?.prixReventeCible ?? inputs?.prixReventeCible ?? 0;
    const surface   = deal?.surfaceM2 ?? inputs?.surface ?? 0;
    const projetM2  = revente > 0 && surface > 0 ? revente / surface : null;
    const ecartPct  = medianeM2 != null && projetM2 != null ? ((projetM2 - medianeM2) / medianeM2) * 100 : null;
    const { verdict, tone } = buildDvfVerdict(ecartPct);
    return { medianeM2, projetM2, ecartPct, verdict, tone };
  }, [comps, deal, inputs]);

  // ── Investment Rating (V6) ─────────────────────────────────────────────────
  const rating = useMemo(() => computeRating(snapshot, marcheSaved), [snapshot, marcheSaved]);

  // ── Structure pour l'export PDF (V6 — prête, non implémentée) ──────────────
  const investmentPackData = useMemo((): InvestmentPackData => {
    const base = snapshot?.scenarios?.base ?? null;
    const adresse = deal ? [deal.address, deal.zipCode, deal.city].filter(Boolean).join(", ") : null;
    const typeOp  = inputs?.strategy === "revente" ? "Marchand de bien / Revente"
      : inputs?.strategy === "location" ? "Investissement locatif" : null;

    return {
      generatedAt: new Date().toISOString(),
      ficheDeal: {
        typeOperation: typeOp,
        adresse,
        surfaceM2:     deal?.surfaceM2 ?? inputs?.surface ?? null,
        prixAchat:     deal?.prixAchat ?? inputs?.prixAchat ?? null,
        strategy:      inputs?.strategy ?? null,
        dureeMois:     inputs?.dureeMois ?? null,
        regimeFiscal:  inputs?.useFlatTax ? "Flat tax 30 %" : inputs?.tmiPct != null ? `TMI ${inputs.tmiPct} %` : null,
      },
      hypotheses: {
        prixAchat:        deal?.prixAchat ?? inputs?.prixAchat ?? null,
        fraisNotairePct:  inputs?.fraisNotairePct ?? null,
        fraisDivers:      inputs?.fraisDivers ?? null,
        budgetTravaux:    inputs?.budgetTravaux ?? null,
        prixReventeCible: deal?.prixReventeCible ?? inputs?.prixReventeCible ?? null,
        dureeMois:        inputs?.dureeMois ?? null,
        apport:           inputs?.apport ?? null,
      },
      rentabilite: {
        margeBrute:      base?.margeBrute ?? null,
        margePct:        base?.margePct ?? null,
        triPct:          base?.triPct ?? null,
        roiPct:          base?.roiPct ?? null,
        coutTotal:       base?.coutTotal ?? null,
        cashflowMensuel: base?.cashflowMensuel ?? null,
        decision:        base?.decision ?? null,
      },
      comparablesDvf: comps,
      syntheseDvf:    dvfSynthese,
      smartScore: {
        global:   rating.global,
        grade:    rating.grade,
        criteria: rating.criteria,
      },
      risques: {
        feuxVerts:    buildFeuxVerts(snapshot, marcheSaved),
        vigilances:   buildVigilances(snapshot, marcheSaved),
        killSwitches: buildKillSwitches(snapshot),
        market:       buildMarketMetrics(marcheSaved),
      },
      carte: {
        lat: coords.lat ?? null,
        lng: coords.lng ?? null,
      },
    };
  }, [snapshot, deal, inputs, comps, dvfSynthese, rating, marcheSaved, coords]);

  // Handoff temporaire vers l'onglet Exports — à remplacer par ton canal de
  // persistance réel (ex. writeMarchandSnapshot / store dédié) une fois câblé.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__mimmozaInvestmentPack = investmentPackData;
  }, [investmentPackData]);

  return (
    <div className="space-y-5">
      <FicheDeal             deal={deal}         inputs={inputs}   />
      <HypothesesFinancieres deal={deal}         inputs={inputs}   />
      <TableauRentabilite    snapshot={snapshot}                   />
      <InvestmentRating      rating={rating}                       />
      <ComparablesDVF        comps={comps}                         />
      <SyntheseDVF           synthese={dvfSynthese}                />
      <CarteLocalisation     deal={deal} lat={coords.lat} lng={coords.lng} geoStatus={geoStatus} />
      <RisquesSynthetiques   snapshot={snapshot} marcheSaved={marcheSaved} />
    </div>
  );
}