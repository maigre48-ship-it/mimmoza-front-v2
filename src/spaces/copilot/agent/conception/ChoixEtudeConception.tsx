import { useEffect, useRef, useState } from 'react';
import { chargerChoixLiaison, confirmerLiaison, type DepotLiaison, type EtudeChoix } from './liaisonEtude';
import { depotLiaisonEtude } from './liaisonEtudeService';
export function ChoixEtudeConception({ conceptionId, contexte, onOuvrir, onFermer, depot = depotLiaisonEtude }: {
  conceptionId: string; contexte: string; onOuvrir: (etudeId: string | null) => void; onFermer: () => void; depot?: DepotLiaison;
}) {
  const [etudes, setEtudes] = useState<EtudeChoix[]>([]);
  const [choix, setChoix] = useState('');
  const [chargement, setChargement] = useState(true);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [avertissement, setAvertissement] = useState<string | null>(null);
  const [essai, setEssai] = useState(0);
  const vivant = useRef(true);
  const verrou = useRef(false);
  const panneau = useRef<HTMLElement | null>(null);
  const fermer = useRef(onFermer); fermer.current = onFermer;
  useEffect(() => {
    const precedent = document.activeElement as HTMLElement | null;
    panneau.current?.focus();
    const clavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); if (!verrou.current) fermer.current(); return; }
      if (e.key !== 'Tab') return;
      const accessibles = [...(panneau.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])];
      const premier = accessibles[0], dernier = accessibles[accessibles.length - 1];
      if (!premier) { e.preventDefault(); panneau.current?.focus(); }
      else if (e.shiftKey && (document.activeElement === premier || document.activeElement === panneau.current)) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && (document.activeElement === dernier || document.activeElement === panneau.current)) { e.preventDefault(); premier.focus(); }
    };
    document.addEventListener('keydown', clavier);
    return () => { document.removeEventListener('keydown', clavier); if (precedent?.isConnected) precedent.focus(); };
  }, []);
  useEffect(() => { vivant.current = true; return () => { vivant.current = false; }; }, []);
  useEffect(() => {
    let actif = true;
    setChargement(true); setErreur(null); setAvertissement(null); setEtudes([]); setChoix('');
    void chargerChoixLiaison(conceptionId, depot).then(r => {
      if (actif) { setEtudes(r.etudes); setChoix(r.etudeId ?? ''); setAvertissement(r.avertissement ?? null); }
    }).catch(e => { if (actif) setErreur(e instanceof Error ? e.message : 'Lecture impossible.'); })
      .finally(() => { if (actif) setChargement(false); });
    return () => { actif = false; };
  }, [conceptionId, depot, essai]);
  const ouvrir = async () => {
    if (verrou.current) return;
    verrou.current = true; setEnCours(true); setErreur(null);
    try {
      const id = await confirmerLiaison(conceptionId, choix || null, etudes, depot);
      if (vivant.current) onOuvrir(id);
    } catch (e) { if (vivant.current) setErreur(e instanceof Error ? e.message : 'Enregistrement impossible.'); }
    finally { verrou.current = false; if (vivant.current) setEnCours(false); }
  };
  return <section ref={panneau} tabIndex={-1} className="mzag" role="dialog" aria-modal="true" aria-labelledby="choix-etude-titre"
    style={{ position: 'fixed', inset: 0, zIndex: 10050, background: 'white', padding: 24, overflow: 'auto', border: '1px solid #cbd5e1', borderRadius: 12 }}>
    <h2 id="choix-etude-titre">Étude du projet 3D</h2>
    <p>{contexte}</p>
    <p>Choisissez une étude existante pour recevoir les métrés dans son bilan. Ce choix est enregistré pour cette conception. Il reste fixe pendant la session pour préserver votre maquette.</p>
    {chargement ? <p role="status">Chargement des études et de la liaison…</p> : <>
      <label htmlFor="etude-conception">Étude destinataire</label>{' '}
      <select id="etude-conception" value={choix} disabled={enCours || !!erreur} onChange={e => setChoix(e.target.value)}>
        <option value="">Sans liaison à un bilan</option>
        {etudes.map(e => <option key={e.id} value={e.id}>{e.title || 'Étude sans titre'}</option>)}
      </select>
      {avertissement && <p role="status">{avertissement}</p>}
      {erreur && <p role="alert">{erreur}</p>}
      <p>Sans liaison, le bilan vivant de la conception reste disponible. La synchronisation avec une étude nécessite une liaison enregistrée.</p>
      <div className="mzag-actions">
        {!erreur && <button type="button" className="mzag-btn mzag-btn--plein" disabled={enCours} onClick={() => void ouvrir()}>{enCours ? 'Enregistrement…' : 'Enregistrer et ouvrir Studio'}</button>}
        {erreur && <><button type="button" className="mzag-btn" disabled={enCours} onClick={() => setEssai(n => n + 1)}>Réessayer</button><button type="button" className="mzag-btn" disabled={enCours} onClick={() => onOuvrir(null)}>Ouvrir sans synchronisation au bilan</button></>}
        <button type="button" className="mzag-btn" disabled={enCours} onClick={onFermer}>Annuler</button>
      </div>
    </>}
  </section>;
}
