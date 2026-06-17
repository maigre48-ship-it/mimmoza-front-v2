// ============================================================================
// BanqueRedirectToDossier.tsx
// Redirect: /banque/garanties/:id, /banque/documents/:id → /banque/dossier/:id
// ============================================================================

import { Navigate, useParams } from "react-router-dom";

export default function BanqueRedirectToDossier() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/banque/dossier/${id ?? ""}`} replace />;
}