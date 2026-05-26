#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Mimmoza – Import SRU national
 * ─────────────────────────────────────────────────────────────────────────────
 * Télécharge le CSV officiel "Communes et inventaire SRU" depuis data.gouv.fr
 * et effectue un upsert complet dans public.logements_sociaux_sru.
 *
 * Source officielle :
 *   https://www.data.gouv.fr/datasets/communes-et-inventaire-sru
 *   Ministère de la Transition écologique – Licence Ouverte v2.0
 *
 * Usage :
 *   export SUPABASE_URL=https://xxxx.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *   deno run --allow-net --allow-env scripts/import_sru_national.ts
 *
 * Options :
 *   --dry-run     Parse le CSV et affiche les stats sans écrire en base
 *   --limit=N     Limite l'upsert aux N premières lignes (debug)
 */

// ─── Config ──────────────────────────────────────────────────────────────────

/**
 * URL du CSV le plus récent (19 décembre 2025 – 2196 communes, inventaire 2024)
 * À mettre à jour chaque année depuis :
 *   https://www.data.gouv.fr/datasets/communes-et-inventaire-sru
 */
const CSV_URL =
  "https://www.data.gouv.fr/api/1/datasets/r/59379519-0fa6-4510-be06-a97d02fdef18";

const ANNEE_INVENTAIRE = 2024;

/** Nombre de lignes par batch upsert (limite payload Supabase REST) */
const BATCH_SIZE = 200;

// ─── Types ───────────────────────────────────────────────────────────────────

interface SruRow {
  code_insee: string;
  nom_commune: string | null;
  code_departement: string | null;
  logements_sociaux: number | null;
  residences_principales: number | null;
  taux_lls: number | null;
  objectif_sru: number | null;
  logements_manquants: number | null;
  statut_sru: string | null;
  annee_inventaire: number;
  source_url: string;
  imported_at: string;
}

// ─── Normalisation noms de colonnes ──────────────────────────────────────────

/** Normalise un header CSV en clé utilisable dans le mapping */
function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // supprime les accents
    .replace(/[^a-z0-9]+/g, "_")    // remplace ponctuation/espaces par _
    .replace(/^_+|_+$/g, "");        // trim _
}

/**
 * Trouve la première clé du record qui contient tous les fragments donnés.
 * Utilisé pour matcher des colonnes dont le nom exact peut varier entre années.
 */
function findCol(headers: Record<string, string>, ...fragments: string[]): string | null {
  for (const key of Object.keys(headers)) {
    if (fragments.every((f) => key.includes(f))) return headers[key];
  }
  return null;
}

// ─── Parsing CSV ─────────────────────────────────────────────────────────────

/**
 * Parse un CSV avec séparateur auto-détecté (;  ou ,).
 * Gère le BOM UTF-8, les guillemets doubles, les valeurs vides.
 * Retourne un tableau d'objets { [headerNormalisé]: valeur brute }.
 */
