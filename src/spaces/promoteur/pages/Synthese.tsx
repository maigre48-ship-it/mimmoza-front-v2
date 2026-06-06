// src/spaces/promoteur/pages/Synthese.tsx
// v2 — Hero v2 : PromoteurPageHero (design unifié Promoteur)

import React from "react";
import { useSearchParams } from "react-router-dom";
import { usePromoteurStudy } from "../shared/usePromoteurStudy";
import { usePromoteurProjectStore } from "../store/promoteurProject.store";
import { PromoteurSynthesePage } from "./PromoteurSynthesePage";
import { PromoteurPageHero } from "../shared/components/PromoteurPageHero";
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Geometry } from "geojson";

// ---- Helpers ----------------------------------------------------------------

function safeArea(feat: Feature<Geometry> | null | undefined): number {
  if (!feat?.geometry) return 0;
  try { return turf.area(feat as turf.AllGeoJSON); } catch { return 0; }
}

function sumAreas(fc?: FeatureCollection<Geometry> | null): number {
  if (!fc?.features) return 0;
  return fc.features.reduce((acc, f) => acc + safeArea(f as Feature<Geometry>), 0);
}

// ---- Page -------------------------------------------------------------------

const PromoteurSynthese: React.FC = () => {
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");
  const { study, loadState } = usePromoteurStudy(studyId);

  const buildings = usePromoteurProjectStore(s => s.buildings);
  const footprintM2 = React.useMemo(() => sumAreas(buildings), [buildings]);

  const studyData = React.useMemo(() => ({
    foncier: study?.foncier ? {
      adresse_complete: study.foncier.adresse_complete ?? undefined,
      commune:          study.foncier.commune ?? undefined,
      code_postal:      study.foncier.code_postal ?? undefined,
      departement:      study.foncier.departement ?? undefined,
      surface_m2:       study.foncier.surface_m2 ?? undefined,
      commune_insee:    study.foncier.commune_insee ?? undefined,
    } : undefined,
    plu: study?.plu ? {
      zone_plu:         study.plu.zone_plu ?? undefined,
      cos:              study.plu.cos ?? undefined,
      hauteur_max:      study.plu.hauteur_max ?? undefined,
      pleine_terre_pct: study.plu.pleine_terre_pct ?? undefined,
    } : undefined,
    marche: study?.marche ? {
      prix_m2_neuf:              study.marche.prix_m2_neuf ?? undefined,
      prix_m2_ancien:            study.marche.prix_m2_ancien ?? undefined,
      nb_transactions:           study.marche.nb_transactions ?? undefined,
      prix_moyen_dvf:            study.marche.prix_moyen_dvf ?? undefined,
      nb_programmes_concurrents: study.marche.nb_programmes_concurrents ?? undefined,
      absorption_mensuelle:      study.marche.absorption_mensuelle ?? undefined,
    } : undefined,
    risques: study?.risques ? { zonage_risque: study.risques.zonage_risque ?? undefined } : undefined,
    evaluation: study?.evaluation ? { cout_foncier: study.evaluation.cout_foncier ?? undefined } : undefined,
    bilan: study?.bilan ? {
      ca_previsionnel:      study.bilan.ca_previsionnel ?? undefined,
      prix_revient_total:   study.bilan.prix_revient_total ?? undefined,
      marge_nette:          study.bilan.marge_nette ?? undefined,
      taux_marge_nette_pct: study.bilan.taux_marge_nette_pct ?? undefined,
      taux_credit_pct:      study.bilan.taux_credit_pct ?? undefined,
    } : undefined,
  }), [study]);

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
      background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 45%, #eef2ff 100%)",
      minHeight: "100vh",
      fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    }}>

      {/* ── Hero v2 — pleine largeur ── */}
      <div style={{ padding: "16px 40px 0" }}>
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
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 40px 40px" }}>
        <PromoteurSynthesePage studyData={studyData} />
      </div>
    </div>
  );
};

export default PromoteurSynthese;