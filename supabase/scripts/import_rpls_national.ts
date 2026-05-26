// supabase/scripts/import_rpls_national.ts
//
// Import RPLS national vers Supabase
//
// Usage PowerShell :
// $env:SUPABASE_URL="https://xxxx.supabase.co"
// $env:SUPABASE_SERVICE_ROLE_KEY="xxxx"
// $env:RPLS_FILE=".\\supabase\\scripts\\rpls\\rpls.csv"
// deno run --allow-read --allow-env --allow-net .\\supabase\\scripts\\import_rpls_national.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

type RplsRow = {
  code_insee: string;
  commune: string | null;
  departement: string | null;
  annee: number | null;
  logements_locatifs_sociaux: number | null;
  logements_rpls: number | null;
  source: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RPLS_FILE = Deno.env.get("RPLS_FILE");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Variables SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquantes.");
}

if (!RPLS_FILE) {
  throw new Error("Variable RPLS_FILE manquante. Exemple : $env:RPLS_FILE='.\\supabase\\scripts\\rpls\\rpls.csv'");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getValue(row: Record<string, unknown>, candidates: string[]): unknown {
  const normalized = new Map<string, unknown>();

  for (const [key, value] of Object.entries(row)) {
    normalized.set(normalizeKey(key), value);
  }

  for (const candidate of candidates) {
    const value = normalized.get(normalizeKey(candidate));
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return null;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  const cleaned = String(value)
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  if (!cleaned) return null;

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function cleanInsee(value: unknown): string | null {
  const raw = toText(value);
  if (!raw) return null;

  const cleaned = raw.replace(/\D/g, "");

  if (cleaned.length === 4) return `0${cleaned}`;
  if (cleaned.length === 5) return cleaned;

  return null;
}

function detectRows(filePath: string): Record<string, unknown>[] {
  const data = Deno.readFileSync(filePath);
  const workbook = XLSX.read(data, { type: "array" });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("Aucune feuille trouvée dans le fichier RPLS.");

  const sheet = workbook.Sheets[firstSheetName];

  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });
}

function mapRow(row: Record<string, unknown>): RplsRow | null {
  const codeInsee = cleanInsee(
    getValue(row, [
      "code_insee",
      "code commune",
      "code_commune",
      "insee",
      "code insee",
      "commune_insee",
      "codgeo",
      "CODGEO",
    ]),
  );

  if (!codeInsee) return null;

  const commune = toText(
    getValue(row, [
      "commune",
      "nom_commune",
      "libelle_commune",
      "nom de la commune",
      "libgeo",
      "LIBGEO",
    ]),
  );

  const annee =
    toNumber(
      getValue(row, [
        "annee",
        "millésime",
        "millesime",
        "année",
        "an",
      ]),
    ) ?? new Date().getFullYear();

  const logements =
    toNumber(
      getValue(row, [
        "logements_locatifs_sociaux",
        "logements sociaux",
        "nombre de logements sociaux",
        "parc locatif social",
        "nb logements sociaux",
        "nb_logements_sociaux",
        "rpls",
        "logements_rpls",
      ]),
    );

  const departement = codeInsee.startsWith("97")
    ? codeInsee.slice(0, 3)
    : codeInsee.slice(0, 2);

  return {
    code_insee: codeInsee,
    commune,
    departement,
    annee,
    logements_locatifs_sociaux: logements,
    logements_rpls: logements,
    source: "RPLS",
  };
}

function uniqueLatest(rows: RplsRow[]): RplsRow[] {
  const map = new Map<string, RplsRow>();

  for (const row of rows) {
    const key = `${row.code_insee}_${row.annee ?? "unknown"}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, row);
      continue;
    }

    map.set(key, {
      ...existing,
      commune: existing.commune ?? row.commune,
      departement: existing.departement ?? row.departement,
      logements_locatifs_sociaux:
        existing.logements_locatifs_sociaux ?? row.logements_locatifs_sociaux,
      logements_rpls: existing.logements_rpls ?? row.logements_rpls,
    });
  }

  return [...map.values()];
}

async function main() {
  console.log(`[RPLS] Lecture fichier : ${RPLS_FILE}`);

  const rawRows = detectRows(RPLS_FILE);
  console.log(`[RPLS] Lignes lues : ${rawRows.length}`);

  const mappedRows = rawRows
    .map(mapRow)
    .filter((row): row is RplsRow => row !== null && row.logements_rpls !== null);

  const rows = uniqueLatest(mappedRows);

  console.log(`[RPLS] Lignes valides : ${rows.length}`);

  if (rows.length === 0) {
    console.log("[RPLS] Aucune ligne valide. Vérifie les noms de colonnes du fichier source.");
    return;
  }

  const batchSize = 500;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    const { error } = await supabase
      .from("logements_sociaux_rpls")
      .upsert(batch, {
        onConflict: "code_insee,annee",
      });

    if (error) {
      console.error("[RPLS] Erreur Supabase :", error.message);
      throw error;
    }

    console.log(`[RPLS] Import ${Math.min(i + batchSize, rows.length)} / ${rows.length}`);
  }

  console.log("[RPLS] Import terminé.");
}

main();