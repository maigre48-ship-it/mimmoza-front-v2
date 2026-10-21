// BandeauSynchroModele.tsx — R5 : état de synchronisation du Bilan avec le modèle 3D
import React, { useEffect, useState } from "react";
import type { EcartProgrammation, MetreStudioV2 } from "./metreStudio";

export function ilYA(iso: string | null, maintenant: number): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((maintenant - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "—";
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86_400)} j`;
}

const SOURCE: Record<string, string> = { mesure: "mesuré", estime: "estimé", saisi: "saisi" };

export const BandeauSynchroModele: React.FC<{
  modeleActif: boolean;
  origine: "studio" | "massing" | null;
  majLe: string | null;
  metre: MetreStudioV2 | null;
  ecart: EcartProgrammation | null;
  programmationPresente: boolean;
}> = ({ modeleActif, origine, majLe, metre, ecart, programmationPresente }) => {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setMaintenant(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (!modeleActif) {
    return (
      <div data-testid="bandeau-synchro-modele" style={{ marginBottom: 16, padding: "10px 16px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, fontSize: 13, color: "#334155" }}>
        Aucun modèle 3D relié à cette étude{programmationPresente ? " — la Programmation sert de valeur par défaut." : "."}
      </div>
    );
  }
  const t = metre?.totaux;
  return (
    <div data-testid="bandeau-synchro-modele" style={{ marginBottom: 16, padding: "10px 16px", background: "#ecfdf5", border: "1px solid #6ee7b7", borderLeft: "4px solid #059669", borderRadius: 12, fontSize: 13, color: "#064e3b" }}>
      <strong>Bilan synchronisé avec le modèle 3D — mis à jour il y a {ilYA(majLe, maintenant)}</strong>
      <span style={{ marginLeft: 8, fontSize: 12 }}>
        {origine === "studio" ? `Studio 3D · ${metre?.nom ?? ""} · révision ${metre?.revision ?? "?"} · empreinte ${metre?.empreinte ?? "?"}` : "Massing 3D"}
      </span>
      {origine === "studio" && t && (
        <div style={{ marginTop: 4, fontSize: 12 }}>
          SDP {Math.round(t.sdpM2.valeur)} m² ({SOURCE[t.sdpM2.source]}) · {t.logements.valeur} logement(s) ({SOURCE[t.logements.source]})
          {" "}· {t.niveauxMax.valeur} niveau(x) · emprise {Math.round(t.empriseSolM2.valeur)} m²{t.ces ? ` · CES ${t.ces.valeur.toFixed(2)}` : ""}
          {t.stationnement.valeur > 0 ? ` · ${t.stationnement.valeur} places` : ""}
          {t.commerceM2.valeur > 0 ? ` · commerce ${Math.round(t.commerceM2.valeur)} m²` : ""}
          {t.bureauxM2.valeur > 0 ? ` · bureaux ${Math.round(t.bureauxM2.valeur)} m²` : ""}
          {metre?.quartier ? ` · voirie ${Math.round(metre.quartier.voirieM2.valeur)} m² · espaces verts ${Math.round(metre.quartier.espacesVertsM2.valeur)} m²` : ""}
        </div>
      )}
      {ecart?.notable && (
        <div role="status" style={{ marginTop: 6, padding: "6px 10px", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, color: "#78350f", fontSize: 12 }}>
          ⚠ Écart notable entre la Programmation et le modèle (le modèle fait foi ; vos hypothèses de prix et de coûts sont conservées) :
          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{ecart.lignes.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      )}
    </div>
  );
};
