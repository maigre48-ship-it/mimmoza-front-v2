// src/spaces/copilot/studio3d/CarteScenarioFilm.tsx
// =============================================================================
// VIS-46 — carte « Scénario du film » : la SEULE commande du film (chat ET étape film de l'Espace 3D).
//   · choisir un des 3 scénarios (un clic) ;
//   · modifier : intention, prompt de chaque plan, durée (curseur), sujet et mouvement (listes ; sujets impossibles
//     grisés avec leur raison), ordre (glisser ou ↑ ↓), ajout / retrait de plan, ambiance, format, style, musique,
//     voix off — total recalculé en direct ;
//   · « Valider et lancer le film » : UN message (bloc ```mimmoza-scenario```, action « lancer ») → le serveur établit le
//     devis et lance dans le même tour (aucune seconde question ; aucun débit ; un seul travail par scénario + projet) ;
//   · « Aperçu (gratuit) » : commande `film-apercu` (paramètre `scenario` = JSON du contrat) au Studio par le pont VIS-45
//     (animatique VIS-47 : vidéo WebM et une vignette par plan) ;
//   · retouches à la main → « Enregistrer mes retouches » (version suivante, pour que Mimmo parte de CE scénario).
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { useCopilotStore } from '../store/copilotStore';
import {
  AMBIANCES_SCENARIO, FORMATS_FILM, LIBELLES_MOUVEMENT, LIBELLES_SUJET, MOUVEMENTS_PLAN, MUSIQUES_FILM, PROMPT_MAX, STYLES_FILM, SUJETS_PLAN, TEXTE_ECRAN_MAX,
  DUREE_PLAN_MAX_S, DUREE_PLAN_MIN_S, PLANS_MAX, PLANS_MIN, empreinteScenario, type ScenarioFilm, type SujetPlan,
} from '@/lib/studio/scenarioFilm';
import { messageScenario } from '@/lib/studio/filmsChat';
import { ajouterPlan, deplacerPlan, estRetouche, etatScenario, majPlan, marques, supprimerPlan, type CarteScenarios } from './scenarioFilmChat';
import { envoyerCommandeStudio, useCommandesStudio } from './pontCommandesSite';
import { projetIdChat } from './projetChat';
import './CarteScenarioFilm.css';

const AMB: Record<ScenarioFilm['ambiance'], string> = { jour: 'Journée', fin_de_journee: 'Fin de journée', nuit: 'Nuit', couvert: 'Ciel couvert' };
const STY: Record<ScenarioFilm['style'], string> = { cinematique: 'Cinématique', commercial: 'Commercial', reseaux: 'Réseaux sociaux', documentaire: 'Documentaire' };
const MUS: Record<ScenarioFilm['musique']['ambiance'], string> = { douce: 'Douce', energique: 'Énergique', elegante: 'Élégante', aucune: 'Sans musique' };
const FMT: Record<ScenarioFilm['format'], string> = { '16:9': 'Paysage 16:9', '9:16': 'Vertical 9:16', '1:1': 'Carré 1:1' };
const maj = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const sec = (n: number) => `${String(n).replace('.', ',')} s`;

interface Props {
  carte: CarteScenarios;
  messageId: string;
  onSend?: (texte: string) => void;
  /** Espace 3D : même carte, titre discret. */
  compacte?: boolean;
}

