// src/spaces/investisseur/pages/deal-center/exports/exportDataConfidence.ts
//
// Export PDF – Rapport Data Confidence  v5.0
// Format  : A4 Portrait – UNE SEULE PAGE – Mockup fidèle
// Style   : Stripe · Linear · Pitchbook · Palantir
// Header  : BLANC avec courbes abstraites violet/bleu
// Score   : carte violette dominante (gradient violet → bleu)
// Logique : 100% inchangée

import { jsPDF } from "jspdf";

import logoMimmozaUrl from "@/assets/logo-mimmoza-baseline.png";
import { loadImageDataUrl } from "@/spaces/shared/loadImageDataUrl";

import {
  ensureActiveDeal,
  readMarchandSnapshot,
} from "../../../../marchand/shared/marchandSnapshot.store";

// ─── Palette ──────────────────────────────────────────────────────────────────

type RGB = [number, number, number];

const C: Record<string, RGB> = {
  // Indigo / violet
  indigo900:   [49,  46, 129],
  indigo700:   [67,  56, 202],
  indigo600:   [79,  70, 229],
  indigo500:   [99,  102,241],
  violet600:   [124,  58, 237],
  violet400:   [167, 139, 250],
  violet100:   [237, 233, 254],
  violet50:    [245, 243, 255],
  // Blue
  blue600:     [37,   99, 235],
  blue400:     [96,  165, 250],
  blue50:      [239, 246, 255],
  // Slate (fond blanc, textes)
  white:       [255, 255, 255],
  slate50:     [248, 250, 252],
  slate100:    [241, 245, 249],
  slate200:    [226, 232, 240],
  slate300:    [203, 213, 225],
  slate400:    [148, 163, 184],
  slate500:    [100, 116, 139],
  slate600:    [71,   85, 105],
  slate700:    [51,   65,  85],
  slate800:    [30,   41,  59],
  slate900:    [15,   23,  42],
  // Sémantique
  green600:    [22,  163,  74],
  green500:    [34,  197,  94],
  green100:    [220, 252, 231],
  green50:     [240, 253, 244],
  amber600:    [217, 119,   6],
  amber400:    [251, 191,  36],
  amber100:    [254, 243, 199],
  amber50:     [255, 251, 235],
  red600:      [220,  38,  38],
  red400:      [248, 113, 113],
  red100:      [254, 226, 226],
  red50:       [255, 241, 242],
};

// ─── Types & logique métier (100% inchangés) ──────────────────────────────────

interface DataSource {
  nom:     string;
  pilier:  "Deal" | "Marche" | "Risques" | "Rentabilite" | "SmartScore";
  statut:  "disponible" | "partiel" | "manquant";
  impact:  "critique" | "majeur" | "mineur";
  valeur?: string;
}

function evalStatut(val: unknown): DataSource["statut"] {
  if (val == null || val === "" || val === 0) return "manquant";
  if (typeof val === "object" && Object.keys(val as object).length === 0) return "manquant";
  return "disponible";
}

