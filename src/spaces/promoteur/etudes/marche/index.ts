// FILE: src/spaces/promoteur/etudes/marche/index.ts

// Page principale
export { MarchePage, default } from "./MarchePage";

// Hook
export { formatDistance, formatNumber, formatPrice, getTotalPoisCount, hasPartialData, useMarketStudy } from "./hooks/useMarketStudy";

// API
export { exportMarketStudyToCsv, exportMarketStudyToJson, fetchMarketStudy } from "./api/marketStudyApi";

// Types
export type {
  CompsData, ContextInfo, DvfTransaction, InseeData, Kpis, Location, MarketStudyError, MarketStudyParams, MarketStudyRequest,
  MarketStudyResponse, MarketStudyState, Meta, Poi, PoiCategory, PoisData
} from "./types/marketStudy.types";

export { POI_CATEGORY_ICONS, POI_CATEGORY_LABELS } from "./types/marketStudy.types";

// Composants (si besoin de les utiliser séparément)
export { MarketStudyCompsPanel } from "./components/MarketStudyCompsPanel";
export { MarketStudyExport } from "./components/MarketStudyExport";
export { MarketStudyHeader } from "./components/MarketStudyHeader";
export { MarketStudyInseePanel } from "./components/MarketStudyInseePanel";
export { MarketStudyKpis } from "./components/MarketStudyKpis";
export { MarketStudyMap } from "./components/MarketStudyMap";
export { MarketStudyPoisPanel } from "./components/MarketStudyPoisPanel";
