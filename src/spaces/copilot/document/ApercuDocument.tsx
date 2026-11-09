// src/spaces/copilot/document/ApercuDocument.tsx
// LOT D1 — Dans le fil du chat, une réponse longue se résume à sa conclusion
// (1 à 3 phrases) et à un bouton « Ouvrir le document » ; le document complet
// s'affiche dans le panneau (PanneauDocument).
import { useMemo } from 'react';
import { FileText } from 'lucide-react';
import type { ChatMessage } from '../types/copilot.types';
import { markdownToSafeHtml } from '../utils/exportCopilotPdf';
import { construireDocumentReponse, resumeChat } from './documentModele';
import { useDocumentUi } from './documentUi.store';
import './document.css';

export function ApercuDocument({ message, texte, question }: { message: ChatMessage; texte: string; question: string | null }) {
  const doc = useMemo(() => construireDocumentReponse({ texte, question, createdAt: message.createdAt }), [texte, question, message.createdAt]);
  const resume = useMemo(() => resumeChat(doc), [doc]);
  // Rendu sûr du projet (HTML échappé) ; le résumé est une seule ligne de texte avec son gras.
  const resumeHtml = useMemo(() => markdownToSafeHtml(resume).replace(/^<p[^>]*>|<\/p>$/g, ''), [resume]);
  const meta = [
    doc.sections.length ? `${doc.sections.length} section${doc.sections.length > 1 ? 's' : ''}` : null,
    doc.reserves ? 'réserves' : null,
    doc.sources ? 'sources' : null,
  ].filter(Boolean).join(' · ');

  return (
    <section className="mzdoc-apercu" aria-label={`Document : ${doc.titre}`}>
      <div className="mzdoc-apercu__type"><FileText size={13} aria-hidden /> {doc.type}</div>
      <p className="mzdoc-apercu__titre">{doc.titre}</p>
      {resume && <p className="mzdoc-apercu__resume" dangerouslySetInnerHTML={{ __html: resumeHtml }} />}
      <div className="mzdoc-apercu__pied">
        <button type="button" className="mzdoc-btn-ouvrir"
          onClick={() => useDocumentUi.getState().ouvrir({ genre: 'reponse', messageId: message.id, question })}>
          Ouvrir le document ▸
        </button>
        {meta && <span className="mzdoc-apercu__meta">{meta}</span>}
      </div>
    </section>
  );
}
