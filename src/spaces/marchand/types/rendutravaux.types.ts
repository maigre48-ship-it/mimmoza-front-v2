// src/spaces/marchand/types/rendutravaux.types.ts

// ── Gamme / niveau (miroir du simulateur travaux) ─────────────────
export type TravauxGamme = "economique" | "standard" | "premium" | "luxe";
export type TravauxNiveau = "leger" | "moyen" | "lourd" | "total";
export type TravauxComplexite = "simple" | "moyenne" | "complexe";

// ── Types de sols pour le rendu IA ────────────────────────────────
export type TravauxSolType =
  | "carrelage"
  | "parquet"
  | "moquette"
  | "tapis"
  | "coco"
  | "beton_cire"
  | "pierre_naturelle"
  | "vinyle"
  | "stratifie"
  | "terre_cuite"
  | "resine"
  | "marbre";

export const TRAVAUX_SOL_TYPE_LABELS: Record<TravauxSolType, string> = {
  carrelage: "Carrelage",
  parquet: "Parquet",
  moquette: "Moquette",
  tapis: "Tapis",
  coco: "Coco / fibre naturelle",
  beton_cire: "Béton ciré",
  pierre_naturelle: "Pierre naturelle",
  vinyle: "Vinyle / PVC",
  stratifie: "Stratifié",
  terre_cuite: "Terre cuite / tomette",
  resine: "Résine",
  marbre: "Marbre",
};

// ── Lots travaux (labels lisibles) ────────────────────────────────
export type TravauxLot =
  | "gros_oeuvre"
  | "electricite"
  | "plomberie"
  | "menuiseries_interieures"
  | "menuiseries_exterieures"
  | "revetements_sols"
  | "revetements_murs"
  | "peinture"
  | "cuisine"
  | "salle_de_bain"
  | "isolation"
  | "chauffage"
  | "faux_plafonds"
  | "amenagement_exterieur";

export const TRAVAUX_LOT_LABELS: Record<TravauxLot, string> = {
  gros_oeuvre: "Gros œuvre / Structure",
  electricite: "Électricité",
  plomberie: "Plomberie",
  menuiseries_interieures: "Menuiseries intérieures",
  menuiseries_exterieures: "Menuiseries extérieures",
  revetements_sols: "Revêtements de sols",
  revetements_murs: "Revêtements muraux",
  peinture: "Peinture",
  cuisine: "Cuisine équipée",
  salle_de_bain: "Salle de bain",
  isolation: "Isolation thermique / acoustique",
  chauffage: "Chauffage / VMC",
  faux_plafonds: "Faux plafonds",
  amenagement_exterieur: "Aménagement extérieur",
};

// ── Config travaux injectée depuis le simulateur / l’UI rendu ─────
export interface TravauxRenduConfig {
  gamme: TravauxGamme;
  niveau: TravauxNiveau;
  complexite?: TravauxComplexite;
  lots: TravauxLot[];

  surfaceM2?: number;
  typeBien?: string; // ex: "appartement", "maison", "studio"
  ville?: string;
  budgetEstime?: number; // € TTC

  styleDecoration?: string; // ex: "scandinave", "industriel", "classique"

  // Options visuelles du rendu IA
  solType?: TravauxSolType;
  solColor?: string; // ex: "#E5D2B3" ou "beige clair"
  murColor?: string; // ex: "#F5F1E8" ou "blanc cassé"

  // Notes libres optionnelles pour enrichir le rendu sans casser le typage
  instructionsComplementaires?: string;
}

// ── Image uploadée ────────────────────────────────────────────────
export interface TravauxImage {
  id: string;
  file: File;
  preview: string; // object URL
  name: string;
  sizeKb: number;
  uploadedAt: Date;

  // après upload Supabase Storage
  storageUrl?: string;
  storagePath?: string;
}

// ── Résultat d'un rendu ───────────────────────────────────────────
export type RenduStatus = "idle" | "uploading" | "generating" | "done" | "error";

export interface RenduResult {
  id: string;
  sourceImageId: string;
  sourcePreview: string;
  generatedImageUrl: string;
  prompt: string;
  generatedAt: Date;
  durationMs?: number;

  // utile pour debug / historique
  configSnapshot?: TravauxRenduConfig;
}

// ── État global du module ─────────────────────────────────────────
export interface RenduTravauxState {
  images: TravauxImage[];
  selectedImageId: string | null;
  results: RenduResult[];
  status: RenduStatus;
  error: string | null;
  progress: number; // 0–100

  styleDecoration: string;

  // Préférences visuelles courantes
  solType: TravauxSolType | null;
  solColor: string | null;
  murColor: string | null;
}

// ── Retour du hook ────────────────────────────────────────────────
export interface UseTravauxImageRenderReturn {
  state: RenduTravauxState;

  addImages: (files: FileList | File[]) => void;
  removeImage: (id: string) => void;
  selectImage: (id: string) => void;

  setStyleDecoration: (style: string) => void;
  setSolType: (type: TravauxSolType | null) => void;
  setSolColor: (color: string | null) => void;
  setMurColor: (color: string | null) => void;

  generateRendu: (imageId: string, config: TravauxRenduConfig) => Promise<void>;
  clearResults: () => void;

  latestResult: RenduResult | null;
}

// ── Payload Edge Function ─────────────────────────────────────────
export interface RenduTravauxEdgePayload {
  image_base64: string;
  image_mime: string;
  prompt: string;
  style: string;

  // Debug / traçabilité côté Edge Function
  config?: TravauxRenduConfig;
}

export interface RenduTravauxEdgeResponse {
  success: boolean;
  image_url?: string;
  image_base64?: string;
  error?: string;
  duration_ms?: number;
}