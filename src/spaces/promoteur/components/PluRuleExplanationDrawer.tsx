// src/spaces/promoteur/components/PluRuleExplanationDrawer.tsx

import React from "react";
import type { PluRuleResult, PluRuleStatus } from "../plan2d/plan.plu.types";
import { PluRuleBadge } from "./PluRuleBadge";

// ─── CONTENT MAPS ─────────────────────────────────────────────────────

/** Human-readable short summary per rule × status. */
const SUMMARY: Record<string, Partial<Record<PluRuleStatus, string>>> = {
  setback: {
    CONFORME: "Le recul par rapport aux limites séparatives est respecté.",
    LIMITE:   "Le recul est conforme mais s'approche du seuil minimal réglementaire.",
    BLOQUANT: "La distance aux limites séparatives est inférieure au seuil requis.",
  },
  height: {
    CONFORME: "La hauteur estimée du bâtiment est conforme au plafond réglementaire.",
    LIMITE:   "La hauteur est conforme mais proche du maximum autorisé.",
    BLOQUANT: "La hauteur estimée dépasse le plafond réglementaire autorisé.",
  },
  coverage: {
    CONFORME: "L'emprise au sol est inférieure au coefficient maximal autorisé (CES).",
    LIMITE:   "L'emprise est conforme mais proche du plafond CES autorisé.",
    BLOQUANT: "L'emprise au sol dépasse le coefficient maximal autorisé (CES).",
  },
  parking: {
    CONFORME: "L'offre de stationnement couvre le besoin réglementaire du programme.",
    LIMITE:   "Le stationnement répond exactement au minimum requis, sans marge.",
    BLOQUANT: "Le nombre de places de stationnement est insuffisant au regard du programme.",
  },
};

/** Detailed interpretation per rule × status. */
const INTERPRETATION: Record<string, Partial<Record<PluRuleStatus, string>>> = {
  setback: {
    CONFORME: "La distance minimale mesurée entre le bâtiment et les limites de parcelle est supérieure au recul imposé. Le projet est conforme sur ce point et offre une marge par rapport au minimum réglementaire.",
    LIMITE:   "Le recul mesuré est légèrement supérieur au seuil minimal imposé. Toute modification de l'implantation ou du plan masse doit faire l'objet d'une vérification systématique des distances sur toutes les façades concernées.",
    BLOQUANT: "La distance constatée est inférieure au recul minimal imposé par le règlement de zone. Le projet ne peut être instruit en l'état. Une modification du plan masse est indispensable avant toute poursuite de l'étude.",
  },
  height: {
    CONFORME: "La hauteur estimée à partir des niveaux du bâtiment est inférieure au plafond réglementaire. Le gabarit du projet est conforme à l'article 10 du règlement de zone.",
    LIMITE:   "La hauteur estimée est conforme mais proche du plafond autorisé. Tout ajustement du programme (niveaux supplémentaires, hauteurs de plancher) devra être rigoureusement évalué au regard de cette limite.",
    BLOQUANT: "La hauteur estimée dépasse le plafond autorisé par le règlement. Le nombre de niveaux ou les hauteurs de plancher doivent être revus afin de ramener le gabarit dans l'enveloppe réglementaire.",
  },
  coverage: {
    CONFORME: "Le rapport entre l'emprise bâtie et la surface de la parcelle est inférieur au coefficient maximal autorisé. L'implantation respecte l'article 9 du règlement de zone.",
    LIMITE:   "Le CES est respecté mais le projet utilise la quasi-totalité du coefficient autorisé. Toute extension de l'empreinte bâtie devra être mesurée avec précision avant d'être envisagée.",
    BLOQUANT: "Le rapport entre l'emprise bâtie et la surface de la parcelle dépasse le CES maximal autorisé. La surface au sol bâtie doit être réduite pour se conformer à l'article 9 du règlement.",
  },
  parking: {
    CONFORME: "Le nombre de places de stationnement fourni est au moins égal au nombre requis par application du ratio PLU. L'article 12 est respecté.",
    LIMITE:   "Le stationnement fourni correspond exactement au minimum requis. Toute augmentation du programme logement entraînerait un déficit immédiat. Prévoir une provision supplémentaire lors de tout ajustement du programme.",
    BLOQUANT: "Le nombre de places de stationnement est inférieur au minimum requis par application du ratio réglementaire. Le déficit constaté doit être comblé par une offre complémentaire (sous-sol, ouvrage, mutualisation) ou une réduction du programme.",
  },
};

