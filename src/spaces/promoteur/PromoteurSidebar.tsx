import { NavLink, useLocation, useSearchParams } from "react-router-dom";
import { PROMOTEUR_SIDEBAR } from "./nav";

const linkBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 12px",
  borderRadius: 12,
  textDecoration: "none",
  border: "1px solid transparent",
};

export default function PromoteurSidebar() {
  const location = useLocation();
  const [params] = useSearchParams();
  const study = params.get("study");
  const suffix = study ? `?study=${study}` : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {PROMOTEUR_SIDEBAR.map((section) => (
        <div key={section.title} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, padding: "0 12px" }}>
            {section.title}
          </div>
          {section.items.map((item) => {
            const isActive =
              item.to === "/promoteur"
                ? location.pathname === "/promoteur"
                : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={`${item.to}${suffix}`}
                style={{
                  ...linkBase,
                  background: isActive ? "rgba(15, 23, 42, 0.06)" : "transparent",
                  borderColor: isActive ? "rgba(15, 23, 42, 0.12)" : "transparent",
                  fontWeight: 700,
                  fontSize: 13,
                  color: isActive ? "#0f172a" : "#334155",
                }}
              >
                {item.label}
              </NavLink>
            );
          })}
        </div>
      ))}
    </div>
  );
}