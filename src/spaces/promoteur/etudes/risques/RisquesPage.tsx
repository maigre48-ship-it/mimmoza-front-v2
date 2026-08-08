// ============================================
// RisquesPage.tsx - VERSION 1.4.0
// ============================================
// Étude de risques pour une parcelle/adresse
// Sources: Géorisques API, données gouvernementales
// + 🆕 Banque scoring via banque-risques-v1
//   → Refactoré : utilise <BanqueRiskScoreCard />
//
// ── v1.3.1 · MUTUALISATION DES HELPERS ──────────────────────────────────────
// Les helpers d'affichage (couleurs, libellés, verdicts, formats) sont
// désormais importés de `@/spaces/shared/risques` au lieu d'être définis ici.
// Ils étaient recopiés à l'identique dans InvestisseurRisquesPanel, et seule
// cette page avait reçu les correctifs de nullabilité de risk-study v1.1.0 :
// pendant ce temps la copie affichait un score non mesuré en rouge vif.
//
// ── v1.4.0 · FIN DE LA MUTUALISATION ────────────────────────────────────────
// Les 21 interfaces locales et les 9 cartes de présentation sont supprimées au
// profit du socle : 2584 → 1580 lignes. Trois défauts disparaissent avec elles,
// que seules les cartes partagées corrigeaient — « Zone null - » (séisme),
// « Classe null - » (radon), et « Hors zone » affiché quand `zone_risque` est
// absent. Ce dernier était invisible pour tsc : le type local déclarait
// `zone_risque: boolean` non nullable, donc le compilateur validait un ternaire
// qui affirmait une absence de risque sur une donnée manquante.
// L'ErrorBoundary et `extractDossierIdFromUrl`, dupliqués verbatim, rejoignent
// eux aussi le socle.
// La garde `pollution_sols` s'aligne sur celle d'Investisseur : « aucun site
// pollué » n'est écrit en base que si la base SIS a effectivement répondu.
// MARQUEUR DE VERSION : import de `RiskErrorBoundary`
// ============================================

import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Bug,
  CheckCircle,
Compass,
  Download,
  Factory,
  FileText,
  Grid3X3,
  Info,
  Landmark,
  Layers,
  Loader2,
  MapPin,
  Mountain,
  Shield, ShieldAlert,
  Target,
  X
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

import type { LucideIcon } from "lucide-react";

import { hashInputs, isAgentRun, setStepStatus } from "../../shared/promoteurChain";
import { useAutorun } from "../../shared/useAutorun";
import { usePromoteurStudyId } from "../../shared/usePromoteurStudyId";

// Services partagés depuis le module marché
import { searchAddress } from "../marche/services/address.service";
import { searchParcel } from "../marche/services/parcel.service";

// Types partagés
import type {
  AddressSuggestion,
  ParcelInfo,
} from "../marche/types/market.types";

// ============================================
// IMPORT SNAPSHOT STORE
// ============================================
import { patchModule, patchProjectInfo } from "../../shared/promoteurSnapshot.store";
// Pont → marchandSnapshot (Deal Center Investisseur)
import { ensureActiveDeal, patchMarcheRisquesForDeal } from "../../../marchand/shared/marchandSnapshot.store";

// ============================================
// 🆕 Banque scoring – composant réutilisable
// ============================================
import type { BankRiskScoring, BankRiskScoringGrade } from "../../../../components/banque/BanqueRiskScoreCard";
import { BanqueRiskScoreCard } from "../../../../components/banque/BanqueRiskScoreCard";

// ============================================
// 🆕 Study persistence
// ============================================
import type { PromoteurRisquesData } from "../../shared/promoteurStudy.types";
import { usePromoteurStudy } from "../../shared/usePromoteurStudy";

// 🆕 COPILOT : pont vers le store de contexte du Copilot
import { useCopilotContext } from "../../../copilot/hooks/useCopilotContext";
// 🆕 COPILOT LOT 9 : injection de l'etude de risques calculee dans le contexte actif
import { setActiveCopilotContext } from "../../../copilot/store/activeCopilotContext.store";
import {
  HeroGhostButton,
  HeroPrimaryButton,
  PromoteurPageHero,
} from "../../shared/components/PromoteurPageHero";
import { ACCENT_PRO } from "../../shared/promoteurDesign.tokens";

// ─── Socle partagé de l'étude de risques (voir en-tête v1.4.0) ──────────────
// Même exemplaire que celui consommé par InvestisseurRisquesPanel.
import {
  CategoryScoreBar,
  CatnatCard,
  extractDossierIdFromUrl,
  GeotechCard,
  IcpeCard,
  InsightCard,
  isLevelMeasured,
  isMeasured,
  NaturalRisksCard,
  niveauAleaToDb,
  PollutionCard,
  RiskErrorBoundary,
  openRiskReport,
  RiskGauge,
  ScoreProvenanceNote,
} from "@/spaces/shared/risques";
import type {
  RiskStudyApiResponse,
} from "@/spaces/shared/risques";

