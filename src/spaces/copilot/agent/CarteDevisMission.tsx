// src/spaces/copilot/agent/CarteDevisMission.tsx
// Carte « devis de mission » insérée dans le fil du chat quand MimmozIA
// propose une mission longue (événement SSE `mission_devis`, ou sortie de
// l'outil `proposer_mission` relue au rechargement de la conversation).
//
// La mission est RELUE en base dès qu'on connaît son identifiant : la carte
// affiche toujours son vrai statut (lancée, annulée…), même des jours après.
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Rocket } from 'lucide-react';
import { JETON_VALEUR_EUR } from '@/lib/billing/grille';
import { useCopilotStore } from '../store/copilotStore';
import { annulerMission, lireMissionParId, validerDevis } from './agentApi';
import {
  devisExpire, dureeLisible, formatJetons, MESSAGE_DEVIS_EXPIRE, libelleStatut, libelleType, resumerDevis, tonStatut,
  type AffichageDevis,
} from './agentLogique';
import type { Mission } from './agent.types';
import { useAgentUi } from './agentUi.store';
import './agent.css';

interface Props {
  affichage: AffichageDevis;
  onSend?: (texte: string) => void;
}

export function CarteDevisMission({ affichage, onSend }: Props) {
  if (affichage.etat === 'preparation') {
    return (
      <div className="mzag mzag-carte mzag-devis" role="status">
        <span className="mzag-sur"><Loader2 size={14} className="mzag-tourne" /> Mission</span>
        <p className="mzag-muet" style={{ margin: '6px 0 0' }}>Préparation du devis de la mission…</p>
      </div>
    );
  }
  if (affichage.etat === 'erreur') {
    return (
      <div className="mzag mzag-carte mzag-devis">
        <span className="mzag-sur">Mission</span>
        <p className="mzag-alerte" style={{ margin: '8px 0 0' }}>La mission n’a pas pu être préparée. Vous pouvez reformuler votre demande.</p>
      </div>
    );
  }
  return <CarteDevis proposition={affichage.proposition} onSend={onSend} />;
}

