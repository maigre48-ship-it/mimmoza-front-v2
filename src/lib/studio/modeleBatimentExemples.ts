// src/lib/studio/modeleBatimentExemples.ts — VIS-25 lot A : quatre modèles RÉELS au format ModeleBatiment v1.
// COPIE À L'IDENTIQUE dans mimmozia-studio/src/core/echange/modeleBatimentExemples.ts.
// Servent aux tests (front : modeleBatiment.test.ts ; Studio : tests/modeleBatiment*.test.ts) et d'exemples
// (« few-shot ») pour l'outil du chat (lot B). Ce sont des objets BRUTS : ils passent par validerModele.
// Repère : x vers la droite vu de la rue, y vers le fond du terrain, z vers le haut (mètres).

/** « Une maison basque R+1 avec garage accolé à gauche, colombages rouges, balcon en bois, cheminée. » */
export const EXEMPLE_MAISON_BASQUE = {
  v: 1, origine: 'texte', nom: 'Maison basque', type: 'maison', style: 'basque',
  matieres: {
    murs: { refStudio: 'av-enduit-blanc', couleur: '#f4f1ea', famille: 'enduit' },
    toiture: { couleur: '#a4532e', famille: 'tuile' },
    boiseries: { couleur: '#8b1e1e', famille: 'bois' },
    volets: { couleur: '#8b1e1e', famille: 'bois' },
    menuiseries: { couleur: '#f4f4f2', famille: 'bois' },
    soubassement: { refStudio: 'av-pierre-calcaire', famille: 'pierre' },
  },
  volumes: [
    {
      id: 'principal', nom: 'Corps principal', role: 'principal', plan: { type: 'rectangle', largeur: 12, profondeur: 10 },
      position: { x: 0, y: 0 }, niveaux: 2, hauteurEtage: 2.7, soubassement: 0.5,
      toit: { forme: 'deux_pans', pente: 30, debord: 0.8, faitage: 'profondeur' },
    },
    {
      id: 'garage', nom: 'Garage', role: 'garage', plan: { type: 'rectangle', largeur: 6, profondeur: 7 },
      position: { x: -9, y: -1.5 }, niveaux: 1, hauteurEtage: 2.8,
      toit: { forme: 'un_pan', pente: 15, debord: 0.4, basVers: 'gauche' },
    },
  ],
  ouvertures: [
    { id: 'porte', volume: 'principal', facade: 'avant', niveau: 0, type: 'porte', largeur: 1.1, position: 6 },
    { id: 'fen-av-0', volume: 'principal', facade: 'avant', niveau: 0, type: 'fenetre', nombre: 2, entraxe: 7, volets: 'battants' },
    { id: 'fen-av-1', volume: 'principal', facade: 'avant', niveau: 1, type: 'fenetre', nombre: 3, entraxe: 3.5, volets: 'battants' },
    { id: 'pf-ar-0', volume: 'principal', facade: 'arriere', niveau: 0, type: 'porte_fenetre', nombre: 2, entraxe: 4, volets: 'battants' },
    { id: 'fen-ar-1', volume: 'principal', facade: 'arriere', niveau: 1, type: 'fenetre', nombre: 3, entraxe: 3.5, volets: 'battants' },
    { id: 'fen-dr-1', volume: 'principal', facade: 'droite', niveau: 1, type: 'fenetre', nombre: 2, entraxe: 4 },
    { id: 'garage-porte', volume: 'garage', facade: 'avant', niveau: 0, type: 'porte_garage', largeur: 2.6 },
  ],
  elements: [
    { id: 'colombages', type: 'colombages', volume: 'principal', facade: 'avant', niveau: 1 },
    { id: 'balcon', type: 'balcon', volume: 'principal', facade: 'avant', niveau: 1, largeur: 4.5, profondeur: 1, parametres: { gardeCorps: 'bois' }, matiere: { couleur: '#8b1e1e', famille: 'bois' } },
    { id: 'cheminee', type: 'cheminee', volume: 'principal', point: { x: 3, y: 2, z: 0 } },
    { id: 'volets', type: 'volets', volume: 'principal', parametres: { type: 'battants' } },
  ],
};

