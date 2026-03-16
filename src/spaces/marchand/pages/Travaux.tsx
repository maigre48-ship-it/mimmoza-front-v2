import React from "react";
import SectionCard from "../shared/ui/SectionCard";

const GRAD_INV = "linear-gradient(90deg, #2196f3 0%, #21cbf3 100%)";

export default function Travaux() {
  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fa" }}>
      {/* ── Bannière Investisseur › Exécution ── */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 24px 0" }}>
        <div style={{
          background: GRAD_INV,
          borderRadius: 14,
          padding: "20px 24px",
          marginBottom: 20,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>
              Investisseur › Exécution
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4 }}>
              Travaux
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
              Lots, budget, devis, planning, aléas.
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 24px 24px" }}>
        <SectionCard title="Plan travaux" subtitle="Placeholder : lots + estimation + suivi.">
          <div style={{ color: "#334155", fontSize: 13, lineHeight: 1.7 }}>
            Lots : démolition, plomberie, élec, menuiserie, peinture, sols, cuisine, SDB…
          </div>
        </SectionCard>
      </div>
    </div>
  );
}