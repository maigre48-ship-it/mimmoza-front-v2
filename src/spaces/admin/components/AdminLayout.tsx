// src/spaces/admin/components/AdminLayout.tsx

import { Outlet } from "react-router-dom";
import { AdminSidebar } from "./AdminSidebar";

export function AdminLayout() {
  return (
    <div className="flex min-h-screen gap-6 bg-slate-50 p-6">
      <div className="w-64 shrink-0">
        <AdminSidebar />
      </div>
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}