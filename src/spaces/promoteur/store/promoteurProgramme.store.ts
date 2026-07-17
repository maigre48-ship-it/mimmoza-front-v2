// src/spaces/promoteur/store/promoteurProgramme.store.ts
//
// SOURCE DE VÉRITÉ UNIQUE du « programme » d'une étude promoteur.
// Remplace les sources concurrentes (logements/SDP/niveaux dérivés indépendamment
// dans Programmation, Massing 3D, Implantation 2D et Bilan).
//
// V2 — MULTI-BÂTIMENTS.
//   Le MIX porte désormais une liste `batiments[]` : chaque bâtiment a ses
//   propres niveaux, emprise, typologies (T1–T5), surfaces et commerce.
//   Cas d'usage : village sénior, village vacances, îlot à plusieurs plots…
//   Un projet « classique » = 1 bâtiment (migration automatique depuis la v1).
//
// Deux moitiés complémentaires, écrites par des pages différentes :
//   • ENVELOPPE  ← Massing 3D (géométrie mesurée TOTALE) ou saisie manuelle.
//                  SDP géométrique, façade, toiture, balcons, menuiseries.
//   • MIX        ← Programmation (intention métier), désormais PAR BÂTIMENT.
//
// Les deux ne se devinent plus l'une l'autre : elles se RÉCONCILIENT (reconcile()),
// en comparant la SDP programme AGRÉGÉE (Σ bâtiments) à la SDP enveloppe.
//
// Persistance : userStorage `mimmoza.programme.{studyId}` (scopé par compte) + event
// de synchro inter-onglets. Zustand garde l'état vivant entre les routes du SPA.

import { create } from "zustand";
import { userStorage } from "@/lib/storage/userScopedStorage";

// ── Constantes métier ───────────────────────────────────────────────────────
/** SHAB moyen par logement pour l'ESTIMATION massing (fallback uniquement). */
export const RATIO_SDP_PAR_LOGT = 55;
/** Bornes de cohérence remplissage SDP programme / SDP enveloppe. */
const REMPLISSAGE_OK_MIN  = 0.85;
const REMPLISSAGE_OK_MAX  = 1.05;
/** Hauteur moyenne d'un niveau (m) pour l'estimation de gabarit. */
export const HAUTEUR_NIVEAU_M = 3.2;

// ── Types ───────────────────────────────────────────────────────────────────
export type TypologieKey = "T1" | "T2" | "T3" | "T4" | "T5";
export type EnvelopeSource = "massing" | "implantation2d" | "manual";

/** Un bâtiment du programme (plot). */
export interface ProgrammeBatiment {
  id: string;
  nom: string;
  niveaux: number;
  empriseSolM2: number;
  typologies: Record<TypologieKey, number>;   // nb de logements par type
  surfaces: Record<TypologieKey, number>;     // SHAB (m²) par type
  commerceM2: number;
}

/** Moitié ENVELOPPE — écrite par le Massing 3D (ou 2D / manuel en repli). */
export interface ProgrammeEnvelope {
  empriseSolM2: number;
  niveaux: number;
  sdpGeoM2: number;
  facadeM2: number;
  facadeNetteM2: number;       // façade hors ouvertures (pour le chiffrage)
  toitureTerrasseM2: number;
  toiturePenteM2: number;
  balconsM2: number;
  nbMenuiseries: number;
  nbBatiments: number;
  source: EnvelopeSource;
  updatedAt: string;
}

/** Moitié MIX — écrite par la Programmation. */
export interface ProgrammeMix {
  /** Liste des bâtiments (toujours ≥ 1). */
  batiments: ProgrammeBatiment[];
  /** Équipements à l'échelle de la parcelle (non rattachés à un bâtiment). */
  nbParkings: number;
  espacesVertsM2: number;
  typeProjet: string;
  /** Niveaux souhaités par défaut pour un nouveau bâtiment (repli pré-massing). */
  niveauxSouhaites: number;
  updatedAt: string;
}

interface ProgrammePersist {
  envelope: ProgrammeEnvelope | null;
  mix: ProgrammeMix;
  version: 2;
}

