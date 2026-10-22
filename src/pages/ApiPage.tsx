// src/pages/ApiPage.tsx
// Présentation publique de l'API Mimmoza (/api) : endpoints, exemple, erreurs
// et formules. Chiffres et endpoints : src/lib/api/catalogueApi.ts (source unique).
// Visiteur non connecté : la page s'affiche sans l'encart « Votre espace API ».
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  BookOpen,
  Building2,
  Check,
  Code2,
  Copy,
  CreditCard,
  ExternalLink,
  Globe,
  Key,
  LayoutDashboard,
  Lock,
  Map as MapIcon,
  PlayCircle,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ESPACES_VISIBLES } from "../lib/espacesEnPreparation";

import ApiBillingToggle from "../features/api/components/ApiBillingToggle";
import ApiPlanCard from "../features/api/components/ApiPlanCard";
import { ApiStatusBadge, PlanBadge } from "../features/api/components/ApiStatusBadge";
import ApiUsageSummary from "../features/api/components/ApiUsageSummary";
import RechargePrepayeeCard from "../features/api/components/PayAsYouGoCard";
import { useApiMember } from "../features/api/member/useApiMember";
import {
  API_BASE_URL,
  API_ENDPOINTS,
  API_ESSAI,
  API_FORMULES,
  API_GROUPES,
  endpointApi,
  exempleCurl,
  formuleApi,
  libelleCredits,
  NB_ENDPOINTS_API,
  PHRASE_FACTURATION_API,
  REMISE_ANNUELLE_MAX_API,
  type ApiEndpoint,
  type ApiGroupeId,
} from "../lib/api/catalogueApi";

const GRAD_API = "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)";
const ACCENT_API = "#6366f1";

// ── Données de présentation ──────────────────────────────────────────────────

const ICONE_GROUPE: Record<ApiGroupeId, LucideIcon> = {
  scoring: BarChart3,
  foncier: MapIcon,
  batiment: Building2,
  territoire: ShieldCheck,
  service: Activity,
};

const GROUPES_AFFICHES = API_GROUPES.filter((g) => API_ENDPOINTS.some((e) => e.groupe === g.id));

const ENDPOINT_EXEMPLE = endpointApi("/v1/scoring/smart") ?? API_ENDPOINTS[0];
const CODE_EXAMPLE = exempleCurl(ENDPOINT_EXEMPLE);

const RESPONSE_EXAMPLE = `{
  "success": true,
  "version": "v4.4",
  "orchestrator": "smartscore-enriched-v3",
  "mode": "standard",
  "zone_type": "urbain",
  "resolved_point": {
    "lat": 48.8686,
    "lon": 2.3306,
    "source": "payload"
  },
  "smartscore": {
    "score": 87,
    "verdict": "Excellent emplacement",
    "components": {
      "transport": 90,
      "ecoles": 100,
      "commodites": 78,
      "marche": 65,
      "sante": 72
    }
  }
}`;

const ERREURS: { code: number; titre: string; detail: string }[] = [
  { code: 401, titre: "Clé absente ou invalide", detail: "Vérifiez l'en-tête Authorization et que la clé n'a pas été révoquée." },
  { code: 402, titre: "Crédits épuisés ou essai terminé", detail: "Aucun appel n'est facturé après coup : l'appel est refusé. Attendez le renouvellement, rechargez ou changez de formule." },
  { code: 429, titre: "Trop de requêtes par minute", detail: "Le débit dépend de votre formule. Patientez quelques secondes puis réessayez." },
];

// ── Composants utilitaires ────────────────────────────────────────────────────

