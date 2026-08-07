// src/spaces/investisseur/pages/analyse/InvestisseurRisquesPanel.tsx
// ============================================
// InvestisseurRisquesPanel — VERSION 1.4.0
// ============================================
// Étude de risques pour une parcelle/adresse, thème bleu Investisseur,
// + sauvegarde snapshot Marchand / projet Investisseur.
// Sources: Géorisques API, données gouvernementales
// + Banque scoring via banque-risques-v1
//
// ── v1.4.0 · MUTUALISATION ──────────────────────────────────────────────────
// Ce panel était un clone intégral de RisquesPage : mêmes types, mêmes helpers,
// mêmes cartes, recopiés. Les correctifs de nullabilité de risk-study v1.1.0
// n'avaient été portés que sur l'original, et cette copie continuait de
// présenter une donnée absente comme un fait rassurant — ou alarmant :
//   • `getScoreColor(null)` tombait dans le `return "#dc2626"` final : un score
//     non mesuré s'affichait ROUGE VIF, au palier le plus alarmant ;
//   • `width: \`${score}%\`` produisait `width:"null%"`, que le navigateur
//     ignore, laissant à l'écran la largeur de la barre précédente ;
//   • le PDF imprimait « null » en 56 px dans le bloc de score global ;
//   • « Hors zone PPRI » était écrit sur une réponse GASPAR muette ;
//   • le `: 1` de persistance enregistrait un aléa inconnu comme risque MINIMAL,
//     puis ce 1 ressortait dans l'analyse prédictive comme une mesure.
// Tout le socle (types, helpers, cartes) vient désormais de
// `src/spaces/shared/risques`, partagé avec RisquesPage. Une correction faite
// là s'applique aux deux écrans : le chemin de divergence est supprimé.
// MARQUEUR DE VERSION : import de `@/spaces/shared/risques`
// ============================================

import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Atom,
  Bug,
  CheckCircle,
  ChevronDown, ChevronUp,
  CircleDot, Compass,
  Download,
  Droplets,
  Factory,
  FileText,
  Flame,
  Grid3X3,
  Info,
  Landmark,
  Layers,
  Loader2,
  MapPin,
  Mountain,
  Shield, ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Skull,
  Target,
  X
} from "lucide-react";
import type { ErrorInfo, ReactNode} from "react";
import React, { Component, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { LucideIcon } from "lucide-react";

import { searchAddress } from "../../../promoteur/etudes/marche/services/address.service";
import { searchParcel } from "../../../promoteur/etudes/marche/services/parcel.service";

import type {
  AddressSuggestion,
  ParcelInfo,
} from "../../../promoteur/etudes/marche/types/market.types";

import { patchModule, patchProjectInfo } from "../../../promoteur/shared/promoteurSnapshot.store";

import type { BankRiskScoring, BankRiskScoringGrade } from "../../../../components/banque/BanqueRiskScoreCard";
import { BanqueRiskScoreCard } from "../../../../components/banque/BanqueRiskScoreCard";

import type { PromoteurRisquesData } from "../../../promoteur/shared/promoteurStudy.types";
import { usePromoteurStudy } from "../../../promoteur/shared/usePromoteurStudy";

import { useCopilotContext } from "../../../copilot/hooks/useCopilotContext";
// 🆕 COPILOT LOT 9 : injection de l'etude de risques calculee dans le contexte actif
import { setActiveCopilotContext } from "../../../copilot/store/activeCopilotContext.store";
import { readMarchandSnapshot } from "../../../marchand/shared/marchandSnapshot.store";
import { getInvestisseurSnapshot, upsertInvestisseurProject } from "../../shared/investisseurSnapshot.store";
import { userStorage } from "@/lib/storage/userScopedStorage";

// ─── Socle partagé de l'étude de risques (voir en-tête v1.4.0) ───────────────
import {
  CatnatCard,
  CategoryScoreBar,
  GeotechCard,
  IcpeCard,
  InsightCard,
  NaturalRisksCard,
  PollutionCard,
  RiskGauge,
  formatSourceCount,
  getBankGradeColor,
  getRiskBg,
  getRiskColor,
  getRiskLabel,
  getScoreColor,
  getVerdictConfig,
  isLevelMeasured,
  isMeasured,
  niveauAleaToDb,
  scoreBarWidth,
  summarizeGlobalScore,
} from "@/spaces/shared/risques";

import type {
  Insight,
  InsightType,
  RiskLevel,
  RiskStudyApiResponse,
} from "@/spaces/shared/risques";

// ─── Design tokens par défaut (Investisseur = bleu) ───────────────────────────
const GRAD_PRO   = "linear-gradient(90deg, #2196f3 0%, #21cbf3 100%)";
const ACCENT_PRO = "#1a72c4";

const DEBUG_MODE = true;
const log = (prefix: string, message: string, data?: unknown) => {
  if (DEBUG_MODE) console.log(`${prefix} ${message}`, data ?? '');
};

// ============================================================================
// TYPES
// ============================================================================
// v1.4.0 : plus aucune interface locale ici.
//
// Les types étaient redéclarés dans ce fichier avec des signatures PLUS
// PERMISSIVES que la réalité de l'API : `global: number` là où risk-study
// renvoie `number | null`, `ppri: boolean` là où GASPAR peut ne rien dire.
// `tsc` validait donc un rendu qui, à l'exécution, recevait `null` partout —
// c'est exactement pourquoi le compilateur n'a jamais signalé les régressions.
// La source unique est `@/spaces/shared/risques/riskStudy.types`.

// ============================================
// ERROR BOUNDARY
// ============================================

interface ErrorBoundaryState { hasError: boolean; error: Error | null; }
interface ErrorBoundaryProps { children: ReactNode; componentName?: string; }

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`ErrorBoundary caught error in ${this.props.componentName}:`, error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "40px", textAlign: "center", background: "#fef2f2", borderRadius: "12px", border: "1px solid #fecaca", margin: "20px" }}>
          <AlertTriangle size={48} color="#dc2626" style={{ marginBottom: "16px" }} />
          <h3 style={{ color: "#991b1b", marginBottom: "8px" }}>Erreur dans {this.props.componentName || 'un composant'}</h3>
          <button onClick={() => this.setState({ hasError: false, error: null })} style={{ padding: "10px 20px", background: "#dc2626", color: "white", border: "none", borderRadius: "8px", cursor: "pointer" }}>
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================
// HELPERS
// ============================================
// v1.4.0 : les helpers d'affichage viennent de `@/spaces/shared/risques`.
// La copie locale de `getScoreColor` avait la signature `(score: number)` et
// recevait pourtant `null` à l'exécution ; elle traversait tous les seuils et
// retournait le rouge du dernier `return`. Une donnée manquante s'affichait
// comme un risque avéré.

// ============================================
// STYLES
// ============================================

const styles = {
  container: {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
} as React.CSSProperties,
  mainContent: {
  margin: "0 auto",
  padding: "0",
} as React.CSSProperties,
  formSection: {
    background: "white",
    borderRadius: "16px",
    padding: "28px",
    marginBottom: "24px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
    border: "1px solid #e2e8f0",
  } as React.CSSProperties,
  card: {
    background: "white",
    borderRadius: "16px",
    padding: "24px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
    border: "1px solid #e2e8f0",
  } as React.CSSProperties,
  cardTitle: {
    fontSize: "16px",
    fontWeight: 700,
    color: "#1e293b",
    marginBottom: "16px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
  } as React.CSSProperties,
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "4px 10px",
    borderRadius: "6px",
    fontSize: "11px",
    fontWeight: 600,
  } as React.CSSProperties,
  input: {
    padding: "12px 14px",
    borderRadius: "10px",
    border: "1px solid #e2e8f0",
    fontSize: "14px",
    transition: "all 0.2s",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,
};

