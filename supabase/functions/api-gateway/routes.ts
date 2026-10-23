// supabase/functions/api-gateway/routes.ts
// ─────────────────────────────────────────────────────────────────────────────
// Exécution des routes de l'API publique : construction du corps attendu par
// chaque fonction interne, interprétation de sa réponse, mise en forme publique
// (aucune donnée DVF individuelle, aucune consigne destinée au LLM interne).
//
// Contrats des fonctions internes (lus dans leur index.ts le 22/10/2026) :
//   · « standard » { status: ok|no_data|no_localization|error, summary, stats, items }
//     en HTTP 200 : dpe-ademe-v1, batiment-bdnb-v1, loyers-reference-v1,
//     taxes-locales-v1, zonage-abc-v1, bruit-classement-v1, potentiel-solaire-v1,
//     altimetrie-v1, patrimoine-merimee-v1, servitudes-gpu-v1,
//     couts-construction-v1, couts-renovation-v1, etude-parcelle-v1 ;
//   · smartscore-enriched-v3 : { success, … } ;
//   · cadastre-parcelle-by-id : { success, feature } (404 si introuvable) ;
//   · plu-from-parcelle-v2 : { success, plu: { found, zone_code, ruleset, reason } } ;
//   · sitadel-v1 : { ok, logements, surface, rows } (toujours HTTP 200) ;
//   · transport-score-gtfs-v1 : { score } | { error } (400/500) ;
//   · valuation-engine : résultat | { error } (400/500).
// ─────────────────────────────────────────────────────────────────────────────

import type { AppelInterne, ReponseInterne } from "../_shared/apiBase.ts";
import type { ApiEndpoint } from "../_shared/apiCatalogue.ts";
import { CLES_DVF_INDIVIDUELLES, masquerPrixSousSecret, periodeDvf, SEUIL_SECRET_STATISTIQUE, statistiquesDvf, supprimerCles } from "../_shared/apiDvf.ts";
import type { IdSource } from "../_shared/apiSources.ts";
import * as V from "../_shared/apiValidation.ts";

export interface ContexteRoute {
  appeler: AppelInterne;
  /** Délai maximal par appel interne. */
  delaiMs: number;
  /** code INSEE → code EPCI (SIREN) ; null si inconnu ; "erreur" si le service est injoignable. */
  resoudreEpci: (codeInsee: string) => Promise<string | null | "erreur">;
  maintenant: () => Date;
}

export type IssueRoute =
  | {
    issue: "succes";
    statut: "ok" | "sans_donnee" | "partiel";
    donnees: unknown;
    sources: IdSource[];
    avertissements: string[];
  }
  | {
    issue: "echec";
    status: number;
    code: string;
    message: string;
    /** Pour le journal uniquement (jamais renvoyé au client). */
    diagnostic?: string;
  };

type Echec = Extract<IssueRoute, { issue: "echec" }>;

// ── Aides ──────────────────────────────────────────────────────────────────

