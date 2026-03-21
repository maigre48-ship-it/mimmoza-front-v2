// src/pages/ApiPage.tsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Code2,
  Key,
  Zap,
  BookOpen,
  Copy,
  Check,
  ExternalLink,
  Terminal,
  Database,
  Map,
  BarChart3,
  ShieldCheck,
  ChevronRight,
  Lock,
  Globe,
  AlertCircle,
  Activity,
  PlayCircle,
  CreditCard,
  LayoutDashboard,
  Wifi,
} from "lucide-react";

import ApiUsageSummary from "../features/api/components/ApiUsageSummary";
import { PlanBadge, ApiStatusBadge } from "../features/api/components/ApiStatusBadge";
import { getPlanById } from "../features/api/member/apiPlans";
import { useApiMember } from "../features/api/member/useApiMember";

const GRAD_API = "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)";
const ACCENT_API = "#6366f1";
const API_BASE_URL = "https://api.mimmoza.io";

// ── Types & data ─────────────────────────────────────────────────────────────

type Endpoint = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  description: string;
  status?: "live" | "beta" | "planned";
};

const ENDPOINT_GROUPS: {
  label: string;
  icon: typeof Map;
  endpoints: Endpoint[];
}[] = [
  {
    label: "Scoring & Risques",
    icon: ShieldCheck,
    endpoints: [
      { method: "POST", path: "/v1/scoring/smart",    description: "SmartScore multi-piliers enrichi",     status: "live" },
      { method: "POST", path: "/v1/risques/analyse",  description: "Analyse de risques enrichie",          status: "beta" },
      { method: "GET",  path: "/v1/risques/{id}",     description: "Récupération d'un rapport de risque",  status: "planned" },
    ],
  },
  {
    label: "Foncier & PLU",
    icon: Map,
    endpoints: [
      { method: "GET",  path: "/v1/parcelles/{id}",   description: "Données cadastrales d'une parcelle",   status: "planned" },
      { method: "POST", path: "/v1/plu/extract",      description: "Extraction automatique des règles PLU",status: "planned" },
      { method: "GET",  path: "/v1/plu/{commune}",    description: "Règlement PLU d'une commune",          status: "planned" },
    ],
  },
  {
    label: "Marché & Prix",
    icon: BarChart3,
    endpoints: [
      { method: "GET",  path: "/v1/dvf/{commune}",    description: "Transactions DVF sur une commune",     status: "planned" },
      { method: "GET",  path: "/v1/marche/metrics",   description: "Indices de marché par zone",           status: "planned" },
      { method: "POST", path: "/v1/marche/estimate",  description: "Estimation de prix",                   status: "planned" },
    ],
  },
  {
    label: "Bilan & Financement",
    icon: Database,
    endpoints: [
      { method: "POST", path: "/v1/bilan/promoteur",      description: "Calcul de bilan promoteur",           status: "planned" },
      { method: "POST", path: "/v1/financement/simulate", description: "Simulation de financement",           status: "planned" },
      { method: "GET",  path: "/v1/bilan/{id}",           description: "Récupération d'un bilan enregistré",  status: "planned" },
    ],
  },
];

const CODE_EXAMPLE = `curl -X POST ${API_BASE_URL}/v1/scoring/smart \\
  -H "Authorization: Bearer mk_live_xxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "lat": 48.8686,
    "lon": 2.3306
  }'`;

const RESPONSE_EXAMPLE = `{
  "success": true,
  "version": "v3.23",
  "orchestrator": "smartscore-enriched-v3",
  "mode": "standard",
  "resolved_point": {
    "lat": 48.8686,
    "lon": 2.3306,
    "source": "payload"
  },
  "smartscore": {
    "score": 100,
    "verdict": "Excellent emplacement",
    "components": {
      "transport": null,
      "ecoles": 100,
      "commodites": null,
      "marche": null,
      "sante": null
    }
  }
}`;

