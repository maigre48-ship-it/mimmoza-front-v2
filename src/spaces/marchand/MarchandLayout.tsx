
import { Outlet } from "react-router-dom";
import BaseShellLayout from "../../components/layout/BaseShellLayout";
import Sidebar from "../../components/nav/Sidebar";
import { MARCHAND_SIDEBAR } from "./nav";

export default function MarchandLayout() {
  return (
    <div style={{ position: "relative", zIndex: 999999, pointerEvents: "auto" }}>
      <BaseShellLayout
        title="Marchand"
        sidebar={<Sidebar sections={MARCHAND_SIDEBAR} />}
      >
        <Outlet />
      </BaseShellLayout>
    </div>
  );
}

