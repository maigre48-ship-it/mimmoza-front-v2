#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Mimmoza – Évaluation sources SNE
 * ─────────────────────────────────────────────────────────────────────────────
 * Teste chaque source officielle susceptible de fournir, par commune :
 *   code_insee | demandes_en_attente | attributions_annuelles | tension_demande
 *
 * Ce script fait de vrais appels HTTP. Il ne crée aucune donnée fictive.
 * Sortie : rapport complet dans la console + recommandation finale.
 *
 * Usage :
 *   deno run --allow-net scripts/_SNE_EVALUATION.ts
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type Verdict = "EXPLOITABLE" | "PARTIEL" | "INACCESSIBLE" | "MAUVAISE_MAILLE" | "SANS_COG";

interface SourceResult {
  id: string;
  label: string;
  url: string;
  httpStatus: number | null;
  contentType: string | null;
  sizeKo: number | null;
  redirectUrl: string | null;
  hasJson: boolean;
  hasCsv: boolean;
  hasExcel: boolean;
  hasCodeInsee: boolean | null;
  maille: string | null;
  sessionRequired: boolean;
  verdict: Verdict;
  notes: string[];
}

// ─── Utilitaires HTTP ─────────────────────────────────────────────────────────

const UA = "Mimmoza-SNE-Eval/1.0 (contact@mimmoza.fr; evaluation open data)";
const TIMEOUT_MS = 12_000;

