#!/usr/bin/env node
// scripts/import-proprietaires-personnes-morales.mjs
//
// Importe les propriétaires PERSONNES MORALES des parcelles cadastrales, depuis
// le fichier DGFiP publié en Licence Ouverte 2.0.
//
// ═══ CE QUE CE SCRIPT N'IMPORTE PAS, ET NE DOIT JAMAIS IMPORTER ══════════════
// Aucune personne physique. Le fichier source n'en contient pas, et il ne faut
// pas chercher à combler ce « manque » : l'identité des propriétaires
// particuliers vit dans les fichiers fonciers (MAJIC), réservés aux acteurs
// publics, dont l'acte d'engagement interdit expressément « tout démarchage
// commercial, politique ou électoral ». Détournement de finalité : article
// 226-21 du code pénal, 5 ans et 300 000 €.
//
// ═══ VOLUMÉTRIE — À LIRE AVANT DE LANCER ═════════════════════════════════════
// Le fichier national 2025 des parcelles pèse ~3,9 Go décompressés, soit
// environ 19,7 millions de lignes. En base, index compris, comptez plusieurs
// gigaoctets. C'est une décision de coût, pas un détail.
//
// Le script importe donc PAR DÉPARTEMENT, et n'en prend aucun par défaut :
//
//   node scripts/import-proprietaires-personnes-morales.mjs --departements 69,01,38
//   node scripts/import-proprietaires-personnes-morales.mjs --departements tous
//
// Commence par tes départements d'activité. Tu pourras en ajouter : le script
// est idempotent, relancer sur un département déjà importé met à jour.
//
// ═══ USAGE ═══════════════════════════════════════════════════════════════════
//   $env:SUPABASE_URL="https://<ref>.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="<clé>"
//   node scripts/import-proprietaires-personnes-morales.mjs --departements 69
//
// ⚠️ La clé service_role ouvre toute la base. Garde-la dans la session shell,
// jamais dans un fichier versionné.
//
// ═══ UN SEUL MILLÉSIME EN BASE ═══════════════════════════════════════════════
// Le millésime fait partie de la clé d'unicité : sans précaution, importer une
// nouvelle année AJOUTERAIT une génération complète au lieu de remplacer la
// précédente — ~6,4 Go par an pour la France entière — et une parcelle vendue
// garderait indéfiniment son ancien propriétaire.
//
// Par défaut, le script purge donc les millésimes antérieurs, département par
// département et seulement après l'avoir réécrit. Une coupure laisse alors
// l'ancienne version intacte, et un import par tranches ne touche jamais aux
// départements que la tranche en cours n'a pas rechargés.
//
// `--garder-historique` conserve les anciennes années, pour qui veut comparer
// deux millésimes : un changement de propriétaire est un signal exploitable.
//
// ═══ ORDRES DE GRANDEUR, MESURÉS SUR LE RHÔNE ════════════════════════════════
//   352 octets par ligne en base, index compris (40 % de données, 60 % d'index)
//   France entière ≈ 18,2 M de lignes ≈ 6,4 Go
//   ~7,5 % des lignes sont des subdivisions fiscales redondantes, fusionnées
//
// Options :
//   --departements <liste|tous>  obligatoire
//   --millesime <année>          défaut 2025
//   --dry-run                    analyse et compte, sans rien écrire
//   --garder-historique          ne purge pas les millésimes antérieurs

import { createClient } from "@supabase/supabase-js";
import { avecReprise, tracerReprise } from "./lib/reprise.mjs";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";

// ── Paramètres ───────────────────────────────────────────────────────────────

const MILLESIME_DEFAUT = 2025;
const TAILLE_LOT = 1000;

const BASE_ATTACHMENTS =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/" +
  "fichiers-des-locaux-et-des-parcelles-des-personnes-morales/attachments/";

/**
 * Les parcelles sont livrées en deux archives par millésime, découpées par
 * tranche de départements. Le découpage change d'une année à l'autre : c'est
 * une donnée du producteur, pas une convention stable.
 */
const ARCHIVES_PARCELLES = {
  2025: [
    "fichier_des_parcelles_situation_2025_dpts_01_a_56_zip",
    "fichier_des_parcelles_situation_2025_dpts_57_a_976_zip",
  ],
  2024: [
    "fichier_des_parcelles_situation_2024_dpts_01_a_60_zip",
    "fichiers_des_parcelles_situation_2024_dpts_61_a_976_zip",
  ],
  2023: [
    "fichier_des_parcelles_situation_2023_dept_01_a_61_zip",
    "fichier_des_parcelles_situation_2023_dept_62_a_976_zip",
  ],
};

