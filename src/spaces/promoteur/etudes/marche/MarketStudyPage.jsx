import React, { useState, useEffect, useMemo } from 'react';
import { 
  MapPin, Building2, TrendingUp, TrendingDown, Users, ShoppingCart, 
  Stethoscope, GraduationCap, Shield, Fuel, Train, Home, Euro, 
  AlertTriangle, CheckCircle, Info, Download, RefreshCw, ChevronDown,
  ChevronRight, X, Loader2, Building, Car, Banknote, Mail, Clock,
  Heart, Pill, Hospital, UserCheck, Activity, PieChart, BarChart3,
  Target, Zap, Eye, EyeOff, FileJson, FileSpreadsheet, Map, Layers,
  Phone, Compass
} from 'lucide-react';

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================
const ANALYSIS_STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  PARTIAL: 'partial',
  ERROR: 'error'
};

const ZONE_LABELS = {
  urbain: 'Zone Urbaine',
  rural: 'Zone Rurale'
};

const COVERAGE_LABELS = {
  ok: 'Disponible',
  no_data: 'Aucune donnée',
  not_covered: 'Non couvert',
  error: 'Erreur'
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
const formatNumber = (n, decimals = 0) => {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { 
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals 
  }).format(n);
};

const formatPrice = (n) => {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { 
    style: 'currency', 
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(n);
};

const formatPercent = (n) => {
  if (n == null || isNaN(n)) return '—';
  return `${formatNumber(n, 1)} %`;
};

const formatDistance = (m) => {
  if (m == null || isNaN(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
};

const getScoreColor = (score) => {
  if (score == null) return 'text-slate-400';
  if (score >= 70) return 'text-emerald-500';
  if (score >= 50) return 'text-amber-500';
  if (score >= 30) return 'text-orange-500';
  return 'text-red-500';
};

const getScoreBg = (score) => {
  if (score == null) return 'bg-slate-100';
  if (score >= 70) return 'bg-emerald-50';
  if (score >= 50) return 'bg-amber-50';
  if (score >= 30) return 'bg-orange-50';
  return 'bg-red-50';
};

const getTrendIcon = (trend) => {
  if (trend === 'up') return <TrendingUp className="w-4 h-4 text-emerald-500" />;
  if (trend === 'down') return <TrendingDown className="w-4 h-4 text-red-500" />;
  return null;
};

const getDistanceColor = (km) => {
  if (km == null) return 'text-slate-400';
  if (km <= 0.5) return 'text-emerald-600';
  if (km <= 1) return 'text-emerald-500';
  if (km <= 2) return 'text-lime-500';
  if (km <= 5) return 'text-amber-500';
  return 'text-slate-500';
};

// ============================================================================
// HELPER: Mapping données EHPAD brutes vers format UI
// ============================================================================
const mapRawEhpadItem = (item) => {
  if (!item) return null;
  return {
    nom: item.name || item.nom || 'Établissement sans nom',
    commune: item.commune || item.city || '',
    distance_km: item.distance_km || 0,
    capacite: item.beds_total ?? item.capacite ?? undefined,
    finess: item.finess || item.finess_number || undefined,
    adresse: item.address || item.adresse || undefined,
    telephone: item.telephone || item.phone || undefined,
    prix_journalier: item.prix_journalier ?? undefined,
    taux_occupation: item.taux_occupation ?? undefined,
  };
};

const mapEhpadList = (rawItems) => {
  if (!rawItems || !Array.isArray(rawItems)) return [];
  return rawItems.map(mapRawEhpadItem).filter(Boolean);
};

const normalizeEhpadData = (ehpadData, inseeData) => {
  if (!ehpadData) return null;
  
  // Si c'est déjà un tableau brut, le convertir
  if (Array.isArray(ehpadData)) {
    const mappedList = mapEhpadList(ehpadData);
    const totalCapacity = mappedList.reduce((sum, f) => sum + (f.capacite || 0), 0);
    
    // Calcul densité lits / 1000 seniors (75+)
    let densiteLits;
    if (inseeData?.population && inseeData?.pct_plus_75) {
      const pop75Plus = inseeData.population * (inseeData.pct_plus_75 / 100);
      if (pop75Plus > 0 && totalCapacity > 0) {
        densiteLits = (totalCapacity / pop75Plus) * 1000;
      }
    }

    // Génération du verdict
    let verdict;
    const count = mappedList.length;
    if (count === 0) {
      verdict = "Aucun établissement concurrent identifié dans la zone.";
    } else if (count <= 2) {
      verdict = `Faible concurrence avec ${count} établissement(s).`;
    } else if (count <= 5) {
      verdict = `Concurrence modérée avec ${count} établissements.`;
    } else {
      verdict = `Marché concurrentiel avec ${count} établissements.`;
    }

    return {
      count,
      liste: mappedList,
      nearest: mappedList[0] || null,
      analyse_concurrence: {
        capacite_totale: totalCapacity > 0 ? totalCapacity : undefined,
        densite_lits_1000_seniors: densiteLits,
        verdict,
      },
      coverage: count > 0 ? 'ok' : 'no_data'
    };
  }
  
  // Si c'est déjà un objet structuré, mapper la liste si présente
  const result = { ...ehpadData };
  
  if (result.liste && Array.isArray(result.liste)) {
    // Vérifier si le mapping est nécessaire
    const needsMapping = result.liste.some(item => 
      (item.name && !item.nom) || (item.address && !item.adresse) || (item.beds_total !== undefined && item.capacite === undefined)
    );
    
    if (needsMapping) {
      result.liste = mapEhpadList(result.liste);
    }
  }
  
  // Mapper aussi le nearest si nécessaire
  if (result.nearest) {
    const n = result.nearest;
    if ((n.name && !n.nom) || (n.address && !n.adresse)) {
      result.nearest = mapRawEhpadItem(n);
    }
  }
  
  return result;
};

// ============================================================================
// COMPONENTS - Loading & Status
// ============================================================================
const LoadingSpinner = ({ size = 'md', className = '' }) => {
  const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' };
  return <Loader2 className={`${sizes[size]} animate-spin text-indigo-600 ${className}`} />;
};

const StatusBadge = ({ status, coverage }) => {
  const configs = {
    [ANALYSIS_STATUS.SUCCESS]: { 
      bg: 'bg-emerald-100', text: 'text-emerald-700', 
      icon: CheckCircle, label: 'Analyse OK' 
    },
    [ANALYSIS_STATUS.PARTIAL]: { 
      bg: 'bg-amber-100', text: 'text-amber-700', 
      icon: AlertTriangle, label: 'Données partielles' 
    },
    [ANALYSIS_STATUS.ERROR]: { 
      bg: 'bg-red-100', text: 'text-red-700', 
      icon: X, label: 'Erreur' 
    },
    [ANALYSIS_STATUS.LOADING]: { 
      bg: 'bg-indigo-100', text: 'text-indigo-700', 
      icon: Loader2, label: 'Chargement...' 
    }
  };
  
  const config = configs[status] || configs[ANALYSIS_STATUS.ERROR];
  const Icon = config.icon;
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      <Icon className={`w-3.5 h-3.5 ${status === ANALYSIS_STATUS.LOADING ? 'animate-spin' : ''}`} />
      {config.label}
    </span>
  );
};

const DataCoverageBadge = ({ coverage, label }) => {
  const colors = {
    ok: 'bg-emerald-100 text-emerald-700',
    no_data: 'bg-slate-100 text-slate-600',
    not_covered: 'bg-amber-100 text-amber-700',
    error: 'bg-red-100 text-red-700'
  };
  
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colors[coverage] || colors.error}`}>
      {label || COVERAGE_LABELS[coverage] || coverage}
    </span>
  );
};

// ============================================================================
// COMPONENTS - Cards & Layout
// ============================================================================
const Card = ({ children, className = '', padding = 'p-5' }) => (
  <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${padding} ${className}`}>
    {children}
  </div>
);

