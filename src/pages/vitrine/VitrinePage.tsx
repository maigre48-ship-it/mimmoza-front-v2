// src/pages/vitrine/VitrinePage.tsx
//
// Page d'accueil publique (« vitrine ») servie sur « / » aux visiteurs NON
// connectés. Un visiteur déjà connecté est renvoyé vers /accueil (même
// décideur d'atterrissage que la connexion), sans flash de la vitrine :
// tant que Supabase n'a pas répondu, un écran neutre est affiché.
//
// ⚠️ Route INDEXABLE (cf. RobotsPolicy) : aucune donnée DVF ne doit figurer
// ici — ni prix, ni médiane au m², ni transaction, même dans l'exemple de
// rapport (article R. 112 A-3 du livre des procédures fiscales).
//
// Tarifs : lus dans src/lib/billing/grille.ts (source de vérité unique),
// jamais écrits en dur ici.
// Aucun témoignage, logo client, chiffre d'usage ou partenaire : la page ne
// présente que ce que fait réellement le produit.

import { Suspense, lazy, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { ChargementGarde } from "@/components/ChargementGarde";
import { MimmozaLogo } from "@/components/MimmozaLogo";
import { useSessionSupabase } from "@/lib/auth/useSessionSupabase";
import {
  CONTACT_ACCES,
  FORMULES,
  PAIEMENT_EN_LIGNE_DISPONIBLE,
  STUDIO_3D,
  formatEurHT,
  prixFormule,
} from "@/lib/billing/grille";

import "./VitrinePage.css";

const StudioHeroBuilding3D = lazy(() =>
  import("@/spaces/copilot/studio3d/StudioHeroBuilding3D").then((m) => ({
    default: m.StudioHeroBuilding3D,
  })),
);

const TITRE = "Mimmoza — l'analyse foncière et immobilière sourcée, pour les pros de l'immobilier";
const DESCRIPTION =
  "Une adresse ou une parcelle : Mimmoza croise cadastre, PLU, servitudes, risques, marché, loyers et fiscalité locale, et vous rend un rapport sourcé. Pour promoteurs, marchands de biens, réhabilitation et apporteurs d'affaires.";

const IMAGE_IMMEUBLE = "/illustrations/mimmoza-studio-building.webp";
const ALT_IMMEUBLE = "Maquette 3D d'un immeuble de logements contemporain";

/* ── Contenu ──────────────────────────────────────────────────────────────── */

const VERIFICATIONS = [
  "Cadastre",
  "Zonage PLU",
  "Servitudes",
  "Risques",
  "Marché",
  "Loyers",
  "Fiscalité locale",
  "Assainissement",
];

const METIERS = [
  {
    titre: "Promoteurs immobiliers",
    module: "Module Promotion",
    texte:
      "Repérez le foncier avec la veille foncière, lisez le PLU de la parcelle, testez la capacité constructible et montez votre bilan promoteur.",
  },
  {
    titre: "Marchands de biens et investisseurs",
    module: "Module Marchand de biens",
    texte:
      "Qualifiez un bien, simulez travaux et revente, vérifiez les risques et suivez chaque dossier dans votre pipeline jusqu'à la sortie.",
  },
  {
    titre: "Rénovation et réhabilitation",
    module: "Module Réhabilitation",
    texte:
      "Partez du plan existant : conformité, chiffrage et planning des travaux, puis valorisation du bien une fois rénové.",
  },
  {
    titre: "Apporteurs d'affaires",
    module: "Inclus dans toutes les formules",
    texte:
      "Déposez une opportunité foncière, vérifiez-la avec l'analyse rapide et suivez sa qualification par les professionnels.",
  },
];

interface LigneRapport {
  rubrique: string;
  valeur: string;
  detail?: string;
  source: string;
  masque?: boolean;
}

/** Exemple ILLUSTRATIF : parcelle fictive, aucune donnée réelle. Aucun prix DVF. */
const RAPPORT_EXEMPLE: LigneRapport[] = [
  { rubrique: "Parcelle", valeur: "Section AB n° 0123", detail: "Contenance 1 240 m²", source: "Cadastre, DGFiP" },
  { rubrique: "Zonage PLU", valeur: "Zone UB", detail: "Urbaine mixte, règlement et hauteurs relevés", source: "Géoportail de l'urbanisme" },
  { rubrique: "Servitudes", valeur: "Aucune servitude relevée", detail: "Hors périmètre de monument historique", source: "Géoportail de l'urbanisme" },
  { rubrique: "Risques", valeur: "Argiles : aléa moyen", detail: "Hors zone inondable réglementée", source: "Géorisques" },
  { rubrique: "Prix au m²", valeur: "Indiqué dans votre rapport", detail: "Ventes comparables du secteur", source: "DVF, DGFiP", masque: true },
  { rubrique: "Loyers", valeur: "Fourchette de référence", detail: "Appartements, maille communale", source: "Carte des loyers" },
  { rubrique: "Fiscalité", valeur: "Taux de taxe foncière", detail: "Commune et intercommunalité", source: "DGFiP" },
  { rubrique: "Assainissement", valeur: "Réseau collectif", detail: "Service et indicateurs publiés", source: "SISPEA" },
];

const ETAPES = [
  {
    titre: "Saisissez une adresse ou une parcelle",
    texte: "Une adresse postale, une référence cadastrale ou un point sur la carte suffit.",
  },
  {
    titre: "Mimmo croise les sources publiques",
    texte:
      "Le copilote interroge le cadastre, le PLU, Géorisques, les ventes passées et les bases locales, puis rapproche les résultats.",
  },
  {
    titre: "Lisez, questionnez, exportez",
    texte:
      "Posez vos questions à Mimmo sur le résultat, puis exportez un rapport sourcé en PDF, Word, Excel ou PowerPoint.",
  },
];

const SOURCES = [
  { nom: "Cadastre", producteur: "DGFiP, diffusé par l'IGN", usage: "Parcelles, contenances, références" },
  { nom: "Géoportail de l'urbanisme", producteur: "IGN", usage: "Zonage PLU, règlement, servitudes d'utilité publique" },
  { nom: "Géorisques", producteur: "Ministère de la Transition écologique", usage: "Risques naturels et technologiques" },
  { nom: "DVF", producteur: "DGFiP, Etalab", usage: "Ventes immobilières passées" },
  { nom: "Carte des loyers", producteur: "ANIL, ministère du Logement", usage: "Loyers de référence" },
  { nom: "Fiscalité locale", producteur: "DGFiP", usage: "Taux de taxe foncière" },
  { nom: "SISPEA", producteur: "Office français de la biodiversité", usage: "Services d'eau et d'assainissement" },
  { nom: "DPE", producteur: "ADEME", usage: "Diagnostics de performance énergétique" },
  { nom: "BDNB", producteur: "CSTB", usage: "Caractéristiques des bâtiments" },
  { nom: "Mérimée", producteur: "Ministère de la Culture", usage: "Monuments historiques" },
  { nom: "Sitadel", producteur: "SDES", usage: "Permis de construire autorisés" },
  { nom: "INSEE et Base adresse nationale", producteur: "INSEE, IGN", usage: "Données communales, géocodage" },
];

const FAQ = [
  {
    q: "Les résultats sont-ils fiables ?",
    r: "Chaque information vient d'une base publique, citée avec sa source. Ces bases ont leurs propres délais de mise à jour et leurs limites : un rapport Mimmoza prépare votre décision, il ne remplace pas l'avis d'un notaire, d'un architecte ou d'un géomètre. Faites valider les points engageants par un professionnel.",
  },
  {
    q: "Puis-je essayer sans payer ?",
    r: PAIEMENT_EN_LIGNE_DISPONIBLE
      ? "Oui. La formule Découverte est gratuite et sans engagement : créez un compte et lancez vos premières analyses rapides."
      : "Oui. La formule Découverte est gratuite et sans engagement : créez un compte et lancez vos premières analyses rapides. Le paiement en ligne n'est pas encore ouvert : les formules payantes s'activent sur simple demande.",
  },
  {
    q: "Qui est Mimmo ?",
    r: "Mimmo est le copilote IA de Mimmoza. Il interroge les sources publiques pour vous, explique ce qu'il trouve et répond à vos questions sur un dossier. Quand une donnée manque, il le dit plutôt que de l'inventer.",
  },
  {
    q: "Que deviennent mes données ?",
    r: "Vos dossiers restent privés et rattachés à votre compte. Le détail des traitements figure dans la politique de confidentialité.",
  },
];

/* ── Hooks ───────────────────────────────────────────────────────────────── */

/** Titre et description de la page, restaurés en quittant la vitrine. */
function useMetadonnees(): void {
  useEffect(() => {
    const titrePrecedent = document.title;
    const balise = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const descriptionPrecedente = balise?.getAttribute("content") ?? null;
    document.title = TITRE;
    balise?.setAttribute("content", DESCRIPTION);
    return () => {
      document.title = titrePrecedent;
      if (balise && descriptionPrecedente != null) balise.setAttribute("content", descriptionPrecedente);
    };
  }, []);
}

/**
 * Le 3D n'est chargé que sur grand écran : sur mobile, la maquette captait le
 * geste de défilement (OrbitControls) et coûtait un gros téléchargement.
 */
function useGrandEcran(): boolean {
  const requete = "(min-width: 960px)";
  const [grand, setGrand] = useState(
    () => typeof window !== "undefined" && window.matchMedia(requete).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(requete);
    const maj = () => setGrand(mq.matches);
    mq.addEventListener("change", maj);
    return () => mq.removeEventListener("change", maj);
  }, []);
  return grand;
}

