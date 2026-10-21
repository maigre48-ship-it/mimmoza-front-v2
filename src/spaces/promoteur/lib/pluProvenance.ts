// src/spaces/promoteur/lib/pluProvenance.ts
//
// LOT L2 — PROVENANCE PLU PAR VALEUR (module pur, sans import : testable sous node:test).
//
// Chaque valeur réglementaire du ruleset résolu (`mimmoza.plu.resolved_ruleset_v1`)
// peut porter : document source (id, intitulé, commune, idurba / datvalid GPU),
// zone, article, extrait littéral (≤ 400 caractères), page, méthode d'extraction
// (regex | llm | saisie | cache) et confiance.
//
// FORMAT (additif, rétrocompatible) : le ruleset garde `version: "plu_ruleset_v1"`
// (6 lecteurs du front testent cette valeur) et gagne :
//   provenance_version: "plu_provenance_v1"
//   document: DocumentPlu
//   provenance: { "<chemin du champ résolu>": ValeurProvenancePlu }
// Un ruleset v1 SANS `provenance_version` reste lisible : ses valeurs n'ont
// aucune provenance documentaire (« à vérifier » tant qu'une personne nommée
// ne les valide pas avec une référence identifiant le document).

export const PROVENANCE_VERSION = "plu_provenance_v1";
export const EXTRAIT_MAX = 400;
/** Au-delà de cet âge (années), la date du document est signalée. */
export const AGE_DOCUMENT_ALERTE_ANS = 10;

export type MethodeExtraction = "regex" | "llm" | "saisie" | "cache";
const METHODES: ReadonlySet<string> = new Set(["regex", "llm", "saisie", "cache"]);

export interface ValeurProvenancePlu {
  readonly champ: string;
  readonly valeur: number | null;
  readonly regle: string | null;
  readonly article: string | null;
  readonly articleIntitule: string | null;
  /** R2 — zone d'appartenance de l'article (intitulé ou en-tête de section), null si inconnue. */
  readonly articleZone: string | null;
  readonly articleZoneQualifie: boolean;
  readonly extrait: string | null;
  readonly page: number | null;
  readonly methode: MethodeExtraction;
  readonly confiance: number | null;
  readonly motif: string | null;
  /** R4 (A1-ter) — « conditionnel » : recul mesuré depuis l'axe, les berges… (jamais documentaire). */
  readonly statut?: "conditionnel" | null;
  readonly reference?: "axe" | "berges" | "autre" | null;
}

export interface DocumentPlu {
  readonly id: string | null;
  readonly intitule: string | null;
  readonly communeInsee: string | null;
  readonly communeNom: string | null;
  readonly idurba: string | null;
  readonly datvalid: string | null;
  readonly dateApprobation: string | null;
  readonly nomfic: string | null;
  readonly correspondanceGpu: string | null;
  readonly pages: number | null;
  /** R2 — empreinte SHA-256 du texte analysé (renvoyée par le serveur) ; id = « plu-txt- » + 16 premiers caractères. */
  readonly empreinteSha256: string | null;
}

export interface ProvenancePlu {
  readonly version: string;
  readonly document: DocumentPlu | null;
  readonly valeurs: Readonly<Record<string, ValeurProvenancePlu>>;
}

const txt = (v: unknown, max = 300): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Code de zone normalisé (« ub 1 » → « UB1 »). */
export const normZone = (z: string | null | undefined): string | null => (typeof z === "string" && z.trim() ? z.replace(/\s+/g, "").toUpperCase() : null);
const dateIso = (v: unknown): string | null => {
  const s = txt(v, 40);
  if (!s) return null;
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  if (!m) return null;
  const a = Number(m[1]), mo = Number(m[2]), j = Number(m[3]);
  return a >= 1900 && a <= 2100 && mo >= 1 && mo <= 12 && j >= 1 && j <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/** Lit (et assainit) une provenance de valeur, au format serveur (snake_case) ou front (camelCase). */
export function lireValeurProvenance(x: unknown, champ: string): ValeurProvenancePlu | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const methode = txt(o.methode, 10);
  if (!methode || !METHODES.has(methode)) return null;
  const conf = num(o.confiance);
  const page = num(o.page);
  const article = typeof o.article === "number" ? String(o.article) : txt(o.article, 20);
  return {
    champ,
    valeur: num(o.valeur),
    regle: txt(o.regle, 40),
    article,
    articleIntitule: txt(o.article_intitule ?? o.articleIntitule, 120),
    articleZone: normZone(txt(o.article_zone ?? o.articleZone, 12)),
    articleZoneQualifie: (o.article_zone_qualifie ?? o.articleZoneQualifie) === true,
    extrait: txt(o.extrait, EXTRAIT_MAX),
    page: page !== null && Number.isInteger(page) && page >= 1 ? page : null,
    methode: methode as MethodeExtraction,
    confiance: conf === null ? null : Math.max(0, Math.min(1, conf)),
    motif: txt(o.motif, 60),
    statut: o.statut === "conditionnel" || txt(o.regle, 40) === "CONDITIONNEL" ? "conditionnel" : null,
    reference: o.reference === "axe" || o.reference === "berges" || o.reference === "autre" ? o.reference : null,
  };
}

