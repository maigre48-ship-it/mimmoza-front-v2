// FILE: vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// ── R1 — MimmozIA Studio servi sous /studio/, à la MÊME ORIGINE que le front ──
//
// Production : vercel.json réécrit /studio/* vers le déploiement statique de Studio.
// Ici, on reproduit la même origine en local : le front relaie /studio vers le Vite
// de Studio (5174, base /studio/), et /api vers le runner de Studio (4820), que
// Studio appelle en chemin absolu. Ports FIXES (strictPort) : un port occupé fait
// échouer le démarrage au lieu de glisser silencieusement sur 5174.
// L'adresse de Studio côté application : src/lib/studioConfig.ts (point unique).
const FRONT_PORT_DEV = 5173;
const FRONT_PORT_PREVIEW = 4173;
const STUDIO_DEV = process.env.MIMMOZIA_STUDIO_DEV_URL ?? "http://localhost:5174";
const STUDIO_PREVIEW = process.env.MIMMOZIA_STUDIO_PREVIEW_URL ?? "http://localhost:4174";
const RUNNER = `http://localhost:${process.env.RUNNER_PORT ?? 4820}`;
/** /studio, /studio/… et /studio?… — jamais /studios ni /studio-xyz. */
const CHEMIN_STUDIO = "^/studio(?:/|\\?|$)";
/** Pages React du front rangées sous /api/ : servies par le front, jamais relayées au runner. */
const PAGES_API_FRONT = /^\/api\/(?:keys|playground|developer|billing)(?:[/?#]|$)/;

const proxyStudio = (cible: string) => ({ target: cible, changeOrigin: true, ws: true });
const proxyRunner = {
  target: RUNNER,
  changeOrigin: true,
  bypass: (req: { url?: string }) => (PAGES_API_FRONT.test(req.url ?? "") ? req.url : undefined),
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: FRONT_PORT_DEV,
    strictPort: true,
    proxy: {
      [CHEMIN_STUDIO]: proxyStudio(STUDIO_DEV),
      "/api": proxyRunner,
    },
  },
  preview: {
    port: FRONT_PORT_PREVIEW,
    strictPort: true,
    proxy: {
      [CHEMIN_STUDIO]: proxyStudio(STUDIO_PREVIEW),
      "/api": proxyRunner,
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Code partagé entre le front et les edge functions Deno.
      //
      // Ces modules ne dépendent NI de Vite NI de Deno : calcul pur et fetch.
      // Ils portent l'extension .ts dans leurs imports internes — Deno l'exige,
      // et le front l'autorise via `allowImportingTsExtensions`. C'est ce qui
      // rend le partage possible sans build intermédiaire ni duplication.
      //
      // ⚠️ N'y placer que du code sans API navigateur (pas de localStorage,
      // window, document) : il doit tourner à l'identique des deux côtés.
      "@shared": fileURLToPath(new URL("./supabase/functions/_shared", import.meta.url)),
    },
  },
});