/** Ancien format persisté (mono-bâtiment) — pour migration. */
interface ProgrammeMixV1 {
  typologies?: Record<TypologieKey, number>;
  surfaces?: Record<TypologieKey, number>;
  commerceM2?: number;
  nbParkings?: number;
  espacesVertsM2?: number;
  typeProjet?: string;
  niveauxSouhaites?: number;
}
interface ProgrammePersistV1 {
  envelope?: ProgrammeEnvelope | null;
  mix?: ProgrammeMixV1;
  version?: number;
}

// ── Défauts ─────────────────────────────────────────────────────────────────
const TYPO_KEYS: TypologieKey[] = ["T1", "T2", "T3", "T4", "T5"];

export const DEFAULT_SURFACES: Record<TypologieKey, number> = {
  T1: 35, T2: 50, T3: 68, T4: 85, T5: 105,
};
const EMPTY_TYPOLOGIES: Record<TypologieKey, number> = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0 };

function genId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* */ }
  return "bat_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

/** Lettre A, B, C… pour l'auto-nommage. */
export function batimentLetter(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index);
  return `${String.fromCharCode(65 + Math.floor(index / 26) - 1)}${String.fromCharCode(65 + (index % 26))}`;
}

export function makeBatiment(index: number, niveaux: number): ProgrammeBatiment {
  return {
    id: genId(),
    nom: `Bâtiment ${batimentLetter(index)}`,
    niveaux: Math.max(1, Math.floor(niveaux || 1)),
    empriseSolM2: 0,
    typologies: { ...EMPTY_TYPOLOGIES },
    surfaces: { ...DEFAULT_SURFACES },
    commerceM2: 0,
  };
}

export const DEFAULT_MIX: ProgrammeMix = {
  batiments: [makeBatiment(0, 3)],
  nbParkings: 0,
  espacesVertsM2: 0,
  typeProjet: "collectif",
  niveauxSouhaites: 3,
  updatedAt: new Date(0).toISOString(),
};

// ── Persistance ─────────────────────────────────────────────────────────────
export const PROGRAMME_EVENT = "mimmoza:promoteur-programme-updated";
export function programmeKey(studyId: string) { return `mimmoza.programme.${studyId}`; }

/** Normalise un bâtiment partiel (typologies/surfaces défensives). */
function coerceBatiment(b: Partial<ProgrammeBatiment> | undefined, index: number, niveauxFallback: number): ProgrammeBatiment {
  const base = makeBatiment(index, niveauxFallback);
  if (!b) return base;
  return {
    id: b.id || base.id,
    nom: b.nom || base.nom,
    niveaux: Math.max(1, Math.floor(Number(b.niveaux) || base.niveaux)),
    empriseSolM2: Math.max(0, Number(b.empriseSolM2) || 0),
    typologies: { ...EMPTY_TYPOLOGIES, ...(b.typologies ?? {}) },
    surfaces:   { ...DEFAULT_SURFACES, ...(b.surfaces ?? {}) },
    commerceM2: Math.max(0, Number(b.commerceM2) || 0),
  };
}

/** Migre un mix v1 (mono-bâtiment) en mix v2 (batiments[]). */
function migrateV1(mixV1: ProgrammeMixV1 | undefined, env: ProgrammeEnvelope | null): ProgrammeMix {
  const niveaux = env?.niveaux ?? mixV1?.niveauxSouhaites ?? 3;
  const bat = coerceBatiment(
    {
      nom: "Bâtiment A",
      niveaux,
      empriseSolM2: env?.empriseSolM2 ?? 0,
      typologies: mixV1?.typologies,
      surfaces: mixV1?.surfaces,
      commerceM2: mixV1?.commerceM2 ?? 0,
    },
    0,
    niveaux,
  );
  return {
    batiments: [bat],
    nbParkings: Math.max(0, Math.floor(Number(mixV1?.nbParkings) || 0)),
    espacesVertsM2: Math.max(0, Number(mixV1?.espacesVertsM2) || 0),
    typeProjet: mixV1?.typeProjet ?? "collectif",
    niveauxSouhaites: mixV1?.niveauxSouhaites ?? 3,
    updatedAt: new Date().toISOString(),
  };
}

