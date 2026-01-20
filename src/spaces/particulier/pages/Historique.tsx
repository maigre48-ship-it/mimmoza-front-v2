import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

type HistoryType =
  | "system"
  | "projet_update"
  | "favori_add"
  | "favori_remove"
  | "scenario_add"
  | "scenario_remove"
  | "dossier_check"
  | "dossier_doc_add"
  | "dossier_doc_remove"
  | "export_copy"
  | "document_add"
  | "document_remove"
  | "note";

type HistoryEvent = {
  id: string;
  type: HistoryType;
  title: string;
  details: string;
  createdAt: string; // ISO
};

const HISTORY_KEY = "mimmoza.particulier.historique.v1";

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
  minHeight: 110,
  resize: "vertical",
  lineHeight: 1.4,
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

const badge: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 999,
  border: "1px solid rgba(15, 23, 42, 0.10)",
  background: "rgba(248, 250, 252, 0.85)",
  fontSize: 12,
  fontWeight: 900,
  color: "#0f172a",
};

const eventCard: React.CSSProperties = {
  border: "1px solid rgba(15, 23, 42, 0.10)",
  borderRadius: 16,
  background: "#ffffff",
  padding: 14,
  display: "grid",
  gap: 8,
};

function safeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function loadHistory(): HistoryEvent[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryEvent[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

/**
 * Helper exportable : tu pourras l’importer plus tard si tu le déplaces dans lib/
 * Pour l’instant, il est ici pour te donner le mécanisme.
 */
export function logParticulierEvent(evt: Omit<HistoryEvent, "id" | "createdAt">) {
  const current = loadHistory();
  const next: HistoryEvent = {
    id: safeId(),
    createdAt: new Date().toISOString(),
    ...evt,
  };
  const merged = [next, ...current].slice(0, 500); // limite sécurité
  saveHistory(merged);
}

function typeLabel(t: HistoryType): string {
  switch (t) {
    case "system":
      return "Système";
    case "projet_update":
      return "Projet";
    case "favori_add":
      return "Favoris";
    case "favori_remove":
      return "Favoris";
    case "scenario_add":
      return "Scénarios";
    case "scenario_remove":
      return "Scénarios";
    case "dossier_check":
      return "Dossier banque";
    case "dossier_doc_add":
      return "Dossier banque";
    case "dossier_doc_remove":
      return "Dossier banque";
    case "export_copy":
      return "Exports";
    case "document_add":
      return "Documents";
    case "document_remove":
      return "Documents";
    case "note":
      return "Note";
  }
}

function typeColor(t: HistoryType): string {
  if (t === "favori_add" || t === "favori_remove") return "rgba(59, 130, 246, 0.10)";
  if (t === "scenario_add" || t === "scenario_remove") return "rgba(99, 102, 241, 0.10)";
  if (t.startsWith("dossier")) return "rgba(245, 158, 11, 0.10)";
  if (t.startsWith("document")) return "rgba(16, 185, 129, 0.10)";
  if (t === "export_copy") return "rgba(139, 92, 246, 0.10)";
  if (t === "note") return "rgba(15, 23, 42, 0.06)";
  if (t === "projet_update") return "rgba(34, 197, 94, 0.10)";
  return "rgba(148, 163, 184, 0.10)";
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    alert("Historique copié.");
  } catch {
    alert("Impossible de copier automatiquement. Sélectionne le texte et copie manuellement.");
  }
}

export default function Historique() {
  const [items, setItems] = useState<HistoryEvent[]>(() => loadHistory());

  // filters
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<HistoryType | "all">("all");

  // manual add
  const [noteTitle, setNoteTitle] = useState("Note");
  const [noteDetails, setNoteDetails] = useState("");

  useEffect(() => {
    saveHistory(items);
  }, [items]);

  // Seed initial event if empty
  useEffect(() => {
    if (items.length > 0) return;
    const seed: HistoryEvent = {
      id: safeId(),
      type: "system",
      title: "Historique initialisé",
      details: "Le journal local est prêt. Les actions futures pourront y être tracées.",
      createdAt: new Date().toISOString(),
    };
    setItems([seed]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = items.slice();

    if (typeFilter !== "all") list = list.filter((e) => e.type === typeFilter);

    if (query) {
      list = list.filter((e) => {
        const blob = [e.type, e.title, e.details].join(" ").toLowerCase();
        return blob.includes(query);
      });
    }

    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return list;
  }, [items, q, typeFilter]);

  const exportText = useMemo(() => {
    const lines: string[] = [];
    lines.push("HISTORIQUE — ESPACE PARTICULIER");
    lines.push("");
    filtered.slice(0, 200).forEach((e) => {
      lines.push(`[${new Date(e.createdAt).toLocaleString("fr-FR")}] ${typeLabel(e.type)} — ${e.title}`);
      if (e.details?.trim()) lines.push(e.details.trim());
      lines.push("");
    });
    if (filtered.length > 200) lines.push(`(+${filtered.length - 200} événements non affichés)`);
    return lines.join("\n");
  }, [filtered]);

  function addNote() {
    const t = noteTitle.trim() || "Note";
    const d = noteDetails.trim();
    if (!d) {
      alert("Merci de renseigner un contenu.");
      return;
    }
    const ev: HistoryEvent = {
      id: safeId(),
      type: "note",
      title: t,
      details: d,
      createdAt: new Date().toISOString(),
    };
    setItems((prev) => [ev, ...prev].slice(0, 500));
    setNoteTitle("Note");
    setNoteDetails("");
  }

  function clearAll() {
    const ok = window.confirm("Supprimer tout l’historique local ? Action irréversible.");
    if (!ok) return;
    setItems([]);
  }

  return (
    <div style={wrap}>
      <div style={headerRow}>
        <div>
          <h2 style={titleStyle}>Historique</h2>
          <p style={subtitleStyle}>
            Journal local des actions (favoris, scénarios, dossier banque, exports). Prêt à être branché sur Supabase.
          </p>
        </div>

        <div style={row}>
          <span style={badge}>Événements: {items.length}</span>
          <Link to="/particulier/favoris" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
            Favoris
          </Link>
          <Link to="/particulier/scenarios" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
            Scénarios
          </Link>
          <button type="button" style={btnGhost} onClick={clearAll} disabled={items.length === 0}>
            Tout supprimer
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        {/* Filters + Export */}
        <div style={card}>
          <div style={sectionTitle}>Recherche & filtres</div>

          <div style={row}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={labelStyle}>Recherche</label>
              <input
                style={inputStyle}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Mot-clé (titre, détail, type)..."
              />
            </div>

            <div style={{ width: 260 }}>
              <label style={labelStyle}>Type</label>
              <select style={inputStyle} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)}>
                <option value="all">Tous</option>
                <option value="system">Système</option>
                <option value="projet_update">Projet</option>
                <option value="favori_add">Favoris — ajout</option>
                <option value="favori_remove">Favoris — suppression</option>
                <option value="scenario_add">Scénarios — ajout</option>
                <option value="scenario_remove">Scénarios — suppression</option>
                <option value="dossier_check">Dossier — checklist</option>
                <option value="dossier_doc_add">Dossier — doc ajouté</option>
                <option value="dossier_doc_remove">Dossier — doc supprimé</option>
                <option value="export_copy">Exports — copié</option>
                <option value="document_add">Documents — ajout</option>
                <option value="document_remove">Documents — suppression</option>
                <option value="note">Notes</option>
              </select>
            </div>

            <div style={{ alignSelf: "end" }}>
              <button type="button" style={btnPrimary} onClick={() => copyText(exportText)}>
                Copier l’historique
              </button>
            </div>
          </div>

          <div style={{ marginTop: 10, color: "#64748b", fontSize: 12, lineHeight: 1.35 }}>
            Astuce : on branchera ces événements depuis chaque page (favoris, scénarios, dossier, exports) via un helper.
          </div>
        </div>

        {/* Add note */}
        <div style={card}>
          <div style={sectionTitle}>Ajouter une note</div>

          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={labelStyle}>Titre</label>
              <input style={inputStyle} value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} />
            </div>

            <div>
              <label style={labelStyle}>Contenu</label>
              <textarea
                style={textareaStyle}
                value={noteDetails}
                onChange={(e) => setNoteDetails(e.target.value)}
                placeholder="Ex: point à demander au conseiller, question sur assurance, etc."
              />
            </div>

            <div style={row}>
              <button type="button" style={btnPrimary} onClick={addNote}>
                Ajouter
              </button>
              <Link to="/particulier/exports" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
                Exports
              </Link>
              <Link to="/particulier/documents" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
                Mes documents
              </Link>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div style={card}>
          <div style={sectionTitle}>Timeline</div>

          <div style={{ display: "grid", gap: 10 }}>
            {filtered.length === 0 ? (
              <div style={{ color: "#475569", lineHeight: 1.5 }}>
                Aucun événement correspondant au filtre.
              </div>
            ) : (
              filtered.slice(0, 120).map((e) => (
                <div key={e.id} style={{ ...eventCard, background: typeColor(e.type) }}>
                  <div style={row}>
                    <span style={badge}>{typeLabel(e.type)}</span>
                    <span style={badge}>{new Date(e.createdAt).toLocaleString("fr-FR")}</span>
                    <div style={{ flex: 1 }} />
                  </div>

                  <div style={{ fontWeight: 900, color: "#0f172a" }}>{e.title}</div>
                  {e.details ? <div style={{ color: "#0f172a", lineHeight: 1.45 }}>{e.details}</div> : null}
                </div>
              ))
            )}
          </div>

          {filtered.length > 120 ? (
            <div style={{ marginTop: 10, color: "#64748b", fontSize: 12 }}>
              Affichage limité à 120 éléments (sur {filtered.length}).
            </div>
          ) : null}
        </div>
      </div>

      {/* Responsive minimal */}
      <style>
        {`
          @media (max-width: 980px) {
            .__hist_grid { grid-template-columns: 1fr !important; }
          }
        `}
      </style>
      <div className="__hist_grid" style={{ display: "none" }} />
    </div>
  );
}

