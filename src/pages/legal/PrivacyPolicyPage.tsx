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

// ─── Tableau de synthèse des traitements ─────────────────────────────────────

interface TraitementRow {
  finalite: string;
  donnees: string;
  base: string;
  duree: string;
}

const TableTraitements: React.FC<{ rows: TraitementRow[] }> = ({ rows }) => (
  <div className="overflow-x-auto my-4">
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="bg-[#1A3C5E] text-white">
          <th className="text-left px-3 py-2 font-semibold rounded-tl-md">Finalité</th>
          <th className="text-left px-3 py-2 font-semibold">Données concernées</th>
          <th className="text-left px-3 py-2 font-semibold">Base légale</th>
          <th className="text-left px-3 py-2 font-semibold rounded-tr-md">Durée de conservation</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={i}
            className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}
          >
            <td className="px-3 py-2 text-gray-800 font-medium border-b border-gray-100 align-top">
              {r.finalite}
            </td>
            <td className="px-3 py-2 text-gray-600 border-b border-gray-100 align-top">
              {r.donnees}
            </td>
            <td className="px-3 py-2 border-b border-gray-100 align-top">
              <span className="inline-block bg-sky-100 text-[#1A3C5E] rounded px-1.5 py-0.5 font-semibold whitespace-nowrap">
                {r.base}
              </span>
            </td>
            <td className="px-3 py-2 text-gray-600 border-b border-gray-100 align-top">
              {r.duree}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ─── Carte droit utilisateur ──────────────────────────────────────────────────

