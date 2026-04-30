import type { PredictiveEngineInput } from "./predictive.types";
import { computePredictiveSnapshot } from "./predictive.engine";

/** Fallback mock input — used only when no real deal data is available */
export const MOCK_INPUT: PredictiveEngineInput = {
  surfaceM2: 65,
  acquisitionPrice: 285_000,
  codePostal: "75011",
  typeBien: "appartement",
  travauxEstime: 35_000,
  fraisAnnexes: 8_500,
};

export function getMockSnapshot() {
  return computePredictiveSnapshot(MOCK_INPUT);
}