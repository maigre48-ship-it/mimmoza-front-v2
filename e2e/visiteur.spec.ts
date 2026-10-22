// e2e/visiteur.spec.ts — parcours d'un visiteur NON connecté (aucun compte créé).

import { expect, test } from "@playwright/test";
import { attendrePageSaine, surveillerErreurs } from "./outils";

test.describe("Visiteur — page d'entrée « / »", () => {
  test("s'affiche avec le formulaire d'analyse express et la connexion Pro", async ({ page }) => {
    const surveillance = surveillerErreurs(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: /Achetez votre prochain bien/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lancez votre analyse express" })).toBeVisible();
    await expect(page.getByLabel("Adresse")).toBeVisible();
    await expect(page.getByLabel("Type de bien")).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyser gratuitement" })).toBeVisible();
    await expect(page.getByPlaceholder("nom@exemple.com")).toBeVisible();
    await expect(page).toHaveTitle(/Mimmoza/);

    surveillance.verifier();
  });

  test("l'analyse express d'un visiteur mène à la création de compte gratuite", async ({ page }) => {
    await page.goto("/");
    // Formulaire incomplet : message d'erreur, pas de navigation.
    await page.getByRole("button", { name: "Analyser gratuitement" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    // Formulaire complet : le visiteur est envoyé vers l'inscription (aucun compte n'est créé ici).
    await page.getByLabel("Adresse").fill("12 rue de Rivoli");
    await page.getByPlaceholder("Paris").fill("Paris");
    await page.getByPlaceholder("75004").fill("75004");
    await page.getByPlaceholder("72").fill("72");
    await page.getByPlaceholder("450000").fill("450000");
    await page.getByLabel("Type de bien").selectOption("appartement");
    await page.getByRole("button", { name: "Analyser gratuitement" }).click();
    await expect(page).toHaveURL(/\/inscription/);
    await attendrePageSaine(page);
  });

  test("le lien « Découvrir Mimmoza » ouvre la présentation", async ({ page }) => {
    const surveillance = surveillerErreurs(page);
    await page.goto("/");
    await page.getByRole("link", { name: "Découvrir Mimmoza" }).first().click();
    await expect(page).toHaveURL(/\/decouvrir$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await attendrePageSaine(page);
    surveillance.verifier();
  });

  const LIENS_LEGAUX: ReadonlyArray<[libelle: RegExp, chemin: string, titre: RegExp]> = [
    [/^Mentions/i, "/mentions-legales", /Mentions L[ée]gales/i],
    [/^CGU$/i, "/cgu", /Conditions/i],
    [/^CGV$/i, "/cgv", /Conditions G[ée]n[ée]rales de Vente/i],
    [/confidentialit/i, "/politique-confidentialite", /Politique de Confidentialit/i],
  ];

  for (const [libelle, chemin, titre] of LIENS_LEGAUX) {
    test(`le lien légal ${chemin} répond`, async ({ page }) => {
      const surveillance = surveillerErreurs(page);
      await page.goto("/");
      await page.getByRole("navigation", { name: "Liens légaux" }).getByRole("link", { name: libelle }).click();
      await expect(page).toHaveURL(new RegExp(`${chemin}$`));
      await expect(page.getByRole("heading", { level: 1, name: titre })).toBeVisible();
      await attendrePageSaine(page);
      surveillance.verifier();
    });
  }
});

test.describe("Visiteur — /tarifs", () => {
  test("affiche les 4 formules et la grille du Studio 3D", async ({ page }) => {
    const surveillance = surveillerErreurs(page);
    await page.goto("/tarifs");
    await expect(page.getByRole("heading", { level: 1, name: /formules simples/i })).toBeVisible();

    // Noms des formules : src/lib/billing/grille.ts (FORMULES). À mettre à jour si la grille change.
    for (const nom of ["Découverte", "Indépendant", "Pro", "Équipe"]) {
      await expect(page.getByText(nom, { exact: true }).first(), `formule « ${nom} »`).toBeVisible();
    }

    const studio = page.locator("section#studio-3d");
    await expect(studio).toBeVisible();
    await expect(studio.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(page).toHaveTitle(/Tarifs/);
    surveillance.verifier();
  });
});

test.describe("Visiteur — /decouvrir", () => {
  test("la présentation s'affiche en entier", async ({ page }) => {
    const surveillance = surveillerErreurs(page);
    await page.goto("/decouvrir");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#vt-tarifs")).toBeVisible();
    await expect(page.locator("#vt-faq")).toBeVisible();
    await attendrePageSaine(page);
    surveillance.verifier();
  });
});

test.describe("Visiteur — chargement à la demande des pages publiques", () => {
  // Chaque page est un morceau JS séparé : on vérifie qu'il se télécharge et s'affiche.
  // (/api n'y figure pas : en local, `vite preview` relaie /api vers le runner du Studio.)
  const PAGES: ReadonlyArray<[chemin: string, titre: RegExp]> = [
    ["/decouvrir", /./],
    ["/tarifs", /formules/i],
    ["/inscription", /./],
    ["/aide", /aide/i],
    ["/securite", /S[ée]curit/i],
    ["/cgu", /Conditions/i],
    ["/mentions-legales", /Mentions/i],
  ];
  for (const [chemin, titre] of PAGES) {
    test(`${chemin} se charge sans erreur`, async ({ page }) => {
      const surveillance = surveillerErreurs(page);
      await page.goto(chemin);
      await expect(page.getByRole("heading", { level: 1, name: titre }).first()).toBeVisible();
      await attendrePageSaine(page);
      surveillance.verifier();
    });
  }

  test("une adresse inconnue affiche la vraie page 404", async ({ page }) => {
    await page.goto("/cette-page-n-existe-pas");
    await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
  });

  test("une page protégée renvoie un visiteur vers la connexion", async ({ page }) => {
    await page.goto("/mimmozia");
    await expect(page).not.toHaveURL(/\/mimmozia$/);
    await expect(page.getByPlaceholder("nom@exemple.com")).toBeVisible();
  });

  test("« / » ne télécharge pas le code des cartes, de la 3D ni des exports", async ({ page }) => {
    const fichiers: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "script") fichiers.push(new URL(r.url()).pathname);
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Analyser gratuitement" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const lourds = fichiers.filter((f) =>
      /lib-(three|maplibre|leaflet|graphiques|exceljs|xlsx|docx|pptx|pdf|pdfjs)-/.test(f),
    );
    expect(lourds, `bibliothèques lourdes chargées sur « / » : ${lourds.join(", ")}`).toEqual([]);
  });
});
