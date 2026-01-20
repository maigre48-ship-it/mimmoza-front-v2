
import { Outlet } from "react-router-dom";
import BaseShellLayout from "../../components/layout/BaseShellLayout";
import Sidebar from "../../components/nav/Sidebar";
import { BANQUE_SIDEBAR } from "./nav";

export default function BanqueLayout() {
  return (
    <BaseShellLayout
      title="Banque"
      sidebar={<Sidebar sections={BANQUE_SIDEBAR} />}
    >
      <Outlet />
    </BaseShellLayout>
  );
}

