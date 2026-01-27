// FILE: src/spaces/promoteur/etudes/marche/index.ts

// Page principale
export { MarchePage, default } from "./MarchePage";

// Hook
export { useMarketStudy, hasPartialData, getTotalPoisCount, formatDistance, formatNumber, formatPrice } from "./hooks/useMarketStudy";

// API
export { fetchMarketStudy, exportMarketStudyToJson, exportMarketStudyToCsv } from "./api/marketStudyApi";

// Types
export type {
  MarketStudyRequest,
  MarketStudyResponse,
  MarketStudyError,
  MarketStudyState,
  MarketStudyParams,
  Meta,
  Location,
  ContextInfo,
  InseeData,
  PoiCategory,
  Poi,
  PoisData,
  Kpis,
  DvfTransaction,
  CompsData,
} from "./types/marketStudy.types";

export { POI_CATEGORY_LABELS, POI_CATEGORY_ICONS } from "./types/marketStudy.types";

// Composants (si besoin de les utiliser séparément)
export { MarketStudyHeader } from "./components/MarketStudyHeader";
export { MarketStudyKpis } from "./components/MarketStudyKpis";
export { MarketStudyMap } from "./components/MarketStudyMap";
export { MarketStudyPoisPanel } from "./components/MarketStudyPoisPanel";
export { MarketStudyInseePanel } from "./components/MarketStudyInseePanel";
export { MarketStudyCompsPanel } from "./components/MarketStudyCompsPanel";
export { MarketStudyExport } from "./components/MarketStudyExport";