/**
 * Module Sourcing - Exports
 * Point d'entrée pour l'utilisation du module
 */

// =========================
// Types
// =========================
export type {
  AccesTerrain, ApartmentOptions,
  BuildingOptions, EtatGeneral, Exposition, FloorValue, HouseOptions, LandOptions, NuisanceLevel, PenteTerrain, ProfileTarget, PropertySpecificOptions, PropertyType, ProximiteTransport, SourcingInput,
  SourcingItemDraft, SourcingLocationInput,
  SourcingQuartierInput, StandingImmeuble,
  StationnementMaison, Ternary
} from "./types/sourcing.types";

// =========================
// Constants
// =========================
export {
  ACCES_OPTIONS, ETAT_GENERAL_OPTIONS, EXPOSITION_OPTIONS, FLOOR_SPECIAL_VALUES, NUISANCE_OPTIONS, PENTE_OPTIONS, PROFILE_LABELS, PROPERTY_TYPE_LABELS, PROXIMITE_TRANSPORT_OPTIONS, STANDING_OPTIONS,
  STATIONNEMENT_MAISON_OPTIONS, TERNARY_OPTIONS
} from "./types/sourcing.types";

// =========================
// Validators & Utils
// =========================
export {
  calculatePricePerSqm, formatFloor,
  formatPrice,
  formatSurface, isValidFloor, normalizeDraft, parseFloor, validateDraft
} from "./utils/validators";

export type { ValidationResult } from "./utils/validators";

// =========================
// Selectors
// =========================
export {
  getAccesOptions, getBooleanOptions, getDistanceTransportOptions, getEtatGeneralOptions, getExpositionLabel, getExpositionOptions, getFloorOptions, getNuisanceLabel, getNuisanceOptions, getPenteOptions, getPropertyTypeLabel, getPropertyTypeOptions, getProximiteTransportOptions, getStandingLabel, getStandingOptions,
  getStationnementMaisonOptions, getTernaryLabel, getTernaryOptions, getTransportLabel
} from "./selectors/propertySelectors";

export type { FloorOption, SelectOption } from "./selectors/propertySelectors";

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
