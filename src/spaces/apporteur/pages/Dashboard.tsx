// src/spaces/apporteur/pages/Dashboard.tsx

import {
  CheckCircle2,
  FileText,
  Pencil,
  PlusCircle,
  Search,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  deleteApporteurDeal,
  listMesApporteurDeals,
  updateApporteurDeal,
  type ApporteurDeal,
  type ApporteurDealStatus,
  type ApporteurDealTypeBien,
} from "../shared/apporteurDeals.store";

// ─── Métadonnées ──────────────────────────────────────────────────────────────

const STATUT_META: Record<ApporteurDealStatus, { label: string; bg: string; text: string }> = {
  depose:             { label: "Déposé",     bg: "bg-slate-100",   text: "text-slate-600" },
  en_etude:           { label: "En étude",   bg: "bg-blue-100",    text: "text-blue-700" },
  qualifie:           { label: "Qualifié",   bg: "bg-emerald-100", text: "text-emerald-700" },
  transmis_promoteur: { label: "Transmis",   bg: "bg-amber-100",   text: "text-amber-700" },
  refuse:             { label: "Refusé",     bg: "bg-red-50",      text: "text-red-600" },
};

const TYPE_META: Record<ApporteurDealTypeBien, string> = {
  terrain:  "Terrain nu",
  maison:   "Maison / pavillon",
  immeuble: "Immeuble",
  autre:    "Autre",
};

const TYPE_VALUES = Object.keys(TYPE_META) as ApporteurDealTypeBien[];

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit", month: "short", year: "numeric",
    }).format(new Date(iso));
  } catch { return iso; }
}

function formatPrix(v: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency", currency: "EUR", maximumFractionDigits: 0,
  }).format(v);
}

