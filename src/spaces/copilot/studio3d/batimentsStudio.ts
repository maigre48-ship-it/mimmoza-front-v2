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
// LOT FORMES-BATIMENT — BÂTIMENTS À AILES (en L, en U, cour fermée, redans ; formesBatiment.ts).
// Chaque aile part dans `ailes` du contrat v2 (AileV2) : rectangle SANS recouvrement, centre (x, y)
// dans le repère du bâtiment AU SENS DU CONTRAT (x le long de largeurM, y = −v du Dossier 3D : le
// contrat a ses y vers le sud quand la rotation est nulle, le Dossier 3D ses v vers le nord), largeurM
// le long de x, profondeurM le long de y, niveaux propres, niveauDepart 0, retraitM calculé comme le
// Studio le relit (projetStudio.ailesDe). largeurM / profondeurM / centre / rotation du bâtiment sont
// ceux de l'ENVELOPPE ; `emprise` est le contour RÉEL (réunion des ailes, cours non comprises).
// Côté Studio : requeteDepuisBatiment → archétype multi_wing (une aile = une MultiWingSpec), contrôlé
// aile par aile par le worker (worker/src/batimentsScene.ts). Un bâtiment à ailes part par `batiments`
// même seul (transportParBatiments).
//
// La liste voyage avec le terrain confirmé (`volumeBatiments`) jusqu'à
// preparerChargeVoirEn3D, qui ne l'emploie que pour la fiche dont elle est issue
// (signatureFiche) : rouvrir « Voir en 3D » depuis une autre fiche ne renvoie pas
// d'anciens bâtiments.

import type { AileV2, BatimentV2 } from '../../promoteur/shared/echangeStudio/mimmozaProjetV2.ts';
import { versWgs84, volumeParBatiments, type BatimentPropose, type VolumePropose } from './volumeParcelle.ts';
import { LIMITE_BATIMENTS_STUDIO } from './implantationProgramme.ts';
import { signatureFiche, type VolumeBatimentsStudio } from './projetChat.ts';
import { contourRects, versLocal } from './formesBatiment.ts';

export { signatureFiche, type VolumeBatimentsStudio };

/** Rotation au sens du contrat v2 depuis l'angle trigonométrique du plan : −angle, ramenée dans ]−180, 180]. */
export function rotationContrat(angleDeg: number): number {
  let o = ((-angleDeg % 360) + 540) % 360 - 180;
  if (o === -180) o = 180;
  return Math.round(o * 10) / 10 || 0;
}

const r9 = (v: number) => Math.round(v * 1e9) / 1e9;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Lot formes-batiment : ailes du bâtiment au sens du contrat v2 (voir l'en-tête). */
export function ailesV2(b: Pick<BatimentPropose, 'ailes'>): AileV2[] {
  const ailes = b.ailes ?? [];
  if (ailes.length < 2) return [];
  const front = Math.min(...ailes.map(a => -a.dv - a.lv / 2));
  return ailes.slice(0, 12).map(a => ({
    nom: a.nom.slice(0, 80), largeurM: r2(a.lu), profondeurM: r2(a.lv),
    niveaux: Math.max(1, Math.min(60, Math.round(a.niveaux))), niveauDepart: 0,
    retraitM: r2(-a.dv - a.lv / 2 - front), x: r2(a.du), y: r2(-a.dv) || 0,
  }));
}

/** Bâtiments v2 du volume ; liste vide si le volume n'a ni deux bâtiments ni un bâtiment à ailes. */
export function batimentsV2DepuisVolume(v: Pick<VolumePropose, 'batiments' | 'origine'>): BatimentV2[] {
  const liste = v.batiments ?? [];
  if (!volumeParBatiments(v)) return [];
  if (liste.length > LIMITE_BATIMENTS_STUDIO) throw new Error(`${liste.length} bâtiments : Studio en accepte ${LIMITE_BATIMENTS_STUDIO} au plus.`);
  return liste.map(b => {
    const ailes = ailesV2(b);
    const enWgs = (c: { x: number; y: number }) => { const g = versWgs84(c, v.origine); return [r9(g.lon), r9(g.lat)]; };
    const anneau = b.coins.map(enWgs);
    // Emprise : contour réel des ailes (boucles extérieures ; la cour n'est pas bâtie), sinon le rectangle.
    const emprise = ailes.length >= 2
      ? contourRects(b.ailes!).filter(l => l.reduce((s, p, k) => { const n = l[(k + 1) % l.length]; return s + p.u * n.v - n.u * p.v; }, 0) > 0)
        .map(l => { const r = l.map(q => enWgs(versLocal(b.centre, b.angleDeg, q))); return [...r, r[0]]; })
      : [[...anneau, anneau[0]]];
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
      ailes,
      emprise,
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
