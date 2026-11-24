import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../types/copilot.types';
import { jarvisMassing, latestJarvisDraft, readJarvisDraft, reconcileJarvisDraft, type JarvisDraft } from './jarvisDraft';
import { JarvisMassingPreview } from './JarvisMassingPreview';
import { PhotoTerrainImplantation } from './PhotoTerrainImplantation';
import type { ConfirmedTerrain } from './terrainCadastre';
import type { TerrainStudio } from '@/spaces/promoteur/shared/ouvrirStudio3D';
import { listJarvisFiles } from './jarvisFiles';
import { loadJarvisDraft, saveJarvisDraft, type SavedJarvisDraft } from './jarvisDraftRepository';
import { latestStudioVolume, type StudioVolumeMessage } from './studioBridge';
import { ArrowUpRight, Box, FileStack } from 'lucide-react';
// R2 — « Voir en 3D » en un clic ; sans parcelle confirmée, une seule question.
import { ConfirmerParcelle } from './ConfirmerParcelle';
// Film ou visite 360° en 3 clics (contrat docs/studio/CONTRAT_FILM_VISITE.md).
import { FilmVisitePanel } from './FilmVisitePanel';
import './JarvisDraftPanel.css';
// Parcelle de la conversation + volume d'étude simple, et « Voir en 3D réaliste dans Studio » (même parcours que « Voir en 3D »).
import { useContexteVolume, VolumeParcelleSection } from './VolumeParcelleSection';
import { diagnostiquerPreparation3D, exigerPreparation3D } from './preparation3D';
// Lot E1 : 3D préparée par Mimmo (outil studio_preparer_3d) — ouverture en un clic, suivi des rendus.
import { PreparationStudioSection } from './PreparationStudioSection';
import { messageErreur } from "@/components/ui/messageErreur";
// Lot fiche-3d : programme, dimensions (forme, L × l × niveaux) et style tirés du moteur et du brief créatif.
import { DimensionsFiche, ProgrammeFiche, StyleFiche } from './FicheProjet3D';
import { useFiche3D } from './useFiche3D';
import { apercuDepuisEvaluation } from './ficheDimensions';
import type { EtatHabillage } from './FicheProjet3D';
// Lot brief-formes : limites du dossier (bâtiment à ailes → pas de toit à deux pans).
import { limitesDossier } from './briefCreatif';
// VIS-17 — parcours guidé en tête du panneau ; les étapes ouvrent les outils existants (fiche, habillage, brief relié
// au rendu, feuille « Film, visite 360° ou image »).
import { ParcoursPanneau, type ActionnerParcours } from './ParcoursGuide';
// VIS-18b : petits réglages dans les étapes (cible, gamme sans étude ; fond de l'image).
import { reglageDeLEtape } from './ReglagesParcours';
import { COULEURS_ETAPE, type CibleParcours, type Parcours, type TypeParcours } from '@/lib/studio/parcours';
import type { CommandeRendu, ParcoursRendu } from './FilmVisitePanel';
// VIS-28 (24/11) : l'écran des étapes 6 / 7 / 8 s'ouvre sur la feuille du type du parcours (jamais un nouveau choix).
import { feuilleDeLEtape, TRAVAIL_DU_PARCOURS } from './renduParcours';
import { ouverturePreparation } from './preparationStudio';
import { BriefProjetRenduSection } from '@/spaces/promoteur/pages/BriefProjetRenduSection';
import { etudeDeLaConversation } from '@/spaces/promoteur/shared/briefProjet.store';

/** VIS-17 — commande d'une étape du parcours vers le panneau (jeton : une valeur par clic). */
export interface CommandeParcours { cible: CibleParcours | 'parcours' | 'terrain-carte'; type: TypeParcours; jeton: number }
const FEUILLE_DU_TYPE = { image: 'image', film: 'film', visite: 'visite360' } as const;

const LABELS = {
  objectif: 'Objectif',
  localisation: 'Lieu',
  programme: 'Programme',
  dimensions: 'Forme et dimensions',
  style: 'Style et habillage',
  contraintes: 'Contraintes',
} as const;
type Field = keyof typeof LABELS;

/** R2 — résultat de l'ouverture : `parcelle-requise` = poser la question minimale dans le dossier. */
export type IssueOuvertureStudio = void | 'parcelle-requise';

