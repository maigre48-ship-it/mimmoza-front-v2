import {
  CheckCircle2,
  Clock,
  Euro,
  Pencil,
  Plus,
  Sparkles,
  TrendingUp,
  Workflow,
  X,
} from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useMarchandSnapshotTick from "../shared/hooks/useMarchandSnapshotTick";
import {
  patchDealContextMeta,
  setActiveDealId as setBridgeActiveDealId,
  subscribe as subscribeDealContext,
  type DealContextMeta,
} from "../shared/marchandDealContext.store";
import {
  deleteDeal,
  readMarchandSnapshot,
  setActiveDeal,
  upsertDeal,
  type MarchandDeal,
  type MarchandDealStatus,
} from "../shared/marchandSnapshot.store";

type DealStatus = MarchandDealStatus;
type Deal = MarchandDeal;

const COLUMNS: DealStatus[] = [
  "Nouveau",
  "Visite",
  "Offre",
  "Sous promesse",
  "Travaux",
  "En vente",
  "Vendu",
];

const PENDING_OPPORTUNITY_STORAGE_KEY = "mimmoza.pendingOpportunityDeal";

const ACCENT_INV = "#1a72c4";

const STATUS_COLOR: Record<DealStatus, { bg: string; text: string; dot: string }> = {
  Nouveau: { bg: "#EFF6FF", text: "#2563EB", dot: "#3B82F6" },
  Visite: { bg: "#F0FDF4", text: "#16A34A", dot: "#22C55E" },
  Offre: { bg: "#FFFBEB", text: "#D97706", dot: "#F59E0B" },
  "Sous promesse": { bg: "#FDF4FF", text: "#9333EA", dot: "#A855F7" },
  Travaux: { bg: "#FFF7ED", text: "#EA580C", dot: "#F97316" },
  "En vente": { bg: "#F0F9FF", text: "#0369A1", dot: "#0EA5E9" },
  Vendu: { bg: "#F0FDF4", text: "#15803D", dot: "#16A34A" },
};

type PendingOpportunityDeal = {
  source: "veille-marche";
  canonicalKey: string;
  title: string;
  city: string | null;
  zipCode: string;
  price: number | null;
  surfaceM2: number | null;
  opportunityScore: number;
  opportunityBucket: "faible" | "moyenne" | "forte";
  pricePosition: string;
  priceDropInfo: string;
  diffusionInfo: string;
  createdAt: string;
  sourceUrl?: string | null;
  sourcePortal?: string | null;
};

const fmtEur = (n?: number) =>
  typeof n === "number"
    ? n.toLocaleString("fr-FR", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      })
    : "—";

const nowIso = () => new Date().toISOString();
const makeCanonicalTag = (key: string) => `[veille:${key}]`;

function buildOpportunityNote(p: PendingOpportunityDeal): string {
  const lines = [
    `Source : Veille marché`,
    p.sourcePortal ? `Portail : ${p.sourcePortal}` : null,
    p.sourceUrl ? `Annonce source : ${p.sourceUrl}` : null,
    `Score opportunité : ${p.opportunityScore} (${p.opportunityBucket})`,
    `Position prix : ${p.pricePosition || "—"}`,
    `Évolution prix : ${p.priceDropInfo || "—"}`,
    `Diffusion : ${p.diffusionInfo || "—"}`,
    makeCanonicalTag(p.canonicalKey),
  ].filter(Boolean) as string[];

  return lines.join("\n");
}

