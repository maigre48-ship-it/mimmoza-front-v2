import {
  ChevronRight,
  Clock,
  FolderOpen,
  HardHat,
  Home,
  MapPin,
  Pencil,
  Plus,
  Ruler,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { userStorage } from "@/lib/storage/userScopedStorage";
import { setActiveProjectId } from "../lib/rehabScope";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RehabilitationProject = {
  id: string;
  name: string;
  address?: string;
  propertyType?: string;
  surfaceM2?: number;
  status: "brouillon" | "analyse" | "travaux" | "valorisation" | "archive";
  createdAt: string;
  updatedAt: string;
  // Future data slots (extensible)
  diagnostic?: Record<string, unknown>;
  analyseeBien?: Record<string, unknown>;
  analysePlan?: Record<string, unknown>;
  budgetTravaux?: Record<string, unknown>;
  renduTravaux?: Record<string, unknown>;
  conformite?: Record<string, unknown>;
  valorisation?: Record<string, unknown>;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "mimmoza.rehabilitation.projects.v1";

const STATUS_CONFIG: Record<
  RehabilitationProject["status"],
  { label: string; color: string; bg: string; dot: string }
> = {
  brouillon: {
    label: "Brouillon",
    color: "#6b7280",
    bg: "#f3f4f6",
    dot: "#9ca3af",
  },
  analyse: {
    label: "En analyse",
    color: "#d97706",
    bg: "#fef3c7",
    dot: "#f59e0b",
  },
  travaux: {
    label: "Travaux",
    color: "#ea580c",
    bg: "#fff7ed",
    dot: "#f97316",
  },
  valorisation: {
    label: "Valorisation",
    color: "#059669",
    bg: "#ecfdf5",
    dot: "#10b981",
  },
  archive: {
    label: "Archivé",
    color: "#9ca3af",
    bg: "#f9fafb",
    dot: "#d1d5db",
  },
};

const PROPERTY_TYPES = [
  "Appartement",
  "Maison",
  "Immeuble",
  "Local commercial",
  "Bureau",
  "Loft / Entrepôt",
  "Autre",
];

// ─── localStorage helpers ─────────────────────────────────────────────────────

function loadProjects(): RehabilitationProject[] {
  try {
    const raw = userStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RehabilitationProject[]) : [];
  } catch {
    return [];
  }
}
function saveProjects(projects: RehabilitationProject[]): void {
  userStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function generateId(): string {
  return `rehab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ─── Modal "Nouveau projet" ───────────────────────────────────────────────────

interface NewProjectModalProps {
  onClose: () => void;
  onSave: (project: RehabilitationProject) => void;
  initial?: RehabilitationProject | null;
}

function NewProjectModal({ onClose, onSave, initial }: NewProjectModalProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [propertyType, setPropertyType] = useState(
    initial?.propertyType ?? ""
  );
  const [surface, setSurface] = useState<string>(
    initial?.surfaceM2 != null ? String(initial.surfaceM2) : ""
  );
  const [status, setStatus] = useState<RehabilitationProject["status"]>(
    initial?.status ?? "brouillon"
  );

  const handleSubmit = () => {
    if (!name.trim()) return;
    const now = new Date().toISOString();
    const project: RehabilitationProject = {
      id: initial?.id ?? generateId(),
      name: name.trim(),
      address: address.trim() || undefined,
      propertyType: propertyType || undefined,
      surfaceM2: surface ? parseFloat(surface) : undefined,
      status,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    };
    onSave(project);
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          width: "100%",
          maxWidth: 480,
          padding: "32px 32px 24px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "linear-gradient(135deg, #f97316, #ea580c)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <HardHat size={20} color="#fff" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#111827" }}>
              {initial ? "Modifier le projet" : "Nouveau projet"}
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
              Réhabilitation immobilière
            </p>
          </div>
        </div>

        {/* Fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <ModalField label="Nom du projet *">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Réhab Duplex Montmartre"
              style={inputStyle}
              autoFocus
            />
          </ModalField>

          <ModalField label="Adresse / Localisation">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Ex: 12 rue de la Paix, 75001 Paris"
              style={inputStyle}
            />
          </ModalField>

          <div style={{ display: "flex", gap: 12 }}>
            <ModalField label="Type de bien" style={{ flex: 1 }}>
              <select
                value={propertyType}
                onChange={(e) => setPropertyType(e.target.value)}
                style={inputStyle}
              >
                <option value="">— Choisir —</option>
                {PROPERTY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </ModalField>

            <ModalField label="Surface (m²)" style={{ flex: 1 }}>
              <input
                type="number"
                value={surface}
                onChange={(e) => setSurface(e.target.value)}
                placeholder="Ex: 78"
                style={inputStyle}
                min={0}
              />
            </ModalField>
          </div>

          <ModalField label="État d'avancement">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(
                Object.keys(STATUS_CONFIG) as RehabilitationProject["status"][]
              ).map((s) => {
                const cfg = STATUS_CONFIG[s];
                const active = status === s;
                return (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 600,
                      border: `2px solid ${active ? cfg.dot : "#e5e7eb"}`,
                      background: active ? cfg.bg : "#fff",
                      color: active ? cfg.color : "#6b7280",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </ModalField>
        </div>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            paddingTop: 4,
            borderTop: "1px solid #f3f4f6",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "9px 18px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
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
            onClick={handleSubmit}
            disabled={!name.trim()}
            style={{
              padding: "9px 20px",
              borderRadius: 8,
              border: "none",
              background:
                name.trim()
                  ? "linear-gradient(135deg, #f97316, #ea580c)"
                  : "#d1d5db",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              cursor: name.trim() ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Plus size={16} />
            {initial ? "Enregistrer" : "Créer le projet"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalField({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, ...style }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
  color: "#111827",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  background: "#fafafa",
};

// ─── Projet Card ──────────────────────────────────────────────────────────────

interface ProjectCardProps {
  project: RehabilitationProject;
  onOpen: (id: string) => void;
  onEdit: (project: RehabilitationProject) => void;
  onDelete: (id: string) => void;
}

function ProjectCard({ project, onOpen, onEdit, onDelete }: ProjectCardProps) {
  const cfg = STATUS_CONFIG[project.status];

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        border: "1px solid #f3f4f6",
        boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        transition: "box-shadow 0.2s, transform 0.2s",
        cursor: "default",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow =
          "0 8px 24px rgba(249,115,22,0.12)";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow =
          "0 2px 8px rgba(0,0,0,0.05)";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
      }}
    >
      {/* Top row: name + status */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 9,
              background: "linear-gradient(135deg, #fff7ed, #fed7aa)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <HardHat size={18} color="#f97316" />
          </div>
          <h3
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 700,
              color: "#111827",
              lineHeight: 1.3,
            }}
          >
            {project.name}
          </h3>
        </div>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 700,
            color: cfg.color,
            background: cfg.bg,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: cfg.dot,
            }}
          />
          {cfg.label}
        </span>
      </div>

      {/* Meta info */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 16px",
        }}
      >
        {project.address && (
          <MetaChip icon={<MapPin size={11} />} label={project.address} />
        )}
        {project.propertyType && (
          <MetaChip icon={<Home size={11} />} label={project.propertyType} />
        )}
        {project.surfaceM2 != null && (
          <MetaChip
            icon={<Ruler size={11} />}
            label={`${project.surfaceM2} m²`}
          />
        )}
        <MetaChip
          icon={<Clock size={11} />}
          label={`MàJ ${formatDate(project.updatedAt)}`}
          muted
        />
      </div>

      {/* Actions */}
      <div
        style={{
          display: "flex",
          gap: 8,
          paddingTop: 6,
          borderTop: "1px solid #f9fafb",
        }}
      >
        <button
          onClick={() => onOpen(project.id)}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 8,
            border: "none",
            background: "linear-gradient(135deg, #f97316, #ea580c)",
            color: "#fff",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
          }}
        >
          <FolderOpen size={14} />
          Ouvrir
          <ChevronRight size={13} />
        </button>

        <button
          onClick={() => onEdit(project)}
          title="Modifier"
          style={iconBtnStyle("#fff7ed", "#f97316")}
        >
          <Pencil size={15} />
        </button>

        <button
          onClick={() => {
            if (
              window.confirm(
                `Supprimer "${project.name}" ? Cette action est irréversible.`
              )
            ) {
              onDelete(project.id);
            }
          }}
          title="Supprimer"
          style={iconBtnStyle("#fef2f2", "#ef4444")}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

function MetaChip({
  icon,
  label,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  muted?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 12,
        color: muted ? "#9ca3af" : "#6b7280",
      }}
    >
      <span style={{ color: muted ? "#d1d5db" : "#f97316" }}>{icon}</span>
      {label}
    </span>
  );
}

function iconBtnStyle(bg: string, color: string): React.CSSProperties {
  return {
    width: 36,
    height: 36,
    borderRadius: 8,
    border: "none",
    background: bg,
    color,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 24px",
        gap: 20,
      }}
    >
      {/* Illustrated icon */}
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: 20,
          background: "linear-gradient(135deg, #fff7ed, #fed7aa)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 24px rgba(249,115,22,0.15)",
        }}
      >
        <HardHat size={38} color="#f97316" />
      </div>

      <div style={{ textAlign: "center" }}>
        <h3
          style={{
            margin: "0 0 8px",
            fontSize: 18,
            fontWeight: 700,
            color: "#111827",
          }}
        >
          Aucun projet de réhabilitation
        </h3>
        <p style={{ margin: 0, fontSize: 14, color: "#6b7280", maxWidth: 360 }}>
          Créez votre premier projet pour centraliser diagnostic, travaux,
          conformité et valorisation au même endroit.
        </p>
      </div>

      <button
        onClick={onNew}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 22px",
          borderRadius: 10,
          border: "none",
          background: "linear-gradient(135deg, #f97316, #ea580c)",
          color: "#fff",
          fontWeight: 700,
          fontSize: 14,
          cursor: "pointer",
          boxShadow: "0 4px 14px rgba(249,115,22,0.35)",
        }}
      >
        <Plus size={16} />
        Créer un projet
      </button>
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function ProjetsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<RehabilitationProject[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<RehabilitationProject | null>(
    null
  );

  // Load on mount
  useEffect(() => {
    setProjects(loadProjects());
  }, []);

  const persist = (updated: RehabilitationProject[]) => {
    setProjects(updated);
    saveProjects(updated);
  };

  const handleSave = (project: RehabilitationProject) => {
    const idx = projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) {
      const next = [...projects];
      next[idx] = project;
      persist(next);
    } else {
      persist([project, ...projects]);
    }
    setEditTarget(null);
  };

  const handleDelete = (id: string) => {
    persist(projects.filter((p) => p.id !== id));
  };

  const handleOpen = (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project) return;

    // Marque le projet actif + preremplit la Vue d'ensemble (cle dediee au projet).
    try {
      setActiveProjectId(id);

      const overviewKey = `mimmoza_rehab_overview_${id}`;
      // Ne pas ecraser une saisie existante : on initialise seulement si vide.
      if (!userStorage.getItem(overviewKey)) {
        const overview = {
          nomProjet: project.name ?? "",
          adresse: project.address ?? "",
          usageCible: "",
          surface: project.surfaceM2 != null ? String(project.surfaceM2) : "",
          anneeConstruction: "",
          erp: "",
          dpe: "",
          copropriete: "",
          notes: "",
        };
        userStorage.setItem(overviewKey, JSON.stringify(overview));
      }
    } catch {
      /* noop */
    }

    navigate("/rehabilitation/vue-ensemble");
  };

  const openNew = () => {
    setEditTarget(null);
    setShowModal(true);
  };

  const openEdit = (project: RehabilitationProject) => {
    setEditTarget(project);
    setShowModal(true);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f9fafb",
        fontFamily:
          "'DM Sans', 'Outfit', system-ui, -apple-system, sans-serif",
      }}
    >
      {/* ── Bandeau orange Réhabilitation ── */}
      <div style={{
        background: "linear-gradient(135deg, #ea580c 0%, #fb923c 100%)",
        borderRadius: 24,
        padding: "32px 36px",
        marginBottom: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        boxShadow: "0 8px 32px rgba(234,88,12,0.22)",
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>

            Réhabilitation · Projets
          </div>
          <div style={{ fontSize: 36, fontWeight: 600, color: "#fff", marginBottom: 10, lineHeight: 1.1, letterSpacing: "-0.025em" }}>

            Projets de réhabilitation
          </div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", maxWidth: 460, lineHeight: 1.55 }}>
            Centralisez vos analyses, travaux, conformité et valorisation par projet
          </div>
          {projects.length > 0 && (
            <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
              {(Object.keys(STATUS_CONFIG) as RehabilitationProject["status"][]).map((s) => {
                const count = projects.filter((p) => p.status === s).length;
                if (!count) return null;
                return (
                  <span key={s} style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.9)", background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8, padding: "3px 10px" }}>
                    {STATUS_CONFIG[s].label} : {count}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <button
          onClick={openNew}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "13px 22px", borderRadius: 14, border: "none",
            background: "#fff", color: "#ea580c",
            fontWeight: 700, fontSize: 14, cursor: "pointer",
            flexShrink: 0, boxShadow: "0 4px 20px rgba(0,0,0,0.16)",
            transition: "transform 0.14s ease, box-shadow 0.14s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 28px rgba(0,0,0,0.20)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.16)"; }}
        >
          <Plus size={16} />
          Nouveau projet
        </button>
      </div>

      {/* ── Content ── */}
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "28px 32px",
        }}
      >
        {projects.length === 0 ? (
          <EmptyState onNew={openNew} />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 18,
            }}
          >
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={handleOpen}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Modal ── */}
      {showModal && (
        <NewProjectModal
          initial={editTarget}
          onClose={() => {
            setShowModal(false);
            setEditTarget(null);
          }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12.5,
        color: "#374151",
        fontWeight: 500,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: 6,
          background: color + "22",
          color,
          fontWeight: 800,
          fontSize: 12,
        }}
      >
        {value}
      </span>
      {label}
    </div>
  );
}