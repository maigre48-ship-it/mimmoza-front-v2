// src/spaces/quartier/VueQuartier.tsx
// =============================================================================
// VIS-70 — mise en page « bureau de vente » de la page Quartier / Plan masse (présentation seule, sans E/S) :
//   en-tête (projet, menu Plan masse · Situation · Extérieur · Plans · Intérieur · Galerie, Grille de vente),
//   fond aérien (carte IGN ou plan dessiné ; vue aérienne rendue au choix en Plan masse),
//   panneau des catégories cliquables → lieux réels (distance, ≈ temps à pied / vélo / transport),
//   synthèse « À 5 min à pied : … », légende des isochrones, sources et licences.
// Règles : textes lisibles sous `.jarvis-dossier * { color: inherit !important }` (couleurs préfixées + !important) ;
// boutons actifs #dbeafe / #1e3a8a ; un bouton par action.
// =============================================================================
import { useCallback, useMemo, useState } from 'react';
import { Bike, Bus, Footprints } from 'lucide-react';
import { DEFINITIONS_CATEGORIES, LIBELLES_MODE, type CategorieQuartier } from '../../lib/quartier/categoriesQuartier.ts';
import type { AtoutsQuartier, LieuQuartier } from '../../lib/quartier/atoutsQuartier.ts';
import { libelleDistance, rayonIsochroneM } from '../../lib/quartier/tempsTrajet.ts';
import { LIBELLES_VUE, type MenuVente, type VueVente } from '../../lib/quartier/navigationVente.ts';
import type { FichierDossier } from '../../lib/studio/dossierClient/dossierClientLogique.ts';
import { CarteFondQuartier } from './CarteFondQuartier';
import { PastilleCategorie, PictoCategorie } from './PictoCategorie';
import './PageQuartier.css';

export interface PropsVueQuartier {
  titre: string;
  adresse?: string | null;
  atouts: AtoutsQuartier | null;
  chargement?: boolean;
  erreur?: string | null;
  menu: MenuVente;
  vue: VueVente;
  onVue: (v: VueVente) => void;
  /** URL signée par chemin de stockage (images, film, plans) ; absente : vignette « en préparation ». */
  urls?: ReadonlyMap<string, string>;
  urlFilm?: string | null;
  onActualiser?: () => void;
  forcerPlan?: boolean;
  /** Catégorie ouverte à l'arrivée (?categorie=… : lien direct « Écoles autour du projet »). */
  categorieInitiale?: CategorieQuartier | null;
}

