// src/spaces/copilot/studio3d/ConfirmerParcelle.tsx
//
// R2 — LA QUESTION MINIMALE QUAND AUCUNE PARCELLE N'EST CONFIRMÉE.
//
// Dans le dossier du tchat, une seule question : « où est le terrain ? ».
// Le lieu de la fiche (localisation) est cherché tout seul ; la parcelle sous
// le point d'adresse est proposée ; un clic sur « Confirmer et voir en 3D »
// suffit. Sinon : une autre adresse, ou un clic sur la carte cadastrale.
// La parcelle n'est jamais devinée en silence : elle est montrée, puis confirmée.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import ParcelMapSelector from "@/spaces/promoteur/foncier/ParcelMapSelector";
import type { ConfirmedTerrain } from "./terrainCadastre";
import { parcelLabel, type TerrainParcel } from "./parcelFromGps";

interface Adresse { label: string; citycode: string; lat: number; lon: number }
interface AdresseFeature { properties: { label: string; citycode: string }; geometry: { coordinates: [number, number] } }

async function chercherAdresses(q: string, limit: number): Promise<Adresse[]> {
  const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=${limit}&autocomplete=1`, { signal: AbortSignal.timeout(8000) });
  const d = await r.json() as { features?: AdresseFeature[] };
  return (d.features ?? []).map((f) => ({ label: f.properties.label, citycode: f.properties.citycode, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
}

/** Parcelle cadastrale (IGN) sous le point d'adresse ; `null` si aucune. */
async function parcelleSousLePoint(a: Adresse): Promise<TerrainParcel | null> {
  const geom = JSON.stringify({ type: "Point", coordinates: [a.lon, a.lat] });
  const r = await fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?geom=${encodeURIComponent(geom)}&_limit=1`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error("Le cadastre IGN ne répond pas.");
  const d = await r.json() as { features?: TerrainParcel[] };
  const f = d.features?.[0];
  return f && (f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon") ? { ...f, properties: f.properties ?? {} } : null;
}

export function ConfirmerParcelle({ adresseInitiale, onConfirmer, onAnnuler }: {
  adresseInitiale: string | null;
  onConfirmer: (terrain: ConfirmedTerrain & { adresse: string | null }) => void;
  onAnnuler: () => void;
}) {
  const [requete, setRequete] = useState(adresseInitiale ?? "");
  const [suggestions, setSuggestions] = useState<Adresse[]>([]);
  const [adresse, setAdresse] = useState<Adresse | null>(null);
  const [parcelle, setParcelle] = useState<TerrainParcel | null>(null);
  const [carte, setCarte] = useState(false);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const minuteur = useRef<number | null>(null);

  const choisir = useCallback(async (a: Adresse) => {
    setAdresse(a); setRequete(a.label); setSuggestions([]); setParcelle(null); setErreur(null);
    setOccupe("Recherche de la parcelle sous l’adresse…");
    try {
      const p = await parcelleSousLePoint(a);
      setParcelle(p);
      if (!p) { setCarte(true); setErreur("Aucune parcelle sous ce point : cliquez-la sur la carte."); }
    } catch (e) { setCarte(true); setErreur(e instanceof Error ? e.message : String(e)); }
    finally { setOccupe(null); }
  }, []);

  // Le lieu de la fiche est cherché tout seul : la première adresse trouvée est proposée.
  useEffect(() => {
    const q = (adresseInitiale ?? "").trim();
    if (q.length < 3) return;
    let actif = true;
    setOccupe("Recherche du lieu indiqué dans la fiche…");
    void chercherAdresses(q, 1).then((liste) => { if (actif && liste[0]) void choisir(liste[0]); else if (actif) setOccupe(null); })
      .catch(() => { if (actif) { setOccupe(null); setErreur("Adresse introuvable : précisez-la."); } });
    return () => { actif = false; };
  }, [adresseInitiale, choisir]);

  const saisir = (q: string) => {
    setRequete(q);
    if (minuteur.current) window.clearTimeout(minuteur.current);
    if (q.trim().length < 3) { setSuggestions([]); return; }
    minuteur.current = window.setTimeout(() => { void chercherAdresses(q, 5).then(setSuggestions).catch(() => setSuggestions([])); }, 250);
  };

  const confirmer = () => {
    if (!parcelle || !adresse) return;
    onConfirmer({ parcel: parcelle, point: { lat: adresse.lat, lon: adresse.lon }, adresse: adresse.label });
  };
  const surface = typeof parcelle?.properties.contenance === "number" ? ` · ${Math.round(parcelle.properties.contenance)} m²` : "";

  return (
    <div className="jarvis-dossier__parcelle" role="group" aria-label="Où se trouve le terrain ?">
      <div className="jarvis-dossier__parcelle-title"><MapPin size={15} /> Où se trouve le terrain ?</div>
      <input value={requete} onChange={(e) => saisir(e.target.value)} placeholder="Adresse du terrain…" aria-label="Adresse du terrain" />
      {suggestions.length > 0 && <div className="jarvis-dossier__suggestions">
        {suggestions.map((s) => <button type="button" key={`${s.label}-${s.lat}`} onClick={() => void choisir(s)}>{s.label}</button>)}
      </div>}
      {occupe && <p role="status"><Loader2 size={13} className="studio-integre__spin" /> {occupe}</p>}
      {parcelle && !carte && <p className="jarvis-dossier__parcelle-found">Parcelle <strong>{parcelLabel(parcelle)}</strong>{surface} — {adresse?.label}</p>}
      {erreur && <p role="status" className="jarvis-dossier__parcelle-error">{erreur}</p>}
      {carte && adresse && <ParcelMapSelector communeInsee={adresse.citycode} selectedIds={parcelle ? [String(parcelle.properties.idu ?? parcelle.properties.id ?? "")] : []}
        selectedParcels={[]} initialCenter={{ lat: adresse.lat, lon: adresse.lon }} initialZoom={18} heightPx={240}
        onToggleParcel={(_id, feature) => { if (feature?.geometry) { setParcelle({ type: "Feature", geometry: feature.geometry, properties: { ...(feature.properties ?? {}), idu: _id } } as TerrainParcel); setErreur(null); } }} />}
      <div className="jarvis-dossier__actions">
        <button type="button" className="is-primary" disabled={!parcelle || !!occupe} onClick={confirmer}>Confirmer et voir en 3D</button>
        {adresse && !carte && <button type="button" onClick={() => setCarte(true)}>Choisir sur la carte</button>}
        <button type="button" onClick={onAnnuler}>Annuler</button>
      </div>
    </div>
  );
}
