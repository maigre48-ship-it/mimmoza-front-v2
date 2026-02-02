import React, { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Euro, TrendingUp, Clock, ShieldAlert, AlertTriangle } from "lucide-react";
import PageShell from "../shared/ui/PageShell";
import SectionCard from "../shared/ui/SectionCard";
import KpiCard from "../shared/ui/KpiCard";

import {
  computeNetAfterTaxes,
  getDefaultTaxConfig,
  type TaxConfig,
  type TaxRegime,
  type VatMode,
} from "../services/taxEngine";

import {
  readMarchandSnapshot,
  patchRentabiliteForDeal,
} from "../shared/marchandSnapshot.store";

import useMarchandSnapshotTick from "../shared/hooks/useMarchandSnapshotTick";

type Inputs = {
  prixAchat: number;
  fraisNotairePct: number;
  fraisAgencePct: number;
  travaux: number;
  autresFrais: number;
  dureeMois: number;
  coutDettePctAn: number;
  apportPct: number;
  prixRevente: number;
  fraisVentePct: number;
};

type Computed = {
  coutAchat: number;
  coutProjet: number;
  dette: number;
  apport: number;
  interets: number;
  coutTotal: number;
  netVente: number;
  marge: number;
  margePct: number;
  roiAnPct: number;
  triApproxPct: number;
  taxBreakdown: ReturnType<typeof computeNetAfterTaxes>;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const eur = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = (n: number) => `${n.toFixed(1).replace(".", ",")} %`;

function compute(inputs: Inputs, taxConfig: TaxConfig): Computed {
  const prixAchat = Math.max(0, inputs.prixAchat);
  const travaux = Math.max(0, inputs.travaux);
  const autresFrais = Math.max(0, inputs.autresFrais);

  const fraisNotaire = prixAchat * (Math.max(0, inputs.fraisNotairePct) / 100);
  const fraisAgence = prixAchat * (Math.max(0, inputs.fraisAgencePct) / 100);

  const coutAchat = prixAchat + fraisNotaire + fraisAgence;
  const coutProjet = coutAchat + travaux + autresFrais;

  const apportPct = clamp(inputs.apportPct, 0, 100) / 100;
  const apport = coutProjet * apportPct;
  const dette = Math.max(0, coutProjet - apport);

  const dureeAn = Math.max(0, inputs.dureeMois) / 12;
  const tauxDette = Math.max(0, inputs.coutDettePctAn) / 100;

  const interets = dette * tauxDette * dureeAn;

  const coutTotal = coutProjet + interets;

  const taxBreakdown = computeNetAfterTaxes(
    {
      prixAchat,
      travaux,
      autresFrais,
      fraisNotairePct: inputs.fraisNotairePct,
      fraisAgencePct: inputs.fraisAgencePct,
      prixRevente: inputs.prixRevente,
      fraisVentePct: inputs.fraisVentePct,
    },
    taxConfig
  );

  const netVente = taxBreakdown.netVenteApresFraisEtTaxes;

  const marge = netVente - coutTotal;
  const margePct = coutTotal > 0 ? (marge / coutTotal) * 100 : 0;

  const roiAnPct = dureeAn > 0 ? margePct / dureeAn : 0;

  const triApproxPct =
    dureeAn > 0 && coutTotal > 0
      ? (Math.pow(1 + marge / coutTotal, 1 / dureeAn) - 1) * 100
      : 0;

  return {
    coutAchat,
    coutProjet,
    dette,
    apport,
    interets,
    coutTotal,
    netVente,
    marge,
    margePct,
    roiAnPct,
    triApproxPct,
    taxBreakdown,
  };
}

function Field({
  label,
  value,
  onChange,
  suffix,
  min,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  step?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>{label}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min ?? 0}
          step={step ?? 1}
          onChange={(e) => onChange(Number(e.target.value))}
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
        {suffix && (
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900, whiteSpace: "nowrap" }}>
            {suffix}
          </div>
        )}
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function MarchandRentabilite() {
  // 🔗 Live snapshot (deal actif change => rerender)
  const snapTick = useMarchandSnapshotTick();
  const snapshot = useMemo(() => readMarchandSnapshot(), [snapTick]);

  const activeDealId = snapshot.activeDealId ?? null;
  const activeDeal = useMemo(
    () => snapshot.deals.find((d) => d.id === activeDealId) ?? null,
    [snapshot.deals, activeDealId]
  );

  const [base, setBase] = useState<Inputs>({
    prixAchat: 180000,
    fraisNotairePct: 8,
    fraisAgencePct: 0,
    travaux: 35000,
    autresFrais: 5000,
    dureeMois: 8,
    coutDettePctAn: 5.2,
    apportPct: 20,
    prixRevente: 260000,
    fraisVentePct: 6,
  });

  const [taxRegime, setTaxRegime] = useState<TaxRegime>("marchand");
  const [taxConfig, setTaxConfig] = useState<TaxConfig>(() => getDefaultTaxConfig("marchand"));

  // Hydration guard par deal (évite overwrite au 1er render)
  const hydratedRef = useRef<Record<string, boolean>>({});

  // Hydrate depuis snapshot (1 fois par deal actif)
  useEffect(() => {
    if (!activeDealId) return;

    const saved = snapshot.rentabiliteByDeal?.[activeDealId];

    if (saved) {
      setBase((saved as any).inputs as Inputs);
      setTaxRegime((saved as any).taxRegime as TaxRegime);
      setTaxConfig((saved as any).taxConfig as TaxConfig);
    }

    hydratedRef.current[activeDealId] = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDealId]);

  const handleRegime = (r: TaxRegime) => {
    setTaxRegime(r);
    setTaxConfig(getDefaultTaxConfig(r));
  };

  const computedBase = useMemo(() => compute(base, taxConfig), [base, taxConfig]);

  // ✅ Snapshot computed (source de vérité pour Sortie)
  const computedForSnapshot = useMemo(
    () => ({
      coutTotal: computedBase.coutTotal,
      marge: computedBase.marge,
      dureeMois: base.dureeMois,
      apport: computedBase.apport,
      netVente: computedBase.netVente,
      interets: computedBase.interets,
    }),
    [
      computedBase.coutTotal,
      computedBase.marge,
      computedBase.apport,
      computedBase.netVente,
      computedBase.interets,
      base.dureeMois,
    ]
  );

  // Persist à chaque changement (only after hydration)
  useEffect(() => {
    if (!activeDealId) return;
    if (!hydratedRef.current[activeDealId]) return;

    patchRentabiliteForDeal(activeDealId, {
      inputs: base,
      taxRegime,
      taxConfig,
      computed: computedForSnapshot,
    });
  }, [activeDealId, base, taxRegime, taxConfig, computedForSnapshot]);

  const pessimiste = useMemo<Inputs>(() => {
    return {
      ...base,
      prixRevente: Math.round(base.prixRevente * 0.95),
      travaux: Math.round(base.travaux * 1.15),
      dureeMois: base.dureeMois + 2,
    };
  }, [base]);

  const computedPess = useMemo(() => compute(pessimiste, taxConfig), [pessimiste, taxConfig]);

  const badge = (marge: number) => {
    if (marge >= 30000)
      return { text: "Très bon", bg: "rgba(16,185,129,0.12)", bd: "rgba(16,185,129,0.28)", c: "#065f46" };
    if (marge >= 15000)
      return { text: "OK", bg: "rgba(59,130,246,0.10)", bd: "rgba(59,130,246,0.22)", c: "#1d4ed8" };
    if (marge >= 0)
      return { text: "Fragile", bg: "rgba(245,158,11,0.12)", bd: "rgba(245,158,11,0.28)", c: "#92400e" };
    return { text: "Négatif", bg: "rgba(239,68,68,0.12)", bd: "rgba(239,68,68,0.28)", c: "#991b1b" };
  };

  const b = badge(computedBase.marge);
  const tb = computedBase.taxBreakdown;

  const showDmtoWarning = taxConfig.dmtoEnabled && base.fraisNotairePct > 0;

  // Guard: aucun deal actif
  if (!activeDealId || !activeDeal) {
    return (
      <PageShell title="Rentabilité" subtitle="Sélectionne un deal dans Pipeline pour synchroniser toutes les pages.">
        <SectionCard title="Aucun deal actif" subtitle="Va dans Pipeline et sélectionne un deal.">
          <div style={{ color: "#64748b", fontSize: 13, lineHeight: 1.6 }}>
            Aucun deal n'est sélectionné. Une fois un deal actif, cette page se pré-remplira automatiquement.
          </div>
        </SectionCard>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Rentabilité"
      subtitle="Calcul express — marge, cash requis, annualisation. (TRI = approximation, on raffinera avec cashflows ensuite.)"
      right={
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 999,
            border: `1px solid ${b.bd}`,
            background: b.bg,
            color: b.c,
            fontWeight: 900,
            fontSize: 12,
          }}
        >
          {b.text}
        </div>
      }
    >
      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <KpiCard label="Marge nette" value={eur(computedBase.marge)} hint={pct(computedBase.margePct)} icon={<TrendingUp size={18} />} />
        <KpiCard label="Cash requis (apport)" value={eur(computedBase.apport)} hint="Approx" icon={<Euro size={18} />} />
        <KpiCard label="Durée" value={`${base.dureeMois} mois`} hint={`Intérêts: ${eur(computedBase.interets)}`} icon={<Clock size={18} />} />
        <KpiCard label="TRI approx" value={pct(computedBase.triApproxPct)} hint={`ROI/an: ${pct(computedBase.roiAnPct)}`} icon={<Calculator size={18} />} />
      </div>

      <div style={{ height: 12 }} />

      {/* ⚠️ Ici tu dois recoller TON UI complète (Paramètres + Résumé).
          Dans ton message tu l'avais tronquée, donc je ne peux pas la reconstruire à l'identique sans inventer. */}
      <SectionCard title="Paramètres" subtitle={`Deal actif : ${activeDeal.title}`}>
        <div style={{ color: "#64748b", fontSize: 13 }}>
          (UI tronquée dans ton message) — recolle ici ton bloc complet Paramètres + Fiscalité + Résumé comme avant.
        </div>
      </SectionCard>

      {/* Warning DMTO */}
      {showDmtoWarning && (
        <div
          style={{
            marginTop: 12,
            padding: "8px 10px",
            borderRadius: 8,
            background: "rgba(245, 158, 11, 0.08)",
            border: "1px solid rgba(245, 158, 11, 0.20)",
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <AlertTriangle size={14} style={{ color: "#b45309", flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 11, color: "#92400e", lineHeight: 1.5 }}>
            Frais notaire ({base.fraisNotairePct}%) + DMTO activé peuvent se cumuler selon vos hypothèses.
            Vérifiez que vous ne comptez pas deux fois les droits de mutation.
          </div>
        </div>
      )}

      {/* Détail fiscal (base) mini (conserve si tu l'avais ailleurs) */}
      <div style={{ marginTop: 12, color: "#64748b", fontSize: 12, lineHeight: 1.65 }}>
        <div style={{ fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>Détail (base)</div>
        <div>• Frais vente : {eur(tb.fraisVente)}</div>
        <div>• DMTO : {eur((tb as any).dmto ?? 0)}</div>
        <div>
          • TVA nette : {eur((tb as any).vatNet ?? 0)}{" "}
          <span style={{ color: "#94a3b8" }}>
            (due {eur((tb as any).vatDue ?? 0)} · récup {eur((tb as any).vatRecoverable ?? 0)})
          </span>
        </div>
      </div>
    </PageShell>
  );
}
