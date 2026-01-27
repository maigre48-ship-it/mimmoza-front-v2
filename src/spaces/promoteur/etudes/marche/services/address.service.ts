/**
 * Service de recherche d'adresses
 * Utilise l'API adresse.data.gouv.fr (Base Adresse Nationale)
 */

import type { AddressSuggestion } from "../types/market.types";

/**
 * Recherche d'adresses via l'API BAN (Base Adresse Nationale)
 * @param query - Texte de recherche (minimum 3 caractères)
 * @returns Liste de suggestions d'adresses
 */
export async function searchAddress(query: string): Promise<AddressSuggestion[]> {
  if (!query || query.length < 3) return [];
  
  try {
    const response = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=5`
    );
    const data = await response.json();
    
    return (data.features || []).map((f: any) => ({
      label: f.properties.label,
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      postcode: f.properties.postcode,
      citycode: f.properties.citycode,
      city: f.properties.city,
    }));
  } catch (error) {
    console.error("Erreur recherche adresse:", error);
    return [];
  }
}