// src/spaces/promoteur/terrain3d/facade/buildFacadeAiPrompt.ts

import type { FacadeAiPromptInput } from "./facadeAi.types";

function styleLabel(style: string): string {
  switch (style) {
    case "contemporain":
      return "contemporary collective residential facade";
    case "premium":
      return "high-quality contemporary collective residential facade";
    case "haussmannien":
      return "haussmann-inspired collective residential facade";
    case "mediterraneen":
      return "mediterranean collective residential facade";
    case "standard":
    default:
      return "balanced collective residential facade";
  }
}

function vegetationLabel(v: string): string {
  switch (v) {
    case "premium":
      return "elegant landscaped surroundings with refined planting";
    case "residentielle":
      return "soft residential landscaping";
    case "legere":
      return "light and discreet landscaping";
    default:
      return "minimal landscaping";
  }
}

function ambianceLabel(v: string): string {
  switch (v) {
    case "golden":
      return "warm golden-hour light";
    case "couvert":
      return "soft overcast daylight";
    case "crepuscule":
      return "refined dusk atmosphere";
    default:
      return "clear morning light";
  }
}

function buildingStandardLabel(standard?: string): string {
  switch (standard) {
    case "economique":
      return "economical and rational residential standard, simple details, controlled construction cost";
    case "standard":
      return "standard residential quality, balanced and realistic";
    case "qualitatif":
      return "good residential quality with careful proportions and a few refined details";
    case "premium":
      return "premium residential quality with elegant detailing and refined materials";
    case "luxe":
      return "high-end luxury residential quality with very refined composition and premium finishes";
    default:
      return "balanced residential quality, realistic and marketable";
  }
}

function drawingStyleLabel(drawingStyle?: string): string {
  switch (drawingStyle) {
    case "brochure_archi":
      return "premium architectural brochure illustration, polished, refined, elegant, realistic but not raw CGI";
    case "aquarelle":
    default:
      return "soft watercolor architectural illustration with light paper texture, refined washes and subtle linework";
  }
}

function viewLabel(view?: string): string {
  switch (view) {
    case "frontale":
      return "mostly frontal elevation view, very limited perspective distortion";
    case "3_quarts_legers":
      return "soft three-quarter architectural view, controlled perspective";
    case "perspective_entree":
      return "view focused on the main entrance and facade composition, elegant perspective";
    case "angle_rue":
      return "corner or street-angle architectural view, while keeping the facade readable";
    default:
      return "mostly frontal architectural view with slight perspective";
  }
}

function peopleLabel(includePeople?: boolean): string | null {
  if (!includePeople) return null;
  return [
    "Add a few believable pedestrians.",
    "They must remain secondary to the architecture.",
    "Do not overcrowd the scene.",
    "Use discreet scale figures consistent with a residential promoter presentation.",
  ].join(" ");
}

function shopsLabel(includeGroundFloorShops?: boolean): string | null {
  if (!includeGroundFloorShops) return null;
  return [
    "Make the ground floor read as active commercial frontage.",
    "Include elegant shop windows or retail glazing at ground floor level.",
    "Keep signage discreet, upscale, and architecturally integrated.",
    "Do not turn the project into a shopping mall.",
  ].join(" ");
}

function flowerPotsLabel(includeWindowFlowerPots?: boolean): string | null {
  if (!includeWindowFlowerPots) return null;
  return [
    "Add tasteful flower pots or planters near selected windows.",
    "Keep them subtle, elegant, and coherent with the facade rhythm.",
    "Do not overdecorate the building.",
  ].join(" ");
}

export function buildFacadeAiPrompt(input: FacadeAiPromptInput): string {
  const {
    config,
    widthM,
    heightM,
    levelsCount,
    buildingStandard,
    drawingStyle,
    view,
    includePeople,
    includeGroundFloorShops,
    includeWindowFlowerPots,
  } = input;

  const parts = [
    "Architectural presentation rendering for a real-estate promoter.",
    "Create a credible, elegant and marketable architectural facade image.",
    "Do not make it look like raw 3D, CGI, video game rendering, or technical massing output.",
    "Preserve the main composition, exact floor count, facade rhythm and overall proportions of the reference facade.",
    `Building type: ${styleLabel(config.style)}.`,
    `Building standard: ${buildingStandardLabel(buildingStandard)}.`,
    `Graphic style: ${drawingStyleLabel(drawingStyle)}.`,
    `Camera view: ${viewLabel(view)}.`,
    `Approximate width: ${widthM} meters.`,
    `Approximate facade height: ${heightM.toFixed(1)} meters.`,
    `Number of levels: ${levelsCount}.`,
    `Facade material intent: ${config.materiauFacade}.`,
    `Window and frame material intent: ${config.materiauMenuiseries}.`,
    `Roof material intent: ${config.materiauToiture}.`,
    `Ground floor treatment: ${config.rdcType}.`,
    `Facade rhythm: ${config.rythme}.`,
    `Atmosphere: ${ambianceLabel(config.ambiance)}.`,
    `Landscape intent: ${vegetationLabel(config.vegetation)}.`,
    config.attique
      ? "Include a well-integrated attic or top floor setback consistent with the reference."
      : "Do not invent an attic or top floor setback.",
    config.balcons
      ? "Include balconies only if they remain coherent with the reference facade composition."
      : "Do not add visible balconies.",
    config.loggias
      ? "Include discreet and coherent loggias only where appropriate."
      : "Do not add visible loggias.",
    config.corniche
      ? "Include a refined cornice, proportionate and consistent with the architectural style."
      : "Do not overemphasize the cornice.",
    config.socle
      ? "Include a visible architectural base or socle."
      : "Keep the ground base discreet.",
    peopleLabel(includePeople),
    shopsLabel(includeGroundFloorShops),
    flowerPotsLabel(includeWindowFlowerPots),
    "Important: strictly respect the number of floors, the structural composition, and the main alignment of openings from the reference image.",
    "Important: do not add extra floors, extra wings, random terraces, random balconies, or villa-like features unless explicitly required.",
    "Important: stay within collective housing typology, not an isolated villa or resort architecture.",
    "Avoid brutal reinterpretation of the facade.",
    "The result must feel credible for a promoter presentation, elegant but realistic, and visually close to the input facade massing.",
  ];

  return parts.filter(Boolean).join(" ");
}