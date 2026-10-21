// src/components/ChargementGarde.tsx
// Écran neutre affiché pendant la vérification d'une garde de route
// (session, formule) : évite tout « flash » de contenu protégé ou de la
// page de connexion.

import { Loader2 } from "lucide-react";

export function ChargementGarde({ libelle = "Vérification de votre accès…" }: { libelle?: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        {libelle}
      </div>
    </div>
  );
}

export default ChargementGarde;
