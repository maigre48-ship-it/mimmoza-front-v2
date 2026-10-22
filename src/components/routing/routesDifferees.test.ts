// src/components/routing/routesDifferees.test.ts
// =============================================================================
// Garde-fou des pages chargées à la demande (src/App.tsx).
//
// Un chemin faux dans un import dynamique ne se voit qu'au moment où l'on
// ouvre la page (écran d'erreur en production). Ce test résout CHAQUE import
// dynamique déclaré par differer(...) dans App.tsx, vérifie que le fichier
// existe et qu'il exporte bien le composant demandé (défaut ou nommé).
//
// Il vérifie aussi que la page d'entrée « / » (ConnexionPage) reste le SEUL
// import statique de page : toute autre page importée statiquement serait
// téléchargée par chaque visiteur de « / ».
//
// Lancement : npm test (node --test).
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(ICI, "..", "..");
const APP = join(SRC, "App.tsx");
const source = readFileSync(APP, "utf8");

type Declaration = { composant: string; specificateur: string; exportNom: string };

/** Chargeurs partagés : const chargerX = () => import("…"); */
function chargeursNommes(): Map<string, string> {
  const carte = new Map<string, string>();
  const re = /const\s+(\w+)\s*=\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of source.matchAll(re)) carte.set(m[1], m[2]);
  return carte;
}

function declarations(): Declaration[] {
  const chargeurs = chargeursNommes();
  const liste: Declaration[] = [];
  const reDirect = /const\s+(\w+)\s*=\s*differer\(\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)\s*,\s*["'](\w+)["']\s*\)/g;
  for (const m of source.matchAll(reDirect)) liste.push({ composant: m[1], specificateur: m[2], exportNom: m[3] });
  const reChargeur = /const\s+(\w+)\s*=\s*differer\(\s*(\w+)\s*,\s*["'](\w+)["']\s*\)/g;
  for (const m of source.matchAll(reChargeur)) {
    const specificateur = chargeurs.get(m[2]);
    assert.ok(specificateur, `Chargeur « ${m[2]} » introuvable pour ${m[1]}`);
    liste.push({ composant: m[1], specificateur, exportNom: m[3] });
  }
  return liste;
}

function resoudre(specificateur: string): string | null {
  const base = specificateur.startsWith("@/")
    ? join(SRC, specificateur.slice(2))
    : resolve(dirname(APP), specificateur);
  const candidats = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    join(base, "index.tsx"),
    join(base, "index.ts"),
  ];
  for (const c of candidats) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

function exporte(fichier: string, nom: string, profondeur = 0): boolean {
  const texte = readFileSync(fichier, "utf8");
  if (nom === "default") {
    if (/export\s+default\b/.test(texte)) return true;
    if (/export\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(texte)) return true;
    return false;
  }
  const direct = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|class)\\s+${nom}\\b`);
  if (direct.test(texte)) return true;
  // export { X } / export { X } from "./Y" / export { default as X } from "./Y"
  const reListe = /export\s*\{([^}]*)\}\s*(?:from\s*["']([^"']+)["'])?/g;
  for (const m of texte.matchAll(reListe)) {
    const elements = m[1].split(",").map((e) => e.trim()).filter(Boolean);
    for (const el of elements) {
      const [origine, alias] = el.split(/\s+as\s+/).map((x) => x.trim());
      if ((alias ?? origine) !== nom) continue;
      if (!m[2]) return true; // export local
      if (profondeur > 3) return true;
      const cible = resoudre(resolve(dirname(fichier), m[2]));
      return cible !== null && exporte(cible, origine, profondeur + 1);
    }
  }
  return false;
}

describe("App.tsx — pages chargées à la demande", () => {
  const liste = declarations();

  it("déclare un nombre plausible de pages différées", () => {
    assert.ok(liste.length >= 80, `seulement ${liste.length} pages différées trouvées : l'analyse de App.tsx a-t-elle cassé ?`);
  });

  it("chaque import dynamique pointe vers un fichier existant qui exporte le composant", () => {
    const erreurs: string[] = [];
    for (const d of liste) {
      const fichier = resoudre(d.specificateur);
      if (!fichier) {
        erreurs.push(`${d.composant} : fichier introuvable pour « ${d.specificateur} »`);
        continue;
      }
      if (!exporte(fichier, d.exportNom)) {
        erreurs.push(`${d.composant} : « ${d.specificateur} » n'exporte pas « ${d.exportNom} »`);
      }
    }
    assert.deepEqual(erreurs, []);
  });

  it("chaque page différée est utilisée dans une route (pas de déclaration morte)", () => {
    const inutilisees = liste
      .map((d) => d.composant)
      .filter((nom) => !new RegExp(`<${nom}[\\s/>]`).test(source));
    assert.deepEqual(inutilisees, []);
  });

  it("la page d'entrée « / » est le seul import statique de page", () => {
    const statiques = [...source.matchAll(/^import\s+[^;]*?from\s+["']([^"']+)["']/gm)]
      .map((m) => m[1])
      .filter((s) => !s.startsWith("./components/"))
      .filter((s) => /\/pages\/|Page$|Layout$/.test(s));
    assert.deepEqual(statiques, ["./spaces/particulier/pages/ConnexionPage"]);
  });
});