// ── Arguments ────────────────────────────────────────────────────────────────

function arg(nom, defaut) {
  const i = process.argv.indexOf(`--${nom}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}
const drapeau = (nom) => process.argv.includes(`--${nom}`);

const millesime = Number(arg("millesime", MILLESIME_DEFAUT));
const dryRun = drapeau("dry-run");
const garderHistorique = drapeau("garder-historique");
const departementsBrut = arg("departements", null);

if (!departementsBrut) {
  console.error(
    "Précise les départements à importer.\n\n" +
      "  --departements 69,01,38     quelques départements\n" +
      "  --departements tous         la France entière (~19,7 M de lignes)\n\n" +
      "Aucun département n'est pris par défaut : l'import national représente\n" +
      "plusieurs gigaoctets en base, et c'est une décision de coût.",
  );
  process.exit(1);
}

if (!ARCHIVES_PARCELLES[millesime]) {
  console.error(
    `Millésime ${millesime} inconnu. Disponibles : ${Object.keys(ARCHIVES_PARCELLES).join(", ")}.\n` +
      "Pour un nouveau millésime, relève l'identifiant de la pièce jointe sur\n" +
      "https://data.economie.gouv.fr/explore/dataset/fichiers-des-locaux-et-des-parcelles-des-personnes-morales/\n" +
      "et ajoute-le à ARCHIVES_PARCELLES.",
  );
  process.exit(1);
}

const tousDepartements = departementsBrut.toLowerCase() === "tous";
const departementsVoulus = tousDepartements
  ? null
  : new Set(
      departementsBrut
        .split(",")
        .map((d) => d.trim().toUpperCase())
        .filter(Boolean)
        // 1 → 01, mais 2A reste 2A et 976 reste 976
        .map((d) => (/^[0-9]$/.test(d) ? `0${d}` : d)),
    );

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dryRun && (!supabaseUrl || !serviceKey)) {
  console.error("Définis SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY, ou lance avec --dry-run.");
  process.exit(1);
}

// ── Lecture CSV ──────────────────────────────────────────────────────────────

/**
 * Découpe une ligne en respectant les guillemets. Les millésimes ≤ 2023
 * entourent TOUS les champs de guillemets ; ceux ≥ 2024 n'en mettent aucun.
 */
function decouper(ligne) {
  const champs = [];
  let courant = "";
  let dansGuillemets = false;
  for (let i = 0; i < ligne.length; i += 1) {
    const c = ligne[i];
    if (c === '"') {
      if (dansGuillemets && ligne[i + 1] === '"') { courant += '"'; i += 1; }
      else dansGuillemets = !dansGuillemets;
    } else if (c === ";" && !dansGuillemets) {
      champs.push(courant); courant = "";
    } else courant += c;
  }
  champs.push(courant);
  return champs;
}

/**
 * Les colonnes sont lues PAR POSITION, jamais par nom.
 *
 * Deux raisons. D'abord, l'en-tête « parcelles » contient DEUX colonnes
 * nommées « Contenance » (celle de la parcelle et celle de la subdivision
 * fiscale) : toute lecture par nom en perdrait une. Ensuite, les intitulés
 * changent d'un millésime à l'autre — « N° SIREN » en 2025, « N° SIREN
 * (Propriétaire(s) parcelle) » en 2023.
 *
 * L'ordre des 24 colonnes, lui, est stable depuis 2019.
 */
const COL = {
  departement: 0,
  codeDirection: 1,
  codeCommune: 2,
  nomCommune: 3,
  prefixe: 4,
  section: 5,
  numeroPlan: 6,
  numeroVoirie: 7,
  natureVoie: 11,
  nomVoie: 12,
  codeDroit: 17,
  siren: 19,
  formeJuridiqueCode: 21,
  formeJuridiqueAbregee: 22,
  denomination: 23,
};

/**
 * À partir de 2024, plusieurs colonnes portent « code - libellé » concaténés
 * (« P - Propriétaire »), avec parfois une espace finale. Avant, le code est
 * nu. On extrait le code dans les deux cas.
 */
function extraireCode(valeur) {
  const v = (valeur ?? "").trim();
  if (!v) return null;
  const sep = v.indexOf(" - ");
  return (sep === -1 ? v : v.slice(0, sep)).trim() || null;
}

function nettoyer(valeur) {
  const v = (valeur ?? "").trim();
  return v || null;
}

/**
 * Reconstruit le code INSEE à 5 caractères : deux caractères de département,
 * puis les trois du code commune.
 *
 * ─── L'erreur que cette fonction a corrigée ─────────────────────────────────
 * Une version antérieure croyait que l'outre-mer s'écrivait département « 97 »
 * plus un « Code Direction » distinguant 971 à 976. C'est faux, et le fichier
 * réel le montre : la Guadeloupe porte « 971 » en département, « 1 » en
 * direction et « 101 » en commune, pour un code INSEE attendu de 97101 (Les
 * Abymes). L'ancien code produisait « 971101 », six caractères, aussitôt
 * rejetés par le contrôle de format — 311 951 lignes ultramarines écartées en
 * silence, soit la totalité des cinq départements.
 *
 * La règle réelle est plus simple : le chiffre du DOM est DÉJÀ dans le code
 * département, et le code commune le répète en tête. Tronquer le département à
 * deux caractères suffit donc, et le « Code Direction » ne sert à rien.
 *
 * Vérifié sur le fichier :
 *   métropole   « 69 »  + « 001 » → 69001  (Affoux)
 *   outre-mer   « 971 » + « 101 » → 97101  (Les Abymes)
 *   Paris       « 75 »  + « 101 » → 75101  (1er arrondissement)
 *   Lyon        « 69 »  + « 381 » → 69381  (1er arrondissement)
 *   Corse       « 2A »  + « 004 » → 2A004
 *
 * Paris, Lyon et Marseille portent en effet l'ARRONDISSEMENT dans le code
 * commune, et c'est bien le code INSEE attendu : on le garde tel quel.
 */
function codeInsee(departement, _codeDirection, codeCommune) {
  const dept = (departement ?? "").trim().toUpperCase();
  const commune = (codeCommune ?? "").trim().padStart(3, "0");
  if (!dept || !commune) return null;

  // « 971 » → « 97 », « 69 » → « 69 », « 2A » → « 2A », « 1 » → « 01 ».
  const prefixe = dept.length > 2 ? dept.slice(0, 2) : dept.padStart(2, "0");
  return `${prefixe}${commune}`;
}

/** IDU cadastral sur 14 caractères, pour joindre au cadastre IGN ou Etalab. */
function construireIdu(insee, prefixe, section, numero) {
  const pfx = (prefixe ?? "").trim().padStart(3, "0");
  const sec = (section ?? "").trim().padStart(2, "0");
  const num = (numero ?? "").trim().padStart(4, "0");
  return `${insee}${pfx}${sec}${num}`;
}

/**
 * Département d'un nom de fichier interne : PM_25_NB_010.csv → « 01 ».
 *
 * Convention relevée sur le millésime 2025 : le code département est suivi d'un
 * « 0 » de remplissage — 010 → 01, 690 → 69, 2A0 → 2A. L'outre-mer porte donc
 * QUATRE caractères, 9710 → 971, et non trois : une version antérieure coupait
 * après deux caractères et renvoyait « 97 » pour la Guadeloupe, code qu'aucun
 * département demandé ne pouvait égaler. Les fichiers ultramarins n'étaient
 * jamais importés, sans le moindre message.
 *
 * Le zéro final n'est retiré que s'il en reste un code plausible, pour rester
 * tolérant si le producteur cesse un jour de le mettre.
 */
function departementDuFichier(nom) {
  const m = nom.match(/PM_\d{2}_NB[_-]([0-9AB]{2,4})(?=[._]|$)/i);
  if (!m) return null;
  const brut = m[1].toUpperCase();
  return brut.length > 2 && brut.endsWith("0") ? brut.slice(0, -1) : brut;
}

/**
 * Rang numérique d'un code département, pour le comparer à une plage.
 *
 * Presque tous sont des entiers, mais la Corse s'écrit 2A et 2B. Le producteur
 * les range entre 19 et 21 : on leur donne donc 20,1 et 20,2, ce qui préserve
 * l'ordre sans cas particulier ailleurs.
 */
function rangDepartement(code) {
  const c = String(code).toUpperCase();
  if (c === "2A") return 20.1;
  if (c === "2B") return 20.2;
  const n = Number.parseInt(c, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Décide si une archive mérite d'être téléchargée.
 *
 * Son identifiant porte sa tranche — « …dpts_01_a_56_zip » — ce qui se lit sans
 * rien télécharger. Sur un import par tranches, cela évite de tirer plusieurs
 * centaines de Mo pour n'y trouver aucun département demandé.
 *
 * En cas de doute on télécharge : le découpage change d'une année à l'autre, et
 * sauter une archive à tort ferait manquer des départements en silence — bien
 * pire qu'un téléchargement inutile.
 */
function archivePeutContenir(idArchive, departements) {
  if (!departements) return true; // --departements tous

  const m = idArchive.match(/_dpts?_([0-9AB]+)_a_([0-9AB]+)_zip$/i);
  if (!m) return true; // convention de nommage inconnue : on ne parie pas

  const debut = rangDepartement(m[1]);
  const fin = rangDepartement(m[2]);
  if (debut === null || fin === null) return true;

  for (const dept of departements) {
    const rang = rangDepartement(dept);
    if (rang === null) return true; // code non interprétable : on ne parie pas
    if (rang >= debut && rang <= fin) return true;
  }
  return false;
}

// ── Programme ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Millésime    : ${millesime}`);
  console.log(`Départements : ${tousDepartements ? "tous" : [...departementsVoulus].join(", ")}`);
  if (dryRun) console.log("Mode         : analyse seule, aucune écriture");
  console.log(
    garderHistorique
      ? "Historique   : conservé — les millésimes antérieurs restent en base"
      : "Historique   : purgé département par département, après écriture",
  );
  console.log("");

  const dossier = await mkdtemp(join(tmpdir(), "ppm-"));
  const supabase = dryRun
    ? null
    : createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const total = {
    lus: 0, retenus: 0, ecrits: 0, sirenFictifs: 0, sansInsee: 0, doublons: 0, purgees: 0,
  };
  const departementsTraites = new Set();

  try {
    for (const idArchive of ARCHIVES_PARCELLES[millesime]) {
      const url = BASE_ATTACHMENTS + idArchive;
      const chemin = join(dossier, `${idArchive}.zip`);

      // Le nom de l'archive porte sa tranche de départements : inutile de
      // tirer plusieurs centaines de Mo pour n'y trouver personne.
      if (!archivePeutContenir(idArchive, departementsVoulus)) {
        console.log(`${idArchive}\n  hors des départements demandés, ignorée\n`);
        continue;
      }

      console.log(`Téléchargement de ${idArchive}…`);
      // Plusieurs centaines de Mo : une coupure en cours de route est banale.
      // La reprise repart du début — le serveur ne garantit pas les requêtes
      // par plage — et le `createWriteStream` suivant écrase le fichier
      // partiel au lieu de s'y ajouter.
      await avecReprise(
        async () => {
          const reponse = await fetch(url);
          if (!reponse.ok) {
            throw Object.assign(new Error(`HTTP ${reponse.status} sur ${url}`), {
              status: reponse.status,
            });
          }
          await pipeline(Readable.fromWeb(reponse.body), createWriteStream(chemin));
        },
        { tentatives: 4, surEchec: tracerReprise },
      );

      // Liste le contenu sans décompresser : on ne veut extraire que les
      // départements demandés, pas 3,9 Go inutiles.
      const contenu = await listerZip(chemin);

      // En analyse seule, on montre ce que l'archive contient réellement et ce
      // que le script en déduit. La convention de nommage interne est une
      // donnée du producteur, susceptible de bouger d'un millésime à l'autre :
      // c'est ici qu'on le voit, avant d'avoir importé quoi que ce soit.
      if (dryRun) {
        console.log(`  ${contenu.length} entrée(s) dans l'archive. Cinq premières :`);
        for (const nom of contenu.slice(0, 5)) {
          console.log(`    ${nom}  →  département déduit : ${departementDuFichier(nom) ?? "aucun"}`);
        }
      }

      const fichiers = contenu.filter((nom) => {
        if (!/\.(csv|txt)$/i.test(nom)) return false;
        const dept = departementDuFichier(nom);
        if (!dept) return false;
        return tousDepartements || departementsVoulus.has(dept);
      });

      if (fichiers.length === 0) {
        console.log("  aucun département demandé dans cette archive\n");
        continue;
      }
      console.log(`  ${fichiers.length} fichier(s) à traiter`);

      for (const nomFichier of fichiers) {
        const dept = departementDuFichier(nomFichier);
        departementsTraites.add(dept);
        const stats = await traiterFichier(chemin, nomFichier, supabase, total);
        console.log(
          `  ${dept} — ${stats.retenus.toLocaleString("fr-FR")} lignes retenues ` +
            `sur ${stats.lus.toLocaleString("fr-FR")}`,
        );

        // Purge APRÈS le département, et seulement pour lui : c'est ce qui rend
        // l'import par tranches sûr. Une purge globale en fin de script
        // supprimerait les anciennes lignes de départements que la tranche en
        // cours n'a pas rechargés — on les perdrait jusqu'au prochain passage.
        const supprimees = await purgerAnciensMillesimes(supabase, dept, total);
        if (supprimees > 0) {
          console.log(
            `       ${supprimees.toLocaleString("fr-FR")} ligne(s) d'un millésime antérieur supprimée(s)`,
          );
        }
      }
      console.log("");
    }
  } finally {
    await nettoyerDossier(dossier);
  }

  console.log("─".repeat(58));
  console.log(`Départements traités : ${[...departementsTraites].sort().join(", ") || "aucun"}`);
  console.log(`Lignes lues          : ${total.lus.toLocaleString("fr-FR")}`);
  console.log(`Lignes retenues      : ${total.retenus.toLocaleString("fr-FR")}`);
  console.log(`SIREN fictifs (U…)   : ${total.sirenFictifs.toLocaleString("fr-FR")} — conservés sans SIREN`);
  if (total.doublons > 0) {
    console.log(
      `Subdivisions fusionnées : ${total.doublons.toLocaleString("fr-FR")} — même parcelle, ` +
        "même propriétaire, même droit",
    );
  }
  if (total.sansInsee > 0) {
    console.log(`Code INSEE indéterminable : ${total.sansInsee.toLocaleString("fr-FR")} — écartées`);
  }
  if (total.purgees > 0) {
    console.log(`Millésimes antérieurs purgés : ${total.purgees.toLocaleString("fr-FR")} lignes`);
  }
  if (dryRun) console.log("\nAucune écriture (--dry-run).");
  else console.log(`Lignes écrites       : ${total.ecrits.toLocaleString("fr-FR")}`);

  if (departementsTraites.size === 0) {
    console.warn(
      "\n⚠️ Aucun département n'a été traité. Vérifie les codes demandés :\n" +
        "   deux chiffres (01, 69), 2A/2B pour la Corse, 971→976 outre-mer.",
    );
  }
}

