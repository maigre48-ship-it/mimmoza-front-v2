// src/spaces/copilot/studio3d/ChoixMatiereCatalogue.tsx
// =============================================================================
// VIS-31 — « Toutes les matières » : grille filtrée du catalogue extérieur, ouverte DANS la carte d'habillage
// (CarteBriefCreatif, étape 4 « Style & façades ») sous la façade, le soubassement, les menuiseries, les garde-corps
// ou la toiture. Chaque carte dit ce que le rendu en montrera (telle quelle / approchée / pas d'équivalent) et
// « avec réserve » quand c'est le cas. Chargé à la demande (lazy) : le catalogue n'alourdit pas le chat.
// Logique : matieresCatalogue.ts (pure, testée).
// =============================================================================
import { useDeferredValue, useMemo, useState } from 'react';
import { filtrerCatalogue } from './catalogueExterieur';
import { LIBELLES_PARTIE, raisonIndisponible, type ChoixBrief, type DemandeBrief, type EtatBrief, type MatiereCatalogueChoisie, type PartieMatiere } from './briefCreatif';
import { matiereChoisie, matieresDeLaPartie, phraseRendu, traduireMatiere } from './matieresCatalogue';
import './ChoixMatiereCatalogue.css';

const UTILISER: Record<PartieMatiere, string> = {
  facade: 'Utiliser pour la façade', soubassement: 'Utiliser pour le soubassement', menuiseries: 'Utiliser pour les menuiseries',
  garde_corps: 'Utiliser pour les garde-corps', toiture: 'Utiliser pour la toiture',
};

export interface PropsChoixMatiere {
  partie: PartieMatiere;
  etat: EtatBrief;
  demande: Pick<DemandeBrief, 'ambiances' | 'limites'>;
  onChoisir: (matiere: MatiereCatalogueChoisie, champs: Partial<ChoixBrief>) => void;
  onFermer: () => void;
}

/** Raison pour laquelle la matière ne peut pas être choisie ici (mêmes règles que les boutons de la carte) ; null sinon. */
function raisonDe(partie: PartieMatiere, champs: Partial<ChoixBrief>, etat: EtatBrief, demande: PropsChoixMatiere['demande']): string | null {
  let choix = etat.choix;
  for (const champ of ['facade', 'teinte', 'soubassement', 'menuiseries', 'garde_corps', 'toiture'] as const) {
    const v = champs[champ];
    if (v === undefined) continue;
    const r = raisonIndisponible(champ, v, choix, demande);
    if (r) return r;
    choix = { ...choix, [champ]: v };
  }
  if (partie === 'garde_corps') return raisonIndisponible('garde_corps', choix.garde_corps, choix, demande);
  return null;
}

export default function ChoixMatiereCatalogue({ partie, etat, demande, onChoisir, onFermer }: PropsChoixMatiere) {
  const [saisie, setSaisie] = useState('');
  const cherche = useDeferredValue(saisie);
  const toutes = useMemo(() => matieresDeLaPartie(partie), [partie]);
  const visibles = useMemo(() => filtrerCatalogue({ texte: cherche }, toutes), [cherche, toutes]);
  const actuelle = etat.matieres?.[partie]?.ref ?? null;
  return (
    <div className="mz-matcat" role="region" aria-label={`Toutes les matières : ${LIBELLES_PARTIE[partie]}`}>
      <div className="mz-matcat__tete">
        <strong>Toutes les matières · {LIBELLES_PARTIE[partie]}</strong>
        <span className="mz-matcat__compte">{visibles.length === toutes.length ? `${toutes.length} matières rendues` : `${visibles.length} sur ${toutes.length}`}</span>
        <button type="button" className="mz-matcat__fermer" onClick={onFermer}>Fermer</button>
      </div>
      <label className="mz-matcat__recherche">
        <span className="mz-matcat__sr">Rechercher une matière</span>
        <input type="search" value={saisie} onChange={(ev) => setSaisie(ev.target.value)} placeholder="Rechercher : brique, enduit, zinc, bois…"
          autoComplete="off" spellCheck={false} enterKeyHint="search" />
      </label>
      <p className="mz-matcat__aide">Seules les matières qui apparaissent dans les images sont proposées. « Avec réserve » : rendue, avec la limite indiquée.</p>
      {visibles.length === 0 && <p className="mz-matcat__vide">Aucune matière ne correspond à « {saisie} ».</p>}
      <ul className="mz-matcat__grille">
        {visibles.map((e) => {
          const tr = traduireMatiere(partie, e);
          const raison = raisonDe(partie, tr.champs, etat, demande);
          const choisie = actuelle === (e.refStudio ?? e.id);
          return (
            <li key={e.id} className={`mz-matcat__carte${choisie ? ' is-choisie' : ''}`} data-traduction={tr.traduction} data-rendu={e.rendu}>
              <span className="mz-matcat__vignette" style={{ backgroundColor: e.apercu.couleur }} aria-hidden="true">
                {e.apercu.image && <img src={e.apercu.image} alt="" loading="lazy" decoding="async" />}
              </span>
              <span className="mz-matcat__nom">{e.nom}</span>
              <span className={`mz-matcat__badge mz-matcat__badge--${e.rendu}`}>{e.rendu === 'oui' ? 'Repris dans les images' : 'Avec réserve'}</span>
              <span className="mz-matcat__rendu">{phraseRendu(tr)}</span>
              {e.rendu === 'reserve' && <span className="mz-matcat__note">{e.noteRendu}</span>}
              <button type="button" className="mz-matcat__choisir" disabled={!!raison || choisie} title={raison ?? undefined}
                onClick={() => onChoisir(matiereChoisie(partie, e), tr.champs)}>
                {choisie ? 'Choisie' : raison ? 'Indisponible ici' : UTILISER[partie]}
              </button>
              {raison && <span className="mz-matcat__note">{raison}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