/** Recommended action per rule × status. */
const ACTION: Record<string, Partial<Record<PluRuleStatus, string>>> = {
  setback: {
    CONFORME: "Maintenir l'implantation actuelle lors de tout ajustement du plan masse. Vérifier les reculs sur toutes les façades en cas de modification.",
    LIMITE:   "Vérifier les distances sur l'ensemble des façades et documenter les reculs dans les plans avant validation. Consulter le règlement pour préciser les articles applicables.",
    BLOQUANT: "Reculer l'implantation par rapport aux limites séparatives. Retravailler le plan masse avec le géomètre et l'architecte afin de respecter le recul minimal sur toutes les façades concernées.",
  },
  height: {
    CONFORME: "Conserver le gabarit dans les limites actuelles lors du développement du programme architecturale.",
    LIMITE:   "Vérifier la compatibilité de toute variation de programme avec le plafond réglementaire avant de s'engager sur les niveaux définitifs.",
    BLOQUANT: "Réduire le nombre de niveaux ou revoir les hauteurs de plancher. Étudier avec l'architecte les solutions permettant de compresser le gabarit tout en optimisant les surfaces utiles.",
  },
  coverage: {
    CONFORME: "Conserver l'empreinte bâtie actuelle lors de tout ajustement du plan masse.",
    LIMITE:   "Éviter toute extension de l'empreinte bâtie. Privilégier l'optimisation des surfaces en hauteur plutôt qu'en largeur.",
    BLOQUANT: "Réduire l'emprise au sol du bâtiment ou fractionner le volume en plusieurs corps de bâtiment. Envisager des typologies plus compactes en plan avec davantage de niveaux.",
  },
  parking: {
    CONFORME: "Maintenir l'offre de stationnement en cas d'augmentation du programme ou de requalification de l'usage.",
    LIMITE:   "Anticiper toute hausse du programme logement en provisionnant un complément de stationnement dès la phase de faisabilité.",
    BLOQUANT: "Augmenter l'offre de stationnement (sous-sol, ouvrage annexe, mutualisation) ou réduire le programme logement pour ajuster le ratio. Vérifier les possibilités de mutualisation avec des bâtiments voisins.",
  },
};

/** Generic fallback for rules without specific content. */
const GENERIC: Record<PluRuleStatus, { summary: string; interpretation: string; action: string }> = {
  CONFORME: {
    summary:        "La règle analysée est respectée.",
    interpretation: "Le projet satisfait à la règle réglementaire sur ce point.",
    action:         "Maintenir les paramètres actuels lors de tout ajustement du programme.",
  },
  LIMITE: {
    summary:        "La règle est respectée mais le projet est proche du seuil réglementaire.",
    interpretation: "Tout ajustement du programme devra faire l'objet d'une vérification rigoureuse au regard de ce seuil.",
    action:         "Vérifier l'impact de toute modification du programme sur ce point avant validation.",
  },
  BLOQUANT: {
    summary:        "La règle réglementaire n'est pas respectée sur ce point.",
    interpretation: "Le projet doit être modifié pour corriger ce point de non-conformité avant toute poursuite de l'étude.",
    action:         "Corriger le point de non-conformité identifié avant de poursuivre l'étude.",
  },
};

function resolve(
  map: Record<string, Partial<Record<PluRuleStatus, string>>>,
  key: string,
  status: PluRuleStatus,
): string {
  return map[key]?.[status] ?? GENERIC[status][
    key === "summary" ? "summary" : key === "interpretation" ? "interpretation" : "action"
  ] ?? "";
}

