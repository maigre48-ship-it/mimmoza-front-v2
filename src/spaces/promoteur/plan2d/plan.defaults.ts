// src/spaces/promoteur/plan2d/plan.defaults.ts

import type { PlanProject } from "./plan.types";
import {
  PLAN_GROUND_FLOOR_HEIGHT_M,
  PLAN_TYPICAL_FLOOR_HEIGHT_M,
  SURFACE_MOYENNE_LOGEMENT_M2,
} from "../shared/buildingMetrics";

export const DEFAULT_PLAN_PROJECT: PlanProject = {
  id: "plan-default",
  name: "Nouveau projet",

  site: {
    parcel: null,
    buildableEnvelope: null,
    forbiddenBand: null,
    facadeSegment: null,
    communeInsee: null,
    parcelIds: [],
  },

  program: {
    buildingKind: "COLLECTIF",
    nbLogements: 10,
    surfaceMoyLogementM2: SURFACE_MOYENNE_LOGEMENT_M2,
  },

  // Mêmes hauteurs que la création d'un bâtiment (usePlanEditor.addBuilding)
  // et que le contrôle de conformité PLU — les trois divergeaient.
  floorsSpec: {
    aboveGroundFloors: 2,
    groundFloorHeightM: PLAN_GROUND_FLOOR_HEIGHT_M,
    typicalFloorHeightM: PLAN_TYPICAL_FLOOR_HEIGHT_M,
  },

  buildings: [],
  parkings: [],

  visualIntent: {
    styleFamily: "contemporain_sobre",
    facadeRhythm: "regulier",
    balconies: "discret",
    roofType: "terrasse",
    vegetationLevel: "moyen",
    imageStyle: "presentation_premium",
    strictGeometry: true,
  },
};