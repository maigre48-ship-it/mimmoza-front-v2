import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  RefreshCw,
  ArrowRight,
  ExternalLink,
  X,
  Plus,
  Home,
  Building2,
  SlidersHorizontal,
  MapPin,
  Sparkles,
  Target,
  ChevronDown,
  ChevronUp,
  Search,
  Lock,
  Tag,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMarketVeille } from "../hooks/useMarketVeille";
import {
  fetchMarketActiveListings,
  type MarketActiveListing,
} from "../services/marketListings";

// ─── Extended listing type ─────────────────────────────────────────────────────

type ListingExtended = MarketActiveListing & {
  bedrooms?: number | null;
  land_surface_m2?: number | null;
  parking?: boolean | null;
  garage?: boolean | null;
  balcony?: boolean | null;
  terrace?: boolean | null;
  garden?: boolean | null;
  pool?: boolean | null;
  cellar?: boolean | null;
  furnished?: boolean | null;
  fitted_kitchen?: boolean | null;
  underfloor_heating?: boolean | null;
  to_renovate?: boolean | null;
  accessible?: boolean | null;
  elevator?: boolean | null;
  available_at?: string | null;
  floor?: number | null;
  is_top_floor?: boolean | null;
  construction_year?: number | null;
  energy_label?: string | null;
  heating_collective?: boolean | null;
  is_private_seller?: boolean | null;
  is_professional_seller?: boolean | null;
  exclusive?: boolean | null;
  description?: string | null;
  project_type?: string | null;
  transaction_type?: string | null;
  transactionMode?: string | null;
  listing_type?: string | null;
  deal_type?: string | null;
  business_type?: string | null;
  purpose?: string | null;
  category?: string | null;
};

// ─── Core types ────────────────────────────────────────────────────────────────

type OpportunityItem = {
  canonical_key: string;
  city: string | null;
  zip_code: string;
  intro: string | null | undefined;
  price_position: string | null | undefined;
  price_drop_info: string | null | undefined;
  diffusion_info: string | null | undefined;
  opportunity_score: number;
  opportunity_bucket: "faible" | "moyenne" | "forte";
  price: number | null | undefined;
  surface: number | null | undefined;
  price_m2: number | null | undefined;
  representative_url: string | null | undefined;
  score_freshness: number | null | undefined;
  score_price_position: number | null | undefined;
  score_diffusion: number | null | undefined;
  score_multi_portal: number | null | undefined;
  score_zone_liquidity: number | null | undefined;
  price_position_pct: number | null | undefined;
  portal_count: number | null | undefined;
  listing_count: number | null | undefined;
};

type PendingOpportunityDeal = {
  source: "veille-marche";
  canonicalKey: string;
  title: string;
  city: string | null;
  zipCode: string;
  price: number | null;
  surfaceM2: number | null;
  opportunityScore: number | null;
  opportunityBucket: "faible" | "moyenne" | "forte" | null;
  pricePosition: string;
  priceDropInfo: string;
  diffusionInfo: string;
  createdAt: string;
  sourceUrl?: string | null;
  sourcePortal?: string | null;
};

type SelectedZone = {
  city: string;
  zipCode: string;
};

// ─── Filters state ─────────────────────────────────────────────────────────────

type FiltersState = {
  propertyTypeFilter: "all" | "apartment" | "house";
  projectTypes: string[];
  priceMin: string;
  priceMax: string;
  roomsMin: string;
  roomsMax: string;
  bedroomsMin: string;
  bedroomsMax: string;
  surfaceMin: string;
  surfaceMax: string;
  terrainMin: string;
  terrainMax: string;
  parking: boolean;
  balcony: boolean;
  garden: boolean;
  pool: boolean;
  cellar: boolean;
  furnished: boolean;
  unfurnished: boolean;
  fittedKitchen: boolean;
  underfloorHeating: boolean;
  toRenovate: boolean;
  accessible: boolean;
  elevator: boolean;
  moveInBefore: string;
  showWithoutDate: boolean;
  floorTypes: string[];
  constructionYearMin: string;
  constructionYearMax: string;
  energyClasses: string[];
  heatingCollective: boolean;
  privateSellerOnly: boolean;
  professionalSellerOnly: boolean;
  exclusive: boolean;
  keywords: string;
};

const DEFAULT_FILTERS: FiltersState = {
  propertyTypeFilter: "all",
  projectTypes: [],
  priceMin: "",
  priceMax: "",
  roomsMin: "",
  roomsMax: "",
  bedroomsMin: "",
  bedroomsMax: "",
  surfaceMin: "",
  surfaceMax: "",
  terrainMin: "",
  terrainMax: "",
  parking: false,
  balcony: false,
  garden: false,
  pool: false,
  cellar: false,
  furnished: false,
  unfurnished: false,
  fittedKitchen: false,
  underfloorHeating: false,
  toRenovate: false,
  accessible: false,
  elevator: false,
  moveInBefore: "",
  showWithoutDate: true,
  floorTypes: [],
  constructionYearMin: "",
  constructionYearMax: "",
  energyClasses: [],
  heatingCollective: false,
  privateSellerOnly: false,
  professionalSellerOnly: false,
  exclusive: false,
  keywords: "",
};

// ─── Lock types ────────────────────────────────────────────────────────────────

type ZoneLock = {
  lockedAt: string;
  lockDate: string;
  filters: FiltersState;
};

// ─── Lock helpers ──────────────────────────────────────────────────────────────

function getTodayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getZoneLockStorageKey(city: string, zipCode: string): string {
  const safeCity = city.trim().toLowerCase().replace(/\s+/g, "-");
  const safeZip = zipCode.trim();
  return `veille-lock:${safeCity}:${safeZip}`;
}

function readZoneLock(city: string, zipCode: string): ZoneLock | null {
  try {
    const raw = localStorage.getItem(getZoneLockStorageKey(city, zipCode));
    if (!raw) return null;
    return JSON.parse(raw) as ZoneLock;
  } catch {
    return null;
  }
}

function writeZoneLock(
  city: string,
  zipCode: string,
  filters: FiltersState
): ZoneLock {
  const lock: ZoneLock = {
    lockedAt: new Date().toISOString(),
    lockDate: getTodayKey(),
    filters,
  };
  try {
    localStorage.setItem(
      getZoneLockStorageKey(city, zipCode),
      JSON.stringify(lock)
    );
  } catch {
    // silently fail
  }
  return lock;
}

function clearExpiredLock(city: string, zipCode: string): void {
  try {
    const existing = readZoneLock(city, zipCode);
    if (!existing) return;
    if (existing.lockDate !== getTodayKey()) {
      localStorage.removeItem(getZoneLockStorageKey(city, zipCode));
    }
  } catch {
    // silently fail
  }
}

