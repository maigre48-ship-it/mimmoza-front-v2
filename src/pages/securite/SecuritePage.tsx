// src/pages/securite/SecuritePage.tsx
//
// Page PUBLIQUE « Sécurité et données » (/securite) — indexable (cf.
// RobotsPolicy) : aucune donnée DVF, aucun prix.
//
// Chaque affirmation a été VÉRIFIÉE le 22/10/2026 dans le code et la base :
//   · sources : appels réels des fonctions supabase/functions (cadastre,
//     gpu-parcelle, georisques, dvf-comparables, loyers-reference,
//     taxes-locales, assainissement-commune, dpe-ademe, batiment-bdnb,
//     patrimoine-merimee, sitadel-commune, API Adresse, API Géo, INSEE) ;
//   · base : projet Supabase « Backend Mimmoza », région eu-north-1 (Stockholm) ;
//   · RLS active sur toutes les tables du schéma public sauf spatial_ref_sys
//     (table de référence PostGIS, sans donnée utilisateur) ;
//   · durcissement des fonctions SECURITY DEFINER appliqué le 22/10/2026
//     (migrations 20261022_durcissement_fonctions_1/2/3) ;
//   · IA : Anthropic (Mimmo, rapports) et OpenAI (plans, documents
//     d'urbanisme, rendus d'images), cf. politique de confidentialité art. 5 et 7 ;
//   · aucune mesure d'audience (index.html, BandeauCookies.tsx) ;
//   · suppression : ComptePage → Edge Function delete-account-v1 (supprime les
//     données du compte puis l'utilisateur d'authentification).
//
// Formulations imposées (arbitrage du 21/10/2026, cf. ConnexionPage.tsx) :
// données publiques « officielles », jamais « certifiées » ; hébergement NON
// exclusivement européen → ni « conforme RGPD » ni « hébergé en Europe ».

import {
  Ban,
  Database,
  KeyRound,
  Lock,
  Mail,
  Scale,
  Server,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Link } from "react-router-dom";

import { CONTACT_ACCES } from "@/lib/billing/grille";

interface Source {
  nom: string;
  producteur: string;
  usage: string;
}

/** Sources publiques réellement interrogées par Mimmoza (vérifié dans supabase/functions). */
export const SOURCES_VERIFIEES: readonly Source[] = [
  { nom: "Cadastre", producteur: "DGFiP, diffusé par l'IGN", usage: "Parcelles, contenances, références cadastrales" },
  { nom: "Géoportail de l'urbanisme", producteur: "IGN", usage: "Zonage du PLU, règlement, servitudes d'utilité publique" },
  { nom: "Géorisques", producteur: "Ministère de la Transition écologique, BRGM", usage: "Risques naturels et technologiques" },
  { nom: "Demandes de valeurs foncières (DVF)", producteur: "DGFiP", usage: "Ventes immobilières passées" },
  { nom: "Carte des loyers", producteur: "ANIL, ministère du Logement", usage: "Loyers de référence" },
  { nom: "Fiscalité locale", producteur: "DGFiP", usage: "Taux de taxe foncière" },
  { nom: "SISPEA", producteur: "Observatoire des services d'eau et d'assainissement", usage: "Assainissement collectif ou non" },
  { nom: "DPE", producteur: "ADEME", usage: "Diagnostics de performance énergétique" },
  { nom: "BDNB", producteur: "CSTB", usage: "Caractéristiques des bâtiments" },
  { nom: "Mérimée", producteur: "Ministère de la Culture", usage: "Monuments historiques" },
  { nom: "Sitadel", producteur: "Ministère de la Transition écologique (SDES)", usage: "Logements et locaux autorisés par commune" },
  { nom: "INSEE", producteur: "INSEE", usage: "Données communales et démographiques" },
  { nom: "Base adresse nationale et API Géo", producteur: "IGN, Etalab", usage: "Géocodage des adresses, communes" },
];

// ── Mise en forme ───────────────────────────────────────────────────────────

function Bloc({
  id,
  icone,
  titre,
  children,
}: {
  id: string;
  icone: ReactNode;
  titre: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="scroll-mt-40 border-t border-slate-200 py-8 first:border-t-0 first:pt-0">
      <h2 id={`${id}-titre`} className="flex items-center gap-3 text-xl font-semibold text-slate-950">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600" aria-hidden="true">
          {icone}
        </span>
        {titre}
      </h2>
      <div className="mt-4 space-y-3 text-[15px] leading-7 text-slate-600">{children}</div>
    </section>
  );
}

const Puces = ({ children }: { children: ReactNode }) => (
  <ul className="list-disc space-y-1.5 pl-5 marker:text-violet-400">{children}</ul>
);

const lienCls =
  "font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:decoration-violet-600";