/* ── Composants ──────────────────────────────────────────────────────────── */

function Coche() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M3.5 8.4l2.9 2.8 6.1-6.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EnTete() {
  return (
    <header className="vt-entete">
      <div className="vt-conteneur vt-entete__barre">
        <Link to="/" className="vt-entete__logo" aria-label="Mimmoza, accueil">
          <MimmozaLogo width={168} />
        </Link>
        <nav className="vt-entete__nav" aria-label="Sections de la page">
          <a href="#pour-qui">Pour qui</a>
          <a href="#exemple">Exemple de rapport</a>
          <a href="#studio">Studio 3D</a>
          <a href="#tarifs">Tarifs</a>
          <a href="#faq">Questions</a>
        </nav>
        <div className="vt-entete__actions">
          <Link to="/login" className="vt-lien-connexion">Se connecter</Link>
          <Link to="/inscription" className="vt-bouton vt-bouton--petit vt-entete__essai">
            Essayer gratuitement
          </Link>
        </div>
      </div>
    </header>
  );
}

function Heros() {
  const grandEcran = useGrandEcran();
  const image = <img src={IMAGE_IMMEUBLE} alt={ALT_IMMEUBLE} width={520} height={520} />;

  return (
    <section className="vt-heros" aria-labelledby="vt-titre">
      <div className="vt-conteneur vt-heros__grille">
        <div className="vt-heros__texte">
          <h1 id="vt-titre">Une adresse suffit pour savoir ce que vaut un terrain, et ce qu'on peut y faire.</h1>
          <p className="vt-heros__chapo">
            Mimmoza croise le cadastre, le PLU, les risques, les ventes passées et la fiscalité locale, puis vous rend
            une analyse sourcée en quelques minutes. Conçu par un ancien promoteur immobilier, pour les professionnels
            de l'immobilier.
          </p>
          <div className="vt-heros__actions">
            <Link to="/inscription" className="vt-bouton">Essayer gratuitement</Link>
            <Link to="/login" className="vt-bouton vt-bouton--clair">Se connecter</Link>
          </div>
          <p className="vt-heros__note">Formule Découverte gratuite, sans engagement ni carte bancaire.</p>
        </div>

        <div className="vt-heros__visuel">
          <div className="vt-heros__scene">
            {grandEcran ? (
              <Suspense fallback={image}>
                <StudioHeroBuilding3D />
              </Suspense>
            ) : (
              image
            )}
          </div>
          <div className="vt-fiche" aria-label="Ce que Mimmo vérifie pour chaque adresse">
            <p className="vt-fiche__titre">Vérifié pour chaque adresse</p>
            <ul>
              {VERIFICATIONS.map((v) => (
                <li key={v}><span className="vt-fiche__coche"><Coche /></span>{v}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function PourQui() {
  return (
    <section id="pour-qui" className="vt-section" aria-labelledby="vt-pour-qui">
      <div className="vt-conteneur">
        <div className="vt-intro">
          <h2 id="vt-pour-qui">Pensé pour quatre métiers de l'immobilier</h2>
          <p>
            Une même base d'analyse, puis des outils propres à votre activité. Vous ne payez que les modules
            dont vous avez besoin.
          </p>
        </div>
        <ul className="vt-metiers">
          {METIERS.map((m) => (
            <li key={m.titre} className="vt-metier">
              <h3>{m.titre}</h3>
              <p>{m.texte}</p>
              <span className="vt-metier__module">{m.module}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ExempleRapport() {
  return (
    <section id="exemple" className="vt-section vt-section--teinte" aria-labelledby="vt-exemple">
      <div className="vt-conteneur vt-exemple">
        <div className="vt-exemple__texte">
          <h2 id="vt-exemple">Ce que vous obtenez en quelques minutes</h2>
          <p>
            L'analyse rapide rassemble sur une seule fiche ce qu'il faudrait sinon chercher dans une dizaine de
            sites publics. Chaque ligne indique d'où vient l'information.
          </p>
          <ul className="vt-liste-coches">
            <li><Coche /> Rapport exportable en PDF, Word, Excel et PowerPoint</li>
            <li><Coche /> Sources citées ligne par ligne</li>
            <li><Coche /> Questions de suivi à Mimmo sur le même dossier</li>
          </ul>
          <p className="vt-exemple__mention">
            Les prix issus de DVF ne sont jamais affichés sur les pages publiques : la licence de réutilisation de
            la DGFiP l'interdit. Vous les retrouvez dans vos rapports, une fois connecté.
          </p>
        </div>

        <figure className="vt-rapport">
          <div className="vt-rapport__entete">
            <div>
              <p className="vt-rapport__type">Analyse rapide</p>
              <p className="vt-rapport__lieu">Parcelle fictive, commune de 12 000 habitants</p>
            </div>
            <span className="vt-rapport__badge">Exemple illustratif</span>
          </div>
          <dl className="vt-rapport__lignes">
            {RAPPORT_EXEMPLE.map((l) => (
              <div key={l.rubrique} className={l.masque ? "vt-rapport__ligne vt-rapport__ligne--masque" : "vt-rapport__ligne"}>
                <dt>{l.rubrique}</dt>
                <dd>
                  <span className="vt-rapport__valeur">{l.valeur}</span>
                  {l.detail && <span className="vt-rapport__detail">{l.detail}</span>}
                </dd>
                <dd className="vt-rapport__source">{l.source}</dd>
              </div>
            ))}
          </dl>
          <figcaption className="vt-rapport__pied">
            Données fictives à titre d'illustration. Un rapport réel est à faire valider par un professionnel.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function CommentCaMarche() {
  return (
    <section className="vt-section" aria-labelledby="vt-etapes">
      <div className="vt-conteneur">
        <div className="vt-intro">
          <h2 id="vt-etapes">Comment ça marche</h2>
        </div>
        <ol className="vt-etapes">
          {ETAPES.map((e, i) => (
            <li key={e.titre} className="vt-etape">
              <span className="vt-etape__numero" aria-hidden="true">{i + 1}</span>
              <h3>{e.titre}</h3>
              <p>{e.texte}</p>
            </li>
          ))}
        </ol>
        <p className="vt-etapes__suite">
          <Link to="/analyse-rapide" className="vt-lien-fort">Tester l'analyse rapide sur une adresse</Link>
        </p>
      </div>
    </section>
  );
}

function Studio() {
  return (
    <section id="studio" className="vt-studio" aria-labelledby="vt-studio">
      <div className="vt-conteneur vt-studio__grille">
        <div className="vt-studio__texte">
          <h2 id="vt-studio">Du rapport à la maquette 3D</h2>
          <p>
            Décrivez un bâtiment à Mimmo : emprise, nombre de niveaux, logements. MimmozIA Studio en construit la
            maquette 3D, que vous parcourez, ajustez et aménagez pièce par pièce, comme dans un jeu.
          </p>
          <p>
            Utile pour vérifier un gabarit avant d'engager un architecte, ou pour montrer un projet à un vendeur,
            un élu ou un financeur.
          </p>
          <p className="vt-studio__prix">
            Application liée, à partir de {formatEurHT(STUDIO_3D.prixMensuelDesHT)}/mois.{" "}
            {STUDIO_3D.remisePct} % de remise pour les abonnés Pro et Équipe.
          </p>
        </div>
        <div className="vt-studio__visuel">
          <img src={IMAGE_IMMEUBLE} alt={ALT_IMMEUBLE} width={520} height={520} loading="lazy" />
        </div>
      </div>
    </section>
  );
}

function Sources() {
  return (
    <section className="vt-section" aria-labelledby="vt-sources">
      <div className="vt-conteneur">
        <div className="vt-intro">
          <h2 id="vt-sources">Uniquement des sources publiques, toujours citées</h2>
          <p>
            Mimmoza ne fabrique pas de données : il interroge les bases officielles ci-dessous et vous dit d'où
            vient chaque information.
          </p>
        </div>
        <ul className="vt-sources">
          {SOURCES.map((s) => (
            <li key={s.nom}>
              <span className="vt-sources__nom">{s.nom}</span>
              <span className="vt-sources__usage">{s.usage}</span>
              <span className="vt-sources__producteur">{s.producteur}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Tarifs() {
  return (
    <section id="tarifs" className="vt-section vt-section--teinte" aria-labelledby="vt-tarifs">
      <div className="vt-conteneur">
        <div className="vt-intro">
          <h2 id="vt-tarifs">Tarifs</h2>
          <p>Commencez gratuitement, puis choisissez la formule qui correspond à votre activité. Prix hors taxes, sans engagement.</p>
        </div>
        <ul className="vt-formules">
          {FORMULES.map((f) => (
            <li key={f.id} className={f.miseEnAvant ? "vt-formule vt-formule--avant" : "vt-formule"}>
              <h3>{f.nom}</h3>
              <p className="vt-formule__accroche">{f.accroche}</p>
              <p className="vt-formule__prix">{prixFormule(f)}</p>
              <ul>
                {f.points.map((p) => (
                  <li key={p}><Coche /> {p}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <div className="vt-tarifs__suite">
          <Link to="/tarifs" className="vt-bouton vt-bouton--clair">Comparer les formules en détail</Link>
          {!PAIEMENT_EN_LIGNE_DISPONIBLE && (
            <p>Paiement en ligne bientôt disponible : les formules payantes s'ouvrent sur demande.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="vt-section" aria-labelledby="vt-faq">
      <div className="vt-conteneur vt-faq">
        <h2 id="vt-faq">Questions fréquentes</h2>
        <div className="vt-faq__liste">
          {FAQ.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.r}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function AppelFinal() {
  return (
    <section className="vt-final" aria-labelledby="vt-final">
      <div className="vt-conteneur">
        <div className="vt-final__boite">
          <h2 id="vt-final">Votre prochaine adresse mérite mieux qu'une recherche à la main.</h2>
          <div className="vt-heros__actions">
            <Link to="/inscription" className="vt-bouton vt-bouton--inverse">Essayer gratuitement</Link>
            <Link to="/login" className="vt-lien-connexion vt-lien-connexion--inverse">Se connecter</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function PiedDePage() {
  return (
    <footer className="vt-pied">
      <div className="vt-conteneur vt-pied__grille">
        <div className="vt-pied__marque">
          <MimmozaLogo variant="white" width={160} />
          <p>Plateforme française d'intelligence immobilière.</p>
          <a href={`mailto:${CONTACT_ACCES}`}>{CONTACT_ACCES}</a>
        </div>
        <nav aria-label="Produit">
          <p className="vt-pied__titre">Produit</p>
          <ul>
            <li><Link to="/analyse-rapide">Analyse rapide</Link></li>
            <li><Link to="/tarifs">Tarifs</Link></li>
            <li><Link to="/api">API</Link></li>
            <li><Link to="/inscription">Créer un compte</Link></li>
            <li><Link to="/login">Se connecter</Link></li>
          </ul>
        </nav>
        <nav aria-label="Assistance">
          <p className="vt-pied__titre">Assistance</p>
          <ul>
            <li><Link to="/aide">Centre d'aide</Link></li>
            <li><Link to="/securite">Sécurité et données</Link></li>
            <li><a href={`mailto:${CONTACT_ACCES}`}>Contact</a></li>
          </ul>
        </nav>
        <nav aria-label="Informations légales">
          <p className="vt-pied__titre">Informations légales</p>
          <ul>
            <li><Link to="/mentions-legales">Mentions légales</Link></li>
            <li><Link to="/cgu">Conditions générales d'utilisation</Link></li>
            <li><Link to="/cgv">Conditions générales de vente</Link></li>
            <li><Link to="/politique-confidentialite">Politique de confidentialité</Link></li>
          </ul>
        </nav>
      </div>
      <div className="vt-conteneur">
        <p className="vt-pied__bas">© {new Date().getFullYear()} Mimmoza. Analyses fondées sur des données publiques, à faire valider par un professionnel.</p>
      </div>
    </footer>
  );
}

/** Contenu de la vitrine, sans logique de session (testable isolément). */
export function Vitrine() {
  useMetadonnees();
  return (
    <div className="vt-page">
      <a href="#vt-contenu" className="vt-evitement">Aller au contenu</a>
      <EnTete />
      {/* <div> et non <main> : AppShell enveloppe déjà la page dans un <main>. */}
      <div id="vt-contenu" tabIndex={-1}>
        <Heros />
        <PourQui />
        <ExempleRapport />
        <CommentCaMarche />
        <Studio />
        <Sources />
        <Tarifs />
        <Faq />
        <AppelFinal />
      </div>
      <PiedDePage />
    </div>
  );
}

/**
 * Route « / » : vitrine pour un visiteur, espace connecté pour un utilisateur
 * déjà identifié (session Supabase, seule source de vérité).
 */
export default function VitrinePage() {
  const { chargement, session } = useSessionSupabase();
  if (chargement) return <ChargementGarde libelle="Chargement…" />;
  if (session) return <Navigate to="/accueil" replace />;
  return <Vitrine />;
}
