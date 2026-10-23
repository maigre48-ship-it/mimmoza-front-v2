// supabase/functions/_shared/apiDvf.ts
// ─────────────────────────────────────────────────────────────────────────────
// Anonymisation DVF pour l'API publique.
//
// Les fonctions internes (smartscore-enriched-v3, etude-parcelle-v1,
// valuation-engine) renvoient des comparables INDIVIDUELS (adresse, identifiant
// de mutation, date exacte, prix au m² d'une vente). L'API publique n'en expose
// AUCUN : seulement des statistiques agrégées par type de bien, et avec un
// seuil de secret statistique (moins de SEUIL_SECRET ventes → aucun prix,
// car une médiane sur 1 à 4 ventes révèle quasiment un prix individuel).
// Module PUR.
// ─────────────────────────────────────────────────────────────────────────────

export const SEUIL_SECRET_STATISTIQUE = 5;

/** Clés portant des données de ventes individuelles, supprimées partout. */
export const CLES_DVF_INDIVIDUELLES: ReadonlySet<string> = new Set([
  "comps",
  "comparables",
  "echantillon",
  "transactions_list",
  "mutations",
  "ventes",
  "dvfSales",
]);

/** Copie profonde sans les clés interdites (tableaux et objets imbriqués compris). */
export function supprimerCles(valeur: unknown, cles: ReadonlySet<string> = CLES_DVF_INDIVIDUELLES, profondeur = 0): unknown {
  if (profondeur > 40) return null;
  if (Array.isArray(valeur)) return valeur.map((v) => supprimerCles(v, cles, profondeur + 1));
  if (valeur && typeof valeur === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valeur as Record<string, unknown>)) {
      if (cles.has(k)) continue;
      out[k] = supprimerCles(v, cles, profondeur + 1);
    }
    return out;
  }
  return valeur;
}

function nombreOuNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function arrondi(v: number | null): number | null {
  return v === null ? null : Math.round(v);
}

export interface StatistiquesDvfType {
  type_bien: string;
  couverture: "ok" | "sans_donnee" | "indisponible";
  nombre_ventes: number;
  prix_m2_median: number | null;
  prix_m2_moyen: number | null;
  prix_m2_q1: number | null;
  prix_m2_q3: number | null;
  secret_statistique: boolean;
}

/**
 * Construit les statistiques publiques d'un type de bien à partir du bloc `dvf`
 * renvoyé par smartscore-enriched-v3 (include ["dvf"]) :
 *   { coverage, reason, source, kpis: { transactions_count, price_median_eur_m2,
 *     price_mean_eur_m2, price_q1_eur_m2, price_q3_eur_m2 } | null, comps: [...] }
 * Seuls les KPI agrégés sont lus ; `comps` est ignoré.
 */
export function statistiquesDvf(typeBien: string, bloc: unknown): StatistiquesDvfType {
  const b = (bloc && typeof bloc === "object") ? bloc as Record<string, unknown> : {};
  const k = (b.kpis && typeof b.kpis === "object") ? b.kpis as Record<string, unknown> : null;
  const cov = String(b.coverage ?? "");
  const n = Math.max(0, Math.trunc(nombreOuNull(k?.transactions_count) ?? 0));
  const couverture: StatistiquesDvfType["couverture"] = n > 0 ? "ok" : (cov === "ok" || cov === "no_data" ? "sans_donnee" : "indisponible");
  const secret = n > 0 && n < SEUIL_SECRET_STATISTIQUE;
  const exposer = n >= SEUIL_SECRET_STATISTIQUE;
  return {
    type_bien: typeBien,
    couverture,
    nombre_ventes: n,
    prix_m2_median: exposer ? arrondi(nombreOuNull(k?.price_median_eur_m2)) : null,
    prix_m2_moyen: exposer ? arrondi(nombreOuNull(k?.price_mean_eur_m2)) : null,
    prix_m2_q1: exposer ? arrondi(nombreOuNull(k?.price_q1_eur_m2)) : null,
    prix_m2_q3: exposer ? arrondi(nombreOuNull(k?.price_q3_eur_m2)) : null,
    secret_statistique: secret,
  };
}

/** Fenêtre DEMANDÉE, au mois près (jamais de date exacte de vente). */
export function periodeDvf(horizonMois: number, maintenant = new Date()): { horizon_mois: number; du: string; au: string } {
  const fin = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1));
  const debut = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() - horizonMois, 1));
  const f = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return { horizon_mois: horizonMois, du: f(debut), au: f(fin) };
}

/** Vérifie récursivement qu'aucune donnée de vente individuelle ne subsiste (utilisé par les tests). */
export function contientDonneeIndividuelle(valeur: unknown): boolean {
  if (Array.isArray(valeur)) return valeur.some(contientDonneeIndividuelle);
  if (valeur && typeof valeur === "object") {
    for (const [k, v] of Object.entries(valeur as Record<string, unknown>)) {
      if (CLES_DVF_INDIVIDUELLES.has(k)) return true;
      if (["id_mutation", "date_mutation", "adresse_numero", "id_parcelle", "valeur_fonciere"].includes(k)) return true;
      if (contientDonneeIndividuelle(v)) return true;
    }
  }
  return false;
}

/**
 * Secret statistique dans les réponses composites (ex. /v1/faisabilite) : tout
 * objet qui porte `nb_comparables` (ou `nombre_ventes`) entre 1 et
 * SEUIL_SECRET_STATISTIQUE - 1 voit ses montants (prix, médianes, extrêmes,
 * dispersion) remplacés par null et reçoit `secret_statistique: true`.
 * En dessous de 5 ventes, une médiane révèle presque un prix individuel.
 */
const CLE_MONTANT_DVF = /prix|price|median|mediane|moyen|extreme|dispersion|quartile|q1|q3/i;

export function masquerPrixSousSecret(valeur: unknown, profondeur = 0): unknown {
  if (profondeur > 40) return null;
  if (Array.isArray(valeur)) return valeur.map((v) => masquerPrixSousSecret(v, profondeur + 1));
  if (!valeur || typeof valeur !== "object") return valeur;
  const o = valeur as Record<string, unknown>;
  const nb = typeof o.nb_comparables === "number" ? o.nb_comparables
    : typeof o.nombre_ventes === "number" ? o.nombre_ventes : null;
  const secret = nb != null && nb > 0 && nb < SEUIL_SECRET_STATISTIQUE;
  const sortie: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (secret && CLE_MONTANT_DVF.test(k) && k !== "nb_comparables" && k !== "nombre_ventes") {
      sortie[k] = null;
      continue;
    }
    sortie[k] = masquerPrixSousSecret(v, profondeur + 1);
  }
  if (secret) sortie.secret_statistique = true;
  return sortie;
}
