// src/spaces/promoteur/shared/pluRuleset.mapper.ts
// PATCH V1.0 — Mapper UNIQUE du ruleset PLU (plu_ruleset_v1).
//
// Pourquoi ce fichier : ProgrammationPage et Implantation2DPage avaient chacune
// leur `numFrom` avec des listes de clés DIVERGENTES. Un bug corrigé dans l'une
// (ex. `max_m` absent → hauteur max à 0 → « à vérifier » sur une règle pourtant
// lue) réapparaissait dans l'autre. Massing 3D en aurait eu besoin d'un troisième.
//
// Format réel du parser (study.plu) :
//   { zone_code, zone_libelle, source, done, ruleset: {
//       version: "plu_ruleset_v1",
//       hauteur: { max_m, faitage_m, note },        ← max_m = ÉGOUT
//       ces: { max_ratio, note },                   ← RATIO 0–1, null = pas de règle
//       reculs: { voirie: { min_m, note },
//                 limites_separatives: { min_m, note },
//                 facades: { avant, laterales, fond } },
//       stationnement: { par_logement },
//       pleine_terre: { ratio_min },
//       cos: { max, note },
//       completeness: { ok, missing } } }
//
// ⚠️ Toute nouvelle clé du parser s'ajoute ICI, pas dans les pages.

// ─── Types ────────────────────────────────────────────────────────────────────

/** Entrée générique pour les règles non modélisées (affichage libre). */
export interface PluExtraEntry {
  label: string;
  value: string | null;
  note:  string | null;
}

export interface PluRuleset {
  /** true si un règlement exploitable a été trouvé. */
  present: boolean;
  zone:        string;
  description: string;

  // ── Hauteurs ──
  /** Hauteur à l'égout (m). `hauteur.max_m` dans le format v1. */
  hauteurEgoutM:   number | null;
  /** Hauteur au faîtage (m). */
  hauteurFaitageM: number | null;
  /** Repli générique. 0 si aucune règle de hauteur. */
  hauteurMaxM:     number;
  /** Égout extrait de la note (« 10m égout, 13m faîtage ») quand le champ manque. */
  hauteurEgoutFromNote: number | null;
  hauteurNote:     string | null;

  // ── Emprise au sol (CES) ──
  /** Ratio 0–1. null = la zone n'impose PAS de CES (≠ CES de 0 %). */
  empriseMaxRatio: number | null;
  /** Le même en %, 0 si absent — compat des pages qui raisonnent en %. */
  empriseMaxPct:   number;
  /** true = pas de règle CES (à ne JAMAIS traiter comme une non-conformité). */
  empriseAbsente:  boolean;
  empriseNote:     string | null;

  // ── Reculs (m) ──
  reculVoirieM:      number | null;
  reculVoirieNote:   string | null;
  reculLimitesM:     number | null;
  reculLimitesNote:  string | null;
  /** Fond de parcelle ; repli sur les limites séparatives. */
  reculFondM:        number | null;

  // ── Stationnement ──
  parkingParLogement: number;
  parkingAbsent:      boolean;

  // ── Pleine terre / espaces verts ──
  /** En % (le parser stocke un ratio 0–1 sous `ratio_min`). */
  pleineTerreMinPct: number | null;
  pleineTerreNote:   string | null;

  // ── COS ──
  coefficientOccupSol: number | null;
  cosNote:             string | null;

  /** Règles non modélisées, à plat, pour affichage. */
  extra: PluExtraEntry[];
}