/** « Une villa contemporaine en L, toit-terrasse, grandes baies sur le jardin et une pergola dans l'angle. » */
export const EXEMPLE_VILLA_L = {
  v: 1, origine: 'texte', nom: 'Villa contemporaine', type: 'maison', style: 'contemporain',
  matieres: {
    murs: { refStudio: 'av-enduit-blanc', famille: 'enduit' },
    menuiseries: { couleur: '#383e42', famille: 'metal' },
  },
  volumes: [
    {
      id: 'villa', nom: 'Villa', role: 'principal',
      plan: { type: 'L', largeur: 18, profondeur: 14, epaisseurX: 7, epaisseurY: 7, coinVide: 'arriere_droit' },
      position: { x: 0, y: 0 }, niveaux: 1, hauteurEtage: 3.2,
      toit: { forme: 'terrasse', acrotere: 0.4 },
      matieres: { soubassement: { refStudio: 'av-bardage-bois-noirci', famille: 'bois' } },
    },
  ],
  ouvertures: [
    { id: 'entree', volume: 'villa', facade: 'avant', niveau: 0, type: 'porte', largeur: 1.2, position: 4 },
    { id: 'bandeau-avant', volume: 'villa', facade: 'avant', niveau: 0, type: 'fenetre', largeur: 3, hauteur: 0.8, allege: 1.6, nombre: 2, entraxe: 5, position: 12.5 },
    { id: 'baies-jardin', volume: 'villa', facade: 'arriere', niveau: 0, type: 'baie', largeur: 3, hauteur: 2.5, nombre: 3, entraxe: 3.4 },
    { id: 'baie-aile', volume: 'villa', facade: 3, niveau: 0, type: 'baie', largeur: 4, hauteur: 2.5 },
  ],
  elements: [
    {
      id: 'pergola', type: 'pergola', nom: 'Pergola bois', volume: 'villa',
      matiere: { refStudio: 'av-bardage-bois-brun', famille: 'bois' },
      briques: [
        { forme: 'poteau', x: 0.2, y: 0.2, z: 0, largeur: 0.15, hauteur: 2.6 },
        { forme: 'poteau', x: 4.8, y: 0.2, z: 0, largeur: 0.15, hauteur: 2.6 },
        { forme: 'poteau', x: 0.2, y: 3.8, z: 0, largeur: 0.15, hauteur: 2.6 },
        { forme: 'poteau', x: 4.8, y: 3.8, z: 0, largeur: 0.15, hauteur: 2.6 },
        { forme: 'boite', x: 2.5, y: 0.2, z: 2.6, largeur: 5, profondeur: 0.15, hauteur: 0.2 },
        { forme: 'boite', x: 2.5, y: 3.8, z: 2.6, largeur: 5, profondeur: 0.15, hauteur: 0.2 },
        { forme: 'plaque', x: 1, y: 2, z: 2.8, largeur: 0.08, profondeur: 4, hauteur: 0.12 },
        { forme: 'plaque', x: 2, y: 2, z: 2.8, largeur: 0.08, profondeur: 4, hauteur: 0.12 },
        { forme: 'plaque', x: 3, y: 2, z: 2.8, largeur: 0.08, profondeur: 4, hauteur: 0.12 },
        { forme: 'plaque', x: 4, y: 2, z: 2.8, largeur: 0.08, profondeur: 4, hauteur: 0.12 },
      ],
    },
    { id: 'garde-corps-toit', type: 'garde_corps', volume: 'villa', facade: 'avant', parametres: { gardeCorps: 'verre' } },
  ],
};

/** « Une maison bourgeoise R+1 en pierre, toit à quatre pans en ardoise, avec une tourelle ronde à toit conique. » */
export const EXEMPLE_MAISON_TOURELLE = {
  v: 1, origine: 'texte', nom: 'Maison à tourelle', type: 'maison', style: 'autre', styleLibre: 'maison bourgeoise',
  matieres: {
    murs: { refStudio: 'av-pierre-calcaire', famille: 'pierre' },
    toiture: { couleur: '#3c4148', famille: 'ardoise' },
    menuiseries: { couleur: '#f4f4f2', famille: 'bois' },
  },
  volumes: [
    {
      id: 'maison', nom: 'Maison', role: 'principal', plan: { type: 'rectangle', largeur: 11, profondeur: 9 },
      position: { x: 0, y: 0 }, niveaux: 2, hauteurEtage: 2.8, toit: { forme: 'quatre_pans', pente: 40, debord: 0.5 },
    },
    {
      id: 'tourelle', nom: 'Tourelle', role: 'tourelle', plan: { type: 'cercle', rayon: 1.8 },
      position: { x: -5.5, y: -4.5 }, niveaux: 3, hauteur: 7.8, toit: { forme: 'conique', pente: 65, debord: 0.2 },
    },
  ],
  ouvertures: [
    { id: 'porte', volume: 'maison', facade: 'avant', niveau: 0, type: 'porte', largeur: 1.2, hauteur: 2.3 },
    { id: 'fen-0', volume: 'maison', facade: 'avant', niveau: 0, type: 'fenetre', largeur: 1.1, hauteur: 1.6, nombre: 2, entraxe: 6 },
    { id: 'fen-1', volume: 'maison', facade: 'avant', niveau: 1, type: 'fenetre', largeur: 1.1, hauteur: 1.5, nombre: 3, entraxe: 3 },
    { id: 'lucarnes', volume: 'maison', facade: 'avant', type: 'lucarne', nombre: 2, entraxe: 4 },
    { id: 'tour-fen', volume: 'tourelle', facade: 'avant', niveau: 1, type: 'fenetre', largeur: 0.5, hauteur: 1.2 },
    { id: 'tour-oeil', volume: 'tourelle', facade: 'avant', niveau: 2, type: 'oeil_de_boeuf', largeur: 0.4, hauteur: 0.4, allege: 1.2 },
  ],
  elements: [
    { id: 'corniche', type: 'corniche', volume: 'maison' },
    { id: 'bandeau', type: 'bandeau', volume: 'maison', niveau: 1 },
    { id: 'cheminee', type: 'cheminee', volume: 'maison', point: { x: 3.5, y: 1, z: 0 } },
  ],
};

