// ─────────────────────────────────────────────────────────────────────────────
// planTranscription.types.ts
// Types de transcription vectorielle d'un plan architectural de réhabilitation
// ─────────────────────────────────────────────────────────────────────────────

// ── Statuts de traitement ─────────────────────────────────────────────────────

export type TranscriptionStatus =
  | 'idle'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'error';

// ── Usage d'une pièce ─────────────────────────────────────────────────────────

export type RoomUsage =
  | 'chambre'
  | 'salon'
  | 'séjour'
  | 'cuisine'
  | 'salle_de_bain'
  | 'wc'
  | 'couloir'
  | 'entrée'
  | 'dégagement'
  | 'rangement'
  | 'bureau'
  | 'cave'
  | 'garage'
  | 'terrasse'
  | 'balcon'
  | 'loggia'
  | 'combles'
  | 'inconnu';

// ── Matériau de mur ───────────────────────────────────────────────────────────

export type WallMaterial =
  | 'béton'
  | 'maçonnerie'
  | 'pierre'
  | 'brique'
  | 'bois'
  | 'métal'
  | 'plâtre'
  | 'inconnu';

// ── Type d'ouverture ──────────────────────────────────────────────────────────

export type OpeningType = 'porte' | 'fenêtre' | 'baie_vitrée' | 'velux' | 'portail' | 'inconnu';

// ── Catégorie d'annotation ────────────────────────────────────────────────────

export type AnnotationCategory =
  | 'cote'
  | 'surface'
  | 'matériau'
  | 'équipement'
  | 'réseaux'
  | 'désordre'
  | 'remarque'
  | 'inconnu';

// ── Coordonnées 2D normalisées (0.0–1.0 relatif au plan) ─────────────────────

export interface NormalizedPoint {
  readonly x: number; // 0.0 → 1.0
  readonly y: number; // 0.0 → 1.0
}

export interface NormalizedBoundingBox {
  readonly topLeft: NormalizedPoint;
  readonly bottomRight: NormalizedPoint;
}

// ── Dimensions physiques ──────────────────────────────────────────────────────

export interface PhysicalDimensions {
  readonly longueur_m: number | null;
  readonly largeur_m: number | null;
  readonly hauteur_m: number | null;
}

// ── Pièce détectée ────────────────────────────────────────────────────────────

export interface DetectedRoom {
  readonly id: string;
  readonly nom: string;
  readonly usage: RoomUsage;
  /**
   * ⚠ ESTIMATION IA — label visible extrait du plan (ex. "24,0 m²").
   * NE PAS utiliser pour les calculs métier.
   * Utiliser planScaleCalibrator.computeSurface_m2() avec la bounding_box.
   */
  readonly surface_m2: number | null;
  readonly dimensions: PhysicalDimensions;
  readonly bounding_box: NormalizedBoundingBox;
  readonly confidence: number; // 0.0 → 1.0
  readonly etage: number | null; // 0 = RDC, 1 = 1er, -1 = sous-sol
  readonly surface_habitable: boolean;
  readonly remarques: ReadonlyArray<string>;
}

// ── Mur détecté ───────────────────────────────────────────────────────────────

export interface DetectedWall {
  readonly id: string;
  readonly longueur_m: number | null;
  readonly epaisseur_cm: number | null;
  readonly materiau: WallMaterial;
  readonly porteur: boolean | null;
  readonly start: NormalizedPoint;
  readonly end: NormalizedPoint;
  readonly confidence: number;
}

// ── Ouverture détectée ────────────────────────────────────────────────────────

export interface DetectedOpening {
  readonly id: string;
  readonly type: OpeningType;
  readonly largeur_m: number | null;
  readonly hauteur_m: number | null;
  readonly wall_id: string | null;
  readonly position: NormalizedPoint;
  readonly confidence: number;
}

// ── Annotation détectée ───────────────────────────────────────────────────────

export interface DetectedAnnotation {
  readonly id: string;
  readonly texte: string;
  readonly categorie: AnnotationCategory;
  readonly position: NormalizedPoint;
  readonly valeur_numerique: number | null;
  readonly unite: string | null;
  readonly confidence: number;
}