function isLockActive(lock: ZoneLock | null): boolean {
  if (!lock) return false;
  return lock.lockDate === getTodayKey();
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const PENDING_OPPORTUNITY_STORAGE_KEY = "mimmoza.pendingOpportunityDeal";
const ZONE_LIMIT = 5;
/** Valeur fictive affichée à l'admin dans les compteurs de quota/limite. */
const ADMIN_DISPLAY_QUOTA = 9999;

// ─── Robust filter helpers ─────────────────────────────────────────────────────

function parseSafeNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const cleaned = raw
      .trim()
      .replace(/\s/g, "")
      .replace(/[€$£]/g, "")
      .replace(/m²|m2|sqm|sqft/gi, "")
      .replace(/\/mois|\/month|mensuel|monthly/gi, "")
      .replace(/,/g, ".");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseFilterInput(value: string): number | null {
  if (!value || !value.trim()) return null;
  const cleaned = value.replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function matchesNumericRange(
  rawVal: unknown,
  minStr: string,
  maxStr: string
): boolean {
  const min = parseFilterInput(minStr);
  const max = parseFilterInput(maxStr);

  if (min == null && max == null) return true;

  const val = parseSafeNumber(rawVal);
  if (val == null) return false;

  if (min != null && val < min) return false;
  if (max != null && val > max) return false;
  return true;
}

function normalizeText(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function coerceBoolean(raw: unknown): boolean | null {
  if (raw == null) return null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "oui") return true;
    if (s === "false" || s === "0" || s === "no" || s === "non") return false;
  }
  return null;
}

function parseSafeDate(raw: unknown): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return null;
}

// ─── Rental exclusion helpers (couche défensive) ───────────────────────────────
//
// Les locations sont déjà filtrées à la source (transaction_type = 0 dans
// marketListings.ts et transaction_mode = "sale" dans marketRefresh.ts).
// Ces helpers constituent une sécurité supplémentaire côté client.

const RENTAL_TYPE_KEYWORDS = new Set([
  "rent",
  "rental",
  "location",
  "louer",
  "locatif",
  "locative",
  "bail",
  "à louer",
  "a louer",
  "location saisonnière",
  "location saisonniere",
  "meublé à louer",
  "meuble a louer",
  "tenancy",
  "lease",
  "lettre",
  "loyer",
]);

const RENTAL_TEXT_PATTERNS = [
  /\bà\s*louer\b/i,
  /\ba\s*louer\b/i,
  /\blouer\b/i,
  /\blocation\b/i,
  /\blocatif\b/i,
  /\blocative\b/i,
  /\bloyer\b/i,
  /\bbail\b/i,
  /\brent(?:al)?\b/i,
  /\blease\b/i,
  /€\s*\/\s*mois/i,
  /€\/mois/i,
  /\bcc\/mois\b/i,
  /\bpar\s+mois\b/i,
  /\bmensuel(?:le)?\b/i,
  /\bcharg(?:es)?\s+comprises?\b/i,
];

const SALE_TYPE_KEYWORDS = new Set([
  "vente",
  "vendre",
  "sale",
  "achat",
  "acheter",
  "buy",
  "purchase",
  "acquisition",
  "cession",
  "mutation",
]);

function isRentalListing(l: ListingExtended): boolean {
  const txFields = [
    l.transaction_type,
    l.transactionMode,
    l.listing_type,
    l.deal_type,
    l.business_type,
    l.purpose,
    l.category,
    l.project_type,
  ];

  for (const field of txFields) {
    if (!field) continue;
    const norm = normalizeText(field);

    if (RENTAL_TYPE_KEYWORDS.has(norm)) return true;
    if (SALE_TYPE_KEYWORDS.has(norm)) return false;

    if (
      norm.includes("location") ||
      norm.includes("louer") ||
      norm.includes("rent") ||
      norm.includes("loyer") ||
      norm.includes("bail") ||
      norm.includes("locatif") ||
      norm.includes("lease")
    ) {
      return true;
    }

    if (
      norm.includes("vente") ||
      norm.includes("sale") ||
      norm.includes("achat") ||
      norm.includes("vendre")
    ) {
      return false;
    }
  }

  const textBlob = [l.title ?? "", l.description ?? ""].join(" ");

  for (const pattern of RENTAL_TEXT_PATTERNS) {
    if (pattern.test(textBlob)) return true;
  }

  return false;
}

// ─── Keyword matching helper ───────────────────────────────────────────────────

function matchesKeywords(l: ListingExtended, kw: string): boolean {
  if (!kw) return true;
  const needle = kw.toLowerCase().trim();
  if (!needle) return true;
  const haystack = normalizeText(
    [l.title ?? "", l.city ?? "", l.description ?? ""].join(" ")
  );
  return haystack.includes(needle);
}

// ─── Energy class matching ─────────────────────────────────────────────────────

function matchesEnergyClass(raw: unknown, classes: string[]): boolean {
  if (classes.length === 0) return true;
  if (!raw) return false;
  const norm = normalizeText(raw).toUpperCase();
  return classes.map((c) => c.toUpperCase().trim()).includes(norm);
}

// ─── Property type matching ────────────────────────────────────────────────────