// ============================================
// DEBUG
// ============================================
const DEBUG_MODE = true;
const log = (prefix: string, message: string, data?: unknown) => {
  if (DEBUG_MODE) console.log(`${prefix} ${message}`, data ?? '');
};

// ============================================================================
// TYPES
// ============================================================================
// v1.4.0 — Les 21 interfaces qui vivaient ici ont été supprimées au profit de
// `@/spaces/shared/risques/riskStudy.types.ts`, source unique partagée avec
// InvestisseurRisquesPanel. Elles n'étaient pas de simples doublons : la copie
// locale déclarait `FeuxForetData.zone_risque: boolean` NON nullable, ce qui
// faisait valider par tsc un `zone_risque ? … : "Hors zone"` affirmant une
// absence de risque sur une donnée absente. Un contrat faux ne protège de rien.

// ============================================
// HELPERS
// ============================================

// ─── v1.3.1 · MUTUALISATION ─────────────────────────────────────────────────
// Ces helpers vivaient ici en exemplaire local, et étaient recopiés à
// l'identique dans InvestisseurRisquesPanel. Les correctifs de nullabilité de
// v1.1.0 n'ont été appliqués qu'ici ; la copie a continué pendant ce temps à
// colorer en ROUGE VIF un score simplement non mesuré. Le socle
// `@/spaces/shared/risques` supprime ce chemin de divergence : une correction
// faite là s'applique aux deux écrans.
// Les imports (formatNumber, formatDistance, getRiskColor, getRiskBg,
// getRiskLabel, getScoreColor, getVerdictConfig, getBankGradeColor) sont en
// tête de fichier.

// ============================================
// STYLES
// ============================================

const styles = {
  container: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  } as React.CSSProperties,
  
  mainContent: {
    width: "100%",
    padding: "24px 0 0",
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
  
  submitButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    padding: "14px 32px",
    background: `linear-gradient(135deg, ${ACCENT_PRO} 0%, #7c6fcd 100%)`,
    color: "white",
    border: "none",
    borderRadius: "12px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
    boxShadow: `0 4px 12px ${ACCENT_PRO}40`,
  } as React.CSSProperties,
};

// ============================================================================
// COMPOSANTS DE PRÉSENTATION
// ============================================================================
// v1.4.0 — Les neuf cartes qui vivaient ici (RiskGauge, CategoryScoreBar,
// InsightCard, RiskDetailCard, CatnatCard, IcpeCard, NaturalRisksCard,
// GeotechCard, PollutionCard) ont été remplacées par celles du socle.
// Signatures de props identiques : le JSX appelant est inchangé.
//
// Trois corrections arrivent avec la bascule, absentes des versions locales :
//   • « Zone null - » et « Classe null - » ne s'impriment plus (séisme, radon) ;
//   • la couverture GASPAR est testée AVANT les décomptes, au lieu d'être
//     déduite d'un « 0 » qui pouvait venir d'une API muette ;
//   • un décompte issu d'une source non mesurée se rend « — », pas « 0 ».