function mapOpportunityToDeal(p: PendingOpportunityDeal): Deal {
  const id = `D-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    title: p.title,
    address: "",
    zipCode: p.zipCode,
    city: p.city ?? "—",
    country: "FR",
    prixAchat: p.price ?? undefined,
    surfaceM2: p.surfaceM2 ?? undefined,
    prixReventeCible: undefined,
    note: buildOpportunityNote(p),
    status: "Nouveau",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  } as Deal;
}

async function fetchCityFromZipCode(zipCode: string): Promise<string | null> {
  const cleaned = zipCode.replace(/\s/g, "");
  if (!/^\d{5}$/.test(cleaned)) return null;

  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(
      cleaned,
    )}&type=municipality&limit=1`;

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
  const id = `D-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    title: `Nouveau deal`,
    address: "",
    zipCode: "",
    city: "",
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
        background: "rgba(2,6,23,0.48)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          background: "#fff",
          borderRadius: 24,
          boxShadow: "0 24px 64px rgba(2,6,23,0.22)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "24px 28px 20px",
            borderBottom: "1px solid #F1F5F9",
            display: "flex",
            alignItems: "flex-start",
            gap: 16,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background:
                "linear-gradient(135deg, #1d6fe8 0%, #0ea5e9 55%, #22d3ee 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              boxShadow: "0 4px 16px rgba(33,150,243,0.28)",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M3 21h18M3 7l9-4 9 4M4 21V7m16 14V7M9 21v-4h6v4"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "#0F172A",
                lineHeight: 1.25,
                marginBottom: 3,
              }}
            >
              Éditer le deal
            </div>
            <div style={{ fontSize: 13, color: "#64748B" }}>
              Investisseur › Pipeline
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "1px solid #E2E8F0",
              background: "#F8FAFC",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#64748B",
              flexShrink: 0,
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {children}
        </div>

        <div
          style={{
            padding: "16px 28px 24px",
            borderTop: "1px solid #F1F5F9",
            display: "flex",
            gap: 12,
            justifyContent: "flex-end",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "11px 22px",
              borderRadius: 12,
              border: "1.5px solid #E2E8F0",
              background: "#fff",
              color: "#374151",
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Annuler
          </button>

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "11px 24px",
              borderRadius: 12,
              border: "none",
              background:
                "linear-gradient(135deg, #1d6fe8 0%, #0ea5e9 55%, #22d3ee 100%)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              boxShadow: "0 4px 16px rgba(33,150,243,0.30)",
              transition: "opacity 0.12s, transform 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "0.92";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = "1";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
              <path
                d="M2.5 7.5L5.5 10.5L12.5 4"
                stroke="#fff"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Enregistrer le deal
          </button>
        </div>
      </div>
    </div>
  );
}

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
      <div
        style={{
          fontSize: 11,
          color: "#64748b",
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>

      <input
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        style={{
          width: "100%",
          padding: "11px 14px",
          borderRadius: 12,
          border: "1.5px solid rgba(15,23,42,0.10)",
          background: "#fff",
          fontWeight: 600,
          fontSize: 14,
          color: "#0f172a",
          outline: "none",
          boxSizing: "border-box",
          transition: "border-color 0.15s",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "rgba(33,150,243,0.45)";
          e.currentTarget.style.boxShadow = "0 0 0 3px rgba(33,150,243,0.08)";
        }}
        onBlurCapture={(e) => {
          e.currentTarget.style.borderColor = "rgba(15,23,42,0.10)";
          e.currentTarget.style.boxShadow = "none";
        }}
      />

      {hint && (
        <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>
          {hint}
        </div>
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
      <div
        style={{
          fontSize: 11,
          color: "#64748b",
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "11px 14px",
          borderRadius: 12,
          border: "1.5px solid rgba(15,23,42,0.10)",
          background: "#fff",
          fontWeight: 600,
          fontSize: 14,
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
  const deals: Deal[] = useMemo(
    () => snapshot.deals.map((d) => ({ ...d })),
    [snapshot.deals],
  );
  const activeDealId = snapshot.activeDealId;

  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [cityLookupHint, setCityLookupHint] = useState<string>("");
  const zipFetchRef = useRef(0);
  const handoffConsumedRef = useRef(false);
  const [draftDeal, setDraftDeal] = useState<Deal | null>(null);

  useEffect(() => {
    if (handoffConsumedRef.current) return;
    handoffConsumedRef.current = true;

    const raw = sessionStorage.getItem(PENDING_OPPORTUNITY_STORAGE_KEY);
    if (!raw) return;

    let payload: PendingOpportunityDeal;

    try {
      payload = JSON.parse(raw) as PendingOpportunityDeal;
    } catch {
      sessionStorage.removeItem(PENDING_OPPORTUNITY_STORAGE_KEY);
      return;
    }

    sessionStorage.removeItem(PENDING_OPPORTUNITY_STORAGE_KEY);

    if (!payload?.canonicalKey || payload.source !== "veille-marche") return;

    const tag = makeCanonicalTag(payload.canonicalKey);
    const freshSnapshot = readMarchandSnapshot();
    const existingDeal = freshSnapshot.deals.find((d) => d.note?.includes(tag));

    if (existingDeal) {
      setActiveDeal(existingDeal.id);
      syncDealContext(existingDeal);
    } else {
      const newDeal = mapOpportunityToDeal(payload);
      upsertDeal(newDeal);
      setActiveDeal(newDeal.id);
      syncDealContext(newDeal);
    }
  }, []);

  useEffect(() => {
    if (editingDealId) {
      const deal = deals.find((d) => d.id === editingDealId) ?? null;
      setDraftDeal(deal ? { ...deal } : null);
    } else {
      setDraftDeal(null);
    }

    setCityLookupHint("");
  }, [editingDealId, deals]);

  const updateDraft = useCallback((patch: Partial<Deal>) => {
    setDraftDeal((prev) =>
      prev ? { ...prev, ...patch, updatedAt: nowIso() } : null,
    );
  }, []);

  const flushDraft = useCallback(() => {
    if (!draftDeal) return;

    upsertDeal(draftDeal);

    if (activeDealId === draftDeal.id) {
      syncDealContext(draftDeal);
    }
  }, [draftDeal, activeDealId]);

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

            if (activeDealId === prev.id) {
              syncDealContext(updated);
            }

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

  const updateAndFlush = useCallback(
    (patch: Partial<Deal>) => {
      setDraftDeal((prev) => {
        if (!prev) return prev;

        const updated = { ...prev, ...patch, updatedAt: nowIso() };
        upsertDeal(updated);

        if (activeDealId === updated.id) {
          syncDealContext(updated);
        }

        return updated;
      });
    },
    [activeDealId],
  );

  useEffect(() => {
    if (!activeDealId) return;

    const deal = deals.find((d) => d.id === activeDealId);
    if (deal) syncDealContext(deal);
  }, [activeDealId, deals]);

  const activeDealIdRef = useRef(activeDealId);
  activeDealIdRef.current = activeDealId;

  useEffect(() => {
    const unsub = subscribeDealContext((ctx) => {
      if (ctx.activeDealId && ctx.activeDealId !== activeDealIdRef.current) {
        // lecture seule
      }
    });

    return unsub;
  }, []);

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

  const handleDeleteDeal = (
    e: React.MouseEvent,
    dealId: string,
    dealTitle: string,
  ) => {
    e.stopPropagation();

    if (
      window.confirm(
        `Supprimer ce deal ?\n\n"${dealTitle}"\n\nToutes les données associées seront supprimées.`,
      )
    ) {
      deleteDeal(dealId);

      if (activeDealId === dealId) {
        setBridgeActiveDealId(null);
      }
    }
  };

  const handleCloseDrawer = useCallback(() => {
    if (draftDeal) {
      upsertDeal(draftDeal);

      if (activeDealId === draftDeal.id) {
        syncDealContext(draftDeal);
      }
    }

    setEditingDealId(null);
  }, [draftDeal, activeDealId]);

  const kpis = [
    {
      label: "Deals",
      value: `${totalDeals}`,
      hint: "Total pipeline",
      icon: <Workflow size={20} />,
      color: "#2196F3",
      bg: "#EFF6FF",
    },
    {
      label: "En cours",
      value: `${inProgress}`,
      hint: "Hors vendus",
      icon: <Clock size={20} />,
      color: "#0EA5E9",
      bg: "#F0F9FF",
    },
    {
      label: "Budget achat",
      value: fmtEur(budgetAchat),
      hint: "Snapshot (à brancher)",
      icon: <Euro size={20} />,
      color: "#6366F1",
      bg: "#F5F3FF",
    },
    {
      label: "Marge cible",
      value: "—",
      hint: "À calculer (Rentabilité)",
      icon: <TrendingUp size={20} />,
      color: "#10B981",
      bg: "#F0FDF4",
    },
  ];

  return (
    <>
      <Drawer
        open={Boolean(draftDeal)}
        title={draftDeal ? `Éditer — ${draftDeal.id}` : "Éditer"}
        onClose={handleCloseDrawer}
      >
        {!draftDeal ? (
          <div style={{ color: "#64748b", fontSize: 13 }}>
            Aucun deal sélectionné.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field
                label="Prix d'achat (€)"
                type="number"
                value={draftDeal.prixAchat ?? ""}
                onChange={(v) =>
                  updateDraft({ prixAchat: v === "" ? undefined : Number(v) })
                }
                onBlur={flushDraft}
                placeholder="Ex: 180000"
              />

              <Field
                label="Surface (m²)"
                type="number"
                value={draftDeal.surfaceM2 ?? ""}
                onChange={(v) =>
                  updateDraft({ surfaceM2: v === "" ? undefined : Number(v) })
                }
                onBlur={flushDraft}
                placeholder="Ex: 42"
              />
            </div>

            <Field
              label="Prix revente cible (€)"
              type="number"
              value={draftDeal.prixReventeCible ?? ""}
              onChange={(v) =>
                updateDraft({
                  prixReventeCible: v === "" ? undefined : Number(v),
                })
              }
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

            <div
              style={{
                marginTop: 2,
                padding: "14px 16px",
                borderRadius: 12,
                background: "rgba(33,150,243,0.05)",
                border: "1px solid rgba(33,150,243,0.13)",
                fontSize: 12,
                color: "#64748b",
                lineHeight: 1.65,
              }}
            >
              💡 Ces champs alimentent automatiquement SmartScore, Rentabilité et les
              autres pages Investisseur.
            </div>
          </div>
        )}
      </Drawer>

      <div className="space-y-8">
        <div
          style={{
            background: "linear-gradient(135deg, #1d6fe8 0%, #0ea5e9 55%, #22d3ee 100%)",
            borderRadius: 32,
            padding: "40px 44px",
            marginBottom: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
            boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>
              Investisseur · Pipeline
            </div>
            <div style={{ fontSize: 36, fontWeight: 600, color: "#fff", marginBottom: 10, lineHeight: 1.1, letterSpacing: "-0.025em" }}>
              Pipeline
            </div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", maxWidth: 460, lineHeight: 1.55 }}>
              Créez un dossier par opportunité
            </div>
          </div>

          <button
            type="button"
            onClick={handleCreateDeal}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
              borderRadius: 16,
              border: "none",
              background: "#fff",
              color: "#1a72c4",
              fontWeight: 600,
              fontSize: 14,
              padding: "12px 20px",
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(15,23,42,0.08)",
              transition: "transform 0.12s, box-shadow 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "0 6px 16px rgba(15,23,42,0.12)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 2px 8px rgba(15,23,42,0.08)";
            }}
          >
            <Plus className="h-4 w-4" />
            Nouveau deal
          </button>
        </div>

        <div
          className="relative z-0"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
          }}
        >
          {kpis.map((kpi) => (
            <div
              key={kpi.label}
              style={{
                background: "#fff",
                borderRadius: 20,
                border: "1px solid #E5E7EB",
                padding: "20px 22px",
                boxShadow: "0 2px 12px rgba(15,23,42,0.05)",
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                transition: "box-shadow 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.boxShadow =
                  "0 6px 24px rgba(15,23,42,0.09)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.boxShadow =
                  "0 2px 12px rgba(15,23,42,0.05)";
              }}
            >
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 13,
                  background: kpi.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: kpi.color,
                  flexShrink: 0,
                }}
              >
                {kpi.icon}
              </div>

              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color: "#0F172A",
                    lineHeight: 1.1,
                    letterSpacing: -0.5,
                  }}
                >
                  {kpi.value}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#374151",
                    marginTop: 4,
                  }}
                >
                  {kpi.label}
                </div>
                <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>
                  {kpi.hint}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            border: "1px solid #E5E7EB",
            boxShadow: "0 2px 12px rgba(15,23,42,0.05)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "22px 28px",
              borderBottom: "1px solid #F1F5F9",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>
                Deal flow
              </div>
              <div style={{ fontSize: 13, color: "#64748B", marginTop: 3 }}>
                Sélectionne un deal pour synchroniser toutes les pages.
              </div>
            </div>

            <div
              style={{
                fontSize: 12,
                color: "#94A3B8",
                background: "#F8FAFC",
                border: "1px solid #E2E8F0",
                padding: "4px 10px",
                borderRadius: 8,
                fontWeight: 600,
              }}
            >
              {deals.length} deal{deals.length !== 1 ? "s" : ""}
            </div>
          </div>

          <div style={{ padding: "20px 24px 24px", overflowX: "auto" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(196px, 1fr))`,
                gap: 12,
                minWidth: COLUMNS.length * 208,
              }}
            >
              {COLUMNS.map((col) => {
                const colDeals = deals.filter((d) => d.status === col);
                const statusStyle =
                  STATUS_COLOR[col] ?? {
                    bg: "#F8FAFC",
                    text: "#64748B",
                    dot: "#94A3B8",
                  };

                return (
                  <div
                    key={col}
                    style={{
                      borderRadius: 16,
                      border: "1px solid rgba(15,23,42,0.07)",
                      overflow: "hidden",
                      background: "#FAFBFC",
                      minHeight: 200,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div
                      style={{
                        background:
                          "linear-gradient(135deg, #1d6fe8 0%, #0ea5e9 55%, #22d3ee 100%)",
                        padding: "10px 14px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "rgba(255,255,255,0.92)",
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                        }}
                      >
                        {col}
                      </div>

                      <div
                        style={{
                          minWidth: 22,
                          height: 22,
                          borderRadius: 999,
                          background:
                            colDeals.length > 0
                              ? "rgba(255,255,255,0.28)"
                              : "rgba(255,255,255,0.12)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: 700,
                          color:
                            colDeals.length > 0 ? "#fff" : "rgba(255,255,255,0.55)",
                          paddingInline: 4,
                        }}
                      >
                        {colDeals.length}
                      </div>
                    </div>

                    <div
                      style={{
                        flex: 1,
                        padding: "10px 10px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
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
                              background: isActive ? "rgba(33,150,243,0.07)" : "#fff",
                              border: isActive
                                ? "1.5px solid rgba(33,150,243,0.30)"
                                : "1px solid rgba(15,23,42,0.08)",
                              boxShadow: isActive
                                ? "0 2px 12px rgba(33,150,243,0.12)"
                                : "0 1px 6px rgba(2,6,23,0.04)",
                              padding: "10px 10px 10px 12px",
                              cursor: "pointer",
                              transition: "border-color 0.12s, box-shadow 0.12s",
                            }}
                          >
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={(e) => handleDeleteDeal(e, d.id, d.title)}
                              style={{
                                position: "absolute",
                                top: 7,
                                right: 7,
                                width: 24,
                                height: 24,
                                borderRadius: 999,
                                background: "rgba(239,68,68,0.07)",
                                border: "1px solid rgba(239,68,68,0.15)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                              }}
                              title="Supprimer"
                            >
                              <X size={13} style={{ color: "#DC2626" }} />
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
                                top: 7,
                                right: 37,
                                width: 24,
                                height: 24,
                                borderRadius: 999,
                                background: "rgba(15,23,42,0.05)",
                                border: "1px solid rgba(15,23,42,0.09)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                              }}
                              title="Éditer"
                            >
                              <Pencil size={13} style={{ color: "#475569" }} />
                            </div>

                            <div
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                justifyContent: "space-between",
                                gap: 8,
                                paddingRight: 60,
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 700,
                                  color: "#0F172A",
                                  fontSize: 13,
                                  lineHeight: 1.3,
                                }}
                              >
                                {d.title}
                              </div>
                            </div>

                            {isActive && (
                              <div
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  marginTop: 6,
                                  padding: "3px 8px",
                                  borderRadius: 999,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  background: "rgba(33,150,243,0.10)",
                                  border: "1px solid rgba(33,150,243,0.22)",
                                  color: ACCENT_INV,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                <CheckCircle2 size={12} /> Actif
                              </div>
                            )}

                            <div
                              style={{
                                marginTop: isActive ? 4 : 6,
                                color: "#64748B",
                                fontSize: 12,
                              }}
                            >
                              {d.address ? d.address : d.city ?? "—"}
                            </div>

                            <div
                              style={{
                                marginTop: 8,
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 10,
                                  padding: "2px 7px",
                                  borderRadius: 5,
                                  background: statusStyle.bg,
                                  color: statusStyle.text,
                                  fontWeight: 600,
                                  border: `1px solid ${statusStyle.dot}22`,
                                }}
                              >
                                {d.id}
                              </span>

                              <span style={{ fontSize: 10, color: "#94A3B8" }}>
                                {new Date(d.updatedAt).toLocaleDateString("fr-FR")}
                              </span>
                            </div>
                          </button>
                        );
                      })}

                      {colDeals.length === 0 && (
                        <div
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#D1D5DB",
                            fontSize: 22,
                            padding: "24px 0",
                          }}
                        >
                          —
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}