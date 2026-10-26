// src/spaces/copilot/studio3d/FilmVisitePanel.tsx
//
// FILM OU VISITE 360° EN 3 CLICS (contrat docs/studio/CONTRAT_FILM_VISITE.md).
//
// Dans le dossier de l'Espace 3D, sous « Voir en 3D » :
//   clic 1 — « Film » ou « Visite 360° » ;
//   clic 2 — « Lancer » sur une feuille d'options déjà remplie ;
//   suivi en direct (temps réel + sondage 5 s), bouton Annuler ;
//   clic 3 — « Voir le film » (lecteur intégré, URL signée) ou
//            « Ouvrir la visite » (/visite/<id>, lien à copier).
// Le Studio travaille en coulisses : l'utilisateur ne l'ouvre pas.
// Si la file n'existe pas encore en base : « Bientôt disponible », sans erreur.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clapperboard, Copy, ExternalLink, Loader2, Orbit, Play, X } from 'lucide-react';
import type { JarvisDraft } from './jarvisDraft';
import { parcelleRetenue, retenirParcelle } from './parcelleConfirmee';
import type { ConfirmedTerrain } from './terrainCadastre';
import { ConfirmerParcelle } from './ConfirmerParcelle';
import { avecProchaineRevision, preparerChargeVoirEn3D } from './chargeVoirEn3D';
import {
  annulerTravail, construireTravail, creerTravail, dateCourte, estActif, LIBELLES_AMBIANCE, LIBELLES_TYPE, libelleStatut,
  lienVisite, listerTravaux, optionsParDefaut, phraseElementsOmis, phraseSuivi, resumeOptions, suivreTravail, urlSigneeRendu,
  type Ambiance, type OptionsFilm, type OptionsVisite, type ResultatFilm, type ResultatVisite, type TravailStudio, type TypeTravail,
} from '@/lib/studio/travaux';
import './FilmVisitePanel.css';

const AMBIANCES: Ambiance[] = ['jour', 'fin_de_journee', 'nuit'];

