// src/spaces/promoteur/shared/components/PromoteurCard.tsx
// VERSION 1.0.0 — Card unifiée Promoteur

import React from "react";
import {
  PROMOTEUR_COLORS,
  PROMOTEUR_RADIUS,
  PROMOTEUR_SHADOWS,
} from "../promoteurDesign.tokens";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PromoteurCardProps {
  /** Contenu de l'en-tête */
  header?: React.ReactNode;
  /** Icône dans le header (JSX) */
  headerIcon?: React.ReactNode;
  /** Titre du header (string simple) */
  headerTitle?: string;
  /** Actions/badges à droite du header */
  headerActions?: React.ReactNode;
  /** Contenu principal */
  children: React.ReactNode;
  /** Padding du body (override) */
  bodyPadding?: string | number;
  /** Hover subtil */
  hoverable?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

// ─── Composant ────────────────────────────────────────────────────────────────

export const PromoteurCard: React.FC<PromoteurCardProps> = ({
  header,
  headerIcon,
  headerTitle,
  headerActions,
  children,
  bodyPadding = "24px",
  hoverable = false,
  className,
  style,
}) => {
  const hasHeader = !!(header || headerTitle || headerIcon || headerActions);

  return (
    <div
      className={className}
      style={{
        background:   PROMOTEUR_COLORS.cardBg,
        border:       `1px solid ${PROMOTEUR_COLORS.border}`,
        borderRadius: PROMOTEUR_RADIUS.card,
        boxShadow:    PROMOTEUR_SHADOWS.card,
        overflow:     "hidden",
        transition:   hoverable ? "box-shadow 0.18s ease, transform 0.18s ease" : undefined,
        ...style,
      }}
      onMouseEnter={hoverable ? (e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = PROMOTEUR_SHADOWS.cardHover;
        (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
      } : undefined}
      onMouseLeave={hoverable ? (e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = PROMOTEUR_SHADOWS.card;
        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
      } : undefined}
    >
      {/* ── Header ── */}
      {hasHeader && (
        <div style={{
          padding:       "16px 20px",
          borderBottom:  `1px solid ${PROMOTEUR_COLORS.border}`,
          background:    PROMOTEUR_COLORS.pageBg,
          display:       "flex",
          alignItems:    "center",
          justifyContent:"space-between",
          gap:           "12px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            {headerIcon}
            {headerTitle && (
              <span style={{
                fontSize:   "14px",
                fontWeight: 700,
                color:      PROMOTEUR_COLORS.textPrimary,
                whiteSpace: "nowrap",
                overflow:   "hidden",
                textOverflow:"ellipsis",
              }}>
                {headerTitle}
              </span>
            )}
            {header}
          </div>
          {headerActions && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
              {headerActions}
            </div>
          )}
        </div>
      )}

      {/* ── Body ── */}
      <div style={{ padding: bodyPadding }}>
        {children}
      </div>
    </div>
  );
};

// ─── Sous-composant : Card sans header (usage inline rapide) ──────────────────

export const PromoteurInlineCard: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style }) => (
  <div style={{
    background:   PROMOTEUR_COLORS.cardBg,
    border:       `1px solid ${PROMOTEUR_COLORS.border}`,
    borderRadius: PROMOTEUR_RADIUS.inner,
    padding:      "16px",
    ...style,
  }}>
    {children}
  </div>
);

// ─── Badge de statut ──────────────────────────────────────────────────────────

export const PromoteurBadge: React.FC<{
  children: React.ReactNode;
  variant?: "violet" | "success" | "warning" | "error" | "neutral";
  style?: React.CSSProperties;
}> = ({ children, variant = "violet", style }) => {
  const configs = {
    violet:  { bg: PROMOTEUR_COLORS.violetBg,  color: PROMOTEUR_COLORS.violet  },
    success: { bg: "#ECFDF5",                  color: "#065F46"                },
    warning: { bg: "#FFFBEB",                  color: "#92400E"                },
    error:   { bg: "#FEF2F2",                  color: "#991B1B"                },
    neutral: { bg: PROMOTEUR_COLORS.pageBg,    color: PROMOTEUR_COLORS.textSecondary },
  };
  const cfg = configs[variant];

  return (
    <span style={{
      display:      "inline-flex",
      alignItems:   "center",
      gap:          "4px",
      padding:      "3px 10px",
      borderRadius: "6px",
      fontSize:     "11px",
      fontWeight:   700,
      background:   cfg.bg,
      color:        cfg.color,
      ...style,
    }}>
      {children}
    </span>
  );
};

export default PromoteurCard;