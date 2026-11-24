// src/spaces/copilot/studio3d/CarteModeleBatiment.tsx
// =============================================================================
// VIS-25 lot B — carte « Votre bâtiment » du MODÈLE COMPOSÉ (dessiner n'importe quoi).
//
// Affichée sous la réponse de Mimmo quand il a dessiné un bâtiment (texte ou photo) ou l'a retouché en parlant.
// Elle montre : un aperçu simplifié (volumes vus de dessus + façade sur rue), la liste lisible des volumes, toits,
// ouvertures, éléments et matières, « Ce que j'ai corrigé », et pour chaque partie une pastille honnête :
// « Dans la 3D et les images » ou « Dans la 3D seulement ». UN seul bouton : « Reproduire en 3D ».
// On ne modifie pas la carte à la main : on parle à Mimmo (« ajoute une lucarne ») — une nouvelle carte remplace celle-ci.
// Logique pure : modeleBatimentChat.ts ; contrat : src/lib/studio/modeleBatiment.ts (lot A).
// =============================================================================
import { useMemo, useState } from 'react';
import { useCopilotStore } from '../store/copilotStore';
import { messageReproduireModele } from '@/lib/studio/modeleBatimentMessage';
import { etatCarte, troisDPreparee, facadePrincipale, groupesListe, LIBELLE_PORTEE, phrasePortee, planVuDeDessus, type CarteModele } from './modeleBatimentChat';
import { EVENEMENT_PARCOURS_STUDIO, type DemandeParcoursStudio } from './parcours.store';
import './CarteModeleBatiment.css';

interface Props {
  carte: CarteModele;
  /** Message de Mimmo qui porte la carte (pour savoir si elle a été envoyée ou remplacée). */
  messageId: string;
  onSend?: (texte: string) => void;
}

const AIDE_PORTEE = {
  images: 'Construit dans le Studio 3D et repris dans les images rendues.',
  '3d': 'Construit dans le Studio 3D, mais pas encore repris dans les images.',
  aucune: 'Gardé dans le dessin, mais ni le Studio ni les images ne savent encore le dessiner.',
} as const;

