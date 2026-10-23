// supabase/functions/_shared/apiSources.ts
// ─────────────────────────────────────────────────────────────────────────────
// Attributions des sources de données renvoyées dans CHAQUE réponse de l'API
// publique (champ `sources`). Module PUR.
//
// Mentions vérifiées le 23/10/2026 sur les pages officielles des producteurs
// (voir docs/api/LICENCES_DONNEES.md pour le détail, les URL de preuve et les
// points « à confirmer »).
//   - Licence Ouverte 2.0 (Etalab) : mention de la source (au minimum le nom du
//     producteur) ET de la date de dernière mise à jour de l'information.
//   - ODbL 1.0 / Licence Mobilités : attribution + partage à l'identique des
//     bases de données dérivées rendues publiques.
//   - CC BY-SA 4.0 (Wikipédia) : attribution, lien vers la licence, partage à
//     l'identique, aucune restriction supplémentaire.
//   - DVF : conditions propres (art. R112 A-3 du livre des procédures fiscales)
//     relayées au client dans `conditions`.
// ─────────────────────────────────────────────────────────────────────────────

export interface AttributionSource {
  id: string;
  nom: string;
  producteur: string;
  /** Nom exact de la licence, avec sa version. */
  licence: string;
  /** URL du texte de la licence. */
  licence_url?: string;
  /** Mention d'attribution à reproduire par le client. */
  mention: string;
  /** Page officielle du jeu de données ou du service. */
  url?: string;
  /** Obligations particulières qui s'imposent au client réutilisateur. */
  conditions?: readonly string[];
}

const LO = "Licence Ouverte / Open Licence version 2.0 (Etalab)";
const LO_URL = "https://www.etalab.gouv.fr/licence-ouverte-open-licence";
const ODBL = "Open Database License (ODbL) 1.0";
const ODBL_URL = "https://opendatacommons.org/licenses/odbl/1-0/";
const MIMMOZA = "Données Mimmoza — usage selon les CGU de l'API";

const PARTAGE_ODBL =
  "Toute base de données dérivée de ces données et rendue publique doit être mise à disposition sous la même licence (partage à l'identique) ; toute œuvre produite doit porter la mention d'attribution.";

