// src/spaces/copilot/studio3d/PageCatalogueExterieur.tsx
// =============================================================================
// VIS-24 — Page « Catalogue extérieur » (/mimmozia/catalogue-exterieur, ouverte dans un nouvel onglet).
// Montre TOUT ce qui existe pour l'extérieur d'un projet (matières, toitures, fenêtres, balcons,
// clôtures, végétation, mobilier, voitures…) avec un statut honnête par entrée :
//   « Au choix dans le chat » · « Visible dans le Studio » · « Repris dans les images » /
//   « Repris avec réserve » / « Pas encore rendu ».
// Les données viennent du module généré ./catalogueExterieur.ts (aucune donnée écrite ici).
// Vignettes : photo de la vraie texture ou vignette du vrai modèle 3D quand le site la sert
// (public/catalogue-exterieur/) ; sinon une pastille de teinte étiquetée « Aperçu indicatif ».
// Les filtres vivent dans l'adresse (?famille=…&rendu=…&chat=1&studio=1&q=…) : un lien peut
// ouvrir la page déjà filtrée (adresseCatalogueExterieur).
//
// VIS-31 (24/11) — « Je n'ai pas pu chercher les textures » : le champ de recherche était lié DIRECTEMENT à l'adresse
// (value = ?q=…). Or React Router 7 met à jour l'adresse dans une transition React (BrowserRouter → startTransition) :
// après chaque frappe, React remettait le champ à son ancienne valeur en attendant la transition, et les lettres tapées
// pendant le rendu des 256 cartes se perdaient (« brique » tapé → « bque », 0 résultat ; preuve : _to_delete/vis31).
// Le texte tapé vit maintenant dans un état local (mise à jour immédiate) ; l'adresse suit après une courte pause, et le
// filtrage du gros catalogue est différé (useDeferredValue) pour que la frappe reste fluide.
// =============================================================================
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CATALOGUE_EXTERIEUR, DATE_REGISTRE_PHOTOREALISME, FAMILLES_EXTERIEUR, LIBELLES_CHAT, LIBELLES_RENDU, LIBELLE_STUDIO,
  compterCatalogue, filtrerCatalogue, filtreDepuisAdresse,
  type EntreeCatalogueExterieur, type FamilleExterieur, type FiltreCatalogue, type StatutRendu,
} from './catalogueExterieur';
import './PageCatalogueExterieur.css';

const CHAMPS: Readonly<Record<string, string>> = {
  facade: 'Façade', teinte: 'Teinte', toiture: 'Toiture', menuiseries: 'Menuiseries', garde_corps: 'Garde-corps', balcons: 'Balcons',
  ouvertures: 'Fenêtres', soubassement: 'Soubassement', attique: 'Toit', rdc: 'Rez-de-chaussée', ambiance: 'Lumière', style: 'Style',
};
const RENDUS: readonly StatutRendu[] = ['oui', 'reserve', 'non'];

/** Vrai si la teinte est claire (le pictogramme passe alors en foncé). */
function teinteClaire(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255; const v = (n >> 8) & 255; const b = n & 255;
  return 0.299 * r + 0.587 * v + 0.114 * b > 150;
}

/** Pictogramme schématique d'une famille (éléments sans vignette réelle). */
function Picto({ famille }: { famille: FamilleExterieur }) {
  const commun = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  const dessin = (() => {
    switch (famille) {
      case 'toitures': return <><path d="M6 30 L24 14 L42 30" /><path d="M11 27 V38 H37 V27" /></>;
      case 'menuiseries': return <><rect x="13" y="9" width="22" height="30" rx="1.5" /><path d="M24 9 V39 M13 24 H35" /></>;
      case 'balcons': return <><path d="M9 26 H39 M9 26 V38 H39 V26" /><path d="M15 26 V38 M21 26 V38 M27 26 V38 M33 26 V38" /><path d="M14 26 V11 H34 V26" /></>;
      case 'clotures': return <><path d="M7 20 H41 M7 34 H41" /><path d="M11 14 V38 M19 14 V38 M27 14 V38 M35 14 V38" /></>;
      case 'vegetation': return <><circle cx="24" cy="18" r="11" /><path d="M24 29 V40 M18 40 H30" /></>;
      case 'mobilier': return <><path d="M9 24 H39 M11 24 V37 M37 24 V37 M9 17 H39 V24" /></>;
      case 'vie': return <><path d="M8 31 V26 L13 18 H33 L40 26 V31 Z" /><circle cx="15" cy="32" r="3.5" /><circle cx="33" cy="32" r="3.5" /></>;
      case 'ciel': return <><circle cx="24" cy="24" r="7" /><path d="M24 8 V12 M24 36 V40 M8 24 H12 M36 24 H40 M13 13 L16 16 M32 32 L35 35 M35 13 L32 16 M16 32 L13 35" /></>;
      case 'sols': return <><path d="M6 36 H42 M10 28 H38 M14 20 H34" /></>;
      default: return <><rect x="10" y="10" width="28" height="30" rx="1.5" /><path d="M10 20 H38 M10 30 H38 M19 10 V20 M29 20 V30 M19 30 V40" /></>;
    }
  })();
  return <svg className="mz-catext__picto" viewBox="0 0 48 48" aria-hidden="true" {...commun}>{dessin}</svg>;
}

