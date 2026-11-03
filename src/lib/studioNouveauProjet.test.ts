import assert from "node:assert/strict";
import test from "node:test";
import {
  LONGUEUR_MAX_RETOUR,
  RETOUR_PAR_DEFAUT,
  adresseNouveauProjetStudio,
  cheminRetourMimmoza,
} from "./studioNouveauProjet.ts";

const CONV = "0b7c9a52-3f1e-4c55-9d0a-2b8e1f6a7c33";

test("Studio 3D (retour) : la page courante est retrouvée telle quelle, paramètres compris", () => {
  assert.equal(cheminRetourMimmoza("/promoteur/bilan-promoteur", "?study=abc"), "/promoteur/bilan-promoteur?study=abc");
  assert.equal(cheminRetourMimmoza("/veille", ""), "/veille");
});

test("Studio 3D (retour) : sur MimmozIA, la conversation ouverte est rattachée", () => {
  assert.equal(cheminRetourMimmoza("/mimmozia", "", CONV), `/mimmozia?conversation=${CONV}`);
  assert.equal(cheminRetourMimmoza("/mimmozia", "?conversation=ancienne", CONV), `/mimmozia?conversation=${CONV}`);
  assert.equal(cheminRetourMimmoza("/mimmozia", "", "pas-un-uuid"), "/mimmozia");
  // Hors MimmozIA, la conversation n'est pas ajoutée (la page a son propre état).
  assert.equal(cheminRetourMimmoza("/veille", "", CONV), "/veille");
});

test("Studio 3D (retour) : jamais Studio, la connexion, la vitrine ni une adresse étrangère", () => {
  for (const p of ["/studio/", "/studio", "/connexion", "/connexion/oubli", "/", "//evil.example/x", "https://evil.example/", "/a\\b", ""]) {
    assert.equal(cheminRetourMimmoza(p, "?x=1"), RETOUR_PAR_DEFAUT, p);
  }
  assert.equal(cheminRetourMimmoza("/studioX", ""), "/studioX");
});

test("Studio 3D (retour) : une adresse démesurée retombe sur l'accueil MimmozIA", () => {
  assert.equal(cheminRetourMimmoza("/veille", "?q=" + "x".repeat(LONGUEUR_MAX_RETOUR)), RETOUR_PAR_DEFAUT);
});

test("Studio 3D (adresse) : nouveau projet + retour, même origine, sans ancre", () => {
  const href = adresseNouveauProjetStudio("https://mimmoza.vercel.app/studio/", `/mimmozia?conversation=${CONV}`);
  const url = new URL(href);
  assert.equal(url.origin, "https://mimmoza.vercel.app");
  assert.equal(url.pathname, "/studio/");
  assert.equal(url.searchParams.get("nouveau"), "1");
  assert.equal(url.searchParams.get("retour"), `/mimmozia?conversation=${CONV}`);
  assert.equal(url.hash, "");
  assert.equal(new URL(adresseNouveauProjetStudio("http://localhost:5173/studio/#projet=x", "/veille")).hash, "");
});