const DroitCard: React.FC<{
  icon: string;
  titre: string;
  description: string;
}> = ({ icon, titre, description }) => (
  <div className="flex gap-3 bg-sky-50 border border-sky-100 rounded-lg p-3">
    <span className="text-xl flex-shrink-0">{icon}</span>
    <div>
      <p className="text-sm font-bold text-[#1A3C5E] mb-0.5">{titre}</p>
      <p className="text-xs text-gray-600 leading-relaxed">{description}</p>
    </div>
  </div>
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface Article {
  id: string;
  num: string;
  title: string;
  content: React.ReactNode;
}

// ─── Données : tableau des traitements ───────────────────────────────────────

const traitements: TraitementRow[] = [
  {
    finalite: "Gestion du compte et authentification",
    donnees: "Nom, prénom, e-mail, mot de passe (haché), date d'inscription",
    base: "Exécution du contrat",
    duree: "Durée du compte + 30 jours après clôture",
  },
  {
    finalite: "Fourniture du Service et analyses",
    donnees: "Paramètres saisis, recherches, biens consultés, historique d'analyses",
    base: "Exécution du contrat",
    duree: "Durée du compte + 30 jours",
  },
  {
    finalite: "Facturation et gestion des abonnements",
    donnees: "Coordonnées de facturation, historique des paiements, factures",
    base: "Obligation légale",
    duree: "10 ans (obligation comptable)",
  },
  {
    finalite: "Support client et assistance technique",
    donnees: "E-mail, messages échangés, logs d'erreurs liés au ticket",
    base: "Intérêt légitime",
    duree: "3 ans à compter de la clôture du ticket",
  },
  {
    finalite: "Amélioration de la Plateforme (analytics)",
    donnees: "Données d'usage anonymisées ou pseudonymisées, logs navigateur",
    base: "Intérêt légitime / Consentement",
    duree: "13 mois (cookies), 25 mois (analytics agrégés)",
  },
  {
    finalite: "Communication commerciale et newsletter",
    donnees: "E-mail, prénom, préférences de communication",
    base: "Consentement / Intérêt légitime (clients actifs)",
    duree: "Jusqu'au retrait du consentement ou 3 ans sans activité",
  },
  {
    finalite: "Sécurité et prévention de la fraude",
    donnees: "Adresse IP, logs de connexion, empreintes de session",
    base: "Intérêt légitime / Obligation légale",
    duree: "12 mois",
  },
  {
    finalite: "Respect des obligations légales",
    donnees: "Données nécessaires aux réquisitions judiciaires ou obligations réglementaires",
    base: "Obligation légale",
    duree: "Durée légale applicable",
  },
  {
    finalite: "Amélioration des modèles d'IA",
    donnees: "Données d'usage strictement anonymisées et agrégées",
    base: "Intérêt légitime",
    duree: "Sans limitation (données non réidentifiables)",
  },
];

// ─── Contenu des articles ─────────────────────────────────────────────────────

const articles: Article[] = [
  // ── ART. 1
  {
    id: "art1",
    num: "Article 1",
    title: "Identité du responsable de traitement",
    content: (
      <>
        <P>
          La présente Politique de Confidentialité est établie par la société Mimmoza SAS
          (ci-après « Mimmoza »), société par actions simplifiée au capital de [●] euros,
          immatriculée au Registre du Commerce et des Sociétés de [●] sous le numéro [●], dont
          le siège social est situé [adresse], en sa qualité de responsable de traitement au
          sens du Règlement (UE) 2016/679 du 27 avril 2016 relatif à la protection des données
          à caractère personnel (ci-après « RGPD »).
        </P>
        <P>
          Mimmoza a désigné un Délégué à la Protection des Données (DPO), joignable à l'adresse
          suivante :{" "}
          <a href="mailto:dpo@mimmoza.fr" className="text-[#2E7D9A] underline">
            dpo@mimmoza.fr
          </a>
          . Toute question ou demande relative à la protection des données personnelles doit être
          adressée en priorité au DPO.
        </P>
        <Info>
          La présente Politique de Confidentialité s'applique à l'ensemble des traitements de
          données à caractère personnel réalisés par Mimmoza dans le cadre de l'exploitation de
          la plateforme Mimmoza, accessible via le site web et l'application mobile éponymes.
          Elle doit être lue conjointement avec les Conditions Générales d'Utilisation (CGU) et
          les Conditions Générales de Vente (CGV) de Mimmoza.
        </Info>
      </>
    ),
  },

  // ── ART. 2
  {
    id: "art2",
    num: "Article 2",
    title: "Données collectées",
    content: (
      <>
        <P>
          Mimmoza collecte et traite différentes catégories de données à caractère personnel
          selon le contexte d'utilisation de la Plateforme. Ces données sont collectées
          directement auprès de l'Utilisateur, générées automatiquement lors de l'utilisation
          de la Plateforme, ou, dans certains cas, obtenues auprès de sources tierces autorisées.
        </P>

        <H2>2.1 Données collectées directement auprès de l'Utilisateur</H2>
        <H3>Lors de la création du compte</H3>
        <UL>
          <LI>Nom et prénom.</LI>
          <LI>Adresse électronique professionnelle ou personnelle.</LI>
          <LI>Mot de passe (stocké sous forme hachée et salée — jamais en clair).</LI>
          <LI>Qualité professionnelle (investisseur, promoteur, marchand de biens, banquier, particulier, etc.).</LI>
          <LI>Nom de la société et SIRET (pour les comptes professionnels).</LI>
          <LI>Numéro de téléphone (optionnel).</LI>
        </UL>
        <H3>Lors de la souscription d'un abonnement</H3>
        <UL>
          <LI>Coordonnées de facturation (nom, adresse, pays, TVA intracommunautaire le cas échéant).</LI>
          <LI>
            Informations de paiement transmises directement au prestataire de paiement sécurisé
            (Stripe ou équivalent) — Mimmoza ne stocke pas les numéros de carte bancaire.
          </LI>
        </UL>
        <H3>Lors de l'utilisation du Service</H3>
        <UL>
          <LI>
            Paramètres et données saisies dans les modules d'analyse (adresses, surfaces,
            prix, caractéristiques de biens, paramètres financiers).
          </LI>
          <LI>Recherches et requêtes effectuées sur la Plateforme.</LI>
          <LI>Fichiers importés (plans, documents, images).</LI>
          <LI>Messages échangés avec le support client.</LI>
          <LI>Préférences d'utilisation et de notification.</LI>
        </UL>

        <H2>2.2 Données collectées automatiquement</H2>
        <UL>
          <LI>
            <strong>Données de connexion et logs</strong> : adresse IP, date et heure de
            connexion, durée de session, pages consultées, actions réalisées sur la Plateforme.
          </LI>
          <LI>
            <strong>Données techniques</strong> : type et version du navigateur, système
            d'exploitation, résolution d'écran, langue du navigateur, identifiants de session.
          </LI>
          <LI>
            <strong>Données de localisation approximative</strong> : déduites de l'adresse IP
            (pays, région) — aucune géolocalisation précise n'est effectuée sans consentement
            explicite.
          </LI>
          <LI>
            <strong>Cookies et traceurs</strong> : voir l'article 8 consacré à la politique des
            cookies.
          </LI>
        </UL>

        <H2>2.3 Données provenant de sources tierces</H2>
        <UL>
          <LI>
            En cas de connexion via un service d'authentification tiers (Google, LinkedIn, etc.) :
            nom, prénom, adresse e-mail et photo de profil communiqués par ce service, dans la
            limite de ce que l'Utilisateur a autorisé.
          </LI>
          <LI>
            Données issues d'annuaires professionnels ou de partenaires commerciaux, dans la mesure
            autorisée par la réglementation applicable.
          </LI>
        </UL>

        <H2>2.4 Données que Mimmoza ne collecte pas</H2>
        <Warn>
          Mimmoza ne collecte pas, et ne souhaite pas recevoir, de données sensibles au sens de
          l'article 9 du RGPD (données relatives à la santé, à l'origine ethnique ou raciale,
          aux opinions politiques, aux convictions religieuses ou philosophiques, à
          l'appartenance syndicale, aux données génétiques, biométriques, ou à la vie ou
          l'orientation sexuelle). L'Utilisateur est invité à ne pas saisir de telles données
          dans la Plateforme.
        </Warn>
      </>
    ),
  },

  // ── ART. 3
  {
    id: "art3",
    num: "Article 3",
    title: "Finalités et bases légales des traitements",
    content: (
      <>
        <P>
          Mimmoza ne traite les données personnelles de l'Utilisateur que pour des finalités
          déterminées, explicites et légitimes, sur le fondement d'une base légale valable au
          sens de l'article 6 du RGPD. Le tableau ci-dessous synthétise l'ensemble des
          traitements mis en œuvre, leurs finalités, bases légales et durées de conservation.
        </P>

        <TableTraitements rows={traitements} />

        <H2>3.1 Précisions sur les bases légales</H2>
        <UL>
          <LI>
            <strong>Exécution du contrat</strong> : le traitement est nécessaire à la fourniture
            du Service souscrit par l'Utilisateur. Sans ces données, Mimmoza ne peut pas fournir
            le Service.
          </LI>
          <LI>
            <strong>Obligation légale</strong> : le traitement est imposé par une disposition
            légale ou réglementaire (ex. : conservation des factures pendant dix ans au titre
            du Code de commerce).
          </LI>
          <LI>
            <strong>Intérêt légitime</strong> : le traitement est nécessaire aux fins des intérêts
            légitimes poursuivis par Mimmoza (amélioration du service, sécurité, prévention de
            la fraude), après mise en balance avec les droits et intérêts des Utilisateurs.
          </LI>
          <LI>
            <strong>Consentement</strong> : le traitement est subordonné au consentement préalable,
            libre, spécifique, éclairé et univoque de l'Utilisateur, qui peut le retirer à tout
            moment sans que cela ne porte atteinte à la licéité des traitements antérieurs.
          </LI>
        </UL>
      </>
    ),
  },

  // ── ART. 4
  {
    id: "art4",
    num: "Article 4",
    title: "Durées de conservation",
    content: (
      <>
        <P>
          Mimmoza conserve les données personnelles uniquement pendant la durée strictement
          nécessaire à la réalisation des finalités pour lesquelles elles ont été collectées,
          augmentée des délais de prescription légaux applicables. Les principales règles de
          conservation sont les suivantes :
        </P>

        <H2>4.1 Données de compte</H2>
        <P>
          Les données associées au Compte de l'Utilisateur sont conservées pendant toute la
          durée d'activité du Compte, puis pendant une période de trente (30) jours après sa
          clôture, afin de permettre à l'Utilisateur d'exporter ses données. À l'expiration de
          ce délai, les données sont définitivement supprimées ou irréversiblement anonymisées,
          sous réserve des obligations légales de conservation ci-dessous.
        </P>

        <H2>4.2 Données de facturation</H2>
        <P>
          Les pièces comptables (factures, bons de commande) sont conservées pendant dix (10)
          ans à compter de la clôture de l'exercice auquel elles se rapportent, conformément
          aux articles L.123-22 et suivants du Code de commerce.
        </P>

        <H2>4.3 Données de logs et sécurité</H2>
        <P>
          Les logs de connexion et d'activité sont conservés pendant douze (12) mois à compter
          de leur génération, conformément aux recommandations de la CNIL et aux obligations
          issues de la loi pour la confiance dans l'économie numérique (LCEN).
        </P>

        <H2>4.4 Données de prospection commerciale</H2>
        <P>
          Les données utilisées à des fins de prospection commerciale sont conservées pendant
          trois (3) ans à compter du dernier contact actif de l'Utilisateur avec Mimmoza (clic
          sur un e-mail, connexion, achat, etc.), ou jusqu'au retrait du consentement.
        </P>

        <H2>4.5 Données anonymisées</H2>
        <P>
          Les données irréversiblement anonymisées (ne permettant plus l'identification directe
          ou indirecte d'un individu) ne sont plus considérées comme des données personnelles
          au sens du RGPD et peuvent être conservées sans limitation de durée à des fins
          statistiques ou d'amélioration de la Plateforme.
        </P>

        <Info>
          À tout moment, l'Utilisateur peut demander la suppression anticipée de ses données
          personnelles en exerçant son droit à l'effacement (voir article 6). Mimmoza donnera
          suite à cette demande dans un délai d'un (1) mois, sous réserve des exceptions légales
          applicables.
        </Info>
      </>
    ),
  },

  // ── ART. 5
  {
    id: "art5",
    num: "Article 5",
    title: "Destinataires et partage des données",
    content: (
      <>
        <P>
          Mimmoza ne vend pas les données personnelles de ses Utilisateurs à des tiers. Elle
          peut néanmoins être amenée à partager certaines données avec les catégories de
          destinataires suivantes, dans les conditions décrites ci-après.
        </P>

        <H2>5.1 Personnel interne de Mimmoza</H2>
        <P>
          Les données personnelles sont accessibles aux seuls membres du personnel de Mimmoza
          qui en ont besoin pour l'exercice de leurs fonctions (équipes techniques, support
          client, comptabilité, direction), dans le strict respect du principe de minimisation.
          Mimmoza impose à ses collaborateurs des obligations de confidentialité.
        </P>

        <H2>5.2 Sous-traitants techniques</H2>
        <P>
          Mimmoza fait appel à des prestataires techniques agissant en qualité de
          sous-traitants au sens de l'article 28 du RGPD. Ces prestataires n'accèdent aux
          données qu'aux fins d'exécuter les prestations qui leur sont confiées et sont
          contractuellement tenus de respecter la réglementation applicable. Les principales
          catégories de sous-traitants sont :
        </P>
        <UL>
          <LI>
            <strong>Hébergement et infrastructure cloud</strong> : prestataires assurant
            l'hébergement de la Plateforme et des données (serveurs localisés dans l'Union
            européenne ou couverts par des garanties appropriées).
          </LI>
          <LI>
            <strong>Service de paiement</strong> : prestataire de paiement sécurisé (ex. :
            Stripe Inc.) pour la gestion des transactions. Ce prestataire est soumis à ses
            propres obligations de conformité PCI-DSS.
          </LI>
          <LI>
            <strong>Envoi d'e-mails transactionnels</strong> : prestataire d'envoi de
            communications techniques (confirmation d'inscription, factures, alertes).
          </LI>
          <LI>
            <strong>Support client</strong> : outil de gestion des tickets de support.
          </LI>
          <LI>
            <strong>Analyse d'audience</strong> : outil de mesure d'audience anonymisée
            de la Plateforme (sans transmission de données personnelles identifiantes si
            configuré en mode sans consentement).
          </LI>
          <LI>
            <strong>Modèles d'IA tiers</strong> : dans la mesure où des modèles d'IA tiers
            sont utilisés pour générer des analyses ou des contenus, les paramètres transmis
            peuvent inclure des données pseudonymisées. Aucune donnée directement identifiante
            n'est transmise à ces modèles sans accord préalable de l'Utilisateur.
          </LI>
        </UL>

        <H2>5.3 Autorités et obligations légales</H2>
        <P>
          Mimmoza peut être tenue de communiquer des données personnelles aux autorités
          judiciaires, administratives ou réglementaires compétentes lorsqu'une telle
          communication est imposée par la loi, une décision de justice ou pour protéger les
          droits et intérêts légitimes de Mimmoza (lutte contre la fraude, sécurité de la
          Plateforme).
        </P>

        <H2>5.4 Cession ou restructuration</H2>
        <P>
          Dans le cadre d'une opération de fusion, acquisition, cession d'activité ou
          restructuration, les données personnelles des Utilisateurs pourront être transférées
          au repreneur. L'Utilisateur sera informé par voie électronique préalablement à tout
          tel transfert, et disposera du droit de s'y opposer dans les conditions prévues à
          l'article 6.
        </P>

        <H2>5.5 Ce que Mimmoza ne fait pas</H2>
        <Warn>
          Mimmoza ne vend pas, ne loue pas et ne cède pas à titre commercial les données
          personnelles de ses Utilisateurs à des tiers à des fins de prospection ou de
          profilage publicitaire. Aucune donnée individualisée n'est transmise à des annonceurs.
        </Warn>
      </>
    ),
  },

  // ── ART. 6
  {
    id: "art6",
    num: "Article 6",
    title: "Droits des personnes concernées",
    content: (
      <>
        <P>
          Conformément au RGPD (articles 15 à 22) et à la loi Informatique et Libertés,
          l'Utilisateur dispose des droits suivants sur ses données personnelles :
        </P>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-4">
          <DroitCard
            icon="👁️"
            titre="Droit d'accès"
            description="Obtenir la confirmation que des données vous concernant sont traitées et en obtenir une copie, ainsi que des informations sur leur traitement (art. 15 RGPD)."
          />
          <DroitCard
            icon="✏️"
            titre="Droit de rectification"
            description="Faire corriger des données inexactes ou incomplètes vous concernant (art. 16 RGPD)."
          />
          <DroitCard
            icon="🗑️"
            titre="Droit à l'effacement"
            description="Demander la suppression de vos données (« droit à l'oubli »), sous réserve des exceptions légales (art. 17 RGPD)."
          />
          <DroitCard
            icon="⏸️"
            titre="Droit à la limitation"
            description="Demander la suspension temporaire du traitement dans certains cas (données contestées, traitement illicite, etc.) (art. 18 RGPD)."
          />
          <DroitCard
            icon="📦"
            titre="Droit à la portabilité"
            description="Recevoir vos données dans un format structuré, couramment utilisé et lisible par machine, et les transmettre à un autre responsable (art. 20 RGPD)."
          />
          <DroitCard
            icon="🚫"
            titre="Droit d'opposition"
            description="S'opposer à tout moment à un traitement fondé sur l'intérêt légitime ou à des fins de prospection commerciale (art. 21 RGPD)."
          />
          <DroitCard
            icon="🤖"
            titre="Droit relatif à la décision automatisée"
            description="Ne pas faire l'objet d'une décision basée exclusivement sur un traitement automatisé produisant des effets juridiques significatifs (art. 22 RGPD)."
          />
          <DroitCard
            icon="📜"
            titre="Directives post-mortem"
            description="Définir des directives relatives au sort de vos données après votre décès (loi Informatique et Libertés, art. 85)."
          />
        </div>

        <H2>6.1 Modalités d'exercice</H2>
        <P>
          Pour exercer l'un de ces droits, l'Utilisateur peut adresser sa demande :
        </P>
        <UL>
          <LI>
            Par e-mail au DPO :{" "}
            <a href="mailto:dpo@mimmoza.fr" className="text-[#2E7D9A] underline">
              dpo@mimmoza.fr
            </a>
          </LI>
          <LI>
            Par courrier postal : Mimmoza SAS – À l'attention du DPO – [Adresse du siège]
          </LI>
          <LI>
            Depuis l'espace « Mes données » accessible dans les paramètres du Compte
            (pour les droits d'accès, rectification et portabilité).
          </LI>
        </UL>
        <P>
          Mimmoza s'engage à répondre à toute demande dans un délai d'un (1) mois à compter de
          sa réception. Ce délai peut être prorogé de deux (2) mois supplémentaires en raison
          de la complexité ou du nombre de demandes, auquel cas l'Utilisateur en sera informé
          dans le délai d'un mois.
        </P>

        <H2>6.2 Justification d'identité</H2>
        <P>
          Afin de protéger les données personnelles contre tout accès non autorisé, Mimmoza se
          réserve le droit de demander à l'Utilisateur de justifier de son identité avant de
          donner suite à sa demande. Cette pièce d'identité ne sera pas conservée au-delà du
          traitement de la demande.
        </P>

        <H2>6.3 Droit de réclamation auprès de la CNIL</H2>
        <P>
          Si l'Utilisateur estime que ses droits ne sont pas respectés par Mimmoza, il dispose
          du droit d'introduire une réclamation auprès de l'autorité de contrôle compétente.
          En France, il s'agit de la Commission Nationale de l'Informatique et des Libertés
          (CNIL), dont les coordonnées sont les suivantes :
        </P>
        <Info>
          CNIL – 3 Place de Fontenoy – TSA 80715 – 75334 Paris Cedex 07 — Tél. : 01 53 73 22 22
          — www.cnil.fr
        </Info>
      </>
    ),
  },

  // ── ART. 7
  {
    id: "art7",
    num: "Article 7",
    title: "Transferts hors Union européenne",
    content: (
      <>
        <H2>7.1 Principe de localisation dans l'UE</H2>
        <P>
          Mimmoza privilégie le recours à des prestataires et infrastructures dont les serveurs
          sont localisés dans l'Union européenne ou dans l'Espace économique européen (EEE), afin
          de garantir un niveau de protection des données équivalent à celui imposé par le RGPD.
        </P>

        <H2>7.2 Transferts hors EEE</H2>
        <P>
          Certains prestataires techniques de Mimmoza peuvent être établis ou opérer des
          traitements hors de l'EEE (notamment aux États-Unis). Dans ce cas, Mimmoza s'assure
          que ces transferts sont encadrés par l'une des garanties appropriées prévues par le
          RGPD, à savoir :
        </P>
        <UL>
          <LI>
            Une décision d'adéquation de la Commission européenne reconnaissant que le pays
            tiers assure un niveau de protection adéquat (ex. : États-Unis dans le cadre du
            Data Privacy Framework).
          </LI>
          <LI>
            Les Clauses Contractuelles Types (CCT) adoptées par la Commission européenne,
            complétées le cas échéant de mesures supplémentaires.
          </LI>
          <LI>
            Des règles d'entreprise contraignantes (Binding Corporate Rules) dans le cas de
            groupes multinationaux.
          </LI>
        </UL>
        <P>
          L'Utilisateur peut obtenir des informations sur les garanties mises en œuvre pour un
          transfert spécifique en contactant le DPO à{" "}
          <a href="mailto:dpo@mimmoza.fr" className="text-[#2E7D9A] underline">
            dpo@mimmoza.fr
          </a>
          .
        </P>

        <H2>7.3 Hébergement des données</H2>
        <P>
          Les données personnelles des Utilisateurs sont hébergées sur des serveurs situés dans
          l'Union européenne. Mimmoza s'engage à maintenir cet hébergement en Europe et à
          informer les Utilisateurs de tout changement substantiel à cet égard.
        </P>
      </>
    ),
  },

  // ── ART. 8
  {
    id: "art8",
    num: "Article 8",
    title: "Cookies et traceurs",
    content: (
      <>
        <H2>8.1 Qu'est-ce qu'un cookie ?</H2>
        <P>
          Un cookie est un petit fichier texte déposé sur le terminal de l'Utilisateur
          (ordinateur, smartphone, tablette) lors de la visite d'un site web ou de l'utilisation
          d'une application. Il permet au site de reconnaître l'Utilisateur lors de ses visites
          ultérieures et de mémoriser certaines informations relatives à sa navigation.
        </P>

        <H2>8.2 Cookies utilisés par Mimmoza</H2>

        <H3>Cookies strictement nécessaires — aucun consentement requis</H3>
        <UL>
          <LI>
            <strong>Cookie de session</strong> : maintient la session de l'Utilisateur connecté.
            Durée : session (supprimé à la fermeture du navigateur).
          </LI>
          <LI>
            <strong>Cookie CSRF</strong> : protège contre les attaques de type Cross-Site Request
            Forgery. Durée : session.
          </LI>
          <LI>
            <strong>Cookie de préférences de consentement</strong> : mémorise les choix de
            l'Utilisateur relatifs aux cookies. Durée : 12 mois.
          </LI>
        </UL>

        <H3>Cookies analytiques — consentement requis</H3>
        <UL>
          <LI>
            <strong>Outil de mesure d'audience</strong> (ex. : Matomo, Plausible, ou équivalent
            configuré sans cookie si possible) : analyse anonymisée des pages visitées, sources
            de trafic, durées de session. Durée : 13 mois maximum.
          </LI>
        </UL>

        <H3>Cookies fonctionnels — consentement requis</H3>
        <UL>
          <LI>
            <strong>Préférences d'affichage</strong> : mémorise les paramètres d'affichage
            choisis par l'Utilisateur (thème, langue, derniers filtres utilisés). Durée : 12 mois.
          </LI>
        </UL>

        <H3>Cookies tiers — consentement requis</H3>
        <UL>
          <LI>
            <strong>Cartographie</strong> (ex. : Mapbox, Leaflet/OpenStreetMap) : cookies déposés
            lors de l'affichage des cartes interactives. Durée variable selon l'éditeur.
          </LI>
          <LI>
            <strong>Paiement</strong> (ex. : Stripe) : cookies nécessaires à la sécurisation
            des transactions. Durée variable selon l'éditeur.
          </LI>
        </UL>

        <H2>8.3 Gestion des cookies</H2>
        <P>
          Lors de sa première visite, l'Utilisateur est invité à exprimer ses préférences via
          le bandeau de gestion des cookies. Il peut à tout moment modifier ses choix depuis :
        </P>
        <UL>
          <LI>Le Centre de préférences accessible via le lien « Gérer mes cookies » en bas de page.</LI>
          <LI>Les paramètres de son navigateur (voir documentation du navigateur concerné).</LI>
        </UL>
        <Warn>
          Le refus de certains cookies non strictement nécessaires peut entraîner une dégradation
          de certaines fonctionnalités de la Plateforme (cartes, mémorisation des préférences,
          etc.). Le refus des cookies strictement nécessaires n'est pas possible sans empêcher
          le fonctionnement de la Plateforme.
        </Warn>

        <H2>8.4 Durée de validité du consentement</H2>
        <P>
          Le consentement de l'Utilisateur relatif aux cookies est valable pour une durée
          maximale de douze (12) mois, conformément aux recommandations de la CNIL. À l'issue
          de cette période, le bandeau de consentement est à nouveau affiché.
        </P>
      </>
    ),
  },

  // ── ART. 9
  {
    id: "art9",
    num: "Article 9",
    title: "Sécurité des données",
    content: (
      <>
        <H2>9.1 Mesures techniques et organisationnelles</H2>
        <P>
          Mimmoza met en œuvre des mesures de sécurité techniques et organisationnelles
          appropriées pour protéger les données personnelles contre la perte accidentelle ou
          illicite, la destruction, l'altération, la divulgation non autorisée et l'accès
          illégitime, conformément à l'article 32 du RGPD. Ces mesures incluent notamment :
        </P>
        <UL>
          <LI>
            Chiffrement des données en transit via le protocole TLS 1.2 minimum (HTTPS
            obligatoire sur l'ensemble de la Plateforme).
          </LI>
          <LI>
            Chiffrement des données sensibles au repos (mots de passe hachés et salés,
            données de facturation).
          </LI>
          <LI>
            Contrôles d'accès stricts basés sur le principe du moindre privilège : seuls les
            collaborateurs habilités accèdent aux données personnelles.
          </LI>
          <LI>
            Authentification multi-facteurs (MFA) pour les accès aux systèmes d'administration.
          </LI>
          <LI>
            Sauvegardes régulières et chiffrées des données, avec tests de restauration
            périodiques.
          </LI>
          <LI>
            Journalisation des accès et des opérations sensibles sur les données personnelles.
          </LI>
          <LI>
            Procédure de gestion des incidents de sécurité incluant une analyse d'impact et
            un plan de notification.
          </LI>
          <LI>
            Évaluations de sécurité régulières (audits, tests de pénétration) réalisées par
            des prestataires spécialisés.
          </LI>
        </UL>

        <H2>9.2 Violation de données</H2>
        <P>
          En cas de violation de données à caractère personnel susceptible d'engendrer un risque
          pour les droits et libertés des personnes concernées, Mimmoza s'engage à :
        </P>
        <UL>
          <LI>
            Notifier la violation à la CNIL dans un délai de soixante-douze (72) heures après
            en avoir pris connaissance, conformément à l'article 33 du RGPD.
          </LI>
          <LI>
            Informer les Utilisateurs concernés dans les meilleurs délais lorsque la violation
            est susceptible d'engendrer un risque élevé pour leurs droits et libertés,
            conformément à l'article 34 du RGPD.
          </LI>
        </UL>

        <H2>9.3 Responsabilité de l'Utilisateur</H2>
        <P>
          L'Utilisateur contribue à la sécurité de ses données en choisissant un mot de passe
          robuste, en le renouvelant régulièrement, en ne le communiquant à personne, et en
          signalant sans délai à Mimmoza tout accès non autorisé à son Compte. Mimmoza ne
          saurait être tenue responsable de violations de sécurité résultant de négligences de
          l'Utilisateur dans la gestion de ses Identifiants.
        </P>
      </>
    ),
  },

  // ── ART. 10
  {
    id: "art10",
    num: "Article 10",
    title: "Traitement des données et intelligence artificielle",
    content: (
      <>
        <H2>10.1 Usage des données dans les modèles d'IA</H2>
        <P>
          Certaines fonctionnalités de la Plateforme reposent sur des modèles d'intelligence
          artificielle et d'apprentissage automatique. Mimmoza peut utiliser des données
          d'usage agrégées et anonymisées pour entraîner, affiner ou évaluer ses propres
          modèles, dans le respect du principe de minimisation des données.
        </P>
        <Warn>
          Mimmoza ne transmet pas de données personnelles identifiantes à des modèles d'IA tiers
          sans information préalable de l'Utilisateur. Les paramètres transmis aux modèles d'IA
          sont, dans toute la mesure du possible, pseudonymisés ou anonymisés avant transmission.
        </Warn>

        <H2>10.2 Absence de décision automatisée à portée significative</H2>
        <P>
          Mimmoza n'effectue pas de traitement automatisé des données personnelles aboutissant
          à une décision produisant des effets juridiques significatifs ou affectant de manière
          similaire l'Utilisateur à titre individuel (ex. : refus d'accès à un crédit, notation
          de crédit, évaluation discriminatoire). Le SmartScore est un indicateur informatif et
          ne constitue pas une décision automatisée au sens de l'article 22 du RGPD.
        </P>

        <H2>10.3 Profilage</H2>
        <P>
          Mimmoza peut réaliser des traitements de profilage à des fins d'amélioration du
          Service (personnalisation de l'interface, suggestions de fonctionnalités) sur la base
          de l'intérêt légitime ou du consentement de l'Utilisateur. Ces traitements ne
          produisent pas de décisions automatisées à portée significative. L'Utilisateur peut
          s'y opposer à tout moment en contactant le DPO.
        </P>
      </>
    ),
  },

  // ── ART. 11
  {
    id: "art11",
    num: "Article 11",
    title: "Mineurs",
    content: (
      <>
        <P>
          La Plateforme Mimmoza est destinée à des professionnels et à des adultes. Elle n'est
          pas conçue pour être utilisée par des personnes âgées de moins de dix-huit (18) ans.
          Mimmoza ne collecte pas sciemment de données personnelles relatives à des mineurs.
        </P>
        <P>
          Si Mimmoza venait à apprendre qu'elle a collecté des données personnelles d'un mineur
          sans le consentement de son représentant légal, elle s'engage à supprimer ces données
          dans les meilleurs délais. Tout représentant légal d'un mineur dont les données
          auraient été collectées par erreur est invité à contacter Mimmoza à{" "}
          <a href="mailto:dpo@mimmoza.fr" className="text-[#2E7D9A] underline">
            dpo@mimmoza.fr
          </a>
          .
        </P>
      </>
    ),
  },

  // ── ART. 12
  {
    id: "art12",
    num: "Article 12",
    title: "Mise à jour de la Politique de Confidentialité",
    content: (
      <>
        <P>
          Mimmoza se réserve le droit de modifier la présente Politique de Confidentialité à
          tout moment, notamment pour tenir compte des évolutions législatives et
          réglementaires, des nouvelles fonctionnalités de la Plateforme, ou des
          recommandations de la CNIL.
        </P>
        <P>
          En cas de modification substantielle — c'est-à-dire susceptible d'affecter
          significativement les droits des Utilisateurs ou les conditions de traitement de
          leurs données — Mimmoza informera les Utilisateurs par voie électronique (e-mail
          et/ou notification sur la Plateforme) avec un préavis raisonnable avant l'entrée en
          vigueur des modifications.
        </P>
        <P>
          La date de dernière mise à jour figure en bas de la présente Politique. La version
          applicable est celle en vigueur à la date de l'utilisation de la Plateforme. La
          poursuite de l'utilisation de la Plateforme après la prise d'effet des modifications
          vaut acceptation de la Politique de Confidentialité révisée.
        </P>
        <Info>
          L'historique des versions de la Politique de Confidentialité est disponible sur
          demande auprès du DPO.
        </Info>
      </>
    ),
  },

  // ── ART. 13
  {
    id: "art13",
    num: "Article 13",
    title: "Droit applicable et juridiction",
    content: (
      <>
        <P>
          La présente Politique de Confidentialité est soumise au droit français et au droit de
          l'Union européenne, en particulier au Règlement (UE) 2016/679 (RGPD) et à la loi
          Informatique et Libertés du 6 janvier 1978 modifiée.
        </P>
        <P>
          Tout litige relatif à son interprétation ou à son application sera soumis, à défaut
          de résolution amiable, à la compétence des juridictions françaises compétentes, sous
          réserve des règles impératives applicables aux Utilisateurs consommateurs résidant
          dans un autre État membre de l'Union européenne.
        </P>
        <P>
          L'Utilisateur dispose en tout état de cause du droit d'introduire une réclamation
          auprès de la CNIL (Commission Nationale de l'Informatique et des Libertés —
          www.cnil.fr) ou de toute autre autorité de contrôle compétente dans son État de
          résidence.
        </P>
      </>
    ),
  },
];

