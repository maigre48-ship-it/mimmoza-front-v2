// src/spaces/copilot/studio3d/EtapesTerrainProgramme.tsx
// =============================================================================
// VIS-20 (23/11/2026) — « Le parcours ne quitte jamais le chat ».
//   · ReglageTerrain   : étape 1 — champ « adresse ou numéro(s) de parcelle(s) » (envoyé à Mimmo) et, dans le panneau
//                        Espace 3D, la carte cadastrale existante (ParcelMapSelector, celle de la page Foncier et de
//                        ConfirmerParcelle) en sélection multiple : plusieurs parcelles = assiette, confirmée par message.
//   · ReglageProgramme : étape 2 — logements, niveaux, typologies pré-remplis depuis la demande → Mimmo propose la
//                        mission de conception ICI (jamais /promoteur/programmation).
// Logique pure et testée : src/lib/studio/parcoursTerrain.ts.
// =============================================================================
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Loader2, MapPin, Send } from 'lucide-react';
import {
  basculerParcelleAssiette, lireTypologies, messageAssietteCarte, messageProgrammeParcours, messageTerrainParcours,
  programmeDeLaDemande, requeteCarte, resumeAssiette, type ParcelleCarte,
} from '@/lib/studio/parcoursTerrain';
import { parcelleRetenue } from './parcelleConfirmee';

// Carte chargée à la demande (Leaflet) : rien de plus à charger tant que l'utilisateur ne l'ouvre pas.
const ParcelMapSelector = lazy(() => import('@/spaces/promoteur/foncier/ParcelMapSelector'));

interface CentreCarte { insee: string; lat: number; lon: number }

const STYLE_BLOC = { padding: '0 10px 10px 41px', display: 'grid', gap: 6, fontSize: 12.5 } as const;
const STYLE_LIGNE = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } as const;
const STYLE_CHAMP = { flex: '1 1 180px', minWidth: 0, border: '1px solid #ddd6fe', borderRadius: 8, padding: '6px 9px', fontSize: 12.5 } as const;
const STYLE_BOUTON = { border: '1px solid #ddd6fe', borderRadius: 999, background: '#fff', color: '#4c1d95', padding: '4px 11px', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 } as const;
const STYLE_PRIMAIRE = { ...STYLE_BOUTON, background: '#6d5dfc', borderColor: '#6d5dfc', color: '#fff', fontWeight: 600 } as const;
const STYLE_NOTE = { margin: 0, color: '#64748b', fontSize: 12 } as const;

