import React, { useState, useRef, useCallback } from "react";
import { Info } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScoreTooltipContent {
  title:          string;
  description:    string;
  details:        string[];
  interpretation: string;
}

interface ScoreTooltipProps {
  content:  ScoreTooltipContent;
  children: React.ReactNode;
  /** Positionnement préféré. Default: "right" */
  position?: "right" | "top" | "left";
}

// ─── Contenu des 4 sous-scores Promoteur ─────────────────────────────────────

export const SCORE_TOOLTIPS: Record<
  "demande" | "offre" | "accessibilite" | "environnement",
  ScoreTooltipContent
> = {
  demande: {
    title: "Demande",
    description: "Mesure la pression des acheteurs ou locataires sur le marché local.",
    details: [
      "Volume de transactions DVF",
      "Dynamique des prix (si dispo)",
      "Tension marché (offre vs demande)",
      "Attractivité démographique (INSEE)",
    ],
    interpretation: "Un score élevé indique une forte demande → revente facilitée.",
  },
  offre: {
    title: "Offre",
    description: "Mesure la quantité de biens disponibles et la concurrence.",
    details: [
      "Nombre d'annonces actives",
      "Délai de vente estimé",
      "Renouvellement du stock",
      "Ratio biens / acheteurs",
    ],
    interpretation: "Un score faible = marché saturé (risque). Un score élevé = marché fluide.",
  },
  accessibilite: {
    title: "Accessibilité",
    description: "Évalue la facilité d'accès et la connectivité du quartier.",
    details: [
      "Transports (train, métro, bus)",
      "Temps d'accès aux pôles d'emploi",
      "Densité du réseau",
      "Mobilité globale",
    ],
    interpretation: "Un score élevé augmente l'attractivité et la liquidité du bien.",
  },
  environnement: {
    title: "Environnement",
    description: "Mesure la qualité de vie et les équipements autour du bien.",
    details: [
      "Écoles et services (BPE)",
      "Commerces",
      "Espaces verts",
      "Sécurité / cadre de vie (proxy)",
    ],
    interpretation: "Un score élevé améliore la valorisation long terme.",
  },
};

// ─── Composant ───────────────────────────────────────────────────────────────

const ScoreTooltip: React.FC<ScoreTooltipProps> = ({
  content,
  children,
  position = "right",
}) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), 150);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  // Positionnement CSS selon la prop `position`
  const positionClasses: Record<NonNullable<ScoreTooltipProps["position"]>, string> = {
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
    top:   "bottom-full left-1/2 -translate-x-1/2 mb-2",
    left:  "right-full top-1/2 -translate-y-1/2 mr-2",
  };

  return (
    <div
      className="relative flex items-center gap-1 cursor-pointer w-full"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {/* Contenu wrappé */}
      {children}

      {/* Icône info */}
      <Info
        size={12}
        className="opacity-50 shrink-0 text-white"
        aria-hidden="true"
      />

      {/* Tooltip panel */}
      <div
        role="tooltip"
        className={[
          "absolute z-50 w-64 p-3 rounded-xl shadow-2xl",
          "bg-slate-900 border border-slate-700",
          "text-white text-left",
          positionClasses[position],
          "transition-all duration-150 ease-out",
          visible
            ? "opacity-100 pointer-events-auto scale-100"
            : "opacity-0 pointer-events-none scale-95",
        ].join(" ")}
      >
        {/* Titre */}
        <div className="text-xs font-bold text-white uppercase tracking-wider mb-1.5">
          {content.title}
        </div>

        {/* Description */}
        <p className="text-xs text-slate-300 leading-relaxed mb-2">
          {content.description}
        </p>

        {/* Séparateur */}
        <div className="h-px bg-slate-700/60 mb-2" />

        {/* Données utilisées */}
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
          Données utilisées
        </div>
        <ul className="flex flex-col gap-1 mb-2">
          {content.details.map((detail, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-slate-300">
              <span className="mt-1 w-1 h-1 rounded-full bg-indigo-400 shrink-0" />
              {detail}
            </li>
          ))}
        </ul>

        {/* Séparateur */}
        <div className="h-px bg-slate-700/60 mb-2" />

        {/* Interprétation */}
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
          Interprétation
        </div>
        <p className="text-xs text-indigo-300 leading-relaxed italic">
          {content.interpretation}
        </p>
      </div>
    </div>
  );
};

export default ScoreTooltip;