function Carte({ e }: { e: EntreeCatalogueExterieur }) {
  const chemins = [...new Set(e.choixBrief.map((c) => `${CHAMPS[c.champ] ?? c.champ} › ${c.libelle}`))];
  return (
    <article className="mz-catext__carte" data-rendu={e.rendu}>
      <div className={`mz-catext__vignette${teinteClaire(e.apercu.couleur) ? ' is-claire' : ''}`} style={{ backgroundColor: e.apercu.couleur }}>
        {e.apercu.image
          ? <img src={e.apercu.image} alt="" loading="lazy" decoding="async" />
          : e.nature === 'element' ? <Picto famille={e.famille} /> : null}
        <span className={`mz-catext__mention mz-catext__mention--${e.apercu.type}`}>{e.apercu.mention}</span>
      </div>
      <div className="mz-catext__corps">
        <h3>{e.nom}</h3>
        <p className="mz-catext__application">{e.application}</p>
        <p className="mz-catext__description">{e.description}</p>
        <ul className="mz-catext__badges" aria-label="Statut">
          <li className={`mz-catext__badge mz-catext__badge--${e.rendu}`}>{LIBELLES_RENDU[e.rendu].libelle}</li>
          {e.studio && <li className="mz-catext__badge mz-catext__badge--studio">{LIBELLE_STUDIO.libelle}</li>}
          {e.chat !== 'non' && <li className={`mz-catext__badge mz-catext__badge--${e.chat}`}>{LIBELLES_CHAT[e.chat].libelle}</li>}
        </ul>
        <p className="mz-catext__note">{e.noteRendu}</p>
        {chemins.length > 0 && <p className="mz-catext__chemin"><span>Dans le chat :</span> {chemins.join(' · ')}</p>}
      </div>
    </article>
  );
}

/** Délai avant d'écrire la recherche dans l'adresse (le filtrage, lui, suit la frappe). */
export const DELAI_ADRESSE_MS = 300;

