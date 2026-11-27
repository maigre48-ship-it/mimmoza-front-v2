// src/spaces/copilot/studio3d/CarteHabillageProjet.tsx
// =============================================================================
// VIS-57 — carte « Habiller le projet » : étape proposée par Mimmo AVANT un film, une image ou une visite 360° lancés
// depuis le chat. Trois thèmes (matières, déco des pièces, extérieurs et végétation) ; pour chacun :
//   · « Ouvrir … dans le Studio » : la page dédiée du Studio, par le pont du parcours (ouvrirLeStudio) ;
//     puis « Valider mes choix » une fois revenu (l'aménagement extérieur placé est relu dans le stockage partagé) ;
//   · « Laisser Mimmo choisir » : thème délégué (et, pour la déco et les extérieurs, commande du Studio
//     interieur-decorer / exterieur-mimmo-plante envoyée par le pont VIS-45).
// Chaque choix est une trace `copilot_action_runs` (aucun jeton, aucun message du chat) relue par le serveur.
// Le lancement n'est possible que lorsque CHAQUE thème est choisi ou délégué (garde du serveur et boutons grisés).
// Logique : src/lib/studio/habillageProjet.ts.
// =============================================================================
import { useMemo, useState } from 'react';
import { useCopilotStore } from '../store/copilotStore';
import type { ActionRun } from '../types/copilot.types';
import {
  DEFINITIONS_THEMES, habillageComplet, habillageDesTraces, lireAmenagementPartage, messageHabillageTermine, paramsTraceHabillage,
  rappelHabillage, resumeAmenagement, THEMES_HABILLAGE, type HabillageProjet, type ModeTheme, type ThemeHabillage, type TypeRenduHabillage,
} from '@/lib/studio/habillageProjet';
import { dernierMessagePersiste, envoyerCommandeStudio } from './pontCommandesSite';
import { ouvrirLeStudio } from './CarteCommandeStudio';
import { projetIdChat } from './projetChat';
import { briefCourant, recapitulatif } from './briefCreatif';
import './CarteHabillageProjet.css';

/** Habillage de la conversation courante, d'après les traces relues (rechargement compris). */
export function useHabillageProjet(): HabillageProjet {
  const runs = useCopilotStore((s) => s.actionRuns);
  return useMemo(() => habillageDesTraces(runs.map((r) => r.params)), [runs]);
}

interface Props {
  /** Message qui porte la carte (les traces s'y rattachent ; id local → dernier message persisté). */
  messageId: string;
  type: TypeRenduHabillage;
  /** Image, visite : une fois tout choisi, UN message relance le devis. Absent (film) : la carte de scénario lance. */
  onSend?: (texte: string) => void;
  /** Dans la carte de scénario : titre discret, sans bouton de suite. */
  integree?: boolean;
}

