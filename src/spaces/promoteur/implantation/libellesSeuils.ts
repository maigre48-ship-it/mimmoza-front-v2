// src/spaces/promoteur/implantation/libellesSeuils.ts
//
// LOT L1b R2 — libellés partagés pour les exports (PDF) de la page
// Implantation 2D. Le statut du scénario maître (`MasterConformityStatus`)
// repose sur des seuils INTERNES (CES 50 %, hauteur 15 m) : il ne doit jamais
// être présenté comme une conformité. Seul le contrôle sourcé des retraits
// (`implantationCheck.ts`) donne des verdicts, et jamais « conforme ».

import type { ControleImplantation, Verdict } from "./implantationCheck.ts";
import { RAISON_LABELS, VERDICT_LABELS } from "./implantationCheck.ts";
import { LIBELLES_CATEGORIE } from "./rulesetReculs.ts";

export type StatutSeuils = "CONFORME" | "LIMITE" | "BLOQUANT";

export const TITRE_SEUILS_INDICATIFS = "Seuils indicatifs internes (non réglementaires)";

export function libelleSeuilsIndicatifs(s: StatutSeuils): string {
  return s === "CONFORME" ? "Seuils indicatifs tenus" : s === "LIMITE" ? "Proche des seuils indicatifs" : "Hors seuils indicatifs";
}

export const TITRE_CONTROLE_SOURCE = "Contrôle d'implantation Mimmoza — retraits aux limites (règles sourcées)";

export interface LignePdf {
  readonly texte: string;
  readonly verdict: Verdict | null;
  readonly niveau: 0 | 1 | 2;
}

const fmt = (v: number): string => `${v.toFixed(2).replace(".", ",")} m`;

/** Lignes du contrôle sourcé pour un export ; sans contrôle : mention « seuils indicatifs, non réglementaires ». */
export function lignesControlePdf(controle: ControleImplantation | null | undefined): LignePdf[] {
  if (!controle) {
    return [{ texte: "Contrôle sourcé non disponible : les seuils ci-dessus sont indicatifs, non réglementaires ; aucun verdict n'est donné.", verdict: null, niveau: 0 }];
  }
  const out: LignePdf[] = [{ texte: controle.libelleNiveau, verdict: null, niveau: 0 }];
  for (const b of controle.batiments) {
    out.push({ texte: `${b.buildingName}${b.insideParcel ? "" : " (hors parcelle)"} : ${VERDICT_LABELS[b.verdict]}`, verdict: b.verdict, niveau: 1 });
    for (const l of b.limites) {
      // Polices standard jsPDF (WinAnsi) : pas de « − » ni de flèche.
      const dist = l.horsParcelle ? `-${fmt(Math.abs(l.distanceSignee))}` : fmt(l.distance);
      const requis = l.retraitRequis === null ? "retrait requis inconnu" : `retrait ${fmt(l.retraitRequis)}`;
      const src = l.raison === null && l.reference ? ` (${l.reference}${l.validation ? `, validé par ${l.validation.par}` : ""})` : "";
      const pourquoi = l.raison !== null ? ` — ${RAISON_LABELS[l.raison]}` : "";
      out.push({
        texte: `${LIBELLES_CATEGORIE[l.categorie]} ${l.segmentId} : ${dist} mesurés, ${requis}${src} : ${VERDICT_LABELS[l.verdict]}${pourquoi}`,
        verdict: l.verdict,
        niveau: 2,
      });
    }
  }
  out.push({ texte: "Mimmoza ne délivre pas d'attestation de conformité : seule l'autorité compétente instruit le permis.", verdict: null, niveau: 0 });
  return out;
}
