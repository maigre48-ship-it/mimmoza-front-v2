/**
 * Import de la grille communale de densité INSEE (millésime 1er janvier 2026)
 * dans la table public.insee_grille_densite.
 *
 * Pourquoi : la frontière urbain / rural pilote l'inclusion du pilier
 * accessibilité dans le scoring marché. Elle reposait sur un seuil maison
 * (densité >= 400 hab./km²). La grille INSEE est officielle, stable et
 * opposable — c'est une meilleure source de vérité.
 *
 * Source : https://www.insee.fr/fr/information/8571524
 *
 * Usage :
 *   npx tsx supabase/scripts/import_grille_densite.ts --inspect   # voir la structure du fichier
 *   npx tsx supabase/scripts/import_grille_densite.ts             # importer
 *
 * Dépendance : npm i -D xlsx
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const INSPECT = process.argv.includes("--inspect");

// Plusieurs emplacements possibles selon d'où le script est lancé.
for (const p of [
  "C:/Users/maigr/OneDrive/Bureau/supabase-backend/.env",
  ".env.local",
  ".env",
]) {
  dotenv.config({ path: p });
}

// Les noms de variables diffèrent d'un projet à l'autre — on accepte les alias
// courants plutôt que d'échouer sur une convention de nommage.
const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  null;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  null;

if (!INSPECT && (!SUPABASE_URL || !SERVICE_KEY)) {
  // On liste les NOMS de variables vues (jamais les valeurs) pour diagnostiquer.
  const vues = Object.keys(process.env)
    .filter((k) => /SUPABASE|SERVICE_ROLE/i.test(k))
    .sort();
  throw new Error(
    "❌ Identifiants Supabase introuvables.\n" +
      `   URL      : ${SUPABASE_URL ? "ok" : "manquante"}\n` +
      `   clé      : ${SERVICE_KEY ? "ok" : "manquante"}\n` +
      `   variables Supabase visibles : ${vues.length ? vues.join(", ") : "aucune"}\n` +
      "   Attendu : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (ou alias VITE_/NEXT_PUBLIC_).\n" +
      "   Astuce : `--inspect` fonctionne sans identifiants."
  );
}

const supabase =
  SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null;

const MILLESIME = 2026;
const FILE_URL =
  "https://www.insee.fr/fr/statistiques/fichier/8571524/fichier_diffusion_2026.xlsx";

// ---------------------------------------------------------------------------
// Les fichiers INSEE ont un préambule de quelques lignes avant l'en-tête réel,
// et les noms de colonnes varient d'un millésime à l'autre. On détecte plutôt
// que de coder en dur : un import silencieusement décalé serait pire qu'un
// import qui échoue bruyamment.
// ---------------------------------------------------------------------------

type Grid = unknown[][];

function findHeaderRow(grid: Grid): number {
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const row = (grid[i] ?? []).map((c) => String(c ?? "").trim().toUpperCase());
    if (row.some((c) => /^(CODGEO|CODE_COMMUNE|CODE INSEE|DEPCOM)$/.test(c))) return i;
  }
  return -1;
}

function findCol(header: string[], patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = header.findIndex((h) => p.test(h));
    if (i !== -1) return i;
  }
  return -1;
}

async function main() {
  console.log(`📥 Téléchargement — ${FILE_URL}`);
  const res = await fetch(FILE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${FILE_URL}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });

  console.log(`📄 Feuilles : ${wb.SheetNames.join(" | ")}`);

  // On retient la première feuille dont l'en-tête contient un code commune
  // ET qui compte assez de lignes pour être la composition communale
  // (~35 000 communes) — les autres feuilles agrègent par EPCI / département.
  let sheetName: string | null = null;
  let grid: Grid = [];
  let headerRow = -1;

  for (const name of wb.SheetNames) {
    const g = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1,
      raw: true,
      blankrows: false,
    }) as Grid;
    const hr = findHeaderRow(g);
    if (hr === -1) continue;

    if (INSPECT) {
      console.log(`\n— feuille « ${name} » : ${g.length} lignes, en-tête ligne ${hr + 1}`);
      console.log(`  colonnes : ${(g[hr] ?? []).map((c) => String(c ?? "")).join(" | ")}`);
      console.log(`  exemple  : ${(g[hr + 1] ?? []).map((c) => String(c ?? "")).join(" | ")}`);
    }

    if (g.length > 30000 && sheetName === null) {
      sheetName = name;
      grid = g;
      headerRow = hr;
    }
  }

  if (INSPECT) {
    console.log("\n🔎 Mode inspection — aucune écriture. Relancez sans --inspect pour importer.");
    return;
  }

  if (!sheetName) {
    throw new Error(
      "❌ Aucune feuille de composition communale trouvée (> 30 000 lignes). " +
        "Relancez avec --inspect pour voir la structure du fichier."
    );
  }

  const header = (grid[headerRow] ?? []).map((c) => String(c ?? "").trim().toUpperCase());

  const iCode = findCol(header, [/^(CODGEO|CODE_COMMUNE|CODE INSEE|DEPCOM)$/]);
  const iLib = findCol(header, [/^(LIBGEO|LIB_COMMUNE|NOM)$/, /LIB/]);
  const iDep = findCol(header, [/^(DEP|DEPT|DEPARTEMENT|CODE_DEP)$/]);
  // Niveau 1 de la grille : 1 dense / 2 intermédiaire / 3 rural
  const iN3 = findCol(header, [/^(DENS|DENSITE|GRIDENS|TYPO_DENS)$/, /^DENS[^7]*$/]);
  // Subdivision à 7 niveaux (colonne DENS7) et son libellé (LIBDENS7)
  const iN7 = findCol(header, [/^DENS7$/, /7/]);
  const iLibN7 = findCol(header, [/^LIBDENS7$/]);

  console.log(
    `\n📊 Feuille retenue : « ${sheetName} » (${grid.length - headerRow - 1} lignes)\n` +
      `   code=${header[iCode]} libellé=${header[iLib]} dep=${header[iDep]} ` +
      `niveau3=${header[iN3]} niveau7=${header[iN7]}`
  );

  if (iCode === -1 || iN3 === -1) {
    throw new Error(
      "❌ Colonnes code commune ou niveau de densité introuvables. " +
        "Relancez avec --inspect et ajustez les motifs de findCol()."
    );
  }

  const rows: Record<string, unknown>[] = [];

  for (let i = headerRow + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const code = String(r[iCode] ?? "").trim();
    if (!/^[0-9AB]{5}$/i.test(code)) continue; // ignore totaux et lignes de garde

    const n3 = Number(r[iN3]);
    const n7 = iN7 !== -1 ? Number(r[iN7]) : NaN;

    const codeUp = code.toUpperCase();

    // Le fichier « Maille communale » ne porte pas de colonne département :
    // on le dérive du code commune. Outre-mer sur 3 caractères (971xx…),
    // Corse sur 2 mais alphanumérique (2A / 2B).
    const dep =
      iDep !== -1 && String(r[iDep] ?? "").trim()
        ? String(r[iDep]).trim()
        : codeUp.startsWith("97")
          ? codeUp.slice(0, 3)
          : codeUp.slice(0, 2);

    rows.push({
      code_insee: codeUp,
      libelle: iLib !== -1 ? String(r[iLib] ?? "").trim() || null : null,
      departement: dep,
      niveau_3: Number.isFinite(n3) ? n3 : null,
      niveau_7: Number.isFinite(n7) ? n7 : null,
      libelle_niveau_7:
        iLibN7 !== -1 ? String(r[iLibN7] ?? "").trim() || null : null,
      millesime: MILLESIME,
    });
  }

  console.log(`➡️ ${rows.length} communes à importer`);

  if (rows.length < 30000) {
    throw new Error(
      `❌ Seulement ${rows.length} communes extraites — la France en compte ~34 900. ` +
        "Import interrompu : mieux vaut pas de données que des données partielles."
    );
  }

  if (!supabase) throw new Error("❌ Client Supabase non initialisé.");

  const CHUNK = 1000;
  let done = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("insee_grille_densite")
      .upsert(slice, { onConflict: "code_insee" });

    if (error) {
      console.error(`❌ Supabase error (lot ${i / CHUNK + 1}) :`, error.message);
      process.exitCode = 1;
      return;
    }

    done += slice.length;
    console.log(`✅ ${done} / ${rows.length}`);
  }

  // Contrôle : Ascain (64065) doit ressortir en rural (niveau_3 = 3).
  const { data: check } = await supabase
    .from("insee_grille_densite")
    .select("code_insee, libelle, niveau_3, niveau_7")
    .eq("code_insee", "64065")
    .maybeSingle();

  console.log(`\n🎯 Import terminé — ${done} communes, millésime ${MILLESIME}`);
  console.log("🔍 Contrôle Ascain (64065) :", check ?? "introuvable");
}

main();
