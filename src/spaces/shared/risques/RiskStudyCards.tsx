// src/spaces/shared/risques/RiskStudyCards.tsx
// ============================================================================
// SOCLE PARTAGÉ — COMPOSANTS DE PRÉSENTATION DES RISQUES     VERSION 1.0.0
// ============================================================================
// Exemplaire unique consommé par RisquesPage (promoteur) et
// InvestisseurRisquesPanel. Ces composants étaient dupliqués à l'identique ;
// la copie Investisseur n'avait jamais reçu les correctifs de v1.1.0.
//
// Ce que ces composants garantissent :
//   • un score `null` s'affiche « — / non mesuré », jamais 0 ni « null » ;
//   • une barre de progression non mesurée est vide, jamais `width:"null%"` ;
//   • un décompte issu d'une source muette s'affiche « — », jamais « 0 » ;
//   • aucune formule d'absence de risque (« Hors zone PPRI », « Aucun arrêté »)
//     n'est produite sans que la source ait effectivement répondu.
// ============================================================================

import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Atom,
  Bug,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Droplets,
  Factory,
  FileText,
  Flame,
  HelpCircle,
  Info,
  Layers,
  Mountain,
  Skull,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import React, { useState } from "react";

import {
  formatDistance,
  formatNumber,
  formatSourceCount,
  getRiskBg,
  getRiskColor,
  getRiskLabel,
  getScoreColor,
  getVerdictConfig,
  isLevelMeasured,
  isMeasured,
  scoreBarWidth,
} from "./riskDisplay";

import type {
  ArgilesData,
  CatnatEvent,
  CaviteData,
  FeuxForetData,
  GasparData,
  IcpeData,
  InondationData,
  Insight,
  InsightType,
  MvtData,
  RadonData,
  RiskLevel,
  SeismeData,
  SisData,
} from "./riskStudy.types";

// ─── Styles locaux (neutres, non thématisés) ────────────────────────────────

const styles = {
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
};

/** Mention discrète et systématique quand une source n'a pas répondu. */
export const NonMesureNote: React.FC<{ source: string }> = ({ source }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: "8px",
    padding: "10px 12px", background: "#f1f5f9",
    border: "1px solid #e2e8f0", borderRadius: "8px",
    fontSize: "12px", color: "#475569", marginTop: "10px",
  }}>
    <HelpCircle size={14} color="#64748b" style={{ flexShrink: 0 }} />
    <span>{source} n'a pas répondu : ce critère n'est pas mesuré, ce qui ne veut pas dire qu'il est nul.</span>
  </div>
);

/** Avertissement de troncature : un plafond de requête n'est pas un décompte. */
const TruncatedNote: React.FC<{ label: string }> = ({ label }) => (
  <div style={{
    padding: "8px 12px", background: "#fef3c7", border: "1px solid #fcd34d",
    borderRadius: "8px", fontSize: "11px", color: "#92400e", marginTop: "10px",
  }}>
    Résultat tronqué par la pagination : {label} est un plafond de requête, pas un décompte exhaustif.
  </div>
);

// ============================================
// RISK GAUGE
// ============================================
export const RiskGauge: React.FC<{ score: number | null; size?: number }> = ({ score, size = 160 }) => {
  const radius = (size - 20) / 2;
  const circumference = 2 * Math.PI * radius;
  // Non mesuré : arc vide et « — » au centre, plutôt qu'un « null » ou un 0
  // qui se lirait comme un risque maximal.
  const progress = score == null ? 0 : (score / 100) * circumference;
  const color = getScoreColor(score);
  const verdict = getVerdictConfig(score);
  const VerdictIcon = verdict.icon;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#fee2e2" strokeWidth="12" />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
            style={{ transition: "stroke-dashoffset 1s ease-out" }}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: size * 0.25, fontWeight: 800, color }}>{score ?? "—"}</span>
          <span style={{ fontSize: size * 0.08, color: "#94a3b8", fontWeight: 500 }}>
            {score == null ? "non mesuré" : "/ 100"}
          </span>
        </div>
      </div>
      <div style={{ ...styles.badge, background: verdict.bg, color: verdict.color, padding: "8px 16px", fontSize: "13px" }}>
        <VerdictIcon size={16} />
        {verdict.label}
      </div>
    </div>
  );
};

