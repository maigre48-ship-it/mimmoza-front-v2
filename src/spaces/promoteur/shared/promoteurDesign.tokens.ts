// src/spaces/promoteur/shared/promoteurDesign.tokens.ts
// VERSION 1.0.0 — Design system unifié Promoteur

// ─── Couleurs ──────────────────────────────────────────────────────────────────

export const PROMOTEUR_COLORS = {
  // Violet principal
  violet:       "#7C63D9",
  violetHover:  "#6B52C8",
  violetLight:  "#A78BFA",
  violetBg:     "#F4F0FF",
  violetBorder: "#DDD6FE",

  // Gradients
  gradMain:     "linear-gradient(135deg, #7C63D9 0%, #9C8FDD 50%, #B39DDB 100%)",
  gradH:        "linear-gradient(90deg, #7C63D9 0%, #B39DDB 100%)",

  // Texte
  textPrimary:   "#0F172A",
  textSecondary: "#64748B",
  textMuted:     "#94A3B8",
  textViolet:    "#7C63D9",

  // Neutres page
  pageBg:     "#F8FAFC",
  cardBg:     "#FFFFFF",
  border:     "#E2E8F0",
  borderLight:"#F1F5F9",

  // États
  success:    "#10B981",
  warning:    "#F59E0B",
  error:      "#EF4444",
  info:       "#3B82F6",
} as const;

// ─── Typographie ───────────────────────────────────────────────────────────────

export const PROMOTEUR_TYPOGRAPHY = {
  h1: { fontSize: "32px", fontWeight: 800, lineHeight: "40px" },
  h2: { fontSize: "24px", fontWeight: 700, lineHeight: "32px" },
  h3: { fontSize: "18px", fontWeight: 700, lineHeight: "26px" },
  body: { fontSize: "15px", fontWeight: 400, lineHeight: "24px" },
  bodySmall: { fontSize: "13px", fontWeight: 400, lineHeight: "20px" },
  label: { fontSize: "13px", fontWeight: 600, lineHeight: "16px" },
  labelSmall: { fontSize: "11px", fontWeight: 600, lineHeight: "14px" },
  caption: { fontSize: "11px", fontWeight: 400, lineHeight: "14px" },
} as const;

// ─── Layout ────────────────────────────────────────────────────────────────────

export const PROMOTEUR_LAYOUT = {
  maxWidth:         "1500px",
  paddingDesktop:   "32px",
  paddingMobile:    "16px",
  gapSection:       "24px",
  gapSectionLarge:  "32px",
} as const;

// ─── Border radius ─────────────────────────────────────────────────────────────

export const PROMOTEUR_RADIUS = {
  hero:   "24px",
  card:   "20px",
  inner:  "14px",
  badge:  "14px",
  button: "12px",
  input:  "10px",
  tag:    "8px",
  dot:    "50%",
} as const;

// ─── Shadows ───────────────────────────────────────────────────────────────────

export const PROMOTEUR_SHADOWS = {
  card:       "0 1px 4px rgba(15,23,42,0.06)",
  cardHover:  "0 6px 20px rgba(124,99,217,0.12)",
  hero:       "0 8px 32px rgba(124,99,217,0.22)",
  button:     "0 4px 14px rgba(124,99,217,0.30)",
  buttonHover:"0 8px 28px rgba(124,99,217,0.38)",
} as const;

// ─── Styles de boutons ─────────────────────────────────────────────────────────