/** « Un petit collectif R+2 en U autour d'une cour ouverte sur le jardin, toit-terrasse, balcons sur rue. » */
export const EXEMPLE_COLLECTIF_U = {
  v: 1, origine: 'texte', nom: 'Résidence en U', type: 'collectif', style: 'contemporain',
  matieres: {
    murs: { refStudio: 'av-enduit-blanc', famille: 'enduit' },
    soubassement: { refStudio: 'av-beton-brut', famille: 'beton' },
    menuiseries: { couleur: '#383e42', famille: 'metal' },
    garde_corps: { couleur: '#383e42', famille: 'metal' },
  },
  volumes: [
    {
      id: 'u', nom: 'Bâtiment en U', role: 'principal',
      // U ouvert vers le fond (y croissant) : barre sur rue de 24 m, deux ailes de 7 m d'épaisseur.
      plan: { type: 'polygone', points: [[-12, -9], [12, -9], [12, 9], [5, 9], [5, -2], [-5, -2], [-5, 9], [-12, 9]] },
      position: { x: 0, y: 0 }, niveaux: 3, hauteurEtage: 2.9, soubassement: 0.4,
      toit: { forme: 'terrasse', acrotere: 0.6 },
    },
  ],
  ouvertures: [
    { id: 'hall', volume: 'u', facade: 'avant', niveau: 0, type: 'porte', largeur: 1.6, hauteur: 2.4 },
    { id: 'rue-0', volume: 'u', facade: 'avant', niveau: 0, type: 'fenetre', nombre: 3, entraxe: 3.2, position: 5.5 },
    { id: 'rue-0b', volume: 'u', facade: 'avant', niveau: 0, type: 'fenetre', nombre: 3, entraxe: 3.2, position: 18.5 },
    { id: 'rue-1', volume: 'u', facade: 'avant', niveau: 1, type: 'porte_fenetre', nombre: 6, entraxe: 3.6 },
    { id: 'rue-2', volume: 'u', facade: 'avant', niveau: 2, type: 'porte_fenetre', nombre: 6, entraxe: 3.6 },
    { id: 'cour-0', volume: 'u', facade: 4, niveau: 0, type: 'baie', nombre: 2, entraxe: 4.5 },
    { id: 'cour-1', volume: 'u', facade: 4, niveau: 1, type: 'baie', nombre: 2, entraxe: 4.5 },
    { id: 'cour-2', volume: 'u', facade: 4, niveau: 2, type: 'baie', nombre: 2, entraxe: 4.5 },
    { id: 'gauche-1', volume: 'u', facade: 'gauche', niveau: 1, type: 'fenetre', nombre: 4, entraxe: 4 },
    { id: 'droite-1', volume: 'u', facade: 'droite', niveau: 1, type: 'fenetre', nombre: 4, entraxe: 4 },
  ],
  elements: [
    { id: 'balcon-1', type: 'balcon', volume: 'u', facade: 'avant', niveau: 1, largeur: 20, profondeur: 1.4, parametres: { gardeCorps: 'metal' } },
    { id: 'balcon-2', type: 'balcon', volume: 'u', facade: 'avant', niveau: 2, largeur: 20, profondeur: 1.4, parametres: { gardeCorps: 'metal' } },
    { id: 'auvent', type: 'auvent', volume: 'u', facade: 'avant', niveau: 0, largeur: 3, profondeur: 1.2 },
  ],
};

export const EXEMPLES_MODELE = {
  maison_basque: EXEMPLE_MAISON_BASQUE,
  villa_l: EXEMPLE_VILLA_L,
  maison_tourelle: EXEMPLE_MAISON_TOURELLE,
  collectif_u: EXEMPLE_COLLECTIF_U,
} as const;
