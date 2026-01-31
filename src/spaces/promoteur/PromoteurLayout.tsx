/**
 * PromoteurLayout - Layout principal pour l'espace Promoteur.
 *
 * Utilise BaseShellLayout avec PromoteurSidebar qui préserve
 * automatiquement le paramètre ?study= sur tous les liens de navigation.
 */

import { Outlet } from "react-router-dom";
import BaseShellLayout from "../../components/layout/BaseShellLayout";
import PromoteurSidebar from "./PromoteurSidebar";

export default function PromoteurLayout() {
  return (
    <BaseShellLayout
      title="Espace Promoteur"
      homeTo="/promoteur"
      sidebar={<PromoteurSidebar />}
    >
      <Outlet />
    </BaseShellLayout>
  );
}