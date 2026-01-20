
import { Outlet } from "react-router-dom";
import BaseShellLayout from "../../components/layout/BaseShellLayout";
import Sidebar from "../../components/nav/Sidebar";
import { PROMOTEUR_SIDEBAR } from "./nav";

export default function PromoteurLayout() {
  return (
    <BaseShellLayout
      title="Promoteur"
      sidebar={<Sidebar sections={PROMOTEUR_SIDEBAR} />}
    >
      <Outlet />
    </BaseShellLayout>
  );
}

