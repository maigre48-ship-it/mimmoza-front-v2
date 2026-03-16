// src/spaces/marchand/pages/Sourcing.tsx

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

const SOURCING_SMARTSCORE_KEY = "mimmoza.sourcing.smartscore.v1";
const SOURCING_SMARTSCORE_EVENT = "mimmoza:sourcing:smartscore:updated";

function fmtMoney(v: number | undefined | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v).toLocaleString("fr-FR")} €`;
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function buildDealSignature(deal: MarchandDeal): string {
  const d = deal as MarchandDeal & {
    etage?: string | number | null;
    ascenseur?: string | boolean | number | null;
    commerces?: string | null;
    transport?: string | null;
    dvfPrixM2Median?: string | number | null;
    dvfNbComparables?: string | number | null;
    dvfTendance?: string | null;
  };

  return JSON.stringify({
    id: deal.id ?? "",
    title: deal.title ?? "",
    address: deal.address ?? "",
    zipCode: deal.zipCode ?? "",
    city: deal.city ?? "",
    prixAchat: deal.prixAchat ?? null,
    surfaceM2: deal.surfaceM2 ?? null,
    etage: d.etage ?? "",
    ascenseur: d.ascenseur ?? "",
    commerces: d.commerces ?? "",
    transport: d.transport ?? "",
    dvfPrixM2Median: d.dvfPrixM2Median ?? "",
    dvfNbComparables: d.dvfNbComparables ?? "",
    dvfTendance: d.dvfTendance ?? "",
  });
}

function hydrateSourcingSmartScoreFromDeal(
  deal: MarchandDeal | null | undefined,
) {
  if (!deal) return;

  const cur = safeJsonParse<Record<string, unknown>>(
    localStorage.getItem(SOURCING_SMARTSCORE_KEY),
    {},
  );

  const nextSignature = buildDealSignature(deal);
  const currentSignature =
    typeof cur?.source === "object" &&
    cur.source !== null &&
    "dealSignature" in cur.source &&
    typeof (cur.source as { dealSignature?: unknown }).dealSignature === "string"
      ? ((cur.source as { dealSignature?: string }).dealSignature ?? "")
      : "";

  // Même contenu métier => on préserve les edits utilisateur
  if (currentSignature === nextSignature) {
    console.log("[Sourcing] hydrate SKIP — même signature:", deal.id);
    return;
  }

  console.log("[Sourcing] hydrate APPLY:", deal.id);

  const d = deal as MarchandDeal & {
    etage?: string | number | null;
    ascenseur?: string | boolean | number | null;
    commerces?: string | null;
    transport?: string | null;
    dvfPrixM2Median?: string | number | null;
    dvfNbComparables?: string | number | null;
    dvfTendance?: string | null;
  };

  const next = {
    ...(cur || {}),
    formState: {
      codePostal: deal.zipCode ? String(deal.zipCode) : "",
      ville: deal.city ? String(deal.city) : "",
      rueProche: deal.address ? String(deal.address) : "",
      titre: deal.title ? String(deal.title) : "",
      price: deal.prixAchat != null ? String(deal.prixAchat) : "",
      surface: deal.surfaceM2 != null ? String(deal.surfaceM2) : "",
      floor: d.etage != null ? String(d.etage) : "",
      elevator: d.ascenseur != null ? String(d.ascenseur) : "",
      commerces: d.commerces != null ? String(d.commerces) : "",
      transport: d.transport != null ? String(d.transport) : "",
      dvfPrixM2Median:
        d.dvfPrixM2Median != null ? String(d.dvfPrixM2Median) : "",
      dvfNbComparables:
        d.dvfNbComparables != null ? String(d.dvfNbComparables) : "",
      dvfTendance: d.dvfTendance ?? "",
    },
    savedAt: new Date().toISOString(),
    source: {
      type: "marchand.snapshot.activeDeal",
      dealId: deal.id,
      dealSignature: nextSignature,
    },
  };

  localStorage.setItem(SOURCING_SMARTSCORE_KEY, JSON.stringify(next));

  window.dispatchEvent(
    new CustomEvent(SOURCING_SMARTSCORE_EVENT, {
      detail: {
        dealId: deal.id,
        dealSignature: nextSignature,
      },
    }),
  );
}

export default function Sourcing() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onSnap = () => setTick((x) => x + 1);
    window.addEventListener(MARCHAND_SNAPSHOT_EVENT, onSnap as EventListener);
    return () =>
      window.removeEventListener(
        MARCHAND_SNAPSHOT_EVENT,
        onSnap as EventListener,
      );
  }, []);

  const snap = useMemo(() => readMarchandSnapshot(), [tick]);
  const deals: MarchandDeal[] = snap.deals ?? [];
  const activeDeal = useMemo(() => ensureActiveDeal(), [tick]);
  const activeId = snap.activeDealId ?? null;

  const activeDealSignature = useMemo(
    () => (activeDeal ? buildDealSignature(activeDeal) : ""),
    [activeDeal],
  );

  useEffect(() => {
    hydrateSourcingSmartScoreFromDeal(activeDeal);
  }, [activeDealSignature, activeDeal]);

  return (
    <PageShell
      title="Sourcing"
      subtitle="Liste des opportunités (source unique: snapshot Marchand)."
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        <SectionCard
          title="Deal actif"
          subtitle="Celui-ci alimente Analyse / Due Diligence / Exécution / Sortie"
        >
          {!activeDeal ? (
            <div style={{ color: "#334155", fontSize: 13, lineHeight: 1.7 }}>
              Aucun deal actif. Sélectionne un deal dans la liste ci-dessous.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 0.8fr",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 900, fontSize: 16 }}>
                  {activeDeal.title}{" "}
                  <span style={{ color: "#64748b", fontWeight: 700 }}>
                    ({activeDeal.id})
                  </span>
                </div>
                <div style={{ color: "#475569", fontSize: 13, marginTop: 4 }}>
                  {activeDeal.address ?? "—"}{" "}
                  {activeDeal.zipCode ? `, ${activeDeal.zipCode}` : ""}{" "}
                  {activeDeal.city ? `— ${activeDeal.city}` : ""}
                </div>
                <div style={{ color: "#64748b", fontSize: 12, marginTop: 6 }}>
                  Statut : <b style={{ color: "#0f172a" }}>{activeDeal.status}</b>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, color: "#64748b" }}>Prix d'achat</div>
                <div style={{ fontWeight: 900 }}>
                  {fmtMoney(activeDeal.prixAchat)}
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                  Surface
                </div>
                <div style={{ fontWeight: 900 }}>
                  {activeDeal.surfaceM2 != null
                    ? `${activeDeal.surfaceM2} m²`
                    : "—"}
                </div>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Opportunités"
          subtitle="Clique pour définir le deal actif"
        >
          {deals.length === 0 ? (
            <div style={{ color: "#334155", fontSize: 13, lineHeight: 1.7 }}>
              Aucun deal enregistré pour le moment.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ textAlign: "left", color: "#64748b" }}>
                    <th
                      style={{
                        padding: "10px 8px",
                        borderBottom: "1px solid rgba(15,23,42,0.10)",
                      }}
                    >
                      ID
                    </th>
                    <th
                      style={{
                        padding: "10px 8px",
                        borderBottom: "1px solid rgba(15,23,42,0.10)",
                      }}
                    >
                      Titre
                    </th>
                    <th
                      style={{
                        padding: "10px 8px",
                        borderBottom: "1px solid rgba(15,23,42,0.10)",
                      }}
                    >
                      Statut
                    </th>
                    <th
                      style={{
                        padding: "10px 8px",
                        borderBottom: "1px solid rgba(15,23,42,0.10)",
                      }}
                    >
                      Ville
                    </th>
                    <th
                      style={{
                        padding: "10px 8px",
                        borderBottom: "1px solid rgba(15,23,42,0.10)",
                      }}
                    >
                      Prix achat
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {deals.map((d) => {
                    const isActive = d.id === activeId;
                    return (
                      <tr
                        key={d.id}
                        onClick={() => {
                          setActiveDeal(d.id);
                          hydrateSourcingSmartScoreFromDeal(d);
                        }}
                        style={{
                          cursor: "pointer",
                          background: isActive
                            ? "rgba(99,102,241,0.08)"
                            : "transparent",
                        }}
                      >
                        <td
                          style={{
                            padding: "10px 8px",
                            borderBottom: "1px solid rgba(15,23,42,0.06)",
                            fontWeight: 900,
                          }}
                        >
                          {d.id}
                        </td>
                        <td
                          style={{
                            padding: "10px 8px",
                            borderBottom: "1px solid rgba(15,23,42,0.06)",
                          }}
                        >
                          {d.title}
                        </td>
                        <td
                          style={{
                            padding: "10px 8px",
                            borderBottom: "1px solid rgba(15,23,42,0.06)",
                          }}
                        >
                          {d.status}
                        </td>
                        <td
                          style={{
                            padding: "10px 8px",
                            borderBottom: "1px solid rgba(15,23,42,0.06)",
                          }}
                        >
                          {d.city ?? "—"}
                        </td>
                        <td
                          style={{
                            padding: "10px 8px",
                            borderBottom: "1px solid rgba(15,23,42,0.06)",
                          }}
                        >
                          {fmtMoney(d.prixAchat)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </PageShell>
  );
}