// ============================================
// RESULTS COMPONENT
// ============================================
const RiskStudyResults: React.FC<{
  data: RiskStudyApiResponse;
  bankScoring: BankRiskScoring | null;
  isBankScoringLoading: boolean;
}> = ({ data, bankScoring, isBankScoringLoading }) => {
  const { meta, scores, categories, insights, data: riskData } = data;
  
  const criticalInsights = insights.filter(i => i.type === 'critical');
  const warningInsights = insights.filter(i => i.type === 'warning');
  const positiveInsights = insights.filter(i => i.type === 'positive');
  const infoInsights = insights.filter(i => i.type === 'info');
  const [synthesisSaved, setSynthesisSaved] = useState(false);

  // -- Rapport PDF ---------------------------------------------------------
  // v1.4.1 - Le document etait compose ici, en HTML, et un second exemplaire
  // divergent vivait dans InvestisseurRisquesPanel. Il vient desormais du
  // socle : une seule maquette, un seul endroit ou la corriger.
  const handleGeneratePdf = useCallback(() => {
    openRiskReport({
      meta, scores, categories, data: riskData, insights,
      version: data.version, bankScoring,
      accent: ACCENT_PRO, espace: "Espace promoteur",
    });
  }, [meta, scores, categories, riskData, insights, data.version, bankScoring]);

  const categoryIcons: Record<string, LucideIcon> = {
    "Risques Naturels": Mountain,
    "Risques Technologiques": Factory,
    "Pollution": Bug,
    "Risques Géotechniques": Layers,
  };

  return (
    <RiskErrorBoundary componentName="RiskStudyResults">
      <div>
        {/* 🆕 Banque scoring */}
        {isBankScoringLoading && (
          <BanqueRiskScoreCard
            scoring={{ score: 0, grade: "C", level_label: "", confidence: 0, rationale: [], items: [] }}
            isLoading
          />
        )}
        {!isBankScoringLoading && bankScoring && (
          <BanqueRiskScoreCard scoring={bankScoring} />
        )}

        {/* Header avec score global */}
        <div style={{
          background: "linear-gradient(135deg, #1e293b 0%, #7c6fcd 50%, #1e293b 100%)",
          borderRadius: "20px", padding: "32px", marginBottom: "24px", color: "white"
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: "32px", alignItems: "center" }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <RiskGauge score={scores.global} size={180} />
            </div>
            
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                <ShieldAlert size={28} />
                <h2 style={{ fontSize: "26px", fontWeight: 700, margin: 0 }}>
                  {meta.commune_nom}
                  <span style={{ fontSize: "16px", fontWeight: 400, opacity: 0.7, marginLeft: "10px" }}>
                    ({meta.departement})
                  </span>
                </h2>
              </div>
              <p style={{ fontSize: "14px", opacity: 0.8, marginBottom: "20px" }}>
                {meta.region} • Rayon d'analyse: {meta.radius_km} km • API v{data.version}
              </p>
              
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "14px" }}>
                  <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>Arrêtés CATNAT</div>
                  <div style={{ fontSize: "26px", fontWeight: 700 }}>{riskData.gaspar.catnat_count}</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "14px" }}>
                  <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>Sites SEVESO</div>
                  <div style={{ fontSize: "26px", fontWeight: 700 }}>
                    {riskData.icpe.seveso_haut_count + riskData.icpe.seveso_bas_count}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "14px" }}>
                  <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>PPR actifs</div>
                  <div style={{ fontSize: "26px", fontWeight: 700 }}>{riskData.gaspar.ppr_count}</div>
                </div>
              </div>
            </div>
            
            <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "16px", padding: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "16px", opacity: 0.9 }}>
                Scores par catégorie
              </div>
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
            </div>
          </div>

          {/* Indicateur de confiance + portée (risk-study v1.1.0).
              À force d'écarter les catégories non mesurées, un score peut ne
              reposer que sur une partie des critères. Rien ne l'indiquait à
              l'écran : c'était le dernier angle mort de la chaîne. */}
          <ScoreProvenanceNote scores={scores} />
        </div>
        
        {/* Insights */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          {criticalInsights.length > 0 && (
            <div style={{ ...styles.card, borderLeft: "4px solid #dc2626" }}>
              <div style={styles.cardTitle}>
                <AlertOctagon size={20} color="#dc2626" />
                Alertes Critiques ({criticalInsights.length})
              </div>
              {criticalInsights.map((insight, i) => (
                <InsightCard key={i} insight={insight} />
              ))}
            </div>
          )}
          
          {warningInsights.length > 0 && (
            <div style={{ ...styles.card, borderLeft: "4px solid #f59e0b" }}>
              <div style={styles.cardTitle}>
                <AlertTriangle size={20} color="#f59e0b" />
                Points de Vigilance ({warningInsights.length})
              </div>
              {warningInsights.map((insight, i) => (
                <InsightCard key={i} insight={insight} />
              ))}
            </div>
          )}
          
          {positiveInsights.length > 0 && (
            <div style={{ ...styles.card, borderLeft: "4px solid #10b981" }}>
              <div style={styles.cardTitle}>
                <CheckCircle size={20} color="#10b981" />
                Points Positifs ({positiveInsights.length})
              </div>
              {positiveInsights.map((insight, i) => (
                <InsightCard key={i} insight={insight} />
              ))}
            </div>
          )}
        </div>
        
        {/* Détails par catégorie */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          <NaturalRisksCard 
            inondation={riskData.inondation}
            seisme={riskData.seisme}
            feuxForet={riskData.feux_foret}
            argiles={riskData.argiles}
          />
          <PollutionCard sis={riskData.sis} radon={riskData.radon} />
        </div>
        
        <div style={{ marginBottom: "24px" }}>
          <GeotechCard cavites={riskData.cavites} mvt={riskData.mouvements_terrain} />
        </div>
        
        <div style={{ marginBottom: "24px" }}>
          <CatnatCard gaspar={riskData.gaspar} />
        </div>
        
        <div style={{ marginBottom: "24px" }}>
          <IcpeCard icpe={riskData.icpe} />
        </div>
        
        {infoInsights.length > 0 && (
          <div style={{ ...styles.card, marginBottom: "24px" }}>
            <div style={styles.cardTitle}>
              <Info size={20} color="#0ea5e9" />
              Informations complémentaires
            </div>
            {infoInsights.map((insight, i) => (
              <InsightCard key={i} insight={insight} />
            ))}
          </div>
        )}
        
        {data.debug?.timings && DEBUG_MODE && (
          <div style={{ ...styles.card, background: "#f8fafc", marginBottom: "24px" }}>
            <div style={styles.cardTitle}>
              <Activity size={20} color="#64748b" />
              Debug - Timings (ms)
            </div>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              {Object.entries(data.debug.timings).map(([key, value]) => (
                <div key={key} style={{ 
                  padding: "8px 14px", background: "white", borderRadius: "8px",
                  border: "1px solid #e2e8f0"
                }}>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>{key}: </span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: value > 1000 ? "#ef4444" : "#10b981" }}>
                    {value}ms
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "center", gap: "16px", marginTop: "32px" }}>
          <button
            onClick={() => {
              patchModule("risks", {
                ok: true, validated: true,
                summary: scores.global == null
                  ? `Score sécurité: non mesuré - ${meta.commune_nom}`
                  : `Score sécurité: ${scores.global}/100 - ${meta.commune_nom}`,
                data,
              });
              setSynthesisSaved(true);
              setTimeout(() => setSynthesisSaved(false), 3000);
            }}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "14px 28px",
              background: synthesisSaved
                ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
                : `linear-gradient(135deg, ${ACCENT_PRO} 0%, #7c6fcd 100%)`,
              color: "white", border: "none", borderRadius: "12px",
              fontSize: "14px", fontWeight: 600, cursor: "pointer",
            }}
          >
            <Target size={18} />
            {synthesisSaved ? "✓ Enregistré dans la synthèse" : "Utiliser pour la synthèse"}
          </button>
          <button 
            onClick={handleGeneratePdf}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "14px 28px", background: "#7f1d1d", color: "white",
              border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer"
            }}
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
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "14px 28px", background: "#f1f5f9", color: "#475569",
              border: "1px solid #e2e8f0", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer"
            }}
          >
            <Download size={18} />
            Exporter JSON
          </button>
        </div>
      </div>
    </RiskErrorBoundary>
  );
};

