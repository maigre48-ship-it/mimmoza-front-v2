// src/spaces/promoteur/pages/EvaluationPage.tsx
// Règle fondamentale : le site n'invente jamais de données.
// - Estimation du bien : affichée UNIQUEMENT si DVF réel trouvé
// - Prix de sortie    : affiché UNIQUEMENT si étude de marché ou DVF réel
// - Synthèse          : idem
//
// Version corrigée :
// - Champs inutiles SQL supprimés : adresse, année, état, extérieur, parking.
// - Détail des ventes DVF conservé via fetchDvfComps.
// - Pas de rayon géographique.
// - Auto-remplissage commune depuis code postal La Poste.
// - Bouton Calculer DVF redesigné.

import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../../../supabaseClient";
import { fetchBestDvfEstimate, fetchDvfComps } from "../../../lib/dvfEstimateApi";
import type { DvfCompRow } from "../../../lib/dvfEstimateApi";
import { usePromoteurStudy } from "../shared/usePromoteurStudy";

const GRAD_PRO = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
const ACCENT_PRO = "#5247b8";
const LS_MARKET_STUDY = "synthesis_market_study";
const LS_EVALUATION = "mimmoza.promoteur.evaluation.v1";
const LOCALSTORAGE_KEY = "particulier:lastAddress";

type EstimationInputs = {
  ville: string;
  codePostal: string;
  surfaceM2: number;
  pieces: number;
  typeBien: "Appartement" | "Maison";
};

type DvfUi = {
  scope: "cp" | "commune";
  prixBas: number;
  prixCible: number;
  prixHaut: number;
  prixM2: number | null;
  transactions: number;
  confiance: "Faible" | "Moyenne" | "Élevée";
  meta?: any;
};

type MarcheMarket = {
  absorption_mensuelle: number | null;
  absorption_annuelle: number | null;
  prix_m2_median: number | null;
  prix_m2_median_neuf: number | null;
  nb_transactions: number | null;
  commune_nom: string | null;
  score_global: number | null;
};

const DEFAULT_INPUTS: EstimationInputs = {
  ville: "",
  codePostal: "",
  surfaceM2: 0,
  pieces: 0,
  typeBien: "Appartement",
};

function fmt(n: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtN(n: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);
}

function fmtD(n: number, d = 1) {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
}

function mapConf(c: "HIGH" | "MEDIUM" | "LOW" | null | undefined): DvfUi["confiance"] {
  if (c === "HIGH") return "Élevée";
  if (c === "MEDIUM") return "Moyenne";
  return "Faible";
}

function confColor(c: DvfUi["confiance"]) {
  if (c === "Élevée") return "#16a34a";
  if (c === "Moyenne") return "#d97706";
  return "#dc2626";
}

function readMarcheFromLS(): MarcheMarket {
  const empty: MarcheMarket = {
    absorption_mensuelle: null,
    absorption_annuelle: null,
    prix_m2_median: null,
    prix_m2_median_neuf: null,
    nb_transactions: null,
    commune_nom: null,
    score_global: null,
  };

  try {
    const raw = localStorage.getItem(LS_MARKET_STUDY);
    if (!raw) return empty;

    const parsed = JSON.parse(raw);
    const market = parsed?.data?.market ?? null;
    if (!market) return empty;

    return {
      absorption_mensuelle: market?.dvf?.absorption_mensuelle ?? null,
      absorption_annuelle: market?.dvf?.absorption_annuelle ?? null,
      prix_m2_median: market?.dvf?.prix_m2_median ?? null,
      prix_m2_median_neuf: market?.prices?.median_eur_m2 ?? null,
      nb_transactions: market?.dvf?.nb_transactions ?? market?.transactions?.count ?? null,
      commune_nom: parsed?.data?.meta?.commune_nom ?? null,
      score_global: market?.score ?? parsed?.score ?? null,
    };
  } catch {
    return empty;
  }
}

function pickPostalCodeFromStudy(study: any): string {
  const f = study?.foncier;
  const m = study?.marche;

  const candidates = [
    f?.code_postal,
    f?.codePostal,
    f?.cp,
    f?.address?.code_postal,
    f?.address?.codePostal,
    f?.commune?.code_postal,
    f?.commune?.codePostal,
    m?.raw_data?.meta?.code_postal,
    m?.raw_data?.meta?.codePostal,
    m?.raw_data?.address?.code_postal,
    m?.raw_data?.address?.codePostal,
  ];

  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (/^\d{5}$/.test(value)) return value;
  }

  return "";
}

async function resolveVilleFromCp(cp: string): Promise<string | null> {
  const cleanCp = String(cp ?? "").trim();

  if (!/^\d{5}$/.test(cleanCp)) return null;

  try {
    const r = await fetch(
      `https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(
        cleanCp
      )}&fields=nom,code,codesPostaux&format=json`
    );

    if (!r.ok) return null;

    const data = await r.json();
    const first = Array.isArray(data) ? data[0] : null;
    const nom = first?.nom;

    if (typeof nom === "string" && nom.trim()) {
      return nom.trim();
    }
  } catch {
    // ignore
  }

  return null;
}

