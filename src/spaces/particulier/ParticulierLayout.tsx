
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import BaseShellLayout from "../../components/layout/BaseShellLayout";
import Sidebar from "../../components/nav/Sidebar";
import { PARTICULIER_SIDEBAR } from "./nav";

export default function ParticulierLayout() {
  const loc = useLocation();
  const nav = useNavigate();

  return (
    <div style={{ position: "relative", zIndex: 999999, pointerEvents: "auto" }}>
      {/* Bande diagnostic (preuve de navigation) */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 999999,
          padding: "8px 12px",
          background: "rgba(15, 23, 42, 0.04)",
          borderBottom: "1px solid rgba(15, 23, 42, 0.10)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          pointerEvents: "auto",
        }}
      >
        <div style={{ fontWeight: 900, color: "#0f172a" }}>
          Path: <span style={{ fontWeight: 700 }}>{loc.pathname}</span>
        </div>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={() => nav("/particulier")}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(15, 23, 42, 0.12)",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 800,
          }}
        >
          Dashboard
        </button>

        <button
          type="button"
          onClick={() => nav("/particulier/projet")}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(15, 23, 42, 0.12)",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 800,
          }}
        >
          Mon projet
        </button>

        <button
          type="button"
          onClick={() => nav("/particulier/favoris")}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(15, 23, 42, 0.12)",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 800,
          }}
        >
          Favoris
        </button>
      </div>

      <BaseShellLayout
        title="Particulier"
        sidebar={<Sidebar sections={PARTICULIER_SIDEBAR} />}
      >
        <Outlet />
      </BaseShellLayout>
    </div>
  );
}

