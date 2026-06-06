// ============================================================
// Mimmoza — Module Mobilité Immobilier
// Types TypeScript — mobility.types.ts
// ============================================================

// ------------------------------------------------------------
// Modes Phase 1 (miroir de l'enum SQL mobility_mode)
// Bus classique intentionnellement absent
// ------------------------------------------------------------
export type MobilityMode =
  | 'tgv'
  | 'ter'
  | 'rer'
  | 'transilien'
  | 'metro'
  | 'tram'
  | 'bhns';

// Labels UI par mode
export const MOBILITY_MODE_LABELS: Record<MobilityMode, string> = {
  tgv:        'TGV / Grande vitesse',
  ter:        'TER Régional',
  rer:        'RER',
  transilien: 'Transilien',
  metro:      'Métro',
  tram:       'Tramway',
  bhns:       'BHNS',
};

// GTFS route_type → MobilityMode
// Référence : https://gtfs.org/schedule/reference/#routestxt
export const GTFS_ROUTE_TYPE_MAP: Record<number, MobilityMode | null> = {
  0:   'tram',        // Tram, Streetcar, Light rail
  1:   'metro',       // Subway/Metro
  2:   'ter',         // Rail (TER, intercités — affiné ensuite)
  4:   null,          // Ferry — ignoré Phase 1
  5:   null,          // Cable car — ignoré
  6:   null,          // Gondola — ignoré
  7:   null,          // Funicular — ignoré
  11:  null,          // Trolleybus — ignoré Phase 1
  12:  'transilien',  // Monorail → Transilien (mapping Suisse, rare FR)
  // Route type étendus SNCF
  100: 'tgv',         // Railway Service (TGV dans GTFS SNCF national)
  101: 'tgv',         // High Speed Rail Service
  102: 'ter',         // Long Distance Trains
  103: 'ter',         // Inter Regional Rail Service
  106: 'ter',         // Regional Rail Service
  400: 'metro',       // Urban Rail Service
  401: 'metro',       // Metro Service
  402: 'metro',       // Underground Service
  900: 'tram',        // Tram Service
  901: 'tram',        // City Tram Service
  // BHNS (pas de route_type standard, détection par route_desc)
};

// Modes qui méritent d'être stockés — tous les autres sont ignorés
export const PHASE1_MODES = new Set<MobilityMode>([
  'tgv', 'ter', 'rer', 'transilien', 'metro', 'tram', 'bhns',
]);

// ------------------------------------------------------------
// Résultat brut d'un arrêt depuis Supabase
// ------------------------------------------------------------
export interface MobilityStop {
  stop_id:         string;
  stop_name:       string;
  mode:            MobilityMode;
  distance_m:      number;
  is_main_station: boolean;
  has_tgv:         boolean;
  has_ter:         boolean;
  line_ids:        string[] | null;
  city_name:       string | null;
  minutes_to_cbd:  number | null;
}

// ------------------------------------------------------------
// Résultat agrégé par mode (sortie de mobility_deduplicate_by_mode)
// ------------------------------------------------------------
export interface MobilityModeGroup {
  mode:           MobilityMode;
  nearest_name:   string;
  nearest_dist_m: number;
  stop_count:     number;
  has_tgv:        boolean;
  has_ter:        boolean;
  line_ids:       string[] | null;
}

// ------------------------------------------------------------
// Score final — structure de sortie de computeMobilityScore()
// Pondération immobilière (pas urbano-centrique)
// ------------------------------------------------------------
export interface MobilityScore {
  // Score global 0–100
  total: number;

  // Détail par pilier (pondération ci-dessous)
  pillars: {
    // 40% — Gare SNCF / TER / TGV
    // Logique : Saint-Jean-de-Luz avec TER = bien noté
    rail:        PillarScore;

    // 25% — Réseau urbain (métro, tram, BHNS, RER)
    urban:       PillarScore;

    // 20% — Temps vers bassin d'emploi (minutes_to_cbd)
    employment:  PillarScore;

    // 15% — Multimodalité (nb de modes distincts < 1km)
    multimodal:  PillarScore;
  };

  // Top 5 arrêts pour affichage UI / PDF
  top_stops: Array<{
    name:       string;
    mode:       MobilityMode;
    distance_m: number;
    lines:      string[];
  }>;

  // Métadonnées
  computed_at:  string;   // ISO timestamp
  radius_m:     number;   // rayon utilisé pour le calcul
}

export interface PillarScore {
  score:   number;       // 0–100 pour ce pilier
  weight:  number;       // 0.40 | 0.25 | 0.20 | 0.15
  details: string;       // explication textuelle
}

// ------------------------------------------------------------
// Dataset GTFS source
// ------------------------------------------------------------
export interface GtfsDataset {
  id:              string;
  dataset_id:      string;
  title:           string;
  coverage_area:   string;
  gtfs_url:        string;
  content_hash:    string | null;
  stop_count:      number;
  last_fetched_at: string | null;
  last_changed_at: string | null;
  is_active:       boolean;
}

// ------------------------------------------------------------
// Log d'import
// ------------------------------------------------------------
export interface GtfsImportLog {
  id:              string;
  dataset_id:      string;
  started_at:      string;
  finished_at:     string | null;
  status:          'running' | 'success' | 'failed' | 'skipped';
  stops_inserted:  number;
  stops_updated:   number;
  stops_deleted:   number;
  error_message:   string | null;
  triggered_by:    'cron' | 'manual' | 'webhook';
}

// ------------------------------------------------------------
// Input pour l'Edge Function transport-score-gtfs-v1
// ------------------------------------------------------------
export interface TransportScoreRequest {
  lat:       number;
  lon:       number;
  radius_m?: number;   // défaut 2000
}

export interface TransportScoreResponse {
  score:    MobilityScore;
  cached:   boolean;    // true si récupéré depuis un cache étude
  error?:   string;
}