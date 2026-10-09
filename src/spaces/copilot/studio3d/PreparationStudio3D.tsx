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

interface Adresse { label: string; citycode: string; lat: number; lon: number }
interface Parcelle { id: string; feature?: unknown; area_m2?: number | null }

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

export function PreparationStudio3D({ ouvert, onFermer, briefInitial, fichiersInitiaux }: {
  ouvert: boolean; onFermer: () => void; briefInitial?: string;
  /** Pièces jointes du tchat : images → photos de façade, PDF → plans. */
  fichiersInitiaux?: File[];
}) {
  // Une session = un dossier de transfert ; recréée à chaque ouverture.
  const session = useMemo(() => `chat-${crypto.randomUUID()}`, [ouvert]); // eslint-disable-line react-hooks/exhaustive-deps
  const [requete, setRequete] = useState("");
  const [suggestions, setSuggestions] = useState<Adresse[]>([]);
  const [adresse, setAdresse] = useState<Adresse | null>(null);
  const [parcelles, setParcelles] = useState<Parcelle[]>([]);
  const [facades, setFacades] = useState<FichierTransfert[]>([]);
  const [plans, setPlans] = useState<FichierTransfert[]>([]);
  const [panoramas, setPanoramas] = useState<Panorama360[]>([]);
  const [brief, setBrief] = useState(briefInitial ?? "");
  const [occupe, setOccupe] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const minuteur = useRef<number | null>(null);

  useEffect(() => { if (ouvert && briefInitial) setBrief(briefInitial); }, [ouvert, briefInitial]);
  // Les pièces jointes du message partent tout de suite au bon endroit.
  const initiauxTraites = useRef<File[] | undefined>(undefined);
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

  const chercher = useCallback((q: string) => {
    setRequete(q);
    if (minuteur.current) window.clearTimeout(minuteur.current);
    if (q.trim().length < 3) { setSuggestions([]); return; }
    minuteur.current = window.setTimeout(async () => {
      try {
        const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=6&autocomplete=1`);
        const d = await r.json();
        setSuggestions((d?.features ?? []).map((f: any) => ({
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
    for (const f of liste) {
      setOccupe(`Envoi de ${f.name}…`);
      try {
        if (genre === "facade") { const r = await televerserTransfert(session, f, TYPES_FACADE); setFacades((a) => [...a, r].slice(0, 4)); }
        else if (genre === "plan") { const r = await televerserTransfert(session, f, TYPES_PLAN); setPlans((a) => [...a, r].slice(0, 6)); }
        else { const r = await televerserPanorama(session, f); setPanoramas((a) => [...a, r].slice(0, 5)); }
      } catch (e) { refus.push(e instanceof Error ? e.message : String(e)); }
    }
    setOccupe(null);
    setMessage(refus.length > 0 ? `Refusé : ${refus.join(" · ")}` : null);
  };

  const pret = parcelles.some((p) => p.feature) || facades.length > 0 || plans.length > 0 || brief.trim().length > 0;

  const generer = async () => {
    // CAD04 — une parcelle sans géométrie est signalée avant d'ouvrir un onglet.
    const manquantes = parcellesSansGeometrie(parcelles);
    if (manquantes.length > 0) {
      setMessage(`Géométrie cadastrale absente pour ${manquantes.join(", ")} : retirez-la ou sélectionnez-la à nouveau sur la carte.`);
      return;
    }
    try {
      setMessage(null);
      setOccupe(parcelles.length > 0 ? "Mesure du relief et préparation de l’envoi au Studio 3D…" : "Préparation de l’envoi au Studio 3D…");
      await ouvrirOngletStudio3D(async () => {
        const [fac, pla, pan, terrain] = await Promise.all([
          signerTransferts(facades), signerTransferts(plans), adressesSignees(panoramas),
          parcelles.length > 0 ? chargerReliefMesure(parcelles, adresse?.citycode ?? null) : Promise.resolve(null),
        ]);
        return adresseStudio3D(
          parcelles, adresse?.citycode ?? null, adresse?.label ?? null,
          adresse ? { lat: adresse.lat, lon: adresse.lon } : null, pan,
          { brief, facades: fac, plans: pla }, terrain,
        );
      });
      setMessage("Le Studio 3D s’ouvre dans un nouvel onglet : il importe le terrain et son relief et affiche la scène en 3D dans le navigateur.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(null);
    }
  };

  if (!ouvert) return null;
  return (
    <div role="dialog" aria-label="Prévisualisation 3D" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.45)", display: "flex", justifyContent: "center", alignItems: "flex-start", overflowY: "auto", padding: "4vh 12px" }}>
      <div style={{ width: "min(860px, 100%)", background: "#f8fafc", borderRadius: 16, padding: 18, boxShadow: "0 24px 60px rgba(0,0,0,.35)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Box size={20} color="#6d5dfc" />
          <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a" }}>Prévisualisation 3D</div>
          <button type="button" onClick={onFermer} aria-label="Fermer" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>
        <p style={aide}>Réunissez la parcelle, les photos et les plans : le Studio 3D importe le terrain et son relief et affiche la scène en 3D dans votre navigateur. Aperçu actuel : l’analyse IA des photos de façade, la visite Unreal, les images et le film ne sont pas encore disponibles.</p>

        <div style={carte}>
          <div style={titre}><MapPin size={15} /> 1. Parcelle(s)</div>
          <input value={requete} onChange={(e) => chercher(e.target.value)} placeholder="Adresse du terrain…"
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 8, marginTop: 8 }} />
          {suggestions.length > 0 && (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, marginTop: 4, background: "#fff" }}>
              {suggestions.map((s) => (
                <div key={`${s.label}-${s.lat}`} onClick={() => { setAdresse(s); setRequete(s.label); setSuggestions([]); }}
                  style={{ padding: "8px 10px", cursor: "pointer", fontSize: 13 }}>{s.label}</div>
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

        {(occupe || message) && (
          <p style={{ fontSize: 13, color: "#334155", marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
            {occupe && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}{occupe ?? message}
          </p>
        )}
        <button type="button" disabled={!pret || !!occupe} onClick={() => void generer()}
          style={{ marginTop: 12, width: "100%", padding: "12px 14px", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 15,
            cursor: pret && !occupe ? "pointer" : "not-allowed", background: pret ? "#6d5dfc" : "#cbd5e1", color: "#fff" }}>
          Générer la prévisualisation 3D
        </button>
      </div>
    </div>
  );
}
