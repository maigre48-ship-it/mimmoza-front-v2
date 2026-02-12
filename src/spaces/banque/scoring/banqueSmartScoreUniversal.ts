// ============================================================================
// banqueSmartScoreUniversal.ts
// src/spaces/banque/scoring/banqueSmartScoreUniversal.ts
//
// SmartScore Banque UNIVERSEL — paramétrable par profil.
// ✅ FIX #6: scoreRisques() gère le format objet { score, nbRisques, ... }
// ✅ FIX #9: scoreFaisabilite() reads op.property (ageCategory, condition)
//    scorePlanning() reads op.calendar (acquisitionDate, worksMonths)
//    scoreRatios() reads DSTI + monthlyPayment
//    cleanMissing() removes satisfied items after hydration
// ============================================================================

import type {
  OperationSummary,
  OperationProfile,
  MissingDataItem,
} from "../types/operationSummary.types";
import {
  getScoreProfile,
  type ScoreProfile,
  type PillarKey,
  type PillarConfig,
} from "./scoreProfiles";

// ── Result types ──

export type Grade = "A" | "B" | "C" | "D" | "E";
export type Verdict = "favorable" | "favorable_sous_conditions" | "défavorable" | "données_insuffisantes";

export interface PillarResult {
  key: PillarKey;
  label: string;
  maxPoints: number;
  rawScore: number;
  points: number;
  hasData: boolean;
  reasons: string[];
  actions: string[];
}

export interface MissingPenalty {
  key: string;
  label: string;
  points: number;
  severity: "info" | "warn" | "blocker";
}

export interface SmartScoreDriver {
  label: string;
  direction: "up" | "down";
  impact: string;
}

export interface SmartScoreUniversalResult {
  score: number;
  grade: Grade;
  verdict: Verdict;
  profile: OperationProfile;
  pillars: PillarResult[];
  drivers: SmartScoreDriver[];
  recommendations: string[];
  missingPenalties: MissingPenalty[];
  totalMissingPenalty: number;
  blockers: string[];
  computedAt: string;
}

// ════════════════════════════════════════════════════════════════════
// PILLAR SCORERS
// ════════════════════════════════════════════════════════════════════

