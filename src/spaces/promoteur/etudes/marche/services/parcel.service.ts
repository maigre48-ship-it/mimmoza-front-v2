/**
 * Service de recherche de parcelles cadastrales
 * Utilise l'API cadastre.data.gouv.fr
 */

import type { ParcelInfo } from "../types/market.types";

/**
 * Recherche d'une parcelle cadastrale via l'API Cadastre
 * @param parcelId - Identifiant de la parcelle (ex: 64065000AI0001)
 * @returns Informations sur la parcelle ou null si non trouvée
 */
export async function searchParcel(parcelId: string): Promise<ParcelInfo | null> {
  if (!parcelId || parcelId.length < 10) return null;
  
  const cleanId = parcelId.replace(/[-\s]/g, "").toUpperCase();
  const communeInsee = cleanId.slice(0, 5);
  const section = cleanId.slice(8, 10);
  const numero = cleanId.slice(10);

  try {
    const response = await fetch(
      `https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/${communeInsee}/geojson/parcelles`
    );
    
    if (!response.ok) {
      return { id: cleanId, commune_insee: communeInsee, section, numero };
    }
    
    const data = await response.json();
    const parcel = data.features?.find((f: any) => {
      const props = f.properties;
      return props.commune === communeInsee && props.section === section && props.numero === numero;
    });

    if (parcel) {
      const coords = parcel.geometry.coordinates[0][0];
      const centroid = coords.reduce(
        (acc: [number, number], c: [number, number]) => [acc[0] + c[0], acc[1] + c[1]],
        [0, 0]
      );
      return {
        id: cleanId,
        commune_insee: communeInsee,
        section,
        numero,
        surface: parcel.properties.contenance,
        lat: centroid[1] / coords.length,
        lon: centroid[0] / coords.length,
      };
    }
    
    return { id: cleanId, commune_insee: communeInsee, section, numero };
  } catch (error) {
    console.error("Erreur recherche parcelle:", error);
    return { id: cleanId, commune_insee: communeInsee, section, numero };
  }
}