// ============================================
// CATEGORY SCORE BAR
// ============================================
export const CategoryScoreBar: React.FC<{
  name: string;
  score: number | null;
  level: RiskLevel;
  icon: LucideIcon;
  criteresMesures?: number;
  criteresTotal?: number;
}> = ({ name, score, level, icon: Icon, criteresMesures, criteresTotal }) => {
  const color = getRiskColor(level);
  const nonMesure = score == null;
  const partiel = !nonMesure && criteresTotal != null && criteresMesures != null
    && criteresMesures < criteresTotal;

  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Icon size={16} color={color} />
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>{name}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{
            fontSize: "11px", padding: "2px 8px",
            background: getRiskBg(level), color,
            borderRadius: "4px", fontWeight: 600,
          }}>
            {getRiskLabel(level)}
          </span>
          {partiel && (
            <span style={{ fontSize: "10px", color: "#64748b", fontWeight: 500 }}>
              {criteresMesures}/{criteresTotal} critères
            </span>
          )}
          <span style={{
            fontSize: nonMesure ? "11px" : "14px",
            fontWeight: 700,
            color: nonMesure ? "#94a3b8" : color,
          }}>
            {nonMesure ? "non mesuré" : score}
          </span>
        </div>
      </div>
      <div style={{ height: "8px", background: "#f1f5f9", borderRadius: "4px", overflow: "hidden" }}>
        {/* scoreBarWidth évite le `width:"null%"` que le navigateur ignore
            silencieusement, laissant la barre précédente à l'écran. */}
        <div style={{
          width: scoreBarWidth(score),
          height: "100%",
          background: color,
          borderRadius: "4px",
          transition: "width 0.8s ease-out",
        }} />
      </div>
    </div>
  );
};

// ============================================
// INSIGHT CARD
// ============================================
export const InsightCard: React.FC<{ insight: Insight }> = ({ insight }) => {
  const configs: Record<InsightType, { bg: string; border: string; color: string; icon: LucideIcon }> = {
    critical: { bg: "#fef2f2", border: "#fecaca", color: "#991b1b", icon: AlertOctagon },
    warning:  { bg: "#fef3c7", border: "#fcd34d", color: "#92400e", icon: AlertTriangle },
    positive: { bg: "#ecfdf5", border: "#a7f3d0", color: "#065f46", icon: CheckCircle },
    info:     { bg: "#f0f9ff", border: "#bae6fd", color: "#0369a1", icon: Info },
  };
  const config = configs[insight.type] ?? configs.info;
  const Icon = config.icon;

  return (
    <div style={{
      padding: "14px 16px", background: config.bg,
      border: `1px solid ${config.border}`, borderRadius: "10px",
      marginBottom: "10px", display: "flex", alignItems: "flex-start", gap: "12px",
    }}>
      <Icon size={18} color={config.color} style={{ flexShrink: 0, marginTop: "2px" }} />
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: "10px", fontWeight: 600, color: config.color, textTransform: "uppercase", opacity: 0.8 }}>
          {insight.category}
        </span>
        <p style={{ fontSize: "13px", color: "#1e293b", margin: "4px 0 0 0", lineHeight: 1.5 }}>
          {insight.message}
        </p>
      </div>
    </div>
  );
};

