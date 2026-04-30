import React, { useState, useEffect, useRef } from "react";

// ─── Composants internes ──────────────────────────────────────────────────────

const Warn: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="my-4 border-l-4 border-red-700 bg-red-50 px-4 py-3 rounded-r-md">
    <p className="text-sm font-semibold text-red-800 leading-relaxed">
      ⚠&nbsp;&nbsp;{children}
    </p>
  </div>
);

const Info: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="my-4 border-l-4 border-[#2E7D9A] bg-sky-50 px-4 py-3 rounded-r-md">
    <p className="text-sm text-[#1A3C5E] leading-relaxed">
      ℹ&nbsp;&nbsp;{children}
    </p>
  </div>
);

const P: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = "",
}) => (
  <p className={`text-sm text-gray-700 leading-relaxed mb-3 text-justify ${className}`}>
    {children}
  </p>
);

const H2: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-sm font-bold text-[#2E7D9A] mt-5 mb-2">{children}</h3>
);

const H3: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mt-4 mb-1.5">
    {children}
  </h4>
);

const UL: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ul className="list-none space-y-1.5 mb-3 ml-2">{children}</ul>
);

const LI: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="flex gap-2 text-sm text-gray-700 leading-relaxed text-justify">
    <span className="text-[#2E7D9A] mt-0.5 flex-shrink-0">–</span>
    <span>{children}</span>
  </li>
);

const OL: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ol className="list-decimal list-inside space-y-1.5 mb-3 ml-2 text-sm text-gray-700">
    {children}
  </ol>
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface Article {
  id: string;
  num: string;
  title: string;
  content: React.ReactNode;
}

// ─── Contenu des articles ─────────────────────────────────────────────────────