// ─── DIRECTION MAP (min vs max rules for delta sign) ──────────────────

/** True = value should be ≥ limit (min rule); False = value should be ≤ limit (max rule). */
const IS_MIN_RULE: Record<string, boolean> = {
  setback: true,
  parking: true,
  height:  false,
  coverage: false,
};

// ─── VALUE FORMAT ─────────────────────────────────────────────────────

function fmtValue(v: number, unit: string | undefined): string {
  if (unit === "%")      return `${(v * 100).toFixed(1)} %`;
  if (unit === "places") return `${Math.round(v)} place${Math.round(v) > 1 ? "s" : ""}`;
  if (unit === "m")      return `${v.toFixed(1)} m`;
  return `${v.toFixed(2)}${unit ? ` ${unit}` : ""}`;
}

// ─── DESIGN TOKENS ────────────────────────────────────────────────────

const STATUS_ACCENT: Record<PluRuleStatus, { bar: string; light: string }> = {
  CONFORME: { bar: "#22c55e", light: "#f0fdf4" },
  LIMITE:   { bar: "#f59e0b", light: "#fffbeb" },
  BLOQUANT: { bar: "#ef4444", light: "#fef2f2" },
};

// ─── SECTION LABEL ────────────────────────────────────────────────────

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontSize:      9.5,
      fontWeight:    700,
      color:         "#94a3b8",
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      marginBottom:  6,
    }}
  >
    {children}
  </div>
);

// ─── VALUE ROW ────────────────────────────────────────────────────────