function readPersist(studyId: string): ProgrammePersist | null {
  try {
    const raw = userStorage.getItem(programmeKey(studyId));
    if (!raw) return null;
    const p = JSON.parse(raw) as ProgrammePersistV1 | ProgrammePersist;
    if (!p) return null;

    const env = (p.envelope ?? null) as ProgrammeEnvelope | null;

    // v2 : batiments présents → fusion défensive.
    const asV2 = p as ProgrammePersist;
    if (Array.isArray(asV2.mix?.batiments)) {
      const niveauxFallback = asV2.mix.niveauxSouhaites ?? 3;
      const batiments = asV2.mix.batiments.length > 0
        ? asV2.mix.batiments.map((b, i) => coerceBatiment(b, i, niveauxFallback))
        : [makeBatiment(0, niveauxFallback)];
      return {
        envelope: env,
        mix: {
          batiments,
          nbParkings: Math.max(0, Math.floor(Number(asV2.mix.nbParkings) || 0)),
          espacesVertsM2: Math.max(0, Number(asV2.mix.espacesVertsM2) || 0),
          typeProjet: asV2.mix.typeProjet ?? "collectif",
          niveauxSouhaites: niveauxFallback,
          updatedAt: asV2.mix.updatedAt ?? new Date().toISOString(),
        },
        version: 2,
      };
    }

    // v1 (ou inconnu) : migration mono-bâtiment.
    return {
      envelope: env,
      mix: migrateV1((p as ProgrammePersistV1).mix, env),
      version: 2,
    };
  } catch { return null; }
}

function writePersist(studyId: string, env: ProgrammeEnvelope | null, mix: ProgrammeMix) {
  try {
    userStorage.setItem(programmeKey(studyId), JSON.stringify({ envelope: env, mix, version: 2 } as ProgrammePersist));
    window.dispatchEvent(new CustomEvent(PROGRAMME_EVENT, { detail: { studyId } }));
  } catch { /* quota / SSR : silencieux */ }
}

// ── Store ───────────────────────────────────────────────────────────────────
/** Spec d'import (migration d'un bâtiment 2D keyless vers le programme). */
export interface ImportBatimentSpec {
  nom: string;
  niveaux: number;
  empriseSolM2: number;
}

interface ProgrammeStore {
  studyId: string | null;
  envelope: ProgrammeEnvelope | null;
  mix: ProgrammeMix;
  /** Nb de bâtiments importés depuis le plan masse au dernier montage (bandeau UI). */
  importNotice: number;

  /** Hydrate depuis userStorage si l'étude change (préserve les édits en mémoire sinon). */
  loadStudy: (studyId: string | null) => void;
  /** Recharge depuis userStorage (à appeler sur l'event PROGRAMME_EVENT, cross-onglet). */
  reloadFromStorage: () => void;

  setEnvelope: (env: ProgrammeEnvelope | null) => void;

  // ── Bâtiments ──
  addBatiment: () => void;
  removeBatiment: (id: string) => void;
  duplicateBatiment: (id: string) => void;
  patchBatiment: (id: string, patch: Partial<Omit<ProgrammeBatiment, "id" | "typologies" | "surfaces">>) => void;
  setBatimentTypologie: (id: string, key: TypologieKey, nb: number) => void;
  setBatimentSurface: (id: string, key: TypologieKey, m2: number) => void;

  // ── Wrappers rétrocompat (agissent sur le 1er bâtiment) ──
  setTypologie: (key: TypologieKey, nb: number) => void;
  setSurface: (key: TypologieKey, m2: number) => void;

  patchMix: (patch: Partial<Omit<ProgrammeMix, "batiments">>) => void;
  clear: () => void;

  // ── Migration plan masse → programme ──
  /** Importe des bâtiments entièrement spécifiés (migration 2D keyless). Retourne leurs ids. */
  importBatiments: (specs: ImportBatimentSpec[]) => string[];
  /** Efface le bandeau « N bâtiment(s) importé(s) ». */
  clearImportNotice: () => void;
}

