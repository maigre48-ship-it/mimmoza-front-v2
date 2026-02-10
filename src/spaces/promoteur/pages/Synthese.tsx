// ============================================
// SynthesePage.tsx - VERSION 2.0.0
// ============================================
// Synthèse consolidée pour banque/comité d'investissement
// Collecte automatique des données depuis localStorage
// Utilise Claude API via Edge Function
// ============================================

import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  FileText, Loader2, AlertTriangle, CheckCircle,
  Building2, MapPin, TrendingUp, Shield, Calculator, Sparkles,
  RefreshCw, Target, BarChart3, Landmark, Copy, Check,
  XCircle, AlertOctagon, Bug, ChevronDown, ChevronUp
} from "lucide-react";

// ============================================
// TYPES
// ============================================

interface SelectedParcel {
  id: string;
  feature?: unknown;
  area_m2?: number | null;
}

interface ProjectInfo {
  name?: string;
  address?: string;
  city?: string;
  parcelId?: string;
  parcelIds?: string[];
  communeInsee?: string;
  surfaceM2?: number;
  lat?: number;
  lon?: number;
  projectType?: string;
}

interface ModuleData {
  ok: boolean;
  summary?: string;
  data?: Record<string, unknown>;
}

interface PromoteurSnapshot {
  version: string;
  createdAt: string;
  projectInfo: ProjectInfo;
  modules: {
    foncier?: ModuleData;
    plu?: ModuleData;
    implantation2d?: ModuleData;
    market?: ModuleData;
    risks?: ModuleData;
    bilan?: ModuleData;
  };
}

interface SynthesisResponse {
  success: boolean;
  version: string;
  meta: {
    format: string;
    project_name: string;
    commune?: string;
    generated_at: string;
    duration_ms: number;
    modules_used: Record<string, boolean>;
  };
  summary: {
    market_score: number | null;
    risk_score: number | null;
    marge_pct: number | null;
    ca_total: number | null;
    surface_plancher: number | null;
  };
  synthesis: string;
  error?: string;
}

type SynthesisFormat = 'banque' | 'investisseur' | 'technique';

// ============================================
// CONSTANTS - LOCALSTORAGE KEYS
// ============================================

const LS_KEYS = {
  // Foncier
  FONCIER_SELECTED: "mimmoza.promoteur.foncier.selected_v1",
  FONCIER_COMMUNE: "mimmoza.promoteur.foncier.commune_v1",
  FONCIER_FOCUS: "mimmoza.promoteur.foncier.focus_v1",
  
  // Session (fallback)
  SESSION_PARCEL: "mimmoza.session.parcel_id",
  SESSION_COMMUNE: "mimmoza.session.commune_insee",
  SESSION_PARCELS: "mimmoza.session.parcel_ids",
  SESSION_SURFACE: "mimmoza.session.surface_m2",
  SESSION_ADDRESS: "mimmoza.session.address",
  
  // PLU metadata
  PLU_LAST_COMMUNE_INSEE: "mimmoza.plu.last_commune_insee",
  PLU_LAST_COMMUNE_NOM: "mimmoza.plu.last_commune_nom",
  PLU_LAST_ADDRESS: "mimmoza.plu.last_address",
  PLU_LAST_PARCEL: "mimmoza.plu.last_parcel_id",
  
  // Project
  PROJECT_V2: "mimmoza.promoteur.project.v2",
  PROJECT_V1: "mimmoza.promoteur.project.v1",
  
  // Snapshot existant
  SNAPSHOT_V1: "mimmoza.promoteur.snapshot.v1",
};

const FORMAT_CONFIG: Record<SynthesisFormat, { label: string; desc: string; icon: typeof Landmark; color: string }> = {
  banque: { label: "Banque / Crédit", desc: "Dossier pour comité de crédit bancaire", icon: Landmark, color: "#1d4ed8" },
  investisseur: { label: "Investisseur", desc: "Mémorandum d'investissement", icon: TrendingUp, color: "#059669" },
  technique: { label: "Technique", desc: "Note de faisabilité technique", icon: Target, color: "#7c3aed" },
};