async function resolveCommuneInseeFromVilleCp({
  cp,
  ville,
}: {
  cp: string;
  ville: string;
}): Promise<string | null> {
  try {
    if (cp || ville) {
      const p = new URLSearchParams();
      if (cp) p.set("codePostal", cp);
      if (ville) p.set("nom", ville);
      p.set("fields", "code,nom,codesPostaux");
      p.set("format", "json");

      const r = await fetch(`https://geo.api.gouv.fr/communes?${p.toString()}`);
      if (r.ok) {
        const d = await r.json();
        const code = d?.[0]?.code;
        if (typeof code === "string" && code.length === 5) return code;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function persistAddress(
  inputs: EstimationInputs,
  communeInsee?: string | null,
  extra?: { surface_m2?: number | null; prix?: number | null; type_local?: string | null }
) {
  try {
    const sanitizedInsee =
      communeInsee && communeInsee !== "00000" && communeInsee.trim() !== ""
        ? communeInsee.trim()
        : null;

    localStorage.setItem(
      LOCALSTORAGE_KEY,
      JSON.stringify({
        address: "",
        cp: inputs.codePostal.trim(),
        ville: inputs.ville.trim(),
        commune_insee: sanitizedInsee,
        parcel_id: null,
        surface_m2: extra?.surface_m2 ?? null,
        prix: extra?.prix ?? null,
        type_local: extra?.type_local ?? null,
      })
    );
  } catch {
    // ignore
  }
}

function qualifyAbsorption(abs: number): { label: string; color: string; bg: string } {
  if (abs < 5) return { label: "Marché peu liquide", color: "#dc2626", bg: "#fee2e2" };
  if (abs < 20) return { label: "Rythme modéré", color: "#d97706", bg: "#fef3c7" };
  if (abs < 80) return { label: "Bon rythme", color: "#16a34a", bg: "#dcfce7" };
  return { label: "Marché très actif", color: "#059669", bg: "#ecfdf5" };
}

const EvaluationPage: React.FC = () => {
  const [inputs, setInputs] = useState<EstimationInputs>(DEFAULT_INPUTS);
  const [villeAutoLoading, setVilleAutoLoading] = useState(false);
  const [villeAutoError, setVilleAutoError] = useState<string | null>(null);

  const [hasSearched, setHasSearched] = useState(false);
  const [dvfLoading, setDvfLoading] = useState(false);
  const [dvfError, setDvfError] = useState<string | null>(null);
  const [dvfBest, setDvfBest] = useState<DvfUi | null>(null);
  const [dvfDetails, setDvfDetails] = useState<{ cp: DvfUi | null; commune: DvfUi | null }>({
    cp: null,
    commune: null,
  });
  const [dvfComps, setDvfComps] = useState<DvfCompRow[]>([]);
  const [dvfCompsError, setDvfCompsError] = useState<string | null>(null);
  const [synthSaved, setSynthSaved] = useState(false);
  const [marche, setMarche] = useState<MarcheMarket>(() => readMarcheFromLS());

  useEffect(() => {
    const onFocus = () => setMarche(readMarcheFromLS());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");
  const { study, loadState } = usePromoteurStudy(studyId);

  useEffect(() => {
    if (loadState !== "ready" || !study) return;

    const f = study.foncier;
    const m = study.marche;

    const ville =
      (m?.raw_data as any)?.meta?.commune_nom ??
      (f as any)?.commune_nom ??
      (f as any)?.ville ??
      "";

    const codePostal = pickPostalCodeFromStudy(study);

    console.log("[MMZ][DVF][EvaluationPage] prefill study", {
      focus_id: f?.focus_id,
      commune_insee: f?.commune_insee,
      derived_ville: ville,
      derived_code_postal: codePostal,
    });

    setInputs((prev) => ({
      ...prev,
      ...(ville ? { ville } : {}),
      ...(codePostal ? { codePostal } : {}),
    }));
  }, [loadState, study]);

  useEffect(() => {
    const cp = inputs.codePostal.trim();

    setVilleAutoError(null);

    if (!/^\d{5}$/.test(cp)) {
      setVilleAutoLoading(false);
      return;
    }

    let cancelled = false;

    const timer = window.setTimeout(async () => {
      setVilleAutoLoading(true);

      try {
        const ville = await resolveVilleFromCp(cp);

        if (cancelled) return;

        if (ville) {
          setInputs((prev) => ({
            ...prev,
            ville,
          }));
        } else {
          setVilleAutoError("Commune introuvable pour ce code postal.");
        }
      } finally {
        if (!cancelled) setVilleAutoLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inputs.codePostal]);

  const prixSortie = useMemo(() => {
    const surface = Number(inputs.surfaceM2 || 0);
    if (surface <= 0) return null;

    const prixRef =
      marche.prix_m2_median_neuf ??
      (marche.prix_m2_median ? Math.round(marche.prix_m2_median * 1.2) : null) ??
      (dvfBest?.prixM2 ? Math.round(dvfBest.prixM2 * 1.2) : null);

    if (!prixRef) return null;

    const source = marche.prix_m2_median_neuf
      ? "Étude marché (prix neuf)"
      : marche.prix_m2_median
      ? "DVF étude marché +20%"
      : "DVF local +20%";

    return {
      prixM2Ref: prixRef,
      prixBas: Math.round(prixRef * 0.95 * surface),
      prixCible: Math.round(prixRef * surface),
      prixHaut: Math.round(prixRef * 1.05 * surface),
      source,
    };
  }, [inputs.surfaceM2, marche, dvfBest]);

  const handleComputeDvf = useCallback(async () => {
    setDvfLoading(true);
    setDvfError(null);
    setDvfBest(null);
    setDvfDetails({ cp: null, commune: null });
    setDvfComps([]);
    setDvfCompsError(null);

    let resolvedInsee: string | null = null;

    try {
      resolvedInsee = await resolveCommuneInseeFromVilleCp({
        cp: inputs.codePostal.trim(),
        ville: inputs.ville.trim(),
      });
      console.log("[MMZ][DVF][EvaluationPage] resolvedInsee", resolvedInsee);
    } catch {
      // ignore
    }

    persistAddress(inputs, resolvedInsee, {
      surface_m2: Number(inputs.surfaceM2 || 0) || null,
      type_local: inputs.typeBien ?? null,
    });

    try {
      const cp = (inputs.codePostal ?? "").toString().trim();
      const surface = Number(inputs.surfaceM2 || 0);

      if (!/^\d{5}$/.test(cp)) {
        setDvfError("Code postal La Poste invalide (5 chiffres requis, ex : 33000).");
        return;
      }

      if (!Number.isFinite(surface) || surface <= 0) {
        setDvfError("Surface habitable invalide (> 0 requis).");
        return;
      }

      const baseParams = {
        commune_insee: resolvedInsee || "00000",
        code_postal: cp,
        surface_m2: surface,
        pieces: Number.isFinite(inputs.pieces) && inputs.pieces > 0 ? inputs.pieces : null,
        months: 24,
      };

      console.log("[MMZ][DVF][EvaluationPage] payload", {
        ville: inputs.ville,
        codePostal: cp,
        surface,
        pieces: Number.isFinite(inputs.pieces) && inputs.pieces > 0 ? inputs.pieces : null,
        typeBien: inputs.typeBien,
        resolvedInsee,
        baseParams,
      });

      let res = await fetchBestDvfEstimate(supabase, { ...baseParams, type_local: inputs.typeBien });
      if (!res.best) {
        res = await fetchBestDvfEstimate(supabase, { ...baseParams, type_local: null });
      }

      console.log("[MMZ][DVF][EvaluationPage] estimate result", res);

      const toUi = (scope: "cp" | "commune", r: any): DvfUi | null => {
        if (!r?.success) return null;

        const low = r?.estimate?.low ?? null;
        const target = r?.estimate?.target ?? null;
        const high = r?.estimate?.high ?? null;

        if (low == null || target == null || high == null) return null;

        return {
          scope,
          prixBas: Number(low),
          prixCible: Number(target),
          prixHaut: Number(high),
          prixM2: r?.stats?.price_m2_median ?? null,
          transactions: r?.stats?.transactions_count ?? 0,
          confiance: mapConf(r?.confidence),
          meta: r?.meta,
        };
      };

      const cpUi = res.cp ? toUi("cp", res.cp) : null;
      const communeUi = res.commune ? toUi("commune", res.commune) : null;
      setDvfDetails({ cp: cpUi, commune: communeUi });

      const retrievedInsee = res.best?.result?.meta?.commune_insee ?? null;

      if (res.best) {
        const bestUi = toUi(res.best.scope, res.best.result);

        if (bestUi) {
          setDvfBest(bestUi);

          persistAddress(inputs, retrievedInsee || resolvedInsee, {
            surface_m2: Number(inputs.surfaceM2 || 0) || null,
            prix: bestUi.prixCible ?? null,
            type_local: inputs.typeBien ?? null,
          });

          try {
            const compsParams: any = {
              commune_insee: retrievedInsee || resolvedInsee || "00000",
              code_postal: cp,
              scope: res.best.scope === "commune" ? "commune" : "cp",
              type_local: inputs.typeBien,
              pieces: Number.isFinite(inputs.pieces) && inputs.pieces > 0 ? inputs.pieces : null,
              months: 24,
              limit: 30,
            };

            if (res.best.scope === "commune" && res.best.result?.meta?.commune_insee) {
              compsParams.commune_insee = res.best.result.meta.commune_insee;
            }

            console.log("[MMZ][DVF][EvaluationPage] comps params", compsParams);

            const compsResult = await fetchDvfComps(supabase, compsParams);

            console.log("[MMZ][DVF][EvaluationPage] comps result", compsResult);

            if (!compsResult.success) {
              setDvfComps([]);
              setDvfCompsError(compsResult.message ?? "Erreur RPC.");
            } else {
              setDvfComps(compsResult.data);
            }
          } catch (e: any) {
            setDvfComps([]);
            setDvfCompsError(e?.message ?? "Erreur ventes DVF.");
          }
        } else {
          setDvfError("Réponse DVF invalide — fourchette incalculable.");
        }
      } else {
        setDvfError(
          "Données DVF insuffisantes pour cette zone.\nConseils : vérifiez le code postal La Poste, supprimez le filtre pièces ou changez le type de bien."
        );
      }
    } catch (e: any) {
      setDvfError(e?.message ?? String(e));
    } finally {
      setHasSearched(true);
      setDvfLoading(false);
    }
  }, [inputs]);

  const handleSaveForSynthesis = useCallback(() => {
    if (!dvfBest) return;

    try {
      localStorage.setItem(
        LS_EVALUATION,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          prixCible: dvfBest.prixCible,
          prixBas: dvfBest.prixBas,
          prixHaut: dvfBest.prixHaut,
          prixM2: dvfBest.prixM2,
          confiance: dvfBest.confiance,
          prixSortieNeuf: prixSortie ?? null,
          absorptionMensuelle: marche.absorption_mensuelle,
          absorptionAnnuelle: marche.absorption_annuelle,
          prixM2Median: marche.prix_m2_median,
          prixM2MedianNeuf: marche.prix_m2_median_neuf,
          dvfLocalTransactions: dvfBest.transactions,   // ← transactions DVF locales (CP/commune)
          nbTransactions: marche.nb_transactions,        // ← conservé pour compatibilité
          surfaceM2: Number(inputs.surfaceM2 || 0) || null,
          typeBien: inputs.typeBien,
          inputs,
        })
      );
      setSynthSaved(true);
      setTimeout(() => setSynthSaved(false), 3000);
    } catch {
      // ignore
    }
  }, [dvfBest, prixSortie, marche, inputs]);

  const hasMarcheData = !!(
    marche.absorption_mensuelle != null ||
    marche.prix_m2_median ||
    marche.prix_m2_median_neuf
  );
  const absQual =
    marche.absorption_mensuelle != null ? qualifyAbsorption(marche.absorption_mensuelle) : null;
  const hasDvfData = dvfBest !== null;

  return (
    <div style={S.page}>
      <div style={S.hero}>
        <div>
          <div style={S.heroCrumb}>Promoteur › Évaluation</div>
          <div style={S.heroTitle}>Évaluation & Prix de sortie</div>
          <div style={S.heroSub}>
            Données DVF réelles uniquement — champs alignés sur les SQL existants
          </div>
        </div>

        <div style={S.heroActions}>
          {hasDvfData && (
            <button
              onClick={handleSaveForSynthesis}
              style={{
                ...S.heroButtonGhost,
                background: synthSaved ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.15)",
              }}
            >
              {synthSaved ? "✓ Enregistré" : "📌 Utiliser dans la synthèse"}
            </button>
          )}

          <button onClick={handleComputeDvf} disabled={dvfLoading} style={S.heroButton}>
            {dvfLoading ? "Recherche DVF…" : "⚡ Calculer DVF"}
          </button>
        </div>
      </div>

      <div style={S.grid}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={S.card}>
            <h2 style={S.cardTitle}>Données utilisées par le DVF</h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <FLD label="Code postal La Poste ⚠︎">
                <input
                  style={{ ...S.input, borderColor: "rgba(234,88,12,0.4)" }}
                  value={inputs.codePostal}
                  onChange={(e) =>
                    setInputs((p) => ({
                      ...p,
                      codePostal: e.target.value,
                      ville: "",
                    }))
                  }
                  placeholder="33000"
                />
              </FLD>

              <FLD label="Ville / commune">
                <input
                  style={S.input}
                  value={inputs.ville}
                  onChange={(e) => setInputs((p) => ({ ...p, ville: e.target.value }))}
                  placeholder="Remplie automatiquement"
                />

                {villeAutoLoading && (
                  <div style={{ fontSize: 11, color: "#64748b" }}>Recherche commune…</div>
                )}

                {villeAutoError && (
                  <div style={{ fontSize: 11, color: "#b45309" }}>{villeAutoError}</div>
                )}
              </FLD>

              <FLD label="Type de bien DVF">
                <select
                  style={S.input}
                  value={inputs.typeBien}
                  onChange={(e) =>
                    setInputs((p) => ({
                      ...p,
                      typeBien: e.target.value as "Appartement" | "Maison",
                    }))
                  }
                >
                  <option value="Appartement">Appartement</option>
                  <option value="Maison">Maison</option>
                </select>
              </FLD>

              <FLD label="Surface habitable / bâtie (m²)">
                <input
                  style={S.input}
                  type="number"
                  min={0}
                  max={1000}
                  value={inputs.surfaceM2 || ""}
                  onChange={(e) =>
                    setInputs((p) => ({ ...p, surfaceM2: Number(e.target.value || 0) }))
                  }
                  placeholder="ex : 65"
                />
              </FLD>

              <FLD label="Pièces — optionnel">
                <input
                  style={S.input}
                  type="number"
                  min={0}
                  max={20}
                  value={inputs.pieces || ""}
                  onChange={(e) =>
                    setInputs((p) => ({ ...p, pieces: Number(e.target.value || 0) }))
                  }
                  placeholder="laisser vide si peu de transactions"
                />
              </FLD>
            </div>

            <div style={S.infoBox}>
              ⚠️ <strong>Code postal La Poste requis</strong> — pas le code INSEE. La commune est
              recherchée automatiquement.
            </div>

            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                style={S.btnSec}
                onClick={() => {
                  setInputs(DEFAULT_INPUTS);
                  setVilleAutoError(null);
                  setVilleAutoLoading(false);
                  setDvfError(null);
                  setDvfBest(null);
                  setDvfDetails({ cp: null, commune: null });
                  setDvfComps([]);
                  setDvfCompsError(null);
                  setHasSearched(false);
                }}
              >
                ↺ Réinitialiser
              </button>

              <button style={S.btnPri} onClick={handleComputeDvf} disabled={dvfLoading}>
                {dvfLoading ? "Recherche DVF…" : "⚡ Calculer DVF"}
              </button>
            </div>
          </div>

          {hasMarcheData ? (
            <MarketCard marche={marche} absQual={absQual} />
          ) : (
            <div style={{ ...S.card, borderLeft: "4px solid #e2e8f0", background: "#f8fafc" }}>
              <div style={{ fontSize: 13, color: "#64748b" }}>
                📊 <strong>Données marché non chargées.</strong>
                <br />
                Pour afficher l'absorption mensuelle et les prix DVF de la zone, allez sur{" "}
                <strong>Études › Marché</strong>, lancez l'analyse, puis cliquez "Utiliser pour la
                synthèse".
              </div>
            </div>
          )}

          {(dvfDetails.cp || dvfDetails.commune || dvfError || dvfComps.length > 0 || dvfCompsError) && (
            <div style={S.card}>
              <div style={S.detailHeader}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#334155" }}>Détails DVF</div>
                {dvfBest && (
                  <span style={S.sourcePill}>
                    Source : {dvfBest.scope === "cp" ? "Code postal" : "Commune"}
                  </span>
                )}
              </div>

              {dvfError && <div style={S.errorText}>{dvfError}</div>}

              {!dvfError && (dvfDetails.cp || dvfDetails.commune) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                  {dvfDetails.cp && (
                    <div style={S.dvfDetail}>
                      <span style={S.dvfLabel}>Code postal — </span>
                      <strong>{dvfDetails.cp.transactions}</strong> ventes ·{" "}
                      <strong>
                        {dvfDetails.cp.prixM2 == null ? "—" : `${fmtN(dvfDetails.cp.prixM2)} €/m²`}
                      </strong>{" "}
                      · {dvfDetails.cp.confiance}
                    </div>
                  )}

                  {dvfDetails.commune && (
                    <div style={S.dvfDetail}>
                      <span style={S.dvfLabel}>Commune — </span>
                      <strong>{dvfDetails.commune.transactions}</strong> ventes ·{" "}
                      <strong>
                        {dvfDetails.commune.prixM2 == null
                          ? "—"
                          : `${fmtN(dvfDetails.commune.prixM2)} €/m²`}
                      </strong>{" "}
                      · {dvfDetails.commune.confiance}
                    </div>
                  )}
                </div>
              )}

              {dvfCompsError && <div style={S.compsWarning}>{dvfCompsError}</div>}

              {dvfComps.length > 0 && (
                <>
                  <div style={S.compsTitle}>
                    {dvfComps.length} vente{dvfComps.length > 1 ? "s" : ""} DVF affichée
                    {dvfBest
                      ? ` sur ${dvfBest.transactions} transaction${dvfBest.transactions > 1 ? "s" : ""}`
                      : ""}
                  </div>

                  <div style={{ overflowX: "auto" }}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                          {["Date", "Commune", "CP", "Type", "Pièces", "Surface", "Valeur", "€/m²"].map(
                            (h, i) => (
                              <th key={h} style={{ ...S.th, textAlign: i >= 5 ? "right" : "left" }}>
                                {h}
                              </th>
                            )
                          )}
                        </tr>
                      </thead>

                      <tbody>
                        {dvfComps.map((c, idx) => {
                          const s = Number(c.surface_reelle_bati) || 0;
                          const v = Number(c.valeur_fonciere) || 0;
                          const pm2 = Number(c.price_m2) || 0;

                          return (
                            <tr
                              key={`${c.date_mutation ?? "date"}-${idx}`}
                              style={{ background: idx % 2 === 0 ? "white" : "#f8fafc" }}
                            >
                              <td style={S.td}>{c.date_mutation ?? "—"}</td>
                              <td style={S.td}>{c.commune ?? "—"}</td>
                              <td style={S.td}>{c.code_postal ?? "—"}</td>
                              <td style={S.td}>{c.type_local ?? "—"}</td>
                              <td style={S.td}>{c.nombre_pieces_principales ?? "—"}</td>
                              <td style={{ ...S.td, textAlign: "right" }}>
                                {s > 0 ? fmtN(Math.round(s)) : "—"}
                              </td>
                              <td style={{ ...S.td, textAlign: "right" }}>{v > 0 ? fmt(v) : "—"}</td>
                              <td style={{ ...S.td, textAlign: "right" }}>
                                {pm2 > 0 ? `${fmtN(Math.round(pm2))} €/m²` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {dvfBest && dvfComps.length === 0 && !dvfCompsError && (
                <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>
                  Aucune vente DVF détaillée à afficher.
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={S.card}>
            <h2 style={S.cardTitle}>Estimation du bien acquis</h2>

            {!hasDvfData ? (
              <div style={{ fontSize: 13, padding: "16px 0" }}>
                {!hasSearched ? (
                  <span style={{ color: "#94a3b8" }}>
                    Renseignez le <strong>code postal La Poste</strong>, la surface et le type de bien,
                    puis cliquez <strong>Calculer DVF</strong>.
                  </span>
                ) : dvfError ? (
                  <div style={S.errorBox}>
                    <strong>Erreur DVF</strong> — {dvfError}
                  </div>
                ) : (
                  <div style={S.errorBox}>
                    <strong>Données manquantes</strong> — aucune transaction DVF trouvée pour cette zone.
                    <br />
                    <span style={S.errorHint}>
                      Vérifiez le code postal La Poste, supprimez le filtre pièces, ou changez le type
                      de bien.
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div style={S.kpiGrid2}>
                  <KPI label="Fourchette basse" value={fmt(dvfBest.prixBas)} />
                  <KPI label="Prix cible" value={fmt(dvfBest.prixCible)} accent />
                  <KPI label="Fourchette haute" value={fmt(dvfBest.prixHaut)} />
                  <KPI
                    label="Prix / m²"
                    value={dvfBest.prixM2 != null ? `${fmtN(dvfBest.prixM2)} €/m²` : "—"}
                  />
                </div>

                <div style={S.confBox}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#334155" }}>
                    Niveau de confiance
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 900, color: confColor(dvfBest.confiance) }}>
                    {dvfBest.confiance}
                  </span>
                </div>

                <div style={S.notesBlock}>
                  <div style={S.notesTitle}>Notes</div>
                  <ul style={S.notesList}>
                    <li>
                      Basé sur {dvfBest.transactions} transaction
                      {dvfBest.transactions > 1 ? "s" : ""} DVF réelles.
                    </li>
                    <li>
                      Périmètre utilisé : {dvfBest.scope === "cp" ? "code postal" : "commune"}.
                    </li>
                    <li>Aucune donnée absente n'est inventée ou remplacée par défaut.</li>
                  </ul>
                </div>
              </>
            )}
          </div>

          <div style={S.sortieCard}>
            <h2 style={{ ...S.cardTitle, color: ACCENT_PRO }}>🏗 Prix de sortie programme neuf</h2>

            {!prixSortie ? (
              <div style={{ fontSize: 13 }}>
                {!inputs.surfaceM2 || inputs.surfaceM2 <= 0 ? (
                  <span style={{ color: "#94a3b8" }}>Saisissez une surface habitable.</span>
                ) : !hasDvfData && !hasMarcheData ? (
                  <div style={S.errorBox}>
                    <strong>Données manquantes</strong> — le prix de sortie nécessite des données DVF
                    réelles ou une étude de marché.
                  </div>
                ) : (
                  <span style={{ color: "#94a3b8" }}>
                    Cliquez sur Calculer DVF pour obtenir des données réelles.
                  </span>
                )}
              </div>
            ) : (
              <>
                <div style={S.kpiGrid3}>
                  <KPI label="Fourchette basse" value={fmt(prixSortie.prixBas)} />
                  <KPI label="Prix cible" value={fmt(prixSortie.prixCible)} accent />
                  <KPI label="Fourchette haute" value={fmt(prixSortie.prixHaut)} />
                </div>

                <div style={S.sortieMeta}>
                  <span>
                    📐 Référence : <strong>{fmtN(prixSortie.prixM2Ref)} €/m²</strong>
                  </span>
                  <span>
                    📏 Surface : <strong>{fmtN(Number(inputs.surfaceM2))} m²</strong>
                  </span>
                  <span style={{ color: "#64748b", fontSize: 12 }}>Source : {prixSortie.source}</span>
                </div>

                {marche.absorption_mensuelle != null && marche.absorption_mensuelle < 5 && (
                  <div style={S.warningBox}>
                    ⚠️ Marché peu liquide — ce prix de sortie peut être difficile à atteindre. Envisagez
                    une décote de 5-10%.
                  </div>
                )}
              </>
            )}
          </div>

          {hasDvfData && prixSortie && (
            <div style={S.synthCard}>
              <h3 style={S.synthTitle}>✅ Synthèse évaluation</h3>

              <ul style={S.synthList}>
                <li>
                  Valeur estimée DVF :{" "}
                  <strong>
                    {fmt(dvfBest.prixBas)} – {fmt(dvfBest.prixHaut)}
                  </strong>{" "}
                  ({dvfBest.confiance}, {dvfBest.transactions} transactions)
                </li>

                {marche.prix_m2_median && (
                  <li>
                    Marché local : <strong>{fmtN(marche.prix_m2_median)} €/m²</strong> médian ancien
                    DVF
                  </li>
                )}

                <li>
                  Prix de sortie recommandé :{" "}
                  <strong>
                    {fmt(prixSortie.prixBas)} – {fmt(prixSortie.prixHaut)}
                  </strong>{" "}
                  <span style={{ fontSize: 11, fontWeight: 400 }}>({prixSortie.source})</span>
                </li>

                {marche.absorption_mensuelle != null && (
                  <li>
                    Absorption : <strong>{fmtD(marche.absorption_mensuelle)} ventes/mois</strong> —{" "}
                    {absQual?.label}
                  </li>
                )}

                <li>
                  Marge implicite brute estimée :{" "}
                  <strong>{fmt(prixSortie.prixCible - dvfBest.prixCible)}</strong> (
                  {prixSortie.prixCible > 0
                    ? fmtD(((prixSortie.prixCible - dvfBest.prixCible) / prixSortie.prixCible) * 100)
                    : "—"}
                  %)
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EvaluationPage;

const MarketCard: React.FC<{
  marche: MarcheMarket;
  absQual: { label: string; color: string; bg: string } | null;
}> = ({ marche, absQual }) => (
  <div style={{ ...S.card, borderLeft: `4px solid ${ACCENT_PRO}` }}>
    <div style={S.marketHeader}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: ACCENT_PRO }}>
        📊 Indicateurs marché
      </h3>
      {marche.commune_nom && (
        <span style={{ fontSize: 12, color: "#64748b" }}>{marche.commune_nom}</span>
      )}
    </div>

    <div style={S.kpiGrid3}>
      <div
        style={{
          ...S.kpiCard,
          ...(absQual ? { background: absQual.bg, borderColor: absQual.color + "40" } : {}),
        }}
      >
        <div style={S.kpiLabel}>Absorption mensuelle</div>
        {marche.absorption_mensuelle != null ? (
          <>
            <div style={{ fontSize: 22, fontWeight: 900, color: absQual?.color ?? "#0f172a" }}>
              {fmtD(marche.absorption_mensuelle)}
              <span style={{ fontSize: 12, fontWeight: 500 }}> /mois</span>
            </div>
            <div
              style={{
                fontSize: 11,
                color: absQual?.color ?? "#64748b",
                fontWeight: 600,
                marginTop: 4,
              }}
            >
              {absQual?.label}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: "#94a3b8" }}>—</div>
        )}
      </div>

      <div style={S.kpiCard}>
        <div style={S.kpiLabel}>Prix médian ancien DVF</div>
        {marche.prix_m2_median != null ? (
          <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>
            {fmtN(marche.prix_m2_median)}
            <span style={{ fontSize: 12, fontWeight: 500 }}> €/m²</span>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#94a3b8" }}>—</div>
        )}
      </div>

      <div style={S.kpiCard}>
        <div style={S.kpiLabel}>Prix marché neuf</div>
        {marche.prix_m2_median_neuf != null ? (
          <div style={{ fontSize: 22, fontWeight: 900, color: ACCENT_PRO }}>
            {fmtN(marche.prix_m2_median_neuf)}
            <span style={{ fontSize: 12, fontWeight: 500 }}> €/m²</span>
          </div>
        ) : marche.prix_m2_median != null ? (
          <div style={{ fontSize: 22, fontWeight: 900, color: ACCENT_PRO }}>
            {fmtN(Math.round(marche.prix_m2_median * 1.2))}
            <span style={{ fontSize: 12, fontWeight: 500 }}> €/m²</span>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#94a3b8" }}>—</div>
        )}
      </div>
    </div>
  </div>
);

const FLD: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
    <div style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>{label}</div>
    {children}
  </label>
);

const KPI: React.FC<{ label: string; value: string; accent?: boolean }> = ({
  label,
  value,
  accent,
}) => (
  <div
    style={{
      padding: 12,
      borderRadius: 12,
      background: accent ? "rgba(82,71,184,0.06)" : "#f8fafc",
      border: `1px solid ${accent ? "rgba(82,71,184,0.2)" : "rgba(15,23,42,0.06)"}`,
    }}
  >
    <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginBottom: 4 }}>
      {label}
    </div>
    <div
      style={{
        fontSize: accent ? 20 : 18,
        fontWeight: 900,
        color: accent ? ACCENT_PRO : "#0f172a",
      }}
    >
      {value}
    </div>
  </div>
);

const S = {
  page: {
    minHeight: "100vh",
    padding: "28px 18px",
    background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 45%, #eef2ff 100%)",
    color: "#0f172a",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  } as React.CSSProperties,
  hero: {
    maxWidth: 1280,
    margin: "0 auto 18px auto",
    background: GRAD_PRO,
    borderRadius: 14,
    padding: "20px 24px",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  } as React.CSSProperties,
  heroCrumb: {
    fontSize: 11,
    color: "rgba(255,255,255,0.65)",
    marginBottom: 6,
  } as React.CSSProperties,
  heroTitle: {
    fontSize: 22,
    fontWeight: 600,
    color: "white",
    marginBottom: 4,
  } as React.CSSProperties,
  heroSub: {
    fontSize: 13,
    color: "rgba(255,255,255,0.75)",
  } as React.CSSProperties,
  heroActions: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexShrink: 0,
    marginTop: 4,
  } as React.CSSProperties,
  heroButton: {
    height: 42,
    padding: "0 20px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.45)",
    background: "linear-gradient(135deg, #ffffff 0%, #f7f5ff 45%, #ede9fe 100%)",
    color: ACCENT_PRO,
    fontWeight: 900,
    fontSize: 13,
    letterSpacing: "0.01em",
    cursor: "pointer",
    boxShadow: "0 12px 28px rgba(15,23,42,0.18)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    transition: "transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease",
  } as React.CSSProperties,
  heroButtonGhost: {
    padding: "9px 16px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.4)",
    color: "white",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  } as React.CSSProperties,
  grid: {
    maxWidth: 1280,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "1.1fr 0.9fr",
    gap: 16,
  } as React.CSSProperties,
  card: {
    background: "#ffffff",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.08)",
    boxShadow: "0 4px 20px rgba(2,6,23,0.05)",
    padding: 18,
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 16,
    fontWeight: 800,
    margin: "0 0 12px 0",
  } as React.CSSProperties,
  input: {
    height: 40,
    borderRadius: 10,
    border: "1px solid rgba(15,23,42,0.12)",
    padding: "0 12px",
    outline: "none",
    background: "#ffffff",
    width: "100%",
    boxSizing: "border-box",
  } as React.CSSProperties,
  btnPri: {
    height: 42,
    padding: "0 20px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.35)",
    background: "linear-gradient(135deg, #5b4fc7 0%, #7c6fcd 45%, #b39ddb 100%)",
    color: "#fff",
    fontWeight: 900,
    fontSize: 13,
    letterSpacing: "0.01em",
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(82,71,184,0.28)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    transition: "transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease",
  } as React.CSSProperties,
  btnSec: {
    height: 42,
    padding: "0 18px",
    borderRadius: 999,
    border: "1px solid rgba(82,71,184,0.18)",
    background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 55%, #f1f5f9 100%)",
    color: "#475569",
    fontWeight: 900,
    fontSize: 13,
    letterSpacing: "0.01em",
    cursor: "pointer",
    boxShadow: "0 8px 18px rgba(15,23,42,0.08)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    transition: "transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease",
  } as React.CSSProperties,
  infoBox: {
    marginTop: 10,
    padding: "8px 12px",
    borderRadius: 8,
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    fontSize: 12,
    color: "#92400e",
  } as React.CSSProperties,
  kpiCard: {
    padding: "12px 14px",
    borderRadius: 12,
    background: "#f8fafc",
    border: "1px solid rgba(15,23,42,0.06)",
  } as React.CSSProperties,
  kpiLabel: {
    fontSize: 11,
    color: "#64748b",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: 6,
  } as React.CSSProperties,
  kpiGrid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    marginBottom: 12,
  } as React.CSSProperties,
  kpiGrid3: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 10,
    marginBottom: 12,
  } as React.CSSProperties,
  marketHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  } as React.CSSProperties,
  detailHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  } as React.CSSProperties,
  sourcePill: {
    fontSize: 12,
    fontWeight: 700,
    color: ACCENT_PRO,
    background: "rgba(82,71,184,0.08)",
    border: "1px solid rgba(82,71,184,0.2)",
    padding: "4px 10px",
    borderRadius: 999,
  } as React.CSSProperties,
  dvfDetail: {
    padding: "8px 12px",
    borderRadius: 8,
    background: "#f8fafc",
    border: "1px solid rgba(15,23,42,0.06)",
    fontSize: 13,
    color: "#334155",
  } as React.CSSProperties,
  dvfLabel: {
    color: "#64748b",
    fontWeight: 700,
    fontSize: 12,
  } as React.CSSProperties,
  errorText: {
    fontSize: 13,
    color: "#b91c1c",
    marginBottom: 8,
    whiteSpace: "pre-line",
  } as React.CSSProperties,
  errorBox: {
    color: "#b91c1c",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 10,
    padding: "12px 14px",
    whiteSpace: "pre-line",
  } as React.CSSProperties,
  errorHint: {
    fontSize: 12,
    color: "#991b1b",
    marginTop: 6,
    display: "block",
  } as React.CSSProperties,
  compsWarning: {
    fontSize: 12,
    color: "#b45309",
    fontStyle: "italic",
    marginBottom: 8,
  } as React.CSSProperties,
  compsTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
    marginBottom: 8,
  } as React.CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
    minWidth: 600,
  } as React.CSSProperties,
  th: {
    padding: "7px 6px",
    fontWeight: 800,
    color: "#334155",
    borderBottom: "2px solid rgba(15,23,42,0.12)",
    whiteSpace: "nowrap",
  } as React.CSSProperties,
  td: {
    padding: "7px 6px",
    color: "#475569",
    borderBottom: "1px solid rgba(15,23,42,0.06)",
    whiteSpace: "nowrap",
  } as React.CSSProperties,
  confBox: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "#f8fafc",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  } as React.CSSProperties,
  notesBlock: {
    borderTop: "1px solid rgba(15,23,42,0.08)",
    paddingTop: 10,
  } as React.CSSProperties,
  notesTitle: {
    fontSize: 12,
    fontWeight: 800,
    color: "#334155",
    marginBottom: 6,
  } as React.CSSProperties,
  notesList: {
    margin: 0,
    paddingLeft: 18,
    color: "#475569",
    fontSize: 13,
  } as React.CSSProperties,
  sortieCard: {
    background: "linear-gradient(135deg, #fafaff, #f0eeff)",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.08)",
    borderLeft: `4px solid ${ACCENT_PRO}`,
    boxShadow: "0 4px 20px rgba(2,6,23,0.05)",
    padding: 18,
  } as React.CSSProperties,
  sortieMeta: {
    display: "flex",
    gap: 12,
    fontSize: 13,
    color: "#334155",
    flexWrap: "wrap",
  } as React.CSSProperties,
  warningBox: {
    marginTop: 10,
    padding: "8px 12px",
    background: "#fee2e2",
    borderRadius: 8,
    fontSize: 12,
    color: "#991b1b",
  } as React.CSSProperties,
  synthCard: {
    background: "#f0fdf4",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.08)",
    borderLeft: "4px solid #16a34a",
    boxShadow: "0 4px 20px rgba(2,6,23,0.05)",
    padding: 18,
  } as React.CSSProperties,
  synthTitle: {
    margin: "0 0 10px 0",
    fontSize: 14,
    fontWeight: 800,
    color: "#166534",
  } as React.CSSProperties,
  synthList: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 13,
    color: "#166534",
    lineHeight: 1.8,
  } as React.CSSProperties,
};