// ── Accès aux archives ───────────────────────────────────────────────────────
//
// Les archives font plusieurs gigaoctets : on ne les décompresse jamais en
// entier, on lit une entrée à la fois en flux. Trois outils savent le faire, et
// aucun n'est présent partout — d'où la détection au premier appel :
//
//   unzip       macOS, Linux, WSL
//   tar (bsdtar) Windows 10 1803+, macOS ; sait lire les zip malgré son nom
//   PowerShell   Windows, via System.IO.Compression en dernier recours
//
// Le résultat est mémorisé : la détection ne coûte qu'un lancement de processus.

let backendZip = null;

/**
 * Supprime le dossier temporaire sans jamais masquer l'erreur en cours.
 *
 * Ce nettoyage vit dans un `finally` : s'il lève, son exception REMPLACE celle
 * qui a provoqué l'arrêt, et la vraie cause disparaît. C'est arrivé — un échec
 * d'écriture en base s'est présenté comme un « EBUSY: resource busy or locked ».
 *
 * Sur Windows, un fichier reste verrouillé quelques instants après la mort du
 * processus qui le lisait, d'où les tentatives espacées. Au pire, on abandonne
 * avec un simple avertissement : laisser traîner un fichier temporaire est sans
 * conséquence, perdre la cause d'un échec ne l'est pas.
 */