function extractSources(
  snap: ReturnType<typeof readMarchandSnapshot>,
  id:   string | null,
): DataSource[] {
  const deal       = snap.dealsById?.[id ?? ""] ?? (snap as any).activeDeal;
  const renta      = id ? snap.rentabiliteByDeal[id]?.computed : undefined;
  const marche     = id ? (snap.marcheRisquesByDeal[id]?.data as any) : undefined;
  const smartScore = (snap as any).smartScoreByDeal?.[id ?? ""];

  return [
    { nom: "Prix d'acquisition",    pilier: "Deal",        impact: "critique", statut: evalStatut(deal?.prixAchat),    valeur: deal?.prixAchat    ? `${fmtN(deal.prixAchat as number)} EUR` : undefined },
    { nom: "Surface habitable",     pilier: "Deal",        impact: "critique", statut: evalStatut(deal?.surface),      valeur: deal?.surface      ? `${deal.surface} m2` : undefined },
    { nom: "Loyer mensuel",         pilier: "Deal",        impact: "critique", statut: evalStatut(deal?.loyerMensuel), valeur: deal?.loyerMensuel ? `${deal.loyerMensuel} EUR/mois` : undefined },
    { nom: "Adresse complete",      pilier: "Deal",        impact: "majeur",   statut: evalStatut(deal?.address),      valeur: deal?.address },
    { nom: "DPE",                   pilier: "Deal",        impact: "mineur",   statut: evalStatut(deal?.dpe),          valeur: deal?.dpe },
    { nom: "Comparables DVF",       pilier: "Marche",      impact: "majeur",   statut: evalStatut(marche?.dvf?.comparables?.length), valeur: marche?.dvf?.comparables?.length ? `${marche.dvf.comparables.length} tx` : undefined },
    { nom: "Prix median DVF",       pilier: "Marche",      impact: "majeur",   statut: evalStatut(marche?.dvf?.medianeM2),            valeur: marche?.dvf?.medianeM2 ? `${fmtN(marche.dvf.medianeM2 as number)} EUR/m2` : undefined },
    { nom: "Loyer median INSEE",    pilier: "Marche",      impact: "mineur",   statut: evalStatut(marche?.loyerMedian),               valeur: marche?.loyerMedian ? `${marche.loyerMedian} EUR/m2` : undefined },
    { nom: "Georisques inondation", pilier: "Risques",     impact: "majeur",   statut: evalStatut(marche?.risques?.inondation) },
    { nom: "Georisques seisme",     pilier: "Risques",     impact: "mineur",   statut: evalStatut(marche?.risques?.seisme) },
    { nom: "Georisques argile",     pilier: "Risques",     impact: "mineur",   statut: evalStatut(marche?.risques?.retrait) },
    { nom: "Scenario de base",      pilier: "Rentabilite", impact: "critique", statut: evalStatut((renta as any)?.scenarios?.base) },
    { nom: "Analyse de sensibilite",pilier: "Rentabilite", impact: "majeur",   statut: evalStatut((renta as any)?.sensibilite) },
    { nom: "SmartScore global",     pilier: "SmartScore",  impact: "majeur",   statut: evalStatut(smartScore?.score),    valeur: smartScore?.score != null ? `${smartScore.score}/100` : undefined },
    { nom: "Pilier localisation",   pilier: "SmartScore",  impact: "mineur",   statut: evalStatut(smartScore?.pillars?.localisation) },
    { nom: "Pilier services",       pilier: "SmartScore",  impact: "mineur",   statut: evalStatut(smartScore?.pillars?.services) },
    { nom: "Pilier marche",         pilier: "SmartScore",  impact: "mineur",   statut: evalStatut(smartScore?.pillars?.marche) },
    { nom: "Pilier risques",        pilier: "SmartScore",  impact: "mineur",   statut: evalStatut(smartScore?.pillars?.risques) },
  ];
}

function calcCompletude(sources: DataSource[]): number {
  const w = { critique: 3, majeur: 2, mineur: 1 } as const;
  let total = 0, got = 0;
  for (const s of sources) {
    total += w[s.impact];
    if (s.statut === "disponible")   got += w[s.impact];
    else if (s.statut === "partiel") got += w[s.impact] * 0.5;
  }
  return total > 0 ? Math.round((got / total) * 100) : 0;
}

function pilierCompletude(sources: DataSource[], pilier: string): number {
  return calcCompletude(sources.filter((s) => s.pilier === pilier));
}

function scoreColor(v: number): RGB {
  if (v >= 70) return C.green600;
  if (v >= 40) return C.amber600;
  return C.red600;
}

function scoreColorLight(v: number): RGB {
  if (v >= 70) return C.green500;
  if (v >= 40) return C.amber400;
  return C.red400;
}

function scoreBg(v: number): RGB {
  if (v >= 70) return C.green50;
  if (v >= 40) return C.amber50;
  return C.red50;
}

function scoreLabel(v: number): string {
  if (v >= 80) return "Excellent";
  if (v >= 60) return "Bon";
  if (v >= 40) return "Moyen";
  return "Faible";
}

function impactConfig(impact: DataSource["impact"]): { bg: RGB; text: RGB; border: RGB; label: string; dot: RGB } {
  if (impact === "critique") return { bg: C.red100,   text: C.red600,   border: C.red400,   dot: C.red600,   label: "CRITIQUE" };
  if (impact === "majeur")   return { bg: C.amber100, text: C.amber600, border: C.amber400, dot: C.amber600, label: "MAJEUR"   };
  return                            { bg: C.slate100, text: C.slate600, border: C.slate300, dot: C.slate400, label: "MINEUR"   };
}

