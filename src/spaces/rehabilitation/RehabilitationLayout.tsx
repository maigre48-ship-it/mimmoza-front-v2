// src/spaces/rehabilitation/RehabilitationLayout.tsx
// La navigation est gérée par AppShell (SPACE_NAVIGATION.rehabilitation).
// Le redirect /rehabilitation → /rehabilitation/projets est géré par la route index dans App.tsx.

import { Outlet } from "react-router-dom";

export default function RehabilitationLayout() {
  return <Outlet />;
}