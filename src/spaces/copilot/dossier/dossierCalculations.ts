import type { DossierParcel, ParcelDossier } from './parcelDossier';

export interface TaxScenario {
  surfaceM2: number;
  cadastralRent: number;
  taxableBase: number;
  builtTax: number;
}

export function selectedArea(parcels: DossierParcel[]): number | null {
  if (!parcels.length || parcels.some((parcel) => parcel.areaM2 === null)) return null;
  return parcels.reduce((sum, parcel) => sum + (parcel.areaM2 ?? 0), 0);
}

/** Simulation pédagogique : la surface bâtie n'est pas la surface pondérée fiscale. */
export function taxScenarios(surfaceM2: number | null, rentPerM2: number, taxRate: number | null): TaxScenario[] {
  if (taxRate === null || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) return [];
  if (!Number.isFinite(rentPerM2) || rentPerM2 <= 0) return [];
  const surfaces = surfaceM2 && Number.isFinite(surfaceM2) && surfaceM2 > 0
    ? [surfaceM2 * 0.8, surfaceM2, surfaceM2 * 1.2]
    : [80, 120, 160];
  return surfaces.map((surface) => {
    const rounded = Math.round(surface);
    const cadastralRent = rounded * rentPerM2;
    const taxableBase = cadastralRent * 0.5;
    return { surfaceM2: rounded, cadastralRent, taxableBase, builtTax: taxableBase * taxRate / 100 };
  });
}

export function decisionStatus(dossier: ParcelDossier, selected: DossierParcel[]): {
  label: string; detail: string; level: 'pending' | 'attention' | 'ready';
} {
  if (!selected.length) return {
    label: 'Périmètre à confirmer', level: 'pending',
    detail: dossier.detectedParcel
      ? 'La parcelle repérée au point ne définit pas toute la propriété. Sélectionnez les parcelles du projet sur la carte.'
      : 'Aucune parcelle n’a été résolue au point de recherche. Vérifiez l’adresse et sélectionnez les parcelles qui composent le projet sur la carte.',
  };
  if (!dossier.zone) return {
    label: 'Zonage à vérifier', level: 'attention',
    detail: 'Le zonage au point n’a pas été obtenu. Il faut le vérifier sur chaque parcelle sélectionnée avant de chiffrer un projet.',
  };
  if (dossier.prescriptions.some((value) => /inond|ppri/i.test(value)) || dossier.servitudes.some((value) => /ppri/i.test(value))) return {
    label: 'Contrainte d’inondation à instruire', level: 'attention',
    detail: 'Une prescription ou servitude liée à l’inondation recouvre le point. Lire le plan et le règlement PPRI sur les parcelles du projet.',
  };
  return {
    label: 'Analyse à compléter', level: 'pending',
    detail: 'Le périmètre est choisi ; les règles écrites et les pièces du bien restent nécessaires avant de conclure sur la faisabilité.',
  };
}
