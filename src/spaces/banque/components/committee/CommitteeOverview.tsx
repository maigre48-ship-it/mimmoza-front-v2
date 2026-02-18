// src/spaces/banque/components/committee/CommitteeOverview.tsx
import React, { useMemo } from "react";

interface CommitteeData {
  decision: "GO" | "GO_AVEC_RESERVES" | "NO_GO" | null;
  confidence: number | null;
  totalScore: number | null;
  riskScore: number | null;
  riskDetails: { label: string; impact: number; detail?: string }[];
  markdown?: string | null;
}

function badgeColor(val: number | null, thresholds: [number, number] = [70, 40]) {
  if (val === null) return "bg-gray-50 text-gray-500 border-gray-200";
  if (val >= thresholds[0]) return "bg-green-50 text-green-700 border-green-200";
  if (val >= thresholds[1]) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

function clamp0_100(x: number) {
  return Math.max(0, Math.min(100, Math.round(x)));
}

function computeRiskScoreFromGeo(operation: any): { score: number | null; reason: string } {
  const geo = operation?.risks?.geo;
  if (!geo || typeof geo !== "object") {
    return { score: null, reason: "Aucune donnée Géorisques disponible." };
  }

  const coverage = (geo.coverage ?? "ok").toString().toLowerCase();
  if (coverage && coverage !== "ok") {
    return { score: null, reason: `Couverture Géorisques insuffisante (${coverage}).` };
  }

  const nb = typeof geo.nbRisques === "number" ? geo.nbRisques : null;
  const inond = !!geo.hasInondation;
  const sism = !!geo.hasSismique;

  if (nb === null) {
    return { score: null, reason: "Nombre de risques inconnu." };
  }

  // Cas “tout va bien”
  if (nb === 0 && !inond && !sism) {
    return { score: 90, reason: "0 risque détecté (Inondation: Non, Sismique: Non)." };
  }

  // Sinon: pénalités simples (explicables)
  let score = 85;
  if (inond) score -= 35;
  if (sism) score -= 10;
  score -= Math.min(30, nb * 5);

  return { score: clamp0_100(score), reason: "Score calculé via pénalités (inondation/sismique/nb risques)." };
}

function computeMarketScore(operation: any): { score: number | null; reason: string } {
  const market =
    operation?.market ??
    operation?.marketContext ??
    operation?.market_context ??
    operation?.marketStudy ??
    operation?.market_study ??
    null;

  const scores = market?.scores ?? null;
  if (scores && typeof scores.global === "number") {
    return { score: clamp0_100(scores.global), reason: "Score marché global (market.scores.global)." };
  }

  if (typeof market?.score === "number") {
    return { score: clamp0_100(market.score), reason: "Score marché (market.score)." };
  }

  return { score: null, reason: "Score marché indisponible (pas de scores.global/score)." };
}

function computeCommitteeScore(
  riskScore: number | null,
  marketScore: number | null
): { score: number | null; reason: string } {
  const wMarket = 0.6;
  const wRisk = 0.4;

  const parts: { label: string; v: number; w: number }[] = [];
  if (typeof marketScore === "number") parts.push({ label: "Marché", v: marketScore, w: wMarket });
  if (typeof riskScore === "number") parts.push({ label: "Risque terrain", v: riskScore, w: wRisk });

  if (parts.length === 0) return { score: null, reason: "Risque et marché indisponibles." };

  const sumW = parts.reduce((s, p) => s + p.w, 0);
  const val = parts.reduce((s, p) => s + p.v * p.w, 0) / sumW;

  const expl = parts.map((p) => `${p.label}: ${p.v}×${p.w}`).join(" + ");
  return { score: clamp0_100(val), reason: `Score = moyenne pondérée: ${expl} (renormalisé si données manquantes).` };
}

function computeConfidence(operation: any): { confidence: number; breakdown: { label: string; delta: number }[] } {
  const breakdown: { label: string; delta: number }[] = [];
  let c = 100;

  const apply = (cond: boolean, label: string, delta: number) => {
    if (!cond) return;
    c += delta;
    breakdown.push({ label, delta });
  };

  const geo = operation?.risks?.geo;
  const market =
    operation?.market ??
    operation?.marketContext ??
    operation?.market_context ??
    operation?.marketStudy ??
    operation?.market_study ??
    null;

  const covOk = (x: any) => (x?.coverage ?? "ok").toString().toLowerCase() === "ok";

  apply(!geo || !covOk(geo), "Géorisques incomplet", -10);

  const dvf = market?.dvf ?? market?.core?.dvf;
  apply(!dvf || !covOk(dvf), "DVF incomplet", -10);

  const insee = market?.insee ?? market?.core?.insee;
  apply(!insee || !covOk(insee), "INSEE incomplet", -10);

  const bpe = market?.bpe ?? market?.core?.bpe;
  apply(!bpe || !covOk(bpe), "BPE incomplet", -10);

  // Transport: s’il est vide -> baisse confiance, mais ne pas en déduire “mal desservi”
  const transport = market?.transport ?? market?.core?.transport;
  const transportInsufficient =
    !transport ||
    !covOk(transport) ||
    ((Array.isArray(transport.stops) && transport.stops.length === 0) &&
      transport.nearest_stop_m == null &&
      !transport.has_metro_train &&
      !transport.has_tram);

  apply(transportInsufficient, "Transport insuffisant", -10);

  // Missing data (optionnel, léger)
  const missing = Array.isArray(operation?.missing) ? operation.missing : [];
  const blockers = missing.filter((m: any) => m?.severity === "blocker").length;
  const warns = missing.filter((m: any) => m?.severity === "warn").length;
  if (blockers > 0) apply(true, `${blockers} donnée(s) bloquante(s)`, -10);
  if (warns > 0) apply(true, `${warns} donnée(s) manquante(s)`, -5);

  c = clamp0_100(c);
  return { confidence: c, breakdown };
}

export default function CommitteeOverview({
  committee,
  operation,
}: {
  committee: CommitteeData;
  operation: any;
}) {
  // Best-effort counters (unchanged)
  const inner = (operation as any)?.committee?.smartscore ?? (operation as any)?.committee ?? {};

  const redFlags =
    (operation as any)?.committee?.decision?.redFlags?.length ??
    inner.reasons?.length ??
    inner.redFlags?.length ??
    0;

  const reserves = inner.conditions?.length ?? inner.reserves?.length ?? 0;
  const positifs = inner.strengths?.length ?? inner.positives?.length ?? 0;

  // Compute scores (UI, explainable)
  const riskFromGeo = useMemo(() => computeRiskScoreFromGeo(operation), [operation]);
  const market = useMemo(() => computeMarketScore(operation), [operation]);

  // Prefer committee.riskScore if it's clearly set and not a "neutral fallback"
  // Heuristic: if committee.riskScore === 50 and geo looks "clean", we prefer geo-derived 90.
  const geo = operation?.risks?.geo;
  const geoLooksClean =
    geo &&
    typeof geo.nbRisques === "number" &&
    geo.nbRisques === 0 &&
    !geo.hasInondation &&
    !geo.hasSismique;

  const riskScore: number | null =
    typeof committee.riskScore === "number"
      ? (committee.riskScore === 50 && geoLooksClean ? riskFromGeo.score : committee.riskScore)
      : riskFromGeo.score;

  const committeeScoreComputed = useMemo(
    () => computeCommitteeScore(riskScore, market.score),
    [riskScore, market.score]
  );

  const committeeScore: number | null =
    typeof committee.totalScore === "number" ? committeeScoreComputed.score : committeeScoreComputed.score;

  const confComputed = useMemo(() => computeConfidence(operation), [operation]);
  const confidence: number | null =
    typeof committee.confidence === "number" ? committee.confidence : confComputed.confidence;

  // Tooltips (multi-line title)
  const riskTooltip = [
    "Score risque = pré-filtre terrain (Géorisques + indicateurs site).",
    `Règle: ≥70 faible, 40–69 modéré, <40 élevé.`,
    `Calcul: ${riskFromGeo.reason}`,
  ].join("\n");

  const marketTooltip = [
    "Score marché = viabilité économique locale (DVF/INSEE/BPE/transport…).",
    `Source: ${market.reason}`,
  ].join("\n");

  const committeeTooltip = [
    "Score comité = combinaison Marché + Risque terrain.",
    "Formule: 60% Marché + 40% Risque (renormalisé si une composante manque).",
    `Détail: ${committeeScoreComputed.reason}`,
    `Marché: ${market.score != null ? `${market.score}/100` : "N/A"}`,
    `Risque: ${riskScore != null ? `${riskScore}/100` : "N/A"}`,
    "",
    marketTooltip,
  ].join("\n");

  const confidenceTooltip = [
    "Confiance = fiabilité des données utilisées (pas la qualité du projet).",
    "Base 100, pénalités selon sources manquantes / couverture faible.",
    ...confComputed.breakdown.map((b) => `${b.delta} : ${b.label}`),
    `→ Confiance finale: ${confComputed.confidence}%`,
  ].join("\n");

  const items: { label: string; value: string; colorClass: string; title?: string }[] = [];

  if (riskScore !== null) {
    items.push({
      label: "Score risque",
      value: `${riskScore}/100`,
      colorClass: badgeColor(riskScore),
      title: riskTooltip,
    });
  } else {
    items.push({
      label: "Score risque",
      value: "N/A",
      colorClass: badgeColor(null),
      title: "Score risque non calculable (données insuffisantes).",
    });
  }

  if (committeeScore !== null) {
    items.push({
      label: "Score comité",
      value: `${committeeScore}/100`,
      colorClass: badgeColor(committeeScore),
      title: committeeTooltip,
    });
  } else {
    items.push({
      label: "Score comité",
      value: "N/A",
      colorClass: badgeColor(null),
      title: "Score comité non calculable (marché/risque indisponibles).",
    });
  }

  if (confidence !== null) {
    items.push({
      label: "Confiance",
      value: `${confidence}%`,
      colorClass: badgeColor(confidence, [80, 50]),
      title: confidenceTooltip,
    });
  }

  return (
    <div className="space-y-3">
      {(operation as any)?.committee?.source === "geo-auto" && (
        <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5 inline-block">
          ⚡ Décision synthétisée depuis Géorisques — lancez l'enrichissement pour une analyse complète
        </p>
      )}

      {/* Score tiles */}
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {items.map((it, i) => (
            <div
              key={i}
              className={`rounded-lg border p-2.5 text-center ${it.colorClass} ${it.title ? "cursor-help" : ""}`}
              title={it.title}
            >
              <p className="text-[10px] uppercase tracking-wide opacity-70">{it.label}</p>
              <p className="text-lg font-bold">{it.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Counters row */}
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
          🚩 {redFlags} red flag{redFlags !== 1 ? "s" : ""}
        </span>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          ⚠️ {reserves} réserve{reserves !== 1 ? "s" : ""}
        </span>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
          ✅ {positifs} positif{positifs !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}
