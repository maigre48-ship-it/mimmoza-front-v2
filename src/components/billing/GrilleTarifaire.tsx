// src/components/billing/GrilleTarifaire.tsx
//
// Affichage de la grille tarifaire unique (src/lib/billing/grille.ts).
// Utilisé par la page publique /tarifs et par /abonnement (connecté).
//
// Le paiement en ligne n'étant pas branché, les formules payantes ne sont
// JAMAIS accordées depuis le navigateur : le bouton ouvre un e-mail de demande
// d'ouverture d'accès (CONTACT_ACCES).

import { ArrowRight, Box, CheckCircle2, Coins, FileText, KeyRound, Mail } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import {
  FORMULES,
  MESSAGE_PAIEMENT_INDISPONIBLE,
  PACKS_API,
  PACKS_JETONS,
  PAIEMENT_EN_LIGNE_DISPONIBLE,
  RAPPORT_FAISABILITE_PARCELLE,
  STUDIO_3D,
  formatEurHT,
  mailtoDemandeAcces,
  prixFormule,
  type Formule,
} from "@/lib/billing/grille";
import type { PlanId } from "@/lib/billing/planAccess";

type Periodicite = "mensuel" | "annuel";

export interface GrilleTarifaireProps {
  /** Formule actuelle de l'utilisateur connecté (absent sur la page publique). */
  formuleActuelle?: PlanId;
  /** Formule à mettre en avant (paramètre ?plan=). */
  enAvant?: PlanId;
  /** Page publique : le bouton de la formule gratuite mène à l'inscription. */
  publique?: boolean;
}

function BoutonFormule(props: {
  f: Formule;
  periodicite: Periodicite;
  actuelle: boolean;
  publique: boolean;
}) {
  const { f, periodicite, actuelle, publique } = props;
  const classeBase =
    "mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all";

  if (actuelle) {
    return (
      <span className={`${classeBase} cursor-default bg-slate-100 text-slate-400`}>Formule actuelle</span>
    );
  }

  if (f.prixMensuelHT === 0) {
    return publique ? (
      <Link to="/inscription" className={`${classeBase} bg-violet-600 text-white hover:bg-violet-500`}>
        Créer un compte gratuit <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    ) : (
      <span className={`${classeBase} cursor-default bg-slate-50 text-slate-400`}>Incluse avec votre compte</span>
    );
  }

  // Formule payante : jamais d'octroi local tant que le paiement n'est pas branché.
  if (!PAIEMENT_EN_LIGNE_DISPONIBLE) {
    return (
      <div className="mt-4">
        <p className="mb-2 text-[11px] leading-4 text-slate-500">{MESSAGE_PAIEMENT_INDISPONIBLE}</p>
        <a
          href={mailtoDemandeAcces(f.nom, periodicite)}
          className={`${classeBase} !mt-0 bg-violet-600 text-white hover:bg-violet-500`}
        >
          <Mail className="h-3.5 w-3.5" /> Demander l'ouverture
        </a>
      </div>
    );
  }

  return null;
}

export function GrilleTarifaire({ formuleActuelle, enAvant, publique = false }: GrilleTarifaireProps) {
  const [periodicite, setPeriodicite] = useState<Periodicite>("mensuel");

  return (
    <div>
      {/* Bascule mensuel / annuel */}
      <div className="mb-6 inline-flex rounded-full border border-slate-200 bg-white p-1 text-xs font-semibold shadow-sm">
        {(["mensuel", "annuel"] as Periodicite[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriodicite(p)}
            className={[
              "rounded-full px-3 py-1.5 transition-colors",
              periodicite === p ? "bg-violet-600 text-white" : "text-slate-500 hover:text-slate-800",
            ].join(" ")}
          >
            {p === "mensuel" ? "Sans engagement" : "Engagement annuel"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {FORMULES.map((f) => {
          const isFeatured = enAvant ? enAvant === f.id : Boolean(f.miseEnAvant);
          return (
            <div
              key={f.id}
              className={[
                "flex flex-col rounded-2xl border p-5 transition-shadow",
                isFeatured ? "border-violet-300 bg-violet-50/40 shadow-md" : "border-slate-200 bg-white hover:shadow-sm",
              ].join(" ")}
            >
              {isFeatured && (
                <span className="mb-2 inline-flex w-fit items-center rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Recommandé
                </span>
              )}
              <p className="text-lg font-bold text-slate-900">{f.nom}</p>
              <p className="text-xs text-slate-400">{f.accroche}</p>

              <p className="mt-3 text-2xl font-bold text-violet-600">{prixFormule(f, periodicite)}</p>
              {f.prixMensuelHT > 0 && periodicite === "annuel" && (
                <p className="mt-1 text-[11px] text-slate-500">facturé annuellement</p>
              )}
              {f.prixMensuelHT > 0 && periodicite === "mensuel" && f.prixMensuelAnnuelHT != null && (
                <p className="mt-1 text-[11px] text-slate-500">
                  ou {formatEurHT(f.prixMensuelAnnuelHT)}/mois en annuel
                </p>
              )}

              <ul className="mt-4 flex-1 space-y-1.5">
                {f.points.map((point) => (
                  <li key={point} className="flex items-start gap-1.5 text-xs text-slate-600">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    {point}
                  </li>
                ))}
              </ul>

              <BoutonFormule
                f={f}
                periodicite={periodicite}
                actuelle={formuleActuelle === f.id}
                publique={publique}
              />
            </div>
          );
        })}
      </div>

      {/* Achats à l'unité et options */}
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FileText className="h-4 w-4 text-indigo-500" /> À l'unité
          </div>
          <p className="mt-3 text-xs text-slate-600">{RAPPORT_FAISABILITE_PARCELLE.libelle}</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{formatEurHT(RAPPORT_FAISABILITE_PARCELLE.prixHT)}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Coins className="h-4 w-4 text-amber-500" /> Packs de jetons
          </div>
          <ul className="mt-3 space-y-1 text-xs text-slate-600">
            {PACKS_JETONS.map((p) => (
              <li key={p.code} className="flex justify-between gap-2">
                <span>{p.jetons.toLocaleString("fr-FR")} jetons</span>
                <strong className="text-slate-900">{formatEurHT(p.prixHT)}</strong>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <KeyRound className="h-4 w-4 text-emerald-500" /> API
          </div>
          <ul className="mt-3 space-y-1 text-xs text-slate-600">
            {PACKS_API.map((p) => (
              <li key={p.code} className="flex justify-between gap-2">
                <span>{p.credits.toLocaleString("fr-FR")} crédits</span>
                <strong className="text-slate-900">{formatEurHT(p.prixHT)}</strong>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Box className="h-4 w-4 text-violet-500" /> {STUDIO_3D.libelle}
          </div>
          <p className="mt-3 text-xs text-slate-600">
            À partir de <strong className="text-slate-900">{formatEurHT(STUDIO_3D.prixMensuelDesHT)}/mois</strong>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            −{STUDIO_3D.remisePct} % pour les abonnés Pro et Équipe
          </p>
        </div>
      </div>

      <p className="mt-6 text-[11px] leading-4 text-slate-400">
        Prix hors taxes. Les actions IA consomment des jetons (1 jeton = 0,10 € HT) ; chaque formule payante
        inclut une réserve mensuelle.{" "}
        {!PAIEMENT_EN_LIGNE_DISPONIBLE && `${MESSAGE_PAIEMENT_INDISPONIBLE}.`}
      </p>
    </div>
  );
}

export default GrilleTarifaire;
