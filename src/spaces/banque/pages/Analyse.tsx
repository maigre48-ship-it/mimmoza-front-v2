// ============================================================================
// Analyse.tsx — Banque: analyse financière du dossier + SmartScore
// ✅ SmartScore entry point — DossierContextBar supprimé (doublon avec AppShell)
// La saisie financière reste ici ; le sous-onglet "Analyse de risque" dans AppShell
// pointe désormais vers /banque/smartscore/:id (dashboard SmartScore).
// Cette page reste accessible via /banque/analyse/:id pour la saisie détaillée.
// ============================================================================

import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useBanqueDossierContext } from "../hooks/useBanqueDossierContext";
import { useSmartScore } from "../hooks/useSmartScore";
import { upsertDossier, addEvent } from "../store/banqueSnapshot.store";
import type { DossierAnalyse } from "../store/banqueSnapshot.types";

import SmartScorePanel from "../components/SmartScorePanel";
import { Flame, RefreshCw, ShieldAlert } from "lucide-react";

// ✅ FIX Vite alias: use relative import instead of "@/..."
import { supabase } from "../../../lib/supabaseClient";

// 🆕 Banque scoring — Types locaux pour risks_data.scoring
interface RisksScoring {
  score: number;
  grade: string;
  level_label: string;
  confidence?: number; // 0..1 (optionnel selon payload)
  rationale: string[];
}

interface RisksData {
  scoring?: RisksScoring;
  [key: string]: unknown;
}

interface BanqueDossierRow {
  id: string;
  risks_data?: RisksData | null;
  risks_status?: string | null;
  risks_updated_at?: string | null;
  lat?: number | null;
  lng?: number | null;
  [key: string]: unknown;
}

