import React, { useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, Clock, Euro, Star, AlertTriangle } from "lucide-react";
import PageShell from "../shared/ui/PageShell";
import SectionCard from "../shared/ui/SectionCard";
import KpiCard from "../shared/ui/KpiCard";
import {
  readMarchandSnapshot,
  patchSortieForDeal,
} from "../shared/marchandSnapshot.store";
import useMarchandSnapshotTick from "../shared/hooks/useMarchandSnapshotTick";

type ExitStrategy = "rapide" | "optimisee" | "location";

type ExitScenario = {
  id: string;
  label: string;
  strategy: ExitStrategy;
  prixRevente: number;
  delaiMois: number;
};

const eur = (n: number) =>
  n.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });

const pct = (n: number) => `${n.toFixed(1).replace(".", ",")} %`;

export default function MarchandSortie() {
  // 🔗 Live snapshot reading (réagit aux changements même onglet + multi-onglets)
  const snapTick = useMarchandSnapshotTick();
  const snapshot = useMemo(() => readMarchandSnapshot(), [snapTick]);

  // ✅ Deal actif dérivé du snapshot (réactif)
  const activeDealId = snapshot.activeDealId ?? null;
  const activeDeal = useMemo(
    () => snapshot.deals.find((d) => d.id === activeDealId) ?? null,
    [snapshot.deals, activeDealId]
  );

  // 🔗 Valeurs "référence" depuis Rentabilité (source de vérité)
  const rent = activeDealId ? snapshot.rentabiliteByDeal?.[activeDealId] : undefined;
  const rc = (rent as any)?.computed;

  const coutTotalProjet = typeof rc?.coutTotal === "number" ? rc.coutTotal : 240_000;
  const margeReference = typeof rc?.marge === "number" ? rc.marge : 2_600;
  const dureeReferenceMois = typeof rc?.dureeMois === "number" ? rc.dureeMois : 8;

  const hasComputedFromRentabilite = typeof rc?.coutTotal === "number";

  const [holdingMensuel, setHoldingMensuel] = useState(1_200);

  const [scenarios, setScenarios] = useState<ExitScenario[]>([
    { id: "A", label: "Revente rapide", strategy: "rapide", prixRevente: 250_000, delaiMois: 1 },
    { id: "B", label: "Revente optimisée", strategy: "optimisee", prixRevente: 265_000, delaiMois: 4 },
    { id: "C", label: "Location + revente", strategy: "location", prixRevente: 270_000, delaiMois: 12 },
  ]);

  // ✅ Hydration guard (évite overwrite au 1er render quand on change de deal)
  const hydratedRef = useRef<Record<string, boolean>>({});

  // Hydrate depuis snapshot (1 fois par deal)
  useEffect(() => {
    if (!activeDealId) return;

    const saved = snapshot.sortieByDeal?.[activeDealId];

    if (saved) {
      if (typeof (saved as any).holdingMensuel === "number") setHoldingMensuel((saved as any).holdingMensuel);

      const savedScenarios = (saved as any).scenarios;
      if (Array.isArray(savedScenarios) && savedScenarios.length > 0) {
        setScenarios(
          savedScenarios.map((s: any) => ({
            id: String(s.id ?? ""),
            label: String(s.label ?? ""),
            strategy: (s.strategy as ExitStrategy) ?? "rapide",
            prixRevente: Number(s.prixRevente ?? 0),
            delaiMois: Number(s.delaiMois ?? 0),
          }))
        );
      }
    }

    hydratedRef.current[activeDealId] = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDealId]);

  // Persist à chaque changement (uniquement après hydration)
  useEffect(() => {
    if (!activeDealId) return;
    if (!hydratedRef.current[activeDealId]) return;

    patchSortieForDeal(activeDealId, { holdingMensuel, scenarios });
  }, [activeDealId, holdingMensuel, scenarios]);

  // Guard: aucun deal actif (ou deal actif introuvable)
  if (!activeDealId || !activeDeal) {
    return (
      <PageShell title="Sortie" subtitle="Sélectionne un deal dans Pipeline pour synchroniser toutes les pages.">
        <SectionCard title="Aucun deal actif" subtitle="Va dans Pipeline et sélectionne un deal.">
          <div style={{ color: "#64748b", fontSize: 13, lineHeight: 1.6 }}>
            Aucun deal n'est sélectionné. Une fois un deal actif, cette page se pré-remplira automatiquement.
          </div>
        </SectionCard>
      </PageShell>
    );
  }

  const computed = useMemo(() => {
    return scenarios.map((s) => {
      const holding = s.delaiMois * holdingMensuel;
      const marge = s.prixRevente - coutTotalProjet - holding;
      const dureeTotale = dureeReferenceMois + s.delaiMois;

      const tri =
        dureeTotale > 0 && coutTotalProjet > 0
          ? (Math.pow(1 + marge / coutTotalProjet, 12 / dureeTotale) - 1) * 100
          : 0;

      return { ...s, holding, marge, tri };
    });
  }, [scenarios, holdingMensuel, coutTotalProjet, dureeReferenceMois]);

  const bestMarge = computed.length ? Math.max(...computed.map((c) => c.marge)) : 0;
  const bestTRI = computed.length ? Math.max(...computed.map((c) => c.tri)) : 0;
  const bestSpeed = computed.length ? Math.min(...computed.map((c) => c.delaiMois)) : 0;

  return (
    <PageShell
      title="Sortie"
      subtitle={`Comparer les stratégies de sortie et choisir le meilleur arbitrage. Deal actif : ${activeDeal.title}`}
    >
      {/* KPIs globaux */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <KpiCard label="Coût total projet" value={eur(coutTotalProjet)} icon={<Euro size={18} />} />
        <KpiCard label="Marge (Rentabilité)" value={eur(margeReference)} icon={<TrendingUp size={18} />} />
        <KpiCard label="Durée (Rentabilité)" value={`${dureeReferenceMois} mois`} icon={<Clock size={18} />} />
      </div>

      <div style={{ height: 12 }} />

      <SectionCard title="Hypothèses" subtitle="Paramètres de sortie (persistés par deal)">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>Holding mensuel</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="number"
                value={holdingMensuel}
                min={0}
                step={50}
                onChange={(e) => setHoldingMensuel(Number(e.target.value))}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(15, 23, 42, 0.10)",
                  background: "rgba(255,255,255,0.95)",
                  fontWeight: 800,
                  color: "#0f172a",
                  outline: "none",
                }}
              />
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900, whiteSpace: "nowrap" }}>
                € / mois
              </div>
            </div>
          </div>

          <div style={{ color: "#64748b", fontSize: 12, lineHeight: 1.6 }}>
            Holding = coûts de détention pendant la commercialisation / attente (charges, assurance, copro, etc.).
          </div>

          <div style={{ color: "#64748b", fontSize: 12, lineHeight: 1.6 }}>
            {hasComputedFromRentabilite
              ? "Coût total projet, marge & durée de référence sont synchronisés depuis Rentabilité."
              : null}
          </div>
        </div>

        {!hasComputedFromRentabilite && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 10px",
              borderRadius: 8,
              background: "rgba(245, 158, 11, 0.08)",
              border: "1px solid rgba(245, 158, 11, 0.20)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <AlertTriangle size={14} style={{ color: "#b45309", flexShrink: 0 }} />
            <div style={{ fontSize: 11, color: "#92400e", lineHeight: 1.5 }}>
              Ouvre Rentabilité et modifie un champ pour initialiser les valeurs partagées.
            </div>
          </div>
        )}
      </SectionCard>

      <div style={{ height: 12 }} />

      {/* Scénarios */}
      <SectionCard title="Scénarios de sortie" subtitle="Comparaison côte à côte">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.max(1, computed.length)}, 1fr)`,
            gap: 12,
          }}
        >
          {computed.map((s) => {
            const isBestMarge = s.marge === bestMarge;
            const isBestTRI = s.tri === bestTRI;
            const isFastest = s.delaiMois === bestSpeed;

            return (
              <div
                key={s.id}
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(15,23,42,0.08)",
                  background: "rgba(255,255,255,0.95)",
                  padding: 14,
                  boxShadow: "0 10px 25px rgba(2,6,23,0.06)",
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 15, color: "#0f172a" }}>{s.label}</div>

                <div style={{ height: 8 }} />

                <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.7 }}>
                  <div>
                    Prix sortie : <b>{eur(s.prixRevente)}</b>
                  </div>
                  <div>
                    Délai sortie : <b>{s.delaiMois} mois</b>
                  </div>
                  <div>
                    Holding : <b>{eur(s.holding)}</b>
                  </div>
                  <div>
                    Marge nette : <b>{eur(s.marge)}</b>
                  </div>
                  <div>
                    TRI projet (approx) : <b>{pct(s.tri)}</b>
                  </div>
                </div>

                <div style={{ height: 10 }} />

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {isBestMarge && <Badge text="Meilleure marge" />}
                  {isBestTRI && <Badge text="Meilleur TRI" />}
                  {isFastest && <Badge text="Sortie la plus rapide" />}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </PageShell>
  );
}

function Badge({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "4px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 900,
        background: "rgba(59,130,246,0.10)",
        border: "1px solid rgba(59,130,246,0.22)",
        color: "#1d4ed8",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <Star size={12} />
      {text}
    </div>
  );
}
