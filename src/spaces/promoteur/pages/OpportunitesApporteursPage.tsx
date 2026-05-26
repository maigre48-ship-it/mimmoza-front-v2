// src/spaces/promoteur/pages/OpportunitesApporteursPage.tsx

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

import {
  listApporteurDeals,
  updateApporteurDeal,
  type ApporteurDeal,
  type ApporteurDealStatus,
} from "@/spaces/apporteur/shared/apporteurDeals.store";

// ---------------------------------------------------------------------------
// Paywall flag — passer à true pour débloquer toutes les opportunités
// ---------------------------------------------------------------------------

const isUnlocked = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const TYPE_LABEL: Record<ApporteurDeal["typeBien"], string> = {
  terrain:  "Terrain",
  maison:   "Maison",
  immeuble: "Immeuble",
  autre:    "Autre",
};

/** Masque le code postal : "92210" → "92***" */
function maskPostalCode(cp: string): string {
  return cp ? cp.slice(0, 2) + "***" : "";
}

/**
 * Extrait le code postal depuis une adresse ou une commune.
 * Cherche un bloc de 5 chiffres dans la chaîne.
 * Si absent, retourne "".
 */
function extractPostalCode(text: string): string {
  const match = text.match(/\b(\d{5})\b/);
  return match ? match[1] : "";
}

/**
 * Construit le titre masqué d'un deal.
 * Priorité : code postal dans commune > code postal dans adresse > département seul.
 */
function buildMaskedTitle(deal: ApporteurDeal): string {
  const typeLabel = TYPE_LABEL[deal.typeBien] ?? "Opportunité";

  const cpSource = deal.commune ?? deal.adresse ?? "";
  const cp = extractPostalCode(cpSource);

  if (cp) {
    return `${typeLabel} — ${maskPostalCode(cp)}`;
  }

  // Fallback : "Opportunité off-market"
  return `Opportunité off-market — ${typeLabel.toLowerCase()}`;
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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

function ActionButton({ variant, onClick, children }: {
  variant: ButtonVariant;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        ...BUTTON_STYLES[variant],
        padding: "6px 14px", borderRadius: 6, fontSize: 13,
        fontWeight: 600, cursor: "pointer", transition: "opacity 0.15s",
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "0.8")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "1")}
    >
      {children}
    </button>
  );
}

