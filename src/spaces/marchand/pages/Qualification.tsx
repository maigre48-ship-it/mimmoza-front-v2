// src/spaces/marchand/pages/Qualification.tsx

import React, { useEffect, useMemo, useState } from "react";
import PageShell from "../shared/ui/PageShell";
import SectionCard from "../shared/ui/SectionCard";
import {
  readMarchandSnapshot,
  ensureActiveDeal,
  setActiveDeal,
  type MarchandDeal,
  MARCHAND_SNAPSHOT_EVENT,
} from "../shared/marchandSnapshot.store";

function fmtMoney(v: number | undefined | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v).toLocaleString("fr-FR")} €`;
}

function fmtNum(v: number | undefined | null, suffix = "") {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("fr-FR")}${suffix}`;
}

export default function Qualification() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onSnap = () => setTick((x) => x + 1);
    window.addEventListener(MARCHAND_SNAPSHOT_EVENT, onSnap as any);
    return () => window.removeEventListener(MARCHAND_SNAPSHOT_EVENT, onSnap as any);
  }, []);

  const snap = useMemo(() => readMarchandSnapshot(), [tick]);
  const activeDeal: MarchandDeal | null = useMemo(() => ensureActiveDeal(), [tick]);

  const deals = snap.deals ?? [];
  const activeId = snap.activeDealId ?? null;

  return (
    <PageShell
      title="Qualification"
      subtitle="Consolider les infos clés du deal actif (source unique: snapshot Marchand)."
    >
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 16 }}>
        <SectionCard title="Deal actif" subtitle="Résumé des informations disponibles">
          {!activeDeal ? (
            <div style={{ color: "#334155", fontSize: 13, lineHeight: 1.7 }}>
              Aucun deal actif. Va dans <b>Sourcing</b> et sélectionne un deal.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Référence</div>
                <div style={{ fontWeight: 800 }}>{activeDeal.id}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Statut</div>
                <div style={{ fontWeight: 800 }}>{activeDeal.status}</div>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 12, color: "#64748b" }}>Titre</div>
                <div style={{ fontWeight: 800 }}>{activeDeal.title}</div>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 12, color: "#64748b" }}>Adresse</div>
                <div style={{ fontWeight: 700, color: "#0f172a" }}>
                  {activeDeal.address ?? "—"}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Code postal</div>
                <div style={{ fontWeight: 800 }}>{activeDeal.zipCode ?? "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Ville</div>
                <div style={{ fontWeight: 800 }}>{activeDeal.city ?? "—"}</div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Prix d'achat</div>
                <div style={{ fontWeight: 800 }}>{fmtMoney(activeDeal.prixAchat)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Surface</div>
                <div style={{ fontWeight: 800 }}>{fmtNum(activeDeal.surfaceM2, " m²")}</div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Prix revente cible</div>
                <div style={{ fontWeight: 800 }}>
                  {fmtMoney(activeDeal.prixReventeCible)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Dernière mise à jour</div>
                <div style={{ fontWeight: 700, color: "#334155" }}>
                  {activeDeal.updatedAt ? new Date(activeDeal.updatedAt).toLocaleString("fr-FR") : "—"}
                </div>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 12, color: "#64748b" }}>Note</div>
                <div style={{ color: "#334155", fontSize: 13, lineHeight: 1.6 }}>
                  {activeDeal.note ?? "—"}
                </div>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Sélection du deal actif" subtitle="Choisis quel deal alimente Analyse / Exécution / Sortie">
          {deals.length === 0 ? (
            <div style={{ color: "#334155", fontSize: 13, lineHeight: 1.7 }}>
              Aucun deal enregistré.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {deals.map((d) => {
                const isActive = d.id === activeId;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setActiveDeal(d.id)}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(15,23,42,0.10)",
                      background: isActive ? "rgba(99,102,241,0.10)" : "white",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 900 }}>
                        {d.title} <span style={{ color: "#64748b", fontWeight: 700 }}>({d.id})</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>{d.status}</div>
                    </div>
                    <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
                      {d.address ?? "—"} {d.zipCode ? `, ${d.zipCode}` : ""} {d.city ? `— ${d.city}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </PageShell>
  );
}