export const EMPTY_PLU_RULESET: PluRuleset = {
  present: false,
  zone: "", description: "",
  hauteurEgoutM: null, hauteurFaitageM: null, hauteurMaxM: 0,
  hauteurEgoutFromNote: null, hauteurNote: null,
  empriseMaxRatio: null, empriseMaxPct: 0, empriseAbsente: true, empriseNote: null,
  reculVoirieM: null, reculVoirieNote: null,
  reculLimitesM: null, reculLimitesNote: null, reculFondM: null,
  parkingParLogement: 1, parkingAbsent: true,
  pleineTerreMinPct: null, pleineTerreNote: null,
  coefficientOccupSol: null, cosNote: null,
  extra: [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extrait un nombre d'une valeur de ruleset (scalaire ou objet à clés variables).
 * ⚠️ `max_m` et `ratio_min` sont les clés RÉELLES du format v1 — leur absence
 * de cette liste a déjà causé un bug (hauteur max à 0 sur un PLU pourtant lu).
 */
export function pluNum(obj: unknown): number | null {
  if (obj == null) return null;
  if (typeof obj === "number") return Number.isFinite(obj) ? obj : null;
  if (typeof obj === "string") { const n = parseFloat(obj); return isNaN(n) ? null : n; }
  if (typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  for (const k of [
    "valeur", "m", "metres", "max", "max_m", "min", "min_m", "min_pct",
    "pct", "pourcentage", "percent", "max_ratio", "ratio_min", "ratio",
    "valeur_m", "distance", "value", "v",
  ]) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") { const n = parseFloat(v); if (!isNaN(n)) return n; }
  }
  return null;
}

export function pluNote(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const n = o.note ?? o.label ?? o.description;
  return typeof n === "string" ? n : null;
}

const HANDLED = new Set([
  "ces", "cos", "reculs", "recul", "stationnement", "parking",
  "hauteurs", "gabarit", "hauteur", "pleine_terre", "espaces_verts",
  "espace_vert", "version", "zone_code", "zone_libelle", "completeness",
]);

const LABELS: Record<string, string> = {
  hauteurs: "Hauteurs", gabarit: "Gabarit", hauteur: "Hauteur",
  pleine_terre: "Pleine terre", espaces_verts: "Espaces verts", espace_vert: "Espaces verts",
  facades: "Façades", toiture: "Toiture", clotures: "Clôtures",
  plantations: "Plantations", energie: "Énergie", bruit: "Bruit",
  assainissement: "Assainissement", acces: "Accès / voirie",
  servitudes: "Servitudes", mixite: "Mixité fonctionnelle",
};

function flattenEntry(key: string, val: unknown): PluExtraEntry[] {
  if (val == null) return [];
  const baseLabel = LABELS[key] ?? key.replace(/_/g, " ");
  const directNum = pluNum(val);
  if (directNum != null) return [{ label: baseLabel, value: String(directNum), note: pluNote(val) }];
  if (typeof val !== "object") return [];

  const o = val as Record<string, unknown>;
  const subObjs = Object.entries(o).filter(([k, v]) =>
    !["note", "label", "description", "unit", "done"].includes(k) &&
    typeof v === "object" && v !== null
  );
  if (subObjs.length > 0) {
    return subObjs.flatMap(([subKey, subVal]) => {
      const subLabel = `${baseLabel} — ${LABELS[subKey] ?? subKey.replace(/_/g, " ")}`;
      const n = pluNum(subVal); const nt = pluNote(subVal);
      if (n == null && nt == null) return [];
      return [{ label: subLabel, value: n != null ? String(n) : null, note: nt }];
    });
  }
  const n = pluNum(val); const nt = pluNote(val);
  if (n == null && nt == null) return [];
  return [{ label: baseLabel, value: n != null ? String(n) : null, note: nt }];
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

/**
 * Mappe study.plu (jsonb brut) vers PluRuleset. Retourne EMPTY_PLU_RULESET si
 * aucun règlement exploitable — `present: false` permet aux pages de distinguer
 * « pas de PLU importé » de « PLU importé sans règle sur ce point ».
 */
export function mapPluRuleset(studyPlu: unknown): PluRuleset {
  if (!studyPlu || typeof studyPlu !== "object") return EMPTY_PLU_RULESET;

  const p  = studyPlu as Record<string, any>;
  const rs = (p.ruleset ?? p) as Record<string, any>;

  const zone = p.zone_code ?? p.zone ?? p.zone_plu ?? rs.zone_code ?? rs.zone ?? "";
  if (!zone && !rs.hauteur && !rs.hauteurs && !rs.ces) return EMPTY_PLU_RULESET;

  const hauteurs = rs.hauteur ?? rs.hauteurs ?? rs.gabarit ?? {};
  const ces      = rs.ces ?? rs.emprise_sol ?? {};
  const cos      = rs.cos ?? {};
  const reculs   = rs.reculs ?? rs.recul ?? {};
  const stat     = rs.stationnement ?? rs.parking ?? {};
  const pt       = rs.pleine_terre ?? rs.espaces_verts ?? rs.espace_vert ?? {};

  // ── Hauteurs ── `hauteur.max_m` = ÉGOUT dans le format v1.
  const hauteurEgoutM =
    pluNum(hauteurs.egout) ?? pluNum(hauteurs.egout_m) ?? pluNum(hauteurs.egout_max) ??
    pluNum(hauteurs.hauteur_egout) ?? pluNum(hauteurs.max_m) ?? pluNum(hauteurs.max) ??
    pluNum(p.hauteur_egout_m) ?? null;
  const hauteurFaitageM =
    pluNum(hauteurs.faitage) ?? pluNum(hauteurs.faitage_m) ?? pluNum(hauteurs.faitage_max) ??
    pluNum(p.hauteur_faitage_m) ?? null;
  const hauteurNote = pluNote(hauteurs);
  const hauteurEgoutFromNote = (() => {
    if (!hauteurNote) return null;
    const m = hauteurNote.match(/(\d+(?:[.,]\d+)?)\s*m?\s*[eé]gout/i);
    return m ? parseFloat(m[1].replace(",", ".")) : null;
  })();

  // ── CES ── `max_ratio` est un RATIO (0–1). null = pas de règle, ≠ 0 %.
  const empriseMaxRatio = pluNum(ces.max_ratio) ?? pluNum(ces);
  const empriseAbsente  = empriseMaxRatio == null || empriseMaxRatio <= 0;

  // ── Reculs ── `facades.{avant,laterales,fond}` est plus précis quand présent.
  const fac = reculs.facades ?? {};
  const reculVoirieM  = pluNum(fac.avant) ?? pluNum(reculs.voirie) ?? pluNum(reculs.voirie_m);
  const reculLimitesM = pluNum(fac.laterales) ?? pluNum(reculs.limites_separatives) ??
                        pluNum(reculs.limites) ?? pluNum(reculs.limite);
  const reculFondM    = pluNum(fac.fond) ?? reculLimitesM;

  // ── Stationnement ──
  const parkingRaw = pluNum(stat.par_logement) ?? pluNum(stat) ?? pluNum(p.parking_par_logement);

  // ── Pleine terre ── le parser stocke un ratio 0–1 sous `ratio_min`.
  const ptRaw = pluNum(pt.ratio_min) ?? pluNum(pt.min) ?? pluNum(pt.min_pct) ?? pluNum(pt.pct) ?? pluNum(pt);
  const pleineTerreMinPct = ptRaw == null ? null : (ptRaw <= 1 ? ptRaw * 100 : ptRaw);

  return {
    present: true,
    zone,
    description: p.zone_libelle ?? rs.zone_libelle ?? p.description ?? p.libelle_zone ?? rs.libelle ?? "",
    hauteurEgoutM,
    hauteurFaitageM,
    hauteurMaxM: hauteurEgoutM ?? hauteurFaitageM ?? pluNum(p.hauteur_max_m) ?? 0,
    hauteurEgoutFromNote,
    hauteurNote,
    empriseMaxRatio,
    empriseMaxPct: empriseAbsente ? 0 : (empriseMaxRatio as number) * 100,
    empriseAbsente,
    empriseNote: pluNote(ces),
    reculVoirieM,
    reculVoirieNote:  pluNote(fac.avant ?? reculs.voirie),
    reculLimitesM,
    reculLimitesNote: pluNote(fac.laterales ?? reculs.limites_separatives),
    reculFondM,
    parkingParLogement: parkingRaw ?? 1,
    parkingAbsent: parkingRaw == null,
    pleineTerreMinPct,
    pleineTerreNote: pluNote(pt),
    coefficientOccupSol: pluNum(cos.max) ?? pluNum(cos),
    cosNote: pluNote(cos),
    extra: Object.entries(rs)
      .filter(([k]) => !HANDLED.has(k))
      .flatMap(([k, v]) => flattenEntry(k, v))
      .filter((e) => e.value != null || e.note != null),
  };
}