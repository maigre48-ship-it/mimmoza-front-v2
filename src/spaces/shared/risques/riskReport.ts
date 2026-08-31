// src/spaces/shared/risques/riskReport.ts
// ============================================================================
// SOCLE PARTAGÉ — RAPPORT PDF DE L'ÉTUDE DE RISQUES          VERSION 1.0.0
// ============================================================================
// Générateur unique, consommé par RisquesPage et InvestisseurRisquesPanel, qui
// composaient chacun leur propre HTML — deux maquettes divergentes pour un même
// document, et deux endroits où corriger la même chose.
//
// Ce document sort de la plateforme : il est lu par un banquier, un notaire, un
// client. Il est donc écrit pour quelqu'un qui n'a pas vu l'écran, ne connaît
// pas les sources, et doit pouvoir juger CE QUE VAUT la note autant que la note
// elle-même. D'où trois partis pris qui gouvernent tout le fichier :
//
//   1. Un score ne se lit pas sans sa couverture. Chaque chiffre est accompagné
//      de l'état de la source qui le produit. Une source muette est nommée comme
//      telle, jamais remplacée par un « 0 » qui se lirait comme une absence de
//      risque. Le tableau « Sources et couverture » rend cet audit vérifiable.
//   2. La portée est écrite noir sur blanc, dès la couverture : l'étude décrit
//      l'exposition d'une COMMUNE et de son environnement, pas d'une parcelle.
//      Un lecteur pressé ne doit pas pouvoir confondre les deux.
//   3. Rien d'essentiel ne dépend de la couleur. Les navigateurs suppriment les
//      fonds à l'impression par défaut ; on force `print-color-adjust: exact`,
//      mais chaque niveau porte aussi son libellé en toutes lettres, pour rester
//      lisible en noir et blanc ou pour un lecteur daltonien.
// ============================================================================

import type { BankRiskScoring } from "@/components/banque/BanqueRiskScoreCard";
import {
  formatDistance,
  formatNumber,
  formatSourceCount,
  getBankGradeColor,
  getRiskColor,
  getRiskLabel,
  getScoreColor,
  getVerdictConfig,
  isLevelMeasured,
  isMeasured,
  scoreBarWidth,
} from "./riskDisplay";
import type {
  Coverage,
  Insight,
  RiskCategory,
  RiskLevel,
  RiskScores,
  RiskStudyData,
  RiskStudyMeta,
} from "./riskStudy.types";

export interface RiskReportParams {
  meta: RiskStudyMeta;
  scores: RiskScores;
  categories: RiskCategory[];
  data: RiskStudyData;
  insights: Insight[];
  /** Version de l'API risk-study ayant produit les données. */
  version: string;
  bankScoring?: BankRiskScoring | null;
  /** Couleur d'accent de l'espace appelant (promoteur / investisseur). */
  accent?: string;
  /** Libellé de l'espace, imprimé en couverture. */
  espace?: string;
}

// ─── Sécurité ───────────────────────────────────────────────────────────────

/**
 * Les libellés viennent d'API publiques : ils sont interpolés dans du HTML
 * écrit via `document.write`. Un nom d'installation contenant `<` casserait la
 * page au mieux, injecterait du balisage au pire.
 */
const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ─── Primitives de mise en page ─────────────────────────────────────────────

const INK = "#0f172a";
const MUTED = "#64748b";
const FAINT = "#94a3b8";
const RULE = "#e2e8f0";

/**
 * Bloc de section. Insécable par défaut : une carte de synthèse coupée en deux
 * par un saut de page est illisible.
 *
 * `breakable` lève cette contrainte pour les sections à long tableau. Sans elle,
 * un tableau de douze lignes qui ne tient pas dans le bas de page repousse toute
 * la section à la suivante et laisse une demi-page blanche. On laisse alors la
 * coupure se faire à l'intérieur du tableau, ligne par ligne.
 */
const block = (content: string, extra = "", breakable = false): string =>
  `<section style="background:white;border:1px solid ${RULE};border-radius:14px;
    padding:26px 28px;margin-bottom:18px;
    page-break-inside:${breakable ? "auto" : "avoid"};${extra}">${content}</section>`;

const h2 = (num: string, title: string, sub = ""): string => `
  <div style="display:flex;align-items:baseline;gap:12px;padding-bottom:12px;
              margin-bottom:18px;border-bottom:2px solid ${RULE};">
    <span style="font-size:11px;font-weight:700;color:${FAINT};letter-spacing:0.12em;">${esc(num)}</span>
    <h2 style="font-size:17px;font-weight:700;color:${INK};">${esc(title)}</h2>
    ${sub ? `<span style="font-size:12px;color:${MUTED};margin-left:auto;">${esc(sub)}</span>` : ""}
  </div>`;

