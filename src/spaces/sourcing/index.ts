/**
 * Module Sourcing - Exports
 * Point d'entrée pour l'utilisation du module
 */

// =========================
// Types
// =========================
export type {
  ProfileTarget,
  PropertyType,
  Ternary,
  FloorValue,
  ProximiteTransport,
  NuisanceLevel,
  Exposition,
  StandingImmeuble,
  StationnementMaison,
  EtatGeneral,
  PenteTerrain,
  AccesTerrain,
  SourcingLocationInput,
  SourcingQuartierInput,
  HouseOptions,
  ApartmentOptions,
  BuildingOptions,
  LandOptions,
  PropertySpecificOptions,
  SourcingInput,
  SourcingItemDraft,
} from "./types/sourcing.types";

// =========================
// Constants
// =========================
export {
  PROPERTY_TYPE_LABELS,
  TERNARY_OPTIONS,
  PROXIMITE_TRANSPORT_OPTIONS,
  NUISANCE_OPTIONS,
  EXPOSITION_OPTIONS,
  STANDING_OPTIONS,
  STATIONNEMENT_MAISON_OPTIONS,
  ETAT_GENERAL_OPTIONS,
  PENTE_OPTIONS,
  ACCES_OPTIONS,
  PROFILE_LABELS,
  FLOOR_SPECIAL_VALUES,
} from "./types/sourcing.types";

// =========================
// Validators & Utils
// =========================
export {
  validateDraft,
  normalizeDraft,
  isValidFloor,
  parseFloor,
  formatFloor,
  formatPrice,
  formatSurface,
  calculatePricePerSqm,
} from "./utils/validators";

export type { ValidationResult } from "./utils/validators";

// =========================
// Selectors
// =========================
export {
  getPropertyTypeOptions,
  getTernaryOptions,
  getProximiteTransportOptions,
  getNuisanceOptions,
  getExpositionOptions,
  getStandingOptions,
  getStationnementMaisonOptions,
  getEtatGeneralOptions,
  getPenteOptions,
  getAccesOptions,
  getFloorOptions,
  getDistanceTransportOptions,
  getBooleanOptions,
  getPropertyTypeLabel,
  getTernaryLabel,
  getExpositionLabel,
  getStandingLabel,
  getNuisanceLabel,
  getTransportLabel,
} from "./selectors/propertySelectors";

export type { SelectOption, FloorOption } from "./selectors/propertySelectors";

// =========================
// Components (✅ safe: default exports)
// =========================
export { default as SourcingForm } from "./forms/SourcingForm";

// =========================
// Pages (✅ safe: default exports)
// =========================
export { default as SourcingHomePage } from "./pages/SourcingHomePage";

// Default export for convenience
export { default } from "./pages/SourcingHomePage";
