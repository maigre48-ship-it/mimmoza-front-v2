import React from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Section {
  id: string;
  title: string;
  articles: Article[];
}

interface Article {
  id: string;
  num: string;
  title: string;
  content: React.ReactNode;
}

// ─── Composants internes ──────────────────────────────────────────────────────

const Warn: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="my-4 border-l-4 border-red-700 bg-red-50 px-4 py-3 rounded-r-md">
    <p className="text-sm font-semibold text-red-800 leading-relaxed">
      ⚠&nbsp;&nbsp;{children}
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

const UL: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ul className="list-none space-y-1.5 mb-3 ml-2">{children}</ul>
);

const LI: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="flex gap-2 text-sm text-gray-700 leading-relaxed text-justify">
    <span className="text-[#2E7D9A] mt-0.5 flex-shrink-0">–</span>
    <span>{children}</span>
  </li>
);

// ─── Contenu des articles ─────────────────────────────────────────────────────

const articles: Article[] = [
  // ── ART. 1
  {
    id: "art1",
    num: "Article 1",
    title: "Objet",
    content: (
      <>
        <P>
          Les présentes Conditions Générales de Vente (ci-après « CGV ») régissent l'ensemble des
          relations contractuelles entre la société Mimmoza SAS, société par actions simplifiée au
          capital de [●] euros, immatriculée au Registre du Commerce et des Sociétés de [●] sous
          le numéro [●], dont le siège social est situé [adresse], représentée par son Président
          (ci-après « Mimmoza » ou « l'Éditeur »), et toute personne physique ou morale, agissant
          à titre professionnel ou non, souscrivant un abonnement ou utilisant la plateforme en
          ligne Mimmoza (ci-après « l'Utilisateur »).
        </P>
        <P>
          Les présentes CGV constituent le socle unique de la relation commerciale entre les
          parties. Toute utilisation de la plateforme, y compris à titre d'essai, emporte
          acceptation pleine et entière des présentes CGV. En cas de contradiction entre les CGV et
          tout autre document émanant de l'Utilisateur, les CGV prévalent.
        </P>
        <P>
          Mimmoza se réserve le droit de modifier les présentes CGV à tout moment. La version
          applicable est celle en vigueur à la date d'utilisation du service. Toute modification
          substantielle sera notifiée à l'Utilisateur par voie électronique avec un préavis minimum
          de trente (30) jours. La poursuite de l'utilisation du service après ce délai vaut
          acceptation des nouvelles CGV.
        </P>
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
        <P>Aux fins des présentes CGV, les termes ci-après ont la signification suivante :</P>
        <UL>
          <LI>
            <strong>« Plateforme »</strong> : le logiciel en ligne Mimmoza, accessible par
            navigateur internet et/ou application mobile, comprenant l'ensemble de ses
            fonctionnalités, modules et interfaces.
          </LI>
          <LI>
            <strong>« Service »</strong> : l'ensemble des fonctionnalités mises à disposition de
            l'Utilisateur dans le cadre de son abonnement, telles que décrites à l'article 3.
          </LI>
          <LI>
            <strong>« Utilisateur »</strong> : toute personne physique ou morale ayant créé un
            compte sur la Plateforme et accepté les présentes CGV.
          </LI>
          <LI>
            <strong>« Abonnement »</strong> : le contrat à durée déterminée ou indéterminée par
            lequel l'Utilisateur accède au Service moyennant le paiement d'un prix convenu.
          </LI>
          <LI>
            <strong>« SmartScore »</strong> : un indicateur synthétique, propriétaire et
            algorithmique, généré par Mimmoza à partir de données multisources, visant à donner une
            appréciation relative d'un bien ou d'un projet immobilier.
          </LI>
          <LI>
            <strong>« Données DVF »</strong> : les données de la base « Demandes de Valeurs
            Foncières » publiée par la Direction Générale des Finances Publiques (DGFiP), accessible
            en open data et intégrée à la Plateforme.
          </LI>
          <LI>
            <strong>« Données Tierces »</strong> : toute donnée provenant d'une source externe à
            Mimmoza, notamment les APIs publiques ou privées, bases de données INSEE, PLU, BPE,
            FINESS, flux cartographiques, et tout autre jeu de données non produit directement par
            Mimmoza.
          </LI>
          <LI>
            <strong>« Rendu Visuel »</strong> : toute projection architecturale, image de façade,
            modélisation volumétrique ou représentation tridimensionnelle générée par la Plateforme,
            que ce soit par des algorithmes paramétriques ou par des outils d'intelligence
            artificielle.
          </LI>
          <LI>
            <strong>« Contenu Généré par l'IA »</strong> : tout texte, analyse, synthèse, rapport,
            ou autre production textuelle ou multimédia générée automatiquement par des modèles
            d'intelligence artificielle intégrés à la Plateforme.
          </LI>
          <LI>
            <strong>« Compte »</strong> : l'espace personnel de l'Utilisateur sur la Plateforme,
            protégé par des identifiants de connexion.
          </LI>
        </UL>
      </>
    ),
  },

  // ── ART. 3
  {
    id: "art3",
    num: "Article 3",
    title: "Description du service",
    content: (
      <>
        <P>
          Mimmoza est une plateforme SaaS (Software as a Service) d'analyse et d'intelligence
          immobilière destinée à des professionnels et à des particuliers souhaitant disposer
          d'outils d'aide à la décision dans le domaine de l'immobilier. La Plateforme propose
          notamment, selon la formule d'abonnement souscrite, les modules et fonctionnalités
          suivants :
        </P>

        <H2>3.1 Analyse de biens immobiliers</H2>
        <UL>
          <LI>
            Estimation indicative de valeur vénale d'un bien immobilier, basée sur des données de
            transactions récentes et des modèles algorithmiques.
          </LI>
          <LI>
            Calcul de rentabilité locative brute et nette, sur la base des paramètres renseignés
            par l'Utilisateur.
          </LI>
          <LI>
            Analyse de marché local : tendances de prix, volumes de transactions, indicateurs de
            tension locative.
          </LI>
        </UL>
        <Warn>
          Ces analyses constituent des estimations à titre informatif. Elles ne constituent pas une
          expertise immobilière au sens légal du terme et ne sauraient engager la responsabilité de
          Mimmoza quant à la valeur réelle d'un bien.
        </Warn>

        <H2>3.2 SmartScore</H2>
        <UL>
          <LI>
            Le SmartScore est un indicateur synthétique propriétaire visant à agréger plusieurs
            critères d'analyse (localisation, marché, accessibilité, potentiel locatif, risques,
            etc.) en un score unique.
          </LI>
          <LI>
            Le SmartScore est calculé à partir de données multisources pouvant comporter des
            lacunes ou des inexactitudes.
          </LI>
        </UL>
        <Warn>
          Le SmartScore est un indicateur informatif et relatif. Il ne constitue en aucun cas un
          conseil en investissement, une recommandation d'achat ou de vente, ni une garantie de
          performance financière. Son utilisation isolée pour prendre une décision d'investissement
          est déconseillée et relève de l'entière responsabilité de l'Utilisateur.
        </Warn>

        <H2>3.3 Études de faisabilité promoteur</H2>
        <UL>
          <LI>
            Analyse foncière : identification du potentiel d'un terrain, vérification de la
            constructibilité à partir des données cadastrales et cartographiques disponibles.
          </LI>
          <LI>
            Lecture assistée des règles d'urbanisme (PLU) : extraction et synthèse automatisée des
            règles applicables à une zone donnée.
          </LI>
          <LI>
            Calcul du potentiel constructible : estimation des surfaces de plancher et gabarits
            admissibles selon les paramètres PLU identifiés.
          </LI>
        </UL>
        <Warn>
          Les études de faisabilité produites par la Plateforme sont des analyses préliminaires à
          titre indicatif. Elles ne constituent pas des études techniques ou juridiques opposables,
          et ne sauraient se substituer à la consultation d'un architecte, d'un géomètre-expert,
          d'un juriste en droit de l'urbanisme ou d'un service instructeur.
        </Warn>

        <H2>3.4 Génération de rendus visuels</H2>
        <UL>
          <LI>
            Projection de façades architecturales générées algorithmiquement ou par intelligence
            artificielle.
          </LI>
          <LI>Modélisation volumétrique et études de gabarits en trois dimensions.</LI>
          <LI>Projections architecturales à titre illustratif.</LI>
        </UL>
        <Warn>
          Les rendus visuels générés par la Plateforme sont strictement indicatifs et non
          contractuels. Ils ne constituent pas des plans d'architecte, des documents techniques, ni
          des pièces pouvant être déposées dans le cadre d'une demande de permis de construire ou
          de toute autre procédure administrative. Voir article 9.
        </Warn>

        <H2>3.5 Génération de contenu</H2>
        <UL>
          <LI>
            Rédaction automatisée de textes d'analyse, de synthèses, de posts de communication ou
            de rapports à partir des données disponibles.
          </LI>
          <LI>Production de contenus marketing (vidéos, visuels) à des fins de communication.</LI>
        </UL>
        <Warn>
          Tout contenu généré automatiquement par des modèles d'intelligence artificielle peut
          contenir des erreurs, omissions ou inexactitudes. L'Utilisateur est seul responsable de
          la vérification, de la validation et de l'usage de ces contenus.
        </Warn>

        <H2>3.6 Évolution du service</H2>
        <P>
          Mimmoza se réserve le droit, à tout moment et sans préavis, de faire évoluer, modifier,
          suspendre ou supprimer tout ou partie des fonctionnalités de la Plateforme, notamment
          pour des raisons techniques, légales ou commerciales. Ces modifications ne sauront
          constituer un manquement contractuel de la part de Mimmoza, sauf à ce qu'elles affectent
          substantiellement l'objet principal de l'abonnement souscrit.
        </P>
      </>
    ),
  },

  // ── ART. 4
  {
    id: "art4",
    num: "Article 4",
    title: "Accès au service",
    content: (
      <>
        <H2>4.1 Création du compte</H2>
        <P>
          L'accès au Service est conditionné à la création d'un Compte par l'Utilisateur, au moyen
          d'une adresse électronique valide et d'un mot de passe personnel. L'Utilisateur garantit
          que les informations fournies lors de son inscription sont exactes, complètes et à jour.
          Toute fausse déclaration entraîne la résiliation immédiate du compte.
        </P>

        <H2>4.2 Sécurité des accès</H2>
        <P>
          L'Utilisateur est seul responsable de la confidentialité de ses identifiants de
          connexion. Toute utilisation du Service depuis son Compte est réputée effectuée par
          l'Utilisateur lui-même, sauf preuve contraire. L'Utilisateur s'engage à notifier sans
          délai Mimmoza en cas d'accès non autorisé à son Compte.
        </P>

        <H2>4.3 Conditions techniques</H2>
        <P>
          L'accès au Service nécessite une connexion internet. La Plateforme est optimisée pour les
          navigateurs web modernes (Chrome, Firefox, Safari, Edge dans leurs versions à jour).
          Mimmoza ne garantit pas la compatibilité avec l'ensemble des environnements techniques
          des Utilisateurs.
        </P>

        <H2>4.4 Disponibilité</H2>
        <P>
          Mimmoza s'engage à maintenir la Plateforme accessible 24h/24 et 7j/7, sous réserve des
          opérations de maintenance, des événements de force majeure, et de toute circonstance hors
          du contrôle de Mimmoza. Des interruptions planifiées pourront survenir, de préférence
          hors des heures ouvrées, et seront annoncées dans les meilleurs délais. Mimmoza ne
          saurait être tenue responsable des conséquences d'une indisponibilité technique sur
          l'activité de l'Utilisateur.
        </P>
      </>
    ),
  },

  // ── ART. 5
  {
    id: "art5",
    num: "Article 5",
    title: "Conditions d'utilisation",
    content: (
      <>
        <H2>5.1 Usage autorisé</H2>
        <P>
          Le Service est mis à disposition de l'Utilisateur à titre personnel et non exclusif.
          L'Utilisateur est autorisé à utiliser la Plateforme dans le cadre de ses activités
          professionnelles ou personnelles, dans les limites définies par son abonnement et les
          présentes CGV.
        </P>

        <H2>5.2 Usages interdits</H2>
        <P>L'Utilisateur s'interdit notamment de :</P>
        <UL>
          <LI>
            Revendre, sous-licencier, louer ou mettre à disposition la Plateforme à des tiers sans
            autorisation préalable écrite de Mimmoza.
          </LI>
          <LI>
            Accéder à la Plateforme par des moyens automatisés (scraping, robots, scripts) sans
            autorisation préalable.
          </LI>
          <LI>
            Reproduire, copier ou extraire de manière massive les données et contenus de la
            Plateforme.
          </LI>
          <LI>
            Tenter de décompiler, désassembler ou rétroingéniérer tout ou partie de la Plateforme.
          </LI>
          <LI>
            Utiliser le Service à des fins illicites, frauduleuses ou contraires aux droits de
            tiers.
          </LI>
          <LI>
            Charger ou diffuser tout contenu illicite, diffamatoire, pornographique, violent ou
            portant atteinte aux droits des tiers.
          </LI>
          <LI>
            Perturber le bon fonctionnement de la Plateforme ou introduire des virus, codes
            malveillants ou tout élément nuisible.
          </LI>
        </UL>

        <H2>5.3 Respect du droit applicable</H2>
        <P>
          L'Utilisateur s'engage à utiliser le Service dans le strict respect des lois et
          réglementations en vigueur, notamment en matière de droit de l'urbanisme, de
          réglementation immobilière, de protection des données personnelles (RGPD) et de toute
          autre règle applicable à son activité.
        </P>
      </>
    ),
  },

  // ── ART. 6
  {
    id: "art6",
    num: "Article 6",
    title: "Abonnement et paiement",
    content: (
      <>
        <H2>6.1 Formules d'abonnement</H2>
        <P>
          Mimmoza propose plusieurs formules d'abonnement, dont le détail (fonctionnalités
          incluses, durée, tarification) est présenté sur la page tarifaire de la Plateforme,
          laquelle fait partie intégrante du contrat. Les offres sont susceptibles d'évoluer ; les
          conditions en vigueur à la date de souscription sont celles applicables à l'Abonnement
          en cours.
        </P>

        <H2>6.2 Paiement</H2>
        <P>
          Le paiement est effectué en euros, par carte bancaire ou tout autre moyen de paiement
          proposé par Mimmoza, via un prestataire de services de paiement sécurisé. Les
          informations bancaires de l'Utilisateur ne sont pas stockées par Mimmoza. Les abonnements
          sont facturés à terme à échoir (paiement en début de période).
        </P>

        <H2>6.3 Renouvellement et résiliation</H2>
        <P>
          Sauf mention contraire, les abonnements sont à renouvellement automatique. L'Utilisateur
          peut résilier son abonnement avant la date de renouvellement depuis son espace de gestion
          de compte. Aucun remboursement n'est dû pour la période en cours au moment de la
          résiliation, sauf disposition légale contraire.
        </P>

        <H2>6.4 Défaut de paiement</H2>
        <P>
          En cas de défaut de paiement, Mimmoza se réserve le droit de suspendre l'accès au
          Service après mise en demeure restée infructueuse pendant quarante-huit (48) heures, puis
          de résilier le contrat si le défaut persiste au-delà de quinze (15) jours. Des pénalités
          de retard pourront être appliquées au taux légal en vigueur.
        </P>

        <H2>6.5 Modification tarifaire</H2>
        <P>
          Mimmoza se réserve le droit de modifier ses tarifs. Toute modification tarifaire sera
          notifiée à l'Utilisateur au moins trente (30) jours avant son entrée en vigueur. À défaut
          d'opposition dans ce délai, la modification sera réputée acceptée. En cas de refus,
          l'Utilisateur pourra résilier son abonnement sans frais avant la date d'effet.
        </P>
      </>
    ),
  },

  // ── ART. 7
  {
    id: "art7",
    num: "Article 7",
    title: "Données et fiabilité",
    content: (
      <>
        <H2>7.1 Nature et origine des données</H2>
        <P>
          La Plateforme exploite des données provenant de sources multiples et hétérogènes :
          données de la base DVF (Demandes de Valeurs Foncières) publiée par la DGFiP, données
          INSEE, bases PLU numérisées, flux d'APIs tierces, données cadastrales, bases de
          référencement des équipements publics (BPE, FINESS), et toute autre source disponible.
          Ces données sont mises à disposition par leurs producteurs respectifs et Mimmoza n'en est
          pas l'auteur.
        </P>

        <H2>7.2 Absence de garantie sur les données</H2>
        <Warn>
          Mimmoza ne garantit pas l'exactitude, l'exhaustivité, l'actualité ni la complétude des
          données utilisées par la Plateforme. Les Données DVF, les Données Tierces et toute autre
          donnée externe peuvent être incomplètes, erronées, périmées ou non représentatives de la
          réalité du marché au moment de la consultation.
        </Warn>
        <P>L'Utilisateur reconnaît que :</P>
        <UL>
          <LI>
            Les données de transactions immobilières (DVF) peuvent ne pas refléter les conditions
            réelles du marché actuel.
          </LI>
          <LI>
            Les données d'équipements (BPE, FINESS, transports) peuvent être incomplètes ou non
            mises à jour.
          </LI>
          <LI>
            Les règles d'urbanisme (PLU) intégrées à la Plateforme peuvent différer des documents
            officiels en vigueur, notamment en cas de révision ou de modification récente.
          </LI>
          <LI>
            Tout calcul ou analyse réalisé par la Plateforme est fondé sur ces données et en
            reproduit les éventuelles imperfections.
          </LI>
        </UL>

        <H2>7.3 Obligation de vérification</H2>
        <P>
          L'Utilisateur est tenu de vérifier par lui-même, ou par le biais de professionnels
          qualifiés, l'exactitude de toute donnée ou analyse fournie par la Plateforme avant de
          prendre toute décision à caractère financier, juridique, technique ou commercial. La
          Plateforme n'a vocation qu'à fournir une première approche indicative, et non à se
          substituer à une analyse professionnelle approfondie.
        </P>
      </>
    ),
  },

  // ── ART. 8
  {
    id: "art8",
    num: "Article 8",
    title: "Intelligence artificielle et automatisation",
    content: (
      <>
        <H2>8.1 Recours à l'intelligence artificielle</H2>
        <P>
          Plusieurs fonctionnalités de la Plateforme reposent sur des modèles d'intelligence
          artificielle (IA) et d'apprentissage automatique, notamment pour la génération de textes
          analytiques, la production de rendus visuels, le calcul du SmartScore et l'extraction de
          règles d'urbanisme. Ces modèles sont entraînés sur des données historiques et produisent
          des résultats probabilistes, non certains.
        </P>

        <H2>8.2 Limites inhérentes à l'IA</H2>
        <P>L'Utilisateur reconnaît et accepte expressément que :</P>
        <UL>
          <LI>
            Les Contenus Générés par l'IA peuvent contenir des erreurs factuelles, des
            approximations, des incohérences ou des biais involontaires.
          </LI>
          <LI>
            Les modèles d'IA peuvent produire des résultats différents pour des paramètres
            identiques ou similaires.
          </LI>
          <LI>
            L'IA ne dispose pas d'une compréhension contextuelle ou juridique équivalente à celle
            d'un professionnel humain qualifié.
          </LI>
          <LI>
            Les performances des modèles d'IA peuvent se dégrader dans des contextes géographiques,
            sectoriels ou réglementaires peu représentés dans les données d'entraînement.
          </LI>
        </UL>

        <H2>8.3 Nécessité d'une validation humaine</H2>
        <Warn>
          Tout Contenu Généré par l'IA doit impérativement être vérifié, corrigé et validé par
          l'Utilisateur ou par un professionnel compétent avant tout usage professionnel,
          commercial, juridique ou public. L'Utilisateur est seul responsable de l'usage qu'il
          fait des contenus générés automatiquement par la Plateforme.
        </Warn>

        <H2>8.4 Absence de conseil</H2>
        <P>
          Les analyses, synthèses, scores et recommandations produits par les modèles d'IA intégrés
          à la Plateforme ne constituent en aucun cas des conseils en investissement au sens de la
          réglementation financière, des conseils juridiques, des expertises immobilières ou des
          conseils en urbanisme. L'Utilisateur ne saurait se prévaloir de ces productions pour
          engager une quelconque responsabilité de Mimmoza.
        </P>
      </>
    ),
  },

  // ── ART. 9
  {
    id: "art9",
    num: "Article 9",
    title: "Rendus visuels",
    content: (
      <>
        <H2>9.1 Nature des rendus</H2>
        <P>
          La Plateforme permet la génération de représentations visuelles de projets immobiliers,
          incluant notamment des projections de façades, des modélisations volumétriques et des
          études de gabarits en trois dimensions. Ces rendus sont produits de manière automatisée,
          à partir de paramètres renseignés par l'Utilisateur et de données disponibles sur la
          Plateforme.
        </P>

        <H2>9.2 Caractère strictement indicatif</H2>
        <Warn>
          Les Rendus Visuels générés par Mimmoza sont strictement indicatifs, non contractuels et
          ne sauraient être considérés comme des documents techniques, des plans d'architecte ou
          des documents à valeur réglementaire.
        </Warn>
        <P>En particulier, les Rendus Visuels :</P>
        <UL>
          <LI>
            Ne constituent pas des plans architecturaux au sens de la loi sur l'architecture du
            3 janvier 1977.
          </LI>
          <LI>
            Ne peuvent en aucun cas être joints à une demande de permis de construire, de
            déclaration préalable de travaux ou à toute autre procédure administrative relative à
            l'urbanisme.
          </LI>
          <LI>
            Ne garantissent pas la conformité d'un projet avec les règles d'urbanisme applicables
            (PLU, règlement de zone, servitudes, etc.).
          </LI>
          <LI>
            Ne tiennent pas compte de l'ensemble des contraintes techniques, structurelles,
            géotechniques ou réglementaires d'un projet de construction réel.
          </LI>
          <LI>
            Peuvent présenter des approximations visuelles non représentatives des matériaux,
            finitions ou dimensions réelles.
          </LI>
        </UL>

        <H2>9.3 Usage autorisé des rendus</H2>
        <P>
          Les Rendus Visuels peuvent être utilisés à titre illustratif, notamment pour des
          présentations internes, des communications commerciales préliminaires ou des études de
          préfaisabilité. Ils ne sauraient en aucune circonstance constituer un engagement de
          Mimmoza quant à la faisabilité technique, architecturale ou administrative d'un projet.
        </P>

        <H2>9.4 Responsabilité exclusive de l'Utilisateur</H2>
        <P>
          Tout usage d'un Rendu Visuel à des fins professionnelles, commerciales, juridiques ou
          administratives relève de l'entière responsabilité de l'Utilisateur. Mimmoza décline
          toute responsabilité en cas d'utilisation d'un Rendu Visuel en dehors du cadre
          strictement indicatif défini ci-dessus.
        </P>
      </>
    ),
  },

  // ── ART. 10
  {
    id: "art10",
    num: "Article 10",
    title: "Responsabilité",
    content: (
      <>
        <H2>10.1 Outil d'aide à la décision exclusivement</H2>
        <Warn>
          Mimmoza est un outil d'aide à la décision et non un prestataire de conseil. La Plateforme
          ne fournit ni conseil en investissement au sens du Code monétaire et financier, ni conseil
          juridique, ni expertise immobilière, ni conseil en urbanisme, ni aucune prestation
          susceptible d'engager une responsabilité professionnelle réglementée.
        </Warn>
        <P>L'Utilisateur reconnaît expressément que :</P>
        <UL>
          <LI>
            Toute décision d'investissement, d'acquisition, de cession, de construction ou de toute
            autre nature prise sur le fondement des analyses, scores, rendus ou contenus fournis
            par la Plateforme l'est sous sa seule et entière responsabilité.
          </LI>
          <LI>
            La Plateforme ne remplace en aucun cas la consultation préalable d'un professionnel
            qualifié (notaire, expert immobilier, architecte, avocat, conseiller financier,
            urbaniste, etc.).
          </LI>
          <LI>
            Mimmoza ne saurait être tenue responsable des conséquences, directes ou indirectes, de
            toute décision prise par l'Utilisateur sur la base des informations disponibles sur la
            Plateforme.
          </LI>
        </UL>

        <H2>10.2 Absence de garantie de rentabilité</H2>
        <Warn>
          Mimmoza ne garantit, n'assure et ne promet en aucune circonstance un quelconque gain
          financier, une performance d'investissement, un rendement locatif ou une plus-value
          immobilière. Les projections financières présentées sur la Plateforme sont des simulations
          basées sur des hypothèses paramétrables qui ne reflètent pas nécessairement les conditions
          réelles du marché.
        </Warn>

        <H2>10.3 Responsabilité relative aux données</H2>
        <P>
          Mimmoza ne saurait être tenue responsable des erreurs, lacunes, inexactitudes ou retards
          affectant les Données DVF, les Données Tierces ou toute autre source de données utilisée
          par la Plateforme. La responsabilité de Mimmoza ne pourra être engagée du fait de
          l'inexactitude ou de l'absence de mise à jour de ces données.
        </P>

        <H2>10.4 Responsabilité relative aux services tiers</H2>
        <P>
          La Plateforme peut intégrer ou se connecter à des services tiers (APIs, fournisseurs de
          données, services cartographiques, modèles d'IA externes). Mimmoza n'est pas responsable
          des défaillances, indisponibilités, erreurs ou modifications de ces services tiers, qui
          sont susceptibles d'affecter le fonctionnement ou les résultats de la Plateforme.
        </P>

        <H2>10.5 Indisponibilité technique</H2>
        <P>
          Mimmoza ne saurait être tenue responsable des préjudices résultant d'une interruption,
          d'une lenteur ou d'un dysfonctionnement de la Plateforme, qu'ils soient imputables à des
          opérations de maintenance, à une défaillance technique, à un acte de cybersécurité, à une
          panne de fournisseur d'accès ou à tout autre événement indépendant de sa volonté.
        </P>
      </>
    ),
  },

  // ── ART. 11
  {
    id: "art11",
    num: "Article 11",
    title: "Limitation de responsabilité",
    content: (
      <>
        <H2>11.1 Exclusion des dommages indirects</H2>
        <Warn>
          Dans toute la mesure permise par le droit applicable, Mimmoza exclut toute responsabilité
          pour les dommages indirects, accessoires, spéciaux, punitifs ou consécutifs, y compris et
          sans limitation : pertes financières, manque à gagner, perte de chance, perte de données,
          préjudice commercial, préjudice d'image ou toute autre perte économique, résultant de
          l'utilisation ou de l'impossibilité d'utiliser la Plateforme, des analyses et contenus
          fournis par celle-ci, ou de toute décision prise par l'Utilisateur sur leur fondement.
        </Warn>

        <H2>11.2 Plafonnement de responsabilité</H2>
        <P>
          En tout état de cause, dans l'hypothèse où la responsabilité de Mimmoza serait retenue
          par une juridiction compétente, le montant total des dommages et intérêts pouvant être
          mis à la charge de Mimmoza est expressément plafonné au montant total des sommes
          effectivement payées par l'Utilisateur à Mimmoza au cours des douze (12) mois précédant
          le fait générateur du dommage.
        </P>

        <H2>11.3 Cas d'exclusion totale</H2>
        <P>La responsabilité de Mimmoza ne saurait être engagée en cas de :</P>
        <UL>
          <LI>
            Décisions d'investissement ou transactions immobilières prises sur le fondement des
            analyses ou scores de la Plateforme.
          </LI>
          <LI>
            Utilisation des Rendus Visuels dans le cadre de procédures administratives ou permis
            de construire.
          </LI>
          <LI>
            Erreurs contenues dans les Contenus Générés par l'IA utilisés sans validation humaine
            préalable.
          </LI>
          <LI>
            Inexactitude ou obsolescence des données externes intégrées à la Plateforme.
          </LI>
          <LI>
            Perte ou corruption des données de l'Utilisateur résultant d'un événement hors du
            contrôle raisonnable de Mimmoza.
          </LI>
          <LI>Utilisation de la Plateforme non conforme aux présentes CGV.</LI>
        </UL>

        <H2>11.4 Champ d'application</H2>
        <P>
          Les limitations de responsabilité prévues au présent article s'appliquent quelle que soit
          la nature de l'action engagée (contractuelle, délictuelle, quasi-délictuelle ou autre),
          même si Mimmoza a été informée de la possibilité de tels dommages, et même si les remèdes
          prévus manquent à leur objectif essentiel.
        </P>
        <P>
          Certaines juridictions n'autorisant pas l'exclusion ou la limitation de responsabilité
          pour les dommages consécutifs ou indirects, les limitations ci-dessus peuvent ne pas
          s'appliquer dans la mesure prévue par la loi applicable.
        </P>
      </>
    ),
  },

  // ── ART. 12
  {
    id: "art12",
    num: "Article 12",
    title: "Obligations de l'Utilisateur",
    content: (
      <>
        <H2>12.1 Obligations générales</H2>
        <P>L'Utilisateur s'engage à :</P>
        <UL>
          <LI>Utiliser la Plateforme conformément à sa destination et aux présentes CGV.</LI>
          <LI>Maintenir à jour ses informations de compte (coordonnées, informations de facturation).</LI>
          <LI>Ne pas partager ses identifiants de connexion avec des tiers non autorisés.</LI>
          <LI>Respecter les droits de propriété intellectuelle de Mimmoza et des tiers.</LI>
          <LI>Ne pas utiliser la Plateforme à des fins illicites ou contraires à l'ordre public.</LI>
        </UL>

        <H2>12.2 Obligation de vérification professionnelle</H2>
        <Warn>
          L'Utilisateur agissant dans un contexte professionnel (investisseur, marchand de biens,
          promoteur, agent immobilier, conseiller financier, banquier, etc.) reconnaît expressément
          qu'il dispose des compétences professionnelles nécessaires pour apprécier la portée et
          les limites des analyses fournies par la Plateforme. Il lui appartient, avant toute
          décision engageant des fonds ou des droits de tiers, de compléter les analyses de la
          Plateforme par ses propres vérifications ou par le recours à des experts qualifiés.
        </Warn>

        <H2>12.3 Exactitude des informations saisies</H2>
        <P>
          L'Utilisateur est seul responsable de l'exactitude des informations et paramètres qu'il
          saisit dans la Plateforme. Les analyses et calculs produits par la Plateforme étant fondés
          sur ces paramètres, Mimmoza ne saurait être responsable d'analyses erronées résultant
          d'informations inexactes ou incomplètes fournies par l'Utilisateur.
        </P>

        <H2>12.4 Usage des contenus générés</H2>
        <P>
          L'Utilisateur qui publie, diffuse ou transmet à des tiers tout contenu généré par la
          Plateforme (analyses, rendus, textes, scores) s'engage à le présenter comme un contenu
          indicatif, à préciser son origine automatisée le cas échéant, et à ne pas lui conférer
          une valeur contractuelle ou opposable qu'il n'a pas.
        </P>
      </>
    ),
  },

  // ── ART. 13
  {
    id: "art13",
    num: "Article 13",
    title: "Propriété intellectuelle",
    content: (
      <>
        <H2>13.1 Droits de Mimmoza</H2>
        <P>
          La Plateforme, son code source, ses interfaces, ses algorithmes (incluant le SmartScore),
          ses modèles d'IA, ses bases de données propres, ses contenus éditoriaux, sa marque et
          son identité visuelle sont la propriété exclusive de Mimmoza ou de ses concédants, et
          sont protégés par les droits de propriété intellectuelle applicables (droit d'auteur,
          droits sui generis des bases de données, brevets le cas échéant, marques). Toute
          reproduction, représentation ou exploitation non autorisée est interdite et susceptible
          de constituer une contrefaçon.
        </P>

        <H2>13.2 Licence d'utilisation</H2>
        <P>
          Mimmoza concède à l'Utilisateur une licence personnelle, non exclusive, non transférable
          et révocable d'utilisation de la Plateforme, strictement limitée à l'usage prévu par
          l'Abonnement souscrit, pour la durée de celui-ci. Cette licence ne confère à l'Utilisateur
          aucun droit de propriété sur la Plateforme ou ses composants.
        </P>

        <H2>13.3 Contenus de l'Utilisateur</H2>
        <P>
          L'Utilisateur conserve la propriété des données et informations qu'il saisit sur la
          Plateforme. Il concède à Mimmoza une licence non exclusive, mondiale et gratuite
          d'utilisation de ces données aux fins d'exécution du Service et, sous réserve
          d'anonymisation, d'amélioration de la Plateforme. Mimmoza s'engage à ne pas communiquer
          à des tiers les données individualisées de l'Utilisateur sans son consentement préalable.
        </P>

        <H2>13.4 Contenus générés</H2>
        <P>
          Les contenus générés par la Plateforme à la demande de l'Utilisateur (analyses, textes,
          rendus) sont mis à disposition de l'Utilisateur dans le cadre de son abonnement. Mimmoza
          se réserve le droit de les utiliser à des fins d'amélioration de ses algorithmes et
          modèles, sous forme anonymisée et agrégée.
        </P>
      </>
    ),
  },

  // ── ART. 14
  {
    id: "art14",
    num: "Article 14",
    title: "Données personnelles",
    content: (
      <>
        <H2>14.1 Traitement des données</H2>
        <P>
          Mimmoza traite les données personnelles de l'Utilisateur en qualité de responsable de
          traitement, conformément au Règlement (UE) 2016/679 du 27 avril 2016 (RGPD) et à la loi
          Informatique et Libertés du 6 janvier 1978 modifiée. Les traitements mis en œuvre, leurs
          finalités, leur durée de conservation et les droits de l'Utilisateur sont décrits dans la
          Politique de Confidentialité accessible sur la Plateforme, laquelle fait partie intégrante
          du contrat.
        </P>

        <H2>14.2 Finalités</H2>
        <P>
          Les données personnelles collectées sont utilisées pour : la gestion du compte et de
          l'Abonnement, la fourniture du Service, la facturation, l'assistance technique, la
          communication relative au Service, l'amélioration de la Plateforme et, le cas échéant,
          des actions commerciales. Les données ne sont pas vendues à des tiers.
        </P>

        <H2>14.3 Droits de l'Utilisateur</H2>
        <P>
          L'Utilisateur dispose, conformément à la réglementation, d'un droit d'accès, de
          rectification, d'effacement, de portabilité, de limitation du traitement et d'opposition
          aux données le concernant. Ces droits peuvent être exercés en écrivant à :{" "}
          <a href="mailto:dpo@mimmoza.fr" className="text-[#2E7D9A] underline">
            dpo@mimmoza.fr
          </a>{" "}
          ou à l'adresse postale du siège social. En cas de litige, l'Utilisateur peut introduire
          une réclamation auprès de la Commission Nationale de l'Informatique et des Libertés
          (CNIL).
        </P>
      </>
    ),
  },

  // ── ART. 15
  {
    id: "art15",
    num: "Article 15",
    title: "Résiliation",
    content: (
      <>
        <H2>15.1 Résiliation à l'initiative de l'Utilisateur</H2>
        <P>
          L'Utilisateur peut résilier son Abonnement à tout moment depuis son espace de gestion de
          compte. La résiliation prend effet à l'expiration de la période d'abonnement en cours.
          Aucun remboursement n'est effectué pour la période restant à courir, sauf disposition
          contraire applicable (notamment le droit de rétractation pour les consommateurs, le cas
          échéant).
        </P>

        <H2>15.2 Résiliation à l'initiative de Mimmoza</H2>
        <P>
          Mimmoza peut résilier l'Abonnement avec un préavis de trente (30) jours notifié par voie
          électronique, sans avoir à justifier d'un motif particulier, sauf circonstances justifiant
          une résiliation immédiate (voir article 15.3).
        </P>

        <H2>15.3 Résiliation pour manquement</H2>
        <P>
          En cas de manquement grave de l'Utilisateur à ses obligations contractuelles (violation
          des CGV, défaut de paiement persistant, usage abusif ou frauduleux), Mimmoza peut
          résilier l'Abonnement avec effet immédiat, sans préavis ni indemnité, après mise en
          demeure par voie électronique restée sans effet pendant quarante-huit (48) heures.
        </P>

        <H2>15.4 Effets de la résiliation</H2>
        <P>
          À la date de résiliation, l'accès de l'Utilisateur à la Plateforme est coupé. Mimmoza
          conserve les données de l'Utilisateur pendant une durée de trente (30) jours après
          résiliation, pendant laquelle l'Utilisateur peut en demander l'export. Passé ce délai,
          les données sont supprimées, sauf obligation légale de conservation.
        </P>
      </>
    ),
  },

  // ── ART. 16
  {
    id: "art16",
    num: "Article 16",
    title: "Suspension du service",
    content: (
      <>
        <P>
          Mimmoza se réserve le droit de suspendre l'accès au Service, immédiatement et sans
          préavis, dans les situations suivantes :
        </P>
        <UL>
          <LI>Suspicion d'utilisation frauduleuse ou non autorisée du Compte.</LI>
          <LI>Défaut de paiement non régularisé dans le délai prévu à l'article 6.4.</LI>
          <LI>Violation des présentes CGV par l'Utilisateur.</LI>
          <LI>Obligations légales ou réglementaires imposant la suspension.</LI>
          <LI>
            Nécessité d'une intervention technique urgente pour garantir la sécurité ou l'intégrité
            de la Plateforme.
          </LI>
        </UL>
        <P>
          La suspension ne libère pas l'Utilisateur de ses obligations de paiement en cours. Si la
          situation à l'origine de la suspension n'est pas régularisée dans un délai raisonnable,
          Mimmoza peut procéder à la résiliation du contrat conformément à l'article 15.
        </P>
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
          l'exécution de ses obligations contractuelles résultant d'un événement de force majeure,
          au sens de l'article 1218 du Code civil, notamment : catastrophes naturelles, actes de
          terrorisme, pandémies, décisions gouvernementales, grèves nationales, pannes généralisées
          des réseaux de télécommunications ou d'électricité, cyberattaques de grande ampleur ou
          tout autre événement imprévisible, irrésistible et extérieur aux parties.
        </P>
        <P>
          La partie concernée par un événement de force majeure en notifie l'autre dans les
          meilleurs délais. L'exécution du contrat est suspendue pendant la durée de l'événement.
          Si celui-ci excède une durée de soixante (60) jours, chaque partie peut résilier le
          contrat de plein droit par notification écrite, sans indemnité.
        </P>
      </>
    ),
  },

  // ── ART. 18
  {
    id: "art18",
    num: "Article 18",
    title: "Droit applicable et juridiction",
    content: (
      <>
        <H2>18.1 Droit applicable</H2>
        <P>Les présentes CGV sont soumises au droit français.</P>

        <H2>18.2 Médiation</H2>
        <P>
          Conformément aux articles L.616-1 et R.616-1 du Code de la consommation, pour les
          Utilisateurs ayant la qualité de consommateur, Mimmoza propose un dispositif de médiation
          de la consommation. En cas de litige non résolu à l'amiable, le consommateur peut
          recourir gratuitement au médiateur compétent, dont les coordonnées sont disponibles sur
          simple demande à{" "}
          <a href="mailto:contact@mimmoza.fr" className="text-[#2E7D9A] underline">
            contact@mimmoza.fr
          </a>
          .
        </P>

        <H2>18.3 Juridiction compétente</H2>
        <P>
          Pour les Utilisateurs professionnels, tout litige relatif à la formation, l'interprétation,
          l'exécution ou la résiliation des présentes CGV sera soumis à la compétence exclusive des
          Tribunaux de commerce du ressort du siège social de Mimmoza, sauf règle de compétence
          d'ordre public contraire.
        </P>
        <P>
          Pour les Utilisateurs consommateurs, le tribunal compétent est celui du lieu de résidence
          du consommateur, ou tout autre tribunal désigné par les règles de compétence applicables.
        </P>
      </>
    ),
  },

  // ── ART. 19
  {
    id: "art19",
    num: "Article 19",
    title: "Dispositions diverses",
    content: (
      <>
        <H2>19.1 Intégralité du contrat</H2>
        <P>
          Les présentes CGV, complétées par la Politique de Confidentialité et, le cas échéant,
          par toute offre spécifique souscrite par l'Utilisateur, constituent l'intégralité de
          l'accord entre les parties et remplacent tout accord antérieur relatif à l'objet des
          présentes.
        </P>

        <H2>19.2 Nullité partielle</H2>
        <P>
          Si l'une des clauses des présentes CGV venait à être déclarée nulle ou inapplicable par
          une juridiction compétente, les autres clauses demeureraient pleinement en vigueur. Les
          parties s'engagent alors à négocier de bonne foi une clause de remplacement ayant un
          effet économique équivalent.
        </P>

        <H2>19.3 Non-renonciation</H2>
        <P>
          Le fait pour Mimmoza de ne pas se prévaloir d'un manquement de l'Utilisateur à l'une
          quelconque de ses obligations ne vaut pas renonciation à se prévaloir ultérieurement de
          ce même manquement ou de tout autre manquement.
        </P>

        <H2>19.4 Cession</H2>
        <P>
          L'Utilisateur ne peut céder tout ou partie des droits et obligations découlant des
          présentes CGV sans l'accord préalable écrit de Mimmoza. Mimmoza peut librement céder le
          contrat à tout tiers, notamment dans le cadre d'une opération de fusion, acquisition ou
          cession d'activité, sous réserve d'en informer l'Utilisateur.
        </P>

        <H2>19.5 Version de référence</H2>
        <P>
          En cas de traduction des présentes CGV en langue étrangère, la version française fait
          seule foi.
        </P>
      </>
    ),
  },
];

