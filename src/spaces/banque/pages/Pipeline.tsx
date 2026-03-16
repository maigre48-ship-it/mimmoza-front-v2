// FILE: src/spaces/banque/pages/Pipeline.tsx

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  readBanqueSnapshot,
  upsertDossier,
  removeDossier,
} from "../store/banqueSnapshot.store";

// ── Gradient tokens Financeur ──────────────────────────────────────
const GRAD_FIN = "linear-gradient(90deg, #26a69a 0%, #80cbc4 100%)";
const ACCENT_FIN = "#1a7a50";

function makeId() {
  return `DOSS-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}-${Date.now()
    .toString()
    .slice(-4)}`;
}

function fmtEur(n: number) {
  try {
    return (n || 0).toLocaleString("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    });
  } catch {
    return `${n || 0} €`;
  }
}

const LS_ACTIVE_DOSSIER_ID = "mimmoza.banque.active_dossier_id";

function setActiveDossierId(id: string | null) {
  try {
    if (!id) localStorage.removeItem(LS_ACTIVE_DOSSIER_ID);
    else localStorage.setItem(LS_ACTIVE_DOSSIER_ID, id);
  } catch {
    // ignore
  }
}

export default function Pipeline() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const snap = readBanqueSnapshot();
  const active = (snap as any)?.dossier ?? null;

  const dossiers = useMemo(() => {
    const list = active ? [active] : [];
    const q = query.trim().toLowerCase();
    if (!q) return list;

    return list.filter((d: any) => {
      const a = (d.nom || "").toLowerCase();
      const b = (d.sponsor || "").toLowerCase();
      return a.includes(q) || b.includes(q);
    });
  }, [active, query]);

  const goToDocuments = (id: string) => {
    setActiveDossierId(id);
    navigate(`/banque/documents/${id}`);
  };

  const goToRisque = (id: string) => {
    setActiveDossierId(id);
    navigate(`/banque/analyse/${id}`);
  };

  const createNewDossier = () => {
    const nom = (window.prompt("Nom du dossier ?", "Nouveau dossier") || "").trim();
    if (!nom) return;

    const sponsor = (window.prompt("Sponsor (promoteur / client) ?", "") || "").trim();

    const typeRaw = (
      window.prompt('Type de projet ? "promotion" / "marchand" / "baseline"', "baseline") || ""
    )
      .trim()
      .toLowerCase();

    const projectType =
      typeRaw === "promotion" || typeRaw === "marchand" || typeRaw === "baseline"
        ? typeRaw
        : "baseline";

    const montantRaw = (window.prompt("Montant demandé (€) ?", "0") || "").replace(/\s/g, "");
    const montant = Number(montantRaw) || 0;

    const id = makeId();
    const ts = new Date().toISOString();

    upsertDossier({
      id,
      nom,
      sponsor,
      montant,
      projectType,
      statut: "BROUILLON",
      dates: {
        creation: ts,
        derniereMaj: ts,
      },
    } as any);

    setActiveDossierId(id);
    goToDocuments(id);
  };

  const deleteDossier = (id: string) => {
    const d = dossiers.find((x: any) => x?.id === id) ?? active;
    const label = d?.nom ? `"${d.nom}"` : id;

    const ok = window.confirm(`Supprimer le dossier ${label} ?\n\nCette action est irréversible.`);
    if (!ok) return;

    const isActive = active?.id === id;
    removeDossier(id);

    if (isActive) {
      setActiveDossierId(null);
      navigate(`/banque/pipeline`);
    }
  };

  // ── Initiales avatar ──
  function getInitials(nom: string): string {
    return nom
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
  }

  return (
    <div>
      {/* ── Bannière header dégradé ── */}
      <div
        style={{
          background: GRAD_FIN,
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
            Financeur › Pipeline
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
            Dossiers (Pipeline)
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
            Créez un dossier puis ouvrez Documents / Garanties / Analyse / Comité avec le même ID.
          </div>
        </div>

        <button
          type="button"
          onClick={createNewDossier}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 18px",
            borderRadius: 10,
            border: "none",
            background: "white",
            color: ACCENT_FIN,
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
            flexShrink: 0,
            marginTop: 4,
          }}
        >
          + Nouveau dossier
        </button>
      </div>

      {/* ── Barre de recherche ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher (nom ou sponsor)…"
          style={{
            flex: 1,
            maxWidth: 400,
            padding: "9px 14px",
            borderRadius: 10,
            border: "1px solid #c0e8d4",
            outline: "none",
            fontSize: 13,
            color: "#0a3d28",
            background: "white",
          }}
        />
        <div style={{ fontSize: 13, color: "#5a9a7a", whiteSpace: "nowrap" }}>
          {dossiers.length} dossier(s)
        </div>
      </div>

      {/* ── Empty state ── */}
      {dossiers.length === 0 && (
        <div
          style={{
            border: "1px dashed #9ed4bc",
            borderRadius: 14,
            padding: 40,
            textAlign: "center",
            background: "#f8fdfb",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: "#0a3d28", marginBottom: 8 }}>
            Aucun dossier
          </div>
          <div style={{ fontSize: 13, color: "#5a9a7a", marginBottom: 20 }}>
            Créez votre premier dossier pour démarrer.
          </div>
          <button
            type="button"
            onClick={createNewDossier}
            style={{
              padding: "9px 18px",
              borderRadius: 10,
              border: "none",
              background: GRAD_FIN,
              color: "white",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Créer mon premier dossier
          </button>
        </div>
      )}

      {/* ── Liste dossiers ── */}
      {dossiers.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 14,
          }}
        >
          {dossiers.map((d: any) => (
            <div
              key={d.id}
              style={{
                border: "1px solid #c0e8d4",
                borderRadius: 14,
                background: "white",
                overflow: "hidden",
              }}
            >
              {/* Barre dégradée top */}
              <div style={{ height: 4, background: GRAD_FIN }} />

              {/* Corps */}
              <div style={{ padding: "16px 18px" }}>
                {/* En-tête dossier */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 14,
                  }}
                >
                  {/* Avatar initiales */}
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: GRAD_FIN,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "white",
                      flexShrink: 0,
                      textAlign: "center",
                      lineHeight: 1.3,
                    }}
                  >
                    {getInitials(d.nom || "DO")}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: "#0a3d28",
                        marginBottom: 3,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {d.nom || "(Sans nom)"}
                    </div>
                    <div style={{ fontSize: 12, color: "#5a9a7a" }}>
                      {d.sponsor || "Sponsor non renseigné"}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {/* Badge type */}
                    <span
                      style={{
                        fontSize: 10,
                        padding: "3px 8px",
                        borderRadius: 5,
                        background: "rgba(38,166,154,0.10)",
                        color: ACCENT_FIN,
                        fontWeight: 600,
                      }}
                    >
                      {d.projectType || "baseline"}
                    </span>

                    {/* Bouton supprimer */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteDossier(d.id);
                      }}
                      style={{
                        fontSize: 11,
                        padding: "3px 8px",
                        borderRadius: 6,
                        border: "1px solid #fecaca",
                        background: "#fef2f2",
                        color: "#dc2626",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                      title="Supprimer le dossier"
                    >
                      Supprimer
                    </button>
                  </div>
                </div>

                {/* Stats */}
                <div
                  style={{
                    display: "flex",
                    gap: 28,
                    marginBottom: 14,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: ACCENT_FIN }}>
                      {fmtEur(d.montant || 0)}
                    </div>
                    <div style={{ fontSize: 11, color: "#5a9a7a", marginTop: 2 }}>
                      Montant
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#0a3d28" }}>
                      {d.dates?.derniereMaj
                        ? new Date(d.dates.derniereMaj).toLocaleDateString("fr-FR")
                        : "—"}
                    </div>
                    <div style={{ fontSize: 11, color: "#5a9a7a", marginTop: 2 }}>
                      Dernière MAJ
                    </div>
                  </div>
                </div>

                {/* ID */}
                <div style={{ fontSize: 11, color: "#9ed4bc", marginBottom: 14 }}>
                  ID: <span style={{ fontFamily: "monospace" }}>{d.id}</span>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => goToDocuments(d.id)}
                    style={{
                      flex: "1 1 auto",
                      padding: "8px 14px",
                      borderRadius: 9,
                      border: "none",
                      background: GRAD_FIN,
                      color: "white",
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Ouvrir Documents
                  </button>
                  <button
                    type="button"
                    onClick={() => goToRisque(d.id)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 9,
                      border: "1px solid #9ed4bc",
                      background: "white",
                      color: ACCENT_FIN,
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Ouvrir Risque
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}