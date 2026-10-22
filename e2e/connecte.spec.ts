// e2e/connecte.spec.ts — parcours d'un utilisateur CONNECTÉ (le parcours qui rapporte).
//
// Nécessite un compte de test EXISTANT : E2E_EMAIL et E2E_PASSWORD.
// Sans ces variables, les tests sont ignorés (skip) avec un message explicite.
// ⚠️ Ne jamais créer de compte de test en production depuis ces scénarios.
// ⚠️ L'analyse rapide consomme une analyse du quota mensuel du compte de test.

import { expect, test, type Page } from "@playwright/test";
import { attendrePageSaine, surveillerErreurs } from "./outils";

const EMAIL = process.env.E2E_EMAIL;
const MOT_DE_PASSE = process.env.E2E_PASSWORD;

/** Adresse fixe (bâtiment public, Paris 4e) : résultats stables d'un passage à l'autre. */
const ADRESSE = { adresse: "2 place de l'Hôtel de Ville", ville: "Paris", cp: "75004", surface: "72", prix: "650000" };

test.describe("Utilisateur connecté", () => {
  test.skip(
    !EMAIL || !MOT_DE_PASSE,
    "Parcours connecté ignoré : définir E2E_EMAIL et E2E_PASSWORD (compte de test existant) pour l'exécuter.",
  );

  async function seConnecter(page: Page) {
    await page.goto("/");
    await page.getByPlaceholder("nom@exemple.com").fill(EMAIL!);
    await page.getByPlaceholder("Votre mot de passe").fill(MOT_DE_PASSE!);
    await page.getByRole("button", { name: "Se connecter" }).click();
    // /accueil redirige vers /mimmozia (ou /dashboard en mode expert).
    await expect(page).toHaveURL(/\/(mimmozia|dashboard)/, { timeout: 30_000 });
  }

  test("connexion puis page MimmozIA", async ({ page }) => {
    const surveillance = surveillerErreurs(page);
    await seConnecter(page);
    await page.goto("/mimmozia");
    await expect(page.getByPlaceholder("Écrivez ou dictez votre message…")).toBeVisible();
    await attendrePageSaine(page);
    surveillance.verifier();
  });

  test("analyse rapide sur une adresse fixe, résultat puis export PDF", async ({ page }) => {
    test.setTimeout(180_000);
    await seConnecter(page);
    await page.goto("/analyse-rapide");

    await page.getByPlaceholder("6 Parc de la Bérengère").fill(ADRESSE.adresse);
    await page.getByPlaceholder("Saint-Cloud").fill(ADRESSE.ville);
    await page.getByPlaceholder("92210").fill(ADRESSE.cp);
    await page.getByPlaceholder("65", { exact: true }).fill(ADRESSE.surface);
    await page.getByPlaceholder("520000").fill(ADRESSE.prix);
    await page.getByRole("button", { name: /Lancer l'analyse/ }).click();

    // Le résultat est prêt quand le bouton d'export apparaît.
    const exportPdf = page.getByRole("button", { name: /Export PDF/ });
    await expect(exportPdf).toBeVisible({ timeout: 120_000 });

    // L'export ouvre une fenêtre d'impression (window.open + print) : on l'intercepte.
    const [fenetre] = await Promise.all([page.waitForEvent("popup"), exportPdf.click()]);
    await fenetre.waitForLoadState("domcontentloaded");
    await expect(fenetre.locator("body")).toContainText(/Paris|75004/);
    await fenetre.close();
  });

  test("le menu des formules s'ouvre et liste les 4 formules", async ({ page }) => {
    await seConnecter(page);
    await page.goto("/dashboard");
    const declencheur = page.locator("button.mzia-sub__trigger");
    await expect(declencheur).toBeVisible();
    await declencheur.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".mzia-sub__name")).toHaveCount(4);
  });
});
