// src/spaces/promoteur/foncier/Environnement360Panel.tsx
//
// ENV1 — « Environnement 360° » : l'utilisateur ajoute, depuis son téléphone,
// les photos 360° prises autour de la parcelle. Elles partent au Studio 3D avec
// les parcelles et deviennent le fond de la scène (rue, voisins, horizon).

import React, { useCallback, useEffect, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { listerPanoramas, supprimerPanorama, televerserPanorama, type Panorama360 } from "../shared/environnement360";
import { messageErreur } from "@/components/ui/messageErreur";

export function Environnement360Panel({ studyId, onChange }: { studyId: string | null; onChange?: (p: Panorama360[]) => void }) {
  const [panoramas, setPanoramas] = useState<Panorama360[]>([]);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    if (!studyId) return;
    try {
      const l = await listerPanoramas(studyId);
      setPanoramas(l);
      onChange?.(l);
    } catch (e) {
      setMessage(messageErreur(e, "Opération sur le panorama impossible."));
    }
  }, [studyId, onChange]);

  useEffect(() => { void recharger(); }, [recharger]);

  const ajouter = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fichiers = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!studyId || fichiers.length === 0) return;
    setOccupe(true);
    const refus: string[] = [];
    for (const f of fichiers) {
      setMessage(`Envoi de ${f.name}…`);
      try { await televerserPanorama(studyId, f); } catch (err) { refus.push(messageErreur(err, "Opération sur le panorama impossible.")); }
    }
    setOccupe(false);
    setMessage(refus.length > 0 ? `Refusé : ${refus.join(" · ")}` : `${fichiers.length} photo(s) 360° ajoutée(s).`);
    await recharger();
  };

  const retirer = async (p: Panorama360) => {
    setOccupe(true);
    try { await supprimerPanorama(p.path); } catch (err) { setMessage(messageErreur(err, "Opération sur le panorama impossible.")); }
    setOccupe(false);
    await recharger();
  };

  return (
    <div style={{ padding: "14px 18px", borderTop: "1px solid #e2e8f0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
        <Camera size={16} /> Environnement 360° ({panoramas.length})
      </div>
      <p style={{ fontSize: 12, color: "#64748b", margin: "6px 0 10px" }}>
        Sur le terrain, prenez une photo 360° depuis le trottoir, face à la parcelle (mode Photo Sphere / 360° du
        téléphone, ou caméra 360). Elle servira de fond à la scène 3D.
      </p>
      {!studyId && <p style={{ fontSize: 12, color: "#b45309" }}>Ouvrez cette page depuis une opération pour enregistrer des photos.</p>}
      {panoramas.map((p) => (
        <div key={p.path} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "4px 0" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nom}</span>
          <button type="button" onClick={() => void retirer(p)} disabled={occupe} title="Retirer" style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626" }}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8, padding: "10px 12px", borderRadius: 8, border: "1px dashed #94a3b8", cursor: studyId && !occupe ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600, color: "#334155" }}>
        {occupe ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Camera size={14} />}
        Ajouter une photo 360°
        <input type="file" accept="image/jpeg,image/png" multiple disabled={!studyId || occupe} onChange={(e) => void ajouter(e)} style={{ display: "none" }} />
      </label>
      {message && <p style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>{message}</p>}
    </div>
  );
}
