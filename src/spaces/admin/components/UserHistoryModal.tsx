// src/spaces/admin/components/UserHistoryModal.tsx
//
// Fiche utilisateur : chronologie consolidée + création d'un devis ou d'une
// facture pour ce compte, sans quitter l'écran Utilisateurs.
//
// Le destinataire n'est jamais choisi ici : il est imposé par l'utilisateur
// depuis lequel on a ouvert la fiche. C'est toute la différence avec les pages
// Devis / Factures, où le ClientPicker sert à le désigner.

import {
  ArrowUpRight,
  Coins,
  FileText,
  Loader2,
  Plus,
  ReceiptText,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatCents } from "../../../features/admin/billing/helpers";
import { createInvoiceWithLines } from "../../../features/admin/billing/services/invoices.service";
import { createQuoteWithLines } from "../../../features/admin/billing/services/quotes.service";
import type {
  CreateQuoteLinePayload,
  TargetSpace,
} from "../../../features/admin/billing/types";
import {
  loadUserHistory,
  type UserHistoryEvent,
  type UserHistoryResult,
} from "../services/userHistory.service";

// ── Props ────────────────────────────────────────────────────────────────────

export interface UserHistoryTarget {
  userId: string;
  email: string;
  planCodes: string | null;
  currentCredits: number;
}

interface UserHistoryModalProps {
  user: UserHistoryTarget;
  onClose: () => void;
}

type Vue = "historique" | "devis" | "facture";

// ── Formulaire ───────────────────────────────────────────────────────────────

interface LigneForm {
  label: string;
  quantite: string;
  prixUnitaireEuros: string;
}

const ligneVide = (): LigneForm => ({ label: "", quantite: "1", prixUnitaireEuros: "" });

interface PieceForm {
  societe: string;
  espaceCible: TargetSpace;
  tvaPourcent: string;
  notes: string;
  lignes: LigneForm[];
}

const formVide = (): PieceForm => ({
  societe: "",
  espaceCible: "promoteur",
  tvaPourcent: "20",
  notes: "",
  lignes: [ligneVide()],
});

// ── Helpers d'affichage ──────────────────────────────────────────────────────