// ─── Layout ───────────────────────────────────────────────────────────────────

const PW = 210;
const PH = 297;
const ML = 12;    // marge gauche
const MR = 12;    // marge droite
const CW = PW - ML - MR;  // 186 mm

function today(): string {
  return new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

/** Formatage nombre avec espaces ASCII — évite \u202F de toLocaleString("fr-FR") */
function fmtN(n: number): string {
  const parts = Math.round(n).toString().split("");
  const out: string[] = [];
  parts.reverse().forEach((ch, i) => {
    if (i > 0 && i % 3 === 0) out.push(" ");
    out.push(ch);
  });
  return out.reverse().join("");
}

// ─── Primitives graphiques ────────────────────────────────────────────────────

/** Dégradé horizontal simulé par bandes fines */
function hGrad(
  doc:    jsPDF,
  x: number, y: number, w: number, h: number,
  cL: RGB, cR: RGB,
  steps = 50,
  borderRadius = 0,
) {
  const sw = w / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    doc.setFillColor(
      Math.round(cL[0] + (cR[0] - cL[0]) * t),
      Math.round(cL[1] + (cR[1] - cL[1]) * t),
      Math.round(cL[2] + (cR[2] - cL[2]) * t),
    );
    if (borderRadius > 0 && (i === 0 || i === steps - 1)) {
      // coins arrondis : approximation rectangulaire aux extrêmes
      doc.roundedRect(x + i * sw, y, sw + 0.5, h, borderRadius, borderRadius, "F");
    } else {
      doc.rect(x + i * sw, y, sw + 0.5, h, "F");
    }
  }
}

/** Carte blanche avec ombre douce multi-couche */
function floatCard(
  doc:    jsPDF,
  x: number, y: number, w: number, h: number,
  r = 5,
  fill: RGB = C.white,
  borderColor?: RGB,
) {
  // Ombres
  const shadows = [
    { dy: 0.6, op: 0.055, inflate: 0.3 },
    { dy: 1.2, op: 0.04,  inflate: 0.6 },
    { dy: 2.0, op: 0.025, inflate: 0.9 },
  ];
  for (const s of shadows) {
    doc.setGState(doc.GState({ opacity: s.op }));
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(x - s.inflate, y + s.dy, w + s.inflate * 2, h, r, r, "F");
  }
  doc.setGState(doc.GState({ opacity: 1 }));

  // Fond
  doc.setFillColor(...fill);
  if (borderColor) {
    doc.setDrawColor(...borderColor);
    doc.setLineWidth(0.22);
    doc.roundedRect(x, y, w, h, r, r, "FD");
  } else {
    doc.roundedRect(x, y, w, h, r, r, "F");
  }
}

/** Arc de jauge circulaire avec halo */
function arcGauge(
  doc:     jsPDF,
  cx: number, cy: number, r: number,
  value:   number,
  col:     RGB,
  colL:    RGB,
  trackW  = 2.5,
  arcW    = 3.2,
  haloOp  = 0.14,
) {
  // Halo
  doc.setGState(doc.GState({ opacity: haloOp }));
  doc.setFillColor(...col);
  doc.circle(cx, cy, r + 3, "F");
  doc.setGState(doc.GState({ opacity: haloOp * 0.5 }));
  doc.circle(cx, cy, r + 5.5, "F");
  doc.setGState(doc.GState({ opacity: 1 }));

  // Track
  doc.setDrawColor(...C.slate200);
  doc.setLineWidth(trackW);
  doc.circle(cx, cy, r, "S");

  const segs  = 80;
  const angle = (value / 100) * Math.PI * 2;
  const start = -Math.PI / 2;

  // Arc clair (halo)
  doc.setDrawColor(...colL);
  doc.setLineWidth(arcW + 1.2);
  doc.setGState(doc.GState({ opacity: 0.35 }));
  for (let i = 0; i < segs; i++) {
    const a0 = start + (i / segs) * Math.PI * 2;
    if (a0 - start > angle) break;
    const a1 = start + ((i + 1) / segs) * Math.PI * 2;
    doc.line(cx + r * Math.cos(a0), cy + r * Math.sin(a0),
             cx + r * Math.cos(a1), cy + r * Math.sin(a1));
  }
  doc.setGState(doc.GState({ opacity: 1 }));

  // Arc principal
  doc.setDrawColor(...col);
  doc.setLineWidth(arcW);
  for (let i = 0; i < segs; i++) {
    const a0 = start + (i / segs) * Math.PI * 2;
    if (a0 - start > angle) break;
    const a1 = start + ((i + 1) / segs) * Math.PI * 2;
    doc.line(cx + r * Math.cos(a0), cy + r * Math.sin(a0),
             cx + r * Math.cos(a1), cy + r * Math.sin(a1));
  }
}