/**
 * Cellule chiffrée. `state` porte l'honnêteté du chiffre : « measured » l'affiche,
 * « unmeasured » le remplace par un tiret et le dit. Un `0` non mesuré ne doit
 * jamais atteindre le papier.
 */
const kpi = (
  label: string,
  value: string,
  color = INK,
  sub = "",
  unmeasured = false,
): string => {
  // Le corps de 21 px est dimensionné pour un chiffre. Une valeur textuelle
  // longue — « Risques Géotechniques », « Commune · 5 km » — y devient un titre
  // criard qui déborde sur deux lignes et écrase la hiérarchie de la page.
  const taille = unmeasured ? "13px" : String(value).length > 13 ? "14px" : "21px";
  const graisse = unmeasured ? 600 : String(value).length > 13 ? 700 : 800;
  return `
  <div style="background:${unmeasured ? "#f8fafc" : "#fbfcfe"};border:1px solid ${RULE};
              border-radius:10px;padding:14px 16px;">
    <div style="font-size:9.5px;color:${MUTED};font-weight:700;text-transform:uppercase;
                letter-spacing:0.07em;margin-bottom:7px;">${esc(label)}</div>
    <div style="font-size:${taille};font-weight:${graisse};
                color:${unmeasured ? FAINT : color};line-height:1.25;">${esc(value)}</div>
    ${sub ? `<div style="font-size:10.5px;color:${FAINT};margin-top:4px;">${esc(sub)}</div>` : ""}
  </div>`;
};

const grid = (cols: number, cells: string, gap = "12px"): string =>
  `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:${gap};">${cells}</div>`;

/**
 * Badge de niveau. Le libellé est toujours écrit ; la couleur ne fait que le
 * renforcer. C'est ce qui rend le document lisible en noir et blanc.
 */
const badge = (level: RiskLevel): string => {
  const c = getRiskColor(level);
  return `<span style="display:inline-block;font-size:10px;font-weight:700;padding:3px 9px;
    border:1px solid ${c};color:${c};border-radius:999px;white-space:nowrap;">${esc(getRiskLabel(level))}</span>`;
};

/** Barre de score. `scoreBarWidth` borne la valeur et évite un `width:"null%"`. */
const bar = (score: number | null, level: RiskLevel): string => {
  const c = getRiskColor(level);
  if (score == null) {
    return `<div style="height:7px;background:#eef2f7;border-radius:4px;"></div>`;
  }
  return `<div style="height:7px;background:#eef2f7;border-radius:4px;overflow:hidden;">
    <div style="width:${scoreBarWidth(score)};height:100%;background:${c};border-radius:4px;"></div>
  </div>`;
};

const INSIGHT_TONES: Record<string, { bg: string; border: string; ink: string; label: string }> = {
  critical: { bg: "#fef2f2", border: "#dc2626", ink: "#991b1b", label: "Alerte" },
  warning: { bg: "#fffbeb", border: "#f59e0b", ink: "#92400e", label: "Vigilance" },
  positive: { bg: "#f0fdf4", border: "#22c55e", ink: "#166534", label: "Favorable" },
  info: { bg: "#f8fafc", border: "#94a3b8", ink: "#334155", label: "Information" },
};

const insightRow = (type: string, cat: string, msg: string): string => {
  const t = INSIGHT_TONES[type] ?? INSIGHT_TONES.info;
  return `<div style="background:${t.bg};border-left:3px solid ${t.border};border-radius:0 8px 8px 0;
    padding:11px 14px;margin-bottom:8px;page-break-inside:avoid;">
    <div style="font-size:9.5px;font-weight:700;color:${t.ink};text-transform:uppercase;
                letter-spacing:0.07em;margin-bottom:3px;">${esc(t.label)} · ${esc(cat)}</div>
    <div style="font-size:12.5px;color:${INK};line-height:1.5;">${esc(msg)}</div>
  </div>`;
};

// ─── Couverture des sources ─────────────────────────────────────────────────

/**
 * L'audit qui donne sa valeur au reste : pour chaque source publique, ce qu'elle
 * couvre et si elle a répondu. Sans ce tableau, un lecteur externe n'a aucun
 * moyen de distinguer « aucun site pollué » de « la base n'a pas répondu » —
 * exactement la confusion que toute la chaîne s'emploie à supprimer.
 */
