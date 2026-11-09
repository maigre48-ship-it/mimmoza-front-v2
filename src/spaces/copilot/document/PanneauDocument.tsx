// src/spaces/copilot/document/PanneauDocument.tsx
// =============================================================================
// LOT D1 — Panneau « document » : une réponse longue, un ordre de mission ou un
// rapport de mission présentés comme un vrai document professionnel (page
// blanche, en-tête Mimmoza, conclusion encadrée, sections numérotées, tableaux,
// réserves et sources en pied, exports).
// Monté UNE fois par la page MimmozIA (comme PanneauAgent) ; rendu dans
// document.body ; s'ouvre via useDocumentUi().ouvrir(…). Tant qu'aucun panneau
// n'est monté, le chat garde son affichage complet d'avant (hotes = 0).
// Le texte passe TOUJOURS par le rendu Markdown sûr du projet (HTML échappé).
// =============================================================================
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, Printer, Rocket, X } from 'lucide-react';
import { JETON_VALEUR_EUR } from '@/lib/billing/grille';
import { useCopilotStore } from '../store/copilotStore';
import { markdownToSafeHtml, exportCopilotResponseToPdf } from '../utils/exportCopilotPdf';
import { htmlLisible, scinderObjectif } from '../utils/lisibilite';
import { decouperSegments } from '../charts/copilotChart.types';
import { CopilotRenderBoundary } from '../components/CopilotRenderBoundary';
import { annulerMission, lireMissionParId, validerDevis } from '../agent/agentApi';
import {
  devisExpire, dureeLisible, formatJetons, libelleStatut, libelleType, MESSAGE_DEVIS_EXPIRE, missionFinie, resumerDevis, tonStatut,
} from '../agent/agentLogique';
import type { Mission, PropositionDevis } from '../agent/agent.types';
import { useAgentUi } from '../agent/agentUi.store';
import { RapportMission } from '../agent/RapportMission';
import { construireDocumentReponse, dateLongue, pointsListe, titreObjectif } from './documentModele';
import { useDocumentUi, type ContenuDocument } from './documentUi.store';
import '../agent/agent.css';
import './document.css';
import mimmozaLogo from '@/assets/mimmoza-logo.webp';

const CopilotChart = lazy(() => import('../charts/CopilotChart').then((m) => ({ default: m.CopilotChart })));

