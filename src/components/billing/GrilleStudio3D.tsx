// src/components/billing/GrilleStudio3D.tsx
//
// Tarifs de MimmozIA Studio 3D (source unique : STUDIO_3D dans
// src/lib/billing/grille.ts). Le Studio est vendu en service accompagné :
// aucune souscription en libre-service, chaque bouton ouvre une demande par
// e-mail (mailtoDemandeStudio).

import { Box, CheckCircle2, Film, Image as ImageIcon, Mail, Sparkles } from "lucide-react";

import { STUDIO_3D, formatEurHT, mailtoDemandeStudio, type OffreStudio } from "@/lib/billing/grille";

function prixAbonnement(o: OffreStudio): string {
  return `${o.aPartirDe ? "à partir de " : ""}${formatEurHT(o.prixHT)}/mois`;
}

export function GrilleStudio3D() {
  const pack = STUDIO_3D.aLActe.find((o) => o.code === "pack_lancement");
  const pilote = STUDIO_3D.offrePilote;

  return (
    <section id="studio-3d" aria-labelledby="studio-3d-titre" className="mt-12 scroll-mt-24">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-violet-600">
            <Box className="h-4 w-4" aria-hidden="true" /> {STUDIO_3D.libelle}
          </p>
          <h2 id="studio-3d-titre" className="mt-1 text-2xl font-bold text-slate-900">
            {STUDIO_3D.accroche}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Service accompagné : nous réalisons et contrôlons chaque rendu à partir de votre programme.
            Livraison en quelques jours, sans perspectiviste.
          </p>
        </div>
      </div>

      {/* Offre pilote */}
      {pack && (
        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-slate-900">
                {pilote.libelle} — {pilote.nbClients} premiers clients : −{pilote.remisePct} % sur le {pack.libelle.toLowerCase()}
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                {pack.detail}.{" "}
                <span className="text-slate-400 line-through">{formatEurHT(pack.prixHT)}</span>{" "}
                <strong className="text-violet-700">{formatEurHT(pilote.prixHT)}</strong>
              </p>
            </div>
          </div>
          <a
            href={mailtoDemandeStudio(`${pilote.libelle} — ${pack.libelle}`)}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-500"
          >
            <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Devenir client pilote
          </a>
        </div>
      )}

      {/* Abonnements */}
      <h3 className="mt-8 text-sm font-semibold text-slate-900">
        Abonnements promoteurs{" "}
        <span className="font-normal text-slate-500">
          — engagement {STUDIO_3D.engagementMois} mois, −{STUDIO_3D.remiseAnnuellePct} % en paiement annuel d'avance
        </span>
      </h3>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
        {STUDIO_3D.abonnements.map((o, i) => (
          <div
            key={o.code}
            className={[
              "flex flex-col rounded-2xl border p-5",
              i === 1 ? "border-violet-300 bg-violet-50/40 shadow-md" : "border-slate-200 bg-white",
            ].join(" ")}
          >
            <p className="text-lg font-bold text-slate-900">Studio {o.libelle}</p>
            <p className="mt-2 text-2xl font-bold text-violet-600">{prixAbonnement(o)}</p>
            <ul className="mt-4 flex-1 space-y-1.5">
              {(o.inclus ?? []).map((point) => (
                <li key={point} className="flex items-start gap-1.5 text-xs text-slate-600">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
            <a
              href={mailtoDemandeStudio(`Abonnement Studio ${o.libelle}`)}
              className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-500"
            >
              <Mail className="h-3.5 w-3.5" aria-hidden="true" /> {o.aPartirDe ? "Demander un devis" : "Nous contacter"}
            </a>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        −{STUDIO_3D.remisePct} % pour les abonnés Mimmoza Pro. Remises non cumulables entre elles.
      </p>

      {/* À l'acte + dépassements */}
      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ImageIcon className="h-4 w-4 text-violet-500" aria-hidden="true" /> À l'acte, par programme
          </div>
          <ul className="mt-3 divide-y divide-slate-100">
            {STUDIO_3D.aLActe.map((o) => (
              <li key={o.code} className="flex items-start justify-between gap-3 py-2">
                <span>
                  <span className="block text-xs font-semibold text-slate-800">{o.libelle}</span>
                  {o.detail && <span className="block text-[11px] text-slate-500">{o.detail}</span>}
                </span>
                <strong className="shrink-0 text-sm text-slate-900">{formatEurHT(o.prixHT)}</strong>
              </li>
            ))}
          </ul>
          <a
            href={mailtoDemandeStudio("Commande à l'acte")}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700 hover:underline"
          >
            <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Demander un devis
          </a>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Film className="h-4 w-4 text-violet-500" aria-hidden="true" /> Au-delà des quantités incluses
          </div>
          <ul className="mt-3 divide-y divide-slate-100">
            {STUDIO_3D.depassements.map((o) => (
              <li key={o.code} className="flex items-center justify-between gap-3 py-2">
                <span className="text-xs text-slate-700">{o.libelle}</span>
                <strong className="shrink-0 text-sm text-slate-900">{formatEurHT(o.prixHT)}</strong>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-4 text-slate-500">
            Jamais d'illimité : chaque formule a des quantités définies. Un rendu qui dépasse deux fois sa durée
            estimée est arrêté et n'est pas facturé.
          </p>
        </div>
      </div>
    </section>
  );
}

export default GrilleStudio3D;
