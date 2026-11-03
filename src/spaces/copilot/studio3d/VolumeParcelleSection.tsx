// src/spaces/copilot/studio3d/VolumeParcelleSection.tsx
//
// « Dossier 3D » : la parcelle choisie dans la conversation (ou la plus
// susceptible de l'être) avec un VOLUME D'ÉTUDE simple (un parallélépipède),
// la raison du choix, les autres candidates, et « Voir en 3D réaliste dans Studio ».
//
// Sources (contexteVolume.ts) : parcelle confirmée > choix manuel > IDU cité par
// l'utilisateur > carte du dossier > recommandation de Mimmo > classement >
// dernier dossier. Règles PLU (reglesPlu.ts) filtrées sur l'IDU / la zone de la
// parcelle affichée. Calcul : volumeParcelle.ts.
//
// Studio : AUCUN second chemin. Le volume devient une fiche 3D (dimensions,
// R+N) remise à `onOpenStudio`, c'est-à-dire MimmozIAPage.voirEn3D — le même
// parcours que « Voir en 3D » (diagnostic de la fiche, parcelle confirmée exigée,
// charge Studio construite par chargeVoirEn3D). Sans parcelle confirmée, le clic
// affiche d'abord la confirmation rapide (ConfirmationParcelleRapide : référence
// cadastrale + adresse la plus proche, un clic) ; « Autre parcelle » ouvre la
// recherche par adresse / carte (ConfirmerParcelle).

import { lazy, Suspense, type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Box, Check, ChevronDown, Info, MapPin, Search, TriangleAlert, Undo2 } from 'lucide-react';
import type { ChatMessage } from '../types/copilot.types';
import type { JarvisDraft } from './jarvisDraft';
import { cleChoixManuel, contexteVolume, LIBELLES_RAISON, type CandidateParcelle, type ContexteVolume, type StockageLecture } from './contexteVolume';
import { calculerVolumeParcelle, ficheStudioDepuisVolume, libelleNiveaux, type GeometrieParcelle, type VolumePropose } from './volumeParcelle';
import { parcelleRetenue } from './parcelleConfirmee';
import { exigerPreparation3D } from './preparation3D';
import { ConfirmerParcelle } from './ConfirmerParcelle';
import { ConfirmationParcelleRapide } from './ConfirmationParcelleRapide';
import { implantationDepuisVolume } from './confirmationRapide';
import type { ConfirmedTerrain } from './terrainCadastre';
import { parcelId, type TerrainParcel } from './parcelFromGps';
import type { IssueOuvertureStudio } from './JarvisDraftPanel';
import { messageErreur } from '@/components/ui/messageErreur';
import { userStorage } from '@/lib/storage/userScopedStorage';
import './VolumeParcelle.css';

const VolumeParcelle3D = lazy(() => import('./VolumeParcelle3D'));
const fr = (v: number, d = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: d });

type OuvrirStudio = (draft: JarvisDraft, conversationId: string, terrain?: ConfirmedTerrain & { adresse?: string | null }) => Promise<IssueOuvertureStudio>;

