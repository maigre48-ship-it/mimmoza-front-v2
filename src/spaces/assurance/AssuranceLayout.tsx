
import { Outlet } from "react-router-dom";
import BaseShellLayout from "../../components/layout/BaseShellLayout";
import Sidebar from "../../components/nav/Sidebar";
import { ASSURANCE_SIDEBAR } from "./nav";

export default function AssuranceLayout() {
  return (
    <BaseShellLayout
      title="Assurance"
      sidebar={<Sidebar sections={ASSURANCE_SIDEBAR} />}
    >
      <Outlet />
    </BaseShellLayout>
  );
}

