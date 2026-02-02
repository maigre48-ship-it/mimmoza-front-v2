import React, { useMemo, useState } from "react";
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

type DealStatus = MarchandDealStatus;
type Deal = MarchandDeal;

const COLUMNS: DealStatus[] = ["Nouveau", "Visite", "Offre", "Sous promesse", "Travaux", "En vente", "Vendu"];

const fmtEur = (n?: number) =>
  typeof n === "number"
    ? n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
    : "—";

const nowIso = () => new Date().toISOString();

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

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string | number | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "number";
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>{label}</div>
      <input
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
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
      />
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

export default function MarchandPipeline() {
  const snapTick = useMarchandSnapshotTick();
  const snapshot = useMemo(() => readMarchandSnapshot(), [snapTick]);
  const deals: Deal[] = useMemo(() => snapshot.deals.map((d) => ({ ...d })), [snapshot.deals]);
  const activeDealId = snapshot.activeDealId;

  const [editingDealId, setEditingDealId] = useState<string | null>(null);

  const totalDeals = deals.length;
  const inProgress = deals.filter((d) => d.status !== "Vendu").length;

  const budgetAchat = undefined;

  const editingDeal = useMemo(
    () => (editingDealId ? deals.find((d) => d.id === editingDealId) ?? null : null),
    [editingDealId, deals]
  );

  const handleCreateDeal = () => {
    const d = makeNewDeal();
    upsertDeal(d);
    setActiveDeal(d.id);
    setEditingDealId(d.id); // ✅ on ouvre directement l’édition
  };

  const handleSelectDeal = (id: string) => {
    setActiveDeal(id);
  };

  const handleDeleteDeal = (e: React.MouseEvent, dealId: string, dealTitle: string) => {
    e.stopPropagation();
    const confirmed = window.confirm(
      `Supprimer ce deal ?\n\n"${dealTitle}"\n\nToutes les données associées (Rentabilité, Exécution, Sortie) seront également supprimées.`
    );
    if (confirmed) deleteDeal(dealId);
  };

  const handleSaveDeal = (patch: Partial<Deal>) => {
    if (!editingDeal) return;
    upsertDeal({
      ...editingDeal,
      ...patch,
      updatedAt: nowIso(),
    } as Deal);
  };

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
                        {/* Supprimer */}
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

                        {/* Edit */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
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

      <Drawer
        open={Boolean(editingDeal)}
        title={editingDeal ? `Éditer — ${editingDeal.id}` : "Éditer"}
        onClose={() => setEditingDealId(null)}
      >
        {!editingDeal ? (
          <div style={{ color: "#64748b", fontSize: 13 }}>Aucun deal sélectionné.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field
              label="Titre"
              value={editingDeal.title}
              onChange={(v) => handleSaveDeal({ title: v })}
              placeholder="Ex: T2 à rénover — 42 m²"
            />

            <Field
              label="Adresse"
              value={editingDeal.address ?? ""}
              onChange={(v) => handleSaveDeal({ address: v })}
              placeholder="Ex: 12 rue de la Paix"
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field
                label="Code postal"
                value={editingDeal.zipCode ?? ""}
                onChange={(v) => handleSaveDeal({ zipCode: v })}
                placeholder="Ex: 44000"
              />
              <Field
                label="Ville"
                value={editingDeal.city ?? ""}
                onChange={(v) => handleSaveDeal({ city: v })}
                placeholder="Ex: Nantes"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field
                label="Prix d'achat (€)"
                type="number"
                value={editingDeal.prixAchat ?? ""}
                onChange={(v) => handleSaveDeal({ prixAchat: v === "" ? undefined : Number(v) })}
                placeholder="Ex: 180000"
              />
              <Field
                label="Surface (m²)"
                type="number"
                value={editingDeal.surfaceM2 ?? ""}
                onChange={(v) => handleSaveDeal({ surfaceM2: v === "" ? undefined : Number(v) })}
                placeholder="Ex: 42"
              />
            </div>

            <Field
              label="Prix revente cible (€)"
              type="number"
              value={editingDeal.prixReventeCible ?? ""}
              onChange={(v) => handleSaveDeal({ prixReventeCible: v === "" ? undefined : Number(v) })}
              placeholder="Ex: 260000"
            />

            <Select
              label="Statut"
              value={editingDeal.status}
              onChange={(v) => handleSaveDeal({ status: v as DealStatus })}
              options={COLUMNS.map((c) => ({ value: c, label: c }))}
            />

            <Field
              label="Note"
              value={editingDeal.note ?? ""}
              onChange={(v) => handleSaveDeal({ note: v })}
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
