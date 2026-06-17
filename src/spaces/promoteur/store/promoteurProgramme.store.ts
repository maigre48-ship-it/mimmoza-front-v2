// src/spaces/promoteur/store/promoteurProgramme.store.ts
//
// SOURCE DE VÉRITÉ UNIQUE du « programme » d'une étude promoteur.
// Remplace les sources concurrentes (logements/SDP/niveaux dérivés indépendamment
// dans Programmation, Massing 3D, Implantation 2D et Bilan).
//
// Deux moitiés complémentaires, écrites par des pages différentes :
//   • ENVELOPPE  ← Massing 3D (géométrie mesurée) ou Implantation 2D / saisie manuelle.
//                  emprise, niveaux, SDP géométrique, façade, toiture, balcons, menuiseries.
//   • MIX        ← Programmation (intention métier).
//                  typologies T1–T5, surfaces SHAB/type, commerce, parkings, espaces verts.
//
// Les deux ne se devinent plus l'une l'autre : elles se RÉCONCILIENT (reconcile()).
// Le nb de logements est tranché par une hiérarchie unique (resolvedNbLogements()) :
//   1) typologie Programmation si Σ > 0  → fait foi partout
//   2) sinon estimation Massing (SDP/RATIO_SDP_PAR_LOGT)
//   3) sinon 0
//
// Persistance : localStorage `mimmoza.programme.{studyId}` + event de synchro
// inter-onglets. Zustand garde l'état vivant entre les routes du SPA.

import { create } from "zustand";

// ── Constantes métier ───────────────────────────────────────────────────────
/** SHAB moyen par logement pour l'ESTIMATION massing (fallback uniquement). */
export const RATIO_SDP_PAR_LOGT = 55;
/** Bornes de cohérence remplissage SDP programme / SDP enveloppe. */
const REMPLISSAGE_OK_MIN  = 0.85;
const REMPLISSAGE_OK_MAX  = 1.05;

// ── Types ───────────────────────────────────────────────────────────────────
export type TypologieKey = "T1" | "T2" | "T3" | "T4" | "T5";
export type EnvelopeSource = "massing" | "implantation2d" | "manual";

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
  typologies: Record<TypologieKey, number>;   // nb de logements par type
  surfaces: Record<TypologieKey, number>;     // SHAB (m²) par type
  commerceM2: number;
  nbParkings: number;
  espacesVertsM2: number;
  typeProjet: string;
  /** Niveaux souhaités si AUCUNE enveloppe (repli pré-massing). Ignoré dès qu'une enveloppe existe. */
  niveauxSouhaites: number;
  updatedAt: string;
}

interface ProgrammePersist {
  envelope: ProgrammeEnvelope | null;
  mix: ProgrammeMix;
  version: 1;
}

// ── Défauts ─────────────────────────────────────────────────────────────────
export const DEFAULT_MIX: ProgrammeMix = {
  typologies: { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0 },
  surfaces:   { T1: 35, T2: 50, T3: 68, T4: 85, T5: 105 },
  commerceM2: 0,
  nbParkings: 0,
  espacesVertsM2: 0,
  typeProjet: "collectif",
  niveauxSouhaites: 3,
  updatedAt: new Date(0).toISOString(),
};

// ── Persistance ─────────────────────────────────────────────────────────────
export const PROGRAMME_EVENT = "mimmoza:promoteur-programme-updated";
export function programmeKey(studyId: string) { return `mimmoza.programme.${studyId}`; }

function readPersist(studyId: string): ProgrammePersist | null {
  try {
    const raw = localStorage.getItem(programmeKey(studyId));
    if (!raw) return null;
    const p = JSON.parse(raw) as ProgrammePersist;
    if (!p || p.version !== 1) return null;
    // Fusion défensive : un mix partiel persisté reste valide.
    return {
      envelope: p.envelope ?? null,
      mix: {
        ...DEFAULT_MIX,
        ...p.mix,
        typologies: { ...DEFAULT_MIX.typologies, ...(p.mix?.typologies ?? {}) },
        surfaces:   { ...DEFAULT_MIX.surfaces,   ...(p.mix?.surfaces ?? {}) },
      },
      version: 1,
    };
  } catch { return null; }
}

function writePersist(studyId: string, env: ProgrammeEnvelope | null, mix: ProgrammeMix) {
  try {
    localStorage.setItem(programmeKey(studyId), JSON.stringify({ envelope: env, mix, version: 1 } as ProgrammePersist));
    window.dispatchEvent(new CustomEvent(PROGRAMME_EVENT, { detail: { studyId } }));
  } catch { /* quota / SSR : silencieux */ }
}

