import { useMemo, useState } from "react";
import {
  Trash2,
  Power,
  MapPin,
  Bell,
  Sparkles,
  ChevronRight,
  Loader2,
  Plus,
  Building2,
  Search,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useUserWatchlists } from "../../hooks/useUserWatchlists";
import {
  toggleWatchlistActive,
  deleteWatchlist,
  createUserWatchlist,
} from "../../services/watchlists.service";

type PendingAction =
  | { type: "toggle"; id: string }
  | { type: "delete"; id: string }
  | null;

type FormState = {
  watchlist_name: string;
  city: string;
  zip_code: string;
  property_type: string;
};

const INITIAL_FORM: FormState = {
  watchlist_name: "",
  city: "",
  zip_code: "",
  property_type: "",
};

function getPropertyTypeLabel(value: string | null) {
  switch (value) {
    case "apartment":
      return "Appartement";
    case "house":
      return "Maison";
    case "building":
      return "Immeuble";
    case "land":
      return "Terrain";
    default:
      return "Tous types";
  }
}

export function WatchlistsSettingsCard() {
  const { watchlists, loading, refresh } = useUserWatchlists();

  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  const activeCount = useMemo(
    () => watchlists.filter((w) => w.is_active).length,
    [watchlists]
  );

  const inactiveCount = watchlists.length - activeCount;

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault();

  try {
    setIsCreating(true);
    setCreateError(null);
    setCreateSuccess(null);

    const result = await createUserWatchlist({
      watchlist_name: form.watchlist_name,
      city: form.city,
      zip_code: form.zip_code,
      property_type: form.property_type || null,
    });

    if (!result.ok) {
      setCreateError(result.error || "Impossible de créer la zone.");
      return;
    }

    setCreateSuccess("Zone surveillée créée avec succès.");
    setForm(INITIAL_FORM);
    await refresh();
  } finally {
    setIsCreating(false);
  }
}

  async function handleToggle(id: string, isActive: boolean) {
    try {
      setPendingAction({ type: "toggle", id });
      await toggleWatchlistActive(id, isActive);
      await refresh();
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = window.confirm(
      `Supprimer la zone "${name}" ? Cette action est irréversible.`
    );

    if (!confirmed) return;

    try {
      setPendingAction({ type: "delete", id });
      await deleteWatchlist(id);
      await refresh();
    } finally {
      setPendingAction(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Chargement des zones surveillées…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
              <Bell className="h-3.5 w-3.5" />
              Veille configurée
            </div>

            <h2 className="text-lg font-semibold text-slate-900">
              Mes zones surveillées
            </h2>

            <p className="max-w-2xl text-sm leading-6 text-slate-600">
              Gérez les zones que Mimmoza analyse en continu pour détecter les
              nouveaux biens, les baisses de prix et les opportunités à fort
              potentiel.
            </p>
          </div>

          <Link
            to="/veille"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Voir les opportunités
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Total
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">
              {watchlists.length}
            </div>
            <div className="mt-1 text-sm text-slate-600">zone(s) surveillée(s)</div>
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
              Actives
            </div>
            <div className="mt-2 text-2xl font-semibold text-emerald-900">
              {activeCount}
            </div>
            <div className="mt-1 text-sm text-emerald-800">
              surveillance en cours
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              En pause
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">
              {inactiveCount}
            </div>
            <div className="mt-1 text-sm text-slate-600">
              zone(s) momentanément désactivée(s)
            </div>
          </div>
        </div>

        {watchlists.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 text-indigo-500" />
              <div>
                <p className="text-sm font-medium text-slate-900">
                  Aucune zone surveillée pour le moment
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Créez votre première zone ci-dessous pour lancer la veille
                  automatique.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {watchlists.map((w) => {
              const isTogglePending =
                pendingAction?.type === "toggle" && pendingAction.id === w.id;
              const isDeletePending =
                pendingAction?.type === "delete" && pendingAction.id === w.id;
              const isBusy = isTogglePending || isDeletePending;

              return (
                <div
                  key={w.id}
                  className="rounded-2xl border border-slate-200 p-5 transition hover:border-slate-300 hover:shadow-sm"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-slate-950">
                          {w.watchlist_name}
                        </h3>

                        <span
                          className={[
                            "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
                            w.is_active
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                              : "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
                          ].join(" ")}
                        >
                          {w.is_active ? "Active" : "En pause"}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                        <MapPin className="h-4 w-4 text-slate-400" />
                        <span>
                          {w.city || "Ville non renseignée"}{" "}
                          {w.zip_code ? `(${w.zip_code})` : ""}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                          {getPropertyTypeLabel(w.property_type)}
                        </span>

                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                          Détection automatique
                        </span>

                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                          Alertes marché
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <button
                        type="button"
                        onClick={() => handleToggle(w.id, w.is_active)}
                        disabled={isBusy}
                        className={[
                          "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition",
                          w.is_active
                            ? "border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                            : "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
                          isBusy ? "cursor-not-allowed opacity-60" : "",
                        ].join(" ")}
                      >
                        {isTogglePending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Power className="h-4 w-4" />
                        )}
                        {w.is_active ? "Désactiver" : "Activer"}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(w.id, w.watchlist_name)}
                        disabled={isBusy}
                        className={[
                          "inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100",
                          isBusy ? "cursor-not-allowed opacity-60" : "",
                        ].join(" ")}
                      >
                        {isDeletePending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        Supprimer
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600">
            <Plus className="h-5 w-5" />
          </div>

          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">
              Créer une nouvelle zone
            </h2>
            <p className="text-sm leading-6 text-slate-600">
              Ajoutez une zone de veille pour suivre automatiquement un marché
              local et détecter les annonces intéressantes.
            </p>
          </div>
        </div>

        <form onSubmit={handleCreate} className="mt-6 space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-800">
                Nom de la zone
              </span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={form.watchlist_name}
                  onChange={(e) =>
                    updateForm("watchlist_name", e.target.value)
                  }
                  placeholder="Ex. Saint-Cloud appartements familiaux"
                  className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
                />
              </div>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-800">Ville</span>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => updateForm("city", e.target.value)}
                  placeholder="Ex. Saint-Cloud"
                  className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
                />
              </div>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-800">
                Code postal
              </span>
              <input
                type="text"
                value={form.zip_code}
                onChange={(e) => updateForm("zip_code", e.target.value)}
                placeholder="Ex. 92210"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-800">
                Type de bien
              </span>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  value={form.property_type}
                  onChange={(e) => updateForm("property_type", e.target.value)}
                  className="w-full appearance-none rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                >
                  <option value="">Tous types</option>
                  <option value="apartment">Appartement</option>
                  <option value="house">Maison</option>
                  <option value="building">Immeuble</option>
                  <option value="land">Terrain</option>
                </select>
              </div>
            </label>
          </div>

          {createError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {createError}
            </div>
          ) : null}

          {createSuccess ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {createSuccess}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              La zone sera activée immédiatement après sa création.
            </p>

            <button
              type="submit"
              disabled={isCreating}
              className={[
                "inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800",
                isCreating ? "cursor-not-allowed opacity-60" : "",
              ].join(" ")}
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Créer la zone
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">
            Notifications de veille
          </h2>
          <p className="text-sm leading-6 text-slate-600">
            Cette section préparera ensuite le branchement des alertes email et
            des notifications produit.
          </p>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="text-sm font-medium text-slate-900">
              Nouveaux biens
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Vous serez alerté lorsqu’un nouveau bien pertinent est détecté.
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="text-sm font-medium text-slate-900">
              Baisses de prix
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Détection automatique des annonces dont le prix baisse.
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="text-sm font-medium text-slate-900">
              Opportunités fortes
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Priorisation des biens avec meilleur potentiel marché.
            </div>
          </div>

          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">
              Prochaine étape
            </div>
            <div className="mt-1 text-sm text-slate-600">
              On branchera ici la fréquence d’envoi, l’email et les
              notifications in-app.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}