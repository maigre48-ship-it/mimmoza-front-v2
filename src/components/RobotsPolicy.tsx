// src/components/RobotsPolicy.tsx
//
// Pilote la balise <meta name="robots"> en fonction de la route courante.
//
// ─── Sens de la bascule ──────────────────────────────────────────────────────
// index.html déclare « noindex, nofollow » par défaut. Ce composant ne fait
// qu'AUTORISER l'indexation sur une liste courte et explicite de pages
// publiques. Il n'ajoute jamais de restriction : elle est déjà là.
//
// Ce choix est délibéré. Si le JavaScript échoue ou n'est pas exécuté par un
// robot, l'état qui subsiste est le plus restrictif. L'approche inverse —
// indexable par défaut, restreint par le JS — exposerait les pages au moindre
// incident de rendu.
//
// ─── Pourquoi cette contrainte existe ────────────────────────────────────────
// Mimmoza réutilise les données DVF publiées par la DGFiP. L'article R. 112 A-3
// du livre des procédures fiscales impose que cette réutilisation « ne doit pas
// permettre l'indexation des données depuis les moteurs de recherche externes »
// et ne doit pas permettre la ré-identification indirecte des personnes.
// Ce n'est pas une préférence de référencement : c'est une condition de la
// licence de réutilisation.
//
// ─── À relire avant la mise en production publique ───────────────────────────
// Le middleware Vercel (middleware.ts) renvoie aujourd'hui un 401 sur toutes
// les routes, ce qui rend le site inaccessible aux robots. C'est LUI qui
// protège réellement, pas ce composant. Le jour où il sera retiré, ce fichier
// et public/robots.txt deviendront la seule barrière.

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Routes autorisées à l'indexation. Elles ne portent AUCUNE donnée DVF :
 * ni prix, ni transaction, ni médiane au m².
 *
 * Avant d'ajouter une entrée ici, vérifier que la page n'affiche aucun
 * comparable, aucune estimation et aucun prix de marché — y compris à
 * l'intérieur d'un composant enfant ou d'un encart de démonstration.
 */
const ROUTES_INDEXABLES = new Set<string>([
  "/",
  "/login",
  "/connexion",
  "/inscription",
  "/cgv",
  "/cgu",
  "/politique-confidentialite",
  "/mentions-legales",
]);

const VALEUR_RESTRICTIVE = "noindex, nofollow";
const VALEUR_PERMISSIVE = "index, follow";

function appliquer(valeur: string): void {
  if (typeof document === "undefined") return;

  let balise = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!balise) {
    // La balise devrait venir d'index.html. Si elle manque — build modifié,
    // page servie autrement —, on la recrée plutôt que de laisser la page
    // sans consigne du tout.
    balise = document.createElement("meta");
    balise.setAttribute("name", "robots");
    document.head.appendChild(balise);
  }
  balise.setAttribute("content", valeur);
}

/**
 * À monter une seule fois, à l'intérieur du Router.
 */
export function RobotsPolicy() {
  const { pathname } = useLocation();

  useEffect(() => {
    // Normalise la barre oblique finale : « /cgv/ » et « /cgv » sont la même
    // page, et une différence d'écriture ne doit pas changer la consigne.
    const normalise =
      pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

    appliquer(
      ROUTES_INDEXABLES.has(normalise) ? VALEUR_PERMISSIVE : VALEUR_RESTRICTIVE,
    );
  }, [pathname]);

  return null;
}