const SOMMAIRE: { id: string; titre: string }[] = [
  { id: "sources", titre: "D'où viennent les données" },
  { id: "hebergement", titre: "Où sont vos données" },
  { id: "acces", titre: "Qui y a accès" },
  { id: "authentification", titre: "Connexion et mots de passe" },
  { id: "engagements", titre: "Ce que Mimmoza ne fait pas" },
  { id: "suppression", titre: "Supprimer votre compte" },
  { id: "limites", titre: "Limites des résultats" },
  { id: "contact", titre: "Une question ?" },
];

export default function SecuritePage() {
  useEffect(() => {
    const precedent = document.title;
    document.title = "Sécurité et données — Mimmoza";
    return () => { document.title = precedent; };
  }, []);

  return (
    <div className="bg-slate-50">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:py-14">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm">
            <ShieldCheck className="h-3.5 w-3.5 text-violet-500" aria-hidden="true" />
            Sécurité et données
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Vos données, ce que nous en faisons
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-500">
            D'où viennent les informations affichées par Mimmoza, où sont conservées vos données, qui peut y accéder
            et comment les supprimer. Sans jargon, et sans promesse que nous ne pourrions pas tenir.
          </p>

          <dl className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              { t: "Données publiques officielles", d: "Cadastre, PLU, risques, ventes passées : chaque information est sourcée." },
              { t: "Base de données dans l'Union européenne", d: "Comptes et projets : Supabase, région de Stockholm (Suède)." },
              { t: "Ni publicité ni revente", d: "Aucune mesure d'audience, aucun cookie publicitaire." },
            ].map((c) => (
              <div key={c.t} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <dt className="text-sm font-semibold text-slate-900">{c.t}</dt>
                <dd className="mt-1 text-sm leading-6 text-slate-500">{c.d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[13rem_1fr]">
        <nav aria-label="Sommaire" className="hidden lg:block">
          <ul className="sticky top-40 space-y-1 text-sm">
            {SOMMAIRE.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block rounded-lg px-3 py-1.5 text-slate-600 transition hover:bg-white hover:text-slate-950">
                  {s.titre}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <Bloc id="sources" icone={<Database className="h-[18px] w-[18px]" />} titre="D'où viennent les données">
            <p>
              Les informations sur les biens, les parcelles et les communes proviennent de bases publiques officielles,
              interrogées au moment de votre demande ou mises à jour régulièrement. Chaque résultat indique sa source.
            </p>
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                    <th scope="col" className="px-1 py-2 font-semibold">Source</th>
                    <th scope="col" className="px-1 py-2 font-semibold">Producteur</th>
                    <th scope="col" className="px-1 py-2 font-semibold">Utilisée pour</th>
                  </tr>
                </thead>
                <tbody>
                  {SOURCES_VERIFIEES.map((s) => (
                    <tr key={s.nom} className="border-b border-slate-100 last:border-0 align-top">
                      <th scope="row" className="px-1 py-2 font-medium text-slate-900">{s.nom}</th>
                      <td className="px-1 py-2 text-slate-500">{s.producteur}</td>
                      <td className="px-1 py-2 text-slate-600">{s.usage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Les données DVF sont réutilisées dans le respect de leur licence : elles ne sont affichées qu'aux
              utilisateurs connectés et ne sont pas indexées par les moteurs de recherche.
            </p>
          </Bloc>

          <Bloc id="hebergement" icone={<Server className="h-[18px] w-[18px]" />} titre="Où sont vos données">
            <Puces>
              <li>
                <strong>Base de données</strong> (compte, projets, conversations avec Mimmo, historique) : hébergée par
                Supabase dans l'Union européenne, région de Stockholm (Suède).
              </li>
              <li>
                <strong>Application web</strong> : diffusée par Vercel, société américaine, via son réseau de serveurs.
              </li>
              <li>
                <strong>Intelligence artificielle</strong> : lorsque vous interrogez Mimmo, votre question et le contexte
                nécessaire à la réponse (données du dossier, résultats des sources consultées) sont envoyés au modèle
                d'Anthropic (États-Unis). L'analyse de plans, la lecture de documents d'urbanisme et la génération
                d'images font appel aux modèles d'OpenAI (États-Unis). Aucune donnée de paiement ne leur est transmise.
              </li>
            </Puces>
            <p>
              Ces transferts hors de l'Union européenne sont encadrés par les clauses contractuelles types de la
              Commission européenne. Le détail figure dans la{" "}
              <Link to="/politique-confidentialite#art7" className={lienCls}>politique de confidentialité</Link>.
            </p>
          </Bloc>

          <Bloc id="acces" icone={<Users className="h-[18px] w-[18px]" />} titre="Qui y a accès">
            <Puces>
              <li>
                <strong>Vous</strong> : vos projets et vos conversations ne sont visibles que depuis votre compte.
                Les tables de la base qui contiennent vos données sont protégées par des règles d'accès par compte (sécurité au niveau des
                lignes) : un utilisateur ne peut pas lire les données d'un autre.
              </li>
              <li>
                <strong>L'équipe Mimmoza</strong> : les administrateurs peuvent consulter un compte pour le support, la
                facturation et la sécurité du service.
              </li>
              <li>
                <strong>Nos prestataires techniques</strong> (hébergement, intelligence artificielle) : uniquement pour
                exécuter le service, dans les conditions décrites ci-dessus.
              </li>
            </Puces>
            <p>
              Les opérations sensibles (jetons, quotas, droits d'accès) sont contrôlées côté serveur, jamais par le seul
              navigateur. Ces contrôles ont été renforcés le 22 octobre 2026.
            </p>
          </Bloc>

          <Bloc id="authentification" icone={<KeyRound className="h-[18px] w-[18px]" />} titre="Connexion et mots de passe">
            <Puces>
              <li>L'authentification est assurée par Supabase Auth.</li>
              <li>Votre mot de passe n'est jamais stocké en clair : seule une empreinte non réversible (hachage) est conservée.</li>
              <li>Les échanges entre votre navigateur et nos serveurs sont chiffrés (HTTPS).</li>
              <li>
                Votre session est gardée dans votre navigateur par un stockage technique, indispensable pour rester
                connecté.
              </li>
            </Puces>
          </Bloc>

          <Bloc id="engagements" icone={<Ban className="h-[18px] w-[18px]" />} titre="Ce que Mimmoza ne fait pas">
            <Puces>
              <li>Mimmoza ne vend pas, ne loue pas et ne cède pas vos données.</li>
              <li>Aucune publicité, aucun cookie publicitaire.</li>
              <li>
                Aucun outil de mesure d'audience : seuls des stockages techniques (connexion, préférences, travaux en
                cours) sont utilisés.
              </li>
            </Puces>
          </Bloc>

          <Bloc id="suppression" icone={<Trash2 className="h-[18px] w-[18px]" />} titre="Supprimer votre compte">
            <p>Vous pouvez supprimer votre compte vous-même, à tout moment :</p>
            <ol className="list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-violet-500">
              <li>
                ouvrez <Link to="/compte" className={lienCls}>Mon compte</Link>, onglet <strong>Profil</strong> ;
              </li>
              <li>dépliez « Paramètres avancés du compte » ;</li>
              <li>tapez SUPPRIMER dans le champ de confirmation, puis cliquez sur « Supprimer mon compte ».</li>
            </ol>
            <p>
              Votre compte et les données qui lui sont rattachées (projets, analyses, conversations, jetons) sont alors
              supprimés. L'opération est irréversible. Les éléments que la loi impose de conserver, comme les factures,
              peuvent l'être pendant la durée légale.
            </p>
            <p>
              Pour exercer vos autres droits (accès, rectification, opposition…), consultez la{" "}
              <Link to="/politique-confidentialite#art6" className={lienCls}>politique de confidentialité</Link> ou
              écrivez-nous.
            </p>
          </Bloc>

          <Bloc id="limites" icone={<Scale className="h-[18px] w-[18px]" />} titre="Limites des résultats">
            <p>
              Les bases publiques ont leurs propres délais de mise à jour et leurs lacunes : DVF ne couvre ni
              l'Alsace-Moselle ni Mayotte, un PLU peut avoir été modifié récemment, une commune peut ne pas figurer
              dans la carte des loyers. Mimmo peut aussi se tromper en interprétant un document.
            </p>
            <p>
              Les résultats de Mimmoza sont donc <strong>indicatifs</strong>. Ils préparent votre décision mais ne
              remplacent pas l'avis d'un notaire, d'un géomètre, d'un architecte ou du service urbanisme de la commune.
              Faites valider les points engageants par un professionnel.
            </p>
          </Bloc>

          <Bloc id="contact" icone={<Lock className="h-[18px] w-[18px]" />} titre="Une question ?">
            <p>
              Pour toute question sur vos données ou la sécurité du service, écrivez-nous. Voir aussi les{" "}
              <Link to="/mentions-legales" className={lienCls}>mentions légales</Link> et le{" "}
              <Link to="/aide" className={lienCls}>centre d'aide</Link>.
            </p>
            <a
              href={`mailto:${CONTACT_ACCES}?subject=${encodeURIComponent("Question sur mes données")}`}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <Mail className="h-4 w-4" aria-hidden="true" /> {CONTACT_ACCES}
            </a>
          </Bloc>
        </article>
      </div>
    </div>
  );
}