const MODULE_CONFIG = [
  { key: 'market', label: 'Étude de Marché', desc: 'DVF, prix, tension', icon: TrendingUp, color: '#0ea5e9' },
  { key: 'risks', label: 'Étude de Risques', desc: 'Géorisques, CATNAT', icon: Shield, color: '#ef4444' },
  { key: 'bilan', label: 'Bilan Promoteur', desc: 'Coûts, CA, marge', icon: Calculator, color: '#f59e0b' },
  { key: 'implantation2d', label: 'Implantation 2D', desc: 'Surfaces, conformité', icon: Building2, color: '#8b5cf6' },
  { key: 'plu', label: 'Règles PLU', desc: 'Zone, CES, hauteur', icon: MapPin, color: '#64748b' },
];

// ============================================
// STYLES
// ============================================

const styles = {
  container: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%)",
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  } as React.CSSProperties,

  header: {
    background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)",
    padding: "32px 40px",
    color: "white",
  } as React.CSSProperties,

  mainContent: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "32px 40px",
  } as React.CSSProperties,

  card: {
    background: "white",
    borderRadius: "16px",
    padding: "24px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
    border: "1px solid #e2e8f0",
    marginBottom: "24px",
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

  button: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    padding: "14px 28px",
    border: "none",
    borderRadius: "12px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
  } as React.CSSProperties,
};

// ============================================
// HELPERS
// ============================================

function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function formatNumber(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("fr-FR");
}

function markdownToHtml(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split('|').filter(c => c.trim());
      const isHeader = cells.some(c => c.includes('---'));
      if (isHeader) return '';
      return `<tr>${cells.map(c => `<td>${c.trim()}</td>`).join('')}</tr>`;
    })
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  html = html.replace(/(<tr>.*<\/tr>(\s*<tr>.*<\/tr>)*)/g, '<table class="md-table">$1</table>');
  return `<div class="md-content"><p>${html}</p></div>`;
}

function findKeyByPrefix(prefix: string): string | null {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
  return keys.length > 0 ? keys[0] : null;
}

// ============================================
// DATA COLLECTOR
// ============================================