export function VueQuartier(p: PropsVueQuartier) {
  const [categorie, setCategorie] = useState<CategorieQuartier | null>(p.categorieInitiale ?? null);
  const [lieuActif, setLieuActif] = useState<string | null>(null);
  const [aerienneRendue, setAerienneRendue] = useState(false);
  const choisirLieu = useCallback((l: LieuQuartier) => { setCategorie(l.categorie); setLieuActif(l.id); }, []);
  const a = p.atouts;
  const surCarte = p.vue === 'plan-masse' || p.vue === 'situation';
  const urlAerienne = p.menu.vueAerienne ? p.urls?.get(p.menu.vueAerienne.cheminApercu ?? p.menu.vueAerienne.chemin) ?? null : null;

  return (
    <div className="mz-qr">
      <header className="mz-qr__entete">
        <div className="mz-qr__marque">
          <span className="mz-qr__surtitre">Mimmoza · Espace de vente</span>
          <h1 className="mz-qr__titre">{p.titre}</h1>
          {p.adresse && <span className="mz-qr__adresse">{p.adresse}</span>}
        </div>
        <nav className="mz-qr__menu" aria-label="Navigation du bureau de vente">
          {p.menu.entrees.map((e) => (
            e.lien && e.vue === 'interieur' && !p.menu.imagesInterieures.length
              ? <a key={e.vue} className="mz-qr__onglet" href={e.lien} target="_blank" rel="noopener noreferrer" title={e.detail}>{e.libelle} ↗</a>
              : <button key={e.vue} type="button" className={`mz-qr__onglet${p.vue === e.vue ? ' is-actif' : ''}${e.disponible ? '' : ' is-avenir'}`}
                  aria-current={p.vue === e.vue ? 'page' : undefined} title={e.detail} onClick={() => p.onVue(e.vue)}>{e.libelle}</button>
          ))}
        </nav>
        <a className="mz-qr__bouton mz-qr__bouton--plein" href={p.menu.grilleVente.lien}>{p.menu.grilleVente.libelle}</a>
      </header>

      <main className="mz-qr__scene">
        {surCarte && a && !(p.vue === 'plan-masse' && aerienneRendue && urlAerienne) && (
          <CarteFondQuartier atouts={a} categorie={p.vue === 'situation' ? categorie : null} lieuActif={lieuActif} onLieu={choisirLieu}
            cadrage={p.vue === 'plan-masse' ? 'plan-masse' : 'situation'} forcerPlan={p.forcerPlan} />
        )}
        {surCarte && p.vue === 'plan-masse' && aerienneRendue && urlAerienne && (
          <div className="mz-qr-fond mz-qr-fond--image" style={{ backgroundImage: `url("${urlAerienne}")` }} role="img" aria-label="Vue aérienne rendue du projet" />
        )}
        {surCarte && !a && <div className="mz-qr-fond mz-qr-fond--vide" />}

        {p.vue === 'situation' && (
          <aside className="mz-qr__panneau" aria-label="Atouts du quartier">
            <h2 className="mz-qr__h2">Situation</h2>
            {p.chargement && !a && <p className="mz-qr__texte">Lecture des équipements, transports et commerces autour du projet…</p>}
            {p.erreur && <p className="mz-qr__alerte">{p.erreur}</p>}
            {a && (
              <>
                <div className="mz-qr__synthese">
                  <p className="mz-qr__synthese-phrase">{a.synthese.phrase}</p>
                  <p className="mz-qr__synthese-transport">{a.synthese.phraseTransports}</p>
                </div>
                {categorie === null
                  ? <ListeCategories atouts={a} onChoisir={(c) => { setCategorie(c); setLieuActif(null); }} />
                  : <DetailCategorie atouts={a} id={categorie} lieuActif={lieuActif} onLieu={choisirLieu} onRetour={() => { setCategorie(null); setLieuActif(null); }} />}
                {p.onActualiser && <button type="button" className="mz-qr__bouton mz-qr__bouton--discret" onClick={p.onActualiser}>Actualiser les données</button>}
              </>
            )}
          </aside>
        )}

        {p.vue === 'plan-masse' && (
          <aside className="mz-qr__panneau mz-qr__panneau--court" aria-label="Plan masse">
            <h2 className="mz-qr__h2">Plan masse</h2>
            <p className="mz-qr__texte">{p.titre}{p.adresse ? ` — ${p.adresse}` : ''}. La parcelle du projet est soulignée en or ; les cercles marquent 5, 10 et 15 minutes à pied.</p>
            <div className="mz-qr__actions">
              <button type="button" className={`mz-qr__bouton${!aerienneRendue ? ' is-actif' : ''}`} aria-pressed={!aerienneRendue} onClick={() => setAerienneRendue(false)}>Vue satellite</button>
              <button type="button" className={`mz-qr__bouton${aerienneRendue ? ' is-actif' : ''}`} aria-pressed={aerienneRendue} disabled={!urlAerienne}
                title={urlAerienne ? 'Vue aérienne rendue du projet' : 'Aucune vue aérienne rendue : commandez la vue « aérien » dans le chat'} onClick={() => setAerienneRendue(true)}>Vue aérienne rendue</button>
            </div>
            {a && <p className="mz-qr__texte mz-qr__texte--petit">{a.synthese.phrase}</p>}
          </aside>
        )}

        {surCarte && a && (
          <div className="mz-qr__legende" aria-label="Légende">
            <span><i className="mz-qr__legende-projet" />Le projet</span>
            {[5, 10, 15].map((m) => <span key={m}><i className={`mz-qr__legende-anneau${m === 5 ? ' is-plein' : ''}`} />{m} min à pied (≈ {libelleDistance(rayonIsochroneM(m, 'pied', a.urbain))})</span>)}
          </div>
        )}

        {!surCarte && <Galerie vue={p.vue} menu={p.menu} urls={p.urls} urlFilm={p.urlFilm} />}
      </main>

      <footer className="mz-qr__pied">
        {a && <span>Sources : {a.sources.map((s) => `${s.libelle} (${s.licence})${s.ok ? '' : ' — indisponible'}`).join(' · ')} · Fond : IGN Géoplateforme (Licence Ouverte 2.0).</span>}
        <span>{a?.avertissements[0] ?? 'Temps indicatifs et non contractuels.'} Images non contractuelles.</span>
      </footer>
    </div>
  );
}

