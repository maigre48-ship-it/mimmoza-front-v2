import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "../components/layouts/MainLayout";
import { PageContainer } from "../components/layouts/PageContainer";
import { ContentSection } from "../components/layouts/ContentSection";
import { Grid } from "../components/layouts/Grid";
import { StatCard } from "../components/layouts/StatCard";
import {
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  CardFooter,
} from "../components/layouts/Card";
import { EmptyState } from "../components/layouts/EmptyState";

// IMPORTANT: adapte ce chemin si ton client Supabase est ailleurs
import { supabase } from "../lib/supabaseClient";

type PluLookupResult = {
  success?: boolean;
  error?: string;
  message?: string;

  commune_insee?: string;
  commune_nom?: string;

  parcel_id?: string;
  parcel?: any;

  zone_code?: string;
  zone_libelle?: string;

  rules?: any;
  ruleset?: any;
  plu?: any;

  // SmartScore — supporte les 2 conventions de casse
  smartScore?: number | null;
  smartscore?: number | null;
};

const LS_KEY = "mimmoza_plu_lookup_v1";

const safeJsonParse = (raw: string | null) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const pretty = (v: any) => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

/* ------------------------------------------------------------------ */
/*  SmartScore : lecture depuis localStorage investisseur snapshot     */
/* ------------------------------------------------------------------ */
function readInvestisseurSmartScore(): number | null {
  try {
    const raw = localStorage.getItem("mimmoza.investisseur.snapshot.v1");
    if (!raw) return null;
    const snap = JSON.parse(raw);

    // Ordre de priorité :
    // 1. snap.smartscore est un objet avec .score (SmartScoreResult)
    // 2. snap.smartscore est un number directement
    // 3. snap.smartScore est un objet avec .score (variante camelCase)
    // 4. snap.smartScore est un number directement
    // 5. snap.smart_score (snake_case, objet ou number)
    const candidates = [
      snap?.smartscore,
      snap?.smartScore,
      snap?.smart_score,
    ];

    for (const val of candidates) {
      if (val == null) continue;

      // Si c'est un objet avec .score (ex: SmartScoreResult)
      if (typeof val === "object" && val.score != null) {
        const n = Number(val.score);
        if (!Number.isNaN(n)) return n;
      }

      // Si c'est directement un number
      if (typeof val === "number" && !Number.isNaN(val)) return val;

      // Si c'est une string parsable
      if (typeof val === "string") {
        const n = Number(val);
        if (!Number.isNaN(n)) return n;
      }
    }

    // Aucun score trouvé → null (pas de fallback constant)
    return null;
  } catch {
    return null;
  }
}

/**
 * Lecture tolérante du SmartScore depuis n'importe quel niveau du payload deal.
 * Ordre de priorité :
 *   1. payload.smartScore  (camelCase — nouveau modèle)
 *   2. payload.smartscore  (lowercase — ancien modèle)
 *   3. payload.smart_score (snake_case)
 *   4. Idem dans payload.plu.* puis payload.ruleset.*
 *   5. null
 */
