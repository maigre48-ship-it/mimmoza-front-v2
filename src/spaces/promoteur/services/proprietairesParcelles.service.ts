// src/spaces/promoteur/services/proprietairesParcelles.service.ts
//
// Recherche des propriétaires personnes morales des parcelles cadastrales.
//
// Tout passe par la RPC `rechercher_proprietaires_parcelles`, en SECURITY
// INVOKER : la lecture reste soumise à la politique RLS de la table, et la
// fonction n'accorde aucun privilège supplémentaire. Le filtrage sur le
// millésime le plus récent et le comptage total sont faits en base — les
// refaire ici les ferait diverger silencieusement.

import { supabase } from "@/lib/supabase";
import type {
  ProprietaireParcelleRow,
  RechercheProprietairesParams,
  RechercheProprietairesResponse,
} from "../types/proprietairesParcelles.types";

const RPC = "rechercher_proprietaires_parcelles";

/** Au-delà, la page devient illisible et la requête coûteuse. La RPC plafonne à 500. */
export const LIMITE_PAR_DEFAUT = 200;

const VIDE: RechercheProprietairesResponse = {
  rows: [],
  total: 0,
  totalPlafonne: false,
  tronque: false,
  millesime: null,
};

// ── Normalisation des saisies ────────────────────────────────────────────────

/** Neuf chiffres, quelle que soit la ponctuation saisie (« 822 205 449 », « 822.205.449 »). */
export function normaliserSiren(brut: string): string {
  return brut.replace(/[^0-9]/g, "");
}

export function sirenValide(brut: string): boolean {
  return /^[0-9]{9}$/.test(normaliserSiren(brut));
}

/**
 * Un IDU cadastral fait 14 caractères : INSEE(5) + préfixe(3) + section(2) +
 * numéro(4). La section peut contenir des lettres, d'où l'alphanumérique.
 */
export function iduValide(brut: string): boolean {
  return /^[0-9A-Z]{14}$/i.test(brut.trim());
}

// ── Mapping ──────────────────────────────────────────────────────────────────

type RpcRow = {
  idu: string;
  code_insee: string;
  commune_nom: string | null;
  prefixe: string | null;
  section: string;
  numero_parcelle: string;
  denomination: string;
  siren: string | null;
  forme_juridique: string | null;
  forme_juridique_code: string | null;
  code_droit: string | null;
  numero_voirie: string | null;
  nom_voie: string | null;
  millesime: number;
  total_trouve: number;
  total_plafonne: boolean;
};

function mapper(row: RpcRow): ProprietaireParcelleRow {
  return {
    idu: row.idu,
    codeInsee: row.code_insee,
    communeNom: row.commune_nom,
    prefixe: row.prefixe,
    section: row.section,
    numeroParcelle: row.numero_parcelle,
    denomination: row.denomination,
    siren: row.siren,
    formeJuridique: row.forme_juridique,
    formeJuridiqueCode: row.forme_juridique_code,
    codeDroit: row.code_droit,
    numeroVoirie: row.numero_voirie,
    nomVoie: row.nom_voie,
    millesime: row.millesime,
  };
}

/**
 * Traduit les exceptions SQL en messages exploitables.
 *
 * La RPC lève des messages courts et techniques ; les rendre tels quels
 * enverrait l'utilisateur chercher une panne là où il n'a qu'une saisie
 * incomplète.
 */
function messageErreur(brut: string): string {
  if (brut.includes("trois caracteres minimum")) {
    return "Saisis au moins trois caractères : en dessous, la recherche ramènerait des milliers de sociétés sans intérêt.";
  }
  if (brut.includes("neuf chiffres attendus")) {
    return "Un SIREN comporte neuf chiffres.";
  }
  if (brut.includes("fournir un IDU")) {
    return "Renseigne soit la référence cadastrale complète, soit la commune, la section et le numéro.";
  }
  if (brut.includes("code INSEE attendu")) {
    return "Choisis une commune dans la liste de suggestions.";
  }
  if (brut.toLowerCase().includes("permission") || brut.includes("row-level security")) {
    return "Cette donnée est réservée aux utilisateurs connectés.";
  }
  return brut;
}

// ── Requête ──────────────────────────────────────────────────────────────────

export async function rechercherProprietaires(
  params: RechercheProprietairesParams,
): Promise<RechercheProprietairesResponse> {
  const limite = params.limite ?? LIMITE_PAR_DEFAUT;

  const { data, error } = await supabase.rpc(RPC, {
    p_mode: params.mode,
    p_idu: params.idu?.trim() || null,
    p_code_insee: params.codeInsee?.trim() || null,
    p_section: params.section?.trim() || null,
    p_numero: params.numero?.trim() || null,
    p_prefixe: params.prefixe?.trim() || null,
    p_siren: params.siren ? normaliserSiren(params.siren) : null,
    p_denomination: params.denomination?.trim() || null,
    p_limite: limite,
  });

  if (error) throw new Error(messageErreur(error.message));

  const rows = (data ?? []) as RpcRow[];
  if (rows.length === 0) return VIDE;

  // `total_trouve` et `total_plafonne` sont identiques sur toutes les lignes
  // (fenêtre count(*) over()) : la première suffit.
  const total = Number(rows[0].total_trouve ?? rows.length);

  return {
    rows: rows.map(mapper),
    total,
    totalPlafonne: Boolean(rows[0].total_plafonne),
    tronque: total > rows.length,
    millesime: rows[0].millesime ?? null,
  };
}

// ── Mise en forme ────────────────────────────────────────────────────────────

/** « 822205449 » → « 822 205 449 », comme sur un extrait Kbis. */
export function formatSiren(siren: string | null): string | null {
  if (!siren || siren.length !== 9) return siren;
  return `${siren.slice(0, 3)} ${siren.slice(3, 6)} ${siren.slice(6)}`;
}

/** Référence cadastrale lisible : « AB 0045 ». */
export function formatParcelle(row: ProprietaireParcelleRow): string {
  const prefixe = row.prefixe && row.prefixe !== "000" ? `${row.prefixe} ` : "";
  return `${prefixe}${row.section} ${row.numeroParcelle}`;
}

export function formatAdresse(row: ProprietaireParcelleRow): string | null {
  const parts = [row.numeroVoirie, row.nomVoie].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}
