import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

type Favorite = {
  id: string;
  title: string;
  address: string;
  city: string;
  postcode: string;

  priceEur: number | null;
  surfaceM2: number | null;
  rooms: number | null;

  url: string;
  tags: string[];
  notes: string;

  createdAt: string;
};

const STORAGE_KEY = "mimmoza.particulier.favoris.v1";
const STORAGE_SEL_KEY = "mimmoza.particulier.comparateur.selection.v1";

const wrap: React.CSSProperties = { padding: 8 };

const headerRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  marginBottom: 14,
};

const titleStyle: React.CSSProperties = {
  margin: "4px 0 6px",
  fontSize: 22,
  fontWeight: 900,
  color: "#0f172a",
};

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#475569",
  fontSize: 14,
  lineHeight: 1.45,
};

const card: React.CSSProperties = {
  border: "1px solid rgba(15, 23, 42, 0.10)",
  borderRadius: 16,
  background: "#ffffff",
  padding: 14,
  boxShadow: "0 6px 18px rgba(15, 23, 42, 0.04)",
};

const sectionTitle: React.CSSProperties = {
  margin: "6px 0 10px",
  fontSize: 14,
  fontWeight: 900,
  color: "#0f172a",
};

const row: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" };

const btnGhost: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "#ffffff",
  fontWeight: 900,
  cursor: "pointer",
  color: "#0f172a",
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(99, 102, 241, 0.35)",
  background: "rgba(99, 102, 241, 0.12)",
  fontWeight: 900,
  cursor: "pointer",
  color: "#0f172a",
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(360px, 0.9fr) minmax(520px, 1.1fr)",
  gap: 14,
  alignItems: "start",
};

const itemRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 10,
  padding: "10px 10px",
  borderRadius: 14,
  border: "1px solid rgba(15, 23, 42, 0.10)",
};

const itemTitle: React.CSSProperties = {
  margin: 0,
  fontWeight: 900,
  color: "#0f172a",
  fontSize: 14,
  lineHeight: 1.25,
};

const meta: React.CSSProperties = {
  margin: "6px 0 0",
  color: "#475569",
  fontSize: 13,
  lineHeight: 1.35,
};

const badge: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 999,
  border: "1px solid rgba(15, 23, 42, 0.10)",
  background: "rgba(248, 250, 252, 0.85)",
  fontSize: 12,
  fontWeight: 900,
  color: "#0f172a",
};

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  overflow: "hidden",
  borderRadius: 14,
  border: "1px solid rgba(15, 23, 42, 0.10)",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 10px",
  background: "rgba(248, 250, 252, 0.9)",
  borderBottom: "1px solid rgba(15, 23, 42, 0.10)",
  color: "#334155",
  fontSize: 12,
  fontWeight: 900,
};

const td: React.CSSProperties = {
  padding: "10px 10px",
  borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
  verticalAlign: "top",
  color: "#0f172a",
  fontSize: 13,
};