function Markdown({ texte, className }: { texte: string; className?: string }) {
  const html = useMemo(() => htmlLisible(texte, markdownToSafeHtml), [texte]);
  if (!html) return null;
  return <div className={`mzdoc-md${className ? ` ${className}` : ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Markdown + graphiques ```mimmoza-chart (rendus comme dans le chat). */
function MarkdownAvecGraphiques({ texte }: { texte: string }) {
  const segments = useMemo(() => decouperSegments(texte), [texte]);
  return (
    <>
      {segments.map((s, i) => s.kind === 'chart'
        ? <CopilotRenderBoundary key={i} label="Graphique"><Suspense fallback={<div style={{ height: 240 }} />}><div className="mzdoc-graphique"><CopilotChart spec={s.spec} /></div></Suspense></CopilotRenderBoundary>
        : <Markdown key={i} texte={s.text} />)}
    </>
  );
}

/** En-tête commun : bandeau Mimmoza, type, titre, ligne d'informations. */
function EnTete({ type, titre, infos }: { type: string; titre: string; infos: (string | null | undefined)[] }) {
  const ligne = infos.filter(Boolean).join(' · ');
  return (
    <header className="mzdoc-entete">
      <div className="mzdoc-marque">
        <img className="mzdoc-marque__logo" src={mimmozaLogo} alt="Mimmoza" />
        <span className="mzdoc-marque__sous">Document établi par MimmozIA</span>
      </div>
      <div className="mzdoc-type">{type}</div>
      <h1 className="mzdoc-titre">{titre}</h1>
      {ligne && <p className="mzdoc-infos">{ligne}</p>}
    </header>
  );
}

function Section({ n, titre, children }: { n: number; titre: string; children: ReactNode }) {
  return (
    <section className="mzdoc-section">
      <h2 className="mzdoc-section__titre"><span className="mzdoc-section__num">{n}.</span> {titre}</h2>
      {children}
    </section>
  );
}

// ── Réponse longue du chat ─────────────────────────────────────────────────────

export function DocumentReponseVue({ messageId, question, poserActions }: { messageId: string; question: string | null; poserActions: (a: ReactNode) => void }) {
  const message = useCopilotStore((s) => s.messages.find((m) => m.id === messageId));
  const doc = useMemo(() => message ? construireDocumentReponse({ texte: message.text, question, createdAt: message.createdAt }) : null, [message, question]);
  const [export_, setExport] = useState<'pdf' | 'docx' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const exporter = useCallback(async (format: 'pdf' | 'docx') => {
    if (!message || export_) return;
    setExport(format); setErreur(null);
    try {
      if (format === 'pdf') {
        const r = await exportCopilotResponseToPdf({ response: message, question });
        if (r === 'popup_blocked') setErreur('Autorisez les fenêtres contextuelles pour exporter le PDF.');
      } else {
        const { exportCopilotOffice } = await import('../exports/exportCopilotOffice');
        await exportCopilotOffice('docx', { response: message, question });
      }
    } catch { setErreur('Le fichier n’a pas pu être préparé. Réessayez dans un instant.'); }
    finally { setExport(null); }
  }, [message, question, export_]);

  useEffect(() => {
    poserActions(message ? (
      <>
        <button type="button" className="mzag-btn mzag-btn--petit" disabled={export_ !== null} onClick={() => void exporter('pdf')}><Download size={13} aria-hidden /> {export_ === 'pdf' ? 'Préparation…' : 'PDF'}</button>
        <button type="button" className="mzag-btn mzag-btn--petit" disabled={export_ !== null} onClick={() => void exporter('docx')}><Download size={13} aria-hidden /> {export_ === 'docx' ? 'Préparation…' : 'Word'}</button>
      </>
    ) : null);
  }, [message, export_, exporter, poserActions]);

  if (!message || !doc) return <p className="mzag-muet">Cette réponse n’est plus disponible dans la conversation ouverte.</p>;
  return (
    <article className="mzdoc-page">
      <EnTete type={doc.type} titre={doc.titre} infos={[doc.date]} />
      {erreur && <p className="mzag-alerte" role="alert">{erreur}</p>}
      {doc.conclusion && (
        <div className="mzdoc-conclusion" role="note">
          <div className="mzdoc-conclusion__label">Conclusion</div>
          <MarkdownAvecGraphiques texte={doc.conclusion} />
        </div>
      )}
      {doc.sections.map((s, i) => <Section key={i} n={i + 1} titre={s.titre}><MarkdownAvecGraphiques texte={s.markdown} /></Section>)}
      {(doc.reserves || doc.sources) && (
        <footer className="mzdoc-pied">
          {doc.reserves && <div className="mzdoc-pied__bloc"><h3>Réserves</h3><Markdown texte={doc.reserves} /></div>}
          {doc.sources && <div className="mzdoc-pied__bloc"><h3>Sources</h3><Markdown texte={doc.sources} /></div>}
        </footer>
      )}
      <p className="mzdoc-mention">Analyse produite par MimmozIA à partir des sources citées. Les estimations sont à confirmer par un professionnel.</p>
    </article>
  );
}

// ── Ordre de mission ───────────────────────────────────────────────────────────

function dateHeure(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
}

export function OrdreMissionVue({ missionId, proposition }: { missionId: string | null; proposition: PropositionDevis }) {
  const [mission, setMission] = useState<Mission | null>(null);
  const [occupe, setOccupe] = useState<'lancer' | 'annuler' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const solde = useCopilotStore((s) => s.credits);
  const version = useAgentUi((s) => s.version);

  const relire = useCallback(async () => {
    if (!missionId) return;
    try { const m = await lireMissionParId(missionId); if (m) setMission(m); } catch { /* le document reste lisible avec la proposition */ }
  }, [missionId]);
  useEffect(() => {
    if (!missionId) return;
    let actif = true;
    lireMissionParId(missionId).then((m) => { if (actif && m) setMission(m); }).catch(() => { /* le document reste lisible avec la proposition */ });
    return () => { actif = false; };
  }, [missionId, version]);

  const devis = mission?.devis ?? proposition.devis;
  const statut = mission?.statut ?? 'devis';
  const type = mission?.type ?? proposition.type ?? 'libre';
  const objectif = scinderObjectif(mission?.objectif || proposition.objectif || '');
  const titre = titreObjectif(objectif.titre) || libelleType(type);
  const points = pointsListe(objectif.detail);
  const resume = devis ? resumerDevis(devis, solde, JETON_VALEUR_EUR) : null;
  const expire = statut === 'devis' && (devisExpire(devis) || erreur === MESSAGE_DEVIS_EXPIRE);
  const duree = dureeLisible(devis?.duree_estimee_min);

  const agir = async (genre: 'lancer' | 'annuler') => {
    if (!missionId) return;
    setOccupe(genre); setErreur(null);
    try {
      const m = genre === 'lancer' ? await validerDevis(missionId) : await annulerMission(missionId);
      if (m) setMission(m); else await relire();
      useAgentUi.getState().signalerChangement();
      if (genre === 'lancer') window.setTimeout(() => { void useCopilotStore.getState().refreshCredits?.(); }, 8000);
    } catch (e) { setErreur(e instanceof Error ? e.message : 'L’opération a échoué.'); }
    finally { setOccupe(null); }
  };

  let n = 0;
  return (
    <article className="mzdoc-page">
      <EnTete type="Ordre de mission" titre={titre}
        infos={[libelleType(type), devis?.emis_le ? `émis le ${dateLongue(devis.emis_le)}` : dateLongue(mission?.cree_le), statut !== 'devis' ? libelleStatut(statut) : null]} />
      {statut !== 'devis' && <p><span className={`mzag-pastille mzag-pastille--${tonStatut(statut)}`}>{libelleStatut(statut)}</span></p>}

      <Section n={++n} titre="Objet de la mission"><p className="mzdoc-texte">{titre}</p></Section>

      {points.length > 0 && (
        <Section n={++n} titre="Périmètre — points traités">
          <ol className="mzdoc-points">{points.map((p, i) => <li key={i}>{p}</li>)}</ol>
        </Section>
      )}
      {!points.length && objectif.detail && <Section n={++n} titre="Périmètre"><Markdown texte={objectif.detail} /></Section>}

      {devis?.explication && <Section n={++n} titre="Méthode"><Markdown texte={devis.explication} /></Section>}

      <Section n={++n} titre="Conditions">
        {devis && resume ? (
          <table className="mzdoc-tableau">
            <tbody>
              <tr><th>Coût estimé</th><td>{resume.fourchette}<div className="mzdoc-sous">soit {resume.fourchetteEuros}</div></td></tr>
              <tr><th>Réservé au lancement</th><td>{resume.reserve}<div className="mzdoc-sous">seul ce qui est utilisé est décompté, le reste vous est rendu</div></td></tr>
              <tr><th>Votre solde</th><td>{solde == null ? '…' : formatJetons(solde)}{resume.soldeSuffisant === false && <div className="mzdoc-sous mzdoc-sous--alerte">il manque {formatJetons(resume.manque)}</div>}</td></tr>
              {devis.etapes_max ? <tr><th>Ampleur</th><td>{devis.etapes_max} étapes au maximum</td></tr> : null}
              {duree && <tr><th>Durée estimée</th><td>{duree}</td></tr>}
              {devis.expire_le && <tr><th>Validité du devis</th><td>jusqu’au {dateHeure(devis.expire_le)}</td></tr>}
            </tbody>
          </table>
        ) : <p className="mzag-muet">Le détail du coût n’est pas disponible pour cette mission.</p>}
      </Section>

      <Section n={++n} titre="Engagements">
        <ul className="mzdoc-liste">
          <li>Si le plafond est atteint, la mission s’arrête proprement et vous remet un rapport partiel.</li>
          <li>Si une information manque, MimmozIA vous pose la question avant de continuer.</li>
          <li>Aucun courrier ni e-mail n’est envoyé sans votre validation.</li>
        </ul>
      </Section>

      {expire && <p className="mzag-info" role="status">{MESSAGE_DEVIS_EXPIRE} Utilisez « Modifier » dans le chat.</p>}
      {erreur && !expire && <p className="mzag-alerte" role="alert">{erreur}</p>}

      <div className="mzdoc-signature mzag-actions">
        {statut === 'devis' && missionId && (
          <>
            <button type="button" className="mzag-btn mzag-btn--plein" disabled={occupe !== null || !devis || expire || resume?.soldeSuffisant === false} onClick={() => void agir('lancer')}>
              <Rocket size={14} aria-hidden /> {occupe === 'lancer' ? 'Lancement…' : 'Lancer la mission'}
            </button>
            <button type="button" className="mzag-btn mzag-btn--discret" disabled={occupe !== null} onClick={() => void agir('annuler')}>{occupe === 'annuler' ? 'Annulation…' : 'Annuler'}</button>
          </>
        )}
        {mission && statut !== 'devis' && statut !== 'annulee' && (
          missionFinie(statut) && (mission.rapport || mission.rapport_brut != null)
            ? <button type="button" className="mzag-btn mzag-btn--plein" onClick={() => useDocumentUi.getState().ouvrir({ genre: 'rapport', missionId: mission.id })}><FileText size={14} aria-hidden /> Ouvrir le rapport de mission</button>
            : <button type="button" className="mzag-btn" onClick={() => useAgentUi.getState().ouvrir('missions', mission.id)}>Suivre la mission</button>
        )}
      </div>
    </article>
  );
}

// ── Rapport de mission ─────────────────────────────────────────────────────────

function RapportMissionVue({ missionId }: { missionId: string }) {
  const [mission, setMission] = useState<Mission | null | undefined>(undefined);
  const version = useAgentUi((s) => s.version);
  useEffect(() => {
    let actif = true;
    lireMissionParId(missionId).then((m) => { if (actif) setMission(m); }).catch(() => { if (actif) setMission(null); });
    return () => { actif = false; };
  }, [missionId, version]);

  if (mission === undefined) return <p className="mzag-muet">Chargement du rapport…</p>;
  if (!mission || !(mission.rapport || mission.rapport_brut != null)) return <p className="mzag-muet">Le rapport de cette mission n’est pas encore disponible.</p>;
  const partiel = mission.statut !== 'terminee';
  const titre = titreObjectif(scinderObjectif(mission.objectif).titre) || libelleType(mission.type);
  return (
    <article className="mzdoc-page">
      <EnTete type={partiel ? 'Rapport de mission (partiel)' : 'Rapport de mission'} titre={titre}
        infos={[libelleType(mission.type), dateLongue(mission.termine_le ?? mission.maj_le)]} />
      <div className="mzag mzdoc-rapport"><RapportMission mission={mission} partiel={partiel} /></div>
    </article>
  );
}

// ── Panneau ─────────────────────────────────────────────────────────────────────

const TITRES: Record<ContenuDocument['genre'], string> = {
  reponse: 'Document', ordre: 'Ordre de mission', rapport: 'Rapport de mission',
};

export function PanneauDocument() {
  const contenu = useDocumentUi((s) => s.contenu);
  const fermerRef = useRef<HTMLButtonElement | null>(null);
  const [actions, setActions] = useState<ReactNode>(null);

  useEffect(() => useDocumentUi.getState().monterHote(), []);
  useEffect(() => {
    if (!contenu) return;
    const precedent = document.activeElement as HTMLElement | null;
    fermerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useDocumentUi.getState().fermer(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); precedent?.focus?.(); };
  }, [contenu]);

  if (!contenu || typeof document === 'undefined') return null;

  return createPortal(
    <div className="mzag mzdoc-racine">
      <div className="mzdoc-voile" onClick={() => useDocumentUi.getState().fermer()} aria-hidden />
      <aside className="mzdoc-panneau" role="dialog" aria-modal="true" aria-label={TITRES[contenu.genre]}>
        <div className="mzdoc-barre">
          <span className="mzdoc-barre__titre"><FileText size={16} aria-hidden /> {TITRES[contenu.genre]}</span>
          <div className="mzag-actions">
            {contenu.genre === 'reponse' && actions}
            <button type="button" className="mzag-btn mzag-btn--petit" onClick={() => window.print()} title="Imprimer ou enregistrer en PDF"><Printer size={13} aria-hidden /> Imprimer</button>
            <button ref={fermerRef} type="button" className="mzag-iconbtn" onClick={() => useDocumentUi.getState().fermer()} aria-label="Fermer le document"><X size={18} /></button>
          </div>
        </div>
        <div className="mzdoc-fond">
          <CopilotRenderBoundary label="Document">
            {contenu.genre === 'reponse' && <DocumentReponseVue key={contenu.messageId} messageId={contenu.messageId} question={contenu.question} poserActions={setActions} />}
            {contenu.genre === 'ordre' && <OrdreMissionVue key={contenu.missionId ?? 'sans-id'} missionId={contenu.missionId} proposition={contenu.proposition} />}
            {contenu.genre === 'rapport' && <RapportMissionVue key={contenu.missionId} missionId={contenu.missionId} />}
          </CopilotRenderBoundary>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
