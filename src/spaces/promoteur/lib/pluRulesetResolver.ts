// src/spaces/promoteur/lib/pluRulesetResolver.ts

export type RuleType = "FIXED" | "H_OVER_2" | "H_OVER_2_MIN" | "UNKNOWN";

export type ReculRuleResolved = {
  type: RuleType;
  min_m: number | null;
  note?: string | null;
  derived?: boolean; // true si déduit (façades) faute de règle explicite
};

export type ImplantationEnLimiteResolved = {
  autorisee: boolean | null;
  note?: string | null;
};

export type StationnementResolved = {
  par_logement: number | null;
  par_100m2: number | null;
  note?: string | null;
};

export type HauteurResolved = {
  max_m: number | null;
  note?: string | null;
};

export type CesResolved = {
  max_ratio: number | null; // ex: 0.35 ; si tu n'as que % -> convertir
  note?: string | null;
};

export type ResolvedPluRulesetV1 = {
  version: "plu_ruleset_v1";
  document_id: string;
  commune_insee: string;
  zone_code: string;
  zone_libelle?: string | null;
  confidence_score?: number | null;
  source?: string | null;

  reculs: {
    voirie: ReculRuleResolved;
    limites_separatives: ReculRuleResolved;
    fond_parcelle: ReculRuleResolved;
    implantation_en_limite: ImplantationEnLimiteResolved;

    // Toujours rempli (même si dérivé)
    facades: {
      avant: ReculRuleResolved;
      laterales: ReculRuleResolved;
      fond: ReculRuleResolved;
    };
  };

  ces: CesResolved;
  hauteur: HauteurResolved;
  stationnement: StationnementResolved;

  notes: string[];

  completeness: {
    ok: boolean;
    missing: string[];
  };
};

// -------------------------------------------
// Helpers (indépendants du fichier page)
// -------------------------------------------

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    const normalized = t.replace(",", ".");
    const n = parseFloat(normalized);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function pickFirstNumber(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    const n = toNumber(c);
    if (n !== null) return n;
  }
  return null;
}