export function lireDocument(x: unknown): DocumentPlu | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const d: DocumentPlu = {
    id: txt(o.id, 120),
    intitule: txt(o.intitule, 200),
    communeInsee: txt(o.commune_insee ?? o.communeInsee, 10),
    communeNom: txt(o.commune_nom ?? o.communeNom, 120),
    idurba: txt(o.idurba, 80),
    datvalid: dateIso(o.datvalid),
    dateApprobation: dateIso(o.date_approbation ?? o.dateApprobation),
    nomfic: txt(o.nomfic, 200),
    correspondanceGpu: txt(o.correspondance_gpu ?? o.correspondanceGpu, 40),
    pages: num(o.pages),
    empreinteSha256: txt(o.empreinte_sha256 ?? o.empreinteSha256, 64),
  };
  return d.id || d.idurba || d.intitule ? d : null;
}

/** Provenance d'un ruleset résolu ; null pour un ruleset v1 sans provenance (ancien format). */
export function lireProvenancePlu(rs: Record<string, unknown> | null | undefined): ProvenancePlu | null {
  if (!rs || rs.provenance_version !== PROVENANCE_VERSION) return null;
  const brut = rs.provenance;
  const valeurs: Record<string, ValeurProvenancePlu> = {};
  if (brut && typeof brut === "object" && !Array.isArray(brut)) {
    for (const [champ, v] of Object.entries(brut as Record<string, unknown>)) {
      const p = lireValeurProvenance(v, champ);
      if (p) valeurs[champ] = p;
    }
  }
  return { version: PROVENANCE_VERSION, document: lireDocument(rs.document), valeurs };
}

/** Le document est-il identifié (identifiant d'analyse ou identifiant GPU) ? */
export function documentIdentifie(doc: DocumentPlu | null | undefined): boolean {
  return !!doc && !!(doc.id || doc.idurba);
}

/**
 * R2 (A8) — l'identifiant d'analyse est-il cohérent avec l'empreinte SHA-256
 * renvoyée par le serveur (« plu-txt- » + 16 premiers caractères) ? Un document
 * dont l'identifiant ne se vérifie pas est une « source locale non vérifiée »
 * (stockage local modifié, ancien format) : aucune référence documentaire.
 */
export function documentVerifiable(doc: DocumentPlu | null | undefined): boolean {
  if (!documentIdentifie(doc)) return false;
  if (!doc!.id) return !!doc!.idurba;
  const e = (doc!.empreinteSha256 ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(e) || /^(.)\1+$/.test(e)) return false;
  return doc!.id === `plu-txt-${e.slice(0, 16)}`;
}

function motifNombre(v: number): string {
  if (Number.isInteger(v)) return `(?<![\\d.,])${v}(?:[.,]0+)?(?![\\d])`;
  const [e, d] = String(v).split(".");
  return `(?<![\\d.,])${e}[.,]${d}0*(?![\\d])`;
}

/**
 * R2 (A4) — l'extrait contient-il LITTÉRALEMENT la valeur, avec son unité ?
 * Tolérances : virgule ou point, « m », « mètre(s) », « % » pour les ratios.
 */
export function extraitContientValeur(extrait: string | null | undefined, champ: string, valeur: number | null | undefined): boolean {
  if (typeof extrait !== "string" || typeof valeur !== "number" || !Number.isFinite(valeur)) return false;
  let motif: string;
  if (champ === "ces.max_ratio" || champ === "pleine_terre.ratio_min") motif = `${motifNombre(Math.round(valeur * 10000) / 100)}\\s*%`;
  else if (champ.startsWith("stationnement.")) motif = `${motifNombre(valeur)}\\s*places?`;
  else if (champ === "cos.max") motif = motifNombre(valeur);
  else motif = `${motifNombre(valeur)}\\s*(?:m(?![²2\\p{L}])|m[èe]tres?)`;
  return new RegExp(motif, "iu").test(extrait);
}

