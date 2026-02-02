import React from "react";
import { Outlet } from "react-router-dom";
import MarchandSidebar from "./MarchandSidebar";

export default function MarchandLayout() {
  return (
    <div
      style={{
        minHeight: "calc(100vh - 16px)",
        padding: 12,
        background:
          "radial-gradient(1200px 600px at 20% 0%, rgba(99,102,241,0.10), transparent 60%)," +
          "radial-gradient(900px 500px at 90% 10%, rgba(16,185,129,0.10), transparent 55%)," +
          "linear-gradient(180deg, rgba(248,250,252,1), rgba(255,255,255,1))",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: 12,
          alignItems: "start",
        }}
      >
        {/* Sidebar */}
        <div
          style={{
            position: "sticky",
            top: 12,
            alignSelf: "start",
            height: "calc(100vh - 24px)",
            overflow: "auto",
            paddingRight: 2,
          }}
        >
          <MarchandSidebar />
        </div>

        {/* Content */}
        <div
          style={{
            borderRadius: 18,
            border: "1px solid rgba(15, 23, 42, 0.08)",
            background: "rgba(255,255,255,0.78)",
            boxShadow: "0 18px 45px rgba(2,6,23,0.08)",
            overflow: "hidden",
          }}
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
}
