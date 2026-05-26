#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write

/**
 * Mimmoza – Import SNE IDF (DRIHL 2024)
 * ─────────────────────────────────────────────────────────────────────────────
 * Source : DRIHL Île-de-France – Socle de données demandes et attributions 2024
 * Page   : https://www.drihl.ile-de-france.developpement-durable.gouv.fr/
 *          socle-de-donnees-demandes-et-attributions-de-a1414.html
 *
 * Structure du fichier (analysée sur socle_sne_2024.xlsx) :
 *   Onglet cible : "Ensemble"
 *   Filtre       : col[0] == "Commune"  (exclut Région, Département, EPCI, EPT)
 *   1287 communes IDF
 *
 *   Mapping colonnes (0-indexé, confirmé) :
 *     [0]  Niveau géographique  → filtre "Commune"
 *     [1]  CODE                 → code_insee
 *     [2]  Nom                  → commune
 *     [3]  Code DEP             → departement
 *     [9]  Nb demandes 31/12    → demandes_en_attente
 *     [13] Nb attributions 2024 → attributions_annuelles
 *     [16] Demandes/attribution → tension_demande (DRIHL pré-calculé)
 *
 * Usage :
 *   deno run --allow-net --allow-env --allow-read --allow-write .\scripts\import_sne_idf.ts --file=.\scripts\socle_sne_2024.xlsx --dry-run
 *   deno run --allow-net --allow-env --allow-read --allow-write .\scripts\import_sne_idf.ts --file=.\scripts\socle_sne_2024.xlsx
 */

import * as XLSX from "https://esm.sh/xlsx@0.18.5";

// ─── Config ───────────────────────────────────────────────────────────────────

const SHEET_NAME = "Ensemble";
const DATA_START = 3;      // lignes 0-2 = sur-titres + en-têtes
const MILLESIME  = 2024;
const BATCH_SIZE = 200;

const COL = {
  niveau:       0,
  code:         1,
  nom:          2,
  codeDep:      3,
  demandes:     9,
  attributions: 13,
  tension:      16,
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface SneRow {
  code_insee:             string;
  commune:                string | null;
  departement:            string | null;
  demandes_en_attente:    number | null;
  attributions_annuelles: number | null;
  tension_demande:        number | null;
  millesime:              number;
  source:                 string;
  imported_at:            string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).replace(/\s/g, ""), 10);
  return isNaN(n) ? null : n;
}

function toFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? null : Number(n.toFixed(2));
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

