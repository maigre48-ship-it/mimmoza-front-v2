// src/spaces/promoteur/pages/Synthese.tsx
// v2 — Hero v2 : PromoteurPageHero (design unifié Promoteur)

import React from "react";
import { useSearchParams } from "react-router-dom";
import { PromoteurPageHero } from "../shared/components/PromoteurPageHero";
import { usePromoteurStudy } from "../shared/usePromoteurStudy";
import { PromoteurSynthesePage } from "./PromoteurSynthesePage";

// ---- Page -------------------------------------------------------------------

const PromoteurSynthese: React.FC = () => {
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");
  const { study, loadState } = usePromoteurStudy(studyId);

  if (loadState === "loading") {
    return (
      <div className="flex items-center justify-center py-24 gap-3">
        <div className="h-5 w-5 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
        <span className="text-sm text-slate-500">Chargement des données...</span>
      </div>
    );
  }

  return (
    <div style={{
      fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    }}>

      {/* ── Hero v2 — pleine largeur ── */}
      <div>
        <PromoteurPageHero
          badge="Promoteur · Comité"
          title="Synthèse Promoteur"
          metaLines={[
            { text: "Étude de marché, analyse économique et dossier comité d'investissement." },
            ...(study?.foncier?.commune_insee ? [{ text: `INSEE ${study.foncier.commune_insee}` }] : []),
          ]}
        />
      </div>

      {/* ── Contenu ── */}
      <div style={{ padding: "24px 0 40px" }}>
        <PromoteurSynthesePage />
      </div>
    </div>
  );
};

export default PromoteurSynthese;