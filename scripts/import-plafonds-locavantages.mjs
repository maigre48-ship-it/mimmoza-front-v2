#!/usr/bin/env node
// scripts/import-plafonds-locavantages.mjs
//
// Importe les plafonds de loyer Loc'Avantages (≈ 35 000 communes et
// arrondissements) depuis l'open data du ministère de la Transition écologique
// vers la table public.plafonds_loyer_locavantages.
//
// ─── Quand le relancer ───────────────────────────────────────────────────────
// Une fois par an, après publication de l'arrêté fixant les plafonds de
// l'année. L'arrêté paraît en général fin décembre ou en janvier, et le CSV
// suit de quelques jours. Le script est idempotent : le relancer sur un
// millésime déjà importé met simplement les valeurs à jour.
//
// ─── Usage ───────────────────────────────────────────────────────────────────
//   node scripts/import-plafonds-locavantages.mjs
//   node scripts/import-plafonds-locavantages.mjs --millesime 2027 --url <csv>
//
// Variables d'environnement requises :
//   SUPABASE_URL              https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY clé service_role (écriture sous RLS)
//
// ⚠️ La clé service_role donne un accès complet à la base. Ne la mets ni dans
// .env.local, ni dans un fichier versionné : passe-la dans la session shell,
// le temps de l'import.
//
//   PowerShell :
//     $env:SUPABASE_URL="https://fwvrqngbafqdaekbdfnm.supabase.co"
//     $env:SUPABASE_SERVICE_ROLE_KEY="<clé>"
//     node scripts/import-plafonds-locavantages.mjs

import { createClient } from "@supabase/supabase-js";
import { avecReprise, tracerReprise } from "./lib/reprise.mjs";

// ── Paramètres ───────────────────────────────────────────────────────────────

const MILLESIME_PAR_DEFAUT = 2026;

/**
 * Ressource CSV 2026 du jeu de données officiel. Pour un nouveau millésime,
 * récupérer l'URL de la ressource correspondante sur :
 * https://www.data.gouv.fr/datasets/plafonds-de-loyer-du-dispositif-locavantages
 */
const URL_CSV_PAR_DEFAUT =
  "https://static.data.gouv.fr/resources/plafonds-de-loyer-du-dispositif-locavantages/20260203-133129/plafonds-2026-final.csv";

/** Taille des lots d'insertion. Au-delà, PostgREST commence à peiner. */
const TAILLE_LOT = 1000;

// ── Arguments ────────────────────────────────────────────────────────────────