/** Retire les clés undefined (corps JSON propre pour les fonctions internes). */
function propre(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

export function echecTechnique(fonction: string, r: ReponseInterne): Echec {
  if (r.status === 404) {
    return { issue: "echec", status: 404, code: "introuvable", message: "Aucun résultat pour ces paramètres.", diagnostic: `${fonction} 404` };
  }
  if (r.cause === "delai") {
    return { issue: "echec", status: 504, code: "delai_depasse", message: "La source de données n'a pas répondu à temps. Aucun crédit n'a été débité.", diagnostic: `${fonction} delai` };
  }
  return {
    issue: "echec",
    status: 502,
    code: "source_indisponible",
    message: "La source de données est momentanément indisponible. Aucun crédit n'a été débité.",
    diagnostic: `${fonction} ${r.cause ?? "statut"} ${r.status}`,
  };
}

type EtatStandard = "ok" | "sans_donnee" | "localisation" | "echec";

export function lireStandard(r: ReponseInterne): EtatStandard {
  if (!r.ok || !r.json || typeof r.json !== "object") return "echec";
  const s = String(r.json.status ?? "");
  if (s === "ok") return "ok";
  if (s === "no_data") return "sans_donnee";
  if (s === "no_localization") return "localisation";
  return "echec";
}

function blocStandard(r: ReponseInterne): Record<string, unknown> {
  const j = r.json ?? {};
  const out: Record<string, unknown> = {
    resume: typeof j.summary === "string" ? j.summary : null,
    stats: supprimerCles(j.stats ?? null),
  };
  if (j.items !== undefined) out.items = supprimerCles(j.items);
  return out;
}

function echecLocalisation(fonction: string): Echec {
  return {
    issue: "echec",
    status: 422,
    code: "localisation_insuffisante",
    message: "La localisation fournie ne permet pas d'interroger cette source. Aucun crédit n'a été débité.",
    diagnostic: `${fonction} no_localization`,
  };
}

/** Route mono-source au contrat « standard ». */
async function routeStandard(
  ctx: ContexteRoute,
  fonction: string,
  corps: Record<string, unknown>,
  sources: IdSource[],
): Promise<IssueRoute> {
  const r = await ctx.appeler(fonction, propre(corps), ctx.delaiMs);
  const etat = lireStandard(r);
  if (etat === "echec") return r.ok ? { ...echecTechnique(fonction, { ...r, ok: false, cause: undefined }), status: 502 } : echecTechnique(fonction, r);
  if (etat === "localisation") return echecLocalisation(fonction);
  return { issue: "succes", statut: etat, donnees: blocStandard(r), sources, avertissements: [] };
}

interface SousResultat {
  cle: string;
  statut: "ok" | "sans_donnee" | "indisponible";
  bloc: Record<string, unknown> | null;
}

/**
 * Composite : appels PARALLÈLES, chacun borné par ctx.delaiMs. Réponse
 * partielle si au moins une source a répondu (réservation due) ; échec (donc
 * remboursement total) si toutes ont échoué.
 */
async function composite(
  ctx: ContexteRoute,
  appels: Array<{ cle: string; fonction: string; corps: Record<string, unknown> }>,
  sources: IdSource[],
): Promise<IssueRoute> {
  const res = await Promise.all(appels.map(async (a): Promise<SousResultat> => {
    try {
      const r = await ctx.appeler(a.fonction, propre(a.corps), ctx.delaiMs);
      const e = lireStandard(r);
      if (e === "ok" || e === "sans_donnee") return { cle: a.cle, statut: e, bloc: blocStandard(r) };
      return { cle: a.cle, statut: "indisponible", bloc: null };
    } catch {
      return { cle: a.cle, statut: "indisponible", bloc: null };
    }
  }));
  const repondu = res.filter((x) => x.statut !== "indisponible");
  if (repondu.length === 0) {
    return {
      issue: "echec",
      status: 502,
      code: "sources_indisponibles",
      message: "Aucune des sources interrogées n'a répondu. Aucun crédit n'a été débité.",
      diagnostic: `composite ${appels.map((a) => a.fonction).join(",")} tout en echec`,
    };
  }
  const indispo = res.filter((x) => x.statut === "indisponible").map((x) => x.cle);
  const donnees: Record<string, unknown> = {};
  for (const x of res) donnees[x.cle] = x.bloc ? { statut: x.statut, ...x.bloc } : { statut: "indisponible" };
  const statut = indispo.length ? "partiel" : (res.some((x) => x.statut === "ok") ? "ok" : "sans_donnee");
  return {
    issue: "succes",
    statut,
    donnees: { ...donnees, sources_indisponibles: indispo },
    sources,
    avertissements: indispo.length
      ? [`Réponse partielle : source(s) indisponible(s) : ${indispo.join(", ")}. L'appel reste facturé car au moins une source a répondu.`]
      : [],
  };
}

// ── SmartScore (scoring, DVF, risques, estimation) ─────────────────────────

const TYPE_LOCAL_SMARTSCORE: Record<V.TypeBienDvf, string> = {
  appartement: "appartement",
  maison: "maison",
  local: "local",
};

function corpsSmartscore(e: V.Localisation): Record<string, unknown> {
  return {
    lat: e.lat,
    lon: e.lon,
    parcel_id: e.reference?.idu,
    commune_insee: e.code_insee,
    // Pas de serveur Overpass public pour l'API payante : repli sur la BPE INSEE.
    sans_overpass: true,
  };
}

function pointPublic(rp: unknown): Record<string, unknown> | null {
  if (!rp || typeof rp !== "object") return null;
  const p = rp as Record<string, unknown>;
  return {
    lat: typeof p.lat === "number" ? p.lat : null,
    lon: typeof p.lon === "number" ? p.lon : null,
    code_insee: typeof p.commune_insee === "string" ? p.commune_insee : null,
    origine: p.source ?? null,
  };
}

const SOURCES_SMARTSCORE: IdSource[] = ["dvf", "insee", "osm", "georisques", "finess", "ban", "gtfs", "idfm", "sitadel", "cadastre", "modele_mimmoza"];

async function scoring(ctx: ContexteRoute, e: V.EntreeScoring): Promise<IssueRoute> {
  const corps = propre({
    ...corpsSmartscore(e),
    type_local: e.type_bien ? TYPE_LOCAL_SMARTSCORE[e.type_bien] : undefined,
    surface: e.surface_m2,
    prix: e.prix,
    radius_km: e.rayon_km,
    horizon_months: e.horizon_mois,
    dpe_label: e.dpe,
  });
  const r = await ctx.appeler("smartscore-enriched-v3", corps, ctx.delaiMs);
  if (!r.ok || r.json?.success !== true) {
    if (r.status === 400) return { ...echecLocalisation("smartscore-enriched-v3"), message: "Point d'analyse introuvable (parcelle ou coordonnées non résolues). Aucun crédit n'a été débité." };
    return echecTechnique("smartscore-enriched-v3", r.ok ? { ...r, ok: false, cause: undefined } : r);
  }
  const brut = { ...r.json };
  delete brut.input; // écho de la requête, inutile
  delete brut.orchestrator;
  return {
    issue: "succes",
    statut: "ok",
    donnees: supprimerCles(brut),
    sources: SOURCES_SMARTSCORE,
    avertissements: [
      "smartscore_v4 fait foi ; le bloc smartscore (v3) est conservé pour compatibilité et sera retiré.",
      "Les ventes DVF individuelles ne sont pas diffusées : seules des statistiques agrégées sont renvoyées.",
    ],
  };
}

async function marcheDvf(ctx: ContexteRoute, e: V.EntreeDvf): Promise<IssueRoute> {
  const res = await Promise.all(e.types.map(async (t) => {
    const r = await ctx.appeler("smartscore-enriched-v3", propre({
      ...corpsSmartscore(e),
      include: ["dvf"],
      type_local: TYPE_LOCAL_SMARTSCORE[t],
      radius_km: e.rayon_km,
      horizon_months: e.horizon_mois,
    }), ctx.delaiMs);
    return { t, r };
  }));
  const reussis = res.filter((x) => x.r.ok && x.r.json?.success === true && x.r.json?.dvf);
  if (reussis.length === 0) {
    const r0 = res[0].r;
    if (r0.status === 400) return { ...echecLocalisation("smartscore-enriched-v3"), message: "Point d'analyse introuvable (parcelle ou coordonnées non résolues). Aucun crédit n'a été débité." };
    return echecTechnique("smartscore-enriched-v3", r0.ok ? { ...r0, ok: false, cause: undefined } : r0);
  }
  const par_type: Record<string, unknown> = {};
  for (const x of res) {
    const ok = x.r.ok && x.r.json?.success === true && x.r.json?.dvf;
    par_type[x.t] = ok ? statistiquesDvf(x.t, x.r.json.dvf) : { type_bien: x.t, couverture: "indisponible" };
  }
  const point = pointPublic(reussis[0].r.json.resolved_point);
  const indispo = res.filter((x) => !reussis.includes(x)).map((x) => x.t);
  const avecVentes = Object.values(par_type).some((s) => (s as { nombre_ventes?: number }).nombre_ventes! > 0);
  const avertissements = [
    `Statistiques agrégées uniquement (aucune vente individuelle). En dessous de ${SEUIL_SECRET_STATISTIQUE} ventes, les prix ne sont pas publiés (secret statistique).`,
    "La période est la fenêtre demandée ; les fichiers DVF sont publiés avec plusieurs mois de décalage.",
  ];
  if (indispo.length) avertissements.push(`Réponse partielle : statistiques indisponibles pour ${indispo.join(", ")}.`);
  return {
    issue: "succes",
    statut: indispo.length ? "partiel" : (avecVentes ? "ok" : "sans_donnee"),
    donnees: {
      code_insee: point?.code_insee ?? e.code_insee ?? null,
      point: point ? { lat: point.lat, lon: point.lon } : null,
      rayon_km: e.rayon_km,
      periode: periodeDvf(e.horizon_mois, ctx.maintenant()),
      unite: "EUR/m²",
      par_type,
    },
    sources: e.reference ? ["dvf", "cadastre"] : ["dvf"],
    avertissements,
  };
}

async function risques(ctx: ContexteRoute, e: V.Localisation): Promise<IssueRoute> {
  const r = await ctx.appeler("smartscore-enriched-v3", propre({ ...corpsSmartscore(e), include: ["risques"] }), ctx.delaiMs);
  if (!r.ok || r.json?.success !== true) {
    if (r.status === 400) return { ...echecLocalisation("smartscore-enriched-v3"), message: "Point d'analyse introuvable (parcelle ou coordonnées non résolues). Aucun crédit n'a été débité." };
    return echecTechnique("smartscore-enriched-v3", r.ok ? { ...r, ok: false, cause: undefined } : r);
  }
  return {
    issue: "succes",
    statut: r.json.risks ? "ok" : "sans_donnee",
    donnees: { point: pointPublic(r.json.resolved_point), risques: supprimerCles(r.json.risks ?? null) },
    sources: ["georisques", "dpe_ademe", "modele_mimmoza", ...(e.reference ? ["cadastre" as const] : [])],
    avertissements: ["Les aléas Géorisques sont majoritairement qualifiés à l'échelle communale : ils ne valent pas constat à la parcelle."],
  };
}

// ── Cadastre, PLU, servitudes ──────────────────────────────────────────────

function centroide(geom: unknown): { lat: number; lon: number } | null {
  const g = geom as { type?: string; coordinates?: unknown } | null;
  // deno-lint-ignore no-explicit-any
  let anneau: any = null;
  if (g?.type === "Polygon") anneau = (g.coordinates as unknown[])?.[0];
  else if (g?.type === "MultiPolygon") anneau = (g.coordinates as unknown[][])?.[0]?.[0];
  if (!Array.isArray(anneau) || !anneau.length) return null;
  let sx = 0, sy = 0, n = 0;
  for (const c of anneau) if (Array.isArray(c) && c.length >= 2) { sx += c[0]; sy += c[1]; n++; }
  return n ? { lat: Math.round((sy / n) * 1e7) / 1e7, lon: Math.round((sx / n) * 1e7) / 1e7 } : null;
}

async function parcelle(ctx: ContexteRoute, e: { reference: V.ReferenceCadastrale }): Promise<IssueRoute> {
  const r = await ctx.appeler("cadastre-parcelle-by-id", { parcel_id: e.reference.idu, commune_insee: e.reference.code_insee }, ctx.delaiMs);
  if (r.status === 404) return { issue: "echec", status: 404, code: "introuvable", message: "Parcelle introuvable au cadastre. Aucun crédit n'a été débité.", diagnostic: "cadastre 404" };
  if (!r.ok || r.json?.success !== true || !r.json?.feature) return echecTechnique("cadastre-parcelle-by-id", r.ok ? { ...r, ok: false, cause: undefined } : r);
  const f = r.json.feature;
  const p = (f.properties ?? {}) as Record<string, unknown>;
  return {
    issue: "succes",
    statut: "ok",
    donnees: {
      reference_cadastrale: e.reference.idu,
      code_insee: e.reference.code_insee,
      commune: typeof p.nom_com === "string" ? p.nom_com : null,
      prefixe: e.reference.prefixe,
      section: e.reference.section,
      numero: e.reference.numero,
      contenance_m2: typeof p.contenance === "number" ? p.contenance : null,
      centroide: centroide(f.geometry),
      geometrie: f.geometry ?? null,
    },
    sources: ["cadastre"],
    avertissements: ["La contenance cadastrale est une donnée fiscale, pas un relevé de géomètre."],
  };
}

function lirePlu(r: ReponseInterne): { etat: "ok" | "sans_donnee" | "introuvable" | "echec"; bloc?: Record<string, unknown> } {
  if (r.status === 404) return { etat: "introuvable" };
  if (!r.ok || !r.json?.plu || typeof r.json.plu !== "object") return { etat: "echec" };
  const plu = r.json.plu as Record<string, unknown>;
  if (plu.found === true) {
    return { etat: "ok", bloc: { trouve: true, zone_code: plu.zone_code ?? null, reglement: plu.ruleset ?? null } };
  }
  const motif = String(plu.reason ?? "");
  if (motif === "ZONE_NOT_FOUND" || motif === "RULESET_NOT_FOUND") {
    return {
      etat: "sans_donnee",
      bloc: {
        trouve: false,
        zone_code: plu.zone_code ?? null,
        motif: motif === "ZONE_NOT_FOUND" ? "zonage_non_couvert" : "reglement_non_structure",
        reglement: null,
      },
    };
  }
  return { etat: "echec" };
}

async function plu(ctx: ContexteRoute, e: { reference: V.ReferenceCadastrale }): Promise<IssueRoute> {
  const r = await ctx.appeler("plu-from-parcelle-v2", { parcel_id: e.reference.idu, commune_insee: e.reference.code_insee }, ctx.delaiMs);
  const l = lirePlu(r);
  if (l.etat === "introuvable") return { issue: "echec", status: 404, code: "introuvable", message: "Parcelle introuvable au cadastre. Aucun crédit n'a été débité.", diagnostic: "plu 404" };
  if (l.etat === "echec") return echecTechnique("plu-from-parcelle-v2", r.ok ? { ...r, ok: false, cause: undefined } : r);
  return {
    issue: "succes",
    statut: l.etat,
    donnees: { reference_cadastrale: e.reference.idu, code_insee: e.reference.code_insee, ...l.bloc },
    sources: ["cadastre", "gpu", "plu_mimmoza"],
    avertissements: ["Règlement extrait automatiquement : seul le document d'urbanisme opposable fait foi."],
  };
}

async function servitudes(ctx: ContexteRoute, e: { lat: number; lon: number }): Promise<IssueRoute> {
  const r = await routeStandard(ctx, "servitudes-gpu-v1", { lat: e.lat, lon: e.lon }, ["gpu", "cadastre"]);
  if (r.issue === "succes") r.avertissements.push("Le GPU n'est pas exhaustif : une absence de résultat ne prouve pas l'absence de servitude.");
  return r;
}

// ── Faisabilité (étude de parcelle + PLU) ──────────────────────────────────

const CLES_RESERVEES_LLM: ReadonlySet<string> = new Set([
  "interdictions_de_conclusion",
  "interdictions_analyse",
  "note_methode",
  "echantillon",
  "comps",
  "comparables",
  ...CLES_DVF_INDIVIDUELLES,
]);

async function faisabilite(ctx: ContexteRoute, e: V.EntreeFaisabilite): Promise<IssueRoute> {
  const appelEtude = ctx.appeler("etude-parcelle-v1", propre({
    cadastral_ref: e.reference?.idu,
    lat: e.lat,
    lon: e.lon,
    code_insee: e.code_insee,
    surface_m2: e.surface_m2,
  }), ctx.delaiMs);
  const appelPlu = e.reference
    ? ctx.appeler("plu-from-parcelle-v2", { parcel_id: e.reference.idu, commune_insee: e.reference.code_insee }, Math.min(ctx.delaiMs, 15000))
    : Promise.resolve(null);
  const [re, rp] = await Promise.all([appelEtude, appelPlu]);
  const etat = lireStandard(re);
  if (etat === "localisation") return echecLocalisation("etude-parcelle-v1");
  if (etat === "echec") return echecTechnique("etude-parcelle-v1", re.ok ? { ...re, ok: false, cause: undefined } : re);

  const avertissements: string[] = [];
  let pluBloc: Record<string, unknown>;
  if (!rp) {
    pluBloc = { statut: "non_demande", motif: "fournir reference_cadastrale pour obtenir la zone et le règlement PLU" };
  } else {
    const l = lirePlu(rp);
    if (l.etat === "ok" || l.etat === "sans_donnee") pluBloc = { statut: l.etat, ...l.bloc };
    else {
      pluBloc = { statut: "indisponible" };
      avertissements.push("Réponse partielle : le règlement PLU n'a pas pu être lu ; l'étude est fournie sans lui.");
    }
  }
  // Ventes individuelles retirées, puis prix masqués sous le secret statistique (< 5 ventes).
  const stats = masquerPrixSousSecret(supprimerCles(re.json.stats ?? null, CLES_RESERVEES_LLM));
  const items = masquerPrixSousSecret(supprimerCles(re.json.items ?? [], CLES_RESERVEES_LLM));
  if (stats && typeof stats === "object") {
    const avs = (stats as Record<string, unknown>).avertissements;
    if (Array.isArray(avs)) avertissements.push(...avs.filter((a): a is string => typeof a === "string"));
  }
  return {
    issue: "succes",
    statut: pluBloc.statut === "indisponible" ? "partiel" : etat,
    donnees: { resume: typeof re.json.summary === "string" ? re.json.summary : null, etude: stats, sources_detail: items, plu: pluBloc },
    sources: [
      "cadastre", "ban", "loyers", "zonage_abc", "fiscalite", "assainissement", "rge_alti", "gpu", "pvgis",
      "wikipedia", "georisques", "dvf", "modele_mimmoza", ...(rp ? ["plu_mimmoza" as const] : []),
    ],
    avertissements,
  };
}

// ── Permis (Sit@del) ───────────────────────────────────────────────────────

async function permis(ctx: ContexteRoute, e: V.EntreePermis): Promise<IssueRoute> {
  let epci = e.code_epci ?? null;
  if (!epci && e.code_insee) {
    const res = await ctx.resoudreEpci(e.code_insee);
    if (res === "erreur") return { issue: "echec", status: 502, code: "source_indisponible", message: "Résolution de l'intercommunalité momentanément indisponible. Aucun crédit n'a été débité.", diagnostic: "geo.api epci" };
    if (!res) return { issue: "echec", status: 404, code: "introuvable", message: "Aucune intercommunalité (EPCI) connue pour ce code INSEE. Aucun crédit n'a été débité." };
    epci = res;
  }
  const r = await ctx.appeler("sitadel-v1", { epciCode: epci, minYear: e.annee_min }, ctx.delaiMs);
  if (!r.ok) return echecTechnique("sitadel-v1", r);
  if (r.json?.ok !== true) {
    const msg = String(r.json?.error ?? "");
    if (/non trouv/i.test(msg)) return { issue: "echec", status: 404, code: "introuvable", message: "EPCI absent du fichier Sit@del. Aucun crédit n'a été débité.", diagnostic: "sitadel epci absent" };
    return echecTechnique("sitadel-v1", { ...r, ok: false, cause: undefined });
  }
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    issue: "succes",
    statut: "ok",
    donnees: {
      code_epci: epci,
      code_insee: e.code_insee ?? null,
      annee_min: n(r.json.anneeMin) ?? e.annee_min,
      logements_autorises: n(r.json.logements),
      surface_plancher_autorisee_m2: n(r.json.surface),
      nombre_lignes_agregees: n(r.json.rows),
    },
    sources: e.code_insee ? ["sitadel", "ban"] : ["sitadel"],
    avertissements: ["Échelle intercommunale (EPCI) : ces volumes ne décrivent pas une commune ni une parcelle."],
  };
}

