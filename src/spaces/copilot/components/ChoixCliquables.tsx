// src/spaces/copilot/components/ChoixCliquables.tsx
// LOT CHOIX-CLIQUABLES — puces cliquables sous une question à choix de Mimmo (bloc ```mimmoza-choix).
// Cliquer n'envoie RIEN : la ligne composée (« Façade : Brique · Balcons : Loggias ») est écrite dans le
// champ de saisie du chat, où l'utilisateur complète puis envoie. Composant mince : la logique est dans
// utils/choixCliquables.ts (testée).
import { useMemo, useRef, useState } from 'react';
import {
  basculerAToi, basculerOption, composerReponse, etatVide, fusionnerSaisie, reponsesDepuisTexte, LIBELLE_A_TOI,
  type BlocChoix, type EtatChoix,
} from '../utils/choixCliquables';
import './ChoixCliquables.css';

export type RemplirSaisie = (transformer: (actuel: string) => string) => void;

export function ChoixCliquables({ bloc, messageId, actif, reponse, onRemplirSaisie }: {
  bloc: BlocChoix;
  messageId: string;
  /** Dernier message du fil : puces actives. Sinon : affichage figé. */
  actif: boolean;
  /** Texte du message utilisateur qui a suivi (affichage figé), ou null. */
  reponse: string | null;
  onRemplirSaisie?: RemplirSaisie;
}) {
  const [etat, setEtat] = useState<EtatChoix>(etatVide);
  const derniereLigne = useRef('');
  const interactif = actif && Boolean(onRemplirSaisie);
  const fige = useMemo(() => (interactif ? null : reponsesDepuisTexte(bloc, reponse ?? '')), [interactif, bloc, reponse]);
  const vue = fige ?? etat;

  const appliquer = (suivant: EtatChoix) => {
    setEtat(suivant);
    const ancienne = derniereLigne.current;
    const nouvelle = composerReponse(bloc, suivant);
    derniereLigne.current = nouvelle;
    onRemplirSaisie?.((actuel) => fusionnerSaisie(actuel, ancienne, nouvelle));
  };

  const repondu = fige !== null && (fige.aToi || Object.keys(fige.selections).length > 0);
  const base = `mzia-choix-${messageId}`;

  return (
    <div className={`mzia-choix${interactif ? '' : ' is-fige'}`} role="group" aria-label="Réponses proposées par Mimmo">
      {bloc.questions.map((q) => {
        const choisies = vue.selections[q.id] ?? [];
        const idLibelle = `${base}-${q.id}`;
        return (
          <div key={q.id} className="mzia-choix__ligne" role="group" aria-labelledby={idLibelle}>
            <span id={idLibelle} className="mzia-choix__libelle">{q.libelle}{q.multiple && <small> (plusieurs choix)</small>}</span>
            <div className="mzia-choix__puces">
              {q.options.map((o) => {
                const choisie = choisies.includes(o);
                const suggeree = q.defaut.includes(o);
                return (
                  <button
                    key={o}
                    type="button"
                    className={`mzia-choix__puce${choisie ? ' is-choisie' : ''}${suggeree ? ' is-suggeree' : ''}`}
                    aria-pressed={choisie}
                    disabled={!interactif}
                    title={suggeree ? 'Suggestion de Mimmo' : undefined}
                    onClick={() => appliquer(basculerOption(etat, bloc, q.id, o))}
                  >
                    {o}
                    {suggeree && <span className="mzia-choix__suggere" aria-label="(suggestion de Mimmo)" />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {bloc.aToiDeChoisir && (
        <div className="mzia-choix__ligne mzia-choix__ligne--a-toi">
          <button
            type="button"
            className={`mzia-choix__puce mzia-choix__puce--a-toi${vue.aToi ? ' is-choisie' : ''}`}
            aria-pressed={vue.aToi}
            disabled={!interactif}
            onClick={() => appliquer(basculerAToi(etat))}
          >
            {LIBELLE_A_TOI}
          </button>
        </div>
      )}
      <p className="mzia-choix__aide" role={interactif ? 'note' : undefined}>
        {interactif
          ? (bloc.libre
            ? 'Vos choix s’écrivent dans le champ de réponse : ajoutez vos précisions si besoin, puis envoyez.'
            : 'Vos choix s’écrivent dans le champ de réponse : envoyez quand c’est prêt.')
          : repondu ? 'Votre réponse' : reponse !== null ? 'Répondu en texte' : 'Question précédente'}
      </p>
    </div>
  );
}