async function upsertBatch(url: string, key: string, rows: SneRow[]): Promise<{ ok: number; err: number }> {
  const res = await fetch(`${url}/rest/v1/logements_sociaux_sne`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": key,
      "Authorization": `Bearer ${key}`,
      "Prefer": "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(`  [UPSERT] HTTP ${res.status} – ${(await res.text()).slice(0, 200)}`);
    return { ok: 0, err: rows.length };
  }
  return { ok: rows.length, err: 0 };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args      = Deno.args;
  const isDryRun  = args.includes("--dry-run");
  const fileArg   = args.find((a) => a.startsWith("--file="));
  const limitArg  = args.find((a) => a.startsWith("--limit="));
  const localFile = fileArg ? fileArg.split("=").slice(1).join("=") : null;
  const limit     = limitArg ? parseInt(limitArg.split("=")[1]) : Infinity;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!isDryRun && (!supabaseUrl || !serviceKey)) {
    console.error("❌  SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (ou --dry-run).");
    Deno.exit(1);
  }
  if (!localFile) {
    console.error("❌  --file=<chemin> requis. Exemple : --file=.\\scripts\\socle_sne_2024.xlsx");
    Deno.exit(1);
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Mimmoza – Import SNE IDF (DRIHL 2024)");
  if (isDryRun) console.log("  MODE DRY-RUN – aucune écriture en base");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── 1. Lecture ────────────────────────────────────────────────────────────
  console.log(`[1/4] Lecture : ${localFile}`);
  let fileBytes: Uint8Array;
  try {
    fileBytes = await Deno.readFile(localFile);
    console.log(`    ✓ ${Math.round(fileBytes.length / 1024)} Ko`);
  } catch (err) {
    console.error(`❌  ${err instanceof Error ? err.message : err}`);
    Deno.exit(1);
  }

  // ── 2. Parsing ────────────────────────────────────────────────────────────
  console.log(`\n[2/4] Parsing workbook…`);
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(fileBytes, { type: "array", cellDates: false });
  } catch (err) {
    console.error(`❌  Impossible de parser le xlsx : ${err instanceof Error ? err.message : err}`);
    Deno.exit(1);
  }
  console.log(`    ✓ Onglets : ${wb.SheetNames.join(" | ")}`);

  if (!wb.SheetNames.includes(SHEET_NAME)) {
    console.error(`❌  Onglet "${SHEET_NAME}" introuvable. Disponibles : ${wb.SheetNames.join(", ")}`);
    Deno.exit(1);
  }

  const allRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[SHEET_NAME], {
    header: 1,
    defval: null,
  });
  console.log(`    ✓ ${allRows.length} lignes dans "${SHEET_NAME}"`);

  // ── 3. Mapping ────────────────────────────────────────────────────────────
  console.log(`\n[3/4] Extraction lignes "Commune"…`);

  const importedAt = new Date().toISOString();
  const source = `DRIHL IDF – Socle demandes/attributions ${MILLESIME}`;
  const rows: SneRow[] = [];
  let skipped = 0;

  for (let i = DATA_START; i < allRows.length; i++) {
    if (rows.length >= limit) break;
    const row = allRows[i] as unknown[];
    if (!row || row[COL.niveau] !== "Commune") { skipped++; continue; }

    const raw = row[COL.code] != null
      ? String(row[COL.code]).trim().replace(/\.0$/, "").padStart(5, "0")
      : null;
    if (!raw || !/^\d{5}$/.test(raw)) { skipped++; continue; }

    const demandes     = toInt(row[COL.demandes]);
    const attributions = toInt(row[COL.attributions]);
    let   tension      = toFloat(row[COL.tension]);

    // Fallback calcul si DRIHL n'a pas fourni la tension (ex: attributions=0)
    if (tension === null && demandes !== null && attributions !== null && attributions > 0) {
      tension = Number((demandes / attributions).toFixed(2));
    }

    rows.push({
      code_insee:             raw,
      commune:                row[COL.nom] != null ? String(row[COL.nom]).trim() || null : null,
      departement:            row[COL.codeDep] != null ? String(row[COL.codeDep]).trim().replace(/\.0$/, "") || null : null,
      demandes_en_attente:    demandes,
      attributions_annuelles: attributions,
      tension_demande:        tension,
      millesime:              MILLESIME,
      source,
      imported_at:            importedAt,
    });
  }

  console.log(`    ✓ ${rows.length} communes | ${skipped} lignes ignorées (autres niveaux géo)`);

  // Aperçu communes test
  const TESTS = ["92050", "92073", "75056", "93066"];
  console.log(`\n    — Communes test :`);
  for (const code of TESTS) {
    const r = rows.find((r) => r.code_insee === code);
    if (r) {
      console.log(
        `    ${r.code_insee} ${(r.commune ?? "?").padEnd(22)}` +
        ` demandes=${String(r.demandes_en_attente ?? "null").padStart(7)}` +
        ` attributions=${String(r.attributions_annuelles ?? "null").padStart(5)}` +
        ` tension=${r.tension_demande ?? "null"}`
      );
    } else {
      console.warn(`    ⚠  ${code} non trouvé`);
    }
  }
  console.log(`    Lyon 69123 → hors IDF, non importé (attendu)`);

  if (isDryRun) {
    console.log(`\n✅  DRY-RUN OK – ${rows.length} lignes prêtes pour public.logements_sociaux_sne`);
    return;
  }

  // ── 4. Upsert ─────────────────────────────────────────────────────────────
  console.log(`\n[4/4] Upsert Supabase…`);
  let totalOk = 0, totalErr = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const { ok, err } = await upsertBatch(supabaseUrl!, serviceKey!, rows.slice(i, i + BATCH_SIZE));
    totalOk += ok; totalErr += err;
    const pct = Math.round(((i + Math.min(BATCH_SIZE, rows.length - i)) / rows.length) * 100);
    Deno.stdout.writeSync(new TextEncoder().encode(`\r    ${pct}% – ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`));
  }

  console.log(`\n\n✅  Import terminé – ${totalOk} lignes upsertées | ${totalErr} erreurs`);
  console.log(`    Table : public.logements_sociaux_sne | Millésime : ${MILLESIME}`);
}

main().catch((err) => {
  console.error(`\n❌  ${err instanceof Error ? err.message : err}`);
  Deno.exit(1);
});