// ── Mobilité ───────────────────────────────────────────────────────────────

async function mobilite(ctx: ContexteRoute, e: { lat: number; lon: number; rayon_m: number }): Promise<IssueRoute> {
  const r = await ctx.appeler("transport-score-gtfs-v1", { lat: e.lat, lon: e.lon, radius_m: e.rayon_m }, ctx.delaiMs);
  if (!r.ok || !r.json?.score || typeof r.json.score !== "object") return echecTechnique("transport-score-gtfs-v1", r.ok ? { ...r, ok: false, cause: undefined } : r);
  const s = r.json.score as Record<string, unknown>;
  const vide = (s.total === 0) && Array.isArray(s.top_stops) && s.top_stops.length === 0;
  return {
    issue: "succes",
    statut: vide ? "sans_donnee" : "ok",
    donnees: { score: s },
    sources: ["gtfs", "modele_mimmoza"],
    avertissements: [],
  };
}

// ── Coûts ──────────────────────────────────────────────────────────────────

async function couts(ctx: ContexteRoute, e: V.EntreeCouts): Promise<IssueRoute> {
  if (e.nature === "construction") {
    const r = await routeStandard(ctx, "couts-construction-v1", {
      typologie: e.typologie,
      gamme: e.gamme,
      surface_sdp: e.surface_sdp_m2,
      zone_abc: e.zone_abc,
      code_insee: e.code_insee,
    }, ["bareme_mimmoza", "insee", "zonage_abc"]);
    if (r.issue === "succes") r.avertissements.push("Ordre de grandeur issu d'un barème interne Mimmoza : à confirmer par devis.");
    return r;
  }
  const r = await routeStandard(ctx, "couts-renovation-v1", {
    surface_habitable_m2: e.surface_habitable_m2,
    gamme: e.gamme,
    alea_pct: e.alea_pct,
    restructuration: e.restructuration,
    niveau_global: e.niveau_global,
    postes: e.postes.length ? e.postes : undefined,
  }, ["bareme_mimmoza"]);
  if (r.issue === "succes") r.avertissements.push("Ordre de grandeur issu d'un barème interne Mimmoza : à confirmer par devis.");
  return r;
}

