// src/spaces/promoteur/services/proprietairesParcellesExport.ts
//
// Export Excel des résultats de recherche de propriétaires.
//
// Le fichier quitte l'application : c'est justement là que le périmètre de la
// donnée risque de se perdre. Une feuille « Périmètre et source » l'accompagne
// donc systématiquement — sans elle, un tableau de dénominations sorti de son
// contexte se lit comme une liste exhaustive de propriétaires, ce qu'il n'est
// pas.

import * as XLSX from "xlsx";

import {
  formatAdresse,
  formatParcelle,
  formatSiren,
} from "./proprietairesParcelles.service";
import type {
  ProprietaireParcelleRow,
  RechercheProprietairesResponse,
} from "../types/proprietairesParcelles.types";

const PLACEHOLDER = "Non disponible";

export interface ContexteExport {
  /** Libellé du critère de recherche, tel qu'affiché à l'écran. */
  critere: string;
  modeLibelle: string;
}

function horodatage(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "recherche";
}

function ou(valeur: string | null | undefined): string {
  return valeur && valeur.trim() ? valeur : PLACEHOLDER;
}

export function exporterProprietairesXlsx(
  reponse: RechercheProprietairesResponse,
  ctx: ContexteExport,
): void {
  const entetes = [
    "Dénomination",
    "SIREN",
    "Forme juridique",
    "Droit",
    "Commune",
    "Code INSEE",
    "Parcelle",
    "Référence cadastrale (IDU)",
    "Adresse",
    "Millésime",
  ];

  const lignes = reponse.rows.map((r: ProprietaireParcelleRow) => [
    r.denomination,
    ou(formatSiren(r.siren)),
    ou(r.formeJuridique),
    ou(r.codeDroit),
    ou(r.communeNom),
    r.codeInsee,
    formatParcelle(r),
    r.idu,
    ou(formatAdresse(r)),
    r.millesime,
  ]);

  const feuille = XLSX.utils.aoa_to_sheet([entetes, ...lignes]);
  feuille["!cols"] = [
    { wch: 38 }, { wch: 13 }, { wch: 18 }, { wch: 8 }, { wch: 22 },
    { wch: 11 }, { wch: 14 }, { wch: 18 }, { wch: 30 }, { wch: 10 },
  ];
  feuille["!freeze"] = { xSplit: 0, ySplit: 1 };
  feuille["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { c: 0, r: 0 },
      e: { c: entetes.length - 1, r: lignes.length },
    }),
  };

  // Feuille de contexte. L'avertissement de périmètre y est en toutes lettres :
  // c'est la seule chose qui voyage avec le fichier.
  const contexte = XLSX.utils.aoa_to_sheet([
    ["Recherche de propriétaires — personnes morales"],
    [],
    ["Type de recherche", ctx.modeLibelle],
    ["Critère", ctx.critere],
    ["Millésime des données", reponse.millesime ?? PLACEHOLDER],
    [
      "Correspondances trouvées",
      reponse.totalPlafonne ? `Plus de ${reponse.total}` : reponse.total,
    ],
    ["Lignes exportées", reponse.rows.length],
    [
      "Export tronqué",
      reponse.totalPlafonne
        ? "Oui — extrait non exhaustif, affine le critère pour obtenir la totalité"
        : reponse.tronque
          ? "Oui — affine le critère pour obtenir la totalité"
          : "Non",
    ],
    ["Date d'export", new Date().toLocaleString("fr-FR")],
    [],
    ["PÉRIMÈTRE DE LA DONNÉE"],
    [
      "Cette source ne contient aucune personne physique. Une parcelle absente de",
    ],
    [
      "cette liste n'est pas sans propriétaire : elle appartient vraisemblablement",
    ],
    ["à un particulier, dont l'identité n'est pas accessible ici."],
    [],
    ["Source : DGFiP — fichiers des parcelles des personnes morales"],
    ["Licence Ouverte 2.0 (Etalab)"],
    [],
    [
      "Les identifiants SIREN commençant par « U » sont fictifs et créés par la DGFiP :",
    ],
    ["ils ne sont jamais conservés, la ligne apparaît alors sans SIREN."],
  ]);
  contexte["!cols"] = [{ wch: 32 }, { wch: 60 }];

  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, "Propriétaires");
  XLSX.utils.book_append_sheet(classeur, contexte, "Périmètre et source");

  XLSX.writeFile(
    classeur,
    `mimmoza-proprietaires-${slug(ctx.critere)}-${horodatage()}.xlsx`,
  );
}
