import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
} from "react";
import {
  Plus,
  Workflow,
  Clock,
  Euro,
  TrendingUp,
  CheckCircle2,
  X,
  Pencil,
} from "lucide-react";
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

// ── Gradient tokens ────────────────────────────────────────────────
const GRAD_INV = "linear-gradient(90deg, #2196f3 0%, #21cbf3 100%)";
const ACCENT_INV = "#1a72c4";

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
      cleaned
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

/* ────────────────────────────────────────────
   Drawer — redessiné v2
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
        background: "rgba(2,6,23,0.45)",
        backdropFilter: "blur(2px)",
        display: "flex",
        justifyContent: "flex-end",
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: 480,
          maxWidth: "92vw",
          height: "100%",
          background: "#f8fafc",
          borderLeft: "1px solid rgba(15,23,42,0.10)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "-8px 0 40px rgba(2,6,23,0.15)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ── Header dégradé ── */}
        <div
          style={{
            background: GRAD_INV,
            padding: "22px 24px 20px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.6)",
              letterSpacing: 1.5,
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            Investisseur › Pipeline
          </div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 800,
              color: "#fff",
              marginBottom: 16,
              lineHeight: 1.25,
              opacity: 0.95,
            }}
          >
            {title}
          </div>

          {/* Bouton Enregistrer — action principale */}
          <button
            type="button"
            onClick={onClose}
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: 10,
              border: "none",
              background: "#fff",
              color: ACCENT_INV,
              fontWeight: 800,
              fontSize: 14,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: "0 2px 16px rgba(0,0,0,0.14)",
              transition: "transform 0.12s ease, box-shadow 0.12s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.18)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 2px 16px rgba(0,0,0,0.14)";
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = "translateY(0) scale(0.98)";
            }}
          >
            {/* Icône check */}
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path
                d="M2.5 7.5L5.5 10.5L12.5 4"
                stroke={ACCENT_INV}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Enregistrer le deal
          </button>
        </div>

        {/* ── Séparateur visuel ── */}
        <div
          style={{
            height: 3,
            background: "linear-gradient(90deg, #2196f3 0%, #21cbf3 60%, transparent 100%)",
            opacity: 0.15,
            flexShrink: 0,
          }}
        />

        {/* ── Corps scrollable ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 24px 40px" }}>
          {children}
        </div>
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
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>
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
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid rgba(15, 23, 42, 0.10)",
          background: "rgba(255,255,255,0.95)",
          fontWeight: 800,
          color: "#0f172a",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      {hint && (
        <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>
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
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>
        {label}
      </div>
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
  const deals: Deal[] = useMemo(
    () => snapshot.deals.map((d) => ({ ...d })),
    [snapshot.deals]
  );
  const activeDealId = snapshot.activeDealId;

  const [editingDealId, setEditingDealId] = useState<string | null>(null);

  const [cityLookupHint, setCityLookupHint] = useState<string>("");
  const zipFetchRef = useRef(0);

  const handoffConsumedRef = useRef(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [draftDeal, setDraftDeal] = useState<Deal | null>(null);

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

  const updateDraft = useCallback((patch: Partial<Deal>) => {
    setDraftDeal((prev) =>
      prev ? { ...prev, ...patch, updatedAt: nowIso() } : null
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

  const updateAndFlush = useCallback(
    (patch: Partial<Deal>) => {
      setDraftDeal((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, ...patch, updatedAt: nowIso() };
        upsertDeal(updated);
        if (activeDealId === updated.id) syncDealContext(updated);
        return updated;
      });
    },
    [activeDealId]
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
      if (
        ctx.activeDealId &&
        ctx.activeDealId !== activeDealIdRef.current
      ) {
        // Lecture seule : on laisse le snapTick re-render gérer la synchro.
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
    dealTitle: string
  ) => {
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

  const handleCloseDrawer = useCallback(() => {
    if (draftDeal) {
      upsertDeal(draftDeal);
      if (activeDealId === draftDeal.id) syncDealContext(draftDeal);
    }
    setEditingDealId(null);
  }, [draftDeal, activeDealId]);

  return (
    <div>
      {/* ── Bannière header dégradé ── */}
      <div
        style={{
          background: GRAD_INV,
          borderRadius: 14,
          padding: "20px 24px",
          marginBottom: 20,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.65)",
              marginBottom: 6,
            }}
          >
            Investisseur › Acquisition
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "white",
              marginBottom: 4,
              lineHeight: 1.2,
            }}
          >
            Pipeline
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
            Deal flow et statuts — snapshot actif partagé entre toutes les pages Marchand.
          </div>
        </div>

        <button
          type="button"
          onClick={handleCreateDeal}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 18px",
            borderRadius: 10,
            border: "none",
            background: "white",
            color: ACCENT_INV,
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
            flexShrink: 0,
            marginTop: 4,
          }}
        >
          <Plus size={16} />
          Nouveau deal
        </button>
      </div>

      {/* ── KPI cards ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <KpiCard
          label="Deals"
          value={`${totalDeals}`}
          hint="Total"
          icon={<Workflow size={18} />}
        />
        <KpiCard
          label="En cours"
          value={`${inProgress}`}
          hint="Hors vendus"
          icon={<Clock size={18} />}
        />
        <KpiCard
          label="Budget achat"
          value={fmtEur(budgetAchat)}
          hint="Snapshot (à brancher)"
          icon={<Euro size={18} />}
        />
        <KpiCard
          label="Marge cible"
          value="—"
          hint="À calculer (Rentabilité)"
          icon={<TrendingUp size={18} />}
        />
      </div>

      {/* ── Deal flow ── */}
      <SectionCard
        title="Deal flow"
        subtitle="Sélectionne un deal pour synchroniser toutes les pages."
      >
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
                  overflow: "hidden",
                  minHeight: 220,
                }}
              >
                {/* En-tête colonne */}
                <div
                  style={{
                    background: GRAD_INV,
                    padding: "10px 12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "white",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {col}
                  </div>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background:
                        colDeals.length > 0
                          ? "rgba(255,255,255,0.3)"
                          : "rgba(255,255,255,0.15)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      color:
                        colDeals.length > 0 ? "white" : "rgba(255,255,255,0.6)",
                    }}
                  >
                    {colDeals.length}
                  </div>
                </div>

                {/* Corps colonne */}
                <div
                  style={{
                    background: "white",
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    minHeight: 170,
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
                          background: isActive
                            ? "rgba(33,150,243,0.07)"
                            : "rgba(255,255,255,0.95)",
                          border: isActive
                            ? "1px solid rgba(33,150,243,0.25)"
                            : "1px solid rgba(15, 23, 42, 0.08)",
                          boxShadow: "0 2px 8px rgba(2,6,23,0.04)",
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

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            paddingRight: 64,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 700,
                              color: "#0f172a",
                              fontSize: 13,
                            }}
                          >
                            {d.title}
                          </div>

                          {isActive && (
                            <div
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "4px 8px",
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 700,
                                background: "rgba(33,150,243,0.10)",
                                border: "1px solid rgba(33,150,243,0.22)",
                                color: ACCENT_INV,
                                whiteSpace: "nowrap",
                              }}
                            >
                              <CheckCircle2 size={14} />
                              Actif
                            </div>
                          )}
                        </div>

                        <div
                          style={{
                            marginTop: 4,
                            color: "#64748b",
                            fontSize: 12,
                          }}
                        >
                          {d.address ? d.address : (d.city ?? "—")}
                        </div>

                        <div
                          style={{
                            marginTop: 6,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 10,
                              padding: "2px 8px",
                              borderRadius: 4,
                              background: "rgba(33,150,243,0.10)",
                              color: ACCENT_INV,
                              fontWeight: 600,
                            }}
                          >
                            {d.id}
                          </span>
                          <span style={{ fontSize: 10, color: "#94a3b8" }}>
                            Maj {new Date(d.updatedAt).toLocaleDateString("fr-FR")}
                          </span>
                        </div>
                      </button>
                    );
                  })}

                  {colDeals.length === 0 && (
                    <div
                      style={{
                        color: "#cbd5e1",
                        fontSize: 18,
                        padding: "16px 2px",
                        textAlign: "center",
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
      </SectionCard>

      {/* ── Drawer édition ── */}
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
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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

            <div
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
            >
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

            <div
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
            >
              <Field
                label="Prix d'achat (€)"
                type="number"
                value={draftDeal.prixAchat ?? ""}
                onChange={(v) =>
                  updateDraft({
                    prixAchat: v === "" ? undefined : Number(v),
                  })
                }
                onBlur={flushDraft}
                placeholder="Ex: 180000"
              />
              <Field
                label="Surface (m²)"
                type="number"
                value={draftDeal.surfaceM2 ?? ""}
                onChange={(v) =>
                  updateDraft({
                    surfaceM2: v === "" ? undefined : Number(v),
                  })
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
                marginTop: 4,
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(33,150,243,0.06)",
                border: "1px solid rgba(33,150,243,0.12)",
                fontSize: 12,
                color: "#64748b",
                lineHeight: 1.6,
              }}
            >
              💡 Ces champs alimentent automatiquement SmartScore, Rentabilité et les autres pages Investisseur.
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}