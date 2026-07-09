// src/spaces/promoteur/pages/OpportunitesApporteursPage.tsx

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  listDealsOuverts,
  debloquerDeal,
  refuserDeal,
  DeblocageError,
  type PoolDeal,
  type ApporteurDealStatus,
  type ApporteurDealTypeBien,
} from "@/spaces/apporteur/shared/apporteurDeals.store";

const STATUS_LABEL: Record<ApporteurDealStatus, string> = {
  depose:             "Déposé",
  en_etude:           "En étude",
  qualifie:           "Qualifié",
  transmis_promoteur: "Transmis",
  refuse:             "Refusé",
};

const STATUS_COLOR: Record<ApporteurDealStatus, { bg: string; text: string; border: string }> = {
  depose:             { bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE" },
  en_etude:           { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A" },
  qualifie:           { bg: "#F0FDF4", text: "#15803D", border: "#BBF7D0" },
  transmis_promoteur: { bg: "#FFF7ED", text: "#C2410C", border: "#FED7AA" },
  refuse:             { bg: "#F9FAFB", text: "#6B7280", border: "#E5E7EB" },
};

const TYPE_LABEL: Record<ApporteurDealTypeBien, string> = {
  terrain:  "Terrain",
  maison:   "Maison",
  immeuble: "Immeuble",
  autre:    "Autre",
};

/**
 * Titre affiché avant déblocage. Les champs sensibles valent null côté base :
 * il n'y a rien à flouter, seulement à composer avec ce qui reste.
 */
function buildTitle(deal: PoolDeal): string {
  if (deal.estDebloque && deal.adresse) {
    return `${deal.adresse}${deal.commune ? `, ${deal.commune}` : ""}`;
  }
  const type = TYPE_LABEL[deal.typeBien] ?? "Opportunité";
  return deal.departement
    ? `${type} — département ${deal.departement}`
    : `Opportunité off-market — ${type.toLowerCase()}`;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit", month: "short", year: "numeric",
    }).format(new Date(iso));
  } catch { return iso; }
}

function formatPrix(prix: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency", currency: "EUR", maximumFractionDigits: 0,
  }).format(prix);
}

function StatusBadge({ status }: { status: ApporteurDealStatus }) {
  const { bg, text, border } = STATUS_COLOR[status] ?? STATUS_COLOR.depose;
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 9999,
      fontSize: 12, fontWeight: 600, letterSpacing: "0.02em",
      background: bg, color: text, border: `1px solid ${border}`,
    }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function LockedBadge() {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 9px", borderRadius: 9999,
      fontSize: 11, fontWeight: 600, letterSpacing: "0.02em",
      background: "#F5F3FF", color: "#6D28D9", border: "1px solid #DDD6FE",
    }}>
      🔒 Données verrouillées
    </span>
  );
}

function ReservedBadge({ jusquA }: { jusquA?: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 9px", borderRadius: 9999,
      fontSize: 11, fontWeight: 600,
      background: "#FEF2F2", color: "#B91C1C", border: "1px solid #FECACA",
    }}>
      Réservé{jusquA ? ` jusqu'au ${formatDate(jusquA)}` : ""}
    </span>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </p>
      <p style={{ margin: "1px 0 0", fontSize: 14, fontWeight: 600, color: "#1F2937" }}>
        {value}
      </p>
    </div>
  );
}

type ButtonVariant = "primary" | "ghost" | "danger" | "unlock";

const BUTTON_STYLES: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: "#6D28D9", color: "#fff",    border: "1px solid #6D28D9" },
  ghost:   { background: "#F9FAFB", color: "#374151", border: "1px solid #E5E7EB" },
  danger:  { background: "#FEF2F2", color: "#B91C1C", border: "1px solid #FECACA" },
  unlock:  { background: "#6D28D9", color: "#fff",    border: "1px solid #6D28D9" },
};

function ActionButton({ variant, onClick, disabled, children }: {
  variant: ButtonVariant;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...BUTTON_STYLES[variant],
        padding: "6px 14px", borderRadius: 6, fontSize: 13,
        fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1, transition: "opacity 0.15s",
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.opacity = "0.8"; }}
      onMouseLeave={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
    >
      {children}
    </button>
  );
}