async function nettoyerDossier(dossier) {
  for (let n = 1; n <= 5; n += 1) {
    try {
      await rm(dossier, { recursive: true, force: true });
      return;
    } catch (e) {
      if (n === 5) {
        console.warn(`\n⚠ Dossier temporaire non supprimé (${e.code ?? e.message}) : ${dossier}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 250 * n));
    }
  }
}

/** Renvoie la sortie de la commande, ou null si elle est absente ou en échec. */
function sortieCommande(commande, args) {
  return new Promise((resolve) => {
    const p = spawn(commande, args);
    let sortie = "";
    p.stdout.on("data", (d) => { sortie += d.toString(); });
    p.stderr.on("data", () => {});
    p.on("error", () => resolve(null));
    p.on("close", (code) => resolve(code === 0 ? sortie : null));
  });
}

async function detecterBackendZip() {
  if (backendZip) return backendZip;

  if (await sortieCommande("unzip", ["-v"])) {
    backendZip = "unzip";
  } else {
    // `tar` ne convient QUE s'il s'agit de bsdtar — celui de Windows 10 1803+
    // et de macOS, qui lit nativement les zip. GNU tar, majoritaire sur Linux,
    // porte le même nom et répond à `--version`, mais rejette l'archive avec
    // « This does not look like a tar archive ». Tester la présence ne suffit
    // donc pas : il faut tester l'implémentation.
    const version = await sortieCommande("tar", ["--version"]);
    if (version && /bsdtar/i.test(version)) backendZip = "tar";
    else if (process.platform === "win32") backendZip = "powershell";
    else {
      throw new Error(
        "Aucun outil capable de lire un zip n'a été trouvé.\n" +
          "Installe `unzip` — sur Debian/Ubuntu : sudo apt install unzip.",
      );
    }
  }

  console.log(`Décompression : ${backendZip}\n`);
  return backendZip;
}

/** Encode un script PowerShell en -EncodedCommand : plus de guillemets à échapper. */
function encoderPowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

/**
 * Lance un processus qui écrit sur stdout et renvoie `{ flux, fin, arreter }`.
 *
 * L'échec est exposé par la promesse `fin`, à attendre APRÈS avoir consommé le
 * flux — et surtout pas injecté dans le flux lui-même : un `error` émis sur
 * stdout une fois la lecture terminée n'a plus d'auditeur et fait tomber tout
 * le processus. C'est exactement ce que faisait une première version, sur une
 * entrée absente de l'archive.
 */
function lancer(commande, args) {
  const p = spawn(commande, args);
  let erreur = "";
  p.stderr.on("data", (d) => { erreur += d.toString(); });

  const fin = new Promise((resolve, reject) => {
    p.on("error", (e) => reject(new Error(`${commande} n'a pas pu être lancé : ${e.message}`)));
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${commande} a échoué (code ${code}) : ${erreur.trim() || "sans message"}`));
    });
  });
  // Sans ce filet, un échec survenant avant que l'appelant n'attende `fin`
  // remonterait en rejet non géré.
  fin.catch(() => {});

  return { flux: p.stdout, fin, arreter: () => p.kill() };
}

/** Liste les entrées d'une archive, sans rien décompresser. */
async function listerZip(chemin) {
  const backend = await detecterBackendZip();

  const args = {
    unzip: ["-Z1", chemin],
    tar: ["-tf", chemin],
  }[backend];

  const p = args
    ? spawn(backend, args)
    : spawn("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        encoderPowerShell(
          "Add-Type -AssemblyName System.IO.Compression.FileSystem;" +
            `$z=[IO.Compression.ZipFile]::OpenRead(${JSON.stringify(chemin)});` +
            "$z.Entries | ForEach-Object { $_.FullName };" +
            "$z.Dispose()",
        ),
      ]);

  return new Promise((resolve, reject) => {
    let sortie = "";
    let erreur = "";
    p.stdout.on("data", (d) => { sortie += d.toString(); });
    p.stderr.on("data", (d) => { erreur += d.toString(); });
    p.on("error", (e) => reject(new Error(`${backend} n'a pas pu être lancé : ${e.message}`)));
    p.on("close", (code) => {
      if (code !== 0 && !sortie) reject(new Error(`${backend} a échoué : ${erreur.trim()}`));
      else resolve(sortie.split("\n").map((s) => s.trim()).filter(Boolean));
    });
  });
}

/** Ouvre UNE entrée de l'archive en flux, sans la matérialiser sur disque. */
async function ouvrirEntreeZip(chemin, nomFichier) {
  const backend = await detecterBackendZip();

  if (backend === "unzip") return lancer("unzip", ["-p", chemin, nomFichier]);
  // -O envoie sur stdout au lieu d'écrire sur disque : c'est ce qui permet de
  // lire un département de 250 Mo sans jamais le matérialiser.
  if (backend === "tar") return lancer("tar", ["-xOf", chemin, nomFichier]);

  return lancer("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    encoderPowerShell(
      "Add-Type -AssemblyName System.IO.Compression.FileSystem;" +
        `$z=[IO.Compression.ZipFile]::OpenRead(${JSON.stringify(chemin)});` +
        `$e=$z.GetEntry(${JSON.stringify(nomFichier)});` +
        `if($null -eq $e){ throw ${JSON.stringify(`Entrée introuvable : ${nomFichier}`)} }` +
        "$s=$e.Open(); $o=[Console]::OpenStandardOutput(); $s.CopyTo($o);" +
        "$o.Flush(); $s.Dispose(); $z.Dispose()",
    ),
  ]);
}