const sourceRows = (data: RiskStudyData): string => {
  const lignes: Array<{ nom: string; objet: string; cov: Coverage | undefined; lvl?: RiskLevel }> = [
    { nom: "GASPAR", objet: "Arrêtés CATNAT, plans de prévention (PPR)", cov: data.gaspar?.coverage },
    { nom: "Géorisques — Radon", objet: "Potentiel radon communal", cov: data.radon?.coverage, lvl: data.radon?.risk_level },
    { nom: "ICPE", objet: "Installations classées, seuils SEVESO", cov: data.icpe?.coverage, lvl: data.icpe?.risk_level },
    { nom: "SIS", objet: "Secteurs d'information sur les sols pollués", cov: data.sis?.coverage, lvl: data.sis?.risk_level },
    { nom: "BRGM — Cavités", objet: "Cavités souterraines recensées", cov: data.cavites?.coverage, lvl: data.cavites?.risk_level },
    { nom: "BRGM — Mouvements", objet: "Mouvements de terrain recensés", cov: data.mouvements_terrain?.coverage, lvl: data.mouvements_terrain?.risk_level },
    { nom: "Retrait-gonflement des argiles", objet: "Aléa RGA", cov: data.argiles?.coverage, lvl: data.argiles?.risk_level },
    { nom: "Zonage sismique", objet: "Zone réglementaire (1 à 5)", cov: data.seisme?.coverage, lvl: data.seisme?.risk_level },
    { nom: "Inondation", objet: "Zone inondable, PPRI, TRI", cov: data.inondation?.coverage, lvl: data.inondation?.risk_level },
    { nom: "Feux de forêt", objet: "Zone exposée, débroussaillement", cov: data.feux_foret?.coverage, lvl: data.feux_foret?.risk_level },
  ];

  return lignes.map((l, i) => {
    const ok = isMeasured(l.cov) && (l.lvl === undefined || isLevelMeasured(l.lvl));
    const etat = ok
      ? l.cov === "partial"
        ? { txt: "Réponse partielle", c: "#b45309" }
        : { txt: "A répondu", c: "#047857" }
      : { txt: "Pas de réponse — non mesuré", c: FAINT };
    return `<tr style="background:${i % 2 === 0 ? "#fbfcfe" : "white"};">
      <td style="padding:8px 12px;font-size:11.5px;font-weight:600;color:${INK};">${esc(l.nom)}</td>
      <td style="padding:8px 12px;font-size:11.5px;color:${MUTED};">${esc(l.objet)}</td>
      <td style="padding:8px 12px;font-size:11.5px;font-weight:600;color:${etat.c};white-space:nowrap;">${esc(etat.txt)}</td>
    </tr>`;
  }).join("");
};

// ─── Document ───────────────────────────────────────────────────────────────

