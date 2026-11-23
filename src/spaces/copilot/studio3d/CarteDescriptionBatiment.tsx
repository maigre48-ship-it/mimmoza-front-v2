// src/spaces/copilot/studio3d/CarteDescriptionBatiment.tsx
// =============================================================================
// VIS-22 — carte « Votre bâtiment » du chat.
//
// Affichée sous la réponse de Mimmo quand il a compris la description d'un bâtiment (texte de l'utilisateur, ou photo
// d'un bâtiment qui ressemble). Elle montre CE QUI A ÉTÉ COMPRIS, point par point, chaque point étant modifiable, avec
// pour chacun ce que la 3D en fera : « Reproduit », « Approché » ou « Pas encore » (bilan du contrat, jamais embelli).
// UN seul bouton : « Reproduire en 3D » — il envoie un message (description + habillage) que le serveur revalide ;
// Mimmo prépare alors la 3D dans le chat. Aucune navigation : on reste dans la conversation.
// Logique pure : descriptionBatimentChat.ts ; contrat : src/lib/studio/descriptionBatiment.ts.
// =============================================================================
import { useMemo, useState, type ReactElement } from 'react';
import { useCopilotStore } from '../store/copilotStore';
import {
  BALCONS_BATIMENT, COULEURS_BOIS, COUVERTURES, ELEMENTS, FACADES_BATIMENT, FORMES_BATIMENT, FORMES_TOIT, GARDE_CORPS_BATIMENT, LIBELLES,
  libelleElement, libelleNiveauxBatiment, MENUISERIES_BATIMENT, messageReproduire, OUVERTURES_BATIMENT, RDC_BATIMENT, SOUBASSEMENTS_BATIMENT,
  STYLES_BATIMENT, TEINTES_PAR_FACADE_BATIMENT, toitEnPenteBatiment, TYPES_BATIMENT, VOLETS,
  type ChampDescription, type DescriptionBatiment, type EtatRendu, type LigneBilan,
} from '@/lib/studio/descriptionBatiment';
import { ajouterElement, envoyeeApres, modifierDescription, phraseBilan, resumeBilan, retirerElement, type CarteBatiment, type Modification } from './descriptionBatimentChat';
import './CarteDescriptionBatiment.css';

interface Props {
  carte: CarteBatiment;
  /** Message de Mimmo qui porte la carte (pour savoir si elle a déjà été envoyée). */
  messageId: string;
  onSend?: (texte: string) => void;
}

const LIBELLE_ETAT: Record<EtatRendu, string> = { reproduit: 'Reproduit', approche: 'Approché', non_reproduit: 'Pas encore' };
const AIDE_ETAT: Record<EtatRendu, string> = {
  reproduit: 'Repris dans la 3D et dans les images.',
  approche: 'Repris au plus proche de ce que la 3D sait faire aujourd’hui.',
  non_reproduit: 'Noté dans votre projet, mais pas encore dessiné par la 3D.',
};
const NIVEAUX_PROPOSES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15];

function Etat({ ligne }: { ligne: LigneBilan | undefined }) {
  if (!ligne) return <span />;
  return (
    <span className="mz-bat__etats">
      {ligne.aVerifier && <span className="mz-bat__etat is-verifier" title="Mimmo n’en est pas certain : vérifiez ce point.">À vérifier</span>}
      <span className={`mz-bat__etat is-${ligne.etat}`} title={AIDE_ETAT[ligne.etat]}>{LIBELLE_ETAT[ligne.etat]}</span>
    </span>
  );
}

function Choix<T extends string>({ id, valeur, options, libelle, onChange, desactive }: {
  id: string; valeur: T; options: readonly T[]; libelle: (v: T) => string; onChange: (v: T) => void; desactive?: boolean;
}) {
  return (
    <select id={id} className="mz-bat__choix" value={valeur} disabled={desactive} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o} value={o}>{libelle(o)}</option>)}
    </select>
  );
}

