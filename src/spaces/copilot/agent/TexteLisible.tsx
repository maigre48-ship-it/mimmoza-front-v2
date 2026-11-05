// src/spaces/copilot/agent/TexteLisible.tsx
// LOT F1 — Lisibilité : affichage des textes de mission (objectif, question,
// journal, synthèse). Le texte passe par `mettreEnForme` (une ligne par élément,
// aussi pour les missions déjà stockées) puis par le rendu Markdown sûr du
// projet (`markdownToSafeHtml` : HTML échappé, balises maîtrisées seulement).
import { useMemo } from 'react';
import { markdownToSafeHtml } from '../utils/exportCopilotPdf';
import { htmlLisible, scinderObjectif } from '../utils/lisibilite';

export function TexteLisible({ texte, className, reponseDabord = false, exigerSuite = true }: {
  texte: string | null | undefined;
  className?: string;
  /** Met en évidence la première phrase-réponse quand le texte suit la structure « réponse d'abord ». */
  reponseDabord?: boolean;
  exigerSuite?: boolean;
}) {
  const html = useMemo(() => htmlLisible(texte, markdownToSafeHtml, { reponseDabord, exigerSuite }), [texte, reponseDabord, exigerSuite]);
  if (!html) return null;
  return <div className={`mzag-lisible${className ? ` ${className}` : ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Au-delà de ce nombre de points, le détail de l'objectif est replié. */
const POINTS_VISIBLES_MAX = 6;

/**
 * Objectif de mission : la phrase d'introduction en titre, puis les points en
 * liste (un par ligne). Une longue liste est repliée (« Voir les N points »).
 */
export function ObjectifMission({ texte, titreClassName, titreParDefaut, as: Titre = 'p' }: {
  texte: string | null | undefined;
  titreClassName?: string;
  titreParDefaut?: string;
  as?: 'p' | 'h3';
}) {
  const o = useMemo(() => scinderObjectif(texte), [texte]);
  const titre = o.titre || titreParDefaut || '';
  return (
    <>
      {titre && <Titre className={`mzag-objectif__titre${titreClassName ? ` ${titreClassName}` : ''}`}>{titre}</Titre>}
      {o.detail && (o.nbPoints > POINTS_VISIBLES_MAX ? (
        <details className="mzag-objectif__detail">
          <summary>Voir les {o.nbPoints} points de la mission</summary>
          <TexteLisible texte={o.detail} />
        </details>
      ) : <TexteLisible texte={o.detail} className="mzag-objectif__liste" />)}
    </>
  );
}
