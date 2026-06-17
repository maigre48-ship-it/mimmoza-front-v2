// src/spaces/promoteur/shared/components/PromoteurPageHero.tsx
// VERSION 2.0.0 — Design identique à VeilleMarchePage
//   Reproduit fidèlement :
//   - rounded-[32px]
//   - gradient from-[#6f5bd6] via-[#8d78df] to-[#b39ddb]
//   - badge pill "PROMOTEUR · NOM PAGE" en haut à gauche
//   - h1 text-4xl font-semibold tracking-tight
//   - meta-lines (icône + texte) en slate-200
//   - stat cards à droite fond semi-transparent (grille 2 cols)

import { Sparkles } from "lucide-react";
import React from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HeroStatCard {
  /** Libellé en uppercase */
  label: string;
  /** Valeur affichée en grand */
  value: string;
  /** Teinte — reprend les deux tons de Veille marché */
  tone?: "indigo" | "emerald";
}

export interface HeroMetaLine {
  /** Icône Lucide (élément JSX) */
  icon?: React.ReactNode;
  /** Texte de la ligne */
  text: React.ReactNode;
}

export interface PromoteurPageHeroProps {
  /**
   * Texte du badge pill en haut à gauche.
   * Convention : "PROMOTEUR · NOM PAGE"
   * Ex: "Promoteur · Foncier & PLU"
   */
  badge: string;

  /** H1 principal */
  title: string;

  /**
   * Lignes de meta sous le titre (icône + texte).
   * Identiques aux lignes slate-200 de VeilleMarchePage.
   */
  metaLines?: HeroMetaLine[];

  /**
   * Stat cards à droite (max 4, grille 2×2 comme VeilleMarchePage).
   * Si absent, la zone droite est vide.
   */
  statCards?: HeroStatCard[];

  /** Actions à droite (boutons) — s'affichent sous les statCards */
  actions?: React.ReactNode;

  className?: string;
  style?: React.CSSProperties;
}

// ─── HeroStatCard interne ─────────────────────────────────────────────────────

function StatCard({ label, value, tone = "indigo" }: HeroStatCard) {
  const classes =
    tone === "indigo"
      ? "border-indigo-400/20 bg-indigo-400/10"
      : "border-emerald-400/20 bg-emerald-400/10";

  return (
    <div className={`rounded-[24px] border p-4 ${classes}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PromoteurPageHero({
  badge,
  title,
  metaLines,
  statCards,
  actions,
  className,
  style,
}: PromoteurPageHeroProps) {
  const hasRight = (statCards && statCards.length > 0) || actions;

  return (
    <div
      className={`overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)] ${className ?? ""}`}
      style={style}
    >
      {/* ── Gradient header — identique à VeilleMarchePage ── */}
      <div className="border-b border-slate-100 bg-gradient-to-r from-[#6f5bd6] via-[#8d78df] to-[#b39ddb] px-8 py-8 text-white">
        <div className="flex flex-wrap items-start justify-between gap-6">

          {/* ── Zone gauche : badge + titre + meta ── */}
          <div className="max-w-2xl">
            {/* Badge pill */}
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/90">
              <Sparkles className="h-3.5 w-3.5" />
              {badge}
            </div>

            {/* H1 */}
            <h1 className="text-4xl font-semibold tracking-tight">
              {title}
            </h1>

            {/* Meta lines */}
            {metaLines && metaLines.length > 0 && (
              <div className="mt-4 space-y-2 text-sm text-slate-200">
                {metaLines.map((line, i) => (
                  <p key={i} className="flex items-center gap-2">
                    {line.icon}
                    {line.text}
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* ── Zone droite : stat cards + actions ── */}
          {hasRight && (
            <div className="flex flex-col gap-3">
              {statCards && statCards.length > 0 && (
                <div className="grid min-w-[280px] gap-3 sm:grid-cols-2">
                  {statCards.map((card, i) => (
                    <StatCard key={i} {...card} />
                  ))}
                </div>
              )}
              {actions && (
                <div className="flex flex-wrap items-center gap-3">
                  {actions}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Composants utilitaires ───────────────────────────────────────────────────

/**
 * Bouton primary blanc sur fond violet — identique au bouton
 * "Nouvelle opportunité" du Dashboard.
 */
export function HeroPrimaryButton({
  children,
  onClick,
  disabled,
  title: tooltipTitle,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={tooltipTitle}
      className="inline-flex items-center gap-2 rounded-2xl border border-white/30 bg-white px-5 py-3 text-sm font-semibold text-[#6f5bd6] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/**
 * Bouton ghost blanc translucide — identique au bouton
 * "Import Kel Foncier" du Dashboard.
 */
export function HeroGhostButton({
  children,
  onClick,
  disabled,
  title: tooltipTitle,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={tooltipTitle}
      className="inline-flex items-center gap-2 rounded-2xl border border-white/30 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/**
 * Badge pill "Étude XXXX…" à placer dans metaLines.
 */
export function StudyIdBadge({ studyId }: { studyId: string | null }) {
  if (!studyId) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white/90">
      Étude&nbsp;{studyId.slice(0, 8)}…
    </span>
  );
}

export default PromoteurPageHero;