// ============================================
// RISK DETAIL CARD
// ============================================
export const RiskDetailCard: React.FC<{
  title: string;
  icon: LucideIcon;
  level: RiskLevel;
  children: ReactNode;
  defaultOpen?: boolean;
}> = ({ title, icon: Icon, level, children, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const color = getRiskColor(level);
  const mesure = isLevelMeasured(level);

  return (
    <div style={{ ...styles.card, borderLeft: `4px solid ${color}`, marginBottom: "16px" }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: "40px", height: "40px", borderRadius: "10px",
            background: getRiskBg(level),
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon size={20} color={color} />
          </div>
          <div>
            <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1e293b", margin: 0 }}>{title}</h3>
            <span style={{ fontSize: "12px", color, fontWeight: 600 }}>
              {/* « Risque non mesuré » et non « Risque nul » : la nuance est
                  toute la différence entre une information et un trou. */}
              {mesure ? `Risque ${getRiskLabel(level).toLowerCase()}` : "Risque non mesuré"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ ...styles.badge, background: getRiskBg(level), color }}>{getRiskLabel(level)}</span>
          {isOpen ? <ChevronUp size={20} color="#64748b" /> : <ChevronDown size={20} color="#64748b" />}
        </div>
      </div>
      {isOpen && (
        <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #f1f5f9" }}>
          {children}
        </div>
      )}
    </div>
  );
};

// ============================================
// GASPAR / CATNAT CARD
// ============================================
export const CatnatCard: React.FC<{ gaspar: GasparData }> = ({ gaspar }) => {
  const [showAll, setShowAll] = useState(false);

  // ⚠️ Ordre volontaire : on teste d'abord la couverture, ENSUITE les décomptes.
  // L'ancien code testait `catnat_count === 0 && ppr_count === 0` en premier et
  // concluait « aucun arrêté recensé » alors qu'une API muette renvoie
  // exactement ces deux zéros.
  if (!isMeasured(gaspar.coverage)) {
    return (
      <RiskDetailCard title="Catastrophes Naturelles (CATNAT)" icon={AlertTriangle} level="inconnu">
        <p style={{ color: "#64748b", fontSize: "14px", margin: 0 }}>
          La base GASPAR n'a pas répondu pour cette commune. Le nombre d'arrêtés de
          catastrophe naturelle et les PPR applicables sont inconnus.
        </p>
        <NonMesureNote source="Géorisques / GASPAR" />
      </RiskDetailCard>
    );
  }

  if (gaspar.catnat_count === 0 && gaspar.ppr_count === 0) {
    return (
      <RiskDetailCard title="Catastrophes Naturelles (CATNAT)" icon={AlertTriangle} level="nul">
        <p style={{ color: "#64748b", fontSize: "14px" }}>
          Aucun arrêté de catastrophe naturelle recensé sur cette commune.
        </p>
      </RiskDetailCard>
    );
  }

  const level: RiskLevel = gaspar.catnat_count > 10 ? 'fort' : gaspar.catnat_count > 5 ? 'moyen' : 'faible';

  const eventsByType: Record<string, CatnatEvent[]> = {};
  gaspar.catnat_events.forEach(e => {
    const type = e.libelle_risque || "Autre";
    if (!eventsByType[type]) eventsByType[type] = [];
    eventsByType[type].push(e);
  });

  return (
    <RiskDetailCard title="Catastrophes Naturelles (CATNAT)" icon={AlertTriangle} level={level} defaultOpen>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
        <div style={{ padding: "16px", background: "#fef2f2", borderRadius: "12px", textAlign: "center" }}>
          <AlertTriangle size={24} color="#dc2626" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "32px", fontWeight: 800, color: "#dc2626" }}>{gaspar.catnat_count}</div>
          <div style={{ fontSize: "12px", color: "#991b1b" }}>Arrêtés CATNAT</div>
        </div>
        <div style={{ padding: "16px", background: "#fef3c7", borderRadius: "12px", textAlign: "center" }}>
          <FileText size={24} color="#d97706" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "32px", fontWeight: 800, color: "#d97706" }}>{gaspar.ppr_count}</div>
          <div style={{ fontSize: "12px", color: "#92400e" }}>PPR applicables</div>
        </div>
      </div>

      {gaspar.truncated && <TruncatedNote label={`le total de ${gaspar.catnat_count} arrêtés`} />}

      <div style={{ marginBottom: "16px", marginTop: "16px" }}>
        <h4 style={{ fontSize: "13px", fontWeight: 600, color: "#64748b", marginBottom: "10px" }}>
          Répartition par type de risque
        </h4>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {Object.entries(eventsByType).map(([type, events]) => (
            <span key={type} style={{ ...styles.badge, background: "#fee2e2", color: "#991b1b", padding: "6px 12px" }}>
              {type}: {events.length}
            </span>
          ))}
        </div>
      </div>

      {gaspar.catnat_events.length > 0 && (
        <div>
          <h4 style={{ fontSize: "13px", fontWeight: 600, color: "#64748b", marginBottom: "10px" }}>
            Derniers événements
          </h4>
          <div style={{ maxHeight: showAll ? "none" : "200px", overflow: "hidden" }}>
            {gaspar.catnat_events.slice(0, showAll ? undefined : 5).map((event, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between",
                padding: "10px 12px", background: i % 2 === 0 ? "#f8fafc" : "white",
                borderRadius: "6px", marginBottom: "4px",
              }}>
                <span style={{ fontSize: "13px", color: "#1e293b" }}>{event.libelle_risque}</span>
                <span style={{ fontSize: "12px", color: "#64748b" }}>{event.date_debut || "—"}</span>
              </div>
            ))}
          </div>
          {gaspar.catnat_events.length > 5 && (
            <button
              onClick={() => setShowAll(!showAll)}
              style={{
                width: "100%", padding: "10px", marginTop: "8px",
                background: "#f1f5f9", border: "none", borderRadius: "8px",
                cursor: "pointer", fontSize: "13px", color: "#475569",
              }}
            >
              {showAll ? "Voir moins" : `Voir les ${gaspar.catnat_events.length - 5} autres`}
            </button>
          )}
        </div>
      )}

      {gaspar.ppr_list.length > 0 && (
        <div style={{ marginTop: "20px" }}>
          <h4 style={{ fontSize: "13px", fontWeight: 600, color: "#64748b", marginBottom: "10px" }}>
            Plans de Prévention des Risques
          </h4>
          {gaspar.ppr_list.map((ppr, i) => (
            <div key={i} style={{
              padding: "12px", background: "#fef3c7", borderRadius: "8px",
              marginBottom: "8px", borderLeft: "4px solid #f59e0b",
            }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#92400e" }}>{ppr.libelle}</div>
              <div style={{ fontSize: "11px", color: "#b45309", marginTop: "4px" }}>
                État: {ppr.etat || "Inconnu"} • Code: {ppr.code}
              </div>
            </div>
          ))}
        </div>
      )}
    </RiskDetailCard>
  );
};

