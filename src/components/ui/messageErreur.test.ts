import assert from "node:assert/strict";
import { test } from "node:test";

import { estMessageLisible, messageErreur } from "./messageErreur.ts";

test("un message français déjà rédigé est conservé", () => {
  assert.equal(
    messageErreur(new Error("Ce deal a déjà été débloqué par un autre promoteur."), "Le déblocage a échoué."),
    "Ce deal a déjà été débloqué par un autre promoteur.",
  );
});

test("les messages techniques sont remplacés par le repli", () => {
  for (const brut of [
    "HTTP 500",
    "duplicate key value violates unique constraint \"watch_pkey\"",
    "Cannot read properties of undefined (reading 'map')",
    "Edge Function returned a non-2xx status code",
    "plu-parser → HTTP 404",
    "invalid input syntax for type uuid",
    "rate_limited",
  ]) {
    assert.equal(estMessageLisible(brut), false, brut);
    assert.equal(messageErreur(new Error(brut), "Chargement impossible."), "Chargement impossible.");
  }
});

test("une cause connue précise le repli", () => {
  assert.equal(
    messageErreur(new TypeError("Failed to fetch"), "Chargement impossible."),
    "Chargement impossible. Le service n'a pas pu être joint. Vérifiez votre connexion internet puis réessayez.",
  );
  assert.equal(
    messageErreur({ message: "JWT expired" }, "Création impossible"),
    "Création impossible. Votre session a expiré. Reconnectez-vous puis réessayez.",
  );
});

test("valeurs non erreurs", () => {
  assert.equal(messageErreur(undefined, "Action impossible."), "Action impossible.");
  assert.equal(messageErreur("Adresse introuvable.", "Action impossible."), "Adresse introuvable.");
});