function Apercu({ carte }: { carte: CarteModele }) {
  const plan = useMemo(() => planVuDeDessus(carte.modele), [carte.modele]);
  const facade = useMemo(() => facadePrincipale(carte.modele), [carte.modele]);
  return (
    <div className="mz-mod__apercu" aria-label="Aperçu simplifié du bâtiment">
      <figure className="mz-mod__vue">
        <svg viewBox={plan.viewBox} role="img" aria-label="Vu de dessus" preserveAspectRatio="xMidYMid meet">
          <line className="mz-mod__rue" x1={plan.rue.x1} x2={plan.rue.x2} y1={plan.rue.y} y2={plan.rue.y} vectorEffect="non-scaling-stroke" />
          {plan.volumes.map((v) => (
            <polygon key={v.id} points={v.points} className={v.principal ? 'mz-mod__vol is-principal' : 'mz-mod__vol'} vectorEffect="non-scaling-stroke">
              <title>{`${v.nom} — ${String(v.sommet).replace('.', ',')} m au sommet`}</title>
            </polygon>
          ))}
          {plan.briques.map((b, i) => (b.rond
            ? <circle key={i} cx={b.cx} cy={b.cy} r={b.r} className="mz-mod__brique" vectorEffect="non-scaling-stroke" />
            : <polygon key={i} points={b.points} className="mz-mod__brique" vectorEffect="non-scaling-stroke" />))}
        </svg>
        <figcaption>Vu de dessus · rue en bas · échelle {plan.echelle.libelle}</figcaption>
      </figure>
      <figure className="mz-mod__vue">
        <svg viewBox={facade.viewBox} role="img" aria-label="Façade sur rue" preserveAspectRatio="xMidYMid meet">
          <line className="mz-mod__sol" x1={facade.sol.x1} x2={facade.sol.x2} y1={0} y2={0} vectorEffect="non-scaling-stroke" />
          {facade.murs.map((m, i) => (
            <g key={m.id}>
              <rect x={m.x} y={m.y} width={m.l} height={m.h} className="mz-mod__mur" vectorEffect="non-scaling-stroke" />
              <polygon points={facade.toits[i]!.points} className="mz-mod__toit" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          {facade.ouvertures.map((o, i) => <rect key={i} x={o.x} y={o.y} width={o.l} height={o.h} className={`mz-mod__ouv is-${o.type}`} vectorEffect="non-scaling-stroke" />)}
          {facade.briques.map((b, i) => <polygon key={i} points={b.points} className="mz-mod__brique" vectorEffect="non-scaling-stroke" />)}
        </svg>
        <figcaption>Façade sur rue (simplifiée)</figcaption>
      </figure>
    </div>
  );
}

export function CarteModeleBatiment({ carte, messageId, onSend }: Props) {
  const messages = useCopilotStore((s) => s.messages);
  const etat = useMemo(() => etatCarte(messages, messageId, carte.empreinte), [messages, messageId, carte.empreinte]);
  const [cliquee, setCliquee] = useState(false);
  // VIS-26 lot D : 3D de CE dessin préparée → lien discret « Voir dans le Studio » (même parcours que l'étape « Bâtiment »).
  const preparee = useMemo(() => troisDPreparee(messages, messageId, carte.empreinte), [messages, messageId, carte.empreinte]);
  const [noteStudio, setNoteStudio] = useState<string | null>(null);
  const groupes = useMemo(() => groupesListe(carte.modele), [carte.modele]);
  const m = carte.modele;
  const envoyee = etat === 'envoyee' || cliquee;
  const remplacee = etat === 'remplacee' && !cliquee;
  const reproduire = () => {
    if (!onSend || envoyee || remplacee) return;
    setCliquee(true);
    onSend(messageReproduireModele(m, carte.empreinte));
  };
  const voirDansStudio = () => {
    setNoteStudio(null);
    const demande: DemandeParcoursStudio = { etape: 'batiment', sous: 'batiment', repondre: setNoteStudio };
    window.dispatchEvent(new CustomEvent(EVENEMENT_PARCOURS_STUDIO, { detail: demande }));
    if (!demande.prise) setNoteStudio('Le Studio s’ouvre depuis la page MimmozIA.');
  };
  const origine = carte.retouche ? 'Retouché' : m.origine === 'photo' ? 'D’après votre photo' : 'D’après votre description';

  return (
    <section className="mz-mod" aria-label="Votre bâtiment">
      <header className="mz-mod__tete">
        <div>
          <strong>Votre bâtiment{m.nom ? ` — ${m.nom}` : ''}</strong>
          <p className="mz-mod__sous">{m.volumes.length} volume{m.volumes.length > 1 ? 's' : ''} · {m.ouvertures.reduce((s, o) => s + o.nombre, 0)} ouvertures · {m.elements.length} élément{m.elements.length > 1 ? 's' : ''}{m.style === 'autre' && m.styleLibre ? ` · ${m.styleLibre}` : m.style !== 'contemporain' ? ` · style ${m.style.replace('_', ' ')}` : ''}</p>
        </div>
        <span className="mz-mod__origine">{origine}</span>
      </header>
      {carte.mentionPhoto && <p className="mz-mod__photo">{carte.mentionPhoto}</p>}
      {carte.fait.length > 0 && (
        <ul className="mz-mod__fait" aria-label="Ce qui a changé">
          {carte.fait.map((f) => <li key={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</li>)}
        </ul>
      )}

      <Apercu carte={carte} />

      {groupes.map((g) => (
        <div className="mz-mod__groupe" key={g.categorie}>
          <h4>{g.titre}</h4>
          {g.lignes.map((l) => (
            <div className={`mz-mod__rang${l.portee !== 'images' ? ' is-3d' : ''}`} key={`${l.categorie}-${l.id}`}>
              <span className="mz-mod__nom">{l.libelle}</span>
              <span className="mz-mod__detail">{l.detail}</span>
              <span className={`mz-mod__portee is-${l.portee === '3d' ? 'seul3d' : l.portee}`} title={AIDE_PORTEE[l.portee]}>{LIBELLE_PORTEE[l.portee]}</span>
              {l.note && <p className="mz-mod__note">{l.note}</p>}
            </div>
          ))}
        </div>
      ))}
      {m.remarques && <p className="mz-mod__remarques">Noté aussi : {m.remarques}</p>}

      {(carte.corrections.length > 0 || carte.avertissements.length > 0) && (
        <div className="mz-mod__corrige" aria-live="polite">
          <h4>Ce que j’ai corrigé</h4>
          <ul>
            {carte.corrections.map((c) => <li key={c}>{c.charAt(0).toUpperCase() + c.slice(1)}.</li>)}
            {carte.avertissements.map((c) => <li key={c} className="is-note">À noter : {c}.</li>)}
          </ul>
        </div>
      )}

      <footer className="mz-mod__pied">
        <div className="mz-mod__bilan">
          <span>{phrasePortee(groupes)}</span>
          <span className="mz-mod__aide">Pour changer quelque chose, dites-le à Mimmo (« ajoute une lucarne », « un étage de plus »). La hauteur et l’emprise sont vérifiées sur votre terrain.</span>
        </div>
        <button type="button" className="mz-mod__bouton" onClick={reproduire} disabled={!onSend || envoyee || remplacee}>
          {envoyee ? 'Envoyé à la 3D' : remplacee ? 'Version remplacée' : 'Reproduire en 3D'}
        </button>
      </footer>
      {envoyee && !preparee && <p className="mz-mod__envoye" role="status">Mimmo prépare la 3D dans la conversation.</p>}
      {envoyee && preparee && !remplacee && (
        <p className="mz-mod__envoye" role="status">
          3D préparée d’après ce dessin.{' '}
          <button type="button" className="mz-mod__lien" onClick={voirDansStudio}>Voir dans le Studio</button>
        </p>
      )}
      {noteStudio && <p className="mz-mod__remplacee" role="status">{noteStudio}</p>}
      {remplacee && <p className="mz-mod__remplacee">Une version plus récente de ce bâtiment se trouve plus bas.</p>}
    </section>
  );
}
