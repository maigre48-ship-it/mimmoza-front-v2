// src/spaces/admin/pages/agentCommercial/SettingsPage.tsx
// Paramètres du module : connexion Google Workspace (OAuth). AUCUN envoi ici.
// Le « mode automatique » est présent mais désactivé (indisponible en V1).

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Plug, RefreshCw, Unplug } from "lucide-react";
import { LoadingState } from "@/components/layouts/LoadingState";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusBadge } from "@/spaces/admin/components/StatusBadge";
import { useToast } from "@/components/ui/toastContext";
import type {
  CommercialIntegrationStatus,
  IntegrationStatusValue,
} from "@/spaces/admin/types/agentCommercial.types";
import {
  disconnectGoogle,
  getIntegrationStatus,
  startGoogleOAuth,
} from "@/spaces/admin/services/agentCommercial/integration.service";
import { formatDateTime } from "./prospectFormat";

const STATUS_META: Record<
  IntegrationStatusValue,
  { label: string; tone: "emerald" | "slate" | "rose" }
> = {
  connected: { label: "Connecté", tone: "emerald" },
  disconnected: { label: "Non connecté", tone: "slate" },
  error: { label: "Erreur", tone: "rose" },
};

export function AgentCommercialSettingsPage() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const processedQuery = useRef(false);

  const [status, setStatus] = useState<CommercialIntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setStatus(await getIntegrationStatus());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Retour du callback OAuth : ?gmail=connected|error&reason=…
  useEffect(() => {
    if (processedQuery.current) return;
    const g = searchParams.get("gmail");
    if (!g) return;
    processedQuery.current = true;
    if (g === "connected") {
      toast.success("Google Workspace connecté.");
    } else {
      const reason = searchParams.get("reason");
      toast.error(`Connexion Google échouée${reason ? ` (${reason})` : ""}.`);
    }
    searchParams.delete("gmail");
    searchParams.delete("reason");
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleConnect() {
    setConnecting(true);
    try {
      const url = await startGoogleOAuth();
      window.location.assign(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connexion impossible.");
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const next = await disconnectGoogle();
      setStatus(next);
      setConfirmDisconnect(false);
      toast.success("Google Workspace déconnecté.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Déconnexion impossible.");
    } finally {
      setDisconnecting(false);
    }
  }

  const isConnected = status?.status === "connected";
  const meta = STATUS_META[status?.status ?? "disconnected"];

  return (
    <div className="space-y-5">
      {/* Connexion Google Workspace */}
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Connexion Google Workspace</h3>
            <p className="mt-1 text-sm text-slate-500">
              Nécessaire à l'envoi des emails (activé en phase 6B). L'envoi se fera depuis
              l'adresse <span className="font-medium">commercial@mimmoza.fr</span>.
            </p>
          </div>
          {status && <StatusBadge label={meta.label} tone={meta.tone} />}
        </div>

        <div className="mt-5">
          {loading ? (
            <LoadingState text="Vérification de la connexion…" />
          ) : loadError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {loadError}
            </div>
          ) : isConnected ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">Compte Google</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-800">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    {status?.account_email ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">Adresse d'envoi</div>
                  <div className="mt-0.5 text-sm text-slate-800">
                    {status?.send_as_email ?? "commercial@mimmoza.fr"}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">Dernière synchronisation</div>
                  <div className="mt-0.5 text-sm text-slate-800">{formatDateTime(status?.last_sync_at)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">Autorisations</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {status?.scopes?.length ? status.scopes.join(" · ") : "—"}
                  </div>
                </div>
              </div>

              <Button
                variant="danger"
                leftIcon={<Unplug className="h-4 w-4" />}
                onClick={() => setConfirmDisconnect(true)}
              >
                Déconnecter
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <Plug className="h-4 w-4 text-slate-400" />
                Gmail non connecté.
                {status?.status === "error" && status?.last_error && (
                  <span className="flex items-center gap-1 text-rose-600">
                    <AlertCircle className="h-4 w-4" />
                    {status.last_error}
                  </span>
                )}
              </div>
              <Button
                leftIcon={<RefreshCw className="h-4 w-4" />}
                onClick={handleConnect}
                loading={connecting}
              >
                Connecter Google Workspace
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Mode automatique — désactivé en V1 */}
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm opacity-90">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Mode automatique</h3>
            <p className="mt-1 text-sm text-slate-500">
              Envoi et relances automatiques. Indisponible en V1 : chaque email reste soumis
              à une validation humaine. Aucun envoi automatique n'est possible.
            </p>
          </div>
          <label className="inline-flex cursor-not-allowed items-center gap-2">
            <input type="checkbox" checked={false} disabled readOnly className="h-4 w-4 rounded border-slate-300" />
            <span className="text-xs font-medium text-slate-400">Désactivé</span>
          </label>
        </div>
      </section>

      <ConfirmDialog
        open={confirmDisconnect}
        title="Déconnecter Google Workspace ?"
        message="Le jeton d'accès sera révoqué. L'envoi d'emails sera impossible jusqu'à une nouvelle connexion."
        confirmLabel="Déconnecter"
        danger
        loading={disconnecting}
        onConfirm={handleDisconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}
