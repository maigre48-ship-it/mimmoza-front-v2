import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import xlsx from "xlsx";
import { createClient } from "@supabase/supabase-js";

dotenv.config({
  path: "C:/Users/maigr/OneDrive/Bureau/supabase-backend/.env",
});

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans C:/Users/maigr/OneDrive/Bureau/supabase-backend/.env"
  );
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DATA_DIR = path.join(process.cwd(), "supabase", "scripts", "sne_regions");

function toNumber(val: any): number {
  if (val === null || val === undefined || val === "") return 0;
  return parseInt(String(val).replace(/\s/g, "").replace(",", "."), 10) || 0;
}

function getExcelFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) return getExcelFiles(fullPath);

    const name = entry.name.toLowerCase();
    const full = fullPath.toLowerCase();

    if (
      entry.isFile() &&
      name.endsWith(".xlsx") &&
      full.includes("mutation+hors-mutation") &&
      name.startsWith("tab01-01_e") &&
      !name.includes("x3a") &&
      (
        name.includes("-2023.xlsx") ||
        name.includes("-2024.xlsx") ||
        name.includes("-2025.xlsx")
      )
    ) {
      return [fullPath];
    }

    return [];
  });
}

function extractRegion(filePath: string): string {
  const match = filePath.match(/REGION\s+([^\\/]+)/i);
  return match ? match[1].trim() : "";
}

function extractYear(filePath: string, rows: any[][]): number | null {
  const fileName = path.basename(filePath);
  const fileMatch = fileName.match(/(20\d{2})/);

  if (fileMatch) return Number(fileMatch[1]);

  for (const row of rows) {
    for (const cell of row) {
      const match = String(cell ?? "").match(/(20\d{2})/);
      if (match) return Number(match[1]);
    }
  }

  return null;
}

function isEpciName(label: string): boolean {
  const l = label.trim().toLowerCase();

  return (
    l.startsWith("cc ") ||
    l.startsWith("ca ") ||
    l.startsWith("cu ") ||
    l.includes("métropole") ||
    l.includes("metropole") ||
    l.includes("communauté") ||
    l.includes("agglo") ||
    l.includes("agglomération")
  );
}

async function processFile(filePath: string) {
  console.log(`\n📄 Lecture : ${filePath}`);

  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });

  const region = extractRegion(filePath);
  const annee = extractYear(filePath, rows);

  console.log(`   Région détectée: ${region || "inconnue"}`);
  console.log(`   Année détectée: ${annee ?? "inconnue"}`);

  if (!region || !annee) {
    console.warn("⚠️ Région ou année inconnue — fichier ignoré");
    return;
  }

  const results: Array<{
    nom_epci: string;
    region: string;
    annee: number;
    demandes_en_attente: number;
    attributions_annuelles: number;
    source: string;
  }> = [];

  for (const row of rows) {
    const label = String(row[2] ?? "").trim(); // C
    const type = String(row[3] ?? "").trim().toLowerCase(); // D

    if (type !== "nombre de demandes") continue;
    if (!isEpciName(label)) continue;

    const attributions = toNumber(row[12]); // M
    const demandesFinPeriode = toNumber(row[18]); // S

    if (demandesFinPeriode <= 0 && attributions <= 0) continue;

    results.push({
      nom_epci: label,
      region,
      annee,
      demandes_en_attente: demandesFinPeriode,
      attributions_annuelles: attributions,
      source: "SNE_EPCI",
    });
  }

  const deduped = Array.from(
    new Map(
      results.map((r) => [
        `${r.region}|${r.annee}|${r.nom_epci}`,
        r,
      ])
    ).values()
  );

  const duplicates = results.length - deduped.length;

  console.log(
    `➡️ ${results.length} lignes EPCI extraites | ${deduped.length} après dédoublonnage`
  );

  if (duplicates > 0) {
    console.log(`   ⚠️ ${duplicates} doublon(s) ignoré(s) dans le fichier`);
  }

  if (deduped.length > 0) {
    const { error } = await supabase
      .from("logements_sociaux_sne_epci")
      .upsert(deduped, {
        onConflict: "region,annee,nom_epci",
      });

    if (error) console.error("❌ Erreur insertion :", error);
    else console.log("✅ Upsert OK");
  }
}

async function main() {
  const files = getExcelFiles(DATA_DIR);

  console.log(`📦 ${files.length} fichiers Excel trouvés`);

  for (const file of files) {
    await processFile(file);
  }

  console.log("\n🎯 Import terminé");
}

main();