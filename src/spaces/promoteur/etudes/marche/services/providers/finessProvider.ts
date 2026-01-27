// FILE: src/spaces/promoteur/etudes/marche/services/providers/finessProvider.ts

import { CompetitionData } from "../../types";

export interface FinessProviderParams {
  lat: number;
  lon: number;
  radiusKm: number;
  categories?: string[]; // Ex: ["500", "501", "502"] pour EHPAD/EHPA
}

export interface FinessEtablissement {
  finess: string;
  finessEj: string;
  name: string;
  category: string;
  categoryLabel: string;
  address: string;
  postalCode: string;
  commune: string;
  departement: string;
  lat: number;
  lon: number;
  capacity: number;
  telephone?: string;
  dateOuverture?: string;
  distance?: number; // Distance en km depuis le point de recherche
}

// Catégories FINESS pour les établissements personnes âgées
export const FINESS_CATEGORIES = {
  EHPAD: "500", // EHPAD (convention tripartite)
  EHPA_AM: "501", // EHPA percevant des crédits d'assurance maladie
  EHPA_SANS_AM: "502", // EHPA ne percevant pas de crédits d'assurance maladie
  LOGEMENT_FOYER: "202", // Logement Foyer / Résidence autonomie
  SSIAD: "354", // Service de Soins Infirmiers à Domicile
  ACCUEIL_JOUR: "207", // Centre de Jour pour Personnes Âgées
} as const;

// Catégories par défaut pour recherche EHPAD
export const DEFAULT_EHPAD_CATEGORIES = [
  FINESS_CATEGORIES.EHPAD,
  FINESS_CATEGORIES.EHPA_AM,
  FINESS_CATEGORIES.EHPA_SANS_AM,
];

// URL du fichier CSV FINESS sur data.gouv.fr (établissements géolocalisés)
const FINESS_CSV_URL =
  "https://www.data.gouv.fr/fr/datasets/r/2ce43ade-8d2c-4d1d-81da-ca06c82abc68";

// Cache en mémoire pour éviter de retélécharger le fichier à chaque requête
let finessCache: FinessEtablissement[] | null = null;
let lastCacheUpdate: Date | null = null;
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 heures

/**
 * Calcule la distance en km entre deux points (formule de Haversine)
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Rayon de la Terre en km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Parse une ligne CSV en tenant compte des guillemets
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ";" && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Télécharge et parse le fichier FINESS depuis data.gouv.fr
 */
async function loadFinessData(): Promise<FinessEtablissement[]> {
  // Vérifier le cache
  if (
    finessCache &&
    lastCacheUpdate &&
    Date.now() - lastCacheUpdate.getTime() < CACHE_DURATION_MS
  ) {
    console.log("[finessProvider] Utilisation du cache FINESS");
    return finessCache;
  }

  console.log("[finessProvider] Téléchargement des données FINESS...");

  try {
    const response = await fetch(FINESS_CSV_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const csvText = await response.text();
    const lines = csvText.split("\n");

    if (lines.length < 2) {
      throw new Error("Fichier CSV FINESS vide ou invalide");
    }

    // Parser l'en-tête pour trouver les indices des colonnes
    const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());

    // Mapping des colonnes (basé sur la structure du fichier FINESS)
    const colIndex = {
      nofinesset: headers.findIndex(
        (h) => h.includes("nofinesset") || h.includes("finess") && !h.includes("ej")
      ),
      nofinessej: headers.findIndex(
        (h) => h.includes("nofinessej") || h.includes("finess_ej")
      ),
      rs: headers.findIndex((h) => h === "rs" || h.includes("raison") || h.includes("libelle")),
      categetab: headers.findIndex(
        (h) => h.includes("categetab") || h.includes("categorie")
      ),
      libcategetab: headers.findIndex((h) => h.includes("libcateg")),
      numvoie: headers.findIndex((h) => h.includes("numvoie")),
      typvoie: headers.findIndex((h) => h.includes("typvoie")),
      voie: headers.findIndex((h) => h === "voie" || h.includes("libvoie")),
      codepostal: headers.findIndex(
        (h) => h.includes("codepostal") || h.includes("cp")
      ),
      commune: headers.findIndex(
        (h) => h.includes("libcommune") || h.includes("commune")
      ),
      departement: headers.findIndex((h) => h.includes("dep")),
      lat: headers.findIndex(
        (h) =>
          h === "lat" ||
          h === "latitude" ||
          h.includes("coordy") ||
          h.includes("y_lat")
      ),
      lon: headers.findIndex(
        (h) =>
          h === "lon" ||
          h === "longitude" ||
          h.includes("coordx") ||
          h.includes("x_lon")
      ),
      capacite: headers.findIndex(
        (h) => h.includes("capacite") || h.includes("capac")
      ),
      telephone: headers.findIndex((h) => h.includes("tel")),
      dateouv: headers.findIndex((h) => h.includes("dateouv")),
    };

    console.log("[finessProvider] Colonnes détectées:", colIndex);

    const etablissements: FinessEtablissement[] = [];

    // Parser les lignes de données
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = parseCSVLine(line);

      // Extraire les coordonnées
      const latStr = colIndex.lat >= 0 ? cols[colIndex.lat] : "";
      const lonStr = colIndex.lon >= 0 ? cols[colIndex.lon] : "";

      const lat = parseFloat(latStr?.replace(",", ".") || "");
      const lon = parseFloat(lonStr?.replace(",", ".") || "");

      // Ignorer les lignes sans coordonnées valides
      if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) {
        continue;
      }

      // Construire l'adresse
      const numVoie = colIndex.numvoie >= 0 ? cols[colIndex.numvoie] || "" : "";
      const typVoie = colIndex.typvoie >= 0 ? cols[colIndex.typvoie] || "" : "";
      const voie = colIndex.voie >= 0 ? cols[colIndex.voie] || "" : "";
      const address = [numVoie, typVoie, voie].filter(Boolean).join(" ").trim();

      const etablissement: FinessEtablissement = {
        finess: colIndex.nofinesset >= 0 ? cols[colIndex.nofinesset] || "" : "",
        finessEj: colIndex.nofinessej >= 0 ? cols[colIndex.nofinessej] || "" : "",
        name: colIndex.rs >= 0 ? cols[colIndex.rs] || "" : "",
        category: colIndex.categetab >= 0 ? cols[colIndex.categetab] || "" : "",
        categoryLabel:
          colIndex.libcategetab >= 0 ? cols[colIndex.libcategetab] || "" : "",
        address,
        postalCode:
          colIndex.codepostal >= 0 ? cols[colIndex.codepostal] || "" : "",
        commune: colIndex.commune >= 0 ? cols[colIndex.commune] || "" : "",
        departement:
          colIndex.departement >= 0 ? cols[colIndex.departement] || "" : "",
        lat,
        lon,
        capacity: parseInt(cols[colIndex.capacite] || "0", 10) || 0,
        telephone:
          colIndex.telephone >= 0 ? cols[colIndex.telephone] || undefined : undefined,
        dateOuverture:
          colIndex.dateouv >= 0 ? cols[colIndex.dateouv] || undefined : undefined,
      };

      etablissements.push(etablissement);
    }

    console.log(
      `[finessProvider] ${etablissements.length} établissements chargés avec coordonnées`
    );

    // Mettre en cache
    finessCache = etablissements;
    lastCacheUpdate = new Date();

    return etablissements;
  } catch (error) {
    console.error("[finessProvider] Erreur lors du chargement FINESS:", error);
    throw error;
  }
}