function MethodBadge({ method }: { method: ApiEndpoint["methode"] }) {
  const colors: Record<ApiEndpoint["methode"], string> = {
    GET: "bg-emerald-50 text-emerald-700 border-emerald-200",
    POST: "bg-blue-50 text-blue-700 border-blue-200",
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${colors[method]}`}>
      {method}
    </span>
  );
}

function StatusBadge({ status }: { status: ApiEndpoint["statut"] }) {
  if (status !== "beta") return null;
  return (
    <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
      bêta
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* presse-papiers indisponible : sans effet */
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
    >
      {copied ? (
        <><Check className="h-3.5 w-3.5 text-emerald-500" />Copié</>
      ) : (
        <><Copy className="h-3.5 w-3.5" />Copier</>
      )}
    </button>
  );
}

function CodeCard({
  title,
  code,
  tone = "emerald",
  rightNode,
}: {
  title: string;
  code: string;
  tone?: "emerald" | "slate";
  rightNode?: React.ReactNode;
}) {
  const textColor = tone === "emerald" ? "text-emerald-300" : "text-slate-300";
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-4 py-3">
        <span className="text-xs font-medium text-slate-400">{title}</span>
        <div className="flex items-center gap-2">
          {rightNode}
          <CopyButton text={code} />
        </div>
      </div>
      <pre className={`overflow-x-auto bg-slate-950 p-4 text-[11px] leading-relaxed ${textColor}`}>{code}</pre>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ApiPage() {
  const [activeGroup, setActiveGroup] = useState<ApiGroupeId>(GROUPES_AFFICHES[0]?.id ?? "scoring");
  const [periodicite, setPeriodicite] = useState<"mensuel" | "annuel">("mensuel");
  const navigate = useNavigate();
  // Visiteur non connecté : member est null, la page reste lisible.
  const { data: member, loading } = useApiMember();
  const { hash } = useLocation();

  // /api/billing renvoie ici avec #tarifs-api : on fait défiler jusqu'aux formules.
  useEffect(() => {
    if (!hash) return;
    const cible = document.getElementById(hash.slice(1));
    if (cible) window.setTimeout(() => cible.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, [hash, loading]);

  const activeEndpoints = useMemo(() => API_ENDPOINTS.filter((e) => e.groupe === activeGroup), [activeGroup]);

  const activeKeys = (member?.keys ?? []).filter((k) => k.status === "active");
  const healthStatus = member?.healthStatus ?? "operational";
  const planActuel = member?.subscription.plan;

  return (
    <div className="space-y-10">

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl p-8 text-white md:p-12" style={{ background: GRAD_API }}>
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 60%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-16 right-48 h-56 w-56 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.04) 0%, transparent 60%)" }}
        />

        <div className="relative z-10 max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-medium backdrop-blur-sm">
            <Zap className="h-3.5 w-3.5" />
            API Mimmoza · v1
          </div>

          <h1 className="text-3xl font-bold tracking-tight md:text-5xl">
            Les données foncières et immobilières de Mimmoza, dans vos outils
          </h1>

          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-indigo-100">
            Score d'emplacement, marché DVF, parcelle et PLU, faisabilité, DPE, risques, loyers :
            une API REST pensée pour les outils métiers, CRM et logiciels d'investissement.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              { label: "Adresse de base", value: "…supabase.co/functions/v1/api-gateway" },
              { label: "Authentification", value: "Bearer + clé API" },
              { label: "Format", value: "JSON · HTTPS" },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
                <div className="text-xs uppercase tracking-wide text-indigo-200">{item.label}</div>
                <div className="mt-1 truncate font-mono text-sm text-white">{item.value}</div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => navigate("/api/keys")}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold shadow-lg shadow-indigo-900/20 transition-all hover:bg-indigo-50"
              style={{ color: ACCENT_API }}
            >
              <Key className="h-4 w-4" />
              Essayer gratuitement
            </button>
            <button
              type="button"
              onClick={() => navigate("/api/playground")}
              className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/20"
            >
              <PlayCircle className="h-4 w-4" />
              Tester l'API
            </button>
            {ESPACES_VISIBLES.apiDashboard && (
              <button
                type="button"
                onClick={() => navigate("/api/developer")}
                className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/20"
              >
                <BookOpen className="h-4 w-4" />
                Espace développeur
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Chiffres (uniquement ce qui est vrai) ─────────────────────── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { value: String(NB_ENDPOINTS_API), label: "Endpoints disponibles" },
          { value: API_ESSAI.credits.toLocaleString("fr-FR"), label: `Crédits offerts à l'essai (${API_ESSAI.dureeEssaiJours} jours)` },
          { value: "Aucun", label: "Dépassement facturé après coup" },
          { value: "Bearer", label: "Authentification" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
            <div className="mt-1 text-xs text-slate-500">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* ── Votre espace API (connecté uniquement) ────────────────────── */}
      {member && (
        <div className="rounded-3xl border border-indigo-100 bg-indigo-50/60 p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-bold text-slate-900">Votre espace API</h2>
                <PlanBadge plan={member.subscription.plan} mode={member.subscription.billingMode} />
                <ApiStatusBadge
                  variant={healthStatus as "operational" | "degraded" | "incident"}
                  label={`API ${healthStatus === "operational" ? "opérationnelle" : "dégradée"}`}
                  size="sm"
                />
              </div>
              <p className="text-sm text-slate-500">
                Formule {formuleApi(member.subscription.plan).nom} ·{" "}
                {(member.usage.usedRequests ?? 0).toLocaleString("fr-FR")} crédits utilisés ·{" "}
                {activeKeys.length} clé{activeKeys.length > 1 ? "s" : ""} active{activeKeys.length > 1 ? "s" : ""}
              </p>
            </div>
          </div>

          <ApiUsageSummary subscription={member.subscription} usage={member.usage} showActions={false} />

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Formules", sub: "Tarifs et crédits", path: "/api#tarifs-api", icon: CreditCard },
              {
                label: "Clés API",
                sub: `${activeKeys.length} clé${activeKeys.length > 1 ? "s" : ""} active${activeKeys.length > 1 ? "s" : ""}`,
                path: "/api/keys",
                icon: Key,
              },
              { label: "Playground", sub: "Tester l'API", path: "/api/playground", icon: PlayCircle },
              { label: "Tableau de bord", sub: "Suivi des appels", path: "/api/developer", icon: LayoutDashboard },
            ]
              .filter((item) => ESPACES_VISIBLES.apiDashboard || item.path !== "/api/developer")
              .map(({ label, sub, path, icon: Icon }) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => navigate(path)}
                  className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-white p-4 text-left shadow-sm transition-all hover:border-indigo-200 hover:shadow-md"
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: `${ACCENT_API}12` }}>
                    <Icon className="h-4 w-4" style={{ color: ACCENT_API }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{label}</p>
                    <p className="truncate text-xs text-slate-500">{sub}</p>
                  </div>
                </button>
              ))}
          </div>

          {activeKeys.length === 0 && (
            <div className="mt-4 flex items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
              <p className="flex-1 text-sm text-amber-800">Aucune clé API active. Créez votre première clé pour commencer.</p>
              <button
                type="button"
                onClick={() => navigate("/api/keys")}
                className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700"
              >
                Créer une clé
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Endpoints + code ─────────────────────────────────────────── */}
      <div className="grid gap-8 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5" style={{ color: ACCENT_API }} />
            <h2 className="text-lg font-semibold text-slate-900">Endpoints disponibles</h2>
          </div>

          <div className="flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-2">
            {GROUPES_AFFICHES.map((group) => {
              const Icon = ICONE_GROUPE[group.id];
              const active = group.id === activeGroup;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setActiveGroup(group.id)}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all"
                  style={
                    active
                      ? { background: GRAD_API, color: "white", boxShadow: "0 2px 10px rgba(99,102,241,0.30)" }
                      : { color: "#64748b", background: "transparent" }
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{group.libelle}</span>
                </button>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {activeEndpoints.map((ep, i) => (
              <div key={ep.chemin} className={`flex items-start gap-4 px-6 py-4 ${i > 0 ? "border-t border-slate-100" : ""}`}>
                <div className="w-14 shrink-0 pt-0.5">
                  <MethodBadge method={ep.methode} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-sm text-slate-800">{ep.chemin}</code>
                    <span className="text-sm font-medium text-slate-600">{ep.titre}</span>
                    <StatusBadge status={ep.statut} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{ep.description}</p>
                </div>
                <span className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                  {libelleCredits(ep.credits)}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${ACCENT_API}15` }}>
                <Globe className="h-5 w-5" style={{ color: ACCENT_API }} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-slate-900">Corps des requêtes</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Les endpoints de localisation prennent une latitude et une longitude ; ceux qui portent sur une
                  parcelle ou une commune prennent son identifiant cadastral ou son code INSEE. Chaque endpoint a son
                  exemple prêt à l'emploi dans le Playground.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div className="flex items-center gap-2">
            <Code2 className="h-5 w-5" style={{ color: ACCENT_API }} />
            <h2 className="text-lg font-semibold text-slate-900">Exemple</h2>
          </div>
          <CodeCard title="Requête cURL" code={CODE_EXAMPLE} tone="emerald" />
          <CodeCard
            title="Réponse JSON (extrait)"
            code={RESPONSE_EXAMPLE}
            tone="slate"
            rightNode={
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-900/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                200 OK
              </span>
            }
          />
        </div>
      </div>

      {/* ── Authentification + erreurs ───────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5" style={{ color: ACCENT_API }} />
            <h3 className="font-semibold text-slate-900">Authentification</h3>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Toutes les requêtes doivent inclure une clé API dans l'en-tête{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">Authorization: Bearer &lt;clé&gt;</code>
            . Les clés de production commencent par{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">mk_live_</code>, les clés de test par{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">mk_test_</code>. Les crédits
            sont décomptés sur votre compte, quelle que soit la clé utilisée.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">En-tête</div>
              <div className="mt-2 font-mono text-sm text-slate-800">Authorization: Bearer mk_live_...</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Débit</div>
              <div className="mt-2 text-sm text-slate-800">
                De {formuleApi("essai").debitParMinute} à {formuleApi("scale").debitParMinute.toLocaleString("fr-FR")} requêtes par minute selon la formule
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => navigate("/api/keys")}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:opacity-90"
              style={{ background: GRAD_API }}
            >
              <Key className="h-4 w-4" />
              Gérer mes clés
            </button>
            <button
              type="button"
              onClick={() => navigate("/api/playground")}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50"
            >
              <PlayCircle className="h-4 w-4" />
              Ouvrir le Playground
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5" style={{ color: ACCENT_API }} />
            <h3 className="font-semibold text-slate-900">Refus fréquents</h3>
          </div>
          <div className="mt-4 space-y-3">
            {ERREURS.map((err) => (
              <div key={err.code} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-slate-900">{err.titre}</div>
                  <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">{err.code}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">{err.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Formules API ─────────────────────────────────────────────── */}
      <div id="tarifs-api" className="scroll-mt-24 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Formules API</h2>
            <p className="text-sm text-slate-500">Prix hors taxes. Paiement en ligne bientôt disponible : chaque formule s'ouvre sur demande.</p>
          </div>
          <ApiBillingToggle periodicite={periodicite} onChange={setPeriodicite} remiseAnnuelle={REMISE_ANNUELLE_MAX_API} />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {API_FORMULES.map((f) => (
            <ApiPlanCard
              key={f.id}
              plan={f}
              periodicite={periodicite}
              actuelle={planActuel === f.id}
              onEssai={() => navigate("/api/keys")}
            />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-relaxed text-slate-600 lg:col-span-2">
            <p className="font-semibold text-slate-900">Comment les crédits sont décomptés</p>
            <p className="mt-1">{PHRASE_FACTURATION_API}</p>
            <ul className="mt-3 grid gap-x-6 gap-y-1 text-xs text-slate-500 sm:grid-cols-2">
              {API_ENDPOINTS.filter((e) => e.credits > 0).map((e) => (
                <li key={e.chemin} className="flex justify-between gap-2">
                  <code className="font-mono">{e.chemin}</code>
                  <span className="font-semibold text-slate-700">{libelleCredits(e.credits)}</span>
                </li>
              ))}
            </ul>
          </div>
          <RechargePrepayeeCard />
        </div>
      </div>

      {/* ── Guide d'intégration ──────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${ACCENT_API}15` }}>
            <AlertCircle className="h-5 w-5" style={{ color: ACCENT_API }} />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Guide d'intégration rapide</h3>
            <ol className="mt-3 space-y-2 text-sm text-slate-600">
              <li>1. Créez une clé API : l'essai vous offre {API_ESSAI.credits.toLocaleString("fr-FR")} crédits pendant {API_ESSAI.dureeEssaiJours} jours.</li>
              <li>
                2. Appelez par exemple{" "}
                <code className="rounded bg-slate-100 px-1 font-mono text-xs">POST {ENDPOINT_EXEMPLE.chemin}</code> avec{" "}
                <code className="rounded bg-slate-100 px-1 font-mono text-xs">lat</code> et{" "}
                <code className="rounded bg-slate-100 px-1 font-mono text-xs">lon</code>.
              </li>
              <li>3. Lisez la réponse JSON ; un refus 402 signifie que vos crédits sont épuisés.</li>
              <li>4. Essayez les autres endpoints dans le Playground, puis demandez la formule adaptée à vos volumes.</li>
            </ol>
            <p className="mt-3 text-xs text-slate-400">Adresse de base complète : <code className="font-mono">{API_BASE_URL}</code></p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate("/api/keys")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                <Key className="h-3.5 w-3.5" />
                Créer une clé
              </button>
              <button
                type="button"
                onClick={() => navigate("/api/playground")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                <PlayCircle className="h-3.5 w-3.5" />
                Ouvrir le Playground
              </button>
              {ESPACES_VISIBLES.apiDashboard && (
                <button
                  type="button"
                  onClick={() => navigate("/api/developer")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  Espace développeur
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
