// src/spaces/shared/risques/riskDisplay.ts
// ============================================================================
// SOCLE PARTAGÉ — HELPERS D'AFFICHAGE DE L'ÉTUDE DE RISQUES   VERSION 1.0.0
// ============================================================================
// Un seul exemplaire de ces fonctions pour RisquesPage et InvestisseurRisquesPanel.
// Elles étaient dupliquées ; la copie Investisseur n'avait jamais reçu les
// correctifs de nullabilité de v1.1.0, et `getScoreColor(null)` y tombait
// jusqu'au palier le plus alarmant (rouge « risque élevé ») sur une donnée
// simplement absente.
//
// Principe : une valeur non mesurée se rend en GRIS et en « — », jamais en vert
// (qui se lirait « sûr ») ni en rouge (qui se lirait « dangereux »).
// ============================================================================

import { Shield, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { BankRiskScoringGrade } from "@/components/banque/BanqueRiskScoreCard";
import type { Coverage, RiskLevel } from "./riskStudy.types";

/** Gris neutre : ni rassurant, ni alarmant. Réservé au « non mesuré ». */
export const COLOR_UNKNOWN = "#94a3b8";
export const BG_UNKNOWN = "#f1f5f9";

// ─── Formats ────────────────────────────────────────────────────────────────

export const formatNumber = (n: number | null | undefined, decimals = 0): string => {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
};

export const formatDistance = (m: number | null | undefined): string => {
  if (m == null) return "—";
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1)} km`;
};

/** Un score nul (non mesuré) se rend « — », jamais « null » ni « 0 ». */
export const formatScore = (score: number | null | undefined): string =>
  score == null || isNaN(score) ? "—" : String(score);

/** Largeur de barre de progression : 0 % quand rien n'est mesuré (évite `width:"null%"`). */
export const scoreBarWidth = (score: number | null | undefined): string =>
  score == null || isNaN(score) ? "0%" : `${Math.max(0, Math.min(100, score))}%`;

// ─── Mesuré / non mesuré ────────────────────────────────────────────────────

/**
 * `true` seulement si la source a réellement répondu. `no_data` et `error`
 * signifient qu'on n'a rien : le décompte qui les accompagne (souvent 0) ne
 * doit pas être publié comme un fait.
 */
export const isMeasured = (coverage: Coverage | null | undefined): boolean =>
  coverage != null && coverage !== 'no_data' && coverage !== 'error' && coverage !== 'unknown';

/** Une source dont le niveau est 'inconnu' n'a pas été mesurée. */
export const isLevelMeasured = (level: RiskLevel | null | undefined): boolean =>
  level != null && level !== 'inconnu';

/**
 * Décompte issu d'une source : « 0 » n'est publiable que si la source a
 * répondu. Sinon « — ». C'est exactement le défaut corrigé côté copilot-chat,
 * qui publiait « 0 site pollué » pour une API muette.
 */
export const formatSourceCount = (
  count: number | null | undefined,
  level: RiskLevel | null | undefined,
  coverage?: Coverage | null,
): string => {
  if (!isLevelMeasured(level)) return "—";
  if (coverage !== undefined && !isMeasured(coverage)) return "—";
  return formatNumber(count);
};

// ─── Couleurs & libellés par niveau ─────────────────────────────────────────

export const getRiskColor = (level: RiskLevel | null | undefined): string => {
  switch (level) {
    case 'tres_fort': return "#991b1b";
    case 'fort':      return "#dc2626";
    case 'moyen':     return "#f59e0b";
    case 'faible':    return "#22c55e";
    case 'nul':       return "#10b981";
    default:          return COLOR_UNKNOWN; // 'inconnu', null, undefined
  }
};

export const getRiskBg = (level: RiskLevel | null | undefined): string => {
  switch (level) {
    case 'tres_fort': return "#fef2f2";
    case 'fort':      return "#fee2e2";
    case 'moyen':     return "#fef3c7";
    case 'faible':    return "#dcfce7";
    case 'nul':       return "#ecfdf5";
    default:          return BG_UNKNOWN;
  }
};

export const getRiskLabel = (level: RiskLevel | null | undefined): string => {
  switch (level) {
    case 'tres_fort': return "Très fort";
    case 'fort':      return "Fort";
    case 'moyen':     return "Moyen";
    case 'faible':    return "Faible";
    case 'nul':       return "Nul";
    default:          return "Non mesuré";
  }
};

// ─── Scores de sécurité (100 = sûr) ─────────────────────────────────────────

/**
 * v1.1.0 : `null` = non mesuré → gris neutre.
 * L'ancienne signature `(score: number)` recevait quand même `null` à
 * l'exécution et tombait dans le `return "#dc2626"` final : une donnée absente
 * s'affichait rouge vif, comme un risque avéré.
 */
export const getScoreColor = (score: number | null | undefined): string => {
  if (score == null || isNaN(score)) return COLOR_UNKNOWN;
  if (score >= 80) return "#10b981";
  if (score >= 60) return "#22c55e";
  if (score >= 40) return "#f59e0b";
  return "#dc2626";
};

export interface VerdictConfig {
  label: string;
  color: string;
  bg: string;
  icon: LucideIcon;
}

export const getVerdictConfig = (score: number | null | undefined): VerdictConfig => {
  if (score == null || isNaN(score)) {
    return { label: "NON MESURÉ", color: "#475569", bg: BG_UNKNOWN, icon: ShieldOff };
  }
  if (score >= 80) return { label: "ZONE SÛRE",     color: "#047857", bg: "#ecfdf5", icon: ShieldCheck };
  if (score >= 60) return { label: "RISQUE FAIBLE", color: "#059669", bg: "#dcfce7", icon: Shield };
  if (score >= 40) return { label: "VIGILANCE",     color: "#d97706", bg: "#fef3c7", icon: ShieldAlert };
  return             { label: "RISQUE ÉLEVÉ",   color: "#991b1b", bg: "#fee2e2", icon: ShieldOff };
};

export const getBankGradeColor = (grade: BankRiskScoringGrade): string => {
  switch (grade) {
    case "A": return "#047857";
    case "B": return "#059669";
    case "C": return "#d97706";
    case "D": return "#dc2626";
    case "E": return "#991b1b";
    default:  return COLOR_UNKNOWN;
  }
};

// ─── Persistance ────────────────────────────────────────────────────────────

/**
 * Conversion d'un niveau d'aléa vers l'échelle numérique persistée dans
 * `PromoteurRisquesData` (score_inondation, score_retrait_argile).
 *
 * ⚠️ L'échelle 1-3 reproduit exactement celle déjà écrite en base par
 * RisquesPage : 'faible' et 'nul' y sont confondus à 1, 'tres_fort' plafonne
 * à 3. Ne PAS « améliorer » ce barème ici sans migrer l'existant : les deux
 * écrans écrivent dans la même colonne, et deux échelles concurrentes
 * recréeraient précisément la divergence que ce socle supprime.
 *
 * ⚠️ Le `: 1` de repli de l'implémentation d'origine enregistrait un aléa
 * 'inconnu' (source muette) comme un risque MINIMAL. Le trou de donnée
 * devenait un fait rassurant, puis ressortait dans l'analyse prédictive sans
 * plus aucune trace de son origine. On persiste `null` : la colonne reste
 * vide, ce qui est la seule chose vraie.
 */
export const niveauAleaToDb = (level: RiskLevel | null | undefined): number | null => {
  switch (level) {
    case 'tres_fort':
    case 'fort':   return 3;
    case 'moyen':  return 2;
    case 'faible':
    case 'nul':    return 1;
    default:       return null; // 'inconnu' ou absent → non mesuré
  }
};

// ─── Navigation ─────────────────────────────────────────────────────────────

/**
 * Identifiant de dossier banque lu dans l'URL (`/banque/risque/:id`).
 * Était dupliqué verbatim dans les deux écrans.
 */
export const extractDossierIdFromUrl = (): string | null => {
  try {
    const match = window.location.pathname.match(/\/banque\/risque\/([^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
};

/** Phrase de synthèse d'un score global, sans jamais inventer de note. */
export const summarizeGlobalScore = (score: number | null | undefined): string =>
  score == null || isNaN(score)
    ? "Étude de risques : aucun critère n'a pu être mesuré"
    : `Étude de risques : ${score}/100 de sécurité`;