const articles: Article[] = [
  // ── ART. 1
  {
    id: "art1",
    num: "Article 1",
    title: "Objet et champ d'application",
    content: (
      <>
        <P>
          Les présentes Conditions Générales d'Utilisation (ci-après « CGU ») définissent les
          règles et modalités d'utilisation de la plateforme en ligne Mimmoza (ci-après la
          « Plateforme »), éditée par la société Mimmoza SAS, société par actions simplifiée au
          capital de [●] euros, immatriculée au Registre du Commerce et des Sociétés de [●] sous
          le numéro [●], dont le siège social est situé [adresse] (ci-après « Mimmoza »).
        </P>
        <P>
          Les présentes CGU s'appliquent à toute personne physique ou morale accédant à la
          Plateforme, à titre gratuit ou payant, qu'elle soit simple visiteur ou titulaire d'un
          compte (ci-après « l'Utilisateur »). Elles complètent, sans s'y substituer, les
          Conditions Générales de Vente (CGV) applicables aux abonnements payants.
        </P>
        <P>
          L'accès à la Plateforme ou à l'une de ses fonctionnalités vaut acceptation pleine,
          entière et sans réserve des présentes CGU. Si l'Utilisateur n'accepte pas ces CGU, il
          doit s'abstenir d'utiliser la Plateforme.
        </P>
        <Info>
          Les CGU sont accessibles à tout moment depuis la Plateforme et peuvent être conservées
          et reproduites par l'Utilisateur. Mimmoza recommande à l'Utilisateur d'en prendre
          connaissance à chaque mise à jour.
        </Info>
      </>
    ),
  },

  // ── ART. 2
  {
    id: "art2",
    num: "Article 2",
    title: "Définitions",
    content: (
      <>
        <P>
          Les termes commençant par une majuscule dans les présentes CGU ont la signification
          suivante :
        </P>
        <UL>
          <LI>
            <strong>« Plateforme »</strong> : le site web, l'application mobile et l'ensemble des
            interfaces logicielles accessibles sous la marque Mimmoza, permettant l'accès aux
            services d'analyse et d'intelligence immobilière.
          </LI>
          <LI>
            <strong>« Service »</strong> : l'ensemble des fonctionnalités proposées via la
            Plateforme, notamment les outils d'analyse immobilière, le SmartScore, les études de
            faisabilité, les rendus visuels et la génération de contenu, tels que décrits dans les
            CGV.
          </LI>
          <LI>
            <strong>« Utilisateur »</strong> : toute personne physique ou morale ayant accès à la
            Plateforme, avec ou sans compte, à titre gratuit ou payant.
          </LI>
          <LI>
            <strong>« Compte »</strong> : l'espace personnel créé par l'Utilisateur sur la
            Plateforme, protégé par des identifiants de connexion personnels.
          </LI>
          <LI>
            <strong>« Contenu Utilisateur »</strong> : toute donnée, information, fichier, texte,
            ou paramètre saisi, importé ou transmis par l'Utilisateur via la Plateforme.
          </LI>
          <LI>
            <strong>« Contenu Mimmoza »</strong> : l'ensemble des contenus produits ou mis à
            disposition par Mimmoza sur la Plateforme, incluant les analyses, scores, rendus,
            textes, interfaces, algorithmes, marques et éléments graphiques.
          </LI>
          <LI>
            <strong>« Contenu Généré par l'IA »</strong> : tout contenu (textuel, visuel, analytique)
            produit automatiquement par des modèles d'intelligence artificielle ou d'apprentissage
            automatique intégrés à la Plateforme, en réponse aux paramètres de l'Utilisateur.
          </LI>
          <LI>
            <strong>« SmartScore »</strong> : l'indicateur synthétique propriétaire de Mimmoza,
            calculé algorithmiquement à partir de données multisources, donnant une appréciation
            relative d'un bien ou d'un projet immobilier à titre purement informatif.
          </LI>
          <LI>
            <strong>« Données Tierces »</strong> : toute donnée provenant de sources externes à
            Mimmoza (DVF, INSEE, PLU, BPE, FINESS, APIs cartographiques, etc.) intégrée ou
            consultable via la Plateforme.
          </LI>
          <LI>
            <strong>« Identifiants »</strong> : l'adresse électronique et le mot de passe choisis
            par l'Utilisateur pour accéder à son Compte.
          </LI>
        </UL>
      </>
    ),
  },

  // ── ART. 3
  {
    id: "art3",
    num: "Article 3",
    title: "Acceptation et modification des CGU",
    content: (
      <>
        <H2>3.1 Acceptation</H2>
        <P>
          L'Utilisateur déclare avoir lu, compris et accepté les présentes CGU dans leur intégralité
          lors de la création de son Compte ou, pour les visiteurs non inscrits, lors de l'accès à
          la Plateforme. Cette acceptation est matérialisée par le clic sur le bouton « J'accepte
          les conditions d'utilisation » ou par tout acte d'utilisation de la Plateforme.
        </P>
        <P>
          Pour les utilisateurs mineurs, la création d'un Compte nécessite l'autorisation préalable
          du titulaire de l'autorité parentale ou du tuteur légal. En créant un Compte, l'Utilisateur
          déclare être majeur ou bénéficier d'une telle autorisation.
        </P>

        <H2>3.2 Modification des CGU</H2>
        <P>
          Mimmoza se réserve le droit de modifier les présentes CGU à tout moment, notamment pour
          tenir compte des évolutions de la Plateforme, des exigences légales ou réglementaires, ou
          de la politique de l'entreprise. Toute modification substantielle sera notifiée à
          l'Utilisateur par voie électronique ou par affichage d'un bandeau d'information sur la
          Plateforme, avec un préavis de trente (30) jours.
        </P>
        <P>
          La poursuite de l'utilisation de la Plateforme après l'entrée en vigueur des nouvelles
          CGU vaut acceptation de celles-ci. En cas de refus, l'Utilisateur peut clôturer son Compte
          conformément à l'article 13.
        </P>

        <H2>3.3 Documents contractuels applicables</H2>
        <P>
          Les présentes CGU doivent être lues conjointement avec la Politique de Confidentialité
          et la Politique de Cookies de Mimmoza, ainsi qu'avec les Conditions Générales de Vente
          pour les Utilisateurs disposant d'un abonnement payant. En cas de contradiction entre ces
          documents, l'ordre de prévalence est le suivant : (1) CGV, (2) CGU, (3) Politique de
          Confidentialité.
        </P>
      </>
    ),
  },

  // ── ART. 4
  {
    id: "art4",
    num: "Article 4",
    title: "Création et gestion du Compte",
    content: (
      <>
        <H2>4.1 Inscription</H2>
        <P>
          Pour accéder à l'ensemble des fonctionnalités de la Plateforme, l'Utilisateur doit créer
          un Compte en renseignant les informations requises lors de l'inscription : adresse
          électronique valide, nom et prénom, et tout autre champ obligatoire indiqué lors du
          processus d'inscription. L'Utilisateur s'engage à fournir des informations exactes,
          complètes et à jour, et à les maintenir actualisées tout au long de la relation
          contractuelle.
        </P>
        <Warn>
          Toute fausse déclaration lors de l'inscription, notamment sur l'identité, la qualité
          professionnelle ou les coordonnées, est susceptible d'entraîner la résiliation immédiate
          du Compte sans préavis ni indemnité, et peut constituer une infraction pénale.
        </Warn>

        <H2>4.2 Identifiants et sécurité</H2>
        <P>
          L'Utilisateur est seul responsable de la confidentialité et de la sécurité de ses
          Identifiants. Il s'engage à :
        </P>
        <UL>
          <LI>
            Choisir un mot de passe robuste, conforme aux recommandations de l'ANSSI (minima : 12
            caractères, majuscules, minuscules, chiffres et caractères spéciaux).
          </LI>
          <LI>Ne pas divulguer ses Identifiants à des tiers, quelle qu'en soit la raison.</LI>
          <LI>Ne pas utiliser les Identifiants d'un autre Utilisateur.</LI>
          <LI>
            Notifier immédiatement Mimmoza de toute utilisation non autorisée de son Compte ou de
            toute violation de sécurité à l'adresse{" "}
            <a href="mailto:security@mimmoza.fr" className="text-[#2E7D9A] underline">
              security@mimmoza.fr
            </a>
            .
          </LI>
        </UL>
        <P>
          Toute opération effectuée depuis le Compte de l'Utilisateur est présumée effectuée par
          celui-ci, sauf preuve contraire. Mimmoza ne saurait être tenue responsable des
          conséquences d'une utilisation non autorisée du Compte résultant d'une négligence de
          l'Utilisateur dans la conservation de ses Identifiants.
        </P>

        <H2>4.3 Unicité du Compte</H2>
        <P>
          Chaque Utilisateur ne peut créer qu'un seul Compte à titre personnel. La création de
          Comptes multiples pour contourner une suspension ou une résiliation, ou pour bénéficier
          indûment d'offres promotionnelles, est strictement interdite et peut entraîner la
          résiliation de l'ensemble des comptes concernés.
        </P>

        <H2>4.4 Comptes professionnels et multi-utilisateurs</H2>
        <P>
          Pour les entreprises ou équipes souhaitant bénéficier d'un accès multi-utilisateurs,
          Mimmoza propose des formules spécifiques. Dans ce cadre, l'administrateur du compte
          d'entreprise est responsable de l'ensemble des utilisateurs qu'il habilite, et garantit
          que chacun d'eux respecte les présentes CGU.
        </P>
      </>
    ),
  },

  // ── ART. 5
  {
    id: "art5",
    num: "Article 5",
    title: "Accès à la Plateforme et disponibilité",
    content: (
      <>
        <H2>5.1 Accès</H2>
        <P>
          L'accès à la Plateforme est assuré via internet, à l'aide d'un navigateur web ou d'une
          application mobile compatible. L'Utilisateur est seul responsable de la fourniture et du
          coût de sa connexion internet et de son équipement informatique. Mimmoza ne garantit pas
          la compatibilité de la Plateforme avec l'intégralité des équipements, systèmes
          d'exploitation ou navigateurs de l'Utilisateur.
        </P>

        <H2>5.2 Disponibilité</H2>
        <P>
          Mimmoza s'efforce de maintenir la Plateforme accessible vingt-quatre heures sur
          vingt-quatre et sept jours sur sept. Toutefois, l'accès peut être interrompu ou limité
          pour les motifs suivants, sans que cela engage la responsabilité de Mimmoza :
        </P>
        <UL>
          <LI>Opérations de maintenance planifiée ou corrective.</LI>
          <LI>
            Défaillances techniques des infrastructures d'hébergement, des réseaux ou des services
            tiers utilisés.
          </LI>
          <LI>
            Événements de force majeure au sens de l'article 1218 du Code civil (voir article 17).
          </LI>
          <LI>Décisions des autorités compétentes imposant une restriction d'accès.</LI>
          <LI>Incidents de sécurité nécessitant une intervention d'urgence.</LI>
        </UL>
        <P>
          En cas d'interruption planifiée, Mimmoza s'efforcera d'en informer les Utilisateurs avec
          un préavis raisonnable, de préférence par voie électronique ou via un bandeau d'alerte
          sur la Plateforme.
        </P>

        <H2>5.3 Évolution de la Plateforme</H2>
        <P>
          Mimmoza se réserve le droit de modifier, enrichir, restreindre ou supprimer à tout moment
          tout ou partie des fonctionnalités de la Plateforme, sans obligation de préavis pour les
          modifications mineures. Pour les modifications substantielles affectant l'usage principal
          de la Plateforme, un préavis sera adressé aux Utilisateurs dans un délai raisonnable.
        </P>
      </>
    ),
  },

  // ── ART. 6
  {
    id: "art6",
    num: "Article 6",
    title: "Règles d'utilisation de la Plateforme",
    content: (
      <>
        <H2>6.1 Usage conforme</H2>
        <P>
          L'Utilisateur s'engage à utiliser la Plateforme de manière loyale, conformément à sa
          destination, aux présentes CGU, aux CGV applicables, et aux lois et réglementations en
          vigueur. L'utilisation de la Plateforme se fait sous l'entière responsabilité de
          l'Utilisateur.
        </P>

        <H2>6.2 Nature de l'outil — aide à la décision</H2>
        <Warn>
          La Plateforme est un outil d'aide à la décision exclusivement. Elle ne fournit ni conseil
          en investissement au sens du Code monétaire et financier, ni conseil juridique, ni
          expertise immobilière agréée, ni conseil en urbanisme. Toute décision prise par
          l'Utilisateur sur le fondement des analyses, scores ou contenus produits par la Plateforme
          l'est sous sa seule et entière responsabilité.
        </Warn>

        <H2>6.3 Comportements proscrits</H2>
        <P>
          Sans préjudice des autres obligations prévues par les présentes CGU, l'Utilisateur
          s'interdit strictement de :
        </P>
        <H3>Atteintes à la sécurité et à l'intégrité</H3>
        <UL>
          <LI>
            Tenter de contourner les systèmes d'authentification ou de sécurité de la Plateforme.
          </LI>
          <LI>
            Introduire des virus, chevaux de Troie, logiciels malveillants, robots ou tout autre
            code nuisible.
          </LI>
          <LI>
            Réaliser des tests d'intrusion, scans de vulnérabilités ou attaques par déni de service
            sans autorisation écrite préalable de Mimmoza.
          </LI>
          <LI>
            Accéder à des zones non autorisées de la Plateforme ou aux données d'autres
            Utilisateurs.
          </LI>
        </UL>
        <H3>Atteintes aux droits et à la propriété intellectuelle</H3>
        <UL>
          <LI>
            Reproduire, extraire, copier, redistribuer ou exploiter commercialement tout ou partie
            du Contenu Mimmoza sans autorisation préalable écrite.
          </LI>
          <LI>
            Décompiler, désassembler, procéder à une ingénierie inverse de la Plateforme ou tenter
            d'en extraire le code source.
          </LI>
          <LI>
            Utiliser des robots, scrapers ou tout outil automatisé pour collecter des données depuis
            la Plateforme sans autorisation.
          </LI>
          <LI>
            Supprimer, modifier ou masquer les mentions de propriété intellectuelle (copyright,
            marques, crédits) présentes sur la Plateforme ou ses contenus.
          </LI>
        </UL>
        <H3>Atteintes aux personnes et usage abusif</H3>
        <UL>
          <LI>
            Usurper l'identité de Mimmoza, d'un autre Utilisateur ou de tout tiers.
          </LI>
          <LI>
            Utiliser la Plateforme pour diffuser des contenus illicites, diffamatoires, injurieux,
            discriminatoires, obscènes ou portant atteinte à la vie privée de tiers.
          </LI>
          <LI>
            Utiliser la Plateforme à des fins de concurrence déloyale ou pour développer un produit
            ou service concurrent.
          </LI>
          <LI>
            Contourner les limitations techniques ou commerciales associées à la formule
            d'abonnement souscrite (ex. : partage de compte non autorisé, création de comptes
            multiples).
          </LI>
          <LI>
            Effectuer des appels excessifs aux APIs de la Plateforme susceptibles de perturber son
            fonctionnement ou de porter atteinte à l'expérience des autres Utilisateurs.
          </LI>
        </UL>

        <H2>6.4 Signalement d'abus</H2>
        <P>
          Tout Utilisateur constatant une utilisation abusive ou illicite de la Plateforme est
          invité à le signaler à Mimmoza à l'adresse{" "}
          <a href="mailto:contact@mimmoza.fr" className="text-[#2E7D9A] underline">
            contact@mimmoza.fr
          </a>
          . Mimmoza s'engage à traiter les signalements dans les meilleurs délais.
        </P>
      </>
    ),
  },

  // ── ART. 7
  {
    id: "art7",
    num: "Article 7",
    title: "Contenu Utilisateur",
    content: (
      <>
        <H2>7.1 Responsabilité de l'Utilisateur</H2>
        <P>
          L'Utilisateur est seul responsable de l'ensemble des Contenus Utilisateur qu'il saisit,
          importe, transmet ou publie via la Plateforme. Il garantit que ces contenus sont
          licites, exacts, et ne portent pas atteinte aux droits de tiers (droits de propriété
          intellectuelle, droit à la vie privée, droits de la personnalité, etc.).
        </P>
        <P>
          L'Utilisateur garantit Mimmoza contre tout recours, réclamation, action ou demande
          d'indemnisation de tiers qui résulterait d'un Contenu Utilisateur non conforme à la
          réglementation ou aux présentes CGU.
        </P>

        <H2>7.2 Licence concédée à Mimmoza</H2>
        <P>
          En soumettant des Contenus Utilisateur sur la Plateforme, l'Utilisateur concède à
          Mimmoza une licence non exclusive, mondiale, gratuite et sous-licenciable pour utiliser,
          héberger, stocker, reproduire et traiter ces contenus aux seules fins suivantes :
        </P>
        <UL>
          <LI>Fournir le Service à l'Utilisateur.</LI>
          <LI>
            Améliorer les algorithmes et modèles d'IA de la Plateforme, uniquement sous forme
            anonymisée et agrégée.
          </LI>
          <LI>
            Satisfaire aux obligations légales ou réglementaires pesant sur Mimmoza.
          </LI>
        </UL>
        <P>
          Cette licence prend fin à la clôture du Compte de l'Utilisateur, sous réserve des
          obligations légales de conservation et des traitements déjà engagés.
        </P>

        <H2>7.3 Contenus interdits</H2>
        <P>L'Utilisateur s'interdit de soumettre sur la Plateforme tout contenu :</P>
        <UL>
          <LI>Contraire à la loi, à l'ordre public ou aux bonnes mœurs.</LI>
          <LI>
            Portant atteinte aux droits de propriété intellectuelle d'un tiers sans autorisation.
          </LI>
          <LI>
            Comportant des données personnelles de tiers collectées sans leur consentement.
          </LI>
          <LI>
            À caractère diffamatoire, injurieux, discriminatoire, raciste, xénophobe, ou incitant
            à la haine ou à la violence.
          </LI>
          <LI>
            Comportant des informations délibérément fausses ou trompeuses susceptibles d'induire
            Mimmoza ou d'autres Utilisateurs en erreur.
          </LI>
          <LI>
            Comportant des données sensibles au sens du RGPD (santé, origine ethnique, opinions
            politiques, etc.) non strictement nécessaires à l'utilisation du Service.
          </LI>
        </UL>

        <H2>7.4 Modération</H2>
        <P>
          Mimmoza se réserve le droit de supprimer sans préavis tout Contenu Utilisateur qui
          contreviendrait aux présentes CGU ou à la réglementation applicable, sans que cette
          suppression ne puisse engager sa responsabilité à l'égard de l'Utilisateur. Mimmoza
          n'est toutefois pas soumise à une obligation générale de surveillance des Contenus
          Utilisateur.
        </P>
      </>
    ),
  },

  // ── ART. 8
  {
    id: "art8",
    num: "Article 8",
    title: "Contenu Mimmoza et propriété intellectuelle",
    content: (
      <>
        <H2>8.1 Droits de Mimmoza</H2>
        <P>
          L'ensemble du Contenu Mimmoza — comprenant sans limitation la Plateforme dans son
          intégralité, son code source, son architecture technique, ses interfaces graphiques, ses
          algorithmes (dont le SmartScore), ses modèles d'intelligence artificielle, ses bases de
          données propres, ses marques, logos, chartes graphiques, noms de domaine et contenus
          éditoriaux — est la propriété exclusive de Mimmoza ou de ses partenaires concédants, et
          est protégé par le droit français et international de la propriété intellectuelle
          (droit d'auteur, droits sui generis des producteurs de bases de données, droit des
          marques, etc.).
        </P>

        <H2>8.2 Licence d'utilisation de la Plateforme</H2>
        <P>
          Mimmoza concède à l'Utilisateur, pour la durée de son Compte et dans la limite des droits
          attachés à sa formule d'abonnement, une licence personnelle, non exclusive, non
          transférable et révocable d'accès et d'utilisation de la Plateforme. Cette licence est
          strictement limitée à un usage interne et non commercial. Elle n'emporte aucun transfert
          de propriété, aucun droit de sous-licence, et n'autorise aucune exploitation des éléments
          de la Plateforme au-delà de l'usage fonctionnel prévu par les CGU et CGV.
        </P>

        <H2>8.3 Contenus Générés par l'IA — droits et limites</H2>
        <P>
          Les Contenus Générés par l'IA produits par la Plateforme à partir des paramètres de
          l'Utilisateur sont mis à sa disposition dans le cadre de son abonnement. L'Utilisateur
          peut les utiliser à des fins internes ou commerciales sous réserve de respecter les
          conditions suivantes :
        </P>
        <UL>
          <LI>
            Ne pas présenter ces contenus comme le produit d'une expertise humaine qualifiée
            (architecte, expert immobilier, conseiller financier, etc.) sans validation préalable
            par un professionnel compétent.
          </LI>
          <LI>
            Ne pas reproduire, revendre ou mettre à disposition ces contenus de manière à
            concurrencer directement le Service de Mimmoza.
          </LI>
          <LI>
            Assumer l'entière responsabilité de tout usage de ces contenus à des fins
            professionnelles, commerciales, juridiques ou publiques.
          </LI>
        </UL>
        <Warn>
          Mimmoza ne garantit pas que les Contenus Générés par l'IA sont exempts de droits de
          tiers. Il appartient à l'Utilisateur de s'assurer de la conformité de leur utilisation
          avec les droits de propriété intellectuelle applicables.
        </Warn>

        <H2>8.4 Marques</H2>
        <P>
          Les marques, logos et noms commerciaux de Mimmoza ne peuvent être utilisés sans
          l'autorisation préalable et écrite de Mimmoza. Toute utilisation non autorisée constitue
          une contrefaçon susceptible d'engager la responsabilité civile et pénale de son auteur.
        </P>
      </>
    ),
  },

  // ── ART. 9
  {
    id: "art9",
    num: "Article 9",
    title: "Utilisation des données et fiabilité",
    content: (
      <>
        <H2>9.1 Sources de données</H2>
        <P>
          La Plateforme agrège et traite des données issues de sources publiques et privées,
          notamment la base DVF de la DGFiP, les données INSEE, les plans locaux d'urbanisme (PLU),
          la Base Permanente des Équipements (BPE), les données FINESS, les flux cartographiques
          (IGN, OpenStreetMap) et diverses APIs tierces. Mimmoza n'est pas l'auteur de ces données
          et ne peut garantir leur exactitude, exhaustivité ou mise à jour.
        </P>

        <H2>9.2 Limites des analyses produites</H2>
        <Warn>
          Les analyses, estimations, calculs de rentabilité, études de faisabilité et scores
          produits par la Plateforme sont des outils d'aide à la décision de nature indicative.
          Ils ne constituent pas des expertises opposables et ne sauraient servir de fondement
          exclusif à une décision d'investissement, d'acquisition, de cession ou de construction.
          Mimmoza décline toute responsabilité quant aux conséquences d'une décision prise sur
          leur seul fondement.
        </Warn>

        <H2>9.3 Obligation personnelle de vérification</H2>
        <P>
          Avant toute décision engageant des enjeux financiers, juridiques ou techniques
          significatifs, l'Utilisateur s'engage à vérifier de manière indépendante — ou par le
          recours à des professionnels qualifiés — toute information, analyse ou donnée fournie par
          la Plateforme. Cette obligation est renforcée pour les Utilisateurs professionnels
          (investisseurs, promoteurs, marchands de biens, banquiers, agents immobiliers).
        </P>

        <H2>9.4 Données à caractère personnel de tiers</H2>
        <P>
          Lorsque l'Utilisateur saisit des informations relatives à des tiers identifiables (ex. :
          données d'un vendeur, d'un locataire, d'un associé), il garantit disposer des
          autorisations légales nécessaires pour traiter ces données dans le cadre du Service, et
          s'engage à respecter les obligations qui lui incombent en tant que responsable de
          traitement au sens du RGPD.
        </P>
      </>
    ),
  },

  // ── ART. 10
  {
    id: "art10",
    num: "Article 10",
    title: "Rendus visuels et études de faisabilité",
    content: (
      <>
        <H2>10.1 Nature non contractuelle des rendus</H2>
        <Warn>
          Les rendus visuels (projections de façades, modélisations 3D, études de gabarits) générés
          par la Plateforme sont strictement indicatifs et non contractuels. Ils ne constituent pas
          des documents techniques au sens de la réglementation de la construction, et ne peuvent
          en aucun cas être utilisés dans le cadre d'une demande de permis de construire,
          déclaration préalable ou toute autre procédure administrative.
        </Warn>

        <H2>10.2 Études de faisabilité</H2>
        <P>
          Les études de faisabilité promoteur produites par la Plateforme — analyses foncières,
          lectures assistées de PLU, calculs de potentiel constructible — sont des analyses
          préliminaires de première approche. Elles ne se substituent pas :
        </P>
        <UL>
          <LI>À une consultation d'architecte ou d'un bureau d'études techniques.</LI>
          <LI>À une étude de sol ou une évaluation géotechnique.</LI>
          <LI>À une analyse juridique du titre de propriété ou des servitudes.</LI>
          <LI>À la consultation du service instructeur de la collectivité territoriale compétente.</LI>
          <LI>À toute autre expertise réglementaire obligatoire.</LI>
        </UL>

        <H2>10.3 Responsabilité de l'Utilisateur</H2>
        <P>
          L'Utilisateur qui utilise des rendus visuels ou des études de faisabilité à des fins
          professionnelles, commerciales ou dans le cadre de relations avec des tiers (clients,
          investisseurs, partenaires, administrations) assume l'entière responsabilité de cet usage
          et s'engage à informer ses interlocuteurs du caractère indicatif et automatisé de ces
          productions.
        </P>
      </>
    ),
  },

  // ── ART. 11
  {
    id: "art11",
    num: "Article 11",
    title: "Liens hypertextes et services tiers",
    content: (
      <>
        <H2>11.1 Liens vers des sites tiers</H2>
        <P>
          La Plateforme peut contenir des liens hypertextes vers des sites ou services tiers.
          Mimmoza n'exerce aucun contrôle sur ces sites et services, et ne saurait être tenue
          responsable de leur contenu, de leur politique de confidentialité, de leur disponibilité
          ou de tout dommage pouvant résulter de leur utilisation. La présence d'un lien ne vaut
          pas approbation ou partenariat de la part de Mimmoza.
        </P>

        <H2>11.2 Services et APIs tiers intégrés</H2>
        <P>
          La Plateforme intègre des services et APIs tiers (cartographie, données immobilières,
          modèles d'IA, paiement, etc.) nécessaires à son fonctionnement. Ces services sont soumis
          aux conditions d'utilisation et politiques de confidentialité de leurs éditeurs respectifs.
          Mimmoza ne saurait être responsable des interruptions, modifications ou défaillances de
          ces services, ni de leurs conséquences sur le fonctionnement de la Plateforme ou sur
          les résultats des analyses.
        </P>

        <H2>11.3 Intégration de la Plateforme dans des systèmes tiers</H2>
        <P>
          Toute intégration de la Plateforme ou de ses APIs dans un système ou service tiers est
          soumise à l'accord préalable et écrit de Mimmoza. Mimmoza propose une offre API dédiée
          pour les Utilisateurs souhaitant intégrer les données ou fonctionnalités de la Plateforme
          dans leurs propres outils. Les conditions d'accès à cette offre sont définies dans un
          contrat spécifique.
        </P>
      </>
    ),
  },

  // ── ART. 12
  {
    id: "art12",
    num: "Article 12",
    title: "Cookies et traceurs",
    content: (
      <>
        <H2>12.1 Utilisation des cookies</H2>
        <P>
          La Plateforme utilise des cookies et traceurs pour assurer son bon fonctionnement,
          améliorer l'expérience Utilisateur, mesurer l'audience et, le cas échéant, proposer des
          fonctionnalités personnalisées. Conformément à la réglementation (article 82 de la loi
          Informatique et Libertés, directive ePrivacy), le dépôt de cookies non strictement
          nécessaires au fonctionnement de la Plateforme est soumis au consentement préalable de
          l'Utilisateur.
        </P>

        <H2>12.2 Catégories de cookies utilisés</H2>
        <UL>
          <LI>
            <strong>Cookies strictement nécessaires</strong> : indispensables au fonctionnement
            technique de la Plateforme (session, authentification, préférences de sécurité). Ils
            ne nécessitent pas de consentement.
          </LI>
          <LI>
            <strong>Cookies analytiques</strong> : permettent de mesurer l'audience et l'utilisation
            de la Plateforme à des fins d'amélioration du service (ex. : statistiques de navigation
            anonymisées).
          </LI>
          <LI>
            <strong>Cookies fonctionnels</strong> : permettent de mémoriser les préférences de
            l'Utilisateur (langue, paramètres d'affichage, dernières recherches).
          </LI>
          <LI>
            <strong>Cookies tiers</strong> : déposés par des partenaires techniques (cartographie,
            services de paiement, outils d'analytics) dans le cadre du fonctionnement de la
            Plateforme.
          </LI>
        </UL>

        <H2>12.3 Gestion des cookies</H2>
        <P>
          L'Utilisateur peut paramétrer ses préférences en matière de cookies via le bandeau de
          consentement affiché lors de sa première visite, ou à tout moment depuis le Centre de
          préférences accessible dans les paramètres de son Compte. Le refus de certains cookies
          peut affecter le fonctionnement de certaines fonctionnalités de la Plateforme. La
          Politique de Cookies complète est disponible sur la Plateforme.
        </P>
      </>
    ),
  },

  // ── ART. 13
  {
    id: "art13",
    num: "Article 13",
    title: "Clôture du Compte",
    content: (
      <>
        <H2>13.1 Clôture à l'initiative de l'Utilisateur</H2>
        <P>
          L'Utilisateur peut clôturer son Compte à tout moment depuis les paramètres de son espace
          personnel, ou en adressant une demande écrite à{" "}
          <a href="mailto:contact@mimmoza.fr" className="text-[#2E7D9A] underline">
            contact@mimmoza.fr
          </a>
          . La clôture prend effet à la date de réception de la demande, sous réserve des
          dispositions relatives à la résiliation des abonnements en cours prévues dans les CGV.
        </P>

        <H2>13.2 Effets de la clôture</H2>
        <P>
          À la date de clôture du Compte, l'Utilisateur perd l'accès à l'ensemble des
          fonctionnalités de la Plateforme et à ses données et historiques. Les données de
          l'Utilisateur sont conservées pendant une période de trente (30) jours à compter de
          la clôture, durant laquelle l'Utilisateur peut en demander l'export. Passé ce délai,
          elles sont définitivement supprimées, sous réserve des obligations légales de conservation
          (ex. : factures conservées dix ans).
        </P>

        <H2>13.3 Clôture à l'initiative de Mimmoza</H2>
        <P>
          Mimmoza se réserve le droit de clôturer un Compte en cas de manquement grave ou répété
          aux présentes CGU, notamment en cas de comportements proscrits listés à l'article 6.3,
          de violation des droits de propriété intellectuelle, de fraude ou d'utilisation abusive.
          La clôture peut intervenir sans préavis dans les cas les plus graves.
        </P>
      </>
    ),
  },

  // ── ART. 14
  {
    id: "art14",
    num: "Article 14",
    title: "Responsabilité",
    content: (
      <>
        <H2>14.1 Limitation générale</H2>
        <P>
          Dans toute la mesure permise par le droit applicable, Mimmoza n'est responsable que des
          dommages directs causés par un manquement prouvé à ses obligations au titre des présentes
          CGU, à l'exclusion de tout dommage indirect (perte de chiffre d'affaires, manque à
          gagner, perte de chance, perte de données, atteinte à l'image, etc.).
        </P>
        <Warn>
          Mimmoza ne saurait en aucun cas être tenue responsable des décisions d'investissement,
          des pertes financières, des transactions immobilières ou des choix professionnels opérés
          par l'Utilisateur sur le fondement des analyses, scores ou contenus fournis par la
          Plateforme.
        </Warn>

        <H2>14.2 Plafond de responsabilité</H2>
        <P>
          En tout état de cause, si la responsabilité de Mimmoza devait être retenue par une
          juridiction compétente, elle serait plafonnée au montant total des sommes effectivement
          perçues par Mimmoza de l'Utilisateur au cours des douze (12) mois précédant le fait
          générateur du dommage. Pour les Utilisateurs ne disposant pas d'abonnement payant, ce
          plafond est fixé à cinquante (50) euros.
        </P>

        <H2>14.3 Garantie de l'Utilisateur</H2>
        <P>
          L'Utilisateur s'engage à indemniser, défendre et garantir Mimmoza et ses dirigeants,
          salariés, prestataires et partenaires contre tout recours, réclamation, dommage, perte ou
          frais (y compris honoraires d'avocats) résultant de : (i) la violation des présentes CGU
          par l'Utilisateur ; (ii) tout Contenu Utilisateur non conforme ; (iii) toute utilisation
          illicite ou non autorisée du Service ; ou (iv) la violation des droits d'un tiers.
        </P>
      </>
    ),
  },

  // ── ART. 15
  {
    id: "art15",
    num: "Article 15",
    title: "Données personnelles",
    content: (
      <>
        <H2>15.1 Responsable de traitement</H2>
        <P>
          Mimmoza traite les données personnelles de l'Utilisateur en qualité de responsable de
          traitement au sens du Règlement (UE) 2016/679 (RGPD) et de la loi Informatique et
          Libertés du 6 janvier 1978 modifiée. Les conditions détaillées de ce traitement
          (finalités, bases légales, durées de conservation, transferts éventuels hors UE, droits
          de l'Utilisateur) sont décrites dans la Politique de Confidentialité de Mimmoza,
          accessible en permanence sur la Plateforme.
        </P>

        <H2>15.2 Données collectées</H2>
        <P>Mimmoza collecte notamment les catégories de données suivantes :</P>
        <UL>
          <LI>
            <strong>Données d'identification</strong> : nom, prénom, adresse électronique, téléphone,
            qualité professionnelle.
          </LI>
          <LI>
            <strong>Données de connexion</strong> : adresse IP, identifiants de session, logs
            d'activité, horodatages.
          </LI>
          <LI>
            <strong>Données d'utilisation</strong> : paramètres saisis, recherches effectuées,
            analyses consultées, préférences.
          </LI>
          <LI>
            <strong>Données de facturation</strong> : coordonnées de facturation, historique des
            transactions (les données bancaires ne sont pas stockées par Mimmoza).
          </LI>
        </UL>

        <H2>15.3 Droits de l'Utilisateur</H2>
        <P>
          L'Utilisateur dispose des droits suivants sur ses données personnelles : droit d'accès,
          de rectification, d'effacement (« droit à l'oubli »), de limitation du traitement, à la
          portabilité, et d'opposition. Ces droits peuvent être exercés en contactant le Délégué à
          la Protection des Données (DPO) de Mimmoza à l'adresse{" "}
          <a href="mailto:dpo@mimmoza.fr" className="text-[#2E7D9A] underline">
            dpo@mimmoza.fr
          </a>
          . L'Utilisateur dispose également du droit d'introduire une réclamation auprès de la
          Commission Nationale de l'Informatique et des Libertés (CNIL – www.cnil.fr).
        </P>

        <H2>15.4 Sécurité des données</H2>
        <P>
          Mimmoza met en œuvre des mesures techniques et organisationnelles appropriées pour
          protéger les données personnelles contre la perte, la destruction, l'altération, l'accès
          non autorisé ou la divulgation illicite, conformément à l'état de l'art en matière de
          sécurité informatique. En cas de violation de données à caractère personnel susceptible
          d'engendrer un risque élevé pour les droits et libertés de l'Utilisateur, Mimmoza
          s'engage à en informer celui-ci dans les meilleurs délais.
        </P>
      </>
    ),
  },

  // ── ART. 16
  {
    id: "art16",
    num: "Article 16",
    title: "Sécurité et signalement de vulnérabilités",
    content: (
      <>
        <H2>16.1 Engagements de Mimmoza</H2>
        <P>
          Mimmoza s'engage à maintenir un niveau de sécurité adapté aux risques associés à
          l'exploitation de la Plateforme, notamment par la mise en œuvre de mesures de
          chiffrement des données en transit et au repos, de contrôles d'accès stricts, de sauvegardes
          régulières et de procédures de gestion des incidents de sécurité.
        </P>

        <H2>16.2 Signalement responsable (Responsible Disclosure)</H2>
        <P>
          Tout Utilisateur qui découvrirait une vulnérabilité de sécurité affectant la Plateforme
          est invité à la signaler de manière responsable à l'adresse{" "}
          <a href="mailto:security@mimmoza.fr" className="text-[#2E7D9A] underline">
            security@mimmoza.fr
          </a>
          , en fournissant une description détaillée de la vulnérabilité et des conditions de sa
          découverte. L'Utilisateur s'engage à ne pas exploiter la vulnérabilité, à ne pas la
          divulguer publiquement avant que Mimmoza n'ait eu l'opportunité d'y remédier, et à ne
          pas accéder aux données d'autres Utilisateurs à cette occasion.
        </P>
        <Info>
          Mimmoza s'engage à traiter tout signalement responsable avec sérieux et diligence, et à
          tenir l'auteur du signalement informé des suites données dans un délai raisonnable.
        </Info>
      </>
    ),
  },

  // ── ART. 17
  {
    id: "art17",
    num: "Article 17",
    title: "Force majeure",
    content: (
      <>
        <P>
          Aucune des parties ne saurait être tenue responsable de l'inexécution ou du retard dans
          l'exécution de l'une de ses obligations au titre des présentes CGU lorsque cette
          inexécution ou ce retard résulte d'un événement de force majeure au sens de l'article
          1218 du Code civil.
        </P>
        <P>
          Constituent notamment des cas de force majeure : les catastrophes naturelles (séisme,
          inondation, tempête), les actes de guerre ou de terrorisme, les pandémies et épidémies
          déclarées, les décisions des autorités publiques (réquisition, embargo, restriction
          d'accès à internet), les pannes généralisées des réseaux de télécommunications ou
          d'électricité, les cyberattaques de grande ampleur affectant les infrastructures
          d'hébergement, et tout autre événement présentant les caractères d'imprévisibilité,
          d'irrésistibilité et d'extériorité requis par la jurisprudence.
        </P>
        <P>
          La partie empêchée notifie l'autre dans les meilleurs délais. Les obligations de la
          partie empêchée sont suspendues pendant la durée de l'événement. Si celui-ci excède
          soixante (60) jours consécutifs, chaque partie peut mettre fin à la relation sans
          indemnité par notification écrite.
        </P>
      </>
    ),
  },

  // ── ART. 18
  {
    id: "art18",
    num: "Article 18",
    title: "Dispositions finales",
    content: (
      <>
        <H2>18.1 Droit applicable</H2>
        <P>
          Les présentes CGU sont soumises au droit français, sans préjudice des dispositions
          impératives applicables dans le pays de résidence de l'Utilisateur consommateur.
        </P>

        <H2>18.2 Règlement des litiges</H2>
        <P>
          En cas de litige relatif à l'interprétation ou à l'exécution des présentes CGU, les
          parties s'efforceront de trouver une solution amiable dans un délai de trente (30) jours
          à compter de la notification du différend par la partie la plus diligente.
        </P>
        <P>
          Pour les Utilisateurs consommateurs, Mimmoza adhère à un dispositif de médiation de la
          consommation conformément aux articles L.616-1 et R.616-1 du Code de la consommation.
          Les coordonnées du médiateur sont disponibles sur demande à{" "}
          <a href="mailto:contact@mimmoza.fr" className="text-[#2E7D9A] underline">
            contact@mimmoza.fr
          </a>
          .
        </P>
        <P>
          À défaut de résolution amiable, tout litige sera soumis à la compétence exclusive des
          juridictions du ressort du siège social de Mimmoza pour les Utilisateurs professionnels,
          ou des juridictions compétentes du lieu de résidence pour les Utilisateurs consommateurs.
        </P>

        <H2>18.3 Nullité partielle</H2>
        <P>
          Si l'une des dispositions des présentes CGU était déclarée nulle ou inapplicable, les
          autres dispositions resteraient pleinement en vigueur. Les parties s'engagent à la
          remplacer par une disposition ayant un effet économique équivalent.
        </P>

        <H2>18.4 Non-renonciation</H2>
        <P>
          Le fait pour Mimmoza de ne pas se prévaloir d'une violation des présentes CGU par
          l'Utilisateur ne constitue pas une renonciation à se prévaloir de violations ultérieures
          de même nature ou de toute autre clause.
        </P>

        <H2>18.5 Contact</H2>
        <P>
          Pour toute question relative aux présentes CGU, l'Utilisateur peut contacter Mimmoza :
        </P>
        <UL>
          <LI>
            Par courrier électronique :{" "}
            <a href="mailto:contact@mimmoza.fr" className="text-[#2E7D9A] underline">
              contact@mimmoza.fr
            </a>
          </LI>
          <LI>
            Par courrier postal : Mimmoza SAS – [Adresse du siège social]
          </LI>
          <LI>
            Via le formulaire de contact disponible sur la Plateforme.
          </LI>
        </UL>
      </>
    ),
  },
];

// ─── Composant TOC avec suivi de section active ───────────────────────────────

const TOC: React.FC<{
  activeId: string;
  onNavigate: (id: string) => void;
}> = ({ activeId, onNavigate }) => (
  <aside className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm sticky top-6 self-start">
    <p className="text-xs font-bold text-[#1A3C5E] uppercase tracking-widest mb-3">
      Sommaire
    </p>
    <nav>
      <ol className="space-y-1">
        {articles.map((a) => {
          const isActive = activeId === a.id;
          return (
            <li key={a.id}>
              <button
                onClick={() => onNavigate(a.id)}
                className={`text-xs text-left w-full transition-colors px-2 py-1 rounded ${
                  isActive
                    ? "bg-sky-50 text-[#1A3C5E] font-semibold"
                    : "text-[#2E7D9A] hover:text-[#1A3C5E] hover:bg-gray-50"
                }`}
              >
                <span className="font-bold">{a.num}</span>
                <span className="text-gray-400 mx-1">–</span>
                {a.title}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  </aside>
);

// ─── Article Card ─────────────────────────────────────────────────────────────

const ArticleCard: React.FC<{ article: Article }> = ({ article }) => (
  <section
    id={article.id}
    className="bg-white border border-gray-200 rounded-xl p-6 mb-5 shadow-sm scroll-mt-6"
  >
    <div className="flex items-baseline gap-3 mb-4 pb-3 border-b border-gray-100">
      <span className="text-xs font-bold text-[#2E7D9A] uppercase tracking-widest whitespace-nowrap">
        {article.num}
      </span>
      <h2 className="text-base font-bold text-[#1A3C5E] leading-snug">{article.title}</h2>
    </div>
    <div>{article.content}</div>
  </section>
);

// ─── Page principale ──────────────────────────────────────────────────────────

const CGUPage: React.FC = () => {
  const [activeId, setActiveId] = useState<string>(articles[0].id);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting);
        if (visible) setActiveId(visible.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    );
    articles.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observerRef.current?.observe(el);
    });
    return () => observerRef.current?.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <div className="bg-[#1A3C5E] text-white py-10 px-6">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-bold tracking-widest uppercase text-[#7EC8E3] mb-2">
            Mimmoza SAS
          </p>
          <h1 className="text-2xl font-bold mb-1">
            Conditions Générales d'Utilisation
          </h1>
          <p className="text-sm text-blue-200">
            Version en vigueur à compter du 13 avril 2026
          </p>
          <p className="text-xs text-blue-300 mt-1">
            Applicable à l'ensemble des utilisateurs de la plateforme Mimmoza
          </p>
        </div>
      </div>

      {/* ── Bandeau de version ── */}
      <div className="bg-[#2E7D9A]/10 border-b border-[#2E7D9A]/20 px-6 py-2">
        <div className="max-w-6xl mx-auto flex flex-wrap gap-4 items-center text-xs text-[#1A3C5E]">
          <span>📄 CGU – 18 articles</span>
          <span className="text-gray-300">|</span>
          <span>🔗 À lire conjointement avec les CGV et la Politique de Confidentialité</span>
          <span className="text-gray-300">|</span>
          <span>
            Contact :{" "}
            <a href="mailto:contact@mimmoza.fr" className="text-[#2E7D9A] underline">
              contact@mimmoza.fr
            </a>
          </span>
        </div>
      </div>

      {/* ── Corps ── */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex gap-6 items-start">
          {/* Sidebar TOC — masqué sur mobile */}
          <div className="hidden lg:block w-64 flex-shrink-0">
            <TOC activeId={activeId} onNavigate={scrollTo} />
          </div>

          {/* Articles */}
          <div className="flex-1 min-w-0">
            {/* TOC mobile */}
            <div className="lg:hidden mb-6">
              <details className="bg-white border border-gray-200 rounded-xl shadow-sm">
                <summary className="px-5 py-3 text-sm font-bold text-[#1A3C5E] cursor-pointer select-none">
                  Table des matières
                </summary>
                <div className="px-5 pb-4">
                  <ol className="space-y-1 mt-2">
                    {articles.map((a) => (
                      <li key={a.id}>
                        <button
                          onClick={() => scrollTo(a.id)}
                          className="text-xs text-[#2E7D9A] hover:text-[#1A3C5E] text-left w-full py-0.5"
                        >
                          <span className="font-bold">{a.num}</span>
                          <span className="text-gray-400 mx-1">–</span>
                          {a.title}
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
            </div>

            {articles.map((a) => (
              <ArticleCard key={a.id} article={a} />
            ))}

            {/* Footer */}
            <div className="mt-8 pt-6 border-t border-gray-200 text-center text-xs text-gray-400 space-y-1">
              <p>© 2026 Mimmoza SAS – Tous droits réservés</p>
              <p>
                <a href="mailto:contact@mimmoza.fr" className="hover:text-[#2E7D9A] transition-colors">
                  contact@mimmoza.fr
                </a>{" "}
                –{" "}
                <a href="https://www.mimmoza.fr" className="hover:text-[#2E7D9A] transition-colors">
                  www.mimmoza.fr
                </a>
              </p>
              <p className="italic">
                Ces CGU ont été rédigées à titre indicatif et doivent être relues par un avocat
                avant toute mise en ligne.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CGUPage;