import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

type DocCategory =
  | "identite"
  | "revenus"
  | "patrimoine"
  | "projet"
  | "financement"
  | "divers";

type ChecklistItem = {
  id: string;
  category: DocCategory;
  label: string;
  required: boolean;
  done: boolean;
  notes?: string;
};

type LocalDoc = {
  id: string;
  category: DocCategory;
  name: string;
  description: string;
  addedAt: string; // ISO
};

type ProjectState = {
  goal?: string;
  city?: string;
  postcode?: string;
  budgetTotal?: number | null;
  budgetNotaire?: number | null;
  budgetTravaux?: number | null;
  apport?: number | null;
  loanDurationYears?: number | null;
  loanRatePct?: number | null;
};

type Scenario = {
  id: string;
  name: string;
  purchaseTarget: number | null;
  apport: number | null;
  durationYears: number | null;
  ratePct: number | null;
  insurancePct: number | null;
  notes: string;
  createdAt: string;
};

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

const CHECK_KEY = "mimmoza.particulier.dossier_banque.checklist.v1";
const DOCS_KEY = "mimmoza.particulier.dossier_banque.docs.v1";
const NOTES_KEY = "mimmoza.particulier.dossier_banque.notes.v1";

const PROJECT_KEY = "mimmoza.particulier.mon_projet.v1";
const SCENARIOS_KEY = "mimmoza.particulier.scenarios.v1";
const FAVORIS_KEY = "mimmoza.particulier.favoris.v1";

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
  gridTemplateColumns: "minmax(520px, 1.15fr) minmax(360px, 0.85fr)",
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

const itemRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 10,
  padding: "10px 10px",
  borderRadius: 14,
  border: "1px solid rgba(15, 23, 42, 0.10)",
};

const small: React.CSSProperties = { fontSize: 12, color: "#64748b", lineHeight: 1.35 };

function safeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
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

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJson<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function buildDefaultChecklist(): ChecklistItem[] {
  const mk = (category: DocCategory, label: string, required: boolean): ChecklistItem => ({
    id: safeId(),
    category,
    label,
    required,
    done: false,
  });

  return [
    // Identité
    mk("identite", "Pièce d’identité (CNI/passeport)", true),
    mk("identite", "Justificatif de domicile (< 3 mois)", true),
    mk("identite", "Livret de famille / situation familiale (si pertinent)", false),

    // Revenus
    mk("revenus", "3 derniers bulletins de salaire", true),
    mk("revenus", "Contrat de travail / attestation employeur", false),
    mk("revenus", "2 derniers avis d’imposition", true),
    mk("revenus", "Relevés de compte (3 mois)", true),

    // Patrimoine
    mk("patrimoine", "Épargne / relevés (PEL, assurance-vie, livrets)", false),
    mk("patrimoine", "Crédits en cours (tableau d’amortissement)", true),
    mk("patrimoine", "Biens immobiliers détenus (si applicable)", false),

    // Projet
    mk("projet", "Annonce / descriptif du bien", true),
    mk("projet", "Estimation / éléments marché (si disponible)", false),
    mk("projet", "Devis travaux (si applicable)", false),
    mk("projet", "Compromis / promesse de vente (si signé)", false),

    // Financement
    mk("financement", "Simulation de prêt (scénarios)", true),
    mk("financement", "Apport (preuve de fonds)", true),
    mk("financement", "Assurance emprunteur (si déjà étudiée)", false),

    // Divers
    mk("divers", "Notes / éléments à signaler (mobilité, période d’essai, etc.)", false),
  ];
}

function catLabel(c: DocCategory): string {
  switch (c) {
    case "identite":
      return "Identité";
    case "revenus":
      return "Revenus";
    case "patrimoine":
      return "Patrimoine";
    case "projet":
      return "Projet";
    case "financement":
      return "Financement";
    case "divers":
      return "Divers";
  }
}