/**
 * Supprime, pour UN département, les lignes des millésimes antérieurs.
 *
 * Le millésime fait partie de la clé d'unicité : sans cette purge, importer une
 * nouvelle année ajouterait une génération complète au lieu de remplacer la
 * précédente — environ 6,4 Go par an pour la France entière — et une parcelle
 * vendue entre-temps garderait indéfiniment son ancien propriétaire.
 *
 * Deux garde-fous. La purge est faite APRÈS que le département a été écrit,
 * jamais avant : une coupure en cours d'import laisse alors l'ancienne version
 * intacte plutôt qu'un trou. Et elle est limitée à ce département, ce qui rend
 * l'import par tranches sûr — importer 20 départements ne touche pas aux 76
 * autres, encore au millésime précédent.
 *
 * `--garder-historique` la désactive, pour qui veut comparer deux années : un
 * changement de propriétaire d'une année sur l'autre est un signal exploitable.
 */
async function purgerAnciensMillesimes(supabase, dept, total) {
  if (!supabase || garderHistorique) return 0;

  const { count, error } = await avecReprise(
    () =>
      supabase
        .from("proprietaires_personnes_morales")
        .delete({ count: "exact" })
        // Le code INSEE commence par le code département : « 69 » couvre 69000
        // à 69999, « 971 » les seuls 971xx, « 2A » la Corse-du-Sud.
        .like("code_insee", `${dept}%`)
        .neq("millesime", millesime),
    { surEchec: tracerReprise },
  );

  if (error) {
    // Un échec de purge ne doit pas perdre un import réussi : on avertit et on
    // continue. Le département reste simplement en double millésime.
    console.warn(`\n⚠ Purge du département ${dept} impossible : ${error.message}`);
    return 0;
  }

  total.purgees += count ?? 0;
  return count ?? 0;
}