export const usePromoteurProgrammeStore = create<ProgrammeStore>((set, get) => {
  const stamp = () => new Date().toISOString();
  const persist = () => {
    const { studyId, envelope, mix } = get();
    if (studyId) writePersist(studyId, envelope, mix);
  };

  const mapBatiment = (id: string, fn: (b: ProgrammeBatiment) => ProgrammeBatiment) => {
    set((s) => ({
      mix: {
        ...s.mix,
        batiments: s.mix.batiments.map((b) => (b.id === id ? fn(b) : b)),
        updatedAt: stamp(),
      },
    }));
    persist();
  };

  return {
    studyId: null,
    envelope: null,
    mix: DEFAULT_MIX,
    importNotice: 0,

    loadStudy: (studyId) => {
      if (studyId === get().studyId) return; // déjà chargé : on garde la mémoire
      if (!studyId) { set({ studyId: null, envelope: null, mix: DEFAULT_MIX, importNotice: 0 }); return; }
      const saved = readPersist(studyId);
      set({
        studyId,
        envelope: saved?.envelope ?? null,
        mix: saved?.mix ?? DEFAULT_MIX,
        importNotice: 0,
      });
    },

    reloadFromStorage: () => {
      const { studyId } = get();
      if (!studyId) return;
      const saved = readPersist(studyId);
      set({ envelope: saved?.envelope ?? null, mix: saved?.mix ?? DEFAULT_MIX });
    },

    setEnvelope: (env) => { set({ envelope: env }); persist(); },

    // ── Bâtiments ──
    addBatiment: () => {
      set((s) => {
        const idx = s.mix.batiments.length;
        return {
          mix: {
            ...s.mix,
            batiments: [...s.mix.batiments, makeBatiment(idx, s.mix.niveauxSouhaites)],
            updatedAt: stamp(),
          },
        };
      });
      persist();
    },

    removeBatiment: (id) => {
      set((s) => {
        // On garde toujours au moins un bâtiment.
        if (s.mix.batiments.length <= 1) return s;
        return {
          mix: {
            ...s.mix,
            batiments: s.mix.batiments.filter((b) => b.id !== id),
            updatedAt: stamp(),
          },
        };
      });
      persist();
    },

    duplicateBatiment: (id) => {
      set((s) => {
        const src = s.mix.batiments.find((b) => b.id === id);
        if (!src) return s;
        const idx = s.mix.batiments.length;
        const copy: ProgrammeBatiment = {
          ...src,
          id: genId(),
          nom: `${src.nom} (copie)`,
          typologies: { ...src.typologies },
          surfaces: { ...src.surfaces },
        };
        // Insère juste après la source.
        const pos = s.mix.batiments.findIndex((b) => b.id === id);
        const next = [...s.mix.batiments];
        next.splice(pos + 1, 0, copy);
        void idx;
        return { mix: { ...s.mix, batiments: next, updatedAt: stamp() } };
      });
      persist();
    },

    patchBatiment: (id, patch) => {
      mapBatiment(id, (b) => ({
        ...b,
        ...patch,
        nom: patch.nom !== undefined ? patch.nom : b.nom,
        niveaux: patch.niveaux !== undefined ? Math.max(1, Math.floor(Number(patch.niveaux) || 1)) : b.niveaux,
        empriseSolM2: patch.empriseSolM2 !== undefined ? Math.max(0, Number(patch.empriseSolM2) || 0) : b.empriseSolM2,
        commerceM2: patch.commerceM2 !== undefined ? Math.max(0, Number(patch.commerceM2) || 0) : b.commerceM2,
      }));
    },

    setBatimentTypologie: (id, key, nb) => {
      const v = Math.max(0, Math.floor(Number(nb) || 0));
      mapBatiment(id, (b) => ({ ...b, typologies: { ...b.typologies, [key]: v } }));
    },

    setBatimentSurface: (id, key, m2) => {
      const v = Math.max(0, Number(m2) || 0);
      mapBatiment(id, (b) => ({ ...b, surfaces: { ...b.surfaces, [key]: v } }));
    },

    // ── Wrappers rétrocompat (1er bâtiment) ──
    setTypologie: (key, nb) => {
      const first = get().mix.batiments[0];
      if (first) get().setBatimentTypologie(first.id, key, nb);
    },
    setSurface: (key, m2) => {
      const first = get().mix.batiments[0];
      if (first) get().setBatimentSurface(first.id, key, m2);
    },

    patchMix: (patch) => {
      set((s) => ({ mix: { ...s.mix, ...patch, updatedAt: stamp() } }));
      persist();
    },

    clear: () => {
      const { studyId } = get();
      if (studyId) { try { userStorage.removeItem(programmeKey(studyId)); } catch { /* */ } }
      set({ envelope: null, mix: DEFAULT_MIX });
    },

    // ── Migration plan masse → programme ──
    importBatiments: (specs) => {
      if (!specs.length) return [];
      const ids: string[] = [];
      set((s) => {
        const start = s.mix.batiments.length;
        const added = specs.map((sp, i) => {
          const base = makeBatiment(start + i, sp.niveaux);
          const bat: ProgrammeBatiment = {
            ...base,
            nom: sp.nom || base.nom,
            niveaux: Math.max(1, Math.floor(Number(sp.niveaux) || 1)),
            empriseSolM2: Math.max(0, Number(sp.empriseSolM2) || 0),
          };
          ids.push(bat.id);
          return bat;
        });
        return {
          mix: { ...s.mix, batiments: [...s.mix.batiments, ...added], updatedAt: stamp() },
          importNotice: s.importNotice + specs.length,
        };
      });
      persist();
      return ids;
    },

    clearImportNotice: () => set({ importNotice: 0 }),
  };
});

