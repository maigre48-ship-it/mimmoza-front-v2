// src/pages/aide/contenuFaq.tsx
// =============================================================================
// Contenu du centre d'aide (/aide).
//
// Règle : AUCUN chiffre en dur. Prix, quotas et jetons viennent de
// src/lib/billing/grille.ts (source de vérité unique) ; le coût d'une analyse
// rapide au-delà du quota vient de ACTION_COSTS (montant débité par le serveur).
// Chaque réponse décrit le fonctionnement RÉEL de l'application (vérifié dans
// le code le 22/10/2026) — à relire si un parcours change.
// =============================================================================

import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { ACTION_COSTS } from "@/lib/billing/actionCosts";
import {
  ANALYSES_RAPIDES_INCLUSES_PAR_FORMULE,
  CONTACT_ACCES,
  FORMULES,
  JETON_VALEUR_EUR,
  MESSAGES_MIMMO_DECOUVERTE_MOIS,
  NOM_FORMULE,
  NOM_MODULE,
  PACKS_JETONS,
  PAIEMENT_EN_LIGNE_DISPONIBLE,
  STUDIO_3D,
  formatEurHT,
  mailtoDemandeAcces,
  mailtoDemandeStudio,
} from "@/lib/billing/grille";

/**
 * Délai de réponse affiché au support.
 * ⚠️ ENGAGEMENT À FAIRE VALIDER PAR LE FONDATEUR avant mise en ligne publique.
 * Formulé comme un objectif (« nous visons »), pas comme une garantie.
 */
export const DELAI_REPONSE_VISE = "2 jours ouvrés";

export interface QuestionFaq {
  id: string;
  question: string;
  /** Mots supplémentaires pour la recherche (synonymes, fautes courantes). */
  motsCles?: string;
  reponse: ReactNode;
}

export interface RubriqueFaq {
  id: string;
  titre: string;
  questions: QuestionFaq[];
}

// ── Petits composants de mise en forme ──────────────────────────────────────

const P = ({ children }: { children: ReactNode }) => (
  <p className="mb-3 last:mb-0">{children}</p>
);

const Liste = ({ children }: { children: ReactNode }) => (
  <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0 marker:text-violet-400">{children}</ul>
);

const Lien = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:decoration-violet-600">
    {children}
  </Link>
);

const Mail = ({ href, children }: { href?: string; children?: ReactNode }) => (
  <a
    href={href ?? `mailto:${CONTACT_ACCES}`}
    className="font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:decoration-violet-600"
  >
    {children ?? CONTACT_ACCES}
  </a>
);

// ── Valeurs dérivées de la grille ───────────────────────────────────────────

const nb = (n: number) => n.toLocaleString("fr-FR");
const valeurJeton = formatEurHT(JETON_VALEUR_EUR, true);
const coutAnalyseHorsQuota = ACTION_COSTS.analyse_rapide;
const studioImage = STUDIO_3D.aLActe.find((o) => o.code === "image_4k");
const studioPackLancement = STUDIO_3D.aLActe.find((o) => o.code === "pack_lancement");
const formulesPayantes = FORMULES.filter((f) => f.prixMensuelHT > 0);

function libelleModules(m: (typeof FORMULES)[number]["modules"]): string {
  if (m === "aucun") return "aucun module métier";
  if (m === "un_au_choix") return "1 module métier au choix";
  return "les 3 modules métier";
}

// ── Rubriques ────────────────────────────────────────────────────────────────