/**
 * Écarte les lignes qui viseraient deux fois la même ligne en base.
 *
 * Le fichier décrit des SUBDIVISIONS FISCALES, pas des parcelles : une parcelle
 * y apparaît autant de fois qu'elle compte de subdivisions — d'où les deux
 * colonnes « Contenance » de l'en-tête, l'une pour la parcelle, l'autre pour la
 * subdivision. Aucune des colonnes que nous conservons n'est de niveau
 * subdivision : ces répétitions ne portent donc aucune information.
 *
 * Postgres, lui, refuse qu'un même `INSERT ... ON CONFLICT DO UPDATE` touche
 * deux fois la même ligne — « cannot affect row a second time ». Sans ce
 * dédoublonnage, l'import s'arrêtait sur le premier lot contenant une parcelle
 * à plusieurs subdivisions, ce qui arrive dès les premiers milliers de lignes.
 *
 * Dédoublonner par LOT suffit, et c'est voulu : deux occurrences séparées par
 * une frontière de lot partent dans deux requêtes distinctes, où l'ON CONFLICT
 * fait tranquillement une mise à jour. Dédoublonner sur le fichier entier
 * demanderait de garder en mémoire une clé par ligne — plusieurs centaines de
 * Mo sur les gros départements, plusieurs Go sur un import national.
 */
