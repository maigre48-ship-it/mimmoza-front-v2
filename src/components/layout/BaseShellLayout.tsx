import { Link } from "react-router-dom";

export type NavItem = {
  label: string;
  to: string;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

type Props = {
  title: string;
  homeTo?: string;
  sidebar: React.ReactNode;
  children: React.ReactNode;
};

export default function BaseShellLayout({
  title,
  homeTo = "/",
  sidebar,
  children,
}: Props) {
  return (
    <div style={{ minHeight: "100vh", background: "#ffffff" }}>
      <header
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid rgba(15, 23, 42, 0.10)",
          background: "#ffffff",
          position: "sticky",
          top: 0,
          zIndex: 1000,
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 18, color: "#0f172a" }}>
            {title}
          </div>

          <div style={{ flex: 1 }} />

          <Link
            to={homeTo}
            style={{
              color: "#334155",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            Accueil
          </Link>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex" }}>
        <aside
          style={{
            width: 290,
            borderRight: "1px solid rgba(15, 23, 42, 0.08)",
            padding: 16,
            position: "sticky",
            top: 54,
            alignSelf: "flex-start",
            height: "calc(100vh - 54px)",
            overflowY: "auto",
            background: "#ffffff",

            // 🔒 sécurité clic
            zIndex: 900,
            pointerEvents: "auto",
          }}
        >
          {sidebar}
        </aside>

        <main
          style={{
            flex: 1,
            padding: 18,
            background: "#ffffff",
            position: "relative",
            zIndex: 1,
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}