/** Pill (badge) */
function pill(
  doc:  jsPDF,
  x: number, y: number, w: number, h: number,
  text: string, bg: RGB, fg: RGB, border: RGB,
) {
  doc.setFillColor(...bg);
  doc.setDrawColor(...border);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, h, h / 2, h / 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  doc.setTextColor(...fg);
  doc.text(text, x + w / 2, y + h - 1.0, { align: "center" });
}

/** Titre de section institutionnel — lignes grises de chaque côté */
function sectionHead(doc: jsPDF, text: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...C.slate600);

  const tw  = doc.getTextWidth(text);
  const cx  = PW / 2;
  const ty  = y + 5;
  const lineY = ty - 2;
  const GAP = 5;  // espace entre ligne et texte

  // Ligne gauche
  doc.setDrawColor(...C.slate200);
  doc.setLineWidth(0.3);
  doc.line(ML, lineY, cx - tw / 2 - GAP, lineY);

  // Titre centré
  doc.text(text, cx, ty, { align: "center" });

  // Ligne droite
  doc.line(cx + tw / 2 + GAP, lineY, ML + CW, lineY);

  return y + 12;
}

/** Barre horizontale style Stripe/Linear */
function hBar(
  doc:   jsPDF,
  x: number, y: number, w: number, h: number,
  value: number, col: RGB, colL: RGB, label: string,
) {
  // Label gauche
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...C.slate500);
  doc.text(label, x - 3, y + h * 0.75, { align: "right" });

  // Track
  doc.setFillColor(...C.slate100);
  doc.roundedRect(x, y, w, h, h / 2, h / 2, "F");

  // Fill — couche lumineuse
  const fw = Math.max(h, (value / 100) * w);
  doc.setGState(doc.GState({ opacity: 0.38 }));
  doc.setFillColor(...colL);
  doc.roundedRect(x, y, fw, h, h / 2, h / 2, "F");
  doc.setGState(doc.GState({ opacity: 1 }));

  // Fill — couleur principale
  doc.setFillColor(...col);
  doc.roundedRect(x, y, fw * 0.78, h, h / 2, h / 2, "F");

  // Pourcentage droite
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...col);
  doc.text(`${value}%`, x + w + 4, y + h * 0.78);
}

// ─── Génération PDF ───────────────────────────────────────────────────────────

