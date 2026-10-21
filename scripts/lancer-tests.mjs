// scripts/lancer-tests.mjs
// =============================================================================
// Lance les tests unitaires du front avec le lanceur intégré de Node
// (node --test, suppression des types TypeScript native depuis Node 22.18).
//
// Fichiers pris : src/**/*.test.ts et middleware.test.ts.
// Fichiers ÉCARTÉS : ceux qui importent « vitest » (vitest n'est pas installé
// dans le dépôt) — ils sont listés à l'écran pour ne pas être oubliés.
// Les tests des Edge Functions (supabase/functions/**) se lancent avec Deno.
//
// Usage : npm test
// =============================================================================

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const racine = process.cwd();

function lister(dossier, acc = []) {
  for (const nom of readdirSync(dossier)) {
    if (nom === "node_modules" || nom.startsWith(".")) continue;
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) lister(chemin, acc);
    else if (nom.endsWith(".test.ts")) acc.push(chemin);
  }
  return acc;
}

const candidats = [...lister(join(racine, "src")), join(racine, "middleware.test.ts")];
const retenus = [];
const ecartes = [];
for (const f of candidats) {
  const source = readFileSync(f, "utf8");
  (/from\s+["']vitest["']/.test(source) ? ecartes : retenus).push(relative(racine, f));
}

if (ecartes.length) {
  console.log(`Tests vitest ignorés (vitest non installé) : ${ecartes.length}`);
  for (const f of ecartes) console.log("   - " + f);
}
console.log(`Tests node --test : ${retenus.length} fichiers\n`);

const r = spawnSync(process.execPath, ["--test", ...retenus], { stdio: "inherit" });
process.exit(r.status ?? 1);
