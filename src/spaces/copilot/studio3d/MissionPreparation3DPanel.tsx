import { useEffect, useRef, useState } from 'react';
import type { Mission } from '../agent/agent.types';
import type { JarvisDraft } from './jarvisDraft';
import { chargerPointDeDepart, ficheObjectifMission, iduAttenduMission, iduDeParcelle, MaquetteDejaChargeeError, verifierTerrainMission, type ConfirmationParcelleMission, type PointDeDepart } from './missionPreparation3D';
import { diagnostiquerPreparation3D, exigerPreparation3D, exigerParcelle3D } from './preparation3D';
import { ConfirmerParcelle } from './ConfirmerParcelle';
import { parcelleRetenue } from './parcelleConfirmee';
import { parcelLabel } from './parcelFromGps';
import type { ConfirmedTerrain } from './terrainCadastre';
import { loadJarvisDraft } from './jarvisDraftRepository';
const CHAMPS = { objectif: 'Objectif', dimensions: 'Dimensions en mètres', programme: 'Programme', localisation: 'Adresse indicative', style: 'Style facultatif', contraintes: 'Contraintes' } as const;
/** Parcelle confirmée DANS ce panneau, pour cette mission et cette conversation. */
export type ParcelleMissionConfirmee = ConfirmationParcelleMission & { valeur: ConfirmedTerrain };
const dateCourte = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : ' du ' + d.toLocaleDateString('fr-FR'); };
export function MissionPreparation3DPanel({ mission, onFermer, onOuvrir, onFermerMaquette, chargerFiche = loadJarvisDraft }: {
  mission: Mission; onFermer: () => void;
  onOuvrir: (fiche: JarvisDraft, parcelle: ParcelleMissionConfirmee, remplacerMaquette: boolean) => Promise<void>;
  onFermerMaquette: () => void;
  chargerFiche?: (conversationId: string) => Promise<{ draft: JarvisDraft; status: 'draft' | 'validated'; updatedAt: string } | null>;
}) {
  const [depart, setDepart] = useState<PointDeDepart | null>(null);
  const [fiche, setFiche] = useState<JarvisDraft | null>(null);
  const [terrain, setTerrain] = useState<ParcelleMissionConfirmee | null>(null);
  const [chercher, setChercher] = useState(false);
  const [erreur, setErreur] = useState(''); const [occupe, setOccupe] = useState(false);
  const [maquette, setMaquette] = useState<MaquetteDejaChargeeError | null>(null);
  const verrou = useRef(false); const actif = useRef(true);
  const section = useRef<HTMLElement | null>(null); const fermer = useRef(onFermer); fermer.current = onFermer;
  const [retenue] = useState(() => mission.conversation_id ? parcelleRetenue(mission.conversation_id) : null);
  useEffect(() => {
    actif.current = true; const precedent = document.activeElement as HTMLElement | null; section.current?.focus();
    const clavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); if (!verrou.current) fermer.current(); }
      if (e.key !== 'Tab') return;
      const a = [...(section.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]') ?? [])];
      const premier = a[0], dernier = a[a.length-1];
      if (!premier) { e.preventDefault(); section.current?.focus(); }
      else if (e.shiftKey && (document.activeElement === premier || document.activeElement === section.current)) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && (document.activeElement === dernier || document.activeElement === section.current)) { e.preventDefault(); premier.focus(); }
    };
    document.addEventListener('keydown', clavier);
    return () => { actif.current = false; document.removeEventListener('keydown', clavier); if (precedent?.isConnected) precedent.focus(); };
  }, []);
  // Point de départ : la fiche ENREGISTRÉE de la conversation (lecture seule), jamais la dernière proposition du chat.
  useEffect(() => {
    let vivant = true;
    if (!mission.conversation_id) { setDepart({ type: 'aucune' }); setFiche(ficheObjectifMission(mission)); return; }
    void chargerPointDeDepart(mission.conversation_id, chargerFiche).then(d => {
      if (!vivant) return;
      setDepart(d);
      if (d.type !== 'enregistree') setFiche(ficheObjectifMission(mission));
    });
    return () => { vivant = false; };
  }, [mission, chargerFiche]);
  const confirmer = (t: ConfirmedTerrain) => {
    try {
      exigerParcelle3D(t.parcel);
      const confirmation = { missionId: mission.id, conversationId: mission.conversation_id!, parcelId: iduDeParcelle(t.parcel) ?? parcelLabel(t.parcel) };
      verifierTerrainMission(mission.id, mission.conversation_id!, confirmation, iduAttenduMission(mission));
      setTerrain({ ...confirmation, valeur: t }); setChercher(false); setErreur('');
    } catch (e) { setErreur(e instanceof Error ? e.message : 'Parcelle invalide.'); }
  };
  const ouvrir = async (remplacer: boolean) => {
    if (verrou.current || !fiche || !terrain) return;
    verrou.current = true; setOccupe(true); setErreur(''); setMaquette(null);
    try {
      exigerPreparation3D(fiche); exigerParcelle3D(terrain.valeur.parcel);
      verifierTerrainMission(mission.id, mission.conversation_id!, terrain, iduAttenduMission(mission));
      await onOuvrir(fiche, terrain, remplacer);
    } catch (e) {
      if (!actif.current) return;
      if (e instanceof MaquetteDejaChargeeError) setMaquette(e);
      else setErreur(e instanceof Error ? e.message : 'Ouverture impossible.');
    }
    finally { verrou.current = false; if (actif.current) setOccupe(false); }
  };
  const diagnostic = fiche ? diagnostiquerPreparation3D(fiche) : null;
  return <section ref={section} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="mission-prepa-titre" className="mzag"
    style={{ position: 'fixed', inset: 0, zIndex: 10060, overflow: 'auto', padding: 24, background: 'white' }}>
    <h2 id="mission-prepa-titre">Préparer le projet de la mission en 3D</h2><p>{mission.objectif}</p>
    <p>Cette préparation locale ne relance pas la mission et ne demande aucune nouvelle réponse à l’IA. Les informations ajoutées ici ne modifient pas la fiche 3D enregistrée de la conversation.</p>
    {!depart && <p role="status">Lecture de la fiche 3D enregistrée…</p>}
    {depart?.type === 'aucune' && <p role="status">Aucune fiche 3D enregistrée dans cette conversation : la préparation part uniquement de l’objectif de la mission.</p>}
    {depart?.type === 'erreur' && <p role="status">La fiche 3D enregistrée n’a pas pu être lue ({depart.message}) : la préparation part uniquement de l’objectif de la mission.</p>}
    {depart?.type === 'enregistree' && !fiche && <><p>Une fiche 3D est enregistrée dans cette conversation ({depart.statut === 'validated' ? 'validée' : 'brouillon'}{dateCourte(depart.majLe)}). Choisissez explicitement le point de départ.</p>
      <button type="button" onClick={() => setFiche(depart.fiche)}>Reprendre la fiche 3D enregistrée</button>{' '}
      <button type="button" onClick={() => setFiche(ficheObjectifMission(mission))}>Partir uniquement de l’objectif de mission</button></>}
    {fiche && <>
      {Object.entries(CHAMPS).map(([champ,label]) => <label key={champ} style={{ display: 'block', margin: '10px 0' }}>{label}<textarea rows={2} disabled={occupe} style={{ display: 'block', width: '100%' }} value={fiche[champ as keyof typeof CHAMPS] ?? ''} onChange={e => setFiche({ ...fiche, [champ]: e.target.value || null })} /></label>)}
      <p>Les valeurs viennent de la fiche ou de vos corrections ; aucune dimension manquante n’est calculée automatiquement.</p>
      {diagnostic && <ul>{diagnostic.informations.map(i => <li key={i.cle}>{i.libelle} — {i.statut === 'hypothese' ? 'Hypothèse à vérifier' : i.statut === 'manquant' ? 'À préciser' : 'Présent dans la fiche'} : {i.detail}</li>)}</ul>}
      {!diagnostic?.pret && <p role="status">{diagnostic?.questions.join(' ')}</p>}
      <h3>Parcelle pour cette mission</h3>
      {terrain ? <p>Parcelle confirmée : {parcelLabel(terrain.valeur.parcel)}</p> : <p>La parcelle de la conversation n’est pas automatiquement associée à cette mission, et ce choix ne modifie pas la parcelle retenue pour la conversation.</p>}
      {!terrain && retenue && <button type="button" disabled={occupe} onClick={() => confirmer(retenue)}>Utiliser la parcelle {parcelLabel(retenue.parcel)} pour cette mission</button>}{' '}
      <button type="button" disabled={occupe} onClick={() => setChercher(true)}>Choisir une parcelle</button>
      {chercher && <ConfirmerParcelle adresseInitiale={fiche.localisation} onConfirmer={confirmer} onAnnuler={() => setChercher(false)} />}
      <p>Sans relief mesuré, l’implantation reste indicative. La conformité du projet doit être vérifiée.</p>
      {maquette && <div role="alertdialog" aria-label="Maquette déjà chargée">
        <p>{maquette.message}</p>
        <button type="button" disabled={occupe} onClick={() => void ouvrir(true)}>Remplacer la maquette chargée par ce projet</button>{' '}
        <button type="button" disabled={occupe} onClick={() => { onFermerMaquette(); setMaquette(null); }}>Fermer la maquette chargée</button>{' '}
        <button type="button" disabled={occupe} onClick={() => setMaquette(null)}>Garder la maquette</button>
      </div>}
      <button type="button" disabled={occupe || !diagnostic?.pret || !terrain} onClick={() => void ouvrir(false)}>{occupe ? 'Ouverture…' : 'Ouvrir ce projet dans Studio'}</button>
    </>}
    {erreur && <p role="alert">{erreur}</p>}
    <button type="button" disabled={occupe} onClick={onFermer}>Fermer la préparation</button>
  </section>;
}
