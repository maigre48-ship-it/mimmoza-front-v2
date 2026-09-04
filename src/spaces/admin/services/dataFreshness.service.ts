// src/spaces/admin/services/dataFreshness.service.ts
//
// Fraîcheur des jeux de données de référence.
//
// Toute la mesure est faite en base par la RPC `admin_fraicheur_donnees`, qui
// lit la donnée réelle plutôt qu'une date déclarée. Ce service ne fait que
// traduire son résultat : aucune règle de péremption ne doit être réimplémentée
// ici, sous peine de voir le front et la base diverger silencieusement.

import { supabase } from "../../../lib/supabase";

const RPC = "admin_fraicheur_donnees";

// ── Statuts ──────────────────────────────────────────────────────────────────

/**
 * Le vocabulaire reprend celui du PLU Engine (`PluFreshnessStatus`) pour les
 * trois premiers états, et l'étend là où une source de référence a des cas
 * qu'un document PLU n'a pas : une table peut être vide, ou déclarée sur une
 * table qui n'existe plus.
 */
export type StatutFraicheur =
  | "a_jour"
  | "a_verifier"
  | "perime"
  | "vide"
  | "inconnu"
  | "table_absente";

/** Ordre de gravité : ce qui demande une action passe en premier. */
const GRAVITE: Record<StatutFraicheur, number> = {
  perime: 0,
  table_absente: 1,
  vide: 2,
  a_verifier: 3,
  inconnu: 4,
  a_jour: 5,
};

export function libelleStatut(statut: StatutFraicheur): string {
  switch (statut) {
    case "a_jour":
      return "À jour";
    case "a_verifier":
      return "À vérifier";
    case "perime":
      return "Périmé";
    case "vide":
      return "Jamais chargé";
    case "inconnu":
      return "Date inconnue";
    case "table_absente":
      return "Table absente";
    default:
      return "Indéterminé";
  }
}

/**
 * Explique ce que le statut veut dire, et surtout ce qu'il ne veut pas dire.
 * « Jamais chargé » et « Périmé » se confondent facilement alors qu'ils
 * appellent des gestes opposés : le premier demande un premier import, le
 * second une relance.
 */
export function explicationStatut(statut: StatutFraicheur): string {
  switch (statut) {
    case "a_jour":
      return "La donnée est dans sa période de validité attendue.";
    case "a_verifier":
      return "La cadence habituelle est dépassée, mais on reste dans le délai de grâce. Un nouveau millésime est peut-être paru.";
    case "perime":
      return "La cadence attendue est dépassée au-delà du délai de grâce. Cette donnée devrait être rechargée.";
    case "vide":
      return "La table existe mais ne contient aucune ligne : cet import n'a jamais abouti.";
    case "inconnu":
      return "Aucune colonne ne date cette table et aucune date n'a été saisie dans le registre. L'ancienneté est indéterminable.";
    case "table_absente":
      return "La table déclarée dans le registre n'existe pas en base. Le registre doit être corrigé.";
    default:
      return "";
  }
}

export type ToneBadge = "emerald" | "amber" | "rose" | "slate" | "sky" | "violet";