const CardHeader = ({ icon: Icon, title, subtitle, action, coverage }) => (
  <div className="flex items-start justify-between mb-4">
    <div className="flex items-start gap-3">
      {Icon && (
        <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
          <Icon className="w-5 h-5" />
        </div>
      )}
      <div>
        <h3 className="font-semibold text-slate-800">{title}</h3>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    <div className="flex items-center gap-2">
      {coverage && <DataCoverageBadge coverage={coverage} />}
      {action}
    </div>
  </div>
);

const KPICard = ({ label, value, unit, description, trend, icon: Icon, highlight = false }) => (
  <div className={`relative p-4 rounded-xl border transition-all ${
    highlight 
      ? 'bg-gradient-to-br from-indigo-50 to-violet-50 border-indigo-200' 
      : 'bg-white border-slate-200 hover:border-slate-300'
  }`}>
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className={`text-2xl font-bold ${value != null ? 'text-slate-800' : 'text-slate-400'}`}>
            {value != null ? formatNumber(value) : '—'}
          </span>
          {unit && <span className="text-sm text-slate-500">{unit}</span>}
          {getTrendIcon(trend)}
        </div>
        {description && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{description}</p>}
      </div>
      {Icon && (
        <div className={`p-2 rounded-lg ${highlight ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
          <Icon className="w-4 h-4" />
        </div>
      )}
    </div>
  </div>
);

const ScoreGauge = ({ score, label, size = 'lg' }) => {
  const circumference = 2 * Math.PI * 45;
  const progress = score != null ? ((score / 100) * circumference) : 0;
  const sizes = { sm: 'w-20 h-20', md: 'w-28 h-28', lg: 'w-36 h-36' };
  
  return (
    <div className="flex flex-col items-center">
      <div className={`relative ${sizes[size]}`}>
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50" cy="50" r="45"
            fill="none" stroke="#e2e8f0" strokeWidth="8"
          />
          <circle
            cx="50" cy="50" r="45"
            fill="none"
            stroke={score >= 70 ? '#10b981' : score >= 50 ? '#f59e0b' : score >= 30 ? '#f97316' : '#ef4444'}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-3xl font-bold ${getScoreColor(score)}`}>
            {score != null ? score : '—'}
          </span>
          <span className="text-xs text-slate-500">/100</span>
        </div>
      </div>
      {label && <p className="text-sm font-medium text-slate-600 mt-2">{label}</p>}
    </div>
  );
};

const Collapsible = ({ title, icon: Icon, defaultOpen = false, children, badge }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          {Icon && <Icon className="w-5 h-5 text-slate-600" />}
          <span className="font-medium text-slate-700">{title}</span>
          {badge}
        </div>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && <div className="p-4 bg-white">{children}</div>}
    </div>
  );
};