function matchesPropertyType(
  propertyType: number | null | undefined,
  filter: "all" | "apartment" | "house"
): boolean {
  if (filter === "all") return true;
  if (propertyType == null) return false;
  if (filter === "apartment") return propertyType === 0;
  if (filter === "house") return propertyType === 1;
  return true;
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function VeilleMarchePage() {
  const navigate = useNavigate();

  const [draftCity, setDraftCity] = useState("");
  const [draftZipCode, setDraftZipCode] = useState("");
  const [savedZones, setSavedZones] = useState<SelectedZone[]>([]);
  const [activeZone, setActiveZone] = useState<SelectedZone | null>(null);
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [activeZoneLock, setActiveZoneLock] = useState<ZoneLock | null>(null);

  const zoneCity = activeZone?.city ?? "";
  const zoneZipCode = activeZone?.zipCode ?? "";
  const hasActiveZone = Boolean(zoneCity && zoneZipCode);
  const trackedZonesCount = savedZones.length;
  const remainingZonesCount = Math.max(0, ZONE_LIMIT - trackedZonesCount);

  // ─── Hook veille — mode toujours "sale", transactionMode non passé ─────────
  const {
    loading,
    refreshing,
    error,
    data,
    refreshPipeline,
    reloadOnly,
    bypassLimits,
    isAdmin,
  } = useMarketVeille({
    zipCode: zoneZipCode,
    city: zoneCity,
    autoRefreshOnMount: false,
  });

  // ─── Dérivation du statut lock avec bypass admin ───────────────────────────
  const rawLockActive = isLockActive(activeZoneLock);
  const filtersLocked = rawLockActive && !bypassLimits;

  const effectiveDailyRefreshLimit = bypassLimits ? ADMIN_DISPLAY_QUOTA : 1;
  const effectiveRemainingRefreshes = bypassLimits
    ? ADMIN_DISPLAY_QUOTA
    : filtersLocked
    ? 0
    : 1;

  // ─── Chargement du lock par zone (ignoré pour un admin) ───────────────────
  useEffect(() => {
    if (!zoneCity || !zoneZipCode) {
      setActiveZoneLock(null);
      return;
    }

    if (bypassLimits) {
      setActiveZoneLock(null);
      console.log("[VeilleMarchePage] admin bypass — zone lock ignoré", {
        city: zoneCity,
        zipCode: zoneZipCode,
      });
      return;
    }

    clearExpiredLock(zoneCity, zoneZipCode);
    const lock = readZoneLock(zoneCity, zoneZipCode);

    if (isLockActive(lock)) {
      setActiveZoneLock(lock);
      if (lock) {
        setFilters(lock.filters);
      }
    } else {
      setActiveZoneLock(null);
    }
  }, [zoneCity, zoneZipCode, bypassLimits]);

  const zoneLabel = useMemo(() => {
    if (!hasActiveZone) return "Aucune zone active";
    return `${zoneCity} (${zoneZipCode})`;
  }, [hasActiveZone, zoneCity, zoneZipCode]);

  const activeZipCodes = useMemo(
    () => (hasActiveZone && zoneZipCode ? [zoneZipCode.trim()] : []),
    [hasActiveZone, zoneZipCode]
  );

  const opportunities = useMemo(() => {
    if (!hasActiveZone) return [];
    return ((data?.opportunities ?? []) as OpportunityItem[]).filter((item) => {
      if (!item) return false;
      // Filtre anti-location : un loyer mensuel ne peut pas être un prix de vente
      if (item.price != null && item.price < 10_000) return false;
      if (item.price_m2 != null && item.price_m2 < 200) return false;
      return true;
    });
  }, [data?.opportunities, hasActiveZone]);

  const refreshDisabled =
    !hasActiveZone ||
    refreshing ||
    effectiveRemainingRefreshes <= 0 ||
    filtersLocked;

  const [listings, setListings] = useState<ListingExtended[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);

  useEffect(() => {
    async function loadListings() {
      if (activeZipCodes.length === 0) {
        setListings([]);
        return;
      }

      try {
        setListingsLoading(true);
        const rows = await fetchMarketActiveListings({
          zipCodes: activeZipCodes,
          limit: 24,
        });
        setListings(rows as ListingExtended[]);
      } catch (err) {
        console.error("[Veille] erreur chargement annonces:", err);
        setListings([]);
      } finally {
        setListingsLoading(false);
      }
    }

    void loadListings();
  }, [activeZipCodes, activeZone]);

  const filteredListings = useMemo(() => {
    const kw = filters.keywords.trim().toLowerCase();

    return listings.filter((l) => {
      // Couche défensive : exclure toute location résiduelle
      if (isRentalListing(l)) return false;
      if (!matchesPropertyType(l.property_type, filters.propertyTypeFilter))
        return false;

      if (filters.projectTypes.length > 0) {
        const pt = normalizeText(l.project_type);
        if (!filters.projectTypes.map(normalizeText).includes(pt)) return false;
      }

      if (!matchesNumericRange(l.price, filters.priceMin, filters.priceMax))
        return false;
      if (!matchesNumericRange(l.rooms, filters.roomsMin, filters.roomsMax))
        return false;
      if (
        !matchesNumericRange(
          l.bedrooms,
          filters.bedroomsMin,
          filters.bedroomsMax
        )
      )
        return false;
      if (
        !matchesNumericRange(
          l.surface_m2,
          filters.surfaceMin,
          filters.surfaceMax
        )
      )
        return false;
      if (
        !matchesNumericRange(
          l.land_surface_m2,
          filters.terrainMin,
          filters.terrainMax
        )
      )
        return false;

      if (filters.parking) {
        const hasPk =
          coerceBoolean(l.parking) === true ||
          coerceBoolean(l.garage) === true;
        if (!hasPk) return false;
      }

      if (filters.balcony) {
        const hasBalcony =
          coerceBoolean(l.balcony) === true ||
          coerceBoolean(l.terrace) === true;
        if (!hasBalcony) return false;
      }

      if (filters.garden && coerceBoolean(l.garden) !== true) return false;
      if (filters.pool && coerceBoolean(l.pool) !== true) return false;
      if (filters.cellar && coerceBoolean(l.cellar) !== true) return false;

      if (filters.furnished && !filters.unfurnished) {
        if (coerceBoolean(l.furnished) !== true) return false;
      }

      if (filters.unfurnished && !filters.furnished) {
        const fv = coerceBoolean(l.furnished);
        if (fv === true) return false;
      }

      if (
        filters.fittedKitchen &&
        coerceBoolean(l.fitted_kitchen) !== true
      ) {
        return false;
      }

      if (
        filters.underfloorHeating &&
        coerceBoolean(l.underfloor_heating) !== true
      ) {
        return false;
      }

      if (filters.toRenovate && coerceBoolean(l.to_renovate) !== true)
        return false;
      if (filters.accessible && coerceBoolean(l.accessible) !== true)
        return false;
      if (filters.elevator && coerceBoolean(l.elevator) !== true) return false;

      if (filters.moveInBefore) {
        const limitDate = parseSafeDate(filters.moveInBefore);
        const availDate = parseSafeDate(l.available_at);

        if (availDate == null) {
          if (!filters.showWithoutDate) return false;
        } else {
          if (limitDate != null && availDate > limitDate) return false;
        }
      }

      if (filters.floorTypes.length > 0) {
        const floor = parseSafeNumber(l.floor);
        const isTop = coerceBoolean(l.is_top_floor) === true;

        const match = filters.floorTypes.some((ft) => {
          if (ft === "top") return isTop;
          if (ft === "ground") return floor != null && floor === 0;
          if (ft === "others") return floor != null && floor > 0 && !isTop;
          return false;
        });

        if (!match) return false;
      }

      if (
        !matchesNumericRange(
          l.construction_year,
          filters.constructionYearMin,
          filters.constructionYearMax
        )
      ) {
        return false;
      }

      if (!matchesEnergyClass(l.energy_label, filters.energyClasses))
        return false;

      if (
        filters.heatingCollective &&
        coerceBoolean(l.heating_collective) !== true
      ) {
        return false;
      }

      if (filters.privateSellerOnly && !filters.professionalSellerOnly) {
        if (coerceBoolean(l.is_private_seller) !== true) return false;
      }

      if (filters.professionalSellerOnly && !filters.privateSellerOnly) {
        if (coerceBoolean(l.is_professional_seller) !== true) return false;
      }

      if (filters.exclusive && coerceBoolean(l.exclusive) !== true)
        return false;
      if (!matchesKeywords(l, kw)) return false;

      return true;
    });
  }, [listings, filters]);

  function setFilter<K extends keyof FiltersState>(
    key: K,
    value: FiltersState[K]
  ) {
    if (filtersLocked) return;
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function toggleArr(
    key: "projectTypes" | "floorTypes" | "energyClasses",
    item: string
  ) {
    if (filtersLocked) return;
    setFilters((prev) => ({
      ...prev,
      [key]: toggleInArray(prev[key] as string[], item),
    }));
  }

  function resetFilters() {
    if (filtersLocked) return;
    setFilters(DEFAULT_FILTERS);
  }

  function sameZone(a: SelectedZone, b: SelectedZone): boolean {
    return (
      a.city.trim().toLowerCase() === b.city.trim().toLowerCase() &&
      a.zipCode.trim().toLowerCase() === b.zipCode.trim().toLowerCase()
    );
  }

  function buildDraftZone(): SelectedZone | null {
    const city = draftCity.trim();
    const zipCode = draftZipCode.trim();
    if (!city || !zipCode) return null;
    return { city, zipCode };
  }

  function handleAddZone() {
    const next = buildDraftZone();
    if (!next || savedZones.length >= ZONE_LIMIT) return;

    if (savedZones.some((z) => sameZone(z, next))) {
      setDraftCity("");
      setDraftZipCode("");
      return;
    }

    setSavedZones((prev) => [...prev, next]);
    setDraftCity("");
    setDraftZipCode("");
  }

  function handleApplyZone() {
    const next = buildDraftZone();

    if (next) {
      setSavedZones((prev) => {
        if (prev.some((z) => sameZone(z, next))) return prev;
        if (prev.length >= ZONE_LIMIT) return prev;
        return [...prev, next];
      });

      setActiveZone(next);
      setDraftCity("");
      setDraftZipCode("");
      return;
    }

    if (!activeZone && savedZones.length > 0) {
      setActiveZone(savedZones[0]);
    }
  }

  function handleActivateSavedZone(zone: SelectedZone) {
    setActiveZone(zone);
  }

  function handleRemoveZone(zoneToRemove: SelectedZone) {
    setSavedZones((prev) => {
      const next = prev.filter((z) => !sameZone(z, zoneToRemove));
      if (activeZone && sameZone(activeZone, zoneToRemove)) {
        setActiveZone(next[0] ?? null);
      }
      return next;
    });
  }

  function handleRefreshWithConfirm() {
    if (!hasActiveZone || refreshDisabled) return;

    if (bypassLimits) {
      console.log("[VeilleMarchePage] admin refresh — bypass total", {
        city: zoneCity,
        zipCode: zoneZipCode,
        isAdmin,
      });
      void refreshPipeline();
      return;
    }

    const confirmed = window.confirm(
      "Vous êtes sur le point de lancer votre unique actualisation quotidienne pour cette zone.\n\n" +
        "Après validation, vos filtres seront verrouillés jusqu'à demain et vous ne pourrez plus modifier cette veille aujourd'hui.\n\n" +
        "Voulez-vous continuer ?"
    );

    if (!confirmed) return;

    const lock = writeZoneLock(zoneCity, zoneZipCode, filters);
    setActiveZoneLock(lock);
    void refreshPipeline();
  }

  function handleAnalyzeOpportunity(
    item: OpportunityItem,
    sourceMeta?: { sourceUrl?: string | null; sourcePortal?: string | null }
  ) {
    const parsed = parseOpportunityIntro(item);

    const payload: PendingOpportunityDeal = {
      source: "veille-marche",
      canonicalKey: item.canonical_key,
      title: parsed.title,
      city: item.city,
      zipCode: item.zip_code,
      price: item.price ?? null,
      surfaceM2: item.surface ?? null,
      opportunityScore: item.opportunity_score,
      opportunityBucket: item.opportunity_bucket,
      pricePosition: normalizeNarrative(item.price_position),
      priceDropInfo: normalizeNarrative(item.price_drop_info),
      diffusionInfo: normalizeNarrative(item.diffusion_info),
      createdAt: new Date().toISOString(),
      sourceUrl: sourceMeta?.sourceUrl ?? item.representative_url ?? null,
      sourcePortal: sourceMeta?.sourcePortal ?? null,
    };

    try {
      sessionStorage.setItem(
        PENDING_OPPORTUNITY_STORAGE_KEY,
        JSON.stringify(payload)
      );
    } catch (e) {
      console.warn("[VeilleMarchePage] handoff error:", e);
    }

    navigate("/marchand-de-bien");
  }

  function handleAnalyzeListing(listing: ListingExtended) {
    const payload: PendingOpportunityDeal = {
      source: "veille-marche",
      canonicalKey: listing.external_id,
      title: listing.title?.trim() || "Bien détecté",
      city: listing.city,
      zipCode: listing.zip_code ?? "",
      price: listing.price ?? null,
      surfaceM2: listing.surface_m2 ?? null,
      opportunityScore: null,
      opportunityBucket: null,
      pricePosition: "",
      priceDropInfo: "",
      diffusionInfo: "",
      createdAt: new Date().toISOString(),
      sourceUrl: listing.source_url ?? null,
      sourcePortal: listing.source_portal ?? null,
    };

    try {
      sessionStorage.setItem(
        PENDING_OPPORTUNITY_STORAGE_KEY,
        JSON.stringify(payload)
      );
    } catch (e) {
      console.warn("[VeilleMarchePage] handoff error:", e);
    }

    navigate("/marchand-de-bien");
  }

  const advancedFilterCount = useMemo(() => {
    let c = 0;
    if (filters.projectTypes.length > 0) c++;
    if (filters.bedroomsMin || filters.bedroomsMax) c++;
    if (filters.terrainMin || filters.terrainMax) c++;
    if (filters.parking) c++;
    if (filters.balcony) c++;
    if (filters.garden) c++;
    if (filters.pool) c++;
    if (filters.cellar) c++;
    if (filters.furnished) c++;
    if (filters.unfurnished) c++;
    if (filters.fittedKitchen) c++;
    if (filters.underfloorHeating) c++;
    if (filters.toRenovate) c++;
    if (filters.accessible) c++;
    if (filters.elevator) c++;
    if (filters.moveInBefore) c++;
    if (filters.floorTypes.length > 0) c++;
    if (filters.constructionYearMin || filters.constructionYearMax) c++;
    if (filters.energyClasses.length > 0) c++;
    if (filters.heatingCollective) c++;
    if (filters.privateSellerOnly || filters.professionalSellerOnly) c++;
    if (filters.exclusive) c++;
    if (filters.keywords.trim()) c++;
    return c;
  }, [filters]);

  const fd = filtersLocked;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 p-6">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <div className="overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
          <div className="border-b border-slate-100 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 px-8 py-8 text-white">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="max-w-2xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/90">
                  <Sparkles className="h-3.5 w-3.5" />
                  Veille premium
                </div>

                <h1 className="text-4xl font-semibold tracking-tight">
                  Veille marché
                </h1>

                <div className="mt-4 space-y-2 text-sm text-slate-200">
                  <p className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Zone active : {zoneLabel}
                    {filtersLocked && !bypassLimits && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/20 px-2 py-0.5 text-xs font-semibold text-amber-300">
                        <Lock className="h-3 w-3" />
                        Veille figée jusqu&apos;à demain
                      </span>
                    )}
                    {bypassLimits && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-indigo-400/40 bg-indigo-400/20 px-2 py-0.5 text-xs font-semibold text-indigo-200">
                        <Sparkles className="h-3 w-3" />
                        Mode admin — accès illimité
                      </span>
                    )}
                  </p>

                  <p>
                    {trackedZonesCount} zone
                    {trackedZonesCount > 1 ? "s" : ""} suivie
                    {trackedZonesCount > 1 ? "s" : ""} sur {ZONE_LIMIT}
                    {" • "}
                    {remainingZonesCount} restante
                    {remainingZonesCount > 1 ? "s" : ""}
                  </p>
                </div>
              </div>

              <div className="grid min-w-[280px] gap-3 sm:grid-cols-2">
                <HeroStatCard
                  label="Zones suivies"
                  value={String(trackedZonesCount)}
                  tone="indigo"
                />
                <HeroStatCard
                  label="Opportunités"
                  value={String(opportunities.length)}
                  tone="emerald"
                />
              </div>
            </div>
          </div>

          <div className="space-y-5 px-8 py-6">
            <div className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-4">
              <div className="mb-4 flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-slate-600" />
                <p className="text-sm font-semibold text-slate-900">
                  Zones surveillées
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <input
                  value={draftCity}
                  onChange={(e) => setDraftCity(e.target.value)}
                  placeholder="Ville"
                  className="w-[220px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                />
                <input
                  value={draftZipCode}
                  onChange={(e) => setDraftZipCode(e.target.value)}
                  placeholder="Code postal"
                  className="w-[150px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                />
                <button
                  onClick={handleAddZone}
                  disabled={
                    savedZones.length >= ZONE_LIMIT ||
                    !draftCity.trim() ||
                    !draftZipCode.trim()
                  }
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  Ajouter
                </button>
                <button
                  onClick={handleApplyZone}
                  disabled={
                    (!draftCity.trim() || !draftZipCode.trim()) &&
                    savedZones.length === 0
                  }
                  className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Charger la sélection
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {savedZones.length === 0 ? (
                  <div className="rounded-full border border-dashed border-slate-300 bg-white px-4 py-2 text-sm text-slate-500">
                    Aucune zone suivie
                  </div>
                ) : (
                  savedZones.map((zone, index) => {
                    const isActive = activeZone ? sameZone(activeZone, zone) : false;
                    const zoneLock = bypassLimits
                      ? null
                      : readZoneLock(zone.city, zone.zipCode);
                    const zoneLocked = !bypassLimits && isLockActive(zoneLock);

                    return (
                      <div
                        key={`${zone.city}-${zone.zipCode}-${index}`}
                        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm ${
                          isActive
                            ? "border-indigo-200 bg-gradient-to-r from-indigo-600 to-blue-600 text-white"
                            : "border-slate-200 bg-white text-slate-700"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleActivateSavedZone(zone)}
                          className="text-left"
                        >
                          {zone.city} ({zone.zipCode}){isActive ? " • active" : ""}
                          {zoneLocked && (
                            <Lock className="ml-1 inline h-3 w-3 opacity-70" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRemoveZone(zone)}
                          className={`rounded-full p-0.5 transition ${
                            isActive
                              ? "text-white/80 hover:text-white"
                              : "text-slate-400 hover:text-slate-700"
                          }`}
                          aria-label={`Supprimer ${zone.city} ${zone.zipCode}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-start gap-3">
                <button
                  onClick={() => void reloadOnly()}
                  disabled={!hasActiveZone}
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Recharger
                </button>

                <div className="space-y-2">
                  <button
                    onClick={handleRefreshWithConfirm}
                    disabled={refreshDisabled}
                    className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:from-indigo-500 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                    />
                    Actualiser la veille
                  </button>

                  <div
                    className={`rounded-2xl border px-3 py-2 text-xs font-medium ${
                      bypassLimits
                        ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                        : "border-indigo-100 bg-indigo-50 text-indigo-700"
                    }`}
                  >
                    {bypassLimits ? (
                      <>Accès illimité — mode admin</>
                    ) : (
                      <>
                        {effectiveRemainingRefreshes} actualisation restante
                        aujourd&apos;hui • limite {effectiveDailyRefreshLimit}/jour
                      </>
                    )}
                  </div>
                </div>
              </div>

              {filtersLocked && !bypassLimits && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <div className="flex items-start gap-2">
                    <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                    <div>
                      <p className="font-semibold">
                        Veille verrouillée jusqu&apos;à demain
                      </p>
                      <p className="mt-0.5 text-xs text-amber-700">
                        Vous avez déjà lancé votre actualisation quotidienne pour
                        cette zone. Vos filtres sont figés jusqu&apos;à demain.
                        Utilisez <span className="font-semibold">Recharger</span>{" "}
                        pour relire les données existantes.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div
              className={`rounded-[28px] border bg-white p-5 shadow-sm transition ${
                fd ? "border-amber-200" : "border-slate-200"
              }`}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Filtres biens
                    </p>
                    <p className="text-sm text-slate-500">
                      Affinez les annonces selon vos critères d&apos;investissement
                    </p>
                  </div>

                  {/* Badge "Vente uniquement" — toujours visible */}
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    <Tag className="h-3 w-3" />
                    Vente uniquement
                  </span>

                  {fd && !bypassLimits && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                      <Lock className="h-3 w-3" />
                      Filtres verrouillés jusqu&apos;à demain
                    </span>
                  )}
                </div>

                <button
                  onClick={resetFilters}
                  disabled={fd}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Réinitialiser
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
                <FSelect
                  value={filters.propertyTypeFilter}
                  onChange={(v) =>
                    setFilter(
                      "propertyTypeFilter",
                      v as FiltersState["propertyTypeFilter"]
                    )
                  }
                  disabled={fd}
                >
                  <option value="all">Tous les biens</option>
                  <option value="apartment">Appartement</option>
                  <option value="house">Maison</option>
                </FSelect>

                <FInput
                  value={filters.priceMin}
                  onChange={(v) => setFilter("priceMin", v)}
                  placeholder="Prix min"
                  disabled={fd}
                />
                <FInput
                  value={filters.priceMax}
                  onChange={(v) => setFilter("priceMax", v)}
                  placeholder="Prix max"
                  disabled={fd}
                />
                <FInput
                  value={filters.surfaceMin}
                  onChange={(v) => setFilter("surfaceMin", v)}
                  placeholder="Surface min"
                  disabled={fd}
                />
                <FInput
                  value={filters.surfaceMax}
                  onChange={(v) => setFilter("surfaceMax", v)}
                  placeholder="Surface max"
                  disabled={fd}
                />
                <FInput
                  value={filters.roomsMin}
                  onChange={(v) => setFilter("roomsMin", v)}
                  placeholder="Pièces min"
                  disabled={fd}
                />
                <FInput
                  value={filters.roomsMax}
                  onChange={(v) => setFilter("roomsMax", v)}
                  placeholder="Pièces max"
                  disabled={fd}
                />
              </div>

              <div className="mt-4">
                <button
                  onClick={() => setShowAdvancedFilters((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
                >
                  {showAdvancedFilters ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                  Filtres avancés
                  {advancedFilterCount > 0 && (
                    <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
                      {advancedFilterCount}
                    </span>
                  )}
                </button>
              </div>

              {showAdvancedFilters && (
                <div className="mt-5 border-t border-slate-100 pt-5">
                  <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                    <FGroup title="Type de projet">
                      {[
                        { v: "ancien", l: "Ancien" },
                        { v: "neuf", l: "Immobilier neuf" },
                        { v: "construction", l: "Projet de construction" },
                        { v: "viager", l: "Vente en viager" },
                      ].map(({ v, l }) => (
                        <FCbx
                          key={v}
                          label={l}
                          checked={filters.projectTypes.includes(v)}
                          onChange={() => toggleArr("projectTypes", v)}
                          disabled={fd}
                        />
                      ))}
                    </FGroup>

                    <FGroup title="Chambres">
                      <div className="flex items-center gap-2">
                        <FInput
                          value={filters.bedroomsMin}
                          onChange={(v) => setFilter("bedroomsMin", v)}
                          placeholder="Min"
                          disabled={fd}
                        />
                        <span className="text-xs text-slate-400">–</span>
                        <FInput
                          value={filters.bedroomsMax}
                          onChange={(v) => setFilter("bedroomsMax", v)}
                          placeholder="Max"
                          disabled={fd}
                        />
                      </div>
                    </FGroup>

                    <FGroup title="Surface terrain (m²)">
                      <div className="flex items-center gap-2">
                        <FInput
                          value={filters.terrainMin}
                          onChange={(v) => setFilter("terrainMin", v)}
                          placeholder="Min"
                          disabled={fd}
                        />
                        <span className="text-xs text-slate-400">–</span>
                        <FInput
                          value={filters.terrainMax}
                          onChange={(v) => setFilter("terrainMax", v)}
                          placeholder="Max"
                          disabled={fd}
                        />
                      </div>
                    </FGroup>

                    <FGroup title="Caractéristiques">
                      <FCbx
                        label="Parking / garage"
                        checked={filters.parking}
                        onChange={() => setFilter("parking", !filters.parking)}
                        disabled={fd}
                      />
                      <FCbx
                        label="Balcon / terrasse"
                        checked={filters.balcony}
                        onChange={() => setFilter("balcony", !filters.balcony)}
                        disabled={fd}
                      />
                      <FCbx
                        label="Jardin"
                        checked={filters.garden}
                        onChange={() => setFilter("garden", !filters.garden)}
                        disabled={fd}
                      />
                      <FCbx
                        label="Piscine"
                        checked={filters.pool}
                        onChange={() => setFilter("pool", !filters.pool)}
                        disabled={fd}
                      />
                    </FGroup>

                    <FGroup title="Intérieur">
                      <FCbx
                        label="Cave"
                        checked={filters.cellar}
                        onChange={() => setFilter("cellar", !filters.cellar)}
                        disabled={fd}
                      />
                      <FCbx
                        label="Entièrement meublé"
                        checked={filters.furnished}
                        onChange={() => setFilter("furnished", !filters.furnished)}
                        disabled={fd}
                      />
                      <FCbx
                        label="Non meublé"
                        checked={filters.unfurnished}
                        onChange={() =>
                          setFilter("unfurnished", !filters.unfurnished)
                        }
                        disabled={fd}
                      />
                      <FCbx
                        label="Cuisine intégrée"
                        checked={filters.fittedKitchen}
                        onChange={() =>
                          setFilter("fittedKitchen", !filters.fittedKitchen)
                        }
                        disabled={fd}
                      />
                      <FCbx
                        label="Chauffage au sol"
                        checked={filters.underfloorHeating}
                        onChange={() =>
                          setFilter(
                            "underfloorHeating",
                            !filters.underfloorHeating
                          )
                        }
                        disabled={fd}
                      />
                    </FGroup>

                    <div className="space-y-5">
                      <FGroup title="Utilisation">
                        <FCbx
                          label="À rénover"
                          checked={filters.toRenovate}
                          onChange={() =>
                            setFilter("toRenovate", !filters.toRenovate)
                          }
                          disabled={fd}
                        />
                      </FGroup>

                      <FGroup title="Accessibilité">
                        <FCbx
                          label="Accès mobilité réduite"
                          checked={filters.accessible}
                          onChange={() =>
                            setFilter("accessible", !filters.accessible)
                          }
                          disabled={fd}
                        />
                        <FCbx
                          label="Ascenseur"
                          checked={filters.elevator}
                          onChange={() =>
                            setFilter("elevator", !filters.elevator)
                          }
                          disabled={fd}
                        />
                      </FGroup>
                    </div>

                    <FGroup title="Disponibilité">
                      <p className="mb-1.5 text-xs text-slate-500">
                        Emménager au plus tard le
                      </p>
                      <input
                        type="date"
                        value={filters.moveInBefore}
                        onChange={(e) =>
                          setFilter("moveInBefore", e.target.value)
                        }
                        disabled={fd}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <FCbx
                        label="Afficher aussi les logements sans date"
                        checked={filters.showWithoutDate}
                        onChange={() =>
                          setFilter("showWithoutDate", !filters.showWithoutDate)
                        }
                        disabled={fd}
                      />
                    </FGroup>

                    <FGroup title="Étage">
                      {[
                        { v: "top", l: "Dernier étage" },
                        { v: "ground", l: "Rez-de-chaussée" },
                        { v: "others", l: "Autres étages" },
                      ].map(({ v, l }) => (
                        <FCbx
                          key={v}
                          label={l}
                          checked={filters.floorTypes.includes(v)}
                          onChange={() => toggleArr("floorTypes", v)}
                          disabled={fd}
                        />
                      ))}
                    </FGroup>

                    <FGroup title="Année de construction">
                      <div className="flex items-center gap-2">
                        <FInput
                          value={filters.constructionYearMin}
                          onChange={(v) =>
                            setFilter("constructionYearMin", v)
                          }
                          placeholder="Année min"
                          disabled={fd}
                        />
                        <span className="text-xs text-slate-400">–</span>
                        <FInput
                          value={filters.constructionYearMax}
                          onChange={(v) =>
                            setFilter("constructionYearMax", v)
                          }
                          placeholder="Année max"
                          disabled={fd}
                        />
                      </div>
                    </FGroup>

                    <FGroup title="Performance énergétique (DPE)">
                      <div className="grid grid-cols-7 gap-1">
                        {(["A", "B", "C", "D", "E", "F", "G"] as const).map(
                          (cls) => {
                            const checked = filters.energyClasses.includes(cls);
                            const colorMap: Record<string, string> = {
                              A: "bg-emerald-500",
                              B: "bg-green-400",
                              C: "bg-lime-400",
                              D: "bg-yellow-400",
                              E: "bg-orange-400",
                              F: "bg-orange-500",
                              G: "bg-red-500",
                            };

                            return (
                              <button
                                key={cls}
                                type="button"
                                onClick={() => toggleArr("energyClasses", cls)}
                                disabled={fd}
                                className={`flex h-9 w-full items-center justify-center rounded-xl text-sm font-bold transition disabled:cursor-not-allowed ${
                                  checked
                                    ? `${colorMap[cls]} text-white shadow-sm`
                                    : "border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                                }`}
                              >
                                {cls}
                              </button>
                            );
                          }
                        )}
                      </div>
                    </FGroup>

                    <div className="space-y-5">
                      <FGroup title="Énergie et chauffage">
                        <FCbx
                          label="Chauffage collectif"
                          checked={filters.heatingCollective}
                          onChange={() =>
                            setFilter(
                              "heatingCollective",
                              !filters.heatingCollective
                            )
                          }
                          disabled={fd}
                        />
                      </FGroup>

                      <FGroup title="Proposé par">
                        <FCbx
                          label="Particulier"
                          checked={filters.privateSellerOnly}
                          onChange={() =>
                            setFilter(
                              "privateSellerOnly",
                              !filters.privateSellerOnly
                            )
                          }
                          disabled={fd}
                        />
                        <FCbx
                          label="Professionnel"
                          checked={filters.professionalSellerOnly}
                          onChange={() =>
                            setFilter(
                              "professionalSellerOnly",
                              !filters.professionalSellerOnly
                            )
                          }
                          disabled={fd}
                        />
                      </FGroup>

                      <FGroup title="Affichage">
                        <FCbx
                          label="Exclusivité agence"
                          checked={filters.exclusive}
                          onChange={() =>
                            setFilter("exclusive", !filters.exclusive)
                          }
                          disabled={fd}
                        />
                      </FGroup>
                    </div>

                    <div className="md:col-span-2 xl:col-span-3">
                      <FGroup title="Recherche par mots-clés">
                        <div className="relative">
                          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <input
                            value={filters.keywords}
                            onChange={(e) =>
                              setFilter("keywords", e.target.value)
                            }
                            placeholder="jardin piscine métro cave..."
                            disabled={fd}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          Recherche dans le titre, la description et la ville
                        </p>
                      </FGroup>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {!hasActiveZone && (
          <div className="rounded-[32px] border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
            <p className="text-lg font-semibold text-slate-900">
              Sélectionnez une zone active pour lancer la veille
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Ajoutez une zone puis cliquez sur{" "}
              <span className="font-semibold">Charger la sélection</span>, ou
              cliquez sur une zone déjà suivie pour l&apos;activer.
            </p>
          </div>
        )}

        {hasActiveZone && loading && (
          <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm text-slate-500">
              Chargement de la veille marché...
            </p>
          </div>
        )}

        {hasActiveZone && error && (
          <div className="rounded-[32px] border border-rose-200 bg-rose-50 p-8 shadow-sm">
            <p className="text-sm font-medium text-rose-700">{error}</p>
          </div>
        )}

        {hasActiveZone && !loading && !error && opportunities.length > 0 && (
          <OpportunitySpotlightCard
            item={opportunities[0]}
            onAnalyze={handleAnalyzeOpportunity}
          />
        )}

        {hasActiveZone && !loading && !error && opportunities.length > 1 && (
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900">
                Autres opportunités détectées
              </h2>
              <p className="text-sm text-slate-500">
                Résultats remontés par l&apos;API de veille sur la zone active
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {opportunities.slice(1).map((item) => (
                <OpportunityMiniCard
                  key={item.canonical_key}
                  item={item}
                  onAnalyze={handleAnalyzeOpportunity}
                />
              ))}
            </div>
          </div>
        )}

        {hasActiveZone && !loading && !error && opportunities.length === 0 && (
          <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
            <div className="flex items-center gap-3">
              <Target className="h-5 w-5 text-slate-500" />
              <div>
                <p className="text-base font-semibold text-slate-900">
                  Aucune opportunité détectée pour le moment
                </p>
                <p className="text-sm text-slate-500">
                  L&apos;API n&apos;a pas remonté d&apos;opportunité scorée sur
                  cette zone.
                </p>
              </div>
            </div>
          </div>
        )}

        {hasActiveZone && !loading && !error && (
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">
                  Annonces récentes détectées
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Annonces de vente sur la zone active {zoneCity} ({zoneZipCode})
                </p>
              </div>
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
                <span className="font-semibold">{filteredListings.length}</span>{" "}
                bien{filteredListings.length > 1 ? "s" : ""} après filtres
              </div>
            </div>

            {listingsLoading ? (
              <p className="text-sm text-slate-500">
                Chargement des annonces...
              </p>
            ) : filteredListings.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
                <p className="text-base font-semibold text-slate-900">
                  Aucun bien ne correspond aux critères actuels
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  Ajustez les filtres ou rechargez la veille.
                </p>
              </div>
            ) : (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {filteredListings.map((listing) => (
                  <ListingPremiumCard
                    key={`${listing.external_source}-${listing.external_id}`}
                    listing={listing}
                    onAnalyze={() => handleAnalyzeListing(listing)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Score breakdown ───────────────────────────────────────────────────────────

function ScoreBreakdown({ item }: { item: OpportunityItem }) {
  const [open, setOpen] = useState(false);

  const pillars = [
    {
      label: "Fraîcheur",
      value: item.score_freshness ?? null,
      max: 20,
      description: "Annonce récente sur le marché",
    },
    {
      label: "Position prix",
      value: item.score_price_position ?? null,
      max: 30,
      description:
        item.price_position_pct != null
          ? `${item.price_position_pct > 0 ? "+" : ""}${item.price_position_pct.toFixed(1)} % vs médiane zone`
          : "Position par rapport à la médiane de zone",
    },
    {
      label: "Diffusion",
      value: item.score_diffusion ?? null,
      max: 20,
      description: `${item.listing_count ?? "-"} annonce${
        (item.listing_count ?? 0) > 1 ? "s" : ""
      } détectée${(item.listing_count ?? 0) > 1 ? "s" : ""}`,
    },
    {
      label: "Multi-portail",
      value: item.score_multi_portal ?? null,
      max: 10,
      description: `Visible sur ${item.portal_count ?? "-"} portail${
        (item.portal_count ?? 0) > 1 ? "s" : ""
      }`,
    },
    {
      label: "Liquidité zone",
      value: item.score_zone_liquidity ?? null,
      max: 20,
      description: "Tension et fluidité du marché local",
    },
  ];

  return (
    <div className="overflow-hidden rounded-[20px] border border-emerald-100">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between bg-emerald-50 px-4 py-3 text-left transition hover:bg-emerald-100"
      >
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold text-emerald-700">
            {item.opportunity_score}
          </span>
          <span className="text-xs font-medium text-emerald-600">
            / 100 &mdash; Détail du score
          </span>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-emerald-600" />
        ) : (
          <ChevronDown className="h-4 w-4 text-emerald-600" />
        )}
      </button>

      {open && (
        <div className="divide-y divide-slate-100 bg-white">
          {pillars.map((pillar) => {
            const pct =
              pillar.value != null && pillar.max > 0
                ? (pillar.value / pillar.max) * 100
                : 0;

            return (
              <div key={pillar.label} className="px-4 py-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {pillar.label}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">
                    {pillar.value ?? "-"}{" "}
                    <span className="text-xs font-normal text-slate-400">
                      / {pillar.max}
                    </span>
                  </span>
                </div>

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                {pillar.description && (
                  <p className="mt-1 text-xs text-slate-400">
                    {pillar.description}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Opportunity mini card ─────────────────────────────────────────────────────

function OpportunityMiniCard({
  item,
  onAnalyze,
}: {
  item: OpportunityItem;
  onAnalyze: (item: OpportunityItem) => void;
}) {
  const parsed = parseOpportunityIntro(item);
  const bucket = formatOpportunityBucket(item.opportunity_bucket);
  const badgeClasses = getOpportunityBadgeClasses(item.opportunity_bucket);

  return (
    <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${badgeClasses}`}
          >
            {bucket}
          </span>
          <h3 className="mt-3 text-lg font-semibold text-slate-950">
            {parsed.title}
          </h3>
          <p className="text-sm text-slate-500">
            {item.city ?? "-"} ({item.zip_code})
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MiniInfoBox label="Prix" value={parsed.price ?? "-"} />
        <MiniInfoBox label="Surface" value={parsed.surface ?? "-"} />
      </div>

      <div className="mt-3">
        <ScoreBreakdown item={item} />
      </div>

      <div className="mt-4 space-y-2 text-sm text-slate-600">
        {item.price_position?.trim() ? (
          <p>{normalizeNarrative(item.price_position)}</p>
        ) : null}
        {item.price_drop_info?.trim() ? (
          <p>{normalizeNarrative(item.price_drop_info)}</p>
        ) : null}
        {item.diffusion_info?.trim() ? (
          <p>{normalizeNarrative(item.diffusion_info)}</p>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium text-slate-700">
            Opportunité {bucket.toLowerCase()}
          </p>
          {item.representative_url && (
            <a
              href={item.representative_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              Voir l&apos;annonce
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        <button
          type="button"
          onClick={() => onAnalyze(item)}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
        >
          Analyser
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Opportunity spotlight card ────────────────────────────────────────────────

function OpportunitySpotlightCard({
  item,
  onAnalyze,
}: {
  item: OpportunityItem;
  onAnalyze: (
    item: OpportunityItem,
    sourceMeta?: { sourceUrl?: string | null; sourcePortal?: string | null }
  ) => void;
}) {
  const bucket = formatOpportunityBucket(item.opportunity_bucket);
  const badgeClasses = getOpportunityBadgeClasses(item.opportunity_bucket);
  const parsed = parseOpportunityIntro(item);

  const highlights = [item.price_position, item.price_drop_info, item.diffusion_info]
    .filter((v): v is string => Boolean(v && v.trim().length > 0))
    .map((v) => normalizeNarrative(v));

  return (
    <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${badgeClasses}`}
            >
              {bucket}
            </span>
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight text-slate-950">
                {parsed.title}
              </h2>
              <p className="mt-1 text-lg text-slate-500">
                {item.city ?? "-"} ({item.zip_code})
              </p>
            </div>
          </div>
          <div className="min-w-[240px]">
            <ScoreBreakdown item={item} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Synthèse rapide
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <InfoBox label="Prix" value={parsed.price ?? "-"} />
              <InfoBox label="Surface" value={parsed.surface ?? "-"} />
              <InfoBox label="Niveau" value={bucket} />
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Pourquoi cette opportunité
            </p>
            <div className="space-y-3">
              {highlights.length === 0 ? (
                <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Aucun détail complémentaire renvoyé par l&apos;API sur ce bien.
                </div>
              ) : (
                highlights.map((line, index) => (
                  <div
                    key={`${item.canonical_key}-${index}`}
                    className="rounded-[20px] border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900"
                  >
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Lecture Mimmoza
            </p>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              {item.price_position?.trim() ? (
                <p>{normalizeNarrative(item.price_position)}</p>
              ) : null}
              {item.price_drop_info?.trim() ? (
                <p>{normalizeNarrative(item.price_drop_info)}</p>
              ) : null}
              {item.diffusion_info?.trim() ? (
                <p>{normalizeNarrative(item.diffusion_info)}</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Action recommandée
            </p>
            <p className="mt-3 text-lg font-semibold text-slate-950">
              {buildActionLabel(item.opportunity_bucket)}
            </p>
            <div className="mt-4 flex flex-col gap-3">
              {item.representative_url && (
                <a
                  href={item.representative_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Voir l&apos;annonce
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}

              <button
                type="button"
                onClick={() => onAnalyze(item)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
              >
                Analyser le bien
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Tagline
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              {buildOpportunityTagline(highlights)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Listing card ──────────────────────────────────────────────────────────────

function ListingPremiumCard({
  listing,
  onAnalyze,
}: {
  listing: ListingExtended;
  onAnalyze: () => void;
}) {
  const title = listing.title?.trim() || "Bien détecté";
  const badge = formatPortalLabel(listing.source_portal);
  const typeLabel = getPropertyTypeLabel(listing.property_type);

  return (
    <div className="group overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
      <div className="bg-gradient-to-r from-slate-50 via-white to-indigo-50/50 px-5 py-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <PortalBadge portal={badge} />
          <PropertyTypeBadge propertyType={listing.property_type} />
        </div>

        <h3 className="line-clamp-3 min-h-[88px] text-[1.9rem] font-semibold leading-tight tracking-tight text-slate-950">
          {title}
        </h3>

        <p className="mt-3 text-sm text-slate-500">
          {listing.city ?? "-"} ({listing.zip_code ?? "-"})
        </p>
        <p className="mt-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
          {typeLabel}
        </p>
      </div>

      <div className="px-5 pb-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <PremiumInfoStat
            label="Prix"
            value={
              listing.price != null
                ? `${parseSafeNumber(listing.price)?.toLocaleString("fr-FR") ?? "-"} €`
                : "-"
            }
            tone="emerald"
          />
          <PremiumInfoStat
            label="Surface"
            value={
              listing.surface_m2 != null ? `${listing.surface_m2} m²` : "-"
            }
            tone="blue"
          />
          <PremiumInfoStat
            label="Pièces"
            value={listing.rooms != null ? String(listing.rooms) : "-"}
            tone="amber"
          />
          <PremiumInfoStat
            label="Prix/m²"
            value={
              listing.price_per_m2 != null
                ? `${Math.round(
                    parseSafeNumber(listing.price_per_m2) ?? 0
                  ).toLocaleString("fr-FR")} €`
                : "-"
            }
            tone="rose"
          />
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-5">
          <a
            href={listing.source_url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-900"
          >
            Source
            <ExternalLink className="h-4 w-4" />
          </a>

          <button
            type="button"
            onClick={onAnalyze}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Analyser
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Filter UI primitives ──────────────────────────────────────────────────────

function FGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function FCbx({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2.5 text-sm text-slate-700 ${
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer hover:text-slate-900"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="h-4 w-4 rounded border-slate-300 accent-indigo-600 disabled:cursor-not-allowed"
      />
      {label}
    </label>
  );
}

function FInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}

function FSelect({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </select>
  );
}

// ─── Shared UI primitives ──────────────────────────────────────────────────────

function HeroStatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "indigo" | "emerald";
}) {
  const classes =
    tone === "indigo"
      ? "border-indigo-400/20 bg-indigo-400/10"
      : "border-emerald-400/20 bg-emerald-400/10";

  return (
    <div className={`rounded-[24px] border p-4 ${classes}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
    </div>
  );
}

function PremiumInfoStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "blue" | "amber" | "rose";
}) {
  const classes =
    tone === "emerald"
      ? "border-emerald-100 bg-emerald-50/70"
      : tone === "blue"
        ? "border-blue-100 bg-blue-50/70"
        : tone === "amber"
          ? "border-amber-100 bg-amber-50/70"
          : "border-rose-100 bg-rose-50/70";

  return (
    <div className={`rounded-[22px] border p-4 ${classes}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-[1.75rem] font-semibold tracking-tight text-slate-950">
        {value}
      </p>
    </div>
  );
}

function PortalBadge({ portal }: { portal: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700">
      {portal}
    </span>
  );
}

function PropertyTypeBadge({
  propertyType,
}: {
  propertyType: number | null | undefined;
}) {
  const isHouse = propertyType === 1;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
        isHouse
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-blue-200 bg-blue-50 text-blue-700"
      }`}
    >
      {isHouse ? (
        <Home className="h-3.5 w-3.5" />
      ) : (
        <Building2 className="h-3.5 w-3.5" />
      )}
      {isHouse ? "Maison" : "Appartement"}
    </span>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>
    </div>
  );
}

function MiniInfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold text-slate-950">{value}</p>
    </div>
  );
}

// ─── Pure helpers ──────────────────────────────────────────────────────────────

function formatOpportunityBucket(
  bucket: "faible" | "moyenne" | "forte"
): string {
  switch (bucket) {
    case "forte":
      return "Forte";
    case "moyenne":
      return "Moyenne";
    default:
      return "Faible";
  }
}

function getOpportunityBadgeClasses(
  bucket: "faible" | "moyenne" | "forte"
): string {
  switch (bucket) {
    case "forte":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "moyenne":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function buildActionLabel(bucket: "faible" | "moyenne" | "forte"): string {
  switch (bucket) {
    case "forte":
      return "Contacter vite";
    case "moyenne":
      return "À surveiller";
    default:
      return "Secondaire";
  }
}

function normalizeNarrative(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

function buildOpportunityTagline(lines: string[]): string {
  if (lines.length === 0) {
    return "Aucun commentaire synthétique disponible pour cette opportunité.";
  }

  return lines
    .map((line) =>
      normalizeNarrative(line)
        .replace(/\.$/, "")
        .replace(/^Prix /i, "prix ")
        .replace(/^Le bien /i, "")
        .replace(/^Diffuse /i, "diffuse ")
        .replace(/^Diffusion /i, "diffusion ")
    )
    .filter(Boolean)
    .join(" + ");
}

function parseOpportunityIntro(item: OpportunityItem): {
  title: string;
  price: string | null;
  surface: string | null;
} {
  const priceVal = parseSafeNumber(item.price);
  const price =
    priceVal != null ? `${priceVal.toLocaleString("fr-FR")} €` : null;
  const surface = item.surface != null ? `${item.surface} m²` : null;

  if (item.intro) {
    const normalized = normalizeNarrative(item.intro);
    const title = normalized.split(" - ")[0]?.trim() || "Bien détecté";
    return { title, price, surface };
  }

  const parts = [surface, price].filter(Boolean);
  const title = parts.length > 0 ? parts.join(" · ") : "Bien détecté";
  return { title, price, surface };
}

function formatPortalLabel(value: string | null | undefined): string {
  return value?.trim() || "Source";
}

function getPropertyTypeLabel(propertyType: number | null | undefined): string {
  if (propertyType === 1) return "Maison";
  return "Appartement";
}

function toggleInArray<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}