export default function DossierBanque() {
  const [checklist, setChecklist] = useState<ChecklistItem[]>(
    () => loadJson<ChecklistItem[]>(CHECK_KEY, buildDefaultChecklist())
  );
  const [docs, setDocs] = useState<LocalDoc[]>(() => loadJson<LocalDoc[]>(DOCS_KEY, []));
  const [notes, setNotes] = useState<string>(() => loadJson<string>(NOTES_KEY, ""));

  // Form doc
  const [docCategory, setDocCategory] = useState<DocCategory>("projet");
  const [docName, setDocName] = useState("");
  const [docDesc, setDocDesc] = useState("");

  const project = useMemo(() => loadJson<ProjectState>(PROJECT_KEY, {}), []);
  const scenarios = useMemo(() => loadJson<Scenario[]>(SCENARIOS_KEY, []), []);
  const favoris = useMemo(() => loadJson<Favorite[]>(FAVORIS_KEY, []), []);

  useEffect(() => saveJson(CHECK_KEY, checklist), [checklist]);
  useEffect(() => saveJson(DOCS_KEY, docs), [docs]);
  useEffect(() => saveJson(NOTES_KEY, notes), [notes]);

  const progress = useMemo(() => {
    const required = checklist.filter((x) => x.required);
    const reqDone = required.filter((x) => x.done).length;
    const reqTotal = required.length;

    const allDone = checklist.filter((x) => x.done).length;
    const allTotal = checklist.length;

    const pctReq = reqTotal === 0 ? 100 : Math.round((reqDone / reqTotal) * 100);
    const pctAll = allTotal === 0 ? 100 : Math.round((allDone / allTotal) * 100);

    const missingReq = required.filter((x) => !x.done).map((x) => x.label);

    return { reqDone, reqTotal, pctReq, allDone, allTotal, pctAll, missingReq };
  }, [checklist]);

  const groupedChecklist = useMemo(() => {
    const by: Record<DocCategory, ChecklistItem[]> = {
      identite: [],
      revenus: [],
      patrimoine: [],
      projet: [],
      financement: [],
      divers: [],
    };
    checklist.forEach((it) => by[it.category].push(it));
    return by;
  }, [checklist]);

  function toggleItem(id: string) {
    setChecklist((prev) =>
      prev.map((x) => (x.id === id ? { ...x, done: !x.done } : x))
    );
  }

  function resetAll() {
    const ok = window.confirm("Réinitialiser le dossier banque (checklist + docs + notes) ?");
    if (!ok) return;
    setChecklist(buildDefaultChecklist());
    setDocs([]);
    setNotes("");
  }

  function addDoc() {
    const n = docName.trim();
    if (!n) {
      alert("Nom du document requis.");
      return;
    }
    const d: LocalDoc = {
      id: safeId(),
      category: docCategory,
      name: n,
      description: docDesc.trim(),
      addedAt: new Date().toISOString(),
    };
    setDocs((prev) => [d, ...prev]);
    setDocName("");
    setDocDesc("");
  }

  function removeDoc(id: string) {
    const ok = window.confirm("Supprimer ce document (liste) ?");
    if (!ok) return;
    setDocs((prev) => prev.filter((x) => x.id !== id));
  }

  const dossierSummary = useMemo(() => {
    const lines: string[] = [];
    lines.push("DOSSIER BANQUE — RÉSUMÉ");
    lines.push("");
    lines.push(`Progression requis: ${progress.reqDone}/${progress.reqTotal} (${progress.pctReq}%)`);
    lines.push(`Progression globale: ${progress.allDone}/${progress.allTotal} (${progress.pctAll}%)`);
    lines.push("");

    lines.push("PROJET (Mon projet)");
    lines.push(`- Localisation: ${(project.postcode ?? "").toString()} ${(project.city ?? "").toString()}`.trim() || "- Localisation: —");
    lines.push(`- Budget total: ${formatMoney(project.budgetTotal)}`);
    lines.push(`- Notaire: ${formatMoney(project.budgetNotaire)} · Travaux: ${formatMoney(project.budgetTravaux)}`);
    lines.push(`- Apport: ${formatMoney(project.apport)}`);
    lines.push(`- Durée: ${project.loanDurationYears ?? "—"} ans · Taux: ${project.loanRatePct ?? "—"} %`);
    lines.push("");

    lines.push("SCÉNARIOS");
    if (!scenarios.length) {
      lines.push("- Aucun scénario enregistré");
    } else {
      scenarios.slice(0, 5).forEach((s) => {
        lines.push(
          `- ${s.name}: achat ${formatMoney(s.purchaseTarget)} · apport ${formatMoney(s.apport)} · ${s.durationYears ?? "—"} ans · ${s.ratePct ?? "—"}%`
        );
      });
      if (scenarios.length > 5) lines.push(`- (+${scenarios.length - 5} autres)`);
    }
    lines.push("");

    lines.push("FAVORIS (sélection)");
    if (!favoris.length) {
      lines.push("- Aucun favori");
    } else {
      favoris.slice(0, 5).forEach((f) => {
        lines.push(`- ${f.title} — ${formatMoney(f.priceEur)} · ${f.surfaceM2 ?? "—"} m² · ${f.postcode} ${f.city}`.trim());
      });
      if (favoris.length > 5) lines.push(`- (+${favoris.length - 5} autres)`);
    }
    lines.push("");

    lines.push("DOCUMENTS (liste)");
    if (!docs.length) {
      lines.push("- Aucun document listé");
    } else {
      docs.slice(0, 12).forEach((d) => {
        lines.push(`- [${catLabel(d.category)}] ${d.name}${d.description ? " — " + d.description : ""}`);
      });
      if (docs.length > 12) lines.push(`- (+${docs.length - 12} autres)`);
    }
    lines.push("");

    lines.push("NOTES");
    lines.push(notes?.trim() ? notes.trim() : "—");

    return lines.join("\n");
  }, [docs, favoris, notes, project, progress, scenarios]);

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(dossierSummary);
      alert("Résumé copié dans le presse-papiers.");
    } catch {
      alert("Impossible de copier automatiquement. Sélectionne le texte et copie manuellement.");
    }
  }

  return (
    <div style={wrap}>
      <div style={headerRow}>
        <div>
          <h2 style={titleStyle}>Dossier banque</h2>
          <p style={subtitleStyle}>
            Centralisez la checklist et les éléments clés pour accélérer l’instruction du dossier.
          </p>
        </div>

        <div style={row}>
          <span style={badge}>Requis: {progress.pctReq}%</span>
          <span style={badge}>Global: {progress.pctAll}%</span>

          <Link to="/particulier/projet" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
            Mon projet
          </Link>

          <Link to="/particulier/scenarios" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
            Scénarios
          </Link>

          <button type="button" style={btnGhost} onClick={resetAll}>
            Réinitialiser
          </button>
        </div>
      </div>

      <div style={grid}>
        {/* COLONNE GAUCHE: CHECKLIST */}
        <div style={card}>
          <div style={sectionTitle}>Checklist</div>

          {progress.missingReq.length > 0 ? (
            <div style={{ marginBottom: 12, padding: 12, borderRadius: 14, border: "1px solid rgba(245, 158, 11, 0.25)", background: "rgba(245, 158, 11, 0.08)" }}>
              <div style={{ fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>
                À compléter (requis)
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, color: "#0f172a" }}>
                {progress.missingReq.slice(0, 6).map((t, i) => (
                  <li key={i} style={{ marginBottom: 4, lineHeight: 1.35 }}>
                    {t}
                  </li>
                ))}
              </ul>
              {progress.missingReq.length > 6 ? (
                <div style={small}>+{progress.missingReq.length - 6} autres</div>
              ) : null}
            </div>
          ) : (
            <div style={{ marginBottom: 12, padding: 12, borderRadius: 14, border: "1px solid rgba(34, 197, 94, 0.20)", background: "rgba(34, 197, 94, 0.08)" }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Tous les éléments requis sont cochés.</div>
              <div style={small}>Tu peux maintenant améliorer le dossier (optionnels).</div>
            </div>
          )}

          <div style={{ display: "grid", gap: 12 }}>
            {(
              Object.keys(groupedChecklist) as DocCategory[]
            ).map((cat) => (
              <div key={cat}>
                <div style={{ fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>
                  {catLabel(cat)}
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {groupedChecklist[cat].map((it) => (
                    <div key={it.id} style={itemRow}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 800, color: "#0f172a" }}>
                          {it.label}{" "}
                          {it.required ? <span style={{ color: "#b45309" }}>(requis)</span> : null}
                        </div>
                        {it.notes ? <div style={small}>{it.notes}</div> : null}
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleItem(it.id)}
                        style={{
                          ...btnGhost,
                          padding: "8px 10px",
                          background: it.done ? "rgba(34, 197, 94, 0.12)" : "#ffffff",
                          borderColor: it.done ? "rgba(34, 197, 94, 0.25)" : "rgba(15, 23, 42, 0.12)",
                        }}
                      >
                        {it.done ? "OK" : "À faire"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* COLONNE DROITE: DOCS + NOTES + EXPORT */}
        <div style={{ display: "grid", gap: 14 }}>
          {/* Documents listés */}
          <div style={card}>
            <div style={sectionTitle}>Documents (liste)</div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={labelStyle}>Catégorie</label>
                  <select
                    style={inputStyle}
                    value={docCategory}
                    onChange={(e) => setDocCategory(e.target.value as DocCategory)}
                  >
                    <option value="identite">Identité</option>
                    <option value="revenus">Revenus</option>
                    <option value="patrimoine">Patrimoine</option>
                    <option value="projet">Projet</option>
                    <option value="financement">Financement</option>
                    <option value="divers">Divers</option>
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Nom du document</label>
                  <input
                    style={inputStyle}
                    value={docName}
                    onChange={(e) => setDocName(e.target.value)}
                    placeholder="Ex: Avis d’imposition 2024"
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Description (optionnel)</label>
                <input
                  style={inputStyle}
                  value={docDesc}
                  onChange={(e) => setDocDesc(e.target.value)}
                  placeholder="Ex: PDF, version signée, 2 pages..."
                />
              </div>

              <div style={row}>
                <button type="button" style={btnPrimary} onClick={addDoc}>
                  Ajouter
                </button>
                <Link
                  to="/particulier/exports"
                  style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}
                >
                  Exports
                </Link>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {docs.length === 0 ? (
                  <div style={{ color: "#475569", lineHeight: 1.5 }}>
                    Aucun document listé. Ajoute-les ici pour suivre ton dossier (sans upload serveur pour l’instant).
                  </div>
                ) : (
                  docs.map((d) => (
                    <div key={d.id} style={itemRow}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 900, color: "#0f172a" }}>
                          [{catLabel(d.category)}] {d.name}
                        </div>
                        {d.description ? <div style={small}>{d.description}</div> : null}
                        <div style={{ color: "#94a3b8", fontSize: 12 }}>
                          Ajouté le {new Date(d.addedAt).toLocaleString("fr-FR")}
                        </div>
                      </div>

                      <button type="button" style={{ ...btnGhost, padding: "8px 10px" }} onClick={() => removeDoc(d.id)}>
                        Supprimer
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div style={card}>
            <div style={sectionTitle}>Notes</div>
            <label style={labelStyle}>Points à signaler à la banque / éléments de contexte</label>
            <textarea
              style={textareaStyle}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: période d’essai, mobilité, prime annuelle, travaux à prévoir, apport en cours de déblocage..."
            />
          </div>

          {/* Résumé exportable */}
          <div style={card}>
            <div style={sectionTitle}>Résumé</div>

            <div style={row}>
              <button type="button" style={btnPrimary} onClick={copySummary}>
                Copier le résumé
              </button>
              <Link to="/particulier/favoris" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>
                Favoris
              </Link>
            </div>

            <div style={{ marginTop: 10, ...small }}>
              Ce texte sert de base pour un mail à un conseiller ou un export futur (PDF). Pour le moment, il est
              copiable/collable.
            </div>

            <pre
              style={{
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
              }}
            >
              {dossierSummary}
            </pre>
          </div>
        </div>
      </div>

      {/* Responsive minimal */}
      <style>
        {`
          @media (max-width: 980px) {
            .__db_grid { grid-template-columns: 1fr !important; }
          }
        `}
      </style>
      <div className="__db_grid" style={{ display: "none" }} />
    </div>
  );
}

