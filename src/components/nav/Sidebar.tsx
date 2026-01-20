
import { useLocation, useNavigate } from "react-router-dom";
import type { NavSection } from "../layout/BaseShellLayout";

type Props = {
  sections: NavSection[];
};

const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#64748b",
  fontWeight: 900,
  margin: "10px 8px",
};

const itemBase: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "10px 10px",
  borderRadius: 10,
  border: "1px solid transparent",
  background: "transparent",
  color: "#0f172a",
  fontWeight: 700,
  cursor: "pointer",
  userSelect: "none",
};

export default function Sidebar({ sections }: Props) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div style={{ position: "relative", zIndex: 50 }}>
      {sections.map((sec) => (
        <div key={sec.title} style={{ marginBottom: 14 }}>
          <div style={sectionTitle}>{sec.title}</div>

          <div style={{ display: "grid", gap: 6 }}>
            {sec.items.map((it) => {
              const isActive =
                location.pathname === it.to ||
                (it.to !== "/" && location.pathname.startsWith(it.to + "/"));

              return (
                <button
                  key={it.to}
                  type="button"
                  onClick={() => navigate(it.to)}
                  style={{
                    ...itemBase,
                    background: isActive
                      ? "rgba(99, 102, 241, 0.10)"
                      : "transparent",
                    border: isActive
                      ? "1px solid rgba(99, 102, 241, 0.25)"
                      : "1px solid transparent",
                  }}
                >
                  {it.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