export type MotifNonDocumentaire =
  | "provenance-absente"
  | "recul-conditionnel"
  | "valeur-absente"
  | "source-cache"
  | "article-inconnu"
  | "extrait-vide"
  | "valeur-absente-de-l-extrait"
  | "zone-article-inconnue"
  | "article-autre-zone"
  | "document-non-identifie"
  | "source-locale-non-verifiee";

export const MOTIF_NON_DOCUMENTAIRE_LABELS: Readonly<Record<MotifNonDocumentaire, string>> = {
  "provenance-absente": "provenance non transmise (ancien format)",
  "recul-conditionnel": "recul conditionnel (mesuré depuis l'axe, les berges ou une autre référence que l'alignement)",
  "valeur-absente": "valeur absente",
  "source-cache": "valeur issue du cache, non relue dans le document importé",
  "article-inconnu": "article inconnu",
  "extrait-vide": "extrait vide",
  "valeur-absente-de-l-extrait": "la valeur ne figure pas dans l'extrait",
  "zone-article-inconnue": "zone de l'article non déterminée (pas d'en-tête de zone ni d'intitulé qualifié)",
  "article-autre-zone": "article d'une autre zone que celle de la parcelle",
  "document-non-identifie": "document non identifié",
  "source-locale-non-verifiee": "source locale non vérifiée (identifiant du document sans empreinte serveur cohérente)",
};

/**
 * Pourquoi la provenance n'est PAS une référence documentaire (null : elle l'est).
 * Référence documentaire = document identifié et vérifiable + article + extrait
 * contenant la valeur + article de la zone de la parcelle (si `zoneCode` est fourni).
 */
export function motifNonDocumentaire(p: ValeurProvenancePlu | null | undefined, doc: DocumentPlu | null | undefined, zoneCode?: string | null): MotifNonDocumentaire | null {
  if (!p) return "provenance-absente";
  if (p.statut === "conditionnel" || p.regle === "CONDITIONNEL") return "recul-conditionnel";
  if (p.valeur === null) return "valeur-absente";
  if (p.methode === "cache") return "source-cache";
  if (!p.article) return "article-inconnu";
  if (!p.extrait || !p.extrait.trim()) return "extrait-vide";
  if (!extraitContientValeur(p.extrait, p.champ, p.valeur)) return "valeur-absente-de-l-extrait";
  if (zoneCode !== undefined) {
    const z = normZone(zoneCode);
    if (!p.articleZone || !z) return "zone-article-inconnue";
    if (p.articleZone !== z) return "article-autre-zone";
  }
  if (!documentIdentifie(doc)) return "document-non-identifie";
  if (!documentVerifiable(doc)) return "source-locale-non-verifiee";
  return null;
}

/**
 * Référence DOCUMENTAIRE (voir `motifNonDocumentaire`). C'est la seule forme de
 * référence proposée en un clic ; la validation par une personne nommée reste
 * requise pour un verdict.
 */
export function estReferenceDocumentaire(p: ValeurProvenancePlu | null | undefined, doc: DocumentPlu | null | undefined, zoneCode?: string | null): boolean {
  return motifNonDocumentaire(p, doc, zoneCode) === null;
}

export type StatutDateDocument = "inconnue" | "ancienne" | "recente";

export interface EtatDateDocument {
  readonly date: string | null;
  /** « approbation » (idurba) ou « validité GPU » (datvalid). */
  readonly nature: "approbation" | "validite" | null;
  readonly ans: number | null;
  readonly statut: StatutDateDocument;
  readonly libelle: string;
}

