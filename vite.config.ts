// FILE: vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
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
