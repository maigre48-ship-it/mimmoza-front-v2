// src/spaces/copilot/studio3d/ParcoursGuide.tsx
// =============================================================================
// VIS-17 (20/11/2026) — « Votre parcours » : la liste des étapes pour créer des images, un film ou une visite 360°.
//
// 23/11/2026 — LE CHAT EST LA TRAME PRINCIPALE :
//   · CarteParcours   : carte du chat (UNE par conversation, en bas du fil) — TOUTES les étapes, chacune avec sa
//     couleur, son statut, son résumé et son UNIQUE bouton d'action ; sélecteur Images / Film / Visite 360° ; petits
//     réglages de l'étape courante (ou de l'étape dépliée). C'est ici, et seulement ici, qu'on commande.
//     VIS-21 : si la carte d'action de l'étape est déjà dans le fil (devis de mission, brief créatif, devis de rendu),
//     pas de bouton concurrent mais un renvoi vers cette carte.
//   · ParcoursPanneau : récapitulatif EN LECTURE SEULE en tête de l'Espace 3D (mêmes couleurs, mêmes statuts, aucun
//     bouton) : l'Espace 3D illustre et détaille l'étape ouverte depuis le chat.
// Composants minces : statuts, résumés et actions viennent de src/lib/studio/parcours.ts (calculés, jamais déclarés).
// =============================================================================
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronRight, Circle, Loader2, Lock, Minus } from 'lucide-react';
import {
  avancement, COULEURS_ETAPE, LIBELLES_STATUT_ETAPE, LIBELLES_TYPE_PARCOURS, prochaineEtape, TYPES_PARCOURS,
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

const styleEtape = (e: EtapeParcours): CSSProperties => ({ ['--etape' as string]: COULEURS_ETAPE[e.cle] });
const numeroDe = (p: Parcours, cle: EtapeParcours['debloquePar']) => String(p.etapes.find((x) => x.cle === cle)?.numero ?? '');

function TexteEtape({ p, e }: { p: Parcours; e: EtapeParcours }) {
  return <span className="mz-parcours__texte">
    <span className="mz-parcours__titre">{String(e.numero)}. {e.titre} <em>{LIBELLES_STATUT_ETAPE[e.statut]}</em></span>
    <span className="mz-parcours__resume">{e.resume}</span>
    {e.raison && <span className="mz-parcours__raison">{e.raison}{e.debloquePar && e.statut === 'bloquee' ? ` → étape ${numeroDe(p, e.debloquePar)}` : ''}</span>}
  </span>;
}

/** Récapitulatif en lecture seule de l'Espace 3D : mêmes étapes, mêmes couleurs, AUCUNE commande (elles sont dans le chat). */
export function ParcoursPanneau({ parcours, notice, detail }: {
  parcours: Parcours;
  /** Retour de la dernière action (en cours, erreur). */
  notice?: string | null;
  /** Détail affiché sous une étape (ex. carte cadastrale ouverte depuis le chat) ; null : rien. */
  detail?: (e: EtapeParcours) => ReactNode;
}) {
  const { faites, total } = avancement(parcours);
  const prochaine = prochaineEtape(parcours);
  return <section className="mz-parcours mz-parcours--recap" aria-label="Votre parcours (récapitulatif)">
    <header className="mz-parcours__tete">
      <div>
        <h2>Votre parcours · {LIBELLES_TYPE_PARCOURS[parcours.type]}</h2>
        <p>{parcours.termine ? 'Tout est fait.' : `${String(faites)} étape${faites > 1 ? 's' : ''} sur ${String(total)} · prochaine : ${prochaine ? `${String(prochaine.numero)}. ${prochaine.titre}` : '—'}`} — les actions sont dans le chat.</p>
      </div>
    </header>
    {notice && <p className="mz-parcours__notice" role="status">{notice}</p>}
    <ol className="mz-parcours__liste">
      {parcours.etapes.map((e) => {
        const courante = e.cle === parcours.courante;
        return <li key={e.cle} style={styleEtape(e)} className={`mz-parcours__etape is-${e.statut}${courante ? ' is-courante' : ''}`} aria-current={courante ? 'step' : undefined}>
          <div className="mz-parcours__ligne"><IconeStatut statut={e.statut} numero={e.numero} /><TexteEtape p={parcours} e={e} /></div>
          {detail?.(e)}
        </li>;
      })}
    </ol>
  </section>;
}

/** Cibles réglées DANS la carte du chat (champ terrain, champs du programme) : le bouton de l'étape les déplie. */
const CIBLES_DANS_LA_CARTE: ReadonlySet<string> = new Set(['terrain', 'programme']);

export function CarteParcours({ parcours, onAction, onType, onDetail, reglage, notice }: {
  parcours: Parcours; onAction: ActionnerParcours; onType?: (t: TypeParcours) => void;
  /** Retour de la dernière action (en cours, erreur), affiché en tête de la carte. */
  notice?: string | null;
  /** Réglage de l'étape (terrain, programme, cible, gamme, fond) ; `ouvert` : déplié à la demande de l'utilisateur. */
  reglage?: (e: EtapeParcours, ouvert: { cle: string; jeton: number } | null) => ReactNode;
  /** Montre l'Espace 3D (récapitulatif et détail). */
  onDetail?: () => void;
}) {
  const { faites, total } = avancement(parcours);
  const [ouverte, setOuverte] = useState<{ cle: string; jeton: number } | null>(null);
  const basculer = (cle: string) => setOuverte((o) => (o?.cle === cle ? null : { cle, jeton: (o?.jeton ?? 0) + 1 }));
  return <aside className="mz-parcours mz-parcours--carte" aria-label="Votre parcours">
    <header className="mz-parcours__tete">
      <div>
        <h3>Votre parcours · {LIBELLES_TYPE_PARCOURS[parcours.type]}</h3>
        <p>{parcours.termine ? 'Tout est fait.' : `${String(faites)} sur ${String(total)} étapes faites`}</p>
      </div>
      <SelecteurType type={parcours.type} onType={onType} />
    </header>
    {notice && <p className="mz-parcours__notice" role="status">{notice}</p>}
    <ol className="mz-parcours__liste">
      {parcours.etapes.map((e) => {
        const courante = e.cle === parcours.courante;
        const depliee = ouverte?.cle === e.cle;
        const dansLaCarte = CIBLES_DANS_LA_CARTE.has(e.action.cible);
        // UN bouton par étape : l'action de l'étape ; terrain / programme déjà faits → le bouton déplie le champ ici.
        const actionner = () => { if (dansLaCarte && e.statut === 'fait') basculer(e.cle); else onAction(e, e.action); };
        // Réglages de personnalisation (pour qui, gamme, fond de l'image) : toujours sous leur étape ; terrain et
        // programme : étape courante, ou dépliés par le bouton de l'étape.
        const petit = e.reglage === 'cible' || e.reglage === 'gamme' || e.reglage === 'fond';
        const montrerReglage = e.statut !== 'bloquee' && !!e.reglage && (petit || depliee || (courante && !e.carteDansLeFil));
        return <li key={e.cle} style={styleEtape(e)} className={`mz-parcours__etape is-${e.statut}${courante ? ' is-courante' : ''}`} aria-current={courante ? 'step' : undefined}>
          <div className="mz-parcours__ligne">
            <IconeStatut statut={e.statut} numero={e.numero} />
            <TexteEtape p={parcours} e={e} />
            {e.statut !== 'bloquee' && !e.carteDansLeFil && !(dansLaCarte && e.statut !== 'fait' && montrerReglage) && <span className="mz-parcours__boutons">
              <button type="button" className={`mz-parcours__action${courante ? ' is-primaire' : ''}`} onClick={actionner}
                aria-label={`Étape ${String(e.numero)} — ${e.titre} : ${e.action.libelle}`}>
                {dansLaCarte && depliee ? 'Fermer' : e.action.libelle}{courante && <ChevronRight size={14} aria-hidden="true" />}
              </button>
              {e.actionSecondaire && <button type="button" className="mz-parcours__action" onClick={() => onAction(e, e.actionSecondaire!)}>{e.actionSecondaire.libelle}</button>}
            </span>}
          </div>
          {e.carteDansLeFil && e.statut !== 'bloquee' && <p className="mz-parcours__renvoi" role="note">{e.carteDansLeFil}</p>}
          {montrerReglage && reglage?.(e, depliee ? ouverte : null)}
        </li>;
      })}
    </ol>
    {parcours.termine && <p className="mz-parcours__fini"><Circle size={10} aria-hidden="true" /> Toutes les étapes sont faites.</p>}
    {onDetail && <button type="button" className="mz-parcours__detail" onClick={onDetail}>Voir le récapitulatif dans l’Espace 3D</button>}
  </aside>;
}
