// src/spaces/visite/ChoixVisionneuse.tsx
// =============================================================================
// VIS-69 — Choix de la visionneuse pour /visite/<id> : la visite interactive si
// visite-interactive.json est publié et cohérent avec le manifeste, sinon (fichier
// absent, illisible, incohérent, ou ?classique=1) l'ancienne visionneuse, INCHANGÉE.
// =============================================================================

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { urlFichier, type ManifesteVisite } from "../../pages/visite/manifeste";
import { FICHIER_INTERACTIF, lireVisiteInteractive, type VisiteInteractive as Visite } from "../../lib/visiteInteractive/metadonnees";
import VisiteInteractive from "./VisiteInteractive";

type Choix = { readonly type: "attente" } | { readonly type: "classique" } | { readonly type: "interactive"; readonly visite: Visite };

export interface ChoixVisionneuseProps {
  readonly manifeste: ManifesteVisite;
  readonly dossier: string;
  readonly visiteId: string;
  /** Ancienne visionneuse, rendue telle quelle en repli. */
  readonly repli: ReactNode;
}

export default function ChoixVisionneuse({ manifeste, dossier, visiteId, repli }: ChoixVisionneuseProps) {
  const [recherche] = useSearchParams();
  const classique = recherche.get("classique") === "1";
  const [choix, setChoix] = useState<Choix>(classique ? { type: "classique" } : { type: "attente" });

  useEffect(() => {
    if (classique) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const rep = await fetch(urlFichier(dossier, FICHIER_INTERACTIF), { signal: ctrl.signal, cache: "no-cache" });
        if (!rep.ok) return setChoix({ type: "classique" });
        const lu = lireVisiteInteractive(await rep.json(), manifeste);
        if (!lu.ok) {
          console.warn("[visite interactive] repli sur la visionneuse classique :", lu.erreur);
          return setChoix({ type: "classique" });
        }
        for (const a of lu.avertissements) console.warn("[visite interactive]", a);
        setChoix({ type: "interactive", visite: lu.visite });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setChoix({ type: "classique" });
      }
    })();
    return () => ctrl.abort();
  }, [classique, dossier, manifeste]);

  if (choix.type === "classique") return <>{repli}</>;
  if (choix.type === "interactive") return <VisiteInteractive visite={choix.visite} manifeste={manifeste} dossier={dossier} visiteId={visiteId} />;
  return (
    <div className="v360-racine v360-ecran">
      <div className="v360-message" role="status" aria-live="polite">
        <Loader2 className="v360-tourne" aria-hidden="true" />
        <p>Chargement de la visite…</p>
      </div>
    </div>
  );
}