// ── Sélecteurs dérivés (purs — pas stockés) ─────────────────────────────────

/** Nb de logements d'un seul bâtiment. */
export function nbLogementsBatiment(b: ProgrammeBatiment): number {
  return TYPO_KEYS.reduce((sum, k) => sum + (b.typologies[k] || 0), 0);
}

/** SHAB d'un seul bâtiment (Σ nb×surf). */
export function shabBatiment(b: ProgrammeBatiment): number {
  return TYPO_KEYS.reduce((sum, k) => sum + (b.typologies[k] || 0) * (b.surfaces[k] || 0), 0);
}

/** SDP d'un seul bâtiment = SHAB + commerce. */
export function sdpBatiment(b: ProgrammeBatiment): number {
  return shabBatiment(b) + Math.max(0, b.commerceM2 || 0);
}

/** Nb total de logements saisis dans le mix (Σ bâtiments). */
export function nbLogementsMix(mix: ProgrammeMix): number {
  return mix.batiments.reduce((sum, b) => sum + nbLogementsBatiment(b), 0);
}

/** SHAB logements (Σ nb×surf, tous bâtiments), hors commerce. */
export function shabProgrammeM2(mix: ProgrammeMix): number {
  return mix.batiments.reduce((sum, b) => sum + shabBatiment(b), 0);
}

/** Surface commerce totale (Σ bâtiments). */
export function commerceProgrammeM2(mix: ProgrammeMix): number {
  return mix.batiments.reduce((sum, b) => sum + Math.max(0, b.commerceM2 || 0), 0);
}

/** SDP programme = SHAB logements + commerce (Σ bâtiments). */
export function sdpProgrammeM2(mix: ProgrammeMix): number {
  return shabProgrammeM2(mix) + commerceProgrammeM2(mix);
}

/** Emprise au sol totale (Σ bâtiments) — feed du contrôle CES à l'échelle parcelle. */
export function empriseTotaleM2(mix: ProgrammeMix): number {
  return mix.batiments.reduce((sum, b) => sum + Math.max(0, b.empriseSolM2 || 0), 0);
}

/** Nb de niveaux max parmi les bâtiments — feed du contrôle de hauteur. */
export function maxNiveaux(mix: ProgrammeMix): number {
  return mix.batiments.reduce((mx, b) => Math.max(mx, b.niveaux || 1), 1);
}

/** Typologies agrégées (Σ counts par type) sur tous les bâtiments. */
export function aggregatedTypologies(mix: ProgrammeMix): Record<TypologieKey, number> {
  const out: Record<TypologieKey, number> = { ...EMPTY_TYPOLOGIES };
  for (const b of mix.batiments) for (const k of TYPO_KEYS) out[k] += b.typologies[k] || 0;
  return out;
}