export function toneStatut(statut: StatutFraicheur): ToneBadge {
  switch (statut) {
    case "a_jour":
      return "emerald";
    case "a_verifier":
      return "amber";
    case "perime":
    case "table_absente":
      return "rose";
    case "vide":
      return "violet";
    default:
      return "slate";
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

/** Forme brute renvoyée par la RPC, en snake_case. */
type FraicheurRow = {
  cle: string;
  libelle: string;
  categorie: string;
  table_cible: string | null;
  mode_mesure: "millesime" | "horodatage" | "manuel";
  valeur_mesuree: string | null;
  date_reference: string | null;
  age_jours: number | null;
  lignes: number | null;
  cadence_jours: number;
  tolerance_jours: number;
  statut: string;
  source_url: string | null;
  commande_maj: string | null;
  notes: string | null;
};

export type SourceFraicheur = {
  cle: string;
  libelle: string;
  categorie: string;
  tableCible: string | null;
  modeMesure: "millesime" | "horodatage" | "manuel";
  valeurMesuree: string | null;
  dateReference: string | null;
  ageJours: number | null;
  lignes: number | null;
  cadenceJours: number;
  toleranceJours: number;
  statut: StatutFraicheur;
  sourceUrl: string | null;
  commandeMaj: string | null;
  notes: string | null;
};

const STATUTS_CONNUS: StatutFraicheur[] = [
  "a_jour",
  "a_verifier",
  "perime",
  "vide",
  "inconnu",
  "table_absente",
];

function versStatut(brut: string): StatutFraicheur {
  return (STATUTS_CONNUS as string[]).includes(brut)
    ? (brut as StatutFraicheur)
    : "inconnu";
}

function mapper(row: FraicheurRow): SourceFraicheur {
  return {
    cle: row.cle,
    libelle: row.libelle,
    categorie: row.categorie,
    tableCible: row.table_cible,
    modeMesure: row.mode_mesure,
    valeurMesuree: row.valeur_mesuree,
    dateReference: row.date_reference,
    ageJours: row.age_jours,
    lignes: row.lignes,
    cadenceJours: row.cadence_jours,
    toleranceJours: row.tolerance_jours,
    statut: versStatut(row.statut),
    sourceUrl: row.source_url,
    commandeMaj: row.commande_maj,
    notes: row.notes,
  };
}

// ── Lecture ──────────────────────────────────────────────────────────────────

export async function chargerFraicheurDonnees(): Promise<SourceFraicheur[]> {
  const { data, error } = await supabase.rpc(RPC);

  if (error) {
    // La RPC lève « forbidden » pour un non-administrateur. Le distinguer d'une
    // panne évite d'envoyer chercher un incident là où il n'y a qu'un défaut
    // de droits.
    if (error.message?.includes("forbidden")) {
      throw new Error("Accès réservé aux administrateurs.");
    }
    throw new Error(error.message);
  }

  const rows = (data ?? []) as FraicheurRow[];
  return rows.map(mapper).sort((a, b) => {
    const parGravite = GRAVITE[a.statut] - GRAVITE[b.statut];
    if (parGravite !== 0) return parGravite;
    const parCategorie = a.categorie.localeCompare(b.categorie, "fr");
    if (parCategorie !== 0) return parCategorie;
    return a.libelle.localeCompare(b.libelle, "fr");
  });
}

/** Saisit à la main la date d'un jeu de données qui ne porte aucune colonne datable. */
export async function definirDateManuelle(cle: string, date: string | null): Promise<void> {
  const { error } = await supabase
    .from("sources_donnees_reference")
    .update({ date_manuelle: date, updated_at: new Date().toISOString() })
    .eq("cle", cle);

  if (error) throw new Error(error.message);
}

// ── Synthèse ─────────────────────────────────────────────────────────────────

export type SyntheseFraicheur = {
  total: number;
  aJour: number;
  aVerifier: number;
  /** Périmé, jamais chargé, ou déclaré sur une table absente. */
  aTraiter: number;
  /** Sources dont l'ancienneté est indéterminable — ni bonne ni mauvaise nouvelle. */
  indetermines: number;
};

export function resumer(sources: SourceFraicheur[]): SyntheseFraicheur {
  const compte = (...statuts: StatutFraicheur[]) =>
    sources.filter((s) => statuts.includes(s.statut)).length;

  return {
    total: sources.length,
    aJour: compte("a_jour"),
    aVerifier: compte("a_verifier"),
    aTraiter: compte("perime", "vide", "table_absente"),
    indetermines: compte("inconnu"),
  };
}

// ── Mise en forme ────────────────────────────────────────────────────────────

const formatNombre = new Intl.NumberFormat("fr-FR");

export function formatLignes(n: number | null): string {
  return n === null ? "—" : formatNombre.format(n);
}

/**
 * Ancienneté en clair.
 *
 * Une date de référence peut être dans le futur : un millésime 2026 est ramené
 * au 31 décembre 2026, donc à un âge négatif. Afficher « -118 jours » n'aurait
 * aucun sens pour le lecteur — on nomme le millésime, qui est l'information
 * réellement utile.
 */
export function formatAnciennete(source: SourceFraicheur): string {
  if (source.ageJours === null) return "—";
  if (source.ageJours < 0) return "millésime en cours";
  if (source.ageJours === 0) return "aujourd'hui";
  if (source.ageJours < 60) return `${source.ageJours} jours`;
  const mois = Math.round(source.ageJours / 30.4);
  if (mois < 24) return `${mois} mois`;
  return `${(source.ageJours / 365.25).toFixed(1).replace(".", ",")} ans`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(d);
}

export function libelleCadence(jours: number): string {
  if (jours <= 8) return "hebdomadaire";
  if (jours <= 45) return "mensuelle";
  if (jours <= 100) return "trimestrielle";
  if (jours <= 200) return "semestrielle";
  if (jours <= 400) return "annuelle";
  return `tous les ${Math.round(jours / 365)} ans`;
}
