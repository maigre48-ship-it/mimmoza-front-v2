// src/components/BoutonStudio3D.tsx
//
// Bouton « Studio 3D » de l'en-tête : ouvre MimmozIA Studio sur un NOUVEAU PROJET VIERGE,
// sans passer par une conversation. Studio est servi à la même adresse (/studio/) : un seul
// produit. Le projet Studio précédent est mis de côté par Studio (intact, rouvrable d'un clic),
// et « ← Mimmoza » dans Studio ramène sur la page d'où l'on est parti (conversation comprise).
//
// Lien <a> ordinaire (rechargement complet, voulu : /studio/ n'est pas une route React — cf.
// StudioHorsApplication) ; Ctrl/Cmd+clic ou clic du milieu l'ouvrent dans un nouvel onglet.
// Visible pour les utilisateurs connectés uniquement (Studio exige le compte Mimmoza).

import { Cuboid } from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import { useSessionSupabase } from "@/lib/auth/useSessionSupabase";
import { urlStudio } from "@/lib/studioConfig";
import { adresseNouveauProjetStudio, cheminRetourMimmoza } from "@/lib/studioNouveauProjet";
import { useCopilotStore } from "@/spaces/copilot/store/copilotStore";

const TITRE =
  "Ouvrir MimmozIA Studio sur un nouveau projet 3D vierge. " +
  "Votre projet Studio précédent est mis de côté, intact ; « ← Mimmoza » vous ramène ici.";

export function BoutonStudio3D(props: { compact?: boolean }) {
  const { compact = false } = props;
  const { chargement, session } = useSessionSupabase();
  const location = useLocation();
  const conversationId = useCopilotStore((s) => s.currentConversationId);

  const cible = useMemo(() => {
    try {
      const retour = cheminRetourMimmoza(location.pathname, location.search, conversationId);
      return { href: adresseNouveauProjetStudio(urlStudio(), retour), erreur: null as string | null };
    } catch (e) {
      // ErreurStudio3D (adresse configurée inutilisable) : message affichable tel quel.
      return { href: null as string | null, erreur: e instanceof Error ? e.message : String(e) };
    }
  }, [location.pathname, location.search, conversationId]);

  // Non connecté (ou session en cours de lecture) : pas de bouton, pas de clignotement.
  if (chargement || !session) return null;

  if (compact) {
    const cls =
      "inline-flex h-11 w-11 items-center justify-center rounded-lg border transition-all " +
      "border-violet-200 bg-violet-50 text-violet-800 hover:border-violet-300 hover:bg-violet-100";
    return cible.href ? (
      <a href={cible.href} className={cls} title={TITRE} aria-label="Studio 3D : nouveau projet">
        <Cuboid className="h-4 w-4" />
      </a>
    ) : (
      <button type="button" disabled className={cls + " opacity-50"} title={cible.erreur ?? undefined} aria-label="Studio 3D indisponible">
        <Cuboid className="h-4 w-4" />
      </button>
    );
  }

  // Même habillage que « Mimmoza Pro » (classe du menu d'abonnements, déjà chargée dans l'en-tête).
  return cible.href ? (
    <a href={cible.href} className="mzia-sub__trigger shrink-0 no-underline" title={TITRE} aria-label="Studio 3D : nouveau projet">
      <Cuboid size={15} />
      <span className="hidden lg:inline">Studio 3D</span>
    </a>
  ) : (
    <button type="button" disabled className="mzia-sub__trigger shrink-0 opacity-50 cursor-not-allowed" title={cible.erreur ?? undefined}>
      <Cuboid size={15} />
      <span className="hidden lg:inline">Studio 3D</span>
    </button>
  );
}

export default BoutonStudio3D;