/** Centre de la carte : saisie (IDU complet → parcelle IGN ; adresse → BAN), sinon la parcelle retenue de la conversation. */
async function localiser(saisie: string, conversationId: string | null): Promise<CentreCarte | null> {
  const r = requeteCarte(saisie);
  if (r?.genre === 'idu') {
    const u = `https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${r.insee}&section=${encodeURIComponent(r.section)}&numero=${r.numero}&_limit=1`;
    const d = await (await fetch(u, { signal: AbortSignal.timeout(12000) })).json() as { features?: { geometry?: { type: string; coordinates: unknown } }[] };
    const g = d.features?.[0]?.geometry;
    const anneau = g?.type === 'Polygon' ? (g.coordinates as number[][][])[0] : g?.type === 'MultiPolygon' ? (g.coordinates as number[][][][])[0]?.[0] : null;
    if (anneau?.length) {
      const lon = anneau.reduce((a, p) => a + p[0], 0) / anneau.length;
      const lat = anneau.reduce((a, p) => a + p[1], 0) / anneau.length;
      return { insee: r.insee, lat, lon };
    }
  }
  if (r?.genre === 'adresse') {
    const d = await (await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(r.q)}&limit=1`, { signal: AbortSignal.timeout(8000) })).json() as
      { features?: { properties: { citycode: string }; geometry: { coordinates: [number, number] } }[] };
    const f = d.features?.[0];
    if (f) return { insee: f.properties.citycode, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
  }
  const retenue = conversationId ? parcelleRetenue(conversationId) : null;
  const insee = retenue && typeof retenue.parcel.properties.code_insee === 'string' ? retenue.parcel.properties.code_insee : null;
  return retenue && insee ? { insee, lat: retenue.point.lat, lon: retenue.point.lon } : null;
}

export function ReglageTerrain({ onSend, conversationId, carteDisponible, onOuvrirCarte, fait, ouvert, carteOuverte }: {
  onSend?: (texte: string) => void;
  conversationId: string | null;
  /** Panneau Espace 3D : la carte s'affiche ici. Carte du chat : « Choisir sur la carte » ouvre le panneau. */
  carteDisponible: boolean;
  onOuvrirCarte?: () => void;
  /** Étape déjà faite : le champ reste replié derrière « Changer de terrain ». */
  fait: boolean;
  ouvert?: boolean;
  carteOuverte?: boolean;
}) {
  const [deplie, setDeplie] = useState(!fait || !!ouvert);
  const [saisie, setSaisie] = useState('');
  const [centre, setCentre] = useState<CentreCarte | null>(null);
  const [carte, setCarte] = useState(false);
  const [selection, setSelection] = useState<ParcelleCarte[]>([]);
  const [occupe, setOccupe] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { if (ouvert) setDeplie(true); }, [ouvert]);
  // 23/11 : étape devenue FAITE (données chargées après l'affichage) → le champ se replie (« Changer de… »).
  useEffect(() => { if (fait && !ouvert) setDeplie(false); }, [fait]); // eslint-disable-line react-hooks/exhaustive-deps

  const ouvrirCarte = async () => {
    if (!carteDisponible) { onOuvrirCarte?.(); return; }
    setNote(null); setOccupe(true);
    try {
      const c = await localiser(saisie, conversationId);
      if (!c) { setNote('Tapez d’abord une adresse (ou un numéro de parcelle complet, ex. 64065000AI0001) pour centrer la carte.'); return; }
      setCentre(c); setCarte(true);
    } catch { setNote('Carte cadastrale indisponible pour l’instant : écrivez l’adresse ou les parcelles et envoyez-les à Mimmo.'); }
    finally { setOccupe(false); }
  };
  // Commande « Choisir sur la carte » venue de la carte du chat : la carte s'ouvre dès que le panneau est là.
  useEffect(() => { if (carteOuverte && carteDisponible) { setDeplie(true); void ouvrirCarte(); } }, [carteOuverte]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!onSend) return null;
  if (!deplie) return <div style={STYLE_BLOC}><div style={STYLE_LIGNE}><button type="button" style={STYLE_BOUTON} onClick={() => setDeplie(true)}>Changer de terrain</button></div></div>;
  const message = messageTerrainParcours(saisie);
  const envoyer = () => { if (message) { onSend(message); setSaisie(''); } };
  const assiette = resumeAssiette(selection);
  const confirmerCarte = () => { const m = messageAssietteCarte(selection); if (m) { onSend(m); setCarte(false); setSelection([]); } };

  return <div style={STYLE_BLOC} role="group" aria-label="Désigner le terrain">
    <div style={STYLE_LIGNE}>
      <input style={STYLE_CHAMP} value={saisie} onChange={(e) => setSaisie(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); envoyer(); } }}
        placeholder="Adresse, ou parcelle(s) : 64065000AI0001 et 2" aria-label="Adresse ou numéro(s) de parcelle(s) du terrain" />
      <button type="button" style={STYLE_PRIMAIRE} disabled={!message} onClick={envoyer}><Send size={12} aria-hidden="true" /> Envoyer à Mimmo</button>
      <button type="button" style={STYLE_BOUTON} disabled={occupe} onClick={() => void ouvrirCarte()}>
        {occupe ? <Loader2 size={12} className="mz-parcours__tourne" aria-hidden="true" /> : <MapPin size={12} aria-hidden="true" />} Choisir sur la carte
      </button>
    </div>
    <p style={STYLE_NOTE}>Plusieurs parcelles = une assiette. Mimmo les retrouve, vous les fait confirmer ici, puis passe à l’étape 2.</p>
    {note && <p style={STYLE_NOTE} role="status">{note}</p>}
    {carte && centre && <div style={{ display: 'grid', gap: 6 }}>
      <Suspense fallback={<p style={STYLE_NOTE} role="status">Chargement de la carte cadastrale…</p>}><ParcelMapSelector communeInsee={centre.insee} selectedIds={selection.map((p) => p.id)} selectedParcels={[]}
        initialCenter={{ lat: centre.lat, lon: centre.lon }} initialZoom={18} heightPx={260}
        onToggleParcel={(id, feature, area) => setSelection((s) => basculerParcelleAssiette(s, {
          id: String(id), surface_m2: area ?? (typeof feature?.properties?.contenance === 'number' ? feature.properties.contenance : null),
        }))} /></Suspense>
      <p style={{ ...STYLE_NOTE, color: '#334155' }}>Cliquez une ou plusieurs parcelles : <strong>{assiette.libelle}</strong></p>
      <div style={STYLE_LIGNE}>
        <button type="button" style={STYLE_PRIMAIRE} disabled={!selection.length} onClick={confirmerCarte}>Confirmer ce terrain</button>
        <button type="button" style={STYLE_BOUTON} onClick={() => { setCarte(false); setSelection([]); }}>Fermer la carte</button>
      </div>
    </div>}
  </div>;
}

export function ReglageProgramme({ onSend, textesUtilisateur, fait, ouvert }: {
  onSend?: (texte: string) => void;
  textesUtilisateur: readonly string[];
  fait: boolean;
  ouvert?: boolean;
}) {
  const initial = useMemo(() => programmeDeLaDemande(textesUtilisateur), [textesUtilisateur]);
  const [deplie, setDeplie] = useState(!fait || !!ouvert);
  const [logements, setLogements] = useState(initial.logements ? String(initial.logements) : '');
  const [niveaux, setNiveaux] = useState(initial.niveaux ? String(initial.niveaux) : '');
  const [typologies, setTypologies] = useState(initial.typologies.join(', '));
  const [touche, setTouche] = useState(false);
  useEffect(() => { if (ouvert) setDeplie(true); }, [ouvert]);
  // 23/11 : étape devenue FAITE (données chargées après l'affichage) → le champ se replie (« Changer de… »).
  useEffect(() => { if (fait && !ouvert) setDeplie(false); }, [fait]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pré-remplissage suivi tant que l'utilisateur n'a rien modifié (la demande peut arriver après l'affichage).
  useEffect(() => {
    if (touche) return;
    setLogements(initial.logements ? String(initial.logements) : '');
    setNiveaux(initial.niveaux ? String(initial.niveaux) : '');
    setTypologies(initial.typologies.join(', '));
  }, [initial, touche]);
  if (!onSend) return null;
  if (!deplie) return <div style={STYLE_BLOC}><div style={STYLE_LIGNE}><button type="button" style={STYLE_BOUTON} onClick={() => setDeplie(true)}>Modifier le programme</button></div></div>;
  const nombre = (v: string) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
  const envoyer = () => onSend(messageProgrammeParcours({ logements: nombre(logements), niveaux: nombre(niveaux), typologies: lireTypologies(typologies) }));
  const champ = (libelle: string, valeur: string, maj: (v: string) => void, largeur: number, aide: string) => <label style={{ display: 'grid', gap: 2, fontSize: 11.5, color: '#475569' }}>
    {libelle}<input style={{ ...STYLE_CHAMP, flex: 'none', width: largeur }} value={valeur} placeholder={aide} aria-label={libelle}
      onChange={(e) => { setTouche(true); maj(e.target.value); }} />
  </label>;
  return <div style={STYLE_BLOC} role="group" aria-label="Programme du projet">
    <div style={{ ...STYLE_LIGNE, alignItems: 'flex-end' }}>
      {champ('Logements', logements, setLogements, 78, 'ex. 28')}
      {champ('Niveaux (RDC compris)', niveaux, setNiveaux, 78, 'ex. 5')}
      {champ('Typologies', typologies, setTypologies, 120, 'ex. T2, T3')}
      <button type="button" style={STYLE_PRIMAIRE} onClick={envoyer}><Send size={12} aria-hidden="true" /> Proposer la mission</button>
    </div>
    <p style={STYLE_NOTE}>Pré-rempli depuis votre demande. Mimmo vous propose la mission de conception (devis) ici, dans le chat.</p>
  </div>;
}