export async function exportDataConfidencePdf(): Promise<void> {

  // ── Données (100% inchangées) ────────────────────────────────────
  const snap = readMarchandSnapshot();
  const deal = ensureActiveDeal();
  const id   = deal?.id ?? null;

  const dealName = deal?.title
    ?? (deal?.address ? deal.address.split(",")[0].trim() : null)
    ?? "Deal sans nom";

  const sources        = extractSources(snap, id);
  const completude     = calcCompletude(sources);
  const dispCount      = sources.filter((s) => s.statut === "disponible").length;
  const manqCount      = sources.filter((s) => s.statut === "manquant").length;
  const critManq       = sources.filter((s) => s.statut === "manquant" && s.impact === "critique");
  const scoreFiabilite = Math.min(100, Math.round(completude * 1.01));
  const potentiel      = Math.min(100, completude + Math.round(manqCount * 1.8));

  const PILIERS: Array<{ key: DataSource["pilier"]; label: string }> = [
    { key: "Deal",        label: "Deal" },
    { key: "Marche",      label: "Marche" },
    { key: "Risques",     label: "Risques" },
    { key: "Rentabilite", label: "Rentab." },
    { key: "SmartScore",  label: "Smart\u00B7Score" },
  ];

  const critiquesDisplayed = sources.filter((s) => s.statut === "manquant").slice(0, 4);

  const moteurs = [
    { label: "SmartScore",           value: completude >= 60 ? 85 : completude >= 40 ? 55 : 30 },
    { label: "Rentabilite",          value: completude >= 70 ? 80 : completude >= 40 ? 50 : 25 },
    { label: "Valeur marche",        value: completude >= 50 ? 70 : 40 },
    { label: "Bilan promoteur",      value: completude >= 60 ? 65 : 35 },
    { label: "Analyse scenarios",    value: completude >= 70 ? 75 : completude >= 40 ? 45 : 20 },
  ];

  // ── Init ─────────────────────────────────────────────────────────
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  let logoDataUrl: string | null = null;
  try {
    const logo = await loadImageDataUrl(logoMimmozaUrl);
    logoDataUrl = logo.dataUrl;
  } catch (e) {
    console.warn("[DataConfidencePDF] logo non charge", e);
  }

  // ════════════════════════════════════════════════════════════════
  // 1. FOND PAGE — blanc avec décoration abstraite Stripe style
  // ════════════════════════════════════════════════════════════════

  // Fond blanc pur
  doc.setFillColor(...C.white);
  doc.rect(0, 0, PW, PH, "F");

  // ════════════════════════════════════════════════════════════════
  // 2. HEADER — fond blanc, logo gauche, titre centre, date droite
  // ════════════════════════════════════════════════════════════════

  const HDR_H = 30;

  // Logo
  const LOGO_Y = 6;
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, "PNG", ML, LOGO_Y, 32, 11);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...C.indigo700);
    doc.text("MIMMOZA", ML, LOGO_Y + 8);
  }

  // Titre centré
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...C.slate900);
  doc.text("RAPPORT DATA CONFIDENCE", PW / 2, LOGO_Y + 8, { align: "center" });

  // Sous-titre
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.slate500);
  doc.text(
    "Matrice de fiabilite  \u2022  Sources  \u2022  Impact SmartScore",
    PW / 2, LOGO_Y + 13.5, { align: "center" },
  );

  // Deal name
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...C.slate400);
  doc.text(dealName, PW - MR, LOGO_Y + 6, { align: "right" });

  // Date dans capsule arrondie
  const dateStr = today();
  doc.setFontSize(6.5);
  const dw = doc.getTextWidth(dateStr) + 7;
  const dh = 6;
  const dx = PW - MR - dw;
  const dy = LOGO_Y + 9;
  doc.setFillColor(...C.violet50);
  doc.setDrawColor(...C.violet400);
  doc.setLineWidth(0.3);
  doc.roundedRect(dx, dy, dw, dh, dh / 2, dh / 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...C.violet600);
  doc.text(dateStr, dx + dw / 2, dy + dh - 1.5, { align: "center" });

  // Séparateur bas header — ligne très fine
  doc.setGState(doc.GState({ opacity: 0.18 }));
  doc.setFillColor(...C.slate900);
  doc.rect(ML, HDR_H, CW, 0.25, "F");
  doc.setGState(doc.GState({ opacity: 1 }));

  let y = HDR_H + 7;

  // ════════════════════════════════════════════════════════════════
  // 3. LIGNE KPI — 3 cartes blanches + 1 carte violette dominante
  // ════════════════════════════════════════════════════════════════

  const KPI_H   = 28;    // hauteur uniforme des 4 cartes
  const KPI_GAP = 3;
  // 4 cartes égales qui tiennent exactement dans CW
  const KPI_W3 = (CW - KPI_GAP * 3) / 4;
  const KPI_W4 = KPI_W3;

  const kpis = [
    {
      label: "Indice de completude",
      value: `${completude}%`,
      sub:   "Ponderation par criticite",
      col:   scoreColor(completude),
      colBg: scoreBg(completude),
    },
    {
      label: "Sources connectees",
      value: `${dispCount} / ${sources.length}`,
      sub:   "Disponibles sur total",
      col:   C.blue600,
      colBg: C.blue50,
    },
    {
      label: "Donnees critiques",
      value: `${critManq.length}`,
      sub:   "Champs bloquants",
      col:   critManq.length === 0 ? C.green600 : C.red600,
      colBg: critManq.length === 0 ? C.green50  : C.red50,
    },
  ];

  // — 3 cartes KPI blanches
  kpis.forEach((kpi, i) => {
    const kx = ML + i * (KPI_W3 + KPI_GAP);
    floatCard(doc, kx, y, KPI_W3, KPI_H, 5, C.white, C.slate200);

    // Fond teinté léger en haut de la carte
    doc.setFillColor(...kpi.colBg);
    doc.roundedRect(kx, y, KPI_W3, KPI_H * 0.42, 5, 5, "F");
    doc.setFillColor(...C.white);
    doc.rect(kx, y + KPI_H * 0.32, KPI_W3, KPI_H * 0.12, "F");

    // Label — 4mm de padding haut
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.5);
    doc.setTextColor(...kpi.col);
    doc.text(kpi.label.toUpperCase(), kx + KPI_W3 / 2, y + 5, { align: "center" });

    // Valeur géante — centrée verticalement
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...C.slate900);
    doc.text(kpi.value, kx + KPI_W3 / 2, y + 18, { align: "center" });

    // Sub — 2.5mm de padding bas
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    doc.setTextColor(...C.slate400);
    doc.text(kpi.sub, kx + KPI_W3 / 2, y + KPI_H - 2.5, { align: "center" });
  });

  // — Carte score violette dominante — même style que les 3 autres, valeur texte géante
  const k4x = ML + 3 * (KPI_W3 + KPI_GAP);
  // Ombres
  const scoreCardShadows = [
    { dy: 0.8, op: 0.12 },
    { dy: 1.6, op: 0.07 },
    { dy: 2.8, op: 0.04 },
  ];
  for (const s of scoreCardShadows) {
    doc.setGState(doc.GState({ opacity: s.op }));
    doc.setFillColor(...C.indigo900);
    doc.roundedRect(k4x, y + s.dy, KPI_W4, KPI_H, 5, 5, "F");
  }
  doc.setGState(doc.GState({ opacity: 1 }));
  hGrad(doc, k4x, y, KPI_W4, KPI_H, C.violet600, C.indigo600, 40, 5);

  // Fond teinté haut (plus foncé sur gradient)
  doc.setGState(doc.GState({ opacity: 0.15 }));
  doc.setFillColor(...C.white);
  doc.roundedRect(k4x, y, KPI_W4, KPI_H * 0.42, 5, 5, "F");
  doc.setGState(doc.GState({ opacity: 1 }));

  // Titre — même position que les autres
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  doc.setTextColor(...C.white);
  doc.text("SCORE DE FIABILITE", k4x + KPI_W4 / 2, y + 5, { align: "center" });

  // Valeur géante blanche — même fontSize et position que les autres
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...C.white);
  doc.text(`${scoreFiabilite}`, k4x + KPI_W4 / 2, y + 18, { align: "center" });

  // Sous-label — même position que les autres
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setGState(doc.GState({ opacity: 0.75 }));
  doc.text("Indice global", k4x + KPI_W4 / 2, y + KPI_H - 2.5, { align: "center" });
  doc.setGState(doc.GState({ opacity: 1 }));

  y += KPI_H + 6;

  // ════════════════════════════════════════════════════════════════
  // 4. MATURITÉ DES PILIERS
  // ════════════════════════════════════════════════════════════════

  y = sectionHead(doc, "MATURITE DES PILIERS", y);

  const PIL_H   = 26;
  const PIL_GAP = 3;
  const PIL_W   = (CW - PIL_GAP * 4) / 5;

  PILIERS.forEach((pilier, i) => {
    const pct  = pilierCompletude(sources, pilier.key);
    const col  = scoreColor(pct);
    const colL = scoreColorLight(pct);
    const lbl  = scoreLabel(pct);
    const cfg  = {
      bg:     scoreBg(pct),
      border: pct >= 70 ? C.green500 : pct >= 40 ? C.amber400 : C.red400,
    };
    const px = ML + i * (PIL_W + PIL_GAP);

    floatCard(doc, px, y, PIL_W, PIL_H, 5, C.white, C.slate200);

    // Accent top line colorée
    doc.setFillColor(...col);
    doc.roundedRect(px, y, PIL_W, 2, 2, 2, "F");

    // Jauge circulaire
    const gcx = px + PIL_W / 2;
    const gcy = y + PIL_H * 0.48;
    arcGauge(doc, gcx, gcy, 6, pct, col, colL, 2, 2.5, 0.12);

    // Pct centré
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...col);
    doc.text(`${pct}%`, gcx, gcy + 1.3, { align: "center" });

    // Label pilier
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    doc.setTextColor(...C.slate700);
    doc.text(pilier.label, gcx, y + PIL_H - 7, { align: "center" });

    // Badge statut
    const badgeCfg: Record<string, { bg: RGB; fg: RGB; border: RGB }> = {
      "Excellent": { bg: C.green100, fg: C.green600, border: C.green500 },
      "Bon":       { bg: C.green100, fg: C.green600, border: C.green500 },
      "Moyen":     { bg: C.amber100, fg: C.amber600, border: C.amber400 },
      "Faible":    { bg: C.red100,   fg: C.red600,   border: C.red400   },
    };
    const bc = badgeCfg[lbl] ?? badgeCfg["Moyen"];
    const bw = 22;
    pill(doc, gcx - bw / 2, y + PIL_H - 3.5, bw, 3.5, lbl, bc.bg, bc.fg, bc.border);
  });

  y += PIL_H + 6;

  // ════════════════════════════════════════════════════════════════
  // 5. DONNÉES CRITIQUES MANQUANTES
  // ════════════════════════════════════════════════════════════════

  y = sectionHead(doc, "DONNEES CRITIQUES MANQUANTES", y);

  if (critiquesDisplayed.length === 0) {
    // Carte succès
    floatCard(doc, ML, y, CW, 13, 5, C.green50, C.green500, false);
    doc.setFillColor(...C.green600);
    doc.circle(ML + 9, y + 6.5, 3.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...C.green600);
    doc.text("Toutes les donnees requises sont disponibles.", ML + 15, y + 7.5);
    y += 17;
  } else {
    // Cartes individuelles aérées
    const ITEM_H   = 11;
    const ITEM_GAP = 2;
    const descMap: Record<string, string> = {
      "critique": "Indispensable pour les calculs de rentabilite et le SmartScore",
      "majeur":   "Impact significatif sur la fiabilite de l'analyse",
      "mineur":   "Ameliore la precision sans bloquer l'analyse",
    };

    critiquesDisplayed.forEach((src) => {
      const cfg = impactConfig(src.impact);
      floatCard(doc, ML, y, CW, ITEM_H, 5, C.white, C.slate200);

      // Icône cercle coloré à gauche
      const iconR = 3.5;
      const iconCx = ML + 9;
      const iconCy = y + ITEM_H / 2;

      doc.setGState(doc.GState({ opacity: 0.15 }));
      doc.setFillColor(...cfg.dot);
      doc.circle(iconCx, iconCy, iconR + 1.5, "F");
      doc.setGState(doc.GState({ opacity: 1 }));
      doc.setFillColor(...cfg.bg);
      doc.circle(iconCx, iconCy, iconR, "F");
      doc.setDrawColor(...cfg.border);
      doc.setLineWidth(0.4);
      doc.circle(iconCx, iconCy, iconR, "S");

      // Croix / tiret
      doc.setDrawColor(...cfg.text);
      doc.setLineWidth(0.7);
      doc.line(iconCx - 1.5, iconCy, iconCx + 1.5, iconCy);
      if (src.impact === "critique") {
        doc.line(iconCx, iconCy - 1.5, iconCx, iconCy + 1.5);
      }

      // Nom de la donnée
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...C.slate900);
      doc.text(src.nom, ML + 17, y + 5.5);

      // Description
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(...C.slate500);
      doc.text(descMap[src.impact] ?? "", ML + 17, y + ITEM_H - 3.5, { maxWidth: CW * 0.6 });

      // Badge impact — droite
      const bw = src.impact === "critique" ? 26 : src.impact === "majeur" ? 22 : 20;
      const bh = 5.5;
      pill(doc, ML + CW - bw - 3, y + ITEM_H / 2 - bh / 2, bw, bh,
        cfg.label, cfg.bg, cfg.text, cfg.border);

      y += ITEM_H + ITEM_GAP;
    });
    y += 1;
  }

  // ════════════════════════════════════════════════════════════════
  // 6. IMPACT SUR LES MOTEURS D'ANALYSE
  // ════════════════════════════════════════════════════════════════

  y = sectionHead(doc, "IMPACT SUR LES MOTEURS D'ANALYSE", y);

  const MOT_CARD_H = moteurs.length * 8 + 5;
  floatCard(doc, ML, y, CW, MOT_CARD_H, 5, C.white, C.slate200);

  const BAR_X = ML + 44;
  const BAR_W = CW - 44 - 16;
  const BAR_H = 3.5;

  moteurs.forEach((m, i) => {
    const my = y + 4 + i * 8;
    hBar(doc, BAR_X, my, BAR_W, BAR_H, m.value,
      scoreColor(m.value), scoreColorLight(m.value), m.label);
  });

  y += MOT_CARD_H + 6;

  // ════════════════════════════════════════════════════════════════
  // 7. RECOMMANDATION IA — carte pleine largeur, 2 colonnes
  // ════════════════════════════════════════════════════════════════

  const REC_H  = 26;
  const LEFT_W = CW * 0.60;

  // Fond violet très clair, coins 24 px (≈ 6.35 mm en PDF-mm à 96dpi ≈ 6 mm)
  const recR = 6;
  floatCard(doc, ML, y, CW, REC_H, recR, C.violet50, C.violet100);

  // — Colonne gauche : icône IA + titre + texte

  // Cercle icône IA (petit, discret)
  const IA_CX = ML + 9;
  const IA_CY = y + 9;
  const IA_R  = 4.5;
  doc.setFillColor(...C.indigo600);
  doc.circle(IA_CX, IA_CY, IA_R, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...C.white);
  doc.text("IA", IA_CX, IA_CY + 1.4, { align: "center" });

  // Titre
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...C.indigo700);
  doc.text("Analyse Copilot Mimmoza", ML + 17, y + 7);

  // Texte analyse
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...C.slate700);
  const recText = `Le niveau actuel de confiance des donnees (${completude}%) est suffisant pour une analyse preliminaire. Certaines donnees critiques doivent etre completees afin de securiser la decision d'investissement.`;
  const recLines = doc.splitTextToSize(recText, LEFT_W - 19);
  doc.text(recLines, ML + 17, y + 12);

  // — Colonne droite : projection
  const projX = ML + LEFT_W;
  const projW = CW - LEFT_W;
  const projCx = projX + projW / 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  doc.setTextColor(...C.slate400);
  doc.text("PROJECTION", projCx, y + 6, { align: "center" });

  if (manqCount > 0) {
    // Score actuel
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(...scoreColor(completude));
    const valActStr = `${completude}`;
    const valActW = doc.getTextWidth(valActStr);
    const valCibStr = `${potentiel}`;
    const valCibW = doc.getTextWidth(valCibStr);

    // Largeur totale : valAct + flèche 12mm + valCib
    const arrowW = 12;
    const totalW = valActW + arrowW + valCibW;
    const startX = projCx - totalW / 2;

    // Score actuel
    doc.text(valActStr, startX, y + 18);

    // Flèche dessinée manuellement (ligne + tête de flèche)
    const ax1 = startX + valActW + 2;
    const ax2 = startX + valActW + arrowW - 2;
    const ay  = y + 15.5;
    doc.setDrawColor(...C.violet400);
    doc.setLineWidth(0.8);
    doc.line(ax1, ay, ax2, ay);
    doc.setFillColor(...C.violet400);
    doc.triangle(ax2, ay, ax2 - 2.5, ay - 1.5, ax2 - 2.5, ay + 1.5, "F");

    // Score cible
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(...C.green600);
    doc.text(valCibStr, startX + valActW + arrowW, y + 18);

    // Sous-labels explicites sur 2 lignes
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    doc.setTextColor(...C.slate500);
    doc.text("Score actuel        Score apres correction", projCx, y + 21, { align: "center" });
    doc.setFontSize(5);
    doc.setTextColor(...C.slate400);
    doc.text("/ 100", projCx, y + 24.5, { align: "center" });
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(...C.green600);
    doc.text(`${completude}/100`, projCx, y + 18, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    doc.setTextColor(...C.green600);
    doc.text("Score complet — aucune correction necessaire", projCx, y + 23, { align: "center" });
  }

  y += REC_H + 5;

  // ════════════════════════════════════════════════════════════════
  // 8. FOOTER — mention légale, lisible, sans logo, sans cadre
  // ════════════════════════════════════════════════════════════════

  const FY = PH - 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...C.slate500);
  doc.text(
    "Document genere par Mimmoza a titre indicatif. Donnees issues de sources publiques et de calculs algorithmiques. Ne constitue pas un conseil financier.",
    PW / 2, FY,
    { align: "center", maxWidth: 165 },
  );

  // ── Save ────────────────────────────────────────────────────────
  const filename = `Mimmoza_DataConfidence_${dealName.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}