// ── Store ───────────────────────────────────────────────────────────────────
interface ProgrammeStore {
  studyId: string | null;
  envelope: ProgrammeEnvelope | null;
  mix: ProgrammeMix;

  /** Hydrate depuis localStorage si l'étude change (préserve les édits en mémoire sinon). */
  loadStudy: (studyId: string | null) => void;
  /** Recharge depuis localStorage (à appeler sur l'event PROGRAMME_EVENT, cross-onglet). */
  reloadFromStorage: () => void;

  setEnvelope: (env: ProgrammeEnvelope | null) => void;
  setTypologie: (key: TypologieKey, nb: number) => void;
  setSurface: (key: TypologieKey, m2: number) => void;
  patchMix: (patch: Partial<ProgrammeMix>) => void;
  clear: () => void;
}

export const usePromoteurProgrammeStore = create<ProgrammeStore>((set, get) => {
  const stamp = () => new Date().toISOString();
  const persist = () => {
    const { studyId, envelope, mix } = get();
    if (studyId) writePersist(studyId, envelope, mix);
  };

  return {
    studyId: null,
    envelope: null,
    mix: DEFAULT_MIX,

    loadStudy: (studyId) => {
      if (studyId === get().studyId) return; // déjà chargé : on garde la mémoire
      if (!studyId) { set({ studyId: null, envelope: null, mix: DEFAULT_MIX }); return; }
      const saved = readPersist(studyId);
      set({
        studyId,
        envelope: saved?.envelope ?? null,
        mix: saved?.mix ?? DEFAULT_MIX,
      });
    },

    reloadFromStorage: () => {
      const { studyId } = get();
      if (!studyId) return;
      const saved = readPersist(studyId);
      set({ envelope: saved?.envelope ?? null, mix: saved?.mix ?? DEFAULT_MIX });
    },

    setEnvelope: (env) => { set({ envelope: env }); persist(); },

    setTypologie: (key, nb) => {
      const v = Math.max(0, Math.floor(Number(nb) || 0));
      set((s) => ({ mix: { ...s.mix, typologies: { ...s.mix.typologies, [key]: v }, updatedAt: stamp() } }));
      persist();
    },

    setSurface: (key, m2) => {
      const v = Math.max(0, Number(m2) || 0);
      set((s) => ({ mix: { ...s.mix, surfaces: { ...s.mix.surfaces, [key]: v }, updatedAt: stamp() } }));
      persist();
    },

    patchMix: (patch) => {
      set((s) => ({ mix: { ...s.mix, ...patch, updatedAt: stamp() } }));
      persist();
    },

    clear: () => {
      const { studyId } = get();
      if (studyId) { try { localStorage.removeItem(programmeKey(studyId)); } catch { /* */ } }
      set({ envelope: null, mix: DEFAULT_MIX });
    },
  };
});

// ── Sélecteurs dérivés (purs — pas stockés) ─────────────────────────────────
const TYPO_KEYS: TypologieKey[] = ["T1", "T2", "T3", "T4", "T5"];

/** Nb total de logements saisis dans le mix. */
export function nbLogementsMix(mix: ProgrammeMix): number {
  return TYPO_KEYS.reduce((sum, k) => sum + (mix.typologies[k] || 0), 0);
}

/** SHAB logements (Σ nb×surf), hors commerce. */
export function shabProgrammeM2(mix: ProgrammeMix): number {
  return TYPO_KEYS.reduce((sum, k) => sum + (mix.typologies[k] || 0) * (mix.surfaces[k] || 0), 0);
}

/** SDP programme = SHAB logements + commerce (proxy SDP côté programme). */
export function sdpProgrammeM2(mix: ProgrammeMix): number {
  return shabProgrammeM2(mix) + Math.max(0, mix.commerceM2 || 0);
}

export interface ResolvedLogements {
  value: number;
  source: "programmation" | "massing_estimate" | "none";
}

/**
 * Hiérarchie unique du nb de logements :
 *   1) Programmation (Σ typologies) si > 0
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
  sdpGeoM2: number;        // enveloppe (massing)
  sdpProgrammeM2: number;  // typologies saisies
  tauxRemplissage: number; // sdpProgramme / sdpGeo (0 si pas d'enveloppe)
  message: string;
}

/** Réconcilie enveloppe (volume dessiné) et mix (logements saisis). */
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

/** Résumé typologie prêt à afficher / exporter. */
export function typologieSummary(mix: ProgrammeMix): Record<TypologieKey, number> {
  return { ...mix.typologies };
}