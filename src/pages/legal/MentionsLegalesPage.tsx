import React, { useState, useEffect, useRef } from "react";

// ─── Composants internes ──────────────────────────────────────────────────────

const Info: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="my-4 border-l-4 border-[#2E7D9A] bg-sky-50 px-4 py-3 rounded-r-md">
    <p className="text-sm text-[#1A3C5E] leading-relaxed">
      ℹ&nbsp;&nbsp;{children}
    </p>
  </div>
);

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
  <li className="flex gap-2 text-sm text-gray-700 leading-relaxed">
    <span className="text-[#2E7D9A] mt-0.5 flex-shrink-0">–</span>
    <span>{children}</span>
  </li>
);

// ─── Bloc fiche identité ──────────────────────────────────────────────────────

const IdentiteRow: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div className="flex flex-col sm:flex-row sm:gap-4 py-2.5 border-b border-gray-100 last:border-0">
    <dt className="w-full sm:w-48 flex-shrink-0 text-xs font-semibold text-gray-500 uppercase tracking-wide">
      {label}
    </dt>
    <dd className="text-sm text-gray-800 mt-0.5 sm:mt-0">{value}</dd>
  </div>
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
    title: "Éditeur de la Plateforme",
    content: (
      <>
        <P>
          Conformément aux dispositions de l'article 6 de la loi n° 2004-575 du 21 juin 2004
          pour la confiance dans l'économie numérique (LCEN), les informations suivantes sont
          portées à la connaissance des utilisateurs et visiteurs du site web et de l'application
          mobile Mimmoza (ci-après la « Plateforme »).
        </P>

        <div className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden mt-4">
          <div className="bg-[#1A3C5E] px-4 py-2.5">
            <p className="text-xs font-bold text-white uppercase tracking-widest">
              Identité de l'éditeur
            </p>
          </div>
          <dl className="px-4 divide-y divide-gray-100">
            <IdentiteRow label="Raison sociale" value="Mimmoza SAS" />
            <IdentiteRow label="Forme juridique" value="Société par actions simplifiée (SAS)" />
            <IdentiteRow label="Capital social" value="[●] euros" />
            <IdentiteRow
              label="Siège social"
              value="[Numéro et libellé de voie], [Code postal] [Ville], France"
            />
            <IdentiteRow
              label="RCS"
              value="Immatriculée au RCS de [Ville] sous le numéro [●]"
            />
            <IdentiteRow label="SIRET" value="[●]" />
            <IdentiteRow label="Code APE / NAF" value="[●]" />
            <IdentiteRow
              label="N° TVA intracommunautaire"
              value="FR[●]"
            />
            <IdentiteRow label="Président" value="[Nom Prénom du Président]" />
            <IdentiteRow
              label="Contact"
              value={
                <a href="mailto:contact@mimmoza.fr" className="text-[#2E7D9A] underline">
                  contact@mimmoza.fr
                </a>
              }
            />
            <IdentiteRow label="Téléphone" value="[+33 (0)X XX XX XX XX]" />
            <IdentiteRow
              label="Site web"
              value={
                <a
                  href="https://www.mimmoza.fr"
                  className="text-[#2E7D9A] underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  www.mimmoza.fr
                </a>
              }
            />
          </dl>
        </div>
      </>
    ),
  },

  // ── ART. 2
  {
    id: "art2",
    num: "Article 2",
    title: "Directeur de la publication",
    content: (
      <>
        <P>
          Le directeur de la publication de la Plateforme est{" "}
          <strong>[Nom Prénom]</strong>, en sa qualité de Président de Mimmoza SAS.
        </P>
        <P>
          Le directeur de la publication peut être contacté à l'adresse électronique suivante :{" "}
          <a href="mailto:contact@mimmoza.fr" className="text-[#2E7D9A] underline">
            contact@mimmoza.fr
          </a>
          .
        </P>
        <Info>
          Conformément à l'article 6-III de la loi LCEN, le nom du directeur de la publication
          doit être mentionné sur tout service de communication au public en ligne. En cas de
          désaccord avec un contenu publié, tout tiers peut adresser une demande de rectification
          ou de suppression au directeur de la publication à l'adresse ci-dessus.
        </Info>
      </>
    ),
  },

  // ── ART. 3
  {
    id: "art3",
    num: "Article 3",
    title: "Hébergeur de la Plateforme",
    content: (
      <>
        <P>
          La Plateforme Mimmoza est hébergée par le(s) prestataire(s) suivant(s) :
        </P>

        <div className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden mt-2 mb-4">
          <div className="bg-[#2E7D9A] px-4 py-2.5">
            <p className="text-xs font-bold text-white uppercase tracking-widest">
              Hébergeur principal
            </p>
          </div>
          <dl className="px-4 divide-y divide-gray-100">
            <IdentiteRow label="Société" value="[Nom de l'hébergeur, ex. : OVHcloud SAS]" />
            <IdentiteRow label="Forme juridique" value="[Forme juridique]" />
            <IdentiteRow label="Siège social" value="[Adresse complète]" />
            <IdentiteRow label="RCS" value="[Ville] [Numéro]" />
            <IdentiteRow label="Téléphone" value="[Numéro de téléphone]" />
            <IdentiteRow
              label="Site web"
              value={
                <a
                  href="#"
                  className="text-[#2E7D9A] underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  [URL de l'hébergeur]
                </a>
              }
            />
            <IdentiteRow
              label="Localisation des serveurs"
              value="Union européenne (France / [Pays])"
            />
          </dl>
        </div>

        <P>
          Les données à caractère personnel des Utilisateurs sont hébergées sur des serveurs
          situés dans l'Union européenne, conformément aux exigences du Règlement (UE) 2016/679
          (RGPD). En cas de recours à des services complémentaires d'hébergement, Mimmoza
          s'assure que les garanties appropriées en matière de protection des données sont en
          place (voir la Politique de Confidentialité).
        </P>
      </>
    ),
  },

  // ── ART. 4
  {
    id: "art4",
    num: "Article 4",
    title: "Délégué à la Protection des Données (DPO)",
    content: (
      <>
        <P>
          Conformément au Règlement (UE) 2016/679 (RGPD), Mimmoza a désigné un Délégué à la
          Protection des Données (DPO), chargé de veiller au respect de la réglementation en
          matière de protection des données personnelles.
        </P>

        <div className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden mt-2">
          <div className="bg-[#2E7D9A] px-4 py-2.5">
            <p className="text-xs font-bold text-white uppercase tracking-widest">
              Coordonnées du DPO
            </p>
          </div>
          <dl className="px-4 divide-y divide-gray-100">
            <IdentiteRow label="Nom" value="[Nom Prénom du DPO ou nom de la société DPO]" />
            <IdentiteRow
              label="E-mail"
              value={
                <a href="mailto:dpo@mimmoza.fr" className="text-[#2E7D9A] underline">
                  dpo@mimmoza.fr
                </a>
              }
            />
            <IdentiteRow
              label="Adresse postale"
              value="Mimmoza SAS – À l'attention du DPO – [Adresse du siège]"
            />
          </dl>
        </div>

        <P className="mt-4">
          Pour toute question relative au traitement de vos données personnelles, à l'exercice
          de vos droits (accès, rectification, effacement, portabilité, opposition), ou pour
          signaler une violation de données, vous pouvez contacter le DPO aux coordonnées
          ci-dessus. Une réponse sera apportée dans un délai maximum d'un (1) mois à compter
          de la réception de votre demande.
        </P>
      </>
    ),
  },

  // ── ART. 5
  {
    id: "art5",
    num: "Article 5",
    title: "Propriété intellectuelle",
    content: (
      <>
        <H2>5.1 Droits de Mimmoza</H2>
        <P>
          La Plateforme Mimmoza et l'ensemble de ses composants — notamment son code source,
          son architecture logicielle, ses interfaces graphiques, ses algorithmes (dont le
          SmartScore), ses modèles d'intelligence artificielle, ses bases de données propres,
          ses contenus éditoriaux, sa marque, ses logos, sa charte graphique et ses noms de
          domaine — sont la propriété exclusive de Mimmoza SAS ou de ses partenaires concédants,
          et sont protégés par le droit français et international de la propriété intellectuelle,
          notamment :
        </P>
        <UL>
          <LI>
            Le droit d'auteur, en vertu des articles L.111-1 et suivants du Code de la propriété
            intellectuelle (CPI).
          </LI>
          <LI>
            Les droits sui generis des producteurs de bases de données, en vertu des articles
            L.341-1 et suivants du CPI.
          </LI>
          <LI>
            Le droit des marques, en vertu des articles L.711-1 et suivants du CPI.
          </LI>
          <LI>
            Le droit des dessins et modèles, en vertu des articles L.511-1 et suivants du CPI.
          </LI>
        </UL>

        <H2>5.2 Interdictions</H2>
        <Warn>
          Toute reproduction, représentation, modification, publication, adaptation, traduction,
          diffusion, extraction substantielle ou exploitation commerciale, totale ou partielle,
          des éléments de la Plateforme, par quelque procédé que ce soit et sur quelque support
          que ce soit, sans l'autorisation préalable et écrite de Mimmoza, est strictement
          interdite et constitue une contrefaçon sanctionnée par les articles L.335-2 et suivants
          du CPI, passible de trois (3) ans d'emprisonnement et de 300 000 euros d'amende.
        </Warn>

        <H2>5.3 Marques</H2>
        <P>
          La marque « Mimmoza », les logos et tout signe distinctif associé sont des marques
          déposées ou en cours de dépôt de Mimmoza SAS. Toute utilisation non autorisée de ces
          marques est susceptible de constituer une contrefaçon et/ou un acte de concurrence
          déloyale.
        </P>

        <H2>5.4 Données tierces</H2>
        <P>
          La Plateforme intègre des données provenant de sources tierces (base DVF de la DGFiP,
          données INSEE, PLU, BPE, FINESS, fonds cartographiques IGN/OpenStreetMap, etc.). Ces
          données restent la propriété de leurs producteurs respectifs et sont soumises à leurs
          propres conditions d'utilisation. Mimmoza s'efforce de respecter les licences attachées
          à ces données et d'en créditer les producteurs le cas échéant.
        </P>

        <H2>5.5 Contenus utilisateurs</H2>
        <P>
          Les données et fichiers importés par l'Utilisateur sur la Plateforme restent sa
          propriété. En les soumettant, l'Utilisateur concède à Mimmoza une licence limitée
          d'utilisation aux seules fins de fourniture du Service, dans les conditions décrites
          dans les CGU et la Politique de Confidentialité.
        </P>
      </>
    ),
  },

  // ── ART. 6
  {
    id: "art6",
    num: "Article 6",
    title: "Limitation de responsabilité",
    content: (
      <>
        <H2>6.1 Nature des contenus</H2>
        <Warn>
          Les analyses, estimations, scores (dont le SmartScore), études de faisabilité, rendus
          visuels et contenus générés par intelligence artificielle disponibles sur la Plateforme
          sont fournis à titre informatif et d'aide à la décision uniquement. Ils ne constituent
          pas des conseils en investissement, des expertises immobilières, des conseils juridiques
          ou urbanistiques, et n'engagent pas la responsabilité professionnelle de Mimmoza.
        </Warn>

        <H2>6.2 Exactitude des informations</H2>
        <P>
          Mimmoza s'efforce de maintenir les informations disponibles sur la Plateforme aussi
          exactes et à jour que possible. Toutefois, Mimmoza ne garantit pas l'exactitude,
          l'exhaustivité, l'actualité ou la pertinence des informations publiées, notamment
          celles issues de sources de données tierces (DVF, INSEE, PLU, APIs externes) sur
          lesquelles Mimmoza n'a pas de maîtrise. Mimmoza décline toute responsabilité pour
          toute erreur ou omission dans ces informations.
        </P>

        <H2>6.3 Disponibilité de la Plateforme</H2>
        <P>
          Mimmoza s'efforce d'assurer la disponibilité de la Plateforme mais ne peut garantir
          un accès ininterrompu. La Plateforme peut être temporairement indisponible en raison
          d'opérations de maintenance, de mises à jour techniques, de défaillances d'infrastructure
          ou de tout événement indépendant de la volonté de Mimmoza. Mimmoza ne saurait être
          tenue responsable des préjudices directs ou indirects résultant d'une indisponibilité
          de la Plateforme.
        </P>

        <H2>6.4 Liens hypertextes</H2>
        <P>
          La Plateforme peut contenir des liens hypertextes vers des sites tiers. Mimmoza ne
          contrôle pas le contenu de ces sites et ne saurait être tenue responsable de leur
          contenu, de leur politique de confidentialité ou de tout dommage résultant de leur
          utilisation. La présence d'un lien ne vaut pas approbation du site lié ni partenariat.
        </P>

        <H2>6.5 Responsabilité de l'utilisateur</H2>
        <P>
          L'utilisation de la Plateforme se fait sous l'entière responsabilité de l'Utilisateur.
          Celui-ci est seul responsable des conséquences de l'usage qu'il fait des informations,
          analyses et contenus disponibles sur la Plateforme, notamment de toute décision
          d'investissement, d'acquisition, de cession ou de construction prise sur leur fondement.
        </P>
      </>
    ),
  },

  // ── ART. 7
  {
    id: "art7",
    num: "Article 7",
    title: "Données personnelles",
    content: (
      <>
        <P>
          Mimmoza traite les données personnelles de ses utilisateurs en qualité de responsable
          de traitement, conformément au Règlement (UE) 2016/679 (RGPD) et à la loi Informatique
          et Libertés du 6 janvier 1978 modifiée.
        </P>
        <P>
          Les conditions détaillées de ce traitement — finalités, bases légales, durées de
          conservation, droits des personnes, transferts éventuels hors Union européenne —
          sont décrites dans la{" "}
          <a href="/politique-confidentialite" className="text-[#2E7D9A] underline">
            Politique de Confidentialité
          </a>{" "}
          de Mimmoza, accessible en permanence sur la Plateforme.
        </P>
        <P>
          Pour toute question relative à la protection de vos données personnelles ou pour
          exercer vos droits, vous pouvez contacter le Délégué à la Protection des Données
          (DPO) de Mimmoza à l'adresse{" "}
          <a href="mailto:dpo@mimmoza.fr" className="text-[#2E7D9A] underline">
            dpo@mimmoza.fr
          </a>
          .
        </P>
        <P>
          En cas de réclamation non résolue, vous disposez du droit d'introduire une plainte
          auprès de la Commission Nationale de l'Informatique et des Libertés (CNIL) —{" "}
          <a
            href="https://www.cnil.fr"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#2E7D9A] underline"
          >
            www.cnil.fr
          </a>
          .
        </P>
      </>
    ),
  },

  // ── ART. 8
  {
    id: "art8",
    num: "Article 8",
    title: "Cookies",
    content: (
      <>
        <P>
          La Plateforme utilise des cookies et traceurs pour assurer son bon fonctionnement,
          analyser son audience et améliorer l'expérience utilisateur. Conformément aux
          dispositions de l'article 82 de la loi Informatique et Libertés et aux recommandations
          de la CNIL, le dépôt de cookies non strictement nécessaires est soumis au consentement
          préalable de l'Utilisateur.
        </P>
        <P>
          L'Utilisateur peut gérer ses préférences en matière de cookies à tout moment via le
          Centre de préférences accessible en bas de page de la Plateforme, ou via les paramètres
          de son navigateur. Pour une information complète sur les cookies utilisés, leurs
          finalités et leur durée de conservation, il est invité à consulter la{" "}
          <a href="/politique-confidentialite#art8" className="text-[#2E7D9A] underline">
            Politique de Confidentialité
          </a>{" "}
          (article 8 — Cookies et traceurs).
        </P>
        <Info>
          Les cookies strictement nécessaires au fonctionnement technique de la Plateforme
          (session, authentification, sécurité CSRF) sont déposés sans consentement préalable,
          conformément à la réglementation applicable.
        </Info>
      </>
    ),
  },

  // ── ART. 9
  {
    id: "art9",
    num: "Article 9",
    title: "Droit applicable et juridiction",
    content: (
      <>
        <P>
          Les présentes Mentions Légales sont soumises au droit français. Tout litige relatif
          à leur interprétation ou à leur application sera soumis à la compétence des juridictions
          françaises compétentes, sous réserve des règles d'ordre public applicables aux
          consommateurs résidant dans un autre État membre de l'Union européenne.
        </P>
        <P>
          En cas de litige, l'Utilisateur ayant la qualité de consommateur est invité à
          contacter en premier lieu le service client de Mimmoza à{" "}
          <a href="mailto:contact@mimmoza.fr" className="text-[#2E7D9A] underline">
            contact@mimmoza.fr
          </a>{" "}
          afin de tenter de résoudre le différend à l'amiable. En l'absence de résolution
          amiable, il peut recourir à la médiation de la consommation dans les conditions
          prévues par les{" "}
          <a href="/cgv" className="text-[#2E7D9A] underline">
            Conditions Générales de Vente
          </a>
          .
        </P>
      </>
    ),
  },

  // ── ART. 10
  {
    id: "art10",
    num: "Article 10",
    title: "Contact et signalement",
    content: (
      <>
        <P>
          Pour toute question, réclamation ou signalement relatif à la Plateforme ou aux présentes
          Mentions Légales, l'Utilisateur peut contacter Mimmoza par les moyens suivants :
        </P>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          {[
            {
              icon: "✉️",
              titre: "Contact général",
              valeur: "contact@mimmoza.fr",
              href: "mailto:contact@mimmoza.fr",
            },
            {
              icon: "🔒",
              titre: "Protection des données (DPO)",
              valeur: "dpo@mimmoza.fr",
              href: "mailto:dpo@mimmoza.fr",
            },
            {
              icon: "🛡️",
              titre: "Sécurité & vulnérabilités",
              valeur: "security@mimmoza.fr",
              href: "mailto:security@mimmoza.fr",
            },
            {
              icon: "⚖️",
              titre: "Contentieux & juridique",
              valeur: "legal@mimmoza.fr",
              href: "mailto:legal@mimmoza.fr",
            },
          ].map((c) => (
            <div
              key={c.titre}
              className="flex gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3"
            >
              <span className="text-xl flex-shrink-0">{c.icon}</span>
              <div>
                <p className="text-xs font-bold text-[#1A3C5E] mb-0.5">{c.titre}</p>
                <a href={c.href} className="text-sm text-[#2E7D9A] underline">
                  {c.valeur}
                </a>
              </div>
            </div>
          ))}
        </div>

        <P className="mt-4">
          Pour les courriers postaux : Mimmoza SAS – [Numéro et libellé de voie] –
          [Code postal] [Ville] – France.
        </P>

        <H2>10.1 Signalement de contenus illicites</H2>
        <P>
          Conformément à l'article 6-I-7 de la loi LCEN et au Règlement (UE) 2022/2065 sur les
          services numériques (DSA), tout utilisateur peut signaler un contenu manifestement
          illicite présent sur la Plateforme en adressant un signalement motivé à{" "}
          <a href="mailto:legal@mimmoza.fr" className="text-[#2E7D9A] underline">
            legal@mimmoza.fr
          </a>
          , en précisant : la nature du contenu litigieux, son emplacement sur la Plateforme,
          les raisons pour lesquelles il est considéré comme illicite, et les coordonnées de
          l'auteur du signalement. Mimmoza s'engage à traiter tout signalement dans les meilleurs
          délais.
        </P>

        <H2>10.2 Droit de réponse</H2>
        <P>
          Conformément à l'article 6-IV de la loi LCEN, toute personne nommée ou désignée dans
          un contenu publié sur la Plateforme dispose d'un droit de réponse, à exercer auprès
          du directeur de la publication à l'adresse{" "}
          <a href="mailto:contact@mimmoza.fr" className="text-[#2E7D9A] underline">
            contact@mimmoza.fr
          </a>
          .
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

const MentionsLegalesPage: React.FC = () => {
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
          <h1 className="text-2xl font-bold mb-1">Mentions Légales</h1>
          <p className="text-sm text-blue-200">
            Conformes aux articles 6 et suivants de la loi n° 2004-575 du 21 juin 2004 (LCEN)
          </p>
          <p className="text-xs text-blue-300 mt-1">
            Dernière mise à jour : 13 avril 2026
          </p>
        </div>
      </div>

      {/* ── Bandeau documents liés ── */}
      <div className="bg-[#2E7D9A]/10 border-b border-[#2E7D9A]/20 px-6 py-2">
        <div className="max-w-6xl mx-auto flex flex-wrap gap-3 items-center text-xs text-[#1A3C5E]">
          <span className="font-semibold">Documents associés :</span>
          <a href="/cgv" className="text-[#2E7D9A] underline hover:text-[#1A3C5E]">
            CGV
          </a>
          <span className="text-gray-300">·</span>
          <a href="/cgu" className="text-[#2E7D9A] underline hover:text-[#1A3C5E]">
            CGU
          </a>
          <span className="text-gray-300">·</span>
          <a
            href="/politique-confidentialite"
            className="text-[#2E7D9A] underline hover:text-[#1A3C5E]"
          >
            Politique de Confidentialité
          </a>
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
                <a
                  href="mailto:contact@mimmoza.fr"
                  className="hover:text-[#2E7D9A] transition-colors"
                >
                  contact@mimmoza.fr
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
                Ces mentions légales ont été rédigées à titre indicatif et doivent être relues
                par un avocat avant toute mise en ligne.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MentionsLegalesPage;