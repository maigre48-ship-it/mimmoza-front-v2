import { Lock, Sparkles, Ticket, CreditCard } from "lucide-react";

type DealUnlockModalProps = {
  open: boolean;
  dealLabel: string;
  loading: boolean;
  noTokens: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onConfirmUnlock: () => void;
  onOpenBilling: () => void;
  onOpenSubscriptions: () => void;
  onOpenTokens: () => void;
};

export function DealUnlockModal({
  open,
  dealLabel,
  loading,
  noTokens,
  errorMessage,
  onClose,
  onConfirmUnlock,
  onOpenBilling,
  onOpenSubscriptions,
  onOpenTokens,
}: DealUnlockModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            {noTokens ? <Ticket className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
          </div>

          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
              {noTokens ? "Solde insuffisant" : "Déverrouiller ce projet"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {noTokens ? (
                <>
                  Ce projet nécessite <strong>1 jeton</strong> pour accéder aux zones
                  premium. Votre solde actuel ne permet pas de continuer.
                </>
              ) : (
                <>
                  Le projet <strong>{dealLabel}</strong> nécessite <strong>1 jeton</strong>{" "}
                  pour débloquer l’accès à <strong>Sourcing</strong>,{" "}
                  <strong>Exécution</strong> et <strong>Analyse</strong>.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <Sparkles className="h-4 w-4 text-indigo-500" />
            Accès inclus une fois le projet déverrouillé
          </div>

          <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            <div className="rounded-xl bg-white px-3 py-2">✓ Sourcing</div>
            <div className="rounded-xl bg-white px-3 py-2">✓ Exécution</div>
            <div className="rounded-xl bg-white px-3 py-2">✓ Analyse</div>
            <div className="rounded-xl bg-white px-3 py-2">✓ Navigation libre sur le deal</div>
          </div>
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        )}

        {noTokens && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={onOpenSubscriptions}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              disabled={loading}
            >
              <CreditCard className="h-4 w-4" />
              Voir les abonnements
            </button>

            <button
              type="button"
              onClick={onOpenTokens}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
              disabled={loading}
            >
              <Ticket className="h-4 w-4" />
              Acheter des jetons
            </button>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            disabled={loading}
          >
            Annuler
          </button>

          {!noTokens && (
            <>
              <button
                type="button"
                onClick={onOpenBilling}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                disabled={loading}
              >
                Voir mes offres
              </button>

              <button
                type="button"
                onClick={onConfirmUnlock}
                className="rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
              >
                {loading ? "Déverrouillage..." : "Déverrouiller pour 1 jeton"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}