// ── Estimation (DVF agrégé → moteur de valorisation) ───────────────────────

const TYPE_LOCAL_ESTIMATION: Partial<Record<V.EntreeEstimation["type_bien"], string>> = {
  appartement: "appartement",
  maison: "maison",
  local_commercial: "local",
};

async function estimation(ctx: ContexteRoute, e: V.EntreeEstimation): Promise<IssueRoute> {
  const rd = await ctx.appeler("smartscore-enriched-v3", propre({
    lat: e.lat,
    lon: e.lon,
    commune_insee: e.code_insee,
    include: ["dvf"],
    type_local: TYPE_LOCAL_ESTIMATION[e.type_bien],
    radius_km: 2,
    horizon_months: 24,
  }), Math.max(1000, ctx.delaiMs - 10000));
  let referenceM2: number | null = null;
  if (rd.ok && rd.json?.success === true && rd.json?.dvf) {
    const s = statistiquesDvf(e.type_bien, rd.json.dvf);
    referenceM2 = s.prix_m2_median;
  }
  if (referenceM2 === null) {
    return {
      issue: "echec",
      status: rd.ok ? 422 : (rd.cause === "delai" ? 504 : 502),
      code: rd.ok ? "donnees_insuffisantes" : (rd.cause === "delai" ? "delai_depasse" : "source_indisponible"),
      message: rd.ok
        ? "Pas assez de ventes comparables (DVF) autour de ce point pour produire une estimation. Aucun crédit n'a été débité."
        : "Les données de marché sont momentanément indisponibles. Aucun crédit n'a été débité.",
      diagnostic: `estimation dvf ${rd.status} ${rd.cause ?? ""}`,
    };
  }
  const rv = await ctx.appeler("valuation-engine", propre({
    address: e.adresse ?? "",
    city: e.commune ?? "",
    postalCode: e.code_postal ?? "",
    latitude: e.lat,
    longitude: e.lon,
    surface: e.surface_m2,
    landSurface: e.surface_terrain_m2,
    hasPool: e.piscine,
    askingPrice: e.prix_demande,
    propertyType: e.type_bien,
    analysisType: e.profil,
    worksAmount: e.budget_travaux,
    resaleTarget: e.prix_revente_cible,
    marketReference: { pricePerM2: referenceM2, source: "DVF (médiane Mimmoza, rayon 2 km, 24 mois)" },
    sources: { dvf: true },
  }), 10000);
  if (!rv.ok || !rv.json || typeof rv.json !== "object" || rv.json.error) {
    return echecTechnique("valuation-engine", rv.ok ? { ...rv, ok: false, cause: undefined } : rv);
  }
  if (rv.json.valuationBasis === "insufficient") {
    return { issue: "echec", status: 422, code: "donnees_insuffisantes", message: "Données insuffisantes pour produire une estimation. Aucun crédit n'a été débité.", diagnostic: "valuation insufficient" };
  }
  return {
    issue: "succes",
    statut: "ok",
    donnees: supprimerCles(rv.json),
    sources: ["dvf", "modele_mimmoza"],
    avertissements: [
      "Estimation indicative (bêta) fondée sur la médiane DVF agrégée du secteur : ce n'est pas une expertise.",
      ...(TYPE_LOCAL_ESTIMATION[e.type_bien]
        ? []
        : [`Pour le type « ${e.type_bien} », la référence de marché est la médiane DVF tous types de biens bâtis confondus : à interpréter avec prudence.`]),
    ],
  };
}

