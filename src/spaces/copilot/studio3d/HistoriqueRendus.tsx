// src/spaces/copilot/studio3d/HistoriqueRendus.tsx
// =============================================================================
// « Déjà réalisés » de l'écran des rendus (FilmVisitePanel), extrait le 24/11/2026 (VIS-28) :
//   · avec un parcours, seuls les rendus de SON type sont listés (visite 360° dans le parcours Visite 360°…) ; les
//     autres restent accessibles derrière un lien discret « Autres rendus (n) » ;
//   · rendu en échec : le message est gardé et UN bouton « Relancer » relance le même rendu (mêmes options). Les rendus
//     ne débitent aucun jeton (insertion studio_jobs sans débit ; le devis du chat l'annonce) : pas de double facturation.
// Imports relatifs (pas d'alias « @ ») : le composant se rend dans les tests node (react-dom/server).
// =============================================================================
import { useState } from 'react';
import { Check, Copy, ExternalLink, Image as IconeImage, Loader2, Play, RotateCcw } from 'lucide-react';
import {
  dateCourte, LIBELLES_TYPE, libelleStatut, phraseElementsOmis, phraseSuivi, resumeOptions,
  type ResultatImage, type ResultatVisite, type TravailStudio, type TypeTravail,
} from '../../../lib/studio/travauxLogique.ts';
import { rendusDuType } from './renduParcours.ts';
// VIS-46 : scénario du film (options.scenario, sinon mémo de la fiche) — « Relancer avec ce scénario », « Repartir de ce scénario ».
import { scenarioDuTravail } from './scenarioFilmChat.ts';
import type { ScenarioFilm } from '../../../lib/studio/scenarioFilm.ts';

/** VIS-18b — rendu d'aperçu (image, film ou visite) : `options.qualite` (l'image le porte aussi dans son résultat). */
export const estApercu = (t: TravailStudio): boolean => (t.options as { qualite?: unknown } | null)?.qualite === 'apercu';

export interface ActionsHistorique {
  onVoirFilm: (t: TravailStudio) => void;
  onVoirImage: (t: TravailStudio) => void;
  onCopierLien: (visiteId: string) => void;
  /** Identifiant de la visite dont le lien vient d'être copié. */
  copie?: string | null;
  onValiderApercu?: (travailId: string) => void;
  apercuValide?: string | null;
  /** Rendu en échec : relance du même rendu (mêmes options). */
  onRelancer?: (t: TravailStudio) => void;
  /** Identifiant du rendu en cours de relance (bouton désactivé, pas de double lancement). */
  relance?: string | null;
  /**
   * VIS-46 — film avec scénario : « Relancer avec ce scénario » (lancer : le serveur ne relance QUE si le film précédent
   * a échoué ou a été annulé, sinon « déjà lancé ») ou « Repartir de ce scénario » (modifier : la carte se rouvre).
   */
  onScenario?: (action: 'lancer' | 'modifier', s: ScenarioFilm) => void;
}