// ============================================
// MAIN COMPONENT
// ============================================
export function RisquesPage({ onStudyComplete: _onStudyComplete, theme: _theme }: {
  onStudyComplete?: (data: unknown) => void;
  theme?: { gradient: string; accent: string };
} = {}) {
  
  // ── Study persistence ──────────────────────────────────────────────────────
  const studyId = usePromoteurStudyId();
  const { study, loadState, patchRisques } = usePromoteurStudy(studyId);

  // 🆕 COPILOT : accès au store de contexte
  const { setContextHints } = useCopilotContext();

  // ── Form state ─────────────────────────────────────────────────────────────
  const [address, setAddress] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<AddressSuggestion | null>(null);
  const [parcelId, setParcelId] = useState("");
  const [parcelInfo, setParcelInfo] = useState<ParcelInfo | null>(null);
  const [_isSearchingParcel, setIsSearchingParcel] = useState(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [codeInsee, setCodeInsee] = useState("");
  const [radius, setRadius] = useState(5);
  const [isLoading, setIsLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<RiskStudyApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 🆕 Banque scoring – state
  const [bankScoring, setBankScoring] = useState<BankRiskScoring | null>(null);
  const [isBankScoringLoading, setIsBankScoringLoading] = useState(false);
  const [bankScoringError, setBankScoringError] = useState<string | null>(null);
  const [synthesisSaved, setSynthesisSaved] = useState(false);

  const addressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const parcelTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  // ── Guard against setState after unmount ───────────────────────────────────
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Hydratation depuis l'étude persistée ──────────────────────────────────
  useEffect(() => {
    if (loadState !== "ready") return;

    if (study?.foncier?.commune_insee && !codeInsee) {
      setCodeInsee(study.foncier.commune_insee);
    }

    if (study?.foncier?.focus_id && !parcelId) {
      setParcelId(study.foncier.focus_id);
    }

    if (study?.risques?.raw_georisques && analysisResult === null) {
      setAnalysisResult(study.risques.raw_georisques as unknown as RiskStudyApiResponse);
    }
    // Intentionnellement, on ne met pas codeInsee/parcelId/analysisResult dans les deps
    // pour éviter de boucler : on veut une hydratation one-shot au passage à "ready".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState, study]);

  // 🆕 COPILOT : pousse la parcelle courante dans le contexte du Copilot
  // dès qu'une localisation exploitable est disponible. Le backend lit
  // code_insee → commune_insee et lng → lon pour appeler risk-study.
  useEffect(() => {
    const lat = latitude ? parseFloat(latitude) : NaN;
    const lng = longitude ? parseFloat(longitude) : NaN;
    const insee = analysisResult?.meta?.commune_insee || codeInsee || undefined;

    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    if (!insee && !hasCoords) return; // rien d'exploitable encore

    setContextHints({
      vertical: "promoteur",
      parcel: {
        id: studyId || parcelId || insee || "parcelle",
        lat: hasCoords ? lat : undefined,
        lng: hasCoords ? lng : undefined,        // ⚠️ "lng" (le backend convertit en "lon")
        code_insee: insee,                        // ⚠️ "code_insee" — lu par risk-study
        address: selectedAddress?.label || address || undefined,
        commune: analysisResult?.meta?.commune_nom || undefined,
      },
      study: studyId ? { id: studyId, type: "promoteur" } : undefined,
    });
  }, [latitude, longitude, codeInsee, analysisResult, studyId, parcelId, selectedAddress, address, setContextHints]);

  // 🆕 COPILOT LOT 9 : pousse l'etude de risques calculee dans le contexte du Copilot.
  // Des qu'un resultat est disponible (analyse fraiche OU hydratation depuis l'etude
  // persistee), le Copilot repond aux questions de risques DIRECTEMENT a partir de ces
  // donnees, sans appeler d'outil et sans halluciner a partir du seul nom de commune.
  // On nettoie quand il n'y a plus de resultat, pour eviter qu'une etude d'une autre
  // parcelle ne "colle" au contexte.
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
        if (info?.lat && info?.lon) {
          setLatitude(info.lat.toFixed(6));
          setLongitude(info.lon.toFixed(6));
        }
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

  const fetchBankScoring = useCallback(async (params: {
    dossierId?: string | null;
    lat?: number;
    lon?: number;
    commune_insee?: string;
  }) => {
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
    const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      log('⚠️', 'Banque scoring skipped: missing Supabase config');
      return;
    }

    const payload: Record<string, unknown> = {};
    if (params.dossierId) {
      payload.dossierId = params.dossierId;
    } else {
      if (!Number.isNaN(params.lat) && !Number.isNaN(params.lon)) {
        payload.lat = params.lat;
        payload.lon = params.lon;
      }
      if (params.commune_insee) payload.commune_insee = params.commune_insee;
    }

    if (!payload.dossierId && !payload.lat && !payload.commune_insee) {
      log('⚠️', 'Banque scoring skipped: no identifier available');
      return;
    }

    setIsBankScoringLoading(true);
    setBankScoringError(null);
    setBankScoring(null);

    try {
      log('🏦', 'Calling banque-risques-v1', payload);

      const response = await fetch(`${SUPABASE_URL}/functions/v1/banque-risques-v1`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      log('🏦', 'banque-risques-v1 response', {
        ok: response.ok,
        score: result?.risks?.scoring?.score,
        grade: result?.risks?.scoring?.grade,
      });

      if (!response.ok) {
        throw new Error(result.error || `Erreur ${response.status}`);
      }

      const scoring = result?.risks?.scoring;
      if (scoring && typeof scoring.score === "number") {
        setBankScoring({
          score: scoring.score,
          grade: scoring.grade as BankRiskScoringGrade,
          level_label: scoring.level_label ?? "",
          confidence: scoring.confidence ?? 0,
          rationale: Array.isArray(scoring.rationale) ? scoring.rationale : [],
          items: Array.isArray(scoring.items) ? scoring.items : [],
        });
      } else {
        log('⚠️', 'banque-risques-v1: no scoring in response');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur scoring banque";
      log('❌', 'banque-risques-v1 error', msg);
      setBankScoringError(msg);
    } finally {
      setIsBankScoringLoading(false);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    const hasLocation = (latitude && longitude) || codeInsee || parcelInfo;
    if (!hasLocation) {
      setError("Veuillez renseigner une localisation (adresse, parcelle, coordonnées ou code INSEE).");
      return;
    }

    log('🚀', 'Starting risk analysis', { latitude, longitude, codeInsee, radius });

    setIsLoading(true);
    setError(null);
    setAnalysisResult(null);
    setBankScoring(null);
    setBankScoringError(null);

    const lat = latitude ? parseFloat(latitude) : NaN;
    const lon = longitude ? parseFloat(longitude) : NaN;

    try {
      const payload: Record<string, unknown> = {
        radius_km: radius,
        debug: true,
      };

      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        payload.lat = lat;
        payload.lon = lon;
      }
      // ── v1.3.1 : envoyer toutes les sources de géolocalisation disponibles ──
      if (selectedAddress?.label || address) {
        payload.address = selectedAddress?.label || address;
      }
      if (parcelId && parcelId.length >= 10) {
        payload.parcel_id = parcelId;
      }
      if (codeInsee) payload.commune_insee = codeInsee;

      log('📡', 'Payload', payload);

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
      const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error("Configuration Supabase manquante");
      }
      
      const apiResponse = await fetch(`${SUPABASE_URL}/functions/v1/risk-study-v1`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(payload),
      });

      const result = await apiResponse.json();

      log('📡', 'API Response', {
        ok: apiResponse.ok,
        success: result?.success,
        version: result?.version,
        score: result?.scores?.global,
      });

      if (!apiResponse.ok || !result.success) {
        throw new Error(result.error || `Erreur ${apiResponse.status}`);
      }

      if (!mountedRef.current) return;
      setAnalysisResult(result as RiskStudyApiResponse);

      // ── Persistance étude ────────────────────────────────────────────────
      if (studyId) {
        // v1.1.0 — Un aléa 'inconnu' (source muette) tombait dans le `: 1`
        // terminal, c'est-à-dire la MEILLEURE valeur de l'échelle : l'absence de
        // mesure était persistée comme un risque minimal. On persiste null.
        // v1.3.1 : la conversion vit dans le socle partagé, pour que ce panel et
        // InvestisseurRisquesPanel écrivent la MÊME échelle dans la même colonne.
        const sisCount = result.data?.sis?.count;
        // v1.4.0 — La garde `sisCount == null` était trop faible : une base SIS
        // muette qui renvoie `count: 0` passait pour « aucun site pollué ». On
        // exige que la source se soit déclarée mesurée (coverage ET risk_level),
        // comme le fait déjà InvestisseurRisquesPanel.
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
        const saved = await patchRisques(risquesPayload).catch(e => {
          console.error("[RisquesPage] patchRisques failed:", e);
          return { ok: false as const, error: String(e) };
        });

        // Chaîne d'opération : les risques alimentent la synthèse. Étape
        // enregistrée seulement si l'étude a bien été écrite.
        if (saved.ok) {
          await setStepStatus({
            studyId, step: "risques", status: "ready",
            producedBy: isAgentRun() ? "agent" : "user",
            inputsHash: hashInputs({ lat, lon, codeInsee, radius, parcelId: parcelId?.trim() || null }),
            summary: {
              score_global: result.scores?.global ?? null,
              score_inondation: risquesPayload.score_inondation,
              score_radon: result.data?.radon?.classe_potentiel ?? null,
              pollution_sols: risquesPayload.pollution_sols,
              commune: result?.meta?.commune_nom ?? null,
            },
          });
        }
      }

      const dossierId = extractDossierIdFromUrl();
      fetchBankScoring({
        dossierId,
        lat: result?.meta?.lat ?? lat,
        lon: result?.meta?.lon ?? lon,
        commune_insee: result?.meta?.commune_insee ?? codeInsee,
      });

      try {
        patchProjectInfo({
          address: selectedAddress?.label || address || undefined,
          city: result?.meta?.commune_nom || undefined,
          lat: result?.meta?.lat,
          lon: result?.meta?.lon,
        });

        // Libellé aligné sur le chemin manuel (bouton « valider la synthèse ») :
        // la valeur exposée est un score de SÉCURITÉ (100 = zone sûre). L'ancien
        // « Score risque » inversait le sens dans le snapshot lu par le copilote.
        // `null` = non mesuré (risk-study v1.1.0), jamais affiché comme une note.
        patchModule("risks", {
          ok: true,
          summary: result?.scores?.global == null
            ? `Score sécurité: non mesuré - ${result?.meta?.commune_nom}`
            : `Score sécurité: ${result.scores.global}/100 - ${result?.meta?.commune_nom}`,
          data: result,
        });

        log('💾', 'Snapshot saved');
      } catch (snapshotErr) {
        log('❌', 'Snapshot error', snapshotErr);
      }

      // ── Pont Deal Center Investisseur ────────────────────────────────────
      try {
        const activeDeal = ensureActiveDeal();
        if (activeDeal) {
          patchMarcheRisquesForDeal(activeDeal.id, {
            scoreGlobal: result.scores?.global ?? undefined,
            breakdown: {
              environnement: result.scores?.global ?? undefined,
              demande:       result.scores?.naturels ?? undefined,
              offre:         result.scores?.technologiques ?? undefined,
              accessibilite: result.scores?.geotechniques ?? undefined,
            },
            data: result,
            updatedAt: new Date().toISOString(),
          });
          log('💾', '[marchandSnapshot] Géorisques patched on deal', activeDeal.id);
        }
      } catch (e) {
        log('⚠️', '[marchandSnapshot] patch skipped', e);
      }

      setTimeout(() => {
        if (mountedRef.current) {
          resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 100);

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Une erreur est survenue";
      log('❌', 'Submit error', errorMessage);
      if (mountedRef.current) setError(errorMessage);
      if (studyId) {
        await setStepStatus({ studyId, step: "risques", status: "error", producedBy: isAgentRun() ? "agent" : "user", error: errorMessage }).catch(() => { /* non-bloquant */ });
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [latitude, longitude, codeInsee, parcelId, parcelInfo, radius, selectedAddress, address, fetchBankScoring, studyId, patchRisques]);

  // Autorun copilote : même déclencheur que le bouton, une fois la
  // localisation résolue depuis le foncier de l'étude.
  useAutorun({
    step: "risques",
    studyId,
    ready: Boolean((latitude && longitude) || codeInsee || parcelInfo),
    skip: isLoading || Boolean(analysisResult),
    run: handleSubmit,
  });

  // ── Derived display values ─────────────────────────────────────────────────
  const bannerInseeLabel = study?.foncier?.commune_insee
    ? `INSEE ${study.foncier.commune_insee}`
    : null;

  return (
    <RiskErrorBoundary componentName="RisquesPage">
      <div style={styles.container}>

        {/* ── Bannière dégradé Promoteur › Études ── */}
        <div>
  <PromoteurPageHero
    badge="Promoteur · Études"
    title="Étude de Risques"
    metaLines={[
      { text: "Risques naturels, technologiques, pollution et géotechniques. Sources : Géorisques, BRGM, GASPAR." },
      ...(bannerInseeLabel ? [{ text: bannerInseeLabel }] : []),
    ]}
    statCards={analysisResult ? [
      {
        label: "Score sécurité",
        value: analysisResult.scores.global == null
          ? "non mesuré"
          : `${analysisResult.scores.global}/100`,
        tone: "indigo" as const,
      },
      {
        label: "Commune",
        value: analysisResult.meta.commune_nom,
        tone: "emerald" as const,
      },
    ] : undefined}
    actions={
      <>
        {analysisResult && (
          <HeroPrimaryButton
            onClick={() => {
              patchModule("risks", {
                ok: true, validated: true,
                summary: analysisResult.scores.global == null
                  ? `Score sécurité: non mesuré - ${analysisResult.meta.commune_nom}`
                  : `Score sécurité: ${analysisResult.scores.global}/100 - ${analysisResult.meta.commune_nom}`,
                data: analysisResult,
              });
              setSynthesisSaved(true);
              setTimeout(() => setSynthesisSaved(false), 3000);
            }}
          >
            {synthesisSaved ? "✓ Enregistré" : "📌 Utiliser dans la synthèse"}
          </HeroPrimaryButton>
        )}
        <HeroGhostButton onClick={handleSubmit} disabled={isLoading}>
          {isLoading
            ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Analyse…</>
            : <><ShieldAlert size={14} /> Lancer l'analyse</>
          }
        </HeroGhostButton>
      </>
    }
  />
</div>

        {/* Main content */}
        <div style={styles.mainContent}>
          {/* Form */}
          <div style={styles.formSection}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
              <div style={{
                width: "44px", height: "44px", borderRadius: "12px",
                background: `linear-gradient(135deg, ${ACCENT_PRO} 0%, #7c6fcd 100%)`,
                display: "flex", alignItems: "center", justifyContent: "center"
              }}>
                <Target size={22} color="white" />
              </div>
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                  Localisation à analyser
                </h2>
                <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
                  Renseignez une adresse, parcelle cadastrale, coordonnées ou code INSEE
                </p>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "24px" }}>
              {/* Adresse */}
              <div style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                  <MapPin size={14} color={ACCENT_PRO} />
                  Adresse
                  <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 8px", background: "#ede9fe", color: ACCENT_PRO, borderRadius: "4px", marginLeft: "8px" }}>
                    RECOMMANDÉ
                  </span>
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    placeholder="Ex: 12 rue de la République, Lyon"
                    value={address}
                    onChange={(e) => { setAddress(e.target.value); if (selectedAddress) setSelectedAddress(null); }}
                    style={{ ...styles.input, paddingRight: "40px" }}
                  />
                  {isSearchingAddress && (
                    <Loader2 size={18} color={ACCENT_PRO} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", animation: "spin 1s linear infinite" }} />
                  )}
                  {address && !isSearchingAddress && (
                    <button onClick={() => { setAddress(""); setSelectedAddress(null); }} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
                      <X size={16} color="#94a3b8" />
                    </button>
                  )}
                  {addressSuggestions.length > 0 && (
                    <div style={{
                      position: "absolute", top: "100%", left: 0, right: 0,
                      background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 100,
                      maxHeight: "220px", overflowY: "auto", marginTop: "4px"
                    }}>
                      {addressSuggestions.map((s, i) => (
                        <div 
                          key={i} 
                          onClick={() => handleSelectAddress(s)} 
                          style={{
                            padding: "12px 14px", cursor: "pointer", fontSize: "13px", color: "#1e293b",
                            display: "flex", alignItems: "center", gap: "10px",
                            borderBottom: "1px solid #f1f5f9", transition: "background 0.15s"
                          }}
                          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "#f8fafc"; }}
                          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; }}
                        >
                          <MapPin size={14} color={ACCENT_PRO} />
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

              {/* Parcelle — mutex avec adresse */}
              {(() => {
                const hasAddress = address.length > 0 || selectedAddress != null;
                const hasParcel  = parcelId.length > 0;
                const parcelDisabled = hasAddress && !hasParcel;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                      <Grid3X3 size={14} color={ACCENT_PRO} />
                      N° Parcelle cadastrale
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: 69123000AI0001"
                      value={parcelId}
                      disabled={parcelDisabled}
                      onChange={(e) => setParcelId(e.target.value)}
                      style={{
                        ...styles.input,
                        opacity: parcelDisabled ? 0.45 : 1,
                        cursor: parcelDisabled ? "not-allowed" : undefined,
                        background: parcelDisabled ? "#f1f5f9" : undefined,
                      }}
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

              {/* Coordonnées */}
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

              {/* Rayon */}
              <div style={{ gridColumn: "span 3", display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Compass size={14} color={ACCENT_PRO} />
                  Rayon d'analyse: <strong style={{ color: ACCENT_PRO }}>{radius} km</strong>
                </label>
                <input
                  type="range" min={1} max={20} step={1} value={radius}
                  onChange={(e) => setRadius(parseInt(e.target.value))}
                  style={{ width: "100%", accentColor: ACCENT_PRO }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#94a3b8" }}>
                  <span>1 km</span>
                  <span style={{ color: ACCENT_PRO, fontWeight: 500 }}>Recommandé: 5 km</span>
                  <span>20 km</span>
                </div>
              </div>
            </div>

            {/* Erreur */}
            {error && (
              <div style={{ 
                padding: "14px 18px", background: "#fef2f2", border: "1px solid #fecaca",
                borderRadius: "10px", marginTop: "20px", display: "flex", alignItems: "center", gap: "10px"
              }}>
                <AlertTriangle size={18} color="#dc2626" />
                <span style={{ fontSize: "14px", color: "#991b1b" }}>{error}</span>
              </div>
            )}

            {/* 🆕 Banque scoring – error display */}
            {bankScoringError && (
              <div style={{ 
                padding: "14px 18px", background: "#fef3c7", border: "1px solid #fcd34d",
                borderRadius: "10px", marginTop: "12px", display: "flex", alignItems: "center", gap: "10px"
              }}>
                <Landmark size={18} color="#d97706" />
                <span style={{ fontSize: "14px", color: "#92400e" }}>
                  Scoring banque indisponible: {bankScoringError}
                </span>
              </div>
            )}

            {/* Submit */}
            <div style={{ display: "flex", justifyContent: "center", marginTop: "28px" }}>
              <button
                onClick={handleSubmit}
                disabled={isLoading}
                style={{
                  ...styles.submitButton,
                  opacity: isLoading ? 0.7 : 1,
                  cursor: isLoading ? "not-allowed" : "pointer",
                }}
              >
                {isLoading ? (
                  <>
                    <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
                    Analyse en cours...
                  </>
                ) : (
                  <>
                    <ShieldAlert size={20} />
                    Lancer l'analyse des risques
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Results */}
          <div ref={resultsRef}>
            {isLoading && (
              <div style={{
                ...styles.card,
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", padding: "80px 40px"
              }}>
                <Loader2 size={56} color={ACCENT_PRO} style={{ animation: "spin 1s linear infinite", marginBottom: "20px" }} />
                <h3 style={{ fontSize: "20px", color: "#1e293b", marginBottom: "8px" }}>Analyse en cours...</h3>
                <p style={{ fontSize: "14px", color: "#64748b" }}>
                  Interrogation de Géorisques, GASPAR, BRGM...
                </p>
              </div>
            )}

            {!isLoading && analysisResult && (
              <RiskStudyResults
                data={analysisResult}
                bankScoring={bankScoring}
                isBankScoringLoading={isBankScoringLoading}
              />
            )}

            {!isLoading && !analysisResult && (
              <div style={{
                ...styles.card,
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", padding: "80px 40px", textAlign: "center"
              }}>
                <div style={{
                  width: "80px", height: "80px", borderRadius: "50%",
                  background: "#ede9fe",
                  display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "24px"
                }}>
                  <ShieldAlert size={36} color={ACCENT_PRO} />
                </div>
                <h3 style={{ fontSize: "22px", fontWeight: 700, color: "#1e293b", marginBottom: "12px" }}>
                  Nouvelle étude de risques
                </h3>
                <p style={{ fontSize: "15px", color: "#64748b", maxWidth: "500px", lineHeight: 1.6 }}>
                  Entrez une adresse, un numéro de parcelle, des coordonnées GPS ou un code INSEE 
                  pour lancer une analyse complète des risques.
                </p>
                <div style={{ marginTop: "20px", display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
                  <span style={{ ...styles.badge, background: "#fee2e2", color: "#991b1b" }}>
                    🌊 Inondations
                  </span>
                  <span style={{ ...styles.badge, background: "#fef3c7", color: "#92400e" }}>
                    🏭 SEVESO/ICPE
                  </span>
                  <span style={{ ...styles.badge, background: "#f3e8ff", color: "#7c3aed" }}>
                    ⚛️ Radon
                  </span>
                  <span style={{ ...styles.badge, background: "#dbeafe", color: "#1d4ed8" }}>
                    🔬 Pollution sols
                  </span>
                  <span style={{ ...styles.badge, background: "#dcfce7", color: "#166534" }}>
                    📜 CATNAT
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CSS animations */}
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          input:focus, select:focus {
            border-color: ${ACCENT_PRO} !important;
            box-shadow: 0 0 0 3px ${ACCENT_PRO}20 !important;
          }
          button:hover:not(:disabled) {
            transform: translateY(-1px);
          }
        `}</style>
      </div>
    </RiskErrorBoundary>
  );
}

export default RisquesPage;