const ERROR_EXAMPLES = [
  { code: 401, title: "Invalid API key",  body: `{\n  "error": "Invalid API key"\n}` },
  { code: 404, title: "Route not found", body: `{\n  "error": "Route not found"\n}` },
  { code: 429, title: "Quota exceeded",  body: `{\n  "error": "Quota exceeded (1000)"\n}` },
];

// ── Composants utilitaires ────────────────────────────────────────────────────

function MethodBadge({ method }: { method: Endpoint["method"] }) {
  const colors: Record<Endpoint["method"], string> = {
    GET:    "bg-emerald-50 text-emerald-700 border-emerald-200",
    POST:   "bg-blue-50 text-blue-700 border-blue-200",
    DELETE: "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold font-mono ${colors[method]}`}>
      {method}
    </span>
  );
}

function StatusBadge({ status }: { status: Endpoint["status"] | undefined }) {
  const map = {
    live:    "bg-emerald-50 text-emerald-700 border-emerald-200",
    beta:    "bg-amber-50 text-amber-700 border-amber-200",
    planned: "bg-slate-50 text-slate-600 border-slate-200",
  } as const;
  if (!status) return null;
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${map[status]}`}>
      {status}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
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
      <pre className={`overflow-x-auto bg-slate-950 p-4 text-[11px] leading-relaxed ${textColor}`}>
        {code}
      </pre>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ApiPage() {
  const [activeGroup, setActiveGroup] = useState(0);
  const navigate = useNavigate();

  const { data: member, loading, error } = useApiMember();

  const activeEndpoints = useMemo(
    () => ENDPOINT_GROUPS[activeGroup].endpoints,
    [activeGroup]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-sm text-slate-500">Chargement de l'espace API…</div>
      </div>
    );
  }

  if (error || !member) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-600">
        {error ?? "Impossible de charger les données API."}
      </div>
    );
  }

  const plan = getPlanById(member.subscription.plan);
  const activeKeys = (member.keys ?? []).filter((k) => k.status === "active");
  const healthStatus = member.healthStatus ?? "operational";

  return (
    <div className="space-y-10">

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden rounded-3xl p-8 text-white md:p-12"
        style={{ background: GRAD_API }}
      >
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
            API Mimmoza · v1 · Production-ready
          </div>

          <h1 className="text-3xl font-bold tracking-tight md:text-5xl">
            Une API immobilière premium, prête à intégrer
          </h1>

          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-indigo-100">
            Score foncier, signaux marché, risques, accessibilité, données
            territoriales et analyses promoteur via une API REST sécurisée,
            pensée pour les outils métiers, SaaS, CRM et workflows d'investissement.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              { label: "Base URL",  value: API_BASE_URL },
              { label: "Auth",      value: "Bearer API Key" },
              { label: "Format",    value: "JSON · HTTPS" },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
                <div className="text-xs uppercase tracking-wide text-indigo-200">{item.label}</div>
                <div className="mt-1 font-mono text-sm text-white">{item.value}</div>
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
              Commencer avec une clé API
            </button>
            <button
              type="button"
              onClick={() => navigate("/api/playground")}
              className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/20"
            >
              <PlayCircle className="h-4 w-4" />
              Tester l'API
            </button>
            <button
              type="button"
              onClick={() => navigate("/api/developer")}
              className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/20"
            >
              <BookOpen className="h-4 w-4" />
              Espace développeur
              <ExternalLink className="h-3.5 w-3.5 opacity-70" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Stats ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { value: "40+",    label: "Endpoints cibles" },
          { value: "<200ms", label: "Latence médiane" },
          { value: "99.9%",  label: "Disponibilité SLA" },
          { value: "Bearer", label: "Authentification" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
            <div className="mt-1 text-xs text-slate-500">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* ── Votre espace développeur ─────────────────────────────────── */}
      <div className="rounded-3xl border border-indigo-100 bg-indigo-50/60 p-6">
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold text-slate-900">Votre espace développeur</h2>
              <PlanBadge plan={member.subscription.plan} mode={member.subscription.billingMode} />
              <ApiStatusBadge
                variant={healthStatus as "operational" | "degraded" | "incident"}
                label={`API ${healthStatus === "operational" ? "opérationnelle" : "dégradée"}`}
                size="sm"
              />
              {/* BONUS: indicateur connexion réelle */}
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                <Wifi className="h-3 w-3" />
                Connected to API
              </span>
            </div>
            <p className="text-sm text-slate-500">
              Plan {plan?.name ?? member.subscription.plan} ·{" "}
              {(member.usage.usedRequests ?? 0).toLocaleString("fr-FR")} requêtes ce mois ·{" "}
              {activeKeys.length} clé{activeKeys.length > 1 ? "s" : ""} active{activeKeys.length > 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Usage bar */}
        <ApiUsageSummary subscription={member.subscription} usage={member.usage} showActions={false} />

        {/* Quick nav */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Abonnement", sub: "Plans & tarification",    path: "/api/billing",    icon: CreditCard },
            {
              label: "Clés API",
              sub: `${activeKeys.length} clé${activeKeys.length > 1 ? "s" : ""} active${activeKeys.length > 1 ? "s" : ""}`,
              path: "/api/keys",
              icon: Key,
            },
            { label: "Playground",  sub: "Tester l'API",          path: "/api/playground", icon: PlayCircle },
            { label: "Dashboard",   sub: "Logs & métriques",      path: "/api/developer",  icon: LayoutDashboard },
          ].map(({ label, sub, path, icon: Icon }) => (
            <button
              key={path}
              type="button"
              onClick={() => navigate(path)}
              className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-white p-4 text-left shadow-sm transition-all hover:border-indigo-200 hover:shadow-md"
            >
              <div
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                style={{ background: `${ACCENT_API}12` }}
              >
                <Icon className="h-4 w-4" style={{ color: ACCENT_API }} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{label}</p>
                <p className="truncate text-xs text-slate-500">{sub}</p>
              </div>
            </button>
          ))}
        </div>

        {/* CTA si aucune clé */}
        {activeKeys.length === 0 && (
          <div className="mt-4 flex items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
            <p className="flex-1 text-sm text-amber-800">
              Aucune clé API active. Créez votre première clé pour commencer.
            </p>
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

      {/* ── Endpoints + code ─────────────────────────────────────────── */}
      <div className="grid gap-8 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5" style={{ color: ACCENT_API }} />
            <h2 className="text-lg font-semibold text-slate-900">Endpoints disponibles</h2>
          </div>

          <div className="flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-2">
            {ENDPOINT_GROUPS.map((group, i) => {
              const Icon = group.icon;
              const active = i === activeGroup;
              return (
                <button
                  key={group.label}
                  type="button"
                  onClick={() => setActiveGroup(i)}
                  className="inline-flex items-center gap-2.5 rounded-xl px-5 py-2.5 text-sm font-medium transition-all"
                  style={
                    active
                      ? { background: GRAD_API, color: "white", boxShadow: "0 2px 10px rgba(99,102,241,0.30)" }
                      : { color: "#64748b", background: "transparent" }
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{group.label}</span>
                </button>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {activeEndpoints.map((ep, i) => (
              <div
                key={ep.path}
                className={`group flex items-center gap-5 px-6 py-5 transition-colors hover:bg-slate-50/70 ${i > 0 ? "border-t border-slate-100" : ""}`}
              >
                <div className="w-14 shrink-0">
                  <MethodBadge method={ep.method} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-sm text-slate-800">{ep.path}</code>
                    <StatusBadge status={ep.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{ep.description}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-slate-500" />
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${ACCENT_API}15` }}>
                <Globe className="h-5 w-5" style={{ color: ACCENT_API }} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-slate-900">Requête minimale valide</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Le endpoint public disponible aujourd'hui utilise le point d'analyse fourni par latitude / longitude.
                </p>
                <div className="mt-4 rounded-xl bg-slate-950 p-4 font-mono text-xs leading-relaxed text-emerald-300">
                  {`POST /v1/scoring/smart\nAuthorization: Bearer mk_live_...\nContent-Type: application/json\n\n{\n  "lat": 48.8686,\n  "lon": 2.3306\n}`}
                </div>
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
            title="Réponse JSON"
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

      {/* ── Auth + Errors ────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5" style={{ color: ACCENT_API }} />
            <h3 className="font-semibold text-slate-900">Authentification</h3>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Toutes les requêtes doivent inclure une clé API dans l'en-tête{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
              Authorization: Bearer &lt;clé&gt;
            </code>
            . Les clés de production commencent par{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">mk_live_</code>
            , les clés de test par{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">mk_test_</code>.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Header</div>
              <div className="mt-2 font-mono text-sm text-slate-800">Authorization: Bearer mk_live_...</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rate limiting</div>
              <div className="mt-2 font-mono text-sm text-slate-800">X-RateLimit-Limit / Remaining</div>
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
            <h3 className="font-semibold text-slate-900">Erreurs fréquentes</h3>
          </div>
          <div className="mt-4 space-y-3">
            {ERROR_EXAMPLES.map((err) => (
              <div key={err.code} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-slate-900">{err.title}</div>
                  <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">{err.code}</span>
                </div>
                <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-300">
                  {err.body}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Plans API ────────────────────────────────────────────────── */}
      <div>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-900">Plans API</h2>
          <button
            type="button"
            onClick={() => navigate("/api/billing")}
            className="text-sm font-medium transition-colors hover:text-indigo-700"
            style={{ color: ACCENT_API }}
          >
            Voir tous les détails →
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              plan: "Starter",
              price: "49 €/mois",
              requests: "10 000 req/mois",
              endpoints: "Accès initial",
              color: "#64748b",
              highlight: false,
            },
            {
              plan: "Growth",
              price: "149 €/mois",
              requests: "50 000 req/mois",
              endpoints: "Tous les endpoints publics",
              color: ACCENT_API,
              highlight: true,
            },
            {
              plan: "Scale",
              price: "Sur devis",
              requests: "Quotas dédiés",
              endpoints: "SLA + endpoints privés + support",
              color: "#0f172a",
              highlight: false,
            },
          ].map((tier) => (
            <div
              key={tier.plan}
              className={`rounded-2xl border p-6 ${
                tier.highlight
                  ? "border-indigo-200 bg-indigo-50/50 shadow-md shadow-indigo-100"
                  : "border-slate-200 bg-white"
              }`}
            >
              {tier.highlight && (
                <div
                  className="mb-3 inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white"
                  style={{ background: GRAD_API }}
                >
                  Recommandé
                </div>
              )}
              <div className="text-lg font-bold text-slate-900">{tier.plan}</div>
              <div className="mt-1 text-2xl font-bold" style={{ color: tier.color }}>
                {tier.price}
              </div>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                  {tier.requests}
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                  {tier.endpoints}
                </li>
              </ul>
              <button
                type="button"
                onClick={() => navigate("/api/billing")}
                className="mt-5 w-full rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50"
              >
                Voir ce plan
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Integration guide ────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${ACCENT_API}15` }}>
            <AlertCircle className="h-5 w-5" style={{ color: ACCENT_API }} />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Guide d'intégration rapide</h3>
            <ol className="mt-3 space-y-2 text-sm text-slate-600">
              <li>1. Crée une clé API test ou production.</li>
              <li>2. Appelle le endpoint <code className="rounded bg-slate-100 px-1 font-mono text-xs">POST /v1/scoring/smart</code>.</li>
              <li>3. Fournis au minimum <code className="rounded bg-slate-100 px-1 font-mono text-xs">lat</code> et <code className="rounded bg-slate-100 px-1 font-mono text-xs">lon</code>.</li>
              <li>4. Analyse la réponse JSON et les headers de quota.</li>
              <li>5. Passe ensuite sur le Playground ou l'espace développeur.</li>
            </ol>
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
              <button
                type="button"
                onClick={() => navigate("/api/developer")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                Espace développeur
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}