#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Mimmoza – Import SRU national
 * Compatible avec la table existante public.logements_sociaux_sru
 */

const CSV_URL =
  "https://www.data.gouv.fr/api/1/datasets/r/59379519-0fa6-4510-be06-a97d02fdef18";

const BATCH_SIZE = 200;

interface SruRow {
  code_insee: string;
  commune: string | null;
  departement: string | null;
  population: number | null;
  taux_lls: number | null;
  objectif_sru: number | null;
  logements_sociaux: number | null;
  logements_manquants: number | null;
  residences_principales: number | null;
  statut_sru: string | null;
  source: string;
  millesime: string;
  imported_at: string;
  deficit_mode: "officiel" | "calcule" | "indisponible";
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCsv(raw: string): Array<Record<string, string>> {
  const text = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV vide ou mal formé.");

  const sep = lines[0].includes(";") ? ";" : ",";

  const splitLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === sep && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }

    result.push(current.trim());
    return result;
  };

  const rawHeaders = splitLine(lines[0]);
  const normalizedHeaders = rawHeaders.map(normalizeHeader);

  console.log(`\n[CSV] Séparateur : "${sep}" | ${rawHeaders.length} colonnes détectées`);
  console.log("[CSV] Headers normalisés :", normalizedHeaders.join(" | "));

  const rows: Array<Record<string, string>> = [];

  for (let li = 1; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line) continue;

    const vals = splitLine(line);
    const row: Record<string, string> = {};

    normalizedHeaders.forEach((h, i) => {
      row[h] = vals[i] ?? "";
    });

    rows.push(row);
  }

  return rows;
}

function findColValue(row: Record<string, string>, ...fragments: string[]): string | undefined {
  for (const key of Object.keys(row)) {
    if (fragments.every((f) => key.includes(f))) return row[key];
  }
  return undefined;
}

function toNum(v: string | undefined): number | null {
  if (!v || v.trim() === "" || v.trim() === "NC" || v.trim() === "N/A") return null;
  const n = parseFloat(v.replace(",", ".").replace(/\s/g, ""));
  return Number.isNaN(n) ? null : n;
}

function toInt(v: string | undefined): number | null {
  const n = toNum(v);
  return n !== null ? Math.round(n) : null;
}

function truthy(v: string | undefined): boolean {
  const s = v?.trim().toLowerCase();
  return s === "oui" || s === "1" || s === "true";
}

function computeStatut(row: Record<string, string>, taux: number | null, objectif: number | null): string | null {
  const exemptee =
    findColValue(row, "commune_exempt") ??
    findColValue(row, "exempt");

  const carencee =
    findColValue(row, "commune_carenc") ??
    findColValue(row, "carenc");

  const deficitaire =
    findColValue(row, "commune_deficitaire") ??
    findColValue(row, "deficitaire");

  if (truthy(exemptee)) return "Commune exemptée SRU";
  if (truthy(carencee)) return "Commune carencée SRU";
  if (truthy(deficitaire)) return "Commune en déficit SRU";

  if (taux !== null && objectif !== null) {
    return taux >= objectif ? "Objectif SRU atteint" : "Commune en déficit SRU";
  }

  return null;
}

function mapRow(row: Record<string, string>, importedAt: string): SruRow | null {
  const codeInsee =
    findColValue(row, "code_insee_commune") ??
    findColValue(row, "code_insee") ??
    findColValue(row, "code_commune_insee") ??
    findColValue(row, "code_commune") ??
    findColValue(row, "codecommune");

  if (!codeInsee || codeInsee.trim() === "") return null;

  const code = codeInsee.trim().padStart(5, "0");
  if (!/^\d{5}$/.test(code)) return null;

  const commune =
    findColValue(row, "nom_commune") ??
    findColValue(row, "nom_de_la_commune") ??
    findColValue(row, "libelle_commune") ??
    findColValue(row, "commune") ??
    null;

  const departement =
    findColValue(row, "code_departement") ??
    findColValue(row, "departement") ??
    code.slice(0, 2);

  const population = toInt(
    findColValue(row, "population_municipale") ??
      findColValue(row, "population")
  );

  const taux_lls = toNum(
    findColValue(row, "taux_sru_au_01_01_2024") ??
      findColValue(row, "taux_sru") ??
      findColValue(row, "taux_lls")
  );

  const objectif_sru = toNum(
    findColValue(row, "taux_cible_commune") ??
      findColValue(row, "taux_cible") ??
      findColValue(row, "objectif_sru")
  );

  const logements_sociaux = toInt(
    findColValue(row, "nombre_lls_inventaire") ??
      findColValue(row, "nombre_de_lls") ??
      findColValue(row, "logements_sociaux")
  );

  const residences_principales = toInt(
    findColValue(row, "residences_principales") ??
      findColValue(row, "nombre_de_residences_principales")
  );

  const logements_manquants = toInt(
    findColValue(row, "logements_manquants") ??
      findColValue(row, "nombre_de_logements_manquants") ??
      findColValue(row, "lls_manquants")
  );

  const statut_sru = computeStatut(row, taux_lls, objectif_sru);

  return {
    code_insee: code,
    commune: commune?.trim() || null,
    departement: departement?.trim().padStart(2, "0").slice(0, 3) || null,
    population,
    taux_lls,
    objectif_sru,
    logements_sociaux,
    logements_manquants,
    residences_principales,
    statut_sru,
    source: "Inventaire SRU",
    millesime: "2024",
    imported_at: importedAt,
    deficit_mode: logements_manquants !== null ? "officiel" : "indisponible",
  };
}

