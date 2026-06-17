// src/spaces/marchand/MarchandLayout.tsx

import { Outlet, useLocation } from "react-router-dom";
import { useCopilotPageSync } from "../copilot/hooks/useCopilotPageSync";
import { useMarchandDealCopilotSync } from "./hooks/useMarchandDealCopilotSync";

export default function MarchandLayout() {
  const { pathname } = useLocation();

  useCopilotPageSync(pathname, "marchand");
  useMarchandDealCopilotSync(pathname);

  return (
    <div
      style={{
        minHeight: "calc(100vh - 16px)",
        padding: "32px 0",
      }}
    >
      <Outlet />
    </div>
  );
}