export function CarteDescriptionBatiment({ carte, messageId, onSend }: Props) {
  const messages = useCopilotStore((s) => s.messages);
  const dejaEnvoyee = useMemo(() => envoyeeApres(messages, messageId), [messages, messageId]);
  const [description, setDescription] = useState<DescriptionBatiment>(dejaEnvoyee ?? carte.description);
  const [notes, setNotes] = useState<string[]>([]);
  const [envoyee, setEnvoyee] = useState<string | null>(dejaEnvoyee ? JSON.stringify(dejaEnvoyee) : null);
  const bilan = useMemo(() => resumeBilan(description), [description]);
  const d = description;
  const uid = `mz-bat-${messageId}`;
  const ligne = (champ: ChampDescription): LigneBilan | undefined => bilan.lignes.find((l) => l.champ === champ);
  const lignesElements = bilan.lignes.filter((l) => l.champ === 'elements');
  const appliquer = (m: Modification) => { setDescription(m.description); setNotes(m.notes); };
  const changer = (patch: Partial<DescriptionBatiment>) => appliquer(modifierDescription(d, patch));
  const inchangee = envoyee === JSON.stringify(d);
  const reproduire = () => {
    if (!onSend || inchangee) return;
    setEnvoyee(JSON.stringify(d));
    onSend(messageReproduire(d));
  };
  const elementsAjoutables = ELEMENTS.filter((t) => t !== 'autre' && !d.elements.some((e) => e.type === t));
  const pente = toitEnPenteBatiment(d.toiture.forme);

  const rang = (champ: ChampDescription, titre: string, controle: ReactElement, cle?: string) => {
    const l = ligne(champ);
    return (
      <div className={`mz-bat__rang${l?.etat === 'non_reproduit' ? ' is-non' : ''}`} key={cle ?? champ}>
        <label className="mz-bat__nom" htmlFor={`${uid}-${cle ?? champ}`}>{titre}</label>
        <div className="mz-bat__valeur">{controle}</div>
        <Etat ligne={l} />
        {l?.note && <p className="mz-bat__note">{l.note}</p>}
      </div>
    );
  };

  return (
    <section className="mz-bat" aria-label="Votre bâtiment">
      <header className="mz-bat__tete">
        <div>
          <strong>Votre bâtiment</strong>
          <p className="mz-bat__sous">Voici ce que Mimmo a compris. Corrigez ce qui ne va pas, puis reproduisez-le en 3D.</p>
        </div>
        <span className="mz-bat__origine">{d.origine === 'photo' ? 'D’après votre photo' : 'D’après votre description'}</span>
      </header>
      {carte.mentionPhoto && <p className="mz-bat__photo">{carte.mentionPhoto}</p>}

      <div className="mz-bat__groupe">
        <h4>Volume</h4>
        {rang('type', 'Type', <Choix id={`${uid}-type`} valeur={d.type} options={TYPES_BATIMENT} libelle={(v) => LIBELLES.type[v]} onChange={(type) => changer({ type })} />)}
        {rang('forme', 'Forme', (
          <select id={`${uid}-forme`} className="mz-bat__choix" value={d.forme ?? ''} onChange={(e) => changer({ forme: (e.target.value || null) as DescriptionBatiment['forme'] })}>
            <option value="">Choisie par le moteur</option>
            {FORMES_BATIMENT.map((f) => <option key={f} value={f}>{LIBELLES.forme[f]}</option>)}
          </select>
        ))}
        {rang('niveaux', 'Hauteur', (
          <select id={`${uid}-niveaux`} className="mz-bat__choix" value={d.niveaux ?? ''} onChange={(e) => changer({ niveaux: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Choisie par le moteur</option>
            {[...new Set([...NIVEAUX_PROPOSES, ...(d.niveaux ? [d.niveaux] : [])])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{libelleNiveauxBatiment(n)}</option>)}
          </select>
        ))}
      </div>

      <div className="mz-bat__groupe">
        <h4>Style et toiture</h4>
        {rang('style', 'Style', <Choix id={`${uid}-style`} valeur={d.style} options={STYLES_BATIMENT} libelle={(v) => LIBELLES.style[v]} onChange={(style) => changer({ style })} />)}
        {rang('toiture', 'Toiture', (
          <>
            <Choix id={`${uid}-toiture`} valeur={d.toiture.forme} options={FORMES_TOIT} libelle={(v) => LIBELLES.toit[v]} onChange={(forme) => changer({ toiture: { ...d.toiture, forme } })} />
            {pente && d.toiture.couverture && (
              <Choix id={`${uid}-couverture`} valeur={d.toiture.couverture} options={COUVERTURES} libelle={(v) => `en ${LIBELLES.couverture[v]}`} onChange={(couverture) => changer({ toiture: { ...d.toiture, couverture } })} />
            )}
          </>
        ))}
      </div>

      <div className="mz-bat__groupe">
        <h4>Façade et ouvertures</h4>
        {rang('facade', 'Façade', (
          <>
            <Choix id={`${uid}-facade`} valeur={d.facade.materiau} options={FACADES_BATIMENT} libelle={(v) => LIBELLES.facade[v]}
              onChange={(materiau) => changer({ facade: { ...d.facade, materiau, teinte: TEINTES_PAR_FACADE_BATIMENT[materiau].includes(d.facade.teinte) ? d.facade.teinte : 'naturelle' } })} />
            {TEINTES_PAR_FACADE_BATIMENT[d.facade.materiau].length > 1 && (
              <Choix id={`${uid}-teinte`} valeur={d.facade.teinte} options={TEINTES_PAR_FACADE_BATIMENT[d.facade.materiau]} libelle={(v) => LIBELLES.teinte[v]} onChange={(teinte) => changer({ facade: { ...d.facade, teinte } })} />
            )}
            {d.facade.couleur && <span className="mz-bat__pastille-couleur" style={{ background: d.facade.couleur }} title={`Couleur relevée : ${d.facade.couleur}`} />}
          </>
        ))}
        {rang('ouvertures', 'Fenêtres', <Choix id={`${uid}-ouvertures`} valeur={d.ouvertures.type} options={OUVERTURES_BATIMENT} libelle={(v) => LIBELLES.ouvertures[v]} onChange={(type) => changer({ ouvertures: { ...d.ouvertures, type } })} />)}
        {rang('menuiseries', 'Menuiseries', <Choix id={`${uid}-menuiseries`} valeur={d.ouvertures.menuiseries} options={MENUISERIES_BATIMENT} libelle={(v) => LIBELLES.menuiseries[v]} onChange={(menuiseries) => changer({ ouvertures: { ...d.ouvertures, menuiseries } })} />)}
        {rang('volets', 'Volets', (
          <>
            <Choix id={`${uid}-volets`} valeur={d.ouvertures.volets} options={VOLETS} libelle={(v) => LIBELLES.volets[v]} onChange={(volets) => changer({ ouvertures: { ...d.ouvertures, volets } })} />
            {d.ouvertures.volets !== 'aucun' && (
              <select className="mz-bat__choix" aria-label="Couleur des volets" value={d.ouvertures.couleurVolets ?? ''}
                onChange={(e) => changer({ ouvertures: { ...d.ouvertures, couleurVolets: (e.target.value || null) as DescriptionBatiment['ouvertures']['couleurVolets'] } })}>
                <option value="">couleur libre</option>
                {COULEURS_BOIS.map((c) => <option key={c} value={c}>{LIBELLES.couleur[c]}</option>)}
              </select>
            )}
          </>
        ))}
      </div>

      <div className="mz-bat__groupe">
        <h4>Balcons et détails</h4>
        {rang('balcons', 'Balcons', <Choix id={`${uid}-balcons`} valeur={d.balcons.type} options={BALCONS_BATIMENT} libelle={(v) => LIBELLES.balcons[v]} onChange={(type) => changer({ balcons: { ...d.balcons, type } })} />)}
        {d.balcons.type !== 'aucun' && rang('garde_corps', 'Garde-corps', <Choix id={`${uid}-garde_corps`} valeur={d.balcons.gardeCorps} options={GARDE_CORPS_BATIMENT} libelle={(v) => LIBELLES.gardeCorps[v]} onChange={(gardeCorps) => changer({ balcons: { ...d.balcons, gardeCorps } })} />)}
        {rang('attique', 'Dernier étage en retrait', (
          <select id={`${uid}-attique`} className="mz-bat__choix" value={d.attique ? 'oui' : 'non'} onChange={(e) => changer({ attique: e.target.value === 'oui' })}>
            <option value="non">Non</option>
            <option value="oui" disabled={pente}>Oui (attique)</option>
          </select>
        ))}
        {rang('rdc', 'Rez-de-chaussée', <Choix id={`${uid}-rdc`} valeur={d.rdc} options={RDC_BATIMENT} libelle={(v) => LIBELLES.rdc[v]} onChange={(rdc) => changer({ rdc })} />)}
        {rang('soubassement', 'Soubassement', <Choix id={`${uid}-soubassement`} valeur={d.soubassement} options={SOUBASSEMENTS_BATIMENT} libelle={(v) => LIBELLES.soubassement[v]} onChange={(soubassement) => changer({ soubassement })} desactive={d.rdc === 'commerces'} />)}
      </div>

      <div className="mz-bat__groupe">
        <h4>Éléments remarquables</h4>
        {d.elements.length === 0 && <p className="mz-bat__vide">Aucun élément particulier relevé.</p>}
        {d.elements.map((e, i) => {
          const l = lignesElements[i];
          return (
            <div className={`mz-bat__rang${l?.etat === 'non_reproduit' ? ' is-non' : ''}`} key={`${e.type}-${i}`}>
              <span className="mz-bat__nom">{libelleElement(e)}</span>
              <div className="mz-bat__valeur">
                {(e.type === 'colombages') && (
                  <select className="mz-bat__choix" aria-label="Couleur des colombages" value={e.couleur ?? ''}
                    onChange={(ev) => changer({ elements: d.elements.map((x, k) => (k === i ? { ...x, couleur: (ev.target.value || null) as typeof x.couleur } : x)) })}>
                    <option value="">couleur libre</option>
                    {COULEURS_BOIS.map((c) => <option key={c} value={c}>{LIBELLES.couleur[c]}</option>)}
                  </select>
                )}
                <button type="button" className="mz-bat__retirer" onClick={() => appliquer(retirerElement(d, i))} aria-label={`Retirer ${libelleElement(e)}`}>Retirer</button>
              </div>
              <Etat ligne={l} />
              {l?.note && <p className="mz-bat__note">{l.note}</p>}
            </div>
          );
        })}
        {elementsAjoutables.length > 0 && d.elements.length < 8 && (
          <select className="mz-bat__choix mz-bat__ajout" aria-label="Ajouter un élément" value="" onChange={(e) => { if (e.target.value) appliquer(ajouterElement(d, e.target.value as (typeof ELEMENTS)[number])); }}>
            <option value="">Ajouter un élément…</option>
            {elementsAjoutables.map((t) => <option key={t} value={t}>{LIBELLES.element[t]}</option>)}
          </select>
        )}
        {d.remarques && <p className="mz-bat__remarques">Noté aussi : {d.remarques}</p>}
      </div>

      {(notes.length > 0 || carte.corrections.length > 0) && (
        <ul className="mz-bat__ajustements" aria-live="polite">
          {(notes.length > 0 ? notes : carte.corrections).map((n) => <li key={n}>Ajusté : {n}.</li>)}
        </ul>
      )}

      <footer className="mz-bat__pied">
        <div className="mz-bat__bilan">
          <span>{phraseBilan(bilan)}</span>
          <span className="mz-bat__aide">La forme et la hauteur sont vérifiées sur votre terrain par le moteur. Aucune image n’est lancée.</span>
        </div>
        <button type="button" className="mz-bat__bouton" onClick={reproduire} disabled={!onSend || inchangee}>
          {inchangee ? 'Envoyé à la 3D' : 'Reproduire en 3D'}
        </button>
      </footer>
      {inchangee && <p className="mz-bat__envoye" role="status">Mimmo prépare la 3D dans la conversation. Modifiez un point ci-dessus pour la refaire.</p>}
    </section>
  );
}
