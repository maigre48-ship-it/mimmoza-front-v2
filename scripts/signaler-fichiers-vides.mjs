// scripts/signaler-fichiers-vides.mjs
// =============================================================================
// Signale les fichiers de 0 octet du dépôt (audit du 21/10/2026, P0 n°6).
//
// Les migrations de facturation 001_billing.sql, api_keys.sql,
// 20260831_full_baseline.sql (et src/lib/billing/billing_schema.sql) sont
// VIDES : leur contenu n'a jamais été versionné. Le dépôt ne permet donc pas
// de reconstruire la base. Ce script les liste ; il ne peut pas les remplir.
//
// Pour les régénérer depuis la production (à lancer par l'utilisateur) :
//   supabase db dump --linked --schema public -f supabase/migrations/20260831_full_baseline.sql
// (ou, sans CLI : tableau de bord Supabase → Database → Backups, ou
//  pg_dump --schema-only --schema=public "<chaîne de connexion>")
//
// Usage : npm run verifier:vides      (code de sortie 1 si une migration SQL est vide)
// =============================================================================

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RACINE = process.cwd();
const IGNORES = new Set(["node_modules", ".git", "dist", "_drafts", ".vercel"]);

function parcourir(dossier, resultats = []) {
  for (const nom of readdirSync(dossier)) {
    if (IGNORES.has(nom)) continue;
    const chemin = join(dossier, nom);
    const info = statSync(chemin);
    if (info.isDirectory()) parcourir(chemin, resultats);
    else if (info.size === 0) resultats.push(relative(RACINE, chemin).replaceAll("\\", "/"));
  }
  return resultats;
}

const vides = parcourir(RACINE).sort();
const sqlVides = vides.filter((f) => f.endsWith(".sql"));
const autres = vides.filter((f) => !f.endsWith(".sql"));

if (sqlVides.length) {
  console.error("⚠ Fichiers SQL de 0 octet (schéma non versionné) :");
  for (const f of sqlVides) console.error("   - " + f);
  console.error(
    "\n→ Régénérer le schéma : supabase db dump --linked --schema public " +
      "-f supabase/migrations/20260831_full_baseline.sql\n",
  );
}
if (autres.length) {
  console.log("Autres fichiers de 0 octet (" + autres.length + ") :");
  for (const f of autres) console.log("   - " + f);
}
if (!vides.length) console.log("Aucun fichier de 0 octet.");

process.exit(sqlVides.length ? 1 : 0);
