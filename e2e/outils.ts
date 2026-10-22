// e2e/outils.ts — aides partagées par les scénarios Playwright.

import { expect, type Page } from "@playwright/test";

/**
 * Surveille la page : erreurs JavaScript non rattrapées et morceaux JS
 * (chargement différé des pages) qui échouent à se télécharger.
 * Appeler AVANT page.goto, puis `verifier()` en fin de test.
 */
export function surveillerErreurs(page: Page) {
  const erreurs: string[] = [];
  page.on("pageerror", (e) => erreurs.push(`Erreur JS : ${e.message}`));
  page.on("requestfailed", (r) => {
    const url = r.url();
    // Seuls nos propres fichiers comptent (pas les API tierces, coupées en local).
    if (/\/assets\/.+\.(js|css)$/.test(new URL(url).pathname)) {
      erreurs.push(`Fichier non chargé : ${url} (${r.failure()?.errorText ?? "?"})`);
    }
  });
  return {
    verifier: () => expect(erreurs, erreurs.join("\n")).toEqual([]),
  };
}

/** La page ne doit montrer ni l'écran d'erreur global ni la 404. */
export async function attendrePageSaine(page: Page) {
  await expect(page.getByRole("heading", { name: "Un problème est survenu" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toHaveCount(0);
}

/** Largeur du document comparée à la fenêtre : > 0 = défilement horizontal. */
export async function debordementHorizontal(page: Page): Promise<{ debord: number; coupables: string[] }> {
  return page.evaluate(() => {
    const largeur = document.documentElement.clientWidth;
    const debord = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - largeur;
    const coupables: string[] = [];
    if (debord > 0) {
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
        const r = el.getBoundingClientRect();
        if (r.right > largeur + 1 && r.width > 0) {
          const id = el.id ? `#${el.id}` : "";
          const classes = typeof el.className === "string" ? `.${el.className.split(/\s+/).slice(0, 3).join(".")}` : "";
          coupables.push(`${el.tagName.toLowerCase()}${id}${classes} (droite ${Math.round(r.right)} px)`);
          if (coupables.length >= 8) break;
        }
      }
    }
    return { debord, coupables };
  });
}
