// src/spaces/promoteur/shared/promoteurStudy.types.ts

// ─── Résultat service générique ───────────────────────────────────────────────
export type ServiceResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: string };

// ─── Module Foncier ───────────────────────────────────────────────────────────
export interface PromoteurParcelRaw {
  id:       string;
  area_m2:  number | null;
  feature?: Record<string, unknown> | null; // GeoJSON feature sérialisé
}

export interface PromoteurFoncierData {
  parcel_ids:    string[];
  focus_id:      string;
  commune_insee: string;
  surface_m2:    number | null;
  parcels_raw:   PromoteurParcelRaw[];
  done:          boolean;
}

// ─── Module PLU ───────────────────────────────────────────────────────────────
export interface PromoteurPluData {
  zone_code:    string | null;
  zone_libelle: string | null;
  ruleset:      Record<string, unknown> | null;
  source:       "auto" | "upload" | "manual" | null;
  done:         boolean;
}

// ─── Module Conception / Faisabilité ─────────────────────────────────────────
export interface PromoteurConceptionData {
  // Programme
  nb_logements_total:    number | null;
  nb_logements_libres:   number | null;
  nb_logements_sociaux:  number | null;
  nb_logements_pls:      number | null;
  shab_moyenne_m2:       number | null;
  shon_total_m2:         number | null;
  shob_total_m2:         number | null;
  // Gabarit retenu
  ces_retenu:            number | null; // ratio 0–1
  hauteur_retenue_m:     number | null;
  nb_niveaux:            number | null;
  // Stationnement
  nb_places_parking:     number | null;
  parking_souterrain:    boolean;
  // Implantation
  implantation_snapshot: Record<string, unknown> | null; // payload Implantation2D
  massing_snapshot:      Record<string, unknown> | null; // payload Massing3D
  // Notes
  notes:                 string | null;
  done:                  boolean;
}

// ─── Module Marché ────────────────────────────────────────────────────────────
export interface PromoteurMarcheData {
  prix_m2_median:   number | null;
  prix_m2_neuf:     number | null;
  prix_m2_ancien:   number | null;
  tension_marche:   "faible" | "moyenne" | "forte" | null;
  taux_vacance_pct: number | null;
  zone_pinel:       string | null;
  score_marche:     number | null;
  smart_scores:     Record<string, unknown> | null;
  raw_data:         Record<string, unknown> | null;
  done:             boolean;
}

// ─── Module Risques ───────────────────────────────────────────────────────────
export interface PromoteurRisquesData {
  score_inondation:    number | null; // 0–4
  score_seisme:        number | null;
  score_retrait_argile: number | null;
  score_radon:         number | null;
  pollution_sols:      boolean;
  score_global:        number | null;
  raw_georisques:      Record<string, unknown> | null;
  done:                boolean;
}

// ─── Module Évaluation / Programme financier ─────────────────────────────────
export interface PromoteurEvaluationData {
  // Coûts
  cout_foncier:             number | null;
  cout_construction_m2:     number | null; // €/m² SHON
  cout_construction_total:  number | null;
  cout_vrd:                 number | null;
  cout_honoraires:          number | null; // % du foncier+construction
  cout_commercialisation:   number | null;
  cout_financier:           number | null;
  cout_divers:              number | null;
  prix_revient_total:       number | null;
  // Recettes
  prix_vente_m2_libre:      number | null;
  prix_vente_m2_social:     number | null;
  ca_previsionnel:          number | null;
  // Synthèse
  marge_brute:              number | null;
  taux_marge_pct:           number | null;
  bep_m2:                   number | null; // prix de vente min pour équilibre
  // Hypothèses
  taux_tva_libre:           number | null; // ex: 20
  taux_tva_social:          number | null; // ex: 5.5
  notes:                    string | null;
  done:                     boolean;
}

// ─── Module Bilan ─────────────────────────────────────────────────────────────
export interface PromoteurBilanData {
  // Récap financier
  prix_revient_total:  number | null;
  ca_previsionnel:     number | null;
  marge_nette:         number | null;
  taux_marge_nette_pct: number | null;
  // Financement
  fonds_propres:       number | null;
  credit_promotion:    number | null;
  taux_credit_pct:     number | null;
  duree_mois:          number | null;
  // Rentabilité
  roi_pct:             number | null;
  tri_pct:             number | null;
  // Narrative AI
  ai_narrative:        string | null;
  ai_generated_at:     string | null; // ISO date
  // Notes
  notes:               string | null;
  done:                boolean;
}

// ─── Étude complète ───────────────────────────────────────────────────────────
export interface PromoteurStudy {
  id:         string;
  user_id:    string;
  title:      string;
  status:     "draft" | "active" | "archived";
  foncier:    PromoteurFoncierData    | null;
  plu:        PromoteurPluData        | null;
  conception: PromoteurConceptionData | null;
  marche:     PromoteurMarcheData     | null;
  risques:    PromoteurRisquesData    | null;
  evaluation: PromoteurEvaluationData | null;
  bilan:      PromoteurBilanData      | null;
  created_at: string;
  updated_at: string;
}

// Patch générique (titre / statut uniquement — pas les modules)
export interface PromoteurStudyMetaPatch {
  title?:  string;
  status?: "draft" | "active" | "archived";
}

// Résumé pour liste d'études (sans modules lourds)
export type PromoteurStudySummary = Pick
  PromoteurStudy,
  "id" | "user_id" | "title" | "status" | "created_at" | "updated_at"
> & {
  foncier: Pick<PromoteurFoncierData, "commune_insee" | "surface_m2"> | null;
};