function parseCsv(raw: string): Array<Record<string, string>> {
  // Supprime le BOM éventuel
  const text = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;

  const lines = text.split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV vide ou mal formé.");

  // Détection séparateur sur la première ligne
  const firstLine = lines[0];
  const sep = firstLine.includes(";") ? ";" : ",";

  const splitLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
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

  // Table de correspondance : normalisé → index original (pour findCol)
  const normToOriginal: Record<string, string> = {};
  rawHeaders.forEach((h, i) => {
    normToOriginal[normalizeHeader(h)] = String(i);
  });

  console.log(`\n[CSV] Séparateur : "${sep}" | ${rawHeaders.length} colonnes détectées`);
  console.log("[CSV] Headers normalisés :", Object.keys(normToOriginal).join(" | "));

  const rows: Array<Record<string, string>> = [];

  for (let li = 1; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line) continue;
    const vals = splitLine(line);
    const row: Record<string, string> = {};
    rawHeaders.forEach((h, i) => {
      row[normalizeHeader(h)] = vals[i] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

// ─── Mapping colonne → valeur ─────────────────────────────────────────────────

function toNum(v: string | undefined): number | null {
  if (!v || v.trim() === "" || v.trim() === "NC" || v.trim() === "N/A") return null;
  const n = parseFloat(v.replace(",", ".").replace(/\s/g, ""));
  return isNaN(n) ? null : n;
}

function toInt(v: string | undefined): number | null {
  const n = toNum(v);
  return n !== null ? Math.round(n) : null;
}

/**
 * Déduit le statut SRU à partir des colonnes booléennes du CSV.
 * Le CSV official ne contient pas de colonne "statut" unique : il faut croiser.
 */
function computeStatut(row: Record<string, string>): string | null {
  // Colonnes booléennes attendues (valeurs : "Oui"/"Non" ou "1"/"0")
  const truthy = (v: string | undefined) =>
    v?.trim().toLowerCase() === "oui" || v?.trim() === "1";

  const exemptee =
    findColValue(row, "commune_exemptee") ??
    findColValue(row, "exemptee");
  const carencee =
    findColValue(row, "commune_carencee") ??
    findColValue(row, "carencee");
  const deficitaire =
    findColValue(row, "commune_deficitaire") ??
    findColValue(row, "deficitaire");

  if (truthy(exemptee)) return "Exempté";
  if (truthy(carencee)) return "Carencé";
  if (truthy(deficitaire)) return "Déficitaire";

  // Si aucune colonne booléenne, on déduit via le taux
  const taux = toNum(findColValue(row, "taux_sru") ?? findColValue(row, "taux_lls"));
  const objectif = toNum(findColValue(row, "taux_cible") ?? findColValue(row, "objectif"));
  if (taux !== null && objectif !== null) {
    return taux >= objectif ? "Atteint" : "Déficitaire";
  }

  return null;
}

/** Retourne la valeur brute d'une colonne par fragments de son nom normalisé */
function findColValue(row: Record<string, string>, ...fragments: string[]): string | undefined {
  for (const key of Object.keys(row)) {
    if (fragments.every((f) => key.includes(f))) return row[key];
  }
  return undefined;
}

// ─── Mapping d'une ligne CSV → SruRow ────────────────────────────────────────

function mapRow(row: Record<string, string>, importedAt: string): SruRow | null {
  // Code INSEE – colonne obligatoire
  const codeInsee =
    findColValue(row, "code_insee") ??
    findColValue(row, "code_commune_insee") ??
    findColValue(row, "code_commune") ??
    findColValue(row, "codecommune");

  if (!codeInsee || codeInsee.trim() === "") return null;
  const code = codeInsee.trim().padStart(5, "0");
  if (!/^\d{5}$/.test(code)) return null;

  const nomCommune =
    findColValue(row, "nom_de_la_commune") ??
    findColValue(row, "nom_commune") ??
    findColValue(row, "libelle_commune") ??
    findColValue(row, "commune") ??
    null;

  const codeDept =
    findColValue(row, "code_departement") ??
    findColValue(row, "numero_du_departement") ??
    findColValue(row, "dept") ??
    code.slice(0, 2);

  // Taux LLS
  const tauxRaw =
    findColValue(row, "taux_sru_au_1er_janvier") ??
    findColValue(row, "taux_sru") ??
    findColValue(row, "taux_lls") ??
    findColValue(row, "taux_de_lls");
  const taux_lls = toNum(tauxRaw);

  // Objectif / taux cible
  const objectifRaw =
    findColValue(row, "taux_cible_de_la_commune") ??
    findColValue(row, "taux_cible") ??
    findColValue(row, "objectif_legal") ??
    findColValue(row, "objectif_sru");
  const objectif_sru = toNum(objectifRaw);

  // Logements sociaux
  const llsRaw =
    findColValue(row, "nombre_de_logements_locatifs_sociaux_inventaire") ??
    findColValue(row, "logements_locatifs_sociaux_inventaire") ??
    findColValue(row, "nombre_de_lls") ??
    findColValue(row, "logements_sociaux");
  const logements_sociaux = toInt(llsRaw);

  // Résidences principales
  const rpRaw =
    findColValue(row, "residences_principales") ??
    findColValue(row, "nombre_de_residences_principales") ??
    findColValue(row, "rp_");
  const residences_principales = toInt(rpRaw);

  // Logements manquants
  const lmRaw =
    findColValue(row, "logements_manquants") ??
    findColValue(row, "nombre_de_logements_manquants") ??
    findColValue(row, "lls_manquants");
  const logements_manquants = toInt(lmRaw);

  const statut_sru = computeStatut(row);

  return {
    code_insee: code,
    nom_commune: nomCommune?.trim() || null,
    code_departement: codeDept?.trim().padStart(2, "0").slice(0, 3) || null,
    logements_sociaux,
    residences_principales,
    taux_lls,
    objectif_sru,
    logements_manquants,
    statut_sru,
    annee_inventaire: ANNEE_INVENTAIRE,
    source_url: CSV_URL,
    imported_at: importedAt,
  };
}

// ─── Upsert Supabase ──────────────────────────────────────────────────────────

async function upsertBatch(
  supabaseUrl: string,
  serviceKey: string,
  rows: SruRow[],
): Promise<{ inserted: number; errors: number }> {
  const url = `${supabaseUrl}/rest/v1/logements_sociaux_sru`;

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
    console.error(`[UPSERT] HTTP ${res.status} – ${body.slice(0, 300)}`);
    return { inserted: 0, errors: rows.length };
  }

  return { inserted: rows.length, errors: 0 };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = Deno.args;
  const isDryRun = args.includes("--dry-run");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1]) : Infinity;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!isDryRun && (!supabaseUrl || !serviceKey)) {
    console.error(
      "❌  SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (ou --dry-run).",
    );
    Deno.exit(1);
  }

  // ── 1. Téléchargement CSV ──────────────────────────────────────────────────
  console.log(`\n[1/4] Téléchargement CSV depuis data.gouv.fr…`);
  console.log(`      ${CSV_URL}`);

  const fetchRes = await fetch(CSV_URL, {
    headers: { "User-Agent": "Mimmoza-Import/1.0 (contact@mimmoza.fr)" },
    redirect: "follow",
  });

  if (!fetchRes.ok) {
    console.error(`❌  HTTP ${fetchRes.status} – ${fetchRes.statusText}`);
    Deno.exit(1);
  }

  const rawCsv = await fetchRes.text();
  console.log(`    ✓ ${(rawCsv.length / 1024).toFixed(0)} Ko reçus`);

  // ── 2. Parsing ─────────────────────────────────────────────────────────────
  console.log(`\n[2/4] Parsing CSV…`);
  const csvRows = parseCsv(rawCsv);
  console.log(`    ✓ ${csvRows.length} lignes parsées`);

  // ── 3. Mapping ─────────────────────────────────────────────────────────────
  console.log(`\n[3/4] Mapping lignes → SruRow…`);
  const importedAt = new Date().toISOString();

  let mapped = 0;
  let skipped = 0;
  const rows: SruRow[] = [];

  for (const raw of csvRows) {
    const row = mapRow(raw, importedAt);
    if (!row) { skipped++; continue; }
    rows.push(row);
    mapped++;
    if (rows.length >= limit) break;
  }

  console.log(`    ✓ ${mapped} lignes mappées | ${skipped} ignorées (code INSEE invalide)`);

  // Aperçu 3 exemples
  const samples = rows.filter((r) => ["69123", "92050", "92073"].includes(r.code_insee));
  if (samples.length > 0) {
    console.log("\n    — Aperçu communes test :");
    for (const s of samples) {
      console.log(
        `    ${s.code_insee} ${s.nom_commune?.padEnd(20)} | taux=${s.taux_lls}% | objectif=${s.objectif_sru}% | LLS=${s.logements_sociaux} | RP=${s.residences_principales} | manquants=${s.logements_manquants} | statut=${s.statut_sru}`,
      );
    }
  } else {
    console.warn("    ⚠  Lyon/Nanterre/Suresnes non trouvés – vérifier le mapping colonnes.");
  }

  if (isDryRun) {
    console.log("\n✅  DRY-RUN terminé. Aucune écriture en base.");
    return;
  }

  // ── 4. Upsert par batch ────────────────────────────────────────────────────
  console.log(`\n[4/4] Upsert dans Supabase (batches de ${BATCH_SIZE})…`);

  let totalInserted = 0;
  let totalErrors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { inserted, errors } = await upsertBatch(supabaseUrl!, serviceKey!, batch);
    totalInserted += inserted;
    totalErrors += errors;

    const pct = Math.round(((i + batch.length) / rows.length) * 100);
    process.stdout.write(`\r    ${pct}% – ${i + batch.length}/${rows.length} lignes`);
  }

  console.log(`\n\n✅  Import terminé.`);
  console.log(`    Lignes upsertées : ${totalInserted}`);
  console.log(`    Erreurs          : ${totalErrors}`);
  console.log(`    Année inventaire : ${ANNEE_INVENTAIRE}`);
  console.log(`    Table cible      : public.logements_sociaux_sru`);
}

main().catch((err) => {
  console.error("❌  Erreur non gérée :", err);
  Deno.exit(1);
});