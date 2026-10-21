// src/spaces/promoteur/implantation/rulesetReculs.ts
//
// LOT L1b — LECTURE DU RULESET PLU RÉEL ET PROVENANCE DES RETRAITS.
//
// Remplace, pour les retraits, l'ancien `PLACEHOLDER_PLU_RULES`
// d'`Implantation2DPage.tsx`. Le ruleset est celui que `FoncierPluPage.tsx`
// écrit sous la clé de base `mimmoza.plu.resolved_ruleset_v1` via
// `userStorage` (clé physique `u:{userId}:{base}`). Le stockage est INJECTÉ :
// ce module ne lit jamais `localStorage` lui-même (testable sous node:test).
//
// Règles de vérité (alignées sur le Studio, `implantationCheck.ts` R3) :
//  - une valeur absente, non chiffrée (H/2) ou sans document identifiable ne
//    fonde aucun verdict ;
//  - les règles du ruleset proviennent d'une extraction automatique (parseur
//    PLU / IA) : elles ne fondent un verdict qu'après VALIDATION par une
//    personne NOMMÉE, avec une référence documentaire exploitable (document +
//    article), pour la valeur, le document et la zone en cours ; toute
//    divergence rend la validation périmée ;
//  - références factices refusées (« n/a », « - », « non renseigné »,
//    « non applicable », « à vérifier », « sans objet »…).
//
// LOT L2 — provenance par valeur (`lib/pluProvenance.ts`) : quand le ruleset
// porte `provenance_version: "plu_provenance_v1"`, chaque retrait connaît son
// document (id, intitulé, idurba / datvalid GPU), son article, son extrait
// littéral, sa page, sa méthode d'extraction et sa confiance. Une telle
// référence est DOCUMENTAIRE (document identifié + article + extrait non vide)
// et peut être validée « avec la source » ; la validation par une personne
// nommée reste requise pour tout verdict. Sans provenance (ancien v1), seule
// une référence saisie qui identifie un document (type + article numéroté,
// ou identifiant égal à celui du ruleset) est acceptée (réserve R2-1 levée).

import {
  empreinteSource,
  libelleSourceDocumentaire,
  lireProvenancePlu,
  motifNonDocumentaire,
  type DocumentPlu,
  type MotifNonDocumentaire,
  type ValeurProvenancePlu,
} from "../lib/pluProvenance.ts";

export type CategorieRegle = "voirie" | "separative" | "fond";

export const CATEGORIES_REGLE: readonly CategorieRegle[] = ["voirie", "separative", "fond"];

export const LIBELLES_CATEGORIE: Readonly<Record<CategorieRegle | "non-classee", string>> = {
  voirie: "Voirie (alignement)",
  separative: "Limite séparative",
  fond: "Fond de parcelle",
  "non-classee": "Non classée",
};

/** Ce qu'un ruleset de l'ancien format (v1 sans provenance) ne transporte pas. */
export const PROVENANCE_NON_TRANSMISE: readonly string[] = ["article", "extrait du règlement", "page", "date du document"];

export const CLE_RULESET = "mimmoza.plu.resolved_ruleset_v1";

export interface StockageLecture {
  getItem(key: string): string | null;
}
export interface StockageEcriture extends StockageLecture {
  setItem(key: string, value: string): void;
}

export interface ProvenanceRuleset {
  readonly documentId: string | null;
  readonly communeInsee: string | null;
  readonly zoneCode: string | null;
  readonly zoneLibelle: string | null;
  readonly source: string | null;
  readonly confiance: number | null;
  /** L2 — document source (null : ancien format sans provenance). */
  readonly document?: DocumentPlu | null;
}

