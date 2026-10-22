// src/spaces/admin/pages/Erreurs.tsx
//
// Erreurs du site et des Edge Functions, sur 7 jours, groupées par empreinte.
//
// Source : public.client_errors via la RPC admin_client_errors_groupes
// (migration 20261022_suivi_erreurs.sql). La RLS réserve la lecture aux
// administrateurs : un compte non admin voit simplement une liste vide.
//
// Parti pris : ce qui revient le plus souvent et le plus récemment est en haut.
// Une erreur vue 400 fois hier compte plus qu'une erreur vue une fois ce matin.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { StatusBadge } from "../components/StatusBadge";

type Filtre = "tout" | "front" | "edge";

type GroupeErreur = {
  fingerprint: string;
  source: string;
  level: string;
  message: string;
  route: string;
  occurrences: number;
  utilisateurs: number;
  premiere: string;
  derniere: string;
  release: string | null;
  exemple_id: string;
  exemple_stack: string | null;
  exemple_context: Record<string, unknown> | null;
  exemple_user_agent: string | null;
};

const LIBELLE_SOURCE: Record<string, string> = {
  front: "Navigateur",
  react: "Affichage",
  promesse: "Promesse",
  copilot: "Mimmo",
  edge: "Edge Function",
};

function toneSource(source: string): "rose" | "amber" | "sky" | "violet" | "slate" {
  if (source === "edge") return "violet";
  if (source === "copilot") return "sky";
  if (source === "react") return "rose";
  if (source === "promesse") return "amber";
  return "slate";
}

function formatDateHeure(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function depuis(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

export default function ErreursPage() {
  const [groupes, setGroupes] = useState<GroupeErreur[]>([]);
  const [etat, setEtat] = useState<"loading" | "ready" | "error">("loading");
  const [erreur, setErreur] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<Filtre>("tout");
  const [ouvert, setOuvert] = useState<string | null>(null);

  // L'indicateur « loading » est posé par l'appelant (bouton, onglet) : le
  // poser ici, de façon synchrone dans l'effet de montage, provoquerait un
  // rendu en cascade que React signale.
  const charger = useCallback(async (f: Filtre) => {
    const { data, error } = await supabase.rpc("admin_client_errors_groupes", {
      p_jours: 7,
      p_source: f === "tout" ? null : f,
    });
    if (error) {
      setErreur(
        /admin_client_errors_groupes|client_errors/i.test(error.message)
          ? "Le suivi des erreurs n'est pas encore installé : appliquez la migration 20261022_suivi_erreurs.sql."
          : error.message,
      );
      setEtat("error");
      return;
    }
    setErreur(null);
    setGroupes(((data ?? []) as GroupeErreur[]).map((g) => ({
      ...g,
      occurrences: Number(g.occurrences) || 0,
      utilisateurs: Number(g.utilisateurs) || 0,
    })));
    setEtat("ready");
  }, []);

  useEffect(() => {
    // Même dette déclarée que FraicheurDonnees.tsx : react-hooks/set-state-in-effect
    // signale tout setState atteint depuis un effet, même après un await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void charger(filtre);
  }, [charger, filtre]);

  const totaux = useMemo(() => ({
    groupes: groupes.length,
    occurrences: groupes.reduce((s, g) => s + g.occurrences, 0),
    edge: groupes.filter((g) => g.source === "edge").reduce((s, g) => s + g.occurrences, 0),
  }), [groupes]);

  return (
    <div className="space-y-6">
      <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">Fiabilité</div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">Erreurs des 7 derniers jours</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Erreurs du navigateur (pages, affichage, Mimmo) et des Edge Functions, regroupées quand
              elles ont la même cause. Aucune donnée saisie par les utilisateurs n'est collectée.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setEtat("loading"); void charger(filtre); }}
            disabled={etat === "loading"}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {etat === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Actualiser
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Erreurs distinctes</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{totaux.groupes}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Occurrences</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{totaux.occurrences}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Dont Edge Functions</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{totaux.edge}</div>
          </div>
        </div>

        <div className="mt-6 inline-flex rounded-xl border border-slate-200 p-1" role="tablist" aria-label="Filtrer par origine">
          {(["tout", "front", "edge"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filtre === f}
              onClick={() => { if (f !== filtre) { setEtat("loading"); setFiltre(f); } }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                filtre === f ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f === "tout" ? "Tout" : f === "front" ? "Navigateur" : "Edge Functions"}
            </button>
          ))}
        </div>
      </header>

      {etat === "error" && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erreur}</span>
        </div>
      )}

      {etat === "ready" && groupes.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          Aucune erreur enregistrée sur la période.
        </div>
      )}

      {groupes.length > 0 && (
        <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Erreur</th>
                  <th className="px-5 py-3 font-semibold">Origine</th>
                  <th className="px-5 py-3 font-semibold">Route</th>
                  <th className="px-5 py-3 text-right font-semibold">Nombre</th>
                  <th className="px-5 py-3 text-right font-semibold">Comptes</th>
                  <th className="px-5 py-3 font-semibold">Dernière</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groupes.map((g) => {
                  const estOuvert = ouvert === g.fingerprint;
                  return (
                    <Fragment key={g.fingerprint}>
                      <tr className="cursor-pointer align-top hover:bg-slate-50/60" onClick={() => setOuvert(estOuvert ? null : g.fingerprint)}>
                        <td className="max-w-[520px] px-5 py-4">
                          <div className="flex items-start gap-2">
                            {estOuvert ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
                            <span className="break-words font-medium text-slate-900">{g.message}</span>
                          </div>
                          {g.level === "warning" && <div className="ml-6 mt-1 text-xs text-amber-700">Avertissement</div>}
                        </td>
                        <td className="px-5 py-4"><StatusBadge label={LIBELLE_SOURCE[g.source] ?? g.source} tone={toneSource(g.source)} /></td>
                        <td className="px-5 py-4 font-mono text-xs text-slate-600">{g.route}</td>
                        <td className="px-5 py-4 text-right font-semibold text-slate-900">{g.occurrences}</td>
                        <td className="px-5 py-4 text-right text-slate-700">{g.utilisateurs}</td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                          <div>{formatDateHeure(g.derniere)}</div>
                          <div className="text-xs text-slate-500">{depuis(g.derniere)}</div>
                        </td>
                      </tr>
                      {estOuvert && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={6} className="px-5 py-4">
                            <dl className="grid gap-3 text-xs text-slate-700 sm:grid-cols-3">
                              <div><dt className="font-semibold text-slate-500">Première occurrence</dt><dd>{formatDateHeure(g.premiere)}</dd></div>
                              <div><dt className="font-semibold text-slate-500">Version</dt><dd className="font-mono">{g.release ?? "—"}</dd></div>
                              <div><dt className="font-semibold text-slate-500">Empreinte</dt><dd className="font-mono">{g.fingerprint}</dd></div>
                            </dl>
                            {g.exemple_context && Object.keys(g.exemple_context).length > 0 && (
                              <pre className="mt-3 overflow-x-auto rounded-xl bg-white p-3 text-xs text-slate-700">{JSON.stringify(g.exemple_context, null, 2)}</pre>
                            )}
                            {g.exemple_stack && (
                              <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-100">{g.exemple_stack}</pre>
                            )}
                            {g.exemple_user_agent && <p className="mt-3 break-words text-xs text-slate-500">{g.exemple_user_agent}</p>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