function DealCard({ deal, onQualifier, onRefuser }: {
  deal: ApporteurDeal;
  onQualifier: (d: ApporteurDeal) => void;
  onRefuser: (d: ApporteurDeal) => void;
}) {
  // Titre : masqué ou complet selon le flag
  const titleText = isUnlocked
    ? `${deal.adresse}${deal.commune ? `, ${deal.commune}` : ""}`
    : buildMaskedTitle(deal);

  // Sous-titre apporteur : masqué ou affiché
  const apporteurNode = deal.apporteurName ? (
    isUnlocked
      ? <> · Apporteur : <span style={{ fontWeight: 500, color: "#374151" }}>{deal.apporteurName}</span></>
      : <> · Apporteur : <span style={{ fontWeight: 500, color: "#9CA3AF" }}>masqué</span></>
  ) : null;

  return (
    <div style={{
      ...cardStyle,
      // Bordure violette subtile quand verrouillé pour renforcer le signal paywall
      borderColor: isUnlocked ? "#E5E7EB" : "#DDD6FE",
      borderLeftWidth: isUnlocked ? 1 : 3,
      borderLeftColor: isUnlocked ? "#E5E7EB" : "#7C3AED",
    }}>
      {/* ── En-tête ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Titre avec blur si verrouillé */}
          <p style={{
            margin: 0, fontWeight: 700, fontSize: 15, color: "#111827",
            ...(isUnlocked ? {} : {
              filter: "blur(4px)",
              userSelect: "none",
              pointerEvents: "none",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }),
          }}>
            {titleText}
          </p>

          <p style={{ margin: "2px 0 0", fontSize: 13, color: "#6B7280" }}>
            {TYPE_LABEL[deal.typeBien]}
            {apporteurNode}
          </p>
        </div>

        {/* Badges droite */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          <StatusBadge status={deal.status} />
          {!isUnlocked && <LockedBadge />}
        </div>
      </div>

      {/* ── KPIs — surface, prix, date (toujours visibles) ── */}
      <div style={{ display: "flex", gap: 24, marginTop: 12, flexWrap: "wrap" }}>
        {deal.surfaceTerrainM2 !== undefined && (
          <Kpi label="Surface terrain" value={`${deal.surfaceTerrainM2.toLocaleString("fr-FR")} m²`} />
        )}
        {deal.prixVendeur !== undefined && (
          <Kpi label="Prix vendeur" value={formatPrix(deal.prixVendeur)} />
        )}
        <Kpi label="Déposé le" value={formatDate(deal.createdAt)} />
      </div>

      {/* ── Commentaire — masqué si verrouillé ── */}
      {deal.commentaire && (
        isUnlocked ? (
          <p style={{
            margin: "10px 0 0", fontSize: 13, color: "#4B5563",
            background: "#F9FAFB", borderRadius: 6, padding: "8px 10px",
            borderLeft: "3px solid #DDD6FE",
          }}>
            {deal.commentaire}
          </p>
        ) : (
          <p style={{
            margin: "10px 0 0", fontSize: 13, color: "#9CA3AF",
            background: "#F9FAFB", borderRadius: 6, padding: "8px 10px",
            borderLeft: "3px solid #DDD6FE",
            fontStyle: "italic",
          }}>
            🔒 Commentaire disponible après déblocage
          </p>
        )
      )}

      {/* ── Actions ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <ActionButton
          variant={isUnlocked ? "primary" : "unlock"}
          onClick={() => onQualifier(deal)}
        >
          {isUnlocked ? "Qualifier →" : "🔓 Débloquer"}
        </ActionButton>
        {deal.status !== "refuse" && (
          <ActionButton variant="danger" onClick={() => onRefuser(deal)}>
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
        Les deals transmis par les apporteurs apparaîtront ici.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page principale
// ---------------------------------------------------------------------------

export default function OpportunitesApporteursPage() {
  const navigate = useNavigate();
  const [deals, setDeals] = useState<ApporteurDeal[]>(() => listApporteurDeals());
  const refresh = useCallback(() => setDeals(listApporteurDeals()), []);

  const visibleDeals = deals
    .filter((d) => d.status !== "refuse")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  function handleQualifier(deal: ApporteurDeal) {
    updateApporteurDeal(deal.id, { status: "en_etude" });
    refresh();
    navigate(`/promoteur/opportunites/nouvelle?dealId=${deal.id}`);
  }

  function handleRefuser(deal: ApporteurDeal) {
    updateApporteurDeal(deal.id, { status: "refuse" });
    refresh();
  }

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#111827" }}>
            Opportunités apporteurs
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6B7280" }}>
            Deals reçus en attente de qualification
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div style={counterBadgeStyle}>
            <span style={{ fontSize: 20, fontWeight: 800, color: "#6D28D9" }}>
              {visibleDeals.length}
            </span>
            <span style={{ fontSize: 12, color: "#9CA3AF", marginTop: 1 }}>
              {visibleDeals.length === 1 ? "opportunité" : "opportunités"}
            </span>
          </div>
          {!isUnlocked && (
            <span style={{
              fontSize: 11, color: "#7C3AED", fontWeight: 600,
              background: "#F5F3FF", padding: "2px 8px", borderRadius: 6,
              border: "1px solid #DDD6FE",
            }}>
              🔒 Mode aperçu
            </span>
          )}
        </div>
      </div>

      <hr style={{ border: "none", borderTop: "1px solid #F3F4F6", margin: "0 0 24px" }} />

      {visibleDeals.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {visibleDeals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              onQualifier={handleQualifier}
              onRefuser={handleRefuser}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pageStyle: React.CSSProperties = {
  padding: "32px 28px", maxWidth: 860, margin: "0 auto", fontFamily: "inherit",
};
const headerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20,
};
const counterBadgeStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center",
  background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10,
  padding: "8px 18px", minWidth: 72,
};
const cardStyle: React.CSSProperties = {
  background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 10,
  padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
};
const emptyStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  padding: "64px 24px", background: "#F9FAFB", border: "1px dashed #E5E7EB",
  borderRadius: 12, textAlign: "center",
};