export const RUBRIQUES_FAQ: RubriqueFaq[] = [
  {
    id: "demarrer",
    titre: "Démarrer",
    questions: [
      {
        id: "creer-compte",
        question: "Comment créer un compte ?",
        motsCles: "inscription inscrire ouvrir compte gratuit mot de passe",
        reponse: (
          <>
            <P>
              Rendez-vous sur la page <Lien to="/inscription">Créer un compte</Lien>, saisissez votre adresse e-mail
              et choisissez un mot de passe. Si une confirmation est demandée, un lien vous est envoyé par e-mail :
              cliquez dessus, puis connectez-vous.
            </P>
            <P>
              Votre compte démarre sur la formule <strong>{NOM_FORMULE.basique}</strong>, gratuite et sans
              engagement : {nb(ANALYSES_RAPIDES_INCLUSES_PAR_FORMULE.basique)} analyses rapides et{" "}
              {nb(MESSAGES_MIMMO_DECOUVERTE_MOIS)} messages à Mimmo chaque mois.
            </P>
          </>
        ),
      },
      {
        id: "premiere-analyse",
        question: "Comment lancer ma première analyse ?",
        motsCles: "commencer premier adresse bien parcelle début",
        reponse: (
          <>
            <P>Deux possibilités, une fois connecté :</P>
            <Liste>
              <li>
                <strong>Analyse rapide</strong> (menu « Analyse rapide ») : saisissez l'adresse et la surface du bien,
                éventuellement le prix demandé, puis lancez l'analyse.
              </li>
              <li>
                <strong>Mimmo</strong> (page d'accueil) : posez votre question en langage courant, par exemple « Que
                puis-je construire au 12 rue … ? ». Mimmo interroge les sources publiques et vous répond en citant
                ses sources.
              </li>
            </Liste>
          </>
        ),
      },
      {
        id: "mot-de-passe-oublie",
        question: "J'ai oublié mon mot de passe",
        motsCles: "réinitialiser mot de passe perdu connexion impossible",
        reponse: (
          <P>
            Sur la page de <Lien to="/connexion">connexion</Lien>, cliquez sur « Mot de passe oublié ? » : un lien de
            réinitialisation vous est envoyé par e-mail. Si vous ne recevez pas l'e-mail (pensez aux indésirables), écrivez-nous à <Mail />.
          </P>
        ),
      },
    ],
  },
  {
    id: "analyse-rapide",
    titre: "Analyse rapide",
    questions: [
      {
        id: "ce-que-verifie",
        question: "Que vérifie l'analyse rapide ?",
        motsCles: "contenu rapport dvf risques plu cadastre score estimation prix",
        reponse: (
          <>
            <P>À partir d'une adresse et d'une surface, l'analyse rapide rassemble :</P>
            <Liste>
              <li>les ventes comparables du secteur (base DVF de la DGFiP) et une estimation du prix au m² ;</li>
              <li>un score d'emplacement : transports, commerces, écoles, marché local ;</li>
              <li>les risques naturels et technologiques (Géorisques) ;</li>
              <li>le zonage du PLU et la référence cadastrale, lorsqu'ils sont disponibles ;</li>
              <li>si vous indiquez un prix demandé, l'écart entre ce prix et l'estimation.</li>
            </Liste>
            <P>Le résultat s'exporte en PDF.</P>
          </>
        ),
      },
      {
        id: "quota-analyses",
        question: "Combien d'analyses rapides puis-je faire ?",
        motsCles: "quota limite nombre mois mensuel gratuit jetons",
        reponse: (
          <>
            <P>Chaque formule inclut un nombre d'analyses rapides par mois :</P>
            <Liste>
              {FORMULES.map((f) => (
                <li key={f.id}>
                  <strong>{f.nom}</strong> : {nb(ANALYSES_RAPIDES_INCLUSES_PAR_FORMULE[f.id])} analyses par mois
                </li>
              ))}
            </Liste>
            <P>
              Au-delà, une analyse rapide coûte {nb(coutAnalyseHorsQuota)} jetons, soit{" "}
              {formatEurHT(coutAnalyseHorsQuota * JETON_VALEUR_EUR, true)}. Si l'analyse échoue de notre côté,
              l'analyse ou les jetons sont rendus.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: "mimmo",
    titre: "Mimmo, votre copilote",
    questions: [
      {
        id: "qui-est-mimmo",
        question: "Qui est Mimmo ?",
        motsCles: "copilote assistant ia intelligence artificielle chat conversation",
        reponse: (
          <>
            <P>
              Mimmo est le copilote de Mimmoza. Il interroge pour vous les sources publiques (cadastre, PLU,
              risques, ventes passées, loyers de référence, fiscalité locale…), explique ce qu'il trouve et répond à
              vos questions sur un dossier. Quand une donnée manque, il doit le dire plutôt que l'inventer.
            </P>
            <P>
              Mimmo s'appuie sur des modèles d'intelligence artificielle : votre question et le contexte nécessaire à
              la réponse leur sont transmis. Voir <Lien to="/securite">Sécurité et données</Lien>.
            </P>
          </>
        ),
      },
      {
        id: "niveaux-mimmo",
        question: "Quelle différence entre les niveaux Standard et Approfondi ?",
        motsCles: "niveau expert standard approfondi modèle qualité réponse",
        reponse: (
          <>
            <Liste>
              <li>
                <strong>Standard</strong> : réponses rapides, vérifications et recherches simples. C'est le niveau de
                la formule {NOM_FORMULE.basique}.
              </li>
              <li>
                <strong>Approfondi</strong> : croise davantage de sources (comparables DVF, risques, DPE, score de
                marché) et développe l'analyse. Inclus à partir de la formule {NOM_FORMULE.avance}.
              </li>
              <li>
                <strong>Expert</strong> : pour les arbitrages complexes, en formule {NOM_FORMULE.pro}.
              </li>
            </Liste>
            <P>Plus le niveau est élevé, plus une réponse consomme de jetons.</P>
          </>
        ),
      },
      {
        id: "mimmo-jetons",
        question: "Combien coûte un message à Mimmo ?",
        motsCles: "prix message jetons consommation débit gratuit",
        reponse: (
          <>
            <P>
              En formule <strong>{NOM_FORMULE.basique}</strong>, {nb(MESSAGES_MIMMO_DECOUVERTE_MOIS)} messages sont
              offerts chaque mois. Au-delà, les messages sont débités sur vos jetons, si votre compte en a.
            </P>
            <P>
              Dans les formules payantes, chaque réponse est débitée en jetons selon le travail réellement effectué
              (longueur de la réponse, sources consultées, niveau choisi). Votre solde de jetons s'affiche en haut de
              l'écran.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: "exports",
    titre: "Exports",
    questions: [
      {
        id: "formats-export",
        question: "Dans quels formats puis-je exporter ?",
        motsCles: "export télécharger pdf word excel powerpoint docx xlsx pptx imprimer",
        reponse: (
          <>
            <Liste>
              <li>
                <strong>Réponses de Mimmo</strong> : sous chaque réponse, les boutons PDF, Word, Excel et PowerPoint
                téléchargent la réponse dans le format choisi.
              </li>
              <li>
                <strong>Analyse rapide</strong> : export PDF, inclus dans toutes les formules.
              </li>
              <li>
                <strong>Modules métier</strong> : certains écrans (bilan promoteur, plannings, recherches de
                contacts…) proposent en plus un export Excel.
              </li>
            </Liste>
            <P>
              Si le PDF ne s'ouvre pas, autorisez les fenêtres contextuelles pour Mimmoza dans votre navigateur.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: "modules",
    titre: "Modules métier",
    questions: [
      {
        id: "modules-par-formule",
        question: "Quels modules sont inclus dans ma formule ?",
        motsCles: "promotion promoteur marchand de biens réhabilitation module espace métier accès",
        reponse: (
          <>
            <P>
              Mimmoza propose trois modules métier : {NOM_MODULE.promoteur}, {NOM_MODULE.marchand} et{" "}
              {NOM_MODULE.rehabilitation}.
            </P>
            <Liste>
              {FORMULES.map((f) => (
                <li key={f.id}>
                  <strong>{f.nom}</strong> : {libelleModules(f.modules)}
                </li>
              ))}
            </Liste>
            <P>
              Mimmo, l'analyse rapide et l'apport d'affaires restent accessibles quelle que soit la formule. Le détail
              figure sur la page <Lien to="/tarifs">Tarifs</Lien>.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: "studio",
    titre: "MimmozIA Studio 3D",
    questions: [
      {
        id: "studio-3d",
        question: "Comment fonctionne MimmozIA Studio 3D ?",
        motsCles: "3d maquette image film visite virtuelle rendu studio perspective",
        reponse: (
          <>
            <P>
              {STUDIO_3D.libelle} produit la maquette 3D, les images, le film et la visite virtuelle de vos
              programmes. C'est aujourd'hui un <strong>service accompagné</strong> : les rendus sont réalisés et
              contrôlés par Mimmoza, sur demande.
            </P>
            <Liste>
              <li>Abonnements à partir de {formatEurHT(STUDIO_3D.prixMensuelDesHT)} par mois (engagement de {STUDIO_3D.engagementMois} mois).</li>
              {studioImage && <li>À l'acte : {studioImage.libelle} à {formatEurHT(studioImage.prixHT)}.</li>}
              {studioPackLancement && (
                <li>
                  {studioPackLancement.libelle} : {formatEurHT(studioPackLancement.prixHT)} ({studioPackLancement.detail}).
                </li>
              )}
            </Liste>
            <P>
              Grille complète sur la page <Lien to="/tarifs">Tarifs</Lien>. Pour un devis ou une démonstration :{" "}
              <Mail href={mailtoDemandeStudio("Devis")}>écrire à l'équipe Studio</Mail>.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: "jetons-formules",
    titre: "Jetons et formules",
    questions: [
      {
        id: "jeton",
        question: "Qu'est-ce qu'un jeton ?",
        motsCles: "jeton crédit valeur prix solde recharge pack",
        reponse: (
          <>
            <P>
              Le jeton est l'unité de consommation de Mimmoza : <strong>1 jeton = {valeurJeton}</strong>. Il sert aux
              messages à Mimmo, aux analyses rapides au-delà du quota et à certaines fonctions d'intelligence
              artificielle (rendus de façade, lecture de plans…).
            </P>
            <P>
              Les formules payantes incluent des jetons chaque mois :{" "}
              {formulesPayantes.map((f, i) => (
                <span key={f.id}>
                  {i > 0 && (i === formulesPayantes.length - 1 ? " et " : ", ")}
                  {nb(f.jetonsMensuels)} en {f.nom}
                </span>
              ))}
              . Des packs sont aussi proposés (
              {PACKS_JETONS.map((p, i) => (
                <span key={p.code}>
                  {i > 0 && ", "}
                  {nb(p.jetons)} jetons pour {formatEurHT(p.prixHT)}
                </span>
              ))}
              ).
            </P>
          </>
        ),
      },
      {
        id: "changer-formule",
        question: "Comment changer de formule ou acheter des jetons ?",
        motsCles: "abonnement souscrire payer paiement upgrade passer pro carte bancaire",
        reponse: PAIEMENT_EN_LIGNE_DISPONIBLE ? (
          <P>
            Rendez-vous dans <Lien to="/compte?tab=abonnement">Mon compte, onglet Abonnement</Lien> pour changer de
            formule, ou dans l'onglet Jetons pour acheter un pack.
          </P>
        ) : (
          <>
            <P>
              Le paiement en ligne n'est pas encore ouvert. En attendant, l'ouverture d'une formule payante ou l'achat
              d'un pack de jetons se fait <strong>sur simple demande par e-mail</strong> :{" "}
              <Mail href={mailtoDemandeAcces(NOM_FORMULE.pro)}>demander l'ouverture d'un accès</Mail>. Précisez la
              formule souhaitée et l'adresse e-mail de votre compte.
            </P>
            <P>Le paiement en ligne sera proposé prochainement.</P>
          </>
        ),
      },
    ],
  },
  {
    id: "donnees",
    titre: "Données et fiabilité",
    questions: [
      {
        id: "sources",
        question: "D'où viennent les données ?",
        motsCles: "source données publiques officielles dvf cadastre plu géorisques insee fiabilité",
        reponse: (
          <P>
            De bases publiques officielles : cadastre, Géoportail de l'urbanisme, Géorisques, DVF, carte des loyers,
            fiscalité locale, DPE de l'ADEME, BDNB, Mérimée, Sitadel, INSEE, Base adresse nationale… La liste
            détaillée, l'hébergement et la protection de vos données sont décrits sur la page{" "}
            <Lien to="/securite">Sécurité et données</Lien>.
          </P>
        ),
      },
      {
        id: "resultats-faux",
        question: "Mes résultats semblent faux : que faire ?",
        motsCles: "erreur faux incorrect incohérent mauvais résultat bug estimation fausse",
        reponse: (
          <>
            <P>Quelques vérifications d'abord :</P>
            <Liste>
              <li>l'adresse a-t-elle été bien reconnue (commune, code postal, parcelle) ?</li>
              <li>la surface et le type de bien saisis sont-ils corrects ?</li>
              <li>
                la source a-t-elle des limites connues ? DVF n'a pas de données en Alsace-Moselle ni à Mayotte, certaines
                communes ne sont pas couvertes par la carte des loyers, un PLU peut avoir été modifié récemment.
              </li>
            </Liste>
            <P>
              Les résultats de Mimmoza sont <strong>indicatifs</strong> : ils préparent votre décision mais ne
              remplacent pas l'avis d'un notaire, d'un géomètre, d'un architecte ou du service urbanisme de la
              commune. Faites valider les points engageants par un professionnel.
            </P>
            <P>
              Si une erreur persiste, écrivez-nous à <Mail /> en indiquant l'adresse analysée et ce qui vous paraît
              faux : chaque signalement est examiné.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: "contact",
    titre: "Contact",
    questions: [
      {
        id: "contacter",
        question: "Comment contacter Mimmoza ?",
        motsCles: "support aide contact e-mail mail téléphone délai réponse assistance",
        reponse: (
          <>
            <P>
              Par e-mail à <Mail />. Pour aller plus vite, précisez l'adresse e-mail de votre compte et, s'il s'agit
              d'un problème, la page concernée et ce que vous avez fait juste avant.
            </P>
            <P>Nous visons une réponse sous {DELAI_REPONSE_VISE}.</P>
          </>
        ),
      },
      {
        id: "supprimer-compte",
        question: "Comment supprimer mon compte ?",
        motsCles: "supprimer effacer compte données rgpd droit oubli fermer résilier",
        reponse: (
          <P>
            Dans <Lien to="/compte">Mon compte</Lien>, onglet Profil, ouvrez « Paramètres avancés du compte », tapez
            SUPPRIMER puis confirmez. Le détail est sur la page <Lien to="/securite#suppression">Sécurité et données</Lien>.
          </P>
        ),
      },
    ],
  },
];