export function CarteScenarioFilm({ carte, messageId, onSend, compacte }: Props) {
  const conversationId = useCopilotStore((s) => s.currentConversationId);
  const [choix, setChoix] = useState<number>(carte.choisi ?? 0);
  const [locaux, setLocaux] = useState<ScenarioFilm[]>(carte.propositions);
  const [envoi, setEnvoi] = useState<'lancer' | 'retouches' | null>(null);
  const [glisse, setGlisse] = useState<number | null>(null);
  const [sujetAjout, setSujetAjout] = useState<SujetPlan | ''>('');
  // Nouvelle version reçue (modification par phrase) : la carte repart de la version du serveur, même choix.
  useEffect(() => { setLocaux(carte.propositions); setEnvoi(null); }, [carte.appelId, carte.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = locaux[choix] ?? locaux[0];
  const recu = carte.propositions[choix] ?? carte.propositions[0];
  const etat = useMemo(() => etatScenario(s), [s]);
  const m = useMemo(() => marques(carte.differences[choix]), [carte.differences, choix]);
  const retouche = estRetouche(recu, s);
  const empreinte = useMemo(() => empreinteScenario(s), [s]);
  const appelApercu = `film-apercu-${messageId}-${empreinte}`;
  const apercu = useCommandesStudio((st) => st.parAppel[appelApercu]);
  const changer = (n: ScenarioFilm) => setLocaux((l) => l.map((x, i) => (i === choix ? n : x)));
  const possibles = SUJETS_PLAN.filter((x) => carte.projet.sujets.includes(x));

  const lancer = () => {
    if (!onSend || envoi || !etat.ok) return;
    setEnvoi('lancer');
    onSend(messageScenario('lancer', s, carte.version + (retouche ? 1 : 0)));
  };
  const enregistrer = () => {
    if (!onSend || envoi || !etat.ok) return;
    setEnvoi('retouches');
    onSend(messageScenario('modifier', s, carte.version + 1, 'J’ai retouché le scénario du film'));
  };
  const demanderApercu = () => {
    if (!conversationId || !etat.ok) return;
    void envoyerCommandeStudio({
      projetId: projetIdChat(conversationId), conversationId, messageId: messageId.startsWith('local-') ? null : messageId,
      appelId: appelApercu, libelle: `Aperçu du film « ${s.titre} »`, commande: { id: 'film-apercu', params: { scenario: JSON.stringify(s) } },
    });
  };
  const deposer = (vers: number) => { if (glisse !== null) changer(deplacerPlan(s, glisse, vers)); setGlisse(null); };

  const videos = (apercu?.fichiers ?? []).filter((f) => /\.(mp4|webm)$/i.test(f.nom) && f.url);
  const images = (apercu?.fichiers ?? []).filter((f) => /\.(png|jpe?g|webp)$/i.test(f.nom) && f.url);

  return (
    <section className="mz-sf" aria-label="Scénario du film">
      <div className="mz-sf__tete">
        <strong>{compacte ? 'Film — scénario' : 'Scénario du film'}</strong>
        <span className="mz-sf__version">version {carte.version}{retouche ? ' · retouchée' : ''}</span>
      </div>
      <p className="mz-sf__sous">Construit sur « {carte.projet.nom} ». Choisissez, modifiez, puis validez : un seul bouton lance le film.</p>
      {carte.propositions.length > 1 && (
        <div className="mz-sf__onglets" role="tablist" aria-label="Scénarios proposés">
          {locaux.map((p, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === choix} className={`mz-sf__btn${i === choix ? ' is-actif' : ''}`} onClick={() => setChoix(i)}>
              {i + 1}. {p.titre} · {sec(p.duree_s)}
            </button>
          ))}
        </div>
      )}
      {(carte.changements.length > 0) && <ul className="mz-sf__liste is-ok">{carte.changements.map((c, i) => <li key={i}>{c}</li>)}</ul>}
      {(carte.refus.length > 0) && <ul className="mz-sf__liste is-ko">{carte.refus.map((c, i) => <li key={i}>{c}</li>)}</ul>}

      <label className="mz-sf__champ">Intention du film{m.champs.has('intention') && <span className="mz-sf__marque">modifiée</span>}
        <textarea value={s.intention} maxLength={500} rows={3} onChange={(e) => changer({ ...s, intention: e.target.value })} />
      </label>
      <div className="mz-sf__grille">
        <label className="mz-sf__champ">Lumière{m.champs.has('ambiance') && <span className="mz-sf__marque">modifiée</span>}
          <select value={s.ambiance} onChange={(e) => changer({ ...s, ambiance: e.target.value as ScenarioFilm['ambiance'] })}>{AMBIANCES_SCENARIO.map((a) => <option key={a} value={a}>{AMB[a]}</option>)}</select>
        </label>
        <label className="mz-sf__champ">Format{m.champs.has('format') && <span className="mz-sf__marque">modifié</span>}
          <select value={s.format} onChange={(e) => changer({ ...s, format: e.target.value as ScenarioFilm['format'] })}>{FORMATS_FILM.map((f) => <option key={f} value={f}>{FMT[f]}</option>)}</select>
        </label>
        <label className="mz-sf__champ">Style
          <select value={s.style} onChange={(e) => changer({ ...s, style: e.target.value as ScenarioFilm['style'] })}>{STYLES_FILM.map((f) => <option key={f} value={f}>{STY[f]}</option>)}</select>
        </label>
        <label className="mz-sf__champ">Musique{m.champs.has('musique') && <span className="mz-sf__marque">modifiée</span>}
          <select value={s.musique.ambiance} onChange={(e) => changer({ ...s, musique: { ambiance: e.target.value as ScenarioFilm['musique']['ambiance'] } })}>{MUSIQUES_FILM.map((f) => <option key={f} value={f}>{MUS[f]}</option>)}</select>
        </label>
      </div>
      <label className="mz-sf__champ">
        <span><input type="checkbox" checked={s.voix_off !== null} onChange={(e) => changer({ ...s, voix_off: e.target.checked ? { texte: s.intention.slice(0, 600) || s.titre } : null })} /> Voix off{m.champs.has('voix_off') && <span className="mz-sf__marque">modifiée</span>}</span>
        {s.voix_off && <textarea value={s.voix_off.texte} maxLength={600} rows={2} onChange={(e) => changer({ ...s, voix_off: { texte: e.target.value } })} />}
      </label>

      <ol className="mz-sf__plans" aria-label="Plans du film">
        {s.plans.map((p, i) => {
          const marque = m.plans[p.id];
          return (
            <li key={p.id} className={`mz-sf__plan${marque ? ` is-${marque}` : ''}${glisse === i ? ' is-glisse' : ''}`}
              draggable onDragStart={() => setGlisse(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => deposer(i)} onDragEnd={() => setGlisse(null)}>
              <div className="mz-sf__plan-tete">
                <span className="mz-sf__num" title="Glisser pour réordonner">{i + 1}.</span>
                <select aria-label={`Sujet du plan ${i + 1}`} value={p.sujet} onChange={(e) => changer(majPlan(s, i, { sujet: e.target.value as SujetPlan }))}>
                  {SUJETS_PLAN.map((x) => {
                    const ok = carte.projet.sujets.includes(x);
                    return <option key={x} value={x} disabled={!ok} title={ok ? undefined : carte.projet.raisons[x]}>{maj(LIBELLES_SUJET[x])}{ok ? '' : ` — ${carte.projet.raisons[x] ?? 'impossible'}`}</option>;
                  })}
                </select>
                <select aria-label={`Mouvement du plan ${i + 1}`} value={p.mouvement} onChange={(e) => changer(majPlan(s, i, { mouvement: e.target.value as ScenarioFilm['plans'][number]['mouvement'] }))}>
                  {MOUVEMENTS_PLAN.map((x) => <option key={x} value={x}>{maj(LIBELLES_MOUVEMENT[x])}</option>)}
                </select>
                {marque && <span className="mz-sf__marque">{marque === 'ajoute' ? 'ajouté' : marque === 'modifie' ? 'modifié' : 'déplacé'}</span>}
                <button type="button" className="mz-sf__btn" aria-label="Monter" disabled={i === 0} onClick={() => changer(deplacerPlan(s, i, i - 1))}>↑</button>
                <button type="button" className="mz-sf__btn" aria-label="Descendre" disabled={i === s.plans.length - 1} onClick={() => changer(deplacerPlan(s, i, i + 1))}>↓</button>
                <button type="button" className="mz-sf__btn" aria-label="Retirer le plan" disabled={s.plans.length <= PLANS_MIN} title={s.plans.length <= PLANS_MIN ? `${PLANS_MIN} plans au minimum` : undefined} onClick={() => changer(supprimerPlan(s, i))}>✕</button>
              </div>
              <label className="mz-sf__champ">Ce que montre le plan
                <textarea value={p.prompt} maxLength={PROMPT_MAX} rows={2} onChange={(e) => changer(majPlan(s, i, { prompt: e.target.value }))} />
                <span className="mz-sf__compteur">{p.prompt.length} / {PROMPT_MAX}</span>
              </label>
              <div className="mz-sf__duree">
                <span>Durée</span>
                <input type="range" min={DUREE_PLAN_MIN_S} max={DUREE_PLAN_MAX_S} step={0.5} value={p.duree_s} aria-label={`Durée du plan ${i + 1}`} onChange={(e) => changer(majPlan(s, i, { duree_s: Number(e.target.value) }))} />
                <strong>{sec(p.duree_s)}</strong>
              </div>
              <label className="mz-sf__champ">Texte à l’écran (facultatif)
                <input type="text" value={p.texte_ecran ?? ''} maxLength={TEXTE_ECRAN_MAX} onChange={(e) => changer(majPlan(s, i, { texte_ecran: e.target.value }))} />
              </label>
            </li>
          );
        })}
      </ol>
      <div className="mz-sf__onglets">
        <select aria-label="Sujet du plan à ajouter" value={sujetAjout} onChange={(e) => setSujetAjout(e.target.value as SujetPlan)} style={{ width: 'auto' }}>
          <option value="">Ajouter un plan…</option>
          {possibles.map((x) => <option key={x} value={x}>{maj(LIBELLES_SUJET[x])}</option>)}
        </select>
        <button type="button" className="mz-sf__btn" disabled={!sujetAjout || s.plans.length >= PLANS_MAX} onClick={() => { if (sujetAjout) { changer(ajouterPlan(s, sujetAjout, carte.projet)); setSujetAjout(''); } }}>+ Ajouter</button>
      </div>

      <p className={`mz-sf__total${etat.ok ? '' : ' is-ko'}`}>Total : {sec(etat.total)} · {s.plans.length} plans{m.champs.has('duree_s') ? ' (durée modifiée)' : ''}</p>
      {!etat.ok && <ul className="mz-sf__liste is-ko">{etat.erreurs.map((e, i) => <li key={i}>{e}</li>)}</ul>}

      <div className="mz-sf__pied">
        <button type="button" className="mz-sf__btn is-principal" disabled={!onSend || !etat.ok || envoi !== null} onClick={lancer}>
          {envoi === 'lancer' ? 'Film demandé…' : 'Valider et lancer le film'}
        </button>
        <button type="button" className="mz-sf__btn" disabled={!conversationId || !etat.ok || Boolean(apercu && apercu.etat !== 'echec')} onClick={demanderApercu}>Aperçu (gratuit)</button>
        {retouche && <button type="button" className="mz-sf__btn" disabled={!onSend || !etat.ok || envoi !== null} onClick={enregistrer}>Enregistrer mes retouches</button>}
        <p className="mz-sf__cout">{carte.cout || 'Aucun débit pour le film : seul ce message du chat est compté.'} Vous pouvez aussi écrire la modification dans le chat (« raccourcis à 30 s », « plus de drone »).</p>
      </div>
      {envoi === 'lancer' && <p className="mz-sf__note">Scénario envoyé : Mimmo établit le devis et lance le film dans sa réponse (le suivi s’affiche sous la réponse).</p>}
      {apercu && (
        <div className="mz-sf__apercu" aria-live="polite">
          <p className="mz-sf__note">{apercu.message || 'Aperçu demandé au Studio…'}</p>
          {videos.map((f) => <video key={f.nom} src={f.url!} controls playsInline />)}
          {images.length > 0 && <div className="mz-sf__vignettes">{images.map((f) => <img key={f.nom} src={f.url!} alt={f.nom} />)}</div>}
        </div>
      )}
    </section>
  );
}