export interface RegleRetrait {
  readonly categorie: CategorieRegle;
  /** Retrait minimal (m) ; null = absent du ruleset. */
  readonly valeur: number | null;
  /** Type de règle déclaré (FIXED, H_OVER_2, H_OVER_2_MIN…) ; null si inconnu. */
  readonly typeRegle: string | null;
  /** Chemin du champ lu dans le ruleset (traçabilité). */
  readonly champ: string | null;
  readonly note: string | null;
  /** R2 — texte d'origine quand la valeur est conditionnelle (« 3 m (ou H/2) »). */
  readonly texteBrut?: string | null;
  readonly provenance: ProvenanceRuleset;
  /** Séparatives : implantation en limite autorisée (true / false / inconnu). */
  readonly implantationEnLimite: boolean | null;
  /** L2 — provenance de CETTE valeur (article, extrait, page, méthode, confiance) ; null si absente. */
  readonly provenanceValeur?: ValeurProvenancePlu | null;
  /** L2 — référence documentaire : document identifié et vérifiable + article de la zone + extrait contenant la valeur. */
  readonly documentaire?: boolean;
  /** R2 — pourquoi la provenance n'est pas documentaire (null si elle l'est). */
  readonly motifNonDocumentaire?: MotifNonDocumentaire | null;
}

export type EtatRuleset =
  | { readonly statut: "absent" }
  | { readonly statut: "illisible"; readonly message: string }
  | { readonly statut: "format-inconnu"; readonly version: string | null }
  | { readonly statut: "ok"; readonly ruleset: Record<string, unknown> };

const texte = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);

