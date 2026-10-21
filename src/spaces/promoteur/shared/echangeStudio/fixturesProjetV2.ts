/**
 * L3 — projets de test du contrat `mimmoza-projet-v2` (copie identique front / Studio).
 * Plusieurs bâtiments, une forme en L (deux ailes), une rotation, des accès,
 * des règles sourcées, un contrôle, des photos et un relief.
 */
import type { ProjetMimmozaV2 } from './mimmozaProjetV2.ts';

const carre = (lon: number, lat: number, c: number): number[][] => [[lon, lat], [lon + c, lat], [lon + c, lat + c], [lon, lat + c], [lon, lat]];

export function projetTest(): ProjetMimmozaV2 {
  return {
    format: 'mimmoza-projet-v2',
    version: 2,
    projetId: 'mz-etude-0001',
    etudeId: 'etude-0001',
    revision: 3,
    parentEmpreinte: null,
    horodatage: '2026-10-14T09:00:00.000Z',
    origine: 'mimmoza-front',
    session: { id: '0f3a9c1e-2b4d-4e6f-8a1b-123456789abc', conversationId: null, retourOrigine: 'http://localhost:5173', retourUrl: 'http://localhost:5173/promoteur/implantation-2d?study=etude-0001' },
    site: {
      communeInsee: '64065',
      adresse: '12 chemin d’Éguski, Ascain',
      pointAdresse: { lon: -1.62012, lat: 43.34421 },
      parcelles: [
        { id: '64065000AI0001', geometrie: { type: 'Polygon', coordinates: [carre(-1.6205, 43.3440, 0.0008)] } },
        { id: '64065000AI0002', geometrie: { type: 'MultiPolygon', coordinates: [[carre(-1.6197, 43.3440, 0.0004)], [carre(-1.6190, 43.3440, 0.0002)]] } },
      ],
      relief: {
        nature: 'mesure', fournisseur: 'IGN_ALTI', renderBounds: [-1.621, 43.343, -1.618, 43.346], parcelBounds: [-1.6205, 43.344, -1.6188, 43.3448],
        grille: { n: 3, z: [[41.2, 41.5, 41.9], [41.4, 41.8, 42.3], [41.7, 42.1, 42.6]] }, altitudeMin: 41.2, altitudeMax: 42.6, penteMoyenne: 4.2,
      },
      reliefOmis: false,
    },
    repere: { origine: { lon: -1.6201, lat: 43.3444 }, rotationDeg: 0, echelle: 1, axes: 'x-est-y-sud' },
    batiments: [
      {
        id: 'b-A', nom: 'A', nature: 'modelise', centre: { lon: -1.62030, lat: 43.34420 }, rotationDeg: 0, largeurM: 24, profondeurM: 12, niveaux: 4, hauteurM: 12.4,
        niveauEntree: { relatifTerrainM: 0.3, coteM: 41.8 }, ailes: [], emprise: [carre(-1.6204, 43.3441, 0.0001)], refs: { front: 'bld-a1', studio: null },
      },
      {
        id: 'b-B', nom: 'B (en L)', nature: 'modelise', centre: { lon: -1.61985, lat: 43.34425 }, rotationDeg: 37.5, largeurM: 30, profondeurM: 22, niveaux: 5, hauteurM: 15.6,
        niveauEntree: { relatifTerrainM: null, coteM: null },
        ailes: [
          { nom: 'Aile rue', largeurM: 30, profondeurM: 10, niveaux: 5, niveauDepart: 0, retraitM: 0, x: 0, y: -6 },
          { nom: 'Aile jardin', largeurM: 10, profondeurM: 12, niveaux: 3, niveauDepart: 0, retraitM: 2, x: -10, y: 5 },
        ],
        emprise: [], refs: { front: 'bld-b7', studio: 'arch-b-2' },
      },
      {
        id: 'b-C', nom: 'Annexe', nature: 'estime', centre: { lon: -1.61930, lat: 43.34410 }, rotationDeg: -12.25, largeurM: 8, profondeurM: 6.5, niveaux: 1, hauteurM: null,
        niveauEntree: { relatifTerrainM: -0.5, coteM: null }, ailes: [], emprise: [], refs: { front: null, studio: 'arch-c-9' },
      },
    ],
    acces: [
      { id: 'acces-pieton-1', type: 'pieton', position: { lon: -1.62040, lat: 43.34400 }, largeurM: 1.5, nature: 'modelise' },
      { id: 'acces-vehicule-2', type: 'vehicule', position: { lon: -1.61960, lat: 43.34400 }, largeurM: 3.2, nature: 'modelise' },
    ],
    programme: { logementsVises: 12, logementsModelises: null, surfacePlancherM2: { valeur: 1180, nature: 'estime' }, brief: 'Programme : 12 logements', commandeArchitecture: null },
    photos: [
      { id: 'facade-1', nom: 'Façade rue.jpg', type: 'facade', url: 'https://abc.supabase.co/storage/v1/object/sign/studio-transfert/u1/f1.jpg?token=x', priseLe: '2026-10-01T10:00:00Z', position: { lon: -1.6202, lat: 43.3439 }, directionDeg: 12 },
      { id: 'pano-1', nom: 'Panorama', type: 'panorama', url: null, priseLe: null, position: null, directionDeg: null },
    ],
    regles: [
      {
        id: 'recul-voirie', champ: 'reculs.voirie.min_m', categorie: 'voirie', valeur: 5, unite: 'm', zone: 'UB',
        source: { documentId: 'plu-txt-0123456789abcdef', intitule: 'PLU d’Ascain', article: 'UB 6', extrait: 'Les constructions doivent être implantées à 5 m au moins de l’alignement.', page: 42, date: '2019-06-12' },
        provenance: 'document', validation: { statut: 'validee', par: 'Albé Durand', le: '2026-10-13T08:00:00Z' }, etat: 'ordinaire',
      },
      {
        id: 'recul-separative', champ: 'reculs.separatives.min_m', categorie: 'separative', valeur: 3, unite: 'm', zone: 'UB',
        source: { documentId: null, intitule: null, article: null, extrait: null, page: null, date: null }, provenance: 'ia', validation: { statut: 'non-validee', par: null, le: null }, etat: 'ordinaire',
      },
    ],
    controle: {
      calculePar: 'mimmoza-front', calculeLe: '2026-10-14T08:59:00.000Z', niveau: 'a-verifier', libelle: 'À vérifier : 1 règle non sourcée',
      lignes: [
        { batimentId: 'b-A', limiteId: 'p0-e0', categorie: 'voirie', distanceM: 6.2, minimumM: 5, verdict: 'respecte', raison: null },
        { batimentId: 'b-A', limiteId: 'p0-e1', categorie: 'separative', distanceM: 2.1, minimumM: 3, verdict: 'a-verifier', raison: 'regle-non-sourcee' },
      ],
      indicatif: true,
    },
    extensionsV1: { implantation: null, compositionArchitecture: null, volumeAiles: null },
    omissions: { validations: false, liensPhotos: false },
  };
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function aleatoire(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Projet aléatoire valide (propriété « decode(encode(x)) = x »). */
export function projetAleatoire(graine: number): ProjetMimmozaV2 {
  const r = aleatoire(graine);
  const base = projetTest();
  const n = 1 + Math.floor(r() * 6);
  const batiments = Array.from({ length: n }, (_, i) => {
    const ailes = r() < 0.4
      ? [
          { nom: `Aile ${String(i)}-1`, largeurM: 5 + r() * 40, profondeurM: 5 + r() * 15, niveaux: 3, niveauDepart: 0, retraitM: r() * 3, x: r() * 10 - 5, y: r() * 10 - 5 },
          { nom: `Aile ${String(i)}-2 « é »`, largeurM: 5 + r() * 20, profondeurM: 5 + r() * 15, niveaux: 2, niveauDepart: 1, retraitM: 0, x: r() * 10 - 5, y: r() * 10 - 5 },
        ]
      : [];
    return {
      id: `b-${String(graine)}-${String(i)}`, nom: `Bât. ${String(i)} ${'«ü»'.repeat(i % 2)}`, nature: (['mesure', 'modelise', 'estime', 'vise'] as const)[i % 4]!,
      centre: { lon: -1.62 + r() * 0.002, lat: 43.344 + r() * 0.001 }, rotationDeg: r() * 360 - 180, largeurM: 4 + r() * 60, profondeurM: 4 + r() * 25,
      niveaux: 1 + Math.floor(r() * 9), hauteurM: r() < 0.5 ? null : r() * 30, niveauEntree: { relatifTerrainM: r() < 0.5 ? null : r() * 2 - 1, coteM: null },
      ailes, emprise: [], refs: { front: r() < 0.5 ? null : `f${String(i)}`, studio: r() < 0.5 ? null : `s${String(i)}` },
    };
  });
  return { ...base, revision: Math.floor(r() * 100), batiments, programme: { ...base.programme, logementsVises: Math.floor(r() * 50) } };
}