function lireArgument(nom, defaut) {
  const i = process.argv.indexOf(`--${nom}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}

const millesime = Number(lireArgument("millesime", MILLESIME_PAR_DEFAUT));
const urlCsv = lireArgument("url", URL_CSV_PAR_DEFAUT);

if (!Number.isInteger(millesime) || millesime < 2022 || millesime > 2100) {
  console.error(`Millésime invalide : ${millesime}`);
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error(
    "Variables manquantes. Définis SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY\n" +
      "dans ta session shell avant de lancer le script.",
  );
  process.exit(1);
}

// ── Lecture du CSV ───────────────────────────────────────────────────────────

/**
 * Décode le fichier téléchargé.
 *
 * Le CSV du ministère est publié en Windows-1252, pas en UTF-8 : `response
 * .text()` le décodait en UTF-8 et transformait « Location intermédiaire » en
 * « Location interm<U+FFFD>diaire », ce qui faisait échouer la détection des
 * colonnes. On tente donc l'UTF-8 en mode strict, et on retombe sur
 * Windows-1252 dès qu'un octet invalide apparaît — l'ordre est important, un
 * fichier UTF-8 lu en Windows-1252 passerait sans erreur mais avec des accents
 * faux.
 */
function decoder(octets) {
  const vue = new Uint8Array(octets);
  // BOM UTF-8 éventuel : le TextDecoder le retire, mais autant être explicite.
  const utile =
    vue[0] === 0xef && vue[1] === 0xbb && vue[2] === 0xbf ? vue.subarray(3) : vue;

  try {
    return {
      texte: new TextDecoder("utf-8", { fatal: true }).decode(utile),
      encodage: "UTF-8",
    };
  } catch {
    return {
      texte: new TextDecoder("windows-1252").decode(utile),
      encodage: "Windows-1252",
    };
  }
}

/**
 * Découpe une ligne CSV en respectant les guillemets : certains noms de
 * communes contiennent une virgule, un découpage naïf les casserait.
 */
function decouperLigneCsv(ligne, separateur) {
  const champs = [];
  let courant = "";
  let dansGuillemets = false;

  for (let i = 0; i < ligne.length; i += 1) {
    const c = ligne[i];
    if (c === '"') {
      if (dansGuillemets && ligne[i + 1] === '"') {
        courant += '"';
        i += 1;
      } else {
        dansGuillemets = !dansGuillemets;
      }
    } else if (c === separateur && !dansGuillemets) {
      champs.push(courant);
      courant = "";
    } else {
      courant += c;
    }
  }
  champs.push(courant);
  return champs.map((v) => v.trim());
}

function detecterSeparateur(entete) {
  const candidats = [";", ",", "\t"];
  let meilleur = ";";
  let maxChamps = 0;
  for (const sep of candidats) {
    const n = decouperLigneCsv(entete, sep).length;
    if (n > maxChamps) {
      maxChamps = n;
      meilleur = sep;
    }
  }
  return meilleur;
}

/** Normalise un intitulé de colonne : minuscules, sans accent ni ponctuation. */
function normaliser(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Repère les colonnes par mots-clés plutôt que par position : si le producteur
 * réordonne ou renomme légèrement ses colonnes l'an prochain, l'import continue
 * de fonctionner — et s'il change vraiment, il échoue franchement au lieu
 * d'importer des colonnes décalées.
 */
function repererColonnes(entetes) {
  const norm = entetes.map(normaliser);
  const trouver = (...motifs) =>
    norm.findIndex((h) => motifs.every((m) => h.includes(m)));

  const idx = {
    codeInsee: trouver("code"),
    libelle: norm.findIndex((h) => h.startsWith("commune")),
    source: trouver("source"),
    intermediaire: trouver("intermediaire"),
    social: norm.findIndex((h) => h.includes("social") && !h.includes("tres")),
    tresSocial: trouver("tres", "social"),
  };

  const manquantes = Object.entries(idx)
    .filter(([, v]) => v === -1)
    .map(([k]) => k);
  if (manquantes.length > 0) {
    throw new Error(
      `Colonnes introuvables dans le CSV : ${manquantes.join(", ")}.\n` +
        `Entêtes lues : ${entetes.join(" | ")}\n` +
        "Le format du fichier a probablement changé — vérifie-le avant de forcer l'import.",
    );
  }
  return idx;
}

function nombreOuNull(brut) {
  if (brut === undefined || brut === null) return null;
  const nettoye = String(brut).replace(",", ".").replace(/\s/g, "");
  if (!nettoye) return null;
  const n = Number(nettoye);
  return Number.isFinite(n) ? n : null;
}

/**
 * Rétablit le zéro initial des codes INSEE des départements 01 à 09.
 *
 * Le producteur publie ce code comme un NOMBRE : « 1001 » pour Ozan au lieu de
 * « 01001 », « 9342 » au lieu de « 09342 ». Le premier import a repris la
 * valeur telle quelle, et 3 135 communes se sont retrouvées avec un code à
 * quatre caractères — invisibles à toute jointure sur le code INSEE. Aucune
 * erreur n'a été levée : les plafonds étaient bien en base, simplement
 * introuvables, ce qui est le pire des deux mondes.
 *
 * On ne complète que les codes purement numériques : la Corse (2A004, 2B033)
 * et l'outre-mer (97101) font déjà cinq caractères et ne doivent pas bouger.
 */
function normaliserCodeInsee(brut) {
  const v = (brut ?? "").replace(/^"|"$/g, "").trim().toUpperCase();
  if (!v) return "";
  return /^[0-9]{1,4}$/.test(v) ? v.padStart(5, "0") : v;
}

// ── Programme ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Millésime : ${millesime}`);
  console.log(`Source    : ${urlCsv}\n`);

  console.log("Téléchargement du CSV…");
  const reponse = await avecReprise(
    async () => {
      const r = await fetch(urlCsv);
      if (!r.ok) {
        // On expose `status` : la reprise distingue un 503 passager d'un 404.
        throw Object.assign(
          new Error(`Téléchargement impossible : HTTP ${r.status} ${r.statusText}`),
          { status: r.status },
        );
      }
      return r;
    },
    { surEchec: tracerReprise },
  );
  const octets = await reponse.arrayBuffer();
  const { texte, encodage } = decoder(octets);
  console.log(`  ${(octets.byteLength / 1024).toFixed(0)} Ko reçus, encodage ${encodage}`);

  const lignes = texte.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lignes.length < 2) throw new Error("Le fichier ne contient aucune donnée.");

  const separateur = detecterSeparateur(lignes[0]);
  const entetes = decouperLigneCsv(lignes[0], separateur);
  const idx = repererColonnes(entetes);
  console.log(`  séparateur « ${separateur === "\t" ? "\\t" : separateur} », ${entetes.length} colonnes reconnues`);

  const rangs = [];
  const rejets = [];
  const vus = new Set();

  for (let i = 1; i < lignes.length; i += 1) {
    const champs = decouperLigneCsv(lignes[i], separateur);
    const codeInsee = normaliserCodeInsee(champs[idx.codeInsee]);
    const inter = nombreOuNull(champs[idx.intermediaire]);
    const social = nombreOuNull(champs[idx.social]);
    const tres = nombreOuNull(champs[idx.tresSocial]);

    if (!codeInsee || inter === null || social === null || tres === null) {
      rejets.push({ ligne: i + 1, raison: "champ manquant ou non numérique" });
      continue;
    }
    // La contrainte CHECK de la table impose cet ordre : on écarte ici plutôt
    // que de faire échouer tout un lot sur une ligne aberrante.
    if (!(tres <= social && social <= inter) || tres <= 0) {
      rejets.push({ ligne: i + 1, raison: `plafonds incohérents (${inter}/${social}/${tres})` });
      continue;
    }
    if (vus.has(codeInsee)) {
      rejets.push({ ligne: i + 1, raison: `code INSEE en doublon (${codeInsee})` });
      continue;
    }
    vus.add(codeInsee);

    rangs.push({
      code_insee: codeInsee,
      millesime,
      libelle: (champs[idx.libelle] ?? "").replace(/^"|"$/g, "").trim() || codeInsee,
      source: (champs[idx.source] ?? "").replace(/^"|"$/g, "").trim() || null,
      plafond_intermediaire: inter,
      plafond_social: social,
      plafond_tres_social: tres,
    });
  }

  console.log(`\n${rangs.length} communes valides, ${rejets.length} lignes écartées.`);
  if (rejets.length > 0) {
    console.log("  Premières lignes écartées :");
    for (const r of rejets.slice(0, 5)) console.log(`    ligne ${r.ligne} — ${r.raison}`);
  }
  if (rangs.length < 30000) {
    console.warn(
      `\n⚠️ Seulement ${rangs.length} communes : le fichier attendu en compte environ 35 000.\n` +
        "   Vérifie la source avant de considérer l'import comme complet.",
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  console.log("\nÉcriture en base…");
  let ecrits = 0;
  for (let i = 0; i < rangs.length; i += TAILLE_LOT) {
    const lot = rangs.slice(i, i + TAILLE_LOT);
    const { error } = await avecReprise(
      () =>
        supabase
          .from("plafonds_loyer_locavantages")
          .upsert(lot, { onConflict: "code_insee,millesime" }),
      { surEchec: tracerReprise },
    );
    if (error) {
      throw new Error(
        `Échec sur le lot ${i}–${i + lot.length} : ${error.message}\n` +
          "L'upsert est idempotent : relancer le script reprend sans doublon.",
      );
    }
    ecrits += lot.length;
    process.stdout.write(`\r  ${ecrits}/${rangs.length}`);
  }
  process.stdout.write("\n");

  const { count, error: errCount } = await supabase
    .from("plafonds_loyer_locavantages")
    .select("*", { count: "exact", head: true })
    .eq("millesime", millesime);
  if (errCount) {
    console.warn(`Relecture impossible : ${errCount.message}`);
  } else {
    console.log(`\n✅ ${count} lignes en base pour le millésime ${millesime}.`);
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