function DealCard({ deal, busy, onDebloquer, onOuvrir, onRefuser }: {
  deal: PoolDeal;
  busy: boolean;
  onDebloquer: (d: PoolDeal) => void;
  onOuvrir: (d: PoolDeal) => void;
  onRefuser: (d: PoolDeal) => void;
}) {
  const { estDebloque, reserveParAutre } = deal;

  return (
    <div style={{
      ...cardStyle,
      borderColor: estDebloque ? "#E5E7EB" : "#DDD6FE",
      borderLeftWidth: estDebloque ? 1 : 3,
      borderLeftColor: estDebloque ? "#E5E7EB" : "#7C3AED",
      opacity: reserveParAutre ? 0.6 : 1,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: 0, fontWeight: 700, fontSize: 15, color: "#111827",
            overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
          }}>
            {buildTitle(deal)}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 13, color: "#6B7280" }}>
            {TYPE_LABEL[deal.typeBien]}
            {estDebloque && deal.apporteurName && (
              <> · Apporteur : <span style={{ fontWeight: 500, color: "#374151" }}>{deal.apporteurName}</span></>
            )}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          <StatusBadge status={deal.status} />
          {reserveParAutre
            ? <ReservedBadge jusquA={deal.reserveJusquA} />
            : !estDebloque && <LockedBadge />}
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, marginTop: 12, flexWrap: "wrap" }}>
        {deal.surfaceTerrainM2 !== undefined && (
          <Kpi label="Surface terrain" value={`${deal.surfaceTerrainM2.toLocaleString("fr-FR")} m²`} />
        )}
        {deal.prixVendeur !== undefined && (
          <Kpi label="Prix vendeur" value={formatPrix(deal.prixVendeur)} />
        )}
        {deal.departement && !estDebloque && (
          <Kpi label="Département" value={deal.departement} />
        )}
        <Kpi label="Déposé le" value={formatDate(deal.createdAt)} />
      </div>

      {estDebloque && deal.commentaire && (
        <p style={{
          margin: "10px 0 0", fontSize: 13, color: "#4B5563",
          background: "#F9FAFB", borderRadius: 6, padding: "8px 10px",
          borderLeft: "3px solid #DDD6FE",
        }}>
          {deal.commentaire}
        </p>
      )}

      {!estDebloque && (
        <p style={{
          margin: "10px 0 0", fontSize: 13, color: "#9CA3AF",
          background: "#F9FAFB", borderRadius: 6, padding: "8px 10px",
          borderLeft: "3px solid #DDD6FE", fontStyle: "italic",
        }}>
          🔒 Adresse, commentaire et coordonnées de l'apporteur disponibles après déblocage
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 16 }}>
        {estDebloque ? (
          <ActionButton variant="primary" disabled={busy} onClick={() => onOuvrir(deal)}>
            Qualifier →
          </ActionButton>
        ) : (
          <ActionButton
            variant="unlock"
            disabled={busy || reserveParAutre}
            onClick={() => onDebloquer(deal)}
          >
            {busy ? "Déblocage…" : `🔓 Débloquer — ${deal.coutDeblocage} jetons`}
          </ActionButton>
        )}
        {deal.status !== "refuse" && !reserveParAutre && (
          <ActionButton variant="danger" disabled={busy} onClick={() => onRefuser(deal)}>
            Refuser
          </ActionButton>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={emptyStyle}>
      <span style={{ fontSize: 40, lineHeight: 1 }}>📭</span>
      <p style={{ margin: "12px 0 4px", fontWeight: 700, fontSize: 15, color: "#374151" }}>
        Aucune opportunité
      </p>
      <p style={{ margin: 0, fontSize: 13, color: "#9CA3AF" }}>
        Les biens déposés par les apporteurs apparaîtront ici.
      </p>
    </div>
  );
}

export default function OpportunitesApporteursPage() {
  const navigate = useNavigate();
  const [deals, setDeals] = useState<PoolDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErreur(null);
    try {
      setDeals(await listDealsOuverts());
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const visibleDeals = deals
    .filter((d) => d.status !== "refuse")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const nbDebloques = deals.filter((d) => d.estDebloque).length;

  async function handleDebloquer(deal: PoolDeal) {
    if (busyId) return;
    setBusyId(deal.id);
    setErreur(null);
    try {
      const res = await debloquerDeal(deal.id);
      await refresh();
      if (!res.dejaDebloque && res.soldeRestant !== undefined) {
        setErreur(null);
      }
      navigate(`/promoteur/opportunites/nouvelle?dealId=${deal.id}`);
    } catch (err) {
      // DeblocageError porte un code métier exploitable (crédits, réservation…)
      setErreur(err instanceof DeblocageError
        ? err.message
        : err instanceof Error ? err.message : "Le déblocage a échoué");
      setBusyId(null);
    }
  }

  function handleOuvrir(deal: PoolDeal) {
    navigate(`/promoteur/opportunites/nouvelle?dealId=${deal.id}`);
  }

  async function handleRefuser(deal: PoolDeal) {
    if (busyId) return;
    setBusyId(deal.id);
    try {
      await refuserDeal(deal.id);
      await refresh();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Impossible de refuser ce deal");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Bandeau violet ── */}
      <div className="overflow-hidden rounded-[32px] bg-gradient-to-r from-[#6f5bd6] via-[#8d78df] to-[#b39ddb] px-8 py-8 text-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/90">
          Promoteur · Opportunités
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-4xl font-semibold tracking-tight">
            Deals apporteurs
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
              {visibleDeals.length} opportunité{visibleDeals.length > 1 ? "s" : ""}
            </span>
            {nbDebloques > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                {nbDebloques} débloquée{nbDebloques > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-sm text-slate-200">
          Biens off-market déposés par les apporteurs d'affaires
        </p>
      </div>

      {/* ── Contenu ── */}
      <div style={{ maxWidth: 860, margin: "0 auto", fontFamily: "inherit" }}>
        {erreur && (
          <div style={{
            marginBottom: 16, padding: "10px 14px", borderRadius: 8,
            background: "#FEF2F2", color: "#B91C1C", border: "1px solid #FECACA",
            fontSize: 13,
          }}>
            {erreur}
          </div>
        )}

        {loading ? (
          <div style={emptyStyle}>
            <p style={{ margin: 0, fontSize: 13, color: "#9CA3AF" }}>Chargement des opportunités…</p>
          </div>
        ) : visibleDeals.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {visibleDeals.map((deal) => (
              <DealCard
                key={deal.id}
                deal={deal}
                busy={busyId === deal.id}
                onDebloquer={handleDebloquer}
                onOuvrir={handleOuvrir}
                onRefuser={handleRefuser}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 10,
  padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
};
const emptyStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  padding: "64px 24px", background: "#F9FAFB", border: "1px dashed #E5E7EB",
  borderRadius: 12, textAlign: "center",
};