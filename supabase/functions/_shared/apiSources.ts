// supabase/functions/_shared/apiSources.ts
// ─────────────────────────────────────────────────────────────────────────────
// Attributions des sources de données renvoyées dans CHAQUE réponse de l'API
// publique (champ `sources`). Obligation de mention de la source pour la
// Licence Ouverte 2.0 (Etalab), d'attribution pour l'ODbL (OpenStreetMap) et
// CC BY-SA (Wikipédia). Module PUR.
// ─────────────────────────────────────────────────────────────────────────────

export interface AttributionSource {
  id: string;
  nom: string;
  producteur: string;
  licence: string;
  mention: string;
  url?: string;
}

const LO = "Licence Ouverte / Open Licence 2.0 (Etalab)";

export const SOURCES = {
  dvf: {
    id: "dvf",
    nom: "Demandes de valeurs foncières (DVF)",
    producteur: "DGFiP",
    licence: LO,
    mention: "DVF © DGFiP — statistiques agrégées calculées par Mimmoza",
    url: "https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres/",
  },
  osm: {
    id: "osm",
    nom: "OpenStreetMap (requêtes Overpass)",
    producteur: "Contributeurs OpenStreetMap",
    licence: "Open Database License (ODbL) 1.0",
    mention: "© les contributeurs d'OpenStreetMap",
    url: "https://www.openstreetmap.org/copyright",
  },
  cadastre: {
    id: "cadastre",
    nom: "Plan cadastral informatisé (API Carto — module cadastre)",
    producteur: "DGFiP / IGN",
    licence: LO,
    mention: "Cadastre © DGFiP — diffusion IGN (API Carto)",
    url: "https://apicarto.ign.fr/api/doc/cadastre",
  },
  gpu: {
    id: "gpu",
    nom: "Géoportail de l'urbanisme (API Carto — module GPU)",
    producteur: "IGN / autorités compétentes en urbanisme",
    licence: LO,
    mention: "Géoportail de l'urbanisme — données publiées par les collectivités, diffusion IGN",
    url: "https://www.geoportail-urbanisme.gouv.fr/",
  },
  plu_mimmoza: {
    id: "plu_mimmoza",
    nom: "Règlements de PLU structurés",
    producteur: "Mimmoza (extraction à partir des documents d'urbanisme publiés)",
    licence: "Données Mimmoza — usage selon les CGU de l'API",
    mention: "Extraction automatisée : seul le document d'urbanisme opposable fait foi",
  },
  georisques: {
    id: "georisques",
    nom: "Géorisques",
    producteur: "Ministère de la Transition écologique / BRGM",
    licence: LO,
    mention: "Géorisques — ministère de la Transition écologique, BRGM",
    url: "https://www.georisques.gouv.fr/",
  },
  dpe_ademe: {
    id: "dpe_ademe",
    nom: "DPE des logements existants (depuis juillet 2021)",
    producteur: "ADEME",
    licence: LO,
    mention: "Base DPE © ADEME (data.ademe.fr)",
    url: "https://data.ademe.fr/",
  },
  bdnb: {
    id: "bdnb",
    nom: "Base de données nationale des bâtiments (BDNB)",
    producteur: "CSTB",
    licence: "Licence propre à la BDNB (version ouverte) — voir bdnb.io",
    mention: "BDNB © CSTB",
    url: "https://bdnb.io/",
  },
  sitadel: {
    id: "sitadel",
    nom: "Sit@del — autorisations d'urbanisme (logements autorisés)",
    producteur: "SDES — ministère de la Transition écologique",
    licence: LO,
    mention: "Sit@del2 © SDES",
    url: "https://www.statistiques.developpement-durable.gouv.fr/",
  },
  loyers: {
    id: "loyers",
    nom: "Carte des loyers (indicateurs communaux)",
    producteur: "Ministère chargé du Logement (DHUP) / ANIL",
    licence: LO,
    mention: "Carte des loyers — DHUP / ANIL",
    url: "https://www.data.gouv.fr/",
  },
  fiscalite: {
    id: "fiscalite",
    nom: "Fiscalité locale des particuliers (taux votés, REI)",
    producteur: "DGFiP",
    licence: LO,
    mention: "Fiscalité locale © DGFiP (data.economie.gouv.fr)",
    url: "https://data.economie.gouv.fr/",
  },
  zonage_abc: {
    id: "zonage_abc",
    nom: "Zonage A/B/C",
    producteur: "Ministère chargé du Logement",
    licence: LO,
    mention: "Zonage A/B/C — ministère chargé du Logement",
    url: "https://www.data.gouv.fr/",
  },
  pvgis: {
    id: "pvgis",
    nom: "PVGIS (Photovoltaic Geographical Information System)",
    producteur: "Commission européenne — Centre commun de recherche (JRC)",
    licence: "Réutilisation autorisée avec mention de la source (politique de réutilisation de la Commission européenne)",
    mention: "PVGIS © Union européenne",
    url: "https://re.jrc.ec.europa.eu/pvg_tools/",
  },
  rge_alti: {
    id: "rge_alti",
    nom: "RGE ALTI (API altimétrie Géoplateforme)",
    producteur: "IGN",
    licence: LO,
    mention: "RGE ALTI © IGN",
    url: "https://geoservices.ign.fr/",
  },
  merimee: {
    id: "merimee",
    nom: "Immeubles protégés au titre des monuments historiques (Mérimée)",
    producteur: "Ministère de la Culture",
    licence: LO,
    mention: "Base Mérimée — ministère de la Culture",
    url: "https://data.culture.gouv.fr/",
  },
  gtfs: {
    id: "gtfs",
    nom: "Horaires théoriques de transport (GTFS)",
    producteur: "Autorités organisatrices de la mobilité (via transport.data.gouv.fr)",
    licence: "Licence propre à chaque jeu de données (voir transport.data.gouv.fr)",
    mention: "Données GTFS publiées sur transport.data.gouv.fr",
    url: "https://transport.data.gouv.fr/",
  },
  idfm: {
    id: "idfm",
    nom: "Arrêts et lignes Île-de-France Mobilités",
    producteur: "Île-de-France Mobilités",
    licence: "Licence indiquée par Île-de-France Mobilités pour le jeu « arrets-lignes »",
    mention: "Données Île-de-France Mobilités",
    url: "https://data.iledefrance-mobilites.fr/",
  },
  insee: {
    id: "insee",
    nom: "INSEE (BPE, comparateur de territoires, grille de densité)",
    producteur: "INSEE",
    licence: LO,
    mention: "Source : INSEE",
    url: "https://www.insee.fr/",
  },
  finess: {
    id: "finess",
    nom: "FINESS (établissements sanitaires et sociaux)",
    producteur: "Ministère chargé de la Santé",
    licence: LO,
    mention: "FINESS — ministère chargé de la Santé",
  },
  ban: {
    id: "ban",
    nom: "Base Adresse Nationale / API Découpage administratif",
    producteur: "IGN / DINUM",
    licence: LO,
    mention: "BAN et geo.api.gouv.fr",
    url: "https://adresse.data.gouv.fr/",
  },
  assainissement: {
    id: "assainissement",
    nom: "Services d'assainissement (SISPEA)",
    producteur: "Office français de la biodiversité",
    licence: LO,
    mention: "SISPEA — Observatoire des services d'eau et d'assainissement",
  },
  wikipedia: {
    id: "wikipedia",
    nom: "Wikipédia (article de la commune)",
    producteur: "Contributeurs de Wikipédia",
    licence: "CC BY-SA 4.0",
    mention: "Extrait de Wikipédia, contributeurs de Wikipédia, CC BY-SA 4.0",
    url: "https://fr.wikipedia.org/",
  },
  bareme_mimmoza: {
    id: "bareme_mimmoza",
    nom: "Barème de coûts Mimmoza",
    producteur: "Mimmoza",
    licence: "Données Mimmoza — usage selon les CGU de l'API",
    mention: "Hypothèse interne Mimmoza (ordre de grandeur, à confirmer par devis) ; réindexation sur l'indice BT01 de l'INSEE pour la construction",
  },
  modele_mimmoza: {
    id: "modele_mimmoza",
    nom: "Calculs et scores Mimmoza",
    producteur: "Mimmoza",
    licence: "Données Mimmoza — usage selon les CGU de l'API",
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