function dedoublonner(lot) {
  const parCle = new Map();
  // Séparateur NUL : cet octet ne peut apparaître dans aucun champ du CSV,
  // deux clés distinctes ne peuvent donc pas se confondre par concaténation.
  const SEP = String.fromCharCode(0);
  for (const rang of lot) {
    const cle = [rang.idu, rang.millesime, rang.denomination, rang.code_droit].join(SEP);
    parCle.set(cle, rang);
  }
  return [...parCle.values()];
}

/**
 * Lit un fichier du zip en flux, sans jamais le matérialiser sur disque ni le
 * charger en mémoire : certains départements dépassent 250 Mo décompressés.
 */
async function traiterFichier(cheminZip, nomFichier, supabase, total) {
  // Deux profils d'encodage, vérifiés sur les fichiers réels : UTF-8 sans
  // guillemets à partir de 2024, Latin-1 avec guillemets et CRLF avant.
  const encodage = millesime >= 2024 ? "utf8" : "latin1";

  const { flux, fin, arreter } = await ouvrirEntreeZip(cheminZip, nomFichier);
  // On fixe l'encodage sur le flux lui-même : décoder en UTF-8 puis
  // « re-convertir » en Latin-1 après coup perd les accents, les octets
  // invalides ayant déjà été remplacés.
  flux.setEncoding(encodage);
  const rl = createInterface({ input: flux, crlfDelay: Infinity });

  const stats = { lus: 0, retenus: 0 };
  let lot = [];
  let premiereLigne = true;

  const viderLot = async () => {
    if (lot.length === 0) return;
    const aEcrire = dedoublonner(lot);
    total.doublons += lot.length - aEcrire.length;

    if (supabase) {
      const { error } = await avecReprise(
        () =>
          supabase
            .from("proprietaires_personnes_morales")
            .upsert(aEcrire, { onConflict: "idu,millesime,denomination,code_droit" }),
        { surEchec: tracerReprise },
      );
      if (error) throw new Error(`Écriture impossible (${nomFichier}) : ${error.message}`);
      total.ecrits += aEcrire.length;
    }
    lot = [];
  };

  try {
    for await (const ligne of rl) {
      if (premiereLigne) { premiereLigne = false; continue; } // en-tête
      if (!ligne.trim()) continue;

      stats.lus += 1;
      total.lus += 1;

      const c = decouper(ligne);
      if (c.length < 24) continue;

      const insee = codeInsee(c[COL.departement], c[COL.codeDirection], c[COL.codeCommune]);
      if (!insee || !/^[0-9AB]{5}$/.test(insee)) { total.sansInsee += 1; continue; }

      const denomination = nettoyer(c[COL.denomination]);
      const section = nettoyer(c[COL.section]);
      const numero = nettoyer(c[COL.numeroPlan]);
      if (!denomination || !section || !numero) continue;

      // Les SIREN commençant par « U » sont des identifiants FICTIFS créés par la
      // DGFiP (descriptif § 2.7). Les stocker exposerait à un rapprochement faux
      // avec Sirene : on garde la ligne, on jette l'identifiant.
      const sirenBrut = (c[COL.siren] ?? "").trim().toUpperCase();
      let siren = null;
      if (/^[0-9]{9}$/.test(sirenBrut)) siren = sirenBrut;
      else if (sirenBrut.startsWith("U")) total.sirenFictifs += 1;

      lot.push({
        code_insee: insee,
        prefixe: (c[COL.prefixe] ?? "").trim().padStart(3, "0"),
        section,
        numero_parcelle: numero,
        idu: construireIdu(insee, c[COL.prefixe], section, numero),
        denomination,
        siren,
        forme_juridique: nettoyer(c[COL.formeJuridiqueAbregee]),
        forme_juridique_code: nettoyer(c[COL.formeJuridiqueCode]),
        code_droit: extraireCode(c[COL.codeDroit]) ?? "",
        nom_voie: nettoyer(c[COL.nomVoie]),
        numero_voirie: nettoyer(c[COL.numeroVoirie]),
        commune_nom: nettoyer(c[COL.nomCommune]),
        millesime,
      });
      stats.retenus += 1;
      total.retenus += 1;

      if (lot.length >= TAILLE_LOT) await viderLot();
    }

    await viderLot();
  } catch (e) {
    // Une erreur d'écriture interrompt la boucle alors que la décompression
    // tourne encore : sans ce kill, le processus resterait à remplir un tube
    // que plus personne ne lit. On ne tue QUE sur erreur — tuer après une
    // lecture réussie ferait échouer `fin` sur un processus encore en train de
    // se terminer normalement.
    arreter();
    // On attend sa mort effective avant de rendre la main : sous Windows, le
    // verrou sur l'archive ne tombe qu'à ce moment-là, et le nettoyage qui suit
    // échouerait en EBUSY.
    await fin.catch(() => {});
    throw e;
  } finally {
    rl.close();
  }

  // Attendu APRÈS la lecture : c'est ici que remonte une archive corrompue ou
  // une entrée absente, que le flux vide seul ne signalerait pas.
  await fin;
  return stats;
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
