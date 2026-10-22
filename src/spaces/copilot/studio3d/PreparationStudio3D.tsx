// src/spaces/copilot/studio3d/PreparationStudio3D.tsx
//
// CH2 — PRÉPARER LA PRÉVISUALISATION 3D DEPUIS LE TCHAT MIMMOZIA.
//
// Tout ce dont le Studio 3D a besoin, dans une seule fenêtre du tchat :
//   1. l'adresse, puis la ou les parcelles cliquées sur la carte cadastrale ;
//   2. les photos de façade (le studio reproduit le bâtiment) ;
//   3. les plans (images ou PDF, déposés dans l'étape Plans du studio) ;
//   4. les photos 360° prises autour de la parcelle (fond de la scène) ;
//   5. une description libre (« immeuble R+5, toiture zinc… »).
// « Générer la prévisualisation 3D » envoie le tout au studio, qui construit
// le bâtiment et ouvre son tchat en bas à droite pour la suite.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Camera, FileText, Image as ImageIcon, Loader2, MapPin, Trash2, X } from "lucide-react";
import ParcelMapSelector from "@/spaces/promoteur/foncier/ParcelMapSelector";
import { adresseStudio3D, chargerReliefMesure, ouvrirOngletStudio3D, parcellesSansGeometrie } from "@/spaces/promoteur/shared/ouvrirStudio3D";
import { adressesSignees, televerserPanorama, type Panorama360 } from "@/spaces/promoteur/shared/environnement360";
import { signerTransferts, televerserTransfert, TYPES_FACADE, TYPES_PLAN, type FichierTransfert } from "./transfertStudio";
import type { JarvisStoredFile } from './jarvisFiles';
import type { JarvisStudioBuilding, JarvisSegment } from './jarvisDraft';
import type { ConfirmedTerrain } from './terrainCadastre';
import { parcelId, parcelLabel } from './parcelFromGps';
import './PreparationStudio3D.css';
import { messageErreur } from "@/components/ui/messageErreur";

interface Adresse { label: string; citycode: string; lat: number; lon: number }
interface Parcelle { id: string; feature?: unknown; area_m2?: number | null }
interface AdresseFeature { properties: { label: string; citycode: string }; geometry: { coordinates: [number, number] } }

const carte: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, marginTop: 10, background: "#fff" };
const titre: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13, color: "#0f172a" };
const aide: React.CSSProperties = { fontSize: 12, color: "#64748b", margin: "4px 0 8px" };