function parseNumber(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Un deal n'est modifiable/supprimable que tant qu'aucun promoteur ne s'en est saisi. */
function isEditable(deal: ApporteurDeal): boolean {
  return deal.status === "depose";
}

// ─── Filtres ──────────────────────────────────────────────────────────────────

type Filtres = {
  search: string;
  types: ApporteurDealTypeBien[];
  prixMin: string;
  prixMax: string;
  surfaceMin: string;
  surfaceMax: string;
};

const FILTRES_VIDES: Filtres = {
  search: "", types: [], prixMin: "", prixMax: "", surfaceMin: "", surfaceMax: "",
};

function filtresActifs(f: Filtres): boolean {
  return f.search.trim() !== "" || f.types.length > 0 ||
    f.prixMin !== "" || f.prixMax !== "" || f.surfaceMin !== "" || f.surfaceMax !== "";
}

function appliquerFiltres(deals: ApporteurDeal[], f: Filtres): ApporteurDeal[] {
  const q = f.search.trim().toLowerCase();
  const prixMin = parseNumber(f.prixMin);
  const prixMax = parseNumber(f.prixMax);
  const surfMin = parseNumber(f.surfaceMin);
  const surfMax = parseNumber(f.surfaceMax);

  return deals.filter((d) => {
    if (q) {
      const haystack = `${d.adresse} ${d.commune ?? ""} ${d.codePostal ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (f.types.length && !f.types.includes(d.typeBien)) return false;
    if (prixMin !== undefined && (d.prixVendeur ?? -1) < prixMin) return false;
    if (prixMax !== undefined && (d.prixVendeur ?? Infinity) > prixMax) return false;
    if (surfMin !== undefined && (d.surfaceTerrainM2 ?? -1) < surfMin) return false;
    if (surfMax !== undefined && (d.surfaceTerrainM2 ?? Infinity) > surfMax) return false;
    return true;
  });
}

// ─── Modal d'édition ──────────────────────────────────────────────────────────

type EditForm = {
  adresse: string;
  commune: string;
  typeBien: ApporteurDealTypeBien;
  surface: string;
  prix: string;
  commentaire: string;
};

function EditModal({
  deal, onClose, onSaved,
}: {
  deal: ApporteurDeal;
  onClose: () => void;
  onSaved: (updated: ApporteurDeal) => void;
}) {
  const [form, setForm] = useState<EditForm>({
    adresse:     deal.adresse,
    commune:     deal.commune ?? "",
    typeBien:    deal.typeBien,
    surface:     deal.surfaceTerrainM2 != null ? String(deal.surfaceTerrainM2) : "",
    prix:        deal.prixVendeur != null ? String(deal.prixVendeur) : "",
    commentaire: deal.commentaire ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!form.adresse.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateApporteurDeal(deal.id, {
        adresse:          form.adresse.trim(),
        commune:          form.commune.trim() || undefined,
        typeBien:         form.typeBien,
        surfaceTerrainM2: parseNumber(form.surface),
        prixVendeur:      parseNumber(form.prix),
        commentaire:      form.commentaire.trim() || undefined,
      });
      if (updated) onSaved(updated);
      else setError("Opportunité introuvable.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "La modification a échoué.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Modifier l'opportunité</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">
              Adresse <span className="text-emerald-500">*</span>
            </label>
            <input
              value={form.adresse}
              onChange={(e) => setForm((p) => ({ ...p, adresse: e.target.value }))}
              className={INPUT_CLASS}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Commune</label>
              <input
                value={form.commune}
                onChange={(e) => setForm((p) => ({ ...p, commune: e.target.value }))}
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Type de bien</label>
              <select
                value={form.typeBien}
                onChange={(e) => setForm((p) => ({ ...p, typeBien: e.target.value as ApporteurDealTypeBien }))}
                className={`${INPUT_CLASS} appearance-none`}
              >
                {TYPE_VALUES.map((t) => (
                  <option key={t} value={t}>{TYPE_META[t]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Surface (m²)</label>
              <input
                type="number" min={0}
                value={form.surface}
                onChange={(e) => setForm((p) => ({ ...p, surface: e.target.value }))}
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Prix vendeur (€)</label>
              <input
                type="number" min={0}
                value={form.prix}
                onChange={(e) => setForm((p) => ({ ...p, prix: e.target.value }))}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Commentaire</label>
            <textarea
              rows={3}
              value={form.commentaire}
              onChange={(e) => setForm((p) => ({ ...p, commentaire: e.target.value }))}
              className={`${INPUT_CLASS} resize-none`}
            />
          </div>

          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !form.adresse.trim()}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Ligne de deal ────────────────────────────────────────────────────────────

function DealRow({
  deal, onEdit, onDelete, busy,
}: {
  deal: ApporteurDeal;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const meta = STATUT_META[deal.status] ?? STATUT_META.depose;
  const editable = isEditable(deal);

  return (
    <div className="group flex items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-slate-50">
      <div className="flex min-w-0 items-start gap-4">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50">
          <FileText className="h-4 w-4 text-emerald-600" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{deal.adresse}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
            <span>{TYPE_META[deal.typeBien]}</span>
            {deal.commune && <><span>·</span><span>{deal.commune}</span></>}
            {deal.surfaceTerrainM2 != null && (
              <><span>·</span><span>{deal.surfaceTerrainM2.toLocaleString("fr-FR")} m²</span></>
            )}
            {deal.prixVendeur != null && (
              <><span>·</span><span className="font-medium text-slate-600">{formatPrix(deal.prixVendeur)}</span></>
            )}
            <span>·</span>
            <span>Déposé le {formatDate(deal.createdAt)}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${meta.bg} ${meta.text}`}>
          {meta.label}
        </span>

        {editable && (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={onEdit}
              disabled={busy}
              title="Modifier"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-emerald-300 hover:text-emerald-600 disabled:opacity-40"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              title="Supprimer"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-500 transition-colors hover:bg-red-100 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ApporteurDashboard() {
  const navigate = useNavigate();

  const [deals, setDeals] = useState<ApporteurDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ApporteurDeal | null>(null);
  const [showFiltres, setShowFiltres] = useState(false);
  const [filtres, setFiltres] = useState<Filtres>(FILTRES_VIDES);

  const charger = useCallback(async () => {
    setLoading(true);
    setErreur(null);
    try {
      setDeals(await listMesApporteurDeals());
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void charger(); }, [charger]);

  const visibles = useMemo(() => appliquerFiltres(deals, filtres), [deals, filtres]);

  const total       = deals.length;
  const transmises  = deals.filter((d) => d.status === "transmis_promoteur" || d.status === "qualifie").length;
  const enAnalyse   = deals.filter((d) => d.status === "en_etude").length;

  async function handleDelete(deal: ApporteurDeal) {
    if (busyId) return;
    if (!window.confirm(`Supprimer l'opportunité « ${deal.adresse} » ?`)) return;
    setBusyId(deal.id);
    setErreur(null);
    try {
      await deleteApporteurDeal(deal.id);
      setDeals((prev) => prev.filter((d) => d.id !== deal.id));
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Suppression impossible.");
    } finally {
      setBusyId(null);
    }
  }

  function handleSaved(updated: ApporteurDeal) {
    setDeals((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    setEditing(null);
  }

  const actifs = filtresActifs(filtres);

  return (
    <div className="min-h-screen bg-[#f7f8fc]">
      {editing && (
        <EditModal
          deal={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Bandeau vert Apporteur */}
      <div style={{
        background: "linear-gradient(135deg, #16a34a 0%, #4ade80 100%)",
        borderRadius: 24,
        padding: "32px 36px",
        marginBottom: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        boxShadow: "0 8px 32px rgba(22,163,74,0.22)",
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", letterSpacing: 1.8, textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>
            Apporteur · Deals
          </div>
          <div className="text-4xl font-semibold tracking-tight" style={{ color: "#fff", marginBottom: 10 }}>
            Espace Apporteur d'affaire
          </div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", maxWidth: 460, lineHeight: 1.55 }}>
            Qualifiez et transmettez vos opportunités foncières
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate("/apporteur/deposer")}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "13px 22px", borderRadius: 14, border: "none",
            background: "#fff", color: "#15803d",
            fontWeight: 700, fontSize: 14, cursor: "pointer",
            flexShrink: 0, boxShadow: "0 4px 20px rgba(0,0,0,0.16)",
          }}
        >
          <PlusCircle className="h-4 w-4" />
          Nouvelle opportunité
        </button>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">

        {/* KPIs */}
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Opportunités déposées",      value: String(total),      icon: FileText,    bg: "bg-slate-100",   color: "text-slate-600" },
            { label: "Transmises à un promoteur",  value: String(transmises), icon: CheckCircle2, bg: "bg-emerald-100", color: "text-emerald-700" },
            { label: "En cours d'analyse",         value: String(enAnalyse),  icon: TrendingUp,  bg: "bg-blue-100",    color: "text-blue-700" },
          ].map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div key={kpi.label} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${kpi.bg}`}>
                  <Icon className={`h-5 w-5 ${kpi.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{loading ? "—" : kpi.value}</p>
                  <p className="text-xs text-slate-500">{kpi.label}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Erreur */}
        {erreur && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {erreur}
          </div>
        )}

        {/* Liste */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">

          {/* Barre d'outils */}
          <div className="border-b border-slate-100 px-6 py-4">
            <div className="flex items-center gap-3">
              <h2 className="flex-shrink-0 text-sm font-semibold text-slate-900">Mes opportunités</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                {loading ? "—" : visibles.length}
              </span>

              <div className="relative ml-auto w-full max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={filtres.search}
                  onChange={(e) => setFiltres((p) => ({ ...p, search: e.target.value }))}
                  placeholder="Adresse, commune…"
                  className={`${INPUT_CLASS} pl-9`}
                />
              </div>

              <button
                type="button"
                onClick={() => setShowFiltres((v) => !v)}
                className={`flex flex-shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                  showFiltres || actifs
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filtres
              </button>
            </div>

            {/* Panneau filtres */}
            {showFiltres && (
              <div className="mt-4 space-y-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Type de bien</p>
                  <div className="flex flex-wrap gap-2">
                    {TYPE_VALUES.map((t) => {
                      const on = filtres.types.includes(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setFiltres((p) => ({
                            ...p,
                            types: on ? p.types.filter((x) => x !== t) : [...p.types, t],
                          }))}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                            on
                              ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          {TYPE_META[t]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Prix (€)</p>
                    <div className="flex items-center gap-2">
                      <input type="number" min={0} placeholder="Min" value={filtres.prixMin}
                        onChange={(e) => setFiltres((p) => ({ ...p, prixMin: e.target.value }))}
                        className={INPUT_CLASS} />
                      <span className="text-slate-400">–</span>
                      <input type="number" min={0} placeholder="Max" value={filtres.prixMax}
                        onChange={(e) => setFiltres((p) => ({ ...p, prixMax: e.target.value }))}
                        className={INPUT_CLASS} />
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Surface (m²)</p>
                    <div className="flex items-center gap-2">
                      <input type="number" min={0} placeholder="Min" value={filtres.surfaceMin}
                        onChange={(e) => setFiltres((p) => ({ ...p, surfaceMin: e.target.value }))}
                        className={INPUT_CLASS} />
                      <span className="text-slate-400">–</span>
                      <input type="number" min={0} placeholder="Max" value={filtres.surfaceMax}
                        onChange={(e) => setFiltres((p) => ({ ...p, surfaceMax: e.target.value }))}
                        className={INPUT_CLASS} />
                    </div>
                  </div>
                </div>

                {actifs && (
                  <button
                    type="button"
                    onClick={() => setFiltres(FILTRES_VIDES)}
                    className="text-xs font-medium text-emerald-600 transition-colors hover:text-emerald-700"
                  >
                    Réinitialiser les filtres
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Corps */}
          {loading ? (
            <div className="px-6 py-14 text-center text-sm text-slate-400">
              Chargement des opportunités…
            </div>
          ) : total === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50">
                <FileText className="h-6 w-6 text-emerald-500" />
              </div>
              <p className="text-sm font-semibold text-slate-700">
                Aucune opportunité déposée pour le moment
              </p>
              <p className="max-w-sm text-xs leading-5 text-slate-500">
                Déposez votre première opportunité foncière pour la qualifier et la
                transmettre à un promoteur.
              </p>
              <button
                type="button"
                onClick={() => navigate("/apporteur/deposer")}
                className="mt-2 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-500"
              >
                <PlusCircle className="h-4 w-4" />
                Déposer un bien
              </button>
            </div>
          ) : visibles.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
              <p className="text-sm font-semibold text-slate-700">Aucun résultat</p>
              <p className="text-xs text-slate-500">Aucune opportunité ne correspond à ces critères.</p>
              <button
                type="button"
                onClick={() => setFiltres(FILTRES_VIDES)}
                className="mt-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
              >
                Réinitialiser les filtres
              </button>
            </div>
          ) : (
            <>
              <div className="divide-y divide-slate-50">
                {visibles.map((deal) => (
                  <DealRow
                    key={deal.id}
                    deal={deal}
                    busy={busyId === deal.id}
                    onEdit={() => setEditing(deal)}
                    onDelete={() => void handleDelete(deal)}
                  />
                ))}
              </div>

              <div className="border-t border-slate-100 px-6 py-4">
                <button
                  type="button"
                  onClick={() => navigate("/apporteur/deposer")}
                  className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 transition-colors hover:text-emerald-700"
                >
                  <PlusCircle className="h-4 w-4" />
                  Déposer une nouvelle opportunité
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ApporteurDashboard;