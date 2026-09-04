#!/usr/bin/env node
// scripts/diagnostic-outre-mer.mjs
//
// Pourquoi les 311 951 lignes d'outre-mer ont-elles été écartées ?
//
// L'import 2025 a rejeté la TOTALITÉ des départements 971 à 976 pour « code
// INSEE indéterminable ». La reconstruction du code repose sur une hypothèse
// héritée du script d'origine : que la colonne « Code département » vaut « 97 »
// pour l'outre-mer, le « Code direction » distinguant ensuite 971, 972, 973,
// 974 et 976.
//
// Cette hypothèse n'a jamais été vérifiée sur le fichier réel. Ce script ne
// corrige rien : il affiche les premières lignes brutes d'un fichier ultramarin
// et d'un fichier métropolitain, pour qu'on voie ce que le producteur écrit
// vraiment avant de toucher au code.
//
// Usage (aucune clé Supabase nécessaire, aucune écriture) :
//   node scripts/diagnostic-outre-mer.mjs

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";

const BASE =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/" +
  "fichiers-des-locaux-et-des-parcelles-des-personnes-morales/attachments/";

// L'outre-mer est dans la seconde archive (départements 57 à 976).
const ARCHIVE = "fichier_des_parcelles_situation_2025_dpts_57_a_976_zip";

const LIGNES_A_MONTRER = 3;

// Colonnes utiles, telles que le script d'import les lit (par position).
const COL = {
  0: "Code département",
  1: "Code direction",
  2: "Code commune",
  3: "Nom commune",
  4: "Préfixe",
  5: "Section",
  6: "Numéro plan",
};

let backendZip = null;

function sortieCommande(commande, args) {
  return new Promise((resolve) => {
    const p = spawn(commande, args);
    let s = "";
    p.stdout.on("data", (d) => { s += d.toString(); });
    p.stderr.on("data", () => {});
    p.on("error", () => resolve(null));
    p.on("close", (code) => resolve(code === 0 ? s : null));
  });
}

async function detecterBackend() {
  if (backendZip) return backendZip;
  if (await sortieCommande("unzip", ["-v"])) backendZip = "unzip";
  else {
    const v = await sortieCommande("tar", ["--version"]);
    if (v && /bsdtar/i.test(v)) backendZip = "tar";
    else if (process.platform === "win32") backendZip = "powershell";
    else throw new Error("Aucun outil capable de lire un zip (unzip ou bsdtar).");
  }
  return backendZip;
}

function encoderPowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

async function listerZip(chemin) {
  const backend = await detecterBackend();
  const args = { unzip: ["-Z1", chemin], tar: ["-tf", chemin] }[backend];
  const p = args
    ? spawn(backend, args)
    : spawn("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
        encoderPowerShell(
          "Add-Type -AssemblyName System.IO.Compression.FileSystem;" +
          `$z=[IO.Compression.ZipFile]::OpenRead(${JSON.stringify(chemin)});` +
          "$z.Entries | ForEach-Object { $_.FullName }; $z.Dispose()")]);

  return new Promise((resolve, reject) => {
    let s = "";
    p.stdout.on("data", (d) => { s += d.toString(); });
    p.on("error", reject);
    p.on("close", () => resolve(s.split("\n").map((x) => x.trim()).filter(Boolean)));
  });
}

async function premieresLignes(chemin, nomFichier, combien) {
  const backend = await detecterBackend();
  const p =
    backend === "unzip" ? spawn("unzip", ["-p", chemin, nomFichier])
    : backend === "tar" ? spawn("tar", ["-xOf", chemin, nomFichier])
    : spawn("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
        encoderPowerShell(
          "Add-Type -AssemblyName System.IO.Compression.FileSystem;" +
          `$z=[IO.Compression.ZipFile]::OpenRead(${JSON.stringify(chemin)});` +
          `$e=$z.GetEntry(${JSON.stringify(nomFichier)});` +
          "$s=$e.Open(); $o=[Console]::OpenStandardOutput(); $s.CopyTo($o);" +
          "$o.Flush(); $s.Dispose(); $z.Dispose()")]);

  p.stdout.setEncoding("utf8");
  const rl = createInterface({ input: p.stdout, crlfDelay: Infinity });
  const lignes = [];
  for await (const l of rl) {
    if (l.trim()) lignes.push(l);
    if (lignes.length > combien) break;
  }
  rl.close();
  p.kill();
  return lignes;
}