function CarteDevis({ proposition, onSend }: { proposition: Extract<AffichageDevis, { etat: 'carte' }>['proposition']; onSend?: (t: string) => void }) {
  const missionId = proposition.missionId;
  const [mission, setMission] = useState<Mission | null>(null);
  const [occupe, setOccupe] = useState<'lancer' | 'annuler' | 'modifier' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [modif, setModif] = useState<string | null>(null);

  const solde = useCopilotStore((s) => s.credits);
  const version = useAgentUi((s) => s.version);
  const hotes = useAgentUi((s) => s.hotes);

  // Solde inconnu à l'ouverture d'une ancienne conversation : on le lit une fois.
  useEffect(() => {
    if (useCopilotStore.getState().credits == null) void useCopilotStore.getState().refreshCredits?.();
  }, []);

  const relire = useCallback(async () => {
    if (!missionId) return;
    try {
      const m = await lireMissionParId(missionId);
      if (m) setMission(m);
    } catch { /* la carte reste lisible avec les données du fil */ }
  }, [missionId]);

  useEffect(() => { void relire(); }, [relire, version]);

  const devis = mission?.devis ?? proposition.devis;
  const statut = mission?.statut ?? 'devis';
  const objectif = mission?.objectif || proposition.objectif || 'Mission proposée par MimmozIA';
  const type = mission?.type ?? proposition.type ?? 'libre';

  const lancer = async () => {
    if (!missionId) return;
    setOccupe('lancer'); setErreur(null);
    try {
      const m = await validerDevis(missionId);
      if (m) setMission(m); else await relire();
      useAgentUi.getState().signalerChangement();
      // La réservation est faite par le moteur au démarrage : on relit le solde ensuite.
      window.setTimeout(() => { void useCopilotStore.getState().refreshCredits?.(); }, 8000);
      if (useAgentUi.getState().hotes > 0) useAgentUi.getState().ouvrir('missions', missionId);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Le lancement a échoué.');
    } finally { setOccupe(null); }
  };

  const annuler = async () => {
    if (!missionId) return;
    setOccupe('annuler'); setErreur(null);
    try {
      const m = await annulerMission(missionId);
      if (m) setMission(m); else await relire();
      useAgentUi.getState().signalerChangement();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'L’annulation a échoué.');
    } finally { setOccupe(null); }
  };

  const envoyerModif = async () => {
    const t = (modif ?? '').trim();
    if (!t || !onSend) return;
    setOccupe('modifier'); setErreur(null);
    // L'ancien devis est abandonné : MimmozIA en proposera un nouveau.
    if (missionId) { try { await annulerMission(missionId); } catch { /* sans importance */ } }
    setModif(null); setOccupe(null);
    onSend(`Modifie la mission proposée (« ${objectif.slice(0, 160)} ») : ${t}`);
    void relire();
  };

  const resume = devis ? resumerDevis(devis, solde, JETON_VALEUR_EUR) : null;
  // Devis de plus de 24 h : le serveur refuse le lancement ; on le dit avant le clic.
  const expire = statut === 'devis' && (devisExpire(devis) || erreur === MESSAGE_DEVIS_EXPIRE);
  const duree = dureeLisible(devis?.duree_estimee_min);

  return (
    <section className="mzag mzag-carte mzag-devis" aria-label="Devis de mission">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span className="mzag-sur"><Rocket size={14} aria-hidden /> {libelleType(type)} · devis</span>
        {statut !== 'devis' && <span className={`mzag-pastille mzag-pastille--${tonStatut(statut)}`}>{libelleStatut(statut)}</span>}
      </div>
      <p className="mzag-devis__objectif">{objectif}</p>
      {devis?.explication && <p className="mzag-muet" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{devis.explication}</p>}

      {devis && resume ? (
        <>
          <div className="mzag-devis__chiffres">
            <div className="mzag-chiffre">
              <div className="mzag-chiffre__label">Coût estimé</div>
              <div className="mzag-chiffre__valeur">{resume.fourchette}</div>
              <div className="mzag-chiffre__sous">soit {resume.fourchetteEuros}</div>
            </div>
            <div className="mzag-chiffre">
              <div className="mzag-chiffre__label">Votre solde</div>
              <div className="mzag-chiffre__valeur">{solde == null ? '…' : formatJetons(solde)}</div>
              {resume.soldeSuffisant === false && <div className="mzag-chiffre__sous" style={{ color: '#b91c1c' }}>il manque {formatJetons(resume.manque)}</div>}
            </div>
            <div className="mzag-chiffre">
              <div className="mzag-chiffre__label">Ampleur</div>
              <div className="mzag-chiffre__valeur">{devis.etapes_max ? `${devis.etapes_max} étapes max.` : '—'}</div>
              {duree && <div className="mzag-chiffre__sous">{duree}</div>}
            </div>
          </div>
          <p className="mzag-devis__regle">
            Au lancement, {resume.reserve} sont mis de côté. Seul ce qui est réellement utilisé est décompté ; le reste vous est rendu à la fin.
            Si le plafond est atteint, la mission s’arrête proprement et vous remet un rapport partiel.
          </p>
        </>
      ) : (
        <p className="mzag-muet">Le détail du coût n’est pas disponible pour cette mission.</p>
      )}

      {expire && <p className="mzag-info" role="status" style={{ margin: '0 0 10px' }}>{MESSAGE_DEVIS_EXPIRE}</p>}
      {erreur && !expire && <p className="mzag-alerte" role="alert" style={{ margin: '0 0 10px' }}>{erreur}</p>}

      {statut === 'devis' && missionId && (
        modif !== null ? (
          <div className="mzag-pile">
            <label className="mzag-petit" htmlFor={`modif-${missionId}`}>Que voulez-vous changer ? (communes, surface, budget, nombre de terrains…)</label>
            <textarea id={`modif-${missionId}`} className="mzag-textarea" rows={3} value={modif} onChange={(e) => setModif(e.target.value)} autoFocus maxLength={1500} />
            <div className="mzag-actions">
              <button type="button" className="mzag-btn mzag-btn--plein" disabled={!modif.trim() || !onSend || occupe !== null} onClick={() => void envoyerModif()}>
                {occupe === 'modifier' ? 'Envoi…' : 'Demander un nouveau devis'}
              </button>
              <button type="button" className="mzag-btn mzag-btn--discret" onClick={() => setModif(null)}>Retour</button>
            </div>
          </div>
        ) : (
          <div className="mzag-actions">
            {onSend && expire && <button type="button" className="mzag-btn mzag-btn--plein" disabled={occupe !== null} onClick={() => setModif('')}>Modifier et redemander un devis</button>}
            <button type="button" className={`mzag-btn${expire ? '' : ' mzag-btn--plein'}`} disabled={occupe !== null || !devis || expire || resume?.soldeSuffisant === false} onClick={() => void lancer()}>
              {occupe === 'lancer' ? 'Lancement…' : 'Lancer la mission'}
            </button>
            {onSend && !expire && <button type="button" className="mzag-btn" disabled={occupe !== null} onClick={() => setModif('')}>Modifier</button>}
            <button type="button" className="mzag-btn mzag-btn--discret" disabled={occupe !== null} onClick={() => void annuler()}>
              {occupe === 'annuler' ? 'Annulation…' : 'Annuler'}
            </button>
          </div>
        )
      )}

      {statut !== 'devis' && statut !== 'annulee' && missionId && (
        hotes > 0
          ? <div className="mzag-actions"><button type="button" className="mzag-btn" onClick={() => useAgentUi.getState().ouvrir('missions', missionId)}>Suivre la mission</button></div>
          : <p className="mzag-petit" style={{ margin: 0 }}>Suivez son avancement depuis la page MimmozIA, menu « Missions ».</p>
      )}
      {!missionId && <p className="mzag-petit" style={{ margin: 0 }}>Cette proposition n’a pas pu être enregistrée : demandez à MimmozIA de la reproposer.</p>}
    </section>
  );
}