async function upsertBatch(
  supabaseUrl: string,
  serviceKey: string,
  rows: SruRow[],
): Promise<{ inserted: number; errors: number }> {
  const url = `${supabaseUrl}/rest/v1/logements_sociaux_sru?on_conflict=code_insee`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Prefer": "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[UPSERT] HTTP ${res.status} – ${body.slice(0, 500)}`);
    return { inserted: 0, errors: rows.length };
  }

  return { inserted: rows.length, errors: 0 };
}

async function writeProgress(text: string) {
  await Deno.stdout.write(new TextEncoder().encode(text));
}

async function main() {
  const args = Deno.args;
  const isDryRun = args.includes("--dry-run");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!isDryRun && (!supabaseUrl || !serviceKey)) {
    console.error("❌ SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.");
    Deno.exit(1);
  }

  console.log(`\n[1/4] Téléchargement CSV depuis data.gouv.fr…`);
  console.log(`      ${CSV_URL}`);

  const fetchRes = await fetch(CSV_URL, {
    headers: { "User-Agent": "Mimmoza-Import/1.0" },
    redirect: "follow",
  });

  if (!fetchRes.ok) {
    console.error(`❌ HTTP ${fetchRes.status} – ${fetchRes.statusText}`);
    Deno.exit(1);
  }

  const rawCsv = await fetchRes.text();
  console.log(`    ✓ ${(rawCsv.length / 1024).toFixed(0)} Ko reçus`);

  console.log(`\n[2/4] Parsing CSV…`);
  const csvRows = parseCsv(rawCsv);
  console.log(`    ✓ ${csvRows.length} lignes parsées`);

  console.log(`\n[3/4] Mapping lignes → table logements_sociaux_sru…`);
  const importedAt = new Date().toISOString();

  let mapped = 0;
  let skipped = 0;
  const rows: SruRow[] = [];

  for (const raw of csvRows) {
    const row = mapRow(raw, importedAt);
    if (!row) {
      skipped++;
      continue;
    }

    rows.push(row);
    mapped++;

    if (rows.length >= limit) break;
  }

  console.log(`    ✓ ${mapped} lignes mappées | ${skipped} ignorées`);

  const samples = rows.filter((r) => ["69123", "92050", "92073"].includes(r.code_insee));

  if (samples.length > 0) {
    console.log("\n    — Aperçu communes test :");
    for (const s of samples) {
      console.log(
        `    ${s.code_insee} ${(s.commune ?? "").padEnd(20)} | taux=${s.taux_lls}% | objectif=${s.objectif_sru}% | LLS=${s.logements_sociaux} | population=${s.population} | statut=${s.statut_sru}`,
      );
    }
  } else {
    console.warn("    ⚠ Lyon/Nanterre/Suresnes non trouvés – vérifier le mapping.");
  }

  if (isDryRun) {
    console.log("\n✅ DRY-RUN terminé. Aucune écriture en base.");
    return;
  }

  console.log(`\n[4/4] Upsert dans Supabase (batches de ${BATCH_SIZE})…`);

  let totalInserted = 0;
  let totalErrors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { inserted, errors } = await upsertBatch(supabaseUrl!, serviceKey!, batch);

    totalInserted += inserted;
    totalErrors += errors;

    const pct = Math.round(((i + batch.length) / rows.length) * 100);
    await writeProgress(`\r    ${pct}% – ${i + batch.length}/${rows.length} lignes`);
  }

  console.log(`\n\n✅ Import terminé.`);
  console.log(`    Lignes upsertées : ${totalInserted}`);
  console.log(`    Erreurs          : ${totalErrors}`);
  console.log(`    Millésime        : 2024`);
  console.log(`    Table cible      : public.logements_sociaux_sru`);
}

main().catch((err) => {
  console.error("❌ Erreur non gérée :", err);
  Deno.exit(1);
});