/**
 * Récupère les établissements FINESS dans un rayon donné
 */
export async function fetchFinessData(
  params: FinessProviderParams
): Promise<CompetitionData | null> {
  const { lat, lon, radiusKm, categories = DEFAULT_EHPAD_CATEGORIES } = params;

  try {
    const allEtablissements = await loadFinessData();

    // Filtrer par catégorie et distance
    const filtered = allEtablissements
      .filter((etab) => categories.includes(etab.category))
      .map((etab) => ({
        ...etab,
        distance: haversineDistance(lat, lon, etab.lat, etab.lon),
      }))
      .filter((etab) => etab.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance);

    console.log(
      `[finessProvider] ${filtered.length} établissements trouvés dans un rayon de ${radiusKm}km`
    );

    // Calculer les statistiques
    const totalCapacity = filtered.reduce((sum, e) => sum + (e.capacity || 0), 0);
    const avgCapacity =
      filtered.length > 0 ? Math.round(totalCapacity / filtered.length) : 0;

    // Transformer en CompetitionData
    const competitionData: CompetitionData = {
      count: filtered.length,
      totalCapacity,
      avgCapacity,
      nearestDistance: filtered.length > 0 ? filtered[0].distance : null,
      competitors: filtered.map((etab) => ({
        id: etab.finess,
        name: etab.name,
        type: etab.categoryLabel || getCategoryLabel(etab.category),
        address: `${etab.address}, ${etab.postalCode} ${etab.commune}`,
        lat: etab.lat,
        lon: etab.lon,
        capacity: etab.capacity,
        distance: Math.round(etab.distance * 100) / 100, // Arrondir à 2 décimales
        finess: etab.finess,
      })),
    };

    return competitionData;
  } catch (error) {
    console.error("[finessProvider] Erreur:", error);
    return null;
  }
}

/**
 * Récupère les EHPAD dans un rayon (fonction utilitaire)
 */
export async function fetchEhpadInRadius(
  lat: number,
  lon: number,
  radiusKm: number
): Promise<FinessEtablissement[]> {
  try {
    const allEtablissements = await loadFinessData();

    return allEtablissements
      .filter((etab) => DEFAULT_EHPAD_CATEGORIES.includes(etab.category))
      .map((etab) => ({
        ...etab,
        distance: haversineDistance(lat, lon, etab.lat, etab.lon),
      }))
      .filter((etab) => etab.distance! <= radiusKm)
      .sort((a, b) => a.distance! - b.distance!);
  } catch (error) {
    console.error("[finessProvider] fetchEhpadInRadius - Erreur:", error);
    return [];
  }
}

/**
 * Récupère les détails d'un établissement FINESS par son numéro
 */
export async function fetchFinessDetails(
  finessId: string
): Promise<FinessEtablissement | null> {
  try {
    const allEtablissements = await loadFinessData();
    return allEtablissements.find((e) => e.finess === finessId) || null;
  } catch (error) {
    console.error("[finessProvider] fetchFinessDetails - Erreur:", error);
    return null;
  }
}

/**
 * Retourne le libellé d'une catégorie FINESS
 */
function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    "500": "EHPAD",
    "501": "EHPA (crédits AM)",
    "502": "EHPA (sans crédits AM)",
    "202": "Résidence Autonomie",
    "354": "SSIAD",
    "207": "Accueil de Jour",
  };
  return labels[category] || `Catégorie ${category}`;
}

/**
 * Invalide le cache FINESS (utile pour forcer un rechargement)
 */
export function invalidateFinessCache(): void {
  finessCache = null;
  lastCacheUpdate = null;
  console.log("[finessProvider] Cache invalidé");
}