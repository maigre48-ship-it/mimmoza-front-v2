// src/lib/studioConfig.test.ts
// LIAISON 03/11/2026 — Studio est TOUJOURS ouvert à la même origine que la page sur un domaine public.
// Panne : VITE_MIMMOZIA_STUDIO_URL=https://mimmozia-studio-preview.vercel.app chargeait Studio sur une
// autre origine (messages refusés, « Ouverture de Studio… » sans fin). Lancement : npm test.
import assert from "node:assert/strict";
import test from "node:test";
import { adresseConfigureeIgnoree, ErreurStudio3D, resoudreUrlStudio, type PageStudio } from "./studioConfig.ts";

const PROD: PageStudio = { origin: "https://mimmoza.vercel.app", hostname: "mimmoza.vercel.app" };
const PREVIEW: PageStudio = { origin: "https://mimmoza-git-correctifs-mimmoza.vercel.app", hostname: "mimmoza-git-correctifs-mimmoza.vercel.app" };
const LOCAL: PageStudio = { origin: "http://localhost:5173", hostname: "localhost" };

test("Studio (domaine public) : sans configuration, <origine de la page>/studio/", () => {
  assert.equal(resoudreUrlStudio(undefined, PROD), "https://mimmoza.vercel.app/studio/");
  assert.equal(resoudreUrlStudio("   ", PREVIEW), `${PREVIEW.origin}/studio/`);
});

test("Studio (domaine public) : l'adresse technique d'une autre origine est IGNORÉE (panne du 03/11)", () => {
  for (const c of [
    "https://mimmozia-studio-preview.vercel.app",
    "https://mimmozia-studio-preview.vercel.app/",
    "https://mimmozia-studio.vercel.app/studio/",
    "https://mimmozia-studio-73ay8dn8i-mimmoza.vercel.app/studio/?x=1#y",
    "https://studio.mimmoza.fr/",
  ]) {
    assert.equal(resoudreUrlStudio(c, PROD), "https://mimmoza.vercel.app/studio/", c);
    assert.equal(resoudreUrlStudio(c, PREVIEW), `${PREVIEW.origin}/studio/`, c);
    assert.equal(adresseConfigureeIgnoree(c, PROD), true, c);
  }
});

test("Studio (domaine public) : adresse locale, http, invalide ou protocole-relatif -> même origine, jamais d'erreur", () => {
  for (const c of ["http://localhost:5174", "https://127.0.0.1:5173", "http://mimmoza.vercel.app/studio/", "studio.mimmoza.fr", "ftp://x.fr", "//evil.example/studio/", "pas une url"]) {
    assert.equal(resoudreUrlStudio(c, PROD), "https://mimmoza.vercel.app/studio/", c);
    assert.equal(adresseConfigureeIgnoree(c, PROD), true, c);
  }
});

test("Studio (domaine public) : une adresse de la MÊME origine ou un chemin est gardé", () => {
  assert.equal(resoudreUrlStudio("https://mimmoza.vercel.app/studio/#ancre", PROD), "https://mimmoza.vercel.app/studio/");
  assert.equal(resoudreUrlStudio("https://mimmoza.vercel.app/studio-b/", PROD), "https://mimmoza.vercel.app/studio-b/");
  assert.equal(resoudreUrlStudio("/studio/", PROD), "https://mimmoza.vercel.app/studio/");
  assert.equal(resoudreUrlStudio("/studio/", PREVIEW), `${PREVIEW.origin}/studio/`);
  assert.equal(adresseConfigureeIgnoree("/studio/", PROD), false);
  assert.equal(adresseConfigureeIgnoree("https://mimmoza.vercel.app/studio/", PROD), false);
  assert.equal(adresseConfigureeIgnoree(undefined, PROD), false);
});

test("Studio (poste local) : développement localhost <-> localhost respecté", () => {
  assert.equal(resoudreUrlStudio(undefined, LOCAL), "http://localhost:5173/studio/");
  assert.equal(resoudreUrlStudio("http://localhost:5174", LOCAL), "http://localhost:5174/");
  assert.equal(resoudreUrlStudio("http://127.0.0.1:5174/studio/", LOCAL), "http://127.0.0.1:5174/studio/");
  assert.equal(resoudreUrlStudio(undefined, null), "http://localhost:5173/studio/");
  assert.equal(adresseConfigureeIgnoree("http://localhost:5174", LOCAL), false);
});

test("Studio (poste local) : une adresse invalide est signalée au développeur", () => {
  assert.throws(() => resoudreUrlStudio("pas une url", LOCAL), ErreurStudio3D);
  assert.throws(() => resoudreUrlStudio("ftp://x.fr", null), /invalide/);
});
