// FILE: vite.config.ts
import { defineConfig, type PluginOption } from "vite";
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

// ── Performance — découpage du code en morceaux ─────────────────────────────
//
// Les pages sont chargées à la demande (React.lazy, src/App.tsx). Ici, on range
// en plus les GROSSES bibliothèques dans des morceaux nommés et stables : elles
// ne changent presque jamais d'un déploiement à l'autre, le navigateur les
// garde donc en cache même quand le code de l'application évolue.
// ⚠️ N'y mettre QUE des bibliothèques absentes de la page d'entrée « / » :
// sinon elles seraient téléchargées par tous les visiteurs.
const MORCEAUX_BIBLIOTHEQUES: ReadonlyArray<readonly [morceau: string, paquets: readonly string[]]> = [
  // Socle React, chargé par toutes les pages. Le nommer explicitement évite que
  // Rollup ne le range dans un morceau lourd (cartes, PDF…) que la page
  // d'entrée devrait alors télécharger en entier.
  ["lib-react", ["react", "react-dom", "scheduler", "react-router", "react-router-dom"]],
  ["lib-three", ["three"]],
  ["lib-maplibre", ["maplibre-gl"]],
  ["lib-leaflet", ["leaflet", "react-leaflet", "@react-leaflet", "@geoman-io"]],
  ["lib-graphiques", ["recharts", "d3-", "victory-vendor"]],
  ["lib-exceljs", ["exceljs"]],
  ["lib-xlsx", ["xlsx"]],
  ["lib-docx", ["docx"]],
  ["lib-pptx", ["pptxgenjs"]],
  ["lib-jszip", ["jszip"]],
  ["lib-pdf", ["jspdf", "jspdf-autotable"]],
  ["lib-pdfjs", ["pdfjs-dist"]],
  ["lib-html2canvas", ["html2canvas"]],
  ["lib-turf", ["@turf"]],
];

/** Petits modules techniques injectés par Vite/Rollup, partagés par tous les morceaux. */
const MODULES_TECHNIQUES = /^\0?(?:vite\/preload-helper|commonjsHelpers)/;

function morceauBibliotheque(id: string): string | undefined {
  if (MODULES_TECHNIQUES.test(id.replace(/^\0/, ""))) return "lib-react";
  const i = id.lastIndexOf("/node_modules/");
  if (i === -1) return undefined;
  const chemin = id.slice(i + "/node_modules/".length);
  for (const [morceau, paquets] of MORCEAUX_BIBLIOTHEQUES) {
    if (paquets.some((p) => (p.endsWith("-") ? chemin.startsWith(p) : chemin === p || chemin.startsWith(p + "/")))) {
      return morceau;
    }
  }
  return undefined;
}

// Analyse du poids des morceaux : `npm run analyse:bundle` (mode « analyse »)
// → node_modules/.analyse-bundle/stats.html (carte) et stats.json (données).
async function pluginsAnalyse(mode: string): Promise<PluginOption[]> {
  if (mode !== "analyse" && !process.env.ANALYSE_BUNDLE) return [];
  // Import par nom calculé : la configuration reste valide (tsc -b, build
  // Vercel) même si cette devDependency n'est pas encore installée en local.
  const paquet = "rollup-plugin-visualizer";
  type Visualiseur = { visualizer: (options: Record<string, unknown>) => PluginOption };
  const { visualizer } = (await import(/* @vite-ignore */ paquet).catch(() => {
    throw new Error(`« ${paquet} » manquant : lancez d'abord npm install.`);
  })) as Visualiseur;
  return [
    visualizer({
      filename: "node_modules/.analyse-bundle/stats.html",
      gzipSize: true,
      template: "treemap",
    }),
    visualizer({
      filename: "node_modules/.analyse-bundle/stats.json",
      gzipSize: true,
      template: "raw-data",
    }),
  ];
}

export default defineConfig(async ({ mode }) => ({
  plugins: [react(), ...(await pluginsAnalyse(mode))],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id: string) => morceauBibliotheque(id),
      },
    },
  },
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
}));
