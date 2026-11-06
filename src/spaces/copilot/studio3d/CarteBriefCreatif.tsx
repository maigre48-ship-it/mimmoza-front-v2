// src/spaces/copilot/studio3d/CarteBriefCreatif.tsx
// =============================================================================
// LOT BRIEF-CRÉATIF — Carte « Brief créatif » dans le fil du chat.
//
// Affichée à la place de la carte d'outil quand `studio_lancer_rendu` demande le
// brief d'habillage (garde du serveur ou `ouvrir_brief`), et repliée sous un devis
// (« Modifier l'habillage »). Trois écrans, un clic par choix, valeurs proposées
// présélectionnées, aperçu 3D du volume réel (ApercuBrief3D, paresseux) ou, à
// défaut, vignette de façade. « Valider le brief » envoie un message utilisateur
// portant le bloc ```mimmoza-brief``` (relu et validé par le serveur).
// Toute la logique est dans briefCreatif.ts (pure, testée).
// =============================================================================
import { lazy, Suspense, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Palette, Sparkles } from 'lucide-react';
import { useCopilotStore } from '../store/copilotStore';
import {
  ECRANS, QUESTIONS, STYLES, briefEnvoyeApres, choisir, demandeDepassee, choixAppliques, etatInitial, messageBrief, optionsDe,
  raisonIndisponible, recapitulatif, type ChampCarte, type DemandeBrief, type EtatBrief,
} from './briefCreatif';
import { VignetteTravee } from './VignetteTravee';
import './CarteBriefCreatif.css';

const ApercuBrief3D = lazy(() => import('./ApercuBrief3D'));

