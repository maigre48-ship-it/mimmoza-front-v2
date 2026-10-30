// src/spaces/copilot/agent/PanneauMissions.tsx
// Onglet « Missions » : liste des missions, puis détail d'une mission
// (progression, journal en temps réel, question en attente, annulation,
// rapport). Temps réel Supabase + relecture de secours toutes les 10 s.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { JETON_VALEUR_EUR } from '@/lib/billing/grille';
import { useCopilotStore } from '../store/copilotStore';
import { annulerMission, lireJournal, lireMissionParId, listerMissions, repondreMission, suivreMission, validerDevis } from './agentApi';
import {
  dateCourte, devisExpire, formatEuros, MESSAGE_DEVIS_EXPIRE, formatJetons, libelleJournal, libelleStatut, libelleType,
  missionActive, missionFinie, peutAnnuler, peutRepondre, progression, tonStatut,
} from './agentLogique';
import type { LigneJournal, Mission } from './agent.types';
import { RapportMission } from './RapportMission';
import { useAgentUi } from './agentUi.store';

function Barres({ m }: { m: Mission }) {
  const p = progression(m);
  return (
    <div className="mzag-prog">
      <div>
        <div className="mzag-prog__ligne"><span>Étapes</span><span>{p.etapes} / {p.etapesMax}</span></div>
        <div className="mzag-barre" role="progressbar" aria-label="Étapes réalisées" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pctEtapes}>
          <div className="mzag-barre__plein" style={{ width: `${p.pctEtapes}%` }} />
        </div>
      </div>
      {p.reserves > 0 && (
        <div>
          <div className="mzag-prog__ligne"><span>Jetons utilisés</span><span>{p.consommes.toLocaleString('fr-FR')} / {formatJetons(p.reserves)}</span></div>
          <div className="mzag-barre mzag-barre--jetons" role="progressbar" aria-label="Jetons utilisés" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pctJetons}>
            <div className="mzag-barre__plein" style={{ width: `${p.pctJetons}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

export function PanneauMissions() {
  const missionId = useAgentUi((s) => s.missionId);
  return missionId ? <DetailMission key={missionId} id={missionId} /> : <ListeMissions />;
}

function ListeMissions() {
  const version = useAgentUi((s) => s.version);
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try { setMissions(await listerMissions()); setErreur(null); }
    catch (e) { setErreur(e instanceof Error ? e.message : 'Lecture impossible.'); setMissions((m) => m ?? []); }
  }, []);

  useEffect(() => { void charger(); }, [charger, version]);
  const auMoinsUneActive = !!missions?.some((m) => missionActive(m.statut));
  useEffect(() => {
    if (!auMoinsUneActive) return;
    const t = window.setInterval(() => { void charger(); }, 15000);
    return () => window.clearInterval(t);
  }, [auMoinsUneActive, charger]);

  if (missions === null) return <p className="mzag-muet">Chargement des missions…</p>;
  if (erreur && missions.length === 0) return <p className="mzag-alerte">{erreur}</p>;
  if (missions.length === 0) {
    return (
      <div className="mzag-vide">
        <strong>Aucune mission pour l’instant</strong>
        Demandez à MimmozIA un travail de fond, par exemple « trouve-moi des terrains constructibles de 1 500 à 4 000 m² à Montreuil et Bagnolet ».
        Il vous proposera un devis avant de commencer.
      </div>
    );
  }
  return (
    <div className="mzag-liste">
      {missions.map((m) => {
        const p = progression(m);
        return (
          <button key={m.id} type="button" className="mzag-item" onClick={() => useAgentUi.getState().choisirMission(m.id)}>
            <div className="mzag-item__haut">
              <span className="mzag-item__objectif">{m.objectif || libelleType(m.type)}</span>
              <span className={`mzag-pastille mzag-pastille--${tonStatut(m.statut)}`}>{libelleStatut(m.statut)}</span>
            </div>
            {(missionActive(m.statut) || missionFinie(m.statut)) && m.statut !== 'annulee' && (
              <div className="mzag-barre" aria-hidden><div className="mzag-barre__plein" style={{ width: `${p.pctEtapes}%` }} /></div>
            )}
            <span className="mzag-petit">
              {libelleType(m.type)}{m.origine === 'proactif' ? ' · lancée par la veille' : ''} · {dateCourte(m.cree_le)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DetailMission({ id }: { id: string }) {
  const [mission, setMission] = useState<Mission | null>(null);
  const [journal, setJournal] = useState<LigneJournal[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [reponse, setReponse] = useState('');
  const [occupe, setOccupe] = useState<'repondre' | 'annuler' | 'lancer' | null>(null);
  const solde = useCopilotStore((s) => s.credits);
  const finJournal = useRef<HTMLLIElement | null>(null);
  const enTrain = useRef(false);

  const relire = useCallback(async () => {
    if (enTrain.current) return;
    enTrain.current = true;
    try {
      const [m, j] = await Promise.all([lireMissionParId(id), lireJournal(id)]);
      setMission(m); setJournal(j); setErreur(m ? null : 'Cette mission est introuvable.');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Lecture impossible.');
    } finally { enTrain.current = false; }
  }, [id]);

  useEffect(() => { void relire(); }, [relire]);
  useEffect(() => suivreMission(id, () => { void relire(); }), [id, relire]);

  const active = mission ? missionActive(mission.statut) : false;
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => { void relire(); }, 10000);
    return () => window.clearInterval(t);
  }, [active, relire]);

  // Fin de mission : le reste réservé est rendu → on relit le solde affiché.
  const finie = mission ? missionFinie(mission.statut) : false;
  useEffect(() => { if (finie) void useCopilotStore.getState().refreshCredits?.(); }, [finie]);

  useEffect(() => { if (active) finJournal.current?.scrollIntoView({ block: 'nearest' }); }, [journal.length, active]);

  const agir = async (genre: 'repondre' | 'annuler' | 'lancer') => {
    if (!mission) return;
    if (genre === 'annuler' && !window.confirm('Arrêter cette mission ? Ce qui n’a pas été utilisé vous sera rendu.')) return;
    setOccupe(genre); setErreur(null);
    try {
      const m = genre === 'repondre' ? await repondreMission(mission.id, reponse.trim())
        : genre === 'annuler' ? await annulerMission(mission.id)
        : await validerDevis(mission.id);
      if (m) setMission(m);
      if (genre === 'repondre') setReponse('');
      useAgentUi.getState().signalerChangement();
      void relire();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'L’opération a échoué.');
    } finally { setOccupe(null); }
  };

  const retour = (
    <button type="button" className="mzag-btn mzag-btn--discret mzag-btn--petit" onClick={() => useAgentUi.getState().choisirMission(null)}>
      <ArrowLeft size={14} aria-hidden /> Toutes les missions
    </button>
  );

  if (!mission) return <div className="mzag-pile">{retour}{erreur ? <p className="mzag-alerte">{erreur}</p> : <p className="mzag-muet">Chargement…</p>}</div>;

  const devis = mission.devis;
  return (
    <div className="mzag-pile">
      {retour}
      <div className="mzag-carte">
        <div className="mzag-item__haut">
          <span className="mzag-sur">{libelleType(mission.type)}{mission.origine === 'proactif' ? ' · veille' : ''}</span>
          <span className={`mzag-pastille mzag-pastille--${tonStatut(mission.statut)}`}>{libelleStatut(mission.statut)}</span>
        </div>
        <h3 className="mzag-titre" style={{ margin: '6px 0 4px' }}>{mission.objectif}</h3>
        <p className="mzag-petit" style={{ margin: '0 0 12px' }}>Créée {dateCourte(mission.cree_le)}{mission.termine_le ? ` · terminée ${dateCourte(mission.termine_le)}` : ''}</p>
        {mission.statut === 'devis' && devis ? (
          <p className="mzag-muet" style={{ margin: 0 }}>
            Devis : {formatJetons(devis.jetons_min)} à {formatJetons(devis.jetons_max)} (jusqu’à {formatEuros(devis.jetons_max, JETON_VALEUR_EUR)}).
            {solde != null && solde < devis.jetons_max ? ` Votre solde (${formatJetons(solde)}) est insuffisant.` : ''}
            {devisExpire(devis) ? ` ${MESSAGE_DEVIS_EXPIRE}` : ''}
          </p>
        ) : <Barres m={mission} />}
        {mission.statut === 'en_attente' && <p className="mzag-petit" style={{ margin: '10px 0 0' }}>La mission démarre dans la minute.</p>}
        {mission.erreur && <p className="mzag-alerte" style={{ margin: '12px 0 0' }}>{mission.erreur}</p>}
        <div className="mzag-actions" style={{ marginTop: 12 }}>
          {mission.statut === 'devis' && (
            <button type="button" className="mzag-btn mzag-btn--plein mzag-btn--petit" disabled={occupe !== null || !devis || devisExpire(devis) || (solde != null && !!devis && solde < devis.jetons_max)} onClick={() => void agir('lancer')}>
              {occupe === 'lancer' ? 'Lancement…' : 'Lancer la mission'}
            </button>
          )}
          {peutAnnuler(mission.statut) && (
            <button type="button" className="mzag-btn mzag-btn--danger mzag-btn--petit" disabled={occupe !== null} onClick={() => void agir('annuler')}>
              {occupe === 'annuler' ? 'Arrêt…' : mission.statut === 'devis' ? 'Annuler le devis' : 'Arrêter la mission'}
            </button>
          )}
        </div>
      </div>

      {erreur && <p className="mzag-alerte" role="alert">{erreur}</p>}

      {peutRepondre(mission) && (
        <div className="mzag-question">
          <p>MimmozIA a besoin de vous : {mission.question_en_attente}</p>
          <textarea className="mzag-textarea" rows={3} value={reponse} maxLength={4000} onChange={(e) => setReponse(e.target.value)} aria-label="Votre réponse" placeholder="Votre réponse…" />
          <div className="mzag-actions" style={{ marginTop: 8 }}>
            <button type="button" className="mzag-btn mzag-btn--plein mzag-btn--petit" disabled={!reponse.trim() || occupe !== null} onClick={() => void agir('repondre')}>
              {occupe === 'repondre' ? 'Envoi…' : 'Répondre et reprendre'}
            </button>
          </div>
        </div>
      )}

      {mission.rapport && <RapportMission mission={mission} partiel={mission.statut !== 'terminee'} />}

      <section className="mzag-carte" aria-label="Journal de la mission">
        <span className="mzag-sur">Journal{active ? ' · en direct' : ''}</span>
        {journal.length === 0 ? (
          <p className="mzag-muet" style={{ margin: '8px 0 0' }}>{mission.statut === 'devis' ? 'La mission n’a pas encore commencé.' : 'Rien pour l’instant.'}</p>
        ) : (
          <ol className="mzag-journal" style={{ marginTop: 8 }}>
            {journal.map((l, i) => (
              <li key={l.id} ref={i === journal.length - 1 ? finJournal : undefined}>
                <span>
                  <span className={`mzag-journal__genre mzag-journal__genre--${l.genre}`}>{libelleJournal(l.genre)}</span>
                  <div className="mzag-journal__heure">{dateCourte(l.cree_le).split(', ').pop()}</div>
                </span>
                <span style={{ whiteSpace: 'pre-wrap' }}>{l.resume}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