async function probe(url: string): Promise<{
  status: number | null;
  contentType: string | null;
  sizeKo: number | null;
  redirectUrl: string | null;
  bodySnippet: string | null;
  error: string | null;
}> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml,application/json,*/*",
      },
    });

    clearTimeout(timer);

    const ct = res.headers.get("content-type") ?? null;
    const cl = res.headers.get("content-length");
    const sizeKo = cl ? Math.round(parseInt(cl) / 1024) : null;
    const redirectUrl = res.redirected ? res.url : null;

    // Lecture limitée à 4 Ko pour détection de format
    let bodySnippet: string | null = null;
    if (res.body) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < 4096) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.length;
      }
      reader.cancel().catch(() => {});
      const buf = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) { buf.set(c, offset); offset += c.length; }
      bodySnippet = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    }

    return { status: res.status, contentType: ct, sizeKo, redirectUrl, bodySnippet, error: null };

  } catch (err) {
    clearTimeout(timer);
    return {
      status: null, contentType: null, sizeKo: null,
      redirectUrl: null, bodySnippet: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Détecteurs ───────────────────────────────────────────────────────────────

function detectFormats(ct: string | null, body: string | null) {
  const ctLow = (ct ?? "").toLowerCase();
  const bodyLow = (body ?? "").toLowerCase().slice(0, 2000);
  return {
    hasJson:  ctLow.includes("json") || bodyLow.startsWith("{") || bodyLow.startsWith("["),
    hasCsv:   ctLow.includes("csv") || ctLow.includes("text/plain"),
    hasExcel: ctLow.includes("spreadsheet") || ctLow.includes("excel") ||
              ctLow.includes("xlsx") || ctLow.includes("xls"),
  };
}

function detectCodeInsee(body: string | null): boolean | null {
  if (!body) return null;
  const low = body.toLowerCase();
  return (
    low.includes("code_insee") ||
    low.includes("code insee") ||
    low.includes("codecommune") ||
    low.includes("code_commune") ||
    low.includes('"insee"') ||
    /\b\d{5}\b/.test(body.slice(0, 3000))
  );
}

// ─── Évaluation d'une source ──────────────────────────────────────────────────

async function evalSource(cfg: {
  id: string;
  label: string;
  url: string;
  maille: string | null;
  sessionRequired: boolean;
  notes: string[];
}): Promise<SourceResult> {

  console.log(`\n  → [${cfg.id}] ${cfg.label}`);
  console.log(`    ${cfg.url}`);

  const r = await probe(cfg.url);
  const formats = detectFormats(r.contentType, r.bodySnippet);
  const hasCodeInsee = detectCodeInsee(r.bodySnippet);

  if (r.error) {
    console.log(`    ✗ Erreur : ${r.error}`);
  } else {
    console.log(`    HTTP ${r.status} | ${r.contentType ?? "no content-type"} | ${r.sizeKo !== null ? r.sizeKo + " Ko" : "taille ?"}`);
    if (r.redirectUrl) console.log(`    ↳ Redirect → ${r.redirectUrl}`);
    console.log(`    Formats : JSON=${formats.hasJson} CSV=${formats.hasCsv} Excel=${formats.hasExcel} | Code INSEE: ${hasCodeInsee === null ? "?" : hasCodeInsee ? "détecté" : "absent"}`);
  }

  let verdict: Verdict;
  if (r.error || r.status === null || r.status >= 400) {
    verdict = "INACCESSIBLE";
  } else if (cfg.sessionRequired) {
    verdict = "PARTIEL";
  } else if (cfg.maille && cfg.maille !== "commune") {
    verdict = "MAUVAISE_MAILLE";
  } else if (hasCodeInsee === false && !formats.hasJson) {
    verdict = "SANS_COG";
  } else if ((formats.hasJson || formats.hasCsv || formats.hasExcel) && cfg.maille === "commune" && !cfg.sessionRequired) {
    verdict = "EXPLOITABLE";
  } else {
    verdict = "PARTIEL";
  }

  return { ...cfg, httpStatus: r.status, contentType: r.contentType, sizeKo: r.sizeKo,
           redirectUrl: r.redirectUrl, ...formats, hasCodeInsee, verdict };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {

  console.log("══════════════════════════════════════════════════════════════════");
  console.log("  Mimmoza – Évaluation sources SNE");
  console.log(`  ${new Date().toISOString()}`);
  console.log("══════════════════════════════════════════════════════════════════");

  const results: SourceResult[] = [];

  // ── A : data.gouv.fr – ressource brute SNE ──────────────────────────────
  console.log("\n[A] data.gouv.fr – Ressource directe déclarée dans le dataset SNE");
  results.push(await evalSource({
    id: "A",
    label: "data.gouv.fr – ressource e62dc265 (GIP SNE)",
    url: "https://www.data.gouv.fr/api/1/datasets/r/e62dc265-011d-4277-ad03-19d5591b2a21",
    maille: null,
    sessionRequired: false,
    notes: [
      "Unique ressource déclarée dans le dataset 'Demande de logement social'.",
      "Marquée 'Le robot data.gouv.fr n'a pas pu accéder' (mai 2026).",
      "Type déclaré : 'API' – lien vers data.logement.gouv.fr.",
    ],
  }));

  // ── B : data.logement.gouv.fr/statistiques – portail GIP SNE ───────────
  console.log("\n[B] data.logement.gouv.fr – Portail statistiques (application Java)");
  results.push(await evalSource({
    id: "B",
    label: "data.logement.gouv.fr/statistiques (portail GIP SNE)",
    url: "https://www.data.logement.gouv.fr/statistiques/",
    maille: "commune",
    sessionRequired: true,
    notes: [
      "Application Java Struts. jsessionid intégré dans l'URL à chaque réponse.",
      "Données disponibles aux niveaux EPCI et COMMUNE (confirmé HTML).",
      "27 régions (ancienne carte pré-2016 : Alsace, Aquitaine, Auvergne…).",
      "Téléchargement : formulaire POST sans URL directe stable.",
      "Format : Excel ou PDF. SANS code officiel géographique (COG).",
      "→ Matching uniquement par nom de commune : source d'erreurs.",
    ],
  }));

  // ── B2 : test endpoint téléchargement sans session ──────────────────────
  console.log("\n[B2] data.logement.gouv.fr – Endpoint téléchargement sans session");
  results.push(await evalSource({
    id: "B2",
    label: "data.logement.gouv.fr – telechargement.action (sans session)",
    url: "https://www.data.logement.gouv.fr/statistiques/telechargement.action",
    maille: "commune",
    sessionRequired: true,
    notes: [
      "Test de l'endpoint de téléchargement sans jsessionid valide.",
      "Attendu : redirect vers accueil ou erreur 403/500.",
    ],
  }));

  // ── C : data.logement.gouv.fr – portail principal (version récente) ─────
  console.log("\n[C] data.logement.gouv.fr – Portail dataservices (v2)");
  results.push(await evalSource({
    id: "C",
    label: "data.logement.gouv.fr (accueil portail v2)",
    url: "https://www.data.logement.gouv.fr/",
    maille: null,
    sessionRequired: false,
    notes: [
      "Portail plus récent. Peut exposer une API REST ou catalogue datasets.",
      "À distinguer du portail /statistiques/ (application Java legacy).",
    ],
  }));

  // ── D : data.gouv.fr API metadata – dataset complet ─────────────────────
  console.log("\n[D] data.gouv.fr – Metadata JSON du dataset SNE");
  results.push(await evalSource({
    id: "D",
    label: "data.gouv.fr API – metadata dataset 'demande-de-logement-social'",
    url: "https://www.data.gouv.fr/api/1/datasets/demande-de-logement-social/",
    maille: null,
    sessionRequired: false,
    notes: [
      "API JSON data.gouv.fr : liste toutes les ressources du dataset.",
      "Permet de détecter si un CSV/Excel direct a été ajouté récemment.",
      "Doit retourner HTTP 200 JSON avec 'resources' array.",
    ],
  }));

  // ── E : DRIHL IDF – socle de données 2024 (communes) ────────────────────
  // Source confirmée : drihl.ile-de-france.developpement-durable.gouv.fr
  // Socle 2024 publié le 23 juin 2025. Maille commune CONFIRMÉE.
  // MAIS : hébergé sur le site DRIHL (pas data.gouv.fr), format Excel/PDF.
  // PDF notice : /IMG/pdf/socles2024-drihl_lls.pdf
  // Excel data : /IMG/xlsx/... (URL exacte à récupérer depuis la page)
  console.log("\n[E] DRIHL IDF – Socle de données 2024 (demandes + attributions communes)");
  results.push(await evalSource({
    id: "E",
    label: "DRIHL IDF – socle demandes/attributions 2024 (page principale)",
    url: "https://www.drihl.ile-de-france.developpement-durable.gouv.fr/demandes-et-attributions-de-logements-sociaux-r552.html",
    maille: "commune",
    sessionRequired: false,
    notes: [
      "DRIHL IDF publie un 'socle de données' annuel depuis 2017.",
      "Millésime 2024 publié le 23 juin 2025.",
      "Maille COMMUNE confirmée (région, département, EPCI, EPT, commune).",
      "Contenu : demandes en attente au 31/12 + attributions de l'année.",
      "Format : Excel + PDF. Hébergé sur drihl.ile-de-france.developpement-durable.gouv.fr.",
      "PAS sur data.gouv.fr → URL directe Excel à extraire depuis la page HTML.",
      "Périmètre : IDF uniquement (75, 77, 78, 91, 92, 93, 94, 95).",
      "→ Meilleure source disponible pour brancher SNE en IDF.",
    ],
  }));

  // ── E2 : DRIHL IDF – PDF notice du socle 2024 ───────────────────────────
  console.log("\n[E2] DRIHL IDF – PDF notice socle 2024 (test accès direct fichier)");
  results.push(await evalSource({
    id: "E2",
    label: "DRIHL IDF – PDF socle 2024 (accès direct)",
    url: "https://www.drihl.ile-de-france.developpement-durable.gouv.fr/IMG/pdf/socles2024-drihl_lls.pdf",
    maille: "commune",
    sessionRequired: false,
    notes: [
      "Test d'accès direct au PDF de notice du socle 2024.",
      "Si HTTP 200 → le serveur DRIHL sert les fichiers sans auth.",
      "L'Excel de données sera à une URL similaire /IMG/xlsx/socles2024-drihl_lls.xlsx.",
      "Confirme la stratégie de téléchargement direct si OK.",
    ],
  }));

  // ── F : SDES – données nationales SNE ───────────────────────────────────
  console.log("\n[F] SDES – Données nationales SNE");
  results.push(await evalSource({
    id: "F",
    label: "SDES – Demandes logement social 2023 (rapport national)",
    url: "https://www.statistiques.developpement-durable.gouv.fr/les-demandes-de-logement-social-en-2023",
    maille: "national",
    sessionRequired: false,
    notes: [
      "Rapport national SDES. Données agrégées : national + région + département.",
      "Pas de maille commune dans ce rapport.",
      "Fichiers Excel disponibles en téléchargement libre.",
      "Hors périmètre direct pour Mimmoza (granularité insuffisante).",
    ],
  }));

  // ── G : DRIHL IDF – tentative Excel direct (pattern URL) ────────────────
  // Le socle 2023 est disponible. On teste si le serveur DRIHL sert les xlsx directement.
  console.log("\n[G] DRIHL IDF – Tentative accès Excel socle 2023 (pattern URL connu)");
  results.push(await evalSource({
    id: "G",
    label: "DRIHL IDF – Excel socle demandes/attributions 2023",
    url: "https://www.drihl.ile-de-france.developpement-durable.gouv.fr/IMG/xlsx/socles2023_demandes_et_attributions_commune.xlsx",
    maille: "commune",
    sessionRequired: false,
    notes: [
      "Test par inférence du pattern d'URL DRIHL pour les fichiers Excel.",
      "Si HTTP 200 + content-type xlsx → téléchargement direct possible.",
      "Si 404 → l'URL exacte doit être extraite depuis la page HTML du socle.",
      "URL de référence page : /demandes-et-attributions-de-logements-sociaux-r552.html",
    ],
  }));

  // ─── Rapport final ───────────────────────────────────────────────────────

  console.log("\n\n══════════════════════════════════════════════════════════════════");
  console.log("  RAPPORT FINAL");
  console.log("══════════════════════════════════════════════════════════════════\n");

  const icons: Record<Verdict, string> = {
    EXPLOITABLE:     "✅ EXPLOITABLE",
    PARTIEL:         "⚠️  PARTIEL",
    INACCESSIBLE:    "❌ INACCESSIBLE",
    MAUVAISE_MAILLE: "🔶 MAUVAISE MAILLE",
    SANS_COG:        "🔷 SANS CODE INSEE",
  };

  for (const r of results) {
    const size  = r.sizeKo !== null ? `${r.sizeKo} Ko` : "taille ?";
    const insee = r.hasCodeInsee === null ? "?" : r.hasCodeInsee ? "✓" : "✗";
    console.log(`[${r.id}] ${r.label}`);
    console.log(`     Verdict  : ${icons[r.verdict]}`);
    console.log(`     HTTP     : ${r.httpStatus ?? "ERR"} | ${r.contentType ?? "-"} | ${size}`);
    console.log(`     Formats  : JSON=${r.hasJson} CSV=${r.hasCsv} Excel=${r.hasExcel}`);
    console.log(`     Maille   : ${r.maille ?? "?"} | Code INSEE: ${insee} | Session: ${r.sessionRequired ? "requise" : "non"}`);
    r.notes.forEach((n) => console.log(`     · ${n}`));
    console.log();
  }

  // ─── Recommandation opérationnelle ───────────────────────────────────────

  const exploitables = results.filter((r) => r.verdict === "EXPLOITABLE");
  const eMain        = results.find((r) => r.id === "E");
  const eExcel       = results.find((r) => r.id === "E2");
  const gExcel       = results.find((r) => r.id === "G");
  const bPortail     = results.find((r) => r.id === "B");

  console.log("══════════════════════════════════════════════════════════════════");
  console.log("  RECOMMANDATION OPÉRATIONNELLE");
  console.log("══════════════════════════════════════════════════════════════════\n");

  if (exploitables.length > 0) {
    console.log("✅  Source(s) directement exploitable(s) :");
    exploitables.forEach((r) => console.log(`   [${r.id}] ${r.label}`));
    console.log("\n→ Prochain sprint : créer import_sne_idf.ts (DRIHL) ou import_sne_national.ts");
  } else {
    console.log("⚠️  Aucune source exploitable sans étape intermédiaire. Résumé :\n");
  }

  // ── CHEMIN 1 : DRIHL IDF Excel direct ────────────────────────────────────
  const drihlOk = eMain?.httpStatus === 200 || eExcel?.httpStatus === 200 || gExcel?.httpStatus === 200;
  console.log(`CHEMIN 1 – DRIHL IDF Excel [${drihlOk ? "✅ À TENTER" : "⚠️  tester manuellement"}]`);
  console.log("────────────────────────────────────────────────────────────────");
  console.log("  Périmètre   : IDF uniquement (depts 75 77 78 91 92 93 94 95)");
  console.log("  Données     : demandes en attente + attributions, niveau COMMUNE");
  console.log("  Millésime   : 2024 (publié juin 2025), mis à jour annuellement");
  console.log("  Source      : drihl.ile-de-france.developpement-durable.gouv.fr");
  console.log("  Effort      : ~30 min si l'URL Excel directe est accessible");
  console.log("");
  console.log("  Action 1 – Récupérer l'URL Excel exacte :");
  console.log("    Aller sur la page du socle 2024 :");
  console.log("    https://www.drihl.ile-de-france.developpement-durable.gouv.fr/demandes-et-attributions-de-logements-sociaux-r552.html");
  console.log("    → Clic droit sur le lien Excel → Copier l'adresse");
  console.log("    → Vérifier que l'URL contient '/IMG/xlsx/' ou équivalent");
  console.log("");
  console.log("  Action 2 – Tester l'accès direct (sans auth) :");
  console.log("    curl -I <URL_EXCEL_DRIHL>");
  console.log("    # Attendu : HTTP 200 + content-type: application/vnd.openxmlformats...");
  console.log("");
  console.log("  Action 3 – Si OK : renseigner l'URL dans import_sne_idf.ts");
  console.log("    La structure Excel DRIHL contient probablement :");
  console.log("    code_commune | nom_commune | demandes_en_attente | attributions");
  console.log("    Présence du code INSEE à vérifier dans le fichier ouvert.");
  console.log("");

  // ── CHEMIN 2 : data.logement.gouv.fr session Java ────────────────────────
  const portailOk = bPortail?.httpStatus === 200;
  console.log(`CHEMIN 2 – data.logement.gouv.fr session Java [${portailOk ? "⚠️  COMPLEXE" : "❌ INACCESSIBLE"}]`);
  console.log("────────────────────────────────────────────────────────────────");
  console.log("  Périmètre   : national (toutes communes SRU)");
  console.log("  Données     : demandes + attributions niveau commune");
  console.log("  Blocage 1   : session Java (jsessionid) → 1 GET init + 27 POST (1/région)");
  console.log("  Blocage 2   : Excel SANS code INSEE → fuzzy join nom commune (risqué)");
  console.log("  Effort      : ~3h de développement + validation manuelle");
  if (portailOk) {
    console.log("  Test manuel curl (à faire depuis ta machine, pas ce container) :");
    console.log("    # Étape 1 : obtenir le jsessionid");
    console.log("    curl -c /tmp/sne.jar https://www.data.logement.gouv.fr/statistiques/ -s -o /dev/null -w '%{http_code}'");
    console.log("    # Étape 2 : télécharger Excel IDF (region=14 = Île-de-France ancienne)");
    console.log("    curl -b /tmp/sne.jar \\");
    console.log("      'https://www.data.logement.gouv.fr/statistiques/telechargement.action' \\");
    console.log("      --data 'region=14&typeRapport=commune&format=excel' \\");
    console.log("      -o /tmp/sne_idf.xlsx");
    console.log("    # Si xlsx valide → inspecter les colonnes → décider si import_sne_national.ts");
  }
  console.log("");

  // ── CHEMIN 3 : maintenir SNE absent ──────────────────────────────────────
  console.log("CHEMIN 3 – Maintenir SNE absent (V1 opérationnel avec SRU seul)");
  console.log("────────────────────────────────────────────────────────────────");
  console.log("  dataStatus='partial', scoreLabel basé sur SRU uniquement.");
  console.log("  L'Edge Function gère déjà ce cas. Aucune modification requise.");
  console.log("");
  console.log("─── ORDRE DE PRIORITÉ ───────────────────────────────────────────");
  console.log("  1. Ouvrir la page DRIHL 2024 → récupérer URL Excel → test curl");
  console.log("     Si Excel accessible et contient code commune → CHEMIN 1");
  console.log("  2. Si CHEMIN 1 bloqué → test manuel curl data.logement.gouv.fr");
  console.log("     Si Excel téléchargeable et structuré → CHEMIN 2");
  console.log("  3. Sinon → CHEMIN 3 (V1 reste opérationnel)");
  console.log("");

  console.log("══════════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Erreur non gérée :", err);
  Deno.exit(1);
});