// ── Table des routes ───────────────────────────────────────────────────────

export interface DefinitionRoute<T = unknown> {
  valider: (corps: Record<string, unknown>) => V.Resultat<T>;
  executer: (ctx: ContexteRoute, entree: T) => Promise<IssueRoute>;
}

function def<T>(valider: (c: Record<string, unknown>) => V.Resultat<T>, executer: (ctx: ContexteRoute, e: T) => Promise<IssueRoute>): DefinitionRoute {
  return { valider, executer } as unknown as DefinitionRoute;
}

export const ROUTES: Record<Exclude<ApiEndpoint, "/health">, DefinitionRoute> = {
  "/v1/scoring/smart": def(V.validerScoring, scoring),
  "/v1/market/dvf": def(V.validerDvf, marcheDvf),
  "/v1/risks": def(V.validerRisques, risques),
  "/v1/parcelle": def(V.validerParcelle, parcelle),
  "/v1/plu": def(V.validerParcelle, plu),
  "/v1/servitudes": def(V.validerServitudes, servitudes),
  "/v1/faisabilite": def(V.validerFaisabilite, faisabilite),
  "/v1/permis": def((c) => V.validerPermis(c), permis),
  "/v1/dpe": def(V.validerDpe, (ctx, e: V.EntreeDpe) =>
    routeStandard(ctx, "dpe-ademe-v1", { address: e.adresse, lat: e.lat, lon: e.lon, code_postal: e.code_postal, radius_m: e.rayon_m }, ["dpe_ademe"])
      .then((r) => {
        if (r.issue === "succes") r.avertissements.push("La base DPE de l'ADEME n'est pas exhaustive : l'absence de DPE ne signifie pas que le bien n'en a pas.");
        return r;
      })),
  "/v1/batiment": def(V.validerBatiment, (ctx, e: { adresse?: string; code_insee?: string }) =>
    routeStandard(ctx, "batiment-bdnb-v1", { address: e.adresse, code_insee: e.code_insee }, ["bdnb"])),
  "/v1/loyers": def(V.validerCommune, (ctx, e: V.EntreeCommune) =>
    routeStandard(ctx, "loyers-reference-v1", { code_insee: e.code_insee, code_postal: e.code_postal, commune: e.commune }, ["loyers", "ban"])),
  "/v1/fiscalite": def(V.validerCommune, (ctx, e: V.EntreeCommune) => {
    const corps = { code_insee: e.code_insee, code_postal: e.code_postal, commune: e.commune };
    return composite(ctx, [
      { cle: "taxes_locales", fonction: "taxes-locales-v1", corps },
      { cle: "zonage_abc", fonction: "zonage-abc-v1", corps },
    ], ["fiscalite", "zonage_abc", "ban"]);
  }),
  "/v1/environnement": def(V.validerEnvironnement, (ctx, e: V.EntreeEnvironnement) =>
    composite(ctx, [
      { cle: "bruit", fonction: "bruit-classement-v1", corps: { lat: e.lat, lon: e.lon, cadastral_ref: e.reference?.idu } },
      { cle: "solaire", fonction: "potentiel-solaire-v1", corps: { lat: e.lat, lon: e.lon } },
      { cle: "altimetrie", fonction: "altimetrie-v1", corps: { lat: e.lat, lon: e.lon, cadastral_ref: e.reference?.idu } },
      { cle: "patrimoine", fonction: "patrimoine-merimee-v1", corps: { lat: e.lat, lon: e.lon, radius_m: e.rayon_patrimoine_m } },
    ], ["gpu", "pvgis", "rge_alti", "merimee", ...(e.reference ? ["cadastre" as const] : [])])),
  "/v1/mobilite": def(V.validerMobilite, mobilite),
  "/v1/couts": def(V.validerCouts, couts),
  "/v1/estimation": def(V.validerEstimation, estimation),
};
