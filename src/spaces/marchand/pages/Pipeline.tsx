import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Plus, Workflow, Clock, Euro, TrendingUp, CheckCircle2, X, Pencil } from "lucide-react";
import PageShell from "../shared/ui/PageShell";
import SectionCard from "../shared/ui/SectionCard";
import KpiCard from "../shared/ui/KpiCard";
import {
  readMarchandSnapshot,
  upsertDeal,
  setActiveDeal,
  deleteDeal,
  type MarchandDealStatus,
  type MarchandDeal,
} from "../shared/marchandSnapshot.store";
import useMarchandSnapshotTick from "../shared/hooks/useMarchandSnapshotTick";
import {
  setActiveDealId as setBridgeActiveDealId,
  patchDealContextMeta,
  subscribe as subscribeDealContext,
  type DealContextMeta,
} from "../shared/marchandDealContext.store";

type DealStatus = MarchandDealStatus;
type Deal = MarchandDeal;

const COLUMNS: DealStatus[] = ["Nouveau", "Visite", "Offre", "Sous promesse", "Travaux", "En vente", "Vendu"];

const fmtEur = (n?: number) =>
  typeof n === "number"
    ? n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
    : "—";

const nowIso = () => new Date().toISOString();

/* ────────────────────────────────────────────
   City auto-lookup from zipCode
   ──────────────────────────────────────────── */

async function fetchCityFromZipCode(zipCode: string): Promise<string | null> {
  const cleaned = zipCode.replace(/\s/g, "");
  if (!/^\d{5}$/.test(cleaned)) return null;
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(cleaned)}&type=municipality&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json = await res.json();
    const feature = json?.features?.[0];
    if (!feature) return null;
    return feature.properties?.city ?? feature.properties?.label ?? null;
  } catch {
    return null;
  }
}

/* ────────────────────────────────────────────
   Deal → meta bridge
   ──────────────────────────────────────────── */

function buildDealMeta(deal: Deal): DealContextMeta {
  return {
    title: deal.title,
    stage: deal.status,
    address: deal.address ?? undefined,
    zipCode: deal.zipCode ?? undefined,
    city: deal.city ?? undefined,
    purchasePrice: deal.prixAchat ?? undefined,
    surface: deal.surfaceM2 ?? undefined,
    resaleTarget: deal.prixReventeCible ?? undefined,
    note: deal.note ?? undefined,
  };
}

function syncDealContext(deal: Deal): void {
  setBridgeActiveDealId(deal.id, buildDealMeta(deal));
}

function makeNewDeal(): Deal {
  const id = `D-${Math.floor(Math.random() * 900 + 100)}`;
  return {
    id,
    title: `Nouveau deal ${id}`,
    address: "",
    zipCode: "",
    city: "—",
    country: "FR",
    prixAchat: undefined,
    surfaceM2: undefined,
    prixReventeCible: undefined,
    note: "",
    status: "Nouveau",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  } as Deal;
}

/* ────────────────────────────────────────────
   Drawer
   ──────────────────────────────────────────── */

function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(2,6,23,0.35)",
        display: "flex",
        justifyContent: "flex-end",
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: 460,
          maxWidth: "92vw",
          height: "100%",
          background: "white",
          borderLeft: "1px solid rgba(15,23,42,0.10)",
          padding: 16,
          overflow: "auto",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontWeight: 950, fontSize: 16, color: "#0f172a" }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid rgba(15,23,42,0.10)",
              background: "rgba(15,23,42,0.04)",
              borderRadius: 10,
              padding: "8px 10px",
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            Fermer
          </button>
        </div>
        <div style={{ height: 12 }} />
        {children}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────
   Field / Select
   ──────────────────────────────────────────── */