function nombre(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number.parseFloat(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * R2 — lecture STRICTE d'un retrait : un nombre, ou une chaîne entièrement
 * numérique (« 5 », « 5,0 », « 5 m »). Une chaîne qui contient un nombre mais
 * aussi autre chose (« 3 m (ou H/2) ») est CONDITIONNELLE : le nombre est
 * gardé à titre indicatif et la règle reste « à vérifier ».
 */
function retraitStrict(v: unknown): { valeur: number | null; conditionnel: boolean; brut: string | null } {
  if (typeof v === "number") return { valeur: Number.isFinite(v) ? v : null, conditionnel: false, brut: null };
  if (typeof v !== "string" || !v.trim()) return { valeur: null, conditionnel: false, brut: null };
  const t = v.trim();
  if (/^\d+([.,]\d+)?\s*(m|metres?|mètres?)?$/i.test(t)) return { valeur: Number.parseFloat(t.replace(",", ".")), conditionnel: false, brut: null };
  const m = t.match(/\d+([.,]\d+)?/);
  return { valeur: m ? Number.parseFloat(m[0].replace(",", ".")) : null, conditionnel: m !== null, brut: t };
}

function lire(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Lit le ruleset résolu depuis un stockage (clé de base, déjà isolée par utilisateur). */
export function lireRulesetPlu(storage: StockageLecture): EtatRuleset {
  let raw: string | null;
  try {
    raw = storage.getItem(CLE_RULESET);
  } catch (e) {
    return { statut: "illisible", message: e instanceof Error ? e.message : String(e) };
  }
  if (raw === null || raw.trim() === "" || raw.trim() === "null") return { statut: "absent" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { statut: "illisible", message: e instanceof Error ? e.message : String(e) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { statut: "illisible", message: "contenu non objet" };
  const version = texte((parsed as Record<string, unknown>).version);
  if (version !== "plu_ruleset_v1") return { statut: "format-inconnu", version };
  return { statut: "ok", ruleset: parsed as Record<string, unknown> };
}

export function provenanceRuleset(rs: Record<string, unknown>): ProvenanceRuleset {
  const conf = nombre(rs.confidence_score);
  const pp = lireProvenancePlu(rs);
  return {
    documentId: texte(rs.document_id),
    communeInsee: texte(rs.commune_insee),
    zoneCode: texte(rs.zone_code),
    zoneLibelle: texte(rs.zone_libelle),
    source: texte(rs.source),
    confiance: conf,
    document: pp ? pp.document : null,
  };
}

const CHAMPS: Readonly<Record<CategorieRegle, { reculs: string; facade: string }>> = {
  voirie: { reculs: "voirie", facade: "avant" },
  separative: { reculs: "limites_separatives", facade: "laterales" },
  fond: { reculs: "fond_parcelle", facade: "fond" },
};

/**
 * Retraits du ruleset par catégorie. On lit `reculs.<cat>.min_m` ; à défaut,
 * `reculs.facades.<façade>.min_m` UNIQUEMENT si cette façade est explicite
 * (`type` déclaré et `derived !== true`). Une valeur dérivée d'une autre
 * catégorie (ex. fond = séparatives dans l'ancien format) n'est pas reprise.
 */
export function extraireReglesRetrait(rs: Record<string, unknown>): Record<CategorieRegle, RegleRetrait> {
  const prov = provenanceRuleset(rs);
  const pp = lireProvenancePlu(rs);
  const enLimite = lire(rs, "reculs", "implantation_en_limite", "autorisee");
  const out = {} as Record<CategorieRegle, RegleRetrait>;
  for (const cat of CATEGORIES_REGLE) {
    const c = CHAMPS[cat];
    const lu = retraitStrict(lire(rs, "reculs", c.reculs, "min_m"));
    let valeur = lu.valeur;
    let texteBrut: string | null = lu.brut;
    let champ: string | null = valeur !== null ? `reculs.${c.reculs}.min_m` : null;
    let typeRegle = texte(lire(rs, "reculs", c.reculs, "type"));
    let note = texte(lire(rs, "reculs", c.reculs, "note"));
    const fac = lire(rs, "reculs", "facades", c.facade);
    const facType = texte(lire(fac, "type"));
    const facDerived = lire(fac, "derived") === true;
    const facExplicite = facType !== null && !facDerived;
    if (valeur === null && facExplicite) {
      const lf = retraitStrict(lire(fac, "min_m"));
      const v = lf.valeur;
      if (v !== null) {
        valeur = v;
        texteBrut = lf.brut;
        champ = `reculs.facades.${c.facade}.min_m`;
        typeRegle = facType;
        note = texte(lire(fac, "note")) ?? note;
      }
    } else if (facExplicite && facType && facType !== "FIXED" && facType !== "UNKNOWN") {
      // la façade explicite précise une règle non fixe (H/2…) : elle prime pour le type
      typeRegle = facType;
      note = texte(lire(fac, "note")) ?? note;
    }
    if (valeur !== null && valeur < 0) valeur = null;
    if (valeur !== null && texteBrut !== null) typeRegle = "CONDITIONNEL";
    // L2 — provenance de la valeur lue (même champ, même valeur), sinon aucune.
    const pv = pp && champ ? (pp.valeurs[champ] ?? null) : null;
    const provenanceValeur = pv && valeur !== null && pv.valeur !== null && Math.abs(pv.valeur - valeur) <= 1e-9 ? pv : null;
    const motifDoc = motifNonDocumentaire(provenanceValeur, prov.document ?? null, prov.zoneCode);
    const documentaire = motifDoc === null;
    out[cat] = {
      categorie: cat,
      valeur,
      typeRegle,
      champ,
      note,
      texteBrut,
      // la confiance affichée est celle de la VALEUR quand elle est connue
      provenance: provenanceValeur && provenanceValeur.confiance !== null ? { ...prov, confiance: provenanceValeur.confiance } : prov,
      implantationEnLimite: cat === "separative" && typeof enLimite === "boolean" ? enLimite : null,
      provenanceValeur,
      documentaire,
      motifNonDocumentaire: motifDoc,
    };
  }
  return out;
}

// ─── RÉFÉRENCES FACTICES (R2) ────────────────────────────────────────────
//
// Normalisation : minuscules, sans accents, `-` `_` `.` `/` `\` → espace,
// espaces réduits, ponctuation de bord retirée.
// Une RÉFÉRENCE DE VALIDATION doit désigner un document : soit un identifiant
// de document (au moins 6 caractères alphanumériques avec lettres ET chiffres,
// ou un UUID), soit un type de document (PLU, PLUi, RNU, PSMV, PPR, servitude…)
// accompagné d'un repère (article, page, §, ou un numéro).
// Un DOCUMENT_ID doit être un identifiant de document réel (même définition),
// jamais un identifiant de repli produit par le code (`SQL_CANON`,
// `PluFaisabilite.tsx` l. 1093 ; `SQL_*`, `fallback`, `default`…).

export function normaliserReference(ref: string): string {
  return ref
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_./\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** Formes normalisées refusées telles quelles. */
export const REFERENCES_FACTICES: ReadonlySet<string> = new Set([
  "n a", "na", "nd", "n d", "nc", "n c", "ras", "aucune", "aucun", "neant", "inconnu", "inconnue", "sans", "so", "s o",
  "nr", "n r", "none", "null", "nil", "undefined", "unknown", "tbd", "todo", "xxx", "xx", "x", "test", "ref",
  "reference", "references", "source", "sources", "document", "documents", "doc", "plu", "plui", "rnu", "reglement",
  "le plu", "voir plu", "voir le plu", "voir reglement", "voir document", "vide", "rien", "idem", "cf plu", "cf",
  "abc", "123", "1234", "0", "00", "000",
]);

/** Sous-chaînes (normalisées) qui disqualifient une référence. */
export const FRAGMENTS_FACTICES: readonly string[] = [
  "a verifier", "a confirmer", "a completer", "a definir", "a voir", "a preciser", "a renseigner",
  "non renseign", "pas renseign", "pas encore", "sans objet", "non applicable", "non communique", "non disponible",
  "non connu", "inconnu", "sans reference", "pas de reference", "aucune reference", "pas de source", "aucune source",
  "pas lu", "non lu",
];

/** Identifiants de repli produits par le code (recherche : grep SQL_CANON, fallback, default). */
export const IDENTIFIANTS_REPLI: readonly RegExp[] = [
  /^sql( |$)/, /\bcanon\b/, /\bfallback\b/, /\bdefaults?\b/, /\bdefaut\b/, /\brepli\b/, /\bplaceholder\b/,
  /\bdummy\b/, /\bmock\b/, /\bdemo\b/, /\bexemple\b/, /\bexample\b/,
];

export const REFERENCE_MIN_ALNUM = 3;

const TYPES_DOCUMENT = /\b(plu|plui|pluih|plum|plu h|rnu|psmv|spr|avap|zppaup|ppr|pprn|pprt|ppri|pprif|servitudes?|sup|oap|reglement|pos|carte communale|scot|zac|lotissement|cahier des charges)\b/;
const TYPES_DOCUMENT_G = new RegExp(TYPES_DOCUMENT.source, "g");
/**
 * L2 (R2-1) — repère d'article NUMÉROTÉ : « art. 7 », « article UA 6 »,
 * « art. R111-17 », « p. 42 », « § 3.2 », ou zone + numéro (« UB 7.2 »).
 * « art. ? », « art. xx », « page », « p. » ou un nombre seul ne suffisent plus.
 */
/**
 * R2 (A2) — seuls comptent : « art. / article » + numéro NON NUL (éventuellement
 * précédé d'un code de zone : « art. UA 6 », « art. UB1 7 »), « art. R111-17 »,
 * « § 3 ». Une page, une année, une version, une zone, un tome, « art. 0 » ou
 * « art. ? » ne sont pas des articles. (Testé sur la forme normalisée.)
 */
const REPERE_ARTICLE_NUMERO = /(\b(?:art|article|articles)\s+(?:(?!(?:de|du|des|la|le|les|en|n|no)\s)[a-z]{1,3}\d{0,2}\s+)?[1-9]\d{0,2}\b)|(\b(?:art|article)\s+r\s?\d{3}\b)|(§\s*[1-9])/;
/**
 * R3 (A2-bis) — forme PLUi zone-numéro seulement, sur le texte d'ORIGINE : séparateur
 * explicite collé (« UB1-7 », « UB-7 », « UB.7 ») ou sous-article (« UB 7.2 »).
 * « PLU A4 », « PLU version A 2 », « PLU Annexe A 3 », « PLU UB 7 » ne sont pas des articles.
 */
const ZONE_ARTICLE_ORIGINE = /(?<![\p{L}\d])(?!A[0-5](?![\p{L}\d]))[1-9]?(?:AU|U|A|N)[A-Z0-9]{0,3}(?:[-.][1-9]\d?|\s+[1-9]\d?\.\d+)(?![\p{L}\d])/u;
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

function estFactice(n: string): boolean {
  if (n.length === 0) return true;
  if (REFERENCES_FACTICES.has(n)) return true;
  if (FRAGMENTS_FACTICES.some((f) => n.includes(f))) return true;
  if (IDENTIFIANTS_REPLI.some((r) => r.test(n))) return true;
  const alnum = n.replace(/[^\p{L}\p{N}]/gu, "");
  if (alnum.length < REFERENCE_MIN_ALNUM) return true;
  if (/^(.)\1*$/u.test(alnum)) return true;
  return false;
}

/** Le texte ressemble-t-il à un identifiant de document (UUID, ou lettres + chiffres, ≥ 6 alphanumériques) ? */
function ressembleIdentifiant(brut: string, n: string): boolean {
  if (UUID.test(brut.trim())) return true;
  if (!/^\S+$/.test(brut.trim())) return false; // un identifiant est un seul « mot »
  const alnum = n.replace(/[^\p{L}\p{N}]/gu, "");
  return alnum.length >= 6 && /\p{L}/u.test(alnum) && /\p{N}/u.test(alnum);
}

/**
 * L2 (R2-2) — fragments d'identifiants de REPLI recherchés SANS limite de mot
 * (« fallback2 », « unknown1 », « null123 », « SQLCANON1 », « plu_ruleset_v1 »…).
 * Appliqués aux seuls identifiants d'un mot (jamais aux références en clair).
 */
export const FRAGMENTS_IDENTIFIANT_REPLI = /(sql|canon|fallback|unknown|null|none|undefined|temp|tmp|local|placeholder|default|defaut|dummy|mock|demo|test|ruleset|extraction|upload|manual|sample|exemple|example)/;
/** Identifiant générique sans contenu (« ID000001 », « doc1234 », « doc12345 », « ref01 »). */
const IDENTIFIANT_GENERIQUE = /^(id|ref|doc|document|zone|plu|n|no|num)?[-_ .]?\d*$/i;
/** Identifiant d'analyse produit par plu-parser ≥ 3.2.0 (empreinte SHA-256 du texte). */
const ID_ANALYSE_PLU = /^plu-txt-[0-9a-f]{16}$/;

/** Le `document_id` du ruleset désigne-t-il un document réel (pas un repli ni une valeur factice) ? */
export function documentIdExploitable(id: string | null | undefined): boolean {
  if (typeof id !== "string") return false;
  const brut = id.trim();
  // R2 (A8) : UUID nul et identifiants d'analyse à caractère unique répété refusés
  if (UUID.test(brut)) return !/^[0-]+$/.test(brut);
  if (ID_ANALYSE_PLU.test(brut)) return !/^plu-txt-(.)\1{15}$/.test(brut);
  const n = normaliserReference(id);
  if (estFactice(n)) return false;
  const alnum = n.replace(/[^\p{L}\p{N}]/gu, "");
  if (FRAGMENTS_IDENTIFIANT_REPLI.test(alnum) || IDENTIFIANT_GENERIQUE.test(brut)) return false;
  if ((alnum.match(/\p{N}/gu)?.length ?? 0) < 2) return false; // « zone-UA-1 » : pas un identifiant de document
  return ressembleIdentifiant(id, n);
}

/**
 * La référence saisie à la validation identifie-t-elle un document ET un
 * article ? (R2-1) Deux formes seulement :
 *  - un type de document (PLU, PLUi, RNU, PPR…) suivi d'un repère d'article
 *    NUMÉROTÉ (« PLU Rennes, art. UA 6 », « PLUi, UB 7.2 », « PPRI, § 3.2 ») ;
 *  - un identifiant ÉGAL à celui d'un document connu (`idsDocument` :
 *    `document_id` ou idurba du ruleset). Un mot quelconque à lettres et
 *    chiffres (« Article7 ») n'est plus pris pour un identifiant.
 */
export function referenceExploitable(ref: string | null | undefined, idsDocument: readonly (string | null | undefined)[] = []): boolean {
  if (typeof ref !== "string") return false;
  const brut = ref.trim();
  if (idsDocument.some((id) => typeof id === "string" && id.trim().length > 0 && id.trim() === brut)) return documentIdExploitable(brut);
  const n = normaliserReference(ref);
  if (estFactice(n)) return false;
  if (!TYPES_DOCUMENT.test(n)) return false;
  if (REPERE_ARTICLE_NUMERO.test(n.replace(TYPES_DOCUMENT_G, " ").replace(/\s+/g, " ").trim())) return true;
  const origine = brut.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(?:PLUi?H?|PLUM|RNU|PSMV|SPR|AVAP|ZPPAUP|PPR[NTI]?F?|OAP|POS|SCOT|ZAC)\b/gi, " ");
  // R4 (A2-ter) : code de zone d'au moins deux caractères, jamais « UNE » (« PLU A-4 », « version N-2 », « tome A-2 » refusés)
  const m = new RegExp(ZONE_ARTICLE_ORIGINE.source, "gu");
  let z: RegExpExecArray | null;
  while ((z = m.exec(origine)) !== null) {
    const code = z[0].replace(/(?:[-.][1-9]\d?|\s+[1-9]\d?\.\d+)$/, "");
    if (code.length >= 2 && code !== "UNE") return true;
  }
  return false;
}

/** Noms de validateur refusés (normalisés). */
export const NOMS_FACTICES: ReadonlySet<string> = new Set([
  "anonyme", "anonymous", "anon", "moi", "me", "je", "toi", "lui", "nous", "na", "n a", "nd", "inconnu", "inconnue",
  "test", "testeur", "tester", "admin", "administrateur", "user", "utilisateur", "personne", "aucun", "aucune",
  "nobody", "none", "null", "undefined", "toto", "titi", "tata", "tutu", "foo", "bar", "qui", "quelqu un",
  "validateur", "valideur", "signature", "nom", "prenom", "prenom nom", "nom prenom", "mimmo", "mimmoza", "ia", "ai",
  "assistant", "robot", "bot", "claude", "chatgpt", "xxx", "xx", "abc", "ok", "oui", "non", "vide",
]);

/** R2 — le nom du validateur désigne-t-il une personne (≥ 2 lettres, pas une valeur factice) ? */
export function nomValidateurExploitable(par: string | null | undefined): boolean {
  if (typeof par !== "string") return false;
  const n = normaliserReference(par);
  const lettres = n.replace(/[^\p{L}]/gu, "");
  if (lettres.length < 2) return false;
  if (NOMS_FACTICES.has(n) || REFERENCES_FACTICES.has(n)) return false;
  if (FRAGMENTS_FACTICES.some((f) => n.includes(f))) return false;
  if (/^(.)\1*$/u.test(lettres)) return false;
  // R2 (A14) : rôle générique (« Admin 2 », « Utilisateur 1 », « Le Promoteur », « Personne Physique ») refusé
  const mots = n.split(" ").filter((m) => m.length > 0);
  if (mots.some((m) => ROLES_GENERIQUES.has(m))) return false;
  if (mots.some((m) => /^\d+$/.test(m))) return false;
  return true;
}

/** R2 (A14) — mots désignant un rôle ou un compte, jamais une personne. */
export const ROLES_GENERIQUES: ReadonlySet<string> = new Set([
  "admin", "administrateur", "administratrice", "utilisateur", "utilisatrice", "user", "compte", "promoteur", "promotrice", "personne",
  "physique", "morale", "client", "cliente", "agent", "operateur", "operatrice", "gestionnaire", "responsable", "service", "equipe",
  "societe", "bureau", "cabinet", "mimmoza", "mimmo", "robot", "bot", "test", "invite", "guest", "anonyme", "inconnu", "inconnue",
]);

/** R2 — avertissements qui restent affichés même après validation (confiance faible, source de repli). */
export const CONFIANCE_AVERTISSEMENT = 0.5;
export function avertissementsRegle(regle: RegleRetrait): string[] {
  const out: string[] = [];
  const p = regle.provenance;
  if (p.confiance !== null && p.confiance < CONFIANCE_AVERTISSEMENT) {
    out.push(`Confiance déclarée faible (${Math.round(p.confiance * 100)} %) : relire le document avant de s'y fier.`);
  }
  if (p.source && IDENTIFIANTS_REPLI.some((r) => r.test(normaliserReference(p.source!)))) {
    out.push(`Source de repli ou par défaut (« ${p.source} ») : ce n'est pas une lecture du règlement.`);
  }
  if (regle.typeRegle === "CONDITIONNEL") out.push(`Valeur conditionnelle (« ${regle.texteBrut ?? ""} ») : seul le nombre a été repris, à titre indicatif.`);
  return out;
}

// ─── VALIDATION HUMAINE ──────────────────────────────────────────────────

/** Validation nominative d'une règle, liée au contenu exact qu'elle valide. */
export interface ValidationRegle {
  readonly categorie: CategorieRegle;
  readonly valeur: number;
  readonly documentId: string | null;
  readonly zoneCode: string | null;
  /** Référence documentaire saisie par la personne (document + article). */
  readonly reference: string;
  /** Nom de la personne qui valide. */
  readonly par: string;
  /** Date ISO de la validation. */
  readonly le: string;
  /** L2 — « documentaire » (validée avec la source extraite) ou « saisie » (référence tapée). */
  readonly source?: "documentaire" | "saisie";
  /** L2 — empreinte de la source documentaire validée (périmée si l'article, l'extrait, la page ou le document changent). */
  readonly empreinteSource?: string;
}

export type ValidationsRegles = Partial<Record<CategorieRegle, ValidationRegle>>;

/**
 * Clé des validations : liée à l'étude, ou à défaut à la signature géométrique
 * de la parcelle (R2). Sans l'une ni l'autre, la clé nue n'est jamais écrite
 * par l'interface (validations gardées en mémoire seulement).
 */
export const cleValidations = (studyId: string | null, signatureParcelle?: string | null): string =>
  `mimmoza.implantation.validations_retraits_v1${studyId ? `.${studyId}` : signatureParcelle ? `.parcelle.${signatureParcelle}` : ""}`;

export function lireValidations(storage: StockageLecture, studyId: string | null, signatureParcelle?: string | null): ValidationsRegles {
  try {
    const raw = storage.getItem(cleValidations(studyId, signatureParcelle));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: ValidationsRegles = {};
    for (const cat of CATEGORIES_REGLE) {
      const v = (parsed as Record<string, unknown>)[cat];
      if (!v || typeof v !== "object") continue;
      const o = v as Record<string, unknown>;
      const valeur = nombre(o.valeur);
      const reference = texte(o.reference);
      const par = texte(o.par);
      const le = texte(o.le);
      if (valeur === null || reference === null || par === null || le === null || !nomValidateurExploitable(par)) continue;
      const lu: ValidationRegle = { categorie: cat, valeur, documentId: texte(o.documentId), zoneCode: texte(o.zoneCode), reference, par, le };
      const source = o.source === "documentaire" || o.source === "saisie" ? o.source : null;
      const emp = texte(o.empreinteSource);
      out[cat] = { ...lu, ...(source ? { source } : {}), ...(emp ? { empreinteSource: emp } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}

export function ecrireValidations(storage: StockageEcriture, studyId: string | null, v: ValidationsRegles, signatureParcelle?: string | null): void {
  try {
    storage.setItem(cleValidations(studyId, signatureParcelle), JSON.stringify(v));
  } catch {
    /* quota : silencieux, la règle restera « à vérifier » */
  }
}

/** Valide une règle pour une personne nommée ; renvoie null si l'entrée est refusée. */
export function creerValidation(
  regle: RegleRetrait,
  reference: string,
  par: string,
  maintenant: Date = new Date(),
): { readonly validation: ValidationRegle | null; readonly erreur: string | null } {
  if (regle.valeur === null) return { validation: null, erreur: "Aucune valeur à valider : la règle est absente du ruleset." };
  if (!texte(par)) return { validation: null, erreur: "Indiquez le nom de la personne qui valide." };
  if (!nomValidateurExploitable(par)) return { validation: null, erreur: "Nom non exploitable : indiquez le prénom et le nom de la personne qui valide." };
  if (!referenceExploitable(reference, idsDocumentRegle(regle))) {
    return { validation: null, erreur: "Référence non exploitable : indiquez le document et l'article numéroté (ex. « PLU Rennes, art. UA 6 »), ou l'identifiant exact du document." };
  }
  return {
    validation: {
      categorie: regle.categorie,
      valeur: regle.valeur,
      documentId: regle.provenance.documentId,
      zoneCode: regle.provenance.zoneCode,
      reference: reference.trim(),
      par: par.trim(),
      le: maintenant.toISOString(),
      source: "saisie",
    },
    erreur: null,
  };
}

/** Identifiants de document connus pour une règle (document_id du ruleset, id et idurba de la provenance). */
export function idsDocumentRegle(regle: RegleRetrait): string[] {
  const d = regle.provenance.document ?? null;
  return [regle.provenance.documentId, d?.id ?? null, d?.idurba ?? null].filter((x): x is string => typeof x === "string" && x.length > 0);
}

/**
 * L2 — « Valider avec la source » : la référence est la source documentaire
 * extraite (PLU de X, art. N, p. P), liée à son extrait par une empreinte.
 * La personne nommée atteste avoir relu l'extrait.
 */
export function creerValidationDepuisSource(
  regle: RegleRetrait,
  par: string,
  maintenant: Date = new Date(),
): { readonly validation: ValidationRegle | null; readonly erreur: string | null } {
  if (regle.valeur === null) return { validation: null, erreur: "Aucune valeur à valider : la règle est absente du ruleset." };
  const pv = regle.provenanceValeur ?? null;
  const doc = regle.provenance.document ?? null;
  if (!regle.documentaire || !pv) return { validation: null, erreur: "Pas de source documentaire (document identifié + article + extrait) pour cette valeur : saisissez la référence lue." };
  if (!texte(par)) return { validation: null, erreur: "Indiquez le nom de la personne qui valide." };
  if (!nomValidateurExploitable(par)) return { validation: null, erreur: "Nom non exploitable : indiquez le prénom et le nom de la personne qui valide." };
  const emp = empreinteSource(pv, doc, regle.provenance.zoneCode);
  if (!emp) return { validation: null, erreur: "Source documentaire incomplète." };
  return {
    validation: {
      categorie: regle.categorie,
      valeur: regle.valeur,
      documentId: regle.provenance.documentId,
      zoneCode: regle.provenance.zoneCode,
      reference: libelleSourceDocumentaire(pv, doc),
      par: par.trim(),
      le: maintenant.toISOString(),
      source: "documentaire",
      empreinteSource: emp,
    },
    erreur: null,
  };
}

export type MotifRegle =
  | "valeur-absente"
  | "regle-non-chiffree"
  | "regle-alternative"
  | "regle-non-sourcee"
  | "reference-factice"
  | "regle-ia-non-confirmee"
  | "validation-perimee";

/** Pourquoi une règle NE PEUT PAS fonder un verdict ; null si elle le peut. */
export function motifNonSourcee(regle: RegleRetrait, validation: ValidationRegle | null | undefined): MotifRegle | null {
  if (regle.valeur === null) return "valeur-absente";
  if (regle.typeRegle && /^(H_OVER_2|CONDITIONNEL)/i.test(regle.typeRegle)) return "regle-non-chiffree";
  if (regle.typeRegle && /^ALIGNEMENT_OU_RETRAIT$/i.test(regle.typeRegle)) return "regle-alternative";
  if (regle.provenance.documentId === null) return "regle-non-sourcee";
  if (!documentIdExploitable(regle.provenance.documentId)) return "reference-factice";
  if (!validation || !nomValidateurExploitable(validation.par)) return "regle-ia-non-confirmee";
  if (
    Math.abs(validation.valeur - regle.valeur) > 1e-9 ||
    validation.documentId !== regle.provenance.documentId ||
    validation.zoneCode !== regle.provenance.zoneCode ||
    validation.categorie !== regle.categorie
  ) {
    return "validation-perimee";
  }
  if (validation.source === "documentaire") {
    // validée « avec la source » : la source doit être toujours la même
    const emp = empreinteSource(regle.provenanceValeur ?? null, regle.provenance.document ?? null, regle.provenance.zoneCode);
    if (!regle.documentaire || !emp || emp !== validation.empreinteSource) return "validation-perimee";
    return null;
  }
  if (!referenceExploitable(validation.reference, idsDocumentRegle(regle))) return "reference-factice";
  return null;
}

/** L2 — nature de la référence d'une règle : documentaire (provenance extraite), saisie (validation tapée) ou aucune. */
export function natureReference(regle: RegleRetrait, validation: ValidationRegle | null | undefined): "documentaire" | "saisie" | "aucune" {
  if (validation && validation.source !== "documentaire" && motifNonSourcee(regle, validation) === null) return "saisie";
  return regle.documentaire ? "documentaire" : "aucune";
}

/** Référence affichée pour une règle (validation si présente, sinon document + zone). */
export function referenceAffichee(regle: RegleRetrait, validation: ValidationRegle | null | undefined): string {
  if (validation && motifNonSourcee(regle, validation) === null) return validation.reference;
  if (regle.documentaire && regle.provenanceValeur) return `${libelleSourceDocumentaire(regle.provenanceValeur, regle.provenance.document ?? null)} (source extraite, non validée)`;
  const p = regle.provenance;
  const parts = [p.documentId ? `document ${p.documentId}` : "document non identifié", p.zoneCode ? `zone ${p.zoneCode}` : "zone inconnue"];
  return parts.join(" · ");
}