const resolveSmartScoreFromPayload = (payload: any): number | null => {
  if (!payload) return null;

  const candidates: unknown[] = [
    payload.smartScore,
    payload.smartscore,
    payload.smart_score,
    payload.plu?.smartScore,
    payload.plu?.smartscore,
    payload.plu?.smart_score,
    payload.ruleset?.smartScore,
    payload.ruleset?.smartscore,
    payload.ruleset?.smart_score,
  ];

  for (const v of candidates) {
    if (v != null && typeof v === "number" && !Number.isNaN(v)) return v;
    if (v != null && typeof v === "string") {
      const parsed = Number(v);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
};

const extractKpis = (payload: any) => {
  // Tolérant : selon les versions, la structure varie (plu.rules/ruleset, ruleset, rules, etc.)
  const ruleset =
    payload?.plu?.ruleset ??
    payload?.ruleset ??
    payload?.plu?.rules ??
    payload?.rules ??
    null;

  const zone_code = payload?.plu?.zone_code ?? payload?.zone_code ?? null;
  const zone_libelle =
    payload?.plu?.zone_libelle ?? payload?.zone_libelle ?? null;

  // Reculs: tentative
  const reculs =
    ruleset?.reculs ??
    ruleset?.implantation?.reculs ??
    ruleset?.implantation ??
    null;

  // Hauteur: tentative
  const hauteur =
    ruleset?.hauteur ??
    ruleset?.gabarit?.hauteur ??
    ruleset?.gabarit ??
    null;

  // Parking: tentative
  const parking =
    ruleset?.parking ??
    ruleset?.stationnement ??
    ruleset?.stationnement_min ??
    null;

  // SmartScore : d'abord depuis le payload (deal), puis fallback localStorage investisseur
  const scoreFromDeal = resolveSmartScoreFromPayload(payload);
  const scoreFromInvestisseur = readInvestisseurSmartScore();
  const smartScore = scoreFromDeal ?? scoreFromInvestisseur;

  return { zone_code, zone_libelle, reculs, hauteur, parking, ruleset, smartScore };
};

/** Couleur du badge SmartScore selon la valeur */
const smartScoreColor = (score: number) => {
  if (score >= 70) return { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", ring: "text-emerald-500" };
  if (score >= 40) return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", ring: "text-amber-500" };
  return { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", ring: "text-red-500" };
};

const MimmozaDashboard: React.FC = () => {
  // UX: Adresse / Parcelle (pour ne pas être bloqué par l'ingestion)
  const [address, setAddress] = useState<string>("");
  const [parcelId, setParcelId] = useState<string>("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<PluLookupResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // SmartScore autonome : lu depuis localStorage même sans lookupResult
  const [investisseurSmartScore, setInvestisseurSmartScore] = useState<number | null>(null);

  useEffect(() => {
    const saved = safeJsonParse(localStorage.getItem(LS_KEY));
    if (saved) {
      setAddress(String(saved.address ?? ""));
      setParcelId(String(saved.parcelId ?? ""));
      setShowDetails(Boolean(saved.showDetails ?? false));
    }
    // Lecture initiale du SmartScore investisseur
    setInvestisseurSmartScore(readInvestisseurSmartScore());
  }, []);

  // Écoute les changements de localStorage depuis d'autres onglets/pages (cross-tab)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "mimmoza.investisseur.snapshot.v1") {
        setInvestisseurSmartScore(readInvestisseurSmartScore());
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // Écoute le CustomEvent dispatché par saveSnapshot() dans le même onglet (intra-tab)
  useEffect(() => {
    const handler = () => {
      setInvestisseurSmartScore(readInvestisseurSmartScore());
    };
    window.addEventListener("mimmoza:investisseur-snapshot-updated", handler);
    return () => window.removeEventListener("mimmoza:investisseur-snapshot-updated", handler);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ address, parcelId, showDetails })
      );
    } catch {
      // ignore
    }
  }, [address, parcelId, showDetails]);

  const kpis = useMemo(() => {
    if (!lookupResult) return null;
    return extractKpis(lookupResult);
  }, [lookupResult]);

  // Score résolu : depuis le deal (kpis) OU depuis localStorage investisseur
  const resolvedSmartScore = kpis?.smartScore ?? investisseurSmartScore;

  const runLookup = async () => {
    setLookupError(null);
    setLookupResult(null);
    setLookupLoading(true);

    try {
      const pid = parcelId.trim();
      const addr = address.trim();

      if (!pid && !addr) {
        setLookupError("Renseigne une adresse ou un identifiant de parcelle.");
        return;
      }

      // Priorité : parcelle si fournie
      if (pid) {
        const { data, error } = await supabase.functions.invoke(
          "plu-from-parcelle",
          {
            body: { parcel_id: pid },
          }
        );
        if (error) throw error;
        setLookupResult(data ?? null);
        // Rafraîchir aussi le score investisseur au cas où
        setInvestisseurSmartScore(readInvestisseurSmartScore());
        return;
      }

      // Sinon : adresse
      const { data, error } = await supabase.functions.invoke(
        "plu-from-address",
        {
          body: { address: addr },
        }
      );
      if (error) throw error;
      setLookupResult(data ?? null);
      setInvestisseurSmartScore(readInvestisseurSmartScore());
    } catch (e: any) {
      setLookupError(
        e?.message ??
          "Erreur lors de la récupération PLU (plu-from-address / plu-from-parcelle)."
      );
    } finally {
      setLookupLoading(false);
    }
  };

  const resetLookup = () => {
    setLookupError(null);
    setLookupResult(null);
    setShowDetails(false);
  };

  return (
    <MainLayout
      title="Mimmoza Promoteur"
      subtitle="Studio de faisabilité foncière assistée par IA"
      breadcrumbs={[
        { label: "Accueil", href: "/" },
        { label: "Promoteur" },
      ]}
      actions={
        <>
          <button className="bg-white/70 hover:bg-white text-slate-900 px-4 py-2 rounded-full font-medium text-sm shadow-sm border border-slate-200 transition">
            Voir toutes les études
          </button>
          <button className="bg-gradient-to-r from-[#c9a227] to-[#b8922a] hover:from-[#b8922a] hover:to-[#a4811f] text-white px-5 py-2.5 rounded-full font-semibold text-sm shadow-md transition flex items-center gap-2">
            <span className="text-lg">+</span>
            Nouvelle étude foncière
          </button>
        </>
      }
    >
      <div className="bg-[#f8f7f4] -m-8 min-h-screen">
        <PageContainer maxWidth="xl" padding={true}>
          {/* HERO SECTION */}
          <div className="mt-4 mb-8">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 text-white shadow-[0_22px_45px_rgba(15,23,42,0.48)]">
              <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_top,_#c9a227_0,_transparent_55%),radial-gradient(circle_at_bottom,_#22c55e_0,_transparent_55%)]" />
              <div className="relative px-8 py-7 md:px-10 md:py-8 flex flex-col md:flex-row md:items-center gap-8">
                {/* Colonne gauche */}
                <div className="flex-1 space-y-3">
                  <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-3 py-1 text-xs font-medium tracking-wide uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="text-emerald-200">Beta privée</span>
                    <span className="text-white/80">
                      PLU Engine · Promoteur v1
                    </span>
                  </div>
                  <h1 className="text-2xl md:text-3xl lg:text-4xl font-semibold tracking-tight">
                    De la parcelle au bilan promoteur,
                    <span className="text-[#facc15]"> en suivant le PLU.</span>
                  </h1>
                  <p className="text-sm md:text-base text-slate-200 max-w-xl">
                    Mimmoza assemble cadastre, PLU, DVF et règles promoteur dans
                    un seul studio. Localisez, simulez, arbitrez — avec une
                    traçabilité complète pour les banques et les investisseurs.
                  </p>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <div className="inline-flex items-center gap-2 text-xs text-slate-200">
                      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                      Faisabilité PLU automatisée
                    </div>
                    <div className="inline-flex items-center gap-2 text-xs text-slate-200">
                      <span className="w-1.5 h-1.5 bg-sky-400 rounded-full" />
                      Bilan promoteur paramétrable
                    </div>
                    <div className="inline-flex items-center gap-2 text-xs text-slate-200">
                      <span className="w-1.5 h-1.5 bg-amber-300 rounded-full" />
                      Prêt à être partagé aux partenaires
                    </div>
                  </div>
                </div>

                {/* Colonne droite */}
                <div className="w-full md:w-72 lg:w-80">
                  <div className="bg-white/10 border border-white/15 rounded-2xl px-4 py-4 backdrop-blur-sm">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-100">
                        Dernière étude simulée
                      </p>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-400/40">
                        Prototype
                      </span>
                    </div>
                    <div className="space-y-2.5 text-xs text-slate-100">
                      <div className="flex justify-between">
                        <span className="text-slate-300">Marge cible</span>
                        <span className="font-semibold">18–22 %</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">SDP estimée</span>
                        <span className="font-semibold">+ 2 450 m²</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">Niveaux possibles</span>
                        <span className="font-semibold">
                          R+4 (sous réserve PLU)
                        </span>
                      </div>
                    </div>
                    <div className="mt-4">
                      <button className="w-full inline-flex items-center justify-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl bg-white text-slate-900 hover:bg-slate-100 transition shadow-sm">
                        Lancer une étude type
                        <span className="text-slate-400 text-[11px]">Mock</span>
                      </button>
                      <p className="mt-2 text-[11px] text-slate-200">
                        Ce bloc est purement visuel pour l&apos;instant. On
                        branchera ensuite les Edge Functions Supabase.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* STAT CARDS */}
          <ContentSection spacing="normal">
            <Grid cols={4} gap={6}>
              <StatCard
                title="Sites analysés"
                value="0"
                subtitle="Historique sur ce compte"
                icon="🔍"
                gradient="from-sky-500 to-sky-600"
              />
              <StatCard
                title="Études en cours"
                value="0"
                subtitle="Pipeline actif"
                icon="📊"
                gradient="from-violet-500 to-violet-600"
              />
              <StatCard
                title="Marge cible moyenne"
                value="20%"
                subtitle="Objectif promoteur"
                icon="💰"
                gradient="from-emerald-500 to-emerald-600"
              />
              <StatCard
                title="SmartScore"
                value={resolvedSmartScore != null ? `${resolvedSmartScore}/100` : "—"}
                subtitle={
                  resolvedSmartScore != null
                    ? resolvedSmartScore >= 70
                      ? "Score favorable"
                      : resolvedSmartScore >= 40
                        ? "Score moyen"
                        : "Score faible"
                    : "Aucun SmartScore calculé"
                }
                icon="⚡"
                gradient={
                  resolvedSmartScore != null
                    ? resolvedSmartScore >= 70
                      ? "from-emerald-500 to-emerald-600"
                      : resolvedSmartScore >= 40
                        ? "from-amber-500 to-amber-600"
                        : "from-red-500 to-red-600"
                    : "from-slate-400 to-slate-500"
                }
              />
            </Grid>
          </ContentSection>

          {/* GRILLE PRINCIPALE */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4 pb-10">
            {/* Colonne gauche */}
            <div className="lg:col-span-2 space-y-6">
              {/* PIPELINE */}
              <ContentSection
                title="Pipeline d'analyse foncière"
                subtitle="Un flux unique : Adresse → Parcelles → PLU → Bilan promoteur."
                card
              >
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Card padding="sm" className="bg-white shadow-sm border-0">
                    <div className="text-[11px] font-semibold text-slate-400 mb-1 uppercase tracking-wide">
                      Étape 1
                    </div>
                    <CardTitle className="text-sm">
                      Adresse & localisation
                    </CardTitle>
                    <CardBody className="mt-2 text-xs text-slate-600 space-y-1.5">
                      <p>Saisie d&apos;adresse, géocodage précis et détection de la commune.</p>
                      <p className="text-[11px] text-slate-400">
                        Sortie : point géographique, commune, code INSEE.
                      </p>
                    </CardBody>
                  </Card>

                  <Card padding="sm" className="bg-white shadow-sm border-0">
                    <div className="text-[11px] font-semibold text-slate-400 mb-1 uppercase tracking-wide">
                      Étape 2
                    </div>
                    <CardTitle className="text-sm">
                      Parcelle(s) cadastrale(s)
                    </CardTitle>
                    <CardBody className="mt-2 text-xs text-slate-600 space-y-1.5">
                      <p>Récupération automatique et ajout manuel des parcelles du terrain réel.</p>
                      <p className="text-[11px] text-slate-400">
                        Sortie : liste de parcelles, surface totale, forme du terrain.
                      </p>
                    </CardBody>
                  </Card>

                  <Card padding="sm" className="bg-white shadow-sm border-0">
                    <div className="text-[11px] font-semibold text-slate-400 mb-1 uppercase tracking-wide">
                      Étape 3
                    </div>
                    <CardTitle className="text-sm">
                      PLU & règles d&apos;urbanisme
                    </CardTitle>
                    <CardBody className="mt-2 text-xs text-slate-600 space-y-1.5">
                      <p>Chargement automatique ou upload du PLU, puis extraction des articles clés.</p>
                      <p className="text-[11px] text-slate-400">
                        Sortie : zone, emprise, hauteurs, stationnement, servitudes.
                      </p>
                    </CardBody>
                  </Card>

                  <Card padding="sm" className="bg-white shadow-sm border-0">
                    <div className="text-[11px] font-semibold text-slate-400 mb-1 uppercase tracking-wide">
                      Étape 4
                    </div>
                    <CardTitle className="text-sm">Bilan promoteur</CardTitle>
                    <CardBody className="mt-2 text-xs text-slate-600 space-y-1.5">
                      <p>Simulation automatique des SDP, typologies, coûts et marges.</p>
                      <p className="text-[11px] text-slate-400">
                        Sortie : bilan promoteur détaillé + appréciation synthétique.
                      </p>
                    </CardBody>
                  </Card>
                </div>
              </ContentSection>

              {/* FORMULAIRE MINIMAL : Adresse / Parcelle -> PLU (immédiat) */}
              <ContentSection
                title="Nouvelle étude foncière"
                subtitle="Point d'entrée opérationnel : adresse/parcelle → zone PLU + règles clés (sans dépendre de l'upload)."
                card
              >
                <div className="bg-white/70 border border-slate-200/70 rounded-2xl p-6 shadow-sm">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Adresse (option 1)
                      </label>
                      <input
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="ex: 12 rue X, 64310 Ascain"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        Appelle <code className="bg-slate-100 px-1 rounded">plu-from-address</code>.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        ID Parcelle (option 2 prioritaire)
                      </label>
                      <input
                        value={parcelId}
                        onChange={(e) => setParcelId(e.target.value)}
                        placeholder="ex: 64065000AI0002"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        Appelle <code className="bg-slate-100 px-1 rounded">plu-from-parcelle</code> si renseigné.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      onClick={runLookup}
                      disabled={lookupLoading}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      {lookupLoading ? "Lecture PLU..." : "Lire règles PLU"}
                    </button>

                    <button
                      onClick={resetLookup}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-white text-slate-800 text-sm font-semibold border border-slate-200 hover:bg-slate-50 transition"
                    >
                      Réinitialiser
                    </button>

                    <button
                      onClick={() => setShowDetails((v) => !v)}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-white text-slate-700 text-sm font-semibold border border-slate-200 hover:bg-slate-50 transition"
                    >
                      {showDetails ? "Masquer détails" : "Afficher détails"}
                    </button>
                  </div>

                  {lookupError && (
                    <div className="mt-4 p-3 rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm">
                      {lookupError}
                    </div>
                  )}

                  {lookupResult && (
                    <div className="mt-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* Zone PLU */}
                        <div className="p-4 rounded-2xl bg-white border border-slate-200/70">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">
                            Zone PLU
                          </p>
                          <p className="mt-1 text-base font-semibold text-slate-900">
                            {kpis?.zone_code ?? "—"}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            {kpis?.zone_libelle ?? "—"}
                          </p>
                        </div>

                        {/* SmartScore — carte dédiée dans les résultats */}
                        <div
                          className={`p-4 rounded-2xl border ${
                            resolvedSmartScore != null
                              ? smartScoreColor(resolvedSmartScore).bg +
                                " " +
                                smartScoreColor(resolvedSmartScore).border
                              : "bg-white border-slate-200/70"
                          }`}
                        >
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">
                            SmartScore
                          </p>
                          {resolvedSmartScore != null ? (
                            <>
                              <p
                                className={`mt-1 text-2xl font-bold ${
                                  smartScoreColor(resolvedSmartScore).text
                                }`}
                              >
                                {resolvedSmartScore}
                                <span className="text-sm font-medium text-slate-400">
                                  /100
                                </span>
                              </p>
                              <p className="mt-1 text-xs text-slate-600">
                                {resolvedSmartScore >= 70
                                  ? "Faisabilité favorable"
                                  : resolvedSmartScore >= 40
                                    ? "Faisabilité à confirmer"
                                    : "Faisabilité contrainte"}
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="mt-1 text-base font-semibold text-slate-400">
                                —
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                Aucun SmartScore dans la réponse
                              </p>
                            </>
                          )}
                        </div>

                        {/* Reculs */}
                        <div className="p-4 rounded-2xl bg-white border border-slate-200/70">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">
                            Reculs (extrait)
                          </p>
                          <p className="mt-2 text-xs text-slate-700 whitespace-pre-wrap">
                            {kpis?.reculs ? pretty(kpis.reculs) : "—"}
                          </p>
                        </div>

                        {/* Hauteur / Parking */}
                        <div className="p-4 rounded-2xl bg-white border border-slate-200/70">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">
                            Hauteur / Parking (extrait)
                          </p>
                          <p className="mt-2 text-xs text-slate-700 whitespace-pre-wrap">
                            {kpis?.hauteur ? `Hauteur:\n${pretty(kpis.hauteur)}\n\n` : "Hauteur:\n—\n\n"}
                            {kpis?.parking ? `Parking:\n${pretty(kpis.parking)}` : "Parking:\n—"}
                          </p>
                        </div>
                      </div>

                      {showDetails && (
                        <div className="mt-4 p-4 rounded-2xl bg-slate-950 text-slate-100 border border-slate-800 overflow-auto">
                          <pre className="text-xs leading-relaxed">
                            {pretty(lookupResult)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  <p className="mt-4 text-[11px] text-slate-500">
                    But : disposer d'un chemin "adresse/parcelle → zone/règles" immédiatement, même si l'ingestion PLU échoue.
                    Ensuite, on normalisera les champs (reculs/hauteur/parking) en un format strict.
                  </p>
                </div>
              </ContentSection>

              {/* ÉTUDES RÉCENTES */}
              <ContentSection
                title="Études récentes"
                subtitle="Vos dernières analyses foncières apparaîtront ici."
                card
              >
                <EmptyState
                  icon="📋"
                  title="Aucune étude pour le moment"
                  description="Dès que vous lancerez une première analyse, elle apparaîtra ici avec ses parcelles, son PLU et le bilan promoteur associé."
                  action={{
                    label: "Démarrer une première étude",
                    onClick: () => {
                      console.log("Nouvelle étude");
                    },
                  }}
                />
              </ContentSection>
            </div>

            {/* Colonne droite */}
            <div className="space-y-6">
              <ContentSection title="Actions rapides" card spacing="tight">
                <div className="space-y-2">
                  {[
                    { icon: "📍", label: "Nouvelle étude par adresse" },
                    { icon: "🗺️", label: "Choisir une parcelle sur la carte" },
                    { icon: "📄", label: "Charger / uploader un PLU" },
                    { icon: "📊", label: "Générer un bilan promoteur" },
                  ].map((action, i) => (
                    <button
                      key={i}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-[#f3efe3] rounded-xl transition text-left text-sm shadow-sm border border-slate-200/70"
                    >
                      <span className="text-lg">{action.icon}</span>
                      <span className="font-medium text-slate-800">
                        {action.label}
                      </span>
                    </button>
                  ))}
                </div>
              </ContentSection>

              <Card className="bg-gradient-to-br from-[#f5e9c9] via-[#f8f7f4] to-white border-0 shadow-md">
                <CardHeader className="border-none pb-2 mb-1">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">
                    Roadmap Mimmoza
                  </p>
                  <CardTitle className="text-base text-slate-900">
                    PLU Engine & Promoteur v1
                  </CardTitle>
                </CardHeader>
                <CardBody className="text-sm text-slate-700 space-y-1.5">
                  <p>🎯 Objectif : automatiser la faisabilité foncière à partir du PLU.</p>
                  <ul className="list-disc list-inside space-y-1.5">
                    <li>Parsing des règles PLU (zones, hauteurs, emprise, stationnement)</li>
                    <li>Calcul automatique des SDP et des gabarits 3D</li>
                    <li>Bilan promoteur : coûts, marges, appréciation & scénario</li>
                  </ul>
                </CardBody>
                <CardFooter className="border-none mt-2 pt-0">
                  <p className="text-[11px] text-slate-500">
                    Cette page sert de vitrine pendant que l&apos;on branche progressivement toutes les fonctions backend.
                  </p>
                </CardFooter>
              </Card>

              <Card className="border border-slate-200/80 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm">
                    Support & documentation interne
                  </CardTitle>
                </CardHeader>
                <CardBody className="text-sm text-slate-600 space-y-2">
                  <p>Tu pourras ajouter ici des liens vers :</p>
                  <ul className="list-disc list-inside space-y-1.5">
                    <li>La documentation interne Mimmoza</li>
                    <li>La liste des Edge Functions disponibles</li>
                    <li>Les modèles de rapports pour banques et partenaires</li>
                  </ul>
                </CardBody>
              </Card>
            </div>
          </div>
        </PageContainer>
      </div>
    </MainLayout>
  );
};

export default MimmozaDashboard;