function formatDateHeure(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function iconePour(kind: UserHistoryEvent["kind"]) {
  if (kind === "devis") return FileText;
  if (kind === "facture") return ReceiptText;
  return Coins;
}

function tonPour(event: UserHistoryEvent): string {
  if (event.kind === "devis") return "bg-indigo-50 text-indigo-600";
  if (event.kind === "facture") return "bg-emerald-50 text-emerald-600";
  if (event.jetons != null && event.jetons > 0) return "bg-sky-50 text-sky-600";
  return "bg-slate-100 text-slate-500";
}

/** Regroupe la frise par jour, pour donner un repère de lecture. */
function grouperParJour(events: UserHistoryEvent[]): Array<[string, UserHistoryEvent[]]> {
  const groupes = new Map<string, UserHistoryEvent[]>();
  for (const event of events) {
    const d = new Date(event.at);
    const cle = Number.isNaN(d.getTime())
      ? "Date inconnue"
      : new Intl.DateTimeFormat("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(d);
    const existant = groupes.get(cle);
    if (existant) existant.push(event);
    else groupes.set(cle, [event]);
  }
  return [...groupes.entries()];
}

// ── Composant ────────────────────────────────────────────────────────────────

export function UserHistoryModal({ user, onClose }: UserHistoryModalProps) {
  const navigate = useNavigate();

  const [vue, setVue] = useState<Vue>("historique");
  const [historique, setHistorique] = useState<UserHistoryResult | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreurHistorique, setErreurHistorique] = useState<string | null>(null);

  const [form, setForm] = useState<PieceForm>(formVide);
  const [envoi, setEnvoi] = useState(false);
  const [erreurForm, setErreurForm] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreurHistorique(null);
    loadUserHistory(user.userId)
      .then((res) => { if (!annule) setHistorique(res); })
      .catch((e: unknown) => {
        console.error("[UserHistoryModal] chargement impossible:", e);
        if (!annule) setErreurHistorique((e as Error).message);
      })
      .finally(() => { if (!annule) setChargement(false); });
    return () => { annule = true; };
  }, [user.userId]);

  useEffect(() => {
    const surEchap = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", surEchap);
    return () => window.removeEventListener("keydown", surEchap);
  }, [onClose]);

  const totalHtCents = useMemo(
    () =>
      form.lignes.reduce((acc, l) => {
        const q = parseFloat(l.quantite) || 0;
        const pu = Math.round((parseFloat(l.prixUnitaireEuros) || 0) * 100);
        return acc + Math.round(q * pu);
      }, 0),
    [form.lignes],
  );
  const tvaBps = Math.round((parseFloat(form.tvaPourcent) || 0) * 100);
  const tvaCents = Math.round(totalHtCents * (tvaBps / 10000));
  const ttcCents = totalHtCents + tvaCents;

  function majLigne(index: number, cle: keyof LigneForm, valeur: string) {
    setForm((f) => {
      const lignes = [...f.lignes];
      lignes[index] = { ...lignes[index], [cle]: valeur };
      return { ...f, lignes };
    });
  }

  function ouvrirCreation(mode: "devis" | "facture") {
    setForm(formVide());
    setErreurForm(null);
    setVue(mode);
  }

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreurForm(null);
    try {
      // Pas de `|| 1` sur la quantité : une saisie à 0 doit être refusée
      // explicitement, pas transformée en 1 dans le dos de l'utilisateur.
      const lignes: CreateQuoteLinePayload[] = form.lignes.map((l, i) => {
        const quantite = parseFloat(l.quantite);
        if (!Number.isFinite(quantite) || quantite <= 0) {
          throw new Error(`Ligne ${i + 1} : la quantité doit être supérieure à 0.`);
        }
        return {
          label: l.label,
          quantity: quantite,
          unit_price_ht_cents: Math.round((parseFloat(l.prixUnitaireEuros) || 0) * 100),
          sort_order: i,
        };
      });

      if (vue === "devis") {
        const devis = await createQuoteWithLines({
          company_name: form.societe,
          contact_email: user.email,
          target_space: form.espaceCible,
          vat_rate_bps: tvaBps,
          notes: form.notes || undefined,
          recipient_user_id: user.userId,
          lines: lignes,
        });
        navigate(`/admin/devis?highlight=${devis.id}`);
      } else {
        const facture = await createInvoiceWithLines({
          company_name: form.societe,
          contact_email: user.email,
          vat_rate_bps: tvaBps,
          notes: form.notes || undefined,
          recipient_user_id: user.userId,
          lines: lignes,
        });
        navigate(`/admin/factures?highlight=${facture.id}`);
      }
      onClose();
    } catch (e) {
      setErreurForm((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  const groupes = historique ? grouperParJour(historique.events) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-xl">
        {/* ── En-tête ── */}
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-950">
              {vue === "historique" && "Historique du compte"}
              {vue === "devis" && "Nouveau devis"}
              {vue === "facture" && "Nouvelle facture"}
            </h2>
            <p className="mt-1 truncate text-sm text-slate-500">{user.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                {user.currentCredits} jetons
              </span>
              {user.planCodes && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                  {user.planCodes}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Corps ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {vue === "historique" ? (
            <>
              {chargement && (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Chargement de l'historique…
                </div>
              )}

              {!chargement && erreurHistorique && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {erreurHistorique}
                </div>
              )}

              {!chargement && historique && (
                <>
                  {/* Compteurs */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Compteur libelle="Jetons crédités" valeur={`+${historique.totaux.jetonsCredites}`} />
                    <Compteur libelle="Jetons consommés" valeur={`−${historique.totaux.jetonsDebites}`} />
                    <Compteur libelle="Devis" valeur={String(historique.totaux.devis)} />
                    <Compteur libelle="Factures" valeur={String(historique.totaux.factures)} />
                  </div>

                  {/* Avertissements : une source illisible ne doit jamais passer
                      pour une absence d'activité. */}
                  {historique.warnings.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {historique.warnings.map((w) => (
                        <div
                          key={w}
                          className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
                        >
                          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Frise */}
                  {historique.events.length === 0 ? (
                    <p className="py-12 text-center text-sm text-slate-500">
                      Aucun événement enregistré pour ce compte.
                    </p>
                  ) : (
                    <div className="mt-6 space-y-6">
                      {groupes.map(([jour, events]) => (
                        <div key={jour}>
                          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                            {jour}
                          </div>
                          <div className="space-y-1.5">
                            {events.map((event) => {
                              const Icone = iconePour(event.kind);
                              return (
                                <div
                                  key={event.id}
                                  className="flex items-center gap-3 rounded-2xl border border-slate-100 px-3 py-2.5"
                                >
                                  <span className={`rounded-xl p-2 ${tonPour(event)}`}>
                                    <Icone className="h-3.5 w-3.5" />
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-slate-900">
                                      {event.label}
                                    </div>
                                    {event.detail && (
                                      <div className="truncate text-xs text-slate-400">
                                        {event.detail}
                                      </div>
                                    )}
                                  </div>
                                  <div className="shrink-0 text-right">
                                    {event.jetons != null && (
                                      <div
                                        className={`text-sm font-semibold ${
                                          event.jetons > 0 ? "text-sky-600" : "text-slate-500"
                                        }`}
                                      >
                                        {event.jetons > 0 ? `+${event.jetons}` : event.jetons}
                                      </div>
                                    )}
                                    {event.montantCents != null && (
                                      <div className="text-sm font-semibold text-slate-900">
                                        {formatCents(event.montantCents)}
                                      </div>
                                    )}
                                    <div className="text-[11px] text-slate-400">
                                      {formatDateHeure(event.at)}
                                    </div>
                                  </div>
                                  {event.href && (
                                    <button
                                      type="button"
                                      title="Ouvrir la pièce"
                                      onClick={() => { navigate(event.href as string); onClose(); }}
                                      className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                                    >
                                      <ArrowUpRight className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            /* ── Formulaire devis / facture ── */
            <form id="form-piece" onSubmit={soumettre} className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {vue === "devis" ? "Ce devis" : "Cette facture"} sera rattachée au compte{" "}
                <span className="font-medium text-slate-900">{user.email}</span> et créée en
                brouillon.
              </div>

              {erreurForm && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {erreurForm}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">
                    Société <span className="text-rose-500">*</span>
                  </label>
                  <input
                    required
                    type="text"
                    value={form.societe}
                    onChange={(e) => setForm((f) => ({ ...f, societe: e.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                    autoFocus
                  />
                </div>

                {vue === "devis" && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">
                      Espace cible
                    </label>
                    <select
                      value={form.espaceCible}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, espaceCible: e.target.value as TargetSpace }))
                      }
                      className="w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                    >
                      <option value="promoteur">Promoteur</option>
                      <option value="financeur">Financeur</option>
                      <option value="investisseur">Investisseur</option>
                      <option value="autre">Autre</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">
                    TVA (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={form.tvaPourcent}
                    onChange={(e) => setForm((f) => ({ ...f, tvaPourcent: e.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                  />
                </div>
              </div>

              {/* Lignes */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">Lignes</span>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, lignes: [...f.lignes, ligneVide()] }))}
                    className="flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    <Plus className="h-3 w-3" />
                    Ajouter
                  </button>
                </div>

                <div className="space-y-2">
                  {form.lignes.map((ligne, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <input
                        required
                        type="text"
                        placeholder="Désignation"
                        value={ligne.label}
                        onChange={(e) => majLigne(index, "label", e.target.value)}
                        className="min-w-0 flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                      />
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="Qté"
                        value={ligne.quantite}
                        onChange={(e) => majLigne(index, "quantite", e.target.value)}
                        className="w-20 shrink-0 rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                      />
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="P.U. HT €"
                        value={ligne.prixUnitaireEuros}
                        onChange={(e) => majLigne(index, "prixUnitaireEuros", e.target.value)}
                        className="w-28 shrink-0 rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                      />
                      <button
                        type="button"
                        disabled={form.lignes.length === 1}
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            lignes: f.lignes.filter((_, i) => i !== index),
                          }))
                        }
                        className="shrink-0 rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                        title="Supprimer la ligne"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                />
              </div>

              {/* Totaux */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>Total HT</span>
                  <span>{formatCents(totalHtCents)}</span>
                </div>
                <div className="mt-1 flex justify-between text-slate-600">
                  <span>TVA</span>
                  <span>{formatCents(tvaCents)}</span>
                </div>
                <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-950">
                  <span>Total TTC</span>
                  <span>{formatCents(ttcCents)}</span>
                </div>
              </div>
            </form>
          )}
        </div>

        {/* ── Pied ── */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          {vue === "historique" ? (
            <>
              <span className="text-xs text-slate-400">
                Jetons, devis et factures. Le contenu des conversations n'est pas consultable.
              </span>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => ouvrirCreation("devis")}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  <FileText className="h-3.5 w-3.5 text-slate-500" />
                  Créer un devis
                </button>
                <button
                  type="button"
                  onClick={() => ouvrirCreation("facture")}
                  className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-800"
                >
                  <ReceiptText className="h-3.5 w-3.5" />
                  Créer une facture
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setVue("historique")}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Retour à l'historique
              </button>
              <button
                type="submit"
                form="form-piece"
                disabled={envoi}
                className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {envoi && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {vue === "devis" ? "Créer le devis" : "Créer la facture"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Compteur({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs text-slate-400">{libelle}</div>
      <div className="mt-0.5 text-lg font-semibold text-slate-950">{valeur}</div>
    </div>
  );
}