export const buildRiskReportHtml = (p: RiskReportParams): string => {
  const { meta, scores, categories, data, insights, version, bankScoring } = p;
  const accent = p.accent ?? "#5247b8";
  const espace = p.espace ?? "Étude de risques";

  const verdict = getVerdictConfig(scores.global);
  const scoreColor = getScoreColor(scores.global);
  const now = new Date();
  const dateLongue = now.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const heure = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  const by = (t: string) => insights.filter(i => i.type === t);
  const critiques = by("critical");
  const vigilance = by("warning");
  const favorables = by("positive");
  const infos = by("info");

  // Décomptes : « — » dès que la source ne s'est pas déclarée mesurée.
  //
  // GASPAR ne porte pas de `risk_level` : sa fiabilité tient au seul `coverage`.
  // Passer `undefined` à `formatSourceCount` faisait échouer son premier test
  // (`!isLevelMeasured(undefined)`) et retournait « — » quoi qu'il arrive — le
  // rapport affichait donc « Arrêtés CATNAT : — » au-dessus d'un tableau qui en
  // listait douze. On teste ici la seule chose qui existe pour cette source.
  const gasparMesure = isMeasured(data.gaspar?.coverage);
  const nCatnat = gasparMesure ? formatNumber(data.gaspar?.catnat_count) : "—";
  const nPpr = gasparMesure ? formatNumber(data.gaspar?.ppr_count) : "—";
  const icpeMesure = isLevelMeasured(data.icpe?.risk_level) && isMeasured(data.icpe?.coverage);
  const sisMesure = isLevelMeasured(data.sis?.risk_level) && isMeasured(data.sis?.coverage);
  const nSis = formatSourceCount(data.sis?.count, data.sis?.risk_level, data.sis?.coverage);
  const nonMesurees = scores.categories_non_mesurees ?? [];

  const catnatRows = (data.gaspar?.catnat_events ?? []).slice(0, 12).map((e, i) =>
    `<tr style="background:${i % 2 === 0 ? "#fbfcfe" : "white"};">
      <td style="padding:8px 12px;font-size:11.5px;color:${INK};">${esc(e.libelle_risque || "—")}</td>
      <td style="padding:8px 12px;font-size:11.5px;color:${MUTED};">${esc(e.date_debut || "—")}</td>
      <td style="padding:8px 12px;font-size:11.5px;color:${MUTED};">${esc(e.date_fin || "—")}</td>
    </tr>`).join("");

  const icpeRows = (data.icpe?.installations ?? []).slice(0, 12).map((inst, i) =>
    `<tr style="background:${inst.seveso ? "#fef2f2" : i % 2 === 0 ? "#fbfcfe" : "white"};">
      <td style="padding:8px 12px;font-size:11.5px;font-weight:600;color:${INK};">${esc(inst.nom)}</td>
      <td style="padding:8px 12px;font-size:11.5px;color:${MUTED};">${esc(inst.activite || "—")}</td>
      <td style="padding:8px 12px;font-size:11.5px;font-weight:${inst.seveso ? 700 : 400};
                 color:${inst.seveso ? "#dc2626" : MUTED};">${esc(inst.seveso || "—")}</td>
      <td style="padding:8px 12px;font-size:11.5px;color:${MUTED};white-space:nowrap;">${esc(formatDistance(inst.distance_m))}</td>
    </tr>`).join("");

  const tableHead = (cols: string[]) =>
    `<thead><tr>${cols.map(c =>
      `<th style="background:#f1f5f9;padding:9px 12px;font-size:9.5px;font-weight:700;color:${MUTED};
        text-transform:uppercase;letter-spacing:0.07em;text-align:left;">${esc(c)}</th>`).join("")}</tr></thead>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Étude de risques — ${esc(meta.commune_nom)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }

  /* Sans cette règle, le navigateur supprime TOUS les aplats à l'impression :
     l'en-tête sombre devient blanc, son texte blanc devient invisible, et les
     barres de score disparaissent. Le document sortait délavé et illisible. */
  html, body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  body {
    font-family: 'Inter','Segoe UI',-apple-system,Arial,sans-serif;
    background:#f1f5f9; color:${INK}; line-height:1.55;
    font-size:13px; padding:36px;
  }

  /* Une ligne de tableau coupée en deux par un saut de page est illisible, et
     un en-tête de colonne laissé seul en bas de feuille l'est tout autant. */
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  .sheet { max-width:900px; margin:0 auto; padding-bottom:46px; }
  table { width:100%; border-collapse:collapse; border-radius:8px; overflow:hidden; }
  h1,h2,h3 { line-height:1.25; }

  /* Bandeau répété en bas de chaque page imprimée (Chrome répète les éléments
     fixés). Il porte la mention de portée : une page détachée du rapport doit
     rester interprétable. */
  .footer-band { display:none; }

  @media print {
    body { background:white; padding:0; font-size:11.5px; }
    .sheet { max-width:none; padding-bottom:0; }
    @page { margin:14mm 12mm 18mm; }
    .cover { page-break-after:always; }
    .footer-band {
      display:block; position:fixed; bottom:0; left:0; right:0;
      font-size:8.5px; color:${FAINT}; text-align:center;
      padding:4px 0; border-top:1px solid ${RULE}; background:white;
    }
    .no-print { display:none; }
  }
</style>
</head>
<body>
<div class="sheet">

  <!-- ══ COUVERTURE ═══════════════════════════════════════════════════════ -->
  <div class="cover" style="background:linear-gradient(140deg,#0f172a 0%,${accent} 58%,#0f172a 100%);
       border-radius:18px;padding:52px 48px;color:white;margin-bottom:22px;">
    <div style="font-size:10.5px;opacity:0.62;text-transform:uppercase;letter-spacing:0.16em;margin-bottom:22px;">
      Mimmoza · ${esc(espace)}
    </div>
    <h1 style="font-size:40px;font-weight:800;letter-spacing:-0.02em;margin-bottom:8px;">${esc(meta.commune_nom)}</h1>
    <p style="font-size:13.5px;opacity:0.78;margin-bottom:34px;">
      ${esc(meta.region)} · Département ${esc(meta.departement)} · INSEE ${esc(meta.commune_insee)}<br>
      Rayon d'analyse ${esc(String(meta.radius_km))} km · Établi le ${esc(dateLongue)} à ${esc(heure)}
    </p>

    <div style="display:grid;grid-template-columns:190px 1fr;gap:26px;align-items:stretch;">
      <div style="background:rgba(255,255,255,0.12);border-radius:14px;padding:24px;text-align:center;">
        <div style="font-size:60px;font-weight:800;color:${scoreColor};line-height:1;">${esc(scores.global ?? "—")}</div>
        <div style="font-size:11px;opacity:0.62;margin-bottom:12px;">
          ${scores.global == null ? "non mesuré" : "sur 100 — 100 = sûr"}
        </div>
        <div style="display:inline-block;padding:6px 15px;background:${verdict.bg};color:${verdict.color};
                    border-radius:8px;font-weight:800;font-size:12px;">${esc(verdict.label)}</div>
      </div>

      <div style="background:rgba(255,255,255,0.09);border-radius:14px;padding:22px 24px;">
        <div style="font-size:10px;opacity:0.62;font-weight:700;text-transform:uppercase;
                    letter-spacing:0.1em;margin-bottom:14px;">Scores par catégorie</div>
        ${categories.map(cat => {
          const nm = cat.score == null;
          return `<div style="margin-bottom:11px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:5px;">
              <span style="font-size:11.5px;opacity:0.88;">${esc(cat.name)}</span>
              <span style="display:flex;align-items:center;gap:9px;white-space:nowrap;">
                ${badge(cat.level)}
                <span style="font-size:${nm ? "10.5px" : "13px"};font-weight:700;
                             color:${nm ? "rgba(255,255,255,0.55)" : "white"};">
                  ${nm ? "non mesuré" : esc(cat.score)}
                </span>
              </span>
            </div>
            ${bar(cat.score, cat.level)}
          </div>`;
        }).join("")}
      </div>
    </div>

    <!-- La portée en couverture : on ne peut pas prendre ce document pour un
         diagnostic de parcelle sans avoir lu le contraire. -->
    <div style="margin-top:30px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.18);
                font-size:11.5px;opacity:0.8;line-height:1.6;">
      Cette étude décrit l'exposition de <strong>la commune et de son environnement</strong> dans un
      rayon de ${esc(String(meta.radius_km))} km. Elle ne se substitue ni à une étude de sol, ni à un
      diagnostic sur la parcelle, ni à une consultation des documents d'urbanisme.
      ${nonMesurees.length > 0
        ? `Sur ${esc(String(scores.criteres_total ?? "?"))} critères, ${esc(String(scores.criteres_mesures ?? 0))} ont pu être mesurés — non mesuré : ${esc(nonMesurees.join(", "))}.`
        : ""}
    </div>
  </div>

  <!-- ══ 01 · CE QUE VAUT CETTE NOTE ══════════════════════════════════════ -->
  ${block(`
    ${h2("01", "Comment lire cette note", `risk-study v${esc(version)}`)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:22px;font-size:12.5px;line-height:1.65;color:#334155;">
      <div>
        <div style="font-weight:700;color:${INK};margin-bottom:6px;">Une note de sécurité, pas de danger</div>
        Le score va de 0 à 100 et se lit dans le sens rassurant : <strong>100 signifie
        « aucun risque identifié »</strong>. Il agrège quatre familles — risques naturels,
        technologiques, pollution des sols, géotechnique.
      </div>
      <div>
        <div style="font-weight:700;color:${INK};margin-bottom:6px;">L'absence de donnée n'est pas l'absence de risque</div>
        Quand une source publique ne répond pas, le critère est <strong>écarté du calcul</strong>,
        jamais compté comme favorable. Les poids sont renormalisés sur les seules
        catégories mesurées, et la catégorie est signalée « non mesuré ».
      </div>
    </div>
    <div style="margin-top:18px;">
      ${grid(3, [
        kpi("Critères mesurés",
          scores.criteres_total != null ? `${scores.criteres_mesures ?? 0} / ${scores.criteres_total}` : "—",
          accent),
        kpi("Catégories écartées",
          nonMesurees.length > 0 ? nonMesurees.join(", ") : "Aucune",
          nonMesurees.length > 0 ? "#b45309" : "#047857"),
        kpi("Périmètre", `Commune · ${meta.radius_km} km`, INK, esc(meta.location_label ?? meta.commune_nom)),
      ].join(""))}
    </div>
  `)}

  ${bankScoring ? block(`
    ${h2("02", "Lecture bancaire", "banque-risques-v1")}
    ${grid(4, [
      kpi("Score", String(bankScoring.score), getBankGradeColor(bankScoring.grade)),
      kpi("Grade", bankScoring.grade, getBankGradeColor(bankScoring.grade)),
      kpi("Niveau", bankScoring.level_label),
      kpi("Confiance", `${Math.round(bankScoring.confidence * 100)} %`, accent),
    ].join(""))}
    <div style="margin-top:16px;">
      ${bankScoring.rationale.slice(0, 4).map(r => insightRow("info", "Banque", r)).join("")}
    </div>
  `) : ""}

  <!-- ══ POINTS D'ATTENTION ═══════════════════════════════════════════════ -->
  ${(critiques.length || vigilance.length || favorables.length) ? block(`
    ${h2(bankScoring ? "03" : "02", "Points d'attention",
        `${critiques.length + vigilance.length} à surveiller · ${favorables.length} favorable(s)`)}
    ${critiques.length ? `<div style="font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;
        letter-spacing:0.07em;margin:0 0 9px;">Alertes critiques</div>
      ${critiques.map(i => insightRow(i.type, i.category, i.message)).join("")}` : ""}
    ${vigilance.length ? `<div style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;
        letter-spacing:0.07em;margin:16px 0 9px;">Vigilance</div>
      ${vigilance.map(i => insightRow(i.type, i.category, i.message)).join("")}` : ""}
    ${favorables.length ? `<div style="font-size:11px;font-weight:700;color:#166534;text-transform:uppercase;
        letter-spacing:0.07em;margin:16px 0 9px;">Éléments favorables</div>
      ${favorables.map(i => insightRow(i.type, i.category, i.message)).join("")}` : ""}
  `) : ""}

  <!-- ══ RISQUES NATURELS ═════════════════════════════════════════════════ -->
  ${block(`
    ${h2("A", "Risques naturels", getRiskLabel(data.inondation?.risk_level))}
    ${grid(4, [
      kpi("Inondation", getRiskLabel(data.inondation?.risk_level),
        getRiskColor(data.inondation?.risk_level),
        data.inondation?.ppri == null ? "PPRI non vérifié" : data.inondation.ppri ? "PPRI actif" : "Hors PPRI",
        !isLevelMeasured(data.inondation?.risk_level)),
      kpi("Séisme",
        data.seisme?.zone == null ? "Non mesuré" : `Zone ${data.seisme.zone}`,
        getRiskColor(data.seisme?.risk_level), data.seisme?.libelle ?? "",
        data.seisme?.zone == null),
      kpi("Feux de forêt", getRiskLabel(data.feux_foret?.risk_level),
        getRiskColor(data.feux_foret?.risk_level),
        data.feux_foret?.zone_risque == null ? "Non vérifié"
          : data.feux_foret.zone_risque ? "Zone exposée" : "Hors zone exposée",
        !isLevelMeasured(data.feux_foret?.risk_level)),
      kpi("Argiles (RGA)", getRiskLabel(data.argiles?.risk_level),
        getRiskColor(data.argiles?.risk_level), data.argiles?.niveau_alea ?? "Aléa non renseigné",
        !isLevelMeasured(data.argiles?.risk_level)),
    ].join(""))}
  `)}

  <!-- ══ CATNAT ═══════════════════════════════════════════════════════════ -->
  ${block(`
    ${h2("B", "Catastrophes naturelles reconnues", "GASPAR")}
    ${grid(2, [
      kpi("Arrêtés CATNAT", nCatnat, INK, "sur l'historique de la commune", !gasparMesure),
      kpi("Plans de prévention (PPR)", nPpr, INK, "applicables sur la commune", !gasparMesure),
    ].join(""))}
    ${data.gaspar?.truncated ? `<div style="margin-top:12px;padding:9px 13px;background:#fffbeb;
      border:1px solid #fcd34d;border-radius:8px;font-size:11px;color:#92400e;">
      Décompte tronqué par la pagination de la source : il s'agit d'un plafond de requête,
      pas d'un décompte exhaustif.</div>` : ""}
    ${catnatRows ? `<div style="margin-top:16px;">
      <table>${tableHead(["Type de risque", "Début", "Fin"])}<tbody>${catnatRows}</tbody></table>
    </div>` : ""}
    ${(data.gaspar?.ppr_list ?? []).length ? `<div style="margin-top:16px;">
      <div style="font-size:9.5px;color:${MUTED};font-weight:700;text-transform:uppercase;
                  letter-spacing:0.07em;margin-bottom:9px;">Plans de prévention applicables</div>
      ${data.gaspar.ppr_list.map(p => `
        <div style="padding:10px 14px;background:#fffbeb;border-left:3px solid #f59e0b;
                    border-radius:0 8px 8px 0;margin-bottom:6px;">
          <div style="font-size:12.5px;font-weight:600;color:#92400e;">${esc(p.libelle)}</div>
          <div style="font-size:10.5px;color:#b45309;margin-top:2px;">État : ${esc(p.etat || "inconnu")} · Code ${esc(p.code)}</div>
        </div>`).join("")}
    </div>` : ""}
  `, "", true)}

  <!-- ══ ICPE / SEVESO ════════════════════════════════════════════════════ -->
  ${block(`
    ${h2("C", "Installations industrielles", "ICPE · SEVESO")}
    ${grid(3, [
      kpi("SEVESO seuil haut",
        icpeMesure ? String(data.icpe?.seveso_haut_count ?? 0) : "—",
        (data.icpe?.seveso_haut_count ?? 0) > 0 ? "#991b1b" : "#047857", "", !icpeMesure),
      kpi("SEVESO seuil bas",
        icpeMesure ? String(data.icpe?.seveso_bas_count ?? 0) : "—",
        (data.icpe?.seveso_bas_count ?? 0) > 0 ? "#b45309" : "#047857", "", !icpeMesure),
      kpi("ICPE recensées",
        formatSourceCount(data.icpe?.count, data.icpe?.risk_level, data.icpe?.coverage),
        INK, `dans un rayon de ${meta.radius_km} km`, !icpeMesure),
    ].join(""))}
    ${!icpeMesure ? `<div style="margin-top:12px;padding:9px 13px;background:#f8fafc;border:1px solid ${RULE};
      border-radius:8px;font-size:11px;color:${MUTED};">
      La base ICPE n'a pas répondu : l'absence d'installation recensée ci-dessus ne peut pas
      être interprétée comme une absence d'installation.</div>` : ""}
    ${data.icpe?.truncated ? `<div style="margin-top:12px;padding:9px 13px;background:#fffbeb;
      border:1px solid #fcd34d;border-radius:8px;font-size:11px;color:#92400e;">
      Décompte tronqué par la pagination de la source : ce nombre est un plafond de requête,
      pas un décompte exhaustif des installations du secteur.</div>` : ""}
    ${icpeRows ? `<div style="margin-top:16px;">
      <table>${tableHead(["Installation", "Activité", "SEVESO", "Distance"])}<tbody>${icpeRows}</tbody></table>
      <div style="font-size:10px;color:${FAINT};margin-top:8px;">
        Installations les plus proches du point de référence, par ordre de distance croissante.
      </div>
    </div>` : ""}
  `, "", true)}

  <!-- ══ POLLUTION ════════════════════════════════════════════════════════ -->
  ${block(`
    ${h2("D", "Pollution et qualité des sols", "SIS · Radon")}
    ${grid(3, [
      kpi("Sites pollués (SIS)", nSis,
        (data.sis?.count ?? 0) > 0 ? "#dc2626" : "#047857", "", !sisMesure),
      kpi("Radon — classe",
        data.radon?.classe_potentiel == null ? "Non mesuré" : String(data.radon.classe_potentiel),
        getRiskColor(data.radon?.risk_level), data.radon?.libelle ?? "",
        data.radon?.classe_potentiel == null),
      kpi("Niveau de risque", getRiskLabel(data.sis?.risk_level),
        getRiskColor(data.sis?.risk_level), "", !isLevelMeasured(data.sis?.risk_level)),
    ].join(""))}
    ${sisMesure && (data.sis?.count ?? 0) > 0 ? `<div style="margin-top:16px;">
      <div style="font-size:9.5px;color:${MUTED};font-weight:700;text-transform:uppercase;
                  letter-spacing:0.07em;margin-bottom:9px;">Sites identifiés</div>
      ${data.sis.sites.map(s => `
        <div style="padding:10px 14px;background:#fef2f2;border-left:3px solid #dc2626;
                    border-radius:0 8px 8px 0;margin-bottom:6px;">
          <div style="font-size:12.5px;font-weight:600;color:#991b1b;">${esc(s.nom)}</div>
          <div style="font-size:10.5px;color:#b91c1c;margin-top:2px;">
            ${esc(s.adresse || s.commune)}${s.superficie_m2 ? ` · ${esc(formatNumber(s.superficie_m2))} m²` : ""}
          </div>
        </div>`).join("")}
    </div>` : ""}
  `)}

  <!-- ══ GÉOTECHNIQUE ═════════════════════════════════════════════════════ -->
  ${block(`
    ${h2("E", "Risques géotechniques", "BRGM")}
    ${grid(2, [
      kpi("Cavités souterraines",
        formatSourceCount(data.cavites?.count, data.cavites?.risk_level, data.cavites?.coverage),
        getRiskColor(data.cavites?.risk_level),
        data.cavites?.cavites?.[0]?.distance_m != null
          ? `La plus proche à ${formatDistance(data.cavites.cavites[0].distance_m)}` : "",
        !isLevelMeasured(data.cavites?.risk_level)),
      kpi("Mouvements de terrain",
        formatSourceCount(data.mouvements_terrain?.count, data.mouvements_terrain?.risk_level, data.mouvements_terrain?.coverage),
        getRiskColor(data.mouvements_terrain?.risk_level), "événements recensés",
        !isLevelMeasured(data.mouvements_terrain?.risk_level)),
    ].join(""))}
    ${(data.cavites?.cavites ?? []).length ? `<div style="margin-top:16px;">
      ${data.cavites.cavites.slice(0, 6).map((c, i) => `
        <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 12px;
                    background:${i % 2 === 0 ? "#fbfcfe" : "white"};border-radius:6px;font-size:11.5px;">
          <span style="color:${INK};">${esc(c.type)}${c.nom ? ` — ${esc(c.nom)}` : ""}</span>
          <span style="color:${MUTED};font-weight:600;white-space:nowrap;">${esc(formatDistance(c.distance_m))}</span>
        </div>`).join("")}
    </div>` : ""}
  `)}

  ${infos.length ? block(`
    ${h2("F", "Informations complémentaires")}
    ${infos.map(i => insightRow(i.type, i.category, i.message)).join("")}
  `) : ""}

  <!-- ══ SOURCES ET COUVERTURE ════════════════════════════════════════════ -->
  ${block(`
    ${h2("G", "Sources et couverture", "Audit de la donnée")}
    <p style="font-size:12px;color:#334155;line-height:1.6;margin-bottom:16px;">
      Chaque famille de risque dépend d'une base publique distincte. Le tableau ci-dessous
      indique, source par source, si elle a répondu au moment de l'analyse. Une source qui
      n'a pas répondu ne produit <strong>aucune conclusion</strong> : ni risque, ni absence de risque.
    </p>
    <table>${tableHead(["Source", "Ce qu'elle couvre", `État au ${dateLongue}`])}
      <tbody>${sourceRows(data)}</tbody></table>
  `)}

  <!-- ══ MENTIONS ═════════════════════════════════════════════════════════ -->
  ${block(`
    ${h2("H", "Portée et limites")}
    <div style="font-size:12px;color:#334155;line-height:1.7;">
      <p style="margin-bottom:10px;">
        Ce rapport est établi à partir de bases de données publiques françaises interrogées le
        ${esc(dateLongue)} à ${esc(heure)}. Il reflète l'état de ces bases à cet instant ; une mise à
        jour ultérieure peut modifier les conclusions.
      </p>
      <p style="margin-bottom:10px;">
        L'analyse porte sur <strong>la commune de ${esc(meta.commune_nom)} et son environnement</strong>
        dans un rayon de ${esc(String(meta.radius_km))} km, à partir du point de référence retenu. Elle
        ne constitue ni une étude géotechnique, ni un diagnostic de pollution des sols, ni un état
        des risques et pollutions (ERP) réglementaire, ni une garantie de constructibilité.
      </p>
      <p>
        Les critères non mesurés sont écartés du calcul du score et signalés comme tels. Ils ne
        doivent en aucun cas être interprétés comme favorables. Toute décision d'engagement
        devrait être précédée des diagnostics réglementaires appropriés.
      </p>
    </div>
  `, `background:#fbfcfe;`)}

  <div style="text-align:center;padding:18px 0 4px;color:${FAINT};font-size:10.5px;line-height:1.7;">
    Mimmoza · Intelligence immobilière — rapport généré le ${esc(dateLongue)} à ${esc(heure)}<br>
    Sources : Géorisques, GASPAR, BRGM, base ICPE, SIS · Moteur risk-study v${esc(version)}
  </div>

</div>

<div class="footer-band">
  ${esc(meta.commune_nom)} · Étude de risques Mimmoza · ${esc(dateLongue)} ·
  Exposition communale — ne se substitue pas à une étude de sol ni à un diagnostic de parcelle
</div>

</body>
</html>`;
};

/**
 * Ouvre le rapport dans un onglet et déclenche l'impression.
 * Le délai laisse au moteur le temps de poser la mise en page : sans lui, la
 * boîte d'impression s'ouvre parfois sur un document encore vide.
 */
export const openRiskReport = (p: RiskReportParams): void => {
  const win = window.open("", "_blank");
  if (!win) {
    alert("Autorisez les fenêtres surgissantes pour générer le rapport PDF.");
    return;
  }
  win.document.write(buildRiskReportHtml(p));
  win.document.close();
  win.onload = () => { setTimeout(() => win.print(), 350); };
};