function Field({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  hint,
}: {
  label: string;
  value: string | number | undefined;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: "text" | "number";
  hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>{label}</div>
      <input
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid rgba(15, 23, 42, 0.10)",
          background: "rgba(255,255,255,0.95)",
          fontWeight: 800,
          color: "#0f172a",
          outline: "none",
        }}
      />
      {hint && (
        <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>{hint}</div>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid rgba(15, 23, 42, 0.10)",
          background: "rgba(255,255,255,0.95)",
          fontWeight: 800,
          color: "#0f172a",
          outline: "none",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ════════════════════════════════════════════
   MarchandPipeline
   ════════════════════════════════════════════ */

export default function MarchandPipeline() {
  const snapTick = useMarchandSnapshotTick();
  const snapshot = useMemo(() => readMarchandSnapshot(), [snapTick]);
  const deals: Deal[] = useMemo(() => snapshot.deals.map((d) => ({ ...d })), [snapshot.deals]);
  const activeDealId = snapshot.activeDealId;

  const [editingDealId, setEditingDealId] = useState<string | null>(null);

  /* ── Ville auto-fetch state ── */
  const [cityLookupHint, setCityLookupHint] = useState<string>("");
  const zipFetchRef = useRef(0);

  /* ══════════════════════════════════════════
     DRAFT LOCAL STATE pour le Drawer
     ══════════════════════════════════════════
     On bufferise les modifications dans un state local (draftDeal).
     onChange → met à jour draftDeal (rapide, pas de store write)
     onBlur  → flush vers le store (upsertDeal + syncDealContext)
     
     Cela résout le bug des espaces : avant, chaque frappe déclenchait
     upsertDeal → snapTick → re-render → editingDeal relu depuis le store
     → React perdait le curseur et les espaces.
  */
  const [draftDeal, setDraftDeal] = useState<Deal | null>(null);

  // Initialiser draftDeal quand on ouvre le drawer
  useEffect(() => {
    if (editingDealId) {
      const deal = deals.find((d) => d.id === editingDealId) ?? null;
      setDraftDeal(deal ? { ...deal } : null);
    } else {
      setDraftDeal(null);
    }
    setCityLookupHint("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingDealId]);
  // ⚠ On ne met PAS `deals` dans les deps : sinon chaque flush → snapTick → deals change → draftDeal reset

  /** Met à jour le draft local (pas de store write). */
  const updateDraft = useCallback((patch: Partial<Deal>) => {
    setDraftDeal((prev) => prev ? { ...prev, ...patch, updatedAt: nowIso() } : null);
  }, []);

  /** Flush le draft vers le store. Appelé sur onBlur des champs texte. */
  const flushDraft = useCallback(() => {
    if (!draftDeal) return;
    upsertDeal(draftDeal);
    if (activeDealId === draftDeal.id) {
      syncDealContext(draftDeal);
    }
  }, [draftDeal, activeDealId]);

  /** Flush + city auto-lookup (pour le champ code postal). */
  const flushDraftWithCityLookup = useCallback(() => {
    if (!draftDeal) return;
    upsertDeal(draftDeal);
    if (activeDealId === draftDeal.id) {
      syncDealContext(draftDeal);
    }

    const zip = draftDeal.zipCode ?? "";
    const cleaned = zip.replace(/\s/g, "");
    if (/^\d{5}$/.test(cleaned)) {
      const seq = ++zipFetchRef.current;
      setCityLookupHint("Recherche de la commune…");
      fetchCityFromZipCode(cleaned).then((city) => {
        if (seq !== zipFetchRef.current) return;
        if (city) {
          setCityLookupHint(`→ ${city}`);
          setDraftDeal((prev) => {
            if (!prev) return prev;
            const updated = { ...prev, city, updatedAt: nowIso() };
            upsertDeal(updated);
            if (activeDealId === prev.id) syncDealContext(updated);
            patchDealContextMeta({ city });
            return updated;
          });
        } else {
          setCityLookupHint("Commune non trouvée pour ce code postal");
        }
      });
    } else {
      setCityLookupHint("");
    }
  }, [draftDeal, activeDealId]);

  /** Pour les selects → flush immédiat (pas de onBlur). */
  const updateAndFlush = useCallback((patch: Partial<Deal>) => {
    setDraftDeal((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...patch, updatedAt: nowIso() };
      upsertDeal(updated);
      if (activeDealId === updated.id) syncDealContext(updated);
      return updated;
    });
  }, [activeDealId]);

  /* ── Sync bridge store quand activeDealId change ────── */
  useEffect(() => {
    if (!activeDealId) return;
    const deal = deals.find((d) => d.id === activeDealId);
    if (deal) syncDealContext(deal);
  }, [activeDealId, deals]);

  /* ── Écouter les changements cross-tab du bridge store ── */
  useEffect(() => {
    const unsub = subscribeDealContext((ctx) => {
      if (ctx.activeDealId && ctx.activeDealId !== activeDealId) {
        setActiveDeal(ctx.activeDealId);
      }
    });
    return unsub;
  }, [activeDealId]);

  const totalDeals = deals.length;
  const inProgress = deals.filter((d) => d.status !== "Vendu").length;
  const budgetAchat = undefined;

  const handleCreateDeal = () => {
    const d = makeNewDeal();
    upsertDeal(d);
    setActiveDeal(d.id);
    syncDealContext(d);
    setEditingDealId(d.id);
  };

  const handleSelectDeal = (id: string) => {
    setActiveDeal(id);
  };

  const handleDeleteDeal = (e: React.MouseEvent, dealId: string, dealTitle: string) => {
    e.stopPropagation();
    const confirmed = window.confirm(
      `Supprimer ce deal ?\n\n"${dealTitle}"\n\nToutes les données associées (Rentabilité, Exécution, Sortie) seront également supprimées.`
    );
    if (confirmed) {
      deleteDeal(dealId);
      if (activeDealId === dealId) {
        setBridgeActiveDealId(null);
      }
    }
  };

  /** Flush le draft quand on ferme le drawer. */
  const handleCloseDrawer = useCallback(() => {
    if (draftDeal) {
      upsertDeal(draftDeal);
      if (activeDealId === draftDeal.id) syncDealContext(draftDeal);
    }
    setEditingDealId(null);
  }, [draftDeal, activeDealId]);

  return (
    <PageShell
      title="Pipeline"
      subtitle="Deal flow et statuts — snapshot actif partagé entre toutes les pages Marchand."
      right={
        <button
          type="button"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(15, 23, 42, 0.10)",
            background: "rgba(15, 23, 42, 0.04)",
            fontWeight: 900,
            cursor: "pointer",
          }}
          onClick={handleCreateDeal}
        >
          <Plus size={18} />
          Nouveau deal
        </button>
      }
    >
      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <KpiCard label="Deals" value={`${totalDeals}`} hint="Total" icon={<Workflow size={18} />} />
        <KpiCard label="En cours" value={`${inProgress}`} hint="Hors vendus" icon={<Clock size={18} />} />
        <KpiCard label="Budget achat" value={fmtEur(budgetAchat)} hint="Snapshot (à brancher)" icon={<Euro size={18} />} />
        <KpiCard label="Marge cible" value="—" hint="À calculer (Rentabilité)" icon={<TrendingUp size={18} />} />
      </div>

      <div style={{ height: 12 }} />

      <SectionCard title="Deal flow" subtitle="Sélectionne un deal pour synchroniser toutes les pages.">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(220px, 1fr))`,
            gap: 10,
            overflowX: "auto",
            paddingBottom: 6,
          }}
        >
          {COLUMNS.map((col) => {
            const colDeals = deals.filter((d) => d.status === col);

            return (
              <div
                key={col}
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(15, 23, 42, 0.08)",
                  background: "rgba(248,250,252,0.6)",
                  padding: 10,
                  minHeight: 220,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 900, color: "#0f172a" }}>{col}</div>
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>{colDeals.length}</div>
                </div>

                <div style={{ height: 8 }} />

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {colDeals.map((d) => {
                    const isActive = activeDealId === d.id;

                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => handleSelectDeal(d.id)}
                        style={{
                          position: "relative",
                          textAlign: "left",
                          borderRadius: 12,
                          background: isActive ? "rgba(59,130,246,0.10)" : "rgba(255,255,255,0.95)",
                          border: isActive
                            ? "1px solid rgba(59,130,246,0.22)"
                            : "1px solid rgba(15, 23, 42, 0.08)",
                          boxShadow: "0 10px 20px rgba(2,6,23,0.05)",
                          padding: 10,
                          cursor: "pointer",
                        }}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => handleDeleteDeal(e, d.id, d.title)}
                          style={{
                            position: "absolute",
                            top: 6,
                            right: 6,
                            width: 24,
                            height: 24,
                            borderRadius: 999,
                            background: "rgba(239, 68, 68, 0.08)",
                            border: "1px solid rgba(239, 68, 68, 0.15)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                          }}
                          title="Supprimer ce deal"
                        >
                          <X size={14} style={{ color: "#dc2626" }} />
                        </div>

                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveDeal(d.id);
                            syncDealContext(d);
                            setEditingDealId(d.id);
                          }}
                          style={{
                            position: "absolute",
                            top: 6,
                            right: 36,
                            width: 24,
                            height: 24,
                            borderRadius: 999,
                            background: "rgba(15, 23, 42, 0.06)",
                            border: "1px solid rgba(15, 23, 42, 0.10)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                          }}
                          title="Éditer ce deal"
                        >
                          <Pencil size={14} style={{ color: "#0f172a" }} />
                        </div>

                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, paddingRight: 64 }}>
                          <div style={{ fontWeight: 900, color: "#0f172a", fontSize: 13 }}>{d.title}</div>
                          {isActive && (
                            <div
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "4px 8px",
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 900,
                                background: "rgba(59,130,246,0.10)",
                                border: "1px solid rgba(59,130,246,0.22)",
                                color: "#1d4ed8",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <CheckCircle2 size={14} />
                              Actif
                            </div>
                          )}
                        </div>

                        <div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>
                          {d.address ? d.address : (d.city ?? "—")}
                        </div>

                        <div style={{ marginTop: 6, color: "#94a3b8", fontSize: 11 }}>
                          {d.id} · Maj {new Date(d.updatedAt).toLocaleDateString("fr-FR")}
                        </div>
                      </button>
                    );
                  })}

                  {colDeals.length === 0 && <div style={{ color: "#94a3b8", fontSize: 12, padding: "8px 2px" }}>—</div>}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* ═══ DRAWER ÉDITION — utilise draftDeal (state local) ═══ */}
      <Drawer
        open={Boolean(draftDeal)}
        title={draftDeal ? `Éditer — ${draftDeal.id}` : "Éditer"}
        onClose={handleCloseDrawer}
      >
        {!draftDeal ? (
          <div style={{ color: "#64748b", fontSize: 13 }}>Aucun deal sélectionné.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field
              label="Titre"
              value={draftDeal.title}
              onChange={(v) => updateDraft({ title: v })}
              onBlur={flushDraft}
              placeholder="Ex: T2 à rénover — 42 m²"
            />

            <Field
              label="Adresse"
              value={draftDeal.address ?? ""}
              onChange={(v) => updateDraft({ address: v })}
              onBlur={flushDraft}
              placeholder="Ex: 12 rue de la Paix"
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field
                label="Code postal"
                value={draftDeal.zipCode ?? ""}
                onChange={(v) => updateDraft({ zipCode: v })}
                onBlur={flushDraftWithCityLookup}
                placeholder="Ex: 44000"
                hint={cityLookupHint || undefined}
              />
              <Field
                label="Ville"
                value={draftDeal.city ?? ""}
                onChange={(v) => updateDraft({ city: v })}
                onBlur={flushDraft}
                placeholder="Ex: Nantes"
                hint="Auto-remplie via code postal"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field
                label="Prix d'achat (€)"
                type="number"
                value={draftDeal.prixAchat ?? ""}
                onChange={(v) => updateDraft({ prixAchat: v === "" ? undefined : Number(v) })}
                onBlur={flushDraft}
                placeholder="Ex: 180000"
              />
              <Field
                label="Surface (m²)"
                type="number"
                value={draftDeal.surfaceM2 ?? ""}
                onChange={(v) => updateDraft({ surfaceM2: v === "" ? undefined : Number(v) })}
                onBlur={flushDraft}
                placeholder="Ex: 42"
              />
            </div>

            <Field
              label="Prix revente cible (€)"
              type="number"
              value={draftDeal.prixReventeCible ?? ""}
              onChange={(v) => updateDraft({ prixReventeCible: v === "" ? undefined : Number(v) })}
              onBlur={flushDraft}
              placeholder="Ex: 260000"
            />

            <Select
              label="Statut"
              value={draftDeal.status}
              onChange={(v) => updateAndFlush({ status: v as DealStatus })}
              options={COLUMNS.map((c) => ({ value: c, label: c }))}
            />

            <Field
              label="Note"
              value={draftDeal.note ?? ""}
              onChange={(v) => updateDraft({ note: v })}
              onBlur={flushDraft}
              placeholder="Remarques, contact, points à vérifier..."
            />

            <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
              Astuce : ces champs alimenteront Sourcing/Qualification. Rentabilité/Exécution/Sortie restent par module.
            </div>
          </div>
        )}
      </Drawer>
    </PageShell>
  );
}