function stockageNavigateur(): StockageLecture | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** Contexte du volume (parcelle, programme, règles), relu quand la parcelle retenue ou le choix manuel change. */
export function useContexteVolume(messages: readonly ChatMessage[], conversationId: string | null, fiche: JarvisDraft | null) {
  const [version, setVersion] = useState(0);
  const relire = useCallback(() => setVersion(v => v + 1), []);
  useEffect(() => {
    // Parcelle confirmée ailleurs (question minimale, photo/GPS) : relecture.
    window.addEventListener('storage', relire);
    return () => window.removeEventListener('storage', relire);
  }, [relire]);
  /** Choix manuel mémorisé par conversation (stockage scopé utilisateur) ; null = choix automatique. */
  const choisir = useCallback((idu: string | null) => {
    if (!conversationId) return;
    if (idu) userStorage.setItem(cleChoixManuel(conversationId), idu); else userStorage.removeItem(cleChoixManuel(conversationId));
    relire();
  }, [conversationId, relire]);
  const contexte = useMemo(() => contexteVolume({
    messages, conversationId, fiche,
    retenue: conversationId ? parcelleRetenue(conversationId) : null,
    stockage: stockageNavigateur(),
    stockageUtilisateur: userStorage,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [messages, conversationId, fiche, version]);
  return { contexte, choisir, relire };
}

// --- Contour cadastral (cadastre IGN, même service que la carte du dossier), quelle que soit la source ---
const contours = new Map<string, TerrainParcel | null>();
const URL_CADASTRE = 'https://apicarto.ign.fr/api/cadastre/parcelle';
const garderPolygone = (features: TerrainParcel[] | undefined, idu: string) => {
  const f = (features ?? []).find(x => String(x?.properties?.idu ?? '').toUpperCase() === idu
    && (x.geometry?.type === 'Polygon' || x.geometry?.type === 'MultiPolygon'));
  return f ? { ...f, properties: f.properties ?? {} } : null;
};
async function chargerContour(idu: string, point: { lat: number; lon: number } | null, signal: AbortSignal): Promise<TerrainParcel | null> {
  if (contours.has(idu)) return contours.get(idu)!;
  let parcelle: TerrainParcel | null = null;
  if (point) {
    // Point connu (adresse, centroïde) : emprise de 150 m, filtrée sur l'IDU.
    const dLat = 150 / 111_000, dLon = 150 / (111_000 * Math.cos(point.lat * Math.PI / 180));
    const geom = { type: 'Polygon', coordinates: [[[point.lon - dLon, point.lat - dLat], [point.lon + dLon, point.lat - dLat], [point.lon + dLon, point.lat + dLat], [point.lon - dLon, point.lat + dLat], [point.lon - dLon, point.lat - dLat]]] };
    const r = await fetch(`${URL_CADASTRE}?geom=${encodeURIComponent(JSON.stringify(geom))}&_limit=500`, { signal });
    if (!r.ok) throw new Error(`Cadastre IGN indisponible (${r.status}).`);
    parcelle = garderPolygone((await r.json() as { features?: TerrainParcel[] }).features, idu);
  }
  if (!parcelle) {
    // Sans point (IDU cité dans la conversation) : recherche par commune, section et numéro.
    const section = idu.slice(8, 10);
    for (const s of [...new Set([section, section.replace(/^0/, '')])]) {
      const q = new URLSearchParams({ code_insee: idu.slice(0, 5), section: s, numero: idu.slice(10), _limit: '20' });
      if (idu.slice(5, 8) !== '000') q.set('com_abs', idu.slice(5, 8));
      const r = await fetch(`${URL_CADASTRE}?${q}`, { signal });
      if (!r.ok) throw new Error(`Cadastre IGN indisponible (${r.status}).`);
      parcelle = garderPolygone((await r.json() as { features?: TerrainParcel[] }).features, idu);
      if (parcelle) break;
    }
  }
  contours.set(idu, parcelle);
  return parcelle;
}

type EtatContour = { etat: 'chargement' } | { etat: 'ok'; parcelle: TerrainParcel } | { etat: 'introuvable' } | { etat: 'erreur'; message: string };

function useContour(contexte: ContexteVolume): EtatContour | null {
  const p = contexte.parcelle;
  const c = p.type === 'candidate' ? p.candidate : null;
  const idu = c?.idu ?? null, lat = c?.point?.lat ?? null, lon = c?.point?.lon ?? null;
  const [etat, setEtat] = useState<EtatContour | null>(null);
  useEffect(() => {
    if (!idu) { setEtat(null); return; }
    const controleur = new AbortController();
    setEtat({ etat: 'chargement' });
    chargerContour(idu, lat !== null && lon !== null ? { lat, lon } : null, controleur.signal)
      .then(parcelle => { if (!controleur.signal.aborted) setEtat(parcelle ? { etat: 'ok', parcelle } : { etat: 'introuvable' }); })
      .catch(e => { if (!controleur.signal.aborted) setEtat({ etat: 'erreur', message: messageErreur(e, 'Contour cadastral indisponible.') }); });
    return () => controleur.abort();
  }, [idu, lat, lon]);
  if (p.type === 'confirmee') return { etat: 'ok', parcelle: p.retenue.parcel };
  return etat;
}

/** « AN 0412 » depuis l'IDU 92050000AN0412. */
export const referenceLisible = (idu: string) => /^[0-9A-Z]{14}$/.test(idu) ? `${idu.slice(8, 10).replace(/^0/, '')} ${idu.slice(10)}` : idu;

function libelleCandidate(c: CandidateParcelle) {
  return [referenceLisible(c.idu), c.surfaceM2 != null ? `${fr(c.surfaceM2)} m²` : null, c.zone, c.rang ? `#${c.rang}` : null].filter(Boolean).join(' · ');
}

export function VolumeParcelleSection({ contexte, choisir, relire, conversationId, fiche, onOpenStudio }: {
  contexte: ContexteVolume;
  choisir: (idu: string | null) => void;
  relire: () => void;
  conversationId: string | null;
  fiche: JarvisDraft | null;
  onOpenStudio?: OuvrirStudio;
}) {
  const contour = useContour(contexte);
  const [ouverture, setOuverture] = useState(false);
  const [demandeParcelle, setDemandeParcelle] = useState(false);
  const [confirmationRapide, setConfirmationRapide] = useState(false);
  const [notice, setNotice] = useState('');
  // Clé de contenu : le calcul (quelques dizaines de ms au pire) ne se relance que si la parcelle, le programme ou les règles changent.
  const cleCalcul = JSON.stringify([contour?.etat === 'ok' ? contour.parcelle.geometry : null, contexte.programme, contexte.regles]);
  const volume = useMemo<VolumePropose | null>(() => {
    const [geometrie, programme, regles] = JSON.parse(cleCalcul) as [GeometrieParcelle | null, ContexteVolume['programme'], ContexteVolume['regles']];
    return geometrie ? calculerVolumeParcelle(geometrie, programme, regles) : null;
  }, [cleCalcul]);
  // Autre parcelle affichée : la confirmation rapide en cours est refermée.
  const cleParcelle = contexte.parcelle.type === 'candidate' ? contexte.parcelle.candidate.idu : contexte.parcelle.type;
  useEffect(() => { setConfirmationRapide(false); }, [cleParcelle]);
  const p = contexte.parcelle;
  if (p.type === 'aucune') return null;

  const idu = p.type === 'confirmee' ? p.idu ?? parcelId(p.retenue.parcel) : p.candidate.idu;
  const raison = p.type === 'confirmee' ? LIBELLES_RAISON.confirmee : LIBELLES_RAISON[p.raison];
  const detailRaison = p.type === 'candidate' ? p.detail : null;
  const autres = contexte.candidates.filter(c => c.idu !== idu);
  const reglesAppliquees = Boolean(volume?.reglesAppliquees.length);

  /** Même parcours que « Voir en 3D » : la fiche tirée du volume est remise à MimmozIAPage.voirEn3D. */
  const ouvrir = async (v: VolumePropose, terrain?: ConfirmedTerrain & { adresse?: string | null }, reference: string | null = idu) => {
    if (!conversationId || !onOpenStudio || ouverture) return;
    const ficheVolume = ficheStudioDepuisVolume(v, { adresse: contexte.adresse, reference, programme: contexte.programme, base: fiche });
    if (!ficheVolume) { setNotice('Aucun volume à transmettre sur cette parcelle.'); return; }
    try { exigerPreparation3D(ficheVolume); } catch (e) { setNotice(messageErreur(e, 'Volume à préciser.')); return; }
    // Pose du volume (centre + orientation du plan) transmise à Studio, sur la parcelle confirmée ou retenue.
    const pose = implantationDepuisVolume(v);
    const base = terrain ?? (p.type === 'confirmee' ? p.retenue : undefined);
    const terrainPose = base && pose ? { ...base, implantation: pose } : base;
    setOuverture(true); setNotice('');
    try {
      const issue = await onOpenStudio(ficheVolume, conversationId, terrainPose);
      setDemandeParcelle(issue === 'parcelle-requise');
      if (issue !== 'parcelle-requise') relire();
    } catch (e) {
      setNotice(messageErreur(e, 'Ouverture de Studio impossible.'));
    } finally { setOuverture(false); }
  };

  /** Parcelle confirmée dans la question minimale : le volume est recalculé SUR elle avant l'envoi. */
  const confirmer = (terrain: ConfirmedTerrain & { adresse: string | null }) => {
    const v = calculerVolumeParcelle(terrain.parcel.geometry as GeometrieParcelle, contexte.programme, contexte.regles);
    if (!v.emprise) { setNotice(v.alertes[0] ?? 'Aucun volume ne tient sur la parcelle confirmée.'); return; }
    void ouvrir(v, terrain, parcelId(terrain.parcel));
  };

  const confirmee = p.type === 'confirmee';
  const avecSelecteur = p.type === 'candidate' && (autres.length > 0 || p.raison === 'manuel');
  return <section className="mzia-volume" aria-label="Parcelle et volume d’étude proposé">
    <header className="mzia-volume__tete">
      <div className="mzia-volume__ligne">
        <span className={`mzia-volume__surtitre${confirmee ? ' is-confirmee' : ''}`}>Parcelle {confirmee ? 'confirmée' : 'à confirmer'}</span>
        <span className={`mzia-volume__badge${reglesAppliquees ? ' is-regles' : ''}`} title={volume?.mentionPlu}>{reglesAppliquees ? <Check size={12} aria-hidden="true" /> : <Info size={12} aria-hidden="true" />}{reglesAppliquees ? 'Règles PLU' : 'Hypothèse'}</span>
      </div>
      <h3><span className="mzia-volume__ref">{referenceLisible(idu)}</span>{contexte.zone ? <span className="mzia-volume__zone">zone {contexte.zone}</span> : null}</h3>
      <p className="mzia-volume__idu"><span className="mzia-volume__sr">Identifiant cadastral </span>{idu}</p>
      <p className="mzia-volume__raison" title={detailRaison ?? undefined}><span>{raison}</span>{detailRaison ? <em> « {detailRaison} »</em> : null}</p>
      {contexte.adresse && <p className="mzia-volume__adresse"><MapPin size={13} aria-hidden="true" />{contexte.adresse}</p>}
      {avecSelecteur && <SelecteurCandidates autres={autres} choisir={choisir} manuel={p.type === 'candidate' && p.raison === 'manuel'}
        ouvertAuDepart={p.type === 'candidate' && p.raison === 'dernier-dossier' && autres.length > 0} />}
    </header>

    {contour?.etat === 'chargement' && <div className="mzia-volume__vue is-attente"><p className="mzia-volume__info" role="status">Chargement du contour cadastral…</p></div>}
    {contour?.etat === 'introuvable' && <p className="mzia-volume__info" role="status">Contour de la parcelle {referenceLisible(idu)} introuvable au cadastre IGN.</p>}
    {contour?.etat === 'erreur' && <p className="mzia-volume__info" role="status">{contour.message}</p>}

    {volume && <>
      {volume.emprise ? <Suspense fallback={<div className="mzia-volume__vue is-attente"><p className="mzia-volume__info">Préparation de la vue 3D…</p></div>}>
        {/* Clé : une nouvelle parcelle ou un nouveau volume repart d'une vue en perspective. */}
        <VolumeParcelle3D key={`${idu}-${volume.niveaux}-${volume.emprise.largeurM}-${volume.emprise.profondeurM}`} volume={volume}
          cartouche={{
            idu, reference: referenceLisible(idu), zone: contexte.zone,
            programme: volume.statut === 'calcule' ? contexte.programme.libelle : null,
            // Même mention que sous la vue 3D (obligatoire, jamais « conforme »).
            mention: volume.mentionPlu,
            precision: `${contexte.pluManquant && contexte.regles.source === 'aucune' ? '(règlement PLU manquant dans le dossier). ' : ''}Volume d’étude pour voir l’ordre de grandeur : il n’est pas présenté comme conforme.`,
          }} />
      </Suspense> : <p className="mzia-volume__info" role="status">{volume.alertes[0]}</p>}
      <p className={`mzia-volume__mention${reglesAppliquees ? ' is-regles' : ''}`}>
        <strong>{volume.mentionPlu}</strong>{contexte.pluManquant && contexte.regles.source === 'aucune' ? ' (règlement PLU manquant dans le dossier)' : ''}. Volume d’étude pour voir l’ordre de grandeur : il n’est pas présenté comme conforme.
      </p>
      <dl className="mzia-volume__cotes">
        <div><dt>Parcelle</dt><dd>{fr(volume.surfaceParcelleM2)} m²</dd></div>
        {volume.emprise && <>
          <div><dt>Emprise</dt><dd>{fr(volume.emprise.surfaceM2)} m²<small>{fr(volume.emprise.largeurM, 1)} × {fr(volume.emprise.profondeurM, 1)} m</small></dd></div>
          <div><dt>Hauteur</dt><dd>{fr(volume.hauteurM)} m<small>{libelleNiveaux(volume.niveaux)} · {volume.niveaux} niveau{volume.niveaux > 1 ? 'x' : ''}</small></dd></div>
          <div><dt>SDP estimée</dt><dd>≈ {fr(volume.sdpM2)} m²<small>≈ {volume.logementsEstimes} logements</small></dd></div>
        </>}
      </dl>
      {volume.statut === 'calcule'
        ? <p className="mzia-volume__programme">Programme : <strong>{contexte.programme.libelle}</strong> ({contexte.programme.origine === 'fiche' ? 'fiche 3D' : 'conversation'}){volume.programmeAtteint === false ? ' — non atteint avec ce volume' : ''}.</p>
        : volume.statut === 'indicatif' && <p className="mzia-volume__programme">Volume indicatif : précisez le programme dans la conversation (ex. « 40 logements ») pour le calculer.</p>}
      {volume.emprise && volume.alertes.length > 0 && <ul className="mzia-volume__alertes">
        {volume.alertes.map(a => <li key={a} className="mzia-volume__alerte"><TriangleAlert size={14} aria-hidden="true" />{a}</li>)}
      </ul>}
      <div className="mzia-volume__plis">
        {(volume.reglesAppliquees.length > 0 || volume.reglesNonAppliquees.length > 0) && <details className="mzia-volume__regle" open={volume.reglesAppliquees.length > 0 ? true : undefined}>
          <summary><span>Règles PLU</span><span className="mzia-volume__compte">{volume.reglesAppliquees.length} appliquée{volume.reglesAppliquees.length > 1 ? 's' : ''}{volume.reglesNonAppliquees.length > 0 ? ` · ${volume.reglesNonAppliquees.length} ignorée${volume.reglesNonAppliquees.length > 1 ? 's' : ''}` : ''}</span><ChevronDown size={16} aria-hidden="true" /></summary>
          {volume.reglesAppliquees.length > 0 && <ul>{volume.reglesAppliquees.map(l => <li key={l}>{l}</li>)}</ul>}
          {volume.reglesNonAppliquees.length > 0 && <><p>Non appliquées ou non trouvées :</p><ul className="is-non">{volume.reglesNonAppliquees.map(l => <li key={l}>{l}</li>)}</ul></>}
        </details>}
        <details className="mzia-volume__regle"><summary><span>Règle de calcul (hypothèses)</span><ChevronDown size={16} aria-hidden="true" /></summary>
          <ul>{volume.hypotheses.map(h => <li key={h}>{h}</li>)}</ul>
          <p>Non vérifiés : côté voie, prospects entre bâtiments, stationnement, servitudes, OAP.</p>
        </details>
      </div>
      {volume.emprise && <small className="mzia-volume__note">Studio reçoit ce volume{p.type === 'confirmee' ? '' : ', après confirmation de la parcelle'} : dimensions, niveaux, position et orientation du plan (appliquées dès que le relief de la parcelle est mesuré).</small>}
      {volume.emprise && conversationId && onOpenStudio && <div className="mzia-volume__pied">
        {confirmationRapide && p.type === 'candidate' && contour?.etat === 'ok'
          ? <ConfirmationParcelleRapide idu={idu} reference={referenceLisible(idu)} surfaceM2={p.candidate.surfaceM2 ?? volume.surfaceParcelleM2}
              zone={contexte.zone} parcelle={contour.parcelle}
              onConfirmer={terrain => { setConfirmationRapide(false); void ouvrir(volume, terrain, idu); }}
              onAutre={() => { setConfirmationRapide(false); setDemandeParcelle(true); }}
              onAnnuler={() => setConfirmationRapide(false)} />
          : <button type="button" className="mzia-volume__studio" disabled={ouverture} aria-busy={ouverture || undefined}
              onClick={() => { if (p.type === 'candidate' && contour?.etat === 'ok') { setDemandeParcelle(false); setConfirmationRapide(true); } else void ouvrir(volume); }}>
              <Box size={17} aria-hidden="true" /> <span>{ouverture ? 'Ouverture de Studio…' : 'Voir en 3D réaliste dans Studio'}</span> <ArrowUpRight size={17} aria-hidden="true" />
            </button>}
      </div>}
    </>}
    {demandeParcelle && conversationId && <ConfirmerParcelle adresseInitiale={contexte.adresse} onConfirmer={confirmer} onAnnuler={() => setDemandeParcelle(false)} />}
    {notice && <p className="mzia-volume__alerte is-notice" role="status">{notice}</p>}
  </section>;
}

/** Normalise pour la recherche : sans accents, sans espaces, en capitales (« an 412 » trouve AN0412). */
const pourRecherche = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toUpperCase();

/**
 * Sélecteur des autres candidates : liste déroulante filtrable (IDU, référence,
 * zone, surface, rang) au lieu d'une suite de pastilles. Motif ARIA combobox +
 * listbox : flèches haut/bas, Entrée pour choisir, Échap pour refermer.
 * Choisir une candidate appelle `choisir(idu)` exactement comme les anciennes pastilles.
 */
function SelecteurCandidates({ autres, choisir, manuel, ouvertAuDepart }: {
  autres: CandidateParcelle[];
  choisir: (idu: string | null) => void;
  manuel: boolean;
  ouvertAuDepart: boolean;
}) {
  const id = useId();
  const [ouvert, setOuvert] = useState(ouvertAuDepart);
  const [requete, setRequete] = useState('');
  const [actif, setActif] = useState(0);
  const declencheur = useRef<HTMLButtonElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const liste = useRef<HTMLDivElement>(null);
  const filtrees = useMemo(() => {
    const q = pourRecherche(requete);
    if (!q) return autres;
    return autres.filter(c => pourRecherche([c.idu, referenceLisible(c.idu), c.zone ?? '', c.surfaceM2 != null ? String(Math.round(c.surfaceM2)) : '', c.rang ? `#${c.rang}` : ''].join(' ')).includes(q));
  }, [autres, requete]);
  useEffect(() => {
    const el = liste.current?.querySelector<HTMLElement>(`[data-index="${actif}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [actif]);
  const fermer = (rendreFocus = true) => { setOuvert(false); setRequete(''); if (rendreFocus) declencheur.current?.focus(); };
  const prendre = (c: CandidateParcelle) => { fermer(false); choisir(c.idu); };
  const clavier = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActif(i => Math.min(filtrees.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActif(i => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActif(0); }
    else if (e.key === 'End') { e.preventDefault(); setActif(Math.max(0, filtrees.length - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = filtrees[actif]; if (c) prendre(c); }
    else if (e.key === 'Escape') { e.preventDefault(); fermer(); }
  };
  const idListe = `${id}-liste`, idOption = (i: number) => `${id}-option-${i}`;

  return <div className={`mzia-volume__autres${ouvert ? ' is-ouvert' : ''}`}>
    <div className="mzia-volume__autres-barre">
      {autres.length > 0 && <button ref={declencheur} type="button" className="mzia-volume__declencheur" data-mzia-candidates=""
        aria-expanded={ouvert} aria-controls={`${id}-panneau`}
        onClick={() => { if (ouvert) fermer(); else { setOuvert(true); window.setTimeout(() => champ.current?.focus(), 0); } }}>
        <span>Autres candidates <span className="mzia-volume__compte">{autres.length}</span></span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>}
      {manuel && <button type="button" className="mzia-volume__auto" onClick={() => choisir(null)}>
        <Undo2 size={14} aria-hidden="true" />Revenir au choix automatique
      </button>}
    </div>
    {ouvert && autres.length > 0 && <div id={`${id}-panneau`} className="mzia-volume__panneau">
      <label className="mzia-volume__recherche">
        <Search size={14} aria-hidden="true" />
        <span className="mzia-volume__sr">Rechercher une parcelle</span>
        <input ref={champ} type="text" role="combobox" aria-expanded="true" aria-controls={idListe} aria-autocomplete="list"
          aria-activedescendant={filtrees[actif] ? idOption(actif) : undefined}
          placeholder="Référence, zone ou surface" value={requete} onChange={e => { setRequete(e.target.value); setActif(0); }} onKeyDown={clavier} />
      </label>
      <div ref={liste} id={idListe} role="listbox" aria-label="Changer de parcelle" className="mzia-volume__liste">
        {filtrees.map((c, i) => <div key={c.idu} id={idOption(i)} data-index={i} role="option" aria-selected={i === actif}
          aria-label={libelleCandidate(c)}
          className={`mzia-volume__option${i === actif ? ' is-actif' : ''}`}
          onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActif(i)} onClick={() => prendre(c)}>
          <span className="mzia-volume__rang">{c.rang ? `#${c.rang}` : ''}</span>
          <span className="mzia-volume__option-ref">{referenceLisible(c.idu)}</span>
          <span className="mzia-volume__option-zone">{c.zone ?? ''}</span>
          <span className="mzia-volume__option-surface">{c.surfaceM2 != null ? `${fr(c.surfaceM2)} m²` : '—'}</span>
        </div>)}
        {filtrees.length === 0 && <p className="mzia-volume__vide">Aucune candidate ne correspond à « {requete} ».</p>}
      </div>
    </div>}
  </div>;
}