function Liste({ items, onRetirer }: { items: { cle: string; nom: string }[]; onRetirer: (cle: string) => void }) {
  return (
    <>
      {items.map((it) => (
        <div key={it.cle} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "3px 0" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.nom}</span>
          <button type="button" onClick={() => onRetirer(it.cle)} title="Retirer" style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626" }}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </>
  );
}

export function PreparationStudio3D({ ouvert, onFermer, briefInitial, fichiersInitiaux, adresseInitiale, fichiersConserves, commandeArchitecture, compositionArchitecture, volumeAiles, terrainInitial, bridgeSessionId, conversationId, onStudioStarted }: {
  ouvert: boolean; onFermer: () => void; briefInitial?: string; adresseInitiale?: string; commandeArchitecture?: string | null; compositionArchitecture?: JarvisStudioBuilding[] | null; volumeAiles?: JarvisSegment[] | null;
  bridgeSessionId?: string; conversationId?: string | null; onStudioStarted?: (sessionId: string) => void;
  /** Parcelle cadastrale confirmée depuis le parcours photo/GPS de Jarvis. */
  terrainInitial?: ConfirmedTerrain;
  /** Pièces jointes du tchat : images → photos de façade, PDF → plans. */
  fichiersInitiaux?: File[];
  /** Références déjà stockées dans le dossier Jarvis ; les images doivent être classées par l'utilisateur. */
  fichiersConserves?: JarvisStoredFile[];
}) {
  // Une session = un dossier de transfert ; recréée à chaque ouverture.
  const session = useMemo(() => `chat-${crypto.randomUUID()}`, [ouvert]); // eslint-disable-line react-hooks/exhaustive-deps
  const [requete, setRequete] = useState(adresseInitiale ?? "");
  const [suggestions, setSuggestions] = useState<Adresse[]>([]);
  const [adresse, setAdresse] = useState<Adresse | null>(null);
  const [parcelles, setParcelles] = useState<Parcelle[]>(() => terrainInitial ? [{
    id: parcelId(terrainInitial.parcel), feature: terrainInitial.parcel,
    area_m2: typeof terrainInitial.parcel.properties.contenance === 'number' ? terrainInitial.parcel.properties.contenance : null,
  }] : []);
  const [facades, setFacades] = useState<FichierTransfert[]>([]);
  const [plans, setPlans] = useState<FichierTransfert[]>(() => fichiersConserves?.filter(f => f.kind === 'pdf') ?? []);
  const [aClasser, setAClasser] = useState<JarvisStoredFile[]>(() => fichiersConserves?.filter(f => f.kind === 'image') ?? []);
  const [panoramas, setPanoramas] = useState<Panorama360[]>([]);
  const [brief, setBrief] = useState(briefInitial ?? "");
  const [commande, setCommande] = useState(commandeArchitecture ?? '');
  const [composition, setComposition] = useState<JarvisStudioBuilding[]>(() => compositionArchitecture ?? []);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const minuteur = useRef<number | null>(null);


  const chercher = useCallback((q: string) => {
    setRequete(q);
    if (minuteur.current) window.clearTimeout(minuteur.current);
    if (q.trim().length < 3) { setSuggestions([]); return; }
    minuteur.current = window.setTimeout(async () => {
      try {
        const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=6&autocomplete=1`);
        const d = await r.json() as { features?: AdresseFeature[] };
        setSuggestions((d?.features ?? []).map((f) => ({
          label: f.properties.label, citycode: f.properties.citycode,
          lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
        })));
      } catch { setSuggestions([]); }
    }, 250);
  }, []);

  const basculerParcelle = useCallback((id: string, feature: unknown, area_m2: number | null) => {
    setParcelles((avant) => (avant.some((p) => p.id === id) ? avant.filter((p) => p.id !== id) : [...avant, { id, feature, area_m2 }]));
  }, []);

  const deposer = async (fichiers: FileList | null, genre: "facade" | "plan" | "360") => {
    const liste = Array.from(fichiers ?? []);
    if (liste.length === 0) return;
    const refus: string[] = [];
    let remaining = genre === 'facade' ? 4 - facades.length : genre === 'plan' ? 6 - plans.length : 5 - panoramas.length;
    for (const f of liste) {
      if (remaining <= 0) { refus.push(`${f.name} : limite de fichiers atteinte.`); continue; }
      setOccupe(`Envoi de ${f.name}…`);
      try {
        if (genre === "facade") { const r = await televerserTransfert(session, f, TYPES_FACADE); setFacades((a) => [...a, r]); }
        else if (genre === "plan") { const r = await televerserTransfert(session, f, TYPES_PLAN); setPlans((a) => [...a, r]); }
        else { const r = await televerserPanorama(session, f); setPanoramas((a) => [...a, r]); }
        remaining--;
      } catch (e) { refus.push(messageErreur(e, "Préparation du Studio 3D impossible.")); }
    }
    setOccupe(null);
    setMessage(refus.length > 0 ? `Refusé : ${refus.join(" · ")}` : null);
  };

  // Le composant est remonté pour chaque ouverture ; les fichiers initiaux ne sont chargés qu'une fois.
  const initiauxTraites = useRef<File[] | undefined>(undefined);
  const panoramaInitialTraite = useRef<File | undefined>(undefined);
  useEffect(() => {
    const file = terrainInitial?.panorama;
    if (!ouvert || !file || panoramaInitialTraite.current === file) return;
    panoramaInitialTraite.current = file;
    setOccupe(`Envoi de ${file.name} dans votre espace privé Studio…`);
    void televerserPanorama(session, file)
      .then(item => setPanoramas(items => [...items, item]))
      .catch(cause => setMessage(cause instanceof Error ? cause.message : 'Envoi du panorama impossible.'))
      .finally(() => setOccupe(null));
  }, [ouvert, session, terrainInitial]);
  useEffect(() => {
    if (!ouvert || !fichiersInitiaux || fichiersInitiaux.length === 0 || initiauxTraites.current === fichiersInitiaux) return;
    initiauxTraites.current = fichiersInitiaux;
    const dt = (liste: File[]) => { const d = new DataTransfer(); liste.forEach((f) => d.items.add(f)); return d.files; };
    const images = fichiersInitiaux.filter((f) => TYPES_FACADE.includes(f.type));
    const pdf = fichiersInitiaux.filter((f) => f.type === "application/pdf");
    void (async () => {
      if (images.length > 0) await deposer(dt(images), "facade");
      if (pdf.length > 0) await deposer(dt(pdf), "plan");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert, fichiersInitiaux]);

  const pret = (parcelles.some((p) => p.feature) || facades.length > 0 || plans.length > 0 || brief.trim().length > 0)
    && aClasser.length === 0 && (compositionArchitecture?.length ? composition.every(item => item.commande.trim()) : commandeArchitecture === undefined || commande.trim().length > 0);

  const classer = (file: JarvisStoredFile, genre: 'facade' | 'plan' | 'ignore') => {
    if (genre === 'facade' && facades.length >= 4) { setMessage('Le Studio accepte au plus 4 photos de façade.'); return; }
    if (genre === 'plan' && plans.length >= 6) { setMessage('Le Studio accepte au plus 6 plans.'); return; }
    if (genre === 'facade') setFacades(items => [...items, file]);
    if (genre === 'plan') setPlans(items => [...items, file]);
    setAClasser(items => items.filter(item => item.path !== file.path));
    setMessage(null);
  };

  const generer = async () => {
    // CAD04 — une parcelle sans géométrie est signalée avant d'ouvrir un onglet.
    const manquantes = parcellesSansGeometrie(parcelles);
    if (manquantes.length > 0) {
      setMessage(`Géométrie cadastrale absente pour ${manquantes.join(", ")} : retirez-la ou sélectionnez-la à nouveau sur la carte.`);
      return;
    }
    try {
      setMessage(null);
      if (bridgeSessionId && conversationId) onStudioStarted?.(bridgeSessionId);
      setOccupe(parcelles.length > 0 ? "Mesure du relief et préparation de l’envoi au Studio 3D…" : "Préparation de l’envoi au Studio 3D…");
      await ouvrirOngletStudio3D(async () => {
        const reliefConfirme = terrainInitial?.terrainData && parcelles.length === 1 && parcelles[0]?.id === parcelId(terrainInitial.parcel)
          ? terrainInitial.terrainData : null;
        const [fac, pla, pan, terrain] = await Promise.all([
          signerTransferts(facades), signerTransferts(plans), adressesSignees(panoramas),
          parcelles.length > 0 ? reliefConfirme ?? chargerReliefMesure(parcelles, adresse?.citycode ?? (terrainInitial?.parcel.properties.code_insee as string | undefined) ?? null) : Promise.resolve(null),
        ]);
        return adresseStudio3D(
          parcelles, adresse?.citycode ?? (terrainInitial?.parcel.properties.code_insee as string | undefined) ?? null, adresse?.label ?? null,
          adresse ? { lat: adresse.lat, lon: adresse.lon } : null, pan,
          { brief, commandeArchitecture: commandeArchitecture === undefined ? undefined : commande, compositionArchitecture: composition.length ? composition : undefined, volumeAiles: volumeAiles ?? undefined, facades: fac, plans: pla,
            implantation: reliefConfirme ? terrainInitial?.implantation : undefined,
            accesses: reliefConfirme ? terrainInitial?.accesses : undefined,
            ...(bridgeSessionId && conversationId ? { bridgeSessionId, conversationId, openerOrigin: window.location.origin } : {}) }, terrain,
        );
      });
      setMessage("Le Studio 3D s’ouvre dans un nouvel onglet : il importe le terrain et son relief et affiche la scène en 3D dans le navigateur.");
    } catch (e) {
      setMessage(messageErreur(e, "Préparation du Studio 3D impossible."));
    } finally {
      setOccupe(null);
    }
  };

  if (!ouvert) return null;
  return (
    <div role="dialog" aria-label="Prévisualisation 3D" className="jarvis-preparation" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.45)", display: "flex", justifyContent: "center", alignItems: "flex-start", overflowY: "auto", padding: "4vh 12px" }}>
      <div className="jarvis-preparation__card" style={{ width: "min(860px, 100%)", background: "#f8fafc", borderRadius: 16, padding: 18, boxShadow: "0 24px 60px rgba(0,0,0,.35)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Box size={20} color="#6b4ce5" />
          <div className="jarvis-preparation__title" style={{ fontSize: 17, fontWeight: 800, color: "#0f172a" }}>Transfert vers Studio 3D</div>
          <button type="button" className="jarvis-preparation__close" onClick={onFermer} aria-label="Fermer" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>
        <p className="jarvis-preparation__intro" style={aide}>Vérifiez le lieu, classez les pièces jointes et relisez la description. Le Studio 3D importera ces éléments dans un nouvel onglet.</p>
        <div className="jarvis-preparation__stages" aria-label="Étapes de préparation"><span>01 · LIEU</span><span>02 · RÉFÉRENCES</span><span>03 · BRIEF</span><span>04 · STUDIO</span></div>

        {aClasser.length > 0 && <div style={{ ...carte, borderColor: '#a9e1c0', background: '#f2fbf6' }}>
          <div style={titre}>Pièces de Mimmo à classer ({aClasser.length})</div>
          <p style={aide}>Indiquez le rôle de chaque image avant l’envoi. Les PDF sont déjà rangés dans les plans.</p>
          {aClasser.map(file => <div key={file.path} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid #dceee4', fontSize: 12 }}>
            <span style={{ flex: '1 1 160px', overflowWrap: 'anywhere' }}>{file.nom}</span>
            <button type="button" onClick={() => classer(file, 'facade')}>Photo de façade</button>
            <button type="button" onClick={() => classer(file, 'plan')}>Plan</button>
            <button type="button" onClick={() => classer(file, 'ignore')}>Ne pas envoyer</button>
          </div>)}
        </div>}

        <div style={carte}>
          <div style={titre}><MapPin size={15} /> 1. Parcelle(s)</div>
          {terrainInitial && parcelles.some(p => p.id === parcelId(terrainInitial.parcel)) && <p style={{ ...aide, color: '#20845d' }}>
            Parcelle {parcelLabel(terrainInitial.parcel)} confirmée depuis Mimmo. Sa géométrie{terrainInitial.terrainData ? ` et son relief mesuré (${terrainInitial.terrainData.altitudeMin.toFixed(1)} à ${terrainInitial.terrainData.altitudeMax.toFixed(1)} m)` : ''} seront transmis à Studio. La photo ordinaire reste sur votre appareil ; si vous avez choisi une photo 360°, elle est enregistrée dans votre espace privé pour servir de fond à la scène.
          </p>}
          <input value={requete} onChange={(e) => chercher(e.target.value)} placeholder="Adresse du terrain…"
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 8, marginTop: 8 }} />
          {adresseInitiale && !adresse && <p style={aide}>Lieu proposé par Mimmo : <button type="button" onClick={() => chercher(requete)}>Rechercher cette adresse</button> puis sélectionnez le résultat correspondant pour afficher les parcelles. Le texte du dossier seul ne confirme pas une parcelle.</p>}
          {suggestions.length > 0 && (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, marginTop: 4, background: "#fff" }}>
              {suggestions.map((s) => (
                <button type="button" key={`${s.label}-${s.lat}`} onClick={() => { setAdresse(s); setRequete(s.label); setSuggestions([]); setParcelles([]); }}
                  style={{ display: 'block', width: '100%', padding: "8px 10px", cursor: "pointer", fontSize: 13, textAlign: 'left', background: 'transparent', border: 0, color: '#0f172a' }}>{s.label}</button>
              ))}
            </div>
          )}
          {adresse && (
            <>
              <p style={aide}>Cliquez une ou plusieurs parcelles. Elles seront fusionnées si elles se touchent.</p>
              <ParcelMapSelector
                communeInsee={adresse.citycode}
                selectedIds={parcelles.map((p) => p.id)}
                selectedParcels={parcelles.map((p) => ({ id: p.id, feature: p.feature, area_m2: p.area_m2 ?? null }))}
                onToggleParcel={basculerParcelle}
                initialCenter={{ lat: adresse.lat, lon: adresse.lon }}
                initialZoom={18}
                heightPx={320}
              />
            </>
          )}
          <Liste items={parcelles.map((p) => ({ cle: p.id, nom: `${p.id}${p.area_m2 ? ` — ${Math.round(p.area_m2)} m²` : ""}` }))}
            onRetirer={(id) => setParcelles((a) => a.filter((p) => p.id !== id))} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          <div style={carte}>
            <div style={titre}><ImageIcon size={15} /> 2. Photos de façade</div>
            <p style={aide}>Transmises au studio comme références (4 photos au plus, JPEG/PNG/WebP) ; leur analyse par IA n’est pas encore disponible.</p>
            <input type="file" accept={TYPES_FACADE.join(",")} multiple disabled={!!occupe} onChange={(e) => { void deposer(e.target.files, "facade"); e.target.value = ""; }} />
            <Liste items={facades.map((f) => ({ cle: f.path, nom: f.nom }))} onRetirer={(k) => setFacades((a) => a.filter((f) => f.path !== k))} />
          </div>
          <div style={carte}>
            <div style={titre}><FileText size={15} /> 3. Plans</div>
            <p style={aide}>Images ou PDF ; ils arrivent dans l’étape Plans du studio.</p>
            <input type="file" accept={TYPES_PLAN.join(",")} multiple disabled={!!occupe} onChange={(e) => { void deposer(e.target.files, "plan"); e.target.value = ""; }} />
            <Liste items={plans.map((f) => ({ cle: f.path, nom: f.nom }))} onRetirer={(k) => setPlans((a) => a.filter((f) => f.path !== k))} />
          </div>
          <div style={carte}>
            <div style={titre}><Camera size={15} /> 4. Photos 360°</div>
            <p style={aide}>Prises depuis le trottoir (mode Photo Sphere / 360°) : le fond de la scène.</p>
            <input type="file" accept="image/jpeg,image/png" multiple disabled={!!occupe} onChange={(e) => { void deposer(e.target.files, "360"); e.target.value = ""; }} />
            <Liste items={panoramas.map((p) => ({ cle: p.path, nom: p.nom }))} onRetirer={(k) => setPanoramas((a) => a.filter((p) => p.path !== k))} />
          </div>
        </div>

        <div style={carte}>
          <div style={titre}>5. Description (facultatif)</div>
          <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3}
            placeholder="Ex. : immeuble collectif R+5, 24 logements, toiture zinc, rez-de-chaussée commercial…"
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 8, marginTop: 8, resize: "vertical" }} />
        </div>

        {commandeArchitecture !== undefined && <div style={{ ...carte, borderColor: '#e2dafa' }}>
          <div style={titre}>6. Commande architecturale</div>
          <p style={aide}>Cette phrase crée le gabarit dans Studio avec les choix de façade, de toiture et d’ouvertures reconnus dans le dossier. Le nombre de logements reste un objectif de programme ; les autres contraintes demandent une vérification dans Studio.</p>
          <textarea value={commande} onChange={e => setCommande(e.target.value)} rows={2} maxLength={1000}
            placeholder="Ex. : Crée un immeuble collectif R+5 de 30 m sur 14 m"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, marginTop: 8, resize: 'vertical' }} />
          {!commande.trim() && <p role="status" style={{ color: '#b45309', fontSize: 12 }}>Précisez le type de bâtiment à créer pour continuer.</p>}
        </div>}
        {compositionArchitecture && compositionArchitecture.length > 0 && <div style={{ ...carte, borderColor: '#e2dafa' }}>
          <div style={titre}>6. Composition des bâtiments</div>
          <p style={aide}>Studio créera chaque bâtiment avec sa forme, ses dimensions et sa hauteur. L’écart est une implantation indicative, à ajuster sur la parcelle.</p>
          {composition.map((building, index) => <label key={building.name} style={{ display: 'block', marginTop: 8, fontSize: 12, fontWeight: 700 }}>
            {building.name}
            <textarea value={building.commande} onChange={event => setComposition(items => items.map((item, i) => i === index ? { ...item, commande: event.target.value } : item))}
              rows={2} maxLength={1000} style={{ width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, marginTop: 4, resize: 'vertical' }} />
          </label>)}
        </div>}
        {volumeAiles && <div style={{ ...carte, borderColor: '#e2dafa' }}>
          <div style={titre}>Un bâtiment, des volumes en relief</div>
          <p style={aide}>Studio conservera les décrochés de façade, les retraits et les hauteurs de chaque partie dans un seul bâtiment.</p>
          {volumeAiles.map(part => <p key={part.name} style={{ fontSize: 12, margin: '4px 0' }}>{part.name} : {part.largeurM} × {part.profondeurM} m, {part.fromLevelIndex ? `R+${part.fromLevelIndex} à ` : ''}R+{part.niveaux - 1}{part.retraitM ? `, retrait ${part.retraitM} m` : ''}</p>)}
        </div>}

        {(occupe || message) && (
          <p style={{ fontSize: 13, color: "#334155", marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
            {occupe && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}{occupe ?? message}
          </p>
        )}
        <button type="button" className="jarvis-preparation__submit" disabled={!pret || !!occupe} onClick={() => void generer()}
          style={{ marginTop: 12, width: "100%", padding: "12px 14px", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 15,
            cursor: pret && !occupe ? "pointer" : "not-allowed", background: pret ? "#6d5dfc" : "#cbd5e1", color: "#fff" }}>
          {aClasser.length > 0 ? `Classer ${aClasser.length} image${aClasser.length > 1 ? 's' : ''} pour continuer` : commandeArchitecture !== undefined && !commande.trim() ? 'Préciser le bâtiment pour continuer' : 'Ouvrir dans Studio 3D'}
        </button>
      </div>
    </div>
  );
}