function decouper(ligne) {
  const champs = [];
  let courant = "";
  let dansGuillemets = false;
  for (let i = 0; i < ligne.length; i += 1) {
    const c = ligne[i];
    if (c === '"') {
      if (dansGuillemets && ligne[i + 1] === '"') { courant += '"'; i += 1; }
      else dansGuillemets = !dansGuillemets;
    } else if (c === ";" && !dansGuillemets) { champs.push(courant); courant = ""; }
    else courant += c;
  }
  champs.push(courant);
  return champs;
}

function afficher(titre, lignes) {
  console.log(`\n${"═".repeat(72)}`);
  console.log(titre);
  console.log("═".repeat(72));

  if (lignes.length === 0) {
    console.log("  (fichier vide ou illisible)");
    return;
  }

  const entetes = decouper(lignes[0]);
  console.log(`\n${entetes.length} colonnes. Les sept premières :\n`);
  for (const [i, nom] of Object.entries(COL)) {
    console.log(`  [${i}] ${nom.padEnd(18)} → « ${entetes[Number(i)] ?? "?"} »`);
  }

  for (let n = 1; n < lignes.length; n += 1) {
    const c = decouper(lignes[n]);
    console.log(`\n  ── Ligne ${n} ──`);
    for (const [i, nom] of Object.entries(COL)) {
      console.log(`     ${nom.padEnd(18)} = « ${c[Number(i)] ?? ""} »`);
    }
    // Ce que le script d'import en déduirait aujourd'hui.
    const dept = (c[0] ?? "").trim().toUpperCase();
    const commune = (c[2] ?? "").trim().padStart(3, "0");
    let deduit;
    if (dept === "97") {
      const dir = (c[1] ?? "").trim();
      deduit = !dir || dir === "0" ? "null (direction absente)" : `97${dir}${commune}`.slice(0, 5);
    } else {
      deduit = `${dept.padStart(2, "0")}${commune}`;
    }
    const accepte = /^[0-9AB]{5}$/.test(String(deduit));
    console.log(`     → code INSEE déduit : « ${deduit} » ${accepte ? "✅ accepté" : "❌ ÉCARTÉ"}`);
  }
}

async function main() {
  console.log("Diagnostic outre-mer — aucune écriture en base.");
  console.log(`Backend de décompression : ${await detecterBackend()}`);

  const dossier = await mkdtemp(join(tmpdir(), "diag-"));
  const chemin = join(dossier, "archive.zip");

  try {
    console.log(`\nTéléchargement de l'archive 57–976 (plusieurs centaines de Mo)…`);
    const reponse = await fetch(BASE + ARCHIVE);
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    await pipeline(Readable.fromWeb(reponse.body), createWriteStream(chemin));
    console.log("  reçu.");

    const contenu = await listerZip(chemin);
    const csv = contenu.filter((n) => /\.(csv|txt)$/i.test(n));

    // Un fichier ultramarin et un métropolitain, pour comparer.
    const ultramarin = csv.find((n) => /PM_\d{2}_NB[_-]9710/i.test(n))
      ?? csv.find((n) => /PM_\d{2}_NB[_-]97/i.test(n));
    const metropolitain = csv.find((n) => /PM_\d{2}_NB[_-]690/i.test(n))
      ?? csv.find((n) => /PM_\d{2}_NB[_-]5[0-9]0/i.test(n));

    console.log(`\nFichiers ultramarins présents dans l'archive :`);
    for (const n of csv.filter((x) => /PM_\d{2}_NB[_-]97/i.test(x))) {
      console.log(`  ${n}`);
    }

    if (metropolitain) {
      afficher(`RÉFÉRENCE MÉTROPOLE — ${metropolitain}`,
        await premieresLignes(chemin, metropolitain, LIGNES_A_MONTRER));
    }
    if (ultramarin) {
      afficher(`OUTRE-MER — ${ultramarin}`,
        await premieresLignes(chemin, ultramarin, LIGNES_A_MONTRER));
    } else {
      console.log("\n⚠️ Aucun fichier ultramarin trouvé dans l'archive.");
    }
  } finally {
    await rm(dossier, { recursive: true, force: true }).catch(() => {});
  }

  console.log(`\n${"═".repeat(72)}`);
  console.log("Copie-colle cette sortie : elle dira comment reconstruire le code INSEE.");
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