export function JarvisDraftPanel({ messages, conversationId, onOpenStudio, onPrepareDetailed, onSend, habillage, onHabillage, parcours, onParcours, commandeParcours, etapeDemandee, noticeParcours, onValiderApercu, apercuValide }: {
  messages: readonly ChatMessage[];
  conversationId: string | null;
  /** VIS-17 : parcours calculé (CopilotChat), actions des étapes, commande d'une étape cliquée (panneau ou carte du chat). */
  parcours?: Parcours | null;
  onParcours?: ActionnerParcours;
  onTypeParcours?: (t: TypeParcours) => void;
  commandeParcours?: CommandeParcours | null;
  /** 23/11 — étape cliquée dans la carte du chat : l'Espace 3D affiche l'écran de CETTE étape (et rien d'autre). */
  etapeDemandee?: { cle: string; jeton: number } | null;
  noticeParcours?: string | null;
  onValiderApercu?: (travailId: string) => void;
  apercuValide?: string | null;
  /**
   * Lot brief-unifié : section habillage ouverte ou non (tenu par CopilotChat : ligne « Choisir l'habillage → » du chat,
   * demande de brief de Mimmo) ; `demande` porte le type du rendu attendu, `jeton` change à chaque ouverture demandée.
   */
  habillage?: EtatHabillage | null;
  onHabillage?: (ouverte: boolean) => void;
  /** Lot fiche-3d : envoi d'un message au chat (habillage choisi dans la fiche, même brief que la carte). */
  onSend?: (texte: string) => void;
  onOpenStudio?: (draft: JarvisDraft, conversationId: string, terrain?: ConfirmedTerrain & { adresse?: string | null }) => Promise<IssueOuvertureStudio>;
  /** Ancienne fenêtre de transfert, gardée pour classer photos, plans et 360° (mode détaillé). */
  onPrepareDetailed?: (draft: JarvisDraft, conversationId: string) => Promise<void>;
}) {
  const proposal = useMemo(() => latestJarvisDraft(messages), [messages]);
  const proposalMessage = [...messages].reverse().find(message =>
    message.role === 'assistant' && readJarvisDraft(message.text));
  const [saved, setSaved] = useState<SavedJarvisDraft | null>(null);
  const [loading, setLoading] = useState(Boolean(conversationId));
  const [files, setFiles] = useState<string[]>([]);
  const [fileError, setFileError] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<JarvisDraft | null>(null);
  const [questionsText, setQuestionsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [opening, setOpening] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [studioVolume, setStudioVolume] = useState<StudioVolumeMessage | null>(null);
  const [measuredTerrain, setMeasuredTerrain] = useState<TerrainStudio | null>(null);
  const [demandeParcelle, setDemandeParcelle] = useState(false);
  // R2 — « génère la 3D » ou le bouton ▢ sans parcelle confirmée : la question s'affiche ici.
  useEffect(() => {
    const surDemande = (event: Event) => { if ((event as CustomEvent<string>).detail === conversationId) setDemandeParcelle(true); };
    window.addEventListener('mzia-3d-parcelle-requise', surDemande);
    return () => window.removeEventListener('mzia-3d-parcelle-requise', surDemande);
  }, [conversationId]);

  useEffect(() => {
    setMeasuredTerrain(null);
    setStudioVolume(conversationId ? latestStudioVolume(conversationId) : null);
    const receive = (event: Event) => {
      const message = (event as CustomEvent<StudioVolumeMessage>).detail;
      if (message?.conversationId === conversationId) setStudioVolume(message);
    };
    window.addEventListener('mzia-studio-volume', receive);
    return () => window.removeEventListener('mzia-studio-volume', receive);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    let active = true;
    void loadJarvisDraft(conversationId).then(row => {
      if (active) { setSaved(row); setLoading(false); }
    }).catch(() => {
      if (active) { setNotice('Sauvegarde en ligne indisponible. Vous pouvez continuer ce test dans Studio.'); setLoading(false); }
    });
    return () => { active = false; };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    let active = true;
    const refresh = () => {
      void listJarvisFiles(conversationId).then(names => {
        if (active) { setFiles(names); setFileError(''); }
      }).catch(() => { if (active) setFileError('Pièces jointes momentanément indisponibles.'); });
    };
    const onChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === conversationId) refresh();
    };
    refresh();
    window.addEventListener('mzia-3d-files-changed', onChange);
    return () => { active = false; window.removeEventListener('mzia-3d-files-changed', onChange); };
  }, [conversationId]);

  const draft = saved ? reconcileJarvisDraft(saved.draft, messages, saved.updatedAt) : proposal;
  // Appelé avant le retour anticipé (règle des hooks) : parcelle, programme et règles PLU de la conversation.
  const volume = useContexteVolume(messages, conversationId, draft);
  // Lot fiche-3d : volume préparé par Mimmo (moteur) — préremplit programme et dimensions, jamais le texte du modèle.
  const fiche3d = useFiche3D(messages, conversationId);
  const ficheOk = fiche3d.etat === 'ok' ? fiche3d : null;
  const styleFiche = <StyleFiche messages={messages} apercu={ficheOk ? apercuDepuisEvaluation(ficheOk.ev) : null}
    limites={limitesDossier(ficheOk?.ev.corps)} onSend={onSend} habillage={habillage ?? null} onHabillage={onHabillage} />;
  // Lot brief-unifié : sans fiche du moteur, la section habillage reste disponible si le chat ou Mimmo l'ouvre.
  const habillageSansFiche = !ficheOk && !!habillage?.ouverte;
  const parcelleConnue = volume.contexte.parcelle.type !== 'aucune';

  // VIS-17 — rendus (film, visite, image) aussi depuis la 3D préparée par Mimmo (parcours mission, sans fiche décrite).
  const draftPret = !!draft && !!draft.objectif?.trim() && diagnostiquerPreparation3D(draft).pret;
  const prepRendu = useMemo(() => {
    if (!ficheOk) return null;
    const o = ouverturePreparation({ ...ficheOk.prep, volume: ficheOk.ev.volume });
    return o.ok ? { draft: o.fiche, terrain: o.terrain } : null;
  }, [ficheOk]);
  const rendu = conversationId ? (draft && draftPret ? { draft, terrain: undefined } : prepRendu) : null;
  const refParcours = useRef<HTMLDivElement | null>(null);
  const refDimensions = useRef<HTMLDivElement | null>(null);
  const refReglages = useRef<HTMLDivElement | null>(null);
  const [reglagesOuverts, setReglagesOuverts] = useState(false);
  const [noteParcours, setNoteParcours] = useState<string | null>(null);
  // VIS-20 : étape 1 / 2 ouverte par une commande (carte du chat ou bouton de l'étape) ; `carte` : carte cadastrale ouverte.
  const [reglageOuvert, setReglageOuvert] = useState<{ cle: string; carte: boolean; jeton: number } | null>(null);
  const [commandeRendu, setCommandeRendu] = useState<CommandeRendu | null>(null);
  const etude = useMemo(() => (conversationId ? etudeDeLaConversation(conversationId) : null), [conversationId]);
  const jetonParcours = commandeParcours?.jeton ?? 0;
  // Une commande n'est exécutée qu'une fois (pas de nouveau à la remontée du panneau sur la même conversation).
  const dernierJetonParcours = useRef(jetonParcours);
  useEffect(() => {
    const c = commandeParcours;
    if (!c || jetonParcours === 0 || jetonParcours === dernierJetonParcours.current) return;
    dernierJetonParcours.current = jetonParcours;
    setNoteParcours(null);
    const defiler = (r: { current: HTMLElement | null }) => window.requestAnimationFrame(() => r.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
    const versRendu = (feuille: CommandeRendu['feuille'], qualite?: CommandeRendu['qualite']) => {
      if (!rendu) { setNoteParcours('Les images, films et visites se lancent depuis la 3D : préparez-la d’abord (étape 3).'); defiler(refParcours); return; }
      setCommandeRendu((p) => ({ feuille, ...(qualite ? { qualite } : {}), jeton: (p?.jeton ?? 0) + 1 }));
    };
    switch (c.cible) {
      case 'parcours': defiler(refParcours); break;
      // VIS-20 : terrain et programme se font DANS l'étape (champ, carte cadastrale), jamais sur une autre page.
      case 'terrain': defiler(refParcours); break; // 23/11 : le champ du terrain est dans la carte du chat
      case 'terrain-carte': setReglageOuvert({ cle: 'terrain', carte: true, jeton: jetonParcours }); defiler(refParcours); break;
      case 'programme': defiler(refParcours); break; // 23/11 : les champs du programme sont dans la carte du chat
      case 'dimensions':
        if (ficheOk) defiler(refDimensions);
        else { setNoteParcours('Le volume s’ajuste ici une fois la 3D préparée par Mimmo ; sinon, ouvrez-le dans le Studio.'); defiler(refParcours); }
        break;
      case 'reglages-rendu':
        if (etude) { setReglagesOuverts(true); defiler(refReglages); }
        else { setNoteParcours('Vues, lumière et gamme se règlent dans le brief d’une étude : aucune étude n’est rattachée à cette conversation. Choisissez les vues dans la feuille « Image ».'); versRendu('image'); }
        break;
      case 'feuille-image': versRendu('image'); break;
      case 'feuille-film': versRendu('film'); break;
      case 'feuille-visite': versRendu('visite360'); break;
      // VIS-18b : l'aperçu du MÊME type (image rapide, film court, panoramas basse définition).
      case 'apercu': versRendu(FEUILLE_DU_TYPE[c.type], 'apercu'); break;
      case 'final': versRendu(FEUILLE_DU_TYPE[c.type], 'finale'); break;
      case 'resultats': versRendu(null); break;
      default: break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jetonParcours]);
  // 23/11 — UN ÉCRAN PAR ÉTAPE : l'Espace 3D n'affiche que le contenu de l'étape active (celle cliquée dans le chat,
  // sinon l'étape courante du parcours) ; les pastilles de l'en-tête changent l'étape affichée.
  const [etapeChoisie, setEtapeChoisie] = useState<string | null>(null);
  const jetonEtape = etapeDemandee?.jeton ?? 0;
  // L'étape choisie retombe sur l'étape courante quand la conversation change ou que le parcours avance (pas au montage :
  // le panneau peut s'ouvrir justement parce qu'une étape vient d'être cliquée).
  const repereEtape = useRef(`${String(conversationId)}|${String(parcours?.courante)}`);
  useEffect(() => {
    const r = `${String(conversationId)}|${String(parcours?.courante)}`;
    if (r !== repereEtape.current) { repereEtape.current = r; setEtapeChoisie(null); }
  }, [conversationId, parcours?.courante]);
  useEffect(() => { if (etapeDemandee && jetonEtape > 0) setEtapeChoisie(etapeDemandee.cle); }, [jetonEtape]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (habillage?.ouverte) setEtapeChoisie('style'); }, [habillage?.jeton, habillage?.ouverte]);
  const clesEtapes = parcours?.etapes.map((e) => e.cle as string) ?? [];
  const etapeActive = parcours ? (etapeChoisie && clesEtapes.includes(etapeChoisie) ? etapeChoisie : parcours.courante ?? clesEtapes[clesEtapes.length - 1] ?? null) : null;
  /** Vrai si l'écran de l'une de ces étapes est affiché (sans parcours : tout est affiché, comme avant). */
  const vu = (...cles: string[]) => !etapeActive || cles.includes(etapeActive);
  const cache = (...cles: string[]) => (vu(...cles) ? undefined : { display: 'none' as const });
  const ETAPE_6 = ['vues', 'scenario', 'pieces'];
  const RENDUS = [...ETAPE_6, 'apercu', 'final'];
  const infoEtape = etapeActive === 'terrain' ? 'Le terrain se désigne dans le chat (adresse, numéros de parcelles ou « Choisir sur la carte »).'
    : null;
  // VIS-30 — écran de l'étape 5 : aperçu du logement témoin et LE bouton de l'étape (même action que la carte du chat :
  // `onParcours` = actionnerParcours de CopilotChat → page « Aménager l'intérieur » du Studio, dans son onglet).
  const etapeTemoin = etapeActive === 'interieurs' ? parcours?.etapes.find((e) => e.cle === 'interieurs') ?? null : null;
  const apercuTemoin = etapeTemoin?.apercu ? <section aria-label="Logement témoin" className="mz-ecran-etape__temoin"
    style={{ margin: '8px 2px 12px', padding: '10px 12px', border: `1px solid ${COULEURS_ETAPE.interieurs}`, borderRadius: 10, background: '#fff' }}>
    <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 13 }}>{etapeTemoin.apercu.titre}</p>
    <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>{etapeTemoin.apercu.lignes.map((l) => <li key={l}>{l}</li>)}</ul>
    {onParcours && <button type="button" className="mz-parcours__action is-primaire" style={{ ['--etape' as string]: COULEURS_ETAPE.interieurs }}
      onClick={() => onParcours(etapeTemoin, etapeTemoin.action)}>{etapeTemoin.action.libelle}</button>}
  </section> : null;
  // Récapitulatif SANS commande du parcours (elles sont dans la carte du chat) ; seul détail : la carte cadastrale de
  // l'étape 1, quand le chat la demande (« Choisir sur la carte »).
  const parcoursUi = parcours ? <div ref={refParcours}>
    <ParcoursPanneau parcours={parcours} active={etapeActive} onChoisir={(cle) => setEtapeChoisie(cle)} notice={noticeParcours ?? null}
      detail={(e) => (e.cle === 'terrain' && reglageOuvert?.cle === 'terrain' && reglageOuvert.carte
        ? reglageDeLEtape(e, { conversationId, messages: messages as never, onSend, ouvert: reglageOuvert }) : null)} />
    {noteParcours && <p role="status" className="jarvis-dossier__proposal">{noteParcours}</p>}
    {infoEtape && <p className="mz-ecran-etape__vide">{infoEtape}</p>}
    {apercuTemoin}
    {reglagesOuverts && etude && <div ref={refReglages} style={{ margin: '0 0 12px' }}>
      <BriefProjetRenduSection studyId={etude} source="parcours" />
      <button type="button" className="jarvis-dossier__link" onClick={() => setReglagesOuverts(false)}>Fermer les réglages</button>
    </div>}
  </div> : null;
  // VIS-28 — parcours choisi : l'écran des rendus porte SON type et s'ouvre d'office sur la feuille de l'étape affichée
  // (étape courante à l'arrivée, pastille de l'en-tête ou étape cliquée dans le chat) — même chemin pour les trois.
  const etapeRendu = parcours && etapeActive && RENDUS.includes(etapeActive) ? parcours.etapes.find((e) => e.cle === etapeActive) ?? null : null;
  const parcoursRendu: ParcoursRendu | null = parcours ? {
    type: TRAVAIL_DU_PARCOURS[parcours.type], cle: etapeRendu?.cle ?? '', feuille: feuilleDeLEtape(parcours.type, etapeRendu),
  } : null;
  const panneauRendu = (assurer?: () => Promise<void>) => rendu && conversationId ? <FilmVisitePanel draft={rendu.draft} conversationId={conversationId}
    assurerValidation={assurer} commande={commandeRendu} terrainParDefaut={rendu.terrain} onValiderApercu={onValiderApercu} apercuValide={apercuValide}
    parcoursRendu={parcoursRendu} /> : null;

  if (!draft) return <aside className="mzia-fen3d__vide" aria-label="Dossier de préparation 3D">
    {parcoursUi}
    <div style={cache('volume', ...(rendu ? [] : RENDUS))}><PreparationStudioSection messages={messages} conversationId={conversationId} onOpenStudio={onOpenStudio} suiviRendus={!rendu} /></div>
    <div style={cache(...RENDUS)}>{panneauRendu()}</div>
    {ficheOk && <dl className="jarvis-dossier__fields" style={cache('conception', 'volume', 'style')}>
      <div style={cache('conception')} className="jarvis-dossier__field jarvis-dossier__field--large"><dt>Programme</dt><dd><ProgrammeFiche fiche={ficheOk} texteModele={null} /></dd></div>
      <div style={cache('volume')} className="jarvis-dossier__field jarvis-dossier__field--large" ref={refDimensions}><dt>{LABELS.dimensions}</dt><dd><DimensionsFiche fiche={ficheOk} conversationId={conversationId} onOpenStudio={onOpenStudio} texteModele={null} onSend={onSend} /></dd></div>
      <div style={cache('style')} className="jarvis-dossier__field jarvis-dossier__field--large"><dt>{LABELS.style}</dt><dd>{styleFiche}</dd></div>
    </dl>}
    {habillageSansFiche && <dl className="jarvis-dossier__fields" style={cache('style')}>
      <div className="jarvis-dossier__field jarvis-dossier__field--large"><dt>{LABELS.style}</dt><dd>{styleFiche}</dd></div>
    </dl>}
    {parcours ? (parcelleConnue ? <div style={cache('volume')}>
      <VolumeParcelleSection {...volume} conversationId={conversationId} fiche={null} onOpenStudio={onOpenStudio} />
    </div> : null) : parcelleConnue ? <>
      <h2>Parcelle et volume d’étude</h2>
      <p>Mimmo pose un volume simple sur la parcelle de la conversation pour voir l’ordre de grandeur. Précisez le programme dans la conversation pour l’ajuster.</p>
      <VolumeParcelleSection {...volume} conversationId={conversationId} fiche={null} onOpenStudio={onOpenStudio} />
    </> : <>
    <div className="mzia-fen3d__vide-visuel" aria-hidden="true"><Box size={46} strokeWidth={1.1} /></div>
    <h2>Aucun projet pour l’instant</h2>
    <p>Décrivez votre projet dans la conversation : Mimmo prépare le dossier 3D ici, puis vous le voyez en volume.</p>
    </>}
    {!parcours && <ol>
      <li><div>Décrivez le projet<span>Adresse, nombre de logements, étages, style…</span></div></li>
      <li><div>Vérifiez la fiche<span>Mimmo la remplit ; vous corrigez si besoin.</span></div></li>
      <li><div>Cliquez sur « Voir en 3D »<span>La maquette s’ouvre dans le Studio.</span></div></li>
    </ol>}
  </aside>;
  const newSuggestion = Boolean(saved && proposal && proposalMessage
    && Date.parse(proposalMessage.createdAt) > Date.parse(saved.updatedAt)
    && JSON.stringify(proposal) !== JSON.stringify(saved.draft));
  const previewDraft = editing && form ? form : newSuggestion && proposal ? proposal : draft;
  const diagnostic = diagnostiquerPreparation3D(draft);
  const draftMassing = jarvisMassing(previewDraft);
  const currentStudioVolume = !editing && studioVolume
    && (!newSuggestion || !proposalMessage || Date.parse(proposalMessage.createdAt) <= Date.parse(studioVolume.updatedAt))
    ? studioVolume : null;
  const segments = currentStudioVolume?.segments;
  const massing = draftMassing && segments ? {
    ...draftMassing,
    largeurM: Math.max(...segments.map(part => part.x + part.largeurM / 2)) - Math.min(...segments.map(part => part.x - part.largeurM / 2)),
    profondeurM: Math.max(...segments.map(part => part.z + part.profondeurM / 2)) - Math.min(...segments.map(part => part.z - part.profondeurM / 2)),
    niveaux: Math.max(...segments.map(part => part.niveaux)),
    segments, facadeRules: undefined,
    appearance: { ...draftMassing.appearance, articulation: null },
    ...(currentStudioVolume?.buildings && currentStudioVolume.buildings.length > 1 ? {
      buildings: currentStudioVolume.buildings.map(building => ({ ...building,
        appearance: { ...draftMassing.appearance, articulation: null },
      })),
    } : { buildings: undefined }),
  } : draftMassing;

  const beginEdit = (source: JarvisDraft) => {
    setForm({ ...source, questions: [...source.questions], pieces: [...source.pieces] });
    setQuestionsText(source.questions.join('\n'));
    setEditing(true);
    setNotice('');
  };

  const write = async (status: 'draft' | 'validated') => {
    if (!conversationId || !form || busy) return;
    if (status === 'validated') {
      try { exigerPreparation3D(form); } catch (e) { setNotice(messageErreur(e, 'Projet à préciser.')); return; }
    }
    setBusy(true);
    setNotice('');
    const questions = questionsText.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const updated: JarvisDraft = { ...form, questions };
    try {
      const row = await saveJarvisDraft(conversationId, updated, status, saved?.revision ?? 0);
      setSaved(row);
      setEditing(false);
      setNotice(status === 'validated' ? 'Fiche validée et enregistrée dans votre compte.' : 'Corrections enregistrées dans votre compte.');
    } catch {
      setSaved({ draft: updated, status, revision: saved?.revision ?? 0, updatedAt: new Date().toISOString() });
      setEditing(false);
      setNotice('Fiche conservée dans cette page pour le test. La sauvegarde en ligne est indisponible.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * R2 — UN CLIC : la fiche est validée (si elle ne l'est pas) et Studio s'ouvre
   * avec la parcelle, le relief, le programme et le bâtiment générés. Sans
   * parcelle confirmée, la question minimale s'affiche ici même.
   */
  const voirEn3D = async (terrain?: ConfirmedTerrain & { adresse?: string | null }) => {
    if (!conversationId || !onOpenStudio || opening || !draft.objectif?.trim()) return;
    try { exigerPreparation3D(draft); } catch (e) { setNotice(messageErreur(e, 'Projet à préciser.')); return; }
    setOpening(true);
    setNotice('');
    try {
      if (saved?.status !== 'validated') {
        try {
          const row = await saveJarvisDraft(conversationId, draft, 'validated', saved?.revision ?? 0);
          setSaved(row);
        } catch {
          setSaved({ draft, status: 'validated', revision: saved?.revision ?? 0, updatedAt: new Date().toISOString() });
          setNotice('Sauvegarde en ligne indisponible : cette fiche reste valable sur ce poste.');
        }
      }
      const issue = await onOpenStudio(draft, conversationId, terrain);
      setDemandeParcelle(issue === 'parcelle-requise');
    } catch (error) {
      setNotice(messageErreur(error, 'Ouverture impossible.'));
    } finally {
      setOpening(false);
    }
  };
  const nombreBatiments = massingNombreBatiments(draftMassing);

  /** Film / visite 360° : la fiche est validée au lancement si elle ne l'est pas encore. */
  const assurerValidation = async () => {
    exigerPreparation3D(draft);
    if (!conversationId || saved?.status === 'validated') return;
    try {
      setSaved(await saveJarvisDraft(conversationId, draft, 'validated', saved?.revision ?? 0));
    } catch {
      setSaved({ draft, status: 'validated', revision: saved?.revision ?? 0, updatedAt: new Date().toISOString() });
    }
  };

  return (
    <aside aria-label="Dossier de préparation 3D" className="jarvis-dossier">
      {parcoursUi}
      <div className="jarvis-dossier__heading" style={cache('conception')}>
        <div><h2>Votre projet</h2><p>Repris de la conversation</p></div>
        <span className={`jarvis-dossier__status ${saved?.status === 'validated' && diagnostic.pret ? 'is-validated' : ''}`}>
          {editing ? 'En édition' : saved?.status === 'validated' && diagnostic.pret ? 'Validé' : 'À vérifier'}
        </span>
      </div>
      <div className="jarvis-dossier__mobile-toggle" style={cache('conception')}><button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? 'Réduire le dossier' : 'Afficher le dossier'}</button></div>
      {/* Lot fiche-3d : avec un volume préparé par le moteur, le diagnostic et « Voir en 3D » tirés du texte du modèle
          sont remplacés par la carte « 3D préparée » et les champs Programme / Dimensions ci-dessous. */}
      {!editing && !ficheOk && <section aria-label="Préparation du projet 3D" style={{ marginBottom: 12, ...cache('conception', 'volume') }}>
        <p>Les informations ci-dessous viennent de la fiche du copilote ; elles ne valent pas confirmation par vous ni validation réglementaire.</p>
        <ul>{diagnostic.informations.map(i => <li key={i.cle}><strong>{i.libelle}</strong> — {i.statut === 'fourni-dans-fiche' ? 'Présent dans la fiche' : i.statut === 'hypothese' ? 'Hypothèse à vérifier' : 'À préciser'} : {i.detail}</li>)}</ul>
        {!diagnostic.pret && <><p role="status">Avant de générer : {diagnostic.questions.join(' ')}</p><button type="button" className="jarvis-dossier__link" onClick={() => beginEdit(draft)}>Compléter la fiche</button></>}
        <p>La parcelle est confirmée séparément. Sans relief mesuré au transfert, la position d’implantation précise ne sera pas transmise ; le rendu ne prouve pas la conformité au terrain.</p>
      </section>}
      {!editing && !ficheOk && conversationId && onOpenStudio && <button
        type="button" className="jarvis-dossier__launch" style={cache('volume')} disabled={opening || !draft.objectif?.trim() || !diagnostic.pret} onClick={() => void voirEn3D()}>
        <Box size={16} /> {opening ? 'Ouverture de Studio…' : nombreBatiments > 1 ? `Voir les ${String(nombreBatiments)} bâtiments en 3D` : 'Voir en 3D'} <ArrowUpRight size={17} />
      </button>}
      {!editing && <div style={cache('volume', ...(rendu ? [] : RENDUS))}><PreparationStudioSection messages={messages} conversationId={conversationId} onOpenStudio={onOpenStudio}
        suiviRendus={!rendu} /></div>}
      {demandeParcelle && !editing && conversationId && diagnostic.pret && <ConfirmerParcelle adresseInitiale={draft.localisation}
        onConfirmer={terrain => void voirEn3D(terrain)} onAnnuler={() => setDemandeParcelle(false)} />}
      {/* Fiche sans volume chiffré (dimensions ou R+N manquants) : volume d'étude calculé sur la parcelle, en hypothèse. */}
      {!editing && !draftMassing && parcelleConnue && <div style={cache('volume')}><VolumeParcelleSection {...volume} conversationId={conversationId} fiche={draft} onOpenStudio={onOpenStudio} /></div>}
      {!editing && <div style={cache(...RENDUS)}>{panneauRendu(draftPret ? assurerValidation : undefined)}</div>}
      <div className={`jarvis-dossier__body ${expanded ? 'is-expanded' : ''}`} style={editing ? undefined : cache('conception', 'volume', 'style')}>
      {currentStudioVolume && <p className="jarvis-dossier__proposal">Aperçu actualisé depuis Studio sur cet appareil. Les corrections se font dans l’onglet Studio.</p>}
      {newSuggestion && !editing && <p className="jarvis-dossier__proposal">Nouvelle proposition de Mimmo : l’aperçu montre les changements à examiner avant le transfert.</p>}
      {/* Volume du moteur affiché dans « Dimensions » : l'esquisse tirée du texte du modèle n'est plus montrée. */}
      {diagnostic.pret && massing && !ficheOk && <div style={cache('volume')}><JarvisMassingPreview light massing={massing} terrain={measuredTerrain} /></div>}
      {diagnostic.pret && massing && !ficheOk && vu('volume') && <PhotoTerrainImplantation massing={massing} onContinue={onOpenStudio && conversationId
        ? terrain => onOpenStudio(draft, conversationId, terrain).then(() => undefined) : undefined} onTerrainMeasured={setMeasuredTerrain} />}
      {massing?.buildings && !ficheOk && <p className="jarvis-dossier__proposal">Les {String(massing.buildings.length)} bâtiments seront créés dans Studio avec leurs dimensions et hauteurs propres. Leur position reste indicative jusqu’à la vérification du terrain.</p>}
      {editing && form ? (
        <div className="jarvis-dossier__form">
          {(Object.entries(LABELS) as [Field, string][]).map(([key, label]) => (
            <label key={key}>
              {label}
              <textarea rows={key === 'objectif' || key === 'programme' ? 2 : 1}
                value={form[key] ?? ''} onChange={event => setForm(current =>
                  current ? { ...current, [key]: event.target.value || null } : current)}
                placeholder="À préciser"
              />
            </label>
          ))}
          <label>
            Questions encore ouvertes, une par ligne
            <textarea rows={2} value={questionsText} onChange={event => setQuestionsText(event.target.value)}
            />
          </label>
          <div className="jarvis-dossier__actions">
            <button type="button" disabled={busy || !conversationId} onClick={() => void write('draft')}>Enregistrer</button>
            <button className="is-primary" type="button" disabled={busy || !conversationId || !diagnostiquerPreparation3D(form).pret} onClick={() => void write('validated')}>Valider la fiche</button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)}>Annuler</button>
          </div>
        </div>
      ) : (
        <>
          <dl className="jarvis-dossier__fields">
            {(Object.entries(LABELS) as [Field, string][]).map(([key, label], index) => <div key={key} ref={key === 'dimensions' ? refDimensions : undefined}
              style={cache(key === 'dimensions' ? 'volume' : key === 'style' ? 'style' : 'conception')}
              className={`jarvis-dossier__field${(key === 'style' || ((key === 'programme' || key === 'dimensions') && ficheOk)) ? ' jarvis-dossier__field--large' : ''}`}>
              <dt><span>{String(index + 1).padStart(2, '0')}</span> {label}</dt>
              {key === 'programme' && ficheOk ? <dd><ProgrammeFiche fiche={ficheOk} texteModele={draft.programme} /></dd>
                : key === 'dimensions' && ficheOk ? <dd><DimensionsFiche fiche={ficheOk} conversationId={conversationId} onOpenStudio={onOpenStudio} texteModele={draft.dimensions} onSend={onSend} /></dd>
                : key === 'style' ? <dd>{styleFiche}</dd>
                : <dd className={draft[key] ? '' : 'is-missing'}>{draft[key] ?? 'À préciser'}{key === 'dimensions' && fiche3d.etat === 'chargement' ? ' · lecture du volume calculé…' : ''}</dd>}
            </div>)}
          </dl>
          {draft.questions.length > 0 && <p style={{ margin: '6px 0', ...cache('conception') }}>
            <strong>À préciser :</strong> {draft.questions.join(' · ')}
          </p>}
          <div className="jarvis-dossier__actions" style={cache('conception')}>
            <button type="button" disabled={loading || !conversationId} onClick={() => beginEdit(draft)}>Relire ou corriger</button>
          </div>
          {newSuggestion && proposal && <p style={{ margin: '8px 0 0' }}>
            Mimmo a proposé de nouvelles informations. <button type="button" onClick={() => beginEdit(proposal)}>Examiner sa proposition</button>
          </p>}
        </>
      )}
      {files.length > 0 && <p style={{ margin: '8px 0 4px', ...cache('conception') }}>
        <strong>Fichiers enregistrés :</strong> {files.join(' · ')}
      </p>}
      {draft.pieces.length > 0 && <p style={{ margin: '4px 0', ...cache('conception') }}>
        <strong>Pièces mentionnées dans l’échange :</strong> {draft.pieces.join(' · ')}
      </p>}
      {fileError && <p role="status">{fileError}</p>}
      {notice && <p role="status">{notice}</p>}
      {files.length > 0 && <div className="jarvis-dossier__file-count" style={cache('conception')}><FileStack size={14} /> {files.length} pièce{files.length > 1 ? 's' : ''} conservée{files.length > 1 ? 's' : ''}</div>}
      <small style={cache('volume')}>« Voir en 3D » ouvre Studio dans cette page, avec la parcelle, le relief et le bâtiment déjà générés.{onPrepareDetailed && conversationId ? <> Photos de façade, plans ou 360° à classer : <button type="button" className="jarvis-dossier__link" onClick={() => void onPrepareDetailed(draft, conversationId)}>préparer en détail</button>.</> : null}</small>
      </div>
    </aside>
  );
}

/** R2 — nombre de bâtiments de la fiche (1 si un seul volume). */
function massingNombreBatiments(massing: ReturnType<typeof jarvisMassing>): number {
  return massing?.buildings?.length ?? 1;
}