// ============================================
// COMPOSANTS DE PRÉSENTATION
// ============================================
// v1.4.0 : RiskGauge, CategoryScoreBar, InsightCard, RiskDetailCard, CatnatCard,
// IcpeCard, NaturalRisksCard, GeotechCard et PollutionCard sont importés depuis
// `@/spaces/shared/risques`. Les copies locales supprimées ici affichaient un
// score `null` comme un « 0 » rouge et posaient `width:"null%"` sur les barres.

// ============================================
// RESULTS COMPONENT
// ============================================
const RiskStudyResults: React.FC<{
  data: RiskStudyApiResponse;
  bankScoring: BankRiskScoring | null;
  isBankScoringLoading: boolean;
  accentColor: string;
  headerGradient: string;
}> = ({ data, bankScoring, isBankScoringLoading, accentColor, headerGradient }) => {
  const { meta, scores, categories, insights, data: riskData } = data;
  const criticalInsights = insights.filter(i => i.type === 'critical');
  const warningInsights  = insights.filter(i => i.type === 'warning');
  const positiveInsights = insights.filter(i => i.type === 'positive');
  const infoInsights     = insights.filter(i => i.type === 'info');
  const [synthesisSaved, setSynthesisSaved] = useState(false);

  // ── Drapeaux « cette source a-t-elle réellement répondu ? » ────────────────
  // Calculés une seule fois et consommés à la fois par l'écran et par le PDF,
  // pour que les deux racontent la même chose. Sans eux, les décomptes à 0
  // d'une API muette étaient publiés comme des constats.
  const gasparMesure  = isMeasured(riskData.gaspar.coverage);
  const icpeMesure    = isLevelMeasured(riskData.icpe.risk_level) && isMeasured(riskData.icpe.coverage);
  const sisMesure     = isLevelMeasured(riskData.sis.risk_level) && isMeasured(riskData.sis.coverage);
  const cavitesMesure = isLevelMeasured(riskData.cavites.risk_level) && isMeasured(riskData.cavites.coverage);
  const mvtMesure     = isLevelMeasured(riskData.mouvements_terrain.risk_level) && isMeasured(riskData.mouvements_terrain.coverage);

  const handleGeneratePdf = useCallback(() => {
    const verdict = getVerdictConfig(scores.global);
    const scoreColor = getScoreColor(scores.global);
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('Autorisez les popups pour générer le PDF'); return; }
    const fmtN =(n: number | null | undefined, d = 0) => n == null || isNaN(n) ? '—' : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
    const fmtDist = (m: number | null | undefined) => m == null ? '—' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
    const riskBadge = (level: RiskLevel) => { const c = getRiskColor(level); const b = getRiskBg(level); return `<span style="padding:3px 10px;background:${b};color:${c};border-radius:6px;font-size:11px;font-weight:600;">${getRiskLabel(level)}</span>`; };
    const sectionTitle = (icon: string, title: string) => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;padding-bottom:10px;border-bottom:2px solid #e2e8f0;"><span style="font-size:18px;">${icon}</span><span style="font-size:17px;font-weight:700;color:#1e293b;">${title}</span></div>`;
    const section = (content: string) => `<div style="background:white;border-radius:14px;padding:24px;margin-bottom:20px;border:1px solid #e2e8f0;page-break-inside:avoid;">${content}</div>`;
    const kpiBox = (label: string, value: string, color = '#1e293b', sub = '') => `<div style="background:#f8fafc;border-radius:10px;padding:14px;text-align:center;border:1px solid #e2e8f0;"><div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;margin-bottom:6px;">${label}</div><div style="font-size:22px;font-weight:800;color:${color};">${value}</div>${sub ? `<div style="font-size:10px;color:#94a3b8;margin-top:3px;">${sub}</div>` : ''}</div>`;
    // Une section dont la source est muette le dit, au lieu d'imprimer des zéros.
    const nonMesureRow = (source: string) => `<div style="padding:12px 14px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;color:#475569;">Non mesuré : ${source} n'a pas répondu lors de la génération de ce rapport. L'absence de donnée n'est pas une absence de risque.</div>`;
    const insightRow = (type: InsightType, cat: string, msg: string) => { const cfg: Record<InsightType, {bg:string;border:string;dot:string}> = { critical:{bg:'#fef2f2',border:'#fecaca',dot:'#dc2626'}, warning:{bg:'#fef3c7',border:'#fcd34d',dot:'#f59e0b'}, positive:{bg:'#ecfdf5',border:'#a7f3d0',dot:'#10b981'}, info:{bg:'#f0f9ff',border:'#bae6fd',dot:'#0ea5e9'} }; const c = cfg[type]; return `<div style="padding:12px 14px;background:${c.bg};border:1px solid ${c.border};border-radius:8px;margin-bottom:8px;display:flex;gap:10px;align-items:flex-start;"><span style="width:8px;height:8px;border-radius:50%;background:${c.dot};margin-top:5px;flex-shrink:0;display:inline-block;"></span><div><span style="font-size:9px;font-weight:600;color:#64748b;text-transform:uppercase;">${cat}</span><p style="font-size:13px;color:#1e293b;margin:3px 0 0 0;line-height:1.5;">${msg}</p></div></div>`; };
    // Une catégorie non mesurée : barre vide et mention explicite. L'ancienne
    // version interpolait `null` et produisait `width:"null%"` — déclaration CSS
    // invalide, ignorée par le moteur d'impression — puis affichait « null »
    // comme s'il s'agissait d'une note.
    const bar = (score: number | null, level: RiskLevel) => {
      const c = getRiskColor(level);
      if (score == null) {
        return `<div style="display:flex;align-items:center;gap:10px;"><div style="flex:1;height:8px;background:#e2e8f0;border-radius:4px;"></div><span style="font-size:11px;font-weight:600;color:#94a3b8;min-width:70px;">non mesuré</span></div>`;
      }
      return `<div style="display:flex;align-items:center;gap:10px;"><div style="flex:1;height:8px;background:#e2e8f0;border-radius:4px;"><div style="width:${scoreBarWidth(score)};height:100%;background:${c};border-radius:4px;"></div></div><span style="font-size:13px;font-weight:700;color:${c};min-width:24px;">${score}</span></div>`;
    };
    const bankSection = bankScoring ? section(`${sectionTitle('🏦', 'Scoring Banque — Risques')}<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">${kpiBox('Score', String(bankScoring.score), getBankGradeColor(bankScoring.grade))}${kpiBox('Grade', bankScoring.grade, getBankGradeColor(bankScoring.grade))}${kpiBox('Niveau', bankScoring.level_label, '#1e293b')}${kpiBox('Confiance', Math.round(bankScoring.confidence * 100) + '%', '#6366f1')}</div>${bankScoring.rationale.slice(0, 3).map(r => insightRow('info', 'Banque', r)).join('')}`) : '';
    const catnatRows = riskData.gaspar.catnat_events.slice(0, 10).map((e, i) => `<tr style="background:${i%2===0?'#f8fafc':'white'};"><td style="padding:8px 10px;font-size:12px;color:#1e293b;">${e.libelle_risque || '—'}</td><td style="padding:8px 10px;font-size:12px;color:#64748b;">${e.date_debut || '—'}</td><td style="padding:8px 10px;font-size:12px;color:#64748b;">${e.date_fin || '—'}</td></tr>`).join('');
    const icpeRows = riskData.icpe.installations.slice(0, 10).map((inst, i) => `<tr style="background:${inst.seveso ? '#fef2f2' : i%2===0?'#f8fafc':'white'};"><td style="padding:8px 10px;font-size:12px;font-weight:600;color:#1e293b;">${inst.nom}</td><td style="padding:8px 10px;font-size:12px;color:#64748b;">${inst.activite || '—'}</td><td style="padding:8px 10px;font-size:12px;color:${inst.seveso ? '#dc2626' : '#64748b'};font-weight:${inst.seveso ? 600 : 400};">${inst.seveso || '—'}</td><td style="padding:8px 10px;font-size:12px;color:#64748b;">${fmtDist(inst.distance_m)}</td></tr>`).join('');
    const htmlContent = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Étude de Risques — ${meta.commune_nom}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;padding:40px;color:#1e293b;line-height:1.6}@media print{body{padding:20px;background:white}@page{margin:15mm}}table{width:100%;border-collapse:collapse}th{background:#f1f5f9;padding:10px 12px;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;text-align:left}</style></head><body>
    <div style="background:${headerGradient};border-radius:16px;padding:36px 40px;margin-bottom:28px;color:white;">
      <div style="font-size:12px;opacity:0.6;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">Mimmoza · Étude de Risques</div>
      <h1 style="font-size:32px;font-weight:800;margin-bottom:6px;">${meta.commune_nom}</h1>
      <p style="font-size:14px;opacity:0.75;margin-bottom:28px;">${meta.region} · Département ${meta.departement} · Rayon ${meta.radius_km} km · v${data.version}</p>
      <div style="display:grid;grid-template-columns:160px 1fr auto;gap:32px;align-items:center;">
        <div style="text-align:center;background:rgba(255,255,255,0.1);border-radius:14px;padding:20px;">
          <!-- « null » s'imprimait ici en 56 px, en tête du rapport remis au client. -->
          <div style="font-size:56px;font-weight:800;color:${scoreColor};line-height:1;">${scores.global ?? '—'}</div>
          <div style="font-size:12px;opacity:0.6;margin-bottom:8px;">${scores.global == null ? 'non mesuré' : '/100'}</div>
          <div style="padding:6px 14px;background:${verdict.bg};color:${verdict.color};border-radius:8px;font-weight:700;font-size:13px;display:inline-block;">${verdict.label}</div>
        </div>
        <div style="background:rgba(255,255,255,0.08);border-radius:14px;padding:20px;">
          <div style="font-size:11px;opacity:0.65;font-weight:600;text-transform:uppercase;margin-bottom:14px;">Scores par catégorie</div>
          ${categories.map(cat => `<div style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;"><span style="font-size:12px;opacity:0.85;">${cat.name}</span>${riskBadge(cat.level)}</div>${bar(cat.score, cat.level)}</div>`).join('')}
        </div>
        <div style="background:rgba(255,255,255,0.08);border-radius:14px;padding:20px;min-width:180px;">
          <div style="font-size:11px;opacity:0.65;font-weight:600;text-transform:uppercase;margin-bottom:14px;">Données clés</div>
          ${/* Un « 0 » ne se publie que si la source a répondu : sinon « — ».
                Ces six chiffres sont ceux que le lecteur retient du rapport. */[
            {label:'Arrêtés CATNAT',   value: gasparMesure ? String(riskData.gaspar.catnat_count) : '—'},
            {label:'PPR applicables',  value: gasparMesure ? String(riskData.gaspar.ppr_count) : '—'},
            {label:'Sites SEVESO',     value: icpeMesure ? String(riskData.icpe.seveso_haut_count+riskData.icpe.seveso_bas_count) : '—'},
            {label:'Sites pollués SIS',value: formatSourceCount(riskData.sis.count, riskData.sis.risk_level, riskData.sis.coverage)},
            {label:'Zone sismique',    value: String(riskData.seisme.zone??'—')},
            {label:'Classe radon',     value: String(riskData.radon.classe_potentiel??'—')},
          ].map(k=>`<div style="margin-bottom:8px;"><div style="font-size:10px;opacity:0.6;">${k.label}</div><div style="font-size:15px;font-weight:700;">${k.value}</div></div>`).join('')}
        </div>
      </div>
    </div>
    ${bankSection}
    ${(criticalInsights.length > 0 || warningInsights.length > 0 || positiveInsights.length > 0) ? section(`<div style="display:grid;grid-template-columns:repeat(${[criticalInsights,warningInsights,positiveInsights].filter(a=>a.length>0).length},1fr);gap:24px;">${criticalInsights.length > 0 ? `<div>${sectionTitle('🚨','Alertes critiques')}${criticalInsights.map(i=>insightRow(i.type,i.category,i.message)).join('')}</div>` : ''}${warningInsights.length > 0 ? `<div>${sectionTitle('⚠️','Points de vigilance')}${warningInsights.map(i=>insightRow(i.type,i.category,i.message)).join('')}</div>` : ''}${positiveInsights.length > 0 ? `<div>${sectionTitle('✅','Points positifs')}${positiveInsights.map(i=>insightRow(i.type,i.category,i.message)).join('')}</div>` : ''}</div>`) : ''}
    ${section(`${sectionTitle('🌊','Risques Naturels')}<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">${kpiBox('Inondation',getRiskLabel(riskData.inondation.risk_level),getRiskColor(riskData.inondation.risk_level),riskData.inondation.ppri==null?'PPRI non vérifié':riskData.inondation.ppri?'PPRI actif':'Hors PPRI')}${kpiBox('Séisme',riskData.seisme.zone==null?'Non déterminée':`Zone ${riskData.seisme.zone}`,getRiskColor(riskData.seisme.risk_level),riskData.seisme.libelle)}${kpiBox('Feux de forêt',getRiskLabel(riskData.feux_foret.risk_level),getRiskColor(riskData.feux_foret.risk_level),riskData.feux_foret.zone_risque==null?'Exposition non vérifiée':riskData.feux_foret.zone_risque?'Zone exposée':'Hors zone')}${kpiBox('Argiles (RGA)',getRiskLabel(riskData.argiles.risk_level),getRiskColor(riskData.argiles.risk_level),riskData.argiles.niveau_alea||'Non évalué')}</div>`)}
    ${section(`${sectionTitle('☢️','Pollution & Qualité des Sols')}<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">${kpiBox('Sites pollués (SIS)',formatSourceCount(riskData.sis.count,riskData.sis.risk_level,riskData.sis.coverage),!sisMesure?'#94a3b8':riskData.sis.count>0?'#dc2626':'#10b981',sisMesure?'':'Base SIS indisponible')}${kpiBox('Radon — Classe',String(riskData.radon.classe_potentiel??'—'),getRiskColor(riskData.radon.risk_level),riskData.radon.classe_potentiel==null?'Non renseigné pour cette commune':riskData.radon.libelle)}${kpiBox('Niveau risque pollution',getRiskLabel(riskData.sis.risk_level),getRiskColor(riskData.sis.risk_level))}</div>${sisMesure&&riskData.sis.count>0?`<div style="margin-top:16px;"><div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;margin-bottom:10px;">Sites SIS identifiés</div>${riskData.sis.sites.map(s=>`<div style="padding:10px 14px;background:#fef2f2;border-radius:8px;margin-bottom:8px;border-left:4px solid #dc2626;"><div style="font-size:13px;font-weight:600;color:#991b1b;">${s.nom}</div><div style="font-size:11px;color:#b91c1c;margin-top:2px;">${s.adresse||s.commune}${s.superficie_m2?` · ${fmtN(s.superficie_m2)} m²`:''}</div></div>`).join('')}</div>`:''}${!sisMesure?nonMesureRow('la base SIS'):''}`)}
    ${section(`${sectionTitle('🪨','Risques Géotechniques')}<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:16px;">${kpiBox('Cavités souterraines',formatSourceCount(riskData.cavites.count,riskData.cavites.risk_level,riskData.cavites.coverage),getRiskColor(riskData.cavites.risk_level),!cavitesMesure?'Base cavités indisponible':riskData.cavites.cavites[0]?.distance_m?`Plus proche: ${fmtDist(riskData.cavites.cavites[0].distance_m)}`:'Dans le secteur')}${kpiBox('Mouvements de terrain',formatSourceCount(riskData.mouvements_terrain.count,riskData.mouvements_terrain.risk_level,riskData.mouvements_terrain.coverage),getRiskColor(riskData.mouvements_terrain.risk_level),mvtMesure?'événements recensés':'Base indisponible')}</div>${(!cavitesMesure||!mvtMesure)?nonMesureRow(!cavitesMesure&&!mvtMesure?'les bases cavités et mouvements de terrain':!cavitesMesure?'la base cavités':'la base mouvements de terrain'):''}`)}
    ${section(`${sectionTitle('📋','Catastrophes Naturelles — CATNAT / GASPAR')}${gasparMesure?`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:${riskData.gaspar.catnat_count>0?'20px':'0'};">${kpiBox('Arrêtés CATNAT',String(riskData.gaspar.catnat_count),riskData.gaspar.catnat_count>5?'#dc2626':riskData.gaspar.catnat_count>0?'#f59e0b':'#10b981')}${kpiBox('PPR applicables',String(riskData.gaspar.ppr_count),riskData.gaspar.ppr_count>0?'#d97706':'#10b981')}</div>${catnatRows?`<table><thead><tr><th>Type de risque</th><th>Début</th><th>Fin</th></tr></thead><tbody>${catnatRows}</tbody></table>`:''}`:nonMesureRow('la base GASPAR')}`)}
    ${section(`${sectionTitle('🏭','Installations Industrielles — ICPE / SEVESO')}${icpeMesure?`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:${riskData.icpe.count>0?'20px':'0'};">${kpiBox('SEVESO Seuil Haut',String(riskData.icpe.seveso_haut_count),riskData.icpe.seveso_haut_count>0?'#991b1b':'#10b981')}${kpiBox('SEVESO Seuil Bas',String(riskData.icpe.seveso_bas_count),riskData.icpe.seveso_bas_count>0?'#d97706':'#10b981')}${kpiBox('ICPE total',String(riskData.icpe.count),'#64748b')}</div>${icpeRows?`<table><thead><tr><th>Nom</th><th>Activité</th><th>SEVESO</th><th>Distance</th></tr></thead><tbody>${icpeRows}</tbody></table>`:''}`:nonMesureRow('le registre ICPE')}`)}
    ${infoInsights.length > 0 ? section(`${sectionTitle('ℹ️','Informations complémentaires')}${infoInsights.map(i=>insightRow(i.type,i.category,i.message)).join('')}`) : ''}
    <div style="text-align:center;padding-top:24px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px;"><p>Rapport généré le ${new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}</p><p style="margin-top:4px;">Mimmoza · Plateforme d'analyse immobilière intelligente · Sources : Géorisques, GASPAR, BRGM, ICPE</p></div>
    </body></html>`;
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.onload = () => { setTimeout(() => { printWindow.print(); }, 300); };
  }, [meta, scores, categories, criticalInsights, warningInsights, positiveInsights, infoInsights, riskData, bankScoring, data, headerGradient, accentColor,
      gasparMesure, icpeMesure, sisMesure, cavitesMesure, mvtMesure]);

  const categoryIcons: Record<string, LucideIcon> = {
    "Risques Naturels": Mountain,
    "Risques Technologiques": Factory,
    "Pollution": Bug,
    "Risques Géotechniques": Layers,
  };

  return (
    <ErrorBoundary componentName="RiskStudyResults">
      <div>
        {isBankScoringLoading && <BanqueRiskScoreCard scoring={{ score: 0, grade: "C", level_label: "", confidence: 0, rationale: [], items: [] }} isLoading />}
        {!isBankScoringLoading && bankScoring && <BanqueRiskScoreCard scoring={bankScoring} />}

        <div style={{ background: headerGradient, borderRadius: "20px", padding: "32px", marginBottom: "24px", color: "white" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: "32px", alignItems: "center" }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <RiskGauge score={scores.global} size={180} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                <ShieldAlert size={28} />
                <h2 style={{ fontSize: "26px", fontWeight: 700, margin: 0 }}>
                  {meta.commune_nom}
                  <span style={{ fontSize: "16px", fontWeight: 400, opacity: 0.7, marginLeft: "10px" }}>({meta.departement})</span>
                </h2>
              </div>
              <p style={{ fontSize: "14px", opacity: 0.8, marginBottom: "20px" }}>{meta.region} • Rayon d'analyse: {meta.radius_km} km • API v{data.version}</p>
              {/* Ces trois compteurs sont les premiers chiffres lus à l'écran.
                  Une API muette renvoie 0 : sans ce garde-fou, « 0 arrêté
                  CATNAT / 0 site SEVESO » s'affichait en 26 px comme un
                  constat rassurant alors que rien n'avait été interrogé. */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "14px" }}>
                  <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>Arrêtés CATNAT</div>
                  <div style={{ fontSize: "26px", fontWeight: 700 }}>
                    {gasparMesure ? riskData.gaspar.catnat_count : "—"}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "14px" }}>
                  <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>Sites SEVESO</div>
                  <div style={{ fontSize: "26px", fontWeight: 700 }}>
                    {icpeMesure ? riskData.icpe.seveso_haut_count + riskData.icpe.seveso_bas_count : "—"}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "14px" }}>
                  <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>PPR actifs</div>
                  <div style={{ fontSize: "26px", fontWeight: 700 }}>
                    {gasparMesure ? riskData.gaspar.ppr_count : "—"}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "16px", padding: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "16px", opacity: 0.9 }}>Scores par catégorie</div>
              {categories.map((cat, i) => (
                <CategoryScoreBar
                  key={i}
                  name={cat.name}
                  score={cat.score}
                  level={cat.level}
                  icon={categoryIcons[cat.name] || Shield}
                  criteresMesures={cat.criteres_mesures}
                  criteresTotal={cat.criteres_total}
                />
              ))}
              {/* Portée de l'étude : combien de critères ont réellement répondu.
                  Sans ce compteur, un score partiel se lit comme un score complet. */}
              {scores.criteres_total != null && (
                <div style={{ fontSize: "11px", opacity: 0.75, marginTop: "10px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.2)" }}>
                  {scores.criteres_mesures ?? 0} critère(s) mesuré(s) sur {scores.criteres_total}
                  {Array.isArray(scores.categories_non_mesurees) && scores.categories_non_mesurees.length > 0
                    && ` — non mesuré : ${scores.categories_non_mesurees.join(", ")}`}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          {criticalInsights.length > 0 && (
            <div style={{ ...styles.card, borderLeft: "4px solid #dc2626" }}>
              <div style={styles.cardTitle}><AlertOctagon size={20} color="#dc2626" />Alertes Critiques ({criticalInsights.length})</div>
              {criticalInsights.map((insight, i) => <InsightCard key={i} insight={insight} />)}
            </div>
          )}
          {warningInsights.length > 0 && (
            <div style={{ ...styles.card, borderLeft: "4px solid #f59e0b" }}>
              <div style={styles.cardTitle}><AlertTriangle size={20} color="#f59e0b" />Points de Vigilance ({warningInsights.length})</div>
              {warningInsights.map((insight, i) => <InsightCard key={i} insight={insight} />)}
            </div>
          )}
          {positiveInsights.length > 0 && (
            <div style={{ ...styles.card, borderLeft: "4px solid #10b981" }}>
              <div style={styles.cardTitle}><CheckCircle size={20} color="#10b981" />Points Positifs ({positiveInsights.length})</div>
              {positiveInsights.map((insight, i) => <InsightCard key={i} insight={insight} />)}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          <NaturalRisksCard inondation={riskData.inondation} seisme={riskData.seisme} feuxForet={riskData.feux_foret} argiles={riskData.argiles} />
          <PollutionCard sis={riskData.sis} radon={riskData.radon} />
        </div>
        <div style={{ marginBottom: "24px" }}><GeotechCard cavites={riskData.cavites} mvt={riskData.mouvements_terrain} /></div>
        <div style={{ marginBottom: "24px" }}><CatnatCard gaspar={riskData.gaspar} /></div>
        <div style={{ marginBottom: "24px" }}><IcpeCard icpe={riskData.icpe} /></div>

        {infoInsights.length > 0 && (
          <div style={{ ...styles.card, marginBottom: "24px" }}>
            <div style={styles.cardTitle}><Info size={20} color="#0ea5e9" />Informations complémentaires</div>
            {infoInsights.map((insight, i) => <InsightCard key={i} insight={insight} />)}
          </div>
        )}

        {data.debug?.timings && DEBUG_MODE && (
          <div style={{ ...styles.card, background: "#f8fafc", marginBottom: "24px" }}>
            <div style={styles.cardTitle}><Activity size={20} color="#64748b" />Debug - Timings (ms)</div>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              {Object.entries(data.debug.timings).map(([key, value]) => (
                <div key={key} style={{ padding: "8px 14px", background: "white", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>{key}: </span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: value > 1000 ? "#ef4444" : "#10b981" }}>{value}ms</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "center", gap: "16px", marginTop: "32px" }}>
          <button
            onClick={() => {
              // `${null}/100` écrivait « Score sécurité: null/100 » dans la
              // synthèse, que le Copilot relit ensuite comme une note.
              patchModule("risks", {
                ok: true,
                validated: true,
                summary: `${summarizeGlobalScore(scores.global)} - ${meta.commune_nom}`,
                data,
              });
              setSynthesisSaved(true);
              setTimeout(() => setSynthesisSaved(false), 3000);
            }}
            style={{
              display: "flex", alignItems: "center", gap: "8px", padding: "14px 28px",
              background: synthesisSaved ? "linear-gradient(135deg, #10b981 0%, #059669 100%)" : `linear-gradient(135deg, ${accentColor} 0%, ${accentColor}cc 100%)`,
              color: "white", border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer",
            }}
          >
            <Target size={18} />
            {synthesisSaved ? "✓ Enregistré dans la synthèse" : "Utiliser pour la synthèse"}
          </button>
          <button
            onClick={handleGeneratePdf}
            style={{ display: "flex", alignItems: "center", gap: "8px", padding: "14px 28px", background: "#7f1d1d", color: "white", border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
          >
            <FileText size={18} />
            Générer le rapport PDF
          </button>
          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `etude-risques-${meta.commune_nom}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{ display: "flex", alignItems: "center", gap: "8px", padding: "14px 28px", background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
          >
            <Download size={18} />
            Exporter JSON
          </button>
        </div>
      </div>
    </ErrorBoundary>
  );
};

// ============================================
// HELPERS
// ============================================

function extractDossierIdFromUrl(): string | null {
  try {
    const match = window.location.pathname.match(/\/banque\/risque\/([^/]+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function InvestisseurRisquesPanel() {

  const GRAD   = GRAD_PRO;
  const ACCENT = ACCENT_PRO;
  const RESULTS_HEADER_GRADIENT = "linear-gradient(135deg, #1e293b 0%, #2196f3 50%, #1e293b 100%)";

  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");
  const { study, loadState, patchRisques } = usePromoteurStudy(studyId);
  const { setContextHints } = useCopilotContext();

  const [address, setAddress]                       = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [selectedAddress, setSelectedAddress]       = useState<AddressSuggestion | null>(null);
  const [parcelId, setParcelId]                     = useState("");
  const [parcelInfo, setParcelInfo]                 = useState<ParcelInfo | null>(null);
  const [isSearchingParcel, setIsSearchingParcel]   = useState(false);
  const [latitude, setLatitude]                     = useState("");
  const [longitude, setLongitude]                   = useState("");
  const [codeInsee, setCodeInsee]                   = useState("");
  const [radius, setRadius]                         = useState(5);
  const [isLoading, setIsLoading]                   = useState(false);
  const [analysisResult, setAnalysisResult]         = useState<RiskStudyApiResponse | null>(null);
  const [error, setError]                           = useState<string | null>(null);
  const [bankScoring, setBankScoring]               = useState<BankRiskScoring | null>(null);
  const [isBankScoringLoading, setIsBankScoringLoading] = useState(false);
  const [bankScoringError, setBankScoringError]     = useState<string | null>(null);
  const [synthesisSaved, setSynthesisSaved]         = useState(false);

  const addressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const parcelTimeoutRef  = useRef<NodeJS.Timeout | null>(null);
  const resultsRef        = useRef<HTMLDivElement | null>(null);
  const mountedRef        = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Pré-remplissage depuis le deal Marchand actif ──
  useEffect(() => {
    try {
      const snap = readMarchandSnapshot();
      const deal = snap.activeDealId ? snap.deals.find((d) => d.id === snap.activeDealId) : null;
      if (!deal) return;
      if (deal.address) setAddress(deal.address);
      const mr = snap.marcheRisquesByDeal?.[deal.id];
      const data = (mr?.data ?? null) as Record<string, unknown> | undefined;
      if (typeof data?.lat === "number") setLatitude(String(data.lat));
      if (typeof data?.lng === "number") setLongitude(String(data.lng));
      if (typeof data?.lon === "number") setLongitude(String(data.lon));
      if (typeof data?.commune_insee === "string") setCodeInsee(data.commune_insee);
    } catch (e) {
      console.warn("[GeorisquesPanel] pré-remplissage échoué", e);
    }
  }, []);

  // ── Hydratation depuis l'étude Promoteur (studyId) ──
  useEffect(() => {
    if (loadState !== "ready") return;
    if (study?.foncier?.commune_insee && !codeInsee) setCodeInsee(study.foncier.commune_insee);
    if (study?.foncier?.focus_id && !parcelId) setParcelId(study.foncier.focus_id);
    if (study?.risques?.raw_georisques && analysisResult === null) setAnalysisResult(study.risques.raw_georisques as unknown as RiskStudyApiResponse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState, study]);

  useEffect(() => {
    const lat = latitude ? parseFloat(latitude) : NaN;
    const lng = longitude ? parseFloat(longitude) : NaN;
    const insee = analysisResult?.meta?.commune_insee || codeInsee || undefined;
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    if (!insee && !hasCoords) return;
    setContextHints({
      vertical: "promoteur",
      parcel: {
        id: studyId || parcelId || insee || "parcelle",
        lat: hasCoords ? lat : undefined,
        lng: hasCoords ? lng : undefined,
        code_insee: insee,
        address: selectedAddress?.label || address || undefined,
        commune: analysisResult?.meta?.commune_nom || undefined,
      },
      study: studyId ? { id: studyId, type: "promoteur" } : undefined,
    });
  }, [latitude, longitude, codeInsee, analysisResult, studyId, parcelId, selectedAddress, address, setContextHints]);

  // 🆕 COPILOT LOT 9 : pousse l'etude de risques calculee dans le contexte du Copilot.
  // Des qu'un resultat est disponible (analyse fraiche OU hydratation), le Copilot
  // repond aux questions de risques DIRECTEMENT a partir de ces donnees, sans appeler
  // d'outil et sans halluciner. On nettoie quand il n'y a plus de resultat.
  useEffect(() => {
    if (analysisResult) {
      setActiveCopilotContext({
        risk_study: analysisResult as unknown as Record<string, unknown>,
      });
    } else {
      setActiveCopilotContext({ risk_study: undefined });
    }
  }, [analysisResult]);

  useEffect(() => {
    if (addressTimeoutRef.current) clearTimeout(addressTimeoutRef.current);
    if (address.length >= 3 && !selectedAddress) {
      setIsSearchingAddress(true);
      addressTimeoutRef.current = setTimeout(async () => {
        const suggestions = await searchAddress(address);
        setAddressSuggestions(suggestions);
        setIsSearchingAddress(false);
      }, 300);
    } else {
      setAddressSuggestions([]);
      setIsSearchingAddress(false);
    }
    return () => { if (addressTimeoutRef.current) clearTimeout(addressTimeoutRef.current); };
  }, [address, selectedAddress]);

  useEffect(() => {
    if (parcelTimeoutRef.current) clearTimeout(parcelTimeoutRef.current);
    if (parcelId.length >= 10) {
      setIsSearchingParcel(true);
      parcelTimeoutRef.current = setTimeout(async () => {
        const info = await searchParcel(parcelId);
        setParcelInfo(info);
        setIsSearchingParcel(false);
        if (info?.lat && info?.lon) { setLatitude(info.lat.toFixed(6)); setLongitude(info.lon.toFixed(6)); }
        if (info?.commune_insee) setCodeInsee(info.commune_insee);
      }, 500);
    } else {
      setParcelInfo(null);
      setIsSearchingParcel(false);
    }
    return () => { if (parcelTimeoutRef.current) clearTimeout(parcelTimeoutRef.current); };
  }, [parcelId]);

  const handleSelectAddress = useCallback((suggestion: AddressSuggestion) => {
    setSelectedAddress(suggestion);
    setAddress(suggestion.label);
    setAddressSuggestions([]);
    setLatitude(suggestion.lat.toFixed(6));
    setLongitude(suggestion.lon.toFixed(6));
    if (suggestion.citycode) setCodeInsee(suggestion.citycode);
  }, []);

  const fetchBankScoring = useCallback(async (params: { dossierId?: string | null; lat?: number; lon?: number; commune_insee?: string }) => {
    const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL || "";
    const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { log('⚠️', 'Banque scoring skipped: missing Supabase config'); return; }
    const payload: Record<string, unknown> = {};
    if (params.dossierId) { payload.dossierId = params.dossierId; } else {
      if (!Number.isNaN(params.lat) && !Number.isNaN(params.lon)) { payload.lat = params.lat; payload.lon = params.lon; }
      if (params.commune_insee) payload.commune_insee = params.commune_insee;
    }
    if (!payload.dossierId && !payload.lat && !payload.commune_insee) { log('⚠️', 'Banque scoring skipped: no identifier available'); return; }
    setIsBankScoringLoading(true); setBankScoringError(null); setBankScoring(null);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/banque-risques-v1`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Erreur ${response.status}`);
      const scoring = result?.risks?.scoring;
      if (scoring && typeof scoring.score === "number") {
        setBankScoring({ score: scoring.score, grade: scoring.grade as BankRiskScoringGrade, level_label: scoring.level_label ?? "", confidence: scoring.confidence ?? 0, rationale: Array.isArray(scoring.rationale) ? scoring.rationale : [], items: Array.isArray(scoring.items) ? scoring.items : [] });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur scoring banque";
      log('❌', 'banque-risques-v1 error', msg);
      setBankScoringError(msg);
    } finally { setIsBankScoringLoading(false); }
  }, []);

  const handleSubmit = useCallback(async () => {
    const hasLocation = (latitude && longitude) || codeInsee || parcelInfo;
    if (!hasLocation) { setError("Veuillez renseigner une localisation (adresse, parcelle, coordonnées ou code INSEE)."); return; }
    setIsLoading(true); setError(null); setAnalysisResult(null); setBankScoring(null); setBankScoringError(null);
    const lat = latitude ? parseFloat(latitude) : NaN;
    const lon = longitude ? parseFloat(longitude) : NaN;
    try {
      const payload: Record<string, unknown> = { radius_km: radius, debug: true };
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) { payload.lat = lat; payload.lon = lon; }
      if (selectedAddress?.label || address) payload.address = selectedAddress?.label || address;
      if (parcelId && parcelId.length >= 10) payload.parcel_id = parcelId;
      if (codeInsee) payload.commune_insee = codeInsee;
      const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL || "";
      const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Configuration Supabase manquante");
      const apiResponse = await fetch(`${SUPABASE_URL}/functions/v1/risk-study-v1`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY }, body: JSON.stringify(payload) });
      const result = await apiResponse.json();
      if (!apiResponse.ok || !result.success) throw new Error(result.error || `Erreur ${apiResponse.status}`);
      if (!mountedRef.current) return;
      setAnalysisResult(result as RiskStudyApiResponse);

      // ── Sauvegarde géorisques — clé dédiée par deal (source principale pour Analyse prédictive) ──
      try {
        const marchandSnap = readMarchandSnapshot();
        const activeDealId = marchandSnap.activeDealId;
        if (activeDealId && result?.data) {
          userStorage.setItem(`mimmoza.georisques.${activeDealId}`, JSON.stringify(result.data));
          console.log("[InvestisseurRisquesPanel] ✓ Géorisques → localStorage mimmoza.georisques." + activeDealId);
        }
      } catch (e) { console.error("[InvestisseurRisquesPanel] Erreur save georisques dedicated key", e); }

      // ── Sauvegarde dans le projet Investisseur actif (risks) → Analyse prédictive ──
      try {
        const invSnap = getInvestisseurSnapshot();
        const invPid = invSnap.activeProjectId;
        if (invPid && result?.data) {
          upsertInvestisseurProject(invPid, { risks: result.data as Record<string, unknown> });
          console.log("[InvestisseurRisquesPanel] ✓ Géorisques → Investisseur project", invPid);
        }
      } catch (e) { console.error("[InvestisseurRisquesPanel] Erreur save investisseur risks", e); }

      // ── Sauvegarde dans le snapshot Marchand (dueDiligenceByDeal[dealId].state.georisques) ──
      try {
        const { readMarchandSnapshot: rms, saveMarchandSnapshot, ensureActiveDeal } = await import("../../../marchand/shared/marchandSnapshot.store");
        const activeDeal = ensureActiveDeal();
        if (activeDeal?.id) {
          const snap = rms() as Record<string, unknown>;

          const snapAny = snap as any;
          if (!snapAny.dueDiligenceByDeal) snapAny.dueDiligenceByDeal = {};
          if (!snapAny.dueDiligenceByDeal[activeDeal.id]) snapAny.dueDiligenceByDeal[activeDeal.id] = { state: {}, updatedAt: new Date().toISOString() };
          snapAny.dueDiligenceByDeal[activeDeal.id].state.georisques = result?.data ?? null;
          snapAny.updatedAt = new Date().toISOString();
          saveMarchandSnapshot(snap as any);
          window.dispatchEvent(new CustomEvent("MARCHAND_SNAPSHOT_EVENT"));
          console.log("[InvestisseurRisquesPanel] Georisques sauvegardes pour deal", activeDeal.id);
        }
      } catch (e) { console.error("[InvestisseurRisquesPanel] Erreur sauvegarde georisques", e); }

      if (studyId) {
        // ⚠️ Correctif v1.4.0 — le `: 1` terminal de ces ternaires attrapait
        // TOUT ce qui n'était ni 'fort' ni 'moyen' : 'faible', 'nul', mais
        // aussi 'inconnu' et `undefined`. Une source muette était donc
        // persistée en base comme un aléa de niveau 1, c'est-à-dire le risque
        // MINIMAL — la valeur la plus rassurante de l'échelle. Ce 1 ressortait
        // ensuite dans l'analyse prédictive sans plus aucune trace de son
        // origine. `niveauAleaToDb` renvoie `null` quand rien n'est mesuré :
        // la colonne reste vide, ce qui est la seule chose vraie.
        const sisCount = result.data?.sis?.count;
        const sisMesureDb = isLevelMeasured(result.data?.sis?.risk_level)
          && isMeasured(result.data?.sis?.coverage);

        const risquesPayload: PromoteurRisquesData = {
          score_inondation: niveauAleaToDb(result.data?.inondation?.risk_level),
          score_seisme: result.data?.seisme?.zone ?? null,
          score_retrait_argile: niveauAleaToDb(result.data?.argiles?.risk_level),
          score_radon: result.data?.radon?.classe_potentiel ?? null,
          // « pas de site pollué » n'est affirmable que si la base a répondu.
          pollution_sols: sisMesureDb ? (sisCount ?? 0) > 0 : false,
          score_global: result.scores?.global ?? null,
          raw_georisques: result as unknown as Record<string, unknown>,
          done: true,
        };
        patchRisques(risquesPayload).catch(e => console.error("[RisquesPage] patchRisques failed:", e));
      }
      fetchBankScoring({ dossierId: extractDossierIdFromUrl(), lat: result?.meta?.lat ?? lat, lon: result?.meta?.lon ?? lon, commune_insee: result?.meta?.commune_insee ?? codeInsee });
      try {
        patchProjectInfo({ address: selectedAddress?.label || address || undefined, city: result?.meta?.commune_nom || undefined, lat: result?.meta?.lat, lon: result?.meta?.lon });
        // La valeur exposée par risk-study est un score de SÉCURITÉ (100 = zone
        // sûre), pas un score de risque : l'ancien libellé inversait le sens pour
        // le copilote qui relit ce snapshot. `null` = non mesuré (v1.1.0).
        // v1.4.0 : le TODO de mutualisation qui figurait ici est levé — types,
        // helpers et cartes viennent de `@/spaces/shared/risques`.
        patchModule("risks", {
          ok: true,
          summary: `${summarizeGlobalScore(result?.scores?.global)} - ${result?.meta?.commune_nom}`,
          data: result,
        });
      } catch (snapshotErr) { log('❌', 'Snapshot error', snapshotErr); }
      setTimeout(() => { if (mountedRef.current) resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 100);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Une erreur est survenue";
      log('❌', 'Submit error', errorMessage);
      if (mountedRef.current) setError(errorMessage);
    } finally { if (mountedRef.current) setIsLoading(false); }
  }, [latitude, longitude, codeInsee, parcelInfo, radius, selectedAddress, address, fetchBankScoring, studyId, patchRisques]);

  const bannerInseeLabel = study?.foncier?.commune_insee ? `INSEE ${study.foncier.commune_insee}` : null;

  const submitButtonStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
    padding: "14px 32px",
    background: `linear-gradient(135deg, ${ACCENT} 0%, #21cbf3 100%)`,
    color: "white", border: "none", borderRadius: "12px",
    fontSize: "15px", fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
    boxShadow: `0 4px 12px ${ACCENT}40`,
  };

  return (
    <ErrorBoundary componentName="RisquesPage">
      <div style={styles.container}>

        <div style={{
  background: "linear-gradient(135deg, #1d6fe8 0%, #0ea5e9 55%, #22d3ee 100%)",
  borderRadius: 32,
  padding: "40px 44px",
  margin: "0 0 32px 0",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 24,
  boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
  position: "relative",
  overflow: "hidden",
}}>
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>

              Investisseur · Analyse
            </div>
            <div style={{ fontSize: 36, fontWeight: 600, color: "#fff", marginBottom: 10, lineHeight: 1.1, letterSpacing: "-0.025em", display: "flex", alignItems: "center", gap: 12 }}>

              Géorisques
              {bannerInseeLabel && (
                <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.85)", background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 6, padding: "2px 10px" }}>
                  {bannerInseeLabel}
                </span>
              )}
            </div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", maxWidth: 460, lineHeight: 1.55 }}>
              Risques naturels, technologiques, pollution et géotechniques. Sources&nbsp;: Géorisques, BRGM, GASPAR.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginTop: 4 }}>
            <span style={{ padding: "6px 12px", background: "rgba(255,255,255,0.15)", borderRadius: 8, fontSize: 12, fontWeight: 600, color: "white", border: "1px solid rgba(255,255,255,0.25)" }}>
              v1.4.0
            </span>
            {analysisResult && (
              <button
                onClick={() => {
                  patchModule("risks", {
                    ok: true,
                    validated: true,
                    summary: `${summarizeGlobalScore(analysisResult.scores.global)} - ${analysisResult.meta.commune_nom}`,
                    data: analysisResult,
                  });
                  setSynthesisSaved(true);
                  setTimeout(() => setSynthesisSaved(false), 3000);
                }}
                style={{
                  padding: "9px 18px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.4)",
                  background: synthesisSaved ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.15)",
                  color: "white", fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {synthesisSaved ? "✓ Enregistré" : "📌 Utiliser dans la synthèse"}
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={isLoading}
              style={{
                padding: "9px 18px", borderRadius: 10, border: "none", background: "white",
                color: ACCENT, fontWeight: 600, fontSize: 13,
                cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.7 : 1,
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {isLoading ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />Analyse…</> : <><ShieldAlert size={14} />Lancer l'analyse</>}
            </button>
          </div>
        </div>

        <div style={styles.mainContent}>
          <div style={styles.formSection}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
              <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: `linear-gradient(135deg, ${ACCENT} 0%, #21cbf3 100%)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Target size={22} color="white" />
              </div>
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#1e293b", margin: 0 }}>Localisation à analyser</h2>
                <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>Renseignez une adresse, parcelle cadastrale, coordonnées ou code INSEE</p>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "24px" }}>
              <div style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                  <MapPin size={14} color={ACCENT} />
                  Adresse
                  <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 8px", background: `${ACCENT}18`, color: ACCENT, borderRadius: "4px", marginLeft: "8px" }}>RECOMMANDÉ</span>
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type="text" placeholder="Ex: 12 rue de la République, Lyon"
                    value={address}
                    onChange={(e) => { setAddress(e.target.value); if (selectedAddress) setSelectedAddress(null); }}
                    style={{ ...styles.input, paddingRight: "40px" }}
                  />
                  {isSearchingAddress && <Loader2 size={18} color={ACCENT} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", animation: "spin 1s linear infinite" }} />}
                  {address && !isSearchingAddress && (
                    <button onClick={() => { setAddress(""); setSelectedAddress(null); }} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
                      <X size={16} color="#94a3b8" />
                    </button>
                  )}
                  {addressSuggestions.length > 0 && (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 100, maxHeight: "220px", overflowY: "auto", marginTop: "4px" }}>
                      {addressSuggestions.map((s, i) => (
                        <div key={i} onClick={() => handleSelectAddress(s)}
                          style={{ padding: "12px 14px", cursor: "pointer", fontSize: "13px", color: "#1e293b", display: "flex", alignItems: "center", gap: "10px", borderBottom: "1px solid #f1f5f9" }}
                          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "#f8fafc"; }}
                          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; }}
                        >
                          <MapPin size={14} color={ACCENT} />
                          {s.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {selectedAddress && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", background: "#ecfdf5", borderRadius: "8px" }}>
                    <CheckCircle size={16} color="#10b981" />
                    <span style={{ fontSize: "13px", color: "#065f46" }}>
                      {selectedAddress.lat.toFixed(5)}, {selectedAddress.lon.toFixed(5)}
                      {selectedAddress.citycode && ` • INSEE: ${selectedAddress.citycode}`}
                    </span>
                  </div>
                )}
              </div>

              {(() => {
                const hasAddress = address.length > 0 || selectedAddress != null;
                const hasParcel  = parcelId.length > 0;
                const parcelDisabled = hasAddress && !hasParcel;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                      <Grid3X3 size={14} color={ACCENT} />
                      N° Parcelle cadastrale
                    </label>
                    <input type="text" placeholder="Ex: 69123000AI0001" value={parcelId} disabled={parcelDisabled}
                      onChange={(e) => setParcelId(e.target.value)}
                      style={{ ...styles.input, opacity: parcelDisabled ? 0.45 : 1, cursor: parcelDisabled ? "not-allowed" : undefined, background: parcelDisabled ? "#f1f5f9" : undefined }}
                    />
                    {parcelDisabled && (
                      <div style={{ fontSize: "12px", color: "#d97706", display: "flex", alignItems: "center", gap: "6px" }}>
                        <AlertTriangle size={13} color="#d97706" />
                        Videz l'adresse pour saisir une parcelle
                      </div>
                    )}
                  </div>
                );
              })()}

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>Latitude</label>
                <input type="text" placeholder="45.764" value={latitude} onChange={(e) => setLatitude(e.target.value)} style={styles.input} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>Longitude</label>
                <input type="text" placeholder="4.8357" value={longitude} onChange={(e) => setLongitude(e.target.value)} style={styles.input} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>Code INSEE</label>
                <input type="text" placeholder="69123" value={codeInsee} onChange={(e) => setCodeInsee(e.target.value)} style={styles.input} />
              </div>

              <div style={{ gridColumn: "span 3", display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Compass size={14} color={ACCENT} />
                  Rayon d'analyse: <strong style={{ color: ACCENT }}>{radius} km</strong>
                </label>
                <input type="range" min={1} max={20} step={1} value={radius}
                  onChange={(e) => setRadius(parseInt(e.target.value))}
                  style={{ width: "100%", accentColor: ACCENT }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#94a3b8" }}>
                  <span>1 km</span>
                  <span style={{ color: ACCENT, fontWeight: 500 }}>Recommandé: 5 km</span>
                  <span>20 km</span>
                </div>
              </div>
            </div>

            {error && (
              <div style={{ padding: "14px 18px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", marginTop: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
                <AlertTriangle size={18} color="#dc2626" />
                <span style={{ fontSize: "14px", color: "#991b1b" }}>{error}</span>
              </div>
            )}
            {bankScoringError && (
              <div style={{ padding: "14px 18px", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "10px", marginTop: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
                <Landmark size={18} color="#d97706" />
                <span style={{ fontSize: "14px", color: "#92400e" }}>Scoring banque indisponible: {bankScoringError}</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "center", marginTop: "28px" }}>
              <button onClick={handleSubmit} disabled={isLoading}
                style={{ ...submitButtonStyle, opacity: isLoading ? 0.7 : 1, cursor: isLoading ? "not-allowed" : "pointer" }}>
                {isLoading
                  ? <><Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />Analyse en cours...</>
                  : <><ShieldAlert size={20} />Lancer l'analyse des risques</>}
              </button>
            </div>
          </div>

          <div ref={resultsRef}>
            {isLoading && (
              <div style={{ ...styles.card, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 40px" }}>
                <Loader2 size={56} color={ACCENT} style={{ animation: "spin 1s linear infinite", marginBottom: "20px" }} />
                <h3 style={{ fontSize: "20px", color: "#1e293b", marginBottom: "8px" }}>Analyse en cours...</h3>
                <p style={{ fontSize: "14px", color: "#64748b" }}>Interrogation de Géorisques, GASPAR, BRGM...</p>
              </div>
            )}

            {!isLoading && analysisResult && (
              <RiskStudyResults
                data={analysisResult}
                bankScoring={bankScoring}
                isBankScoringLoading={isBankScoringLoading}
                accentColor={ACCENT}
                headerGradient={RESULTS_HEADER_GRADIENT}
              />
            )}

            {!isLoading && !analysisResult && (
              <div style={{ ...styles.card, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 40px", textAlign: "center" }}>
                <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: `${ACCENT}18`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "24px" }}>
                  <ShieldAlert size={36} color={ACCENT} />
                </div>
                <h3 style={{ fontSize: "22px", fontWeight: 700, color: "#1e293b", marginBottom: "12px" }}>Nouvelle étude de risques</h3>
                <p style={{ fontSize: "15px", color: "#64748b", maxWidth: "500px", lineHeight: 1.6 }}>
                  Entrez une adresse, un numéro de parcelle, des coordonnées GPS ou un code INSEE pour lancer une analyse complète des risques.
                </p>
                <div style={{ marginTop: "20px", display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
                  <span style={{ ...styles.badge, background: "#fee2e2", color: "#991b1b" }}>🌊 Inondations</span>
                  <span style={{ ...styles.badge, background: "#fef3c7", color: "#92400e" }}>🏭 SEVESO/ICPE</span>
                  <span style={{ ...styles.badge, background: "#f3e8ff", color: "#7c3aed" }}>⚛️ Radon</span>
                  <span style={{ ...styles.badge, background: "#dbeafe", color: "#1d4ed8" }}>🔬 Pollution sols</span>
                  <span style={{ ...styles.badge, background: "#dcfce7", color: "#166534" }}>📜 CATNAT</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          input:focus, select:focus {
            border-color: ${ACCENT} !important;
            box-shadow: 0 0 0 3px ${ACCENT}20 !important;
          }
          button:hover:not(:disabled) { transform: translateY(-1px); }
        `}</style>
      </div>
    </ErrorBoundary>
  );
}