export default function PageCatalogueExterieur() {
  const [params, setParams] = useSearchParams();
  const filtreAdresse = useMemo(() => filtreDepuisAdresse(params.toString()), [params]);
  // VIS-31 : le champ ne dépend JAMAIS de l'adresse après l'ouverture de la page (voir l'en-tête).
  const [saisie, setSaisie] = useState(() => filtreAdresse.texte ?? '');
  const ecrite = useRef(saisie);
  const texteCherche = useDeferredValue(saisie);
  const filtre = useMemo<FiltreCatalogue>(() => ({ ...filtreAdresse, texte: texteCherche }), [filtreAdresse, texteCherche]);
  const total = useMemo(() => compterCatalogue(), []);
  const visibles = useMemo(() => filtrerCatalogue(filtre), [filtre]);
  /** Décompte par famille, tous filtres appliqués SAUF la famille (pour les pastilles de famille). */
  const parFamille = useMemo(() => {
    const base = filtrerCatalogue({ ...filtre, famille: null });
    return new Map(FAMILLES_EXTERIEUR.map((f) => [f.id, base.filter((e) => e.famille === f.id).length] as const));
  }, [filtre]);
  const toutes = useMemo(() => [...parFamille.values()].reduce((a, b) => a + b, 0), [parFamille]);

  useEffect(() => {
    const avant = document.title;
    document.title = 'Catalogue extérieur — MimmozIA';
    return () => { document.title = avant; };
  }, []);

  // Toujours repartir de l'adresse RÉELLE (et non d'une copie de `params` qui peut dater d'avant la dernière transition).
  const changer = (cle: string, valeur: string | null) => {
    const p = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : params.toString());
    if (valeur) p.set(cle, valeur); else p.delete(cle);
    setParams(p, { replace: true });
  };
  // La recherche part dans l'adresse (lien partageable) après une courte pause de frappe.
  useEffect(() => {
    if (saisie === ecrite.current) return undefined;
    const t = window.setTimeout(() => { ecrite.current = saisie; changer('q', saisie.trim() ? saisie : null); }, DELAI_ADRESSE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saisie]);
  const toutEffacer = () => { ecrite.current = ''; setSaisie(''); setParams(new URLSearchParams(), { replace: true }); };
  const basculer = (cle: keyof Pick<FiltreCatalogue, 'chat' | 'studio'>) => changer(cle, filtre[cle] ? null : '1');
  const filtreActif = Boolean(filtre.famille || filtre.rendu || filtre.chat || filtre.studio || saisie.trim());
  const sections = FAMILLES_EXTERIEUR.map((f) => ({ f, entrees: visibles.filter((e) => e.famille === f.id) })).filter((s) => s.entrees.length > 0);

  return (
    <div className="mz-catext">
      <header className="mz-catext__tete">
        <Link className="mz-catext__retour" to="/mimmozia">← MimmozIA</Link>
        <h1>Catalogue extérieur</h1>
        <p className="mz-catext__chapo">
          Toutes les matières et tous les éléments 3D prévus pour l’extérieur d’un projet : façades, toitures, fenêtres, balcons, clôtures,
          végétation, mobilier, voitures. Pour chacun, la page dit sans détour s’il est au choix dans le chat, visible dans le Studio,
          et s’il apparaît vraiment dans les images rendues.
        </p>
        <p className="mz-catext__usage">
          Pour habiller votre projet avec une de ces matières : dans le chat, étape 4 « Style &amp; façades » → « Choisir » (ou
          « Modifier »), puis « Toutes les matières » sous la façade, le soubassement, les menuiseries, les garde-corps ou la toiture.
        </p>
        <ul className="mz-catext__chiffres" aria-label="Le catalogue en chiffres">
          <li><strong>{total.total}</strong><span>entrées, dont {total.matieres} matières et {total.elements} éléments</span></li>
          <li><strong>{total.chat}</strong><span>au choix dans le chat</span></li>
          <li><strong>{total.studio}</strong><span>visibles dans le Studio</span></li>
          <li className="is-oui"><strong>{total.rendu.oui}</strong><span>repris dans les images</span></li>
          <li className="is-reserve"><strong>{total.rendu.reserve}</strong><span>repris avec réserve</span></li>
          <li className="is-non"><strong>{total.rendu.non}</strong><span>pas encore rendus</span></li>
        </ul>
      </header>

      <section className="mz-catext__legende" aria-label="Comment lire les statuts">
        <h2>Comment lire cette page</h2>
        <dl>
          {RENDUS.map((r) => (
            <div key={r}><dt><span className={`mz-catext__badge mz-catext__badge--${r}`}>{LIBELLES_RENDU[r].libelle}</span></dt><dd>{LIBELLES_RENDU[r].explication}</dd></div>
          ))}
          <div><dt><span className="mz-catext__badge mz-catext__badge--studio">{LIBELLE_STUDIO.libelle}</span></dt><dd>{LIBELLE_STUDIO.explication}</dd></div>
          <div><dt><span className="mz-catext__badge mz-catext__badge--propose">{LIBELLES_CHAT.propose.libelle}</span></dt><dd>{LIBELLES_CHAT.propose.explication}</dd></div>
          <div><dt><span className="mz-catext__badge mz-catext__badge--bientot">{LIBELLES_CHAT.bientot.libelle}</span></dt><dd>{LIBELLES_CHAT.bientot.explication}</dd></div>
        </dl>
        <p className="mz-catext__legende-vignettes">
          Vignettes : « Photo de la texture » et « Vignette du modèle 3D » montrent le vrai fichier utilisé. « Aperçu indicatif » est une simple
          pastille de couleur ou un schéma : ce n’est pas une image du rendu.
        </p>
      </section>

      <section className="mz-catext__filtres" aria-label="Filtrer le catalogue">
        <label className="mz-catext__recherche">
          <span className="mz-catext__sr">Rechercher</span>
          <input type="search" placeholder="Rechercher : brique, enduit, tuile, bois, verre, haie…" value={saisie} onChange={(ev) => setSaisie(ev.target.value)}
            autoComplete="off" spellCheck={false} enterKeyHint="search" />
        </label>
        <div className="mz-catext__puces" role="group" aria-label="Famille">
          <button type="button" className={!filtre.famille ? 'is-actif' : ''} aria-pressed={!filtre.famille} onClick={() => changer('famille', null)}>Tout <em>{toutes}</em></button>
          {FAMILLES_EXTERIEUR.map((f) => (
            <button key={f.id} type="button" className={filtre.famille === f.id ? 'is-actif' : ''} aria-pressed={filtre.famille === f.id}
              onClick={() => changer('famille', filtre.famille === f.id ? null : f.id)}>{f.libelle} <em>{parFamille.get(f.id) ?? 0}</em></button>
          ))}
        </div>
        <div className="mz-catext__puces mz-catext__puces--statuts" role="group" aria-label="Statut">
          {RENDUS.map((r) => (
            <button key={r} type="button" className={`mz-catext__puce--${r}${filtre.rendu === r ? ' is-actif' : ''}`} aria-pressed={filtre.rendu === r}
              onClick={() => changer('rendu', filtre.rendu === r ? null : r)}>{LIBELLES_RENDU[r].libelle}</button>
          ))}
          <button type="button" className={`mz-catext__puce--studio${filtre.studio ? ' is-actif' : ''}`} aria-pressed={Boolean(filtre.studio)} onClick={() => basculer('studio')}>{LIBELLE_STUDIO.libelle}</button>
          <button type="button" className={`mz-catext__puce--propose${filtre.chat ? ' is-actif' : ''}`} aria-pressed={Boolean(filtre.chat)} onClick={() => basculer('chat')}>{LIBELLES_CHAT.propose.libelle}</button>
          {filtreActif && <button type="button" className="mz-catext__effacer" onClick={toutEffacer}>Effacer les filtres</button>}
        </div>
        <p className="mz-catext__compte" aria-live="polite">
          {visibles.length === CATALOGUE_EXTERIEUR.length ? `${visibles.length} entrées` : `${visibles.length} entrée${visibles.length > 1 ? 's' : ''} sur ${CATALOGUE_EXTERIEUR.length}`}
        </p>
      </section>

      {sections.length === 0 && (
        <p className="mz-catext__vide">Rien ne correspond à ces filtres. <button type="button" onClick={toutEffacer}>Tout afficher</button></p>
      )}

      {sections.map(({ f, entrees }) => {
        const d = compterCatalogue(entrees);
        return (
          <section key={f.id} className="mz-catext__famille" aria-labelledby={`mz-catext-${f.id}`}>
            <div className="mz-catext__famille-tete">
              <h2 id={`mz-catext-${f.id}`}>{f.libelle}</h2>
              <p>{f.description}</p>
              <p className="mz-catext__famille-bilan">
                {entrees.length} entrée{entrees.length > 1 ? 's' : ''} : {d.rendu.oui} reprise{d.rendu.oui > 1 ? 's' : ''} dans les images, {d.rendu.reserve} avec réserve, {d.rendu.non} pas encore rendue{d.rendu.non > 1 ? 's' : ''}.
              </p>
            </div>
            <div className="mz-catext__grille">
              {entrees.map((e) => <Carte key={e.id} e={e} />)}
            </div>
          </section>
        );
      })}

      <footer className="mz-catext__pied">
        <p>
          Les statuts de rendu suivent le registre de validation des images du {DATE_REGISTRE_PHOTOREALISME.split('-').reverse().join('/')} : un élément
          qui n’est pas validé est masqué plutôt que montré dégradé. Les vignettes sont des aperçus, pas des images contractuelles.
        </p>
      </footer>
    </div>
  );
}