export const PROMOTEUR_BUTTON_STYLES = {
  primary: {
    display:        "inline-flex" as const,
    alignItems:     "center",
    gap:            "8px",
    padding:        "11px 22px",
    borderRadius:   PROMOTEUR_RADIUS.button,
    border:         "none",
    background:     PROMOTEUR_COLORS.gradMain,
    color:          "#FFFFFF",
    fontWeight:     700,
    fontSize:       "14px",
    cursor:         "pointer",
    boxShadow:      PROMOTEUR_SHADOWS.button,
    transition:     "opacity 0.14s ease, transform 0.14s ease",
  },
  secondary: {
    display:        "inline-flex" as const,
    alignItems:     "center",
    gap:            "8px",
    padding:        "11px 22px",
    borderRadius:   PROMOTEUR_RADIUS.button,
    border:         `1.5px solid ${PROMOTEUR_COLORS.violetBorder}`,
    background:     "#FFFFFF",
    color:          PROMOTEUR_COLORS.violet,
    fontWeight:     600,
    fontSize:       "14px",
    cursor:         "pointer",
    transition:     "background 0.14s ease",
  },
  ghost: {
    display:        "inline-flex" as const,
    alignItems:     "center",
    gap:            "8px",
    padding:        "11px 22px",
    borderRadius:   PROMOTEUR_RADIUS.button,
    border:         `1px solid rgba(255,255,255,0.30)`,
    background:     "rgba(255,255,255,0.14)",
    color:          "#FFFFFF",
    fontWeight:     600,
    fontSize:       "14px",
    cursor:         "pointer",
  },
  ghostDark: {
    display:        "inline-flex" as const,
    alignItems:     "center",
    gap:            "8px",
    padding:        "11px 22px",
    borderRadius:   PROMOTEUR_RADIUS.button,
    border:         `1.5px solid ${PROMOTEUR_COLORS.border}`,
    background:     PROMOTEUR_COLORS.violetBg,
    color:          PROMOTEUR_COLORS.violet,
    fontWeight:     600,
    fontSize:       "14px",
    cursor:         "pointer",
  },
} as const;

// ─── Styles de tabs ────────────────────────────────────────────────────────────

export const PROMOTEUR_TAB_STYLES = {
  active: {
    background:   PROMOTEUR_COLORS.violet,
    color:        "#FFFFFF",
    borderRadius: PROMOTEUR_RADIUS.badge,
    padding:      "7px 16px",
    fontWeight:   700,
    fontSize:     "13px",
    border:       "none",
    cursor:       "pointer",
    transition:   "background 0.15s",
  },
  inactive: {
    background:   "transparent",
    color:        PROMOTEUR_COLORS.textSecondary,
    borderRadius: PROMOTEUR_RADIUS.badge,
    padding:      "7px 16px",
    fontWeight:   500,
    fontSize:     "13px",
    border:       "none",
    cursor:       "pointer",
    transition:   "background 0.15s, color 0.15s",
  },
  subActive: {
    background:   "#FFFFFF",
    color:        PROMOTEUR_COLORS.violet,
    borderRadius: PROMOTEUR_RADIUS.tag,
    padding:      "6px 14px",
    fontWeight:   700,
    fontSize:     "12px",
    border:       `1px solid ${PROMOTEUR_COLORS.border}`,
    cursor:       "pointer",
    boxShadow:    "0 1px 3px rgba(0,0,0,0.06)",
  },
  subInactive: {
    background:   "transparent",
    color:        PROMOTEUR_COLORS.textMuted,
    borderRadius: PROMOTEUR_RADIUS.tag,
    padding:      "6px 14px",
    fontWeight:   500,
    fontSize:     "12px",
    border:       "1px solid transparent",
    cursor:       "pointer",
  },
} as const;

// ─── Style de card commun ─────────────────────────────────────────────────────

export const PROMOTEUR_CARD_STYLE: React.CSSProperties = {
  background:   PROMOTEUR_COLORS.cardBg,
  border:       `1px solid ${PROMOTEUR_COLORS.border}`,
  borderRadius: PROMOTEUR_RADIUS.card,
  boxShadow:    PROMOTEUR_SHADOWS.card,
  padding:      "24px",
};

// ─── Breadcrumb style ─────────────────────────────────────────────────────────

export const PROMOTEUR_BREADCRUMB_STYLE: React.CSSProperties = {
  fontSize:       "11px",
  color:          "rgba(255,255,255,0.60)",
  letterSpacing:  "0.10em",
  textTransform:  "uppercase" as const,
  fontWeight:     600,
  marginBottom:   "10px",
};

// ─── Raccourcis pratiques (rétro-compatibilité) ────────────────────────────────

/** Gradient horizontal – usage : background: GRAD_PRO */
export const GRAD_PRO  = PROMOTEUR_COLORS.gradH;
/** Gradient diagonale – usage : background: GRAD */
export const GRAD      = PROMOTEUR_COLORS.gradMain;
/** Violet principal */
export const ACCENT_PRO = PROMOTEUR_COLORS.violet;