export const SOURCES = {
  dvf: {
    id: "dvf",
    nom: "Demandes de valeurs foncières (DVF) et DVF géolocalisées",
    producteur: "DGFiP (DVF) ; géolocalisation Etalab / data.gouv.fr",
    licence: LO,
    licence_url: LO_URL,
    mention: "Source : DGFiP, Demandes de valeurs foncières (DVF), géolocalisées par Etalab (data.gouv.fr) — statistiques agrégées calculées par Mimmoza",
    url: "https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres",
    conditions: [
      "Article R112 A-3 du livre des procédures fiscales : la réutilisation ne doit pas permettre la ré-identification des personnes concernées.",
      "La réutilisation ne doit pas permettre l'indexation de ces données par des moteurs de recherche externes.",
      "Mimmoza ne diffuse que des statistiques agrégées, avec secret statistique en dessous de 5 ventes.",
    ],
  },
  osm: {
    id: "osm",
    nom: "OpenStreetMap (équipements et services de proximité)",
    producteur: "Contributeurs OpenStreetMap",
    licence: ODBL,
    licence_url: ODBL_URL,
    mention: "© les contributeurs d'OpenStreetMap — données disponibles sous licence ODbL (https://www.openstreetmap.org/copyright)",
    url: "https://www.openstreetmap.org/copyright",
    conditions: [PARTAGE_ODBL],
  },
  cadastre: {
    id: "cadastre",
    nom: "Plan cadastral (API Carto IGN — module cadastre, PARCELLAIRE EXPRESS (PCI))",
    producteur: "DGFiP (plan cadastral) / IGN (diffusion)",
    licence: LO,
    licence_url: LO_URL,
    mention: "Source : DGFiP / IGN — plan cadastral PARCELLAIRE EXPRESS (PCI), API Carto",
    url: "https://apicarto.ign.fr/api/doc/cadastre",
  },
  gpu: {
    id: "gpu",
    nom: "Géoportail de l'urbanisme — documents d'urbanisme et servitudes d'utilité publique (API Carto IGN — module GPU)",
    producteur: "Autorités compétentes en urbanisme et gestionnaires de servitudes ; diffusion IGN",
    licence: LO,
    licence_url: LO_URL,
    mention: "Source : Géoportail de l'urbanisme (données publiées par les autorités compétentes), diffusion IGN — API Carto",
    url: "https://www.geoportail-urbanisme.gouv.fr/cgu/",
  },
  plu_mimmoza: {
    id: "plu_mimmoza",
    nom: "Règlements de PLU structurés",
    producteur: "Mimmoza (extraction à partir des documents d'urbanisme publiés sur le Géoportail de l'urbanisme)",
    licence: MIMMOZA,
    mention: "Extraction automatisée par Mimmoza à partir des documents du Géoportail de l'urbanisme (Licence Ouverte 2.0) : seul le document d'urbanisme opposable fait foi",
  },
  georisques: {
    id: "georisques",
    nom: "Géorisques",
    producteur: "Ministère de la Transition écologique / BRGM",
    licence: LO,
    licence_url: LO_URL,
    mention: "Source : Géorisques — ministère de la Transition écologique, BRGM",
    url: "https://www.georisques.gouv.fr/doc-api",
  },
  dpe_ademe: {
    id: "dpe_ademe",
    nom: "DPE des logements existants (depuis juillet 2021)",
    producteur: "ADEME",
    licence: LO,
    licence_url: LO_URL,
    mention: "Source : ADEME — base des DPE logements existants (data.ademe.fr)",
    url: "https://data.ademe.fr/datasets/dpe03existant",
  },
  bdnb: {
    id: "bdnb",
    nom: "Base de données nationale des bâtiments (BDNB) — version ouverte (API Open)",
    producteur: "CSTB",
    licence: LO,
    licence_url: LO_URL,
    mention: "Base de Données Nationale des Bâtiments (BDNB) - CSTB (millésime en vigueur de la BDNB Open)",
    url: "https://www.data.gouv.fr/datasets/base-de-donnees-nationale-des-batiments",
  },
  sitadel: {
    id: "sitadel",
    nom: "Sit@del — permis de construire et autres autorisations d'urbanisme (logements autorisés)",
    producteur: "SDES — ministère de la Transition écologique",
    licence: LO,
    licence_url: LO_URL,
    mention: "Source : SDES, Sit@del2 — base des permis de construire et autres autorisations d'urbanisme",
    url: "https://www.data.gouv.fr/datasets/base-des-permis-de-construire-et-autres-autorisations-durbanisme-sitadel",
  },
  loyers: {
    id: "loyers",
    nom: "Carte des loyers — indicateurs de loyers d'annonce par commune (2025)",
    producteur: "Ministère de la Transition écologique / ANIL",
    licence: LO,
    licence_url: LO_URL,
    mention: "Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin",
    url: "https://www.data.gouv.fr/datasets/693aa2feed1bf4da603faa49/",
  },
  fiscalite: {
    id: "fiscalite",
    nom: "Fiscalité locale des particuliers (taux votés)",
    producteur: "DGFiP",
    licence: LO,
    licence_url: LO_URL,
    mention: "Source : DGFiP — fiscalité locale des particuliers (data.economie.gouv.fr)",
    url: "https://data.economie.gouv.fr/explore/dataset/fiscalite-locale-des-particuliers/",
  },
  zonage_abc: {
    id: "zonage_abc",
    nom: "Zonage A/B/C (classement des communes)",
    producteur: "Ministère chargé du Logement",
    licence: LO,
    licence_url: LO_URL,
    mention: "Source : ministère chargé du Logement — zonage A/B/C (arrêté de classement en vigueur)",
    url: "https://www.data.gouv.fr/",
  },
  pvgis: {
    id: "pvgis",
    nom: "PVGIS (Photovoltaic Geographical Information System)",
    producteur: "Commission européenne — Centre commun de recherche (JRC)",
    licence: "Réutilisation libre sous réserve de citer la source — politique de réutilisation de la Commission européenne (décision 2011/833/UE)",
    licence_url: "https://commission.europa.eu/legal-notice_en",
    mention: "PVGIS © European Communities, 2001-2026",
    url: "https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/general-information/geospatial-data-download_en",
  },
  rge_alti: {
    id: "rge_alti",
    nom: "RGE ALTI® (service d'altimétrie de la Géoplateforme)",
    producteur: "IGN",
    licence: LO,
    licence_url: LO_URL,
    mention: "Source : IGN — RGE ALTI®, service d'altimétrie de la Géoplateforme",
    url: "https://cartes.gouv.fr/cgu/",
  },
  merimee: {
    id: "merimee",
    nom: "Immeubles protégés au titre des monuments historiques (base Mérimée)",
    producteur: "Ministère de la Culture",
    licence: LO,
    licence_url: LO_URL,
    mention: "Source : Ministère de la Culture, base Mérimée, Licence Ouverte 2.0",
    url: "https://www.data.gouv.fr/datasets/immeubles-proteges-au-titre-des-monuments-historiques-2",
  },
  gtfs: {
    id: "gtfs",
    nom: "Arrêts et gares de transport en commun (GTFS Île-de-France Mobilités, gares de voyageurs SNCF)",
    producteur: "Île-de-France Mobilités ; SNCF Gares & Connexions",
    licence: "Licence Mobilités (GTFS Île-de-France Mobilités, fondée sur l'ODbL) ; Open Database License (ODbL) 1.0 (gares de voyageurs SNCF)",
    licence_url: "https://wiki.lafabriquedesmobilites.fr/wiki/Licence_Mobilités",
    mention: "Données Île-de-France Mobilités (Licence Mobilités) ; Gares de voyageurs — SNCF Gares & Connexions (ODbL)",
    url: "https://transport.data.gouv.fr/datasets/reseau-urbain-et-interurbain-dile-de-france-mobilites",
    conditions: [PARTAGE_ODBL],
  },
  idfm: {
    id: "idfm",
    nom: "Arrêts et lignes associées (jeu « arrets-lignes »)",
    producteur: "Île-de-France Mobilités",
    licence: "Open Database License (ODbL) 1.0 — version française",
    licence_url: ODBL_URL,
    mention: "Source : Île-de-France Mobilités — Arrêts et lignes associées (ODbL)",
    url: "https://prim.iledefrance-mobilites.fr/en/actualites/article/jeu-de-donnees-arrets-lignes-associees",
    conditions: [PARTAGE_ODBL],
  },
  insee: {
    id: "insee",
    nom: "INSEE (base permanente des équipements, comparateur de territoires, grille de densité, index BT01)",
    producteur: "INSEE",
    licence: LO,
    licence_url: LO_URL,
    mention: "Source : Insee",
    url: "https://insee.fr/fr/information/2008466",
  },
  finess: {
    id: "finess",
    nom: "FINESS (établissements sanitaires et sociaux)",
    producteur: "Ministère chargé de la Santé",
    licence: LO,
    licence_url: LO_URL,
    mention: "Source : FINESS — ministère chargé de la Santé",
    url: "https://www.data.gouv.fr/datasets/finess-extraction-du-fichier-des-etablissements",
  },
  ban: {
    id: "ban",
    nom: "Base Adresse Nationale (géocodage) et API Découpage administratif",
    producteur: "DINUM / IGN",
    licence: LO,
    licence_url: LO_URL,
    mention: "Source : Base Adresse Nationale (DINUM / IGN) ; API Découpage administratif (geo.api.gouv.fr)",
    url: "https://www.data.gouv.fr/datasets/base-adresse-nationale",
  },
  assainissement: {
    id: "assainissement",
    nom: "Services publics d'assainissement — composition communale (SISPEA)",
    producteur: "Office français de la biodiversité",
    licence: LO,
    licence_url: LO_URL,
    mention: "Source : Office français de la biodiversité — SISPEA, composition communale des services d'assainissement",
    url: "https://www.data.gouv.fr/datasets/services-publics-dassainissement-non-collectif-composition-communale-des-services-1",
  },
  wikipedia: {
    id: "wikipedia",
    nom: "Wikipédia (résumé de l'article de la commune)",
    producteur: "Contributeurs de Wikipédia",
    licence: "CC BY-SA 4.0",
    licence_url: "https://creativecommons.org/licenses/by-sa/4.0/deed.fr",
    mention: "Extrait de l'article Wikipédia de la commune, contributeurs de Wikipédia, licence CC BY-SA 4.0",
    url: "https://fr.wikipedia.org/",
    conditions: [
      "L'extrait reste sous CC BY-SA 4.0 : créditer les contributeurs, fournir un lien vers la licence, rediffuser toute adaptation sous la même licence ; les CGU de l'API ne restreignent pas ces droits.",
    ],
  },
  bareme_mimmoza: {
    id: "bareme_mimmoza",
    nom: "Barème de coûts Mimmoza",
    producteur: "Mimmoza",
    licence: MIMMOZA,
    mention: "Hypothèse interne Mimmoza (ordre de grandeur, à confirmer par devis) ; réindexation sur l'indice BT01 (source : Insee) pour la construction",
  },
  modele_mimmoza: {
    id: "modele_mimmoza",
    nom: "Calculs et scores Mimmoza",
    producteur: "Mimmoza",
    licence: MIMMOZA,
    mention: "Indicateurs calculés par Mimmoza à partir des sources listées",
  },
} as const satisfies Record<string, AttributionSource>;

export type IdSource = keyof typeof SOURCES;

export function attributions(ids: readonly IdSource[]): AttributionSource[] {
  const vus = new Set<string>();
  const out: AttributionSource[] = [];
  for (const id of ids) {
    if (vus.has(id)) continue;
    vus.add(id);
    out.push(SOURCES[id]);
  }
  return out;
}