function LigneRendu({ t, a }: { t: TravailStudio; a: ActionsHistorique }) {
  const omis = phraseElementsOmis(t.elements_omis);
  const sc = scenarioDuTravail(t);
  const resultatVisite = t.type === 'visite360' ? t.resultat as ResultatVisite | null : null;
  return <li>
    <div className="mzia-rendu__ligne">
      <span><b>{LIBELLES_TYPE[t.type]}</b> · {resumeOptions(t.type, t.options)}<br /><small>{dateCourte(t.cree_le)} — {libelleStatut(t.statut)}</small></span>
      {t.statut === 'termine' && t.type === 'film' && t.resultat && <button type="button" className="is-primaire" onClick={() => a.onVoirFilm(t)}><Play size={13} /> {estApercu(t) ? 'Voir l’aperçu' : 'Voir le film'}</button>}
      {/* VIS-18b : aperçu de film / de visite — validation (étape 7), comme l'aperçu d'image. */}
      {t.statut === 'termine' && t.type !== 'image' && estApercu(t) && a.onValiderApercu && a.apercuValide !== t.id
        && <button type="button" onClick={() => a.onValiderApercu?.(t.id)}>Valider cet aperçu</button>}
      {t.statut === 'termine' && t.type === 'image' && t.resultat && <button type="button" className="is-primaire" onClick={() => a.onVoirImage(t)}><IconeImage size={13} /> {(t.resultat as ResultatImage).qualite === 'apercu' ? 'Voir l’aperçu' : 'Voir l’image'}</button>}
      {t.statut === 'termine' && t.type === 'image' && (t.resultat as ResultatImage | null)?.qualite === 'apercu' && a.onValiderApercu && a.apercuValide !== t.id
        && <button type="button" onClick={() => a.onValiderApercu?.(t.id)}>Valider l’aperçu</button>}
      {t.statut === 'termine' && resultatVisite && <span className="mzia-rendu__actions">
        <a className="mzia-rendu__bouton is-primaire" href={`/visite/${encodeURIComponent(resultatVisite.visite_id)}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Ouvrir la visite</a>
        <button type="button" onClick={() => a.onCopierLien(resultatVisite.visite_id)}>{a.copie === resultatVisite.visite_id ? <><Check size={13} /> Copié</> : <><Copy size={13} /> Copier le lien</>}</button>
      </span>}
      {/* 24/11 : échec — UN bouton, même action que « Lancer » avec les mêmes options. */}
      {t.statut === 'echec' && a.onRelancer && <button type="button" className="is-primaire mzia-rendu__relancer" disabled={!!a.relance}
        aria-label={`Relancer — ${LIBELLES_TYPE[t.type]}`} onClick={() => a.onRelancer?.(t)}>
        {a.relance === t.id ? <><Loader2 size={13} className="mzia-rendu__tourne" /> Relance…</> : <><RotateCcw size={13} /> Relancer</>}
      </button>}
    </div>
    {sc && <div className="mzia-rendu__ligne mzia-rendu__scenario">
      <small>Scénario « {sc.scenario.titre} » — {String(sc.scenario.duree_s).replace('.', ',')} s, {sc.scenario.plans.length} plans{sc.transmis ? '' : ' (dans la fiche du travail : base sans migration)'}</small>
      {a.onScenario && <span className="mzia-rendu__actions">
        <button type="button" onClick={() => a.onScenario?.('lancer', sc.scenario)}><RotateCcw size={13} /> Relancer avec ce scénario</button>
        <button type="button" onClick={() => a.onScenario?.('modifier', sc.scenario)}>Repartir de ce scénario</button>
      </span>}
    </div>}
    {t.statut === 'echec' && <small className="mzia-rendu__erreur">{phraseSuivi(t)}</small>}
    {t.statut === 'termine' && omis && <small className="mzia-rendu__omis">{omis}</small>}
  </li>;
}

/** Rendus terminés, en échec ou annulés ; `type` : celui du parcours (null : pas de parcours, tout est listé). */
export function HistoriqueRendus({ travaux, type, max = 4, ...a }: ActionsHistorique & { travaux: readonly TravailStudio[]; type?: TypeTravail | null; max?: number }) {
  const [autresOuverts, setAutresOuverts] = useState(false);
  const { duType, autres } = rendusDuType(travaux, type);
  if (!duType.length && !autres.length) return null;
  return <div className="mzia-rendu__historique">
    {duType.length > 0 && <>
      <h3>Déjà réalisés</h3>
      <ul>{duType.slice(0, max).map((t) => <LigneRendu key={t.id} t={t} a={a} />)}</ul>
    </>}
    {autres.length > 0 && <>
      <button type="button" className="mzia-rendu__autres" aria-expanded={autresOuverts} onClick={() => setAutresOuverts((o) => !o)}>
        {autresOuverts ? 'Masquer les autres rendus' : `Autres rendus (${String(autres.length)})`}
      </button>
      {autresOuverts && <ul>{autres.slice(0, max).map((t) => <LigneRendu key={t.id} t={t} a={a} />)}</ul>}
    </>}
  </div>;
}
