// src/components/StudioHorsApplication.tsx
//
// R1 — /studio/* n'appartient PAS à l'application React : c'est MimmozIA Studio, servi à la même
// origine (vercel.json en production, proxy Vite en local). Cette route ne fait que deux choses :
//   1. navigation interne (Link / navigate vers /studio/…) : rechargement complet de l'adresse,
//      pour que le serveur serve Studio au lieu du routeur React ;
//   2. chargement direct de /studio/… servi par l'index du front : le serveur n'a PAS servi Studio
//      (réécriture ou proxy absent). On le dit clairement, au lieu de renvoyer vers la connexion.
// Aucune boucle : le rechargement n'a lieu que si la page n'a pas été chargée sur /studio/.

import { useEffect } from "react";
import { STUDIO_CHEMIN } from "../lib/studioConfig.ts";

/** Chemin du premier chargement du document (avant toute navigation du routeur). */
const CHEMIN_INITIAL = typeof window !== "undefined" ? window.location.pathname : "";
const estCheminStudio = (chemin: string): boolean => /^\/studio(?:\/|$)/.test(chemin);

export default function StudioHorsApplication() {
  const navigationInterne = !estCheminStudio(CHEMIN_INITIAL);

  useEffect(() => {
    if (navigationInterne) window.location.assign(window.location.href);
  }, [navigationInterne]);

  if (navigationInterne) return null;

  return (
    <main style={{ maxWidth: 640, margin: "64px auto", padding: "0 16px", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>Studio 3D indisponible à cette adresse</h1>
      <p>
        MimmozIA Studio doit être servi sous <code>{STUDIO_CHEMIN}</code> par le serveur, mais c'est
        l'application Mimmoza qui a répondu.
      </p>
      <ul>
        <li>En production : vérifiez la réécriture <code>/studio/</code> de <code>vercel.json</code> et le déploiement du projet Studio.</li>
        <li>En local : lancez Studio (<code>npm run dev</code> dans mimmozia-studio, port 5174) puis rouvrez cette page.</li>
      </ul>
      <p><a href="/">Revenir à l'accueil Mimmoza</a></p>
    </main>
  );
}
