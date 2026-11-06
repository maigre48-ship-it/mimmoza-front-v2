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
//
// LOT BRIEF-UNIFIÉ (06/11/2026) : la carte vit dans la section « Style et habillage »
// de l'Espace 3D (FicheProjet3D.tsx) — le chat n'affiche plus qu'une ligne
// (LigneHabillage) quand le panneau existe. 4ᵉ écran « Détails » FACULTATIF (toiture,
// teinte, garde-corps, menuiseries, soubassement ; « bientôt » : volets, entrée) : on
// peut valider dès le 3ᵉ écran. `sansStyles` : les styles sont déjà en cartes au-dessus.
// =============================================================================
import { lazy, Suspense, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Palette, Sparkles } from 'lucide-react';
import { useCopilotStore } from '../store/copilotStore';
import {
  BIENTOT, ECRANS, QUESTIONS, STYLES, TEINTES_PAR_FACADE, briefEnvoyeApres, choisir, demandeDepassee, choixAppliques, etatInitial, libelleTeinte, messageBrief, optionsDe,
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
  /** Lot brief-unifié : ouverte par l'utilisateur ou par Mimmo dans l'Espace 3D (jamais repliée d'office). */
  toujoursOuverte?: boolean;
  /** Lot brief-unifié : pas de ligne « Style » (les cartes de style sont affichées au-dessus, dans la fiche). */
  sansStyles?: boolean;
  /** Lot brief-unifié : bandeau d'en-tête (ex. « Mimmo attend l'habillage pour le devis du film »). */
  bandeau?: string | null;
}

export function CarteBriefCreatif({ demande, messageId, onSend, onEnvoye, onFermer, toujoursOuverte, sansStyles, bandeau }: Props) {
  const messages = useCopilotStore((s) => s.messages);
  const enCours = useCopilotStore((s) => s.status === 'streaming');
  const envoyeDansLeFil = useMemo(() => briefEnvoyeApres(messages, messageId), [messages, messageId]);
  const [etat, setEtat] = useState<EtatBrief>(() => etatInitial(demande));
  const [ecran, setEcran] = useState(0);
  // Ouverte seulement pour une demande encore en suspens (pas de brief ni de devis plus loin dans le fil).
  // Ouverte depuis la fiche « Espace 3D » (lot fiche-3d) : toujours ouverte, c'est l'utilisateur qui l'a demandée.
  const [ouverte, setOuverte] = useState(() => !!toujoursOuverte || demande.origine === 'fiche' || (demande.origine === 'demande' && !envoyeDansLeFil && !demandeDepassee(messages, messageId)));
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
  // Lot brief-unifié : « Valider » dès le dernier écran principal ; « Détails » est facultatif.
  const peutValider = dernier || !!ECRANS[ecran + 1]?.facultatif;
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
                <span aria-hidden="true">{i < ecran ? <Check size={12} /> : i + 1}</span><span className="mz-brief__etape-nom">{x.titre}{x.facultatif ? ' (facultatif)' : ''}</span>
              </button>
            </li>
          ))}
        </ol>
      </header>
      {bandeau && <p className="mz-brief__bandeau" role="status">{bandeau}</p>}

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
          <h4 className="mz-brief__ecran">{e.titre}{e.facultatif && <span className="mz-brief__propose"> · facultatif, valeurs proposées par Mimmo</span>}</h4>
          {e.champs.map((champ) => <Champ key={champ} champ={champ} etat={etat} demande={demande} onChoix={(v) => setEtat((s) => choisir(s, champ, v, demande))} />)}
          {e.id === 'details' && BIENTOT.map((b) => (
            <fieldset key={b.titre} className="mz-brief__champ mz-brief__champ--bientot" disabled>
              <legend>{b.titre} <span className="mz-brief__propose">· bientôt</span></legend>
              <p className="mz-brief__puces">{b.options.map((o) => <span key={o} className="is-bientot" aria-disabled="true" title={b.raison}>{o}</span>)}</p>
            </fieldset>
          ))}
          {e.id === 'facade' && !sansStyles && (
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
            {!dernier && peutValider && <button type="button" className="mz-brief__btn mz-brief__btn--leger" onClick={() => setEcran(ecran + 1)}>Détails (facultatif) <ChevronRight size={14} aria-hidden="true" /></button>}
            {peutValider
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
  // Teinte : seulement les teintes réelles de la matière choisie, nommées (« Brique rouge », « Brique claire »).
  const options = optionsDe(champ)
    .filter((o) => champ !== 'ambiance' || demande.ambiances.includes(o.valeur as never) || o.valeur === 'nuit')
    .filter((o) => champ !== 'teinte' || TEINTES_PAR_FACADE[etat.choix.facade].includes(o.valeur as never));
  if (champ === 'teinte' && options.length < 2) {
    return <fieldset className="mz-brief__champ"><legend>{QUESTIONS.teinte}</legend><p className="mz-brief__note mz-brief__note--douce">Une seule teinte pour cette matière dans le Studio.</p></fieldset>;
  }
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
              <span className="mz-brief__nom">{champ === 'teinte' ? libelleTeinte(etat.choix.facade, o.valeur as never) : o.libelle}{!o.disponible && <em> · bientôt</em>}</span>
              <span className="mz-brief__detail">{raison && o.disponible ? raison : o.detail}</span>
            </button>
          );
        })}
      </div>
      {bloque && <p className="mz-brief__note">{bloque}</p>}
      {noteVerre && <p className="mz-brief__note">Façade en verre : les baies couvrent déjà toute la façade, ce choix ne change rien.</p>}
      {champ === 'attique' && etat.choix.attique && <p className="mz-brief__note">L’attique ajoute un niveau au-dessus du volume calculé : hauteur à vérifier au PLU.</p>}
      {champ === 'rdc' && etat.choix.rdc === 'commerces' && <p className="mz-brief__note">Le nombre de logements du volume n’est pas recalculé.</p>}
      {champ === 'toiture' && etat.choix.toiture.startsWith('deux_pans_') && <p className="mz-brief__note">Le toit à deux pans s’ajoute au-dessus du dernier niveau (≈ 5,9 m pour 16 m de profondeur) : hauteur à vérifier au PLU.</p>}
    </fieldset>
  );
}