export function CarteHabillageProjet({ messageId, type, onSend, integree }: Props) {
  const conversationId = useCopilotStore((s) => s.currentConversationId);
  const messages = useCopilotStore((s) => s.messages);
  const remember = useCopilotStore((s) => s.rememberActionRun);
  const h = useHabillageProjet();
  const [ouverts, setOuverts] = useState<Partial<Record<ThemeHabillage, boolean>>>({});
  const [modifie, setModifie] = useState<Partial<Record<ThemeHabillage, boolean>>>({});
  const [note, setNote] = useState<string | null>(null);
  const [suiteEnvoyee, setSuiteEnvoyee] = useState(false);
  const complet = habillageComplet(h);
  const rappel = rappelHabillage(h);

  const attache = !messageId.startsWith('local-') ? messageId : dernierMessagePersiste(messages as never);

  const tracer = (theme: ThemeHabillage, mode: ModeTheme, resume: string | null, amenagement: Record<string, unknown> | null = null) => {
    if (!attache) { setNote('Envoyez d’abord un message à Mimmo : le choix se range dans la conversation.'); return false; }
    const le = new Date().toISOString();
    const run: ActionRun = {
      messageId: attache, actionKind: 'run_step', outcome: 'done', decidedBy: 'user', createdAt: le,
      message: `${DEFINITIONS_THEMES[theme].titre} : ${mode === 'delegue' ? 'Mimmo choisit' : 'choisi dans le Studio'}`,
      params: paramsTraceHabillage(theme, mode, { resume, amenagement, le }),
    };
    remember(run);
    setModifie((m) => ({ ...m, [theme]: false }));
    return true;
  };

  const ouvrir = (theme: ThemeHabillage) => {
    const d = DEFINITIONS_THEMES[theme].studio;
    setNote(null);
    ouvrirLeStudio(d.etape, d.sous, (m) => setNote(m));
    setOuverts((o) => ({ ...o, [theme]: true }));
  };

  const valider = (theme: ThemeHabillage) => {
    if (theme === 'exterieur') {
      let s: Storage | null = null;
      try { s = localStorage; } catch { s = null; }
      const lu = conversationId ? lireAmenagementPartage(s, projetIdChat(conversationId)) : null;
      if (!lu) setNote('Le Studio n’a transmis aucun élément placé pour ce projet : le jardin sera composé automatiquement au rendu. Placez vos plantations dans Aménagement › Extérieurs, puis validez à nouveau.');
      tracer('exterieur', 'choisi', lu ? resumeAmenagement(lu.amenagement) : null, lu?.amenagement ?? null);
      return;
    }
    const brief = theme === 'matieres' ? briefCourant(messages as never) : null;
    tracer(theme, 'choisi', theme === 'matieres'
      ? `${brief ? `${recapitulatif(brief)} ; ` : ''}façade, toiture et sols réglés dans Bâtiment › Matériaux`.slice(0, 300)
      : 'déco posée pièce par pièce dans l’onglet Déco');
  };

  const deleguer = (theme: ThemeHabillage) => {
    if (!tracer(theme, 'delegue', null)) return;
    const c = DEFINITIONS_THEMES[theme].commandeMimmo;
    if (c && conversationId) {
      void envoyerCommandeStudio({
        projetId: projetIdChat(conversationId), conversationId, messageId: attache, appelId: `habillage-${theme}-${attache ?? 'local'}`,
        libelle: c.libelle, commande: { id: c.id, params: c.params },
      });
    }
  };

  const suite = () => {
    if (!onSend || !complet || suiteEnvoyee) return;
    setSuiteEnvoyee(true);
    onSend(messageHabillageTermine(type));
  };

  return (
    <section className={`mz-hab${integree ? ' is-integree' : ''}`} aria-label="Habiller le projet">
      <div className="mz-hab__tete">
        <strong>{integree ? 'Habillage du projet' : 'Habiller le projet'}</strong>
        <span className={`mz-hab__etat${complet ? ' is-ok' : ''}`}>{complet ? 'Tout est choisi' : `${THEMES_HABILLAGE.filter((t) => h.themes[t]).length} / 3 choisis`}</span>
      </div>
      {!integree && <p className="mz-hab__sous">Avant de lancer le rendu, choisissez chaque thème dans le Studio ou laissez Mimmo choisir. Rien n’est débité ici.</p>}
      <ul className="mz-hab__themes">
        {THEMES_HABILLAGE.map((t, i) => {
          const d = DEFINITIONS_THEMES[t];
          const c = h.themes[t];
          const enEdition = !c || modifie[t];
          return (
            <li key={t} className={`mz-hab__theme${c ? ' is-fait' : ''}`}>
              <div className="mz-hab__ligne">
                <span className="mz-hab__titre">{d.titre}</span>
                {c && <span className={`mz-hab__pastille${c.mode === 'delegue' ? ' is-delegue' : ''}`}>{c.mode === 'delegue' ? 'Mimmo choisit' : `${d.choisi.charAt(0).toUpperCase()}${d.choisi.slice(1)}`}</span>}
              </div>
              <p className="mz-hab__detail">{c ? rappel[i]!.replace(`${d.titre} : `, '') : d.detail}</p>
              <div className="mz-hab__actions">
                {enEdition ? <>
                  <button type="button" className={`mz-hab__btn${ouverts[t] ? ' is-actif' : ''}`} onClick={() => ouvrir(t)}>Ouvrir {d.studio.libelle} dans le Studio</button>
                  {ouverts[t] && <button type="button" className="mz-hab__btn is-principal" onClick={() => valider(t)}>Valider mes choix</button>}
                  <button type="button" className="mz-hab__btn" onClick={() => deleguer(t)}>Laisser Mimmo choisir</button>
                </> : <button type="button" className="mz-hab__btn" onClick={() => setModifie((m) => ({ ...m, [t]: true }))}>Modifier</button>}
              </div>
            </li>
          );
        })}
      </ul>
      {note && <p className="mz-hab__note" role="status">{note}</p>}
      {!integree && onSend && (
        <div className="mz-hab__pied">
          <button type="button" className="mz-hab__btn is-principal" disabled={!complet || suiteEnvoyee} onClick={suite}>
            {suiteEnvoyee ? 'Devis demandé…' : complet ? 'Continuer : établir le devis' : 'Choisissez ou déléguez chaque thème'}
          </button>
        </div>
      )}
    </section>
  );
}