function ListeCategories({ atouts, onChoisir }: { atouts: AtoutsQuartier; onChoisir: (c: CategorieQuartier) => void }) {
  return (
    <ul className="mz-qr__categories">
      {atouts.categories.map((c) => (
        <li key={c.id}>
          <button type="button" className="mz-qr__categorie" onClick={() => onChoisir(c.id)} aria-label={`${c.libelle} : ${c.phrase}`}>
            <PastilleCategorie id={c.id} />
            <span className="mz-qr__categorie-texte">
              <strong>{c.libelle}</strong>
              <small>{c.etat === 'indisponible' ? 'Donnée momentanément indisponible' : c.plusProche
                ? `${c.plusProche.nom === c.plusProche.sousType ? c.plusProche.sousType : c.plusProche.nom} · ${tempsCourt(c.plusProche)}` : 'Aucun lieu recensé dans le rayon'}</small>
            </span>
            <span className={`mz-qr__compte${c.etat !== 'ok' ? ' is-vide' : ''}`}>{c.etat === 'ok' ? c.total : '—'}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function tempsCourt(l: LieuQuartier): string {
  if (l.pied_min <= 20) return `${l.pied_min} min à pied`;
  if (l.transport_min !== null) return `≈ ${l.transport_min} min en transport`;
  if (l.velo_min !== null) return `${l.velo_min} min à vélo`;
  return libelleDistance(l.distance_m);
}

function DetailCategorie({ atouts, id, lieuActif, onLieu, onRetour }: { atouts: AtoutsQuartier; id: CategorieQuartier; lieuActif: string | null; onLieu: (l: LieuQuartier) => void; onRetour: () => void }) {
  const c = atouts.categories.find((x) => x.id === id)!;
  const def = DEFINITIONS_CATEGORIES[id];
  const sources = useMemo(() => [...new Set(c.lieux.map((l) => l.source))], [c]);
  return (
    <div className="mz-qr__detail">
      <div className="mz-qr__detail-entete">
        <button type="button" className="mz-qr__bouton mz-qr__bouton--discret" onClick={onRetour}>← Toutes les catégories</button>
        <h3 className="mz-qr__h3" style={{ color: def.couleur }}><PictoCategorie id={id} taille={18} couleur={def.couleur} /> {c.libelle}</h3>
      </div>
      {c.etat !== 'ok' && <p className="mz-qr__texte">{c.phrase}</p>}
      <ol className="mz-qr__lieux">
        {c.lieux.map((l) => (
          <li key={l.id}>
            <button type="button" className={`mz-qr__lieu${l.id === lieuActif ? ' is-actif' : ''}`} onClick={() => onLieu(l)} disabled={l.lat === null}
              title={l.lat === null ? 'Position non fournie par la source : distance seulement' : 'Situer sur la carte'}>
              <span className="mz-qr__lieu-nom">{l.nom}</span>
              <span className="mz-qr__lieu-type">{l.mode ? LIBELLES_MODE[l.mode] : l.sousType}{l.lignes?.length ? ` · lignes ${l.lignes.slice(0, 4).join(', ')}` : ''}</span>
              <span className="mz-qr__temps">
                <span className="mz-qr__temps-distance">{libelleDistance(l.distance_m)}</span>
                <span title="À pied"><Footprints size={13} aria-hidden="true" /> {l.pied_min} min</span>
                {l.velo_min !== null && l.distance_m >= 400 && <span title="À vélo"><Bike size={13} aria-hidden="true" /> {l.velo_min} min</span>}
                {l.transport_min !== null && <span title="En transport en commun (estimation)"><Bus size={13} aria-hidden="true" /> ≈ {l.transport_min} min</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {c.total > c.lieux.length && <p className="mz-qr__texte mz-qr__texte--petit">{c.lieux.length} lieux les plus proches sur {c.total} recensés.</p>}
      {sources.length > 0 && <p className="mz-qr__texte mz-qr__texte--petit">Source : {sources.map((s) => atouts.sources.find((x) => x.source === s)?.libelle ?? s).join(', ')}.</p>}
    </div>
  );
}

function Vignette({ f, url }: { f: FichierDossier; url?: string }) {
  return (
    <figure className="mz-qr__vignette">
      {url ? <img src={url} alt={f.libelle} loading="lazy" /> : <div className="mz-qr__vignette-attente">Aperçu non chargé</div>}
      <figcaption>{f.libelle}</figcaption>
    </figure>
  );
}

function Galerie({ vue, menu, urls, urlFilm }: { vue: VueVente; menu: MenuVente; urls?: ReadonlyMap<string, string>; urlFilm?: string | null }) {
  const entree = menu.entrees.find((e) => e.vue === vue)!;
  const url = (f: FichierDossier) => urls?.get(f.cheminApercu ?? f.chemin) ?? urls?.get(f.chemin);
  const images = vue === 'exterieur' ? menu.imagesExterieures : vue === 'interieur' ? menu.imagesInterieures : [...menu.imagesExterieures, ...menu.imagesInterieures];
  return (
    <section className="mz-qr__galerie" aria-label={LIBELLES_VUE[vue]}>
      <h2 className="mz-qr__h2 mz-qr__h2--clair">{LIBELLES_VUE[vue]}</h2>
      <p className="mz-qr__texte mz-qr__texte--clair">{entree.detail}</p>
      {vue === 'interieur' && entree.lien && <a className="mz-qr__bouton mz-qr__bouton--plein" href={entree.lien} target="_blank" rel="noopener noreferrer">Ouvrir la visite 360°</a>}
      {vue === 'plans' ? (
        <ul className="mz-qr__plans">
          {menu.plans.map((f) => (
            <li key={f.chemin}><span>{f.libelle}</span>{urls?.get(f.chemin) ? <a className="mz-qr__bouton" href={urls.get(f.chemin)} download>Télécharger</a> : <span className="mz-qr__texte--petit">Lien en préparation</span>}</li>
          ))}
        </ul>
      ) : (
        <>
          {(vue === 'exterieur' || vue === 'galerie') && urlFilm && <video className="mz-qr__film" src={urlFilm} controls preload="metadata" />}
          <div className="mz-qr__grille">{images.map((f) => <Vignette key={f.chemin} f={f} url={url(f)} />)}</div>
        </>
      )}
      {!entree.disponible && <p className="mz-qr__alerte mz-qr__alerte--clair">{entree.detail}</p>}
    </section>
  );
}