/** Date du document et alerte d'ancienneté (plus de `ansMax` ans, ou date inconnue). */
export function etatDateDocument(doc: DocumentPlu | null | undefined, maintenant: Date = new Date(), ansMax: number = AGE_DOCUMENT_ALERTE_ANS): EtatDateDocument {
  const date = doc?.dateApprobation ?? doc?.datvalid ?? null;
  const nature = doc?.dateApprobation ? "approbation" : doc?.datvalid ? "validite" : null;
  if (!date) return { date: null, nature: null, ans: null, statut: "inconnue", libelle: "Date du document inconnue" };
  const t = Date.parse(`${date}T00:00:00Z`);
  const ans = Number.isFinite(t) ? Math.floor(((maintenant.getTime() - t) / (365.25 * 24 * 3600 * 1000)) * 10) / 10 : null;
  const fr = `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
  const quoi = nature === "approbation" ? "approuvé le" : "valide au GPU depuis le";
  if (ans !== null && ans > ansMax) {
    return { date, nature, ans, statut: "ancienne", libelle: `Document ${quoi} ${fr} (plus de ${ansMax} ans) : vérifier qu'il est toujours opposable` };
  }
  return { date, nature, ans, statut: "recente", libelle: `Document ${quoi} ${fr}` };
}

function nomDocument(doc: DocumentPlu | null | undefined): string {
  const commune = doc?.communeNom ?? doc?.communeInsee ?? null;
  const base = commune ? `PLU de ${commune}` : "PLU";
  const quoi = doc?.idurba ?? doc?.intitule ?? doc?.id ?? null;
  return quoi ? `${base} (${quoi})` : base;
}

/** Libellé proposé : « PLU de X (doc), art. 7, p. 12 ». Contient toujours un type de document et un article numéroté. */
export function libelleSourceDocumentaire(p: ValeurProvenancePlu, doc: DocumentPlu | null | undefined): string {
  const art = p.article ? `art. ${p.article}` : "article inconnu";
  return `${nomDocument(doc)}, ${art}${p.page !== null ? `, p. ${p.page}` : ""}`;
}

/** Extrait raccourci pour un bouton ou une infobulle. */
export function extraitCourt(p: ValeurProvenancePlu | null | undefined, max = 90): string {
  const e = p?.extrait ?? "";
  return e.length <= max ? e : `${e.slice(0, max - 1).trimEnd()}…`;
}