function collectDataFromLocalStorage(): PromoteurSnapshot {
  console.log("[Synthese] Collecting data from localStorage...");
  
  // ========== FONCIER ==========
  const parcelsRaw = localStorage.getItem(LS_KEYS.FONCIER_SELECTED);
  const parcels = safeJsonParse<SelectedParcel[]>(parcelsRaw, []);
  const communeInsee = localStorage.getItem(LS_KEYS.FONCIER_COMMUNE) 
    || localStorage.getItem(LS_KEYS.SESSION_COMMUNE) 
    || localStorage.getItem(LS_KEYS.PLU_LAST_COMMUNE_INSEE)
    || "";
  const communeNom = localStorage.getItem(LS_KEYS.PLU_LAST_COMMUNE_NOM) || "";
  const focusParcel = localStorage.getItem(LS_KEYS.FONCIER_FOCUS) 
    || localStorage.getItem(LS_KEYS.SESSION_PARCEL) 
    || "";
  const address = localStorage.getItem(LS_KEYS.SESSION_ADDRESS) 
    || localStorage.getItem(LS_KEYS.PLU_LAST_ADDRESS) 
    || "";
  
  let totalSurface = 0;
  if (parcels.length > 0) {
    totalSurface = parcels.reduce((sum, p) => {
      if (p.area_m2) return sum + p.area_m2;
      const feat = p.feature as { properties?: { contenance?: number } } | undefined;
      if (feat?.properties?.contenance) return sum + feat.properties.contenance;
      return sum;
    }, 0);
  }
  if (totalSurface === 0) {
    const sessionSurface = localStorage.getItem(LS_KEYS.SESSION_SURFACE);
    if (sessionSurface) totalSurface = parseFloat(sessionSurface) || 0;
  }
  
  const foncierOk = parcels.length > 0 || !!focusParcel;
  console.log("[Synthese] Foncier:", { parcels: parcels.length, communeInsee, foncierOk });
  
  // ========== EXISTING SNAPSHOT ==========
  const existingSnapshot = safeJsonParse<Record<string, unknown>>(localStorage.getItem(LS_KEYS.SNAPSHOT_V1), {});
  const existingModules = (existingSnapshot as { modules?: Record<string, ModuleData> })?.modules || {};
  const existingMassing = (existingSnapshot as { massing3d?: ModuleData })?.massing3d;
  
  // ========== PLU ==========
  const existingPlu = existingModules.plu;
  const pluOk = existingPlu?.ok === true;
  console.log("[Synthese] PLU:", { pluOk });
  
  // ========== IMPLANTATION 2D ==========
  const projectV2 = safeJsonParse<{ state?: Record<string, unknown> }>(localStorage.getItem(LS_KEYS.PROJECT_V2), null);
  const projectV1 = safeJsonParse<{ state?: Record<string, unknown> }>(localStorage.getItem(LS_KEYS.PROJECT_V1), null);
  const projectState = projectV2?.state || projectV1?.state;
  const existingImplant = existingModules.implantation2d;
  const implantOk = !!projectState || existingImplant?.ok === true || existingMassing?.ok === true;
  console.log("[Synthese] Implantation:", { implantOk });
  
  // ========== MARKET ==========
  const marketKey = findKeyByPrefix("mimmoza.promoteur.market");
  const marketData = marketKey ? safeJsonParse<Record<string, unknown>>(localStorage.getItem(marketKey), null) : null;
  const existingMarket = existingModules.market;
  const marketOk = !!marketData || existingMarket?.ok === true;
  console.log("[Synthese] Market:", { marketOk, marketKey });
  
  // ========== RISKS ==========
  const risksKey = findKeyByPrefix("mimmoza.promoteur.risks");
  const risksData = risksKey ? safeJsonParse<Record<string, unknown>>(localStorage.getItem(risksKey), null) : null;
  const existingRisks = existingModules.risks;
  const risksOk = !!risksData || existingRisks?.ok === true;
  console.log("[Synthese] Risks:", { risksOk, risksKey });
  
  // ========== BILAN ==========
  const bilanKey = findKeyByPrefix("mimmoza.promoteur.bilan");
  const bilanData = bilanKey ? safeJsonParse<Record<string, unknown>>(localStorage.getItem(bilanKey), null) : null;
  const existingBilan = existingModules.bilan;
  const bilanOk = !!bilanData || existingBilan?.ok === true;
  console.log("[Synthese] Bilan:", { bilanOk, bilanKey });
  
  // ========== BUILD SNAPSHOT ==========
  const snapshot: PromoteurSnapshot = {
    version: "2.0.0",
    createdAt: new Date().toISOString(),
    projectInfo: {
      parcelId: focusParcel,
      parcelIds: parcels.map(p => p.id),
      communeInsee,
      city: communeNom || (communeInsee ? `Commune ${communeInsee}` : undefined),
      address: address || undefined,
      surfaceM2: totalSurface || undefined,
    },
    modules: {
      foncier: {
        ok: foncierOk,
        summary: foncierOk ? `${parcels.length || 1} parcelle(s)${totalSurface ? `, ${formatNumber(totalSurface)} m²` : ''}` : undefined,
        data: foncierOk ? { parcels, communeInsee, communeNom, totalSurface, focusParcel, address } : undefined,
      },
      plu: existingPlu || { ok: pluOk, summary: pluOk ? "Règles PLU disponibles" : undefined },
      implantation2d: {
        ok: implantOk,
        summary: implantOk ? "Implantation définie" : undefined,
        data: implantOk ? (projectState || existingImplant?.data || existingMassing?.data) : undefined,
      },
      market: existingMarket || { ok: marketOk, summary: marketOk ? "Étude disponible" : undefined, data: marketData || undefined },
      risks: existingRisks || { ok: risksOk, summary: risksOk ? "Étude disponible" : undefined, data: risksData || undefined },
      bilan: existingBilan || { ok: bilanOk, summary: bilanOk ? "Bilan disponible" : undefined, data: bilanData || undefined },
    },
  };
  
  console.log("[Synthese] Final snapshot:", snapshot);
  return snapshot;
}

