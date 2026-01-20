import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { logParticulierEvent } from "../../../lib/particulierHistory";

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

  createdAt: string; // ISO
};

const STORAGE_KEY = "mimmoza.particulier.favoris.v1";

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

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(420px, 1.2fr) minmax(320px, 0.8fr)",
  gap: 14,
  alignItems: "start",
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

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 900,
  color: "#334155",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  outline: "none",
  fontSize: 14,
  color: "#0f172a",
  background: "#ffffff",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 90,
  resize: "vertical",
  lineHeight: 1.4,
};

const hintStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  color: "#64748b",
  lineHeight: 1.35,
};

const row: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  alignItems: "center",
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

const btnGhost: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "#ffffff",
  fontWeight: 900,
  cursor: "pointer",
  color: "#0f172a",
};

const tagPill: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 999,
  border: "1px solid rgba(15, 23, 42, 0.10)",
  background: "rgba(248, 250, 252, 0.85)",
  fontSize: 12,
  fontWeight: 800,
  color: "#0f172a",
};

const itemCard: React.CSSProperties = {
  border: "1px solid rgba(15, 23, 42, 0.10)",
  borderRadius: 16,
  background: "#ffffff",
  padding: 14,
  display: "grid",
  gap: 10,
};

const itemTitle: React.CSSProperties = {
  margin: 0,
  fontWeight: 900,
  color: "#0f172a",
  fontSize: 15,
  lineHeight: 1.25,
};

const meta: React.CSSProperties = {
  margin: "6px 0 0",
  color: "#475569",
  fontSize: 13,
  lineHeight: 1.35,
};

function safeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function parseNumberOrNull(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

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

function loadInitial(): Favorite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Favorite[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(items: Favorite[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

function normalizeTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export default function Favoris() {
  const navigate = useNavigate();

  const [items, setItems] = useState<Favorite[]>(() => loadInitial());

  // Form
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [postcode, setPostcode] = useState("");
  const [price, setPrice] = useState<string>("");
  const [surface, setSurface] = useState<string>("");
  const [rooms, setRooms] = useState<string>("");
  const [url, setUrl] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [notes, setNotes] = useState("");

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "price" | "surface">("recent");

  useEffect(() => {
    saveAll(items);
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items.slice();

    if (q) {
      list = list.filter((it) => {
        const blob = [it.title, it.address, it.city, it.postcode, it.tags.join(" "), it.notes]
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      });
    }

    if (sort === "recent") {
      list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    } else if (sort === "price") {
      list.sort((a, b) => (b.priceEur ?? -1) - (a.priceEur ?? -1));
    } else if (sort === "surface") {
      list.sort((a, b) => (b.surfaceM2 ?? -1) - (a.surfaceM2 ?? -1));
    }

    return list;
  }, [items, query, sort]);

  const canCompare = useMemo(() => items.length >= 2, [items.length]);

  function resetForm() {
    setTitle("");
    setAddress("");
    setCity("");
    setPostcode("");
    setPrice("");
    setSurface("");
    setRooms("");
    setUrl("");
    setTagsRaw("");
    setNotes("");
  }

  function addFavorite() {
    const t = title.trim();
    if (!t) {
      alert("Veuillez renseigner au minimum un titre (ex: 'T3 - Centre').");
      return;
    }

    const fav: Favorite = {
      id: safeId(),
      title: t,
      address: address.trim(),
      city: city.trim(),
      postcode: postcode.trim(),

      priceEur: parseNumberOrNull(price),
      surfaceM2: parseNumberOrNull(surface),
      rooms: parseNumberOrNull(rooms),

      url: url.trim(),
      tags: normalizeTags(tagsRaw),
      notes: notes.trim(),

      createdAt: new Date().toISOString(),
    };

    setItems((prev) => [fav, ...prev]);

    logParticulierEvent({
      type: "favori_add",
      title: "Favori ajouté",
      details: `${fav.title} — ${fav.postcode} ${fav.city}`.trim(),
    });

    resetForm();
  }

  function removeFavorite(id: string) {
    const target = items.find((x) => x.id === id);
    const ok = window.confirm("Supprimer ce favori ?");
    if (!ok) return;

    setItems((prev) => prev.filter((x) => x.id !== id));

    logParticulierEvent({
      type: "favori_remove",
      title: "Favori supprimé",
      details: target ? target.title : `ID=${id}`,
    });
  }

  function clearAll() {
    const ok = window.confirm("Supprimer tous les favoris ? Cette action est irréversible.");
    if (!ok) return;
    setItems([]);
    logParticulierEvent({ type: "favori_remove", title: "Favoris supprimés", details: "Purge" });
  }

  return (
    <div style={wrap}>
      <div style={headerRow}>
        <div>
          <h2 style={titleStyle}>Favoris</h2>
          <p style={subtitleStyle}>
            Enregistrez des biens à suivre. Vous pourrez ensuite les comparer, estimer et préparer votre dossier.
          </p>
        </div>

        <div style={row}>
          <button
            type="button"
            style={btnGhost}
            onClick={() => navigate("/particulier/comparateur")}
            disabled={!canCompare}
            title={!canCompare ? "Ajoutez au moins 2 favoris pour comparer." : "Comparer les favoris"}
          >
            Comparer
          </button>

          <Link
            to="/particulier/evaluation"
            style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}
          >
            Estimation
          </Link>

          <button type="button" style={btnGhost} onClick={clearAll} disabled={items.length === 0}>
            Tout supprimer
          </button>
        </div>
      </div>

      <div style={grid}>
        {/* Colonne gauche : liste */}
        <div style={card}>
          <div style={row}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={labelStyle}>Rechercher dans les favoris</label>
              <input
                style={inputStyle}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ex: Nantes, balcon, T3, 44000..."
              />
            </div>

            <div style={{ width: 220 }}>
              <label style={labelStyle}>Trier</label>
              <select style={inputStyle} value={sort} onChange={(e) => setSort(e.target.value as any)}>
                <option value="recent">Récents</option>
                <option value="price">Prix (desc)</option>
                <option value="surface">Surface (desc)</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {filtered.length === 0 ? (
              <div style={{ color: "#475569", lineHeight: 1.5 }}>
                Aucun favori pour l’instant. Ajoute un bien via le formulaire à droite.
              </div>
            ) : (
              filtered.map((it) => (
                <div key={it.id} style={itemCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <p style={itemTitle}>{it.title}</p>
                      <p style={meta}>
                        {[it.address, `${it.postcode} ${it.city}`.trim()].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>

                    <div style={{ textAlign: "right", minWidth: 110 }}>
                      <div style={{ fontWeight: 900, color: "#0f172a" }}>{formatMoney(it.priceEur)}</div>
                      <div style={{ color: "#64748b", fontSize: 13 }}>
                        {formatNum(it.surfaceM2)} m² · {formatNum(it.rooms)} p
                      </div>
                    </div>
                  </div>

                  {it.tags.length > 0 ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {it.tags.map((t) => (
                        <span key={t} style={tagPill}>
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {it.notes ? <p style={meta}>{it.notes}</p> : null}

                  <div style={row}>
                    {it.url ? (
                      <a
                        href={it.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}
                      >
                        Ouvrir l’annonce
                      </a>
                    ) : null}

                    <Link
                      to="/particulier/quartier"
                      style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}
                    >
                      Quartier
                    </Link>

                    <Link
                      to="/particulier/charges"
                      style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}
                    >
                      Charges
                    </Link>

                    <button type="button" style={btnGhost} onClick={() => removeFavorite(it.id)}>
                      Supprimer
                    </button>
                  </div>

                  <div style={{ color: "#94a3b8", fontSize: 12 }}>
                    Ajouté le {new Date(it.createdAt).toLocaleString("fr-FR")}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Colonne droite : ajout */}
        <div style={card}>
          <div style={sectionTitle}>Ajouter un favori</div>

          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={labelStyle}>Titre *</label>
              <input
                style={inputStyle}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: T3 — Centre — balcon"
              />
            </div>

            <div>
              <label style={labelStyle}>Adresse</label>
              <input
                style={inputStyle}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Ex: 12 rue …"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Ville</label>
                <input
                  style={inputStyle}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Ex: Nantes"
                />
              </div>
              <div>
                <label style={labelStyle}>Code postal</label>
                <input
                  style={inputStyle}
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  placeholder="Ex: 44000"
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Prix (€)</label>
                <input
                  style={inputStyle}
                  inputMode="numeric"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Ex: 320000"
                />
              </div>
              <div>
                <label style={labelStyle}>Surface (m²)</label>
                <input
                  style={inputStyle}
                  inputMode="numeric"
                  value={surface}
                  onChange={(e) => setSurface(e.target.value)}
                  placeholder="Ex: 62"
                />
              </div>
              <div>
                <label style={labelStyle}>Pièces</label>
                <input
                  style={inputStyle}
                  inputMode="numeric"
                  value={rooms}
                  onChange={(e) => setRooms(e.target.value)}
                  placeholder="Ex: 3"
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>URL annonce</label>
              <input
                style={inputStyle}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
              />
              <div style={hintStyle}>Optionnel. Permet d’ouvrir la source de l’annonce.</div>
            </div>

            <div>
              <label style={labelStyle}>Tags (séparés par des virgules)</label>
              <input
                style={inputStyle}
                value={tagsRaw}
                onChange={(e) => setTagsRaw(e.target.value)}
                placeholder="Ex: balcon, parking, lumineux"
              />
            </div>

            <div>
              <label style={labelStyle}>Notes</label>
              <textarea
                style={textareaStyle}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex: orientation sud, calme, copro OK, travaux légers..."
              />
            </div>

            <div style={row}>
              <button type="button" style={btnPrimary} onClick={addFavorite}>
                Ajouter
              </button>
              <button type="button" style={btnGhost} onClick={resetForm}>
                Réinitialiser
              </button>
            </div>

            <div style={hintStyle}>
              Les favoris sont sauvegardés localement sur ce navigateur (localStorage). On branchera ensuite Supabase
              pour synchroniser et partager.
            </div>
          </div>
        </div>
      </div>

      {/* Responsive minimal */}
      <style>
        {`
          @media (max-width: 980px) {
            .__fav_grid { grid-template-columns: 1fr !important; }
          }
        `}
      </style>
      <div className="__fav_grid" style={{ display: "none" }} />
    </div>
  );
}

