import { useEffect, useMemo, useState } from 'react';
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
import './JarvisDraftPanel.css';
import { messageErreur } from "@/components/ui/messageErreur";

const LABELS = {
  objectif: 'Objectif',
  localisation: 'Lieu',
  programme: 'Programme',
  dimensions: 'Dimensions',
  style: 'Style',
  contraintes: 'Contraintes',
} as const;
type Field = keyof typeof LABELS;

/** R2 — résultat de l'ouverture : `parcelle-requise` = poser la question minimale dans le dossier. */
export type IssueOuvertureStudio = void | 'parcelle-requise';

export function JarvisDraftPanel({ messages, conversationId, onOpenStudio, onPrepareDetailed }: {
  messages: readonly ChatMessage[];
  conversationId: string | null;
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
  if (!draft) return <aside className="mzia-fen3d__vide" aria-label="Dossier de préparation 3D">
    <div className="mzia-fen3d__vide-visuel" aria-hidden="true"><Box size={46} strokeWidth={1.1} /></div>
    <h2>Aucun projet pour l’instant</h2>
    <p>Décrivez votre projet dans la conversation : Mimmo prépare le dossier 3D ici, puis vous le voyez en volume.</p>
    <ol>
      <li><div>Décrivez le projet<span>Adresse, nombre de logements, étages, style…</span></div></li>
      <li><div>Vérifiez la fiche<span>Mimmo la remplit ; vous corrigez si besoin.</span></div></li>
      <li><div>Cliquez sur « Voir en 3D »<span>La maquette s’ouvre dans le Studio.</span></div></li>
    </ol>
  </aside>;
  const newSuggestion = Boolean(saved && proposal && proposalMessage
    && Date.parse(proposalMessage.createdAt) > Date.parse(saved.updatedAt)
    && JSON.stringify(proposal) !== JSON.stringify(saved.draft));
  const previewDraft = editing && form ? form : newSuggestion && proposal ? proposal : draft;
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

  return (
    <aside aria-label="Dossier de préparation 3D" className="jarvis-dossier">
      <div className="jarvis-dossier__heading">
        <div><h2>Votre projet</h2><p>Repris de la conversation</p></div>
        <span className={`jarvis-dossier__status ${saved?.status === 'validated' ? 'is-validated' : ''}`}>
          {editing ? 'En édition' : saved?.status === 'validated' ? 'Validé' : 'À vérifier'}
        </span>
      </div>
      <div className="jarvis-dossier__mobile-toggle"><button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? 'Réduire le dossier' : 'Afficher le dossier'}</button></div>
      {!editing && conversationId && onOpenStudio && <button
        type="button" className="jarvis-dossier__launch" disabled={opening || !draft.objectif?.trim()} onClick={() => void voirEn3D()}>
        <Box size={16} /> {opening ? 'Ouverture de Studio…' : nombreBatiments > 1 ? `Voir les ${String(nombreBatiments)} bâtiments en 3D` : 'Voir en 3D'} <ArrowUpRight size={17} />
      </button>}
      {demandeParcelle && !editing && conversationId && <ConfirmerParcelle adresseInitiale={draft.localisation}
        onConfirmer={terrain => void voirEn3D(terrain)} onAnnuler={() => setDemandeParcelle(false)} />}
      <div className={`jarvis-dossier__body ${expanded ? 'is-expanded' : ''}`}>
      {currentStudioVolume && <p className="jarvis-dossier__proposal">Aperçu actualisé depuis Studio sur cet appareil. Les corrections se font dans l’onglet Studio.</p>}
      {newSuggestion && !editing && <p className="jarvis-dossier__proposal">Nouvelle proposition de Mimmo : l’aperçu montre les changements à examiner avant le transfert.</p>}
      {massing && <JarvisMassingPreview light massing={massing} terrain={measuredTerrain} />}
      {massing && <PhotoTerrainImplantation massing={massing} onContinue={onOpenStudio && conversationId
        ? terrain => onOpenStudio(draft, conversationId, terrain).then(() => undefined) : undefined} onTerrainMeasured={setMeasuredTerrain} />}
      {massing?.buildings && <p className="jarvis-dossier__proposal">Les {String(massing.buildings.length)} bâtiments seront créés dans Studio avec leurs dimensions et hauteurs propres. Leur position reste indicative jusqu’à la vérification du terrain.</p>}
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
            <button className="is-primary" type="button" disabled={busy || !conversationId || !form.objectif?.trim()} onClick={() => void write('validated')}>Valider la fiche</button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)}>Annuler</button>
          </div>
        </div>
      ) : (
        <>
          <dl className="jarvis-dossier__fields">
            {(Object.entries(LABELS) as [Field, string][]).map(([key, label], index) => <div key={key} className="jarvis-dossier__field">
              <dt><span>{String(index + 1).padStart(2, '0')}</span> {label}</dt>
              <dd className={draft[key] ? '' : 'is-missing'}>{draft[key] ?? 'À préciser'}</dd>
            </div>)}
          </dl>
          {draft.questions.length > 0 && <p style={{ margin: '6px 0' }}>
            <strong>À préciser :</strong> {draft.questions.join(' · ')}
          </p>}
          <div className="jarvis-dossier__actions">
            <button type="button" disabled={loading || !conversationId} onClick={() => beginEdit(draft)}>Relire ou corriger</button>
          </div>
          {newSuggestion && proposal && <p style={{ margin: '8px 0 0' }}>
            Mimmo a proposé de nouvelles informations. <button type="button" onClick={() => beginEdit(proposal)}>Examiner sa proposition</button>
          </p>}
        </>
      )}
      {files.length > 0 && <p style={{ margin: '8px 0 4px' }}>
        <strong>Fichiers enregistrés :</strong> {files.join(' · ')}
      </p>}
      {draft.pieces.length > 0 && <p style={{ margin: '4px 0' }}>
        <strong>Pièces mentionnées dans l’échange :</strong> {draft.pieces.join(' · ')}
      </p>}
      {fileError && <p role="status">{fileError}</p>}
      {notice && <p role="status">{notice}</p>}
      {files.length > 0 && <div className="jarvis-dossier__file-count"><FileStack size={14} /> {files.length} pièce{files.length > 1 ? 's' : ''} conservée{files.length > 1 ? 's' : ''}</div>}
      <small>« Voir en 3D » ouvre Studio dans cette page, avec la parcelle, le relief et le bâtiment déjà générés.{onPrepareDetailed && conversationId ? <> Photos de façade, plans ou 360° à classer : <button type="button" className="jarvis-dossier__link" onClick={() => void onPrepareDetailed(draft, conversationId)}>préparer en détail</button>.</> : null}</small>
      </div>
    </aside>
  );
}

/** R2 — nombre de bâtiments de la fiche (1 si un seul volume). */
function massingNombreBatiments(massing: ReturnType<typeof jarvisMassing>): number {
  return massing?.buildings?.length ?? 1;
}