const ValueRow: React.FC<{
  label: string;
  value: string;
  accent?: string;
}> = ({ label, value, accent }) => (
  <div
    style={{
      display:        "flex",
      justifyContent: "space-between",
      alignItems:     "center",
      padding:        "6px 0",
      borderBottom:   "1px solid #f8fafc",
    }}
  >
    <span style={{ fontSize: 11.5, color: "#64748b", fontWeight: 500 }}>{label}</span>
    <span
      style={{
        fontSize:   12,
        fontWeight: 700,
        color:      accent ?? "#0f172a",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value}
    </span>
  </div>
);

// ─── COMPONENT ────────────────────────────────────────────────────────

export interface PluRuleExplanationDrawerProps {
  open:    boolean;
  onClose: () => void;
  rule:    PluRuleResult | null;
}

export const PluRuleExplanationDrawer: React.FC<PluRuleExplanationDrawerProps> = ({
  open,
  onClose,
  rule,
}) => {
  if (!open || !rule) return null;

  const accent       = STATUS_ACCENT[rule.status];
  const hasValues    = rule.value != null && rule.limit != null;
  const isMinRule    = IS_MIN_RULE[rule.key] ?? true;
  const delta        = hasValues
    ? (isMinRule ? rule.value! - rule.limit! : rule.limit! - rule.value!)
    : null;
  const deltaPositive = delta !== null && delta >= 0;

  const summary       = resolve(SUMMARY,         rule.key, rule.status);
  const interpretation = resolve(INTERPRETATION, rule.key, rule.status);
  const action        = resolve(ACTION,          rule.key, rule.status);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position:   "fixed",
          inset:      0,
          background: "rgba(15,23,42,0.18)",
          zIndex:     200,
        }}
      />

      {/* Drawer panel — anchored to the left of the sidebar (right: 380px) */}
      <div
        style={{
          position:     "fixed",
          right:        380,
          top:          0,
          height:       "100vh",
          width:        360,
          background:   "#ffffff",
          borderLeft:   "1px solid #e2e8f0",
          boxShadow:    "-4px 0 24px rgba(15,23,42,0.10)",
          zIndex:       201,
          display:      "flex",
          flexDirection: "column",
          overflowY:    "auto",
        }}
      >
        {/* Accent bar */}
        <div style={{ height: 3, background: accent.bar, flexShrink: 0 }} />

        {/* Header */}
        <div
          style={{
            padding:      "14px 18px 12px",
            borderBottom: "1px solid #f1f5f9",
            background:   accent.light,
            flexShrink:   0,
          }}
        >
          <div
            style={{
              display:        "flex",
              alignItems:     "flex-start",
              justifyContent: "space-between",
              gap:            12,
              marginBottom:   8,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize:      9.5,
                  fontWeight:    700,
                  color:         "#94a3b8",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom:  4,
                }}
              >
                Détail réglementaire
              </div>
              <div
                style={{
                  fontSize:   15,
                  fontWeight: 700,
                  color:      "#0f172a",
                  lineHeight: 1.25,
                }}
              >
                {rule.label}
              </div>
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              style={{
                flexShrink:      0,
                width:           28,
                height:          28,
                borderRadius:    "50%",
                border:          "1px solid #e2e8f0",
                background:      "#ffffff",
                cursor:          "pointer",
                display:         "flex",
                alignItems:      "center",
                justifyContent:  "center",
                fontSize:        14,
                color:           "#64748b",
                lineHeight:      1,
                padding:         0,
              }}
              aria-label="Fermer"
            >
              ×
            </button>
          </div>

          {/* Status badge + summary */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <PluRuleBadge status={rule.status} size="md" />
            <span style={{ fontSize: 12, color: "#334155", lineHeight: 1.45, flex: 1 }}>
              {summary}
            </span>
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            flex:          1,
            padding:       "16px 18px",
            display:       "flex",
            flexDirection: "column",
            gap:           18,
          }}
        >
          {/* Measured values */}
          {hasValues && (
            <div>
              <SectionLabel>Valeurs réglementaires</SectionLabel>
              <div
                style={{
                  background:   "#f8fafc",
                  border:       "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding:      "4px 12px 2px",
                }}
              >
                <ValueRow
                  label="Valeur mesurée"
                  value={fmtValue(rule.value!, rule.unit)}
                />
                <ValueRow
                  label={isMinRule ? "Seuil minimal requis" : "Seuil maximal autorisé"}
                  value={fmtValue(rule.limit!, rule.unit)}
                />
                {delta !== null && (
                  <ValueRow
                    label="Marge"
                    value={`${deltaPositive ? "+" : ""}${fmtValue(delta, rule.unit)}`}
                    accent={deltaPositive ? "#15803d" : "#b91c1c"}
                  />
                )}
              </div>
            </div>
          )}

          {/* Interpretation */}
          <div>
            <SectionLabel>Analyse</SectionLabel>
            <p
              style={{
                fontSize:   12.5,
                color:      "#334155",
                lineHeight: 1.6,
                margin:     0,
              }}
            >
              {interpretation}
            </p>
          </div>

          {/* Recommended action */}
          <div>
            <SectionLabel>Recommandation</SectionLabel>
            <div
              style={{
                background:   "#f8fafc",
                borderLeft:   `3px solid ${accent.bar}`,
                borderRadius: "0 8px 8px 0",
                padding:      "10px 14px",
              }}
            >
              <p
                style={{
                  fontSize:   12.5,
                  color:      "#334155",
                  lineHeight: 1.55,
                  margin:     0,
                  fontWeight: 500,
                }}
              >
                {action}
              </p>
            </div>
          </div>
        </div>

        {/* Footer disclaimer */}
        <div
          style={{
            padding:       "10px 18px 14px",
            borderTop:     "1px solid #f1f5f9",
            background:    "#f8fafc",
            flexShrink:    0,
          }}
        >
          <p
            style={{
              fontSize:   10.5,
              color:      "#94a3b8",
              lineHeight: 1.5,
              margin:     0,
              fontStyle:  "italic",
            }}
          >
            Analyse automatisée de faisabilité V1 — à confirmer par une lecture
            réglementaire détaillée et l'avis d'un professionnel qualifié.
          </p>
        </div>
      </div>
    </>
  );
};

export default PluRuleExplanationDrawer;