// ─── Sommaire (TOC) ───────────────────────────────────────────────────────────

const TOC: React.FC<{ onNavigate: (id: string) => void }> = ({ onNavigate }) => (
  <nav className="bg-white border border-gray-200 rounded-xl p-6 mb-8 shadow-sm">
    <p className="text-xs font-bold text-[#1A3C5E] uppercase tracking-widest mb-4">
      Table des matières
    </p>
    <ol className="space-y-1">
      {articles.map((a) => (
        <li key={a.id}>
          <button
            onClick={() => onNavigate(a.id)}
            className="text-sm text-[#2E7D9A] hover:text-[#1A3C5E] hover:underline text-left transition-colors"
          >
            {a.num} – {a.title}
          </button>
        </li>
      ))}
    </ol>
  </nav>
);

// ─── Article Card ─────────────────────────────────────────────────────────────

const ArticleCard: React.FC<{ article: Article }> = ({ article }) => (
  <section
    id={article.id}
    className="bg-white border border-gray-200 rounded-xl p-6 mb-6 shadow-sm scroll-mt-24"
  >
    <div className="flex items-baseline gap-3 mb-4 pb-3 border-b border-gray-100">
      <span className="text-xs font-bold text-[#2E7D9A] uppercase tracking-widest whitespace-nowrap">
        {article.num}
      </span>
      <h2 className="text-base font-bold text-[#1A3C5E]">{article.title}</h2>
    </div>
    <div>{article.content}</div>
  </section>
);

// ─── Page principale ──────────────────────────────────────────────────────────

const CGVPage: React.FC = () => {
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1A3C5E] text-white py-10 px-6">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-bold tracking-widest uppercase text-[#7EC8E3] mb-2">
            Mimmoza SAS
          </p>
          <h1 className="text-2xl font-bold mb-1">Conditions Générales de Vente</h1>
          <p className="text-sm text-blue-200">Version en vigueur à compter du 13 avril 2026</p>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-3xl mx-auto px-4 py-10">
        <TOC onNavigate={scrollTo} />

        {articles.map((a) => (
          <ArticleCard key={a.id} article={a} />
        ))}

        {/* Footer */}
        <div className="mt-10 pt-6 border-t border-gray-200 text-center text-xs text-gray-400 space-y-1">
          <p>© 2026 Mimmoza SAS – Tous droits réservés</p>
          <p>
            <a href="mailto:contact@mimmoza.fr" className="hover:text-[#2E7D9A]">
              contact@mimmoza.fr
            </a>{" "}
            –{" "}
            <a href="https://www.mimmoza.fr" className="hover:text-[#2E7D9A]">
              www.mimmoza.fr
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default CGVPage;