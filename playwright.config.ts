// playwright.config.ts
// =============================================================================
// Tests de bout en bout (Playwright) — dossier e2e/. Mode d'emploi : e2e/README.md
//
// Variables d'environnement :
//   E2E_BASE_URL        URL visée (défaut http://localhost:5173 = `npm run dev`).
//                       Ex. aperçu Vercel : https://mimmoza-git-xxx.vercel.app
//   E2E_BASIC_USER      Identifiant Basic auth (aperçus Vercel protégés par middleware.ts)
//   E2E_BASIC_PASSWORD  Mot de passe Basic auth
//   E2E_EMAIL           Compte de test EXISTANT pour le parcours connecté (sinon : ignoré)
//   E2E_PASSWORD        Mot de passe de ce compte
//   E2E_CHROMIUM_PATH   Chrome/Chromium déjà installé à utiliser au lieu de celui de Playwright
// =============================================================================

import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

const httpCredentials =
  process.env.E2E_BASIC_USER && process.env.E2E_BASIC_PASSWORD
    ? { username: process.env.E2E_BASIC_USER, password: process.env.E2E_BASIC_PASSWORD }
    : undefined;

const launchOptions = process.env.E2E_CHROMIUM_PATH
  ? { executablePath: process.env.E2E_CHROMIUM_PATH }
  : {};

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./node_modules/.e2e-resultats",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "node_modules/.e2e-rapport", open: "never" }]],
  use: {
    baseURL,
    httpCredentials,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "bureau",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], launchOptions },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      // iPhone 12-15 : 390 px de large. Moteur Chromium (seul navigateur installé).
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        launchOptions,
      },
    },
  ],
});