/** Empreinte (FNV-1a 32 bits) de la source validée : une validation documentaire est périmée si l'article, l'extrait, la page ou le document changent. */
export function empreinteSource(p: ValeurProvenancePlu | null | undefined, doc: DocumentPlu | null | undefined, zoneCode?: string | null): string | null {
  if (!p || !estReferenceDocumentaire(p, doc, zoneCode)) return null;
  // R2 (A9) : l'intitulé et la zone de l'article, les dates et l'empreinte du document en font partie
  const s = [
    doc?.id ?? "", doc?.idurba ?? "", doc?.empreinteSha256 ?? "", doc?.datvalid ?? "", doc?.dateApprobation ?? "",
    p.champ, p.article ?? "", p.articleIntitule ?? "", p.articleZone ?? "", p.page ?? "", p.extrait ?? "", p.valeur ?? "",
  ].join("␟");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a-${h.toString(16).padStart(8, "0")}`;
}

// ─── Ruleset résolu à partir de la réponse de l'Edge Function plu-parser ───

/** Chemin du champ résolu → chemin(s) du champ dans la réponse de plu-parser (le premier présent l'emporte). */
export const CORRESPONDANCE_CHAMPS: Readonly<Record<string, readonly string[]>> = {
  "reculs.voirie.min_m": ["reculs.voirie.min_m"],
  "reculs.limites_separatives.min_m": ["reculs.limites_separatives.min_m"],
  "reculs.fond_parcelle.min_m": ["reculs.fond_parcelle.min_m"],
  "hauteur.max_m": ["hauteur.hauteur_egout_m", "hauteur.hauteur_max_m"],
  "hauteur.faitage_m": ["hauteur.hauteur_faitage_m"],
  "ces.max_ratio": ["emprise_sol.emprise_sol_max"],
  "stationnement.par_logement": ["stationnement.places_par_logement"],
  "pleine_terre.ratio_min": ["pleine_terre.min_pct"],
  "cos.max": ["densite.cos_max"],
};

function lireChemin(o: unknown, chemin: string): unknown {
  let cur: unknown = o;
  for (const k of chemin.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

const proches = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Ajoute au ruleset résolu (issu de `legacyRulesetToResolved`) la provenance
 * renvoyée par plu-parser ≥ 3.2.0. Additif : un ruleset sans réponse
 * exploitable est renvoyé tel quel (ancien format, « à vérifier »).
 *  - `document_id` = identifiant du document (si absent) ; `commune_insee` complété ;
 *  - `reculs.<cat>.type` = type de règle lu (FIXED, H_OVER_2_MIN, ALIGNEMENT_OU_RETRAIT…) ;
 *  - une provenance n'est attachée que si SA valeur égale la valeur résolue.
 */
export function enrichirRulesetResolu(
  resolu: Record<string, unknown> | null,
  reponse: unknown,
  zoneCode: string | null | undefined,
  communeInsee: string | null | undefined,
): Record<string, unknown> | null {
  if (!resolu) return resolu;
  const r = reponse && typeof reponse === "object" ? (reponse as Record<string, unknown>) : null;
  const zones = r && Array.isArray(r.zones_rulesets) ? (r.zones_rulesets as Array<Record<string, unknown>>) : [];
  const z = String(zoneCode ?? "").toUpperCase();
  const zone = zones.find((x) => String(x?.zone_code ?? "").toUpperCase() === z) ?? zones[0] ?? null;
  const brut = zone && zone.provenance && typeof zone.provenance === "object" ? (zone.provenance as Record<string, unknown>) : null;
  const doc = r ? lireDocument(r.document) : null;
  const out: Record<string, unknown> = { ...resolu };
  if (!out.commune_insee && (communeInsee || doc?.communeInsee)) out.commune_insee = communeInsee || doc?.communeInsee;
  if (!r || r.provenance_version !== PROVENANCE_VERSION || (!brut && !doc)) return out;

  const provenance: Record<string, unknown> = {};
  for (const [champResolu, sources] of Object.entries(CORRESPONDANCE_CHAMPS)) {
    const vResolu = num(lireChemin(resolu, champResolu));
    for (const src of sources) {
      const p = brut ? lireValeurProvenance(brut[src], champResolu) : null;
      if (!p) continue;
      const vSrc = champResolu === "pleine_terre.ratio_min" && p.valeur !== null ? p.valeur / 100 : p.valeur;
      if (vResolu === null && vSrc !== null) continue;
      if (vResolu !== null && (vSrc === null || !proches(vSrc, vResolu))) continue;
      provenance[champResolu] = {
        valeur: vResolu,
        regle: p.regle,
        article: p.article,
        article_intitule: p.articleIntitule,
        article_zone: p.articleZone,
        article_zone_qualifie: p.articleZoneQualifie,
        extrait: p.extrait,
        page: p.page,
        methode: p.methode,
        confiance: p.confiance,
        motif: p.motif,
        ...(p.statut ? { statut: p.statut, reference: p.reference ?? null } : {}),
        source_champ: src,
      };
      break;
    }
  }
  out.provenance_version = PROVENANCE_VERSION;
  out.document = doc
    ? {
        id: doc.id, intitule: doc.intitule, commune_insee: doc.communeInsee, commune_nom: doc.communeNom, idurba: doc.idurba,
        datvalid: doc.datvalid, date_approbation: doc.dateApprobation, nomfic: doc.nomfic, correspondance_gpu: doc.correspondanceGpu, pages: doc.pages,
        empreinte_sha256: doc.empreinteSha256,
      }
    : null;
  out.provenance = provenance;
  if (!out.document_id && doc?.id) out.document_id = doc.id;
  if (!out.source && typeof r.parser_mode === "string") out.source = `plu-parser:${r.parser_mode}`;
  // type de règle des retraits (lu par le contrôle d'implantation)
  const reculs = out.reculs && typeof out.reculs === "object" ? { ...(out.reculs as Record<string, unknown>) } : null;
  const rsZone = zone && zone.ruleset && typeof zone.ruleset === "object" ? (zone.ruleset as Record<string, unknown>) : null;
  if (reculs && rsZone) {
    for (const cat of ["voirie", "limites_separatives"]) {
      const regle = txt(lireChemin(rsZone, `reculs.${cat}.regle`), 40);
      const cur = reculs[cat];
      if (regle && cur && typeof cur === "object") reculs[cat] = { ...(cur as Record<string, unknown>), type: regle };
    }
    out.reculs = reculs;
  }
  return out;
}

/** Débuts de pages (offsets) dans le texte `pages.join(sep)` envoyé à plu-parser. */
export function debutsPages(pages: readonly string[], sep = "\n"): number[] {
  const out: number[] = [];
  let pos = 0;
  pages.forEach((p, i) => {
    out.push(pos);
    pos += p.length + (i < pages.length - 1 ? sep.length : 0);
  });
  return out;
}