export default function BanqueAnalyse() {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id: string }>();

  const { dossierId, dossier, refresh } = useBanqueDossierContext();
  const { result: smartScore, recalculate, isComputing, error: ssError } = useSmartScore();

  const [form, setForm] = useState<DossierAnalyse>({});
  const [saved, setSaved] = useState(false);

  // 🆕 Banque scoring — état pour le scoring risques depuis Supabase
  const [risksScoring, setRisksScoring] = useState<RisksScoring | null>(null);
  const [risksLoading, setRisksLoading] = useState(false);
  const [risksRecalculating, setRisksRecalculating] = useState(false);

  // 🆕 affichage d'info persistance (optionnel mais utile)
  const [risksMeta, setRisksMeta] = useState<{
    status?: string | null;
    updatedAt?: string | null;
    lat?: number | null;
    lng?: number | null;
  } | null>(null);

  const effectiveId = dossierId ?? routeId;

  useEffect(() => {
    if (dossier?.analyse) setForm(dossier.analyse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossier?.id]);

  // 🆕 Banque scoring — charger risks_data.scoring depuis Supabase
  const loadRisksScoring = useCallback(async () => {
    if (!effectiveId) return;
    setRisksLoading(true);
    try {
      const { data, error } = await supabase
        .from("banque_dossiers")
        .select("id, risks_data, risks_status, risks_updated_at, lat, lng")
        .eq("id", effectiveId)
        .single<BanqueDossierRow>();

      if (error) {
        console.error("[Analyse] Erreur chargement risks_data:", error.message);
        setRisksScoring(null);
        setRisksMeta(null);
      } else {
        setRisksScoring(data?.risks_data?.scoring ?? null);
        setRisksMeta({
          status: data?.risks_status ?? null,
          updatedAt: data?.risks_updated_at ?? null,
          lat: data?.lat ?? null,
          lng: data?.lng ?? null,
        });
      }
    } catch (err) {
      console.error("[Analyse] Exception chargement risks_data:", err);
      setRisksScoring(null);
      setRisksMeta(null);
    } finally {
      setRisksLoading(false);
    }
  }, [effectiveId]);

  useEffect(() => {
    loadRisksScoring();
  }, [loadRisksScoring]);

  // ✅ STRATÉGIE 2 — recalculer/persister via Edge Function risks-refresh-v1
  // - committee-report ne fetch plus jamais : il lit banque_dossiers.risks_data
  const handleRecalculateRisks = async () => {
    if (!effectiveId) return;
    setRisksRecalculating(true);

    try {
      // 🔎 On essaie de fournir une adresse si dispo (la function saura geocoder BAN)
      // Ajuste si ton champ d'adresse est différent.
      const adresse =
        (dossier as any)?.origination?.adresse ??
        (dossier as any)?.origination?.adresseProjet ??
        (dossier as any)?.origination?.adresseBien ??
        undefined;

      // Optionnel: si tu as déjà lat/lng dans dossier origination
      const lat = (dossier as any)?.origination?.lat ?? undefined;
      const lng = (dossier as any)?.origination?.lng ?? undefined;

      const { error } = await supabase.functions.invoke("risks-refresh-v1", {
        body: {
          dossierId: effectiveId,
          adresse,
          lat,
          lng,
          rayon_m: 500,
        },
      });

      if (error) {
        console.error("[Analyse] Erreur refresh risques (risks-refresh-v1):", error.message);
        addEvent({
          type: "risks_refresh_error",
          dossierId: effectiveId,
          message: `Erreur refresh risques: ${error.message}`,
        });
      } else {
        await loadRisksScoring();
        addEvent({
          type: "risks_refreshed",
          dossierId: effectiveId,
          message: "Risques persistés via risks-refresh-v1 (lat/lng + risks_data)",
        });
        // Si tu veux: refresh snapshot local aussi (sans casser le reste)
        refresh();
      }
    } catch (err) {
      console.error("[Analyse] Exception refresh risques:", err);
      addEvent({
        type: "risks_refresh_error",
        dossierId: effectiveId,
        message: "Exception refresh risques (voir console)",
      });
    } finally {
      setRisksRecalculating(false);
    }
  };

  const update = (key: keyof DossierAnalyse, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    if (!effectiveId) return;
    upsertDossier({ id: effectiveId, analyse: form, status: "analyse" });
    addEvent({
      type: "analyse_updated",
      dossierId: effectiveId,
      message: `Analyse mise à jour — Score: ${form.scoreCreditGlobal ?? "N/A"}`,
    });
    refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  /** Sauvegarde l'analyse PUIS recalcule le SmartScore */
  const handleRecalculate = () => {
    if (effectiveId) {
      upsertDossier({ id: effectiveId, analyse: form, status: "analyse" });
      refresh();
    }

    const result = recalculate({
      finance: {
        scoreCreditGlobal: form.scoreCreditGlobal,
        ratioLTV: form.ratioLTV,
        ratioDSCR: form.ratioDSCR,
        tauxEndettement: form.tauxEndettement,
        fondsPropresPct: form.fondsPropresPct,
        triProjet: form.triProjet,
        chiffreAffairesPrev: form.chiffreAffairesPrev,
        margeBrutePrev: form.margeBrutePrev,
      },
    });

    if (result && effectiveId) {
      addEvent({
        type: "smartscore_computed",
        dossierId: effectiveId,
        message: `SmartScore: ${result.score}/100 (${result.grade}) — ${result.verdict}`,
      });
    }
  };

  const numField = (label: string, key: keyof DossierAnalyse, suffix?: string) => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label}
        {suffix ? ` (${suffix})` : ""}
      </label>
      <input
        type="number"
        step="any"
        value={(form[key] as number)?.toString() ?? ""}
        onChange={(e) => update(key, e.target.value ? Number(e.target.value) : undefined)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
      />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">Analyse financière</h1>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600 font-medium">✓ Sauvegardé</span>}

          {effectiveId && (
            <button
              type="button"
              onClick={() => navigate(`/banque/smartscore/${effectiveId}`)}
              className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition-colors"
            >
              Voir SmartScore
            </button>
          )}

          {effectiveId && (
            <button
              type="button"
              onClick={() => navigate(`/banque/outil-risques/${effectiveId}`)}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 hover:border-red-300 transition-colors"
            >
              <Flame className="h-4 w-4" />
              Étude de risques
            </button>
          )}
        </div>
      </div>

      {!effectiveId ? (
        <p className="text-sm text-slate-500">Sélectionnez un dossier depuis le tableau de bord.</p>
      ) : (
        <div className="space-y-6">
          <SmartScorePanel
            result={smartScore}
            onRecalculate={handleRecalculate}
            isComputing={isComputing}
            error={ssError}
          />

          {/* 🆕 Banque scoring — Bloc scoring risques depuis risks_data */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-600" />
                <h2 className="text-sm font-semibold text-slate-700">Score de risques</h2>
              </div>

              <button
                type="button"
                onClick={handleRecalculateRisks}
                disabled={risksRecalculating}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`h-3 w-3 ${risksRecalculating ? "animate-spin" : ""}`} />
                Rafraîchir risques
              </button>
            </div>

            {/* Petit meta (facultatif) */}
            {risksMeta?.updatedAt && (
              <div className="mb-3 text-[11px] text-slate-400">
                Dernière mise à jour:{" "}
                <span className="text-slate-500 font-medium">
                  {new Date(risksMeta.updatedAt).toLocaleString("fr-FR")}
                </span>
                {typeof risksMeta.lat === "number" && typeof risksMeta.lng === "number" && (
                  <>
                    {" "}
                    — <span className="text-slate-500">({risksMeta.lat.toFixed(5)}, {risksMeta.lng.toFixed(5)})</span>
                  </>
                )}
                {risksMeta.status && (
                  <>
                    {" "}
                    — <span className="text-slate-500">statut: {risksMeta.status}</span>
                  </>
                )}
              </div>
            )}

            {risksLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Chargement du scoring…
              </div>
            ) : risksScoring ? (
              <div className="space-y-3">
                <div className="flex items-baseline gap-3">
                  <span className="text-3xl font-bold text-slate-900">
                    {risksScoring.score}
                    <span className="text-base font-normal text-slate-400">/100</span>
                  </span>

                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      risksScoring.score >= 70
                        ? "bg-green-100 text-green-800"
                        : risksScoring.score >= 40
                          ? "bg-amber-100 text-amber-800"
                          : "bg-red-100 text-red-800"
                    }`}
                  >
                    {risksScoring.grade}
                  </span>

                  <span className="text-sm text-slate-500">{risksScoring.level_label}</span>

                  {typeof risksScoring.confidence === "number" && (
                    <span className="text-xs text-slate-400">
                      Confiance {(risksScoring.confidence * 100).toFixed(0)}%
                    </span>
                  )}
                </div>

                {Array.isArray(risksScoring.rationale) && risksScoring.rationale.length > 0 && (
                  <ul className="space-y-1">
                    {risksScoring.rationale.slice(0, 3).map((reason, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-600">
                        <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                        {reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">
                Risques non renseignés — cliquez sur « Rafraîchir risques » (dans Analyse) pour persister les données.
              </p>
            )}
          </section>

          {/* Scoring manuel */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Scoring crédit</h2>
            <div className="grid grid-cols-3 gap-4">
              {numField("Score crédit global", "scoreCreditGlobal", "0-100")}
              {numField("LTV", "ratioLTV", "%")}
              {numField("DSCR", "ratioDSCR")}
            </div>
          </section>

          {/* Ratios financiers */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Ratios financiers</h2>
            <div className="grid grid-cols-3 gap-4">
              {numField("Taux d'endettement", "tauxEndettement", "%")}
              {numField("Fonds propres", "fondsPropresPct", "%")}
              {numField("TRI projet", "triProjet", "%")}
            </div>
          </section>

          {/* Prévisionnel */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Prévisionnel</h2>
            <div className="grid grid-cols-2 gap-4">
              {numField("CA prévisionnel", "chiffreAffairesPrev", "€")}
              {numField("Marge brute prévisionnelle", "margeBrutePrev", "€")}
            </div>
          </section>

          {/* Commentaire */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Commentaire analyste</h2>
            <textarea
              value={form.commentaireAnalyste ?? ""}
              onChange={(e) => update("commentaireAnalyste", e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              placeholder="Avis de l'analyste crédit..."
            />
          </section>

          {dossier?.origination.montantDemande && (
            <section className="rounded-lg border border-blue-100 bg-blue-50 p-5">
              <h2 className="text-sm font-semibold text-blue-800 mb-3">
                Données d'origination (lecture seule)
              </h2>
              <div className="grid grid-cols-4 gap-4 text-xs">
                <KPI
                  label="Montant demandé"
                  value={`${(dossier.origination.montantDemande / 1e6).toFixed(2)} M€`}
                />
                <KPI label="Durée" value={`${dossier.origination.dureeEnMois ?? "—"} mois`} />
                <KPI label="Type" value={dossier.origination.typeProjet ?? "—"} />
                <KPI label="Commune" value={dossier.origination.commune ?? "—"} />
              </div>
            </section>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Enregistrer l'analyse
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-blue-600 font-medium">{label}</p>
      <p className="text-blue-900 font-semibold mt-0.5">{value}</p>
    </div>
  );
}
