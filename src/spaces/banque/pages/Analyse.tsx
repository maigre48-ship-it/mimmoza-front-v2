// ============================================================================
// Analyse.tsx — Banque: analyse financière du dossier + SmartScore
// ✅ SmartScore entry point — DossierContextBar supprimé (doublon avec AppShell)
// La saisie financière reste ici ; le sous-onglet "Analyse de risque" dans AppShell
// pointe désormais vers /banque/smartscore/:id (dashboard SmartScore).
// Cette page reste accessible via /banque/analyse/:id pour la saisie détaillée.
//
// ✅ OPTION B (crédit complet):
// - Ajout des sections: Budget, Revenus/Capacité, Bien/État, Calendrier
// - Ajout d’un panneau Ratios (calculés automatiquement)
// - Le recalcul SmartScore utilise en priorité les ratios calculés (LTV/DSCR/DSTI, etc.)
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useBanqueDossierContext } from "../hooks/useBanqueDossierContext";
import { useSmartScore } from "../hooks/useSmartScore";
import { addEvent, upsertDossier } from "../store/banqueSnapshot.store";
import type { DossierAnalyse } from "../store/banqueSnapshot.types";

import { Flame, RefreshCw, ShieldAlert } from "lucide-react";
import SmartScorePanel from "../components/SmartScorePanel";

// ✅ FIX Vite alias: use relative import instead of "@/..."
// (tu as aussi supabase via "@/lib/supabaseClient" ailleurs, mais on garde celui-ci ici)
import { supabase } from "../../../lib/supabaseClient";

// ✅ OPTION B — New sections + ratios
import BienEtatSection from "../components/analyse/BienEtatSection";
import BudgetSection from "../components/analyse/BudgetSection";
import CalendrierSection from "../components/analyse/CalendrierSection";
import RatiosPanel from "../components/analyse/RatiosPanel";
import RevenusSection from "../components/analyse/RevenusSection";
import { computeRatios } from "../utils/banqueRatios";

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

function safeNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export default function BanqueAnalyse() {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id: string }>();

  const { dossierId, dossier, refresh } = useBanqueDossierContext();
  const { result: smartScore, recalculate, isComputing, error: ssError } = useSmartScore();

  // NOTE: DossierAnalyse était initialement “flat”.
  // Pour Option B, on stocke des sous-objets (budget/revenus/bien/calendrier)
  // => on conserve le type mais on manipule via "any" localement pour ne rien casser.
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

  // ──────────────────────────────────────────────────────────────
  // OPTION B — Source de vérité "montant prêt" / durée / garanties
  // ──────────────────────────────────────────────────────────────

  const loanAmount = useMemo(() => {
    // priorité: origination.montantDemande (BanqueSnapshot)
    const a = safeNum((dossier as any)?.origination?.montantDemande);
    if (a > 0) return a;

    // fallback: dossier.montant (dans ton snapshot tu as aussi "montant": 500000)
    const b = safeNum((dossier as any)?.montant);
    if (b > 0) return b;

    return 0;
  }, [dossier]);

  const durationMonths = useMemo(() => {
    const d = safeNum((dossier as any)?.origination?.duree);
    if (d > 0) return d;

    const d2 = safeNum((dossier as any)?.origination?.dureeEnMois);
    if (d2 > 0) return d2;

    return 240;
  }, [dossier]);

  const garanties = useMemo(() => {
    return (dossier as any)?.garanties ?? (dossier as any)?.operation?.garanties ?? null;
  }, [dossier]);

  // ──────────────────────────────────────────────────────────────
  // OPTION B — helpers update nested sections
  // ──────────────────────────────────────────────────────────────

  const update = (key: keyof DossierAnalyse, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const updateSection = (sectionKey: string, value: any) => {
    setForm((prev: any) => ({ ...(prev ?? {}), [sectionKey]: value }));
    setSaved(false);
  };

  // ──────────────────────────────────────────────────────────────
  // OPTION B — compute ratios from form
  // ──────────────────────────────────────────────────────────────

  const computedRatios = useMemo(() => {
    const f: any = form ?? {};
    const budget = f.budget ?? {};
    const revenus = f.revenus ?? {};

    return computeRatios({
      loanAmount,
      durationMonths,
      annualRatePct: 3.5,
      budget,
      revenus,
      garanties: { couvertureTotale: garanties?.couvertureTotale },
    });
  }, [form, loanAmount, durationMonths, garanties]);

  // ──────────────────────────────────────────────────────────────
  // Banque scoring — charger risks_data.scoring depuis Supabase
  // ──────────────────────────────────────────────────────────────

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
  const handleRecalculateRisks = async () => {
    if (!effectiveId) return;
    setRisksRecalculating(true);

    try {
      // 🔎 Fournir une adresse projet si dispo (la function saura geocoder BAN)
      const adresse =
        (dossier as any)?.origination?.adresseProjet ??
        (dossier as any)?.origination?.adresse ??
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

  // ──────────────────────────────────────────────────────────────
  // Save + SmartScore
  // ──────────────────────────────────────────────────────────────

  const handleSave = () => {
    if (!effectiveId) return;

    upsertDossier({ id: effectiveId, analyse: form, status: "analyse" } as any);

    addEvent({
      type: "analyse_updated",
      dossierId: effectiveId,
      message: `Analyse mise à jour — prêt: ${loanAmount || 0}€`,
    });

    refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  /** Sauvegarde l'analyse PUIS recalcule le SmartScore */
  const handleRecalculate = () => {
    if (effectiveId) {
      upsertDossier({ id: effectiveId, analyse: form, status: "analyse" } as any);
      refresh();
    }

    // Priorité aux ratios calculés (Option B)
    const ltvPct = computedRatios.ltv == null ? undefined : computedRatios.ltv * 100;
    const dscr = computedRatios.dscr == null ? undefined : computedRatios.dscr;
    const dstiPct = computedRatios.dsti == null ? undefined : computedRatios.dsti * 100;

    // On garde compatibilité avec ton payload actuel (finance.*)
    const result = recalculate({
      finance: {
        // "scoreCreditGlobal" reste optionnel (si tu veux un override manuel plus tard)
        scoreCreditGlobal: (form as any)?.scoreCreditGlobal,

        // ratios
        ratioLTV: ltvPct ?? (form as any)?.ratioLTV,
        ratioDSCR: dscr ?? (form as any)?.ratioDSCR,
        tauxEndettement: dstiPct ?? (form as any)?.tauxEndettement,

        // fonds propres: apport / coût projet
        fondsPropresPct:
          (() => {
            const f: any = form ?? {};
            const budget = f.budget ?? {};
            const equity = safeNum(budget.equity);
            const cost = safeNum(computedRatios.cost);
            if (cost > 0 && equity > 0) return (equity / cost) * 100;
            return (form as any)?.fondsPropresPct;
          })(),

        // legacy
        triProjet: (form as any)?.triProjet,
        chiffreAffairesPrev: (form as any)?.chiffreAffairesPrev,
        margeBrutePrev: (form as any)?.margeBrutePrev,
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

  // ──────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────

  const orig = (dossier as any)?.origination ?? {};
  const communeLabel =
    orig?.communeProjet ??
    orig?.commune ??
    (dossier as any)?.origination?.communeProjet ??
    "—";

  const typeLabel =
    orig?.typePret ??
    orig?.typeProjet ??
    (dossier as any)?.projectType ??
    "—";

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

          {/* ✅ OPTION B — Sections crédit complet */}
          <BudgetSection
            value={(form as any)?.budget ?? {}}
            onChange={(next) => updateSection("budget", next)}
          />

          <RevenusSection
            value={(form as any)?.revenus ?? {}}
            onChange={(next) => updateSection("revenus", next)}
          />

          <BienEtatSection
            value={(form as any)?.bien ?? {}}
            onChange={(next) => updateSection("bien", next)}
          />

          <CalendrierSection
            value={(form as any)?.calendrier ?? {}}
            onChange={(next) => updateSection("calendrier", next)}
          />

          <RatiosPanel
            montantPret={loanAmount}
            duree={durationMonths}
            garanties={garanties}
            budget={(form as any)?.budget ?? {}}
            revenus={(form as any)?.revenus ?? {}}
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
                Risques non renseignés — cliquez sur « Rafraîchir risques » pour persister les données.
              </p>
            )}
          </section>

          {/* Commentaire */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Commentaire analyste</h2>
            <textarea
              value={(form as any).commentaireAnalyste ?? ""}
              onChange={(e) => update("commentaireAnalyste" as any, e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              placeholder="Avis de l'analyste crédit..."
            />
          </section>

          {/* Origination (lecture seule) */}
          {loanAmount > 0 && (
            <section className="rounded-lg border border-blue-100 bg-blue-50 p-5">
              <h2 className="text-sm font-semibold text-blue-800 mb-3">
                Données d'origination (lecture seule)
              </h2>
              <div className="grid grid-cols-4 gap-4 text-xs">
                <KPI
                  label="Montant demandé"
                  value={
                    loanAmount >= 1e6
                      ? `${(loanAmount / 1e6).toFixed(2)} M€`
                      : `${Math.round(loanAmount).toLocaleString("fr-FR")} €`
                  }
                />
                <KPI label="Durée" value={`${durationMonths ?? "—"} mois`} />
                <KPI label="Type" value={typeLabel ?? "—"} />
                <KPI label="Commune" value={communeLabel ?? "—"} />
              </div>
            </section>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleRecalculate}
              className="rounded-lg border border-slate-200 bg-slate-50 px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Recalculer
            </button>

            <button
              type="button"
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