const EmptyState = ({ icon: Icon, title, description }) => (
  <div className="flex flex-col items-center justify-center py-8 text-center">
    <div className="p-3 rounded-full bg-slate-100 text-slate-400 mb-3">
      <Icon className="w-6 h-6" />
    </div>
    <p className="font-medium text-slate-600">{title}</p>
    {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
  </div>
);

// ============================================================================
// COMPONENTS - Data Display
// ============================================================================
const InsightCard = ({ insight }) => {
  const configs = {
    positive: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: CheckCircle, iconColor: 'text-emerald-500' },
    negative: { bg: 'bg-red-50', border: 'border-red-200', icon: AlertTriangle, iconColor: 'text-red-500' },
    warning: { bg: 'bg-amber-50', border: 'border-amber-200', icon: AlertTriangle, iconColor: 'text-amber-500' },
    neutral: { bg: 'bg-slate-50', border: 'border-slate-200', icon: Info, iconColor: 'text-slate-500' }
  };
  
  const config = configs[insight.type] || configs.neutral;
  const Icon = config.icon;
  
  return (
    <div className={`p-3 rounded-lg border ${config.bg} ${config.border}`}>
      <div className="flex items-start gap-2">
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${config.iconColor}`} />
        <div>
          <p className="font-medium text-slate-800 text-sm">{insight.title}</p>
          <p className="text-xs text-slate-600 mt-0.5">{insight.description}</p>
          {insight.source && (
            <span className="inline-block mt-1 text-xs text-slate-400">Source: {insight.source}</span>
          )}
        </div>
      </div>
    </div>
  );
};

const ServiceRow = ({ icon: Icon, label, data, emptyText = 'Non disponible' }) => {
  if (!data) {
    return (
      <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-slate-400" />
          <span className="text-sm text-slate-600">{label}</span>
        </div>
        <span className="text-sm text-slate-400">{emptyText}</span>
      </div>
    );
  }
  
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-indigo-500" />
        <div>
          <span className="text-sm font-medium text-slate-700">{label}</span>
          {data.nom && <p className="text-xs text-slate-500">{data.nom}</p>}
        </div>
      </div>
      <div className="text-right">
        <span className={`text-sm font-semibold ${
          data.distance_km <= 2 ? 'text-emerald-600' : 
          data.distance_km <= 5 ? 'text-amber-600' : 'text-red-600'
        }`}>
          {data.distance_km != null ? `${data.distance_km} km` : formatDistance(data.distance_m)}
        </span>
        {data.commune && <p className="text-xs text-slate-400">{data.commune}</p>}
      </div>
    </div>
  );
};

const ComparableRow = ({ comp, index }) => (
  <div className={`flex items-center gap-4 py-3 ${index > 0 ? 'border-t border-slate-100' : ''}`}>
    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-medium">
      {index + 1}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-slate-800 truncate">
        {comp.type_local || 'Bien'} • {comp.surface_m2 ? `${comp.surface_m2} m²` : '—'}
      </p>
      <p className="text-xs text-slate-500 truncate">
        {comp.address || comp.commune || '—'} {comp.date ? `• ${comp.date}` : ''}
      </p>
    </div>
    <div className="text-right flex-shrink-0">
      <p className="text-sm font-bold text-slate-800">{formatPrice(comp.price_m2)}/m²</p>
      {comp.distance_m && <p className="text-xs text-slate-400">{formatDistance(comp.distance_m)}</p>}
    </div>
  </div>
);

// Composant pour afficher un établissement EHPAD dans la liste
const EhpadListItem = ({ facility, index }) => {
  const distanceColorClass = getDistanceColor(facility.distance_km);
  
  return (
    <div className={`flex items-start justify-between p-3 ${index % 2 === 0 ? 'bg-slate-50' : 'bg-white'} rounded-lg`}>
      {/* Colonne gauche: Nom, Adresse, Distance, Téléphone, FINESS */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">
          {facility.nom}
        </p>
        
        {/* Adresse */}
        <div className="flex items-start gap-1 mt-1">
          <MapPin className="w-3 h-3 text-slate-400 mt-0.5 flex-shrink-0" />
          <span className={`text-xs ${facility.adresse ? 'text-slate-600' : 'text-slate-400'} line-clamp-2`}>
            {facility.adresse || 'Adresse non disponible'}
          </span>
        </div>
        
        {/* Ligne infos */}
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <span className={`text-xs font-semibold ${distanceColorClass} flex items-center gap-1`}>
            <Compass className="w-3 h-3" />
            {facility.distance_km?.toFixed(1)} km
          </span>
          
          {facility.telephone && (
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <Phone className="w-3 h-3" />
              {facility.telephone}
            </span>
          )}
          
          {facility.finess && (
            <span className="text-xs text-slate-400 font-mono bg-slate-100 px-1.5 py-0.5 rounded">
              FINESS: {facility.finess}
            </span>
          )}
        </div>
      </div>
      
      {/* Colonne droite: Métriques */}
      <div className="flex gap-3 ml-3 flex-shrink-0">
        {/* Capacité */}
        <div className="text-center min-w-[50px]">
          <p className={`text-base font-bold ${facility.capacite && facility.capacite > 0 ? 'text-violet-600' : 'text-slate-300'}`}>
            {facility.capacite && facility.capacite > 0 ? facility.capacite : '—'}
          </p>
          <p className="text-xs text-slate-400">lits</p>
        </div>
        
        {/* Prix journalier */}
        <div className="text-center min-w-[50px]">
          <p className={`text-sm font-semibold ${facility.prix_journalier ? 'text-emerald-600' : 'text-slate-300'}`}>
            {facility.prix_journalier ? `${formatNumber(facility.prix_journalier)}€` : '—'}
          </p>
          <p className="text-xs text-slate-400">€/jour</p>
        </div>
        
        {/* Taux d'occupation */}
        <div className="text-center min-w-[50px]">
          <p className={`text-sm font-semibold ${
            facility.taux_occupation 
              ? (facility.taux_occupation >= 95 ? 'text-red-500' : facility.taux_occupation >= 85 ? 'text-amber-500' : 'text-emerald-500')
              : 'text-slate-300'
          }`}>
            {facility.taux_occupation ? `${formatNumber(facility.taux_occupation, 0)}%` : '—'}
          </p>
          <p className="text-xs text-slate-400">Occup.</p>
        </div>
      </div>
    </div>
  );
};

const PyramideAges = ({ data }) => {
  if (!data) return null;
  
  const tranches = [
    { label: '0-14 ans', key: 'pct_moins_15', color: 'bg-sky-400' },
    { label: '15-29 ans', key: 'pct_15_29', color: 'bg-indigo-400' },
    { label: '30-44 ans', key: 'pct_30_44', color: 'bg-violet-400' },
    { label: '45-59 ans', key: 'pct_45_59', color: 'bg-fuchsia-400' },
    { label: '60+ ans', key: 'pct_plus_65', color: 'bg-rose-400' }
  ];
  
  // Estimation des tranches si non disponibles
  const values = tranches.map(t => ({
    ...t,
    value: data[t.key] ?? (t.key === 'pct_plus_65' ? data.pct_plus_65 : null)
  })).filter(t => t.value != null);
  
  if (values.length === 0) return null;
  
  const maxValue = Math.max(...values.map(v => v.value));
  
  return (
    <div className="space-y-2">
      {values.map((tranche) => (
        <div key={tranche.key} className="flex items-center gap-3">
          <span className="text-xs text-slate-600 w-20">{tranche.label}</span>
          <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
            <div 
              className={`h-full ${tranche.color} rounded-full transition-all duration-500`}
              style={{ width: `${(tranche.value / maxValue) * 100}%` }}
            />
          </div>
          <span className="text-xs font-medium text-slate-700 w-12 text-right">
            {formatPercent(tranche.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

// ============================================================================
// COMPONENTS - Sections
// ============================================================================
const HeaderSection = ({ data, status, onRefresh, onExportJSON, onExportCSV }) => {
  const location = data?.input?.resolved_point;
  const zoneType = data?.zone_type;
  
  return (
    <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 mb-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-white/10">
              <Building2 className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold">Étude de Marché</h1>
          </div>
          <p className="text-indigo-200 text-sm">
            Commerces, services, données INSEE et comparables DVF
          </p>
          {location && (
            <div className="flex items-center gap-4 mt-3 text-sm">
              <span className="flex items-center gap-1.5 text-white/80">
                <MapPin className="w-4 h-4" />
                {location.lat?.toFixed(5)}, {location.lon?.toFixed(5)}
              </span>
              {zoneType && (
                <span className="px-2 py-0.5 rounded-full bg-white/10 text-white/90 text-xs font-medium">
                  {ZONE_LABELS[zoneType] || zoneType}
                </span>
              )}
            </div>
          )}
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={status} />
          
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              disabled={status === ANALYSIS_STATUS.LOADING}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${status === ANALYSIS_STATUS.LOADING ? 'animate-spin' : ''}`} />
              Relancer
            </button>
            
            <button
              onClick={onExportJSON}
              disabled={status !== ANALYSIS_STATUS.SUCCESS}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              <FileJson className="w-4 h-4" />
              JSON
            </button>
            
            <button
              onClick={onExportCSV}
              disabled={status !== ANALYSIS_STATUS.SUCCESS}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              <FileSpreadsheet className="w-4 h-4" />
              CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ParametersPanel = ({ params, onChange, onSubmit, isLoading }) => {
  const [isOpen, setIsOpen] = useState(true);
  
  return (
    <Card className="mb-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
            <Target className="w-5 h-5" />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-slate-800">Paramètres de l'analyse</h3>
            <p className="text-sm text-slate-500">Localisation et contexte</p>
          </div>
        </div>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && (
        <div className="mt-5 pt-5 border-t border-slate-100">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Latitude
              </label>
              <input
                type="number"
                step="0.00001"
                value={params.lat || ''}
                onChange={(e) => onChange({ ...params, lat: parseFloat(e.target.value) || null })}
                placeholder="48.8566"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Longitude
              </label>
              <input
                type="number"
                step="0.00001"
                value={params.lon || ''}
                onChange={(e) => onChange({ ...params, lon: parseFloat(e.target.value) || null })}
                placeholder="2.3522"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Code INSEE
              </label>
              <input
                type="text"
                value={params.commune_insee || ''}
                onChange={(e) => onChange({ ...params, commune_insee: e.target.value })}
                placeholder="75056"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                ID Parcelle
              </label>
              <input
                type="text"
                value={params.parcel_id || ''}
                onChange={(e) => onChange({ ...params, parcel_id: e.target.value })}
                placeholder="750560000A0001"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Contexte
              </label>
              <select
                value={params.context || 'auto'}
                onChange={(e) => onChange({ ...params, context: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="auto">Automatique</option>
                <option value="urbain">Urbain</option>
                <option value="rural">Rural</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Rayon d'analyse
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0.5"
                  max="20"
                  step="0.5"
                  value={params.radius_km || 2}
                  onChange={(e) => onChange({ ...params, radius_km: parseFloat(e.target.value) })}
                  className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-sm font-medium text-slate-700 w-16 text-right">
                  {params.radius_km || 2} km
                </span>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Nature du projet
              </label>
              <select
                value={params.project_nature || 'logement'}
                onChange={(e) => onChange({ ...params, project_nature: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="logement">Logement</option>
                <option value="residence_senior">Résidence senior</option>
                <option value="residence_etudiante">Résidence étudiante</option>
                <option value="ehpad">EHPAD</option>
                <option value="bureaux">Bureaux</option>
                <option value="commerce">Commerce</option>
                <option value="hotel">Hôtel</option>
              </select>
            </div>
          </div>
          
          <div className="flex justify-end mt-5 pt-4 border-t border-slate-100">
            <button
              onClick={onSubmit}
              disabled={isLoading || (!params.lat && !params.parcel_id && !params.commune_insee)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? <LoadingSpinner size="sm" className="text-white" /> : <Zap className="w-4 h-4" />}
              Lancer l'analyse
            </button>
          </div>
        </div>
      )}
    </Card>
  );
};

const KPISynthesis = ({ data }) => {
  const market = data?.market;
  const kpis = market?.kpis || [];
  
  // KPIs principaux
  const mainKpis = [
    { 
      label: 'Population', 
      value: market?.insee?.population, 
      icon: Users,
      description: 'Population communale'
    },
    { 
      label: 'Commerces & Services', 
      value: market?.bpe?.total_equipements, 
      icon: ShoppingCart,
      description: market?.bpeCoverage === 'ok' ? 'Dans le rayon d\'analyse' : 'Non disponible'
    },
    { 
      label: 'Prix médian', 
      value: market?.prices?.median_eur_m2, 
      unit: '€/m²',
      icon: Euro,
      description: market?.dvf?.coverage === 'ok' ? 'Prix DVF' : 'DVF non disponible'
    },
    { 
      label: 'Transactions', 
      value: market?.transactions?.count, 
      icon: TrendingUp,
      description: `Sur ${data?.input?.horizon_months || 24} mois`
    }
  ];
  
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-slate-800">Synthèse</h2>
        {market?.score != null && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">Score global:</span>
            <span className={`text-xl font-bold ${getScoreColor(market.score)}`}>
              {market.score}/100
            </span>
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {mainKpis.map((kpi, idx) => (
          <KPICard
            key={idx}
            label={kpi.label}
            value={kpi.value}
            unit={kpi.unit}
            description={kpi.description}
            icon={kpi.icon}
            highlight={idx === 0}
          />
        ))}
      </div>
      
      {market?.verdict && (
        <div className={`mt-4 p-4 rounded-xl ${getScoreBg(market.score)} border border-slate-200`}>
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${market.score >= 50 ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
              {market.score >= 50 ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
            <div>
              <p className="font-medium text-slate-800">Verdict</p>
              <p className="text-sm text-slate-600 mt-0.5">{market.verdict}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MapEnvironment = ({ data }) => {
  const point = data?.input?.resolved_point;
  const radiusKm = data?.input?.radius_km || 2;
  
  // Placeholder pour la carte - à intégrer avec Mapbox/Leaflet
  return (
    <Card className="mb-6">
      <CardHeader 
        icon={Map} 
        title="Carte & Environnement" 
        subtitle={`Rayon d'analyse: ${radiusKm} km`}
      />
      
      <div className="relative h-64 bg-gradient-to-br from-slate-100 to-slate-200 rounded-lg overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <Layers className="w-12 h-12 text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-500">Carte interactive</p>
            {point && (
              <p className="text-xs text-slate-400 mt-1">
                Centre: {point.lat?.toFixed(5)}, {point.lon?.toFixed(5)}
              </p>
            )}
          </div>
        </div>
        
        {/* Légende */}
        <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur rounded-lg p-2 shadow-sm">
          <p className="text-xs font-medium text-slate-700 mb-1.5">Légende</p>
          <div className="space-y-1">
            {[
              { color: 'bg-indigo-500', label: 'Point analysé' },
              { color: 'bg-emerald-500', label: 'Commerces' },
              { color: 'bg-rose-500', label: 'Santé' },
              { color: 'bg-amber-500', label: 'Éducation' }
            ].map((item, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${item.color}`} />
                <span className="text-xs text-slate-600">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
};

const ServicesEquipements = ({ data }) => {
  const market = data?.market;
  const essentialServices = market?.essential_services;
  const servicesRuraux = market?.services_ruraux;
  const bpe = market?.bpe;
  const isRural = data?.zone_type === 'rural';
  
  const services = servicesRuraux || {};
  
  return (
    <Card className="mb-6">
      <CardHeader 
        icon={ShoppingCart} 
        title="Services & Équipements" 
        subtitle="Points d'intérêt à proximité"
        coverage={market?.bpeCoverage}
      />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Commerces */}
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-emerald-500" />
            Commerces
          </h4>
          <div className="bg-slate-50 rounded-lg p-3">
            <ServiceRow 
              icon={ShoppingCart} 
              label="Commerce alimentaire" 
              data={services.supermarche_proche || services.hypermarche_proche || services.superette_proche}
            />
            <ServiceRow icon={Fuel} label="Station service" data={services.station_service_proche} />
            <ServiceRow icon={Banknote} label="Banque / DAB" data={services.banque_proche} />
            <ServiceRow icon={Mail} label="Bureau de poste" data={services.poste_proche} />
          </div>
        </div>
        
        {/* Santé */}
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-rose-500" />
            Santé
          </h4>
          <div className="bg-slate-50 rounded-lg p-3">
            <ServiceRow icon={UserCheck} label="Médecin généraliste" data={services.medecin_proche} />
            <ServiceRow 
              icon={Pill} 
              label="Pharmacie" 
              data={services.pharmacie_proche}
            />
            {essentialServices?.medecin_specialiste?.nearest && (
              <ServiceRow 
                icon={Stethoscope} 
                label="Spécialiste" 
                data={essentialServices.medecin_specialiste.nearest}
              />
            )}
            {essentialServices?.dentiste?.nearest && (
              <ServiceRow 
                icon={Heart} 
                label="Dentiste" 
                data={essentialServices.dentiste.nearest}
              />
            )}
          </div>
        </div>
        
        {/* Sécurité */}
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-500" />
            Sécurité
          </h4>
          <div className="bg-slate-50 rounded-lg p-3">
            <ServiceRow icon={Shield} label="Gendarmerie" data={services.gendarmerie_proche} />
            <ServiceRow icon={Shield} label="Commissariat" data={services.commissariat_proche} />
          </div>
        </div>
        
        {/* Mobilité */}
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Train className="w-4 h-4 text-indigo-500" />
            Mobilité & Éducation
          </h4>
          <div className="bg-slate-50 rounded-lg p-3">
            {market?.transport?.applicable ? (
              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2">
                  <Train className="w-4 h-4 text-indigo-500" />
                  <span className="text-sm font-medium text-slate-700">Transports en commun</span>
                </div>
                <span className={`text-sm font-semibold ${getScoreColor(market.transport?.score)}`}>
                  {market.transport?.score != null ? `${market.transport.score}/100` : '—'}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2">
                  <Car className="w-4 h-4 text-slate-400" />
                  <span className="text-sm text-slate-600">Zone hors métropole</span>
                </div>
                <span className="text-xs text-slate-400">Non évalué</span>
              </div>
            )}
            
            {market?.ecoles && (
              <div className="flex items-center justify-between py-2.5 border-t border-slate-200">
                <div className="flex items-center gap-2">
                  <GraduationCap className="w-4 h-4 text-amber-500" />
                  <div>
                    <span className="text-sm font-medium text-slate-700">Écoles</span>
                    <p className="text-xs text-slate-500">
                      {market.ecoles.count1000m || 0} établissements à 1km
                    </p>
                  </div>
                </div>
                <span className={`text-sm font-semibold ${getScoreColor(market.ecoles.scoreEcoles)}`}>
                  {market.ecoles.scoreEcoles != null ? `${market.ecoles.scoreEcoles}/100` : '—'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Résumé BPE */}
      {bpe && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Commerces', value: bpe.nb_commerces, color: 'text-emerald-600' },
              { label: 'Santé', value: bpe.nb_sante, color: 'text-rose-600' },
              { label: 'Services', value: bpe.nb_services, color: 'text-blue-600' },
              { label: 'Enseignement', value: bpe.nb_enseignement, color: 'text-amber-600' },
              { label: 'Sport/Culture', value: bpe.nb_sport_culture, color: 'text-violet-600' }
            ].map((item, idx) => (
              <div key={idx} className="text-center p-2 bg-slate-50 rounded-lg">
                <p className={`text-lg font-bold ${item.color}`}>{item.value ?? 0}</p>
                <p className="text-xs text-slate-500">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

const INSEESocioDemographie = ({ data }) => {
  const insee = data?.market?.insee;
  
  if (!insee) {
    return (
      <Card className="mb-6">
        <CardHeader icon={Users} title="Données INSEE" subtitle="Socio-démographie" coverage="no_data" />
        <EmptyState icon={Users} title="Données INSEE non disponibles" />
      </Card>
    );
  }
  
  return (
    <Card className="mb-6">
      <CardHeader 
        icon={Users} 
        title="Données INSEE / Socio-démographie" 
        subtitle={insee.commune || `Code: ${insee.code_commune}`}
        coverage="ok"
      />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Population & Âge */}
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Population & Âge</h4>
          
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-3 bg-indigo-50 rounded-lg">
              <p className="text-xs text-indigo-600 font-medium">Population</p>
              <p className="text-xl font-bold text-indigo-700">
                {insee.population ? formatNumber(insee.population) : '—'}
              </p>
            </div>
            <div className="p-3 bg-rose-50 rounded-lg">
              <p className="text-xs text-rose-600 font-medium">65 ans et +</p>
              <p className="text-xl font-bold text-rose-700">
                {insee.pct_plus_65 != null ? formatPercent(insee.pct_plus_65) : '—'}
              </p>
            </div>
          </div>
          
          <PyramideAges data={insee} />
        </div>
        
        {/* Situation sociale */}
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Situation sociale</h4>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2">
                <Euro className="w-4 h-4 text-emerald-500" />
                <span className="text-sm text-slate-600">Revenu médian</span>
              </div>
              <span className="font-semibold text-slate-800">
                {insee.revenu_median ? formatPrice(insee.revenu_median) + '/an' : '—'}
              </span>
            </div>
            
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-amber-500" />
                <span className="text-sm text-slate-600">Taux de chômage</span>
              </div>
              <span className={`font-semibold ${
                insee.taux_chomage != null && insee.taux_chomage > 10 ? 'text-red-600' : 'text-slate-800'
              }`}>
                {insee.taux_chomage != null ? formatPercent(insee.taux_chomage) : '—'}
              </span>
            </div>
            
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <span className="text-sm text-slate-600">Taux de pauvreté</span>
              </div>
              <span className={`font-semibold ${
                insee.taux_pauvrete != null && insee.taux_pauvrete > 15 ? 'text-red-600' : 'text-slate-800'
              }`}>
                {insee.taux_pauvrete != null ? formatPercent(insee.taux_pauvrete) : '—'}
              </span>
            </div>
            
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2">
                <Home className="w-4 h-4 text-indigo-500" />
                <span className="text-sm text-slate-600">Propriétaires</span>
              </div>
              <span className="font-semibold text-slate-800">
                {insee.pct_proprietaires != null ? formatPercent(insee.pct_proprietaires) : '—'}
              </span>
            </div>
            
            {insee.pension_retraite_moyenne && (
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-violet-500" />
                  <span className="text-sm text-slate-600">Retraite moyenne</span>
                </div>
                <span className="font-semibold text-slate-800">
                  {formatPrice(insee.pension_retraite_moyenne)}/mois
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {!insee.source_comparateur && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <DataCoverageBadge coverage="partial" label="Données INSEE partielles" />
        </div>
      )}
    </Card>
  );
};

const MarcheImmobilier = ({ data }) => {
  const market = data?.market;
  const dvf = market?.dvf;
  const prices = market?.prices;
  const comps = market?.comps || [];
  
  if (dvf?.coverage !== 'ok' || !prices) {
    return (
      <Card className="mb-6">
        <CardHeader 
          icon={Euro} 
          title="Marché Immobilier & Comparables" 
          subtitle="Données DVF"
          coverage={dvf?.coverage || 'not_covered'}
        />
        <EmptyState 
          icon={Euro} 
          title="Données DVF non disponibles" 
          description={dvf?.reason || 'Élargissez le rayon d\'analyse'}
        />
      </Card>
    );
  }
  
  return (
    <Card className="mb-6">
      <CardHeader 
        icon={Euro} 
        title="Marché Immobilier & Comparables" 
        subtitle={`Source: DVF (${dvf.source})`}
        coverage={dvf.coverage}
      />
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Prix */}
        <div className="lg:col-span-1">
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Prix au m²</h4>
          
          <div className="bg-gradient-to-br from-indigo-50 to-violet-50 rounded-xl p-4 mb-4">
            <p className="text-xs text-indigo-600 font-medium uppercase">Prix médian</p>
            <p className="text-3xl font-bold text-indigo-700 mt-1">
              {prices.median_eur_m2 ? formatPrice(prices.median_eur_m2) : '—'}
              <span className="text-sm font-normal text-indigo-500">/m²</span>
            </p>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between p-2 bg-slate-50 rounded">
              <span className="text-sm text-slate-600">Q1 (25%)</span>
              <span className="text-sm font-medium text-slate-800">
                {prices.q1_eur_m2 ? formatPrice(prices.q1_eur_m2) : '—'}/m²
              </span>
            </div>
            <div className="flex justify-between p-2 bg-slate-50 rounded">
              <span className="text-sm text-slate-600">Moyenne</span>
              <span className="text-sm font-medium text-slate-800">
                {prices.mean_eur_m2 ? formatPrice(prices.mean_eur_m2) : '—'}/m²
              </span>
            </div>
            <div className="flex justify-between p-2 bg-slate-50 rounded">
              <span className="text-sm text-slate-600">Q3 (75%)</span>
              <span className="text-sm font-medium text-slate-800">
                {prices.q3_eur_m2 ? formatPrice(prices.q3_eur_m2) : '—'}/m²
              </span>
            </div>
          </div>
          
          <div className="mt-4 p-3 bg-emerald-50 rounded-lg">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <span className="text-sm font-medium text-emerald-700">
                {market.transactions?.count || 0} transactions
              </span>
            </div>
            <p className="text-xs text-emerald-600 mt-1">
              Sur {data?.input?.horizon_months || 24} mois
            </p>
          </div>
        </div>
        
        {/* Comparables */}
        <div className="lg:col-span-2">
          <h4 className="text-sm font-semibold text-slate-700 mb-3">
            Ventes comparables ({comps.length})
          </h4>
          
          {comps.length > 0 ? (
            <div className="max-h-80 overflow-y-auto pr-2 -mr-2">
              {comps.slice(0, 10).map((comp, idx) => (
                <ComparableRow key={comp.id || idx} comp={comp} index={idx} />
              ))}
            </div>
          ) : (
            <EmptyState 
              icon={Building} 
              title="Aucun comparable" 
              description="Élargissez le rayon pour plus de résultats"
            />
          )}
        </div>
      </div>
    </Card>
  );
};

const LectureMarcheAlertes = ({ data }) => {
  const insights = data?.market?.insights || [];
  
  const positive = insights.filter(i => i.type === 'positive');
  const negative = insights.filter(i => i.type === 'negative' || i.type === 'warning');
  const neutral = insights.filter(i => i.type === 'neutral');
  
  return (
    <Card className="mb-6">
      <CardHeader 
        icon={Eye} 
        title="Lecture Marché & Alertes" 
        subtitle="Interprétation automatique"
      />
      
      {insights.length === 0 ? (
        <EmptyState icon={Info} title="Aucune analyse disponible" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Points forts */}
          <div>
            <h4 className="text-sm font-semibold text-emerald-700 mb-3 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              Points forts ({positive.length})
            </h4>
            <div className="space-y-2">
              {positive.length > 0 ? (
                positive.map((insight, idx) => (
                  <InsightCard key={idx} insight={insight} />
                ))
              ) : (
                <p className="text-sm text-slate-500 italic">Aucun point fort identifié</p>
              )}
            </div>
          </div>
          
          {/* Points de vigilance */}
          <div>
            <h4 className="text-sm font-semibold text-amber-700 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Points de vigilance ({negative.length})
            </h4>
            <div className="space-y-2">
              {negative.length > 0 ? (
                negative.map((insight, idx) => (
                  <InsightCard key={idx} insight={insight} />
                ))
              ) : (
                <p className="text-sm text-slate-500 italic">Aucune alerte</p>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Autres insights */}
      {neutral.length > 0 && (
        <Collapsible 
          title={`Autres informations (${neutral.length})`} 
          icon={Info}
          className="mt-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {neutral.map((insight, idx) => (
              <InsightCard key={idx} insight={insight} />
            ))}
          </div>
        </Collapsible>
      )}
    </Card>
  );
};

const SanteSeniors = ({ data }) => {
  const [showAllEhpad, setShowAllEhpad] = useState(false);
  
  const healthSummary = data?.market?.healthSummary;
  const ehpad = data?.market?.ehpad;
  const residencesSeniors = data?.market?.residences_seniors || [];
  
  // Liste des établissements EHPAD (avec mapping appliqué)
  const ehpadList = ehpad?.liste || [];
  const ehpadCount = ehpad?.count || ehpadList.length;
  const analyseConc = ehpad?.analyse_concurrence;
  
  return (
    <Card className="mb-6">
      <CardHeader 
        icon={Hospital} 
        title="Santé & Seniors" 
        subtitle="Offre médicale et établissements"
        coverage={healthSummary?.coverage || ehpad?.coverage}
      />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Résumé santé */}
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Offre de soins</h4>
          
          {healthSummary?.data ? (
            <>
              <p className="text-sm text-slate-600 mb-3">{healthSummary.data.resume}</p>
              
              {healthSummary.data.professionnels_details && (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Généralistes', value: healthSummary.data.professionnels_details.medecins_generalistes },
                    { label: 'Spécialistes', value: healthSummary.data.professionnels_details.medecins_specialistes },
                    { label: 'Infirmiers', value: healthSummary.data.professionnels_details.infirmiers },
                    { label: 'Pharmacies', value: healthSummary.data.professionnels_details.pharmacies },
                    { label: 'Dentistes', value: healthSummary.data.professionnels_details.dentistes },
                    { label: 'Kinés', value: healthSummary.data.professionnels_details.kinesitherapeutes }
                  ].map((item, idx) => (
                    <div key={idx} className="flex justify-between p-2 bg-slate-50 rounded">
                      <span className="text-xs text-slate-600">{item.label}</span>
                      <span className="text-xs font-semibold text-slate-800">{item.value ?? 0}</span>
                    </div>
                  ))}
                </div>
              )}
              
              {healthSummary.data.hopital_proche && (
                <div className="mt-3 p-3 bg-rose-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Hospital className="w-4 h-4 text-rose-500" />
                    <span className="text-sm font-medium text-rose-700">Hôpital le plus proche</span>
                  </div>
                  <p className="text-sm text-rose-600 mt-1">
                    {healthSummary.data.hopital_proche.nom} ({healthSummary.data.hopital_proche.commune})
                    <span className="font-semibold ml-1">
                      — {healthSummary.data.hopital_proche.distance_km} km
                    </span>
                  </p>
                </div>
              )}
            </>
          ) : (
            <EmptyState icon={Stethoscope} title="Données santé non disponibles" />
          )}
        </div>
        
        {/* Établissements seniors */}
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-3">
            Établissements seniors
            {ehpadCount > 0 && (
              <span className="ml-2 text-xs font-normal text-slate-500">
                ({ehpadCount} EHPAD)
              </span>
            )}
          </h4>
          
          {/* Métriques EHPAD */}
          {ehpadCount > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="text-center p-2 bg-violet-50 rounded-lg">
                <p className="text-lg font-bold text-violet-600">{ehpadCount}</p>
                <p className="text-xs text-slate-500">EHPAD</p>
              </div>
              <div className="text-center p-2 bg-slate-50 rounded-lg">
                <p className="text-lg font-bold text-slate-700">
                  {analyseConc?.capacite_totale ? formatNumber(analyseConc.capacite_totale) : '—'}
                </p>
                <p className="text-xs text-slate-500">lits totaux</p>
              </div>
              <div className="text-center p-2 bg-amber-50 rounded-lg">
                <p className="text-lg font-bold text-amber-600">
                  {analyseConc?.densite_lits_1000_seniors ? formatNumber(analyseConc.densite_lits_1000_seniors, 1) : '—'}
                </p>
                <p className="text-xs text-slate-500">lits/1000 seniors</p>
              </div>
            </div>
          )}
          
          {/* Verdict analyse concurrence */}
          {analyseConc?.verdict && (
            <div className="p-3 bg-slate-50 rounded-lg mb-3 border-l-4 border-violet-400">
              <p className="text-xs font-medium text-slate-700 mb-1">📊 Analyse du marché</p>
              <p className="text-xs text-slate-600">{analyseConc.verdict}</p>
            </div>
          )}
          
          {/* EHPAD le plus proche */}
          {ehpad?.nearest ? (
            <div className="p-3 bg-violet-50 rounded-lg mb-3">
              <div className="flex items-center gap-2">
                <Building className="w-4 h-4 text-violet-500" />
                <span className="text-sm font-medium text-violet-700">EHPAD le plus proche</span>
              </div>
              <p className="text-sm text-violet-600 mt-1">
                {ehpad.nearest.nom || 'EHPAD'} 
                {ehpad.nearest.commune && ` (${ehpad.nearest.commune})`}
                <span className="font-semibold ml-1">
                  — {ehpad.nearest.distance_km?.toFixed(1) || '?'} km
                </span>
              </p>
              {ehpad.nearest.adresse && (
                <p className="text-xs text-violet-500 mt-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {ehpad.nearest.adresse}
                </p>
              )}
              {ehpad.nearest.capacite && ehpad.nearest.capacite > 0 && (
                <p className="text-xs text-violet-500 mt-1">
                  Capacité: {ehpad.nearest.capacite} lits
                </p>
              )}
            </div>
          ) : ehpadCount === 0 ? (
            <div className="p-3 bg-emerald-50 rounded-lg mb-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-medium text-emerald-700">Aucun EHPAD à proximité</span>
              </div>
              <p className="text-xs text-emerald-600 mt-1">Opportunité de marché potentielle</p>
            </div>
          ) : null}
          
          {/* Liste complète des EHPAD */}
          {ehpadList.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setShowAllEhpad(!showAllEhpad)}
                className="w-full flex items-center justify-between py-2 px-3 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <span className="text-xs font-medium text-slate-600">
                  Voir les {ehpadList.length} établissements
                </span>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showAllEhpad ? 'rotate-180' : ''}`} />
              </button>
              
              {showAllEhpad && (
                <div className="mt-2 max-h-80 overflow-y-auto space-y-1">
                  {ehpadList.map((facility, idx) => (
                    <EhpadListItem key={facility.finess || idx} facility={facility} index={idx} />
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* Résidences seniors */}
          {residencesSeniors.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-slate-500 mb-2">
                Résidences seniors ({residencesSeniors.length})
              </p>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {residencesSeniors.slice(0, 5).map((res, idx) => (
                  <div key={idx} className="flex justify-between p-2 bg-slate-50 rounded text-sm">
                    <div className="truncate flex-1 mr-2">
                      <span className="text-slate-700">{res.nom || res.name || 'Résidence'}</span>
                      <span className="text-slate-400 ml-1">({res.commune || res.city || '—'})</span>
                    </div>
                    <span className="text-slate-600 font-medium">{res.distance_km?.toFixed(1) || '?'} km</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
const MarketStudyPage = ({ 
  initialParams = {},
  apiEndpoint = '/functions/v1/smartscore-enriched-v3',
  supabaseUrl = '',
  supabaseKey = ''
}) => {
  const [params, setParams] = useState({
    lat: null,
    lon: null,
    commune_insee: '',
    parcel_id: '',
    radius_km: 2,
    horizon_months: 24,
    project_nature: 'logement',
    context: 'auto',
    ...initialParams
  });
  
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(ANALYSIS_STATUS.IDLE);
  const [error, setError] = useState(null);
  
  const fetchAnalysis = async () => {
    setStatus(ANALYSIS_STATUS.LOADING);
    setError(null);
    
    try {
      const payload = {
        mode: 'market_study',
        lat: params.lat,
        lon: params.lon,
        commune_insee: params.commune_insee || undefined,
        parcel_id: params.parcel_id || undefined,
        radius_km: params.radius_km,
        horizon_months: params.horizon_months,
        project_nature: params.project_nature,
        debug: true
      };
      
      // Nettoyer les valeurs null/undefined
      Object.keys(payload).forEach(key => {
        if (payload[key] === null || payload[key] === undefined || payload[key] === '') {
          delete payload[key];
        }
      });
      
      const url = supabaseUrl ? `${supabaseUrl}${apiEndpoint}` : apiEndpoint;
      
      const headers = {
        'Content-Type': 'application/json'
      };
      
      if (supabaseKey) {
        headers['Authorization'] = `Bearer ${supabaseKey}`;
        headers['apikey'] = supabaseKey;
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      
      const result = await response.json();
      
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Erreur lors de l\'analyse');
      }
      
      // ============================================
      // WIRING: Normaliser les données EHPAD
      // Mapper name->nom, address->adresse, beds_total->capacite
      // ============================================
      if (result.market?.ehpad) {
        result.market.ehpad = normalizeEhpadData(result.market.ehpad, result.market?.insee);
        console.log('[MarketStudyPage] EHPAD data normalized:', result.market.ehpad);
      }
      
      // Normaliser aussi residences_seniors si présent
      if (result.market?.residences_seniors && Array.isArray(result.market.residences_seniors)) {
        result.market.residences_seniors = mapEhpadList(result.market.residences_seniors);
      }
      
      setData(result);
      
      // Déterminer le statut basé sur la couverture des données
      const coverage = result.market?.coverage || {};
      const hasErrors = Object.values(coverage).some(c => c === 'error');
      const hasPartial = Object.values(coverage).some(c => c === 'no_data' || c === 'not_covered');
      
      if (hasErrors) {
        setStatus(ANALYSIS_STATUS.PARTIAL);
      } else if (hasPartial) {
        setStatus(ANALYSIS_STATUS.PARTIAL);
      } else {
        setStatus(ANALYSIS_STATUS.SUCCESS);
      }
      
    } catch (err) {
      console.error('Analysis error:', err);
      setError(err.message);
      setStatus(ANALYSIS_STATUS.ERROR);
    }
  };
  
  const handleExportJSON = () => {
    if (!data) return;
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `etude-marche-${data.input?.commune_insee || 'export'}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  const handleExportCSV = () => {
    if (!data) return;
    
    // Export KPIs en CSV
    const kpis = data.market?.kpis || [];
    const csvContent = [
      ['Label', 'Valeur', 'Unité', 'Description'],
      ...kpis.map(k => [k.label, k.value ?? '', k.unit ?? '', k.description ?? ''])
    ].map(row => row.join(';')).join('\n');
    
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `etude-marche-kpis-${data.input?.commune_insee || 'export'}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <HeaderSection 
          data={data}
          status={status}
          onRefresh={fetchAnalysis}
          onExportJSON={handleExportJSON}
          onExportCSV={handleExportCSV}
        />
        
        {/* Paramètres */}
        <ParametersPanel 
          params={params}
          onChange={setParams}
          onSubmit={fetchAnalysis}
          isLoading={status === ANALYSIS_STATUS.LOADING}
        />
        
        {/* Contenu principal */}
        {status === ANALYSIS_STATUS.LOADING && (
          <Card className="mb-6">
            <div className="flex flex-col items-center justify-center py-16">
              <LoadingSpinner size="lg" />
              <p className="text-slate-600 font-medium mt-4">Analyse en cours...</p>
              <p className="text-sm text-slate-500 mt-1">
                Récupération des données DVF, BPE, INSEE...
              </p>
            </div>
          </Card>
        )}
        
        {status === ANALYSIS_STATUS.ERROR && (
          <Card className="mb-6">
            <div className="flex flex-col items-center justify-center py-12">
              <div className="p-3 rounded-full bg-red-100 text-red-500 mb-3">
                <X className="w-8 h-8" />
              </div>
              <p className="text-lg font-semibold text-slate-800">Erreur d'analyse</p>
              <p className="text-sm text-slate-600 mt-1">{error}</p>
              <button 
                onClick={fetchAnalysis}
                className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Réessayer
              </button>
            </div>
          </Card>
        )}
        
        {(status === ANALYSIS_STATUS.SUCCESS || status === ANALYSIS_STATUS.PARTIAL) && data && (
          <>
            {/* KPIs Synthèse */}
            <KPISynthesis data={data} />
            
            {/* Grille principale */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
              {/* Score global */}
              <Card>
                <CardHeader icon={Target} title="Score Global" />
                <div className="flex justify-center py-4">
                  <ScoreGauge score={data.market?.score} label="Attractivité" />
                </div>
                
                {data.market?.transport?.applicable !== false && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="text-center p-2 bg-slate-50 rounded">
                        <p className="text-xs text-slate-500">Transport</p>
                        <p className={`text-lg font-bold ${getScoreColor(data.market?.transport?.score)}`}>
                          {data.market?.transport?.score ?? '—'}
                        </p>
                      </div>
                      <div className="text-center p-2 bg-slate-50 rounded">
                        <p className="text-xs text-slate-500">Commodités</p>
                        <p className={`text-lg font-bold ${getScoreColor(data.market?.commoditesScore)}`}>
                          {data.market?.commoditesScore ?? '—'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
              
              {/* Prix */}
              <Card>
                <CardHeader icon={Euro} title="Prix Immobilier" coverage={data.market?.dvf?.coverage} />
                {data.market?.prices?.median_eur_m2 ? (
                  <div className="text-center py-4">
                    <p className="text-4xl font-bold text-indigo-600">
                      {formatPrice(data.market.prices.median_eur_m2)}
                    </p>
                    <p className="text-sm text-slate-500 mt-1">par m² (médian)</p>
                    
                    <div className="mt-4 flex justify-center gap-4 text-sm">
                      <div>
                        <span className="text-slate-500">Q1:</span>
                        <span className="font-medium text-slate-700 ml-1">
                          {formatPrice(data.market.prices.q1_eur_m2)}/m²
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">Q3:</span>
                        <span className="font-medium text-slate-700 ml-1">
                          {formatPrice(data.market.prices.q3_eur_m2)}/m²
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyState icon={Euro} title="Prix non disponibles" />
                )}
              </Card>
              
              {/* Population */}
              <Card>
                <CardHeader icon={Users} title="Population" coverage={data.market?.insee ? 'ok' : 'no_data'} />
                {data.market?.insee?.population ? (
                  <div className="text-center py-4">
                    <p className="text-4xl font-bold text-slate-800">
                      {formatNumber(data.market.insee.population)}
                    </p>
                    <p className="text-sm text-slate-500 mt-1">habitants</p>
                    
                    {data.market.insee.pct_plus_65 != null && (
                      <div className="mt-4 p-3 bg-rose-50 rounded-lg">
                        <p className="text-sm text-rose-600">
                          <span className="font-bold">{formatPercent(data.market.insee.pct_plus_65)}</span>
                          {' '}de 65 ans et +
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <EmptyState icon={Users} title="Données INSEE non disponibles" />
                )}
              </Card>
            </div>
            
            {/* Carte */}
            <MapEnvironment data={data} />
            
            {/* Services & Équipements */}
            <ServicesEquipements data={data} />
            
            {/* INSEE */}
            <INSEESocioDemographie data={data} />
            
            {/* Marché Immobilier */}
            <MarcheImmobilier data={data} />
            
            {/* Santé & Seniors */}
            <SanteSeniors data={data} />
            
            {/* Lecture Marché */}
            <LectureMarcheAlertes data={data} />
          </>
        )}
        
        {status === ANALYSIS_STATUS.IDLE && (
          <Card>
            <div className="flex flex-col items-center justify-center py-16">
              <div className="p-4 rounded-full bg-indigo-100 text-indigo-600 mb-4">
                <Building2 className="w-12 h-12" />
              </div>
              <p className="text-xl font-semibold text-slate-800">Bienvenue dans l'Étude de Marché</p>
              <p className="text-sm text-slate-500 mt-2 text-center max-w-md">
                Renseignez les coordonnées, le code INSEE ou l'identifiant de parcelle,
                puis lancez l'analyse pour obtenir une étude complète.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default MarketStudyPage;

// WIRING: Ajout de mapRawEhpadItem, mapEhpadList, normalizeEhpadData pour mapper name->nom, address->adresse, beds_total->capacite
// UI: Ajout de EhpadListItem pour afficher la liste détaillée des EHPAD avec nom, adresse, capacité
// SanteSeniors enrichi avec métriques, verdict et liste déroulante des établissements