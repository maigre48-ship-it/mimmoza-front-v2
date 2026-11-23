// src/spaces/copilot/studio3d/ParcoursGuide.tsx
// =============================================================================
// VIS-17 (20/11/2026) — « Votre parcours » : la liste des étapes pour créer des images, un film ou une visite 360°.
//
//   · ParcoursPanneau : en tête de l'Espace 3D (panneau de droite) — sélecteur Images / Film / Visite 360°, étapes
//     numérotées, étape courante mise en avant, chaque étape cliquable (« Ouvrir » / « Modifier » mène à l'outil existant).
//   · CarteParcours   : carte compacte du chat (UNE par conversation, mise à jour en place) — pastilles des étapes et
//     prochaine étape en bouton principal. Cliquer une étape = même action que dans le panneau.
// Composants minces : statuts, résumés et actions viennent de src/lib/studio/parcours.ts (calculés, jamais déclarés).
// =============================================================================
import type { ReactNode } from 'react';
import { Check, ChevronRight, Circle, Loader2, Lock, Minus } from 'lucide-react';
import {
  avancement, etapeDuClic, LIBELLES_STATUT_ETAPE, LIBELLES_TYPE_PARCOURS, prochaineEtape, TYPES_PARCOURS,
  type ActionParcours, type EtapeParcours, type Parcours, type StatutEtape, type TypeParcours,
} from '../../../lib/studio/parcours.ts';
import './ParcoursGuide.css';

export type ActionnerParcours = (etape: EtapeParcours, action: ActionParcours) => void;

function IconeStatut({ statut, numero }: { statut: StatutEtape; numero: number }) {
  const icone = statut === 'fait' ? <Check size={13} strokeWidth={3} />
    : statut === 'en_cours' ? <Loader2 size={13} className="mz-parcours__tourne" />
    : statut === 'bloquee' ? <Lock size={12} />
    : statut === 'facultative' ? <Minus size={13} />
    : null;
  return <span className={`mz-parcours__pastille is-${statut}`} aria-hidden="true">{icone ?? numero}</span>;
}

function SelecteurType({ type, onType }: { type: TypeParcours; onType?: (t: TypeParcours) => void }) {
  if (!onType) return null;
  return <div className="mz-parcours__types" role="radiogroup" aria-label="Ce que vous voulez créer">
    {TYPES_PARCOURS.map((t) => <button key={t} type="button" role="radio" aria-checked={t === type}
      className={t === type ? 'is-actif' : ''} onClick={() => onType(t)}>{LIBELLES_TYPE_PARCOURS[t]}</button>)}
  </div>;
}

/** Clic sur la ligne d'une étape : une étape bloquée mène à celle qui la débloque. */
function cliquer(p: Parcours, e: EtapeParcours, onAction: ActionnerParcours) {
  const cible = etapeDuClic(p, e.cle) ?? e;
  onAction(cible, cible.action);
}

