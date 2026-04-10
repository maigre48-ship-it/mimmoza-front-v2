// src/spaces/promoteur/services/promoteurPdf.theme.ts
// Design system constants for the Promoteur PDF export
// Navy / Slate / Sky accent — McKinsey-BCG institutional style

// ============================================================================
// PALETTE
// ============================================================================
export type RGB = [number, number, number];

export const C = {
  // Navy range
  navy:   [10,  24,  64]  as RGB,  // #0A1840
  navy2:  [20,  45,  100] as RGB,  // #142D64
  navy3:  [36,  64,  143] as RGB,  // #24408F

  // Sky / accent
  sky:    [56,  189, 248] as RGB,  // #38BDF8
  skyM:   [14,  165, 233] as RGB,  // #0EA5E9
  skyD:   [2,   132, 199] as RGB,  // #0284C7
  skyL:   [186, 230, 253] as RGB,  // #BAE6FD

  // Blue
  blue:   [58,  99,  185] as RGB,  // #3A63B9

  // Slate range
  slate:  [71,  85,  105] as RGB,  // #475569
  slate2: [100, 116, 139] as RGB,  // #64748B
  slate3: [148, 163, 184] as RGB,  // #94A3B8
  slate4: [203, 213, 225] as RGB,  // #CBD5E1
  slate5: [226, 232, 240] as RGB,  // #E2E8F0
  slate6: [241, 245, 249] as RGB,  // #F1F5F9

  // Base
  white:  [255, 255, 255] as RGB,
  black:  [15,  23,  42]  as RGB,

  // Semantic
  green:  [21,  128, 61]  as RGB,
  amber:  [146, 64,  14]  as RGB,
  red:    [153, 27,  27]  as RGB,
  orange: [180, 60,  10]  as RGB,

  // Soft backgrounds for alert boxes
  redBg:   [254, 226, 226] as RGB,
  amberBg: [254, 243, 199] as RGB,
  greenBg: [220, 252, 231] as RGB,
} as const;

// ============================================================================
// LAYOUT (mm, A4 portrait)
// ============================================================================
export const LAYOUT = {
  ML: 20,           // margin left
  MR: 20,           // margin right
  MT: 28,           // margin top
  MB: 24,           // margin bottom
  PW: 210,          // page width
  PH: 297,          // page height
  HDR_H: 11,        // header band height
  FTR_H: 9,         // footer zone height
} as const;

export const CW = LAYOUT.PW - LAYOUT.ML - LAYOUT.MR; // content width

// ============================================================================
// FONT SIZES (pt)
// ============================================================================
export const F = {
  hero: 28,
  h1:   18,
  h2:   14,
  h3:   11,
  h4:   10,
  body: 9,
  sm:   8,
  xs:   7,
} as const;