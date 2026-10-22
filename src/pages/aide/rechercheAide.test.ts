import assert from "node:assert/strict";
import { test } from "node:test";

import { correspond, normaliser } from "./rechercheAide.ts";

test("normaliser retire accents, apostrophes et majuscules", () => {
  assert.equal(normaliser("  Réhabilitation   d’un BÂTIMENT "), "rehabilitation d un batiment");
});

test("correspond : tous les mots doivent être présents, sans tenir compte des accents", () => {
  const texte = "Comment supprimer mon compte ? Paramètres avancés du compte";
  assert.equal(correspond(texte, "supprimer compte"), true);
  assert.equal(correspond(texte, "parametres avances"), true);
  assert.equal(correspond(texte, "supprimer jetons"), false);
  assert.equal(correspond(texte, "   "), true);
});