/** Surfaces moyennes pondérées par le nb de logements (pour compat Bilan). */
export function weightedSurfaces(mix: ProgrammeMix): Record<TypologieKey, number> {
  const out: Record<TypologieKey, number> = { ...DEFAULT_SURFACES };
  for (const k of TYPO_KEYS) {
    let nb = 0, shab = 0;
    for (const b of mix.batiments) {
      const n = b.typologies[k] || 0;
      nb += n; shab += n * (b.surfaces[k] || 0);
    }
    if (nb > 0) out[k] = Math.round(shab / nb);
  }
  return out;
}

export interface ResolvedLogements {
  value: number;
  source: "programmation" | "massing_estimate" | "none";
}

/**
 * Hiérarchie unique du nb de logements :
 *   1) Programmation (Σ typologies tous bâtiments) si > 0
 *   2) estimation Massing (sdpGeo / RATIO_SDP_PAR_LOGT)
 *   3) 0
 */
export function resolvedNbLogements(envelope: ProgrammeEnvelope | null, mix: ProgrammeMix): ResolvedLogements {
  const fromMix = nbLogementsMix(mix);
  if (fromMix > 0) return { value: fromMix, source: "programmation" };
  if (envelope && envelope.sdpGeoM2 > 0) {
    return { value: Math.round(envelope.sdpGeoM2 / RATIO_SDP_PAR_LOGT), source: "massing_estimate" };
  }
  return { value: 0, source: "none" };
}

export type ReconcileStatut = "no_envelope" | "vide" | "coherent" | "sous_rempli" | "depassement";

export interface Reconciliation {
  statut: ReconcileStatut;
  sdpGeoM2: number;        // enveloppe (massing) — TOTALE
  sdpProgrammeM2: number;  // typologies saisies (Σ bâtiments)
  tauxRemplissage: number; // sdpProgramme / sdpGeo (0 si pas d'enveloppe)
  message: string;
}

/** Réconcilie enveloppe (volume total dessiné) et mix (logements saisis, Σ bâtiments). */
export function reconcile(envelope: ProgrammeEnvelope | null, mix: ProgrammeMix): Reconciliation {
  const sdpProg = sdpProgrammeM2(mix);
  if (!envelope || envelope.sdpGeoM2 <= 0) {
    return {
      statut: "no_envelope", sdpGeoM2: 0, sdpProgrammeM2: sdpProg, tauxRemplissage: 0,
      message: "Aucune enveloppe : dessine le volume dans le Massing 3D (ou saisis une enveloppe manuelle).",
    };
  }
  const sdpGeo = envelope.sdpGeoM2;
  const ratio = sdpProg / sdpGeo;
  if (sdpProg <= 0) {
    return {
      statut: "vide", sdpGeoM2: sdpGeo, sdpProgrammeM2: 0, tauxRemplissage: 0,
      message: `Enveloppe ${Math.round(sdpGeo)} m² SDP — aucune typologie saisie. Répartis tes logements.`,
    };
  }
  const pct = Math.round(ratio * 100);
  if (ratio > REMPLISSAGE_OK_MAX) {
    return {
      statut: "depassement", sdpGeoM2: sdpGeo, sdpProgrammeM2: sdpProg, tauxRemplissage: ratio,
      message: `Dépassement : ta répartition (${Math.round(sdpProg)} m²) excède l'enveloppe (${Math.round(sdpGeo)} m²) — ${pct} %. Réduis ou agrandis le volume.`,
    };
  }
  if (ratio < REMPLISSAGE_OK_MIN) {
    return {
      statut: "sous_rempli", sdpGeoM2: sdpGeo, sdpProgrammeM2: sdpProg, tauxRemplissage: ratio,
      message: `Sous-rempli : ${pct} % de l'enveloppe utilisé (${Math.round(sdpProg)} / ${Math.round(sdpGeo)} m²). Marge pour plus de logements.`,
    };
  }
  return {
    statut: "coherent", sdpGeoM2: sdpGeo, sdpProgrammeM2: sdpProg, tauxRemplissage: ratio,
    message: `Cohérent : ${pct} % de l'enveloppe rempli (${Math.round(sdpProg)} / ${Math.round(sdpGeo)} m²).`,
  };
}

/** Résumé typologie agrégé prêt à afficher / exporter. */
export function typologieSummary(mix: ProgrammeMix): Record<TypologieKey, number> {
  return aggregatedTypologies(mix);
}