// ============================================
// DEBUG PANEL
// ============================================

const DebugPanel: React.FC<{ snapshot: PromoteurSnapshot; onRefresh: () => void }> = ({ snapshot, onRefresh }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [allKeys, setAllKeys] = useState<{ key: string; preview: string }[]>([]);
  
  useEffect(() => {
    if (isOpen) {
      const keys = Object.keys(localStorage)
        .filter(k => k.startsWith('mimmoza'))
        .sort()
        .map(k => ({
          key: k,
          preview: (localStorage.getItem(k) || '').substring(0, 100) + '...',
        }));
      setAllKeys(keys);
    }
  }, [isOpen]);
  
  return (
    <div style={{ ...styles.card, background: "#fefce8", border: "1px solid #fde047" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setIsOpen(!isOpen)}>
        <div style={{ ...styles.cardTitle, marginBottom: 0, color: "#854d0e" }}>
          <Bug size={20} />
          Debug - Données collectées
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={(e) => { e.stopPropagation(); onRefresh(); }} style={{ padding: "6px 12px", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "6px", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}>
            <RefreshCw size={14} />
            Actualiser
          </button>
          {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </div>
      
      {isOpen && (
        <div style={{ marginTop: "16px" }}>
          <div style={{ marginBottom: "16px" }}>
            <strong>Snapshot généré:</strong>
            <pre style={{ background: "#fef9c3", padding: "12px", borderRadius: "8px", fontSize: "11px", overflow: "auto", maxHeight: "200px" }}>
              {JSON.stringify(snapshot, null, 2)}
            </pre>
          </div>
          <div>
            <strong>Clés localStorage mimmoza.* ({allKeys.length}):</strong>
            <div style={{ background: "#fef9c3", padding: "12px", borderRadius: "8px", fontSize: "11px", maxHeight: "300px", overflow: "auto", marginTop: "8px" }}>
              {allKeys.map(({ key, preview }) => (
                <div key={key} style={{ marginBottom: "8px", borderBottom: "1px solid #fde68a", paddingBottom: "8px" }}>
                  <div style={{ fontWeight: 600, color: "#92400e" }}>{key}</div>
                  <div style={{ color: "#78350f", opacity: 0.7 }}>{preview}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================
// MODULE STATUS
// ============================================

const ModuleStatus: React.FC<{ config: typeof MODULE_CONFIG[0]; module?: ModuleData }> = ({ config, module }) => {
  const isOk = module?.ok === true;
  const Icon = config.icon;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", background: isOk ? "#f0fdf4" : "#f8fafc", borderRadius: "10px", border: `1px solid ${isOk ? "#bbf7d0" : "#e2e8f0"}` }}>
      <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: isOk ? config.color : "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={18} color="white" />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>{config.label}</div>
        <div style={{ fontSize: "11px", color: "#64748b" }}>{module?.summary || config.desc}</div>
      </div>
      {isOk ? <CheckCircle size={18} color="#22c55e" /> : <XCircle size={18} color="#94a3b8" />}
    </div>
  );
};

// ============================================
// FORMAT SELECTOR
// ============================================

const FormatSelector: React.FC<{ selected: SynthesisFormat; onChange: (format: SynthesisFormat) => void }> = ({ selected, onChange }) => {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
      {(Object.entries(FORMAT_CONFIG) as [SynthesisFormat, typeof FORMAT_CONFIG.banque][]).map(([key, cfg]) => {
        const Icon = cfg.icon;
        const isSelected = selected === key;
        return (
          <div key={key} onClick={() => onChange(key)} style={{ padding: "16px", borderRadius: "12px", border: `2px solid ${isSelected ? cfg.color : "#e2e8f0"}`, background: isSelected ? `${cfg.color}10` : "white", cursor: "pointer", transition: "all 0.2s" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: isSelected ? cfg.color : "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "10px" }}>
              <Icon size={20} color={isSelected ? "white" : "#64748b"} />
            </div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>{cfg.label}</div>
            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>{cfg.desc}</div>
          </div>
        );
      })}
    </div>
  );
};

// ============================================
// SYNTHESIS RESULT
// ============================================

const SynthesisResult: React.FC<{ result: SynthesisResponse; onRegenerate: () => void }> = ({ result, onRegenerate }) => {
  const [copied, setCopied] = useState(false);
  const formatCfg = FORMAT_CONFIG[result.meta.format as SynthesisFormat] || FORMAT_CONFIG.banque;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(result.synthesis);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [result.synthesis]);

  const handleDownloadPdf = useCallback(() => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('Veuillez autoriser les popups'); return; }
    const htmlContent = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${result.meta.project_name} - Synthèse</title><style>@page { margin: 25mm; size: A4; } * { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; line-height: 1.7; font-size: 11pt; padding: 40px; } .header { background: ${formatCfg.color}; color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; } .header h1 { font-size: 22pt; margin-bottom: 8px; } .header p { opacity: 0.9; font-size: 12pt; } .md-h1 { font-size: 18pt; font-weight: 700; color: #0f172a; margin: 28px 0 14px 0; border-bottom: 2px solid ${formatCfg.color}; padding-bottom: 8px; } .md-h2 { font-size: 14pt; font-weight: 700; color: #1e293b; margin: 24px 0 12px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; } .md-h3 { font-size: 12pt; font-weight: 600; color: #334155; margin: 18px 0 10px 0; } .md-content p { margin: 10px 0; } .md-content ul { margin: 12px 0; padding-left: 24px; } .md-content li { margin: 6px 0; } .md-table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 10pt; } .md-table td { border: 1px solid #e2e8f0; padding: 8px 12px; } .md-table tr:nth-child(odd) { background: #f8fafc; } .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 9pt; color: #94a3b8; text-align: center; }</style></head><body><div class="header"><h1>${result.meta.project_name}</h1><p>${formatCfg.label} • ${result.meta.commune || ''} • Généré le ${new Date(result.meta.generated_at).toLocaleDateString('fr-FR')}</p></div>${markdownToHtml(result.synthesis)}<div class="footer"><p>Document généré par Mimmoza - Plateforme d'Intelligence Immobilière</p></div></body></html>`;
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.onload = () => setTimeout(() => printWindow.print(), 300);
  }, [result, formatCfg]);

  return (
    <div>
      <div style={{ background: `linear-gradient(135deg, ${formatCfg.color} 0%, ${formatCfg.color}dd 100%)`, borderRadius: "16px", padding: "28px", marginBottom: "24px", color: "white" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <Sparkles size={24} />
              <h2 style={{ fontSize: "22px", fontWeight: 700, margin: 0 }}>{result.meta.project_name}</h2>
            </div>
            <p style={{ fontSize: "14px", opacity: 0.9, margin: 0 }}>{formatCfg.label} • {result.meta.commune} • Généré en {(result.meta.duration_ms / 1000).toFixed(1)}s</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
            {result.summary.market_score !== null && <span style={{ ...styles.badge, background: "rgba(255,255,255,0.2)", color: "white" }}>Marché: {result.summary.market_score}/100</span>}
            {result.summary.marge_pct !== null && <span style={{ ...styles.badge, background: "rgba(255,255,255,0.2)", color: "white" }}>Marge: {result.summary.marge_pct.toFixed(1)}%</span>}
          </div>
        </div>
      </div>
      <div style={{ ...styles.card, padding: "32px" }}>
        <style>{`.md-content { font-size: 14px; line-height: 1.8; color: #334155; } .md-h1 { font-size: 20px; font-weight: 700; color: #0f172a; margin: 32px 0 16px 0; border-bottom: 2px solid ${formatCfg.color}; padding-bottom: 10px; } .md-h2 { font-size: 17px; font-weight: 700; color: #1e293b; margin: 28px 0 14px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; } .md-h3 { font-size: 15px; font-weight: 600; color: #475569; margin: 20px 0 10px 0; } .md-content p { margin: 12px 0; } .md-content ul { margin: 14px 0; padding-left: 24px; } .md-content li { margin: 8px 0; } .md-content strong { color: #0f172a; } .md-table { width: 100%; border-collapse: collapse; margin: 20px 0; } .md-table td { border: 1px solid #e2e8f0; padding: 10px 14px; font-size: 13px; } .md-table tr:nth-child(odd) { background: #f8fafc; } .md-table tr:first-child { background: #f1f5f9; font-weight: 600; }`}</style>
        <div dangerouslySetInnerHTML={{ __html: markdownToHtml(result.synthesis) }} />
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: "16px", marginTop: "24px" }}>
        <button onClick={handleDownloadPdf} style={{ ...styles.button, background: formatCfg.color, color: "white" }}><FileText size={18} />Télécharger PDF</button>
        <button onClick={handleCopy} style={{ ...styles.button, background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }}>{copied ? <Check size={18} color="#22c55e" /> : <Copy size={18} />}{copied ? "Copié !" : "Copier"}</button>
        <button onClick={onRegenerate} style={{ ...styles.button, background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }}><RefreshCw size={18} />Régénérer</button>
      </div>
    </div>
  );
};

// ============================================
// MAIN COMPONENT
// ============================================

export function SynthesePage() {
  const [snapshot, setSnapshot] = useState<PromoteurSnapshot | null>(null);
  const [format, setFormat] = useState<SynthesisFormat>('banque');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<SynthesisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSnapshot = useCallback(() => {
    try {
      const collected = collectDataFromLocalStorage();
      setSnapshot(collected);
    } catch (err) {
      console.error("[Synthese] Failed to collect data:", err);
    }
  }, []);

  useEffect(() => { loadSnapshot(); }, [loadSnapshot]);

  const availableModules = useMemo(() => {
    if (!snapshot?.modules) return 0;
    return Object.values(snapshot.modules).filter(m => m?.ok).length;
  }, [snapshot]);

  const handleGenerate = useCallback(async () => {
    if (!snapshot) { setError("Aucune donnée disponible."); return; }
    setIsGenerating(true);
    setError(null);
    setResult(null);

    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
      const payload = { snapshot: { projectInfo: snapshot.projectInfo, modules: { market: snapshot.modules.market, risks: snapshot.modules.risks, implantation2d: snapshot.modules.implantation2d, bilan: snapshot.modules.bilan, plu: snapshot.modules.plu } }, format };
      console.log("[Synthese] Sending payload:", payload);

      const response = await fetch(`${SUPABASE_URL}/functions/v1/synthesis-promoteur-v1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}`, "apikey": SUPABASE_ANON_KEY },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      console.log("[Synthese] Response:", data);

      if (!response.ok || !data.success) throw new Error(data.error || `Erreur ${response.status}`);
      setResult(data);
    } catch (err) {
      console.error("[Synthese] Error:", err);
      setError(err instanceof Error ? err.message : "Erreur lors de la génération");
    } finally {
      setIsGenerating(false);
    }
  }, [snapshot, format]);

  const project = snapshot?.projectInfo;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <FileText size={28} />
          <h1 style={{ fontSize: "28px", fontWeight: 700, margin: 0 }}>Synthèse Projet</h1>
          <span style={{ padding: "4px 12px", background: "rgba(255,255,255,0.2)", borderRadius: "6px", fontSize: "13px" }}>Claude AI</span>
        </div>
        <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.7)", margin: 0 }}>Génération automatique de rapport professionnel pour banque ou comité d'investissement</p>
      </div>

      <div style={styles.mainContent}>
        {snapshot && <DebugPanel snapshot={snapshot} onRefresh={loadSnapshot} />}
        
        {project && (project.parcelId || project.address) && (
          <div style={{ ...styles.card, background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", color: "white" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                  <Building2 size={22} />
                  <h2 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>{project.address || project.parcelId || "Projet en cours"}</h2>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", opacity: 0.8, fontSize: "14px" }}>
                  <MapPin size={14} />
                  {project.city || `Commune ${project.communeInsee}` || "Localisation non renseignée"}
                  {project.surfaceM2 ? ` • ${formatNumber(project.surfaceM2)} m²` : ''}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "36px", fontWeight: 800 }}>{availableModules}/6</div>
                <div style={{ fontSize: "12px", opacity: 0.7 }}>modules</div>
              </div>
            </div>
          </div>
        )}

        <div style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={styles.cardTitle}><BarChart3 size={20} color="#3b82f6" />Données disponibles</div>
            <button onClick={loadSnapshot} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", background: "#f1f5f9", border: "none", borderRadius: "8px", fontSize: "12px", color: "#64748b", cursor: "pointer" }}><RefreshCw size={14} />Actualiser</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
            {MODULE_CONFIG.map(cfg => <ModuleStatus key={cfg.key} config={cfg} module={snapshot?.modules?.[cfg.key as keyof typeof snapshot.modules]} />)}
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}><Target size={20} color="#7c3aed" />Type de rapport</div>
          <FormatSelector selected={format} onChange={setFormat} />
        </div>

        {error && (
          <div style={{ padding: "16px 20px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "12px", marginBottom: "24px", display: "flex", alignItems: "center", gap: "12px" }}>
            <AlertTriangle size={20} color="#dc2626" />
            <span style={{ color: "#991b1b", fontSize: "14px" }}>{error}</span>
          </div>
        )}

        {!result && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "32px" }}>
            <button onClick={handleGenerate} disabled={isGenerating || availableModules < 1} style={{ ...styles.button, background: isGenerating ? "#94a3b8" : "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)", color: "white", opacity: availableModules < 1 ? 0.5 : 1, cursor: availableModules < 1 ? "not-allowed" : "pointer", minWidth: "280px", boxShadow: "0 4px 12px rgba(59, 130, 246, 0.3)" }}>
              {isGenerating ? <><Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />Génération en cours...</> : <><Sparkles size={20} />Générer la synthèse</>}
            </button>
          </div>
        )}

        {isGenerating && (
          <div style={{ ...styles.card, display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 40px" }}>
            <Loader2 size={48} color="#3b82f6" style={{ animation: "spin 1s linear infinite", marginBottom: "20px" }} />
            <h3 style={{ fontSize: "18px", color: "#1e293b", marginBottom: "8px" }}>Génération en cours...</h3>
            <p style={{ fontSize: "14px", color: "#64748b" }}>Claude analyse les données et rédige le rapport</p>
          </div>
        )}

        {result && <SynthesisResult result={result} onRegenerate={() => setResult(null)} />}

        {!result && !isGenerating && availableModules < 1 && (
          <div style={{ ...styles.card, display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 40px", textAlign: "center" }}>
            <AlertOctagon size={48} color="#f59e0b" style={{ marginBottom: "20px" }} />
            <h3 style={{ fontSize: "18px", color: "#1e293b", marginBottom: "8px" }}>Données insuffisantes</h3>
            <p style={{ fontSize: "14px", color: "#64748b", maxWidth: "400px" }}>Complétez au moins un module d'analyse (Foncier, Marché, Risques, Bilan...) pour générer la synthèse.</p>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } button:hover:not(:disabled) { transform: translateY(-1px); }`}</style>
    </div>
  );
}

export default SynthesePage;