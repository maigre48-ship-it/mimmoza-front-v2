// src/spaces/copilot/studio3d/PlanAxonometrique.tsx
//
// Affichage et export du plan axonométrique (planAxonometriqueLogique.ts). Le SVG est
// produit sans WebGL à partir de la géométrie du volume : la même chaîne sert à
// l'affichage, à l'export SVG (vectoriel) et à l'export PNG haute définition
// (rastérisé par le navigateur à partir du même SVG).

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileCode, FileImage, RotateCw } from 'lucide-react';
import type { VolumePropose } from './volumeParcelle';
import { nomFichierPlan, svgPlanAxo, tournerAxo, type CartouchePlan, type RotationAxo } from './planAxonometriqueLogique';

/** Largeur de l'export (px SVG) ; le PNG est rastérisé à ×3 de cette largeur. */
const LARGEUR_EXPORT = 960;
const FACTEUR_PNG = 3;

function telecharger(blob: Blob, nom: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nom; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function svgVersPng(svg: string): Promise<Blob> {
  const image = new Image();
  image.decoding = 'async';
  const chargee = new Promise<void>((ok, ko) => { image.onload = () => ok(); image.onerror = () => ko(new Error('Rendu PNG impossible.')); });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await chargee;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth * FACTEUR_PNG; canvas.height = image.naturalHeight * FACTEUR_PNG;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Rendu PNG impossible.');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((ok, ko) => canvas.toBlob(b => b ? ok(b) : ko(new Error('Rendu PNG impossible.')), 'image/png'));
}

export function PlanAxonometrique({ volume, cartouche, rotation, onTourner }: {
  volume: VolumePropose;
  cartouche: CartouchePlan;
  rotation: RotationAxo;
  onTourner: (r: RotationAxo) => void;
}) {
  const hote = useRef<HTMLDivElement>(null);
  const [largeur, setLargeur] = useState(480);
  const [export_, setExport] = useState<'' | 'svg' | 'png'>('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const el = hote.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(([entree]) => {
      const l = Math.round(entree.contentRect.width);
      if (l > 0) setLargeur(Math.max(300, Math.min(720, l)));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  // Affichage : le dessin suit la largeur du panneau, le texte reste lisible (1 px SVG ≈ 1 px écran).
  const svg = useMemo(() => svgPlanAxo(volume, cartouche, { rotation, largeur, hauteurMax: Math.round(largeur * 0.82) }), [volume, cartouche, rotation, largeur]);

  const exporter = async (format: 'svg' | 'png') => {
    if (export_) return;
    setExport(format); setMessage('');
    try {
      const fichier = svgPlanAxo(volume, cartouche, { rotation, largeur: LARGEUR_EXPORT, hauteurMax: 700, taillePolice: 13 });
      const nom = nomFichierPlan(cartouche.idu, rotation, format);
      telecharger(format === 'svg' ? new Blob([fichier], { type: 'image/svg+xml;charset=utf-8' }) : await svgVersPng(fichier), nom);
      setMessage(`Plan exporté : ${nom}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Export impossible.');
    } finally { setExport(''); }
  };

  return <>
    <div ref={hote} className="mzia-volume__axo" dangerouslySetInnerHTML={{ __html: svg }} />
    <div className="mzia-volume__axo-barre">
      <button type="button" className="mzia-volume__axo-btn" onClick={() => onTourner(tournerAxo(rotation))} title="Tourner le plan de 90°">
        <RotateCw size={15} aria-hidden="true" /><span>Tourner de 90°</span><span className="mzia-volume__sr"> (vue {rotation + 1} sur 4)</span>
      </button>
      <span className="mzia-volume__axo-export" role="group" aria-label="Exporter le plan">
        <span aria-hidden="true">Exporter le plan</span>
        <button type="button" className="mzia-volume__axo-btn" disabled={Boolean(export_)} onClick={() => void exporter('svg')}>
          <FileCode size={15} aria-hidden="true" /><span>SVG</span><span className="mzia-volume__sr"> (vectoriel)</span>
        </button>
        <button type="button" className="mzia-volume__axo-btn" disabled={Boolean(export_)} onClick={() => void exporter('png')}>
          <FileImage size={15} aria-hidden="true" /><span>PNG HD</span>
        </button>
      </span>
    </div>
    {message && <p className="mzia-volume__axo-message" role="status">{message}</p>}
  </>;
}