function safe(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function has(v: unknown): boolean {
  return v !== null && v !== undefined && v !== "" && v !== 0;
}

// ── Documents ──
function scoreDocuments(op: OperationSummary, dossier: any): { raw: number; reasons: string[]; actions: string[]; hasData: boolean } {
  const completude = safe(dossier?.documents?.completude);
  const docItems = dossier?.documents?.items ?? [];
  const total = docItems.length;
  const received = docItems.filter((d: any) => d.statut === "recu" || d.statut === "valide").length;
  const refused = docItems.filter((d: any) => d.statut === "refuse").length;

  const reasons: string[] = [];
  const actions: string[] = [];

  if (total === 0 && !completude) {
    return { raw: 0, reasons: ["Aucun document enregistré"], actions: ["Télécharger les pièces justificatives requises"], hasData: false };
  }

  let raw = completude ?? (total > 0 ? Math.round((received / total) * 100) : 0);

  if (refused > 0) {
    raw = Math.max(0, raw - refused * 10);
    reasons.push(`${refused} document(s) refusé(s)`);
    actions.push("Remplacer les documents refusés");
  }
  if (raw < 50) {
    reasons.push(`Complétude faible: ${Math.round(raw)}%`);
    actions.push("Compléter le dossier documentaire");
  } else if (raw < 80) {
    reasons.push(`Complétude partielle: ${Math.round(raw)}%`);
  } else {
    reasons.push(`Dossier bien documenté: ${Math.round(raw)}%`);
  }

  return { raw: Math.min(100, Math.max(0, raw)), reasons, actions, hasData: true };
}

// ── Garanties ──
function scoreGaranties(op: OperationSummary, dossier: any): { raw: number; reasons: string[]; actions: string[]; hasData: boolean } {
  const garItems = dossier?.garanties?.items ?? [];
  const couverture = safe(dossier?.garanties?.couvertureTotale);
  const loanAmount = safe(op.financing?.loanAmount);
  const reasons: string[] = [];
  const actions: string[] = [];

  if (garItems.length === 0 && !couverture) {
    return { raw: 0, reasons: ["Aucune garantie enregistrée"], actions: ["Constituer des garanties (hypothèque, caution…)"], hasData: false };
  }

  let ratio = 0;
  if (couverture && loanAmount && loanAmount > 0) {
    ratio = Math.round((couverture / loanAmount) * 100);
  }

  let raw: number;
  if (ratio >= 150) { raw = 100; reasons.push(`Ratio garanties/prêt excellent: ${ratio}%`); }
  else if (ratio >= 120) { raw = 90; reasons.push(`Ratio garanties/prêt solide: ${ratio}%`); }
  else if (ratio >= 100) { raw = 75; reasons.push(`Ratio garanties/prêt suffisant: ${ratio}%`); }
  else if (ratio >= 80) { raw = 55; reasons.push(`Ratio garanties/prêt insuffisant: ${ratio}%`); actions.push("Renforcer la couverture des garanties"); }
  else if (ratio > 0) { raw = 30; reasons.push(`Ratio garanties/prêt faible: ${ratio}%`); actions.push("Couverture très insuffisante — exiger des garanties complémentaires"); }
  else { raw = 20; reasons.push("Ratio non calculable (montant prêt manquant)"); }

  const types = new Set(garItems.map((g: any) => g.type));
  if (types.size >= 3) { raw = Math.min(100, raw + 5); reasons.push("Diversification des garanties (+5)"); }

  return { raw, reasons, actions, hasData: true };
}

// ── Budget ──
function scoreBudget(op: OperationSummary, profile: OperationProfile): { raw: number; reasons: string[]; actions: string[]; hasData: boolean } {
  const b = op.budget;
  const reasons: string[] = [];
  const actions: string[] = [];

  if (!b || !has(b.purchasePrice)) {
    return { raw: 0, reasons: ["Budget non renseigné"], actions: ["Saisir le prix d'achat et les coûts associés"], hasData: false };
  }

  let raw = 50;

  if (has(b.totalCost)) { raw += 10; reasons.push("Coût total calculé"); }
  else { actions.push("Renseigner ou vérifier le coût total"); }

  if (has(b.notaryFees)) { raw += 5; }

  if (profile === "promoteur" || profile === "marchand") {
    if (has(b.worksBudget)) {
      raw += 15;
      reasons.push(`Budget travaux: ${(b.worksBudget! / 1000).toFixed(0)}k€`);
    } else {
      raw -= 10;
      actions.push("Renseigner le budget travaux — essentiel pour ce profil");
    }
    if (has(b.contingency)) { raw += 5; reasons.push("Provision pour aléas incluse"); }
    else { actions.push("Prévoir une provision pour aléas (5-10% recommandé)"); }
    if (has(b.softCosts)) { raw += 5; reasons.push("Soft costs (honoraires) renseignés"); }
    if (has(b.holdingCosts)) { raw += 5; reasons.push("Frais de portage renseignés"); }
  } else {
    if (has(b.worksBudget)) { raw += 10; reasons.push("Budget travaux renseigné"); }
  }

  if (has(b.equity)) {
    raw += 5;
    reasons.push("Apport personnel renseigné");
  }

  if (has(b.costPerSqm) && has(op.market?.pricePerSqm)) {
    const ratio = b.costPerSqm! / op.market!.pricePerSqm!;
    if (ratio > 1.3) {
      raw -= 5;
      reasons.push(`Coût/m² (${b.costPerSqm}€) supérieur au marché (${op.market!.pricePerSqm}€/m²)`);
    } else if (ratio < 0.7) {
      raw += 5;
      reasons.push("Coût/m² inférieur au marché — bonne opportunité");
    }
  }

  return { raw: Math.min(100, Math.max(0, raw)), reasons, actions, hasData: true };
}

// ── Revenus / Scénarios ──
function scoreRevenus(op: OperationSummary, profile: OperationProfile): { raw: number; reasons: string[]; actions: string[]; hasData: boolean } {
  const r = op.revenues;
  const reasons: string[] = [];
  const actions: string[] = [];

  const hasExit = has(r?.exitValue);
  const hasRent = has(r?.rentAnnual);
  const hasRevenue = has(r?.revenueTotal);
  const hasStrategy = has(r?.strategy);

  if (!hasExit && !hasRent && !hasRevenue) {
    return { raw: 0, reasons: ["Aucun revenu/sortie renseigné"], actions: ["Définir la stratégie de sortie et les revenus attendus"], hasData: false };
  }

  let raw = 40;

  if (hasStrategy) { raw += 10; reasons.push(`Stratégie: ${r!.strategy}`); }
  else { actions.push("Préciser la stratégie de sortie (revente, location, exploitation)"); }

  if (hasExit) { raw += 15; reasons.push(`Valeur sortie: ${(r!.exitValue! / 1000).toFixed(0)}k€`); }

  if (hasRent) {
    raw += 10;
    reasons.push(`Loyer annuel: ${(r!.rentAnnual! / 1000).toFixed(0)}k€`);
  }

  // ✅ FIX #9: revenueTotal gives points even if it's the only revenue data
  if (hasRevenue && !hasRent && !hasExit) {
    raw += 10;
    reasons.push(`Revenus annuels: ${(r!.revenueTotal! / 1000).toFixed(0)}k€`);
  } else if (hasRevenue && (hasRent || hasExit)) {
    raw += 5;
    reasons.push(`Revenus ménage: ${(r!.revenueTotal! / 1000).toFixed(0)}k€/an`);
  }

  if (has(r?.occupancyRate)) { raw += 5; reasons.push(`Taux d'occupation: ${r!.occupancyRate}%`); }

  if (r?.scenarios) {
    const sc = r.scenarios;
    if (has(sc.base?.exitValue)) { raw += 5; reasons.push("Scénario base défini"); }
    if (has(sc.stress?.exitValue)) { raw += 10; reasons.push("Scénario stress défini — bonne pratique"); }
    if (has(sc.upside?.exitValue)) { raw += 5; reasons.push("Scénario upside défini"); }

    if (sc.stress?.margin !== undefined && sc.stress.margin < 0) {
      raw -= 10;
      reasons.push(`⚠️ Marge négative en scénario stress: ${sc.stress.margin}%`);
      actions.push("Revoir le scénario stress — marge négative inacceptable pour le comité");
    }
  } else {
    if (profile === "promoteur" || profile === "marchand") {
      actions.push("Définir des scénarios base/stress/upside — requis pour le comité");
    }
  }

  return { raw: Math.min(100, Math.max(0, raw)), reasons, actions, hasData: true };
}

// ── Marché ──
function scoreMarche(op: OperationSummary): { raw: number; reasons: string[]; actions: string[]; hasData: boolean } {
  const m = op.market;
  const reasons: string[] = [];
  const actions: string[] = [];

  if (!m || (!has(m.pricePerSqm) && !has(m.demandIndex) && !has(m.compsCount))) {
    return { raw: 0, reasons: ["Données marché absentes"], actions: ["Enrichir avec les moteurs marché (INSEE/DVF/BPE)"], hasData: false };
  }

  let raw = 40;

  if (has(m.pricePerSqm)) { raw += 15; reasons.push(`Prix médian: ${m.pricePerSqm}€/m²`); }
  if (has(m.demandIndex)) {
    raw += 10;
    if (m.demandIndex! > 70) reasons.push(`Forte demande (${m.demandIndex}/100)`);
    else if (m.demandIndex! > 40) reasons.push(`Demande modérée (${m.demandIndex}/100)`);
    else { reasons.push(`Demande faible (${m.demandIndex}/100)`); raw -= 5; }
  }
  if (has(m.compsCount) && m.compsCount! >= 10) { raw += 5; reasons.push(`${m.compsCount} comparables DVF`); }
  if (has(m.absorptionMonths)) {
    if (m.absorptionMonths! < 6) { raw += 5; reasons.push("Absorption rapide (< 6 mois)"); }
    else if (m.absorptionMonths! > 18) { raw -= 5; reasons.push("Absorption lente (> 18 mois)"); actions.push("Marché peu liquide — prévoir des délais"); }
  }
  if (has(m.evolutionPct)) {
    if (m.evolutionPct! > 3) { raw += 5; reasons.push(`Prix en hausse: +${m.evolutionPct}%`); }
    else if (m.evolutionPct! < -3) { raw -= 5; reasons.push(`Prix en baisse: ${m.evolutionPct}%`); }
  }
  if (m.sources && m.sources.length > 0) { raw += 5; reasons.push(`Sources: ${m.sources.join(", ")}`); }

  return { raw: Math.min(100, Math.max(0, raw)), reasons, actions, hasData: true };
}

// ── Risques ──
function scoreRisques(op: OperationSummary): { raw: number; reasons: string[]; actions: string[]; hasData: boolean } {
  const rk = op.risks;
  const reasons: string[] = [];
  const actions: string[] = [];

  if (!rk) {
    return { raw: 0, reasons: ["Analyse de risques absente"], actions: ["Enrichir avec l'analyse Géorisques"], hasData: false };
  }

  // Format A: normalized object
  if (rk.geo && typeof rk.geo === "object" && !Array.isArray(rk.geo) && typeof rk.geo.score === "number") {
    const geo = rk.geo as { score: number; nbRisques: number; hasInondation?: boolean; hasSismique?: boolean; label?: string };
    let raw = geo.score;

    if (geo.nbRisques === 0) reasons.push("Aucun risque majeur identifié");
    else reasons.push(`${geo.nbRisques} risque(s) identifié(s)`);

    if (geo.hasInondation) {
      reasons.push("Zone inondable identifiée");
      if (raw > 60) raw = Math.min(raw, 60);
      actions.push("Vérifier le PPRI et les contraintes liées à l'inondation");
    }
    if (geo.hasSismique) reasons.push("Zone sismique identifiée");
    if (geo.label) reasons.push(`Niveau de risque: ${geo.label}`);
    if (rk.sources?.length) reasons.push(`Sources: ${rk.sources.join(", ")}`);

    return { raw: Math.min(100, Math.max(0, raw)), reasons, actions, hasData: true };
  }

  // Format B: legacy array-based
  if (!rk.geo?.length && !rk.environmental?.length) {
    return { raw: 0, reasons: ["Analyse de risques absente"], actions: ["Enrichir avec l'analyse Géorisques"], hasData: false };
  }

  let raw = 100;
  const allRisks = [...(rk.geo ?? []), ...(rk.environmental ?? []), ...(rk.urbanism ?? [])];
  const highRisks = allRisks.filter(r => r.level === "élevé" || r.level === "très élevé");
  const mediumRisks = allRisks.filter(r => r.level === "moyen");
  const unknownRisks = allRisks.filter(r => r.status === "unknown");

  raw -= highRisks.length * 15;
  raw -= mediumRisks.length * 5;
  raw -= unknownRisks.length * 3;

  if (highRisks.length > 0) {
    reasons.push(`${highRisks.length} risque(s) élevé(s): ${highRisks.map(r => r.label).join(", ")}`);
    actions.push("Vérifier les risques élevés et prévoir les mesures de mitigation");
  }
  if (mediumRisks.length > 0) reasons.push(`${mediumRisks.length} risque(s) modéré(s)`);
  if (unknownRisks.length > 0) reasons.push(`${unknownRisks.length} risque(s) non évalué(s)`);
  if (highRisks.length === 0 && mediumRisks.length === 0) reasons.push("Aucun risque majeur identifié");
  if (rk.sources?.length) reasons.push(`Sources: ${rk.sources.join(", ")}`);

  return { raw: Math.min(100, Math.max(0, raw)), reasons, actions, hasData: true };
}

// ── Faisabilité / Bien / État ──
// ✅ FIX #9: Also reads op.property (ageCategory, condition, estimatedValue)
function scoreFaisabilite(op: OperationSummary): { raw: number; reasons: string[]; actions: string[]; hasData: boolean } {
  const urb = op.risks?.urbanism;
  const prop = (op as any).property as {
    ageCategory?: string;
    condition?: string;
    estimatedValue?: number;
  } | undefined;
  const reasons: string[] = [];
  const actions: string[] = [];

  const hasUrbData = urb && urb.length > 0;
  const hasPropData = prop && (has(prop.ageCategory) || has(prop.condition) || has(prop.estimatedValue));

  if (!hasUrbData && !hasPropData) {
    return { raw: 0, reasons: ["Données bien/urbanisme non disponibles"], actions: ["Renseigner l'état du bien ou vérifier la conformité PLU"], hasData: false };
  }

  let raw = 0;

  // ── Property data (from BienEtatSection) ──
  if (hasPropData) {
    if (prop!.ageCategory) {
      if (prop!.ageCategory === "neuf") { raw += 35; reasons.push("Bien neuf — pas de risque vétusté"); }
      else if (prop!.ageCategory === "recent") { raw += 30; reasons.push("Bien récent (< 15 ans)"); }
      else { raw += 20; reasons.push("Bien ancien — vérifier DPE et travaux"); actions.push("Prévoir un diagnostic technique (DPE, amiante, plomb)"); }
    }

    if (prop!.condition) {
      if (prop!.condition === "bon") { raw += 30; reasons.push("État général: bon"); }
      else if (prop!.condition === "moyen") { raw += 20; reasons.push("État général: moyen — travaux probables"); actions.push("Prévoir un budget travaux de remise en état"); }
      else { raw += 10; reasons.push("État général: mauvais — travaux importants"); actions.push("Chiffrer les travaux de rénovation"); }
    }

    if (has(prop!.estimatedValue)) {
      raw += 15;
      reasons.push(`Valeur estimée: ${(prop!.estimatedValue! / 1000).toFixed(0)}k€`);
    }
  }

  // ── Urbanism data (legacy PLU) ──
  if (hasUrbData) {
    const violations = urb!.filter(u => u.status === "present" && (u.level === "élevé" || u.level === "très élevé"));
    const warnings = urb!.filter(u => u.status === "present" && u.level === "moyen");

    if (violations.length > 0) {
      raw -= violations.length * 20;
      reasons.push(`${violations.length} non-conformité(s) PLU`);
      actions.push("Résoudre les non-conformités PLU avant instruction");
    } else if (warnings.length > 0) {
      raw -= warnings.length * 5;
    } else {
      raw += 20;
      reasons.push("Urbanisme conforme");
    }
  }

  // Normalize: property-only max = 35+30+15 = 80 → scale to ~85 max
  if (!hasUrbData && hasPropData) {
    raw = Math.min(85, Math.round(raw * (100 / 80)));
  }

  return { raw: Math.min(100, Math.max(0, raw)), reasons, actions, hasData: true };
}

// ── Planning / Calendrier ──
// ✅ FIX #9: Also reads op.calendar (acquisitionDate, durationMonths, startWorksDate)
function scorePlanning(op: OperationSummary): { raw: number; reasons: string[]; actions: string[]; hasData: boolean } {
  const exec = op.risks?.execution;
  const cal = (op as any).calendar as {
    acquisitionDate?: string;
    durationMonths?: number;
    startWorksDate?: string;
  } | undefined;
  const reasons: string[] = [];
  const actions: string[] = [];

  const hasExecData = exec && exec.length > 0;
  const hasCalData = cal && (has(cal.acquisitionDate) || has(cal.durationMonths));

  if (!hasExecData && !hasCalData) {
    return { raw: 0, reasons: ["Pas de données calendrier/exécution"], actions: [], hasData: false };
  }

  let raw = 60; // base: having data is already good

  // ── Calendar data (from CalendrierSection) ──
  if (hasCalData) {
    if (has(cal!.acquisitionDate)) {
      raw += 15;
      try {
        const acqDate = new Date(cal!.acquisitionDate!);
        const now = new Date();
        const monthsUntil = (acqDate.getFullYear() - now.getFullYear()) * 12 + (acqDate.getMonth() - now.getMonth());

        if (monthsUntil < 0) {
          reasons.push("Date d'acquisition passée");
          actions.push("Mettre à jour la date d'acquisition");
          raw -= 10;
        } else if (monthsUntil <= 3) {
          reasons.push("Acquisition imminente (< 3 mois)");
        } else if (monthsUntil <= 12) {
          reasons.push(`Acquisition dans ~${monthsUntil} mois`);
        } else {
          reasons.push(`Acquisition lointaine (~${monthsUntil} mois)`);
          raw -= 5;
        }
      } catch {
        reasons.push("Date d'acquisition renseignée");
      }
    }

    if (has(cal!.durationMonths)) {
      raw += 10;
      const dur = cal!.durationMonths!;
      if (dur <= 6) { reasons.push(`Travaux courts: ${dur} mois`); raw += 5; }
      else if (dur <= 18) { reasons.push(`Durée travaux: ${dur} mois`); }
      else if (dur <= 36) { reasons.push(`Travaux longs: ${dur} mois`); raw -= 5; }
      else { reasons.push(`Travaux très longs: ${dur} mois`); raw -= 15; actions.push("Durée > 36 mois — risque de dépassement"); }
    }

    if (has(cal!.startWorksDate)) {
      raw += 5;
      reasons.push("Date début travaux planifiée");
    }
  }

  // ── Execution risks (legacy enrichment) ──
  if (hasExecData) {
    const highExec = exec!.filter(e => e.level === "élevé" || e.level === "très élevé");
    if (highExec.length > 0) {
      raw -= highExec.length * 15;
      reasons.push(`${highExec.length} risque(s) d'exécution élevé(s)`);
    } else {
      raw += 10;
      reasons.push("Risque d'exécution maîtrisé");
    }
  }

  return { raw: Math.min(100, Math.max(0, raw)), reasons, actions, hasData: true };
}

// ── Ratios ──
// ✅ FIX #9: Also reads DSTI + monthlyPayment for hasData check
function scoreRatios(op: OperationSummary, profile: OperationProfile): { raw: number; reasons: string[]; actions: string[]; hasData: boolean } {
  const k = op.kpis;
  const reasons: string[] = [];
  const actions: string[] = [];

  if (!k || (!has(k.ltv) && !has(k.margin) && !has(k.dscr) && !has(k.yieldGross) && !has(k.dsti) && !has(k.monthlyPayment))) {
    return { raw: 0, reasons: ["Ratios non calculables (données insuffisantes)"], actions: ["Compléter budget et revenus pour calculer les ratios"], hasData: false };
  }

  let raw = 50;

  // LTV
  if (has(k.ltv)) {
    if (k.ltv! <= 60) { raw += 15; reasons.push(`LTV excellent: ${k.ltv}%`); }
    else if (k.ltv! <= 75) { raw += 10; reasons.push(`LTV bon: ${k.ltv}%`); }
    else if (k.ltv! <= 85) { raw += 5; reasons.push(`LTV acceptable: ${k.ltv}%`); }
    else { raw -= 5; reasons.push(`LTV élevé: ${k.ltv}%`); actions.push("LTV > 85% — renforcer l'apport ou les garanties"); }
  }

  // DSTI (taux d'effort — critical for particulier)
  if (has(k.dsti)) {
    if (k.dsti! <= 33) { raw += 10; reasons.push(`Taux d'effort maîtrisé: ${k.dsti}%`); }
    else if (k.dsti! <= 45) { raw += 3; reasons.push(`Taux d'effort élevé: ${k.dsti}%`); actions.push("Taux d'effort > 33% — attention au reste à vivre"); }
    else { raw -= 10; reasons.push(`⚠️ Taux d'effort excessif: ${k.dsti}%`); actions.push("DSTI > 45% — dépassement seuil HCSF, risque de refus"); }
  }

  // Margin (promoteur/marchand)
  if (has(k.margin) && (profile === "promoteur" || profile === "marchand")) {
    if (k.margin! >= 20) { raw += 15; reasons.push(`Marge forte: ${k.margin}%`); }
    else if (k.margin! >= 10) { raw += 8; reasons.push(`Marge correcte: ${k.margin}%`); }
    else if (k.margin! >= 0) { reasons.push(`Marge faible: ${k.margin}%`); actions.push("Optimiser les coûts ou revoir le prix de sortie"); }
    else { raw -= 15; reasons.push(`⚠️ Marge négative: ${k.margin}%`); actions.push("Opération déficitaire — revoir fondamentalement le montage"); }
  }

  // DSCR
  if (has(k.dscr)) {
    if (k.dscr! >= 1.5) { raw += 10; reasons.push(`DSCR solide: ${k.dscr}`); }
    else if (k.dscr! >= 1.2) { raw += 5; reasons.push(`DSCR acceptable: ${k.dscr}`); }
    else { raw -= 10; reasons.push(`DSCR insuffisant: ${k.dscr}`); actions.push("DSCR < 1.2 — capacité de remboursement trop juste"); }
  }

  // Yield
  if (has(k.yieldGross)) {
    if (k.yieldGross! >= 7) { raw += 5; reasons.push(`Rendement brut: ${k.yieldGross}%`); }
    else if (k.yieldGross! < 3) { raw -= 3; reasons.push(`Rendement brut faible: ${k.yieldGross}%`); }
  }

  // LTC
  if (has(k.ltc)) {
    if (k.ltc! > 90) { raw -= 5; reasons.push(`LTC élevé: ${k.ltc}%`); actions.push("Financement > 90% du coût total — risque pour la banque"); }
  }

  // Mensualité (info bonus if no other ratios)
  if (has(k.monthlyPayment) && !has(k.dsti) && !has(k.dscr)) {
    raw += 3;
    reasons.push(`Mensualité calculée: ${k.monthlyPayment}€/mois`);
  }

  return { raw: Math.min(100, Math.max(0, raw)), reasons, actions, hasData: true };
}

// ════════════════════════════════════════════════════════════════════
// MISSING DATA CLEANUP
// ✅ FIX #9: Remove missing items that are now satisfied by hydrated data.
// ════════════════════════════════════════════════════════════════════

function cleanMissing(operation: OperationSummary): MissingDataItem[] {
  const missing = operation.missing ?? [];
  if (missing.length === 0) return [];

  const presentFields = new Set<string>();

  // Budget
  const b = operation.budget;
  if (has(b?.purchasePrice)) presentFields.add("budget.purchasePrice");
  if (has(b?.totalCost)) presentFields.add("budget.totalCost");
  if (has(b?.worksBudget)) presentFields.add("budget.worksBudget");
  if (has(b?.equity)) presentFields.add("budget.equity");

  // Revenues
  const r = operation.revenues;
  if (has(r?.revenueTotal)) presentFields.add("revenues.revenueTotal");
  if (has(r?.rentAnnual)) presentFields.add("revenues.rentAnnual");
  if (has(r?.exitValue)) presentFields.add("revenues.exitValue");
  if (has(r?.strategy)) presentFields.add("revenues.strategy");

  // KPIs
  const k = operation.kpis;
  if (has(k?.ltv)) presentFields.add("kpis.ltv");
  if (has(k?.dscr)) presentFields.add("kpis.dscr");
  if (has(k?.dsti)) presentFields.add("kpis.dsti");
  if (has(k?.margin)) presentFields.add("kpis.margin");
  if (has(k?.monthlyPayment)) presentFields.add("kpis.monthlyPayment");

  // Financing
  if (has(operation.financing?.loanAmount)) presentFields.add("financing.loanAmount");

  // Market
  if (has(operation.market?.pricePerSqm)) presentFields.add("market.pricePerSqm");
  if (has(operation.market?.demandIndex)) presentFields.add("market.demandIndex");

  // Risks
  if (operation.risks?.geo) presentFields.add("risks.geo");

  // Property
  const prop = (operation as any).property;
  if (has(prop?.ageCategory) || has(prop?.condition)) presentFields.add("property.condition");

  // Calendar
  const cal = (operation as any).calendar;
  if (has(cal?.acquisitionDate)) presentFields.add("calendar.acquisitionDate");

  return missing.filter((m) => {
    const field = m.field ?? m.key ?? "";
    if (presentFields.has(field)) return false;
    // Partial match: "budget.purchasePrice" clears "budget" missing, etc.
    for (const present of presentFields) {
      if (present.startsWith(field + ".") || field.startsWith(present + ".")) return false;
      if (field === present.split(".")[0]) return false;
    }
    return true;
  });
}

// ════════════════════════════════════════════════════════════════════
// MAIN SCORER
// ════════════════════════════════════════════════════════════════════

const PILLAR_SCORERS: Record<PillarKey, (op: OperationSummary, profile: OperationProfile, dossier: any) => { raw: number; reasons: string[]; actions: string[]; hasData: boolean }> = {
  documents: (op, _p, d) => scoreDocuments(op, d),
  garanties: (op, _p, d) => scoreGaranties(op, d),
  budget: (op, p) => scoreBudget(op, p),
  revenus: (op, p) => scoreRevenus(op, p),
  marche: (op) => scoreMarche(op),
  risques: (op) => scoreRisques(op),
  faisabilite: (op) => scoreFaisabilite(op),
  planning: (op) => scorePlanning(op),
  ratios: (op, p) => scoreRatios(op, p),
};

export function computeSmartScoreFromOperation(
  operation: OperationSummary,
  dossier?: any,
): SmartScoreUniversalResult {
  const profile = operation.meta.profile;
  const scoreProfile = getScoreProfile(profile);
  const d = dossier ?? {};

  const pillars: PillarResult[] = scoreProfile.pillars.map((cfg) => {
    const scorer = PILLAR_SCORERS[cfg.key];
    const result = scorer(operation, profile, d);
    const points = Math.round((result.raw / 100) * cfg.weight);
    return {
      key: cfg.key,
      label: cfg.label,
      maxPoints: cfg.weight,
      rawScore: result.raw,
      points,
      hasData: result.hasData,
      reasons: result.reasons,
      actions: result.actions,
    };
  });

  // ✅ FIX #9: Clean missing items satisfied by hydration
  const cleanedMissing = cleanMissing(operation);

  const missingPenalties: MissingPenalty[] = cleanedMissing
    .filter((m) => m.severity !== "info")
    .map((m) => ({
      key: m.key,
      label: m.label,
      severity: m.severity,
      points: m.severity === "blocker" ? scoreProfile.blockerPenalty : scoreProfile.warnPenalty,
    }));

  const totalMissingPenalty = missingPenalties.reduce((s, p) => s + p.points, 0);

  const rawTotal = pillars.reduce((s, p) => s + p.points, 0);
  const score = Math.min(100, Math.max(0, rawTotal - totalMissingPenalty));

  const t = scoreProfile.gradeThresholds;
  const grade: Grade =
    score >= t.A ? "A" : score >= t.B ? "B" : score >= t.C ? "C" : score >= t.D ? "D" : "E";

  const blockers: string[] = [];
  cleanedMissing
    .filter((m) => m.severity === "blocker")
    .forEach((m) => blockers.push(`Donnée bloquante manquante: ${m.label}`));
  pillars
    .filter((p) => p.maxPoints >= 10 && p.points === 0 && !p.hasData)
    .forEach((p) => blockers.push(`Pilier critique sans données: ${p.label}`));

  let verdict: Verdict;
  if (blockers.length > 0) verdict = "données_insuffisantes";
  else if (score >= t.B) verdict = "favorable";
  else if (score >= t.D) verdict = "favorable_sous_conditions";
  else verdict = "défavorable";

  const drivers: SmartScoreDriver[] = [];
  const sorted = [...pillars].sort((a, b) => b.rawScore - a.rawScore);

  sorted
    .filter((p) => p.hasData && p.rawScore >= 60)
    .slice(0, 3)
    .forEach((p) => drivers.push({ label: p.label, direction: "up", impact: `${p.points}/${p.maxPoints} pts` }));

  sorted
    .reverse()
    .filter((p) => p.hasData && p.rawScore < 50)
    .slice(0, 3)
    .forEach((p) => drivers.push({ label: p.label, direction: "down", impact: `${p.points}/${p.maxPoints} pts` }));

  const recommendations: string[] = [];
  pillars
    .sort((a, b) => a.rawScore - b.rawScore)
    .forEach((p) => {
      p.actions.forEach((a) => { if (!recommendations.includes(a)) recommendations.push(a); });
    });
  if (missingPenalties.length > 0) {
    const blockerMissing = missingPenalties.filter((p) => p.severity === "blocker");
    if (blockerMissing.length > 0) {
      recommendations.unshift(`Renseigner en priorité: ${blockerMissing.map((p) => p.label).join(", ")}`);
    }
  }

  return {
    score,
    grade,
    verdict,
    profile,
    pillars,
    drivers,
    recommendations: recommendations.slice(0, 10),
    missingPenalties,
    totalMissingPenalty,
    blockers,
    computedAt: new Date().toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════════
// ALERTS
// ════════════════════════════════════════════════════════════════════

export interface OperationAlert {
  id: string;
  severity: "info" | "warn" | "critical";
  title: string;
  message: string;
  pillar?: PillarKey;
}

export function computeAlertsFromOperation(
  operation: OperationSummary,
  scoreResult: SmartScoreUniversalResult
): OperationAlert[] {
  const alerts: OperationAlert[] = [];
  let idx = 0;
  const add = (severity: OperationAlert["severity"], title: string, message: string, pillar?: PillarKey) => {
    alerts.push({ id: `alert-${++idx}`, severity, title, message, pillar });
  };

  for (const b of scoreResult.blockers) add("critical", "Donnée bloquante", b);

  for (const p of scoreResult.pillars) {
    if (p.hasData && p.rawScore < 30) add("critical", `${p.label} — Score critique`, p.reasons.join(". "), p.key);
    else if (p.hasData && p.rawScore < 50) add("warn", `${p.label} — À surveiller`, p.reasons.join(". "), p.key);
  }

  const k = operation.kpis;
  if (k?.ltv && k.ltv > 90) add("critical", "LTV très élevé", `LTV de ${k.ltv}% — supérieur au seuil de 90%`, "ratios");
  if (k?.margin !== undefined && k.margin < 0) add("critical", "Marge négative", `Marge de ${k.margin}% — opération déficitaire`, "ratios");
  if (k?.dscr !== undefined && k.dscr < 1.0) add("critical", "DSCR < 1", `DSCR de ${k.dscr} — incapacité de remboursement`, "ratios");
  if (k?.dsti !== undefined && k.dsti > 45) add("warn", "Taux d'effort élevé", `DSTI de ${k.dsti}% — au-delà du seuil HCSF de 35%`, "ratios");

  const cleanedMissing = cleanMissing(operation);
  for (const m of cleanedMissing.filter((m) => m.severity === "blocker")) {
    add("warn", "Donnée manquante", `${m.label} — impact sur le score`);
  }

  return alerts;
}

// ════════════════════════════════════════════════════════════════════
// Verdict explanation (for comité)
// ════════════════════════════════════════════════════════════════════

export function buildVerdictExplanation(result: SmartScoreUniversalResult): string {
  const lines: string[] = [];
  lines.push(`Score: ${result.score}/100 (${result.grade}) — Verdict: ${result.verdict}`);
  lines.push(`Profil: ${result.profile}`);

  const forts = result.pillars.filter((p) => p.hasData && p.rawScore >= 70);
  if (forts.length > 0) lines.push(`Points forts: ${forts.map((p) => `${p.label} (${p.rawScore}/100)`).join(", ")}`);

  const faibles = result.pillars.filter((p) => p.hasData && p.rawScore < 45);
  if (faibles.length > 0) lines.push(`Points de vigilance: ${faibles.map((p) => `${p.label} (${p.rawScore}/100)`).join(", ")}`);

  if (result.missingPenalties.length > 0) lines.push(`Données manquantes: ${result.missingPenalties.length} élément(s), pénalité: -${result.totalMissingPenalty}pts`);

  if (result.blockers.length > 0) lines.push(`⛔ Blockers: ${result.blockers.join(" ; ")}`);

  return lines.join("\n");
}