// ─── TOC avec suivi actif ─────────────────────────────────────────────────────

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

const PolitiqueConfidentialitePage: React.FC = () => {
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
          <h1 className="text-2xl font-bold mb-1">Politique de Confidentialité</h1>
          <p className="text-sm text-blue-200">
            Version en vigueur à compter du 13 avril 2026
          </p>
          <p className="text-xs text-blue-300 mt-1">
            Conforme au Règlement (UE) 2016/679 (RGPD) et à la loi Informatique et Libertés
          </p>
        </div>
      </div>

      {/* ── Bandeau info ── */}
      <div className="bg-[#2E7D9A]/10 border-b border-[#2E7D9A]/20 px-6 py-2">
        <div className="max-w-6xl mx-auto flex flex-wrap gap-4 items-center text-xs text-[#1A3C5E]">
          <span>🔒 13 articles – RGPD conforme</span>
          <span className="text-gray-300">|</span>
          <span>
            DPO :{" "}
            <a href="mailto:dpo@mimmoza.fr" className="text-[#2E7D9A] underline">
              dpo@mimmoza.fr
            </a>
          </span>
          <span className="text-gray-300">|</span>
          <span>
            Hébergement des données : Union européenne
          </span>
          <span className="text-gray-300">|</span>
          <span>Aucune vente de données à des tiers</span>
        </div>
      </div>

      {/* ── Corps ── */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex gap-6 items-start">
          {/* Sidebar TOC desktop */}
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
                Dernière mise à jour : 13 avril 2026 &nbsp;·&nbsp;
                <a href="mailto:dpo@mimmoza.fr" className="hover:text-[#2E7D9A] transition-colors">
                  dpo@mimmoza.fr
                </a>{" "}
                –{" "}
                <a
                  href="https://www.mimmoza.fr"
                  className="hover:text-[#2E7D9A] transition-colors"
                >
                  www.mimmoza.fr
                </a>
              </p>
              <p className="italic">
                Ce document a été rédigé à titre indicatif et doit être relu par un avocat
                spécialisé en droit des données personnelles avant toute mise en ligne.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PolitiqueConfidentialitePage;