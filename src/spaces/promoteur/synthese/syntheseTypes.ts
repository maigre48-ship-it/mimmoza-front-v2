// src/spaces/promoteur/synthese/syntheseTypes.ts

export type SyntheseTone = "banque" | "ic" | "neutre";

export type SynthesePayload = {
  tone?: SyntheseTone;
  // éléments de contexte projet
  parcelId?: string;
  communeInsee?: string | null;

  // snapshot agrégé (tous modules)
  snapshot?: Record<string, unknown>;

  // infos additionnelles éventuelles
  meta?: Record<string, unknown>;
};

export type SyntheseSection = {
  id: string;
  title: string;
  content: string; // markdown/plain text
};

export type SyntheseResult = {
  title: string;
  generatedAt: string; // ISO
  tone: SyntheseTone;
  sections: SyntheseSection[];
  raw?: unknown; // debug / trace
};