// ============================================
// ICPE / SEVESO CARD
// ============================================
export const IcpeCard: React.FC<{ icpe: IcpeData }> = ({ icpe }) => {
  const [showAll, setShowAll] = useState(false);
  const mesure = isLevelMeasured(icpe.risk_level) && isMeasured(icpe.coverage);

  if (!mesure) {
    return (
      <RiskDetailCard title="Installations Industrielles (ICPE/SEVESO)" icon={Factory} level="inconnu">
        <p style={{ color: "#64748b", fontSize: "14px", margin: 0 }}>
          Le registre ICPE n'a pas répondu. Le nombre d'installations classées et de
          sites SEVESO à proximité est inconnu — et non pas nul.
        </p>
        <NonMesureNote source="Le registre ICPE" />
      </RiskDetailCard>
    );
  }

  return (
    <RiskDetailCard
      title="Installations Industrielles (ICPE/SEVESO)"
      icon={Factory}
      level={icpe.risk_level}
      defaultOpen={icpe.seveso_haut_count > 0 || icpe.seveso_bas_count > 0}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "20px" }}>
        <div style={{ padding: "16px", background: "#fef2f2", borderRadius: "12px", textAlign: "center" }}>
          <Skull size={20} color="#991b1b" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#991b1b" }}>{icpe.seveso_haut_count}</div>
          <div style={{ fontSize: "11px", color: "#991b1b" }}>SEVESO Seuil Haut</div>
        </div>
        <div style={{ padding: "16px", background: "#fef3c7", borderRadius: "12px", textAlign: "center" }}>
          <AlertTriangle size={20} color="#d97706" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#d97706" }}>{icpe.seveso_bas_count}</div>
          <div style={{ fontSize: "11px", color: "#92400e" }}>SEVESO Seuil Bas</div>
        </div>
        <div style={{ padding: "16px", background: "#f1f5f9", borderRadius: "12px", textAlign: "center" }}>
          <Factory size={20} color="#64748b" style={{ marginBottom: "8px" }} />
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#1e293b" }}>{icpe.count}</div>
          <div style={{ fontSize: "11px", color: "#64748b" }}>ICPE total</div>
        </div>
      </div>

      {icpe.truncated && <TruncatedNote label={`le total de ${icpe.count} ICPE`} />}

      {icpe.installations.length > 0 && (
        <div>
          <h4 style={{ fontSize: "13px", fontWeight: 600, color: "#64748b", marginBottom: "10px" }}>
            Installations à proximité
          </h4>
          <div style={{ maxHeight: showAll ? "400px" : "200px", overflowY: "auto" }}>
            {icpe.installations.slice(0, showAll ? undefined : 5).map((inst, i) => (
              <div key={i} style={{
                padding: "12px",
                background: inst.seveso ? (inst.seveso.toLowerCase().includes('haut') ? "#fef2f2" : "#fef3c7") : "#f8fafc",
                borderRadius: "8px", marginBottom: "8px",
                borderLeft: `4px solid ${inst.seveso ? (inst.seveso.toLowerCase().includes('haut') ? "#dc2626" : "#f59e0b") : "#e2e8f0"}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>{inst.nom}</div>
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>{inst.activite}</div>
                    {inst.seveso && (
                      <span style={{
                        ...styles.badge,
                        background: inst.seveso.toLowerCase().includes('haut') ? "#fee2e2" : "#fef3c7",
                        color: inst.seveso.toLowerCase().includes('haut') ? "#991b1b" : "#92400e",
                        marginTop: "6px",
                      }}>
                        {inst.seveso}
                      </span>
                    )}
                  </div>
                  {inst.distance_m != null && (
                    <span style={{ fontSize: "13px", fontWeight: 600, color: inst.distance_m < 1000 ? "#dc2626" : "#64748b" }}>
                      {formatDistance(inst.distance_m)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {icpe.installations.length > 5 && (
            <button
              onClick={() => setShowAll(!showAll)}
              style={{
                width: "100%", padding: "10px", marginTop: "8px",
                background: "#f1f5f9", border: "none", borderRadius: "8px",
                cursor: "pointer", fontSize: "13px", color: "#475569",
              }}
            >
              {showAll ? "Voir moins" : `Voir les ${icpe.installations.length - 5} autres`}
            </button>
          )}
        </div>
      )}
    </RiskDetailCard>
  );
};

// ============================================
// NATURAL RISKS SUMMARY CARD
// ============================================
export const NaturalRisksCard: React.FC<{
  inondation: InondationData;
  seisme: SeismeData;
  feuxForet: FeuxForetData;
  argiles: ArgilesData;
}> = ({ inondation, seisme, feuxForet, argiles }) => {
  const risks = [
    {
      name: "Inondation",
      icon: Droplets,
      level: inondation.risk_level,
      // `ppri === null` = GASPAR muet. Ne pas écrire « Hors zone PPRI », qui
      // affirmerait une absence de risque qu'on n'a pas vérifiée.
      detail: inondation.ppri == null
        ? "PPRI non vérifié"
        : inondation.ppri ? "PPRI actif" : "Hors zone PPRI",
    },
    {
      name: "Séisme",
      icon: Activity,
      level: seisme.risk_level,
      // `Zone ${null} - ` imprimait littéralement « Zone null - » à l'écran.
      detail: seisme.zone == null
        ? "Zone sismique non déterminée"
        : `Zone ${seisme.zone} - ${seisme.libelle}`,
    },
    {
      name: "Feux de forêt",
      icon: Flame,
      level: feuxForet.risk_level,
      detail: feuxForet.zone_risque == null
        ? "Exposition non vérifiée"
        : feuxForet.zone_risque ? "Zone exposée" : "Hors zone",
    },
    {
      name: "Argiles (RGA)",
      icon: Layers,
      level: argiles.risk_level,
      detail: argiles.niveau_alea || "Non évalué",
    },
  ];

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <Mountain size={20} color="#f59e0b" />
        Risques Naturels
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        {risks.map((risk, i) => {
          const Icon = risk.icon;
          const color = getRiskColor(risk.level);
          return (
            <div key={i} style={{
              padding: "16px", background: getRiskBg(risk.level),
              borderRadius: "12px", borderLeft: `4px solid ${color}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <Icon size={18} color={color} />
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>{risk.name}</span>
              </div>
              <div style={{ fontSize: "12px", color, fontWeight: 600, marginBottom: "4px" }}>
                {getRiskLabel(risk.level)}
              </div>
              <div style={{ fontSize: "11px", color: "#64748b" }}>{risk.detail}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================
// GEOTECHNICAL RISKS CARD
// ============================================
export const GeotechCard: React.FC<{ cavites: CaviteData; mvt: MvtData }> = ({ cavites, mvt }) => {
  const [showCavites, setShowCavites] = useState(false);
  const [showMvt, setShowMvt] = useState(false);

  const cavitesMesure = isLevelMeasured(cavites.risk_level) && isMeasured(cavites.coverage);
  const mvtMesure = isLevelMeasured(mvt.risk_level) && isMeasured(mvt.coverage);

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <Layers size={20} color="#8b5cf6" />
        Risques Géotechniques
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
        <div style={{
          padding: "16px", background: getRiskBg(cavites.risk_level),
          borderRadius: "12px", borderLeft: `4px solid ${getRiskColor(cavites.risk_level)}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <CircleDot size={18} color={getRiskColor(cavites.risk_level)} />
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>Cavités souterraines</span>
          </div>
          {/* « — » plutôt que « 0 » quand la base n'a pas répondu. */}
          <div style={{ fontSize: "28px", fontWeight: 800, color: getRiskColor(cavites.risk_level) }}>
            {formatSourceCount(cavites.count, cavites.risk_level, cavites.coverage)}
          </div>
          <div style={{ fontSize: "11px", color: "#64748b" }}>
            {!cavitesMesure
              ? "Base cavités indisponible"
              : cavites.cavites[0]?.distance_m
                ? `La plus proche: ${formatDistance(cavites.cavites[0].distance_m)}`
                : "Dans le secteur"}
          </div>
        </div>

        <div style={{
          padding: "16px", background: getRiskBg(mvt.risk_level),
          borderRadius: "12px", borderLeft: `4px solid ${getRiskColor(mvt.risk_level)}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <Mountain size={18} color={getRiskColor(mvt.risk_level)} />
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>Mouvements de terrain</span>
          </div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: getRiskColor(mvt.risk_level) }}>
            {formatSourceCount(mvt.count, mvt.risk_level, mvt.coverage)}
          </div>
          <div style={{ fontSize: "11px", color: "#64748b" }}>
            {mvtMesure ? "événements recensés" : "Base mouvements de terrain indisponible"}
          </div>
        </div>
      </div>

      {(!cavitesMesure || !mvtMesure) && (
        <NonMesureNote source={
          !cavitesMesure && !mvtMesure
            ? "Les bases cavités et mouvements de terrain"
            : !cavitesMesure ? "La base cavités" : "La base mouvements de terrain"
        } />
      )}

      {cavitesMesure && cavites.count > 0 && (
        <div style={{ marginBottom: "16px", marginTop: "16px" }}>
          <button
            onClick={() => setShowCavites(!showCavites)}
            style={{
              width: "100%", display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "12px 16px", background: "#f8fafc",
              border: "1px solid #e2e8f0", borderRadius: "8px", cursor: "pointer",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#475569" }}>
              Détail des {cavites.count} cavités
            </span>
            {showCavites ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showCavites && (
            <div style={{ marginTop: "8px", maxHeight: "200px", overflowY: "auto" }}>
              {cavites.cavites.map((c, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between",
                  padding: "10px 12px", background: i % 2 === 0 ? "#f8fafc" : "white",
                  borderRadius: "6px",
                }}>
                  <div>
                    <span style={{ fontSize: "13px", color: "#1e293b" }}>{c.type}</span>
                    {c.nom && <span style={{ fontSize: "11px", color: "#64748b", marginLeft: "8px" }}>{c.nom}</span>}
                  </div>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#64748b" }}>
                    {formatDistance(c.distance_m)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mvtMesure && mvt.count > 0 && (
        <div>
          <button
            onClick={() => setShowMvt(!showMvt)}
            style={{
              width: "100%", display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "12px 16px", background: "#f8fafc",
              border: "1px solid #e2e8f0", borderRadius: "8px", cursor: "pointer",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#475569" }}>
              Détail des {mvt.count} mouvements
            </span>
            {showMvt ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showMvt && (
            <div style={{ marginTop: "8px", maxHeight: "200px", overflowY: "auto" }}>
              {mvt.mouvements.map((m, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between",
                  padding: "10px 12px", background: i % 2 === 0 ? "#f8fafc" : "white",
                  borderRadius: "6px",
                }}>
                  <div>
                    <span style={{ fontSize: "13px", color: "#1e293b" }}>{m.type}</span>
                    {m.date && <span style={{ fontSize: "11px", color: "#64748b", marginLeft: "8px" }}>{m.date}</span>}
                  </div>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#64748b" }}>
                    {formatDistance(m.distance_m)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================
// POLLUTION CARD
// ============================================
export const PollutionCard: React.FC<{ sis: SisData; radon: RadonData }> = ({ sis, radon }) => {
  const [showSites, setShowSites] = useState(false);

  const sisMesure = isLevelMeasured(sis.risk_level) && isMeasured(sis.coverage);
  const radonMesure = radon.classe_potentiel != null && isLevelMeasured(radon.risk_level);

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <Bug size={20} color="#dc2626" />
        Pollution &amp; Qualité des Sols
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
        <div style={{
          padding: "16px", background: getRiskBg(sis.risk_level),
          borderRadius: "12px", borderLeft: `4px solid ${getRiskColor(sis.risk_level)}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <Skull size={18} color={getRiskColor(sis.risk_level)} />
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>Sites pollués (SIS)</span>
          </div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: getRiskColor(sis.risk_level) }}>
            {formatSourceCount(sis.count, sis.risk_level, sis.coverage)}
          </div>
          <div style={{ fontSize: "11px", color: "#64748b" }}>
            {sisMesure ? "Secteurs d'Information sur les Sols" : "Base SIS indisponible"}
          </div>
        </div>

        <div style={{
          padding: "16px", background: getRiskBg(radon.risk_level),
          borderRadius: "12px", borderLeft: `4px solid ${getRiskColor(radon.risk_level)}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <Atom size={18} color={getRiskColor(radon.risk_level)} />
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>Radon</span>
          </div>
          <div style={{ fontSize: "28px", fontWeight: 800, color: getRiskColor(radon.risk_level) }}>
            {radon.classe_potentiel ?? "—"}
          </div>
          {/* Ne plus imprimer « Classe null - ». */}
          <div style={{ fontSize: "11px", color: "#64748b" }}>
            {radonMesure
              ? `Classe ${radon.classe_potentiel} - ${radon.libelle}`
              : "Potentiel radon non renseigné pour cette commune"}
          </div>
        </div>
      </div>

      {(!sisMesure || !radonMesure) && (
        <NonMesureNote source={
          !sisMesure && !radonMesure
            ? "Les bases SIS et radon"
            : !sisMesure ? "La base SIS" : "La base radon"
        } />
      )}

      {sisMesure && sis.count > 0 && (
        <div style={{ marginTop: "16px" }}>
          <button
            onClick={() => setShowSites(!showSites)}
            style={{
              width: "100%", display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "12px 16px", background: "#fef2f2",
              border: "1px solid #fecaca", borderRadius: "8px", cursor: "pointer",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#991b1b" }}>
              ⚠️ {sis.count} site(s) pollué(s) identifié(s)
            </span>
            {showSites ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showSites && (
            <div style={{ marginTop: "8px" }}>
              {sis.sites.map((site, i) => (
                <div key={i} style={{
                  padding: "12px", background: "#fef2f2", borderRadius: "8px",
                  marginBottom: "8px", borderLeft: "4px solid #dc2626",
                }}>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#991b1b" }}>{site.nom}</div>
                  <div style={{ fontSize: "12px", color: "#b91c1c", marginTop: "4px" }}>
                    {site.adresse || site.commune}
                    {site.superficie_m2 != null && ` • ${formatNumber(site.superficie_m2)} m²`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
