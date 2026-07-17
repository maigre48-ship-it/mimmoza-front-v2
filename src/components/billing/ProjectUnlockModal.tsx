// src/components/billing/ProjectUnlockModal.tsx
// Modal generique de deverrouillage de projet (espaces promoteur/rehab/...).
// On garde DealUnlockModal intact cote Investisseur ; ceci est le pendant generique.

import { CreditCard, Lock, Sparkles, Ticket } from "lucide-react";

type ProjectUnlockModalProps = {
  open: boolean;
  projectLabel: string;
  /** Message contextuel optionnel (ex. « étude expirée »), affiché en bannière. */
  notice?: string;
  features?: string[];
  loading: boolean;
  noTokens: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onConfirmUnlock: () => void;
  onOpenBilling?: () => void;
  onOpenSubscriptions?: () => void;
  onOpenTokens?: () => void;
};

const DEFAULT_FEATURES = ["Acces complet au projet", "Navigation libre"];

export function ProjectUnlockModal({
  open,
  projectLabel,
  notice,
  features,
  loading,
  noTokens,
  errorMessage,
  onClose,
  onConfirmUnlock,
  onOpenBilling,
  onOpenSubscriptions,
  onOpenTokens,
}: ProjectUnlockModalProps) {
  if (!open) return null;

  const accessList = features && features.length > 0 ? features : DEFAULT_FEATURES;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            {noTokens ? <Ticket className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
          </div>

          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
              {noTokens ? "Solde insuffisant" : "Deverrouiller ce projet"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {noTokens ? (
                <>
                  Ce projet necessite <strong>1 jeton</strong> pour acceder aux zones
                  premium. Votre solde actuel ne permet pas de continuer.
                </>
              ) : (
                <>
                  Le projet <strong>{projectLabel}</strong> necessite <strong>1 jeton</strong>{" "}
                  pour debloquer l&apos;acces complet.
                </>
              )}
            </p>
          </div>
        </div>

        {notice && !noTokens && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {notice}
          </div>
        )}

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <Sparkles className="h-4 w-4 text-indigo-500" />
            Acces inclus une fois le projet deverrouille
          </div>

          <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            {accessList.map((f) => (
              <div key={f} className="rounded-xl bg-white px-3 py-2">{"\u2713 "}{f}</div>
            ))}
          </div>
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        )}

        {noTokens && (onOpenSubscriptions || onOpenTokens) && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {onOpenSubscriptions && (
              <button
                type="button"
                onClick={onOpenSubscriptions}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                disabled={loading}
              >
                <CreditCard className="h-4 w-4" />
                Voir les abonnements
              </button>
            )}

            {onOpenTokens && (
              <button
                type="button"
                onClick={onOpenTokens}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
                disabled={loading}
              >
                <Ticket className="h-4 w-4" />
                Acheter des jetons
              </button>
            )}
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
              {onOpenBilling && (
                <button
                  type="button"
                  onClick={onOpenBilling}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  disabled={loading}
                >
                  Voir mes offres
                </button>
              )}

              <button
                type="button"
                onClick={onConfirmUnlock}
                className="rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
              >
                {loading ? "Deverrouillage..." : "Deverrouiller pour 1 jeton"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}