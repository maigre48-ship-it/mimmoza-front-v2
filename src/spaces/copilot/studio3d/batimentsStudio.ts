// src/spaces/copilot/studio3d/batimentsStudio.ts
//
// BÂTIMENTS DU DOSSIER 3D → PROJET `mimmoza-projet-v2` — logique PURE (testée par node --test).
//
// Quand le volume d'étude compte PLUSIEURS bâtiments (implantationProgramme.ts),
// chacun part à Studio dans `batiments` du contrat v2 (BatimentV2) avec :
//   - centre géoréférencé (WGS 84) et emprise (anneau [lon, lat] fermé) ;
//   - rotation au sens du contrat (« x = est, y = sud », sens x → y, 0° = largeur à
//     l'est) : rotationDeg = −angleDeg, la même conversion que implantationDepuisVolume
//     (confirmationRapide.ts), vérifiée sur le plan axonométrique ;
//   - largeur (grand côté), profondeur, niveaux (R+N → N+1), hauteur estimée ;
//   - nature « estime » (volume d'étude, jamais « modélisé ») ;
//   - identifiant stable « mz-vol-<n> » (refs.front), sans référence Studio.
// Studio crée et place ces bâtiments (echangeMimmoza.appliquer → planImport → placer).
// Un bâtiment unique garde le chemin historique (commande + extensionsV1.implantation).
//
// La liste voyage avec le terrain confirmé (`volumeBatiments`) jusqu'à
// preparerChargeVoirEn3D, qui ne l'emploie que pour la fiche dont elle est issue
// (signatureFiche) : rouvrir « Voir en 3D » depuis une autre fiche ne renvoie pas
// d'anciens bâtiments.

import type { BatimentV2 } from '../../promoteur/shared/echangeStudio/mimmozaProjetV2.ts';
import { versWgs84, type VolumePropose } from './volumeParcelle.ts';
import { LIMITE_BATIMENTS_STUDIO } from './implantationProgramme.ts';
import { signatureFiche, type VolumeBatimentsStudio } from './projetChat.ts';

export { signatureFiche, type VolumeBatimentsStudio };

/** Rotation au sens du contrat v2 depuis l'angle trigonométrique du plan : −angle, ramenée dans ]−180, 180]. */
export function rotationContrat(angleDeg: number): number {
  let o = ((-angleDeg % 360) + 540) % 360 - 180;
  if (o === -180) o = 180;
  return Math.round(o * 10) / 10 || 0;
}

const r9 = (v: number) => Math.round(v * 1e9) / 1e9;

/** Bâtiments v2 du volume ; liste vide si le volume n'a pas au moins deux bâtiments. */
export function batimentsV2DepuisVolume(v: Pick<VolumePropose, 'batiments' | 'origine'>): BatimentV2[] {
  const liste = v.batiments ?? [];
  if (liste.length < 2) return [];
  if (liste.length > LIMITE_BATIMENTS_STUDIO) throw new Error(`${liste.length} bâtiments : Studio en accepte ${LIMITE_BATIMENTS_STUDIO} au plus.`);
  return liste.map(b => {
    const anneau = b.coins.map(c => { const g = versWgs84(c, v.origine); return [r9(g.lon), r9(g.lat)]; });
    return {
      id: b.id,
      nom: b.nom.slice(0, 80),
      nature: 'estime',
      centre: { lon: r9(b.centreWgs84.lon), lat: r9(b.centreWgs84.lat) },
      rotationDeg: rotationContrat(b.angleDeg),
      largeurM: Math.round(b.largeurM * 100) / 100,
      profondeurM: Math.round(b.profondeurM * 100) / 100,
      niveaux: Math.max(1, Math.min(60, Math.round(b.niveaux))),
      hauteurM: Math.round(b.hauteurM * 100) / 100,
      // Entrée au niveau du terrain naturel sous le centre (comme entryOffsetM = 0 du bâtiment unique).
      niveauEntree: { relatifTerrainM: 0, coteM: null },
      ailes: [],
      emprise: [[...anneau, anneau[0]]],
      refs: { front: b.id, studio: null },
    };
  });
}

/** Ce que le terrain confirmé transporte jusqu'à la charge Studio ; null si un seul bâtiment. */
export function volumeBatimentsStudio(v: VolumePropose, fiche: { objectif?: string | null; dimensions?: string | null }): VolumeBatimentsStudio | null {
  const batiments = batimentsV2DepuisVolume(v);
  if (!batiments.length) return null;
  return {
    signatureFiche: signatureFiche(fiche),
    batiments,
    logementsVises: v.kpi?.unitesVisees ?? null,
    logementsModelises: v.kpi ? v.kpi.logements + v.kpi.maisons + v.kpi.lits : null,
    sdpM2: v.kpi?.sdpTotaleM2 ?? null,
  };
}
