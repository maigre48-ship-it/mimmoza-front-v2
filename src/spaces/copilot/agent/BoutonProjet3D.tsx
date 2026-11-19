// src/spaces/copilot/agent/BoutonProjet3D.tsx
// LOT VIS-15 — fin d'une mission de conception : Mimmo propose la suite et l'action PRINCIPALE
// « Ouvrir mon projet en 3D » (chat ET panneau Missions). Le clic demande à la page MimmozIA
// (événement EVENEMENT_OUVRIR_PROJET_3D) de préparer la 3D de la conception et d'ouvrir le Studio
// par le parcours existant « Voir en 3D ». Le rapport reste accessible, en second.
import { useState } from 'react';
import { Box, FileText } from 'lucide-react';
import type { Mission } from './agent.types';
import {
  EVENEMENT_OUVRIR_PROJET_3D, MESSAGE_PACK_PLAQUETTE, missionConceptionOuvrable3D, phraseSuiteConception, type IssuePreparation3D,
} from './projet3DMission';

export interface DemandeOuvertureProjet3D {
  mission: Mission;
  /** Posé à true par la page qui prend la demande (sinon : page MimmozIA absente). */
  prise: boolean;
  repondre: (issue: Promise<IssuePreparation3D & { ouvert?: boolean }>) => void;
}

/** Demande l'ouverture à la page MimmozIA ; rejette si aucune page ne l'a prise. */
export function demanderOuvertureProjet3D(mission: Mission): Promise<IssuePreparation3D & { ouvert?: boolean }> {
  return new Promise((resolve, reject) => {
    const detail: DemandeOuvertureProjet3D = { mission, prise: false, repondre: (p) => { p.then(resolve, reject); } };
    window.dispatchEvent(new CustomEvent(EVENEMENT_OUVRIR_PROJET_3D, { detail }));
    if (!detail.prise) reject(new Error('Ouvrez la conversation de cette mission sur la page MimmozIA pour voir le projet en 3D.'));
  });
}

/** Conception d'avant VIS-15 qui ne couvre pas l'assiette demandée → message de relance proposé à l'utilisateur. */
export function messageRelanceAssiette(erreur: string | null): string | null {
  if (!erreur || !/assiette group/i.test(erreur)) return null;
  const liste = /assiette group[ée]+e?\s+([0-9A-Z]+(?:\s*\+\s*[0-9A-Z]+)+)/i.exec(erreur)?.[1]?.replace(/\s+/g, ' ').trim();
  return `Relance la mission de conception sur l'assiette groupée complète${liste ? ` (${liste})` : ''}, puis ouvre le projet en 3D.`;
}

export function BoutonProjet3D({ mission, onSend, onRapport, compact = false }: {
  mission: Mission;
  onSend?: (texte: string) => void;
  /** Ouvre le rapport (action secondaire). */
  onRapport?: () => void;
  compact?: boolean;
}) {
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  if (!missionConceptionOuvrable3D(mission)) return null;
  const ouvrir = async () => {
    if (occupe) return;
    setOccupe(true); setErreur(null); setInfo(null);
    try {
      const issue = await demanderOuvertureProjet3D(mission);
      if (!issue.ok) { setErreur(issue.message); return; }
      setInfo([issue.assiette ? `Assiette : ${issue.assiette}.` : null, issue.gabaritRetenu ? `${issue.gabaritRetenu}.` : null].filter(Boolean).join(' ') || null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Ouverture de la 3D impossible.');
    } finally { setOccupe(false); }
  };
  return (
    <div className="mzag-pile" style={{ margin: '8px 0' }}>
      {!compact && <p className="mzag-objectif__titre" style={{ margin: 0 }}>{phraseSuiteConception(mission)}</p>}
      <div className="mzag-actions">
        <button type="button" className="mzag-btn mzag-btn--plein" disabled={occupe} onClick={() => void ouvrir()}>
          <Box size={14} aria-hidden /> {occupe ? 'Préparation de la 3D…' : 'Ouvrir mon projet en 3D'}
        </button>
        {onSend && <button type="button" className="mzag-btn" disabled={occupe} onClick={() => onSend(MESSAGE_PACK_PLAQUETTE)}>Préparer la plaquette</button>}
        {onRapport && <button type="button" className="mzag-btn mzag-btn--discret" onClick={onRapport}><FileText size={14} aria-hidden /> Voir le rapport</button>}
      </div>
      {info && <p className="mzag-info" role="status" style={{ margin: 0 }}>{info}</p>}
      {erreur && <p className="mzag-alerte" role="alert" style={{ margin: 0 }}>{erreur}</p>}
      {erreur && onSend && messageRelanceAssiette(erreur) && (
        <div className="mzag-actions">
          <button type="button" className="mzag-btn mzag-btn--plein" onClick={() => onSend(messageRelanceAssiette(erreur) as string)}>
            Relancer la conception sur toute l'assiette
          </button>
        </div>
      )}
    </div>
  );
}