function formatMoney(n: number | null): string {
  if (n === null) return "—";
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${n} €`;
  }
}

function formatNum(n: number | null): string {
  if (n === null) return "—";
  return `${n}`;
}

function pricePerM2(price: number | null, surface: number | null): number | null {
  if (price === null || surface === null || surface <= 0) return null;
  return price / surface;
}

function formatPricePerM2(v: number | null): string {
  if (v === null) return "—";
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(v) + "/m²";
  } catch {
    return `${Math.round(v)} €/m²`;
  }
}

function loadFavorites(): Favorite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Favorite[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadSelection(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_SEL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSelection(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_SEL_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

export default function Comparateur() {
  const navigate = useNavigate();

  const [favorites, setFavorites] = useState<Favorite[]>(() => loadFavorites());
  const [selectedIds, setSelectedIds] = useState<string[]>(() => loadSelection());

  // Si favoris changent (autre onglet), recharger au mount
  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  useEffect(() => {
    // Nettoie la sélection si des favoris ont été supprimés
    const idsSet = new Set(favorites.map((f) => f.id));
    const cleaned = selectedIds.filter((id) => idsSet.has(id));
    if (cleaned.length !== selectedIds.length) setSelectedIds(cleaned);
    saveSelection(cleaned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favorites]);

  useEffect(() => {
    saveSelection(selectedIds);
  }, [selectedIds]);

  const selected = useMemo(() => {
    const map = new Map(favorites.map((f) => [f.id, f]));
    return selectedIds.map((id) => map.get(id)).filter(Boolean) as Favorite[];
  }, [favorites, selectedIds]);

  const canCompare = selected.length >= 2;

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function selectTop2Recent() {
    const sorted = favorites.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    setSelectedIds(sorted.slice(0, 2).map((x) => x.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  const rows = useMemo(() => {
    const fields: Array<{
      label: string;
      get: (f: Favorite) => React.ReactNode;
    }> = [
      { label: "Prix", get: (f) => formatMoney(f.priceEur) },
      { label: "Surface", get: (f) => (f.surfaceM2 === null ? "—" : `${f.surfaceM2} m²`) },
      { label: "Prix/m²", get: (f) => formatPricePerM2(pricePerM2(f.priceEur, f.surfaceM2)) },
      { label: "Pièces", get: (f) => formatNum(f.rooms) },
      {
        label: "Adresse",
        get: (f) =>
          [f.address, `${f.postcode} ${f.city}`.trim()].filter(Boolean).join(" · ") || "—",
      },
      {
        label: "Tags",
        get: (f) =>
          f.tags.length ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {f.tags.slice(0, 10).map((t) => (
                <span key={t} style={badge}>
                  {t}
                </span>
              ))}
            </div>
          ) : (
            "—"
          ),
      },
      { label: "Notes", get: (f) => (f.notes ? <span>{f.notes}</span> : "—") },
      {
        label: "Lien annonce",
        get: (f) =>
          f.url ? (
            <a href={f.url} target="_blank" rel="noreferrer">
              Ouvrir
            </a>
          ) : (
            "—"
          ),
      },
    ];
    return fields;
  }, []);

  const insights = useMemo(() => {
    if (!canCompare) return null;

    const ppm2 = selected
      .map((f) => ({ id: f.id, v: pricePerM2(f.priceEur, f.surfaceM2) }))
      .filter((x) => x.v !== null) as Array<{ id: string; v: number }>;

    const min = ppm2.length ? Math.min(...ppm2.map((x) => x.v)) : null;
    const max = ppm2.length ? Math.max(...ppm2.map((x) => x.v)) : null;

    return { min, max, withData: ppm2.length };
  }, [canCompare, selected]);

  return (
    <div style={wrap}>
      <div style={headerRow}>
        <div>
          <h2 style={titleStyle}>Comparateur</h2>
          <p style={subtitleStyle}>
            Sélectionnez des favoris et comparez-les sur les critères clés. Objectif : décider vite et objectivement.
          </p>
        </div>

        <div style={row}>
          <button type="button" style={btnGhost} onClick={() => navigate("/particulier/favoris")}>
            Retour Favoris
          </button>
          <Link to="/particulier/evaluation" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
            Estimation
          </Link>
          <Link to="/particulier/quartier" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
            Quartier
          </Link>
        </div>
      </div>

      <div style={grid}>
        {/* Colonne gauche : sélection */}
        <div style={card}>
          <div style={row}>
            <div style={{ fontWeight: 900, color: "#0f172a" }}>
              Sélection ({selected.length})
            </div>
            <div style={{ flex: 1 }} />
            <button type="button" style={btnGhost} onClick={selectTop2Recent} disabled={favorites.length < 2}>
              Sélectionner 2 récents
            </button>
            <button type="button" style={btnGhost} onClick={clearSelection} disabled={selected.length === 0}>
              Vider
            </button>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {favorites.length === 0 ? (
              <div style={{ color: "#475569", lineHeight: 1.5 }}>
                Aucun favori. Ajoute d’abord des biens dans{" "}
                <Link to="/particulier/favoris">Favoris</Link>.
              </div>
            ) : (
              favorites
                .slice()
                .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                .map((f) => {
                  const checked = selectedIds.includes(f.id);
                  const ppm2 = pricePerM2(f.priceEur, f.surfaceM2);
                  return (
                    <div key={f.id} style={itemRow}>
                      <div style={{ flex: 1 }}>
                        <div style={row}>
                          <button
                            type="button"
                            onClick={() => toggle(f.id)}
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 6,
                              border: "1px solid rgba(15, 23, 42, 0.18)",
                              background: checked ? "rgba(99, 102, 241, 0.25)" : "#fff",
                              cursor: "pointer",
                              marginTop: 2,
                            }}
                            aria-label={checked ? "Retirer de la sélection" : "Ajouter à la sélection"}
                            title={checked ? "Retirer" : "Ajouter"}
                          />
                          <div style={{ flex: 1 }}>
                            <p style={itemTitle}>{f.title}</p>
                            <p style={meta}>
                              {formatMoney(f.priceEur)} · {formatNum(f.surfaceM2)} m² · {formatPricePerM2(ppm2)}
                            </p>
                          </div>
                        </div>

                        <p style={meta}>
                          {[f.address, `${f.postcode} ${f.city}`.trim()].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>

                      <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
                        <span style={badge}>{checked ? "Sélectionné" : "—"}</span>
                        <Link
                          to="/particulier/charges"
                          style={{ ...btnGhost, textDecoration: "none", display: "inline-block", padding: "8px 10px" }}
                        >
                          Charges
                        </Link>
                      </div>
                    </div>
                  );
                })
            )}
          </div>

          <div style={{ marginTop: 12, color: "#64748b", fontSize: 12, lineHeight: 1.35 }}>
            Conseil : compare 2–4 biens max à la fois pour rester lisible.
          </div>
        </div>

        {/* Colonne droite : table */}
        <div style={card}>
          <div style={sectionTitle}>Comparaison</div>

          {!canCompare ? (
            <div style={{ color: "#475569", lineHeight: 1.5 }}>
              Sélectionne au moins <strong>2</strong> favoris pour afficher la comparaison.
            </div>
          ) : (
            <>
              {insights ? (
                <div style={{ ...row, marginBottom: 12 }}>
                  <span style={badge}>Biens comparés : {selected.length}</span>
                  <span style={badge}>
                    Prix/m² min : {formatPricePerM2(insights.min)}
                  </span>
                  <span style={badge}>
                    Prix/m² max : {formatPricePerM2(insights.max)}
                  </span>
                  <span style={{ color: "#64748b", fontSize: 12 }}>
                    (données prix/m²: {insights.withData}/{selected.length})
                  </span>
                </div>
              ) : null}

              <div style={{ overflowX: "auto" }}>
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 170 }}>Critère</th>
                      {selected.map((f) => (
                        <th key={f.id} style={th}>
                          <div style={{ fontWeight: 900, color: "#0f172a" }}>{f.title}</div>
                          <div style={{ color: "#64748b", fontSize: 12, fontWeight: 800 }}>
                            {formatMoney(f.priceEur)} · {formatNum(f.surfaceM2)} m²
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {rows.map((r, idx) => (
                      <tr key={r.label}>
                        <td style={{ ...td, fontWeight: 900, color: "#334155", background: "rgba(248, 250, 252, 0.55)" }}>
                          {r.label}
                        </td>
                        {selected.map((f) => (
                          <td key={f.id + "_" + idx} style={td}>
                            {r.get(f)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 12, ...row }}>
                <Link
                  to="/particulier/dossier"
                  style={{ ...btnPrimary, textDecoration: "none", display: "inline-block" }}
                >
                  Préparer dossier banque
                </Link>
                <Link
                  to="/particulier/scenarios"
                  style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}
                >
                  Tester scénarios
                </Link>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Responsive minimal */}
      <style>
        {`
          @media (max-width: 980px) {
            .__cmp_grid { grid-template-columns: 1fr !important; }
          }
        `}
      </style>
      <div className="__cmp_grid" style={{ display: "none" }} />
    </div>
  );
}

