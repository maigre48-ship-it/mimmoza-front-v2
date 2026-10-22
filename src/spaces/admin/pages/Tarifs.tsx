// src/spaces/admin/pages/Tarifs.tsx
// ─── Tarifs Mimmoza (administration) ──────────────────────────────────────────
// Audit du 21/10/2026 : l'ancienne page éditait localStorage["mimmoza.pricing"]
// (visible uniquement dans le navigateur de l'administrateur) avec une grille
// contradictoire (packs à 0,04 €/jeton, formules Promoteur/Réhabilitation à
// 149/299 €). La grille vit désormais dans le code, à un seul endroit :
//   src/lib/billing/grille.ts
// Cette page l'affiche en lecture seule, avec le €/jeton et la marge estimée.
// Pour changer un prix : modifier grille.ts, puis déployer.
// ──────────────────────────────────────────────────────────────────────────────

import { BadgeEuro, Coins, Info } from "lucide-react";

import {
  FORMULES,
  JETON_VALEUR_EUR,
  PACKS_API,
  PACKS_JETONS,
  RAPPORT_FAISABILITE_PARCELLE,
  STUDIO_3D,
  formatEurHT,
} from "@/lib/billing/grille";

/**
 * Coût réel moyen d'un jeton côté fournisseur IA. Le débit copilote est
 * calculé au coût réel × MARGIN (pricingPolicy.ts / copilot-chat), donc la
 * marge sur un jeton consommé est structurellement de ×3 ; ce coût sert
 * seulement à estimer la marge d'un jeton VENDU en pack.
 */
const COUT_REEL_PAR_JETON_EUR = JETON_VALEUR_EUR / 3;

function margePct(prixParJeton: number): number {
  return ((prixParJeton - COUT_REEL_PAR_JETON_EUR) / prixParJeton) * 100;
}

function fmt(n: number, dec = 3): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " €";
}

export default function AdminTarifsPage() {
  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm">
          <BadgeEuro className="h-3.5 w-3.5 text-indigo-500" />
          Espace administrateur
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Grille tarifaire</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Lecture seule. Source unique :{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">src/lib/billing/grille.ts</code>
          {" "}— affichée sur <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">/tarifs</code> et{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">/abonnement</code>. 1 jeton ={" "}
          {fmt(JETON_VALEUR_EUR, 2)} HT.
        </p>
      </div>

      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Formules</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4">Formule</th>
                <th className="py-2 pr-4">Mensuel HT</th>
                <th className="py-2 pr-4">Annuel (par mois) HT</th>
                <th className="py-2 pr-4">Utilisateurs</th>
                <th className="py-2 pr-4">Modules</th>
                <th className="py-2 pr-4">Jetons / mois</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {FORMULES.map((f) => (
                <tr key={f.id}>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-500">{f.id}</td>
                  <td className="py-2 pr-4 font-semibold">{f.nom}</td>
                  <td className="py-2 pr-4">{f.prixMensuelHT === 0 ? "Gratuit" : formatEurHT(f.prixMensuelHT)}</td>
                  <td className="py-2 pr-4">{f.prixMensuelAnnuelHT == null ? "—" : formatEurHT(f.prixMensuelAnnuelHT)}</td>
                  <td className="py-2 pr-4">{f.utilisateurs}</td>
                  <td className="py-2 pr-4">
                    {f.modules === "aucun" ? "Aucun" : f.modules === "un_au_choix" ? "1 au choix" : "Les 3"}
                  </td>
                  <td className="py-2 pr-4">{f.jetonsMensuels.toLocaleString("fr-FR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Coins className="h-4 w-4 text-amber-500" /> Packs de jetons
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-2 pr-4">Pack</th>
              <th className="py-2 pr-4">Prix HT</th>
              <th className="py-2 pr-4">€ / jeton</th>
              <th className="py-2 pr-4">Marge estimée</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {PACKS_JETONS.map((p) => {
              const parJeton = p.prixHT / p.jetons;
              return (
                <tr key={p.code}>
                  <td className="py-2 pr-4">{p.jetons.toLocaleString("fr-FR")} jetons</td>
                  <td className="py-2 pr-4">{formatEurHT(p.prixHT)}</td>
                  <td className="py-2 pr-4">{fmt(parJeton)}</td>
                  <td className="py-2 pr-4">{margePct(parJeton).toFixed(0)} %</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm text-sm text-slate-700">
          <h2 className="mb-2 font-semibold text-slate-900">À l'unité</h2>
          {RAPPORT_FAISABILITE_PARCELLE.libelle} : {formatEurHT(RAPPORT_FAISABILITE_PARCELLE.prixHT)}
        </div>
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm text-sm text-slate-700">
          <h2 className="mb-2 font-semibold text-slate-900">API</h2>
          {PACKS_API.map((p) => (
            <div key={p.code}>
              {p.libelle} · {p.credits.toLocaleString("fr-FR")} crédits/mois : {formatEurHT(p.prixHT)}/mois
              {p.prixAnnuelHT != null && <> ({formatEurHT(p.prixAnnuelHT)} en annuel)</>}
              {p.rechargeParMilleHT != null && <> · recharge {formatEurHT(p.rechargeParMilleHT, true)}/1 000</>}
            </div>
          ))}
          <div className="mt-1 text-xs text-slate-500">Source : src/lib/api/catalogueApi.ts</div>
        </div>
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm text-sm text-slate-700">
          <h2 className="mb-2 font-semibold text-slate-900">{STUDIO_3D.libelle}</h2>
          À partir de {formatEurHT(STUDIO_3D.prixMensuelDesHT)}/mois, −{STUDIO_3D.remisePct} % pour Pro et Équipe.
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-xs leading-5 text-amber-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        Paiement en ligne non branché : les formules payantes s'ouvrent manuellement (plan_code et
        subscription_status dans billing_profiles). Les jetons inclus sont crédités par le webhook Stripe
        (PLAN_INCLUDED_TOKENS) une fois le paiement en place.
      </div>
    </div>
  );
}
