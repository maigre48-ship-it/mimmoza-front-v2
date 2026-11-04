// src/lib/cartes/couchesIgn.ts
//
// Couches IGN de la Géoplateforme utilisées par les cartes de parcelle (LOT 1,
// 04/11/2026) : fonds « Plan » et « Satellite », couche « Cadastre ».
//
// Toutes les couches viennent du service WMTS public data.geopf.fr (sans clé).
// Ne jamais utiliser wxs.ign.fr (fermé).
//
// Couches vérifiées dans le GetCapabilities du 04/11/2026 :
//   - ORTHOIMAGERY.ORTHOPHOTOS             style normal       image/jpeg  PM_0_19
//   - CADASTRALPARCELS.PARCELLAIRE_EXPRESS style « PCI vecteur » image/png PM_0_19
//   - GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2    (fondPlanIgn.ts, en production)
//
// TILEMATRIXSET : on garde « PM » (alias Web Mercator accepté par la
// Géoplateforme), comme le Plan IGN déjà en production. Une seule constante à
// changer (TILEMATRIXSET_IGN) si un jour l'alias n'était plus servi.
//
// Ortho très haute résolution (THR.ORTHOIMAGERY.ORTHOPHOTOS, zooms 6–21) non
// retenue : couverture partielle du territoire (tuiles vides hors zones
// couvertes). On sert l'ortho classique jusqu'au zoom 19 et Leaflet agrandit
// les tuiles jusqu'au zoom 21.
//
// Fichier de logique pure (testé par node --test) : aucun import de Leaflet.

import {
  FOND_PLAN_IGN_URL,
  FOND_PLAN_IGN_ZOOM_NATIF_MAX,
} from "./fondPlanIgn.ts";

/** Point d'entrée WMTS de la Géoplateforme. */
export const GEOPF_WMTS = "https://data.geopf.fr/wmts";

/** Jeu de tuiles Web Mercator (alias accepté, identique au Plan en production). */
export const TILEMATRIXSET_IGN = "PM";

export type FormatTuile = "image/png" | "image/jpeg";

export type DefinitionCoucheWmts = {
  /** Identifiant de couche du GetCapabilities. */
  couche: string;
  /** Style WMTS (encodé dans l'URL). */
  style: string;
  format: FormatTuile;
};

export const COUCHE_SATELLITE_IGN: DefinitionCoucheWmts = {
  couche: "ORTHOIMAGERY.ORTHOPHOTOS",
  style: "normal",
  format: "image/jpeg",
};

export const COUCHE_CADASTRE_IGN: DefinitionCoucheWmts = {
  couche: "CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
  // Style « PCI vecteur » : traits noirs fins, fond transparent — lisible sur
  // la photo aérienne comme sur le plan.
  style: "PCI vecteur",
  format: "image/png",
};

/**
 * Construit l'URL de tuiles au format XYZ ({z}/{x}/{y}) attendu par Leaflet
 * (L.tileLayer / <TileLayer>) à partir d'une couche WMTS de la Géoplateforme.
 */
export function urlTuilesWmtsIgn(
  def: DefinitionCoucheWmts,
  tileMatrixSet: string = TILEMATRIXSET_IGN,
): string {
  if (!def.couche.trim()) throw new Error("Couche WMTS IGN vide");
  return (
    `${GEOPF_WMTS}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
    `&LAYER=${encodeURIComponent(def.couche)}` +
    `&STYLE=${encodeURIComponent(def.style)}` +
    `&TILEMATRIXSET=${encodeURIComponent(tileMatrixSet)}` +
    `&FORMAT=${def.format}` +
    "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
  );
}

/** Fond satellite (orthophotographies IGN). */
export const FOND_SATELLITE_IGN_URL = urlTuilesWmtsIgn(COUCHE_SATELLITE_IGN);

/** Couche cadastre (Parcellaire Express, style PCI vecteur, PNG transparent). */
export const COUCHE_CADASTRE_IGN_URL = urlTuilesWmtsIgn(COUCHE_CADASTRE_IGN);

/** Fond plan : réexporté depuis fondPlanIgn.ts (inchangé). */
export const FOND_PLAN_URL = FOND_PLAN_IGN_URL;

/**
 * Attribution unique pour les trois couches : Leaflet n'affiche qu'une fois
 * une attribution identique, même si plusieurs couches la déclarent.
 */
export const ATTRIBUTION_IGN =
  '&copy; <a href="https://www.ign.fr/" target="_blank" rel="noopener noreferrer">IGN</a> – Géoplateforme';

/** Attribution texte (contextes sans HTML). */
export const ATTRIBUTION_IGN_TEXTE = "© IGN – Géoplateforme";

// ── Zooms ────────────────────────────────────────────────────────────────────

/** Dernier zoom servi par l'ortho IGN (PM_0_19). */
export const ZOOM_NATIF_MAX_SATELLITE = 19;
/** Dernier zoom servi par le Parcellaire Express (PM_0_19). */
export const ZOOM_NATIF_MAX_CADASTRE = 19;
/** Dernier zoom servi par le Plan IGN v2. */
export const ZOOM_NATIF_MAX_PLAN = FOND_PLAN_IGN_ZOOM_NATIF_MAX;
/** Zoom maximal autorisé sur les cartes (agrandissement des tuiles 19 → 21). */
export const ZOOM_MAX_CARTE_IGN = 21;
/** Zoom maximal d'un recadrage automatique sur une parcelle (image nette). */
export const ZOOM_MAX_RECADRAGE = 19;

// ── Fonds, contextes et préférences par défaut ───────────────────────────────

export type FondCarte = "satellite" | "plan";

/**
 * Contexte d'une carte :
 *  - « parcelle »   : cartes de recherche / sélection / dossier de parcelle ;
 *  - « thematique » : cartes de risques et d'urbanisme (couches WMS colorées).
 */
export type ContexteCarte = "parcelle" | "thematique";

export type PreferencesCouches = {
  fond: FondCarte;
  cadastre: boolean;
  /** Opacité de la couche cadastre, entre OPACITE_CADASTRE_MIN et 1. */
  opaciteCadastre: number;
};

export const OPACITE_CADASTRE_DEFAUT = 0.8;
export const OPACITE_CADASTRE_MIN = 0.2;
export const OPACITE_CADASTRE_MAX = 1;
export const OPACITE_CADASTRE_PAS = 0.05;

/**
 * Choix par défaut :
 *  - cartes de parcelle : Satellite + Cadastre (on voit le terrain réel et ses
 *    limites, c'est l'usage du promoteur / marchand de biens) ;
 *  - cartes thématiques : Plan sans cadastre (les aplats colorés Géorisques /
 *    GPU se lisent mal sur la photo aérienne) ; le satellite reste à un clic.
 */
export const PREFERENCES_PAR_DEFAUT: Readonly<Record<ContexteCarte, Readonly<PreferencesCouches>>> = {
  parcelle: { fond: "satellite", cadastre: true, opaciteCadastre: OPACITE_CADASTRE_DEFAUT },
  thematique: { fond: "plan", cadastre: false, opaciteCadastre: OPACITE_CADASTRE_DEFAUT },
};

export const LIBELLES_FOND: Readonly<Record<FondCarte, string>> = {
  satellite: "Satellite",
  plan: "Plan",
};
