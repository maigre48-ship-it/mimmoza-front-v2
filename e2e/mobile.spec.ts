// e2e/mobile.spec.ts — affichage mobile (390 px) : aucun défilement horizontal.

import { expect, test } from "@playwright/test";
import { attendrePageSaine, debordementHorizontal } from "./outils";

const PAGES: ReadonlyArray<[chemin: string, attendre: string]> = [
  ["/", "Analyser gratuitement"],
  ["/tarifs", "Des formules simples"],
  ["/decouvrir", ""],
];

for (const [chemin, texte] of PAGES) {
  test(`${chemin} : pas de défilement horizontal à 390 px`, async ({ page }) => {
    await page.goto(chemin);
    if (texte) await expect(page.getByText(texte).first()).toBeVisible();
    else await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await attendrePageSaine(page);
    await page.waitForLoadState("networkidle");

    const { debord, coupables } = await debordementHorizontal(page);
    expect(debord, `La page déborde de ${debord} px. Éléments en cause :\n${coupables.join("\n")}`).toBeLessThanOrEqual(0);
  });
}
