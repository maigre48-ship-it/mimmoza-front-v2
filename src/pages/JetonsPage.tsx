// src/pages/JetonsPage.tsx

import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  History,
  Loader2,
  Sparkles,
  Ticket,
} from "lucide-react";
import { supabase } from "../lib/supabase";

type LoadState = "loading" | "ready" | "error";

type TxRow = {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  created_at: string;
};

function getPlanLabel(plan?: string): string {
  switch (plan) {
    case "pro":     return "Pro";
    case "starter": return "Plan Starter";
    default:        return "Gratuit";
  }
}

export default function JetonsPage() {
  const navigate = useNavigate();

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [tokens, setTokens] = useState<number>(0);
  const [email, setEmail] = useState<string>("");
  const [plan, setPlan] = useState<string>("");
  const [transactions, setTransactions] = useState<TxRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
          navigate("/connexion");
          return;
        }

        if (cancelled) return;
        setEmail(user.email ?? "");

        // Solde
        const { data: account } = await supabase
          .from("credit_accounts")
          .select("current_credits")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!cancelled) setTokens(account?.current_credits ?? 0);

        // Transactions
        const { data: txs } = await supabase
          .from("credit_transactions")
          .select("id, type, amount, description, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10);

        if (!cancelled) setTransactions(txs ?? []);

        // Plan (silencieux)
        const { data: orgMember } = await supabase
          .from("organisation_members")
          .select("organisations(plan_code)")
          .eq("user_id", user.id)
          .maybeSingle();

        const planCode =
          (orgMember?.organisations as { plan_code?: string } | null)
            ?.plan_code ?? "";
        if (!cancelled) setPlan(planCode);

        if (!cancelled) setLoadState("ready");
      } catch (err) {
        console.error("[JetonsPage]", err);
        if (!cancelled) setLoadState("error");
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [navigate]);

  if (loadState === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="text-sm text-rose-600">
          {"Impossible de charger votre solde. Verifiez votre connexion."}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
        >
          Reessayer
        </button>
      </div>
    );
  }

  const planLabel = getPlanLabel(plan);

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-sm">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(6,182,212,0.10),_transparent_28%),linear-gradient(180deg,_#f8fbff_0%,_#ffffff_38%,_#f8fafc_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:linear-gradient(to_bottom,black,transparent_90%)]" />

      <div className="relative mx-auto max-w-6xl px-6 py-10 lg:px-10 lg:py-14">
        {/* Titre */}
        <div className="mb-8">
          <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-sky-200 bg-white/85 px-4 py-2 text-sm font-medium text-sky-700 shadow-sm">
            <Sparkles className="h-4 w-4" />
            Jetons Mimmoza
          </div>

          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
            {"Gerez vos "}
            <span className="bg-gradient-to-r from-indigo-600 via-sky-500 to-cyan-500 bg-clip-text text-transparent">
              {"jetons d'analyse"}
            </span>
          </h1>

          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            {"Consultez votre solde en temps reel et votre historique de consommation."}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            {/* Solde principal */}
            <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_10px_40px_rgba(15,23,42,0.06)] backdrop-blur sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">
                    <Ticket className="h-3.5 w-3.5" />
                    Solde disponible
                  </div>

                  <div className="mt-4 flex items-end gap-3">
                    <div className="text-5xl font-semibold tracking-tight text-slate-950">
                      {tokens}
                    </div>
                    <div className="pb-1 text-sm text-slate-500">jetons</div>
                  </div>

                  <p className="mt-4 max-w-xl text-sm leading-6 text-slate-600">
                    {"Les jetons sont utilises pour certaines analyses, exports ou fonctionnalites premium selon votre formule."}
                  </p>
                </div>

                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                  <span className="inline-flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    {planLabel}
                  </span>
                </div>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => navigate("/abonnement")}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-medium text-white transition-all hover:bg-slate-800"
                >
                  <CreditCard className="h-4 w-4" />
                  Voir les offres
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/compte")}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50"
                >
                  Retour au compte
                </button>
              </div>
            </div>

            {/* Packs */}
            <div className="grid gap-5 md:grid-cols-3">
              {[
                { icon: Ticket,   color: "text-amber-500",  label: "Pack decouverte", qty: 10, desc: "Ideal pour tester quelques analyses et exports." },
                { icon: Sparkles, color: "text-sky-500",    label: "Pack standard",   qty: 25, desc: "Un format equilibre pour un usage plus regulier." },
                { icon: History,  color: "text-indigo-500", label: "Pack intensif",   qty: 50, desc: "Adapte aux usages frequents et aux exports reguliers." },
              ].map(({ icon: Icon, color, label, qty, desc }) => (
                <div
                  key={label}
                  className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Icon className={`h-4 w-4 ${color}`} />
                    {label}
                  </div>
                  <div className="mt-4 text-3xl font-semibold text-slate-950">{qty}</div>
                  <div className="mt-1 text-sm text-slate-500">jetons</div>
                  <p className="mt-4 text-sm leading-6 text-slate-600">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            {/* Historique */}
            <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <h2 className="text-xl font-semibold text-slate-950">
                {"Historique recent"}
              </h2>

              {transactions.length === 0 ? (
                <p className="mt-4 text-sm text-slate-400">
                  {"Aucune transaction pour le moment."}
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  {transactions.map((tx) => {
                    const isCredit = tx.amount > 0;
                    const date = new Intl.DateTimeFormat("fr-FR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    }).format(new Date(tx.created_at));
                    return (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm"
                      >
                        <div>
                          <div className="font-medium text-slate-800">
                            {tx.description ?? tx.type}
                          </div>
                          <div className="text-xs text-slate-400">{date}</div>
                        </div>
                        <span
                          className={`font-semibold tabular-nums ${
                            isCredit ? "text-emerald-600" : "text-rose-500"
                          }`}
                        >
                          {isCredit ? "+" : ""}{tx.amount}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Navigation */}
            <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <h3 className="text-lg font-semibold text-slate-950">Navigation</h3>
              <div className="mt-5 space-y-4">
                <Link
                  to="/abonnement"
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-700 transition hover:bg-white"
                >
                  <span>{"Voir les offres d'abonnement"}</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/compte"
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-700 transition hover:bg-white"
                >
                  <span>Retourner a mon compte</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <button
                  type="button"
                  onClick={() => navigate("/marchand-de-bien")}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-700 transition hover:bg-white"
                >
                  <span>Revenir a la plateforme</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}