// ── Résumé des surfaces ───────────────────────────────────────────────────────

/**
 * Source d'une mesure de surface ou de longueur.
 * 'ai_estimate'     → valeur retournée par l'IA, NE PAS utiliser comme vérité métier.
 * 'user_calibrated' → calculée par le front après calibration manuelle de l'échelle.
 */
export type PlanMeasurementSource = 'ai_estimate' | 'user_calibrated';

/**
 * ⚠ ESTIMATION IA UNIQUEMENT — NE PAS utiliser comme vérité métier.
 * Les surfaces réelles doivent être calculées par le front (planScaleCalibrator)
 * après calibration manuelle de l'échelle par l'utilisateur.
 * Ces champs peuvent servir d'annotation textuelle visible sur le plan.
 */
export interface SurfaceSummary {
  /** Estimation IA — non fiable si l'échelle du plan n'est pas connue. */
  readonly surface_totale_m2: number | null;
  /** Estimation IA — non fiable si l'échelle du plan n'est pas connue. */
  readonly surface_habitable_m2: number | null;
  /** Estimation IA — non fiable si l'échelle du plan n'est pas connue. */
  readonly surface_annexes_m2: number | null;
  readonly nb_pieces_principales: number;
  readonly nb_pieces_total: number;
}

// ── Résultat complet de transcription ─────────────────────────────────────────

export interface PlanTranscriptionResult {
  readonly plan_id: string;
  readonly source_file_name: string;
  readonly source_file_type: 'image' | 'pdf';
  readonly etages_detectes: ReadonlyArray<number>;
  readonly rooms: ReadonlyArray<DetectedRoom>;
  readonly walls: ReadonlyArray<DetectedWall>;
  readonly openings: ReadonlyArray<DetectedOpening>;
  readonly annotations: ReadonlyArray<DetectedAnnotation>;
  readonly surfaces: SurfaceSummary;
  readonly description_libre: string;
  readonly echelle_detectee: string | null; // ex: "1:50", "1:100"
  readonly orientation_nord: number | null; // angle en degrés, null si non détecté
  readonly score_confiance_global: number; // 0.0 → 1.0
  readonly modele_utilise: string;
  readonly duree_traitement_ms: number;
  readonly created_at: string; // ISO 8601
}

// ── Payload envoyé à la Edge Function ────────────────────────────────────────

export interface TranscribePlanPayload {
  readonly plan_id: string;
  readonly image_base64: string;
  readonly file_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  readonly file_name: string;
  readonly options?: TranscriptionOptions;
}

// ── Options de transcription ──────────────────────────────────────────────────

export interface TranscriptionOptions {
  readonly detect_walls: boolean;
  readonly detect_openings: boolean;
  readonly detect_annotations: boolean;
  readonly expected_surface_m2?: number;
  readonly etage_cible?: number;
  readonly langue_annotations: 'fr' | 'en';
}

export const DEFAULT_TRANSCRIPTION_OPTIONS: TranscriptionOptions = {
  detect_walls: true,
  detect_openings: true,
  detect_annotations: true,
  langue_annotations: 'fr',
} as const;

// ── Réponse brute de la Edge Function ────────────────────────────────────────

export interface TranscribePlanRawResponse {
  readonly success: boolean;
  readonly data?: PlanTranscriptionResult;
  readonly error?: string;
  readonly error_code?: string;
}

// ── Erreur de transcription typée ────────────────────────────────────────────

export type TranscriptionErrorCode =
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'PLAN_NOT_READABLE'
  | 'AI_SERVICE_UNAVAILABLE'
  | 'TIMEOUT'
  | 'QUOTA_EXCEEDED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export interface TranscriptionError {
  readonly code: TranscriptionErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

// ── État par plan dans le store ───────────────────────────────────────────────

export interface PlanTranscriptionEntry {
  readonly plan_id: string;
  readonly status: TranscriptionStatus;
  readonly result: PlanTranscriptionResult | null;
  readonly error: TranscriptionError | null;
  readonly started_at: string | null;
  readonly completed_at: string | null;
}