// src/spaces/investisseur/components/analyse/DispositifFiscalCard.tsx
//
// Chiffrage d'un dispositif d'investissement locatif, affiché sous le panneau
// Rentabilité quand l'utilisateur en sélectionne un.
//
// Le calcul vient du moteur partagé avec les edge functions : la carte ne
// recalcule rien elle-même. Elle affiche l'avantage ET les constats, sans
// jamais montrer le premier sans les seconds — un montant présenté sans sa
// condition d'éligibilité serait pire qu'aucun montant.

import { AlertTriangle, Ban, Info, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import {
  calculerDenormandie,
  calculerJeanbrunAncien,
  calculerJeanbrunNeuf,
  calculerLocAvantages,
  FICHES_DISPOSITIFS,
  type Constat,
  type DispositifResultat,
  type NiveauLoyer,
  type ZoneAbc,
} from "../../services/dispositifs";
import type { FiscalRegime } from "../../types/strategy.types";

interface Props {
  regime: FiscalRegime;
  /** Prix d'acquisition net de frais, en euros. */
  prixAcquisition: number;
  travaux?: number;
  surfaceM2?: number;
  zone?: ZoneAbc;
  loyerMensuel?: number;
  /** Taux marginal d'imposition en %, 30 par défaut. */
  tmiPct?: number;
  niveauLoyer?: NiveauLoyer;
  /** Plafond communal Loc'Avantages en €/m², s'il a été lu en base. */
  plafondLoyerCommunalEurM2?: number;
}

const EUR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function iconeConstat(niveau: Constat["niveau"]) {
  if (niveau === "bloquant") return Ban;
  if (niveau === "avertissement") return AlertTriangle;
  return Info;
}

function couleursConstat(niveau: Constat["niveau"]): string {
  if (niveau === "bloquant") return "border-rose-200 bg-rose-50 text-rose-800";
  if (niveau === "avertissement") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function DispositifFiscalCard({
  regime,
  prixAcquisition,
  travaux,
  surfaceM2,
  zone,
  loyerMensuel,
  tmiPct = 30,
  niveauLoyer = "intermediaire",
  plafondLoyerCommunalEurM2,
}: Props) {
  const resultat = useMemo<DispositifResultat | null>(() => {
    if (!prixAcquisition || prixAcquisition <= 0) return null;

    const logement = {
      prixAcquisitionNetFraisEur: prixAcquisition,
      travauxEur: travaux,
      surfaceHabitableM2: surfaceM2,
      zone,
      loyerMensuelHcEur: loyerMensuel,
    };
    const situation = { tmiPct };

    switch (regime) {
      case "jeanbrun_neuf":
        return calculerJeanbrunNeuf({ logement, situation, niveauLoyer });
      case "jeanbrun_ancien":
        return calculerJeanbrunAncien({ logement, situation, niveauLoyer });
      case "denormandie":
        return calculerDenormandie({ logement, situation, dureeEngagementAns: 9 });
      case "loc_avantages":
        return calculerLocAvantages({
          logement,
          situation,
          niveauLoyer,
          plafondLoyerCommunalEurM2,
          revenusBrutsAnnuelsEur: loyerMensuel ? loyerMensuel * 12 : undefined,
        });
      default:
        return null;
    }
  }, [regime, prixAcquisition, travaux, surfaceM2, zone, loyerMensuel, tmiPct, niveauLoyer, plafondLoyerCommunalEurM2]);

  if (!resultat) return null;

  const fiche = FICHES_DISPOSITIFS[resultat.code];
  const bloquants = resultat.constats.filter((c) => c.niveau === "bloquant");
  const autres = resultat.constats.filter((c) => c.niveau !== "bloquant");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{resultat.libelle}</h3>
          <p className="mt-1 text-sm text-slate-500">
            {resultat.mecanique === "amortissement"
              ? "Amortissement — déduction du revenu foncier"
              : "Réduction d'impôt — imputée sur l'impôt dû"}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            resultat.eligible
              ? "bg-emerald-50 text-emerald-700"
              : "bg-rose-50 text-rose-700"
          }`}
        >
          {resultat.eligible ? "Conditions vérifiées" : "Conditions non remplies"}
        </span>
      </div>

      {/* Le motif de refus passe AVANT le chiffre : sinon l'œil retient le
          montant et oublie qu'il n'y a pas droit. */}
      {bloquants.length > 0 && (
        <div className="mt-4 space-y-2">
          {bloquants.map((c, i) => (
            <div key={i} className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
              <Ban className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div>{c.message}</div>
                {c.reference && <div className="mt-0.5 text-xs opacity-70">{c.reference}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Chiffre libelle="Assiette" valeur={EUR.format(resultat.baseEligibleEur)} />
        <Chiffre libelle="Taux" valeur={`${resultat.tauxPct} %`} />
        <Chiffre
          libelle={resultat.eligible ? "Gain annuel" : "Gain si éligible"}
          valeur={EUR.format(resultat.avantageAnnuelEur)}
        />
        <Chiffre
          libelle={`Total sur ${resultat.dureeEngagementAns} ans`}
          valeur={EUR.format(resultat.avantageTotalEur)}
          fort
        />
      </div>

      {resultat.plafondLoyer && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-600">Loyer mensuel maximal</span>
            <span className="font-semibold text-slate-900">
              {EUR.format(resultat.plafondLoyer.loyerMensuelMaxEur)}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {resultat.plafondLoyer.plafondBaseEurM2} €/m² × coefficient{" "}
            {resultat.plafondLoyer.coefficientStructure} × {resultat.plafondLoyer.surfaceRetenueM2} m²
            {" — "}
            {resultat.plafondLoyer.source}
          </div>
        </div>
      )}

      {autres.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {autres.map((c, i) => {
            const Icone = iconeConstat(c.niveau);
            return (
              <div
                key={i}
                className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${couleursConstat(c.niveau)}`}
              >
                <Icone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{c.message}</span>
              </div>
            );
          })}
        </div>
      )}

      {fiche.piegesCourants.length > 0 && (
        <details className="mt-4 rounded-xl border border-slate-200 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Confusions fréquentes sur ce dispositif
          </summary>
          <ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-600">
            {fiche.piegesCourants.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-slate-300">—</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-4 flex items-start gap-2 border-t border-slate-100 pt-3 text-xs text-slate-400">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Barèmes {resultat.millesimeBaremes}, révisés chaque 1er janvier. TMI retenue :{" "}
          {tmiPct} %. Sources : {resultat.sources.join(" · ")}. À faire valider par un professionnel.
        </span>
      </div>
    </div>
  );
}

function Chiffre({ libelle, valeur, fort }: { libelle: string; valeur: string; fort?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="text-xs text-slate-400">{libelle}</div>
      <div className={`mt-0.5 ${fort ? "text-lg font-semibold text-slate-900" : "text-sm font-medium text-slate-800"}`}>
        {valeur}
      </div>
    </div>
  );
}
