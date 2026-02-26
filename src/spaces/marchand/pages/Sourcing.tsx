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

/* ──────────────────────────────────────────────────────────────────────
 * BUG #1 FIX — hydratation par dealId
 *
 * AVANT : hasCore (codePostal|ville|rueProche) bloquait → ne re-hydratait
 *         jamais au changement de deal.
 * APRÈS : compare source.dealId au deal courant.
 *   - même dealId  → skip (préserver edits user)
 *   - nouveau deal → reset formState depuis le deal
 * ────────────────────────────────────────────────────────────────────── */
function hydrateSourcingSmartScoreFromDeal(
  deal: MarchandDeal | null | undefined,
) {
  if (!deal) return;

  const cur = safeJsonParse<any>(
    localStorage.getItem(SOURCING_SMARTSCORE_KEY),
    {},
  );
  const currentDealId: string | undefined = cur?.source?.dealId;

  // ── Même deal ⇒ préserver les edits utilisateur ──────────────────
  if (currentDealId === deal.id) {
    console.log("[Sourcing] hydrate SKIP — même dealId:", deal.id);
    return;
  }

  // ── Nouveau deal ⇒ hydrater formState ────────────────────────────
  console.log(
    "[Sourcing] hydrate NEW deal:",
    deal.id,
    "(prev:",
    currentDealId ?? "none",
    ")",
  );

  const d = deal as any; // cast flexible pour champs optionnels

  const next = {
    ...(cur || {}),
    formState: {
      // ── Core ──
      codePostal: deal.zipCode ? String(deal.zipCode) : "",
      ville: deal.city ? String(deal.city) : "",
      rueProche: deal.address ? String(deal.address) : "",
      titre: deal.title ? String(deal.title) : "",
      price: deal.prixAchat != null ? String(deal.prixAchat) : "",
      surface: deal.surfaceM2 != null ? String(deal.surfaceM2) : "",
      // ── Qualité (Bug #2) ──
      floor: d.etage != null ? String(d.etage) : "",
      elevator: d.ascenseur != null ? String(d.ascenseur) : "",
      commerces: d.commerces != null ? String(d.commerces) : "",
      transport: d.transport != null ? String(d.transport) : "",
      // ── DVF marché (Bug #3) ──
      dvfPrixM2Median: d.dvfPrixM2Median != null ? String(d.dvfPrixM2Median) : "",
      dvfNbComparables: d.dvfNbComparables != null ? String(d.dvfNbComparables) : "",
      dvfTendance: d.dvfTendance ?? "",
    },
    savedAt: new Date().toISOString(),
    source: {
      type: "marchand.snapshot.activeDeal",
      dealId: deal.id,
    },
  };

  localStorage.setItem(SOURCING_SMARTSCORE_KEY, JSON.stringify(next));
}

// ═════════════════════════════════════════════════════════════════════
export default function Sourcing() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onSnap = () => setTick((x) => x + 1);
    window.addEventListener(MARCHAND_SNAPSHOT_EVENT, onSnap as any);
    return () =>
      window.removeEventListener(MARCHAND_SNAPSHOT_EVENT, onSnap as any);
  }, []);

  const snap = useMemo(() => readMarchandSnapshot(), [tick]);
  const deals: MarchandDeal[] = snap.deals ?? [];
  const activeDeal = useMemo(() => ensureActiveDeal(), [tick]);
  const activeId = snap.activeDealId ?? null;

  useEffect(() => {
    hydrateSourcingSmartScoreFromDeal(activeDeal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDeal?.id]);

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
                  Statut :{" "}
                  <b style={{ color: "#0f172a" }}>{activeDeal.status}</b>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, color: "#64748b" }}>Prix d'achat</div>
                <div style={{ fontWeight: 900 }}>{fmtMoney(activeDeal.prixAchat)}</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>Surface</div>
                <div style={{ fontWeight: 900 }}>
                  {activeDeal.surfaceM2 != null ? `${activeDeal.surfaceM2} m²` : "—"}
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
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#64748b" }}>
                    <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>ID</th>
                    <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>Titre</th>
                    <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>Statut</th>
                    <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>Ville</th>
                    <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>Prix achat</th>
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
                          background: isActive ? "rgba(99,102,241,0.08)" : "transparent",
                        }}
                      >
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid rgba(15,23,42,0.06)", fontWeight: 900 }}>{d.id}</td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid rgba(15,23,42,0.06)" }}>{d.title}</td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid rgba(15,23,42,0.06)" }}>{d.status}</td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid rgba(15,23,42,0.06)" }}>{d.city ?? "—"}</td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid rgba(15,23,42,0.06)" }}>{fmtMoney(d.prixAchat)}</td>
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