function getRulesetValue(ruleset: unknown, ...path: string[]): unknown {
  let current: unknown = ruleset;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function uniqStrings(arr: unknown[]): string[] {
  const s = new Set<string>();
  for (const v of arr) {
    if (typeof v === "string" && v.trim()) s.add(v.trim());
  }
  return Array.from(s);
}

function normalizeRuleType(regle: unknown): RuleType {
  if (regle === "FIXED" || regle === "H_OVER_2" || regle === "H_OVER_2_MIN") return regle;
  return "UNKNOWN";
}

// -------------------------------------------
// Entrée : une ligne zone (ton type actuel)
// -------------------------------------------

export type PluRulesZoneRowLike = {
  document_id: string;
  commune_insee: string;
  zone_code: string;
  zone_libelle: string | null;
  confidence_score: number | null;
  source: string | null;
  created_at: string;

  rules: any;     // on reste permissif, on résout de façon robuste
  ruleset?: unknown;

  retrait_voirie_min_m?: number | string | null;
  retrait_limites_separatives_min_m?: number | string | null;
  retrait_fond_parcelle_min_m?: number | string | null;

  places_par_logement?: number | string | null;
  places_par_100m2?: number | string | null;
};

export function resolvePluRulesetV1(z: PluRulesZoneRowLike): ResolvedPluRulesetV1 {
  const ruleset = z.ruleset;
  const impl = z.rules?.implantation;
  const reculs = z.rules?.reculs;

  // Base reculs (fallback chain, identique à ta page)
  const voirie = pickFirstNumber(
    z.retrait_voirie_min_m,
    impl?.recul_voirie_min_m,
    reculs?.voirie?.min_m,
    getRulesetValue(ruleset, "reculs", "voirie", "min_m")
  );

  const limites = pickFirstNumber(
    z.retrait_limites_separatives_min_m,
    impl?.recul_limite_separative_min_m,
    reculs?.limites_separatives?.min_m,
    getRulesetValue(ruleset, "reculs", "limites_separatives", "min_m")
  );

  const fondParcelle = pickFirstNumber(
    z.retrait_fond_parcelle_min_m,
    reculs?.fond_parcelle?.min_m,
    getRulesetValue(ruleset, "reculs", "fond_parcelle", "min_m")
  );

  // Implantation en limite
  const implLimite: boolean | null =
    typeof impl?.implantation_en_limite_autorisee === "boolean"
      ? impl.implantation_en_limite_autorisee
      : (typeof getRulesetValue(ruleset, "reculs", "implantation_en_limite", "autorisee") === "boolean"
          ? (getRulesetValue(ruleset, "reculs", "implantation_en_limite", "autorisee") as boolean)
          : null);

  // Façades : si pas explicites, on DÉRIVE (et on le marque)
  const fac = impl?.facades;

  const facadeAvantMin = pickFirstNumber(
    fac?.avant?.recul_min_m,
    getRulesetValue(ruleset, "rules", "implantation", "facades", "avant", "recul_min_m")
  );
  const facadeLateralesMin = pickFirstNumber(
    fac?.laterales?.recul_min_m,
    getRulesetValue(ruleset, "rules", "implantation", "facades", "laterales", "recul_min_m")
  );
  const facadeFondMin = pickFirstNumber(
    fac?.fond?.recul_min_m,
    getRulesetValue(ruleset, "rules", "implantation", "facades", "fond", "recul_min_m")
  );

  const facadeAvantRule: ReculRuleResolved =
    facadeAvantMin !== null
      ? { type: normalizeRuleType(fac?.avant?.regle), min_m: facadeAvantMin, note: fac?.avant?.note ?? null }
      : { type: "UNKNOWN", min_m: voirie, note: "Dérivé : façade avant = recul voirie", derived: true };

  const facadeLateralesRule: ReculRuleResolved =
    facadeLateralesMin !== null
      ? { type: normalizeRuleType(fac?.laterales?.regle), min_m: facadeLateralesMin, note: fac?.laterales?.note ?? null }
      : { type: "UNKNOWN", min_m: limites, note: "Dérivé : façades latérales = recul limites séparatives", derived: true };

  const facadeFondRule: ReculRuleResolved =
    facadeFondMin !== null
      ? { type: normalizeRuleType(fac?.fond?.regle), min_m: facadeFondMin, note: fac?.fond?.note ?? null }
      : { type: "UNKNOWN", min_m: fondParcelle, note: "Dérivé : façade fond = recul fond de parcelle", derived: true };

  // Hauteur
  const hauteurMax = toNumber(z.rules?.hauteur?.hauteur_max_m ?? getRulesetValue(ruleset, "hauteur", "max_m"));

  // CES : tu as % dans ton modèle actuel. On le convertit en ratio si présent.
  const cesPercent = toNumber(z.rules?.emprise?.ces_max_percent ?? getRulesetValue(ruleset, "emprise", "ces_max_percent"));
  const cesRatio = cesPercent !== null ? cesPercent / 100 : null;

  // Stationnement
  const stLog = pickFirstNumber(z.places_par_logement, z.rules?.stationnement?.places_par_logement);
  const st100 = pickFirstNumber(z.places_par_100m2, z.rules?.stationnement?.places_par_100m2);

  // Notes (meta + reculs)
  const notes = uniqStrings([
    ...(Array.isArray(z.rules?.meta?.notes) ? z.rules.meta.notes : []),
    reculs?.voirie?.note,
    reculs?.limites_separatives?.note,
    reculs?.fond_parcelle?.note,
    getRulesetValue(ruleset, "reculs", "voirie", "note"),
    getRulesetValue(ruleset, "reculs", "limites_separatives", "note"),
    getRulesetValue(ruleset, "reculs", "fond_parcelle", "note"),
  ]);

  // Complétude : rien n’est "inventé". On autorise null, mais on doit le SIGNALER.
  const missing: string[] = [];
  if (voirie === null) missing.push("reculs.voirie.min_m");
  if (limites === null) missing.push("reculs.limites_separatives.min_m");
  if (fondParcelle === null) missing.push("reculs.fond_parcelle.min_m");
  if (implLimite === null) missing.push("reculs.implantation_en_limite.autorisee");

  // stationnement : au moins un des deux
  if (stLog === null && st100 === null) missing.push("stationnement.(par_logement|par_100m2)");

  // hauteur / ces : non bloquants, mais on les note (pour affichage complet)
  // (ne pas bloquer Implantation 2D pour ces champs si tu veux)
  // Ici on les marque quand même.
  if (hauteurMax === null) missing.push("hauteur.max_m");
  // CES non obligatoire partout; tu peux le laisser non bloquant. On le note.
  if (cesRatio === null) missing.push("ces.max_ratio");

  return {
    version: "plu_ruleset_v1",
    document_id: z.document_id,
    commune_insee: z.commune_insee,
    zone_code: z.zone_code,
    zone_libelle: z.zone_libelle,
    confidence_score: z.confidence_score,
    source: z.source,

    reculs: {
      voirie: { type: "FIXED", min_m: voirie, note: null },
      limites_separatives: { type: "FIXED", min_m: limites, note: null },
      fond_parcelle: { type: "FIXED", min_m: fondParcelle, note: null },
      implantation_en_limite: {
        autorisee: implLimite,
        note: implLimite === null ? "Non déterminable à partir du ruleset" : null,
      },
      facades: {
        avant: facadeAvantRule,
        laterales: facadeLateralesRule,
        fond: facadeFondRule,
      },
    },

    hauteur: { max_m: hauteurMax, note: hauteurMax === null ? "Non trouvée dans le ruleset" : null },
    ces: { max_ratio: cesRatio, note: cesRatio === null ? "Non trouvée dans le ruleset" : null },
    stationnement: {
      par_logement: stLog,
      par_100m2: st100,
      note: stLog === null && st100 === null ? "Non trouvé dans le ruleset" : null,
    },

    notes,

    completeness: {
      ok: missing.length === 0,
      missing,
    },
  };
}