export function FilmVisitePanel({ draft, conversationId, assurerValidation }: {
  draft: JarvisDraft;
  conversationId: string;
  /** Valide la fiche si elle ne l'est pas encore (comme « Voir en 3D »). */
  assurerValidation?: () => Promise<void>;
}) {
  const [disponible, setDisponible] = useState<boolean | null>(null);
  const [travaux, setTravaux] = useState<TravailStudio[]>([]);
  const [feuille, setFeuille] = useState<TypeTravail | null>(null);
  const [film, setFilm] = useState<OptionsFilm>(() => optionsParDefaut('film'));
  const [visite, setVisite] = useState<OptionsVisite>(() => optionsParDefaut('visite360'));
  const [terrainManquant, setTerrainManquant] = useState(false);
  const [lancement, setLancement] = useState(false);
  const [message, setMessage] = useState('');
  const [annonce, setAnnonce] = useState<TravailStudio | null>(null);
  const [lecteur, setLecteur] = useState<{ id: string; url: string; poster: string | null } | null>(null);
  const [copie, setCopie] = useState<string | null>(null);
  const suivis = useRef(new Map<string, () => void>());

  // Historique de la conversation (et détection « file pas encore installée »).
  useEffect(() => {
    let vivant = true;
    void listerTravaux(conversationId).then(r => {
      if (!vivant) return;
      setDisponible(r.disponible);
      if (r.disponible) setTravaux(r.valeur);
    }).catch(() => { if (vivant) setDisponible(true); });
    const actifs = suivis.current;
    return () => { vivant = false; actifs.forEach(arreter => arreter()); actifs.clear(); };
  }, [conversationId]);

  const recevoir = useCallback((t: TravailStudio) => {
    setTravaux(liste => {
      const avant = liste.find(x => x.id === t.id);
      if (avant && estActif(avant.statut) && t.statut === 'termine') setAnnonce(t);
      return avant ? liste.map(x => (x.id === t.id ? t : x)) : [t, ...liste];
    });
    if (!estActif(t.statut)) suivis.current.delete(t.id);
  }, []);

  // Suivi en direct de chaque travail actif.
  useEffect(() => {
    for (const t of travaux) {
      if (estActif(t.statut) && !suivis.current.has(t.id)) suivis.current.set(t.id, suivreTravail(t.id, recevoir));
    }
  }, [travaux, recevoir]);

  const ouvrirFeuille = (type: TypeTravail) => {
    setFeuille(type);
    setMessage('');
    setTerrainManquant(!parcelleRetenue(conversationId));
  };

  const lancer = async () => {
    if (!feuille || lancement) return;
    const terrain = parcelleRetenue(conversationId);
    if (!terrain) { setTerrainManquant(true); return; }
    setLancement(true);
    setMessage('');
    try {
      await assurerValidation?.().catch(() => undefined);
      // Même charge Studio que « Voir en 3D » (terrain, relief connu, architecture, plans).
      const { construit } = await preparerChargeVoirEn3D(draft, conversationId, terrain);
      if (!construit.ok) { setMessage(`Le projet n’a pas pu être préparé : ${construit.erreur}.`); return; }
      const charge = avecProchaineRevision(construit.projet, conversationId);
      const travail = construireTravail(feuille, draft, conversationId, charge, feuille === 'film' ? film : visite);
      if (!travail.ok) { setMessage(travail.erreur); return; }
      const r = await creerTravail(travail.valeur);
      if (!r.disponible) { setDisponible(false); setFeuille(null); return; }
      setTravaux(liste => [r.valeur, ...liste.filter(x => x.id !== r.valeur.id)]);
      setFeuille(null);
    } catch (erreur) {
      setMessage(erreur instanceof Error ? erreur.message : 'Le lancement n’a pas abouti.');
    } finally {
      setLancement(false);
    }
  };

  const annuler = async (id: string) => {
    try {
      const t = await annulerTravail(id);
      if (t) recevoir(t);
    } catch (erreur) {
      setMessage(erreur instanceof Error ? erreur.message : 'Annulation impossible.');
    }
  };

  const voirFilm = async (t: TravailStudio) => {
    const r = t.resultat as ResultatFilm | null;
    if (!r?.video_path) return;
    setMessage('');
    try {
      const [url, poster] = await Promise.all([
        urlSigneeRendu(r.video_path),
        r.poster_path ? urlSigneeRendu(r.poster_path).catch(() => null) : Promise.resolve(null),
      ]);
      setLecteur({ id: t.id, url, poster });
      setAnnonce(null);
    } catch (erreur) {
      setMessage(erreur instanceof Error ? erreur.message : 'Le film n’est pas accessible.');
    }
  };

  const copierLien = async (visiteId: string) => {
    const lien = lienVisite(visiteId, window.location.origin);
    try {
      await navigator.clipboard.writeText(lien);
      setCopie(visiteId);
      window.setTimeout(() => setCopie(c => (c === visiteId ? null : c)), 2500);
    } catch {
      window.prompt('Copiez ce lien :', lien);
    }
  };

  const confirmerTerrain = (terrain: ConfirmedTerrain & { adresse: string | null }) => {
    retenirParcelle(conversationId, terrain);
    setTerrainManquant(!parcelleRetenue(conversationId));
  };

  const actifs = travaux.filter(t => estActif(t.statut));
  const historique = travaux.filter(t => !estActif(t.statut)).slice(0, 4);
  const indispo = disponible === false;

  return (
    <section className="mzia-rendu" aria-label="Film ou visite 360°">
      <div className="mzia-rendu__entete">
        <strong>Film ou visite 360°</strong>
        <span>Calculés en qualité photo, prêts à partager.</span>
      </div>

      {indispo && <p className="mzia-rendu__bientot" role="status">Films et visites 360° : bientôt disponible.</p>}

      <div className="mzia-rendu__choix">
        <button type="button" className={feuille === 'film' ? 'is-actif' : ''} disabled={indispo || disponible === null}
          aria-pressed={feuille === 'film'} onClick={() => ouvrirFeuille('film')}>
          <Clapperboard size={22} strokeWidth={1.6} /><b>Film</b><small>Vidéo de présentation</small>
        </button>
        <button type="button" className={feuille === 'visite360' ? 'is-actif' : ''} disabled={indispo || disponible === null}
          aria-pressed={feuille === 'visite360'} onClick={() => ouvrirFeuille('visite360')}>
          <Orbit size={22} strokeWidth={1.6} /><b>Visite 360°</b><small>À parcourir dans le navigateur</small>
        </button>
      </div>

      {annonce && <div className="mzia-rendu__annonce" role="status">
        <Check size={16} /> <span>{phraseSuivi(annonce)}</span>
        {annonce.type === 'film'
          ? <button type="button" className="is-primaire" onClick={() => void voirFilm(annonce)}><Play size={14} /> Voir le film</button>
          : annonce.resultat && <>
            <a className="mzia-rendu__bouton is-primaire" href={`/visite/${encodeURIComponent((annonce.resultat as ResultatVisite).visite_id)}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Ouvrir la visite</a>
            <button type="button" onClick={() => void copierLien((annonce.resultat as ResultatVisite).visite_id)}>{copie === (annonce.resultat as ResultatVisite).visite_id ? <><Check size={13} /> Copié</> : <><Copy size={13} /> Copier le lien</>}</button>
          </>}
        <button type="button" className="mzia-rendu__fermer" aria-label="Fermer la notification" onClick={() => setAnnonce(null)}><X size={14} /></button>
        {phraseElementsOmis(annonce.elements_omis) && <small className="mzia-rendu__omis">{phraseElementsOmis(annonce.elements_omis)}</small>}
      </div>}

      {feuille && <div className="mzia-rendu__feuille" role="dialog" aria-label={`Options — ${LIBELLES_TYPE[feuille]}`}>
        <div className="mzia-rendu__feuille-barre">
          <span>{feuille === 'film' ? 'Votre film' : 'Votre visite 360°'}</span>
          <button type="button" className="mzia-rendu__fermer" aria-label="Fermer" onClick={() => setFeuille(null)}><X size={14} /></button>
        </div>
        <div className="mzia-rendu__feuille-corps">
          {feuille === 'film' && <Choix titre="Durée" valeur={film.duree_s} options={[[30, '30 s'], [60, '1 min'], [90, '1 min 30']]}
            onChange={v => setFilm(o => ({ ...o, duree_s: v }))} />}
          <Choix titre="Lumière" valeur={feuille === 'film' ? film.ambiance : visite.ambiance}
            options={AMBIANCES.map(a => [a, LIBELLES_AMBIANCE[a]] as [Ambiance, string])}
            onChange={v => (feuille === 'film' ? setFilm(o => ({ ...o, ambiance: v })) : setVisite(o => ({ ...o, ambiance: v })))} />
          {feuille === 'film' && <Choix titre="Format" valeur={film.format} options={[['16:9', 'Paysage'], ['9:16', 'Vertical (téléphone)']]}
            onChange={v => setFilm(o => ({ ...o, format: v }))} />}
          {feuille === 'visite360' && <Choix titre="Qualité" valeur={visite.resolution} options={[['6k', 'Haute'], ['8k', 'Très haute (plus long)']]}
            onChange={v => setVisite(o => ({ ...o, resolution: v }))} />}
          <label className="mzia-rendu__case">
            <input type="checkbox" checked={feuille === 'film' ? film.interieurs : visite.interieurs}
              onChange={e => (feuille === 'film' ? setFilm(o => ({ ...o, interieurs: e.target.checked })) : setVisite(o => ({ ...o, interieurs: e.target.checked })))} />
            Montrer aussi l’intérieur des logements
          </label>
          {feuille === 'film' && <label className="mzia-rendu__case">
            <input type="checkbox" checked={film.musique} onChange={e => setFilm(o => ({ ...o, musique: e.target.checked }))} />
            Ajouter une musique d’ambiance
          </label>}
          {terrainManquant && <div className="mzia-rendu__terrain">
            <p>Il manque l’emplacement du terrain.</p>
            <ConfirmerParcelle adresseInitiale={draft.localisation} libelleConfirmer="Confirmer ce terrain"
              onConfirmer={confirmerTerrain} onAnnuler={() => setFeuille(null)} />
          </div>}
          {message && <p className="mzia-rendu__erreur" role="alert">{message}</p>}
          <button type="button" className="mzia-rendu__lancer" disabled={lancement || terrainManquant} onClick={() => void lancer()}>
            {lancement ? <><Loader2 size={16} className="mzia-rendu__tourne" /> Lancement…</> : 'Lancer'}
          </button>
          <small>Vous serez prévenu ici quand ce sera prêt. Vous pouvez continuer à travailler.</small>
        </div>
      </div>}

      {!feuille && message && <p className="mzia-rendu__erreur" role="alert">{message}</p>}

      {actifs.map(t => <div key={t.id} className="mzia-rendu__suivi">
        <div className="mzia-rendu__suivi-titre"><b>{LIBELLES_TYPE[t.type]}</b><span>{libelleStatut(t.statut)}</span></div>
        <div className="mzia-rendu__barre" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={t.progression}>
          <i style={{ width: `${String(t.statut === 'en_attente' ? 3 : Math.max(3, t.progression))}%` }} className={t.statut === 'en_attente' ? 'is-attente' : ''} />
        </div>
        <p>{phraseSuivi(t)}</p>
        <button type="button" onClick={() => void annuler(t.id)}>Annuler</button>
      </div>)}

      {lecteur && <div className="mzia-rendu__lecteur">
        <video src={lecteur.url} poster={lecteur.poster ?? undefined} controls autoPlay playsInline preload="metadata" />
        <div><a className="mzia-rendu__bouton" href={lecteur.url} download target="_blank" rel="noreferrer">Télécharger</a>
          <button type="button" onClick={() => setLecteur(null)}>Fermer le lecteur</button></div>
      </div>}

      {historique.length > 0 && <div className="mzia-rendu__historique">
        <h3>Déjà réalisés</h3>
        <ul>
          {historique.map(t => {
            const omis = phraseElementsOmis(t.elements_omis);
            const resultatVisite = t.type === 'visite360' ? t.resultat as ResultatVisite | null : null;
            return <li key={t.id}>
              <div className="mzia-rendu__ligne">
                <span><b>{LIBELLES_TYPE[t.type]}</b> · {resumeOptions(t.type, t.options)}<br /><small>{dateCourte(t.cree_le)} — {libelleStatut(t.statut)}</small></span>
                {t.statut === 'termine' && t.type === 'film' && t.resultat && <button type="button" className="is-primaire" onClick={() => void voirFilm(t)}><Play size={13} /> Voir le film</button>}
                {t.statut === 'termine' && resultatVisite && <span className="mzia-rendu__actions">
                  <a className="mzia-rendu__bouton is-primaire" href={`/visite/${encodeURIComponent(resultatVisite.visite_id)}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Ouvrir la visite</a>
                  <button type="button" onClick={() => void copierLien(resultatVisite.visite_id)}>{copie === resultatVisite.visite_id ? <><Check size={13} /> Copié</> : <><Copy size={13} /> Copier le lien</>}</button>
                </span>}
              </div>
              {t.statut === 'echec' && <small className="mzia-rendu__erreur">{phraseSuivi(t)}</small>}
              {t.statut === 'termine' && omis && <small className="mzia-rendu__omis">{omis}</small>}
            </li>;
          })}
        </ul>
      </div>}
    </section>
  );
}

function Choix<T extends string | number>({ titre, valeur, options, onChange }: {
  titre: string; valeur: T; options: [T, string][]; onChange: (v: T) => void;
}) {
  return <fieldset className="mzia-rendu__groupe">
    <legend>{titre}</legend>
    <div>{options.map(([v, libelle]) => <button key={String(v)} type="button" aria-pressed={v === valeur}
      className={v === valeur ? 'is-actif' : ''} onClick={() => onChange(v)}>{libelle}</button>)}</div>
  </fieldset>;
}
