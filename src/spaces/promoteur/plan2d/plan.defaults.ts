// src/spaces/promoteur/plan2d/plan.defaults.ts

import type { PlanProject } from "./plan.types";

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
    surfaceMoyLogementM2: 60,
  },

  floorsSpec: {
    aboveGroundFloors: 2,
    groundFloorHeightM: 3,
    typicalFloorHeightM: 2.7,
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