export function ParcoursPanneau({ parcours, onAction, onType, reglage }: {
  parcours: Parcours; onAction: ActionnerParcours; onType?: (t: TypeParcours) => void;
  /** VIS-18b — petit réglage affiché dans l'étape (cible, gamme, fond de l'image) ; null : aucun. */
  reglage?: (e: EtapeParcours) => ReactNode;
}) {
  const { faites, total } = avancement(parcours);
  const prochaine = prochaineEtape(parcours);
  return <section className="mz-parcours" aria-label="Votre parcours">
    <header className="mz-parcours__tete">
      <div>
        <h2>Votre parcours</h2>
        <p>{parcours.termine ? 'Tout est fait.' : `${String(faites)} étape${faites > 1 ? 's' : ''} sur ${String(total)} · prochaine : ${prochaine ? `${String(prochaine.numero)}. ${prochaine.titre}` : '—'}`}</p>
      </div>
      <SelecteurType type={parcours.type} onType={onType} />
    </header>
    <ol className="mz-parcours__liste">
      {parcours.etapes.map((e) => {
        const courante = e.cle === parcours.courante;
        return <li key={e.cle} className={`mz-parcours__etape is-${e.statut}${courante ? ' is-courante' : ''}`} aria-current={courante ? 'step' : undefined}>
          <button type="button" className="mz-parcours__ligne" onClick={() => cliquer(parcours, e, onAction)}
            aria-label={`Étape ${String(e.numero)} — ${e.titre} : ${LIBELLES_STATUT_ETAPE[e.statut]}. ${e.resume}`}>
            <IconeStatut statut={e.statut} numero={e.numero} />
            <span className="mz-parcours__texte">
              <span className="mz-parcours__titre">{String(e.numero)}. {e.titre} <em>{LIBELLES_STATUT_ETAPE[e.statut]}</em></span>
              <span className="mz-parcours__resume">{e.resume}</span>
              {e.raison && <span className="mz-parcours__raison">{e.raison}{e.debloquePar && e.statut === 'bloquee' ? ` → étape ${String(parcours.etapes.find((x) => x.cle === e.debloquePar)?.numero ?? '')}` : ''}</span>}
            </span>
            <ChevronRight size={15} aria-hidden="true" className="mz-parcours__chevron" />
          </button>
          {(courante || e.statut === 'fait' || e.statut === 'en_cours') && e.statut !== 'bloquee' && <div className="mz-parcours__actions">
            <button type="button" className={courante ? 'is-primaire' : ''} onClick={() => onAction(e, e.action)}>{e.action.libelle}</button>
            {e.actionSecondaire && <button type="button" onClick={() => onAction(e, e.actionSecondaire!)}>{e.actionSecondaire.libelle}</button>}
          </div>}
          {reglage?.(e)}
        </li>;
      })}
    </ol>
  </section>;
}

export function CarteParcours({ parcours, onAction, onType, onDetail, reglage }: {
  parcours: Parcours; onAction: ActionnerParcours; onType?: (t: TypeParcours) => void;
  /** VIS-20 — champ de la prochaine étape affiché DANS la carte du chat (terrain, programme) ; null : aucun. */
  reglage?: (e: EtapeParcours) => ReactNode;
  /** Ouvre l'Espace 3D sur le parcours détaillé. */
  onDetail?: () => void;
}) {
  const prochaine = prochaineEtape(parcours);
  const { faites, total } = avancement(parcours);
  return <aside className="mz-parcours mz-parcours--carte" aria-label="Votre parcours">
    <header className="mz-parcours__tete">
      <div>
        <h3>Votre parcours · {LIBELLES_TYPE_PARCOURS[parcours.type]}</h3>
        <p>{String(faites)} sur {String(total)} étapes faites</p>
      </div>
      <SelecteurType type={parcours.type} onType={onType} />
    </header>
    <ol className="mz-parcours__puces">
      {parcours.etapes.map((e) => <li key={e.cle}>
        <button type="button" className={`is-${e.statut}${e.cle === parcours.courante ? ' is-courante' : ''}`} onClick={() => cliquer(parcours, e, onAction)}
          title={`${e.titre} — ${LIBELLES_STATUT_ETAPE[e.statut]} : ${e.resume}`} aria-label={`Étape ${String(e.numero)} — ${e.titre} : ${LIBELLES_STATUT_ETAPE[e.statut]}`}>
          <IconeStatut statut={e.statut} numero={e.numero} /><span>{e.titre}</span>
        </button>
      </li>)}
    </ol>
    {prochaine ? <div className="mz-parcours__suite">
      <p><strong>Prochaine étape : {String(prochaine.numero)}. {prochaine.titre}</strong><br />{prochaine.raison ?? prochaine.resume}</p>
      <button type="button" className="is-primaire" onClick={() => onAction(prochaine, prochaine.action)}>{prochaine.action.libelle} <ChevronRight size={14} aria-hidden="true" /></button>
    </div> : <p className="mz-parcours__fini"><Circle size={10} aria-hidden="true" /> Toutes les étapes sont faites.</p>}
    {prochaine && (prochaine.reglage === 'terrain' || prochaine.reglage === 'programme') && reglage?.(prochaine)}
    {onDetail && <button type="button" className="mz-parcours__detail" onClick={onDetail}>Voir le détail dans l’Espace 3D</button>}
  </aside>;
}