const webglPossible = (() => {
  let r: boolean | null = null;
  return () => {
    if (r !== null) return r;
    try {
      const c = document.createElement('canvas');
      r = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch { r = false; }
    return r;
  };
})();

interface Props {
  demande: DemandeBrief; messageId: string; onSend?: (texte: string) => void;
  /** Lot fiche-3d : appelé après l'envoi (la fiche « Espace 3D » referme la carte). */
  onEnvoye?: () => void;
  /** Lot fiche-3d : bouton « Fermer » (carte ouverte depuis la fiche, rien n'est envoyé). */
  onFermer?: () => void;
}

export function CarteBriefCreatif({ demande, messageId, onSend, onEnvoye, onFermer }: Props) {
  const messages = useCopilotStore((s) => s.messages);
  const enCours = useCopilotStore((s) => s.status === 'streaming');
  const envoyeDansLeFil = useMemo(() => briefEnvoyeApres(messages, messageId), [messages, messageId]);
  const [etat, setEtat] = useState<EtatBrief>(() => etatInitial(demande));
  const [ecran, setEcran] = useState(0);
  // Ouverte seulement pour une demande encore en suspens (pas de brief ni de devis plus loin dans le fil).
  // Ouverte depuis la fiche « Espace 3D » (lot fiche-3d) : toujours ouverte, c'est l'utilisateur qui l'a demandée.
  const [ouverte, setOuverte] = useState(() => demande.origine === 'fiche' || (demande.origine === 'demande' && !envoyeDansLeFil && !demandeDepassee(messages, messageId)));
  const [envoye, setEnvoye] = useState<string | null>(null);
  const [sans3d, setSans3d] = useState(false);

  const recap = recapitulatif(etat.choix, demande);
  const fini = envoye ?? envoyeDansLeFil;
  const titre = demande.origine === 'fiche' ? 'Habillage du projet' : demande.origine === 'devis' || demande.actuel ? 'Modifier l’habillage' : 'Brief créatif';

  const envoyer = (mimmo: boolean) => {
    if (!onSend || enCours) return;
    onSend(messageBrief(etat, demande, mimmo));
    setEnvoye(recapitulatif(choixAppliques(etat, mimmo), demande));
    setOuverte(false);
    onEnvoye?.();
  };

  if (!ouverte) {
    return (
      <section className="mz-brief mz-brief--replie" aria-label={titre}>
        <Palette size={16} aria-hidden="true" />
        <p className="mz-brief__ligne">
          {fini ? <><strong>Brief envoyé</strong> · {fini}</> : <><strong>Habillage</strong> · {recap}</>}
        </p>
        <button type="button" className="mz-brief__btn" onClick={() => { setOuverte(true); setEcran(0); setEnvoye(null); }} disabled={!onSend}>
          Modifier l’habillage
        </button>
      </section>
    );
  }

  const e = ECRANS[ecran];
  const dernier = ecran === ECRANS.length - 1;
  const apercu3d = demande.apercu && !sans3d && webglPossible();

  return (
    <section className="mz-brief" aria-label={titre}>
      <header className="mz-brief__tete">
        <Palette size={16} aria-hidden="true" />
        <h3>{titre}</h3>
        <ol className="mz-brief__etapes" aria-label="Étapes">
          {ECRANS.map((x, i) => (
            <li key={x.id} aria-current={i === ecran ? 'step' : undefined}>
              <button type="button" onClick={() => setEcran(i)} className={i === ecran ? 'is-actif' : i < ecran ? 'is-fait' : ''}>
                <span aria-hidden="true">{i < ecran ? <Check size={12} /> : i + 1}</span><span className="mz-brief__etape-nom">{x.titre}</span>
              </button>
            </li>
          ))}
        </ol>
      </header>

      <div className="mz-brief__corps">
        <figure className="mz-brief__apercu">
          {apercu3d ? (
            <Suspense fallback={<VignetteTravee choix={etat.choix} className="mz-brief__grande-vignette" />}>
              <ApercuBrief3D apercu={demande.apercu!} choix={etat.choix} limites={demande.limites} onIndisponible={() => setSans3d(true)} />
            </Suspense>
          ) : <VignetteTravee choix={etat.choix} titre={`Façade type : ${recap}`} className="mz-brief__grande-vignette" />}
          <figcaption>
            {apercu3d ? 'Votre volume, habillé selon vos choix (aperçu simplifié — le rendu final ajoute matières et lumière réelles).' : 'Façade type selon vos choix (aperçu simplifié).'}
            {demande.limites.batiments > 1 && ` Appliqué à chacun des ${demande.limites.batiments} bâtiments.`}
          </figcaption>
        </figure>

        <div className="mz-brief__choix">
          <h4 className="mz-brief__ecran">{e.titre}</h4>
          {e.champs.map((champ) => <Champ key={champ} champ={champ} etat={etat} demande={demande} onChoix={(v) => setEtat((s) => choisir(s, champ, v, demande))} />)}
          {e.id === 'facade' && (
            <p className="mz-brief__styles">
              Style : <span className="is-dispo">{STYLES[0].libelle}</span>
              {STYLES.filter((s) => !s.disponible).map((s) => <span key={s.valeur} className="is-bientot" aria-disabled="true">{s.libelle} · bientôt</span>)}
            </p>
          )}
        </div>
      </div>

      <footer className="mz-brief__pied">
        <p className="mz-brief__recap" aria-live="polite"><strong>Votre brief :</strong> {recap}</p>
        <div className="mz-brief__actions">
          <button type="button" className="mz-brief__btn mz-brief__btn--leger" onClick={() => envoyer(true)} disabled={!onSend || enCours}
            title={etat.touches.length ? 'Mimmo garde vos choix et propose le reste' : 'Mimmo choisit tout'}>
            <Sparkles size={14} aria-hidden="true" /> Laisser Mimmo choisir
          </button>
          <span className="mz-brief__nav">
            {onFermer && <button type="button" className="mz-brief__btn mz-brief__btn--leger" onClick={onFermer}>Fermer</button>}
            {ecran > 0 && <button type="button" className="mz-brief__btn mz-brief__btn--leger" onClick={() => setEcran(ecran - 1)}><ChevronLeft size={14} aria-hidden="true" /> Retour</button>}
            {dernier
              ? <button type="button" className="mz-brief__btn mz-brief__btn--plein" onClick={() => envoyer(false)} disabled={!onSend || enCours}><Check size={14} aria-hidden="true" /> {demande.origine === 'fiche' ? 'Valider l’habillage' : 'Valider le brief'}</button>
              : <button type="button" className="mz-brief__btn mz-brief__btn--plein" onClick={() => setEcran(ecran + 1)}>Suivant <ChevronRight size={14} aria-hidden="true" /></button>}
          </span>
        </div>
        {enCours && <p className="mz-brief__note" role="status">Mimmo répond… vous pourrez valider dans un instant.</p>}
      </footer>
    </section>
  );
}

function Champ({ champ, etat, demande, onChoix }: { champ: ChampCarte; etat: EtatBrief; demande: DemandeBrief; onChoix: (v: string | boolean) => void }) {
  const options = optionsDe(champ).filter((o) => champ !== 'ambiance' || demande.ambiances.includes(o.valeur as never) || o.valeur === 'nuit');
  const bloque = champ === 'balcons' && !demande.limites.balcons ? raisonIndisponible('balcons', 'aucun', etat.choix, demande) : null;
  const noteVerre = champ === 'ouvertures' && etat.choix.facade === 'verre';
  return (
    <fieldset className="mz-brief__champ">
      <legend>{QUESTIONS[champ]}{!etat.touches.includes(champ) && <span className="mz-brief__propose"> · proposé par Mimmo</span>}</legend>
      <div className={`mz-brief__options mz-brief__options--${champ}`} role="radiogroup" aria-label={QUESTIONS[champ]}>
        {options.map((o) => {
          const raison = raisonIndisponible(champ, o.valeur, etat.choix, demande);
          const actif = etat.choix[champ] === o.valeur && !raison;
          const essai = { ...etat.choix, [champ]: o.valeur };
          return (
            <button key={String(o.valeur)} type="button" role="radio" aria-checked={actif} disabled={!!raison} title={raison ?? o.detail}
              className={`mz-brief__option${actif ? ' is-actif' : ''}${raison ? ' is-indispo' : ''}`} onClick={() => onChoix(o.valeur)}>
              {champ !== 'ambiance' && <VignetteTravee choix={essai} className="mz-brief__vignette" />}
              {champ === 'ambiance' && <span className={`mz-brief__ciel mz-brief__ciel--${String(o.valeur)}`} aria-hidden="true" />}
              <span className="mz-brief__nom">{o.libelle}{!o.disponible && <em> · bientôt</em>}</span>
              <span className="mz-brief__detail">{raison && o.disponible ? raison : o.detail}</span>
            </button>
          );
        })}
      </div>
      {bloque && <p className="mz-brief__note">{bloque}</p>}
      {noteVerre && <p className="mz-brief__note">Façade en verre : les baies couvrent déjà toute la façade, ce choix ne change rien.</p>}
      {champ === 'attique' && etat.choix.attique && <p className="mz-brief__note">L’attique ajoute un niveau au-dessus du volume calculé : hauteur à vérifier au PLU.</p>}
      {champ === 'rdc' && etat.choix.rdc === 'commerces' && <p className="mz-brief__note">Le nombre de logements du volume n’est pas recalculé.</p>}
    </fieldset>
  );
}
