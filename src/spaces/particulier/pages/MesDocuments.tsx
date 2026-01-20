import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { logParticulierEvent } from "../../../lib/particulierHistory";

type DocKind = "note" | "export" | "lien" | "piece";
type DocCategory = "projet" | "financement" | "identite" | "revenus" | "patrimoine" | "travaux" | "divers";

type LocalDocument = {
  id: string;
  title: string;
  kind: DocKind;
  category: DocCategory;

  description: string;
  externalUrl: string;
  content: string;

  createdAt: string;
  updatedAt: string;
};

const DOCS_KEY = "mimmoza.particulier.documents.v1";

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
  gridTemplateColumns: "minmax(520px, 1.1fr) minmax(360px, 0.9fr)",
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
  minHeight: 120,
  resize: "vertical",
  lineHeight: 1.4,
};

const row: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" };

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

const badge: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 999,
  border: "1px solid rgba(15, 23, 42, 0.10)",
  background: "rgba(248, 250, 252, 0.85)",
  fontSize: 12,
  fontWeight: 900,
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

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 9999,
};

const modal: React.CSSProperties = {
  width: "min(980px, 100%)",
  maxHeight: "85vh",
  overflow: "auto",
  background: "#ffffff",
  borderRadius: 16,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  boxShadow: "0 24px 70px rgba(15, 23, 42, 0.25)",
  padding: 14,
};

const pre: React.CSSProperties = {
  marginTop: 10,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(15, 23, 42, 0.10)",
  background: "rgba(248, 250, 252, 0.85)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: 12,
  lineHeight: 1.45,
  color: "#0f172a",
};

function safeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function loadDocs(): LocalDocument[] {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalDocument[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDocs(items: LocalDocument[]) {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

function kindLabel(k: DocKind) {
  switch (k) {
    case "note":
      return "Note";
    case "export":
      return "Export";
    case "lien":
      return "Lien";
    case "piece":
      return "Pièce";
  }
}

function catLabel(c: DocCategory) {
  switch (c) {
    case "projet":
      return "Projet";
    case "financement":
      return "Financement";
    case "identite":
      return "Identité";
    case "revenus":
      return "Revenus";
    case "patrimoine":
      return "Patrimoine";
    case "travaux":
      return "Travaux";
    case "divers":
      return "Divers";
  }
}

export default function MesDocuments() {
  const [items, setItems] = useState<LocalDocument[]>(() => loadDocs());

  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState<DocKind | "all">("all");
  const [catFilter, setCatFilter] = useState<DocCategory | "all">("all");
  const [sort, setSort] = useState<"recent" | "alpha">("recent");

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<DocKind>("note");
  const [category, setCategory] = useState<DocCategory>("projet");
  const [description, setDescription] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [content, setContent] = useState("");

  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    saveDocs(items);
  }, [items]);

  const openDoc = useMemo(() => items.find((d) => d.id === openId) ?? null, [items, openId]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = items.slice();

    if (kindFilter !== "all") list = list.filter((d) => d.kind === kindFilter);
    if (catFilter !== "all") list = list.filter((d) => d.category === catFilter);

    if (query) {
      list = list.filter((d) => {
        const blob = [d.title, d.description, d.externalUrl, d.content, d.kind, d.category].join(" ").toLowerCase();
        return blob.includes(query);
      });
    }

    if (sort === "recent") list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    else list.sort((a, b) => a.title.localeCompare(b.title, "fr"));

    return list;
  }, [items, q, kindFilter, catFilter, sort]);

  function resetForm() {
    setTitle("");
    setKind("note");
    setCategory("projet");
    setDescription("");
    setExternalUrl("");
    setContent("");
  }

  function addDoc() {
    const t = title.trim();
    if (!t) {
      alert("Titre requis.");
      return;
    }

    const now = new Date().toISOString();
    const doc: LocalDocument = {
      id: safeId(),
      title: t,
      kind,
      category,
      description: description.trim(),
      externalUrl: externalUrl.trim(),
      content: kind === "note" || kind === "export" ? content : "",
      createdAt: now,
      updatedAt: now,
    };

    setItems((prev) => [doc, ...prev]);
    logParticulierEvent({ type: "document_add", title: "Document ajouté", details: `${doc.title} — ${doc.kind} / ${doc.category}` });

    resetForm();
  }

  function removeDoc(id: string) {
    const target = items.find((x) => x.id === id);
    const ok = window.confirm("Supprimer ce document ?");
    if (!ok) return;

    setItems((prev) => prev.filter((x) => x.id !== id));
    if (openId === id) setOpenId(null);

    logParticulierEvent({ type: "document_remove", title: "Document supprimé", details: target ? target.title : `ID=${id}` });
  }

  function seedFromExports() {
    const t = title.trim() || "Export";
    const now = new Date().toISOString();

    const doc: LocalDocument = {
      id: safeId(),
      title: t,
      kind: "export",
      category,
      description: description.trim() || "Importé depuis Exports (copie/colle).",
      externalUrl: "",
      content: content,
      createdAt: now,
      updatedAt: now,
    };

    setItems((prev) => [doc, ...prev]);
    logParticulierEvent({ type: "document_add", title: "Export importé", details: doc.title });

    resetForm();
  }

  function clearAll() {
    const ok = window.confirm("Supprimer tous les documents (local) ? Action irréversible.");
    if (!ok) return;
    setItems([]);
    setOpenId(null);
    logParticulierEvent({ type: "document_remove", title: "Documents supprimés", details: "Purge" });
  }

  return (
    <div style={wrap}>
      <div style={headerRow}>
        <div>
          <h2 style={titleStyle}>Mes documents</h2>
          <p style={subtitleStyle}>Référentiel local de notes, exports, liens et pièces du dossier.</p>
        </div>

        <div style={row}>
          <span style={badge}>Documents: {items.length}</span>
          <Link to="/particulier/exports" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
            Exports
          </Link>
          <Link to="/particulier/dossier" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
            Dossier banque
          </Link>
          <button type="button" style={btnGhost} onClick={clearAll} disabled={items.length === 0}>
            Tout supprimer
          </button>
        </div>
      </div>

      <div style={grid}>
        <div style={card}>
          <div style={sectionTitle}>Bibliothèque</div>

          <div style={row}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={labelStyle}>Recherche</label>
              <input style={inputStyle} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titre, contenu, lien..." />
            </div>

            <div style={{ width: 170 }}>
              <label style={labelStyle}>Type</label>
              <select style={inputStyle} value={kindFilter} onChange={(e) => setKindFilter(e.target.value as any)}>
                <option value="all">Tous</option>
                <option value="note">Note</option>
                <option value="export">Export</option>
                <option value="lien">Lien</option>
                <option value="piece">Pièce</option>
              </select>
            </div>

            <div style={{ width: 170 }}>
              <label style={labelStyle}>Catégorie</label>
              <select style={inputStyle} value={catFilter} onChange={(e) => setCatFilter(e.target.value as any)}>
                <option value="all">Toutes</option>
                <option value="projet">Projet</option>
                <option value="financement">Financement</option>
                <option value="identite">Identité</option>
                <option value="revenus">Revenus</option>
                <option value="patrimoine">Patrimoine</option>
                <option value="travaux">Travaux</option>
                <option value="divers">Divers</option>
              </select>
            </div>

            <div style={{ width: 170 }}>
              <label style={labelStyle}>Tri</label>
              <select style={inputStyle} value={sort} onChange={(e) => setSort(e.target.value as any)}>
                <option value="recent">Récents</option>
                <option value="alpha">A → Z</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {filtered.length === 0 ? (
              <div style={{ color: "#475569", lineHeight: 1.5 }}>Aucun document.</div>
            ) : (
              filtered.map((d) => (
                <div key={d.id} style={itemCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <p style={itemTitle}>{d.title}</p>
                      <p style={meta}>
                        {kindLabel(d.kind)} · {catLabel(d.category)} · MAJ {new Date(d.updatedAt).toLocaleString("fr-FR")}
                      </p>
                      {d.description ? <p style={meta}>{d.description}</p> : null}
                      {d.externalUrl ? (
                        <p style={meta}>
                          <a href={d.externalUrl} target="_blank" rel="noreferrer">
                            Ouvrir le lien
                          </a>
                        </p>
                      ) : null}
                    </div>

                    <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
                      {(d.kind === "note" || d.kind === "export") && d.content ? (
                        <button type="button" style={btnGhost} onClick={() => setOpenId(d.id)}>
                          Voir
                        </button>
                      ) : null}
                      <button type="button" style={btnGhost} onClick={() => removeDoc(d.id)}>
                        Supprimer
                      </button>
                    </div>
                  </div>

                  {(d.kind === "note" || d.kind === "export") && d.content ? (
                    <div style={{ color: "#64748b", fontSize: 12 }}>
                      Aperçu : {d.content.trim().slice(0, 160)}
                      {d.content.trim().length > 160 ? "…" : ""}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

        <div style={card}>
          <div style={sectionTitle}>Ajouter</div>

          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={labelStyle}>Titre *</label>
              <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Type</label>
                <select style={inputStyle} value={kind} onChange={(e) => setKind(e.target.value as any)}>
                  <option value="note">Note</option>
                  <option value="export">Export</option>
                  <option value="lien">Lien</option>
                  <option value="piece">Pièce</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Catégorie</label>
                <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value as any)}>
                  <option value="projet">Projet</option>
                  <option value="financement">Financement</option>
                  <option value="identite">Identité</option>
                  <option value="revenus">Revenus</option>
                  <option value="patrimoine">Patrimoine</option>
                  <option value="travaux">Travaux</option>
                  <option value="divers">Divers</option>
                </select>
              </div>
            </div>

            <div>
              <label style={labelStyle}>Description</label>
              <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div>
              <label style={labelStyle}>Lien externe (optionnel)</label>
              <input style={inputStyle} value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://..." />
            </div>

            {(kind === "note" || kind === "export") ? (
              <div>
                <label style={labelStyle}>Contenu</label>
                <textarea style={textareaStyle} value={content} onChange={(e) => setContent(e.target.value)} />
              </div>
            ) : null}

            <div style={row}>
              <button type="button" style={btnPrimary} onClick={addDoc}>
                Ajouter
              </button>
              <button type="button" style={btnGhost} onClick={seedFromExports} disabled={kind !== "note" && kind !== "export"}>
                Importer comme export
              </button>
              <button type="button" style={btnGhost} onClick={resetForm}>
                Réinitialiser
              </button>
            </div>
          </div>
        </div>
      </div>

      {openDoc ? (
        <div style={overlay} onClick={() => setOpenId(null)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <div style={row}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>{openDoc.title}</div>
              <div style={{ flex: 1 }} />
              <button type="button" style={btnGhost} onClick={() => setOpenId(null)}>
                Fermer
              </button>
            </div>

            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={badge}>{kindLabel(openDoc.kind)}</span>
              <span style={badge}>{catLabel(openDoc.category)}</span>
              <span style={badge}>MAJ {new Date(openDoc.updatedAt).toLocaleString("fr-FR")}</span>
            </div>

            {openDoc.description ? <p style={{ marginTop: 10, color: "#475569" }}>{openDoc.description}</p> : null}

            <pre style={pre}>{openDoc.content || "—"}</pre>

            <div style={{ marginTop: 10, ...row }}>
              <button
                type="button"
                style={btnPrimary}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(openDoc.content || "");
                    alert("Contenu copié.");
                    logParticulierEvent({ type: "export_copy", title: "Contenu document copié", details: "Mes documents" });
                  } catch {
                    alert("Impossible de copier automatiquement.");
                  }
                }}
              >
                Copier
              </button>

              <Link to="/particulier/exports" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
                Aller à Exports
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      <style>
        {`
          @media (max-width: 980px) {
            .__docs_grid { grid-template-columns: 1fr !important; }
          }
        `}
      </style>
      <div className="__docs_grid" style={{ display: "none" }} />
    </div>
  );
}

